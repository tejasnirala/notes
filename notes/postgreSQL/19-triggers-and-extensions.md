---
title: Triggers & Extensions
---

# Triggers & Extensions

> **What you will be able to do after this page**
>
> - Write row and statement triggers, understand `BEFORE`/`AFTER`/`INSTEAD OF`, and use `NEW`/`OLD` correctly.
> - Build an audit table, a maintained counter, and an `updated_at` trigger from memory.
> - Say when a trigger is the right tool and when it's a maintenance liability.
> - Name and use the extensions that matter, and explain why extensibility is Postgres's structural advantage.

---

## 1. Trigger anatomy

A trigger is a **function** (returning `trigger`) plus a **binding** to a table and event.

```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;                    -- BEFORE ROW triggers must return a row
END $$;

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
```

| Dimension | Options |
| :--- | :--- |
| Timing | `BEFORE`, `AFTER`, `INSTEAD OF` (views only) |
| Event | `INSERT`, `UPDATE`, `UPDATE OF col1, col2`, `DELETE`, `TRUNCATE` |
| Level | `FOR EACH ROW`, `FOR EACH STATEMENT` |
| Condition | `WHEN (OLD.status IS DISTINCT FROM NEW.status)` |
| Timing (constraint) | `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` |

### `BEFORE` vs `AFTER` — the decision

| | `BEFORE ROW` | `AFTER ROW` |
| :--- | :--- | :--- |
| Can modify `NEW` | ✅ — the modified row is what gets written | ❌ — the row is already written |
| Can cancel the operation | ✅ `RETURN NULL` skips the row silently | ❌ |
| Sees the final row (with defaults, other triggers applied) | ❌ | ✅ |
| Use for | Validation, normalisation, setting `updated_at` | Auditing, cascades, notifications, maintaining counters |

```text
INSERT/UPDATE flow:

  statement BEFORE trigger
    → for each row:
        BEFORE ROW trigger  ── may modify NEW, may RETURN NULL to skip the row
          → constraints checked, row written
        AFTER ROW trigger   ── NEW/OLD are read-only; the row is durable
    → statement AFTER trigger
```

### `NEW` and `OLD`

| Operation | `NEW` | `OLD` |
| :--- | :--- | :--- |
| `INSERT` | The row being inserted | `NULL` |
| `UPDATE` | The new version | The previous version |
| `DELETE` | `NULL` | The row being deleted |

Plus `TG_OP` (`'INSERT'`/`'UPDATE'`/`'DELETE'`/`'TRUNCATE'`), `TG_TABLE_NAME`, `TG_TABLE_SCHEMA`, `TG_WHEN`, `TG_LEVEL`, and `TG_ARGV[]` for arguments passed in `EXECUTE FUNCTION f('a','b')`.

**Return value rules:**

```text
BEFORE ROW    → return NEW to proceed (possibly modified)
                return NULL to SILENTLY SKIP this row
AFTER ROW     → return value is ignored (convention: RETURN NULL)
BEFORE STATEMENT / AFTER STATEMENT → ignored
INSTEAD OF    → return NEW (or NULL to skip)

⚠️  A BEFORE ROW trigger that falls off the end without RETURN NEW returns NULL
    and therefore silently deletes the row from the operation. This is the single
    most common trigger bug.
```

---

## 2. The patterns worth memorising

### `updated_at` — the universal one

```sql
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON orders
FOR EACH ROW
WHEN (OLD.* IS DISTINCT FROM NEW.*)      -- skip no-op updates
EXECUTE FUNCTION set_updated_at();
```

The `WHEN` clause avoids bumping `updated_at` when the row didn't actually change — worth having.

### Audit trail

