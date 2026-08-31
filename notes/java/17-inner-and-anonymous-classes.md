---
title: Inner & Anonymous Classes
author: Tejas Nirala
---

# Inner Class

## 1. What is an Inner Class in Java?

An **inner class** is a class defined **within another class**. It is associated with the outer class and can access its members (including private ones).

> Inner classes help logically group classes that are only used in one place, increasing encapsulation and readability.

---

## 🔸 Types of Inner Classes

Java provides **four types** of inner classes:

1. **Non-static nested class (Regular inner class)**
2. **Static nested class**
3. **Local inner class (inside a method)**
4. **Anonymous inner class**

```
                    Nested class
                    ╱          ╲
          static nested      inner (non-static)
                              ╱    │     ╲
                       member   local   anonymous
```

---

## 1. ✅ Regular Inner Class (Non-static)

This is a non-static class defined inside another class. It has access to all members (even private) of the outer class.

```java
public class Outer {
    private String message = "Hello from Outer!";

    public class Inner {
        public void display() {
            System.out.println(message); // Accesses private outer field
        }
    }

    public static void main(String[] args) {
        Outer outer = new Outer();
        Outer.Inner inner = outer.new Inner();
        inner.display();
    }
}
```

### ✅ Key Points:

- Cannot have static members.
- Instantiated using the outer class object: `outer.new Inner()`.

### How it can see `message`

The compiler silently gives every inner-class instance a hidden reference to its enclosing object:

```java
// What the compiler effectively generates
class Outer$Inner {
    final Outer this$0;                       // ← hidden back-reference
    Outer$Inner(Outer outer) { this$0 = outer; }
    public void display() { System.out.println(this$0.message); }
}
```

That's why you need an `Outer` instance to create one, and why the syntax is `outer.new Inner()`.

To reach the outer object explicitly when names collide:

```java
public class Outer {
    private int value = 10;

    public class Inner {
        private int value = 20;

        void show(int value) {
            System.out.println(value);              // 30 — the parameter
            System.out.println(this.value);         // 20 — Inner's field
            System.out.println(Outer.this.value);   // 10 — Outer's field
        }
    }
}
```

> ⚠️ **The hidden reference is a memory-leak risk.** As long as the inner instance is alive, the outer object cannot be garbage collected — even if nothing else references it. If the inner class doesn't actually need the outer instance, make it `static`.

---

## 2. 🟩 Static Nested Class

A static class inside another class. Since it is static, it **doesn't need an outer class object to be instantiated**.

```java
public class Outer {
    static String staticMessage = "Static Hello!";

    static class StaticInner {
        void show() {
            System.out.println(staticMessage);
        }
    }

    public static void main(String[] args) {
        Outer.StaticInner inner = new Outer.StaticInner();
        inner.show();
    }
}
```

### ✅ Key Points:

- Can access **only static members** of the outer class.
- Can have both static and non-static members.

### This is the one you should usually reach for

A static nested class is just a normal top-level class that happens to live inside another for namespacing. No hidden reference, no leak risk.

Real examples from the JDK:

```java
Map.Entry<K, V>                 // nested inside Map
HashMap.Node<K, V>              // the internal bucket node
Thread.State                    // the enum of thread states
```

The **Builder pattern** is the classic use:

```java
public class Pizza {
    private final String size;
    private final List<String> toppings;

    private Pizza(Builder b) {
        this.size = b.size;
        this.toppings = List.copyOf(b.toppings);
    }

    public static class Builder {                  // static nested
        private String size = "medium";
        private final List<String> toppings = new ArrayList<>();

        public Builder size(String s)      { this.size = s; return this; }
        public Builder addTopping(String t){ this.toppings.add(t); return this; }
        public Pizza build()               { return new Pizza(this); }
    }
}

Pizza p = new Pizza.Builder()
        .size("large")
        .addTopping("cheese")
        .addTopping("basil")
        .build();
```

---

## 3. 🟨 Local Inner Class (Defined in a Method)

A class declared **inside a method** of an outer class. It can access **final or effectively final** local variables.

