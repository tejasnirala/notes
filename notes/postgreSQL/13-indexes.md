---
title: Indexes
---

# Indexes

> **What you will be able to do after this page**
>
> - Choose between B-tree, GIN, GiST, BRIN, Hash and SP-GiST for a given query, and justify it.
> - Order the columns of a composite index correctly, and explain why.
> - Use partial, expression and covering (`INCLUDE`) indexes — three things MySQL largely can't do.
> - Find unused, duplicate and bloated indexes, and know when *not* to add one.

---

## 1. What an index actually is

A separate data structure mapping key values to physical row locations (`ctid`), maintained by the engine on every write.

```text
TABLE (heap) — unordered                INDEX (B-tree on email) — ordered
 ctid    email            name
 (0,1)   ravi@x.com       Ravi           'asha@x.com'  → (0,3)
 (0,2)   meera@x.com      Meera          'karan@x.com' → (1,1)
 (0,3)   asha@x.com       Asha           'meera@x.com' → (0,2)
 (1,1)   karan@x.com      Karan          'ravi@x.com'  → (0,1)
```

:::info[PostgreSQL vs MySQL — the single most important structural difference]
| PostgreSQL | MySQL (InnoDB) |
| :--- | :--- |
| **Heap-organised.** Rows live in an unordered heap; *every* index is secondary and points at a `ctid` | **Clustered by primary key.** The table *is* the PK B-tree; rows are stored in PK order inside its leaves |
| All indexes are equal — no "primary" index in the storage sense | Secondary indexes store the **PK value**, not a row pointer, so every secondary lookup is a **double lookup**: secondary index → PK → clustered index |
| PK range scans are not sequential on disk | PK range scans are physically sequential — genuinely faster |
| Index-only scans need the **visibility map** (so a table must be vacuumed to get them) | Covering index scans need no such check |
| An `UPDATE` may have to update **every** index (unless HOT applies) | An `UPDATE` touches only the indexes whose columns changed; PK values are stable so pointers never move |
| No penalty for a large PK | **A wide PK bloats every secondary index**, since each one embeds it — this is why `UUID CHAR(36)` PKs are catastrophic on MySQL |

Consequences you should be able to state: on MySQL, ordering by the primary key is nearly free and you design around the clustering; on Postgres there's no clustering (you can `CLUSTER` a table once, but it isn't maintained), and you compensate with covering indexes and `BRIN` for naturally ordered data.
:::

---

## 2. B-tree — the default, and 95 % of what you need

```sql
CREATE INDEX idx_orders_placed ON orders (placed_on);
```

Supports: `=`, `<`, `<=`, `>`, `>=`, `BETWEEN`, `IN`, `IS NULL`, `LIKE 'prefix%'` (with `text_pattern_ops` outside the C locale), and **provides sort order**, so it can eliminate a `Sort` node and power `ORDER BY ... LIMIT` cheaply.

### Composite index column order

```sql
CREATE INDEX ON orders (customer_id, status, placed_on);
```

A composite B-tree is sorted by the first column, then the second within ties, and so on — like a phone book sorted by (surname, first name).

```text
Index on (customer_id, status, placed_on):

 (1, 'paid',   2026-01-05)
 (1, 'paid',   2026-01-20)     ← for customer 1 + 'paid', placed_on is CONTIGUOUS and SORTED
 (1, 'shipped',2026-01-08)
 (2, 'paid',   2026-02-02)
 (2, 'paid',   2026-02-11)
```

| Query | Uses the index? |
| :--- | :--- |
| `WHERE customer_id = 1` | ✅ leading column |
| `WHERE customer_id = 1 AND status = 'paid'` | ✅ prefix |
| `WHERE customer_id = 1 AND status='paid' ORDER BY placed_on` | ✅ **no sort needed** |
| `WHERE customer_id = 1 AND placed_on > '2026-01-01'` | ⚠️ partially — scans all statuses for that customer, filters after |
| `WHERE status = 'paid'` | ❌ can't skip the leading column efficiently |
| `ORDER BY customer_id, status` | ✅ |
| `ORDER BY status` | ❌ |

**The rule (identical on MySQL — this is B-tree physics, not a dialect):**

```text
1. Equality predicates first
2. Then the ORDER BY column(s)
3. Range predicates LAST

Because a range spans many values of its key, it interleaves the ordering of
every column after it, so nothing beyond it is usable for sorting.
```

```sql
-- for: WHERE status = 'paid' AND amount > 500 ORDER BY placed_on DESC
CREATE INDEX ON orders (status, placed_on DESC, amount);   -- ✅ E, S, R
--                       ^equality ^sort       ^range
-- NOT (status, amount, placed_on) — that forces a Sort node.
```

