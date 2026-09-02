---
title: Caching Fundamentals
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Caching Fundamentals

> **What you will be able to do after this page**
>
> - Name every layer a request passes through that can cache, and pick the right one.
> - Compute the real effect of a hit ratio on origin load and average latency.
> - Decide what is worth caching from access frequency and computation cost.
> - Say what caching costs, beyond memory.

Caching is the highest return-on-effort optimisation in system design, and <C color="orange">the one most likely to introduce a bug you cannot reproduce.</C>

<Plain>

A chef makes a sauce that takes forty minutes. Twenty people order it during service.

Making it twenty times is absurd. So the chef makes a large batch in the morning and ladles from it — seconds per plate instead of forty minutes.

That is caching, and the two consequences are the two halves of this entire topic.

**The saving is enormous.** Forty minutes becomes seconds, and it scales: a hundred orders cost barely more than twenty.

**The batch can become wrong.** If the recipe changes at midday, the pot still holds the old sauce. Every plate served from it is out of date, and — critically — <C color="crimson">nothing about the pot indicates this.</C> It looks exactly the same.

So the real work is never "should we make a batch". It is:

- **How long is a batch still good for?**
- **How do you know when the recipe changed?**
- **What happens when the pot runs out during a rush and twenty orders arrive at once?**

<C color="orange">Every caching bug you will ever debug is one of those three questions, answered badly.</C> The speed-up is the easy part.

</Plain>

---

## 1. The layers

A single request passes through many places that can cache. <C color="green">The best cache is the one closest to the user that can hold the answer.</C>

```
  browser cache        0 ms      per user; you control it via headers
       ↓
  CDN edge            ~10 ms     shared by region; huge offload
       ↓
  reverse proxy       ~1 ms      shared by all users of one datacentre
       ↓
  application memory  ~0.1 μs    per process; lost on deploy, not shared
       ↓
  distributed cache   ~1 ms      shared, survives deploys — Redis/Memcached
       ↓
  database cache      ~0.1 ms    buffer pool; you influence it only indirectly
       ↓
  ORIGIN / disk       ~10 ms+
```

| Layer | Shared? | Survives deploy? | Best for |
| :--- | :--- | :--- | :--- |
| Browser | <C color="crimson">No</C> | Yes | Static assets, per-user data |
| CDN | Yes, per region | Yes | Public content, media |
| Reverse proxy | Yes, per DC | Yes | Full pages, API responses |
| **In-process** | <C color="crimson">No</C> | <C color="crimson">No</C> | Tiny, hot, rarely-changing data |
| **Distributed (Redis)** | <C color="green">Yes</C> | <C color="green">Yes</C> | <C color="green">Sessions, computed results, counters</C> |
| Database buffer pool | Yes | Yes | Automatic; give it RAM |

<C color="orange">In-process caching is under-used and over-used in different places.</C> It is unbeatable for a config table read on every request — nanoseconds, no network. It is wrong for anything that must be consistent across servers, because 50 processes hold 50 independent copies that expire at different times.

---

## 2. Hit ratio arithmetic

<Jargon
  plain="The fraction of requests the cache could answer without going to the source."
  term="cache hit ratio"
  also={['hit rate', 'offload']}>

The number that determines everything. <C color="orange">Think in terms of the **miss** rate</C>, because that is what reaches your origin: 95% → 99% sounds like a 4% improvement and is actually a **5× reduction** in origin load.

</Jargon>

```
  average latency = (hit_ratio × hit_latency) + (miss_ratio × miss_latency)

  Cache hit 1 ms, miss 50 ms:

   50% hit → 0.5×1 + 0.5×50 = 25.5 ms   origin sees 50% of traffic
   90% hit → 0.9×1 + 0.1×50 =  5.9 ms   origin sees 10%
   99% hit → 0.99×1 + 0.01×50 = 1.5 ms  origin sees 1%
  99.9% hit →                   1.05 ms  origin sees 0.1%
```

<H>Going from 90% to 99% cuts average latency by 4× and origin load by 10×. Going from 99% to 99.9% barely moves latency but cuts origin load by another 10× — which is what decides how many database servers you need.</H>

Two lessons: **latency gains flatten quickly** while **origin offload keeps improving linearly in the miss rate**. So past ~95%, you are optimising your infrastructure bill, not user experience.

---

## 3. What to cache

Rank candidates by **frequency × cost ÷ volatility**.

| Cache it | Do not cache it |
| :--- | :--- |
| <C color="green">Read often, changes rarely</C> — config, product catalogue | <C color="crimson">Read once</C> — a one-off report |
| <C color="green">Expensive to compute</C> — aggregates, rendered pages | <C color="crimson">Cheap to compute</C> — a primary-key lookup on a warm index |
| <C color="green">Same answer for many users</C> — trending, homepage | <C color="crimson">Unique per request</C> — a search with 20 filters |
| <C color="green">Tolerates staleness</C> — counts, recommendations | <C color="crimson">Must be exact</C> — account balance at point of payment |

