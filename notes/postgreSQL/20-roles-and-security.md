---
title: Roles, Privileges & Security
---

# Roles, Privileges & Security

> **What you will be able to do after this page**
>
> - Explain the role model, and design least-privilege access for an application.
> - Use `DEFAULT PRIVILEGES` so new tables aren't accidentally inaccessible.
> - Implement Row-Level Security for multi-tenancy and know its failure modes.
> - Read `pg_hba.conf`, configure TLS, and prevent SQL injection properly.

---

## 1. Roles — one concept, two uses

PostgreSQL has **no separate "user" and "group"**. There are only roles; `LOGIN` makes one a user, and granting one role to another makes the first behave like a group.

```sql
CREATE ROLE app_read;                                 -- a "group" (NOLOGIN by default)
CREATE ROLE app_write;
CREATE ROLE api_service LOGIN PASSWORD 'x' CONNECTION LIMIT 50;   -- a "user"

GRANT app_read  TO api_service;
GRANT app_write TO api_service;

CREATE USER bob PASSWORD 'x';    -- exactly CREATE ROLE bob LOGIN PASSWORD 'x'
```

Role attributes:

```sql
ALTER ROLE api_service
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS
  CONNECTION LIMIT 50
  VALID UNTIL '2027-01-01'
  SET statement_timeout = '30s';      -- per-role defaults!
```

That per-role `SET` is underused: give the reporting role a 10-minute `statement_timeout` and the API role a 5-second one.

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| Roles are cluster-wide; a role is a user *or* a group depending on attributes | `'user'@'host'` — identity **includes the host pattern** |
| Roles exist since forever; role inheritance built in | Roles added in **8.0**; before that only per-user grants |
| Grant a role to a role for inheritance | Roles must often be explicitly activated (`SET ROLE`, `DEFAULT ROLE`) |
| Privileges: cluster → database → schema → table → column | Global → database → table → column |
| Host-based access is separate, in `pg_hba.conf` | Host is part of the account name |
| **Row-Level Security** ✅ | ❌ **No RLS** — you use views and application logic |

The `user@host` model is the biggest surprise moving from MySQL: `'bob'@'localhost'` and `'bob'@'%'` are two different accounts with different passwords. Postgres separates identity (roles) from connection rules (`pg_hba.conf`), which is cleaner.
:::

---

## 2. Privileges

```sql
-- Database
GRANT CONNECT, TEMPORARY ON DATABASE shop TO app_read;

-- Schema (USAGE is required to touch ANYTHING inside it)
GRANT USAGE ON SCHEMA public TO app_read;
GRANT CREATE ON SCHEMA public TO migrator;

-- Tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_read;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_write;

-- Column-level
GRANT SELECT (id, name, email) ON users TO support;
GRANT UPDATE (status) ON orders TO fulfilment;

-- Sequences (needed for INSERT into a serial/identity column with `serial`)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_write;

-- Functions
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report() TO analyst;
```

:::danger[`GRANT ... ON ALL TABLES` only affects tables that exist right now]
Create a table tomorrow and `app_read` cannot see it. The fix is **default privileges**, set by the role that will own the new objects:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO app_read;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_write;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO app_write;
```

Note **`FOR ROLE migrator`** — default privileges attach to the *creating* role, so this must name whoever runs your migrations. Getting that wrong is the reason "the grants worked in staging but not in production."
:::

### The `PUBLIC` pseudo-role

Every role implicitly has `PUBLIC`'s privileges. By default `PUBLIC` gets `CONNECT` on new databases, `USAGE` on `public` schema, and `EXECUTE` on all new functions.

```sql
REVOKE ALL ON DATABASE shop FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
```

Since **PostgreSQL 15**, `PUBLIC` no longer gets `CREATE` on the `public` schema — a genuinely good hardening change that breaks a lot of old setup scripts.

### Inspecting

```sql
\dp orders                       -- psql: privileges on a table
\du                              -- roles
SELECT * FROM information_schema.role_table_grants WHERE grantee = 'app_read';
SELECT has_table_privilege('app_read', 'orders', 'SELECT');
```

### A least-privilege application setup

```sql
-- Owner: owns the schema, runs migrations. The app NEVER connects as this.
CREATE ROLE app_owner NOLOGIN;
-- Groups
CREATE ROLE app_read NOLOGIN;
CREATE ROLE app_write NOLOGIN;
-- Login roles
CREATE ROLE api  LOGIN PASSWORD '...' IN ROLE app_write;
CREATE ROLE bi   LOGIN PASSWORD '...' IN ROLE app_read;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_read, app_write;
GRANT CONNECT ON DATABASE shop TO app_read, app_write;

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO app_read;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_write;

ALTER ROLE bi SET statement_timeout = '10min';
ALTER ROLE api SET statement_timeout = '5s';
```

**The application should never own its tables.** If it does, a compromised app credential can `DROP TABLE`.

---

## 3. Row-Level Security

RLS makes the database filter rows per user — enforced for *every* query, including ad-hoc ones and ones from a compromised code path.

```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;   -- apply to the table owner too

