---
title: React
author: Tejas Nirala
---

# React

A complete path from *what is the DOM* to *why did React throw away my half-finished render* — written so that someone who has never opened a React file can read it end to end and genuinely understand how the library works, with nothing else open in another tab.

**Who this is for:**

- **You've never written React.** Start at page 1. Every concept is built in order, with no forward references you can't follow. The four prerequisite pages give you exactly the JavaScript you need — nothing more.
- **You've shipped React for three or four years.** Start at Part 3. Most working developers never learn the fiber architecture, the lane system, or why `key` resets state — and those are precisely the things that turn confusing bugs into obvious ones.

**How it's written:** the problem first, then the mechanism, then a traced example showing the state at each step, then the trap that bites people. Every page ends with **rapid-fire recall** questions and collapsible answers, so you can check whether it actually stuck.

**The bias:** understanding over memorisation. Where there's a choice between telling you *what to type* and telling you *why React does it that way*, this guide picks the second — because the API changes every two years and the architecture doesn't.

> Building an app with a server, routing and data loading? The [Next.js section](/nextJS) picks up where this one ends and assumes everything here.

---

## 📚 The curriculum

### Part 1 — Prerequisites

*The JavaScript and browser knowledge React is built on. Skip only if you're certain.*

| | Page | What it answers |
| :-- | :--- | :--- |
| 1 | **[The DOM & The Browser](./01-dom-and-the-browser.md)** | Reflow vs repaint, layout thrashing traced, event bubbling & delegation, why manual DOM code collapses |
| 2 | **[The JavaScript You Need](./02-javascript-you-need.md)** | Destructuring, the shallow-copy trap, mutating vs non-mutating array methods, `??` vs `\|\|` |
| 3 | **[Closures & Reference Identity](./03-closures-and-identity.md)** | The one page that explains every confusing hook bug — stale closures and `Object.is` |
| 4 | **[Async JavaScript & The Event Loop](./04-async-javascript-and-the-event-loop.md)** | Microtasks vs macrotasks, `AbortController`, the race condition every React app has |

### Part 2 — Core React

*Everything you need to build real components.*

| | Page | What it answers |
| :-- | :--- | :--- |
| 5 | **[Why React Exists](./05-why-react-exists.md)** | `UI = f(state)`, imperative vs declarative, why immutability is required |
| 6 | **[JSX & React Elements](./06-jsx-and-react-elements.md)** | What JSX compiles to, why components must be capitalised, what `{0 && …}` renders |
| 7 | **[Components & Props](./07-components-and-props.md)** | Purity and why React demands it, component *identity*, classes vs hooks |
| 8 | **[State & useState](./08-state-and-usestate.md)** | State as a snapshot, the update queue traced, structuring state so bugs are impossible |
| 9 | **[Events & Forms](./09-events-and-forms.md)** | Synthetic events & root delegation, controlled vs uncontrolled, a whole form done right |
| 10 | **[Lists & Keys](./10-lists-and-keys.md)** | The index-key disaster traced, `key` as a state-reset tool, virtualisation |
| 11 | **[Conditional Rendering & Styling](./11-conditional-rendering-and-styling.md)** | Unmount vs hide, CSS Modules / Tailwind / CSS-in-JS compared, animation |
| 12 | **[Lifting State & Data Flow](./12-lifting-state-and-data-flow.md)** | Where state should live, the controlled-component contract, prop drilling fixes in order |

### Part 3 — The Engine

*How React actually works. This is the part most developers never learn.*

| | Page | What it answers |
| :-- | :--- | :--- |
| 13 | **[The Render Pipeline & Fiber](./13-the-render-pipeline.md)** | Render vs commit, the fiber linked list, double buffering, one click traced end to end |
| 14 | **[Reconciliation & Diffing](./14-reconciliation-and-diffing.md)** | O(n³)→O(n), the two heuristics, `lastPlacedIndex`, why structure is identity |
| 15 | **[Batching, Lanes & The Scheduler](./15-batching-and-the-scheduler.md)** | Automatic batching, the lane bitmask, the 5ms slice, interruption traced |
| 16 | **[Concurrent React](./16-concurrent-react.md)** | Transitions, `useDeferredValue`, Suspense internals, Actions |
| 17 | **[StrictMode](./17-strict-mode.md)** | Why your effect runs twice, the bugs it catches, why you must not disable it |

### Part 4 — Hooks

