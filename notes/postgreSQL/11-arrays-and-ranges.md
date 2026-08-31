---
title: Arrays, Ranges & Composite Types
---

# Arrays, Ranges & Composite Types

> **What you will be able to do after this page**
>
> - Use array operators and functions fluently, and index them with GIN.
> - Know when an array column is good modelling and when it's a junction table in disguise.
> - Use range types and exclusion constraints to make overlapping bookings impossible.
> - Understand composite types, `ROW()` comparison, and `unnest ... WITH ORDINALITY`.

None of this exists in MySQL. That makes it high-value interview material — but also something to use with judgement rather than enthusiasm.

---

## 1. Arrays

```sql
CREATE TABLE posts (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title   text NOT NULL,
  tags    text[] NOT NULL DEFAULT '{}',
  scores  int[]
);

INSERT INTO posts (title, tags, scores) VALUES
  ('Indexing deep dive', ARRAY['postgres','indexes','perf'], ARRAY[9,8,10]),
  ('MySQL migration',    '{mysql,postgres}',                 '{7,7}'),
  ('Hello world',        '{}',                               NULL);
```

Two literal forms: `ARRAY['a','b']` (typed, clearer) and `'{a,b}'` (string literal, needed in `COPY` and defaults).

### Access and slicing — **1-indexed**

```sql
SELECT tags[1]        FROM posts;   -- first element (NOT tags[0])
SELECT tags[2:3]      FROM posts;   -- slice, inclusive both ends
SELECT tags[1:1]      FROM posts;   -- a one-element ARRAY, not a scalar
SELECT array_length(tags, 1) FROM posts;   -- 1 = first dimension
SELECT cardinality(tags)     FROM posts;   -- total elements, all dimensions
```

```text
tags = {postgres, indexes, perf}
        └─ [1] ──┴─ [2] ──┴─ [3]

tags[1]   → 'postgres'      (text)
tags[2:3] → {indexes,perf}  (text[])
tags[9]   → NULL            ← out of bounds is NULL, not an error
```

:::warning[`array_length` on an empty array returns NULL, not 0]
```sql
SELECT array_length('{}'::text[], 1);   -- NULL
SELECT cardinality('{}'::text[]);       -- 0   ← use this
SELECT coalesce(array_length(t,1), 0);  -- or this
```
`cardinality()` is the safer function. This catches people in `HAVING` clauses and `CASE` expressions constantly.
:::

### Operators

| Operator | Meaning | Example → result |
| :--- | :--- | :--- |
| `@>` | contains | `'{a,b,c}' @> '{a,c}'` → true |
| `<@` | is contained by | `'{a}' <@ '{a,b}'` → true |
| `&&` | overlaps | `'{a,b}' && '{b,z}'` → true |
| `\|\|` | concatenate | `'{a}' \|\| '{b}'` → `{a,b}` |
| `=` | element-wise equality, **order matters** | `'{a,b}' = '{b,a}'` → **false** |
| `= ANY(arr)` | scalar membership | `'a' = ANY('{a,b}')` → true |
| `<> ALL(arr)` | scalar non-membership | |

```sql
-- "posts tagged postgres"  — three ways, all correct
SELECT * FROM posts WHERE tags @> ARRAY['postgres'];     -- ← GIN-indexable ✅
SELECT * FROM posts WHERE 'postgres' = ANY(tags);        -- ← NOT GIN-indexable ❌
SELECT * FROM posts WHERE tags && ARRAY['postgres'];     -- ← GIN-indexable ✅

-- "posts tagged postgres AND indexes"
SELECT * FROM posts WHERE tags @> ARRAY['postgres','indexes'];

-- "posts tagged postgres OR mysql"
SELECT * FROM posts WHERE tags && ARRAY['postgres','mysql'];
```

:::tip[`@>` not `= ANY` — this is the performance answer]
`'x' = ANY(tags)` reads naturally but **cannot use a GIN index**; it's evaluated per row. `tags @> ARRAY['x']` means the same thing and *is* indexable. Same for `&&` as the OR case. Remembering that one substitution is most of the practical value of array indexing.
:::

### Indexing

```sql
CREATE INDEX idx_posts_tags ON posts USING GIN (tags);
```

GIN stores one index entry per **distinct element**, each pointing to a posting list of rows. That's why containment and overlap are fast:

