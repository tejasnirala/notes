---
title: VACUUM & Performance Playbook
---

# VACUUM & the Performance Playbook

> **What you will be able to do after this page**
>
> - Explain what autovacuum does, how it decides when to run, and how to tune it per table.
> - Diagnose and fix table and index bloat without taking an outage.
> - Run the "the database is slow" investigation in a fixed, repeatable order.
> - Answer the connection-pooling, N+1, pagination and bulk-load questions from experience rather than theory.

---

## 1. What VACUUM actually does

```text
1. Reclaim dead tuple space          → marks it reusable (does NOT return disk to the OS)
2. Update the VISIBILITY MAP         → enables index-only scans
3. Update the FREE SPACE MAP         → tells inserts where there's room
4. FREEZE old tuples                 → prevents transaction ID wraparound
5. (ANALYZE) refresh statistics      → the planner's view of the data
```

```sql
VACUUM;                          -- all tables, lazy
VACUUM ANALYZE orders;           -- vacuum + refresh statistics
VACUUM (VERBOSE, ANALYZE) orders;
VACUUM FREEZE orders;            -- aggressively freeze
VACUUM FULL orders;              -- ⚠️ ACCESS EXCLUSIVE, rewrites the table, blocks EVERYTHING
```

:::danger[Never `VACUUM FULL` a live production table]
It takes an `ACCESS EXCLUSIVE` lock for the entire rewrite and needs disk space for a full second copy. On a 500 GB table that's hours of total downtime.

Use **`pg_repack`** instead — it rebuilds the table online using triggers to capture concurrent changes, taking an exclusive lock only for a brief final swap. Or, for a partitioned table, just drop the old partition.
:::

---

## 2. Autovacuum — when it triggers

```text
vacuum threshold  = autovacuum_vacuum_threshold        (50)
                  + autovacuum_vacuum_scale_factor     (0.2)  × reltuples

analyze threshold = autovacuum_analyze_threshold       (50)
                  + autovacuum_analyze_scale_factor    (0.1)  × reltuples
```

```text
Table with 100,000,000 rows:
  vacuum triggers after 50 + 0.2 × 100,000,000 = 20,000,050 dead tuples

⚠️  Twenty million dead tuples before autovacuum even starts. The table is
    already bloated, index scans are already reading dead entries, and when
    it finally runs it's a huge, disruptive job.
```

**The defaults are tuned for small tables.** On big ones, lower the scale factor per table:

```sql
ALTER TABLE orders SET (
  autovacuum_vacuum_scale_factor  = 0.01,     -- 1 % instead of 20 %
  autovacuum_analyze_scale_factor = 0.005,
  autovacuum_vacuum_cost_delay    = 2,        -- ms of pause per cost budget (default 2 in PG12+)
  autovacuum_vacuum_cost_limit    = 1000      -- raise the budget: vacuum faster
);
```

Cluster-wide settings worth changing on any busy server:

```ini
autovacuum_max_workers = 5           # default 3
autovacuum_naptime = 30s             # default 1min
autovacuum_vacuum_cost_limit = 2000  # default 200 — the single biggest throttle
maintenance_work_mem = 1GB           # faster index cleanup during vacuum
```

`autovacuum_vacuum_cost_limit = 200` is the reason people say "autovacuum can't keep up." It's a deliberate I/O throttle sized for 2005 hardware.

Also (PG 13+): `autovacuum_vacuum_insert_threshold` triggers vacuum on **insert-only** tables, which previously never got vacuumed at all and so never got index-only scans or freezing until an anti-wraparound vacuum hit them all at once.

### Monitoring

```sql
SELECT relname,
       n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
       autovacuum_count
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

```sql
-- Is autovacuum running right now, and on what?
SELECT pid, datname, relid::regclass, phase,
       heap_blks_scanned, heap_blks_total,
       round(100.0*heap_blks_scanned/nullif(heap_blks_total,0),1) AS pct
