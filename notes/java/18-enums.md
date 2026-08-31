---
title: Enums
author: Tejas Nirala
---

# Enums

An `enum` is a type whose value can only be one of a fixed set of named constants. If you've been representing "status" as an `int` or a `String`, this is the fix.

---

## 1. The problem enums solve

```java
// 😖 Using int constants
public static final int STATUS_ACTIVE  = 0;
public static final int STATUS_PAUSED  = 1;
public static final int STATUS_CLOSED  = 2;

void setStatus(int status) { ... }

setStatus(0);        // what is 0? you have to go look
setStatus(99);       // compiles fine. Meaningless. Crashes later.
setStatus(userAge);  // also compiles. It's just an int.
```

```java
// 😖 Using String constants
setStatus("actve");  // typo compiles fine, fails at runtime
```

```java
// 😊 Using an enum
enum Status { ACTIVE, PAUSED, CLOSED }

void setStatus(Status status) { ... }

setStatus(Status.ACTIVE);   // clear
setStatus(Status.ACTVE);    // ❌ compile error — typo caught immediately
setStatus(99);              // ❌ compile error — type-safe
```

**Type safety, readability, and a closed set the compiler can reason about.** That's the whole pitch.

---

## 2. Basics

```java
public enum Day {
    MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY
}

Day today = Day.WEDNESDAY;
System.out.println(today);              // WEDNESDAY
System.out.println(today.name());       // "WEDNESDAY"
System.out.println(today.ordinal());    // 2  (zero-based position)
```

### Built-in methods every enum gets

| Method | Returns |
| :-- | :-- |
| `values()` | An array of all constants, in declaration order |
| `valueOf("NAME")` | The constant with that exact name (throws `IllegalArgumentException` otherwise) |
| `name()` | The constant's declared name |
| `ordinal()` | Its zero-based position |
| `compareTo()` | Compares by ordinal |

```java
for (Day d : Day.values()) {
    System.out.println(d.ordinal() + ": " + d);
}

Day d = Day.valueOf("FRIDAY");     // ✅
Day x = Day.valueOf("Friday");     // 💥 IllegalArgumentException — case-sensitive
```

> ⚠️ **Never persist `ordinal()`.** Reordering the constants silently changes every stored value. Persist `name()`, or an explicit code field.

---

## 3. Enums in `switch`

This is where enums shine:

```java
String type = switch (today) {
    case SATURDAY, SUNDAY -> "Weekend";
    case MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY -> "Weekday";
};
```

Note: **no `default` needed**, and no `Day.` prefix inside the cases. And because the switch is exhaustive, if someone adds `Day.HOLIDAY` tomorrow, this code **stops compiling** until you handle it. That compile error is a feature — it's the compiler doing your code review.

---

## 4. Enums with fields, constructors and methods

An enum is a real class. It can carry data.

```java
public enum Planet {
    MERCURY(3.303e+23, 2.4397e6),
    VENUS  (4.869e+24, 6.0518e6),
    EARTH  (5.976e+24, 6.37814e6),
    MARS   (6.421e+23, 3.3972e6);          // ← semicolon required before members

    private final double mass;              // in kilograms
    private final double radius;            // in metres

    Planet(double mass, double radius) {    // constructor is implicitly private
        this.mass = mass;
        this.radius = radius;
    }

    public double surfaceGravity() {
        final double G = 6.67300E-11;
        return G * mass / (radius * radius);
    }

    public double surfaceWeight(double otherMass) {
        return otherMass * surfaceGravity();
    }
}
```

```java
double earthWeight = 75;
double mass = earthWeight / Planet.EARTH.surfaceGravity();

for (Planet p : Planet.values()) {
    System.out.printf("Weight on %s is %.2f kg%n", p, p.surfaceWeight(mass));
}
// Weight on MERCURY is 28.35 kg
// Weight on VENUS is 67.86 kg
// Weight on EARTH is 75.00 kg
// Weight on MARS is 28.43 kg
```

A more everyday example:

```java
public enum Status {
    ACTIVE("A", "Currently active"),
    PAUSED("P", "Temporarily on hold"),
    CLOSED("C", "Permanently closed");

    private final String code;
    private final String description;

    Status(String code, String description) {
        this.code = code;
        this.description = description;
    }

    public String getCode()        { return code; }
    public String getDescription() { return description; }

    // A lookup by the persisted code — safer than ordinal()
    public static Status fromCode(String code) {
        for (Status s : values()) {
            if (s.code.equals(code)) return s;
        }
        throw new IllegalArgumentException("Unknown status code: " + code);
    }
}
```

---

## 5. Constant-specific behaviour

Each constant can override a method — effectively a tiny anonymous subclass per constant.

```java
public enum Operation {
    PLUS("+")  { public double apply(double x, double y) { return x + y; } },
    MINUS("-") { public double apply(double x, double y) { return x - y; } },
    TIMES("*") { public double apply(double x, double y) { return x * y; } },
    DIVIDE("/"){ public double apply(double x, double y) { return x / y; } };

    private final String symbol;
    Operation(String symbol) { this.symbol = symbol; }

    public abstract double apply(double x, double y);   // each constant must implement

    @Override public String toString() { return symbol; }
}
```

```java
double x = 6, y = 3;
for (Operation op : Operation.values()) {
    System.out.printf("%.1f %s %.1f = %.1f%n", x, op, y, op.apply(x, y));
}
// 6.0 + 3.0 = 9.0
// 6.0 - 3.0 = 3.0
// 6.0 * 3.0 = 18.0
// 6.0 / 3.0 = 2.0
```

This is polymorphism with a *guaranteed closed* set of implementations — a state machine, a strategy table, or a calculator, with the compiler enforcing completeness.

### A state machine

```java
public enum OrderState {
    NEW {
        public OrderState next() { return PAID; }
    },
    PAID {
        public OrderState next() { return SHIPPED; }
    },
    SHIPPED {
        public OrderState next() { return DELIVERED; }
    },
    DELIVERED {
        public OrderState next() { throw new IllegalStateException("Terminal state"); }
    };

    public abstract OrderState next();
}
```

---

## 6. Enums can implement interfaces

```java
interface Describable {
    String describe();
}

enum Level implements Describable {
    LOW, MEDIUM, HIGH;

    @Override
    public String describe() {
        return "Priority level: " + name().toLowerCase();
    }
}
```

Enums cannot **extend** a class — they already implicitly extend `java.lang.Enum`.

---

## 7. Enums are singletons — the safest one in Java

Each constant is created exactly once, when the enum class loads. The JVM guarantees this, including across serialization and reflection.

```java
public enum Config {
    INSTANCE;

    private final Map<String, String> settings = new HashMap<>();

    public void set(String k, String v) { settings.put(k, v); }
    public String get(String k)         { return settings.get(k); }
}

Config.INSTANCE.set("env", "prod");
System.out.println(Config.INSTANCE.get("env"));
```

Joshua Bloch (author of *Effective Java*) calls this **the best way to implement a singleton** — it's thread-safe by construction and cannot be broken by reflection or deserialization, unlike the hand-rolled double-checked-locking version.

### Comparing enums

Because each constant is a single object, `==` is safe *and preferred*:

```java
if (status == Status.ACTIVE) { }      // ✅ idiomatic, null-safe, fast
if (status.equals(Status.ACTIVE)) { } // works, but NPEs if status is null
```

---

## 8. `EnumMap` and `EnumSet` — use these, not `HashMap`/`HashSet`

Specialised, dramatically faster implementations backed by an array (`EnumMap`) or a bit vector (`EnumSet`).

