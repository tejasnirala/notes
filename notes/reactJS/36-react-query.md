---
title: TanStack Query (React Query)
author: Tejas Nirala
---

# TanStack Query (React Query)

The library that reframed data fetching: server data is a **cache**, not state, and caches have well-understood mechanics — keys, staleness, invalidation, garbage collection. Once you see it that way, most "data bugs" become configuration.

---

## 1. Setup

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,        // how long data is considered FRESH
      gcTime: 5 * 60_000,       // how long UNUSED data stays in memory (was cacheTime)
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
});

<QueryClientProvider client={queryClient}>
  <App />
  <ReactQueryDevtools />         {/* genuinely worth installing */}
</QueryClientProvider>
```

---

## 2. `useQuery`

```jsx
function Todos({ userId }) {
  const { data, isPending, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['todos', userId],                     // the cache key
    queryFn: ({ signal }) =>                          // the fetcher (gets an AbortSignal!)
      fetch(`/api/todos?user=${userId}`, { signal })
        .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    enabled: !!userId,                                // don't run until we have an id
  });

  if (isPending) return <Skeleton />;
  if (isError)   return <Error error={error} onRetry={refetch} />;
  return <ul>{data.map(t => <li key={t.id}>{t.text}</li>)}</ul>;
}
```

### `isPending` vs `isFetching`

```
isPending  = there is NO data yet (first load)         → show a skeleton
isFetching = a request is IN FLIGHT (including a background refetch)
                                                        → show a subtle spinner
```

```jsx
{isPending  && <Skeleton />}                           {/* nothing to show yet */}
{isFetching && !isPending && <RefreshIndicator />}     {/* refreshing existing data */}
```

That distinction is what makes React Query apps feel fast: on revisit you show cached data instantly *and* refresh in the background, instead of a spinner.

---

## 3. Query keys

The key is the cache identity. It's an array, compared **structurally** (deep equality), and everything the query depends on must be in it.

```jsx
['todos']                                  // the list
['todos', userId]                          // one user's todos
['todos', { status: 'done', page: 2 }]     // objects are fine — key order doesn't matter
['todos', 'detail', todoId]                // hierarchical
```

```jsx
// ❌ userId isn't in the key → switching users shows the previous user's data
useQuery({ queryKey: ['todos'], queryFn: () => fetchTodos(userId) });

// ✅
useQuery({ queryKey: ['todos', userId], queryFn: () => fetchTodos(userId) });
```

Because keys are hierarchical, invalidation can be broad or narrow:

```jsx
qc.invalidateQueries({ queryKey: ['todos'] });                // ALL todo queries
qc.invalidateQueries({ queryKey: ['todos', userId] });        // just this user's
```

The standard scaling pattern is a key factory:

```jsx
export const todoKeys = {
  all:     ['todos'],
  lists:   () => [...todoKeys.all, 'list'],
  list:    filters => [...todoKeys.lists(), filters],
  details: () => [...todoKeys.all, 'detail'],
  detail:  id => [...todoKeys.details(), id],
};
```

---

## 4. The lifecycle — the model to internalise

```
    fetch succeeds
         │
         ▼
    ┌─────────┐  staleTime elapses   ┌─────────┐
    │  FRESH  │ ───────────────────▶ │  STALE  │
    └─────────┘                      └─────────┘
       │                                  │
       │ mounted again → NO refetch       │ mounted again → BACKGROUND refetch
       │ (data is served from cache)      │ (cached data shown immediately,
       │                                  │  updated when the request returns)
       ▼                                  ▼
   last observer unmounts ──▶ inactive ──▶ after gcTime ──▶ removed from memory