:::tip[MongoDB calls this ESR — Equality, Sort, Range]
Exactly the same rule. If you know it from MongoDB, you already know it here.
:::

Postgres can also do a **Bitmap Index Scan** over several separate single-column indexes, combining them with AND/OR before touching the heap. So `WHERE a = 1 AND b = 2` with two separate indexes isn't hopeless — but a composite index is still substantially faster. (MySQL's "index merge" is the rough equivalent and is generally weaker.)

### Descending and `NULLS` ordering

```sql
CREATE INDEX ON orders (placed_on DESC NULLS LAST);
```

A plain ascending index can be scanned backwards, so a `DESC` index is only needed for **mixed** ordering:

```sql
ORDER BY status ASC, placed_on DESC  →  CREATE INDEX ON orders (status ASC, placed_on DESC);
```

MySQL only supported real descending indexes from 8.0 (before that `DESC` was parsed and ignored).

---

## 3. Partial indexes — Postgres-only, hugely useful

```sql
CREATE INDEX idx_orders_pending ON orders (created_at)
WHERE status = 'pending';
```

```text
orders: 50,000,000 rows, of which 800 are 'pending'

Full index on (status, created_at):  ~1.2 GB, updated on every insert
Partial index:                       ~40 KB,  updated only for pending rows
```

The planner uses a partial index only when it can **prove** the query predicate implies the index predicate:

```sql
WHERE status = 'pending' AND created_at < now() - interval '1 hour'   -- ✅ uses it
WHERE status = 'pending'::text                                        -- ✅
WHERE status IN ('pending','paid')                                    -- ❌ not implied
WHERE status = $1                                                     -- ❌ unknown at plan time
```

That last one matters: a **parameterised** query with `status = $1` cannot use the partial index, because the planner doesn't know `$1 = 'pending'`. Either inline the constant or keep a full index too.

Uses:
- Job queues (`WHERE status = 'pending'`) — the archetypal case.
- Soft deletes (`WHERE deleted_at IS NULL`) — the index covers only live rows.
- **Partial unique indexes**: "only one active subscription per user."
- Excluding a dominant value: `WHERE country <> 'IN'` on a mostly-Indian dataset.

:::info[PostgreSQL vs MySQL]
**MySQL has no partial indexes.** The closest workaround is a generated column that is `NULL` unless the condition holds — because NULLs aren't indexed together the same way — plus an index on it. It's a real, frequently-felt gap, and the soft-delete uniqueness case (`UNIQUE ... WHERE deleted_at IS NULL`) has no clean MySQL solution at all.
:::

---

## 4. Expression (functional) indexes

```sql
CREATE INDEX ON users (lower(email));
CREATE INDEX ON orders (date_trunc('month', placed_on));
CREATE INDEX ON events ((payload ->> 'type'));
CREATE INDEX ON people ((first_name || ' ' || last_name));
```

The query must use the **exact same expression**:

```sql
SELECT * FROM users WHERE lower(email) = lower($1);   -- ✅
SELECT * FROM users WHERE email = $1;                  -- ❌ different expression
```

The expression must be `IMMUTABLE`. `now()`, `random()` and the one-argument `to_tsvector(text)` are not, and will be rejected.

:::info[PostgreSQL vs MySQL]
MySQL added functional indexes in **8.0.13**; before that you created a stored generated column and indexed it. Postgres has had expression indexes since forever, and they compose with partial indexes:

```sql
CREATE UNIQUE INDEX ON users (lower(email)) WHERE deleted_at IS NULL;
```
That single line — case-insensitive, unique, only among non-deleted rows — takes a generated column plus an application-level check on MySQL.
:::

---

## 5. Covering indexes and index-only scans

```sql
CREATE INDEX idx_orders_cover ON orders (customer_id) INCLUDE (status, total);
```

`INCLUDE` columns are stored in the **leaf pages only**, not in the tree — so they don't affect the index's sort order or size in the internal nodes, but they're available to satisfy a query without visiting the heap.

```sql
SELECT status, total FROM orders WHERE customer_id = 42;
```

```text
 Index Only Scan using idx_orders_cover on orders
   Index Cond: (customer_id = 42)
   Heap Fetches: 0                                ← the key number
```

:::danger[Index-only scans need VACUUM]
Because of MVCC, an index entry doesn't record whether the row is visible to your snapshot. Postgres checks the **visibility map**: if the page is marked all-visible, it can trust the index; otherwise it must fetch the heap tuple anyway.

