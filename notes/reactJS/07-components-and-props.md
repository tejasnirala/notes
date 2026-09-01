---
title: Components & Props
author: Tejas Nirala
---

# Components & Props

A component is a function that takes data and returns a description of UI. That's it. This page covers what "props" really are, the contract React expects you to honour (purity), and how components get *identity* — which is the concept most people never learn and then spend years debugging.

---

## 1. A component is a function

```jsx
function Welcome({ name }) {
  return <h1>Hello, {name}</h1>;
}

<Welcome name="Ada" />
```

React calls it with one argument — the props object:

```js
Welcome({ name: 'Ada' })   // → {type: 'h1', props: {children: ['Hello, ', 'Ada']}}
```

Two rules the runtime enforces:

1. **Capitalised name** — otherwise JSX emits the string `'welcome'` ([JSX](./06-jsx-and-react-elements.md)).
2. **Returns a renderable value** — an element, string, number, array, `null`, or a fragment. Returning `undefined` (a missing `return`) throws.

```jsx
// ❌ classic: a newline after `return` triggers automatic semicolon insertion
return
  <div>hi</div>;      // returns undefined 💥

// ✅
return (
  <div>hi</div>
);
```

---

## 2. Props are read-only. Always.

```jsx
function Bad({ user }) {
  user.name = 'Grace';        // ❌ mutating your parent's data
  props.title = 'x';          // ❌ React freezes props in dev
  return <p>{user.name}</p>;
}
```

Props belong to the caller. A component that mutates them breaks the one-way data flow guarantee: the parent no longer knows what its own state contains, and React's reference-based change detection can't see the edit.

If a component needs to change something, it asks the owner:

```jsx
function Editable({ user, onChange }) {
  return <input
    value={user.name}
    onChange={e => onChange({ ...user, name: e.target.value })}   // ✅ ask upward
  />;
}
```

---

## 3. Purity — the contract

React requires your component to be a **pure function of its props, state and context**: same inputs → same output, and no side effects during render.

```jsx
// ❌ IMPURE — mutates something outside itself
let renders = 0;
function Counter() {
  renders++;                        // external mutation
  document.title = 'hi';            // DOM side effect during render
  return <p>{renders}</p>;
}

// ❌ IMPURE — output changes with no input change
function Clock() {
  return <p>{Date.now()}</p>;       // different result on every call
}

// ✅ PURE
function Counter({ count }) {
  return <p>{count}</p>;
}
```

Why React demands it:

| Guarantee React wants | Broken by impurity |
| :-- | :-- |
| Render can be **paused, abandoned and restarted** | A restarted render would apply the side effect twice |
| Render can be **skipped** when inputs are equal | Skipping would lose the side effect |
| Renders can happen on the **server** | No DOM there |
| StrictMode double-invokes to surface bugs | Double side effects become visible |

Side effects go in event handlers (in response to an interaction) or in `useEffect` (to sync with an external system). See [useEffect](./19-useEffect.md).

**Local mutation is fine** — an object created *during this render* is yours:

```jsx
function List({ items }) {
  const rows = [];                       // created here → local → safe
  for (const i of items) rows.push(<li key={i.id}>{i.t}</li>);
  return <ul>{rows}</ul>;
}
```

---

## 4. The `children` prop

Anything between a component's tags arrives as `props.children`.

```jsx
function Card({ title, children }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <div className="body">{children}</div>
    </section>
  );
}

<Card title="Profile">
  <Avatar />
  <p>Bio…</p>
</Card>
```

`children` can be anything: a string, one element, an array, or even a function:

```jsx
// "render prop as children" — the component supplies data, the caller supplies markup
<MouseTracker>
  {({ x, y }) => <p>{x}, {y}</p>}
</MouseTracker>

function MouseTracker({ children }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  return <div onMouseMove={e => setPos({x: e.clientX, y: e.clientY})}>
    {children(pos)}
  </div>;
}
```

### Multiple "slots" — just use props

`children` is one slot. When you need several, pass elements as named props:

```jsx
function Layout({ sidebar, header, children }) {
  return (
    <div className="grid">
      <header>{header}</header>
      <aside>{sidebar}</aside>
      <main>{children}</main>
    </div>
  );
}

<Layout header={<Nav />} sidebar={<Filters />}>
  <Feed />
</Layout>
```

This is one of the most under-used patterns in React, and it's also a performance tool ([What Causes Re-renders](./37-what-causes-rerenders.md)).

---

## 5. Default values, and the `??` subtlety

```jsx
function Avatar({ src, size = 40, rounded = true }) { … }
```

Destructuring defaults apply **only when the prop is `undefined`** — not when it's `null`, `0`, `''` or `false`.

```jsx
<Avatar size={0} />       // size = 0     (default NOT applied)
<Avatar size={null} />    // size = null  (default NOT applied) ⚠️
<Avatar />                // size = 40
```

If `null` should also fall back, be explicit:

```jsx
function Avatar({ size }) {
  const finalSize = size ?? 40;
}
```

---

## 6. Component identity: **position in the tree**

This is the concept that explains a whole family of "impossible" bugs.

React does not identify a component instance by its variable name or props. It identifies it by **its position in the rendered tree** (its parent, plus its index/`key` among siblings, plus its `type`).

- Same position, same type on the next render → **same instance**, state preserved.
- Different type, or different `key`, or gone from that position → **old instance destroyed**, state thrown away, a new one mounted.

### Trace 1: same position → state survives

```jsx
function App() {
  const [dark, setDark] = useState(false);
  return (
    <div className={dark ? 'dark' : 'light'}>
      <Counter />
      <button onClick={() => setDark(!dark)}>theme</button>
    </div>
  );
}
```

