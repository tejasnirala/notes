---
title: Layouts & Special Files
author: Tejas Nirala
---

# Layouts & Special Files

Seven reserved filenames turn a folder into a fully-featured route segment with its own shell, loading state and error boundary. Each maps to a React concept you already know — this page shows which.

---

## 1. The file → React mapping

| File | What Next.js does with it |
| :-- | :-- |
| `layout.tsx` | Wraps `children`; **persists** across navigation within its segment |
| `template.tsx` | Same, but a fresh instance on every navigation (remounts) |
| `page.tsx` | The route's content |
| `loading.tsx` | Automatically wraps the segment in `<Suspense fallback={<Loading/>}>` |
| `error.tsx` | Automatically wraps it in an Error Boundary (must be `'use client'`) |
| `not-found.tsx` | Rendered by `notFound()` and for unmatched URLs |
| `global-error.tsx` | Catches errors in the root layout itself |

Two of those are just React primitives with filesystem sugar — `loading.tsx` is a Suspense boundary and `error.tsx` is an error boundary ([React: Suspense](/reactJS/suspense-and-code-splitting), [React: Error Boundaries](/reactJS/error-boundaries)).

---

## 2. The rendering hierarchy

For a request to `/dashboard/settings`, Next.js composes the segments like this:

```
<RootLayout>                      app/layout.tsx
  <RootErrorBoundary>             app/error.tsx
    <RootSuspense>                app/loading.tsx
      <DashboardLayout>           app/dashboard/layout.tsx
        <DashboardErrorBoundary>  app/dashboard/error.tsx
          <DashboardSuspense>     app/dashboard/loading.tsx
            <SettingsLayout>      app/dashboard/settings/layout.tsx
              <SettingsPage />    app/dashboard/settings/page.tsx
```

Two things follow immediately:

- An error thrown in `SettingsPage` is caught by the **nearest** error boundary — `dashboard/error.tsx` — so the dashboard shell survives.
- An `error.tsx` does **not** catch errors in its own `layout.tsx` (the boundary is inside the layout). That's what `global-error.tsx` is for.

---

## 3. `layout.tsx`

```jsx
// app/layout.tsx — the ROOT layout is required and must render <html> and <body>
import './globals.css';

export const metadata = { title: 'My App', description: '…' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
```

```jsx
// app/dashboard/layout.tsx — nested layouts do NOT render <html>/<body>
export default async function DashboardLayout({ children }) {
  const user = await getUser();                  // layouts can be async Server Components
  return (
    <div className="grid">
      <Sidebar user={user} />
      <main>{children}</main>
    </div>
  );
}
```

### The property that matters: layouts persist

```
Navigate /dashboard → /dashboard/settings

  RootLayout        ← NOT re-rendered
  DashboardLayout   ← NOT re-rendered; sidebar scroll position and state PRESERVED
  SettingsPage      ← rendered
```

Only the changed segment re-renders. A sidebar with an open accordion, a scrolled list, or a running audio player keeps its state — something the Pages Router's `_app` could never do without lifting state manually.

### Layouts cannot read the current URL

This is the most-hit limitation:

```jsx
// ❌ layouts don't receive params/searchParams for their children's routes
export default function Layout({ children, params }) { … }
```

A layout is not re-rendered on navigation, so it can't be given per-navigation data. If you need the pathname (to highlight an active nav link, say), read it in a Client Component:

```jsx
'use client';
import { usePathname } from 'next/navigation';

export function NavLink({ href, children }) {
  const pathname = usePathname();
  return <Link href={href} aria-current={pathname === href ? 'page' : undefined}>{children}</Link>;
}
```

Keep that client component small — the layout itself stays a Server Component.

---

## 4. `template.tsx`

Identical to a layout, except it creates a **new instance** on every navigation: state resets, effects re-run, DOM is recreated.

```jsx
// app/template.tsx
'use client';
export default function Template({ children }) {
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{children}</motion.div>;
}
```

Use it for: enter animations on every navigation, per-page analytics that must fire each time, or resetting state deliberately between pages. Otherwise use `layout.tsx` — persistence is almost always what you want.

If both exist, `template` renders inside `layout`.

---

## 5. `loading.tsx`

```jsx
// app/dashboard/loading.tsx
export default function Loading() {
  return <DashboardSkeleton />;
}
```

That's exactly equivalent to Next.js writing:

```jsx
<Suspense fallback={<Loading />}>
  <DashboardLayout>{page}</DashboardLayout>
</Suspense>
```

**What it buys:** the shell and the fallback are sent **immediately** while the server continues rendering the page; the real content streams in when its data resolves. TTFB becomes the time to render the shell, not the time for the slowest query.

```
Without loading.tsx:  |─────── 900ms of nothing ───────| whole page
With loading.tsx:     |─50ms─| shell + skeleton   |─900ms─| content streams in
```

**Prefer a skeleton to a spinner.** A skeleton preserves layout, so nothing shifts when the content lands (better CLS) and it communicates the shape of what's coming.

