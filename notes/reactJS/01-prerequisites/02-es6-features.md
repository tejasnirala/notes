# ⚡ ES6+ JavaScript Features for React

## 📌 Overview

React code heavily uses modern JavaScript features (ES6 and beyond). Understanding these features is **essential** before learning React, as you'll encounter them in every React component.

> **💡 Why This Matters:** If you try to learn React without knowing ES6+, you'll be learning two things at once and struggling with both.

---

## 🎯 Features Covered

| Feature            | React Usage                         |
| ------------------ | ----------------------------------- |
| Arrow Functions    | Component functions, event handlers |
| Destructuring      | Props, state, hook returns          |
| Spread Operator    | Immutable state updates             |
| Template Literals  | Dynamic strings in JSX              |
| Modules            | Importing React and components      |
| let/const          | Variable declarations               |
| Default Parameters | Optional props                      |
| Object Shorthand   | Creating objects from variables     |

---

## 📦 1. `let` and `const` (Block-Scoped Variables)

**Always use `const` by default, `let` when you need to reassign.**

```javascript
// ❌ OLD - var (function-scoped, hoisted, avoid in modern JS)
var name = "John";

// ✅ NEW - const (block-scoped, cannot be reassigned)
const name = "John";
const user = { name: "John" }; // Object reference is constant
user.name = "Jane"; // ✅ OK - modifying object property

// ✅ NEW - let (block-scoped, can be reassigned)
let count = 0;
count = 1; // ✅ OK - reassigning
```

### In React:

```jsx
function Counter() {
  const [count, setCount] = useState(0); // const for state
  const handleClick = () => setCount(count + 1); // const for functions

  let message = ""; // let when value changes
  if (count > 10) {
    message = "High count!";
  }

  return <div>{message}</div>;
}
```

---

## ➡️ 2. Arrow Functions

Arrow functions provide a shorter syntax and lexically bind `this`.

### Basic Syntax

```javascript
// Traditional function
function add(a, b) {
  return a + b;
}

// Arrow function
const add = (a, b) => {
  return a + b;
};

// Shorthand (implicit return for single expression)
const add = (a, b) => a + b;

// Single parameter (parentheses optional)
const double = (n) => n * 2;

// No parameters
const sayHello = () => "Hello!";
```

### Returning Objects

```javascript
// ❌ WRONG - Looks like function body
const getUser = () => { name: "John", age: 25 };

// ✅ CORRECT - Wrap in parentheses
const getUser = () => ({ name: "John", age: 25 });
```

### In React:

```jsx
// Component as arrow function
const Greeting = (props) => {
  return <h1>Hello, {props.name}!</h1>;
};

// Shorthand with implicit return
const Greeting = ({ name }) => <h1>Hello, {name}!</h1>;

// Event handlers
<button onClick={() => setCount(count + 1)}>Click me</button>;

// Array mapping
{
  users.map((user) => <li key={user.id}>{user.name}</li>);
}
```

---

## 🎁 3. Destructuring

Extract values from objects and arrays into variables.

### Object Destructuring

```javascript
const user = {
  name: "John",
  age: 25,
  email: "john@example.com",
};

// ❌ OLD
const name = user.name;
const age = user.age;

// ✅ NEW - Destructuring
const { name, age } = user;

// Rename while destructuring
const { name: userName, age: userAge } = user;

// Default values
const { name, role = "guest" } = user; // role = "guest" if undefined

// Nested destructuring
const company = {
  name: "TechCorp",
  address: {
    city: "NYC",
    zip: "10001",
  },
};
const {
  address: { city },
} = company; // city = "NYC"
```

### Array Destructuring

```javascript
const colors = ["red", "green", "blue"];

// ❌ OLD
const first = colors[0];
const second = colors[1];

// ✅ NEW - Destructuring
const [first, second] = colors;

// Skip elements
const [, , third] = colors; // third = "blue"

// Default values
const [primary, secondary = "white"] = ["red"]; // secondary = "white"

// Swapping variables
let a = 1,
  b = 2;
[a, b] = [b, a]; // a = 2, b = 1
```

### In React:

