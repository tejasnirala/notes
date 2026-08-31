---
title: Inheritance, Overriding & Dynamic Method Dispatch
author: Tejas Nirala
---

# Inheritance, Overriding & Dynamic Method Dispatch

The previous page introduced inheritance and polymorphism as concepts. This page is the mechanics: exactly what the compiler decides, exactly what the JVM decides, and where the two disagree.

---

## 1. Overriding: the rules

**Overriding** = a subclass provides its own implementation of a method it inherited.

```java
class Animal {
    void sound() { System.out.println("Animal makes a sound"); }
}

class Dog extends Animal {
    @Override
    void sound() { System.out.println("Dog barks"); }
}
```

For it to count as overriding (rather than accidentally defining an unrelated method), **all** of these must hold:

| Rule | Detail |
| :-- | :-- |
| Same name | exactly |
| Same parameter list | exactly — different parameters means *overloading*, not overriding |
| Return type | same, or a **covariant** (narrower) type |
| Access modifier | same or **wider** — you may not reduce visibility |
| Checked exceptions | same, narrower, or none — you may not throw broader ones |
| Not `static`, `final`, or `private` | those cannot be overridden |

### Always write `@Override`

```java
class Dog extends Animal {
    @Override
    void sond() { }     // ❌ compile error: method does not override a supertype method
}
```

Without the annotation, that typo silently compiles as a *new* method, and your override never runs. `@Override` turns a silent runtime bug into a compile error. Use it every time.

### Covariant return types

```java
class Animal {
    Animal reproduce() { return new Animal(); }
}

class Dog extends Animal {
    @Override
    Dog reproduce() { return new Dog(); }     // ✅ Dog IS-A Animal — narrower is fine
}
```

### Widening access is allowed, narrowing is not

```java
class Parent { protected void show() { } }

class Child extends Parent {
    @Override public void show() { }     // ✅ protected → public (wider)
    // @Override private void show() { } // ❌ public → private (narrower)
}
```

**Why?** Because of polymorphism. If `Parent p = new Child();` then `p.show()` must be legal — the compiler allowed it based on `Parent`. If `Child` made it private, the call would explode at runtime. Java forbids the setup entirely.

---

## 2. Dynamic Method Dispatch

### ✅ Runtime Method Dispatch (in Java):

> Runtime Method Dispatch (also known as Dynamic Method Dispatch) is a process in Java where the call to an overridden method is resolved at runtime and not at compile time.

It is used to **achieve runtime polymorphism**, allowing Java to decide **which method to call based on the object's actual type**, **not the reference type**.

---

### ✅ Simplified Explanation (Easy Language):

Imagine you have a remote control (reference) of type **TV**. You can use that remote to control a **SonyTV**, **SamsungTV**, or **LGTV** (actual object). All TVs respond to a `turnOn()` function, but each brand may have a different implementation.

So, when you press the button (call `turnOn()`), **Java will look at which TV is actually connected (object type)**, and it will call that brand's specific `turnOn()` version.

This is **runtime method dispatch** — Java waits till the **program is running** to figure out which version of the method to call.

---

### ✅ Code Example (with comments):

```java
// Parent class
class Animal {
    void sound() {
        System.out.println("Animal makes a sound");
    }
}

// Child class 1
class Dog extends Animal {
    void sound() {
        System.out.println("Dog barks");
    }
}

// Child class 2
class Cat extends Animal {
    void sound() {
        System.out.println("Cat meows");
    }
}

public class Main {
    public static void main(String[] args) {
        Animal myAnimal; // reference of parent class

        myAnimal = new Dog();   // Dog object assigned
        myAnimal.sound();       // Output: Dog barks

        myAnimal = new Cat();   // Cat object assigned
        myAnimal.sound();       // Output: Cat meows
    }
}
```

---

### ✅ What's happening in the code:

- `myAnimal` is a **reference of type `Animal`** (the parent class).
- It is used to point to different objects (`Dog`, `Cat`).
- Although the **reference type is `Animal`**, the **actual object is `Dog` or `Cat`**.
- At **runtime**, Java decides which `sound()` method to call, based on the object (`Dog` or `Cat`) — **not** the reference type.

