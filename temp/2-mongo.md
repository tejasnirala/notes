## Sample Collections (Used in ALL Questions)

### `users`

```js
[
  { _id: "U1", name: "Alice", city: "Bangalore" },
  { _id: "U2", name: "Bob", city: "Delhi" },
  { _id: "U3", name: "Charlie", city: "Bangalore" },
];
```

### `orders`

```js
[
  {
    _id: 1,
    userId: "U1",
    amount: 500,
    status: "DELIVERED",
    createdAt: ISODate("2024-01-10"),
  },
  {
    _id: 2,
    userId: "U1",
    amount: 300,
    status: "CANCELLED",
    createdAt: ISODate("2024-01-12"),
  },
  {
    _id: 3,
    userId: "U1",
    amount: 700,
    status: "DELIVERED",
    createdAt: ISODate("2024-02-01"),
  },
  {
    _id: 4,
    userId: "U2",
    amount: 1000,
    status: "DELIVERED",
    createdAt: ISODate("2024-01-15"),
  },
  {
    _id: 5,
    userId: "U2",
    amount: 400,
    status: "DELIVERED",
    createdAt: ISODate("2024-02-05"),
  },
];
```

---

## Question 1 — Basic Join + Group

### Problem

For each user, return:

- `userId`
- `name`
- `totalDeliveredAmount`
- `deliveredOrderCount`

Only include users who have **at least one delivered order**.

---

### Solution

```js
db.users.aggregate([
  {
    $lookup: {
      from: "orders",
      localField: "_id",
      foreignField: "userId",
      as: "orders",
    },
  },
  { $unwind: "$orders" },
  { $match: { "orders.status": "DELIVERED" } },
  {
    $group: {
      _id: "$_id",
      name: { $first: "$name" },
      totalDeliveredAmount: { $sum: "$orders.amount" },
      deliveredOrderCount: { $sum: 1 },
    },
  },
  {
    $project: {
      _id: 0,
      userId: "$_id",
      name: 1,
      totalDeliveredAmount: 1,
      deliveredOrderCount: 1,
    },
  },
]);
```

---

## Question 2 — Conditional Grouping (Including Zero Orders)

### Problem

For each user, return:

- `totalOrders`
- `deliveredOrders`
- `cancelledOrders`

Users with **no orders must still appear** with zero counts.

---

### Solution

```js
db.users.aggregate([
  {
    $lookup: {
      from: "orders",
      localField: "_id",
      foreignField: "userId",
      as: "orders",
    },
  },
  {
    $unwind: {
      path: "$orders",
      preserveNullAndEmptyArrays: true,
    },
  },
  {
    $group: {
      _id: "$_id",
      name: { $first: "$name" },

      totalOrders: {
        $sum: {
          $cond: [{ $ne: ["$orders", null] }, 1, 0],
        },
      },

      deliveredOrders: {
        $sum: {
          $cond: [{ $eq: ["$orders.status", "DELIVERED"] }, 1, 0],
        },
      },

      cancelledOrders: {
        $sum: {
          $cond: [{ $eq: ["$orders.status", "CANCELLED"] }, 1, 0],
        },
      },
    },
  },
  {
    $project: {
      _id: 0,
      userId: "$_id",
      name: 1,
      totalOrders: 1,
      deliveredOrders: 1,
      cancelledOrders: 1,
    },
  },
]);
```

---

## Question 3 — Preservation Using `$push`

### Problem

For each user, return:

```js
{
  userId,
  name,
  orders: [
    { orderId, amount, status }
  ]
}
```

Rules:

- Orders must be sorted by `createdAt DESC`
- Users with **no orders** should have `orders: []`

---

### Solution

```js
db.users.aggregate([
  {
    $lookup: {
      from: "orders",
      localField: "_id",
      foreignField: "userId",
      as: "orders",
    },
  },
  {
    $unwind: {
      path: "$orders",
      preserveNullAndEmptyArrays: true,
    },
  },
  { $sort: { "orders.createdAt": -1 } },
  {
    $group: {
      _id: "$_id",
      name: { $first: "$name" },
      orders: {
        $push: {
          $cond: [
            { $ne: ["$orders", null] },
            {
              orderId: "$orders._id",
              amount: "$orders.amount",
              status: "$orders.status",
            },
            "$$REMOVE",
          ],
        },
      },
    },
  },
  {
    $project: {
      _id: 0,
      userId: "$_id",
      name: 1,
      orders: 1,
    },
  },
]);
```

---

## Question 4 — Root Preservation (Latest Order per User)

### Problem

For each user, return **only their latest order document**, enriched with:

- `userName`
- `city`

---

### Solution

```js
db.users.aggregate([
  {
    $lookup: {
      from: "orders",
      localField: "_id",
      foreignField: "userId",
      as: "orders",
    },
  },
  { $unwind: "$orders" },
  { $sort: { "orders.createdAt": -1 } },
  {
    $group: {
      _id: "$_id",
      userName: { $first: "$name" },
      city: { $first: "$city" },
      order: { $first: "$$ROOT" },
    },
  },
  {
    $replaceRoot: {
      newRoot: {
        $mergeObjects: ["$order", { userName: "$userName", city: "$city" }],
      },
    },
  },
]);
```