```sql
CREATE TABLE audit_log (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name text        NOT NULL,
    row_id     text        NOT NULL,
    operation  text        NOT NULL,
    old_data   jsonb,
    new_data   jsonb,
    changed_by text        NOT NULL DEFAULT current_user,
    changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION audit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    INSERT INTO audit_log (table_name, row_id, operation, old_data, new_data)
    VALUES (
      TG_TABLE_NAME,
      coalesce(NEW.id, OLD.id)::text,
      TG_OP,
      CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
      CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
    );
    RETURN NULL;                                -- AFTER trigger: ignored
END $$;

CREATE TRIGGER trg_audit_orders
    AFTER INSERT OR UPDATE OR DELETE ON orders
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

One generic function, attachable to any table — `to_jsonb(NEW)` works on any row type. That's a genuinely Postgres-flavoured solution.

To record *who* did it from an application that connects as one database user, pass it through a session variable:

```sql
SET LOCAL app.user_id = '42';
-- inside the trigger:
current_setting('app.user_id', true)     -- `true` = don't error if unset
```

### Maintained counters (the computed pattern)

```sql
CREATE OR REPLACE FUNCTION bump_comment_count() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE posts SET comment_count = comment_count - 1 WHERE id = OLD.post_id;
    ELSIF NEW.post_id IS DISTINCT FROM OLD.post_id THEN
        UPDATE posts SET comment_count = comment_count - 1 WHERE id = OLD.post_id;
        UPDATE posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_comment_count
AFTER INSERT OR UPDATE OF post_id OR DELETE ON comments
FOR EACH ROW EXECUTE FUNCTION bump_comment_count();
```

:::warning[This serialises writes on the parent row]
Every comment insert updates the same `posts` row, so concurrent inserts on a hot post queue behind that row lock. For a genuinely hot counter, insert deltas into a separate table and roll them up periodically, or accept an approximate count.
:::

### `INSTEAD OF` — make a complex view writable

```sql
CREATE VIEW customer_summary AS
  SELECT c.id, c.name, c.email, count(o.id) AS order_count
  FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
  GROUP BY c.id;

CREATE FUNCTION customer_summary_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE customers SET name = NEW.name, email = NEW.email WHERE id = NEW.id;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_cs_update INSTEAD OF UPDATE ON customer_summary
FOR EACH ROW EXECUTE FUNCTION customer_summary_update();
```

### Statement-level triggers with transition tables (PG 10+)

```sql
CREATE TRIGGER trg_bulk_audit
AFTER UPDATE ON orders
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION bulk_audit();

-- inside the function, old_rows and new_rows are queryable relations:
INSERT INTO audit_log (...)
SELECT ... FROM new_rows n JOIN old_rows o ON o.id = n.id;
```

**One set-based insert instead of a million row-trigger firings.** For bulk operations this is dramatically faster and is the right shape for auditing large updates.

### `LISTEN` / `NOTIFY` from a trigger

```sql
CREATE FUNCTION notify_order_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('orders_changed',
                      json_build_object('id', NEW.id, 'status', NEW.status)::text);
    RETURN NULL;
