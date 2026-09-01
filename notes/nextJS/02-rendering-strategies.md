---
title: Rendering Strategies
author: Tejas Nirala
---

# Rendering Strategies

CSR, SSR, SSG, ISR, streaming, RSC. Six names, and most explanations list them without saying what actually differs. What differs is exactly two things: **when** the HTML is produced, and **where** the component code runs. Everything else follows.

---

## 1. The two axes

```
                    WHEN is the HTML produced?
                    ──────────────────────────────────────────▶
                    build time      request time      in the browser

  WHERE does    ┌──────────────┬──────────────────┬──────────────────┐
  the code      │              │                  │                  │
  run?          │     SSG      │      SSR         │      CSR         │
                │              │                  │                  │
  server only   │  RSC + SSG   │   RSC + SSR      │       —          │
                └──────────────┴──────────────────┴──────────────────┘

  ISR = SSG, but regenerated periodically at request time
  Streaming = SSR, but the HTML is sent in pieces as it becomes ready
```

---

## 2. CSR — Client-Side Rendering

```
Server sends:  <div id="root"></div> + bundle.js
Browser:       download → parse → execute → render → fetch → render again
```

```jsx
'use client';
export default function Page() {
  const { data, isPending } = useQuery({ queryKey: ['products'], queryFn: fetchProducts });
  if (isPending) return <Skeleton />;
  return <ProductList products={data} />;
}
```

| ✅ | ❌ |
| :-- | :-- |
| Rich interactivity after load | Blank first paint |
| Cheap hosting (static files) | No SEO without a crawler that executes JS |
| No server needed | Large initial bundle |
| Navigation is instant after load | The data fetch can't start until JS runs |

**Right for:** dashboards, editors, anything behind a login where SEO and first-paint don't matter.

---

## 3. SSR — Server-Side Rendering

The server runs your components on **every request**, produces HTML, and sends it. The browser paints it immediately, then hydrates.

```jsx
// App Router: dynamic rendering — opting out of caching makes it per-request
export const dynamic = 'force-dynamic';

export default async function Page() {
  const data = await fetch('https://api.example.com/live', { cache: 'no-store' });
  return <Dashboard data={await data.json()} />;
}
```

```
t=0     request
t=250ms server fetches + renders → full HTML sent
t=300ms 🖼 CONTENT VISIBLE (not interactive)
t=800ms JS loaded → hydration → interactive
```

| ✅ | ❌ |
| :-- | :-- |
| Content visible fast | Slower TTFB (the server does work per request) |
| Full SEO | Server cost scales with traffic |
| Always fresh data | The hydration gap: visible but not clickable |
| Secrets stay server-side | Needs a running server |

**Right for:** personalised pages, dashboards with SEO needs, anything where the data must be current per request.

---

## 4. SSG — Static Site Generation

Render once at build time. Serve the resulting HTML from a CDN.

```jsx
// This is the App Router DEFAULT when nothing forces dynamic rendering
export default async function Page() {
  const posts = await fetch('https://api.example.com/posts').then(r => r.json());
  return <PostList posts={posts} />;
}

// Pre-render a known set of dynamic routes
export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map(p => ({ slug: p.slug }));      // → /blog/a, /blog/b, …
}
```

```
BUILD TIME:  fetch → render → write out /blog/a.html, /blog/b.html, …
REQUEST:     CDN serves the file. TTFB ~20ms. Zero computation.
```

| ✅ | ❌ |
| :-- | :-- |
| Fastest possible TTFB | Data is frozen at build time |
| Cheapest hosting | Long builds for large sites |
| Perfect SEO | Content changes require a rebuild |
| Can't fail at request time | No personalisation |

**Right for:** blogs, docs, marketing pages, product catalogues that change rarely.

---

## 5. ISR — Incremental Static Regeneration

SSG plus a shelf life. Serve the static page; regenerate it in the background after N seconds.

