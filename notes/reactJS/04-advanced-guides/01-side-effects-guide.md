# Side Effects in React

### **What Are Side Effects?**

In React, **side effects** are operations that interact with the **outside world** and are not part of the component's normal rendering process. They **do not return JSX** but instead affect something outside the component.

### **Examples of Side Effects**

- **Fetching data from an API** (`fetch`, `axios`)
- **Subscribing to events** (e.g., WebSocket, window event listeners)
- **Manipulating the DOM** (e.g., `document.title`, animations)
- **Setting up timers** (e.g., `setInterval`, `setTimeout`)
- **Logging to the console**

---

### **Managing Side Effects in React**

### **1. Using `useEffect` for Side Effects**

The `useEffect` hook is the primary way to handle side effects in functional components.

### **Basic Syntax**

```jsx
useEffect(() => {
    // Side effect logic (runs after render)
    return () => {
        // Cleanup logic (optional)
    };
}, [dependencies]);

```

### **Example 1: Fetching Data from an API**

```jsx
import { useState, useEffect } from "react";

function UsersList() {
    const [users, setUsers] = useState([]);

    useEffect(() => {
        fetch("https://jsonplaceholder.typicode.com/users")
            .then((response) => response.json())
            .then((data) => setUsers(data));

    }, []); // Empty dependency array → runs once after initial render

    return (
        <ul>
            {users.map((user) => (
                <li key={user.id}>{user.name}</li>
            ))}
        </ul>
    );
}

```

✅ Fetches data only **once** after the initial render.

---

### **2. Cleanup in `useEffect`**

Some side effects (like event listeners or timers) need cleanup to **prevent memory leaks**. The cleanup function runs when the component **unmounts** or **before re-running the effect**.

### **Example 2: Handling Timers with Cleanup**

```jsx
import { useState, useEffect } from "react";

function Timer() {
    const [count, setCount] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => setCount((c) => c + 1), 1000);

        return () => clearInterval(interval); // Cleanup on unmount
    }, []); // Runs only once

    return <p>Seconds: {count}</p>;
}

```

✅ Clears the interval when the component **unmounts**, preventing multiple timers from running.

---

### **3. Dependency Array in `useEffect`**

The **dependency array** controls when the effect runs:

| Dependency Array | Behavior |
| --- | --- |
| `[]` (empty) | Runs **only once** after the initial render. |
| `[state]` | Runs when `state` **changes**. |
| No dependency | Runs **on every render** (not recommended). |

### **Example 3: Running Effect on State Change**

```jsx
useEffect(() => {
    console.log("Count changed:", count);
}, [count]); // Runs whenever 'count' updates

```

✅ Effect runs **only when `count` changes**, avoiding unnecessary executions.

---

### **Other Ways to Handle Side Effects**

### **4. Using `useLayoutEffect` for DOM Mutations**

`useLayoutEffect` is like `useEffect` but runs **synchronously after DOM updates** (before the browser paints).

```jsx
import { useLayoutEffect, useState, useRef } from "react";

function LayoutExample() {
    const divRef = useRef(null);
    const [width, setWidth] = useState(0);

    useLayoutEffect(() => {
        setWidth(divRef.current.getBoundingClientRect().width);
    }, []);

    return <div ref={divRef}>Width: {width}px</div>;
}

```

✅ Use `useLayoutEffect` when updating the **DOM layout** before the browser renders.

---

### **Key Takeaways**

✔ **Side effects** are operations that **affect something outside React** (API calls, event listeners, timers).

✔ `useEffect` is the primary tool for handling side effects in functional components.

✔ **Cleanup functions** prevent memory leaks (e.g., clearing timers, unsubscribing).

✔ **Dependency array** controls when the effect runs (on mount, updates, or every render).

✔ **Use `useLayoutEffect`** when synchronizing DOM changes before browser repaint.

---
