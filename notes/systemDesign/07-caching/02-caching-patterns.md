---
title: Caching Patterns
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Caching Patterns

> **What you will be able to do after this page**
>
> - Name the five patterns and say who is responsible for each write.
> - Implement cache-aside correctly, including the race that corrupts it.
> - Choose a write pattern from your durability and latency requirements.
> - Explain why "delete the cache entry" beats "update the cache entry".

The patterns differ on one axis: <C color="orange">who talks to the cache, and in what order relative to the database.</C> Get the order wrong and you cache a value that was never true.

<Plain>

A librarian keeps a small shelf of popular books behind the desk so she does not walk to the stacks every time.

There are a few arrangements, and they are genuinely different jobs.

**She checks the shelf; if it is empty, she fetches from the stacks and puts a copy on the shelf.** Simple, and only books people actually ask for end up on the shelf.

**A system does the fetching for her** — she only ever talks to the shelf, and something behind it quietly retrieves anything missing. Less for her to think about, and less control.

Then there are the arrangements for **new** books, and these matter more:

**File it in the stacks and put it on the shelf at the same time.** Slower, and the shelf is never wrong.

**Put it on the shelf now and file it in the stacks later.** Fast — and if the building floods before filing, <C color="crimson">the only copy was on the shelf and it is gone.</C>

One last thing, and it is the subtlest. When a book is revised, the librarian could put the new edition on the shelf. Or she could simply **throw away the shelf copy** and let the next person's request pull the current one from the stacks.

<C color="green">Throwing it away is nearly always better</C>, because a shelf copy she updated might have been overwritten by a colleague mid-task — but an empty space is never wrong. It just means "go and look".

</Plain>

---

## 1. The five patterns

| Pattern | Who reads | Who writes to cache | Main risk |
| :--- | :--- | :--- | :--- |
| **Cache-aside** | App checks cache, then DB | <C color="orange">App, after reading DB</C> | Races; stale entries |
| **Read-through** | App asks cache only | Cache library, on miss | Less control |
| **Write-through** | — | <C color="green">Cache, synchronously with DB</C> | Slower writes |
| **Write-behind** | — | Cache now, DB later | <C color="crimson">Data loss on crash</C> |
| **Refresh-ahead** | — | Cache refreshes before expiry | Wasted work on cold keys |

<Jargon
  plain="The application checks the cache itself, and fills it after fetching from the database."
  term="cache-aside"
  also={['lazy loading', 'look-aside caching']}>

<C color="green">The default pattern, used by the overwhelming majority of systems.</C> The cache holds only what has been requested, it survives cache outages naturally, and the application stays in control — at the cost of that logic living in your code.

</Jargon>

---

## 2. Cache-aside, and its race

```
  READ:
    v = cache.get(k)
    if v is null:
        v = db.query(k)
        cache.set(k, v, ttl)
    return v

  WRITE:
    db.update(k, v)
    cache.delete(k)      ← delete, do not set. See below.
```

Simple, and it contains a race that corrupts the cache indefinitely.

<Trace title="The cache-aside race" subtitle="A read and a write interleave. The cache ends up permanently wrong.">

<TraceStep
  title="Initial state"
  state={{ 'DB value': 'A', 'Cache': 'empty', 'Reader has': '—', 'Cache correct?': 'yes' }}
  note="Cache miss about to happen. Nothing unusual.">

The key is not cached. A read request arrives.

</TraceStep>

<TraceStep
  title="Reader misses and queries the DB"
  state={{ 'DB value': 'A', 'Cache': 'empty', 'Reader has': 'A', 'Cache correct?': 'yes' }}
  changed={['Reader has']}
  note="The reader now holds value A in memory — and has not written it to the cache yet. That gap is the whole problem.">

The reader gets `A` from the database. <C color="orange">It is about to write `A` into the cache</C>, but is paused — GC, a slow network, a rescheduled thread.

</TraceStep>

<TraceStep
  title="A writer updates the DB and clears the cache"
  state={{ 'DB value': 'B', 'Cache': 'empty (deleted)', 'Reader has': 'A (stale)', 'Cache correct?': 'yes' }}
  changed={['DB value', 'Cache']}
  note="The writer did everything correctly. The cache is empty, which is always a safe state.">

A concurrent writer sets the value to `B` and deletes the cache entry. <C color="green">Correct behaviour.</C>

</TraceStep>

<TraceStep
  title="The reader wakes and writes its stale value"
  cost="cache poisoned"
  state={{ 'DB value': 'B', 'Cache': 'A (WRONG)', 'Reader has': 'A', 'Cache correct?': 'NO' }}
  changed={['Cache', 'Cache correct?']}
  note="The stale value now persists for the full TTL — and every reader gets it. No error was raised anywhere.">

The reader resumes and executes `cache.set(k, 'A')`.

<C color="crimson">The cache now holds `A` while the database holds `B`, and it will stay wrong until the TTL expires.</C>

