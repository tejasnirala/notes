---
title: Abstract Classes & Methods
author: Tejas Nirala
---

# Abstract in Java

## 1. Abstract Class

An **abstract class** is a class that **cannot be instantiated (objects cannot be created for abstract class)** on its own and is meant to be **inherited by other classes**. It can contain both **abstract methods** (without a body) and **concrete methods** (with implementation).

### 🔸 Syntax:

```java
abstract class Animal {
    abstract void makeSound(); // Abstract method

    void sleep() {             // Concrete method
        System.out.println("Sleeping...");
    }
}
```

---

## 2. Abstract Method

An **abstract method** is a method **without a body**. Subclasses are required to **override** this method and provide a body.

### 🔸 Syntax:

```java
abstract void makeSound();
```

You can only declare abstract methods **inside an abstract class or interface**.

---

## 3. Example: Abstract Class & Method in Action

```java
abstract class Animal {
    abstract void makeSound();

    void eat() {
        System.out.println("Eating food...");
    }
}

class Dog extends Animal {
    void makeSound() {
        System.out.println("Bark!");
    }
}

public class Main {
    public static void main(String[] args) {
        Animal myDog = new Dog();
        myDog.makeSound();  // Output: Bark!
        myDog.eat();        // Output: Eating food...
    }
}
```

---

## 4. Key Points

| Feature | Description |
| --- | --- |
| `abstract` class | Cannot be instantiated directly |
| `abstract` method | Declared without a body; must be overridden |
| Constructors | Abstract classes **can** have constructors |
| Fields | Can have fields and methods like regular classes |
| Use case | When you want to **define a common interface and reuse code** |

---

## 5. When to Use Abstract Classes?

- When you want to **share code** among several related classes.
- When you want to **define a common interface** but not allow direct instantiation.
- When some methods should be **implemented by subclasses**, but others can have default behaviour.

---

## 6. Why can't you instantiate one?

```java
Animal a = new Animal();   // ❌ error: Animal is abstract; cannot be instantiated
```

Because the object would be **incomplete**. What would `a.makeSound()` even do? There's no body. Java refuses to create an object with a hole in it.

But note — you can still have a *reference* of the abstract type:

```java
Animal a = new Dog();      // ✅ perfectly fine
a.makeSound();             // Bark!
```

This is exactly the polymorphism setup from the previous page. The abstract class is a **type**, it just isn't a **factory**.

---

## 7. Abstract classes can have constructors

This surprises people: if you can't instantiate it, why a constructor?

Because **subclass construction runs through it**:

```java
abstract class Animal {
    protected final String name;

    Animal(String name) {                    // constructor on an abstract class
        this.name = name;
        System.out.println("Animal created: " + name);
    }

    abstract void makeSound();

    void introduce() {
        System.out.print(name + " says: ");
        makeSound();
    }
}

class Dog extends Animal {
    Dog(String name) {
        super(name);                          // ← this is why the constructor exists
    }

    @Override void makeSound() { System.out.println("Bark!"); }
}

new Dog("Rex").introduce();
// Animal created: Rex
// Rex says: Bark!
```

The abstract class owns the shared state (`name`) and its initialisation. The subclass only supplies what's genuinely different.

---

## 8. Partial implementation — an abstract class extending an abstract class

A subclass that doesn't implement *all* the abstract methods must itself be abstract:

```java
abstract class Vehicle {
    abstract void start();
    abstract void stop();
}

abstract class ElectricVehicle extends Vehicle {
    @Override
    void start() { System.out.println("Silent electric start"); }
    // stop() still abstract → this class must remain abstract
}

class Tesla extends ElectricVehicle {
    @Override
    void stop() { System.out.println("Regenerative braking"); }
}
```

---

## 9. The Template Method pattern — the classic reason to use abstract classes

An abstract class is at its best when it defines an **algorithm's skeleton** and leaves specific steps to subclasses.

