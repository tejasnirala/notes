---
title: Batching, Lanes & The Scheduler
author: Tejas Nirala
---

# Batching, Lanes & The Scheduler

Why do three `setState` calls produce one render? What decides that a keystroke jumps ahead of a background list update? This page covers React's scheduling layer — the part that turns "render this" into "render this, at this priority, in slices".

---

## 1. Batching

```jsx
function handleClick() {
  setA(1);      // does NOT render here
  setB(2);      // does NOT render here
  setC(3);      // does NOT render here
}                // ← ONE render happens after the handler returns
```

Without batching you'd get three renders and two intermediate screens the user never asked to see. React collects updates and flushes once.

```
setA ─┐
setB ─┼──▶ update queue ──▶ [handler returns] ──▶ one render ──▶ one commit
setC ─┘
```

### Automatic batching (React 18+)

Before React 18, batching only worked inside React event handlers. Anything asynchronous escaped it:

```jsx
// React 17
setTimeout(() => {
  setA(1);        // render 1
  setB(2);        // render 2   ← two renders, two paints
}, 0);

// React 18 with createRoot
setTimeout(() => {
  setA(1);
  setB(2);        // ONE render ✅
}, 0);
```

React 18 batches in **timeouts, promises, native event handlers and intervals** too, because updates now go through the Scheduler rather than being flushed synchronously by the setter.

### Opting out

```jsx
import { flushSync } from 'react-dom';

flushSync(() => { setA(1); });   // forces a synchronous render + commit right here
// the DOM is updated by this line
setB(2);                          // separate render
```

Use it only when you must read the updated DOM immediately — e.g. scrolling to a row you just added:

```jsx
flushSync(() => setRows([...rows, newRow]));
listRef.current.lastChild.scrollIntoView();   // the node exists now
```

It costs you a synchronous render and a potential extra paint. Rare by design.

---

## 2. Lanes: React's priority system

Every update is tagged with a **lane** — a bit in a 31-bit bitmask. Lanes replaced the older single-number `expirationTime` model because a bitmask can express *sets* of priorities and lets React work on several at once.

```
Higher priority ────────────────────────────────────────▶ Lower

SyncLane            discrete input: click, keypress, submit
InputContinuousLane continuous input: drag, scroll, mouseover
DefaultLane         normal updates: network responses, timers
TransitionLanes     startTransition / useTransition (16 of them)
RetryLanes          Suspense retries
IdleLane            truly background work
OffscreenLane       hidden/prerendered content
```

```js
// a bitmask, so membership tests and merges are single instructions
const SyncLane        = 0b0000000000000000000000000000010;
const DefaultLane     = 0b0000000000000000000000000100000;
const TransitionLane1 = 0b0000000000000000000000010000000;

root.pendingLanes |= SyncLane;                       // schedule
const next = getHighestPriorityLane(root.pendingLanes); // lowest set bit
```

### How a lane is chosen

React infers priority from **context**, not from you:

```jsx
onClick={() => setX(1)}                  // inside a discrete event → SyncLane
onScroll={() => setY(1)}                 // continuous event → InputContinuousLane
fetch().then(() => setZ(1))              // no event context → DefaultLane
startTransition(() => setW(1))           // explicitly marked → TransitionLane
```

When `setState` is called, React marks the fiber *and every ancestor up to the root* with the lane, so the next render knows which paths contain work.

---

## 3. The Scheduler

`scheduler` is a separate package. Its job: run a callback later, at a given priority, without blocking the browser.

### It does not use `setTimeout`

`setTimeout(fn, 0)` is clamped to ~4ms after nesting, and it's a macrotask that competes with everything. React uses a `MessageChannel`:

```js
const channel = new MessageChannel();
channel.port1.onmessage = performWorkUntilDeadline;
// schedule:
channel.port2.postMessage(null);       // a macrotask with no clamping
```

A macrotask (not a microtask) is deliberate: it yields to the browser between chunks so paint and input can happen. A microtask loop would starve them ([Async JavaScript](./04-async-javascript-and-the-event-loop.md)).

### The 5ms time slice

```js
function shouldYield() {
  return getCurrentTime() >= deadline;   // deadline = startTime + 5ms
}

function workLoopConcurrent() {
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
  // out of time → return; the Scheduler posts another message to continue
}
```

```
frame budget at 60fps: 16.6ms
 ├─ 5ms  React work slice
 ├─ yield → browser handles input, runs rAF, style, layout, paint
 ├─ 5ms  React work slice (resumes at the same workInProgress cursor)
 └─ …
```

Five milliseconds is empirical: long enough to make progress, short enough that a click is never delayed by more than one slice.

### Priority + timeout

The Scheduler keeps a min-heap of tasks ordered by expiration. Each priority has a timeout, so nothing starves forever:

| Scheduler priority | Timeout |
| :-- | :-- |
| Immediate | -1 (already expired — run synchronously) |
| UserBlocking | 250ms |
| Normal | 5s |
| Low | 10s |
| Idle | never expires |

If a Normal task sits for 5 seconds, it's promoted to expired and runs synchronously without yielding — progress is guaranteed.

---

## 4. Interruption: a full trace

