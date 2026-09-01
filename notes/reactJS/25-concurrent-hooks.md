---
title: useTransition, useDeferredValue & Action Hooks
author: Tejas Nirala
---

# useTransition, useDeferredValue & Action Hooks

[Concurrent React](./16-concurrent-react.md) explained the machinery. This page is the practical API reference: which hook to reach for, the exact code, and the traps.

---

## 1. `useTransition`

```jsx
const [isPending, startTransition] = useTransition();

startTransition(() => {
  setSomething(value);        // marked non-urgent; interruptible
});
```

- `isPending` is `true` from the moment you call `startTransition` until the transition's render commits.
- Updates inside the callback get a TransitionLane. Everything else in the same handler stays urgent.

### Recipe 1: tab switching without a freeze

```jsx
function Tabs() {
  const [tab, setTab] = useState('home');
  const [isPending, startTransition] = useTransition();

  function select(next) {
    startTransition(() => setTab(next));      // the heavy tab renders in the background
  }

  return (
    <>
      <nav>
        {['home','posts','contact'].map(t => (
          <button key={t} onClick={() => select(t)}
                  aria-current={tab === t} disabled={isPending && tab !== t}>
            {t}
          </button>
        ))}
      </nav>
      <div style={{ opacity: isPending ? 0.7 : 1 }}>
        {tab === 'posts' ? <SlowPosts /> : <Fast />}
      </div>
    </>
  );
}
```

```
click "posts"
  → the OLD tab stays fully visible and interactive
  → isPending = true → the content dims
  → React renders <SlowPosts/> in 5ms slices, yielding to input between them
  → when it's ready, commit; isPending = false
```

Without the transition, the click would freeze the page for the whole render, and the button wouldn't even show its pressed state.

### Recipe 2: keeping the mixed urgent/non-urgent split correct

```jsx
function onChange(e) {
  setQuery(e.target.value);                    // URGENT: the input's own value
  startTransition(() => setResults(filter(e.target.value)));   // NON-URGENT
}
```

**Never** defer the value the user is directly typing into. The rule: whatever the user's finger is on stays urgent.

### The synchronous-callback rule

```jsx
// ❌ setState happens after an await, outside the transition scope
startTransition(async () => {
  const data = await load();
  setData(data);                              // NOT a transition
});

// ✅
const data = await load();
startTransition(() => setData(data));
```

React 19 relaxes this specifically for Actions (below), where async functions are understood.

---

## 2. `useDeferredValue`

```jsx
const deferred = useDeferredValue(value, initialValue?);
```

Returns the previous value during the urgent render, then re-renders in the background with the new one.

```jsx
function Search({ query }) {              // query arrives as a PROP — you can't wrap the setState
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;

  return (
    <div style={{ opacity: isStale ? 0.5 : 1, transition: 'opacity .2s .2s' }}>
      <Results query={deferredQuery} />
    </div>
  );
}

const Results = React.memo(function Results({ query }) { /* expensive */ });
```

The `transition: opacity .2s .2s` delay is a nice touch: the dim only appears if the update takes longer than 200ms, so fast updates never flash.

### The `React.memo` requirement

```jsx
// ❌ Results re-renders on the urgent pass anyway — deferring achieved nothing
function Results({ query }) { … }

// ✅ memo lets the urgent render bail out of Results entirely
const Results = React.memo(function Results({ query }) { … });
```

**Trace without memo:**

```
query 'ab' → urgent render: Search re-renders, deferredQuery still 'a'
             → Results is called with query='a' … but it's NOT memoized,
               so React renders it anyway → the expensive work runs on the urgent path 💥
```

### Choosing between the two

```
Do I own the setState call?
  yes → useTransition   (gives isPending, marks the update)
  no  → useDeferredValue (defers the value at the consumption point)
```

---

## 3. `useOptimistic` (React 19)

Show the result before the server confirms it.

```jsx
function Thread({ messages, sendMessage }) {
  const [optimistic, addOptimistic] = useOptimistic(
    messages,
    (state, newText) => [...state, { id: 'temp', text: newText, sending: true }]
  );

  async function action(formData) {
    const text = formData.get('text');
    addOptimistic(text);                    // instant, local, temporary
    await sendMessage(text);                // the real mutation
  }

  return (
    <>
      {optimistic.map(m => (
        <p key={m.id} style={{ opacity: m.sending ? 0.5 : 1 }}>{m.text}</p>
      ))}
      <form action={action}><input name="text" /><button>Send</button></form>
    </>
  );
}
```

**Trace:**

