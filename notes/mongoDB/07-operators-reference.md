---
title: Operators Reference
---

# Operators Reference

> A working reference — every operator with a **runnable example and its result**, not just a one-line description.
> Query operators (used in `find()` and `$match`) come first, then expression operators (used inside aggregation stages).

---

## Part 1 — Query Operators

These work identically in `db.c.find({ … })` and `{ $match: { … } }`.

### Comparison

| Operator | Example | Meaning |
| :--- | :--- | :--- |
| `$eq` | `{ qty: { $eq: 20 } }` | Equals — `{ qty: 20 }` is the shorthand |
| `$ne` | `{ status: { $ne: "CANCELLED" } }` | Not equal. **Also matches documents missing the field** |
| `$gt` `$gte` `$lt` `$lte` | `{ price: { $gte: 100, $lt: 500 } }` | Range. Multiple conditions on one field = AND |
| `$in` | `{ status: { $in: ["PAID", "SHIPPED"] } }` | Any of these values |
| `$nin` | `{ tier: { $nin: ["free"] } }` | None of these. Also matches missing |

:::warning[`$ne` and `$nin` match missing fields]
`{ status: { $ne: "ACTIVE" } }` returns documents with `status: "PAID"` **and** documents with no `status` field at all. If that's not what you meant, add `$exists`:
`{ status: { $exists: true, $ne: "ACTIVE" } }`.

They also can't use an index efficiently — a negation has to scan nearly everything. Prefer `$in` with an explicit allow-list when you can.
:::

### Logical

```js
// Implicit AND — the default when you list several fields
{ status: "PAID", amount: { $gt: 100 } }

// Explicit AND — needed when you have two conditions on the SAME field/operator
{ $and: [ { tags: "a" }, { tags: "b" } ] }        // has BOTH tags

// OR
{ $or: [ { status: "PAID" }, { amount: { $gt: 1000 } } ] }

// NOR — neither
{ $nor: [ { status: "PAID" }, { status: "SHIPPED" } ] }

// NOT — inverts a single operator expression
{ price: { $not: { $gt: 100 } } }                  // price ≤ 100 OR price missing
```

:::tip[`$or` and indexes]
Each branch of an `$or` is evaluated separately and the results are merged. So **every branch needs its own usable index** — if even one branch lacks one, that branch does a `COLLSCAN`. `$in` on a single field is a single index scan and is strictly better when applicable.
:::

### Element

```js
{ phone: { $exists: true } }        // field present (including explicit null)
{ phone: { $exists: false } }       // field absent
{ score: { $type: "number" } }      // any numeric BSON type
{ _id:   { $type: "objectId" } }
{ x:     { $type: ["string", "null"] } }   // any of these types
```

`$type` is the tool for auditing a collection with inconsistent data — a real task on any legacy MongoDB system:

```js
db.orders.aggregate([{ $group: { _id: { $type: "$amount" }, n: { $sum: 1 } } }]);
// → [ { _id: "double", n: 98234 }, { _id: "string", n: 17 } ]   ← found the bad rows
```

### Evaluation

| Operator | Example | Notes |
| :--- | :--- | :--- |
| `$regex` | `{ name: { $regex: "^As", $options: "i" } }` | **Only a `^`-anchored, case-sensitive** regex can use an index |
| `$expr` | `{ $expr: { $gt: ["$spent", "$budget"] } }` | Compare **two fields of the same document** |
| `$mod` | `{ qty: { $mod: [4, 0] } }` | Divisible by 4 |
| `$text` | `{ $text: { $search: "coffee shop" } }` | Requires a text index |
| `$jsonSchema` | `{ $jsonSchema: { … } }` | Also usable as a query, to find invalid docs |
| `$where` | `{ $where: "this.a > this.b" }` | Runs JS per document. **Never use** — no index, huge cost, injection risk |

`$expr` is the one to internalise. Plain query syntax can only compare a field to a *literal*; `$expr` lets you compare fields to each other:

```js
// ❌ impossible in plain query language
db.budgets.find({ spent: { $gt: "$budget" } });   // looks for the literal string "$budget"

// ✅
db.budgets.find({ $expr: { $gt: ["$spent", "$budget"] } });
```

### Array query operators

Given `{ _id: 1, scores: [70, 85, 92], items: [{ sku: "A", qty: 2 }, { sku: "B", qty: 9 }] }`:

