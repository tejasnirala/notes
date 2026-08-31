---
title: Generics
author: Tejas Nirala
---

# Generics

Generics let you write a class or method that works with **any type**, while still keeping full compile-time type checking. Every time you write `List<String>`, you're using them.

---

## 1. The problem generics solve

Before Java 5, collections held `Object`:

```java
List list = new ArrayList();     // "raw" type
list.add("hello");
list.add(42);                    // nobody stops you

String s = (String) list.get(0); // cast required, every single time
String t = (String) list.get(1); // 💥 ClassCastException at RUNTIME
```

Two problems: you cast constantly, and errors surface at runtime.

```java
List<String> list = new ArrayList<>();
list.add("hello");
list.add(42);                    // ❌ COMPILE ERROR — caught immediately
String s = list.get(0);          // ✅ no cast needed
```

> **The whole point: move type errors from runtime to compile time, and delete the casts.**

---

## 2. Generic classes

```java
public class Box<T> {            // T is a TYPE PARAMETER
    private T content;

    public void put(T content) { this.content = content; }
    public T get()             { return content; }
}
```

```java
Box<String> sb = new Box<>();
sb.put("hello");
String s = sb.get();          // no cast

Box<Integer> ib = new Box<>();
ib.put(42);
// ib.put("oops");            // ❌ compile error
```

The `<>` on the right (the **diamond**, Java 7+) infers the type from the left, so you don't repeat yourself.

### Naming conventions for type parameters

| Letter | Convention |
| :-- | :-- |
| `T` | Type |
| `E` | Element (used throughout the collections API) |
| `K`, `V` | Key, Value |
| `N` | Number |
| `R` | Result / Return type |
| `S`, `U` | Second, third types |

### Multiple type parameters

```java
public class Pair<K, V> {
    private final K key;
    private final V value;

    public Pair(K key, V value) { this.key = key; this.value = value; }

    public K getKey()   { return key; }
    public V getValue() { return value; }

    public <R> Pair<K, R> withValue(R newValue) {     // a generic METHOD too
        return new Pair<>(key, newValue);
    }

    @Override public String toString() { return "(" + key + ", " + value + ")"; }
}

var p = new Pair<>("age", 25);          // Pair<String, Integer>
var q = p.withValue(true);              // Pair<String, Boolean>
```

---

## 3. Generic methods

A method can declare its own type parameters, independent of the class:

```java
public class Utils {
    // The <T> before the return type declares the parameter
    public static <T> void printAll(List<T> list) {
        for (T item : list) System.out.println(item);
    }

    public static <T> T firstOrDefault(List<T> list, T defaultValue) {
        return list.isEmpty() ? defaultValue : list.get(0);
    }

    public static <K, V> Map<V, K> invert(Map<K, V> map) {
        var result = new HashMap<V, K>();
        map.forEach((k, v) -> result.put(v, k));
        return result;
    }
}

Utils.printAll(List.of(1, 2, 3));
String s = Utils.firstOrDefault(List.of(), "none");    // T inferred as String
```

Type inference usually means you never write the type explicitly. When you must:

```java
List<String> empty = Utils.<String>firstOrDefault(...);   // explicit type witness
```

---

## 4. Bounded type parameters

Restrict what `T` can be, which lets you *call methods* on it.

```java
// T must be Number or a subclass — so we can call doubleValue()
public static <T extends Number> double sum(List<T> numbers) {
    double total = 0;
    for (T n : numbers) total += n.doubleValue();
    return total;
}

sum(List.of(1, 2, 3));           // ✅ Integer
sum(List.of(1.5, 2.5));          // ✅ Double
// sum(List.of("a", "b"));       // ❌ String is not a Number
```

Without the bound, `T` is treated as `Object` and you could only call `Object`'s methods.

### Multiple bounds

```java
public static <T extends Comparable<T> & Serializable> T max(List<T> list) {
    T best = list.get(0);
    for (T item : list) {
        if (item.compareTo(best) > 0) best = item;
    }
    return best;
}
```

A class bound (if any) must come first; the rest must be interfaces.

---

## 5. Wildcards — the hard part, explained properly

### Why they exist

This looks like it should work, and doesn't:

```java
List<Integer> ints = List.of(1, 2, 3);
List<Number> nums = ints;        // ❌ COMPILE ERROR
```

Even though `Integer` **is** a `Number`, `List<Integer>` is **not** a `List<Number>`. Generics are **invariant**.

