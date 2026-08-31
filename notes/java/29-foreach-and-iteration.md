---
title: forEach & Iteration
author: Tejas Nirala
---

# `forEach` in Java

The `forEach` method in Java is used to iterate over elements in a collection (like a `List`, `Set`, or `Map`). It was introduced in **Java 8** as part of the **Stream API** and **Iterable interface**, allowing you to write cleaner and more functional-style code.

---

## ✅ Syntax

```java
collection.forEach(action);
```

- `collection` – Any class implementing `Iterable` (like `List`, `Set`)
- `action` – A lambda expression or method reference implementing `Consumer<T>`

The whole method is four lines in the JDK:

```java
// java.lang.Iterable
default void forEach(Consumer<? super T> action) {
    Objects.requireNonNull(action);
    for (T t : this) {
        action.accept(t);
    }
}
```

So it *is* an enhanced for-loop — just with the body passed in as a function. That's the entire difference, and everything else follows from it.

---

## 📘 Example using List

```java
import java.util.Arrays;
import java.util.List;

public class ForEachExample {
    public static void main(String[] args) {
        List<String> names = Arrays.asList("Tejas", "Ankit", "Ravi");

        // Lambda expression
        names.forEach(name -> System.out.println(name));

        // Method reference (shorter)
        names.forEach(System.out::println);
    }
}
```

---

## 📘 Example using Map

Since `Map` does not implement `Iterable`, you use `forEach` on `entrySet()`:

```java
import java.util.HashMap;
import java.util.Map;

public class MapForEach {
    public static void main(String[] args) {
        Map<String, Integer> scores = new HashMap<>();
        scores.put("Math", 90);
        scores.put("Science", 85);

        // Using lambda
        scores.forEach((subject, score) -> {
            System.out.println(subject + ": " + score);
        });
    }
}
```

Note that `Map` has its **own** two-argument `forEach` taking a `BiConsumer<K, V>` — you don't actually need `entrySet()`:

```java
map.forEach((k, v) -> System.out.println(k + " = " + v));       // ✅ BiConsumer
map.entrySet().forEach(e -> System.out.println(e.getKey()));    // also works
map.keySet().forEach(System.out::println);
map.values().forEach(System.out::println);
```

---

## 🔁 forEach vs Traditional for-loop

| Feature | `forEach` | Traditional `for` loop |
| --- | --- | --- |
| Style | Functional (Java 8+) | Imperative |
| Modification | Cannot break or return early easily | Can break/continue |
| Readability | More concise | More explicit |
| Performance | Similar for small data; may vary for large | |

---

## ⚠️ Limitations

- Cannot use `break`, `continue`, or return to exit early like in a traditional `for` loop.
- Should not be used for modifying the structure of the collection (like removing elements) unless using special iterators.

### Working around "no break"

```java
// ❌ You cannot do this
names.forEach(n -> {
    if (n.equals("Ravi")) break;      // compile error — break isn't in a loop
    System.out.println(n);
});

// ✅ Option 1: use a stream with a short-circuiting terminal operation
names.stream()
     .takeWhile(n -> !n.equals("Ravi"))     // Java 9+
     .forEach(System.out::println);

names.stream().filter(n -> n.startsWith("A")).findFirst();  // stops at the first match

// ✅ Option 2: just use a for-loop. This is not a defeat.
for (String n : names) {
    if (n.equals("Ravi")) break;
    System.out.println(n);
}
```

> **`return` inside a lambda returns from the lambda, not from the enclosing method.** It behaves like `continue`, not like `break`.
> ```java
> names.forEach(n -> {
>     if (n.isEmpty()) return;     // skips THIS element only
>     System.out.println(n);
> });
> ```

### Structural modification during forEach

```java
List<String> list = new ArrayList<>(List.of("a", "b", "c"));
list.forEach(s -> { if (s.equals("b")) list.remove(s); });   // 💥 ConcurrentModificationException

list.removeIf(s -> s.equals("b"));                            // ✅ the right tool
```

