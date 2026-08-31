---
title: Maps — HashMap, LinkedHashMap & TreeMap
author: Tejas Nirala
---

# `Map` in Java

A **Map** in Java is an object that maps **keys to values**. It **does not allow duplicate keys**, but it **can have duplicate values**. Each key can map to **at most one value**.

---

## 🔑 Key Characteristics

| Feature | Description |
| --- | --- |
| Key-Value Pair | Stores data as (key, value) pairs |
| Unique Keys | No duplicate keys allowed |
| Allows Null | Depends on the implementation (e.g. `HashMap` allows one `null` key) |
| Part of Collections API | But **not a subtype of Collection interface** |

That last row is worth pausing on. `Map` sits outside the `Collection` hierarchy because its "element" is a *pair*, not a single value — `add(E)` and `iterator()` over elements simply don't fit. You get collection *views* instead: `keySet()`, `values()`, `entrySet()`.

---

## 🧱 Common Implementations of Map

| Implementation | Ordered? | Thread Safe? | Nulls Allowed? |
| --- | --- | --- | --- |
| `HashMap` | ❌ No | ❌ No | ✅ One null key, many null values |
| `LinkedHashMap` | ✅ Yes (insertion order) | ❌ No | ✅ |
| `TreeMap` | ✅ Yes (sorted by key) | ❌ No | ❌ No null keys |
| `Hashtable` | ❌ No | ✅ Yes | ❌ No nulls allowed |

Add two modern ones:

| Implementation | Ordered? | Thread Safe? | Notes |
| :-- | :-- | :-- | :-- |
| `ConcurrentHashMap` | ❌ No | ✅ Yes | The correct thread-safe choice; no nulls |
| `EnumMap` | ✅ Enum declaration order | ❌ No | Array-backed, extremely fast, enum keys only |

---

## 🧪 Example: Using `HashMap`

```java
import java.util.HashMap;
import java.util.Map;

public class MapExample {
    public static void main(String[] args) {
        Map<String, Integer> marks = new HashMap<>();

        // Add entries
        marks.put("Math", 95);
        marks.put("Physics", 90);
        marks.put("Chemistry", 88);

        // Access by key
        System.out.println("Math Marks: " + marks.get("Math"));

        // Iterate over keys
        for (String subject : marks.keySet()) {
            System.out.println(subject + ": " + marks.get(subject));
        }

        // Check if key/value exists
        System.out.println("Contains Physics? " + marks.containsKey("Physics"));
        System.out.println("Contains 88? " + marks.containsValue(88));

        // Remove an entry
        marks.remove("Chemistry");
    }
}
```

---

## 🛠️ Common Methods in Map Interface

| Method | Description |
| --- | --- |
| `put(K key, V value)` | Adds a key-value pair |
| `get(Object key)` | Retrieves the value for a key |
| `remove(Object key)` | Removes a key-value pair |
| `containsKey(Object key)` | Checks if key exists |
| `containsValue(Object value)` | Checks if value exists |
| `keySet()` | Returns a Set of keys |
| `values()` | Returns a Collection of values |
| `entrySet()` | Returns a Set of `Map.Entry` objects |

### The Java 8+ methods that make code much shorter

| Method | What it does |
| :-- | :-- |
| `getOrDefault(k, def)` | Value for `k`, or `def` if absent |
| `putIfAbsent(k, v)` | Only stores if the key isn't already mapped |
| `computeIfAbsent(k, fn)` | Compute and store a value if absent; return it either way |
| `computeIfPresent(k, fn)` | Recompute only if present |
| `compute(k, fn)` | Recompute unconditionally |
| `merge(k, v, fn)` | Store `v` if absent, else combine old and new with `fn` |
| `forEach((k,v) -> …)` | Iterate over pairs |
| `replaceAll((k,v) -> …)` | Transform every value in place |

These replace an enormous amount of boilerplate:

```java
// 😖 Counting the old way
Map<String, Integer> counts = new HashMap<>();
for (String word : words) {
    if (counts.containsKey(word)) {
        counts.put(word, counts.get(word) + 1);
    } else {
        counts.put(word, 1);
    }
}

// 😊 merge
for (String word : words) {
    counts.merge(word, 1, Integer::sum);
}

// 😊 getOrDefault
for (String word : words) {
    counts.put(word, counts.getOrDefault(word, 0) + 1);
}
```

```java
// 😖 Grouping the old way
Map<String, List<String>> groups = new HashMap<>();
for (String name : names) {
    String key = name.substring(0, 1);
    if (!groups.containsKey(key)) groups.put(key, new ArrayList<>());
    groups.get(key).add(name);
}

// 😊 computeIfAbsent
for (String name : names) {
    groups.computeIfAbsent(name.substring(0, 1), k -> new ArrayList<>()).add(name);
}
```

