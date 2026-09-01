---
title: Concurrent React
author: Tejas Nirala
---

# Concurrent React

"Concurrent" does not mean multi-threaded. JavaScript still has one thread. It means React can work on **several versions of the UI at once**, pausing and abandoning work so the thread stays available for the user.

---

## 1. The problem it solves

```jsx
function App() {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => filterHugeList(query), [query]);   // 300ms of work
  return <><input value={query} onChange={e => setQuery(e.target.value)} />
           <Table rows={rows} /></>;
}
```

In legacy (synchronous) React, one keystroke means:

```
keypress → setState → render (300ms, UNINTERRUPTIBLE) → commit → paint
           └─────────── the page is frozen for 300ms ───────────┘
```

Type five characters quickly and the input visibly lags a second and a half behind your fingers. Every intermediate result is computed and committed even though you only wanted the last one.

Concurrent React's answer: mark the expensive update as **non-urgent**, and let the urgent one (the input's own value) jump the queue.

---

## 2. `useTransition`

```jsx
function App() {
  const [query, setQuery] = useState('');
  const [rows, setRows]   = useState(all);
  const [isPending, startTransition] = useTransition();

  function onChange(e) {
    setQuery(e.target.value);                     // URGENT — the input must respond
    startTransition(() => {
      setRows(filterHugeList(e.target.value));    // NON-URGENT — can lag, can be dropped
    });
  }

  return (
    <>
      <input value={query} onChange={onChange} />
      <Table rows={rows} style={{ opacity: isPending ? 0.6 : 1 }} />
    </>
  );
}
```

**Trace, typing "abc" at 50ms intervals:**

```
t=0    'a'  setQuery → Sync   → render+commit → input shows "a"  ✅ instant
            setRows  → Transition → scheduled
t=1-49      transition renders in 5ms slices, yielding between them
t=50   'b'  Sync update arrives → outranks the in-flight transition
            → ABANDON the WIP tree (never committed, so nothing flickers)
            → commit "ab" in the input                             ✅ instant
            → restart the transition for "ab"
t=100  'c'  same again
t=100+ no more input → the transition for "abc" runs to completion
            → commit the table
```

The input is always one frame behind your finger; the table lands when it can. **The old screen stays fully visible and interactive while the new one is being prepared** — that's the key property.

`isPending` is what makes this humane: it lets you dim the stale content so the user knows an update is coming.

### `startTransition` outside a component

```jsx
import { startTransition } from 'react';
startTransition(() => setTab('posts'));    // same thing, without isPending
```

### The rule

```jsx
// ❌ setState must be synchronous inside the callback
startTransition(async () => { const d = await load(); setData(d); });

// ✅
const d = await load();
startTransition(() => setData(d));
```

(React 19 Actions lift this restriction — see below.)

---

## 3. `useDeferredValue`

Same goal, different shape. Instead of marking the *update*, you defer the *value*.

```jsx
function Search() {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;

  return (
    <>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <div style={{ opacity: isStale ? 0.5 : 1 }}>
        <SlowResults query={deferredQuery} />   {/* renders with the LAGGING value */}
      </div>
    </>
  );
}
```

**Trace:**

```
type 'a'
  render 1 (urgent):   query='a', deferredQuery=''   → input updates instantly,
                                                        results still show the old ones
  render 2 (transition): query='a', deferredQuery='a' → results re-render, interruptible

type 'b' during render 2
  → render 2 is abandoned
  → urgent render: query='ab', deferredQuery='' (last committed)
  → new transition render with deferredQuery='ab'
```

### When to use which

| | `useTransition` | `useDeferredValue` |
| :-- | :-- | :-- |
| You control the setState call | ✅ | — |
| The value arrives as a **prop** you can't change | — | ✅ |
| Gives you `isPending` | ✅ | derive it: `value !== deferred` |
| Wraps | the update | the value |

Pair either with `React.memo` on the expensive child — otherwise the child re-renders anyway and you've deferred nothing:

```jsx
const SlowResults = React.memo(function SlowResults({ query }) { … });
```

Without `memo`, the parent's urgent re-render re-renders `SlowResults` with the same deferred prop, defeating the purpose.

---

## 4. Suspense: declarative loading states

```jsx
<Suspense fallback={<Skeleton />}>
  <Profile userId={id} />
</Suspense>
```

The mechanism: when a component "suspends" (it throws a promise, or uses `use()` on a pending promise), React catches it, keeps the nearest `Suspense` boundary's fallback on screen, and retries when the promise settles.

```
render <Profile/> → it needs data that isn't ready → THROWS a promise
        │
        ▼
React catches it at the nearest Suspense boundary
        │
        ├─ show fallback
        └─ attach .then(retry) to the thrown promise
                │
        promise resolves
                ▼
React re-renders the boundary's children → Profile succeeds → swap in the content
```

### Boundary placement is a UX decision

```jsx
// One boundary → all-or-nothing; the slowest child gates everything
<Suspense fallback={<PageSkeleton />}>
  <Header /><Feed /><Sidebar />
</Suspense>

// Separate boundaries → each section appears as soon as it's ready
<Suspense fallback={<HeaderSkeleton />}><Header /></Suspense>
<Suspense fallback={<FeedSkeleton />}><Feed /></Suspense>
<Suspense fallback={<SideSkeleton />}><Sidebar /></Suspense>
```

### Suspense + transitions: avoiding the fallback flash

