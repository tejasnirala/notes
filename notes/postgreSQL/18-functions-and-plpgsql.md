---
title: Functions, Procedures & PL/pgSQL
---

# Functions, Procedures & PL/pgSQL

> **What you will be able to do after this page**
>
> - Write functions and procedures correctly, including volatility, security and `search_path`.
> - Know the difference between a function and a procedure, and why it matters (transactions).
> - Write PL/pgSQL with proper error handling, `RETURNS TABLE`, cursors and dynamic SQL — safely.
> - Explain why `IMMUTABLE`/`STABLE`/`VOLATILE` is a correctness *and* performance decision.

---

## 1. A function, fully specified

```sql
CREATE OR REPLACE FUNCTION order_total(p_order_id bigint)
RETURNS numeric
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
    SELECT coalesce(sum(qty * unit_price), 0)
    FROM order_items
    WHERE order_id = p_order_id;
$$;
```

Every clause is a decision:

| Clause | Meaning |
| :--- | :--- |
| `LANGUAGE sql` | Plain SQL — **inlinable** by the planner. `plpgsql` for procedural logic |
| `STABLE` | Same result within one statement; reads the database but doesn't modify it |
| `PARALLEL SAFE` | May run inside a parallel worker |
| `SECURITY INVOKER` | Runs with the caller's privileges (the default and the safe choice) |
| `SET search_path` | Pins name resolution — **mandatory** for `SECURITY DEFINER` |
| `$$ ... $$` | Dollar quoting, so you don't escape single quotes |

### Volatility — the most important and most ignored clause

| Volatility | Guarantee | Planner may |
| :--- | :--- | :--- |
| `IMMUTABLE` | Same inputs → same output, forever. Doesn't read the database | **Pre-evaluate at plan time**, use in expression indexes, in generated columns |
| `STABLE` | Same result within a single statement. May read the database | Evaluate once per statement, use in an index *scan* condition |
| `VOLATILE` (default) | May return anything, may have side effects | Re-evaluate for every row. Never in an index |

```sql
SELECT * FROM t WHERE created_at > now() - interval '1 day';
-- now() is STABLE, so it's computed ONCE and the comparison becomes a constant range
-- → an index on created_at is usable.

SELECT * FROM t WHERE x = my_volatile_fn();
-- VOLATILE → called for EVERY ROW, and no index can be used.
```

:::danger[Mislabelling volatility gives wrong answers, not just slow ones]
Marking a function `IMMUTABLE` when it isn't is the classic footgun:

```sql
CREATE FUNCTION today() RETURNS date IMMUTABLE AS $$ SELECT current_date $$ LANGUAGE sql;
CREATE INDEX ON orders (today());   -- the index is baked with the value from build day
                                    -- and silently becomes WRONG tomorrow
```
Postgres trusts you. It doesn't verify. The same reason `to_timestamp(text, text)` is only `STABLE` (it depends on `DateStyle`) and can't go in a generated column.

**The default is `VOLATILE`**, so a function you don't label is re-evaluated per row and can never be used in an expression index. Label everything.
:::

---

## 2. `LANGUAGE sql` vs `LANGUAGE plpgsql`

```sql
-- SQL function: a single statement (or several), inlinable, no control flow
CREATE FUNCTION active_users() RETURNS SETOF users
LANGUAGE sql STABLE AS $$
    SELECT * FROM users WHERE deleted_at IS NULL;
$$;

-- PG 14+ standard-conforming body: parsed at creation time, dependencies tracked
CREATE FUNCTION active_users() RETURNS SETOF users
LANGUAGE sql STABLE
BEGIN ATOMIC
    SELECT * FROM users WHERE deleted_at IS NULL;
END;
```

**A simple `LANGUAGE sql` function can be inlined into the calling query**, so the planner sees through it and can push predicates in. A `plpgsql` function is an opaque black box — the planner cannot see inside, so `SELECT * FROM my_plpgsql_fn() WHERE id = 5` runs the whole function and filters afterwards.