`computeIfAbsent` returning the value (whether it created it or found it) is what makes that one-liner work — and it's probably the single most useful `Map` method added in Java 8.

---

## 🔁 Iterating Through a Map

```java
for (Map.Entry<String, Integer> entry : marks.entrySet()) {
    System.out.println(entry.getKey() + " = " + entry.getValue());
}
```

All the ways, and when to use each:

```java
// 1. entrySet — BEST when you need both key and value (one lookup)
for (Map.Entry<String, Integer> e : map.entrySet()) {
    System.out.println(e.getKey() + " = " + e.getValue());
}

// with var, much less noisy
for (var e : map.entrySet()) { }

// 2. keySet — only if you need just the keys
for (String k : map.keySet()) { }

// 3. keySet + get — ❌ AVOID: two hash lookups per iteration
for (String k : map.keySet()) { System.out.println(map.get(k)); }

// 4. values — only if you need just the values
for (Integer v : map.values()) { }

// 5. forEach — Java 8+, cleanest for a simple action
map.forEach((k, v) -> System.out.println(k + " = " + v));
```

`keySet()`, `values()` and `entrySet()` are **views**, not copies — removing from a keySet removes from the map:

```java
map.keySet().remove("Math");        // removes the whole entry from the map
map.values().removeIf(v -> v < 50); // removes all entries with a low value
```

---

# `LinkedHashMap` and `TreeMap`

Here's a breakdown with **examples** of:

1. ✅ `LinkedHashMap` – preserves insertion order
2. 🌲 `TreeMap` – stores entries in **sorted key order**
3. 🧠 A **real use case**: grouping data using `Map`

---

## 1. ✅ `LinkedHashMap` – Preserves Insertion Order

```java
import java.util.LinkedHashMap;
import java.util.Map;

public class LinkedHashMapExample {
    public static void main(String[] args) {
        Map<String, String> countries = new LinkedHashMap<>();

        countries.put("IN", "India");
        countries.put("US", "United States");
        countries.put("UK", "United Kingdom");

        for (Map.Entry<String, String> entry : countries.entrySet()) {
            System.out.println(entry.getKey() + " -> " + entry.getValue());
        }
    }
}
```

🟢 **Output**:

```
IN -> India
US -> United States
UK -> United Kingdom
```

➡️ Keeps insertion order.

### Bonus: an LRU cache in six lines

`LinkedHashMap` has a lesser-known constructor that orders by **access** instead of insertion, plus an overridable eviction hook:

```java
class LRUCache<K, V> extends LinkedHashMap<K, V> {
    private final int capacity;

    LRUCache(int capacity) {
        super(16, 0.75f, true);           // true = ACCESS order
        this.capacity = capacity;
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > capacity;         // evict the least recently used
    }
}

var cache = new LRUCache<String, Integer>(3);
cache.put("a", 1); cache.put("b", 2); cache.put("c", 3);
cache.get("a");                            // "a" becomes most-recently-used
cache.put("d", 4);                         // evicts "b", the least recently used
System.out.println(cache.keySet());        // [c, a, d]
```

That's a genuine LRU cache with correct semantics, for free.

---

## 2. 🌲 `TreeMap` – Keys Sorted Automatically

```java
import java.util.Map;
import java.util.TreeMap;

public class TreeMapExample {
    public static void main(String[] args) {
        Map<String, Integer> scores = new TreeMap<>();

        scores.put("Zara", 91);
        scores.put("Alex", 88);
        scores.put("Mira", 95);

        for (Map.Entry<String, Integer> entry : scores.entrySet()) {
            System.out.println(entry.getKey() + ": " + entry.getValue());
        }
    }
}
```

🟢 **Output**:

```
Alex: 88
Mira: 95
Zara: 91
```

➡️ Keys are **automatically sorted** in natural order (`String` order here).

### Navigation methods — the reason to choose `TreeMap`

```java
TreeMap<Integer, String> map = new TreeMap<>(Map.of(
    10, "ten", 20, "twenty", 30, "thirty", 40, "forty"
));

map.firstKey();          // 10
map.lastKey();           // 40
map.firstEntry();        // 10=ten
map.floorKey(25);        // 20  — greatest key ≤ 25
map.ceilingKey(25);      // 30  — smallest key ≥ 25
map.lowerKey(30);        // 20  — strictly less
map.higherKey(30);       // 40  — strictly greater

map.headMap(30);         // {10=ten, 20=twenty}
map.tailMap(30);         // {30=thirty, 40=forty}
map.subMap(20, 40);      // {20=twenty, 30=thirty}

map.descendingMap();     // reversed view
map.pollFirstEntry();    // remove and return the lowest
```

