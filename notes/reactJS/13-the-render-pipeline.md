---
title: The Render Pipeline & Fiber
author: Tejas Nirala
---

# The Render Pipeline & Fiber

This is the page that turns React from a set of rules into a machine you understand. Everything downstream — hooks, batching, Suspense, `useLayoutEffect` timing, StrictMode — falls out of the architecture described here.

---

## 1. Three phases

A React update always goes through the same three stages:

```
 ┌───────────┐      ┌────────────────────────┐      ┌────────────────────────┐
 │  TRIGGER  │  ──▶ │        RENDER          │  ──▶ │        COMMIT          │
 │           │      │                        │      │                        │
 │ setState  │      │ call components        │      │ mutate the real DOM    │
 │ or first  │      │ build the new fiber    │      │ run layout effects     │
 │ mount     │      │ tree, diff vs old      │      │ ── browser paints ──   │
 │           │      │ compute the effect list│      │ run passive effects    │
 └───────────┘      └────────────────────────┘      └────────────────────────┘
                     INTERRUPTIBLE, no side          SYNCHRONOUS, cannot be
                     effects, can be discarded       interrupted or abandoned
```

The asymmetry is the whole design. **Render is pure and abandonable; commit is atomic and irreversible.**

- Render can be paused, resumed, thrown away and restarted from scratch — which is why your components must be pure ([Components & Props](./07-components-and-props.md)).
- Commit must be all-or-nothing, or users would see a half-updated screen ("tearing").

---

## 2. What a Fiber is

Before React 16, the reconciler walked your element tree with **recursion**. Recursion cannot be paused — once you're 40 stack frames deep, you finish or you throw away everything.

React 16 replaced it with **Fiber**: the tree, re-expressed as a linked list of plain objects, walked with an explicit loop. Now "where am I?" is a variable, not a call stack — so React can stop, hand the thread back to the browser, and resume later.

```js
// simplified — the real one has ~40 fields
{
  tag: FunctionComponent,     // what kind of node
  type: Counter,              // the function/class/'div'
  key: null,
  stateNode: null,            // the DOM node (host components) or class instance

  // TREE STRUCTURE — a linked list, not an array of children
  return: parentFiber,        // ← "return" because it's where the loop returns to
  child:  firstChildFiber,
  sibling: nextSiblingFiber,

  // WORK
  pendingProps: {…},          // the incoming props
  memoizedProps: {…},         // the props from the last committed render
  memoizedState: hookList,    // ← your hooks live HERE (a linked list)
  updateQueue: {…},           // pending state updates / effects

  flags: Placement | Update,  // what the commit phase must do to this node
  lanes: …,                   // priority bits
  alternate: otherFiber,      // the corresponding fiber in the other tree
}
```

### The tree, as links

For this JSX:

```jsx
<App>
  <Header />
  <Main>
    <Post />
  </Main>
</App>
```

```
                 App
                  │ child
                  ▼
               Header ──sibling──▶ Main
                  │                 │ child
             return│                ▼
                  ▲               Post
                  └── every node's `return` points back up
```

Traversal is: go to `child`; if none, go to `sibling`; if none, go up via `return` and try *its* sibling. This is a depth-first walk with an explicit cursor — pausable at any node.

---

## 3. Double buffering: current and workInProgress

React keeps **two** fiber trees.

```
        ┌──────────────────┐                   ┌────────────────────────┐
        │   CURRENT tree   │ ◀── alternate ──▶ │  WORK-IN-PROGRESS tree │
        │  what's on screen│                   │  what's being built    │
        └──────────────────┘                   └────────────────────────┘
                    ▲                                       │
                    │        commit: swap the pointer       │
                    └───────────────────────────────────────┘
```

- `FiberRoot.current` points at the committed tree.
- A render builds the WIP tree, reusing (cloning) fibers from `current` where nothing changed.
- On commit, React flips `root.current = workInProgressTree` — one pointer assignment.
- The old tree becomes the next render's scratch space. Two trees, reused forever: no garbage-collection churn.

This is exactly the graphics technique of double buffering, and it's why an abandoned render costs nothing: React just drops the WIP tree.

---

## 4. The render phase, step by step

```
performConcurrentWorkOnRoot
  └─ workLoop:
       while (workInProgress !== null && !shouldYield()) {
         performUnitOfWork(workInProgress);
       }
```

Each unit of work has two halves:

**`beginWork(fiber)` — going down**

