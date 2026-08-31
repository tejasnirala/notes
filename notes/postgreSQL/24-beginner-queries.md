---
title: Beginner Practice
---

# Beginner Practice — Questions 1–10

> **Focus**: clause evaluation order, `NULL` semantics, joins that duplicate or drop rows, `GROUP BY` vs `WHERE` vs `HAVING`, `RETURNING`, `ON CONFLICT`, `DISTINCT ON`.
>
> Every solution includes a **step-by-step trace** with row counts after each clause. Where a trap exists, the trap *is* the lesson.

---

## The shared dataset

```sql
-- customers                                    -- orders
 id | name   | city      | signed_up             id | customer_id | amount | status    | placed_on
----+--------+-----------+-----------           ----+-------------+--------+-----------+------------
  1 | Asha   | Pune      | 2025-11-02             1 |           1 |   500  | paid      | 2026-01-05
  2 | Ravi   | Pune      | 2026-01-15             2 |           1 |   300  | paid      | 2026-01-09
  3 | Meera  | Mumbai    | 2026-02-01             3 |           2 |   900  | paid      | 2026-02-02
  4 | Karan  | Delhi     | 2026-02-20             4 |           2 |   100  | cancelled | 2026-02-11
  5 | Nisha  | NULL      | 2026-03-01             5 |           3 |  1200  | paid      | 2026-02-14
                                                  6 |           3 |   400  | paid      | 2026-03-01
                                                  7 |           3 |   250  | refunded  | 2026-03-03
                                                  8 |        NULL |   150  | paid      | 2026-03-04
                                                  -- customers 4 and 5 have NO orders
```

---

## Question 1: `WHERE` + `ORDER BY` + `LIMIT`

Return the three largest paid orders, newest first among ties.

<details>
<summary>**Solution & Trace**</summary>

```sql
SELECT id, customer_id, amount, placed_on
FROM   orders
WHERE  status = 'paid'
ORDER  BY amount DESC, placed_on DESC, id DESC
LIMIT  3;
```

**Trace:**

```text
── FROM orders ───────────────────────────── 8 rows
   1(500,paid) 2(300,paid) 3(900,paid) 4(100,cancelled)
   5(1200,paid) 6(400,paid) 7(250,refunded) 8(150,paid)

── WHERE status = 'paid' ─────────────────── 8 → 6 rows
   ✗ 4 (cancelled)   ✗ 7 (refunded)
   kept: 1, 2, 3, 5, 6, 8

── ORDER BY amount DESC, placed_on DESC, id DESC ──
   5 (1200)
   3 (900)
   1 (500)
   6 (400)
   2 (300)
   8 (150)

── LIMIT 3 ───────────────────────────────── 6 → 3 rows
   5 | 3 | 1200 | 2026-02-14
   3 | 2 |  900 | 2026-02-02
   1 | 1 |  500 | 2026-01-05
```

:::tip[Why the extra sort keys matter]
Without `id DESC` as a final tiebreaker, two orders with the same `amount` and `placed_on` can come back in either order, and that order may **change between runs** — which silently breaks `LIMIT`/`OFFSET` pagination by duplicating and skipping rows. **Always end an `ORDER BY` with a unique column.**

The supporting index is `CREATE INDEX ON orders (status, amount DESC, placed_on DESC, id DESC)` — equality first, then sort. See [Indexes §2](./13-indexes.md).
:::
</details>

---

## Question 2: You cannot use a `SELECT` alias in `WHERE`

Show each order's revenue after an 18 % tax, keeping only those above 500.

<details>
<summary>**Solution & Trace**</summary>

```sql
-- ❌ This does NOT work
SELECT id, amount * 1.18 AS gross FROM orders WHERE gross > 500;
-- ERROR: column "gross" does not exist

-- ✅ Option A: repeat the expression
SELECT id, amount * 1.18 AS gross FROM orders WHERE amount * 1.18 > 500;

-- ✅ Option B: subquery or CTE — evaluates once, reads better
SELECT * FROM (
  SELECT id, round(amount * 1.18, 2) AS gross FROM orders
) t WHERE gross > 500;

-- ✅ Option C (best here): rearrange so the column stays bare — this one is SARGABLE
SELECT id, round(amount * 1.18, 2) AS gross FROM orders WHERE amount > 500 / 1.18;
```

**Why the error happens — the evaluation order:**

```text
 1 FROM      → rows exist
 2 WHERE     → ← you are here. The SELECT list has NOT been evaluated.
 ...                              `gross` does not exist yet.
 7 SELECT    → aliases are created HERE
 9 ORDER BY  → aliases ARE visible here
```

