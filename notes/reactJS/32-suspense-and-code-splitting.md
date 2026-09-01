---
title: Suspense & Code Splitting
author: Tejas Nirala
---

# Suspense & Code Splitting

Two mechanisms that solve the same class of problem — "this isn't ready yet" — one for code, one for data.

---

## 1. Why split code at all

```
Single bundle:
  app.js  1.8 MB  ← the user downloads, parses and executes ALL of it
                     before seeing the login page

Split bundles:
  app.js       180 KB  (shell + router + login)
  dashboard.js 420 KB  (fetched when they navigate there)
  editor.js    900 KB  (most users never load it at all)
  charts.js    300 KB
```

Parse and execute time is the expensive part on mobile — roughly 1MB of JS costs a second or more of main-thread work on a mid-range Android device, during which the page is unresponsive.

---

## 2. `React.lazy` + `Suspense`

```jsx
import { lazy, Suspense } from 'react';

const Dashboard = lazy(() => import('./Dashboard'));

function App() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}
```

`lazy` returns a component that, on first render, throws the promise from `import()`. The nearest `Suspense` catches it, shows the fallback, and retries when the module arrives.

```
render <Dashboard/>
  → module not loaded → import() starts → the promise is THROWN
  → nearest Suspense catches it → renders <PageSkeleton/>
  → network: GET /assets/dashboard-a3f9.js
  → module resolves → React retries the subtree
  → <Dashboard/> renders → fallback is replaced
```

Requirements: the lazy module must have a **default export**.

```jsx
const Dashboard = lazy(() => import('./Dashboard'));                     // default export
const Chart = lazy(() => import('./charts').then(m => ({ default: m.Chart })));  // named
```

---

## 3. Where to split

```jsx
// 1. Per route — the highest-value split, almost always
const routes = [
  { path: '/',          element: <Home /> },
  { path: '/dashboard', element: <Suspense fallback={<S/>}><Dashboard /></Suspense> },
  { path: '/editor',    element: <Suspense fallback={<S/>}><Editor /></Suspense> },
];

// 2. Heavy components that aren't immediately visible
const RichTextEditor = lazy(() => import('./RichTextEditor'));   // 800 KB
const Chart          = lazy(() => import('./Chart'));            // recharts/d3

// 3. Modals and drawers — code the user may never open
{isOpen && <Suspense fallback={null}><SettingsModal /></Suspense>}

// 4. Below-the-fold sections, combined with IntersectionObserver
```

**Where not to split:** small components (the HTTP request costs more than the bytes saved), anything needed for the first paint, and components that would then flash a fallback on every interaction.

---

## 4. Preloading — the technique that makes splitting invisible

Code splitting trades bundle size for latency at the moment of navigation. Preloading buys the size win back without the latency.

```jsx
const Dashboard = lazy(() => import('./Dashboard'));

function Nav() {
  const preload = () => import('./Dashboard');   // idempotent — the module cache dedups
  return (
    <Link to="/dashboard" onMouseEnter={preload} onFocus={preload} onTouchStart={preload}>
      Dashboard
    </Link>
  );
}
```

```
t=0     mouse enters the link       → chunk fetch starts
t=200   user finishes moving + clicks
t=200   navigate → the chunk is ALREADY in memory → no fallback at all ✅
```

Humans take 150–300ms between hovering a link and clicking it — usually enough to hide the entire fetch. Route libraries (TanStack Router, React Router 6.4+) and Next.js `<Link>` do this automatically.

Other preload triggers: on idle (`requestIdleCallback`), after the initial route settles, or when an element scrolls near the viewport.

---

## 5. Suspense for data

Same mechanism, different resource. A component suspends until its data is ready.

```jsx
function Profile({ userPromise }) {
  const user = use(userPromise);            // React 19
  return <h1>{user.name}</h1>;
}

<Suspense fallback={<Skeleton />}>
  <Profile userPromise={fetchUser(id)} />
</Suspense>
```

In practice you get this through a framework or library, not by hand:

```jsx
// React Query
const { data } = useSuspenseQuery({ queryKey: ['user', id], queryFn: fetchUser });

// Next.js App Router — an async Server Component suspends naturally
export default async function Profile({ id }) {
  const user = await getUser(id);
  return <h1>{user.name}</h1>;
}
```

### What it buys over `isLoading`

```jsx
// ❌ every component handles its own loading state
function Profile() {
  const { data, isLoading } = useQuery(…);
  if (isLoading) return <Spinner />;
  return <h1>{data.name}</h1>;
}

// ✅ loading is a concern of the LAYOUT, not each component
<Suspense fallback={<ProfileSkeleton />}>
  <Profile />       {/* the component only knows about the success case */}
</Suspense>
```

The component gets simpler (one code path), and the loading UI moves to where the layout decisions are made.

---

## 6. Boundary placement is a UX decision

