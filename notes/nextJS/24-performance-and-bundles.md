---
title: Performance & Bundle Size
author: Tejas Nirala
---

# Performance & Bundle Size

What to measure, how to read the build output, and the optimisations that actually matter in a Next.js app — in rough order of impact.

---

## 1. Measure first

| Metric | Target | What it's about | Typical Next.js cause of failure |
| :-- | :-- | :-- | :-- |
| **LCP** | < 2.5s | when the main content appears | unoptimised hero image, slow server render, blocking JS |
| **INP** | < 200ms | responsiveness to interaction | too much client JS, long hydration, heavy handlers |
| **CLS** | < 0.1 | visual stability | images without dimensions, fonts, injected banners |
| **TTFB** | < 800ms | server response | slow data, no caching, cold starts, slow middleware |

```bash
npx lighthouse https://yoursite.com --view       # lab
```

```jsx
// app/web-vitals.jsx — field data from real users
'use client';
import { useReportWebVitals } from 'next/web-vitals';

export function WebVitals() {
  useReportWebVitals(metric => {
    navigator.sendBeacon('/api/vitals', JSON.stringify(metric));
  });
  return null;
}
```

Lab data on your laptop and field data from real phones diverge dramatically. Optimise against the field data; use the lab to iterate quickly.

---

## 2. Read the build output

```bash
npm run build
```

```
Route (app)                              Size     First Load JS
┌ ○ /                                    1.2 kB          89 kB
├ ○ /blog                                0.8 kB          88 kB
├ ● /blog/[slug]                         2.1 kB          90 kB
└ ƒ /dashboard                          45.3 kB         134 kB    ← both numbers are high
+ First Load JS shared by all                            87 kB
  ├ chunks/framework.js                                  45 kB
  └ chunks/main.js                                       32 kB

○ Static  ● SSG  ƒ Dynamic
```

Three things to check every time:

1. **First Load JS** — what a visitor downloads for that route. Under ~100 KB is healthy; a sudden jump means a client boundary moved or a library entered the client graph.
2. **The symbols** — a route that unexpectedly became `ƒ` has picked up a dynamic dependency (usually `cookies()` in a shared component), silently losing static generation and CDN caching.
3. **The shared chunk** — everything here loads on *every* route, so a library that creeps in costs you on all pages.

---

## 3. The biggest win: fewer Client Components

```jsx
// ❌ 'use client' at the top of a page → everything below is in the bundle
// ✅ 'use client' on the small interactive leaf
```

This dwarfs every other optimisation in an App Router app. A page that ships 5 KB of interactivity instead of 200 KB of application code has nothing to hydrate, and its INP problem disappears rather than being reduced ([Client Components](./12-client-components-and-the-boundary.md)).

```bash
ANALYZE=true npm run build      # with @next/bundle-analyzer, to see what's actually in there
```

```js
// next.config.mjs
import withBundleAnalyzer from '@next/bundle-analyzer';
export default withBundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })(nextConfig);
```

---

## 4. Dynamic imports

```jsx
'use client';
import dynamic from 'next/dynamic';

const Chart = dynamic(() => import('./Chart'), { loading: () => <ChartSkeleton /> });
const Map = dynamic(() => import('./Map'), { ssr: false });     // client components only
```

Good candidates: charts, maps, rich text editors, PDF viewers, video players, modals, anything below the fold, and anything behind a tab or an interaction.

```jsx
// load only when the user actually needs it
const [showEditor, setShowEditor] = useState(false);
{showEditor && <Editor />}          // the chunk is fetched on first render
```

Note `ssr: false` is only allowed inside a Client Component in recent versions — it's a client-side concept.

---

## 5. Import hygiene

```jsx
import _ from 'lodash';                    // ❌ 70 KB
import debounce from 'lodash/debounce';    // ✅ 2 KB

import moment from 'moment';               // ❌ 70 KB + locales
import { format } from 'date-fns';         // ✅ tree-shakeable
new Intl.DateTimeFormat('en-GB').format(d) // ✅ 0 KB, built into the browser

import * as Icons from 'react-icons';      // ❌
import { FiUser } from 'react-icons/fi';   // ✅
```

```js
// next.config.mjs — mitigates barrel-file cost for known packages
experimental: {
  optimizePackageImports: ['lucide-react', '@mui/icons-material', 'date-fns'],
},
```

Barrel files (`export * from …`) make the bundler pull in more than you used, and slow builds noticeably. Import from the specific module path in hot paths.

Also check for duplicates:

```bash
npm ls react       # two copies = double bundle AND "Invalid hook call" errors
```

---

## 6. Server-side performance

### Cache aggressively

```jsx
export const revalidate = 3600;                          // route-level ISR
fetch(url, { next: { revalidate: 60, tags: ['posts'] } });
export const getPosts = unstable_cache(fn, ['posts'], { revalidate: 3600, tags: ['posts'] });
```