CREATE POLICY tenant_isolation ON documents
  FOR ALL
  TO app_write
  USING      (tenant_id = current_setting('app.tenant_id')::bigint)   -- rows you can SEE
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::bigint);  -- rows you can WRITE
```

```sql
-- The application sets this once per request, inside the transaction
BEGIN;
SET LOCAL app.tenant_id = '42';
SELECT * FROM documents;     -- automatically filtered to tenant 42
COMMIT;
```

| Clause | Applies to |
| :--- | :--- |
| `USING` | `SELECT`, `UPDATE`, `DELETE` — which existing rows are visible |
| `WITH CHECK` | `INSERT`, `UPDATE` — which new row values are allowed |

Without `WITH CHECK`, a tenant could `UPDATE` a visible row to set `tenant_id` to someone else's.

Multiple policies for one command are combined with **OR** by default (`PERMISSIVE`); `AS RESTRICTIVE` policies are combined with **AND** and act as additional mandatory filters:

```sql
CREATE POLICY own_rows ON documents FOR SELECT USING (owner_id = current_user_id());
CREATE POLICY shared   ON documents FOR SELECT USING (id IN (SELECT doc_id FROM shares WHERE ...));
-- either grants access

CREATE POLICY not_deleted ON documents AS RESTRICTIVE FOR SELECT USING (deleted_at IS NULL);
-- ANDed with all the above
```

:::danger[RLS failure modes]
1. **The table owner bypasses RLS** unless you add `FORCE ROW LEVEL SECURITY`. And any role with `BYPASSRLS` — including superusers — ignores policies entirely. So the app must not connect as the owner or a superuser.
2. **`current_setting('app.tenant_id')` errors if the setting is missing.** Use the two-argument form `current_setting('app.tenant_id', true)` and handle NULL — but be careful: a NULL comparison yields no rows, which fails *closed*. That's the correct direction.
3. **With connection pooling, use `SET LOCAL` inside a transaction.** A plain `SET` persists on the pooled connection and the next request — possibly a different tenant — inherits it. This is a catastrophic, and very real, tenant-leak bug.
4. **Performance:** the policy predicate is ANDed into every query. Make sure `tenant_id` is indexed and, ideally, is the leading column of your composite indexes. A policy containing a subquery runs per query, and if it isn't a leakproof expression the planner may be unable to push other predicates down.
:::

RLS is the correct answer to "how would you do multi-tenancy," alongside schema-per-tenant and database-per-tenant:

| Approach | Isolation | Operational cost |
| :--- | :--- | :--- |
| `tenant_id` column + RLS | Enforced by the database | Lowest — one schema, one migration |
| Schema per tenant | Strong; separate objects | Migrations × N schemas; catalog bloat past a few thousand |
| Database per tenant | Strongest | Highest; no cross-tenant queries; connection sprawl |

**MySQL has no RLS at all.** There, tenant isolation is views plus discipline, or application-level filtering — which means one missing `WHERE tenant_id = ?` is a data breach rather than an empty result set.

---

## 4. Authentication and `pg_hba.conf`

Connections are matched **top to bottom, first match wins**:

```conf
# TYPE   DATABASE   USER        ADDRESS           METHOD
local    all        postgres                      peer
hostssl  shop       api         10.0.0.0/8        scram-sha-256
hostssl  shop       bi          10.0.1.5/32       scram-sha-256
host     all        all         0.0.0.0/0         reject
```

| Method | Use |
| :--- | :--- |
| `scram-sha-256` | **The default and correct choice** (PG 10+) |
| `md5` | Legacy, weak — migrate off it |
| `peer` | Local socket, OS username must match. Good for admin |
| `cert` | Client TLS certificate |
| `ldap`, `gss`, `radius` | Enterprise SSO |
| `trust` | **No password. Never outside a throwaway container** |
| `reject` | Explicit deny |

`hostssl` requires TLS; `hostnossl` requires its absence; `host` allows either. **Use `hostssl` for anything non-local.**

```sql
SELECT pg_reload_conf();          -- pg_hba.conf changes need a reload, not a restart
SELECT * FROM pg_hba_file_rules;  -- PG 10+: see the parsed rules and any errors
```

TLS on the server:

```conf
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
ssl_min_protocol_version = 'TLSv1.2'
```

On the client, `sslmode=verify-full` is the only setting that actually prevents a man-in-the-middle — `require` encrypts but doesn't verify the certificate or hostname.

---

## 5. SQL injection

```javascript
// ❌ Injectable
db.query(`SELECT * FROM users WHERE email = '${email}'`);

// ✅ Parameterised — the value is never parsed as SQL
db.query('SELECT * FROM users WHERE email = $1', [email]);

