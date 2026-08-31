---
title: The final Keyword
author: Tejas Nirala
---

# `final` in Java

## ✅ Definition of `final` in Java:

> In Java, the keyword `final` is used to declare constants, prevent method overriding, and prevent inheritance.
>
> It means **"cannot be changed"** once it is assigned or declared.

---

## ✅ Three Main Uses of `final` in Java:

| Used With | Meaning |
| --- | --- |
| **Variable** | Value cannot be changed after assignment (like a constant). |
| **Method** | Method cannot be overridden in any subclass. |
| **Class** | Class cannot be inherited (i.e., no subclass can be created from it). |

---

## ✅ 1. Final Variable Example:

```java
final int x = 10;
x = 20;  // ❌ Error: Cannot assign a value to final variable 'x'
```

- Once assigned, the value of `x` **cannot be changed**.
- Used often to declare **constants** (e.g., `final double PI = 3.14;`)

---

## ✅ 2. Final Method Example:

```java
class Animal {
    final void sound() {
        System.out.println("Animal makes sound");
    }
}

class Dog extends Animal {
    // ❌ Cannot override final method
    void sound() {
        System.out.println("Dog barks");
    }
}
```

- `final` on `sound()` prevents any subclass from **overriding** it.

---

## ✅ 3. Final Class Example:

```java
final class Vehicle {
    void display() {
        System.out.println("This is a vehicle");
    }
}

// ❌ Cannot extend final class
class Car extends Vehicle {
    void display() {
        System.out.println("This is a car");
    }
}
```

- If a class is marked `final`, it **cannot be subclassed** or inherited.
- Example in Java: `java.lang.String` is a **final class**.

---

## ✅ Important Notes:

- You **can** declare a final variable without initializing it immediately — it's called a **blank final**, but it must be initialized **once** before the constructor ends.

```java
class Test {
    final int x;

    Test() {
        x = 100; // must initialize here if not done above
    }
}
```

- Final variables **inside methods** are often used in anonymous classes or lambda expressions.

---

## ✅ Summary (for Interviews):

| Keyword Usage | Meaning |
| --- | --- |
| `final` variable | Value cannot change after being assigned once. |
| `final` method | Cannot be overridden by a subclass. |
| `final` class | Cannot be inherited. No class can extend it. |

---

## 4. The trap: `final` freezes the *reference*, not the *object*

This is the single most misunderstood thing about `final`.

```java
final List<String> names = new ArrayList<>();

names.add("Tejas");        // ✅ ALLOWED — you're mutating the object
names.add("Ankit");        // ✅ ALLOWED
System.out.println(names); // [Tejas, Ankit]

names = new ArrayList<>(); // ❌ NOT allowed — you're rebinding the variable
```

```
   final List<String> names ●────▶ [ ArrayList — freely mutable ]
        ↑                                    ↑
   this arrow is frozen              this content is NOT frozen
```

**`final` ≠ immutable.** For a genuinely unchangeable list:

```java
final List<String> names = List.of("Tejas", "Ankit");
names.add("Ravi");     // 💥 UnsupportedOperationException
```

Same for arrays:

```java
final int[] nums = {1, 2, 3};
nums[0] = 99;          // ✅ allowed
nums = new int[5];     // ❌ not allowed
```

---

## 5. Final parameters

```java
void process(final String name) {
    name = "changed";   // ❌ compile error
}
```

Useful to document "this parameter is never reassigned inside the method." Some teams require it; most don't bother, because reassigning a parameter is bad style anyway.

---

## 6. `final` and lambdas: "effectively final"

A lambda or anonymous class can only capture a local variable that is `final` **or effectively final** (never reassigned after initialisation).

```java
void run() {
    int count = 0;
    Runnable r = () -> System.out.println(count);   // ✅ count is effectively final
    r.run();
}

void broken() {
    int count = 0;
    Runnable r = () -> System.out.println(count);   // ❌ compile error
    count = 1;                                      // ← this reassignment breaks it
}
```

**Why the restriction?** The lambda captures a **copy** of the local variable's value (the local lives on the stack and may be gone by the time the lambda runs). If the original could still change, the lambda's copy would silently diverge from it — so Java forbids the setup instead of allowing a confusing bug.

The workaround when you genuinely need mutable capture is to hold the state in an object:

```java
int[] counter = {0};                              // array is effectively final; contents aren't
list.forEach(x -> counter[0]++);                  // ✅ works

// Or, properly:
AtomicInteger counter = new AtomicInteger();
list.forEach(x -> counter.incrementAndGet());
```

