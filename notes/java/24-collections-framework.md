---
title: The Collections Framework
author: Tejas Nirala
---

# The Collections Framework

The Java Collections Framework is the set of interfaces and classes in `java.util` for storing groups of objects. Learn the map of it once and every specific class makes sense.

---

## 1. The hierarchy

```
                      Iterable
                          │
                     Collection                          Map  (NOT a Collection)
        ┌─────────────┬───┴───────┬───────────┐           │
      List           Set        Queue      (Deque)        ├── HashMap
        │             │           │                       ├── LinkedHashMap
   ┌────┼────┐   ┌────┼─────┐   ┌─┴──────┐                ├── TreeMap
ArrayList  │  HashSet  │  TreeSet │  PriorityQueue        └── Hashtable
       LinkedList  LinkedHashSet  ArrayDeque
       Vector/Stack
```

**Two root branches** — and the single most common misconception is thinking `Map` is one of them:

- `Collection` — a group of individual elements. `List`, `Set`, `Queue`.
- `Map` — a group of **key → value** pairs. Not a `Collection` at all, because its "element" is a pair, not a single value.

### The four core interfaces

| Interface | Rule | Ordered? | Duplicates? | Key question it answers |
| :-- | :-- | :-- | :-- | :-- |
| **`List`** | Indexed sequence | ✅ insertion order | ✅ allowed | "What's at position 3?" |
| **`Set`** | Unique elements | depends on impl | ❌ no | "Have I seen this before?" |
| **`Queue`** | Ordered for processing | ✅ FIFO / priority | ✅ allowed | "What do I process next?" |
| **`Map`** | Key → value | depends on impl | keys ❌, values ✅ | "What's the value for this key?" |

---

## 2. Choosing an implementation — the decision tree

```
Do you need key → value pairs?
├── YES → Map
│   ├── Fast lookup, order doesn't matter      → HashMap        ← default
│   ├── Need insertion order preserved         → LinkedHashMap
│   ├── Need keys sorted                       → TreeMap
│   ├── Keys are enum constants                → EnumMap
│   └── Needs to be thread-safe                → ConcurrentHashMap
│
└── NO → Collection
    ├── Do you need duplicates?
    │   ├── NO → Set
    │   │   ├── Fast, order doesn't matter     → HashSet        ← default
    │   │   ├── Insertion order preserved      → LinkedHashSet
    │   │   ├── Sorted                         → TreeSet
    │   │   └── Enum constants                 → EnumSet
    │   │
    │   └── YES → List or Queue
    │       ├── Index access, mostly reading   → ArrayList      ← default
    │       ├── Heavy add/remove at both ends  → ArrayDeque / LinkedList
    │       ├── FIFO processing                → ArrayDeque
    │       └── Highest-priority-first         → PriorityQueue
```

**If in doubt: `ArrayList`, `HashSet`, `HashMap`.** Those three cover the overwhelming majority of real code.

---

## 3. Performance — the table to actually memorise

| Operation | `ArrayList` | `LinkedList` | `HashSet` | `TreeSet` | `HashMap` | `TreeMap` |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `get(index)` | **O(1)** | O(n) | — | — | — | — |
| `add` (end) | O(1)* | **O(1)** | O(1) | O(log n) | O(1) | O(log n) |
| `add` (middle/front) | O(n) | **O(1)**† | — | — | — | — |
| `remove(index)` | O(n) | O(n)† | — | — | — | — |
| `contains` / `get(key)` | O(n) | O(n) | **O(1)** | O(log n) | **O(1)** | O(log n) |
| Memory per element | low | high (2 pointers) | medium | high | medium | high |

\* amortised — occasionally O(n) when the backing array is resized
† O(1) *once you're at the node*; getting there is O(n)

**The practical takeaway:** `LinkedList` is almost always the wrong choice. Its theoretical O(1) insertion requires you to already hold the node, and its pointer-chasing destroys CPU cache locality. `ArrayList` beats it in practice for nearly everything. For queue/deque behaviour, use `ArrayDeque`, not `LinkedList`.

---

## 4. `Iterable` and `Iterator`

Everything under `Collection` implements `Iterable`, which is what makes the enhanced for-loop work:

```java
for (String s : list) { }

// is compiled to exactly:
Iterator<String> it = list.iterator();
while (it.hasNext()) {
    String s = it.next();
}
```

