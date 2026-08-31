---
title: map, filter, reduce & sorted
author: Tejas Nirala
---

# `map`, `filter`, `reduce`, and `sorted` in Java

These four are the workhorses of the Stream API. Almost every pipeline you'll ever write is some arrangement of them.

---

## 1. `map()`

### 🔹 Purpose:

`map()` is used to transform (or map) each element of the stream into another form. This doesn't modify the original data, but returns a new stream with transformed elements.

### 📌 Syntax:

```java
Stream<T> stream = collection.stream();
Stream<R> newStream = stream.map(element -> transformedElement);
```

### 🧠 Example:

Convert a list of names to uppercase.

```java
List<String> names = Arrays.asList("Tejas", "Nirali", "Ravi");

List<String> upperNames = names.stream()
    .map(name -> name.toUpperCase())
    .collect(Collectors.toList());

System.out.println(upperNames);
// Output: [TEJAS, NIRALI, RAVI]
```

### 🔍 Explanation:

- `name -> name.toUpperCase()` transforms each element.
- The original list remains unchanged.
- You can use `map()` to extract a field from an object too.

### The key property: `map` is 1-to-1

```
  [ "Tejas", "Nirali", "Ravi" ]
      │         │        │
      ▼         ▼        ▼
  [ "TEJAS", "NIRALI", "RAVI" ]
```

Same count in, same count out. **`map` never adds or removes elements** — only transforms them. If your count changes, you wanted `filter` or `flatMap`.

### `map` changes the stream's type

```java
Stream<String>  names  = list.stream();
Stream<Integer> lengths = names.map(String::length);   // Stream<String> → Stream<Integer>
Stream<Boolean> longs   = lengths.map(n -> n > 4);      // → Stream<Boolean>
```

Extracting a field is the most common use of all:

```java
record Employee(String name, String dept, double salary) { }

List<String> allNames = staff.stream().map(Employee::name).toList();
List<Double> salaries = staff.stream().map(Employee::salary).toList();
```

### Primitive variants avoid boxing

```java
staff.stream().mapToDouble(Employee::salary).sum();       // no Double objects created
names.stream().mapToInt(String::length).max();
IntStream.range(0, 5).mapToObj(i -> "item" + i).toList(); // back to objects
```

### `map` vs `flatMap` in one picture

```java
List<List<Integer>> nested = List.of(List.of(1, 2), List.of(3, 4));

nested.stream().map(l -> l).toList();              // [[1, 2], [3, 4]]  still nested
nested.stream().flatMap(List::stream).toList();    // [1, 2, 3, 4]      flattened
```

---

## 2. `filter()`

### 🔹 Purpose:

`filter()` is used to **select elements** that satisfy a given condition (predicate). It eliminates elements that **don't match the condition**.

### 📌 Syntax:

```java
Stream<T> filtered = stream.filter(element -> condition);
```

### 🧠 Example:

Filter out all names with length > 4.

```java
List<String> names = Arrays.asList("Tejas", "Nirali", "Ravi", "Tom");

List<String> filteredNames = names.stream()
    .filter(name -> name.length() > 4)
    .collect(Collectors.toList());

System.out.println(filteredNames);
// Output: [Tejas, Nirali]
```

### 🔍 Explanation:

- The lambda `name.length() > 4` acts as a filter.
- Only "Tejas" and "Nirali" meet the condition.

### The key property: `filter` is n-to-≤n

```
  [ "Tejas", "Nirali", "Ravi", "Tom" ]
      │         │        ✗       ✗
      ▼         ▼
  [ "Tejas", "Nirali" ]
```

**`filter` never transforms** — elements come out unchanged or not at all. If you find yourself wanting to change values inside a `filter`, you want `map`.

### Chaining filters

```java
staff.stream()
     .filter(e -> e.dept().equals("IT"))
     .filter(e -> e.salary() > 80000)
     .toList();

// identical to:
staff.stream()
     .filter(e -> e.dept().equals("IT") && e.salary() > 80000)
     .toList();
```

