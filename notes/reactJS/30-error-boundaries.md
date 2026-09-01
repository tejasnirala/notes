---
title: Error Boundaries
author: Tejas Nirala
---

# Error Boundaries

Without a boundary, one thrown error during render unmounts your **entire application** — React 16 deliberately made that the default, on the grounds that a corrupted UI is worse than no UI. An error boundary is how you contain the damage.

---

## 1. What they catch, and what they don't

```jsx
class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };                      // render phase: update state to show a fallback
  }

  componentDidCatch(error, errorInfo) {
    logToService(error, errorInfo.componentStack);   // commit phase: side effects
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? <p>Something went wrong.</p>;
    }
    return this.props.children;
  }
}
```

**Caught:**

```
✅ errors thrown during render of any descendant
✅ errors in lifecycle methods
✅ errors in constructors
✅ errors thrown by a child's render logic
```

**Not caught:**

```
❌ event handlers            → use try/catch
❌ async code (setTimeout, promises, fetch .then)
❌ server-side rendering
❌ errors thrown in the boundary component ITSELF
```

The reason for the async exclusion: by the time the callback runs, React isn't rendering — there's no component on the stack to attribute the error to.

```jsx
// ❌ not caught by a boundary
<button onClick={() => { throw new Error('x'); }} />

// ✅ handle it yourself, and route it into state if you want the fallback UI
function Component() {
  const [error, setError] = useState(null);
  if (error) throw error;                          // rethrow DURING RENDER → now caught
  return <button onClick={async () => {
    try { await save(); } catch (e) { setError(e); }
  }} />;
}
```

That "store it in state and throw during render" trick is exactly what `react-error-boundary`'s `useErrorBoundary` hook does.

---

## 2. Why they must be classes

There is no hook equivalent. `getDerivedStateFromError` runs during the render phase, on a component that is *not currently rendering* — it's invoked by the reconciler on the boundary while unwinding from a child's throw. Hooks have no way to express "receive an error thrown by a descendant".

In practice, use the library:

```jsx
import { ErrorBoundary } from 'react-error-boundary';

<ErrorBoundary
  FallbackComponent={ErrorFallback}
  onError={(error, info) => logToService(error, info)}
  onReset={() => queryClient.clear()}
  resetKeys={[userId]}                    // auto-reset when this changes
>
  <Profile userId={userId} />
</ErrorBoundary>

function ErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div role="alert">
      <p>Something went wrong:</p>
      <pre>{error.message}</pre>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
}
```

---

## 3. Placement strategy

A boundary protects everything **below** it. Placement is a product decision: what should still work when this part breaks?

```jsx
<ErrorBoundary fallback={<FullPageError />}>          {/* last resort */}
  <App>
    <Header />                                         {/* nav must survive */}
    <ErrorBoundary fallback={<SectionError />}>
      <Feed />                                         {/* a broken feed shouldn't kill nav */}
    </ErrorBoundary>
    <ErrorBoundary fallback={null}>
      <ThirdPartyWidget />                             {/* fail silently */}
    </ErrorBoundary>
  </App>
</ErrorBoundary>
```

```
             ┌──────────────── Root boundary ─────────────────┐
             │  Header (always renders)                       │
             │  ┌────── Feed boundary ──────┐                 │
             │  │ Feed  ← throws here       │ → SectionError  │
             │  └───────────────────────────┘   Header & the  │
             │  ┌────── Widget boundary ────┐   rest still    │
             │  │ ThirdPartyWidget          │   work ✅        │
             │  └───────────────────────────┘                 │
             └───────────────────────────────────────────────┘
```

Guidance:

- **One at the root** — always. It's the difference between an error page and a white screen.
- **One per route** — a broken page shouldn't take down the shell.
- **Around anything third-party or user-generated** — widgets, embeds, markdown renderers, charts.
- **Around independently-failing sections** — a sidebar, a recommendations panel.

Don't wrap every component: too granular means every fallback is a tiny broken box, and you lose the signal that something is seriously wrong.

---

## 4. Recovery

A boundary that only says "something went wrong" is a dead end. Give the user a way out.

