---
title: Beginner Practice
---

# Beginner Practice — Questions 1–8

> **Focus**: `$match`, `$sort`, `$project`, `$group`, `$lookup`, `$unwind`.
>
> **How to use this page**: read the question, write your pipeline *before* opening the solution. Then read the **trace** — it shows the documents after every single stage. If your answer differed, the trace tells you exactly which stage diverged.

---

## Topic: Filtering & Projection

### Question 1: Basic filtering and sorting

You are given a `movies` collection. Retrieve all **Sci-Fi** movies, sorted by `releaseYear` descending.

```js
// db.movies
{ _id: 1, title: "Inception",       genre: "Sci-Fi", releaseYear: 2010, rating: 8.8 }
{ _id: 2, title: "The Dark Knight", genre: "Action", releaseYear: 2008, rating: 9.0 }
{ _id: 3, title: "Interstellar",    genre: "Sci-Fi", releaseYear: 2014, rating: 8.6 }
{ _id: 4, title: "Arrival",         genre: "Sci-Fi", releaseYear: 2016, rating: 7.9 }
```

<details>
<summary>**Solution & Trace**</summary>

```js
db.movies.aggregate([
  { $match: { genre: "Sci-Fi" } },
  { $sort: { releaseYear: -1 } },
]);
```

**Stage-by-stage:**

```text
INPUT (4 docs)
  1 Inception       Sci-Fi 2010
  2 The Dark Knight Action 2008
  3 Interstellar    Sci-Fi 2014
  4 Arrival         Sci-Fi 2016

── $match: { genre: "Sci-Fi" } ──────────── 4 → 3 docs
  1 Inception    Sci-Fi 2010   ✓ kept
  2 ✗ dropped (Action)
  3 Interstellar Sci-Fi 2014   ✓ kept
  4 Arrival      Sci-Fi 2016   ✓ kept

── $sort: { releaseYear: -1 } ───────────── 3 → 3 docs, reordered
  4 Arrival      2016
  3 Interstellar 2014
  1 Inception    2010
```

**Why this order?** `$match` first is not a style choice — as the **first stage** it can use an index on `{ genre: 1, releaseYear: -1 }`, and it shrinks the input to `$sort` so the sort has less work (and less chance of hitting the 100 MB limit).

**Reverse the stages and the result is identical but the execution is worse:** `$sort` would order all 4 documents, then `$match` would throw one away. Correct answer, wasted work.

:::tip[Follow-up you should expect]
*"Would `find()` have been better here?"* — Yes. `db.movies.find({ genre: "Sci-Fi" }).sort({ releaseYear: -1 })` does exactly the same thing and reads more clearly. Use `aggregate()` when you need stages `find()` doesn't have. Recognising when *not* to use aggregation is a real signal.
:::

</details>

---

## Topic: Projection & Computed Fields

### Question 2: Computed fields with `$project`

For each employee return their **name**, **monthly salary**, and **annual salary** (monthly × 12). Only those fields should appear.

```js
// db.employees
{ _id: 1, name: "Asha", dept: "Eng",   monthlySalary: 80000, joinedAt: ISODate("2021-04-01") }
{ _id: 2, name: "Ravi", dept: "Sales", monthlySalary: 50000, joinedAt: ISODate("2022-07-15") }
{ _id: 3, name: "Meera", dept: "Eng" }                       // ← no salary field
```

<details>
<summary>**Solution & Trace**</summary>

```js
db.employees.aggregate([
  {
    $project: {
      _id: 0,
      name: 1,
      monthlySalary: 1,
      annualSalary: { $multiply: ["$monthlySalary", 12] },
    },
  },
]);
```

**Trace:**

```text
INPUT                                          OUTPUT
{_id:1, name:"Asha", dept:"Eng",          ▶   { name:"Asha", monthlySalary:80000,
        monthlySalary:80000, joinedAt:…}          annualSalary:960000 }
                                                 ^^^ _id, dept, joinedAt all dropped

{_id:2, name:"Ravi", …, 50000, …}         ▶   { name:"Ravi", monthlySalary:50000,
                                                 annualSalary:600000 }

{_id:3, name:"Meera", dept:"Eng"}         ▶   { name:"Meera" }
                                                 ^^^ monthlySalary missing → annualSalary
                                                     is OMITTED, not null, not 0
```