<C color="crimson">The most common mistake is caching a query that was already fast.</C> A primary-key lookup on a cached index page takes ~0.1 ms; a Redis round trip takes ~1 ms. <C color="orange">You made it ten times slower and added an invalidation bug.</C> Always measure the thing before caching it.

<Trace title="Adding a cache to a slow endpoint" subtitle="A dashboard aggregation taking 800 ms. Watch what each step actually buys.">

<TraceStep
  title="Baseline — measure first"
  state={{ 'p99 latency': '800 ms', 'DB load': '100%', 'Hit ratio': '—', 'Staleness': '0 s' }}
  note="Profile before caching. Half the time it is a missing index, and that fix has no staleness cost at all.">

An aggregation across three tables. `EXPLAIN` shows it is genuinely doing the work — no missing index, no bad plan.

</TraceStep>

<TraceStep
  title="Wrong first move — cache the whole response per user"
  cost="hit ratio 12%"
  state={{ 'p99 latency': '740 ms', 'DB load': '88%', 'Hit ratio': '12%', 'Staleness': '60 s' }}
  changed={['p99 latency', 'DB load', 'Hit ratio', 'Staleness']}
  note="Per-user keys with a low repeat rate produce almost no hits — you added a dependency and a staleness window for nothing.">

Keyed by `user_id`, 60-second TTL. Most users load the dashboard once per session, so <C color="crimson">the entry expires before it is reused.</C>

</TraceStep>

<TraceStep
  title="Better — cache the shared sub-computation"
  cost="hit ratio 94%"
  state={{ 'p99 latency': '120 ms', 'DB load': '9%', 'Hit ratio': '94%', 'Staleness': '60 s' }}
  changed={['p99 latency', 'DB load', 'Hit ratio', 'Staleness']}
  note="Find the part that is identical across users. That is where the hit ratio lives.">

The expensive part is a company-wide aggregate, identical for every user in a tenant. Cache **that** by `tenant_id`, and compose the per-user view around it.

<C color="green">A thousand users share one cached value.</C>

</TraceStep>

<TraceStep
  title="Add stale-while-revalidate"
  state={{ 'p99 latency': '95 ms', 'DB load': '9%', 'Hit ratio': '94%', 'Staleness': 'up to 120 s' }}
  changed={['p99 latency', 'Staleness']}
  note="Removes the latency cliff at expiry — nobody waits for a recompute.">

On expiry, serve the stale value immediately and refresh in the background. The p99 spike at expiry disappears.

</TraceStep>

<TraceStep
  title="The honest accounting"
  state={{ 'p99 latency': '95 ms', 'DB load': '9%', 'Hit ratio': '94%', 'New failure modes': 'staleness, stampede, Redis dependency' }}
  changed={['New failure modes']}
  note="8× faster, 11× less database load — and three new things that can go wrong.">

<H>The gain was real and so is the cost: data can be two minutes stale, Redis is now on the critical path, and a cold cache after a Redis restart sends full traffic to the database. Each needs a deliberate answer.</H>

</TraceStep>

</Trace>

---

## 4. What caching costs

Beyond memory:

| Cost | Detail |
| :--- | :--- |
| **Staleness** | Every cache is a copy that can be wrong. You choose how wrong |
| **A new dependency** | Redis on the hot path — what happens when it is unreachable? |
| **Cold-start risk** | An empty cache sends 100% of traffic to a database sized for 5% |
| **Invalidation complexity** | The hard problem, covered on [its own page](./03-eviction-and-invalidation.md) |
| **Debugging difficulty** | <C color="crimson">"It works for me" often means "my cache entry is newer than yours"</C> |
| **Memory cost** | RAM is ~50–100× disk per GB |

<C color="green">Always decide what happens when the cache is unavailable.</C> Failing open (go to the origin) is usually right — but if the origin cannot survive full traffic, failing open turns a cache outage into a total outage. That is a capacity decision, and it should be made deliberately rather than discovered.

<Depth title="Why hot data concentrates, and how to size a cache">

Caching works because access is **wildly non-uniform**. If every item were equally likely, a cache holding 1% of the data would get a 1% hit ratio and be pointless.

Real access follows a **power law** — usually approximated as **Zipf's law**, where the frequency of the *k*-th most popular item is proportional to `1/k^s`, with `s` near 1 for many workloads. The practical consequence:

```
  Zipf with s ≈ 1, over 1,000,000 items:

  top      100 items  ≈  15% of all requests
  top    1,000 items  ≈  25%
  top   10,000 items  ≈  40%
  top  100,000 items  ≈  60%
```

