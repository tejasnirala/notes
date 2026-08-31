---
title: Aggregation & Grouping
---

# Aggregation & Grouping

> **What you will be able to do after this page**
>
> - Trace `GROUP BY` collapsing rows into groups, and explain exactly which columns survive.
> - Use `FILTER` to write conditional aggregates without `CASE` noise.
> - Produce subtotals and grand totals in one pass with `GROUPING SETS`, `ROLLUP` and `CUBE`.
> - Pivot rows to columns, aggregate arrays and JSON, and use ordered-set aggregates like `percentile_cont`.

---

## 1. The sample data

```sql
-- sales
 id | region | product | qty | amount | sold_on
----+--------+---------+-----+--------+-----------
  1 | North  | laptop  |  3  |  3000  | 2026-01-05
  2 | North  | phone   |  5  |  2500  | 2026-01-20
  3 | South  | laptop  |  1  |  1000  | 2026-02-11
  4 | South  | phone   |  4  |  2000  | 2026-02-14
  5 | South  | tablet  |  2  |   600  | 2026-03-02
  6 | East   | laptop  |  1  |  1000  | 2026-03-09
```

---

## 2. `GROUP BY`, traced

```sql
SELECT region, count(*) AS orders, sum(amount) AS revenue, avg(amount)::numeric(10,2) AS avg_order
FROM sales
GROUP BY region;
```

```text
INPUT (6 rows)                    GROUPING                 OUTPUT (3 rows)
────────────────────────────────────────────────────────────────────────────
 1 North laptop 3000  ┐
                      ├──▶ "North" ──▶ { region:North, orders:2, revenue:5500, avg:2750.00 }
 2 North phone  2500  ┘

 3 South laptop 1000  ┐
 4 South phone  2000  ├──▶ "South" ──▶ { region:South, orders:3, revenue:3600, avg:1200.00 }
 5 South tablet  600  ┘

 6 East  laptop 1000  ───▶ "East"  ──▶ { region:East,  orders:1, revenue:1000, avg:1000.00 }

6 rows → 3 rows
```

:::danger[After `GROUP BY`, the individual rows are gone]
Only the **grouping keys** and **aggregates over the group** are selectable. `product` no longer has a single value for the North group, so:

```sql
SELECT region, product, sum(amount) FROM sales GROUP BY region;
-- ERROR: column "sales.product" must appear in the GROUP BY clause
--        or be used in an aggregate function
```

If you want a representative value, say which one: `min(product)`, `array_agg(product)`, or a window function instead of a group.

This is exactly the same rule as MongoDB's "`$group` destroys the document."
:::

### The functional-dependency exception

```sql
SELECT c.id, c.name, c.city, count(o.id)
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id;              -- ✅ legal: c.id is the PRIMARY KEY, so name/city are determined
```

Grouping by a table's primary key lets you select any other column of that table unaggregated. It's SQL-standard, Postgres implements it, and it saves a lot of noise.

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| Non-grouped, non-aggregated columns are a **hard error** | Was silently allowed pre-5.7, returning an **arbitrary** row's value |
| — | `ONLY_FULL_GROUP_BY` is on by default from 5.7.5, matching Postgres |
| PK functional dependency recognised | Also recognised in 5.7+ |
| `GROUP BY` does **not** imply ordering | Pre-5.7 MySQL implicitly sorted by the grouping columns, so lots of old code omits `ORDER BY` and breaks on port |
| `GROUP BY 1, 2` (ordinal positions) supported | Supported |
| Can `GROUP BY` an output alias (non-standard extension) | Supported |

The implicit-ordering difference is a quiet one: MySQL code written before 5.7 often relies on `GROUP BY` returning sorted results. Postgres uses hash aggregation and returns groups in arbitrary order. **Always write `ORDER BY` explicitly.**
:::

---

## 3. The aggregate functions

| Function | Notes |
| :--- | :--- |
| `count(*)` | Counts rows, including all-NULL rows |
| `count(col)` | Counts **non-NULL** values only |
| `count(DISTINCT col)` | Distinct non-NULL values (expensive — sorts or hashes) |
| `sum`, `avg`, `min`, `max` | **All ignore NULLs.** `sum` of zero rows is `NULL`, not `0` |
| `bool_and`, `bool_or`, `every` | Boolean aggregation |
| `array_agg(x ORDER BY y)` | Collect into an array, optionally ordered |
| `string_agg(x, ',' ORDER BY y)` | Collect into a delimited string |
| `jsonb_agg`, `jsonb_object_agg` | Collect into JSON |
| `stddev`, `variance`, `corr`, `regr_slope` | Statistics |
| `percentile_cont(0.5) WITHIN GROUP (ORDER BY x)` | Median (interpolated) |
| `percentile_disc(0.5) WITHIN GROUP (ORDER BY x)` | Median (actual data point) |
| `mode() WITHIN GROUP (ORDER BY x)` | Most common value |

