# ⏳ Promises & Async/Await in JavaScript

## 📌 Overview

Asynchronous programming is how JavaScript handles operations that take time (like API calls, file reads, or timers). Understanding **Promises** and **async/await** is essential for React, especially for data fetching with `useEffect`.

> **💡 Why This Matters:** Every React app that fetches data, uses timers, or interacts with APIs needs asynchronous JavaScript.

---

## 🎯 What You'll Learn

- ✅ Why we need asynchronous programming
- ✅ How **Promises** work
- ✅ How **async/await** simplifies Promises
- ✅ **Error handling** patterns
- ✅ How these apply in **React**

---

## 🔄 Understanding Asynchronous Code

### The Problem: JavaScript is Single-Threaded

JavaScript runs on a single thread, meaning it can only do one thing at a time. If we had to wait for slow operations, the entire page would freeze.

```javascript
// Imagine if this blocked everything:
const data = fetchFromAPI(); // Takes 2 seconds
console.log(data); // Would have to wait 2 seconds!
// User can't click anything for 2 seconds 😱
```

### The Solution: Non-Blocking Code

Instead of waiting, JavaScript starts the operation, continues running other code, and handles the result when it's ready.

```javascript
// Start fetch, don't wait
fetch("/api/data").then((response) => {
  // This runs LATER when data arrives
  console.log(response);
});

console.log("This runs IMMEDIATELY, before the data arrives");
```

---

## 📝 Callbacks (The Old Way)

Before Promises, we used callbacks. You'll see this pattern in older code:

```javascript
function fetchData(callback) {
  setTimeout(() => {
    callback({ name: "John" });
  }, 1000);
}

// Usage
fetchData(function (data) {
  console.log(data.name);
});
```

### The Problem: Callback Hell

When operations depend on each other, callbacks nest deeply:

```javascript
// ❌ Callback Hell - Hard to read and maintain
fetchUser(function (user) {
  fetchPosts(user.id, function (posts) {
    fetchComments(posts[0].id, function (comments) {
      fetchReplies(comments[0].id, function (replies) {
        console.log(replies);
      });
    });
  });
});
```

---

## 🎁 Promises

**Promises** represent the eventual completion (or failure) of an asynchronous operation.

### Promise States

A Promise is always in one of three states:

```
┌─────────────┐
│   PENDING   │  ← Initial state, operation in progress
└──────┬──────┘
       │
       ▼
┌──────┴──────┐
│             │
▼             ▼
┌─────────┐  ┌──────────┐
│FULFILLED│  │ REJECTED │
│(success)│  │ (error)  │
└─────────┘  └──────────┘
```

### Creating a Promise

```javascript
const myPromise = new Promise((resolve, reject) => {
  // Async operation here
  const success = true;

  if (success) {
    resolve("Operation successful!"); // Fulfilled
  } else {
    reject("Operation failed!"); // Rejected
  }
});
```

### Consuming a Promise

```javascript
myPromise
  .then((result) => {
    console.log(result); // 'Operation successful!'
  })
  .catch((error) => {
    console.error(error); // 'Operation failed!'
  })
  .finally(() => {
    console.log("Cleanup here"); // Runs either way
  });
```

### Chaining Promises

Each `.then()` returns a new Promise, allowing chaining:

```javascript
fetch("/api/users")
  .then((response) => response.json()) // Returns new Promise
  .then((users) => users[0]) // Returns new Promise
  .then((user) => console.log(user.name)) // Final result
  .catch((error) => console.error(error)); // Catches any error in chain
```

### Solving Callback Hell

```javascript
// ✅ Promise chain - Much cleaner!
fetchUser()
  .then((user) => fetchPosts(user.id))
  .then((posts) => fetchComments(posts[0].id))
  .then((comments) => fetchReplies(comments[0].id))
  .then((replies) => console.log(replies))
  .catch((error) => console.error(error));
```

---

## ⚡ Async/Await

**async/await** is syntactic sugar over Promises, making asynchronous code look synchronous.

### Basic Syntax

```javascript
// Mark function as async
async function fetchData() {
  // await pauses execution until Promise resolves
  const response = await fetch("/api/data");
  const data = await response.json();
  return data;
}

// Arrow function version
const fetchData = async () => {
  const response = await fetch("/api/data");
  const data = await response.json();
  return data;
};
```

### Solving the Same Problem

```javascript
// ✅ Async/await - Reads like synchronous code!
async function getNestedData() {
  const user = await fetchUser();
  const posts = await fetchPosts(user.id);
  const comments = await fetchComments(posts[0].id);
  const replies = await fetchReplies(comments[0].id);
  console.log(replies);
}
```

### Important Rules

1. **`await` can only be used inside `async` functions**
2. **`async` functions always return a Promise**

```javascript
async function getValue() {
  return 42; // Automatically wrapped in a Promise
}

getValue().then((num) => console.log(num)); // 42
```

---

## ⚠️ Error Handling

### With Promises (.catch)