```sql
SELECT id, amount * 1.18 AS gross FROM orders ORDER BY gross DESC;   -- ✅ works
```

**Trace of option C:**

```text
── WHERE amount > 423.73 ────────── 8 → 3 rows
   3 (900)  5 (1200)  1 (500)

── SELECT (compute gross) ───────── 3 rows
   id │ gross
    1 │  590.00
    3 │ 1062.00
    5 │ 1416.00
```

:::info[PostgreSQL vs MySQL]
MySQL **also** rejects an alias in `WHERE`, but *does* allow it in `HAVING` — a non-standard extension. Postgres rejects it in both. Both allow it in `GROUP BY` and `ORDER BY`. Option C is the important one either way: wrapping the column in arithmetic makes the predicate non-sargable, so no index can be used.
:::
</details>

---

## Question 3: `NULL` is not a value

Count customers who have not recorded a city. Then list customers whose city is not Pune.

<details>
<summary>**Solution & Trace**</summary>

```sql
-- ❌ Returns 0. Always.
SELECT count(*) FROM customers WHERE city = NULL;

-- ✅
SELECT count(*) FROM customers WHERE city IS NULL;     -- 1 (Nisha)
```

```sql
-- ❌ Silently EXCLUDES Nisha, whose city is NULL
SELECT name FROM customers WHERE city <> 'Pune';       -- Meera, Karan

-- ✅ if "no city recorded" should count as "not Pune"
SELECT name FROM customers WHERE city IS DISTINCT FROM 'Pune';  -- Meera, Karan, Nisha
-- or
SELECT name FROM customers WHERE city <> 'Pune' OR city IS NULL;
```

**Trace of the three-valued logic:**

```text
 name  │ city    │ city = NULL │ city IS NULL │ city <> 'Pune' │ city IS DISTINCT FROM 'Pune'
───────┼─────────┼─────────────┼──────────────┼────────────────┼──────────────────────────────
 Asha  │ Pune    │    NULL     │    false     │     false      │           false
 Ravi  │ Pune    │    NULL     │    false     │     false      │           false
 Meera │ Mumbai  │    NULL     │    false     │     true  ✓    │           true  ✓
 Karan │ Delhi   │    NULL     │    false     │     true  ✓    │           true  ✓
 Nisha │ NULL    │    NULL     │    true  ✓   │     NULL  ✗    │           true  ✓
                        ↑                             ↑
              never true, so no rows      NULL is not TRUE → row dropped
```

:::danger[The same trap in `NOT IN`]
```sql
SELECT * FROM customers WHERE id NOT IN (SELECT customer_id FROM orders);
```
`orders.customer_id` contains a `NULL` (order 8), so this returns **zero rows**, not Karan and Nisha. Use `NOT EXISTS`:
```sql
SELECT * FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);   -- Karan, Nisha ✅
```
Identical behaviour on MySQL.
:::
</details>

---

## Question 4: `INNER JOIN` duplicates and drops

For every customer, list their orders. Then count how many rows come back and explain each difference from the customer count.

<details>
<summary>**Solution & Trace**</summary>

```sql
SELECT c.name, o.id AS order_id, o.amount
FROM   customers c
JOIN   orders o ON o.customer_id = c.id;
```

**Trace:**

```text
 customer         │ matching orders           │ rows produced
──────────────────┼───────────────────────────┼───────────────
 1 Asha           │ 1(500), 2(300)            │ 2  ← DUPLICATED
 2 Ravi           │ 3(900), 4(100)            │ 2  ← DUPLICATED
 3 Meera          │ 5(1200), 6(400), 7(250)   │ 3  ← DUPLICATED
 4 Karan          │ (none)                    │ 0  ← DROPPED
 5 Nisha          │ (none)                    │ 0  ← DROPPED
 (order 8, customer_id NULL)                  │ 0  ← DROPPED (NULL never matches)

5 customers, 8 orders  →  7 rows
```

Keep the customers with no orders:

```sql
SELECT c.name, o.id AS order_id, o.amount
FROM   customers c
LEFT JOIN orders o ON o.customer_id = c.id;
```

```text
 name  │ order_id │ amount
───────┼──────────┼────────
 Asha  │     1    │   500
 Asha  │     2    │   300
 Ravi  │     3    │   900
 Ravi  │     4    │   100
 Meera │     5    │  1200
 Meera │     6    │   400
 Meera │     7    │   250
 Karan │   NULL   │  NULL    ← kept, right side NULL-filled
 Nisha │   NULL   │  NULL    ← kept

9 rows.  Order 8 still absent — a LEFT JOIN keeps LEFT rows, not orphaned right rows.
```

