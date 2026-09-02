---
title: Eviction and Invalidation
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Eviction and Invalidation

> **What you will be able to do after this page**
>
> - Distinguish eviction from invalidation, and stop conflating them.
> - Choose an eviction policy from the access pattern.
> - Design an invalidation strategy for data with dependencies.
> - Explain why TTL is a bound rather than a strategy.

Two different problems that share a symptom — an entry leaves the cache. <C color="orange">One is about running out of room. The other is about being wrong.</C>

<Plain>

A desk has room for twenty files.

**Eviction** is what happens when a twenty-first arrives. Something must go, and the only question is which — probably the one you have not touched in longest. Nothing was *wrong* with it; there simply was not space.

**Invalidation** is different. A colleague tells you one of your files is out of date. Space has nothing to do with it: <C color="crimson">that file is now actively misleading and must go regardless of how recently you used it.</C>

Confusing them causes real bugs. *"The cache will evict it eventually"* is not an answer to *"this value is wrong"* — eviction is driven by memory pressure, so on a quiet day the wrong value might sit there for hours.

The genuinely hard part is the third question, the one nobody asks until it bites: **how do you know a file is out of date?**

For one file with one source, easy. But a summary sheet compiled from six files is stale the moment **any** of them changes — and nothing on the sheet records where its numbers came from. <C color="orange">Unless you wrote down what it was built from, you cannot know when to throw it away.</C>

</Plain>

---

## 1. Eviction: choosing what to drop

<Jargon
  plain="Removing an entry because the cache is full, not because it is wrong."
  term="eviction"
  also={['cache replacement', 'the eviction policy']}>

Distinct from **invalidation** — removing an entry because the underlying data changed — and from **expiry**, where an entry ages out on its TTL. <C color="crimson">Three different mechanisms that all end with the entry gone</C>, and confusing them makes cache behaviour impossible to reason about.

</Jargon>

| Policy | Evicts | Good for | Weak against |
| :--- | :--- | :--- | :--- |
| **LRU** | Least recently used | <C color="green">Most workloads — recency predicts reuse</C> | A large scan evicts everything hot |
| **LFU** | Least frequently used | Stable popularity | <C color="crimson">Old popular items never leave</C> |
| **FIFO** | Oldest inserted | Simple; time-ordered data | Ignores access entirely |
| **Random** | Any entry | <C color="green">Surprisingly decent; O(1), no metadata</C> | No intelligence |
| **TTL-only** | Whatever expired | Data with a natural lifetime | Can fill up if TTLs are long |
| **TinyLFU / W-TinyLFU** | Combines recency and frequency | <C color="green">Best hit ratios in practice</C> | More complex |

**LRU is the sensible default**, with one well-known weakness: <C color="crimson">a sequential scan through cold data evicts your entire hot set</C>. A nightly analytics job touching every row can leave the cache useless for morning traffic. Segmented LRU or an admission policy fixes it.

**Admission policies are the under-appreciated idea.** Rather than asking *"what should I evict?"*, ask *"should this new item come in at all?"* **TinyLFU** keeps a compact frequency sketch and <C color="green">admits a new item only if it looks more valuable than the item it would displace</C> — which makes scans harmless, because scanned items are never admitted in the first place. Caffeine and modern Redis policies use this family.

### Redis eviction policies, since you will configure them

```
  noeviction        reject writes when full — the default; surprises people
  allkeys-lru       evict any key, least recently used
  allkeys-lfu       evict any key, least frequently used
  volatile-lru      evict only keys with a TTL set
  volatile-ttl      evict the key expiring soonest
```

<C color="crimson">`noeviction` with a full instance means writes start failing</C> — correct if Redis is your database, wrong if it is a cache. <C color="orange">`volatile-*` policies fail if no keys have TTLs</C>: nothing is eligible, and the instance behaves as `noeviction`. <C color="green">For a pure cache, `allkeys-lru` is nearly always right.</C>

---

## 2. Invalidation: knowing you are wrong

The genuinely hard problem, and the difficulty is **dependencies**.

<Trace title="One update, many stale entries" subtitle="A product's price changes. Find everything that is now wrong.">

<TraceStep
  title="The obvious entry"
  state={{ 'Stale entries found': '1', 'Still wrong': 'unknown', 'Strategy': 'delete by key' }}
  changed={['Stale entries found']}
  note="This part is easy, and it is where most implementations stop.">

`product:99` is cached. The price changes, so delete `product:99`. Done — apparently.

</TraceStep>

<TraceStep
  title="The derived entries"
  cost="many more"
  state={{ 'Stale entries found': '1 + many', 'Still wrong': 'category pages, search, homepage', 'Strategy': 'delete by key — insufficient' }}
  changed={['Stale entries found', 'Still wrong', 'Strategy']}
  note="Nothing in the cache records that these were built from product 99.">

That product also appears in: the category listing, search results for several terms, the "cheapest in category" widget, the homepage carousel, and three users' cart totals.

