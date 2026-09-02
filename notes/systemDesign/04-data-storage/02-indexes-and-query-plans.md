---
title: Indexes & Query Plans
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Indexes & Query Plans

> **What you will be able to do after this page**
>
> - Trace a query from SQL text to result set, and say where the time actually goes.
> - Read an `EXPLAIN` plan and find the expensive step.
> - Order the columns in a composite index correctly, and explain the rule.
> - Recognise the four ways a query silently stops using an index it looks like it should use.

<C color="orange">A missing index is the single most common cause of a slow application</C>, and it is usually a one-line fix. This page is about seeing why.

<Plain>

You have a 900-page reference book and need everything it says about "hydraulics".

**Without an index**, you read page 1, then page 2, and keep going to page 900. You will certainly find every mention — and it takes all day. That is a **full table scan**: correct, thorough, and proportional to the size of the book.

**With the index at the back**, you flip to "H", find *hydraulics — 312, 447, 589*, and turn to three pages. Seconds instead of hours.

Three things about that index are worth noticing, because each has a direct equivalent in a database.

**It is a second copy of information**, ordered differently. The book got thicker to make searching faster. An index costs storage.

**It has to be maintained.** Add a paragraph about hydraulics on page 500 and the index is wrong until someone updates it. So every write to the table also writes to the index — <C color="orange">indexes make reads faster and writes slower</C>, always.

**It is sorted by one thing.** Sorted by topic, it cannot answer *"what is on page 447?"* — for that you just turn to the page. Which is why the ordering of an index decides which questions it can answer, and that turns out to be the subtlest part of the whole topic.

</Plain>

---

## 1. What an index is

A separate, sorted structure mapping **values → locations of rows**.

```
  TABLE (heap) — rows in insertion order, unordered
  ┌────┬──────────┬────────────┬──────────┐
  │ id │ email    │ created_at │ …        │
  ├────┼──────────┼────────────┼──────────┤
  │ 7  │ zoe@…    │ 2024-03-01 │          │  page 41
  │ 2  │ amy@…    │ 2026-01-15 │          │  page 41
  │ 9  │ raj@…    │ 2025-07-22 │          │  page 42
  └────┴──────────┴────────────┴──────────┘

  INDEX on (email) — sorted, with pointers back
  ┌──────────┬──────────────┐
  │ amy@…    │ → page 41    │
  │ raj@…    │ → page 42    │
  │ zoe@…    │ → page 41    │
  └──────────┴──────────────┘
```

Nearly all relational indexes are **B+ trees**: balanced, with all values in the leaves, and leaves linked together so range scans walk sideways without returning to the root.

<Jargon
  plain="Reading every row in the table because there is no faster way in."
  term="a full table scan, or sequential scan"
  also={['seq scan', 'table scan']}>

<C color="crimson">Seeing this in a plan for a query that should return three rows is the classic signal of a missing index.</C> But a scan is not always wrong — for a query returning most of the table, scanning is genuinely faster than an index, and a good planner knows it.

</Jargon>

**Why the tree is so shallow.** A B+ tree node is one disk page — typically 8 KB — holding hundreds of keys. With a fanout of ~500:

```
  depth 1:            500 rows
  depth 2:        250,000 rows
  depth 3:    125,000,000 rows
  depth 4: 62,500,000,000 rows
```

<H>Finding one row among a hundred million takes about four page reads. That is the entire reason indexes work — the depth grows logarithmically while your table grows linearly.</H>

---

## 2. A query, traced

This is the thing worth seeing in full. One query, from text to result, with the cost accumulating at each step.

```sql
SELECT id, title, created_at
FROM   posts
WHERE  user_id = 42
  AND  status  = 'published'
ORDER BY created_at DESC
LIMIT 20;
```

The table holds **10 million rows**; user 42 has **380 posts**, of which **38 are published**.

<Trace title="SELECT … WHERE user_id = 42 … LIMIT 20" subtitle="10M rows. Watch the cost accumulate — and notice which step dominates.">

