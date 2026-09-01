---
title: Caching
author: Tejas Nirala
---

# Caching

The most confusing part of Next.js, and the part most worth understanding. There are **four separate caches**, they have different lifetimes and different invalidation mechanisms, and the defaults changed between major versions. This page maps all of it.

---

## 1. The four caches

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │ BROWSER                                                              │
   │   ┌───────────────────────────────────────────────────────────┐      │
   │   │ 1. Router Cache — RSC payloads for visited routes         │      │
   │   │    Where: client memory   Lifetime: the session           │      │
   │   └───────────────────────────────────────────────────────────┘      │
   └──────────────────────────────────┬───────────────────────────────────┘
                                      │
   ┌──────────────────────────────────▼───────────────────────────────────┐
   │ SERVER                                                               │
   │   ┌───────────────────────────────────────────────────────────┐      │
   │   │ 2. Full Route Cache — rendered HTML + RSC payload         │      │
   │   │    Where: server/CDN      Lifetime: until revalidated     │      │
   │   ├───────────────────────────────────────────────────────────┤      │
   │   │ 3. Data Cache — fetch() results                            │      │
   │   │    Where: server disk     Lifetime: until revalidated     │      │
   │   │    Survives deployments and is shared across users         │      │
   │   ├───────────────────────────────────────────────────────────┤      │
   │   │ 4. Request Memoization — dedup within ONE render pass      │      │
   │   │    Where: memory          Lifetime: one request           │      │
   │   └───────────────────────────────────────────────────────────┘      │
   └──────────────────────────────────────────────────────────────────────┘
```

Read the flow top to bottom: a request checks the Router Cache, then the Full Route Cache, then renders — during which `fetch` calls hit the Data Cache, deduplicated by Request Memoization.

---

## 2. Request Memoization

**Scope:** one render pass. **Purpose:** so colocated data fetching doesn't multiply queries.

```jsx
// three components, one request
async function Layout() { const u = await fetch('/api/user'); }
async function Page()   { const u = await fetch('/api/user'); }   // memoised
async function Nav()    { const u = await fetch('/api/user'); }   // memoised
```

Automatic for `fetch` (GET only, matching URL and options), opt-in for anything else via React's `cache()`. Discarded when the request finishes, so there's no cross-user leakage.

---

## 3. The Data Cache

**Scope:** across requests, across users, **across deployments**. **Purpose:** avoid re-fetching data that hasn't changed.

```jsx
// Next.js 14 and earlier: cached by DEFAULT
fetch(url);                                  // cached forever until revalidated
fetch(url, { cache: 'no-store' });           // never cached
fetch(url, { next: { revalidate: 60 } });    // ISR: cached for 60s

// Next.js 15+: UNCACHED by default
fetch(url);                                  // ← now equivalent to no-store
fetch(url, { cache: 'force-cache' });        // explicitly cached
fetch(url, { next: { revalidate: 60 } });    // cached for 60s
```

> **This default flip is the single biggest source of confusion between tutorials.** Check your `package.json` before trusting any example, including this one.

### Tags

```jsx
await fetch('https://api.x.com/posts', { next: { tags: ['posts'] } });
await fetch(`https://api.x.com/posts/${id}`, { next: { tags: ['posts', `post-${id}`] } });
```

```jsx
import { revalidateTag } from 'next/cache';

revalidateTag('posts');          // invalidate everything tagged 'posts'
revalidateTag(`post-${id}`);     // invalidate just this one
```

Tags let one mutation invalidate exactly the right cached fetches, wherever they are in the app — the same idea as RTK Query's tags ([React: Redux Toolkit](/reactJS/redux-toolkit)).

### Caching non-`fetch` data

`db.query()` isn't `fetch`, so it isn't in the Data Cache. Wrap it:

```jsx
import { unstable_cache } from 'next/cache';

