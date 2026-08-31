---
title: Variables, Data Types & Literals
author: Tejas Nirala
---

# Variables, Data Types & Literals

Java is **statically typed**: every variable has a type, that type is fixed when you declare it, and the compiler checks every use of it. Coming from JavaScript or Python, this is the biggest day-one adjustment.

```javascript
// JavaScript — a variable can hold anything, and change its mind
let x = 5;
x = "now I'm a string";   // fine
```

```java
// Java — a variable's type is a promise you make to the compiler
int x = 5;
x = "now I'm a string";   // ❌ compile error: incompatible types
```

---

## 1. Declaring a variable

```java
int age = 25;
//  │    │    │
//  │    │    └── value (the literal)
//  │    └─────── name (the identifier)
//  └──────────── type
```

You can declare without assigning, but you must assign before you *read*:

```java
int count;
System.out.println(count);  // ❌ error: variable count might not have been initialized
count = 0;
System.out.println(count);  // ✅ 0
```

> This "definite assignment" check is another thing the compiler does for you that dynamic languages simply don't.

---

## 2. Data Types

Java has exactly **two families** of types.

- **Primitive** — 8 built-in types. Hold a raw value directly. Not objects, no methods.
- **Non-primitive (reference)** — everything else: `String`, arrays, classes you write, collections. The variable holds a *reference* to an object on the heap.

### 2.1 The eight primitives

- Primitive
    - Integer
        - `byte` → 1 Byte  ⇒  -2^7 to 2^7 - 1 = -128 to 127
        - `short` → 2 Bytes ⇒ -32,768 to 32,767
        - `int` → 4 Bytes ⇒ -2,147,483,648 to 2,147,483,647
        - `long` → 8 Bytes   `long num = 7234l;`
    - Float
        - `float` → 4 Bytes  `float num = 5.6f;`
        - `double` → 8 Bytes (default)  `double num = 5.6;`
    - Character
        - `char` → 2 Bytes  (char uses UNICODE, not ASCII)
    - Boolean
        - `boolean` → `true` | `false`
            - In other languages, true can be represented by 1 and false by 0. But in Java, there is no concept of 1 or 0, it's only `true` or `false`.
- Non Primitive

### 2.2 The same thing as a table

| Type | Size | Default | Range | Example |
| :-- | :-- | :-- | :-- | :-- |
| `byte` | 1 byte | `0` | −128 to 127 | `byte b = 100;` |
| `short` | 2 bytes | `0` | −32,768 to 32,767 | `short s = 5000;` |
| `int` | 4 bytes | `0` | ≈ ±2.1 billion | `int i = 100000;` |
| `long` | 8 bytes | `0L` | ≈ ±9.2 quintillion | `long l = 15000000000L;` |
| `float` | 4 bytes | `0.0f` | ~7 decimal digits | `float f = 5.6f;` |
| `double` | 8 bytes | `0.0d` | ~15 decimal digits | `double d = 5.6;` |
| `char` | 2 bytes | `'\u0000'` | 0 to 65,535 (Unicode) | `char c = 'A';` |
| `boolean` | JVM-dependent | `false` | `true` / `false` | `boolean ok = true;` |

**Things to actually remember:**

- **`int` is the default** for whole numbers. `long` needs an `L` suffix: `long big = 15000000000L;` — without it, the compiler reads the literal as an `int` and complains it's too big.
- **`double` is the default** for decimals. `float` needs an `f` suffix: `float f = 5.6f;` — without it, you're assigning a `double` to a `float` and that's a narrowing conversion.
- **`char` is 2 bytes because it's Unicode (UTF-16)**, not 1-byte ASCII. Non-Latin characters work fine: `char c = 'क';`
- **`boolean` is not a number.** `if (1)` is a compile error in Java. This is deliberate — it kills the classic C bug `if (x = 1)`.

### 2.3 Defaults only apply to fields

```java
class Demo {
    int fieldCount;          // ✅ automatically 0 — fields get defaults

    void method() {
        int localCount;      // ❌ NO default — you must assign before use
    }
}
```

---

## 3. Floating point: the trap everyone hits

```java
System.out.println(0.1 + 0.2);          // 0.30000000000000004  😬
System.out.println(0.1 + 0.2 == 0.3);   // false
```

