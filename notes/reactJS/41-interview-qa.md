---
title: Interview Questions & Answers
author: Tejas Nirala
---

# Interview Questions & Answers

Organised by the level they're usually asked at. Answers are written the way you'd actually say them out loud — a direct answer first, then the detail that shows you understand the mechanism.

---

## Fundamentals

<details>
<summary><b>What is React, and what problem does it solve?</b></summary>

A library for building UI as a function of state. The problem it solves is synchronisation: in imperative DOM code you maintain the transition between every pair of states by hand, which grows combinatorially. React lets you describe what the UI looks like for a given state and computes the DOM operations to get there. See [Why React Exists](./05-why-react-exists.md).
</details>

<details>
<summary><b>What is the Virtual DOM? Is it faster than the real DOM?</b></summary>

A tree of plain JavaScript objects (`{type, props, key}`) describing the intended UI. It is **not inherently faster** than direct DOM manipulation — hand-written minimal DOM updates will always beat it. Its value is that it makes *declarative* UI affordable: you re-describe the whole screen, and React diffs two cheap object trees to derive a minimal set of expensive DOM operations. The comparison is against "re-render everything with innerHTML", not against a perfect hand-optimised update.
</details>

<details>
<summary><b>Explain reconciliation.</b></summary>

The algorithm that diffs the new element tree against the previous fiber tree to decide what DOM operations to run. Optimal tree diffing is O(n³), so React uses two heuristics to get O(n): different element types produce entirely different trees (unmount and remount rather than diff across), and `key` identifies which children are the same logical item across renders. See [Reconciliation](./14-reconciliation-and-diffing.md).
</details>

<details>
<summary><b>Why do lists need keys? Why not the index?</b></summary>

Keys let React match children by identity instead of by position, so it can move existing instances rather than rewriting them. Index keys break when the list reorders or has insertions: the key moves with the position, so React reuses the fiber — and its state — for a different item. The classic symptom is a checked checkbox appearing on the wrong row. Index keys are only safe for a static, append-only list of stateless items. See [Lists & Keys](./10-lists-and-keys.md).
</details>

<details>
<summary><b>Props vs state?</b></summary>

Props are inputs passed by the parent — read-only from the component's perspective. State is data the component owns and can change, and changing it schedules a re-render. Both are immutable snapshots within a single render.
</details>

<details>
<summary><b>Controlled vs uncontrolled components?</b></summary>

Controlled: React state is the source of truth (`value` + `onChange`), so every keystroke re-renders and you get instant validation, formatting and conditional UI. Uncontrolled: the DOM holds the value and you read it via a ref when needed — fewer re-renders, and required for `<input type="file">`. See [Events & Forms](./09-events-and-forms.md).
</details>

---

## Hooks

<details>
<summary><b>Why can't hooks be called conditionally?</b></summary>

Hooks are stored as a linked list on the fiber and matched between renders **by call order**, not by name. React resets a cursor before each render and each hook call claims the next slot. A conditional hook shifts every later slot, so a `useEffect` might read a `useState`'s data. React detects the mismatch and throws "Rendered fewer hooks than expected". See [How Hooks Work](./18-how-hooks-work-internally.md).
</details>

<details>
<summary><b>Why does <code>setCount(count + 1)</code> three times only increment by one?</b></summary>

`count` is a `const` binding belonging to the current render. All three calls read the same stale value and queue "set to 1" three times. `setCount(c => c + 1)` queues updater functions instead, and React feeds each result into the next — 0→1→2→3. See [State & useState](./08-state-and-usestate.md).
</details>

<details>
<summary><b>What's a stale closure? Give an example and three fixes.</b></summary>

A function that captured an old render's variables and keeps reading them. Canonical example: `setInterval(() => setCount(count + 1), 1000)` with `[]` deps — the interval's callback closes over render 1's `count === 0` forever, so it computes 1 every tick and the counter freezes. Fixes: (1) the updater form so you never read the stale value; (2) add it to the dependency array, accepting the teardown/setup churn; (3) a ref updated on every render, for when you need the latest value without re-running expensive setup. See [Closures & Identity](./03-closures-and-identity.md).
</details>

<details>
<summary><b>useEffect vs useLayoutEffect?</b></summary>

`useLayoutEffect` runs synchronously after DOM mutations and **before** the browser paints, so it blocks the frame; `useEffect` runs asynchronously **after** paint. Use layout effects only when you must measure the DOM and mutate based on the measurement, and the intermediate state would be visible — positioning a tooltip, restoring scroll. Everything else is `useEffect`. See [useLayoutEffect](./20-useLayoutEffect-and-effect-timing.md).
</details>

<details>
<summary><b>What is the dependency array really for?</b></summary>

It's not a trigger configuration — it's a declaration of every reactive value the effect reads. React compares it with `Object.is` to decide whether the effect is still synchronised. Omitting a value doesn't "run it less"; it makes the effect read a stale one. If the correct array causes too many runs, restructure the code — depend on primitives, move the value inside the effect, or use a ref.
</details>