Classic real use: time-series lookups. "What was the price at 14:32?" → `prices.floorEntry(time)`.

```java
TreeMap<LocalDate, Double> prices = new TreeMap<>();
prices.put(LocalDate.of(2026, 1, 1), 100.0);
prices.put(LocalDate.of(2026, 3, 1), 120.0);

// Price in effect on Feb 15th = the most recent entry at or before that date
System.out.println(prices.floorEntry(LocalDate.of(2026, 2, 15)).getValue());  // 100.0
```

### Custom key ordering

```java
Map<String, Integer> caseInsensitive = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
caseInsensitive.put("Apple", 1);
System.out.println(caseInsensitive.get("APPLE"));   // 1

Map<String, Integer> descending = new TreeMap<>(Comparator.reverseOrder());
```

> ⚠️ Like `TreeSet`, a `TreeMap` decides key equality by `compareTo`/`Comparator` returning 0 — **not** by `equals`. Keep them consistent.

---

## 3. 🧠 Real-World Use Case: Grouping by Department (Like SQL GROUP BY)

```java
import java.util.*;

public class GroupingExample {
    public static void main(String[] args) {
        // Simulate list of employees
        List<Employee> employees = List.of(
            new Employee("Alice", "HR"),
            new Employee("Bob", "IT"),
            new Employee("Charlie", "HR"),
            new Employee("David", "Finance"),
            new Employee("Eve", "IT")
        );

        // Group employees by department
        Map<String, List<String>> departmentMap = new HashMap<>();

        for (Employee emp : employees) {
            departmentMap
                .computeIfAbsent(emp.department, k -> new ArrayList<>())
                .add(emp.name);
        }

        // Print the grouped result
        for (Map.Entry<String, List<String>> entry : departmentMap.entrySet()) {
            System.out.println(entry.getKey() + ": " + entry.getValue());
        }
    }
}

class Employee {
    String name;
    String department;

    Employee(String name, String department) {
        this.name = name;
        this.department = department;
    }
}
```

🟢 **Output**:

```
HR: [Alice, Charlie]
IT: [Bob, Eve]
Finance: [David]
```

### How `computeIfAbsent` works, line by line

```java
departmentMap.computeIfAbsent(emp.department, k -> new ArrayList<>()).add(emp.name);
//            └─────────┬──────────────────┘  └────────┬──────────┘  └──────┬─────┘
//    1. Is "HR" a key?                        2. If not, run this        3. Add to
//       If yes → return the existing list.       to create a new list       whatever
//       If no  → run the function, store            and store it.           came back.
//                the result, return it.
```

It's atomic in the sense that you never end up with the "check then put" race between the two lookups. And it collapses four lines into one.

### The same thing with Streams

```java
Map<String, List<String>> byDept = employees.stream()
    .collect(Collectors.groupingBy(
        e -> e.department,
        Collectors.mapping(e -> e.name, Collectors.toList())));
```

See [Stream API](./32-stream-api.md).

---

## 4. How `HashMap` works internally

Worth knowing, and a very common interview question.

```
      buckets (an array, default length 16)
   ┌───┬───┬───┬───┬───┬───┬───┬───┐
   │ 0 │ 1 │ 2 │ 3 │ 4 │ 5 │...│15 │
   └───┴─┬─┴───┴─┬─┴───┴───┴───┴───┘
         │       │
         ▼       ▼
      [k1,v1]  [k3,v3] → [k7,v7]      ← a collision chain
```

**`put(key, value)`:**
1. Compute `key.hashCode()`.
2. Spread the bits (`h ^ (h >>> 16)`) so poor hash functions still distribute well.
3. `index = hash & (capacity - 1)` — a fast modulo, which is why capacity is always a power of 2.
4. If the bucket is empty → store the entry.
5. If not → walk the chain, comparing with `equals()`. Replace on match; append otherwise.

**`get(key)`:** same steps 1–3, then walk the chain comparing with `equals()`.

**Treeification (Java 8+):** if one bucket's chain exceeds 8 entries (and capacity ≥ 64), it converts to a **red-black tree**, so worst-case lookup degrades to O(log n) rather than O(n). This was added specifically to blunt hash-collision denial-of-service attacks.

**Resizing:** when `size > capacity * loadFactor` (default 0.75), capacity doubles and every entry is rehashed. So:

