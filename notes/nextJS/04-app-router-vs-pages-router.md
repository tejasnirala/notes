---
title: App Router vs Pages Router
author: Tejas Nirala
---

# App Router vs Pages Router

Two routing systems ship in the same framework. You'll meet both — the App Router in anything new, the Pages Router in the large majority of existing production Next.js apps. Know what differs and why.

---

## 1. The one-line summary

```
Pages Router (2016–2022):  page-centric. Every file is a page. Data fetching is
                           a set of exported magic functions. Everything is a
                           Client Component.

App Router (2022–):        layout-centric. Nested layouts, Server Components by
                           default, data fetched with plain `await`, streaming
                           built in.
```

The App Router is the future and is where all new features land. The Pages Router is maintained, not deprecated — it will keep working, and it is genuinely simpler for straightforward apps.

---

## 2. Side by side

| | Pages Router | App Router |
| :-- | :-- | :-- |
| Directory | `pages/` | `app/` |
| Route file | any `.tsx` file | `page.tsx` only |
| Layouts | one `_app.tsx`, manual per-page layouts | nested `layout.tsx`, automatic |
| Default component type | Client | **Server** |
| Data fetching | `getServerSideProps` / `getStaticProps` | `async` components + `fetch` |
| API routes | `pages/api/*.ts` | `app/**/route.ts` |
| Loading UI | manual state | `loading.tsx` + Suspense |
| Error UI | `_error.tsx` | `error.tsx` per segment |
| Streaming | ❌ | ✅ |
| Layout state on navigation | lost | **preserved** |
| Colocation | ❌ every file is a route | ✅ only reserved names route |
| Bundle | all components ship | only client components ship |

---

## 3. Routing

```
PAGES ROUTER                          APP ROUTER
pages/                                app/
├── index.tsx        → /              ├── page.tsx              → /
├── about.tsx        → /about         ├── about/page.tsx        → /about
├── blog/                             ├── blog/
│   ├── index.tsx    → /blog          │   ├── page.tsx          → /blog
│   └── [slug].tsx   → /blog/:slug    │   └── [slug]/page.tsx   → /blog/:slug
├── _app.tsx         (global wrapper) ├── layout.tsx            (root layout)
├── _document.tsx    (html shell)     └── api/posts/route.ts    → /api/posts
└── api/posts.ts     → /api/posts
```

The App Router is more verbose (a folder per route) and gets nested layouts, colocation and per-segment loading/error states in exchange.

---

## 4. Data fetching — the biggest change

### Pages Router

```jsx
// pages/blog/[slug].tsx
export async function getStaticProps({ params }) {
  const post = await getPost(params.slug);
  if (!post) return { notFound: true };
  return { props: { post }, revalidate: 60 };       // ISR
}

export async function getStaticPaths() {
  const posts = await getPosts();
  return { paths: posts.map(p => ({ params: { slug: p.slug } })), fallback: 'blocking' };
}

export default function Post({ post }) {            // props arrive from above
  return <article>{post.title}</article>;
}
```

Constraints you had to live with:

- These functions only work in **page** files, never in components.
- Everything they return must be **JSON-serialisable** (no `Date`, no class instances).
- A nested component that needs data must have it threaded down as props from the page.
- One data function per page — so one slow query blocks the whole page.

### App Router

```jsx
// app/blog/[slug]/page.tsx
export const revalidate = 60;

export default async function Post({ params }) {
  const { slug } = await params;                    // Next 15: params is a Promise
  const post = await getPost(slug);
  if (!post) notFound();
  return <article>{post.title}</article>;
}

export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map(p => ({ slug: p.slug }));
}
```

And the constraint that disappears entirely:

```jsx
// ANY server component can fetch its own data — no prop threading
async function Comments({ postId }) {
  const comments = await getComments(postId);       // 3 levels deep? Doesn't matter.
  return comments.map(c => <p key={c.id}>{c.text}</p>);
}
```

Combined with Suspense, each component's data loads independently and streams in when ready. That's the structural improvement — not the syntax.

---

## 5. Layouts

### Pages Router — one global wrapper, then manual per-page

```jsx
// pages/_app.tsx
export default function App({ Component, pageProps }) {
  const getLayout = Component.getLayout ?? (page => page);
  return getLayout(<Component {...pageProps} />);
}

// pages/dashboard/settings.tsx
Settings.getLayout = page => <DashboardLayout><SettingsLayout>{page}</SettingsLayout></DashboardLayout>;
```

Workable, but it's a convention you maintain by hand, and layout components **remount on every navigation** — losing scroll position and any state they held.

### App Router — nested by the filesystem

