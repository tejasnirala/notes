---
title: useEffect
author: Tejas Nirala
---

# useEffect

`useEffect` is the most used and most misused hook in React. The single sentence that fixes most of it: **an effect synchronises your component with an external system.** It is not a lifecycle callback, and it is not where you put "code that runs after state changes".

---

## 1. The API

```jsx
useEffect(setup, dependencies?);

useEffect(() => {
  // setup: runs after the commit is painted
  return () => {
    // cleanup: runs before the next setup, and on unmount
  };
}, [dep1, dep2]);
```

The three dependency forms:

```jsx
useEffect(fn);            // after EVERY render
useEffect(fn, []);        // after the first render only
useEffect(fn, [a, b]);    // after the first render, and whenever a or b changes
```

`[]` and "no array" are completely different. Omitting the array is not "no dependencies" — it's "all of them".

---

## 2. When effects run — the timing

```
render → reconcile → COMMIT (DOM mutations)
                        │
                     layout effects (useLayoutEffect)   ← blocks paint
                        │
                   🖼 BROWSER PAINTS
                        │
                     passive effects (useEffect)        ← after paint, async
```

So `useEffect` never blocks the user from seeing the update. That's the point: it's for work the user doesn't need to see happen. See [The Render Pipeline](./13-the-render-pipeline.md).

### The full order across an update

```jsx
useEffect(() => {
  console.log('setup', value);
  return () => console.log('cleanup', value);
}, [value]);
```

`value` goes 1 → 2:

```
render with value=2
commit DOM
PAINT
  cleanup 1        ← the PREVIOUS effect's cleanup, closed over value=1
  setup 2          ← the new effect
```

Cleanups of all effects run before setups of all effects, across the whole tree. Never assume ordering between sibling components' effects.

---

## 3. The dependency array is not a "when to run" list

This is the mental shift. Dependencies are **not** a trigger configuration — they are a declaration of *everything the effect reads*. React compares them to know whether the effect is still in sync.

```jsx
// ❌ lying about dependencies to control timing
useEffect(() => {
  doSomething(a, b);
}, [a]);              // b is read but not declared → stale b

// ✅ declare everything, then restructure if the effect runs too often
useEffect(() => {
  doSomething(a, b);
}, [a, b]);
```

The `react-hooks/exhaustive-deps` lint rule computes the correct array for you. **Do not disable it.** If the array it wants causes too many runs, the answer is to change the code, not the array:

| Problem | Restructure |
| :-- | :-- |
| An object/array dep changes every render | Depend on its primitive fields, or `useMemo` it at the source |
| A function dep changes every render | Move the function inside the effect, or `useCallback` it |
| You only need the *latest* value, not to re-sync | Read it from a ref (or React 19's `useEffectEvent`) |
| The value is only used to compute the next state | Use the updater form: `setX(x => …)` |

---

## 4. Cleanup: the part people skip

Every effect that creates something must destroy it. Write the cleanup *at the same time* as the setup — not later, not "if it turns out to be needed".

```jsx
// Subscriptions
useEffect(() => {
  const sub = source.subscribe(handler);
  return () => sub.unsubscribe();
}, [source]);

// Event listeners
useEffect(() => {
  const onKey = e => { if (e.key === 'Escape') onClose(); };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [onClose]);

// Timers
useEffect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}, []);

// Observers
useEffect(() => {
  const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
  ro.observe(el.current);
  return () => ro.disconnect();
}, []);

// Requests
useEffect(() => {
  const ac = new AbortController();
  fetch(url, { signal: ac.signal }).then(…);
  return () => ac.abort();
}, [url]);

// Anything imperative
useEffect(() => {
  const map = new MapWidget(node.current);
  return () => map.destroy();
}, []);
```

**The test:** if setup runs twice in a row without a cleanup in between, is anything duplicated? If yes, your cleanup is wrong. StrictMode runs exactly this test for you ([StrictMode](./17-strict-mode.md)).

---

## 5. Traces

### Trace A: a dependency changes

```jsx
function Chat({ roomId }) {
  useEffect(() => {
    const conn = createConnection(roomId);
    conn.connect();
    return () => conn.disconnect();
  }, [roomId]);
}
```

```
mount with roomId='general'
   → connect('general')

roomId changes to 'random'
   → cleanup runs:  disconnect('general')    ← closed over the OLD roomId
   → setup runs:    connect('random')

unmount
   → disconnect('random')
```

At every moment exactly one connection is open, and it always matches the current prop. That's what "synchronise with an external system" means — the effect body describes the *state* you want, not the *transition*.

### Trace B: the infinite loop

```jsx
const [data, setData] = useState({});
useEffect(() => {
  setData({ ...data, loaded: true });
}, [data]);                                // 💥
```

```
render 1 → effect → setData(new object) → state changes
render 2 → deps compare: Object.is(newObj, oldObj) = false → effect runs again
         → setData(another new object)
render 3 → … forever
```

React throws "Maximum update depth exceeded". The cause is an object dependency that the effect itself replaces. Fixes: use the updater form (`setData(d => ({...d, loaded: true}))`) and drop `data` from the deps, or depend on a primitive.

### Trace C: the missing dependency

```jsx
function Search({ query }) {
  useEffect(() => {
    fetch(`/api?q=${query}`).then(r => r.json()).then(setResults);
  }, []);                                  // ❌ query missing
}
```

```
mount with query='react'   → fetch('/api?q=react')
query changes to 'vue'     → deps [] unchanged → effect does NOT run
                           → results still show 'react' results, forever
```

The effect is permanently out of sync with the prop it depends on. The lint rule would have caught it.

---

## 6. Effects you should not write

This is the highest-leverage section on the page. Most `useEffect` calls in real codebases shouldn't exist.

### ❌ Transforming data for rendering

```jsx
// ❌ an extra render, and the UI is briefly wrong
const [visible, setVisible] = useState([]);
useEffect(() => { setVisible(items.filter(i => !i.done)); }, [items]);

// ✅ just compute it
const visible = items.filter(i => !i.done);
```

```
With the effect:  render (visible = stale) → commit → PAINT (wrong!) → effect → render again
Without:          render (visible correct) → commit → PAINT ✅
```

### ❌ Resetting state when a prop changes

```jsx
// ❌
useEffect(() => { setSelection(null); }, [items]);

// ✅ use a key — React resets the whole subtree
<List key={categoryId} items={items} />
```

### ❌ Handling a user event

```jsx
// ❌ "run this when the cart changes" — but WHY did it change?
useEffect(() => { if (cart.length) showToast('Added!'); }, [cart]);
// this fires on page load with a restored cart, too

// ✅ the event caused it, so put it in the event handler
function handleAdd(item) {
  setCart(c => [...c, item]);
  showToast('Added!');
}
```

The distinction React's docs draw: an effect fires because the component **was displayed**; a handler fires because the user **did something specific**.

### ❌ Chains of effects

```jsx
// ❌ four renders, and impossible to follow
useEffect(() => { if (a) setB(…); }, [a]);
useEffect(() => { if (b) setC(…); }, [b]);
useEffect(() => { if (c) setD(…); }, [c]);

// ✅ compute it all in one place — an event handler or a reducer
function handleSomething() {
  const b = f(a), c = g(b), d = h(c);
  setState({ a, b, c, d });
}
```

### ❌ Initialising the app

```jsx
// ❌ runs twice in StrictMode, and per-component
useEffect(() => { initAnalytics(); }, []);

// ✅ module scope — runs exactly once, at import
if (typeof window !== 'undefined') initAnalytics();
```

### ✅ What effects ARE for

```
Synchronising with something OUTSIDE React:
  • browser APIs (title, localStorage, media queries, IntersectionObserver)
  • third-party widgets (maps, charts, editors) that need imperative setup/teardown
  • network subscriptions (WebSocket, SSE, Firebase listeners)
  • timers and animation frames
  • event listeners on window/document
  • logging/analytics tied to *being displayed* (a page-view impression)
```

Data fetching is a borderline case: legal, but a cache library or the router does it better ([Data Fetching Patterns](./33-data-fetching-patterns.md)).

---

## 7. Async effects

The setup function must return a cleanup function or nothing — never a Promise.

```jsx
// ❌ an async function returns a Promise; React tries to call it as cleanup
useEffect(async () => { … }, []);

// ✅ declare an inner async function
useEffect(() => {
  let cancelled = false;
  (async () => {
    const data = await load();
    if (!cancelled) setData(data);      // guard against setting after unmount
  })();
  return () => { cancelled = true; };
}, []);
```

---

## 8. `useEffectEvent` — the escape hatch (React 19 / canary)

The recurring problem: an effect needs to *read* a value without *re-running* when it changes.

```jsx
// ❌ re-connects the socket whenever the theme changes
useEffect(() => {
  const conn = createConnection(roomId);
  conn.on('connected', () => showNotification('Connected!', theme));
  conn.connect();
  return () => conn.disconnect();
}, [roomId, theme]);            // theme forces an unnecessary reconnect
```

```jsx
// ✅ the event always sees the latest theme, but doesn't act as a dependency
const onConnected = useEffectEvent(() => {
  showNotification('Connected!', theme);
});

useEffect(() => {
  const conn = createConnection(roomId);
  conn.on('connected', onConnected);
  conn.connect();
  return () => conn.disconnect();
}, [roomId]);                   // ✅ theme is NOT a dependency
```

Until it ships everywhere, the ref pattern is the equivalent:

```jsx
const themeRef = useRef(theme);
themeRef.current = theme;       // updated every render
// read themeRef.current inside the effect
```

---

## 9. Checklist

```
□ Does this effect synchronise with something OUTSIDE React?  If not, delete it.
□ Is every value the effect reads in the dependency array?
□ Does it clean up everything it creates?
□ Does setup → cleanup → setup leave the world exactly as one setup would?
□ Could this be an event handler instead?
□ Could this value just be computed during render?
□ Could this be done at module scope (once) instead of per component?
```

---

## 🧠 Rapid-fire recall

1. When exactly does `useEffect` run relative to paint, and how does that differ from `useLayoutEffect`?
2. What's the difference between omitting the dependency array and passing `[]`?
3. Are dependencies a trigger configuration? What are they really?
4. Trace what happens to a chat connection when `roomId` changes.
5. Give three effects you should delete and say what replaces each.
6. Why can't the setup function be `async`?
7. What problem does `useEffectEvent` solve, and what's the pre-19 equivalent?

<details>
<summary>Answers</summary>

1. After the commit and after the browser paints (asynchronously, as a passive effect). `useLayoutEffect` runs synchronously after DOM mutation and *before* paint, so it blocks the frame.
2. No array means "run after every render". `[]` means "run after the first render only". They are opposite ends, not similar.
3. No — they're a declaration of every reactive value the effect reads. React compares them to decide whether the effect is still synchronised. Lying about them causes stale values.
4. The old effect's cleanup runs first, disconnecting from the old room (it closed over the old `roomId`), then the new setup connects to the new room. Exactly one connection is live at any moment.
5. Deriving data for rendering → compute it during render. Resetting state on a prop change → change the component's `key`. Reacting to a user action → do it in the event handler. (Also: effect chains → one handler or reducer; app init → module scope.)
6. An `async` function returns a Promise, and React expects the return value to be a cleanup function. React would try to call the Promise. Declare an inner async function and call it instead.
7. Reading the latest value of something inside an effect without that value becoming a dependency that re-triggers setup. Before it ships, keep the value in a ref that you assign on every render and read `.current` inside the effect.

</details>
