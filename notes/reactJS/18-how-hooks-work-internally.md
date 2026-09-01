---
title: How Hooks Work Internally
author: Tejas Nirala
---

# How Hooks Work Internally

Hooks look like magic: a plain function call that somehow remembers a value across renders, per component instance. It isn't magic — it's an array (well, a linked list) and a cursor. Fifty lines of code will make the Rules of Hooks obvious rather than memorised.

---

## 1. The puzzle

```jsx
function Counter() {
  const [count, setCount] = useState(0);
  const [name, setName]   = useState('Ada');
  …
}
```

`useState` receives only `0`. It is not told:

- which component instance is calling it,
- which of the two `useState` calls it is,
- what value it returned last time.

Yet it returns the right value for the right instance every time. How?

**Answer:** React sets a module-level "currently rendering fiber" pointer before calling your component, and hooks read a linked list from that fiber, advancing a cursor with each call. **Position in the call order is the identity.**

---

## 2. Building it yourself

Here is a working miniature. Read it and the real thing stops being mysterious.

```js
let currentFiber = null;   // set by React before calling your component
let hookIndex = 0;         // the cursor, reset per render

function renderComponent(fiber, Component, props) {
  currentFiber = fiber;
  hookIndex = 0;                       // ← reset: hooks are read in order again
  fiber.hooks = fiber.hooks || [];     // persistent storage, per instance
  const output = Component(props);     // your function runs; hooks fire in order
  currentFiber = null;
  return output;
}

function useState(initial) {
  const fiber = currentFiber;
  const i = hookIndex++;               // ← claim this slot, advance the cursor

  if (fiber.hooks[i] === undefined) {  // first render: initialise
    fiber.hooks[i] = typeof initial === 'function' ? initial() : initial;
  }

  const setState = (action) => {
    fiber.hooks[i] = typeof action === 'function' ? action(fiber.hooks[i]) : action;
    scheduleRerender(fiber);
  };

  return [fiber.hooks[i], setState];
}

function useEffect(create, deps) {
  const fiber = currentFiber;
  const i = hookIndex++;
  const prev = fiber.hooks[i];

  const changed = !prev || !deps ||
    deps.length !== prev.deps.length ||
    deps.some((d, k) => !Object.is(d, prev.deps[k]));    // ← the dependency check

  if (changed) {
    fiber.pendingEffects.push({ create, cleanup: prev?.cleanup });
  }
  fiber.hooks[i] = { deps, cleanup: prev?.cleanup };
}

function useRef(initial) {
  const fiber = currentFiber;
  const i = hookIndex++;
  if (fiber.hooks[i] === undefined) fiber.hooks[i] = { current: initial };
  return fiber.hooks[i];               // ← the SAME object every render
}

function useMemo(factory, deps) {
  const fiber = currentFiber;
  const i = hookIndex++;
  const prev = fiber.hooks[i];
  if (prev && deps.every((d, k) => Object.is(d, prev.deps[k]))) return prev.value;
  const value = factory();
  fiber.hooks[i] = { value, deps };
  return value;
}

const useCallback = (fn, deps) => useMemo(() => fn, deps);   // literally this
```

That's the whole idea. React's real implementation uses a **linked list** rather than an array (cheaper to clone between the current and work-in-progress trees) and a "dispatcher" object that swaps implementations between mount and update, but the semantics are exactly the above.

---

## 3. The linked list on the fiber

```
Counter fiber
  memoizedState ──▶ ┌──────────────┐
                    │ hook 1       │  useState(0)
                    │ memoizedState: 0
                    │ queue: {pending: null}
                    │ next ────────┼──▶ ┌──────────────┐
                    └──────────────┘    │ hook 2       │  useState('Ada')
                                        │ memoizedState: 'Ada'
                                        │ next ────────┼──▶ ┌──────────────┐
                                        └──────────────┘    │ hook 3       │ useEffect
                                                            │ memoizedState: {deps, destroy}
                                                            │ next: null
                                                            └──────────────┘
```

On an update, React walks `current.memoizedState` and the new list side by side, cloning each node. Node #1 is matched with node #1, #2 with #2, and so on — **purely positionally**.

### The dispatcher

```js
// react/src/ReactHooks.js — simplified
function resolveDispatcher() {
  return ReactCurrentDispatcher.current;
}
export function useState(initial) {
  return resolveDispatcher().useState(initial);
}
```

`ReactCurrentDispatcher.current` is swapped by the renderer:

| Dispatcher | When | `useState` behaviour |
| :-- | :-- | :-- |
| `HooksDispatcherOnMount` | first render | create the hook node, store the initial value |
| `HooksDispatcherOnUpdate` | re-render | walk to the next existing node, process its update queue |
| `ContextOnlyDispatcher` | outside rendering | **throw** "Invalid hook call" |

That last row is why calling a hook in an event handler or at module scope gives that error: the dispatcher isn't a real one.

---

## 4. Why the Rules of Hooks exist

### Rule 1 — only call hooks at the top level

```jsx
function Bad({ showName }) {
  const [count, setCount] = useState(0);          // slot 0
  if (showName) {
    const [name, setName] = useState('Ada');      // slot 1 — CONDITIONALLY
  }
  useEffect(() => {…});                            // slot 1 or 2 ?!
}
```

**Trace:**

```
RENDER 1 (showName = true)
  slot 0 → useState(0)      → hooks[0] = 0
  slot 1 → useState('Ada')  → hooks[1] = 'Ada'
  slot 2 → useEffect        → hooks[2] = {deps, cleanup}

RENDER 2 (showName = false)
  slot 0 → useState(0)      → hooks[0] = 0        ✅
  slot 1 → useEffect        → reads hooks[1], which holds the STRING 'Ada'
                              and tries to treat it as an effect record  💥

React detects the count/type mismatch and throws:
  "Rendered fewer hooks than expected."
```