```
t=0    submit → addOptimistic('hi')
       → optimistic = [...messages, {text:'hi', sending:true}]
       → the message appears immediately, dimmed              ✅
t=0-400 await sendMessage — the network round trip
t=400  the action completes → React DISCARDS the optimistic state
       → `messages` (now updated from the server) is rendered
       → the message appears solid, with its real id

on FAILURE: the action rejects → the optimistic entry vanishes automatically,
            and you show an error. No manual rollback code.
```

The automatic rollback is the point. Hand-rolled optimistic UI is mostly rollback bookkeeping.

Constraints: `useOptimistic` only holds its value **during a transition/action**. Outside one, it immediately reverts to the passed state.

---

## 4. `useActionState` (React 19)

Pending state, error handling and result state for a form submission, in one hook.

```jsx
function UpdateName() {
  const [state, formAction, isPending] = useActionState(
    async (prevState, formData) => {
      const name = formData.get('name');
      if (!name?.trim()) return { error: 'Name is required' };
      try {
        const user = await api.updateName(name);
        return { success: true, name: user.name };
      } catch (e) {
        return { error: e.message };
      }
    },
    { name: '' }              // initial state
  );

  return (
    <form action={formAction}>
      <input name="name" defaultValue={state.name} />
      <button disabled={isPending}>{isPending ? 'Saving…' : 'Save'}</button>
      {state.error   && <p role="alert">{state.error}</p>}
      {state.success && <p>Saved.</p>}
    </form>
  );
}
```

Notice what disappeared: no `useState` for pending, no try/catch scattered in the component, no manual `e.preventDefault()`. The `action` prop on `<form>` accepts a function in React 19, and React handles the submission, the transition and the pending flag.

This composes directly with Next.js Server Actions ([Next.js — Server Actions](/nextJS)).

### `useFormStatus`

For a shared submit button that needs to know about the enclosing form:

```jsx
function SubmitButton() {
  const { pending } = useFormStatus();       // reads the PARENT <form>'s status
  return <button disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>;
}

<form action={formAction}>
  <input name="name" />
  <SubmitButton />          {/* no props needed */}
</form>
```

⚠️ It must be rendered **inside** the `<form>`, not in the component that renders the form.

---

## 5. Putting them together

```jsx
function ProductPage({ id }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);          // defer the expensive filter
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState('specs');

  const [cart, addOptimistic] = useOptimistic(realCart, (c, item) => [...c, item]);

  return (
    <>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <MemoResults query={deferredQuery} />

      <nav>{TABS.map(t =>
        <button key={t} onClick={() => startTransition(() => setTab(t))}>{t}</button>
      )}</nav>
      <div style={{ opacity: isPending ? 0.6 : 1 }}><TabContent tab={tab} /></div>

      <form action={async fd => { addOptimistic(item); await addToCart(fd); }}>
        <button>Add to cart</button>
      </form>
    </>
  );
}
```

---

## 6. When not to bother

- The update is already under ~16ms. You'd add scheduling overhead for no gain.
- The user needs immediate feedback (typing, checkbox, drag). Never defer direct manipulation.
- You haven't profiled. These hooks fix *responsiveness*, not total work — an interrupted render is wasted CPU, and on a low-end device more restarts can mean worse battery life.

Measure first with the DevTools Profiler; a transition that never yields is just extra machinery.

---

## 🧠 Rapid-fire recall

1. What does `isPending` actually tell you, and when does it flip back to false?
2. Why must `setState` inside `startTransition` be synchronous (pre-React 19)?
3. Why is `React.memo` mandatory for `useDeferredValue` to help?
4. What is the trigger for choosing `useDeferredValue` over `useTransition`?
5. What happens to optimistic state when the action fails?
6. What does `useActionState` replace, concretely?
7. Where must a component calling `useFormStatus` be rendered?

<details>
<summary>Answers</summary>

1. That a transition you started has not yet committed. It becomes false when the transition's render is committed (or is superseded and the new one commits).
2. React tracks "we are inside a transition" for the duration of the synchronous callback. After an `await`, that context has been popped, so a later `setState` gets the default lane.
3. Without it, the urgent render re-renders the expensive child anyway (with the old deferred prop), so the costly work still runs on the urgent path.
4. Whether you own the `setState`. If the changing value reaches you as a prop or from a hook you don't control, defer the value; otherwise mark the update.
5. React discards it automatically and re-renders with the real state — no manual rollback code.
6. A `useState` for pending, a `useState` for the result/error, manual `preventDefault`, and the try/catch plumbing around a form submission — replaced by one hook plus `<form action={…}>`.
7. Inside the `<form>` element whose status it reports, as a descendant — not in the component that renders that form.

</details>
