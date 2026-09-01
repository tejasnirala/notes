---
title: useMemo & useCallback
author: Tejas Nirala
---

# useMemo & useCallback

The two most cargo-culted hooks in React. Both do the same thing — cache a value between renders when its dependencies haven't changed — and both are frequently added where they cost more than they save.

---

## 1. What they do

```jsx
const value = useMemo(() => compute(a, b), [a, b]);   // caches the RESULT
const fn    = useCallback(() => doThing(a), [a]);     // caches the FUNCTION
```

They are the same hook:

```js
const useCallback = (fn, deps) => useMemo(() => fn, deps);
```

Mechanically:

```js
function useMemo(factory, deps) {
  const prev = hook.memoizedState;
  if (prev !== null && deps !== null && areHookInputsEqual(deps, prev[1])) {
    return prev[0];                    // ← cache hit: return the stored value
  }
  const value = factory();             // ← cache miss: recompute
  hook.memoizedState = [value, deps];
  return value;
}
```

Two important consequences:

- The cache holds **exactly one entry**. Toggling between two dependency values recomputes every time.
- React may **throw the cache away** at any time (e.g. to free memory for offscreen content). Never rely on memoisation for correctness.

---

## 2. The two real reasons to use them

### Reason A — an expensive computation

```jsx
const sorted = useMemo(
  () => hugeList.slice().sort(expensiveComparator),   // 200ms
  [hugeList]
);
```

"Expensive" means milliseconds, measured. Not `items.filter(…)` on 50 rows — that's microseconds, and the memo bookkeeping costs more than the filter.

```
Rule of thumb: if it doesn't show up in the Profiler, it isn't expensive.
```

### Reason B — preserving reference identity

This is the more common and more important reason.

```jsx
const config = useMemo(() => ({ id, mode }), [id, mode]);
const handle = useCallback(() => save(id), [id]);
```

Not because creating an object is slow — it isn't — but because something downstream **compares references**:

```
1. A child wrapped in React.memo receives it as a prop
2. It's in another hook's dependency array (useEffect/useMemo/useCallback)
3. It's a Context Provider's value
4. It's passed to a custom hook that depends on it
```

If none of those apply, `useMemo`/`useCallback` are pure overhead ([Closures & Identity](./03-closures-and-identity.md)).

---

## 3. The trace that shows why it matters

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  const [text, setText]   = useState('');

  const handleSave = () => save(text);              // ❌ new function each render

  return <>
    <button onClick={() => setCount(count + 1)}>{count}</button>
    <ExpensiveChild onSave={handleSave} />
  </>;
}

const ExpensiveChild = React.memo(function ExpensiveChild({ onSave }) {
  console.log('expensive render');                  // 100ms of work
  return <button onClick={onSave}>Save</button>;
});
```

**Clicking the counter:**

```
RENDER 1: handleSave@0xA1 → ExpensiveChild renders
click → setCount(1)
RENDER 2: handleSave@0xA2 (new function object, identical behaviour)
   React.memo: Object.is(0xA2, 0xA1) → false → props "changed"
   → ExpensiveChild re-renders → 100ms burned for nothing 💥
```

With `useCallback`:

```jsx
const handleSave = useCallback(() => save(text), [text]);
```

```
RENDER 2: deps [text] unchanged → useCallback returns the CACHED 0xA1
   React.memo: Object.is(0xA1, 0xA1) → true → all props equal
   → ExpensiveChild SKIPPED ✅  (0ms)
```

**But note the fragility:** if you forget `React.memo` on the child, the `useCallback` does nothing at all. Both halves are required. This is why the pattern is called "memoisation has to be complete or it's worthless".

---

## 4. When they do nothing (the common mistakes)

```jsx
// ❌ 1. The child isn't memoized → it re-renders regardless
const fn = useCallback(() => {}, []);
<RegularChild onClick={fn} />;               // renders every time anyway

// ❌ 2. Another prop breaks the comparison
const fn = useCallback(() => {}, []);
<MemoChild onClick={fn} style={{ color: 'red' }} />;   // new object → memo fails

// ❌ 3. Memoising a primitive
const n = useMemo(() => 5, []);              // primitives compare by VALUE. Pointless.
const s = useMemo(() => `${a}-${b}`, [a,b]); // pointless — string comparison is free

// ❌ 4. Dependencies that change every render
const fn = useCallback(() => {}, [{ a: 1 }]);   // a new object each render → never hits

// ❌ 5. Memoising something trivially cheap
const doubled = useMemo(() => n * 2, [n]);   // the hook costs more than the multiply

// ❌ 6. Memoising JSX that will re-render anyway
const el = useMemo(() => <Child />, []);     // only helps if the PARENT of Child bails out
```

---

## 5. Where `useMemo` genuinely earns its place

```jsx
// 1. Expensive derived data
const stats = useMemo(() => computeStatistics(rows), [rows]);   // measured: 80ms

// 2. Stabilising a context value — critical
const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
// without this, EVERY consumer re-renders on every provider render

// 3. Stabilising an effect dependency
const options = useMemo(() => ({ threshold, root }), [threshold, root]);
useEffect(() => { new IntersectionObserver(cb, options); }, [options]);

