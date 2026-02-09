## Query and Aggregation Operators

In MongoDB, there are many **aggregation operators** and **query operators**. Below is the list of both sets to give you a comprehensive view.

---

## 🔹 Logical Operators (used in queries)

These are used to combine or negate query conditions:

| Operator | Description                                |
| -------- | ------------------------------------------ |
| `$and`   | Joins query clauses with a logical **AND** |
| `$or`    | Joins query clauses with a logical **OR**  |
| `$not`   | Inverts the effect of a query expression   |
| `$nor`   | Joins query clauses with a logical NOR     |

---

## 🔹 Comparison Operators

Used to compare field values:

| Operator | Description                            |
| -------- | -------------------------------------- |
| `$eq`    | Equals                                 |
| `$ne`    | Not equals                             |
| `$gt`    | Greater than                           |
| `$gte`   | Greater than or equal                  |
| `$lt`    | Less than                              |
| `$lte`   | Less than or equal                     |
| `$in`    | Matches any value in an array          |
| `$nin`   | Matches none of the values in an array |

---

## 🔹 Element Operators

| Operator  | Description                     |
| --------- | ------------------------------- |
| `$exists` | Checks for presence of a field  |
| `$type`   | Checks the BSON type of a field |

---

## 🔹 Evaluation Operators

| Operator | Description                                                      |
| -------- | ---------------------------------------------------------------- |
| `$expr`  | Allows the use of aggregation expressions in query language      |
| `$regex` | Matches strings using regular expressions                        |
| `$mod`   | Performs modulo operation                                        |
| `$text`  | Performs text search                                             |
| `$where` | Executes JavaScript expression (not recommended for performance) |

---

## 🔹 Aggregation Operators (inside aggregation pipeline)

### 🔸 Stage Operators (used in `$pipeline`)

| Operator                        | Description                                    |
| ------------------------------- | ---------------------------------------------- |
| `$match`                        | Filters documents (like `find`)                |
| `$group`                        | Groups documents by a key                      |
| `$project`                      | Shapes documents by including/excluding fields |
| `$sort`                         | Sorts documents                                |
| `$limit`                        | Limits number of documents                     |
| `$skip`                         | Skips number of documents                      |
| `$unwind`                       | Deconstructs arrays                            |
| `$lookup`                       | Joins documents from another collection        |
| `$addFields` / `$set`           | Adds new fields                                |
| `$unset` / `$project`           | Removes fields                                 |
| `$merge`                        | Writes aggregation result to a collection      |
| `$count`                        | Counts documents                               |
| `$facet`                        | Multiple pipelines in parallel                 |
| `$replaceRoot` / `$replaceWith` | Promotes a sub-document to root                |

---

## 🔹 Common Expression Operators (used inside stages like `$project`, `$group`, etc.)

| Category   | Examples                                                               |
| ---------- | ---------------------------------------------------------------------- |
| Arithmetic | `$add`, `$subtract`, `$multiply`, `$divide`, `$mod`                    |
| Array      | `$size`, `$arrayElemAt`, `$filter`, `$map`, `$push`, `$first`, `$last` |
| Boolean    | `$and`, `$or`, `$not`, `$cond`, `$ifNull`, `$switch`                   |
| String     | `$concat`, `$substr`, `$toLower`, `$toUpper`, `$trim`, `$regexMatch`   |
| Date       | `$year`, `$month`, `$dayOfMonth`, `$dateToString`, `$dateDiff`         |
| Comparison | `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$cmp`                     |
| Type       | `$type`, `$convert`, `$isArray`                                        |
| Object     | `$mergeObjects`, `$objectToArray`, `$arrayToObject`                    |

</aside>

<aside>
💡

## CRUD Methods Summary

### Methods Summary

| Operation   | Method             | Notes                                  |
| ----------- | ------------------ | -------------------------------------- |
| Read all    | `find().toArray()` | Returns cursor – must convert to array |
| Read one    | `findOne()`        | Returns single document                |
| Update one  | `updateOne()`      | Use `$set` or `$unset`, etc.           |
| Update many | `updateMany()`     | Mass update                            |
| Delete one  | `deleteOne()`      | Removes a single match                 |
| Delete many | `deleteMany()`     | Removes all matching docs              |
| Replace one | `replaceOne()`     | Replaces full doc (no partial update)  |

---

</aside>

<aside>
💡

## Basic Aggregation Operators Practice

### 🏋️ **Aggregation Pipeline Practice Questions and Answers**

