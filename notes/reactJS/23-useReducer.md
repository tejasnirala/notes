---
title: useReducer
author: Tejas Nirala
---

# useReducer

`useReducer` moves state *transitions* out of your components and into one pure function. When state has several fields that change together according to rules, it turns a scattered set of `setX` calls into a single, testable, traceable state machine.

---

## 1. The API

```jsx
const [state, dispatch] = useReducer(reducer, initialState, init?);

function reducer(state, action) {
  // pure: (currentState, action) → nextState
  switch (action.type) {
    case 'increment': return { ...state, count: state.count + 1 };
    default:          return state;
  }
}

dispatch({ type: 'increment' });
```

| Piece | Role |
| :-- | :-- |
| `state` | the current value |
| `dispatch` | sends an action; **stable identity**, never needs to be a dependency |
| `reducer` | pure `(state, action) => newState` |
| `initialState` | used only on mount |
| `init` | optional lazy initialiser: `init(initialState)` runs once |

```jsx
// lazy init — for expensive setup
const [state, dispatch] = useReducer(reducer, userId, id => loadDraft(id));
```

---

## 2. `useState` vs `useReducer` — the same feature, both ways

```jsx
// useState version — 4 states, 6 setter calls scattered across handlers
function Form() {
  const [name, setName]       = useState('');
  const [email, setEmail]     = useState('');
  const [status, setStatus]   = useState('idle');
  const [errors, setErrors]   = useState({});

  async function submit() {
    setStatus('submitting');
    setErrors({});
    try {
      await api.save({ name, email });
      setStatus('success');
      setName(''); setEmail('');          // ← easy to forget one
    } catch (e) {
      setStatus('error');
      setErrors({ form: e.message });
    }
  }
}
```

```jsx
// useReducer version — every transition in one place
const initial = { name: '', email: '', status: 'idle', errors: {} };

function reducer(state, action) {
  switch (action.type) {
    case 'field':      return { ...state, [action.field]: action.value };
    case 'submit':     return { ...state, status: 'submitting', errors: {} };
    case 'success':    return { ...initial, status: 'success' };
    case 'error':      return { ...state, status: 'error', errors: action.errors };
    default:           throw new Error(`Unknown action: ${action.type}`);
  }
}

function Form() {
  const [state, dispatch] = useReducer(reducer, initial);

  async function submit() {
    dispatch({ type: 'submit' });
    try {
      await api.save(state);
      dispatch({ type: 'success' });
    } catch (e) {
      dispatch({ type: 'error', errors: { form: e.message } });
    }
  }

  return <input value={state.name}
                onChange={e => dispatch({ type: 'field', field: 'name', value: e.target.value })} />;
}
```

What you gained:

- `'success'` resets *all* fields in one line — impossible to forget one.
- Every possible transition is visible in one 10-line function.
- The reducer is a pure function: testable with zero React, zero DOM.
- The component contains no state logic, only intent (`dispatch({type: 'submit'})`).

### Choosing

| Use `useState` | Use `useReducer` |
| :-- | :-- |
| 1–2 independent values | 3+ values that change together |
| Simple set operations | Transitions with rules/validation |
| Next state doesn't depend on much | Next state depends on the current state |
| Local to one handler | Updates dispatched from many places |
| — | You want to log/replay/test transitions |
| — | You need to pass a stable `dispatch` deep down |

---

## 3. Tracing a reducer

```jsx
const initial = { count: 0, step: 1, history: [] };

function reducer(state, action) {
  switch (action.type) {
    case 'inc':
      return { ...state,
               count: state.count + state.step,
               history: [...state.history, state.count] };
    case 'setStep':
      return { ...state, step: action.value };
    case 'undo': {
      if (!state.history.length) return state;           // ← no-op returns the SAME object
      const history = state.history.slice(0, -1);
      return { ...state, count: state.history.at(-1), history };
    }
    case 'reset': return initial;
    default: throw new Error(`Unknown action: ${action.type}`);
  }
}
```

**Trace: inc, setStep 5, inc, undo**

```
STATE                                   ACTION              NEXT STATE
{count:0, step:1, history:[]}           {type:'inc'}        {count:1, step:1, history:[0]}
{count:1, step:1, history:[0]}          {type:'setStep',5}  {count:1, step:5, history:[0]}
{count:1, step:5, history:[0]}          {type:'inc'}        {count:6, step:5, history:[0,1]}
{count:6, step:5, history:[0,1]}        {type:'undo'}       {count:1, step:5, history:[0]}
```

Every row is a pure function call you can write as a unit test:

```js
expect(reducer({count:1, step:5, history:[0]}, {type:'inc'}))
  .toEqual({count:6, step:5, history:[0,1]});
```

Note the `undo` no-op returning `state` unchanged: React sees the same reference, `Object.is` passes, and it bails out of re-rendering entirely.

---

## 4. Action design

```jsx
// ❌ actions that describe HOW to change state — the component owns the logic again
dispatch({ type: 'setCount', value: state.count + 1 });
dispatch({ type: 'setStatus', value: 'error' });
dispatch({ type: 'setErrors', value: {...} });

// ✅ actions that describe WHAT HAPPENED — the reducer owns the logic
dispatch({ type: 'incremented' });
dispatch({ type: 'submit_failed', error });
```

Name actions after events, not setters. Then a single action can update five fields consistently, which is the entire point.

The conventional shape (Flux Standard Action):

```js
{ type: 'todo/added', payload: { text }, error: false, meta: {} }
```

---

## 5. Reducers must be pure

```jsx
function reducer(state, action) {
  state.count++;                    // ❌ mutation — React sees the same reference
  localStorage.setItem(…);          // ❌ side effect
  return { ...state, id: Math.random() };  // ❌ non-deterministic
}
```