// 4. Preventing an expensive child subtree from re-rendering
const rows = useMemo(() => data.map(toRow), [data]);
return <MemoTable rows={rows} />;

// 5. Preserving referential identity for a library that caches on it
const columns = useMemo(() => [...], []);      // TanStack Table requires this
```

And `useCallback`:

```jsx
// 1. A handler passed to a memoized child (as traced above)
// 2. A function used as another hook's dependency
const fetchUser = useCallback(() => api.get(`/u/${id}`), [id]);
useEffect(() => { fetchUser().then(setUser); }, [fetchUser]);

// 3. A function returned from a custom hook (consumers may depend on it)
export function useToggle(initial) {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => setOn(o => !o), []);   // ✅ stable for consumers
  return [on, toggle];
}

// 4. A debounced/throttled function that must not be recreated
```

---

## 6. Cheaper alternatives, in order

Before reaching for a memo hook, ask whether the problem can be removed instead.

```jsx
// a) Move it out of the component entirely
const COLUMNS = [...];                    // module scope — one object, ever
function Table() { return <Grid columns={COLUMNS} />; }

// b) Use the updater form so the callback needs no dependencies
const inc = useCallback(() => setCount(c => c + 1), []);   // ✅ never changes

// c) Restructure with composition so the expensive part isn't re-rendered
function Parent() {
  const [n, setN] = useState(0);
  return <Layout><ExpensiveTree /></Layout>;   // ExpensiveTree's element is created
}                                               // by a component that doesn't re-render
// (see What Causes Re-renders)

// d) Move state down so fewer components re-render at all
```

Option (d) is almost always better than memoising: it eliminates the render rather than skipping it.

---

## 7. `useMemo` vs `React.memo` vs `memo`-everything

| | What it does |
| :-- | :-- |
| `useMemo` | Caches a value inside a component |
| `useCallback` | Caches a function inside a component |
| `React.memo` | Wraps a component; skips re-rendering when props are shallow-equal |

They're complementary, and `React.memo` usually needs the other two to be effective.

```jsx
const Row = React.memo(function Row({ item, onSelect }) { … });
// caller must ALSO stabilise onSelect, or memo never bails out
```

**Don't wrap everything in `React.memo`.** Each wrapper adds a shallow prop comparison on every parent render. For a component with 10 props that always change, you've added 10 comparisons and saved nothing.

---

## 8. The React Compiler changes this

React 19's compiler (formerly "React Forget") performs this memoisation automatically at build time. It analyses your component, understands which values depend on which, and inserts caching where it's provably safe.

```jsx
// you write:
function Parent({ items }) {
  const sorted = items.slice().sort(cmp);
  const onPick = id => select(id);
  return <Child rows={sorted} onPick={onPick} />;
}

// the compiler emits code equivalent to memoising both, keyed on `items`
```

Consequences once you adopt it:

- Most manual `useMemo`/`useCallback` become unnecessary and can be deleted.
- It only works on code that follows the Rules of React — purity, no mutation of props/state. The compiler *bails out* of components it can't prove safe, silently.
- The ESLint plugin (`eslint-plugin-react-compiler`) tells you which components it skipped and why. That list is a genuinely useful code-quality signal.

Until you've enabled it, the guidance below stands.

---

## 9. Decision checklist

```
Should I add useMemo/useCallback here?

1. Have I measured that this is slow?                    no → stop
2. Is the value passed to a React.memo child,
   used in a dependency array, or a context value?       no → stop
3. Do its dependencies actually stay stable
   across the renders I care about?                      no → fix that first
4. Can I instead move state down, lift content up,
   or hoist it to module scope?                          yes → do that instead
5. Otherwise → memoise, and keep the memo and the
   React.memo on the consumer in the same commit.
```

---

## 🧠 Rapid-fire recall

1. Express `useCallback` in terms of `useMemo`.
2. How many entries does the memo cache hold, and what does that imply for toggling values?
3. Give the two legitimate reasons to memoise.
4. Trace why `useCallback` without `React.memo` on the child achieves nothing.
5. Name four situations where a memo hook does literally nothing.
6. Why must a Context Provider's `value` almost always be memoised?
7. What does the React Compiler change about all of this?

<details>
<summary>Answers</summary>

1. `const useCallback = (fn, deps) => useMemo(() => fn, deps)` — memoising a factory that returns the function memoises the function itself.
2. Exactly one. Alternating between two dependency values misses the cache every time, recomputing on each switch.
3. A genuinely expensive computation (measured in milliseconds), and preserving reference identity for a downstream identity check — a `React.memo` child, a dependency array, or a context value.
4. A non-memoized child re-renders whenever its parent does, regardless of whether its props changed, so stabilising the prop has no effect. Both halves are required.
5. Memoising a primitive; a dependency that's re-created every render; a memoized child that also receives an inline object/function prop; a trivially cheap computation; a value nothing compares by reference.
6. Because a new `value` object on every provider render makes every consumer re-render, defeating the point of context and often re-rendering large parts of the tree.
7. It inserts equivalent memoisation automatically at build time for components that follow the Rules of React, making most manual `useMemo`/`useCallback` redundant — but it silently bails out of components it can't prove safe, which the ESLint plugin reports.

</details>
