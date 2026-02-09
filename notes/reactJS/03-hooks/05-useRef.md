# `useRef` Hook

## What is `useRef`?

`useRef` is a React Hook that provides a way to:

1. Store **mutable values** that persist across renders.
2. Access **DOM elements** directly.

Unlike `useState`:

* Updating a `ref` **does not trigger a re-render**.
* The value persists between renders.

---

## Basic Syntax

```jsx
const ref = useRef(initialValue);
```

---

## What does `useRef` return?

It returns an object:

```jsx
{
  current: initialValue;
}
```

You access or update the value using:

```jsx
ref.current
```

---

## Example 1: Storing a Mutable Value

```jsx
import { useRef } from "react";

function Counter() {
    const countRef = useRef(0);

    const increment = () => {
        countRef.current += 1;
        console.log(countRef.current);
    };

    return (
        <button onClick={increment}>
            Click
        </button>
    );
}
```

### Behavior

* `countRef.current` persists across renders.
* But UI does **not update** automatically.

Because:

* `useRef` does not trigger re-renders.

---

## `useRef` vs `useState` (Important Interview Topic)

| Feature                  | useState | useRef |
| ------------------------ | -------- | ------ |
| Causes re-render         | ✅ Yes    | ❌ No   |
| Stores persistent values | ✅ Yes    | ✅ Yes  |
| Used for UI updates      | ✅ Yes    | ❌ No   |
| Used for DOM access      | ❌ No     | ✅ Yes  |

---

## Example 2: Accessing DOM Element

```jsx
import { useRef, useEffect } from "react";

function InputFocus() {
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current.focus();
    }, []);

    return <input ref={inputRef} />;
}
```

### What happens

1. Component mounts
2. `inputRef.current` points to input element
3. `focus()` is called
4. Input gets focus automatically

---

## Example 3: Tracking Previous State Value

```jsx
import { useState, useEffect, useRef } from "react";

function PreviousValueExample() {
    const [count, setCount] = useState(0);
    const prevCountRef = useRef();

    useEffect(() => {
        prevCountRef.current = count;
    }, [count]);

    return (
        <div>
            <p>Current: {count}</p>
            <p>Previous: {prevCountRef.current}</p>
            <button onClick={() => setCount(count + 1)}>
                Increment
            </button>
        </div>
    );
}
```

### Behavior

| Click   | Current | Previous  |
| ------- | ------- | --------- |
| Initial | 0       | undefined |
| 1       | 1       | 0         |
| 2       | 2       | 1         |

---

## Example 4: Preventing Re-renders (Performance)

```jsx
import { useRef, useState } from "react";

function RenderCounter() {
    const [count, setCount] = useState(0);
    const renderCount = useRef(0);

    renderCount.current++;

    return (
        <div>
            <p>Count: {count}</p>
            <p>Renders: {renderCount.current}</p>
            <button onClick={() => setCount(count + 1)}>
                Increment
            </button>
        </div>
    );
}
```

### What happens

* Every state update re-renders component
* `renderCount` persists across renders
* But changing `renderCount` does not trigger re-render

---

## Example 5: Storing Interval ID

```jsx
import { useRef, useState } from "react";

function Timer() {
    const intervalRef = useRef(null);
    const [count, setCount] = useState(0);

    const start = () => {
        intervalRef.current = setInterval(() => {
            setCount(c => c + 1);
        }, 1000);
    };

    const stop = () => {
        clearInterval(intervalRef.current);
    };

    return (
        <div>
            <p>{count}</p>
            <button onClick={start}>Start</button>
            <button onClick={stop}>Stop</button>
        </div>
    );
}
```

### Why use `useRef` here?

Because:

* Interval ID must persist
* But does not affect UI directly
* So no re-render needed

---

## Core Characteristics of `useRef`

### 1. Value persists across renders

```jsx
const ref = useRef(0);
```

Even after multiple renders:

```jsx
ref.current
```

keeps the latest value.

---

### 2. Updating `ref` does NOT re-render component

```jsx
ref.current = 10;
```

UI remains unchanged unless state changes.

---

### 3. Useful for storing DOM references

```jsx
<input ref={inputRef} />
```

---

## When to Use `useRef`

Use it when you need:

### 1. DOM access

* Focus input
* Scroll to element
* Measure size

---

### 2. Persistent values without re-render

* Timers
* Previous state
* Render counters
* External library instances

---

## When NOT to Use `useRef`

Avoid using it for:

* UI state
* Values that affect rendering

Bad example:

```jsx
const countRef = useRef(0);
countRef.current++;
```

UI won’t update.

Correct:

```jsx
const [count, setCount] = useState(0);
```

---

## Common Mistakes

---

### 1. Expecting re-render after updating ref

```jsx
ref.current = 5;
```

UI will not change.

---

### 2. Using ref instead of state

If UI depends on the value, use `useState`.

---

### 3. Accessing ref before mount

```jsx
console.log(inputRef.current); // null on first render
```

Correct approach:

Use inside `useEffect`.

---

## Mental Model

Think of `useRef` as:

> “A box that holds a value across renders, but React ignores it for rendering.”

---

## Interview-Ready Summary

**Definition:**

`useRef` is a React Hook used to store mutable values or DOM references that persist across renders without triggering re-renders.

**Key points to mention:**

* Returns `{ current: value }`.
* Value persists across renders.
* Updating it does not cause re-render.
* Used for DOM access and persistent variables.
* Can store previous state values.