**The key behaviour:** `$multiply` on a missing field returns `null`, and `$project` **omits a field whose value is null-from-missing** rather than emitting `annualSalary: null`. So document 3 comes out with only `name`.

**Bonus — "what if some employees have no salary?"** Decide explicitly what the business wants:

```js
// Treat missing as 0
annualSalary: { $multiply: [{ $ifNull: ["$monthlySalary", 0] }, 12] }

// Exclude them from the report entirely
{ $match: { monthlySalary: { $exists: true, $type: "number" } } }   // put BEFORE $project

// Flag them for follow-up
annualSalary: { $cond: [{ $ifNull: ["$monthlySalary", false] },
                        { $multiply: ["$monthlySalary", 12] },
                        "MISSING_SALARY"] }
```

Notice all three are defensible — the interviewer is testing whether you *notice the ambiguity*, not whether you pick a particular branch.

</details>

---

## Topic: Conditional Projection

### Question 3: Handling missing fields with `$ifNull`

Return each user's `name` and `phoneNumber`, substituting `"N/A"` where the phone number is missing.

```js
// db.users
{ _id: 1, name: "Asha",  phoneNumber: "9876543210" }
{ _id: 2, name: "Ravi" }                                // missing
{ _id: 3, name: "Meera", phoneNumber: null }            // explicitly null
{ _id: 4, name: "Karan", phoneNumber: "" }              // empty string!
```

<details>
<summary>**Solution & Trace**</summary>

```js
db.users.aggregate([
  { $project: { _id: 0, name: 1, phoneNumber: { $ifNull: ["$phoneNumber", "N/A"] } } },
]);
```

**Trace:**

```text
_id:1  phoneNumber: "9876543210"  ▶  { name:"Asha",  phoneNumber:"9876543210" }
_id:2  phoneNumber: <missing>     ▶  { name:"Ravi",  phoneNumber:"N/A" }   ✓
_id:3  phoneNumber: null          ▶  { name:"Meera", phoneNumber:"N/A" }   ✓
_id:4  phoneNumber: ""            ▶  { name:"Karan", phoneNumber:"" }      ⚠️
```

**The trap is document 4.** `$ifNull` catches missing *and* null — but an empty string is a perfectly good value, so it passes straight through. Real-world data is full of `""`, `" "`, and `"null"`.

If empty should also count as missing:

```js
phoneNumber: {
  $cond: [
    { $in: [{ $ifNull: [{ $trim: { input: "$phoneNumber" } }, ""] }, ["", null]] },
    "N/A",
    "$phoneNumber",
  ],
}
```

:::tip
`$ifNull` accepts multiple fallbacks in 5.0+: `{ $ifNull: ["$mobile", "$landline", "$workPhone", "N/A"] }` — a clean coalesce chain.
:::

</details>

---

## Topic: Grouping & Aggregation

### Question 4: Grouping basics

Calculate the total quantity of products sold in each region.

```js
// db.sales
{ saleId: 1, product: "Laptop", quantity: 3, price: 1000, region: "North" }
{ saleId: 2, product: "Phone",  quantity: 5, price: 500,  region: "South" }
{ saleId: 3, product: "Tablet", quantity: 2, price: 300,  region: "North" }
{ saleId: 4, product: "Laptop", quantity: 1, price: 1000, region: "East"  }
{ saleId: 5, product: "Phone",  quantity: 4, price: 500,  region: "South" }
```

<details>
<summary>**Solution & Trace**</summary>

```js
db.sales.aggregate([
  { $group: { _id: "$region", totalQuantity: { $sum: "$quantity" } } },
]);
```

**Trace — watch the accumulator build up:**

```text
INPUT                                    GROUPING BUCKETS (built incrementally)

saleId 1  region:North  qty:3     ──▶  North: totalQuantity = 0 + 3 = 3
saleId 2  region:South  qty:5     ──▶  South: totalQuantity = 0 + 5 = 5
saleId 3  region:North  qty:2     ──▶  North: totalQuantity = 3 + 2 = 5
saleId 4  region:East   qty:1     ──▶  East:  totalQuantity = 0 + 1 = 1
saleId 5  region:South  qty:4     ──▶  South: totalQuantity = 5 + 4 = 9

OUTPUT (5 docs → 3 docs, one per distinct region)
  { _id: "North", totalQuantity: 5 }
  { _id: "South", totalQuantity: 9 }
  { _id: "East",  totalQuantity: 1 }
```

