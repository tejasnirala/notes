---
title: Stream API
author: Tejas Nirala
---

# Stream API in Java

The **Stream API** was introduced in **Java 8** to process collections of objects in a **functional and declarative way**. It allows you to perform **filtering, mapping, reducing, collecting, and more** in a clean and concise manner.

---

## 🔹 What is a Stream?

A **Stream** is **not a data structure**, but a **pipeline of operations** performed on a data source (like a `Collection`, `List`, `Set`, or `Map`).

### Key Points:

- Doesn't store data.
- Lazy and only executes when a terminal operation is invoked.
- Can be sequential or parallel (`parallelStream()`).

### The mental model

Think of a stream as a **conveyor belt with stations on it**:

```
  SOURCE            INTERMEDIATE OPS (lazy)              TERMINAL OP (eager)
 ┌────────┐      ┌────────┐   ┌────────┐   ┌────────┐   ┌──────────────┐
 │  List  │ ───▶ │ filter │ ─▶│  map   │ ─▶│ sorted │ ─▶│  collect()   │──▶ result
 └────────┘      └────────┘   └────────┘   └────────┘   └──────────────┘
                        nothing runs until here ────────────▲
```

Three properties that follow, and that explain almost every stream behaviour:

1. **No storage.** A stream doesn't hold elements — it pulls them from the source on demand.
2. **Doesn't modify the source.** `list.stream().map(...)` never changes `list`.
3. **Single use.** Once consumed, a stream is dead:

```java
Stream<String> s = list.stream();
s.forEach(System.out::println);
s.forEach(System.out::println);   // 💥 IllegalStateException: stream has already
                                   //    been operated upon or closed
```

---

## 🔹 Basic Flow of Stream API

```java
collection.stream()
          .filter(...)
          .map(...)
          .collect(...);
```

Every pipeline has exactly three parts:

```
   SOURCE  →  zero or more INTERMEDIATE ops  →  exactly one TERMINAL op
```

### Creating a stream

```java
list.stream();                                 // from a Collection
list.parallelStream();                          // parallel version
Arrays.stream(array);                           // from an array
Stream.of("a", "b", "c");                       // from values
Stream.empty();
Stream.iterate(1, x -> x * 2).limit(10);        // infinite, then bounded
Stream.iterate(1, x -> x < 100, x -> x * 2);    // Java 9+ — with a built-in stop condition
Stream.generate(Math::random).limit(5);         // infinite supplier
"a,b,c".chars();                                 // IntStream of code points
Files.lines(Path.of("file.txt"));                // stream a file lazily, line by line
IntStream.range(0, 5);                           // 0,1,2,3,4
IntStream.rangeClosed(1, 5);                     // 1,2,3,4,5
map.entrySet().stream();                         // from a Map
```

---

## 🔹 Important Stream Operations

### 🟢 1. Intermediate Operations (returns a stream)

These are lazy and don't get executed until a terminal operation is called.

| Method | Description |
| --- | --- |
| `filter()` | Filters elements based on a condition |
| `map()` | Transforms elements |
| `sorted()` | Sorts the stream |
| `distinct()` | Removes duplicates |
| `limit(n)` | Limits to `n` elements |
| `skip(n)` | Skips first `n` elements |

### Example:

```java
List<String> names = Arrays.asList("Alice", "Bob", "Ankit");
List<String> result = names.stream()
    .filter(name -> name.startsWith("A"))
    .map(String::toUpperCase)
    .collect(Collectors.toList());
```

### The rest of the intermediate operations

| Method | Description |
| :-- | :-- |
| `flatMap()` | Flattens nested structures (a stream of streams → one stream) |
| `mapToInt/Long/Double` | Convert to a primitive stream (no boxing) |
| `boxed()` | Primitive stream → object stream |
| `peek()` | Look at each element without changing it — **for debugging only** |
| `takeWhile(p)` | Java 9+ — take elements while `p` is true, then stop |
| `dropWhile(p)` | Java 9+ — skip elements while `p` is true, then take the rest |

### `flatMap` — the one worth understanding properly

