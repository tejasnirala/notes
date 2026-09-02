---
title: Bloom Filters
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Bloom Filters

> **What you will be able to do after this page**
>
> - Explain how a Bloom filter answers a membership question in constant space.
> - Say why false positives are acceptable and false negatives impossible.
> - Size one for a target error rate, from two numbers.
> - Recognise the places you have already met one without noticing.

A structure that answers *"have I seen this before?"* using a tiny fraction of the memory the full set would need. <C color="orange">It buys that by being allowed to be wrong in exactly one direction.</C>

<Plain>

A librarian is asked constantly: *"do you have this book?"* Checking the catalogue takes a walk to the back office.

Most of the time the answer is no — people ask about books the library never bought. Those walks are pure waste.

So the librarian keeps a card at the desk with a hundred boxes on it. Whenever a book arrives, they use its title to pick three boxes in a fixed way and tick them. Different titles tick different combinations.

Now when someone asks, the librarian checks the three boxes for that title.

**Any box empty?** <C color="green">The book is definitely not here</C> — if it were, that box would have been ticked when it arrived. No walk needed.

**All three ticked?** <C color="orange">It is probably here.</C> Possibly not — three *other* books may have each ticked one of those boxes between them. So the librarian walks to the office to check properly.

The card cannot fit a hundred thousand titles, and it does not need to. It only needs to catch the obvious noes, and it catches nearly all of them.

<H>The asymmetry is the whole design. Being wrong about "probably here" costs a wasted walk. Being wrong about "definitely not here" would send someone away from a book that exists — and the structure makes that impossible.</H>

</Plain>

---

## 1. How it works

A bit array of size `m`, and `k` independent hash functions.

```
  ADD "apple":   h1→3, h2→11, h3→17     set bits 3, 11, 17
  ADD "banana":  h1→7, h2→11, h3→22     set bits 7, 11, 22   (11 already set)

  bits:  0 0 0 1 0 0 0 1 0 0 0 1 0 0 0 0 0 1 0 0 0 0 1 …
               3       7       11          17        22

  TEST "cherry": h1→3, h2→9, h3→17
                 bit 9 is 0  →  DEFINITELY NOT PRESENT

  TEST "apple":  bits 3, 11, 17 all set  →  PROBABLY PRESENT
```

<Jargon
  plain="A structure that can say 'definitely not' with certainty, and 'probably yes' with a known error rate."
  term="a probabilistic data structure"
  also={['approximate membership query', 'AMQ filter']}>

The family also includes **HyperLogLog** (counting distinct items in ~12 KB) and **Count-Min Sketch** (frequency estimates). <C color="green">All trade exactness for a dramatic reduction in space</C>, with a bounded and calculable error.

</Jargon>

**The two properties that define it:**

- <C color="green">**No false negatives.**</C> If it says "not present", that is certain — because adding an item sets its bits, and bits are never cleared.
- <C color="crimson">**False positives are possible.**</C> Other items' bits can coincidentally cover all `k` positions.

<C color="crimson">You cannot delete from a standard Bloom filter.</C> Clearing bits would break other items that share them, introducing false negatives. (Counting Bloom filters and cuckoo filters support deletion, at higher cost.)

---

## 2. Sizing one

Two inputs: expected item count `n` and acceptable false-positive rate `p`.

```
  m = -(n × ln p) / (ln 2)²        bits needed
  k = (m / n) × ln 2               optimal hash count
```

<Trace title="Sizing a filter for 10 million user ids" subtitle="Watch the space cost against the error rate.">

<TraceStep
  title="The naive alternative"
  state={{ 'Items': '10M', 'Structure': 'hash set of ids', 'Memory': '~400 MB', 'Error rate': '0%' }}
  changed={['Items', 'Structure', 'Memory']}
  note="Exact, and 400 MB per process — impossible to hold on every application server.">

Storing 10M 32-byte ids in a hash set costs hundreds of megabytes plus overhead.

</TraceStep>

