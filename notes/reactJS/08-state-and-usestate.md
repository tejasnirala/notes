---
title: State & useState
author: Tejas Nirala
---

# State & useState

State is memory that survives a render and, when changed, triggers a new one. This page covers the API, the mental model ("state is a snapshot"), the update queue with full traces, and how to structure state so bugs become impossible rather than merely unlikely.

---

## 1. Why a local variable doesn't work

```jsx
function Broken() {
  let count = 0;
  return <button onClick={() => { count++; console.log(count); }}>{count}</button>;
}
```

Clicking logs 1, 2, 3 — and the screen never changes. Two independent failures:

1. **Local variables don't persist.** Each render is a fresh function call; `count` is re-initialised to 0.
2. **Changing them doesn't notify React.** Nothing schedules a re-render.

`useState` fixes both:

```jsx
function Works() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

- The value is stored **outside** the component, on React's fiber for this instance ([How Hooks Work](./18-how-hooks-work-internally.md)).
- The setter **schedules a re-render**.

---

## 2. The API

```jsx
const [value, setValue] = useState(initialValue);
```

- `initialValue` is used **only on the first render** of this instance. On every later render React ignores it and returns the stored value.
- `setValue` is **stable** — the same function object for the component's whole life, so it never needs to be a dependency.

### Lazy initialisation

```jsx
useState(expensiveCompute());     // ❌ runs on EVERY render, result discarded after the first
useState(() => expensiveCompute()); // ✅ initialiser function — called only on mount
```

```jsx
const [items, setItems] = useState(() => JSON.parse(localStorage.getItem('items')) ?? []);
```

Careful: `useState(() => …)` passes an initialiser. To store a *function as state*, double-wrap: `useState(() => myFn)`.

### Setting a function as state

```jsx
setValue(fn);        // ❌ React thinks fn is an updater and CALLS it
setValue(() => fn);  // ✅
```

---

## 3. State is a snapshot — the trace everyone needs

```jsx
function Counter() {
  const [n, setN] = useState(0);
  function handleClick() {
    setN(n + 1);
    setN(n + 1);
    setN(n + 1);
    console.log(n);
  }
  return <button onClick={handleClick}>{n}</button>;
}
```

What's the result of one click? **`n` becomes 1**, and the log prints `0`.

```
RENDER 1:  n is the const binding 0
click → handleClick (from render 1, closed over n === 0)

  setN(n + 1)  →  setN(0 + 1)  →  queue: [set 1]
  setN(n + 1)  →  setN(0 + 1)  →  queue: [set 1, set 1]
  setN(n + 1)  →  setN(0 + 1)  →  queue: [set 1, set 1, set 1]
  console.log(n) → 0        (this render's binding never changes)

handler returns → React processes the queue:
  start with 0 → set 1 → set 1 → set 1 → final: 1

RENDER 2:  n = 1
```

`n` inside `handleClick` is a constant belonging to render 1. Calling a setter does not reach back and edit it.

### The updater form

```jsx
function handleClick() {
  setN(n => n + 1);
  setN(n => n + 1);
  setN(n => n + 1);
}
```

```
queue: [(n)=>n+1, (n)=>n+1, (n)=>n+1]

React processes, feeding each result into the next:
  0 → 1 → 2 → 3

RENDER 2: n = 3   ✅
```

**Rule:** if the next state depends on the previous state, use the updater form. It reads from the queue, not from your (possibly stale) closure.

### Mixed queue trace

```jsx
setN(n + 5);        // n is 0 → "replace with 5"
setN(x => x + 1);   // "take whatever's there, add 1"
setN(100);          // "replace with 100"
```

```
queue: [replace 5, x=>x+1, replace 100]
  start 0
  → 5
  → 6
  → 100
final: 100
```

---

## 4. The bail-out

React compares the new state to the current one with `Object.is`. If equal, it may skip the re-render entirely.

```jsx
const [user, setUser] = useState({ name: 'Ada' });

// ❌ mutation → same reference → Object.is true → NO re-render
user.name = 'Grace';
setUser(user);

// ✅ new reference
setUser({ ...user, name: 'Grace' });
```

Note: React may still render *once* more before bailing out (it needs to run the component to know), but it will not commit or re-render children. Don't rely on the bail-out for correctness — rely on it for performance.

---

## 5. Updating objects and arrays

Treat state as immutable. Always produce a new value.

### Objects

```jsx
const [form, setForm] = useState({ name: '', email: '', address: { city: '' } });

setForm({ ...form, name: 'Ada' });                                  // one field
setForm({ ...form, address: { ...form.address, city: 'London' } }); // nested

// generic field handler
const onChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));
```

The computed key `[e.target.name]` is what lets one handler serve a whole form.

### Arrays — the cheat sheet

```jsx
const [items, setItems] = useState([]);

setItems([...items, newItem]);                                  // append
setItems([newItem, ...items]);                                  // prepend
setItems(items.filter(i => i.id !== id));                       // remove
setItems(items.map(i => i.id === id ? { ...i, done: true } : i));// update one
setItems([...items.slice(0, i), newItem, ...items.slice(i)]);   // insert at i
setItems([...items].sort(byName));                              // sort (copy first!)
setItems(items.toSorted(byName));                               // ES2023
```

Never `push`, `splice`, `sort` or `reverse` directly on state — they mutate and return the same reference.

### When nesting gets deep, use Immer

```jsx
import { useImmer } from 'use-immer';
const [state, updateState] = useImmer(initial);

