---
title: Intermediate Practice
---

# Intermediate Practice — Questions 11–22

> **Focus**: window functions and frames, CTEs, `LATERAL`, `EXISTS` vs `IN`, `GROUPING SETS`, pivoting, `FILTER`, keyset pagination, fan-out bugs.
>
> Every solution traces the intermediate row set. Where two approaches exist, both are shown with the trade-off spelled out — that comparison is usually the actual interview question.

---

## The dataset

```sql
-- sales
 id | region | rep    | product | amount | sold_on
----+--------+--------+---------+--------+------------
  1 | North  | Asha   | laptop  |  3000  | 2026-01-05
  2 | North  | Asha   | phone   |  2500  | 2026-01-20
  3 | North  | Ravi   | laptop  |  1000  | 2026-02-11
  4 | South  | Meera  | laptop  |  1000  | 2026-02-14
  5 | South  | Meera  | phone   |  2000  | 2026-03-01
  6 | South  | Karan  | tablet  |   600  | 2026-03-09
  7 | East   | Nisha  | laptop  |  1000  | 2026-03-15
  8 | East   | Nisha  | tablet  |   600  | 2026-03-20
```

---

## Question 11: Percent of total, without collapsing rows

Show each sale with its share of its region's revenue and of overall revenue.

<details>
<summary>**Solution & Trace**</summary>

```sql
SELECT id, region, rep, amount,
       sum(amount) OVER (PARTITION BY region)                          AS region_total,
       round(100.0 * amount / sum(amount) OVER (PARTITION BY region),1) AS pct_region,
       round(100.0 * amount / sum(amount) OVER (),1)                    AS pct_overall
FROM sales
ORDER BY region, amount DESC;
```

**Trace:**

```text
PARTITIONS (no ORDER BY in the window ⇒ frame = the whole partition)

┌─ "East" ─────────────┐ ┌─ "North" ────────────────┐ ┌─ "South" ─────────────┐
│ 7 (1000)             │ │ 1 (3000)                 │ │ 4 (1000)              │
│ 8 (600)              │ │ 2 (2500)                 │ │ 5 (2000)              │
│  sum = 1600          │ │ 3 (1000)                 │ │ 6 (600)               │
└──────────────────────┘ │  sum = 6500              │ │  sum = 3600           │
                         └──────────────────────────┘ └───────────────────────┘
OVER () → one partition of everything → grand total 11,700

 id │ region │ amount │ region_total │ pct_region │ pct_overall
────┼────────┼────────┼──────────────┼────────────┼─────────────
  7 │ East   │  1000  │     1600     │    62.5    │     8.5
  8 │ East   │   600  │     1600     │    37.5    │     5.1
  1 │ North  │  3000  │     6500     │    46.2    │    25.6
  2 │ North  │  2500  │     6500     │    38.5    │    21.4
  3 │ North  │  1000  │     6500     │    15.4    │     8.5
  4 │ South  │  1000  │     3600     │    27.8    │     8.5
  5 │ South  │  2000  │     3600     │    55.6    │    17.1
  6 │ South  │   600  │     3600     │    16.7    │     5.1

8 rows in → 8 rows out.  That is the whole difference from GROUP BY.
```