`map` gives you one output per input. `flatMap` lets one input produce **many** outputs, all flattened into a single stream.

```java
List<List<String>> nested = List.of(
    List.of("a", "b"),
    List.of("c", "d"),
    List.of("e")
);

// map → Stream<List<String>> — still nested
nested.stream().map(l -> l).toList();            // [[a, b], [c, d], [e]]

// flatMap → Stream<String> — flattened
nested.stream().flatMap(List::stream).toList();  // [a, b, c, d, e]
```

Real use: split sentences into words.

```java
List<String> sentences = List.of("hello world", "java streams");

sentences.stream()
         .flatMap(s -> Arrays.stream(s.split(" ")))
         .toList();                               // [hello, world, java, streams]
```

Or flatten a one-to-many relationship:

```java
orders.stream()
      .flatMap(order -> order.getItems().stream())    // Order → its LineItems
      .filter(item -> item.getPrice() > 100)
      .toList();
```

### `takeWhile` vs `filter`

```java
List<Integer> nums = List.of(1, 2, 3, 10, 4, 5);

nums.stream().filter(n -> n < 5).toList();       // [1, 2, 3, 4]  — checks ALL
nums.stream().takeWhile(n -> n < 5).toList();    // [1, 2, 3]     — STOPS at 10
nums.stream().dropWhile(n -> n < 5).toList();    // [10, 4, 5]
```

---

### 🔴 2. Terminal Operations (triggers the processing)

| Method | Description |
| --- | --- |
| `collect()` | Converts stream into a collection/list etc. |
| `forEach()` | Iterates over each element |
| `count()` | Counts the elements |
| `reduce()` | Reduces stream to a single value |
| `anyMatch()` | Returns true if any element matches predicate |
| `allMatch()` | Checks if all elements match predicate |
| `noneMatch()` | Checks if no elements match predicate |
| `findFirst()` | Returns first element |
| `findAny()` | Returns any element |

### Example:

```java
List<Integer> nums = Arrays.asList(1, 2, 3, 4, 5);
int sum = nums.stream()
    .filter(n -> n % 2 == 0)
    .mapToInt(Integer::intValue)
    .sum();
```

### More terminal operations

| Method | Returns |
| :-- | :-- |
| `toList()` | Java 16+ — an **immutable** list; shorter than `collect(toList())` |
| `toArray()` / `toArray(String[]::new)` | An array |
| `min(cmp)` / `max(cmp)` | `Optional<T>` |
| `sum()` / `average()` / `summaryStatistics()` | On primitive streams only |
| `iterator()` | An `Iterator` over the stream |

### Short-circuiting saves work

```java
boolean any = hugeList.stream().anyMatch(x -> x > 100);
// stops at the FIRST match — doesn't scan the rest

Optional<String> first = hugeList.stream()
                                 .filter(s -> s.startsWith("Z"))
                                 .findFirst();
// filter and findFirst work TOGETHER: the pipeline stops as soon as one is found
```

This is what laziness buys you. The whole pipeline processes **one element at a time, end to end**, rather than materialising an intermediate list at each step.

```java
List.of("a", "b", "c").stream()
    .peek(s -> System.out.println("filter: " + s))
    .filter(s -> !s.equals("b"))
    .peek(s -> System.out.println("  map: " + s))
    .map(String::toUpperCase)
    .findFirst();

// filter: a
//   map: a          ← only ONE element was processed, then it stopped
```

---

## 🔹 Stream Collectors

Use `Collectors` to convert streams into other forms.

| Collector | Description |
| --- | --- |
| `toList()` | Collects to List |
| `toSet()` | Collects to Set |
| `toMap()` | Collects to Map |
| `joining()` | Joins strings |
| `groupingBy()` | Groups elements |
| `partitioningBy()` | Partitions into two groups |
| `counting()` | Counts elements |

### Example:

```java
Map<Boolean, List<Integer>> partitioned =
    nums.stream().collect(Collectors.partitioningBy(n -> n % 2 == 0));
```

### The collectors you'll actually use

