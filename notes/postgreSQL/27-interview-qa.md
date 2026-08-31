---
title: Interview Q&A
---

# Interview Q&A

> Rapid-fire questions with **model answers** — written the way you'd actually say them out loud, not as bullet fragments.
> Organised by the round you'll meet them in. Each answer links back to the page with the full explanation.

:::tip[How to use this page]
Cover the answer, say yours out loud, then compare. The gap between "I know this" and "I can say this fluently under pressure" is the entire difference in an interview.
:::

---

## Round 1 — Fundamentals (screening)

<details>
<summary>**1. What is PostgreSQL and when would you choose it over MySQL?**</summary>

PostgreSQL is an open-source object-relational database with an unusually rich type system and a design built around extensibility — types, operators, index access methods and procedural languages are all pluggable, which is why PostGIS, pgvector and TimescaleDB exist as extensions rather than forks.

I'd choose it when the data model needs richness — JSONB queried in ways I can't predict, arrays, ranges, geospatial data — or when queries are analytical: heavy joins, window functions, recursive hierarchies. Also when correctness matters structurally: transactional DDL means a failed migration leaves nothing behind, and I get real check constraints, deferrable constraints, exclusion constraints and row-level security.

I'd choose MySQL when the team has deep operational experience with it, when the workload is simple high-volume OLTP with thousands of connections — its thread-per-connection model handles that better than Postgres's process-per-connection — or when I need multi-primary replication or built-in automated failover without running Patroni. "Which is faster" isn't a real question; both are fast enough that the bottleneck is the schema and the queries.

📖 [PostgreSQL vs MySQL](./23-postgresql-vs-mysql.md)
</details>

<details>
<summary>**2. Explain MVCC.**</summary>

Every row version carries two hidden columns: `xmin`, the transaction that created it, and `xmax`, the transaction that superseded it. A transaction takes a snapshot, and a version is visible to it if `xmin` is committed and in that snapshot and `xmax` is either zero or not visible. So an `UPDATE` never modifies in place — it writes a new tuple and stamps `xmax` on the old one.

The payoff is that readers never block writers and writers never block readers: a plain `SELECT` takes no row locks at all, which is why a long analytical query doesn't stall an OLTP workload. The cost is that obsolete versions accumulate in the heap and must be reclaimed by VACUUM.

That's also where Postgres and InnoDB diverge. InnoDB keeps old versions in a separate undo log and updates rows in place, so the table stays compact but a rollback is expensive because it has to physically undo every change. Postgres rollbacks are free — you just never commit the transaction id.

📖 [Architecture §3](./01-architecture-and-internals.md)
</details>

<details>
<summary>**3. Why does PostgreSQL need VACUUM?**</summary>

Because of where MVCC keeps old row versions. Postgres stores them in the table heap alongside live rows, so a dead tuple occupies space in the table and its indexes until something reclaims it — and that's VACUUM. It does four jobs: marks dead space reusable, updates the visibility map so index-only scans work, updates the free space map, and freezes old transaction ids to prevent wraparound.

InnoDB doesn't need it because old versions live in the undo log and a purge thread truncates that instead. Same problem, solved in a different place: Postgres pays with table bloat, InnoDB pays with undo growth and slow rollbacks.

The operational corollary is that autovacuum's defaults are tuned for small tables — a 20 % scale factor means a hundred-million-row table waits for twenty million dead tuples — so on large tables you lower it per table and raise `autovacuum_vacuum_cost_limit`, which by default is an I/O throttle sized for very old hardware.

📖 [VACUUM & Performance §1–2](./17-vacuum-and-performance.md)
</details>

<details>
<summary>**4. Recite the logical order of SQL evaluation.**</summary>

`FROM`, then `JOIN` and `ON`, then `WHERE`, then `GROUP BY`, then `HAVING`, then window functions, then `SELECT` — which is where aliases are created — then `DISTINCT`, then `ORDER BY`, then `LIMIT` and `OFFSET`.

Everything confusing about SQL falls out of that. You can't use a `SELECT` alias in `WHERE` because `SELECT` hasn't run yet; you can in `ORDER BY` because it has. `WHERE` can't reference an aggregate because grouping hasn't happened; `HAVING` can. And you can't filter on a window function in `WHERE` at all — you need a subquery or CTE, because windows are computed after filtering.

📖 [SQL Fundamentals §1](./04-sql-fundamentals.md)
</details>

<details>
<summary>**5. `text` vs `varchar(n)` vs `char(n)`?**</summary>

`text` and `varchar(n)` have identical storage and performance in PostgreSQL — `varchar(n)` is literally `text` with a length check — so I default to `text` and add an explicit `CHECK` constraint if a genuine business limit exists. `char(n)` blank-pads to the declared length, and that padding shows up in concatenation but not in `length()`, so it's a trap with no upside.

Worth flagging that this is Postgres-specific: on MySQL, `TEXT` and `VARCHAR` are genuinely different types with different indexing and temp-table behaviour, so the instinct people bring from MySQL doesn't apply.

📖 [Data Types §3](./02-data-types.md)
</details>

<details>
<summary>**6. `timestamp` or `timestamptz`?**</summary>

Always `timestamptz`. It stores an absolute instant — internally UTC — converting from the session time zone on input and back on output. `timestamp` stores a naive wall-clock reading with no zone, so the same stored value means different instants for different users, which is almost always a bug.

The nuance people miss is that `timestamptz` does not store *which* time zone the value came from. If you need that — say, to render a booking in the venue's local time — you store the zone name in a separate column. And the only genuine `timestamp` use case is a wall clock with no instant meaning, like an alarm that should fire at 07:00 wherever you are.

📖 [Data Types §4](./02-data-types.md)
</details>

---

## Round 2 — Querying

<details>
<summary>**7. `WHERE` vs `HAVING`?**</summary>

