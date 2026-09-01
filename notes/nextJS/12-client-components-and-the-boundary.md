---
title: Client Components & The Boundary
author: Tejas Nirala
---

# Client Components & The Boundary

`'use client'` is not "make this run in the browser". It marks the **entry point into the client bundle** — and everything that entry point imports comes with it. Understanding that one sentence prevents most of the bundle-size and "why is this a client component?" confusion.

---

## 1. The directive

```jsx
'use client';                        // must be the FIRST line, before imports

import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

You need it whenever a component uses:

```
useState, useReducer, useEffect, useRef, useContext, useLayoutEffect, …
onClick, onChange, onSubmit and every other event handler
window, document, localStorage, navigator, IntersectionObserver
a class component
any custom hook or third-party component that uses the above
```

---

## 2. The boundary is a module graph, not a component

This is the crucial mental model.

```
app/page.jsx                    ← Server Component
  └── imports Dashboard.jsx     ← 'use client'  ◀── THE BOUNDARY
        ├── imports Chart.jsx           → becomes a Client Component automatically
        ├── imports Table.jsx           → client
        │     └── imports Row.jsx       → client
        └── imports formatDate.js       → shipped to the client
```

Once a module is inside the client graph, **everything it imports is too** — transitively, with no directive needed on the children.

```jsx
// Chart.jsx — no 'use client' here, and it doesn't need one
export function Chart() { return <svg>…</svg>; }
// It's a client component because Dashboard imported it from inside the boundary.
```

So a `'use client'` at the top of a layout can pull your entire application into the client bundle without a single error message.

```
❌ THE MISTAKE
app/layout.jsx
'use client';                    // added because of one theme toggle
  → every page, every component below → all client
  → RSC gains: zero
```

```
✅ THE FIX
app/layout.jsx                   (server)
  └── <ThemeToggle />            ← 'use client' on the 20-line toggle only
```

**Push the boundary down.** The rule of thumb: `'use client'` belongs on leaves, not on trunks.

---

## 3. Client Components still render on the server

The name is misleading. A Client Component runs **twice**:

```
1. On the server, during SSR → produces the initial HTML
2. In the browser, during hydration → attaches handlers, becomes interactive
```

Consequences:

```jsx
'use client';

export default function Bad() {
  const width = window.innerWidth;      // 💥 ReferenceError during SSR
  return <div>{width}</div>;
}

export default function Good() {
  const [width, setWidth] = useState(0);
  useEffect(() => { setWidth(window.innerWidth); }, []);   // effects only run in the browser
  return <div>{width}</div>;
}
```

Anything browser-only must live in an effect, an event handler, or behind a mounted check ([Hydration](./15-hydration.md)).

To skip SSR entirely for a component that genuinely can't render on the server:

```jsx
'use client';
import dynamic from 'next/dynamic';

const Map = dynamic(() => import('./Map'), {
  ssr: false,                            // ⚠️ only allowed in a Client Component
  loading: () => <MapSkeleton />,
});
```

---

## 4. Keeping the boundary small — worked examples

### a) Extract just the interactive part

```jsx
// ❌ the whole page becomes client code
'use client';
export default function ProductPage({ product }) {
  const [qty, setQty] = useState(1);
  return (
    <div>
      <h1>{product.name}</h1>
      <LongDescription html={product.description} />     {/* static, but now client */}
      <Reviews items={product.reviews} />                {/* static, but now client */}
      <input value={qty} onChange={e => setQty(+e.target.value)} />
      <button onClick={() => addToCart(product.id, qty)}>Add</button>
    </div>
  );
}
```

```jsx
// ✅ server page, one small client island
export default async function ProductPage({ params }) {
  const product = await getProduct((await params).id);
  return (
    <div>
      <h1>{product.name}</h1>
      <LongDescription html={product.description} />     {/* server: 0 KB */}
      <Reviews items={product.reviews} />                {/* server: 0 KB */}
      <AddToCart productId={product.id} />               {/* client: ~1 KB */}
    </div>
  );
}
```

```jsx
// AddToCart.jsx
'use client';
export function AddToCart({ productId }) {
  const [qty, setQty] = useState(1);
  return <>
    <input value={qty} onChange={e => setQty(+e.target.value)} />
    <button onClick={() => addToCart(productId, qty)}>Add</button>
  </>;
}
```

The markdown renderer, the review formatting and the product data all stayed on the server.

### b) Providers: wrap `children`, don't consume them

```jsx
// app/providers.jsx
'use client';
export function Providers({ children }) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {children}                                {/* ← a HOLE, not client code */}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
```

```jsx
// app/layout.jsx — stays a Server Component
import { Providers } from './providers';

