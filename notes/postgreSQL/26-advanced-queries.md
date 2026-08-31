---
title: Advanced Practice
---

# Advanced Practice — Questions 23–34

> **Focus**: JSONB at scale, arrays, ranges and exclusion constraints, full-text search, concurrency-safe writes, `EXPLAIN`-driven index design, partitioning, and the query shapes that show up in senior interviews.
>
> These questions assume everything from the earlier pages. Several have no single right answer — the trade-off discussion *is* the answer.

---

## Question 23: Shred a JSONB array and aggregate correctly

`events(id, payload jsonb)` where `payload.items` is an array of `{sku, qty, price}`. Compute revenue per SKU, and the number of distinct events each SKU appeared in.

<details>
<summary>**Solution & Trace**</summary>

```sql
SELECT i.sku,
       sum(i.qty * i.price)   AS revenue,
       sum(i.qty)             AS units,
       count(DISTINCT e.id)   AS events
FROM   events e
CROSS JOIN LATERAL jsonb_to_recordset(e.payload -> 'items')
       AS i(sku text, qty int, price numeric)
WHERE  e.payload ->> 'type' = 'purchase'
GROUP  BY i.sku
ORDER  BY revenue DESC;
```

**Trace:**

```text
INPUT — 2 events
 e1.payload.items = [ {A1, 2, 500}, {B2, 1, 300} ]
 e2.payload.items = [ {A1, 1, 500} ]

── LATERAL jsonb_to_recordset ── 2 rows → 3 rows   (this is MongoDB's $unwind)
 e.id │ sku │ qty │ price
──────┼─────┼─────┼───────
   1  │ A1  │  2  │  500
   1  │ B2  │  1  │  300     ← event 1 now appears TWICE
   2  │ A1  │  1  │  500

── GROUP BY sku ──────────────── 3 rows → 2 rows
 sku │ revenue          │ units │ events
─────┼──────────────────┼───────┼────────
 A1  │ 2×500 + 1×500 = 1500 │   3   │  2      count(DISTINCT e.id) = {1,2}
 B2  │ 1×300 =          300 │   1   │  1
```

:::danger[The double-count after unnesting]
The parent row is repeated once per array element. So `sum((e.payload->>'total')::numeric)` here would count event 1's total **twice**. Any aggregate over *parent* columns after unnesting is wrong — use `count(DISTINCT e.id)`, or aggregate the items in a subquery and join the parent back.
:::

**The index that makes the `WHERE` fast — three options, ranked:**

```sql
-- Best if you ALWAYS filter on `type`: small, supports ranges and ORDER BY
CREATE INDEX ON events ((payload ->> 'type'));

-- Best if the filter keys VARY: containment against arbitrary keys
CREATE INDEX ON events USING GIN (payload jsonb_path_ops);
SELECT ... WHERE payload @> '{"type":"purchase"}';   -- ← must use @> to hit the GIN index

-- Best of all for a hot key: promote it, get real statistics
ALTER TABLE events ADD COLUMN event_type text
  GENERATED ALWAYS AS (payload ->> 'type') STORED;
CREATE INDEX ON events (event_type);
```

The third option matters because **JSONB has no per-key statistics** — the planner's selectivity estimate for `@>` is a fixed guess, which produces bad join plans upstream. A generated column gets a real histogram and MCV list.

:::info[PostgreSQL vs MySQL]
MySQL's `JSON_TABLE` does the same shredding with arguably nicer syntax. The decisive difference is upstream: on MySQL you **cannot index the JSON column itself**, so `WHERE JSON_EXTRACT(payload,'$.type') = 'purchase'` is a full scan unless you have already created a generated column for that exact path. On Postgres a GIN index handles keys you didn't anticipate.
:::
</details>

---

## Question 24: Make double-booking impossible

Design a bookings table where two bookings for the same room can never overlap in time — enforced by the database, not the application.

<details>
<summary>**Solution & Trace**</summary>

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE bookings (
    id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id int NOT NULL REFERENCES rooms(id),
    during  tstzrange NOT NULL,
    guest   text NOT NULL,
    CONSTRAINT no_double_booking
      EXCLUDE USING GIST (room_id WITH =, during WITH &&),
    CONSTRAINT sane_range CHECK (not isempty(during) and lower(during) is not null)
);
```

Read the constraint as: **"no two rows may have equal `room_id` AND overlapping `during`."**

**Trace:**

```text
INSERT room 1, [10:00, 12:00)  Asha   → ✅
INSERT room 1, [11:00, 13:00)  Ravi   → ❌ ERROR: conflicting key value violates
                                            exclusion constraint "no_double_booking"
INSERT room 1, [12:00, 14:00)  Ravi   → ✅
INSERT room 2, [11:00, 13:00)  Ravi   → ✅  (different room)

Timeline for room 1:
 10:00      11:00      12:00      13:00      14:00
   ├──────────────────────┤                             Asha [10:00, 12:00)
              ├──────────────────────┤                  Ravi [11:00, 13:00)  ✗ overlaps
                          ├──────────────────────┤      Ravi [12:00, 14:00)  ✓ touches only

