---
title: PostgreSQL vs MySQL
---

# PostgreSQL vs MySQL

> Everything the inline callouts said, gathered in one place — plus the architectural comparison that doesn't fit on any single feature page.
>
> This page is deliberately **honest**. MySQL is not a toy, and several things it does are genuinely better. An interview answer that says "Postgres is better at everything" is a weaker answer than one that names two things MySQL does well.

---

## 1. The one-paragraph answer

> PostgreSQL is an **object-relational database built to be extended** — a rich type system, pluggable index access methods, a sophisticated cost-based planner, and strict SQL-standard behaviour. MySQL is a **fast, simple, operationally mature relational database** with a pluggable storage engine architecture and the best-known replication and HA tooling in open source. Postgres wins on correctness, SQL feature depth, complex analytical queries, and extensibility. MySQL wins on connection cost, replication maturity, multi-primary clustering, and the sheer volume of institutional knowledge around running it at scale. For a new application in 2026 I'd default to PostgreSQL, and the honest reason is data type richness and query capability, not raw speed — both are fast.

---

## 2. Architecture

| | PostgreSQL | MySQL (InnoDB) |
| :--- | :--- | :--- |
| Connection model | **Process** per connection (fork) | **Thread** per connection |
| Connection cost | High → PgBouncer is standard | Low → often no pooler |
| Storage engines | One (plus pluggable table AMs since 12) | **Pluggable: InnoDB, MyISAM, MEMORY, MyRocks, Archive** |
| Table organisation | **Heap** — rows unordered, all indexes secondary | **Clustered by PK** — the table *is* the PK B-tree |
| Secondary index entries point to | Physical location (`ctid`) | **The primary key value** → double lookup |
| Cache | `shared_buffers` ~25 % RAM + OS page cache | `innodb_buffer_pool` ~75 % RAM, `O_DIRECT` |
| Write-ahead log | One WAL — recovery **and** replication | **Two**: InnoDB redo log + binlog, needing 2PC between them |
| Namespacing | database → **schema** → table | database **==** schema → table |
| Cross-database queries | ❌ (needs FDW) | ✅ native |

**The heap-vs-clustered difference propagates everywhere.** On MySQL a wide primary key bloats every secondary index because each one embeds it, and PK range scans are physically sequential. On Postgres the PK is just another index, there's no clustering to design around, but index-only scans depend on the visibility map so an unvacuumed table loses them.

---

## 3. MVCC — the deepest difference

| | PostgreSQL | MySQL (InnoDB) |
| :--- | :--- | :--- |
| Old row versions stored | **In the heap**, beside live rows | **In the undo log**, separate from the table |
| `UPDATE` | Writes a whole new tuple | Modifies in place, old version to undo |
| Index maintenance on update | May touch **every** index (unless HOT applies) | Only indexes whose columns changed |
| Cleanup mechanism | **VACUUM / autovacuum** | **Purge thread** truncating undo |
| Failure mode | **Table and index bloat**; transaction ID wraparound | **Undo log growth**; long history list slows reads |
| Rollback cost | **Free** — just never commit the xid | **Expensive** — must undo every change |
| 32-bit XID wraparound risk | ✅ real, needs freezing | ❌ 64-bit transaction IDs |
| Effect of a long transaction | Blocks VACUUM cluster-wide → bloat | Blocks purge → undo growth, slower reads |

**Both engines have the same underlying problem** — old versions must be kept for readers and cleaned up later — and both fail the same way when a transaction is left open. They just fail into different places.

The quotable version: **"Postgres pays for cheap commits and free rollbacks with VACUUM. InnoDB pays for a compact table with a slow rollback and an undo log that can explode."**

---

## 4. SQL features

