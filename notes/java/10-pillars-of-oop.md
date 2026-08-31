---
title: The Four Pillars of OOP
author: Tejas Nirala
---

# Pillars of OOPs

Object-Oriented Programming rests on four ideas. Every Java design decision — interfaces, abstract classes, access modifiers, overriding — exists to serve one of them.

| Pillar | One-line version |
| :-- | :-- |
| **Encapsulation** | Keep data and the code that guards it together; hide the rest. |
| **Abstraction** | Expose *what* something does; hide *how*. |
| **Inheritance** | Reuse and specialise an existing type. |
| **Polymorphism** | One interface, many behaviours, chosen at runtime. |

---

## 1. Encapsulation

> **Definition:** Wrapping data (variables) and code (methods) together as a single unit. It hides internal details and exposes only what is necessary.

### ✅ Achieved by:

- Declaring variables **private**
- Providing **public getter/setter** methods

### 🔸 Example:

```java
class Person {
    private String name;

    public void setName(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }
}

class Main {
    public static void main(String[] args) {
        Person p = new Person();
        p.setName("Tejas");
        System.out.println(p.getName());  // Tejas
    }
}
```

### 🧠 Why Encapsulation?

- Protects data
- Increases maintainability
- Prevents unauthorized access

### The version that actually earns its keep

A getter/setter pair that does nothing is encapsulation in name only. The real value appears when the setter **enforces a rule**:

```java
class Person {
    private String name;
    private int age;

    public void setAge(int age) {
        if (age < 0 || age > 150) {
            throw new IllegalArgumentException("Invalid age: " + age);
        }
        this.age = age;
    }

    public int getAge() { return age; }
}
```

Now `person.age = -5` is *impossible*. There is no path into the object that skips the check. That guarantee — "this object can never be in an invalid state" — is called an **invariant**, and encapsulation is how you enforce one.

### The second benefit: you can change your mind

```java
class Temperature {
    private double celsius;              // stored in Celsius

    public double getFahrenheit() {
        return celsius * 9 / 5 + 32;     // computed, not stored
    }
}
```

Callers use `getFahrenheit()`. Tomorrow you can switch the internal storage to Fahrenheit, or to a `BigDecimal`, or to a database lookup — and **not a single caller breaks**, because none of them ever depended on the field.

Had `celsius` been public, every caller in the codebase would be coupled to your storage decision forever.

---

## 2. Abstraction

> **Definition:** Hiding complex implementation details and showing only the essential features to the user.

### ✅ Achieved by:

- **Abstract classes**
- **Interfaces**

---

### 🔸 Example using Interface:

```java
interface Animal {
    void sound(); // abstract method
}

class Dog implements Animal {
    public void sound() {
        System.out.println("Barks");
    }
}

class Main {
    public static void main(String[] args) {
        Animal a = new Dog();
        a.sound();  // Barks
    }
}
```

### 🧠 Why Abstraction?

- Simplifies code usage
- Focus on *what* an object does, not *how*
- Helps in achieving **loose coupling**

### Abstraction vs Encapsulation — the distinction people fumble

They sound similar; they solve different problems.

| | Encapsulation | Abstraction |
| :-- | :-- | :-- |
| Question it answers | "How do I *protect* my data?" | "What should the outside world *see*?" |
| Level | Implementation | Design |
| Mechanism | `private` + methods | `interface` / `abstract class` |
| Analogy | The sealed casing of a TV | The remote control's buttons |

**The analogy done properly:** a TV remote *abstracts* the television — you press "volume up" without knowing anything about signal processing. The TV's internals are *encapsulated* — the plastic casing means you physically cannot reach in and change a voltage.

### Abstraction in practice: coding to an interface

```java
// ❌ Tightly coupled — you're locked to MySQL forever
class UserService {
    private MySqlDatabase db = new MySqlDatabase();
    void save(User u) { db.insert(u); }
}

// ✅ Loosely coupled — any Database implementation will do
interface Database {
    void insert(User u);
}

class UserService {
    private final Database db;
    UserService(Database db) { this.db = db; }     // injected
    void save(User u) { db.insert(u); }
}

// In production:
new UserService(new MySqlDatabase());
// In tests:
new UserService(new InMemoryDatabase());
```

`UserService` now depends on the *idea* of a database, not on any particular one. That's abstraction paying rent.