:::tip[The `GROUP BY` alternative and why it's worse]
Without windows you'd write `sales JOIN (SELECT region, sum(amount) FROM sales GROUP BY region) t USING (region)` — a second scan of the table and a join, to get the same numbers. The window version does one pass, sorted by region.
:::
</details>

---

## Question 12: Running total — and the `RANGE` trap

Show a running revenue total per region, ordered by date.

<details>
<summary>**Solution & Trace**</summary>

```sql
SELECT id, region, sold_on, amount,
       sum(amount) OVER (PARTITION BY region ORDER BY sold_on
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
FROM sales
ORDER BY region, sold_on;
```

**Trace — the frame grows one row per step and resets at each partition boundary:**

```text
Partition "North"
 sold_on    │ amount │ frame                   │ running
────────────┼────────┼─────────────────────────┼─────────
 2026-01-05 │  3000  │ [3000]                  │  3000
 2026-01-20 │  2500  │ [3000, 2500]            │  5500
 2026-02-11 │  1000  │ [3000, 2500, 1000]      │  6500

Partition "South"     ← frame RESETS
 2026-02-14 │  1000  │ [1000]                  │  1000
 2026-03-01 │  2000  │ [1000, 2000]            │  3000
 2026-03-09 │   600  │ [1000, 2000, 600]       │  3600

Partition "East"
 2026-03-15 │  1000  │ [1000]                  │  1000
 2026-03-20 │   600  │ [1000, 600]             │  1600
```

**Now the trap.** Suppose two East sales happened on the same day:

```text
 sold_on    │ amount │ RANGE (the DEFAULT) frame │ RANGE result │ ROWS frame       │ ROWS result
────────────┼────────┼───────────────────────────┼──────────────┼──────────────────┼─────────────
 2026-03-15 │  1000  │ [1000, 600]  ← both peers │    1600      │ [1000]           │    1000
 2026-03-15 │   600  │ [1000, 600]  ← same frame │    1600      │ [1000, 600]      │    1600
```

:::danger[Write `ROWS`, not the default]
Omitting the frame clause when you have `ORDER BY` gives you `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, and `RANGE` treats rows with **equal ordering values as peers sharing one frame**. A "running total by day" then produces the same value for every row on that day — a step function, not a running total. Real data always has duplicate dates. Always spell out `ROWS`.

`RANGE` earns its place for true value windows: `RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW` is a real rolling 7-day sum that `ROWS` cannot express.
:::
</details>

---

## Question 13: Top N per group — three ways

Return the top 2 sales per region by amount.

<details>
<summary>**Solution & Trace**</summary>

```sql
-- A) Window function — the portable answer
WITH ranked AS (
  SELECT *, row_number() OVER (PARTITION BY region ORDER BY amount DESC, id) AS rn
  FROM sales
)
SELECT id, region, rep, amount FROM ranked WHERE rn <= 2 ORDER BY region, rn;
```

**Trace:**

```text
 region │ id │ amount │ rn  │ kept?
────────┼────┼────────┼─────┼───────
 East   │  7 │  1000  │  1  │  ✓
 East   │  8 │   600  │  2  │  ✓
 North  │  1 │  3000  │  1  │  ✓
 North  │  2 │  2500  │  2  │  ✓
 North  │  3 │  1000  │  3  │  ✗
 South  │  5 │  2000  │  1  │  ✓
 South  │  4 │  1000  │  2  │  ✓
 South  │  6 │   600  │  3  │  ✗

8 rows → 6 rows.  Note: EVERY row was ranked before 2 were discarded.
```

```sql
-- B) LATERAL — one indexed lookup per region instead of ranking everything
SELECT r.region, t.id, t.rep, t.amount
FROM (SELECT DISTINCT region FROM sales) r
CROSS JOIN LATERAL (
    SELECT id, rep, amount FROM sales s
    WHERE s.region = r.region
    ORDER BY s.amount DESC, s.id
    LIMIT 2
) t;
```

```text
For r.region = 'East' : index scan on (region, amount DESC) → read exactly 2 rows
For r.region = 'North': → 2 rows
For r.region = 'South': → 2 rows
Total heap rows touched: 6, not 8.
```

```sql
-- C) rank() instead of row_number() — keeps ties
WITH ranked AS (
  SELECT *, rank() OVER (PARTITION BY region ORDER BY amount DESC) AS rk
  FROM sales
) SELECT * FROM ranked WHERE rk <= 2;
```

:::tip[Choosing]
| | Window | `LATERAL` |
| :--- | :--- | :--- |
| Cost shape | One full pass, ranks everything | N indexed lookups of exactly N rows |
| Wins when | Many groups relative to table size, or no index | **Few groups, large table, index on `(group, sort)`** |
| N = 1 | `DISTINCT ON` is shorter and usually fastest | — |
| Portability | MySQL 8+ | MySQL 8.0.14+ |

Being able to state the trade-off — "index-driven loop over few groups versus one full ranking pass" — is what makes this a senior answer rather than a memorised snippet.
:::
</details>

---

## Question 14: Month-over-month change with `lag`

Show monthly revenue and the change from the previous month, in absolute and percentage terms.

<details>
<summary>**Solution & Trace**</summary>

```sql
WITH monthly AS (
  SELECT date_trunc('month', sold_on)::date AS month, sum(amount) AS revenue
  FROM sales GROUP BY 1
)
SELECT month, revenue,
       lag(revenue) OVER w                                              AS prev_revenue,
       revenue - lag(revenue) OVER w                                    AS change,
       round(100.0 * (revenue - lag(revenue) OVER w)
                   / nullif(lag(revenue) OVER w, 0), 1)                 AS pct_change