:::tip[The two rules]
An inner join **duplicates** the one-side row once per matching many-side row, and **drops** rows with no match on either side. A left join stops the dropping on the left only. Neither ever *merges* rows.
:::
</details>

---

## Question 5: `WHERE` on the right side of a `LEFT JOIN`

List every customer with their **paid** orders — customers with no paid orders must still appear.

<details>
<summary>**Solution & Trace**</summary>

```sql
-- ❌ Silently becomes an INNER JOIN
SELECT c.name, o.id, o.amount
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'paid';

-- ✅ Move the condition into ON
SELECT c.name, o.id, o.amount
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid';
```

**Trace of the wrong version:**

```text
step 1 — LEFT JOIN produces 9 rows (as in Q4)
step 2 — WHERE o.status = 'paid'
   Asha  | 1 | paid       ✓
   Asha  | 2 | paid       ✓
   Ravi  | 3 | paid       ✓
   Ravi  | 4 | cancelled  ✗
   Meera | 5 | paid       ✓
   Meera | 6 | paid       ✓
   Meera | 7 | refunded   ✗
   Karan | NULL           ✗  ← NULL = 'paid' is NULL, not true
   Nisha | NULL           ✗  ← same

→ 5 rows. Karan and Nisha are GONE. The LEFT JOIN did nothing.
```

**Trace of the correct version:**

```text
The ON clause decides ELIGIBILITY to match:
   Asha  → orders 1,2 are paid          → 2 rows
   Ravi  → order 3 paid; order 4 not eligible → 1 row
   Meera → orders 5,6 paid; 7 not eligible    → 2 rows
   Karan → no eligible partner          → 1 row, NULLs
   Nisha → no eligible partner          → 1 row, NULLs

→ 7 rows, all five customers present.
```

:::danger[Memorise this]
**Any `WHERE` predicate on the right-hand table of a `LEFT JOIN` converts it into an `INNER JOIN`.** The only legitimate exception is `WHERE right.id IS NULL`, which is how you write an anti-join. Identical in MySQL — this is SQL semantics, not a dialect difference.
:::
</details>

---

## Question 6: `WHERE` vs `HAVING`

For each customer, total their orders. Then produce two different reports: (a) total of paid orders only, (b) customers whose overall total exceeds 1000.

<details>
<summary>**Solution & Trace**</summary>

```sql
-- (a) WHERE — filters the ROWS that go into the aggregate
SELECT c.name, sum(o.amount) AS paid_total
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'paid'
GROUP BY c.id, c.name;

-- (b) HAVING — filters the GROUPS after aggregation
SELECT c.name, sum(o.amount) AS total
FROM customers c JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name
HAVING sum(o.amount) > 1000;
```

**Trace of (a):**

```text
── JOIN ─────────────────────── 7 rows
── WHERE status='paid' ──────── 7 → 5 rows   (drops order 4 cancelled, order 7 refunded)
   Asha  500, Asha 300, Ravi 900, Meera 1200, Meera 400

── GROUP BY customer ────────── 5 → 3 groups
   Asha  : 500 + 300  =  800
   Ravi  : 900        =  900
   Meera : 1200 + 400 = 1600
```

**Trace of (b):**

```text
── JOIN ─────────────────────── 7 rows (no WHERE — cancelled and refunded INCLUDED)
── GROUP BY customer ────────── 7 → 3 groups
   Asha  : 500 + 300         =  800
   Ravi  : 900 + 100         = 1000
   Meera : 1200 + 400 + 250  = 1850

── HAVING sum > 1000 ────────── 3 → 1 group
   Asha  800   ✗
   Ravi  1000  ✗  (strictly greater — 1000 is not > 1000)
   Meera 1850  ✓
```

Both together, which is what production reports usually want:

```sql
SELECT c.name, sum(o.amount) AS paid_total
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE  o.status = 'paid'          -- ← which rows count
GROUP BY c.id, c.name
HAVING sum(o.amount) > 1000;      -- ← which groups survive
-- → Meera 1600 only
```

:::tip[The one-liner]
`WHERE` filters rows **before** grouping and can use an index. `HAVING` filters groups **after** aggregation and cannot. They answer different questions: (a) is "total of paid orders per customer," (b) is "customers whose total is large." Both are valid; they give different numbers.
:::
</details>

---

## Question 7: `count(*)` vs `count(col)` vs `count(DISTINCT col)`

How many customers placed at least one order? Give three answers and say which is right.

<details>
<summary>**Solution & Trace**</summary>