| Feature | PostgreSQL | MySQL |
| :--- | :--- | :--- |
| Window functions | 8.4 (2009) | 8.0 (2018) |
| CTEs / recursive CTEs | 8.4 | 8.0 |
| `MATERIALIZED` / `NOT MATERIALIZED` CTE control | ✅ | ❌ |
| Data-modifying CTEs (`WITH x AS (DELETE ... RETURNING *)`) | ✅ | ❌ |
| `LATERAL` | 9.3 | 8.0.14 |
| `FULL OUTER JOIN` | ✅ | ❌ emulate with UNION |
| `INTERSECT` / `EXCEPT` | ✅ | 8.0.31 |
| `GROUPING SETS` / `CUBE` | ✅ | ❌ (`WITH ROLLUP` only) |
| `FILTER (WHERE ...)` on aggregates | ✅ | ❌ |
| `DISTINCT ON` | ✅ | ❌ |
| `RETURNING` | ✅ | ❌ |
| `MERGE` | 15+ | ❌ |
| Percentiles / median | ✅ ordered-set aggregates | ❌ |
| `string_agg` result limit | Unlimited | `GROUP_CONCAT` **truncates at 1024 bytes by default** |
| `generate_series` | ✅ | ❌ |
| Table functions in `FROM` | ✅ `RETURNS TABLE`, `SETOF` | ❌ |
| Materialized views | ✅ (manual refresh) | ❌ |
| `INSTEAD OF` triggers on views | ✅ | ❌ |
| Statement-level triggers with transition tables | ✅ | ❌ row-level only |
| Function overloading, default/named args | ✅ | ❌ |
| Multiple procedural languages | ✅ (Python, Perl, JS, Rust, …) | ❌ one |
| Transactional DDL | ✅ | ❌ implicit commit |
| Deferrable constraints | ✅ | ❌ |
| Partial indexes | ✅ | ❌ |
| Expression indexes | ✅ always | 8.0.13 |
| Covering indexes with `INCLUDE` | ✅ | implicit (PK is in every secondary index) |
| Exclusion constraints | ✅ | ❌ |
| Row-Level Security | ✅ | ❌ |
| `SKIP LOCKED` | ✅ | ✅ 8.0.1 |
| Row constructor comparison `(a,b) < (1,2)` | ✅ | ✅ |
| Virtual generated columns | 18+ | 5.7 |

**Where MySQL genuinely leads on features:** virtual generated columns arrived a decade earlier, `JSON_TABLE` is a nicer JSON-shredding API, `JSON_MERGE_PATCH` does deep merge, `JSON_SCHEMA_VALID()` is built in, and MySQL can update a JSON document partially in place. It also has multi-table `UPDATE`, which Postgres lacks.

---

## 5. Data types

| | PostgreSQL | MySQL |
| :--- | :--- | :--- |
| Arrays | ✅ typed, GIN-indexable | ❌ |
| Ranges + multiranges | ✅ | ❌ |
| `jsonb` | ✅ binary, **directly GIN-indexable** | `JSON` binary, **cannot index the column directly** |
| UUID | ✅ native 16-byte type | ❌ `BINARY(16)` + `UUID_TO_BIN()` |
| ENUM | ✅ reusable cluster-level type | Column-level only, compares as an integer |
| Domains | ✅ | ❌ |
| Composite types | ✅ | ❌ |
| Network types (`inet`, `cidr`, `macaddr`) | ✅ with operators | ❌ functions only |
| Geospatial | PostGIS — the industry standard | Built-in `SPATIAL`, far less capable |
| Vector embeddings | `pgvector` with HNSW/IVFFlat | ❌ (8.4 added a basic `VECTOR` type; no mature ANN index ecosystem) |
| `interval` type | ✅ | ❌ syntax only, not storable |
| `UNSIGNED` integers | ❌ (use `CHECK`) | ✅ |
| `numeric` precision | Effectively unlimited | `DECIMAL` capped at 65 digits |
| `TIMESTAMP` range | 4713 BC – 294276 AD | **1970–2038** (32-bit) |
| Default string comparison | **Case-sensitive** | **Case-insensitive** |
| `boolean` | Real type | Alias for `TINYINT(1)` |
| `text` vs `varchar` | Identical, no penalty | Genuinely different types |
| Custom types with operators & indexes | ✅ `CREATE TYPE` + operator classes | ❌ |

---

## 6. Indexing

| | PostgreSQL | MySQL (InnoDB) |
| :--- | :--- | :--- |
| Types | B-tree, **GIN, GiST, BRIN**, Hash, SP-GiST | B-tree, FULLTEXT, SPATIAL (R-tree), multi-valued (JSON arrays) |
| `LIKE '%x%'` indexed | ✅ `pg_trgm` GIN | ❌ never |
| JSON containment indexed | ✅ GIN on the column | ❌ generated column per path |
| Array containment indexed | ✅ GIN | ❌ |
| Range overlap indexed | ✅ GiST | ❌ |
| Huge time-series, tiny index | ✅ BRIN | ❌ |
| Nearest-neighbour `ORDER BY x <-> y` | ✅ GiST | ❌ |
| Partial index | ✅ | ❌ |
| Expression index | ✅ | 8.0.13 |
| Descending index | ✅ | 8.0 |
| Index-only scan requires vacuum | ✅ (visibility map) | ❌ |
| Online index build | `CREATE INDEX CONCURRENTLY` | `ALGORITHM=INPLACE, LOCK=NONE` |

**This is the largest single capability gap in Postgres's favour**, and it's concrete: no indexed substring search, no ad-hoc indexed JSON, no exclusion constraints, no BRIN, no KNN on MySQL.