```text
GIN index on tags
 element     → rows
 ──────────────────────
 'indexes'   → [1]
 'mysql'     → [2]
 'perf'      → [1]
 'postgres'  → [1, 2]

query: tags @> ARRAY['postgres','indexes']
  → look up 'postgres' → [1,2]
  → look up 'indexes'  → [1]
  → INTERSECT          → [1]     ← only row 1 is fetched from the heap
```

### Functions worth knowing

```sql
SELECT unnest(tags) FROM posts;                                  -- array → rows
SELECT * FROM unnest(ARRAY['a','b','c']) WITH ORDINALITY AS t(tag, pos);
SELECT array_agg(x ORDER BY x) FROM ...;                         -- rows → array
SELECT array_to_string(tags, ', ');
SELECT string_to_array('a,b,c', ',');
SELECT array_position(tags, 'perf');                             -- 3
SELECT array_remove(tags, 'perf'), array_append(tags,'new'), array_prepend('new',tags);
SELECT array_cat(a, b);
SELECT ARRAY(SELECT id FROM orders WHERE customer_id = 1);       -- subquery → array
SELECT array_replace(tags, 'old', 'new');
```

`WITH ORDINALITY` preserves position, which matters whenever order is meaningful:

```text
unnest(ARRAY['a','b','c']) WITH ORDINALITY

 tag │ pos
─────┼─────
  a  │  1
  b  │  2
  c  │  3
```

### Array ↔ rows round trip

```sql
-- add a tag, idempotently
UPDATE posts SET tags = tags || 'newtag'
WHERE id = 1 AND NOT (tags @> ARRAY['newtag']);

-- remove a tag
UPDATE posts SET tags = array_remove(tags, 'perf') WHERE id = 1;

-- sort and deduplicate
UPDATE posts SET tags = (SELECT array_agg(DISTINCT t ORDER BY t) FROM unnest(tags) t)
WHERE id = 1;

-- global tag counts
SELECT tag, count(*) FROM posts, unnest(tags) AS tag GROUP BY tag ORDER BY 2 DESC;
```

### When arrays are the wrong tool

| Array is fine | Use a junction table |
| :--- | :--- |
| Small, bounded set (tags, roles, flags) | Elements need their own attributes (added_at, added_by) |
| Read far more than written | Elements are updated individually at high frequency |
| No referential integrity needed | Elements reference another table — you want a foreign key |
| You never join on elements | You need to join, aggregate, or paginate the elements |
| Order is meaningful and cheap to keep | Cardinality is large or unbounded |

**Arrays cannot have foreign keys.** There is no way to say "every element of `tags` must exist in the `tags` table." If you need that, you need a junction table. That single fact settles most arguments.

:::info[PostgreSQL vs MySQL]
MySQL has no array type. The equivalents are a JSON array — indexable only via a **multi-valued index** on a generated column (8.0.17+), which does support `MEMBER OF` and `JSON_OVERLAPS` — or a junction table. A comma-separated `VARCHAR` with `FIND_IN_SET` is common in old MySQL codebases and is unindexable.

Postgres arrays are typed, GIN-indexable, and have a proper operator algebra. But this is a place to be honest in an interview: **an array column is denormalisation.** The right answer to "would you use an array?" is "for tag-like sets, yes, and here's exactly when I wouldn't."
:::

---

## 2. Range types

```sql
CREATE TABLE bookings (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id int NOT NULL,
  during  tstzrange NOT NULL,
  guest   text NOT NULL
);
```

Built-in: `int4range`, `int8range`, `numrange`, `tsrange`, `tstzrange`, `daterange`. Multiranges (a set of disjoint ranges) since PG 14: `tstzmultirange`, etc.

### Bounds

```text
'[1,10)'   inclusive lower, exclusive upper   ← the DEFAULT and what you almost always want
'[1,10]'   both inclusive
'(1,10)'   both exclusive
'[1,)'     unbounded upper  (infinity)
'empty'    the empty range
```

```sql
SELECT lower('[1,10)'::int4range), upper('[1,10)'::int4range);  -- 1, 10
SELECT isempty('[5,5)'::int4range);                             -- true
SELECT lower_inc('[1,10)'::int4range), upper_inc('[1,10)'::int4range); -- true, false
```

Discrete ranges are **canonicalised**: `int4range '[1,10]'` normalises to `'[1,11)'`. Continuous ranges (`numrange`, `tstzrange`) are not.

### Operators

| Operator | Meaning |
| :--- | :--- |
| `@>` | contains a value or a range |
| `<@` | is contained by |
| `&&` | **overlaps** — the important one |
| `<<` / `>>` | strictly left of / right of |
| `-\|-` | is adjacent to |
| `+` `*` `-` | union, intersection, difference |

