---
title: Arrays
author: Tejas Nirala
---

# Arrays

An array is a **fixed-size, ordered container of values of the same type**. It's the most primitive collection Java has, and everything else (`ArrayList`, `HashMap`, `String`) is built on top of arrays somewhere.

Coming from JavaScript, the two shocks are: **the size is fixed at creation**, and **the element type is fixed too**.

```javascript
// JavaScript
let a = [1, "two", true];   // any types
a.push(4);                  // grows freely
```

```java
// Java
int[] a = {1, 2, 3};        // int only
// a.push(4);               // ❌ no such thing — the size is 3, forever
```

---

## 1. Declaring and creating

```java
// Declaration only — `nums` is a reference holding null
int[] nums;

// Creation — allocates 5 slots on the heap
nums = new int[5];

// Both at once
int[] scores = new int[5];

// With values ("array initializer")
int[] ages = {25, 30, 35};
int[] ages2 = new int[]{25, 30, 35};   // needed when not on a declaration line
```

`int nums[]` also compiles (C-style), but `int[] nums` is the Java convention — the type of the variable is "array of int", so the brackets belong with the type.

### Every element gets a default

`new int[5]` isn't empty — it's five zeros:

```java
int[] a = new int[3];        // [0, 0, 0]
boolean[] b = new boolean[3];// [false, false, false]
String[] s = new String[3];  // [null, null, null]   ← references default to null!
```

That last one is why `s[0].length()` gives a `NullPointerException` on a freshly created `String[]`.

---

## 2. Reading and writing

```java
int[] nums = {10, 20, 30};

System.out.println(nums[0]);    // 10  — indices start at 0
nums[1] = 99;
System.out.println(nums[1]);    // 99
System.out.println(nums.length); // 3  — a FIELD, not a method (no parentheses)
```

> `array.length` (field) vs `string.length()` (method) vs `list.size()` (method). Java is inconsistent here and it trips up everyone at least once.

### Out of bounds is a runtime exception

```java
int[] nums = new int[3];
nums[3] = 1;    // 💥 ArrayIndexOutOfBoundsException: Index 3 out of bounds for length 3
```

Valid indices are always `0` to `length - 1`.

---

## 3. Iterating

```java
int[] nums = {10, 20, 30};

// Indexed — when you need the position
for (int i = 0; i < nums.length; i++) {
    System.out.println(i + ": " + nums[i]);
}

// Enhanced for — when you just want values
for (int n : nums) {
    System.out.println(n);
}

// Backwards
for (int i = nums.length - 1; i >= 0; i--) {
    System.out.println(nums[i]);
}
```

---

## 4. Arrays are objects — and that has consequences

An array variable holds a **reference** to a heap object. So:

```java
int[] a = {1, 2, 3};
int[] b = a;          // b points to the SAME array
b[0] = 99;
System.out.println(a[0]);   // 99  ← a changed too!
```

```
   STACK              HEAP
   a ●────┐
          ├──────▶  [99, 2, 3]
   b ●────┘
```

And printing one directly is useless:

```java
int[] a = {1, 2, 3};
System.out.println(a);              // [I@1b6d3586   ← type + hashcode, not contents
System.out.println(Arrays.toString(a));  // [1, 2, 3]  ✅
```

Same for equality:

```java
int[] x = {1, 2, 3};
int[] y = {1, 2, 3};
System.out.println(x == y);             // false — different objects
System.out.println(x.equals(y));        // false — Object.equals is reference equality
System.out.println(Arrays.equals(x, y)); // true  ✅
```

---

## 5. Copying an array

```java
int[] original = {1, 2, 3, 4, 5};

// 1. Arrays.copyOf — new array of a given length (pads with defaults, or truncates)
int[] copy1 = Arrays.copyOf(original, 5);        // [1, 2, 3, 4, 5]
int[] bigger = Arrays.copyOf(original, 7);       // [1, 2, 3, 4, 5, 0, 0]

// 2. Arrays.copyOfRange — a slice, [from, to)
int[] slice = Arrays.copyOfRange(original, 1, 4);  // [2, 3, 4]

// 3. System.arraycopy — fastest, copies into an existing array
int[] dest = new int[5];
System.arraycopy(original, 0, dest, 0, 5);

// 4. clone()
int[] copy2 = original.clone();
```