### **1️⃣ Basic `$match` & `$group`**

```
// Collection: sales
// Each document: { saleId, product, quantity, price, region }

// Find the total quantity sold per region.
```

```json
[
  {
    "saleId": 1,
    "product": "Laptop",
    "quantity": 3,
    "price": 1000,
    "region": "North"
  },
  {
    "saleId": 2,
    "product": "Phone",
    "quantity": 5,
    "price": 500,
    "region": "South"
  },
  {
    "saleId": 3,
    "product": "Tablet",
    "quantity": 2,
    "price": 300,
    "region": "North"
  },
  {
    "saleId": 4,
    "product": "Laptop",
    "quantity": 1,
    "price": 1000,
    "region": "East"
  }
]
```

```jsx
db.sales.aggregate([
  {
    $group: {
      _id: "$region",
      totalQuantity: { $sum: "$quantity" },
    },
  },
]);
```

### **2️⃣ `$lookup` with `$unwind` & `$project`**

```
// Collections: products and categories
// products: { productId, name, categoryId, price }
// categories: { categoryId, categoryName }

// For each product, show product details along with category name.
```

```json
// products
[
  { "productId": 101, "name": "Keyboard", "categoryId": 1, "price": 50 },
  { "productId": 102, "name": "Mouse", "categoryId": 1, "price": 25 },
  { "productId": 103, "name": "Monitor", "categoryId": 2, "price": 200 }
]

// categories
[
  { "categoryId": 1, "categoryName": "Accessories" },
  { "categoryId": 2, "categoryName": "Displays" }
]
```

```jsx
db.products.aggregate([
  {
    $lookup: {
      from: "categories",
      localField: "categoryId",
      foreignField: "categoryId",
      as: "categoryDetails",
    },
  },
  { $unwind: "$categoryDetails" },
  {
    $project: {
      productId: 1,
      name: 1,
      price: 1,
      categoryName: "$categoryDetails.categoryName",
    },
  },
]);
```

### **3️⃣ `$group` with `$sum` and `$avg`**

```
// Collection: orders
// Each document: { orderId, customerId, totalAmount, date }

// Find the average order amount per customer.
```

```json
[
  {
    "orderId": "A001",
    "customerId": "C001",
    "totalAmount": 120,
    "date": "2024-01-15"
  },
  {
    "orderId": "A002",
    "customerId": "C002",
    "totalAmount": 250,
    "date": "2024-01-16"
  },
  {
    "orderId": "A003",
    "customerId": "C001",
    "totalAmount": 300,
    "date": "2024-01-17"
  }
]
```

```jsx
db.orders.aggregate([
  {
    $group: {
      _id: "$customerId",
      averageAmount: { $avg: "$totalAmount" },
    },
  },
]);
```

### **4️⃣ `$match`, `$lookup`, `$unwind`, `$group`**

```
// Collections: posts and comments
// posts: { postId, title, authorId }
// comments: { commentId, postId, commenterName, content }

// For each post, show the post title and total number of comments.
```

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

### **5️⃣ `$facet` (Multi-stage Aggregation)**

```
// Collection: movies
// Each document: { title, year, genre, rating }

// Build a report with:
// - Top 5 highest-rated movies.
// - Count of movies by genre.

```

```json
[
  { "title": "Inception", "year": 2010, "genre": "Sci-Fi", "rating": 8.8 },
  {
    "title": "The Dark Knight",
    "year": 2008,
    "genre": "Action",
    "rating": 9.0
  },
  { "title": "Interstellar", "year": 2014, "genre": "Sci-Fi", "rating": 8.6 },
  { "title": "The Prestige", "year": 2006, "genre": "Drama", "rating": 8.5 }
]
```

```jsx
db.movies.aggregate([
  {
    $facet: {
      topRated: [
        { $sort: { rating: -1 } },
        { $limit: 5 },
        { $project: { title: 1, rating: 1 } },
      ],
      countByGenre: [{ $group: { _id: "$genre", count: { $sum: 1 } } }],
    },
  },
]);
```

### **6️⃣ `$bucket` or `$bucketAuto`**

```
// Collection: transactions
// Each document: { transactionId, amount }

// Group transactions into buckets based on amount ranges (e.g., 0-100, 101-500, etc.).
```

```json
[
  { "transactionId": 1, "amount": 50 },
  { "transactionId": 2, "amount": 200 },
  { "transactionId": 3, "amount": 600 },
  { "transactionId": 4, "amount": 350 }
]
```