<details>
<summary><b>useMemo vs useCallback — and when are they useless?</b></summary>

`useMemo` caches a value; `useCallback` caches a function (`useCallback(fn, deps) === useMemo(() => fn, deps)`). Both are useless unless something downstream compares by reference — a `React.memo` child, a dependency array, or a context value — or the computation is genuinely expensive. Memoising a callback passed to a non-memoized child does nothing at all. See [useMemo & useCallback](./22-useMemo-and-useCallback.md).
</details>

<details>
<summary><b>useState vs useRef?</b></summary>

Both persist across renders. Changing state triggers a re-render and is read as an immutable snapshot; changing a ref does not re-render and is readable synchronously. If the value affects what's on screen, it's state; otherwise it's a ref.
</details>

<details>
<summary><b>When would you use useReducer over useState?</b></summary>

Three or more values that change together, transitions with real rules, next state depending on current state, or updates dispatched from many places. You also get a pure function that's testable without React, and a stable `dispatch` you can pass deep without causing re-renders.
</details>

---

## Rendering & performance

<details>
<summary><b>What causes a component to re-render?</b></summary>

Exactly four things: its own state changed; its parent re-rendered and it wasn't skipped; a context it consumes changed; or its `key` changed (which is a remount). Note that "props changed" is *not* on the list — a component with no props still re-renders when its parent does. See [What Causes Re-renders](./37-what-causes-rerenders.md).
</details>

<details>
<summary><b>How would you fix a slow page without reaching for React.memo?</b></summary>

Profile first. Then: move state down so fewer components re-render at all; pass expensive subtrees as `children` so their element references stay stable and React bails out; memoise unstable context values and split contexts by change frequency; virtualise long lists. `React.memo` comes after those, and only works if *every* prop is stable.
</details>

<details>
<summary><b>Why doesn't React.memo stop a re-render from a context change?</b></summary>

`memo` compares props. Context is a subscription registered on the fiber — when the provider value changes, React schedules an update directly on every consumer fiber, bypassing prop comparison entirely.
</details>

<details>
<summary><b>Explain React Fiber.</b></summary>

The reconciler architecture introduced in React 16. The component tree is represented as a linked list of fiber objects (`child`, `sibling`, `return`) walked by an explicit loop instead of recursion, so traversal state lives in a variable rather than the call stack. That makes rendering pausable, resumable and abandonable — the prerequisite for time slicing, transitions, Suspense and concurrent rendering. React keeps two trees (`current` and `workInProgress`) and commits by swapping a pointer. See [The Render Pipeline](./13-the-render-pipeline.md).
</details>

<details>
<summary><b>What is batching, and what changed in React 18?</b></summary>

Collecting multiple state updates and processing them in a single render/commit. Before 18, batching only applied inside React event handlers; updates in promises, timeouts and native handlers each caused their own render. React 18's `createRoot` batches everywhere ("automatic batching"). `flushSync` opts out when you need the DOM updated synchronously.
</details>

<details>
<summary><b>What does "concurrent React" actually mean?</b></summary>

Not multi-threading — JavaScript is still single-threaded. It means React can prepare multiple versions of the tree, doing render work in ~5ms slices and yielding to the browser between them, and can abandon an in-progress render when a higher-priority update arrives. Every update carries a *lane* (priority), and a keystroke pre-empts a background list render. Safe only because rendering is pure and uncommitted work can be thrown away. See [Concurrent React](./16-concurrent-react.md).
</details>

---

## Effects, data & architecture

<details>
<summary><b>Why does my effect run twice in development?</b></summary>

StrictMode deliberately mounts, unmounts and remounts each component to verify your cleanup is correct — it's simulating a future where React preserves state across remounts. If setup→cleanup→setup leaves the world as one setup would, you're fine. If not, you have a real leak. Never suppress it with a `useRef` "has it run" guard; either write the cleanup or move the code to an event handler because it's an action, not a synchronisation. See [StrictMode](./17-strict-mode.md).
</details>

<details>
<summary><b>How do you avoid a race condition when fetching in an effect?</b></summary>

Create an `AbortController`, pass its signal to `fetch`, and return `() => ac.abort()` as the cleanup. React runs the previous effect's cleanup before the next setup, so the stale request is cancelled before the new one starts. Without it, a slow request for the old id can resolve last and overwrite the correct data.
</details>

<details>
<summary><b>Which effects should you delete?</b></summary>

Effects that transform data for rendering (compute it during render instead), reset state when a prop changes (change the `key`), respond to a user action (put it in the handler), chain into each other (do it in one place), or initialise the app (module scope). Effects are for synchronising with systems *outside* React. See [useEffect](./19-useEffect.md).
</details>

<details>
<summary><b>Where should server data live?</b></summary>

In a cache, not in component state or a client store. It's someone else's state, and you need dedup, staleness, background refetch, retry and invalidation — that's React Query, SWR, RTK Query, or Server Components. Putting it in Redux by hand means re-implementing a cache badly.
</details>

