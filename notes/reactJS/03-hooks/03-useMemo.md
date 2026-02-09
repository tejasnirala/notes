# `useMemo` Hook

## What is `useMemo`?

`useMemo` is a React Hook that **memoizes** (caches) the result of a computation.

It ensures that an **expensive calculation is not re-executed on every render**, but only when its **dependencies change**.

---

## Why do we need `useMemo`?

In React:

* Every state or prop change causes a **re-render**.
* During each render, all calculations inside the component run again.

If a calculation is:

* Complex
* Slow
* Or unnecessary on every render

…it can hurt performance.

`useMemo` prevents this.

---

## Basic Syntax

```jsx
const memoizedValue = useMemo(() => {
    return computeValue();
}, [dependencies]);
```

---

## Syntax Breakdown

| Part             | Meaning                             |
| ---------------- | ----------------------------------- |
| `useMemo()`      | React hook for memoization          |
| Function inside  | Expensive calculation               |
| Return value     | Cached result                       |
| Dependency array | Controls when recalculation happens |

---

## Example 1: Basic Memoization

```jsx
import { useMemo } from "react";

function ExpensiveCalculation({ number }) {
    const squared = useMemo(() => {
        console.log("Computing...");
        return number * number;
    }, [number]);

    return <p>Square: {squared}</p>;
}
```

### Behavior

If parent re-renders:

* If `number` **does not change** → no recalculation
* If `number` **changes** → recalculates

---

## Example 2: Without `useMemo` (Problem)

```jsx
function ExpensiveCalculation({ number }) {
    const squared = (() => {
        console.log("Computing...");
        return number * number;
    })();

    return <p>Square: {squared}</p>;
}
```

Now:

* Every re-render prints `"Computing..."`
* Even if `number` didn’t change

---

## Example 3: Expensive Operation Simulation

```jsx
import { useState, useMemo } from "react";

function SlowComponent() {
    const [count, setCount] = useState(0);
    const [text, setText] = useState("");

    const expensiveValue = useMemo(() => {
        console.log("Expensive calculation running...");
        let total = 0;
        for (let i = 0; i < 1_000_000_000; i++) {
            total += i;
        }
        return total + count;
    }, [count]);

    return (
        <div>
            <p>Value: {expensiveValue}</p>

            <button onClick={() => setCount(count + 1)}>
                Increment Count
            </button>

            <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type something"
            />
        </div>
    );
}
```

### What happens

When typing in the input:

* Component re-renders
* But **expensive calculation does NOT run**
* Because `count` didn’t change

Without `useMemo`:

* Calculation would run on every keystroke
* UI would freeze

---

## Core Behavior of `useMemo`

| Dependency | Behavior                  |
| ---------- | ------------------------- |
| No array   | Recomputes every render   |
| `[]`       | Runs once on mount        |
| `[value]`  | Runs when `value` changes |

---

## Example 4: Derived Data (Real-world scenario)

Filtering a large list.

```jsx
import { useState, useMemo } from "react";

function UserList({ users }) {
    const [search, setSearch] = useState("");

    const filteredUsers = useMemo(() => {
        console.log("Filtering users...");
        return users.filter(user =>
            user.name.toLowerCase().includes(search.toLowerCase())
        );
    }, [users, search]);

    return (
        <div>
            <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users"
            />

            <ul>
                {filteredUsers.map(user => (
                    <li key={user.id}>{user.name}</li>
                ))}
            </ul>
        </div>
    );
}
```

### Why use `useMemo` here?

Without it:

* Filtering runs on every render
* Even when unrelated state changes

With it:

* Filtering only runs when:

  * `users` changes
  * OR `search` changes

---

## `useMemo` vs Normal Calculation

### Without `useMemo`

```jsx
const result = expensiveFunction(data);
```

Runs on **every render**.

---

### With `useMemo`

```jsx
const result = useMemo(() => expensiveFunction(data), [data]);
```

Runs only when **data changes**.

---

## Important Concept: Memoization

Memoization means:

> Storing the result of a computation and reusing it when inputs are the same.

---

## When to Use `useMemo`

Use it when:

* A calculation is expensive
* Derived data from props/state
* Large list filtering or sorting
* Complex mathematical operations

---

## When NOT to Use `useMemo`

Avoid it when:

* Calculation is cheap
* Code becomes harder to read
* No performance issue exists

Example (unnecessary):

```jsx
const value = useMemo(() => count + 1, [count]);
```

This is too simple to justify `useMemo`.

---

## `useMemo` vs `useCallback` (Interview Favorite)

| Hook          | Memoizes |
| ------------- | -------- |
| `useMemo`     | Value    |
| `useCallback` | Function |

### Example

```jsx
const memoizedValue = useMemo(() => compute(), [deps]);
const memoizedFunction = useCallback(() => doSomething(), [deps]);
```

---

## Common Mistakes

---

### 1. Missing dependencies

```jsx
useMemo(() => compute(value), []); // ❌ value missing
```

Leads to stale values.

Correct:

```jsx
useMemo(() => compute(value), [value]);
```

---

### 2. Overusing `useMemo`

Bad practice:

```jsx
const name = useMemo(() => "Tejas", []);
```

No need to memoize static values.

---

### 3. Thinking `useMemo` prevents re-renders

Important:

* `useMemo` does **not** stop re-renders.
* It only prevents recalculation.

---

## Interview-Level Explanation

**Definition:**

`useMemo` is a React Hook that memoizes the result of an expensive computation and recalculates it only when its dependencies change.

**Key points to mention:**

* Used for performance optimization.
* Prevents unnecessary recalculations.
* Controlled by dependency array.
* Memoizes values, not functions.
* Should be used only for expensive operations.

---

## Simple Mental Model

Think of `useMemo` as:

> “Only recalculate this value if its inputs change.”