Both process each element once (streams don't materialise between stages), so pick whichever reads better. Separate filters are usually clearer and easier to comment.

### `filter` order matters for performance

```java
// ❌ Expensive check runs on every element
list.stream().filter(this::expensiveCheck).filter(x -> x.isActive())

// ✅ Cheap check first — expensiveCheck runs on far fewer elements
list.stream().filter(x -> x.isActive()).filter(this::expensiveCheck)
```

Same for `filter` before `map`:

```java
list.stream().map(this::expensiveTransform).filter(x -> x != null)   // ❌ transforms everything
list.stream().filter(Objects::nonNull).map(this::expensiveTransform) // ✅ transforms less
```

---

## 3. `reduce()`

### 🔹 Purpose:

`reduce()` is used to **combine** all elements of a stream into a single result, such as a sum, product, or concatenated string.

### 📌 Syntax:

```java
T result = stream.reduce(identity, (a, b) -> a combinedWith b);
```

### 🧠 Example:

Calculate the sum of a list of integers.

```java
List<Integer> numbers = Arrays.asList(10, 20, 30);

int sum = numbers.stream()
    .reduce(0, (a, b) -> a + b);

System.out.println(sum);
// Output: 60
```

### 🔍 Explanation:

- `0` is the identity (starting value).
- `(a, b) -> a + b` is a **BinaryOperator** that combines each pair.

### 👉 Shortcut:

You can also use built-in method reference:

```java
int sum = numbers.stream().reduce(0, Integer::sum);
```

### ⚠️ Without identity:

```java
Optional<Integer> result = numbers.stream().reduce((a, b) -> a * b);
```

### How reduce actually unfolds

```java
List.of(10, 20, 30).stream().reduce(0, (a, b) -> a + b);

//  step 1:  a=0  (identity),  b=10  →  10
//  step 2:  a=10,             b=20  →  30
//  step 3:  a=30,             b=30  →  60
//  result: 60
```

The accumulator carries the running result forward. That's all reduction is.

### The three forms of reduce

```java
// 1. Two args: identity + accumulator → returns T (never empty)
int sum = nums.stream().reduce(0, Integer::sum);

// 2. One arg: accumulator only → returns Optional<T> (the stream might be empty)
Optional<Integer> product = nums.stream().reduce((a, b) -> a * b);
System.out.println(product.orElse(0));

// 3. Three args: identity + accumulator + combiner → for parallel/type-changing reduction
int totalLength = words.stream()
    .reduce(0,
            (acc, word) -> acc + word.length(),   // accumulator: Integer + String
            Integer::sum);                        // combiner: merges parallel partial results
```

### Why the identity matters

The identity must be a genuine identity for the operation: `op(identity, x) == x`.

```java
nums.stream().reduce(0, Integer::sum);        // ✅ 0 is the identity for +
nums.stream().reduce(1, (a, b) -> a * b);     // ✅ 1 is the identity for *
nums.stream().reduce(10, Integer::sum);       // ❌ works sequentially, WRONG in parallel
```

Why does the wrong identity break in parallel? Because the identity is applied **once per partition**. Split into 4 partitions, that bogus `10` gets added four times.

```java
List.of(1,2,3,4).stream().reduce(10, Integer::sum);           // 20
List.of(1,2,3,4).parallelStream().reduce(10, Integer::sum);   // 50  😱
```

### Prefer the specialised operations where they exist

```java
// ✅ These are clearer and faster than a hand-rolled reduce
nums.stream().mapToInt(Integer::intValue).sum();
nums.stream().max(Comparator.naturalOrder());
nums.stream().count();
names.stream().collect(Collectors.joining(", "));

// ❌ Never do this — O(n²) string building
names.stream().reduce("", (a, b) -> a + b);
```

### Reduce on custom objects

```java
record Money(String currency, double amount) {
    Money plus(Money other) { return new Money(currency, amount + other.amount); }
}

Money total = payments.stream()
                      .reduce(new Money("USD", 0), Money::plus);
```

---

## 4. `sorted()`

### 🔹 Purpose:

`sorted()` returns a stream with elements sorted in **natural order** or **custom order** using a comparator.

### 📌 Syntax:

```java
stream.sorted()                          // natural order (Comparable)
stream.sorted(Comparator.comparing(...)) // custom order
```

---

### 🧠 Example 1: Natural Order (Numbers)

```java
List<Integer> numbers = Arrays.asList(4, 1, 3, 2);

List<Integer> sorted = numbers.stream()
    .sorted()
    .collect(Collectors.toList());

System.out.println(sorted);
// Output: [1, 2, 3, 4]
```

---

### 🧠 Example 2: Custom Comparator (String length)

```java
List<String> names = Arrays.asList("Tejas", "Nirali", "Ravi", "Tom");

List<String> sortedByLength = names.stream()
    .sorted(Comparator.comparing(String::length))
    .collect(Collectors.toList());

System.out.println(sortedByLength);
// Output: [Tom, Ravi, Tejas, Nirali]
```

### 🔍 Explanation:

- `Comparator.comparing(String::length)` sorts strings by length.
- You can reverse it using `.reversed()`.

```java
.sorted(Comparator.comparing(String::length).reversed())
```

### `sorted` is a stateful, blocking operation

Unlike `filter` and `map`, `sorted` **cannot** process one element at a time — it must see every element before it can emit the first one. That has two consequences:

**(a) `sorted()` on an infinite stream never terminates.**

```java
Stream.iterate(1, x -> x + 1).sorted().findFirst();   // 💀 hangs forever
```

**(b) Put `sorted` as late as possible.**

```java
// ❌ Sorts 1,000,000 elements, then throws most away
list.stream().sorted().filter(x -> x > 100).limit(10).toList();

// ✅ Filters first, then sorts far fewer
list.stream().filter(x -> x > 100).sorted().limit(10).toList();
```

`sorted()` on a `Comparable`-less type throws `ClassCastException` at runtime — which is why `sorted(comparator)` is often the safer choice.

### Multi-key sorting

```java
staff.stream()
     .sorted(Comparator.comparing(Employee::dept)
                       .thenComparing(Employee::salary, Comparator.reverseOrder())
                       .thenComparing(Employee::name))
     .toList();
```

See [Comparable & Comparator](./28-comparable-and-comparator.md) for the full comparator API.

### Sorting is stable

Elements that compare equal keep their original relative order — so a stable sort by a secondary key followed by the primary key gives you multi-key ordering for free (though `thenComparing` is clearer).

---

## ✅ BONUS: Combine them all

```java
List<String> names = Arrays.asList("Tejas", "Nirali", "Ravi", "Tom");

int totalLength = names.stream()
    .filter(name -> name.length() > 3)        // Filter
    .map(String::length)                      // Map to lengths
    .reduce(0, Integer::sum);                 // Reduce to total sum

System.out.println(totalLength);
// Output: 16 (Tejas: 5, Nirali: 6, Ravi: 4 — Tom excluded)
```

---

## 5. The four operations side by side

| Operation | Input → output count | Changes elements? | Stateful? |
| :-- | :-- | :-- | :-- |
| `map` | n → n | ✅ yes | ❌ no |
| `filter` | n → ≤n | ❌ no | ❌ no |
| `sorted` | n → n | ❌ no | ✅ **yes** — buffers everything |
| `reduce` | n → 1 | — (terminal) | ✅ accumulates |

**The canonical pipeline order:**

```java
collection.stream()
    .filter(...)      // 1. narrow down FIRST — everything after does less work
    .map(...)         // 2. transform what survived
    .sorted(...)      // 3. order the (now smaller) result
    .limit(n)         // 4. take the top n
    .collect(...);    // 5. materialise
```

---

## 6. Worked example — one dataset, many questions

```java
import java.util.*;
import java.util.stream.*;
import static java.util.stream.Collectors.*;

public class PipelineDemo {
    record Sale(String region, String product, int units, double unitPrice) {
        double revenue() { return units * unitPrice; }
    }

    public static void main(String[] args) {
        List<Sale> sales = List.of(
            new Sale("North", "Laptop",  3, 1200),
            new Sale("South", "Mouse",  40,   20),
            new Sale("North", "Monitor", 8,  300),
            new Sale("East",  "Laptop",  1, 1200),
            new Sale("South", "Laptop",  5, 1200),
            new Sale("North", "Mouse",  25,   20)
        );

        // MAP — extract one field
        System.out.println(sales.stream().map(Sale::product).distinct().sorted().toList());
        // [Laptop, Monitor, Mouse]

        // FILTER — narrow down
        System.out.println(sales.stream()
            .filter(s -> s.revenue() > 1000)
            .map(Sale::product).toList());
        // [Laptop, Monitor, Laptop, Laptop]

        // REDUCE — collapse to one value
        double totalRevenue = sales.stream().map(Sale::revenue).reduce(0.0, Double::sum);
        System.out.printf("Total revenue: %.2f%n", totalRevenue);
        // the idiomatic form:
        System.out.println(sales.stream().mapToDouble(Sale::revenue).sum());

        // SORTED — order the results
        System.out.println(sales.stream()
            .sorted(Comparator.comparingDouble(Sale::revenue).reversed())
            .limit(3)
            .map(s -> s.product() + "/" + s.region())
            .toList());
        // [Laptop/North, Laptop/South, Monitor/North]

        // ALL FOUR — "top 2 regions by revenue"
        System.out.println(sales.stream()
            .filter(s -> s.units() > 0)                                     // FILTER
            .collect(groupingBy(Sale::region, summingDouble(Sale::revenue)))// group+REDUCE
            .entrySet().stream()
            .sorted(Map.Entry.<String, Double>comparingByValue().reversed())// SORTED
            .limit(2)
            .map(e -> String.format("%s: %.0f", e.getKey(), e.getValue()))  // MAP
            .toList());
        // [North: 5000, South: 6800]  → actually [South: 6800, North: 5000]

        // Efficient ordering matters
        // ❌ sorts everything, then discards
        // sales.stream().sorted(...).filter(s -> s.units() > 10).toList();
        // ✅ filters first
        System.out.println(sales.stream()
            .filter(s -> s.units() > 10)
            .sorted(Comparator.comparingInt(Sale::units))
            .map(Sale::product).toList());
        // [Mouse, Mouse]
    }
}
```

---

## 🧠 Rapid-fire recall

1. Can `map` change the number of elements in a stream? Can `filter` change their values?
2. What are the three overloads of `reduce`, and what does each return?
3. Why must the identity in `reduce` be a true identity, and what goes wrong in parallel if it isn't?
4. Why is `names.stream().reduce("", (a,b) -> a+b)` a bad way to join strings?
5. Why is `sorted()` called a stateful operation, and what does that mean for infinite streams?
6. Should `filter` come before or after `sorted`? Why?
7. In `list.stream().map(expensive).filter(nonNull)`, what's the better ordering?

<details>
<summary>Answers</summary>

1. No to both. `map` is strictly 1-to-1 and only transforms; `filter` only selects and never modifies values.
2. `reduce(identity, acc)` → `T`; `reduce(acc)` → `Optional<T>`; `reduce(identity, acc, combiner)` → `U`, for parallel or type-changing reductions.
3. Because it's applied once per partition. With a non-identity value, parallel execution adds it multiple times and produces the wrong answer.
4. Each `+` builds a whole new String and copies the old contents — O(n²). Use `Collectors.joining()`.
5. It must buffer every element before it can emit any, so it can't stream lazily. On an infinite stream it never terminates.
6. Before — sorting fewer elements is cheaper, and `sorted` has to hold everything in memory.
7. `filter` first, so the expensive transform runs on fewer elements: `.filter(Objects::nonNull).map(expensive)` — assuming the null check applies to the input.

</details>
