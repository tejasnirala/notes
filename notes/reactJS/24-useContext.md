---
title: useContext
author: Tejas Nirala
---

# useContext

Context is a way to pass a value to an entire subtree without threading props through every level. It is a **transport mechanism**, not a state manager — and understanding its re-render behaviour is what separates people who use it well from people who ship slow apps.

---

## 1. The API

```jsx
const ThemeContext = createContext('light');       // the argument is the DEFAULT

function App() {
  return (
    <ThemeContext.Provider value="dark">
      <Toolbar />
    </ThemeContext.Provider>
  );
}

function Button() {
  const theme = useContext(ThemeContext);          // 'dark' — reads the NEAREST provider
  return <button className={theme} />;
}
```

The default value is used **only when there is no matching Provider above**. It is not a fallback for `value={undefined}` — that gives you `undefined`.

React 19 lets you render the context itself as the provider:

```jsx
<ThemeContext value="dark">…</ThemeContext>        // React 19
<ThemeContext.Provider value="dark">…</ThemeContext.Provider>   // all versions
```

### How lookup works

`useContext` walks **up the fiber tree** from the consumer, looking for a provider of that exact context object.

```
App
 └─ ThemeContext.Provider value="dark"
     └─ Layout
         └─ Toolbar
             └─ Button  ── useContext(ThemeContext) ──┐
                    walks up: Toolbar? Layout? Provider ✓ → "dark"
```

Nesting works, nearest wins:

```jsx
<ThemeContext.Provider value="dark">
  <Panel />                                   {/* dark */}
  <ThemeContext.Provider value="light">
    <Panel />                                 {/* light */}
  </ThemeContext.Provider>
</ThemeContext.Provider>
```

---

## 2. The re-render rule

> **Every component that calls `useContext(C)` re-renders whenever `C`'s provider value changes** — by `Object.is` — regardless of `React.memo`.

That last clause surprises people:

```jsx
const Child = React.memo(function Child() {
  const theme = useContext(ThemeContext);      // memo does NOT protect this
  return <div className={theme} />;
});
```

`React.memo` compares *props*. Context isn't a prop — it's a subscription. When the value changes, React marks every consumer fiber as needing an update, and memo can't stop it.

### The #1 context performance bug

```jsx
function App() {
  const [user, setUser] = useState(null);
  return (
    <AuthContext.Provider value={{ user, setUser }}>   {/* ❌ NEW OBJECT every render */}
      <HugeTree />
    </AuthContext.Provider>
  );
}
```

```
App re-renders for ANY reason (a sibling state change, a parent render)
  → the object literal {user, setUser} is evaluated again → new reference
  → Object.is(newValue, oldValue) → false
  → EVERY consumer in HugeTree re-renders, even though `user` is identical 💥
```

Fix:

```jsx
const value = useMemo(() => ({ user, setUser }), [user]);   // setUser is stable
return <AuthContext.Provider value={value}>…</AuthContext.Provider>;
```

Now the value's identity changes only when `user` does.

---

## 3. Splitting contexts

Even memoised, one big context re-renders everyone when *any* part of it changes.

```jsx
// ❌ a component that only needs `theme` re-renders when `user` changes
const AppContext = createContext({ user, theme, locale, notifications });
```

Split by **change frequency** and by **who reads what**:

```jsx
const UserContext   = createContext(null);     // changes on login/logout — rare
const ThemeContext  = createContext('light');  // changes on toggle — rare
const NotifsContext = createContext([]);       // changes constantly — isolate it!
```

### The state/dispatch split

The highest-value split, because dispatch never changes:

```jsx
const StateContext    = createContext(null);
const DispatchContext = createContext(null);

function Provider({ children }) {
  const [state, dispatch] = useReducer(reducer, initial);
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}
```

```
A component that only dispatches:
   subscribes to DispatchContext → dispatch identity NEVER changes
   → it NEVER re-renders due to state updates  ✅
```

---

## 4. The custom-hook wrapper (always do this)

```jsx
const AuthContext = createContext(undefined);      // undefined default is deliberate

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  const login  = useCallback(async creds => setUser(await api.login(creds)), []);
  const logout = useCallback(() => setUser(null), []);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an <AuthProvider>');   // ← the payoff
  }
  return ctx;
}
```

