---
title: Comparable & Comparator
author: Tejas Nirala
---

# `Comparable` and `Comparator`

`Comparable` and `Comparator` are two interfaces used for **sorting objects**, but they serve different purposes and are used in different scenarios.

---

## 🔸 `Comparable<T>` Interface

**Purpose**:

Defines the **natural ordering** of objects of a class.

**Package**: `java.lang`

**Method to implement**:

```java
int compareTo(T o);
```

**Used when**:

You want the **class itself** to define how it should be compared to other objects of the same type.

---

## ✅ Example: Using `Comparable`

```java
class Student implements Comparable<Student> {
    int rollNo;
    String name;

    Student(int rollNo, String name) {
        this.rollNo = rollNo;
        this.name = name;
    }

    // Natural ordering by roll number
    public int compareTo(Student s) {
        return this.rollNo - s.rollNo;  // ascending order
    }
}
```

## 🔸 Usage:

```java
List<Student> list = new ArrayList<>();
list.add(new Student(3, "John"));
list.add(new Student(1, "Alice"));
list.add(new Student(2, "Bob"));

Collections.sort(list);  // Uses compareTo method
```

---

## The contract you must honour

`compareTo` returns an **int**, and only its *sign* matters:

| Return | Meaning |
| :-- | :-- |
| negative | `this` comes **before** `o` |
| zero | they are **equal** in this ordering |
| positive | `this` comes **after** `o` |

Rules:
1. **Antisymmetric:** `sgn(a.compareTo(b)) == -sgn(b.compareTo(a))`
2. **Transitive:** if `a > b` and `b > c` then `a > c`
3. **Consistent:** if `a.compareTo(b) == 0`, then `a.compareTo(c)` and `b.compareTo(c)` must agree
4. **Strongly recommended:** consistent with `equals` — `a.compareTo(b) == 0` exactly when `a.equals(b)`

Rule 4 isn't enforced, but violating it breaks `TreeSet` and `TreeMap`, which use `compareTo` (not `equals`) to decide duplication. See [Sets](./26-sets.md).

### ⚠️ The subtraction trick overflows

```java
public int compareTo(Student s) {
    return this.rollNo - s.rollNo;      // ⚠️ works for small ints, breaks for large
}
```

```java
int a = Integer.MAX_VALUE, b = -1;
System.out.println(a - b);              // -2147483648 — NEGATIVE! Wrong answer.
```

**Always use the built-in comparators:**

```java
public int compareTo(Student s) {
    return Integer.compare(this.rollNo, s.rollNo);   // ✅ overflow-safe
}
```

`Integer.compare`, `Long.compare`, `Double.compare`, `Boolean.compare` all exist. Use them.

### Classes that already implement `Comparable`

`String` (lexicographic), all wrapper types (numeric), `LocalDate`/`LocalDateTime` (chronological), `BigDecimal`, `enum` (by ordinal). That's why `Collections.sort(listOfStrings)` just works.

---

## 🔸 `Comparator<T>` Interface

**Purpose**:

Used to define **custom or multiple orderings** for a class **without modifying its source code**.

**Package**: `java.util`

**Method to implement**:

```java
int compare(T o1, T o2);
```

**Used when**:

- You want to sort objects **in multiple ways** (e.g., by name, then by age).
- You **can't or don't want to modify the original class**.

---

## ✅ Example: Using `Comparator`

```java
class Student {
    int rollNo;
    String name;

    Student(int rollNo, String name) {
        this.rollNo = rollNo;
        this.name = name;
    }
}
```

### Comparator to sort by name:

```java
class NameComparator implements Comparator<Student> {
    public int compare(Student s1, Student s2) {
        return s1.name.compareTo(s2.name);
    }
}
```

### Usage:

```java
List<Student> list = new ArrayList<>();
list.add(new Student(3, "John"));
list.add(new Student(1, "Alice"));
list.add(new Student(2, "Bob"));

Collections.sort(list, new NameComparator());  // Sorted by name
```