<TraceStep
  title="Parse — text becomes a tree"
  state={{ 'Rows in play': '—', 'Access method': '—', 'Page reads': '0', 'Sort needed': 'unknown', 'Elapsed': '~0.1 ms' }}
  note="Cheap, and cached. Prepared statements skip straight past this.">

The SQL string is tokenised and turned into a syntax tree. Table and column names are resolved against the catalogue; types are checked.

</TraceStep>

<TraceStep
  title="Plan — the optimiser considers the options"
  state={{ 'Rows in play': 'est. 40', 'Access method': 'idx_posts_user_created', 'Page reads': '0', 'Sort needed': 'to be decided', 'Elapsed': '~0.3 ms' }}
  changed={['Rows in play', 'Access method']}
  note="The estimate comes from statistics gathered by ANALYZE — not from looking at the data. Stale statistics are a common cause of a bad plan.">

The planner enumerates strategies and costs each one:

- **Sequential scan:** read all 10M rows, filter. Cost ≈ 10M row reads.
- **Index on `(user_id, created_at)`:** jump to user 42, walk in `created_at` order. Estimated ~40 matching rows.
- **Index on `(status)`:** millions of rows are `published` — <C color="crimson">useless, too unselective</C>.

<C color="green">It picks the composite index.</C>

</TraceStep>

<TraceStep
  title="Descend the B+ tree"
  cost="3 page reads"
  state={{ 'Rows in play': 'est. 40', 'Access method': 'index scan', 'Page reads': '3', 'Sort needed': 'no', 'Elapsed': '~0.4 ms' }}
  changed={['Page reads', 'Sort needed']}
  note="Three reads to locate one position among 10 million rows. Almost certainly all three are already in memory.">

Root → internal → leaf, following `user_id = 42`. The tree is 3 levels deep for this table size.

</TraceStep>

<TraceStep
  title="Walk the leaves — and stop early"
  cost="+1 page read"
  state={{ 'Rows in play': '38 pointers', 'Access method': 'index scan', 'Page reads': '4', 'Sort needed': 'no', 'Elapsed': '~0.5 ms' }}
  changed={['Rows in play', 'Page reads']}
  note="Because the index is sorted by created_at DESC within the user, rows arrive already in the requested order.">

Leaf entries for user 42 are **contiguous and already ordered by `created_at`**. The scan walks sideways collecting row pointers.

<C color="green">The `ORDER BY` is satisfied for free — no sort step is needed at all.</C>

</TraceStep>

<TraceStep
  title="Heap fetch — the expensive step"
  cost="+38 random reads"
  state={{ 'Rows in play': '38 rows', 'Access method': 'index scan + heap', 'Page reads': '42', 'Sort needed': 'no', 'Elapsed': '~2.5 ms' }}
  changed={['Rows in play', 'Page reads', 'Elapsed']}
  note="This one step is 90% of the query's cost. Everything before it was four page reads.">

The index holds `user_id` and `created_at`, but the query also wants `title` and `status` — which live in the table. So for each of the 38 pointers, the engine fetches the actual row.

<C color="crimson">Those 38 reads are scattered across the disk</C> — the rows were inserted at different times and sit on unrelated pages.

</TraceStep>

<TraceStep
  title="Filter, limit, return"
  state={{ 'Rows in play': '20 rows', 'Access method': 'index scan + heap', 'Page reads': '42', 'Sort needed': 'no', 'Elapsed': '~2.6 ms' }}
  changed={['Rows in play']}
  note="42 page reads instead of ~120,000 for a full scan. Roughly 3,000× less work.">

`status = 'published'` is applied to the fetched rows, and `LIMIT 20` stops the pipeline.

**Total: 42 page reads, ~2.6 ms.** A sequential scan would have read the whole table.

</TraceStep>

<TraceStep
  title="Now make the index covering"
  cost="4 page reads total"
  state={{ 'Rows in play': '20 rows', 'Access method': 'index-only scan', 'Page reads': '4', 'Sort needed': 'no', 'Elapsed': '~0.6 ms' }}
  changed={['Access method', 'Page reads', 'Elapsed']}
  note="INCLUDE (title, status) stores the extra columns in the index leaves, so the table is never touched.">

