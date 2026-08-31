---
title: Operators
author: Tejas Nirala
---

# Operators

Operators are the verbs of the language. Most of them will look familiar from C, C++ or JavaScript — but Java has a few sharp edges (integer division, `==` on objects, short-circuiting) that cause real bugs, so it's worth going through them properly.

---

## 1. Arithmetic operators

| Operator | Meaning | Example | Result |
| :-- | :-- | :-- | :-- |
| `+` | Addition | `7 + 3` | `10` |
| `-` | Subtraction | `7 - 3` | `4` |
| `*` | Multiplication | `7 * 3` | `21` |
| `/` | Division | `7 / 3` | `2` ⚠️ |
| `%` | Modulus (remainder) | `7 % 3` | `1` |

### The integer division rule

If **both** operands are integer types, the result is an integer and the fraction is **discarded** (not rounded):

```java
System.out.println(7 / 3);       // 2
System.out.println(-7 / 3);      // -2   (truncated toward zero, not floored)
System.out.println(7 / 3.0);     // 2.3333333333333335
System.out.println(7 % 3);       // 1
System.out.println(-7 % 3);      // -1   (sign follows the LEFT operand)
```

> Coming from Python? `-7 // 3` is `-3` there and `-7 / 3` is `-2` here. Java truncates toward zero; Python floors.

Division by zero behaves differently for integers and floats:

```java
System.out.println(5 / 0);       // 💥 ArithmeticException: / by zero
System.out.println(5.0 / 0);     // Infinity
System.out.println(0.0 / 0.0);   // NaN
```

### Overflow is silent

```java
int max = Integer.MAX_VALUE;      // 2147483647
System.out.println(max + 1);      // -2147483648  😱 wraps around, no error
```

If you need it to fail loudly:

```java
Math.addExact(max, 1);            // 💥 ArithmeticException: integer overflow
```

---

## 2. Unary operators

| Operator | Meaning | Example |
| :-- | :-- | :-- |
| `+` | Unary plus (no-op) | `+5` |
| `-` | Negation | `-x` |
| `++` | Increment by 1 | `x++`, `++x` |
| `--` | Decrement by 1 | `x--`, `--x` |
| `!` | Logical NOT | `!isReady` |
| `~` | Bitwise NOT | `~5` → `-6` |

### Pre vs post increment — the classic interview question

```java
int a = 5;
System.out.println(a++);   // prints 5, THEN a becomes 6   (post: use, then change)
System.out.println(a);     // 6

int b = 5;
System.out.println(++b);   // b becomes 6 FIRST, then prints 6  (pre: change, then use)
```

A worked trap:

```java
int i = 0;
i = i++;                   // 🤯 i is still 0!
```

Why? `i++` returns the *old* value (0), and then the assignment writes that 0 back over the incremented value. **Never mix `++` with an assignment to the same variable.**

---

## 3. Assignment operators

| Operator | Equivalent to |
| :-- | :-- |
| `x = 5` | — |
| `x += 5` | `x = x + 5` |
| `x -= 5` | `x = x - 5` |
| `x *= 5` | `x = x * 5` |
| `x /= 5` | `x = x / 5` |
| `x %= 5` | `x = x % 5` |
| `x &= y`, `x \|= y`, `x ^= y`, `x <<= n`, `x >>= n` | bitwise variants |

### Compound assignment hides a cast

```java
byte b = 10;
b = b + 5;      // ❌ compile error: b+5 is an int, can't assign int to byte
b += 5;         // ✅ compiles! Compound assignment includes an IMPLICIT cast
```

`b += 5` is really `b = (byte)(b + 5)`. Convenient, but it means compound assignment can silently overflow:

```java
byte b = 120;
b += 10;
System.out.println(b);   // -126, not 130
```

---

## 4. Relational (comparison) operators

| Operator | Meaning |
| :-- | :-- |
| `==` | Equal to |
| `!=` | Not equal to |
| `>` `<` `>=` `<=` | Ordering |

