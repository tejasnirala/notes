---
title: Custom Hooks
author: Tejas Nirala
---

# Custom Hooks

A custom hook is a function whose name starts with `use` and which calls other hooks. That's the entire definition. What makes them powerful is what they *don't* do: they share **stateful logic**, not state, and they add zero levels to your component tree.

---

## 1. The rule that makes them work

```jsx
function useCounter(initial = 0) {
  const [count, setCount] = useState(initial);
  const increment = useCallback(() => setCount(c => c + 1), []);
  const reset     = useCallback(() => setCount(initial), [initial]);
  return { count, increment, reset };
}
```

Two components using it:

```jsx
function A() { const { count, increment } = useCounter(); }
function B() { const { count, increment } = useCounter(); }
```

```
A's fiber:  hooks[0] = 5     ← A's own count
B's fiber:  hooks[0] = 0     ← completely independent

The CODE is shared. The STATE is not.
```

This falls straight out of [how hooks work](./18-how-hooks-work-internally.md): hooks read from the fiber that is *currently rendering*, so a custom hook called from A stores its state on A's fiber.

If you want to share the *value*, you need lifted state, context or a store — not a custom hook.

---

## 2. Why custom hooks beat HOCs and render props

The pre-hooks ways of sharing stateful logic both distorted your tree.

```jsx
// HOC — wrapper hell, and prop origins become untraceable
export default withRouter(withTheme(withAuth(connect(mapState)(Component))));

// Render props — the "callback pyramid"
<Mouse>{mouse =>
  <Window>{win =>
    <Theme>{theme =>
      <Component {...mouse} {...win} {...theme} />
    }</Theme>}
  </Window>}
</Mouse>
```

```jsx
// Custom hooks — flat, explicit, no extra components
function Component() {
  const mouse = useMouse();
  const win   = useWindowSize();
  const theme = useTheme();
}
```

Concretely, you gained: no anonymous wrapper components in DevTools, no prop-name collisions between HOCs, obvious data origins, and full TypeScript inference.

---

## 3. A library of the ones you'll actually write

### `useToggle`

```jsx
function useToggle(initial = false) {
  const [value, setValue] = useState(initial);
  const toggle  = useCallback(() => setValue(v => !v), []);
  const setTrue = useCallback(() => setValue(true), []);
  const setFalse= useCallback(() => setValue(false), []);
  return { value, toggle, setTrue, setFalse };
}
```

### `useLocalStorage`

```jsx
function useLocalStorage(key, initialValue) {
  const [stored, setStored] = useState(() => {           // lazy: read once
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch { return initialValue; }                      // private mode, quota, bad JSON
  });

  const setValue = useCallback(value => {
    setStored(prev => {
      const next = value instanceof Function ? value(prev) : next;
      try { window.localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [key]);

  return [stored, setValue];
}
```

Note the defensive `try/catch` around both read and write: Safari private mode throws on `setItem`, and stored JSON can be corrupt. A hook that crashes the app on a bad cache entry is worse than no hook.

### `useDebounce`

```jsx
function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);       // ← the cleanup IS the debounce
  }, [value, delay]);
  return debounced;
}
```

### `useFetch` (with abort and correct states)

```jsx
function useFetch(url, options) {
  const [state, setState] = useState({ status: 'idle', data: null, error: null });

  useEffect(() => {
    if (!url) return;
    const ac = new AbortController();
    setState({ status: 'loading', data: null, error: null });

    fetch(url, { ...options, signal: ac.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => setState({ status: 'success', data, error: null }))
      .catch(error => {
        if (error.name === 'AbortError') return;            // expected on cleanup
        setState({ status: 'error', data: null, error });
      });

    return () => ac.abort();
  }, [url]);            // ⚠️ `options` deliberately omitted — see the trap below

  return state;
}
```

⚠️ **The `options` trap:** if a caller writes `useFetch(url, { headers })` with an inline object, `options` changes every render. Including it in the deps causes an infinite fetch loop; excluding it means option changes are ignored. This is exactly why you should use React Query instead for anything real ([React Query](./36-react-query.md)) — it solves caching, dedup, retry and invalidation too.

### `useEventListener`

```jsx
function useEventListener(eventName, handler, element = window) {
  const savedHandler = useRef(handler);
  useEffect(() => { savedHandler.current = handler; }, [handler]);   // always latest

  useEffect(() => {
    const target = element?.current ?? element;
    if (!target?.addEventListener) return;
    const listener = e => savedHandler.current(e);
    target.addEventListener(eventName, listener);
    return () => target.removeEventListener(eventName, listener);
  }, [eventName, element]);       // ✅ handler is NOT a dep → no re-subscribing
}
```

The ref indirection is the pattern from [useRef](./21-useRef.md): the listener stays subscribed across renders while always calling the newest handler.

### `useOnClickOutside`

```jsx
function useOnClickOutside(ref, handler) {
  useEffect(() => {
    const listener = e => {
      if (!ref.current || ref.current.contains(e.target)) return;
      handler(e);
    };
    document.addEventListener('mousedown', listener);      // mousedown, not click —
    document.addEventListener('touchstart', listener);     // avoids the "opened and
    return () => {                                          // instantly closed" race
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler]);
}
```

### `useIntersectionObserver` (lazy loading, infinite scroll)

```jsx
function useIntersectionObserver(ref, { threshold = 0, rootMargin = '0px' } = {}) {
  const [isIntersecting, setIsIntersecting] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsIntersecting(entry.isIntersecting),
      { threshold, rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, threshold, rootMargin]);      // primitives → stable deps ✅

  return isIntersecting;
}
```

