---
title: Routing Fundamentals
author: Tejas Nirala
---

# Routing Fundamentals

The App Router maps folders to URL segments. The rules are few, but the interactions between dynamic segments, route groups and catch-alls are where people get stuck.

---

## 1. Folders are segments; `page.tsx` makes them public

```
app/
├── page.tsx                    → /
├── about/page.tsx              → /about
├── blog/
│   ├── page.tsx                → /blog
│   └── [slug]/page.tsx         → /blog/hello-world
└── dashboard/
    ├── page.tsx                → /dashboard
    └── settings/page.tsx       → /dashboard/settings
```

A folder **without** a `page.tsx` still creates a segment for layouts and nesting, but the URL 404s. That's how you get a `/dashboard/settings` route without a `/dashboard` page.

```jsx
// app/blog/page.tsx
export default function BlogPage() {
  return <h1>Blog</h1>;
}
```

Every `page.tsx` must have a **default export**.

---

## 2. Dynamic segments

```
app/blog/[slug]/page.tsx           → /blog/hello        params: { slug: 'hello' }
app/shop/[category]/[id]/page.tsx  → /shop/shoes/42     params: { category:'shoes', id:'42' }
app/docs/[...slug]/page.tsx        → /docs/a/b/c        params: { slug: ['a','b','c'] }
app/docs/[[...slug]]/page.tsx      → /docs   AND  /docs/a/b   (optional catch-all)
```

```jsx
// app/blog/[slug]/page.tsx
export default async function Post({ params }) {
  const { slug } = await params;          // ⚠️ Next 15: params is a Promise
  const post = await getPost(slug);
  if (!post) notFound();
  return <article><h1>{post.title}</h1></article>;
}
```

> **Version note:** in Next.js 14 and earlier, `params` and `searchParams` are plain objects (`params.slug`). In Next.js 15 they are Promises and must be awaited. This is the single most common copy-paste error between tutorial versions.

### Catch-all vs optional catch-all

```
[...slug]      matches /docs/a  and /docs/a/b     but NOT /docs
[[...slug]]    matches /docs    and /docs/a/b     (slug is undefined at /docs)
```

Use the optional form for documentation-style routes where the index and the nested pages share one component.

---

## 3. Pre-rendering dynamic routes: `generateStaticParams`

```jsx
// app/blog/[slug]/page.tsx
export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map(post => ({ slug: post.slug }));    // → /blog/a.html, /blog/b.html, …
}
```

At build time Next.js renders one static page per returned object. For nested dynamic segments, return every combination:

```jsx
// app/shop/[category]/[id]/page.tsx
export async function generateStaticParams() {
  const products = await getProducts();
  return products.map(p => ({ category: p.category, id: String(p.id) }));
}
```

### What happens to a path you didn't generate?

```jsx
export const dynamicParams = true;   // DEFAULT: render on demand, then cache it
export const dynamicParams = false;  // 404 anything not in generateStaticParams
```

`true` gives you incremental static generation: the first visitor to `/blog/new-post` waits for a server render, and everyone after gets the cached static page. `false` is right for a closed set (a fixed list of countries, say).

---

## 4. Route groups `(name)`

A folder in parentheses organises files **without adding a URL segment**.

```
app/
├── (marketing)/
│   ├── layout.tsx              ← applies to about & pricing only
│   ├── about/page.tsx          → /about        (NOT /marketing/about)
│   └── pricing/page.tsx        → /pricing
└── (app)/
    ├── layout.tsx              ← a completely different layout
    ├── dashboard/page.tsx      → /dashboard
    └── settings/page.tsx       → /settings
```

Two uses:

1. **Different layouts for different sections** at the same URL depth — a marketing shell and an app shell, with no shared parent beyond the root.
2. **Organising** a large `app/` folder without inventing URL segments.

You can even give each group its own root layout by removing the top-level one:

```
app/
├── (marketing)/layout.tsx      ← its own <html>/<body>
└── (shop)/layout.tsx           ← a different <html>/<body>
```

⚠️ Two route groups must not resolve to the same URL — `(a)/about/page.tsx` and `(b)/about/page.tsx` both mean `/about`, and the build fails.

---

## 5. Private folders `_name`

```
app/
├── _components/          ← never routable, even if it contained a page.tsx
├── _lib/
└── blog/page.tsx
```

An underscore prefix opts a folder out of routing entirely. Useful when you want an unambiguous signal that a folder is internal — though in practice, colocation already means a folder without `page.tsx` isn't routable.

To use a literal underscore in a URL, encode it: `%5Ffolder`.

---

## 6. The full segment-naming reference

