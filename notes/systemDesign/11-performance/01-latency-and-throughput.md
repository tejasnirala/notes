---
title: Latency and Throughput
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Latency and Throughput

> **What you will be able to do after this page**
>
> - Say why improving one of these can make the other worse.
> - Use Little's Law to size concurrency from measurements you already have.
> - Explain why tail latency, not average latency, is what users experience.
> - Recognise the point where adding load stops adding throughput.

Two numbers that get conflated constantly. <C color="orange">They are related by a simple law, and optimising for one at the expense of the other is a decision you should make deliberately.</C>

<Plain>

A coffee shop can be described two ways.

**How long one customer waits** — order to cup in hand. Four minutes.

**How many customers are served per hour** — ninety.

They sound like the same thing measured differently. They are not, and you can improve either at the expense of the other.

Suppose the barista starts making four drinks at once instead of one at a time. <C color="green">More customers per hour</C> — and each individual customer now waits slightly longer, because their drink is being made alongside three others rather than getting undivided attention.

Or the barista could serve strictly one at a time, giving each their full attention. <C color="green">Each individual is served faster</C>, and fewer people get served overall.

Neither is wrong. A busy station optimises for throughput; a specialist shop optimises for the individual experience.

There is a third number that matters more than either, and it is the one shops forget. <C color="crimson">The *average* wait is four minutes, and one customer in a hundred waits twenty-five.</C> That person is the one who complains, tells other people, and does not come back — and they are completely invisible in the average.

</Plain>

---

## 1. The definitions, and the tension

| | Definition | Unit |
| :--- | :--- | :--- |
| **Latency** | Time for one operation to complete | ms |
| **Throughput** | Operations completed per unit time | ops/s |

<C color="crimson">They are not reciprocals.</C> A system with 100 ms latency does not necessarily do 10 ops/s — with 50 concurrent workers it does 500 ops/s while each operation still takes 100 ms.

**Where they trade against each other:**

| Technique | Throughput | Latency |
| :--- | :--- | :--- |
| Batching | <C color="green">Up</C> | <C color="crimson">Up (worse)</C> |
| Pipelining | <C color="green">Up</C> | Unchanged |
| Adding concurrency | <C color="green">Up</C> | Unchanged until saturation, then <C color="crimson">much worse</C> |
| Compression | <C color="green">Up (less bandwidth)</C> | Depends on CPU vs network |
| Caching | <C color="green">Up</C> | <C color="green">Down (better)</C> |

<H>Caching is one of very few techniques that improves both. Almost everything else trades one for the other, which is why "make it faster" is an ambiguous instruction until you say which number you mean.</H>

---

## 2. Little's Law

<Jargon
  plain="The number of things in progress equals how fast they arrive times how long each takes."
  term="Little's Law — L = λW"
  also={['concurrency = throughput × latency']}>

`L` = items in the system, `λ` = arrival rate, `W` = time in system. <C color="green">It holds for any stable system, with no assumptions about distributions</C> — which makes it the most broadly applicable formula in capacity work.

</Jargon>

The rearrangement you will use most:

```
  concurrency = throughput × latency

  1,000 req/s × 0.2 s  =  200 requests in flight
```

That single line answers several questions at once:

- **How many threads or connections do I need?** ~200 concurrent, plus headroom.
- **What is my connection pool size?** At least 200 if each request holds one for its whole duration.
- **What happens if latency doubles?** Concurrency doubles to 400 — <C color="crimson">so a downstream slowdown silently doubles your resource requirement.</C>

<Trace title="Sizing a service with Little's Law" subtitle="Measurements you already have, turned into a configuration.">

<TraceStep
  title="What you measured"
  state={{ 'Throughput': '1,000 req/s', 'Mean latency': '200 ms', 'Concurrency needed': '?', 'Threads configured': '50' }}
  changed={['Throughput', 'Mean latency']}
  note="Both numbers come straight off a dashboard. No modelling required.">

Peak traffic is 1,000 req/s and the mean request takes 200 ms.

</TraceStep>

<TraceStep
  title="Apply the law"
  cost="you are under-provisioned"
  state={{ 'Throughput': '1,000 req/s', 'Mean latency': '200 ms', 'Concurrency needed': '200', 'Threads configured': '50' }}
  changed={['Concurrency needed']}
  note="With 50 threads you can only sustain 50 / 0.2 = 250 req/s. The rest queue.">

`1,000 × 0.2 = 200` concurrent requests. <C color="crimson">You have 50 threads.</C>

</TraceStep>

