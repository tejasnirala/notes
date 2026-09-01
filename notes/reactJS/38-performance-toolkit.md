---
title: The Performance Toolkit
author: Tejas Nirala
---

# The Performance Toolkit

Everything beyond re-render counting: measuring what users actually experience, cutting bundle size, keeping long lists cheap, and the JavaScript-level techniques (debounce, throttle, workers) that keep the main thread free.

---

## 1. Measure the right things

Optimising render counts while your bundle is 2MB is fixing the wrong problem. The user-facing metrics, and what each is actually about:

| Metric | Target | What it measures | Usual cause of failure |
| :-- | :-- | :-- | :-- |
| **LCP** Largest Contentful Paint | < 2.5s | when the main content appears | huge images, slow server, render-blocking JS |
| **INP** Interaction to Next Paint | < 200ms | responsiveness to clicks/taps | long tasks, expensive renders |
| **CLS** Cumulative Layout Shift | < 0.1 | visual stability | images without dimensions, injected banners |
| **TTFB** | < 800ms | server response | backend, no caching, cold starts |
| **TBT** Total Blocking Time | < 200ms | main-thread blocking | too much JS, long tasks |

```bash
npx lighthouse https://yoursite.com --view      # lab data
```

```jsx
import { onLCP, onINP, onCLS } from 'web-vitals';
onLCP(m => analytics.send(m));                   // field data — what real users get
onINP(m => analytics.send(m));
onCLS(m => analytics.send(m));
```

Lab data (Lighthouse, your laptop) and field data (real users, real devices) diverge dramatically. Trust the field data; use the lab to iterate.

**Always test with throttling on.** DevTools → Performance → CPU 4× or 6× slowdown, network Fast 3G. Your M-series laptop is not the target device.

---

## 2. Bundle size

Bytes are only half the cost — parse and execute time is often worse, and it's all main-thread.

```bash
npx vite-bundle-visualizer                   # Vite
ANALYZE=true next build                      # Next.js
npx source-map-explorer 'build/static/js/*'  # CRA
```

What to look for:

```jsx
// 1. Whole-library imports
import _ from 'lodash';                  // ❌ 70 KB
import debounce from 'lodash/debounce';  // ✅ 2 KB
import { debounce } from 'lodash-es';    // ✅ tree-shakeable

// 2. Heavy date libraries
import moment from 'moment';             // ❌ 70 KB + all locales
import { format } from 'date-fns';       // ✅ tree-shakeable
// or Intl.DateTimeFormat — 0 KB, built into the browser

// 3. Icon libraries imported wholesale
import * as Icons from 'react-icons';    // ❌
import { FiUser } from 'react-icons/fi'; // ✅

// 4. Duplicate dependencies at different versions
npm ls react                              // two copies = double the bundle AND hook errors
```

Then code-split by route and by heavy component ([Suspense & Code Splitting](./32-suspense-and-code-splitting.md)).

---

## 3. Images: usually the biggest single win

```jsx
<img
  src="/hero.webp"
  srcSet="/hero-400.webp 400w, /hero-800.webp 800w, /hero-1600.webp 1600w"
  sizes="(max-width: 600px) 400px, 800px"
  width={800} height={600}          {/* ← prevents layout shift (CLS) */}
  loading="lazy"                    {/* not on the LCP image! */}
  decoding="async"
  alt="…"
/>
```

- Modern formats: AVIF or WebP over JPEG/PNG — typically 30–50% smaller.
- **Always** set `width`/`height` (or `aspect-ratio`): the browser reserves space and nothing jumps.
- `loading="lazy"` on below-the-fold images only. On the LCP image it *delays* your worst metric.
- Preload the LCP image: `<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">`.

Next.js's `<Image>` does most of this automatically ([Next.js](/nextJS)).

---

## 4. Long lists: virtualise

```jsx
import { useVirtualizer } from '@tanstack/react-virtual';

function List({ rows }) {
  const parentRef = useRef(null);
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 5,
  });

  return (
    <div ref={parentRef} style={{ height: 600, overflow: 'auto' }}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map(item => (
          <div key={rows[item.index].id}
               style={{ position: 'absolute', top: 0, left: 0, width: '100%',
                        height: item.size, transform: `translateY(${item.start}px)` }}>
            <Row row={rows[item.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

```
10,000 rows without virtualisation:  10,000 fibers, 10,000 DOM nodes, ~3s initial render
10,000 rows with virtualisation:     ~18 fibers, ~18 DOM nodes, ~5ms
```

Rules: use `transform` for positioning (compositor-only, no layout), keep the spacer's total height accurate so the scrollbar is right, and keep `overscan` small (3–10).

---

## 5. Debouncing and throttling

Two different tools for two different problems.

```
Events:      ●●●●●●●●        ●●●●        ●
             ────────────────────────────────────▶ time

Debounce:                 ▲                    ▲    (fires after silence)
Throttle:    ▲   ▲   ▲    ▲   ▲   ▲            ▲    (fires at most every N ms)
```

```js
function debounce(fn, delay) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);                                  // ← cancel the pending call
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