FROM pg_stat_progress_vacuum;
```

Alert on `dead_pct > 20 %` and on `age(relfrozenxid) > 500000000`.

---

## 3. Why VACUUM stops working

Autovacuum cannot remove a dead tuple that might still be visible to *some* running snapshot. Four things hold that horizon back — and they cause the same symptom, unstoppable bloat:

| Blocker | Find it | Fix |
| :--- | :--- | :--- |
| **Long-running transaction** | `pg_stat_activity` where `xact_start` is old | `idle_in_transaction_session_timeout`, kill the session |
| **Idle in transaction** | `state = 'idle in transaction'` | Same. This is the most common cause by far |
| **Abandoned replication slot** | `pg_replication_slots` where `active = false` | `pg_drop_replication_slot()`; set `max_slot_wal_keep_size` |
| **Orphaned prepared transaction** | `pg_prepared_xacts` | `ROLLBACK PREPARED 'gid'` |

```sql
-- The one query to run when bloat won't go away
SELECT 'long txn' AS src, pid::text, age(clock_timestamp(), xact_start)::text AS age
FROM pg_stat_activity WHERE xact_start IS NOT NULL AND state <> 'idle'
UNION ALL
SELECT 'idle in txn', pid::text, age(clock_timestamp(), state_change)::text
FROM pg_stat_activity WHERE state = 'idle in transaction'
UNION ALL
SELECT 'repl slot', slot_name, active::text FROM pg_replication_slots WHERE NOT active
UNION ALL
SELECT 'prepared txn', gid, age(clock_timestamp(), prepared)::text FROM pg_prepared_xacts;
```

:::info[PostgreSQL vs MySQL]
InnoDB has the mirror-image problem. A long-running transaction stops the purge thread from truncating the undo log, so the **history list length** grows, reads get slower (they walk longer version chains), and the undo tablespace balloons. Same root cause — one forgotten open transaction — different symptom. If asked to compare, that's the honest answer: **neither engine is immune to a long transaction; they just fail differently.**
:::

---

## 4. Bloat — measuring and fixing

```sql
-- Approximate table bloat
SELECT schemaname, relname,
       pg_size_pretty(pg_total_relation_size(relid)) AS total,
       n_live_tup, n_dead_tup,
       round(100.0*n_dead_tup/nullif(n_live_tup+n_dead_tup,0),1) AS dead_pct
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 20;
```

For accurate numbers use the `pgstattuple` extension:

```sql
CREATE EXTENSION pgstattuple;
SELECT * FROM pgstattuple('orders');           -- exact, but does a full scan
SELECT * FROM pgstattuple_approx('orders');    -- sampled, much cheaper
SELECT * FROM pgstatindex('idx_orders_placed');
```

Fixes, in escalating order:

```sql
ANALYZE orders;                                   -- statistics only
VACUUM (ANALYZE) orders;                          -- reclaim, online
REINDEX INDEX CONCURRENTLY idx_orders_placed;     -- index bloat, online (PG 12+)
-- pg_repack -t orders                            -- table bloat, online, external tool
VACUUM FULL orders;                               -- last resort, full outage
```

**Prevention beats cure:** lower `fillfactor` on update-heavy tables so HOT updates keep working, tune autovacuum per table, and partition anything with a retention policy so you drop rather than delete.

---

## 5. The "database is slow" runbook

Work in this order. Skipping steps is how people spend a day tuning the wrong thing.

### Step 1 — Is it the database at all?

```sql
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
SELECT count(*) FROM pg_stat_activity;      -- vs max_connections
```

If the app reports slowness but the database shows a handful of active queries and low CPU, the problem is the connection pool, the network, or the app.

### Step 2 — What's running right now?

```sql
SELECT pid, now() - query_start AS duration, state, wait_event_type, wait_event,
       left(query, 100) AS query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY duration DESC;
```

`wait_event_type` tells you the *kind* of problem immediately:

| `wait_event_type` | Meaning |
| :--- | :--- |
| `Lock` | Blocked on another transaction → go to the blocking-tree query |
| `IO` (`DataFileRead`) | Reading from disk → working set exceeds cache |
| `LWLock` | Internal contention (`WALWrite`, `BufferContent`, `SubtransSLRU`) |
| `Client` (`ClientRead`) | Waiting on the *application* — often an idle-in-transaction session |
| `CPU` (no wait event, `state = active`) | Genuinely computing |

```sql
-- kill a runaway query (cancel first, terminate only if that fails)
SELECT pg_cancel_backend(pid);
SELECT pg_terminate_backend(pid);
```

### Step 3 — Who's blocking whom?

```sql
SELECT blocked.pid AS blocked_pid, left(blocked.query,60) AS blocked_query,
       blocking.pid AS blocking_pid, left(blocking.query,60) AS blocking_query,
       blocking.state AS blocking_state
