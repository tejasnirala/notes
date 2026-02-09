# `useCallback` Hook

## What is `useCallback`?

`useCallback` is a React Hook that **memoizes a function**.

It ensures that a function:

* Is **not recreated on every render**
* Keeps the **same reference** unless dependencies change

---

## Why do we need `useCallback`?

In React:

* Every time a component re-renders,
* **All functions inside it are recreated**.

This can cause problems when:

* Passing functions to child components
* Using `React.memo`
* Using functions in dependency arrays

Because React compares **references**, not function content.

---

## Basic Syntax

```jsx
const memoizedFunction = useCallback(() => {
    // function logic
}, [dependencies]);
```

---

## Syntax Breakdown

| Part             | Meaning                             |
| ---------------- | ----------------------------------- |
| `useCallback()`  | React hook for memoizing functions  |
| Function inside  | The function you want to memoize    |
| Dependency array | Controls when function is recreated |

---

## Example 1: Basic Function Recreation

```jsx
function Parent() {
    const [count, setCount] = useState(0);

    const increment = () => {
        setCount(count + 1);
    };

    return <Child increment={increment} />;
}
```

### Problem

Every time `Parent` re-renders:

* `increment` function is recreated
* Child receives a new function reference
* Child re-renders unnecessarily

---

## Example 2: Using `useCallback`

```jsx
import { useState, useCallback } from "react";

function Parent() {
    const [count, setCount] = useState(0);

    const increment = useCallback(() => {
        setCount(prev => prev + 1);
    }, []);

    return <Child increment={increment} />;
}
```

Now:

* `increment` keeps the same reference
* Child does not re-render unnecessarily

---

## Example 3: With `React.memo` (Real Interview Scenario)

### Child Component

```jsx
import React from "react";

const Child = React.memo(({ increment }) => {
    console.log("Child re-rendered");
    return <button onClick={increment}>Increment</button>;
});

export default Child;
```

---

### Parent WITHOUT `useCallback`

```jsx
function Parent() {
    const [count, setCount] = useState(0);
    const [text, setText] = useState("");

    const increment = () => {
        setCount(c => c + 1);
    };

    return (
        <>
            <Child increment={increment} />
            <input
                value={text}
                onChange={(e) => setText(e.target.value)}
            />
        </>
    );
}
```

### Behavior

Typing in input:

* Parent re-renders
* `increment` recreated
* Child re-renders unnecessarily

Console:

```
Child re-rendered
Child re-rendered
Child re-rendered
```

---

### Parent WITH `useCallback`

```jsx
const increment = useCallback(() => {
    setCount(c => c + 1);
}, []);
```

Now:

Typing in input:

* Parent re-renders
* `increment` reference stays same
* Child does NOT re-render

Console:

```
Child re-rendered   (only once)
```

---

## Core Behavior of `useCallback`

| Dependency | Behavior                                |
| ---------- | --------------------------------------- |
| No array   | Function recreated every render         |
| `[]`       | Function created once                   |
| `[value]`  | Function recreated when `value` changes |

---

## Example 4: Function depending on state

```jsx
function Example() {
    const [count, setCount] = useState(0);

    const logCount = useCallback(() => {
        console.log(count);
    }, [count]);

    return (
        <button onClick={logCount}>
            Log Count
        </button>
    );
}
```

### Why `[count]` is needed?

Without it:

```jsx
useCallback(() => {
    console.log(count);
}, []); // ❌ stale value
```

The function would always log the **initial count**.

---

## `useCallback` vs Normal Function

### Without `useCallback`

```jsx
const handleClick = () => doSomething();
```

* New function every render

---

### With `useCallback`

```jsx
const handleClick = useCallback(() => doSomething(), []);
```

* Same function reference across renders

---

## `useCallback` vs `useMemo`

| Hook          | Memoizes | Returns            |
| ------------- | -------- | ------------------ |
| `useMemo`     | Value    | Computed result    |
| `useCallback` | Function | Function reference |

### Example

```jsx
const value = useMemo(() => compute(), [deps]);
const fn = useCallback(() => doSomething(), [deps]);
```

---

## Real-world Use Cases

Use `useCallback` when:

### 1. Passing callbacks to memoized child components

```jsx
<Child onClick={handleClick} />
```

---

### 2. Using functions in dependency arrays

```jsx
useEffect(() => {
    doSomething();
}, [doSomething]);
```

Without `useCallback`, this effect runs every render.

---

## Example 5: Preventing useEffect loops

```jsx
function Example() {
    const [count, setCount] = useState(0);

    const fetchData = useCallback(() => {
        console.log("Fetching data...");
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return <button onClick={() => setCount(c => c + 1)}>Click</button>;
}
```

Without `useCallback`:

* `fetchData` recreated every render
* Effect runs every render
* Possible infinite loop

---

## When NOT to Use `useCallback`

Avoid it when:

* Function is simple
* Not passed to children
* No performance issue exists

Example (unnecessary):

```jsx
const sayHello = useCallback(() => {
    console.log("Hello");
}, []);
```

---

## Common Mistakes

---

### 1. Missing dependencies

```jsx
useCallback(() => {
    console.log(count);
}, []); // ❌ count missing
```

Leads to stale state.

Correct:

```jsx
useCallback(() => {
    console.log(count);
}, [count]);
```

---

### 2. Overusing `useCallback`

Using it everywhere can:

* Increase memory usage
* Make code harder to read
* Provide no real benefit

---

### 3. Thinking it prevents re-renders

Important:

* `useCallback` does **not stop re-renders**
* It only keeps function references stable

---

## Mental Model

Think of `useCallback` as:

> “Keep this function the same unless its dependencies change.”

---

## Interview-Ready Summary

**Definition:**

`useCallback` is a React Hook that memoizes functions so they are not recreated on every render, improving performance in cases where referential equality matters.

**Key points to mention:**

* Memoizes functions, not values.
* Prevents unnecessary child re-renders.
* Useful with `React.memo`.
* Controlled by dependency array.
* Does not prevent parent re-renders.