```jsx
// Destructuring props
function UserCard({ name, age, email }) {
  return (
    <div>
      <h2>{name}</h2>
      <p>Age: {age}</p>
    </div>
  );
}

// Destructuring useState return
const [count, setCount] = useState(0);
const [user, setUser] = useState({ name: "", email: "" });

// Destructuring in function parameters
const handleSubmit = ({ target: { value } }) => {
  console.log(value); // Gets event.target.value directly
};
```

---

## 🌊 4. Spread Operator (`...`)

Expands arrays or objects into individual elements.

### Array Spread

```javascript
const arr1 = [1, 2, 3];
const arr2 = [4, 5, 6];

// Combine arrays
const combined = [...arr1, ...arr2]; // [1, 2, 3, 4, 5, 6]

// Copy array (shallow)
const copy = [...arr1];

// Add elements
const withNew = [...arr1, 4, 5]; // [1, 2, 3, 4, 5]
const withFirst = [0, ...arr1]; // [0, 1, 2, 3]
```

### Object Spread

```javascript
const user = { name: "John", age: 25 };

// Copy object
const userCopy = { ...user };

// Merge objects (later wins)
const updated = { ...user, age: 26 };
// { name: "John", age: 26 }

// Add properties
const withRole = { ...user, role: "admin" };
// { name: "John", age: 25, role: "admin" }
```

### In React (Immutable State Updates):

```jsx
// ❌ WRONG - Mutating state directly
const [user, setUser] = useState({ name: "John", age: 25 });
user.age = 26; // Never mutate!

// ✅ CORRECT - Create new object with spread
setUser({ ...user, age: 26 });

// Updating arrays
const [items, setItems] = useState([1, 2, 3]);

// Add item
setItems([...items, 4]);

// Remove item
setItems(items.filter((item) => item !== 2));

// Update specific item
setItems(items.map((item) => (item === 2 ? 20 : item)));
```

---

## 📝 5. Rest Parameters (`...`)

Collects remaining elements into an array (opposite of spread).

```javascript
// In function parameters
function sum(...numbers) {
  return numbers.reduce((a, b) => a + b, 0);
}
sum(1, 2, 3, 4); // 10

// In destructuring - collect "rest" of properties
const user = { name: "John", age: 25, email: "john@example.com" };
const { name, ...rest } = user;
// name = "John"
// rest = { age: 25, email: "john@example.com" }

// Array rest
const [first, ...others] = [1, 2, 3, 4];
// first = 1
// others = [2, 3, 4]
```

### In React:

```jsx
// Passing remaining props to child
function Button({ variant, ...rest }) {
  return <button className={variant} {...rest} />;
}

// Usage
<Button variant="primary" onClick={handleClick} disabled>
  Click me
</Button>;
// Button receives: variant="primary"
// ...rest passes: onClick, disabled, children to <button>
```

---

## 📜 6. Template Literals

String interpolation with backticks.

```javascript
const name = "John";
const age = 25;

// ❌ OLD - String concatenation
const message = "Hello, " + name + "! You are " + age + " years old.";

// ✅ NEW - Template literals
const message = `Hello, ${name}! You are ${age} years old.`;

// Multi-line strings
const html = `
    <div>
        <h1>${title}</h1>
        <p>${description}</p>
    </div>
`;

// Expressions inside
const price = `Total: $${(quantity * unitPrice).toFixed(2)}`;
```

### In React:

```jsx
// Dynamic className
<div className={`card ${isActive ? 'active' : ''}`}>

// Dynamic styles
<div style={{ width: `${percentage}%` }}>

// Template in JSX (rare, but valid)
{`Welcome, ${user.name}!`}
```

---

## 📦 7. Modules (import/export)

Organize code into separate files.

### Named Exports/Imports

```javascript
// math.js
export const add = (a, b) => a + b;
export const subtract = (a, b) => a - b;
export const PI = 3.14159;

// app.js
import { add, subtract } from "./math";
import { add as addition } from "./math"; // Rename
import * as math from "./math"; // Import all as object
math.add(1, 2);
```

### Default Export/Import

```javascript
// Button.js
const Button = ({ children, onClick }) => (
  <button onClick={onClick}>{children}</button>
);
export default Button;

// App.js
import Button from "./Button"; // No braces needed
import MyButton from "./Button"; // Can use any name
```

### Combining Both

```javascript
// utils.js
export const helper = () => {};
export default function mainFunction() {}

// app.js
import mainFunction, { helper } from "./utils";
```

