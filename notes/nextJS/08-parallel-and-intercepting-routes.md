---
title: Parallel & Intercepting Routes
author: Tejas Nirala
---

# Parallel & Intercepting Routes

Two advanced routing features that look exotic until you see the problems they solve: rendering several independent pages in one layout, and showing a route as a modal over the page you came from while keeping its URL shareable.

---

## 1. Parallel routes — several pages, one layout

A folder prefixed with `@` becomes a **slot**, passed to the layout as a prop alongside `children`.

```
app/dashboard/
├── layout.tsx
├── page.tsx              ← becomes the `children` prop
├── @analytics/
│   └── page.tsx          ← becomes the `analytics` prop
└── @team/
    └── page.tsx          ← becomes the `team` prop
```

```jsx
// app/dashboard/layout.tsx
export default function Layout({ children, analytics, team }) {
  return (
    <div className="grid">
      <section>{children}</section>
      <aside>{analytics}</aside>
      <aside>{team}</aside>
    </div>
  );
}
```

Slots do **not** affect the URL — this is all still `/dashboard`.

### What this buys you

Each slot is an independent route segment, so each gets **its own `loading.tsx` and `error.tsx`**, and each streams independently.

```
app/dashboard/
├── @analytics/
│   ├── page.tsx
│   ├── loading.tsx       ← analytics gets its own skeleton
│   └── error.tsx         ← a failing analytics query doesn't break the team panel
└── @team/
    ├── page.tsx
    ├── loading.tsx
    └── error.tsx
```

```
Request /dashboard:
  shell + all three skeletons          → 50ms   🖼
  team resolves                         → 200ms  🖼
  children resolves                     → 400ms  🖼
  analytics fails                       → 900ms  🖼 its error.tsx renders,
                                                     the rest of the page is fine ✅
```

You can achieve similar isolation with `<Suspense>` and error boundaries inside one page. Parallel routes add something more: each slot can be **independently navigable**.

### Conditional slots

```jsx
// app/layout.tsx
export default async function Layout({ children, admin, user }) {
  const role = await getRole();
  return <>{children}{role === 'admin' ? admin : user}</>;
}
```

Two entirely different sub-trees, each with its own route structure, chosen at render time.

### `default.tsx` — the part that confuses people

When you navigate to a URL that matches `children` but not a slot, Next.js needs to know what to render in that slot.

```
app/dashboard/
├── @analytics/
│   ├── page.tsx          → matches /dashboard
│   └── default.tsx       ← rendered when the URL doesn't match this slot
└── settings/page.tsx     → /dashboard/settings
```

```
Navigate /dashboard → /dashboard/settings

  children: renders settings/page.tsx
  @analytics: has no /settings route
      ├─ SOFT navigation (a <Link> click): the slot keeps its PREVIOUS state
      └─ HARD navigation (a page reload):  Next renders @analytics/default.tsx
                                            — or 404s if it doesn't exist
```

That asymmetry is the classic gotcha: it works in development while you click around, then 404s when someone reloads the page. **Always add a `default.tsx` for every slot**, even if it just returns `null`.

```jsx
// app/dashboard/@analytics/default.tsx
export default function Default() { return null; }
```

---

## 2. Intercepting routes — a route rendered somewhere else

The problem: clicking a photo in a feed should open a **modal** over the feed, but the URL should become `/photo/123`, and pasting that URL in a new tab should show the **full page**.

```
Click from the feed:      URL = /photo/123, UI = modal over the feed
Paste /photo/123 fresh:   URL = /photo/123, UI = the full photo page
Share the URL:            works — it's a real route
Press back:               the modal closes, the feed is still scrolled where it was
```

Without intercepting routes you'd need modal state, a manual `history.pushState`, and two copies of the photo UI.

### The convention

```
(.)      intercept a sibling segment (same level)
(..)     intercept one level up
(..)(..) intercept two levels up
(...)    intercept from the app root
```

Read them like relative paths — except `(..)` refers to *route segment* levels, not filesystem levels, which is exactly where people go wrong with route groups in between.

### The full pattern

```
app/
├── layout.tsx
├── page.tsx                          → / (the feed)
├── @modal/
│   ├── default.tsx                   → null (nothing when no modal is active)
│   └── (.)photo/
│       └── [id]/page.tsx             ← INTERCEPTS /photo/[id] on soft navigation
└── photo/
    └── [id]/page.tsx                 ← the real, full page
```

```jsx
// app/layout.tsx
export default function Layout({ children, modal }) {
  return <>{children}{modal}</>;
}

// app/@modal/default.tsx
export default function Default() { return null; }

// app/@modal/(.)photo/[id]/page.tsx
import { Modal } from '@/components/modal';
export default async function PhotoModal({ params }) {
  const { id } = await params;
  const photo = await getPhoto(id);
  return <Modal><img src={photo.url} alt={photo.alt} /></Modal>;
}

// app/photo/[id]/page.tsx  — the standalone page
export default async function PhotoPage({ params }) {
  const { id } = await params;
  const photo = await getPhoto(id);
  return <main><img src={photo.url} alt={photo.alt} /><Comments photoId={id} /></main>;
}
```