---

## `forEach` with **Streams**, **filtering**, and **custom objects**.

## 1. Using `forEach` with Stream and `filter()`

You can combine `stream()`, `filter()`, and `forEach()` for powerful and concise data processing:

```java
import java.util.Arrays;
import java.util.List;

public class StreamFilterExample {
    public static void main(String[] args) {
        List<String> names = Arrays.asList("Tejas", "Ankit", "Ravi", "Amit");

        // Print only names starting with 'A'
        names.stream()
             .filter(name -> name.startsWith("A"))
             .forEach(System.out::println);  // Output: Ankit, Amit
    }
}
```

---

## 2. Using `forEach` with Custom Objects

```java
import java.util.Arrays;
import java.util.List;

class Employee {
    String name;
    int salary;

    Employee(String name, int salary) {
        this.name = name;
        this.salary = salary;
    }
}

public class ForEachWithObjects {
    public static void main(String[] args) {
        List<Employee> employees = Arrays.asList(
            new Employee("Tejas", 50000),
            new Employee("Ankit", 60000),
            new Employee("Ravi", 40000)
        );

        // Print all employee names and salaries
        employees.forEach(emp ->
            System.out.println(emp.name + ": " + emp.salary)
        );
    }
}
```

---

## 3. Using `forEach` with filter on Custom Object

```java
// Print employees with salary > 50000
employees.stream()
         .filter(emp -> emp.salary > 50000)
         .forEach(emp -> System.out.println(emp.name));  // Output: Ankit
```

---

## 4. Using method reference with custom object

If your class has a method like:

```java
class Employee {
    // ...
    void display() {
        System.out.println(name + " - " + salary);
    }
}
```

You can use:

```java
employees.forEach(Employee::display);
```

That last form is an **unbound instance method reference**: `Employee::display` means "for each element, call `display()` on it." The three method-reference shapes are covered in [Functional Interfaces & Method References](./31-functional-interfaces.md).

---

## 5. All the ways to iterate, and when to use each

```java
List<String> names = List.of("Tejas", "Ankit", "Ravi");

// 1. Indexed for — when you need the position, or to modify by index
for (int i = 0; i < names.size(); i++) {
    System.out.println(i + ": " + names.get(i));
}

// 2. Enhanced for — the default for reading elements; supports break/continue
for (String n : names) {
    if (n.startsWith("A")) continue;
    System.out.println(n);
}

// 3. Iterator — when you need to remove while iterating
Iterator<String> it = new ArrayList<>(names).iterator();
while (it.hasNext()) {
    if (it.next().startsWith("A")) it.remove();
}

// 4. ListIterator — bidirectional, plus set() and add()
ListIterator<String> lit = new ArrayList<>(names).listIterator();
while (lit.hasNext()) {
    lit.set(lit.next().toUpperCase());       // replace in place
}

// 5. forEach — concise, no early exit
names.forEach(System.out::println);

// 6. Stream — when you're transforming/filtering/aggregating, not just visiting
names.stream().filter(n -> n.length() > 4).map(String::toUpperCase).forEach(System.out::println);
```

**A practical decision rule:**

| Situation | Use |
| :-- | :-- |
| Need the index | indexed `for` |
| Need `break` or `continue` | enhanced `for` |
| Removing elements while iterating | `Iterator.remove()` or `removeIf` |
| Simple side effect on every element | `forEach` |
| Transforming, filtering, or aggregating | **Stream pipeline** |
| Modifying elements in place by index | `ListIterator` or indexed `for` |

---

## 6. Where `forEach` is genuinely better

**(a) It reads like the intent**

```java
orders.forEach(this::sendConfirmation);
```

**(b) It composes at the end of a pipeline**

```java
orders.stream()
      .filter(Order::isPending)
      .sorted(Comparator.comparing(Order::getDate))
      .forEach(this::process);
```

**(c) The two-arg `Map.forEach` is genuinely nicer than `entrySet()`**

