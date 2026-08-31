---
title: Advanced Practice
---

# Advanced Practice — Questions 21–32

> **Focus**: `$$ROOT` preservation, `$$REMOVE`, pipeline `$lookup`, top-N-per-group, `$reduce`, `$setWindowFields`, `$unionWith`.
>
> These are the patterns that show up in senior interviews. Each one has a **trace** and a **"what the interviewer is really testing"** note.

---

## Topic: Root Preservation & Reshaping

### Question 21: Latest order per user, flattened

For every user with at least one order, return their **most recent order** enriched with the user's name and city. The output should look like a single order document, not a nested user structure.

```js
// db.users
{ _id: "u1", name: "Asha", city: "Pune"  }
{ _id: "u2", name: "Ravi", city: "Delhi" }

// db.orders
{ _id: "o1", userId: "u1", amount: 500,  createdAt: ISODate("2026-01-10") }
{ _id: "o2", userId: "u1", amount: 1200, createdAt: ISODate("2026-03-05") }   // ← latest for u1
{ _id: "o3", userId: "u2", amount: 300,  createdAt: ISODate("2026-02-20") }
```

<details>
<summary>**Solution & Trace**</summary>

```js
db.users.aggregate([
  { $lookup: { from: "orders", localField: "_id", foreignField: "userId", as: "orders" } },
  { $unwind: "$orders" },                                  // no preserve → users w/o orders drop
  { $sort: { "orders.createdAt": -1 } },
  {
    $group: {
      _id: "$_id",
      userName: { $first: "$name" },
      city:     { $first: "$city" },
      latestOrder: { $first: "$orders" },
    },
  },
  {
    $replaceRoot: {
      newRoot: { $mergeObjects: ["$latestOrder", { userName: "$userName", city: "$city" }] },
    },
  },
]);
```

**Trace:**

```text
── $lookup ──────────────────── 2 → 2 docs
  u1 Asha  orders: [o1, o2]
  u2 Ravi  orders: [o3]

── $unwind (no preserve) ────── 2 → 3 docs
  u1 Asha  orders: o1 (500,  Jan 10)
  u1 Asha  orders: o2 (1200, Mar 05)
  u2 Ravi  orders: o3 (300,  Feb 20)
  ⚠️ a user with zero orders would VANISH here — which the question wants
     ("every user with at least one order")

── $sort: orders.createdAt DESC ──  3 docs reordered
  u1 o2 (Mar 05)   ← now first within u1
  u2 o3 (Feb 20)
  u1 o1 (Jan 10)

── $group by user _id ───────── 3 → 2 docs
  u1: $first sees o2 first  → latestOrder = o2  ✓
  u2: $first sees o3        → latestOrder = o3  ✓
  { _id:"u1", userName:"Asha", city:"Pune",  latestOrder:{_id:"o2", amount:1200, …} }

── $replaceRoot + $mergeObjects ──  2 → 2 docs, promoted to top level
  { _id:"o2", userId:"u1", amount:1200, createdAt:Mar 05, userName:"Asha", city:"Pune" }
  { _id:"o3", userId:"u2", amount:300,  createdAt:Feb 20, userName:"Ravi", city:"Delhi" }
     ^^^ flat order document with user fields merged in
```

:::danger[Why the `$sort` is load-bearing]
`$first` means **"the value from whichever document reached the group first."** It has no notion of "latest" on its own. Delete the `$sort` and you get an arbitrary order per user — one that may look right on three test documents and be wrong in production. **`$sort` → `$group` + `$first` is one indivisible idiom.**
:::

**`$mergeObjects` argument order matters:** later arguments overwrite earlier ones. `["$latestOrder", { userName, city }]` lets user fields win on collision. If the order also had a `city` field and you wanted *its* value, reverse the order.

**Modern alternative (5.2+)** — `$top` sorts *within* the group and removes the global `$sort` entirely:

```js
{ $group: {
    _id: "$_id",
    userName: { $first: "$name" }, city: { $first: "$city" },
    latestOrder: { $top: { sortBy: { "orders.createdAt": -1 }, output: "$orders" } },
}}
```

**And the much faster production form** — never join all orders just to keep one:

```js
db.users.aggregate([
  { $lookup: {
      from: "orders",
      let: { uid: "$_id" },
      pipeline: [
        { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
        { $sort: { createdAt: -1 } },
        { $limit: 1 },                       // ← one document per user, not thousands
      ],
      as: "latest",
  }},
  { $unwind: "$latest" },
  { $replaceWith: { $mergeObjects: ["$latest", { userName: "$name", city: "$city" }] } },
]);
```

For a user with 10,000 orders, the first version materialises 10,000 documents and discards 9,999. This one fetches one. **That difference is the answer the interviewer is listening for.**

</details>

---

### Question 22: Preserving users with no orders, using `$$REMOVE`

For each user, return their details plus **all** their orders, newest first. Users with no orders must still appear, with `orders: []` — **not** `[null]`.

<details>
<summary>**Solution & Trace**</summary>

```js
db.users.aggregate([
  { $lookup: { from: "orders", localField: "_id", foreignField: "userId", as: "orders" } },
  { $unwind: { path: "$orders", preserveNullAndEmptyArrays: true } },
  { $sort: { "orders.createdAt": -1 } },
  {
    $group: {
      _id: "$_id",
      name: { $first: "$name" },
      orders: {
        $push: {
          $cond: [
            { $ne: ["$orders", null] },
            { orderId: "$orders._id", amount: "$orders.amount" },
            "$$REMOVE",                       // ← adds NOTHING to the array
          ],
        },
      },
    },
  },
]);
```

