---
title: Reconciliation & The Diffing Algorithm
author: Tejas Nirala
---

# Reconciliation & The Diffing Algorithm

Reconciliation is the algorithm that answers: *given the old tree and the new tree, what is the minimum set of DOM operations?* Understanding its heuristics tells you exactly why some refactors reset state, why keys matter, and why component structure has performance consequences.

---

## 1. The problem, and why the optimal algorithm is unusable

Comparing two trees of size *n* optimally is **O(n³)**. For 1,000 nodes that's a billion operations per update — completely impossible at 60fps.

React ships an **O(n)** algorithm by accepting two heuristics that are wrong in theory and almost always right in practice:

> 1. **Two elements of different types produce different trees.** Don't bother diffing across a type change — throw the subtree away.
> 2. **The developer can hint at stability with `key`.** Children that keep their key across renders are the same logical item.

Everything below follows from those two sentences.

---

## 2. Heuristic 1 — different type means full replacement

```jsx
// render 1
<div><Counter /></div>

// render 2
<span><Counter /></span>
```

```
old:  div ─▶ Counter (state: count = 5, DOM node #A)
new:  span ─▶ Counter

React sees div ≠ span at this position:
   ✗ does NOT try to move Counter across
   ✗ does NOT diff the children
   → UNMOUNT the whole old subtree:
        Counter's cleanup effects run, its state is discarded, DOM node #A removed
   → MOUNT a fresh subtree:
        new <span>, new Counter instance, count = 0, effects run as if first mount
```

The same applies to component types:

```jsx
{isAdmin ? <AdminPanel /> : <UserPanel />}   // switching = unmount + mount, always
```

And to changing which element wraps something — the classic accidental-reset bug:

```jsx
// ❌ two different trees; toggling loses all form state
if (isFancy) return <div className="fancy"><Form /></div>;
return <section><Form /></section>;

// ✅ one tree; only an attribute changes
return <div className={isFancy ? 'fancy' : ''}><Form /></div>;
```

### Same type → update in place

```jsx
<div className="a" title="x" />   →   <div className="b" title="x" />
```

React keeps the DOM node and applies only the changed attributes:

```
node.className = 'b'        ← one write
title: unchanged → skipped
```

For a component of the same type, React keeps the fiber (and therefore all its hook state), updates `pendingProps`, and re-renders it.

---

## 3. Heuristic 2 — children, keys, and the two-pass algorithm

Diffing a list of children is where the real work happens. React's `reconcileChildrenArray` runs in phases.

### Phase 1: walk both lists from the start while keys match

```
old:  [A, B, C, D]
new:  [A, B, X, D]

i=0: key A vs A → same type → REUSE, update props
i=1: key B vs B → same type → REUSE
i=2: key C vs X → key mismatch → STOP the fast path
```

For pure appends this fast path handles everything, which is why appending to a list is cheap regardless of keys.

### Phase 2: build a map of the remaining old children, then match by key

```
remaining old: {C, D}  →  map { 'C': fiberC, 'D': fiberD }

new[2] = X  → not in map → CREATE (flag: Placement)
new[3] = D  → found in map → REUSE fiberD, delete it from the map
              (and decide whether it must MOVE — see below)

leftover in map: {C} → DELETE fiberC (flag: Deletion)
```

### Detecting moves with `lastPlacedIndex`

React tracks the highest old-index it has already placed. If a reused child's old index is **less** than that, it must move right; otherwise it can stay put.

```
old:  [A(0), B(1), C(2)]
new:  [C,    A,    B   ]

lastPlacedIndex = 0

new[0] = C: oldIndex 2 >= 0  → stays; lastPlacedIndex = 2
new[1] = A: oldIndex 0 <  2  → MOVE (Placement flag)
new[2] = B: oldIndex 1 <  2  → MOVE (Placement flag)

Result: 2 DOM moves. Note React did NOT find the theoretical minimum (1 move —
just relocating C to the front); the greedy single pass is O(n) and good enough.
```

**Consequence:** moving one item from the end to the front is cheap; moving one item from the front to the end causes every other item to be flagged as moved. Reversing a list is O(n) moves. This rarely matters, but it's the honest answer to "is React's diff optimal?" — no, it's linear and greedy.

---

## 4. Full trace: the index-key disaster, at fiber level

```jsx
{todos.map((t, i) => <TodoItem key={i} todo={t} />)}
```

`TodoItem` holds local state `isEditing`.

```
── RENDER 1 ────────────────────────────────────────────────
old tree:
   key 0 → fiber₀  props{todo:"Buy milk"}   memoizedState: isEditing=false
   key 1 → fiber₁  props{todo:"Walk dog"}   isEditing=false

user clicks edit on "Buy milk"  → fiber₀.memoizedState: isEditing=TRUE

── RENDER 2 (prepend "Call mum") ───────────────────────────
new elements:
   key 0 → <TodoItem todo="Call mum" />
   key 1 → <TodoItem todo="Buy milk" />
   key 2 → <TodoItem todo="Walk dog" />

reconcile:
   new[0] key 0 → matches fiber₀ → SAME TYPE → REUSE fiber₀
                  fiber₀.pendingProps = {todo: "Call mum"}
                  fiber₀.memoizedState (isEditing=TRUE) is KEPT   ← 💥
   new[1] key 1 → REUSE fiber₁, props become "Buy milk"
   new[2] key 2 → not in map → CREATE fiber₂

── SCREEN ──────────────────────────────────────────────────
   "Call mum"   ← in edit mode  💥 wrong row
   "Buy milk"   ← not editing   💥 lost its edit mode
   "Walk dog"
```