Why it matters concretely: React **calls the reducer twice in StrictMode** to surface exactly these bugs, and a mutating reducer breaks the bail-out check and time-travel debugging.

```jsx
// ✅ pure
function reducer(state, action) {
  switch (action.type) {
    case 'add': return { ...state, items: [...state.items, action.item] };
  }
}
```

Side effects belong in the component, after dispatch, or in an effect that reacts to the resulting state.

---

## 6. `useReducer` + `useContext`: a mini Redux

For app-wide state without a library:

```jsx
const StateContext    = createContext(null);
const DispatchContext = createContext(null);      // ← split! see below

export function TodoProvider({ children }) {
  const [state, dispatch] = useReducer(todoReducer, initialTodos);
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export const useTodos    = () => useContext(StateContext);
export const useTodosDispatch = () => useContext(DispatchContext);
```

**Why two contexts:** `dispatch` is referentially stable forever, so components that only *write* never re-render when the state changes.

```jsx
function AddTodo() {
  const dispatch = useTodosDispatch();     // ✅ never re-renders on state change
  return <button onClick={() => dispatch({type:'added', text})}>Add</button>;
}

function TodoList() {
  const todos = useTodos();                // re-renders when todos change — correct
  return …;
}
```

With one combined `{state, dispatch}` context value, `AddTodo` would re-render on every state change for no reason. See [useContext](./24-useContext.md).

---

## 7. Immer for deep updates

```jsx
import { useImmerReducer } from 'use-immer';

function reducer(draft, action) {
  switch (action.type) {
    case 'toggle': {
      const todo = draft.todos.find(t => t.id === action.id);
      todo.done = !todo.done;              // looks like mutation, produces a new state
      break;
    }
    case 'addTag':
      draft.filters.tags.push(action.tag); // deep, and still immutable underneath
      break;
  }
}

const [state, dispatch] = useImmerReducer(reducer, initial);
```

Immer wraps the state in a Proxy, records your writes, and produces a new object that structurally shares every untouched branch. Compare the manual version:

```jsx
// without Immer
return { ...state, todos: state.todos.map(t =>
  t.id === action.id ? { ...t, done: !t.done } : t) };
```

Redux Toolkit bundles Immer for this reason ([Redux Toolkit](./35-redux-toolkit.md)).

---

## 8. Reducers as state machines

For anything with genuine "you can't get there from here" rules, model states explicitly:

```jsx
const machine = {
  idle:       { FETCH: 'loading' },
  loading:    { RESOLVE: 'success', REJECT: 'failure', ABORT: 'idle' },
  success:    { FETCH: 'loading' },
  failure:    { RETRY: 'loading' },
};

function reducer(state, action) {
  const next = machine[state.status]?.[action.type];
  if (!next) return state;                  // ← illegal transition: ignored, not crashed
  switch (next) {
    case 'loading': return { status: 'loading', data: null, error: null };
    case 'success': return { status: 'success', data: action.data, error: null };
    case 'failure': return { status: 'failure', data: null, error: action.error };
    default:        return { status: next };
  }
}
```

```
       FETCH          RESOLVE
idle ─────────▶ loading ─────────▶ success
                  │                   │
                  │ REJECT            │ FETCH
                  ▼                   ▼
               failure ───RETRY──▶ loading
```

Now "resolve arrives after the user aborted" simply cannot corrupt the state — the transition doesn't exist. For anything more elaborate, XState formalises this properly.

---

## 9. Traps

```jsx
// 1. Missing default → the state silently becomes undefined
default: return state;            // or throw, to catch typos loudly

// 2. Mutating
case 'add': state.items.push(x); return state;    // ❌ same reference → no re-render

// 3. Reading state inside dispatch's caller and expecting freshness
dispatch({type:'inc'});
console.log(state.count);         // old value — it's this render's snapshot

// 4. Passing the reducer inline with closures over props
const [s, d] = useReducer((st, a) => ({...st, x: props.x}), init);   // ⚠️ subtle
// prefer passing props via the action payload instead

// 5. Over-engineering
// Two booleans? useState. A reducer for that is ceremony without benefit.
```

---

## 🧠 Rapid-fire recall

1. What are the three arguments to `useReducer`, and which is optional?
2. Is `dispatch` stable across renders? What does that let you do?
3. Give three signals that state should move from `useState` to `useReducer`.
4. Why name actions after events rather than setters?
5. What happens if a reducer mutates its state argument?
6. Why split state and dispatch into two contexts?
7. How does modelling a reducer as a state machine prevent bugs that a switch on `action.type` alone does not?

<details>
<summary>Answers</summary>

1. `reducer`, `initialState`, and an optional lazy `init` function called once as `init(initialState)`.
2. Yes — the same function object for the component's lifetime. It never needs to be in a dependency array, and it can be passed through context without causing re-renders.
3. Three or more fields that change together; the next state depends on the current state in non-trivial ways; updates dispatched from many different handlers or deep in the tree. (Also: you want the transitions unit-testable.)
4. Because event-named actions let the reducer own the rules — one action can consistently update several fields — whereas setter-named actions put the logic back in the component and let fields drift out of sync.
5. React sees the same object reference, `Object.is` passes and the re-render is skipped, so the UI silently stops updating. StrictMode's double invocation also makes accumulating mutations visible.
6. `dispatch` never changes, so components that only write can subscribe to the dispatch context and never re-render when the state changes; combining them into one object value would re-render every consumer on every update.
7. It makes illegal transitions unrepresentable: an action that isn't valid from the current state simply has no entry and is ignored, so late/duplicate/out-of-order events can't corrupt the state.

</details>