```jsx
export const revalidate = 60;      // seconds

export default async function Page() {
  const products = await fetch('https://api.example.com/products', {
    next: { revalidate: 60 },
  }).then(r => r.json());
  return <ProductGrid products={products} />;
}
```

**Trace the stale-while-revalidate behaviour:**

```
t=0s     build → page.html cached, marked fresh for 60s

t=10s    user A requests → cached HTML served instantly (fresh)     ✅ 20ms
t=70s    user B requests → cache is STALE
                          → the STALE page is served to B immediately  ✅ 20ms
                          → regeneration starts IN THE BACKGROUND
t=71s    regeneration finishes → the cache now holds fresh HTML
t=75s    user C requests → the NEW page, instantly                   ✅ 20ms
```

Nobody ever waits for the regeneration. User B saw content up to 60 seconds old — usually an entirely acceptable trade for a 20ms response.

### On-demand revalidation

Better than a timer when you control the CMS:

```jsx
// in a webhook route handler
import { revalidatePath, revalidateTag } from 'next/cache';

export async function POST(request) {
  const { slug } = await request.json();
  revalidatePath(`/blog/${slug}`);      // invalidate exactly this page
  revalidateTag('posts');                // or everything tagged 'posts'
  return Response.json({ revalidated: true });
}
```

Now the page is static and fast *and* updates within seconds of an edit — the best of both.

---

## 6. Streaming SSR

Instead of waiting for the whole page before sending anything, send the shell immediately and stream each section as it becomes ready.

```jsx
export default function Page() {
  return (
    <>
      <Header />                                  {/* instant */}
      <Suspense fallback={<FeedSkeleton />}>
        <Feed />                                  {/* slow — streams in later */}
      </Suspense>
      <Suspense fallback={<SideSkeleton />}>
        <Sidebar />                               {/* streams in independently */}
      </Suspense>
    </>
  );
}
```

```
Without streaming (one slow query gates everything):
  |──────────── 900ms of nothing ────────────| full page

With streaming:
  |─50ms─| shell + header + skeletons          🖼 user sees layout
          |─200ms─| sidebar HTML streams in    🖼 sidebar appears
                   |─900ms─| feed streams in   🖼 feed appears
```

TTFB drops to the time it takes to render the shell. The mechanism: the server sends HTML in chunks over one connection, and each late chunk carries a small inline script that swaps it into the placeholder. See [Streaming & Suspense](./14-streaming-and-suspense.md).

---

## 7. RSC — React Server Components

An orthogonal axis. SSR is about *when the HTML is produced*; RSC is about *whether the component's code ever reaches the browser*.

```
Traditional SSR:
   server renders <ProductPage/> → HTML
   client ALSO downloads ProductPage's code → hydrates it
   → the code exists in both places

RSC:
   server renders <ProductPage/> → a serialised description of its output
   client downloads NOTHING for it
   → only 'use client' components ship JavaScript
```

```jsx
// Server Component — its code, its imports, and its data never reach the browser
import { marked } from 'marked';       // a 40 KB markdown parser — 0 KB to the client
import { db } from '@/lib/db';

export default async function Article({ params }) {
  const post = await db.post.findUnique({ where: { slug: params.slug } });
  return <div dangerouslySetInnerHTML={{ __html: marked(post.body) }} />;
}
```

Covered in depth in [Server Components](./11-server-components.md).

---

## 8. The comparison table

| | TTFB | First paint | Interactive | Data freshness | Server cost | SEO |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| **CSR** | ⚡ fast (static) | 🐌 slow | 🐌 slow | live | none | ❌ |
| **SSG** | ⚡⚡ fastest | ⚡ fast | medium | build time | none | ✅ |
| **ISR** | ⚡⚡ fastest | ⚡ fast | medium | ≤ N seconds | low | ✅ |
| **SSR** | 🐌 slower | ⚡ fast | medium | live | high | ✅ |
| **Streaming** | ⚡ fast | ⚡⚡ fastest | progressive | live | high | ✅ |
| **RSC** | varies | ⚡ fast | ⚡ fast (less JS) | varies | varies | ✅ |