**Why?** Because if it were allowed:

```java
List<Number> nums = ints;        // pretend this compiled
nums.add(3.14);                  // a Double into a List<Integer>!
Integer i = ints.get(3);         // 💥 ClassCastException
```

Java forbids the first line to prevent the last one. Compare with arrays, which *are* covariant and therefore unsafe:

```java
Object[] arr = new String[3];    // ✅ compiles — arrays ARE covariant
arr[0] = 42;                     // 💥 ArrayStoreException at RUNTIME
```

Generics chose compile-time safety instead. Wildcards then give back the flexibility, safely.

### `? extends T` — an upper bound (a **producer**: you READ from it)

```java
static double sumAll(List<? extends Number> list) {     // "some subtype of Number"
    double total = 0;
    for (Number n : list) total += n.doubleValue();     // ✅ reading is safe
    return total;
}

sumAll(List.of(1, 2, 3));        // ✅ List<Integer>
sumAll(List.of(1.5, 2.5));       // ✅ List<Double>
```

You can **read** as `Number`. You **cannot write** (except `null`):

```java
static void broken(List<? extends Number> list) {
    list.add(42);                // ❌ compile error
}
```

Why? `list` might actually be a `List<Double>`. Adding an `Integer` would corrupt it. The compiler doesn't know which subtype it is, so it forbids all writes.

### `? super T` — a lower bound (a **consumer**: you WRITE to it)

```java
static void addNumbers(List<? super Integer> list) {    // "Integer or a supertype"
    list.add(1);                 // ✅ safe — Integer fits in any supertype list
    list.add(2);
    // Integer i = list.get(0);  // ❌ could be a List<Object>; only Object is safe
}

addNumbers(new ArrayList<Integer>());   // ✅
addNumbers(new ArrayList<Number>());    // ✅
addNumbers(new ArrayList<Object>());    // ✅
```

You can **write** `Integer`s. You can only **read** as `Object`.

### PECS — the mnemonic

> **Producer Extends, Consumer Super**

- If the parameter **produces** values for you to read → `? extends T`
- If the parameter **consumes** values you write into it → `? super T`
- If it does **both** → use a plain `T`, no wildcard

The JDK's own signature is the textbook example:

```java
public static <T> void copy(List<? super T> dest, List<? extends T> src)
//                                ↑ consumer            ↑ producer
```

And `Collections.max`:

```java
public static <T> T max(Collection<? extends T> coll, Comparator<? super T> comp)
//                                  ↑ we read elements    ↑ comparator consumes them
```

### Unbounded wildcard `<?>`

```java
static void printSize(List<?> list) {     // "a list of something"
    System.out.println(list.size());      // ✅ methods not involving T
    // list.add("x");                     // ❌ can't add anything but null
    for (Object o : list) { }             // ✅ read as Object
}
```

Use `List<?>` when you genuinely don't care about the element type. It's **not** the same as the raw `List` — `List<?>` is type-safe, raw `List` is not.

### Summary

| Declaration | Read as | Write | Use for |
| :-- | :-- | :-- | :-- |
| `List<T>` | `T` | ✅ `T` | Both reading and writing |
| `List<? extends T>` | `T` | ❌ (only null) | Producer — you read from it |
| `List<? super T>` | `Object` | ✅ `T` and subtypes | Consumer — you write into it |
| `List<?>` | `Object` | ❌ (only null) | You don't care about the type |

---

## 6. Type erasure — what actually happens at runtime

**Generics exist only at compile time.** The compiler checks types, then *erases* them, replacing type parameters with their bounds (or `Object`) and inserting casts.

```java
// What you write
public class Box<T> {
    private T content;
    public T get() { return content; }
}
List<String> list = new ArrayList<>();
String s = list.get(0);

// What the bytecode contains
public class Box {
    private Object content;
    public Object get() { return content; }
}
List list = new ArrayList();
String s = (String) list.get(0);      // cast inserted by the compiler
```

Erasure was chosen for **backwards compatibility** — Java 5 generic code had to interoperate with pre-generics libraries. The consequences:

### (a) You can't check a generic type at runtime

```java
List<String> a = new ArrayList<>();
List<Integer> b = new ArrayList<>();
System.out.println(a.getClass() == b.getClass());   // true! Both are just ArrayList

if (a instanceof List<String>) { }                  // ❌ compile error
if (a instanceof List<?>) { }                       // ✅ this is allowed
```