```jsx
<ErrorBoundary
  resetKeys={[location.pathname]}     // navigating away clears the error
  onReset={() => {
    queryClient.resetQueries();       // clear any poisoned cache
  }}
  FallbackComponent={({ error, resetErrorBoundary }) => (
    <div role="alert">
      <h2>This section failed to load</h2>
      <button onClick={resetErrorBoundary}>Retry</button>
      <a href="/">Go home</a>
    </div>
  )}
>
```

**Beware the retry loop:** if the error is deterministic (a null field in the data), resetting re-renders, re-throws, and the user sees a flicker forever. Cap the attempts:

```jsx
const [attempts, setAttempts] = useState(0);
// after 2 retries, show "contact support" instead of a retry button
```

---

## 5. Logging: `componentStack` is the valuable part

```jsx
componentDidCatch(error, errorInfo) {
  Sentry.captureException(error, {
    contexts: { react: { componentStack: errorInfo.componentStack } },
  });
}
```

```
The error message tells you WHAT.
errorInfo.componentStack tells you WHERE in your component tree:

    in Post (at Feed.jsx:24)
    in Feed (at Home.jsx:12)
    in ErrorBoundary (at App.jsx:8)
```

That stack is often the only way to identify *which* item in a list of 200 had the bad data.

React 19 adds root-level hooks for this, which catch errors even without a boundary:

```jsx
createRoot(container, {
  onUncaughtError:  (error, info) => log('uncaught', error, info),
  onCaughtError:    (error, info) => log('caught by a boundary', error, info),
  onRecoverableError: (error, info) => log('recovered (e.g. hydration)', error, info),
});
```

---

## 6. Error boundaries + Suspense

They compose: Suspense handles "not ready yet", the boundary handles "it failed".

```jsx
<ErrorBoundary fallback={<Failed />}>
  <Suspense fallback={<Skeleton />}>
    <AsyncProfile />
  </Suspense>
</ErrorBoundary>
```

```
component suspends  → Suspense shows <Skeleton/>
promise rejects     → the rejection surfaces as a throw during render
                    → the error boundary shows <Failed/>
```

Order matters: the boundary must be **outside** the Suspense boundary, otherwise a failed load replaces the fallback rather than the whole section.

---

## 7. Development vs production

In development, React shows the error overlay *and* calls your boundary — so you'll see both. That's intentional: you get the stack trace while still verifying your fallback works.

In production the overlay is gone and only your fallback renders. **Test the fallback deliberately**:

```jsx
function Bomb({ shouldThrow }) {
  if (shouldThrow) throw new Error('💣');
  return null;
}
// in a test, or behind a dev-only query param
```

An untested error boundary is very often itself broken (a fallback that reads `error.response.data.message` and throws on a network error, taking down the boundary too).

---

## 🧠 Rapid-fire recall

1. What happens with no error boundary when a component throws during render?
2. List four kinds of error boundaries do not catch.
3. How do you route an event-handler error into a boundary?
4. Why can't error boundaries be function components?
5. What's the difference between `getDerivedStateFromError` and `componentDidCatch`?
6. Where should a boundary sit relative to a Suspense boundary, and why?
7. Why is `errorInfo.componentStack` more useful than the JS stack trace?

<details>
<summary>Answers</summary>

1. React unmounts the entire tree — the user gets a blank page — on the principle that a corrupted UI is worse than none.
2. Event handlers, asynchronous code (timers, promises, `.then`), server-side rendering, and errors thrown by the boundary component itself.
3. Catch it yourself, store it in state, and `throw` it during the next render (`if (error) throw error;`) — or use `react-error-boundary`'s `useErrorBoundary`.
4. `getDerivedStateFromError` is invoked by the reconciler on the boundary while unwinding from a descendant's throw — a component that isn't itself rendering. Hooks can't express receiving a descendant's error.
5. `getDerivedStateFromError` runs during the render phase and must be pure — it returns the new state that shows the fallback. `componentDidCatch` runs in the commit phase and is where side effects like logging belong.
6. Outside it. Then a rejected load replaces the whole section with the error UI; inside, the error would only replace the Suspense fallback, leaving a confusing partial state.
7. It names the chain of your components leading to the failure, which is often the only way to identify which item or route produced the bad data — the JS stack usually shows only minified framework frames.

</details>