`WHERE` filters individual rows before grouping, so it can use an index and cannot reference aggregates. `HAVING` filters groups after aggregation, so it can reference `sum()` and `count()` but not individual row values.

They answer genuinely different questions. "Total of paid orders per customer" is a `WHERE` — it changes which rows go into the sum. "Customers whose total exceeds a thousand" is a `HAVING` — it aggregates everything, then discards groups. Most production queries want both: a `WHERE` for the date range and status, and a `HAVING` for the threshold.

📖 [Aggregation §2](./06-aggregation-and-grouping.md), [Q6](./24-beginner-queries.md)
</details>

<details>
<summary>**8. I put a filter on the right table of a LEFT JOIN and lost rows. Why?**</summary>

Because `WHERE` runs after the join is formed, and a NULL-filled row from an unmatched left row can never satisfy a predicate on the right table — `NULL = 'paid'` is NULL, not true. So the outer join is silently converted into an inner join.

The rule is: a condition that restricts *which rows are eligible to match* belongs in `ON`; a condition that filters *the final result* belongs in `WHERE`. The one legitimate `WHERE` on the right side is `IS NULL`, which is how you express an anti-join — "customers with no orders." This is identical on MySQL; it's SQL semantics, not a dialect quirk.

📖 [Joins §3](./05-joins-and-set-operations.md), [Q5](./24-beginner-queries.md)
</details>

<details>
<summary>**9. Why does `NOT IN` sometimes return nothing?**</summary>

Because `x NOT IN (1, 2, NULL)` expands to `x <> 1 AND x <> 2 AND x <> NULL`, and comparing anything to NULL yields NULL, so the whole expression evaluates to NULL rather than true — and NULL isn't a match, so no rows come back. If the subquery can produce a single NULL, the query silently returns zero rows.

The fix is `NOT EXISTS`, which has correct existence semantics, isn't affected by NULLs, and usually gets a proper anti-join plan too. I'd go further and say I never write `NOT IN` against a subquery, regardless of whether the column is nullable today.

📖 [Subqueries §2](./09-subqueries-and-lateral.md)
</details>

<details>
<summary>**10. Explain window functions and how they differ from `GROUP BY`.**</summary>

A window function computes an aggregate or ranking over a set of rows related to the current row and returns one value per input row, rather than collapsing rows. Six rows in, six rows out, each carrying its group's total or its rank or the previous row's value. `GROUP BY` destroys the detail; a window keeps it.

The anatomy is `PARTITION BY` to divide rows into independent groups, `ORDER BY` to sequence them within a partition, and a frame clause defining which subset of the ordered partition the current row actually aggregates over.

The practical tell: if you're joining a table back to a grouped version of itself just to put the total next to each row, you wanted a window function.

📖 [Window Functions §1](./07-window-functions.md)
</details>

<details>
<summary>**11. `ROWS` vs `RANGE` in a window frame?**</summary>

`ROWS` counts physical rows. `RANGE` works on the `ORDER BY` *values*, so all rows sharing an ordering value — peers — get the same frame.

This matters because the default frame when you write `ORDER BY` is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. So a "running total by day" gives every row on the same day the identical cumulative value — a step function, not a running total. Real data always has duplicate dates, so I write `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` explicitly.

`RANGE` does earn its keep for genuine value windows: `RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW` is a real rolling seven-day sum, which `ROWS` cannot express because it counts rows, not days.

📖 [Window Functions §5](./07-window-functions.md)
</details>

<details>
<summary>**12. `row_number()` vs `rank()` vs `dense_rank()`?**</summary>

`row_number()` always assigns distinct consecutive integers, so ties are broken arbitrarily — non-deterministically, unless you add a unique tiebreaker to the `ORDER BY`. `rank()` gives ties the same number and then skips: 1, 2, 2, 4. `dense_rank()` gives ties the same number without skipping: 1, 2, 2, 3.

I use `row_number()` for pagination and exactly-one-per-group, `rank()` for a leaderboard where joint second should be followed by fourth, and `dense_rank()` for "the top three distinct salary levels." And whenever `row_number()` drives something destructive — a dedup delete, say — the unique tiebreaker isn't optional, because otherwise re-running it can keep a different row.

📖 [Window Functions §7](./07-window-functions.md)
</details>

<details>
<summary>**13. How do you get the top N rows per group?**</summary>

Three ways, and the choice is a cost decision. A window function — `row_number()` partitioned by the group in a CTE, filtered to `rn <= N` — reads and ranks the whole table, then discards most of it. `LATERAL` with a `LIMIT` inside runs one indexed lookup per group reading exactly N rows, so with few groups, a large table and an index on `(group, sort)` it's dramatically faster. And for N equal to one, Postgres's `DISTINCT ON` is shortest and usually fastest of all.

The trade-off is "index-driven loop over few groups" versus "one full ranking pass" — many groups relative to table size, or no usable index, flips it back to the window function.

📖 [Q13](./25-intermediate-queries.md), [Subqueries §5](./09-subqueries-and-lateral.md)
</details>

<details>
<summary>**14. What is `LATERAL`?**</summary>

Normally a subquery in the `FROM` clause can't reference the tables listed beside it — they're evaluated independently. `LATERAL` lifts that restriction, so the subquery runs once per outer row with that row's columns in scope. Effectively a `for` loop in SQL.

It's what lets you write "the three most recent orders for each customer" with a `LIMIT` inside the subquery, which a plain join can't express. It's also how you expand a set-returning function per row — `unnest` on an array column, or `jsonb_array_elements` on a JSON array. Use `LEFT JOIN LATERAL ... ON true` when you need to keep outer rows whose subquery returned nothing. It exists in MySQL 8.0.14+ too, though MySQL has far fewer set-returning functions to pair it with.

📖 [Subqueries §5](./09-subqueries-and-lateral.md)
</details>

<details>
<summary>**15. My `sum()` tripled after I added a join. What happened?**</summary>

