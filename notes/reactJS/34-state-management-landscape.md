---
title: The State Management Landscape
author: Tejas Nirala
---

# The State Management Landscape

"Which state library should I use?" is the wrong first question. The right one is: **what kind of state is this?** Most apps need three or four different tools, each for a different kind, and picking one tool for everything is what makes codebases painful.

---

## 1. The five kinds of state

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. LOCAL UI STATE      is a dropdown open? which tab? the input value│
│    → useState / useReducer, in the component that owns it            │
├──────────────────────────────────────────────────────────────────────┤
│ 2. SHARED CLIENT STATE theme, sidebar collapsed, a multi-step wizard,│
│                        a shopping cart before checkout               │
│    → Context (rare changes) or a store (frequent/large)              │
├──────────────────────────────────────────────────────────────────────┤
│ 3. SERVER CACHE        users, posts, orders — data owned elsewhere   │
│    → React Query / SWR / RTK Query / RSC.  NOT a store.              │
├──────────────────────────────────────────────────────────────────────┤
│ 4. URL STATE           filters, page number, sort, the active tab,   │
│                        a search query — anything shareable/bookmarkable│
│    → the router's search params. NOT useState.                       │
├──────────────────────────────────────────────────────────────────────┤
│ 5. FORM STATE          field values, touched, dirty, errors          │
│    → React Hook Form / a local reducer                               │
└──────────────────────────────────────────────────────────────────────┘
```

Getting this taxonomy right eliminates most of the difficulty. The classic mistake is putting category 3 into a category 2 tool — server data in Redux — and then hand-writing caching, invalidation and dedup for the next two years.

### URL state deserves special mention

```jsx
// ❌ the user can't share the link, back doesn't work, refresh loses everything
const [filter, setFilter] = useState('all');
const [page, setPage] = useState(1);

// ✅
const [params, setParams] = useSearchParams();
const filter = params.get('filter') ?? 'all';
const page = Number(params.get('page') ?? 1);
setParams(p => { p.set('page', '2'); return p; });
```

Ask of every piece of state: *should a refresh preserve this? should a shared link reproduce this view?* If yes, it belongs in the URL.

---

## 2. The options, compared honestly

| | Bundle (gz) | Boilerplate | Selectors | DevTools | Best for |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `useState`/`useReducer` | 0 | none | — | React DevTools | local state |
| Context + reducer | 0 | low | ❌ none | React DevTools | small shared state, DI |
| **Zustand** | ~1 KB | very low | ✅ | Redux DevTools | most apps needing a store |
| **Jotai** | ~3 KB | low | ✅ atomic | ✅ | fine-grained, derived state |
| **Redux Toolkit** | ~13 KB | medium | ✅ | 🏆 best in class | large teams, complex flows, time travel |
| **Valtio** | ~3 KB | very low | ✅ (proxy) | ✅ | mutable-style ergonomics |
| **XState** | ~15 KB | high | ✅ | 🏆 visualiser | genuinely complex state machines |
| **React Query** | ~13 KB | low | ✅ | ✅ | server data (a different category) |

---

## 3. Context + reducer — the zero-dependency store

```jsx
const StateCtx = createContext(null);
const DispatchCtx = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}
```

**Good enough when:** the state is small, changes rarely, and every consumer needs most of it.

**Breaks down when:** you need selectors. Any change re-renders every consumer, and you can't subscribe to a slice ([useContext](./24-useContext.md)). Splitting into more contexts works up to about five; past that it's a store in disguise.

---

## 4. Zustand — the pragmatic default

```jsx
import { create } from 'zustand';

const useStore = create((set, get) => ({
  count: 0,
  user: null,
  increment: () => set(s => ({ count: s.count + 1 })),
  reset: () => set({ count: 0 }),
  login: async creds => set({ user: await api.login(creds) }),
}));
```

```jsx
function Counter() {
  const count = useStore(s => s.count);           // ← subscribes to this SLICE only
  const increment = useStore(s => s.increment);
  return <button onClick={increment}>{count}</button>;
}

function UserBadge() {
  const user = useStore(s => s.user);
  // does NOT re-render when `count` changes  ✅
}
```

That selective subscription is the thing Context cannot do. Under the hood it's `useSyncExternalStore` ([Other Built-in Hooks](./26-other-built-in-hooks.md)).

```jsx
// selecting multiple values — use a shallow comparator or you'll re-render every time
import { useShallow } from 'zustand/react/shallow';
const { a, b } = useStore(useShallow(s => ({ a: s.a, b: s.b })));
```

Useful middleware:

```jsx
const useStore = create(
  persist(
    devtools(
      immer((set) => ({
        todos: [],
        add: text => set(s => { s.todos.push({ text }); }),   // Immer: "mutate" safely
      }))
    ),
    { name: 'app-storage' }        // persist to localStorage
  )
);
```

No provider, no actions/reducers ceremony, works outside React (`useStore.getState()`), and it's ~1KB. For most applications this is the right answer.

---

## 5. Jotai — bottom-up atoms

```jsx
import { atom, useAtom } from 'jotai';

