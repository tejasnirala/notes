---
title: Lists & Keys
author: Tejas Nirala
---

# Lists & Keys

`key` looks like a warning-silencer. It is actually the identity system of the reconciler, and using it wrongly produces some of the most confusing bugs in React — lost input, wrong checkboxes, animations playing on the wrong row.

---

## 1. Rendering a list

```jsx
function TodoList({ todos }) {
  return (
    <ul>
      {todos.map(todo => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  );
}
```

`map` returns an array of elements; React renders arrays in order. `filter` before `map` to render a subset:

```jsx
{todos.filter(t => !t.done).map(t => <li key={t.id}>{t.text}</li>)}
```

---

## 2. What `key` is for

When React re-renders a list, it must answer: *"is this new element the same thing as an old element, or a different thing?"*

Without keys, it can only compare **by position**. With keys, it compares **by identity**.

```
                 Old list                  New list
                 ────────                  ────────
   position 0    <li>Ada</li>              <li>NEW</li>
   position 1    <li>Grace</li>            <li>Ada</li>
   position 2    <li>Alan</li>             <li>Grace</li>
                                           <li>Alan</li>
```

**By position (no keys):**

```
pos 0: 'Ada'   → 'NEW'    → mutate text
pos 1: 'Grace' → 'Ada'    → mutate text
pos 2: 'Alan'  → 'Grace'  → mutate text
pos 3: (none)  → 'Alan'   → CREATE a node

4 DOM mutations, and every existing component is treated as "the row changed"
```

**By key:**

```
key 'new' → not in old → CREATE and insert at the front
key 'ada', 'grace', 'alan' → matched → MOVE, no re-render of content

1 insertion. The three existing component instances, with all their state, survive.
```

---

## 3. The index-as-key bug — full trace

```jsx
{todos.map((todo, i) => <TodoItem key={i} todo={todo} />)}
```

`TodoItem` has local state — say a checkbox, or an "editing" text field.

**Scenario:** three todos; the user checks the box on "Buy milk"; then a new todo is prepended.

```
STEP 1 — initial render
  index 0 → key 0 → instance A → "Buy milk"    [ ] unchecked
  index 1 → key 1 → instance B → "Walk dog"    [ ]
  index 2 → key 2 → instance C → "Read book"   [ ]

STEP 2 — user checks the box on "Buy milk"
  instance A's LOCAL state: checked = true
  screen:  [x] Buy milk   [ ] Walk dog   [ ] Read book

STEP 3 — prepend "Call mum"
  new array: ["Call mum", "Buy milk", "Walk dog", "Read book"]
  index 0 → key 0 → React matches key 0 to instance A (state: checked = true)
                     and passes it todo = "Call mum"
  index 1 → key 1 → instance B, now given "Buy milk"
  index 2 → key 2 → instance C, now given "Walk dog"
  index 3 → key 3 → NEW instance D, "Read book"

  screen:  [x] Call mum   ← 💥 the checkmark moved to the WRONG todo
           [ ] Buy milk   ← 💥 lost its checkmark
           [ ] Walk dog
           [ ] Read book
```

The state stayed with the *position*, because the key was the position. With `key={todo.id}`:

```
STEP 3 — prepend, with stable ids
  key 'call-mum' → new → CREATE instance D
  key 'buy-milk' → matched → instance A keeps checked = true, just moves down
  screen:  [ ] Call mum
           [x] Buy milk   ✅
           [ ] Walk dog
           [ ] Read book
```

### When index-as-key is safe

All three must hold:

1. The list never reorders.
2. Items are never inserted or deleted except at the end.
3. The items have no local state, no refs, and no uncontrolled inputs.

A static footer-links list qualifies. Almost nothing else does.

---

## 4. Rules for keys

```jsx
<li key={todo.id}>          // ✅ stable, unique among SIBLINGS, from your data
<li key={Math.random()}>    // ❌ new key every render → destroy & recreate everything
<li key={i}>                // ⚠️  only for static lists
<li key={todo.text}>        // ⚠️  breaks if two todos have the same text or text is edited
```

- **Unique among siblings**, not globally. Two different lists may both use key `1`.
- **Stable across renders** for the same logical item.
- **Not derived from render-time randomness or the index** (unless the list is static).

If your data has no id, generate one **when you create the item**, not when you render it:

```jsx
// ✅ id assigned once, at creation
setTodos(t => [...t, { id: crypto.randomUUID(), text }]);
```

### Keys on fragments

```jsx
{rows.map(r => (
  <React.Fragment key={r.id}>      {/* shorthand <> cannot take a key */}
    <dt>{r.term}</dt>
    <dd>{r.definition}</dd>
  </React.Fragment>
))}
```

### The key goes on the outermost element of the map

```jsx
// ❌ key on the wrong element
{items.map(i => <div><Item key={i.id} /></div>)}

// ✅
{items.map(i => <div key={i.id}><Item /></div>)}
```

---

## 5. `key` as a state-reset tool

Because a changed key means "this is a different thing", you can use it deliberately.