FROM monthly
WINDOW w AS (ORDER BY month)
ORDER BY month;
```

**Trace:**

```text
── CTE: group by month ─────────── 8 rows → 3 rows
   2026-01-01 : 3000 + 2500                = 5500
   2026-02-01 : 1000 + 1000                = 2000
   2026-03-01 : 2000 +  600 + 1000 + 600   = 4200

── window: lag(revenue) OVER (ORDER BY month) ──
 month      │ revenue │ prev │ change │ pct_change
────────────┼─────────┼──────┼────────┼────────────
 2026-01-01 │  5500   │ NULL │  NULL  │   NULL      ← no previous row
 2026-02-01 │  2000   │ 5500 │ -3500  │  -63.6
 2026-03-01 │  4200   │ 2000 │ +2200  │  110.0
```

**Two things carrying weight here:**

- `nullif(lag(...), 0)` guards against division by zero, which would otherwise raise `division_by_zero` on Postgres (MySQL would return NULL, quietly).
- The `WINDOW w AS (...)` clause defines the window once. Three repeated `OVER (ORDER BY month)` clauses are identical, so Postgres sorts once anyway — but named windows make that guarantee explicit and the query readable.
- `date_trunc('month', ...)` keeps the value a **date**, so it sorts correctly. Grouping by `to_char(sold_on,'Month')` gives you a *string*, which sorts alphabetically ("April" before "January") and merges the same month across different years. Format only at the very end.

For year-over-year, `lag(revenue, 12) OVER (ORDER BY month)` — but only if there are no gaps in the month series. With gaps you need a `generate_series` spine first (see [Q10](./24-beginner-queries.md)).
</details>

---

## Question 15: `EXISTS` vs `IN` vs `JOIN`

Find regions that have sold at least one tablet.

<details>
<summary>**Solution & Trace**</summary>

```sql
-- A) EXISTS — semi-join semantics
SELECT DISTINCT r.region FROM (SELECT DISTINCT region FROM sales) r
WHERE EXISTS (SELECT 1 FROM sales s WHERE s.region = r.region AND s.product = 'tablet');

-- B) IN — same plan, usually
SELECT DISTINCT region FROM sales
WHERE region IN (SELECT region FROM sales WHERE product = 'tablet');

-- C) JOIN — different semantics, needs DISTINCT
SELECT DISTINCT a.region
FROM sales a JOIN sales b ON b.region = a.region AND b.product = 'tablet';
```

**Trace of the semantics difference:**

```text
Regions with a tablet sale: South (id 6), East (id 8)

SEMI-JOIN (EXISTS / IN)
  for each region, ask "is there AT LEAST ONE tablet sale?"
    East  → yes → emit East  ONCE
    North → no  → skip
    South → yes → emit South ONCE
  → 2 rows, no duplication possible, tablet columns NOT available

JOIN
  East:  3 rows(a) × 1 tablet(b) = 3 rows
  South: 3 rows(a) × 1 tablet(b) = 3 rows
  → 6 rows, requiring DISTINCT to collapse back to 2
  → but b.* IS available, if you needed the tablet sale's details
