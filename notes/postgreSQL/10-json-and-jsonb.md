---
title: JSON & JSONB
---

# JSON & JSONB

> **What you will be able to do after this page**
>
> - Explain `json` vs `jsonb` and pick correctly without hesitating.
> - Use every operator — `->`, `->>`, `#>`, `#>>`, `@>`, `?`, `@?`, `@@` — and know which are indexable.
> - Choose between `jsonb_ops` and `jsonb_path_ops` GIN indexes, and know when an expression B-tree index is better than either.
> - Shred JSON into rows with `jsonb_array_elements`, `jsonb_each` and `jsonb_to_recordset`.
> - Explain exactly why MySQL's JSON story is weaker, without exaggerating.

---

## 1. `json` vs `jsonb`

| | `json` | `jsonb` |
| :--- | :--- | :--- |
| Storage | Exact text | Decomposed binary tree |
| Preserves whitespace / key order | ✅ | ❌ (keys sorted by length then bytewise) |
| Duplicate keys | Kept, last wins on read | Deduped at write |
| Write cost | Cheaper (just validate) | Higher (parse + normalise) |
| Read/operator cost | Reparse every access | Fast |
| Indexable with GIN | ❌ | ✅ |
| Containment `@>`, existence `?` | ❌ | ✅ |
| Equality comparison | ❌ (no equality operator) | ✅ (so `DISTINCT`, `GROUP BY` work) |

```sql
SELECT '{"b":1, "a":2, "a":3}'::json;    -- {"b":1, "a":2, "a":3}   ← preserved verbatim
SELECT '{"b":1, "a":2, "a":3}'::jsonb;   -- {"a": 3, "b": 1}        ← normalised, deduped
```

**Use `jsonb`.** The only case for `json` is byte-exact round-tripping — e.g. storing a webhook body whose HMAC signature covers the exact bytes.

---

## 2. The operators

Sample row:

```sql
CREATE TABLE events (id bigserial PRIMARY KEY, payload jsonb);
INSERT INTO events (payload) VALUES ('{
  "type": "purchase",
  "user": {"id": 42, "name": "Asha", "tags": ["pro","beta"]},
  "items": [{"sku":"A1","qty":2,"price":500},{"sku":"B2","qty":1,"price":300}],
  "total": 1300,
  "meta": null
}');
```

### Extraction

| Operator | Returns | Example | Result |
| :--- | :--- | :--- | :--- |
| `->` (text key) | `jsonb` | `payload -> 'user'` | `{"id":42,...}` |
| `->>` (text key) | `text` | `payload ->> 'total'` | `'1300'` |
| `->` (int) | `jsonb` | `payload -> 'items' -> 0` | `{"sku":"A1",...}` |
| `->>` (int) | `text` | `payload -> 'items' ->> 0` | `'{"sku": "A1", ...}'` |
| `#>` | `jsonb` | `payload #> '{user,name}'` | `"Asha"` (with quotes) |
| `#>>` | `text` | `payload #>> '{user,name}'` | `Asha` (no quotes) |

:::danger[The `->` vs `->>` mistake everyone makes once]
```sql
SELECT payload -> 'user' ->> 'name' FROM events;   -- ✅ 'Asha'
SELECT payload ->> 'user' -> 'name' FROM events;   -- ❌ ERROR: operator does not exist: text -> unknown
```
`->>` **ends the chain** — it returns `text`, which has no JSON operators. Use `->` for every step except the last.

And the silent version: `WHERE payload -> 'total' = 1300` fails (jsonb vs integer), while `WHERE payload ->> 'total' = '1300'` works but is a **string** comparison — `'900' > '1300'` is true lexically. Cast: `(payload ->> 'total')::numeric > 1000`.
:::

### Containment and existence — the indexable ones

| Operator | Meaning | Example |
| :--- | :--- | :--- |
| `@>` | Left contains right | `payload @> '{"type":"purchase"}'` |
| `<@` | Left is contained by right | |
| `?` | Does the **top-level key** (or array string element) exist | `payload ? 'total'` |
| `?\|` | Any of these keys exist | `payload ?\| array['a','b']` |
| `?&` | All of these keys exist | `payload ?& array['type','total']` |
| `@?` | Does a jsonpath match | `payload @? '$.items[*] ? (@.qty > 1)'` |
| `@@` | Does a jsonpath predicate return true | `payload @@ '$.total > 1000'` |

