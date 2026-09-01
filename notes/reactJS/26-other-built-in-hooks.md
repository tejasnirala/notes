---
title: The Remaining Built-in Hooks
author: Tejas Nirala
---

# The Remaining Built-in Hooks

The hooks you'll use less often but must recognise: `useId`, `useSyncExternalStore`, `useImperativeHandle`, `useDebugValue`, `useInsertionEffect`, and React 19's `use`.

---

## 1. `useId`

Generates a stable, unique, **SSR-safe** identifier.

```jsx
function Field({ label, ...props }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} {...props} />
    </>
  );
}
```

### Why not `Math.random()` or a counter?

```
SERVER renders:  <label for="input-0.7231">  <input id="input-0.7231">
CLIENT hydrates: <label for="input-0.4519">  <input id="input-0.4519">
                 ↑ mismatch → React warns, and the a11y association may break
```

`useId` derives the id from the component's **position in the tree**, so the server and client independently produce the same string. Output looks like `«r1»` or `:r1:` depending on the version.

Multiple related ids from one call:

```jsx
const id = useId();
<input aria-describedby={`${id}-hint ${id}-error`} />
<p id={`${id}-hint`}>Must be 8+ characters</p>
<p id={`${id}-error`}>Too short</p>
```

**Not for list keys.** Keys must come from your data, and `useId` is per component instance, not per item.

---

## 2. `useSyncExternalStore`

Subscribes to a store that lives outside React, in a way that is safe under concurrent rendering.

```jsx
const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot?);
```

| Argument | Contract |
| :-- | :-- |
| `subscribe(cb)` | register `cb`; return an unsubscribe function. Must be a **stable** function. |
| `getSnapshot()` | return the current value. Must be **cheap** and return a **cached reference** for unchanged data. |
| `getServerSnapshot()` | the value to use during SSR and hydration |

### Example: online status

```jsx
const subscribe = cb => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

function useOnlineStatus() {
  return useSyncExternalStore(
    subscribe,                    // defined at module scope → stable
    () => navigator.onLine,       // client snapshot
    () => true                    // server snapshot — no navigator there
  );
}
```

### Example: a media query

```jsx
function useMediaQuery(query) {
  const subscribe = useCallback(cb => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', cb);
    return () => mql.removeEventListener('change', cb);
  }, [query]);

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}
```

### The tearing problem it solves

Concurrent rendering can pause mid-tree. If an external store changes during that pause, components rendered before the pause show the old value and components rendered after show the new one — one screen, two versions of the truth. That's **tearing**.

```
without useSyncExternalStore:
   render <A/>  reads store → 5
   ── React yields ──
   store changes to 6
   render <B/>  reads store → 6
   commit → the screen shows A=5 and B=6 simultaneously  💥

with useSyncExternalStore:
   React checks the snapshot before committing; if it changed, it re-renders
   synchronously so the whole commit reflects one consistent value  ✅
```

This is why Redux, Zustand, Jotai and Valtio all migrated to it for React 18. You rarely call it directly — but knowing it exists explains why store libraries need a React-version-specific adapter.

### The snapshot trap

```jsx
// ❌ a new array every call → React thinks the store changed → infinite loop
getSnapshot: () => store.items.filter(i => i.active)

// ✅ return a cached reference; do the derivation in the component or memoise it in the store
getSnapshot: () => store.items
```

React calls `getSnapshot` on every render and compares with `Object.is`.

---

## 3. `useImperativeHandle`

Customise what a parent's ref receives.

```jsx
const Modal = forwardRef(function Modal(props, ref) {
  const dialogRef = useRef(null);

  useImperativeHandle(ref, () => ({
    open:  () => dialogRef.current.showModal(),
    close: () => dialogRef.current.close(),
  }), []);                       // deps: recreate the handle when they change

  return <dialog ref={dialogRef}>{props.children}</dialog>;
});

// parent
const modal = useRef(null);
<Modal ref={modal} />
<button onClick={() => modal.current.open()}>Open</button>
```

Why bother instead of forwarding the raw node: you expose a **contract**, not the DOM. The parent can't accidentally set `innerHTML`, and you're free to change the internal implementation.

Use it only when the action is genuinely imperative and has no declarative equivalent: focus, scroll, media playback, canvas drawing, animation triggers, `showModal`. If you find yourself exposing `setValue`, you wanted a controlled component instead ([Lifting State](./12-lifting-state-and-data-flow.md)).

React 19 note: `ref` is a normal prop, so `forwardRef` is no longer needed:

```jsx
function Modal({ ref, children }) {
  useImperativeHandle(ref, () => ({ open, close }), []);
  …
}
```

---

## 4. `useDebugValue`

