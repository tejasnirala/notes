---
title: Closures & Reference Identity
author: Tejas Nirala
---

# Closures & Reference Identity

If you understand only one prerequisite page deeply, make it this one. **Every confusing hook bug in React is either a stale closure or a broken reference identity.** Dependency arrays, `useCallback`, `React.memo`, "why does my effect run twice", "why is my state one step behind" — all of it lives here.

---

## 1. What a closure is

A closure is a function bundled together with the variable environment it was created in. The function keeps that environment alive even after the outer function has returned.

```js
function makeCounter() {
  let count = 0;                       // lives in makeCounter's scope
  return function increment() {
    count++;                           // still reachable — this is the closure
    return count;
  };
}

const inc = makeCounter();
inc(); // 1
inc(); // 2
```

```
Heap
┌──────────────────────────┐
│ environment #1           │
│   count: 0 → 1 → 2       │◀── captured by `inc`
└──────────────────────────┘
        ▲
        │
   inc ─┘   (function object + a pointer to its environment)
```

Two calls to `makeCounter()` produce two *independent* environments — this is how React gives every component instance its own state.

---

## 2. Closures capture **variables**, not values

This distinction is the whole ballgame.

```js
let x = 1;
const show = () => console.log(x);
x = 2;
show();   // 2   ← reads the variable at call time, not at creation time
```

But when the variable is **const per-invocation**, the captured value is frozen:

```js
function outer(x) {
  return () => console.log(x);   // x is a fresh binding for THIS call
}
const a = outer(1);
const b = outer(2);
a(); // 1
b(); // 2
```

**React function components are `outer`.** Each render is a new function call, with a new set of `const` bindings, and every function you define inside that render closes over *that render's* bindings — permanently.

---

## 3. Stale closures in React — a full trace

```jsx
function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      console.log(count);        // ← which `count`?
      setCount(count + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);                        // ← empty deps

  return <h1>{count}</h1>;
}
```

**Trace it:**

```
RENDER 1
  count = 0                       (a const binding, call it count@1)
  effect runs (deps [] → first time only)
    interval created, its callback closes over count@1 === 0

  tick 1s: logs 0, calls setCount(0 + 1) → state becomes 1

RENDER 2
  count = 1                       (a NEW binding count@2)
  effect does NOT re-run (deps [] never change)
  the interval is STILL the one from render 1, still closed over count@1 === 0

  tick 2s: logs 0, calls setCount(0 + 1) → state is already 1 → no change
  tick 3s: logs 0, setCount(1)  → no change
  ...

FINAL STATE: the counter freezes at 1 and logs 0 forever.
```

The interval callback is a fossil from render 1. It can only ever see render 1's variables.

### Three correct fixes

**a) The updater form — never read the stale variable at all**

```jsx
useEffect(() => {
  const id = setInterval(() => setCount(c => c + 1), 1000);   // c comes from React
  return () => clearInterval(id);
}, []);
```

React hands the updater the *current* state. The closure no longer needs `count`.

```
tick 1: React calls (0) => 1   → 1
tick 2: React calls (1) => 2   → 2
tick 3: React calls (2) => 3   → 3   ✅
```

**b) Declare the dependency — accept the teardown/setup churn**

```jsx
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000);
  return () => clearInterval(id);
}, [count]);       // effect re-runs every render; interval is recreated each second
```

Correct, but it destroys and recreates the timer on every tick. Fine for cheap effects, wrong for a WebSocket.

**c) A ref as an escape hatch — a mutable box that survives renders**

```jsx
const countRef = useRef(count);
countRef.current = count;                 // updated on every render

useEffect(() => {
  const id = setInterval(() => console.log(countRef.current), 1000);
  return () => clearInterval(id);
}, []);
```

The closure captures the *ref object* (stable), and reads `.current` fresh at call time. See [useRef](./21-useRef.md).

---

## 4. Reference identity

Primitives compare by **value**. Objects, arrays and functions compare by **reference**.

```js
1 === 1                 // true
'a' === 'a'             // true
{} === {}               // false   ← two different objects
[] === []               // false
(() => {}) === (() => {})   // false

const o = {};
o === o                 // true
```

Every time a JS expression *evaluates* an object literal, array literal or function expression, a **brand-new object** is created.

```js
function f() { return { a: 1 }; }
f() === f();   // false — two calls, two objects
```

### Why React cares

React decides "did this change?" using `Object.is`, which is `===` with two fixes (`NaN` equals itself, `+0` ≠ `-0`). It uses that comparison in four places:

| Place | What it compares |
| :-- | :-- |
| `useState` bail-out | new state vs old state |
| `useEffect` / `useMemo` / `useCallback` | each dependency, item by item |
| `React.memo` | each prop, item by item |
| Context | the `value` you pass to the Provider |

All four are **shallow**. None of them do a deep comparison — that would be too slow to run on every render.

---

## 5. The re-creation problem — trace it

```jsx
function Parent() {
  const [count, setCount] = useState(0);

  const user    = { name: 'Ada' };            // NEW object every render
  const onClick = () => console.log('hi');    // NEW function every render

  return (
    <>
      <button onClick={() => setCount(count + 1)}>{count}</button>
      <Child user={user} onClick={onClick} />
    </>
  );
}

const Child = React.memo(function Child({ user, onClick }) {
  console.log('Child rendered');
  return <button onClick={onClick}>{user.name}</button>;
});
```

**Trace across two renders:**