<details>
<summary><b>Context vs Redux vs Zustand?</b></summary>

Context is a transport mechanism with no selectors — every consumer re-renders when the value changes, so it suits ambient, rarely-changing values (theme, session, locale). Zustand adds selective subscription in ~1KB, which is what most apps actually need. Redux Toolkit adds enforced structure, unmatched devtools and time travel, which pays off for large teams and complex flows. And none of them are the right home for server data.
</details>

<details>
<summary><b>What are error boundaries, and what don't they catch?</b></summary>

Class components implementing `getDerivedStateFromError`/`componentDidCatch` that catch errors thrown during rendering of their descendants and show a fallback. They don't catch errors in event handlers, async code, SSR, or the boundary itself. Without one, a render error unmounts the entire app. To route a handler error into one, store it in state and throw it during the next render.
</details>

---

## Modern React

<details>
<summary><b>What are Server Components?</b></summary>

Components that run only on the server. They can `await` data directly, access the database and filesystem, and ship **zero JavaScript** to the client — the client receives a serialised description of their output, not their code. They can't use state, effects or browser APIs; anything interactive must be a Client Component marked with `'use client'`. See the [Next.js section](/nextJS).
</details>

<details>
<summary><b>What's new in React 19?</b></summary>

Actions (`useActionState`, `useOptimistic`, `useFormStatus`, `<form action={fn}>`), the `use` hook for unwrapping promises and context conditionally, `ref` as a normal prop (no more `forwardRef`), document metadata hoisting (`<title>`, `<meta>` anywhere), resource preloading APIs, and the React Compiler for automatic memoisation.
</details>

<details>
<summary><b>What does the React Compiler do?</b></summary>

It analyses components at build time and inserts memoisation automatically, making most manual `useMemo`/`useCallback` unnecessary. It only applies where it can prove your code follows the Rules of React — pure renders, no mutation of props or state — and silently bails out where it can't, which its ESLint plugin reports.
</details>

<details>
<summary><b>Suspense — how does it work?</b></summary>

A component that isn't ready throws a promise (or `use()` reads a pending one). React catches it at the nearest `Suspense` boundary, renders the fallback, and retries the subtree when the promise settles. Wrapping a navigation in `startTransition` keeps the previously committed content on screen instead of flashing the fallback. Pair it with an error boundary *outside* to handle rejection.
</details>

---

## Practical / coding round

<details>
<summary><b>Implement a debounce hook.</b></summary>

```jsx
function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);      // each keystroke cancels the previous timer
  }, [value, delay]);
  return debounced;
}
```
The cleanup is the debounce: only the timer from the final keystroke survives to fire.
</details>

<details>
<summary><b>Implement usePrevious.</b></summary>

```jsx
function usePrevious(value) {
  const ref = useRef(undefined);
  useEffect(() => { ref.current = value; });   // runs AFTER the render reads it
  return ref.current;
}
```
</details>

<details>
<summary><b>Implement a data-fetching hook with loading, error and cancellation.</b></summary>

```jsx
function useFetch(url) {
  const [state, setState] = useState({ status: 'idle', data: null, error: null });

  useEffect(() => {
    if (!url) return;
    const ac = new AbortController();
    setState({ status: 'loading', data: null, error: null });

    fetch(url, { signal: ac.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => setState({ status: 'success', data, error: null }))
      .catch(error => {
        if (error.name === 'AbortError') return;
        setState({ status: 'error', data: null, error });
      });

    return () => ac.abort();
  }, [url]);

  return state;
}
```
Mention that in production you'd use React Query, because this has no cache, dedup, retry or invalidation.
</details>

<details>
<summary><b>Build an accessible modal.</b></summary>

Portal to `document.body` to escape `overflow:hidden` and stacking contexts; `role="dialog"` + `aria-modal="true"` + `aria-labelledby`; move focus in on open and **restore it to the trigger on close**; trap Tab within the dialog; Escape to close; lock body scroll; close on backdrop click with `stopPropagation` inside. Or use the native `<dialog>` with `showModal()`, which gives you the top layer, focus trap, inertness and Escape for free. See [Portals & Modals](./31-portals-and-modals.md).
</details>

<details>
<summary><b>How do you render 10,000 rows without freezing the page?</b></summary>

Virtualise — render only the visible window plus a small overscan, with a spacer element preserving the scroll height and `transform` positioning the rows. Fiber and DOM node counts drop from 10,000 to about 20. Combine with `React.memo` on the row, stable handlers, and a transition for the filter/sort update.
</details>

---

## Questions worth asking back

- What's your state management story, and how do you separate server cache from client state?
- Are you on the App Router / Server Components, and how has that gone?
- How do you measure performance — lab, field, or not at all?
- What does your testing pyramid actually look like in practice?
- Is the React Compiler enabled, and did it surface Rules-of-React violations?

These signal that you think about architecture, not just syntax.
