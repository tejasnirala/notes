---
title: Hook Pitfalls
author: Tejas Nirala
---

# Hook Pitfalls

A collected catalogue of the mistakes that actually happen, each with the trace that explains it and the fix. If a React bug is confusing you, it is very likely on this page.

---

## 1. Stale closures

**Symptom:** a value inside a callback is frozen at an old render's value.

```jsx
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000);
  return () => clearInterval(id);
}, []);                                    // count is captured at 0, forever
```

```
render 1: count=0 → interval callback closes over 0
tick: setCount(0+1) → 1
render 2: count=1, but the interval still holds render 1's closure
tick: setCount(0+1) → 1 → Object.is(1,1) → bail out → frozen at 1
```

**Fixes:** the updater form (`setCount(c => c+1)`), a correct dependency array, or a ref for values you must read but not react to. Full treatment in [Closures & Identity](./03-closures-and-identity.md).

---

## 2. Infinite render loops

### a) setState during render

```jsx
function Bad() {
  const [n, setN] = useState(0);
  setN(n + 1);                    // 💥 "Too many re-renders"
}
```

### b) An object/array dependency

```jsx
useEffect(() => { … }, [{ id }]);          // new object every render
useEffect(() => { … }, [items.filter(f)]); // new array every render
```

### c) An effect that sets its own dependency

```jsx
useEffect(() => { setData({ ...data, x: 1 }); }, [data]);   // 💥
```

### d) A function dependency recreated every render

```jsx
function Parent() {
  const load = () => fetch(url);          // new identity each render
  return <Child load={load} />;
}
function Child({ load }) {
  useEffect(() => { load().then(setData); }, [load]);   // runs every render
}
```

**Fixes:** depend on primitives; use the updater form and drop the dep; `useCallback` at the source; or move the function inside the effect.

---

## 3. Missing dependencies

```jsx
function Search({ query }) {
  useEffect(() => { fetch(`/api?q=${query}`).then(…); }, []);   // ❌
}
```

The effect never re-runs, so the UI silently shows results for the first query forever. **Never** silence `exhaustive-deps` with a comment to "fix" this; restructure instead ([useEffect](./19-useEffect.md)).

---

## 4. Conditional hooks

```jsx
if (loading) return <Spinner />;    // ❌ an early return before hooks below it
const [x] = useState(0);

if (cond) useEffect(…);             // ❌
for (const i of items) useState(i); // ❌
cond && useMemo(…);                 // ❌
```

All break the positional hook list ([How Hooks Work](./18-how-hooks-work-internally.md)). The fix is always the same: call the hook unconditionally, put the condition *inside* it, and place early returns after all hooks.

---

## 5. Mutating state

```jsx
// arrays
items.push(x);       setItems(items);          // ❌ same reference → no re-render
items.sort(cmp);     setItems(items);          // ❌
items[0] = y;        setItems(items);          // ❌

// objects
user.name = 'x';     setUser(user);            // ❌
state.a.b.c = 1;     setState({...state});     // ❌ shallow copy shares a.b.c

// ✅
setItems([...items, x]);
setItems([...items].sort(cmp));
setItems(items.map((v,i) => i === 0 ? y : v));
setUser({ ...user, name: 'x' });
setState({ ...state, a: { ...state.a, b: { ...state.a.b, c: 1 } } });
```

---

## 6. Using state immediately after setting it

```jsx
setCount(count + 1);
console.log(count);                  // the OLD value
api.save(count);                     // saves the OLD value 💥

// ✅
const next = count + 1;
setCount(next);
api.save(next);
```

State is a snapshot of the current render ([State & useState](./08-state-and-usestate.md)).

---

## 7. Multiple updates from one stale value

```jsx
setCount(count + 1);
setCount(count + 1);        // both compute 0+1 → final 1

setCount(c => c + 1);
setCount(c => c + 1);       // 0→1→2 → final 2 ✅
```

---

## 8. Storing derived data in state

```jsx
// ❌ two sources of truth that drift
const [items, setItems] = useState([]);
const [total, setTotal] = useState(0);
useEffect(() => setTotal(items.reduce((s,i) => s+i.price, 0)), [items]);

// ✅
const total = items.reduce((s, i) => s + i.price, 0);
```

Symptom of the bug: the total is correct one render *after* the items change.

---

## 9. Copying props into state

```jsx
// ❌ frozen at the mount value
function Profile({ user }) {
  const [name, setName] = useState(user.name);
}
```

`useState`'s argument is ignored after mount. Use the prop directly, or reset with a `key` ([Components & Props](./07-components-and-props.md)).

---

## 10. Missing effect cleanup

```jsx
useEffect(() => {
  window.addEventListener('resize', onResize);      // ❌ never removed
  const id = setInterval(tick, 1000);               // ❌ never cleared
  socket.on('msg', handler);                        // ❌ never off'd
}, []);
```

Consequences: memory leaks, handlers firing N times after N mounts, "can't update state on an unmounted component" warnings, timers running forever. StrictMode makes this visible immediately ([StrictMode](./17-strict-mode.md)).

---

## 11. `async` effect functions

```jsx
useEffect(async () => { … }, []);        // ❌ returns a Promise, not a cleanup

useEffect(() => {                        // ✅
  let cancelled = false;
  (async () => { const d = await load(); if (!cancelled) setData(d); })();
  return () => { cancelled = true; };
}, []);
```

---

## 12. Fetch race conditions