```java
config.forEach((key, value) -> System.out.println(key + "=" + value));
```

---

## 7. `forEach` vs `forEachOrdered`

On a **parallel** stream, `forEach` gives no ordering guarantee at all:

```java
List.of(1, 2, 3, 4, 5).parallelStream().forEach(System.out::println);
// output order is arbitrary: 3 1 4 5 2

List.of(1, 2, 3, 4, 5).parallelStream().forEachOrdered(System.out::println);
// 1 2 3 4 5 — but you've serialised the terminal step, losing much of the benefit
```

On a sequential stream, `forEach` *does* process in encounter order — but the contract doesn't promise it, so don't rely on it if the stream might become parallel.

### And never mutate shared state from a `forEach`

```java
// ❌ Broken under parallelism, and bad style even sequentially
List<String> result = new ArrayList<>();
names.parallelStream().forEach(result::add);      // ArrayList isn't thread-safe

// ✅ Let the stream collect for you
List<String> result = names.stream().toList();
```

---

## 8. Worked example

```java
import java.util.*;

public class IterationDemo {
    record Order(String id, String customer, double amount, boolean paid) { }

    public static void main(String[] args) {
        List<Order> orders = new ArrayList<>(List.of(
            new Order("O1", "Tejas", 250.00, true),
            new Order("O2", "Ankit", 120.50, false),
            new Order("O3", "Ravi",  980.00, false),
            new Order("O4", "Tejas", 45.00,  true)
        ));

        // Simple visit
        orders.forEach(o -> System.out.println(o.id() + ": " + o.amount()));

        // Filter then visit
        orders.stream()
              .filter(o -> !o.paid())
              .forEach(o -> System.out.println("Unpaid: " + o.id()));

        // Aggregate into a map, then iterate it with the BiConsumer form
        Map<String, Double> totals = new HashMap<>();
        orders.forEach(o -> totals.merge(o.customer(), o.amount(), Double::sum));
        totals.forEach((customer, total) ->
            System.out.printf("%s owes %.2f%n", customer, total));

        // Early exit — a for-loop is the right tool here
        for (Order o : orders) {
            if (o.amount() > 500) {
                System.out.println("First large order: " + o.id());
                break;
            }
        }

        // Removing safely
        orders.removeIf(Order::paid);
        System.out.println(orders.size());       // 2

        // Transform in place
        ListIterator<Order> it = orders.listIterator();
        while (it.hasNext()) {
            Order o = it.next();
            it.set(new Order(o.id(), o.customer().toUpperCase(), o.amount(), o.paid()));
        }
        orders.forEach(o -> System.out.println(o.customer()));   // ANKIT, RAVI
    }
}
```

---

## 🧠 Rapid-fire recall

1. What functional interface does `Iterable.forEach` take? What about `Map.forEach`?
2. What does `return` inside a `forEach` lambda do?
3. How do you exit early from an iteration if `forEach` can't `break`?
4. What happens if you remove from a list inside its own `forEach`, and what should you do instead?
5. What's the difference between `forEach` and `forEachOrdered` on a parallel stream?
6. Why is `parallelStream().forEach(list::add)` broken?
7. When should you reach for a plain `for` loop over `forEach`?

<details>
<summary>Answers</summary>

1. `Consumer<T>` for `Iterable.forEach`; `BiConsumer<K, V>` for `Map.forEach`.
2. It returns from the lambda for that element only — it behaves like `continue`, not `break`.
3. Use a stream with a short-circuiting operation (`findFirst`, `anyMatch`, `takeWhile`), or just use a for-loop.
4. `ConcurrentModificationException`. Use `removeIf(...)` or `Iterator.remove()`.
5. `forEach` gives no ordering guarantee on a parallel stream; `forEachOrdered` restores encounter order at the cost of parallelism in that step.
6. `ArrayList` isn't thread-safe, so concurrent `add` calls can corrupt it or lose elements. Use `collect`/`toList()`.
7. When you need the index, `break`/`continue`, or to modify elements by position.

</details>
