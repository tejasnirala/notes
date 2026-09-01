---
title: Composition Patterns
author: Tejas Nirala
---

# Composition Patterns

React's answer to almost every "how do I share this?" question is composition. This page collects the patterns that actually get used in production component libraries, with the trade-offs of each.

---

## 1. Containment with `children`

The simplest and most under-used pattern.

```jsx
function Card({ children }) {
  return <div className="card">{children}</div>;
}

<Card><Profile /></Card>
```

Why it matters beyond convenience: `<Profile />` is created by `Card`'s **parent**, so when `Card` re-renders for its own reasons, the `children` element reference is unchanged and React can bail out of re-rendering `Profile` entirely ([What Causes Re-renders](./37-what-causes-rerenders.md)).

### Multiple slots

```jsx
function Dialog({ title, body, footer }) {
  return (
    <div role="dialog">
      <header>{title}</header>
      <main>{body}</main>
      <footer>{footer}</footer>
    </div>
  );
}

<Dialog
  title={<h2>Delete file?</h2>}
  body={<p>This cannot be undone.</p>}
  footer={<><Button>Cancel</Button><Button variant="danger">Delete</Button></>}
/>
```

Elements are just values. Passing them as props is ordinary JavaScript, and it's how you avoid inventing `titleText`, `titleIcon`, `titleClassName`, `titleOnClick`…

---

## 2. Compound components

Related components that share implicit state through context, so the consumer controls the markup.

```jsx
const TabsContext = createContext(null);

export function Tabs({ defaultValue, children }) {
  const [value, setValue] = useState(defaultValue);
  const ctx = useMemo(() => ({ value, setValue }), [value]);
  return <TabsContext.Provider value={ctx}><div className="tabs">{children}</div></TabsContext.Provider>;
}

Tabs.List = function TabsList({ children }) {
  return <div role="tablist">{children}</div>;
};

Tabs.Trigger = function TabsTrigger({ value, children }) {
  const ctx = useContext(TabsContext);
  const selected = ctx.value === value;
  return (
    <button role="tab" aria-selected={selected} onClick={() => ctx.setValue(value)}>
      {children}
    </button>
  );
};

Tabs.Panel = function TabsPanel({ value, children }) {
  const ctx = useContext(TabsContext);
  return ctx.value === value ? <div role="tabpanel">{children}</div> : null;
};
```

```jsx
<Tabs defaultValue="a">
  <Tabs.List>
    <Tabs.Trigger value="a">First</Tabs.Trigger>
    <Tabs.Trigger value="b">Second</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="a">Panel A</Tabs.Panel>
  <Tabs.Panel value="b">Panel B</Tabs.Panel>
</Tabs>
```

**Compare with the config-prop version:**

```jsx
// ❌ every layout change means a new prop
<Tabs
  tabs={[{label:'First', content:<A/>}]}
  tabClassName="…" listClassName="…" renderTab={…} tabsPosition="top"
/>
```

The compound version pushes layout decisions to the consumer while keeping the *behaviour* (selection, keyboard nav, ARIA wiring) inside. This is why Radix, Headless UI, Ark and shadcn/ui are all built this way.

Trade-off: more components to import, and the parts only work inside their parent — so throw a clear error if the context is missing ([useContext](./24-useContext.md)).

---

## 3. Render props / children as a function

The component owns the logic; the caller owns the markup.

```jsx
function Toggle({ children }) {
  const [on, setOn] = useState(false);
  return children({ on, toggle: () => setOn(o => !o) });
}

<Toggle>{({ on, toggle }) => <button onClick={toggle}>{on ? 'On' : 'Off'}</button>}</Toggle>
```

Mostly superseded by custom hooks — a hook does the same thing with no nesting and better types. It survives in two places:

1. When the component must control *where* in the tree the render happens (virtualisers, `<AnimatePresence>`, drag-and-drop libraries).
2. When the logic needs to render something itself (e.g. a measuring wrapper).

```jsx
<Virtuoso data={items} itemContent={(i, item) => <Row item={item} />} />
```

---

## 4. Higher-Order Components

```jsx
function withLogging(Component) {
  return function Logged(props) {
    useEffect(() => { log(Component.displayName); }, []);
    return <Component {...props} />;
  };
}
```

Mostly legacy, but you must recognise it: `connect()` from Redux, `withRouter`, `React.memo` (which is technically an HOC), and Next.js's older auth wrappers.

If you must write one:

```jsx
function withAuth(Component) {
  function Wrapped(props) {
    const { user } = useAuth();
    if (!user) return <Login />;
    return <Component {...props} user={user} />;
  }
  Wrapped.displayName = `withAuth(${Component.displayName ?? Component.name})`;  // DevTools
  return Wrapped;
}
```

Problems it brings: prop-name collisions between stacked HOCs, opaque prop origins, extra tree depth, and refs that don't pass through without `forwardRef`. Prefer a hook.

---

## 5. Slots and `asChild`

Letting a consumer swap the rendered element without losing behaviour:

```jsx
import { Slot } from '@radix-ui/react-slot';   // already a dependency in this repo

function Button({ asChild, ...props }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className="btn" {...props} />;
}

<Button>Click</Button>                          {/* renders <button class="btn"> */}
<Button asChild><a href="/x">Go</a></Button>    {/* renders <a class="btn" href="/x"> */}
```

`Slot` merges its props onto its single child instead of rendering a wrapper. This solves the "I need a link that looks like a button" problem without a `Link`-specific variant, and without an extra DOM node.

---

## 6. Controlled / uncontrolled duality

Covered in [Lifting State](./12-lifting-state-and-data-flow.md); it belongs in your pattern vocabulary:

```jsx
<Accordion defaultValue="a" />                       // uncontrolled: manages itself
<Accordion value={v} onValueChange={setV} />         // controlled: you own it
```

Every serious component library supports both, via the `useControllable` pattern.

---

## 7. Provider composition

```jsx
function Providers({ children }) {
  return [ThemeProvider, AuthProvider, QueryProvider]
    .reduceRight((acc, P) => <P>{acc}</P>, children);
}
```

Keeps the root readable and makes the ordering explicit and reorderable.

---

## 8. The "extract state, not markup" refactor

When a component gets big, the instinct is to split the JSX. Usually the better split is the *state*.

```jsx
// ❌ before: one component, 5 states, 200 lines
function Dashboard() {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('name');
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  // ...200 lines of JSX. Typing in the filter re-renders EVERYTHING.
}

// ✅ after: state pushed down to who needs it
function Dashboard() {
  return <>
    <Filters />          {/* owns filter + sort */}
    <Table />            {/* owns selected + page */}
    <DetailModal />      {/* owns modalOpen */}
  </>;
}
```

Now typing in `Filters` re-renders `Filters`, not the table. This is the single highest-leverage React performance refactor, and it's free — no memoisation involved.

When the split pieces genuinely need shared state, lift only that piece (or use a context/store for it), not all five.

---

## 9. Choosing a pattern

```
Need to share LOGIC across components?              → custom hook
Need to share MARKUP structure with variants?       → children + slot props
Need related components with implicit shared state? → compound components
Need the consumer to control where output goes?     → render prop
Need to swap the rendered element?                  → asChild / Slot
Need to wrap many components uniformly (legacy)?    → HOC
Need to reduce re-renders?                          → move state down, then children-as-props
```

---

## 🧠 Rapid-fire recall

1. What performance property does passing `children` have, and why?
2. What does the compound-component pattern give the consumer that a config-prop API doesn't?
3. Why are render props mostly obsolete, and where do they survive?
4. Name three problems with HOCs.
5. What does `asChild`/`Slot` solve?
6. Why is "extract state, not markup" usually the better refactor?
7. Which pattern do you reach for to share stateful logic?

<details>
<summary>Answers</summary>

1. The child elements are created by the parent of the wrapper, so their references don't change when the wrapper re-renders — React can bail out of re-rendering that subtree without any memoisation.
2. Control of the markup and layout. Behaviour, state and ARIA wiring stay inside the components, while structure, ordering and styling are the consumer's, so new layouts don't require new props.
3. Custom hooks share the same logic with no tree nesting, better types and no callback pyramid. Render props survive where the component must control *where* rendering happens — virtualisers, animation presence, drag-and-drop.
4. Prop-name collisions when stacked, opaque prop origins, extra depth in the tree/DevTools, and refs not forwarding without extra work.
5. Rendering a component's behaviour and styling onto a different element supplied by the consumer (e.g. an `<a>` that looks and behaves like a button) without an extra wrapper node or a bespoke variant.
6. Splitting markup alone leaves one component owning all the state, so every update still re-renders everything. Pushing state down to the component that uses it eliminates renders rather than skipping them, with no memoisation.
7. A custom hook.

</details>
