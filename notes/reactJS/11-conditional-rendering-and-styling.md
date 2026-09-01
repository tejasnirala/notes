---
title: Conditional Rendering & Styling
author: Tejas Nirala
---

# Conditional Rendering & Styling

Two everyday concerns: deciding *what* appears, and deciding what it *looks like*. Both are plain JavaScript in React, which is a feature — and a source of a few sharp edges.

---

## 1. The four ways to render conditionally

```jsx
// 1. Early return — best when the whole component differs
function Profile({ user }) {
  if (!user) return <Skeleton />;
  return <div>{user.name}</div>;
}

// 2. Ternary — best for either/or inside JSX
<div>{isLoggedIn ? <Dashboard /> : <Login />}</div>

// 3. Logical AND — best for "render this or nothing"
<div>{hasError && <ErrorBanner />}</div>

// 4. A variable computed above the return — best for 3+ branches
let content;
if (status === 'loading')     content = <Spinner />;
else if (status === 'error')  content = <Error />;
else                          content = <Data />;
return <main>{content}</main>;
```

### The `&&` trap, once more

```jsx
{count && <Badge count={count} />}          // ❌ renders "0" when count is 0
{count > 0 && <Badge count={count} />}      // ✅
{!!count && <Badge count={count} />}        // ✅
{count ? <Badge count={count} /> : null}    // ✅
```

React skips `false`, `null`, `undefined`, `true`. It **renders** `0` and `NaN`.

Same trap with empty strings:

```jsx
{name && <h1>{name}</h1>}         // '' is falsy → nothing renders. Fine here.
{items.length && <List />}        // 0 → renders "0". Not fine.
```

### Guard clauses beat nesting

```jsx
// ❌ pyramid
return (
  <div>
    {user ? (
      user.isActive ? (
        user.hasSubscription ? <Content /> : <Upsell />
      ) : <Suspended />
    ) : <Login />}
  </div>
);

// ✅ flat
if (!user)                return <Login />;
if (!user.isActive)       return <Suspended />;
if (!user.hasSubscription) return <Upsell />;
return <Content />;
```

### A lookup map for many branches

```jsx
const VIEWS = {
  list: ListView,
  grid: GridView,
  map:  MapView,
};

function Results({ view, ...props }) {
  const View = VIEWS[view] ?? ListView;    // capitalised variable → JSX uses the value
  return <View {...props} />;
}
```

This turns an if/else chain into data, and makes adding a view a one-line change.

---

## 2. Conditional rendering vs conditional *display*

```jsx
{isOpen && <Panel />}                                   // UNMOUNTS — state destroyed
<Panel style={{ display: isOpen ? 'block' : 'none' }} /> // stays mounted — state kept
```

| | Unmount (`&&`) | Hide (CSS) |
| :-- | :-- | :-- |
| Component state | destroyed | preserved |
| Effects | cleanup runs / re-runs | keep running |
| DOM nodes | removed | present but invisible |
| Cost of toggling | re-mount + re-render | one style change |
| Accessibility | correctly absent from the tree | `display:none` also hides it from AT ✅ |

