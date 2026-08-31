---
title: Static in Java
author: Tejas Nirala
---

# `static` in Java

`static` means **"belongs to the class, not to an object."** There is exactly one copy, it exists before any object is created, and every object shares it.

That single sentence explains every rule about `static` — including the errors beginners hit.

---

## 1. The original example, annotated

```java
class Mobile {
  String brand;
  int price;
  static String name;  // static variable

  // Static block is executed only once; when the class is loaded for the first time
  // (inside the class loader).
  static {
    name = "Phone";
    System.out.println("Inside the static block");
  }

  // Constructor is executed every time a new instance is created.
  public Mobile() {
    brand = "";
    price = 200;
    System.out.println("Inside constructor");
  }

  public void show() {
    System.out.println(brand + " : " + price + " : " + name);
  }

  // ❌ Wrong way
  static void show1() {
    // This will start giving error, because Mobile class won't be able to recognize
    // which instance's variable we are trying to access
    System.out.println(brand + " : " + price + " : " + name);
  }

  // ✅ Right way
  static void show2(Mobile obj) {
    System.out.println(obj.brand + " : " + obj.price + " : " + name);
  }

}
```

### Why `show1()` cannot compile

`brand` and `price` are **instance** fields — every `Mobile` object has its own. A static method is called on the *class*:

```java
Mobile.show1();      // there is no object here at all
```

So when the compiler sees `brand` inside `show1()`, it has a fair question: **whose `brand`?** There's no answer, so it's a compile error:

```
non-static variable brand cannot be referenced from a static context
```

`show2(Mobile obj)` fixes it by making the object explicit — now there's no ambiguity.

> **This is exactly why `main` can't touch instance fields directly.** `main` is static.

---

## 2. The four things `static` can apply to

| Applied to | Meaning |
| :-- | :-- |
| **Variable** | One shared copy for the whole class |
| **Method** | Callable on the class, no object needed |
| **Block** | Runs once, when the class is loaded |
| **Nested class** | A nested class that needs no outer instance |

---

## 3. Static variables

```java
class Counter {
    static int totalCreated = 0;   // ONE copy, shared
    int id;                        // one per object

    Counter() {
        totalCreated++;
        id = totalCreated;
    }
}

new Counter();  // totalCreated = 1
new Counter();  // totalCreated = 2
new Counter();  // totalCreated = 3

System.out.println(Counter.totalCreated);   // 3   ← access via the CLASS
```

```
        HEAP (objects)                   CLASS metadata (Metaspace)
   ┌──────────┐ ┌──────────┐ ┌──────────┐   ┌─────────────────────┐
   │ id = 1   │ │ id = 2   │ │ id = 3   │   │ totalCreated = 3    │
   └──────────┘ └──────────┘ └──────────┘   └─────────────────────┘
     three separate copies                    one shared copy
```

You *can* write `myCounter.totalCreated`, and it compiles, but it's misleading — every IDE warns about it. Always use `ClassName.staticField`.

### `static final` = a constant

```java
public class Config {
    public static final int    MAX_CONNECTIONS = 100;
    public static final String APP_NAME = "MyApp";
    public static final double PI = 3.14159;
}

System.out.println(Config.MAX_CONNECTIONS);
```

This is the idiomatic Java constant. You've used many: `Integer.MAX_VALUE`, `Math.PI`, `Thread.MAX_PRIORITY`.

> ⚠️ `static final` on a *reference* freezes the reference, not the object:
> ```java
> public static final List<String> NAMES = new ArrayList<>();
> NAMES.add("oops");            // ✅ allowed — the list is mutable!
> NAMES = new ArrayList<>();    // ❌ not allowed — can't rebind
> ```
> For a genuinely immutable constant list, use `List.of(...)`.

---

## 4. Static methods

```java
class MathUtils {
    static int square(int x) { return x * x; }
    static int max(int a, int b) { return a > b ? a : b; }
}

System.out.println(MathUtils.square(5));   // 25 — no object needed
```

**Rules:**
- ✅ A static method can access static fields and call other static methods.
- ❌ It cannot access instance fields or call instance methods directly.
- ❌ It cannot use `this` or `super` — there is no current object.
- ❌ It cannot be overridden (see §7).

**Use static methods for:** pure utility functions that don't depend on object state. `Math.abs()`, `Integer.parseInt()`, `Arrays.sort()`, `List.of()` are all static.

**Don't use static for:** anything that depends on, or should be swappable per instance. Static methods can't be mocked or polymorphically overridden, which makes them hard to test.

### Factory methods — a very common static pattern

```java
class Temperature {
    private final double celsius;

    private Temperature(double celsius) {   // private constructor
        this.celsius = celsius;
    }

    public static Temperature ofCelsius(double c)    { return new Temperature(c); }
    public static Temperature ofFahrenheit(double f) { return new Temperature((f - 32) * 5 / 9); }
}

Temperature t1 = Temperature.ofCelsius(25);
Temperature t2 = Temperature.ofFahrenheit(77);
```