```jsx
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

### **7️⃣ Complex Use Case**

```
// Collections: students and scores
// students: { studentId, name, age }
// scores: { studentId, subject, score }

// Find the highest-scoring student in each subject.
```

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

### 👉 **Question:**

Imagine you have a `products` collection with the following fields:

- `productId` (string)
- `category` (string)
- `price` (number)
- `stock` (number)

💡 Write a **MongoDB aggregation pipeline** to:
1️⃣ Group products by category.
2️⃣ Calculate the **average price** and **total stock** for each category.
3️⃣ Sort the categories by **total stock in descending order**.
4️⃣ Only return the **category name, average price (rounded to 2 decimal places), and total stock**.

📢 **Bonus:** Show sample output for a few example documents.

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

sample_output:

```json
[
  {
    "category_name": "Books",
    "avg_price": 32.5,
    "total_stock": 160
  },
  {
    "category_name": "Electronics",
    "avg_price": 1000,
    "total_stock": 80
  },
  {
    "category_name": "Furniture",
    "avg_price": 525,
    "total_stock": 35
  }
]
```

### 👉 Question:

You have a collection named `orders` with the following fields:

- `orderId` (string)
- `customerId` (string)
- `items` (array of objects, each with `productId` and `quantity`)
- `orderDate` (ISODate)

Your task:
1️⃣ **Unwind the `items` array** to flatten it into individual items.
2️⃣ **Group by `productId`** and calculate the **total quantity ordered** for each product.
3️⃣ **Sort by total quantity ordered in descending order**.
4️⃣ **Return productId and total quantity**.

💡 **Bonus:** Show me sample output based on hypothetical data.

```json
[
  {
    "orderId": "O1",
    "customerId": "C1",
    "items": [
      { "productId": "P1", "quantity": 2 },
      { "productId": "P2", "quantity": 1 }
    ],
    "orderDate": "2025-05-01T10:00:00Z"
  },
  {
    "orderId": "O2",
    "customerId": "C2",
    "items": [
      { "productId": "P1", "quantity": 3 },
      { "productId": "P3", "quantity": 5 }
    ],
    "orderDate": "2025-05-02T11:30:00Z"
  },
  {
    "orderId": "O3",
    "customerId": "C3",
    "items": [{ "productId": "P2", "quantity": 4 }],
    "orderDate": "2025-05-03T09:15:00Z"
  }
]
```

```jsx
db.orders.aggregate([
  {
    $unwind: "$items",
  },
  {
    $group: {
      _id: "$items.productId",
      total_quantity_ordered: { $sum: "$items.quantity" },
    },
  },
  {
    $sort: { total_quantity_ordered: -1 },
  },
  {
    $project: {
      productId: "$_id",
      total_quantity_ordered: 1,
      _id: 0,
    },
  },
]);
```

```json
[
  { "productId": "P1", "total_quantity_ordered": 5 },
  { "productId": "P2", "total_quantity_ordered": 5 },
  { "productId": "P3", "total_quantity_ordered": 5 }
]
```

### 💪 **Challenge 1:**

In a `library` collection, each document represents a book and has fields like:

- `title`
- `author`
- `genres` (array)
- `borrowedCount`
  Find the top 3 authors whose books have been borrowed the most (sum of `borrowedCount` across all their books).

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
      author: "$_id",
      borrowed_count: 1,
      _id: 0,
    },
  },
]);
```

---

### 💪 **Challenge 2:**

In an `employees` collection, each document contains:

- `name`
- `department`
- `salary`
  Find the average salary per department, and filter out departments where the average salary is **less than \$50,000**.

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
      department: "$_id",
      avg_salary: 1,
      _id: 0,
    },
  },
]);
```

---

### 💪 **Challenge 3:**

In an `orders` collection where each document has:

- `orderId`
- `customerId`
- `items` (array of `{ productId, quantity, price }`)
  Find the **total revenue generated per customer** (i.e., sum of quantity × price of all items).

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
      customerId: "$_id",
      total_revenue_generated: 1,
      _id: 0,
    },
  },
]);
```

---

### 💪 **Challenge 4:**

In a `movies` collection with:

- `title`
- `releaseYear`
- `rating`
  Find the **top-rated movie** released in each decade (e.g., 1980s, 1990s, 2000s).

```jsx
db.movies.aggregate([{}]);
```

---

### 💪 **Challenge 5:**

In a `students` collection:

- `name`
- `grades` (array of `{ subject, score }`)
  Find the **student with the highest score in each subject**.

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