| Operator | Example | Result |
| :--- | :--- | :--- |
| implicit | `{ scores: 85 }` | ✅ matches — "array contains" |
| `$all` | `{ scores: { $all: [70, 92] } }` | ✅ contains all of these, any order |
| `$size` | `{ scores: { $size: 3 } }` | ✅ exact length. **No range support** — `$size: {$gt: 2}` is invalid |
| `$elemMatch` | `{ scores: { $elemMatch: { $gt: 80, $lt: 90 } } }` | ✅ **one** element satisfies all conditions |
| dotted | `{ "items.qty": { $gt: 5 } }` | ✅ some element's qty > 5 |
| `$elemMatch` on objects | `{ items: { $elemMatch: { sku: "A", qty: { $gt: 5 } } } }` | ❌ — A has qty 2; no single element matches both |

:::danger[The `$elemMatch` rule — memorise it]
Without `$elemMatch`, **each condition is evaluated independently against the whole array**. `{ "items.sku": "A", "items.qty": { $gt: 5 } }` matches the document above, because element A satisfies the first and element B satisfies the second. That is almost never the intent.

With `$elemMatch`, all conditions must be satisfied by **the same element**.

Rule of thumb: two or more conditions on the same array → you need `$elemMatch`.
:::

To query for array length ranges, precompute the size or use `$expr`:

```js
{ $expr: { $gt: [{ $size: "$scores" }, 2] } }
```

### Geospatial & bitwise

`$geoWithin`, `$geoIntersects`, `$near`, `$nearSphere` (need a `2dsphere` index); `$bitsAllSet`, `$bitsAnySet`, `$bitsAllClear`, `$bitsAnyClear` for flag fields.

---

## Part 2 — Expression Operators

Used inside `$project`, `$addFields`, `$group`, `$match`+`$expr`, and every other aggregation stage.

### Arithmetic

```js
{ $add: ["$price", "$tax"] }                     // also adds a number of ms to a Date
{ $subtract: ["$end", "$start"] }                // Date − Date = milliseconds
{ $multiply: ["$qty", "$price"] }
{ $divide: ["$total", "$count"] }
{ $mod: ["$n", 2] }
{ $abs: "$delta" }
{ $ceil: "$x" }  { $floor: "$x" }  { $trunc: ["$x", 2] }
{ $round: ["$price", 2] }                        // round to 2 decimals
{ $pow: ["$base", 2] }  { $sqrt: "$x" }  { $ln: "$x" }  { $log10: "$x" }
```

### Comparison & boolean

```js
{ $eq: ["$a", "$b"] }        // note: ARRAY form, comparing two expressions
{ $ne:  ["$status", "PAID"] }
{ $gt: ["$score", 80] }      { $gte: … }  { $lt: … }  { $lte: … }
{ $cmp: ["$a", "$b"] }       // -1, 0, or 1
{ $and: [ exprA, exprB ] }   { $or: [ … ] }   { $not: [ expr ] }
```

:::warning
Query-language `$gt` takes an object: `{ score: { $gt: 80 } }`.
Expression `$gt` takes an array of two expressions: `{ $gt: ["$score", 80] }`.
Same operator name, two different syntaxes depending on context. Mixing them up is the second most common aggregation error after the missing `$`.
:::

### Conditional

```js
// $cond — ternary. Two equivalent forms:
{ $cond: { if: { $gte: ["$score", 40] }, then: "PASS", else: "FAIL" } }
{ $cond: [ { $gte: ["$score", 40] }, "PASS", "FAIL" ] }        // array shorthand

// $ifNull — coalesce. Accepts multiple fallbacks (5.0+)
{ $ifNull: ["$nickname", "$name", "Anonymous"] }

// $switch — multi-branch. First matching case wins; `default` is required
// if any document might match nothing.
{ $switch: {
    branches: [
      { case: { $gte: ["$score", 90] }, then: "A" },
      { case: { $gte: ["$score", 75] }, then: "B" },
      { case: { $gte: ["$score", 50] }, then: "C" },
    ],
    default: "F"
}}
```

The `$cond` + `$sum` combination is the aggregation equivalent of SQL's `COUNT(CASE WHEN …)` — the **pivot table idiom**:

```js
{ $group: {
    _id: "$region",
    paid:      { $sum: { $cond: [{ $eq: ["$status", "PAID"] }, 1, 0] } },
    cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
    paidValue: { $sum: { $cond: [{ $eq: ["$status", "PAID"] }, "$amount", 0] } },
}}
// → { _id: "North", paid: 120, cancelled: 8, paidValue: 240000 }
```

One pass over the data produces a full cross-tab. Learn this shape — it answers a whole family of "give me a breakdown by X and Y" interview questions.

### String

