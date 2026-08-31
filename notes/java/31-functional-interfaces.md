---
title: Functional Interfaces & Method References
author: Tejas Nirala
---

# Functional Interfaces & Method References

A lambda always implements a **functional interface**. Java ships with about 40 of them in `java.util.function`, and you only need to know six shapes to read almost any modern Java code.

---

## 1. What makes an interface functional

Exactly **one abstract method** (a "SAM" — Single Abstract Method). It may have any number of `default` and `static` methods.

```java
@FunctionalInterface
interface Calculator {
    int calculate(int a, int b);              // the single abstract method

    default Calculator andThenDouble() {      // defaults don't count
        return (a, b) -> calculate(a, b) * 2;
    }

    static Calculator adder() {               // statics don't count
        return (a, b) -> a + b;
    }
}

Calculator add = (a, b) -> a + b;
System.out.println(add.calculate(2, 3));                   // 5
System.out.println(add.andThenDouble().calculate(2, 3));   // 10
```

`@FunctionalInterface` is optional but strongly recommended — it makes the compiler reject a second abstract method, so nobody accidentally breaks every lambda that targets your interface.

> Methods inherited from `Object` (`equals`, `hashCode`, `toString`) don't count toward the SAM total either. That's why `Comparator` is functional despite declaring `equals`.

---

## 2. The six core interfaces

Learn these and everything else is a variation.

| Interface | Method | Takes | Returns | Mental model |
| :-- | :-- | :-- | :-- | :-- |
| `Supplier<T>` | `get()` | nothing | `T` | **produces** a value |
| `Consumer<T>` | `accept(T)` | `T` | nothing | **consumes** a value |
| `Function<T,R>` | `apply(T)` | `T` | `R` | **transforms** T into R |
| `Predicate<T>` | `test(T)` | `T` | `boolean` | **tests** a condition |
| `UnaryOperator<T>` | `apply(T)` | `T` | `T` | transforms T into T |
| `BinaryOperator<T>` | `apply(T,T)` | two `T`s | `T` | combines two Ts |

```java
Supplier<String>          supplier = () -> "hello";
Consumer<String>          consumer = s -> System.out.println(s);
Function<String, Integer> function = s -> s.length();
Predicate<String>         predicate = s -> s.isEmpty();
UnaryOperator<String>     unary = s -> s.toUpperCase();
BinaryOperator<Integer>   binary = (a, b) -> a + b;

System.out.println(supplier.get());              // hello
consumer.accept("world");                        // world
System.out.println(function.apply("hello"));     // 5
System.out.println(predicate.test(""));          // true
System.out.println(unary.apply("hi"));           // HI
System.out.println(binary.apply(2, 3));          // 5
```

### Where you already meet them

```java
list.forEach(consumer);                   // Consumer<T>
list.removeIf(predicate);                 // Predicate<T>
list.replaceAll(unaryOperator);           // UnaryOperator<T>
stream.map(function);                     // Function<T, R>
stream.filter(predicate);                 // Predicate<T>
stream.reduce(binaryOperator);            // BinaryOperator<T>
map.computeIfAbsent(k, function);         // Function<K, V>
optional.orElseGet(supplier);             // Supplier<T>
```

### The two-argument versions

| Interface | Method |
| :-- | :-- |
| `BiFunction<T,U,R>` | `apply(T, U)` → `R` |
| `BiConsumer<T,U>` | `accept(T, U)` → void |
| `BiPredicate<T,U>` | `test(T, U)` → boolean |

```java
BiFunction<Integer, Integer, String> f = (a, b) -> a + " + " + b + " = " + (a + b);
map.forEach((k, v) -> System.out.println(k + "=" + v));   // BiConsumer
map.merge(k, 1, Integer::sum);                            // BinaryOperator (a BiFunction)
```

### The primitive specialisations (avoiding boxing)

Boxing millions of values is genuinely expensive, so there are primitive variants:

