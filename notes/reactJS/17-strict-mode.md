---
title: StrictMode & Development Behaviour
author: Tejas Nirala
---

# StrictMode & Development Behaviour

"Why does my effect run twice?" is the most-asked React question of the last three years. The answer is StrictMode, and it is doing you a favour.

---

## 1. What it is

```jsx
import { StrictMode } from 'react';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

`StrictMode` renders no DOM and has zero production effect — it's stripped from production builds entirely. In **development only**, it deliberately makes your app behave in the harshest way React's future features are allowed to behave, so latent bugs surface on your machine instead of in production.

---

## 2. What it does

### a) Double-invokes functions that must be pure

- Component function bodies
- `useState`, `useMemo`, `useReducer` initialiser functions
- Reducer functions
- The `key` extraction and other render-phase logic

```jsx
function Bad() {
  console.log('render');          // logs TWICE in dev under StrictMode
  items.push(1);                  // ← the bug this exposes: the array grows by 2
  return null;
}
```

If your component is pure, calling it twice produces the identical result and you never notice. If it isn't, the doubling makes the impurity loud.

React 18+ intentionally hides the duplicate `console.log` calls in DevTools (they appear greyed), so use a side-effect check rather than log counting when investigating.

### b) Double-invokes effects: mount → unmount → mount

```jsx
useEffect(() => {
  console.log('setup');
  return () => console.log('cleanup');
}, []);

// Dev under StrictMode:  setup, cleanup, setup
// Production:            setup
```

This simulates a future where React may **unmount and remount** a component while preserving its state — the "Offscreen"/reusable-state feature behind `<Activity>`, and the back/forward cache. Your effect must survive that, which means **every effect must have a correct cleanup**.

### c) Warns about deprecated APIs

Legacy string refs, `findDOMNode`, legacy context, and unsafe lifecycle methods (`componentWillMount` etc.).

---

## 3. The bugs it catches — with traces

### Bug 1: a missing cleanup

```jsx
useEffect(() => {
  const id = setInterval(tick, 1000);
  // no cleanup!
}, []);
```

```
StrictMode:
  mount   → interval #1 created
  unmount → nothing cleaned up          ← interval #1 still running
  mount   → interval #2 created

RESULT: the counter ticks twice as fast. The bug is now visible in 2 seconds
        instead of after a user navigates back and forth 40 times in production.
```

Fix: `return () => clearInterval(id);`

### Bug 2: a duplicated subscription

```jsx
useEffect(() => {
  socket.connect();
  socket.on('message', handler);
  return () => socket.disconnect();      // forgot to remove the handler
}, []);
```

```
mount   → connect, handler A registered
unmount → disconnect (but handler A is still attached to the socket object)
mount   → connect, handler B registered

RESULT: every message is handled twice. In production this shows up as
        duplicate messages after any remount.
