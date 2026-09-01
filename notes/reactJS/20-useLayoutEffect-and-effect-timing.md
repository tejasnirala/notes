---
title: useLayoutEffect & Effect Timing
author: Tejas Nirala
---

# useLayoutEffect & Effect Timing

One hook, one rule, and a lot of confusion. This page nails down the exact ordering of every effect type so you can reason about flicker, measurement and initialisation without guessing.

---

## 1. The complete timing diagram

```
  setState
     │
     ▼
  RENDER PHASE  (components called, may be interrupted, NO side effects)
     │
     ▼
  COMMIT PHASE  (synchronous, cannot be interrupted)
     │
     ├─ 1. useInsertionEffect cleanups + setups    ← before ANY DOM mutation
     │       (CSS-in-JS libraries inject <style> here)
     │
     ├─ 2. DOM MUTATIONS  (insert/update/delete nodes)
     │
     ├─ 3. useLayoutEffect cleanups (for removed/changed nodes)
     ├─ 4. refs detached, then attached
     ├─ 5. useLayoutEffect setups                  ← SYNCHRONOUS, blocks paint
     │       if this calls setState, React re-renders and re-commits
     │       BEFORE releasing the frame
     │
     ▼
  🖼 BROWSER PAINTS   ← the first moment the user sees anything
     │
     ├─ 6. useEffect cleanups
     └─ 7. useEffect setups                        ← asynchronous, after paint
```

| Hook | Runs | Blocks paint? | Use for |
| :-- | :-- | :-- | :-- |
| `useInsertionEffect` | before DOM mutations | yes | injecting `<style>` tags (library authors only) |
| `useLayoutEffect` | after mutations, before paint | **yes** | measuring the DOM and mutating before it's visible |
| `useEffect` | after paint | no | everything else |

---

## 2. The problem `useLayoutEffect` solves

```jsx
function Tooltip({ targetRef, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {                                   // ← wrong hook here
    const t = targetRef.current.getBoundingClientRect();
    const me = ref.current.getBoundingClientRect();
    setPos({ top: t.top - me.height - 8, left: t.left });
  }, []);

  return <div ref={ref} style={{ position: 'fixed', ...pos }}>{children}</div>;
}
```

**Trace with `useEffect`:**

```
frame 1:  commit DOM → tooltip inserted at top:0, left:0
          PAINT  ← 🐛 the user sees the tooltip in the top-left corner
          effect runs → measures → setPos(...)
frame 2:  re-render → commit → PAINT at the correct position

RESULT: a one-frame flash of wrongly-positioned content (~16ms, but very visible
        as a "jump", especially on slower devices where it can be 2-3 frames).
```

**Trace with `useLayoutEffect`:**

```
frame 1:  commit DOM → tooltip inserted at top:0, left:0
          layout effect runs → measures → setPos(...)
          React sees a state update from a layout effect and flushes it
              SYNCHRONOUSLY: re-render + re-commit, still inside this frame
          PAINT ← the tooltip appears already in the right place ✅

RESULT: no flicker. Cost: the frame does two renders' worth of work before painting.
```

---

## 3. When you need it

```
Use useLayoutEffect ONLY when:
  you must READ layout (getBoundingClientRect, offsetHeight, scrollHeight)
  AND then MUTATE something based on it
  AND the intermediate state would be visible to the user.
```

Genuine cases:

```jsx
// 1. Positioning a popover/tooltip/dropdown relative to a trigger
// 2. Measuring text to decide whether to show a "read more" link
useLayoutEffect(() => {
  setIsClamped(el.current.scrollHeight > el.current.clientHeight);
}, [text]);

// 3. Restoring scroll position before the user sees the top of the list
useLayoutEffect(() => { listRef.current.scrollTop = savedScroll; }, []);

// 4. Keeping a chat pinned to the bottom when a message arrives
useLayoutEffect(() => {
  const el = listRef.current;
  el.scrollTop = el.scrollHeight;
}, [messages]);

// 5. FLIP animations — measure the "first" position before the DOM changes
```

Everything else — data fetching, subscriptions, timers, logging, `document.title`, localStorage — uses `useEffect`.

---

## 4. The costs

```jsx
useLayoutEffect(() => {
  for (let i = 0; i < 1_000_000; i++) {}    // 50ms of work
}, []);
```

This runs **before** paint, so the user stares at the old screen (or a blank one on mount) for 50ms longer. Layout effects are on the critical path of every frame they run in.

Also:

```
❌ SSR: useLayoutEffect does not run on the server, and React warns:
   "useLayoutEffect does nothing on the server"
```

There's no DOM to measure server-side. The standard workaround:

```jsx
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;
```

Every major library (Radix, Floating UI, React Query) ships some version of this.