A label for custom hooks in React DevTools.

```jsx
function useOnlineStatus() {
  const online = useSyncExternalStore(subscribe, getSnapshot);
  useDebugValue(online ? 'Online' : 'Offline');
  return online;
}
```

DevTools shows `OnlineStatus: "Online"` next to the hook instead of an anonymous entry. Defer expensive formatting so it only runs when DevTools is actually inspecting:

```jsx
useDebugValue(date, d => d.toISOString());   // the formatter runs only when inspected
```

Only useful in shared/library hooks. It has no runtime effect otherwise.

---

## 5. `useInsertionEffect`

Covered in [useLayoutEffect & Effect Timing](./20-useLayoutEffect-and-effect-timing.md). Summary: it runs before any DOM mutation, exists for CSS-in-JS libraries injecting `<style>` tags, and forbids reading layout or calling `setState`. Application code should never need it.

---

## 6. `use` (React 19)

Reads a resource — a Promise or a Context — and is the only "hook" allowed inside conditions and loops.

```jsx
import { use } from 'react';

function Comments({ commentsPromise }) {
  const comments = use(commentsPromise);       // suspends until resolved
  return comments.map(c => <p key={c.id}>{c.text}</p>);
}

<Suspense fallback={<Skeleton />}>
  <Comments commentsPromise={fetchComments(postId)} />
</Suspense>
```

```jsx
// conditional — legal, because `use` isn't stored in the positional hook list
function Panel({ showDetails, detailsPromise }) {
  if (showDetails) {
    const details = use(detailsPromise);
    return <Details data={details} />;
  }
  return <Summary />;
}

// it also reads context
const theme = use(ThemeContext);
```

### The critical rule

```jsx
// ❌ a NEW promise every render → it never settles into a stable value
function Bad({ id }) {
  const user = use(fetch(`/api/${id}`).then(r => r.json()));
}

// ✅ create the promise where it's stable:
//    - in a Server Component and pass it down as a prop
//    - in an event handler
//    - from a cache (React Query, or React's own `cache()` on the server)
```

The idiomatic App Router pattern: a Server Component starts the fetch without awaiting, passes the promise to a Client Component, and `use` unwraps it — so the request begins on the server and streams to the client.

```jsx
// server component
export default function Page({ params }) {
  const commentsPromise = getComments(params.id);   // NOT awaited
  return (
    <Suspense fallback={<Skeleton />}>
      <Comments commentsPromise={commentsPromise} />   {/* client component */}
    </Suspense>
  );
}
```

---

## 7. Quick reference

| Hook | Use it for | Frequency |
| :-- | :-- | :-- |
| `useId` | SSR-safe ids for `htmlFor`/`aria-*` | occasionally |
| `useSyncExternalStore` | subscribing to a non-React store without tearing | library authors |
| `useImperativeHandle` | exposing a narrow imperative API on a ref | rarely |
| `useDebugValue` | labelling a custom hook in DevTools | library authors |
| `useInsertionEffect` | injecting styles before mutations | CSS-in-JS authors |
| `use` | unwrapping a promise or context, conditionally | increasingly common |

---

## 🧠 Rapid-fire recall

1. Why can't you use `Math.random()` for form element ids in an SSR app?
2. What is tearing, and how does `useSyncExternalStore` prevent it?
3. What must `getSnapshot` guarantee, and what happens if it doesn't?
4. When is `useImperativeHandle` appropriate, and what's a sign you should have used props instead?
5. Why may `use` be called inside an `if` when no other hook may?
6. Where should the promise passed to `use` be created?
7. What does `useDebugValue`'s second argument do?

<details>
<summary>Answers</summary>

1. The server and client generate different values, so the hydrated markup doesn't match the server HTML — a hydration warning, and potentially broken label/input associations. `useId` derives the id from tree position so both sides agree.
2. Two parts of one committed screen showing different values from the same external store, because the store changed while React was paused mid-render. `useSyncExternalStore` re-checks the snapshot before committing and forces a synchronous consistent re-render if it changed.
3. It must be cheap and return a *cached reference* for unchanged data. Returning a freshly-created array/object each call makes React see a change every render, causing an infinite loop.
4. When the action is genuinely imperative with no declarative form — focus, scroll, media playback, `showModal`, canvas. If you're exposing something like `setValue`, you wanted a controlled component with `value`/`onChange`.
5. It isn't stored in the fiber's positional hook linked list — it reads a resource — so call order doesn't need to be stable.
6. Somewhere stable: a Server Component that passes it down, an event handler, or a cache. Creating it in the render body produces a new promise every render, so it never resolves consistently.
7. A formatter function, called only when DevTools actually inspects the hook, so expensive formatting doesn't run on every render.

</details>