```
RENDER 1
  user@1    = {name:'Ada'}   at heap address 0xA1
  onClick@1 = fn             at heap address 0xB1
  Child receives {user: 0xA1, onClick: 0xB1}  → renders. Logs "Child rendered".

user clicks → setCount(1)

RENDER 2
  the component function runs again, top to bottom
  user@2    = {name:'Ada'}   at heap address 0xA2   ← same CONTENTS, different address
  onClick@2 = fn             at 0xB2

  React.memo compares:
     Object.is(0xA2, 0xA1) → false   ✗
  → Child re-renders. Logs "Child rendered".

RESULT: React.memo did nothing. The props "changed" on every render.
```

`React.memo` is not broken; the props genuinely are different objects. The fix is to stabilise the references:

```jsx
const user    = useMemo(() => ({ name: 'Ada' }), []);
const onClick = useCallback(() => console.log('hi'), []);
```

```
RENDER 2 (with memo/callback)
  useMemo:     deps [] unchanged → returns the CACHED object 0xA1
  useCallback: deps [] unchanged → returns the CACHED function 0xB1
  React.memo compares 0xA1 vs 0xA1 → equal ✓ → Child skipped. Nothing logged. ✅
```

> **The rule:** `useMemo`/`useCallback` do not make anything faster by themselves. They *preserve identity* so that some other identity check downstream can succeed. If nothing downstream checks identity, they're pure overhead. See [useMemo & useCallback](./22-useMemo-and-useCallback.md).

---

## 6. Dependency arrays are identity checks

```jsx
useEffect(() => {
  fetchUser(options);
}, [options]);                       // ← compared with Object.is
```

If `options` is created inline in the parent:

```jsx
<Profile options={{ id: 5 }} />      // new object EVERY parent render
```

then the dependency changes every render, so the effect runs every render, which sets state, which re-renders… an infinite loop.

```
render → new options object → deps differ → effect → setState → render → new options → …
```

Fixes, in order of preference:

```jsx
// 1. Depend on the primitive, not the object
useEffect(() => { fetchUser(id); }, [id]);

// 2. Move the object inside the effect
useEffect(() => { fetchUser({ id: 5 }); }, []);

// 3. Stabilise it at the source
const options = useMemo(() => ({ id }), [id]);
```

Prefer (1). Primitives compare by value and never surprise you.

---

## 7. Each render is a snapshot

This is the mental model that ties it together.

```jsx
function Greeting() {
  const [name, setName] = useState('Ada');

  function handleClick() {
    setTimeout(() => alert(name), 3000);
  }

  return <>
    <input value={name} onChange={e => setName(e.target.value)} />
    <button onClick={handleClick}>Alert in 3s</button>
  </>;
}
```

**Scenario:** click the button, then immediately type "Grace", then wait.

```
t=0.0s  RENDER with name@1 = 'Ada'
        click → handleClick from render 1 runs
              → schedules alert(name@1)  where name@1 is FROZEN as 'Ada'
t=0.5s  you type → setName('Grace') → RENDER with name@2 = 'Grace'
        the pending timer still holds render 1's environment
t=3.0s  alert fires → "Ada"
```

This is not a bug. React guarantees that within one render, props and state are **immutable constants**. The event handler you clicked belongs to the render you clicked in, and it will always see that render's values. Class components had `this.state`, a live mutable object — which is why class code was full of "read state before the async call" defensive copying.

If you *want* the latest value, you must explicitly reach outside the snapshot: a ref, or a state updater function.

---

## 8. The mental model, summarised

```
Every render:
   1. React calls your component function.
   2. All const bindings (props, state, locals) are created FRESH.
   3. Every function/object/array literal inside creates a NEW reference.
   4. Every closure created in this render sees ONLY this render's bindings, forever.
   5. Hooks with dependency arrays compare this render's deps to last render's
      with Object.is, and decide whether to re-run / re-create.
```

Hold that, and hooks stop being mysterious.

---

## 🧠 Rapid-fire recall

1. Do closures capture values or variables? How does that differ inside a React component?
2. Why does `setInterval(() => setCount(count + 1), 1000)` with `[]` deps freeze at 1?
3. Give three fixes for a stale closure, and say when each is appropriate.
4. Which comparison function does React use for state bail-outs and dependency arrays?
5. Why does `React.memo` appear not to work when the parent passes `onClick={() => {}}`?
6. What does `useCallback` actually make faster?
7. If you click a button and then change state, why does a `setTimeout` inside the handler see the old value?

<details>
<summary>Answers</summary>

1. They capture variables (bindings). Inside a React component, each render creates a fresh set of `const` bindings, so each render's closures effectively capture a frozen snapshot of that render's values.
2. The effect runs once, so its interval callback closes over render 1's `count === 0` forever. It computes `0 + 1 === 1` on every tick, and React bails out because the state is already 1.
3. (a) Updater form `setCount(c => c + 1)` — best when you only need to *write* state; (b) add the value to the dependency array — fine for cheap effects, wasteful for expensive setup like sockets; (c) a ref updated every render — for when you need the latest value inside a long-lived subscription without recreating it.
4. `Object.is` — `===` except `NaN` equals `NaN` and `+0` differs from `-0`. Always shallow.
5. Because an inline arrow creates a brand-new function object each render, so `Object.is(prevProp, nextProp)` is false and memo correctly concludes the props changed.
6. Nothing, on its own — it costs a little. It preserves a function's *reference identity* so that a downstream `React.memo` or dependency array can successfully bail out.
7. Because the handler is a closure over the render in which you clicked; props and state are immutable constants within a render. To read the latest value you need a ref or a state updater function.

</details>
