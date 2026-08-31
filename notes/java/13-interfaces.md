---
title: Interfaces
author: Tejas Nirala
---

# Interface in Java

## 🔷 Definition

An **interface in Java** is a blueprint of a class. It is a reference type, similar to a class, that **only contains abstract methods (by default)** and **constants** (i.e., `public static final` fields). Interfaces are used to achieve **abstraction** and **multiple inheritance** in Java.

Think of an interface as a **contract**: "any class that signs this promises to provide these methods." The contract says nothing about *how*.

---

## 🔸 Key Characteristics of Interfaces

| Feature | Description |
| --- | --- |
| Methods | Abstract by default (till Java 7). From Java 8 onward, can have `default` and `static` methods. |
| Fields | Always `public`, `static`, and `final`. |
| Inheritance | A class implements an interface, an interface extends another interface. |
| Access Modifiers | All methods are `public` by default. |

---

## 🧠 Why Use Interfaces?

- **Abstraction**: Hide implementation and show only method signatures.
- **Multiple Inheritance**: Java doesn't support multiple class inheritance, but multiple interfaces can be implemented.
- **Loose Coupling**: Encourages programming to an interface, not an implementation.

---

## ✅ Syntax

```java
interface Animal {
    void eat(); // abstract method
}
```

```java
class Dog implements Animal {
    public void eat() {
        System.out.println("Dog eats meat");
    }
}
```

Note the `public` on `Dog.eat()` — interface methods are implicitly `public`, and an override can't reduce visibility, so it must be declared `public`.

These modifiers are all implicit and are usually left out:

```java
interface Animal {
    int LEGS = 4;                  // really: public static final int LEGS = 4;
    void eat();                    // really: public abstract void eat();
}
```

---

## 🧪 Example with Multiple Interfaces

```java
interface Flyable {
    void fly();
}

interface Swimmable {
    void swim();
}

class Duck implements Flyable, Swimmable {
    public void fly() {
        System.out.println("Duck can fly");
    }

    public void swim() {
        System.out.println("Duck can swim");
    }
}
```

This is the thing a class hierarchy cannot do. A `Duck` is a `Bird`, but "can fly" and "can swim" are capabilities that cut across the hierarchy — a `Penguin` swims but doesn't fly, a `Fish` swims but isn't a bird at all. Interfaces model capabilities; classes model identity.

---

## 🔹 Default and Static Methods (Java 8+)

```java
interface MyInterface {
    default void show() {
        System.out.println("Default method in interface");
    }

    static void display() {
        System.out.println("Static method in interface");
    }
}
```

Usage:

```java
class Demo implements MyInterface {}

Demo d = new Demo();
d.show(); // default method
MyInterface.display(); // static method
```

### Why `default` methods were added

Backwards compatibility. When Java 8 wanted to add `forEach()` to `Collection`, adding a plain abstract method would have broken **every** implementation of `Collection` ever written, everywhere. A `default` method lets an interface grow without breaking implementers:

```java
public interface Collection<E> extends Iterable<E> {
    default void forEach(Consumer<? super E> action) {   // added in Java 8
        for (E e : this) action.accept(e);
    }
}
```

Existing classes inherit it for free; classes that can do better may override it.

### Resolving conflicting defaults

If two interfaces provide the same default method, the implementing class is **forced** to disambiguate:

```java
interface A { default void hello() { System.out.println("A"); } }
interface B { default void hello() { System.out.println("B"); } }

class C implements A, B {
    @Override
    public void hello() {
        A.super.hello();      // explicitly pick one — note the InterfaceName.super syntax
    }
}
```

Without that override, `class C implements A, B` is a compile error. This is how Java allows "multiple inheritance of behaviour" without reintroducing the Diamond Problem — it just refuses to guess.

**The resolution order** when a method comes from several places:
1. A **class** implementation always wins over an interface default.
2. The **most specific interface** wins (a sub-interface beats its super-interface).
3. Otherwise → compile error; you must override.

### `private` interface methods (Java 9+)

To share code between default methods without exposing it:

```java
interface Logger {
    default void logInfo(String msg)  { log("INFO", msg); }
    default void logError(String msg) { log("ERROR", msg); }

    private void log(String level, String msg) {          // Java 9+
        System.out.println("[" + level + "] " + msg);
    }
}
```

---

## ⚠️ Important Rules

- Interfaces can't have constructors.
- A class must **implement all abstract methods** of the interface unless the class is `abstract`.
- You can use interfaces as **types**.

More rules worth knowing:

- Interfaces cannot have **instance fields** — only `public static final` constants. So no per-object state.
- Interfaces cannot be instantiated: `new Animal()` ❌ — but `new Animal() { ... }` (an [anonymous class](./17-inner-and-anonymous-classes.md)) ✅.
- An interface can `extend` **multiple** interfaces.
- Interface members are implicitly `public`; you cannot make a method `protected` or package-private.

---

## 🧩 Interface Inheritance

```java
interface A {
    void methodA();
}

interface B extends A {
    void methodB();
}

class C implements B {
    public void methodA() { System.out.println("A"); }
    public void methodB() { System.out.println("B"); }
}
```

An interface can extend several at once:

```java
interface Amphibious extends Flyable, Swimmable {
    void land();
}
```

---

## 🔁 Difference: Abstract Class vs Interface

| Feature | Abstract Class | Interface |
| --- | --- | --- |
| Inheritance | Single | Multiple |
| Constructors | Yes | No |
| Fields | Can be non-final | Always `public static final` |
| Methods | Can be abstract or concrete | Only abstract (plus default/static since Java 8) |
| Access Modifiers | Can be any | Only public |

---

## 📌 Use Cases

- APIs (like JDBC, Collection Framework)
- Callbacks
- Event listeners
- Plug-in architectures

---

# Types of Interfaces

Java provides different types of interfaces based on how they are used and declared:

---

## 1. Normal Interface (Regular Interface)

- This is the standard interface with **only abstract methods** (before Java 8).
- Used for abstraction and multiple inheritance.

```java
interface Vehicle {
    void start();
    void stop();
}
```

---

## 2. Functional Interface (SAM Interface)

- Introduced in **Java 8**.
- Contains **only one abstract method** (can have multiple default/static methods).
- Can be used with **lambda expressions** and **method references**.
- Annotated with `@FunctionalInterface` (optional but recommended).

```java
@FunctionalInterface
interface Calculator {
    int add(int a, int b);
}

// Using lambda
Calculator calc = (a, b) -> a + b;
System.out.println(calc.add(5, 3));  // Output: 8
```

✅ **Examples in Java API**: `Runnable`, `Callable`, `Comparator`, `ActionListener`

SAM stands for **S**ingle **A**bstract **M**ethod. The `@FunctionalInterface` annotation doesn't *make* it functional — having exactly one abstract method does. The annotation just tells the compiler to enforce it, so a teammate adding a second abstract method gets a build failure rather than breaking every lambda in the codebase.

This is the bridge to [Lambda Expressions](./30-lambdas.md) — a lambda is *always* an implementation of some functional interface.

---

## 3. Marker Interface

- An interface with **no methods or fields**.
- Used to give **metadata** or special **indication** to classes.
- JVM or frameworks check for presence using `instanceof`.

```java
interface Serializable {}  // Marker interface

class MyClass implements Serializable {}
```

✅ **Examples**: `Serializable`, `Cloneable`, `Remote`

The interface itself does nothing. Its *presence* is the message:

```java
void save(Object o) {
    if (o instanceof Serializable) {
        writeToDisk(o);
    } else {
        throw new IllegalArgumentException("Not serializable");
    }
}
```

Modern Java usually prefers **annotations** for this (`@Entity`, `@Deprecated`), because annotations can carry parameters and be inspected without affecting the type hierarchy. Marker interfaces still have one edge: they're checked at **compile time** when used as a parameter type.

---

## 4. Tagging Interface (Alias for Marker Interface)

- Another term for **marker interface** (used interchangeably).
- Purpose is to tag a class with some **meaning**.

---

## 5. Nested Interface (Member Interface)

- Interface defined **inside another class or interface**.
- Can be `public`, `private`, or `protected` if declared inside a class.
- Always `public static` if declared inside another interface.