```java
import static java.util.stream.Collectors.*;

// Basic collections
stream.collect(toList());                    // mutable ArrayList
stream.toList();                              // Java 16+, IMMUTABLE — prefer this
stream.collect(toSet());
stream.collect(toCollection(TreeSet::new));   // a specific implementation

// Joining strings
names.stream().collect(joining());                     // "TejasAnkitRavi"
names.stream().collect(joining(", "));                 // "Tejas, Ankit, Ravi"
names.stream().collect(joining(", ", "[", "]"));       // "[Tejas, Ankit, Ravi]"

// To a map
employees.stream().collect(toMap(Employee::id, Employee::name));
// ⚠️ throws IllegalStateException on a duplicate key — supply a merge function:
employees.stream().collect(toMap(Employee::dept, Employee::name, (a, b) -> a + ", " + b));
// and a map factory if you want ordering:
employees.stream().collect(toMap(Employee::id, e -> e, (a,b) -> a, LinkedHashMap::new));

// Numeric summaries
employees.stream().collect(counting());
employees.stream().collect(summingDouble(Employee::salary));
employees.stream().collect(averagingDouble(Employee::salary));
employees.stream().collect(summarizingDouble(Employee::salary));
//   → DoubleSummaryStatistics{count=3, sum=..., min=..., average=..., max=...}
```

### `groupingBy` — the SQL GROUP BY of Java

```java
// Simple grouping → Map<Dept, List<Employee>>
Map<String, List<Employee>> byDept =
    employees.stream().collect(groupingBy(Employee::dept));

// Group and COUNT → Map<Dept, Long>
Map<String, Long> countByDept =
    employees.stream().collect(groupingBy(Employee::dept, counting()));

// Group and SUM → Map<Dept, Double>
Map<String, Double> payrollByDept =
    employees.stream().collect(groupingBy(Employee::dept, summingDouble(Employee::salary)));

// Group and extract just names → Map<Dept, List<String>>
Map<String, List<String>> namesByDept =
    employees.stream().collect(groupingBy(Employee::dept,
                                mapping(Employee::name, toList())));

// Group into a sorted map
Map<String, List<Employee>> sorted =
    employees.stream().collect(groupingBy(Employee::dept, TreeMap::new, toList()));

// Nested grouping → Map<Dept, Map<Boolean, List<Employee>>>
Map<String, Map<Boolean, List<Employee>>> nested =
    employees.stream().collect(groupingBy(Employee::dept,
                                partitioningBy(e -> e.salary() > 80000)));

// Group and find the max in each group
Map<String, Optional<Employee>> topEarner =
    employees.stream().collect(groupingBy(Employee::dept,
                                maxBy(comparingDouble(Employee::salary))));
```

The second argument to `groupingBy` is called a **downstream collector** — it decides what each group becomes. Once that clicks, the whole API opens up.

### `partitioningBy` — grouping into exactly two buckets

```java
Map<Boolean, List<Employee>> split =
    employees.stream().collect(partitioningBy(e -> e.salary() > 80000));

split.get(true);    // high earners
split.get(false);   // everyone else
```

Unlike `groupingBy`, both `true` and `false` keys always exist, even if empty.

---

## 🔹 Parallel Streams

To leverage multi-core systems:

```java
list.parallelStream()
    .filter(...)
    .map(...)
    .collect(...);
```

### When it actually helps — and when it hurts

Parallel streams split the work across the common `ForkJoinPool` (by default, `CPU cores − 1` threads).

**It helps when all of these are true:**
- Large dataset (rule of thumb: 10,000+ elements)
- Per-element work is expensive
- The source splits cheaply (`ArrayList`, arrays, `IntStream.range` — good; `LinkedList`, `Stream.iterate` — bad)
- The operations are stateless and independent

**It hurts when:**
- The dataset is small — thread coordination costs more than the work
- The operation is I/O bound — you'll block the shared pool and starve everything else
- You need encounter order (`forEachOrdered`, `limit`, `findFirst` all cost extra in parallel)

