# Wrapper Components

## What is a Wrapper Component?

A **Wrapper Component** is a component that:

* Surrounds or contains other components
* Provides **structure, layout, or logic**
* Ensures **consistent styling or behavior**

It acts like a **container** around other UI elements.

---

## Simple Definition (Interview Style)

> A wrapper component is a component that encapsulates other components to provide a common layout, styling, or behavior.

---

## Real-World Analogy

Think of a **photo frame**:

* The photo = child component
* The frame = wrapper component

Different photos can be placed inside the **same frame**.

---

## Why Use Wrapper Components?

They help to:

1. Maintain consistent layout
2. Reuse common styles
3. Encapsulate shared logic
4. Keep components clean and modular

---

## Basic Example (Using prop-based component injection)

### Approach 1: Passing component as prop

```jsx
function App() {
  return (
    <div>
      <CardWrapper innerComponent={<TextComponent />} />
      <CardWrapper innerComponent={<TextComponent2 />} />
    </div>
  );
}

function CardWrapper({ innerComponent }) {
  return (
    <div style={{ border: "2px solid black", padding: 20 }}>
      {innerComponent}
    </div>
  );
}

function TextComponent() {
  return <div>Hi there</div>;
}

function TextComponent2() {
  return <div>Hi there2</div>;
}
```

---

### How this works (step-by-step)

1. `App` renders `CardWrapper`
2. Passes component as prop
3. `CardWrapper` renders it inside styled div
4. UI shows wrapped content

---

### Problem with this approach

* Less flexible
* More verbose
* Not the React convention

---

## Preferred Approach: Using `children`

This is the **standard React pattern**.

---

### Cleaner version

```jsx
function App() {
  return (
    <div>
      <CardWrapper>
        <TextComponent />
      </CardWrapper>

      <CardWrapper>
        <div>Hi There 222222</div>
      </CardWrapper>
    </div>
  );
}

function CardWrapper({ children }) {
  return (
    <div style={{ border: "2px solid black", padding: 20 }}>
      {children}
    </div>
  );
}

function TextComponent() {
  return <div>Hi there</div>;
}

export default App;
```

---

## What is `children`?

`children` is a **special React prop** that represents:

> Whatever is written between a component’s opening and closing tags.

---

### Example

```jsx
<CardWrapper>
  <TextComponent />
</CardWrapper>
```

Inside `CardWrapper`:

```js
children = <TextComponent />
```

---

## Step-by-Step Execution

### Step 1: App renders

```jsx
<CardWrapper>
  <TextComponent />
</CardWrapper>
```

---

### Step 2: `CardWrapper` receives children

```js
children = <TextComponent />
```

---

### Step 3: Wrapper renders layout

```jsx
<div style={...}>
  {children}
</div>
```

---

### Step 4: Final UI

```html
<div style="border:2px solid black">
  <div>Hi there</div>
</div>
```

---

## Why `children` is Better (Interview Question)

| Prop-based wrapper           | `children` wrapper     |
| ---------------------------- | ---------------------- |
| Less flexible                | Very flexible          |
| Must pass component manually | Works with any JSX     |
| Verbose                      | Cleaner syntax         |
| Not idiomatic React          | Standard React pattern |

---

## Common Real-world Wrapper Components

---

### 1. Card Wrapper

```jsx
function Card({ children }) {
  return (
    <div className="card">
      {children}
    </div>
  );
}
```

Usage:

```jsx
<Card>
  <h2>Product</h2>
  <p>$20</p>
</Card>
```

---

### 2. Layout Wrapper

```jsx
function Layout({ children }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  );
}
```

---

### 3. Modal Wrapper

```jsx
function Modal({ children }) {
  return (
    <div className="overlay">
      <div className="modal">
        {children}
      </div>
    </div>
  );
}
```

---

## Wrapper Component with Logic

Wrapper components can also contain **behavior**, not just styling.

---

### Example: Authentication Wrapper

```jsx
function ProtectedRoute({ isLoggedIn, children }) {
  if (!isLoggedIn) {
    return <p>Please log in</p>;
  }

  return children;
}
```

Usage:

```jsx
<ProtectedRoute isLoggedIn={true}>
  <Dashboard />
</ProtectedRoute>
```

---

## Wrapper vs Higher-Order Component (HOC)

| Feature         | Wrapper Component | HOC                          |
| --------------- | ----------------- | ---------------------------- |
| Type            | Component         | Function returning component |
| JSX usage       | Yes               | No                           |
| Uses `children` | Yes               | Not required                 |
| Simpler         | Yes               | More abstract                |

---

## When to Use Wrapper Components

Use them when:

* You need consistent styling
* You want shared layout
* You want to encapsulate logic
* You want reusable UI patterns

---

## Common Mistakes

---

### 1. Not using `children` when appropriate

```jsx
<CardWrapper innerComponent={<Text />} /> // less ideal
```

Better:

```jsx
<CardWrapper>
  <Text />
</CardWrapper>
```

---

### 2. Over-wrapping components

Too many wrappers can:

* Increase DOM depth
* Hurt performance
* Make debugging harder

---

## Mental Model

Think of a wrapper component as:

> A reusable container that adds structure or behavior around its children.

---

## Interview-Ready Summary

**Definition:**

A wrapper component is a component that encapsulates other components to provide consistent layout, styling, or logic, typically using the `children` prop.

**Key points to mention:**

* Encapsulates child components.
* Uses `children` prop.
* Promotes reusability and consistency.
* Common for layouts, cards, modals, and protected routes.
