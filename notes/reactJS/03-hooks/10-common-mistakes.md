---
title: Common Mistakes
---

## 1. Forgetting the Dependency Array

### Problem

```jsx
useEffect(() => {
  fetchData();
}); // No dependency array
```

### What actually happens (step-by-step)

1. Component renders.
2. `useEffect` runs.
3. `fetchData()` executes.
4. State updates (inside `fetchData`).
5. Component re-renders.
6. `useEffect` runs again.
7. Process repeats.

So the effect runs:

```text
Render → Effect → Render → Effect → Render → Effect...
```

Even if you didn’t intend it.

---

### Correct approach

```jsx
useEffect(() => {
  fetchData();
}, []);
```

### What happens now

1. Component renders.
2. Effect runs once.
3. `fetchData()` executes.
4. State updates.
5. Component re-renders.
6. Effect does **not** run again.

---

### When to use each form

| Dependency array | Behavior                  |
| ---------------- | ------------------------- |
| No array         | Runs after every render   |
| `[]`             | Runs once on mount        |
| `[value]`        | Runs when `value` changes |

---

## 2. Creating Infinite Loops

### Problem code

```jsx
const [data, setData] = useState([]);

useEffect(() => {
  setData([...data, "new item"]);
}, [data]);
```

---

### Step-by-step execution

#### Initial state

```text
data = []
```

---

#### First render

1. Component renders.
2. `useEffect` runs.
3. `setData(["new item"])`
4. State changes → re-render.

---

#### Second render

```text
data = ["new item"]
```

1. Effect runs again.
2. `setData(["new item", "new item"])`
3. Re-render again.

---

#### Third render

```text
data = ["new item", "new item"]
```

And so on…

This creates an **infinite loop**.

---

### Correct solution

```jsx
useEffect(() => {
  setData((prevData) => [...prevData, "new item"]);
}, []);
```

---

### Why this works

1. Effect runs once.
2. Functional update uses previous state.
3. No dependency on `data`.
4. No loop.

---

## 3. Not Cleaning Up Effects (Memory Leaks)

### Problem code

```jsx
useEffect(() => {
  const subscription = subscribeToData(handleData);
}, []);
```

---

### What happens

1. Component mounts.
2. Subscription starts.
3. Component unmounts.
4. Subscription still running.
5. It tries to update state.
6. React warns:

   ```
   Can't perform a React state update on an unmounted component
   ```

This is a **memory leak**.

---

### Correct approach

```jsx
useEffect(() => {
  const subscription = subscribeToData(handleData);

  return () => {
    subscription.unsubscribe();
  };
}, []);
```

---

### Step-by-step flow

#### On mount

1. Effect runs.
2. Subscription starts.

#### On unmount

1. Cleanup function runs.
2. Subscription stops.
3. No memory leak.

---

## 4. Using Stale Closures

This is one of the most common interview traps.

---

### Problem code

```jsx
const [count, setCount] = useState(0);

useEffect(() => {
  const id = setInterval(() => {
    setCount(count + 1);
  }, 1000);

  return () => clearInterval(id);
}, []);
```

---

### What is a stale closure?

The interval callback **captures the initial value** of `count`.

---

### Step-by-step execution

#### Initial render

```text
count = 0
```

Effect runs and creates interval:

```js
setCount(0 + 1);
```

---

#### After 1 second

```text
count becomes 1
```

---

#### After 2 seconds

Interval still uses:

```js
setCount(0 + 1);
```

So:

```text
count stays at 1 forever
```

Because the closure remembers:

```text
count = 0
```

---

### Correct solution: Functional update

```jsx
useEffect(() => {
  const id = setInterval(() => {
    setCount((prev) => prev + 1);
  }, 1000);

  return () => clearInterval(id);
}, []);
```

---

### Why this works

Instead of using the captured value:

```js
count + 1
```

It uses:

```js
prev + 1
```

Where `prev` is always the **latest state**.

---

## Visual Mental Model for Stale Closures

### Wrong approach

```text
Initial count = 0
Interval remembers: count = 0

Every second:
0 + 1 = 1
0 + 1 = 1
0 + 1 = 1
```

---

### Correct approach

```text
Initial count = 0

Every second:
prev = 0 → 1
prev = 1 → 2
prev = 2 → 3
prev = 3 → 4
```

---

## Summary Table of Mistakes

| Mistake                  | Problem                           | Solution                          |
| ------------------------ | --------------------------------- | --------------------------------- |
| Missing dependency array | Runs every render                 | Add `[]` or dependencies          |
| Infinite loop            | Effect updates its own dependency | Use functional update or fix deps |
| No cleanup               | Memory leaks                      | Return cleanup function           |
| Stale closure            | Old state used in effect          | Use functional updates            |

---

## Interview-Ready One-Liner Summary

> Most `useEffect` bugs happen due to incorrect dependencies, missing cleanup, or stale closures caused by how JavaScript closures capture values.
