# MongoDB Operators Reference

> **Purpose**: A comprehensive reference list of Query and Aggregation operators.

---

## 1. Query Operators (used in `find()` and `$match`)

### 🔹 Logical Operators

Used to combine or negate query conditions.

| Operator | Description                              |
| :------- | :--------------------------------------- |
| `$and`   | Joins clauses with a logical **AND**     |
| `$or`    | Joins clauses with a logical **OR**      |
| `$not`   | Inverts the effect of a query expression |
| `$nor`   | Joins clauses with a logical **NOR**     |

### 🔹 Comparison Operators

Used to compare field values.

| Operator | Description                            |
| :------- | :------------------------------------- |
| `$eq`    | Equals                                 |
| `$ne`    | Not equals                             |
| `$gt`    | Greater than                           |
| `$gte`   | Greater than or equal                  |
| `$lt`    | Less than                              |
| `$lte`   | Less than or equal                     |
| `$in`    | Matches any value in an array          |
| `$nin`   | Matches none of the values in an array |

### 🔹 Element Operators

| Operator  | Description                     |
| :-------- | :------------------------------ |
| `$exists` | Checks for presence of a field  |
| `$type`   | Checks the BSON type of a field |

### 🔹 Evaluation Operators

| Operator | Description                                             |
| :------- | :------------------------------------------------------ |
| `$expr`  | Allows use of aggregation expressions in query language |
| `$regex` | Matches strings using regular expressions               |
| `$mod`   | Performs modulo operation                               |
| `$text`  | Performs text search                                    |
| `$where` | Executes JavaScript expression (Performance warning!)   |

---

## 2. Aggregation Operators

### 🔸 Stage Operators (Pipeline Stages)

| Operator              | Description                                 |
| :-------------------- | :------------------------------------------ |
| `$match`              | Filters documents (like `find`)             |
| `$group`              | Groups documents by a key                   |
| `$project`            | Shapes documents (include/exclude/compute)  |
| `$sort`               | Sorts documents                             |
| `$limit`              | Limits number of documents                  |
| `$skip`               | Skips number of documents                   |
| `$unwind`             | Deconstructs arrays into multiple documents |
| `$lookup`             | Joins documents from another collection     |
| `$addFields` / `$set` | Adds new fields                             |
| `$unset`              | Removes fields                              |
| `$merge`              | Writes result to a collection               |
| `$count`              | Counts documents                            |
| `$facet`              | Multiple pipelines in parallel              |
| `$replaceRoot`        | Promotes a sub-document to root             |

### 🔸 Expression Operators (Inside Stages)

| Category       | Examples                                                               |
| :------------- | :--------------------------------------------------------------------- |
| **Arithmetic** | `$add`, `$subtract`, `$multiply`, `$divide`, `$mod`                    |
| **Array**      | `$size`, `$arrayElemAt`, `$filter`, `$map`, `$push`, `$first`, `$last` |
| **Boolean**    | `$and`, `$or`, `$not`, `$cond`, `$ifNull`, `$switch`                   |
| **String**     | `$concat`, `$substr`, `$toLower`, `$toUpper`, `$trim`, `$regexMatch`   |
| **Date**       | `$year`, `$month`, `$dayOfMonth`, `$dateToString`, `$dateDiff`         |
| **Comparison** | `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$cmp`                     |
| **Type**       | `$type`, `$convert`, `$isArray`                                        |
| **Object**     | `$mergeObjects`, `$objectToArray`, `$arrayToObject`                    |

---

## 3. CRUD Methods cheat Sheet

| Operation       | Method             | Context                               |
| :-------------- | :----------------- | :------------------------------------ |
| **Read All**    | `find().toArray()` | Returns cursor (must convert)         |
| **Read One**    | `findOne()`        | Returns single document               |
| **Update One**  | `updateOne()`      | Use `$set`, `$unset`, etc.            |
| **Update Many** | `updateMany()`     | Mass update matching docs             |
| **Delete One**  | `deleteOne()`      | Removes single match                  |
| **Delete Many** | `deleteMany()`     | Removes all matching docs             |
| **Replace One** | `replaceOne()`     | Replaces full doc (no partial update) |
