# Intermediate Aggregation Scenarios

> **Purpose**: Master multi-stage transformations and analytical grouping.
>
> **Focus**: `$bucket`, `$facet`, `$filter`, `$map`, `$size`.

---

## Topic: Filtering & Projection

### Question 9: Filtering Aggregates

You are given an employees collection where each document represents an employee with a department and salary.

Your task is to:

- Calculate the average salary per department
- Return only those departments whose average salary exceeds 50,000

Requirements

For each qualifying department, return:

- department name
- average salary

Each department should appear only once in the result.

Bonus

- Why does applying $match after $group produce a different result than filtering employees before grouping?

<details>
  <summary>**Solution**</summary>

```jsx
db.employees.aggregate([
  {
    $group: {
      _id: "$department",
      avg_salary: { $avg: "$salary" },
    },
  },
  {
    $match: {
      avg_salary: { $gt: 50000 },
    },
  },
  {
    $project: {
      _id: 0,
      department: "$_id",
      avg_salary: 1,
    },
  },
]);
```

</details>

## Topic: Grouping & Aggregation

### Question 10: Bucketing (`$bucket`)

You are given a transactions collection where each document represents a financial transaction and contains the transaction amount.

Analyze the transactions by grouping them into amount-based ranges (for example: low-value, medium-value, high-value transactions).

For each range, return:

- the number of transactions that fall into that range
- the transactions belonging to that range

The result should clearly show how transactions are distributed across different amount ranges.

💡 Bonus: How would your approach change if the ranges were not predefined and needed to be generated dynamically?

```json
[
  { "transactionId": 1, "amount": 50 },
  { "transactionId": 2, "amount": 120 },
  { "transactionId": 3, "amount": 350 },
  { "transactionId": 4, "amount": 600 },
  { "transactionId": 5, "amount": 950 },
  { "transactionId": 6, "amount": 1500 }
]
```


:::note[Expected Output]

```json
[
  {
    "_id": 0,
    "totalTransactions": 1,
    "transactions": [{ "transactionId": 1, "amount": 50 }]
  },
  {
    "_id": 100,
    "totalTransactions": 2,
    "transactions": [
      { "transactionId": 2, "amount": 120 },
      { "transactionId": 3, "amount": 350 }
    ]
  },
  {
    "_id": 500,
    "totalTransactions": 2,
    "transactions": [
      { "transactionId": 4, "amount": 600 },
      { "transactionId": 5, "amount": 950 }
    ]
  },
  {
    "_id": "1000+",
    "totalTransactions": 1,
    "transactions": [{ "transactionId": 6, "amount": 1500 }]
  }
]
```

:::

<details>
  <summary>**Solution**</summary>

```js
db.transactions.aggregate([
  {
    $bucket: {
      groupBy: "$amount",
      boundaries: [0, 100, 500, 1000],
      default: "1000+",
      output: {
        totalTransactions: { $sum: 1 },
        transactions: { $push: "$$ROOT" },
      },
    },
  },
]);
```

</details>

### Question 11: Parallel Analysis (`$facet`)

You are working with a movies collection containing movie titles, genres, and ratings.

Create a single aggregation query that returns:

- The top 5 highest-rated movies
- A count of movies per genre

Both results must be returned together in one response, without running multiple queries.

Bonus

- Why is $facet preferred over running two separate aggregation queries?
- In what scenarios could $facet become expensive?

<details>
  <summary>**Solution**</summary>

```jsx
db.movies.aggregate([
  {
    $facet: {
      topRatedMovies: [
        { $sort: { rating: -1 } },
        { $limit: 5 },
        { $project: { _id: 0, title: 1, rating: 1 } },
      ],
      moviesByGenre: [{ $group: { _id: "$genre", count: { $sum: 1 } } }],
    },
  },
]);
```

</details>

### Question 12: Category Insights

You are working with a products collection where each document represents a product along with its category, price, and available stock.

Using the products collection, generate a summary that shows category-level insights.
For each product category, compute:

- the average price of products in that category
- the total stock available for that category

The result should list categories ordered by total stock from highest to lowest.

Only include the following fields in the final output:

- category name
- average price (rounded to 2 decimal places)
- total stock

📢 **Bonus:** Based on the sample data below, what would the resulting output look like?