```sql
-- containment is structural and RECURSIVE into nested objects
SELECT * FROM events WHERE payload @> '{"user": {"id": 42}}';       -- ✅ matches
SELECT * FROM events WHERE payload @> '{"items": [{"sku":"B2"}]}';  -- ✅ matches (array containment)
SELECT * FROM events WHERE payload ? 'user';                        -- ✅ top-level key exists
SELECT * FROM events WHERE payload -> 'user' -> 'tags' ? 'beta';    -- ✅ array element exists
```

:::warning[`?` only looks at the TOP level]
`payload ? 'name'` is **false** even though `payload -> 'user' -> 'name'` exists — `?` is not recursive. Containment `@>` *is* recursive. Mixing these up produces silently empty result sets.
:::

### Modification

```sql
SELECT payload || '{"processed": true}'::jsonb;             -- merge (SHALLOW, top level only)
SELECT payload - 'meta';                                    -- delete key
SELECT payload - '{meta,total}'::text[];                    -- delete several keys
SELECT payload #- '{user,tags,0}';                          -- delete at a path
SELECT jsonb_set(payload, '{user,name}', '"Ravi"');         -- set at a path
SELECT jsonb_set(payload, '{user,age}', '30', true);        -- create_missing = true
SELECT jsonb_insert(payload, '{user,tags,0}', '"new"');     -- insert into an array
SELECT jsonb_strip_nulls(payload);
SELECT jsonb_pretty(payload);
```

:::warning[`jsonb_set` returns NULL if any argument is NULL]
```sql
UPDATE events SET payload = jsonb_set(payload, '{a}', to_jsonb($1::text));
-- If $1 is NULL, to_jsonb(NULL) is SQL NULL → jsonb_set returns NULL → the whole payload is wiped.
```
Guard with `coalesce(payload, '{}'::jsonb)` and `coalesce(to_jsonb($1), 'null'::jsonb)`. Note the distinction between **SQL NULL** and **JSON `null`** — they are different things, and `jsonb_set` treats them very differently.
:::

Also: `||` merges only at the **top level**. `'{"a":{"x":1}}' || '{"a":{"y":2}}'` gives `{"a":{"y":2}}`, not a deep merge. For deep merge you write a recursive function or do it in the application.

### Building JSON

```sql
SELECT jsonb_build_object('id', id, 'name', name, 'city', city) FROM customers;
SELECT jsonb_build_array(1, 'two', true, null);
SELECT to_jsonb(c) FROM customers c;                     -- whole row → jsonb
SELECT row_to_json(c) FROM customers c;
SELECT jsonb_agg(jsonb_build_object('id', id)) FROM customers;
SELECT jsonb_object_agg(region, revenue) FROM regional;

-- The "return the whole API response in one query" pattern
SELECT jsonb_build_object(
  'customer', to_jsonb(c) - 'password_hash',
  'orders', (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.placed_on DESC), '[]'::jsonb)
             FROM orders o WHERE o.customer_id = c.id)
) AS response
FROM customers c WHERE c.id = 42;
```

That last pattern — assembling the entire nested API response in the database and returning one row, one column — eliminates N+1 queries and the ORM serialisation layer entirely. It's one of the most practically valuable Postgres techniques there is.

---

## 3. Shredding JSON into rows

```sql
SELECT jsonb_array_elements(payload -> 'items') AS item FROM events;
```

```text
INPUT (1 row):
  payload.items = [ {"sku":"A1","qty":2,"price":500}, {"sku":"B2","qty":1,"price":300} ]

OUTPUT (2 rows):
  item
  ─────────────────────────────────
  {"sku":"A1","qty":2,"price":500}
  {"sku":"B2","qty":1,"price":300}
```

Then project fields out of it:

```sql
SELECT e.id,
       item ->> 'sku'            AS sku,
       (item ->> 'qty')::int     AS qty,
       (item ->> 'price')::numeric AS price
FROM events e,
     LATERAL jsonb_array_elements(e.payload -> 'items') AS item;
```

