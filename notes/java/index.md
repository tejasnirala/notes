---
title: Java
author: Tejas Nirala
---

# Java

A complete path from *what is bytecode* to *why did my counter lose half its increments* — written so that someone who has never touched Java can read it end to end and genuinely understand how the language works, with nothing else open in another tab.

**Who this is for:**

- You've written JavaScript, Python, C++, PHP or Go for a few years and now need Java. The notes constantly point out where Java differs from what you already know.
- Or you've never programmed in a typed, compiled, object-oriented language at all. Every concept is built from the ground up, in order, with no forward references you can't follow.

**How it's written:** concept first, then a worked example, then the trap that bites people. Every page ends with **rapid-fire recall** questions and collapsible answers, so you can check whether it actually stuck.

---

## 📚 The curriculum

### Part 1 — Foundations

*How the language and the runtime actually work.*

| | Page | What it answers |
| :-- | :--- | :--- |
| 1 | **[How Java Works](./01-how-java-works.md)** | JDK vs JRE vs JVM, bytecode, class loading, JIT, stack vs heap, garbage collection |
| 2 | **[Variables, Data Types & Literals](./02-variables-and-data-types.md)** | The 8 primitives, wrappers & autoboxing, the `Integer` cache trap, literals, type conversion & casting |
| 3 | **[Operators](./03-operators.md)** | Integer division, `i = i++`, short-circuiting, bit flags, precedence |
| 4 | **[Control Flow](./04-control-flow.md)** | `if`/`switch` fall-through, arrow `switch` expressions & exhaustiveness, all four loops, labelled break |
| 5 | **[Arrays](./05-arrays.md)** | Fixed size, defaults, `Arrays.toString`, copying, jagged 2-D arrays, varargs |
| 6 | **[Methods & Overloading](./06-methods-and-overloading.md)** | Pass-by-value settled properly, recursion, overload resolution order, type promotion |
| 7 | **[Strings](./07-strings.md)** | Immutability and *why*, the String Constant Pool, `StringBuilder` performance, text blocks |

### Part 2 — Object-Oriented Java

*The four pillars, and every mechanism that implements them.*

| | Page | What it answers |
| :-- | :--- | :--- |
| 8 | **[Classes, Objects & Constructors](./08-classes-and-objects.md)** | What `new` really does, `this`, constructor chaining, exact initialization order |
| 9 | **[Static in Java](./09-static-members.md)** | Why `main` is static, static blocks, method *hiding* vs overriding, when static hurts |
| 10 | **[The Four Pillars of OOP](./10-pillars-of-oop.md)** | Encapsulation, abstraction, inheritance, polymorphism — with the Diamond Problem |
| 11 | **[Inheritance & Dynamic Dispatch](./11-inheritance-and-polymorphism.md)** | Overriding rules, vtables, why fields aren't polymorphic, upcasting/downcasting |
| 12 | **[Abstract Classes & Methods](./12-abstract-classes.md)** | Why constructors exist on abstract classes, the Template Method pattern |
| 13 | **[Interfaces](./13-interfaces.md)** | `default`/`static`/`private` methods, conflicting defaults, all five kinds of interface |
| 14 | **[The `final` Keyword](./14-final-keyword.md)** | Final ≠ immutable, effectively final, the immutable-class recipe |
| 15 | **[Packages & Access Modifiers](./15-packages-and-access-modifiers.md)** | The four access levels, the `protected` subtlety, modules |
| 16 | **[The `Object` Class](./16-object-class.md)** | `toString`, `equals`/`hashCode` and exactly what breaks when they disagree |
| 17 | **[Inner & Anonymous Classes](./17-inner-and-anonymous-classes.md)** | All four kinds, the hidden outer reference & memory leak, lambda vs anonymous `this` |

### Part 3 — Modern language features

| | Page | What it answers |
| :-- | :--- | :--- |
| 18 | **[Enums](./18-enums.md)** | Constants with fields and behaviour, constant-specific overrides, `EnumMap`/`EnumSet` |
| 19 | **[Records](./19-records.md)** | 30 lines → 1, compact constructors, deconstruction patterns |
| 20 | **[Sealed Classes](./20-sealed-classes.md)** | Controlled inheritance, exhaustive switches, algebraic data types |
| 21 | **[`var` — Type Inference](./21-var-type-inference.md)** | What it is and isn't, where it's banned, when it hurts readability |

### Part 4 — Robustness

| | Page | What it answers |
| :-- | :--- | :--- |
| 22 | **[Exception Handling](./22-exceptions.md)** | Checked vs unchecked, try-with-resources & suppressed exceptions, the anti-pattern list |
| 23 | **[Generics](./23-generics.md)** | Why `List<Integer>` isn't a `List<Number>`, PECS wildcards, type erasure and its consequences |

### Part 5 — Collections

| | Page | What it answers |
| :-- | :--- | :--- |
| 24 | **[The Collections Framework](./24-collections-framework.md)** | The full hierarchy, a decision tree, the performance table, `ConcurrentModificationException` |
| 25 | **[Lists & ArrayList](./25-lists.md)** | The resize algorithm, the `remove(int)` trap, why `LinkedList` loses |
| 26 | **[Sets](./26-sets.md)** | `HashSet` vs `LinkedHashSet` vs `TreeSet`, navigation methods, the `compareTo` trap |
| 27 | **[Maps](./27-maps.md)** | `merge`/`computeIfAbsent`, how `HashMap` works internally, an LRU cache in six lines |
| 28 | **[Comparable & Comparator](./28-comparable-and-comparator.md)** | The contract, the subtraction-overflow bug, chaining and null handling |
| 29 | **[forEach & Iteration](./29-foreach-and-iteration.md)** | Every way to iterate and when to use each, why you can't `break` |