---

## 7. Transactions and concurrency

| | PostgreSQL | MySQL |
| :--- | :--- | :--- |
| **Default isolation** | `READ COMMITTED` | `REPEATABLE READ` |
| `READ UNCOMMITTED` | Behaves as READ COMMITTED | Real dirty reads |
| `REPEATABLE READ` | True snapshot isolation; **phantoms prevented**; write conflict **errors** | Consistent snapshot for plain reads; locking reads see the latest data; write conflict silently last-wins |
| `SERIALIZABLE` | **SSI — optimistic**, no blocking reads, abort-and-retry | **Pessimistic** — every `SELECT` becomes a shared locking read |
| Gap / next-key locks | ❌ none | ✅ at RR — blocks inserts, causes deadlocks |
| Statement error inside a transaction | **Aborts the whole transaction** | Aborts only the statement |
| Deadlock detection | ✅ | ✅ |
| Advisory locks | `pg_advisory_lock` (integers) | `GET_LOCK()` (strings) |
| DDL in a transaction | ✅ **rollback-safe** | ❌ implicit commit |
| `TRUNCATE` rollback-able | ✅ | ❌ |

The two behavioural traps when porting: **the default isolation level differs**, and **a failed statement aborts the entire transaction on Postgres**, which is why ORMs wrap risky statements in savepoints there.

---

## 8. Replication and HA — where MySQL leads

| | PostgreSQL | MySQL |
| :--- | :--- | :--- |
| Default mechanism | Physical WAL shipping — byte-exact, cannot diverge | Logical binlog events |
| Replica writable | ❌ physical / ✅ logical | ✅ always |
| Multi-source | Via multiple logical subscriptions | ✅ native |
| **Multi-primary** | ❌ (needs BDR / pgEdge / Citus) | ✅ **Group Replication / InnoDB Cluster** |
| **Automated failover** | ❌ external — **Patroni** | ✅ **built in** (InnoDB Cluster + MySQL Router) |
| Parallel apply on replica | Limited (logical only, PG 16+) | ✅ mature multi-threaded applier |
| Cross-version replication | Logical only | ✅ native |
| Filtering by table | Logical publications | ✅ long supported |
| Divergence risk | None (physical is byte-exact) | Statement-based replication could diverge; row-based fixed it |

**Say this plainly in an interview:** MySQL's replication and HA story is more mature. Postgres needs Patroni plus etcd to get what MySQL ships in the box. Postgres's counter-arguments are that physical replication cannot diverge, and that logical replication gives you near-zero-downtime major version upgrades.

---

## 9. Performance — the honest version

There is no general answer. Both are fast; the shape of the workload decides.

| Workload | Tends to favour | Why |
| :--- | :--- | :--- |
| Simple PK lookups, high connection count | **MySQL** | Clustered index means one traversal; cheap threads |
| Read-heavy simple queries | **Tie** | Both saturate on I/O and cache |
| Complex analytical joins and aggregates | **PostgreSQL** | Hash join, merge join, parallel query, better planner |
| Window functions and CTEs at scale | **PostgreSQL** | Longer-standing, better-optimised implementations |
| Write-heavy with many indexes | **MySQL** | In-place update; Postgres may rewrite every index unless HOT applies |
| Update-heavy on a narrow hot row set | **MySQL** | No bloat, no vacuum |
| Append-only time series | **PostgreSQL** | BRIN, partitioning, TimescaleDB |
| Full-text search | **PostgreSQL** | Stemming, weighting, ranking, headlines |
| Geospatial | **PostgreSQL** | PostGIS is not close |
| Semi-structured / unpredictable JSON queries | **PostgreSQL** | Direct GIN indexing of `jsonb` |
| Thousands of concurrent connections | **MySQL** | Threads, not processes |

**The right framing:** "both are fast enough that the bottleneck is almost always your schema, your indexes and your queries — not the engine. I'd pick based on data model fit and operational familiarity."

---

## 10. Choosing

**Pick PostgreSQL when:**

- The data model needs richness — JSON queried in unpredictable ways, arrays, ranges, geospatial, vectors, custom types.
- Queries are analytical: heavy joins, window functions, recursive hierarchies, CTEs.
- Correctness matters: transactional DDL, strict typing, real check constraints, deferrable constraints, exclusion constraints.
- You want extensibility as a hedge — PostGIS, `pgvector`, TimescaleDB, Citus without changing databases.
- Row-Level Security is a real requirement (multi-tenant SaaS).

**Pick MySQL when:**

- The team knows it deeply. Operational familiarity beats feature lists.
- The workload is simple, high-volume OLTP with very many connections.
- You need multi-primary or built-in automated failover without running Patroni.
- The ecosystem requires it — an existing platform, tooling, or a hosting constraint.
- Read replicas need to be writable.