A cached static page has a TTFB of ~20ms from a CDN edge. No amount of query optimisation beats not running the query ([Caching](./17-caching.md)).

### Kill waterfalls

```jsx
const [a, b, c] = await Promise.all([getA(), getB(), getC()]);
```

### Stream

```jsx
<Suspense fallback={<Skeleton />}><SlowSection /></Suspense>
```

TTFB becomes the shell's render time rather than the slowest query's ([Streaming](./14-streaming-and-suspense.md)).

### Keep middleware light

It runs before **every** matched request. A database call there adds its latency to every page view ([Middleware](./10-middleware.md)).

### Database basics that outweigh most frontend work

```
□ Indexes on every column you filter, sort or join on
□ SELECT only the fields you need (Prisma: `select`)
□ Connection pooling — serverless opens connections aggressively (PgBouncer, Prisma Accelerate)
□ Watch for N+1 queries (Prisma: `include`; SQL: a join)
□ Co-locate the database with your compute region
```

A missing index costs more than every bundle optimisation on this page combined.

---

## 7. Images and fonts

Usually the largest share of page weight and a common CLS source. Covered fully in [Images, Fonts & Scripts](./21-images-fonts-and-scripts.md) — the summary:

```
□ next/image everywhere, with correct `sizes`
□ `priority` on the LCP image only
□ AVIF/WebP formats enabled
□ next/font (self-hosted, size-adjusted fallback → no font CLS)
□ Third-party scripts on lazyOnload
```

---

## 8. Third-party scripts

```jsx
<Script src="https://widget.chat.com/w.js" strategy="lazyOnload" />
```

A common marketing page ships 600 KB of vendor JavaScript against 180 KB of its own. Audit the list, delete what nobody reads, defer the rest, and load chat widgets on interaction rather than on load.

---

## 9. The rest of the checklist

```
□ Compression on (gzip/brotli — usually default on the platform)
□ Static assets served with long cache headers + content hashes
□ Prefetching left on for likely navigations
□ Long lists virtualised
□ No unnecessary re-renders in interactive client components (React DevTools Profiler)
□ Production build tested, not `next dev` (dev is dramatically slower by design)
```

That last one catches a surprising number of "Next.js is slow" reports — `next dev` compiles on demand and skips most caching.

---

## 10. A worked audit

```
1. Lighthouse → LCP 4.2s, CLS 0.31, First Load JS 480 KB

2. Build output shows /products at 380 KB First Load JS
   → bundle analyzer: a charting library and a date library are in the client bundle
   → the page had 'use client' at the top for one filter dropdown

3. Fix: move 'use client' to the dropdown; the product grid becomes a Server Component
   → First Load JS: 380 KB → 95 KB

4. CLS 0.31 → hero <img> without dimensions
   → next/image with width/height + priority
   → CLS 0.31 → 0.02, LCP 4.2s → 2.1s

5. TTFB 900ms → the page called three sequential fetches
   → Promise.all + `revalidate: 300`
   → TTFB 900ms → 40ms (cached)

Result: LCP 4.2s → 1.1s, CLS 0.31 → 0.02, First Load JS 480 KB → 95 KB
```

Note that none of those fixes were micro-optimisations. The wins came from the boundary placement, the image, and the data layer — in that order, which is also the order to look.

---

## 🧠 Rapid-fire recall

1. Which four metrics matter, and what's the usual Next.js cause of each failing?
2. What three things should you check in the build output?
3. What is the single biggest bundle optimisation in an App Router app?
4. Why is `import _ from 'lodash'` a problem, and what's the general rule?
5. Why can no amount of query optimisation beat caching?
6. What does a route silently flipping from ○ to ƒ mean?
7. Why must performance be measured against a production build?

<details>
<summary>Answers</summary>

1. LCP (unoptimised hero image, slow server render), INP (too much client JS and long hydration), CLS (images without dimensions, font swaps), TTFB (uncached slow data, heavy middleware, cold starts).
2. First Load JS per route (the download budget), the static/dynamic symbol per route, and the shared chunk size (which is paid on every route).
3. Shipping fewer Client Components — keeping `'use client'` on small interactive leaves so most of the tree has no code in the bundle and nothing to hydrate.
4. It pulls the whole library into the bundle rather than the one function you used. Import from the specific module path, prefer tree-shakeable packages, and use built-in browser APIs like `Intl` where possible.
5. A cached static response is served from a CDN edge in ~20ms without running any query at all; optimising a query still leaves the round trip, the render and the origin hop.
6. Something in the route picked up a dynamic dependency — usually `cookies()`, `headers()` or `searchParams` in a shared component — so it lost static generation and CDN caching for the whole page.
7. `next dev` compiles on demand, bypasses much of the caching layer and runs the development React build, so its timings bear no relation to production.

</details>
