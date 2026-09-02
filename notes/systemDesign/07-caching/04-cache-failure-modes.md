---
title: Cache Failure Modes
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Cache Failure Modes

> **What you will be able to do after this page**
>
> - Name the four classic cache failures and recognise each from its symptoms.
> - Prevent a stampede three different ways, and say which to reach for first.
> - Defend against cache penetration without unbounded memory growth.
> - Handle a hot key that exceeds one node's capacity.

A cache that works turns a fragile system into a fast one. <C color="crimson">A cache that fails turns a working system into an outage</C> — and it does so precisely when traffic is highest.

<Plain>

A shop keeps popular items on a front display so most customers never wait at the counter. It works beautifully, and it creates four new ways to fail — none of which existed before the display did.

**Everyone wants the same restocked item at once.** The display empties, and forty people simultaneously ask the counter for it. The counter, staffed for the four people who normally reach it, is overwhelmed.

**People keep asking for something you do not sell.** *"Do you have a kayak?"* It is never on the display — nothing that does not exist can be — so **every single request** goes to the counter. An unhelpful person could ask for a thousand imaginary items and bury you.

**The display is cleared all at once.** Someone restocks everything simultaneously, so later everything expires together, and for a few seconds <C color="crimson">every customer goes to the counter at the same instant.</C>

**One item is wanted by nearly everyone.** Even displayed, one shelf cannot serve a thousand people a minute — the shelf itself becomes the bottleneck.

Notice what these share: <C color="orange">each is a way the *protection* fails, and each dumps its full load onto something sized on the assumption that the protection was working.</C> That is why cache failures cause outages rather than slowdowns.

</Plain>

---

## 1. Cache stampede

<Jargon
  plain="One popular entry expires and every waiting request goes to the database at once."
  term="cache stampede"
  also={['thundering herd', 'dog-piling', 'cache miss storm']}>

The most common and most damaging. <C color="crimson">Your origin is sized for the miss rate</C> — perhaps 1% of traffic — and suddenly receives 100% of requests for a hot key simultaneously.

</Jargon>

<Trace title="A stampede takes down the database" subtitle="One hot key, 5,000 requests/second, 800 ms to recompute.">

<TraceStep
  title="Steady state"
  state={{ 'Requests/s': '5,000', 'DB queries/s': '~1', 'Cache': 'fresh', 'DB health': 'idle' }}
  note="The database is barely working, which is exactly why it is provisioned small.">

A hot key serves 5,000 req/s from cache. The database recomputes it once per TTL.

</TraceStep>

<TraceStep
  title="The entry expires"
  cost="all requests miss"
  state={{ 'Requests/s': '5,000', 'DB queries/s': '5,000', 'Cache': 'empty', 'DB health': 'saturating' }}
  changed={['DB queries/s', 'Cache', 'DB health']}
  note="Every one of them misses, and each independently decides to recompute.">

At expiry, all 5,000 concurrent requests find nothing.

</TraceStep>

<TraceStep
  title="The recompute takes 800 ms"
  cost="4,000 more pile in"
  state={{ 'Requests/s': '5,000', 'DB queries/s': '9,000 in flight', 'Cache': 'empty', 'DB health': 'overloaded' }}
  changed={['DB queries/s', 'DB health']}
  note="The window is 800 ms wide, so requests keep arriving and missing throughout it. The pile-up compounds.">

During those 800 ms, another 4,000 requests arrive, miss, and start their own queries. <C color="crimson">The database is now running thousands of copies of the same expensive query.</C>

</TraceStep>

<TraceStep
  title="It gets worse before it gets better"
  cost="cascading failure"
  state={{ 'Requests/s': '5,000', 'DB queries/s': 'saturated', 'Cache': 'still empty', 'DB health': 'timing out' }}
  changed={['DB queries/s', 'DB health']}
  note="This is a positive feedback loop: it does not self-correct, and connection pool exhaustion spreads it to unrelated endpoints.">