---

## 9. Choosing — the decision tree

```
Does the page need to be indexed or shared (SEO / social previews)?
 ├─ no  → is it behind a login with no first-paint pressure?
 │         └─ yes → CSR is fine
 └─ yes ↓

Is the content the same for every user?
 ├─ yes → Does it change?
 │         ├─ rarely (a few times a year)  → SSG
 │         ├─ periodically                 → ISR with `revalidate`
 │         └─ on editor action             → SSG + on-demand revalidation
 └─ no (personalised / per-request) ↓

Is some of the page fast and some slow?
 ├─ yes → Streaming SSR: shell + Suspense boundaries around the slow parts
 └─ no  → SSR
```

### And crucially: it's per-route, and per-component

```
app/
├── page.tsx              → SSG      (marketing home)
├── blog/[slug]/page.tsx  → ISR      (revalidate: 3600)
├── dashboard/page.tsx    → SSR      (personalised, cache: 'no-store')
└── editor/page.tsx       → CSR      ('use client', behind auth)
```

You don't pick one strategy for an application. You pick one per route — and within a route, one per Suspense boundary. That granularity is the actual reason the App Router exists.

---

## 10. How Next.js decides (App Router)

Next.js infers static vs dynamic from what your code uses:

```jsx
// STATIC by default
export default async function Page() {
  const data = await fetch(url);                 // cached by default in Next 14
  return <div>{data}</div>;
}

// DYNAMIC — any of these force per-request rendering:
import { cookies, headers } from 'next/headers';
cookies(); headers();                            // request-specific APIs
searchParams;                                    // the page prop
fetch(url, { cache: 'no-store' });
export const dynamic = 'force-dynamic';
```

> **Version note:** Next 15 changed the default for `fetch` from cached to uncached, and made `cookies()`/`headers()`/`params`/`searchParams` asynchronous (`await cookies()`). Always check which major version you're on — this is the single most confusing difference between tutorials written a year apart. Full detail in [Caching](./17-caching.md).

Check what you actually got:

```bash
npm run build
#  ○  (Static)   prerendered as static content
#  ●  (SSG)      prerendered as static HTML with generateStaticParams
#  ƒ  (Dynamic)  server-rendered on demand
```

That output is the ground truth. If a page you expected to be static shows `ƒ`, something in it opted into dynamic rendering — usually a `cookies()` call buried in a shared component.

---

## 🧠 Rapid-fire recall

1. What are the two axes that actually distinguish the rendering strategies?
2. Trace an ISR request that arrives after the revalidation window and explain who waits.
3. What does streaming change about TTFB, and what's the mechanism?
4. How does RSC differ from SSR — what exactly does the client not receive?
5. Which strategy fits a blog, a personalised dashboard, and an internal admin tool?
6. Name four things that force a Next.js route to render dynamically.
7. How do you find out which strategy each of your routes actually got?

<details>
<summary>Answers</summary>

1. When the HTML is produced (build time, request time, or in the browser) and where the component code runs (server only, or server plus client).
2. The stale cached page is served immediately, so that user waits ~20ms; regeneration happens in the background and the *next* request gets the fresh page. Nobody blocks on the regeneration.
3. TTFB drops to the time to render the shell rather than the whole page. The server sends HTML in chunks over one connection, and each late chunk carries an inline script that swaps its content into the corresponding placeholder.
4. SSR runs components on the server *and* ships their code to the client for hydration. RSC sends only the serialised output — the component's code, its imports and its data never reach the browser.
5. Blog → SSG or ISR with on-demand revalidation; personalised dashboard → SSR (streaming if parts are slow); internal admin tool → CSR is fine.
6. Calling `cookies()` or `headers()`, using `searchParams`, `fetch` with `cache: 'no-store'`, and `export const dynamic = 'force-dynamic'`.
7. `npm run build` prints a per-route legend: ○ static, ● SSG with `generateStaticParams`, ƒ dynamic.

</details>
