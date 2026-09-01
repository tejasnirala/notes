---
title: Lifting State & Data Flow
author: Tejas Nirala
---

# Lifting State & Data Flow

Where should a piece of state live? Get this right and components stay small and debuggable. Get it wrong and you end up with prop drilling, duplicated sources of truth, or a global store holding things that should have been local.

---

## 1. The algorithm for placing state

For each piece of state, ask in order:

```
1. Does anything RENDER differently because of it?
      no  → it isn't state. Use a ref, or a module variable.
      yes ↓
2. Can it be COMPUTED from existing state/props?
      yes → derive it during render. Don't store it.
      no  ↓
3. Which components read it?
      → find their LOWEST COMMON ANCESTOR
      → put the state there, pass it down as props
4. Is that ancestor now far above the consumers, with many pass-through layers?
      → consider composition, then Context, then a store
5. Does it actually live on the server?
      → it's a cache, not state. Use React Query / RSC.
```

Most "we need Redux" conversations are resolved at step 2 or 3.

---

## 2. Lifting state up — a worked example

Two temperature inputs that must stay in sync.

### Before: state trapped in the children

```jsx
function TemperatureInput({ scale }) {
  const [temp, setTemp] = useState('');       // ← each has its OWN copy
  return <input value={temp} onChange={e => setTemp(e.target.value)} />;
}

function Calculator() {
  return <>
    <TemperatureInput scale="c" />
    <TemperatureInput scale="f" />
  </>;
}
```

```
Calculator
├── TemperatureInput(c)   temp: "100"
└── TemperatureInput(f)   temp: ""       ← two independent truths, no way to sync
```

### After: lift to the lowest common ancestor

```jsx
function TemperatureInput({ scale, value, onChange }) {   // now CONTROLLED
  return (
    <label>{scale === 'c' ? 'Celsius' : 'Fahrenheit'}
      <input value={value} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

function Calculator() {
  const [temp, setTemp]   = useState('');
  const [scale, setScale] = useState('c');

  // DERIVED, not stored — one source of truth
  const celsius    = scale === 'f' ? toCelsius(temp)    : temp;
  const fahrenheit = scale === 'c' ? toFahrenheit(temp) : temp;

  return <>
    <TemperatureInput scale="c" value={celsius}
                      onChange={v => { setScale('c'); setTemp(v); }} />
    <TemperatureInput scale="f" value={fahrenheit}
                      onChange={v => { setScale('f'); setTemp(v); }} />
    <p>{Number(celsius) >= 100 ? 'Boiling' : 'Not boiling'}</p>
  </>;
}
```

**Trace typing "212" into the Fahrenheit field:**

```
1. onChange('212') fires on the F input
2. setScale('f'); setTemp('212')      — batched into one update
3. RENDER: scale='f', temp='212'
     celsius    = toCelsius('212')  = '100'   ← derived
     fahrenheit = '212'                        ← the raw source
4. C input receives value='100'; F input receives '212'
5. <p> reads celsius → 'Boiling'
```

Notice there is exactly **one** stored number. The other is computed. That is the whole trick: two synchronised states are a bug; one state and one derivation is correct by construction.

---

## 3. The controlled-component contract

Lifting state turns a child into a *controlled* component. The contract is always the same shape:

```jsx
<Component value={x} onChange={setX} />
```

Naming conventions the ecosystem follows:

```jsx
<Input      value={v}   onChange={fn} />
<Checkbox   checked={c} onChange={fn} />
<Modal      open={o}    onOpenChange={fn} />
<Tabs       value={t}   onValueChange={fn} />
<Accordion  expanded={e} onExpandedChange={fn} />
```

### Supporting both controlled and uncontrolled

Good library components accept either. The standard implementation:

```jsx
function useControllable({ value, defaultValue, onChange }) {
  const [internal, setInternal] = useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;

  const set = useCallback(next => {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  }, [isControlled, onChange]);

  return [current, set];
}

function Toggle({ checked, defaultChecked = false, onChange }) {
  const [on, setOn] = useControllable({ value: checked, defaultValue: defaultChecked, onChange });
  return <button aria-pressed={on} onClick={() => setOn(!on)}>{on ? 'On' : 'Off'}</button>;
}

<Toggle defaultChecked />                        // uncontrolled — manages itself
<Toggle checked={on} onChange={setOn} />         // controlled — you own it
```

---

## 4. Prop drilling — recognising it, and the fixes in order

```jsx
<App user={user}>
  <Layout user={user}>                  {/* doesn't use it */}
    <Sidebar user={user}>               {/* doesn't use it */}
      <Nav user={user}>                 {/* doesn't use it */}
        <Avatar user={user} />          {/* finally uses it */}
```

Three intermediate components exist only to forward a prop. Every one of them re-renders when `user` changes, and adding a second prop means touching four files.

### Fix 1 — Composition (try this first)

Pass the *element*, not the data. The intermediate layers never see `user` at all.

```jsx
function App() {
  const [user, setUser] = useState(…);
  return (
    <Layout sidebar={<Sidebar nav={<Nav avatar={<Avatar user={user} />} />} />} />
  );
}

function Layout({ sidebar }) { return <div>{sidebar}</div>; }   // knows nothing about user
```