<C color="crimson">All of them still hold the old price, and none is keyed by product id.</C>

</TraceStep>

<TraceStep
  title="Strategy 1 — TTL, and accept staleness"
  state={{ 'Stale entries found': 'n/a', 'Still wrong': 'for up to the TTL', 'Strategy': 'TTL only', 'Complexity': 'none' }}
  changed={['Still wrong', 'Strategy', 'Complexity']}
  note="Genuinely the right answer more often than engineers like to admit. Bound the wrongness and move on.">

Give derived entries a short TTL — 60 seconds — and let them expire.

<C color="green">Zero machinery, and correctness within a bounded window.</C> For a category page, a minute-old price is usually fine.

</TraceStep>

<TraceStep
  title="Strategy 2 — tag-based invalidation"
  state={{ 'Stale entries found': 'all of them', 'Still wrong': 'none', 'Strategy': 'tags', 'Complexity': 'moderate' }}
  changed={['Stale entries found', 'Still wrong', 'Strategy', 'Complexity']}
  note="Requires recording, at write time, which entities each cached value depends on.">

Tag each cached entry with the entities it was built from: the category page is tagged `product:99`, `product:112`, `category:7`. Invalidating `product:99` <C color="green">purges every entry carrying that tag.</C>

The cost is bookkeeping — a set per tag, updated on every cache write.

</TraceStep>

<TraceStep
  title="Strategy 3 — versioned keys"
  state={{ 'Stale entries found': 'n/a — old keys abandoned', 'Still wrong': 'none', 'Strategy': 'version in key', 'Complexity': 'low' }}
  changed={['Stale entries found', 'Strategy', 'Complexity']}
  note="Nothing is ever invalidated. Old entries become unreachable and are evicted naturally.">

Include a version in the key: `category:7:p99v12:p112v4`. Bumping product 99's version changes every dependent key, so those reads <C color="green">miss naturally</C>.

No deletion is needed — the old entries are simply never requested again.

</TraceStep>

<TraceStep
  title="Strategy 4 — invalidate from the change log"
  state={{ 'Stale entries found': 'all, driven by the DB', 'Still wrong': 'none', 'Strategy': 'CDC', 'Complexity': 'higher' }}
  changed={['Stale entries found', 'Strategy', 'Complexity']}
  note="Cannot be bypassed by a code path that forgot to invalidate — including cron jobs and manual SQL.">

A consumer tails the database log and invalidates based on what actually changed.

<H>Notice the progression: accept staleness (cheapest), track dependencies explicitly (tags), make stale keys unreachable (versions), or drive invalidation from the source of truth (CDC). Nearly every real system uses the first for most data and one of the others for the few things that matter.</H>

</TraceStep>

</Trace>

---

## 3. TTL is a bound, not a strategy

A TTL answers *"how long may this be wrong?"*. It does not answer *"is this wrong now?"*.

<C color="green">Every cache entry should have a TTL, even when you invalidate explicitly</C> — because invalidation can fail. A dropped message, a crashed worker, a code path someone forgot, a race like the [cache-aside one](./02-caching-patterns.md). The TTL is what stops a missed invalidation from lasting forever.

**Choosing the value:**

| Data | TTL | Reasoning |
| :--- | :--- | :--- |
| Static assets (hashed filename) | 1 year | The key can never mean anything else |
| Product catalogue | 5–60 min | Changes are infrequent; staleness is tolerable |
| Inventory count | 10–30 s | Wrong for too long causes overselling |
| User session | Session length | Natural lifetime |
| Rendered page fragments | 1–5 min | Balances load against freshness |
| Account balance | <C color="crimson">Do not cache</C> | Must be exact at the point of use |

<C color="crimson">Always jitter TTLs.</C> Entries created together with an identical TTL expire together, producing a synchronised wave of misses. `ttl = base ± random(10%)` spreads them — the same lesson as [CDN TTLs](../03-traffic-and-edge/03-cdn.md) and [retry backoff](../06-distributed-systems/03-consensus-and-quorums.md).

<Depth title="Why LRU beats LFU in practice, and what a scan does to your cache">

**The theoretical optimum is Bélády's algorithm** — evict the item that will be needed furthest in the future. It requires knowledge of the future, so it exists only as a benchmark. Every real policy is an attempt to predict it.

**LRU predicts the future with recency**, and it works because access patterns exhibit **temporal locality**: something used recently is likely to be used again soon. For most workloads this is a strong signal and LRU lands within a few percent of optimal.

**Why LFU usually underperforms despite sounding smarter.** Frequency seems like a better signal than recency, and it has a fatal flaw: **cache pollution by historical popularity**. An item accessed 10,000 times last month but never since keeps a high count and stays resident forever, while a currently-hot item with 50 accesses is evicted. <C color="crimson">LFU cannot forget.</C>

The fix is **aged** or **windowed** LFU — decaying counts over time, so old popularity fades. Redis's LFU uses a logarithmic counter with a decay period for exactly this reason. Aged LFU can beat LRU on workloads with stable popularity, such as a CDN serving a long-tail catalogue.