```java
class Outer {
    interface InnerInterface {
        void show();
    }
}

class Test implements Outer.InnerInterface {
    public void show() {
        System.out.println("Nested interface implemented");
    }
}
```

A real-world one you use constantly: `Map.Entry` is a nested interface inside `Map`.

```java
for (Map.Entry<String, Integer> e : map.entrySet()) { ... }
```

---

## ✅ Summary Table

| Type of Interface | Description | Example |
| --- | --- | --- |
| Normal Interface | Contains abstract methods | `interface A { void show(); }` |
| Functional Interface | Only one abstract method; used with lambdas | `Runnable`, `Callable` |
| Marker Interface | No methods; provides metadata | `Serializable`, `Cloneable` |
| Nested Interface | Interface within a class/interface | `Outer.Inner` |

---

## 6. The pattern you'll use in every real codebase

Programming to an interface is what makes code testable and swappable:

```java
// The contract
interface NotificationService {
    void notify(String userId, String message);
}

// Implementations
class EmailNotification implements NotificationService {
    public void notify(String userId, String message) {
        System.out.println("Emailing " + userId + ": " + message);
    }
}

class SmsNotification implements NotificationService {
    public void notify(String userId, String message) {
        System.out.println("SMS to " + userId + ": " + message);
    }
}

// A test double — no network, instant, assertable
class FakeNotification implements NotificationService {
    final List<String> sent = new ArrayList<>();
    public void notify(String userId, String message) { sent.add(userId + "|" + message); }
}

// The consumer knows only the interface
class OrderService {
    private final NotificationService notifier;

    OrderService(NotificationService notifier) {     // dependency injection
        this.notifier = notifier;
    }

    void placeOrder(String userId) {
        // ... business logic ...
        notifier.notify(userId, "Your order is confirmed");
    }
}

// Production
new OrderService(new EmailNotification()).placeOrder("u1");
// Test
FakeNotification fake = new FakeNotification();
new OrderService(fake).placeOrder("u1");
assert fake.sent.size() == 1;
```

`OrderService` never mentions email or SMS. Add a `PushNotification` next month and `OrderService` doesn't change a character.

---

## 7. Interfaces in the JDK you already use

| Interface | Contract |
| :-- | :-- |
| `Comparable<T>` | "I know how to compare myself to another T" |
| `Comparator<T>` | "I know how to compare two Ts" |
| `Iterable<T>` | "I can be used in an enhanced for-loop" |
| `Runnable` | "I can be run on a thread" |
| `Callable<V>` | "I can be run and return a V" |
| `AutoCloseable` | "I can be used in try-with-resources" |
| `Serializable` | (marker) "I can be written to a byte stream" |
| `List` / `Set` / `Map` | The collection contracts |

That last row is why you write `List<String> names = new ArrayList<>();` — declare the **interface**, instantiate the **implementation**. Swapping to a `LinkedList` later is then a one-line change.

---

## 🧠 Rapid-fire recall

1. Why must an implementing method be declared `public`?
2. Why were `default` methods added in Java 8?
3. What happens if a class implements two interfaces with the same default method?
4. What is a functional interface, and what does `@FunctionalInterface` actually enforce?
5. What is a marker interface, and what has largely replaced it?
6. Name three things an interface cannot have that an abstract class can.
7. Why declare `List<String> x = new ArrayList<>()` rather than `ArrayList<String> x = new ArrayList<>()`?

<details>
<summary>Answers</summary>

1. Interface methods are implicitly `public`, and an override may not reduce visibility.
2. So interfaces could gain new methods (like `Collection.forEach`) without breaking every existing implementation.
3. Compile error — the class must override the method and may delegate with `A.super.method()`.
4. An interface with exactly one abstract method, usable as a lambda target. The annotation makes the compiler reject a second abstract method.
5. An empty interface whose presence conveys metadata (`Serializable`). Annotations have largely replaced the pattern.
6. Instance fields (state), constructors, and non-public members like `protected` methods.
7. It couples your code to the `List` contract, not to a specific implementation, so you can swap in `LinkedList` or `List.of(...)` without touching callers.

</details>