<TraceStep
  title="What under-provisioning does"
  state={{ 'Throughput': '250 req/s served', 'Observed latency': 'rising', 'Queue': 'growing', 'Threads configured': '50' }}
  changed={['Throughput', 'Observed latency', 'Queue']}
  note="The service appears slow. The cause is not slow code — it is insufficient concurrency.">

Requests queue waiting for a thread. <C color="orange">Observed latency rises even though per-request work has not changed at all.</C>

</TraceStep>

<TraceStep
  title="A downstream dependency slows"
  cost="requirement doubles"
  state={{ 'Throughput': '1,000 req/s', 'Mean latency': '400 ms', 'Concurrency needed': '400', 'Threads configured': '200' }}
  changed={['Mean latency', 'Concurrency needed', 'Threads configured']}
  note="This is the mechanism behind most cascading failures — latency rising silently doubles concurrency demand.">

The database gets slower; latency goes 200 ms → 400 ms. Concurrency needed **doubles to 400**, with no change in traffic.

<C color="crimson">A configuration sized for yesterday's latency is now half of what is needed.</C>

</TraceStep>

<TraceStep
  title="The useful reading"
  state={{ 'Rule': 'concurrency = throughput × latency', 'Implication': 'latency rises ⇒ resource demand rises', 'Configured with headroom': '400+' }}
  changed={['Rule', 'Implication', 'Configured with headroom']}
  note="Size concurrency for degraded latency, not healthy latency.">

<H>Latency and resource consumption are coupled. Anything that makes your dependencies slower makes you need more threads, more connections and more memory — at exactly the moment you have least to spare.</H>

</TraceStep>

</Trace>

---

## 3. Tail latency

<C color="crimson">Averages hide the experience of the people who complain.</C>

```
  10 requests: nine at 10 ms, one at 5,000 ms

  mean = 509 ms   ← describes nothing that happened
  p50  =  10 ms   ← the typical experience
  p99  ≈ 5,000 ms ← the support ticket
```

**Why tails matter more than they look:**

**Fan-out amplifies them.** A request touching 100 services waits for the slowest. With a 1% chance each of hitting the tail, `1 − 0.99¹⁰⁰ ≈ 63%` of requests hit at least one — <C color="crimson">your p50 becomes your dependencies' p99.</C>

**High-value users see them most.** A user with more data triggers more work, more pages and more queries — so the customers who matter most are systematically the ones experiencing your tail.

**Tails are where resource exhaustion shows first.** A rising p99 with a flat p50 usually means queueing, contention or GC — a leading indicator of saturation.

**Where tails come from:** garbage collection pauses · queueing behind a slow request · cold caches · lock contention · TCP retransmits · noisy neighbours · a slow shard or replica · connection pool waits.

<C color="green">Always specify latency requirements as percentiles.</C> "Fast" is unfalsifiable; "p99 under 200 ms over a 28-day window" is an [SLO](../01-foundations/03-slis-slos-and-error-budgets.md).

<Depth title="Why latency explodes rather than degrades, and how to measure it honestly">

**The queueing knee.** Latency does not rise linearly with load. From queueing theory, waiting time scales with `ρ/(1−ρ)` where ρ is utilisation:

```
  50% utilised  →  wait ≈ 1× service time
  70%           →  ≈ 2.3×
  80%           →  ≈ 4×
  90%           →  ≈ 9×
  95%           →  ≈ 19×
  99%           →  ≈ 99×
```

There is a **pole** at ρ = 1, not a slope. This is why capacity graphs look flat then vertical, and why *"we're only at 85% CPU"* is a dangerous thing to believe — you are one traffic increment from the cliff.

And real systems are **worse** than this predicts, for three reasons: arrivals are burstier than Poisson (retries and cron jobs cluster); service times are heavy-tailed, and queueing delay scales with the *variance* of service time, not just its mean (Pollaczek–Khinchine); and slow responses trigger client retries, raising λ exactly when you need it to fall.

<C color="green">This is why capacity targets sit at 60–70% utilisation.</C> The headroom is not waste — it is the entire difference between a p99 of 50 ms and a p99 of 5 seconds.

**Measuring honestly — four traps:**

**1. Averaging percentiles is meaningless.** You cannot average the p99s of ten servers to get the fleet p99. Percentiles are not linear. <C color="crimson">Every dashboard that does this is lying to you.</C> Aggregate the underlying histograms (HDR histograms, Prometheus buckets), then compute the percentile once.

**2. Coordinated omission.** A load generator that waits for a response before sending the next request **stops sending during a stall** — so the stall is measured once instead of affecting every request that should have been issued. This systematically under-reports the tail, often by an order of magnitude. Tools that correct for it (wrk2, `gatling` with open workload models) send at a fixed rate regardless of responses.

