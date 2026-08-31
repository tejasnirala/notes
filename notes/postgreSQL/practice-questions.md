---
title: Practice Questions
---

# Practice Questions

34 problems, arranged from fundamentals to senior-level patterns. **Every solution includes a step-by-step trace** showing the row set after each clause — so when your answer differs, you can see exactly where it diverged.

:::tip[How to get value out of these]
1. Read the question and the sample data.
2. **Write the query before opening the solution.** Reading solutions builds recognition; writing them builds recall.
3. Open the solution and follow the trace clause by clause. Check your predicted row count after each step against the trace.
4. Read the callouts. Most questions contain a deliberate trap, and the trap is the actual lesson.
:::

---

## [Beginner — Questions 1–10](./24-beginner-queries.md)

Clause evaluation order, `NULL`, joins that duplicate and drop, and the aggregate traps.

| Q | Topic | The lesson |
| :-- | :--- | :--- |
| 1 | `WHERE` + `ORDER BY` + `LIMIT` | A sort without a unique tiebreaker is non-deterministic |
| 2 | Aliases in `WHERE` | Evaluation order — and why wrapping a column kills the index |
| 3 | `NULL` semantics | `= NULL` never matches; `<> 'x'` silently drops NULLs |
| 4 | `INNER JOIN` cardinality | Joins duplicate the one side and drop unmatched rows |
| 5 | `ON` vs `WHERE` in a `LEFT JOIN` | A `WHERE` on the right side turns it into an inner join |
| 6 | `WHERE` vs `HAVING` | Two valid queries, two different numbers |
| 7 | `count(*)` vs `count(col)` | After a `LEFT JOIN`, `count(*)` counts the phantom NULL row |
| 8 | `RETURNING` + `ON CONFLICT` | Generated values in one round trip; conditional upsert |
| 9 | `DISTINCT ON` | Latest row per group, and the portable equivalent |
| 10 | Reports with no gaps | `generate_series` + `LEFT JOIN` + `coalesce`, three traps at once |

## [Intermediate — Questions 11–22](./25-intermediate-queries.md)

Windows, CTEs, `LATERAL`, and choosing between approaches that give the same answer.

| Q | Topic | The lesson |
| :-- | :--- | :--- |
| 11 | `PARTITION BY` | Aggregate alongside the detail — 8 rows in, 8 rows out |
| 12 | Running totals | `ROWS` vs `RANGE`: the default frame is a bug factory |
| 13 | Top N per group | Window vs `LATERAL` vs `DISTINCT ON`, with the cost model |
| 14 | `lag` / period-over-period | Keep date keys typed; format only at the end |
| 15 | `EXISTS` vs `IN` vs `JOIN` | Semi-join semantics, and why `NOT IN` returns nothing |
| 16 | `GROUPING SETS` / `ROLLUP` | Subtotals and grand total in one pass; `GROUPING()` |
| 17 | Pivoting | `FILTER` beats `CASE`; JSON for the dynamic case |
| 18 | Fan-out | Two one-to-many joins multiply — the most dangerous SQL bug |
| 19 | Gaps and islands | `value - row_number()` is constant inside a run |
| 20 | Recursive CTEs | The working table, traced iteration by iteration |
| 21 | Pagination | `OFFSET` is O(n); keyset is O(1) and stable |
| 22 | Data-modifying CTEs | Atomic archive-and-report in one statement |

## [Advanced — Questions 23–34](./26-advanced-queries.md)

The patterns senior interviews actually probe.

| Q | Topic | The lesson |
| :-- | :--- | :--- |
| 23 | JSONB shredding | `jsonb_to_recordset` + the parent double-count; three indexing options |
| 24 | Exclusion constraints | Making double-booking structurally impossible |
| 25 | Full-text search | Ranking isn't indexable; never `to_tsquery` user input |
| 26 | Job queue | `SKIP LOCKED` + a partial index; queue of jobs, not of workers |
| 27 | Reading `EXPLAIN` | Four diagnostic signatures, 2814 ms → 119 ms |
| 28 | Partitioning | The unique-key rule, pruning, and the DEFAULT partition trap |
| 29 | Concurrency | Atomic update, `FOR UPDATE`, optimistic, and write skew |
| 30 | Deduplication | `row_number()` needs a unique tiebreaker to be repeatable |
| 31 | Arrays + GIN | `@>` is indexable, `= ANY` is not |
| 32 | Two rankings | `FILTER` computes both aggregates in one pass |
| 33 | Faceted search | One round trip, one evaluation, four consistent outputs |
| 34 | Bloat forensics | Four things that pin the xmin horizon |

---

## Before you start

If any of these are shaky, read the concept page first — the questions assume them:

- [Logical evaluation order](./04-sql-fundamentals.md) — `FROM → JOIN → WHERE → GROUP BY → HAVING → WINDOW → SELECT → DISTINCT → ORDER BY → LIMIT`.
- [`NULL` is not a value](./04-sql-fundamentals.md) — three-valued logic, and why `NOT IN` is dangerous.
- [Joins duplicate and drop](./05-joins-and-set-operations.md) — and `ON` versus `WHERE` on an outer join.
- [`GROUP BY` destroys the rows](./06-aggregation-and-grouping.md) — only the key and aggregates survive.
- [Window frames](./07-window-functions.md) — `ROWS` versus `RANGE`, and why you can't filter on a window in `WHERE`.

---

## The five sentences these questions keep proving

1. **A `WHERE` on the right side of a `LEFT JOIN` makes it an `INNER JOIN`.**
2. **`WHERE` filters rows, `HAVING` filters groups** — different questions, different numbers.
3. **`ORDER BY` without a unique tiebreaker is non-deterministic** — and silently breaks pagination and dedup.
4. **Joining two one-to-many children and then aggregating always double-counts.**
5. **The default window frame is `RANGE`, which groups peers** — write `ROWS` unless you mean otherwise.