With `key={todo.id}`:

```
   new[0] key 'call-mum' → not in map → CREATE (fresh state)
   new[1] key 'buy-milk' → matches fiber₀ → REUSE with isEditing=TRUE ✅
   new[2] key 'walk-dog' → matches fiber₁ → REUSE ✅
```

State follows **identity**, and `key` is how you declare identity.

---

## 5. Structure is identity: the "same element, different position" rule

React matches children **by position within the same parent**, so these two are different components as far as reconciliation is concerned:

```jsx
{cond
  ? <div><Input /></div>
  : <Input />}
```

```
cond=true :  div ─▶ Input     Input is at depth 2
cond=false:  Input            Input is at depth 1
→ different positions → unmount + remount → the typed value is lost
```

And this, despite looking like "the same component":

```jsx
{isLeft ? <Counter /> : null}
{isLeft ? null : <Counter />}
```

Position 0 and position 1 are different slots, so toggling destroys and recreates. The fix is one slot with a changing prop, or a shared key.

---

## 6. What the diff produces: the effect list

`completeWork` bubbles each fiber's flags into `subtreeFlags` on its parent. The commit phase then walks only the flagged path.

```
        HostRoot (subtreeFlags: Update)
             │
            App (subtreeFlags: Update)
          ┌──┴──────────────┐
     Header(none)        Main(subtreeFlags: Update|Placement)
                          ┌──┴───────┐
                    List(Update)   Footer(none)
```

Commit visits `HostRoot → App → Main → List` and skips `Header` and `Footer` entirely — it can tell from `subtreeFlags === NoFlags` that nothing under them changed. Zero work for untouched branches.

Common flags:

| Flag | Meaning |
| :-- | :-- |
| `Placement` | insert or move this node |
| `Update` | change props/attributes/text |
| `Deletion` | remove this node |
| `Ref` | attach/detach a ref |
| `Passive` | has `useEffect` work |
| `Layout` | has `useLayoutEffect` work |

---

## 7. Practical rules that fall out of the algorithm

**Keep the tree shape stable.**

```jsx
// ❌ conditional wrapper changes the tree
return isMobile ? <Content /> : <Sidebar><Content /></Sidebar>;

// ✅ stable shape, conditional class
return <div className={isMobile ? 'mobile' : 'desktop'}><Content /></div>;
```

**Never define a component inside another component.**

```jsx
function Parent() {
  function Child() { return <input />; }   // ❌ a NEW function identity every render
  return <Child />;
}
```

```
render 1: type = Child@fn1  →  mount, DOM input created
render 2: type = Child@fn2  →  fn2 !== fn1 → DIFFERENT TYPE
          → unmount, destroy state, remount, new DOM node
          → the input loses focus and its value on every parent render 💀
```

Define components at module scope. If a component genuinely needs closure over parent data, pass props or use `children`.

**Use `key` to force a reset intentionally**, and only then.

**Don't fear deep trees.** The diff is O(n) in *changed* nodes; bailouts mean unchanged subtrees cost a pointer comparison.

---

## 8. Reconciliation vs rendering vs re-rendering — vocabulary

People use these interchangeably and confuse each other. Precisely:

| Term | Meaning |
| :-- | :-- |
| **Render** | React calls your component function to get an element tree |
| **Reconciliation** | Diffing the returned elements against the previous fibers |
| **Commit** | Applying the resulting mutations to the DOM |
| **Re-render** | A render after the first one |
| **Repaint** | The *browser* drawing pixels — nothing to do with React |

"React re-rendered" does **not** mean "the DOM changed". Most re-renders produce zero DOM operations — they just recompute a description that turns out to be identical.

---

## 🧠 Rapid-fire recall

1. What's the complexity of optimal tree diffing, and what two heuristics let React reach O(n)?
2. What happens when an element's type changes between renders?
3. Describe the two phases of child-list reconciliation.
4. What is `lastPlacedIndex` for, and what does it imply about reversing a list?
5. Trace, at the fiber level, why index keys move state to the wrong row.
6. Why does defining a component inside another component destroy state every render?
7. Does "re-rendered" mean "the DOM changed"?

<details>
<summary>Answers</summary>

1. O(n³). React assumes (a) different element types produce entirely different trees, so a type change means unmount + remount rather than a cross-type diff, and (b) `key` declares which children are the same logical item across renders.
2. React unmounts the entire old subtree — running cleanups, discarding state and removing DOM nodes — and mounts a completely fresh one.
3. Phase 1 walks both lists in parallel while keys match, reusing fibers (this handles appends). Phase 2 builds a key→fiber map of the remaining old children, matching new children against it: found = reuse (possibly move), missing = create, leftover = delete.
4. It tracks the highest old index already placed; a reused child with a smaller old index is flagged as a move. Reversing a list therefore flags nearly every item as moved — the algorithm is greedy and linear, not minimal.
5. Keys shift with position, so the fiber that held `isEditing = true` is matched to the *new* item at that index. React reuses the fiber (keeping `memoizedState`) and only swaps `pendingProps`, so the state appears on the wrong row.
6. The function identity changes each render, so the element `type` differs. Different type = unmount + remount, discarding state, refs and DOM nodes (and focus).
7. No. A re-render recomputes the element description; if the diff finds nothing changed, zero DOM operations are committed.

</details>