```java
abstract class DataProcessor {

    // The template: the ORDER of steps is fixed and cannot be changed
    public final void process() {
        var raw       = readData();
        var cleaned   = validate(raw);
        var result    = transform(cleaned);
        save(result);
        log("Processed " + result.size() + " records");
    }

    // Steps every subclass MUST define
    protected abstract List<String> readData();
    protected abstract List<String> transform(List<String> data);
    protected abstract void save(List<String> data);

    // A step with a sensible default that subclasses MAY override
    protected List<String> validate(List<String> data) {
        return data.stream().filter(s -> !s.isBlank()).toList();
    }

    // Shared helper — no subclass needs to reimplement this
    private void log(String msg) {
        System.out.println("[" + getClass().getSimpleName() + "] " + msg);
    }
}

class CsvProcessor extends DataProcessor {
    protected List<String> readData()                    { return List.of("a,1", "b,2", ""); }
    protected List<String> transform(List<String> data)  { return data.stream().map(String::toUpperCase).toList(); }
    protected void save(List<String> data)               { System.out.println("Saving CSV: " + data); }
}

new CsvProcessor().process();
// Saving CSV: [A,1, B,2]
// [CsvProcessor] Processed 2 records
```

Note the `final` on `process()` — subclasses can fill in steps but cannot reorder or skip them. That's the guarantee the abstract class is selling.

---

## 10. Abstract class vs Interface — the decision

| | Abstract Class | Interface |
| :-- | :-- | :-- |
| Instance fields (state) | ✅ yes | ❌ only `public static final` constants |
| Constructors | ✅ yes | ❌ no |
| Concrete methods | ✅ yes | ✅ since Java 8 (`default`, `static`) |
| `private` / `protected` members | ✅ yes | `private` since Java 9; no `protected` |
| How many can a class have? | **One** (`extends`) | **Many** (`implements`) |
| Relationship expressed | "**is-a**" | "**can-do**" / capability |

**Decide like this:**

- Do the implementations share **state and code**, and are they genuinely the same kind of thing? → **abstract class**.
  *Example:* `AbstractList` — `ArrayList` and `LinkedList` really are lists and share iteration machinery.

- Are you describing a **capability** that unrelated types might have? → **interface**.
  *Example:* `Comparable`, `Serializable`, `Runnable` — a `String`, a `Date` and an `Employee` have nothing in common except that each can be compared.

- Might a class need **more than one** of these? → it must be an **interface**, since Java allows only one superclass.

In modern Java the usual answer is: **start with an interface**, and add an abstract class only when several implementations really do need to share state.

```java
interface Shape {                       // the capability / contract
    double area();
    default String describe() { return getClass().getSimpleName() + ": " + area(); }
}

abstract class ColoredShape implements Shape {   // shared STATE lives here
    protected final String color;
    protected ColoredShape(String color) { this.color = color; }
}

class Circle extends ColoredShape {
    private final double r;
    Circle(String color, double r) { super(color); this.r = r; }
    @Override public double area() { return Math.PI * r * r; }
}
```

---

## 11. Things you cannot do

```java
abstract class Bad {
    abstract void a();

    // ❌ private: a subclass couldn't see it to override it
    // private abstract void b();

    // ❌ final: final means "cannot be overridden", abstract means "must be" — contradiction
    // final abstract void c();

    // ❌ static: static methods aren't dispatched dynamically, so overriding is meaningless
    // static abstract void d();
}

// ❌ a class with an abstract method must itself be abstract
class AlsoBad {
    abstract void e();    // error: AlsoBad is not abstract
}
```

Each error is the same underlying idea: `abstract` is a promise that a subclass will supply the body. Anything that makes overriding impossible contradicts it.

---

## 🧠 Rapid-fire recall

1. Why can't you write `new Animal()` when `Animal` is abstract?
2. If you can't instantiate an abstract class, why can it have a constructor?
3. Must an abstract class contain at least one abstract method?
4. What happens if a subclass implements only some of the abstract methods?
5. Why is `private abstract` illegal? Why is `final abstract` illegal?
6. What is the Template Method pattern, and why is the template method usually `final`?
7. Give a rule of thumb for choosing between an abstract class and an interface.

<details>
<summary>Answers</summary>

1. The object would have methods with no body — an incomplete object. Java refuses.
2. The constructor runs as part of subclass construction, via `super(...)`, to initialise the shared state the abstract class owns.
3. No. An abstract class with zero abstract methods is legal — it just can't be instantiated, which is sometimes exactly what you want.
4. That subclass must itself be declared `abstract`.
5. `private` isn't visible to subclasses so it could never be overridden; `final` explicitly forbids overriding, which directly contradicts `abstract`.
6. A fixed algorithm skeleton in the base class calling abstract steps supplied by subclasses. It's `final` so subclasses can fill in steps but cannot reorder or skip them.
7. Use an interface for a capability that unrelated types might have (and when a class may need several); use an abstract class when implementations genuinely share state and code.

</details>