END $$;
```

The application does `LISTEN orders_changed;` and receives an async notification **after the transaction commits**. Payload limit is 8000 bytes. It's a genuine, zero-infrastructure pub/sub — but notifications are **not durable**: a client that isn't connected misses them. Use it for cache invalidation and worker wake-ups, not as a message queue of record. (Note: `LISTEN` needs a session, so it doesn't work under PgBouncer transaction pooling.)

---

## 3. When *not* to use triggers

| Trigger is right | Prefer something else |
| :--- | :--- |
| Invariants that must hold no matter which client writes | Business logic the app team needs to read and debug |
| Audit trails and history tables | Anything calling an external service (you can't, safely) |
| `updated_at`, normalisation, denormalised counters | Complex multi-step workflows |
| Making a view writable | Anything better expressed as a `CHECK`, `FOREIGN KEY`, or generated column |

:::danger[The real cost of triggers is invisibility]
A trigger runs on every write and appears in no application code. A junior developer debugging "why did this row change" has nowhere to look. Cascading triggers — trigger A updates table B, whose trigger updates table C — are genuinely hard to reason about, and Postgres caps recursion at `max_stack_depth` rather than at anything semantic.

The rule: **use triggers for data integrity, not for business logic.** If the answer to "where does this value come from" isn't obvious from the schema, it's the wrong tool. Prefer, in order: a constraint, a generated column, then a trigger.
:::

:::info[PostgreSQL vs MySQL — triggers]
| PostgreSQL | MySQL |
| :--- | :--- |
| Multiple triggers per event per table, fired in **name order** | Multiple triggers per event since 5.7 (one only before that), ordered with `FOLLOWS`/`PRECEDES` |
| `FOR EACH STATEMENT` triggers with **transition tables** | **Row-level only** — no statement triggers at all |
| `INSTEAD OF` on views | ❌ Not supported |
| `TRUNCATE` triggers | ❌ |
| `WHEN (condition)` clause | ❌ — you write an `IF` inside |
| Trigger body is a reusable **function**, shareable across tables | Trigger body is inline and table-specific |
| `UPDATE OF col` to fire only on specific columns | ❌ |
| Deferrable constraint triggers | ❌ |

The statement-level trigger with transition tables is the big one — auditing a million-row update is one set-based insert on Postgres and a million function calls on MySQL.
:::

---

## 4. Extensions — the structural advantage

```sql
SELECT * FROM pg_available_extensions ORDER BY name;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION postgis SCHEMA extensions;      -- keep them out of public
SELECT * FROM pg_extension;
ALTER EXTENSION pg_trgm UPDATE;
```

An extension can add types, operators, index access methods, functions, background workers and planner hooks. That's why PostgreSQL absorbs whole product categories instead of losing to them.

### The ones worth knowing by name

| Extension | What it gives you |
| :--- | :--- |
| **`pg_stat_statements`** | Query performance statistics. **Install this on every server** |
| **`pg_trgm`** | Trigram similarity → indexed `LIKE '%x%'` and fuzzy matching |
| **`pgcrypto`** | `gen_random_uuid()` (pre-13), `crypt()`, `digest()`, PGP functions |
| **`postgis`** | Full geospatial: geometry/geography types, spatial indexes, thousands of functions |
| **`pgvector`** | `vector` type + HNSW/IVFFlat indexes → embeddings and semantic search |
| **`uuid-ossp`** | UUID v1/v3/v5 (v4 is built in as `gen_random_uuid()` since PG 13) |
| **`hstore`** | Key-value string pairs. Largely superseded by `jsonb` |
| **`citext`** | Case-insensitive text type |
| **`btree_gin` / `btree_gist`** | Let scalar types participate in GIN/GiST indexes and exclusion constraints |
| **`pg_partman`** | Automated partition creation and retention |
| **`pg_cron`** | Cron scheduling inside the database |
| **`pg_repack`** | Rebuild bloated tables/indexes online |
| **`postgres_fdw` / `file_fdw`** | Query another Postgres server, or a CSV file, as a local table |
| **`timescaledb`** | Time-series: hypertables, continuous aggregates, compression |
| **`pglogical` / `pg_partman`** | Advanced logical replication |
| **`auto_explain`** | Log plans of slow queries automatically |
| **`pgstattuple`** | Exact bloat measurement |
| **`tablefunc`** | `crosstab()` pivots, `normal_rand()` |
| **`unaccent`** | Strip diacritics — chain into a text search config |
| **`amcheck`** | Verify index and heap integrity |
| **`pg_hint_plan`** | Optimizer hints, if you truly need them |

### Foreign data wrappers

```sql
CREATE EXTENSION postgres_fdw;
CREATE SERVER analytics FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'analytics.internal', dbname 'warehouse');
CREATE USER MAPPING FOR app SERVER analytics OPTIONS (user 'app', password '...');
IMPORT FOREIGN SCHEMA public LIMIT TO (events) FROM SERVER analytics INTO remote;

