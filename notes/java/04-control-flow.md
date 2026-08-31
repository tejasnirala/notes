---
title: Control Flow
author: Tejas Nirala
---

# Control Flow

Control flow is how you make a program *decide* and *repeat*. The shapes are the same as in C, C++ and JavaScript, with two Java-specific things worth real attention: the `switch` statement's fall-through behaviour, and the modern `switch` expression that fixes it.

---

## 1. `if` / `else if` / `else`

```java
int score = 82;

if (score >= 90) {
    System.out.println("A");
} else if (score >= 80) {
    System.out.println("B");
} else if (score >= 70) {
    System.out.println("C");
} else {
    System.out.println("F");
}
// prints: B
```

**The condition must be a `boolean`.** Java has no "truthiness":

```java
int x = 5;
if (x) { }        // ❌ compile error — int is not boolean
if (x != 0) { }   // ✅

String s = "";
if (s) { }        // ❌ compile error
if (!s.isEmpty()) { }  // ✅
```

This is a real safety win over JavaScript, where `if ("0")`, `if ([])` and `if (" ")` are all truthy and nobody remembers which.

### Braces are optional for a single statement — but always use them

```java
if (ready)
    start();
    log();      // ⚠️ NOT part of the if! Runs unconditionally. Classic bug.
```

Just always write the braces.

---

## 2. `switch` (the classic statement form)

Compares one value against several constants.

```java
int day = 3;

switch (day) {
    case 1:
        System.out.println("Monday");
        break;
    case 2:
        System.out.println("Tuesday");
        break;
    case 3:
        System.out.println("Wednesday");
        break;
    default:
        System.out.println("Unknown");
}
// prints: Wednesday
```

### Fall-through: the #1 `switch` bug

If you forget `break`, execution **falls through** into the next case and keeps going:

```java
switch (2) {
    case 1: System.out.println("one");
    case 2: System.out.println("two");     // matched here
    case 3: System.out.println("three");   // ...and keeps falling
    default: System.out.println("other");
}
// prints: two, three, other  😱
```

Deliberate fall-through is occasionally useful for grouping:

```java
switch (month) {
    case 1: case 3: case 5: case 7: case 8: case 10: case 12:
        days = 31; break;
    case 4: case 6: case 9: case 11:
        days = 30; break;
    case 2:
        days = isLeapYear ? 29 : 28; break;
}
```

### What can you switch on?

`byte`, `short`, `char`, `int`, their wrappers, `String` (Java 7+), `enum`, and — from Java 21 — any object with pattern matching.

```java
String command = "start";

switch (command) {
    case "start": startServer(); break;
    case "stop":  stopServer();  break;
    default:      System.out.println("Unknown command");
}
```

> ⚠️ Switching on a `null` String throws `NullPointerException` in the classic form. Guard it.

---

## 3. `switch` expressions (Java 14+) — use these

The arrow form fixes fall-through *and* lets `switch` produce a value.

```java
int day = 3;

String name = switch (day) {
    case 1 -> "Monday";
    case 2 -> "Tuesday";
    case 3 -> "Wednesday";
    case 6, 7 -> "Weekend";        // multiple labels, comma-separated
    default -> "Unknown";
};

System.out.println(name);   // Wednesday
```

Key differences from the old form:

| | Classic `switch` | Arrow `switch` expression |
| :-- | :-- | :-- |
| Fall-through | ✅ yes (needs `break`) | ❌ never |
| Produces a value | ❌ no | ✅ yes |
| Exhaustiveness checked | ❌ no | ✅ yes (for enums/sealed types) |

For a multi-line branch, use a block with `yield`:

```java
int size = switch (category) {
    case "small"  -> 1;
    case "medium" -> 5;
    case "large"  -> {
        log("large selected");
        yield 20;                 // `yield` returns the block's value
    }
    default -> throw new IllegalArgumentException("bad category: " + category);
};
```

**Exhaustiveness** is the quiet superpower. With an enum, if you add a new constant and forget to handle it, the compiler tells you:

```java
enum Status { ACTIVE, PAUSED, CLOSED }

String label = switch (status) {
    case ACTIVE -> "running";
    case PAUSED -> "on hold";
    // ❌ compile error: the switch expression does not cover CLOSED
};
```

---

## 4. Loops

### 4.1 `for` — when you know the count

```java
for (int i = 0; i < 5; i++) {
    System.out.println(i);      // 0 1 2 3 4
}
```

```
for ( initialization ; condition ; update ) { body }
        │                 │            │
        │                 │            └── runs AFTER each iteration
        │                 └─────────────── checked BEFORE each iteration
        └───────────────────────────────── runs once, at the start
```

