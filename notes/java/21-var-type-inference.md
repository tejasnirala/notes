---
title: var — Local Variable Type Inference
author: Tejas Nirala
---

# Local Variable Type Inference (LVTI)

**Local Variable Type Inference in Java (`var`)** was introduced in **Java 10** to simplify variable declarations by allowing the compiler to infer the type of a local variable based on the context.

---

## 🔹 Syntax

```java
var variableName = value;
```

The `var` keyword tells the compiler to infer the type from the value on the right-hand side.

---

## 🔸 Example

```java
var name = "Tejas";        // Inferred as String
var age = 25;              // Inferred as int
var list = new ArrayList<String>(); // Inferred as ArrayList<String>
```

---

## ✅ Where it **can be used**

1. **Local variables** inside methods, constructors, initialization blocks.
2. **Index variable** in enhanced for-loops.
3. **Try-with-resources** statement.

```java
// Inside a method
void greet() {
    var message = "Hello, World!";
    System.out.println(message);
}

// Enhanced for-loop
for (var item : List.of("a", "b", "c")) {
    System.out.println(item);
}

// Try-with-resources
try (var reader = new BufferedReader(new FileReader("file.txt"))) {
    System.out.println(reader.readLine());
}
```

Also valid: the index of a classic `for` loop, and lambda parameters (Java 11+, when you want to annotate them).

```java
for (var i = 0; i < 10; i++) { }                      // ✅ inferred as int

// Java 11+ — useful only when you need an annotation on the parameter
list.forEach((var s) -> System.out.println(s));
```

---

## ❌ Where it **cannot be used**