---

## Question 5 — Post-Group Filtering (Analytics Pattern)

### Problem

Return users where:

- `totalDeliveredAmount > 1000`

Include:

- `userId`
- `name`
- `totalDeliveredAmount`
- `latestDeliveredOrderDate`

---

### Solution

```js
db.users.aggregate([
  {
    $lookup: {
      from: "orders",
      localField: "_id",
      foreignField: "userId",
      as: "orders",
    },
  },
  { $unwind: "$orders" },
  { $match: { "orders.status": "DELIVERED" } },
  { $sort: { "orders.createdAt": -1 } },
  {
    $group: {
      _id: "$_id",
      name: { $first: "$name" },
      totalDeliveredAmount: { $sum: "$orders.amount" },
      latestDeliveredOrderDate: { $first: "$orders.createdAt" },
    },
  },
  {
    $match: {
      totalDeliveredAmount: { $gt: 1000 },
    },
  },
  {
    $project: {
      _id: 0,
      userId: "$_id",
      name: 1,
      totalDeliveredAmount: 1,
      latestDeliveredOrderDate: 1,
    },
  },
]);
```

---

## Question 6 — Pipeline `$lookup` (Production Pattern)

### Problem

Rewrite Question 5 using **pipeline `$lookup`** so that:

- Only delivered orders are joined
- No unwind-first pattern is used

---

### Solution

```js
db.users.aggregate([
  {
    $lookup: {
      from: "orders",
      let: { userId: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$userId", "$$userId"] },
                { $eq: ["$status", "DELIVERED"] },
              ],
            },
          },
        },
      ],
      as: "deliveredOrders",
    },
  },
  { $unwind: "$deliveredOrders" },
  { $sort: { "deliveredOrders.createdAt": -1 } },
  {
    $group: {
      _id: "$_id",
      name: { $first: "$name" },
      totalDeliveredAmount: { $sum: "$deliveredOrders.amount" },
      latestDeliveredOrderDate: {
        $first: "$deliveredOrders.createdAt",
      },
    },
  },
  {
    $match: {
      totalDeliveredAmount: { $gt: 1000 },
    },
  },
  {
    $project: {
      _id: 0,
      userId: "$_id",
      name: 1,
      totalDeliveredAmount: 1,
      latestDeliveredOrderDate: 1,
    },
  },
]);
```

---

## Final Revision Checklist

- `$group` destroys shape — always rebuild
- `$first` depends on **pipeline order**
- `$match` before `$group` → filters documents
- `$match` after `$group` → filters aggregates
- `$push` builds arrays
- `$$REMOVE` skips building
- Pipeline `$lookup` = production-grade joins

---

# MongoDB Aggregation — Additional Practice Set (With Solutions)

> These questions reinforce the same concepts:
> `$lookup`, `$unwind`, `$match`, `$group`, `$project`,
> `$push`, `$first`, `$replaceRoot`, `$mergeObjects`,
> pipeline `$lookup`, post-group filtering

But each question introduces a **new angle**.

---

## Common Collections (Used in All Questions)

### `users`

```js
[
  { _id: "U1", name: "Alice", city: "Bangalore", tier: "GOLD" },
  { _id: "U2", name: "Bob", city: "Delhi", tier: "SILVER" },
  { _id: "U3", name: "Charlie", city: "Mumbai", tier: "GOLD" },
  { _id: "U4", name: "Diana", city: "Delhi", tier: "BRONZE" },
];
```

### `orders`

```js
[
  {
    _id: 1,
    userId: "U1",
    amount: 500,
    status: "DELIVERED",
    createdAt: ISODate("2024-01-10"),
  },
  {
    _id: 2,
    userId: "U1",
    amount: 300,
    status: "CANCELLED",
    createdAt: ISODate("2024-01-12"),
  },
  {
    _id: 3,
    userId: "U1",
    amount: 700,
    status: "DELIVERED",
    createdAt: ISODate("2024-02-01"),
  },

  {
    _id: 4,
    userId: "U2",
    amount: 400,
    status: "DELIVERED",
    createdAt: ISODate("2024-01-15"),
  },

  {
    _id: 5,
    userId: "U3",
    amount: 1200,
    status: "DELIVERED",
    createdAt: ISODate("2024-02-10"),
  },

  {
    _id: 6,
    userId: "U4",
    amount: 200,
    status: "CANCELLED",
    createdAt: ISODate("2024-02-05"),
  },
];
```

---

## Question 7 — City-level Analytics (Grouping on Joined Data)

### ❓ Problem

For each **city**, return:

- `city`
- `totalDeliveredAmount`
- `deliveredOrderCount`

Only count **DELIVERED** orders.

---

### ✅ Solution

