# Interview Practice

### Why can’t we just use normal variables instead of States?

React components are just functions. Every render re-executes the function, so normal variables get reset, and React has no way of knowing they changed. State solves this by being managed outside the function and by explicitly notifying React when updates happen.

> Green flag: you said “functions” and “re-executes”.

If they push further: “What exactly happens when state changes?”

Say this (this is senior-level clarity):

“When state updates, React schedules a re-render, re-runs the component, diffs the new virtual DOM with the previous one, and updates only the parts of the real DOM that changed.”


### How do you handle server-side rendering versus client-side rendering in Next.js, and when do you choose which?

### How would you identify and fix slow components in a React app?

### What’s your favorite React hook and why is it useful?

### How do you measure which part of a React component is slow and optimize it?

### How would you handle global state management in React, and would that change in Next.js?

### What are Next.js API routes and server-side props, and how do they relate to state?

### How would you balance static generation, incremental static regeneration, and server-side rendering in a large Next.js site?

### How do you avoid unnecessary re-renders when passing props or functions?

### How do you handle forms and validation in a performant way?

### How do you set up internationalization in a Next.js app?

### How does React’s reconciliation rely on immutability, and why is it important to keep state immutable?

### What are closures in React, and how might they cause stale values in useEffect?

### What is React’s concurrent rendering and how does it improve UX?

### How would you optimize a large list of items in React for performance?

### When do you choose getStaticProps vs. getServerSideProps in Next.js, and how does it affect SEO?

### Could you walk me through how React’s **useTransition** hook works and when you’d use it in a real-world scenario?

### What are **React Suspense** and **React Lazy**, and how do they help with code-splitting in your application?

### In React, what is the **difference between state and props**, and how do they each affect re-rendering?

### Could you explain what a **controlled component** is in a React form and how it differs from an **uncontrolled component**?

### How would you approach **handling side effects in React**, and what are some common mistakes to avoid when using **useEffect**?
