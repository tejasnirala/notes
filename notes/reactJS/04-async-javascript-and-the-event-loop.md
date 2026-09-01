---
title: Async JavaScript & The Event Loop
author: Tejas Nirala
---

# Async JavaScript & The Event Loop

React's batching, its scheduler, `startTransition`, why two `setState` calls produce one render, and why a `useEffect` cleanup can run before your `fetch` resolves — all of it is the event loop. Learn it once here.

---

## 1. JavaScript has one thread

One call stack. One thing at a time. If your code runs for 300ms, the page is frozen for 300ms — no clicks, no scrolling, no paint.

```js
function block() {
  const end = Date.now() + 3000;
  while (Date.now() < end) {}     // the tab is completely dead for 3 seconds
}
```

So how does `setTimeout` work? **The runtime is not just the engine.** The browser provides Web APIs (timers, network, DOM events) that run *outside* the JS thread and hand results back through queues.

```
 ┌─────────────────────────────────────────────────────────────┐
 │ JS Engine                                                   │
 │   ┌────────────┐          ┌────────────────────┐            │
 │   │ Call Stack │          │   Heap (objects)   │            │
 │   └─────┬──────┘          └────────────────────┘            │
 └─────────┼───────────────────────────────────────────────────┘
           │ calls
           ▼
 ┌──────────────────────┐   when done, push callback to a queue
 │  Web APIs (browser)  │ ─────────────────────────┐
 │  timers, fetch, DOM  │                          │
 └──────────────────────┘                          ▼
                                  ┌──────────────────────────────┐
   EVENT LOOP: when the stack     │ Microtask queue (priority 1) │ promises
   is empty, drain ALL microtasks │ Macrotask queue (priority 2) │ timers, events
   then take ONE macrotask        └──────────────────────────────┘
```

---

## 2. Microtasks vs macrotasks — the rule

**The event loop, in one sentence:** when the call stack empties, drain the *entire* microtask queue, then render if it's time, then take *one* macrotask, then repeat.

| Microtasks (drained completely, every time) | Macrotasks (one per loop turn) |
| :-- | :-- |
| `.then` / `.catch` / `.finally` callbacks | `setTimeout`, `setInterval` |
| `await` continuations | DOM events (click, input) |
| `queueMicrotask` | `setImmediate` (Node), I/O |
| `MutationObserver` | `requestAnimationFrame` (special: before paint) |

### The canonical trace

```js
console.log('1');

setTimeout(() => console.log('2'), 0);

Promise.resolve().then(() => console.log('3'));

console.log('4');
```

Output: `1, 4, 3, 2`. Step by step:

```
STACK: [main]
  log('1')                        → prints 1
  setTimeout(cb, 0)               → handed to the timer API
  Promise.resolve().then(cb)      → cb queued as a MICROtask immediately
  log('4')                        → prints 4
STACK: []   ← main script finished

EVENT LOOP:
  microtask queue = [log3]  → drain ALL of it  → prints 3
  microtask queue = []
  macrotask queue = [log2]  → take ONE         → prints 2
```

### Microtasks can starve the loop

```js
function loop() { Promise.resolve().then(loop); }
loop();       // page freezes forever — the microtask queue never empties
```

Whereas `setTimeout(loop, 0)` yields to the browser each turn, letting it paint and handle input. That difference is the reason React's scheduler uses a macrotask (`MessageChannel`) to slice work, not a microtask.

---

## 3. Promises

A Promise is an object representing a value that isn't available yet. It has exactly three states, and transitions are **one-way and permanent**:

```
                ┌──────────┐
                │ PENDING  │
                └────┬─────┘
           resolve() │  reject()
              ┌──────┴──────┐
              ▼             ▼
       ┌────────────┐  ┌──────────┐
       │ FULFILLED  │  │ REJECTED │      (together: "settled")
       │  + value   │  │ + reason │
       └────────────┘  └──────────┘
```

```js
const p = new Promise((resolve, reject) => {
  setTimeout(() => resolve('done'), 1000);
});

p.then(v => console.log(v))          // 'done'
 .catch(e => console.error(e))
 .finally(() => console.log('cleanup'));
```

### Chaining: each `.then` returns a NEW promise

```js
fetch('/api/user')
  .then(res => res.json())        // returns a promise → the chain WAITS for it
  .then(user => user.name)        // returns a value    → wrapped in a resolved promise
  .then(name => console.log(name))
  .catch(err => console.error(err));   // catches errors from ANY step above
```

Two traps:

```js
// ❌ forgot to return → the next .then gets undefined
.then(res => { res.json(); })
// ✅
.then(res => res.json())

// ❌ fetch does NOT reject on 404/500 — only on network failure
const res = await fetch('/api/missing');   // resolves with res.ok === false
// ✅
if (!res.ok) throw new Error(`HTTP ${res.status}`);
```

### Combinators

```js
await Promise.all([a, b, c]);         // all fulfil → array of values; ANY reject → rejects
await Promise.allSettled([a, b, c]);  // never rejects → [{status, value|reason}, ...]
await Promise.race([a, b]);           // first to SETTLE (fulfil or reject) wins
await Promise.any([a, b]);            // first to FULFIL wins; rejects only if all reject
```

`Promise.race` is how you build a timeout:

```js
const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
]);
```

---

## 4. `async` / `await`

`async` functions **always** return a promise. `await` pauses the function and schedules the rest of it as a microtask.

```js
async function load() {
  try {
    const res  = await fetch('/api/user');
    if (!res.ok) throw new Error(res.status);
    const user = await res.json();
    return user;
  } catch (err) {
    console.error(err);
    throw err;                 // re-throw so callers can react
  } finally {
    setLoading(false);
  }
}
```