Since Java 8, you don't have to write `final` on captured variables — the compiler infers "effectively final". You still can, and it makes the intent explicit.

---

## 7. `final` fields and immutable classes

`final` fields are the backbone of immutable design:

```java
public final class Money {                 // final class — no subclass can break the rules
    private final String currency;         // final fields — set once, in the constructor
    private final BigDecimal amount;

    public Money(String currency, BigDecimal amount) {
        this.currency = currency;
        this.amount = amount;
    }

    // No setters. "Modification" returns a NEW object.
    public Money plus(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
        return new Money(currency, amount.add(other.amount));
    }

    public BigDecimal getAmount()  { return amount; }   // BigDecimal is itself immutable
    public String getCurrency()    { return currency; }
}
```

The recipe for an immutable class:

1. Make the class `final` (or all constructors private).
2. Make every field `private final`.
3. No setters, no methods that mutate state.
4. Initialise everything in the constructor.
5. If a field is a mutable object (`Date`, `List`, an array), **defensively copy** it on the way in *and* on the way out:

```java
private final List<String> tags;

public Immutable(List<String> tags) {
    this.tags = List.copyOf(tags);          // copy IN — caller can't mutate ours later
}

public List<String> getTags() {
    return tags;                             // already unmodifiable, safe to hand out
    // if it weren't: return new ArrayList<>(tags);
}
```

Immutable objects are automatically **thread-safe**, safe as `HashMap` keys, and impossible to corrupt. `String`, `Integer`, `LocalDate` and `BigDecimal` are all built this way. And [`record`](./19-records.md) gives you the whole recipe in one line.

---

## 8. Why does the JDK make `String` final?

```java
// If String weren't final, this would be legal:
class EvilString extends String {
    @Override public boolean equals(Object o) { return true; }   // always "equal"
}
```

Any security check comparing file paths, URLs or class names could be defeated. `final` closes that door — plus it lets the JVM safely cache hash codes and pool literals.

Other final JDK classes: `Integer`, `Double`, all wrappers, `LocalDate`, `LocalDateTime`, `UUID`.

---

## 9. `final` vs `finally` vs `finalize()`

An interview favourite, and they're completely unrelated:

| | What it is | Purpose |
| :-- | :-- | :-- |
| `final` | keyword | Prevents reassignment / overriding / inheritance |
| `finally` | block in try/catch | Always runs, for cleanup |
| `finalize()` | method on `Object` | Called (maybe) before GC — **deprecated since Java 9, removed in 18**. Never use it; use try-with-resources or `Cleaner`. |

```java
final int x = 5;                      // keyword

try {
    risky();
} finally {                           // block
    cleanup();                        // runs whether or not risky() threw
}
```

---

## 10. When to use `final` in practice

**Do:**
- `private static final` for constants — always.
- `private final` for fields set once in the constructor — this is a genuinely good default.
- `final` on classes that must not be extended for correctness (immutable value types, security-sensitive classes).
- `final` on a method that a subclass overriding would break (the template method in [Template Method](./12-abstract-classes.md)).

**Don't:**
- Sprinkle `final` on every local variable — it's noise, and the compiler already infers "effectively final".
- Make every class final "for performance". Modern JITs inline non-final methods perfectly well; you're just making the class untestable and unextendable for no gain.

---

## 🧠 Rapid-fire recall

1. `final List<String> l = new ArrayList<>(); l.add("x");` — legal or not, and why?
2. What is a "blank final", and when must it be assigned?
3. What does "effectively final" mean, and why do lambdas require it?
4. Name the five steps for writing an immutable class.
5. Why is `java.lang.String` declared `final`?
6. What is the difference between `final`, `finally` and `finalize()`?
7. Can a `final` method be overloaded? Can a `final` class implement an interface?

<details>
<summary>Answers</summary>

1. Legal. `final` freezes the reference, not the object's contents. Only `l = ...` would be rejected.
2. A `final` field declared without an initialiser; it must be assigned exactly once, before every constructor finishes.
3. A local variable never reassigned after initialisation. Lambdas capture a copy of the value, so allowing later reassignment would make the captured copy silently diverge.
4. Class `final`; all fields `private final`; no setters or mutators; initialise in the constructor; defensively copy mutable fields in and out.
5. To prevent a subclass from overriding `equals`/`hashCode` and defeating security checks, and to make hash caching and literal pooling safe.
6. `final` is a modifier preventing change/override/inheritance; `finally` is the always-executed block of a try statement; `finalize()` was a pre-GC callback, now removed.
7. Yes to both — `final` only prevents *overriding* and *extending*, not overloading or implementing.

</details>