Use unmounting by default (it's cheaper in memory and correct for the a11y tree). Use hiding when remounting is expensive (a mounted map, a video, an editor with a long undo stack) or when you must preserve scroll position.

⚠️ `visibility: hidden` and `opacity: 0` still leave the element in the accessibility tree and focusable — use `display: none` or the `hidden` attribute, or `inert`.

---

## 3. Loading, error and empty — the four states

Every data-driven component has four states, and most bugs are a missing one.

```jsx
function UserList() {
  const { status, data, error } = useUsers();

  if (status === 'pending') return <Skeleton rows={5} />;
  if (status === 'error')   return <ErrorState error={error} onRetry={refetch} />;
  if (data.length === 0)    return <EmptyState message="No users yet" />;

  return <ul>{data.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

Prefer a **skeleton** over a spinner: it preserves layout, so nothing shifts when the data lands (better CLS), and it communicates the shape of what's coming.

---

## 4. Styling: the options

React has no opinion. Here's the honest comparison.

| Approach | Scoped? | Runtime cost | Dynamic values | Notes |
| :-- | :-- | :-- | :-- | :-- |
| Plain CSS + `className` | ❌ global | none | via classes | Fine for small apps; naming discipline required (BEM) |
| **CSS Modules** | ✅ per file | none | via classes | Build-time; the safe default |
| **Tailwind** | ✅ by construction | none | via class strings | Utility-first; huge ecosystem; verbose markup |
| **CSS-in-JS** (styled-components, Emotion) | ✅ | runtime (some) | ✅ full JS | Ergonomic; a real cost in RSC/SSR |
| **Zero-runtime CSS-in-JS** (vanilla-extract, Panda, Linaria) | ✅ | none | build-time variants | Best of both; more setup |
| Inline `style` | ✅ | none | ✅ | No pseudo-classes, media queries or cascade |

### `className` and conditional classes

```jsx
<div className={`card ${isActive ? 'card--active' : ''} ${size}`} />
```

That gets ugly fast. Use `clsx` (this repo already depends on it):

```jsx
import clsx from 'clsx';

<div className={clsx(
  'card',
  isActive && 'card--active',
  isDisabled && 'card--disabled',
  { 'card--large': size === 'lg' },
)} />
```

`clsx` drops falsy values, so `false && 'x'` contributes nothing.

### Tailwind + variants, the modern component pattern

```jsx
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';      // clsx + tailwind-merge

const button = cva(
  'inline-flex items-center rounded font-medium transition disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:  'bg-blue-600 text-white hover:bg-blue-700',
        outline:  'border border-slate-300 hover:bg-slate-50',
        ghost:    'hover:bg-slate-100',
      },
      size: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4', lg: 'h-12 px-6 text-lg' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export function Button({ variant, size, className, ...rest }) {
  return <button className={cn(button({ variant, size }), className)} {...rest} />;
}
```

`tailwind-merge` inside `cn` resolves conflicts intelligently: `cn('px-4', 'px-6')` yields `px-6` rather than both.

### CSS Modules

```css
/* Button.module.css */
.button { padding: 8px 16px; }
.primary { background: #2563eb; color: white; }
```

```jsx
import styles from './Button.module.css';

<button className={clsx(styles.button, isPrimary && styles.primary)} />
```

The bundler rewrites `.button` to a hashed name like `Button_button__x7f2a`, so collisions are impossible.

### Inline styles — and what they can't do

```jsx
<div style={{ width: progress + '%', backgroundColor: color }} />
```

Genuinely useful for values computed at runtime (a progress bar, a chart position, a drag transform). But inline styles cannot express `:hover`, `::before`, media queries, or cascade. The modern hybrid is **CSS custom properties**:

```jsx
<div className="progress" style={{ '--value': `${progress}%` }} />
```

```css
.progress::after { width: var(--value); transition: width .3s; }
.progress:hover::after { filter: brightness(1.2); }   /* things inline style can't do */
```

### Theming with CSS variables

```css
:root            { --bg: #fff; --fg: #111; }
[data-theme=dark]{ --bg: #111; --fg: #eee; }
body { background: var(--bg); color: var(--fg); }
```

```jsx
<html data-theme={theme}>
```

One attribute flips the whole app, with no re-render of any styled component and no flash of unstyled content if you set it before hydration.

---

## 5. Animation

```jsx
// CSS transitions — free, GPU-friendly, always try this first
<div className={clsx('panel', isOpen && 'panel--open')} />
```

```css
.panel { opacity: 0; transform: translateY(-8px); transition: .2s; pointer-events: none; }
.panel--open { opacity: 1; transform: none; pointer-events: auto; }
```

Animate `transform` and `opacity` only — they skip layout and paint ([The DOM & The Browser](./01-dom-and-the-browser.md)).

**Exit animations are the hard part**, because `{isOpen && <Panel/>}` removes the node instantly and there's nothing left to animate. Options:

1. Keep it mounted and animate `opacity`/`transform`, removing it after `transitionend`.
2. Use a library: **Framer Motion** (`<AnimatePresence>`) or **react-transition-group**.
3. Modern CSS: `@starting-style` plus `transition-behavior: allow-discrete` handles enter/exit natively for `display`.

```jsx
<AnimatePresence>
  {isOpen && (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
    />
  )}
</AnimatePresence>
```

Always respect user preference:

```css
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
```

---

## 6. Choosing, in practice

- **New app, no constraints:** Tailwind + `cva` + `tailwind-merge`, or CSS Modules if the team dislikes utility classes.
- **Design system across many apps:** vanilla-extract or Panda (zero runtime, typed tokens).
- **Server Components / Next.js App Router:** avoid runtime CSS-in-JS — it needs client-side context and breaks streaming. Tailwind, CSS Modules and zero-runtime libraries are the safe choices.
- **Legacy app:** whatever's already there. Consistency beats fashion.

---

## 🧠 Rapid-fire recall

1. Name the four conditional-rendering forms and when each fits best.
2. Why does `{items.length && <List/>}` put a `0` on screen?
3. What's the practical difference between `{open && <Panel/>}` and `display:none`?
4. Which two CSS properties should you animate, and why?
5. Why is exit animation harder than enter animation in React?
6. What problem does `tailwind-merge` solve that `clsx` does not?
7. Why is runtime CSS-in-JS discouraged in React Server Components?

<details>
<summary>Answers</summary>

1. Early return (the whole component differs), ternary (either/or inline), `&&` (this or nothing), and a variable computed above the return (three or more branches). A lookup map replaces long if/else chains.
2. `0` is falsy so `&&` evaluates to `0`, and React renders numbers — it only skips `false`, `null`, `undefined` and `true`.
3. `&&` unmounts: state and DOM are destroyed and effects clean up. `display:none` keeps the component mounted with its state, effects and DOM intact, hidden from both the screen and assistive tech.
4. `transform` and `opacity` — they're handled by the compositor, skipping layout and paint, so they can hold 60fps.
5. Unmounting removes the DOM node immediately, so there is nothing left to transition. You must delay the removal (a library like Framer Motion's `AnimatePresence`, or `transitionend`, or modern `@starting-style` + `allow-discrete`).
6. Conflict resolution between Tailwind utilities: `cn('px-4','px-6')` produces `px-6`, whereas `clsx` would emit both and let CSS order decide unpredictably.
7. It needs a client-side context/provider to inject styles, which forces components to become client components, adds runtime cost, and interferes with streaming SSR.

</details>
