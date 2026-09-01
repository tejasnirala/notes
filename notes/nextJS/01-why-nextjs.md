---
title: Why Next.js Exists
author: Tejas Nirala
---

# Why Next.js Exists

React renders UI. That's all it does. Everything else an application needs — routing, a server, data loading, bundling, caching, deployment — is your problem. Next.js is the most widely adopted answer to "and now what?", and every one of its features is a response to a specific limitation you hit with React alone.

> This section assumes you know React. If `useState`, `useEffect` and the render/commit split aren't solid yet, read the [React section](/reactJS) first — particularly [The Render Pipeline](/reactJS/the-render-pipeline).

---

## 1. What a plain React SPA actually delivers

```html
<!-- index.html — everything the browser and every crawler initially receives -->
<!DOCTYPE html>
<html>
  <body>
    <div id="root"></div>
    <script src="/assets/index-a3f9.js"></script>
  </body>
</html>
```

An empty div. Now trace what has to happen before the user sees anything:

```
t=0      HTML arrives (2 KB)                          → blank white screen
t=100ms  browser parses, discovers the script tag
t=100ms  request bundle.js (600 KB)
t=600ms  bundle downloaded
t=900ms  parsed + executed (main thread, blocking)
t=900ms  React mounts, first render → still no data
t=900ms  useEffect fires → fetch('/api/products')
t=1300ms data arrives → re-render
t=1350ms 🖼 the user finally sees the products

Total: ~1.35s on good hardware and a good network.
On a mid-range Android over 4G: 4–6 seconds of blank screen.
```

Five distinct problems live in that trace:

| Problem | Consequence |
| :-- | :-- |
| **Blank first paint** | Poor LCP; users on slow connections see nothing for seconds |
| **SEO** | Crawlers that don't execute JS see an empty div. Social previews are blank. |
| **The data waterfall** | The fetch can't start until the JS has downloaded *and* executed |
| **Bundle size** | Every route's code ships to every user, whether they visit it or not |
| **No server** | Secrets, database access, and anything that must not reach the client have nowhere to live |

---

## 2. The fixes, and what each requires

### Fix 1 — send HTML that already has content (SSR)

```
Server renders React to an HTML string → sends real markup
Browser paints immediately → then downloads JS → then "hydrates" (attaches handlers)
```

```
t=0      request
t=200ms  server fetches data and renders → HTML with real content
t=250ms  🖼 the user SEES the products (not interactive yet)
t=800ms  JS downloaded and executed → hydration → now interactive
```

The content is visible at 250ms instead of 1350ms. This needs a Node server, a way to render on both sides, and a way to hydrate — none of which React alone provides.

### Fix 2 — render at build time (SSG)

For content that doesn't change per request, render once at build and serve static HTML from a CDN. TTFB drops to ~20ms because there's no computation at all.

### Fix 3 — split the bundle by route

Only ship the code for the page being viewed. This needs the bundler to know your route structure — which means routing must be a framework concern, not a library you install.

### Fix 4 — move components to the server entirely

The newest idea, and the biggest: some components never need to run in the browser at all. A product description page has no interactivity — why ship its code, its markdown parser, and its date-formatting library to every user? **React Server Components** run only on the server and send their *output*, not their code.

---

## 3. What Next.js actually is

```
              ┌───────────────────────────────────────────────┐
              │                  Next.js                      │
              ├───────────────────────────────────────────────┤
   Routing    │ file-system router, layouts, nested routes    │
   Rendering  │ SSR, SSG, ISR, streaming, RSC                 │
   Data       │ fetch with caching, Server Actions, revalidate│
   Backend    │ Route Handlers (API), Middleware              │
   Build      │ Turbopack/webpack, code splitting, tree shake │
   Optimize   │ Image, Font, Script, bundling, prefetch       │
   Deploy     │ Node & Edge runtimes, standalone output       │
              ├───────────────────────────────────────────────┤
              │                  React                        │
              │        components, hooks, reconciliation      │
              └───────────────────────────────────────────────┘
```

Everything Next.js adds is *around* React, not inside it. Your components are still React components; hooks still work exactly as documented in the React section. What changes is **where** they run and **when**.

---

## 4. The mental shift: two runtimes, one codebase

This is the concept that trips up everyone coming from a React SPA.

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│         SERVER               │        │         CLIENT               │
│  (Node.js or Edge runtime)   │        │        (the browser)         │
├──────────────────────────────┤        ├──────────────────────────────┤
│ ✅ database, filesystem      │        │ ✅ useState, useEffect       │
│ ✅ process.env secrets       │        │ ✅ onClick, onChange         │
│ ✅ await fetch directly      │        │ ✅ window, document, localStorage │
│ ✅ big libraries — free      │        │ ✅ browser APIs              │
│ ❌ no useState/useEffect     │        │ ❌ no secrets                │
│ ❌ no event handlers         │        │ ❌ no direct DB access       │
│ ❌ no window/document        │        │ ⚠️  every KB costs the user   │
└──────────────────────────────┘        └──────────────────────────────┘
```

In the App Router, **every component is a Server Component by default**. You opt into the client with `'use client'` — and you should do it as far down the tree as possible, because everything below that boundary ships to the browser.

```jsx
// app/page.jsx — a Server Component. Zero JS shipped for this.
import { db } from '@/lib/db';
import LikeButton from './LikeButton';