// ✅ A list of values, as one array parameter
db.query('SELECT * FROM users WHERE id = ANY($1::bigint[])', [ids]);
```

Parameters are sent separately from the query text, so the value can never become SQL — this is a protocol-level guarantee, not string escaping.

**What parameters cannot do:** identifiers. `SELECT * FROM $1` is not valid. For a dynamic table or column name you must **whitelist** against a known set, or use `format('%I', name)` in a server-side function.

```javascript
// ❌ Injectable via a sort parameter — a very common real-world hole
const sql = `SELECT * FROM orders ORDER BY ${req.query.sort}`;

// ✅ Whitelist
const SORTS = { date: 'placed_on DESC', total: 'total DESC', id: 'id ASC' };
const orderBy = SORTS[req.query.sort] ?? SORTS.id;
```

Other hardening:

- **`statement_timeout`** per role, so one pathological query can't pin a core.
- **Never connect as superuser or table owner** from the application.
- **Column-level grants** so the API role can't read `password_hash` at all.
- **`pgcrypto`** for hashing: `crypt(password, gen_salt('bf', 12))`. Better still, hash in the app so the plaintext never reaches the server or the logs.
- **`pgaudit`** extension for real audit logging.
- **Encryption at rest** is filesystem/volume-level in core Postgres — there's no built-in TDE (managed services like RDS/Cloud SQL provide it at the storage layer). MySQL Enterprise and Percona have InnoDB tablespace encryption; that's a genuine point in MySQL's favour for some compliance regimes.

---

## 6. Rapid-fire recall

<details>
<summary>**Explain PostgreSQL's role model.**</summary>

There's only one object type — a role. A role with `LOGIN` behaves as a user, a role without it behaves as a group, and granting one role to another gives inheritance. Privileges cascade through cluster, database, schema, table and column levels, and you need `USAGE` on a schema before any privilege inside it means anything. That's different from MySQL, where identity is `'user'@'host'` — so `'bob'@'localhost'` and `'bob'@'%'` are two separate accounts — and where roles only arrived in 8.0. Postgres keeps identity and connection rules separate, with the latter in `pg_hba.conf`.
</details>

<details>
<summary>**Why did my grants stop working for a new table?**</summary>

Because `GRANT ... ON ALL TABLES IN SCHEMA` applies only to the tables that exist at that moment; anything created later has no grant. The fix is `ALTER DEFAULT PRIVILEGES FOR ROLE <creator> IN SCHEMA public GRANT ... TO <role>`, and the part people get wrong is `FOR ROLE` — default privileges are keyed to the role that creates the object, so it has to name whoever runs your migrations, not the role receiving the grant.
</details>

<details>
<summary>**What is Row-Level Security and how do you use it for multi-tenancy?**</summary>

RLS attaches policies to a table so the database itself filters rows per user, on every query, regardless of how the query got there. You enable it on the table, add `FORCE` so the owner is subject to it too, and write a policy with a `USING` clause controlling which rows are visible and a `WITH CHECK` clause controlling which values may be written — without the latter, a tenant could update a row to belong to a different tenant. For multi-tenancy the application sets a session variable at the start of each transaction, with `SET LOCAL` so it can't leak across a pooled connection, and the policy compares `tenant_id` against it. MySQL has no equivalent, so there a single missing `WHERE tenant_id = ?` is a data breach.
</details>

<details>
<summary>**What are the ways RLS can fail?**</summary>

Four. The table owner bypasses policies unless you add `FORCE ROW LEVEL SECURITY`, and any role with `BYPASSRLS` — superusers included — ignores them entirely, so the application must connect as neither. Using a plain `SET` instead of `SET LOCAL` for the tenant variable leaves it on the pooled connection for the next request, which can be a different tenant — a catastrophic leak. `current_setting` without the second argument raises an error when the setting is missing rather than failing closed. And performance: the policy predicate is ANDed into every query, so the tenant column must be indexed, ideally as the leading column of your composite indexes.
</details>

<details>
<summary>**How do you prevent SQL injection?**</summary>

Parameterised queries — the values travel separately from the SQL text in the wire protocol, so they can never be parsed as SQL. That's a protocol guarantee, not escaping. What parameters can't cover is identifiers: you can't parameterise a table or column name, so a dynamic `ORDER BY` from a query string must be whitelisted against a fixed map, or built server-side with `format('%I', ...)`. Beyond that, defence in depth: the app never connects as superuser or table owner, column-level grants keep it from even reading a password hash, and per-role `statement_timeout` bounds the blast radius.
</details>

<details>
<summary>**What's in `pg_hba.conf`?**</summary>

The host-based authentication rules: for each combination of connection type, database, user and client address, which authentication method applies. Rules are evaluated top to bottom and the first match wins, including a match that then fails — so ordering matters. I'd use `scram-sha-256` rather than `md5`, `hostssl` rather than `host` for anything non-local so TLS is mandatory, `peer` for local admin access, and never `trust` outside a throwaway container. It takes a reload rather than a restart, and `pg_hba_file_rules` lets you inspect the parsed result before you commit to it.
</details>

---

**Next:** [Replication →](./21-replication.md)
