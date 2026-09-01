---
title: The DOM & The Browser
author: Tejas Nirala
---

# The DOM & The Browser

React is a library that writes to the DOM for you. You cannot reason about React's performance, its `useEffect` timing, or why your animation flickers until you know what the browser is doing underneath. This page is that foundation.

---

## 1. What the DOM actually is

You write HTML. The browser parses that text and builds an **in-memory tree of objects**. That tree is the DOM (Document Object Model). The HTML file is gone the moment parsing finishes — from then on, the page *is* the object tree.

```html
<div id="app">
  <h1>Hello</h1>
  <p>World</p>
</div>
```

becomes:

```
document
└── html
    └── body
        └── div#app                    ← an object with ~300 properties
            ├── h1                     ← another object
            │   └── #text "Hello"
            └── p
                └── #text "World"
```

Each node is a real JavaScript object with hundreds of properties (`className`, `offsetTop`, `style`, `parentNode`, 60+ event handler slots…). This matters: **DOM objects are expensive**. Creating one is not like creating `{type: 'h1'}`.

```js
const div = document.createElement('div');
console.log(Object.keys(div.__proto__.__proto__).length); // hundreds
```

That single fact is the origin of the Virtual DOM, which we cover in [React Elements](./06-jsx-and-react-elements.md).

---

## 2. The rendering pipeline

When you change the DOM, the browser does not just "redraw the div". It runs a pipeline:

```
  JS  ──▶  Style  ──▶  Layout  ──▶  Paint  ──▶  Composite
  │        │           │            │           │
  │        │           │            │           └─ GPU stitches layers together
  │        │           │            └───────────── fills in pixels for each layer
  │        │           └────────────────────────── computes x/y/width/height of EVERY affected node
  │        └────────────────────────────────────── matches CSS rules → computed styles
  └─────────────────────────────────────────────── your code runs
```

The vocabulary you'll hear:

| Term | Meaning | Cost |
| :-- | :-- | :-- |
| **Reflow** (layout) | Recompute geometry of nodes | 💀 Expensive — can cascade to the whole document |
| **Repaint** | Redraw pixels, geometry unchanged | 😐 Moderate |
| **Composite only** | GPU moves an existing layer | 😊 Cheap |

Which properties trigger what:

```js
el.style.width  = '200px';   // reflow → repaint → composite   (geometry changed)
el.style.color  = 'red';     // repaint → composite            (geometry same)
el.style.transform = 'translateX(200px)'; // composite only    ← animate with THIS
el.style.opacity   = '0.5';               // composite only    ← and THIS
```

> **Engineering takeaway:** animate `transform` and `opacity`. Animating `left`/`top`/`width` forces a reflow on every frame, and you have ~16.6ms per frame at 60fps to do *everything*.

---

## 3. Layout thrashing — trace it

This is the classic performance bug, and the reason `useLayoutEffect` exists.

The browser **batches** your DOM writes into a queue and flushes them at the end of the task. But a **read** of a layout property forces it to flush the queue *immediately* so it can give you an accurate answer. That is a **forced synchronous reflow**.

### The bad version

```js
const boxes = document.querySelectorAll('.box');   // 100 elements

for (const box of boxes) {
  const w = box.offsetWidth;          // READ  → forces reflow
  box.style.width = (w * 2) + 'px';   // WRITE → dirties layout
}
```

**Trace it, iteration by iteration:**

```
State: layout is CLEAN

i=0  READ  offsetWidth   → layout clean, answer is free              ┐
     WRITE style.width   → layout now DIRTY                          │ 1 reflow
i=1  READ  offsetWidth   → layout DIRTY → browser must REFLOW NOW ◀──┘
     WRITE style.width   → layout DIRTY again
i=2  READ  offsetWidth   → REFLOW NOW  ◀── 2nd reflow
     WRITE ...
...
i=99 READ  offsetWidth   → REFLOW NOW  ◀── 99th reflow

Final state: 99 forced synchronous reflows for a job that needed 1.
```

### The fixed version — batch reads, then writes

```js
const boxes = document.querySelectorAll('.box');

// Phase 1: READ everything
const widths = [...boxes].map(b => b.offsetWidth);   // 1 reflow, at most

// Phase 2: WRITE everything
boxes.forEach((b, i) => { b.style.width = widths[i] * 2 + 'px'; });
// layout stays dirty until the browser paints → 1 reflow total
```