SELECT * FROM remote.events WHERE created_at > now() - interval '1 day';
-- the WHERE clause is PUSHED DOWN to the remote server
```

FDWs exist for MySQL, Oracle, MongoDB, S3, Redis, and arbitrary files. This is how Postgres does federation — and it's how you migrate *from* MySQL: `mysql_fdw` lets you read the old database as if it were local tables while you cut over.

:::info[PostgreSQL vs MySQL — extensibility]
This is arguably the deepest architectural difference between the two, and worth stating plainly.

**PostgreSQL was designed to be extended.** Types, operators, aggregate functions, index access methods, procedural languages, planner hooks and background workers are all pluggable, and extensions are first-class, versioned, installable objects. That's why PostGIS is the industry standard for geospatial, why `pgvector` made Postgres a credible vector database within a year of the LLM boom, and why TimescaleDB can turn it into a time-series database — none of which required a fork.

**MySQL's extensibility is at the storage engine layer** — InnoDB, MyISAM, MEMORY, RocksDB — which is a genuine capability Postgres lacks (Postgres has pluggable table access methods since 12, but nothing like the InnoDB/MyRocks ecosystem). MySQL also supports UDFs written in C and has plugins for authentication and replication. But you cannot add a new indexed data type with its own operator class to MySQL the way you can to Postgres.

The practical consequence: when a new data domain appears — geospatial, JSON, time series, full text, vector embeddings — Postgres tends to get a first-class extension, while MySQL waits for the vendor.
:::

---

## 5. Rapid-fire recall

<details>
<summary>**`BEFORE` vs `AFTER` triggers?**</summary>

A `BEFORE ROW` trigger runs before the row is written, so it can modify `NEW` — that's how you set `updated_at` or normalise an email — and it can return `NULL` to silently skip the operation for that row. An `AFTER ROW` trigger runs once the row is written and constraints have passed, so `NEW` is read-only but you know the change is real; that's where auditing, cascades and notifications belong. The most common bug is a `BEFORE ROW` trigger that forgets `RETURN NEW`, which returns NULL and silently discards the row.
</details>

<details>
<summary>**When would you use a statement-level trigger?**</summary>

When the work is naturally set-based and the row count is large. With `REFERENCING OLD TABLE AS ... NEW TABLE AS ...` the trigger function gets the affected rows as queryable relations, so auditing a million-row update becomes one `INSERT ... SELECT` instead of a million function invocations. MySQL has no statement-level triggers at all, which is why bulk auditing there is genuinely painful.
</details>

<details>
<summary>**When are triggers the wrong tool?**</summary>

When they hide business logic. A trigger executes on every write and appears in no application code, so debugging "why did this value change" means knowing to look in the catalog. Cascading triggers across several tables are especially hard to reason about. So I use them for data integrity — audit trails, `updated_at`, maintained counters, making a view writable — and keep business rules in the application. And I'd reach for a `CHECK` constraint or a generated column first, since both are declarative and visible in the schema.
</details>

<details>
<summary>**How do you build an audit trail?**</summary>

One generic `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW` trigger function that writes `TG_TABLE_NAME`, `TG_OP`, and `to_jsonb(OLD)` and `to_jsonb(NEW)` into an audit table — `to_jsonb` works on any row type, so the same function attaches to every table. For the acting user, when the app connects as a single database role, set a session variable like `app.user_id` with `SET LOCAL` at the start of the transaction and read it in the trigger with `current_setting('app.user_id', true)`. For bulk updates I'd use the statement-level variant with transition tables instead.
</details>

<details>
<summary>**What is `LISTEN`/`NOTIFY` good for, and not good for?**</summary>

It's a built-in asynchronous pub/sub: a trigger calls `pg_notify(channel, payload)` and any session that has issued `LISTEN` on that channel receives it after the transaction commits. It's excellent for cache invalidation and waking up worker processes with zero extra infrastructure. It's not a message queue: notifications aren't durable, so a client that's disconnected simply misses them, the payload is capped at 8000 bytes, and it doesn't work under PgBouncer transaction pooling because `LISTEN` is session state.
</details>

<details>
<summary>**Why does extensibility matter?**</summary>

Because it means Postgres absorbs new data domains without a fork or a vendor roadmap. Extensions can add types, operators, index access methods, procedural languages and background workers, so PostGIS made it the standard for geospatial, `pgvector` made it a credible vector database within about a year of embeddings becoming mainstream, and TimescaleDB turns it into a time-series store. MySQL's extensibility is at the storage engine layer instead — which is a real capability Postgres doesn't match — but you can't add a new indexable type with its own operator class to MySQL the way you can to Postgres.
</details>

<details>
<summary>**Name five extensions you'd install by default.**</summary>

`pg_stat_statements` on literally every server, because you can't tune what you can't measure. `auto_explain` to capture the plans of slow queries in production. `pg_trgm` for fuzzy and substring search. `pgcrypto` for hashing and, on older versions, `gen_random_uuid()`. And `btree_gist`, because it's what lets you combine scalar equality with range overlap in an exclusion constraint. Beyond the defaults, `pg_partman` and `pg_cron` for anything partitioned, `pg_repack` for bloat, and `postgres_fdw` for federation and migrations.
</details>

---

**Next:** [Roles, Privileges & Security →](./20-roles-and-security.md)
