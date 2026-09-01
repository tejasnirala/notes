---
title: The JavaScript You Need
author: Tejas Nirala
---

# The JavaScript You Need

Most "React bugs" are JavaScript bugs wearing a costume. This page covers exactly the language features React code leans on, with emphasis on the parts that bite people once they're inside a component.

---

## 1. `var` / `let` / `const` and the loop trap

```js
var  x = 1;   // function-scoped, hoisted & initialised to undefined
let  y = 2;   // block-scoped, hoisted but in the "temporal dead zone"
const z = 3;  // block-scoped, cannot be REASSIGNED (contents can still mutate)
```

`const` does not mean immutable:

```js
const user = { name: 'Ada' };
user.name = 'Grace';   // ✅ allowed — we mutated, not reassigned
user = {};             // ❌ TypeError
```

### The classic trace

```js
for (var i = 0; i < 3; i++) setTimeout(() => console.log(i));
// 3, 3, 3

for (let i = 0; i < 3; i++) setTimeout(() => console.log(i));
// 0, 1, 2
```

**Why**, step by step:

```
var version — ONE binding shared by all three closures
  ┌─────────────────────┐
  │ function scope      │
  │   i: 0 → 1 → 2 → 3  │ ◀── all three arrow functions point HERE
  └─────────────────────┘
  timers run after the loop ends → they all read i === 3

let version — a NEW binding per iteration
  ┌────────┐ ┌────────┐ ┌────────┐
  │ i: 0   │ │ i: 1   │ │ i: 2   │  ◀── each closure captured its own box
  └────────┘ └────────┘ └────────┘
  timers read 0, 1, 2
```

Use `const` by default, `let` when you must reassign, `var` never.

---

## 2. Destructuring

React code is destructuring code.

```js
// Objects
const { name, age } = user;
const { name: userName } = user;             // rename
const { theme = 'light' } = settings;        // default when undefined
const { address: { city } = {} } = user;     // nested + guard

// Arrays — position matters, names are yours
const [first, second] = items;
const [, secondOnly] = items;                // skip
const [head, ...tail] = items;               // rest
```

This is why `useState` returns an array and not an object:

```js
const [count, setCount] = useState(0);
const [name,  setName]  = useState('');
// array destructuring lets YOU pick the names; with an object you'd rename every time
```

Destructuring in parameters — the React props idiom:

```jsx
function Avatar({ src, size = 40, alt = '' }) {   // defaults live in the signature
  return <img src={src} width={size} height={size} alt={alt} />;
}
```

⚠️ Destructuring a `null`/`undefined` throws:

```js
const { a } = null;          // TypeError
const { a } = user ?? {};    // safe
```

---

## 3. Spread & rest — and the shallow-copy trap

```js
const a = [1, 2];
const b = [...a, 3];                    // [1,2,3] — NEW array

const o = { x: 1 };
const p = { ...o, y: 2 };               // {x:1, y:2} — NEW object
const q = { ...o, x: 99 };              // later keys win
```

State updates are built entirely on this, because React compares by reference (see [Closures & Identity](./03-closures-and-identity.md)).

```js
setUser({ ...user, name: 'Grace' });                // ✅ new object → React sees a change
setItems([...items, newItem]);                      // ✅ append
setItems(items.filter(i => i.id !== id));           // ✅ remove
setItems(items.map(i => i.id === id ? {...i, done: true} : i));  // ✅ update one
```

### Spread is SHALLOW — trace it

```js
const state = { user: { name: 'Ada', tags: ['x'] }, count: 1 };
const next  = { ...state, count: 2 };
```

```
state ──┬─ user  ──▶ ┌───────────────────────┐
        │            │ {name:'Ada', tags:[…]}│ ◀─┐
        └─ count: 1  └───────────────────────┘   │ SAME object,
                                                  │ shared by both
next  ──┬─ user  ─────────────────────────────────┘
        └─ count: 2

next !== state          ✅ top level is new
next.user === state.user ⚠️  nested object was NOT copied
```

So this silently mutates the old state too:

```js
next.user.name = 'Grace';
state.user.name;   // 'Grace'  ← the "previous" state changed. React may skip the re-render.
```