:::danger[The three things to notice]
1. **`"$region"` with the dollar sign.** `_id: "region"` (no `$`) would create **one** group whose `_id` is the literal string `"region"`, silently summing everything into a single bucket. No error. Wrong answer.
2. **`product`, `price`, `saleId` no longer exist.** `$group` destroyed them. Needing `product` in the output means adding an accumulator like `{ $push: "$product" }` or `{ $first: "$product" }`.
3. **Output order is not guaranteed.** `$group` makes no promise about the order of its output documents. Add an explicit `$sort` if order matters.
:::

**Bonus — "restrict to one product or a date range?"** Add a `$match` **before** the `$group`, so it filters source documents and can use an index:

```js
[
  { $match: { product: "Phone", soldAt: { $gte: ISODate("2026-01-01") } } },
  { $group: { _id: "$region", totalQuantity: { $sum: "$quantity" } } },
]
```

Placing that `$match` *after* `$group` would fail outright — `product` doesn't exist by then.

</details>

---

### Question 5: Averages

Calculate the average order amount per customer.

```js
// db.orders
{ orderId: "O1001", customerId: "C001", totalAmount: 120, createdAt: ISODate("2026-01-10") }
{ orderId: "O1002", customerId: "C002", totalAmount: 250, createdAt: ISODate("2026-01-12") }
{ orderId: "O1003", customerId: "C001", totalAmount: 300, createdAt: ISODate("2026-01-15") }
{ orderId: "O1004", customerId: "C002", totalAmount: 150, createdAt: ISODate("2026-01-18") }
{ orderId: "O1005", customerId: "C001", totalAmount: null, createdAt: ISODate("2026-01-20") }
```

<details>
<summary>**Solution & Trace**</summary>

```js
db.orders.aggregate([
  { $group: { _id: "$customerId", averageAmount: { $avg: "$totalAmount" } } },
]);
```

**Trace:**

```text
C001 collects: [120, 300, null]
      $avg IGNORES null  →  (120 + 300) / 2 = 210      ← divisor is 2, NOT 3
C002 collects: [250, 150]
      $avg              →  (250 + 150) / 2 = 200

OUTPUT
  { _id: "C001", averageAmount: 210 }
  { _id: "C002", averageAmount: 200 }
```

:::danger[The `$avg` null rule]
**`$avg` skips null and missing values entirely — they don't count in the numerator *or* the denominator.** If C001's null order should count as ₹0, the average would be 140, not 210:

```js
averageAmount: { $avg: { $ifNull: ["$totalAmount", 0] } }
```

Which is right depends on the business meaning of a null amount (a data bug? a free order?). Being the candidate who *asks* is the point.
:::

**Making the answer production-quality** — an average alone is a weak metric without a count, and rounding matters:

```js
{ $group: {
    _id: "$customerId",
    orderCount:    { $sum: 1 },
    totalSpend:    { $sum: "$totalAmount" },
    averageAmount: { $avg: "$totalAmount" },
}},
{ $addFields: { averageAmount: { $round: ["$averageAmount", 2] } } },
{ $sort: { totalSpend: -1 } }
```

**Bonus — "average within a time range?"** `$match` before the `$group`:

```js
{ $match: { createdAt: { $gte: ISODate("2026-01-01"), $lt: ISODate("2026-02-01") } } }
```

</details>

---

### Question 6: `$match` + `$group` together

From the same `sales` collection, find total units sold per region **considering only sales where the unit price is at least 500**, and return regions sorted by total descending.

<details>
<summary>**Solution & Trace**</summary>

```js
db.sales.aggregate([
  { $match: { price: { $gte: 500 } } },
  { $group: { _id: "$region", totalQuantity: { $sum: "$quantity" }, orders: { $sum: 1 } } },
  { $sort: { totalQuantity: -1 } },
]);
```

**Trace:**

