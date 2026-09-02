---
title: Counters at Scale
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Counters at Scale

> **What you will be able to do after this page**
>
> - Explain why a single row cannot absorb high-rate increments.
> - Shard a counter, and say what that costs on the read side.
> - Choose an accuracy level deliberately rather than assuming exactness.
> - Recognise the counters that genuinely need to be exact.

Incrementing a number is the simplest operation in any system. <C color="crimson">At high rates against one key it is also one of the hardest to scale</C>, because every writer contends on the same thing.

<Plain>

A stadium counts people through the turnstiles.

**One clicker, one person holding it.** Everyone entering files past them. It works perfectly — and everyone must queue for that one person, so the queue length is set by how fast one thumb moves.

**Twenty clickers, one per gate.** Twenty times the throughput, and now no single clicker knows the total. Getting it means walking round and adding twenty numbers together — which is fine, because it is twenty additions rather than one hundred thousand.

<C color="orange">That is the whole trade, and it flips the cost from writes to reads.</C> One clicker: instant total, terrible throughput. Twenty: excellent throughput, a small cost each time you want the total.

There is a second question the stadium answers without thinking about it. **How accurate does the total need to be?**

For deciding whether to open another entrance, "about 40,000" is perfect. For fire safety limits, it must be exact and defensible.

Those are genuinely different requirements, and the second is far more expensive. <C color="crimson">The mistake is paying for the second when you only needed the first</C> — running exact, coordinated counting for a number displayed as "40K" on a screen.

</Plain>

---

## 1. Why one row does not work

```sql
UPDATE posts SET view_count = view_count + 1 WHERE id = 42;
```

Correct at any [isolation level](../04-data-storage/04-transactions-and-isolation.md) — the database evaluates and writes atomically under a row lock. And that lock is the problem.

<C color="crimson">Every increment must serialise on the same row.</C> Each waits for the previous to commit, so throughput is bounded by transaction commit time — typically a few thousand per second, and much worse across replicas or with `synchronous_commit` on.

The symptoms are distinctive: **lock wait time dominates**, other queries touching the table slow down, and on Postgres the row accumulates dead tuples requiring aggressive vacuuming — <C color="orange">a single hot row can generate more MVCC garbage than the rest of the table combined.</C>

---

## 2. Sharded counters

<Jargon
  plain="Splitting one counter into N counters, summed when read."
  term="sharded (or striped) counter"
  also={['counter striping', 'split counters']}>

Writers pick a shard at random and increment that; readers sum all shards. <C color="green">Write contention drops by a factor of N</C>, at the cost of N reads per read.

</Jargon>

<Trace title="A post going viral" subtitle="One counter, rising write rate. Watch where it breaks and what fixes it.">

<TraceStep
  title="Normal traffic"
  state={{ 'Writes/s': '50', 'Structure': 'one row', 'Lock wait': '~0 ms', 'Read cost': '1 lookup' }}
  changed={['Writes/s', 'Structure']}
  note="Entirely fine. Most counters never leave this state, and optimising them is waste.">

`UPDATE … SET view_count = view_count + 1`. Fifty a second is nothing.

</TraceStep>

<TraceStep
  title="The post is shared widely"
  cost="lock contention"
  state={{ 'Writes/s': '20,000', 'Structure': 'one row', 'Lock wait': '400 ms', 'Read cost': '1 lookup' }}
  changed={['Writes/s', 'Lock wait']}
  note="The whole table slows, not just this row — connections are held waiting.">

<C color="crimson">Every increment queues behind the previous one.</C> Requests time out, connections pile up, and unrelated queries on the same table suffer.

</TraceStep>

<TraceStep
  title="Shard into 100 counters"
  state={{ 'Writes/s': '20,000', 'Structure': '100 rows', 'Lock wait': '~4 ms', 'Read cost': '100 rows summed' }}
  changed={['Structure', 'Lock wait', 'Read cost']}
  note="Each writer picks a random shard, so contention on any one row falls 100×.">

```sql
UPDATE post_counters SET c = c + 1
WHERE post_id = 42 AND shard = floor(random() * 100);
```

<C color="green">Contention is spread.</C> Reads now sum 100 rows — cheap, and no longer free.

</TraceStep>

