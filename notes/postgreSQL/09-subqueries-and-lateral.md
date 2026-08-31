---
title: Subqueries, LATERAL & EXISTS
---

# Subqueries, LATERAL & EXISTS

> **What you will be able to do after this page**
>
> - Classify any subquery: scalar, row, table, correlated or uncorrelated — and predict its cost.
> - Explain `EXISTS` vs `IN` vs `JOIN` precisely, including the NULL trap and what the planner actually does.
> - Use `LATERAL` to write top-N-per-group and per-row computations that plain subqueries cannot express.
> - Read semi-join and anti-join nodes in `EXPLAIN`.

---

## 1. The taxonomy

| Kind | Returns | Where it can appear |
| :--- | :--- | :--- |
| **Scalar subquery** | Exactly one row, one column | Anywhere a value is allowed: `SELECT`, `WHERE`, `SET` |
| **Row subquery** | One row, several columns | `WHERE (a,b) = (SELECT x,y FROM ...)` |
| **Table subquery** | Many rows/columns | `FROM`, `JOIN`, `IN`, `EXISTS` |
| **Correlated** | References the outer query | Conceptually re-evaluated per outer row |
| **Uncorrelated** | Independent | Evaluated once |

```sql
-- scalar, uncorrelated: runs ONCE
SELECT name, salary, (SELECT avg(salary) FROM employees) AS company_avg FROM employees;

-- scalar, CORRELATED: conceptually once per outer row
SELECT name, salary,
       (SELECT avg(salary) FROM employees e2 WHERE e2.dept_id = e1.dept_id) AS dept_avg
FROM employees e1;

-- table subquery in FROM (a "derived table") — must be aliased
SELECT * FROM (SELECT dept_id, avg(salary) AS a FROM employees GROUP BY dept_id) d
WHERE d.a > 50000;
```

:::warning[A scalar subquery returning more than one row is a runtime error]
```sql
SELECT (SELECT id FROM employees WHERE dept_id = 10);
-- ERROR: more than one row returned by a subquery used as an expression
```
It compiles fine and fails only when the data grows past one match. Guard with `LIMIT 1` plus a deterministic `ORDER BY`, or use an aggregate. Returning **zero** rows is not an error — it yields `NULL`.

MySQL behaves identically here (`ERROR 1242: Subquery returns more than 1 row`).
:::

---

## 2. `IN` vs `EXISTS` vs `JOIN`

The same question, three ways:

```sql
-- A) IN
SELECT * FROM customers c WHERE c.id IN (SELECT customer_id FROM orders);

-- B) EXISTS
SELECT * FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);

-- C) JOIN
SELECT DISTINCT c.* FROM customers c JOIN orders o ON o.customer_id = c.id;
```

All three answer "customers who have at least one order." Modern Postgres usually turns **A and B into the same semi-join plan**. C is different: the join produces one row per order and then `DISTINCT` deduplicates — more work, and it's easy to forget the `DISTINCT` and get duplicated customers.

```text
Semi-join semantics (what EXISTS/IN mean):
  for each customer, ask "is there AT LEAST ONE matching order?"
  → yes: emit the customer ONCE
  → no:  skip
  The customer is never duplicated, and order columns are not available.

Join semantics:
  emit one row per (customer, order) pair
  → customers with 5 orders appear 5 times
  → order columns ARE available
```

**The decision rule:** if you need columns from the other table, `JOIN`. If you only need "does a match exist," `EXISTS`.

### `EXISTS` short-circuits

`EXISTS` stops at the first matching row. That's why `SELECT 1` is the convention inside it — the select list is never evaluated, so `SELECT 1`, `SELECT *`, `SELECT 1/0` are all identical in cost. (Yes, `EXISTS (SELECT 1/0 FROM t)` really does work.)

### `NOT IN` vs `NOT EXISTS` — the NULL trap

```sql
SELECT * FROM customers WHERE id NOT IN (SELECT customer_id FROM orders);
```

```text
Suppose orders.customer_id contains: 1, 2, NULL

  id NOT IN (1, 2, NULL)
= NOT (id = 1 OR id = 2 OR id = NULL)
= NOT (false OR false OR NULL)      for id = 5
= NOT (NULL)
= NULL                              ← not TRUE, so the row is NOT returned

RESULT: zero rows. Always. Silently.
```