```jsx
function Search() {
  const [query, setQuery]   = useState('');
  const [results, setResults] = useState(bigList);   // 10,000 rows

  function onChange(e) {
    setQuery(e.target.value);                     // urgent — SyncLane
    startTransition(() => {
      setResults(filter(bigList, e.target.value)); // non-urgent — TransitionLane
    });
  }
  return <><input value={query} onChange={onChange} /><Results rows={results} /></>;
}
```

**Trace typing "re" quickly:**

```
t=0ms    keypress 'r'
         setQuery('r')       → SyncLane      → flushed synchronously
         setResults(...)     → TransitionLane → scheduled
         ── COMMIT: input shows "r" immediately, PAINT ──

t=1ms    Scheduler runs the transition render
         work loop: 5ms slice → renders ~800 of 10,000 rows → shouldYield() → pause
t=6ms    yield; browser paints; no input pending
t=7ms    resume from the same cursor → another 800 rows → pause
t=12ms   resume …

t=15ms   keypress 'e' arrives  ← a SyncLane update while a transition is in progress
         React checks: incoming lane (Sync) has HIGHER priority than the
         in-progress lane (Transition)
         → ABANDON the work-in-progress tree entirely (it was never committed,
           so nothing is visible; this is safe precisely because render is pure)
         → render the Sync update: input shows "re", PAINT   ← input stays responsive
         → restart the transition from scratch with the new query

RESULT: the input never stutters. The heavy list render is discarded and redone.
```

Without transitions, the 10,000-row render would run synchronously and the second keystroke would be delayed by the entire render — the classic "typing lags in a big table" bug.

The cost is real: abandoned work is wasted work. Transitions trade throughput for responsiveness.

---

## 5. `flushSync`, `startTransition`, and the update-priority API

```jsx
// force synchronous — highest priority, no batching
flushSync(() => setX(1));

// mark as interruptible — lowest useful priority
startTransition(() => setX(1));

// with pending state
const [isPending, startTransition] = useTransition();
```

`startTransition` requires the update to be **synchronous inside the callback**:

```jsx
// ❌ the setState escapes the transition scope
startTransition(async () => {
  const data = await fetch(...);
  setResults(data);            // no longer inside the transition context
});

// ✅
const data = await fetch(...);
startTransition(() => setResults(data));
```

React 19 relaxes this for Actions, where `startTransition` understands async functions.

---

## 6. Where batching visibly matters

```jsx
// A form submit that sets four states — one render, one paint
async function submit() {
  setStatus('submitting');
  const res = await api.save(form);      // ← boundary: pre-await batch flushes
  setStatus('done');                     // React 18: these three are batched
  setResult(res);
  setErrors({});
}
```

```
setStatus('submitting') ──▶ batch 1 ──▶ render (spinner appears)
await …                                        (network)
setStatus / setResult / setErrors ──▶ batch 2 ──▶ ONE render (done state)
```

In React 17 the second group produced three renders and three paints — visible flicker on slow devices.

---

## 7. Debugging scheduling

```jsx
// React DevTools → Profiler → record an interaction
// Each commit shows: duration, which components rendered, and WHY
```

Enable "Record why each component rendered" in DevTools settings. In the flamegraph, a transition commit is labelled with its priority, so you can confirm your `startTransition` actually took effect.

```jsx
// Programmatic timing
<Profiler id="List" onRender={(id, phase, actual, base, start, commit) => {
  console.log(id, phase, actual);       // phase: 'mount' | 'update' | 'nested-update'
}}>
  <List />
</Profiler>
```

---

## 🧠 Rapid-fire recall

1. What is batching, and what changed about it in React 18?
2. When would you reach for `flushSync`, and what does it cost?
3. What is a lane, and why a bitmask rather than a number?
4. How does React decide an update's priority without you telling it?
5. Why does the Scheduler use `MessageChannel` instead of `setTimeout` or a microtask?
6. Trace what happens when a keystroke arrives during an in-progress transition render.
7. Why can React safely throw away a partially rendered tree?

<details>
<summary>Answers</summary>

1. Collecting multiple state updates and processing them in a single render/commit. React 18's `createRoot` extends batching from React event handlers to promises, timeouts, intervals and native handlers ("automatic batching").
2. When you must read or manipulate the updated DOM in the same tick — scrolling to a newly-added node, measuring after a change. It forces a synchronous render and commit, giving up batching and possibly causing an extra paint.
3. A single bit in a 31-bit priority mask attached to each update and propagated to ancestor fibers. A bitmask lets React represent a *set* of pending priorities and merge, test and select them with single machine instructions.
4. From the calling context: discrete events give SyncLane, continuous events InputContinuousLane, code with no event context DefaultLane, and `startTransition` a TransitionLane.
5. `setTimeout` is clamped (~4ms when nested) and competes with other timers; a microtask would never yield, starving paint and input. `postMessage` schedules an unclamped macrotask that lets the browser render between slices.
6. The keystroke's SyncLane outranks the in-progress TransitionLane, so React abandons the uncommitted work-in-progress tree, renders and commits the urgent update immediately, then restarts the transition from scratch with the newer state.
7. Because the render phase is pure and produces no side effects, and the tree was never committed — nothing user-visible or external depends on it, so dropping it is free apart from the wasted CPU.

</details>