```java
public class Outer {
    void outerMethod() {
        int number = 42; // effectively final

        class LocalInner {
            void print() {
                System.out.println("Number is: " + number);
            }
        }

        LocalInner inner = new LocalInner();
        inner.print();
    }

    public static void main(String[] args) {
        new Outer().outerMethod();
    }
}
```

### ✅ Key Points:

- Scope is limited to the method.
- Can access **effectively final** variables.

**Why "effectively final"?** The local variable `number` lives on the stack and disappears when `outerMethod()` returns — but the `LocalInner` object may outlive it on the heap. So the compiler **copies** the value into the object. If the original could still change afterwards, the copy would silently disagree with it. Java forbids the ambiguity. (Same rule as [lambdas](./30-lambdas.md).)

Local classes are rare in modern code — a lambda or a method reference is almost always cleaner.

---

## 4. 🟧 Anonymous Inner Class

An unnamed class used to **override methods of a class/interface on the spot**, usually for one-time use (e.g., callbacks, listeners).

```java
abstract class Animal {
    abstract void makeSound();
}

public class Test {
    public static void main(String[] args) {
        Animal dog = new Animal() {
            void makeSound() {
                System.out.println("Woof Woof!");
            }
        };

        dog.makeSound();
    }
}
```

### ✅ Key Points:

- No constructor (because it's anonymous).
- Used with interfaces, abstract classes, or concrete classes.

---

## 🔹 Why Use Inner Classes?

- To logically group classes that are used only in one place.
- To access outer class members from the inner class.
- To improve encapsulation.

---

## 🔍 Important Notes

| Type | Access Outer Members | Static Allowed | Instantiation |
| --- | --- | --- | --- |
| Regular Inner | ✅ (All) | ❌ | `outer.new Inner()` |
| Static Nested | ❌ (only static) | ✅ | `Outer.StaticInner` |
| Local Inner | ✅ (Effectively final vars) | ❌ | Inside method |
| Anonymous Inner | ✅ | ❌ | Inline only |

> Note: since **Java 16**, inner classes *are* allowed to declare `static` members, relaxing the old restriction. The "❌ static" column reflects the classic rule you'll still see quoted everywhere.

### What the compiler produces

Nested classes compile to separate `.class` files with `$` in the name:

```
Outer.class
Outer$Inner.class
Outer$StaticInner.class
Outer$1LocalInner.class      ← local classes get a number
Outer$1.class                ← anonymous classes get only a number
Outer$2.class
```

Seeing `Outer$1` in a stack trace tells you the failure was inside the first anonymous class in `Outer`.

---

# Anonymous Class

An **anonymous class** in Java is a **class without a name** that is **declared and instantiated in a single expression**. It's used when you need to override methods of a class or interface **just once**, typically for short and specific use-cases.

---

## 🔹 Definition

> An anonymous class is a local class without a name that is declared and instantiated at the same time.

---

## 🔹 Syntax

```java
InterfaceOrClassType obj = new InterfaceOrClassType() {
    // override methods or define behavior
};
```

Read `new Runnable() { ... }` as: *"create an object of a brand-new unnamed class that implements `Runnable`, defined right here."*

---

## 🔹 Use Case

- When you want to create an object with certain "one-off" behavior.
- Mostly used with:
    - **Interfaces** (like `Runnable`, `ActionListener`)
    - **Abstract classes**
    - **Concrete classes** (when overriding methods temporarily)

---

## 🔹 Example 1: Using an Interface

```java
Runnable r = new Runnable() {
    @Override
    public void run() {
        System.out.println("Running in an anonymous class!");
    }
};

r.run();
```

---

## 🔹 Example 2: Using Abstract Class

```java
abstract class Animal {
    abstract void makeSound();
}

public class Test {
    public static void main(String[] args) {
        Animal cat = new Animal() {
            @Override
            void makeSound() {
                System.out.println("Meow");
            }
        };

        cat.makeSound();
    }
}
```

---

## 🔹 Example 3: With GUI Listener

```java
button.addActionListener(new ActionListener() {
    @Override
    public void actionPerformed(ActionEvent e) {
        System.out.println("Button clicked!");
    }
});
```

---

## 🔹 Key Points

- Cannot have **constructors** (no name → can't be called).
- Can access **final or effectively final variables** from the enclosing scope.
- Used when **functional interfaces** (Java 8+) weren't available.
- Anonymous classes are **inner classes**.

An extra note: since there's no constructor, use an **instance initializer block** if you need setup:

```java
Map<String, Integer> map = new HashMap<>() {{     // "double brace initialization"
    put("a", 1);
    put("b", 2);
}};
```

Cute, but **avoid it** — it creates a subclass of `HashMap` holding a hidden reference to the enclosing object, breaking `equals` and leaking memory. Use `Map.of("a", 1, "b", 2)` instead.

---

## 🔹 Limitation

- Can only extend **one class** or **implement one interface**.
- Not reusable.
- Makes code harder to read if overused.

---

## 🔹 Java 8 Alternative (Lambda)

For functional interfaces, use lambdas instead of anonymous classes:

```java
Runnable r = () -> System.out.println("Running with lambda!");
r.run();
```

### When a lambda is *not* an option

A lambda only works for a **functional interface** (exactly one abstract method). Anonymous classes are still needed when:

```java
// 1. Extending an abstract CLASS
Animal a = new Animal() { void makeSound() { System.out.println("?"); } };

// 2. Implementing an interface with MORE THAN ONE abstract method
MouseListener ml = new MouseListener() {
    public void mouseClicked(MouseEvent e)  { }
    public void mousePressed(MouseEvent e)  { }
    public void mouseReleased(MouseEvent e) { }
    public void mouseEntered(MouseEvent e)  { }
    public void mouseExited(MouseEvent e)   { }
};

// 3. You need instance STATE inside the implementation
Runnable counter = new Runnable() {
    private int count = 0;                 // a lambda can't hold its own field
    public void run() { System.out.println(++count); }
};
```

### One more difference: what `this` means

```java
public class Outer {
    void demo() {
        Runnable anon = new Runnable() {
            public void run() {
                System.out.println(this);        // the ANONYMOUS object
            }
        };

        Runnable lambda = () -> System.out.println(this);   // the OUTER object
    }
}
```

A lambda is **not** a new class — it has no `this` of its own, so `this` refers to the enclosing instance. An anonymous class *is* a new class with its own `this`. This trips people up when converting one to the other.

---

## 5. Choosing between them

| Need | Use |
| :-- | :-- |
| A helper type that doesn't need the outer instance | **static nested class** |
| A helper that genuinely needs outer instance state | **inner class** |
| A one-off implementation of a functional interface | **lambda** |
| A one-off implementation with state, or of a multi-method interface / abstract class | **anonymous class** |
| Anything reusable or more than ~20 lines | **a normal top-level class** |

---

## 🧠 Rapid-fire recall

1. Why is `outer.new Inner()` the syntax for creating a non-static inner class?
2. How can an inner class read the outer class's `private` field?
3. Why is a non-static inner class a memory-leak risk, and what fixes it?
4. Why must a local class capture only effectively-final variables?
5. Why can't an anonymous class have a constructor, and what do you use instead?
6. Give two cases where a lambda cannot replace an anonymous class.
7. What does `this` refer to inside a lambda versus inside an anonymous class?

<details>
<summary>Answers</summary>

1. The instance holds a hidden reference to an enclosing `Outer` object, so one must exist to construct it.
2. The compiler stores that hidden `Outer this$0` reference and rewrites the access through it.
3. The hidden reference keeps the outer object reachable, so it can't be garbage collected. Declaring the nested class `static` removes the reference.
4. The captured local lives on the stack and may be gone when the object runs, so the value is copied — allowing reassignment would make the copy silently diverge.
5. A constructor must share the class's name, and there is none. Use an instance initializer block (though for maps, prefer `Map.of`).
6. Extending an abstract class; implementing an interface with more than one abstract method; needing instance fields inside the implementation.
7. In a lambda, `this` is the enclosing instance; in an anonymous class it's the anonymous object itself.

</details>
