---
title: PostgreSQL
---

# PostgreSQL

A complete path from *what is MVCC* to *why is my table 400 GB with 30 GB of data* — written so that someone with a few years of full-stack experience can read it end to end and walk into an interview without needing another source.

Every concept page ends with **rapid-fire recall** questions. Every practice question includes a **step-by-step trace** showing exactly what the row set looks like after each clause. And wherever PostgreSQL differs from MySQL, there's an inline **:::info[PostgreSQL vs MySQL]** callout at that exact point — with both sides shown, and no invented differences.

---

## 📚 The curriculum

### Foundations — how PostgreSQL thinks

| | Page | What it answers |
| :-- | :--- | :--- |
| 1 | **[Architecture & Internals](./01-architecture-and-internals.md)** | Process model, MVCC and `xmin`/`xmax`, WAL, shared buffers, TOAST, HOT updates, VACUUM, XID wraparound |
| 2 | **[Data Types](./02-data-types.md)** | `text` vs `varchar`, `numeric` vs `float`, `timestamptz`, UUID, arrays, JSONB, ranges, enums, domains |
| 3 | **[DDL, Constraints & Schemas](./03-ddl-and-constraints.md)** | `IDENTITY` vs `serial`, every constraint, generated columns, transactional DDL, which `ALTER TABLE` rewrites |
| 4 | **[SQL Fundamentals & CRUD](./04-sql-fundamentals.md)** | The logical evaluation order, traced end to end · `RETURNING`, `ON CONFLICT`, `DISTINCT ON`, `NULL` semantics |

### Querying — the row set, traced

| | Page | What it answers |
| :-- | :--- | :--- |
| 5 | **[Joins & Set Operations](./05-joins-and-set-operations.md)** | Which rows duplicate, which drop, `ON` vs `WHERE`, and the three physical join algorithms |
| 6 | **[Aggregation & Grouping](./06-aggregation-and-grouping.md)** | `GROUP BY` traced, `FILTER`, `GROUPING SETS`/`ROLLUP`/`CUBE`, pivoting |
| 7 | **[Window Functions](./07-window-functions.md)** | Frames traced row by row, `ROWS` vs `RANGE`, ranking, `lag`/`lead`, gaps and islands |
| 8 | **[CTEs & Recursive Queries](./08-ctes-and-recursive-queries.md)** | Materialization, the working table traced iteration by iteration, cycle detection |
| 9 | **[Subqueries, LATERAL & EXISTS](./09-subqueries-and-lateral.md)** | `EXISTS` vs `IN` vs `JOIN`, the `NOT IN` NULL trap, `LATERAL` as a `for` loop |

### Advanced data types

| | Page | What it answers |
| :-- | :--- | :--- |
| 10 | **[JSON & JSONB](./10-json-and-jsonb.md)** | Every operator, three indexing strategies, shredding to rows, and when *not* to use it |
| 11 | **[Arrays, Ranges & Composite Types](./11-arrays-and-ranges.md)** | GIN-indexed arrays, exclusion constraints that make double-booking impossible |
| 12 | **[Full-Text Search & Pattern Matching](./12-full-text-search.md)** | `tsvector` traced, ranking and highlighting, `pg_trgm` for indexed `LIKE '%x%'` |

### Performance

| | Page | What it answers |
| :-- | :--- | :--- |
| 13 | **[Indexes](./13-indexes.md)** | B-tree, GIN, GiST, BRIN, hash · composite column order, partial, expression, covering |
| 14 | **[EXPLAIN & the Query Planner](./14-explain-and-the-planner.md)** | Real `EXPLAIN (ANALYZE, BUFFERS)` output read line by line, and the four diagnostic signatures |
| 15 | **[Transactions, Isolation & Locking](./15-transactions-and-locking.md)** | The four anomalies traced, SSI, `SKIP LOCKED`, deadlocks, the DDL lock queue |
| 16 | **[Partitioning](./16-partitioning.md)** | Range/list/hash, pruning proved from `EXPLAIN`, the unique-key rule, retention |
| 17 | **[VACUUM & Performance Playbook](./17-vacuum-and-performance.md)** | Autovacuum tuning, bloat forensics, the "it's slow" runbook, a sane config |

### Programmability

| | Page | What it answers |
| :-- | :--- | :--- |
| 18 | **[Functions, Procedures & PL/pgSQL](./18-functions-and-plpgsql.md)** | Volatility as a correctness decision, error handling, safe dynamic SQL, `SECURITY DEFINER` |
| 19 | **[Triggers & Extensions](./19-triggers-and-extensions.md)** | `BEFORE`/`AFTER`/`INSTEAD OF`, audit trails, `LISTEN`/`NOTIFY`, the extensions worth knowing |