```

**Now the anti-join — regions that have *never* sold a tablet:**

```sql
-- ✅ correct
SELECT DISTINCT region FROM sales r
WHERE NOT EXISTS (SELECT 1 FROM sales s WHERE s.region = r.region AND s.product='tablet');
-- → North

-- ❌ DANGEROUS if the subquery can return NULL
SELECT DISTINCT region FROM sales
WHERE region NOT IN (SELECT region FROM sales WHERE product = 'tablet');
```

```text
If the subquery yields (South, East, NULL):
  'North' NOT IN ('South','East',NULL)
= NOT ('North'='South' OR 'North'='East' OR 'North'=NULL)
= NOT (false OR false OR NULL)
= NOT NULL
= NULL     → not TRUE → row dropped

RESULT: zero rows. Silently. Identical behaviour on MySQL.
```

:::tip[Decision rule]
Need columns from the other table → `JOIN`. Only need "does a match exist" → `EXISTS`. Need "no match exists" → **always `NOT EXISTS`, never `NOT IN`.** `EXISTS` also short-circuits at the first match, which is why `SELECT 1` inside it is conventional — the select list is never evaluated.
:::
</details>

---

## Question 16: Subtotals and a grand total in one pass

Produce revenue by region and product, with per-region subtotals and a grand total.

<details>
<summary>**Solution & Trace**</summary>

```sql
SELECT
  CASE WHEN GROUPING(region)  = 1 THEN 'ALL REGIONS'  ELSE region  END AS region,
  CASE WHEN GROUPING(product) = 1 THEN 'ALL PRODUCTS' ELSE product END AS product,
  sum(amount) AS revenue
FROM sales
GROUP BY ROLLUP (region, product)
ORDER BY GROUPING(region), region, GROUPING(product), product;
```

**Trace — `ROLLUP (a,b)` is `GROUPING SETS ((a,b), (a), ())`, all in one scan:**

```text
SET 1 — GROUP BY (region, product)                        → 7 rows
   East  laptop 1000 │ East  tablet  600                    (2)
   North laptop 4000 │ North phone  2500                    (2)
   South laptop 1000 │ South phone  2000 │ South tablet 600 (3)

SET 2 — GROUP BY (region)     [product aggregated away → NULL]   → 3 rows
   East  1600 │ North 6500 │ South 3600

SET 3 — GROUP BY ()           [both NULL]                        → 1 row
   11700

TOTAL: 11 rows from ONE pass over sales.

 region      │ product      │ revenue
─────────────┼──────────────┼─────────
 East        │ laptop       │   1000
 East        │ tablet       │    600
 East        │ ALL PRODUCTS │   1600   ← subtotal
 North       │ laptop       │   4000
 North       │ phone        │   2500
 North       │ ALL PRODUCTS │   6500   ← subtotal
 South       │ laptop       │   1000
 South       │ phone        │   2000
 South       │ tablet       │    600
 South       │ ALL PRODUCTS │   3600   ← subtotal
 ALL REGIONS │ ALL PRODUCTS │  11700   ← grand total
```

`GROUPING(col)` returns 1 when the column was aggregated away, which is the only way to distinguish a subtotal NULL from a genuine NULL in the data. It's also why it appears in the `ORDER BY` — otherwise subtotal rows sort among the detail rows.

:::info[PostgreSQL vs MySQL]
MySQL has only `GROUP BY a, b WITH ROLLUP` — the single hierarchical case. No `GROUPING SETS`, so you cannot ask for `(region), (product), ()` without the `(region, product)` level, and no `CUBE`. That report becomes several `UNION ALL`ed queries, each with its own scan. `GROUPING()` does exist in MySQL 8.
:::
</details>

---

## Question 17: Pivot rows into columns

Show revenue per product with one column per region.

<details>
<summary>**Solution & Trace**</summary>

```sql
SELECT product,
       coalesce(sum(amount) FILTER (WHERE region = 'North'), 0) AS north,
       coalesce(sum(amount) FILTER (WHERE region = 'South'), 0) AS south,
       coalesce(sum(amount) FILTER (WHERE region = 'East'),  0) AS east,
       sum(amount) AS total
