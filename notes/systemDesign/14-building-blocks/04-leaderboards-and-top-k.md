---
title: Leaderboards and Top-K
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Leaderboards and Top-K

> **What you will be able to do after this page**
>
> - Serve a ranked leaderboard without sorting the whole set on every read.
> - Answer "what is my rank?" for a user outside the top 100.
> - Find the top-K items in a stream too large to count exactly.
> - Recognise why time-windowed rankings are much harder than all-time ones.

Ranking appears constantly — leaderboards, trending, most-viewed, top sellers. <C color="orange">The naive implementation works until the set grows, then becomes the most expensive query in the system.</C>

<Plain>

A running club posts a results board.

**The naive way:** keep every runner's time in a drawer, and whenever someone asks for the top ten, tip out all fifty thousand slips and sort them. It works, it takes an hour, and it is done from scratch each time.

**The obvious improvement:** keep the slips **permanently in order**. Adding a new time means finding its place and inserting it — seconds, not an hour. Reading the top ten is just taking the first ten off the pile.

That is nearly the whole solution, and one question remains awkward. A runner asks: *"where am I?"* If they are 8,000th, you cannot see that from the top of the pile. You would have to count down through eight thousand slips.

So the pile is kept differently — <C color="green">grouped in a structure that lets you count how many slips are above a position without touching them individually</C>, the way a well-organised filing cabinet tells you a drawer holds 400 without counting.

And there is a harder question the club has not solved. *"Who is fastest **this month**?"* The ordered pile mixes every year together. Answering it means either keeping a separate pile per month, or continuously removing slips as they age — and that is genuinely more work than the all-time board.

</Plain>

---

## 1. The sorted set

<Jargon
  plain="A collection kept permanently in score order, supporting fast insert, range read, and rank lookup."
  term="sorted set"
  also={['ZSET', 'skip list', 'ordered set']}>

Redis's `ZSET` is the standard implementation, backed by a **skip list** plus a hash map. <C color="green">Insert, update, rank lookup and range read are all `O(log N)`</C>, which makes leaderboards a solved problem for anything that fits in memory.

</Jargon>

```
  ZADD   leaderboard 4820 "alice"       O(log N)   add or update a score
  ZINCRBY leaderboard 50 "alice"        O(log N)   atomic increment
  ZREVRANGE leaderboard 0 9 WITHSCORES  O(log N + 10)  top 10
  ZREVRANK leaderboard "alice"          O(log N)   "what is my rank?"
  ZCOUNT leaderboard 1000 2000          O(log N)   how many in a score band
```

<C color="green">`ZREVRANK` is the operation that makes this worth using.</C> A sorted list in a database can give you the top 10 cheaply; answering *"what is the rank of user 8,842,113?"* requires counting rows ahead of them, which is `O(N)`. A skip list maintains span counts at each level, so rank is a descent, not a scan.

<Trace title="A leaderboard for 50 million players" subtitle="Watch what each approach costs per query.">

<TraceStep
  title="SQL with ORDER BY"
  cost="unusable"
  state={{ 'Top 10': 'sorts 50M rows', 'My rank': 'counts 8M rows', 'Write cost': 'cheap', 'Verdict': 'no' }}
  changed={['Top 10', 'My rank', 'Verdict']}
  note="Works fine at 10,000 players, which is why it ships and then fails later.">

`SELECT … ORDER BY score DESC LIMIT 10` on an unindexed column sorts everything.

</TraceStep>

<TraceStep
  title="Add an index on score"
  state={{ 'Top 10': 'fast — index scan', 'My rank': 'still counts 8M rows', 'Write cost': 'index update', 'Verdict': 'partial' }}
  changed={['Top 10', 'My rank', 'Write cost', 'Verdict']}
  note="The top-K query is solved; the rank query is not, and rank is what users actually ask for.">

<C color="green">Top 10 becomes cheap.</C> <C color="crimson">`COUNT(*) WHERE score > mine` still scans</C> — and every player wants their own rank.

</TraceStep>

<TraceStep
  title="Redis sorted set"
  state={{ 'Top 10': 'O(log N)', 'My rank': 'O(log N)', 'Write cost': 'O(log N)', 'Verdict': 'solved' }}
  changed={['Top 10', 'My rank', 'Write cost', 'Verdict']}
  note="Skip-list span counts make rank a tree descent rather than a scan.">