Add a third user with no orders to make the point:

```js
{ _id: "u3", name: "Meera", city: "Mumbai" }   // zero orders
```

**Trace:**

```text
── $lookup ──────────────────── 3 → 3 docs
  u1 orders: [o1, o2]
  u2 orders: [o3]
  u3 orders: [ ]                      ← empty array

── $unwind (preserve: true) ─── 3 → 4 docs
  u1 orders: o1
  u1 orders: o2
  u2 orders: o3
  u3 <orders field ABSENT>            ← preserved as a phantom row

── $sort ──────────────────────  4 docs, newest first within each user
── $group by _id ────────────── 4 → 3 docs

  u1: $cond(o2 ≠ null) → push {orderId:"o2", amount:1200}
      $cond(o1 ≠ null) → push {orderId:"o1", amount:500}
      → orders: [ {o2,1200}, {o1,500} ]

  u2: → orders: [ {o3,300} ]

  u3: $cond(missing ≠ null) is FALSE → "$$REMOVE" → push NOTHING
      → orders: [ ]                   ✓ empty array, exactly as required
```

:::danger[What happens without `$$REMOVE`]
```js
orders: { $push: { orderId: "$orders._id", amount: "$orders.amount" } }
// u3 → orders: [ { } ]        ⚠️ an array containing one EMPTY OBJECT

orders: { $push: "$orders" }
// u3 → orders: [ null ]       ⚠️ an array containing null
```
Your front-end then renders one blank order row for every user who has never ordered. `$$REMOVE` is the only clean fix inside `$push`.
:::

:::tip[The much simpler answer — offer it]
This whole pipeline exists to undo an `$unwind` that was never needed. If you only need each user's own orders sorted, do it inside the join:

```js
db.users.aggregate([
  { $lookup: {
      from: "orders",
      let: { uid: "$_id" },
      pipeline: [
        { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
        { $sort: { createdAt: -1 } },
        { $project: { _id: 0, orderId: "$_id", amount: 1 } },
      ],
      as: "orders",
  }},
]);
```

Three users in, three users out. No `$unwind`, no `$group`, no `$$REMOVE`, no phantom rows — and `orders` is naturally `[]` for u3, because that's what `$lookup` produces on no match. **Knowing `$$REMOVE` proves depth; knowing you don't need it here proves judgment.** Give both.
:::

</details>

---

### Question 23: Highest-rated movie per decade

For each decade, find the highest-rated movie.

```js
// db.movies
{ title: "Blade Runner", releaseYear: 1982, rating: 8.1 }
{ title: "Back to the Future", releaseYear: 1985, rating: 8.5 }
{ title: "The Matrix", releaseYear: 1999, rating: 8.7 }
{ title: "Fight Club", releaseYear: 1999, rating: 8.8 }
{ title: "Inception", releaseYear: 2010, rating: 8.8 }
{ title: "Interstellar", releaseYear: 2014, rating: 8.6 }
```

<details>
<summary>**Solution & Trace**</summary>

```js
db.movies.aggregate([
  {
    $addFields: {
      decadeStart: { $multiply: [{ $floor: { $divide: ["$releaseYear", 10] } }, 10] },
    },
  },
  { $sort: { decadeStart: 1, rating: -1 } },
  { $group: { _id: "$decadeStart", title: { $first: "$title" }, rating: { $first: "$rating" } } },
  { $sort: { _id: 1 } },
  { $project: { _id: 0, decade: { $concat: [{ $toString: "$_id" }, "s"] }, title: 1, rating: 1 } },
]);
```

**Trace — watch the decade arithmetic:**

```text
── $addFields ─────────────────
  1982 → floor(198.2)=198 → ×10 → 1980
  1985 → floor(198.5)=198 → ×10 → 1980
  1999 → floor(199.9)=199 → ×10 → 1990
  2010 → floor(201.0)=201 → ×10 → 2010
  2014 → floor(201.4)=201 → ×10 → 2010

── $sort: decadeStart asc, rating desc ────
  1980  Back to the Future  8.5    ← highest in the 80s, now first
  1980  Blade Runner        8.1
  1990  Fight Club          8.8    ← highest in the 90s
  1990  The Matrix          8.7
  2010  Inception           8.8
  2010  Interstellar        8.6

── $group by decadeStart ───────  6 → 3 docs ($first takes the top of each block)
  1980 → Back to the Future, 8.5
  1990 → Fight Club, 8.8
  2010 → Inception, 8.8

── $project ────────────────────
  { decade: "1980s", title: "Back to the Future", rating: 8.5 }
  { decade: "1990s", title: "Fight Club",         rating: 8.8 }
  { decade: "2010s", title: "Inception",          rating: 8.8 }
```

:::warning[Compute the decade as a NUMBER, format it as a string later]
The original instinct is to build `"1980s"` immediately with `$concat`. Don't — a string `_id` sorts lexicographically, so `"1990s"` < `"2010s"` happens to work but `"980s"` vs `"1980s"` would not, and any numeric range filter becomes impossible.