<TraceStep
  title="Bloom filter at 1% error"
  cost="~12 MB"
  state={{ 'Items': '10M', 'Structure': 'Bloom filter', 'Memory': '~12 MB', 'Error rate': '1%', 'Bits per item': '~9.6' }}
  changed={['Structure', 'Memory', 'Error rate', 'Bits per item']}
  note="Roughly 10 bits per item for 1% — the number worth memorising.">

`m ≈ 95.8 M bits ≈ 12 MB`, `k = 7`. <C color="green">A 33× reduction, small enough to sit in every process.</C>

</TraceStep>

<TraceStep
  title="Tighten to 0.1%"
  state={{ 'Memory': '~18 MB', 'Error rate': '0.1%', 'Bits per item': '~14.4', 'Hash functions': '10' }}
  changed={['Memory', 'Error rate', 'Bits per item', 'Hash functions']}
  note="Each 10× reduction in error costs about 4.8 more bits per item — a logarithmic, not linear, cost.">

Ten times fewer false positives for **50% more memory**.

</TraceStep>

<TraceStep
  title="Loosen to 10%"
  state={{ 'Memory': '~6 MB', 'Error rate': '10%', 'Bits per item': '~4.8', 'Hash functions': '3' }}
  changed={['Memory', 'Error rate', 'Bits per item', 'Hash functions']}
  note="Even a 'bad' 10% filter eliminates 90% of unnecessary lookups — often plenty.">

<C color="green">Halving memory costs an order of magnitude in accuracy — and 10% may still be entirely acceptable</C> if the point is avoiding a disk read.

</TraceStep>

<TraceStep
  title="Overfill it and it degrades"
  cost="silent failure"
  state={{ 'Items inserted': '40M (sized for 10M)', 'Memory': '~12 MB', 'Error rate': '~55%', 'Useful': 'no' }}
  changed={['Items inserted', 'Error rate', 'Useful']}
  note="Nothing errors. The filter simply stops filtering, and everything falls through to the expensive path.">

Insert four times the planned count and most bits are set, so nearly every query says "probably present".

<H>A Bloom filter degrades silently rather than failing. It must be sized for the maximum item count, and monitored — a filter whose fill ratio has grown past plan is doing no work while still costing memory.</H>

</TraceStep>

</Trace>

**The rule of thumb worth carrying:** <C color="green">~10 bits per item gives ~1% false positives.</C> One million items ≈ 1.2 MB.

---

## 3. Where you have already met one

| System | Use |
| :--- | :--- |
| **LSM databases** (Cassandra, RocksDB) | Skip SSTables that cannot contain a key — [without this, "not found" reads every file](../04-data-storage/03-storage-engines.md) |
| **CDNs and caches** | [Cache penetration defence](../07-caching/04-cache-failure-modes.md) — reject ids that cannot exist |
| **Chrome (historically)** | Check a URL against a malicious-site list locally before a network call |
| **Bitcoin SPV clients** | Request only relevant transactions without revealing which |
| **Databases** | Skip partitions or blocks during scans |
| **Deduplication pipelines** | Cheap "have I processed this?" before the authoritative check |

<C color="orange">The pattern is identical every time: a cheap negative check in front of an expensive authoritative one.</C> The filter never answers definitively — it removes work.

<Depth title="Choosing the right sketch, and the deletion problem">

**When a plain Bloom filter is wrong:**

**You need deletion.** Standard filters cannot remove items. Two options:

- **Counting Bloom filter** — replace each bit with a small counter (typically 4 bits), incremented on add and decremented on delete. <C color="crimson">4× the memory</C>, and counters can overflow.
- **Cuckoo filter** — stores small fingerprints in a cuckoo hash table. Supports deletion, and at false-positive rates below ~3% it is **more space-efficient than a Bloom filter** while offering better lookup locality. <C color="green">Generally the better modern choice when deletion is needed.</C>

**The set grows unboundedly.** A filter sized for 10M items and fed 100M becomes useless. Options: **scalable Bloom filters** (chain progressively larger filters), or **rotate** — maintain two filters and periodically discard the older, accepting a window of forgotten items.