Fix: copy every level you intend to change.

```js
const next = { ...state, user: { ...state.user, name: 'Grace' } };
```

Or use `structuredClone(state)` for a genuine deep copy, or a library like Immer (which Redux Toolkit bundles — see [Redux Toolkit](./35-redux-toolkit.md)).

---

## 4. Array methods you will use every day

All of these are **non-mutating** — they return a new array, which is exactly what React state needs.

```js
const users = [
  { id: 1, name: 'Ada',   active: true,  age: 36 },
  { id: 2, name: 'Grace', active: false, age: 45 },
  { id: 3, name: 'Alan',  active: true,  age: 41 },
];

users.map(u => u.name);                  // ['Ada','Grace','Alan']   — transform, same length
users.filter(u => u.active);             // [Ada, Alan]              — subset
users.find(u => u.id === 2);             // Grace (or undefined)     — first match
users.findIndex(u => u.id === 2);        // 1  (or -1)
users.some(u => u.age > 44);             // true
users.every(u => u.active);              // false
users.reduce((sum, u) => sum + u.age, 0);// 122
users.flatMap(u => u.active ? [u.name] : []); // filter+map in one pass
```

### Mutating vs non-mutating — memorise this table

| Mutates ❌ (avoid on state) | Non-mutating ✅ |
| :-- | :-- |
| `push`, `pop`, `shift`, `unshift` | `[...arr, x]`, `arr.slice(0, -1)`, `arr.slice(1)`, `[x, ...arr]` |
| `splice` | `toSpliced` (ES2023), `filter`, `slice` + spread |
| `sort`, `reverse` | `toSorted`, `toReversed` (ES2023), or `[...arr].sort()` |
| `arr[i] = v` | `arr.with(i, v)` (ES2023), or `map` |

```js
// ❌ the #1 "why isn't my list updating" bug
items.sort((a,b) => a.age - b.age);
setItems(items);          // same reference → React bails out → no re-render

// ✅
setItems([...items].sort((a,b) => a.age - b.age));
```

### `reduce` as a grouping tool

```js
const byActive = users.reduce((acc, u) => {
  const key = u.active ? 'active' : 'inactive';
  (acc[key] ||= []).push(u);
  return acc;
}, {});
// { active: [Ada, Alan], inactive: [Grace] }
```

Trace of the accumulator:

```
start  acc = {}
u=Ada    → acc = { active: [Ada] }
u=Grace  → acc = { active: [Ada], inactive: [Grace] }
u=Alan   → acc = { active: [Ada, Alan], inactive: [Grace] }
```

---

## 5. Object utilities

```js
Object.keys(o);      // ['a','b']
Object.values(o);    // [1, 2]
Object.entries(o);   // [['a',1], ['b',2]]  ← how you map over an object in JSX
Object.fromEntries(pairs);
Object.assign({}, a, b);   // like spread, but mutates the first argument

// Rendering an object in JSX:
{Object.entries(settings).map(([key, value]) => (
  <Row key={key} label={key} value={value} />
))}
```

Optional chaining and nullish coalescing — the two operators that delete most defensive code:

```js
user?.address?.city              // undefined instead of a TypeError
user?.getName?.()                // only calls if it exists
list?.[0]

const port = cfg.port ?? 3000;   // fallback ONLY on null/undefined
const port = cfg.port || 3000;   // ⚠️  also falls back on 0, '', false, NaN
```

That `||` vs `??` distinction is a real bug source:

```jsx
<Input value={props.value || 'default'} />   // typing "0" shows "default" 💀
<Input value={props.value ?? 'default'} />   // ✅
```

---

## 6. Functions, arrows and `this`

```js
function classic(a, b) { return a + b; }
const arrow = (a, b) => a + b;
const oneArg = x => x * 2;
const returnsObject = () => ({ ok: true });   // parens required!
```

The differences that matter:

| | `function` | arrow |
| :-- | :-- | :-- |
| `this` | dynamic, set by the call site | **lexical** — inherited from where it was written |
| `arguments` | yes | no (use `...rest`) |
| hoisted | yes | no (it's a `const`) |
| usable as constructor | yes | no |

```js
class Timer {
  count = 0;
  startBroken() {
    setInterval(function () { this.count++; }, 1000);   // `this` is undefined/window 💥
  }
  startWorking() {
    setInterval(() => { this.count++; }, 1000);         // arrow keeps `this` ✅
  }
}
```

In modern function-component React you rarely touch `this` — which is one of the reasons hooks won.

---

## 7. Modules

```js
// utils.js
export const add = (a, b) => a + b;        // named export
export default function Button() {}        // default export — one per file

// app.js
import Button, { add } from './utils';
import Button as MyButton from './Button';
import * as utils from './utils';
```

Import statements are **hoisted and static** — they run before any other code in the file and cannot be conditional. That's what makes bundlers able to tree-shake, and why lazy loading needs the *dynamic* form:

```js
const mod = await import('./Heavy');   // returns a Promise, evaluated on demand
// React.lazy(() => import('./Heavy')) is built on exactly this
```

---

## 8. Template literals & tagged usage

```js
const cls = `btn btn-${variant} ${isActive ? 'active' : ''}`;
const msg = `Hello, ${user.name.toUpperCase()}!`;

const sql = `
  SELECT *
  FROM users
`;   // multi-line, preserved
```

---

## 9. Short-circuit evaluation in JSX

```jsx
{isLoggedIn && <Dashboard />}          // renders Dashboard, or nothing
{error ? <Error /> : <Content />}      // either/or
```

⚠️ The falsy-number trap — React renders `0`, it does not skip it:

```jsx
{items.length && <List items={items} />}     // when length is 0 → renders "0" on screen 💀
{items.length > 0 && <List items={items} />} // ✅ boolean
```

React skips `false`, `null`, `undefined` and `true`. It renders `0` and `NaN`.

---

## 10. `structuredClone`, `JSON` round-trip, and equality

```js
const deep = structuredClone(obj);              // ✅ handles Date, Map, Set, cycles
const deep = JSON.parse(JSON.stringify(obj));   // ⚠️ loses Date/undefined/functions/Infinity
```

```js
{} === {}                       // false — different references
'a' === 'a'                     // true  — primitives compare by value
Object.is(NaN, NaN)             // true  ← React uses Object.is internally
Object.is(0, -0)                // false
```

`Object.is` is the exact comparison React's `useState` bail-out and `React.memo`'s default use. That leads straight into the next page.

---

## 🧠 Rapid-fire recall

1. Why does `var` in a `for` loop with `setTimeout` print the final value three times?
2. Is `const` immutable?
3. What does `{...state, user: {...}}` fix that `{...state}` alone does not?
4. Name three mutating array methods and their non-mutating replacements.
5. When does `??` behave differently from `||`, and why does it matter in JSX?
6. What does `{items.length && <List/>}` render when the list is empty?
7. Why must `React.lazy` use `import()` and not a normal `import`?

<details>
<summary>Answers</summary>

1. `var` creates one function-scoped binding shared by every closure; by the time the timers fire the loop has finished and that single binding holds `3`. `let` creates a fresh binding per iteration.
2. No — it prevents *reassignment* of the binding. The object's contents can still be mutated.
3. Spread is shallow: `{...state}` shares nested objects with the original, so mutating them corrupts the previous state and can defeat React's reference check. Copying each level you change gives genuinely new references.
4. `push`→`[...arr, x]`; `sort`→`[...arr].sort()` or `toSorted`; `splice`→`filter`/`slice`/`toSpliced`. (Also `reverse`→`toReversed`, `arr[i]=v`→`arr.with(i,v)`.)
5. `??` only falls back on `null`/`undefined`; `||` also falls back on `0`, `''`, `false`, `NaN` — which wrongly replaces a legitimate `0` or empty string in a prop.
6. The number `0`. React renders numbers; it only skips `false`, `null`, `undefined` and `true`. Use `items.length > 0 &&`.
7. Static `import` is hoisted and evaluated eagerly, so the code would always be in the initial bundle. `import()` is a function call returning a Promise, so the bundler can split it into a separate chunk fetched on demand.

</details>