Two constructors both taking a single `double` would be impossible to distinguish. Named static factory methods solve that, and read better at the call site.

---

## 5. Static blocks

A `static { }` block runs **once**, when the class is loaded, before any object exists and before `main` runs.

```java
class Database {
    static Connection conn;

    static {
        System.out.println("Loading driver...");
        conn = createConnection();
    }
}
```

If a static field needs more than a one-line initializer — a loop, a try/catch, several steps — a static block is where that goes.

```java
class Lookup {
    static final Map<String, Integer> ROMAN = new HashMap<>();

    static {
        ROMAN.put("I", 1);
        ROMAN.put("V", 5);
        ROMAN.put("X", 10);
    }
}
```

Multiple static blocks run in source order. They run **before** the constructor of the first object — always.

---

## 6. Static nested classes

```java
class Outer {
    static class Nested {          // needs no Outer instance
        void hello() { System.out.println("hi"); }
    }

    class Inner { }                // needs an Outer instance
}

Outer.Nested n = new Outer.Nested();          // ✅ direct
Outer.Inner  i = new Outer().new Inner();     // needs an outer object
```

Full treatment on [Inner & Anonymous Classes](./17-inner-and-anonymous-classes.md).

---

## 7. Static methods are *hidden*, not *overridden*

```java
class Parent {
    static void greet()    { System.out.println("Parent static"); }
    void instanceGreet()   { System.out.println("Parent instance"); }
}

class Child extends Parent {
    static void greet()    { System.out.println("Child static"); }
    void instanceGreet()   { System.out.println("Child instance"); }
}

Parent p = new Child();
p.greet();           // "Parent static"    ← chosen by the REFERENCE type (compile time)
p.instanceGreet();   // "Child instance"   ← chosen by the OBJECT type   (runtime)
```

Instance methods use [dynamic dispatch](./11-inheritance-and-polymorphism.md); static methods are resolved at compile time from the reference type. This is called **method hiding**, and it's a favourite trick question.

---

## 8. `static` vs instance — the summary table

| | `static` member | Instance member |
| :-- | :-- | :-- |
| Copies | Exactly one, per class | One per object |
| Lives in | Class metadata (Metaspace) | The object, on the heap |
| Created when | Class is loaded | `new` is called |
| Accessed via | `ClassName.member` | `object.member` |
| Can use `this` | ❌ | ✅ |
| Can access instance members | ❌ (not directly) | ✅ |
| Can access static members | ✅ | ✅ |
| Polymorphic | ❌ (hidden) | ✅ (overridden) |

---

## 9. When *not* to use static

Static is convenient and therefore overused. Two real problems:

**(a) Static mutable state is global state.**

```java
class Session {
    static User currentUser;    // 😱 shared across every thread in the JVM
}
```

Two concurrent web requests will fight over this. Global mutable state is the hardest kind of bug to reproduce.

**(b) Static makes code hard to test.**

```java
class OrderService {
    void placeOrder(Order o) {
        EmailSender.send(o.getEmail(), "Confirmed");   // can't be swapped for a fake
    }
}
```

Versus:

```java
class OrderService {
    private final EmailSender sender;      // injected — tests can pass a stub
    OrderService(EmailSender sender) { this.sender = sender; }

    void placeOrder(Order o) {
        sender.send(o.getEmail(), "Confirmed");
    }
}
```

**Safe uses of static:** constants (`static final`), pure utility functions, factory methods, counters/caches you've thought carefully about.

---

## 🧠 Rapid-fire recall

1. Why can't a static method access an instance field?
2. Why must `main` be static?
3. When does a static block run, relative to a constructor?
4. What does `static final List<String> NAMES = new ArrayList<>();` actually prevent?
5. What's the difference between overriding and hiding?
6. Given `Parent p = new Child();`, which `greet()` runs if it's static? If it's an instance method?
7. Name two reasons to avoid static mutable state.

<details>
<summary>Answers</summary>

1. A static method is invoked on the class, so there is no "current object" to read the field from — the compiler can't tell whose copy you mean.
2. The JVM needs to call it before any object of the class exists.
3. Once, when the class is loaded — always before any constructor of that class runs.
4. Only reassignment of the variable. The `ArrayList` itself is still mutable via `add`/`remove`.
5. Overriding replaces an instance method and is resolved at runtime from the object's type; hiding shadows a static method and is resolved at compile time from the reference type.
6. Static → `Parent.greet()`. Instance → `Child`'s version.
7. It's effectively global state shared across all threads (race conditions, non-reproducible bugs), and it can't be substituted in tests.

</details>
