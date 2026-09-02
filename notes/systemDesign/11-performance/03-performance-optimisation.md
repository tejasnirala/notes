---
title: Performance Optimisation
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Performance Optimisation

> **What you will be able to do after this page**
>
> - Find where time actually goes, rather than where you assume it goes.
> - Apply the optimisations that matter, in order of value.
> - Use Amdahl's Law to decide whether an optimisation is worth doing at all.
> - Recognise the optimisations that make things slower.

<C color="orange">Almost all optimisation effort is spent in the wrong place</C>, because the intuition about where a program spends its time is reliably wrong.

<Plain>

A parcel takes four days to arrive, and you want it faster.

The instinct is to make the van go quicker. But break the four days down and the picture changes completely:

- **In the warehouse waiting to be picked:** 2 days
- **Being sorted:** 1 day
- **Actually in the van:** 4 hours
- **Everything else:** the rest

Doubling the van's speed saves two hours out of ninety-six. <C color="crimson">You could make the van infinitely fast and the parcel still takes over three days.</C>

Meanwhile, reducing the warehouse wait from two days to two hours cuts the total nearly in half — and it probably has nothing to do with vehicles at all. It is a queue.

Two lessons, and they are the whole of this page.

**Measure before changing anything.** The van felt like the slow part because it is the visible part. The warehouse was invisible and it was where the time went.

**There is a ceiling on any single improvement.** However fast the van becomes, the other three and a half days remain. <C color="orange">The most you can ever gain is the fraction you are actually working on</C> — which is worth calculating before you start.

</Plain>

---

## 1. Measure first

<Jargon
  plain="Recording where a program actually spends its time, rather than reasoning about it."
  term="profiling"
  also={['CPU profile', 'flame graph', 'tracing']}>

<C color="crimson">Profiling regularly contradicts expert intuition</C>, including your own about code you wrote. The time is frequently in serialisation, logging, or waiting for a lock — never where the interesting algorithm is.

</Jargon>

| Tool | Answers |
| :--- | :--- |
| **Distributed tracing** | Which *service* the time is in — start here |
| **Flame graph** | Which *function* the CPU is in |
| **Database slow query log** | Which queries, how often, how long |
| **`EXPLAIN ANALYZE`** | Why one query is slow |
| **APM / RUM** | What users actually experience, end to end |
| **Allocation profiler** | GC pressure and memory churn |

<H>Work outside-in: trace to find the service, profile to find the function, then optimise. Starting with a profiler on a service that was not the problem is the most common way to waste a week.</H>

---

## 2. The optimisations that matter, in order

<Trace title="A 2.4-second endpoint" subtitle="Each optimisation applied in order of value. Watch what actually moves.">

<TraceStep
  title="Trace the request"
  state={{ 'Total': '2,400 ms', 'DB queries': '1,240 ms', 'External API': '800 ms', 'Serialisation': '210 ms', 'App logic': '150 ms' }}
  changed={['Total', 'DB queries', 'External API']}
  note="App logic — the code everyone was about to optimise — is 6% of the total.">

The trace attributes the time. <C color="crimson">Optimising the application logic could save at most 150 ms of 2,400.</C>

</TraceStep>

<TraceStep
  title="Fix the N+1"
  cost="−980 ms"
  state={{ 'Total': '1,420 ms', 'DB queries': '260 ms', 'External API': '800 ms', 'Serialisation': '210 ms', 'DB round trips': '61 → 3' }}
  changed={['Total', 'DB queries', 'DB round trips']}
  note="The single highest-value optimisation at any layer: turn N round trips into one.">

Sixty-one queries — one list plus one per item. Batched into three.

<C color="green">41% of total latency removed by a single change.</C>

</TraceStep>

<TraceStep
  title="Parallelise independent calls"
  cost="−500 ms"
  state={{ 'Total': '920 ms', 'DB queries': '260 ms', 'External API': '300 ms', 'Serialisation': '210 ms', 'Calls': 'sequential → parallel' }}
  changed={['Total', 'External API', 'Calls']}
  note="Three sequential 300 ms calls that had no dependency on each other.">

The external calls were awaited one after another. Run concurrently, the cost becomes the slowest rather than the sum.

</TraceStep>