Fan-out. Joining a parent to two independent one-to-many children multiplies the row counts — two orders and three payments give six rows — so each order amount is counted three times and each payment twice. Both numbers are wrong, and nothing errors, which makes it the most dangerous class of SQL bug.

The fix is to make each branch contribute exactly one row per parent: pre-aggregate each child in its own subquery and join those, or use `LATERAL`, or scalar subqueries when there are only one or two values. The diagnostic is simple — if `sum(x)` changes when you add an unrelated join, you have fan-out.

📖 [Joins §10](./05-joins-and-set-operations.md), [Q18](./25-intermediate-queries.md)
</details>

<details>
<summary>**16. Explain recursive CTEs.**</summary>

The anchor term runs once and its rows become both the initial result and the initial working table. Then the recursive term runs repeatedly, and crucially the CTE's name inside it refers only to the *previous iteration's* output — the working table — not the accumulated result. Rows it produces are appended to the result and become the new working table. When an iteration produces nothing, it stops. That's why it's naturally breadth-first, one level per iteration.

The canonical use is hierarchy traversal: anchor on the roots where `parent_id IS NULL`, then join the table to the CTE on `child.parent_id = cte.id`, carrying a depth counter and a path array. Flip the join direction and you get ancestors instead of descendants.

The safety note is that PostgreSQL has **no default recursion limit**, so a cycle runs until it exhausts disk. I always carry the visited path in an array and check membership, or use PG 14's `CYCLE` clause. MySQL caps at `cte_max_recursion_depth`, which stops the runaway but doesn't help you detect the cycle.

📖 [CTEs §3–6](./08-ctes-and-recursive-queries.md), [Q20](./25-intermediate-queries.md)
</details>

<details>
<summary>**17. Are CTEs slower than subqueries?**</summary>

They used to be, always. Before PostgreSQL 12 every CTE was an optimisation fence — fully materialised, with no predicate pushdown — so `WITH t AS (SELECT * FROM orders) SELECT * FROM t WHERE id = 5` read the entire table. From 12 onwards a CTE that's referenced once, isn't recursive and has no side effects is inlined like a subquery, so the difference is usually gone.

You can still force either behaviour with `AS MATERIALIZED` or `AS NOT MATERIALIZED`, and that's worth doing when an expensive CTE is referenced several times and you want it computed once. MySQL has no equivalent control.

📖 [CTEs §2](./08-ctes-and-recursive-queries.md)
</details>

---

## Round 3 — Indexes and Performance

<details>
<summary>**18. Name the index types and one use for each.**</summary>

B-tree for equality, ranges and ordering — the default and almost always the answer. GIN as an inverted index for when one row holds many values: arrays, `jsonb` containment, full-text `tsvector`, and trigrams that make `LIKE '%x%'` indexable. GiST for overlapping and spatial data — range overlap, PostGIS geometry, exclusion constraints, and nearest-neighbour ordering with the distance operator. BRIN for very large tables whose column correlates with physical row order, like an append-only timestamp — kilobytes where a B-tree would be gigabytes. Hash for equality on a very large key, rarely worth it. And SP-GiST for prefix structures like IP ranges.

Worth adding that InnoDB has B-tree only, plus FULLTEXT and SPATIAL — that's the single biggest concrete capability gap between the two engines.

📖 [Indexes §6](./13-indexes.md)
</details>

<details>
<summary>**19. How do you order the columns in a composite index?**</summary>

Equality predicates first, then the `ORDER BY` columns, then range predicates last. Equality pins the leading keys to a single value, which makes everything after that point a contiguous, already-sorted region of the index — so a sort key placed immediately after the equality columns is satisfied for free. A range spans many values of its key, which interleaves the ordering of every column after it, so ranges must come last.

For `WHERE status = 'paid' AND amount > 500 ORDER BY placed_on DESC`, the index is `(status, placed_on DESC, amount)`. Put `amount` before `placed_on` and the plan grows a blocking sort. It's B-tree physics, so it's identical on MySQL — MongoDB people know it as the ESR rule.

📖 [Indexes §2](./13-indexes.md)
</details>

<details>
<summary>**20. What's a partial index?**</summary>

An index with a `WHERE` clause, so it contains only matching rows — smaller, faster to scan, and cheaper to maintain on writes. The two big uses are indexing a rare value in a huge table, like the pending rows of a job queue where 99.9 % are done, and partial *unique* indexes: "only one active subscription per user," or "email unique among rows where `deleted_at IS NULL`."

The caveat is that the planner has to prove the query's predicate implies the index's predicate, so a parameterised `status = $1` can't use it — the value isn't known at plan time.

MySQL has no partial indexes at all, which is why soft deletes plus uniqueness is genuinely awkward there.

📖 [Indexes §3](./13-indexes.md)
</details>

<details>
<summary>**21. What's an index-only scan, and what breaks it in PostgreSQL specifically?**</summary>

A scan that answers the query entirely from the index without visiting the heap, which requires every referenced column to be in the index — as a key column or via `INCLUDE`.

What breaks it in Postgres is visibility. Because of MVCC, an index entry doesn't record whether that row version is visible to your snapshot, so Postgres consults the visibility map; if the page isn't marked all-visible, it fetches the heap tuple anyway. So a table that isn't being vacuumed shows a high `Heap Fetches` count and gets little benefit. That concern doesn't exist on InnoDB, where a covering index scan needs no visibility check.

📖 [Indexes §5](./13-indexes.md)
</details>

<details>
<summary>**22. How do you read an `EXPLAIN ANALYZE` plan?**</summary>

Inside-out and bottom-up — the most indented node runs first and feeds its parent. For each node I compare estimated rows against actual rows, because a large gap means the planner is misinformed and every decision above that node is suspect. Then I look for `Rows Removed by Filter`, which is work read and thrown away and usually means a missing or incomplete index; for `Sort Method: external merge` or `Batches > 1`, which means it spilled because `work_mem` was too small; and at `Buffers` to see whether the I/O came from cache or disk.