This is not a Java bug — it's how binary floating point works everywhere (JavaScript does exactly the same). `0.1` cannot be represented exactly in base 2, the same way `1/3` cannot be written exactly in base 10.

**Never use `float`/`double` for money.** Use `BigDecimal`:

```java
import java.math.BigDecimal;

BigDecimal a = new BigDecimal("0.1");   // note: String constructor, not double!
BigDecimal b = new BigDecimal("0.2");
System.out.println(a.add(b));           // 0.3  ✅
```

---

## 4. Wrapper classes & autoboxing

Every primitive has an object counterpart, because collections and generics can only hold objects.

| Primitive | Wrapper |
| :-- | :-- |
| `byte` | `Byte` |
| `short` | `Short` |
| `int` | **`Integer`** |
| `long` | `Long` |
| `float` | `Float` |
| `double` | `Double` |
| `char` | **`Character`** |
| `boolean` | `Boolean` |

```java
int primitive = 5;
Integer boxed = primitive;      // autoboxing:   int → Integer
int back = boxed;               // unboxing:     Integer → int

List<Integer> nums = new ArrayList<>();
nums.add(5);                    // autoboxed for you
```

### Two gotchas worth knowing now

**(a) Wrappers can be `null` — primitives cannot.**

```java
Integer count = null;
int c = count;      // 💥 NullPointerException at runtime (unboxing null)
```

**(b) `==` on wrappers compares references.**

```java
Integer a = 127, b = 127;
System.out.println(a == b);       // true  — small values are cached (−128..127)

Integer x = 128, y = 128;
System.out.println(x == y);       // false — outside the cache, two distinct objects!
System.out.println(x.equals(y));  // true  ✅ always compare wrappers with .equals()
```

> **Rule:** use `==` for primitives, `.equals()` for objects. Always.

---

## 5. Literals

In Java, **literals** are fixed values that are directly represented in the code. They are used to assign values to variables or as constant expressions. Java supports several types of literals, each corresponding to a specific data type.

---

### Types of Literals in Java

### 1. Integer Literals

- Represent whole numbers.
- Can be in:
    - **Decimal** (base 10): `int a = 25;`
    - **Octal** (base 8): `int b = 031;` (starts with `0`)
    - **Hexadecimal** (base 16): `int c = 0x1F;` (starts with `0x`)
    - **Binary** (base 2): `int d = 0b1010;` (starts with `0b`)

> ⚠️ The octal form is a classic trap: `int b = 031;` is **25**, not 31, because a leading zero means base 8.

### 2. Floating-point Literals

- Represent real numbers (with decimal).
- Examples:

    ```java
    float pi = 3.14f;
    double g = 9.81;
    ```

- `f` or `F` is used to denote `float`, otherwise it's `double` by default.
- Scientific notation also works: `double d = 1.5e3;` → `1500.0`

### 3. Character Literals

- Represent a single character enclosed in single quotes:

    ```java
    char letter = 'A';
    char digit = '9';
    char special = '#';
    ```

- Escape sequences: `'\n'` newline, `'\t'` tab, `'\r'` carriage return, `'\\'` backslash, `'\''` single quote.
- Unicode escapes use a backslash-`u` followed by four hex digits — for example the escape for `'A'` is written `\u0041`, and `'\u00E9'` is `'é'`.

### 4. String Literals

- Sequence of characters enclosed in double quotes:

    ```java
    String name = "Tejas";
    ```

### 5. Boolean Literals

- Only two values:

    ```java
    boolean isActive = true;
    boolean isDone = false;
    ```

### 6. Null Literal

- Represents no value (used with objects):

    ```java
    String data = null;
    ```

- `null` can only be assigned to reference types. `int x = null;` is a compile error.

---

### ✅ Example

```java
public class LiteralExample {
    public static void main(String[] args) {
        int age = 30;              // Integer literal
        double temp = 36.6;        // Floating-point literal
        char grade = 'A';          // Character literal
        String name = "Tejas";     // String literal
        boolean passed = true;     // Boolean literal
    }
}
```

### Bonus: underscores in numeric literals (Java 7+)

Purely for readability — the compiler ignores them:

```java
int million    = 1_000_000;
long cardNo    = 1234_5678_9012_3456L;
int binaryMask = 0b1010_0101;
```

---

## 6. Type Conversion and Casting