| | Page | What it answers |
| :-- | :--- | :--- |
| 18 | **[How Hooks Work Internally](./18-how-hooks-work-internally.md)** | Build `useState` yourself in 15 lines; why the Rules of Hooks exist |
| 19 | **[useEffect](./19-useEffect.md)** | What effects are actually for, cleanup, and the effects you should delete |
| 20 | **[useLayoutEffect & Effect Timing](./20-useLayoutEffect-and-effect-timing.md)** | The complete commit ordering, the tooltip flicker, SSR |
| 21 | **[useRef](./21-useRef.md)** | DOM access, instance variables, `usePrevious`, `useImperativeHandle` |
| 22 | **[useMemo & useCallback](./22-useMemo-and-useCallback.md)** | The two real reasons to memoise, and the six times it does nothing |
| 23 | **[useReducer](./23-useReducer.md)** | Transitions in one pure function, action design, state machines |
| 24 | **[useContext](./24-useContext.md)** | The re-render rule, splitting contexts, what context can't do |
| 25 | **[Transition & Action Hooks](./25-concurrent-hooks.md)** | `useTransition`, `useDeferredValue`, `useOptimistic`, `useActionState` |
| 26 | **[The Remaining Built-in Hooks](./26-other-built-in-hooks.md)** | `useId`, `useSyncExternalStore` & tearing, `useDebugValue`, `use` |
| 27 | **[Custom Hooks](./27-custom-hooks.md)** | The ones you'll actually write, and how to design their APIs |
| 28 | **[Hook Pitfalls](./28-hook-pitfalls.md)** | Twenty real bugs, each traced, plus a debugging playbook |

### Part 5 — Patterns

| | Page | What it answers |
| :-- | :--- | :--- |
| 29 | **[Composition Patterns](./29-composition-patterns.md)** | Compound components, slots, `asChild`, "extract state, not markup" |
| 30 | **[Error Boundaries](./30-error-boundaries.md)** | What they catch, where to place them, recovery, logging |
| 31 | **[Portals, Modals & Accessibility](./31-portals-and-modals.md)** | Why portals exist, the full a11y checklist, native `<dialog>` |
| 32 | **[Suspense & Code Splitting](./32-suspense-and-code-splitting.md)** | `lazy`, preloading on hover, boundary placement, waterfalls |

### Part 6 — Data & State Management

| | Page | What it answers |
| :-- | :--- | :--- |
| 33 | **[Data Fetching Patterns](./33-data-fetching-patterns.md)** | The five bugs in the naive fetch, race conditions, fetch-on-render vs render-as-you-fetch |
| 34 | **[The State Management Landscape](./34-state-management-landscape.md)** | The five kinds of state, and the decision flowchart |
| 35 | **[Redux Toolkit](./35-redux-toolkit.md)** | `createSlice`, Immer, selector traps, RTK Query, entity adapters |
| 36 | **[TanStack Query](./36-react-query.md)** | `staleTime` vs `gcTime`, the cache lifecycle, optimistic updates |

### Part 7 — Performance & Production

| | Page | What it answers |
| :-- | :--- | :--- |
| 37 | **[What Causes Re-renders](./37-what-causes-rerenders.md)** | The four causes, the two structural fixes, `React.memo` as a last resort |
| 38 | **[The Performance Toolkit](./38-performance-toolkit.md)** | Core Web Vitals, bundle analysis, virtualisation, debounce/throttle, workers |
| 39 | **[Testing React](./39-testing-react.md)** | Testing Library, MSW, testing hooks, what not to test |
| 40 | **[TypeScript with React](./40-typescript-with-react.md)** | Prop contracts, discriminated unions, generic components, runtime validation |

### Part 8 — Interview Prep

| | Page | What it answers |
| :-- | :--- | :--- |
| 41 | **[Interview Questions & Answers](./41-interview-qa.md)** | Forty questions by level, answered the way you'd say them out loud |

---

## 🗺️ Suggested paths

**Complete beginner (2–3 weeks):**
Pages 1 → 12 in order, building something small after page 10. Then 19, 21, 22, 24, 27. Then Part 3 once components feel natural — it will land much better with real experience behind it.

**Working developer, 1–4 years (1 week):**
Part 3 (13–17) first — this is the material that reframes everything. Then 18, 28, 37. Then Part 6 for whichever data layer you use.

**Interview in three days:**
41 first to find your gaps, then 13, 14, 18, 37, 03. Those five pages cover most of what senior interviews actually probe.

**Debugging something right now:**
[Hook Pitfalls](./28-hook-pitfalls.md) has a symptom → cause table at the bottom.

---

## 🔍 Quick reference

| I want to… | Go to |
| :-- | :-- |
| Understand why my effect runs twice | [StrictMode](./17-strict-mode.md) |
| Fix a value that's "one render behind" | [Closures & Identity](./03-closures-and-identity.md), [State](./08-state-and-usestate.md) |
| Stop unnecessary re-renders | [What Causes Re-renders](./37-what-causes-rerenders.md) |
| Fetch data properly | [Data Fetching](./33-data-fetching-patterns.md), [TanStack Query](./36-react-query.md) |
| Decide where state lives | [Lifting State](./12-lifting-state-and-data-flow.md), [The Landscape](./34-state-management-landscape.md) |
| Understand `key` | [Lists & Keys](./10-lists-and-keys.md), [Reconciliation](./14-reconciliation-and-diffing.md) |
| Build an accessible modal | [Portals & Modals](./31-portals-and-modals.md) |
| Make a big list fast | [Performance Toolkit](./38-performance-toolkit.md) |
| Know what React 19 changed | [Concurrent React](./16-concurrent-react.md), [Transition & Action Hooks](./25-concurrent-hooks.md) |