Group on the **number** `1980`, sort numerically, and `$concat` only in the final `$project`. Keep keys typed for as long as possible — the same principle as `$dateTrunc` over `$dateToString` in Question 20.
:::

**Bonus — "what if two movies tie for the highest rating?"** `$first` picks one **arbitrarily** (whichever the sort happened to place first among equals). Three honest options:

```js
// A) Deterministic tiebreak — same input always gives the same answer
{ $sort: { decadeStart: 1, rating: -1, title: 1 } }

// B) Return ALL tied winners
[
  { $group: { _id: "$decadeStart", maxRating: { $max: "$rating" }, movies: { $push: "$$ROOT" } } },
  { $project: {
      decade: "$_id", maxRating: 1,
      winners: { $filter: { input: "$movies", as: "m", cond: { $eq: ["$$m.rating", "$maxRating"] } } },
  }},
]

// C) 5.2+ — top 3 per decade, intent stated directly
{ $group: { _id: "$decadeStart",
            top: { $topN: { n: 3, sortBy: { rating: -1 }, output: { title: "$title", rating: "$rating" } } } } }
```

**Always add a deterministic tiebreaker** even when you don't return all ties — a report that silently changes its answer between runs is worse than one that's arbitrary but stable.

</details>

---

## Topic: Conditional Aggregation

### Question 24: Per-user order breakdown, including users with none

For every user return total orders, delivered orders, and cancelled orders. **All** users must appear, including those who have never ordered.

<details>
<summary>**Solution & Trace**</summary>

```js
db.users.aggregate([
  { $lookup: { from: "orders", localField: "_id", foreignField: "userId", as: "orders" } },
  { $unwind: { path: "$orders", preserveNullAndEmptyArrays: true } },
  {
    $group: {
      _id: "$_id",
      name: { $first: "$name" },
      totalOrders:     { $sum: { $cond: [{ $ne: ["$orders", null] }, 1, 0] } },
      deliveredOrders: { $sum: { $cond: [{ $eq: ["$orders.status", "DELIVERED"] }, 1, 0] } },
      cancelledOrders: { $sum: { $cond: [{ $eq: ["$orders.status", "CANCELLED"] }, 1, 0] } },
      deliveredValue:  { $sum: { $cond: [{ $eq: ["$orders.status", "DELIVERED"] }, "$orders.amount", 0] } },
    },
  },
]);
```

**Trace** with `u1` (2 delivered, 1 cancelled) and `u3` (no orders):

```text
── $unwind (preserve: true) ───
  u1  orders: {status:"DELIVERED", amount:500}
  u1  orders: {status:"DELIVERED", amount:1200}
  u1  orders: {status:"CANCELLED", amount:300}
  u3  <orders ABSENT>                            ← phantom row

── $group ─────────────────────
  u1:  totalOrders     = 1 + 1 + 1 = 3
       deliveredOrders = 1 + 1 + 0 = 2
       cancelledOrders = 0 + 0 + 1 = 1
       deliveredValue  = 500 + 1200 + 0 = 1700

  u3:  totalOrders     = $cond(missing ≠ null) → 0    ✓
       deliveredOrders = $cond(missing.status = "DELIVERED") → 0  ✓
       cancelledOrders = 0                                       ✓
       deliveredValue  = 0
```

:::danger[This question exists to catch `$sum: 1`]
```js
totalOrders: { $sum: 1 }        // ❌ u3 gets 1
```
**Every user who has never ordered reports exactly one order.** It's plausible-looking, it passes a smoke test, and it corrupts every downstream metric — conversion rate, average orders per user, activation funnels. This is the single most common `$lookup` + `$unwind` production bug.
:::

**The `$cond` + `$sum` pivot idiom** — this is the aggregation equivalent of SQL's `COUNT(CASE WHEN ... THEN 1 END)`. One pass over the data produces a full cross-tab. Recognise the shape:

```js
{ $sum: { $cond: [ <condition>, 1, 0 ] } }              // conditional COUNT
{ $sum: { $cond: [ <condition>, "$amount", 0 ] } }      // conditional SUM
{ $avg: { $cond: [ <condition>, "$amount", null ] } }   // conditional AVG (null is skipped)
```

**And again, the faster answer without any `$unwind`:**

```js
db.users.aggregate([
  { $lookup: { from: "orders", localField: "_id", foreignField: "userId", as: "orders" } },
  { $addFields: {
      totalOrders: { $size: "$orders" },
      deliveredOrders: { $size: { $filter: { input: "$orders", as: "o",
                                             cond: { $eq: ["$$o.status", "DELIVERED"] } } } },
      cancelledOrders: { $size: { $filter: { input: "$orders", as: "o",
                                             cond: { $eq: ["$$o.status", "CANCELLED"] } } } },
  }},
  { $project: { orders: 0 } },
]);
```

No `$unwind`, no `$group`, no phantom rows, no `$cond` — and `$size` of `[]` is naturally `0`. **N documents in, N documents out.** Wherever you can compute within the array, do.

</details>

---

### Question 25: Top student per subject (embedded grades)

Each student has a `grades` array of `{ subject, score }`. For each subject, find the student with the highest score.

```js
// db.students
{ _id: 1, name: "Alice", grades: [ { subject: "Math", score: 95 }, { subject: "English", score: 88 } ] }
{ _id: 2, name: "Bob",   grades: [ { subject: "Math", score: 78 }, { subject: "English", score: 92 } ] }
{ _id: 3, name: "Cara",  grades: [ { subject: "Math", score: 95 } ] }
```