```js
{ $concat: ["$first", " ", "$last"] }             // any null arg → whole result is null
{ $toUpper: "$code" }   { $toLower: "$email" }
{ $substrCP: ["$name", 0, 3] }                    // prefer CP over $substr (Unicode-safe)
{ $strLenCP: "$name" }
{ $trim: { input: "$name" } }  { $ltrim: … }  { $rtrim: … }
{ $split: ["$fullName", " "] }                    // → ["Asha", "Rao"]
{ $indexOfCP: ["$email", "@"] }                   // -1 if not found
{ $replaceOne: { input: "$s", find: "a", replacement: "b" } }
{ $replaceAll: { input: "$phone", find: "-", replacement: "" } }
{ $regexMatch: { input: "$email", regex: /@gmail\.com$/ } }     // → boolean
{ $regexFind: { input: "$s", regex: /(\d+)/ } }                 // → match + captures
{ $regexFindAll: { input: "$s", regex: /\w+/ } }
{ $toString: "$_id" }                             // ObjectId → 24-char hex string
```

:::warning[`$concat` and nulls]
If any argument is null or missing, `$concat` returns **null** — the whole name disappears, not just the middle part. Always guard:
`{ $concat: [{ $ifNull: ["$first", ""] }, " ", { $ifNull: ["$last", ""] }] }`
:::

### Date

```js
{ $year: "$createdAt" }  { $month: … }  { $dayOfMonth: … }  { $hour: … }
{ $dayOfWeek: "$createdAt" }        // 1 = Sunday … 7 = Saturday
{ $dayOfYear: … }  { $week: … }  { $isoWeek: … }  { $isoWeekYear: … }

// Timezone-aware — MongoDB stores UTC, so always pass a timezone for reporting
{ $month: { date: "$createdAt", timezone: "Asia/Kolkata" } }

{ $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } }
{ $dateFromString: { dateString: "$dateStr", format: "%d/%m/%Y" } }

{ $dateTrunc: { date: "$createdAt", unit: "month" } }          // 5.0+ — bucket by month
{ $dateAdd: { startDate: "$createdAt", unit: "day", amount: 30 } }
{ $dateSubtract: { startDate: "$$NOW", unit: "day", amount: 7 } }
{ $dateDiff: { startDate: "$start", endDate: "$end", unit: "day" } }

{ $dateToParts: { date: "$createdAt", timezone: "Asia/Kolkata" } }
// → { year: 2026, month: 3, day: 1, hour: 15, minute: 30, second: 0, millisecond: 0 }
```

:::tip[Three ways to group by month — pick deliberately]
```js
// A) Composite _id — sorts correctly, but the client must format it
{ $group: { _id: { y: { $year: "$d" }, m: { $month: "$d" } }, … } }

// B) String key — human-readable AND lexicographically sortable
{ $group: { _id: { $dateToString: { format: "%Y-%m", date: "$d" } }, … } }

// C) $dateTrunc (5.0+) — stays a real Date, so range queries and charts work
{ $group: { _id: { $dateTrunc: { date: "$d", unit: "month" } }, … } }
```
**(C) is the best default** — the key remains a Date, so downstream sorting, `$densify`, and charting libraries all just work. `{ _id: { $month: "$d" } }` alone is a bug: it merges March 2025 with March 2026.
:::

Because all dates are UTC, a report for "March in India" must specify `timezone: "Asia/Kolkata"` — otherwise the 5.5-hour offset silently misfiles orders placed late at night into the wrong month. This is a genuine production bug and a great thing to mention unprompted.

### Array

```js
{ $size: "$tags" }
{ $arrayElemAt: ["$tags", 0] }        { $arrayElemAt: ["$tags", -1] }   // negative = from end
{ $first: "$tags" }   { $last: "$tags" }        // 4.4+, cleaner than $arrayElemAt
{ $slice: ["$tags", 3] }              { $slice: ["$tags", 2, 3] }
{ $concatArrays: ["$a", "$b"] }
{ $in: ["mongo", "$tags"] }                     // → boolean (note: NOT the query $in)
{ $indexOfArray: ["$tags", "mongo"] }
{ $reverseArray: "$tags" }
{ $sortArray: { input: "$items", sortBy: { price: -1 } } }        // 5.2+
{ $setUnion: ["$a", "$b"] }  { $setIntersection: … }  { $setDifference: … }
{ $setIsSubset: ["$a", "$b"] }  { $anyElementTrue: … }  { $allElementsTrue: … }
{ $range: [0, 10, 2] }                          // → [0,2,4,6,8]
{ $zip: { inputs: ["$a", "$b"] } }
{ $arrayToObject: "$kvPairs" }  { $objectToArray: "$doc" }
```

**The big three — `$filter`, `$map`, `$reduce`:**

```js
// $filter — keep matching elements. Array in, smaller array out.
{ $filter: { input: "$items", as: "i", cond: { $gt: ["$$i.qty", 2] } } }

// $map — transform each element. Same length out.
{ $map: { input: "$items", as: "i",
          in: { sku: "$$i.sku", withTax: { $multiply: ["$$i.price", 1.18] } } } }

// $reduce — collapse to a single value.
{ $reduce: { input: "$items", initialValue: 0,
             in: { $add: ["$$value", { $multiply: ["$$this.qty", "$$this.price"] }] } } }
```