**Migration realities, both directions:** the ports that break are case sensitivity (`WHERE email = 'X'`), `LIMIT`/`OFFSET` versus `LIMIT n, m`, `AUTO_INCREMENT` versus identity, boolean-as-integer (`WHERE flag = 1`), `GROUP BY` with unaggregated columns, implicit type coercion, backtick versus double-quote identifier quoting, the `||` operator, default isolation level, and — structurally — that a **MySQL database maps to a PostgreSQL schema, not a PostgreSQL database.**

---

## 11. Rapid-fire recall

<details>
<summary>**PostgreSQL or MySQL for a new project?**</summary>

PostgreSQL by default, and the reason is data model and query capability rather than speed — both are fast. Native JSONB with direct GIN indexing, arrays, ranges, real enums and domains, exclusion constraints, row-level security, window functions and CTEs that have been mature for a decade longer, and an extension ecosystem that means PostGIS or pgvector is an install rather than a migration. I'd choose MySQL when the team's operational depth is there, when the workload is simple high-volume OLTP with thousands of connections, or when I need multi-primary or built-in automated failover without running Patroni.
</details>

<details>
<summary>**Name three things MySQL genuinely does better.**</summary>

Replication and HA maturity: writable replicas by default, native multi-source, Group Replication for multi-primary, and automated failover built in with InnoDB Cluster and MySQL Router, where Postgres needs Patroni as a separate component. Connection handling: thread-per-connection instead of process-per-connection, so thousands of connections are viable without a pooler. And update-heavy write performance: InnoDB updates in place and only touches the indexes whose columns changed, whereas a Postgres update writes a whole new tuple and may touch every index unless HOT applies — plus MySQL has no VACUUM to tune and no transaction ID wraparound to worry about.
</details>

<details>
<summary>**Explain the MVCC difference.**</summary>

Both keep old row versions so readers never block writers, but they keep them in different places. Postgres stores every version in the table heap and marks superseded ones dead, so it needs VACUUM to reclaim that space and freeze old transaction IDs — the failure modes being table bloat and 32-bit XID wraparound. InnoDB stores old versions in a separate undo log and modifies the row in place, so the table stays compact and a purge thread truncates the undo — the failure modes being undo growth and a slow rollback, since it has to physically undo every change. Postgres rollbacks are free because nothing was overwritten. Both suffer identically from a long-running transaction; they just bloat in different places.
</details>

<details>
<summary>**What breaks when you port a MySQL app to PostgreSQL?**</summary>

Case sensitivity first — MySQL's default collation is case-insensitive, so `WHERE email = 'Foo@X.com'` matches on MySQL and doesn't on Postgres, and the fix is `citext`, a non-deterministic ICU collation, or `lower()` with an expression index. Then boolean-as-integer, since `WHERE is_active = 1` is a type error on Postgres. `GROUP BY` with unaggregated columns, which old MySQL allowed. `LIMIT 10, 20` syntax, backtick quoting, `||` meaning OR, `AUTO_INCREMENT`, `ON DUPLICATE KEY UPDATE`, `INSERT IGNORE`, and `REPLACE INTO`. The default isolation level differs. And structurally, a MySQL database becomes a Postgres *schema*, not a Postgres database, or you lose cross-database joins.
</details>

<details>
<summary>**Which is faster?**</summary>

Neither, in general — the honest answer is that the workload decides and that both are fast enough that the bottleneck is normally the schema, the indexes and the queries. MySQL tends to win on simple primary-key lookups because the table is clustered by the PK so it's one traversal, and on very high connection counts and update-heavy narrow workloads. Postgres tends to win decisively on complex analytical queries, because it has hash joins, merge joins, parallel execution and a stronger planner, and on anything using window functions, recursive CTEs, full-text search, geospatial data or unpredictable JSON access patterns.
</details>

<details>
<summary>**What's the biggest capability gap between them?**</summary>

Index types. InnoDB has B-tree plus FULLTEXT and SPATIAL, and that's it. Postgres adds GIN, GiST, BRIN and SP-GiST, which is why it can index a substring search with `pg_trgm`, index a `jsonb` column directly so you can query keys you didn't anticipate, index range overlap to enforce "no double booking" as a constraint, index a 100 GB time-series table in a couple of hundred kilobytes with BRIN, and do nearest-neighbour ordering. Plus partial indexes, which MySQL has no equivalent of at all and which are what make soft-delete uniqueness expressible.
</details>

---

**Next:** [Practice Questions →](./practice-questions.md) — 34 problems with full step-by-step traces.