The half-open interval [a,b) is why 12:00 belongs to exactly ONE booking.
With '[a,b]' both would claim 12:00 and the back-to-back booking would fail.
```

**Why this beats the application-level check:**

```text
 Request A                          Request B
 ─────────────────────────────      ─────────────────────────────
 SELECT ... WHERE overlaps → none   SELECT ... WHERE overlaps → none
                                    INSERT                     ✓
 INSERT                     ✓  ← both succeeded. Double booked.

 TIME-OF-CHECK-TO-TIME-OF-USE. Fixing it needs SERIALIZABLE isolation
 or an explicit lock. The exclusion constraint makes it STRUCTURALLY
 impossible — the same GiST index that answers the query enforces it.
```

Querying is indexed for free — the constraint creates the GiST index:

```sql
SELECT * FROM bookings
WHERE room_id = 1 AND during && tstzrange(now(), now() + interval '2 hours');
```

Add a soft-delete dimension with a partial exclusion constraint:

```sql
ALTER TABLE bookings ADD CONSTRAINT no_double_booking_live
  EXCLUDE USING GIST (room_id WITH =, during WITH &&) WHERE (cancelled_at IS NULL);
```

:::info[PostgreSQL vs MySQL]
There is **no MySQL equivalent** — no range types, no exclusion constraints, no GiST. On MySQL you'd store `starts_at`/`ends_at`, and enforce the rule with `SELECT ... FOR UPDATE` over the room's rows inside a transaction, or a serialised application lock. Both are weaker and easier to get wrong. This is one of the strongest concrete "why Postgres" examples.
:::
</details>

---

## Question 25: Ranked full-text search with highlighting

Build a search endpoint over `articles(title, body)`, with relevance ranking, snippets, and safe handling of arbitrary user input.

<details>
<summary>**Solution & Trace**</summary>

```sql
-- Schema
ALTER TABLE articles ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(body,  '')), 'C')
  ) STORED;
CREATE INDEX idx_articles_search ON articles USING GIN (search_vector);
```

```sql
-- Query: two-stage, so ts_headline runs on 20 rows, not 500,000
WITH q AS (SELECT websearch_to_tsquery('english', $1) AS query),
hits AS (
  SELECT a.id, a.title, a.body, a.published_at,
         ts_rank_cd(a.search_vector, q.query) AS rank
  FROM articles a, q
  WHERE a.search_vector @@ q.query
    AND a.published_at > now() - interval '2 years'   -- narrow the candidate set
  ORDER BY rank DESC, a.published_at DESC
  LIMIT 20
)
SELECT h.id, h.title, h.rank,
       ts_headline('english', h.body, q.query,
                   'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15')
       AS snippet
FROM hits h, q;
```

**Trace of the text pipeline:**

```text
Document: "PostgreSQL indexing strategies for running large databases"
   │
   ▼ to_tsvector('english', …)  — parse, drop stop words, stem
   'postgresql':1 'index':2 'strategi':3 'run':5 'larg':6 'databas':7
                                          ↑ "running" stems to "run"

Query: user types  "large databases" -mysql running
   │
   ▼ websearch_to_tsquery('english', …)
   'larg' <-> 'databas' & !'mysql' & 'run'
      ↑ phrase (adjacent)  ↑ negation   ↑ stemmed

   ▼ @@  →  MATCH ✓

setweight: 'A' terms score higher than 'C', so a title hit outranks a body hit.
ts_rank_cd additionally rewards terms appearing CLOSE TOGETHER.
```

:::danger[Two production bugs to avoid]
1. **Never `to_tsquery` on user input.** A user typing `C++ &` gets `ERROR: syntax error in tsquery` and a 500. `websearch_to_tsquery` and `plainto_tsquery` sanitise and never throw.
2. **`ts_rank` is not indexable.** The GIN index finds the matches; ranking then evaluates for *every* match before the sort. A query matching 500,000 documents ranks 500,000 documents regardless of your `LIMIT`. Narrow the candidate set with additional predicates, and run the expensive `ts_headline` only after the `LIMIT`.
:::

**Add typo tolerance with trigrams:**

```sql
CREATE EXTENSION pg_trgm;
CREATE INDEX ON articles USING GIN (title gin_trgm_ops);