### (b) You can't create an array of a generic type

```java
T[] array = new T[10];              // ❌ compile error
T[] array = (T[]) new Object[10];   // ⚠️ the standard workaround (unchecked warning)
```

`ArrayList` does exactly this internally: `elementData = new Object[capacity];`

### (c) You can't instantiate `T`

```java
T obj = new T();                    // ❌ — erasure means there's no T at runtime

// Workaround: pass a factory or a Class object
static <T> T create(Supplier<T> factory) { return factory.get(); }
create(ArrayList::new);
```

### (d) Overloads that erase to the same signature clash

```java
void process(List<String> l) { }
void process(List<Integer> l) { }   // ❌ both erase to process(List)
```

### (e) No primitives as type arguments

```java
List<int> nums;         // ❌
List<Integer> nums;     // ✅ — autoboxing does the work, at a cost
```

This is why `IntStream` and `int[]` exist separately from `Stream<Integer>` and `Integer[]` — boxing millions of values is genuinely expensive.

---

## 7. Raw types — never use them

```java
List raw = new ArrayList();      // raw type — generics disabled
raw.add("hello");
raw.add(42);
String s = (String) raw.get(1);  // 💥 ClassCastException
```

Raw types exist only for backwards compatibility with pre-Java-5 code. Modern compilers warn:

```
Note: Demo.java uses unchecked or unsafe operations.
```

Take the warning seriously — it means the compiler has stopped protecting you.

---

## 8. Worked example: a type-safe repository

```java
import java.util.*;
import java.util.function.*;

interface Entity {
    String getId();
}

class Repository<T extends Entity> {              // bounded: we can call getId()
    private final Map<String, T> store = new HashMap<>();

    public void save(T entity) {
        store.put(entity.getId(), entity);
    }

    public Optional<T> findById(String id) {
        return Optional.ofNullable(store.get(id));
    }

    public List<T> findAll() {
        return new ArrayList<>(store.values());
    }

    public List<T> findWhere(Predicate<? super T> filter) {   // consumer of T
        return store.values().stream().filter(filter).toList();
    }

    // Copy everything into any collection that can hold T or a supertype
    public void copyInto(Collection<? super T> destination) { // PECS: consumer
        destination.addAll(store.values());
    }
}

record User(String getId, String name, int age) implements Entity {
    @Override public String getId() { return getId; }
}

public class Demo {
    public static void main(String[] args) {
        var repo = new Repository<User>();
        repo.save(new User("u1", "Tejas", 25));
        repo.save(new User("u2", "Ankit", 31));

        repo.findById("u1").ifPresent(u -> System.out.println(u.name()));   // Tejas

        List<User> adults = repo.findWhere(u -> u.age() >= 30);
        System.out.println(adults);                       // [User[...Ankit...]]

        List<Entity> all = new ArrayList<>();
        repo.copyInto(all);                                // ✅ Entity is a supertype
        System.out.println(all.size());                    // 2
    }
}
```

---

## 🧠 Rapid-fire recall

1. What two problems do generics solve compared to pre-Java-5 collections?
2. Why is `List<Integer>` not a `List<Number>`, and what would break if it were?
3. What does PECS stand for, and when do you use each half?
4. Can you `add` to a `List<? extends Number>`? Why or why not?
5. What is type erasure, and why was it chosen?
6. Name three things erasure makes impossible.
7. What's the difference between `List`, `List<?>` and `List<Object>`?

<details>
<summary>Answers</summary>

1. It eliminates casts and moves type errors from runtime `ClassCastException`s to compile time.
2. Generics are invariant. If it were allowed, you could `add` a `Double` through the `List<Number>` reference and corrupt the `List<Integer>`.
3. Producer Extends, Consumer Super: use `? extends T` when you read from the parameter, `? super T` when you write into it.
4. No (except `null`) — the list might actually be a `List<Double>`, so the compiler can't prove any write is safe.
5. The compiler checks generic types then removes them, replacing parameters with their bounds and inserting casts. It was chosen for backwards compatibility with pre-generics code.
6. `new T()`, `new T[10]`, `instanceof List<String>`, overloads differing only in type arguments, and primitives as type arguments.
7. Raw `List` disables type checking entirely (unsafe); `List<?>` is type-safe but you can only read as `Object` and can't add; `List<Object>` is a list specifically of `Object` and accepts any element.

</details>