export const getPosts = unstable_cache(
  async () => db.post.findMany(),
  ['posts-list'],                                  // the cache key parts
  { revalidate: 3600, tags: ['posts'] }
);
```

> Newer Next.js versions introduce a `'use cache'` directive as the successor to this API. Check what your version supports; the concept — caching arbitrary async work with tags and a revalidation window — is the same.

---

## 4. The Full Route Cache

**Scope:** the rendered output of a route. **Purpose:** serve a page without rendering it again.

A route is cached if it renders **statically**, which Next.js determines automatically:

```jsx
// STATIC → cached
export default async function Page() {
  const posts = await fetch(url, { next: { revalidate: 3600 } }).then(r => r.json());
  return <List posts={posts} />;
}

// DYNAMIC → not cached; rendered per request
import { cookies } from 'next/headers';
export default async function Page({ searchParams }) {
  const session = (await cookies()).get('session');   // ← request-specific
  …
}
```

Anything that forces dynamic rendering:

```
cookies()  •  headers()  •  draftMode()
searchParams (as a page prop)
fetch(..., { cache: 'no-store' })
export const dynamic = 'force-dynamic'
export const revalidate = 0
connection() / unstable_noStore()
```

```bash
npm run build
#  ○  Static     — prerendered, in the Full Route Cache
#  ●  SSG        — prerendered via generateStaticParams
#  ƒ  Dynamic    — rendered per request, not cached
```

**The most common surprise:** one `cookies()` call in a shared component makes every route that renders it dynamic. If a page unexpectedly shows `ƒ`, that's usually why — an analytics wrapper or a theme reader deep in a layout.

---

## 5. The Router Cache (client-side)

**Scope:** the browser tab. **Purpose:** instant back/forward and re-navigation.

```
Navigate /a → /b → back to /a
   /a's RSC payload comes from client memory → no server request at all
```

It's cleared by a full page reload, by `router.refresh()`, and by a Server Action that calls `revalidatePath`/`revalidateTag`. Its staleness defaults changed in Next 15 (dynamic pages are no longer reused by default) — so if you see stale data after a mutation, the fix is to revalidate, not to fight the cache.

```jsx
router.refresh();                    // re-fetch the current route's server data
```

---

## 6. Invalidation — the practical part

```jsx
import { revalidatePath, revalidateTag } from 'next/cache';

// after a mutation in a Server Action or Route Handler
revalidatePath('/posts');            // this exact path
revalidatePath('/posts/[slug]', 'page');   // every page matching this dynamic route
revalidatePath('/', 'layout');       // this layout and everything below it
revalidateTag('posts');              // every fetch tagged 'posts'
```

```jsx
// a complete mutation
'use server';
export async function createPost(formData) {
  const post = await db.post.create({ data: { title: formData.get('title') } });

  revalidateTag('posts');            // the lists refresh
  revalidatePath('/dashboard');      // the dashboard count refreshes

  redirect(`/posts/${post.id}`);
}
```

**The rule: every mutation must invalidate something.** "I saved it but the list still shows the old data" is always a missing revalidation.

### Time-based vs on-demand

```jsx
// time-based — simple, but always up to N seconds stale
export const revalidate = 3600;

// on-demand — fresh within seconds of an edit, via a CMS webhook
export async function POST(request) {
  const { secret, slug } = await request.json();
  if (secret !== process.env.REVALIDATE_SECRET) {
    return Response.json({ error: 'Invalid' }, { status: 401 });
  }
  revalidatePath(`/blog/${slug}`);
  return Response.json({ revalidated: true });
}
```

On-demand is strictly better where you control the source of change. Use a long `revalidate` as a safety net underneath it.

---

## 7. Segment configuration

```jsx
// app/blog/[slug]/page.jsx
export const revalidate = 3600;              // ISR window, in seconds
export const dynamic = 'auto';               // 'auto'|'force-dynamic'|'error'|'force-static'
export const dynamicParams = true;           // render unlisted params on demand
export const fetchCache = 'auto';            // override fetch caching for the segment
export const runtime = 'nodejs';             // 'nodejs' | 'edge'
export const preferredRegion = 'auto';
```

`dynamic = 'error'` is a useful guard: it makes the **build fail** if anything in the route forces dynamic rendering. Put it on pages that must stay static, and you'll catch the accidental `cookies()` at build time instead of in your hosting bill.

---

## 8. Debugging

```bash
next dev
# In dev, the Data Cache is mostly bypassed so you see fresh data.
# ALWAYS verify caching behaviour with a production build.
npm run build && npm start
```

```jsx
// next.config.js — log every cache hit/miss
module.exports = { logging: { fetches: { fullUrl: true } } };
```

```
GET /blog/hello 200 in 15ms
  │ fetch https://api.x.com/posts/hello  (cache: HIT)
  │ fetch https://api.x.com/related      (cache: SKIP, reason: no-store)