export default async function Page() {
  const posts = await db.post.findMany();        // runs on the server; no API route needed
  return posts.map(p => (
    <article key={p.id}>
      <h2>{p.title}</h2>
      <LikeButton postId={p.id} />               {/* only THIS ships to the browser */}
    </article>
  ));
}
```

```jsx
// app/LikeButton.jsx
'use client';
import { useState } from 'react';

export default function LikeButton({ postId }) {
  const [liked, setLiked] = useState(false);
  return <button onClick={() => setLiked(!liked)}>{liked ? '♥' : '♡'}</button>;
}
```

No `useEffect`, no loading state, no `/api/posts` endpoint, no client-side database credentials, and the JavaScript bundle contains a button — not a database client.

---

## 5. What it costs

Next.js is not free. Be honest about the trade:

| You gain | You pay |
| :-- | :-- |
| Fast first paint, SEO, streaming | A server to run and pay for (or a platform that runs it) |
| Zero-JS components | Two mental models — server and client — and a boundary to reason about |
| Automatic code splitting | Framework-owned routing; less freedom in structure |
| Built-in caching | A caching model with genuine complexity ([Caching](./17-caching.md)) |
| Image/font optimisation | Vendor gravity — some features are best on Vercel |
| One codebase, both runtimes | Harder debugging: "is this running on the server or the client?" |

**When you don't need it:** an internal dashboard behind a login (no SEO, no first-paint pressure, no public traffic) is perfectly well served by Vite + React Router. Adding a server there buys you complexity and a hosting bill.

**When you do:** anything public-facing, content-heavy, SEO-sensitive, or where time-to-content matters commercially — e-commerce, marketing sites, blogs, documentation, marketplaces, SaaS with a public surface.

---

## 6. The alternatives, briefly

| | Model | Best at |
| :-- | :-- | :-- |
| **Next.js** | React, server-first, RSC | The default for React apps needing a server |
| **Remix / React Router 7** | React, web-standards, loaders/actions | Progressive enhancement, forms, nested data loading |
| **Astro** | Islands, any framework | Content sites where most of the page is static |
| **Vite + React Router** | Pure SPA | Dashboards, internal tools, anything behind auth |
| **TanStack Start** | React, type-safe full stack | Type-safety maximalists |

They differ mostly in *where* they put the seam between server and client. Next.js's answer — RSC — is the most aggressive, and the most transformative if you use it as intended.

---

## 7. Getting started

```bash
npx create-next-app@latest my-app
# ✔ TypeScript?      Yes
# ✔ ESLint?          Yes
# ✔ Tailwind CSS?    Yes
# ✔ src/ directory?  Yes
# ✔ App Router?      Yes   ← say yes; the Pages Router is maintenance-only
# ✔ Turbopack?       Yes

cd my-app && npm run dev        # http://localhost:3000
```

```
my-app/
├── src/app/
│   ├── layout.tsx        ← the root layout (required; renders <html> and <body>)
│   ├── page.tsx          ← the route "/"
│   └── globals.css
├── public/               ← static files served at /
├── next.config.js
└── package.json
```

Two files and you have a server-rendered, code-split, SEO-ready React application.

---

## 🧠 Rapid-fire recall

1. Trace what the browser does between requesting a React SPA and showing content, and name the five problems it exposes.
2. What does SSR change about that timeline, and what does it require that React alone doesn't provide?
3. Why does automatic code splitting require the framework to own routing?
4. What is the fundamental difference between a Server Component and SSR?
5. What can a Server Component do that a Client Component cannot, and vice versa?
6. Name three costs of adopting Next.js.
7. Give a concrete case where you should *not* use Next.js.

<details>
<summary>Answers</summary>

1. Blank HTML → download bundle → parse and execute → mount → effect fires → fetch → re-render. Problems: blank first paint (bad LCP), no SEO/social previews, a data waterfall that can't start until JS executes, one bundle containing every route, and nowhere to keep secrets or touch a database.
2. The server renders React to an HTML string and sends real markup, so content is visible before any JS runs; JS then hydrates it. That requires a Node server, a renderer that works on both sides, and hydration — none of which React provides on its own.
3. The bundler must know which modules belong to which route to emit separate chunks and to prefetch them. That mapping only exists if routing is a build-time, framework-owned concern.
4. SSR runs your components on the server *and* ships their code to the client for hydration. A Server Component runs only on the server and never ships its code at all — the client receives its rendered output.
5. Server: database and filesystem access, secrets, direct `await` of data, heavy libraries at no client cost. Client: state, effects, event handlers and browser APIs. Neither can do the other's job.
6. A server to run and pay for, two mental models plus a boundary to reason about, a genuinely complex caching model, framework-owned routing, and harder "where is this running?" debugging.
7. An internal dashboard behind a login: no SEO requirement, no public first-paint pressure, and no need for a server beyond the API you already have. Vite plus React Router is simpler and cheaper.

</details>