FROM pg_stat_activity blocked
JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid));
```

### Step 4 — What's expensive over time?

```sql
SELECT left(query,80), calls, round(total_exec_time::numeric,0) AS total_ms,
       round(mean_exec_time::numeric,2) AS mean_ms, rows
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;
```

Order by **total**, not mean.

### Step 5 — Cache hit ratio

```sql
SELECT sum(heap_blks_hit) AS hits, sum(heap_blks_read) AS reads,
       round(100.0*sum(heap_blks_hit)/nullif(sum(heap_blks_hit)+sum(heap_blks_read),0),2) AS hit_pct
FROM pg_statio_user_tables;
```

Above 99 % is healthy for OLTP. Below 95 % means the working set doesn't fit — raise `shared_buffers`, add RAM, reduce the data read, or fix the queries reading too much.

### Step 6 — Table and index sizes

```sql
SELECT relname,
       pg_size_pretty(pg_total_relation_size(relid))  AS total,
       pg_size_pretty(pg_relation_size(relid))        AS table,
       pg_size_pretty(pg_indexes_size(relid))         AS indexes
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 20;
```

Indexes bigger than the table is normal for wide index sets — but it's a prompt to look for unused ones.

### Step 7 — Now `EXPLAIN` the specific query

See [EXPLAIN & the Planner](./14-explain-and-the-planner.md).

---

## 6. Connection management

```sql
SHOW max_connections;
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
```

Each connection is an OS process with its own memory. The practical guidance:

```text
max_connections ≈ (2 × CPU cores) + effective_spindle_count      ← for ACTIVE work
                  … but set 100–300 and put a pooler in front.
```

**PgBouncer** modes:

| Mode | Connection returned to pool | Safe for |
| :--- | :--- | :--- |
| `session` | On disconnect | Everything (but barely pools) |
| `transaction` | On COMMIT/ROLLBACK | **The default choice.** Not safe with session state |
| `statement` | After each statement | Autocommit-only workloads |

:::warning[What breaks under transaction pooling]
`SET` (session-level), `LISTEN`/`NOTIFY`, session advisory locks, `WITH HOLD` cursors, prepared statements (unless PgBouncer 1.21+ with `max_prepared_statements`), and temp tables. Use `SET LOCAL` inside a transaction instead of `SET`, and `pg_advisory_xact_lock` instead of `pg_advisory_lock`.
:::

PG 14+ made connections meaningfully cheaper (snapshot scalability), and **PgBouncer is still the right answer** for anything with hundreds of app instances. MySQL's thread-per-connection model tolerates far more connections, which is why MySQL shops often don't run a pooler and Postgres shops almost always do.

---

## 7. Application-level patterns that actually matter

### N+1 queries

```javascript
// ❌ 1 + N round trips
const orders = await db.query('SELECT * FROM orders LIMIT 100');
for (const o of orders) {
  o.items = await db.query('SELECT * FROM order_items WHERE order_id = $1', [o.id]);
}

// ✅ 1 round trip — aggregate in the database
const rows = await db.query(`
  SELECT o.*,
         coalesce(
           (SELECT jsonb_agg(to_jsonb(i)) FROM order_items i WHERE i.order_id = o.id),
           '[]'::jsonb
         ) AS items
  FROM orders o LIMIT 100
`);
```

The latency, not the CPU, is what kills you: 100 round trips at 2 ms each is 200 ms of pure waiting.

### Pagination

```sql
-- ❌ OFFSET: the server walks and discards 100,000 rows to give you 20
SELECT * FROM orders ORDER BY placed_on DESC LIMIT 20 OFFSET 100000;