```jsx
// components/modal.tsx
'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

export function Modal({ children }) {
  const router = useRouter();
  const ref = useRef(null);

  useEffect(() => { if (!ref.current?.open) ref.current?.showModal(); }, []);

  return (
    <dialog ref={ref} onClose={() => router.back()}>   {/* back() closes → URL restored */}
      {children}
      <button onClick={() => router.back()}>Close</button>
    </dialog>
  );
}
```

### The trace

```
SOFT navigation — <Link href="/photo/123"> clicked from the feed
  Next matches /photo/123
  finds the interception (.)photo/[id] in the @modal slot
  → children stays as the feed page
  → @modal renders the modal
  → the URL is /photo/123, the feed is still mounted and scrolled behind it ✅

HARD navigation — the user pastes /photo/123 into a new tab
  no interception applies (there's nothing to intercept from)
  → children renders app/photo/[id]/page.tsx — the full page
  → @modal renders default.tsx → null ✅

BACK from the modal
  router.back() → the URL returns to /
  → @modal matches nothing → default.tsx → null → the modal disappears
  → the feed never unmounted, so scroll position is exactly preserved ✅
```

That last line is the real win. A hand-rolled modal that navigates would remount the feed and lose the scroll position.

---

## 3. When to use each

**Parallel routes:**
- Dashboards with independently loading, independently failing panels.
- Different sub-trees per user role.
- Split views (a list and a detail pane) where each side has its own navigation.

**Intercepting routes:**
- Photo/product/detail modals over a feed (the canonical case).
- A login modal that's also a real `/login` page.
- Any "preview in a modal, full page when shared" pattern.

**When not to:** a simple confirmation dialog with no URL of its own. Use component state — routes are for things that deserve an address.

---

## 4. Gotchas

```
1. Missing default.tsx → 404 on hard navigation to a URL a slot doesn't match.
   Always add one, even returning null.

2. (..) counts ROUTE segments, not folders. Route groups (name) don't count.
   Getting it wrong silently produces no interception, and you get the full page.

3. Interception only applies to SOFT navigation. There is no way to intercept
   a fresh page load — by design, since there's nothing to render behind it.

4. A slot's page must exist for the URL you're on, or default.tsx must.

5. Modals still need full accessibility work: focus trap, focus restore, Escape.
   Prefer native <dialog>.showModal() — see the React section.

6. Debugging is genuinely hard. Add a temporary console.log to each slot's page
   and default to see which is rendering.
```

---

## 5. A dashboard putting it together

```
app/dashboard/
├── layout.tsx                       ← grid: main | revenue | activity
├── page.tsx
├── @revenue/
│   ├── page.tsx
│   ├── loading.tsx
│   ├── error.tsx
│   └── default.tsx
├── @activity/
│   ├── page.tsx
│   ├── loading.tsx
│   ├── error.tsx
│   └── default.tsx
└── @modal/
    ├── default.tsx
    └── (.)invoice/[id]/page.tsx     ← click an invoice → modal; share the URL → full page
```

```jsx
export default function DashboardLayout({ children, revenue, activity, modal }) {
  return (
    <div className="dashboard-grid">
      <main>{children}</main>
      <section>{revenue}</section>
      <section>{activity}</section>
      {modal}
    </div>
  );
}
```

Three independently streaming, independently failing panels plus a URL-addressable modal — and no client state coordinating any of it.

---

## 🧠 Rapid-fire recall

1. What does an `@folder` create, and does it appear in the URL?
2. What does each parallel slot get that a `<Suspense>` boundary alone doesn't?
3. When is `default.tsx` rendered, and what breaks without it?
4. What do `(.)`, `(..)` and `(...)` mean, and what do they count?
5. Trace what happens when a user clicks a photo link vs pastes the URL fresh.
6. Why does back-from-modal preserve the feed's scroll position?
7. Give a case where you should use component state instead of an intercepting route.

<details>
<summary>Answers</summary>

1. A parallel route slot, passed to the layout as a prop named after the folder (minus the `@`). It does not affect the URL.
2. Its own independent route segment — meaning its own `loading.tsx`, `error.tsx` and independent navigability, not just an independent streaming boundary.
3. When the current URL doesn't match anything in that slot during a *hard* navigation. Without it, the route 404s on reload even though it works when clicking around in development.
4. Intercept a sibling segment, one route level up, and from the app root respectively (`(..)(..)`  is two levels). They count route segments, so route groups in between don't count.
5. Click: the interception matches, so `children` stays as the feed and the `@modal` slot renders the modal at URL `/photo/123`. Paste: no interception applies, `children` renders the full photo page and `@modal` renders `default.tsx` → null.
6. The feed page was never unmounted — it stayed rendered in `children` while the modal was overlaid from a separate slot, so its DOM and scroll position persist.
7. A confirmation dialog or a transient popover that doesn't deserve its own URL and shouldn't be shareable or in the history.

</details>