```sql
-- Correct, and usually a better plan (Anti Join)
SELECT * FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);
```

:::danger[Rule: never write `NOT IN` against a subquery]
Unless the column is provably `NOT NULL`, and even then — `NOT EXISTS` is safer, clearer, and lets the planner use an Anti Join. `NOT IN` also blocks that optimisation in many cases, because the planner must preserve the NULL semantics.

This behaves identically in MySQL. Same trap, same fix, and a very common interview question.
:::

### `ANY` / `ALL` / `SOME`

```sql
SELECT * FROM products WHERE price > ALL (SELECT price FROM products WHERE cat = 'budget');
SELECT * FROM products WHERE price > ANY (SELECT price FROM products WHERE cat = 'budget');
SELECT * FROM products WHERE id = ANY (ARRAY[1,2,3]);        -- ← the array form is everywhere
```

`x IN (subquery)` is exactly `x = ANY (subquery)`. `x NOT IN (...)` is `x <> ALL (...)`, which is why the NULL trap exists — `<> NULL` is `NULL`.

`= ANY(array)` is the idiomatic way to pass a list from application code as a single parameter:

```sql
SELECT * FROM users WHERE id = ANY($1::bigint[]);   -- one parameter, any length
```

That beats building `IN (?, ?, ?, ...)` dynamically — no SQL string assembly, no plan-cache explosion from a different query text per list length. **MySQL has no array type, so it has no equivalent**; you build the `IN` list or use `FIND_IN_SET` (which can't use an index).

---

## 3. Reading semi/anti joins in `EXPLAIN`

```sql
EXPLAIN ANALYZE
SELECT * FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);
```

```text
 Hash Semi Join  (cost=1264.00..2089.24 rows=4210 width=45)
                 (actual time=8.114..21.005 rows=4187 loops=1)
   Hash Cond: (c.id = o.customer_id)
   ->  Seq Scan on customers c  (actual rows=6000 loops=1)
   ->  Hash  (actual rows=4187 loops=1)
         ->  Seq Scan on orders o  (actual rows=50000 loops=1)
```

Node names to recognise:

| Node | Means |
| :--- | :--- |
| `Hash Semi Join` / `Nested Loop Semi Join` | `EXISTS` / `IN` — emit the outer row at most once |
| `Hash Anti Join` / `Nested Loop Anti Join` | `NOT EXISTS` — emit outer rows with no match |
| `SubPlan` | The subquery is being executed **per outer row** — not flattened. Often the problem |
| `InitPlan` | Uncorrelated subquery executed **once** before the main query. Good |
| `hashed SubPlan` | An `IN` list was hashed and probed — better than a plain SubPlan |

**`SubPlan` with a high `loops=` count is the thing to look for.** It means the planner could not flatten the correlated subquery into a join, and it's re-running it per row.

---

## 4. Correlated subqueries — cost and rewriting

```sql
-- correlated: conceptually one execution per outer row
SELECT c.name,
       (SELECT count(*) FROM orders o WHERE o.customer_id = c.id) AS order_count,
       (SELECT max(placed_on) FROM orders o WHERE o.customer_id = c.id) AS last_order
FROM customers c;
```

```text
 6,000 customers × 2 subqueries = 12,000 index lookups on orders.
 With an index on orders(customer_id) each is cheap, so this is often fine.
 Without one, it's 12,000 sequential scans of a 50,000-row table. Catastrophic.
```

The rewrite, one pass:

```sql
SELECT c.name, coalesce(o.order_count, 0), o.last_order
FROM customers c
LEFT JOIN (
    SELECT customer_id, count(*) AS order_count, max(placed_on) AS last_order
    FROM orders GROUP BY customer_id
) o ON o.customer_id = c.id;
```

:::tip[When a correlated scalar subquery is actually the right answer]
When the outer row count is small (after filtering) and the inner side is indexed. `SELECT ... FROM customers WHERE id = 42` with two correlated subqueries is two index lookups — perfectly fine and more readable than a join. The problem is only correlation across a **large** outer set with **no index** on the correlation column.

Also: two correlated subqueries against the same table can be collapsed into one `LATERAL`, which scans once instead of twice.
:::

---

## 5. `LATERAL` — subqueries that can see the row

A subquery in `FROM` normally **cannot reference columns of the tables beside it**:

```sql
SELECT c.name, recent.*
FROM customers c,
     (SELECT * FROM orders WHERE customer_id = c.id ORDER BY placed_on DESC LIMIT 3) recent;
-- ❌ ERROR: invalid reference to FROM-clause entry for table "c"
```

`LATERAL` lifts that restriction — it makes the subquery run **once per outer row**, with the outer row's columns in scope. It's a `for` loop in SQL.

```sql
SELECT c.name, recent.id, recent.amount, recent.placed_on
FROM customers c
CROSS JOIN LATERAL (
    SELECT id, amount, placed_on
    FROM orders o
    WHERE o.customer_id = c.id
    ORDER BY o.placed_on DESC
    LIMIT 3
) recent;
```

**Trace:**

```text
customers: Asha(1), Ravi(2), Karan(4 — no orders)

For c = Asha(1):
    run the subquery with c.id = 1 → orders 12, 8, 3 (newest 3)
    emit: (Asha, 12), (Asha, 8), (Asha, 3)

For c = Ravi(2):
    run the subquery with c.id = 2 → orders 21, 19
    emit: (Ravi, 21), (Ravi, 19)

For c = Karan(4):
    run the subquery with c.id = 4 → {} empty
    CROSS JOIN LATERAL drops the row entirely  ← like an INNER JOIN
    (use LEFT JOIN LATERAL ... ON true to keep Karan with NULLs)

OUTPUT: 5 rows
```

```sql
-- keep customers with no orders
SELECT c.name, recent.id
FROM customers c
LEFT JOIN LATERAL (
    SELECT id FROM orders o WHERE o.customer_id = c.id ORDER BY placed_on DESC LIMIT 3
) recent ON true;                 -- ← `ON true` is required, and always looks odd
```

### Why `LATERAL` and not a window function?

```sql
-- window function version of top-3-per-customer
SELECT * FROM (
  SELECT *, row_number() OVER (PARTITION BY customer_id ORDER BY placed_on DESC) rn
  FROM orders
) t WHERE rn <= 3;
```

```text
Window version : reads and RANKS ALL 50,000 orders, then discards 47,000.
LATERAL version: with an index on orders(customer_id, placed_on DESC),
                 does 6,000 index lookups each reading exactly 3 rows = 18,000 rows touched.

For a large table with a small number of groups, LATERAL wins decisively.
For a small table, or many groups relative to table size, the window function wins
(one pass vs N lookups).
```

That trade-off — **"index-driven loop over few groups" vs "one full pass"** — is the real answer to "how do you get top N per group," and knowing both sides of it is what a senior answer looks like.

### Other things `LATERAL` is for

```sql
-- Reuse a computed value instead of repeating the expression 3 times
SELECT o.id, calc.revenue, calc.revenue * 0.18 AS gst, calc.revenue * 1.18 AS total
FROM orders o
CROSS JOIN LATERAL (SELECT o.qty * o.unit_price AS revenue) calc;

-- Expand a set-returning function per row
SELECT p.id, tag
FROM posts p, LATERAL unnest(p.tags) AS tag;

-- Per-row aggregation over a range that depends on the row
SELECT d.day, stats.*
FROM days d
CROSS JOIN LATERAL (
    SELECT count(*) AS n, sum(amount) AS revenue
    FROM orders o
    WHERE o.placed_on BETWEEN d.day - 6 AND d.day     -- rolling 7-day window per day
) stats;
```

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| `LATERAL` since **9.3 (2013)** | Since **8.0.14 (2019)**, same syntax and semantics |
| `LEFT JOIN LATERAL ... ON true` | Same |
| Combines with set-returning functions (`unnest`, `generate_series`, `jsonb_array_elements`) | Limited — MySQL has almost no set-returning functions except `JSON_TABLE` |

`LATERAL` itself is now portable. What isn't portable is the ecosystem around it: Postgres has dozens of set-returning functions that make `LATERAL` genuinely powerful, MySQL essentially has `JSON_TABLE`.
:::

---

## 6. Subqueries in `SELECT` vs `FROM` vs `WHERE` — quick guidance

| Placement | Use when | Watch out for |
| :--- | :--- | :--- |
| `SELECT` (scalar) | One extra derived value, small outer set | Runs per row; must return ≤ 1 row |
| `FROM` (derived table) | Pre-aggregating before a join | Must be aliased; can't see sibling tables (unless `LATERAL`) |
| `WHERE ... EXISTS` | Existence tests | Prefer over `IN` for correlated cases |
| `WHERE ... IN (list)` | Small static or uncorrelated lists | Use `= ANY(array)` for parameterised lists |
| `LATERAL` | Per-row top-N, per-row computation | Runs per outer row — needs the right index |
| CTE | Readability, reuse, recursion | Materialization behaviour (see [CTEs](./08-ctes-and-recursive-queries.md)) |

---

## 7. Rapid-fire recall

<details>
<summary>**`EXISTS` vs `IN` vs `JOIN` — when do you use each?**</summary>

`EXISTS` and `IN` both express "is there at least one match," and the planner usually compiles both to the same semi-join, so the outer row is emitted at most once. I reach for `EXISTS` when the subquery is correlated, and `IN` for a small uncorrelated list. A `JOIN` is different in kind: it produces one row per matching pair, so the outer row is duplicated, and you need `DISTINCT` to get back to one — which is extra work and easy to forget. So the rule is: need columns from the other table, join; only need existence, `EXISTS`.
</details>

<details>
<summary>**Why is `NOT IN` dangerous?**</summary>

Because `x NOT IN (1, 2, NULL)` expands to `x <> 1 AND x <> 2 AND x <> NULL`, and comparing anything to NULL yields NULL, so the whole expression is NULL rather than true and the row is filtered out. If the subquery can return even one NULL, the query silently returns zero rows. `NOT EXISTS` has correct existence semantics, doesn't have the trap, and usually gets a proper anti-join plan. It behaves the same way in MySQL.
</details>

<details>
<summary>**What is `LATERAL` and what problem does it solve?**</summary>

Normally a subquery in the `FROM` clause can't reference columns from the tables listed beside it, because they're all evaluated independently. `LATERAL` allows that reference, which means the subquery runs once per outer row with that row's values in scope — effectively a `for` loop. It's how you write "the three most recent orders for each customer" with a `LIMIT` inside, which a plain join can't express, and how you expand a set-returning function per row. Use `LEFT JOIN LATERAL ... ON true` when you need to keep outer rows whose subquery returned nothing.
</details>

<details>
<summary>**Top N per group: `LATERAL` or a window function?**</summary>

Depends on the shape of the data. The window-function version ranks every row of the table and then throws most of them away — one full pass. The `LATERAL` version does one indexed lookup per group, reading exactly N rows each time. So with few groups relative to table size and an index on `(group_key, sort_key)`, `LATERAL` is dramatically faster; with many groups, or a small table, the single pass of the window function wins. On Postgres, if N is exactly 1, `DISTINCT ON` is usually the fastest and shortest of the three.
</details>

<details>
<summary>**What does `SubPlan` in an `EXPLAIN` plan mean?**</summary>

That the planner could not flatten a subquery into a join, so it's executing it as a separate plan — and if it's correlated, once per outer row. A `SubPlan` with a large `loops=` count is usually the reason a query is slow. `InitPlan` is the good case: an uncorrelated subquery evaluated once up front and reused. When I see a hot `SubPlan` I try to rewrite it as a join, a `LATERAL`, or a pre-aggregated derived table.
</details>

<details>
<summary>**How do you pass a list of IDs into a query?**</summary>

`WHERE id = ANY($1::bigint[])` — a single array parameter of any length. It avoids building `IN (?, ?, ?)` strings dynamically, which produces a distinct query text for every list length and pollutes the plan cache. MySQL has no array type, so there you're stuck constructing the `IN` list. `IN (subquery)` is exactly `= ANY (subquery)` under the hood, which is also why `NOT IN` inherits the `<> ALL` NULL problem.
</details>

<details>
<summary>**When is a correlated subquery fine?**</summary>

When the outer row set is small after filtering, and the correlation column on the inner table is indexed — then it's a handful of index lookups and it reads better than the join equivalent. It becomes a problem when the outer set is large or the index is missing, at which point you're running thousands of sequential scans. The rewrite is a pre-aggregated derived table joined once, or a `LATERAL` if you need per-row `LIMIT` or want to compute several correlated values in a single scan instead of one scan each.
</details>

---

**Next:** [JSON & JSONB →](./10-json-and-jsonb.md)