```java
Map<String, Integer> m = new HashMap<>(1000);   // pre-size if you know roughly how many
```

### Why keys must be immutable

```java
class MutableKey {
    int value;
    MutableKey(int v) { value = v; }
    public int hashCode() { return value; }
    public boolean equals(Object o) { return o instanceof MutableKey k && k.value == value; }
}

Map<MutableKey, String> map = new HashMap<>();
MutableKey key = new MutableKey(1);
map.put(key, "hello");

key.value = 2;                         // 😱 the hash code just changed

System.out.println(map.get(key));      // null — it's looking in the wrong bucket
System.out.println(map.size());        // 1   — it's still in there, unreachable
```

**Use immutable types as keys.** `String`, `Integer`, enums and [records](./19-records.md) are all safe. A mutable class with `equals`/`hashCode` over mutable fields is a trap.

---

## 5. Choosing a Map

| Need | Use |
| :-- | :-- |
| General purpose, fastest | `HashMap` |
| Predictable iteration order | `LinkedHashMap` |
| LRU cache | `LinkedHashMap` with access-order + `removeEldestEntry` |
| Sorted keys, range queries | `TreeMap` |
| Enum keys | `EnumMap` |
| Concurrent access | `ConcurrentHashMap` |
| Small, fixed, immutable | `Map.of(...)` |

---

## 6. Worked example

```java
import java.util.*;

public class MapDemo {
    public static void main(String[] args) {
        String text = "the quick brown fox jumps over the lazy dog the fox";
        String[] words = text.split(" ");

        // 1. Word frequency — merge
        Map<String, Integer> freq = new HashMap<>();
        for (String w : words) freq.merge(w, 1, Integer::sum);
        System.out.println(freq.get("the"));            // 3

        // 2. Sorted by key — TreeMap
        System.out.println(new TreeMap<>(freq));
        // {brown=1, dog=1, fox=2, jumps=1, lazy=1, over=1, quick=1, the=3}

        // 3. Sorted by VALUE descending — needs a list of entries
        List<Map.Entry<String, Integer>> byCount = new ArrayList<>(freq.entrySet());
        byCount.sort(Map.Entry.<String, Integer>comparingByValue().reversed()
                              .thenComparing(Map.Entry.comparingByKey()));
        byCount.stream().limit(3).forEach(e ->
            System.out.println(e.getKey() + ": " + e.getValue()));
        // the: 3
        // fox: 2
        // brown: 1

        // 4. Group words by first letter — computeIfAbsent + LinkedHashMap for order
        Map<Character, List<String>> byLetter = new LinkedHashMap<>();
        for (String w : words) {
            byLetter.computeIfAbsent(w.charAt(0), k -> new ArrayList<>()).add(w);
        }
        System.out.println(byLetter.get('f'));          // [fox, fox]

        // 5. Invert the map (values may collide, so collect to a list)
        Map<Integer, List<String>> inverted = new TreeMap<>();
        freq.forEach((k, v) -> inverted.computeIfAbsent(v, x -> new ArrayList<>()).add(k));
        System.out.println(inverted.get(3));            // [the]
    }
}
```

---

## 🧠 Rapid-fire recall

1. Why is `Map` not a subtype of `Collection`?
2. Why is `for (K k : map.keySet()) map.get(k)` worse than iterating `entrySet()`?
3. What does `map.merge(k, 1, Integer::sum)` do, and what does it replace?
4. What does `computeIfAbsent` return, and why does that make grouping a one-liner?
5. Walk through what `HashMap.put` does, from `hashCode()` to storing the entry.
6. What happens when one `HashMap` bucket exceeds 8 entries, and why was that added?
7. Why must `HashMap` keys be immutable?

<details>
<summary>Answers</summary>

1. Its element is a key–value pair, so it can't satisfy `Collection`'s single-element contract. It exposes collection *views* instead.
2. It performs two hash lookups per iteration (one to iterate, one to `get`); `entrySet()` gives you both key and value from one.
3. Stores 1 if the key is absent, otherwise replaces the value with `old + 1`. It replaces the containsKey/get/put counting boilerplate.
4. The value — existing or newly created — which lets you chain `.add(...)` directly onto it.
5. Compute `hashCode()`, spread the bits, mask to a bucket index, then store in the empty bucket or walk the chain comparing with `equals()` to replace or append.
6. It converts to a red-black tree (given capacity ≥ 64), making worst-case lookup O(log n). It was added to defend against hash-collision DoS attacks.
7. If a key's fields change, its hash code changes, so it hashes to a different bucket and becomes unreachable while still occupying the map.

</details>