```sql
SELECT coalesce(sum(amount), 0) FROM sales WHERE region = 'West';  -- 0, not NULL
SELECT array_agg(product ORDER BY amount DESC) FROM sales WHERE region = 'South';
-- → {phone,laptop,tablet}
SELECT string_agg(DISTINCT region, ', ' ORDER BY region) FROM sales;
-- → 'East, North, South'
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS median_amount FROM sales;
-- → 1500
```

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| `string_agg(x, ',' ORDER BY y)` | `GROUP_CONCAT(x ORDER BY y SEPARATOR ',')` |
| No length limit on the result | `GROUP_CONCAT` **silently truncates at `group_concat_max_len` (1024 bytes by default)** |
| `array_agg`, `jsonb_agg`, `jsonb_object_agg` | `JSON_ARRAYAGG`, `JSON_OBJECTAGG` (8.0+); no array type |
| `percentile_cont` / `percentile_disc` / `mode()` | **No percentile or median function at all** — emulate with window functions or user variables |
| `FILTER (WHERE ...)` clause | Not supported — use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` |
| `bool_and` / `bool_or` | `MIN`/`MAX` on 0/1, or `BIT_AND`/`BIT_OR` |

The silent `GROUP_CONCAT` truncation has caused a lot of production data loss. And the lack of a median function in MySQL is genuinely painful for analytics.
:::

---

## 4. `FILTER` — conditional aggregation, cleanly

```sql
SELECT region,
       count(*)                                    AS total,
       count(*) FILTER (WHERE amount > 1500)       AS big_orders,
       sum(amount) FILTER (WHERE product = 'laptop') AS laptop_revenue,
       avg(amount) FILTER (WHERE qty > 2)          AS avg_bulk
FROM sales
GROUP BY region;
```

**Trace for the South group (rows 3, 4, 5):**

```text
 row  product  qty  amount   │ total │ amount>1500 │ product='laptop' │ qty>2
──────────────────────────────┼───────┼─────────────┼──────────────────┼───────
   3  laptop    1    1000    │   ✓   │      ✗      │        ✓         │   ✗
   4  phone     4    2000    │   ✓   │      ✓      │        ✗         │   ✓
   5  tablet    2     600    │   ✓   │      ✗      │        ✗         │   ✗
──────────────────────────────┴───────┴─────────────┴──────────────────┴───────
 total=3   big_orders=1   laptop_revenue=1000   avg_bulk=2000
```

The pre-`FILTER` way, which you'll still see everywhere:

```sql
count(CASE WHEN amount > 1500 THEN 1 END)          -- equivalent to count(*) FILTER
sum(CASE WHEN product='laptop' THEN amount ELSE 0 END)  -- NOT quite equivalent: gives 0 not NULL for empty
```

:::tip[Why `FILTER` is better than `CASE`]
It reads as what it means, it works with *any* aggregate including `array_agg` and `percentile_cont`, and it avoids the `ELSE 0` versus `ELSE NULL` distinction that changes whether an empty set gives `0` or `NULL`. `FILTER` is SQL-standard. MySQL doesn't have it, so portable code uses `CASE` — but on Postgres, use `FILTER`.
:::

---

## 5. Pivoting rows to columns

```sql
SELECT product,
       sum(amount) FILTER (WHERE region = 'North') AS north,
       sum(amount) FILTER (WHERE region = 'South') AS south,
       sum(amount) FILTER (WHERE region = 'East')  AS east
FROM sales
GROUP BY product
ORDER BY product;
```

```text
 product │ north │ south │ east
─────────┼───────┼───────┼──────
 laptop  │  3000 │  1000 │ 1000
 phone   │  2500 │  2000 │ NULL
 tablet  │  NULL │   600 │ NULL