```

Two independent timers, and mixing them up is the most common configuration mistake:

| | Controls | Default |
| :-- | :-- | :-- |
| `staleTime` | how long before a refetch is considered necessary | `0` (immediately stale) |
| `gcTime` | how long unused data survives in memory | 5 minutes |

```jsx
staleTime: 0            // refetch on every mount/focus — always current, chattier
staleTime: 5 * 60_000   // trust the cache for 5 minutes — good for lists
staleTime: Infinity     // never auto-refetch — for truly static data
```

**Trace: navigating away and back with `staleTime: 60_000`**

```
t=0     mount → no cache → fetch → data cached, marked FRESH
t=10s   navigate away → the query has no observers → INACTIVE (gcTime timer starts)
t=20s   navigate back → observer re-mounts, gcTime timer cancelled
        data is still FRESH (< 60s) → rendered INSTANTLY, no request  ✅
t=90s   navigate away and back again
        data is STALE (> 60s) → cached data rendered instantly,
        AND a background refetch starts → updates when it lands       ✅
t=400s  (nothing mounted since t=100s) gcTime exceeded → removed from memory
```

The user never sees a spinner after the first load. That's the whole product benefit.

---

## 5. Deduplication and background refetching

```jsx
// three components, one request
function A() { useQuery({ queryKey: ['user', 1], queryFn: fetchUser }); }
function B() { useQuery({ queryKey: ['user', 1], queryFn: fetchUser }); }
function C() { useQuery({ queryKey: ['user', 1], queryFn: fetchUser }); }
```

Identical keys share one cache entry and one in-flight request. All three re-render when it resolves. No coordination code, no lifting state.

Automatic refetch triggers (each configurable):

```jsx
refetchOnMount: true,          // a stale query re-mounts
refetchOnWindowFocus: true,    // the user tabs back in
refetchOnReconnect: true,      // the network comes back
refetchInterval: 30_000,       // polling
refetchIntervalInBackground: false,
```

---

## 6. Mutations

```jsx
function useAddTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: newTodo =>
      fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTodo),
      }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),

    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos'] }),
  });
}

function AddTodo() {
  const { mutate, isPending, error } = useAddTodo();
  return <button disabled={isPending} onClick={() => mutate({ text: 'New' })}>
    {isPending ? 'Adding…' : 'Add'}
  </button>;
}
```

`mutate` fires and forgets; `mutateAsync` returns a promise if you need to await it (remember to catch — an unhandled rejection otherwise).

### Optimistic updates

```jsx
useMutation({
  mutationFn: updateTodo,

  onMutate: async newTodo => {
    await qc.cancelQueries({ queryKey: ['todos'] });         // stop in-flight refetches
    const previous = qc.getQueryData(['todos']);             // snapshot for rollback
    qc.setQueryData(['todos'], old =>                        // apply immediately
      old.map(t => t.id === newTodo.id ? newTodo : t));
    return { previous };                                      // → becomes `context`
  },

  onError: (err, newTodo, context) => {
    qc.setQueryData(['todos'], context.previous);            // roll back
    toast.error('Update failed');
  },

  onSettled: () => qc.invalidateQueries({ queryKey: ['todos'] }),  // reconcile
});
```

```
t=0    click → onMutate → UI shows the new value instantly     ✅
t=0    PUT /api/todos/1 sent
       ── success ──▶ onSettled → invalidate → refetch → server truth confirmed
       ── failure ──▶ onError → previous snapshot restored + toast
```

`cancelQueries` in `onMutate` is essential: without it, a refetch already in flight can land *after* your optimistic write and overwrite it with stale server data.

---

## 7. Pagination and infinite scroll

```jsx
// Paginated — keep the previous page visible while the next loads
const { data, isPlaceholderData } = useQuery({
  queryKey: ['todos', page],
  queryFn: () => fetchTodos(page),
  placeholderData: keepPreviousData,        // no flash back to a skeleton
});

<button disabled={isPlaceholderData} onClick={() => setPage(p => p + 1)}>Next</button>
```

```jsx
// Infinite
const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
  queryKey: ['todos'],
  queryFn: ({ pageParam }) => fetchTodos(pageParam),
  initialPageParam: 0,
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,   // undefined = done
});