### Part 6 — Functional Java

| | Page | What it answers |
| :-- | :--- | :--- |
| 30 | **[Lambda Expressions](./30-lambdas.md)** | Target typing, effectively-final capture, what `invokedynamic` actually does |
| 31 | **[Functional Interfaces & Method References](./31-functional-interfaces.md)** | The six core interfaces, composition, all four method-reference forms |
| 32 | **[Stream API](./32-stream-api.md)** | Laziness and short-circuiting, `flatMap`, `groupingBy` with downstream collectors, parallel streams |
| 33 | **[map, filter, reduce & sorted](./33-map-filter-reduce-sorted.md)** | The four workhorses, why identity matters, pipeline ordering for performance |
| 34 | **[Optional](./34-optional.md)** | Chaining away null checks, `orElse` vs `orElseGet`, where *not* to use it |

### Part 7 — Concurrency

| | Page | What it answers |
| :-- | :--- | :--- |
| 35 | **[Threads & Multithreading](./35-threads.md)** | `start()` vs `run()`, `join`, interruption, `synchronized`, `volatile`, deadlock |
| 36 | **[Thread States](./36-thread-states.md)** | All six states, every transition, and how to read a thread dump |
| 37 | **[Runnable vs Thread](./37-runnable-vs-thread.md)** | Why `Runnable` always wins, `Callable`, the historical progression |
| 38 | **[Race Conditions](./38-race-conditions.md)** | Atomicity vs visibility, `synchronized`/`Atomic`/`ReentrantLock` benchmarked |
| 39 | **[Executors & Futures](./39-executors-and-futures.md)** | Thread pools, `CompletableFuture`, concurrent collections, virtual threads |

---

## 🎯 Suggested paths

**"I've never written Java. Start me at the beginning."**
Read Parts 1 and 2 in order — pages 1 through 17. Don't skip [How Java Works](./01-how-java-works.md); almost everything odd about Java makes sense once you've seen that picture. Then Part 4 ([Exceptions](./22-exceptions.md), [Generics](./23-generics.md)) and Part 5 (Collections). At that point you can read and write real Java.

**"I have 3–4 years in JavaScript / Python and need Java quickly."**
[How Java Works](./01-how-java-works.md) → [Variables & Data Types](./02-variables-and-data-types.md) → [Classes & Objects](./08-classes-and-objects.md) → [Pillars of OOP](./10-pillars-of-oop.md) → [Interfaces](./13-interfaces.md) → [Collections](./24-collections-framework.md) → [Lambdas](./30-lambdas.md) → [Streams](./32-stream-api.md). Streams will feel like `.map`/`.filter` with a laziness twist; collections will feel familiar; the type system and OOP ceremony are the real adjustment.

**"I know C++ / C#. What's actually different?"**
[How Java Works](./01-how-java-works.md) (GC, JIT, no manual memory) → [The `Object` Class](./16-object-class.md) (`equals`/`hashCode`) → [Generics](./23-generics.md) (erasure, *not* templates) → [Exceptions](./22-exceptions.md) (checked exceptions are unique to Java) → [Interfaces](./13-interfaces.md) (no multiple class inheritance).

**"I have an interview next week."**
[Pillars of OOP](./10-pillars-of-oop.md) → [Inheritance & Dispatch](./11-inheritance-and-polymorphism.md) → [Strings](./07-strings.md) (the String pool comes up constantly) → [The `Object` Class](./16-object-class.md) (`equals`/`hashCode` is the single most-asked topic) → [Collections](./24-collections-framework.md) + [Maps](./27-maps.md) (how `HashMap` works internally) → [Exceptions](./22-exceptions.md) → [Streams](./32-stream-api.md) → [Race Conditions](./38-race-conditions.md). Work the rapid-fire questions at the end of each.

**"I already write Java, I want the modern parts."**
[Records](./19-records.md) → [Sealed Classes](./20-sealed-classes.md) → [`var`](./21-var-type-inference.md) → [Optional](./34-optional.md) → [Streams](./32-stream-api.md) → [Executors & Virtual Threads](./39-executors-and-futures.md).

---

## 📌 The ten things that trip up almost everyone

A shortlist, with the page that explains each:

1. `==` compares references, `.equals()` compares content — [Strings](./07-strings.md)
2. `Integer a = 128, b = 128; a == b` is `false` — [Data Types](./02-variables-and-data-types.md)
3. `7 / 2` is `3`, not `3.5` — [Operators](./03-operators.md)
4. Java is *always* pass-by-value, even for objects — [Methods](./06-methods-and-overloading.md)
5. `final` freezes the reference, not the object — [`final`](./14-final-keyword.md)
6. Override `equals` without `hashCode` and your `HashSet` breaks silently — [The `Object` Class](./16-object-class.md)
7. `list.remove(1)` removes an *index*, not the value `1` — [Lists](./25-lists.md)
8. A stream does nothing until a terminal operation runs — [Streams](./32-stream-api.md)
9. `orElse(expensiveCall())` always evaluates the call — [Optional](./34-optional.md)
10. `count++` is not atomic — [Race Conditions](./38-race-conditions.md)
