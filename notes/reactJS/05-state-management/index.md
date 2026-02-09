# 🗄️ State Management in React

## 📌 Overview

As React applications grow, managing state becomes increasingly complex. This section covers various **state management solutions** from React's built-in features to external libraries.

> **💡 The State Management Question:** Every React developer eventually asks, "How should I manage state in my application?" The answer depends on the size, complexity, and requirements of your project.

---

## 🎯 Learning Objectives

After completing this section, you will understand:

- ✅ Different **types of state** in React applications
- ✅ When to use **local state** vs **global state**
- ✅ How **Redux** works and when to use it
- ✅ How to choose the right state management solution

---

## 🧠 Understanding State Types

Before choosing a solution, understand what types of state exist:

| State Type          | Description                            | Examples                               | Solution                 |
| ------------------- | -------------------------------------- | -------------------------------------- | ------------------------ |
| **Local UI State**  | State used by one component            | Form inputs, toggles, modal open/close | `useState`               |
| **Shared State**    | State used by a few related components | Selected items, filters                | Lift state up / Context  |
| **Global UI State** | State used across the entire app       | Theme, language, sidebar state         | Context API              |
| **Server State**    | Data from external APIs                | User data, products, posts             | React Query / SWR        |
| **Form State**      | Complex form data and validation       | Multi-step forms, validation           | React Hook Form / Formik |
| **URL State**       | State reflected in the URL             | Current page, search params            | React Router             |

---

## 🔄 State Management Decision Tree

```
What kind of state are you managing?
│
├── Is it only needed by one component?
│   └── YES → useState
│
├── Is it needed by a few nearby components?
│   └── YES → Lift state up to common parent
│
├── Is it needed across many unrelated components?
│   ├── Is it simple (theme, auth, etc.)?
│   │   └── YES → Context API
│   └── Is it complex with many actions?
│       └── YES → Redux Toolkit / Zustand
│
├── Is it server data (API responses)?
│   └── YES → React Query / SWR
│
└── Is it complex form data?
    └── YES → React Hook Form / Formik
```

---

## 📚 Topics in This Section

### 1. [React Redux](./01-redux.md)

The most popular state management library for React.

- Core Redux concepts (Store, Actions, Reducers)
- Redux Toolkit (modern approach)
- useSelector and useDispatch hooks
- Best practices and file structure

---

## 🔜 Topics Coming Soon

These state management topics will be added:

| Topic                            | Description                             |
| -------------------------------- | --------------------------------------- |
| **Context API Deep Dive**        | Building scalable context-based state   |
| **Zustand**                      | Simple, fast state management           |
| **React Query / TanStack Query** | Server state management                 |
| **Jotai**                        | Primitive and flexible state management |
| **Recoil**                       | Experimental state management from Meta |

---

## 🆚 Quick Comparison

| Library       | Bundle Size    | Learning Curve | Best For                      |
| ------------- | -------------- | -------------- | ----------------------------- |
| Context API   | 0kb (built-in) | Low            | Simple global state           |
| Redux Toolkit | ~11kb          | Medium         | Large apps, predictable state |
| Zustand       | ~1kb           | Low            | Simple, fast global state     |
| React Query   | ~12kb          | Medium         | Server state, caching         |
| Jotai         | ~2kb           | Low            | Atomic state, flexibility     |

---

## 🚀 Prerequisites

Before diving into this section, make sure you understand:

- [React Foundations](../02-foundations/index.md) - Components, State, Props
- [React Hooks](../03-hooks/index.md) - Especially `useReducer` and `useContext`
- [Props Drilling](../04-advanced-guides/03-props-drilling.md) - The problem these tools solve

---

## 🔑 Key Takeaways

By the end of this section, you should be able to:

1. **Identify** which type of state you're dealing with
2. **Choose** the appropriate state management solution
3. **Implement** Redux Toolkit in a React application
4. **Evaluate** when you need a state management library
5. **Avoid** over-engineering state in simpler applications

---

## 💡 Pro Tip: Start Simple

Many React applications **don't need external state management libraries**. Start with:

1. `useState` for component-local state
2. Lift state up for nearby components
3. Context for truly global needs
4. Only add Redux/Zustand when Context becomes unwieldy

> "The best state management is the simplest one that solves your problem."
