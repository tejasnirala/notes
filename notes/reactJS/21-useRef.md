---
title: useRef
author: Tejas Nirala
---

# useRef

A ref is a **mutable box that survives renders and does not trigger them**. Two use cases follow from that one sentence: reaching into the DOM, and remembering a value without re-rendering.

---

## 1. What it is

```jsx
const ref = useRef(initialValue);
// ref === { current: initialValue }
```

React creates the object once, on mount, and returns **the exact same object** on every subsequent render ([How Hooks Work](./18-how-hooks-work-internally.md)):

```js
function useRef(initial) {
  const i = hookIndex++;
  if (fiber.hooks[i] === undefined) fiber.hooks[i] = { current: initial };
  return fiber.hooks[i];          // same object, forever
}
```

Because the identity is stable, a closure capturing `ref` in render 1 can read a value written in render 50.

### `useRef` vs `useState`

| | `useState` | `useRef` |
| :-- | :-- | :-- |
| Triggers a re-render on change | ✅ | ❌ |
| Read during render | ✅ safe | ⚠️ unsafe (breaks purity) |
| Value survives renders | ✅ | ✅ |
| Mutable in place | ❌ (must create new) | ✅ `ref.current = x` |
| Available immediately after writing | ❌ (next render) | ✅ synchronously |

```jsx
ref.current = 5;
console.log(ref.current);   // 5 — immediately

setState(5);
console.log(state);         // the OLD value — next render sees 5
```

**The rule:** if changing it should change what's on screen, it's state. Otherwise it's a ref.

---

## 2. Use case 1 — accessing DOM nodes

```jsx
function SearchBox() {
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current.focus();      // available here — refs are attached before effects
  }, []);

  return <input ref={inputRef} />;
}
```

React sets `ref.current` to the DOM node during the commit phase (step 4, before layout effects) and sets it back to `null` when the node is removed.

```
render:            ref.current === null  ← the DOM node doesn't exist yet
commit mutations:  node created/inserted
ref attach:        ref.current = <input>
layout effects:    ref.current is available ✅
paint
passive effects:   ref.current is available ✅
unmount:           ref.current = null
```

So this is always `null`:

```jsx
function Bad() {
  const ref = useRef(null);
  console.log(ref.current);      // null on EVERY render — the DOM isn't committed yet
  return <div ref={ref} />;
}
```

### Legitimate imperative DOM work

```jsx
inputRef.current.focus();
inputRef.current.select();
videoRef.current.play();
dialogRef.current.showModal();
listRef.current.scrollIntoView({ behavior: 'smooth' });
canvasRef.current.getContext('2d');
const { width } = boxRef.current.getBoundingClientRect();
```

**What you must not do:**

```jsx
// ❌ fighting React for control of the DOM
divRef.current.innerHTML = '<b>hi</b>';        // React will overwrite it
divRef.current.style.display = 'none';         // use state + className
divRef.current.remove();                        // React's tree no longer matches reality
```

React owns any node it rendered. Refs are for *reading* and for calling imperative APIs the DOM exposes that have no declarative equivalent (focus, scroll, media playback, canvas).

### Ref callbacks

For dynamic collections, or when you need to run code at attach/detach time:

```jsx
// a map of id → node
const nodes = useRef(new Map());

{items.map(item => (
  <li key={item.id} ref={node => {
    if (node) nodes.current.set(item.id, node);
    else      nodes.current.delete(item.id);     // detach: called with null
  }}>{item.name}</li>
))}
```

⚠️ An inline arrow ref callback is a *new function* every render, so React calls it with `null` then the node on every render. That's usually harmless, but if the callback does real work, `useCallback` it — or, in React 19, return a cleanup function:

```jsx
<div ref={node => {
  const observer = new ResizeObserver(…);
  observer.observe(node);
  return () => observer.disconnect();     // React 19: ref cleanup functions
}} />
```

---

## 3. Use case 2 — instance variables that don't render

```jsx
// timer ids
const timerRef = useRef(null);
function start() {
  timerRef.current = setInterval(tick, 1000);
}
function stop() {
  clearInterval(timerRef.current);
  timerRef.current = null;
}

// the previous value of a prop
function usePrevious(value) {
  const ref = useRef(undefined);
  useEffect(() => { ref.current = value; });    // after render → holds the PREVIOUS value
  return ref.current;
}

// "is this the first render?"
const isFirst = useRef(true);
useEffect(() => {
  if (isFirst.current) { isFirst.current = false; return; }
  onChange(value);                                // skip the mount call
}, [value]);

// a mutable cache that shouldn't cause renders
const cache = useRef(new Map());

// latest-value refs, to avoid stale closures
const latest = useRef(callback);
latest.current = callback;
```

### `usePrevious`, traced

```jsx
function Counter({ count }) {
  const prev = usePrevious(count);
  return <p>{prev} → {count}</p>;
}
```

```
mount, count=0:
   render: ref.current is undefined → prev = undefined
   effect: ref.current = 0

count → 1:
   render: ref.current is still 0  → prev = 0        ✅ "0 → 1"
   effect: ref.current = 1

count → 2:
   render: ref.current is 1        → prev = 1        ✅ "1 → 2"
   effect: ref.current = 2
```