`Heap Fetches: 0` means the VM is fresh. A high `Heap Fetches` on a supposedly index-only scan means the table hasn't been vacuumed recently and you're getting no benefit. **This is a Postgres-only concern** — InnoDB covering index scans have no such requirement.
:::

`INCLUDE` also lets you keep a unique constraint while covering extra columns:

```sql
CREATE UNIQUE INDEX ON users (email) INCLUDE (name, created_at);
-- uniqueness is still on email alone
```

:::info[PostgreSQL vs MySQL]
MySQL gets covering scans "for free" in a different way: every secondary index already contains the primary key columns, so an index on `(customer_id)` implicitly covers `(customer_id, id)`. And InnoDB never needs a visibility check. Postgres compensates with explicit `INCLUDE` (PG 11+) — arguably more precise, since you choose exactly what to carry, but you have to think about it. MySQL has no `INCLUDE` syntax; you add the columns to the index key instead, which does grow the tree.
:::

---

## 6. The other index types

### GIN — "many values per row"

```sql
CREATE INDEX ON posts USING GIN (tags);                          -- arrays
CREATE INDEX ON events USING GIN (payload jsonb_path_ops);       -- jsonb
CREATE INDEX ON articles USING GIN (search_vector);              -- full-text
CREATE INDEX ON products USING GIN (name gin_trgm_ops);          -- trigram LIKE '%x%'
```

Inverted index: **key → list of rows containing it**. Perfect when one row contains many indexable values. Larger and slower to update than B-tree; the `fastupdate` pending list batches writes and is flushed by autovacuum.

### GiST — "overlapping / spatial / nearest-neighbour"

```sql
CREATE INDEX ON bookings USING GIST (during);                    -- range overlap
CREATE INDEX ON shapes USING GIST (geom);                        -- PostGIS
CREATE INDEX ON products USING GIST (name gist_trgm_ops);        -- KNN fuzzy
ALTER TABLE bookings ADD EXCLUDE USING GIST (room_id WITH =, during WITH &&);
```

A balanced tree of *bounding boxes*. Lossy — results are rechecked — but it's the only type supporting `ORDER BY col <-> value` k-nearest-neighbour and exclusion constraints.

### BRIN — "huge, naturally ordered tables"

```sql
CREATE INDEX ON events USING BRIN (created_at);
CREATE INDEX ON events USING BRIN (created_at) WITH (pages_per_range = 32);
```

Stores only the **min and max** value per block range (128 pages by default).

```text
BRIN on created_at, 100 GB append-only events table

 block range 0–127     : min 2026-01-01 08:00, max 2026-01-01 09:14
 block range 128–255   : min 2026-01-01 09:14, max 2026-01-01 10:31
 ...

Query: created_at BETWEEN '2026-01-01 09:00' AND '2026-01-01 09:30'
  → skip every range whose [min,max] doesn't intersect
  → scan only the 2 surviving ranges

Index size: ~200 KB for 100 GB of data.  A B-tree would be ~30 GB.
```

**Requires physical correlation** between the column and row order — true for append-only timestamps, false after heavy updates or random inserts. Check it:

```sql
SELECT attname, correlation FROM pg_stats
WHERE tablename = 'events' AND attname = 'created_at';
-- close to 1.0 or -1.0 → BRIN is great.  Near 0 → BRIN is useless.
```

Tiny, nearly free to maintain, but far less selective than B-tree. **No MySQL equivalent.**

### Hash

```sql
CREATE INDEX ON sessions USING HASH (token);
```

Equality only, no ordering, no range, can't be unique, not usable for multi-column indexes. WAL-logged and crash-safe only since PG 10 (before that they were genuinely unsafe). Slightly smaller than B-tree for very long keys. **Usually just use a B-tree** — the niche is a very large text/UUID key where you only ever do `=`.

### SP-GiST

Space-partitioned GiST, for non-balanced structures: quadtrees, k-d trees, radix trees. Used for `inet`/`cidr` prefix matching, point data, and text prefix search. Rare in application code.

### Choosing — the decision table

| Data / query | Index |
| :--- | :--- |
| `=`, ranges, `ORDER BY`, `LIKE 'x%'` | **B-tree** |
| Array containment, `jsonb @>`, full text, trigram | **GIN** |
| Range overlap, geometry, exclusion constraints, KNN | **GiST** |
| Huge append-only table, time-correlated column | **BRIN** |
| Equality only on a very large key | Hash (rarely worth it) |
| IP prefixes, point data, text prefix trees | SP-GiST |