### `ConcurrentModificationException`

```java
List<String> list = new ArrayList<>(List.of("a", "b", "c"));

for (String s : list) {
    if (s.equals("b")) list.remove(s);      // 💥 ConcurrentModificationException
}
```

The iterator tracks a modification count; changing the list behind its back invalidates it. Three correct approaches:

```java
// 1. Iterator.remove() — the classic fix
Iterator<String> it = list.iterator();
while (it.hasNext()) {
    if (it.next().equals("b")) it.remove();      // ✅ the iterator knows about it
}

// 2. removeIf — Java 8+, by far the cleanest
list.removeIf(s -> s.equals("b"));               // ✅

// 3. Iterate a copy
for (String s : new ArrayList<>(list)) {
    if (s.equals("b")) list.remove(s);           // ✅ modifying a different object
}
```

### Making your own class iterable

```java
class Range implements Iterable<Integer> {
    private final int from, to;
    Range(int from, int to) { this.from = from; this.to = to; }

    @Override
    public Iterator<Integer> iterator() {
        return new Iterator<>() {
            private int current = from;
            public boolean hasNext() { return current < to; }
            public Integer next()    { return current++; }
        };
    }
}

for (int i : new Range(1, 5)) System.out.print(i + " ");   // 1 2 3 4
```

---

## 5. Immutable collections

```java
// Java 9+ factory methods — compact and truly immutable
List<String> list = List.of("a", "b", "c");
Set<String>  set  = Set.of("a", "b", "c");
Map<String, Integer> map = Map.of("a", 1, "b", 2);

list.add("d");        // 💥 UnsupportedOperationException
```

Also:

```java
List.copyOf(existingList);           // immutable snapshot
Collections.unmodifiableList(list);  // a read-only VIEW — the original can still change!
```

The difference matters:

```java
List<String> original = new ArrayList<>(List.of("a"));
List<String> view = Collections.unmodifiableList(original);
List<String> copy = List.copyOf(original);

original.add("b");
System.out.println(view);   // [a, b]  ← the view reflects the change
System.out.println(copy);   // [a]     ← the copy is a snapshot
```

Notes on `List.of` / `Map.of`:
- They reject `null` elements (`List.of("a", null)` throws NPE) — this is deliberate.
- `Map.of` takes at most 10 pairs; use `Map.ofEntries(entry(k, v), ...)` beyond that.
- They're memory-optimised for small sizes.

---

## 6. The `Collections` utility class

`java.util.Collections` (plural, with an s) holds static helpers:

```java
List<Integer> nums = new ArrayList<>(List.of(5, 2, 8, 1));

Collections.sort(nums);                       // [1, 2, 5, 8]
Collections.sort(nums, Comparator.reverseOrder());  // [8, 5, 2, 1]
Collections.reverse(nums);
Collections.shuffle(nums);
Collections.swap(nums, 0, 1);

Collections.max(nums);
Collections.min(nums);
Collections.frequency(nums, 5);               // how many 5s
Collections.nCopies(3, "x");                  // [x, x, x]
Collections.emptyList();
Collections.singletonList("only");
Collections.binarySearch(nums, 5);            // list must be sorted
Collections.disjoint(list1, list2);           // true if no elements in common

// Legacy thread-safe wrappers — prefer java.util.concurrent instead
Collections.synchronizedList(list);
```

> Don't confuse `Collections` (the utility class) with `Collection` (the interface), or `Collectors` (the Stream helper).

---

## 7. Bulk operations every `Collection` has

```java
Collection<String> a = new ArrayList<>(List.of("x", "y", "z"));
Collection<String> b = List.of("y", "z", "w");

a.addAll(b);           // union (with duplicates)
a.retainAll(b);        // intersection — keep only what's also in b
a.removeAll(b);        // difference — remove everything in b
a.containsAll(b);      // subset test
a.removeIf(s -> s.startsWith("x"));    // Java 8+
a.forEach(System.out::println);         // Java 8+
a.stream()...                           // → the Stream API
```

---

## 8. Thread-safe collections

`ArrayList`, `HashMap` etc. are **not** thread-safe. Concurrent modification can corrupt them silently.