---

## 3. Inheritance

> **Definition:** Mechanism where one class (child) inherits properties and behavior from another class (parent).

### ✅ Uses:

- **Code reusability**
- **Method overriding**
- Helps with **polymorphism**

---

### 🔸 Example:

```java
class Animal {
    void eat() {
        System.out.println("This animal eats food");
    }
}

class Dog extends Animal {
    void bark() {
        System.out.println("Dog barks");
    }
}

class Main {
    public static void main(String[] args) {
        Dog d = new Dog();
        d.eat();  // inherited  // This animal eats food
        d.bark(); // own        // Dog barks
    }
}
```

### 🧠 Types of Inheritance in Java:

- Single
- Multilevel
- Hierarchical

> ❌ Java doesn't support multiple inheritance with classes (to avoid ambiguity), but it's allowed through interfaces.

```
  Single              Multilevel            Hierarchical         Multiple (❌ classes)
  
  Animal              Animal                  Animal                A     B
    │                   │                    ╱   │   ╲               ╲   ╱
   Dog                 Dog                 Dog  Cat  Cow               C
                        │
                    Puppy
```

### Why multiple class inheritance is banned: the Diamond Problem

```
        A          class A { void greet() { "A" } }
       ╱ ╲
      B   C        class B extends A { void greet() { "B" } }
       ╲ ╱         class C extends A { void greet() { "C" } }
        D          class D extends B, C     ← which greet() does D inherit?
```

There's no correct answer, so Java forbids the question. Interfaces are allowed to be multiply implemented because (traditionally) they carried **no implementation** — only signatures, so there is nothing to be ambiguous about. Java 8's `default` methods reintroduced the possibility, so Java added an explicit rule: if two interfaces give conflicting defaults, the implementing class **must** override and disambiguate.

### `super` — reaching the parent

```java
class Animal {
    String name;
    Animal(String name) { this.name = name; }
    void eat() { System.out.println(name + " eats"); }
}

class Dog extends Animal {
    Dog(String name) {
        super(name);              // must be the FIRST statement
    }

    @Override
    void eat() {
        super.eat();              // call the parent's version first
        System.out.println("...specifically dog food");
    }
}
```

Every constructor implicitly starts with `super()` unless you write `this(...)` or `super(...)` yourself. Which means: **constructing a subclass always constructs the whole chain, top down.**

```java
class A { A() { System.out.println("A"); } }
class B extends A { B() { System.out.println("B"); } }
class C extends B { C() { System.out.println("C"); } }

new C();     // prints A, then B, then C
```

### Inheritance is *not* the default answer — prefer composition

Inheritance says **"is-a"**. If you can't say it out loud without wincing, don't use it.

```java
// 😖 A Stack is NOT a Vector — but it extends one in the JDK,
//    which is why you can call stack.get(0) and bypass LIFO entirely.
class Stack extends Vector { }

// 😊 Composition: a Stack HAS a list
class Stack<E> {
    private final List<E> items = new ArrayList<>();
    public void push(E e) { items.add(e); }
    public E pop() { return items.remove(items.size() - 1); }
}
```

The composed version exposes *exactly* the stack operations and nothing else. **"Favour composition over inheritance"** is one of the most durable pieces of OO advice there is.

---

## 4. Polymorphism

> **Definition:** "Many forms" — ability of a method or object to behave differently based on context.

### ✅ Types:

- **Compile-time Polymorphism** (Method Overloading)
- **Runtime Polymorphism** (Method Overriding)

---

### 🔸 Compile-Time Polymorphism (Overloading)

```java
class Calculator {
    int add(int a, int b) { return a + b; }
    double add(double a, double b) { return a + b; }
}

class Main {
    public static void main(String[] args) {
        Calculator c = new Calculator();
        System.out.println(c.add(2, 3));         // 5
        System.out.println(c.add(2.5, 3.5));     // 6.0
    }
}
```

The compiler picks the method by looking at the argument types. Decision made at **compile time** — hence "static polymorphism".

### 🔸 Runtime Polymorphism (Overriding)

```java
class Animal {
    void sound() {
        System.out.println("Animal makes sound");
    }
}

class Cat extends Animal {
    void sound() {
        System.out.println("Cat meows");
    }
}

class Main {
    public static void main(String[] args) {
        Animal a = new Cat();     // Upcasting
        a.sound();  //Cat meows   // Runtime call
    }
}
```