```
State: layout CLEAN
  ├─ 100 reads  → 1 reflow (the first read), then all answers are cached
  ├─ 100 writes → layout DIRTY, but nobody asks a question
  └─ frame ends → browser reflows ONCE and paints

Final: 1 reflow instead of 99.
```

**Properties that force reflow when read:** `offsetTop/Left/Width/Height`, `clientTop/…`, `scrollTop/…`, `getComputedStyle()`, `getBoundingClientRect()`, `focus()`, `getClientRects()`.

React's commit phase is built around exactly this read/write split — see [The Render Pipeline](./13-the-render-pipeline.md).

---

## 4. Why manual DOM code collapses

Here is a counter written imperatively. Watch how state and DOM drift apart.

```js
let count = 0;
const label = document.getElementById('label');
const btn   = document.getElementById('btn');

btn.addEventListener('click', () => {
  count++;                                   // 1. update the data
  label.textContent = `Count: ${count}`;     // 2. update the DOM
  btn.disabled = count >= 10;                // 3. and this
  document.title = `Count: ${count}`;        // 4. and this
  if (count === 5) confetti();               // 5. and this
});
```

The problem is not that it's long. The problem is that **`count` and the screen are two separate sources of truth that you must manually keep in sync**. Every new place `count` matters is a new line you must remember to add — in *every* handler that changes `count`.

With N pieces of state and M places they're displayed, you are hand-maintaining N×M synchronisation edges.

React's proposition is: describe the screen **as a function of the data**, and let the library compute the DOM operations.

```jsx
function Counter() {
  const [count, setCount] = useState(0);
  return <button disabled={count >= 10} onClick={() => setCount(count + 1)}>
    Count: {count}
  </button>;
}
```

One source of truth. The edges are computed, not maintained.

---

## 5. Events: bubbling, capturing, delegation

Understanding this is mandatory because React's event system is built on it.

When you click a `<button>` inside a `<div>` inside `<body>`, the event travels in **three phases**:

```
                    ┌──────────────────────┐
   1. CAPTURE       │      document        │       3. BUBBLE
      (down)        └──────────┬───────────┘          (up)
        │                      ▼                        ▲
        │           ┌──────────────────────┐            │
        │           │        body          │            │
        │           └──────────┬───────────┘            │
        ▼                      ▼                        │
                    ┌──────────────────────┐
                    │      div#card        │
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │   button  ← TARGET   │  2. TARGET phase
                    └──────────────────────┘
```

```js
div.addEventListener('click', fn);          // bubble phase  (default)
div.addEventListener('click', fn, true);    // capture phase
```

### Delegation

Because events bubble, one listener on a parent can serve a thousand children:

```js
// ❌ 1000 listeners, and new rows get none
document.querySelectorAll('li').forEach(li =>
  li.addEventListener('click', handle)
);

// ✅ 1 listener, works for rows added later
document.getElementById('list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  handle(li.dataset.id);
});
```

`e.target` = what was actually clicked. `e.currentTarget` = the element whose listener is running. Confusing these is a top-5 beginner bug.

```js
list.addEventListener('click', (e) => {
  e.target;         // the <span> inside the <li> you clicked
  e.currentTarget;  // #list — always the element the handler is attached to
});
```

**React uses delegation for you.** All React 17+ event handlers are attached to the **root container**, not to your individual elements. When you write `onClick` on 1000 buttons, React attaches *one* real listener at the root and dispatches from there. See [Events & Forms](./09-events-and-forms.md).

### Stopping things

```js
e.preventDefault();   // cancel the browser's default action (form submit, link navigation)
e.stopPropagation();  // stop travelling up the tree — other listeners on ancestors never fire
```

They are unrelated. `preventDefault` does not stop propagation; `stopPropagation` does not prevent the default.

---

## 6. Reading & writing the DOM — the API you should know