```sql
SELECT count(*)                  AS a,   -- 7  join output rows
       count(o.id)               AS b,   -- 7  non-NULL order ids
       count(DISTINCT c.id)      AS c    -- 3  ← the correct answer
FROM customers c JOIN orders o ON o.customer_id = c.id;
```

**Trace:**

```text
 join output (7 rows)      count(*)  count(o.id)  count(DISTINCT c.id)
 ─────────────────────     ────────  ───────────  ────────────────────
 Asha  | order 1              ✓          ✓          {1}
 Asha  | order 2              ✓          ✓          {1}
 Ravi  | order 3              ✓          ✓          {1,2}
 Ravi  | order 4              ✓          ✓          {1,2}
 Meera | order 5              ✓          ✓          {1,2,3}
 Meera | order 6              ✓          ✓          {1,2,3}
 Meera | order 7              ✓          ✓          {1,2,3}
                              7          7             3
```

Now on a `LEFT JOIN`, where the difference between `count(*)` and `count(col)` finally shows:

```sql
SELECT c.name,
       count(*)      AS wrong,   -- counts the NULL-filled row too!
       count(o.id)   AS right_
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name;
```

```text
 name  │ wrong │ right_
───────┼───────┼────────
 Asha  │   2   │   2
 Ravi  │   2   │   2
 Meera │   3   │   3
 Karan │   1   │   0    ← count(*) counts the phantom NULL row
 Nisha │   1   │   0    ←
```

:::danger[The phantom row]
After a `LEFT JOIN`, a parent with **zero** matches still produces one row. `count(*)` counts it as 1. **`count(o.id)` is the correct form** — it ignores NULLs, so a customer with no orders correctly counts 0. This is the exact analogue of MongoDB's `preserveNullAndEmptyArrays` over-count bug.
:::
</details>

---

## Question 8: `RETURNING` and `ON CONFLICT`

Insert a customer, get the generated id back, and make the insert idempotent so re-running it doesn't fail.

<details>
<summary>**Solution & Trace**</summary>

```sql
-- Generated values back in ONE round trip
INSERT INTO customers (name, city)
VALUES ('Zoya', 'Pune')
RETURNING id, signed_up;
-- → id = 6, signed_up = 2026-08-31 (the DEFAULT, evaluated server-side)
```

```sql
-- Idempotent upsert, assuming: CREATE UNIQUE INDEX ON customers (lower(email))
INSERT INTO customers (name, email, city)
VALUES ('Zoya', 'zoya@example.com', 'Pune')
ON CONFLICT (lower(email)) DO UPDATE
  SET name = EXCLUDED.name,
      city = EXCLUDED.city
RETURNING id, (xmax = 0) AS was_inserted;
```

**Trace:**

```text
FIRST RUN
  no conflicting row  →  INSERT executes
  → id = 6, was_inserted = true

SECOND RUN (same email)
  unique index on lower(email) violated  →  the DO UPDATE branch runs
  EXCLUDED = the row we tried to insert   {name:'Zoya', city:'Pune', ...}
  customers = the EXISTING row
  → id = 6, was_inserted = false      (xmax <> 0 means the row was updated)
```

Variants:

```sql
INSERT INTO tags (name) VALUES ('sql') ON CONFLICT DO NOTHING;   -- ignore conflicts only

-- last-write-wins by timestamp, with no race
INSERT INTO cache (key, value, updated_at) VALUES ($1, $2, now())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  WHERE cache.updated_at < EXCLUDED.updated_at;      -- ← MySQL cannot express this
```

:::info[PostgreSQL vs MySQL]
MySQL's `INSERT ... ON DUPLICATE KEY UPDATE` fires on **whichever** unique constraint happens to conflict — you can't name one — and has **no `WHERE` clause** on the update, so conditional upserts need `IF()`/`GREATEST()` tricks. It also has no `RETURNING`, so `LAST_INSERT_ID()` gives you only the first id of a batch and nothing at all for updates.

And `INSERT IGNORE` is **not** the equivalent of `ON CONFLICT DO NOTHING`: it downgrades *every* error to a warning, so a truncated string or an invalid date is silently accepted.
:::
</details>

---

## Question 9: `DISTINCT ON` — the latest row per customer

Return each customer's most recent order.

<details>
<summary>**Solution & Trace**</summary>

```sql
SELECT DISTINCT ON (customer_id)
       customer_id, id AS order_id, amount, placed_on
FROM   orders
WHERE  customer_id IS NOT NULL
ORDER  BY customer_id, placed_on DESC, id DESC;
```

**Trace:**