### Sequential vs parallel — a real performance decision

```js
// ❌ 3 seconds — each await blocks the next
const user  = await fetchUser();     // 1s
const posts = await fetchPosts();    // 1s
const tags  = await fetchTags();     // 1s

// ✅ 1 second — all three start immediately
const [user, posts, tags] = await Promise.all([
  fetchUser(), fetchPosts(), fetchTags(),
]);
```

```
Sequential:  [--user--][--posts--][--tags--]   3s
Parallel:    [--user--]
             [--posts-]                        1s
             [--tags--]
```

Only go sequential when a later call genuinely needs an earlier result.

### `await` in loops

```js
// ❌ sequential, one at a time
for (const id of ids) await fetchItem(id);

// ✅ parallel
await Promise.all(ids.map(id => fetchItem(id)));

// ⚠️ forEach does NOT await — this returns before any fetch finishes
ids.forEach(async id => await fetchItem(id));
```

---

## 5. Cancellation with `AbortController`

This is the single most important async pattern in React, because component unmounts and prop changes constantly orphan in-flight requests.

```js
const controller = new AbortController();

fetch('/api/data', { signal: controller.signal })
  .then(r => r.json())
  .catch(err => {
    if (err.name === 'AbortError') return;   // expected — ignore
    throw err;
  });

controller.abort();     // cancels it
```

In React:

```jsx
useEffect(() => {
  const ac = new AbortController();

  fetch(`/api/user/${id}`, { signal: ac.signal })
    .then(r => r.json())
    .then(setUser)
    .catch(e => { if (e.name !== 'AbortError') setError(e); });

  return () => ac.abort();          // cleanup runs on unmount AND before the next run
}, [id]);
```

### The race condition it prevents — trace it

Without abort, with the user typing quickly so `id` goes 1 → 2:

```
t=0ms   id=1 → effect → fetch(user/1) starts   [slow: 500ms]
t=50ms  id=2 → effect → fetch(user/2) starts   [fast: 100ms]
t=150ms user/2 resolves → setUser(user2)   ✅ screen shows user 2
t=500ms user/1 resolves → setUser(user1)   💥 screen now shows user 1 — WRONG

The stale, slower response overwrote the correct one.
```

With `return () => ac.abort()`:

```
t=0ms   id=1 → fetch(user/1)
t=50ms  id changes → CLEANUP of the previous effect runs FIRST → ac.abort()
                   → fetch(user/1) rejects with AbortError → swallowed
        → new effect → fetch(user/2)
t=150ms user/2 resolves → setUser(user2)   ✅ and nothing overwrites it
```

The "ignore-flag" variant, for APIs without abort support:

```jsx
useEffect(() => {
  let cancelled = false;
  load().then(d => { if (!cancelled) setData(d); });
  return () => { cancelled = true; };
}, [id]);
```

---

## 6. `requestAnimationFrame` and the frame budget

At 60fps you have **16.6ms** per frame for JS + style + layout + paint. `requestAnimationFrame` schedules a callback for just *before* the next paint:

```js
requestAnimationFrame(() => {
  el.style.transform = `translateX(${x}px)`;
});
```

Where it sits in a loop turn:

```
 ─── task ─── drain microtasks ─── rAF callbacks ─── style/layout/paint ───▶
```

React's Concurrent Scheduler cares about this window: it does a chunk of render work, checks whether it has exceeded its ~5ms slice, and if so yields so the browser can paint and process input. See [Batching & The Scheduler](./15-batching-and-the-scheduler.md).

---

## 7. Putting it together: how React batches

```jsx
function handleClick() {
  setA(1);
  setB(2);
  setC(3);
  console.log(a);     // still the OLD value — state is a snapshot
}
```

```
click event (a MACROTASK) begins
  ├─ React marks the root as needing work
  ├─ setA → queue update, schedule a render
  ├─ setB → queue update, render already scheduled
  ├─ setC → queue update
  ├─ console.log(a) → reads this render's frozen binding → old value
  └─ handler returns
event finishes → React processes the queue → ONE render with a=1,b=2,c=3
```

Since React 18, this batching also applies inside promises, timeouts and native handlers ("automatic batching"), because React schedules the work rather than doing it synchronously in the setter.

---

## 🧠 Rapid-fire recall

1. Why does `Promise.resolve().then(f)` run before `setTimeout(f, 0)`?
2. What happens if a microtask keeps queueing another microtask?
3. Does `fetch` reject on a 500 response?
4. What is the difference between `Promise.all` and `Promise.allSettled`?
5. Turn three sequential `await`s into one round trip and say when you must not.
6. Trace the race condition that `AbortController` prevents in a `useEffect`.
7. Why does `console.log(count)` right after `setCount(count + 1)` print the old value?

<details>
<summary>Answers</summary>

1. `.then` callbacks are microtasks; the loop drains the whole microtask queue as soon as the stack empties, and only then takes one macrotask (the timer callback).
2. The microtask queue never empties, so the event loop never advances — the page freezes with no paint and no input handling.
3. No. It rejects only on network-level failure. HTTP error statuses resolve with `res.ok === false`, so you must check it and throw yourself.
4. `all` short-circuits and rejects as soon as any input rejects; `allSettled` always fulfils with a per-promise `{status, value|reason}` record.
5. `const [a,b,c] = await Promise.all([fa(), fb(), fc()])`. Don't do it when a later request needs a value from an earlier one, or when the server can't take the concurrency.
6. Two requests overlap; the slower, older one resolves last and overwrites the newer result. The cleanup function runs before the next effect, aborting the old request so its `.then` never sets state.
7. `count` is a `const` binding belonging to the current render; `setCount` schedules a new render rather than mutating the existing one. The new value is only visible in the next render.

</details>