```jsx
<ChatWindow key={conversationId} conversation={conv} />
```

```
conversationId 'a' → key 'a' → instance 1  (draft message: "hey th…")
switch to 'b'      → key 'b' → key differs → unmount instance 1, mount instance 2
                                → draft cleared, scroll reset, effects re-run  ✅
```

Without the key you'd need an effect that resets six pieces of state whenever the prop changes — more code, and always one field behind.

Other uses:

```jsx
<VideoPlayer key={src} src={src} />        // force a fresh <video> element
<Form key={resetCount} />                  // a "reset" button: setResetCount(c => c + 1)
```

Use sparingly: it throws away the whole subtree, including DOM nodes and effects.

---

## 6. Rendering patterns

### Empty, loading and error states

```jsx
function List({ status, items, error }) {
  if (status === 'loading') return <Spinner />;
  if (status === 'error')   return <Error message={error} />;
  if (items.length === 0)   return <Empty />;
  return <ul>{items.map(i => <Row key={i.id} item={i} />)}</ul>;
}
```

Handle the empty case explicitly — a blank screen is a bug report waiting to happen.

### Grouping

```jsx
const grouped = useMemo(() => Object.groupBy(items, i => i.category), [items]);

return Object.entries(grouped).map(([category, rows]) => (
  <section key={category}>
    <h2>{category}</h2>
    <ul>{rows.map(r => <li key={r.id}>{r.name}</li>)}</ul>
  </section>
));
```

Note the two independent key scopes: `category` among sections, `r.id` among list items.

### Table rows, with a stable sort

```jsx
const sorted = useMemo(
  () => [...rows].sort((a, b) => a[sortKey] > b[sortKey] ? 1 : -1),
  [rows, sortKey]
);
// keys are row ids → sorting MOVES the existing DOM rows instead of rewriting them
```

---

## 7. Long lists: virtualisation

10,000 rows means 10,000 fibers, 10,000 DOM nodes, and a frozen page. Virtualisation renders only what's visible.

```jsx
import { useVirtualizer } from '@tanstack/react-virtual';

function BigList({ rows }) {
  const parentRef = useRef(null);
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 5,                                  // render a few extra above/below
  });

  return (
    <div ref={parentRef} style={{ height: 600, overflow: 'auto' }}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map(item => (
          <div key={rows[item.index].id}
               style={{ position:'absolute', top:0, transform:`translateY(${item.start}px)`,
                        height: item.size, width:'100%' }}>
            {rows[item.index].name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

```
DOM nodes without virtualisation:  10,000
DOM nodes with virtualisation:     ~20  (visible window + overscan)
```

The spacer div preserves the correct scrollbar height; `transform` positions rows without triggering layout ([The DOM & The Browser](./01-dom-and-the-browser.md)).

---

## 8. Performance notes for lists

```jsx
// ❌ every row re-renders because onSelect is a new function each parent render
{items.map(i => <Row key={i.id} item={i} onSelect={() => select(i.id)} />)}

// ✅ stable handler; pass the id back through the event
const handleSelect = useCallback(id => select(id), []);
{items.map(i => <Row key={i.id} item={i} onSelect={handleSelect} />)}

const Row = React.memo(function Row({ item, onSelect }) {
  return <li onClick={() => onSelect(item.id)}>{item.name}</li>;
});
```

Or skip the per-row handler entirely with event delegation:

```jsx
<ul onClick={e => {
  const id = e.target.closest('li')?.dataset.id;
  if (id) select(id);
}}>
  {items.map(i => <li key={i.id} data-id={i.id}>{i.name}</li>)}
</ul>
```

---

## 🧠 Rapid-fire recall

1. What question does `key` answer for the reconciler?
2. Trace what happens to per-row checkbox state when you prepend an item to an index-keyed list.
3. Under exactly what conditions is `key={index}` safe?
4. Why is `key={Math.random()}` catastrophic?
5. Must keys be globally unique?
6. How do you deliberately reset a subtree's state, and what's the cost?
7. What does virtualisation change about the number of fibers and DOM nodes?

<details>
<summary>Answers</summary>

1. "Is this element in the new tree the same logical item as one in the old tree?" Without keys the answer is by position; with keys it's by identity, so React can move instances instead of rewriting them.
2. Every key shifts by one position, so React matches old instance state to the *new* item at that index — the checked state visually jumps to the wrong row, and the last row is created fresh.
3. Only when the list never reorders, items are only ever appended/removed at the end, and the rows hold no local state, refs or uncontrolled inputs.
4. The key differs on every render, so React thinks every item is brand new: it unmounts and remounts every row, destroying state, DOM nodes, focus and scroll on each render.
5. No — only unique among siblings in the same array.
6. Change its `key`. React unmounts the old subtree and mounts a fresh one, so all state, refs and DOM nodes are discarded and effects re-run — cheap for a form, expensive for a large tree.
7. It renders only the visible window plus overscan, so both fiber count and DOM node count drop from O(all rows) to O(visible rows), with a spacer element preserving scroll height.

</details>
