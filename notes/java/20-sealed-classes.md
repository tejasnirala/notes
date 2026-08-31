---
title: Sealed Classes
author: Tejas Nirala
---

# `Sealed` in Java

A `sealed` class or interface **restricts** which other classes or interfaces may **extend or implement** it.

Introduced in Java 15 as a **preview**, stable from Java 17.

---

## 🧠 Why Use `sealed`?

- To provide **controlled inheritance**.
- To improve **code readability** and **maintainability**.
- Helps the compiler in **exhaustiveness checks**, especially with `switch` expressions (useful in pattern matching).

### The gap it fills

Before sealed types, you had exactly two options:

| | Who can extend it? |
| :-- | :-- |
| a normal class | **anyone** — total openness |
| a `final` class | **nobody** — total closure |

There was no way to say *"exactly these three, and no more."* Sealed types add that third option:

```
   open class  ──────  sealed class  ──────  final class
   anyone extends      a known list          nobody extends
```

That "known list" is what lets the compiler reason exhaustively about your hierarchy.

---

## 🏗️ Syntax:

```java
public sealed class Vehicle permits Car, Truck {
    // common fields and methods
}

public final class Car extends Vehicle {
    // implementation
}

public final class Truck extends Vehicle {
    // implementation
}
```

---

## 🔒 Key Keywords:

| Modifier | Meaning |
| --- | --- |
| `sealed` | The base class/interface – limits who can extend it |
| `permits` | Lists allowed subclasses |
| `non-sealed` | Allows further extension by other classes |
| `final` | Prevents further extension |

---

## ✅ Rules:

1. All permitted subclasses **must be in the same module** (or same package if not modular).
2. All permitted classes **must explicitly declare** themselves as `final`, `sealed`, or `non-sealed`.

That second rule is the important one. Every subclass must make a decision about *its own* openness:

```java
sealed class Shape permits Circle, Square, Polygon { }

final class Circle extends Shape { }                        // closed here
sealed class Polygon extends Shape permits Triangle { }     // continues the sealing
non-sealed class Square extends Shape { }                   // deliberately reopened
final class Triangle extends Polygon { }
```

There is no way to "forget" — the compiler rejects a permitted subclass that declares none of the three.

> **Bonus:** if all permitted subclasses are declared **in the same file**, you can omit `permits` entirely — the compiler infers it.
> ```java
> public sealed interface Shape {
>     record Circle(double r) implements Shape { }
>     record Square(double s) implements Shape { }
> }
> ```

---

## 🧩 Example with Interface:

```java
public sealed interface Shape permits Circle, Square {}

public final class Circle implements Shape {
    // implementation
}

public final class Square implements Shape {
    // implementation
}
```

---

## 🔄 Variants in Inheritance:

```java
public sealed class Animal permits Dog, Cat {}

public final class Dog extends Animal {}

public non-sealed class Cat extends Animal {}
```

Here, `Cat` can be extended by any class, but `Dog` is final.

`non-sealed` is a deliberate escape hatch: "this branch of the hierarchy is open again." It's the only hyphenated keyword in Java.

---

## 💡 When to Use:

- You want to define a **closed hierarchy** but still allow flexibility in certain branches.
- You're designing a **domain model** where only specific types should be valid.

Concretely: whenever the answer to *"what kinds of X are there?"* is a **fixed, known list** that you own.

```java
sealed interface PaymentMethod permits CreditCard, DebitCard, UPI, NetBanking { }
sealed interface Result<T> permits Success, Failure { }
sealed interface Expr permits Literal, Add, Multiply, Negate { }
```

---

## 🧪 Bonus: Helpful in `switch` expressions (Java 17+)

```java
static String handleShape(Shape shape) {
    return switch (shape) {
        case Circle c -> "Circle";
        case Square s -> "Square";
    };
}

```

Since all permitted types are known, the compiler ensures all are covered.

**No `default` branch is needed** — and that's the point. A `default` would silently swallow a new subtype. Without one, adding `Triangle` to the `permits` list makes this method **stop compiling** until you handle it:

```
error: the switch expression does not cover all possible input values
```

That compile error is the whole feature. It converts "we forgot to update that switch" from a production incident into a build failure.

---

## Sealed + records = algebraic data types

