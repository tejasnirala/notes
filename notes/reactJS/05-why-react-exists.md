---
title: Why React Exists
author: Tejas Nirala
---

# Why React Exists

Before the API, the problem. Every design decision in React — the Virtual DOM, one-way data flow, immutability, hooks — is an answer to a specific engineering pain. If you know the pain, the API stops needing memorisation.

---

## 1. The equation

React's entire thesis is one line:

```
UI = f(state)
```

The screen is a **pure function of your data**. You never write "change this div's text". You write "given this data, the screen looks like *this*", and the library computes the difference.

```
        ┌───────────┐    render    ┌──────────────┐   commit   ┌──────────┐
state ─▶│ your       │ ───────────▶│ a description│ ──────────▶│ real DOM │
        │ components │             │ of the UI    │            └──────────┘
        └───────────┘             └──────────────┘
              ▲                                                      │
              └──────────────── events / setState ◀──────────────────┘
```

---

## 2. Imperative vs declarative

**Imperative:** you list the steps. You own the transition from every state to every other state.

```js
function setLoading(isLoading) {
  if (isLoading) {
    spinner.style.display = 'block';
    form.style.display = 'none';
    submitBtn.disabled = true;
    errorBox.textContent = '';
    errorBox.style.display = 'none';
  } else {
    spinner.style.display = 'none';
    form.style.display = 'block';
    submitBtn.disabled = false;
  }
}
```

Now add an `error` state, and a `success` state. You do not write 3 functions — you write the **transitions between all pairs**, and you will forget some. This is the combinatorial explosion that killed jQuery apps.

```
        idle ⇄ loading ⇄ success
          ⇅       ⇅        ⇅
        error ⇄ ... ⇄ ...        ← every arrow is code you must write and maintain
```

**Declarative:** you describe each state's appearance. There are no transitions — React computes them.

```jsx
function Form({ status, error }) {
  return (
    <>
      {status === 'loading' && <Spinner />}
      {status !== 'loading' && (
        <form>
          <input />
          <button disabled={status === 'loading'}>Submit</button>
        </form>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
    </>
  );
}
```

You wrote N descriptions instead of N² transitions. Adding a state is adding one branch, not auditing every existing path.

> The analogy that lands: imperative is *driving turn by turn*; declarative is *giving a destination*. React is the navigation system that computes the route.

---

## 3. Why not just re-render everything?

The naive declarative implementation is:

```js
container.innerHTML = renderToHTML(state);
```

That is genuinely declarative — and unusable:

| Problem | Why |
| :-- | :-- |
| Destroys DOM state | Focus, text selection, scroll position, `<video>` playback all reset |
| Slow | Reparsing HTML and rebuilding hundreds of heavy DOM objects every keystroke |
| Loses listeners | Every attached event handler is thrown away |
| Layout thrash | Full document reflow every time |

React's answer: **describe the whole UI declaratively, but apply only the differences.**

```
                  YOU write this          React does this
                  ─────────────           ───────────────
  state change ─▶ full description  ─────▶ diff vs previous description
                  of the new UI            ─▶ minimal list of DOM operations
                                           ─▶ apply them
```

That intermediate "description" is the Virtual DOM: cheap plain JS objects instead of expensive DOM nodes.

```js
// A React element — this is all it is
{ type: 'div', props: { className: 'card', children: [...] }, key: null, ref: null }
```

Creating a million of these is fast. Creating a million DOM nodes is not.

---

## 4. Components: the unit of composition

React's other big idea is that **markup, styling logic and behaviour for one thing belong together**, not split across three files by technology.

```jsx
function LikeButton({ postId }) {
  const [liked, setLiked] = useState(false);        // behaviour
  return (
    <button                                          // markup
      className={liked ? 'btn liked' : 'btn'}        // styling logic
      onClick={() => setLiked(!liked)}
    >
      {liked ? '♥' : '♡'}
    </button>
  );
}
```

This is not "HTML in JavaScript" for its own sake — it's the observation that these three things change *together*, so they should live together. The separation that matters is by **concern** (what a Like button is), not by **file type**.

Composition then works like functions:

```jsx
<Page>
  <Header />
  <Feed>
    {posts.map(p => <Post key={p.id} {...p} />)}
  </Feed>
</Page>
```

---

## 5. One-way data flow

Data flows **down** through props. Changes flow **up** through callbacks. Always.

```
        ┌────────────┐
        │   App      │  owns: user
        └─────┬──────┘
   props │    │    ▲ callback
         ▼    │    │
      ┌───────┴────┴──────┐
      │      Profile      │
      └───────┬───────────┘
              ▼
        ┌──────────┐
        │  Avatar  │
        └──────────┘
```

```jsx
function App() {
  const [user, setUser] = useState({ name: 'Ada' });
  return <Profile user={user} onRename={name => setUser({ ...user, name })} />;
}
```