FROM sales
GROUP BY product
ORDER BY total DESC;
```

**Trace of the `laptop` group (rows 1, 3, 4, 7):**

```text
 row │ region │ amount │ North? │ South? │ East?
─────┼────────┼────────┼────────┼────────┼───────
  1  │ North  │  3000  │   ✓    │   ✗    │   ✗
  3  │ North  │  1000  │   ✓    │   ✗    │   ✗
  4  │ South  │  1000  │   ✗    │   ✓    │   ✗
  7  │ East   │  1000  │   ✗    │   ✗    │   ✓
─────┴────────┴────────┴────────┴────────┴───────
  north = 4000    south = 1000    east = 1000    total = 6000

 product │ north │ south │ east │ total
─────────┼───────┼───────┼──────┼───────
 laptop  │  4000 │  1000 │ 1000 │  6000
 phone   │  2500 │  2000 │    0 │  4500
 tablet  │     0 │   600 │  600 │  1200
```

For a **dynamic** set of columns, SQL can't help — result shapes are static. Return JSON and pivot client-side:

```sql
SELECT product, jsonb_object_agg(region, revenue) AS by_region
FROM (SELECT product, region, sum(amount) AS revenue FROM sales GROUP BY 1,2) t
GROUP BY product;
-- laptop | {"East": 1000, "North": 4000, "South": 1000}
```

:::info[PostgreSQL vs MySQL]
`FILTER (WHERE ...)` is SQL-standard and not supported by MySQL, where you write `SUM(CASE WHEN region='North' THEN amount ELSE 0 END)`. The `CASE` form also forces you to choose `ELSE 0` versus `ELSE NULL`, which changes whether an empty group gives 0 or NULL — a distinction `FILTER` sidesteps. Postgres also has `crosstab()` in the `tablefunc` extension for the dynamic case.
:::
</details>

---

## Question 18: The fan-out double-count bug

Each rep has sales and expenses. Show total sales and total expenses per rep.

<details>
<summary>**Solution & Trace**</summary>

```sql
-- ❌ WRONG — silently inflates both numbers
SELECT r.name, sum(s.amount) AS sales, sum(e.amount) AS expenses
FROM reps r
JOIN sales    s ON s.rep_id = r.id
JOIN expenses e ON e.rep_id = r.id
GROUP BY r.id, r.name;
```

**Trace — Asha has 2 sales (3000, 2500) and 3 expenses (100, 200, 300):**

```text
The two joins MULTIPLY: 2 × 3 = 6 rows for Asha.

 sale  expense
 3000    100
 3000    200
 3000    300
 2500    100
 2500    200
 2500    300

sum(sales)    = 3000×3 + 2500×3 = 16,500   ← should be 5,500.   3× inflated
sum(expenses) = 600×2            =  1,200   ← should be   600.   2× inflated

Both numbers are wrong. Neither query errors. This is the most dangerous
class of SQL bug because it produces plausible output.
```

**Fix A — aggregate each branch before joining:**

```sql
SELECT r.name,
       coalesce(s.total, 0) AS sales,
       coalesce(e.total, 0) AS expenses
FROM reps r
LEFT JOIN (SELECT rep_id, sum(amount) AS total FROM sales    GROUP BY 1) s ON s.rep_id = r.id
LEFT JOIN (SELECT rep_id, sum(amount) AS total FROM expenses GROUP BY 1) e ON e.rep_id = r.id;
```

```text
 s = { Asha: 5500, ... }        one row per rep
 e = { Asha:  600, ... }        one row per rep
 join → 1 × 1 = 1 row per rep. No multiplication possible.
```

**Fix B — `LATERAL`, when you want more than one aggregate per branch:**

```sql
SELECT r.name, s.total AS sales, s.n AS sale_count, e.total AS expenses
FROM reps r
LEFT JOIN LATERAL (SELECT sum(amount) total, count(*) n FROM sales    WHERE rep_id=r.id) s ON true
LEFT JOIN LATERAL (SELECT sum(amount) total, count(*) n FROM expenses WHERE rep_id=r.id) e ON true;
```

**Fix C — scalar subqueries, cleanest for one or two values:**

```sql
SELECT r.name,
       (SELECT coalesce(sum(amount),0) FROM sales    WHERE rep_id = r.id) AS sales,
       (SELECT coalesce(sum(amount),0) FROM expenses WHERE rep_id = r.id) AS expenses
