---
title: Hydration
author: Tejas Nirala
---

# Hydration

The step where server-rendered HTML becomes an interactive React app. It's also the source of the single most-reported Next.js error, and the reason "it works in development" isn't the same as "it works".

---

## 1. What hydration is

```
1. Server renders your components → HTML string → sent to the browser
2. Browser parses it → the user SEES content (but nothing is clickable)
3. Browser downloads the JS bundle
4. React runs your components again on the client
5. React walks the existing DOM and ATTACHES to it — building its fiber tree
   from the markup that's already there, and wiring up event handlers
6. The page becomes interactive
```

Step 5 is hydration. React is **not** rebuilding the DOM — it's adopting it. That's the whole point: reusing the server's markup instead of throwing it away.

```
  Server HTML                React's client render
  <div>                      <div>
    <button>0</button>  ←→     <button onClick={…}>0</button>
  </div>                     </div>
       │                            │
       └──────── must match ────────┘
```

---

## 2. The hydration gap

```
t=0      HTML arrives          🖼 content VISIBLE
t=0-800  JS downloading         ⚠️ visible but NOT interactive
t=800    hydration              ✅ interactive
```

During that window, clicks do nothing (or queue, depending on the interaction). This is measured as **INP** and **TBT**, and it's why shipping less JavaScript matters even when the content paints fast. It's also the strongest argument for RSC: components that ship no JS have no hydration cost at all.

---

## 3. Hydration mismatches

```
Error: Hydration failed because the server rendered HTML didn't match the client.
```

React compared what the server produced with what the client render produced and found a difference. Because it can't know which is correct, it discards the server HTML for that subtree and re-renders on the client — losing the performance benefit and sometimes producing a visible flash.

### Cause 1 — non-deterministic values

```jsx
// ❌ different on the server and the client, always
<p>{new Date().toLocaleTimeString()}</p>
<p>{Math.random()}</p>
<div id={Math.random()} />
```

```
Server (12:00:00.000):  <p>12:00:00</p>
Client (12:00:00.850):  <p>12:00:01</p>     ← mismatch
```

### Cause 2 — browser-only APIs during render

```jsx
// ❌ window doesn't exist on the server
const width = typeof window !== 'undefined' ? window.innerWidth : 0;
return <div>{width}</div>;
```

```
Server: 0
Client: 1440         ← mismatch
```

Note the guard *prevents the crash* but doesn't prevent the mismatch — you've made the two renders produce different output on purpose.

### Cause 3 — locale and timezone differences

```jsx
// ❌ the server is UTC; the user is in Tokyo
<p>{new Date(post.createdAt).toLocaleDateString()}</p>
<p>{price.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
```

### Cause 4 — invalid HTML nesting

```jsx
// ❌ the browser SILENTLY RESTRUCTURES invalid HTML during parsing
<p><div>text</div></p>        // → <p></p><div>text</div><p></p>
<div><tr>…</tr></div>
<a href="/x"><a href="/y">nested</a></a>
```

React rendered one tree; the browser's parser produced another. This one is sneaky because your JSX looks fine.

### Cause 5 — browser extensions

Grammarly, password managers and ad blockers inject attributes and elements into the DOM before React hydrates. Usually harmless and reported as an attribute mismatch on `<body>`.

### Cause 6 — reading `localStorage` or cookies during render

```jsx
// ❌ the server has no localStorage → renders 'light'; the client renders 'dark'
const theme = localStorage.getItem('theme') ?? 'light';
```

---

## 4. The fixes

### Fix A — render it in an effect

```jsx
'use client';
function Clock() {
  const [time, setTime] = useState(null);
  useEffect(() => { setTime(new Date().toLocaleTimeString()); }, []);
  return <p>{time ?? 'Loading…'}</p>;      // server and first client render agree
}
```

```
Server render:        <p>Loading…</p>
First client render:  <p>Loading…</p>       ✅ match → hydration succeeds
After the effect:     <p>12:00:01</p>       a normal update, not a mismatch
```

### Fix B — the mounted flag

```jsx
'use client';
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function ThemeToggle() {
  const mounted = useMounted();
  const { theme, setTheme } = useTheme();
  if (!mounted) return <div className="w-8 h-8" />;   // a same-size placeholder
  return <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>…</button>;
}
```

Return a **same-sized placeholder**, not `null` — otherwise you fix the mismatch and introduce a layout shift.

### Fix C — `suppressHydrationWarning`

```jsx
<time dateTime={iso} suppressHydrationWarning>{new Date(iso).toLocaleString()}</time>
```

It silences the warning **for that element's text/attributes only, one level deep**. Legitimate for timestamps and for `<html>`/`<body>` when a theme script or an extension modifies them. It is not a general fix — you're telling React "I know these differ and I accept it".