This is how **Java achieves runtime polymorphism**.

---

### ✅ Key Points for Interview:

- **Runtime method dispatch** is Java's way of implementing **runtime polymorphism**.
- It happens when a **parent class reference** refers to a **child class object**, and a method is **overridden**.
- The method call is resolved **at runtime**, not at compile time.
- Only **overridden methods** are subject to runtime method dispatch (not variables).

---

## 3. The one rule that explains everything

Memorise this and you can answer any dispatch question:

> **The reference type decides *what you're allowed to call*.**
> **The object type decides *which implementation actually runs*.**

```java
class Animal {
    String type = "Animal";
    void sound() { System.out.println("Generic sound"); }
}

class Dog extends Animal {
    String type = "Dog";
    void sound() { System.out.println("Woof"); }
    void fetch() { System.out.println("Fetching"); }
}

Animal a = new Dog();

a.sound();          // "Woof"    ← OBJECT type wins for methods
System.out.println(a.type);  // "Animal"  ← REFERENCE type wins for FIELDS
a.fetch();          // ❌ compile error — Animal has no fetch()
```

Two things to take from that:

**(a) Fields are NOT polymorphic.** Field access is resolved at compile time from the reference type. This is called *field hiding*, and it is a very good reason to keep fields `private` — then the question never arises.

**(b) You can only call what the reference type declares**, even though the object has more. To reach `fetch()`, you must downcast.

---

## 4. Upcasting and downcasting

```java
// UPCAST — always safe, implicit. A Dog IS an Animal.
Animal a = new Dog();

// DOWNCAST — needs an explicit cast, and may fail at runtime
Dog d = (Dog) a;        // ✅ works, because `a` really is a Dog
d.fetch();

Animal cat = new Cat();
Dog bad = (Dog) cat;    // ✅ compiles
                        // 💥 ClassCastException at runtime — a Cat is not a Dog
```

**Always guard a downcast with `instanceof`:**

```java
if (a instanceof Dog) {
    Dog d = (Dog) a;
    d.fetch();
}

// Java 16+ pattern matching — cleaner
if (a instanceof Dog d) {
    d.fetch();
}
```

> If you find yourself writing long `instanceof` chains, that's usually a sign the behaviour belongs *on* the classes as an overridden method instead.

---

## 5. Method dispatch: what the JVM actually does

Each class gets a **virtual method table (vtable)** — an array of pointers to its method implementations. A subclass's vtable starts as a copy of its parent's, with overridden entries replaced.

```
Animal vtable                Dog vtable (extends Animal)
 [0] sound  → Animal.sound     [0] sound  → Dog.sound     ← REPLACED
 [1] eat    → Animal.eat       [1] eat    → Animal.eat    ← inherited
                               [2] fetch  → Dog.fetch     ← added
```

When the compiler sees `a.sound()` on an `Animal` reference, it emits `invokevirtual` with **slot 0**. At runtime the JVM follows the object's actual class pointer to *its* vtable and calls slot 0 — which for a `Dog` object is `Dog.sound`.

That's the entire mechanism. It's a single array lookup, which is why dynamic dispatch is essentially free.

Bytecode instructions worth recognising:

| Instruction | Used for | Dispatch |
| :-- | :-- | :-- |
| `invokevirtual` | normal instance methods | dynamic ✅ |
| `invokeinterface` | interface methods | dynamic ✅ |
| `invokestatic` | static methods | static ❌ |
| `invokespecial` | constructors, `private`, `super.x()` | static ❌ |
| `invokedynamic` | lambdas, method references | special |

Notice `private` and `static` use `invokespecial`/`invokestatic` — resolved at compile time. That is precisely *why* they cannot be overridden.

---

## 6. What is NOT polymorphic — the trap collection

