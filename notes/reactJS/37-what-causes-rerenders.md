---
title: What Causes Re-renders
author: Tejas Nirala
---

# What Causes Re-renders

Most React performance advice starts with `React.memo`. That's the last resort, not the first. This page establishes exactly what triggers a render, dismantles the myths, and gives you the structural fixes that eliminate renders rather than skipping them.

---

## 1. The complete list of causes

A component re-renders if and only if one of these is true:

```
1. Its own state changed          (useState / useReducer setter, value actually differs)
2. Its parent re-rendered         (and it wasn't skipped by a bailout or React.memo)
3. A context it consumes changed
4. Its key changed                (technically a remount, not a re-render)
```

That's the whole list.

### The myth to kill first

> ❌ "A component re-renders when its props change."

Wrong, in both directions:

```jsx
function Parent() {
  const [n, setN] = useState(0);
  return <><button onClick={() => setN(n+1)}>{n}</button>
           <Child />                        {/* NO props at all */}
         </>;
}
```

`Child` re-renders on every click. It has no props. **Props changing isn't the trigger — the parent rendering is.**

And conversely, a `React.memo` child whose props are unchanged does *not* re-render even though its parent did.

---

## 2. Renders cascade downward

```jsx
function App() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <Header />           {/* re-renders */}
      <Sidebar>            {/* re-renders */}
        <Nav />            {/*   re-renders */}
        <Menu />           {/*   re-renders */}
      </Sidebar>
      <Main />             {/* re-renders */}
    </div>
  );
}
```

One `setCount` re-renders the entire subtree. Whether that matters depends entirely on what those components do:

```
Cheap render (a few divs):     ~0.01ms  → 200 of them is still under a frame
Expensive render (a big list,
  a chart, heavy computation): 50ms     → ONE of them blows the frame budget
```

**Re-rendering is not inherently bad.** React is fast at calling functions and diffing. The problem is only ever a *specific expensive* component rendering unnecessarily. Profile before acting.

---

## 3. The two structural fixes (do these first)

### Fix 1 — move state down

```jsx
// ❌ the whole page re-renders on every keystroke
function Page() {
  const [search, setSearch] = useState('');
  return <>
    <input value={search} onChange={e => setSearch(e.target.value)} />
    <ExpensiveChart />        {/* re-renders for no reason */}
    <HugeTable />             {/* re-renders for no reason */}
  </>;
}

// ✅ state lives with the only component that uses it
function SearchBox() {
  const [search, setSearch] = useState('');
  return <input value={search} onChange={e => setSearch(e.target.value)} />;
}

function Page() {
  return <><SearchBox /><ExpensiveChart /><HugeTable /></>;
}
```

```
Before: keystroke → Page renders → SearchBox + Chart + Table  (50ms)
After:  keystroke → SearchBox renders                          (0.02ms)
```

No memoisation involved. The render was *eliminated*, not skipped.

### Fix 2 — lift content up (pass it as `children`)

Sometimes state genuinely must live at the top. Then move the expensive tree so it isn't re-created.

```jsx
// ❌ ExpensiveTree's element is created inside the component that re-renders
function Page() {
  const [n, setN] = useState(0);
  return <div onClick={() => setN(n+1)}>
    <ExpensiveTree />
  </div>;
}

// ✅ the element is created in App, which does NOT re-render
function Page({ children }) {
  const [n, setN] = useState(0);
  return <div onClick={() => setN(n+1)}>{children}</div>;
}

function App() {
  return <Page><ExpensiveTree /></Page>;
}
```

**Why this works, at fiber level:**

```
When Page re-renders:
  props.children is the SAME element object App created earlier
  → oldProps.children === newProps.children  (reference equality)
  → React bails out of reconciling that subtree
  → ExpensiveTree is NEVER CALLED  ✅

Without the children pattern:
  <ExpensiveTree /> is re-evaluated inside Page's render
  → a NEW element object every time → no bailout → it renders
```

This is the same bailout condition described in [The Render Pipeline](./13-the-render-pipeline.md), and it's free — no `memo`, no dependency arrays, no staleness risk.

---

## 4. `React.memo` — the last resort

```jsx
const Child = React.memo(function Child({ a, b }) { … });
```

`memo` adds a **shallow comparison of every prop** before the parent's render cascades into the child.

```js
// the default comparison
Object.keys(prev).length === Object.keys(next).length &&
Object.keys(prev).every(k => Object.is(prev[k], next[k]))
```

### When it works

```jsx
<MemoChild count={5} name="Ada" />        // ✅ primitives are stable by value
<MemoChild data={memoizedData} />         // ✅ stabilised reference
<MemoChild onClick={stableCallback} />    // ✅
```

### When it silently does nothing

```jsx
<MemoChild style={{ color: 'red' }} />     // ❌ new object every render
<MemoChild onClick={() => save()} />       // ❌ new function every render
<MemoChild items={data.filter(f)} />       // ❌ new array every render
<MemoChild>{<Icon />}</MemoChild>          // ❌ children is a new element every render
```

Every one of these makes `memo` a pure cost: it does the comparison, finds a difference, and renders anyway.

```
Memoisation must be COMPLETE to be worth anything.
One unstable prop defeats the entire optimisation.
```

