---
title: Classes, Objects & Constructors
author: Tejas Nirala
---

# Classes, Objects & Constructors

Everything in Java lives inside a class. Before we get to the four pillars of OOP, you need to be completely comfortable with what a class *is*, what happens in memory when you write `new`, and how constructors work.

---

## 1. Class vs Object

A **class** is a blueprint. An **object** is a thing built from that blueprint.

> The class `Car` describes *what a car has* (brand, speed) and *what a car does* (accelerate, brake). `new Car()` builds an actual car.

```java
public class Car {
    // Fields (state) — what a Car HAS
    String brand;
    String model;
    int speed;

    // Methods (behaviour) — what a Car DOES
    void accelerate(int amount) {
        speed += amount;
        System.out.println(brand + " accelerating to " + speed);
    }

    void brake() {
        speed = 0;
        System.out.println(brand + " stopped");
    }
}
```

```java
public class Main {
    public static void main(String[] args) {
        Car c1 = new Car();     // one object
        c1.brand = "Toyota";
        c1.accelerate(50);      // Toyota accelerating to 50

        Car c2 = new Car();     // a completely separate object
        c2.brand = "Honda";
        c2.accelerate(80);      // Honda accelerating to 80

        System.out.println(c1.speed);   // 50 — c2's changes didn't touch c1
    }
}
```

One class, many objects, each with its own independent copy of the fields.

---

## 2. What `new` actually does

```java
Car c1 = new Car();
```

Four things happen, in this order:

1. **Memory is allocated on the heap** for a `Car` object, big enough for all its fields.
2. **Fields are set to their defaults** — `0`, `0.0`, `false`, `'\u0000'`, `null`.
3. **The constructor runs**, doing any custom setup.
4. **The address of the new object is returned** and stored in `c1`.

```
        STACK                        HEAP
   ┌──────────────┐         ┌────────────────────────┐
   │  c1  ●───────┼────────▶│  Car object            │
   └──────────────┘         │   brand = "Toyota"     │
                            │   model = null         │
                            │   speed = 50           │
                            └────────────────────────┘
```

`c1` is **not** the object. `c1` is a reference *to* the object. That's why:

```java
Car a = new Car();
a.brand = "Toyota";

Car b = a;             // b now points at the SAME object
b.brand = "Honda";

System.out.println(a.brand);   // "Honda"  ← a and b are the same car
System.out.println(a == b);    // true     ← same reference
```

And why a reference can point at nothing:

```java
Car c = null;
c.accelerate(10);    // 💥 NullPointerException
```

---

## 3. Constructors

A **constructor** is a special method that runs when an object is created. It has:
- the **same name as the class**, and
- **no return type** (not even `void`).

```java
public class Car {
    String brand;
    int speed;

    // Constructor
    public Car(String brand) {
        this.brand = brand;
        this.speed = 0;
    }
}

Car c = new Car("Toyota");
```

### 3.1 The default constructor

If you write **no** constructor at all, the compiler quietly gives you a no-argument one:

```java
class Dog { }
// compiler inserts:  Dog() { super(); }

Dog d = new Dog();   // works
```

But the moment you write *any* constructor, the free one disappears:

```java
class Dog {
    String name;
    Dog(String name) { this.name = name; }
}

Dog d = new Dog();          // ❌ compile error — no no-arg constructor exists
Dog d2 = new Dog("Rex");    // ✅
```

If you want both, declare both.

### 3.2 Constructor overloading

Same rules as [method overloading](./06-methods-and-overloading.md) — differing parameter lists:

```java
public class Rectangle {
    double width, height;

    Rectangle() {                       // default 1x1
        this(1, 1);                     // delegates to the 2-arg constructor
    }

    Rectangle(double side) {            // square
        this(side, side);
    }

    Rectangle(double width, double height) {   // the "canonical" one
        this.width = width;
        this.height = height;
    }

    double area() { return width * height; }
}
```

`this(...)` calls **another constructor of the same class**, and must be the **first statement**. It's how you avoid duplicating setup logic across overloads.

### 3.3 `this` — the reference to "the current object"

```java
class Person {
    String name;

    Person(String name) {
        this.name = name;
        //   ↑         ↑
        //   field   parameter (they shadow each other, so `this` disambiguates)
    }

    Person withName(String name) {
        this.name = name;
        return this;              // returning `this` enables method chaining
    }
}
```

Three uses of `this`:
1. Disambiguate a field from a same-named parameter.
2. Pass the current object to another method: `register(this)`.
3. Call another constructor: `this(...)`.

---

## 4. The order things get initialized

This is a classic interview question, and understanding it kills a whole class of bugs.

```java
public class InitOrder {
    static int staticField = printAndReturn("1. static field");

    static {
        System.out.println("2. static block");
    }

    int instanceField = printAndReturn("3. instance field");

    {
        System.out.println("4. instance initializer block");
    }

    InitOrder() {
        System.out.println("5. constructor");
    }

    static int printAndReturn(String s) {
        System.out.println(s);
        return 0;
    }

    public static void main(String[] args) {
        System.out.println("--- creating first object ---");
        new InitOrder();
        System.out.println("--- creating second object ---");
        new InitOrder();
    }
}
```