### Fix D — skip SSR entirely

```jsx
'use client';
import dynamic from 'next/dynamic';

const Chart = dynamic(() => import('./Chart'), { ssr: false, loading: () => <Skeleton /> });
```

Right for components that genuinely cannot render on the server: maps, canvas visualisations, anything reading `window` structurally.

### Fix E — do it on the server

```jsx
// ❌ formatting on the client, with a locale mismatch risk
<p>{new Date(post.createdAt).toLocaleDateString()}</p>

// ✅ format once, on the server, with an explicit locale and timezone
<p>{formatDate(post.createdAt, { locale: 'en-GB', timeZone: 'UTC' })}</p>
```

Being explicit about locale and timezone eliminates a whole class of these bugs. If you truly need the *user's* locale, render a stable value on the server and upgrade it in an effect.

---

## 5. The theme flash (FOUC), solved properly

The classic: the user prefers dark mode, but the server doesn't know that, so it renders light and the page flashes white before the effect corrects it.

```jsx
// app/layout.jsx
export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            const t = localStorage.getItem('theme') ??
              (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            document.documentElement.classList.add(t);
          } catch {}
        `}} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

```
1. HTML arrives, <html> has no theme class
2. The BLOCKING inline script runs BEFORE the browser paints anything
   → adds .dark to <html>
3. First paint is already dark               ✅ no flash
4. React hydrates; suppressHydrationWarning covers the class React didn't render
```

The script must be **inline and blocking** — an external script or a deferred one runs after the first paint, which is exactly the flash you're avoiding. `next-themes` does precisely this.

A cookie-based alternative avoids the inline script entirely: store the theme in a cookie, read it in the root layout with `cookies()`, and render the class server-side. That costs you static rendering for the layout, which is often an acceptable trade.

---

## 6. Development vs production

Development gives you a detailed diff:

```
- Server: "12:00:00"
+ Client: "12:00:01"
    at Clock (app/components/Clock.tsx:8:5)
```

Production gives you a terse message and a digest. **So fix hydration warnings in development** — they are far harder to diagnose later, and in production they silently degrade to a client re-render.

Also note StrictMode's double rendering can make a mismatch more visible in development. That's it doing its job ([React: StrictMode](/reactJS/strict-mode)).

---

## 7. Reducing hydration cost

```
1. Fewer Client Components → less to hydrate. This is the big one.
2. Push 'use client' down to leaves.
3. Code-split heavy client components with next/dynamic.
4. Avoid huge props: everything passed to a client component is serialised
   into the payload AND parsed during hydration.
5. Use `content-visibility: auto` for long below-the-fold lists.
```

```bash
npm run build      # "First Load JS" per route is your hydration budget
```

---

## 8. Checklist for "hydration failed"

```
□ Is anything rendering Date/Math.random/uuid during render?
□ Is anything reading window/localStorage/navigator during render?
□ Any toLocaleString without an explicit locale and timeZone?
□ Any invalid HTML nesting (<div> inside <p>, anything odd in a table)?
□ Does it still happen in an incognito window with extensions disabled?
□ Does the server's data differ from the client's (a cached vs fresh response)?
□ Any conditional rendering keyed on something that differs across environments?
```

Nine times out of ten it's the first three.

---

## 🧠 Rapid-fire recall

1. What is hydration actually doing to the DOM?
2. What is the hydration gap, and which metric measures it?
3. What does React do when it finds a mismatch?
4. Name four causes of hydration mismatches.
5. Why does `typeof window !== 'undefined'` prevent a crash but not a mismatch?
6. Why must the anti-flash theme script be inline and blocking?
7. What's the most effective way to reduce hydration cost?

<details>
<summary>Answers</summary>

1. Adopting it. React builds its fiber tree from the existing server-rendered markup and attaches event handlers, rather than creating new DOM nodes.
2. The window between content being visible and being interactive, while JS downloads and hydration runs. Measured by INP and Total Blocking Time.
3. It discards the server HTML for that subtree and re-renders it on the client — losing the SSR benefit there and sometimes producing a visible flash.
4. Non-deterministic values (`Date.now`, `Math.random`), browser-only APIs read during render, locale/timezone differences, invalid HTML nesting, browser extensions, and reading `localStorage` during render.
5. The guard stops the server from crashing, but it makes the server render a different value (the fallback) from the client's — which is exactly a mismatch. Move the read into an effect instead.
6. An external or deferred script runs after the first paint, so the light-themed frame is already on screen. Only a blocking inline script in the head executes before the browser paints.
7. Ship fewer Client Components — keep `'use client'` on small leaves so most of the tree has nothing to hydrate at all.

</details>