<details>
<summary>**Solution & Trace**</summary>

```js
db.students.aggregate([
  { $unwind: "$grades" },
  { $sort: { "grades.subject": 1, "grades.score": -1, name: 1 } },   // tiebreak on name
  {
    $group: {
      _id: "$grades.subject",
      topStudent: { $first: "$name" },
      topScore:   { $first: "$grades.score" },
    },
  },
  { $project: { _id: 0, subject: "$_id", topStudent: 1, topScore: 1 } },
]);
```

**Trace:**

```text
── $unwind: "$grades" ────────── 3 → 5 docs
  Alice grades:{Math, 95}
  Alice grades:{English, 88}
  Bob   grades:{Math, 78}
  Bob   grades:{English, 92}
  Cara  grades:{Math, 95}

── $sort: subject asc, score desc, name asc ──
  English  Bob    92
  English  Alice  88
  Math     Alice  95      ← Alice before Cara: both 95, "Alice" < "Cara"
  Math     Cara   95
  Math     Bob    78

── $group by grades.subject ──── 5 → 2 docs
  English → $first = Bob, 92
  Math    → $first = Alice, 95

── $project ────────────────────
  { subject: "English", topStudent: "Bob",   topScore: 92 }
  { subject: "Math",    topStudent: "Alice", topScore: 95 }
```

:::danger[Two bugs to watch for — both appear in real answers]

**1. Sorting only by score.** `{ $sort: { "grades.score": -1 } }` alone happens to work, because `$group` collects each subject's documents independently and the highest score overall lands first within each subject too. But it's fragile reasoning, and adding a subject sort makes the intent explicit and index-friendly.

**2. The `$` inside the sort key.**
```js
{ $sort: { "$grades.score": -1 } }    // ❌ WRONG — sorts on a field literally named "$grades.score"
{ $sort: { "grades.score": -1 } }     // ✅
```
**`$sort` keys are field *names*, not expressions — no `$` prefix.** Inside `$group`/`$project` you write `"$grades.score"`; inside `$sort`, `$match`, and `$project` inclusion keys you write the bare name. Mixing these up produces no error and no sorting.
:::

**Bonus — ties.** Alice and Cara both scored 95 in Math. `$first` returns whichever the sort placed first, so **without a tiebreaker the answer is non-deterministic.** The `name: 1` in the sort makes it stable. To return all tied winners, see Question 26.

</details>

---

### Question 26: Handling ties properly

Same data, but now: for each subject return **every** student who achieved the top score, plus the full ranking.

<details>
<summary>**Solution & Trace**</summary>

```js
db.students.aggregate([
  { $unwind: "$grades" },
  {
    $group: {
      _id: "$grades.subject",
      topScore: { $max: "$grades.score" },
      all: { $push: { name: "$name", score: "$grades.score" } },
    },
  },
  {
    $project: {
      _id: 0,
      subject: "$_id",
      topScore: 1,
      winners: {
        $map: {
          input: { $filter: { input: "$all", as: "s", cond: { $eq: ["$$s.score", "$topScore"] } } },
          as: "w",
          in: "$$w.name",
        },
      },
      winnerCount: {
        $size: { $filter: { input: "$all", as: "s", cond: { $eq: ["$$s.score", "$topScore"] } } },
      },
    },
  },
]);
```

**Trace:**

```text
── $unwind ─────────────  5 docs (as in Q25)

── $group by subject ───  5 → 2 docs
  Math:    topScore = $max(95, 78, 95) = 95
           all = [ {Alice,95}, {Bob,78}, {Cara,95} ]
  English: topScore = $max(88, 92)     = 92
           all = [ {Alice,88}, {Bob,92} ]

── $project ────────────
  Math:    $filter all where score == 95  →  [ {Alice,95}, {Cara,95} ]
           $map to names                  →  ["Alice", "Cara"]
  English: $filter where score == 92      →  [ {Bob,92} ]
           $map                           →  ["Bob"]

OUTPUT
  { subject: "Math",    topScore: 95, winners: ["Alice","Cara"], winnerCount: 2 }
  { subject: "English", topScore: 92, winners: ["Bob"],          winnerCount: 1 }
```

**The mechanism worth naming:** `$max` and `$push` are computed **in the same `$group` pass**, so by the time the `$project` runs, each document carries both the winning score and the full roster. `$filter` then compares each roster entry against `$topScore` — a field on the *same* document. No second pass, no self-join.

**Alternative — full ranking with `$setWindowFields` (5.0+)**, which is often what's actually wanted:

```js
db.students.aggregate([
  { $unwind: "$grades" },
  { $setWindowFields: {
      partitionBy: "$grades.subject",
      sortBy: { "grades.score": -1 },
      output: { rank: { $rank: {} } },        // ties SHARE a rank
  }},
  { $match: { rank: 1 } },                    // every tied winner has rank 1
  { $project: { _id: 0, subject: "$grades.subject", name: 1, score: "$grades.score", rank: 1 } },
]);
```

```text
── $setWindowFields (Math partition, score desc) ──
  Alice 95 → rank 1
  Cara  95 → rank 1      ← $rank gives TIES THE SAME RANK
  Bob   78 → rank 3      ← then SKIPS to 3

── $match: rank == 1 ──  Alice and Cara both survive ✓
```