<C color="green">Every operation is logarithmic</C>, including rank — roughly 25 hops for 50 million members.

</TraceStep>

<TraceStep
  title="Memory check"
  state={{ 'Members': '50M', 'Memory': '~5–8 GB', 'Fits one instance': 'yes, just', 'Verdict': 'workable' }}
  changed={['Members', 'Memory', 'Fits one instance']}
  note="Roughly 100–150 bytes per member with the skip list and hash map overhead.">

Sizeable but feasible. <C color="orange">Beyond this, you shard.</C>

</TraceStep>

<TraceStep
  title="The sharding problem"
  cost="global rank breaks"
  state={{ 'Shards': '10', 'Top 10 global': 'merge 10 shard tops — fine', 'My global rank': 'BROKEN', 'Verdict': 'needs a different answer' }}
  changed={['Shards', 'Top 10 global', 'My global rank', 'Verdict']}
  note="Top-K merges cleanly across shards. Exact global rank does not — it requires counting on every shard.">

Top-10 is easy: take the top 10 from each shard and merge. <C color="crimson">Exact global rank is not</C> — it needs a count above your score from **every** shard on every query.

</TraceStep>

<TraceStep
  title="Approximate rank instead"
  state={{ 'Shards': '10', 'My global rank': 'estimated from a score histogram', 'Error': '~1%', 'Verdict': 'good enough' }}
  changed={['My global rank', 'Error', 'Verdict']}
  note="Maintain a coarse histogram of score buckets; rank ≈ sum of counts in higher buckets, refined within the bucket.">

<H>Nobody outside the top few hundred needs their exact rank. "Rank ~84,200 of 50 million" is indistinguishable from the exact number to the person reading it, and it is enormously cheaper.</H>

</TraceStep>

</Trace>

---

## 2. Time-windowed rankings

*"Top players this week"* is much harder than all-time, because the set is continuously changing at both ends.

| Approach | How | Trade |
| :--- | :--- | :--- |
| **Bucket per period** | `leaderboard:2026-W36`, TTL on the key | <C color="green">Simple, exact, self-cleaning</C>; only whole periods |
| **Union of buckets** | `ZUNIONSTORE` over 7 daily keys | <C color="green">Rolling windows</C>; cost grows with bucket count |
| **Sliding with decay** | Multiply scores by a decay factor periodically | <C color="green">Cheap, smooth</C>; approximate, and "top this week" is fuzzy |
| **Full event log** | Recompute from raw events | Exact and expensive |

<C color="green">Bucketing by period is the right default</C>: write to `leaderboard:daily:2026-09-02` and `leaderboard:alltime` on every score, set a TTL on the daily key, and union the last N when a rolling window is needed.

**Time decay** deserves a mention because it is what "trending" usually means. Rather than a hard window, multiply every score by a factor periodically — `score = score × 0.95` hourly — so recent activity dominates and old activity fades. <C color="green">Cheap, produces a natural-looking ranking</C>, and it is not a precise "last 24 hours".

---

## 3. Top-K in a stream

When the item space is too large to keep a counter per item — trending hashtags, top URLs, heaviest API consumers — you cannot maintain an exact sorted set.

<Depth title="Approximate top-K, and why exact counting is impossible at scale">

**Why exact fails.** Counting the top 10 hashtags from a billion-event stream exactly requires a counter for **every distinct hashtag** — hundreds of millions of entries, most seen once. The memory goes to the long tail, which by definition can never be in the top 10.

**Count-Min Sketch plus a heap** is the standard answer.

A **Count-Min Sketch** is a 2D array of counters, `d` rows by `w` columns, with one hash function per row:

```
  increment(x):  for each row i:  count[i][hash_i(x) % w] += 1
  estimate(x):   min over rows of count[i][hash_i(x) % w]
```

Collisions cause **overestimates only** — another item's increments can inflate a cell, never deflate it. Taking the **minimum** across rows keeps the error small, because an item is unlikely to collide in every row.

Pair it with a small **min-heap of the current top K**: on each event, increment the sketch, estimate the count, and if it exceeds the heap's minimum, insert it.

<C color="green">Memory becomes constant — a few megabytes regardless of how many distinct items exist.</C>

**The error direction matters, as always.** Counts are overestimates, so an item may be wrongly promoted into the top K but a genuinely heavy hitter is **never missed** — its true count is at least its estimate. For "trending", occasionally including something slightly too low is harmless; missing a genuine trend is not.