The thing you must not forget is `loops`: `actual time=0.03 rows=3 loops=6000` is 180 milliseconds and 18,000 rows, not three rows in a fraction of a millisecond. And I always run it with `BUFFERS`.

📖 [EXPLAIN §2–5](./14-explain-and-the-planner.md)
</details>

<details>
<summary>**23. Estimated rows is 1, actual is 50,000. What do you do?**</summary>

First `ANALYZE`, since stale statistics are the most common cause. If it persists, I look at why. Correlated columns are the classic: the planner assumes independence and multiplies selectivities, so filtering on both city and state gives a wildly low estimate — that's what `CREATE STATISTICS ... (dependencies, ndistinct, mcv)` exists for. A skewed distribution needs a higher per-column statistics target so the most-common-values list and histogram are finer. Expressions and JSONB containment get fixed default guesses unless there's a matching expression index or a promoted generated column.

It matters because everything above that node is costed against the wrong number, which is how you end up with a nested loop running 50,000 times.

📖 [EXPLAIN §5](./14-explain-and-the-planner.md)
</details>

<details>
<summary>**24. My query isn't using the index. Walk me through debugging it.**</summary>

A checklist. Is the table small enough that a sequential scan is genuinely cheaper — which is correct behaviour, not a bug. Is the predicate sargable, or is there a function or arithmetic wrapped around the column, in which case I need an expression index or a rewrite. Is there a type mismatch forcing a cast on the column side. Is the query returning a large fraction of the table, where a scan legitimately wins. Are the statistics stale. Is the leading column of the composite index actually used. Is a partial index's predicate provably implied. Is it a `LIKE 'x%'` needing `text_pattern_ops` outside the C locale. Is the index invalid from a failed `CONCURRENTLY` build.

Then I'd `SET enable_seqscan = off` for the session and compare the two plans' actual times. If the index plan really is faster, the cost model is misinformed — usually stale statistics, or `random_page_cost` left at the spinning-disk default of 4.0 when it should be about 1.1 on SSD.

📖 [Indexes §8](./13-indexes.md)
</details>

<details>
<summary>**25. Which three settings would you change on a fresh install?**</summary>

`shared_buffers` to about 25 % of RAM — note that's much lower than MySQL's `innodb_buffer_pool_size` guidance, because Postgres deliberately leans on the OS page cache too. `effective_cache_size` to about 75 % of RAM, which allocates nothing; it just tells the planner how much data is likely cached, which also encourages index use. And `random_page_cost` down from 4.0 to around 1.1 on SSD, which is probably the single highest-impact change and fixes more "why isn't it using my index" reports than anything else.

After that I'd raise `autovacuum_vacuum_cost_limit`, turn on `pg_stat_statements` and `auto_explain`, and set `idle_in_transaction_session_timeout` so one forgotten transaction can't bloat the whole cluster.

📖 [VACUUM & Performance §8](./17-vacuum-and-performance.md)
</details>

<details>
<summary>**26. Why is `OFFSET` pagination bad?**</summary>

Because the server generates and discards every row before the offset — page 5,000 costs a hundred thousand rows of work to return twenty. It's also unstable: a row inserted between page loads shifts everything down, so the user sees a duplicate at the top of the next page and never sees one row.

Keyset pagination filters on the last row of the previous page instead — `WHERE (placed_on, id) < ($1, $2) ORDER BY placed_on DESC, id DESC LIMIT 20` — which maps directly onto a composite index and is constant cost per page. The trade-off is you can't jump to an arbitrary page number, which almost no real UI needs. Row constructor comparison works on MySQL 8 too, so this is portable.

📖 [VACUUM & Performance §7](./17-vacuum-and-performance.md), [Q21](./25-intermediate-queries.md)
</details>

---

## Round 4 — Transactions and Concurrency

<details>
<summary>**27. What's PostgreSQL's default isolation level, and how does it differ from MySQL's?**</summary>

Postgres defaults to `READ COMMITTED`, MySQL to `REPEATABLE READ`. That means identical application code behaves differently: on Postgres two `SELECT`s in the same transaction can return different data, on MySQL they won't. It's one of the most consequential silent differences when porting, in both directions.

There's a second difference at `REPEATABLE READ` itself. Postgres implements it as true snapshot isolation, so phantoms are prevented — stronger than the SQL standard requires — and a write conflict raises `could not serialize access`, which the application must retry. MySQL prevents phantoms for plain reads via the consistent snapshot, but locking reads see the latest committed data, and a write conflict silently lets the last writer win.

📖 [Transactions §3](./15-transactions-and-locking.md)
</details>

<details>
<summary>**28. Explain the four anomalies.**</summary>

A dirty read is seeing uncommitted data — impossible in Postgres at any level, because MVCC only ever exposes committed row versions; `READ UNCOMMITTED` is accepted as syntax and behaves as `READ COMMITTED`. A non-repeatable read is re-reading a row and getting a different value because someone committed in between. A phantom read is re-running the same query and getting extra rows.

A serialization anomaly is subtler: each transaction is individually correct, but their interleaving produces a state no serial order could. The canonical case is write skew — two doctors each check that at least one other doctor is on call, see two, and each go off call. They wrote different rows, so there's no update conflict to detect, and row locks don't help. Only `SERIALIZABLE` catches it.

📖 [Transactions §2](./15-transactions-and-locking.md)
</details>

<details>
<summary>**29. How does PostgreSQL implement `SERIALIZABLE`?**</summary>

Serializable Snapshot Isolation — snapshot isolation plus tracking of read/write dependencies between concurrent transactions. It takes predicate locks recording what each transaction read, but those locks never block anything; when Postgres detects a dependency cycle that could produce a non-serializable outcome, it aborts one transaction with a serialization failure.

