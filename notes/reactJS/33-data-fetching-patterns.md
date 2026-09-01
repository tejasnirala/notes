---
title: Data Fetching Patterns
author: Tejas Nirala
---

# Data Fetching Patterns

Server data is not state — it's a **cache of someone else's state**. Treating it as ordinary component state is the root of most data bugs in React apps. This page walks from the naive version to what production code looks like, showing exactly which bug each step fixes.

---

## 1. Level 0 — the naive fetch, and its five bugs

```jsx
function Profile({ userId }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch(`/api/users/${userId}`)
      .then(res => res.json())
      .then(setUser);
  }, [userId]);

  return <div>{user.name}</div>;
}
```

```
🐛 1. Crashes on the first render — user is null, user.name throws
🐛 2. No loading state
🐛 3. No error handling — a rejected promise is unhandled
🐛 4. HTTP errors are invisible — fetch resolves on 404/500
🐛 5. Race condition — a slow request for userId=1 can overwrite userId=2
```

---

## 2. Level 1 — correct, by hand

```jsx
function Profile({ userId }) {
  const [state, setState] = useState({ status: 'idle', data: null, error: null });

  useEffect(() => {
    if (!userId) return;
    const ac = new AbortController();
    setState({ status: 'loading', data: null, error: null });

    fetch(`/api/users/${userId}`, { signal: ac.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);   // fixes bug 4
        return res.json();
      })
      .then(data => setState({ status: 'success', data, error: null }))
      .catch(error => {
        if (error.name === 'AbortError') return;              // expected on cleanup
        setState({ status: 'error', data: null, error });     // fixes bug 3
      });

    return () => ac.abort();                                  // fixes bug 5
  }, [userId]);

  if (state.status === 'loading') return <Skeleton />;         // fixes bugs 1, 2
  if (state.status === 'error')   return <Error error={state.error} />;
  if (!state.data)                return null;

  return <div>{state.data.name}</div>;
}
```

### The race condition, traced

Without the abort, with the user clicking through profiles quickly:

```
t=0    userId=1 → GET /users/1  (slow network: 800ms)
t=100  userId=2 → GET /users/2  (fast: 150ms)
t=250  /users/2 resolves → setState(user2)   ✅ screen shows user 2
t=800  /users/1 resolves → setState(user1)   💥 screen now shows user 1

The user is looking at profile 2 and seeing profile 1's data.
```

With `return () => ac.abort()`:

```
t=100  userId changes → the PREVIOUS effect's cleanup runs first → ac.abort()
       → /users/1 rejects with AbortError → the catch swallows it
       → the new effect starts /users/2
t=250  /users/2 resolves → setState(user2)   ✅ and nothing can overwrite it
```

**Note the ordering:** React runs the old effect's cleanup *before* the new effect's setup, which is exactly what makes this correct.

---

## 3. What Level 1 still doesn't do

Even the "correct" version is missing everything that makes an app feel fast:

```
❌ No caching — navigate away and back, and it refetches from scratch
❌ No deduplication — three components asking for the same user = three requests
❌ No background refetch — data goes stale and stays stale
❌ No retry on transient failure
❌ No pagination or infinite-scroll support
❌ No optimistic updates
❌ No cross-component invalidation after a mutation
❌ No "refetch when the window regains focus"
❌ No offline/reconnect handling
```

Building all of that is a library. That's why you should use one.

---

## 4. Level 2 — a cache library

```jsx
import { useQuery } from '@tanstack/react-query';

function Profile({ userId }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: ({ signal }) => fetch(`/api/users/${userId}`, { signal })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
  });

  if (isPending) return <Skeleton />;
  if (error)     return <Error error={error} />;
  return <div>{data.name}</div>;
}
```

Twelve lines replaced thirty, *and* you gained caching, dedup, retry, background refetch, abort and devtools. Covered in depth in [React Query](./36-react-query.md).

---

## 5. Level 3 — fetch before you render

All of the above are "fetch-on-render": React renders, then discovers it needs data, then starts a request. That guarantees at least one round trip *after* the component code has loaded.

```
Fetch-on-render:
  [── load JS ──][── render ──][── fetch ──][── render ──]

Fetch-then-render (route loader):
  [── load JS ──]
  [──── fetch ────]              (started in parallel with the JS)
                  [── render ──]

Render-as-you-fetch (RSC):
  server: [fetch + render]──▶ stream HTML ──▶ browser paints
```

### Route loaders

```jsx
// React Router 6.4+
const router = createBrowserRouter([{
  path: '/users/:id',
  loader: ({ params, request }) => fetchUser(params.id, { signal: request.signal }),
  element: <Profile />,
}]);

function Profile() {
  const user = useLoaderData();      // already resolved — no loading state needed here
  return <div>{user.name}</div>;
}
```

The router starts the fetch as soon as the navigation begins, in parallel with loading the route's code chunk.

### Server Components

```jsx
// Next.js App Router — this runs on the server; the fetch never reaches the client
export default async function Profile({ params }) {
  const user = await getUser(params.id);      // no useEffect, no loading state, no waterfall
  return <div>{user.name}</div>;
}
```

Zero client JavaScript for the fetching, no round trip from the browser, and the data is in the initial HTML. See the [Next.js section](/nextJS).

---

## 6. Waterfalls: the most common performance bug

