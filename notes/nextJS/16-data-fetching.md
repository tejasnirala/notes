---
title: Data Fetching
author: Tejas Nirala
---

# Data Fetching

In the App Router, fetching data is `await`. The interesting parts are *where* you fetch, how to avoid waterfalls, and how deduplication makes the "every component fetches its own data" model work.

---

## 1. The basic shape

```jsx
// app/posts/page.jsx — a Server Component
export default async function Posts() {
  const posts = await fetch('https://api.example.com/posts').then(r => r.json());
  return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
}
```

No `useEffect`, no loading state, no error state, no API route, no data-fetching library. The `await` blocks the server render; Suspense handles the loading UI.

### Direct database access

```jsx
import { db } from '@/lib/db';

export default async function Posts() {
  const posts = await db.post.findMany({
    where: { published: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return <PostList posts={posts} />;
}
```

Never call your own API routes from a Server Component — you'd be making an HTTP request from your server to itself for data you can read directly ([Route Handlers](./09-route-handlers.md)).

---

## 2. Colocate fetching with the component that needs it

```jsx
// ❌ the Pages Router habit: fetch everything at the top, thread it down
export default async function Page() {
  const [user, posts, comments, related] = await Promise.all([...]);
  return <Layout user={user}><Feed posts={posts} comments={comments} related={related} /></Layout>;
}

// ✅ each component fetches what it needs
export default function Page() {
  return (
    <Layout>
      <Suspense fallback={<FeedSkeleton />}><Feed /></Suspense>
      <Suspense fallback={<SideSkeleton />}><Sidebar /></Suspense>
    </Layout>
  );
}

async function Feed() { const posts = await getPosts(); … }
async function Sidebar() { const trending = await getTrending(); … }
```

Colocation is only viable because of deduplication (next section) and streaming ([Streaming & Suspense](./14-streaming-and-suspense.md)). Without those it would be a performance disaster; with them it's strictly better — components are self-contained, and slow ones don't gate fast ones.

---

## 3. Request deduplication

### `fetch` — automatic, per render pass

Next.js extends `fetch` so identical requests (same URL and options) within one server render are made **once**.

```jsx
async function getUser() { return fetch('https://api.x.com/user/1').then(r => r.json()); }

async function Layout() { const u = await getUser(); … }    // ┐
async function Page()   { const u = await getUser(); … }    // ├─ ONE actual request
async function Sidebar(){ const u = await getUser(); … }    // ┘
```

### `cache()` — for anything that isn't `fetch`

```jsx
import { cache } from 'react';
import { db } from '@/lib/db';

export const getUser = cache(async (id) => {
  return db.user.findUnique({ where: { id } });
});
```

```jsx
await getUser('1');    // queries the database
await getUser('1');    // returns the memoised promise — no second query
await getUser('2');    // different argument → a real query
```

Two things to know:

- The memo is scoped to a **single request**, so there's no cross-user leakage.
- Arguments are compared by identity, so pass primitives — `getUser({id: '1'})` would miss every time.

This is what makes `generateMetadata` and the page body sharing a query free:

```jsx
export async function generateMetadata({ params }) {
  const post = await getPost((await params).slug);      // ┐
  return { title: post.title };                          // ├─ one query
}                                                        // │
export default async function Page({ params }) {         // │
  const post = await getPost((await params).slug);      // ┘
  return <article>{post.body}</article>;
}
```

---

## 4. Waterfalls — the main performance mistake

```jsx
// ❌ sequential — 900ms
const user = await getUser(id);            // 300ms
const posts = await getPosts(user.id);     // 300ms
const stats = await getStats(user.id);     // 300ms
```

```jsx
// ✅ posts and stats don't depend on each other — 600ms
const user = await getUser(id);
const [posts, stats] = await Promise.all([getPosts(user.id), getStats(user.id)]);
```

```jsx
// ✅✅ if you can key everything off the URL param — 300ms
const [user, posts, stats] = await Promise.all([getUser(id), getPosts(id), getStats(id)]);
```

### Preloading — starting a request early without awaiting it

```jsx
export default async function Page({ params }) {
  const { id } = await params;

  preload(id);                             // fire and forget: starts the request NOW

  const user = await getUser(id);          // 300ms
  return <><Profile user={user} /><Posts userId={id} /></>;
  // Posts awaits getPosts(id) — but it's ALREADY in flight, so it resolves ~immediately
}

export const preload = (id) => { void getPosts(id); };   // relies on cache() dedup
```

The pattern: kick off a request whose result you'll need later, and let deduplication hand the cached promise to whoever awaits it.

### Component-level waterfalls

```jsx
// ❌ Comments can't start until Article's await resolves
async function Article({ id }) {
  const post = await getPost(id);
  return <><h1>{post.title}</h1><Comments postId={id} /></>;
}

// ✅ siblings under Suspense fetch in parallel
export default function Page({ params }) {
  return (
    <>
      <Suspense fallback={<S/>}><Article id={params.id} /></Suspense>
      <Suspense fallback={<S/>}><Comments postId={params.id} /></Suspense>
    </>
  );
}
```

