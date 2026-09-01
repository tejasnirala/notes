---
title: Interview Questions & Answers
author: Tejas Nirala
---

# Interview Questions & Answers

Organised by theme, answered the way you'd actually say them out loud: the direct answer first, then the detail that shows you understand the mechanism.

---

## Fundamentals

<details>
<summary><b>What does Next.js give you that React doesn't?</b></summary>

React renders UI and nothing else. Next.js adds a server, file-system routing, the rendering strategies (SSG/SSR/ISR/streaming), Server Components, data caching, bundling with automatic code splitting, image and font optimisation, API endpoints and middleware. Every one of those is a response to a limitation you hit building a React SPA: blank first paint, no SEO, a data waterfall that can't start until JS executes, one bundle for every route, and nowhere to keep secrets.
</details>

<details>
<summary><b>Explain CSR, SSR, SSG and ISR.</b></summary>

They differ on two axes: when the HTML is produced, and where the code runs. CSR produces it in the browser — fast navigation, blank first paint, no SEO. SSR produces it per request on the server — fresh and indexable, but TTFB scales with your data. SSG produces it at build time — fastest possible TTFB from a CDN, but frozen data. ISR is SSG with a shelf life: the stale page is served instantly while it regenerates in the background, so nobody ever waits for the rebuild.
</details>

<details>
<summary><b>Trace an ISR request that arrives after the revalidation window.</b></summary>

The cached page is stale, so Next.js serves that stale HTML immediately — that user still gets a ~20ms response — and starts regeneration in the background. When it finishes, the cache holds the fresh page and the *next* request gets it. Nobody blocks on the regeneration. That's stale-while-revalidate.
</details>

<details>
<summary><b>How do you choose a rendering strategy?</b></summary>

Per route, not per app. No SEO need and it's behind a login → CSR is fine. Same content for everyone and rarely changing → SSG. Changing periodically → ISR with a `revalidate` window, ideally plus on-demand revalidation from a CMS webhook. Personalised per request → SSR. Some parts fast and some slow → streaming with Suspense boundaries around the slow parts. And `next build` tells you which you actually got.
</details>

---

## App Router & Server Components

<details>
<summary><b>What's the difference between SSR and React Server Components?</b></summary>

SSR is about *when* the HTML is produced; RSC is about *where the component code lives*. With SSR the component runs on the server to produce HTML **and** ships to the client for hydration — its code exists in both places. A Server Component runs only on the server; the client receives its rendered output, never its code. So a page can use both: Server Components produce most of the tree, and the client islands inside it are server-rendered *and* hydrated.
</details>

<details>
<summary><b>What can't a Server Component do?</b></summary>

State, effects, context, refs, event handlers, and browser APIs — anything needing the client runtime. In exchange it can `await` data directly, read secrets, touch the database and filesystem, and use heavy libraries at zero client cost.
</details>

<details>
<summary><b>What does `'use client'` actually do?</b></summary>

It marks the entry point into the client bundle for a module graph. Everything that module imports — transitively — becomes client code with no directive of its own. That's why putting it on a root layout is a serious mistake: your whole application enters the client bundle and you gain nothing from RSC. It belongs on small interactive leaves.
</details>

<details>
<summary><b>Do Client Components run on the server?</b></summary>

Yes, once, during SSR to produce the initial HTML. That's why `window.innerWidth` in a render body crashes the server render, and why browser-only code has to live in an effect or an event handler.
</details>

<details>
<summary><b>Why can't a Client Component import a Server Component, and what's the workaround?</b></summary>

Imports are resolved at build time, so importing it would require bundling it for the browser — where it has no database access and no secrets. The workaround is `children` or an element prop: the server renders it and passes the *output* into a hole in the client component's tree, so its code is never bundled.
</details>

<details>
<summary><b>What can be passed as props across the boundary?</b></summary>

Anything serialisable: primitives, arrays, plain objects, Dates, Maps, Sets, JSX elements and promises. Not functions — except a `'use server'` action — and not class instances, which is why passing a raw ORM document often fails with "Only plain objects can be passed to Client Components".
</details>

<details>
<summary><b>What is the RSC payload?</b></summary>

A streaming, line-based serialisation of the rendered tree with references to client modules where the interactive holes are. Two things matter about the format: it streams, so slow subtrees don't block fast ones; and it preserves React's tree structure, so on navigation the client merges new server output into the existing tree without remounting layouts or losing client state.
</details>

---

## Routing

<details>
<summary><b>How does file-system routing work in the App Router?</b></summary>

Folders are URL segments; a `page.tsx` makes a segment publicly routable. `[slug]` is a dynamic segment, `[...slug]` a catch-all, `[[...slug]]` an optional catch-all. A folder in parentheses is a route group — organisational only, not in the URL. Anything else in the folder is inert, so you can colocate components and tests beside the route that uses them.
</details>

<details>
<summary><b>Layout vs template?</b></summary>

A layout persists across navigations within its segment, so state, scroll position and DOM survive — only the changed segment re-renders. A template creates a fresh instance each time, resetting state and re-running effects. Default to layout; use a template for per-navigation animations or deliberate resets.
</details>