```java
// ❌ Slower than sequential — overhead dominates
List.of(1, 2, 3).parallelStream().map(x -> x * 2).toList();

// ✅ Genuinely faster
IntStream.range(0, 10_000_000).parallel().filter(this::isPrime).count();
```

### The rule that matters

**Never mutate shared state from a parallel stream.**

```java
// ❌ Race condition — ArrayList isn't thread-safe
List<Integer> result = new ArrayList<>();
list.parallelStream().forEach(result::add);   // corrupted or lost elements

// ✅ Let collect handle it
List<Integer> result = list.parallelStream().collect(toList());
```

**Measure before parallelising.** Naive `.parallel()` calls are one of the most common sources of code that's slower *and* buggier than the sequential version.

---

## 🔹 Example: Chaining Multiple Operations

```java
List<String> result = Arrays.asList("apple", "banana", "avocado", "apricot")
    .stream()
    .filter(s -> s.startsWith("a"))
    .map(String::toUpperCase)
    .sorted()
    .collect(Collectors.toList());
```

**Output:** `[APPLE, APRICOT, AVOCADO]`

---

## 🔹 Why Use Stream API?

✅ Cleaner, readable code

✅ Supports functional programming

✅ Efficient with lazy evaluation

✅ Easy to parallelize operations

### The readability case, concretely

```java
// Imperative — the WHAT is buried under the HOW
Map<String, Double> avgByDept = new HashMap<>();
Map<String, Integer> counts = new HashMap<>();
for (Employee e : employees) {
    if (e.getSalary() > 50000) {
        avgByDept.merge(e.getDept(), e.getSalary(), Double::sum);
        counts.merge(e.getDept(), 1, Integer::sum);
    }
}
for (var entry : avgByDept.entrySet()) {
    entry.setValue(entry.getValue() / counts.get(entry.getKey()));
}

// Declarative — the WHAT is the code
Map<String, Double> avgByDept = employees.stream()
    .filter(e -> e.getSalary() > 50000)
    .collect(groupingBy(Employee::getDept, averagingDouble(Employee::getSalary)));
```

---

## 4. Primitive streams

`Stream<Integer>` boxes every element. `IntStream`, `LongStream` and `DoubleStream` don't.

```java
IntStream.rangeClosed(1, 5).sum();                     // 15
IntStream.of(3, 1, 4).max().getAsInt();                 // 4
IntStream.rangeClosed(1, 5).average().getAsDouble();    // 3.0

// Object stream → primitive stream
employees.stream().mapToDouble(Employee::salary).sum();
names.stream().mapToInt(String::length).max();

// Primitive stream → object stream
IntStream.range(0, 5).boxed().toList();                 // List<Integer>

// The summary object — one pass, all the stats
IntSummaryStatistics stats = IntStream.of(3, 1, 4, 1, 5).summaryStatistics();
System.out.println(stats.getMin() + " " + stats.getMax() + " " + stats.getAverage());
```

Note that `min`, `max` and `average` on a primitive stream return `OptionalInt`/`OptionalDouble` (the stream might be empty), while `sum()` returns a plain value (0 for empty).

---

## 5. Common mistakes

```java
// ❌ 1. Reusing a stream
Stream<String> s = list.stream();
s.count(); s.count();                        // IllegalStateException

// ❌ 2. Forgetting the terminal operation — NOTHING happens
list.stream().filter(x -> x > 5).map(this::transform);   // no-op!

// ❌ 3. Using forEach to build a list
List<String> out = new ArrayList<>();
list.stream().forEach(out::add);             // just use .toList()

// ❌ 4. peek() for side effects — it may be skipped entirely by optimisation
list.stream().peek(this::save).count();      // save() may never run

// ❌ 5. Streams for a simple loop — harder to read AND slower
IntStream.range(0, 3).forEach(i -> System.out.println(i));
for (int i = 0; i < 3; i++) System.out.println(i);        // just write this

// ❌ 6. Mutating the source during a stream
list.stream().forEach(x -> list.remove(x));  // ConcurrentModificationException
```

---

## 6. Worked example