<TraceStep
  title="Move it out of the database entirely"
  state={{ 'Writes/s': '20,000', 'Structure': 'Redis INCR', 'Lock wait': 'n/a', 'Read cost': '1 lookup' }}
  changed={['Structure', 'Lock wait', 'Read cost']}
  note="Redis handles ~100K ops/s single-threaded, with no MVCC garbage and no transaction overhead.">

`INCR post:42:views` — atomic, in memory, <C color="green">no locks, no vacuum, no WAL.</C> Persist to the database periodically.

</TraceStep>

<TraceStep
  title="Batch at the application layer"
  cost="1,000× fewer writes"
  state={{ 'Writes/s to store': '20', 'Structure': 'in-process buffer → Redis', 'Staleness': '≤1 s', 'Read cost': '1 lookup' }}
  changed={['Writes/s to store', 'Structure', 'Staleness']}
  note="Each server accumulates locally and flushes once a second. 20,000 increments become ~20 writes.">

Aggregate in each process and flush periodically.

<H>Batching is the highest-leverage technique available: increments are commutative and associative, so a thousand of them can be collapsed into one write with no loss of correctness — only a bounded delay.</H>

</TraceStep>

<TraceStep
  title="The cost you accepted"
  cost="up to 1 s of loss"
  state={{ 'Writes/s to store': '20', 'On process crash': 'lose ≤1 s of counts', 'Acceptable for views': 'yes', 'Acceptable for payments': 'NO' }}
  changed={['On process crash', 'Acceptable for views', 'Acceptable for payments']}
  note="This is the decision to make explicitly, not to discover after an incident.">

A crash loses the unflushed buffer. <C color="green">For view counts that is invisible</C>; <C color="crimson">for anything financial it is unacceptable.</C>

</TraceStep>

</Trace>

---

## 3. Choosing an accuracy level

<C color="orange">Most counters do not need to be exact, and treating them all as if they do is the main source of unnecessary cost.</C>

| Counter | Accuracy needed | Approach |
| :--- | :--- | :--- |
| Page views, impressions | <C color="green">Approximate</C> | Batch, sample, or probabilistic |
| Likes, reactions | Approximate | Batched increments |
| Follower count | Approximate | Batched; reconcile periodically |
| Unique visitors | Approximate | <C color="green">HyperLogLog</C> — 12 KB for any cardinality |
| Rate-limit counters | Approximate, <C color="orange">erring high</C> | Redis, [with the caveats](../03-traffic-and-edge/04-rate-limiting.md) |
| Inventory | <C color="crimson">Exact</C> | Transactional, `WHERE stock > 0` |
| Account balance | <C color="crimson">Exact</C> | Transactional, audited |
| Billing usage | <C color="crimson">Exact</C> | Event log, aggregated; never a mutable counter |

<C color="green">Sampling is legitimate and under-used for very high-volume counters</C>: count one event in 100 and multiply by 100. The relative error is small at high volumes, and it cuts write load by 99%. Reddit and others have used this for view counts.

<C color="crimson">The one to be careful with is billing.</C> A mutable counter that can be lost, double-counted or reset is the wrong shape for anything you invoice on. <C color="green">Record immutable events and aggregate them</C> — then the number is reproducible, auditable, and correctable.

<Depth title="Making counters converge, and the CRDT connection">

**The property that makes counters easy to distribute** is that addition is **commutative and associative**: order does not matter, and grouping does not matter. `(a + b) + c = a + (b + c) = c + (a + b)`.

That is why sharding, batching and multi-region replication all work for counters and not for, say, "set the value to X". <C color="green">Increments merge; assignments conflict.</C>

**This is exactly a CRDT.** A **G-Counter** (grow-only) is a vector of per-replica counts:

```
  replica A: [A:5, B:0, C:0]
  replica B: [A:0, B:3, C:0]

  merge = element-wise maximum → [A:5, B:3, C:0]   value = 8
```

Merging by taking the maximum per replica is **idempotent, commutative and associative**, so replicas converge regardless of message order or duplication — <C color="green">no coordination, no consensus, no conflict resolution to write.</C> A **PN-Counter** adds a second vector for decrements, supporting subtraction.

The limitation is the one that matters for business logic: <C color="crimson">a CRDT counter cannot enforce a bound.</C> "Never go below zero" requires knowing the global value at write time, which is precisely what CRDTs avoid. So inventory cannot be a CRDT counter, and a like count can.