:::info[PostgreSQL vs MySQL — index types]
MySQL/InnoDB has **B-tree only**, plus `FULLTEXT`, `SPATIAL` (R-tree), and multi-valued indexes for JSON arrays. There is no GIN, no GiST, no BRIN, and MEMORY-engine hash indexes don't apply to InnoDB tables (which internally maintains an "adaptive hash index" you don't control).

So: no indexed `LIKE '%x%'`, no ad-hoc indexed JSON containment, no exclusion constraints, no tiny index for a 100 GB time-series table, no nearest-neighbour ordering. **This is probably the largest single capability gap between the two engines**, and it's worth being able to list concretely rather than saying "Postgres has more index types."
:::

---

## 7. When *not* to index

- **Low-cardinality columns alone.** An index on a boolean where 95 % of rows are `true` costs more than a scan — it reads most of the index *and* most of the heap. (A **partial** index on the rare value is the right answer.)
- **Small tables.** A cached sequential scan of 500 rows beats an index lookup.
- **Write-heavy, rarely-read tables** — audit logs, event ingestion. Every index taxes every insert.
- **Redundant prefixes.** `(a)` is dead weight if `(a, b)` exists. `(b)` is not.
- **Speculative indexes.** Every index consumes RAM that competes with your working set, so an unused index is not neutral — it's actively harmful.

### Find the dead weight

```sql
-- Unused indexes
SELECT s.relname AS table, s.indexrelname AS index,
       s.idx_scan AS scans,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0
  AND NOT i.indisunique          -- never drop a unique index blindly
ORDER BY pg_relation_size(s.indexrelid) DESC;
```

Judge this only after a **full business cycle** — a month-end report's index looks unused for 29 days.

```sql
-- Duplicate / redundant indexes
SELECT indrelid::regclass AS table, array_agg(indexrelid::regclass) AS duplicates
FROM pg_index
GROUP BY indrelid, indkey, indclass, indpred, indexprs IS NULL
HAVING count(*) > 1;
```

```sql
-- Index bloat, roughly
SELECT schemaname, relname, indexrelname,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes ORDER BY pg_relation_size(indexrelid) DESC LIMIT 20;
```

Rebuild bloated indexes online:

```sql
REINDEX INDEX CONCURRENTLY idx_orders_placed;    -- PG 12+
```

---

## 8. Maintenance and gotchas

### Build without blocking writes

```sql
CREATE INDEX CONCURRENTLY idx_orders_placed ON orders (placed_on);
```

Roughly 2× slower, cannot run inside a transaction block, and **on failure it leaves an invalid index**:

```sql
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
DROP INDEX CONCURRENTLY idx_orders_placed;
```

### Why isn't my index being used?

Work through this list:

1. **The table is small** — a seq scan is genuinely cheaper. Test with realistic data, not 50 rows.
2. **The predicate isn't sargable** — `WHERE lower(email) = x` needs an index on `lower(email)`; `WHERE amount + 1 > 100` needs rewriting as `amount > 99`.
3. **Type mismatch** — `WHERE bigint_col = '42'` is fine, but joining `text` to `int` forces a cast on the column side and kills the index.
4. **Low selectivity** — the query returns 30 % of the table, so a seq scan wins. That's correct behaviour.
5. **Stale statistics** — run `ANALYZE tablename` and re-check.
6. **Leading column not used** — `(a, b)` can't serve `WHERE b = 1` efficiently.
7. **Partial index predicate not provably implied** — especially with parameterised queries.
8. **`text_pattern_ops` missing** for `LIKE 'x%'` in a non-C locale.
9. **The index is invalid** from a failed `CONCURRENTLY` build.

Diagnose by forcing the alternative and comparing costs:

```sql
SET enable_seqscan = off;    -- session only, for DIAGNOSIS, never in production
EXPLAIN ANALYZE SELECT ...;
RESET enable_seqscan;
```

If the index version is genuinely faster but the planner chose a seq scan, the cost model is misinformed — usually stale statistics, a bad `n_distinct` estimate, or `random_page_cost` set for spinning disks (**on SSDs, set `random_page_cost = 1.1`**; the default of 4.0 assumes a disk head has to move, and it systematically discourages index scans).

---

## 9. Rapid-fire recall

<details>
<summary>**How do you order the columns of a composite index?**</summary>

Equality predicates first, then the `ORDER BY` columns, then range predicates last. Equality pins the leading keys to one value, which makes everything after that point a contiguous, already-sorted region of the index — so a sort key placed right after the equality columns is free. A range spans many values of its key and therefore interleaves the ordering of every column after it, which is why ranges must come last. For `WHERE status = 'paid' AND amount > 500 ORDER BY placed_on`, the index is `(status, placed_on, amount)`. This is B-tree physics, so it's identical on MySQL.
</details>