- As **method parameters** or return types.
- As **instance/class variables**.
- With **null literals** (because type can't be inferred).
- In **lambda parameters** (prior to Java 11 without annotations).

```java
// ❌ Fields
class Bad {
    var name = "x";                     // error: 'var' is not allowed here
}

// ❌ Method parameters and return types
var process(var input) { }              // error

// ❌ No initializer — nothing to infer from
var x;                                  // error: cannot infer type
x = 5;

// ❌ null — the type is genuinely unknown
var y = null;                           // error

// ❌ Array initializer shorthand
var nums = {1, 2, 3};                   // error
var nums = new int[]{1, 2, 3};          // ✅ this works

// ❌ Catch clause
try { } catch (var e) { }               // error
```

---

## 🔍 Points to Remember

- `var` is **not** a keyword, it's a **reserved type name**.
- The **type is still static**, not dynamic like JavaScript or Python.
- Improves **readability** only when the type is obvious.

### `var` is not `let`, and it is definitely not `any`

This is the biggest misconception, especially coming from JavaScript or Python:

```java
var x = 5;
x = "hello";     // ❌ COMPILE ERROR — x is an int, permanently
```

The type is fixed at compile time. Nothing about the runtime changes at all. `var x = 5;` and `int x = 5;` compile to **byte-for-byte identical bytecode**. `var` is purely a source-level convenience.

Because `var` is a reserved *type name* rather than a keyword, this still compiles (for backwards compatibility):

```java
int var = 10;                  // ✅ legal — `var` as a variable name
var var = 10;                  // ✅ also legal, and please never do this
```

---

## 🚫 Bad Usage Example

```java
var x = getSomething(); // Not clear what type x is
```

Prefer:

```java
String result = getSomething();
```

Unless the method name and context make the type very obvious.

---

## ✅ Good Usage Example

```java
var numbers = List.of(1, 2, 3, 4); // Clear it's a List<Integer>
```

---

# Comparison of traditional vs LVTI usage

## 1. Basic Variable Declaration

**🟡 Traditional:**

```java
String message = "Hello, Java!";
```

**🟢 Using `var`:**

```java
var message = "Hello, Java!"; // Inferred as String
```

📌 **Why `var` is okay here**: The type is **obvious** from the string literal.

---

## 2. List Declaration

**🟡 Traditional:**

```java
List<String> names = new ArrayList<>();
```

**🟢 Using `var`:**

```java
var names = new ArrayList<String>();
```

📌 `var` removes redundancy while keeping type inference accurate.

> ⚠️ Note the subtle difference: the traditional form declares the variable as the **interface** `List<String>`; the `var` form infers the **concrete class** `ArrayList<String>`. That matters if you later want to reassign it to a `LinkedList` — you can't. This is one real argument for keeping the explicit type on collection variables.

---

## 3. Map Iteration

**🟡 Traditional:**

```java
for (Map.Entry<String, Integer> entry : map.entrySet()) {
    System.out.println(entry.getKey() + ": " + entry.getValue());
}
```

**🟢 Using `var`:**

```java
for (var entry : map.entrySet()) {
    System.out.println(entry.getKey() + ": " + entry.getValue());
}
```

📌 Clean and readable, especially in loops with complex types.

This is the single best use of `var`. Compare the noise:

```java
Map<String, List<Map<String, Integer>>> data = fetch();

for (Map.Entry<String, List<Map<String, Integer>>> e : data.entrySet()) { }  // 😖
for (var e : data.entrySet()) { }                                            // 😊
```

---

## 4. Working with Streams

**🟡 Traditional:**

```java
Stream<String> stream = list.stream();
```

**🟢 Using `var`:**

```java
var stream = list.stream(); // Inferred as Stream<String>
```

📌 `var` works well when return type is predictable.

---

## 5. Try-With-Resources

**🟡 Traditional:**

```java
try (BufferedReader reader = new BufferedReader(new FileReader("file.txt"))) {
    System.out.println(reader.readLine());
}
```

**🟢 Using `var`:**

```java
try (var reader = new BufferedReader(new FileReader("file.txt"))) {
    System.out.println(reader.readLine());
}
```

📌 Simplifies long declarations, especially for nested generic types.

---

## ⚠️ When **not** to use `var`

```java
var something = getSomething(); // ❌ Unclear type
```

✔️ Better:

```java
User user = getSomething(); // ✅ Clear and self-explanatory
```

---

## 6. The rule that settles every argument

> **Use `var` when the reader can see the type on the same line. Otherwise, write it out.**

```java
// ✅ Type is right there on the line
var user = new User("Tejas");
var names = new ArrayList<String>();
var count = 0;
var total = 0.0;
var entries = map.entrySet();

// ❌ Type is invisible — the reader has to go look up the method
var result = service.process(input);
var x = compute();
var data = repository.find(id);

// ✅ Same calls, made readable
Report result = service.process(input);
BigDecimal x = compute();
Optional<User> data = repository.find(id);
```

A useful test: **could a reviewer understand this line in a diff on GitHub, without an IDE?** If not, write the type.

---

## 7. Two subtle gotchas

### (a) Numeric literals infer narrowly

```java
var a = 1;        // int
var b = 1.0;      // double  — NOT float
var c = 'x';      // char
var d = 1L;       // long
var e = 1.0f;     // float

var count = 0;
count = 3_000_000_000L;    // ❌ error — count is an int
```

If you need a `long`, either write `long count = 0;` or `var count = 0L;`.

### (b) `var` with a diamond gives you `Object`

```java
List<String> a = new ArrayList<>();     // ✅ List<String>
var          b = new ArrayList<>();     // ⚠️ ArrayList<Object> — the diamond has
                                        //    nothing to infer from!
b.add(42);                              // compiles — probably not what you wanted

var c = new ArrayList<String>();        // ✅ be explicit on the right-hand side
```

**Rule:** with `var`, always put the type argument on the right.

---

## 8. Worked comparison

```java
import java.util.*;
import java.util.stream.*;

public class VarDemo {
    record Employee(String name, String dept, double salary) { }

    public static void main(String[] args) {

        // ── Traditional ─────────────────────────────────────────────
        List<Employee> employees = List.of(
            new Employee("Tejas", "IT", 90000),
            new Employee("Ankit", "IT", 85000),
            new Employee("Ravi",  "HR", 70000)
        );

        Map<String, List<Employee>> byDeptOld =
            employees.stream().collect(Collectors.groupingBy(Employee::dept));

        for (Map.Entry<String, List<Employee>> entry : byDeptOld.entrySet()) {
            double total = 0;
            for (Employee e : entry.getValue()) total += e.salary();
            System.out.println(entry.getKey() + ": " + total);
        }

        // ── With var, used well ─────────────────────────────────────
        var byDept = employees.stream().collect(Collectors.groupingBy(Employee::dept));
        //  ^ arguably borderline: the type isn't visible. Judgement call.

        for (var entry : byDept.entrySet()) {          // ✅ clearly a Map entry
            var total = 0.0;                            // ✅ obvious
            for (var e : entry.getValue()) total += e.salary();
            System.out.println(entry.getKey() + ": " + total);
        }
    }
}
```

---

## 🧠 Rapid-fire recall

1. Does `var` make Java dynamically typed? What is `var x = 5; x = "hi";`?
2. Name four places `var` is not allowed.
3. Why can't you write `var x = null;`?
4. What's the difference between `List<String> l = new ArrayList<>()` and `var l = new ArrayList<String>()`?
5. What type does `var b = new ArrayList<>();` infer, and why is that a problem?
6. What type does `var b = 1.0;` infer?
7. State the one-line rule for when to use `var`.

<details>
<summary>Answers</summary>

1. No — the type is inferred once at compile time and then fixed. The reassignment is a compile error.
2. Fields, method parameters, return types, catch clauses, declarations without an initializer, and array-initializer shorthand.
3. `null` carries no type information, so there is nothing for the compiler to infer.
4. The first declares the variable as the `List` interface (reassignable to any `List`); the second infers the concrete `ArrayList` type.
5. `ArrayList<Object>` — the diamond has no target type to infer from, so it falls back to `Object`. Put the type argument on the right instead.
6. `double` — decimal literals default to `double`, not `float`.
7. Use `var` when the type is visible on the same line; otherwise write the type out.

</details>