| Interface | Signature |
| :-- | :-- |
| `IntPredicate`, `LongPredicate`, `DoublePredicate` | `int → boolean` |
| `IntFunction<R>`, `LongFunction<R>` | `int → R` |
| `ToIntFunction<T>`, `ToLongFunction<T>`, `ToDoubleFunction<T>` | `T → int` |
| `IntUnaryOperator`, `IntBinaryOperator` | `int → int`, `(int,int) → int` |
| `IntSupplier`, `IntConsumer` | `→ int`, `int →` |
| `ObjIntConsumer<T>` | `(T, int) →` |

```java
ToIntFunction<String> length = String::length;
IntStream.range(0, 5).map(i -> i * i).sum();
list.stream().mapToInt(String::length).sum();     // no Integer boxing
```

---

## 3. Composition — where this gets powerful

These interfaces have `default` methods that combine them.

### `Predicate`: `and`, `or`, `negate`, `isEqual`, `not`

```java
Predicate<String> isEmpty  = String::isEmpty;
Predicate<String> isLong   = s -> s.length() > 10;

Predicate<String> isNonEmpty      = isEmpty.negate();
Predicate<String> isLongNonEmpty  = isNonEmpty.and(isLong);
Predicate<String> either          = isEmpty.or(isLong);

Predicate<String> notEmpty = Predicate.not(String::isEmpty);   // Java 11+
Predicate<String> isJava   = Predicate.isEqual("Java");
```

Building a filter from user input becomes trivial:

```java
Predicate<Employee> filter = e -> true;                          // start permissive
if (dept != null)   filter = filter.and(e -> e.dept().equals(dept));
if (minSalary > 0)  filter = filter.and(e -> e.salary() >= minSalary);
if (activeOnly)     filter = filter.and(Employee::active);

List<Employee> results = staff.stream().filter(filter).toList();
```

That's a dynamic query built from composable pieces — no string concatenation, no if/else tree.

### `Function`: `andThen`, `compose`, `identity`

```java
Function<Integer, Integer> times2 = x -> x * 2;
Function<Integer, Integer> plus3  = x -> x + 3;

times2.andThen(plus3).apply(5);    // 13  — times2 FIRST, then plus3
times2.compose(plus3).apply(5);    // 16  — plus3 FIRST, then times2

Function.identity();                // x -> x, useful in Collectors.toMap
```

Remember the direction: `andThen` reads left-to-right; `compose` reads right-to-left (like mathematical `f ∘ g`).

### `Consumer`: `andThen`

```java
Consumer<String> log   = s -> System.out.println("LOG: " + s);
Consumer<String> save  = s -> database.write(s);

Consumer<String> both = log.andThen(save);
both.accept("event");    // logs, then saves
```

---

## 4. Method references

A method reference is a **shorthand for a lambda that does nothing but call one method**.

```java
list.forEach(s -> System.out.println(s));    // lambda
list.forEach(System.out::println);           // method reference — identical
```

There are **four kinds**, and the third one is the confusing one.

### (a) Static method — `ClassName::staticMethod`

```java
Function<String, Integer> parse = Integer::parseInt;
//  equivalent to:  s -> Integer.parseInt(s)

BinaryOperator<Integer> max = Integer::max;
//  equivalent to:  (a, b) -> Integer.max(a, b)

list.stream().map(String::valueOf);
```

### (b) Instance method of a *particular* object — `instance::method`

```java
String prefix = "Hello, ";
Function<String, String> greet = prefix::concat;
//  equivalent to:  s -> prefix.concat(s)

PrintStream out = System.out;
Consumer<String> printer = out::println;

MyService service = new MyService();
list.forEach(service::process);              // x -> service.process(x)
```

### (c) Instance method of an *arbitrary* object of a type — `ClassName::instanceMethod`

**This is the one people find confusing.** The first parameter of the lambda becomes the *receiver*.

