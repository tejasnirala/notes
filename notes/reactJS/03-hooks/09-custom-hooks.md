---
title: Custom Hooks
---

## What is a Custom Hook?

A **custom Hook** is simply:

> A JavaScript function that uses one or more React Hooks and starts with the word `use`.

It allows you to **extract reusable logic** from components and share it across your app.

---

## Why Do We Need Custom Hooks?

In real applications, components often contain:

* State logic
* Effects
* Event handlers
* API calls
* Subscriptions

This logic gets repeated across components.

### Problem without custom hooks

```jsx
function ComponentA() {
  const [width, setWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
}
```

Now imagine the same logic in:

* ComponentA
* ComponentB
* ComponentC

This leads to:

* Code duplication
* Harder maintenance
* Bugs in multiple places

---

## Solution: Custom Hook

Extract logic into a reusable function.

---

## Rules of Custom Hooks

Custom Hooks follow the **same rules as React Hooks**:

### 1. Must start with `use`

```jsx
function useSomething() {}
```

This allows React to:

* Detect Hooks
* Enforce rules automatically

---

### 2. Can only call Hooks at the top level

Wrong:

```jsx
if (condition) {
  useState(); // ❌
}
```

Correct:

```jsx
const value = useState();
```

---

### 3. Can only be used inside React components or other hooks

---

## Basic Custom Hook Example

### Custom Hook: `useWindowWidth`

```jsx
import { useState, useEffect } from "react";

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return width;
}
```

---

### Using the Custom Hook

```jsx
function ResponsiveComponent() {
  const width = useWindowWidth();

  return (
    <div>
      Window width: {width}px
      {width < 768 ? " (Mobile)" : " (Desktop)"}
    </div>
  );
}
```

---

## Step-by-Step Execution Flow

### Step 1: Component renders

```jsx
const width = useWindowWidth();
```

---

### Step 2: Hook initializes state

```jsx
width = window.innerWidth
```

---

### Step 3: `useEffect` runs

* Adds resize listener

---

### Step 4: User resizes window

```jsx
handleResize()
```

* Updates state
* Component re-renders

---

## Mental Model

Think of a custom hook as:

> A reusable logic container for state and effects.

Or:

> A function that **plugs behavior into components**.

---

## Example 2: Custom Hook for Data Fetching

### Hook

```jsx
import { useState, useEffect } from "react";

function useFetch(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchData() {
      try {
        const res = await fetch(url);
        const json = await res.json();

        if (isMounted) {
          setData(json);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err);
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [url]);

  return { data, loading, error };
}
```

---

### Using the Hook

```jsx
function Users() {
  const { data, loading, error } = useFetch(
    "https://jsonplaceholder.typicode.com/users"
  );

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error occurred</p>;

  return (
    <ul>
      {data.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

---

## Example 3: Custom Hook for Local Storage

```jsx
import { useState } from "react";

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : initialValue;
  });

  const setStoredValue = (newValue) => {
    setValue(newValue);
    localStorage.setItem(key, JSON.stringify(newValue));
  };

  return [value, setStoredValue];
}
```

---

### Usage

```jsx
function ThemeToggle() {
  const [theme, setTheme] = useLocalStorage("theme", "light");

  return (
    <button onClick={() => setTheme("dark")}>
      Current: {theme}
    </button>
  );
}
```

---

## Common Custom Hook Patterns

---

### 1. Data Fetching

```text
useFetch
useQuery
useApi
```

Handles:

* Loading
* Error
* Data

---

### 2. Form Management

```text
useForm
useInput
```

Handles:

* Field values
* Validation
* Submission

---

### 3. UI Behavior

```text
useToggle
useModal
useDebounce
```

---

### 4. Browser APIs

```text
useLocalStorage
useWindowSize
useMediaQuery
```

---

## Custom Hook vs Regular Function

| Feature                | Regular Function | Custom Hook |
| ---------------------- | ---------------- | ----------- |
| Can use Hooks          | ❌ No             | ✅ Yes       |
| Starts with `use`      | ❌ No             | ✅ Yes       |
| React lifecycle access | ❌ No             | ✅ Yes       |
| Manages state/effects  | ❌ No             | ✅ Yes       |

---

## When to Create a Custom Hook

Create one when:

1. Logic is repeated in multiple components
2. Component becomes too large
3. Logic is unrelated to UI
4. You want reusable behavior

---

## Common Mistakes

---

### 1. Not starting with `use`

```jsx
function windowWidth() {} // ❌
```

React won’t treat it as a hook.

---

### 2. Calling hooks conditionally

```jsx
if (condition) {
  useEffect(); // ❌
}
```

---

### 3. Treating custom hooks like components

Wrong:

```jsx
<useFetch /> // ❌
```

Correct:

```jsx
useFetch();
```

---

## Interview-Ready Summary

**Definition:**

A custom Hook is a reusable function that starts with `use` and allows you to extract and share stateful logic between components.

**Key points to mention:**

* Reusable stateful logic.
* Must follow Hook rules.
* Must start with `use`.
* Helps reduce duplication.
* Keeps components clean.

---

## One-line Mental Model

> Custom Hooks = reusable logic using React Hooks.
