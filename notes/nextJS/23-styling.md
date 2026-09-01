---
title: Styling
author: Tejas Nirala
---

# Styling

Every styling approach works in Next.js, but Server Components changed the calculus: anything requiring a runtime context provider now has a real cost. This page covers the options and the RSC-specific constraints.

---

## 1. The options, with the RSC caveat

| Approach | RSC-compatible | Runtime cost | Notes |
| :-- | :-- | :-- | :-- |
| **Tailwind** | ✅ | none | The de-facto default for new Next.js apps |
| **CSS Modules** | ✅ | none | Built in, scoped, zero config |
| **Global CSS** | ✅ | none | For resets, tokens, base styles |
| **vanilla-extract / Panda** | ✅ | none | Typed, build-time CSS-in-JS |
| **styled-components / Emotion** | ⚠️ client only | runtime | Needs a provider → forces `'use client'` |
| **Inline styles** | ✅ | none | For runtime-computed values only |

The dividing line: **runtime CSS-in-JS needs a React context to collect and inject styles**, which means a client component, which means the tree below it ships to the browser ([Client Components](./12-client-components-and-the-boundary.md)). Build-time solutions have no such requirement.

---

## 2. Global CSS

```css
/* app/globals.css */
@import 'tailwindcss';                     /* Tailwind v4 */

:root {
  --bg: #ffffff;
  --fg: #111111;
  --accent: #2563eb;
}

.dark {
  --bg: #0b0b0f;
  --fg: #eaeaea;
}

body { background: var(--bg); color: var(--fg); }
```

```jsx
// app/layout.jsx — imported ONCE, in the root layout
import './globals.css';
```

CSS custom properties are the best theming mechanism available: flipping one class on `<html>` re-themes the entire app with no re-render and no context.

---

## 3. CSS Modules

```css
/* Button.module.css */
.button { padding: 8px 16px; border-radius: 6px; }
.primary { background: var(--accent); color: white; }
```

```jsx
import styles from './Button.module.css';
import clsx from 'clsx';

export function Button({ variant, className }) {
  return <button className={clsx(styles.button, variant === 'primary' && styles.primary, className)} />;
}
```

The bundler rewrites `.button` to a hashed name, so collisions are impossible. Works in Server Components with no setup. A perfectly good choice if your team dislikes utility classes.

---

## 4. Tailwind

```jsx
<div className="flex items-center gap-4 rounded-lg border p-4 hover:bg-slate-50
                dark:border-slate-800 dark:hover:bg-slate-900">
```

Why it fits Next.js particularly well:

- **Zero runtime.** Just class names in the HTML — nothing to hydrate, nothing to inject.
- **Works in Server Components** with no provider.
- **The CSS doesn't grow with your app** — a thousand components reuse the same utilities, so the stylesheet plateaus.

### Component variants

```jsx
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';                // clsx + tailwind-merge

const button = cva('inline-flex items-center rounded-md font-medium transition disabled:opacity-50', {
  variants: {
    variant: {
      primary: 'bg-blue-600 text-white hover:bg-blue-700',
      outline: 'border border-slate-300 hover:bg-slate-50',
      ghost: 'hover:bg-slate-100',
    },
    size: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4', lg: 'h-12 px-6' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

export function Button({ variant, size, className, ...props }) {
  return <button className={cn(button({ variant, size }), className)} {...props} />;
}
```

```jsx
// lib/utils.js
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...inputs) => twMerge(clsx(inputs));
```

`tailwind-merge` resolves conflicts intelligently — `cn('px-4', 'px-6')` yields `px-6` rather than emitting both and relying on stylesheet order. That's what makes the `className` override prop actually work.

### Dynamic classes — the trap

```jsx
// ❌ Tailwind scans your source as TEXT. It will never see "text-red-500".
<div className={`text-${color}-500`} />

// ✅ full class names, present in the source
const colors = { red: 'text-red-500', blue: 'text-blue-500' };
<div className={colors[color]} />

// ✅ or an arbitrary value / CSS variable for genuinely runtime values
<div style={{ '--w': `${pct}%` }} className="w-[var(--w)]" />
```

---

## 5. CSS-in-JS in the App Router

If you must use styled-components or Emotion, they need a client-side registry so styles are collected during SSR and injected into the head:

```jsx
// lib/styled-registry.jsx
'use client';
import { useState } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { ServerStyleSheet, StyleSheetManager } from 'styled-components';

export function StyledRegistry({ children }) {
  const [sheet] = useState(() => new ServerStyleSheet());

  useServerInsertedHTML(() => {
    const styles = sheet.getStyleElement();
    sheet.instance.clearTag();
    return <>{styles}</>;
  });

  if (typeof window !== 'undefined') return children;
  return <StyleSheetManager sheet={sheet.instance}>{children}</StyleSheetManager>;
}
```