Under load the query takes 3 seconds instead of 800 ms, so the window widens, so more requests pile in. Connection pools exhaust, and <C color="crimson">unrelated endpoints start failing too.</C>

</TraceStep>

<TraceStep
  title="Fix 1 — request coalescing (single flight)"
  cost="1 query"
  state={{ 'Requests/s': '5,000', 'DB queries/s': '1', 'Cache': 'refilled', 'DB health': 'idle' }}
  changed={['DB queries/s', 'Cache', 'DB health']}
  note="The most effective single fix, and available in every language — Go's singleflight, a per-key promise map, or a short-lived lock.">

The first request to miss takes a per-key lock and recomputes; <C color="green">the other 4,999 wait for its result</C> instead of issuing their own queries.

</TraceStep>

<TraceStep
  title="Fix 2 — serve stale while revalidating"
  cost="0 waiting"
  state={{ 'Requests/s': '5,000', 'DB queries/s': '1 (background)', 'Cache': 'stale then fresh', 'DB health': 'idle' }}
  changed={['DB queries/s', 'Cache']}
  note="Nobody waits at all — the expiry becomes invisible to users.">

Store a **soft TTL** shorter than the hard TTL. Past the soft TTL, serve the stale value immediately and refresh in the background.

<C color="green">No request ever blocks on a recompute.</C>

</TraceStep>

<TraceStep
  title="Fix 3 — probabilistic early expiry"
  state={{ 'Requests/s': '5,000', 'DB queries/s': '~1, spread out', 'Cache': 'never empty', 'DB health': 'idle' }}
  changed={['DB queries/s', 'Cache']}
  note="Elegant, lock-free, and works across processes without coordination.">

As the entry approaches expiry, each request has a small and rising probability of refreshing it early. One request refreshes it **before** it expires; the rest keep hitting a valid entry.

<H>All three fixes share one idea: ensure exactly one recompute happens per expiry, and that nobody waits for it. The naive design does the opposite — everyone recomputes, and everyone waits.</H>

</TraceStep>

</Trace>

---

## 2. Cache penetration

Requests for keys that **do not exist**. Nothing can be cached, so every request reaches the database.

```
  GET /products/999999999   → cache miss → DB: not found → nothing cached
  repeat 10,000×/second      → 10,000 DB queries/second
```

Sometimes accidental — a broken client, a stale link. <C color="crimson">Sometimes deliberate, and it is a cheap and effective denial-of-service</C>, because the attacker needs only to generate random ids.

**Defences:**

| Defence | How | Cost |
| :--- | :--- | :--- |
| **Cache the negative** | Store a null marker with a short TTL (30–60 s) | <C color="crimson">Unbounded keys fill memory</C> |
| **Bloom filter** | Check a filter of existing ids before querying | <C color="green">~1.2 MB per million ids, ~1% false positives</C> |
| **Validate the format** | Reject impossible ids before any lookup | Free, catches naive attacks |
| **Rate limit by key pattern** | Throttle clients producing high miss rates | Needs per-client tracking |

<C color="green">A Bloom filter is the right answer at scale.</C> Load every existing id into it; a "definitely not present" answer short-circuits before the cache *and* the database. False positives merely cause a normal lookup, so the failure mode is harmless — <C color="orange">exactly the asymmetry that made Bloom filters right for [LSM reads](../04-data-storage/03-storage-engines.md) too.</C>

Negative caching alone is not enough against a deliberate attacker, since random ids create unbounded distinct keys — <C color="green">bound it with a short TTL and a dedicated memory limit.</C>

---

## 3. Cache avalanche

Many keys expire **simultaneously**, so a large fraction of traffic misses at once.

Usually self-inflicted:

- A deploy warms the cache, giving thousands of keys an identical TTL. They expire together, forever, in a synchronised wave.
- A cache node restarts and loses everything at once.
- A batch job populates 100,000 entries in a loop with the same TTL.