export default function RootLayout({ children }) {
  return <html><body><Providers>{children}</Providers></body></html>;
}
```

`children` is rendered by the *server* layout and passed in as already-rendered output. Wrapping your whole app in client providers does **not** make your whole app client-side — this surprises everyone the first time.

---

## 5. `'use client'` in third-party libraries

```jsx
// ❌ a library without 'use client' that uses hooks
import { Carousel } from 'some-old-library';
export default function Page() { return <Carousel />; }   // 💥 error in a server component
```

Fix by wrapping it yourself:

```jsx
// components/carousel.jsx
'use client';
export { Carousel } from 'some-old-library';
```

Then import your wrapper. Modern libraries ship the directive themselves; older ones don't.

### The barrel-file trap

```jsx
// components/index.js
export * from './Button';        // client
export * from './Card';          // server-safe
export * from './Modal';         // client

// a server component
import { Card } from '@/components';    // ⚠️ may pull the whole barrel into the client graph
```

Import directly from the source file (`@/components/card`) in server components. Barrel files also slow builds measurably in large projects — `optimizePackageImports` in `next.config.js` mitigates it for known packages.

---

## 6. When a client component is the right answer

Don't over-correct. These genuinely belong on the client:

```
• Anything with immediate interactive feedback: forms with live validation,
  drag and drop, canvas, rich text editors, charts with tooltips
• Anything reading browser state: window size, scroll position, media queries,
  geolocation, clipboard
• Anything using a client-side store or a real-time subscription
• Optimistic UI
• Third-party widgets that require the DOM
```

The goal is a **small, well-placed** boundary — not the absence of one.

---

## 7. Measuring the boundary

```bash
npm run build
```

```
Route (app)                    Size     First Load JS
┌ ○ /                          1.2 kB          89 kB
├ ○ /blog                      0.8 kB          88 kB
└ ƒ /dashboard                45.3 kB         134 kB     ← investigate this
```

"First Load JS" is what a visitor downloads for that route. A number that jumps by tens of kilobytes usually means a `'use client'` moved up the tree, or a heavy library entered the client graph.

```bash
ANALYZE=true npm run build      # with @next/bundle-analyzer, to see WHAT is in there
```

---

## 8. Mistakes

```jsx
// 1. The directive not first
import x from 'y';
'use client';                    // ❌ ignored

// 2. On a layout or page for one small interaction
// 3. Assuming it means "browser only" — it also runs during SSR
// 4. Importing a Server Component into a Client Component
'use client';
import ServerThing from './server-thing';       // ❌ pass it as children instead

// 5. Passing a function prop across the boundary
<ClientThing onSave={() => db.save()} />        // ❌ not serialisable
                                                 // ✅ use a 'use server' action

// 6. Reading process.env secrets in a client component → undefined
// 7. Barrel imports dragging client modules into server components
```

---

## 🧠 Rapid-fire recall

1. What does `'use client'` actually mark?
2. Does a component imported by a client component need its own directive?
3. Why is `'use client'` on a root layout a serious mistake?
4. Do Client Components run on the server? What follows from that?
5. Why doesn't wrapping the app in client providers make the whole app client-side?
6. How do you use a hook-based library that lacks the directive inside a Server Component?
7. Which build output number tells you the boundary has crept upward?

<details>
<summary>Answers</summary>

1. The entry point into the client bundle for a module graph. Everything that module imports, transitively, becomes part of the client bundle.
2. No — it's inherited through the import graph. A component imported from inside the boundary is a client component automatically.
3. Everything below it — every page and component — enters the client graph, so you ship the entire app to the browser and gain nothing from RSC. Put the directive on the small interactive leaf instead.
4. Yes, once during SSR to produce the initial HTML. So browser-only APIs must be used inside effects, event handlers or behind a mounted check, or the server render crashes.
5. `children` is rendered by the server layout and passed into the client provider as an already-rendered hole. The provider's own code ships; the children's code does not.
6. Re-export it from your own module that starts with `'use client'`, and import your wrapper instead of the library directly.
7. "First Load JS" per route in the `next build` output. A sudden jump means a client boundary moved up or a heavy library entered the client graph.

</details>