1. Compare `pendingProps` with `memoizedProps` and check the fiber's lanes. If nothing changed and no update is scheduled → **bail out**, clone the subtree, skip it entirely.
2. Otherwise, do the work for this node type:
   - Function component → **call your function**, which runs its hooks.
   - Host component (`'div'`) → prepare the DOM props.
3. Reconcile the returned children against the old children (see [Reconciliation](./14-reconciliation-and-diffing.md)), producing child fibers with `flags` set.
4. Return the first child as the next unit of work.

**`completeWork(fiber)` — coming back up**

1. For host components, create the actual DOM node (not attached yet) or compute the props diff.
2. Bubble the child fibers' flags up into the parent's `subtreeFlags`, building the **effect list** — so the commit phase can skip whole subtrees that changed nothing.
3. Move to the sibling, or continue up.

**`shouldYield()`** checks whether the current 5ms time slice has expired. If so, the loop returns and React lets the browser paint and handle input — then resumes from the same `workInProgress` cursor. This is time slicing ([Concurrent React](./16-concurrent-react.md)).

---

## 5. The commit phase, step by step

Commit is synchronous and runs in three sub-phases, in this exact order. Memorise it — it explains all effect timing.

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │ 1. BEFORE MUTATION                                                  │
 │    getSnapshotBeforeUpdate (classes)                                │
 │    read the DOM as it still is — e.g. current scroll position       │
 ├─────────────────────────────────────────────────────────────────────┤
 │ 2. MUTATION                                                         │
 │    insert / update / delete DOM nodes                               │
 │    detach refs of removed nodes                                     │
 │    run useLayoutEffect CLEANUPS of removed/updated nodes            │
 ├─────────────────────────────────────────────────────────────────────┤
 │    ⇄ root.current = workInProgress   (the swap happens here)        │
 ├─────────────────────────────────────────────────────────────────────┤
 │ 3. LAYOUT                                                           │
 │    attach refs                                                      │
 │    run useLayoutEffect callbacks          ← SYNCHRONOUS, blocks paint│
 │    componentDidMount / componentDidUpdate                           │
 └─────────────────────────────────────────────────────────────────────┘
                              │
                     🖼  BROWSER PAINTS
                              │
 ┌─────────────────────────────────────────────────────────────────────┐
 │ 4. PASSIVE EFFECTS  (asynchronous, after paint)                     │
 │    useEffect cleanups, then useEffect callbacks                     │
 └─────────────────────────────────────────────────────────────────────┘
```

### Why `useLayoutEffect` and `useEffect` differ

```jsx
useLayoutEffect(() => { /* runs in phase 3 — BEFORE the browser paints */ });
useEffect(()       => { /* runs in phase 4 — AFTER the browser paints  */ });
```

**Trace a tooltip that must be positioned before it's visible:**

```
With useEffect:
  commit DOM (tooltip at 0,0) → PAINT  ← user sees it in the corner for one frame
  → effect measures and sets position → re-render → PAINT
  RESULT: a visible flicker

With useLayoutEffect:
  commit DOM (tooltip at 0,0)
  → layout effect measures and sets position (still before paint)
  → React flushes the resulting update synchronously
  → PAINT once, already positioned
  RESULT: no flicker, at the cost of blocking the frame
```

The rule: `useLayoutEffect` only when you must **measure the DOM and mutate it before the user can see the intermediate state**. Everything else uses `useEffect`. See [useLayoutEffect](./20-useLayoutEffect-and-effect-timing.md).

---

## 6. A complete trace: one click

```jsx
function App() {
  const [count, setCount] = useState(0);
  return (
    <div className="app">
      <Header />
      <button onClick={() => setCount(count + 1)}>{count}</button>
    </div>
  );
}
```

The user clicks once.

```
── TRIGGER ────────────────────────────────────────────────────────────
1. Native click reaches the root container listener.
2. React dispatches to the onClick on the button's fiber.
3. setCount(1):
     • create an update object {action: 1, lane: SyncLane}
     • push it onto the useState hook's update queue on App's fiber
     • mark App's fiber and every ancestor up to the root with that lane
     • scheduleUpdateOnFiber → ask the Scheduler for a callback
4. Handler returns. React flushes at the end of the event (batching).

── RENDER PHASE (building the WIP tree) ──────────────────────────────
5. workInProgress = clone of HostRoot fiber
6. beginWork(HostRoot) → child is App
7. beginWork(App)
     • App has a pending lane → cannot bail out
     • CALL App()  → useState reads the queue: 0 → 1, returns [1, setCount]
     • returns the new element tree
     • reconcile children: <div className="app"> matches the old div by type