| Pattern | Meaning | Example URL |
| :-- | :-- | :-- |
| `folder` | a URL segment | `/folder` |
| `[param]` | a dynamic segment | `/123` |
| `[...param]` | catch-all | `/a/b/c` |
| `[[...param]]` | optional catch-all | `/` or `/a/b` |
| `(group)` | organisational; not in the URL | — |
| `_folder` | private; not routable | — |
| `@slot` | a parallel route slot | — |
| `(.)folder` | intercepting route | — |

---

## 7. Reading route data

```jsx
// SERVER COMPONENT — from props
export default async function Page({ params, searchParams }) {
  const { slug } = await params;                 // /blog/[slug] → 'hello'
  const { page } = await searchParams;           // /blog/hello?page=2 → '2'
}
```

```jsx
// CLIENT COMPONENT — from hooks
'use client';
import { useParams, useSearchParams, usePathname, useRouter } from 'next/navigation';

function Nav() {
  const params = useParams();           // { slug: 'hello' }
  const search = useSearchParams();     // a ReadonlyURLSearchParams
  const pathname = usePathname();       // '/blog/hello'
  const router = useRouter();           // push, replace, back, refresh, prefetch

  const page = search.get('page') ?? '1';
}
```

⚠️ `useSearchParams()` in a Client Component forces the nearest Suspense boundary to render on the client during static rendering. Next.js will error at build time unless you wrap it:

```jsx
<Suspense fallback={null}>
  <ComponentUsingSearchParams />
</Suspense>
```

The reason: search params are only known at request time, so a statically generated page cannot include them in its HTML.

Also note: **using `searchParams` in a page makes that page dynamic**, since the value differs per request.

---

## 8. `notFound()` and `redirect()`

```jsx
import { notFound, redirect, permanentRedirect } from 'next/navigation';

export default async function Page({ params }) {
  const { slug } = await params;
  const post = await getPost(slug);

  if (!post) notFound();                        // renders the nearest not-found.tsx
  if (post.movedTo) redirect(`/blog/${post.movedTo}`);   // 307 (or 303 in an action)

  return <article>{post.title}</article>;
}
```

Both work by **throwing a special error** that Next.js catches. Two consequences:

```jsx
try {
  redirect('/login');            // ⚠️ your catch block swallows the redirect!
} catch (e) { … }

redirect('/login');
console.log('never runs');       // ✅ code after them is unreachable — no `return` needed
```

Never call them inside a `try` block that catches broadly.

---

## 9. Route ordering and specificity

Next.js matches from most specific to least:

```
app/blog/new/page.tsx        → /blog/new         ← static wins
app/blog/[slug]/page.tsx     → /blog/anything    ← dynamic
app/blog/[...rest]/page.tsx  → /blog/a/b/c       ← catch-all last
```

So `/blog/new` renders the static page even though `[slug]` would also match. Predictable, and it means you can add a special-case route without touching the dynamic one.

---

## 10. Common mistakes

```jsx
// 1. Forgetting page.tsx
app/about/index.tsx           // ❌ not a route
app/about/page.tsx            // ✅

// 2. Not awaiting params in Next 15
const { slug } = params;      // ❌ TypeError / undefined
const { slug } = await params;// ✅

// 3. Expecting a route group in the URL
app/(shop)/cart/page.tsx      // → /cart, NOT /shop/cart

// 4. A page and a route handler in the same folder
app/api/page.tsx + app/api/route.ts   // ❌ conflict

// 5. useSearchParams without a Suspense boundary in a static route

// 6. redirect() inside try/catch
```

---

## 🧠 Rapid-fire recall

1. What makes a folder into a public route?
2. Distinguish `[slug]`, `[...slug]` and `[[...slug]]`.
3. What does `generateStaticParams` do, and what does `dynamicParams` control?
4. Give two reasons to use a route group.
5. Why does `useSearchParams` need a Suspense boundary?
6. How do `notFound()` and `redirect()` work, and what must you avoid?
7. Which route wins for `/blog/new` when both a static and a `[slug]` route exist?

<details>
<summary>Answers</summary>

1. A `page.tsx` (or `route.ts`) inside it with a default export. Folders without one still form segments for nesting and layouts but return 404.
2. `[slug]` matches exactly one segment; `[...slug]` matches one or more and gives an array; `[[...slug]]` also matches zero segments, so the parent path itself resolves and `slug` is undefined.
3. It returns the list of parameter values to pre-render at build time, producing one static page each. `dynamicParams: true` (the default) renders unlisted paths on demand and caches them; `false` 404s them.
4. To apply different layouts to sets of routes at the same URL depth (a marketing shell vs an app shell), and to organise a large `app/` folder without adding URL segments.
5. Search params are only known at request time, so a statically rendered page can't include them. The boundary lets Next.js prerender everything else and defer that subtree to the client.
6. Both throw a special error that Next.js catches, so code after them is unreachable — and a broad `try/catch` around them will swallow the redirect.
7. The static `app/blog/new/page.tsx`. Matching goes from most specific to least: static, then dynamic, then catch-all.

</details>