**Space-Saving** is an alternative worth knowing: keep exactly K counters, and when a new item arrives that is not tracked, replace the current minimum and inherit its count. Simpler, bounded by construction, and it provides a guarantee that any item above a computable frequency threshold is definitely in the result.

**The practical arrangement in production:**

| Layer | Structure |
| :--- | :--- |
| Per-node, per-minute | Count-Min Sketch + heap, in memory |
| Aggregation | Sketches are **mergeable** — sum them across nodes |
| Serving | Materialised top-K list in Redis, refreshed periodically |
| Exact numbers, if needed | Batch job over the event log, hourly |

<C color="green">Mergeability is the property that makes this work at scale</C>: each node builds a sketch independently and they are summed to give a sketch of the whole stream — no coordination, no shuffling of raw events. HyperLogLog has the same property for distinct counts, which is why both appear in every large analytics pipeline.

**A caution on gaming.** Any public ranking will be manipulated — bots, click farms, coordinated voting. <C color="orange">The countermeasures are not ranking problems</C>: deduplicate by account and device, weight by account age and reputation, rate-limit contributions per actor, and detect coordinated bursts. A leaderboard with no anti-abuse layer measures determination rather than merit.

</Depth>

---

## 4. In a design discussion

- **"Redis sorted set — `ZREVRANK` gives 'what is my rank' in `O(log N)`, which is the query SQL can't do cheaply."** Names the operation that decides the choice.
- **"Daily keys with a TTL plus an all-time key, unioned for rolling windows. Time-windowed ranking is the hard part, not top-K."** Correct framing.
- **"Exact global rank across shards needs a count on every shard per query. I'd serve an approximate rank from a score histogram — nobody outside the top 100 can tell."** Relaxes the requirement deliberately.
- **"Count-Min Sketch plus a heap for trending. It overestimates, so we might include something marginal but never miss a real trend."** The error direction, again.

---

## Rapid-fire recall

1. Why does an index on `score` solve top-K but not rank?
2. What structure backs a Redis sorted set, and what makes rank logarithmic?
3. Give the complexity of add, top-K and rank in a sorted set.
4. Roughly how much memory does a 50M-member sorted set need?
5. Which leaderboard query merges cleanly across shards, and which does not?
6. Why is approximate rank acceptable, and how would you compute one?
7. Give four approaches to time-windowed rankings and the sensible default.
8. What does time decay give you, and what does it not?
9. Why is exact top-K impossible on a large stream, and what replaces it?
10. Why does Count-Min Sketch take the minimum across rows, and which error can it not make?

<details>
<summary>Answers</summary>

1. Because top-K is an **index scan of the first K entries**, while rank requires **counting every row ahead of you** — `O(N)` in the number of higher scores, which is millions for a mid-table player.
2. A **skip list** plus a hash map. The skip list maintains **span counts at each level**, so rank is computed during the descent rather than by scanning.
3. **`O(log N)`** for add/update, **`O(log N + K)`** for top-K, **`O(log N)`** for rank.
4. Roughly **5–8 GB** — about 100–150 bytes per member including skip-list and hash-map overhead.
5. **Top-K merges cleanly** — take the top K from each shard and merge. **Exact global rank does not** — it requires a count of higher scores from every shard on every query.
6. Because **nobody outside the top few hundred can distinguish an exact rank from a close estimate**. Compute it from a **coarse score histogram**: sum the counts of higher buckets, then refine within the user's own bucket.
7. **Bucket per period with a TTL** (the sensible default) · **union of buckets** for rolling windows · **sliding with time decay** · **recompute from a full event log**.
8. It gives a **cheap, smooth "trending" ranking** where recent activity dominates and old activity fades. It does **not** give a precise "last 24 hours" — the window is fuzzy by construction.
9. Because it requires a counter for **every distinct item**, and the memory is consumed by a long tail that can never be in the top K. Replaced by a **Count-Min Sketch plus a min-heap** of the current top K.
10. Because collisions only ever **add** to a cell, so every row's value is an overestimate — the **minimum** is the tightest bound available. It can overestimate but **never underestimate**, so a genuine heavy hitter is never missed.

</details>

---

**Next:** [Counters at Scale](./05-counters-at-scale.md) — the simplest thing in the system, and one of the hardest to scale.