Why this constraint is worth the friction: when the screen is wrong, there is exactly **one place** the data could have come from. You walk up the tree. In a two-way-binding system, any component could have written to any value, and debugging becomes archaeology.

---

## 6. Immutability, and why React insists

React must answer "did this change?" thousands of times per second. A deep comparison would be O(size of your data) every render — unaffordable. So React compares **references** with `Object.is` (see [Closures & Identity](./03-closures-and-identity.md)).

That works only if you never mutate:

```js
// ❌ mutation — the reference is unchanged, so React sees NOTHING
user.name = 'Grace';
setUser(user);              // Object.is(user, user) → true → bail out → no re-render

// ✅ new reference
setUser({ ...user, name: 'Grace' });
```

The trade: you write a few more characters; you get an O(1) change check, trivially correct undo/redo, safe time-travel debugging, and `React.memo` that actually works.

---

## 7. What React is, and what it deliberately is not

React is a **library for rendering UI**, not a framework.

| React gives you | You choose |
| :-- | :-- |
| Components, state, effects | Routing (React Router, TanStack Router, Next.js) |
| Reconciliation & the DOM | Data fetching (fetch, React Query, SWR, RSC) |
| Context, refs, portals | Global state (Context, Zustand, Redux) |
| Concurrent rendering | Styling (CSS Modules, Tailwind, CSS-in-JS) |
| A renderer interface | Build tooling (Vite, Next.js, Rspack) |

The renderer interface is why the same component model runs on the DOM (`react-dom`), native mobile (`react-native`), 3D scenes (`react-three-fiber`), CLIs (`ink`) and PDFs. `react` itself knows nothing about the DOM.

```
        ┌──────────────────────────┐
        │  react (reconciler core) │   components, hooks, fibers, diffing
        └─────────────┬────────────┘
     ┌────────────────┼────────────────┬─────────────┐
     ▼                ▼                ▼             ▼
 react-dom      react-native     react-three-fiber  ink
 (browser)      (iOS/Android)    (WebGL)            (terminal)
```

Next.js sits on top of `react-dom`, adding routing, a server, bundling and caching — which is the subject of the [Next.js section](/nextJS).

---

## 8. A short history you should know for interviews

| Year | What changed | Why it matters |
| :-- | :-- | :-- |
| 2013 | React open-sourced; Virtual DOM | Declarative UI became practical |
| 2015 | React Native | Proved the renderer-agnostic architecture |
| 2017 | **Fiber** (v16) — rewrite of the reconciler | Made rendering interruptible; unlocked everything since |
| 2018 | **Hooks** (v16.8) | State/effects in functions; killed the class/HOC/render-prop tax |
| 2020 | Concurrent features, Suspense for data | Rendering became a priority-scheduled activity |
| 2022 | **React 18** — concurrent root, automatic batching, transitions | Opt-in concurrency for everyone |
| 2023+ | **Server Components**, Actions | Components that run only on the server, zero client JS |
| 2024+ | **React 19** — `use`, Actions, `ref` as a prop, the Compiler | Auto-memoisation; less manual `useMemo`/`useCallback` |

The through-line: React keeps moving work off the user's main thread — first by diffing instead of rewriting, then by slicing the render, then by moving components to the server entirely.

---

## 🧠 Rapid-fire recall

1. State the React equation and explain what "declarative" buys you concretely.
2. Why can't you implement declarative UI with `container.innerHTML = render(state)`?
3. What is a React element, physically?
4. Why does React require immutable state updates?
5. Why is React called a library rather than a framework? Name three things it does not provide.
6. What did Fiber change, and what did it enable later?
7. Explain one-way data flow and the debugging benefit it produces.

<details>
<summary>Answers</summary>

1. `UI = f(state)`. You write N state descriptions instead of the N² transitions between them, so adding a state is adding a branch rather than auditing every path.
2. It destroys focus, selection, scroll position and media state, discards every event listener, and forces a full reparse plus document reflow on each update.
3. A plain JavaScript object — roughly `{type, props, key, ref}`. It is a *description*, not a DOM node, which is why creating many is cheap.
4. Because React decides "did this change?" with an O(1) reference comparison (`Object.is`). Mutation leaves the reference identical, so the change is invisible.
5. It renders UI and nothing else; routing, data fetching, global state, styling and build tooling are your choice. That also lets the same core drive DOM, native, WebGL and terminal renderers.
6. Fiber replaced the recursive, synchronous reconciler with a linked-list structure and a work loop that can pause, resume and abandon work — the prerequisite for time-slicing, transitions, Suspense and concurrent rendering.
7. Props flow down, callbacks flow up. When something on screen is wrong, exactly one owner could have produced that value, so you trace straight up the tree instead of searching for whoever mutated it.

</details>
