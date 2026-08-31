---
title: Window Functions
---

# Window Functions

> **What you will be able to do after this page**
>
> - Explain `PARTITION BY`, `ORDER BY` and the frame clause, and trace a frame row by row.
> - Know exactly why `ROWS` and `RANGE` differ, and why the default frame is a bug factory.
> - Write running totals, moving averages, rank-per-group, gap detection, and period-over-period comparisons from memory.
> - Explain why you cannot filter on a window function in `WHERE`, and what to do instead.

---

## 1. The core idea

A window function computes a value **over a set of related rows** without collapsing them.

```text
GROUP BY                              WINDOW FUNCTION
────────────────                      ────────────────
 6 rows  ──▶  3 rows                   6 rows  ──▶  6 rows
 detail is gone                        detail is kept, aggregate added alongside
```

Anatomy:

```sql
sum(amount) OVER (PARTITION BY region ORDER BY sold_on ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
└───┬────┘        └──────┬─────────┘ └──────┬──────┘ └────────────────┬─────────────────────────────┘
 function        divide into groups     order within         which rows of the partition
                 (no ORDER BY on the    each partition       are visible to THIS row
                  partition needed)
```

All three parts are optional:

```sql
sum(amount) OVER ()                                -- whole result set is one partition
sum(amount) OVER (PARTITION BY region)             -- per-region total on every row
sum(amount) OVER (ORDER BY sold_on)                -- running total across everything
```

---

## 2. The sample data

```sql
-- sales
 id | region | sold_on    | amount
----+--------+------------+--------
  1 | North  | 2026-01-05 |   100
  2 | North  | 2026-01-10 |   200
  3 | North  | 2026-01-15 |   200
  4 | North  | 2026-01-20 |   500
  5 | South  | 2026-01-07 |   300
  6 | South  | 2026-01-12 |   400
```

---

## 3. Trace 1 — `PARTITION BY` with no ordering

```sql
SELECT id, region, amount,
       sum(amount)   OVER (PARTITION BY region) AS region_total,
       count(*)      OVER (PARTITION BY region) AS region_rows,
       round(100.0 * amount / sum(amount) OVER (PARTITION BY region), 1) AS pct
FROM sales;
```

```text
PARTITIONING
┌── partition "North" ───────────────────────┐   ┌── partition "South" ─────────┐
│ id=1 100                                   │   │ id=5 300                     │
│ id=2 200        sum = 1000, count = 4      │   │ id=6 400   sum=700, count=2  │
│ id=3 200                                   │   │                              │
│ id=4 500                                   │   │                              │
└────────────────────────────────────────────┘   └──────────────────────────────┘

Every row in a partition sees the SAME aggregate (no ORDER BY ⇒ frame = whole partition).

 id │ region │ amount │ region_total │ region_rows │  pct
────┼────────┼────────┼──────────────┼─────────────┼───────
  1 │ North  │    100 │         1000 │      4      │  10.0
  2 │ North  │    200 │         1000 │      4      │  20.0
  3 │ North  │    200 │         1000 │      4      │  20.0
  4 │ North  │    500 │         1000 │      4      │  50.0
  5 │ South  │    300 │          700 │      2      │  42.9
  6 │ South  │    400 │          700 │      2      │  57.1

6 rows in → 6 rows out
```

---

## 4. Trace 2 — adding `ORDER BY`: the running total

```sql
SELECT id, region, sold_on, amount,
       sum(amount) OVER (PARTITION BY region ORDER BY sold_on) AS running_total
FROM sales;
```

**Adding `ORDER BY` silently changes the default frame** from "the whole partition" to `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`.

```text
Partition "North", ordered by sold_on:

 row │ sold_on    │ amount │ FRAME (rows visible to this row)     │ running_total
─────┼────────────┼────────┼──────────────────────────────────────┼──────────────
  1  │ 2026-01-05 │   100  │ [100]                                │      100
  2  │ 2026-01-10 │   200  │ [100, 200]                           │      300
  3  │ 2026-01-15 │   200  │ [100, 200, 200]                      │      500
  4  │ 2026-01-20 │   500  │ [100, 200, 200, 500]                 │     1000
                             └── frame grows by one row each step ──┘

Partition "South":
  5  │ 2026-01-07 │   300  │ [300]                                │      300
  6  │ 2026-01-12 │   400  │ [300, 400]                           │      700
                             ↑ the frame RESETS at the partition boundary
```

---

## 5. `ROWS` vs `RANGE` — the trap

