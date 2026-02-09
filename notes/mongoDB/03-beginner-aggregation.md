# Basic Aggregation Practice

> **Purpose**: Practice the fundamental building blocks of aggregation pipelines.
>
> **Focus**: `$match`, `$group`, `$lookup`, `$unwind`, `$project`.

---

## Topic: Filtering & Projection

### Question 1: Basic Filtering and Sorting (Generated)

You are given a `movies` collection where each document represents a movie with a title, genre, `releaseYear`, and rating.

Retrieve all movies that are of the "Sci-Fi" genre.
The result should simply return the matching documents.

**Bonus:** How would you also sort these movies by `releaseYear` in descending order?

```json
[
  { "title": "Inception", "genre": "Sci-Fi", "releaseYear": 2010, "rating": 8.8 },
  { "title": "The Dark Knight", "genre": "Action", "releaseYear": 2008, "rating": 9.0 },
  { "title": "Interstellar", "genre": "Sci-Fi", "releaseYear": 2014, "rating": 8.6 },
]
```

<details>
  <summary>**Solution**</summary>

```js
db.movies.aggregate([
  { $match: { genre: "Sci-Fi" } },
  { $sort: { releaseYear: -1 } },
]);
```

</details>

## Topic: Projection & Computed Fields

### Question 2: Computed Fields Using `$project`

You are given an `employees` collection where each document represents an employee and contains their monthly salary.

For each employee, return:

- employee name
- monthly salary
- annual salary

The annual salary should be calculated as **monthlySalary × 12**.

Only the required fields should be present in the final output.

💡 **Bonus:**
How would this change if some employees do not have a salary field?

<details>
  <summary>**Solution**</summary>

```js
db.employees.aggregate([
  {
    $project: {
      name: 1,
      monthlySalary: 1,
      annualSalary: { $multiply: ["$monthlySalary", 12] },
    },
  },
]);
```

</details>

## Topic: Conditional Projection

### Question 3: Handling Missing Fields with `$ifNull`

You are given a `users` collection where some users may not have a phone number.

Return a list of users with:

- name
- phoneNumber (or `"N/A"` if missing)

Ensure every user has a value for `phoneNumber` in the output.

<details>
  <summary>**Solution**</summary>

```js
db.users.aggregate([
  {
    $project: {
      name: 1,
      phoneNumber: { $ifNull: ["$phoneNumber", "N/A"] },
    },
  },
]);
```

</details>

## Topic: Grouping & Aggregation

### Question 4: Grouping Basics

You are given a sales collection where each document represents a product sale, including the region where the sale occurred and the quantity sold.
Using the sales data, calculate the total quantity of products sold in each region.
Each region may have multiple sales records. The final result should contain one entry per region along with the total quantity sold in that region.

💡 Bonus: How would the result change if you needed to calculate this only for a specific product or within a date range?

```json
[
  { "saleId": 1, "product": "Laptop", "quantity": 3, "price": 1000, "region": "North" },
  { "saleId": 2, "product": "Phone", "quantity": 5, "price": 500, "region": "South" },
  { "saleId": 3, "product": "Tablet", "quantity": 2, "price": 300, "region": "North" },
  { "saleId": 4, "product": "Laptop", "quantity": 1, "price": 1000, "region": "East" },
  { "saleId": 5, "product": "Phone", "quantity": 4, "price": 500, "region": "South" }
]
```

:::note[**Sample Output**]
```json
[
  { "_id": "North", "totalQuantity": 5 },
  { "_id": "South", "totalQuantity": 9 },
  { "_id": "East", "totalQuantity": 1 }
]
```
:::

<details>
  <summary>**Solution**</summary>

```js
db.sales.aggregate([
  {
    $group: {
      _id: "$region",
      totalQuantity: { $sum: "$quantity" },
    },
  },
]);
```

</details>

### Question 5: Averages

You are given an orders collection where each document represents an order placed by a customer and contains the total amount of that order.

Calculate the average order amount for each customer.
Each customer may have placed multiple orders.
The final result should contain one entry per customer along with their average order amount.

💡 Bonus: How would you modify the query to calculate the average only for orders placed in a specific time range?

```json
[
  { "orderId": "O1001", "customerId": "C001", "totalAmount": 120, "createdAt": "2024-01-10" },
  { "orderId": "O1002", "customerId": "C002", "totalAmount": 250, "createdAt": "2024-01-12" },
  { "orderId": "O1003", "customerId": "C001", "totalAmount": 300, "createdAt": "2024-01-15" },
  { "orderId": "O1004", "customerId": "C002", "totalAmount": 150, "createdAt": "2024-01-18" },
]
```

:::note[**Sample Output**]
```json
[
  { "_id": "C001", "averageAmount": 210 },
  { "_id": "C002", "averageAmount": 200 },
]
```
:::

<details>
  <summary>**Solution**</summary>

```js
db.orders.aggregate([
  {
    $group: {
      _id: "$customerId",
      averageAmount: { $avg: "$totalAmount" },
    },
  },
]);
```

</details>


### Question 6: Basic `$match` & `$group`

You are given a sales collection where each document represents a product sale, including the region in which the sale occurred and the quantity sold.

Using the sales data, determine how many units were sold in each region.

Each region may have multiple sales records.
The result should show one entry per region along with the total quantity sold in that region.

💡 Bonus: Based on the sample data below, what would the expected output look like?

```json
// Collection: sales
[
  { "saleId": 1, "product": "Laptop", "quantity": 3, "price": 1000, "region": "North" },
  { "saleId": 2, "product": "Phone", "quantity": 5, "price": 500, "region": "South" },
  { "saleId": 3, "product": "Tablet", "quantity": 2, "price": 300, "region": "North" },
  { "saleId": 4, "product": "Laptop", "quantity": 1, "price": 1000, "region": "East" },
]
```

<details>
  <summary>**Solution**</summary>

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

</details>

### Question 7: `$group` with `$sum` and `$avg`

You are given an orders collection where each document represents a purchase made by a customer, along with the total amount for that order.
Using the orders data, calculate the average order value for each customer.
Each customer may have placed multiple orders.

The result should show one entry per customer along with their average order amount.

💡 Bonus: Based on the sample data below, what would the expected output look like?

```json
// Collection: orders
[
  { "orderId": "A001", "customerId": "C001", "totalAmount": 120, "date": "2024-01-15" },
  { "orderId": "A002", "customerId": "C002", "totalAmount": 250, "date": "2024-01-16" },
  { "orderId": "A003", "customerId": "C001", "totalAmount": 300, "date": "2024-01-17" },
]
```

<details>
  <summary>**Solution**</summary>

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

</details>

## Topic: Joins & Relationships

### Question 8: Basic Lookup (Join)

You are working with two collections:

- products – stores product information
- categories – stores category metadata

Each product belongs to exactly one category, represented by categoryId.
Your task is to retrieve a list of products enriched with their category information.

Requirements

For each product, return:

- productId
- product name
- price
- category name

Each product should appear only once in the final result.

Bonus Questions

- What happens if a product does not have a matching category?
- How would you modify the pipeline to still include such products?

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


:::note[**Sample Output**]
```json
[
  { "productId": 101, "name": "Keyboard", "price": 50, "categoryName": "Accessories" },
  { "productId": 102, "name": "Mouse", "price": 25, "categoryName": "Accessories" },
  { "productId": 103, "name": "Monitor", "price": 200, "categoryName": "Displays" },
]
```
:::

<details>
  <summary>**Solution**</summary>

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
  {
    $unwind: {
      path: "$categoryDetails",
      preserveNullAndEmptyArrays: true,
    },
  },
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

</details>
