---
title: Data Types
---

# Data Types

> **What you will be able to do after this page**
>
> - Pick the right type first time: `text` vs `varchar`, `numeric` vs `float`, `timestamptz` vs `timestamp`.
> - Use the types MySQL doesn't have — arrays, ranges, `jsonb`, `uuid`, network types, composite types.
> - Explain PostgreSQL's type system as an *extensible* system, not a fixed list.
> - Avoid the three classic type bugs: naive timestamps, float money, and `char(n)` padding.

---

## 1. The mental model

PostgreSQL's type system is **extensible by design**. Types are rows in `pg_type`; you can add your own with `CREATE TYPE`, give them operators, and index them. Extensions like PostGIS (geometry), `citext` (case-insensitive text) and `hstore` are "just" new types with operator classes. That is the single biggest structural difference from MySQL's fixed type list.

```sql
SELECT typname, typlen FROM pg_type WHERE typname IN ('int4','text','jsonb','uuid');
```

---

## 2. Numeric types

| Type | Alias | Size | Range / precision | Use for |
| :--- | :--- | :--- | :--- | :--- |
| `smallint` | `int2` | 2 B | ±32,767 | Small enums, flags |
| `integer` | `int`, `int4` | 4 B | ±2.1 billion | **Default choice** |
| `bigint` | `int8` | 8 B | ±9.2 quintillion | IDs on anything that might grow |
| `numeric(p,s)` | `decimal` | var | exact, up to 131072 digits | **Money, anything exact** |
| `real` | `float4` | 4 B | ~6 digits, inexact | Scientific/approximate |
| `double precision` | `float8` | 8 B | ~15 digits, inexact | Scientific/approximate |

```sql
SELECT 0.1::float8 + 0.2::float8 = 0.3::float8;   -- false  😱
SELECT 0.1::numeric + 0.2::numeric = 0.3::numeric; -- true   ✅
```

:::danger[Never store money in a float]
`numeric` is arbitrary-precision decimal arithmetic implemented in software: exact, but 10–100× slower than hardware floats and larger on disk. That's the right trade for money. The common alternative is `bigint` storing minor units (cents) — fastest and exact, at the cost of doing your own scaling.
:::

### Special float values

```sql
SELECT 'Infinity'::float8, '-Infinity'::float8, 'NaN'::float8;
```

`NaN` in Postgres is treated as **greater than all other values** and **equal to itself** for sorting/indexing purposes — deliberately, so B-trees have a total order. That differs from IEEE 754, where `NaN = NaN` is false.

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| `numeric` has effectively unlimited precision; `numeric` with no `(p,s)` is legal and stores exactly what you give it | `DECIMAL(M,D)` capped at 65 digits; unqualified `DECIMAL` means `DECIMAL(10,0)` — silently truncates! |
| No `UNSIGNED` integers — use a `CHECK (x >= 0)` constraint | Has `UNSIGNED INT`, doubling positive range |
| Integer overflow **raises an error** | Historically wrapped or clamped; strict mode now errors |
| `1/0` raises `division_by_zero` | Returns `NULL` (unless `ERROR_FOR_DIVISION_BY_ZERO`) |

The missing `UNSIGNED` is the most common porting complaint. `CHECK (qty >= 0)` is the answer and is arguably better documentation anyway.
:::

---

## 3. Character types

| Type | Behaviour |
| :--- | :--- |
| `text` | Unlimited length. **The default choice.** |
| `varchar(n)` | Same storage as `text`, plus a length check |
| `varchar` | Identical to `text` |
| `char(n)` | **Blank-padded** to n characters. Avoid. |

There is **no performance penalty** for `text` versus `varchar(n)` in PostgreSQL. They use the same code path and the same storage. `varchar(n)` is a `text` with a constraint. Use `text` plus an explicit `CHECK (length(x) <= 200)` if you want a limit, because changing a `CHECK` is easier to reason about than a type change (though `ALTER TABLE ... ALTER COLUMN ... TYPE varchar(300)` to *increase* a limit is also non-rewriting since PG 9.2).

```sql
SELECT 'abc'::char(10) || '|';       -- 'abc       |'  ← padded!
SELECT length('abc'::char(10));      -- 3              ← but length ignores padding
```

