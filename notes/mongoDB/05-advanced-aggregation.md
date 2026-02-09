# Advanced Aggregation Scenarios

> **Purpose**: Solve complex business problems using advanced operators and optimization techniques.
>
> **Focus**: `$lookup` (pipeline), `$setWindowFields`, `$unionWith`, and Complex Reshaping.

---

## Topic: Filtering & Projection (Complex)

### Question 21: Root Preservation (Latest Order per User)

Each user can have multiple orders.

For every user who has placed at least one order, return their most recent order, enriched with basic user details such as name and city.
The final output should resemble a single order document, not a nested user structure.
<details>
  <summary>**Solution**</summary>

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
      latestOrder: { $first: "$$ROOT" }, // Capture everything
    },
  },
  {
    $replaceRoot: {
      newRoot: {
        $mergeObjects: [
          "$latestOrder",
          { userName: "$userName", city: "$city" },
        ],
      },
    },
  },
]);
```

</details>

### Question 22: Preservation Using `$push`

You are working with users and their associated orders.

For each user, return their details along with a list of all their orders, sorted by most recent first.
Users who have not placed any orders should still appear in the result, and their orders field should be an empty array, not [null].

<details>
  <summary>**Solution**</summary>

```jsx
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
    $unwind: { path: "$orders", preserveNullAndEmptyArrays: true },
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
            { orderId: "$orders._id", amount: "$orders.amount" },
            "$$REMOVE", // Magic: adds nothing to the array if condition false
          ],
        },
      },
    },
  },
]);
```
</details>

### Question 23: Challenge 4: Movies by Decade

You are given a movies collection where each document represents a movie along with its release year and rating.

For each decade (for example, 1980s, 1990s, 2000s, etc.), identify the highest-rated movie released during that decade.
For every decade, return:

- the decade
- the movie title
- the movie rating

Each decade should appear only once in the final result.

💡 Bonus: How would your solution handle multiple movies having the same highest rating within a decade?

<details>
  <summary>**Solution**</summary>

```jsx
db.movies.aggregate([
  // 1️⃣ Derive the decade from releaseYear
  {
    $addFields: {
      decade: {
        $concat: [
          {
            $toString: {
              $multiply: [{ $floor: { $divide: ["$releaseYear", 10] } }, 10],
            },
          },
          "s",
        ],
      },
    },
  },

  // 2️⃣ Sort by rating descending (crucial for $first)
  {
    $sort: { rating: -1 },
  },

  // 3️⃣ Pick the top-rated movie per decade
  {
    $group: {
      _id: "$decade",
      title: { $first: "$title" },
      rating: { $first: "$rating" },
    },
  },

  // 4️⃣ Shape the final output
  {
    $project: {
      _id: 0,
      decade: "$_id",
      title: 1,
      rating: 1,
    },
  },

  // 5️⃣ Optional: sort decades chronologically
  {
    $sort: { decade: 1 },
  },
]);
```

</details>

## Topic: Grouping & Aggregation

### Question 24: Conditional Grouping (Including Zero Orders)

You are given a users collection and an orders collection.
Each user may have placed multiple orders, or no orders at all.
For every user, return a summary that includes:

- total number of orders placed
- number of delivered orders
- number of cancelled orders

All users must appear in the result, including users who have never placed an order.

<details>
  <summary>**Solution**</summary>

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
    $unwind: { path: "$orders", preserveNullAndEmptyArrays: true },
  },
  {
    $group: {
      _id: "$_id",
      name: { $first: "$name" },
      totalOrders: {
        $sum: { $cond: [{ $ne: ["$orders", null] }, 1, 0] },
      },
      deliveredOrders: {
        $sum: { $cond: [{ $eq: ["$orders.status", "DELIVERED"] }, 1, 0] },
      },
      cancelledOrders: {
        $sum: { $cond: [{ $eq: ["$orders.status", "CANCELLED"] }, 1, 0] },
      },
    },
  },
]);
```

</details>

### Question 25: Challenge 3: Top N per Group

You are working with a students collection where each document represents a student and contains an array of grades.
Each grade includes a subject name and the score obtained in that subject.

For each subject, identify the student who achieved the highest score.

For every subject, return:

- the subject name
- the highest score achieved
- the name of the student who achieved that score

Assume:

- a student can have grades in multiple subjects
- multiple students can appear in the same subject

💡 Bonus: How would your solution behave if two students have the same highest score in a subject?

<details>
  <summary>**Solution**</summary>

```js
db.students.aggregate([
  { $unwind: "$grades" },
  { $sort: { "grades.score": -1 } }, // Crucial Step!
  {
    $group: {
      _id: "$grades.subject",
      name: { $first: "$name" },
      topScore: { $first: "$grades.score" },
    },
  },
]);
```

</details>

### Question 26: Challenge 5: Top Student per Object

You are given a students collection where each document represents a student.
Each student has a grades array containing the subjects they took and the scores they achieved.

For each subject, identify the student who achieved the highest score in that subject.
The final result should contain:

- the subject name
- the student’s name
- the highest score achieved for that subject

Each subject should appear only once in the output.

💡 Bonus: How would your approach change if multiple students share the same highest score in a subject?

<details>
  <summary>**Solution**</summary>