```

That output is the fastest way to answer "why is this page dynamic?" or "why isn't my data updating?".

---

## 9. Recipes

```jsx
// A marketing page: rebuild on deploy only
export default async function Page() { const c = await getCMS(); }   // static by default

// A blog: static with a CMS webhook
export const revalidate = 3600;                                      // safety net
// + revalidatePath in the webhook handler

// A product listing: fresh every minute
const products = await fetch(url, { next: { revalidate: 60, tags: ['products'] } });

// A user dashboard: always fresh, never cached
const data = await fetch(url, { cache: 'no-store' });
// (cookies() would force this anyway)

// A mixed page: static shell + a dynamic personalised widget
export default function Page() {
  return <><StaticContent />
    <Suspense fallback={<CartSkeleton />}><Cart /></Suspense>       {/* reads cookies */}
  </>;
}
// with PPR, the shell is served from the edge and the widget streams in
```

---

## 10. Mistakes

```jsx
// 1. Assuming the wrong default for your version
// 2. Forgetting to revalidate after a mutation
// 3. cookies() in a shared component → every route becomes dynamic
// 4. Testing caching in `next dev` — dev bypasses much of it
// 5. Caching user-specific data with a shared key → one user sees another's data 💀
const data = await unstable_cache(fn, ['user-data'])();    // ❌ no user id in the key
const data = await unstable_cache(fn, ['user-data', userId])();   // ✅
// 6. revalidate: 0 when you meant no-store (they differ subtly; prefer no-store)
// 7. Expecting revalidatePath to update the CURRENT response — it affects the NEXT one
```

Number 5 is the dangerous one. Any cache key for per-user data must include the user identifier, or you will serve one customer's data to another.

---

## 🧠 Rapid-fire recall

1. Name the four caches, where each lives, and each one's lifetime.
2. What changed about the `fetch` default between Next 14 and 15?
3. What makes a route land in the Full Route Cache, and name four things that prevent it?
4. What's the difference between `revalidatePath` and `revalidateTag`?
5. How do you cache a database query, and what must the key include for per-user data?
6. Why must you test caching with a production build?
7. Why does one `cookies()` call in a shared component matter so much?

<details>
<summary>Answers</summary>

1. Request Memoization (server memory, one render pass); the Data Cache (server storage, persists across requests, users and deployments until revalidated); the Full Route Cache (server/CDN, holds rendered output until revalidated); the Router Cache (client memory, the browser session).
2. In 14 and earlier `fetch` was cached by default; in 15 it is uncached by default, so you must opt in with `cache: 'force-cache'` or a `revalidate` value.
3. Static rendering — nothing request-specific in the route. Prevented by `cookies()`, `headers()`, `searchParams`, `cache: 'no-store'`, `dynamic = 'force-dynamic'`, `revalidate = 0`, and `draftMode()`.
4. `revalidatePath` invalidates a route's rendered output by path (optionally a whole dynamic route or layout subtree); `revalidateTag` invalidates every cached fetch carrying that tag, wherever it lives.
5. Wrap it in `unstable_cache` (or the newer `'use cache'` equivalent) with key parts, a revalidate window and tags. For per-user data the key **must** include the user id, or you'll serve one user's data to another.
6. `next dev` largely bypasses the Data Cache and revalidation so you see fresh data while developing. Caching behaviour only reflects reality in `next build && next start`.
7. Any route that renders that component becomes dynamic, silently losing static generation and CDN caching for the whole page — usually visible only as a `ƒ` in the build output.

</details>