### Custom comparison

```jsx
const Child = React.memo(Component, (prev, next) => {
  return prev.user.id === next.user.id;      // true = SKIP the render (note: inverted!)
});
```

The return value is "are they equal", so `true` means skip. This is the opposite of `shouldComponentUpdate`, and everyone gets it backwards at least once. Avoid deep comparisons here — you'll spend more than you save.

---

## 5. Context re-renders

```jsx
const value = { user, setUser };              // ❌ new object every provider render
<Ctx.Provider value={value}>                  // → EVERY consumer re-renders
```

`React.memo` does not help — context is a subscription, not a prop ([useContext](./24-useContext.md)).

```jsx
const value = useMemo(() => ({ user, setUser }), [user]);   // ✅
```

Plus: split contexts by change frequency, split state from dispatch, and pass the tree as `children` so the provider's own render doesn't re-create it.

---

## 6. Diagnosing with the Profiler

```
React DevTools → ⚙ Settings → "Record why each component rendered while profiling"
→ Profiler tab → ⏺ record → interact → ⏹ stop
```

Read the flamegraph:

- **Width** = time spent rendering that component (grey = it didn't render).
- Click a commit to see the list of components that rendered and, with the setting on, **why**: "Props changed (onClick)", "Hook 1 changed", "Context changed", "Parent rendered".

That "why" line usually names the exact unstable prop.

The ranked chart shows the same commit sorted by cost — start at the top and ask "did this need to render?"

### Cheap instrumentation

```jsx
function useWhyDidYouUpdate(name, props) {
  const prev = useRef();
  useEffect(() => {
    if (prev.current) {
      const changed = Object.entries(props)
        .filter(([k, v]) => !Object.is(prev.current[k], v))
        .map(([k, v]) => [k, { from: prev.current[k], to: v }]);
      if (changed.length) console.log('[why-update]', name, Object.fromEntries(changed));
    }
    prev.current = props;
  });
}
```

Drop it into a suspect component and it prints exactly which prop's reference changed.

---

## 7. Common unnecessary-render sources

```jsx
// 1. Inline object/array/function props to a memoized child
<Memo style={{}} onClick={() => {}} items={[]} />

// 2. An unstable context value
<Ctx.Provider value={{ a, b }}>

// 3. State that's too high in the tree
// 4. A component defined inside another component (a remount, not just a render)
// 5. A parent re-rendering because of state only one small child needs
// 6. Redux useSelector returning a new object/array each call
// 7. A custom hook returning new object identities every render
function useThing() { return { a, b }; }         // ❌ new object each call
function useThing() { return useMemo(() => ({a,b}), [a,b]); }   // ✅ if consumers depend on it
```

---

## 8. The decision order

```
1. Is anything actually slow?                    → Profiler. If not, STOP.
2. Can the state move DOWN, closer to its user?  → best fix; eliminates the render
3. Can the expensive tree move UP into children? → free bailout, no memo
4. Is a context value unstable?                  → memoise it; split the context
5. Is a specific expensive child re-rendering?   → React.memo + stabilise ALL its props
6. Is the render itself expensive (10k rows)?    → virtualise
7. Is the computation expensive?                 → useMemo (measured)
8. Is it unavoidable but non-urgent?             → useTransition / useDeferredValue
```

Steps 2 and 3 solve most real problems and cost nothing at runtime. Steps 5–7 are where people start, and where they add complexity for little gain.

> And note: the **React Compiler** (React 19) automates step 5 for code that follows the Rules of React — but it can't do steps 2 and 3, which are architectural decisions only you can make.

---

## 🧠 Rapid-fire recall

1. List the four things that cause a re-render.
2. Why is "props changed" not the trigger?
3. Trace why passing a subtree as `children` prevents it re-rendering.
4. What does `React.memo` compare, and name four props that defeat it.
5. In `React.memo`'s custom comparator, what does returning `true` mean?
6. Why doesn't `React.memo` protect against context changes?
7. Give the ordered decision procedure for fixing a slow interaction.

<details>
<summary>Answers</summary>

1. Its own state changed; its parent re-rendered (and it wasn't skipped); a context it consumes changed; its `key` changed (a remount).
2. A component with no props at all still re-renders when its parent does. The cascade is the trigger; prop comparison only enters the picture when `React.memo` or a bailout is involved.
3. The child element object is created by the *grandparent*, so when the middle component re-renders, `props.children` is referentially identical. React's bailout check sees unchanged props and skips reconciling that subtree, so the child function is never called.
4. A shallow `Object.is` comparison of every prop. Inline object literals (`style={{}}`), inline arrow functions, arrays computed inline (`items.filter(...)`), and inline JSX children — all create new references each render.
5. That the props are equal, so the render should be **skipped**. It's the inverse of `shouldComponentUpdate`.
6. Context is a subscription registered on the fiber, not a prop. When the provider value changes, React schedules an update on every consumer fiber directly, bypassing prop comparison.
7. Profile first; move state down; lift the expensive tree into `children`; stabilise context values; then `React.memo` with all props stabilised; then virtualise; then `useMemo` for expensive computation; then transitions for unavoidable non-urgent work.

</details>