updateState(draft => {
  draft.a.b.c.list.push(item);        // looks like mutation, produces an immutable copy
});
```

Immer records your "mutations" on a Proxy and applies them structurally, sharing untouched branches. Redux Toolkit uses the same engine ([Redux Toolkit](./35-redux-toolkit.md)).

---

## 6. Structuring state well

### a) Group what changes together

```jsx
// ❌ two states that must always move in lockstep
const [x, setX] = useState(0);
const [y, setY] = useState(0);

// ✅
const [pos, setPos] = useState({ x: 0, y: 0 });
```

### b) Avoid contradictory state

```jsx
// ❌ isLoading && isError is representable but meaningless
const [isLoading, setIsLoading] = useState(false);
const [isError,   setIsError]   = useState(false);
const [isSuccess, setIsSuccess] = useState(false);

// ✅ one variable, illegal states unrepresentable
const [status, setStatus] = useState('idle'); // 'idle'|'loading'|'success'|'error'
```

### c) Don't store what you can derive

```jsx
// ❌ two sources of truth that will drift
const [items, setItems] = useState([]);
const [count, setCount] = useState(0);

// ✅ derive during render — it's just JavaScript
const count = items.length;
const visible = items.filter(i => !i.done);
const total = items.reduce((s, i) => s + i.price, 0);
```

Only reach for `useMemo` if the derivation is genuinely expensive *and* profiling says so ([useMemo & useCallback](./22-useMemo-and-useCallback.md)).

### d) Don't mirror props into state

```jsx
// ❌ freezes at the first value; later prop changes are ignored
function Profile({ user }) {
  const [name, setName] = useState(user.name);
```

```
mount:  user.name = 'Ada'   → name = 'Ada'
parent updates user.name to 'Grace'
render: useState IGNORES the argument after mount → name is still 'Ada' 💥
```

Fixes, in order of preference: use the prop directly; or if you need an editable draft, reset with a `key`:

```jsx
<Profile key={user.id} user={user} />
```

### e) Flatten deep nesting

```jsx
// ❌ updating one deeply nested node means rebuilding every ancestor
{ id: 1, children: [{ id: 2, children: [{ id: 3, … }] }] }

// ✅ normalised — O(1) updates
{
  byId: { 1: {id:1, childIds:[2]}, 2: {id:2, childIds:[3]}, 3: {…} },
  rootId: 1,
}
```

---

## 7. State is per-instance and isolated

```jsx
<Counter />   {/* count: 3 */}
<Counter />   {/* count: 0 — completely independent */}
```

Each element in the tree gets its own hook storage on its own fiber. Two instances of the same component share code, never state. To share state, **lift it** to the nearest common parent ([Lifting State](./12-lifting-state-and-data-flow.md)).

---

## 8. Common mistakes, collected

```jsx
// 1. Calling the setter during render → infinite loop
function Bad() {
  const [n, setN] = useState(0);
  setN(n + 1);                    // 💥 render → setState → render → …
}

// 1b. …unless it's a guarded "adjust state during render" (rare but legal)
if (prevId !== id) { setPrevId(id); setSelection(null); }   // must be conditional

// 2. Reading state immediately after setting it
setCount(count + 1);
console.log(count);              // old value — by design

// 3. Calling the handler instead of passing it
<button onClick={handleClick()}>   // ❌ runs during render
<button onClick={handleClick}>     // ✅
<button onClick={() => save(id)}>  // ✅ when you need arguments

// 4. Conditional hooks
if (x) { const [a] = useState(0); }   // ❌ breaks hook ordering — see the hooks page

// 5. Async setter assumptions
setCount(1); setCount(count + 1);      // second one uses the STALE count
setCount(1); setCount(c => c + 1);     // ✅ 2
```

---

## 9. When `useState` is the wrong tool

| Situation | Use instead |
| :-- | :-- |
| Value doesn't affect rendering (timer id, previous value, DOM node) | [`useRef`](./21-useRef.md) |
| Several fields update together with complex rules | [`useReducer`](./23-useReducer.md) |
| Can be computed from existing state/props | a plain `const` during render |
| Needed by many distant components | [Context](./24-useContext.md) or a store |
| Owned by the server (fetched data, cache, invalidation) | [React Query](./36-react-query.md) / RSC |
| URL-shaped (filters, tabs, pagination) | the router's search params |

The best state is state you deleted.

---

## 🧠 Rapid-fire recall

1. Why doesn't a local `let` variable work as state?
2. Trace `setN(n+1)` three times in one handler when `n` is 0. Now trace `setN(n => n+1)` three times.
3. When is the argument to `useState` actually used?
4. What's the difference between `useState(compute())` and `useState(compute)`?
5. Why does mutating a state object then calling the setter fail to re-render?
6. Give three signs your state is badly structured.
7. What happens if you call a setter unconditionally during render?

<details>
<summary>Answers</summary>

1. It's re-created on every render so it doesn't persist, and assigning to it doesn't tell React to re-render.
2. Direct form: all three read the same stale binding 0 and queue "set 1" three times → final 1. Updater form: React feeds each result into the next → 0→1→2→3 → final 3.
3. Only on the component instance's first render (mount). On later renders React returns the stored value and ignores the argument entirely.
4. The first calls `compute()` on every render and throws the result away after mount; the second passes the function so React calls it once, on mount only.
5. The reference is unchanged, so `Object.is(next, current)` is true and React bails out. You must create a new object.
6. Values that must change together stored separately; boolean flags that can form contradictory combinations; values that could be derived from other state; props copied into state; deeply nested structures.
7. An infinite render loop — the render schedules a state update, which triggers a render, forever. React throws "Too many re-renders". The only legal form is a *conditional* adjustment guarded by a comparison with a previous value.

</details>