```jsx
// ❌ each fetch waits for its parent to render
function Page({ id }) {
  const { data: user } = useQuery(['user', id], fetchUser);
  if (!user) return <Skeleton />;
  return <Posts authorId={user.id} />;        // Posts only starts fetching NOW
}
```

```
user   [────300ms────]
posts                 [────300ms────]     total 600ms
```

```jsx
// ✅ start both immediately when the ids are known up front
const results = useQueries({ queries: [
  { queryKey: ['user', id],  queryFn: () => fetchUser(id) },
  { queryKey: ['posts', id], queryFn: () => fetchPosts(id) },
]});
```

```
user   [────300ms────]
posts  [────300ms────]                     total 300ms
```

When the second request genuinely needs the first's result, the fix is server-side: one endpoint (or a GraphQL query) that returns both, so the dependency is resolved where the latency is 1ms instead of 300ms.

**How to spot a waterfall:** open the Network tab and look at the waterfall chart. Requests that start in a staircase, each beginning where the previous ended, are the bug.

---

## 7. Mutations

```jsx
function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: user => fetch(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),

    onSuccess: (data, vars) => {
      qc.setQueryData(['user', vars.id], data);      // write the response into the cache
      qc.invalidateQueries({ queryKey: ['users'] }); // mark lists stale → they refetch
    },
  });
}
```

The important idea: **after a write, the cache is wrong.** Either update it from the response (`setQueryData`) or mark it stale (`invalidateQueries`). Forgetting this is why "I saved it but the list still shows the old name" happens.

Optimistic version:

```jsx
useMutation({
  mutationFn: updateUser,
  onMutate: async newUser => {
    await qc.cancelQueries({ queryKey: ['user', newUser.id] });   // stop in-flight refetches
    const previous = qc.getQueryData(['user', newUser.id]);       // snapshot for rollback
    qc.setQueryData(['user', newUser.id], newUser);               // apply optimistically
    return { previous };
  },
  onError: (err, newUser, ctx) => {
    qc.setQueryData(['user', newUser.id], ctx.previous);          // roll back
  },
  onSettled: (d, e, newUser) => {
    qc.invalidateQueries({ queryKey: ['user', newUser.id] });     // reconcile with the server
  },
});
```

```
click save
  onMutate   → UI updates instantly with the new name          ✅ feels instant
  network    → PUT /api/users/1
  success    → onSettled invalidates → refetch → server truth confirmed
  failure    → onError restores the snapshot → the old name comes back + show a toast
```

---

## 8. Choosing an approach

| Situation | Use |
| :-- | :-- |
| Next.js App Router | Server Components + `fetch` with `revalidate`; React Query for client-side interactive data |
| SPA with a router that supports loaders | Route loaders + React Query |
| SPA, REST API | **React Query** or SWR |
| GraphQL | Apollo Client, urql, or Relay |
| One trivial fetch in a tiny app | `useEffect` (Level 1) — but write the abort |
| Redux already in the codebase | RTK Query (it's included) |

**Do not** put server data in Redux/Zustand by hand. You will end up re-implementing caching, invalidation, dedup and retry — badly. Keep client state (UI, forms, selection) in a store; keep server data in a cache.

---

## 9. Practical rules

```
1. Never leave a fetch without abort/cancellation in an effect.
2. Always check res.ok — fetch does not reject on 4xx/5xx.
3. Model status as one enum, not three booleans.
4. Handle all four states: loading, error, empty, success.
5. Deduplicate by key, not by "I hope only one component asks".
6. After a mutation, invalidate or update the cache. Always.
7. Look at the Network tab's waterfall before optimising anything else.
8. Move fetches earlier: render → loader → server. Each step removes a round trip.
```

---

## 🧠 Rapid-fire recall

1. List the five bugs in the naive `useEffect` + `fetch` component.
2. Why does `fetch` not throw on a 500 response?
3. Trace the race condition and explain exactly which React behaviour makes the abort fix work.
4. Name five things a cache library gives you that hand-rolled fetching doesn't.
5. What's the difference between fetch-on-render, fetch-then-render and render-as-you-fetch?
6. How do you detect a request waterfall, and what are the two fixes?
7. What must happen to the cache after a successful mutation, and why?

<details>
<summary>Answers</summary>

1. Crash on the first render (data is null), no loading state, unhandled rejection, HTTP error statuses treated as success, and a race where a slower earlier request overwrites a newer result.
2. By design it only rejects on network-level failure; an HTTP error status is a successful *response*, exposed as `res.ok === false` and `res.status`.
3. A slow request for the old id resolves after a fast one for the new id and calls `setState` last. React runs the previous effect's cleanup before the next effect's setup, so `ac.abort()` cancels the stale request before the new one starts.
4. Caching, request deduplication, background refetching/staleness, automatic retry, cancellation, pagination/infinite scroll helpers, optimistic updates, cross-component invalidation, focus/reconnect refetch, devtools.
5. Fetch-on-render starts the request after the component renders (guaranteeing an extra round trip); fetch-then-render starts it when the navigation begins, in parallel with loading the code; render-as-you-fetch (RSC) does the fetching on the server as part of rendering, so the data arrives in the initial HTML.
6. In the Network tab, requests that start in a staircase pattern. Fix by starting independent requests in parallel (`useQueries`, hoisted promises) or, for genuinely dependent data, by combining them into one server endpoint.
7. It must be updated from the response or invalidated, because the cached data is now known to be out of date. Otherwise other components keep rendering stale values.

</details>