**Reconciliation, which every approximate counter needs.** Batched counters drift — a lost flush, a crashed process, a duplicated retry. Without correction, the drift accumulates permanently and invisibly.

<C color="green">The fix is a periodic recompute from the source of truth:</C>

```
  hourly:  SELECT count(*) FROM views WHERE post_id = ?   →  overwrite the counter
```

This requires the underlying events to exist somewhere, which is the strongest argument for **event-plus-counter** rather than counter-alone: the counter is a **cache of an aggregate**, always rebuildable. <C color="orange">A counter with no derivation path is unverifiable — when someone asks "is 4.2 million right?", there is no way to answer.</C>

**Idempotency for counters.** At-least-once delivery means a "record a view" message may arrive twice. Options in increasing cost:

- **Accept the double count** — for views, entirely fine.
- **Deduplicate by event id** in a short-TTL set, catching retries within the window.
- **Write the event with a unique constraint**, then derive the count — exact, and the most expensive.

<H>The general shape: counters are cheap when approximate and expensive when exact, and the difference is usually invisible to users. Decide which one you are building before optimising it — most of the cost in this area comes from making a view counter as rigorous as a ledger.</H>

</Depth>

---

## 4. In a design discussion

- **"Batch increments in-process and flush every second — 20,000 increments become 20 writes, and we lose at most a second on a crash."** Names the technique and the cost.
- **"View counts are approximate; inventory is transactional with `WHERE stock > 0`. Treating them the same is where the cost comes from."** Differentiates deliberately.
- **"Billing usage is an event log aggregated on read, never a mutable counter. A counter you can't derive is a number you can't defend."** The right shape for money.
- **"HyperLogLog for unique visitors — 12 KB regardless of cardinality, 2% error, and nobody can tell."** The specialised tool.

---

## Rapid-fire recall

1. Why does a single-row increment cap out, even though it is atomic?
2. Name three symptoms of a hot counter row in Postgres.
3. How does a sharded counter work, and what does it cost?
4. Why is batching the highest-leverage technique, and what property makes it safe?
5. What does batching cost, and for which counters is that unacceptable?
6. When is sampling appropriate, and how much load does it remove?
7. Why should billing usage never be a mutable counter?
8. What is a G-Counter, and why do replicas converge without coordination?
9. What can a CRDT counter not do, and what follows for inventory?
10. Why does every approximate counter need a reconciliation path?

<details>
<summary>Answers</summary>

1. Because every increment **serialises on the same row lock**, so throughput is bounded by transaction commit time — a few thousand per second at best, regardless of how many writers there are.
2. **Lock wait time dominating**, **unrelated queries on the same table slowing**, and **dead tuple accumulation** requiring aggressive vacuum — one hot row can produce more MVCC garbage than the rest of the table.
3. Writers **increment one of N rows chosen at random**; readers **sum all N**. Write contention falls by a factor of N, at the cost of N reads per read.
4. Because increments are **commutative and associative**, so a thousand can be collapsed into one write with no loss of correctness — only bounded delay. It reduces write volume by orders of magnitude.
5. **Loss of the unflushed buffer on a crash** — typically up to one flush interval. Unacceptable for **inventory, balances and billing**; invisible for views and likes.
6. For **very high-volume, low-value** counters. Counting one event in 100 and multiplying removes **99% of write load**, with small relative error at high volume.
7. Because a mutable counter can be **lost, double-counted or reset**, and it is **not reproducible or auditable**. Record immutable events and aggregate them, so the number can be recomputed and defended.
8. A **grow-only counter** holding a per-replica count vector, merged by taking the **element-wise maximum**. That merge is idempotent, commutative and associative, so replicas converge **regardless of message order or duplication**.
9. It **cannot enforce a bound** — "never below zero" requires the global value at write time, which is what CRDTs avoid. So **inventory cannot be a CRDT counter**; it needs a transactional check.
10. Because batched and sharded counters **drift** — lost flushes, crashed processes, duplicated retries — and the drift accumulates permanently and invisibly. A periodic recompute from the underlying events corrects it, and requires those events to exist.

</details>

---

**Next:** [Notification Systems](./06-notification-systems.md) — delivering to millions of devices without becoming the bottleneck.