| Instead of | Use |
| :-- | :-- |
| `HashMap` | `ConcurrentHashMap` |
| `ArrayList` (read-heavy) | `CopyOnWriteArrayList` |
| `HashSet` | `ConcurrentHashMap.newKeySet()` |
| producer/consumer queue | `LinkedBlockingQueue`, `ArrayBlockingQueue` |
| ~~`Vector`, `Hashtable`~~ | legacy — synchronize every method, poor performance |

```java
Map<String, Integer> counts = new ConcurrentHashMap<>();
counts.merge("hits", 1, Integer::sum);       // atomic, thread-safe
```

More in [Executors & Concurrency](./39-executors-and-futures.md).

---

## 9. Legacy classes to avoid

| Class | Why avoid | Use instead |
| :-- | :-- | :-- |
| `Vector` | Synchronizes every method, even single-threaded | `ArrayList` |
| `Stack` | Extends `Vector`, so you can index into it and bypass LIFO | `ArrayDeque` |
| `Hashtable` | Synchronized, no nulls, pre-Collections API | `HashMap` / `ConcurrentHashMap` |
| `Enumeration` | Pre-`Iterator` | `Iterator` |

```java
// ❌ Legacy
Stack<Integer> s = new Stack<>();
s.push(1); s.push(2);
System.out.println(s.get(0));    // 1 — you just violated the entire point of a stack

// ✅ Modern
Deque<Integer> s = new ArrayDeque<>();
s.push(1); s.push(2);
System.out.println(s.pop());     // 2 — LIFO, and no index access to abuse
```

---

## 10. Quick reference

```java
import java.util.*;

// Lists
List<String> list = new ArrayList<>();
list.add("a"); list.add(0, "b"); list.get(0); list.set(0, "c");
list.remove(0); list.remove("a"); list.indexOf("a"); list.subList(0, 2);

// Sets
Set<String> set = new HashSet<>();
set.add("a"); set.contains("a"); set.remove("a");

// Maps
Map<String, Integer> map = new HashMap<>();
map.put("a", 1);
map.get("a");                      // null if absent
map.getOrDefault("z", 0);          // 0 if absent
map.putIfAbsent("a", 9);           // only if not already present
map.computeIfAbsent("b", k -> 0);  // compute and store if absent
map.merge("a", 1, Integer::sum);   // increment a counter — idiomatic
map.remove("a");
map.keySet(); map.values(); map.entrySet();

// Deque (as stack AND queue)
Deque<Integer> dq = new ArrayDeque<>();
dq.push(1); dq.pop();              // stack (LIFO)
dq.offer(1); dq.poll();            // queue (FIFO)
dq.peek();                          // look without removing

// Priority queue
Queue<Integer> pq = new PriorityQueue<>();           // min-heap
pq.addAll(List.of(5, 1, 3));
pq.poll();                                            // 1 — smallest first

Queue<Integer> maxPq = new PriorityQueue<>(Comparator.reverseOrder());
```

---

## 🧠 Rapid-fire recall

1. Why is `Map` not part of the `Collection` hierarchy?
2. What are the three "default" implementations to reach for when unsure?
3. Why is `LinkedList` usually the wrong choice despite its O(1) insertion?
4. What causes `ConcurrentModificationException`, and what are two clean fixes?
5. What's the difference between `List.copyOf(x)` and `Collections.unmodifiableList(x)`?
6. Why avoid `Vector`, `Stack` and `Hashtable`?
7. What does `map.merge("a", 1, Integer::sum)` do?

<details>
<summary>Answers</summary>

1. Its element is a key–value pair, not a single value, so it can't honour the `Collection` contract (`add(E)`, `iterator()` over elements).
2. `ArrayList`, `HashSet`, `HashMap`.
3. The O(1) insertion requires already holding the node — navigating there is O(n) — and pointer chasing destroys cache locality, so `ArrayList` wins in practice.
4. Structurally modifying a collection while iterating it. Use `Iterator.remove()`, `removeIf(...)`, or iterate over a copy.
5. `copyOf` takes an immutable snapshot; `unmodifiableList` returns a read-only *view* that still reflects later changes to the original.
6. They synchronize every method even single-threaded, and `Stack` extends `Vector` so it exposes index access that breaks LIFO semantics.
7. If "a" is absent it stores 1; otherwise it replaces the value with `oldValue + 1`. It's the idiomatic counter increment.

</details>