Note this only silences the warning — the measurement still can't happen server-side, so your component must render sensibly before it. Design the initial markup to be correct-ish (e.g. tooltip hidden until positioned) rather than merely repositioned.

---

## 5. `useInsertionEffect`

You will almost certainly never write this. It exists for CSS-in-JS libraries.

```jsx
useInsertionEffect(() => {
  document.head.appendChild(styleTag);      // inject styles BEFORE layout is read
}, [css]);
```

Why it needs its own phase: if a library injected `<style>` during a layout effect, any *other* layout effect that already measured the DOM would have measured pre-style geometry — a subtle, order-dependent bug. Running insertions before all mutations and all layout reads removes the ordering hazard.

Restrictions: you cannot read layout in it (nothing is committed yet) and you cannot call `setState`.

---

## 6. Ordering between components

Within one commit, effects run in **child-before-parent** order (a completed depth-first walk), separately per phase.

```jsx
<Parent>            // layout effect: P
  <ChildA />        // layout effect: A
  <ChildB />        // layout effect: B
</Parent>
```

```
all layout cleanups (A, B, P order for removals)
then layout setups:  A → B → P        ← children first
🖼 paint
then passive cleanups, then passive setups: A → B → P
```

Why children first: a parent's effect may depend on its children's DOM being fully set up (e.g. measuring a container after its contents exist). The reverse would never be safe.

**Do not rely on ordering between siblings** for correctness. If A must run before B, they should be one effect or communicate through state.

---

## 7. Choosing, as a flowchart

```
Do I need to touch the DOM at all?
 ├─ no  → useEffect (or no effect at all — can it be computed in render?)
 └─ yes → Do I need to MEASURE it and change something based on the measurement?
           ├─ no  → useEffect
           └─ yes → Would the user see the intermediate state?
                     ├─ no  → useEffect
                     └─ yes → useLayoutEffect
```

And the pragmatic rule: **write `useEffect` first. Switch to `useLayoutEffect` only when you can see the flicker.**

---

## 8. A worked comparison

```jsx
function AutoResizeTextarea({ value, onChange }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    el.style.height = 'auto';                    // reset so scrollHeight shrinks too
    el.style.height = el.scrollHeight + 'px';    // grow to fit
  }, [value]);

  return <textarea ref={ref} value={value} onChange={onChange} rows={1} />;
}
```

**Trace one keystroke that wraps to a new line:**

```
type a character
  → setState → render → commit: textarea's value updated, height still 1 row
  → layout effect: height='auto' (collapses), read scrollHeight (2 rows), set height
  → PAINT: the textarea appears at 2 rows immediately ✅

with useEffect instead:
  → commit → PAINT at 1 row (text is clipped for one frame)
  → effect resizes → PAINT at 2 rows
  → the box visibly "pops" on every line break 🐛
```

Note the `height = 'auto'` line: without it, `scrollHeight` can never report a value smaller than the current height, so the box would grow but never shrink. That's a layout-reading subtlety worth remembering ([The DOM & The Browser](./01-dom-and-the-browser.md)).

---

## 🧠 Rapid-fire recall

1. Give the full ordering of insertion effects, DOM mutation, layout effects, paint and passive effects.
2. Why does positioning a tooltip in `useEffect` flicker?
3. What happens if a `useLayoutEffect` calls `setState`?
4. Why does `useLayoutEffect` warn during SSR, and what's the standard workaround?
5. What is `useInsertionEffect` for, and what can't you do inside it?
6. In what order do effects run between parent and child?
7. State the decision rule for choosing between the two effect hooks.

<details>
<summary>Answers</summary>

1. Insertion effects → DOM mutations → layout cleanups → ref detach/attach → layout setups (may trigger a synchronous re-render) → browser paint → passive cleanups → passive setups.
2. `useEffect` runs after paint, so the browser shows one frame with the tooltip at its default position before the measurement-driven update lands.
3. React flushes the resulting re-render and re-commit synchronously, before releasing the frame — so the user never sees the intermediate DOM, at the cost of doing two renders in one frame.
4. There's no DOM on the server, so it can't run and React warns. The workaround is `const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect`, plus designing the initial markup so it's acceptable before measurement.
5. Injecting `<style>` tags for CSS-in-JS, before any DOM mutations or layout reads happen. You cannot read layout (nothing is committed yet) and cannot call `setState`.
6. Children before parents, within each phase — a completed depth-first walk — so a parent's effect can rely on its children's DOM being set up. Sibling order should never be relied upon.
7. Use `useEffect` unless you must read layout and mutate based on it *and* the intermediate state would be visible. Write `useEffect` first; upgrade only when you can actually see the flicker.

</details>