```java
Function<String, Integer> len = String::length;
//  equivalent to:  s -> s.length()
//                       ↑ the parameter is the object the method is called ON

BiFunction<String, String, Boolean> starts = String::startsWith;
//  equivalent to:  (a, b) -> a.startsWith(b)
//                   ↑ receiver  ↑ argument

list.sort(String::compareToIgnoreCase);      // (a, b) -> a.compareToIgnoreCase(b)
list.stream().map(String::toUpperCase);      // s -> s.toUpperCase()
```

Compare (b) and (c) side by side — same syntax shape, different meaning:

```java
String s = "hello";
Supplier<Integer> a = s::length;             // (b) BOUND — always calls it on `s`
Function<String, Integer> b = String::length; // (c) UNBOUND — calls it on whatever you pass
```

### (d) Constructor — `ClassName::new`

```java
Supplier<List<String>> listMaker = ArrayList::new;
//  equivalent to:  () -> new ArrayList<>()

Function<String, Integer> boxer = Integer::new;
BiFunction<String, Integer, Employee> maker = Employee::new;
//  equivalent to:  (name, age) -> new Employee(name, age)

IntFunction<int[]> arrayMaker = int[]::new;
String[] arr = stream.toArray(String[]::new);

map.computeIfAbsent(key, k -> new ArrayList<>());   // can't use ArrayList::new here —
                                                     // that would pass k to the constructor
```

### Summary table

| Form | Example | Equivalent lambda |
| :-- | :-- | :-- |
| Static | `Integer::parseInt` | `s -> Integer.parseInt(s)` |
| Bound instance | `System.out::println` | `s -> System.out.println(s)` |
| Unbound instance | `String::length` | `s -> s.length()` |
| Constructor | `ArrayList::new` | `() -> new ArrayList<>()` |

### When *not* to use a method reference

```java
// ❌ Method reference is less clear here
map.entrySet().stream().map(Map.Entry::getValue);   // fine, actually

// ❌ Can't do anything but call the one method
list.forEach(s -> System.out.println("Item: " + s));  // must stay a lambda

// ❌ Ambiguous — the reader can't tell which overload
list.forEach(this::process);                          // if `process` is overloaded
```

---

## 5. Writing your own functional interfaces

Most of the time, use `java.util.function`. Write your own when the **domain name adds meaning**:

```java
@FunctionalInterface
interface Validator<T> {
    List<String> validate(T item);

    default Validator<T> and(Validator<T> other) {
        return item -> {
            var errors = new ArrayList<>(validate(item));
            errors.addAll(other.validate(item));
            return errors;
        };
    }
}

Validator<String> notEmpty = s ->
    s.isEmpty() ? List.of("must not be empty") : List.of();

Validator<String> maxLen = s ->
    s.length() > 10 ? List.of("too long") : List.of();

Validator<String> all = notEmpty.and(maxLen);
System.out.println(all.validate(""));            // [must not be empty]
System.out.println(all.validate("aaaaaaaaaaaa")); // [too long]
```

`Validator<String>` communicates far more than `Function<String, List<String>>`.

### Throwing checked exceptions from a lambda

The standard interfaces don't declare `throws`, which is a real annoyance:

```java
list.forEach(f -> Files.delete(f));    // ❌ IOException is not handled
```

Either wrap:

```java
list.forEach(f -> {
    try { Files.delete(f); }
    catch (IOException e) { throw new UncheckedIOException(e); }
});
```

Or define your own interface that declares it:

```java
@FunctionalInterface
interface ThrowingConsumer<T, E extends Exception> {
    void accept(T t) throws E;
}

static <T> Consumer<T> unchecked(ThrowingConsumer<T, Exception> f) {
    return t -> {
        try { f.accept(t); }
        catch (Exception e) { throw new RuntimeException(e); }
    };
}

list.forEach(unchecked(Files::delete));    // ✅ readable again
```

---

## 6. Worked example