:::tip[`$rank` vs `$denseRank` vs `$documentNumber` — know all three]
| Scores | `$rank` | `$denseRank` | `$documentNumber` |
| :--- | :--- | :--- | :--- |
| 95 | 1 | 1 | 1 |
| 95 | 1 | 1 | 2 |
| 78 | **3** | **2** | 3 |

`$rank` shares and skips (Olympic ranking). `$denseRank` shares without skipping. `$documentNumber` is always unique and never shares — use it when you need an arbitrary but stable row number.

Picking `$rank` here is deliberate: it's the one where filtering `rank == 1` returns *all* tied winners.
:::

</details>

---

## Topic: Joins & Relationships

### Question 27: Pipeline `$lookup` — the production join

Find users whose **delivered** order total exceeds 1000, without pulling unnecessary order data into the join.

<details>
<summary>**Solution & Trace**</summary>

```js
db.users.aggregate([
  {
    $lookup: {
      from: "orders",
      let: { uid: "$_id" },
      pipeline: [
        { $match: { $expr: { $and: [
            { $eq: ["$userId", "$$uid"] },        // correlation
            { $eq: ["$status", "DELIVERED"] },    // filter INSIDE the join
        ]}}},
        { $group: { _id: null, total: { $sum: "$amount" } } },   // aggregate inside too
      ],
      as: "agg",
    },
  },
  { $addFields: { totalDelivered: { $ifNull: [{ $arrayElemAt: ["$agg.total", 0] }, 0] } } },
  { $match: { totalDelivered: { $gt: 1000 } } },
  { $project: { _id: 1, name: 1, totalDelivered: 1 } },
]);
```

**Trace:**

```text
── $lookup with an inner pipeline ── 2 → 2 docs (count unchanged)
  For u1: run [ match userId=u1 AND status=DELIVERED, group sum ]
          → agg: [ { _id: null, total: 1700 } ]
  For u2: → agg: [ { _id: null, total: 300 } ]
  For u3 (no delivered orders): → agg: [ ]     ← EMPTY array

── $addFields ─────────────────────
  u1  totalDelivered = arrayElemAt(agg.total, 0) = 1700
  u2  totalDelivered = 300
  u3  totalDelivered = $ifNull(missing, 0) = 0   ← the $ifNull is essential

── $match: > 1000 ─────────────────  2 → 1 doc
  { _id:"u1", name:"Asha", totalDelivered: 1700 }
```

**Why the pipeline form, spelled out:**

| | Simple `$lookup` | Pipeline `$lookup` |
| :--- | :--- | :--- |
| What crosses the wire | **Every** order for the user | One `{ total }` document |
| Filtering | After the join, in your pipeline | Inside the join, before materialising |
| A user with 50,000 orders | 50,000 documents in memory | 1 |
| Extra `$unwind` needed | Yes | No |

For a user with 50,000 orders of which 3 are delivered, the simple form pulls all 50,000 and throws away 49,997. **This is the whole reason pipeline `$lookup` exists.**

:::danger[The two things people get wrong in the pipeline form]
**1. Forgetting `$expr`.** Inside the inner pipeline, `let` variables are *expressions*, and plain `$match` syntax compares against literals:
```js
{ $match: { userId: "$$uid" } }                       // ❌ looks for the literal string "$$uid"
{ $match: { $expr: { $eq: ["$userId", "$$uid"] } } }  // ✅
```

**2. Forgetting `$ifNull` on the extraction.** `$arrayElemAt` on an empty array returns *missing*, so `totalDelivered` would be absent — and `{ $gt: 1000 }` on a missing field doesn't match, which happens to be right here but breaks the moment you want to display "₹0".
:::

:::warning[The `$expr` index caveat]
Mixing `$expr` correlation with a plain indexed predicate is the fastest shape, because the plain predicate can use an index:
```js
pipeline: [
  { $match: { status: "DELIVERED" } },                 // ← plain, index-eligible
  { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
]
```
And regardless of form, **`orders.userId` must be indexed** — `$lookup` runs one lookup per input document, and without an index each is a collection scan.
:::

</details>

---

### Question 28: City-level delivered revenue

For each city, compute total revenue from delivered orders only.

<details>
<summary>**Solution & Trace**</summary>

```js
db.users.aggregate([
  {
    $lookup: {
      from: "orders",
      let: { uid: "$_id" },
      pipeline: [
        { $match: { status: "DELIVERED" } },
        { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
        { $project: { _id: 0, amount: 1 } },
      ],
      as: "delivered",
    },
  },
  {
    $addFields: {
      userRevenue: { $sum: "$delivered.amount" },      // $sum over an array field
      userOrders:  { $size: "$delivered" },
    },
  },
  {
    $group: {
      _id: "$city",
      totalRevenue: { $sum: "$userRevenue" },
      totalOrders:  { $sum: "$userOrders" },
      customers:    { $sum: 1 },
    },
  },
  { $sort: { totalRevenue: -1 } },
]);
```

**Trace:**