```jsx
db.students.aggregate([
  {
    $unwind: '$grades'
  },
  {
    $sort: { '$grades.score': -1 }
  },
  {
    $group: {
      _id: '$grades.subject',
      name: {$first: '$name'}
      topScore: {$first: '$grades.score'}
    }
  },
  {
    $project: {
      subject: '_id',
      name: 1,
      topScore: 1,
      _id: 0
    }
  }
])
```

</details>

## Topic: Joins & Relationships

### Question 27: Pipeline `$lookup` (Production Pattern)

You need to analyze user spending, but only for delivered orders.

Identify users whose total delivered order amount exceeds 1000.
The solution should be efficient and avoid loading unnecessary order data during the join.

<details>
  <summary>**Solution**</summary>

```js
db.users.aggregate([
  {
    $lookup: {
      from: "orders",
      let: { userId: "$_id" }, // Define variable
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$userId", "$$userId"] }, // Join condition
                { $eq: ["$status", "DELIVERED"] }, // Filter condition
              ],
            },
          },
        },
      ],
      as: "deliveredOrders",
    },
  },
  { $unwind: "$deliveredOrders" },
  {
    $group: {
      _id: "$_id",
      totalDeliveredAmount: { $sum: "$deliveredOrders.amount" },
    },
  },
  {
    $match: { totalDeliveredAmount: { $gt: 1000 } }, // Post-aggregation filter
  },
]);
```

</details>

### Question 28: City-level Analytics

Users belong to different cities and place orders over time.

For each city, calculate the total amount generated from delivered orders only.
Each city should appear once in the result along with its total delivered revenue.

<details>
  <summary>**Solution**</summary>

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
      _id: "$city", // Group by City instead of User ID
      totalAmount: { $sum: "$orders.amount" },
    },
  },
]);
```

</details>

### Question 29: Complex Use Case

You are given two collections:

- students, which stores basic student information
- scores, which stores subject-wise scores for each student

Each student can have scores in multiple subjects.

For every subject, identify the student who achieved the highest score in that subject.

For each subject, return:

- the subject name
- the highest score achieved
- the name of the student who achieved that score

Assume that:

- multiple students can appear across different subjects
- each score document represents one student’s score in one subject

💡 Bonus: Based on the sample data, what would the final output look like?

```json
// students
[
  { "studentId": "S001", "name": "Alice", "age": 20 },
  { "studentId": "S002", "name": "Bob", "age": 22 }
]

// scores
[
  { "studentId": "S001", "subject": "Math", "score": 95 },
  { "studentId": "S001", "subject": "English", "score": 88 },
  { "studentId": "S002", "subject": "Math", "score": 78 },
  { "studentId": "S002", "subject": "English", "score": 92 }
]
```

<details>
  <summary>**Solution**</summary>

```jsx
db.scores.aggregate([
  {
    $sort: { score: -1 },
  },
  {
    $group: {
      _id: "$subject",
      topScore: { $first: "$score" },
      studentId: { $first: "$studentId" },
    },
  },
  {
    $lookup: {
      from: "students",
      localField: "studentId",
      foreignField: "studentId",
      as: "studentDetails",
    },
  },
  { $unwind: "$studentDetails" },
  {
    $project: {
      subject: "$_id",
      topScore: 1,
      studentName: "$studentDetails.name",
    },
  },
]);
```

</details>

## Topic: Advanced Array Aggregation

### Question 30: Calculating Values Using `$reduce`

You are given an `orders` collection where each order contains an array of items.
Each item includes:

- quantity
- price

For each order, calculate the **total cart value** by summing `(quantity × price)` for all items.

Return:

- orderId
- totalCartValue

<details>
  <summary>**Solution**</summary>

```js
db.orders.aggregate([
  {
    $project: {
      orderId: 1,
      totalCartValue: {
        $reduce: {
          input: "$items",
          initialValue: 0,
          in: {
            $add: [
              "$$value",
              { $multiply: ["$$this.quantity", "$$this.price"] },
            ],
          },
        },
      },
    },
  },
]);
```

</details>

## Topic: Analytics & Ranking

### Question 31: Ranking Users Using `$setWindowFields`

You are given an `orders` collection containing:

- userId
- totalAmount
- city

Rank users **within each city** based on their total spending.
Return:

- userId
- city
- total spending
- rank within city

<details>
  <summary>**Solution**</summary>

```js
db.orders.aggregate([
  {
    $group: {
      _id: { city: "$city", userId: "$userId" },
      totalSpent: { $sum: "$totalAmount" },
    },
  },
  {
    $setWindowFields: {
      partitionBy: "$_id.city",
      sortBy: { totalSpent: -1 },
      output: {
        rank: { $rank: {} },
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
    },
  },
]);
```

</details>

## Topic: Multi-Collection Analytics

### Question 32: Merging Data Using `$unionWith`

You are given two collections:

- `onlineOrders`
- `offlineOrders`

Both collections store orders with:

- orderId
- amount

Generate a unified revenue report showing:

- total number of orders
- total revenue across both collections

<details>
  <summary>**Solution**</summary>

```js
db.onlineOrders.aggregate([
  {
    $unionWith: {
      coll: "offlineOrders",
    },
  },
  {
    $group: {
      _id: null,
      totalOrders: { $sum: 1 },
      totalRevenue: { $sum: "$amount" },
    },
  },
  {
    $project: {
      _id: 0,
      totalOrders: 1,
      totalRevenue: 1,
    },
  },
]);
```

</details>