<TraceStep
  title="Cache the external response"
  cost="−285 ms"
  state={{ 'Total': '635 ms', 'External API': '15 ms (cached)', 'Serialisation': '210 ms', 'Cache hit ratio': '95%' }}
  changed={['Total', 'External API', 'Cache hit ratio']}
  note="The data changes hourly and was being fetched on every request.">

A 5-minute TTL takes the external call off 95% of requests.

</TraceStep>

<TraceStep
  title="Now serialisation dominates"
  state={{ 'Total': '635 ms', 'Serialisation': '210 ms (33%)', 'DB queries': '260 ms', 'Next target': 'payload size' }}
  changed={['Serialisation', 'Next target']}
  note="The bottleneck moved — which is the expected outcome of every successful optimisation.">

<C color="orange">Serialisation was 9% of the original total and is now 33%.</C> It became worth attention only after the larger costs were removed.

The response returns 400 fields where the client uses 12.

</TraceStep>

<TraceStep
  title="Trim the payload, then stop"
  cost="−150 ms"
  state={{ 'Total': '485 ms', 'Serialisation': '60 ms', 'App logic': '150 ms (31%)', 'Improvement': '5× faster' }}
  changed={['Total', 'Serialisation', 'App logic', 'Improvement']}
  note="App logic is now the largest single item — and optimising it can save at most 150 ms.">

<H>2,400 ms → 485 ms, and not one line of the application logic was touched. Every gain came from removing round trips, parallelising, caching, and sending less data.</H>

</TraceStep>

</Trace>

**The ranking, generalised:**

| Rank | Optimisation | Typical gain |
| :--- | :--- | :--- |
| 1 | <C color="green">Remove N+1 round trips</C> | Often 2–50× |
| 2 | <C color="green">Add a missing index</C> | Often 10–1000× |
| 3 | <C color="green">Parallelise independent calls</C> | Up to the number of calls |
| 4 | <C color="green">Cache</C> | Proportional to hit ratio |
| 5 | <C color="green">Send less data</C> | Proportional to reduction |
| 6 | Batch writes | Large for write-heavy paths |
| 7 | Connection pooling | Removes a round trip per request |
| 8 | Better algorithms | Occasionally decisive, usually not |
| 9 | Micro-optimising hot code | <C color="crimson">Rarely worth it</C> |

<C color="orange">Note that the top five are all about **round trips and data volume**, not computation.</C> In a distributed system, the work is almost never the bottleneck — the waiting is.

---

## 3. Amdahl's Law

<Jargon
  plain="The most you can speed up a system is limited by the fraction you are not improving."
  term="Amdahl's Law"
  also={['the speedup limit']}>

```
  speedup = 1 / ((1 − p) + p/s)

  p = fraction of time in the part you improve
  s = how much faster you make that part
```

</Jargon>

The consequence is worth internalising:

```
  Optimise a part taking 30% of time, making it 10× faster:
    speedup = 1 / (0.7 + 0.03) = 1.37×      ← 37%, not 900%

  Make that same part INFINITELY fast:
    speedup = 1 / 0.7 = 1.43×               ← the hard ceiling
```

<C color="crimson">A component consuming 30% of your time can never yield more than a 43% improvement, no matter what you do to it.</C> Calculate this *before* starting — it routinely shows that a week of work has a 5% ceiling.

<H>The corollary: always optimise the largest contributor, and re-measure afterwards, because the largest contributor has changed.</H>

---

## 4. Optimisations that make things worse

<Depth title="When making something faster makes the system slower">

**Caching something already fast.** A primary-key lookup on a cached index page costs ~0.1 ms. Putting Redis in front adds a ~1 ms network round trip. <C color="crimson">You made it 10× slower and added an invalidation bug.</C> Always measure before caching.

**Adding indexes indiscriminately.** Every index is written on every insert and update. Eight indexes means nine writes per row. <C color="crimson">A read optimisation that halves write throughput</C> may be a net loss, and unused indexes are pure cost.

**Batching on a latency-sensitive path.** Batching improves throughput by *waiting* for more items. On a user-facing read, that wait is added latency for no benefit to the person waiting.

**Too much parallelism.** Beyond the point where the resource saturates, more concurrency adds context switching, lock contention and memory pressure while throughput flattens or falls. Parallelising 200 database calls against a 50-connection pool means 150 of them wait — <C color="orange">you converted a sequential wait into a queueing wait and added overhead.</C>

**Premature denormalization.** Duplicating data to avoid a join that costs 0.3 ms, in exchange for a permanent write-amplification cost, a background sync job, a reconciliation job, and a class of bug where copies disagree.