Traced on `items: [{sku:"A", qty:1, price:100}, {sku:"B", qty:5, price:20}, {sku:"C", qty:3, price:50}]`:

```text
$filter (qty > 2)  →  [ {B,5,20}, {C,3,50} ]
$map (price×1.18)  →  [ {A,118}, {B,23.6}, {C,59} ]
$reduce (sum qty×price):
    step 0: value=0
    step 1: value = 0   + (1×100) = 100
    step 2: value = 100 + (5×20)  = 200
    step 3: value = 200 + (3×50)  = 350
                                  → 350
```

:::tip[`$filter`/`$map`/`$reduce` vs `$unwind` + `$group`]
Both can compute an order total. The array operators do it **inside one document** — no cardinality explosion, no regrouping, and they're substantially faster. `$unwind` + `$group` is only necessary when you need to *aggregate across documents* on the exploded values.

Reaching for `$unwind` when a `$reduce` would do is a common inefficiency, and spotting it is a strong interview signal.
:::

`$reduce` can also build arrays — flattening nested arrays, for example:

```js
{ $reduce: { input: "$matrix", initialValue: [], in: { $concatArrays: ["$$value", "$$this"] } } }
```

### Object

```js
{ $mergeObjects: ["$defaults", "$overrides"] }    // later wins; nulls skipped
{ $objectToArray: "$scores" }
// { math: 90, sci: 80 } → [ { k: "math", v: 90 }, { k: "sci", v: 80 } ]
{ $arrayToObject: "$kv" }                          // the inverse
{ $getField: { field: "price.usd", input: "$doc" } }   // 5.0+ — for keys containing dots
{ $setField: { field: "a.b", input: "$$ROOT", value: 1 } }
```

`$objectToArray` + `$unwind` + `$group` + `$arrayToObject` is the **dynamic pivot** idiom — how you aggregate over documents whose *keys* vary:

```js
// { _id: 1, scores: { math: 90, sci: 80 } } → average per subject across all students
[
  { $project: { kv: { $objectToArray: "$scores" } } },
  { $unwind: "$kv" },
  { $group: { _id: "$kv.k", avg: { $avg: "$kv.v" } } },
]
```

### Type conversion

```js
{ $toString: "$_id" }  { $toInt: "$s" }  { $toDouble: … }  { $toDecimal: … }
{ $toLong: … }  { $toBool: … }  { $toDate: "$millis" }  { $toObjectId: "$idStr" }
{ $type: "$field" }
{ $isNumber: "$x" }         // 4.4+
{ $isArray: "$x" }

// $convert — the safe form, with error handling
{ $convert: { input: "$amount", to: "decimal", onError: null, onNull: NumberDecimal("0") } }
```

:::tip
Bare `$toInt` **throws and kills the whole pipeline** on one bad value. In any data-cleaning pipeline over untrusted data, always use `$convert` with `onError`/`onNull` — one malformed row shouldn't fail a report over ten million.
:::

### Accumulators outside `$group`

`$sum`, `$avg`, `$min`, `$max`, `$stdDevPop` also work in `$project`/`$addFields`, where they operate on a **single array within one document**:

```js
{ $project: { best: { $max: "$scores" }, avg: { $avg: "$scores" }, total: { $sum: "$scores" } } }
```

That saves an `$unwind`/`$group` round trip for per-document array statistics.

---

## Part 3 — CRUD method cheat sheet

| Operation | Method | Returns |
| :--- | :--- | :--- |
| Read many | `find(filter, projection)` | Cursor (lazy) |
| Read one | `findOne(filter)` | Document or `null` |
| Insert | `insertOne` / `insertMany` | `insertedId(s)` |
| Update | `updateOne` / `updateMany` | `matchedCount`, `modifiedCount`, `upsertedId` |
| Update + read | `findOneAndUpdate` | The document (before or after) |
| Replace | `replaceOne` | Counts |
| Delete | `deleteOne` / `deleteMany` | `deletedCount` |
| Delete + read | `findOneAndDelete` | The deleted document |
| Mixed batch | `bulkWrite([...])` | Per-type counts |
| Count (exact) | `countDocuments(filter)` | Number |
| Count (fast) | `estimatedDocumentCount()` | Number (approximate) |
| Distinct values | `distinct("field", filter)` | Array |
| Pipeline | `aggregate([...], options)` | Cursor |

---

**Next:** [Practice Questions →](./practice-questions.md) — 32 problems, each traced stage by stage.
