---
title: Navigation & Linking
author: Tejas Nirala
---

# Navigation & Linking

How the user moves between routes, what Next.js does behind the scenes (prefetching, caching, partial rendering), and the patterns for search params, scroll and programmatic navigation.

---

## 1. `<Link>`

```jsx
import Link from 'next/link';

<Link href="/about">About</Link>
<Link href={`/blog/${post.slug}`}>{post.title}</Link>
<Link href={{ pathname: '/search', query: { q: 'react', page: 2 } }}>Search</Link>
<Link href="/dashboard" replace>Dashboard</Link>        {/* no history entry */}
<Link href="/#section" scroll={false}>Section</Link>    {/* don't scroll to top */}
<Link href="/heavy" prefetch={false}>Heavy page</Link>
<Link href="https://external.com">External</Link>       {/* renders a plain <a> */}
```

`<Link>` renders a real `<a>`, so middle-click, ⌘-click, right-click → open in new tab, and "copy link address" all work. That's why you must not do this:

```jsx
<div onClick={() => router.push('/about')}>About</div>   // ❌ not a link
```

It's invisible to crawlers, unfocusable by keyboard, and breaks every browser affordance users expect.

### What `<Link>` does that `<a>` doesn't

1. **Client-side navigation** — no full page reload; only the changed segments re-render.
2. **Prefetching** — the route's code and data are fetched before the click.
3. **Layout preservation** — shared layouts don't remount.
4. **Scroll restoration** — going back restores your position.

---

## 2. Prefetching — the mechanism

```
Link enters the viewport (via IntersectionObserver)
   └─▶ Next.js fetches the route's JS chunk and its RSC payload
       └─▶ stores it in the client Router Cache
           └─▶ the user clicks → navigation is instant, no network wait
```

Defaults (production only — prefetching is disabled in `next dev`):

| `prefetch` | Behaviour |
| :-- | :-- |
| `null` (default) | Static routes: full prefetch. Dynamic routes: only up to the nearest `loading.tsx` boundary, so the shell appears instantly |
| `true` | Always full prefetch, including dynamic route data |
| `false` | No prefetch on viewport; still prefetches on hover |

Turn it off for links to rarely-visited heavy pages, or in a list of 500 links where prefetching everything would flood the network.

```jsx
// programmatic prefetch — e.g. the next step of a wizard
const router = useRouter();
useEffect(() => { router.prefetch('/checkout/payment'); }, [router]);
```

---

## 3. `useRouter` — programmatic navigation

```jsx
'use client';                          // ⚠️ required — it's a client hook
import { useRouter } from 'next/navigation';    // NOT 'next/router' (that's Pages)

function Form() {
  const router = useRouter();

  async function onSubmit() {
    await save();
    router.push('/dashboard');         // adds a history entry
    router.replace('/dashboard');      // replaces the current entry
    router.back();
    router.forward();
    router.refresh();                  // re-fetch server data, KEEP client state
    router.prefetch('/next');
  }
}
```

### `router.refresh()` — the one people miss

```jsx
router.refresh();
```

It re-runs the server components for the current route and merges the new output into the existing tree. React state and browser state are **preserved** — it isn't a reload.

```
After a mutation via a Route Handler:
  router.refresh()  →  server re-renders  →  the list shows the new row
                    →  the user's scroll position, focus and open modals survive
```

With Server Actions you usually use `revalidatePath` instead ([Server Actions](./18-server-actions.md)); `refresh()` is for mutations that go through a Route Handler or an external API.

---

## 4. Reading the current route

```jsx
'use client';
import { usePathname, useSearchParams, useParams } from 'next/navigation';

function Breadcrumbs() {
  const pathname = usePathname();          // '/blog/hello'   (no query string)
  const params = useParams();              // { slug: 'hello' }
  const search = useSearchParams();        // ReadonlyURLSearchParams

  const page = Number(search.get('page') ?? 1);
}
```

```jsx
// Server Components take them as props instead
export default async function Page({ params, searchParams }) {
  const { slug } = await params;
  const { page } = await searchParams;
}
```

### The `useSearchParams` Suspense requirement

```jsx
// ❌ build error: "useSearchParams() should be wrapped in a suspense boundary"
export default function Page() {
  const search = useSearchParams();
}

// ✅
export default function Page() {
  return <Suspense fallback={null}><Filters /></Suspense>;
}
```

Search params are only known at request time, so a statically prerendered page can't include them. The boundary lets Next.js prerender everything else and defer that subtree.

---

## 5. Search params as state

Filters, pagination, sort and tabs belong in the URL, not in `useState` — so links are shareable, refresh preserves the view, and the back button works.

```jsx
'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

function Filters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParam = useCallback((key, value) => {
    const params = new URLSearchParams(searchParams);      // a mutable copy
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete('page');                                  // reset pagination on filter change
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, pathname, router]);

  return (
    <select value={searchParams.get('sort') ?? 'new'} onChange={e => setParam('sort', e.target.value)}>
      <option value="new">Newest</option>
      <option value="price">Price</option>
    </select>
  );
}
```

The server page then reads them and re-renders:

```jsx
export default async function Page({ searchParams }) {
  const { sort = 'new', page = '1' } = await searchParams;
  const products = await getProducts({ sort, page: Number(page) });
  return <Grid products={products} />;
}
```

```
change the select
  → router.push('/shop?sort=price')
  → Next fetches the RSC payload for the new URL
  → the server re-runs the page with the new params
  → only the changed part of the tree updates; the layout and sidebar persist ✅
```

Wrap the push in `startTransition` (or use `useTransition`) if the server render is slow, so the select stays responsive.

---

## 6. Scroll behaviour

```jsx
<Link href="/page" scroll={false}>              // don't scroll to top
router.push('/page', { scroll: false });
```

Default: scroll to the top on navigation, and restore the previous position on back/forward. Disable it when the navigation is a filter change on the same page — scrolling to the top there is jarring.

For hash links, Next.js scrolls to the element with that id.

---

## 7. Loading states during navigation

```jsx
'use client';
import { useLinkStatus } from 'next/link';       // Next 15+

function LinkSpinner() {
  const { pending } = useLinkStatus();           // must be rendered INSIDE a <Link>
  return pending ? <Spinner /> : null;
}

<Link href="/slow"><span>Go</span><LinkSpinner /></Link>
```

Or take control with a transition:

```jsx
'use client';
const [isPending, startTransition] = useTransition();

<button onClick={() => startTransition(() => router.push('/slow'))} disabled={isPending}>
  {isPending ? 'Loading…' : 'Go'}
</button>
```

Wrapping navigation in a transition keeps the current page visible and interactive while the next one is prepared, instead of blanking to a fallback ([React: Concurrent React](/reactJS/concurrent-react)).

---

## 8. The client Router Cache

Next.js caches visited and prefetched route segments in memory on the client.

```
Navigate /a → /b → back to /a
   /a's RSC payload is served from the client cache → instant, no server round trip
```

Two things to know:

- The cache is **in memory only** and cleared on a full page reload.
- Its staleness window changed across versions (Next 15 defaults dynamic pages to not being reused). If you see stale data after a mutation, the fix is `router.refresh()` or `revalidatePath` — not disabling the cache.

```jsx
// force a fresh fetch of server data for the current route
router.refresh();
```

---

## 9. Navigation patterns

```jsx
// After a form submission (Server Action)
async function createPost(formData) {
  'use server';
  const post = await db.post.create({ … });
  revalidatePath('/posts');
  redirect(`/posts/${post.id}`);           // redirect() works in server actions
}

// Conditional redirect in a Server Component
export default async function Page() {
  const session = await auth();
  if (!session) redirect('/login');
  return <Dashboard />;
}

// Preserving where the user was going
redirect(`/login?next=${encodeURIComponent(pathname)}`);

// An active nav link
'use client';
const pathname = usePathname();
const isActive = pathname === href || pathname.startsWith(href + '/');
<Link href={href} aria-current={isActive ? 'page' : undefined} className={cn(isActive && 'active')} />
```

---

## 10. Mistakes

```jsx
import { useRouter } from 'next/router';       // ❌ Pages Router
import { useRouter } from 'next/navigation';   // ✅ App Router

const router = useRouter();                     // ❌ in a Server Component — no hooks
                                                // ✅ use redirect() instead

<div onClick={() => router.push('/x')}>         // ❌ not a link
<Link href="/x">                                // ✅

<a href="/about">                               // ❌ full page reload, loses state
<Link href="/about">                            // ✅

useSearchParams() without <Suspense>            // ❌ build error on static routes
router.push() in a loop / effect without guards // ❌ navigation storms
```

---

## 🧠 Rapid-fire recall

1. Name four things `<Link>` does that a plain `<a>` doesn't.
2. When does prefetching happen, and how does it differ for static vs dynamic routes?
3. What does `router.refresh()` do, and what does it preserve?
4. Why must `useSearchParams` be inside a Suspense boundary?
5. Why put filters and pagination in the URL rather than `useState`?
6. How do you navigate from a Server Component?
7. Why is `<div onClick={() => router.push(…)}>` wrong?

<details>
<summary>Answers</summary>

1. Client-side navigation with partial re-rendering, prefetching of the route's code and data, preservation of shared layouts (and their state), and scroll restoration on back/forward.
2. When the link enters the viewport (production only). Static routes are fully prefetched; dynamic routes are prefetched only up to the nearest `loading.tsx` boundary so the shell can appear instantly.
3. Re-runs the current route's Server Components and merges the new output into the existing tree, without a page reload — React state, focus, scroll and open modals are all preserved.
4. Its value is only known at request time, so a statically prerendered page can't contain it. The boundary lets the rest of the page prerender while that subtree is deferred.
5. So links are shareable, refresh reproduces the view, and the back button works. It also lets the server re-render with the new params instead of duplicating filtering logic on the client.
6. Call `redirect()` (or `permanentRedirect()`) from `next/navigation` — Server Components have no hooks, so `useRouter` isn't available.
7. It isn't a link: crawlers can't follow it, keyboard users can't focus it, and middle-click, ⌘-click and "copy link address" all fail.

</details>