```text
── $lookup (filtered) ─────────
  u1 Pune   delivered: [ {500}, {1200} ]
  u2 Delhi  delivered: [ {300} ]
  u3 Mumbai delivered: [ ]

── $addFields ─────────────────
  u1  userRevenue = $sum([500,1200]) = 1700,  userOrders = 2
  u2  userRevenue = 300,                      userOrders = 1
  u3  userRevenue = $sum([]) = 0,             userOrders = 0    ← naturally zero

── $group by city ─────────────
  { _id:"Pune",   totalRevenue:1700, totalOrders:2, customers:1 }
  { _id:"Delhi",  totalRevenue:300,  totalOrders:1, customers:1 }
  { _id:"Mumbai", totalRevenue:0,    totalOrders:0, customers:1 }  ← city still reported ✓
```

:::tip[`$sum` on a dotted array path]
`{ $sum: "$delivered.amount" }` works because `"$delivered.amount"` on an array of documents produces an **array of the `amount` values** — `[500, 1200]` — and `$sum` sums an array when used in `$addFields`/`$project`. `$sum` of `[]` is `0`.

That one expression replaces an `$unwind` + `$group` round trip, and it gives Mumbai a correct `0` instead of dropping it.
:::

:::danger[The `$match` placement trap in the naive version]
```js
{ $lookup: { …simple… } },
{ $unwind: "$orders" },                        // ← users with no orders vanish HERE
{ $match: { "orders.status": "DELIVERED" } },  // ← users with only cancelled orders vanish HERE
{ $group: { _id: "$city", … } },
```
A city where every order was cancelled **disappears from the report entirely** rather than showing ₹0. If the business question is "revenue by city," a missing city and a zero city are very different answers. The version above reports zeros correctly.
:::

**On direction:** starting from `users` is right here because you're grouping by `city`, a user attribute. If the orders collection already denormalised the city (the [extended reference pattern](./03-data-modeling.md#the-extended-reference-pattern)), the whole pipeline collapses to a single `$match` + `$group` on `orders` with no join at all — which is the schema-design answer.

</details>

---

### Question 29: Top scorer per subject, across two collections

`students` holds student info; `scores` holds one document per student per subject. For each subject return the subject, top score, and the student's name.

```js
// db.students
{ studentId: "S001", name: "Alice", age: 20 }
{ studentId: "S002", name: "Bob",   age: 22 }

// db.scores
{ studentId: "S001", subject: "Math",    score: 95 }
{ studentId: "S001", subject: "English", score: 88 }
{ studentId: "S002", subject: "Math",    score: 78 }
{ studentId: "S002", subject: "English", score: 92 }
```

<details>
<summary>**Solution & Trace**</summary>

```js
db.scores.aggregate([
  { $sort: { subject: 1, score: -1, studentId: 1 } },
  { $group: { _id: "$subject", topScore: { $first: "$score" }, studentId: { $first: "$studentId" } } },
  { $lookup: { from: "students", localField: "studentId", foreignField: "studentId", as: "student" } },
  { $unwind: "$student" },
  { $project: { _id: 0, subject: "$_id", topScore: 1, studentName: "$student.name" } },
  { $sort: { subject: 1 } },
]);
```

**Trace:**

```text
── $sort ──────────────────────  4 docs
  English  S002  92
  English  S001  88
  Math     S001  95
  Math     S002  78

── $group by subject ────────── 4 → 2 docs
  English → topScore 92, studentId S002
  Math    → topScore 95, studentId S001

── $lookup students ─────────── 2 → 2 docs (only TWO lookups!)
  English  student: [ {S002, Bob,   22} ]
  Math     student: [ {S001, Alice, 20} ]

── $unwind + $project ─────────
  { subject: "English", topScore: 92, studentName: "Bob"   }
  { subject: "Math",    topScore: 95, studentName: "Alice" }
```

:::tip[The design decision: start from `scores`, join LAST]
Compare with the alternative of starting from `students`:

| | Start from `scores`, join last **(this solution)** | Start from `students`, join first |
| :--- | :--- | :--- |
| Documents entering `$lookup` | **2** (one per subject) | N (every student) |
| Lookups executed | 2 | N |
| Extra `$unwind` of scores | no | yes |

**Reduce first, then join.** Grouping down to one row per subject *before* the `$lookup` means two lookups instead of thousands. With 50,000 students and 8 subjects, that's 8 lookups versus 50,000.

Stating this rule — *"filter and aggregate as much as possible before any `$lookup`"* — is exactly what an interviewer wants to hear at senior level.
:::

**Modern version (5.2+)** — `$top` removes the global sort:

```js
db.scores.aggregate([
  { $group: { _id: "$subject",
              best: { $top: { sortBy: { score: -1, studentId: 1 },
                              output: { score: "$score", studentId: "$studentId" } } } } },
  { $lookup: { from: "students", localField: "best.studentId", foreignField: "studentId", as: "s" } },
  { $project: { _id: 0, subject: "$_id", topScore: "$best.score",
                studentName: { $first: "$s.name" } } },
]);
```

**Sample output for the bonus:**
```js
[ { subject: "English", topScore: 92, studentName: "Bob"   },
  { subject: "Math",    topScore: 95, studentName: "Alice" } ]
```

</details>

---

## Topic: Advanced Array Aggregation

### Question 30: `$reduce` — total cart value

For each order, compute `totalCartValue` = Σ(quantity × price) over `items`.

<details>
<summary>**Solution & Trace**</summary>

