# MongoDB Aggregation Framework — Revision Notes

> Purpose:
>
> - Revise MongoDB aggregation concepts quickly
> - Recall _why_ each stage exists
> - Practice real-world aggregation patterns
> - Avoid common logical bugs (not just syntax)

---

## 1. What is Aggregation?

Aggregation in MongoDB is a **pipeline-based data transformation system**.

- Documents flow **stage by stage**
- Each stage:
  - takes input documents
  - transforms / filters / reshapes them
  - passes output to the next stage
- Stages are executed **in order**

### Mental model

Documents
↓
$match
↓
$project
↓
$group
↓
$sort
↓
Final Result

> Aggregation is **streaming** — MongoDB does not “look ahead” or “remember intent”.

---

## 2. Core Aggregation Stages (Level 1)

### `$match`

Filters documents.

```js
{
  $match: {
    status: "DELIVERED";
  }
}
```

- Works like `WHERE` in SQL
- Reduces data early → better performance
- Can appear **multiple times** in a pipeline

#### Rule

- Filter **as early as possible**
- Filter **again later** if filtering on aggregated fields

---

### `$project`

Reshapes documents.

```js
{
  $project: {
    _id: 0,
    orderId: "$_id",
    amount: 1,
    month: { $month: "$createdAt" }
  }
}
```

Used for:

- renaming fields
- computing new fields
- removing unwanted fields

---

### `$sort`

Orders documents.

```js
{
  $sort: {
    createdAt: -1;
  }
}
```

Important:

- `$sort` defines **which document is “first”**
- Extremely important before `$group + $first`

---

## 3. `$group` — The Most Important Stage

### What `$group` does

- Collapses **many documents into fewer documents**
- Destroys original document shape
- Everything you want after `$group` must be **explicitly reconstructed**

```js
{
  $group: {
    _id: "$userId",
    totalAmount: { $sum: "$amount" }
  }
}
```

### Key accumulators

| Operator        | Purpose                              |
| --------------- | ------------------------------------ |
| `$sum`          | totals / counts                      |
| `$avg`          | average                              |
| `$min` / `$max` | extremes                             |
| `$first`        | representative value (after sorting) |
| `$push`         | preserve multiple values             |
| `$addToSet`     | unique values                        |

---

## 4. `$first` — Correct Usage

### What `$first` actually means

> `$first` = first document **that enters the group**

It has **no business meaning by itself**.

### Correct pattern: “latest X”

```js
[
  { $sort: { createdAt: -1 } },
  {
    $group: {
      _id: "$userId",
      latestDate: { $first: "$createdAt" },
    },
  },
];
```

### Rule

> If `$first` encodes meaning (latest / earliest),
> **you must control order before `$group`**.

---

## 5. `$lookup` — Joining Collections

### Simple `$lookup`

```js
{
  $lookup: {
    from: "orders",
    localField: "_id",
    foreignField: "userId",
    as: "orders"
  }
}
```

- Brings **all matching documents**
- No filtering / sorting inside join

---

## 6. `$unwind` — Exploding Arrays

```js
{
  $unwind: "$orders";
}
```

Turns:

```js
orders: [ {...}, {...} ]
```

Into:

```js
orders: {...}
orders: {...}
```

---

### `preserveNullAndEmptyArrays`

```js
{
  $unwind: {
    path: "$orders",
    preserveNullAndEmptyArrays: true
  }
}
```

Behavior:

- User with no orders still produces **ONE document**
- `orders` becomes `null`

> This is MongoDB’s **LEFT JOIN** behavior.

---

## 7. The Placeholder Row Trap (VERY IMPORTANT)

After:

```js
$unwind + preserveNullAndEmptyArrays;
```

A user with no orders becomes:

```js
{
  orders: null;
}
```

### ❌ Wrong

```js
totalOrders: {
  $sum: 1;
}
```

This counts the placeholder row.

### ✅ Correct

```js
totalOrders: {
  $sum: {
    $cond: [{ $ne: ["$orders", null] }, 1, 0];
  }
}
```

---

## 8. Conditional Aggregation (`$cond`)