`char(n)` gives you padding that appears in concatenation but not in `length()`. Nobody wants that.

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| `text` is the idiomatic default, no penalty | `TEXT` is a *different, worse* type than `VARCHAR`: can't have a full index without a prefix length, forced to disk for temp tables, no default value |
| `varchar(n)` limit is characters, checked | `VARCHAR(n)` limit interacts with the 65,535-byte row limit |
| Comparison is **case-sensitive** by default | Default collation `utf8mb4_0900_ai_ci` is **case-insensitive** |
| `'abc' = 'ABC'` → false | `'abc' = 'ABC'` → **true** by default |

**This is the biggest silent behaviour change when porting.** MySQL apps often rely on case-insensitive `WHERE email = ?`. On Postgres you need `lower(email) = lower(?)` with a functional index, the `citext` extension, or a non-deterministic ICU collation:

```sql
CREATE COLLATION case_insensitive (
  provider = icu, locale = 'und-u-ks-level2', deterministic = false
);
CREATE TABLE users (email text COLLATE case_insensitive);
```
:::

### Empty string is not NULL

```sql
SELECT '' IS NULL;         -- false
SELECT '' = NULL;          -- NULL (not false!)
SELECT coalesce(NULLIF('', ''), 'fallback');  -- 'fallback'
```

Postgres and MySQL agree here (both treat `''` and `NULL` as distinct) — this is **only** different in Oracle. Worth stating so you don't invent a difference in an interview.

---

## 4. Date/time — get this right or suffer

| Type | Stores |
| :--- | :--- |
| `date` | Calendar date, no time |
| `time` | Time of day, no date, no zone (nearly useless alone) |
| `timestamp` | Date + time, **no time zone** — a "wall clock reading" |
| `timestamptz` | Date + time, **absolute point in time** |
| `interval` | A duration — `'3 days 4 hours'` |

**`timestamptz` does not store a time zone.** It stores UTC. On input it converts *from* the session `TimeZone` to UTC; on output it converts *back*. `timestamp` (without tz) does no conversion at all, which means the same value means different instants for different users — almost always a bug.

```sql
SET TimeZone = 'Asia/Kolkata';
SELECT now();                                  -- 2026-08-30 14:30:00+05:30
SELECT now() AT TIME ZONE 'UTC';               -- 2026-08-30 09:00:00   (timestamp)
SELECT (now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'; -- back to timestamptz
```

`AT TIME ZONE` is a **type-switching operator**:

```text
timestamptz  AT TIME ZONE 'Asia/Kolkata'  →  timestamp    (render in that zone)
timestamp    AT TIME ZONE 'Asia/Kolkata'  →  timestamptz  (interpret as in that zone)
```

:::tip[The rule]
**Always `timestamptz`. Always.** Even for "dates that don't have a time zone" — because `created_at`, `expires_at`, `deleted_at` all describe instants. The only genuine `timestamp` use case is a wall-clock value with no instant meaning, like "the alarm goes off at 07:00 local wherever you are."
:::

Useful functions:

```sql
SELECT date_trunc('month', now());                     -- start of month
SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata'); -- day boundary in IST
SELECT extract(dow FROM now());                        -- 0=Sunday
SELECT age(timestamptz '2000-01-01');                  -- interval, human units
SELECT now() - interval '7 days';
SELECT generate_series(date '2026-01-01', date '2026-01-05', interval '1 day');
```

`generate_series` alone is worth the price of admission — it's how you build date spines for reports with no gaps.

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| `timestamptz` = instant in UTC, converts on I/O | `TIMESTAMP` converts to/from UTC using session tz (similar!) but **is limited to 1970–2038** (32-bit) |
| `timestamp` = naive wall clock | `DATETIME` = naive wall clock, range 1000–9999 |
| Full IANA tz database, `AT TIME ZONE` operator | `CONVERT_TZ()`, requires timezone tables to be loaded manually |
| `interval` is a first-class type | **No interval type** — `INTERVAL 3 DAY` is syntax inside expressions only |
| `generate_series()` built in | No equivalent; you fake it with a numbers table or recursive CTE |
| `date_trunc()` | `DATE_FORMAT()` / `EXTRACT` gymnastics |

The 2038 limit on MySQL `TIMESTAMP` is a real, dated landmine. The lack of an `interval` *type* means you can't store a duration in a column naturally — people use integer seconds.
:::