So it's optimistic: no blocking reads, but every application using it must implement retry with backoff on SQLSTATE 40001. MySQL's `SERIALIZABLE` is the opposite — it turns every plain `SELECT` into a shared locking read, so it's pessimistic and blocks heavily. Same name, completely different performance profile.

📖 [Transactions §3](./15-transactions-and-locking.md)
</details>

<details>
<summary>**30. How would you build a job queue?**</summary>

A `jobs` table with a partial index on the pending rows, and a claim query that selects `WHERE status = 'pending' ORDER BY priority DESC, created_at FOR UPDATE SKIP LOCKED LIMIT n` inside a CTE, with an `UPDATE ... RETURNING` marking them as processing — all in one statement.

`SKIP LOCKED` is what makes it work: concurrent workers skip rows another worker has locked instead of queueing behind them, so N workers scale linearly with no duplicates. Without it, worker B blocks on worker A and you've built a queue of workers, not a queue of jobs. Then a sweeper resets rows stuck in processing past a visibility timeout, which handles worker crashes.

Two design notes: the partial index keeps the structure tiny on a huge table, and the claim transaction must be short — never hold it open while the job runs, or you pin the xmin horizon. `SKIP LOCKED` exists in MySQL 8 too, so the design is portable, though the partial index isn't.

📖 [Transactions §4](./15-transactions-and-locking.md), [Q26](./26-advanced-queries.md)
</details>

<details>
<summary>**31. What causes deadlocks and how do you prevent them?**</summary>

Two transactions acquiring the same locks in opposite orders, so each waits on the other. Postgres detects the cycle after `deadlock_timeout` and aborts one with SQLSTATE 40P01.

The single most effective prevention is acquiring locks in a consistent order — sort the ids before updating them, so both transactions request the lowest first and one simply waits rather than forming a cycle. Beyond that: keep transactions short and never hold one across a network call or user interaction, touch fewer rows, use `SKIP LOCKED` for queue patterns, and retry on deadlock, because in a concurrent system deadlocks are an expected condition rather than a defect.

One MySQL-specific note: its gap locks at `REPEATABLE READ` lock the ranges between index entries to prevent phantoms, which creates a whole class of deadlocks that can't happen on Postgres, since Postgres has no gap locking.

📖 [Transactions §5](./15-transactions-and-locking.md)
</details>

<details>
<summary>**32. How do you run `ALTER TABLE` on a busy production table?**</summary>

Set `lock_timeout` first — a few seconds — and retry in a loop. The reason is that most `ALTER TABLE` forms need `ACCESS EXCLUSIVE`, and lock requests queue in FIFO order: if a long-running `SELECT` holds `ACCESS SHARE`, the ALTER waits, and every query arriving after it waits behind the ALTER, including ones that wouldn't have conflicted with the original. A one-millisecond DDL statement becomes a site-wide outage. With `lock_timeout` it fails fast and you try again.

For the change itself I'd know which forms rewrite: adding a nullable column or one with a constant default is instant since PG 11, but a volatile default like `gen_random_uuid()` rewrites the whole table, so you add it nullable, backfill in batches, add a `CHECK (col IS NOT NULL) NOT VALID`, `VALIDATE` it without blocking writes, then `SET NOT NULL` — which is instant in PG 12+ because the validated check proves it. And indexes go in with `CREATE INDEX CONCURRENTLY`.

📖 [DDL §7](./03-ddl-and-constraints.md), [Transactions §4](./15-transactions-and-locking.md)
</details>

<details>
<summary>**33. Optimistic or pessimistic locking?**</summary>

The first thing I'd check is whether either is needed. If the new value can be expressed in terms of the old one — `UPDATE accounts SET balance = balance - 100 WHERE id = 1 AND balance >= 100 RETURNING balance` — the read and the write are the same statement and there's no race to manage at all. Zero rows affected means insufficient funds.

If application logic has to run in between and conflicts are likely, pessimistic: `SELECT ... FOR UPDATE`, acquiring locks in a consistent order. If conflicts are rare and I don't want to hold locks across a user's think time, optimistic: a version column in the `WHERE` clause, with retry when zero rows are affected. And if the invariant spans multiple rows that different transactions write — write skew — none of those help and you need `SERIALIZABLE` plus retry.

📖 [Transactions §6](./15-transactions-and-locking.md), [Q29](./26-advanced-queries.md)
</details>

---

## Round 5 — Data Modelling and Postgres-specific features

<details>
<summary>**34. `json` or `jsonb`, and how do you index it?**</summary>

`jsonb` essentially always. It parses once at write time into a binary form, so reads are fast, it supports containment and existence operators, and — decisively — it can be GIN-indexed. `json` stores the exact input text, reparses on every access, can't be indexed, and has no equality operator so you can't even `GROUP BY` it. The only case for `json` is byte-exact fidelity, like a payload whose signature covers the exact bytes.

For indexing there are three options. A GIN index on the column supports containment and key existence for arbitrary keys — use `jsonb_path_ops` if you only need containment, since it's two to three times smaller. A B-tree on an expression like `(payload ->> 'type')` is much smaller and is the only option supporting range queries and ordering. And if I'm indexing the same key in every query, that key probably shouldn't be in the JSON at all — I'd promote it to a `STORED` generated column, which also gives the planner real statistics, since JSONB has none per key.

📖 [JSON & JSONB §5](./10-json-and-jsonb.md)
</details>

<details>
<summary>**35. When should you *not* use JSONB?**</summary>

When the data has a known shape. JSONB gives you no per-key statistics, so the planner's estimates for containment are fixed guesses, and bad estimates produce bad join plans upstream. It also gives no foreign keys, no per-key `NOT NULL`, larger storage, and TOAST decompression on every access to a large document — so `SELECT *` on a table with big JSONB blobs is far more expensive than selecting the columns you need.

