# Props Drilling 
## What is Prop Drilling?

**Prop drilling** is a situation in React where:

> Data is passed from a parent component to deeply nested child components through multiple intermediate components that don’t actually need that data.

---

## Simple Definition (Interview Style)

> Prop drilling occurs when props are passed through several layers of components just to reach a deeply nested component.

---

## Analogy

Imagine you're in a multi-story building, and you have an important document that you need to get to a person on the top floor. However, you can only pass the document from one person to another on each floor until it reaches the top.

- **Ground Floor (App)**: You have the document.
- **First Floor (Parent)**: You pass the document to a person.
- **Second Floor (Child)**: The person from the first floor passes the document to another person.
- **Third Floor (Grandchild)**: The person from the second floor passes the document to yet another person.
- **Top Floor (UserProfile)**: Finally, the person on the top floor receives the document.

Problem with Props Drilling:

Every person (component) in between doesn't really need the document. They are just passing it along. This can become cumbersome and error-prone, especially if there are many floors (components).

---

## Basic Code Example of Prop Drilling

```jsx
function App() {
  const user = { name: "Tejas" };
  return <Parent user={user} />;
}

function Parent({ user }) {
  return <Child user={user} />;
}

function Child({ user }) {
  return <GrandChild user={user} />;
}

function GrandChild({ user }) {
  return <UserProfile user={user} />;
}

function UserProfile({ user }) {
  return <h1>Hello, {user.name}</h1>;
}
```

---

## Step-by-Step Flow

### Step 1: App has data

```js
user = { name: "Tejas" }
```

---

### Step 2: App passes it to Parent

```jsx
<Parent user={user} />
```

---

### Step 3: Parent passes to Child

```jsx
<Child user={user} />
```

---

### Step 4: Child passes to GrandChild

```jsx
<GrandChild user={user} />
```

---

### Step 5: GrandChild passes to UserProfile

```jsx
<UserProfile user={user} />
```

---

### Step 6: UserProfile uses it

```jsx
<h1>Hello, Tejas</h1>
```

---

## Why Prop Drilling is a Problem

---

### 1. Unnecessary complexity

Intermediate components:

* Don’t use the data
* Still must accept and pass it

---

### 2. Harder maintenance

If the prop name changes:

```jsx
user → currentUser
```

You must update:

* Parent
* Child
* GrandChild
* UserProfile

Even if they don’t use it.

---

### 3. Reduced component reusability

Example:

```jsx
function Child({ user }) { ... }
```

Now `Child`:

* Always expects `user`
* Even if it doesn’t use it

---

### 4. Increased risk of bugs

If one component forgets to pass the prop:

```jsx
function Child() {
  return <GrandChild />; // ❌ user missing
}
```

The data breaks.

---

## Visual Mental Model

### With prop drilling

```text
App
 └── Parent
      └── Child
           └── GrandChild
                └── UserProfile (uses data)
```

All components must pass the prop.

---

## How to Solve Prop Drilling

### Solution 1: React Context (Most common)

Instead of passing props manually:

* Store data in a **context**
* Any component can access it directly

---

### Same example using Context

```jsx
import { createContext, useContext } from "react";

const UserContext = createContext();

function App() {
  const user = { name: "Tejas" };

  return (
    <UserContext.Provider value={user}>
      <Parent />
    </UserContext.Provider>
  );
}

function Parent() {
  return <Child />;
}

function Child() {
  return <GrandChild />;
}

function GrandChild() {
  return <UserProfile />;
}

function UserProfile() {
  const user = useContext(UserContext);
  return <h1>Hello, {user.name}</h1>;
}
```

---

### What changed?

Only two components care about the data:

* `App` (provider)
* `UserProfile` (consumer)

All others are clean.

---

## Prop Drilling vs Context

| Feature                | Prop Drilling | Context      |
| ---------------------- | ------------- | ------------ |
| Passing through layers | Required      | Not required |
| Code complexity        | High          | Low          |
| Maintenance            | Harder        | Easier       |
| Reusability            | Lower         | Higher       |
| Ideal for global state | ❌ No          | ✅ Yes        |

---

## When Prop Drilling is OK

Prop drilling is **not always bad**.

It’s fine when:

* Component tree is shallow
* Only 1–2 levels deep
* Data is used by intermediate components

Example:

```jsx
App → Button
```

No need for context.

---

## When to Avoid Prop Drilling

Avoid it when:

* More than 3–4 levels deep
* Data is global (auth, theme, settings)
* Many components need the same data

---

## Other Alternatives to Prop Drilling

Besides Context:

### 1. State management libraries

* Redux
* Zustand
* Recoil
* Jotai

---

### 2. Component composition

Instead of passing data down:

```jsx
<Parent>
  <UserProfile user={user} />
</Parent>
```

---

## Interview-Ready Summary

**Definition:**

Prop drilling is the process of passing data through multiple intermediate components to reach a deeply nested component that actually needs it.

**Problems:**

* Increased complexity
* Harder maintenance
* Lower reusability

**Solutions:**

* React Context
* State management libraries
* Component composition

---

## One-line Mental Model

> Prop drilling = passing props through components that don’t need them.