**Optimising for the average.** Cutting the mean by improving the fast path while the tail worsens makes user experience *worse*, because [users experience the tail](./01-latency-and-throughput.md). Always check p99 alongside the mean.

**Micro-optimisation that defeats the optimiser or the reader.** Hand-unrolled loops, clever bit tricks and manual inlining frequently perform worse than the straightforward version — modern compilers and JITs optimise idiomatic code best — while making the code harder to change. <C color="crimson">The cost is paid by every future reader; the benefit is usually unmeasurable.</C>

**The general test before any optimisation, worth writing down:**

| Question | If you cannot answer it |
| :--- | :--- |
| What fraction of time is this? | <C color="crimson">Do not start — measure first</C> |
| What is the Amdahl ceiling? | <C color="crimson">You cannot judge whether it is worth doing</C> |
| What does this cost — write path, memory, complexity, correctness? | <C color="crimson">You are only counting the benefit</C> |
| How will I verify the improvement? | <C color="crimson">You will not know whether it worked</C> |

<H>Knuth's line about premature optimisation is usually quoted as an excuse to ignore performance. The actual point is narrower and more useful: optimise deliberately, in the place the measurement points at, having calculated what the best case is worth.</H>

</Depth>

---

## 5. In a design discussion

- **"Trace first, then profile. The application logic is usually a small fraction — the time is in round trips and waiting."** The outside-in method.
- **"Amdahl: that component is 30% of the time, so even making it infinite gains 43%. Not where I would spend the week."** Prices the work before doing it.
- **"Fix the N+1 before anything else — 61 round trips to 3 is usually the single biggest win available."** The highest-value optimisation named.
- **"I would not cache that query. It is 0.1 ms warm, and a Redis round trip is 1 ms — we would make it slower and add an invalidation bug."** Avoids the reflex.

---

## Rapid-fire recall

1. Why is intuition about where time goes unreliable?
2. What is the correct order of tools, and why outside-in?
3. In the trace, what fraction was application logic, and what actually produced the gains?
4. Rank the top five optimisations, and say what they have in common.
5. State Amdahl's Law and compute the ceiling for a component at 30% of runtime.
6. Why must you re-measure after every optimisation?
7. When does caching make something slower?
8. How can adding an index reduce overall performance?
9. Why can too much parallelism reduce throughput?
10. Why is optimising the average potentially harmful?

<details>
<summary>Answers</summary>

1. Because the visible, interesting part of the code is rarely where the time goes. Profiling regularly finds time in **serialisation, logging, lock waits and round trips** — not in the algorithm anyone was thinking about.
2. **Distributed tracing** (which service) → **profiler/flame graph** (which function) → **`EXPLAIN ANALYZE`** (why that query). Outside-in, because profiling a service that was not the bottleneck wastes the entire effort.
3. Application logic was **6%** (150 ms of 2,400). The gains came from **removing N+1 round trips**, **parallelising independent calls**, **caching an external response**, and **trimming the payload** — no logic was changed.
4. **Remove N+1 round trips** · **add a missing index** · **parallelise independent calls** · **cache** · **send less data**. They are all about **round trips and data volume**, not computation — in a distributed system the waiting dominates the work.
5. `speedup = 1 / ((1 − p) + p/s)`. At `p = 0.3`, even with `s → ∞` the ceiling is `1 / 0.7 = **1.43×**` — a 43% maximum improvement.
6. Because the **bottleneck moves**. In the trace, serialisation went from 9% of the total to 33% without changing at all — it became the right target only after the larger costs were removed.
7. When the underlying operation is **already faster than the cache round trip** — a 0.1 ms warm index lookup behind a 1 ms Redis call is 10× slower, plus a new invalidation bug.
8. Because **every index is written on every insert and update**. Eight indexes means nine writes per row, so a read optimisation can halve write throughput — and unused indexes are pure cost.
9. Beyond resource saturation, extra concurrency adds **context switching, lock contention and memory pressure** while throughput flattens. Parallelising 200 calls against a 50-connection pool just converts a sequential wait into a queueing wait plus overhead.
10. Because **users experience the tail**, not the mean. Improving the fast path can lower the average while p99 worsens, making the actual user experience worse despite a better headline number.

</details>

---

**Next:** [Authentication](../12-security/01-authentication.md) — proving who someone is.