**Defences:**

<C color="green">**Jitter every TTL.**</C> `ttl = base + random(0, base × 0.1)`. One line, and it eliminates the self-inflicted case entirely.

<C color="green">**Warm the cache before serving.**</C> After a restart, populate hot keys before adding the node to rotation — otherwise it joins with an empty cache and forwards everything to the origin.

<C color="green">**Stagger deploy-time warming**</C> so entries do not share an expiry instant.

<C color="green">**Have a circuit breaker in front of the origin**</C>, so a mass miss degrades rather than saturates.

---

## 4. Hot keys

One key so popular it exceeds a single cache node's capacity. Sharding does not help — <C color="crimson">the key hashes to exactly one node</C>, so that node saturates while the rest idle.

Typical causes: a celebrity's profile, a flash-sale product, a viral post, a global config value read on every request.

| Defence | How it works |
| :--- | :--- |
| **Local (L1) cache** | Each app server caches the hot key in-process for a few seconds. <C color="green">Removes nearly all network traffic for it</C> |
| **Key splitting** | Store `hot_key:1` … `hot_key:N` with identical values; readers pick one at random, spreading load across nodes |
| **Replicate to all nodes** | Write the key to every cache node; any node can serve it |
| **Client-side rate limiting** | Cap how often each client re-fetches |

<C color="green">The two-tier approach — a small in-process cache with a 1–5 second TTL in front of Redis — is the usual answer.</C> It costs a few seconds of extra staleness and removes essentially all hot-key network load, because 50 servers make 50 requests per interval instead of 50,000.

<Depth title="What to do when the cache itself goes down">

The failure people plan for least, and the one that most reliably causes an outage — because the origin is sized on the assumption that the cache is working.

**The arithmetic is unforgiving.** A 99% hit ratio means the database handles 1% of traffic. Lose the cache and it receives **100× its normal load**, instantly. A database comfortably serving 500 QPS now sees 50,000 and does not degrade gracefully — it saturates, times out, and takes the application with it.

<H>Any system with a high hit ratio has an origin that cannot survive a cache outage. That is not a flaw to fix by over-provisioning the database — it is a property to design around.</H>

**Four defences, in order of value:**

**1. Load shedding at the origin.** When the database is saturated, reject requests quickly rather than queueing them. A fast `503` for 90% of requests while serving 10% correctly is far better than every request timing out after 30 seconds — [queueing goes non-linear near saturation](../01-foundations/04-latency-numbers.md), so an unbounded queue guarantees total failure.

**2. Circuit breaker in front of the database.** After a failure threshold, stop sending requests entirely for a cooldown, then let a trickle through to test recovery. This converts "hammer the dying database" into "let it recover", and it is the difference between a 2-minute incident and a 40-minute one.

**3. A second cache tier.** An in-process L1 cache means a Redis outage does not take the hit ratio to zero — it falls to whatever L1 provides, often 40–70% for hot keys. <C color="green">The origin sees 30% of traffic instead of 100%</C>, which may be survivable where 100% is not. This is the strongest structural defence.

**4. Serve stale during the outage.** If your L1 or CDN holds expired entries, serve them rather than failing. `stale-if-error` does this at the HTTP layer. <C color="green">Degrading to stale data is almost always better than degrading to errors</C>, and it should be an explicit decision per endpoint rather than an accident.

**Fail open or fail closed?** When the cache is unreachable, do you query the database or return an error?

- <C color="green">**Fail open** is right when the origin can absorb the traffic</C>, or when the cache is a latency optimisation rather than a capacity one.
- <C color="orange">**Fail closed — or heavily shed** — is right when the origin cannot</C>, because failing open converts a cache outage into a database outage, which is far harder to recover from. A dead database also affects every other feature sharing it.