---

## 🔍 Key Differences: `Comparable` vs `Comparator`

| Feature | `Comparable` | `Comparator` |
| --- | --- | --- |
| Package | `java.lang` | `java.util` |
| Method | `compareTo(T o)` | `compare(T o1, T o2)` |
| Sorting Logic | Inside the class | Outside the class |
| Use case | Natural/default sorting | Custom or multiple sortings |
| Can sort by multiple fields? | ❌ (unless coded manually) | ✅ Easily, using multiple comparators |
| Modifies class | ✅ Yes | ❌ No |

**One-line summary:**
> `Comparable` says *"here is how I compare to my own kind."*
> `Comparator` says *"here is how I compare two of those."*

---

## 🔥 Java 8+ Comparator (Lambda & Chaining)

```java
list.sort(Comparator.comparing(Student::getName).thenComparing(Student::getRollNo));
```

This is where `Comparator` became genuinely pleasant to use. The whole factory/chaining API:

### Building a comparator

```java
Comparator.comparing(Student::getName);              // by an object-returning getter
Comparator.comparingInt(Student::getRollNo);         // no boxing — prefer for primitives
Comparator.comparingLong(Order::getTimestamp);
Comparator.comparingDouble(Product::getPrice);

Comparator.naturalOrder();                            // uses Comparable
Comparator.reverseOrder();
```

### Chaining and modifying

```java
Comparator<Student> byNameThenRoll =
    Comparator.comparing(Student::getName)
              .thenComparingInt(Student::getRollNo);

Comparator<Student> byNameDesc =
    Comparator.comparing(Student::getName).reversed();

// Careful — reversed() applies to the WHOLE chain built so far:
Comparator.comparing(Student::getName).thenComparing(Student::getRollNo).reversed();
// = reverse of (name, then roll)

// To reverse only one key:
Comparator.comparing(Student::getName, Comparator.reverseOrder())
          .thenComparingInt(Student::getRollNo);
```

### Null handling

```java
Comparator.nullsFirst(Comparator.naturalOrder());     // nulls sort to the front
Comparator.nullsLast(Comparator.comparing(Student::getName));
```

Without these, a `null` element throws `NullPointerException` mid-sort.

### A custom key extractor

```java
// Sort strings by length, then alphabetically
Comparator<String> c = Comparator.comparingInt(String::length)
                                 .thenComparing(Comparator.naturalOrder());
```

---

## 4. Where comparators get used

```java
List<Student> list = ...;

// Sorting a list
list.sort(byName);                                   // Java 8+, in place
Collections.sort(list, byName);                       // older equivalent

// Sorting an array
Arrays.sort(studentArray, byName);

// Sorted collections
Set<Student> set = new TreeSet<>(byName);
Map<Student, String> map = new TreeMap<>(byName);

// Priority queue
Queue<Student> pq = new PriorityQueue<>(byName);

// Streams
list.stream().sorted(byName).toList();
list.stream().max(byName);
list.stream().min(Comparator.comparingInt(Student::getRollNo));

// Collections utilities
Collections.max(list, byName);
```

---

## 5. Sorting stability

Java's `sort` for objects is **stable**: elements that compare equal keep their original relative order. (It uses TimSort.)

```java
// Sort by department, then by name — two passes, thanks to stability
list.sort(Comparator.comparing(Employee::getName));      // first by name
list.sort(Comparator.comparing(Employee::getDept));      // then by dept; names stay ordered within
```

That trick works, but chaining with `thenComparing` is clearer and does it in one pass.

> Note: `Arrays.sort` for **primitives** uses dual-pivot quicksort and is *not* stable — which doesn't matter, since identical primitives are indistinguishable.

---

## 6. Worked example