```text
Step A — ORDER BY customer_id, placed_on DESC, id DESC
         (the LEADING sort columns must match the DISTINCT ON list — this is mandatory)

 customer_id │ id │ amount │ placed_on
─────────────┼────┼────────┼────────────
      1      │  2 │   300  │ 2026-01-09   ◀── first row of the customer-1 run
      1      │  1 │   500  │ 2026-01-05
      2      │  4 │   100  │ 2026-02-11   ◀── first row of the customer-2 run
      2      │  3 │   900  │ 2026-02-02
      3      │  7 │   250  │ 2026-03-03   ◀── first row of the customer-3 run
      3      │  6 │   400  │ 2026-03-01
      3      │  5 │  1200  │ 2026-02-14

Step B — DISTINCT ON (customer_id): keep the FIRST row of each run
      1 │ 2 │ 300 │ 2026-01-09
      2 │ 4 │ 100 │ 2026-02-11
      3 │ 7 │ 250 │ 2026-03-03

7 rows → 3 rows
```

The portable equivalent:

```sql
SELECT customer_id, order_id, amount, placed_on FROM (
  SELECT customer_id, id AS order_id, amount, placed_on,
         row_number() OVER (PARTITION BY customer_id ORDER BY placed_on DESC, id DESC) AS rn
  FROM orders WHERE customer_id IS NOT NULL
) t WHERE rn = 1;
```

:::tip[Which to use]
`DISTINCT ON` is shorter and, with an index on `(customer_id, placed_on DESC)`, usually **faster** — it can skip ahead per group rather than ranking every row. The window-function version works on MySQL 8+ (nothing works on 5.7) and generalises to top-N where N is greater than 1. Postgres-only code: `DISTINCT ON`. Portable code: `row_number()`.
:::
</details>

---

## Question 10: A report with no gaps

Show daily paid revenue for the first week of March 2026 — including days with no orders, shown as 0.

<details>
<summary>**Solution & Trace**</summary>

```sql
SELECT d.day::date,
       coalesce(sum(o.amount), 0) AS revenue,
       count(o.id)                AS order_count
FROM   generate_series(date '2026-03-01', date '2026-03-07', interval '1 day') AS d(day)
LEFT JOIN orders o
       ON o.placed_on = d.day
      AND o.status = 'paid'          -- ← in ON, not WHERE, or the zero days vanish
GROUP  BY d.day
ORDER  BY d.day;
```

**Trace:**

```text
── generate_series ─────────────── 7 rows (the "date spine")
   2026-03-01 … 2026-03-07

── LEFT JOIN orders ON date match AND status='paid' ──
   2026-03-01 → order 6 (400, paid)   ✓
   2026-03-02 → none
   2026-03-03 → order 7 exists but is 'refunded' → NOT ELIGIBLE → no match
   2026-03-04 → order 8 (150, paid)   ✓
   2026-03-05 → none
   2026-03-06 → none
   2026-03-07 → none
                                        → 7 rows (each spine day kept)

── GROUP BY day, aggregate ────── 7 rows
   day        │ revenue │ order_count
   2026-03-01 │   400   │      1
   2026-03-02 │     0   │      0     ← coalesce turned NULL into 0
   2026-03-03 │     0   │      0     ← count(o.id) ignores the NULL row
   2026-03-04 │   150   │      1
   2026-03-05 │     0   │      0
   2026-03-06 │     0   │      0
   2026-03-07 │     0   │      0
```

**Three separate traps handled in one query:**

1. `status = 'paid'` is in `ON`, not `WHERE` — otherwise every zero-revenue day disappears (Q5).
2. `coalesce(sum(...), 0)` — `sum()` over zero rows returns `NULL`, not `0`.
3. `count(o.id)`, not `count(*)` — otherwise every empty day counts 1 (Q7).

:::info[PostgreSQL vs MySQL]
`generate_series` doesn't exist in MySQL. There you build the date spine with a recursive CTE (8.0+) or a permanent numbers table:

```sql
-- MySQL 8
WITH RECURSIVE d AS (
  SELECT DATE '2026-03-01' AS day
  UNION ALL SELECT day + INTERVAL 1 DAY FROM d WHERE day < '2026-03-07'
) SELECT ... FROM d LEFT JOIN orders ...
```
On Postgres, also consider `date_trunc('day', placed_on)` for a timestamp column, and always pass a `timezone` when the boundary matters: `date_trunc('day', placed_at AT TIME ZONE 'Asia/Kolkata')`.
:::
</details>

---

**Next:** [Intermediate (Q11–22) →](./25-intermediate-queries.md)