Change the index to `(user_id, created_at) INCLUDE (title, status)`.

Now every column the query needs is **in the index itself**. The heap fetch disappears entirely.

<H>42 page reads become 4. The optimisation was not adding an index — an index was already being used. It was removing the trip back to the table.</H>

</TraceStep>

</Trace>

---

## 3. Reading `EXPLAIN`

`EXPLAIN ANALYZE` runs the query and reports what actually happened.

```sql
EXPLAIN ANALYZE SELECT ... ;
```

```
Limit  (cost=0.43..8.51 rows=20 width=48) (actual time=0.031..2.585 rows=20 loops=1)
  ->  Index Scan using idx_posts_user_created on posts
        (cost=0.43..152.30 rows=40 width=48)
        (actual time=0.029..2.560 rows=38 loops=1)
        Index Cond: (user_id = 42)
        Filter: (status = 'published'::text)
        Rows Removed by Filter: 342
Planning Time: 0.284 ms
Execution Time: 2.601 ms
```

What to look at, in order of usefulness:

| Read this | It tells you |
| :--- | :--- |
| **`actual time`** on the deepest node | Where the time really goes. Read the plan **inside-out** |
| **`rows` estimated vs actual** | A large mismatch means stale statistics and probably a bad plan |
| **`Rows Removed by Filter`** | Work done and thrown away — often an index that could be extended |
| **Node types** | `Seq Scan` on a big table, or `Sort` when an index could have supplied order |
| **`loops`** | A high count means this node ran per outer row — the N+1 pattern, in SQL form |

In the plan above, `Rows Removed by Filter: 342` is the signal: <C color="orange">380 rows were fetched to return 38.</C> Adding `status` to the index would let the engine skip them without reading them.

<Depth title="How the planner actually chooses, and how to make it choose badly">

The optimiser is a **cost-based** system. It enumerates candidate plans and picks the cheapest estimate — and understanding what feeds those estimates explains nearly every "why isn't it using my index?" mystery.

**Where the numbers come from.** `ANALYZE` samples the table and stores, per column: the fraction of NULLs, the number of distinct values, a list of most-common values with their frequencies, and a histogram of the value distribution. From these it estimates **selectivity** — what fraction of rows a condition will match.

For `WHERE user_id = 42`, if `n_distinct` is 250,000 over 10M rows, it estimates 40 rows. That estimate drives everything downstream.

**The cost model** combines estimated row counts with tunable constants: `seq_page_cost` (1.0 by default), `random_page_cost` (4.0), `cpu_tuple_cost` (0.01). The 4:1 ratio encodes an assumption from the spinning-disk era — that a random read costs four times a sequential one. <C color="orange">On SSDs that ratio is closer to 1.1, and leaving `random_page_cost` at 4.0 systematically biases the planner *away* from index scans</C>. It is one of the highest-value one-line tuning changes on modern hardware.

**The four ways estimates go wrong**, which is where bad plans come from:

**1. Stale statistics.** A table loaded with 10M rows since the last `ANALYZE` still has statistics saying it holds 1,000. The planner picks a plan appropriate for a tiny table. Classic after a bulk import or a migration.

**2. Correlated columns.** The planner assumes independence. For `WHERE city = 'Paris' AND country = 'France'`, it multiplies the two selectivities — but they are almost perfectly correlated, so it may estimate 100 rows where 50,000 match. Postgres offers `CREATE STATISTICS` to declare the correlation explicitly.

**3. Skewed distributions.** `n_distinct` of 250,000 implies an even 40 rows each. If user 42 is a bot with 2 million posts, the estimate is off by 50,000×. The most-common-values list captures *some* skew, but only for the top values it retains.

**4. Expressions the planner cannot see through.** `WHERE lower(email) = 'x'` cannot use an index on `email`, because the planner has no statistics for `lower(email)` and no index on that expression. An **expression index** — `CREATE INDEX ON users (lower(email))` — fixes both problems at once.

