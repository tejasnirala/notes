---
title: The Object Class — equals, hashCode & toString
author: Tejas Nirala
---

# The `Object` Class

Every class in Java implicitly extends `java.lang.Object`. Even this:

```java
class Dog { }
// is really:  class Dog extends Object { }
```

Which means every object you ever create already has these methods. Three of them you will override constantly, and getting them wrong causes bugs that are very hard to find.

| Method | Purpose |
| :-- | :-- |
| `toString()` | Human-readable representation |
| `equals(Object)` | Logical equality |
| `hashCode()` | Integer hash, used by hash-based collections |
| `getClass()` | The runtime class (final — cannot override) |
| `clone()` | Shallow copy (protected; largely superseded) |
| `finalize()` | Pre-GC hook — **deprecated and removed**; never use |
| `wait()` / `notify()` / `notifyAll()` | Thread coordination (see [Threads](./35-threads.md)) |

---

## 1. `toString()`

The default is useless:

```java
class Dog {
    String name = "Rex";
}

System.out.println(new Dog());   // Dog@1b6d3586
//                                  ↑     ↑
//                            class name  identity hash in hex
```

Override it:

```java
class Dog {
    private final String name;
    private final int age;

    Dog(String name, int age) { this.name = name; this.age = age; }

    @Override
    public String toString() {
        return "Dog{name='" + name + "', age=" + age + "}";
    }
}

System.out.println(new Dog("Rex", 3));   // Dog{name='Rex', age=3}
```

`toString()` is called automatically by `System.out.println(obj)`, by string concatenation (`"" + obj`), and by debuggers and logging frameworks. Overriding it costs three lines and saves you hours of debugging.

> A `null` reference prints as `"null"` rather than throwing — `String.valueOf` handles it.

---

## 2. `equals()` — logical equality

The default `equals()` is **reference equality**, identical to `==`:

```java
class Point {
    int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }
}

Point a = new Point(1, 2);
Point b = new Point(1, 2);

System.out.println(a == b);       // false
System.out.println(a.equals(b));  // false  ← almost certainly not what you want
```

Two points at (1,2) *are* the same point, conceptually. So override:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;                    // 1. same object? fast path
    if (o == null || getClass() != o.getClass()) return false;   // 2. type check
    Point p = (Point) o;                           // 3. safe downcast
    return x == p.x && y == p.y;                   // 4. compare the fields that matter
}
```

### The `equals` contract

Your implementation must be:

| Property | Meaning |
| :-- | :-- |
| **Reflexive** | `x.equals(x)` is `true` |
| **Symmetric** | `x.equals(y)` ⟺ `y.equals(x)` |
| **Transitive** | `x.equals(y)` and `y.equals(z)` ⟹ `x.equals(z)` |
| **Consistent** | Repeated calls give the same answer if nothing changed |
| **Null-safe** | `x.equals(null)` is `false`, never an exception |

Violating these breaks collections in ways that look like the JDK is broken.

### `getClass()` vs `instanceof` in equals

```java
if (getClass() != o.getClass()) return false;   // strict — subclass is never equal
if (!(o instanceof Point)) return false;        // lenient — but can break SYMMETRY
```

The `instanceof` version is asymmetric if a subclass adds fields: `point.equals(colorPoint)` can be `true` while `colorPoint.equals(point)` is `false`. **Use `getClass()` unless you have a specific reason not to.**

### The classic bug: wrong signature

```java
public boolean equals(Point p) { ... }      // ❌ this is an OVERLOAD, not an override
```

The parameter must be `Object`. With `Point`, collections (which call `equals(Object)`) will silently use the inherited reference-equality version. **This is exactly what `@Override` catches.**

---

## 3. `hashCode()` — and why it must match `equals`

`hashCode()` returns an `int` used by `HashMap`, `HashSet` and `Hashtable` to decide which bucket an object goes in.

### The contract (this is the important part)

1. **If `a.equals(b)` is true, then `a.hashCode() == b.hashCode()` must be true.**
2. If `a.hashCode() == b.hashCode()`, `a.equals(b)` *may* be false (that's a collision — normal and fine).
3. The hash code must not change while the object is in a hash-based collection.

### What breaks if you ignore rule 1

```java
class Point {
    int x, y;
    // equals() overridden... but hashCode() is NOT
}

Set<Point> set = new HashSet<>();
set.add(new Point(1, 2));
System.out.println(set.contains(new Point(1, 2)));   // false  😱
System.out.println(set.size());                       // 1
set.add(new Point(1, 2));
System.out.println(set.size());                       // 2  — duplicates in a Set!
```

**Why?** `HashSet` first computes the hash to find a bucket. Two "equal" points with different hash codes land in **different buckets**, so `contains` never even reaches the `equals` comparison. The object is in the set and simultaneously unfindable.

The same bug with a `HashMap`:

```java
Map<Point, String> map = new HashMap<>();
map.put(new Point(1, 2), "origin-ish");
System.out.println(map.get(new Point(1, 2)));   // null  😱
```

> **Rule: always override `equals` and `hashCode` together. Always.**

### Writing `hashCode()`

The easy, correct way:

```java
@Override
public int hashCode() {
    return Objects.hash(x, y);      // java.util.Objects
}
```

The classic manual way (what `Objects.hash` does under the hood):

```java
@Override
public int hashCode() {
    int result = 17;
    result = 31 * result + x;
    result = 31 * result + y;
    return result;
}
```

31 is used because it's an odd prime and `31 * i` optimises to `(i << 5) - i`. Any odd prime works; consistency matters more than the specific number.

> `Objects.hash(...)` allocates a varargs array. For a hot path with primitives, the manual form is marginally faster. For 99% of code, use `Objects.hash`.

### The complete, correct pair

```java
import java.util.Objects;