```javascript
fetch("/api/data")
  .then((response) => {
    if (!response.ok) {
      throw new Error("HTTP error!");
    }
    return response.json();
  })
  .then((data) => console.log(data))
  .catch((error) => console.error("Failed:", error));
```

### With Async/Await (try/catch)

```javascript
async function fetchData() {
  try {
    const response = await fetch("/api/data");

    if (!response.ok) {
      throw new Error("HTTP error!");
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed:", error);
    throw error; // Re-throw if you want caller to handle it
  }
}
```

### Pattern: Return Object with Status

```javascript
async function fetchData() {
  try {
    const response = await fetch("/api/data");
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Usage
const result = await fetchData();
if (result.success) {
  console.log(result.data);
} else {
  console.error(result.error);
}
```

---

## 🚀 Parallel vs Sequential Execution

### Sequential (One after another)

```javascript
// Slow - each waits for the previous
async function fetchAll() {
  const users = await fetchUsers(); // Wait...
  const posts = await fetchPosts(); // Then wait...
  const comments = await fetchComments(); // Then wait...
  return { users, posts, comments };
}
// Total time = users + posts + comments
```

### Parallel (All at once)

```javascript
// Fast - all start simultaneously
async function fetchAll() {
  const [users, posts, comments] = await Promise.all([
    fetchUsers(),
    fetchPosts(),
    fetchComments(),
  ]);
  return { users, posts, comments };
}
// Total time = max(users, posts, comments)
```

### Promise.all vs Promise.allSettled

```javascript
// Promise.all - Fails if ANY promise fails
try {
  const results = await Promise.all([p1, p2, p3]);
} catch (error) {
  // Any failure reaches here
}

// Promise.allSettled - Gets all results, success or failure
const results = await Promise.allSettled([p1, p2, p3]);
// results = [
//   { status: 'fulfilled', value: ... },
//   { status: 'rejected', reason: ... },
//   { status: 'fulfilled', value: ... }
// ]
```

---

## 🔥 The Fetch API

The `fetch()` function is the modern way to make HTTP requests.

### Basic GET Request

```javascript
const response = await fetch("/api/users");
const data = await response.json();
```

### POST Request

```javascript
const response = await fetch("/api/users", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "John",
    email: "john@example.com",
  }),
});
const newUser = await response.json();
```

### Full Example with Error Handling

```javascript
async function createUser(userData) {
  try {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(userData),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to create user:", error);
    throw error;
  }
}
```

---

## ⚛️ Async/Await in React

### Data Fetching with useEffect

```jsx
import { useState, useEffect } from "react";

function UserList() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Define async function inside useEffect
    const fetchUsers = async () => {
      try {
        const response = await fetch("/api/users");
        if (!response.ok) throw new Error("Failed to fetch");
        const data = await response.json();
        setUsers(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers(); // Call the async function
  }, []); // Empty array = run once on mount

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

### Why Can't useEffect Callback Be Async?

```jsx
// ❌ WRONG - useEffect callback can't be async
useEffect(async () => {
  const data = await fetch("/api/data");
  // This returns a Promise, but useEffect expects undefined or cleanup function
}, []);

// ✅ CORRECT - Define async function inside and call it
useEffect(() => {
  const fetchData = async () => {
    const data = await fetch("/api/data");
  };
  fetchData();
}, []);
```

### Race Condition Prevention

What if the component unmounts before the fetch completes?

```jsx
useEffect(() => {
  let isMounted = true; // Flag to track mount state

  const fetchData = async () => {
    const response = await fetch("/api/data");
    const data = await response.json();

    if (isMounted) {
      // Only update if still mounted
      setData(data);
    }
  };

  fetchData();

  return () => {
    isMounted = false; // Cleanup sets flag to false
  };
}, []);
```

### Using AbortController (Better Approach)

```jsx
useEffect(() => {
  const abortController = new AbortController();

  const fetchData = async () => {
    try {
      const response = await fetch("/api/data", {
        signal: abortController.signal,
      });
      const data = await response.json();
      setData(data);
    } catch (error) {
      if (error.name !== "AbortError") {
        setError(error.message);
      }
    }
  };

  fetchData();

  return () => {
    abortController.abort(); // Cancel the request on cleanup
  };
}, []);
```

---

## ✅ Summary Cheatsheet

```javascript
// Promise creation
const promise = new Promise((resolve, reject) => {});

// Promise consumption
promise
  .then((result) => {})
  .catch((error) => {})
  .finally(() => {});

// Async function declaration
async function name() {}
const name = async () => {};

// Await usage (inside async functions only)
const result = await promise;

// Error handling
try {
  const data = await fetchData();
} catch (error) {
  console.error(error);
}

// Parallel execution
const [a, b, c] = await Promise.all([p1, p2, p3]);

// React pattern
useEffect(() => {
  const fetchData = async () => {
    const data = await fetch("/api");
  };
  fetchData();
}, []);
```

---

## 🚀 Next Steps

Now you're ready to:

- [React Foundations](../02-foundations/index.md) - Start learning React
- [React Hooks - useEffect](../03-hooks/02-useEffect.md) - Apply these patterns in React
