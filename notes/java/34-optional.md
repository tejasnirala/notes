---
title: Optional
author: Tejas Nirala
---

# `Optional`

`Optional<T>` is a container that either holds a value or is empty. It exists to make "this might not have a value" **visible in the type system**, instead of relying on `null` and hoping the caller remembers to check.

---

## 1. The problem: `null`

```java
User user = repository.findByEmail("x@y.com");
System.out.println(user.getName());     // 💥 NullPointerException if not found
```

The method signature says it returns a `User`. It lies — sometimes it returns nothing. Nothing in the type tells you that, so the check gets forgotten.

> Tony Hoare, who introduced null references in 1965, later called it his **"billion-dollar mistake"**.

```java
Optional<User> user = repository.findByEmail("x@y.com");
// Now the signature is HONEST. The compiler won't let you use it
// without acknowledging the empty case.
```

---

## 2. Creating an Optional

```java
Optional<String> a = Optional.of("hello");         // value MUST be non-null, else NPE
Optional<String> b = Optional.ofNullable(maybeNull); // null → empty Optional
Optional<String> c = Optional.empty();              // explicitly empty
```

The distinction matters:

```java
Optional.of(null);            // 💥 NullPointerException — fail fast, deliberate
Optional.ofNullable(null);    // ✅ Optional.empty
```

Use `of` when you *know* it's non-null (and want a crash if you're wrong); use `ofNullable` when it genuinely might be null.

---

## 3. Getting the value out — correctly

```java
Optional<String> opt = Optional.of("hello");

// ❌ NEVER do this — it's just null with extra steps
if (opt.isPresent()) {
    System.out.println(opt.get());
}
opt.get();                      // throws NoSuchElementException when empty

// ✅ ifPresent — do something only if there's a value
opt.ifPresent(System.out::println);

// ✅ ifPresentOrElse — Java 9+, handle both branches
opt.ifPresentOrElse(
    v -> System.out.println("Found: " + v),
    () -> System.out.println("Nothing there")
);

// ✅ orElse — supply a default (always evaluated)
String v1 = opt.orElse("default");

// ✅ orElseGet — supply a default lazily (only evaluated if empty)
String v2 = opt.orElseGet(() -> expensiveDefault());

// ✅ orElseThrow — throw if empty
String v3 = opt.orElseThrow();                                    // NoSuchElementException
String v4 = opt.orElseThrow(() -> new UserNotFoundException(id)); // your exception

// ✅ or — Java 9+, fall back to another Optional
Optional<String> v5 = opt.or(() -> lookupElsewhere());
```

### `orElse` vs `orElseGet` — a real bug

```java
String value = optional.orElse(loadFromDatabase());
// ⚠️ loadFromDatabase() runs ALWAYS — even when the Optional has a value.
// It's an argument; arguments are evaluated before the call.

String value = optional.orElseGet(() -> loadFromDatabase());
// ✅ the lambda only runs when the Optional is empty
```

**Rule:** use `orElse` for cheap constants, `orElseGet` for anything that costs something.

---

## 4. Transforming — where Optional earns its place

`Optional` has `map`, `filter` and `flatMap`, exactly like a stream of 0 or 1 elements.

```java
Optional<String> name = Optional.of("Tejas");

// map — transform the value if present
Optional<Integer> length = name.map(String::length);           // Optional[5]
Optional<Integer> none   = Optional.<String>empty()
                                   .map(String::length);       // Optional.empty — no NPE

// filter — keep the value only if it matches
Optional<String> longName = name.filter(n -> n.length() > 10); // Optional.empty

// flatMap — when the function itself returns an Optional
Optional<Address> addr = user.flatMap(User::getAddress);
```

### The whole point, in one comparison

```java
// 😖 Defensive null checks — the "pyramid of doom"
String city = "Unknown";
if (user != null) {
    Address address = user.getAddress();
    if (address != null) {
        City c = address.getCity();
        if (c != null) {
            city = c.getName().toUpperCase();
        }
    }
}

// 😊 Optional chain — the null handling is invisible
String city = Optional.ofNullable(user)
        .map(User::getAddress)
        .map(Address::getCity)
        .map(City::getName)
        .map(String::toUpperCase)
        .orElse("Unknown");
```