```jsx
// One boundary: all-or-nothing — the slowest child gates the whole page
<Suspense fallback={<PageSkeleton />}>
  <Header /><Feed /><Sidebar />
</Suspense>

// Per-section: each part appears as soon as it can
<Suspense fallback={<HeaderSkeleton />}><Header /></Suspense>
<Suspense fallback={<FeedSkeleton />}><Feed /></Suspense>
<Suspense fallback={<SideSkeleton />}><Sidebar /></Suspense>
```

```
One boundary:      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ (nothing)  then everything at 900ms
Per section:       header 120ms │ sidebar 300ms │ feed 900ms
                   → the user reads the header while the feed loads
```

But don't over-split either: five skeletons popping in at different times is visual noise. Group by what belongs together perceptually.

---

## 7. Avoiding the fallback flash with transitions

```jsx
// ❌ the content disappears and the skeleton flashes on every tab change
setTab('photos');

// ✅ the OLD content stays visible while the new tab loads
startTransition(() => setTab('photos'));
```

During a transition React keeps the previously committed content on screen rather than falling back, so `<Suspense>` doesn't unmount what's there ([Concurrent React](./16-concurrent-react.md)). Use `isPending` to dim it.

React also treats a boundary that has *already* revealed content differently from one mounting for the first time — the fallback is for the initial reveal, not for subsequent updates within a transition.

---

## 8. Suspense + error boundaries

```jsx
<ErrorBoundary fallback={<Failed />}>          {/* handles rejection */}
  <Suspense fallback={<Skeleton />}>           {/* handles pending */}
    <AsyncThing />
  </Suspense>
</ErrorBoundary>
```

The error boundary must be **outside**, or a failure would only replace the skeleton ([Error Boundaries](./30-error-boundaries.md)).

---

## 9. Waterfalls: the failure mode to watch for

```jsx
// ❌ sequential — each level's fetch starts only after its parent renders
<Suspense><Profile>          {/* fetches user  — 300ms */}
  <Suspense><Posts>          {/* starts AFTER user resolves — +300ms */}
    <Suspense><Comments />   {/* +300ms  → 900ms total */}
```

```
user     [────300ms────]
posts                  [────300ms────]
comments                             [────300ms────]
total: 900ms
```

```jsx
// ✅ start all requests at once, then let each suspend where it renders
const userP = fetchUser(id);        // all three start NOW
const postsP = fetchPosts(id);
const commentsP = fetchComments(id);

<Suspense fallback={<S/>}><Profile p={userP} />
  <Suspense fallback={<S/>}><Posts p={postsP} /></Suspense>
</Suspense>
```

```
user     [────300ms────]
posts    [────300ms────]
comments [────300ms────]
total: 300ms
```

This "hoist the fetch, pass the promise down" shape is the render-as-you-fetch pattern, and it's the whole reason `use()` accepts a promise rather than starting one.

---

## 10. Measuring the result

```bash
npx vite-bundle-visualizer          # Vite
ANALYZE=true npm run build          # Next.js with @next/bundle-analyzer
npx source-map-explorer build/static/js/*.js
```

Look for: a single chunk over ~200KB gzipped, a library imported for one function (`import _ from 'lodash'` instead of `lodash-es/debounce`), moment/luxon locales, and duplicate copies of the same dependency at different versions.

---

## 🧠 Rapid-fire recall

1. What does `React.lazy` actually throw, and who catches it?
2. What export shape does a lazy module need, and how do you lazy-load a named export?
3. Name three good places to split and two bad ones.
4. Why does preloading on hover usually eliminate the fallback entirely?
5. What does Suspense give you over per-component `isLoading` flags?
6. How do you avoid a fallback flash when navigating between tabs?
7. Trace the difference between a fetch waterfall and hoisted parallel fetches.

<details>
<summary>Answers</summary>

1. The promise returned by `import()`. The nearest `Suspense` boundary catches it, renders its fallback, and retries the subtree when the promise resolves.
2. A default export. For a named export, map it: `lazy(() => import('./m').then(m => ({ default: m.Thing })))`.
3. Split per route, on heavy not-immediately-visible components (editors, charts), and on modals/drawers. Don't split small components (the request costs more than the bytes) or anything needed for the first paint.
4. There's typically 150–300ms between hover and click, which is usually enough to fetch and parse the chunk, so navigation finds the module already in the cache.
5. The component only handles the success case — one code path instead of branching — and the loading UI moves up to the layout, where the decision about what to show belongs.
6. Wrap the state update in `startTransition`. React keeps the previously committed content visible instead of reverting to the fallback, and `isPending` lets you dim it.
7. In a waterfall each level's request begins only after its parent has rendered, so the durations add up (300+300+300 = 900ms). Hoisting the fetches starts all three immediately and they overlap, so the total is the slowest single request (300ms).

</details>