```
render 1:  div > [Counter@pos0, button@pos1]      Counter state: count = 5
toggle theme
render 2:  div > [Counter@pos0, button@pos1]      same type at same position
           → React REUSES the instance → count is STILL 5  ✅
```

The `className` change is just a DOM attribute update. The tree shape is identical.

### Trace 2: different position → state destroyed

```jsx
function App({ isFancy }) {
  if (isFancy) {
    return <div><Counter fancy /></div>;
  }
  return <section><Counter /></section>;   // different parent TYPE
}
```

```
isFancy=false:  section > Counter        count = 5
isFancy=true:   div     > Counter
                ^^^ the parent's type changed from 'section' to 'div'
           → React unmounts the whole subtree and mounts a fresh one
           → count resets to 0  💥
```

### Trace 3: conditional siblings — the classic surprise

```jsx
{showA ? <Counter /> : <Counter />}     // "the same component" — is state kept?
```

Yes — same type, same position, so React reuses the instance and the state persists even though you *intended* two different counters. To force separate identities, give them different keys:

```jsx
{showA ? <Counter key="a" /> : <Counter key="b" />}   // now they're distinct
```

### The deliberate technique: `key` to reset state

```jsx
<ProfileForm key={userId} user={user} />
```

When `userId` changes, the key changes, so React destroys the old form (with all its half-typed local state) and mounts a fresh one. This replaces the entire "reset state in `useEffect` when the prop changes" anti-pattern with one attribute.

```
userId 1 → key="1" → instance A   (draft text: "hello…")
userId 2 → key="2" → key differs → unmount A, mount B  → draft cleared ✅
```

---

## 7. Rendering nothing, and lists of components

```jsx
function Banner({ message }) {
  if (!message) return null;               // renders nothing, still a mounted component
  return <div className="banner">{message}</div>;
}
```

Returning `null` is not the same as not rendering the component: the component still mounts, still holds state, and its effects still run.

---

## 8. Class components — what you need to recognise

You'll meet them in legacy code and interviews.

```jsx
class Welcome extends React.Component {
  constructor(props) {
    super(props);
    this.state = { count: 0 };
    this.handle = this.handle.bind(this);      // or use a class field arrow
  }
  componentDidMount()    { /* after first render */ }
  componentDidUpdate(prevProps, prevState) { /* after every update */ }
  componentWillUnmount() { /* cleanup */ }
  handle() { this.setState(s => ({ count: s.count + 1 })); }
  render() { return <button onClick={this.handle}>{this.state.count}</button>; }
}
```

| Class | Hook equivalent |
| :-- | :-- |
| `this.state` / `setState` | `useState`, `useReducer` |
| `componentDidMount` | `useEffect(fn, [])` |
| `componentDidUpdate` | `useEffect(fn, [deps])` |
| `componentWillUnmount` | the cleanup returned from `useEffect` |
| `shouldComponentUpdate` | `React.memo` |
| `getDerivedStateFromError` / `componentDidCatch` | **still class-only** — error boundaries |

Why hooks replaced them:

1. **Logic reuse** — sharing stateful logic needed HOCs or render props, producing "wrapper hell". Custom hooks share logic with zero tree nesting.
2. **Related code was split** — a subscription's setup was in `componentDidMount` and its teardown in `componentWillUnmount`, with unrelated code between. One `useEffect` holds both.
3. **`this` was a permanent tax** — binding, arrow class fields, and `this.state` being a *live mutable object* rather than a snapshot.

The one thing classes still do that hooks cannot: **error boundaries** ([Error Boundaries](./30-error-boundaries.md)).

---

## 9. Practical prop design

```jsx
// ❌ boolean explosion — 8 illegal combinations exist
<Button isPrimary isSecondary isDanger />

// ✅ one variant prop — illegal states are unrepresentable
<Button variant="danger" />

// ❌ leaking implementation
<Modal setIsOpenInternalState={…} />

// ✅ controlled/uncontrolled, the standard contract
<Modal open={open} onOpenChange={setOpen} />
```

Rules of thumb:

- Prefer **one enum prop** over several booleans.
- Name callbacks `onX`, and the handlers that implement them `handleX`.
- Spread `...rest` onto the underlying element so consumers can pass `aria-*`, `data-*` and `id`.
- Keep the prop count low; if a component takes 12 props, it's probably two components.

---

## 🧠 Rapid-fire recall

1. What does React pass to your component function, and what does it do with the return value?
2. Why are props read-only, and what breaks if you mutate them?
3. Give two things that make a component impure and say why React cares.
4. How does React decide whether two renders refer to the *same* component instance?
5. You toggle `isFancy` and your counter resets. Why, and how do you fix it?
6. How do you deliberately reset a component's state when a prop changes?
7. Name the one capability classes still have that hooks do not.

<details>
<summary>Answers</summary>

1. A single `props` object. The return value is a React element (or `null`/string/array) that React reconciles against the previous one to compute DOM mutations.
2. They belong to the parent. Mutating them breaks one-way data flow — the owner's state silently diverges from what it thinks it holds — and leaves the reference unchanged, so React's change detection misses it.
3. Writing to a variable/DOM outside the component during render, and reading a changing external source like `Date.now()` or `Math.random()`. React needs renders to be restartable, skippable and server-safe.
4. By position in the tree: same parent, same slot among siblings (or same `key`), same element `type`. Anything else means unmount + fresh mount.
5. The conditional rendered `Counter` under a different parent *type* (or a different position), so React unmounted the subtree. Keep the tree shape identical and vary only props/`className`.
6. Give it a `key` derived from that prop: `<Form key={userId} />`.
7. Error boundaries — `getDerivedStateFromError` / `componentDidCatch` have no hook equivalent.

</details>