```text
INPUT (5 docs)
  1 Laptop qty:3 price:1000 North
  2 Phone  qty:5 price:500  South
  3 Tablet qty:2 price:300  North
  4 Laptop qty:1 price:1000 East
  5 Phone  qty:4 price:500  South

── $match: price >= 500 ─────────── 5 → 4 docs
  1 ✓   2 ✓   3 ✗ (300)   4 ✓   5 ✓

── $group by region ─────────────── 4 → 3 docs
  North: qty 3,      orders 1      ← Tablet excluded, so only 3 not 5
  South: qty 5+4=9,  orders 2
  East:  qty 1,      orders 1

── $sort: totalQuantity desc ────── 3 → 3 docs, reordered
  { _id:"South", totalQuantity:9, orders:2 }
  { _id:"North", totalQuantity:3, orders:1 }
  { _id:"East",  totalQuantity:1, orders:1 }
```

**The teaching point:** compare North here (3) with North in Question 4 (5). Same collection, same grouping — the `$match` changed the *source population*, so it changed the aggregate. That's `WHERE` semantics.

Contrast with filtering **after** the group, which changes the *result set* instead:

```js
{ $group: { … } },
{ $match: { totalQuantity: { $gte: 5 } } },   // HAVING — only South survives
```

Both are `$match`. Same operator, different job, decided entirely by position. This is Question 9's whole subject.

</details>

---

### Question 7: `$sum` and `$avg` in one group

For each customer, return their **order count**, **total spend**, **average order value**, and their **largest single order** — in one pass.

<details>
<summary>**Solution & Trace**</summary>

```js
db.orders.aggregate([
  {
    $group: {
      _id: "$customerId",
      orderCount:   { $sum: 1 },              // ← 1 per document = a counter
      totalSpend:   { $sum: "$totalAmount" }, // ← a field value = a sum
      averageOrder: { $avg: "$totalAmount" },
      largestOrder: { $max: "$totalAmount" },
      smallestOrder:{ $min: "$totalAmount" },
    },
  },
  { $sort: { totalSpend: -1 } },
]);
```

**Trace for C001 with orders `[120, 300, null]`:**

```text
                    doc1(120)   doc2(300)   doc3(null)   FINAL
orderCount   :  0 →    1     →     2      →     3      →   3     (counts the null row!)
totalSpend   :  0 →  120     →   420      →   420      → 420     (null ignored)
averageOrder :       120           210          210      → 210     (divisor 2)
largestOrder :       120           300          300      → 300
smallestOrder:       120           120          120      → 120     (null ignored)
```

:::warning[Look at that table again]
`orderCount` is **3** but `averageOrder` used a divisor of **2**. Inside one `$group`, `$sum: 1` counts every document while `$avg`/`$min`/`$max`/`$sum: "$field"` skip nulls. So `totalSpend / orderCount` = 140 ≠ `averageOrder` = 210.

Two numbers on the same dashboard that don't reconcile — and both are "correct." This inconsistency is a genuinely common production bug, and explaining it is a strong answer.

To make them agree, normalise first:
```js
{ $match: { totalAmount: { $type: "number" } } },   // or $ifNull to 0
```
:::

**Key distinction to state clearly:** `{ $sum: 1 }` adds the literal 1 per document — a row counter. `{ $sum: "$field" }` adds the field's value. On 5.0+, `{ $count: {} }` is the clearer way to write a row count.

</details>

---

## Topic: Joins & Relationships

### Question 8: Basic `$lookup`

Join `products` to `categories` and return `productId`, `name`, `price`, and `categoryName`. Each product must appear exactly once.

```js
// db.products
{ productId: 101, name: "Keyboard", categoryId: 1, price: 50  }
{ productId: 102, name: "Mouse",    categoryId: 1, price: 25  }
{ productId: 103, name: "Monitor",  categoryId: 2, price: 200 }
{ productId: 104, name: "Webcam",   categoryId: 9, price: 80  }   // ← no such category

// db.categories
{ categoryId: 1, categoryName: "Accessories" }
{ categoryId: 2, categoryName: "Displays" }
```

<details>
<summary>**Solution & Trace**</summary>

