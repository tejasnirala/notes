---
title: Packages & Access Modifiers
author: Tejas Nirala
---

# Packages & Access Modifiers

Packages organise code into namespaces. Access modifiers control who can see what. Together they're how Java draws the boundary between "public API" and "my business."

---

## 1. Packages

A package is a namespace — physically, a folder.

```java
// File: src/com/tejas/notes/model/User.java
package com.tejas.notes.model;

public class User { }
```

Two rules:
- `package` must be the **first statement** in the file (comments aside).
- The folder structure must **match** the package name: `com.tejas.notes.model` → `com/tejas/notes/model/`.

The fully-qualified name of that class is `com.tejas.notes.model.User`.

### Why reverse-domain naming?

`com.tejas.notes` is the reverse of `notes.tejas.com`, a domain you control. It guarantees your class names can never collide with someone else's — the entire world's Java libraries share one namespace, and this is how they stay out of each other's way.

Convention: **all lowercase**, no underscores.

### `import`

```java
import java.util.List;              // one class
import java.util.*;                 // everything in the package (not sub-packages)
import static java.lang.Math.PI;    // one static member
import static java.lang.Math.*;     // all static members

public class Demo {
    public static void main(String[] args) {
        List<String> names = new ArrayList<>();
        System.out.println(PI);           // no need for Math.PI
        System.out.println(sqrt(16));     // no need for Math.sqrt
    }
}
```

Notes:
- `import` does **not** copy code or affect performance. It's purely a compile-time shorthand so you can write `List` instead of `java.util.List`.
- `java.lang.*` is imported automatically — that's why `String`, `System`, `Integer` and `Math` need no import.
- Wildcard imports don't reach sub-packages: `import java.util.*` does not give you `java.util.concurrent.ExecutorService`.
- Name collisions must be resolved explicitly:

```java
import java.util.Date;
// import java.sql.Date;     ← can't have both

java.sql.Date sqlDate = ...;   // use the fully-qualified name for the other one
```

### Compiling and running with packages

```bash
javac -d out src/com/tejas/notes/model/User.java
java -cp out com.tejas.notes.model.User
```

---

## 2. Access modifiers

Java has four levels of access. Listed from most open to most closed:

| Modifier | Same class | Same package | Subclass (other package) | Anywhere |
| :-- | :-: | :-: | :-: | :-: |
| `public` | ✅ | ✅ | ✅ | ✅ |
| `protected` | ✅ | ✅ | ✅ | ❌ |
| *(none)* — "package-private" / default | ✅ | ✅ | ❌ | ❌ |
| `private` | ✅ | ❌ | ❌ | ❌ |

```
private  ──▶  package-private  ──▶  protected  ──▶  public
  most restrictive                            least restrictive
```

### `private`

Visible only inside the same class (including its nested classes).

```java
public class Account {
    private double balance;                  // nobody outside can touch it
    private void audit() { }                 // internal helper
}
```

This is your default for fields. Almost always.

### package-private (write nothing)

Visible to any class in the **same package**. This is the "no modifier" default, and it's the one people forget exists.

```java
package com.tejas.service;

class InternalHelper { }        // usable inside com.tejas.service only
```

Great for implementation classes you don't want leaking into your library's public API.

### `protected`

Same package **plus** subclasses in any package.

```java
package com.tejas.base;
public class Shape {
    protected double scale = 1.0;         // subclasses can use it
    protected void validate() { }
}

package com.tejas.shapes;
public class Circle extends Shape {
    void resize() {
        scale = 2.0;         // ✅ accessible — Circle is a subclass
        validate();          // ✅
    }
}
```

**The subtle rule:** a subclass can access `protected` members **through a reference of its own type**, not through a bare parent reference from another package.

```java
public class Circle extends Shape {
    void test(Shape other, Circle otherCircle) {
        this.scale = 1;              // ✅
        otherCircle.scale = 1;       // ✅ — it's a Circle
        other.scale = 1;             // ❌ compile error — just a Shape, different package
    }
}
```

