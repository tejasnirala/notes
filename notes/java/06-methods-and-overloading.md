---
title: Methods & Method Overloading
author: Tejas Nirala
---

# Methods & Method Overloading

A method is a named block of code that takes inputs, does something, and (optionally) gives back a result. In Java there are **no free-standing functions** — every method lives inside a class.

---

## 1. Anatomy of a method

```java
public static int add(int a, int b) {
    return a + b;
}
//  │      │     │   │       │
//  │      │     │   │       └── parameter list
//  │      │     │   └────────── method name
//  │      │     └────────────── return type
//  │      └──────────────────── modifiers (static, final, abstract…)
//  └─────────────────────────── access modifier
```

Full general form:

```
[access] [modifiers] returnType name(parameters) [throws Exceptions] { body }
```

```java
public static void main(String[] args) { }
private double calculateInterest(double principal, int years) { }
protected abstract void render();
public String readFile(String path) throws IOException { }
```

### `void` means "returns nothing"

```java
void greet(String name) {
    System.out.println("Hello, " + name);
    // no return value; a bare `return;` may be used to exit early
}
```

### Every non-void path must return

```java
int max(int a, int b) {
    if (a > b) return a;
    // ❌ compile error: missing return statement
}
```

The compiler proves that *every* path returns. Add `else return b;` or a trailing `return b;`.

---

## 2. Calling methods

```java
class Calculator {
    // Instance method — needs an object
    int add(int a, int b) { return a + b; }

    // Static method — belongs to the class
    static int square(int x) { return x * x; }
}

public class Main {
    public static void main(String[] args) {
        Calculator c = new Calculator();
        System.out.println(c.add(2, 3));            // 5   — via an object
        System.out.println(Calculator.square(4));   // 16  — via the class
    }
}
```

---

## 3. Java is *always* pass-by-value

This confuses almost everyone, so let's be precise.

**When you pass a primitive, the value is copied.**

```java
static void change(int x) {
    x = 99;
}

int a = 5;
change(a);
System.out.println(a);    // 5 — unchanged
```

**When you pass an object, the *reference* is copied.** The copy points at the same object, so you can *mutate* the object — but you cannot make the caller's variable point somewhere else.

```java
static void mutate(StringBuilder sb) {
    sb.append(" World");     // ✅ mutates the shared object
}

static void reassign(StringBuilder sb) {
    sb = new StringBuilder("Something else");  // ❌ only rebinds the local copy
}

StringBuilder s = new StringBuilder("Hello");
mutate(s);
System.out.println(s);      // "Hello World"

reassign(s);
System.out.println(s);      // still "Hello World"
```

```
Before reassign():                  Inside reassign():
 caller s ●───▶ [Hello World]        caller s ●───▶ [Hello World]
                                     param  sb ●───▶ [Something else]
                                     (the caller never sees this)
```

> **Say it exactly like this in an interview:** "Java is strictly pass-by-value. For reference types, the *value being passed* is the reference itself."

---

## 4. Recursion

A method that calls itself. Every recursion needs a **base case** to stop.

```java
static int factorial(int n) {
    if (n <= 1) return 1;            // base case
    return n * factorial(n - 1);     // recursive case
}

System.out.println(factorial(5));    // 120
```

How it unwinds on the call stack:

```
factorial(5)
  → 5 * factorial(4)
       → 4 * factorial(3)
            → 3 * factorial(2)
                 → 2 * factorial(1)
                      → 1              ← base case
                 ← 2
            ← 6
       ← 24
  ← 120
```

Forget the base case and you get `StackOverflowError` — the per-thread stack runs out of frames.

---

## 5. Method Overloading

### 1. What is Method Overloading?

**Method Overloading** is a feature in Java where **multiple methods in the same class** can have the **same name** but **different parameters** (number, type, or order).

> ✅ It helps in increasing readability, flexibility, and reusability.

---

### 2. Rules for Method Overloading

You can overload a method by changing:

| Rule | Description | Example |
| --- | --- | --- |
| ✅ Number of Parameters | Different number of arguments | `sum(int, int)` vs `sum(int, int, int)` |
| ✅ Type of Parameters | Same number, different types | `sum(int, int)` vs `sum(double, double)` |
| ✅ Order of Parameters | Different order of types | `sum(int, double)` vs `sum(double, int)` |

> ❌ **Changing return type only is not valid for overloading.**

The set of things that distinguishes one method from another is called its **signature**: the *name* plus the *parameter types in order*. Return type, parameter *names*, and access modifiers are **not** part of the signature.

---

### 3. Examples with Output

#### ✅ Example 1: Overloading by number of parameters

```java
class Calculator {
    void sum(int a, int b) {
        System.out.println("Sum: " + (a + b));
    }

    void sum(int a, int b, int c) {
        System.out.println("Sum: " + (a + b + c));
    }

    public static void main(String[] args) {
        Calculator calc = new Calculator();
        calc.sum(5, 10);       // 15
        calc.sum(5, 10, 15);   // 30
    }
}
```

---

#### ✅ Example 2: Overloading by type of parameters

```java
class Printer {
    void print(String s) {
        System.out.println("Printing string: " + s);
    }

    void print(int i) {
        System.out.println("Printing int: " + i);
    }
}

class Main {
    public static void main(String[] args) {
        Printer p = new Printer();
        p.print("Tejas");  // Printing string: Tejas
        p.print(100);      // Printing int: 100
    }
}
```