FROM reps r;
```

:::danger[The rule]
**Never join a parent to two independent one-to-many children and then aggregate.** The row counts multiply. Recognising this instantly, and naming the three fixes, is a genuine seniority marker.

The diagnostic: if `sum(x)` changes when you add an unrelated join, you have fan-out.
:::
</details>

---

## Question 19: Gaps and islands

`activity(user_id, day)` records daily logins. Find each user's consecutive-day streaks.

<details>
<summary>**Solution & Trace**</summary>

```sql
SELECT user_id,
       min(day) AS streak_start,
       max(day) AS streak_end,
       count(*) AS streak_length
FROM (
  SELECT user_id, day,
         day - (row_number() OVER (PARTITION BY user_id ORDER BY day))::int AS grp
  FROM activity
) t
GROUP BY user_id, grp
ORDER BY user_id, streak_start;
```

**Trace for user 1 with days 01, 02, 03, 07, 08, 12:**

```text
 day        │ row_number │ day - rn     ← the "anchor"
────────────┼────────────┼──────────────
 2026-01-01 │     1      │ 2025-12-31   ┐
 2026-01-02 │     2      │ 2025-12-31   ├─ ISLAND A  (3 days)
 2026-01-03 │     3      │ 2025-12-31   ┘
 2026-01-07 │     4      │ 2026-01-03   ┐
 2026-01-08 │     5      │ 2026-01-03   ┘─ ISLAND B  (2 days)
 2026-01-12 │     6      │ 2026-01-06   ── ISLAND C  (1 day)

WHY IT WORKS: within a consecutive run, `day` increases by 1 each step and
`row_number` also increases by 1, so their difference is CONSTANT. At a gap,
`day` jumps by more than 1 while `row_number` still increments by 1, so the
difference changes. Group by that difference and each group is one island.

── GROUP BY user_id, grp ──
 user │ streak_start │ streak_end │ length
──────┼──────────────┼────────────┼────────
   1  │ 2026-01-01   │ 2026-01-03 │   3
   1  │ 2026-01-07   │ 2026-01-08 │   2
   1  │ 2026-01-12   │ 2026-01-12 │   1
```

**The general form — a cumulative sum of a "new group starts here" flag.** Use it when the gap rule isn't "+1":

```sql
-- sessionise events with a 30-minute idle timeout
SELECT user_id, event_at,
       sum(is_new) OVER (PARTITION BY user_id ORDER BY event_at) AS session_id
FROM (
  SELECT user_id, event_at,
         CASE WHEN event_at - lag(event_at) OVER (PARTITION BY user_id ORDER BY event_at)
                   > interval '30 minutes'
              OR lag(event_at) OVER (PARTITION BY user_id ORDER BY event_at) IS NULL
              THEN 1 ELSE 0 END AS is_new
  FROM events
) t;
```

```text
 event_at │ gap from prev │ is_new │ running sum = session_id
──────────┼───────────────┼────────┼──────────────────────────
 10:00    │  (first)      │   1    │   1
 10:05    │  5 min        │   0    │   1
 10:20    │ 15 min        │   0    │   1
 11:30    │ 70 min  >30   │   1    │   2   ← new session
 11:35    │  5 min        │   0    │   2