```text
 id │ sku │ qty │ price
────┼─────┼─────┼───────
  1 │ A1  │  2  │  500
  1 │ B2  │  1  │  300

1 event row → 2 output rows.  This is exactly MongoDB's $unwind.
```

Better still, typed in one step:

```sql
SELECT e.id, i.*
FROM events e,
     LATERAL jsonb_to_recordset(e.payload -> 'items')
       AS i(sku text, qty int, price numeric);
```

The full shredding toolkit:

| Function | Produces |
| :--- | :--- |
| `jsonb_array_elements(j)` | One `jsonb` row per array element |
| `jsonb_array_elements_text(j)` | Same, as `text` |
| `jsonb_each(j)` | `(key, value jsonb)` rows for an object |
| `jsonb_each_text(j)` | `(key, value text)` |
| `jsonb_object_keys(j)` | Just the keys |
| `jsonb_to_record(j)` | One row, typed — needs an `AS (...)` list |
| `jsonb_to_recordset(j)` | Many rows, typed |
| `jsonb_path_query(j, path)` | Rows matching a jsonpath |
| `jsonb_array_length(j)` | Integer |
| `jsonb_typeof(j)` | `'object'`, `'array'`, `'string'`, `'number'`, `'boolean'`, `'null'` |

:::warning[Aggregating over an unnested array double-counts the parent]
Same trap as any one-to-many join: after `jsonb_array_elements` an event with 3 items appears 3 times, so `sum(payload ->> 'total')` triples. Aggregate the items, then join back — or use a scalar subquery.
:::

---

## 4. jsonpath (SQL/JSON, PG 12+)

```sql
SELECT jsonb_path_query(payload, '$.items[*].sku') FROM events;
SELECT jsonb_path_query_array(payload, '$.items[*] ? (@.qty > 1)') FROM events;
SELECT payload @? '$.items[*] ? (@.price > 400)' FROM events;      -- boolean: does it match?
SELECT payload @@ '$.total > 1000' FROM events;                    -- boolean: predicate result
SELECT jsonb_path_query_first(payload, '$.user.name');
SELECT jsonb_path_exists(payload, '$.user.tags[*] ? (@ == "pro")');
```

Syntax: `$` root, `@` current element in a filter, `[*]` all array elements, `? (...)` filter, `.**` recursive descent, plus methods like `.type()`, `.size()`, `.double()`.

`@?` and `@@` **are GIN-indexable** with `jsonb_ops` (and, for a useful subset, `jsonb_path_ops`), which is what makes jsonpath practical rather than just expressive.

---

## 5. Indexing JSONB

### GIN, default (`jsonb_ops`)

```sql
CREATE INDEX idx_events_payload ON events USING GIN (payload);
```

Indexes **every key and every value** at every nesting level. Supports `@>`, `?`, `?|`, `?&`, `@?`, `@@`. Large index (often bigger than the data), slower to build and update.

### GIN with `jsonb_path_ops`

```sql
CREATE INDEX idx_events_payload_path ON events USING GIN (payload jsonb_path_ops);
```

Indexes only **hashes of complete paths-to-values**. Roughly **2–3× smaller and faster**, but supports only `@>` (and `@?`/`@@`) — **not** the `?` key-existence operators.

:::tip[Which GIN opclass?]
If your queries are all `payload @> '{...}'` containment — which most are — use **`jsonb_path_ops`**. Use the default `jsonb_ops` only when you genuinely need key-existence (`?`) queries.
:::

### B-tree on an expression — often the best option

```sql
CREATE INDEX idx_events_type ON events ((payload ->> 'type'));
CREATE INDEX idx_events_uid  ON events (((payload -> 'user' ->> 'id')::bigint));
```

```sql
SELECT * FROM events WHERE payload ->> 'type' = 'purchase';   -- uses idx_events_type
```

**A B-tree expression index is smaller and faster than GIN for a single known key**, and — crucially — it supports **range queries and ordering**, which GIN cannot do at all. If you always filter on `payload ->> 'type'`, don't build a GIN index on the whole document.

### Partial + expression, for the surgical case

```sql
CREATE INDEX idx_events_purchase_total
  ON events (((payload ->> 'total')::numeric))
  WHERE payload ->> 'type' = 'purchase';
```

