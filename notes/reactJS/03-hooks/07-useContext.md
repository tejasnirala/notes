# `useContext` Hook

## What is `useContext`?

`useContext` is a React Hook that allows components to **access values from a Context** without passing props manually through every level.

It is mainly used for:

* Global state
* Shared configuration
* App-wide settings

### The Problem: Prop Drilling

Prop drilling happens when you pass props through multiple components that **don’t actually use them**.

#### Example without context

```jsx
function App() {
    return <Parent theme="dark" />;
}

function Parent({ theme }) {
    return <Child theme={theme} />;
}

function Child({ theme }) {
    return <GrandChild theme={theme} />;
}

function GrandChild({ theme }) {
    return <p>Theme: {theme}</p>;
}
```

Here:

* `Parent` and `Child` don’t use `theme`
* They only pass it down

This becomes messy in large apps.


### Solution: Context + useContext

Context allows you to:

* Store value at a higher level
* Access it directly in any nested component


## Basic Syntax

```jsx
const value = useContext(MyContext);
```

---

## The 3 Steps of Using Context

### Step 1: Create Context

```jsx
const ThemeContext = createContext(defaultValue);
```


### Step 2: Provide Context

```jsx
<ThemeContext.Provider value={someValue}>
    <ChildComponent />
</ThemeContext.Provider>
```


### Step 3: Consume Context

```jsx
const value = useContext(ThemeContext);
```

---

## Basic Example (Theme)

```jsx
import { createContext, useContext } from "react";

const ThemeContext = createContext("light");

function ThemedComponent() {
    const theme = useContext(ThemeContext);
    return <p>Current Theme: {theme}</p>;
}

function App() {
    return (
        <ThemeContext.Provider value="dark">
            <ThemedComponent />
        </ThemeContext.Provider>
    );
}
```

---

## Step-by-Step Flow of the Example

### Step 1: Context created

```js
ThemeContext = createContext("light");
```

Default value: `"light"`



### Step 2: Provider sets value

```jsx
<ThemeContext.Provider value="dark">
```

Now all children receive `"dark"`.



### Step 3: Component consumes context

```jsx
const theme = useContext(ThemeContext);
```

Value becomes:

```js
theme = "dark";
```



### Step 4: UI renders

```text
Current Theme: dark
```

---

## Important Rule

`useContext` only works if the component is:

* Inside the corresponding **Provider**

Otherwise, it uses the **default value**.

---

## Example: Without Provider

```jsx
const ThemeContext = createContext("light");

function App() {
    return <ThemedComponent />;
}
```

Result:

```text
Current Theme: light
```

Because:

* No Provider
* Default value used

---

## Real-world Example: Authentication Context

### Step 1: Create context

```jsx
const AuthContext = createContext(null);
```


### Step 2: Create provider

```jsx
function AuthProvider({ children }) {
    const user = { name: "Tejas" };

    return (
        <AuthContext.Provider value={user}>
            {children}
        </AuthContext.Provider>
    );
}
```


### Step 3: Use context

```jsx
function Profile() {
    const user = useContext(AuthContext);

    return <h1>Hello, {user.name}</h1>;
}
```


### Step 4: Wrap app

```jsx
function App() {
    return (
        <AuthProvider>
            <Profile />
        </AuthProvider>
    );
}
```

---

## Context with State (Very Common Pattern)

```jsx
import { createContext, useContext, useState } from "react";

const ThemeContext = createContext();

function ThemeProvider({ children }) {
    const [theme, setTheme] = useState("light");

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}
```


### Consuming the context

```jsx
function ToggleTheme() {
    const { theme, setTheme } = useContext(ThemeContext);

    return (
        <button onClick={() => setTheme("dark")}>
            Current: {theme}
        </button>
    );
}
```

---

## Flow with State + Context

1. `ThemeProvider` stores state
2. Provides `{ theme, setTheme }`
3. Child consumes it
4. Calls `setTheme`
5. Provider updates state
6. All consumers re-render

---

## useContext Lifecycle Behavior

When context value changes:

1. Provider updates value
2. All consuming components re-render
3. UI updates automatically

---

## When to Use `useContext`

Use it for:

* Themes (dark/light)
* Authentication
* Language settings
* User preferences
* Global UI state

---

## When NOT to Use `useContext`

Avoid for:

* Frequently changing state
* Large complex global state
* Performance-critical updates

In such cases, use:

* Redux
* Zustand
* Jotai
* Recoil

---

## `useContext` vs Prop Drilling

| Feature              | Prop Drilling | useContext |
| -------------------- | ------------- | ---------- |
| Deep component trees | ❌ Messy       | ✅ Clean    |
| Global state         | ❌ Hard        | ✅ Easy     |
| Reusability          | ❌ Low         | ✅ High     |
| Code readability     | ❌ Worse       | ✅ Better   |

---

## Common Mistakes

### 1. Using context outside provider

```jsx
const value = useContext(MyContext);
```

Without provider:

* Uses default value
* May cause bugs


### 2. Re-render performance issues

If provider value changes frequently:

```jsx
<Context.Provider value={{ count }}>
```

All consumers re-render.

Better:

```jsx
const value = useMemo(() => ({ count }), [count]);
```


### 3. Creating context inside component

Wrong:

```jsx
function App() {
    const MyContext = createContext();
}
```

Correct:

```jsx
const MyContext = createContext();
```

Outside component.

---

## Mental Model

Think of context as:

> A global data pipe available to all nested components.

Or:

> A shared storage that any child can access directly.

---

## Interview-Ready Summary

**Definition:**

`useContext` is a React Hook that allows components to access values from a Context, eliminating prop drilling and enabling global state sharing.

**Key points to mention:**

* Consumes context values.
* Works with `createContext` and `Provider`.
* Eliminates prop drilling.
* Used for global state like theme or auth.
* All consumers re-render when context value changes.