So anything I filter on constantly, join on, or need integrity guarantees for belongs in a real column. The pragmatic answer is hybrid: promote the hot keys to generated columns and index those, keep the genuinely variable remainder in JSONB. JSONB is for variable structure, not for avoiding schema design.

📖 [JSON & JSONB §6](./10-json-and-jsonb.md)
</details>

<details>
<summary>**36. What's an exclusion constraint?**</summary>

A generalisation of a unique constraint. Instead of "no two rows are equal on these columns," it says "no two rows satisfy these operators pairwise." Combined with range types, `EXCLUDE USING GIST (room_id WITH =, during WITH &&)` expresses "no two bookings may share a room and overlap in time" as a single declarative constraint, enforced by a GiST index at write time.

What makes it valuable rather than merely elegant is concurrency. The application-level version — select to check for overlaps, then insert — has a time-of-check-to-time-of-use race that two simultaneous requests can both pass. The exclusion constraint makes that structurally impossible, and the same index answers your availability queries. There's no MySQL equivalent at all.

📖 [Arrays & Ranges §2](./11-arrays-and-ranges.md), [Q24](./26-advanced-queries.md)
</details>

<details>
<summary>**37. When would you use an array column?**</summary>

For a small, bounded, read-mostly set of scalars with no attributes of their own and no referential integrity requirement — tags on a post. It saves a join and GIN-indexes well, though the query has to use `tags @> ARRAY['x']` rather than the natural-reading `'x' = ANY(tags)`, which can't use the index.

I'd switch to a junction table the moment elements need their own columns, need a foreign key, are updated individually at high frequency, or grow unbounded. The decisive fact is that array elements cannot have foreign keys, so if referential integrity matters the answer is a table. It's worth being explicit in an interview that an array column is denormalisation, and saying when you wouldn't use one.

📖 [Arrays & Ranges §1](./11-arrays-and-ranges.md)
</details>

<details>
<summary>**38. `serial` or `IDENTITY`? And why are there gaps in my ids?**</summary>

`GENERATED ALWAYS AS IDENTITY` for new work. `serial` isn't a real type — it's shorthand that creates a sequence and a column default — it's non-standard, and it lets anyone insert an explicit id without advancing the sequence, which eventually causes duplicate-key errors on a table that used to work. `ALWAYS` prevents exactly that. Use `bigint` either way.

Gaps are normal and expected. `nextval()` is deliberately non-transactional — it doesn't roll back — because rolling it back would force every concurrent inserter to serialise on the sequence. So a rolled-back transaction burns its id permanently, and sequence caching produces larger gaps still. If you genuinely need gapless numbering, like invoice numbers in some jurisdictions, you need a counter table with row locking and you accept the serialisation.

📖 [DDL §2](./03-ddl-and-constraints.md)
</details>

<details>
<summary>**39. How would you implement multi-tenancy?**</summary>

Three options. A `tenant_id` column with Row-Level Security is my default: policies enforce isolation in the database on every query regardless of code path, so one missing `WHERE tenant_id = ?` is an empty result set rather than a data breach. Schema-per-tenant gives stronger isolation and works into the low thousands of tenants before catalog bloat and migration time hurt. Database-per-tenant is strongest and most expensive, with no cross-tenant queries and connection sprawl.

With RLS the details matter: `FORCE ROW LEVEL SECURITY` so the table owner is subject to it, the app connecting as neither the owner nor a superuser, a `WITH CHECK` clause so a tenant can't reassign a row to another tenant, and — critically — `SET LOCAL` rather than `SET` for the tenant variable, because a plain `SET` persists on a pooled connection and the next request may be a different tenant. And `tenant_id` must be indexed, ideally as the leading column, since the policy predicate is ANDed into every query.

📖 [Roles & Security §3](./20-roles-and-security.md)
</details>

<details>
<summary>**40. How does full-text search work in PostgreSQL, and when would you move to Elasticsearch?**</summary>

`to_tsvector` parses text into tokens, drops stop words, and stems each to a lexeme, producing a sorted set of lexemes with positions. `tsquery` is a boolean expression over lexemes, and `@@` tests a match — both sides stemmed, so "running" matches "ran." In production I store a `tsvector` as a generated column combining title and body with `setweight` so titles outrank body text, GIN-index it, query with `websearch_to_tsquery` because `to_tsquery` throws a syntax error on user input, and rank with `ts_rank_cd`.

The performance caveat is that ranking isn't indexable — the index finds the matches, then `ts_rank` evaluates for every one of them before sorting, so a query matching half a million documents ranks half a million documents.

I'd move to Elasticsearch when search stops being a feature and becomes the product: tens of millions of documents, heavy query volume, or requirements like faceting, per-field analyzers and learning-to-rank. Below that, Postgres wins on operational simplicity, and specifically on transactional consistency — the index updates in the same transaction as the row, so there's no sync pipeline, no lag, and nothing to reindex after a failure.

📖 [Full-Text Search](./12-full-text-search.md)
</details>

---

## Round 6 — Operations

<details>
<summary>**41. A table keeps bloating even though autovacuum is running. Why?**</summary>

Because VACUUM can't remove a tuple that might still be visible to some running snapshot, and something is holding the xmin horizon back. Four candidates: a long-running transaction, a session sitting idle-in-transaction — by far the most common — an inactive replication slot whose consumer went away, or an orphaned prepared transaction. All four are visible in `pg_stat_activity`, `pg_replication_slots` and `pg_prepared_xacts`.

Note the scope: one forgotten `BEGIN;` blocks reclamation in *every* table in the cluster, not just the one being queried. The standing fixes are `idle_in_transaction_session_timeout`, `max_slot_wal_keep_size`, and alerting on any inactive replication slot. To reclaim the space afterwards, `pg_repack`, never `VACUUM FULL` on a live table.