```java
import java.util.*;

public class SortDemo {
    record Employee(String name, String dept, int age, double salary)
            implements Comparable<Employee> {

        // Natural order: by name
        @Override
        public int compareTo(Employee o) {
            return name.compareTo(o.name);
        }
    }

    public static void main(String[] args) {
        List<Employee> staff = new ArrayList<>(List.of(
            new Employee("Ravi",  "IT", 31, 92000),
            new Employee("Ankit", "HR", 28, 65000),
            new Employee("Tejas", "IT", 28, 88000),
            new Employee("Bhavna","HR", 35, 71000)
        ));

        // 1. Natural order (Comparable)
        Collections.sort(staff);
        System.out.println(staff.stream().map(Employee::name).toList());
        // [Ankit, Bhavna, Ravi, Tejas]

        // 2. By salary, descending
        staff.sort(Comparator.comparingDouble(Employee::salary).reversed());
        System.out.println(staff.stream().map(Employee::name).toList());
        // [Ravi, Tejas, Bhavna, Ankit]

        // 3. By department, then age ascending, then name
        staff.sort(Comparator.comparing(Employee::dept)
                             .thenComparingInt(Employee::age)
                             .thenComparing(Employee::name));
        staff.forEach(e -> System.out.printf("%-8s %-4s %d%n", e.name(), e.dept(), e.age()));
        // Ankit    HR   28
        // Bhavna   HR   35
        // Tejas    IT   28
        // Ravi     IT   31

        // 4. Department ascending, but salary DESCENDING within it
        staff.sort(Comparator.comparing(Employee::dept)
                             .thenComparing(Employee::salary, Comparator.reverseOrder()));
        System.out.println(staff.stream().map(Employee::name).toList());
        // [Bhavna, Ankit, Ravi, Tejas]

        // 5. TreeSet with a comparator — ordering AND uniqueness by that key
        Set<Employee> byAge = new TreeSet<>(Comparator.comparingInt(Employee::age));
        byAge.addAll(staff);
        System.out.println(byAge.size());     // 3 — Tejas and Ankit are both 28!
        // ⚠️ This is the compareTo-vs-equals trap. Add a tie-breaker:
        Set<Employee> safe = new TreeSet<>(Comparator.comparingInt(Employee::age)
                                                     .thenComparing(Employee::name));
        safe.addAll(staff);
        System.out.println(safe.size());      // 4 ✅

        // 6. Nulls
        List<String> names = new ArrayList<>(Arrays.asList("b", null, "a"));
        names.sort(Comparator.nullsFirst(Comparator.naturalOrder()));
        System.out.println(names);            // [null, a, b]
    }
}
```

---

## 🧠 Rapid-fire recall

1. Which package is each interface in, and what method does each declare?
2. When would you use `Comparator` instead of `Comparable`?
3. Why is `return this.age - other.age;` a bug, and what's the fix?
4. What does it mean for `compareTo` to be "consistent with equals", and what breaks if it isn't?
5. What does `.reversed()` apply to in `comparing(a).thenComparing(b).reversed()`?
6. How do you reverse only one key in a multi-key comparator?
7. What does "stable sort" mean, and how can you exploit it?

<details>
<summary>Answers</summary>

1. `Comparable` is in `java.lang` with `compareTo(T)`; `Comparator` is in `java.util` with `compare(T, T)`.
2. When you can't modify the class, or when you need more than one ordering for the same type.
3. Integer subtraction can overflow (e.g. `MAX_VALUE - (-1)`), producing the wrong sign. Use `Integer.compare(a, b)`.
4. `compareTo` returns 0 exactly when `equals` is true. If it isn't, `TreeSet`/`TreeMap` will treat unequal objects as duplicates and silently drop them.
5. The entire chain built so far — the reverse of "by a, then by b".
6. Pass a comparator as the second argument: `comparing(Foo::a, Comparator.reverseOrder())`.
7. Equal elements keep their original relative order. You can sort by a secondary key first, then a primary key, and the secondary ordering survives within groups.

</details>