The compiler only knows `a` is an `Animal`. The **JVM**, at runtime, looks at the actual object (`Cat`) and calls its version. Decision made at **runtime** — hence "dynamic polymorphism". Full detail: [Dynamic Method Dispatch](./11-inheritance-and-polymorphism.md).

### 🧠 Why Polymorphism?

- Supports **extensibility**
- Enables **dynamic behavior**
- Allows **interface-based programming**

### The payoff, concretely

```java
List<Animal> zoo = List.of(new Dog(), new Cat(), new Cow());

for (Animal a : zoo) {
    a.sound();          // each one does its own thing — no if/else anywhere
}
```

Now add a `Lion` class. The loop above needs **zero changes**. Compare with the non-polymorphic version:

```java
// 😖 Every new animal means editing this method — and every method like it
void makeSound(Object animal) {
    if (animal instanceof Dog)      System.out.println("Woof");
    else if (animal instanceof Cat) System.out.println("Meow");
    else if (animal instanceof Cow) System.out.println("Moo");
    // ...forever
}
```

Polymorphism is how you write code that is **open for extension, closed for modification** — the "O" in SOLID.

---

## 🔚 Summary Table

| Pillar | Purpose | How Achieved |
| --- | --- | --- |
| Encapsulation | Data hiding | private fields + getters |
| Abstraction | Hiding internal implementation | abstract class/interface |
| Inheritance | Code reuse | `extends` / `implements` |
| Polymorphism | Multiple forms of behavior | Overloading & Overriding |

---

## 5. One example using all four

```java
// ABSTRACTION — callers see "a payment method", nothing more
interface PaymentMethod {
    boolean pay(double amount);
}

// ENCAPSULATION — balance is private and guarded
abstract class Account implements PaymentMethod {
    private double balance;                    // nobody can touch this directly

    protected Account(double opening) { this.balance = opening; }

    protected boolean debit(double amount) {   // the ONLY way balance decreases
        if (amount <= 0 || amount > balance) return false;
        balance -= amount;
        return true;
    }

    public double getBalance() { return balance; }
}

// INHERITANCE — both reuse Account's balance handling
class DebitCard extends Account {
    DebitCard(double opening) { super(opening); }

    @Override
    public boolean pay(double amount) {
        return debit(amount);
    }
}

class CreditCard extends Account {
    private final double creditLimit;

    CreditCard(double limit) { super(limit); this.creditLimit = limit; }

    @Override
    public boolean pay(double amount) {
        System.out.println("Charging card, limit " + creditLimit);
        return debit(amount);
    }
}

public class Checkout {
    // POLYMORPHISM — this method never needs to change when a new method is added
    static void process(PaymentMethod method, double amount) {
        System.out.println(method.pay(amount) ? "Paid" : "Declined");
    }

    public static void main(String[] args) {
        process(new DebitCard(500), 200);    // Paid
        process(new CreditCard(1000), 5000); // Declined
    }
}
```

---

## 🧠 Rapid-fire recall

1. What is the difference between encapsulation and abstraction?
2. Give a concrete reason a public field is worse than a getter, beyond "it's the rule".
3. What is the Diamond Problem, and how does Java avoid it?
4. Why must `super(...)` be the first statement in a constructor?
5. Which polymorphism is resolved at compile time and which at runtime?
6. What does "favour composition over inheritance" mean, with an example?
7. What does polymorphism let you avoid writing?

<details>
<summary>Answers</summary>

1. Encapsulation hides *data* behind guarded methods to protect invariants; abstraction hides *implementation* behind a type so callers depend only on behaviour.
2. A public field freezes your internal representation into the public API — you can never change how the value is stored or computed without breaking every caller.
3. Ambiguity about which inherited implementation a class gets when two parents define the same method. Java bans multiple class inheritance; for conflicting interface `default` methods it forces the class to override.
4. The parent's state must be fully initialised before the subclass can rely on it.
5. Overloading is compile-time (static); overriding is runtime (dynamic).
6. Model "has-a" with a field instead of "is-a" with `extends`, so you expose only the operations you intend — e.g. a `Stack` holding a `List` rather than extending `Vector`.
7. Long `if/else` or `switch` chains on type, and the need to edit existing code every time a new type is added.

</details>