**Diagnosis in one step.** Run `EXPLAIN ANALYZE` and compare `rows=N` (estimated) against `actual rows=M`. <C color="green">If they are within a small factor, the plan is probably right even if the query is slow — the problem is elsewhere.</C> If they differ by 100× or more, the planner was working from bad information, and the fix is statistics, not a query rewrite.

**On planner hints.** Postgres deliberately provides none, on the reasoning that hints become permanently wrong as data distributions shift, while a cost model adapts. MySQL and Oracle allow them. The pragmatic view: hints are a way to freeze today's answer into your code, which is occasionally what you want and usually a debt.

</Depth>

---

## 4. Composite indexes and column order

An index on `(a, b, c)` sorts by `a`, then `b` within equal `a`, then `c`. That ordering decides which queries it can serve.

<Jargon
  plain="An index on several columns can only be used from the left, like a phone book sorted by surname then first name."
  term="the leftmost prefix rule"
  also={['prefix rule', 'index column ordering']}>

A phone book sorted by (surname, first name) answers *"everyone called Patel"* and *"Patel, Anita"* — but is useless for *"everyone called Anita"*, because Anitas are scattered throughout. <C color="orange">A composite index works the same way, and this rule explains most cases of "the index exists but isn't used".</C>

</Jargon>

With an index on `(user_id, status, created_at)`:

| Query | Uses the index? |
| :--- | :--- |
| `WHERE user_id = 42` | <C color="green">Yes</C> — leftmost column |
| `WHERE user_id = 42 AND status = 'x'` | <C color="green">Yes</C> — first two |
| `WHERE user_id = 42 AND status = 'x' ORDER BY created_at` | <C color="green">Yes, fully</C> — sort comes free |
| `WHERE user_id = 42 AND created_at > '…'` | <C color="orange">Partly</C> — seeks on `user_id`, then filters; `status` gap blocks the range |
| `WHERE status = 'x'` | <C color="crimson">No</C> — skips the leftmost column |
| `WHERE created_at > '…'` | <C color="crimson">No</C> |

### Ordering the columns

Two rules, in priority order:

1. **Equality before range.** Columns compared with `=` come first; the one compared with `>`, `<` or `BETWEEN` comes last. A range consumes the ordering — anything after it in the index is no longer sorted usefully.
2. **Then most selective first.** Among equality columns, put the one that eliminates the most rows first.

```sql
-- for: WHERE tenant_id = ? AND status = ? AND created_at > ?
CREATE INDEX ON events (tenant_id, status, created_at);
--                      └── equality ──┘  └── range ──┘
```

<C color="crimson">A frequent mistake is putting a low-cardinality column like `status` first</C> because it appears in every query. With three possible values it eliminates almost nothing, and it blocks the more selective column behind it.

---

## 5. Why an index gets ignored

Four causes, and once you know them they are easy to spot.

**A function on the column.** `WHERE lower(email) = 'a@b.com'` cannot use an index on `email`. The index stores the original values; the planner cannot invert the function. <C color="green">Fix: an expression index</C> — `CREATE INDEX ON users (lower(email))`.

**A type mismatch.** `WHERE user_id = '42'` where `user_id` is an integer forces a cast, sometimes on the column side, which disables the index. Subtle in ORMs and dynamic languages.

**Leading wildcard.** `LIKE '%son'` cannot use a B-tree, because the tree is sorted from the left and there is no starting point. `LIKE 'john%'` works fine. <C color="green">For genuine substring search use a trigram index or a search engine.</C>

**The planner decided a scan is cheaper.** If a query matches 40% of the table, an index scan means 40% of the rows fetched *randomly* plus the index reads — genuinely slower than reading everything sequentially. <C color="orange">This is the planner being right, and the fix is a more selective query, not a hint.</C>

---

## 6. The cost of indexes

Indexes are not free, and the bill arrives on the write path.

| Cost | Detail |
| :--- | :--- |
| **Write amplification** | Every `INSERT` writes to the table **and every index on it**. Eight indexes means nine writes |
| **Storage** | An index on a wide column can approach the table's own size |
| **Memory pressure** | Indexes compete for the buffer cache; too many and none stays hot |
| **Update cost** | Changing an indexed column means deleting and reinserting an index entry |