```jsx
// ❌ a slow earlier request can overwrite a fast later one
useEffect(() => { fetch(`/u/${id}`).then(r=>r.json()).then(setUser); }, [id]);

// ✅
useEffect(() => {
  const ac = new AbortController();
  fetch(`/u/${id}`, { signal: ac.signal }).then(r=>r.json()).then(setUser)
    .catch(e => { if (e.name !== 'AbortError') setError(e); });
  return () => ac.abort();
}, [id]);
```

Traced in full in [Async JavaScript](./04-async-javascript-and-the-event-loop.md).

---

## 13. Unstable context values

```jsx
<Ctx.Provider value={{ user, setUser }}>    // ❌ new object every render
<Ctx.Provider value={memoizedValue}>        // ✅
```

Every consumer re-renders on every provider render ([useContext](./24-useContext.md)).

---

## 14. Defining components inside components

```jsx
function Parent() {
  const Child = () => <input />;     // ❌ new type every render
  return <Child />;
}
```

Unmount + remount on every parent render: the input loses focus and its value ([Reconciliation](./14-reconciliation-and-diffing.md)).

---

## 15. Reading refs during render

```jsx
function Bad() {
  const ref = useRef(0);
  ref.current++;                     // ❌ impure; doubles under StrictMode
  return <p>{ref.current}</p>;       // ❌ won't re-render when it changes
}
```

Refs are for values that don't affect output. If the output depends on it, it's state.

---

## 16. `React.memo` with unstable props

```jsx
const Child = React.memo(Component);
<Child style={{ color: 'red' }} onClick={() => {}} data={[1,2]} />
// three new references every render → memo never bails out
```

Memoisation must be complete on both sides or it's worthless ([useMemo & useCallback](./22-useMemo-and-useCallback.md)).

---

## 17. Over-memoising

```jsx
const double = useMemo(() => n * 2, [n]);             // costs more than it saves
const cb = useCallback(() => {}, []);                 // passed to a non-memo child
const Everything = React.memo(EveryComponent);        // adds comparisons everywhere
```

Profile first. Consider whether moving state down removes the render entirely.

---

## 18. Index keys on dynamic lists

```jsx
{items.map((item, i) => <Row key={i} item={item} />)}   // ❌ if it reorders/inserts
```

State attaches to positions instead of items ([Lists & Keys](./10-lists-and-keys.md)).

---

## 19. Suppressing StrictMode's double-effect

```jsx
const ran = useRef(false);
useEffect(() => { if (ran.current) return; ran.current = true; … }, []);   // ❌
```

Write a correct cleanup instead, or move the action to an event handler.

---

## 20. Effects doing things that aren't synchronisation

```jsx
useEffect(() => { if (submitted) toast('Saved!'); }, [submitted]);   // ❌
// → put it in the submit handler

useEffect(() => { setFiltered(items.filter(f)); }, [items]);         // ❌
// → compute it during render

useEffect(() => { setSelection(null); }, [category]);               // ❌
// → change the component's key
```

---

## Debugging playbook

| Symptom | Likely cause | Where to look |
| :-- | :-- | :-- |
| "Too many re-renders" | setState during render | the component body |
| "Maximum update depth exceeded" | effect sets its own dependency | dep arrays |
| "Rendered fewer/more hooks than expected" | conditional hook or early return | hook order |
| "Invalid hook call" | hook outside a component, or two copies of React | `npm ls react` |
| "Cannot update an unmounted component" | missing cleanup / unguarded async setState | effects |
| Value is one render behind | derived state stored in state, or reading state after setting | remove the extra state |
| Input loses focus while typing | component defined inline, or a changing `key` | the parent's render |
| State appears on the wrong list row | index keys | the `map` |
| Memoized child still re-renders | an inline object/function prop, or a context change | React DevTools "why did this render" |
| Effect fires twice in dev | StrictMode — usually correct | write the cleanup |

**Tooling:** React DevTools Profiler with "Record why each component rendered" enabled answers most of these in under a minute. The `eslint-plugin-react-hooks` rules catch categories 1, 3, 4 and 12 statically — turn both rules on as errors.

---

## 🧠 Rapid-fire recall

1. Name the four distinct causes of an infinite render loop.
2. Why does mutating an array then calling the setter not re-render?
3. What does an early `return` before a `useState` break, and why?
4. Give the two-line fix for a fetch race condition.
5. Why does defining a component inside another component lose input focus?
6. What's the right response to StrictMode's double effect?
7. Name three symptoms that all point to "you stored derived data in state".

<details>
<summary>Answers</summary>

1. `setState` called unconditionally during render; an object/array literal in a dependency array; an effect that sets the state it depends on; a function prop recreated every render used as an effect dependency.
2. The reference is unchanged, so `Object.is(next, current)` is true and React bails out. You must create a new array.
3. The positional hook list — hooks are matched between renders by call index, so skipping some shifts every later hook's slot and React throws a hook-count mismatch.
4. Create an `AbortController`, pass `signal` to `fetch`, and `return () => ac.abort()` from the effect (swallowing `AbortError` in the catch).
5. The inner function has a new identity each render, so the element `type` changes; reconciliation treats it as a different component and unmounts/remounts the subtree, destroying the DOM node that had focus.
6. Write a correct cleanup so setup → cleanup → setup is equivalent to one setup — or, if it's a one-off action rather than a synchronisation, move it to an event handler. Never guard it with a ref.
7. The value is correct only one render after the source changes; two `useState`s that must always agree; an effect whose only job is to call a setter with a computed value.

</details>
