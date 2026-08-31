---
title: Sets — HashSet, LinkedHashSet & TreeSet
author: Tejas Nirala
---

# Set in Java

In Java, a **Set** is a part of the **Java Collections Framework** and is an **interface** that represents a **collection of unique elements**—i.e., it **does not allow duplicate values**.

---

## 🔶 Key Points About `Set`:

- **No duplicates allowed**.
- **Order** is not guaranteed (except in some implementations).
- **Null** elements are allowed (at most one `null`).

---

## 🔧 Common Set Implementations:

| Implementation | Order Maintained? | Performance | Allows Null |
| --- | --- | --- | --- |
| `HashSet` | ❌ No order | Fast (hash-based) | ✅ One null |
| `LinkedHashSet` | ✅ Insertion order | Slightly slower than HashSet | ✅ One null |
| `TreeSet` | ✅ Sorted (natural order or comparator) | Slower (tree-based) | ✅ No null |

---

## ✅ Example: `HashSet`

```java
import java.util.HashSet;
import java.util.Set;

public class SetExample {
    public static void main(String[] args) {
        Set<String> fruits = new HashSet<>();
        fruits.add("Apple");
        fruits.add("Banana");
        fruits.add("Mango");
        fruits.add("Apple"); // Duplicate, won't be added

        System.out.println(fruits); // Output: [Banana, Apple, Mango] (order may vary)
    }
}
```

---

## ✅ Example: `LinkedHashSet`

```java
import java.util.LinkedHashSet;
import java.util.Set;

public class LinkedHashSetExample {
    public static void main(String[] args) {
        Set<String> cities = new LinkedHashSet<>();
        cities.add("Delhi");
        cities.add("Mumbai");
        cities.add("Chennai");
        cities.add("Delhi"); // Duplicate

        System.out.println(cities); // Output: [Delhi, Mumbai, Chennai]
    }
}
```

---

## ✅ Example: `TreeSet`

```java
import java.util.Set;
import java.util.TreeSet;

public class TreeSetExample {
    public static void main(String[] args) {
        Set<Integer> numbers = new TreeSet<>();
        numbers.add(30);
        numbers.add(10);
        numbers.add(20);
        numbers.add(10); // Duplicate

        System.out.println(numbers); // Output: [10, 20, 30]
    }
}
```

---

## 🔁 Basic Operations:

| Method | Description |
| --- | --- |
| `add(E e)` | Adds element if not already present |
| `remove(Object o)` | Removes the element if present |
| `contains(Object o)` | Checks if the element exists |
| `isEmpty()` | Checks if set is empty |
| `size()` | Number of elements |
| `clear()` | Removes all elements |

Note that `add` **returns a boolean**: `true` if the element was actually added, `false` if it was already there. That's a handy "have I seen this before?" check in one call:

```java
Set<String> seen = new HashSet<>();
for (String item : items) {
    if (!seen.add(item)) {
        System.out.println("Duplicate: " + item);
    }
}
```

---

# Differences between `HashSet`, `LinkedHashSet`, and `TreeSet`

## 1. `HashSet`

### 📌 Characteristics:

- Backed by a **HashMap**.
- No guarantee of order.
- Allows **one `null`** element.
- Most **efficient** for basic operations (`add`, `remove`, `contains`).

### ⚙️ Time Complexity:

- `add()`, `remove()`, `contains()` → **O(1)** on average

### ✅ Use-case:

- When you need a collection of **unique items** and **don't care about order**.
- Example: Storing unique usernames or IDs.

### 🔍 Example:

```java
Set<String> names = new HashSet<>();
names.add("Alice");
names.add("Bob");
names.add("Charlie");
```

### How it actually works

A `HashSet` is literally a `HashMap` where every value is the same dummy object:

```java
// Simplified from the real java.util.HashSet
private transient HashMap<E, Object> map;
private static final Object PRESENT = new Object();

public boolean add(E e) {
    return map.put(e, PRESENT) == null;
}
```

Which is why uniqueness in a `HashSet` is decided by exactly the same rules as key uniqueness in a `HashMap`: **`hashCode()` first, then `equals()`**.

```java
class Point {
    int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }
    // equals() and hashCode() NOT overridden
}

Set<Point> set = new HashSet<>();
set.add(new Point(1, 2));
set.add(new Point(1, 2));
System.out.println(set.size());   // 2  😱 — they're "different" objects
```

**If your element type doesn't correctly override `equals` and `hashCode`, a `HashSet` cannot deduplicate it.** See [The Object Class](./16-object-class.md), or just use a [`record`](./19-records.md).

---

## 2. `LinkedHashSet`