Output:

```
1. static field
2. static block
--- creating first object ---
3. instance field
4. instance initializer block
5. constructor
--- creating second object ---
3. instance field
4. instance initializer block
5. constructor
```

**The rule:**

```
ONCE, when the class is first loaded:
  static fields  →  static blocks     (in source order)

EVERY TIME you write `new`:
  super's initialization  →  instance fields  →  instance blocks  →  constructor body
```

---

## 5. A complete, realistic class

```java
public class BankAccount {

    // ── Constants ─────────────────────────────────────────
    private static final double MIN_BALANCE = 100.0;

    // ── Static state (shared by ALL accounts) ─────────────
    private static int accountCounter = 0;

    // ── Instance state (one copy per object) ──────────────
    private final String accountNumber;   // final: set once, never changes
    private final String ownerName;
    private double balance;

    // ── Constructors ──────────────────────────────────────
    public BankAccount(String ownerName) {
        this(ownerName, MIN_BALANCE);
    }

    public BankAccount(String ownerName, double initialDeposit) {
        if (ownerName == null || ownerName.isBlank()) {
            throw new IllegalArgumentException("Owner name is required");
        }
        if (initialDeposit < MIN_BALANCE) {
            throw new IllegalArgumentException("Minimum opening balance is " + MIN_BALANCE);
        }
        this.ownerName     = ownerName;
        this.balance       = initialDeposit;
        this.accountNumber = "ACC" + (++accountCounter);
    }

    // ── Behaviour ─────────────────────────────────────────
    public void deposit(double amount) {
        if (amount <= 0) throw new IllegalArgumentException("Deposit must be positive");
        balance += amount;
    }

    public void withdraw(double amount) {
        if (amount <= 0)                    throw new IllegalArgumentException("Invalid amount");
        if (balance - amount < MIN_BALANCE) throw new IllegalStateException("Insufficient funds");
        balance -= amount;
    }

    // ── Read-only access ──────────────────────────────────
    public double getBalance()      { return balance; }
    public String getOwnerName()    { return ownerName; }
    public String getAccountNumber(){ return accountNumber; }

    public static int getTotalAccounts() { return accountCounter; }

    @Override
    public String toString() {
        return "BankAccount[" + accountNumber + ", " + ownerName + ", " + balance + "]";
    }
}
```

Notice what this class does that a bag of variables can't:

- **It cannot be created in an invalid state** — the constructor validates.
- **It cannot be *put into* an invalid state** — `balance` is private, and `withdraw` enforces the rules.
- **Callers don't need to know the rules** — they just call `withdraw` and get an exception if it's not allowed.

That's the actual point of OOP, and it's what [Encapsulation](./10-pillars-of-oop.md) means in practice.

---

## 6. Getters, setters, and when *not* to write them

The mechanical "private field + public getter + public setter for everything" pattern is a beginner reflex, and it defeats the purpose:

```java
// 😖 Encapsulation in name only — this is just a public field with extra typing
private double balance;
public double getBalance()          { return balance; }
public void   setBalance(double b)  { balance = b; }
```

Anyone can now write `account.setBalance(-99999)`. Expose **operations**, not fields:

```java
// 😊 The object protects its own invariants
public void deposit(double amount)  { ... }
public void withdraw(double amount) { ... }
public double getBalance()          { return balance; }   // read-only is fine
```

---

## 7. Instance members vs static members (preview)

```java
class Counter {
    int instanceCount;          // one per object
    static int staticCount;     // ONE, shared by all objects

    Counter() {
        instanceCount++;
        staticCount++;
    }
}

new Counter();
new Counter();
new Counter();
// each object's instanceCount == 1
// Counter.staticCount        == 3
```

The full story is on the next page: [Static Members](./09-static-members.md).

---

## 🧠 Rapid-fire recall

1. What are the four steps that happen when you execute `new Car()`?
2. When does the compiler give you a free no-arg constructor, and when does it stop?
3. What does `this(...)` do, and where must it appear?
4. In what order do static fields, static blocks, instance fields, instance blocks and the constructor run?
5. `Car b = a; b.brand = "Honda";` — why did `a.brand` change too?
6. Why is `private double balance; setBalance(double)` not real encapsulation?
7. What's the difference between an instance field and a static field?

<details>
<summary>Answers</summary>

1. Allocate heap memory → set all fields to type defaults → run the constructor → return the reference.
2. You get it only if you declare no constructor at all; declaring any constructor removes the implicit one.
3. Calls another constructor of the same class to share setup logic; it must be the first statement in the constructor.
4. Static fields and static blocks once at class load (in source order), then per object: superclass init → instance fields → instance blocks → constructor body.
5. `a` and `b` are two references to the same heap object; assigning a reference copies the pointer, not the object.
6. An unconstrained setter lets any caller put the object into an invalid state — it's a public field wearing a disguise.
7. An instance field has one copy per object; a static field has exactly one copy shared by the whole class.

</details>