```sql
SELECT '[1,10)'::int4range @> 5;                              -- true
SELECT '[1,10)'::int4range && '[9,20)'::int4range;            -- true (they overlap at 9)
SELECT '[1,10)'::int4range -|- '[10,20)'::int4range;          -- true (adjacent, no gap)
SELECT '[1,10)'::int4range * '[5,20)'::int4range;             -- [5,10)
SELECT tstzrange(now(), now() + interval '2 hours') @> now(); -- true
```

### The killer feature — exclusion constraints

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- needed to mix = on a scalar with && on a range

ALTER TABLE bookings
  ADD CONSTRAINT no_double_booking
  EXCLUDE USING GIST (room_id WITH =, during WITH &&);
```

Read it as: **"no two rows may have the same `room_id` AND overlapping `during`."**

```sql
INSERT INTO bookings (room_id, during, guest)
VALUES (1, '[2026-09-01 10:00, 2026-09-01 12:00)', 'Asha');   -- ✅

INSERT INTO bookings (room_id, during, guest)
VALUES (1, '[2026-09-01 11:00, 2026-09-01 13:00)', 'Ravi');
-- ERROR: conflicting key value violates exclusion constraint "no_double_booking"

INSERT INTO bookings (room_id, during, guest)
VALUES (1, '[2026-09-01 12:00, 2026-09-01 14:00)', 'Ravi');   -- ✅ [12:00 is EXCLUSIVE on the first booking
```

```text
Timeline for room 1:

 10:00      11:00      12:00      13:00      14:00
   ├──────────────────────┤                          Asha  [10:00, 12:00)
              ├──────────────────────┤               Ravi  [11:00, 13:00)  ✗ OVERLAP → rejected
                          ├──────────────────────┤   Ravi  [12:00, 14:00)  ✓ touches but doesn't overlap

 The half-open interval [a, b) is why 12:00 belongs to exactly one booking.
 With '[a,b]' both bookings would claim 12:00 and the second insert would fail.
```

:::tip[Why this matters more than it looks]
The application-level version of this check is:
```text
1. SELECT ... WHERE room_id = 1 AND ranges overlap
2. if none found, INSERT
```
Two concurrent requests can both pass step 1 before either reaches step 2 — a classic time-of-check-to-time-of-use race. Fixing it needs `SERIALIZABLE` isolation or explicit advisory/row locking. **The exclusion constraint makes the race structurally impossible**, enforced by the same index that answers the query.

There is no MySQL equivalent. This is one of the strongest "why Postgres" examples that isn't a matter of taste.
:::

### Other range uses

```sql
-- temporal / slowly-changing dimensions
CREATE TABLE prices (
  product_id int,
  price numeric,
  valid  daterange,
  EXCLUDE USING GIST (product_id WITH =, valid WITH &&)
);
SELECT price FROM prices WHERE product_id = 7 AND valid @> current_date;

-- IP allocation, version ranges, salary bands
SELECT * FROM salary_bands WHERE band @> 75000;
```

Index ranges with GiST:

```sql
CREATE INDEX ON bookings USING GIST (during);
```

An exclusion constraint creates this index for you.

---

## 3. Composite types

```sql
CREATE TYPE address AS (line1 text, city text, pincode text);

CREATE TABLE customers (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name    text,
  home    address,
  work    address
);

INSERT INTO customers (name, home) VALUES
  ('Asha', ROW('12 MG Rd', 'Bengaluru', '560001'));

SELECT (home).city FROM customers;              -- parentheses required
SELECT * FROM customers WHERE (home).pincode = '560001';
UPDATE customers SET home.city = 'Pune' WHERE id = 1;
```

Every table also **has** a composite type of the same name:

```sql
SELECT c FROM customers c;               -- one column holding the whole row
SELECT to_jsonb(c) FROM customers c;
SELECT (c).name FROM customers c;
```

### `ROW()` comparison — genuinely useful

```sql
-- Row-wise comparison compares left-to-right, like a tuple
SELECT (1, 'b') < (1, 'c');                       -- true
SELECT (a, b) IS NOT DISTINCT FROM (c, d);        -- NULL-safe

-- Keyset pagination, correctly, in one predicate
SELECT * FROM orders
WHERE (placed_on, id) < ('2026-01-15', 4821)      -- ← reads far better than the OR-expansion
ORDER BY placed_on DESC, id DESC
LIMIT 20;
```

That last one is the correct way to paginate. The naive alternative is `placed_on < x OR (placed_on = x AND id < y)`, which is the same thing but harder to read and less likely to use a composite index cleanly. Row comparison **can** use an index on `(placed_on, id)`.

:::info[PostgreSQL vs MySQL]
MySQL supports row constructor comparison too — `WHERE (a, b) < (1, 2)` is valid — and since 8.0.16 it optimises it into a proper range scan. So keyset pagination is portable. Composite **types** as user-defined column types are Postgres-only; MySQL has no `CREATE TYPE`.
:::

---

## 4. `unnest` with multiple arrays, and bulk operations

```sql
-- zip two arrays into rows (PG 9.4+)
SELECT * FROM unnest(ARRAY['a','b'], ARRAY[1,2]) AS t(letter, num);
```

```text
 letter │ num
────────┼─────
   a    │  1
   b    │  2
```

This is the idiomatic **bulk insert / bulk update from application arrays** pattern — one round trip, one parameter set, any number of rows:

```sql
INSERT INTO items (sku, qty)
SELECT * FROM unnest($1::text[], $2::int[]);

UPDATE items i
SET qty = u.qty
FROM unnest($1::text[], $2::int[]) AS u(sku, qty)
WHERE i.sku = u.sku;
```

Far better than generating `VALUES (?,?),(?,?),...` with a different SQL text per batch size — one plan, cached, for every batch. **No MySQL equivalent**, because there's no array type to pass.

---

## 5. Rapid-fire recall

<details>
<summary>**When would you use an array column?**</summary>

For a small, bounded, read-mostly set of scalars with no attributes of their own and no referential integrity requirement — tags on a post is the canonical case. It saves a join and GIN-indexes well. I'd switch to a junction table the moment the elements need their own columns, need a foreign key to another table, are updated individually at high frequency, or grow unbounded. The decisive fact is that array elements can't have foreign keys, so if referential integrity matters the answer is a table.
</details>

<details>
<summary>**How do you index an array, and what's the query gotcha?**</summary>

`CREATE INDEX ... USING GIN (tags)`. The gotcha is that the natural-reading `'x' = ANY(tags)` cannot use that index — it's evaluated row by row. You have to write `tags @> ARRAY['x']` for AND-style containment or `tags && ARRAY['x','y']` for OR-style overlap, both of which are indexable. Same meaning, completely different performance.
</details>

<details>
<summary>**`array_length` vs `cardinality`?**</summary>

`array_length(a, 1)` returns NULL for an empty array rather than 0, which propagates NULL through any arithmetic or comparison you do with it. `cardinality(a)` returns the total number of elements across all dimensions and gives 0 for an empty array. Use `cardinality`, or wrap `array_length` in `coalesce`.
</details>

<details>
<summary>**Explain range types and exclusion constraints.**</summary>

A range type stores an interval as a single value with inclusive or exclusive bounds — `tstzrange`, `daterange`, `int4range` — with operators for containment, overlap and adjacency. An exclusion constraint generalises uniqueness: instead of "no two rows are equal on these columns," it says "no two rows satisfy these operators pairwise." So `EXCLUDE USING GIST (room_id WITH =, during WITH &&)` means no two bookings can share a room and overlap in time. That's enforced by the index at write time, which eliminates the check-then-insert race that the application-level version has. MySQL has nothing equivalent.
</details>

<details>
<summary>**Why do range bounds default to `[inclusive, exclusive)`?**</summary>

Because half-open intervals tile without gaps or overlaps. A booking `[10:00, 12:00)` and the next `[12:00, 14:00)` touch exactly and neither claims 12:00 twice, so an overlap constraint accepts both. With closed intervals `[10:00, 12:00]` and `[12:00, 14:00]`, the boundary instant belongs to both and the constraint rejects a perfectly reasonable back-to-back booking. The same reasoning is why you filter dates with `>= start AND < next_day` rather than `BETWEEN`.
</details>

<details>
<summary>**What's `unnest ... WITH ORDINALITY` for?**</summary>

Expanding an array to rows while keeping each element's original position, which you'd otherwise lose because SQL result sets have no inherent order. It matters whenever the array's order is meaningful — a ranked list, an ordered set of steps — and you need to sort or join by position afterwards. `unnest` also accepts multiple arrays and zips them, which is the standard way to bulk-insert from application arrays in a single round trip with one cached plan.
</details>

---

**Next:** [Full-Text Search & Pattern Matching →](./12-full-text-search.md)
