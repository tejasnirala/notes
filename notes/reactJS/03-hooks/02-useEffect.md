# `useEffect` Hook

## What is `useEffect`?

`useEffect` is a React Hook used to perform **side effects** in functional components.

### What are side effects?

Any operation that:

* Interacts with the outside world
* Happens **outside React’s rendering process**

### Common side effects

* API calls
* Timers
* Event listeners
* Subscriptions
* DOM manipulation
* Logging

---

## Basic Syntax

```jsx id="9yx9qg"
useEffect(() => {
    // Side effect logic

    return () => {
        // Cleanup logic (optional)
    };
}, [dependencies]);
```

---

## Syntax Breakdown

| Part             | Meaning                         |
| ---------------- | ------------------------------- |
| `useEffect()`    | Hook for side effects           |
| First argument   | Function containing side effect |
| Return function  | Cleanup logic                   |
| Dependency array | Controls when effect runs       |

---

## Example 1: Effect Running After Every Render

```jsx id="0rps2j"
import { useState, useEffect } from "react";

function Example() {
    const [count, setCount] = useState(0);

    useEffect(() => {
        console.log("Effect ran");
    });

    return (
        <button onClick={() => setCount(count + 1)}>
            Count: {count}
        </button>
    );
}
```

### Behavior

* Runs after **every render**
* Runs on:

  * Initial mount
  * Every state update

---

## Example 2: Effect Running Only Once (On Mount)

```jsx id="0as9jo"
useEffect(() => {
    console.log("Component mounted");
}, []);
```

### Why?

* Empty dependency array = `[]`
* No dependencies change
* So effect runs **only once**

### Common use cases

* Initial API call
* Setting up subscriptions
* Initializing libraries

---

## Example 3: Effect Running on Dependency Change

```jsx id="f7al1n"
import { useState, useEffect } from "react";

function CountLogger() {
    const [count, setCount] = useState(0);

    useEffect(() => {
        console.log("Count changed:", count);
    }, [count]);

    return (
        <button onClick={() => setCount(count + 1)}>
            {count}
        </button>
    );
}
```

### Behavior

Effect runs:

1. On initial mount
2. Whenever `count` changes

---

## Effect Lifecycle (Very Important for Interviews)

An effect has **three phases**:

### 1. Mount

Component appears for the first time.

```jsx id="m7tf8h"
useEffect(() => {
    console.log("Mounted");
}, []);
```

---

### 2. Update

Runs when dependencies change.

```jsx id="hsr7fo"
useEffect(() => {
    console.log("Updated");
}, [value]);
```

---

### 3. Unmount (Cleanup)

Runs when component is removed.

```jsx id="81g66p"
useEffect(() => {
    console.log("Mounted");

    return () => {
        console.log("Unmounted");
    };
}, []);
```

---

## Example 4: Timer with Cleanup

```jsx id="z3ow37"
import { useState, useEffect } from "react";

function Timer() {
    const [count, setCount] = useState(0);

    useEffect(() => {
        console.log("Effect started");

        const interval = setInterval(() => {
            setCount(c => c + 1);
        }, 1000);

        return () => {
            console.log("Cleanup running");
            clearInterval(interval);
        };
    }, []);

    return <h1>{count}</h1>;
}
```

### What happens

1. Component mounts
2. Effect runs → timer starts
3. Component unmounts
4. Cleanup runs → timer stops

Without cleanup:

* Timer keeps running
* Causes memory leaks

---

## Example 5: Data Fetching

```jsx id="1n6b2t"
import { useState, useEffect } from "react";

function Users() {
    const [users, setUsers] = useState([]);

    useEffect(() => {
        fetch("https://jsonplaceholder.typicode.com/users")
            .then(res => res.json())
            .then(data => setUsers(data));
    }, []);

    return (
        <ul>
            {users.map(user => (
                <li key={user.id}>{user.name}</li>
            ))}
        </ul>
    );
}
```

---

## Dependency Array Behavior (Core Interview Topic)

| Dependency Array | Behavior                     |
| ---------------- | ---------------------------- |
| No array         | Runs after every render      |
| `[]`             | Runs once on mount           |
| `[value]`        | Runs when `value` changes    |
| `[a, b]`         | Runs when `a` or `b` changes |

---

## Example: Multiple Dependencies

```jsx id="7n1h6x"
useEffect(() => {
    console.log("User or token changed");
}, [user, token]);
```

Effect runs when:

* `user` changes
* OR `token` changes

---

## Cleanup Function Behavior

Cleanup runs:

1. Before the effect runs again
2. On component unmount

### Example

```jsx id="39mnbk"
useEffect(() => {
    console.log("Effect started");

    return () => {
        console.log("Cleanup before next effect");
    };
}, [count]);
```

### Sequence when `count` changes

```id="4c6q2m"
1. Cleanup runs
2. Effect runs again
```

---

## Common Mistakes (Very Important)

---

### 1. Missing dependency

```jsx id="vt53i4"
useEffect(() => {
    console.log(count);
}, []); // ❌ count missing
```

This causes **stale values**.

Correct:

```jsx id="u3d6sv"
useEffect(() => {
    console.log(count);
}, [count]);
```

---

### 2. Infinite loop

```jsx id="1xj7ye"
useEffect(() => {
    setCount(count + 1);
}, [count]); // ❌ infinite loop
```

Why?

1. count changes
2. effect runs
3. count updates again
4. repeat forever

---

### 3. Not cleaning up subscriptions

```jsx id="g85p78"
useEffect(() => {
    window.addEventListener("resize", handleResize);
}, []);
```

Correct:

```jsx id="v95c9a"
useEffect(() => {
    window.addEventListener("resize", handleResize);

    return () => {
        window.removeEventListener("resize", handleResize);
    };
}, []);
```

---

## Mental Model (Simple Explanation)

Think of `useEffect` as:

> “Run this code **after React updates the UI**.”

---