---

#### ✅ Example 3: Overloading by order of parameters

```java
class Display {
    void show(String name, int age) {
        System.out.println(name + " is " + age + " years old");
    }

    void show(int age, String name) {
        System.out.println("Age: " + age + ", Name: " + name);
    }
}

class Main {
    public static void main(String[] args) {
        Display d = new Display();
        d.show("Tejas", 25);  // Tejas is 25 years old
        d.show(25, "Tejas");  // Age: 25, Name: Tejas
    }
}
```

---

### 4. Invalid Overloading: Only Return Type Changed

```java
class Test {
    int show() { return 1; }
    // String show() { return "hello"; } ❌ Compile-time error
}
```

> 🚫 You cannot overload only by changing the return type — the compiler won't know which one to call.

Think about the call site: `show();` on its own is a valid statement. If two methods differed only by return type, the compiler would have no information to pick between them.

---

### 5. Method Overloading & Type Promotion

Java promotes smaller types **(byte → short → int → long → float → double)** automatically if no exact match is found.

#### Example:

```java
class Promote {
    void display(int a) {
        System.out.println("int method");
    }

    void display(double d) {
        System.out.println("double method");
    }

    public static void main(String[] args) {
        Promote p = new Promote();
        p.display('A');  // int method     => char  → int
        p.display(5.5f); // double method  => float → double
    }
}
```

**The resolution order the compiler uses** (first match wins):

1. **Exact match** on the declared type.
2. **Widening primitive conversion** (`int` → `long` → `float` → `double`).
3. **Autoboxing / unboxing** (`int` → `Integer`).
4. **Varargs**.

Which explains this famously confusing case:

```java
class Resolve {
    static void f(long x)      { System.out.println("long"); }
    static void f(Integer x)   { System.out.println("Integer"); }
    static void f(int... x)    { System.out.println("varargs"); }

    public static void main(String[] args) {
        f(5);   // prints "long" — widening beats boxing, which beats varargs
    }
}
```

---

### 6. Overloading with Varargs

```java
class VarargExample {
    void print(String... values) {
        for (String s : values) {
            System.out.print(s + " ");
        }
    }

    public static void main(String[] args) {
        new VarargExample().print("Java", "Python", "C++");  // Java Python C++
    }
}
```

> Note: Varargs method should be the last parameter if used.

---

### 🧠 Logical Insight: Why Overload?

Imagine a utility method:

```java
void log(String msg);
void log(String msg, int level);
void log(String msg, boolean debug);
```

> Same intention, but different inputs. Overloading improves code clarity and keeps method names meaningful without having to create `log1()`, `log2()`, etc.

You've been using overloaded methods since your first line of Java: `System.out.println` has **10 overloads** (`int`, `long`, `char`, `char[]`, `double`, `boolean`, `String`, `Object`, and two more). That's why it "just works" with anything you throw at it.

---

### 7. Overloading vs Overriding (Quick Difference)

| **Feature** | **Method Overloading** | **Method Overriding** |
| --- | --- | --- |
| Scope | Within same class | Between superclass & subclass |
| Signature | Must differ | Must be exactly same |
| Return type | Can be same or different | Must be same or covariant |
| Polymorphism Type | Compile-time (Static) | Runtime (Dynamic) |
| Access Modifier | No restriction | Cannot reduce visibility |

---

### ✅ Summary

- **Method Overloading** = Same name, different parameters.
- Improves code readability and usability.
- Resolved **at compile time**.
- Cannot overload only by return type.
- Supports type promotion and varargs.

---

## 6. Good method design (short version)

- **One job per method.** If you need "and" to describe it, split it.
- **Keep it short.** If it doesn't fit on a screen, it's doing too much.
- **Name it as a verb phrase:** `calculateTotal()`, `isValid()`, `findUserById()`.
- **Few parameters.** More than 3–4 usually means a parameter object is warranted.
- **Return early** instead of nesting deep `if` blocks:

```java
// 😖 Nested
double discount(Order o) {
    if (o != null) {
        if (o.isActive()) {
            if (o.total() > 100) {
                return o.total() * 0.1;
            }
        }
    }
    return 0;
}

// 😊 Guard clauses
double discount(Order o) {
    if (o == null)        return 0;
    if (!o.isActive())    return 0;
    if (o.total() <= 100) return 0;
    return o.total() * 0.1;
}
```

---

## 🧠 Rapid-fire recall

1. Is Java pass-by-value or pass-by-reference? Justify the answer with an example.
2. What exactly makes up a method's *signature*?
3. Why can't you overload on return type alone?
4. Given `f(int)` and `f(double)`, which does `f('A')` call and why?
5. What is the resolution order the compiler uses for overloads?
6. What error do you get from unbounded recursion?
7. Where must a varargs parameter go, and how many can a method have?

<details>
<summary>Answers</summary>

1. Always pass-by-value. For objects, the *reference* is what gets copied — so you can mutate the object but not rebind the caller's variable.
2. The method name plus the ordered list of parameter types. Not the return type, not parameter names.
3. The compiler couldn't disambiguate a call whose result is discarded, e.g. `show();`.
4. `f(int)` — `char` widens to `int`, and widening is preferred over widening to `double`.
5. Exact match → widening → boxing/unboxing → varargs.
6. `StackOverflowError`.
7. Last position, and at most one per method.

</details>