### 📌 Characteristics:

- Maintains the **insertion order**.
- Internally uses a **linked list + HashMap**.
- Slightly slower than `HashSet`.

### ⚙️ Time Complexity:

- `add()`, `remove()`, `contains()` → **O(1)** on average

### ✅ Use-case:

- When you want **uniqueness** + **preserve the order** in which elements were added.
- Example: Cache where insertion order matters.

### 🔍 Example:

```java
Set<String> tools = new LinkedHashSet<>();
tools.add("Hammer");
tools.add("Wrench");
tools.add("Screwdriver");
// Output order: Hammer, Wrench, Screwdriver
```

The extra doubly-linked list threading through the buckets costs a little memory and a little insert time, in exchange for **predictable iteration order**. That predictability matters more than people expect — it makes tests deterministic and output reproducible.

> **A very common idiom:** deduplicate while preserving order.
> ```java
> List<String> input = List.of("b", "a", "b", "c", "a");
> List<String> unique = new ArrayList<>(new LinkedHashSet<>(input));
> System.out.println(unique);   // [b, a, c]
> ```

---

## 3. `TreeSet`

### 📌 Characteristics:

- Maintains **sorted order** (natural or custom).
- Backed by a **Red-Black Tree (Self-balancing BST)**.
- **Does not allow `null`** (throws `NullPointerException`).

### ⚙️ Time Complexity:

- `add()`, `remove()`, `contains()` → **O(log n)**

### ✅ Use-case:

- When you need **sorted data** (ascending by default).
- Suitable for range queries, like finding elements within a certain range.

### 🔍 Example:

```java
Set<Integer> marks = new TreeSet<>();
marks.add(70);
marks.add(50);
marks.add(90);
// Output order: 50, 70, 90
```

### `TreeSet` uses `compareTo`, not `equals`

This is the subtle one. A `TreeSet` decides duplication by whether `compareTo` returns `0` — it never calls `equals`:

```java
record Person(String name, int age) implements Comparable<Person> {
    public int compareTo(Person o) { return Integer.compare(age, o.age); }
}

Set<Person> set = new TreeSet<>();
set.add(new Person("Tejas", 25));
set.add(new Person("Ankit", 25));    // different name, same age

System.out.println(set.size());       // 1  😱 — compareTo said "equal"
```

Your `compareTo` should be **consistent with `equals`** — return 0 exactly when `equals` returns true — or you'll get surprises like this.

### The navigation methods — the real reason to choose `TreeSet`

```java
TreeSet<Integer> set = new TreeSet<>(List.of(10, 20, 30, 40, 50));

set.first();            // 10
set.last();             // 50
set.floor(35);          // 30  — greatest element ≤ 35
set.ceiling(35);        // 40  — smallest element ≥ 35
set.lower(30);          // 20  — greatest element < 30 (strict)
set.higher(30);         // 40  — smallest element > 30 (strict)

set.headSet(30);        // [10, 20]        — everything < 30
set.tailSet(30);        // [30, 40, 50]    — everything ≥ 30
set.subSet(20, 40);     // [20, 30]        — [20, 40)

set.descendingSet();    // [50, 40, 30, 20, 10]
set.pollFirst();        // removes and returns 10
set.pollLast();         // removes and returns 50
```

`HashSet` can do none of this. If you need "the next value above X" or "everything between X and Y", `TreeSet` is the answer.

### Custom ordering

```java
Set<String> byLength = new TreeSet<>(Comparator.comparing(String::length)
                                                .thenComparing(Comparator.naturalOrder()));
byLength.addAll(List.of("banana", "fig", "apple", "kiwi"));
System.out.println(byLength);   // [fig, kiwi, apple, banana]
```

---

## 📊 Summary Table

| Feature | `HashSet` | `LinkedHashSet` | `TreeSet` |
| --- | --- | --- | --- |
| Order maintained | ❌ No | ✅ Insertion order | ✅ Sorted order |
| Performance | 🔼 Fastest | ⚖️ Medium | 🔽 Slowest |
| Internal structure | HashTable | HashTable + LinkedList | Red-Black Tree |
| Allows null elements | ✅ One | ✅ One | ❌ No nulls |
| Duplicate elements | ❌ Not allowed | ❌ Not allowed | ❌ Not allowed |
| Sorting | ❌ No | ❌ No | ✅ Yes |

Two more rows worth adding:

| Feature | `HashSet` | `LinkedHashSet` | `TreeSet` |
| :-- | :-- | :-- | :-- |
| Uniqueness decided by | `hashCode` + `equals` | `hashCode` + `equals` | **`compareTo` / `Comparator`** |
| Range / navigation queries | ❌ | ❌ | ✅ |