The same applies to loops, `return` before a hook, and `&&` short-circuits.

```jsx
// ❌ all of these break the positional invariant
if (x) useState(0);
for (const i of items) useState(i);
if (!user) return null;  useEffect(…);       // early return before a hook
x && useEffect(…);
```

The fix is always: **make the hook unconditional, and put the condition inside it.**

```jsx
useEffect(() => {
  if (!showName) return;          // ✅ condition INSIDE
  …
}, [showName]);

const [name, setName] = useState('Ada');     // ✅ always called; just ignore it when unused
```

### Rule 2 — only call hooks from React functions

Components and custom hooks only. Not event handlers, not plain utility functions, not class methods, not `setTimeout` callbacks. Outside a render, `ReactCurrentDispatcher.current` is the `ContextOnlyDispatcher`, which throws.

### The linter is not optional

```json
{ "plugins": ["react-hooks"],
  "rules": {
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn"
  } }
```

`rules-of-hooks` catches the positional violations statically. `exhaustive-deps` catches stale closures. Treat both as errors in a real codebase.

---

## 5. Why arrays and not names?

The React team considered a named API:

```jsx
const count = useState('count', 0);   // rejected
```

Reasons it lost: names collide when custom hooks compose, they can't be minified, they require a string on every call, and — critically — the positional model composes perfectly. A custom hook calling three hooks just consumes three consecutive slots; the caller neither knows nor cares.

```jsx
function Component() {
  const [a] = useState(1);        // slot 0
  const w = useWindowSize();      // slots 1, 2, 3 (its internal useState + useEffect + …)
  const [b] = useState(2);        // slot 4
}
```

The ordering constraint is the price of that composability.

---

## 6. The update queue

State updates aren't applied immediately — they're pushed onto a **circular linked list** on the hook, then processed during the next render.

```js
// dispatchSetState — simplified
function dispatchSetState(fiber, queue, action) {
  const update = { action, lane: requestUpdateLane(), next: null };

  // circular list: queue.pending always points at the LAST update,
  // and pending.next is the FIRST — so both ends are O(1)
  const pending = queue.pending;
  if (pending === null) update.next = update;
  else { update.next = pending.next; pending.next = update; }
  queue.pending = update;

  scheduleUpdateOnFiber(fiber, lane);
}
```

Then on the next render, `updateReducer` replays them:

```js
let newState = hook.baseState;
let update = first;
do {
  if (isSubsetOfLanes(renderLanes, update.lane)) {          // priority filtering!
    newState = typeof update.action === 'function'
      ? update.action(newState)                              // updater form
      : update.action;                                       // direct value
  } else {
    // not enough priority for this render — keep it for a later one
  }
  update = update.next;
} while (update !== first);
```

**This is the mechanism behind the `setCount(c => c + 1)` trace** from [State & useState](./08-state-and-usestate.md): each updater receives the accumulated `newState`, not your closure's stale variable. And the lane filter is how a low-priority update can be skipped in a high-priority render and applied later.

### The eager-state optimisation

If the queue is empty and the new state equals the current one, React computes it *in the setter* and skips scheduling entirely:

```jsx
const [n, setN] = useState(0);
setN(0);    // Object.is(0, 0) → no work scheduled at all, not even a render
```

---

## 7. Debugging with the model

```jsx
// "Rendered more hooks than during the previous render"
//   → a hook is behind a condition that became true

// "Rendered fewer hooks than expected"
//   → an early return skipped hooks, or a condition became false

// "Invalid hook call"
//   → called outside a component/custom hook, OR two copies of React are loaded
//     (check: npm ls react — duplicated react in node_modules is the usual cause)
```

Inspect the list in DevTools: select a component and the "hooks" panel shows them **in call order**, unnamed unless you use `useDebugValue` in a custom hook.

---

## 🧠 Rapid-fire recall

1. How does `useState` know which value belongs to which call?
2. Write the three lines that make `useRef` return a stable object.
3. Trace exactly what breaks when a `useState` sits inside an `if`.
4. What is the dispatcher, and why does calling a hook in an event handler throw?
5. Why is `useCallback(fn, deps)` equivalent to `useMemo(() => fn, deps)`?
6. Why does React store updates in a circular linked list rather than an array?
7. What does the lane check inside `updateReducer` make possible?

<details>
<summary>Answers</summary>

1. React sets a "currently rendering fiber" pointer and resets a cursor to 0 before calling your component; each hook call claims the next slot in that fiber's hook list. Identity is call order, not name.
2. `const i = hookIndex++; if (fiber.hooks[i] === undefined) fiber.hooks[i] = {current: initial}; return fiber.hooks[i];` — the same object is returned every render because it's only created once.
3. The slot indices shift between renders. A later hook reads the previous render's data for a different hook — e.g. an effect record slot now holding a string — so React throws "Rendered fewer/more hooks than expected".
4. An object holding the current hook implementations, swapped between mount, update and "not rendering". Outside a render the dispatcher is `ContextOnlyDispatcher`, whose methods throw "Invalid hook call".
5. `useMemo` caches the *result* of the factory. Returning `fn` from the factory caches the function itself, which is exactly what `useCallback` does.
6. `queue.pending` points at the last node and `pending.next` at the first, so appending and finding the head are both O(1) without maintaining two fields or resizing an array.
7. Priority-aware state: an update whose lane isn't included in the current render's lanes is skipped and preserved for a later, lower-priority render — the basis of transitions and interruptible rendering.

</details>