**3. Measuring at the wrong place.** Server-side latency excludes queueing in the load balancer, TLS handshakes, DNS and the client's own network. <C color="orange">The user's experience is the number that matters, and it is always worse than the server reports.</C> Real user monitoring is the only honest measure.

**4. Percentiles over the wrong window.** A p99 over 24 hours hides a 30-minute period where everything was broken. Compute over short windows and look at the distribution *of* those windows.

**On p99.9 and beyond.** At 1,000 req/s, p99.9 is one request per second — real users, continuously. Google's rule of thumb is that if your service is called by others, your p99 becomes their p50 through fan-out, so the tail you tolerate propagates upward through the entire system.

</Depth>

---

## 4. Improving each

**To reduce latency:** remove round trips (batch, colocate, cache) · reduce work per request (indexes, precomputation) · parallelise independent calls · move computation closer to users · reduce queueing by adding capacity.

**To increase throughput:** add concurrency until saturation · batch · use async I/O so threads are not blocked · remove contention (locks, hot rows, shared counters) · scale horizontally.

<C color="green">The highest-value move is usually removing a round trip</C>, because it improves latency and throughput simultaneously — the [N+1 pattern](../04-data-storage/02-indexes-and-query-plans.md) at any layer is the most common instance.

---

## 5. In a design discussion

- **"Little's Law: 1,000 req/s at 200 ms means 200 concurrent, so the pool needs at least that — and if latency doubles, so does the requirement."** Sizing from measurement.
- **"p99, not mean. With 100 fan-out calls at a 1% tail chance each, 63% of requests hit at least one."** The arithmetic that makes tails matter.
- **"Target 70% utilisation. Latency has a pole at full utilisation, so the last 15% of headroom is what keeps p99 flat."** Explains the number rather than reciting it.
- **"Batching raises throughput and worsens latency — worth it for the ingest path, not for the user-facing read."** Applies the trade per path.

---

## Rapid-fire recall

1. Why are latency and throughput not reciprocals?
2. Name three techniques that trade one for the other, and the one that improves both.
3. State Little's Law and its most useful rearrangement.
4. Compute concurrency for 1,000 req/s at 200 ms, and what happens if latency doubles.
5. Why does a downstream slowdown increase your resource requirements?
6. Why does fan-out turn a dependency's p99 into your p50?
7. Name four sources of tail latency.
8. Why is 85% utilisation dangerous, and what does queueing theory say at 90% and 99%?
9. Why can you not average percentiles across servers, and what should you do instead?
10. What is coordinated omission, and what does it do to your measurements?

<details>
<summary>Answers</summary>

1. Because **concurrency** sits between them. A system with 100 ms latency and 50 concurrent workers achieves 500 ops/s, not 10 — throughput is latency **and** parallelism.
2. **Batching** (throughput up, latency worse) · **adding concurrency** (throughput up until saturation) · **compression** (depends on CPU vs network). **Caching** improves both.
3. `L = λW` — items in the system equals arrival rate times time in system. Most useful rearrangement: **concurrency = throughput × latency**.
4. `1,000 × 0.2` = **200 concurrent**. If latency doubles to 400 ms, concurrency needed **doubles to 400** with no change in traffic.
5. Because concurrency = throughput × latency. Higher latency means each request occupies a thread, connection and memory for longer, so the same traffic needs **more of everything** — precisely when resources are scarcest.
6. Because the request waits for the **slowest** of its calls. With 100 calls each 1% likely to be slow, `1 − 0.99¹⁰⁰ ≈ 63%` of requests hit at least one tail event, so the rare case becomes the typical one.
7. **GC pauses** · **queueing behind a slow request** · **cold caches** · **lock contention** · **TCP retransmits** · **noisy neighbours** · **a slow shard or replica** · **connection pool waits**.
8. Because waiting time scales as `ρ/(1−ρ)`, which has a **pole at full utilisation** — a cliff, not a slope. At 90% the wait is ~9× service time; at 99% it is ~99×.
9. Because **percentiles are not linear** — the average of two p99s is not the combined p99. Aggregate the underlying **histograms** (HDR, Prometheus buckets) and compute the percentile once over the merged data.
10. A load generator that **waits for a response before sending the next request** stops sending during a stall, so the stall is measured once instead of affecting every request that should have been issued. It **under-reports the tail**, often by an order of magnitude.

</details>

---

**Next:** [Capacity Planning](./02-capacity-planning.md) — deciding how much to buy, before you need it.
