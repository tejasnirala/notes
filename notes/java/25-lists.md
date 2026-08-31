---
title: Lists & ArrayList
author: Tejas Nirala
---

# ArrayList in Java

`ArrayList` is a **resizable array implementation** of the `List` interface in Java, found in `java.util` package. Unlike regular arrays, it can **grow or shrink** dynamically at runtime.

---

## 🔧 Declaration & Initialization

```java
import java.util.ArrayList;

ArrayList<String> list = new ArrayList<>();
```

You can also use the interface type:

```java
List<String> list = new ArrayList<>();
```

> **Prefer the second form.** Declaring the variable as `List` means you can swap in a `LinkedList`, an immutable `List.of(...)`, or anything else later without touching a single caller. This is "program to an interface" in one line.

Other ways to create one:

```java
List<String> a = new ArrayList<>();                       // empty
List<String> b = new ArrayList<>(100);                    // with initial capacity
List<String> c = new ArrayList<>(otherCollection);        // copy of another collection
List<String> d = new ArrayList<>(List.of("x", "y"));      // from a literal — MUTABLE
List<String> e = List.of("x", "y");                       // IMMUTABLE (Java 9+)
List<String> f = Arrays.asList("x", "y");                 // FIXED-SIZE view of an array
```

Three different beasts there, and mixing them up is a classic bug:

| | Add/remove | Set element |
| :-- | :-- | :-- |
| `new ArrayList<>(...)` | ✅ | ✅ |
| `Arrays.asList(...)` | ❌ `UnsupportedOperationException` | ✅ (writes through to the array) |
| `List.of(...)` | ❌ | ❌ |

---

## 📦 Common Methods

| Method | Description |
| --- | --- |
| `add(E e)` | Add element at end |
| `add(int index, E e)` | Add element at specific index |
| `get(int index)` | Get element at index |
| `set(int index, E e)` | Replace element |
| `remove(int index)` | Remove by index |
| `remove(Object o)` | Remove by value |
| `contains(Object o)` | Check existence |
| `size()` | Returns size |
| `clear()` | Removes all elements |
| `isEmpty()` | Checks if empty |

### More you'll use

| Method | Description |
| :-- | :-- |
| `indexOf(o)` / `lastIndexOf(o)` | First/last position, or `-1` |
| `addAll(collection)` | Append everything |
| `removeIf(predicate)` | Remove all matching (Java 8+) |
| `subList(from, to)` | A **view** of a range — `[from, to)` |
| `sort(comparator)` | Sort in place (Java 8+) |
| `replaceAll(unaryOp)` | Transform every element in place |
| `forEach(consumer)` | Iterate |
| `toArray(new T[0])` | Convert to an array |
| `stream()` | Start a [Stream](./32-stream-api.md) pipeline |

### The `remove` trap

```java
List<Integer> nums = new ArrayList<>(List.of(10, 20, 30));

nums.remove(1);                    // removes at INDEX 1  → [10, 30]
nums.remove(Integer.valueOf(10));  // removes the VALUE 10 → [30]
```

`remove(int)` and `remove(Object)` are overloads. With a `List<Integer>`, `remove(1)` picks the *index* version. Wrap the value in `Integer.valueOf(...)` when you mean the value.

---

## 🧪 Example

```java
import java.util.ArrayList;

public class ArrayListExample {
    public static void main(String[] args) {
        ArrayList<String> fruits = new ArrayList<>();

        fruits.add("Apple");
        fruits.add("Banana");
        fruits.add("Orange");

        System.out.println("Fruits: " + fruits); // [Apple, Banana, Orange]

        fruits.remove("Banana");
        System.out.println("After removal: " + fruits); // [Apple, Orange]

        System.out.println("First fruit: " + fruits.get(0)); // Apple
        System.out.println("Contains Orange? " + fruits.contains("Orange")); // true

        fruits.set(1, "Mango");
        System.out.println("Updated list: " + fruits); // [Apple, Mango]
    }
}
```