All of them return a `boolean`.

### `==` means something different for objects

```java
int a = 5, b = 5;
System.out.println(a == b);            // true — comparing VALUES

String s1 = new String("hi");
String s2 = new String("hi");
System.out.println(s1 == s2);          // false — comparing REFERENCES (different objects)
System.out.println(s1.equals(s2));     // true  — comparing CONTENT
```

> **The rule you will use every day:** `==` for primitives, `.equals()` for objects.

---

## 5. Logical operators

| Operator | Meaning | Short-circuits? |
| :-- | :-- | :-- |
| `&&` | AND | ✅ yes |
| `\|\|` | OR | ✅ yes |
| `!` | NOT | — |
| `&` | AND (boolean) | ❌ no — always evaluates both |
| `\|` | OR (boolean) | ❌ no |
| `^` | XOR | ❌ no |

### Short-circuiting is a feature you rely on constantly

```java
String name = null;

if (name != null && name.length() > 0) {   // ✅ safe
    ...
}
```

Because `&&` short-circuits, once `name != null` is `false` Java **never evaluates** `name.length()`, so no `NullPointerException`. With `&` instead:

```java
if (name != null & name.length() > 0) {    // 💥 NullPointerException
```

Same logic for `||`: `if (cheapCheck() || expensiveCheck())` skips the expensive call when the cheap one already returned `true`.

---

## 6. The ternary (conditional) operator

The only operator in Java that takes three operands:

```java
condition ? valueIfTrue : valueIfFalse
```

```java
int age = 20;
String status = (age >= 18) ? "Adult" : "Minor";
System.out.println(status);   // Adult
```

It's an **expression** (it produces a value), unlike `if`, which is a statement. That's why you can use it inside another expression:

```java
System.out.println("You have " + n + " item" + (n == 1 ? "" : "s"));
```

Ternaries can nest, but readability collapses fast — two levels is the sane maximum.

---

## 7. Bitwise & shift operators

These work on the individual bits of integer types. You'll meet them in flags, hashing, encoding and low-level performance code.

| Operator | Name | `5 (0101)` op `3 (0011)` |
| :-- | :-- | :-- |
| `&` | AND | `1` (`0001`) |
| `\|` | OR | `7` (`0111`) |
| `^` | XOR | `6` (`0110`) |
| `~` | NOT | `~5` = `-6` |
| `<<` | Left shift | `5 << 1` = `10` |
| `>>` | Signed right shift | `-8 >> 1` = `-4` |
| `>>>` | Unsigned right shift | `-8 >>> 1` = `2147483644` |

```java
System.out.println(5 & 3);     // 1
System.out.println(5 | 3);     // 7
System.out.println(5 ^ 3);     // 6
System.out.println(5 << 1);    // 10  — shifting left by 1 multiplies by 2
System.out.println(5 >> 1);    // 2   — shifting right by 1 divides by 2 (floored)
```

The difference between `>>` and `>>>`:
- `>>` keeps the sign bit (fills the left with copies of the sign bit).
- `>>>` always fills the left with `0`, so a negative number becomes a huge positive one.

**A practical use — bit flags:**

```java
final int READ    = 0b001;   // 1
final int WRITE   = 0b010;   // 2
final int EXECUTE = 0b100;   // 4

int permissions = READ | WRITE;                    // 0b011 — has read + write

boolean canWrite   = (permissions & WRITE)   != 0; // true
boolean canExecute = (permissions & EXECUTE) != 0; // false

permissions |= EXECUTE;   // grant execute
permissions &= ~WRITE;    // revoke write
```

---

## 8. `instanceof`

Tests whether an object is of a given type. Returns `false` for `null`, never throws.

```java
Object o = "hello";

if (o instanceof String) {
    String s = (String) o;
    System.out.println(s.length());
}
```