```java
import java.util.*;
import java.util.stream.*;
import static java.util.stream.Collectors.*;

public class StreamDemo {
    record Employee(String name, String dept, double salary, int age) { }

    public static void main(String[] args) {
        List<Employee> staff = List.of(
            new Employee("Tejas",  "IT",     92000, 28),
            new Employee("Ankit",  "HR",     65000, 31),
            new Employee("Ravi",   "IT",     78000, 26),
            new Employee("Bhavna", "HR",     71000, 35),
            new Employee("Meera",  "Finance",88000, 29)
        );

        // 1. Filter → map → collect
        System.out.println(staff.stream()
            .filter(e -> e.salary() > 70000)
            .map(Employee::name)
            .sorted()
            .toList());                        // [Bhavna, Meera, Ravi, Tejas]

        // 2. Group and count
        System.out.println(staff.stream()
            .collect(groupingBy(Employee::dept, TreeMap::new, counting())));
        // {Finance=1, HR=2, IT=2}

        // 3. Average salary per department
        System.out.println(staff.stream()
            .collect(groupingBy(Employee::dept, averagingDouble(Employee::salary))));

        // 4. Top earner overall
        staff.stream()
             .max(Comparator.comparingDouble(Employee::salary))
             .ifPresent(e -> System.out.println("Top: " + e.name()));   // Tejas

        // 5. Top earner PER department
        System.out.println(staff.stream()
            .collect(groupingBy(Employee::dept,
                     collectingAndThen(
                        maxBy(Comparator.comparingDouble(Employee::salary)),
                        opt -> opt.map(Employee::name).orElse("none")))));
        // {Finance=Meera, HR=Bhavna, IT=Tejas}

        // 6. Statistics in one pass
        DoubleSummaryStatistics stats =
            staff.stream().mapToDouble(Employee::salary).summaryStatistics();
        System.out.printf("min=%.0f avg=%.0f max=%.0f total=%.0f%n",
            stats.getMin(), stats.getAverage(), stats.getMax(), stats.getSum());

        // 7. Partition
        Map<Boolean, List<String>> split = staff.stream()
            .collect(partitioningBy(e -> e.age() < 30,
                     mapping(Employee::name, toList())));
        System.out.println("Under 30: " + split.get(true));   // [Tejas, Ravi, Meera]

        // 8. Joining
        System.out.println(staff.stream()
            .map(Employee::name)
            .collect(joining(", ", "Team: [", "]")));

        // 9. flatMap — all distinct letters in all names
        System.out.println(staff.stream()
            .flatMap(e -> e.name().toLowerCase().chars().mapToObj(c -> (char) c))
            .distinct().sorted().map(String::valueOf).collect(joining()));

        // 10. Short-circuit — stops at the first match
        System.out.println(staff.stream()
            .filter(e -> e.dept().equals("HR"))
            .findFirst().map(Employee::name).orElse("none"));   // Ankit
    }
}
```

---

## 🧠 Rapid-fire recall

1. What are the three parts of every stream pipeline?
2. Why does nothing happen if you omit the terminal operation?
3. What exception do you get from reusing a stream, and why?
4. What's the difference between `map` and `flatMap`?
5. What's the difference between `filter(p)` and `takeWhile(p)`?
6. What is a "downstream collector" in `groupingBy`?
7. Name three conditions under which a parallel stream is likely to be *slower*.

<details>
<summary>Answers</summary>

1. A source, zero or more lazy intermediate operations, and exactly one terminal operation.
2. Intermediate operations are lazy — they only build a pipeline description. The terminal operation is what pulls elements through it.
3. `IllegalStateException`. A stream is single-use; the terminal operation consumes and closes it.
4. `map` produces exactly one output per input; `flatMap` lets each input produce a stream of outputs, all flattened into one stream.
5. `filter` examines every element and keeps the matches; `takeWhile` stops entirely at the first element that fails the test.
6. The second argument to `groupingBy`, which determines what each group is reduced to — a list, a count, a sum, a nested grouping, and so on.
7. Small datasets, cheap per-element work, sources that split poorly (`LinkedList`, `Stream.iterate`), I/O-bound operations, or when encounter order must be preserved.

</details>