---

## 🔍 Key Points

- Maintains **insertion order**
- Allows **duplicate** elements
- Is **not synchronized** (not thread-safe)
- Backed by an **array** internally
- Default capacity is **10**, and it grows dynamically

---

## 💡 When to Use `ArrayList`

Use it when:

- You need **fast random access** (via `get(index)`)
- You don't do frequent inserts/removals in the **middle** of the list

---

## 5. How resizing actually works

```java
// Simplified from the real java.util.ArrayList
transient Object[] elementData;
private int size;

public boolean add(E e) {
    if (size == elementData.length) {
        grow();
    }
    elementData[size++] = e;
    return true;
}

private void grow() {
    int oldCapacity = elementData.length;
    int newCapacity = oldCapacity + (oldCapacity >> 1);   // 1.5x
    elementData = Arrays.copyOf(elementData, newCapacity);
}
```

So capacity goes `10 → 15 → 22 → 33 → 49 → ...`, and each growth copies the whole array.

**Two consequences:**

**(a) `add` is *amortised* O(1).** Most adds are instant; occasionally one is O(n). Averaged over many adds, it's constant.

**(b) If you know the size, say so:**

```java
List<String> big = new ArrayList<>(10_000);   // no resizing at all
```

Also note: `size` (how many elements) and `capacity` (how big the backing array is) are different things. `size()` is the only one you can see; `trimToSize()` shrinks capacity down to size if memory matters.

### `remove(0)` is O(n)

Removing from the front shifts every remaining element left by one:

```java
list.remove(0);   // System.arraycopy of the entire remaining array
```

Removing 10,000 elements one at a time from the front is 50 million copy operations. If you need front removal, use `ArrayDeque`.

---

## 6. `ArrayList` vs `LinkedList`

| | `ArrayList` | `LinkedList` |
| :-- | :-- | :-- |
| Backing structure | Resizable array | Doubly-linked nodes |
| `get(i)` | **O(1)** | O(n) |
| `add` at end | O(1) amortised | O(1) |
| `add`/`remove` at front | O(n) | **O(1)** |
| `add`/`remove` in middle | O(n) | O(n) to find + O(1) to link |
| Memory per element | just the reference | reference + 2 node pointers (~3x) |
| Cache locality | **excellent** (contiguous) | poor (pointers everywhere) |

**When to use `LinkedList`: almost never.** Even for front insertion, `ArrayDeque` is faster and uses less memory. `LinkedList`'s only real niche is when you're already holding a `ListIterator` at the insertion point.

The reason `ArrayList` wins even where the Big-O says otherwise: modern CPUs read memory in cache lines. Contiguous array elements arrive together; linked nodes scattered across the heap each cost a cache miss, which is ~100x slower than a hit.

---

## 7. Sorting and transforming

```java
List<String> names = new ArrayList<>(List.of("Ravi", "Tejas", "Ankit", "Bo"));

names.sort(null);                                    // natural order
names.sort(Comparator.naturalOrder());               // same thing, clearer
names.sort(Comparator.comparing(String::length));    // by length
names.sort(Comparator.comparing(String::length).reversed());
names.sort(Comparator.comparing(String::length)
                     .thenComparing(Comparator.naturalOrder()));  // tie-break

names.replaceAll(String::toUpperCase);               // in place
System.out.println(names);                            // [BO, RAVI, ANKIT, TEJAS]

names.removeIf(n -> n.length() < 4);
System.out.println(names);                            // [RAVI, ANKIT, TEJAS]
```

More on ordering in [Comparable and Comparator](./28-comparable-and-comparator.md).

---

## 8. `subList` is a view, not a copy

```java
List<Integer> nums = new ArrayList<>(List.of(1, 2, 3, 4, 5));
List<Integer> middle = nums.subList(1, 4);      // [2, 3, 4]

middle.set(0, 99);
System.out.println(nums);        // [1, 99, 3, 4, 5]  ← the original changed!

middle.clear();
System.out.println(nums);        // [1, 5]            ← a handy idiom for range deletion
```