```jsx
// app/layout.jsx
<StyledRegistry>{children}</StyledRegistry>
```

`useServerInsertedHTML` is the Next.js hook that lets a library inject markup into the document head during streaming SSR.

**But understand the cost:** any component using `styled.div` must be a Client Component. In practice that pulls most of your UI into the client bundle, which is precisely what RSC was meant to avoid. For a new project, prefer Tailwind, CSS Modules, or a zero-runtime library (vanilla-extract, Panda).

---

## 6. Dark mode

```jsx
// app/providers.jsx
'use client';
import { ThemeProvider } from 'next-themes';

export function Providers({ children }) {
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem>{children}</ThemeProvider>;
}
```

```jsx
// app/layout.jsx
<html lang="en" suppressHydrationWarning>
  <body><Providers>{children}</Providers></body>
</html>
```

`suppressHydrationWarning` on `<html>` is required because a blocking inline script sets the theme class before React hydrates — a deliberate, known mismatch ([Hydration](./15-hydration.md)).

```jsx
'use client';
function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-9 w-9" />;   // same-size placeholder → no CLS
  return <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>…</button>;
}
```

A cookie-based alternative avoids the inline script entirely: store the preference in a cookie, read it in the root layout with `cookies()`, and render the class server-side. The trade is that the layout becomes dynamic.

---

## 7. Where to put styles

```
app/globals.css              tokens, resets, base element styles
components/ui/*.module.css   component styles (if using CSS Modules)
Tailwind classes             inline in JSX
inline style={{}}            ONLY for runtime-computed values (progress %, transforms)
```

```jsx
// ✅ a legitimate inline style — the value only exists at runtime
<div className="h-2 rounded bg-blue-600" style={{ width: `${progress}%` }} />
```

Inline styles can't express `:hover`, `::before`, media queries or the cascade — so keep them to genuinely dynamic values, ideally via a CSS custom property so the rest stays in CSS.

---

## 8. Animation

```css
/* CSS first — free, GPU-friendly */
.panel { opacity: 0; transform: translateY(-8px); transition: .2s; }
.panel--open { opacity: 1; transform: none; }
```

Animate `transform` and `opacity` only; they're compositor-only and skip layout and paint ([React: The DOM & The Browser](/reactJS/dom-and-the-browser)).

```jsx
// Framer Motion needs 'use client' — keep it on a small leaf
'use client';
import { motion } from 'framer-motion';
export function FadeIn({ children }) {
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{children}</motion.div>;
}
```

```jsx
// page transitions with template.tsx — a new instance on every navigation
// app/template.jsx
'use client';
export default function Template({ children }) {
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{children}</motion.div>;
}
```

Always respect the user's preference:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

---

## 9. Choosing

```
New project, no constraints        → Tailwind + cva + tailwind-merge
Team dislikes utility classes      → CSS Modules
Design system across several apps  → vanilla-extract or Panda (typed tokens, zero runtime)
Existing styled-components app     → keep it; add the registry; expect a larger client bundle
Just theming                       → CSS custom properties + a class on <html>
```

Consistency matters more than the choice. Two styling systems in one codebase is worse than either alone.

---

## 🧠 Rapid-fire recall

1. Why is runtime CSS-in-JS a problem with Server Components?
2. Why does Tailwind suit RSC particularly well?
3. Why doesn't `` className={`text-${color}-500`} `` work, and what are the two fixes?
4. What does `tailwind-merge` do that `clsx` doesn't?
5. What does `useServerInsertedHTML` exist for?
6. Why is `suppressHydrationWarning` needed on `<html>` for dark mode?
7. When is an inline `style` the right choice?

<details>
<summary>Answers</summary>

1. It needs a React context provider to collect and inject styles during rendering, which forces the components using it to be Client Components — pulling the tree into the client bundle and undoing RSC's benefit.
2. It's zero-runtime — just class names in the HTML with nothing to hydrate or inject — it needs no provider, and its stylesheet plateaus in size because components reuse the same utilities.
3. Tailwind scans source files as plain text for complete class names, so an interpolated fragment never appears and the class is never generated. Fix with a lookup map of full class names, or a CSS custom property with an arbitrary-value utility.
4. It resolves conflicting Tailwind utilities so a later one wins (`cn('px-4','px-6')` → `px-6`), which is what makes a `className` override prop behave predictably.
5. It lets a styling library inject markup — typically collected `<style>` tags — into the document head during streaming SSR.
6. A blocking inline script sets the theme class before React hydrates, so the server HTML and the client's first render deliberately differ on that attribute.
7. Only for values that don't exist until runtime — a progress bar's width, a drag transform, a computed position. It can't express hover, pseudo-elements, media queries or the cascade.

</details>