Benefits: consumers never import the context object, the missing-provider case fails loudly with a useful message instead of silently reading a default, and you can change the implementation (swap to Zustand, add a selector) without touching consumers.

---

## 5. What context is good at, and what it isn't

**Good fits** — values that are genuinely ambient and change rarely:

```
theme / dark mode        current user / session      locale & translations
router state             feature flags               a form's context (React Hook Form)
a design-system config   a portal container          dependency injection (an API client)
```

**Bad fits:**

```
❌ High-frequency state (mouse position, scroll offset, a text input's value)
   → every consumer re-renders on every change
❌ Large application state with many independent slices
   → no selector support: you get all of it or none
❌ Server data
   → use React Query; you need caching, refetch, invalidation, not just transport
```

### The missing feature: selectors

```jsx
// what you want but cannot have with plain context:
const name = useContextSelector(UserContext, c => c.user.name);   // re-render only if name changes
```

Plain context has no selector. Options:

1. Split into more contexts (works, gets unwieldy past ~5).
2. `use-context-selector` (a userland library implementing it).
3. Use a store — Zustand, Jotai, Redux — which are *built* on selective subscription.

```jsx
// Zustand: the component re-renders only when `user.name` changes
const name = useStore(s => s.user.name);
```

This is the honest reason large apps still reach for a store: not because context can't *transport* state, but because it can't *slice* it.

---

## 6. Composing providers

```jsx
// ❌ the pyramid
<ThemeProvider>
  <AuthProvider>
    <QueryProvider>
      <RouterProvider>
        <App />

// ✅ compose them
const providers = [ThemeProvider, AuthProvider, QueryProvider, RouterProvider];

function AppProviders({ children }) {
  return providers.reduceRight((acc, P) => <P>{acc}</P>, children);
}
```

Order matters when one provider depends on another (e.g. an auth provider that needs the query client).

---

## 7. Context and Server Components

```jsx
// ❌ in a Next.js App Router Server Component
import { createContext } from 'react';
const C = createContext(null);      // createContext is not supported in RSC
```

Context requires a client runtime. In the App Router, providers must be Client Components (`'use client'`), and you typically place them in a `providers.tsx` wrapped around `{children}` in the root layout. Server Components below that boundary still render on the server — passing them through a client provider as `children` keeps them server-rendered. See the [Next.js section](/nextJS).

---

## 8. Performance checklist

```
□ Is the provider `value` memoised (or a primitive)?
□ Are the functions in it wrapped in useCallback (or defined outside)?
□ Is high-frequency state in its own context, separate from stable state?
□ Are state and dispatch split?
□ Is the provider mounted as low in the tree as possible?
□ Is the expensive subtree passed as `children` so it isn't re-created by the provider?
```

That last one:

```jsx
// ✅ children is created by App's parent, so the provider's own re-render
//    does not re-create the child elements
function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('light');
  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
```

---

## 🧠 Rapid-fire recall

1. When is `createContext`'s default value used?
2. Why doesn't `React.memo` prevent a re-render caused by a context change?
3. Trace the bug in `value={{user, setUser}}`.
4. Why split state and dispatch into separate contexts?
5. What can a store do that plain context cannot?
6. Give three good uses of context and three bad ones.
7. Why does passing the tree as `children` help a provider's performance?

<details>
<summary>Answers</summary>

1. Only when a consumer has no matching Provider anywhere above it. A Provider with `value={undefined}` gives consumers `undefined`, not the default.
2. `memo` compares props; context is a subscription on the fiber. When the provider value changes, React schedules an update on every consumer fiber directly, bypassing prop comparison.
3. The object literal is re-created on every render of the providing component, so its reference changes even when `user` doesn't — and every consumer in the subtree re-renders. Memoise the value.
4. `dispatch` is referentially stable for the component's lifetime, so write-only components subscribed to it never re-render when the state changes.
5. Selective subscription — a component can subscribe to a *slice* via a selector and re-render only when that slice changes. Context is all-or-nothing per context object.
6. Good: theme, current user/session, locale, feature flags, router state, DI of a client. Bad: high-frequency values like mouse/scroll/input, large multi-slice app state, and server data (use a cache library).
7. The elements in `children` are created by the provider's *parent*, so a provider-only re-render doesn't re-create them; React can bail out of re-rendering that subtree since the element references are unchanged.

</details>