:::tip[Prefer `LANGUAGE sql` whenever you don't need control flow]
Inlining is a large, invisible performance difference. Use `plpgsql` only when you genuinely need loops, conditionals, exception handling, or dynamic SQL.
:::

---

## 3. PL/pgSQL essentials

```sql
CREATE OR REPLACE FUNCTION apply_discount(p_order_id bigint, p_pct numeric)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_total    numeric;
    v_new      numeric;
    v_customer record;
BEGIN
    -- INTO for a single row
    SELECT coalesce(sum(qty * unit_price), 0) INTO v_total
    FROM order_items WHERE order_id = p_order_id;

    IF v_total IS NULL OR v_total = 0 THEN
        RAISE EXCEPTION 'Order % has no items', p_order_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF p_pct < 0 OR p_pct > 100 THEN
        RAISE EXCEPTION 'Invalid discount: %%', p_pct;   -- %% prints a literal %
    END IF;

    v_new := round(v_total * (1 - p_pct / 100), 2);

    UPDATE orders SET total = v_new WHERE id = p_order_id;

    RAISE NOTICE 'Order % discounted from % to %', p_order_id, v_total, v_new;
    RETURN v_new;
END;
$$;
```

### Control flow

```sql
IF cond THEN ... ELSIF cond THEN ... ELSE ... END IF;

CASE v_status
  WHEN 'paid' THEN ...
  ELSE ...
END CASE;

FOR i IN 1..10 LOOP ... END LOOP;
FOR i IN REVERSE 10..1 BY 2 LOOP ... END LOOP;
FOR rec IN SELECT * FROM orders WHERE status = 'pending' LOOP
    RAISE NOTICE '%', rec.id;
END LOOP;
FOREACH v_tag IN ARRAY p_tags LOOP ... END LOOP;

WHILE cond LOOP ... END LOOP;
LOOP ... EXIT WHEN cond; ... CONTINUE WHEN cond; END LOOP;
```

### Returning sets

```sql
-- RETURNS TABLE — the clearest form
CREATE FUNCTION top_customers(p_limit int)
RETURNS TABLE (customer_id bigint, name text, revenue numeric)
LANGUAGE sql STABLE AS $$
    SELECT c.id, c.name, sum(o.total)
    FROM customers c JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id, c.name
    ORDER BY 3 DESC
    LIMIT p_limit;
$$;

SELECT * FROM top_customers(10);
```

```sql
-- RETURN NEXT / RETURN QUERY in plpgsql
CREATE FUNCTION f() RETURNS SETOF orders LANGUAGE plpgsql AS $$
DECLARE r orders;
BEGIN
    FOR r IN SELECT * FROM orders LOOP
        IF r.total > 100 THEN RETURN NEXT r; END IF;   -- accumulates, doesn't exit
    END LOOP;
    RETURN QUERY SELECT * FROM archived_orders;        -- append a whole result set
    RETURN;
END $$;
```

`RETURN NEXT` buffers the entire result set in memory before returning. For large results prefer a single `RETURN QUERY`, or `LANGUAGE sql`.

### `OUT` parameters and composite returns

```sql
CREATE FUNCTION split_name(full_name text, OUT first_name text, OUT last_name text)
LANGUAGE sql IMMUTABLE AS $$
    SELECT split_part(full_name, ' ', 1), split_part(full_name, ' ', 2);
$$;

SELECT * FROM split_name('Asha Nair');    -- first_name | last_name
```

---

## 4. Error handling

```sql
CREATE FUNCTION safe_transfer(p_from bigint, p_to bigint, p_amt numeric)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    UPDATE accounts SET balance = balance - p_amt
    WHERE id = p_from AND balance >= p_amt;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient funds in account %', p_from
            USING ERRCODE = 'check_violation',
                  HINT = 'Check the balance before transferring';
    END IF;

    UPDATE accounts SET balance = balance + p_amt WHERE id = p_to;
    RETURN true;

EXCEPTION
    WHEN check_violation THEN
        RAISE;                                   -- re-raise to the caller
    WHEN unique_violation THEN
        RETURN false;
    WHEN OTHERS THEN
        RAISE WARNING 'Transfer failed: % (%)', SQLERRM, SQLSTATE;
        RETURN false;
END $$;
```

| Variable | Contains |
| :--- | :--- |
| `SQLSTATE` | The five-character error code, e.g. `23505` |
| `SQLERRM` | The error message text |
| `FOUND` | Boolean — did the last statement affect any rows? |
| `GET DIAGNOSTICS n = ROW_COUNT` | Rows affected |
| `GET STACKED DIAGNOSTICS x = PG_EXCEPTION_DETAIL` | Detail/hint/context inside a handler |

:::warning[An `EXCEPTION` block is not free]
Entering a block with an `EXCEPTION` clause creates an internal **subtransaction** (savepoint) on every execution. In a hot loop that's a real cost, and it consumes subtransaction slots — more than 64 nested/accumulated subtransactions in one transaction triggers `SubtransSLRU` contention that can hurt the entire cluster.

Don't wrap every statement in an exception handler "just in case." Handle the errors you can actually do something about.
:::

Common error codes to recognise:

| Code | Condition |
| :--- | :--- |
| `23505` | `unique_violation` |
| `23503` | `foreign_key_violation` |
| `23502` | `not_null_violation` |
| `23514` | `check_violation` |
| `40001` | `serialization_failure` — retry |
| `40P01` | `deadlock_detected` — retry |
| `55P03` | `lock_not_available` (`NOWAIT`) |
| `P0001` | `raise_exception` — a plain `RAISE EXCEPTION` |

---

## 5. Functions vs procedures

```sql
CREATE PROCEDURE nightly_maintenance()
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM sessions WHERE expires_at < now();
    COMMIT;                                       -- ← only a PROCEDURE can do this
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue;
    COMMIT;
END $$;

CALL nightly_maintenance();
```

| | Function | Procedure (PG 11+) |
| :--- | :--- | :--- |
| Invoked with | `SELECT f()` — usable in queries | `CALL p()` — a statement of its own |
| Returns | A value or a set | Nothing (or `INOUT` parameters) |
| **Transaction control** | ❌ runs inside the caller's transaction | ✅ **can `COMMIT` / `ROLLBACK`** |
| Use for | Computation, reusable query logic | Batch jobs, migrations, long-running maintenance |

**Transaction control is the entire point of procedures.** A batch job that deletes ten million rows should commit every ten thousand, and only a procedure can do that.

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| Functions in **many languages**: SQL, PL/pgSQL, and via extensions PL/Python, PL/Perl, PL/v8 (JavaScript), PL/Rust | One procedural language, SQL/PSM-style |
| **Function overloading** by argument types | ❌ No overloading |
| Default parameter values, named arguments (`f(a => 1)`), variadic | Limited |
| Functions can return sets (`RETURNS TABLE`, `SETOF`) usable directly in `FROM` | Only procedures return result sets, and not composably in `FROM` |
| Volatility classification drives planner optimisation | No equivalent (there's `DETERMINISTIC`, used mainly for replication safety) |
| Procedures with transaction control (11+) | Procedures can do `COMMIT`/`ROLLBACK` too |
| Dollar quoting `$$` | `DELIMITER //` gymnastics |
| Functions usable in expression indexes, generated columns, `CHECK` constraints | Functional indexes since 8.0.13 |

Postgres' server-side programming is substantially richer. The `RETURNS TABLE` function usable directly in a `FROM` clause is the difference that shows up most in practice — it lets you build composable, parameterised views.
:::

---

## 6. Dynamic SQL — and SQL injection

```sql
CREATE FUNCTION count_rows(p_table text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
    -- ✅ format() with the right placeholders
    EXECUTE format('SELECT count(*) FROM %I', p_table) INTO n;
    RETURN n;
END $$;
```

| `format()` spec | Use for | Produces |
| :--- | :--- | :--- |
| `%I` | **Identifiers** (table/column names) | Quoted and escaped: `"my table"` |
| `%L` | **Literals** (values) | Quoted and escaped: `'O''Brien'` |
| `%s` | Raw string — **never for user input** | As-is |

```sql
-- ❌ INJECTABLE
EXECUTE 'SELECT * FROM t WHERE name = ''' || p_name || '''';

-- ✅ Parameterised — best, when the value is a value
EXECUTE 'SELECT * FROM t WHERE name = $1' USING p_name;

-- ✅ format with %L when you must interpolate
EXECUTE format('SELECT * FROM t WHERE name = %L', p_name);
```

**Use `USING` for values wherever possible** — it parameterises properly, so the plan can be cached and no escaping is involved. Reserve `format('%I')` for identifiers, which cannot be parameterised.

---

## 7. `SECURITY DEFINER` — powerful and dangerous

```sql
CREATE FUNCTION audit_log_read() RETURNS SETOF audit_log
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public     -- ← NOT OPTIONAL
STABLE
AS $$ SELECT * FROM audit_log $$;

REVOKE EXECUTE ON FUNCTION audit_log_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_log_read() TO analyst;
```

`SECURITY DEFINER` runs with the **function owner's** privileges — the mechanism for controlled privilege escalation, like letting an unprivileged role read one table through a vetted interface.

:::danger[Two rules, both mandatory]
1. **Always `SET search_path`.** Otherwise a caller can create their own `public.lower()` or a table shadowing yours, and your privileged function executes their code as the owner.
2. **Always `REVOKE EXECUTE ... FROM PUBLIC`** and grant explicitly. Functions are executable by `PUBLIC` by default.
:::

---

## 8. Performance notes

- **Plan caching:** PL/pgSQL caches the plan for each SQL statement inside a function. After 5 executions it may switch to a **generic plan** (parameter-independent), which can be much worse for skewed data. Control it with `SET plan_cache_mode = 'force_custom_plan'` (or `'auto'`, the default).
- **`LANGUAGE sql` inlining**: a simple SQL function is merged into the calling query; a plpgsql function never is.
- **Row-by-row loops**: a `FOR rec IN SELECT ... LOOP UPDATE ... END LOOP` is orders of magnitude slower than one set-based `UPDATE ... FROM`. Write set-based SQL; loop only when you genuinely can't.
- **`RETURN NEXT`** materialises the whole result. Prefer `RETURN QUERY` or a SQL function.
- **`STRICT`** (`RETURNS NULL ON NULL INPUT`) lets the planner skip the call entirely when any argument is NULL.

```sql
CREATE FUNCTION safe_div(a numeric, b numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT CASE WHEN b = 0 THEN NULL ELSE a / b END $$;
```

---

## 9. Rapid-fire recall

<details>
<summary>**What do `IMMUTABLE`, `STABLE` and `VOLATILE` mean?**</summary>

`IMMUTABLE` promises the same output for the same inputs forever and that the function doesn't read the database, so the planner can pre-evaluate it and you can use it in expression indexes and generated columns. `STABLE` promises consistency within a single statement and allows reading the database — `now()` is the canonical example, which is why a `created_at > now() - interval '1 day'` predicate can still use an index. `VOLATILE` is the default and means anything goes, so it's re-evaluated for every row and can never appear in an index. Postgres doesn't verify these — mislabelling a function `IMMUTABLE` produces an index that is silently, permanently wrong.
</details>

<details>
<summary>**`LANGUAGE sql` or `LANGUAGE plpgsql`?**</summary>

SQL whenever there's no control flow, because a simple SQL function can be **inlined** into the calling query — the planner sees through it and can push predicates down. A plpgsql function is opaque, so `SELECT * FROM my_fn() WHERE id = 5` executes the whole function and filters afterwards. Reach for plpgsql only when you need loops, conditionals, exception handling or dynamic SQL.
</details>

<details>
<summary>**Function or procedure?**</summary>

The distinguishing feature is transaction control: a procedure, called with `CALL`, can `COMMIT` and `ROLLBACK` inside itself, whereas a function always runs within the caller's transaction. So a function is for computation you want to use inside a query — and Postgres functions can return sets usable directly in a `FROM` clause — while a procedure is for batch and maintenance work that needs to commit in chunks, like deleting ten million rows ten thousand at a time.
</details>

<details>
<summary>**How do you write safe dynamic SQL?**</summary>

Use `EXECUTE ... USING` for values, which parameterises them properly with no escaping and lets the plan be cached. Values that genuinely have to be interpolated go through `format('%L', val)`, and identifiers — which can't be parameterised — go through `format('%I', name)`, which quotes and escapes them. Never concatenate user input into the string, and never use `%s` for anything that came from outside.
</details>

<details>
<summary>**What's `SECURITY DEFINER` and what's the risk?**</summary>

It makes the function run with the owner's privileges instead of the caller's, which is how you give a low-privileged role controlled access to something it can't touch directly. The risk is `search_path` hijacking: if the function calls an unqualified name, a caller can create their own object earlier in the search path and have it executed with the owner's privileges. So you must always pin `SET search_path = pg_catalog, public` on the function, and you should `REVOKE EXECUTE ... FROM PUBLIC` and grant explicitly, because functions are world-executable by default.
</details>

<details>
<summary>**Why is an `EXCEPTION` block expensive?**</summary>

Because entering a block with an exception handler starts an internal subtransaction — effectively a savepoint — on every execution, so it isn't free in a hot loop. Worse, accumulating a lot of subtransactions in one transaction can push you past the 64-slot cache and cause `SubtransSLRU` contention that degrades the whole cluster. So handle the errors you can actually act on, rather than wrapping every statement defensively.
</details>

<details>
<summary>**What can Postgres do here that MySQL can't?**</summary>

Function overloading, default and named parameters, several procedural languages including Python and JavaScript via extensions, and — the one that matters day to day — set-returning functions with `RETURNS TABLE` that you can query directly in a `FROM` clause, which gives you parameterised composable views. Plus volatility classification, which is a genuine planner optimisation with no MySQL equivalent, and functions usable in expression indexes, generated columns and check constraints.
</details>

---

**Next:** [Triggers & Extensions →](./19-triggers-and-extensions.md)