Sealed interfaces and [records](./19-records.md) were designed together. Combined, they give you a closed set of shapes each carrying its own data:

```java
sealed interface Shape permits Circle, Rectangle, Triangle { }

record Circle(double radius)                implements Shape { }
record Rectangle(double width, double height) implements Shape { }
record Triangle(double base, double height)   implements Shape { }

static double area(Shape s) {
    return switch (s) {
        case Circle(double r)              -> Math.PI * r * r;
        case Rectangle(double w, double h) -> w * h;
        case Triangle(double b, double h)  -> 0.5 * b * h;
    };
}

static String describe(Shape s) {
    return switch (s) {
        case Circle c when c.radius() > 100 -> "A huge circle";
        case Circle c                        -> "A circle of radius " + c.radius();
        case Rectangle r when r.width() == r.height() -> "Actually a square";
        case Rectangle r                     -> "A " + r.width() + "x" + r.height() + " rectangle";
        case Triangle t                      -> "A triangle";
    };
}
```

Note the `when` guards — extra conditions on a pattern. Order matters: the first matching case wins, so more specific guards must come first.

### A very practical use: a Result type

```java
sealed interface Result<T> permits Success, Failure { }

record Success<T>(T value)          implements Result<T> { }
record Failure<T>(String message)   implements Result<T> { }

static Result<Integer> parse(String s) {
    try {
        return new Success<>(Integer.parseInt(s));
    } catch (NumberFormatException e) {
        return new Failure<>("Not a number: " + s);
    }
}

public static void main(String[] args) {
    for (String input : List.of("42", "abc")) {
        String out = switch (parse(input)) {
            case Success<Integer> s -> "Parsed " + s.value();
            case Failure<Integer> f -> "Error: " + f.message();
        };
        System.out.println(out);
    }
}
// Parsed 42
// Error: Not a number: abc
```

The caller **cannot** forget to handle the failure case — the compiler won't let them.

---

## Sealed vs the alternatives

| Approach | Extensible by anyone? | Exhaustiveness checked? |
| :-- | :-- | :-- |
| Normal interface | ✅ yes | ❌ no |
| `final` class | ❌ no subtypes at all | n/a |
| `enum` | ❌ fixed constants | ✅ yes |
| **`sealed` interface** | ❌ only the permitted list | ✅ yes |

An `enum` gives a fixed set of **values**; a sealed interface gives a fixed set of **types**, each free to carry different data. Use an enum for `Status { ACTIVE, PAUSED }`; use a sealed interface for `Shape { Circle(r), Rectangle(w,h) }`.

---

## When *not* to use sealed

- **Public library APIs meant to be extended.** If third parties should be able to plug in their own implementations, sealing forbids exactly that.
- **Hierarchies that genuinely grow.** If you expect to add subtypes regularly and each addition shouldn't force edits elsewhere, an open interface with polymorphic methods is the better design.

The trade-off in one line:

> **Sealed** makes it easy to add new *operations* over a fixed set of types (just write a new switch).
> **Open polymorphism** makes it easy to add new *types* to a fixed set of operations (just write a new class).

Pick whichever axis you expect to change more.

---

## 🧠 Rapid-fire recall

1. What third option does `sealed` add between a normal class and a `final` class?
2. What must every permitted subclass declare, and why is that rule strict?
3. When can you omit the `permits` clause?
4. Why is a `default` branch counterproductive in a switch over a sealed type?
5. What does `non-sealed` mean, and what's notable about the keyword?
6. What do sealed interfaces plus records give you together?
7. When would sealing be the wrong choice?

<details>
<summary>Answers</summary>

1. "Exactly this known list of subtypes may extend me" — controlled inheritance, rather than fully open or fully closed.
2. `final`, `sealed`, or `non-sealed`. It forces an explicit decision so the hierarchy's boundary can never be left ambiguous.
3. When all permitted subclasses are declared in the same source file — the compiler infers the list.
4. It silently absorbs any newly added subtype, defeating the compile-time exhaustiveness check that is the main benefit.
5. It reopens that branch of the hierarchy for unrestricted extension. It's the only hyphenated keyword in Java.
6. Algebraic data types — a closed set of types each carrying its own data, safely destructured and exhaustively matched in a switch.
7. For public library APIs designed for third-party extension, or hierarchies you expect to grow frequently.

</details>