```js
// Selecting
document.getElementById('x');            // fastest, single element
document.querySelector('.card > p');     // first match, CSS selector
document.querySelectorAll('li');         // STATIC NodeList (a snapshot)
document.getElementsByClassName('c');    // LIVE HTMLCollection (updates itself!)

// Creating
const li = document.createElement('li');
li.textContent = userInput;              // ✅ safe — text only
li.innerHTML   = userInput;              // ⚠️  parses HTML → XSS risk

// Inserting
parent.append(li);                       // append node(s) or strings
parent.prepend(li);
ref.before(li); ref.after(li);
li.remove();

// Attributes vs properties
input.setAttribute('value', 'a');        // the HTML attribute (initial value)
input.value = 'a';                       // the live DOM property (current value)
```

The attribute/property distinction is exactly why React distinguishes `defaultValue` from `value` in forms.

### DocumentFragment — batching insertions

Every `append` into the live document can cost a reflow. A `DocumentFragment` is an off-screen container:

```js
const frag = document.createDocumentFragment();
for (let i = 0; i < 1000; i++) {
  const li = document.createElement('li');
  li.textContent = `Item ${i}`;
  frag.append(li);                 // off-document — no layout work at all
}
list.append(frag);                 // ONE insertion, one reflow
```

```
Without fragment:  1000 × (create + insert + dirty layout)   → up to 1000 layout passes
With fragment:     1000 × (create + insert into detached tree) + 1 real insertion → 1 layout pass
```

This is conceptually what React's Virtual DOM does at a much larger scale: do all the bookkeeping off-DOM, then touch the real DOM once, minimally.

---

## 7. Memory: why cleanup matters

```js
function attach() {
  const el = document.getElementById('big');
  const handler = () => console.log(el.textContent);   // closure captures `el`
  window.addEventListener('resize', handler);
}
```

`el` is removed from the page later — but `window` still holds `handler`, and `handler` closes over `el`. The node, its children, and its data can never be garbage collected. That is a leak.

```js
function attach() {
  const handler = () => { /* ... */ };
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);   // ← the fix
}
```

That returned "undo function" shape is precisely React's effect cleanup:

```jsx
useEffect(() => {
  const handler = () => {};
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);   // same idea
}, []);
```

---

## 8. Where the browser's model shows up in React

| Browser concept | Where it resurfaces in React |
| :-- | :-- |
| DOM nodes are heavy | Virtual DOM: cheap plain objects describe the UI first |
| Batched writes, forced reads | React's commit phase: mutate, then run layout effects, then paint |
| Reflow vs repaint vs composite | Why `useLayoutEffect` can cause jank, why you animate `transform` |
| Event bubbling | React's root-level event delegation and synthetic events |
| Attribute vs property | `value` vs `defaultValue`, controlled vs uncontrolled inputs |
| Listener cleanup | `useEffect` cleanup functions |
| `requestAnimationFrame` / the frame budget | The Scheduler and time-slicing in Concurrent React |

---

## 🧠 Rapid-fire recall

1. What is the difference between a reflow and a repaint, and which CSS properties avoid both?
2. Why does reading `offsetWidth` inside a write loop destroy performance?
3. What is the difference between `e.target` and `e.currentTarget`?
4. Does `stopPropagation()` prevent a form from submitting?
5. Why is `querySelectorAll` different from `getElementsByClassName` in a loop that removes elements?
6. What problem does a `DocumentFragment` solve, and what is React's analogue?
7. Give a concrete example of a DOM memory leak and the one-line fix.

<details>
<summary>Answers</summary>

1. Reflow recomputes geometry (positions/sizes) and can cascade through the tree; repaint only redraws pixels. `transform` and `opacity` skip both — they're handled by the compositor on the GPU.
2. The write dirties layout; the next read forces the browser to synchronously recompute layout to answer accurately. Interleaving them turns 1 reflow into N ("layout thrashing"). Batch all reads, then all writes.
3. `target` is the deepest element the event originated on; `currentTarget` is the element whose listener is currently executing.
4. No. `stopPropagation` stops the event travelling the tree; `preventDefault` cancels the browser's default action. They're independent.
5. `querySelectorAll` returns a *static* snapshot; `getElementsByClassName` returns a *live* collection that shrinks as you remove elements — so an index-based loop skips items.
6. It lets you build a subtree off-document so insertions cost no layout work, then attach it once. React's Virtual DOM is the same idea generalised: compute everything on cheap objects, then apply a minimal set of real mutations.
7. A `resize` listener on `window` closing over a detached DOM node — the node can never be collected. Fix: `removeEventListener` in a cleanup function.

</details>
