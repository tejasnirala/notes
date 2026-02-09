---
title: useLayoutEffect
---

## What is `useLayoutEffect`?

`useLayoutEffect` is a React Hook that:

* Runs **synchronously**
* After the **DOM is updated**
* But **before the browser paints the screen**

It is mainly used for:

* DOM measurements
* Layout adjustments
* Preventing visual flickers

---

## Basic Syntax

```jsx
useLayoutEffect(() => {
    // DOM-related logic
}, [dependencies]);
```

---

## Key Difference: `useEffect` vs `useLayoutEffect`

Understanding this is crucial for interviews.

### React Rendering Timeline

When a component updates:

1. React renders component (virtual DOM)
2. React updates real DOM
3. useLayoutEffect runs (synchronously)
4. Browser paints UI
5. useEffect runs (asynchronously)

---

### Visual Timeline

| Step | What Happens             |
| ---- | ------------------------ |
| 1    | React calculates changes |
| 2    | DOM is updated           |
| 3    | `useLayoutEffect` runs   |
| 4    | Browser paints UI        |
| 5    | `useEffect` runs         |

---

## Why does this matter?

Because `useLayoutEffect` runs **before the user sees anything**.

So:

* Any DOM changes inside it
* Will not cause visual flicker

---

## Example 1: Measuring Element Width

```jsx
import { useLayoutEffect, useState, useRef } from "react";

function LayoutEffectExample() {
    const divRef = useRef(null);
    const [width, setWidth] = useState(0);

    useLayoutEffect(() => {
        setWidth(divRef.current.getBoundingClientRect().width);
    }, []);

    return <div ref={divRef}>Width: {width}px</div>;
}
```

---

### Step-by-step execution

#### Step 1: Initial render

```text
Width: 0px
```

DOM is created.

---

#### Step 2: DOM updated

The `<div>` exists in the DOM.

---

#### Step 3: `useLayoutEffect` runs (before paint)

```jsx
setWidth(divRef.current.getBoundingClientRect().width);
```

Suppose width = `200px`.

---

#### Step 4: State updated synchronously

React updates state **before paint**.

---

#### Step 5: Browser paints UI

User sees:

```text
Width: 200px
```

**No flicker**.

---

## Same Example with `useEffect` (Problem)

```jsx
useEffect(() => {
    setWidth(divRef.current.getBoundingClientRect().width);
}, []);
```

### What happens

1. UI paints:

```text
Width: 0px
```

2. `useEffect` runs
3. State updates
4. Re-render
5. UI becomes:

```text
Width: 200px
```

User briefly sees:

```
Width: 0px → Width: 200px
```

This is called **layout flicker**.

---

## Example 2: Preventing Layout Jump

Imagine positioning a tooltip.

```jsx
import { useLayoutEffect, useRef, useState } from "react";

function Tooltip() {
    const ref = useRef(null);
    const [position, setPosition] = useState(0);

    useLayoutEffect(() => {
        const rect = ref.current.getBoundingClientRect();
        setPosition(rect.top - 30);
    }, []);

    return (
        <div
            ref={ref}
            style={{ position: "absolute", top: position }}
        >
            Tooltip
        </div>
    );
}
```

### Why `useLayoutEffect`?

Without it:

* Tooltip first renders at wrong position
* Then jumps to correct position

With `useLayoutEffect`:

* Position calculated before paint
* No visible jump

---

## Core Characteristics of `useLayoutEffect`

---

### 1. Runs synchronously

Blocks browser paint until finished.

```jsx
useLayoutEffect(() => {
    console.log("Runs before paint");
}, []);
```

---

### 2. Runs after DOM updates

You can safely read:

* Element size
* Position
* Scroll values

---

### 3. Can cause performance issues

Because it blocks paint:

* Heavy logic can freeze UI
* Should be used carefully

---

## When to Use `useLayoutEffect`

Use it when:

### 1. Measuring DOM elements

```jsx
element.getBoundingClientRect();
```

---

### 2. Preventing layout flicker

* Tooltips
* Modals
* Animations
* Dynamic positioning

---

### 3. Syncing DOM before paint

* Scroll restoration
* Focus management
* CSS adjustments

---

## When NOT to Use It

Avoid for:

* API calls
* Logging
* Timers
* Subscriptions

Use `useEffect` instead.

---

## Performance Consideration (Important)

Because `useLayoutEffect`:

* Runs synchronously
* Blocks painting

Overusing it can:

* Slow down rendering
* Cause frame drops
* Hurt performance

Rule of thumb:

> Use `useEffect` by default.
> Use `useLayoutEffect` only when you must read or write layout before paint.

---

## `useEffect` vs `useLayoutEffect` Summary

| Feature                   | useEffect   | useLayoutEffect    |
| ------------------------- | ----------- | ------------------ |
| Runs before paint         | ❌ No        | ✅ Yes              |
| Runs after paint          | ✅ Yes       | ❌ No               |
| Blocks UI paint           | ❌ No        | ✅ Yes              |
| Used for API calls        | ✅ Yes       | ❌ No               |
| Used for DOM measurements | ❌ Not ideal | ✅ Yes              |
| Default choice            | ✅ Yes       | ❌ Only when needed |

---

## Common Mistakes

---

### 1. Using `useLayoutEffect` for API calls

```jsx
useLayoutEffect(() => {
    fetchData(); // ❌ wrong hook
}, []);
```

Correct:

```jsx
useEffect(() => {
    fetchData();
}, []);
```

---

### 2. Heavy computations inside `useLayoutEffect`

```jsx
useLayoutEffect(() => {
    heavyCalculation(); // ❌ blocks UI
}, []);
```

---

## Mental Model

Think of it like this:

### `useEffect`

> “Run this after the user sees the UI.”

### `useLayoutEffect`

> “Fix the layout before the user sees anything.”

---

## Interview-Ready Summary

**Definition:**

`useLayoutEffect` is a React Hook similar to `useEffect`, but it runs synchronously after DOM updates and before the browser paints the UI.

**Key points to mention:**

* Runs before paint.
* Used for DOM measurements and layout adjustments.
* Prevents flickering.
* Blocks rendering, so use carefully.
* Prefer `useEffect` unless layout sync is required.