</TraceStep>

<TraceStep
  title="Mitigation 1 — always set a TTL"
  state={{ 'DB value': 'B', 'Cache': 'A, expires in 60 s', 'Reader has': 'A', 'Cache correct?': 'no, but bounded' }}
  changed={['Cache', 'Cache correct?']}
  note="Not a fix — a bound. It converts unbounded corruption into bounded staleness, which is why every entry should have a TTL.">

A TTL guarantees the wrong value cannot live forever. <C color="green">Every cache entry should have one, even when you also invalidate explicitly.</C>

</TraceStep>

<TraceStep
  title="Mitigation 2 — delete again, after a delay"
  state={{ 'DB value': 'B', 'Cache': 'empty', 'Reader has': 'A', 'Cache correct?': 'yes' }}
  changed={['Cache', 'Cache correct?']}
  note="Delayed double delete. Ugly, widely used, and effective when the write path can afford it.">

The writer deletes the entry, waits a short interval (longer than a typical read), and **deletes it again** — clearing anything a paused reader wrote in between.

</TraceStep>

<TraceStep
  title="Mitigation 3 — set only if unchanged"
  state={{ 'DB value': 'B', 'Cache': 'empty', 'Reader has': 'A (rejected)', 'Cache correct?': 'yes' }}
  changed={['Reader has']}
  note="The cleanest fix where your cache supports it — Redis WATCH/MULTI, or a version stamped alongside the value.">

The reader's write is conditional on a version it read alongside the value. Since the writer bumped the version, <C color="green">the reader's `set` is rejected.</C>

<H>Note that all three mitigations exist because the read path writes to the cache. That is inherent to cache-aside, and it is the price of its simplicity.</H>

</TraceStep>

</Trace>

### Delete, do not update

On a write, <C color="green">delete the cache entry rather than setting it to the new value.</C> Three reasons:

1. **Concurrent writers.** Two writers setting the cache can land in the opposite order from their database writes, leaving the cache holding the older value permanently. Two writers *deleting* cannot conflict — the result is always "empty", which is always safe.
2. **Wasted work.** The value may never be read again. Computing and caching it is speculative.
3. **Shape mismatch.** The cached value is often a rendered or composed object, not the raw row. Reconstructing it on the write path duplicates read-path logic.

---

## 3. Write patterns

### Write-through

Write to cache and database **synchronously**, as one operation.

<C color="green">The cache is never stale, and reads after writes are always correct.</C>
<C color="crimson">Every write pays both latencies, and you cache data that may never be read.</C>

Good when the same data is written then immediately read — a user profile update followed by a profile page load.

### Write-behind (write-back)

Write to the cache, acknowledge, and flush to the database asynchronously.

<C color="green">Very fast writes, and multiple updates to one key collapse into a single database write</C> — genuinely powerful for hot counters.
<C color="crimson">A cache crash loses acknowledged writes.</C> You have made a cache the system of record for a window.

Acceptable for view counts and metrics; <C color="crimson">unacceptable for orders or payments</C> unless the buffer is itself durable and replicated.

### Refresh-ahead

Refresh entries shortly **before** they expire, for keys predicted to be needed.

<C color="green">Users never hit an expiry-time miss</C> — the latency cliff disappears.
<C color="crimson">Wasted work</C> when the prediction is wrong. Effective for a small set of very hot keys; wasteful applied broadly.

In practice, [`stale-while-revalidate`](../03-traffic-and-edge/03-cdn.md) achieves most of the benefit reactively and is simpler.

<Depth title="Why you cannot make the cache and database atomic, and what to do instead">

The cache and the database are separate systems, so any update touching both is a **dual write** — the same problem as [publishing an event alongside a state change](../06-distributed-systems/06-distributed-transactions.md).

Every ordering has a failure:

```
  update DB, then delete cache   → delete fails ⇒ cache stale until TTL
  delete cache, then update DB   → a read between them repopulates the cache
                                    with the OLD value ⇒ stale until TTL
  delete, update, delete         → better, still not atomic
```

<C color="orange">There is no ordering that is safe under arbitrary failure</C>, because you cannot commit across two systems. What you can do is bound and detect the damage.

**Practical hierarchy, cheapest first:**

**1. TTL on everything.** Converts unbounded staleness into bounded staleness. This alone is enough for most data, and it is why a cache entry with no TTL is a latent bug.

**2. Update DB first, then delete cache.** The better of the two simple orderings — a failure leaves the cache stale for the TTL, while the reverse can repopulate stale data immediately and is more likely to be hit.

**3. Retry the delete.** Queue the invalidation so a transient cache failure does not leave a stale entry. This turns a lost delete into a delayed one.

**4. Invalidate from the replication log.** The most robust approach: a [CDC](../05-data-at-scale/04-zero-downtime-migrations.md) consumer tails the database's log and deletes cache keys for changed rows.

