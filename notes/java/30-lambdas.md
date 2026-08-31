---
title: Lambda Expressions
author: Tejas Nirala
---

# Lambda Expression in Java

A **lambda expression** in Java is a concise way to represent an **anonymous function** — a function without a name. It is used primarily to implement **functional interfaces** (interfaces with only one abstract method).

Lambda expressions were introduced in **Java 8** as part of the **Java functional programming** paradigm.

---

## 🔹 Syntax of Lambda Expression

```java
(parameter1, parameter2, ...) -> {
    // body
}
```

### Example:

```java
// Without lambda
Runnable r1 = new Runnable() {
    public void run() {
        System.out.println("Running thread...");
    }
};

// With lambda
Runnable r2 = () -> System.out.println("Running thread...");
```

If the body has only one statement, braces `{}` and `return` keyword are optional.

Look at what got deleted: the class name, the `new`, the method name, the parameter types, the `public`, the braces. Everything that was **ceremony** is gone; only the **behaviour** remains. That's the point of lambdas.

---

## 🔹 Basic Examples

### 1. No Parameter

```java
() -> System.out.println("Hello World");
```

### 2. One Parameter

```java
name -> System.out.println("Hello " + name);
```

### 3. Multiple Parameters

```java
(a, b) -> a + b
```

### All the syntactic variations

```java
() -> 42                                  // no params
x -> x * 2                                // one param, parens optional
(x) -> x * 2                              // same thing
(int x) -> x * 2                          // explicit type — parens now REQUIRED
(x, y) -> x + y                           // two params
(var x, var y) -> x + y                   // Java 11+, useful for annotations

x -> x * 2                                // expression body — value is returned
x -> { return x * 2; }                    // block body — `return` is REQUIRED
x -> {                                    // multi-statement block
    int doubled = x * 2;
    System.out.println(doubled);
    return doubled;
}
```

Two rules that cause most beginner errors:
1. **Expression body** → the value is implicitly returned; no `return`, no semicolon inside.
2. **Block body `{}`** → you must write `return` explicitly (unless the interface method is `void`).

You also cannot mix inferred and explicit parameter types:

```java
(int x, y) -> x + y     // ❌ compile error — all or nothing
```

---

## 🔹 Functional Interface Example

You can use lambda only with **functional interfaces**.

```java
@FunctionalInterface
interface MyInterface {
    void show();
}

public class Main {
    public static void main(String[] args) {
        MyInterface obj = () -> System.out.println("Lambda implementation");
        obj.show();
    }
}
```

### The lambda's type is inferred from context

A lambda has **no type of its own**. Its type comes from where you put it — the **target type**:

```java
Runnable r         = () -> System.out.println("hi");   // Runnable
MyInterface m      = () -> System.out.println("hi");   // MyInterface
Callable<Void> c   = () -> { System.out.println("hi"); return null; };  // Callable

var x = () -> System.out.println("hi");   // ❌ compile error — nothing to infer from
```

That last line is worth understanding: `var` needs the right-hand side to have a type, and a lambda's type comes from the left-hand side. Circular, so it's rejected.

The same lambda body can mean different things depending on the target:

```java
interface Adder     { int add(int a, int b); }
interface Combiner  { String add(int a, int b); }

Adder adder = (a, b) -> a + b;               // int addition
// The literal (a,b) -> a+b only compiles for Adder; for Combiner the types don't fit.
```

---

## 🔹 Lambda with Collections

```java
List<String> names = Arrays.asList("Tejas", "Nirali", "Kunal");

names.forEach(name -> System.out.println(name));
```

Or using method reference:

```java
names.forEach(System.out::println);
```

---

## 🔹 With Comparator

```java
List<Integer> nums = Arrays.asList(3, 5, 2, 1, 4);

Collections.sort(nums, (a, b) -> b - a);  // Sort in descending order
```

> ⚠️ As noted in [Comparable & Comparator](./28-comparable-and-comparator.md), `b - a` can overflow for large values. Prefer `(a, b) -> Integer.compare(b, a)` or `Comparator.reverseOrder()`.

---

## 🔹 Behind the Scenes

Lambda expressions are internally converted to **anonymous classes** using `invokedynamic` bytecode instruction and `LambdaMetafactory`.

