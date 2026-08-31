---
title: Exception Handling
author: Tejas Nirala
---

# Exception Handling

An **exception** is an event that disrupts the normal flow of a program. Java's exception system is one of the things that most distinguishes it from JavaScript or Python: some exceptions are part of a method's **signature**, and the compiler forces you to deal with them.

---

## 1. What actually happens when an exception is thrown

```java
public class Demo {
    public static void main(String[] args) {
        System.out.println("start");
        int result = divide(10, 0);
        System.out.println("never reached");
    }

    static int divide(int a, int b) {
        return a / b;                  // 💥 throws here
    }
}
```

```
start
Exception in thread "main" java.lang.ArithmeticException: / by zero
	at Demo.divide(Demo.java:9)
	at Demo.main(Demo.java:4)
```

When `a / b` fails, the JVM:
1. Creates an `ArithmeticException` object describing the problem.
2. Abandons `divide()` and looks for a handler.
3. Doesn't find one, so abandons `main()` too — **unwinding the stack**.
4. No handler anywhere → prints the stack trace and terminates the thread.

**Read a stack trace bottom-up for the story, top-down for the culprit.** The top line is where it broke; the bottom is where the call chain started.

---

## 2. The exception hierarchy

```
                        Throwable
                       ╱         ╲
                  Error           Exception
                    │            ╱         ╲
       OutOfMemoryError    RuntimeException   (everything else)
       StackOverflowError        │                    │
                                 │            IOException
                    NullPointerException      SQLException
                    IllegalArgumentException  FileNotFoundException
                    ArithmeticException       ClassNotFoundException
                    IndexOutOfBoundsException
                    ClassCastException
                    NumberFormatException

       ◀────── UNCHECKED ──────▶      ◀────── CHECKED ──────▶
```

| Branch | Checked? | Meaning | Should you catch it? |
| :-- | :-- | :-- | :-- |
| `Error` | ❌ | The JVM is in trouble | **No** |
| `RuntimeException` | ❌ | A programming bug | Usually no — **fix the bug** |
| Other `Exception` | ✅ | An expected external failure | **Yes** — handle or declare |

### Checked vs unchecked — the rule

- **Checked** exceptions (`IOException`, `SQLException`) *must* be either caught or declared with `throws`. The compiler enforces it.
- **Unchecked** exceptions (`RuntimeException` and subclasses, plus `Error`) need no declaration.

```java
// Checked — the compiler demands you deal with it
static String read(String path) throws IOException {      // declared
    return Files.readString(Path.of(path));
}

// Unchecked — no declaration needed
static int parse(String s) {
    return Integer.parseInt(s);      // may throw NumberFormatException
}
```