```js
db.products.aggregate([
  {
    $lookup: {
      from: "categories",
      localField: "categoryId",
      foreignField: "categoryId",
      as: "categoryDetails",
    },
  },
  { $unwind: { path: "$categoryDetails", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      _id: 0,
      productId: 1,
      name: 1,
      price: 1,
      categoryName: "$categoryDetails.categoryName",
    },
  },
]);
```

**Trace — this is the one to study carefully:**

```text
── AFTER $lookup ───────────────── 4 → 4 docs (lookup NEVER changes the count)
  101 Keyboard  categoryDetails: [ {categoryId:1, categoryName:"Accessories"} ]
  102 Mouse     categoryDetails: [ {categoryId:1, categoryName:"Accessories"} ]
  103 Monitor   categoryDetails: [ {categoryId:2, categoryName:"Displays"} ]
  104 Webcam    categoryDetails: [ ]        ← EMPTY ARRAY, not null. Doc still here.
                                              ^ $lookup is a LEFT OUTER JOIN

── AFTER $unwind (preserveNullAndEmptyArrays: true) ──── 4 → 4 docs
  101 categoryDetails: {categoryId:1, categoryName:"Accessories"}   ← array → object
  102 categoryDetails: {categoryId:1, categoryName:"Accessories"}
  103 categoryDetails: {categoryId:2, categoryName:"Displays"}
  104 categoryDetails: <field ABSENT>    ← preserved, but the field is gone entirely

── AFTER $project ──────────────── 4 → 4 docs
  { productId:101, name:"Keyboard", price:50,  categoryName:"Accessories" }
  { productId:102, name:"Mouse",    price:25,  categoryName:"Accessories" }
  { productId:103, name:"Monitor",  price:200, categoryName:"Displays" }
  { productId:104, name:"Webcam",   price:80 }        ← categoryName omitted
```

:::danger[Without `preserveNullAndEmptyArrays: true`]
```text
── $unwind (default) ───────────── 4 → 3 docs
  104 Webcam  ✗ SILENTLY DELETED — empty array produces zero output documents
```
The Webcam **disappears from your product listing.** No error, no warning. This is the single most common `$lookup` + `$unwind` bug and it is exactly why the interviewer put a category-less product in the data.
:::

**Answering the bonus questions directly:**

- *"What happens if a product has no matching category?"* — `$lookup` still emits the document with an **empty array**, because it's a left outer join. Then the default `$unwind` drops it, because unwinding an empty array yields nothing.
- *"How would you still include such products?"* — `preserveNullAndEmptyArrays: true`, and give the missing name a default: `categoryName: { $ifNull: ["$categoryDetails.categoryName", "Uncategorised"] }`.

**Why `$unwind` at all?** Because `$lookup` always produces an **array**, even for a guaranteed 1:1 relationship. Two ways to flatten it:

```js
// A) $unwind — clearer, and the right choice when a match could produce many rows
{ $unwind: { path: "$categoryDetails", preserveNullAndEmptyArrays: true } }

// B) $arrayElemAt — no extra stage, good when you KNOW it's at most one match
{ $addFields: { categoryName: { $arrayElemAt: ["$categoryDetails.categoryName", 0] } } }
```

:::warning[Performance — say this unprompted]
`$lookup` runs roughly one query against `categories` **per input product**. With 100,000 products that's 100,000 lookups. **`categories.categoryId` must be indexed**, or every one of them is a collection scan.

And the deeper point: a category name is a textbook [extended reference](./03-data-modeling.md#the-extended-reference-pattern) — small, read constantly, changes almost never. Embedding `categoryName` directly on the product removes this join entirely. In a schema-design interview, *that* is the winning answer.
:::

</details>

---

## What you should now be able to do

- [ ] Predict the document count after every stage — and know that `$lookup` never changes it while `$unwind` and `$group` do.
- [ ] Explain why `$match` goes first (index usage) and what changes when it goes after `$group`.
- [ ] State from memory that `$avg`, `$min`, `$max` skip nulls while `$sum: 1` does not.
- [ ] Recall that `$group` destroys every field you didn't explicitly accumulate.
- [ ] Never write a `$lookup` + `$unwind` without consciously deciding about `preserveNullAndEmptyArrays`.

**Next:** [Intermediate Practice →](./09-intermediate-aggregation.md)