### More precisely — and this is the part that matters

A lambda is **not** simply compiled into an anonymous class. The compiler:

1. Turns the lambda body into a **private static (or instance) method** of the enclosing class, e.g. `lambda$main$0`.
2. Emits an `invokedynamic` instruction at the use site.
3. At **first execution**, `LambdaMetafactory` spins up an implementation class linking the interface method to that private method, and caches it.

Why this indirection matters in practice:

| | Anonymous class | Lambda |
| :-- | :-- | :-- |
| Extra `.class` file | ✅ one per instance site | ❌ none |
| Object allocated | every time | **stateless lambdas are cached and reused** |
| `this` refers to | the anonymous object | the **enclosing** instance |
| Can have fields | ✅ | ❌ |
| Can implement multi-method interfaces | ✅ | ❌ |

```java
public class Demo {
    private String name = "outer";

    void test() {
        Runnable anon = new Runnable() {
            public void run() { System.out.println(this); }   // the Runnable object
        };
        Runnable lambda = () -> System.out.println(this);      // the Demo object
    }
}
```

Also, because a stateless lambda has no captured state, the JVM can reuse a single instance:

```java
Runnable a = () -> System.out.println("hi");
Runnable b = () -> System.out.println("hi");
// a and b may or may not be the same object — never rely on identity of lambdas
```

---

## 🔹 Advantages of Lambda

✅ Less boilerplate code

✅ More readable

✅ Functional-style programming

✅ Works well with streams and collections

---

## 🔹 Important Notes

- Lambda expressions can only be used where **functional interfaces** are expected.
- They **do not define new types** — just provide an implementation for an existing one.

---

## 4. Variable capture — the "effectively final" rule

A lambda can read local variables from the enclosing scope, but only if they're **final or effectively final** (never reassigned after initialisation).

```java
void demo() {
    String greeting = "Hello";                          // effectively final
    Runnable r = () -> System.out.println(greeting);    // ✅
    r.run();
}

void broken() {
    String greeting = "Hello";
    Runnable r = () -> System.out.println(greeting);    // ❌ compile error
    greeting = "Hi";                                     // ← this reassignment breaks it
}
```

**Why?** The local variable lives on the **stack** and disappears when the method returns; the lambda object lives on the **heap** and may run much later. So the compiler **copies the value** into the lambda. If the original could still change, the copy would silently diverge — so Java forbids the setup rather than allow the confusion.

Instance fields and static fields have no such restriction, because they live on the heap and the lambda captures the *reference*, not a copy:

```java
class Counter {
    private int count = 0;                                // instance field

    void increment(List<String> items) {
        items.forEach(i -> count++);                      // ✅ fine — it's a field
    }
}
```

Workarounds when you need mutable local state:

```java
int[] counter = {0};                            // array reference is effectively final
list.forEach(x -> counter[0]++);                // ✅ mutating the contents

AtomicInteger counter = new AtomicInteger();    // ✅ and thread-safe
list.forEach(x -> counter.incrementAndGet());

// Usually best: don't mutate at all
long count = list.stream().filter(...).count();
```

---

## 5. Lambdas and `this`, revisited with a concrete gotcha

```java
class EventHandler {
    private String name = "handler";

    void register() {
        // Anonymous class — `this` is the Runnable, so `this.name` doesn't exist
        button.onClick(new Runnable() {
            public void run() {
                System.out.println(name);          // ✅ works via the outer reference
                // System.out.println(this.name);  // ❌ Runnable has no `name`
            }
        });

        // Lambda — `this` IS the EventHandler
        button.onClick(() -> System.out.println(this.name));   // ✅
    }
}
```

Lambdas are **lexically scoped**: `this`, variable names, and even `super` mean the same thing inside the lambda as just outside it. Anonymous classes introduce a new scope. This is why converting an anonymous class to a lambda can silently change behaviour if it used `this`.

---

## 6. When *not* to use a lambda