Why this is qualitatively better: <C color="green">the invalidation is driven by the database's own record of what actually committed.</C> It cannot be skipped by a code path that forgot to invalidate, it catches writes from cron jobs, admin tools and manual `psql` sessions, and it survives application crashes because the log position is durable. The cost is a small lag and another component to run.

**5. Versioned keys.** Include a version in the cache key — `user:42:v7`. An update bumps the version, so the new key **misses** naturally and the old entry is never read again. <C color="green">Invalidation becomes unnecessary</C>; old entries simply age out. The cost is holding the current version somewhere (often itself cached), and some wasted memory until eviction.

<H>Notice the pattern across all five: none of them make the two systems atomic. They either bound how long a mistake can persist, or arrange for mistakes to be self-correcting. That is the honest state of the art — "cache invalidation is hard" means "it cannot be made exact, so bound it instead".</H>

</Depth>

---

## 4. Choosing

| Requirement | Pattern |
| :--- | :--- |
| General-purpose read caching | <C color="green">Cache-aside</C> + TTL |
| Read-heavy, want the logic hidden | Read-through |
| Write then immediately read | Write-through |
| Very high write rate, loss tolerable | Write-behind |
| A few extremely hot keys | Refresh-ahead or `stale-while-revalidate` |
| Cache correctness is critical | <C color="green">Cache-aside + CDC invalidation</C> |

<C color="green">Start with cache-aside plus a TTL.</C> It handles cache outages gracefully, caches only what is used, and is understood by everyone who will read your code. Move to CDC invalidation when staleness becomes a real problem — not before.

---

## 5. In a design discussion

- **"Cache-aside with a TTL on every entry. The TTL isn't the invalidation strategy — it's the bound on how wrong we can be when invalidation fails."** Shows why TTLs matter even with explicit invalidation.
- **"Delete rather than update on write — two concurrent writers setting the cache can land out of order and leave it permanently stale."** The reason behind the rule.
- **"Update the database first, then delete. The reverse lets a concurrent read repopulate the old value."** Correct ordering with the reason.
- **"For correctness-critical caches I'd invalidate from CDC — it catches writes from cron jobs and manual sessions that application-level invalidation misses."** The robust option.

---

## Rapid-fire recall

1. Name the five patterns and who writes to the cache in each.
2. Write the cache-aside read and write paths.
3. Describe the cache-aside race step by step.
4. Give three mitigations for that race and say which is a bound rather than a fix.
5. Give three reasons to delete rather than update on write.
6. Compare write-through and write-behind on latency and durability.
7. When is write-behind acceptable and when is it not?
8. Why is refresh-ahead usually replaced by `stale-while-revalidate`?
9. Why is "update DB then delete cache" better than the reverse?
10. Give two reasons CDC-based invalidation is more robust than application-level.

<details>
<summary>Answers</summary>

1. **Cache-aside** — the app, after reading the DB. **Read-through** — the cache library, on miss. **Write-through** — the cache, synchronously with the DB. **Write-behind** — the cache immediately, DB later. **Refresh-ahead** — the cache, before expiry.
2. **Read**: get from cache; on miss query the DB, set the cache with a TTL, return. **Write**: update the DB, then **delete** the cache key.
3. A reader misses and fetches value `A`, then pauses before writing it to the cache. A writer updates the DB to `B` and deletes the (empty) cache entry. The reader resumes and sets `A` — so the cache holds `A` while the DB holds `B`, for the full TTL.
4. **TTL** (a *bound*, not a fix — it limits how long the wrong value survives) · **delayed double delete** · **conditional set on a version**.
5. **Concurrent writers** setting the cache can land in the opposite order from their DB writes and leave it permanently stale, while two deletes always produce the safe "empty" state · the value **may never be read** · the cached value's **shape often differs** from the raw row, duplicating read-path logic on the write path.
6. **Write-through**: slower writes (both latencies paid), cache never stale, no data loss. **Write-behind**: very fast writes and write coalescing, but **acknowledged writes can be lost** if the cache crashes before flushing.
7. Acceptable for **view counts, metrics, telemetry** — high volume, loss tolerable. Not acceptable for **orders or payments**, unless the write buffer is itself durable and replicated.
8. Because `stale-while-revalidate` gets most of the benefit **reactively** — serving the stale value and refreshing in the background — without needing to predict which keys will be needed, and so without wasted refreshes on cold keys.
9. Because deleting first opens a window where a concurrent read **repopulates the cache with the old value** before the DB is updated — stale immediately and for the full TTL. Updating first means a failed delete leaves a stale entry that the TTL still bounds.
10. It is driven by **what actually committed**, so it cannot be skipped by a code path that forgot to invalidate, and it **catches writes from cron jobs, admin tools and manual sessions** that never go through your application code.

</details>

---

**Next:** [Eviction and Invalidation](./03-eviction-and-invalidation.md) — what to throw away, and when to admit a value is wrong.
