# useState Hook

## What is `useState`?

`useState` is a **React Hook** that allows functional components to **store and manage state**.

Before hooks, only **class components** could have state. With `useState`, functional components can now:

* Store data
* Update UI dynamically
* React to user interactions

---

## Basic Syntax

```jsx
const [state, setState] = useState(initialValue);
```

**Explanation**

| Part           | Meaning                           |
| -------------- | --------------------------------- |
| `state`        | Current value of the state        |
| `setState`     | Function used to update the state |
| `initialValue` | Starting value of the state       |

---

## Example 1: Simple Counter

```jsx
import { useState } from "react";

function Counter() {
    const [count, setCount] = useState(0);

    return (
        <div>
            <p>Count: {count}</p>
            <button onClick={() => setCount(count + 1)}>
                Increment
            </button>
        </div>
    );
}
```

**What happens here?**

1. `count` starts at `0`.
2. When the button is clicked:

   * `setCount(count + 1)` runs.
   * React updates the state.
   * Component re-renders.
3. New value is displayed.

---

## Example 2: Text Input State

```jsx
import { useState } from "react";

function NameInput() {
    const [name, setName] = useState("");

    return (
        <div>
            <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
            />
            <p>Hello, {name}</p>
        </div>
    );
}
```

**Use case**

* Forms
* Search fields
* Controlled inputs

---

## Example 3: Boolean State (Toggle)

```jsx
import { useState } from "react";

function Toggle() {
    const [isOn, setIsOn] = useState(false);

    return (
        <div>
            <p>{isOn ? "ON" : "OFF"}</p>
            <button onClick={() => setIsOn(!isOn)}>
                Toggle
            </button>
        </div>
    );
}
```

**Common use cases**

* Dark mode
* Show/hide elements
* Dropdowns or modals

---

## Functional Updates (Important for Interviews)

When the new state depends on the **previous state**, use a function.

**Example**

```jsx
setCount(prevCount => prevCount + 1);
```

**Why?**

Because React state updates are **asynchronous** and may be **batched**.

**Example Problem**

```jsx
setCount(count + 1);
setCount(count + 1);
```

Expected: +2
Actual: +1 (because both use the same old value)

**Correct Approach**

```jsx
setCount(prev => prev + 1);
setCount(prev => prev + 1);
```

Now result: +2

---

## Example 4: Object State

```jsx
import { useState } from "react";

function UserProfile() {
    const [user, setUser] = useState({
        name: "Tejas",
        age: 25
    });

    const updateAge = () => {
        setUser({
            ...user,
            age: user.age + 1
        });
    };

    return (
        <div>
            <p>{user.name} is {user.age} years old</p>
            <button onClick={updateAge}>Increase Age</button>
        </div>
    );
}
```

### Key concept: State replacement

`useState` **does not merge objects automatically** like class components.

So you must use:

```jsx
{ ...user }
```

---

## Lazy Initialization (Performance Optimization)

If the initial state requires expensive computation, use a function.

**Example**

```jsx
const [value, setValue] = useState(() => {
    console.log("Expensive calculation");
    return computeInitialValue();
});
```

This function runs **only once** during the initial render.

---


## Key Characteristics of `useState` (Detailed)

### 1. State Updates Are Asynchronous

When you call a state setter (`setState`), React **does not update the state immediately**.
Instead, it **schedules** the update and applies it during the next render cycle.

**Example**

```jsx
import { useState } from "react";

function AsyncExample() {
    const [count, setCount] = useState(0);

    const handleClick = () => {
        setCount(count + 1);
        console.log(count); // still old value
    };

    return (
        <div>
            <p>Count: {count}</p>
            <button onClick={handleClick}>Increment</button>
        </div>
    );
}
```

**What happens step-by-step**

1. Initial render → `count = 0`
2. Button clicked
3. `setCount(1)` is scheduled
4. `console.log(count)` runs immediately → prints **0**
5. React re-renders
6. Now `count = 1` in UI

**Correct way if you need updated value**

Use `useEffect` or functional update.

```jsx
setCount(prev => {
    const newValue = prev + 1;
    console.log(newValue);
    return newValue;
});
```

---

### 2. State Updates Trigger Re-render

Whenever state changes, React:

1. Re-runs the component function
2. Compares new UI with previous UI
3. Updates only the necessary parts in the DOM

**Example**

```jsx
import { useState } from "react";

function ReRenderExample() {
    const [text, setText] = useState("Hello");

    console.log("Component re-rendered");

    return (
        <div>
            <p>{text}</p>
            <button onClick={() => setText("Hi")}>
                Change Text
            </button>
        </div>
    );
}
```

**What happens**

1. Initial render → console logs once
2. Click button
3. State changes from `"Hello"` → `"Hi"`
4. Component function runs again
5. Console logs again

This proves **state change = re-render**.

---

### 3. React Batches Multiple Updates

React groups multiple state updates into **one render** for better performance.

**Problem Example**

```jsx
import { useState } from "react";

function BatchingExample() {
    const [count, setCount] = useState(0);

    const handleClick = () => {
        setCount(count + 1);
        setCount(count + 1);
    };

    return (
        <div>
            <p>Count: {count}</p>
            <button onClick={handleClick}>Increase Twice</button>
        </div>
    );
}
```

**Expected (incorrect assumption)**

```
0 → 1 → 2
```

**Actual result**

```
0 → 1
```

**Why?**

Because both updates use the **same old value (0)**, and React batches them.

**Correct approach: Functional updates**

```jsx
const handleClick = () => {
    setCount(prev => prev + 1);
    setCount(prev => prev + 1);
};
```

**Now result**

```
0 → 2
```

**Because:**

1. First update: 0 → 1
2. Second update: 1 → 2


**Real-world example: Multiple form updates**

```jsx
setForm(prev => ({
    ...prev,
    firstName: "Tejas"
}));

setForm(prev => ({
    ...prev,
    lastName: "Nirala"
}));
```

Both updates will be **batched into one render**.

---

### 4. State Is Local to the Component

Each component instance has its **own independent state**.

**Example**

```jsx
import { useState } from "react";

function Counter() {
    const [count, setCount] = useState(0);

    return (
        <div>
            <p>Count: {count}</p>
            <button onClick={() => setCount(count + 1)}>
                Increment
            </button>
        </div>
    );
}

export default function App() {
    return (
        <div>
            <Counter />
            <Counter />
        </div>
    );
}
```

**What happens**

There are **two separate counters**:

```
Counter 1: 0 → 1 → 2
Counter 2: 0 → 1
```

They **do not affect each other**.

Each component instance:

* Has its own state
* Maintains its own lifecycle
* Re-renders independently


**When state is shared:**

State must be **lifted up** to a parent component.

```jsx
function Parent() {
    const [count, setCount] = useState(0);

    return (
        <>
            <Child count={count} setCount={setCount} />
            <Child count={count} setCount={setCount} />
        </>
    );
}
```

Now both children share the same state.

---

## Common Mistakes

### 1. Direct state mutation ❌

```jsx
user.age = 30;
setUser(user); // wrong
```

**Correct approach ✔**

```jsx
setUser({ ...user, age: 30 });
```

---

### 2. Forgetting functional updates

```jsx
setCount(count + 1);
setCount(count + 1); // wrong for multiple updates
```

---