<details>
<summary><b>What's `loading.tsx` equivalent to?</b></summary>

`<Suspense fallback={<Loading/>}>` around the segment. It lets the server send the shell and skeleton immediately and stream the content when its data resolves, so TTFB is the shell's render time rather than the slowest query's.
</details>

<details>
<summary><b>Why must `error.tsx` be a Client Component?</b></summary>

Error boundaries need `getDerivedStateFromError`/`componentDidCatch`, which only exist on class components and require the client runtime. There's still no hook equivalent in React.
</details>

<details>
<summary><b>What problem do intercepting routes solve?</b></summary>

Showing a route as a modal over the page you came from, while keeping it a real shareable URL. Clicking a photo in a feed gives you `/photo/123` as a modal with the feed still mounted behind it; pasting that URL fresh gives the full page. And back closes the modal without remounting the feed, so scroll position is preserved.
</details>

<details>
<summary><b>Why does a parallel route need `default.tsx`?</b></summary>

On a hard navigation to a URL that a slot doesn't match, Next.js needs something to render there. On soft navigation the slot keeps its previous state, so it works while you click around in development and then 404s when someone reloads. Always add one, even returning null.
</details>

---

## Data & caching

<details>
<summary><b>Name the four caches in Next.js.</b></summary>

Request Memoization — deduping identical calls within one render pass, server memory, discarded after the request. The Data Cache — `fetch` results on the server, persisting across requests, users and deployments until revalidated. The Full Route Cache — the rendered output of statically-rendered routes. And the client Router Cache — RSC payloads for visited routes, in browser memory for the session.
</details>

<details>
<summary><b>What makes a route dynamic?</b></summary>

Anything request-specific: `cookies()`, `headers()`, `draftMode()`, using `searchParams`, `fetch` with `cache: 'no-store'`, or `export const dynamic = 'force-dynamic'`. The trap is that one `cookies()` call in a shared component makes every route rendering it dynamic — which shows up only as a `ƒ` in the build output.
</details>

<details>
<summary><b>`revalidatePath` vs `revalidateTag`?</b></summary>

`revalidatePath` invalidates a route's rendered output by path — optionally a whole dynamic route or a layout subtree. `revalidateTag` invalidates every cached fetch carrying that tag, wherever it lives in the app. Tags are better when one mutation affects data fetched in several places.
</details>

<details>
<summary><b>Why does my UI show stale data after a mutation?</b></summary>

Almost always a missing revalidation. Every mutation must call `revalidatePath` or `revalidateTag`, or the cached render keeps being served. If it's a mutation through a route handler rather than an action, `router.refresh()` re-runs the current route's server components while preserving client state.
</details>

<details>
<summary><b>How do you avoid data waterfalls?</b></summary>

Start requests before awaiting them. `Promise.all` for independent calls; hoist a promise and pass it down for render-as-you-fetch; put independent slow sections in sibling Suspense boundaries so they fetch in parallel. When a call genuinely depends on another's result and it's hot, fix it at the data layer with a single query instead.
</details>

<details>
<summary><b>Why is `cache()` important?</b></summary>

It makes "every component fetches its own data" viable. Without deduplication, a user object needed in a layout, a page and a nav bar would be three queries per request. With it, one — and that's what lets you colocate data fetching instead of threading props from the top.
</details>

---

## Server Actions

<details>
<summary><b>What is a Server Action, and what's the security implication?</b></summary>

A function that runs on the server but is callable from client code — Next.js turns the call into a POST to a generated endpoint. The implication is that **it is a public HTTP endpoint**: anyone can POST arbitrary arguments to it. Every action must authenticate the caller, validate its arguments with a schema, and authorise this specific user for this specific resource. And every export in a `'use server'` file is live, including ones no UI calls any more.
</details>

<details>
<summary><b>Why does `<form action={serverAction}>` work without JavaScript?</b></summary>

Next.js renders a genuine `<form method="POST">` targeting a generated endpoint. JavaScript only upgrades it to a fetch-based submission that avoids a full page reload — so the form is progressively enhanced by default.
</details>

<details>
<summary><b>What comes back in an action's response besides the return value?</b></summary>

The updated RSC payload for any route the action revalidated. So one round trip performs the mutation and refreshes the affected server-rendered UI, with client state preserved — no separate refetch.
</details>

<details>
<summary><b>Server Action or Route Handler?</b></summary>

Actions for your own app's mutations — you get progressive enhancement and automatic revalidation. Route handlers for anything external: webhooks, public APIs for mobile clients, file downloads, streaming, and anything needing custom status codes.
</details>

---

## Performance

<details>
<summary><b>What's the single biggest bundle optimisation in an App Router app?</b></summary>

Shipping fewer Client Components — pushing `'use client'` down to small interactive leaves. A page that ships 5 KB of interactivity instead of 200 KB of app code has nothing to hydrate, so the INP problem disappears rather than being reduced. It dwarfs every other optimisation.
</details>

<details>
<summary><b>How does streaming change TTFB, and how does it work?</b></summary>