{data.pages.flatMap(p => p.items).map(t => <Row key={t.id} todo={t} />)}
<button onClick={fetchNextPage} disabled={!hasNextPage || isFetchingNextPage}>Load more</button>
```

Pair `fetchNextPage` with an `IntersectionObserver` sentinel for real infinite scroll ([Custom Hooks](./27-custom-hooks.md)).

---

## 8. Suspense mode

```jsx
const { data } = useSuspenseQuery({ queryKey: ['user', id], queryFn: fetchUser });
// data is guaranteed defined — no isPending branch at all

<ErrorBoundary fallback={<Failed />}>
  <Suspense fallback={<Skeleton />}>
    <Profile />
  </Suspense>
</ErrorBoundary>
```

The component handles only the success case; loading and error move to boundaries ([Suspense & Code Splitting](./32-suspense-and-code-splitting.md)).

---

## 9. Prefetching

```jsx
// on hover — the data is ready before the user clicks
<Link
  to={`/todos/${id}`}
  onMouseEnter={() => qc.prefetchQuery({
    queryKey: ['todo', id],
    queryFn: () => fetchTodo(id),
    staleTime: 10_000,
  })}
/>

// seeding a detail cache from a list you already have
qc.setQueryData(['todo', todo.id], todo);
```

Combined with route-level code preloading, navigation becomes instant.

---

## 10. Common mistakes

```jsx
// 1. A dependency missing from the key
useQuery({ queryKey: ['todos'], queryFn: () => fetchTodos(filter) });   // ❌

// 2. Copying query data into useState
const { data } = useQuery(…);
const [todos, setTodos] = useState(data);      // ❌ frozen at the first value

// 3. staleTime: 0 everywhere → a request on every mount and focus

// 4. Forgetting to invalidate after a mutation → stale lists

// 5. queryFn not throwing on HTTP errors → errors cached as success
queryFn: () => fetch(url).then(r => r.json())              // ❌
queryFn: () => fetch(url).then(r => { if(!r.ok) throw …; return r.json(); })  // ✅

// 6. Ignoring the signal → no cancellation
queryFn: ({ signal }) => fetch(url, { signal })            // ✅

// 7. Using it for client state (a modal flag, a form draft) — wrong tool
```

---

## 11. React Query vs SWR vs RTK Query

| | React Query | SWR | RTK Query |
| :-- | :-- | :-- | :-- |
| Bundle | ~13 KB | ~4 KB | included with RTK |
| Mutations | full-featured | basic | full-featured |
| Infinite/pagination | 🏆 | ✅ | ✅ |
| Devtools | 🏆 | basic | Redux DevTools |
| Requires Redux | no | no | **yes** |
| Cache invalidation | key-based | key-based | tag-based |

Default to React Query unless you're already on Redux (then RTK Query) or want the smallest possible footprint (SWR).

---

## 🧠 Rapid-fire recall

1. What's the difference between `staleTime` and `gcTime`?
2. What's the difference between `isPending` and `isFetching`, and how do you use both?
3. Why must every dependency of `queryFn` appear in the `queryKey`?
4. Trace what happens when you navigate away and back within `staleTime`, and after it.
5. What do three components with the same query key cost?
6. Why must `onMutate` call `cancelQueries` before writing optimistically?
7. Why must `queryFn` throw on a 404?

<details>
<summary>Answers</summary>

1. `staleTime` is how long fetched data is trusted without a background refetch; `gcTime` is how long data with no active observers stays in memory before being discarded. They're independent timers.
2. `isPending` means there's no data yet (first load) — show a skeleton. `isFetching` means a request is in flight, including background refreshes — show a subtle indicator over the existing data.
3. The key *is* the cache identity. A dependency missing from it means different inputs share one cache entry, so you render another argument's data.
4. Within `staleTime`: the cached data renders instantly with no request. After it: cached data still renders instantly, and a background refetch updates it when it lands. Only after `gcTime` with no observers is the entry removed, forcing a real load.
5. One cache entry and one in-flight request — identical keys are deduplicated, and all three components re-render when it resolves.
6. Otherwise an already in-flight refetch can resolve *after* your optimistic write and overwrite it with pre-mutation server data.
7. React Query treats a resolved promise as success. Without an explicit throw, an error response body is cached as valid data and the error state never fires.

</details>