📖 [VACUUM & Performance §3](./17-vacuum-and-performance.md), [Q34](./26-advanced-queries.md)
</details>

<details>
<summary>**42. What is transaction ID wraparound?**</summary>

Transaction ids are 32-bit and visibility is a modulo comparison, so an id more than about two billion transactions old would wrap around and appear to be in the future, making committed rows suddenly invisible. Postgres prevents this by freezing — marking sufficiently old tuples unconditionally visible — during vacuum, and autovacuum forces an anti-wraparound vacuum once a table's `relfrozenxid` age exceeds `autovacuum_freeze_max_age`.

If it's ignored long enough the cluster refuses new write transactions and demands a single-user-mode vacuum, which is a famous class of outage. The causes are always one of: autovacuum disabled, a long-running or idle-in-transaction session, an abandoned replication slot, or an orphaned prepared transaction. You monitor it with `age(relfrozenxid)` per table.

It's a genuinely Postgres-specific risk — InnoDB uses 64-bit transaction ids and has no equivalent.

📖 [Architecture §6](./01-architecture-and-internals.md)
</details>

<details>
<summary>**43. Walk me through "the database is slow."**</summary>

First, is it the database at all — connection counts by state against `max_connections`, and whether anything is actually active. If the app reports slowness but the database shows a handful of active queries and low CPU, the problem is the pool, the network or the app.

Then `pg_stat_activity` for running queries ordered by duration, reading `wait_event_type` to classify immediately: `Lock` means blocked, so I go to the `pg_blocking_pids` query for the blocking tree; `IO` means the working set doesn't fit in cache; `Client` usually means a session idle in transaction; no wait event means genuine CPU.

Then `pg_stat_statements` ordered by **total** execution time, not mean — a five-millisecond query run two million times costs far more than a three-second report run twice, and it's usually easier to fix. Then cache hit ratio and table and index sizes. Only then do I `EXPLAIN (ANALYZE, BUFFERS)` the specific offender.

📖 [VACUUM & Performance §5](./17-vacuum-and-performance.md)
</details>

<details>
<summary>**44. Explain your backup strategy.**</summary>

Both kinds, because they solve different problems. A base backup plus continuously archived WAL gives point-in-time recovery to any instant, fast restores because the files are already built, and minimal impact on the primary — but only whole-cluster granularity and only the same major version. A nightly `pg_dump` gives portability and granularity, so I can restore one table into a scratch database or move across major versions — but its restore is slow because it rebuilds every index, and it holds a long transaction that blocks VACUUM cluster-wide, which is a good reason to dump from a replica.

I'd use pgBackRest or WAL-G rather than a hand-rolled `archive_command`, because they handle archive verification, retention, parallelism and detecting a silently failing archive command. `pg_dump` doesn't back up roles and grants, so `pg_dumpall --globals-only` goes alongside it. And I'd create a named restore point before every risky migration.

The rule that matters more than any of it: an untested backup is not a backup. Automate a restore into a scratch environment and verify.

📖 [Backup & Operations §1–2](./22-backup-and-operations.md)
</details>

<details>
<summary>**45. Physical vs logical replication?**</summary>

Physical ships WAL blocks, so the standby is a byte-identical copy of the whole cluster — read-only, same major version and architecture, DDL replicated automatically, and it cannot diverge. Logical decodes WAL into row-level changes for selected tables, so the target is a separate writable cluster that can run a different major version with a different schema and different indexes.

The two things logical does *not* carry are DDL and sequence values, and forgetting the sequences is exactly why a cutover immediately produces duplicate key errors. It also needs a replica identity — the primary key by default — so a table without one silently fails to replicate updates and deletes.

Physical is for HA and read replicas; logical is for near-zero-downtime major version upgrades, CDC and selective replication.

📖 [Replication §1, §4](./21-replication.md)
</details>

<details>
<summary>**46. How do you handle replication lag in the application?**</summary>

The core problem is read-your-writes: you insert on the primary and immediately read from a replica that's fifty milliseconds behind, and the row isn't there.

The simplest correct fix is to route reads to the primary for the rest of a request that performed a write. Better still, use `RETURNING` so you never need to re-read what you just wrote. If you need something more precise, capture the primary's LSN after the write and wait until the replica's replay LSN has passed it. And `synchronous_commit = remote_apply` on that specific transaction guarantees the replica has applied it before commit returns, at a latency cost on every such write.

In general: reports, dashboards and search go to replicas; anything a user just modified goes to the primary. And it's worth saying explicitly that replication scales reads and availability, not writes — every replica applies every write.

📖 [Replication §6](./21-replication.md)
</details>

<details>
<summary>**47. Why does PostgreSQL need a connection pooler?**</summary>

Because a Postgres connection is an operating system process, forked per client, costing several megabytes of RSS plus fork time — so hundreds of mostly-idle connections are genuinely expensive and `max_connections` is typically capped in the low hundreds. MySQL uses a thread per connection, which is far cheaper, which is why MySQL shops often run without a pooler and Postgres shops almost always run PgBouncer.

Transaction pooling is the mode you want, and the catch is that it breaks session state: `SET`, `LISTEN`/`NOTIFY`, session-level advisory locks, `WITH HOLD` cursors and temp tables. So you use `SET LOCAL` inside a transaction instead of `SET`, and `pg_advisory_xact_lock` instead of `pg_advisory_lock`. That last one matters a lot for multi-tenancy: a plain `SET app.tenant_id` on a pooled connection leaks into the next request.

📖 [VACUUM & Performance §6](./17-vacuum-and-performance.md)
</details>

<details>
<summary>**48. When would you partition a table?**</summary>

Overwhelmingly for data lifecycle management. Dropping a partition is a metadata operation, whereas deleting fifty million rows creates fifty million dead tuples and hours of vacuum work while the table stays the same size. Secondary benefits are bounded maintenance, smaller per-partition indexes that stay cache-resident, and pruning so time-filtered queries touch only relevant partitions.

