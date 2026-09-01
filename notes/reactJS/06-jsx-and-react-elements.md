---
title: JSX & React Elements
author: Tejas Nirala
---

# JSX & React Elements

JSX is not a template language and it is not HTML. It is syntax sugar over a single function call. Once you can mentally de-sugar JSX, a whole class of confusion (why `key` is special, why components must be capitalised, why `{}` behaves like it does) disappears.

---

## 1. JSX compiles to function calls

```jsx
const el = <h1 className="title">Hello</h1>;
```

Babel/SWC transforms this into:

```js
// Classic runtime (React < 17, or with the "classic" transform)
const el = React.createElement('h1', { className: 'title' }, 'Hello');

// Automatic runtime (React 17+, the default today) — no React import needed
import { jsx as _jsx } from 'react/jsx-runtime';
const el = _jsx('h1', { className: 'title', children: 'Hello' });
```

And the result is just an object:

```js
{
  $$typeof: Symbol(react.element),   // security marker — blocks JSON injection attacks
  type: 'h1',                        // string → host element | function → component
  key: null,
  ref: null,
  props: { className: 'title', children: 'Hello' },
}
```

**That is the whole Virtual DOM.** No magic. A tree of these objects is a description of what the screen should look like.

### Nesting

```jsx
<div className="card">
  <h1>Hi</h1>
  <p>Text</p>
</div>
```

```js
_jsxs('div', {
  className: 'card',
  children: [
    _jsx('h1', { children: 'Hi' }),
    _jsx('p',  { children: 'Text' }),
  ],
});
```

Children are just another prop. `props.children` is not special syntax — it is the prop that JSX fills in from the tag body.

---

## 2. Why components must be capitalised

The transform decides between a string and a variable purely by case:

```jsx
<div />       →  _jsx('div', {})       // lowercase → the STRING 'div' → a host element
<Button />    →  _jsx(Button, {})      // Capitalised → the VARIABLE Button → your component
<button />    →  _jsx('button', {})    // lowercase → a real <button>
```

So:

```jsx
function button() { return <b>hi</b>; }
<button />   // renders an empty HTML <button>, NOT your function. Silent bug.
```

Dotted names are always treated as values, no capital required:

```jsx
<Form.Input />   →  _jsx(Form.Input, {})
```

And a dynamic type must be assigned to a capitalised variable first:

```jsx
// ❌ compiles to _jsx('tag', …)
const tag = 'h1';
<tag>Title</tag>

// ✅
const Tag = isHeading ? 'h1' : 'p';
<Tag>Title</Tag>
```

---

## 3. JSX rules, and the reason behind each

### One root element

```jsx
// ❌ a function can't return two things
return <h1 /><p />;

// ✅ wrap
return <div><h1 /><p /></div>;

// ✅ better — a Fragment adds no DOM node
return <><h1 /><p /></>;
return <React.Fragment><h1 /><p /></React.Fragment>;
```

Use the long form when you need a `key` (in a list):

```jsx
{rows.map(r => (
  <React.Fragment key={r.id}>
    <dt>{r.term}</dt>
    <dd>{r.def}</dd>
  </React.Fragment>
))}
```

### Everything closes

```jsx
<img src={src} />     <br />     <input />
```

Because JSX is parsed as JavaScript expressions, not lenient HTML.

### Attributes use JS names

`class` and `for` are reserved words in JavaScript, so:

| HTML | JSX |
| :-- | :-- |
| `class` | `className` |
| `for` | `htmlFor` |
| `tabindex` | `tabIndex` |
| `onclick` | `onClick` (camelCase) |
| `style="color:red"` | `style={{ color: 'red' }}` (an object, camelCased) |

```jsx
<div style={{ backgroundColor: 'red', marginTop: 8 }} />
// numbers get 'px' automatically for most properties
```

The double braces are not special syntax: outer `{}` = "JS expression here", inner `{}` = an object literal.

---

## 4. `{}` holds an **expression**, not a statement

```jsx
{count}                       // ✅ variable
{count + 1}                   // ✅ expression
{user.name.toUpperCase()}     // ✅ call
{cond ? <A /> : <B />}        // ✅ ternary — an expression
{items.map(i => <li key={i.id}>{i.t}</li>)}   // ✅ map returns a value

{if (x) { ... }}              // ❌ `if` is a statement
{for (…) { … }}               // ❌ so is `for`
```

Compute the value above the `return` when a ternary would get ugly:

```jsx
function Status({ state }) {
  let content;
  if (state === 'loading')      content = <Spinner />;
  else if (state === 'error')   content = <Error />;
  else                          content = <Data />;

  return <section>{content}</section>;
}
```

### What React renders for each value

```jsx
{'text'}      // "text"
{42}          // "42"
{0}           // "0"       ⚠️  renders! see the && trap below
{true}        // nothing
{false}       // nothing
{null}        // nothing
{undefined}   // nothing
{[a, b, c]}   // each item, in order
{{a: 1}}      // 💥 "Objects are not valid as a React child"
```

The `&&` trap, again, because it's the most common beginner bug:

```jsx
{items.length && <List />}        // renders "0" when empty
{items.length > 0 && <List />}    // ✅
{!!items.length && <List />}      // ✅
```