const count = atom(0);
const doubled = atom(get => get(count) * 2);           // derived, auto-tracked
const asyncUser = atom(async get => fetchUser(get(count)));

function Counter() {
  const [n, setN] = useAtom(count);
  const [d] = useAtom(doubled);                        // re-renders only when `count` changes
}
```

Where Redux/Zustand start from one big object and select down, Jotai starts from small atoms and composes up. Dependency tracking is automatic — a derived atom re-computes only when the atoms it actually read change.

Best fit: lots of independent, interrelated small pieces of state (an editor, a dashboard with many widgets), or when you want React-Suspense-integrated async state.

---

## 6. Redux Toolkit — when the ceremony pays

```jsx
const slice = createSlice({
  name: 'todos',
  initialState: [],
  reducers: {
    added:  (state, action) => { state.push(action.payload); },   // Immer inside
    toggled:(state, action) => {
      const t = state.find(t => t.id === action.payload);
      if (t) t.done = !t.done;
    },
  },
});
```

You take on more structure and get, in return: the best debugging story in the ecosystem (time-travel, action log, state diffs), a strict unidirectional data flow that scales across a large team, a huge middleware ecosystem, and RTK Query for server data. Full treatment in [Redux Toolkit](./35-redux-toolkit.md).

Reach for it when: 10+ engineers on one app, complex cross-cutting flows, an audit/undo requirement, or it's already there. Don't reach for it for a dashboard with a theme toggle.

---

## 7. Decision flowchart

```
Is it server data (fetched, owned by a backend)?
  └─ YES → React Query / SWR / RTK Query / RSC.  Stop here.

Should a refresh or a shared link preserve it?
  └─ YES → URL search params.  Stop here.

Is it a form?
  └─ YES → React Hook Form (or a local reducer).  Stop here.

Is it used by ONE component (or one plus its children)?
  └─ YES → useState / useReducer, held as low as possible.  Stop here.

Is it used across the app but changes rarely (theme, locale, session)?
  └─ YES → Context (memoise the value; split state and dispatch).

Otherwise — shared, frequently changing, or large:
  ├─ small/medium team, want minimal ceremony → Zustand
  ├─ many small interdependent pieces         → Jotai
  ├─ large team, complex flows, need audit    → Redux Toolkit
  └─ genuinely complex state machine          → XState
```

---

## 8. The most common mistakes

```jsx
// 1. Server data in a client store
const useStore = create(set => ({ users: [], fetchUsers: async () => … }));
// → you now own caching, dedup, invalidation, retry, staleness. Use React Query.

// 2. Everything global "just in case"
// → a modal's isOpen in a global store means every store consumer re-renders,
//   and the modal can't be used twice on one page.

// 3. Derived data stored instead of computed
{ items: [...], filteredItems: [...], count: 5 }
// → one source of truth; derive the rest with a selector.

// 4. One giant context
<AppContext.Provider value={{ user, theme, cart, notifications, settings }}>
// → every consumer re-renders when any of it changes.

// 5. Filters and pagination in useState
// → shareable links, the back button and refresh all break.

// 6. Reaching for Redux on day one
// → start with useState; add a store when you actually feel the pain.
```

---

## 9. A realistic stack

For a typical production app in 2026:

```
Server data     → TanStack Query          (or RSC + Server Actions in Next.js)
URL state       → the router's search params
Forms           → React Hook Form + Zod
Shared UI state → Zustand (one small store) or Context for theme/auth
Local state     → useState / useReducer
```

Note that "the state management library" is the *smallest* part of that list. Most state either isn't global, or isn't client state at all.

---

## 🧠 Rapid-fire recall

1. Name the five kinds of state and the tool for each.
2. What's the test for whether something belongs in the URL?
3. What can Zustand do that Context cannot, and how?
4. Why is putting fetched data in Redux/Zustand a mistake?
5. When does Redux Toolkit's extra structure pay for itself?
6. How does Jotai's model differ from Redux's?
7. Give three symptoms of over-globalised state.

<details>
<summary>Answers</summary>

1. Local UI state → `useState`/`useReducer`; shared client state → Context or a store; server cache → React Query/SWR/RSC; URL state → router search params; form state → React Hook Form or a local reducer.
2. Should a page refresh preserve it, and should a shared link reproduce the same view? If yes — filters, pagination, sort, active tab, search query — it belongs in the URL.
3. Selective subscription: a component selects a slice and re-renders only when that slice changes. It's built on `useSyncExternalStore`, whereas context notifies every consumer on any value change.
4. You inherit the entire caching problem — deduplication, staleness, background refetch, retry, invalidation after mutations — and end up re-implementing a cache library, usually incorrectly.
5. Large teams needing enforced structure, complex cross-cutting flows, and requirements like time-travel debugging, action auditing or undo. Not for small apps.
6. Redux starts from a single store object and selects downward; Jotai composes upward from small atoms with automatic dependency tracking, so derived state recomputes only when the atoms it read change.
7. Components re-rendering for unrelated changes; a component that can't be used twice on one page because its state is global; and state that outlives the UI that owns it (a modal flag still set after navigation).

</details>