Since **Java 16**, pattern matching gives you the cast for free:

```java
if (o instanceof String s) {         // declares `s` only inside the if
    System.out.println(s.length());
}
```

---

## 9. String concatenation with `+`

`+` is overloaded: with two numbers it adds, with a `String` on either side it concatenates.

```java
System.out.println(1 + 2 + "3");   // "33"  — 1+2=3 first, then concat
System.out.println("1" + 2 + 3);   // "123" — left-to-right, everything concatenated
```

This is purely about **left-to-right evaluation with equal precedence**. Nothing magic.

---

## 10. Operator precedence

Highest to lowest. When in doubt, use parentheses — nobody has ever been criticised for clear grouping.

| Level | Operators |
| :-- | :-- |
| 1 | `()` `[]` `.` |
| 2 | `++` `--` (postfix) |
| 3 | `++` `--` (prefix) `+` `-` (unary) `!` `~` `(cast)` `new` |
| 4 | `*` `/` `%` |
| 5 | `+` `-` |
| 6 | `<<` `>>` `>>>` |
| 7 | `<` `<=` `>` `>=` `instanceof` |
| 8 | `==` `!=` |
| 9 | `&` |
| 10 | `^` |
| 11 | `\|` |
| 12 | `&&` |
| 13 | `\|\|` |
| 14 | `? :` |
| 15 | `=` `+=` `-=` … (right-to-left) |

```java
int r = 2 + 3 * 4;      // 14, not 20 — * binds tighter than +
int r2 = (2 + 3) * 4;   // 20
```

---

## 11. Worked example: all of it together

```java
public class OperatorDemo {
    public static void main(String[] args) {
        int a = 17, b = 5;

        System.out.println("a + b  = " + (a + b));    // 22
        System.out.println("a / b  = " + (a / b));    // 3   (integer division)
        System.out.println("a % b  = " + (a % b));    // 2
        System.out.println("a / (double) b = " + (a / (double) b));  // 3.4

        boolean isEven = (a % 2 == 0);
        System.out.println("a is even? " + isEven);   // false

        // Ternary + short-circuit together
        String[] names = null;
        String first = (names != null && names.length > 0) ? names[0] : "none";
        System.out.println(first);                    // none

        // Bit tricks
        System.out.println(a << 1);                   // 34  (a * 2)
        System.out.println(a >> 1);                   // 8   (a / 2)
        System.out.println((a & 1) == 1 ? "odd" : "even");  // odd
    }
}
```

---

## 🧠 Rapid-fire recall

1. What does `7 / 2` evaluate to, and how do you get `3.5`?
2. What is `i` after `int i = 0; i = i++;`?
3. Why is `if (s != null && s.isEmpty())` safe but `if (s != null & s.isEmpty())` not?
4. Why does `byte b = 10; b += 5;` compile but `b = b + 5;` doesn't?
5. What's the difference between `>>` and `>>>`?
6. What does `"1" + 2 + 3` print? What about `1 + 2 + "3"`?
7. When should you use `==` and when `.equals()`?

<details>
<summary>Answers</summary>

1. `3` — both operands are `int`, so the result is truncated. Use `7 / 2.0` or `(double) 7 / 2`.
2. `0`. `i++` yields the old value (0), which the assignment then writes back.
3. `&&` short-circuits: if the left side is false, the right side is never evaluated. `&` always evaluates both, so `s.isEmpty()` runs on `null`.
4. Compound assignment (`+=`) includes an implicit narrowing cast; plain `b + 5` promotes to `int` and assigning an `int` to a `byte` needs an explicit cast.
5. `>>` preserves the sign bit; `>>>` shifts in zeros, so negatives become large positives.
6. `"123"` and `"33"` — evaluation is left-to-right, so `1 + 2` is arithmetic before the string appears.
7. `==` for primitives (and for deliberate reference-identity checks); `.equals()` for comparing the contents of objects.

</details>
