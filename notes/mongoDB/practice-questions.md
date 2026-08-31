---
title: Practice Questions
---

# Practice Questions

32 aggregation problems, arranged from fundamentals to senior-level patterns. **Every solution includes a stage-by-stage trace** showing what the document stream looks like after each stage — so when your answer differs, you can see exactly where it diverged.

:::tip[How to get value out of these]
1. Read the question and the sample data.
2. **Write the pipeline before opening the solution.** Reading solutions builds recognition; writing them builds recall.
3. Open the solution and read the trace stage by stage. Check your predicted document count after each stage against the trace.
4. Read the callouts. Most questions have a deliberate trap, and the trap is the actual lesson.
:::

---

## [Beginner — Questions 1–8](./08-beginner-aggregation.md)

The fundamental stages and the traps that hide inside them.

| Q | Topic | The lesson |
| :-- | :--- | :--- |
| 1 | `$match` + `$sort` | Why filtering first is an index decision, not a style one |
| 2 | `$project` computed fields | A missing field produces an *omitted* result, not `null` |
| 3 | `$ifNull` | `$ifNull` catches null and missing — but not `""` |
| 4 | `$group` basics | The missing `$` bug, and that `$group` destroys every other field |
| 5 | `$avg` | `$avg` skips nulls, so the divisor isn't what you think |
| 6 | `$match` + `$group` | `WHERE` semantics: the filter changes the population |
| 7 | Multiple accumulators | `$sum: 1` counts nulls, `$avg` doesn't — two numbers that won't reconcile |
| 8 | `$lookup` + `$unwind` | The `preserveNullAndEmptyArrays` bug that silently deletes rows |

## [Intermediate — Questions 9–20](./09-intermediate-aggregation.md)

Multi-stage transformations, and choosing between approaches that give the same answer.

| Q | Topic | The lesson |
| :-- | :--- | :--- |
| 9 | `$match` after `$group` | `WHERE` vs `HAVING`, with data where the numbers actually differ |
| 10 | `$bucket` | Boundaries are `[inclusive, exclusive)` and empty buckets vanish |
| 11 | `$facet` | Count + page in one scan; the shared prefix runs once |
| 12 | Category insights | Round once at the end, not inside the group |
| 13 | `$size` | Count the array in place — no `$unwind` needed |
| 14 | `$unwind` + `$group` | The same answer the hard way, and why `$sum: 1` is wrong here |
| 15 | Explode then collapse | When `$unwind` is genuinely required |
| 16 | Top 3 | Top-N-per-group, classic form and `$topN` |
| 17 | Revenue per customer | `$reduce` beats `$unwind` — 3 documents vs 500,000 |
| 18 | `$filter` | Filtering documents vs filtering array elements |
| 19 | `$map` | `$filter`/`$map`/`$reduce` compose exactly like JavaScript |
| 20 | Date grouping | Never group by month without the year; always pass a `timezone` |

## [Advanced — Questions 21–32](./10-advanced-aggregation.md)

The patterns that show up in senior interviews.

| Q | Topic | The lesson |
| :-- | :--- | :--- |
| 21 | `$$ROOT` + `$replaceRoot` | The "latest per group" idiom, and the faster pipeline-`$lookup` version |
| 22 | `$$REMOVE` | Empty array instead of `[null]` — and why the pipeline shouldn't exist |
| 23 | Movies by decade | Keep keys typed; format only at the end |
| 24 | Conditional grouping | The `$cond` + `$sum` pivot idiom; the phantom-row bug |
| 25 | Top per subject | `$sort` keys are field names — no `$` prefix |
| 26 | Ties | `$rank` vs `$denseRank` vs `$documentNumber` |
| 27 | Pipeline `$lookup` | 50,000 documents materialised vs 1 |
| 28 | City analytics | A missing city and a zero city are different answers |
| 29 | Cross-collection top-N | Reduce before you join |
| 30 | `$reduce` | The accumulator traced step by step |
| 31 | `$setWindowFields` | Aggregate without collapsing; window bounds by document vs by range |
| 32 | `$unionWith` | It's `UNION ALL` — tag each side before merging |

---

## Before you start

If any of these are shaky, read the concept page first — the questions assume them:

- [`$group` destroys the document](./05-aggregation-fundamentals.md) — the single most important rule.
- [Stage vs expression](./05-aggregation-fundamentals.md) — and why `"$field"` needs the dollar sign.
- [`$lookup` is a left outer join returning an array](./05-aggregation-fundamentals.md).
- [`$unwind` drops documents with empty arrays](./05-aggregation-fundamentals.md).