For finer control, place `<Suspense>` boundaries around individual slow components rather than the whole segment ([Streaming & Suspense](./14-streaming-and-suspense.md)).

---

## 6. `error.tsx`

```jsx
// app/dashboard/error.tsx
'use client';                                     // ← REQUIRED. Error boundaries are classes.
import { useEffect } from 'react';

export default function Error({ error, reset }) {
  useEffect(() => { logToService(error); }, [error]);

  return (
    <div role="alert">
      <h2>Something went wrong in the dashboard</h2>
      <p>{error.message}</p>
      {error.digest && <p>Reference: {error.digest}</p>}
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

- `reset()` re-renders the segment — useful for a transient failure, useless for a deterministic one (cap the retries).
- `error.digest` is a hash Next.js generates. In production, server error **messages are not sent to the client** (they could leak internals); you get the digest, and the full message and stack are in your server logs. Show the digest so a user can quote it in a support ticket.

### `global-error.tsx`

```jsx
// app/global-error.tsx
'use client';
export default function GlobalError({ error, reset }) {
  return (
    <html>                                        {/* it REPLACES the root layout */}
      <body>
        <h1>Something went wrong</h1>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
```

Because it replaces the root layout, it must render its own `<html>` and `<body>`. It only fires in production for errors in the root layout — keep it extremely simple, since anything it depends on may be the thing that's broken.

### What error boundaries don't catch

```
❌ errors in event handlers        → try/catch
❌ errors in async code            → try/catch
❌ errors in the layout at the same level as the error.tsx
❌ notFound() — that's routed to not-found.tsx, not an error
```

---

## 7. `not-found.tsx`

```jsx
// app/not-found.tsx
import Link from 'next/link';
export default function NotFound() {
  return (
    <div>
      <h2>Page not found</h2>
      <Link href="/">Go home</Link>
    </div>
  );
}
```

```jsx
// triggered explicitly
import { notFound } from 'next/navigation';
if (!post) notFound();
```

It's rendered for both explicit `notFound()` calls and unmatched URLs, and it returns a proper **404 status code** — which matters for SEO, since a "soft 404" (a 200 with a "not found" page) gets indexed.

Segment-level versions give better UX:

```
app/not-found.tsx                  → the generic 404
app/blog/[slug]/not-found.tsx      → "That post doesn't exist. Browse the blog →"
```

---

## 8. A complete segment

```
app/dashboard/
├── layout.tsx        ← sidebar + nav, persists across navigation
├── template.tsx      ← (optional) per-navigation animation
├── loading.tsx       ← skeleton, streamed immediately
├── error.tsx         ← 'use client', catches page errors
├── not-found.tsx     ← for notFound() within this segment
├── page.tsx          ← the content
└── components/       ← colocated, not routable
```

Every route segment can have its own full set. That granularity — a loading state and an error boundary *per section of the page* — is the practical payoff of the App Router.

---

## 9. Metadata (a brief look)

```jsx
// static
export const metadata = {
  title: 'Dashboard',
  description: 'Your account overview',
};

// dynamic
export async function generateMetadata({ params }) {
  const { slug } = await params;
  const post = await getPost(slug);              // deduped with the page's own fetch
  return {
    title: post.title,
    openGraph: { images: [post.image] },
  };
}
```

Both work in `layout.tsx` and `page.tsx`, and nested metadata **merges** with parents. Covered fully in [Metadata & SEO](./22-metadata-and-seo.md).

---

## 🧠 Rapid-fire recall

1. What is `loading.tsx` equivalent to in plain React, and what does it buy you?
2. Why must `error.tsx` be a Client Component?
3. What's the difference between `layout.tsx` and `template.tsx`, and which should you default to?
4. Why can't a layout read the current pathname, and what's the workaround?
5. Which errors does a segment's `error.tsx` fail to catch?
6. Why does `error.digest` exist instead of the message in production?
7. Why does returning a real 404 status matter?

<details>
<summary>Answers</summary>

1. `<Suspense fallback={<Loading/>}>` around the segment. It lets the server send the shell and fallback immediately and stream the real content in when its data resolves, so TTFB is the shell's render time rather than the slowest query's.
2. Error boundaries require `getDerivedStateFromError`/`componentDidCatch`, which only exist on class components — and those need the client runtime. There's still no hook equivalent.
3. A layout persists across navigations within its segment, preserving state and scroll; a template creates a fresh instance each time, resetting state and re-running effects. Default to `layout`.
4. Layouts aren't re-rendered on navigation within their segment, so they can't receive per-navigation route data. Read `usePathname()` in a small `'use client'` child instead.
5. Errors in event handlers, errors in async code, errors thrown by the `layout.tsx` at the same level (use `global-error.tsx`), and `notFound()` — which routes to `not-found.tsx`.
6. Server error messages can leak internal details, so in production React sends only a hash. The full message and stack stay in the server logs, and the digest lets you correlate a user report with a log entry.
7. Search engines index "soft 404s" — pages that say not found but return 200 — polluting your index. A real 404 status tells crawlers to drop the URL.

</details>