### In React:

```jsx
// Importing React and hooks
import React, { useState, useEffect } from "react";

// Importing components
import Header from "./components/Header";
import { Card, Button } from "./components/ui";

// Exporting a component
export default function App() {
  return <div>Hello</div>;
}
```

---

## 🔧 8. Short-Circuit Evaluation

Using `&&` and `||` for conditional logic.

```javascript
// && - Returns second value if first is truthy
const message = isLoggedIn && "Welcome back!";

// || - Returns first truthy value (or last value)
const name = user.name || "Guest";

// Nullish coalescing (??) - Only for null/undefined
const count = data.count ?? 0; // Uses 0 only if count is null/undefined
// (0 || 10) = 10, but (0 ?? 10) = 0
```

### In React (Conditional Rendering):

```jsx
// Render only if condition is true
{
  isLoggedIn && <UserProfile />;
}

// Show default if value is null/undefined
<p>Hello, {name ?? "Guest"}!</p>;

// Ternary for if-else
{
  isLoading ? <Spinner /> : <Content />;
}
```

---

## 🎛️ 9. Object Property Shorthand

When variable name matches property name.

```javascript
const name = "John";
const age = 25;

// ❌ OLD
const user = { name: name, age: age };

// ✅ NEW
const user = { name, age };

// Method shorthand
const calculator = {
  // ❌ OLD
  add: function (a, b) {
    return a + b;
  },

  // ✅ NEW
  subtract(a, b) {
    return a - b;
  },
};
```

### In React:

```jsx
// Passing state as props
const [values, setValues] = useState({ name: "", email: "" });
return <Form values={values} setValues={setValues} />;

// Can be shortened to (if prop name matches variable):
// This doesn't save much, but you'll see this pattern in complex objects
```

---

## 🔁 10. Array Methods (Essential for React)

These methods are used constantly in React for rendering lists.

### `map()` - Transform each item

```javascript
const numbers = [1, 2, 3];
const doubled = numbers.map((n) => n * 2); // [2, 4, 6]
```

### In React:

```jsx
{
  users.map((user) => <UserCard key={user.id} user={user} />);
}
```

### `filter()` - Keep items that match condition

```javascript
const numbers = [1, 2, 3, 4, 5];
const evens = numbers.filter((n) => n % 2 === 0); // [2, 4]
```

### In React:

```jsx
{
  todos
    .filter((todo) => !todo.completed)
    .map((todo) => <TodoItem key={todo.id} todo={todo} />);
}
```

### `find()` - Get first matching item

```javascript
const users = [
  { id: 1, name: "John" },
  { id: 2, name: "Jane" },
];
const user = users.find((u) => u.id === 2); // { id: 2, name: 'Jane' }
```

### `reduce()` - Accumulate to single value

```javascript
const numbers = [1, 2, 3, 4];
const sum = numbers.reduce((acc, n) => acc + n, 0); // 10

// Grouping
const items = [
  { type: "a", val: 1 },
  { type: "b", val: 2 },
  { type: "a", val: 3 },
];
const grouped = items.reduce((acc, item) => {
  acc[item.type] = acc[item.type] || [];
  acc[item.type].push(item);
  return acc;
}, {});
// { a: [{...}, {...}], b: [{...}] }
```

### `some()` / `every()` - Check conditions

```javascript
const numbers = [1, 2, 3, 4, 5];
numbers.some((n) => n > 3); // true - at least one matches
numbers.every((n) => n > 0); // true - all match
```

---

## ✅ Summary Cheatsheet

```javascript
// Arrow function
const fn = (a, b) => a + b;

// Destructuring
const { name, age } = user;
const [first, second] = array;

// Spread
const newArr = [...arr1, ...arr2];
const newObj = { ...obj1, newProp: value };

// Rest
const { a, ...rest } = obj;

// Template literals
const str = `Hello, ${name}!`;

// Modules
import React, { useState } from "react";
export default Component;

// Short-circuit
{
  condition && <Component />;
}

// Array methods
array.map((item) => transform(item));
array.filter((item) => condition(item));
```

---

## 🚀 Next Steps

Now that you understand ES6+ JavaScript, continue with:

- [Promises & Async/Await](./03-async-javascript.md) - For data fetching
- [React Foundations](../02-foundations/index.md) - Start learning React!