```java
import java.util.*;
import java.util.function.*;
import java.util.stream.*;

public class FunctionalDemo {
    record Product(String name, String category, double price, int stock) { }

    public static void main(String[] args) {
        List<Product> catalog = List.of(
            new Product("Keyboard", "Peripherals", 49.99, 12),
            new Product("Monitor",  "Displays",   199.99, 0),
            new Product("Mouse",    "Peripherals", 19.99, 45),
            new Product("Laptop",   "Computers", 1299.00, 3)
        );

        // Predicates as reusable, composable rules
        Predicate<Product> inStock   = p -> p.stock() > 0;
        Predicate<Product> affordable = p -> p.price() < 100;
        Predicate<Product> lowStock  = p -> p.stock() < 5;

        print("In stock & affordable", catalog, inStock.and(affordable));
        print("Out of stock",          catalog, inStock.negate());
        print("Needs reorder",         catalog, inStock.and(lowStock));

        // Functions chained
        Function<Product, String> name       = Product::name;
        Function<String, String>  upper      = String::toUpperCase;
        Function<Product, String> upperName  = name.andThen(upper);
        System.out.println(catalog.stream().map(upperName).toList());
        // [KEYBOARD, MONITOR, MOUSE, LAPTOP]

        // Supplier for lazy defaults — the expensive call only runs if needed
        Supplier<Product> fallback = () -> {
            System.out.println("(computing fallback...)");
            return new Product("Unknown", "None", 0, 0);
        };
        Product found = catalog.stream().filter(p -> p.price() > 5000)
                                        .findFirst()
                                        .orElseGet(fallback);
        System.out.println(found.name());

        // Behaviour in a map — no switch, no if/else chain
        Map<String, UnaryOperator<Double>> discounts = Map.of(
            "Peripherals", p -> p * 0.9,
            "Displays",    p -> p * 0.85,
            "Computers",   p -> p * 0.95
        );
        catalog.forEach(p -> System.out.printf("%-9s %8.2f -> %8.2f%n",
            p.name(), p.price(),
            discounts.getOrDefault(p.category(), UnaryOperator.identity())
                     .apply(p.price())));

        // Constructor references + collecting
        Map<String, List<String>> byCategory = catalog.stream()
            .collect(Collectors.groupingBy(Product::category,
                     Collectors.mapping(Product::name, Collectors.toList())));
        System.out.println(byCategory);
    }

    static void print(String label, List<Product> items, Predicate<Product> filter) {
        System.out.println(label + ": " +
            items.stream().filter(filter).map(Product::name).toList());
    }
}
```

---

## 🧠 Rapid-fire recall

1. What makes an interface functional, and what doesn't count toward the "one abstract method"?
2. Name the six core functional interfaces and what each takes and returns.
3. What's the difference between `f.andThen(g)` and `f.compose(g)`?
4. Why do `IntPredicate` and `ToIntFunction` exist alongside `Predicate<Integer>`?
5. Explain the difference between `s::length` and `String::length`.
6. What does `Employee::new` produce, and what determines which constructor it targets?
7. Why can't you throw a checked exception from a standard `Consumer` lambda, and what are two workarounds?

<details>
<summary>Answers</summary>

1. Exactly one abstract method. `default` methods, `static` methods, and methods inherited from `Object` (like `equals`) don't count.
2. `Supplier` (nothing→T), `Consumer` (T→nothing), `Function` (T→R), `Predicate` (T→boolean), `UnaryOperator` (T→T), `BinaryOperator` ((T,T)→T).
3. `andThen` runs `f` first then `g`; `compose` runs `g` first then `f`.
4. To avoid autoboxing every value — a significant cost when processing large volumes of primitives.
5. `s::length` is bound: it always calls `length()` on that specific `s`, so it's a `Supplier<Integer>`. `String::length` is unbound: the argument you pass becomes the receiver, so it's a `Function<String, Integer>`.
6. A constructor reference. The target functional interface's method signature determines which constructor overload is selected.
7. The standard interfaces don't declare `throws`. Wrap the call in try/catch inside the lambda, or define your own functional interface that declares the checked exception.

</details>