```

**A running sum of a 0/1 flag is the general-purpose grouping idiom.** Learn it once; it solves streaks, sessions, price-change periods, and state-machine runs.
</details>

---

## Question 20: A recursive CTE — category tree

`categories(id, name, parent_id)`. Show the full tree with depth and a breadcrumb path, then all descendants of one node.

<details>
<summary>**Solution & Trace**</summary>

```sql
WITH RECURSIVE tree AS (
    SELECT id, name, parent_id, 1 AS depth, ARRAY[id] AS path, name::text AS breadcrumb
    FROM categories WHERE parent_id IS NULL
  UNION ALL
    SELECT c.id, c.name, c.parent_id, t.depth + 1, t.path || c.id, t.breadcrumb || ' > ' || c.name
    FROM categories c
    JOIN tree t ON c.parent_id = t.id
    WHERE NOT (c.id = ANY(t.path))          -- cycle guard
      AND t.depth < 20                      -- depth guard
)
SELECT repeat('  ', depth-1) || name AS tree, depth, breadcrumb
FROM tree ORDER BY path;
```

**Data:** Electronics(1) → Computers(2) → Laptops(4), Desktops(5); Electronics(1) → Phones(3).

**Trace — the working table each iteration:**

```text
ANCHOR   (parent_id IS NULL)
  working = [ Electronics(1, depth 1, path [1]) ]
  result  = [ Electronics ]

ITER 1   join categories to WORKING (= Electronics only)
  Computers.parent_id=1 ✓ → (2, depth 2, path [1,2], "Electronics > Computers")
  Phones.parent_id=1    ✓ → (3, depth 2, path [1,3], "Electronics > Phones")
  working = [ Computers, Phones ]        ← Electronics is NO LONGER in the working table
  result  = [ Electronics, Computers, Phones ]

ITER 2   join categories to WORKING (= Computers, Phones)
  Laptops.parent_id=2  ✓ → (4, depth 3, path [1,2,4])
  Desktops.parent_id=2 ✓ → (5, depth 3, path [1,2,5])
  (nothing under Phones)
  working = [ Laptops, Desktops ]
  result  = [ ..., Laptops, Desktops ]

ITER 3   nothing under Laptops or Desktops
  working = [ ]  →  STOP

OUTPUT (ORDER BY path — a breadth-first traversal displayed depth-first)
 tree               │ depth │ breadcrumb
────────────────────┼───────┼────────────────────────────────
 Electronics        │   1   │ Electronics
   Computers        │   2   │ Electronics > Computers
     Laptops        │   3   │ Electronics > Computers > Laptops
     Desktops       │   3   │ Electronics > Computers > Desktops
   Phones           │   2   │ Electronics > Phones
```

**Descendants of one node** — change only the anchor:

```sql
WITH RECURSIVE sub AS (
    SELECT * FROM categories WHERE id = 2               -- ← start at Computers
  UNION ALL
    SELECT c.* FROM categories c JOIN sub s ON c.parent_id = s.id
) SELECT * FROM sub;
```

**Ancestors of one node** — flip the join direction:

```sql
WITH RECURSIVE up AS (
    SELECT * FROM categories WHERE id = 4               -- start at Laptops
  UNION ALL
    SELECT c.* FROM categories c JOIN up u ON c.id = u.parent_id   -- ← reversed
) SELECT * FROM up;
-- Laptops → Computers → Electronics
```

:::danger[Recursion safety]
The critical detail is that inside the recursive term, `tree` refers **only to the previous iteration's rows** — the working table — not the accumulated result. That's what makes it breadth-first, one level per iteration.

PostgreSQL has **no default recursion depth limit**, so an unguarded cycle runs until it exhausts disk. Always carry a path array and check `NOT (c.id = ANY(path))`, or use PG 14's `CYCLE id SET is_cycle USING path`. MySQL caps at `cte_max_recursion_depth = 1000`, which stops the runaway but doesn't help you detect the cycle.
:::
</details>

---

## Question 21: Keyset pagination

Paginate orders newest first, 20 per page, efficiently at page 5,000.

<details>
<summary>**Solution & Trace**</summary>

```sql
-- ❌ OFFSET: the server generates and DISCARDS 100,000 rows to return 20
SELECT * FROM orders ORDER BY placed_on DESC, id DESC LIMIT 20 OFFSET 100000;