### Decision table

| Query shape | Index |
| :--- | :--- |
| `payload @> '{"type":"x"}'`, varied keys | GIN `jsonb_path_ops` |
| `payload ? 'key'` | GIN `jsonb_ops` |
| `payload ->> 'type' = 'x'` (one known key) | B-tree expression index |
| `(payload ->> 'total')::numeric > 1000` | B-tree expression index (GIN can't do ranges) |
| `ORDER BY payload ->> 'created'` | B-tree expression index |
| Rare, high-value subset | Partial expression index |
| Column is queried in every possible way | It shouldn't be JSONB — promote to real columns |

---

## 6. When *not* to use JSONB

JSONB is for genuinely variable structure. It is **not** a way to avoid designing a schema.

| Use JSONB | Use real columns |
| :--- | :--- |
| Third-party webhook payloads | Anything you filter or join on constantly |
| Per-tenant custom fields | Anything with a foreign key relationship |
| Sparse attributes across product categories | Anything needing a `NOT NULL` or `CHECK` guarantee |
| Audit snapshots, event bodies | Anything the planner needs good statistics on |
| API request/response logs | Money, dates, ids |

The costs you accept: no per-key statistics so row estimates are poor (Postgres falls back to fixed selectivity guesses for `@>`), no referential integrity, no NOT NULL per key, larger storage, and **TOAST decompression on every access to a large document**.

:::tip[The hybrid pattern — this is the right answer in practice]
Promote hot keys to real columns (as generated columns, so they stay in sync automatically) and keep the rest in JSONB:

```sql
ALTER TABLE events
  ADD COLUMN event_type text GENERATED ALWAYS AS (payload ->> 'type') STORED,
  ADD COLUMN user_id bigint GENERATED ALWAYS AS ((payload -> 'user' ->> 'id')::bigint) STORED;
CREATE INDEX ON events (event_type, user_id);
```
You get real statistics, real indexes, real constraints on the hot path, and flexibility for the rest.
:::

---

## 7. PostgreSQL vs MySQL — JSON, honestly

:::info[PostgreSQL vs MySQL]
| | PostgreSQL | MySQL 8 |
| :--- | :--- | :--- |
| Types | `json` (text) + `jsonb` (binary) | One `JSON` type (binary, comparable to `jsonb`) |
| **Direct index on the column** | ✅ `CREATE INDEX ... USING GIN (payload)` | ❌ **Not possible.** Must create a generated column and index it, or a multi-valued index on an array path |
| Ad-hoc containment query | `payload @> '{"type":"x"}'` uses the GIN index | `JSON_CONTAINS(payload, ...)` — **always a full scan** unless a generated column exists for that exact path |
| Extraction | `->`, `->>`, `#>`, `#>>` | `->`, `->>` (same spelling, same meaning), `JSON_EXTRACT`, `JSON_UNQUOTE` |
| Path language | SQL/JSON jsonpath, `@?`, `@@`, `jsonb_path_query` | MySQL path syntax `'$.a.b[0]'`, `JSON_SEARCH`, no filter expressions until limited support |
| Shredding to rows | `jsonb_array_elements`, `jsonb_to_recordset`, `jsonb_each` | `JSON_TABLE` — genuinely good, arguably nicer syntax |
| Modification | `jsonb_set`, `\|\|`, `-`, `#-` | `JSON_SET`, `JSON_MERGE_PATCH` (**does deep merge**, which Postgres's `\|\|` doesn't), `JSON_REMOVE` |
| Partial in-place update | Rewrites the whole value | **Partial updates** for `JSON_SET`/`JSON_REPLACE`/`JSON_REMOVE` when the value shrinks or stays same size — a real write-amplification win |
| Aggregation | `jsonb_agg`, `jsonb_object_agg` | `JSON_ARRAYAGG`, `JSON_OBJECTAGG` |
| Schema validation | `CHECK` + jsonpath, or the `pg_jsonschema` extension | `JSON_SCHEMA_VALID()` **built in** |

**Where MySQL is genuinely better:** `JSON_TABLE` is a nicer shredding API, `JSON_MERGE_PATCH` does deep merge natively, in-place partial updates avoid rewriting the whole document, and `JSON_SCHEMA_VALID()` is built in.

**Where PostgreSQL is decisively better:** you can index the JSON column itself and run ad-hoc containment queries against unknown keys with index support. On MySQL, every indexed JSON access path must be decided in advance and materialised as a generated column. For "we don't know which keys we'll query," that's the whole ballgame.
:::

---

## 8. Rapid-fire recall

<details>
<summary>**`json` or `jsonb`?**</summary>

`jsonb` almost always. It parses once at write time into a binary form, so reads are fast, it supports containment and existence operators, and — the decisive point — it can be GIN-indexed. `json` stores the exact input text, reparses on every access, can't be indexed, and doesn't even have an equality operator, so you can't `GROUP BY` it. The only reason to pick `json` is byte-exact fidelity, like a payload whose signature covers the exact bytes. The trade-offs `jsonb` makes are losing key order, whitespace and duplicate keys, none of which usually matter.
</details>

<details>
<summary>**`->` vs `->>`?**</summary>

`->` returns `jsonb`, so you can keep chaining into it. `->>` returns `text`, which ends the chain — `payload ->> 'user' -> 'name'` is an error because `text` has no JSON operators. The subtler bug is comparison: `payload ->> 'total' > '900'` is a string comparison, so `'1300'` sorts before `'900'` and you get wrong answers with no error. Always cast: `(payload ->> 'total')::numeric`.
</details>

<details>
<summary>**How do you index a JSONB column?**</summary>

Three options, and the choice matters. A GIN index on the whole column supports containment `@>` and key existence `?` for arbitrary keys — use `jsonb_path_ops` if you only need containment, because it's two to three times smaller and faster. A B-tree index on an expression like `(payload ->> 'type')` is much smaller and is the only option that supports range queries and ordering, so it's better when you always filter on one known key. And a partial expression index for a small high-value subset. If I'm indexing the same key in every query, that key probably shouldn't be inside the JSON at all — I'd promote it to a generated column.
</details>

<details>
<summary>**`@>` vs `?` — what's the difference?**</summary>

`@>` is structural containment and it recurses: `payload @> '{"user":{"id":42}}'` matches nested structure at any depth on the path given, and it works on arrays too. `?` only tests whether a key exists **at the top level** of the object, so `payload ? 'name'` is false when `name` lives inside `payload.user`. Both are GIN-indexable with the default opclass, but `jsonb_path_ops` supports only `@>`.
</details>

<details>
<summary>**What's the biggest difference between Postgres and MySQL JSON?**</summary>

Indexing. Postgres lets you put a GIN index directly on a `jsonb` column, so a containment query against a key you didn't anticipate can still use an index. MySQL can't index a JSON column at all — you have to create a generated column for each path you want to query and index that, which means every access path must be decided in advance. In the other direction MySQL has some genuine advantages: `JSON_TABLE` is a nicer shredding API, `JSON_MERGE_PATCH` does deep merge which Postgres's `||` does not, `JSON_SCHEMA_VALID()` is built in, and MySQL can update a JSON document partially in place instead of rewriting the whole value.
</details>

<details>
<summary>**When should you *not* use JSONB?**</summary>

When the data has a known shape. JSONB has no per-key statistics, so the planner's row estimates for `@>` are guesses, and bad estimates produce bad join plans. It also gives you no foreign keys, no per-key `NOT NULL`, and larger storage with TOAST decompression on every access. So anything you filter on constantly, join on, or need integrity guarantees for belongs in a real column. The pragmatic answer is hybrid: promote the hot keys to `STORED` generated columns and index those, keep the genuinely variable remainder in JSONB.
</details>

<details>
<summary>**How do you turn a JSON array into rows?**</summary>

`jsonb_array_elements(payload -> 'items')` in a `LATERAL` join gives one row per element — the direct equivalent of MongoDB's `$unwind`. If the elements are objects with a known shape, `jsonb_to_recordset(...) AS t(sku text, qty int)` does the same thing and gives you typed columns in one step. The trap is the same as any one-to-many expansion: after unnesting, the parent row's own columns are repeated, so aggregating them double-counts.
</details>

---

**Next:** [Arrays, Ranges & Composite Types →](./11-arrays-and-ranges.md)