### Operations

| | Page | What it answers |
| :-- | :--- | :--- |
| 20 | **[Roles, Privileges & Security](./20-roles-and-security.md)** | Least privilege, `DEFAULT PRIVILEGES`, Row-Level Security and its four failure modes |
| 21 | **[Replication & High Availability](./21-replication.md)** | Streaming vs logical, slots, sync replication, failover, read-your-writes |
| 22 | **[Backup, PITR & Operations](./22-backup-and-operations.md)** | `pg_dump` vs base backups, point-in-time recovery, major upgrades, what to monitor |

### The comparison

| | Page | |
| :-- | :--- | :--- |
| 23 | **[PostgreSQL vs MySQL](./23-postgresql-vs-mysql.md)** | Architecture, MVCC, SQL features, indexing, replication, performance — and when to pick which |

### Practice — 34 questions, fully traced

| | Page | Covers |
| :-- | :--- | :--- |
| 24 | **[Beginner (Q1–10)](./24-beginner-queries.md)** | Evaluation order, `NULL`, join cardinality, `WHERE` vs `HAVING`, `RETURNING`, `DISTINCT ON` |
| 25 | **[Intermediate (Q11–22)](./25-intermediate-queries.md)** | Window frames, `LATERAL`, `GROUPING SETS`, fan-out, gaps and islands, recursive CTEs, keyset pagination |
| 26 | **[Advanced (Q23–34)](./26-advanced-queries.md)** | JSONB at scale, exclusion constraints, job queues, `EXPLAIN`-driven tuning, partitioning, bloat forensics |

### Interview Prep

| | Page | |
| :-- | :--- | :--- |
| 27 | **[Interview Q&A](./27-interview-qa.md)** | 52 questions with model answers, written the way you'd say them out loud |

---

## 🎯 Suggested paths

**"I have ~3 years of full-stack experience and an interview next week."**
→ [Architecture](./01-architecture-and-internals.md) → [SQL Fundamentals](./04-sql-fundamentals.md) → [Indexes](./13-indexes.md) → [Transactions](./15-transactions-and-locking.md) → [PostgreSQL vs MySQL](./23-postgresql-vs-mysql.md) → [Interview Q&A](./27-interview-qa.md), then work the [Intermediate](./25-intermediate-queries.md) and [Advanced](./26-advanced-queries.md) questions.
MVCC, indexes and isolation are where interviews are won or lost — syntax can be looked up, judgment cannot.

**"I want to actually understand SQL, not memorise syntax."**
→ [SQL Fundamentals](./04-sql-fundamentals.md) → [Joins](./05-joins-and-set-operations.md) → [Aggregation](./06-aggregation-and-grouping.md) → [Window Functions](./07-window-functions.md) → [CTEs](./08-ctes-and-recursive-queries.md), then all 34 practice questions in order. Read every trace.

**"I'm coming from MySQL."**
→ [PostgreSQL vs MySQL](./23-postgresql-vs-mysql.md) first for the map, then [Architecture](./01-architecture-and-internals.md) and [Data Types](./02-data-types.md) for what's genuinely new, then [Indexes](./13-indexes.md) and [Transactions](./15-transactions-and-locking.md) for what will surprise you.

**"I'm the person who gets paged."**
→ [EXPLAIN](./14-explain-and-the-planner.md) → [Transactions & Locking](./15-transactions-and-locking.md) → [VACUUM & Performance](./17-vacuum-and-performance.md) → [Replication](./21-replication.md) → [Backup & Operations](./22-backup-and-operations.md).

**"Start from zero."**
→ Straight through, 1 to 27.

---

## The six sentences this whole section is built around

1. **SQL is written in one order and executed in another** — `FROM → JOIN → WHERE → GROUP BY → HAVING → WINDOW → SELECT → DISTINCT → ORDER BY → LIMIT`. Nearly every confusion follows from this.
2. **Postgres never updates a row in place.** Every update writes a new tuple, which is why readers never block writers — and why VACUUM exists.
3. **Equality, Sort, Range** — composite index column order.
4. **A `WHERE` clause on the right side of a `LEFT JOIN` turns it into an `INNER JOIN`.**
5. **A long-running transaction blocks VACUUM cluster-wide** — one forgotten `BEGIN;` bloats every table.
6. **Replication is for availability and read scaling. It cannot scale writes.**