SELECT title, similarity(title, $1) AS sim
FROM articles WHERE title % $1 ORDER BY sim DESC LIMIT 10;
```

The same index makes `WHERE title ILIKE '%adapt%'` an index scan instead of a sequential scan — **something MySQL cannot do at all.** And MySQL's FULLTEXT does **no stemming**, so "running" never matches "ran" there.
</details>

---

## Question 26: A concurrency-safe job queue

N workers must claim jobs with no duplicates, no blocking, and recovery from worker crashes.

<details>
<summary>**Solution & Trace**</summary>

```sql
CREATE TABLE jobs (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payload     jsonb NOT NULL,
    status      text NOT NULL DEFAULT 'pending',
    priority    int  NOT NULL DEFAULT 0,
    attempts    int  NOT NULL DEFAULT 0,
    claimed_at  timestamptz,
    worker_id   text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Partial index: only the pending rows, so it stays tiny on a huge table
CREATE INDEX idx_jobs_pending ON jobs (priority DESC, created_at)
WHERE status = 'pending';
```

```sql
-- Claim
WITH claimed AS (
    SELECT id FROM jobs
    WHERE status = 'pending'
    ORDER BY priority DESC, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 10
)
UPDATE jobs j
SET status = 'processing', claimed_at = now(), worker_id = $1, attempts = attempts + 1
FROM claimed c
WHERE j.id = c.id
RETURNING j.*;
```

**Trace with three concurrent workers:**

```text
 Worker A                      Worker B                      Worker C
 ─────────────────────────     ─────────────────────────     ─────────────────────────
 locks jobs 1–10               sees 1–10 locked → SKIPS      sees 1–20 locked → SKIPS
                               locks 11–20                   locks 21–30
 returns 1–10                  returns 11–20                 returns 21–30

 No blocking. No duplicates. No polling collisions. Scales linearly with workers.
```

```text
WITHOUT SKIP LOCKED:
 Worker A locks 1–10
 Worker B  ── BLOCKS waiting for A ──▶ then gets 1–10 again, sees they're
                                       no longer 'pending', returns nothing.
 You have built a queue of WORKERS, not a queue of jobs.
```

**Crash recovery — a sweeper for the visibility timeout:**

```sql
UPDATE jobs
SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
    claimed_at = NULL, worker_id = NULL
WHERE status = 'processing'
  AND claimed_at < now() - interval '10 minutes';
```

**Design notes worth saying out loud:**

- The **partial index** is what makes this scale: on a 50-million-row table with 800 pending jobs, `WHERE status = 'pending'` on a partial index is a ~40 KB structure, not a 1.2 GB one.
- Keep the claim transaction **short** — claim, commit, then do the work. Never hold the transaction open across the job's execution, or you pin the xmin horizon and bloat the cluster.
- Wake workers with `LISTEN`/`NOTIFY` instead of polling — but keep a slow poll as a fallback, because notifications are not durable.
- **When to reach for a real broker:** if you need fan-out, delayed delivery, dead-letter routing, or millions of jobs per hour, use SQS/Rabbit/Kafka. Postgres queues are excellent up to a few thousand jobs a second and win on transactional consistency — you can enqueue a job in the same transaction as the row it's about, which no external broker can give you.

:::info[PostgreSQL vs MySQL]
`SKIP LOCKED` exists in MySQL 8.0.1+ with identical semantics, so this pattern is portable. What isn't portable is the partial index — on MySQL the index covers all 50 million rows. And there's no `RETURNING`, so claiming needs a second `SELECT`.
:::
</details>

---

## Question 27: Read an `EXPLAIN` plan and fix the query

This dashboard query takes 2.8 seconds. Diagnose it.

<details>
<summary>**Solution & Trace**</summary>

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT c.city, count(DISTINCT o.customer_id) AS customers, sum(o.total) AS revenue
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'paid' AND o.placed_on >= date '2026-01-01'
GROUP BY c.city ORDER BY revenue DESC LIMIT 10;
```

```text
 Limit  (actual time=2814.2..2814.2 rows=10 loops=1)
   ->  Sort  (actual time=2814.2..2814.2 rows=10 loops=1)
         Sort Key: (sum(o.total)) DESC
         Sort Method: top-N heapsort  Memory: 27kB
         ->  GroupAggregate  (actual time=2402.1..2813.8 rows=249 loops=1)
               Group Key: c.city
               ->  Sort  (actual time=2401.9..2588.4 rows=248310 loops=1)
                     Sort Key: c.city
                     Sort Method: external merge  Disk: 41920kB          ⚠️ (3)
                     ->  Hash Join  (actual time=41.1..1904.7 rows=248310 loops=1)
                           Hash Cond: (o.customer_id = c.id)
                           ->  Seq Scan on orders o  (actual rows=248310 loops=1)
                                 Filter: ((status='paid') AND (placed_on >= '2026-01-01'))
                                 Rows Removed by Filter: 951690                ⚠️ (1)
                                 Buffers: shared hit=2103 read=18994           ⚠️ (2)
                           ->  Hash  (actual rows=60000 loops=1)
                                 Buckets: 65536 Batches: 4  Memory Usage: 1088kB ⚠️ (4)
 Execution Time: 2814.9 ms
```

**Four findings, read bottom-up:**

```text
(1) Rows Removed by Filter: 951690
    Read 1.2M rows, kept 248K. 79% of the scan was wasted.
    → No usable index for (status, placed_on).

(2) Buffers: read=18994
    18,994 pages (≈148 MB) came from DISK, not cache.
    → Consistent with scanning the whole table.

(3) Sort Method: external merge  Disk: 41920kB
    The sort for GroupAggregate spilled to disk.
    → work_mem too small for this query, which is also why the planner
      chose GroupAggregate over HashAggregate.

(4) Batches: 4 on the hash
    The 60,000-row hash table also didn't fit in work_mem and was split
    into 4 batches, meaning extra disk round trips on the probe side.
```

**The fixes, in order of impact:**

```sql
-- 1. A partial covering index kills findings (1) and (2)
CREATE INDEX idx_orders_paid_2026 ON orders (placed_on, customer_id)
INCLUDE (total)
WHERE status = 'paid';

-- 2. work_mem for this query only — kills (3) and (4)
SET LOCAL work_mem = '128MB';
```

```text
AFTER:
 Limit (actual time=118.4..118.4 rows=10 loops=1)
   ->  Sort  … top-N heapsort  Memory: 27kB
         ->  HashAggregate  (actual rows=249 loops=1)      ← no sort at all now
               Batches: 1  Memory Usage: 2049kB
               ->  Hash Join  (actual rows=248310 loops=1)
                     Batches: 1  Memory Usage: 4589kB      ← fits
                     ->  Bitmap Heap Scan on orders o  (actual rows=248310 loops=1)
                           Recheck Cond: (placed_on >= '2026-01-01')
                           ->  Bitmap Index Scan on idx_orders_paid_2026
                                 Index Cond: (placed_on >= '2026-01-01')
                           Rows Removed by Filter: 0        ← the partial index did it
 Execution Time: 118.6 ms

 2814 ms → 119 ms.  24× faster.
```

**Two further observations worth mentioning:**

- `count(DISTINCT o.customer_id)` is the expensive aggregate here — it needs a per-group sort or hash. If an approximation is acceptable, the `postgres_hll` extension is dramatically cheaper.
- If this is a dashboard refreshed every minute over data that changes hourly, the correct fix is neither: precompute it into a **materialized view** and `REFRESH ... CONCURRENTLY` on a schedule. Serving a dashboard from a live 1.2-million-row aggregate is the real design bug.
</details>

---

## Question 28: Design and validate a partitioning strategy

A 2 TB `events` table, append-only, with a 90-day retention policy. Design it.

<details>
<summary>**Solution & Trace**</summary>

```sql
CREATE TABLE events (
    id         bigint GENERATED ALWAYS AS IDENTITY,
    user_id    bigint NOT NULL,
    event_type text NOT NULL,
    payload    jsonb,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (id, created_at)          -- ← the partition key MUST be in the PK
) PARTITION BY RANGE (created_at);

CREATE TABLE events_2026_08 PARTITION OF events
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
-- … one per month, created 2–3 months ahead by pg_cron or pg_partman

CREATE INDEX ON events (user_id, created_at DESC);   -- propagates to all partitions
CREATE INDEX ON events USING BRIN (created_at);      -- near-free on an append-only table
```

**Why each decision:**

```text
RANGE on created_at   → retention is a DROP TABLE, and the dominant queries
                        filter by time. Both requirements point the same way.

PRIMARY KEY (id, created_at)
                      → Postgres requires the partition key in every unique index,
                        because uniqueness is enforced per partition. You lose a
                        DB-enforced globally-unique `id` — the sequence still
                        guarantees it, you just can't declare it.

Monthly, not daily    → 90-day retention with monthly partitions is ~4 live
                        partitions. Daily would be 90, and planning time grows
                        with partition count.

BRIN on created_at    → correlation ≈ 1.0 on an append-only table, so BRIN is
                        ~200 KB where a B-tree would be ~30 GB.
```

**Prove pruning works:**

```sql
EXPLAIN SELECT count(*) FROM events WHERE created_at >= '2026-08-10' AND created_at < '2026-08-20';
```

```text
 Aggregate
   ->  Seq Scan on events_2026_08 events         ← ONE partition. The rest were pruned.

Compare a query WITHOUT the partition key:
 EXPLAIN SELECT count(*) FROM events WHERE user_id = 42;

 Aggregate
   ->  Append
         ->  Index Scan on events_2026_06_user_idx
         ->  Index Scan on events_2026_07_user_idx
         ->  Index Scan on events_2026_08_user_idx      ← ALL partitions
         ->  Index Scan on events_2026_09_user_idx
```

**Retention:**

```text
 DROP TABLE events_2026_05;       →  instant, metadata only

 vs. DELETE FROM events WHERE created_at < '2026-06-01';
     →  50M dead tuples, 50M WAL records, hours of autovacuum,
        table still the same size afterwards until vacuum completes.
```

:::danger[The three things that go wrong]
1. **A missing future partition** means inserts start failing at midnight on the 1st. Create 2–3 months ahead, and alert if the newest partition's upper bound is under 30 days away.
2. **A DEFAULT partition** looks like the safe answer, but adding a new partition then requires scanning it under `ACCESS EXCLUSIVE` to prove no rows belong in the new range. Either omit it, or alert on it being non-empty.
3. **Queries that don't filter on `created_at`** now scan N partitions with N times the planning overhead. If a large share of your workload is `WHERE user_id = ?` with no time bound, partitioning by time may be the wrong axis — or the wrong tool.
:::

:::info[PostgreSQL vs MySQL]
The unique-key rule is identical in both. The blocker on MySQL is that **partitioned tables cannot participate in foreign keys in either direction**, and there are no partitionwise joins or aggregates. Postgres partitions are also ordinary tables you can index, query, `ANALYZE` and archive individually.
:::
</details>

---

## Question 29: An atomic balance transfer

Transfer money between accounts, safely, under concurrency. Show three approaches.

<details>
<summary>**Solution & Trace**</summary>

```sql
-- ❌ The classic race
BEGIN;
SELECT balance FROM accounts WHERE id = 1;      -- 500
-- application computes 500 - 100 = 400
UPDATE accounts SET balance = 400 WHERE id = 1;
COMMIT;
```

```text
 T1                                  T2
 ─────────────────────────────       ─────────────────────────────
 reads balance = 500                 reads balance = 500
 computes 400                        computes 400
 writes 400                          writes 400
 COMMIT                              COMMIT
 → Two 100-rupee withdrawals, but the balance dropped by only 100. LOST UPDATE.
```

```sql
-- ✅ A) Atomic expression — the best answer when it applies
UPDATE accounts SET balance = balance - 100
WHERE id = 1 AND balance >= 100
RETURNING balance;
-- 0 rows affected → insufficient funds. No read, no race, no lock to manage.
```

```sql
-- ✅ B) Pessimistic — when you must compute in the application
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;   -- blocks other writers
-- ... application logic ...
UPDATE accounts SET balance = $1 WHERE id = 1;
COMMIT;
```

```sql
-- ✅ C) Optimistic — when conflicts are rare and locks are costly
UPDATE accounts SET balance = $1, version = version + 1
WHERE id = 1 AND version = $2;
-- 0 rows affected → someone else won → re-read and retry
```

**The full transfer, deadlock-safe:**

```sql
BEGIN;
  -- Lock in a CONSISTENT ORDER (ascending id) — this is what prevents deadlocks
  PERFORM 1 FROM accounts WHERE id IN ($from, $to) ORDER BY id FOR UPDATE;

  UPDATE accounts SET balance = balance - $amt WHERE id = $from AND balance >= $amt;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient funds'; END IF;

  UPDATE accounts SET balance = balance + $amt WHERE id = $to;

  INSERT INTO ledger (from_id, to_id, amount) VALUES ($from, $to, $amt);
COMMIT;
```

```text
WITHOUT the consistent lock order:
 T1: transfer 1 → 2      T2: transfer 2 → 1
 locks row 1             locks row 2
 waits for row 2  ◀──────┐
 └──────────────────────▶ waits for row 1
 DEADLOCK. Postgres detects the cycle after deadlock_timeout and aborts one.

WITH ascending-id ordering: both transactions request row 1 first, so one
simply waits for the other. No cycle is possible.
```

**Write skew — the case only `SERIALIZABLE` catches:**

```text
Rule: total balance across a customer's accounts must stay >= 0.
 T1 reads both accounts (sum = 500), withdraws 300 from account A.
 T2 reads both accounts (sum = 500), withdraws 300 from account B.
 Neither transaction touched a row the other wrote, so there is NO update conflict
 to detect. Both commit. Sum is now -100.

 Row locks don't help — the rows written are disjoint. REPEATABLE READ doesn't
 help either. Only SERIALIZABLE's SSI detects the read/write dependency cycle,
 and it aborts one with SQLSTATE 40001 — so the application MUST retry.
```

:::tip[The order to reach for these]
1. Can the new value be expressed in terms of the old? → **atomic `UPDATE`**, no race exists.
2. Need application logic in between, conflicts likely? → **`FOR UPDATE`**, with a consistent lock order.
3. Conflicts rare, don't want to hold locks? → **optimistic version column** with retry.
4. Invariant spans multiple rows that different transactions write? → **`SERIALIZABLE`** plus retry on 40001.
:::
</details>

---

## Question 30: Deduplicate a table, keeping the newest

`contacts` has duplicate emails. Keep the most recently updated row per email, delete the rest, then prevent recurrence.

<details>
<summary>**Solution & Trace**</summary>

```sql
-- 1. Inspect before deleting. Always.
SELECT lower(email), count(*), array_agg(id ORDER BY updated_at DESC)
FROM contacts GROUP BY 1 HAVING count(*) > 1;
```

```sql
-- 2. Delete, keeping rn = 1
DELETE FROM contacts c
USING (
    SELECT id, row_number() OVER (PARTITION BY lower(email)
                                  ORDER BY updated_at DESC, id DESC) AS rn
    FROM contacts
) d
WHERE c.id = d.id AND d.rn > 1;
```

**Trace:**

```text
 id │ email          │ updated_at │ rn  │ action
────┼────────────────┼────────────┼─────┼─────────
  7 │ asha@x.com     │ 2026-03-01 │  1  │ KEEP
  3 │ Asha@X.com     │ 2026-02-10 │  2  │ DELETE   ← lower() makes these the same group
  1 │ asha@x.com     │ 2026-01-05 │  3  │ DELETE
 12 │ ravi@x.com     │ 2026-02-20 │  1  │ KEEP
  9 │ ravi@x.com     │ 2026-02-20 │  2  │ DELETE   ← same timestamp; `id DESC` breaks the tie
                                                     deterministically
  5 │ meera@x.com    │ 2026-01-01 │  1  │ KEEP     (no duplicates)

6 rows → 3 deleted, 3 kept.
```

:::warning[The tiebreaker is not optional]
Without `id DESC`, rows 12 and 9 have identical `updated_at`, so `row_number()` assigns them arbitrarily — and **the assignment can differ between runs**. Re-running the same delete could keep a different row. Any `row_number()` used for a destructive operation needs a unique tiebreaker.
:::

```sql
-- 3. Prevent recurrence — case-insensitive, and only among live rows
CREATE UNIQUE INDEX CONCURRENTLY contacts_email_live
  ON contacts (lower(email))
  WHERE deleted_at IS NULL;
```

That single index is **expression + partial + unique** — three features at once, and MySQL has none of the partial part. There, "email is unique among non-soft-deleted rows" needs a generated column that is NULL when deleted, or application-level enforcement.

For a very large table, batch the delete so you don't hold one enormous transaction:

```sql
DELETE FROM contacts WHERE id IN (
  SELECT id FROM (SELECT id, row_number() OVER (...) rn FROM contacts) d
  WHERE rn > 1 LIMIT 10000
);
-- loop until 0 rows affected, committing and pausing between batches
```
</details>

---

## Question 31: Array tags with correct indexing

`posts(id, title, tags text[])`. Support "any of these tags", "all of these tags", a global tag cloud, and adding a tag idempotently.

<details>
<summary>**Solution & Trace**</summary>

```sql
CREATE INDEX idx_posts_tags ON posts USING GIN (tags);
```

```sql
-- ALL of these tags (AND)
SELECT * FROM posts WHERE tags @> ARRAY['postgres','indexes'];

-- ANY of these tags (OR)
SELECT * FROM posts WHERE tags && ARRAY['postgres','mysql'];

-- ❌ reads naturally, CANNOT use the GIN index
SELECT * FROM posts WHERE 'postgres' = ANY(tags);
```

**Trace of how GIN answers it:**

```text
GIN index: one entry per DISTINCT ELEMENT → posting list of row ids

 element     → rows
 ────────────────────────
 'indexes'   → [1]
 'mysql'     → [2]
 'perf'      → [1]
 'postgres'  → [1, 2]

@> ARRAY['postgres','indexes']   (AND)
   lookup 'postgres' → [1,2]
   lookup 'indexes'  → [1]
   INTERSECT         → [1]        ← 1 heap fetch

&& ARRAY['postgres','mysql']     (OR)
   lookup 'postgres' → [1,2]
   lookup 'mysql'    → [2]
   UNION             → [1,2]      ← 2 heap fetches
```

```sql
-- Tag cloud
SELECT tag, count(*) AS n
FROM posts, unnest(tags) AS tag
GROUP BY tag ORDER BY n DESC LIMIT 20;
```

```text
 posts (3 rows)                              unnest → 5 rows        → group → 4 rows
 1 {postgres,indexes,perf}   ───────────▶  (1,postgres)(1,indexes)(1,perf)
 2 {postgres,mysql}          ───────────▶  (2,postgres)(2,mysql)
 3 {}                        ───────────▶  (nothing — an EMPTY ARRAY produces NO ROWS,
                                             exactly like MongoDB's $unwind)
```

```sql
-- Add a tag, idempotently, in one statement
UPDATE posts SET tags = tags || 'newtag'
WHERE id = 1 AND NOT (tags @> ARRAY['newtag']);

-- Remove, sort and dedupe
UPDATE posts SET tags = (SELECT array_agg(DISTINCT t ORDER BY t)
                         FROM unnest(array_remove(tags,'perf')) t)
WHERE id = 1;
```

:::warning[Know when this is the wrong model]
An array column is denormalisation. It's right for small, read-mostly, attribute-free sets. It's wrong the moment you need a **foreign key** to a tags table, per-element metadata like `added_at`, high-frequency per-element updates, or to paginate the elements. **Array elements cannot have foreign keys** — that single fact settles most of these arguments.

MySQL has no array type; the equivalents there are a JSON array with a multi-valued index (8.0.17+) or a junction table.
:::
</details>

---

## Question 32: Two views of "top customers" that disagree

Rank customers by lifetime revenue. Then rank them by revenue in 2026. Explain why a customer can be top-10 in one and absent from the other, and produce both in one query.

<details>
<summary>**Solution & Trace**</summary>

```sql
WITH per_customer AS (
  SELECT o.customer_id,
         sum(o.total)                                                  AS lifetime,
         sum(o.total) FILTER (WHERE o.placed_on >= date '2026-01-01')  AS ytd,
         count(*)                                                      AS orders,
         max(o.placed_on)                                              AS last_order
  FROM orders o WHERE o.status = 'paid'
  GROUP BY o.customer_id
)
SELECT c.name,
       p.lifetime,
       coalesce(p.ytd, 0)                                       AS ytd,
       rank() OVER (ORDER BY p.lifetime DESC)                   AS lifetime_rank,
       rank() OVER (ORDER BY coalesce(p.ytd,0) DESC)            AS ytd_rank,
       p.last_order
FROM per_customer p JOIN customers c ON c.id = p.customer_id
ORDER BY p.lifetime DESC
LIMIT 10;
```

**Trace of the divergence:**

```text
 customer │ lifetime │ ytd   │ lifetime_rank │ ytd_rank │ last_order
──────────┼──────────┼───────┼───────────────┼──────────┼────────────
 Asha     │  50,000  │     0 │       1       │    12    │ 2023-06-11   ← churned whale
 Ravi     │  12,000  │ 12,000│       2       │     1    │ 2026-08-20   ← current best
 Meera    │  11,500  │  3,000│       3       │     4    │ 2026-07-02

Asha is rank 1 by lifetime value and rank 12 this year — she stopped buying
three years ago. Two valid rankings, two completely different business answers.
```

**The point of the question:** `FILTER` lets you compute both aggregates in **one pass** over the data, and two window functions over the same CTE give both rankings without a second scan. The alternative — two separate queries plus a join, or two subqueries — reads the table twice.

Note also:

- `sum(...) FILTER (...)` returns **NULL**, not 0, when no rows match the filter — hence the `coalesce` before ranking, or Asha would rank as NULL and sort unpredictably.
- `rank()` rather than `row_number()` so genuine ties share a rank.
- `WHERE status = 'paid'` sits in the CTE — filtering rows before aggregation, which is a `WHERE` job. A threshold on `lifetime` would be a `HAVING` or an outer filter.

:::info[PostgreSQL vs MySQL]
`FILTER` is SQL-standard and unsupported in MySQL, where you write `SUM(CASE WHEN placed_on >= '2026-01-01' THEN total ELSE 0 END)` — which also silently changes the empty case from NULL to 0. Window functions work on MySQL 8+, so the ranking half is portable; on 5.7 neither half is.
:::
</details>

---

## Question 33: Efficient "search with facets" in one round trip

A product listing needs: the current page of results, the total count, and facet counts by category and by brand — all consistent with the same filter.

<details>
<summary>**Solution & Trace**</summary>

```sql
WITH filtered AS MATERIALIZED (              -- ← referenced 4×, so materialise it once
  SELECT id, name, price, category, brand
  FROM products
  WHERE search_vector @@ websearch_to_tsquery('english', $1)
    AND price BETWEEN $2 AND $3
    AND in_stock
)
SELECT jsonb_build_object(
  'items', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.price), '[]'::jsonb)
            FROM (SELECT * FROM filtered ORDER BY price LIMIT 20 OFFSET $4) t),
  'total', (SELECT count(*) FROM filtered),
  'by_category', (SELECT coalesce(jsonb_object_agg(category, n), '{}'::jsonb)
                  FROM (SELECT category, count(*) n FROM filtered GROUP BY 1) c),
  'by_brand',    (SELECT coalesce(jsonb_object_agg(brand, n), '{}'::jsonb)
                  FROM (SELECT brand, count(*) n FROM filtered GROUP BY 1) b)
) AS response;
```

**Trace:**

```text
── filtered (MATERIALIZED) ──── evaluated ONCE
   full-text match + price range + in_stock  →  say 1,842 rows, held in a
                                                temporary result

── four consumers of that one result ──
   items       : ORDER BY price LIMIT 20 OFFSET n   → 20 rows  → JSON array
   total       : count(*)                           → 1842
   by_category : GROUP BY category                  → {"Laptops": 812, "Phones": 1030}
   by_brand    : GROUP BY brand                     → {"Acme": 400, "Zeta": 1442}

ONE round trip. ONE evaluation of the expensive predicate. All four outputs
are consistent with each other — which separate queries cannot guarantee,
because rows can change between them.
```

**Why `MATERIALIZED` is explicit here.** Since PG 12, a CTE referenced **once** is inlined. This one is referenced four times, so Postgres would materialise it anyway — but stating it makes the intent unambiguous and protects the query if someone later reduces it to a single reference. It's exactly the case the keyword exists for.

**Caveats worth naming:**

- `count(*)` over a large filtered set is still O(n). If the filter can match millions, cap it (`SELECT count(*) FROM (SELECT 1 FROM filtered LIMIT 10000) x`) and display "10,000+".
- `OFFSET` reappears here because faceted UIs usually do want page numbers. For an infinite-scroll API, use keyset pagination instead.
- Returning one JSON document eliminates the ORM serialisation layer and any N+1 risk — the shape the API needs is built by the database in a single pass.

:::info[PostgreSQL vs MySQL]
MySQL 8 has `JSON_OBJECT`/`JSON_ARRAYAGG` and CTEs, so a version of this is possible — but there's no `MATERIALIZED` control, no `FILTER`, and the full-text half is much weaker (no stemming, no weighting, no ranking control). And on MySQL 5.7 none of it exists.
:::
</details>

---

## Question 34: Diagnose unstoppable table bloat

A table is 400 GB with 30 GB of live data. Autovacuum is enabled and running. Explain what's happening and how to fix it — permanently.

<details>
<summary>**Solution & Trace**</summary>

**Step 1 — confirm the symptom:**

```sql
SELECT relname, n_live_tup, n_dead_tup,
       round(100.0*n_dead_tup/nullif(n_live_tup+n_dead_tup,0),1) AS dead_pct,
       last_autovacuum, autovacuum_count
FROM pg_stat_user_tables WHERE relname = 'events';
-- n_live_tup 42M, n_dead_tup 610M, dead_pct 93.5, last_autovacuum 3 days ago
```

**Step 2 — find what's pinning the xmin horizon.** Autovacuum *runs*, but it cannot remove a tuple that might still be visible to some snapshot. Four candidates:

```sql
SELECT 'long txn' AS src, pid::text AS id, age(clock_timestamp(), xact_start)::text AS age
FROM pg_stat_activity WHERE xact_start IS NOT NULL AND state <> 'idle'
UNION ALL
SELECT 'idle in txn', pid::text, age(clock_timestamp(), state_change)::text
FROM pg_stat_activity WHERE state = 'idle in transaction'
UNION ALL
SELECT 'inactive slot', slot_name, restart_lsn::text
FROM pg_replication_slots WHERE NOT active
UNION ALL
SELECT 'prepared txn', gid, age(clock_timestamp(), prepared)::text FROM pg_prepared_xacts;
```

```text
 src            │ id          │ age
────────────────┼─────────────┼──────────────
 idle in txn    │ 48213       │ 6 days        ⚠️ a forgotten psql session
 inactive slot  │ old_replica │ 0/A3F12008    ⚠️ a decommissioned standby
```

```text
WHY THIS BLOCKS EVERYTHING:

  oldest snapshot = 6 days ago
       │
       ▼
  VACUUM may not remove ANY tuple that became dead after that point.
  Not in this table — in EVERY table in the cluster.

  The replication slot does the same thing from the other direction: the
  primary must retain both the WAL and the row versions the (absent) replica
  might still need. It also fills pg_wal until the disk dies.
```

**Step 3 — fix the cause:**

```sql
SELECT pg_terminate_backend(48213);
SELECT pg_drop_replication_slot('old_replica');
```

**Step 4 — reclaim the space, online:**

```bash
pg_repack -t events -d mydb        # rebuilds online; brief exclusive lock only at the swap
```

Not `VACUUM FULL` — that takes `ACCESS EXCLUSIVE` for the entire rewrite of a 400 GB table, plus disk for a second full copy.

**Step 5 — prevent recurrence:**

```sql
-- Stop the cause
ALTER SYSTEM SET idle_in_transaction_session_timeout = '5min';
ALTER SYSTEM SET max_slot_wal_keep_size = '100GB';   -- invalidate runaway slots

-- Make autovacuum keep up on this table
ALTER TABLE events SET (
  autovacuum_vacuum_scale_factor  = 0.01,   -- 1% not 20%
  autovacuum_analyze_scale_factor = 0.005,
  autovacuum_vacuum_cost_limit    = 2000
);

-- Cluster-wide throttle: the default of 200 is sized for 2005 hardware
ALTER SYSTEM SET autovacuum_vacuum_cost_limit = 2000;
ALTER SYSTEM SET autovacuum_max_workers = 5;
SELECT pg_reload_conf();
```

**Step 6 — the structural fix.** If `events` is time-series with a retention policy, none of this should have been necessary:

```text
 DROP TABLE events_2026_05;   → instant, no dead tuples, no vacuum, disk returned

 vs. DELETE FROM events WHERE created_at < ...
     → 50M dead tuples, 50M WAL records, hours of vacuum, table still 400 GB
```

**And the monitoring that would have caught it on day one:**

```text
 alert: any pg_replication_slot where NOT active
 alert: any session idle in transaction > 5 minutes
 alert: n_dead_tup / (n_live_tup + n_dead_tup) > 20%
 alert: max(age(relfrozenxid)) > 500,000,000
```

:::info[PostgreSQL vs MySQL]
InnoDB fails the same way into a different place: a long-running transaction stops the purge thread from truncating the undo log, so the **history list length** grows, reads slow down as they walk longer version chains, and the undo tablespace balloons. Same root cause, different symptom, same fix — find and kill the long transaction. The Postgres-specific extra is transaction ID wraparound, which InnoDB doesn't have because its transaction IDs are 64-bit.
:::
</details>

---

**Next:** [PostgreSQL vs MySQL →](./23-postgresql-vs-mysql.md) · [Interview Q&A →](./27-interview-qa.md)