-- ✅ Keyset: constant cost per page
SELECT * FROM orders
WHERE (placed_on, id) < ($1, $2)         -- the last row of the previous page
ORDER BY placed_on DESC, id DESC
LIMIT 20;
```

**Trace of the difference:**

```text
OFFSET 100000
 Limit  (actual rows=20 loops=1)
   ->  Index Scan Backward using idx_orders_placed_id  (actual rows=100020 loops=1)
                                                        ^^^^^^^ 100,020 rows read
 Execution Time: 214 ms

KEYSET
 Limit  (actual rows=20 loops=1)
   ->  Index Scan Backward using idx_orders_placed_id  (actual rows=20 loops=1)
         Index Cond: (ROW(placed_on, id) < ROW('2026-01-15'::date, 4821))
 Execution Time: 0.4 ms
```

**Why the row constructor and not the OR-expansion:**

```sql
-- Equivalent, but harder to read and less reliably optimised
WHERE placed_on < $1 OR (placed_on = $1 AND id < $2)

-- Row comparison compares left-to-right like a tuple, and maps directly
-- onto an index on (placed_on DESC, id DESC)
WHERE (placed_on, id) < ($1, $2)
```

The required index:

```sql
CREATE INDEX ON orders (placed_on DESC, id DESC);
```

Keyset pagination is also **stable**: with `OFFSET`, a row inserted between page loads shifts everything down, so the user sees a duplicate at the top of the next page and never sees one row. Keyset anchors on actual data, so that can't happen.

**The trade-off:** you can't jump to page 500 — only "next" and "previous". That's fine for infinite scroll and API cursors, and almost no real UI needs arbitrary page jumps. If you must show a total, `count(*)` is a full scan; use `reltuples` for an estimate or a capped count.

:::info[PostgreSQL vs MySQL]
Row constructor comparison works on MySQL too, and since 8.0.16 it optimises into a proper range scan. So keyset pagination is fully portable — this is one where inventing a difference would be wrong.
:::
</details>

---

## Question 22: A data-modifying CTE

Archive all orders older than a year, atomically, and report how many moved.

<details>
<summary>**Solution & Trace**</summary>

```sql
WITH moved AS (
    DELETE FROM orders
    WHERE placed_on < current_date - interval '1 year'
    RETURNING *
),
inserted AS (
    INSERT INTO orders_archive
    SELECT * FROM moved
    RETURNING id
)
SELECT count(*) AS archived FROM inserted;
```

**Trace:**

```text
── moved: DELETE ... RETURNING * ──────────
   removes matching rows from `orders` and yields them as a result set
   → say 12,431 rows

── inserted: INSERT INTO orders_archive SELECT * FROM moved RETURNING id ──
   consumes those 12,431 rows
   → 12,431 rows

── outer SELECT count(*) FROM inserted ────
   → 12,431

ALL IN ONE STATEMENT = ONE TRANSACTION.
There is no window in which the rows exist in neither table, and no window
in which they exist in both. A crash between the two halves is impossible.
```

The two-statement version has a real gap:

```sql
INSERT INTO orders_archive SELECT * FROM orders WHERE placed_on < ...;
DELETE FROM orders WHERE placed_on < ...;
-- Rows inserted between the two statements are DELETED but never ARCHIVED,
-- unless both run in one transaction — and even then the second WHERE
-- re-evaluates and may match different rows.
```

:::warning[The visibility rule]
All parts of a data-modifying CTE run against the **same snapshot** and cannot see each other's changes, and the execution order of sibling CTEs is unspecified. So:

```sql
WITH d AS (DELETE FROM orders WHERE ... RETURNING *)
SELECT count(*) FROM orders;     -- returns the count BEFORE the delete
```
Never have two sub-statements modify the same row — the result is undefined.
:::

:::info[PostgreSQL vs MySQL]
**MySQL CTEs are read-only.** There is no `RETURNING` and no data-modifying CTE, so this operation is two statements wrapped in a transaction, plus a `SELECT` first if you need the rows. The atomic archive-and-report in one statement is a genuinely Postgres-only capability.
:::
</details>

---

**Next:** [Advanced (Q23–34) →](./26-advanced-queries.md)