Variations:

```java
for (int i = 10; i > 0; i--) { }                 // countdown
for (int i = 0, j = 10; i < j; i++, j--) { }     // two counters
for (;;) { }                                     // infinite (same as while(true))
```

The loop variable's scope is the loop — `i` doesn't exist after the closing brace.

### 4.2 Enhanced `for` (for-each) — when you just want each element

```java
int[] nums = {10, 20, 30};

for (int n : nums) {
    System.out.println(n);
}

List<String> names = List.of("Tejas", "Ankit", "Ravi");
for (String name : names) {
    System.out.println(name);
}
```

Read `:` as "in". Cleaner and safer — no index, so no off-by-one and no `ArrayIndexOutOfBoundsException`.

**Limitations:** you don't get the index, you can only go forward, and you can't assign back into the array through the loop variable:

```java
for (int n : nums) {
    n = n * 2;        // ⚠️ modifies the local copy only — nums is unchanged
}
```

### 4.3 `while` — when the count is unknown

```java
int i = 0;
while (i < 5) {
    System.out.println(i);
    i++;
}
```

Condition is checked **before** the body, so the body may run zero times.

### 4.4 `do…while` — run at least once

```java
int choice;
do {
    choice = readMenuChoice();
    handle(choice);
} while (choice != 0);
```

Condition is checked **after** the body, so the body always runs at least once. Note the mandatory semicolon after `while (...)`.

---

## 5. `break` and `continue`

```java
for (int i = 0; i < 10; i++) {
    if (i == 3) continue;   // skip the rest of THIS iteration
    if (i == 6) break;      // exit the loop entirely
    System.out.print(i + " ");
}
// prints: 0 1 2 4 5
```

### Labelled break/continue — for nested loops

Without labels, `break` only exits the innermost loop. A label lets you jump out of an outer one:

```java
outer:
for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) {
        if (i * j > 2) {
            break outer;      // exits BOTH loops
        }
        System.out.println(i + "," + j);
    }
}
```

Use sparingly — it's the closest thing Java has to `goto`, and heavy use usually means the loop body should be a method with an early `return`.

---

## 6. Choosing the right loop

| Situation | Use |
| :-- | :-- |
| You need the index, or a non-1 step | `for` |
| You just want every element | enhanced `for` |
| Repeat until a condition changes, count unknown | `while` |
| Must execute at least once (menus, retries) | `do…while` |
| Transforming/filtering a collection into another | [Streams](./32-stream-api.md) |

---

## 7. Worked example: FizzBuzz, three ways

```java
public class ControlFlowDemo {
    public static void main(String[] args) {

        // 1. if / else if
        for (int i = 1; i <= 15; i++) {
            if (i % 15 == 0)      System.out.println("FizzBuzz");
            else if (i % 3 == 0)  System.out.println("Fizz");
            else if (i % 5 == 0)  System.out.println("Buzz");
            else                  System.out.println(i);
        }

        // 2. switch expression on the remainder pair
        for (int i = 1; i <= 15; i++) {
            String out = switch (i % 15) {
                case 0 -> "FizzBuzz";
                case 3, 6, 9, 12 -> "Fizz";
                case 5, 10 -> "Buzz";
                default -> String.valueOf(i);
            };
            System.out.println(out);
        }

        // 3. ternary chain (compact, less readable)
        for (int i = 1; i <= 15; i++) {
            System.out.println(
                i % 15 == 0 ? "FizzBuzz" :
                i % 3  == 0 ? "Fizz"     :
                i % 5  == 0 ? "Buzz"     : String.valueOf(i));
        }
    }
}
```

---

## 🧠 Rapid-fire recall

1. Why is `if (x)` a compile error when `x` is an `int`?
2. What happens if you omit `break` in a classic `switch` case?
3. Name two things an arrow `switch` expression gives you that the classic form doesn't.
4. What does `yield` do?
5. When would you choose `do…while` over `while`?
6. Can you modify an array's contents through an enhanced-for loop variable?
7. What does `break outer;` do?

<details>
<summary>Answers</summary>

1. Java has no truthiness — `if` requires an actual `boolean` expression.
2. Execution falls through into the following cases and keeps running until a `break` or the end of the switch.
3. It produces a value (it's an expression), it never falls through, and it is checked for exhaustiveness over enums/sealed types.
4. Returns a value out of a multi-statement `{ }` block inside a switch expression.
5. When the body must run at least once before the condition can be evaluated — menus, retry loops, reading input.
6. No — the loop variable is a copy. Use an indexed `for` loop to write back.
7. Breaks out of the loop carrying the label `outer:`, not just the innermost loop.

</details>