<C color="green">Caching 1% of your data can serve 40% of requests.</C> This is why a cache far smaller than the dataset works at all, and why the first gigabyte of cache is worth far more than the tenth.

**Sizing follows directly, and it is a curve with a knee.** Hit ratio against cache size rises steeply then flattens:

```
  cache 0.1% of data → ~25% hits
  cache   1% of data → ~40% hits
  cache  10% of data → ~65% hits
  cache  50% of data → ~85% hits
```

<C color="orange">Doubling the cache does not double the hit ratio</C> — so the right question is never "how much can we afford?" but *"where does the curve flatten for our access pattern?"* Measure it: instrument hit ratio at the current size, then model or experiment with a larger one. Many teams over-provision cache memory well past the knee, paying RAM prices for single-digit gains.

**Working set, not dataset.** What matters is the **working set** — the data actually accessed in a time window — which is usually far smaller than the total. A social network with 500M users may see only 20M active in an hour, so the cache needs to hold roughly those users' data, not all 500M.

**Two things that break the assumption:**

**Uniform random access.** Some workloads genuinely have no hot set — a key-value store keyed by UUID with even access. <C color="crimson">Caching adds latency and buys nothing.</C> Check the distribution before assuming a cache will help.

**Shifting hot sets.** A news site's hot set turns over completely within hours. The cache is perpetually warming, so the *steady-state* hit ratio is lower than the distribution suggests, and admission policies matter more — which is what TinyLFU and similar policies address by refusing to admit items unlikely to be reused.

</Depth>

---

## 5. In a design discussion

- **"90% to 99% hit ratio is a 10× reduction in origin load, which decides how many database replicas we need."** Frames it as capacity, not just latency.
- **"I'd cache the tenant-level aggregate rather than the per-user response — the per-user key barely repeats, so the hit ratio would be near zero."** Shows you think about key cardinality.
- **"Measure the query first. Caching a 0.1 ms primary-key lookup behind a 1 ms Redis call makes it slower."** Avoids the classic mistake.
- **"If Redis is down, do we fail open to the database? Only if the database can take full traffic — otherwise a cache outage becomes a total outage."** Names the capacity decision.

---

## Rapid-fire recall

1. List the caching layers a request passes through, from client to origin.
2. When is in-process caching right, and when is it wrong?
3. Compute average latency at 90% and 99% hit ratios with 1 ms hits and 50 ms misses.
4. Why does origin load keep improving past the point where latency flattens?
5. Give four properties that make data worth caching.
6. What is the most common caching mistake, and why does it make things worse?
7. In the dashboard trace, why did per-user caching fail and tenant-level succeed?
8. Name four costs of caching besides memory.
9. What does Zipf's law imply about caching 1% of your data?
10. Why is doubling cache size not twice as good, and what should you measure?

<details>
<summary>Answers</summary>

1. Browser → CDN edge → reverse proxy → application memory → distributed cache (Redis) → database buffer pool → origin/disk.
2. **Right** for tiny, hot, rarely-changing data read on every request — nanoseconds, no network hop. **Wrong** when consistency across servers matters, because N processes hold N independent copies expiring at different times.
3. 90%: `0.9×1 + 0.1×50` = **5.9 ms**. 99%: `0.99×1 + 0.01×50` = **1.5 ms**.
4. Because latency is dominated by the hit path once hits are common, while **origin load is proportional to the miss rate** — halving misses always halves origin traffic, however small it already is.
5. **Read often** · **expensive to compute** · **the same for many users** · **tolerates staleness**.
6. **Caching something that was already fast.** A 0.1 ms primary-key lookup behind a 1 ms Redis round trip is 10× slower, and you have added an invalidation bug for a negative gain.
7. Per-user keys barely repeat — users load the dashboard once per session, so entries expire before reuse (12% hits). The **tenant-level aggregate is identical for a thousand users**, so one entry serves them all (94% hits).
8. **Staleness** · **a new dependency on the hot path** · **cold-start risk** (empty cache sends full traffic to an origin sized for 5%) · **invalidation complexity** · **debugging difficulty**.
9. Access follows a power law, so the top ~1% of items account for roughly **40% of requests**. A cache far smaller than the dataset is therefore highly effective, and the first gigabyte is worth far more than the tenth.
10. Because the hit-ratio curve has a **knee** and flattens — 1% of data gives ~40% hits, 10% gives ~65%, 50% gives ~85%. Measure the **hit ratio at the current size** and find where the curve flattens for your access pattern, rather than provisioning by budget.

</details>

---

**Next:** [Caching Patterns](./02-caching-patterns.md) — who writes to the cache, and who writes to the database.
