---
title: Redux Toolkit
author: Tejas Nirala
---

# Redux Toolkit

Redux's reputation for boilerplate comes from 2016-era Redux. Redux Toolkit (RTK) is the official, modern, and *only* recommended way to write Redux — and it removes most of what people disliked. You'll meet it in large codebases and in interviews, so know it properly.

---

## 1. The model

```
        ┌──────────────────────────────────────────────────────┐
        │                      STORE                           │
        │            one immutable state tree                  │
        └────────────────────┬─────────────────────────────────┘
                             │ useSelector
                             ▼
                       ┌──────────┐
                       │Component │
                       └────┬─────┘
                            │ dispatch(action)
                            ▼
        ┌──────────────────────────────────────────────────────┐
        │  REDUCER: (state, action) => newState   (pure)       │
        └────────────────────┬─────────────────────────────────┘
                             │ produces a NEW state
                             └──────────▶ back to the store, subscribers notified
```

Three principles, unchanged since 2015:

1. **Single source of truth** — one store.
2. **State is read-only** — the only way to change it is to dispatch an action.
3. **Changes are made by pure reducers.**

What you get for those constraints: every state change is a logged, serialisable event, so you can replay, time-travel, audit and reproduce bugs exactly.

---

## 2. Setup

```jsx
// store.js
import { configureStore } from '@reduxjs/toolkit';
import todosReducer from './todosSlice';

export const store = configureStore({
  reducer: { todos: todosReducer, auth: authReducer },
});

// main.jsx
import { Provider } from 'react-redux';
createRoot(el).render(<Provider store={store}><App /></Provider>);
```

`configureStore` gives you, with no configuration: Redux DevTools, `redux-thunk`, an immutability check, and a serialisability check — all in development only.

---

## 3. `createSlice` — the whole point of RTK

```jsx
import { createSlice } from '@reduxjs/toolkit';

const todosSlice = createSlice({
  name: 'todos',
  initialState: { items: [], filter: 'all' },
  reducers: {
    added(state, action) {
      state.items.push(action.payload);              // ← "mutation" — see below
    },
    toggled(state, action) {
      const todo = state.items.find(t => t.id === action.payload);
      if (todo) todo.done = !todo.done;
    },
    removed(state, action) {
      state.items = state.items.filter(t => t.id !== action.payload);
    },
    filterChanged(state, action) {
      state.filter = action.payload;
    },
  },
});

export const { added, toggled, removed, filterChanged } = todosSlice.actions;
export default todosSlice.reducer;
```

`createSlice` generates the action types (`'todos/added'`), the action creators, and the reducer from one object.

### The mutation is not a mutation

RTK wraps reducers in **Immer**. Inside a reducer, `state` is a Proxy that records your writes and produces a new immutable object, structurally sharing everything you didn't touch.

```
you write:   state.items.push(todo)
Immer sees:  a write to `items`
Immer emits: { ...state, items: [...state.items, todo] }
             and `state.filter` is the SAME reference as before (structural sharing)
```

Compare the two:

```js
// hand-written immutable update — deep, error-prone
return { ...state, items: state.items.map(t =>
  t.id === id ? { ...t, done: !t.done } : t) };

// RTK
const todo = state.items.find(t => t.id === id);
if (todo) todo.done = !todo.done;
```

⚠️ The one rule: **either mutate the draft or return a new value, never both.**

```js
added(state, action) {
  state.items.push(action.payload);
  return { ...state };            // ❌ throws — pick one
}
```

---

## 4. Using it in components

```jsx
import { useSelector, useDispatch } from 'react-redux';

function TodoList() {
  const todos = useSelector(state => state.todos.items);
  const dispatch = useDispatch();

  return (
    <ul>
      {todos.map(t => (
        <li key={t.id} onClick={() => dispatch(toggled(t.id))}>
          {t.text}
        </li>
      ))}
    </ul>
  );
}
```

### The selector identity trap

`useSelector` re-renders the component when the selector's **result** changes by reference (`===` by default).

```jsx
// ❌ a new array every call → re-renders on EVERY store change, anywhere
const visible = useSelector(s => s.todos.items.filter(t => !t.done));

// ✅ memoised with createSelector
const selectVisible = createSelector(
  [s => s.todos.items, s => s.todos.filter],
  (items, filter) => filter === 'all' ? items : items.filter(t => !t.done)
);
const visible = useSelector(selectVisible);

// ✅ or select the raw data and derive in the component
const items = useSelector(s => s.todos.items);
const visible = useMemo(() => items.filter(t => !t.done), [items]);
```

Same trap with objects:

```jsx
// ❌ new object every time
const { a, b } = useSelector(s => ({ a: s.a, b: s.b }));
// ✅
import { shallowEqual } from 'react-redux';
const { a, b } = useSelector(s => ({ a: s.a, b: s.b }), shallowEqual);
// ✅ or two separate selectors — usually the cleanest
const a = useSelector(s => s.a);
const b = useSelector(s => s.b);
```

`createSelector` (Reselect) memoises on its input selectors, so the output reference is stable when the inputs haven't changed.

---

## 5. Async: `createAsyncThunk`

```jsx
export const fetchTodos = createAsyncThunk(
  'todos/fetch',
  async (userId, { rejectWithValue, signal }) => {
    try {
      const res = await fetch(`/api/todos?user=${userId}`, { signal });
      if (!res.ok) throw new Error(res.status);
      return await res.json();                     // becomes action.payload on fulfilled
    } catch (e) {
      return rejectWithValue(e.message);           // becomes action.payload on rejected
    }
  }
);

const todosSlice = createSlice({
  name: 'todos',
  initialState: { items: [], status: 'idle', error: null },
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchTodos.pending,   s => { s.status = 'loading'; s.error = null; })
      .addCase(fetchTodos.fulfilled, (s, a) => { s.status = 'succeeded'; s.items = a.payload; })
      .addCase(fetchTodos.rejected,  (s, a) => { s.status = 'failed'; s.error = a.payload; });
  },
});
```