```jsx
// Without a transition: navigating replaces content with the fallback immediately
setTab('photos');            // → Skeleton flashes, then content

// With a transition: React keeps the OLD content visible while the new one loads
startTransition(() => setTab('photos'));   // no fallback; isPending signals loading
```

This is the single most valuable Suspense behaviour, and it only exists because rendering is concurrent — React is literally holding two versions of the tree.

---

## 5. `React.lazy` and code splitting

```jsx
const Dashboard = lazy(() => import('./Dashboard'));

<Suspense fallback={<Spinner />}>
  <Dashboard />
</Suspense>
```

`lazy` returns a component that suspends on first render while the dynamic `import()` resolves. The bundler emits a separate chunk, so `Dashboard`'s code isn't in the initial bundle at all.

```
initial bundle:  app.js  (120kb)
on navigation:   dashboard-a3f9.js (340kb) fetched, then rendered
```

Preload on intent to hide the latency entirely:

```jsx
<Link onMouseEnter={() => import('./Dashboard')} to="/dashboard">Dashboard</Link>
```

---

## 6. The `use` hook (React 19)

```jsx
function Profile({ userPromise }) {
  const user = use(userPromise);       // suspends until it resolves
  return <h1>{user.name}</h1>;
}

<Suspense fallback={<Skeleton />}>
  <Profile userPromise={fetchUser(id)} />
</Suspense>
```

`use` is unusual: it's the only "hook" that may be called **conditionally and inside loops**, because it isn't stored in the hook list — it reads a resource.

```jsx
function Comp({ show, promise }) {
  if (show) {
    const data = use(promise);        // legal!
  }
  const theme = use(ThemeContext);    // also reads context
}
```

⚠️ Don't create the promise *inside* the component — a new promise every render means it never resolves stably. Create it in an event handler, a parent Server Component, or a cache.

---

## 7. Actions (React 19)

Actions extend transitions to async functions, giving pending state, error handling and optimistic updates for free.

```jsx
function Form({ id }) {
  const [state, submitAction, isPending] = useActionState(
    async (prevState, formData) => {
      const res = await updateName(id, formData.get('name'));
      if (res.error) return { error: res.error };
      return { name: res.name };
    },
    { name: '' }
  );

  return (
    <form action={submitAction}>
      <input name="name" defaultValue={state.name} />
      <button disabled={isPending}>Save</button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
```

Optimistic UI:

```jsx
const [optimisticMessages, addOptimistic] = useOptimistic(
  messages,
  (current, newMessage) => [...current, { ...newMessage, sending: true }]
);

async function send(formData) {
  addOptimistic({ text: formData.get('text') });    // instantly visible
  await sendMessage(formData);                       // real update replaces it
}
```

```
click send
  → addOptimistic: the message appears immediately, marked "sending"
  → the server round-trip happens
  → the action completes → React reverts the optimistic state and shows the real list
  → if it FAILS, the optimistic entry is dropped automatically
```

---

## 8. Enabling concurrent features

```jsx
// React 18+ — this is what unlocks everything above
import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')).render(<App />);

// legacy — no concurrency, no automatic batching
ReactDOM.render(<App />, document.getElementById('root'));
```

Concurrency is **opt-in per update**: creating a concurrent root doesn't change existing behaviour. Only `startTransition`, `useDeferredValue`, `Suspense` and streaming SSR actually use it.

---

## 9. When *not* to use transitions

- The update is already fast (< 16ms). You'd add scheduling overhead for nothing.
- The user expects instant feedback (typing into an input, toggling a checkbox). Never defer the thing the user is directly manipulating.
- The update is a side effect that must happen exactly once — transitions can be restarted, so the render must remain pure.

Profile first. Transitions fix *responsiveness*, not *total work*: an abandoned render is wasted CPU, and on a slow device more restarts can mean more battery burn.

---

## 🧠 Rapid-fire recall

1. What does "concurrent" mean here, given JavaScript is single-threaded?
2. Trace what happens to an in-progress transition when a keystroke arrives.
3. When would you choose `useDeferredValue` over `useTransition`?
4. Why must the expensive child be wrapped in `React.memo` for deferring to help?
5. What mechanism does Suspense use to detect that a component isn't ready?
6. How does wrapping a navigation in `startTransition` avoid a fallback flash?
7. Why may `use()` be called conditionally when no other hook may?

<details>
<summary>Answers</summary>

1. React can prepare multiple versions of the tree, pausing, resuming and discarding render work between 5ms slices, so the single thread stays free for input and paint. It's cooperative scheduling, not parallelism.
2. The keystroke's higher-priority lane pre-empts the transition; React throws away the uncommitted work-in-progress tree, renders and commits the urgent update, then restarts the transition from the newer state.
3. When you don't own the `setState` call — the value arrives as a prop, or from a hook you don't control. `useTransition` requires wrapping the update itself.
4. Otherwise the parent's urgent re-render re-renders the child anyway (with the same deferred prop), so the expensive work still happens on the urgent path.
5. The component throws a promise (or `use()` reads a pending one). React catches it at the nearest boundary, renders the fallback, and retries the subtree when the promise settles.
6. During a transition React keeps the previously committed content on screen while rendering the new tree, so the boundary never has to fall back. `isPending` lets you signal loading without replacing content.
7. `use` isn't stored in the fiber's positional hook linked list — it reads a resource (promise or context) — so call order doesn't matter.

</details>