```

SQL requires a fixed column list, so the regions must be known at query-writing time. For a dynamic pivot you either build the SQL string in the application, use the `tablefunc` extension's `crosstab()`, or — usually best — return `jsonb_object_agg(region, total)` and pivot in the client.

```sql
SELECT product, jsonb_object_agg(region, revenue) AS by_region
FROM (SELECT product, region, sum(amount) AS revenue FROM sales GROUP BY 1,2) t
GROUP BY product;
-- laptop | {"East": 1000, "North": 3000, "South": 1000}
```

---

## 6. `GROUPING SETS`, `ROLLUP`, `CUBE`

One pass over the data, several levels of aggregation.

```sql
SELECT region, product, sum(amount) AS revenue
FROM sales
GROUP BY GROUPING SETS ((region, product), (region), ());
```

**Trace — think of it as three `GROUP BY`s unioned, but executed in one scan:**

```text
SET 1 — GROUP BY (region, product)
  North laptop  3000
  North phone   2500
  South laptop  1000
  South phone   2000
  South tablet   600
  East  laptop  1000                                   → 6 rows

SET 2 — GROUP BY (region)         [product column becomes NULL]
  North NULL    5500
  South NULL    3600
  East  NULL    1000                                   → 3 rows

SET 3 — GROUP BY ()  (grand total) [both NULL]
  NULL  NULL   10100                                   → 1 row

TOTAL OUTPUT: 10 rows in ONE pass over sales
```

Shorthands:

```sql
GROUP BY ROLLUP (region, product)
-- ≡ GROUPING SETS ((region, product), (region), ())     -- hierarchical drill-down

GROUP BY CUBE (region, product)
-- ≡ GROUPING SETS ((region,product), (region), (product), ())  -- every combination, 2^n sets
```

### Telling a subtotal NULL from a data NULL

Both appear as `NULL`. `GROUPING()` returns 1 when the column was *aggregated away*:

```sql
SELECT
  CASE WHEN GROUPING(region)  = 1 THEN 'ALL REGIONS'  ELSE region  END  AS region,
  CASE WHEN GROUPING(product) = 1 THEN 'ALL PRODUCTS' ELSE product END  AS product,
  sum(amount) AS revenue
FROM sales
GROUP BY ROLLUP (region, product)
ORDER BY GROUPING(region), region, GROUPING(product), product;
```

```text
 region      │ product      │ revenue
─────────────┼──────────────┼─────────
 East        │ laptop       │    1000
 East        │ ALL PRODUCTS │    1000
 North       │ laptop       │    3000
 North       │ phone        │    2500
 North       │ ALL PRODUCTS │    5500
 South       │ laptop       │    1000
 South       │ phone        │    2000
 South       │ tablet       │     600
 South       │ ALL PRODUCTS │    3600
 ALL REGIONS │ ALL PRODUCTS │   10100
```

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| `GROUPING SETS`, `ROLLUP`, `CUBE` — full support (9.5+) | **`WITH ROLLUP` only** (`GROUP BY a, b WITH ROLLUP`). No `GROUPING SETS`, no `CUBE` |
| `GROUPING(col)` to distinguish subtotal NULLs | `GROUPING()` added in 8.0 |
| Arbitrary combinations | Only the single hierarchical rollup |

So a "revenue by region, by product, and by both, with grand totals" report is one query in Postgres and several `UNION ALL`ed queries in MySQL.
:::

---

## 7. Aggregates without collapsing — a preview

Sometimes you want the total *alongside* each row, not instead of it. That's a window function, and it's the whole of the [next page](./07-window-functions.md):

```sql
SELECT region, product, amount,
       sum(amount) OVER (PARTITION BY region) AS region_total,
       round(100.0 * amount / sum(amount) OVER (PARTITION BY region), 1) AS pct_of_region
FROM sales;
```

```text
 region │ product │ amount │ region_total │ pct_of_region
────────┼─────────┼────────┼──────────────┼───────────────
 East   │ laptop  │   1000 │         1000 │         100.0
 North  │ laptop  │   3000 │         5500 │          54.5
 North  │ phone   │   2500 │         5500 │          45.5
 South  │ laptop  │   1000 │         3600 │          27.8
 South  │ phone   │   2000 │         3600 │          55.6
 South  │ tablet  │    600 │         3600 │          16.7
```

**6 rows in, 6 rows out** — that's the entire difference from `GROUP BY`.

---

## 8. Aggregate performance

Two physical strategies, visible in `EXPLAIN`:

```text
HashAggregate   — build a hash table keyed by the grouping columns.
                  Fast, no sort needed, but must fit in work_mem
                  (spills to disk since PG 13 rather than erroring).