Note the destructured primitives in the signature: taking `{threshold, rootMargin}` apart means the deps are numbers and strings, not an object that changes identity every render. **Designing a hook's parameters so its dependencies are primitives is a real API-design skill.**

### `useMediaQuery`

```jsx
const useMediaQuery = query => useSyncExternalStore(
  useCallback(cb => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', cb);
    return () => mql.removeEventListener('change', cb);
  }, [query]),
  () => window.matchMedia(query).matches,
  () => false                                        // SSR
);
```

---

## 4. Design rules

### a) Name it `use…` — this is load-bearing

The linter uses the prefix to enforce the Rules of Hooks. A function called `getWindowSize` that calls `useState` will not be checked, and violations will slip through.

### b) One concern per hook

```jsx
// ❌ a grab bag
function useEverything() { /* auth + theme + fetch + resize */ }

// ✅ compose small ones
function useUserDashboard(userId) {
  const user  = useUser(userId);
  const posts = usePosts(userId);
  const theme = useTheme();
  return { user, posts, theme };
}
```

### c) Return the shape that reads best at the call site

```jsx
return [value, setValue];             // array: caller names them (useState-like, 2 items)
return { data, error, isLoading };    // object: named, extensible, order-free (3+ items)
```

Rule of thumb: two symmetrical values → array; anything else → object.

### d) Take primitives; return stable references

```jsx
// ❌ an object parameter forces callers to memoise
useThing({ id, mode });

// ✅ primitives
useThing(id, mode);

// ✅ and stabilise what you return
const refresh = useCallback(() => {…}, [id]);
return { data, refresh };            // consumers can safely put `refresh` in deps
```

### e) Don't wrap a single hook for no reason

```jsx
// ❌ pure indirection
const useName = () => useState('');
```

### f) Custom hooks may return JSX, but usually shouldn't

If it renders, it's probably a component. A hook that returns both state and an element (`const [isOpen, modal] = useModal()`) is a legitimate pattern but hurts composability — prefer returning state and letting the caller render.

---

## 5. Testing custom hooks

```jsx
import { renderHook, act } from '@testing-library/react';

test('useCounter increments', () => {
  const { result } = renderHook(() => useCounter(5));

  expect(result.current.count).toBe(5);

  act(() => { result.current.increment(); });     // act flushes React's work

  expect(result.current.count).toBe(6);
});

test('reacts to prop changes', () => {
  const { result, rerender } = renderHook(({ v }) => useDebounce(v, 100), {
    initialProps: { v: 'a' },
  });
  rerender({ v: 'b' });
  expect(result.current).toBe('a');               // still the old value
  act(() => { jest.advanceTimersByTime(100); });
  expect(result.current).toBe('b');
});
```

`renderHook` mounts a throwaway component that calls your hook, so there's no need to invent a test component. See [Testing React](./39-testing-react.md).

---

## 6. Extraction: when and how

Extract a hook when:

- The same `useState` + `useEffect` pair appears in three places.
- A component's body has 30 lines of logic and 10 lines of JSX.
- You want to unit-test the logic without rendering the UI.
- The logic is genuinely a *concept* ("the online status", "a debounced value").

**Do not** extract just to shorten a component. A hook used once, in one place, with a name that only describes where it came from (`useProfilePageLogic`) is usually worse than the inline code — it hides the data flow without providing reuse.

**Refactor trace:**

```jsx
// before — logic and markup interleaved
function SearchPage() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => { const id = setTimeout(() => setDebounced(query), 300);
                    return () => clearTimeout(id); }, [query]);
  useEffect(() => { /* 15 lines of fetch + abort + error handling */ }, [debounced]);
  return <div>{/* markup */}</div>;
}

// after — the component is about the UI again
function SearchPage() {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  const { data: results, status } = useFetch(debounced ? `/api?q=${debounced}` : null);
  return <div>{/* markup */}</div>;
}
```

Four state variables and two effects became three lines, and both extracted hooks are independently testable and reusable.

---

## 🧠 Rapid-fire recall

1. Do two components using the same custom hook share state? Why or why not?
2. What two problems did custom hooks solve that HOCs and render props did not?
3. Why must a custom hook's name start with `use`?
4. Why does `useEventListener` keep the handler in a ref?
5. Why should a hook's parameters be primitives where possible?
6. When should you return an array vs an object?
7. Give two signals that logic should become a custom hook, and one signal that it shouldn't.

<details>
<summary>Answers</summary>

1. No. Hooks store data on the fiber that is currently rendering, so each calling component gets its own independent hook slots. Only the logic is shared.
2. Wrapper hell (extra components in the tree, prop-name collisions, untraceable prop origins) and poor composability/typing. Custom hooks are flat function calls with full inference.
3. The ESLint plugin uses the prefix to identify hook-calling functions and enforce the Rules of Hooks; without it, violations go unchecked.
4. So the effect can subscribe once (with the handler excluded from its dependencies) while still invoking the newest handler on every event — avoiding a resubscribe on every parent render.
5. Because dependency arrays compare with `Object.is`; object parameters created inline change identity every render, forcing consumers to memoise or causing effects to re-run endlessly.
6. Array for exactly two symmetrical values the caller will want to rename (`useState`-like); object for three or more, or when the set may grow.
7. Extract when the same state+effect pair repeats in several places, or when the logic is a nameable concept you want to test alone. Don't extract a one-off just to shorten a component — it hides data flow without gaining reuse.

</details>