```json
[
  { "productId": "P1", "category": "Electronics", "price": 1200, "stock": 30 },
  { "productId": "P2", "category": "Electronics", "price": 800, "stock": 50 },
  { "productId": "P3", "category": "Furniture", "price": 350, "stock": 15 },
  { "productId": "P4", "category": "Furniture", "price": 700, "stock": 20 },
  { "productId": "P5", "category": "Books", "price": 25, "stock": 100 },
  { "productId": "P6", "category": "Books", "price": 40, "stock": 60 }
]
```

<details>
  <summary>**Solution**</summary>

```jsx
db.products.aggregate([
  {
    $group: {
      _id: "$category",
      avg_price: { $avg: "$price" },
      total_stock: { $sum: "$stock" },
    },
  },
  {
    $sort: { total_stock: -1 },
  },
  {
    $project: {
      category_name: "$_id",
      avg_price: { $round: ["$avg_price", 2] },
      total_stock: 1,
      _id: 0,
    },
  },
]);
```

</details>

## Topic: Joins & Relationships

### Question 13: Derived Counts (`$size`)

You are given two collections:

- posts, which stores blog posts
- comments, which stores comments made on those posts

Each comment is associated with a post using postId.
For each post, return the post title along with the total number of comments made on that post.
All posts should be included in the result, even if a post has no comments.

💡 Bonus: How would the result change if you needed to return only posts with at least one comment?

```json
// posts
[
  { "postId": 1, "title": "MongoDB Basics", "author": "Alice" },
  { "postId": 2, "title": "Advanced Aggregations", "author": "Bob" },
  { "postId": 3, "title": "Indexing Deep Dive", "author": "Charlie" },
]

// comments
[
  { "commentId": 101, "postId": 1, "commenter": "Tom", "content": "Great explanation!" },
  { "commentId": 102, "postId": 1, "commenter": "Jerry", "content": "Very helpful." },
  { "commentId": 103, "postId": 2, "commenter": "Anna", "content": "Nice examples." },
]
```

:::note[Expected Output]

```json
[
  { "title": "MongoDB Basics", "totalComments": 2 },
  { "title": "Advanced Aggregations", "totalComments": 1 },
  { "title": "Indexing Deep Dive", "totalComments": 0 },
]
```

:::

<details>
  <summary>**Solution**</summary>

```js
db.posts.aggregate([
  {
    $lookup: {
      from: "comments",
      localField: "postId",
      foreignField: "postId",
      as: "postComments",
    },
  },
  {
    $project: {
      title: 1,
      totalComments: { $size: "$postComments" }, // Count array length
    },
  },
]);
```

</details>


### Question 14: `$match`, `$lookup`, `$unwind`, `$group`

You are given two collections:

- posts, which stores blog posts
- comments, which stores comments made on those posts

Each comment is associated with a post using the postId.
For every post, generate a summary that shows:

- the post title
- the total number of comments made on that post

The result should include all posts, even if a post has no comments.

💡 Bonus: Based on the sample data below, what would the expected output look like?

```json
// posts
[
  { "postId": 1, "title": "MongoDB Basics", "authorId": "A1" },
  { "postId": 2, "title": "Advanced Aggregations", "authorId": "A2" }
]

// comments
[
  { "commentId": 101, "postId": 1, "commenterName": "Alice", "content": "Great post!" },
  { "commentId": 102, "postId": 1, "commenterName": "Bob", "content": "Thanks for sharing." },
  { "commentId": 103, "postId": 2, "commenterName": "Charlie", "content": "Very informative!" }
]
```

<details>
  <summary>**Solution**</summary>

```jsx
db.posts.aggregate([
  {
    $lookup: {
      from: "comments",
      localField: "postId",
      foreignField: "postId",
      as: "postComments",
    },
  },
  {
    $project: {
      title: 1,
      totalComments: { $size: "$postComments" },
    },
  },
]);
```

</details>

### Question 15: Challenge 1: Unwind & Sort

You are given an orders collection where each order contains an array of items.
Each item includes:

- productId
- quantity

Your task is to:

- Calculate the total quantity sold for each product
- Return the products ordered from most sold to least sold

Requirements

The final output should include:

- productId
- total quantity sold

Each product should appear only once in the result.

Bonus

- How would you return only the top 3 best-selling products?

<details>
  <summary>**Solution**</summary>