### `$cond` syntax (must remember)

```js
$cond: [ <condition>, <true>, <false> ]
```

### Example

```js
deliveredOrders: {
  $sum: {
    $cond: [{ $eq: ["$orders.status", "DELIVERED"] }, 1, 0];
  }
}
```

---

## 9. `$push` — Preserving Data

### Purpose

- Keep multiple documents per group
- Build arrays

```js
orders: {
  $push: {
    orderId: "$orders._id",
    amount: "$orders.amount",
    status: "$orders.status"
  }
}
```

### Ordering

> `$push` preserves **pipeline order**

So:

```js
$sort;
$group + $push;
```

---

## 10. `$$REMOVE` — Skipping Pushes

### What `$$REMOVE` does

> Tells MongoDB: **“add nothing”**

It does **not**:

- delete existing elements
- clean arrays

### Correct pattern with `$push`

```js
orders: {
  $push: {
    $cond: [{ $ne: ["$orders", null] }, { orderId: "$orders._id" }, "$$REMOVE"];
  }
}
```

### Result

- User with no orders → `orders: []`
- No fake `{ null }` entries

---

## 11. Root Preservation (Advanced)

### Problem

`$group` destroys document shape.

### Solution

- Capture full document with `$$ROOT`
- Restore it using `$replaceRoot`

---

### Canonical Pattern: Latest document per group

```js
[
  { $sort: { createdAt: -1 } },
  {
    $group: {
      _id: "$userId",
      doc: { $first: "$$ROOT" },
    },
  },
  {
    $replaceRoot: { newRoot: "$doc" },
  },
];
```

---

## 12. `$mergeObjects` — Enriching Root

Used when you want:

- original document
- plus computed fields

```js
{
  $replaceRoot: {
    newRoot: {
      $mergeObjects: ["$order", { userName: "$userName", city: "$city" }];
    }
  }
}
```

> Order matters: later objects overwrite earlier ones.

---

## 13. Filtering Before vs After `$group`

### Two types of `$match`

#### 1. Order-level filtering (before `$group`)

```js
$match: { "orders.status": "DELIVERED" }
```

#### 2. Aggregate-level filtering (after `$group`)

```js
$match: {
  totalDeliveredAmount: {
    $gt: 1000;
  }
}
```

> `$group` is a **one-way door**.

---

## 14. Why `$match` Before `$sort` (with `$first`)

### Key idea

- `$match` defines **eligibility**
- `$sort` defines **priority**
- `$first` depends on both

### Safe pattern

```js
$match (DELIVERED)
$sort (createdAt desc)
$group ($first)
```

This guarantees correctness even if pipeline evolves.

---

## 15. Pipeline `$lookup` (Production Pattern)

### Why use it

- Filter early
- Reduce memory
- Avoid placeholder rows
- Safer `$first` logic

---

### Syntax

```js
$lookup: {
  from: "orders",
  let: { userId: "$_id" },
  pipeline: [
    {
      $match: {
        $expr: {
          $and: [
            { $eq: ["$userId", "$$userId"] },
            { $eq: ["$status", "DELIVERED"] }
          ]
        }
      }
    }
  ],
  as: "deliveredOrders"
}
```

---

## 16. Practice Questions

### Q1

For each user:

- total delivered amount
- delivered order count

---

### Q2

For each user:

- totalOrders
- deliveredOrders
- cancelledOrders
  (including users with zero orders)

---

### Q3

For each user:

- orders array sorted by `createdAt DESC`
- no fake null orders

---

### Q4

For each user:

- return **latest order document**
- include user name and city

---

### Q5

Return users where:

- total delivered amount > 1000
- include latest delivered order date

---

### Q6 (Advanced)

Rewrite Q5 using **pipeline `$lookup`**
(no unwind-first approach)

---

## 17. Final Mental Rules (Must Remember)

- `$group` destroys shape — always reconstruct
- `$first` depends on pipeline order
- `$match` before `$group` filters documents
- `$match` after `$group` filters aggregates
- `$push` builds arrays
- `$$REMOVE` skips building
- Pipeline `$lookup` = production-grade joins

---