GroupAggregate  — requires input sorted by the grouping key. Constant memory.
                  Chosen when a sort is needed anyway, when the group count
                  is huge, or when an index already provides the order.
```

```sql
SET enable_hashagg = off;   -- to compare plans while learning; never in production
```

Practical levers:

- Filter before aggregating — `WHERE` shrinks the input; `HAVING` does not.
- `count(DISTINCT x)` is expensive (needs a sort/hash per group). For approximations, the `postgres_hll` extension or `count(*)` over a pre-deduped CTE can be far cheaper.
- For dashboard-scale aggregates, precompute with a **materialized view** refreshed on a schedule, or maintain rollup tables with triggers. Don't aggregate 500 M rows per page view.
- Parallel aggregation: Postgres can split the aggregate across workers (`Partial HashAggregate` → `Gather` → `Finalize HashAggregate`) when the table is large enough and the aggregate is parallel-safe.

---

## 9. Rapid-fire recall

<details>
<summary>**Why must every selected column be grouped or aggregated?**</summary>

Because after grouping, a group is many rows collapsed into one, and a non-grouped column has many candidate values with no rule to pick one. Postgres rejects the query rather than guessing. The one exception is functional dependency: if you group by a table's primary key, every other column of that table has exactly one value per group, so it's allowed. MySQL used to return an arbitrary value in this situation, which is why `ONLY_FULL_GROUP_BY` exists and is now on by default.
</details>

<details>
<summary>**`count(*)` vs `count(col)` vs `count(DISTINCT col)`?**</summary>

`count(*)` counts rows regardless of NULLs. `count(col)` counts rows where that column is not NULL. `count(DISTINCT col)` counts distinct non-NULL values and is significantly more expensive because it has to sort or hash the values within each group. The one that bites people is after a join: `count(*)` counts join output rows, so if you joined to a one-to-many table and meant "how many customers," you need `count(DISTINCT c.id)`.
</details>

<details>
<summary>**What does `FILTER` do?**</summary>

It restricts which rows feed a specific aggregate, so you can compute several differently-filtered aggregates in one pass: `count(*) FILTER (WHERE status='paid')` alongside `count(*)`. It's SQL-standard, works with any aggregate including `array_agg` and percentiles, and it's cleaner than the `CASE WHEN` trick — which also forces you to think about whether `ELSE 0` or `ELSE NULL` is right. MySQL has no `FILTER`, so there you're back to `SUM(CASE WHEN ...)`.
</details>

<details>
<summary>**Explain `GROUPING SETS`, `ROLLUP` and `CUBE`.**</summary>

They let one query produce several levels of aggregation in a single pass. `GROUPING SETS` lists the exact grouping combinations you want. `ROLLUP (a, b)` is the hierarchical shorthand — `(a,b)`, then `(a)`, then the grand total — which is what a drill-down report needs. `CUBE (a, b)` produces every combination, 2 to the power of n grouping sets. Columns aggregated away appear as NULL, and `GROUPING(col)` returns 1 for those so you can distinguish a subtotal row from a genuine NULL in the data. MySQL only has `WITH ROLLUP`.
</details>

<details>
<summary>**`sum()` over zero rows returns what?**</summary>

`NULL`, not zero — as do `avg`, `min` and `max`, because all aggregates except `count` ignore NULLs and an empty set has nothing to sum. Wrap it in `coalesce(sum(amount), 0)` whenever the caller expects a number. `count` is the exception: it returns 0.
</details>

<details>
<summary>**How do you pivot rows into columns?**</summary>

With one conditional aggregate per output column — `sum(amount) FILTER (WHERE region = 'North') AS north` — which requires knowing the columns at query-writing time, because SQL result shapes are static. For a dynamic set of columns, either build the SQL in the application, use `crosstab()` from the `tablefunc` extension, or return `jsonb_object_agg(key, value)` and let the client expand it, which is usually the cleanest option for an API.
</details>

<details>
<summary>**When would you use a window function instead of `GROUP BY`?**</summary>

When you need the aggregate *alongside* the detail rows rather than instead of them — each row's share of its region's total, a running balance, a rank within a category. `GROUP BY` collapses N rows to one per group; a window function computes over a partition and returns all N rows. If you find yourself joining a table back to its own grouped subquery to get the total next to each row, that's a window function.
</details>

---

**Next:** [Window Functions →](./07-window-functions.md) — traced frame by frame.