```

### Bug 3: impure state initialisation

```jsx
let id = 0;
function Row() {
  const [rowId] = useState(() => ++id);   // ❌ the initialiser has a side effect
```

```
StrictMode calls the initialiser twice → id jumps by 2 per row
→ ids become 2, 4, 6 instead of 1, 2, 3
```

Fix: `useState(() => crypto.randomUUID())` — pure with respect to *your* module state, or assign ids where the data is created.

### Bug 4: a double POST

```jsx
useEffect(() => {
  fetch('/api/analytics', { method: 'POST', body: … });   // fires twice 💥
}, []);
```

This one is not a false positive — it reveals that you put a **one-off action** in an effect. Actions belong in event handlers. If it genuinely must happen on mount (a page-view beacon), either make it idempotent server-side, or guard it — see below.

---

## 4. The correct response to "my effect runs twice"

Ask which category you're in:

```
Does my effect SYNCHRONISE with something external?
   (subscription, timer, socket, event listener, animation, fetch)
        → YES: write a correct cleanup. The double-run is now harmless
                (setup → cleanup → setup leaves exactly one live subscription).

   → NO: it's an ACTION, not a synchronisation.
        Move it to an event handler, or to a route loader / server code.
```

**The wrong fix**, which you will see everywhere:

```jsx
const ran = useRef(false);
useEffect(() => {
  if (ran.current) return;     // ❌ suppresses the symptom, keeps the bug
  ran.current = true;
  …
}, []);
```

This lies to React. Under the future remount behaviour (or React Router's back navigation, or `<Activity>`), your setup won't re-run when it needs to, and the component will be broken in a way StrictMode was warning you about.

**The right fix** for the fetch case is either abort-on-cleanup:

```jsx
useEffect(() => {
  const ac = new AbortController();
  fetch(url, { signal: ac.signal }).then(r => r.json()).then(setData)
    .catch(e => { if (e.name !== 'AbortError') setError(e); });
  return () => ac.abort();          // the first request is cancelled cleanly
}, [url]);
```

…or, better, don't fetch in an effect at all — use React Query, a router loader, or a Server Component ([Data Fetching Patterns](./33-data-fetching-patterns.md)).

---

## 5. Should you disable it?

No.

```jsx
// ❌ what people do when the double-effect annoys them
createRoot(el).render(<App />);       // StrictMode removed
```

Everything StrictMode surfaces is a real defect that will appear in production as: duplicated network calls after a remount, leaked listeners causing gradual slowdowns, memory that never frees, subscriptions that fire N times, and state that resets unexpectedly once React ships reusable state.

Disabling it converts "an annoying log in dev" into "an intermittent production bug in three months".

If a *third-party* library misbehaves under StrictMode, wrap just that subtree outside `<StrictMode>` rather than disabling it globally — and file the bug upstream.

---

## 6. Other development-only behaviours worth knowing

| Behaviour | Purpose |
| :-- | :-- |
| Props and state objects are `Object.freeze`d | Mutating them throws instead of silently corrupting |
| Key warnings for lists | Surfaces reconciliation identity problems |
| "Cannot update a component while rendering a different component" | Catches setState-during-render |
| "Maximum update depth exceeded" | Catches infinite render loops |
| Hook order violation errors | Catches conditional hooks |
| Hydration mismatch warnings | Catches server/client render divergence |
| `act()` warnings in tests | Catches state updates outside React's batching in tests |

All of these disappear in production builds. Production React is smaller and faster precisely because it trusts that you fixed everything development complained about.

---

## 7. Verifying you're in the right mode

```jsx
if (process.env.NODE_ENV !== 'production') {
  console.log('dev build');
}
```

React DevTools shows a red icon for a development build and a black icon for production. Shipping a development build is a common and expensive mistake — it's roughly 2× the bundle and considerably slower.

---

## 🧠 Rapid-fire recall

1. What does StrictMode do in production?
2. Which three things does it double-invoke, and why each?
3. Trace the interval bug it exposes when cleanup is missing.
4. What future React behaviour is the mount→unmount→mount simulation preparing you for?
5. Why is a `useRef` "has it run?" guard the wrong fix?
6. When is a double-firing effect a genuine design error rather than something to clean up?
7. Name three other dev-only React behaviours.

<details>
<summary>Answers</summary>

1. Nothing — it's compiled out entirely. It renders no DOM and has no runtime cost.
2. Component function bodies and render-phase logic (to expose impurity), state/memo/reducer initialisers and reducers (same reason), and effects via setup→cleanup→setup (to verify cleanups are correct).
3. Mount creates interval #1; unmount cleans up nothing; the second mount creates interval #2. Both run, so the timer ticks twice as fast — visible immediately instead of only after a real remount in production.
4. Reusable state: React unmounting and later remounting a component while preserving its state (Offscreen/`<Activity>`, back/forward navigation restoration).
5. It suppresses the symptom while leaving the effect unable to re-establish itself on a genuine remount, which is exactly the scenario StrictMode is simulating. The component then silently breaks under future React features or route restoration.
6. When the effect performs a one-off *action* rather than synchronising with an external system — a POST, an analytics event, a toast. Those belong in event handlers, loaders or server code.
7. Frozen props/state, missing-key warnings, setState-during-render errors, infinite-loop detection, hook-order errors, hydration mismatch warnings, `act()` warnings.

</details>