**The scan resistance problem, and why it matters operationally.** LRU's serious weakness:

```
  Cache holds the 10,000 hottest items. A nightly job scans 10,000,000 rows.

  Each scanned row is "recently used", so it is admitted and evicts a hot item.
  After the scan, the cache holds 10,000 rows nobody will ever request again.
  Hit ratio at 8am: near zero. The database takes full traffic during the
  morning peak.
```

<C color="crimson">A single batch job can degrade your cache for hours</C>, and the symptom — a slow morning — looks nothing like its cause. Three defences:

**Segmented LRU (SLRU).** Split into a small **probationary** segment and a larger **protected** segment. New items enter probation; only an item hit a *second* time is promoted to protected. Scanned items are touched once and never promoted, so they churn through probation without disturbing the hot set.

**Admission policies (TinyLFU).** Keep a compact frequency sketch — a Count-Min Sketch, a few bits per item — of what has been *requested*, including items not in the cache. On a miss, admit the new item only if its estimated frequency exceeds that of the eviction candidate. <C color="green">Scanned items have frequency 1 and are simply not admitted</C>, so the hot set is untouched. This is why W-TinyLFU (Caffeine) consistently reaches higher hit ratios than LRU with modest memory overhead.

**Bypass the cache for scans.** The simplest and most reliable fix, and the one to reach for first: analytics jobs and batch processes should read with caching disabled, or from a read replica that does not share the cache at all.

**On random eviction.** Evicting a random entry performs surprisingly close to LRU on many workloads, needs no metadata and no list manipulation, and is `O(1)`. Redis's `allkeys-lru` is in fact **approximated** LRU — it samples a handful of keys and evicts the least recently used among them — because maintaining exact LRU ordering costs more than the accuracy is worth. <H>A recurring theme: an approximate answer computed cheaply usually beats an exact answer that costs you memory and latency on every operation.</H>

</Depth>

---

## 4. In a design discussion

- **"Eviction is memory pressure, invalidation is correctness. 'It'll be evicted eventually' isn't an answer to a stale value."** The distinction, stated crisply.
- **"TTL on everything, including entries we invalidate explicitly — the TTL is the bound for when invalidation fails."** Why both.
- **"Derived entries get short TTLs; the product entity gets tag-based invalidation. Only a few things need exactness."** Applies effort proportionally.
- **"`allkeys-lru`, not the default `noeviction` — otherwise writes start failing when it fills. And the nightly job bypasses the cache so it doesn't evict the hot set."** Two real operational details.

---

## Rapid-fire recall

1. Distinguish eviction, invalidation and expiry.
2. Give LRU's main weakness and two fixes.
3. Why does LFU often underperform LRU, and what fixes it?
4. Why is Redis's default `noeviction` a trap for a cache, and what should it be?
5. What breaks `volatile-lru`?
6. Why is deleting one key usually insufficient after an update?
7. Name four invalidation strategies in increasing order of machinery.
8. Why should entries have a TTL even with explicit invalidation?
9. Why must TTLs be jittered?
10. How does an admission policy make scans harmless?

<details>
<summary>Answers</summary>

1. **Eviction** — removed for **space**. **Invalidation** — removed because the data **changed**. **Expiry** — removed because its **TTL elapsed**. Three mechanisms, one visible symptom.
2. A **sequential scan** over cold data marks everything recently-used and evicts the whole hot set. Fixes: **segmented LRU** (promote only on a second hit), an **admission policy** like TinyLFU, or **bypassing the cache** for batch jobs.
3. Because it **cannot forget** — an item popular last month keeps a high count and never leaves, while a currently-hot item is evicted. Fixed by **aged/windowed LFU** that decays counts over time.
4. `noeviction` makes **writes fail once memory is full** rather than making room — correct if Redis is your database, wrong for a cache. Use **`allkeys-lru`**.
5. It evicts only keys **with a TTL set**. If no keys have TTLs, nothing is eligible and the instance behaves as `noeviction`.
6. Because **derived entries** — category pages, search results, widgets, cart totals — also embed that data and are **not keyed by the entity id**, so a key-based delete never reaches them.
7. **TTL and accept staleness** → **tag-based invalidation** → **versioned keys** (old keys become unreachable) → **CDC-driven invalidation** from the database log.
8. Because **invalidation can fail** — a dropped message, a crashed worker, a forgotten code path, a cache-aside race. The TTL bounds how long a missed invalidation can persist.
9. Entries created together with identical TTLs **expire together**, producing a synchronised wave of misses against the origin. `base ± random(10%)` spreads them.
10. It keeps a frequency sketch of **requested** items and admits a new item only if it looks more valuable than the eviction candidate. Scanned items have frequency 1, so they are **never admitted** and the hot set is untouched.

</details>

---

**Next:** [Cache Failure Modes](./04-cache-failure-modes.md) — stampedes, penetration, avalanches and hot keys.