```js
db.orders.aggregate([
  {
    $project: {
      _id: 0,
      orderId: 1,
      totalCartValue: {
        $reduce: {
          input: "$items",
          initialValue: 0,
          in: { $add: ["$$value", { $multiply: ["$$this.quantity", "$$this.price"] }] },
        },
      },
    },
  },
]);
```

**Trace — the accumulator, step by step:**

```text
Order O1: items = [ {qty:2, price:100}, {qty:1, price:250}, {qty:3, price:50} ]

  initialValue          $$value = 0
  iteration 1  $$this = {qty:2, price:100}   $$value = 0   + (2×100) = 200
  iteration 2  $$this = {qty:1, price:250}   $$value = 200 + (1×250) = 450
  iteration 3  $$this = {qty:3, price:50}    $$value = 450 + (3×50)  = 600
                                                                     ─────
  result                                                              600

Order O2: items = [ ]
  no iterations → returns initialValue → 0     ✓ empty array is safe

OUTPUT (3 docs in → 3 docs out, no explosion)
  { orderId: "O1", totalCartValue: 600 }
  { orderId: "O2", totalCartValue: 0   }
```

**The two variables:** `$$value` is the accumulator so far, `$$this` is the current element. There's no `as` option on `$reduce` — those names are fixed.

**Why this beats `$unwind` + `$group`:**

```js
// The $unwind version — same answer, much more work
[
  { $unwind: "$items" },
  { $group: { _id: "$orderId",
              totalCartValue: { $sum: { $multiply: ["$items.quantity", "$items.price"] } } } },
]
```

| | `$reduce` | `$unwind` + `$group` |
| :--- | :--- | :--- |
| Intermediate documents | 0 | one per line item |
| Blocking stages | none — fully streaming | `$group` buffers everything |
| Orders with `items: []` | `0` ✓ | **dropped entirely** ✗ |
| Other fields on the order | preserved | must be re-accumulated |

That third row matters: an empty cart silently vanishes from the `$unwind` version.

**`$reduce` builds arrays too**, not just numbers:

```js
// Flatten a nested array
{ $reduce: { input: "$matrix", initialValue: [], in: { $concatArrays: ["$$value", "$$this"] } } }

// Build a comma-separated string
{ $reduce: { input: "$tags", initialValue: "",
             in: { $cond: [{ $eq: ["$$value", ""] }, "$$this",
                           { $concat: ["$$value", ", ", "$$this"] }] } } }

// Running maximum
{ $reduce: { input: "$scores", initialValue: 0, in: { $max: ["$$value", "$$this"] } } }
```

:::tip[The simplest answer for a plain sum]
If you only need the sum of one field, skip `$reduce` entirely:
```js
totalQty: { $sum: "$items.quantity" }     // $sum over an array path
```
`$reduce` is for when the per-element expression is non-trivial — like `quantity × price`, which needs two fields multiplied before summing.
:::

</details>

---

## Topic: Analytics & Ranking

### Question 31: Ranking users within each city

Rank users by total spending **within each city**. Return userId, city, total spent, and rank.

<details>
<summary>**Solution & Trace**</summary>

```js
db.orders.aggregate([
  { $match: { status: "PAID" } },
  { $group: { _id: { city: "$city", userId: "$userId" }, totalSpent: { $sum: "$totalAmount" } } },
  {
    $setWindowFields: {
      partitionBy: "$_id.city",
      sortBy: { totalSpent: -1 },
      output: {
        rank:        { $rank: {} },
        cityTotal:   { $sum: "$totalSpent", window: { documents: ["unbounded", "unbounded"] } },
        runningTotal:{ $sum: "$totalSpent", window: { documents: ["unbounded", "current"] } },
      },
    },
  },
  {
    $project: {
      _id: 0,
      userId: "$_id.userId",
      city: "$_id.city",
      totalSpent: 1,
      rank: 1,
      shareOfCity: { $round: [{ $multiply: [{ $divide: ["$totalSpent", "$cityTotal"] }, 100] }, 1] },
    },
  },
  { $sort: { city: 1, rank: 1 } },
]);
```

**Trace:**

```text
── $group ─────────────────────
  { _id:{city:"Pune",  userId:"u1"}, totalSpent: 5000 }
  { _id:{city:"Pune",  userId:"u2"}, totalSpent: 3000 }
  { _id:{city:"Pune",  userId:"u3"}, totalSpent: 3000 }
  { _id:{city:"Delhi", userId:"u4"}, totalSpent: 8000 }
  { _id:{city:"Delhi", userId:"u5"}, totalSpent: 1000 }

── $setWindowFields: partition by city, sort by totalSpent desc ──
  ⚠️ NOTHING IS COLLAPSED — 5 documents in, 5 documents out, each enriched

  PUNE partition (cityTotal = 11000)
    u1  5000  rank 1   runningTotal  5000   share 45.5%
    u2  3000  rank 2   runningTotal  8000   share 27.3%
    u3  3000  rank 2   runningTotal 11000   share 27.3%   ← TIE shares rank 2
                                                            (next would be rank 4)
  DELHI partition (cityTotal = 9000)
    u4  8000  rank 1   runningTotal  8000   share 88.9%
    u5  1000  rank 2   runningTotal  9000   share 11.1%
```

:::tip[The defining difference from `$group`]
`$group` **collapses** N documents into one per key. `$setWindowFields` **enriches** each document with a value computed over its partition — every input document survives.