The default frame with `ORDER BY` is `RANGE`, and `RANGE` groups **peers** (rows with equal `ORDER BY` values) together.

```sql
SELECT id, amount,
       sum(amount) OVER (ORDER BY amount)                                  AS range_default,
       sum(amount) OVER (ORDER BY amount ROWS UNBOUNDED PRECEDING)         AS rows_frame
FROM sales WHERE region = 'North';
```

```text
Ordered by amount:  100, 200, 200, 500
                              ↑↑↑ two PEERS (equal ORDER BY value)

 amount │ RANGE frame (all peers included) │ range_default │ ROWS frame        │ rows_frame
────────┼──────────────────────────────────┼───────────────┼───────────────────┼────────────
   100  │ [100]                            │      100      │ [100]             │     100
   200  │ [100, 200, 200]  ← BOTH 200s!    │      500      │ [100,200]         │     300
   200  │ [100, 200, 200]  ← same frame    │      500      │ [100,200,200]     │     500
   500  │ [100, 200, 200, 500]             │     1000      │ [100,...,500]     │    1000
```

:::danger[This is the #1 window-function bug]
`sum(x) OVER (ORDER BY d)` for a "running total by day" gives **the same value for every row on the same day**, because they're peers under `RANGE`. If your dates have duplicates — and they always do — you get a step function, not a running total.

**Always be explicit:**
```sql
sum(amount) OVER (ORDER BY sold_on ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
```
Write `ROWS` unless you specifically want peer grouping. Say this in an interview and it lands.
:::

### Frame syntax reference

```sql
{ROWS | RANGE | GROUPS} BETWEEN <start> AND <end>
```

| Bound | Meaning |
| :--- | :--- |
| `UNBOUNDED PRECEDING` | Start of partition |
| `n PRECEDING` | n rows (ROWS) / value offset (RANGE) / peer groups (GROUPS) back |
| `CURRENT ROW` | This row (ROWS) or this row **and all its peers** (RANGE) |
| `n FOLLOWING` | n forward |
| `UNBOUNDED FOLLOWING` | End of partition |

| Mode | Counts by |
| :--- | :--- |
| `ROWS` | Physical rows |
| `RANGE` | The `ORDER BY` **value** — `RANGE BETWEEN INTERVAL '7 days' PRECEDING AND CURRENT ROW` is a true time window |
| `GROUPS` | Peer groups (PG 11+) |

**Default frames:**

```text
OVER (PARTITION BY x)                → whole partition
OVER (PARTITION BY x ORDER BY y)     → RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
```

`RANGE` shines for genuine time windows:

```sql
-- true rolling 7-day sum, regardless of gaps or duplicate days
sum(amount) OVER (ORDER BY sold_on RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW)
```

That is not expressible with `ROWS`, which counts rows, not days.

---

## 6. Trace 3 — moving average with a sliding frame

```sql
SELECT id, sold_on, amount,
       round(avg(amount) OVER (ORDER BY sold_on
                               ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING), 1) AS moving_avg_3
FROM sales WHERE region = 'North';
```

```text
 row │ sold_on    │ amount │ frame [prev, current, next] │ avg
─────┼────────────┼────────┼─────────────────────────────┼───────
  1  │ 2026-01-05 │   100  │ [    -  , 100, 200]         │ 150.0   ← no preceding row: frame is smaller
  2  │ 2026-01-10 │   200  │ [ 100   , 200, 200]         │ 166.7
  3  │ 2026-01-15 │   200  │ [ 200   , 200, 500]         │ 300.0
  4  │ 2026-01-20 │   500  │ [ 200   , 500,  -  ]        │ 350.0   ← no following row
```

The frame **shrinks at the edges** rather than producing NULL — which is why the first and last points of a moving average are computed over fewer rows and are noisier. If you want NULL there instead, count the frame and null it out:

```sql
CASE WHEN count(*) OVER w = 3 THEN avg(amount) OVER w END
```

---

## 7. Ranking functions — traced together

```sql
SELECT name, score,
       row_number()   OVER (ORDER BY score DESC) AS row_number,
       rank()         OVER (ORDER BY score DESC) AS rank,
       dense_rank()   OVER (ORDER BY score DESC) AS dense_rank,
       percent_rank() OVER (ORDER BY score DESC) AS percent_rank,
       ntile(2)       OVER (ORDER BY score DESC) AS half
FROM students;
```

```text
 name  │ score │ row_number │ rank │ dense_rank │ percent_rank │ half
───────┼───────┼────────────┼──────┼────────────┼──────────────┼──────
 Asha  │   95  │     1      │   1  │     1      │     0.00     │  1
 Ravi  │   90  │     2      │   2  │     2      │     0.25     │  1
 Meera │   90  │     3      │   2  │     2      │     0.25     │  1   ← tie with Ravi
 Karan │   85  │     4      │   4  │     3      │     0.75     │  2   ← rank SKIPS 3
 Nisha │   80  │     5      │   5  │     4      │     1.00     │  2
                                      ↑           ↑
                             gap after a tie   no gaps
```

| Function | Ties get | After a tie |
| :--- | :--- | :--- |
| `row_number()` | Different numbers (**arbitrary** order among ties!) | Continues |
| `rank()` | Same number | **Skips** (1,2,2,4) |
| `dense_rank()` | Same number | **No skip** (1,2,2,3) |
| `percent_rank()` | `(rank - 1) / (total - 1)` | — |
| `cume_dist()` | Cumulative distribution | — |
| `ntile(n)` | Splits into n roughly equal buckets | — |

:::warning[`row_number()` on a non-unique ordering is non-deterministic]
Two rows with the same score can swap positions between runs — and with `LIMIT/OFFSET` pagination that means duplicated and missing rows. **Always add a unique tiebreaker**: `ORDER BY score DESC, id`.
:::

---

## 8. Offset functions — `lag`, `lead`, `first_value`, `nth_value`

```sql
SELECT sold_on, amount,
       lag(amount)      OVER w AS prev_amount,
       lead(amount)     OVER w AS next_amount,
       amount - lag(amount) OVER w AS delta,
       round(100.0 * (amount - lag(amount) OVER w) / lag(amount) OVER w, 1) AS pct_change,
       first_value(amount) OVER w AS first_in_partition,
       last_value(amount)  OVER (ORDER BY sold_on
                                 ROWS BETWEEN UNBOUNDED PRECEDING
                                          AND UNBOUNDED FOLLOWING) AS last_in_partition
FROM sales WHERE region = 'North'
WINDOW w AS (ORDER BY sold_on);
```

```text
 sold_on    │ amount │ prev │ next │ delta │ pct_change │ first │ last
────────────┼────────┼──────┼──────┼───────┼────────────┼───────┼──────
 2026-01-05 │   100  │ NULL │  200 │ NULL  │    NULL    │  100  │ 500
 2026-01-10 │   200  │  100 │  200 │  100  │    100.0   │  100  │ 500
 2026-01-15 │   200  │  200 │  500 │    0  │      0.0   │  100  │ 500
 2026-01-20 │   500  │  200 │ NULL │  300  │    150.0   │  100  │ 500
```

`lag(col, offset, default)` — `lag(amount, 1, 0)` gives 0 instead of NULL at the boundary.

:::danger[`last_value()` almost never does what you expect]
With the default frame (`UNBOUNDED PRECEDING` to `CURRENT ROW`), `last_value()` returns **the current row**, because the current row *is* the last row of the frame. You must extend the frame:

```sql
last_value(amount) OVER (ORDER BY sold_on
                         ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
```
Or equivalently and more simply, `first_value(amount) OVER (ORDER BY sold_on DESC)`.
:::

The `WINDOW` clause names a window so you define it once and reuse it — worth using the moment you have three window expressions.

---

## 9. The rule you must know: you cannot filter on a window function

```sql
SELECT name, rank() OVER (PARTITION BY dept ORDER BY salary DESC) AS r
FROM employees
WHERE r <= 3;                        -- ❌ ERROR: column "r" does not exist
WHERE rank() OVER (...) <= 3;        -- ❌ ERROR: window functions are not allowed in WHERE
```

Because of the [logical evaluation order](./04-sql-fundamentals.md): `WHERE` runs at step 3, windows at step 6. The window doesn't exist yet.

**Fix — wrap it:**

```sql
SELECT * FROM (
  SELECT name, dept, salary,
         rank() OVER (PARTITION BY dept ORDER BY salary DESC) AS r
  FROM employees
) t
WHERE r <= 3;
```

Or a CTE, which reads better:

```sql
WITH ranked AS (
  SELECT name, dept, salary,
         rank() OVER (PARTITION BY dept ORDER BY salary DESC) AS r
  FROM employees
)
SELECT * FROM ranked WHERE r <= 3;
```

Same restriction applies to `HAVING` and `GROUP BY`. Window functions **can** be used in `ORDER BY`, because that's step 9.

---

## 10. The patterns worth memorising

### Top N per group

```sql
WITH ranked AS (
  SELECT *, row_number() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS rn
  FROM employees
)
SELECT * FROM ranked WHERE rn <= 3;
```

Use `rank()` instead of `row_number()` if you want to keep ties (which may return more than 3 rows). For **exactly one** row per group, `DISTINCT ON` is usually faster on Postgres — see [SQL Fundamentals §3](./04-sql-fundamentals.md).

### Deduplicate, keeping the newest

```sql
DELETE FROM events e
USING (
  SELECT id, row_number() OVER (PARTITION BY user_id, event_type
                                ORDER BY created_at DESC, id DESC) AS rn
  FROM events
) d
WHERE e.id = d.id AND d.rn > 1;
```

### Gaps and islands — find consecutive runs

```sql
SELECT user_id, min(day) AS streak_start, max(day) AS streak_end, count(*) AS streak_len
FROM (
  SELECT user_id, day,
         day - (row_number() OVER (PARTITION BY user_id ORDER BY day))::int AS grp
  FROM activity
) t
GROUP BY user_id, grp;
```

**The trick, traced:**

```text
 day        │ row_number │ day - rn     ← constant within a consecutive run
────────────┼────────────┼──────────────
 2026-01-01 │     1      │ 2025-12-31   ┐
 2026-01-02 │     2      │ 2025-12-31   ├─ run A (3 consecutive days)
 2026-01-03 │     3      │ 2025-12-31   ┘
 2026-01-07 │     4      │ 2026-01-03   ┐
 2026-01-08 │     5      │ 2026-01-03   ┘─ run B (2 consecutive days)

Consecutive days advance by 1; row_number also advances by 1;
so their difference is constant inside a run and jumps at every gap.
Group by that difference → each group is one island.
```

### Running balance / cumulative sum

```sql
SELECT txn_date, amount,
       sum(amount) OVER (PARTITION BY account_id ORDER BY txn_date, id
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
FROM transactions;
```

### Period-over-period

```sql
SELECT month, revenue,
       lag(revenue) OVER (ORDER BY month)                            AS prev_month,
       revenue - lag(revenue) OVER (ORDER BY month)                  AS mom_change,
       lag(revenue, 12) OVER (ORDER BY month)                        AS same_month_last_year
FROM monthly_revenue;
```

### Percent of total, and per-partition share

```sql
SELECT product, revenue,
       round(100.0 * revenue / sum(revenue) OVER (), 2)                     AS pct_overall,
       round(100.0 * revenue / sum(revenue) OVER (PARTITION BY region), 2)  AS pct_of_region
FROM product_revenue;
```

### Sessionisation — group events into sessions with a 30-minute idle gap

```sql
SELECT user_id, event_at,
       sum(new_session) OVER (PARTITION BY user_id ORDER BY event_at) AS session_id
FROM (
  SELECT user_id, event_at,
         CASE WHEN event_at - lag(event_at) OVER (PARTITION BY user_id ORDER BY event_at)
                   > interval '30 minutes'
              OR lag(event_at) OVER (PARTITION BY user_id ORDER BY event_at) IS NULL
              THEN 1 ELSE 0 END AS new_session
  FROM events
) t;
```

A cumulative sum of a 0/1 "is this a new session" flag is a general-purpose grouping idiom — learn it once, reuse it forever.

---

## 11. Performance

```text
WindowAgg  (cost=... rows=... )
  ->  Sort  (cost=...)                ← THIS is where the time goes
        Sort Key: region, sold_on
```

Each distinct `OVER (...)` specification needs its input sorted that way. Consequences:

- **An index matching `(partition_cols, order_cols)` can eliminate the sort entirely.** For `PARTITION BY region ORDER BY sold_on`, an index on `(region, sold_on)` lets Postgres read in order.
- **Reuse the same window** across functions — `WINDOW w AS (...)` — so one sort serves all of them. Three different `OVER` clauses means up to three sorts.
- The sort obeys `work_mem`; spilling shows as `Sort Method: external merge  Disk: 24560kB`.
- Filter first. A CTE that windows 50 M rows and then keeps 100 is doing 50 M rows of work; push the `WHERE` inside.

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| Window functions since **8.4 (2009)** | Since **8.0 (2018)**. Completely absent in 5.7 and earlier |
| `ROWS`, `RANGE`, **`GROUPS`** frame modes | `ROWS` and `RANGE`; **no `GROUPS`** |
| `RANGE BETWEEN INTERVAL '7 days' PRECEDING` on timestamps | Supported in 8.0 |
| `WINDOW w AS (...)` named windows | Supported |
| `FILTER (WHERE ...)` on window aggregates | **Not supported** — use `CASE` inside the aggregate |
| `percentile_cont` etc. as ordered-set aggregates | Not available |

The versions and frame semantics are otherwise the same, so window-function knowledge ports cleanly — the caveat is that a huge amount of production MySQL is still 5.7, where none of this exists and you're writing correlated subqueries and self-joins instead.
:::

---

## 12. Rapid-fire recall

<details>
<summary>**What is a window function and how does it differ from `GROUP BY`?**</summary>

A window function computes an aggregate or ranking over a set of rows related to the current row, and returns one value *per input row* rather than collapsing rows. So six input rows give six output rows, each carrying its group's total, its rank, or the previous row's value. `GROUP BY` collapses the detail; a window keeps it. The practical tell is: if you're joining a table back to a grouped version of itself just to put the total next to each row, you wanted a window function.
</details>

<details>
<summary>**Explain `PARTITION BY`, `ORDER BY` and the frame clause.**</summary>

`PARTITION BY` divides the rows into independent groups; the function restarts at each boundary and never sees across it. `ORDER BY` defines the sequence within a partition, which is what makes running totals, `lag`/`lead` and ranking meaningful. The frame clause defines which subset of the ordered partition the current row actually aggregates over — by default the whole partition if there's no `ORDER BY`, and everything from the start up to the current row if there is one.
</details>

<details>
<summary>**`ROWS` vs `RANGE` — why does it matter?**</summary>

`ROWS` counts physical rows; `RANGE` works on `ORDER BY` *values*, so all rows with the same ordering value — peers — share a frame. The default frame when you write `ORDER BY` is `RANGE`, which means a "running total by day" gives every row on the same day the identical cumulative value, producing a step function instead of a per-row running total. So write `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` explicitly. `RANGE` earns its keep for genuine value windows, like `RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW`, which `ROWS` cannot express.
</details>

<details>
<summary>**`row_number()` vs `rank()` vs `dense_rank()`?**</summary>

`row_number()` always gives distinct consecutive integers, so ties are broken arbitrarily — which is non-deterministic unless you add a unique tiebreaker to the `ORDER BY`. `rank()` gives ties the same number and then skips, so 1, 2, 2, 4. `dense_rank()` gives ties the same number without skipping: 1, 2, 2, 3. Use `row_number()` for pagination and exactly-one-per-group, `rank()` for leaderboards where "joint second" should be followed by fourth, `dense_rank()` for "top 3 distinct salary levels."
</details>

<details>
<summary>**Why can't you use a window function in `WHERE`?**</summary>

Because of logical evaluation order: `WHERE` runs before grouping and before windows are computed, so the value doesn't exist yet. Conceptually windows need the final filtered row set to define partitions, so allowing a window in `WHERE` would be circular. The fix is a subquery or CTE that computes the window, then filter on it in the outer query. Window functions *are* allowed in `ORDER BY`, which runs after `SELECT`.
</details>

<details>
<summary>**Why does `last_value()` return the current row?**</summary>

Because with `ORDER BY` present the default frame ends at the current row, so the last row of the frame *is* the current row. You have to extend the frame to `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`. In practice it's clearer to write `first_value(x) OVER (ORDER BY col DESC)` instead — same result, no frame to get wrong.
</details>

<details>
<summary>**How do you find consecutive runs (gaps and islands)?**</summary>

Subtract a `row_number()` from the sequence value. For consecutive dates, both the date and the row number advance by one each step, so their difference is constant within a run and jumps at every gap — group by that difference and each group is one island. Then `min`, `max` and `count` over the group give the run's start, end and length. The same idea with a cumulative sum of a 0/1 "starts a new group" flag handles sessionisation with an idle timeout.
</details>

<details>
<summary>**How do you make window functions fast?**</summary>

The cost is almost always the sort feeding `WindowAgg`. So build an index matching `(partition columns, order columns)` — Postgres can then read in order and skip the sort entirely. Reuse a single named window with the `WINDOW` clause rather than repeating three slightly different `OVER` specs, because each distinct spec can force its own sort. Filter as early as possible so the window operates on fewer rows, and check `EXPLAIN (ANALYZE)` for `Sort Method: external merge`, which means it spilled and `work_mem` is too small for that query.
</details>

---

**Next:** [CTEs & Recursive Queries →](./08-ctes-and-recursive-queries.md) — with the working table traced iteration by iteration.