One thunk dispatches three actions automatically:

```
dispatch(fetchTodos(1))
   → 'todos/fetch/pending'    → status: 'loading'
   → (await the network)
   → 'todos/fetch/fulfilled'  → status: 'succeeded', items filled
     or
   → 'todos/fetch/rejected'   → status: 'failed', error set
```

Every one of those appears in DevTools with its payload and the resulting state diff.

---

## 6. RTK Query — don't hand-write data fetching

If you're on Redux, RTK Query is included and replaces most thunks entirely.

```jsx
export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['Todo'],
  endpoints: builder => ({
    getTodos: builder.query({
      query: () => '/todos',
      providesTags: ['Todo'],
    }),
    addTodo: builder.mutation({
      query: body => ({ url: '/todos', method: 'POST', body }),
      invalidatesTags: ['Todo'],          // ← auto-refetches getTodos after a successful add
    }),
  }),
});

export const { useGetTodosQuery, useAddTodoMutation } = api;
```

```jsx
function Todos() {
  const { data, isLoading, error } = useGetTodosQuery();
  const [addTodo, { isLoading: isAdding }] = useAddTodoMutation();

  if (isLoading) return <Skeleton />;
  if (error) return <Error />;
  return <>
    {data.map(t => <li key={t.id}>{t.text}</li>)}
    <button onClick={() => addTodo({ text: 'New' })} disabled={isAdding}>Add</button>
  </>;
}
```

The tag system is the cache-invalidation model: a query *provides* tags, a mutation *invalidates* them, and RTK Query refetches exactly the affected queries. Caching, dedup, polling and cancellation come with it.

---

## 7. Normalising with `createEntityAdapter`

```jsx
const adapter = createEntityAdapter({
  selectId: todo => todo.id,
  sortComparer: (a, b) => a.text.localeCompare(b.text),
});

const slice = createSlice({
  name: 'todos',
  initialState: adapter.getInitialState({ status: 'idle' }),
  // state shape: { ids: [1,2,3], entities: {1: {...}, 2: {...}}, status: 'idle' }
  reducers: {
    added:   adapter.addOne,
    updated: adapter.updateOne,
    removed: adapter.removeOne,
    setAll:  adapter.setAll,
  },
});

export const { selectAll, selectById } = adapter.getSelectors(s => s.todos);
```

Why normalise: updating one item in a 10,000-entry array means scanning and rebuilding it. With `{ids, entities}` it's an O(1) key lookup, and no unrelated component re-renders because its item's reference is unchanged.

---

## 8. RTK vs the alternatives

| | RTK | Zustand |
| :-- | :-- | :-- |
| Setup | store + provider + slices | one `create()` call |
| Bundle | ~13 KB | ~1 KB |
| DevTools | best in class | good (via the Redux DevTools bridge) |
| Structure enforced | strongly | not at all |
| Async | thunks / RTK Query | plain async functions |
| Learning curve | real | ~20 minutes |

Choose RTK for: large teams needing enforced conventions, complex flows worth auditing, time-travel debugging, or an existing Redux codebase. Choose Zustand when you just need a shared store. Choose neither if the state is server data ([The State Management Landscape](./34-state-management-landscape.md)).

---

## 9. Legacy Redux, for reading old code

```jsx
// what RTK replaced — you may still meet this
const ADD_TODO = 'ADD_TODO';
const addTodo = text => ({ type: ADD_TODO, payload: text });

function reducer(state = initialState, action) {
  switch (action.type) {
    case ADD_TODO:
      return { ...state, items: [...state.items, action.payload] };   // manual spreading
    default:
      return state;
  }
}

// connect() — the HOC era
export default connect(mapStateToProps, mapDispatchToProps)(Component);
```

Three files (actions, constants, reducer) per feature, manual immutability, `connect` HOCs. `createSlice` collapses all of it.

---

## 🧠 Rapid-fire recall

1. What does `configureStore` set up that plain `createStore` doesn't?
2. How can `state.items.push(x)` be legal inside a reducer?
3. What's the one rule you must not break inside an RTK reducer?
4. Why does `useSelector(s => s.items.filter(f))` cause excessive re-renders, and what are two fixes?
5. Which three actions does a `createAsyncThunk` dispatch?
6. How does RTK Query decide what to refetch after a mutation?
7. Why normalise state into `{ids, entities}`?

<details>
<summary>Answers</summary>

1. Redux DevTools, the thunk middleware, and development-only immutability and serialisability checks — all preconfigured.
2. RTK wraps reducers in Immer; `state` is a Proxy that records writes and produces a new immutable object with structural sharing, so the original is never mutated.
3. Either mutate the draft or return a new state object — never both in the same reducer.
4. `filter` returns a new array each call, so the reference always differs and the default `===` check reports a change on every store update. Fix with `createSelector`, or select the raw data and derive with `useMemo` in the component.
5. `pending`, `fulfilled` and `rejected`, namespaced under the thunk's type prefix.
6. Tags: queries declare `providesTags`, mutations declare `invalidatesTags`, and RTK Query refetches exactly the queries providing the invalidated tags.
7. Lookups and updates become O(1) key operations instead of array scans and full rebuilds, and untouched items keep their references so unrelated components don't re-render.

</details>