```java
import java.util.*;

EnumMap<Day, String> schedule = new EnumMap<>(Day.class);
schedule.put(Day.MONDAY, "Gym");
schedule.put(Day.FRIDAY, "Review");
System.out.println(schedule);   // {MONDAY=Gym, FRIDAY=Review}  — always in enum order

EnumSet<Day> weekend = EnumSet.of(Day.SATURDAY, Day.SUNDAY);
EnumSet<Day> weekdays = EnumSet.complementOf(weekend);
EnumSet<Day> all = EnumSet.allOf(Day.class);
EnumSet<Day> midweek = EnumSet.range(Day.TUESDAY, Day.THURSDAY);

System.out.println(weekdays);   // [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY]
```

`EnumSet` with ≤64 constants fits in a single `long` — membership tests are one bitwise AND. Nothing else comes close.

---

## 9. Enums vs the alternatives

| | `int` constants | `String` constants | `enum` |
| :-- | :-- | :-- | :-- |
| Type-safe | ❌ | ❌ | ✅ |
| Typo caught at compile time | ❌ | ❌ | ✅ |
| Readable in a debugger | ❌ (`2`) | ✅ | ✅ |
| Can carry data / behaviour | ❌ | ❌ | ✅ |
| Exhaustive `switch` checking | ❌ | ❌ | ✅ |
| Usable in `EnumMap`/`EnumSet` | ❌ | ❌ | ✅ |

---

## 10. Worked example

```java
public enum HttpStatus {
    OK(200, "OK"),
    CREATED(201, "Created"),
    BAD_REQUEST(400, "Bad Request"),
    UNAUTHORIZED(401, "Unauthorized"),
    NOT_FOUND(404, "Not Found"),
    SERVER_ERROR(500, "Internal Server Error");

    private final int code;
    private final String reason;

    HttpStatus(int code, String reason) {
        this.code = code;
        this.reason = reason;
    }

    public int getCode()      { return code; }
    public String getReason() { return reason; }

    public boolean isSuccess()     { return code >= 200 && code < 300; }
    public boolean isClientError() { return code >= 400 && code < 500; }
    public boolean isServerError() { return code >= 500; }

    public static HttpStatus fromCode(int code) {
        for (HttpStatus s : values()) {
            if (s.code == code) return s;
        }
        throw new IllegalArgumentException("Unknown status code: " + code);
    }

    @Override
    public String toString() { return code + " " + reason; }
}

public class Demo {
    public static void main(String[] args) {
        HttpStatus s = HttpStatus.fromCode(404);
        System.out.println(s);                  // 404 Not Found
        System.out.println(s.isClientError());  // true

        String advice = switch (s) {
            case OK, CREATED           -> "All good";
            case BAD_REQUEST           -> "Check your payload";
            case UNAUTHORIZED          -> "Log in first";
            case NOT_FOUND             -> "Check the URL";
            case SERVER_ERROR          -> "Not your fault; retry";
        };
        System.out.println(advice);             // Check the URL
    }
}
```

---

## 🧠 Rapid-fire recall

1. Give three concrete advantages of an enum over `public static final int` constants.
2. Why should you never persist `ordinal()`?
3. Why does an exhaustive `switch` over an enum need no `default`, and what happens when a constant is added?
4. Where does the semicolon go in an enum with fields, and why is it needed?
5. Why is an enum considered the best singleton implementation in Java?
6. When should you use `EnumMap` instead of `HashMap`?
7. Should you compare enums with `==` or `.equals()`?

<details>
<summary>Answers</summary>

1. Type safety (you can't pass an arbitrary int), typos become compile errors, and they can carry fields, behaviour and exhaustive switch checking.
2. Reordering or inserting constants changes every constant's ordinal, silently corrupting stored data. Persist `name()` or an explicit code.
3. The compiler knows the full set of constants. Adding a new one makes the switch non-exhaustive, so it fails to compile until you handle it.
4. After the last constant, before any fields/methods. It separates the constant list from the class body.
5. Constants are instantiated exactly once by the JVM at class load, and the guarantee survives serialization and reflection attacks.
6. Whenever the keys are enum constants — it's array-backed, faster, and iterates in declaration order.
7. `==` — each constant is a unique singleton, so it's correct, faster, and null-safe.

</details>