The threshold is roughly a hundred gigabytes, or any table with a retention policy. Below that it's complexity without payoff — and partitioning is not a general performance feature: a well-indexed large table often beats a badly partitioned one.

Choosing the key is the whole design decision. It has to be what the dominant queries filter on, because without pruning you scan N tables with N times the planning overhead. It has to be the retention axis. And it has to be acceptable inside every unique constraint, since Postgres requires the partition key in any unique index — so you can't have a database-enforced globally unique `id` unless `id` is the partition key.

📖 [Partitioning](./16-partitioning.md), [Q28](./26-advanced-queries.md)
</details>

---

## Round 7 — The MySQL comparison

<details>
<summary>**49. Give me five concrete differences between PostgreSQL and MySQL.**</summary>

MVCC implementation: Postgres keeps old row versions in the heap and needs VACUUM; InnoDB keeps them in an undo log and needs a purge thread — so Postgres bloats and InnoDB has slow rollbacks.

Table organisation: Postgres is heap-organised with all indexes secondary; InnoDB clusters the table by primary key, so secondary lookups are two traversals and a wide primary key bloats every index.

Index types: Postgres has GIN, GiST, BRIN and SP-GiST plus partial and expression indexes, so it can index `LIKE '%x%'`, `jsonb` containment against unanticipated keys, range overlap and nearest-neighbour queries. InnoDB has B-tree, FULLTEXT and SPATIAL.

Transactional DDL: Postgres can roll a whole migration back; MySQL commits implicitly around every DDL statement.

Default isolation: `READ COMMITTED` versus `REPEATABLE READ`, and their `SERIALIZABLE` implementations are optimistic versus pessimistic.

📖 [PostgreSQL vs MySQL](./23-postgresql-vs-mysql.md)
</details>

<details>
<summary>**50. Name things MySQL genuinely does better.**</summary>

Replication and HA maturity: writable replicas by default, native multi-source, Group Replication for genuine multi-primary, and automated failover built in with InnoDB Cluster and MySQL Router — Postgres needs Patroni plus a consensus store as a separate component. Its multi-threaded applier is also more mature.

Connection handling: thread-per-connection, so thousands of connections are viable without a pooler.

Update-heavy write performance: InnoDB updates in place and touches only the indexes whose columns changed, whereas a Postgres update writes a whole new tuple and may touch every index unless HOT applies — plus no VACUUM to tune and no transaction id wraparound.

And some genuine feature wins: virtual generated columns arrived a decade earlier, `JSON_TABLE` is a nicer shredding API, `JSON_MERGE_PATCH` does deep merge which Postgres's `||` doesn't, `JSON_SCHEMA_VALID()` is built in, MySQL can update a JSON document partially in place, it has multi-table `UPDATE`, and it has optimizer hints, which are genuinely useful when you need a production fix in ten minutes.
</details>

<details>
<summary>**51. What breaks when you port a MySQL application to PostgreSQL?**</summary>

Case sensitivity first. MySQL's default collation is case-insensitive, so `WHERE email = 'Foo@X.com'` matches there and doesn't on Postgres — the fixes are `citext`, a non-deterministic ICU collation, or `lower()` with an expression index.

Then boolean-as-integer: MySQL's `BOOLEAN` is an alias for `TINYINT(1)`, so ORM-generated `WHERE is_active = 1` is a hard type error on Postgres. `GROUP BY` with unaggregated columns, which old MySQL silently allowed. `LIMIT 10, 20` syntax. Backtick quoting. `||` meaning logical OR. `AUTO_INCREMENT`, `ON DUPLICATE KEY UPDATE`, `INSERT IGNORE`, `REPLACE INTO`, and `LAST_INSERT_ID()`. No `UNSIGNED`. The default isolation level differs. And a statement error aborts the entire transaction on Postgres, whereas MySQL lets you continue.

Structurally, the one people get wrong: a MySQL *database* maps to a PostgreSQL *schema*, not a PostgreSQL database — otherwise you lose cross-database joins, which Postgres can't do at all.

📖 [PostgreSQL vs MySQL §10](./23-postgresql-vs-mysql.md)
</details>

<details>
<summary>**52. Which is faster?**</summary>

Neither, in general, and I'd push back gently on the framing. Both are fast enough that the bottleneck is almost always the schema, the indexes and the queries.

That said, the shape of the workload does tilt it. MySQL tends to win on simple primary-key lookups, because the table is clustered by the primary key so it's one traversal, and on very high connection counts and update-heavy narrow workloads. Postgres tends to win decisively on complex analytical queries — it has hash joins, merge joins and parallel execution, where MySQL had no hash join until 8.0.18 and still has no merge join — and on anything using window functions, recursive CTEs, full-text search, geospatial data or unpredictable JSON access patterns.

</details>

---

## The five sentences worth memorising verbatim

1. **"Postgres pays for cheap commits and free rollbacks with VACUUM; InnoDB pays for a compact table with a slow rollback and an undo log."**
2. **"Equality, Sort, Range"** — composite index column order.
3. **"A `WHERE` on the right side of a `LEFT JOIN` makes it an `INNER JOIN`."**
4. **"The default window frame is `RANGE`, which groups peers — write `ROWS`."**
5. **"Replication is for availability and read scaling; it cannot scale writes."**

---

## Questions to ask *them*

Asking good questions is part of the interview.

- What's your largest table, and is it partitioned? Would you choose the same key again?
- How do you run schema migrations against it — and has a migration ever caused an outage?
- Are you on `READ COMMITTED`, and has that ever bitten you?
- What's your autovacuum configuration on the busiest tables?
- Do you run a connection pooler, and in which mode?
- What was the last database incident, and what changed afterwards?

That last one tells you more about the engineering culture than anything on the job description.