8. beginWork(div)
     • props identical → the DOM node is reused; children reconciled
9. beginWork(Header)
     • pendingProps === memoizedProps AND no lanes on this fiber
     • → BAILOUT. Header() is NOT called. Its subtree is cloned wholesale.
10. beginWork(button)
     • children changed: '0' → '1' → flags |= Update
11. completeWork walks back up, bubbling flags:
     button(Update) → div(subtreeFlags: Update) → App → HostRoot

── COMMIT PHASE ──────────────────────────────────────────────────────
12. Before mutation: nothing to do.
13. Mutation: walk the effect list — one node has Update
       → textNode.nodeValue = '1'      ← the ONLY DOM write in this update
14. Swap: root.current = workInProgress
15. Layout: no layout effects here.
    ── browser paints ──
16. Passive: no useEffects here.
```

**One DOM text mutation.** `Header` was never even called. That is what React buys you.

---

## 7. Where hooks live

`fiber.memoizedState` is a **linked list of hook objects**, in the order you called them:

```
App fiber
  memoizedState ──▶ hook#1 ──next──▶ hook#2 ──next──▶ hook#3 ──▶ null
                    useState        useEffect         useRef
                    {memoizedState: 1,
                     queue: {pending: …},
                     next: hook#2}
```

There are no names — only positions. That single implementation fact is the entire reason for the Rules of Hooks. See [How Hooks Work Internally](./18-how-hooks-work-internally.md).

---

## 8. Bailouts: when React skips your component

During `beginWork`, React skips calling a component when **all** of these hold:

1. `oldProps === newProps` (reference equality on the props object).
2. No pending update (lane) on this fiber.
3. Context it consumes hasn't changed.
4. The element type is identical.

Condition 1 is subtle: JSX creates a *new* props object on every parent render, so a child normally fails it. It succeeds when:

- the parent itself bailed out and cloned the subtree, or
- the element was created elsewhere and passed through (`children` / element props), or
- `React.memo` intervenes and does a shallow prop comparison instead.

This is precisely why the "pass children instead of rendering inline" trick works ([What Causes Re-renders](./37-what-causes-rerenders.md)).

---

## 9. The mental model in one diagram

```
  setState
     │
     ▼
  mark fiber + ancestors with a LANE ──▶ schedule work
     │
     ▼
  RENDER (interruptible, pure)
     beginWork  ↓  call components, reconcile, set flags
     completeWork ↑ create DOM nodes, bubble flags
     yields every ~5ms if the lane is low priority
     │
     ▼
  COMMIT (synchronous, atomic)
     mutation → swap trees → layout effects → PAINT → passive effects
```

---

## 🧠 Rapid-fire recall

1. Name the three phases and say which one may be interrupted.
2. Why did React replace recursion with the fiber linked list?
3. What are the two fiber trees, and what happens at the moment of commit?
4. What are the two halves of a unit of work, and what does each do?
5. In which commit sub-phase does `useLayoutEffect` run, and where does painting sit relative to `useEffect`?
6. Trace one click on a counter and say exactly how many DOM writes occur.
7. Name the conditions under which React bails out of rendering a component.

<details>
<summary>Answers</summary>

1. Trigger, Render, Commit. Only render is interruptible — it's pure and can be abandoned; commit is synchronous and atomic so users never see a half-updated screen.
2. Recursion puts traversal state on the call stack, which cannot be paused or resumed. A linked list with an explicit `workInProgress` cursor lets React yield to the browser and continue exactly where it stopped.
3. `current` (on screen) and `workInProgress` (being built), linked through each fiber's `alternate`. Commit swaps `root.current` to the WIP tree — a single pointer assignment.
4. `beginWork` descends: checks for a bailout, calls the component, reconciles children and sets flags. `completeWork` ascends: creates/updates host DOM instances and bubbles child flags into `subtreeFlags` to build the effect list.
5. `useLayoutEffect` runs in the layout sub-phase, synchronously after DOM mutation and *before* paint. `useEffect` runs asynchronously *after* paint.
6. Trigger → queue the update and mark lanes; render → call `App`, bail out of `Header`, mark the button's text as Update; commit → exactly one text-node write, then the tree swap.
7. Same element type, identical props object by reference, no pending lane on the fiber, and no changed context it subscribes to. `React.memo` substitutes a shallow prop comparison for the reference check.

</details>