**The design intent:** a checked exception represents something *outside your control that you can reasonably recover from* (the file isn't there, the network is down). An unchecked exception represents *a bug in your code* (you passed null, you indexed past the end). You don't "handle" a bug — you fix it.

> Java is nearly alone in having checked exceptions. C#, JavaScript, Python and Kotlin all decided against them, arguing they lead to `catch (Exception e) { }` boilerplate. It remains a genuinely debated design choice.

---

## 3. `try` / `catch` / `finally`

```java
try {
    int[] arr = new int[3];
    arr[5] = 10;                       // throws
    System.out.println("not reached");
} catch (ArrayIndexOutOfBoundsException e) {
    System.out.println("Caught: " + e.getMessage());
} finally {
    System.out.println("Always runs");
}
```

### Multiple catch blocks — most specific first

```java
try {
    process();
} catch (FileNotFoundException e) {     // subclass — must come first
    System.out.println("File missing");
} catch (IOException e) {               // superclass
    System.out.println("I/O failed");
} catch (Exception e) {                 // catch-all — last
    System.out.println("Something else");
}
```

Putting `IOException` before `FileNotFoundException` is a **compile error** — the second block would be unreachable. Java catches this for you.

### Multi-catch (Java 7+)

```java
try {
    risky();
} catch (IOException | SQLException e) {      // one block, several types
    logger.error("Operation failed", e);
}
```

The variable `e` is implicitly `final` in a multi-catch.

### `finally` always runs

Even after a `return`:

```java
static int demo() {
    try {
        return 1;
    } finally {
        System.out.println("finally runs before the method actually returns");
    }
}
// prints "finally runs..." then returns 1
```

The only things that skip `finally`: `System.exit()`, a JVM crash, or the thread being killed.

**Never `return` from a `finally` block** — it silently discards exceptions:

```java
static int bad() {
    try {
        throw new RuntimeException("lost!");
    } finally {
        return 42;                 // 😱 the exception vanishes; caller sees 42
    }
}
```

---

## 4. try-with-resources — use this, not `finally`

Anything implementing `AutoCloseable` is closed automatically:

```java
// 😖 The old way — verbose and easy to get wrong
BufferedReader br = null;
try {
    br = new BufferedReader(new FileReader("file.txt"));
    System.out.println(br.readLine());
} catch (IOException e) {
    e.printStackTrace();
} finally {
    if (br != null) {
        try { br.close(); } catch (IOException e) { /* ignore */ }
    }
}

// 😊 try-with-resources (Java 7+)
try (BufferedReader br = new BufferedReader(new FileReader("file.txt"))) {
    System.out.println(br.readLine());
} catch (IOException e) {
    e.printStackTrace();
}
```

Multiple resources are closed in **reverse order**:

```java
try (var in  = new FileInputStream("in.txt");
     var out = new FileOutputStream("out.txt")) {
    in.transferTo(out);
}     // out.close() then in.close(), guaranteed, even on exception
```

### Suppressed exceptions

If the body throws *and* `close()` throws, the body's exception wins and the close exception is attached as **suppressed** — nothing is lost:

```java
catch (IOException e) {
    System.out.println("Primary: " + e.getMessage());
    for (Throwable s : e.getSuppressed()) {
        System.out.println("Suppressed: " + s.getMessage());
    }
}
```

The old `finally` pattern silently *replaced* the real exception with the close exception. This was a real source of unexplainable bugs.

### Making your own class closeable

```java
class Connection implements AutoCloseable {
    Connection() { System.out.println("open"); }
    void query() { System.out.println("querying"); }
    @Override public void close() { System.out.println("closed"); }
}

try (var c = new Connection()) {
    c.query();
}
// open / querying / closed
```

---

## 5. `throw` and `throws`

Different keywords, constantly confused:

```java
// `throws` — DECLARES that this method may throw. Part of the signature.
static void readFile(String path) throws IOException {
    // `throw` — ACTUALLY throws an exception object, right now.
    if (path == null) throw new IllegalArgumentException("path is required");
    Files.readString(Path.of(path));
}
```

| | `throw` | `throws` |
| :-- | :-- | :-- |
| Where | Inside a method body | In the method signature |
| What follows | One exception **instance** | One or more exception **types** |
| Effect | Raises the exception now | Documents/delegates the possibility |

---

## 6. Custom exceptions

```java
// Unchecked — for programming errors and business rule violations
public class InsufficientFundsException extends RuntimeException {
    private final double shortfall;

    public InsufficientFundsException(double shortfall) {
        super(String.format("Insufficient funds: short by %.2f", shortfall));
        this.shortfall = shortfall;
    }

    public double getShortfall() { return shortfall; }
}

// Checked — for recoverable, expected conditions the caller must consider
public class ConfigurationException extends Exception {
    public ConfigurationException(String message, Throwable cause) {
        super(message, cause);           // ALWAYS pass the cause through
    }
}
```

Usage:

```java
void withdraw(double amount) {
    if (amount > balance) {
        throw new InsufficientFundsException(amount - balance);
    }
    balance -= amount;
}

try {
    account.withdraw(500);
} catch (InsufficientFundsException e) {
    System.out.println("Need " + e.getShortfall() + " more");   // structured data!
}
```

A custom exception carrying **structured data** (`getShortfall()`) beats parsing a message string.

### Which to extend?

- Extend `RuntimeException` **by default**. Modern Java (and Spring, and most frameworks) heavily favours unchecked exceptions.
- Extend `Exception` only when the caller has a genuine, distinct recovery action and you want the compiler to force them to consider it.

---

## 7. Exception chaining — never lose the cause

```java
try {
    jdbcTemplate.query(sql);
} catch (SQLException e) {
    throw new DataAccessException("Failed to load users", e);   // ← pass `e` as cause
}
```

The stack trace then shows both:

```
DataAccessException: Failed to load users
	at UserRepo.findAll(UserRepo.java:42)
Caused by: java.sql.SQLException: Connection refused
	at ...
```

**Dropping the cause is the most common exception-handling mistake in real codebases.** `throw new RuntimeException("failed")` without the cause turns a five-minute debug into an afternoon.

---

## 8. Anti-patterns (all of these appear in real code)

```java
// ❌ 1. Swallowing — the exception happened and nobody will ever know
try { risky(); } catch (Exception e) { }

// ❌ 2. printStackTrace in production — goes to stderr, unstructured, unsearchable
try { risky(); } catch (Exception e) { e.printStackTrace(); }

// ❌ 3. Catching Throwable — you just caught OutOfMemoryError and pretended it's fine
try { risky(); } catch (Throwable t) { }

// ❌ 4. Losing the cause
try { risky(); } catch (IOException e) { throw new RuntimeException("failed"); }

// ❌ 5. Exceptions as control flow — slow and unreadable
try {
    while (true) list.get(i++);
} catch (IndexOutOfBoundsException e) { /* reached the end */ }

// ❌ 6. Catching what you should have prevented
try { return obj.getName(); } catch (NullPointerException e) { return "unknown"; }
// ✅ instead:  return obj == null ? "unknown" : obj.getName();
```

The correct shape:

```java
// ✅ Log with context, and either recover meaningfully or rethrow with the cause
try {
    return userRepository.findById(id);
} catch (SQLException e) {
    logger.error("Failed to load user id={}", id, e);
    throw new UserLookupException("Could not load user " + id, e);
}
```

---

## 9. Common exceptions and what they actually mean

| Exception | Usually means |
| :-- | :-- |
| `NullPointerException` | You called a method on `null`, or unboxed a null wrapper |
| `ArrayIndexOutOfBoundsException` | Index `< 0` or `>= length` |
| `ClassCastException` | A downcast to a type the object isn't |
| `NumberFormatException` | `Integer.parseInt("abc")` |
| `IllegalArgumentException` | A caller passed you an invalid value — **throw this yourself** |
| `IllegalStateException` | The object isn't in a state where this call makes sense |
| `ConcurrentModificationException` | You modified a collection while iterating it |
| `UnsupportedOperationException` | Mutating an immutable collection (`List.of(...).add(...)`) |
| `StackOverflowError` | Runaway recursion |
| `OutOfMemoryError` | Heap exhausted — often a leak, e.g. an ever-growing static collection |

### Helpful NullPointerException messages (Java 14+)

Modern JVMs tell you exactly which part was null:

```
Cannot invoke "String.length()" because the return value of
"java.util.Map.get(Object)" is null
```

Enormously better than the old bare `NullPointerException`. Enabled by default from Java 15.

---

## 10. Worked example

```java
import java.io.*;
import java.nio.file.*;
import java.util.*;

public class ExceptionDemo {

    static class ValidationException extends RuntimeException {
        private final List<String> errors;
        ValidationException(List<String> errors) {
            super("Validation failed: " + errors.size() + " error(s)");
            this.errors = List.copyOf(errors);
        }
        List<String> getErrors() { return errors; }
    }

    record User(String name, String email, int age) { }

    static User parseUser(String line) {
        var errors = new ArrayList<String>();
        var parts = line.split(",");

        if (parts.length != 3) {
            throw new ValidationException(List.of("Expected 3 fields, got " + parts.length));
        }

        String name = parts[0].trim();
        if (name.isEmpty()) errors.add("name is required");

        String email = parts[1].trim();
        if (!email.contains("@")) errors.add("invalid email: " + email);

        int age = 0;
        try {
            age = Integer.parseInt(parts[2].trim());
            if (age < 0 || age > 150) errors.add("age out of range: " + age);
        } catch (NumberFormatException e) {
            errors.add("age is not a number: " + parts[2].trim());
        }

        if (!errors.isEmpty()) throw new ValidationException(errors);
        return new User(name, email, age);
    }

    public static void main(String[] args) {
        List<String> lines = List.of(
            "Tejas, tejas@example.com, 25",
            "Ankit, not-an-email, abc",
            "too, few"
        );

        for (String line : lines) {
            try {
                System.out.println("✅ " + parseUser(line));
            } catch (ValidationException e) {
                System.out.println("❌ " + e.getMessage());
                e.getErrors().forEach(err -> System.out.println("     - " + err));
            }
        }

        // try-with-resources, with the cause preserved
        try (var reader = Files.newBufferedReader(Path.of("missing.txt"))) {
            System.out.println(reader.readLine());
        } catch (NoSuchFileException e) {
            System.out.println("File not found: " + e.getFile());
        } catch (IOException e) {
            throw new UncheckedIOException("Unexpected I/O failure", e);   // cause kept
        }
    }
}
```

Output:
```
✅ User[name=Tejas, email=tejas@example.com, age=25]
❌ Validation failed: 2 error(s)
     - invalid email: not-an-email
     - age is not a number: abc
❌ Validation failed: 1 error(s)
     - Expected 3 fields, got 2
File not found: missing.txt
```

---

## 🧠 Rapid-fire recall

1. What's the difference between a checked and an unchecked exception, in terms of what the compiler does?
2. When does a `finally` block *not* run?
3. Why must a subclass exception be caught before its superclass?
4. What does try-with-resources give you that a `finally` block doesn't?
5. What is the difference between `throw` and `throws`?
6. Why is `throw new RuntimeException("failed")` inside a catch block a bug?
7. Name three exception-handling anti-patterns.

<details>
<summary>Answers</summary>

1. Checked exceptions must be caught or declared in the `throws` clause and the compiler enforces it; unchecked ones (`RuntimeException`, `Error`) need no declaration.
2. Only on `System.exit()`, a JVM crash, or thread termination.
3. Otherwise the subclass block is unreachable — and Java makes that a compile error.
4. Automatic, guaranteed closing in reverse order, plus suppressed-exception support so a failure in `close()` doesn't replace the real exception.
5. `throw` raises an exception instance inside a method body; `throws` declares in the signature which exception types the method may propagate.
6. It discards the original exception (the cause), destroying the stack trace that explains what actually went wrong.
7. Swallowing (`catch { }`), `printStackTrace()` in production, catching `Throwable`, losing the cause, using exceptions for control flow, catching an NPE instead of null-checking.

</details>