---

## 5. Boolean

```sql
SELECT true, false, NULL::boolean;
SELECT 'yes'::boolean, 'on'::boolean, 't'::boolean, '1'::boolean;  -- all true
```

Three-valued logic applies:

```text
   x     |  x AND NULL | x OR NULL | NOT x
 --------+-------------+-----------+-------
  true   |    NULL     |   true    | false
  false  |   false     |   NULL    | true
  NULL   |    NULL     |   NULL    | NULL
```

So `WHERE active = NULL` never matches anything. Use `IS NULL` / `IS NOT NULL` / `IS DISTINCT FROM`.

```sql
-- NULL-safe inequality
SELECT * FROM t WHERE a IS DISTINCT FROM b;
```

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| Real `boolean` type; `true`/`false` literals | `BOOLEAN` is an **alias for `TINYINT(1)`** — stores 0/1 |
| `SELECT true` → `t` | `SELECT true` → `1` |
| Cannot do `WHERE flag = 1` — type error | `WHERE flag = 1` works, and so does `WHERE flag = 2` |
| NULL-safe compare: `IS DISTINCT FROM` | NULL-safe compare: `<=>` |

An ORM configured for MySQL that writes `WHERE is_active = 1` will hard-error on Postgres. Common porting break.
:::

---

## 6. UUID

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SELECT gen_random_uuid();                 -- v4, built in since PG 13 (no extension needed)
CREATE TABLE t (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
```

Stored as **16 raw bytes**, not a 36-character string. Comparison and indexing are on the binary form.

:::warning[Random UUIDs hurt B-tree write performance]
A v4 UUID is random, so inserts scatter across the whole index, defeating the sequential right-edge insert pattern a `bigserial` gives you. Symptoms: high WAL volume, index bloat, poor cache locality. For high-insert tables prefer a time-ordered UUID (**UUIDv7**, native `uuidv7()` in PG 18; before that, use an extension or generate app-side), or just use `bigint identity` and keep the UUID as a separate public-facing column.
:::

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| Native `uuid` type, 16 bytes | **No UUID type.** Use `BINARY(16)` + `UUID_TO_BIN()` / `BIN_TO_UUID()`, or (badly) `CHAR(36)` |
| `gen_random_uuid()` built in | `UUID()` returns v1; `UUID_TO_BIN(x, 1)` swaps the time fields for index locality |

Storing UUIDs as `CHAR(36)` on MySQL — very common in the wild — costs 36 bytes plus collation comparison instead of 16 bytes of memcmp. Postgres just doesn't let you make that mistake.
:::

---

## 7. Arrays — no MySQL equivalent

Any type can be an array, including arrays of composite types.

```sql
CREATE TABLE posts (
  id     bigserial PRIMARY KEY,
  title  text,
  tags   text[]
);
INSERT INTO posts (title, tags) VALUES
  ('Postgres tips', ARRAY['db','postgres','sql']),
  ('MySQL tips',    '{db,mysql}');           -- literal syntax
```

```sql
SELECT tags[1]              FROM posts;   -- 1-INDEXED, not 0!
SELECT array_length(tags,1) FROM posts;
SELECT * FROM posts WHERE tags @> ARRAY['postgres'];  -- contains
SELECT * FROM posts WHERE 'db' = ANY(tags);           -- membership
SELECT * FROM posts WHERE tags && ARRAY['mysql','db'];-- overlaps
SELECT unnest(tags) FROM posts;                        -- explode to rows
SELECT array_agg(DISTINCT t) FROM posts, unnest(tags) t;
```

| Operator | Meaning |
| :--- | :--- |
| `@>` | contains |
| `<@` | is contained by |
| `&&` | overlaps (any common element) |
| `\|\|` | concatenate |
| `= ANY(arr)` | membership (scalar in array) |

Index them with GIN:

```sql
CREATE INDEX idx_posts_tags ON posts USING GIN (tags);
```

:::info[PostgreSQL vs MySQL]
MySQL has **no array type**. The workarounds are a comma-separated string (unindexable, unsearchable, a data-modelling crime), a JSON array (`JSON_CONTAINS`, indexable only via generated columns + multi-valued indexes in 8.0.17+), or a proper junction table.

PostgreSQL arrays are genuinely first-class: typed, indexable with GIN, with a full operator set. **But** they're still denormalisation — use them for small, read-mostly tag-like sets you never need to join or constrain with a foreign key. If you need referential integrity or per-element metadata, you still want a junction table.
:::

---

## 8. JSON and JSONB

```sql
CREATE TABLE events (
  id      bigserial PRIMARY KEY,
  payload jsonb
);
```

| | `json` | `jsonb` |
| :--- | :--- | :--- |
| Stored as | Exact text copy | Decomposed binary |
| Preserves key order & whitespace | ✅ | ❌ |
| Preserves duplicate keys | ✅ (last wins on read) | ❌ (deduped) |
| Parse cost | On every access | Once, at write |
| Indexable (GIN) | ❌ | ✅ |
| Supports `@>`, `?`, `@?` | ❌ | ✅ |

**Use `jsonb` essentially always.** `json` only wins if you must round-trip a document byte-for-byte (e.g. storing a signed webhook payload whose signature covers exact bytes).

```sql
SELECT payload -> 'user'  FROM events;    -- → jsonb
SELECT payload ->> 'user' FROM events;    -- → text
SELECT payload #> '{user,address,city}';  -- → jsonb, path
SELECT payload #>> '{user,address,city}'; -- → text, path
SELECT * FROM events WHERE payload @> '{"type":"signup"}';  -- containment (GIN-indexable)
```

Full treatment on the [JSON & JSONB page](./10-json-and-jsonb.md).

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL 8 |
| :--- | :--- |
| Two types: `json` (text) and `jsonb` (binary, indexable) | One `JSON` type — binary, similar to `jsonb` |
| GIN index directly on the column: `USING GIN (payload)` | **Cannot index a JSON column directly.** Create a generated column and index that, or use a multi-valued index for arrays |
| Operators: `->`, `->>`, `@>`, `?`, `#>`, `@?`, `jsonpath` | Functions: `JSON_EXTRACT`, `->`, `->>`, `JSON_CONTAINS`, `JSON_TABLE` |
| `jsonb_set`, `||` merge, `-` delete key | `JSON_SET`, `JSON_MERGE_PATCH`, `JSON_REMOVE` |
| `jsonb_to_record`, `jsonb_array_elements` | `JSON_TABLE` (arguably nicer syntax) |

The decisive practical difference: **direct GIN indexing.** On Postgres, `WHERE payload @> '{"type":"signup"}'` is one index away. On MySQL you must know the path in advance and materialise a generated column for it.
:::

---

## 9. Ranges — no MySQL equivalent

```sql
CREATE TABLE bookings (
  id      bigserial PRIMARY KEY,
  room_id int,
  during  tstzrange
);
INSERT INTO bookings (room_id, during) VALUES
  (1, '[2026-09-01 10:00, 2026-09-01 12:00)');
```

Built-in ranges: `int4range`, `int8range`, `numrange`, `tsrange`, `tstzrange`, `daterange`. Bounds notation is `[` inclusive, `)` exclusive.

```sql
SELECT '[1,10)'::int4range @> 5;                       -- true, contains
SELECT '[1,10)'::int4range && '[5,20)'::int4range;     -- true, overlaps
SELECT upper('[1,10)'::int4range), lower('[1,10)'::int4range);
```

The killer feature — **an exclusion constraint that makes double-booking structurally impossible**:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE bookings
  ADD CONSTRAINT no_double_booking
  EXCLUDE USING GIST (room_id WITH =, during WITH &&);
```

Now the database itself rejects any insert whose time range overlaps an existing booking for the same room. No application-level check, no race condition, no `SELECT ... FOR UPDATE` dance. **There is no way to express this in MySQL** — you'd need application locking or a `SELECT FOR UPDATE` guard, both of which are weaker.

---

## 10. ENUM, domains, and composite types

```sql
CREATE TYPE order_status AS ENUM ('pending','paid','shipped','cancelled');
CREATE TABLE orders (id bigserial, status order_status NOT NULL DEFAULT 'pending');

-- Adding a value is cheap and online (PG 12+ even inside a transaction, with caveats)
ALTER TYPE order_status ADD VALUE 'refunded' AFTER 'paid';
```

Enum ordering follows **declaration order**, not alphabetical — so `ORDER BY status` sorts pending → paid → shipped. That's often exactly what you want.

:::warning[You cannot easily REMOVE or RENAME-reorder an enum value]
Removing a value requires recreating the type and rewriting every dependent column. Many teams therefore prefer a lookup table with a foreign key: fully mutable, joinable, can carry a label and sort order. **In an interview, "enum for stable sets, lookup table for evolving ones" is the right answer.**
:::

**Domains** — a reusable constrained type:

```sql
CREATE DOMAIN email AS text
  CHECK (VALUE ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
CREATE DOMAIN positive_int AS integer CHECK (VALUE > 0);

CREATE TABLE users (id bigserial, contact email NOT NULL);
```

**Composite types** — a row type as a column:

```sql
CREATE TYPE address AS (street text, city text, pincode text);
CREATE TABLE customers (id bigserial, home address);
INSERT INTO customers (home) VALUES (ROW('12 MG Rd','Bengaluru','560001'));
SELECT (home).city FROM customers;   -- parentheses are required
```

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| `CREATE TYPE ... AS ENUM` — a **reusable, cluster-level type** | `ENUM('a','b')` is a **column-level** declaration, not reusable |
| Add value online with `ALTER TYPE` | Adding a value = `ALTER TABLE ... MODIFY COLUMN`, may rewrite |
| Enum compares as its own type; no implicit integer cast | Enum is stored as an integer index and **compares as an integer** in numeric context — `WHERE status = 1` silently means the first value! |
| `CREATE DOMAIN` — reusable constrained types | **No domains** |
| Composite types, arrays of composites | **None** |
:::

---

## 11. Network, geometric, and other useful types

```sql
SELECT '192.168.1.5/24'::inet;            -- host + netmask
SELECT '192.168.1.0/24'::cidr;            -- network
SELECT '08:00:2b:01:02:03'::macaddr;
SELECT '192.168.1.5'::inet << '192.168.1.0/24'::cidr;  -- is contained in → true
```

Storing an IP as `inet` (7 or 19 bytes) instead of `varchar(45)` gives you subnet containment operators and correct ordering for free. MySQL has `INET6_ATON`/`INET6_NTOA` functions to pack into `VARBINARY(16)`, but no type with operators.

Others worth knowing exist: `bytea` (binary — Postgres's `BLOB`), `bit(n)`/`bit varying`, `tsvector`/`tsquery` (full-text), `xml`, `money` (avoid — locale-dependent), `point`/`line`/`polygon`/`circle`, and `pg_lsn`.

---

## 12. Type casting

```sql
SELECT '42'::integer;              -- Postgres shorthand (preferred)
SELECT CAST('42' AS integer);      -- SQL standard, portable
SELECT integer '42';               -- literal syntax
```

Postgres is **strictly typed and will not silently coerce nonsense**:

```sql
SELECT 'abc'::integer;             -- ERROR: invalid input syntax for type integer
SELECT 1 + '1';                    -- 2 — the literal is resolved as integer
SELECT 1 + 'a';                    -- ERROR
```

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| `'abc'::int` → **error** | `CAST('abc' AS SIGNED)` → **0 with a warning** (strict mode errors on *insert*, but not always on expression cast) |
| `SELECT 1 = '1'` → true (literal resolves to int) but `SELECT 1 = 'a'` errors | `SELECT 1 = 'a'` → **0**, no error |
| Comparing `int` and `text` columns → error, must cast | Implicit coercion, and it **silently disables the index** on the coerced column |

MySQL's implicit coercion causes a nasty class of bug: `WHERE varchar_col = 123` coerces every *row's* column to a number, forcing a full scan. Postgres refuses to compile it, which is a feature.
:::

---

## 13. Choosing types — the cheat sheet

| Need | Use | Not |
| :--- | :--- | :--- |
| Primary key | `bigint GENERATED ALWAYS AS IDENTITY` | `serial` (legacy), `int` (will overflow) |
| Public-facing ID | `uuid` (v7 if insert-heavy) | `uuid` v4 as the clustered PK |
| Money | `numeric(12,2)` or `bigint` cents | `float`, `money` |
| Any string | `text` | `char(n)`, `varchar(255)` cargo-cult |
| Timestamp | `timestamptz` | `timestamp`, `bigint` epoch |
| Yes/no | `boolean` | `smallint`, `char(1)` |
| Small fixed set | `enum` (stable) or lookup table (evolving) | `text` with no constraint |
| Semi-structured | `jsonb` | `json`, `text` |
| Tag list | `text[]` + GIN | comma-separated string |
| Time span | `tstzrange` + exclusion constraint | two columns + app logic |
| IP address | `inet` | `varchar(45)` |

---

## 14. Rapid-fire recall

<details>
<summary>**`text` vs `varchar(n)` vs `char(n)` — which and why?**</summary>

`text` and `varchar(n)` have identical storage and performance in PostgreSQL; `varchar(n)` is simply `text` with a length check, so I default to `text` and add an explicit `CHECK` constraint if a business limit genuinely exists. `char(n)` blank-pads values to the declared length, which shows up in concatenation but not in `length()`, so it's a trap with no upside. This is different from MySQL, where `TEXT` and `VARCHAR` are genuinely different types with different indexing and temp-table behaviour.
</details>

<details>
<summary>**`timestamp` vs `timestamptz`?**</summary>

`timestamptz` stores an absolute instant — internally UTC — converting from the session time zone on input and back on output. `timestamp` stores a naive wall-clock reading with no zone, so the same stored value denotes different instants for different users. Almost every column you'd naturally call `created_at` or `expires_at` is an instant, so the rule is: always `timestamptz`. The exception is a genuinely zone-less wall clock, like a recurring 07:00 local alarm. Note that `timestamptz` does *not* store which zone the value came from — if you need that, store the zone name in its own column.
</details>

<details>
<summary>**Why not store money in a float?**</summary>

Binary floating point can't represent most decimal fractions exactly, so `0.1 + 0.2 <> 0.3` and errors compound across sums. Use `numeric`, which is exact arbitrary-precision decimal, or a `bigint` count of minor units. `numeric` is meaningfully slower than a hardware float, which is the correct price for correctness in financial data.
</details>

<details>
<summary>**When would you use an array column instead of a join table?**</summary>

When the collection is small, read-mostly, has no per-element attributes, and needs no referential integrity — tags on a post being the canonical example. It saves a join and indexes well with GIN, so `tags @> ARRAY['postgres']` is fast. The moment I need a foreign key to a tags table, extra columns per element, or per-element updates at scale, it becomes a junction table. MySQL has no array type at all, so there the answer is always a junction table or a JSON array with a generated column.
</details>

<details>
<summary>**`json` vs `jsonb`?**</summary>

`json` keeps the exact input text — whitespace, key order, duplicate keys — and reparses on every access, so it can't be indexed with GIN. `jsonb` parses once at write time into a decomposed binary form, which loses formatting and dedupes keys but makes access fast and supports containment operators and GIN indexes. Use `jsonb` unless you specifically need byte-for-byte fidelity, such as a payload whose signature covers the exact bytes.
</details>

<details>
<summary>**Postgres has no `UNSIGNED` — what do you do?**</summary>

Add a `CHECK (col >= 0)` constraint. It's the same guarantee, expressed declaratively, and it shows up in the schema documentation. You do lose the doubled positive range, so if you were relying on `UNSIGNED INT` to reach 4 billion, move to `bigint`.
</details>

<details>
<summary>**Enum type or lookup table?**</summary>

Enum for a small, genuinely stable set where I want type-level enforcement and declaration-order sorting — think `('pending','paid','shipped')`. A lookup table with a foreign key when the set will evolve, needs a display label, needs to be edited by non-engineers, or needs to be joined against. Postgres enums can gain values online with `ALTER TYPE ... ADD VALUE`, but removing or reordering values is painful, and that asymmetry drives the decision.
</details>

<details>
<summary>**What's an exclusion constraint?**</summary>

A generalisation of a unique constraint: instead of "no two rows are equal on these columns," it says "no two rows satisfy this operator pairwise." Combined with range types it expresses "no two bookings for the same room may overlap in time" as a single declarative constraint enforced by a GiST index. It's one of the clearest examples of Postgres capability that has no MySQL equivalent — there you'd have to serialise the check in application code or with explicit locking.
</details>

---

**Next:** [DDL, Constraints & Schemas →](./03-ddl-and-constraints.md)