If **any** link is empty, the whole chain short-circuits to empty and `orElse` supplies the default. No `if`, no nesting, no possibility of a missed check.

### `map` vs `flatMap`

If your function returns a plain value, use `map`. If it already returns an `Optional`, use `flatMap` — otherwise you get `Optional<Optional<T>>`.

```java
class User {
    Optional<Address> getAddress() { ... }    // already returns Optional
}

user.map(User::getAddress);        // Optional<Optional<Address>>  😖
user.flatMap(User::getAddress);    // Optional<Address>            ✅
```

---

## 5. Optional and Streams

```java
// Optional → Stream (Java 9+)
Optional<String> opt = Optional.of("x");
Stream<String> s = opt.stream();       // 1-element stream, or empty

// Collecting the present values from many Optionals
List<User> found = ids.stream()
                      .map(repository::findById)   // Stream<Optional<User>>
                      .flatMap(Optional::stream)   // Stream<User> — empties disappear
                      .toList();

// Streams already return Optional for the operations that might find nothing
Optional<String> first = list.stream().filter(s -> s.startsWith("A")).findFirst();
Optional<Integer> max  = list.stream().max(Comparator.naturalOrder());
Optional<Integer> sum  = list.stream().reduce(Integer::sum);
```

`flatMap(Optional::stream)` is the idiomatic way to filter-and-unwrap in one step. The older equivalent was `.filter(Optional::isPresent).map(Optional::get)`.

---

## 6. Where to use Optional — and where NOT to

This is genuinely contentious, so here's the mainstream consensus (largely from *Effective Java* and the JDK team's own guidance).

### ✅ DO use it as a return type

```java
public Optional<User> findById(String id) {
    return Optional.ofNullable(users.get(id));
}
```

This is what `Optional` was designed for: telling the caller "there may be no result" in the signature.

### ❌ DON'T use it as a field

```java
class User {
    private Optional<String> middleName;    // ❌
}
```

`Optional` isn't `Serializable`, it adds an object per field, and it complicates frameworks (JPA, Jackson). Use a plain nullable field and return `Optional` from the getter:

```java
class User {
    private String middleName;                                  // ✅ plain field
    public Optional<String> getMiddleName() {
        return Optional.ofNullable(middleName);                 // ✅ Optional at the boundary
    }
}
```

### ❌ DON'T use it as a method parameter

```java
void process(Optional<String> name) { }     // ❌ callers must wrap; and they can pass null!
process(null);                               // 😱 still possible

void process(String name) { }                // ✅ overload instead
void process() { }
```

### ❌ DON'T use it in collections

```java
List<Optional<String>> list;                 // ❌ just leave absent entries out
Map<String, Optional<User>> map;             // ❌ absence IS the missing key
```

### ❌ DON'T return an empty `Optional` where an empty collection would do

```java
Optional<List<User>> findAll();     // ❌ what does empty mean vs an empty list?
List<User> findAll();               // ✅ return an empty list
```

### ❌ DON'T use `Optional` for primitives without a reason

```java
Optional<Integer> count;      // boxes
OptionalInt count;            // ✅ if you must — but usually just use a sentinel or int
```

---

## 7. Anti-patterns

```java
// ❌ 1. isPresent + get — this is null-checking with extra typing
if (opt.isPresent()) { use(opt.get()); }
opt.ifPresent(this::use);                      // ✅

// ❌ 2. Calling get() without checking
String s = opt.get();                          // NoSuchElementException waiting to happen
String s = opt.orElseThrow(() -> new MyException());   // ✅ at least it's intentional

// ❌ 3. Returning null from a method that returns Optional
Optional<User> find(String id) {
    return null;                               // 😱 the worst of both worlds
}

// ❌ 4. Nesting Optionals
Optional<Optional<String>> nested;             // use flatMap

// ❌ 5. Optional just to avoid one null check
Optional.ofNullable(x).orElse(y);              // x != null ? x : y  is clearer
// (though Objects.requireNonNullElse(x, y) is clearer still)

// ❌ 6. orElse with an expensive call
opt.orElse(computeExpensiveDefault());         // always runs
opt.orElseGet(this::computeExpensiveDefault);  // ✅
```