Structurally modifying the *backing* list invalidates the sublist:

```java
nums.add(6);
System.out.println(middle);      // 💥 ConcurrentModificationException
```

For an independent copy: `new ArrayList<>(nums.subList(1, 4))`.

---

## 9. Converting

```java
// List → array
List<String> list = List.of("a", "b");
String[] arr = list.toArray(new String[0]);
Object[] objs = list.toArray();

// array → List
String[] a = {"x", "y"};
List<String> fixed = Arrays.asList(a);                 // fixed-size VIEW
List<String> real  = new ArrayList<>(Arrays.asList(a)); // independent, growable
List<String> immutable = List.of(a);                    // immutable copy

// List<Integer> → int[]
int[] ints = list2.stream().mapToInt(Integer::intValue).toArray();

// int[] → List<Integer>
List<Integer> boxed = Arrays.stream(ints).boxed().toList();
```

---

## 10. Worked example

```java
import java.util.*;

public class ListDemo {
    record Task(String name, int priority, boolean done) { }

    public static void main(String[] args) {
        List<Task> tasks = new ArrayList<>(List.of(
            new Task("Write notes",   2, false),
            new Task("Review PR",     1, false),
            new Task("Deploy",        3, true),
            new Task("Fix bug",       1, false)
        ));

        // Sort: priority ascending, then name alphabetically
        tasks.sort(Comparator.comparingInt(Task::priority)
                             .thenComparing(Task::name));
        tasks.forEach(System.out::println);
        // Task[name=Fix bug, priority=1, done=false]
        // Task[name=Review PR, priority=1, done=false]
        // Task[name=Write notes, priority=2, done=false]
        // Task[name=Deploy, priority=3, done=true]

        // Remove completed
        tasks.removeIf(Task::done);
        System.out.println(tasks.size());          // 3

        // Find
        Optional<Task> urgent = tasks.stream()
                                     .filter(t -> t.priority() == 1)
                                     .findFirst();
        urgent.ifPresent(t -> System.out.println("Next up: " + t.name()));

        // Group — see the Streams chapter
        Map<Integer, List<Task>> byPriority = new TreeMap<>();
        for (Task t : tasks) {
            byPriority.computeIfAbsent(t.priority(), k -> new ArrayList<>()).add(t);
        }
        byPriority.forEach((p, ts) -> System.out.println("P" + p + ": " + ts.size()));
        // P1: 2
        // P2: 1
    }
}
```

---

## 🧠 Rapid-fire recall

1. Why declare `List<String> x = new ArrayList<>()` rather than `ArrayList<String> x = ...`?
2. What's the difference between `List.of(...)`, `Arrays.asList(...)` and `new ArrayList<>(...)`?
3. What does `list.remove(1)` do on a `List<Integer>`, and how do you remove the *value* 1?
4. What is the default capacity, and by what factor does it grow?
5. Why is `add` described as *amortised* O(1)?
6. Why is `LinkedList` usually slower than `ArrayList` even where Big-O favours it?
7. What happens if you modify the backing list while holding a `subList`?

<details>
<summary>Answers</summary>

1. It commits callers to the `List` contract, not a specific implementation, so you can swap the implementation without changing any caller.
2. `List.of` is fully immutable; `Arrays.asList` is a fixed-size view of the array (set works, add/remove throw); `new ArrayList<>` is fully mutable and independent.
3. It removes the element at index 1 (the `remove(int)` overload). Use `list.remove(Integer.valueOf(1))`.
4. 10, growing by 1.5x each time it fills.
5. Most adds are O(1); occasionally one triggers an O(n) array copy, but averaged over many adds the cost is constant.
6. Pointer chasing across scattered heap nodes causes cache misses, while `ArrayList`'s contiguous memory is cache-friendly.
7. The sublist view is invalidated and throws `ConcurrentModificationException` on next use.

</details>