```js
db.users.aggregate([
  {
    $lookup: {
      from: "orders",
      localField: "_id",
      foreignField: "userId",
      as: "orders",
    },
  },
  { $unwind: "$orders" },
  { $match: { "orders.status": "DELIVERED" } },
  {
    $group: {
      _id: "$city",
      totalDeliveredAmount: { $sum: "$orders.amount" },
      deliveredOrderCount: { $sum: 1 },
    },
  },
  {
    $project: {
      _id: 0,
      city: "$_id",
      totalDeliveredAmount: 1,
      deliveredOrderCount: 1,
    },
  },
]);
```

---

## Question 8 — Latest Order Per City (Root Preservation)

### ❓ Problem

For each **city**, return the **latest order document** (any status),
including:

- order fields
- `userName`
- `city`

---

### ✅ Solution

```js
db.users.aggregate([
  {
    $lookup: {
      from: "orders",
      localField: "_id",
      foreignField: "userId",
      as: "orders",
    },
  },
  { $unwind: "$orders" },
  { $sort: { "orders.createdAt": -1 } },
  {
    $group: {
      _id: "$city",
      userName: { $first: "$name" },
      city: { $first: "$city" },
      order: { $first: "$$ROOT" },
    },
  },
  {
    $replaceRoot: {
      newRoot: {
        $mergeObjects: ["$order", { userName: "$userName", city: "$city" }],
      },
    },
  },
]);
```

---

## Question 9 — Users With Mixed Order Status (Conditional Grouping)

### ❓ Problem

Return users who:

- have **at least one DELIVERED**
- and **at least one CANCELLED** order

Include:

- `userId`
- `name`
- `deliveredCount`
- `cancelledCount`

---

### ✅ Solution

```js
db.users.aggregate([
  {
    $lookup: {
      from: "orders",
      localField: "_id",
      foreignField: "userId",
      as: "orders",
    },
  },
  { $unwind: "$orders" },
  {
    $group: {
      _id: "$_id",
      name: { $first: "$name" },

      deliveredCount: {
        $sum: {
          $cond: [{ $eq: ["$orders.status", "DELIVERED"] }, 1, 0],
        },
      },

      cancelledCount: {
        $sum: {
          $cond: [{ $eq: ["$orders.status", "CANCELLED"] }, 1, 0],
        },
      },
    },
  },
  {
    $match: {
      deliveredCount: { $gt: 0 },
      cancelledCount: { $gt: 0 },
    },
  },
  {
    $project: {
      _id: 0,
      userId: "$_id",
      name: 1,
      deliveredCount: 1,
      cancelledCount: 1,
    },
  },
]);
```

---

## Question 10 — GOLD Tier Users Order Summary (Pipeline `$lookup`)

### ❓ Problem

For **GOLD tier users only**, return:

- `userId`
- `name`
- `totalDeliveredAmount`
- `latestDeliveredOrderDate`

Use **pipeline `$lookup`**
Do **not** join cancelled orders.

---

### ✅ Solution

```js
db.users.aggregate([
  { $match: { tier: "GOLD" } },
  {
    $lookup: {
      from: "orders",
      let: { userId: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$userId", "$$userId"] },
                { $eq: ["$status", "DELIVERED"] },
              ],
            },
          },
        },
      ],
      as: "deliveredOrders",
    },
  },
  { $unwind: "$deliveredOrders" },
  { $sort: { "deliveredOrders.createdAt": -1 } },
  {
    $group: {
      _id: "$_id",
      name: { $first: "$name" },
      totalDeliveredAmount: { $sum: "$deliveredOrders.amount" },
      latestDeliveredOrderDate: {
        $first: "$deliveredOrders.createdAt",
      },
    },
  },
  {
    $project: {
      _id: 0,
      userId: "$_id",
      name: 1,
      totalDeliveredAmount: 1,
      latestDeliveredOrderDate: 1,
    },
  },
]);
```

---

## Question 11 — Order History With Derived Flags (Preservation + Computation)

### ❓ Problem

For each user, return:

```js
{
  userId,
  name,
  orders: [
    {
      orderId,
      amount,
      status,
      isHighValue  // amount > 500
    }
  ]
}
```

Orders should be sorted by `createdAt DESC`.

---

### ✅ Solution

```js
db.users.aggregate([
  {
    $lookup: {
      from: "orders",
      localField: "_id",
      foreignField: "userId",
      as: "orders",
    },
  },
  {
    $unwind: {
      path: "$orders",
      preserveNullAndEmptyArrays: true,
    },
  },
  { $sort: { "orders.createdAt": -1 } },
  {
    $group: {
      _id: "$_id",
      name: { $first: "$name" },
      orders: {
        $push: {
          $cond: [
            { $ne: ["$orders", null] },
            {
              orderId: "$orders._id",
              amount: "$orders.amount",
              status: "$orders.status",
              isHighValue: {
                $gt: ["$orders.amount", 500],
              },
            },
            "$$REMOVE",
          ],
        },
      },
    },
  },
  {
    $project: {
      _id: 0,
      userId: "$_id",
      name: 1,
      orders: 1,
    },
  },
]);
```