```java
class Parent {
    static  void statMethod() { System.out.println("Parent static"); }
    private void privMethod() { System.out.println("Parent private"); }
            int  field = 1;
            void instMethod() { System.out.println("Parent instance"); }
}

class Child extends Parent {
    static  void statMethod() { System.out.println("Child static"); }
    private void privMethod() { System.out.println("Child private"); }
            int  field = 2;
    @Override
            void instMethod() { System.out.println("Child instance"); }
}

Parent p = new Child();

p.instMethod();          // "Child instance"  ✅ overridden — dynamic
p.statMethod();          // "Parent static"   ⚠️ hidden — reference type
System.out.println(p.field);  // 1            ⚠️ hidden — reference type
```

| Member kind | Overridable? | Resolved by |
| :-- | :-- | :-- |
| instance method | ✅ | object type (runtime) |
| `static` method | ❌ (hidden) | reference type (compile time) |
| `private` method | ❌ (not inherited) | compile time |
| `final` method | ❌ (forbidden) | compile time |
| field | ❌ (hidden) | reference type (compile time) |

---

## 7. Constructors and the danger of calling overridable methods

```java
class Parent {
    Parent() {
        init();                     // ⚠️ calling an overridable method from a constructor
    }
    void init() { System.out.println("Parent init"); }
}

class Child extends Parent {
    private String name = "Tejas";

    @Override
    void init() {
        System.out.println("Child init, name = " + name);
    }
}

new Child();
// Parent constructor runs FIRST, calls init(),
// dynamic dispatch sends it to Child.init(),
// but Child's fields haven't been initialised yet:
//   → "Child init, name = null"    😱
```

**Rule: never call an overridable method from a constructor.** Make such methods `private` or `final`, or restructure.

---

## 8. Full worked example

```java
abstract class Shape {
    abstract double area();

    // Template method — the algorithm is fixed, the steps are polymorphic
    void describe() {
        System.out.printf("%s with area %.2f%n", getClass().getSimpleName(), area());
    }
}

class Circle extends Shape {
    private final double r;
    Circle(double r) { this.r = r; }
    @Override double area() { return Math.PI * r * r; }
}

class Rectangle extends Shape {
    private final double w, h;
    Rectangle(double w, double h) { this.w = w; this.h = h; }
    @Override double area() { return w * h; }
}

class Square extends Rectangle {
    Square(double side) { super(side, side); }
}

public class ShapeDemo {
    public static void main(String[] args) {
        List<Shape> shapes = List.of(
            new Circle(2),
            new Rectangle(3, 4),
            new Square(5)
        );

        double total = 0;
        for (Shape s : shapes) {
            s.describe();          // dynamic dispatch picks each class's area()
            total += s.area();
        }
        System.out.printf("Total area: %.2f%n", total);
    }
}
```

Output:
```
Circle with area 12.57
Rectangle with area 12.00
Square with area 25.00
Total area: 49.57
```

Add a `Triangle` class tomorrow and this `main` method does not change at all. That is the whole point.

---

## 🧠 Rapid-fire recall

1. State the one rule that governs which method runs.
2. Why is `@Override` worth writing on every override?
3. Why can an override widen access but not narrow it?
4. `Animal a = new Dog();` — what does `a.type` give you if both classes declare `type`, and why?
5. What exception does a bad downcast throw, and how do you prevent it?
6. Why can't `static`, `private` and `final` methods be overridden — in terms of bytecode?
7. What goes wrong when a constructor calls an overridable method?

<details>
<summary>Answers</summary>

1. The reference type decides what you may call; the object type decides which implementation runs.
2. It turns a mistyped or mismatched signature from a silently-new method into a compile error.
3. Because a supertype reference must always be able to call the method — narrowing would make a call that the compiler approved fail at runtime.
4. The parent's `type` — fields are resolved at compile time from the reference type (field hiding), not dispatched dynamically.
5. `ClassCastException`; guard it with `instanceof`, ideally the Java 16+ pattern form `if (a instanceof Dog d)`.
6. They compile to `invokestatic` / `invokespecial`, which bind at compile time, rather than the vtable lookup of `invokevirtual`.
7. The subclass override runs before the subclass's fields are initialised, so it sees `null`/`0` values.

</details>
