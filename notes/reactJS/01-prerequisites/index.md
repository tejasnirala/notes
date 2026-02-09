# 📋 Prerequisites for React.js

## 📌 Overview

Before diving into React, there are foundational concepts you need to master. This section covers the **essential JavaScript and web fundamentals** that React builds upon.

> **💡 Why Prerequisites Matter:** React is a JavaScript library. The better you understand JavaScript and how browsers work, the faster you'll master React.

---

## 🎯 Learning Objectives

After completing this section, you will understand:

- ✅ How the **DOM** works and how to manipulate it (to appreciate what React does for you)
- ✅ **ES6+ JavaScript features** used extensively in React
- ✅ **Asynchronous JavaScript** patterns for data fetching

---

## 📊 Skills Checklist

Before learning React, you should be comfortable with:

### JavaScript Fundamentals

- [ ] Variables (`let`, `const`)
- [ ] Functions and arrow functions
- [ ] Objects and arrays
- [ ] Array methods (`map`, `filter`, `reduce`, `find`)
- [ ] Destructuring (objects and arrays)
- [ ] Spread operator (`...`)
- [ ] Template literals
- [ ] Ternary operator
- [ ] Modules (`import`/`export`)

### Asynchronous JavaScript

- [ ] Callbacks
- [ ] Promises (`.then()`, `.catch()`)
- [ ] `async`/`await`
- [ ] `fetch` API

### Web Fundamentals

- [ ] HTML structure
- [ ] CSS basics
- [ ] How browsers render pages
- [ ] DOM structure and manipulation

---

## 📚 Topics in This Section

### 1. [DOM Manipulation](./01-dom-manipulation.md)

Master how browsers represent and modify web pages.

- What is the DOM?
- Selecting elements
- Modifying content and styles
- Event handling
- Event delegation


### 2. [ES6+ JavaScript Features](./02-es6-features.md) _(Essential for React)_

Modern JavaScript syntax used in every React app.

- Arrow functions
- Destructuring
- Spread/rest operators
- Template literals
- Modules
- Classes

### 3. [Promises & Async/Await](./03-async-javascript.md) _(Essential for Data Fetching)_

Asynchronous programming patterns.

- Understanding Promises
- `async`/`await` syntax
- Error handling
- Fetching data

---

## 🔗 How Prerequisites Connect to React

| Prerequisite          | React Concept It Enables                |
| --------------------- | --------------------------------------- |
| DOM Manipulation      | Understanding why Virtual DOM is better |
| Debouncing/Throttling | Optimizing input handlers, search       |
| Arrow Functions       | Component syntax, event handlers        |
| Destructuring         | Props, state, hook returns              |
| Spread Operator       | Immutable state updates                 |
| Promises/Async        | useEffect, data fetching                |
| Array Methods         | Rendering lists with `.map()`           |

---

## 🚀 Quick Self-Assessment

If you can understand this code, you're ready for React:

```javascript
// ES6+ features
const user = { name: "John", age: 25, role: "developer" };
const { name, ...rest } = user; // Destructuring & rest

// Arrow function
const greet = (name) => `Hello, ${name}!`;

// Array methods
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map((n) => n * 2);
const evens = numbers.filter((n) => n % 2 === 0);

// Async/await
const fetchUser = async (id) => {
  try {
    const response = await fetch(`/api/users/${id}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch user:", error);
  }
};

// Modules
import { useState, useEffect } from "react";
export default function MyComponent() {
  /* ... */
}
```

If any part of this looks unfamiliar, spend time on the prerequisite topics before continuing.

---

## ⏭️ What's Next?

Once you're comfortable with these prerequisites:

- **[React Foundations](../02-foundations/index.md)** - Start your React journey!