That's why ranking is impossible with `$group` alone: you need each user's row *and* a value derived from all the other rows in their city.
:::

**Window bounds — the two forms:**

```js
window: { documents: ["unbounded", "current"] }   // positional: start of partition → this row
window: { documents: [-1, 1] }                    // previous, current, next
window: { documents: ["unbounded", "unbounded"] } // the entire partition
window: { range: [-7, 0], unit: "day" }           // VALUE-based on the sortBy field
```

The `range` form is the one people miss: `documents: [-6, 0]` means "the previous 6 rows," which is wrong for a 7-day moving average when some days have no data. `range: [-7, 0], unit: "day"` means "the previous 7 days of actual time" and handles gaps correctly.

**Other window operators worth naming:**

```js
{ $shift: { output: "$totalSpent", by: -1, default: 0 } }   // previous row → period-over-period
{ $expMovingAvg: { input: "$totalSpent", N: 3 } }
{ $derivative: { input: "$value", unit: "second" } }
{ $push: "$userId", window: { documents: ["unbounded", "unbounded"] } }
```

**Pre-5.0 fallback**, worth mentioning as a version note: `$group` + `$push` into an array, `$unwind` with `includeArrayIndex: "rank"`, then add 1. Clumsy, slower, and can't express ties correctly — which is exactly why `$setWindowFields` was added.

</details>

---

## Topic: Multi-Collection Analytics

### Question 32: `$unionWith` — unified revenue report

Combine `onlineOrders` and `offlineOrders` into one report of total order count and total revenue.

<details>
<summary>**Solution & Trace**</summary>

```js
db.onlineOrders.aggregate([
  { $addFields: { channel: "ONLINE" } },
  {
    $unionWith: {
      coll: "offlineOrders",
      pipeline: [ { $addFields: { channel: "OFFLINE" } } ],
    },
  },
  {
    $group: {
      _id: "$channel",
      totalOrders:  { $sum: 1 },
      totalRevenue: { $sum: "$amount" },
      avgOrder:     { $avg: "$amount" },
    },
  },
  {
    $group: {                                    // second group → grand total + breakdown
      _id: null,
      byChannel: { $push: { channel: "$_id", orders: "$totalOrders", revenue: "$totalRevenue" } },
      totalOrders:  { $sum: "$totalOrders" },
      totalRevenue: { $sum: "$totalRevenue" },
    },
  },
  { $project: { _id: 0, totalOrders: 1, totalRevenue: 1, byChannel: 1 } },
]);
```

**Trace:**

```text
onlineOrders                     offlineOrders
  { o1, amount: 500 }              { f1, amount: 200 }
  { o2, amount: 300 }              { f2, amount: 700 }

── $addFields channel: ONLINE ──  2 docs tagged
── $unionWith (+ its pipeline) ──  2 + 2 = 4 docs in ONE stream
  { o1, 500, ONLINE }
  { o2, 300, ONLINE }
  { f1, 200, OFFLINE }
  { f2, 700, OFFLINE }

── $group by channel ─────────── 4 → 2 docs
  ONLINE:  orders 2, revenue 800,  avg 400
  OFFLINE: orders 2, revenue 900,  avg 450

── $group _id: null ──────────── 2 → 1 doc
  { totalOrders: 4, totalRevenue: 1700,
    byChannel: [ {ONLINE,2,800}, {OFFLINE,2,900} ] }
```

**The `channel` tag is the point.** A bare `$unionWith` + `$group: { _id: null }` gives you one grand total and no way to see the split. Tagging each side before the union means one pass produces both the total *and* the breakdown — which is what a real revenue report needs.

:::warning[`$unionWith` is `UNION ALL`, not `UNION`]
Duplicates are **kept**. If the same order could exist in both collections (a sync bug, an overlapping archive), you must deduplicate explicitly:

```js
{ $group: { _id: "$orderId", doc: { $first: "$$ROOT" } } },
{ $replaceRoot: { newRoot: "$doc" } },
```
:::

**Other constraints to know:**

- `$unionWith` can appear anywhere except inside `$facet`.
- The inner `pipeline` runs against the *other* collection and can filter/project — push filters in there rather than after the union.
- Document shapes don't need to match; MongoDB just concatenates the streams.
- Ordering across the union is not guaranteed — add an explicit `$sort` after it if you need one.

**Where this earns its keep:** querying time-partitioned collections (`orders_2025` + `orders_2026`), unifying a hot collection with a cold archive, or comparing two data sets in a single pass. If you find yourself unioning many collections routinely, that's usually a sign the data should have been one collection with a discriminator field — worth saying out loud.

</details>

---

## What you should now be able to do

- [ ] Write the `$sort` → `$group`+`$first` → `$replaceRoot` idiom from memory, and explain why the sort is load-bearing.
- [ ] Use `$$REMOVE` correctly — and explain when the pipeline that needs it shouldn't exist.
- [ ] Write both forms of `$lookup` and state precisely when the pipeline form wins.
- [ ] Solve top-N-per-group three ways: double `$group`, `$topN`, and `$setWindowFields` + `$rank`.
- [ ] Explain `$rank` vs `$denseRank` vs `$documentNumber` with a tie in the data.
- [ ] Choose `$reduce`/`$filter`/`$size` over `$unwind`, and say why.
- [ ] Reduce before joining — always.

**Next:** [Interview Q&A →](./15-interview-qa.md)