### `public`

Visible everywhere. Once you make something `public` in a library, you can basically never change it without breaking somebody.

---

## 3. What can go where

```java
// Top-level classes: only `public` or package-private
public class A { }      // ✅
class B { }             // ✅ package-private
// private class C { }  // ❌ meaningless at top level — nothing could ever use it
// protected class D { }// ❌ same

// Members: all four are legal
public class Demo {
    public    int a;
    protected int b;
              int c;    // package-private
    private   int d;

    public class Nested { }        // ✅ nested classes CAN be private/protected
    private class Hidden { }       // ✅
}
```

Also: **one public class per file**, and the file must be named after it.

---

## 4. The design rule

> **Make everything as private as you can get away with, and open it up only when there's a reason.**

Every `public` member is a promise. Package-private and private members you can rename, delete or restructure freely, because you can see every use of them.

```java
// 😖 Everything public "just in case"
public class UserService {
    public Database db;
    public Map<String, User> cache;
    public void connectDb() { }
    public User findUser(String id) { }
}

// 😊 One public entry point, everything else hidden
public class UserService {
    private final Database db;
    private final Map<String, User> cache = new HashMap<>();

    public UserService(Database db) { this.db = db; }

    public User findUser(String id) {                 // the only public API
        return cache.computeIfAbsent(id, this::loadFromDb);
    }

    private User loadFromDb(String id) { return db.query(id); }
}
```

The second version can swap out its cache, add a second database, or change the loading strategy — and no caller anywhere has to change.

---

## 5. Typical project layout

```
src/
└── com/tejas/shop/
    ├── Application.java             ← public entry point
    ├── model/
    │   ├── Order.java               ← public data types
    │   └── Customer.java
    ├── service/
    │   ├── OrderService.java        ← public API
    │   └── PricingEngine.java       ← package-private helper
    ├── repository/
    │   ├── OrderRepository.java     ← public interface
    │   └── JdbcOrderRepository.java ← package-private implementation
    └── util/
        └── DateUtils.java
```

Notice `JdbcOrderRepository` being package-private: callers get the `OrderRepository` interface and a factory method, and can never accidentally depend on the JDBC specifics.

---

## 6. Modules (Java 9+) — the short version

Packages control class-level visibility; **modules** control *package*-level visibility across a whole JAR.

```java
// module-info.java at the source root
module com.tejas.shop {
    requires java.sql;                    // what I depend on
    exports com.tejas.shop.model;         // what others may use
    exports com.tejas.shop.service;
    // com.tejas.shop.internal is NOT exported → invisible outside this module,
    // even though its classes are `public`
}
```

Before modules, `public` meant "visible to the entire world" and there was no way to say "public within my library only". Modules fixed that. Most application code doesn't need them; libraries and the JDK itself do.

---

## 🧠 Rapid-fire recall

1. What are the four access levels, from most to least restrictive?
2. What does writing no modifier at all mean?
3. Can a subclass in a different package read a `protected` field through a plain superclass reference? Why or why not?
4. Which modifiers are legal on a *top-level* class, and why are the others banned?
5. Does `import java.util.*` import `java.util.concurrent`?
6. Why is reverse-domain package naming used?
7. What problem do modules solve that packages can't?

<details>
<summary>Answers</summary>

1. `private` → package-private (default) → `protected` → `public`.
2. Package-private: visible to any class in the same package, and nothing else.
3. No. From another package, `protected` access is only allowed through a reference of the subclass's own type — otherwise any class could get at another branch of the hierarchy's internals.
4. `public` and package-private. `private`/`protected` would make the class unusable by anything, which is meaningless at the top level.
5. No — wildcard imports cover one package only, never sub-packages.
6. It guarantees globally unique names by piggy-backing on domain ownership.
7. Modules let a library mark some of its `public` packages as internal — not exported — so `public` no longer automatically means "visible to the whole world".

</details>