---

## 8. Worked example

```java
import java.util.*;

public class OptionalDemo {

    record Address(String street, String city) { }
    record User(String id, String name, Address address) {
        Optional<Address> address() { return Optional.ofNullable(address); }
    }

    static class UserRepository {
        private final Map<String, User> users = Map.of(
            "u1", new User("u1", "Tejas", new Address("MG Road", "Bangalore")),
            "u2", new User("u2", "Ankit", null)          // no address on file
        );

        Optional<User> findById(String id) {
            return Optional.ofNullable(users.get(id));    // ✅ honest signature
        }

        Optional<User> findByName(String name) {
            return users.values().stream()
                        .filter(u -> u.name().equals(name))
                        .findFirst();                     // Streams give you Optional free
        }
    }

    public static void main(String[] args) {
        var repo = new UserRepository();

        // 1. Present
        repo.findById("u1").ifPresent(u -> System.out.println("Found " + u.name()));

        // 2. Absent, with a message
        repo.findById("u99").ifPresentOrElse(
            u -> System.out.println("Found " + u.name()),
            () -> System.out.println("No such user"));

        // 3. A chain across three levels of possible absence
        String city = repo.findById("u1")
                          .flatMap(User::address)          // flatMap: returns Optional
                          .map(Address::city)              // map: returns a plain value
                          .map(String::toUpperCase)
                          .orElse("UNKNOWN");
        System.out.println(city);                          // BANGALORE

        // 4. Same chain, but a link is missing — no NPE anywhere
        System.out.println(repo.findById("u2")
                               .flatMap(User::address)
                               .map(Address::city)
                               .orElse("UNKNOWN"));        // UNKNOWN

        // 5. filter in the chain
        System.out.println(repo.findById("u1")
                               .filter(u -> u.name().length() > 10)
                               .map(User::name)
                               .orElse("name too short"));  // name too short

        // 6. Throwing a domain exception when absent
        try {
            repo.findById("u99").orElseThrow(
                () -> new NoSuchElementException("User u99 not found"));
        } catch (NoSuchElementException e) {
            System.out.println("Caught: " + e.getMessage());
        }

        // 7. Collecting only the users that exist
        List<String> names = List.of("u1", "u2", "u99").stream()
                                 .map(repo::findById)
                                 .flatMap(Optional::stream)
                                 .map(User::name)
                                 .toList();
        System.out.println(names);                          // [Tejas, Ankit]

        // 8. orElse vs orElseGet
        System.out.println(repo.findById("u1")
                               .map(User::name)
                               .orElseGet(() -> {
                                   System.out.println("(this never prints)");
                                   return "fallback";
                               }));                          // Tejas
    }
}
```

---

## 🧠 Rapid-fire recall

1. What problem does `Optional` solve that `null` doesn't?
2. What's the difference between `Optional.of(x)` and `Optional.ofNullable(x)`?
3. Why is `if (opt.isPresent()) opt.get()` considered an anti-pattern?
4. When does `orElse` behave differently from `orElseGet`, and why?
5. When do you need `flatMap` instead of `map` on an Optional?
6. Name three places you should *not* use `Optional`.
7. What does `.flatMap(Optional::stream)` do in a stream pipeline?

<details>
<summary>Answers</summary>

1. It makes possible absence visible in the type signature, so the caller cannot silently forget to handle it.
2. `of` throws `NullPointerException` if the value is null (fail fast); `ofNullable` converts null into an empty Optional.
3. It's a null check with extra ceremony, and it reintroduces the risk of calling `get()` without a check. Use `ifPresent`, `map`, or `orElse` instead.
4. `orElse`'s argument is always evaluated, even when a value is present; `orElseGet`'s supplier only runs when the Optional is empty.
5. When the mapping function itself returns an `Optional` — `map` would give you `Optional<Optional<T>>`.
6. As a field, as a method parameter, inside collections, and as a return type where an empty collection would be more natural.
7. Turns each Optional into a 0-or-1-element stream, so empty ones vanish and present values are unwrapped — filtering and unwrapping in one step.

</details>