TTFB becomes the time to render the shell rather than the slowest query. The server sends HTML in chunks over one connection: first the shell with placeholder divs, then later chunks containing the real content plus a tiny inline script that swaps it into place. It works before hydration because the swap is plain DOM manipulation.
</details>

<details>
<summary><b>What do you check in `next build` output?</b></summary>

First Load JS per route (the download budget — a jump means a client boundary moved), the static/dynamic symbol per route (a route flipping to `ƒ` has picked up a dynamic dependency and lost CDN caching), and the shared chunk size, which is paid on every route.
</details>

<details>
<summary><b>Why does `next/image` need `sizes`?</b></summary>

Without it the browser assumes the image is full viewport width and picks the largest `srcSet` candidate — potentially a 2000px file for a 200px thumbnail. `sizes` tells it the rendered width at each breakpoint so it can choose the smallest adequate variant.
</details>

<details>
<summary><b>What does `next/font` do that a Google Fonts link doesn't?</b></summary>

It downloads and self-hosts the files at build time — removing a third-party DNS lookup, connection and privacy exposure — and generates a metrically matched fallback so swapping to the webfont causes no layout shift. That second part is a direct CLS win.
</details>

---

## Debugging & production

<details>
<summary><b>"Hydration failed" — how do you debug it?</b></summary>

React found a difference between the server HTML and the client's first render, so it discards the server markup for that subtree. Check, in order: non-deterministic values during render (`Date`, `Math.random`), browser APIs read during render (`window`, `localStorage`), `toLocaleString` without an explicit locale and timezone, and invalid HTML nesting like a `<div>` inside a `<p>`. Then test in incognito with extensions disabled.
</details>

<details>
<summary><b>Why is middleware not a security boundary?</b></summary>

It may be skipped by some deployment configurations, a matcher mistake silently leaves routes open, and it runs on the critical path so it can only afford a cheap presence check. Real verification belongs in the data access layer, where every page, action and route handler passes through it and can't be routed around.
</details>

<details>
<summary><b>Edge or Node runtime?</b></summary>

Node by default. Edge has ~5ms cold starts and runs near the user, but only Web APIs — no Node standard library, no TCP database drivers, most ORMs won't run. Choose Edge deliberately for middleware, geo redirects, A/B tests and streaming with no database. An Edge function making a cross-region database call is slower than a Node function sitting next to the database.
</details>

<details>
<summary><b>What breaks when self-hosting that a platform handles for you?</b></summary>

ISR across multiple instances — each container keeps its own filesystem cache, so revalidating on one leaves the others stale; you need a shared cache handler backed by Redis. Also image optimisation (install `sharp` or use an image CDN), and the fact that `NEXT_PUBLIC_` variables are baked in at build time, so one image can't serve staging and production with different values.
</details>

---

## Practical / take-home

<details>
<summary><b>Design a blog with a CMS.</b></summary>

Post pages are SSG via `generateStaticParams`, with `export const revalidate` as a safety net and a CMS webhook calling `revalidatePath`/`revalidateTag` for near-instant updates. `generateMetadata` shares the post query via `cache()`. An `opengraph-image.tsx` generates social previews per post. Comments are a separate Suspense boundary so they don't gate the article. The markdown renderer stays in the Server Component, so it ships zero bytes.
</details>

<details>
<summary><b>Design an e-commerce product page.</b></summary>

The product page is ISR — content is the same for everyone and changes occasionally. Reviews and recommendations are separate Suspense boundaries that stream in. The image gallery and add-to-cart are small client islands; the description, specs and reviews stay on the server. Cart mutations are Server Actions with `useOptimistic` for instant feedback and automatic rollback. The cart badge reads cookies, so it lives behind its own Suspense boundary — with PPR that keeps the rest of the page statically served.
</details>

<details>
<summary><b>How do you handle auth end to end?</b></summary>

Four layers. Middleware does a cheap cookie-presence check for fast redirects — an optimisation, not security. Layouts verify the session for correct UI. The data access layer is the real boundary: every query and mutation authenticates and authorises, so no page, action or handler can bypass it. And each Server Action and Route Handler repeats authenticate → validate → authorise, because each is a public endpoint. Sessions in `httpOnly`, `secure`, `sameSite` cookies — never `localStorage`.
</details>

<details>
<summary><b>A page has a 4-second LCP. Walk me through fixing it.</b></summary>

Measure first — Lighthouse plus field data, and read `next build`. Then in order of usual impact: check whether the hero image is optimised and marked `priority` with correct `sizes`; check First Load JS and whether a `'use client'` sits too high in the tree; check whether the data is cached or whether sequential awaits are serialising; add Suspense boundaries so the shell isn't gated by the slowest query. Micro-optimisations come last — the wins are almost always boundary placement, images and the data layer.
</details>

---

## Questions worth asking back

- Are you on the App Router, and how has the migration gone?
- How do you handle caching and invalidation — tags, paths, or time-based?
- Where does your auth check actually live?
- Are you on Vercel or self-hosting, and what did that cost you either way?
- How much of your tree is Client Components, and do you track First Load JS in CI?

These signal that you've operated a Next.js app, not just built one.