<H>The right number of indexes is the smallest set that covers your actual queries. Adding one "just in case" is a permanent tax on every write for a benefit that may never arrive.</H>

Worth auditing periodically: `pg_stat_user_indexes` reports scans per index. <C color="crimson">An index with zero scans since the last statistics reset is pure cost</C> — and unused indexes accumulate quietly, usually left behind by queries that were rewritten or features that were removed.

---

## 7. In a design discussion

- **"A composite index on `(user_id, created_at)` — equality first, range last, so the `ORDER BY` is satisfied by the index and there's no sort step."** Shows the rule and the payoff.
- **"I'd make it covering with `INCLUDE (title)` to avoid the heap fetch — that's where the time actually goes."** Names the dominant cost.
- **"`EXPLAIN ANALYZE` and compare estimated against actual rows. A 100× gap means stale statistics, not a bad query."** A real diagnostic method.
- **"`random_page_cost` at 4.0 is a spinning-disk assumption; on SSD it biases the planner away from indexes."** Specific and frequently true.

---

## Rapid-fire recall

1. What is an index physically, and what two ongoing costs does it impose?
2. Why is a B+ tree over 100M rows only about four levels deep?
3. In the traced query, which step dominated the cost, and why was it expensive?
4. What is a covering index, and how did it reduce 42 page reads to 4?
5. Why did the query need no sort step?
6. In `EXPLAIN ANALYZE`, what does a large gap between estimated and actual rows indicate?
7. What does `Rows Removed by Filter` suggest you might do?
8. State the leftmost prefix rule with the phone-book analogy.
9. Give the two rules for ordering columns in a composite index, and the common mistake.
10. Name the four reasons an index is ignored, and say which one is the planner being correct.

<details>
<summary>Answers</summary>

1. A **separate, sorted structure mapping values to row locations** — a second copy of some data, ordered differently. Costs: **write amplification** (every insert updates every index) and **storage**, plus buffer-cache pressure.
2. Because a node is one ~8 KB page holding hundreds of keys, giving a fanout around 500. Depth grows **logarithmically**: 500 → 250K → 125M rows at depths 1, 2 and 3.
3. The **heap fetch** — 38 random reads to retrieve the actual rows, ~90% of total cost. Expensive because those rows were inserted at different times and sit scattered on unrelated pages.
4. An index containing **every column the query needs**, so the table is never touched. Adding `INCLUDE (title, status)` eliminated all 38 heap fetches, leaving only the 4 index page reads — an **index-only scan**.
5. Because the index was sorted by `created_at` **within** each `user_id`, so rows arrived already in the requested order. The `ORDER BY` was satisfied by the index's physical ordering.
6. That the planner worked from **bad statistics** — stale, or defeated by correlated columns, skewed distributions, or an expression it cannot see through. The fix is usually `ANALYZE` or `CREATE STATISTICS`, not a query rewrite.
7. That rows were **fetched and then discarded**. Adding the filtered column to the index lets the engine skip them without reading them at all.
8. A composite index can only be used **from the left**. Like a phone book sorted by (surname, first name): it answers "everyone called Patel" and "Patel, Anita", but not "everyone called Anita" — those are scattered throughout.
9. **Equality columns first, range column last** (a range consumes the ordering, so nothing after it is usefully sorted); then **most selective first** among the equality columns. The common mistake is putting a low-cardinality column like `status` first because it appears in every query — it eliminates almost nothing and blocks the selective column behind it.
10. **A function on the column** · **a type mismatch forcing a cast** · **a leading wildcard** (`LIKE '%son'`) · **the planner judging a scan cheaper**. The last is the planner being **right** — for a query matching a large fraction of the table, sequential reading genuinely beats scattered random fetches.

</details>

---

**Next:** [Storage Engines — B-Tree vs LSM](./03-storage-engines.md) — why some databases are fast to write and others fast to read.
