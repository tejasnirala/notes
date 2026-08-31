---
title: Records
author: Tejas Nirala
---

# `record` in Java

In Java, a `record` is a **special class type introduced in Java 14 (preview) and officially added in Java 16** to simplify the creation of data-carrying classes, such as DTOs (Data Transfer Objects), without having to write boilerplate code like constructors, getters, `equals()`, `hashCode()`, and `toString()` methods.

---

## 🔹 Syntax:

```java
public record Person(String name, int age) {}
```

This single line is equivalent to writing:

- A class with:
    - `private final` fields
    - A constructor
    - Getter methods
    - `equals()`, `hashCode()`, and `toString()` overrides

### What you'd have had to write by hand

```java
public final class Person {
    private final String name;
    private final int age;

    public Person(String name, int age) {
        this.name = name;
        this.age = age;
    }

    public String name() { return name; }
    public int age()     { return age; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Person p = (Person) o;
        return age == p.age && Objects.equals(name, p.name);
    }

    @Override
    public int hashCode() { return Objects.hash(name, age); }

    @Override
    public String toString() { return "Person[name=" + name + ", age=" + age + "]"; }
}
```

**~30 lines → 1 line**, and the generated version can't have a bug in it. That's the entire value proposition.

---

## 🔹 Example:

```java
public record Person(String name, int age) {}

public class Main {
    public static void main(String[] args) {
        Person p = new Person("Tejas", 25);

        System.out.println(p.name()); // Tejas
        System.out.println(p.age());  // 25

        System.out.println(p);        // Person[name=Tejas, age=25]
    }
}
```

Note the accessor names: `name()` and `age()`, **not** `getName()` and `getAge()`. Records use the field name directly.

---

## 🔹 Key Features:

| Feature | Behavior |
| --- | --- |
| **Immutable** | All fields are `private` and `final` |
| **Canonical Constructor** | Automatically created with all components |
| **Accessors** | Each field gets a getter named exactly like the field (e.g., `name()`) |
| **No Setters** | Fields cannot be changed after creation |
| **Implements `equals`, `hashCode`, `toString`** | Auto-generated |
| **Can implement interfaces** | Yes |
| **Cannot extend a class** | Because `record` implicitly extends `java.lang.Record` |

### Value equality out of the box

```java
Person a = new Person("Tejas", 25);
Person b = new Person("Tejas", 25);

System.out.println(a == b);       // false — different objects
System.out.println(a.equals(b));  // true  ✅ — same components

Set<Person> set = new HashSet<>();
set.add(a);
set.add(b);
System.out.println(set.size());   // 1  ✅ — correct hashCode, so it dedupes properly
```

That's the [`equals`/`hashCode` contract](./16-object-class.md) satisfied for free, which is where most hand-written data classes get it wrong.

---

## 🔹 Use Case:

Best suited for **immutable data structures**, like:

- DTOs
- Value objects
- Configuration models

Plus, in practice:

- **API request/response bodies**
- **Return types for methods that need to return more than one value**
- **Map keys** (correct `hashCode` is guaranteed)
- **Local records** inside a method, for intermediate results in a stream pipeline

```java
// Returning two values without inventing a class file
record MinMax(int min, int max) { }

static MinMax range(int[] values) {
    int min = Arrays.stream(values).min().orElseThrow();
    int max = Arrays.stream(values).max().orElseThrow();
    return new MinMax(min, max);
}

var r = range(new int[]{3, 9, 1});
System.out.println(r.min() + ".." + r.max());   // 1..9
```

```java
// A local record — declared inside a method, Java 16+
void report(List<Order> orders) {
    record Summary(String customer, double total) { }

    orders.stream()
          .map(o -> new Summary(o.customer(), o.total()))
          .sorted(Comparator.comparingDouble(Summary::total).reversed())
          .forEach(s -> System.out.println(s.customer() + ": " + s.total()));
}
```

---

## 🔹 Additional Features (Optional Customization):

You can still add methods, static fields, and custom constructors:

```java
public record Employee(String name, double salary) {
    public Employee {
        if (salary < 0) throw new IllegalArgumentException("Salary cannot be negative");
    }

    public String upperCaseName() {
        return name.toUpperCase();
    }
}
```

### The three kinds of constructor

**(a) Compact constructor** — validation/normalisation only. No parameter list, no assignments; the compiler assigns the fields for you afterwards.

```java
public record Range(int start, int end) {
    public Range {                                   // ← compact: no parentheses list
        if (start > end) throw new IllegalArgumentException("start > end");
    }
}
```

You can also *reassign the parameters* to normalise input — the (possibly modified) values are what get stored:

```java
public record Person(String name, int age) {
    public Person {
        name = name.trim();                          // normalised before assignment
        Objects.requireNonNull(name);
    }
}
```

**(b) Canonical constructor (explicit)** — you write the full thing. Rarely needed, but useful for defensive copies:

```java
public record Team(String name, List<String> members) {
    public Team(String name, List<String> members) {
        this.name = name;
        this.members = List.copyOf(members);         // defensive copy — see §Limitations
    }
}
```

**(c) Additional constructors** — must delegate to the canonical one:

```java
public record Point(int x, int y) {
    public Point(int x) { this(x, 0); }             // convenience overload
    public Point()      { this(0, 0); }
}
```

### Static members and instance methods

```java
public record Money(String currency, BigDecimal amount) {

    public static final Money ZERO_USD = new Money("USD", BigDecimal.ZERO);

    public static Money usd(double amount) {         // static factory
        return new Money("USD", BigDecimal.valueOf(amount));
    }

    public Money plus(Money other) {                 // instance method returning a NEW record
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
        return new Money(currency, amount.add(other.amount));
    }

    public boolean isPositive() { return amount.signum() > 0; }
}
```

### Overriding the generated members

You can override any of them if you need something different:

```java
public record Password(String value) {
    @Override
    public String toString() { return "Password[***]"; }   // don't leak secrets in logs
}
```

---

## 🔸 Limitations:

- Cannot extend other classes
- All fields must be part of the constructor
- Cannot define instance fields other than the record components

More precisely:

- Records are implicitly `final` — nothing can extend a record either.
- No `abstract` records.
- You **can** declare `static` fields, `static` methods, instance methods, nested types, and implement interfaces.

### The shallow-immutability caveat

A record's *fields* are final, but the objects they point to may still be mutable:

```java
record Team(String name, List<String> members) { }

List<String> list = new ArrayList<>(List.of("A", "B"));
Team t = new Team("Alpha", list);

list.add("C");                        // 😱 mutating the list from outside
System.out.println(t.members());      // [A, B, C]  — the record "changed"
```

Fix it with a defensive copy in the compact constructor:

```java
record Team(String name, List<String> members) {
    Team {
        members = List.copyOf(members);      // immutable snapshot
    }
}
```

Same lesson as [`final`](./14-final-keyword.md): final freezes the reference, not the object.

---

## Records in `switch` — pattern matching (Java 21)

Records unlock **record deconstruction patterns**, which is where they become genuinely powerful:

```java
sealed interface Shape permits Circle, Rectangle, Triangle { }

record Circle(double radius) implements Shape { }
record Rectangle(double width, double height) implements Shape { }
record Triangle(double base, double height) implements Shape { }

static double area(Shape shape) {
    return switch (shape) {
        case Circle(double r)              -> Math.PI * r * r;
        case Rectangle(double w, double h) -> w * h;
        case Triangle(double b, double h)  -> 0.5 * b * h;
    };                                       // exhaustive — no default needed
}
```

The components are destructured directly into local variables. Combined with [`sealed`](./20-sealed-classes.md), the compiler guarantees you've covered every case. This is Java's answer to algebraic data types.

Patterns nest, too:

```java
record Point(int x, int y) { }
record Line(Point start, Point end) { }

static String describe(Object o) {
    return switch (o) {
        case Line(Point(var x1, var y1), Point(var x2, var y2)) when x1 == x2
                -> "Vertical line at x=" + x1;
        case Line(Point p1, Point p2)
                -> "Line from " + p1 + " to " + p2;
        default -> "Not a line";
    };
}
```

---

## ✅ Summary:

Use `record` when:

- You need a simple class to carry immutable data
- You want to avoid boilerplate code
- You care about correct `equals()`, `hashCode()`, and `toString()` implementations

### `record` vs `class` vs `enum`

| | `class` | `record` | `enum` |
| :-- | :-- | :-- | :-- |
| Mutable state | ✅ | ❌ | ✅ (but shouldn't) |
| Instances | unlimited | unlimited | fixed set |
| Inheritance | ✅ can extend | ❌ implicitly final | ❌ |
| Implements interfaces | ✅ | ✅ | ✅ |
| Boilerplate | you write it | generated | generated |
| Use for | behaviour, identity, mutability | **data** | **a fixed set of options** |

**Rule of thumb:** if a class is "just data" — no behaviour beyond deriving values from its own fields, no mutable state, and two instances with equal fields *are* the same thing — make it a record.

---

## Worked example

```java
import java.util.*;

public class RecordDemo {

    record Product(String sku, String name, double price, int quantity) {
        Product {
            Objects.requireNonNull(sku);
            if (price < 0)     throw new IllegalArgumentException("Negative price");
            if (quantity < 0)  throw new IllegalArgumentException("Negative quantity");
        }

        double lineTotal() { return price * quantity; }     // derived, not stored

        Product withQuantity(int newQty) {                  // "modify" = new instance
            return new Product(sku, name, price, newQty);
        }
    }

    public static void main(String[] args) {
        List<Product> cart = new ArrayList<>(List.of(
            new Product("A1", "Keyboard", 49.99, 2),
            new Product("B2", "Mouse",    19.99, 1),
            new Product("C3", "Monitor", 199.99, 1)
        ));

        double total = cart.stream().mapToDouble(Product::lineTotal).sum();
        System.out.printf("Cart total: %.2f%n", total);      // 319.96

        // Records print beautifully
        cart.forEach(System.out::println);
        // Product[sku=A1, name=Keyboard, price=49.99, quantity=2]

        // "Updating" produces a new value
        Product p = cart.get(0);
        Product updated = p.withQuantity(5);
        System.out.println(p.quantity() + " -> " + updated.quantity());   // 2 -> 5

        // Value equality just works
        System.out.println(p.equals(new Product("A1", "Keyboard", 49.99, 2)));  // true

        // Safe as a map key
        Map<Product, String> notes = new HashMap<>();
        notes.put(p, "gift wrap");
        System.out.println(notes.get(new Product("A1", "Keyboard", 49.99, 2))); // gift wrap
    }
}
```

---

## 🧠 Rapid-fire recall

1. What five things does `record Person(String name, int age) {}` generate?
2. What's the accessor method called for a component named `age`?
3. What is a compact constructor, and what is it for?
4. Can a record extend a class? Can a class extend a record?
5. Is a record with a `List` field truly immutable? How do you fix it?
6. When should you use a record instead of a regular class?
7. What does `case Circle(double r) ->` do in a switch?

<details>
<summary>Answers</summary>

1. `private final` fields, a canonical constructor, an accessor per component, `equals`, `hashCode` and `toString` (six things, really).
2. `age()` — the component name itself, not `getAge()`.
3. A constructor written without a parameter list, used for validating or normalising the components; the compiler emits the field assignments afterwards.
4. No to both — records implicitly extend `java.lang.Record` and are implicitly `final`.
5. No — the field reference is final but the list contents can still change. Take a defensive copy (`List.copyOf`) in a compact constructor.
6. When the type is pure data: immutable, no behaviour beyond deriving from its own fields, and value equality is the right semantics.
7. It matches a `Circle` and destructures its `radius` component straight into a local variable `r`.

</details>