---

## 🧠 When to Use What?

| Scenario | Best Choice |
| --- | --- |
| Fastest access, no order needed | `HashSet` |
| Maintain insertion order | `LinkedHashSet` |
| Need elements in sorted order | `TreeSet` |
| Want to perform range queries (e.g. ≥, ≤) | `TreeSet` |

Plus:

| Scenario | Best Choice |
| :-- | :-- |
| Elements are enum constants | `EnumSet` (bit-vector backed, extremely fast) |
| Concurrent access from many threads | `ConcurrentHashMap.newKeySet()` |
| Immutable, small, fixed | `Set.of(...)` |

---

## 4. Set algebra

```java
Set<Integer> a = new HashSet<>(Set.of(1, 2, 3, 4));
Set<Integer> b = new HashSet<>(Set.of(3, 4, 5, 6));

Set<Integer> union = new HashSet<>(a);
union.addAll(b);                         // [1, 2, 3, 4, 5, 6]

Set<Integer> intersection = new HashSet<>(a);
intersection.retainAll(b);               // [3, 4]

Set<Integer> difference = new HashSet<>(a);
difference.removeAll(b);                 // [1, 2]

Set<Integer> symmetricDiff = new HashSet<>(union);
symmetricDiff.removeAll(intersection);   // [1, 2, 5, 6]

boolean isSubset = b.containsAll(Set.of(3, 4));    // true
boolean disjoint = Collections.disjoint(a, b);      // false
```

> ⚠️ All of `addAll`/`retainAll`/`removeAll` **mutate** the receiver. Always copy first, as above, unless you mean to destroy the original.

---

## 5. Worked example

```java
import java.util.*;

public class SetDemo {
    public static void main(String[] args) {
        List<String> logLines = List.of(
            "user1 login", "user2 login", "user1 logout",
            "user3 login", "user2 logout", "user1 login"
        );

        // Who appeared at all? — HashSet, order irrelevant
        Set<String> users = new HashSet<>();
        for (String line : logLines) users.add(line.split(" ")[0]);
        System.out.println("Distinct users: " + users.size());        // 3

        // In what order did they first appear? — LinkedHashSet
        Set<String> firstSeen = new LinkedHashSet<>();
        for (String line : logLines) firstSeen.add(line.split(" ")[0]);
        System.out.println("First-seen order: " + firstSeen);
        // [user1, user2, user3]

        // Sorted for a report — TreeSet
        Set<String> sorted = new TreeSet<>(users);
        System.out.println("Sorted: " + sorted);                       // [user1, user2, user3]

        // Range query — only TreeSet can do this
        TreeSet<Integer> scores = new TreeSet<>(List.of(45, 67, 72, 88, 91, 95));
        System.out.println("Passing (>= 70): " + scores.tailSet(70));  // [72, 88, 91, 95]
        System.out.println("Closest below 80: " + scores.floor(80));   // 72
        System.out.println("Top score: " + scores.last());             // 95

        // Detecting duplicates using add()'s return value
        Set<String> seen = new HashSet<>();
        for (String line : logLines) {
            if (!seen.add(line)) System.out.println("Repeated line: " + line);
        }
        // Repeated line: user1 login
    }
}
```

---

## 🧠 Rapid-fire recall

1. What does `HashSet` actually use internally, and what does that imply about `equals`/`hashCode`?
2. What does `set.add(x)` return, and what's a use for it?
3. Why does a `HashSet` of a class without `equals`/`hashCode` fail to deduplicate?
4. What decides duplication in a `TreeSet`, and what surprise does that cause?
5. Name four navigation methods only `TreeSet` provides.
6. How do you deduplicate a list while preserving order, in one line?
7. Why must you copy before calling `retainAll` / `removeAll`?

<details>
<summary>Answers</summary>

1. A `HashMap` with a dummy value for every key — so uniqueness is decided by `hashCode()` then `equals()`, exactly as for map keys.
2. `true` if it was actually added, `false` if already present — a one-call "have I seen this?" check.
3. The default `hashCode` is identity-based, so two logically-equal objects land in different buckets and both get stored.
4. `compareTo`/`Comparator` returning 0 — never `equals`. Two objects that aren't `equals` can still be treated as duplicates if the comparator says they tie.
5. `floor`, `ceiling`, `lower`, `higher`, `headSet`, `tailSet`, `subSet`, `first`, `last`, `pollFirst`, `pollLast`.
6. `new ArrayList<>(new LinkedHashSet<>(input))`.
7. They mutate the receiver in place, so calling them on the original destroys it.

</details>