public final class Point {
    private final int x;
    private final int y;

    public Point(int x, int y) { this.x = x; this.y = y; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Point point = (Point) o;
        return x == point.x && y == point.y;
    }

    @Override
    public int hashCode() {
        return Objects.hash(x, y);
    }

    @Override
    public String toString() {
        return "Point(" + x + ", " + y + ")";
    }
}
```

**Or skip all of it** — a [`record`](./19-records.md) generates exactly this:

```java
public record Point(int x, int y) { }
```

That one line gives you the fields, constructor, accessors, `equals`, `hashCode` and `toString`, all correct. Use records for value types.

### Which fields to include

Only the fields that define **logical identity**. A cached value, a lazily-computed field, or a `lastAccessed` timestamp should be excluded — otherwise your object's identity changes as it's used.

For an entity with a database ID, use the ID alone:

```java
@Override public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof User u)) return false;
    return id != null && id.equals(u.id);
}
@Override public int hashCode() { return getClass().hashCode(); }
```

---

## 4. `getClass()`

Returns the **runtime** class, regardless of the reference type:

```java
Animal a = new Dog();
System.out.println(a.getClass());               // class Dog
System.out.println(a.getClass().getSimpleName()); // Dog
System.out.println(a.getClass().getName());     // com.tejas.Dog
```

It's `final` — you cannot override it, which is what makes it trustworthy inside `equals`.

---

## 5. `clone()` — and why to avoid it

```java
class Point implements Cloneable {          // marker interface required
    int x, y;

    @Override
    public Point clone() {
        try {
            return (Point) super.clone();   // shallow copy
        } catch (CloneNotSupportedException e) {
            throw new AssertionError(e);
        }
    }
}
```

Problems: it's a **shallow** copy (nested objects are shared), it needs a marker interface, it throws a checked exception, and it bypasses constructors so `final` fields and validation are skipped.

**Prefer a copy constructor or a static factory:**

```java
class Point {
    final int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }
    Point(Point other) { this(other.x, other.y); }        // copy constructor ✅
    static Point copyOf(Point other) { return new Point(other); }
}
```

Better still: make the class immutable, and you never need to copy it at all.

---

## 6. `Objects` — the null-safe helper class

`java.util.Objects` wraps these operations safely:

```java
import java.util.Objects;

Objects.equals(a, b);            // handles nulls: equals(null, null) is true
Objects.hash(x, y, z);           // hash of several fields
Objects.toString(obj, "N/A");    // toString with a default for null
Objects.requireNonNull(arg, "arg must not be null");   // fail fast in constructors
Objects.isNull(x);
Objects.requireNonNullElse(x, defaultValue);           // Java 9+
```

`requireNonNull` in a constructor is a very good habit — it fails at the point of the mistake instead of three layers away:

```java
public User(String name, String email) {
    this.name  = Objects.requireNonNull(name,  "name is required");
    this.email = Objects.requireNonNull(email, "email is required");
}
```

---

## 7. Worked example: what goes wrong, and the fix

```java
import java.util.*;

class BadEmployee {
    String id, name;
    BadEmployee(String id, String name) { this.id = id; this.name = name; }

    @Override public boolean equals(Object o) {
        if (!(o instanceof BadEmployee e)) return false;
        return id.equals(e.id);
    }
    // hashCode NOT overridden — the bug
}

record GoodEmployee(String id, String name) { }    // equals + hashCode generated

public class Demo {
    public static void main(String[] args) {
        Set<BadEmployee> bad = new HashSet<>();
        bad.add(new BadEmployee("E1", "Tejas"));
        System.out.println(bad.contains(new BadEmployee("E1", "Tejas"))); // false 😱
        bad.add(new BadEmployee("E1", "Tejas"));
        System.out.println(bad.size());                                    // 2 😱

        Set<GoodEmployee> good = new HashSet<>();
        good.add(new GoodEmployee("E1", "Tejas"));
        System.out.println(good.contains(new GoodEmployee("E1", "Tejas"))); // true ✅
        good.add(new GoodEmployee("E1", "Tejas"));
        System.out.println(good.size());                                     // 1 ✅
    }
}
```

---

## 🧠 Rapid-fire recall

1. What does the default `toString()` print, and what are the two parts?
2. What does the default `equals()` compare?
3. State the `equals` contract in five words.
4. What exactly goes wrong if you override `equals` but not `hashCode`?
5. Why must `equals` take an `Object` parameter, and what catches the mistake?
6. Why prefer `getClass() != o.getClass()` over `instanceof` in `equals`?
7. Name two reasons to prefer a copy constructor over `clone()`.

<details>
<summary>Answers</summary>

1. `ClassName@hexHashCode` — the fully-qualified class name and the identity hash code in hexadecimal.
2. Reference identity — exactly the same as `==`.
3. Reflexive, symmetric, transitive, consistent, null-safe.
4. Equal objects can get different hash codes, so they land in different buckets: `HashSet.contains` returns false for an object that's in the set, and duplicates can be added.
5. Because collections call `equals(Object)`; a `equals(Point)` version is an overload the collections never see. `@Override` turns it into a compile error.
6. `instanceof` can break symmetry when a subclass adds fields — `a.equals(b)` and `b.equals(a)` can disagree.
7. `clone()` is a shallow copy that bypasses constructors (skipping validation and `final` field assignment), and it requires the `Cloneable` marker plus catching a checked exception.

</details>