```
app/
├── layout.tsx                    ← wraps EVERYTHING
└── dashboard/
    ├── layout.tsx                ← wraps everything under /dashboard
    ├── page.tsx
    └── settings/
        ├── layout.tsx            ← wraps everything under /dashboard/settings
        └── page.tsx
```

```
Rendering /dashboard/settings:

  RootLayout
    └── DashboardLayout
          └── SettingsLayout
                └── SettingsPage
```

**And layouts preserve state across navigation.** Navigating `/dashboard` → `/dashboard/settings` re-renders only the changed segment; `DashboardLayout`'s sidebar keeps its scroll position, its open/closed state, and its component state. In the Pages Router that required lifting state into `_app`.

---

## 6. Migration: how to actually do it

`app/` and `pages/` **coexist**. `app/` takes precedence for conflicting routes. So migrate incrementally.

```
Recommended order:
1. Move `_app.tsx` / `_document.tsx` concerns into `app/layout.tsx`.
2. Migrate the simplest static pages first (about, pricing) — no data functions.
3. Migrate leaf pages with getStaticProps → async components.
4. Migrate pages with getServerSideProps → async components + cookies()/headers().
5. Migrate API routes: pages/api/*.ts → app/**/route.ts.
6. Migrate complex, high-traffic pages last, with real monitoring.
```

Mechanical translations:

```jsx
// getStaticProps → an async Server Component (+ `export const revalidate` for ISR)
// getServerSideProps → an async Server Component + cookies()/headers()
// getStaticPaths → generateStaticParams
// _app.tsx → app/layout.tsx
// _document.tsx → app/layout.tsx (it renders <html> and <body> itself)
// next/head → the `metadata` export or generateMetadata
// next/router → next/navigation (useRouter, usePathname, useSearchParams)
// pages/api/x.ts → app/api/x/route.ts (named exports GET/POST, Web Request/Response)
```

### The traps

```jsx
// 1. next/router does not work in app/ — the import path changed
import { useRouter } from 'next/router';       // ❌ Pages
import { useRouter } from 'next/navigation';   // ✅ App

// 2. router.query is gone; it's split in two
const { id } = router.query;                   // ❌
// → `params` (a page prop) for path segments, useSearchParams() for the query string

// 3. Any component using hooks or events needs 'use client'
// 4. CSS-in-JS libraries need a client-side provider and extra setup
// 5. In Next 15, params/searchParams/cookies()/headers() are all async
```

More detail in [Migrating from Pages to App](./29-migrating-pages-to-app.md).

---

## 7. Which should you use?

**New project:** App Router. All new features (streaming, Server Actions, PPR, RSC) land there and only there.

**Existing Pages Router app:** don't rewrite for its own sake. Migrate when you have a concrete reason — you need streaming, your bundle is dominated by server-only logic, or you're rewriting a section anyway. A working Pages Router app is not technical debt.

**Honest reasons to stay on Pages:** the team knows it, a critical library doesn't support RSC (some CSS-in-JS and animation libraries were slow to adapt), your app is mostly interactive dashboards where RSC buys little, or the caching model's complexity isn't worth it for your traffic.

---

## 🧠 Rapid-fire recall

1. Name the three biggest structural differences between the routers.
2. Why couldn't a nested component fetch its own data in the Pages Router?
3. What happens to layout state on navigation in each router?
4. What replaces `getStaticProps`, `getStaticPaths` and `getServerSideProps`?
5. Can `app/` and `pages/` coexist, and which wins on a conflict?
6. Name three traps when migrating.
7. Give an honest reason to stay on the Pages Router.

<details>
<summary>Answers</summary>

1. Server Components by default (vs everything being a client component), nested filesystem layouts that preserve state (vs one `_app` wrapper that remounts), and `async` components with `await` (vs exported data functions that only work in page files).
2. `getStaticProps`/`getServerSideProps` only run in page files, so all data had to be fetched at the top and threaded down as props — and it had to be JSON-serialisable.
3. Pages Router: layout components remount on every navigation, losing state and scroll. App Router: only the changed segment re-renders, so layout state and scroll are preserved.
4. `getStaticProps` → an `async` Server Component (with `export const revalidate` for ISR); `getStaticPaths` → `generateStaticParams`; `getServerSideProps` → an `async` component plus `cookies()`/`headers()` or `cache: 'no-store'`.
5. Yes, they coexist, and `app/` takes precedence for conflicting routes — which is what makes incremental migration possible.
6. `next/router` → `next/navigation`; `router.query` splits into `params` and `useSearchParams()`; every component using hooks or event handlers needs `'use client'`. (Also: async `params`/`cookies()` in Next 15, and CSS-in-JS needing a client provider.)
7. The team already knows it and ships well; a critical dependency doesn't support RSC; the app is a highly interactive authenticated dashboard where RSC's bundle savings are small; or the caching model's complexity isn't justified by the traffic.

</details>