The effect runs *after* the render reads it, which is exactly what makes the value "previous".

---

## 4. Refs and stale closures

The canonical fix from [Closures & Identity](./03-closures-and-identity.md):

```jsx
function Chat({ onMessage }) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;             // refreshed on every render

  useEffect(() => {
    const socket = connect();
    socket.on('msg', m => handlerRef.current(m));   // always the LATEST handler
    return () => socket.close();
  }, []);                                     // ✅ the socket is created once
}
```

Without the ref you'd have to put `onMessage` in the deps, and the socket would reconnect on every parent render.

Note the assignment is during render, which is technically an impure write. It's the accepted pattern (React's own docs use it) because the ref isn't read during render — but the officially blessed version is `useEffectEvent` ([useEffect](./19-useEffect.md)), and a strictly-pure variant assigns in a layout effect:

```jsx
useLayoutEffect(() => { handlerRef.current = onMessage; });
```

---

## 5. Forwarding refs

A ref on a component doesn't reach the DOM by itself:

```jsx
function MyInput(props) { return <input {...props} />; }
<MyInput ref={r} />       // ❌ React 18: warning, r.current stays null
```

### React 19 — `ref` is just a prop

```jsx
function MyInput({ ref, ...props }) {
  return <input ref={ref} {...props} />;      // ✅ that's it
}
```

### React ≤18 — `forwardRef`

```jsx
const MyInput = forwardRef(function MyInput(props, ref) {
  return <input ref={ref} {...props} />;
});
```

### Exposing a controlled API with `useImperativeHandle`

Sometimes you don't want to hand out the raw DOM node:

```jsx
const VideoPlayer = forwardRef(function VideoPlayer(props, ref) {
  const videoRef = useRef(null);

  useImperativeHandle(ref, () => ({
    play:  () => videoRef.current.play(),
    pause: () => videoRef.current.pause(),
    seek:  t => { videoRef.current.currentTime = t; },
    // deliberately NOT exposing the raw node
  }), []);

  return <video ref={videoRef} {...props} />;
});

// parent
const player = useRef(null);
player.current.play();          // only these three methods exist
```

Use it sparingly — it's imperative control, which is the opposite of React's model. Legitimate when the action has no declarative expression: focus, scroll, media, animations, canvas.

---

## 6. Common mistakes

```jsx
// 1. Reading a ref during render to decide the output → breaks purity
function Bad() {
  const r = useRef(0);
  r.current++;                    // ❌ mutation during render; wrong under StrictMode
  return <p>{r.current}</p>;      // ❌ React can't know to re-render
}

// 2. Expecting a ref change to re-render
countRef.current++;               // nothing happens on screen. Use state.

// 3. Using ref.current in the render body when it's the DOM
return <div style={{ width: ref.current?.offsetWidth }} />;   // null on first render

// 4. Object refs where a callback ref is needed
// A ref on a conditionally rendered node is null while it's absent — always guard:
useEffect(() => { ref.current?.focus(); });

// 5. Storing derived data in a ref to "avoid re-renders"
// If the UI must reflect it, it's state. A ref just makes the UI stale.
```

---

## 7. `createRef` vs `useRef`

```jsx
class Old extends React.Component {
  ref = React.createRef();        // classes: created once, in the constructor
}

function New() {
  const ref = useRef(null);       // functions: React persists it across renders
}
```

`createRef()` inside a function component creates a **brand-new object every render**, which is almost always a bug. Use `useRef` in function components, always.

---

## 🧠 Rapid-fire recall

1. What object does `useRef` return, and what's guaranteed about it across renders?
2. When exactly is `ref.current` set to a DOM node?
3. Why is `ref.current` `null` if you log it in the render body?
4. Give three legitimate uses of a DOM ref and two things you must never do with one.
5. Explain how `usePrevious` produces the previous value.
6. How do refs solve stale closures in long-lived subscriptions?
7. Why is `createRef()` wrong inside a function component?

<details>
<summary>Answers</summary>

1. `{current: initialValue}` — the identical object on every render, created only on mount, so closures from any render can read and write the current value.
2. During the commit phase, after DOM mutations and before layout effects; it's reset to `null` when the node is removed.
3. Rendering happens before commit, so the DOM node doesn't exist yet on the first render, and refs are attached afterwards.
4. Legitimate: focus/select, scroll, media playback, measuring with `getBoundingClientRect`, canvas contexts, `showModal`. Never: setting `innerHTML`, styles or removing nodes React rendered — React owns them and will overwrite or desynchronise.
5. The render reads `ref.current` *before* the effect writes the new value, so during render the ref still holds the value written after the previous render.
6. Store the changing value in a ref updated on every render; the effect closes over the stable ref object and reads `.current` at call time, so it always sees the latest value without re-running setup.
7. `createRef` allocates a new object on every call, and a function component's body runs every render — so the ref would be discarded and re-created each time, never persisting a value.

</details>