When the transformation of one type of a variable to another type of variable is implicit, it's called **Type Conversion**.

But when we do this transformation explicitly, it's called **Type Casting**.

---

```java
byte b = 127;
int a = 12;

b = a;  // ❌ because `b` has limit till 127 but a has limit 2147483647.
        //    It's like putting a big box into a small box.

// This is called TYPE CONVERSION.
a = b;  // ✅ this will work. And internally, java has transformed the type to int.

// This is called TYPE CASTING.
b = (byte)a; // ✅ this will work. Because we explicitly converted the type from int to byte.
```

### 6.1 The widening ladder

Java converts *implicitly* only when no information can be lost — moving **up** this ladder:

```
byte → short → int → long → float → double
         ↑
       char
```

```java
int i = 100;
long l = i;        // ✅ implicit widening
double d = l;      // ✅ implicit widening
```

Going **down** the ladder always needs an explicit cast, because data may be lost:

```java
double d = 9.99;
int i = (int) d;      // 9   — the fractional part is TRUNCATED, not rounded
```

### 6.2 What actually happens when you overflow

```java
int a = 130;
byte b = (byte) a;
System.out.println(b);   // -126, not 130!
```

Why? `byte` keeps only the low 8 bits. `130` in binary is `1000_0010`. Interpreted as a signed byte (two's complement), that's `-126`. The cast is you telling the compiler *"I know, do it anyway."*

### 6.3 Integer division bites

```java
System.out.println(5 / 2);          // 2    — int / int = int, truncated
System.out.println(5 / 2.0);        // 2.5  — one operand is double, so double division
System.out.println((double) 5 / 2); // 2.5
```

### 6.4 Converting between String and numbers

```java
// String → number
int n     = Integer.parseInt("42");
double d  = Double.parseDouble("3.14");

// number → String
String s1 = String.valueOf(42);
String s2 = 42 + "";              // works, but ugly
String s3 = Integer.toString(42);
```

An unparseable string throws:

```java
Integer.parseInt("abc");   // 💥 NumberFormatException
```

---

## 7. Constants with `final`

```java
final double PI = 3.14159;
PI = 3.0;   // ❌ compile error — cannot reassign a final variable
```

Convention: constants are `UPPER_SNAKE_CASE`. Class-level constants are usually `static final`:

```java
public static final int MAX_RETRIES = 3;
```

(There's a whole page on [`final`](./14-final-keyword.md) later.)

---

## 8. Naming rules & conventions

**Rules (enforced by the compiler):**
- Start with a letter, `$`, or `_` — not a digit.
- No spaces, no reserved keywords (`class`, `int`, `new`…).
- Case-sensitive: `age` and `Age` are different variables.

**Conventions (enforced by your teammates):**

| Thing | Convention | Example |
| :-- | :-- | :-- |
| variable, method | `camelCase` | `firstName`, `calculateTotal()` |
| class, interface | `PascalCase` | `BankAccount`, `Comparable` |
| constant | `UPPER_SNAKE_CASE` | `MAX_SIZE` |
| package | `all.lowercase` | `com.tejas.notes` |

---

## 🧠 Rapid-fire recall

1. Why does `long x = 15000000000;` fail to compile, and how do you fix it?
2. What does `0.1 + 0.2 == 0.3` print, and what should you use for money?
3. What's the difference between `int` and `Integer`? Name one thing `Integer` can do that `int` can't.
4. Why does `Integer a = 128, b = 128; a == b` print `false` while `127` prints `true`?
5. What is `(int) 9.99`?
6. What does `int b = 031;` actually hold?
7. Which conversions need an explicit cast, and why?

<details>
<summary>Answers</summary>

1. The literal is treated as an `int` and overflows. Add the suffix: `15000000000L`.
2. `false` (it's `0.30000000000000004`). Use `BigDecimal` constructed from a `String`.
3. `int` is a primitive holding a raw value; `Integer` is an object wrapper on the heap. `Integer` can be `null` and can be stored in collections/generics.
4. The JVM caches boxed `Integer` objects in the range −128..127, so both refer to the same object; 128 creates two distinct objects, and `==` compares references.
5. `9` — casting a double to int truncates, it does not round.
6. `25` — a leading `0` makes it an octal literal.
7. Narrowing conversions (down the `byte→short→int→long→float→double` ladder), because information may be lost.

</details>