**Diagnosing:** add timing logs, or look at your database's query log. A staircase of start times is a waterfall.

---

## 5. Sequential when it's genuinely required

```jsx
// the second call NEEDS the first's result — this waterfall is correct
const user = await getUser(id);
const org = await getOrg(user.orgId);
```

If this is on a hot path, fix it at the data layer rather than in React:

```jsx
// one query, one round trip
const user = await db.user.findUnique({ where: { id }, include: { org: true } });
```

---

## 6. Fetching in Client Components

Sometimes you genuinely need client-side fetching: data that changes on interaction, polling, infinite scroll, or anything driven by client state.

```jsx
'use client';
import { useQuery } from '@tanstack/react-query';

export function Search() {
  const [q, setQ] = useState('');
  const debounced = useDebounce(q, 300);
  const { data, isPending } = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) => fetch(`/api/search?q=${debounced}`, { signal }).then(r => r.json()),
    enabled: debounced.length > 2,
  });
  …
}
```

This needs a Route Handler to call, which is one of the legitimate reasons to write one.

### Server-fetched initial data + client updates

The best of both:

```jsx
// server
export default async function Page() {
  const initialPosts = await getPosts();
  return <PostFeed initialPosts={initialPosts} />;
}
```

```jsx
'use client';
export function PostFeed({ initialPosts }) {
  const { data } = useQuery({
    queryKey: ['posts'],
    queryFn: fetchPosts,
    initialData: initialPosts,          // no loading spinner on first paint
  });
}
```

The first render is server-side with real data (fast, SEO-friendly), and the client takes over for refetching and pagination.

---

## 7. Error handling

```jsx
export default async function Page() {
  const res = await fetch('https://api.x.com/data');
  if (!res.ok) throw new Error(`API ${res.status}`);      // → the nearest error.tsx
  return <Data data={await res.json()} />;
}
```

```jsx
// or handle it locally, when a partial failure is acceptable
async function Sidebar() {
  try {
    const trending = await getTrending();
    return <Trending items={trending} />;
  } catch {
    return null;                     // the sidebar disappears; the page still works
  }
}
```

```jsx
// 404 vs error — different UX and different status codes
const post = await getPost(slug);
if (!post) notFound();               // → not-found.tsx, returns a real 404
```

Remember `fetch` doesn't reject on a 4xx/5xx status — you must check `res.ok` yourself.

---

## 8. Typing the boundary

Data crossing from the network into your app is unverified. Validate it.

```ts
import { z } from 'zod';

const Post = z.object({ id: z.string(), title: z.string(), body: z.string() });
const Posts = z.array(Post);

export async function getPosts() {
  const res = await fetch('https://api.x.com/posts');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Posts.parse(await res.json());        // throws loudly if the API changed
}
```

An API that silently drops a field should break your build or your error boundary, not render `undefined` into your page.

---

## 9. Organising data access

```
src/features/posts/
├── queries.ts      ← read functions, wrapped in cache()
├── actions.ts      ← 'use server' mutations
└── schema.ts       ← Zod schemas shared by both
```

```ts
// queries.ts
import 'server-only';                          // ← throws if imported into a client bundle
import { cache } from 'react';

export const getPost = cache(async (slug: string) => { … });
export const getPosts = cache(async (opts) => { … });
```

The `server-only` package is a genuinely useful guard: importing this module from a Client Component becomes a **build error** rather than a runtime leak of your database code into the browser. Its counterpart, `client-only`, does the reverse.

---

## 🧠 Rapid-fire recall

1. Why shouldn't a Server Component fetch from its own API route?
2. What makes "every component fetches its own data" viable rather than catastrophic?
3. What's the difference between `fetch` dedup and React's `cache()`, and what's the argument gotcha?
4. Show the three levels of parallelising three dependent-looking fetches.
5. What does the preload pattern do, and what does it rely on?
6. When is client-side fetching the right call in an App Router app?
7. What does the `server-only` package protect against?

<details>
<summary>Answers</summary>

1. It's an HTTP round trip from your server to itself for data it can read directly — slower, with an extra endpoint to secure, version and type twice.
2. Request deduplication (so repeated calls for the same data run once per request) plus streaming with Suspense (so slow components don't gate fast ones).
3. `fetch` dedup is automatic for identical URL+options within one render pass; `cache()` wraps any async function, including ORM calls. `cache()` compares arguments by identity, so pass primitives — an inline object argument misses every time.
4. Fully sequential (900ms); await the dependency then `Promise.all` the rest (600ms); if everything can key off the URL param, one `Promise.all` for all three (300ms).
5. It starts a request without awaiting it, so it's in flight while other work happens; when a component later awaits the same call, deduplication returns the already-running promise.
6. When the data depends on client interaction — search-as-you-type, infinite scroll, polling, or anything driven by client state. Pair it with server-fetched `initialData` so the first paint is still fast.
7. Importing server-only modules (database clients, secrets, query files) into a Client Component. It converts a silent runtime leak into a build error.

</details>