**Test it.** A `redis-cli SHUTDOWN` in a staging environment under production-like load answers the question definitively, and it is worth doing before the answer is discovered in production. <C color="crimson">Most teams have never tried it, and discover their fail-open behaviour during an incident.</C>

</Depth>

---

## 5. Quick reference

| Symptom | Failure | First fix |
| :--- | :--- | :--- |
| Periodic DB spikes matching a TTL | Stampede | Request coalescing |
| High miss rate, many "not found" | Penetration | Negative caching + Bloom filter |
| Huge miss spike after deploy or restart | Avalanche | Jitter TTLs; warm before serving |
| One cache node hot, others idle | Hot key | Local L1 cache; key splitting |
| Total outage when cache restarts | Cache dependency | Circuit breaker; load shedding; L1 tier |

---

## 6. In a design discussion

- **"Request coalescing so one recompute serves all waiters, plus a soft TTL so nobody waits for it at all."** The two fixes that matter, together.
- **"A Bloom filter in front for penetration — false positives just cause a normal lookup, so the failure mode is harmless."** Shows why the structure fits.
- **"Jittered TTLs, or everything we warm at deploy expires in the same second forever."** A one-line fix for a real recurring failure.
- **"At a 99% hit ratio, losing the cache means 100× load on the database. We need a circuit breaker and load shedding, or a cache restart is an outage."** The arithmetic that makes the point.

---

## Rapid-fire recall

1. Name the four classic cache failure modes.
2. Why does a stampede compound rather than resolve itself?
3. Give three stampede fixes and the idea they share.
4. What is cache penetration, and why is it an effective attack?
5. Why is negative caching alone insufficient, and what completes it?
6. Why are Bloom filter false positives acceptable here?
7. Name three self-inflicted causes of a cache avalanche.
8. Why does sharding not help with a hot key, and what does?
9. At a 99% hit ratio, what load does the origin see when the cache dies?
10. When is failing open wrong, and what should you do instead?

<details>
<summary>Answers</summary>

1. **Stampede** (thundering herd) · **penetration** (requests for non-existent keys) · **avalanche** (mass simultaneous expiry) · **hot key** (one key exceeding a node's capacity).
2. Because the recompute takes time, and during that window more requests arrive, miss, and start their own recomputes. Under load the query slows, widening the window — a **positive feedback loop** that does not self-correct, often exhausting connection pools and spreading to unrelated endpoints.
3. **Request coalescing** (one recompute, others wait) · **stale-while-revalidate** via a soft TTL · **probabilistic early expiry**. Shared idea: <H>exactly one recompute per expiry, and nobody blocks waiting for it.</H>
4. Requests for keys that **do not exist**, so nothing can ever be cached and every request reaches the database. It is an effective attack because the attacker only needs to generate random ids — trivially cheap for them, expensive for you.
5. Because random non-existent ids create an **unbounded number of distinct keys**, filling memory. Complete it with a **Bloom filter** of existing ids, a short TTL on negative entries, and a dedicated memory limit.
6. Because a false positive only causes a **normal lookup** — the request proceeds as it would have anyway. A false negative would wrongly claim data does not exist, and Bloom filters cannot produce those.
7. A **deploy warming thousands of keys with identical TTLs** · a **cache node restarting** and losing everything · a **batch job populating entries in a loop** with the same TTL.
8. Because the key hashes to **exactly one node**, so sharding cannot spread it — that node saturates while others idle. Fixes: an **in-process L1 cache**, **key splitting** across N replicas of the value, or **replicating the key to every node**.
9. **100× normal load**, instantly — the origin was handling 1% of traffic and now receives all of it.
10. When the **origin cannot absorb full traffic**, failing open converts a cache outage into a database outage, which is harder to recover from and affects every other feature sharing that database. Instead **shed load aggressively**, use a **circuit breaker**, and **serve stale data** where possible.

</details>

---

**Next:** Asynchronous and Event-Driven — message queues, streams, workers and backpressure. *(Coming next.)*