-- ✅ Keyset (cursor) pagination: constant cost per page
SELECT * FROM orders
WHERE (placed_on, id) < ($1, $2)          -- last row of the previous page
ORDER BY placed_on DESC, id DESC
LIMIT 20;
```

Keyset pagination is also immune to the shifting-window problem, where a row inserted between page loads causes a duplicate or a skip. It needs an index on `(placed_on DESC, id DESC)` and a **unique tiebreaker** in the sort key. The cost is that you can't jump to page 500 — which is usually fine, because nobody does.

For a total count, `count(*)` on a big table is a full scan. Options: an approximate count from `pg_class.reltuples`, a cheap upper bound with `SELECT count(*) FROM (SELECT 1 FROM t WHERE ... LIMIT 10000) x`, or a maintained counter.

### Bulk loading

```sql
-- Fastest: COPY, not INSERT
COPY orders (customer_id, total, placed_on) FROM '/path/file.csv' CSV HEADER;
\copy orders FROM 'file.csv' CSV HEADER      -- psql client-side

-- Next best: multi-row INSERT, or unnest from arrays
INSERT INTO items (sku, qty) SELECT * FROM unnest($1::text[], $2::int[]);
```

For a very large load:

```sql
ALTER TABLE t SET UNLOGGED;      -- skip WAL (⚠️ table is truncated on crash)
DROP INDEX ...;                  -- drop non-essential indexes
-- load
CREATE INDEX ...;                -- rebuild (much faster than incremental maintenance)
ALTER TABLE t SET LOGGED;
ANALYZE t;
```

`COPY` is roughly 10× faster than row-by-row `INSERT`; the equivalent on MySQL is `LOAD DATA INFILE`.

### Batching deletes

```sql
-- Deleting 50M rows in one statement: one enormous transaction, huge WAL,
-- locks held for hours, massive bloat.
DO $$
DECLARE n int;
BEGIN
  LOOP
    DELETE FROM events WHERE id IN (
      SELECT id FROM events WHERE created_at < now() - interval '90 days' LIMIT 10000
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    EXIT WHEN n = 0;
    COMMIT;                       -- PG 11+ allows COMMIT inside a procedure
    PERFORM pg_sleep(0.1);        -- let autovacuum breathe
  END LOOP;
END $$;
```

Better still: partition by time and `DROP` the partition.

---

## 8. A sane starting configuration

For a 16 GB / 4-core server, mixed OLTP:

```ini
# Memory
shared_buffers = 4GB                  # 25% of RAM
effective_cache_size = 12GB           # 75% — a planner hint, not an allocation
work_mem = 16MB                       # per node per worker per connection!
maintenance_work_mem = 1GB

# Planner
random_page_cost = 1.1                # SSD. THE most impactful single change
effective_io_concurrency = 200        # SSD
default_statistics_target = 100

# Parallelism
max_worker_processes = 4
max_parallel_workers_per_gather = 2
max_parallel_workers = 4

# WAL / checkpoints
wal_compression = on
max_wal_size = 4GB
min_wal_size = 1GB
checkpoint_completion_target = 0.9
wal_buffers = 16MB

# Autovacuum
autovacuum_max_workers = 4
autovacuum_naptime = 30s
autovacuum_vacuum_cost_limit = 2000

# Connections
max_connections = 200                 # + PgBouncer in front

# Observability
shared_preload_libraries = 'pg_stat_statements,auto_explain'
auto_explain.log_min_duration = '1s'
log_min_duration_statement = '1s'
log_lock_waits = on
log_checkpoints = on
log_autovacuum_min_duration = '1s'
log_temp_files = 0                    # log every temp file — reveals work_mem pressure
idle_in_transaction_session_timeout = '5min'
statement_timeout = '30s'             # per-role or per-session; be careful globally
lock_timeout = '3s'                   # set per-session before DDL
```

Use [pgtune](https://pgtune.leopard.in.ua/) as a starting point, then measure.

---

## 9. Rapid-fire recall

<details>
<summary>**What does VACUUM do and why does autovacuum sometimes not keep up?**</summary>

It marks dead tuple space reusable, updates the visibility map so index-only scans work, updates the free space map, and freezes old tuples to prevent transaction ID wraparound. Autovacuum falls behind for two main reasons. First, the default `autovacuum_vacuum_scale_factor` of 0.2 means a hundred-million-row table waits for twenty million dead tuples before vacuum even starts — so you lower it per table. Second, `autovacuum_vacuum_cost_limit` defaults to 200, which is an I/O throttle sized for very old hardware; raising it to a couple of thousand is usually the single biggest fix.
</details>

<details>
<summary>**A table keeps bloating even though autovacuum is running. Why?**</summary>

Because vacuum can't remove a tuple that might still be visible to some running snapshot, and something is holding the xmin horizon back. Four candidates: a long-running transaction, a session sitting idle-in-transaction — by far the most common — an inactive replication slot whose consumer went away, or an orphaned prepared transaction. All four are visible in `pg_stat_activity`, `pg_replication_slots` and `pg_prepared_xacts`. The standing fix is `idle_in_transaction_session_timeout` and `max_slot_wal_keep_size`.
</details>

<details>
<summary>**Why not `VACUUM FULL`?**</summary>

It takes an `ACCESS EXCLUSIVE` lock for the whole rewrite, so nothing can read or write the table, and it needs disk space for a complete second copy. On a large production table that's hours of downtime. `pg_repack` does the same job online, using triggers to capture concurrent changes and taking an exclusive lock only for a brief final swap. And if the table is partitioned by time, the real answer is to drop the old partition instead.
</details>

<details>
<summary>**Walk me through investigating "the database is slow."**</summary>

First I check whether it's the database at all — connection counts by state versus `max_connections`, and whether anything is actually active. Then `pg_stat_activity` for currently running queries ordered by duration, reading `wait_event_type` to classify immediately: `Lock` means blocked, `IO` means the working set doesn't fit in cache, `Client` usually means an idle-in-transaction session, and no wait event means genuine CPU. If it's locks, I run the `pg_blocking_pids` query to find the blocking tree. Then `pg_stat_statements` ordered by total execution time for the sustained cost, cache hit ratio from `pg_statio_user_tables`, and table and index sizes. Only then do I `EXPLAIN (ANALYZE, BUFFERS)` the specific offender.
</details>

<details>
<summary>**Why is `OFFSET` pagination bad, and what replaces it?**</summary>

Because the server has to generate and discard every row before the offset — page 5000 costs a hundred thousand rows of work to return twenty. It's also unstable: a row inserted between page loads shifts everything, producing duplicates and skips. Keyset pagination filters on the last row of the previous page instead — `WHERE (placed_on, id) < ($1, $2) ORDER BY placed_on DESC, id DESC LIMIT 20` — which is constant cost per page and stable, provided there's a matching index and a unique tiebreaker in the sort. The trade-off is you can't jump to an arbitrary page number, which almost no real UI needs.
</details>

<details>
<summary>**How do you load ten million rows quickly?**</summary>

`COPY`, which is roughly an order of magnitude faster than row-by-row `INSERT` because it avoids per-statement parse and plan overhead. For a big one-off load I'd also drop non-essential indexes first and rebuild afterwards, since a bulk index build is much cheaper than incremental maintenance per row, and consider `SET UNLOGGED` during the load to skip WAL — accepting that the table is truncated if the server crashes. Then `ANALYZE` so the planner has real statistics. If the data comes from application arrays, `INSERT ... SELECT * FROM unnest($1::text[], $2::int[])` gets a whole batch in one round trip with one cached plan.
</details>

<details>
<summary>**Why does Postgres need a connection pooler more than MySQL?**</summary>

Because a Postgres connection is an operating system process, forked per client, costing several megabytes and real setup time — so hundreds of mostly-idle connections are genuinely expensive, and `max_connections` is typically capped in the low hundreds. MySQL uses a thread per connection, which is far cheaper, so MySQL deployments often run without a pooler. On Postgres, PgBouncer in transaction pooling mode is close to standard. The catch is that transaction pooling breaks session state — `SET`, `LISTEN`, session-level advisory locks, temp tables — so you use `SET LOCAL` and `pg_advisory_xact_lock` instead.
</details>

<details>
<summary>**Which three settings would you change on a fresh install?**</summary>

`shared_buffers` to about 25 % of RAM, `effective_cache_size` to about 75 % — which allocates nothing, it just tells the planner how much is likely cached — and `random_page_cost` down from 4.0 to about 1.1 on SSD, since the default assumes a spinning disk seek and systematically discourages index scans. After that I'd raise `autovacuum_vacuum_cost_limit`, turn on `pg_stat_statements` and `auto_explain`, and set `idle_in_transaction_session_timeout` so one forgotten transaction can't bloat the whole cluster.
</details>

---

**Next:** [Functions, Procedures & PL/pgSQL →](./18-functions-and-plpgsql.md)