### Shallow vs deep copy

For an array of objects, all of these copy the **references**, not the objects:

```java
Person[] people = { new Person("A"), new Person("B") };
Person[] copy = people.clone();

copy[0].setName("Changed");
System.out.println(people[0].getName());   // "Changed" — same Person object!
```

To deep-copy, you must create new objects yourself.

---

## 6. The `Arrays` utility class

`java.util.Arrays` is where all the array helpers live.

| Method | What it does |
| :-- | :-- |
| `Arrays.toString(a)` | Readable string of a 1-D array |
| `Arrays.deepToString(a)` | Readable string of a nested array |
| `Arrays.sort(a)` | Sorts in place, ascending |
| `Arrays.sort(a, comparator)` | Sorts objects with a custom order |
| `Arrays.binarySearch(a, key)` | Index of `key` — array **must be sorted** |
| `Arrays.equals(a, b)` | Element-by-element comparison |
| `Arrays.deepEquals(a, b)` | Same, for nested arrays |
| `Arrays.fill(a, v)` | Sets every element to `v` |
| `Arrays.copyOf(a, n)` | Copy of length `n` |
| `Arrays.stream(a)` | Turn an array into a Stream |
| `Arrays.asList(a)` | Fixed-size `List` view of an array |

```java
import java.util.Arrays;

int[] nums = {5, 2, 8, 1, 9};

Arrays.sort(nums);
System.out.println(Arrays.toString(nums));       // [1, 2, 5, 8, 9]

System.out.println(Arrays.binarySearch(nums, 8)); // 3

int[] filled = new int[4];
Arrays.fill(filled, 7);
System.out.println(Arrays.toString(filled));      // [7, 7, 7, 7]

int sum = Arrays.stream(nums).sum();
System.out.println(sum);                          // 25
```

### Sorting in reverse

`Arrays.sort` can't reverse primitives directly (there's no comparator for `int[]`). Use the boxed type:

```java
Integer[] nums = {5, 2, 8, 1, 9};
Arrays.sort(nums, Collections.reverseOrder());
System.out.println(Arrays.toString(nums));   // [9, 8, 5, 2, 1]
```

---

## 7. Multi-dimensional arrays

A 2-D array in Java is really an **array of arrays**.

```java
int[][] grid = new int[3][4];      // 3 rows, 4 columns

int[][] matrix = {
    {1, 2, 3},
    {4, 5, 6},
    {7, 8, 9}
};

System.out.println(matrix[1][2]);        // 6   (row 1, column 2)
System.out.println(matrix.length);       // 3   (number of rows)
System.out.println(matrix[0].length);    // 3   (length of row 0)
```

Iterating:

```java
for (int i = 0; i < matrix.length; i++) {
    for (int j = 0; j < matrix[i].length; j++) {
        System.out.print(matrix[i][j] + " ");
    }
    System.out.println();
}

// Or with enhanced for:
for (int[] row : matrix) {
    for (int value : row) {
        System.out.print(value + " ");
    }
    System.out.println();
}

System.out.println(Arrays.deepToString(matrix));
// [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
```

### Jagged arrays

Because it's an array of arrays, rows can have different lengths:

```java
int[][] jagged = new int[3][];
jagged[0] = new int[] {1};
jagged[1] = new int[] {1, 2};
jagged[2] = new int[] {1, 2, 3};

System.out.println(Arrays.deepToString(jagged));
// [[1], [1, 2], [1, 2, 3]]
```

This is impossible in C-style rectangular arrays, and it's why `matrix[i].length` (per row) is the correct thing to write, not `matrix[0].length`.

---

## 8. Varargs — variable-length arguments

A method can accept "any number of" arguments. Under the hood, Java packs them into an array.

```java
static int sum(int... numbers) {     // `numbers` IS an int[]
    int total = 0;
    for (int n : numbers) total += n;
    return total;
}

sum();              // 0
sum(1, 2);          // 3
sum(1, 2, 3, 4, 5); // 15
sum(new int[]{1,2}); // 3  — you can pass an array directly
```