---

## 5. Spread attributes

```jsx
const props = { id: 'x', className: 'card', onClick: fn };
<div {...props} />                       // spreads every key as an attribute
<div {...props} className="override" />  // later wins
<div className="base" {...props} />      // props wins — ORDER MATTERS
```

The idiomatic "extract mine, forward the rest" pattern:

```jsx
function Button({ variant = 'primary', children, ...rest }) {
  return (
    <button className={`btn btn-${variant}`} {...rest}>
      {children}
    </button>
  );
}

<Button variant="danger" onClick={save} disabled aria-label="Save">Save</Button>
// variant is consumed; onClick, disabled and aria-label flow through to the real <button>
```

This is how every component library builds primitives that stay compatible with the underlying HTML element.

---

## 6. Elements are immutable descriptions

```js
const el = <h1>Hello</h1>;
el.props.children = 'Bye';    // ❌ frozen in development; meaningless anyway
```

An element is a snapshot of one moment. To change the screen you produce a **new** element tree — that's what a re-render is.

```
render 1 → element tree A ──┐
                            ├──▶ React diffs A vs B ──▶ minimal DOM edits
render 2 → element tree B ──┘
```

### `createElement` is called during evaluation, not on render

This trips people up:

```jsx
function Parent() {
  console.log('parent renders');
  return <Child slot={<Expensive />} />;   // <Expensive/> element is CREATED here…
}
```

Creating `<Expensive />` just builds `{type: Expensive, props: {}}` — an object. `Expensive`'s function body does not run until React reaches that element while rendering. Creating elements is cheap; rendering them is the work.

This is the mechanism behind the "pass children to skip re-renders" optimisation in [What Causes Re-renders](./37-what-causes-rerenders.md).

---

## 7. `key` and `ref` are not props

```jsx
<Item key="a" ref={r} title="x" />
```

```js
{ type: Item, key: 'a', ref: r, props: { title: 'x' } }
//             ^^^^^^^^^^^^^^^  lifted OUT of props
```

`key` is a hint to the reconciler about identity across renders ([Lists & Keys](./10-lists-and-keys.md)). `ref` is a slot the renderer fills in ([useRef](./21-useRef.md)). Neither reaches your component as a prop:

```jsx
function Item({ key }) {        // ❌ always undefined, and React warns
```

> In **React 19**, `ref` *is* passed as an ordinary prop to function components, and `forwardRef` is no longer needed. `key` remains special.

---

## 8. Comments, whitespace, and raw HTML

```jsx
<div>
  {/* a JSX comment is an expression containing a block comment */}
  <span>a</span> <span>b</span>   {/* this space IS rendered */}
  <span>a</span>
  <span>b</span>                  {/* newline-only whitespace is stripped */}
  {' '}                           {/* explicit space when you need one */}
</div>
```

Raw HTML requires an explicitly ugly API, on purpose:

```jsx
<div dangerouslySetInnerHTML={{ __html: userContent }} />
```

React escapes all `{}` content by default, which neutralises XSS. `dangerouslySetInnerHTML` opts out — sanitise with DOMPurify first, always.

---

## 9. De-sugaring exercise

```jsx
function App({ items, onPick }) {
  return (
    <ul className="list">
      {items.map(item => (
        <li key={item.id} onClick={() => onPick(item.id)}>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
```

becomes, conceptually:

```js
function App({ items, onPick }) {
  return _jsx('ul', {
    className: 'list',
    children: items.map(item =>
      _jsx('li', {
        onClick: () => onPick(item.id),
        children: item.label,
      }, item.id)          // ← key is the 3rd argument, outside props
    ),
  });
}
```

Read that until it's obvious. Everything else in React is built on this shape.

---

## 🧠 Rapid-fire recall

1. What object does `<h1 className="a">Hi</h1>` produce?
2. Why must your components start with a capital letter?
3. Why is `className` used instead of `class`?
4. What does `{0 && <List/>}` render, and why?
5. What is the difference between creating `<Expensive />` and rendering it?
6. Where do `key` and `ref` live on the element object, and can a component read them?
7. Why is `dangerouslySetInnerHTML` named so aggressively?

<details>
<summary>Answers</summary>

1. Roughly `{$$typeof: Symbol(react.element), type: 'h1', key: null, ref: null, props: {className: 'a', children: 'Hi'}}`.
2. The JSX transform maps lowercase names to the *string* `'div'` (a host element) and capitalised names to the *variable* of that name. A lowercase component name silently becomes an unknown HTML tag.
3. `class` is a reserved word in JavaScript, and JSX props become object keys in real JS code. Same reason for `htmlFor`.
4. `0`. React renders numbers and strings; it only ignores `false`, `null`, `undefined` and `true`. Use an explicit boolean comparison.
5. Creating it evaluates `_jsx(Expensive, {})` → a small object. The component function itself only runs when React reconciles that element, during the render phase.
6. They are hoisted onto the element object itself (`element.key`, `element.ref`), not into `props`, so a component cannot read `props.key`. (React 19 does pass `ref` as a normal prop.)
7. Because it bypasses React's automatic escaping of interpolated content, which is what otherwise makes XSS through `{}` impossible. The name is deliberate friction.

</details>