```java
// ❌ A lambda that's longer than a screen — extract a method
list.forEach(item -> {
    // 40 lines of validation, transformation, logging...
});

// ✅
list.forEach(this::processItem);

// ❌ Deeply nested lambdas — unreadable
map.forEach((k, v) -> v.forEach(x -> x.getItems().forEach(i -> { ... })));

// ❌ Needs its own state, or implements a multi-method interface
//    → use an anonymous class or a real class

// ❌ Recursion — a lambda can't reference itself
Function<Integer, Integer> fact = n -> n <= 1 ? 1 : n * fact.apply(n - 1);
// ❌ "variable fact might not have been initialized"
```

**Rule of thumb:** if the lambda is more than about three lines, give it a name.

---

## 7. Worked example — before and after

```java
import java.util.*;
import java.util.function.*;

public class LambdaDemo {
    record Employee(String name, String dept, double salary) { }

    public static void main(String[] args) {
        List<Employee> staff = new ArrayList<>(List.of(
            new Employee("Tejas", "IT", 90000),
            new Employee("Ankit", "HR", 65000),
            new Employee("Ravi",  "IT", 78000)
        ));

        // ── Java 7 style ──────────────────────────────────────────
        Collections.sort(staff, new Comparator<Employee>() {
            @Override
            public int compare(Employee a, Employee b) {
                return Double.compare(b.salary(), a.salary());
            }
        });

        // ── Java 8 lambda ─────────────────────────────────────────
        staff.sort((a, b) -> Double.compare(b.salary(), a.salary()));

        // ── Comparator factory + method reference — clearest of all ─
        staff.sort(Comparator.comparingDouble(Employee::salary).reversed());

        staff.forEach(e -> System.out.printf("%-8s %.0f%n", e.name(), e.salary()));
        // Tejas    90000
        // Ravi     78000
        // Ankit    65000

        // ── Lambdas as values you can pass around ─────────────────
        Predicate<Employee> isIT      = e -> e.dept().equals("IT");
        Predicate<Employee> wellPaid  = e -> e.salary() > 80000;

        // Predicates COMPOSE — this is the real power
        System.out.println(count(staff, isIT));                    // 2
        System.out.println(count(staff, isIT.and(wellPaid)));      // 1
        System.out.println(count(staff, isIT.negate()));           // 1
        System.out.println(count(staff, isIT.or(wellPaid)));       // 2

        // ── Storing behaviour in a Map — no if/else chain ─────────
        Map<String, DoubleUnaryOperator> raises = Map.of(
            "IT", s -> s * 1.10,
            "HR", s -> s * 1.05
        );
        staff.forEach(e -> System.out.printf("%s: %.0f -> %.0f%n",
            e.name(), e.salary(), raises.get(e.dept()).applyAsDouble(e.salary())));
    }

    static long count(List<Employee> list, Predicate<Employee> p) {
        return list.stream().filter(p).count();
    }
}
```

That `Map<String, DoubleUnaryOperator>` is worth staring at: **behaviour stored as data**. Before lambdas, that needed a class per strategy. Now it's a map literal.

---

## 🧠 Rapid-fire recall

1. What must the target type of a lambda always be?
2. Why does `var f = () -> 5;` fail to compile?
3. When is `return` required in a lambda body?
4. What does "effectively final" mean, and why is it required for captured locals?
5. What does `this` refer to inside a lambda, versus inside an anonymous class?
6. Give three cases where you need an anonymous class rather than a lambda.
7. What bytecode instruction implements lambdas, and why isn't a `.class` file generated per lambda?

<details>
<summary>Answers</summary>

1. A functional interface — an interface with exactly one abstract method.
2. A lambda has no type of its own; it takes its type from the target. `var` needs the right-hand side to supply a type, so there's nothing to infer.
3. When the body is a `{ }` block and the interface method returns a value. With an expression body, the value is returned implicitly.
4. Never reassigned after initialisation. The lambda copies the value off the stack, so a later reassignment would make the copy silently diverge.
5. In a lambda, `this` is the enclosing instance (lexical scoping); in an anonymous class it's the anonymous object itself.
6. Extending an abstract class, implementing an interface with multiple abstract methods, and needing instance fields in the implementation (also self-reference/recursion).
7. `invokedynamic` with `LambdaMetafactory`. The body becomes a private method of the enclosing class, and the implementation class is spun up at runtime and cached.

</details>