**Rules:**
- A method can have at most one varargs parameter.
- It must be the **last** parameter.

```java
static void log(String level, String... messages) { }   // ✅
static void bad(String... messages, String level) { }   // ❌ compile error
```

You've used this already: `System.out.printf`, `List.of`, `String.format` are all varargs.

---

## 9. Arrays vs `ArrayList` — when to use which

| | Array | `ArrayList` |
| :-- | :-- | :-- |
| Size | Fixed at creation | Grows and shrinks |
| Element type | Primitives **or** objects | Objects only (autoboxing for primitives) |
| Access by index | `a[i]` — O(1) | `list.get(i)` — O(1) |
| Add / remove | Not supported | `add()` / `remove()` |
| Length | `a.length` (field) | `list.size()` (method) |
| Memory | Compact, no boxing for primitives | Extra object overhead per element |
| Convenience methods | Only via `Arrays.*` | Rich API |

**Rule of thumb:** use an array when the size is genuinely fixed and you're storing primitives in a hot loop. Use `ArrayList` for essentially everything else. See [Lists](./25-lists.md).

Converting between them:

```java
// Array → List
String[] arr = {"a", "b", "c"};
List<String> fixed = Arrays.asList(arr);            // fixed-size VIEW, backed by arr
List<String> real  = new ArrayList<>(Arrays.asList(arr));  // independent, growable

// List → Array
List<String> list = List.of("a", "b", "c");
String[] back = list.toArray(new String[0]);
```

> ⚠️ `Arrays.asList(arr)` returns a *view*: `set()` writes through to the array, but `add()` and `remove()` throw `UnsupportedOperationException`.

---

## 10. Worked example

```java
import java.util.Arrays;

public class ArrayDemo {
    public static void main(String[] args) {
        int[] temps = {23, 19, 31, 27, 15, 29};

        // Basic stats the manual way
        int max = temps[0], min = temps[0], total = 0;
        for (int t : temps) {
            if (t > max) max = t;
            if (t < min) min = t;
            total += t;
        }
        System.out.println("Max: " + max);                       // 31
        System.out.println("Min: " + min);                       // 15
        System.out.println("Avg: " + (double) total / temps.length); // 24.0

        // The same, with the standard library
        System.out.println(Arrays.stream(temps).max().getAsInt()); // 31
        System.out.println(Arrays.stream(temps).average().getAsDouble()); // 24.0

        // Reverse in place
        for (int i = 0, j = temps.length - 1; i < j; i++, j--) {
            int tmp = temps[i];
            temps[i] = temps[j];
            temps[j] = tmp;
        }
        System.out.println(Arrays.toString(temps));  // [29, 15, 27, 31, 19, 23]

        // Sort a copy, leaving the original alone
        int[] sorted = temps.clone();
        Arrays.sort(sorted);
        System.out.println(Arrays.toString(sorted)); // [15, 19, 23, 27, 29, 31]
    }
}
```

---

## 🧠 Rapid-fire recall

1. What does `new String[3]` contain immediately after creation?
2. Why does `System.out.println(arr)` print something like `[I@1b6d3586`?
3. What's the difference between `arr.length`, `str.length()` and `list.size()`?
4. `int[] b = a; b[0] = 99;` — what happened to `a[0]`?
5. How do you compare two arrays by content?
6. What is a jagged array and why is it possible in Java?
7. Where must a varargs parameter appear in a method signature?

<details>
<summary>Answers</summary>

1. Three `null` references — object arrays default to `null`, not to empty strings.
2. `Object.toString()` prints type descriptor + identity hash code. Arrays don't override it. Use `Arrays.toString()`.
3. `length` is a public field on arrays; `length()` is a method on `String`; `size()` is a method on collections.
4. It's also `99` — both variables reference the same heap array.
5. `Arrays.equals(a, b)` for 1-D, `Arrays.deepEquals(a, b)` for nested.
6. A 2-D array whose rows have different lengths. It works because a 2-D array is really an array of independent row arrays.
7. Last, and there can be only one.

</details>