```jsx
db.orders.aggregate([
  { $unwind: "$items" },
  {
    $group: {
      _id: "$items.productId",
      totalQuantitySold: { $sum: "$items.quantity" },
    },
  },
  { $sort: { totalQuantitySold: -1 } },
  {
    $project: {
      _id: 0,
      productId: "$_id",
      totalQuantitySold: 1,
    },
  },
]);
```

</details>

### Question 16: Challenge 1: Top 3 Borrowed Authors

You are given a library collection where each document represents a book.
Each book has an associated author and a count indicating how many times it has been borrowed.

Determine the top 3 authors whose books have been borrowed the most overall.
For each author, calculate the total number of times their books have been borrowed, and return only the top three authors based on this total.
The final result should include:

- the author’s name
- the total borrow count across all their books

Each author should appear only once in the output.

💡 Bonus: How would your solution change if you needed the top 3 authors per genre instead?

<details>
  <summary>**Solution**</summary>

```jsx
db.library.aggregate([
  {
    $group: {
      _id: "$author",
      borrowed_count: { $sum: "$borrowedCount" },
    },
  },
  {
    $sort: { borrowed_count: -1 },
  },
  {
    $limit: 3,
  },
  {
    $project: {
      _id: 0,
      author: "$_id",
      borrowed_count: 1,
    },
  },
]);
```

</details>

### Question 17: Challenge 3: Customer Total Revenue

You are given an orders collection where each order belongs to a customer and contains a list of purchased items.
Each item includes the product identifier, quantity purchased, and price per unit.

For each customer, calculate the total revenue generated across all their orders.
The total revenue for a customer should be computed as the sum of (quantity × price) for every item they have purchased.

The final result should include:

- the customer identifier
- the total revenue generated by that customer

Each customer should appear only once in the output.

💡 Bonus: How would your solution change if you needed to calculate revenue only for a specific date range?

<details>
  <summary>**Solution**</summary>

```jsx
db.orders.aggregate([
  {
    $unwind: "$items",
  },
  {
    $group: {
      _id: "$customerId",
      total_revenue_generated: {
        $sum: {
          $multiply: ["$items.quantity", "$items.price"],
        },
      },
    },
  },
  {
    $project: {
      _id: 0,
      customerId: "$_id",
      total_revenue_generated: 1,
    },
  },
]);
```

</details>

## Topic: Array Filtering

### Question 18: Filtering Array Elements Using `$filter`

You are given an `orders` collection where each order contains an array of items.

Each item includes:

- productId
- quantity

For each order, return:

- orderId
- only those items whose quantity is **greater than 2**

The original document structure should be preserved.

💡 **Bonus:**
How would you also remove orders where no items match the condition?

<details>
  <summary>**Solution**</summary>

```js
db.orders.aggregate([
  {
    $project: {
      orderId: 1,
      items: {
        $filter: {
          input: "$items",
          as: "item",
          cond: { $gt: ["$$item.quantity", 2] },
        },
      },
    },
  },
]);
```

</details>

## Topic: Array Transformation

### Question 19: Transforming Arrays Using `$map`

You are given an `orders` collection where each order contains an array of items.
Each item includes:

- productId
- quantity
- price

For each order, transform the items array to return:

- productId
- totalItemPrice (quantity × price)

Return one document per order.

<details>
  <summary>**Solution**</summary>

```js
db.orders.aggregate([
  {
    $project: {
      orderId: 1,
      items: {
        $map: {
          input: "$items",
          as: "item",
          in: {
            productId: "$$item.productId",
            totalItemPrice: {
              $multiply: ["$$item.quantity", "$$item.price"],
            },
          },
        },
      },
    },
  },
]);
```

</details>

## Topic: Date-based Aggregation

### Question 20: Monthly Revenue Report

You are given an `orders` collection containing:

- orderDate
- totalAmount

Generate a report showing:

- year
- month
- total revenue for that month

Each month should appear only once in the result.

💡 **Bonus:**
How would you sort the result chronologically?

<details>
  <summary>**Solution**</summary>

```js
db.orders.aggregate([
  {
    $group: {
      _id: {
        year: { $year: "$orderDate" },
        month: { $month: "$orderDate" },
      },
      monthlyRevenue: { $sum: "$totalAmount" },
    },
  },
  {
    $project: {
      _id: 0,
      year: "$_id.year",
      month: "$_id.month",
      monthlyRevenue: 1,
    },
  },
  {
    $sort: { year: 1, month: 1 },
  },
]);
```

</details>