<details>
<summary>**Postgres heap tables vs InnoDB clustered indexes — what follows?**</summary>

InnoDB stores the rows inside the primary key's B-tree, so a PK range scan is physically sequential and every secondary index stores the PK value rather than a row pointer — which means a secondary lookup is two traversals, and a wide primary key bloats every secondary index. Postgres stores rows in an unordered heap and every index points at a physical location, so all indexes are equal, there's no clustering to design around, and a large PK costs nothing extra. The Postgres-specific consequence is that index-only scans depend on the visibility map, so a table that isn't vacuumed doesn't get them.
</details>

<details>
<summary>**What's a partial index and why does MySQL not having one matter?**</summary>

An index with a `WHERE` clause, so it only contains matching rows — much smaller, cheaper to maintain, and faster to scan. The two big uses are indexing a rare status in a huge table, like the pending rows of a job queue, and partial *unique* indexes such as "email is unique among rows where `deleted_at IS NULL`." MySQL has neither, so soft deletes plus uniqueness needs a generated-column hack or application-level enforcement. The Postgres caveat is that the planner must be able to prove the query predicate implies the index predicate, which a parameterised `status = $1` can't do.
</details>

<details>
<summary>**What is an index-only scan and what breaks it?**</summary>

A scan that answers the query entirely from the index without visiting the heap, which requires every referenced column to be in the index — as a key column or via `INCLUDE`. What breaks it in PostgreSQL specifically is visibility: the index doesn't record whether a row version is visible to your snapshot, so Postgres consults the visibility map, and if the page isn't marked all-visible it fetches the heap tuple anyway. So an unvacuumed table shows a high `Heap Fetches` count and gets little benefit. That whole concern doesn't exist on InnoDB.
</details>

<details>
<summary>**When would you use a BRIN index?**</summary>

On a very large table where the indexed column correlates strongly with physical row order — an append-only events or metrics table indexed on `created_at` being the standard case. BRIN stores only the min and max per block range, so it's kilobytes where a B-tree would be gigabytes, and range queries skip whole swathes of the table. The catch is that correlation is everything: check `pg_stats.correlation` for the column, and if it's near zero because of updates or random insert order, BRIN is useless. There's no MySQL equivalent.
</details>

<details>
<summary>**Name the index types and one use for each.**</summary>

B-tree for equality, ranges and ordering — the default and almost always the answer. GIN as an inverted index when one row holds many values: arrays, `jsonb` containment, full-text `tsvector`, and trigrams that make `LIKE '%x%'` indexed. GiST for overlapping and spatial data — range overlap, PostGIS geometry, exclusion constraints, and nearest-neighbour ordering. BRIN for huge physically-ordered tables. Hash for equality on a very large key, rarely worth it over a B-tree. SP-GiST for prefix and partitioned structures like IP ranges. InnoDB has only B-tree plus FULLTEXT and SPATIAL, which is the biggest concrete capability gap between the two engines.
</details>

<details>
<summary>**My query isn't using the index. How do you debug it?**</summary>

I'd walk a checklist. Is the table small enough that a sequential scan is genuinely cheaper — which is correct behaviour, not a bug. Is the predicate sargable, or is there a function or arithmetic wrapped around the column. Is there a type mismatch forcing a cast on the column side. Is the query returning a large fraction of the table, in which case a scan wins. Are the statistics stale — `ANALYZE` and retry. Is the leading column of a composite index actually used. Then I'd set `enable_seqscan = off` for the session and compare the two plans' actual times: if the index plan really is faster, the cost model is misinformed, and the usual culprits are stale statistics or `random_page_cost` left at the spinning-disk default of 4.0 when it should be about 1.1 on SSD.
</details>

<details>
<summary>**When would you deliberately not add an index?**</summary>

On a low-cardinality column on its own, where the index reads most of itself plus most of the heap and loses to a scan — though a partial index on the rare value is often perfect. On small tables. On write-heavy, rarely-queried tables like audit logs, since every index taxes every write and, in Postgres specifically, an index on a frequently-updated column disqualifies HOT updates. And any index that's a redundant prefix of another. Operationally I'd check `pg_stat_user_indexes` for zero-scan indexes after a full business cycle and drop them — an unused index isn't free, it competes for cache with your working set.
</details>

---

**Next:** [EXPLAIN & the Query Planner →](./14-explain-and-the-planner.md)