**You need a count, not membership.** Use a **Count-Min Sketch**: a 2D array of counters with one hash per row, taking the *minimum* across rows as the estimate. Overestimates only, never underestimates — the same one-directional error discipline. This is what [TinyLFU](../07-caching/03-eviction-and-invalidation.md) uses for cache admission.

**You need a distinct count.** Use **HyperLogLog**: counts unique items to ~2% accuracy in about **12 KB, regardless of cardinality** — a billion distinct items in the space of a small image. It works by tracking the maximum number of leading zeros seen in hashed values, since a long run of leading zeros implies many distinct items were hashed.

**The deeper principle**, which recurs throughout system design:

<H>These structures are useful precisely because they choose *which direction* to be wrong in. A Bloom filter's false positive costs a wasted lookup; a false negative would return incorrect data. Count-Min overestimates so a rate limiter fails closed rather than open.</H>

<C color="green">When you design an approximation, decide the direction of the error deliberately</C> and make sure the harmless direction is the possible one. An approximation that can be wrong in the damaging direction is not a trade-off — it is a bug with a probability attached.

**A practical caution on hashing.** The `k` hash functions need not be independent implementations. The standard technique (Kirsch–Mitzenmacher) derives all `k` from two: `h_i(x) = h1(x) + i × h2(x)`, with no measurable increase in false positives. Use a fast non-cryptographic hash — MurmurHash, xxHash — since cryptographic hashes cost far more than the lookup they save.

</Depth>

---

## 4. In a design discussion

- **"A Bloom filter in front of the lookup — a false positive just costs a normal query, and false negatives are impossible, so the failure mode is harmless."** The asymmetry, which is the reason it fits.
- **"About 10 bits per item for 1% error, so 10 million ids is ~12 MB — small enough to hold in every process."** Sized on the spot.
- **"It has to be sized for maximum item count. Overfilled, it stops filtering silently and everything falls through."** The operational failure.
- **"Cuckoo filter if we need deletion — below 3% error it's actually more space-efficient than Bloom."** Knows the alternative.

---

## Rapid-fire recall

1. What are the two defining properties, and which direction of error is impossible?
2. Why can you not delete from a standard Bloom filter?
3. Give the rule of thumb for bits per item at 1% error, and the size for 1M items.
4. What happens when a filter is overfilled, and why is that dangerous?
5. Why does tightening the error rate 10× cost only ~50% more memory?
6. Why do LSM databases need one?
7. What is the general pattern of use in every system that has one?
8. When would you use a cuckoo filter instead?
9. What does HyperLogLog do, and in roughly how much space?
10. State the design principle about the direction of error.

<details>
<summary>Answers</summary>

1. **No false negatives** (a "not present" answer is certain) and **false positives are possible**. The impossible direction is a false negative — because adding an item sets its bits and bits are never cleared.
2. Because clearing bits would break **other items that share those bits**, introducing false negatives — which would destroy the structure's one guarantee.
3. About **10 bits per item** for ~1% false positives. One million items ≈ **1.2 MB**.
4. Most bits become set, so nearly every query answers "probably present" — the filter **stops filtering while still costing memory**, and nothing errors. Dangerous because it degrades **silently**: everything falls through to the expensive path with no signal.
5. Because the space cost grows with the **logarithm** of the error rate — each 10× reduction costs about 4.8 additional bits per item, not a multiple of the total.
6. Because a read for a **non-existent key** would otherwise have to check every SSTable before concluding "not found". A per-SSTable Bloom filter skips ~99% of those files without touching disk.
7. <C color="orange">A **cheap negative check in front of an expensive authoritative one**.</C> The filter never answers definitively; it removes work.
8. When **deletion is required**. Below ~3% false-positive rate it is also **more space-efficient** than a Bloom filter, with better lookup locality.
9. Counts **distinct items** to ~2% accuracy in about **12 KB regardless of cardinality** — a billion uniques in the space of a small image.
10. <H>Choose which direction the approximation can be wrong in, and make sure the harmless direction is the possible one.</H> An approximation that can err in the damaging direction is a bug with a probability attached.

</details>

---

**Next:** [Geospatial Indexing](./03-geospatial-indexing.md) — answering "what is near me?" without scanning the world.