function throttle(fn, limit) {
  let waiting = false, lastArgs = null;
  return (...args) => {
    if (waiting) { lastArgs = args; return; }             // ← remember the last call
    fn(...args);
    waiting = true;
    setTimeout(() => {
      waiting = false;
      if (lastArgs) { fn(...lastArgs); lastArgs = null; } // trailing call
    }, limit);
  };
}
```

| | Debounce | Throttle |
| :-- | :-- | :-- |
| Fires | after activity **stops** | at a steady maximum rate |
| Use for | search-as-you-type, autosave, resize-end, validation | scroll handlers, mousemove, drag, infinite-scroll triggers |
| Risk | never fires if the user never pauses | still fires often; must be cheap |

### In React

```jsx
// ❌ recreated every render → the timer is never shared, so it never debounces
const handleSearch = debounce(q => search(q), 300);

// ✅ stable across renders, with cleanup
function useDebouncedCallback(fn, delay) {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; }, [fn]);

  const debounced = useMemo(
    () => debounce((...args) => fnRef.current(...args), delay),
    [delay]
  );
  useEffect(() => () => debounced.cancel(), [debounced]);   // cancel on unmount
  return debounced;
}
```

Often the debounced *value* is simpler than a debounced callback:

```jsx
const debouncedQuery = useDebounce(query, 300);
useEffect(() => { search(debouncedQuery); }, [debouncedQuery]);
```

And for the *rendering* half of the problem, `useDeferredValue` is the React-native answer ([Concurrent Hooks](./25-concurrent-hooks.md)).

---

## 6. Getting work off the main thread

```jsx
// Web Worker — for genuinely CPU-heavy work (parsing, crypto, image processing)
const worker = useMemo(() => new Worker(new URL('./worker.js', import.meta.url)), []);

useEffect(() => {
  worker.onmessage = e => setResult(e.data);
  return () => worker.terminate();
}, [worker]);

worker.postMessage(hugeDataset);      // the main thread stays free ✅
```

```js
// requestIdleCallback — low-priority work in the browser's spare time
requestIdleCallback(deadline => {
  while (deadline.timeRemaining() > 0 && queue.length) process(queue.pop());
});
```

Rule of thumb: anything over ~50ms of pure computation belongs in a worker. Transitions make a *render* interruptible; they don't help with one long synchronous function.

---

## 7. Rendering cost checklist

```
□ Are lists over ~100 items virtualised?
□ Are heavy computations behind useMemo (with a measurement to justify it)?
□ Is state as low in the tree as it can go?
□ Are context values memoised and split by change frequency?
□ Are expensive subtrees passed as `children`?
□ Are images sized, lazy (below the fold) and in a modern format?
□ Are routes code-split, and preloaded on hover?
□ Are non-urgent updates wrapped in a transition?
□ Are you shipping a PRODUCTION React build?  (DevTools icon: black, not red)
```

That last one catches an embarrassing number of "React is slow" reports.

---

## 8. Anti-patterns

```jsx
// ❌ memoising everything on principle
const x = useMemo(() => a + b, [a, b]);
const Everything = React.memo(EverySingleComponent);
// → more comparisons, more memory, more complexity, no measured gain

// ❌ optimising before measuring
// ❌ optimising development-build performance
// ❌ animating layout properties
el.style.left = x + 'px';                     // reflow every frame
el.style.transform = `translateX(${x}px)`;    // ✅ compositor only

// ❌ big synchronous work in an event handler
onClick={() => { heavyCompute(); }}           // blocks the click's paint
onClick={() => { startTransition(heavyStateUpdate); }}  // ✅ for renders
// (for pure computation, use a worker)

// ❌ subscribing to scroll/mousemove without throttling
```

---

## 🧠 Rapid-fire recall

1. Name the three Core Web Vitals and what each measures.
2. Why is bundle *parse* time often worse than download time?
3. What two attributes on `<img>` prevent layout shift, and when must you not use `loading="lazy"`?
4. Draw the difference between debounce and throttle, and give a use case for each.
5. Why does `const fn = debounce(f, 300)` inside a component not work?
6. What does virtualisation change about fiber and DOM node counts?
7. When is a Web Worker the right tool rather than `useTransition`?

<details>
<summary>Answers</summary>

1. LCP (when the main content appears, < 2.5s), INP (responsiveness to interactions, < 200ms), CLS (visual stability, < 0.1).
2. Parsing and executing JavaScript is main-thread work that blocks rendering and input; on a mid-range phone roughly 1MB of JS can cost a second or more, whereas bytes can at least arrive in parallel.
3. `width` and `height` (or `aspect-ratio`) so the browser reserves space. Never use `loading="lazy"` on the LCP image — it delays exactly the metric you're trying to improve.
4. Debounce fires once after activity stops (search-as-you-type, autosave, resize-end). Throttle fires at most every N ms during activity (scroll, mousemove, drag).
5. A new debounced function is created on every render, each with its own timer, so no call ever cancels a previous one. Wrap it in `useMemo` (with a ref for the latest callback) and cancel it on unmount.
6. Both drop from O(all rows) to O(visible rows + overscan) — thousands of fibers and DOM nodes become a couple of dozen, with a spacer element preserving scroll height.
7. When the work is one long synchronous computation. Transitions make React's *render* interruptible; they can't break up a single blocking function. Over ~50ms of pure computation belongs off the main thread.

</details>