Because `<Avatar user={user}/>` is created in `App`, it closes over `App`'s data. `Layout`, `Sidebar` and `Nav` become genuinely generic containers — and, bonus, they don't re-render when `user` changes ([What Causes Re-renders](./37-what-causes-rerenders.md)).

The `children` version of the same idea:

```jsx
<Layout>
  <Sidebar>
    <Nav>
      <Avatar user={user} />
    </Nav>
  </Sidebar>
</Layout>
```

### Fix 2 — Context

For genuinely app-wide, rarely-changing values: theme, locale, the current user, a router.

```jsx
const UserContext = createContext(null);

function App() {
  const [user, setUser] = useState(null);
  const value = useMemo(() => ({ user, setUser }), [user]);
  return <UserContext.Provider value={value}><Layout /></UserContext.Provider>;
}

function Avatar() {
  const { user } = useContext(UserContext);
  return <img src={user.avatar} />;
}
```

Cost: every consumer re-renders whenever the context value changes, and the component is no longer reusable outside a provider. See [useContext](./24-useContext.md).

### Fix 3 — A store

When the state is large, updated frequently, or shared across unrelated trees — Zustand, Redux Toolkit, Jotai. These support *selector-based* subscriptions, so a component re-renders only when the slice it reads changes. See [State Management Landscape](./34-state-management-landscape.md).

```
Depth 2-3, one or two props   → just drill. It's fine.
Deeper, but structural        → composition
App-wide, low-frequency       → Context
Large, high-frequency, shared → a store with selectors
Server-owned data             → React Query / RSC
```

---

## 5. Sibling communication

Siblings never talk directly. State goes up to their common parent.

```jsx
function Parent() {
  const [selectedId, setSelectedId] = useState(null);
  return <>
    <List  onSelect={setSelectedId} selectedId={selectedId} />
    <Detail id={selectedId} />
  </>;
}
```

```
        Parent  (owns selectedId)
        ┌───┴────┐
    props│        │props
        ▼         ▼
      List      Detail
        │
        └── onSelect(id) ──▶ back up to Parent ──▶ new render ──▶ Detail gets the id
```

---

## 6. Child → parent communication

Only via callbacks passed down as props.

```jsx
function Child({ onSubmit }) {
  return <button onClick={() => onSubmit({ ok: true })}>Go</button>;
}
```

If you need to call a *method* on a child (focus an input, play a video, reset a form), that's imperative and uses a ref + `useImperativeHandle` ([Other Built-in Hooks](./26-other-built-in-hooks.md)) — a deliberate escape hatch, not the default.

---

## 7. Anti-patterns

### Duplicated state

```jsx
// ❌ two sources of truth that will drift
const [items, setItems] = useState(all);
const [filtered, setFiltered] = useState(all);

// ✅ one source, one derivation
const [items, setItems] = useState(all);
const [query, setQuery] = useState('');
const filtered = items.filter(i => i.name.includes(query));
```

### Syncing props into state with an effect

```jsx
// ❌ an extra render, and always one frame behind
const [name, setName] = useState(user.name);
useEffect(() => { setName(user.name); }, [user.name]);

// ✅ derive
const name = user.name;
// ✅ or, if you need an editable draft, reset by identity
<Form key={user.id} initialName={user.name} />
```

### Lifting too high

Putting a modal's `isOpen` in a global store means every consumer of that store re-renders when a modal opens, and the modal can't be used twice on one page. Keep state as **low** as it can go while still being reachable by everyone who needs it.

> The heuristic: **push state down until it breaks, then lift it one level.**

---

## 🧠 Rapid-fire recall

1. Give the decision procedure for where a piece of state should live.
2. In the temperature example, how many values are actually stored, and why does that matter?
3. What is the standard prop contract for a controlled component?
4. How does composition eliminate prop drilling without Context?
5. When is prop drilling acceptable?
6. Why is `useEffect(() => setX(prop), [prop])` an anti-pattern, and what replaces it?
7. What's the cost of lifting state too high?

<details>
<summary>Answers</summary>

1. Does anything render differently? (else use a ref) → Can it be derived? (else don't store it) → Put it at the lowest common ancestor of its readers → If that creates long pass-through chains, use composition, then Context, then a store → If it's server data, use a cache library instead.
2. One (`temp`) plus the scale it was entered in. The other reading is derived, so the two inputs can never disagree — synchronising two stored copies would be a permanent bug source.
3. `value` (or `checked`/`open`) plus a matching `onChange`/`onValueChange` callback; the parent owns the state and the child is a pure function of it.
4. By passing rendered *elements* through props or `children`. The element is created where the data lives, so intermediate components forward an opaque node and never see the data — they also stop re-rendering when it changes.
5. When it's two or three levels deep and one or two props. It's explicit, greppable, and cheaper than the alternatives.
6. It causes a second render pass (render with the stale value, effect, render again), leaves the UI briefly wrong, and adds a synchronisation path. Derive the value during render, or reset the component with a `key`.
7. Unnecessary re-renders across the app, the component becoming unusable in more than one place at a time, and state that outlives the UI it belongs to. Push state down until it breaks, then lift one level.

</details>
