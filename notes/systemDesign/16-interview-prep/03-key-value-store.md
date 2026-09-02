---
title: Design a Distributed Key-Value Store
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Design a Distributed Key-Value Store

> **The drill:** design something like DynamoDB or Cassandra. Unusually theory-heavy — it is really an exam on partitioning, replication, quorums and conflict resolution at once.

<Plain>

A company keeps records in a filing system spread across many offices.

Three questions define everything, and none has a single right answer.

**Which office holds a given record?** You need a rule that spreads records evenly and — critically — does not require re-filing everything when you open a new office.

**How many copies?** One is fast and lost when that office burns down. Several survive a fire and must be kept in step.

**What if two offices disagree?** During a phone outage, two offices each accept a change to the same record. Both are real. When the phones return, <C color="orange">something must decide what the record now says</C> — and "the later one wins" requires clocks you cannot trust.

That last question is the one interviewers spend the most time on, because it is where most candidates have nothing to say beyond "last write wins" — which, as [the clocks page](../06-distributed-systems/04-time-and-ordering.md) shows, silently discards somebody's data.

</Plain>

---

## 1. Scope and requirements

**In:** `get(key)`, `put(key, value)`, `delete(key)`. Tunable consistency. High availability. Linear scalability.
**Out:** transactions across keys, secondary indexes, queries by anything but key, joins.

<C color="green">Say the constraint out loud early:</C> a key-value store gives up range queries and multi-key atomicity in exchange for partitioning trivially and scaling linearly. <C color="orange">That is not a limitation to apologise for — it is the trade being made.</C>

| Question | Answer |
| :--- | :--- |
| Scale | 10M ops/sec, petabytes |
| Read:write | ~10:1 |
| Consistency | <C color="orange">Tunable per operation</C> |
| Availability | Must serve during a partition |
| Latency | p99 under 10 ms |

---

## 2. The three decisions

### Partitioning — consistent hashing

`hash(key) → position on a ring`, owned by the first node clockwise, with **virtual nodes** so distribution is even and a failed node's load spreads across many survivors rather than one.

<C color="green">Why not modulo:</C> adding a node would remap ~`N/(N+1)` of all keys. See [consistent hashing](../05-data-at-scale/03-consistent-hashing.md).

### Replication — N successors on the ring

A key's replicas are the **next N distinct physical nodes clockwise**. Placement should skip nodes sharing a rack or availability zone, or your three replicas share a power feed and [the independence assumption fails](../10-reliability/01-failure-and-redundancy.md).

### Consistency — quorums

```
  W + R > N   →  the read set and write set overlap

  N=3, W=2, R=2   balanced — the usual default
  N=3, W=1, R=1   fastest, no overlap guarantee — eventual
  N=3, W=3, R=1   fast reads, writes fail if any replica is down
```

<Jargon
  plain="Requiring a majority of copies to acknowledge, so reads and writes always share at least one node."
  term="quorum reads and writes"
  also={['W + R > N', 'tunable consistency']}>

<C color="crimson">`W + R > N` guarantees overlap, not linearizability.</C> Concurrent writes, a write that failed partway, and sloppy quorums all break the intuitive reading — which is exactly the nuance interviewers probe.

</Jargon>

---

## 3. Conflict resolution — the deep dive

<Trace title="Two writes during a partition" subtitle="The question every interviewer asks. Watch each answer fail before the last one.">

<TraceStep
  title="A partition splits the replicas"
  state={{ 'Key': 'cart:42', 'Side A value': "['book']", 'Side B value': "['book']", 'Conflict': 'none yet' }}
  changed={['Key', 'Side A value', 'Side B value']}
  note="Both sides are healthy and hold the same value. Nothing is wrong yet.">

Three replicas, split 2–1. Both sides remain available and accept writes.

</TraceStep>

<TraceStep
  title="Both sides accept a write"
  cost="divergence"
  state={{ 'Side A value': "['book','pen']", 'Side B value': "['book','lamp']", 'Conflict': 'YES', 'Both real': 'yes' }}
  changed={['Side A value', 'Side B value', 'Conflict']}
  note="A user added a pen from one device and a lamp from another. Both actions genuinely happened.">

<C color="crimson">Two divergent values, both acknowledged to the user.</C>

</TraceStep>

<TraceStep
  title="Resolution 1 — last write wins"
  cost="silent data loss"
  state={{ 'Result': "['book','lamp']", 'Lost': 'the pen', 'Detectable': 'no', 'Verdict': 'usually wrong' }}
  changed={['Result', 'Lost', 'Verdict']}
  note="And 'last' is decided by wall clocks that were never synchronised — so it may not even be the later write.">

Compare timestamps and keep the newer. <C color="crimson">The pen vanishes with no error</C>, and clock skew means the surviving write may not be the later one.

</TraceStep>

<TraceStep
  title="Resolution 2 — vector clocks, keep both"
  state={{ 'Result': 'two siblings returned', 'Lost': 'nothing', 'Caller must': 'resolve', 'Verdict': 'correct, harder' }}
  changed={['Result', 'Lost', 'Caller must', 'Verdict']}
  note="Version vectors detect that neither write descends from the other — a genuine concurrent conflict.">

<C color="green">The store detects the values are concurrent and returns both</C>, leaving resolution to the application, which has the domain knowledge.

For a shopping cart, the right merge is obvious to the application and impossible for the store: **union the items**.

</TraceStep>

<TraceStep
  title="Resolution 3 — a data type that merges itself"
  state={{ 'Result': "['book','pen','lamp']", 'Lost': 'nothing', 'Caller must': 'nothing', 'Verdict': 'best where it fits' }}
  changed={['Result', 'Caller must', 'Verdict']}
  note="A CRDT — the merge function is part of the type, so convergence is automatic and deterministic.">

Model the cart as a **grow-only set** ([CRDT](../14-building-blocks/05-counters-at-scale.md)). Merging is a union, which is commutative, associative and idempotent — <C color="green">so replicas converge with no coordination and no application logic.</C>

<H>The store cannot know that carts should union and counters should sum. Either the application resolves, or the data type carries its own merge rule. "Last write wins" is choosing to discard data rather than choosing a merge.</H>

</TraceStep>

</Trace>

---

## 4. Keeping replicas in step

Three mechanisms, all worth naming:

| Mechanism | When | What it does |
| :--- | :--- | :--- |
| **Read repair** | On a read | If replicas disagree, write the winning value back to the stale ones |
| **Hinted handoff** | During a write | If a replica is down, a neighbour stores a "hint" and delivers it when the node returns |
| **Anti-entropy** | Background | Compare replicas with **Merkle trees** and sync only differing ranges |

<C color="green">Merkle trees are the detail that shows depth.</C> Comparing two replicas holding a terabyte cannot mean shipping a terabyte. A Merkle tree hashes ranges hierarchically, so two replicas compare root hashes first — <C color="green">identical roots mean identical data, in one comparison</C> — and descend only into subtrees that differ. Divergence is located in `O(log N)` exchanges.

---

## 5. Storage engine and the rest

<Depth title="What interviewers push on after the happy path">

**Storage engine: LSM, not B-tree.** Writes go to a commit log and an in-memory memtable, flush to immutable SSTables, and merge by compaction. <C color="green">Sequential writes absorb far higher write throughput</C>, which is what this workload needs. Reads check the memtable then SSTables newest-first, with a **Bloom filter per SSTable** so a miss skips files without touching disk — [the storage engines page](../04-data-storage/03-storage-engines.md).

Be ready for the follow-up: <C color="crimson">a delete is a tombstone, so disk usage *rises* on delete until compaction runs.</C>

**Membership and failure detection.** Nodes learn about each other via **gossip** — each periodically exchanges state with a few random peers, so knowledge spreads exponentially with no central coordinator. Failure detection uses a **phi-accrual detector**, which outputs a *suspicion level* rather than a boolean, letting the system react proportionally rather than flapping on one missed heartbeat.

**Hot keys.** Consistent hashing distributes *keys* evenly, not *load*. <C color="crimson">One extremely popular key still lands on N specific nodes.</C> Mitigations: a caching tier in front, request coalescing, or sub-keying the hot key across several partitions — the same [hot key answer](../07-caching/04-cache-failure-modes.md) as everywhere.

**The sloppy quorum caveat, worth raising yourself.** If designated replicas are unreachable, a **sloppy quorum** writes to *any* N reachable nodes instead, with hinted handoff to deliver later. This preserves availability — and <C color="orange">it breaks the `W + R > N` overlap guarantee</C>, because the nodes that acknowledged the write may not be the nodes a later read consults. Raising this unprompted signals that you understand quorums rather than reciting the inequality.

**What this design cannot do**, and saying it is a strength:

- <C color="crimson">No range queries</C> — hashing destroys key ordering. An ordered partitioner restores them and reintroduces hot spots.
- <C color="crimson">No multi-key transactions</C> — that is a different system.
- <C color="crimson">No secondary indexes without cost</C> — either scatter-gather across all partitions, or a separately maintained index with its own consistency problems.

**Where it breaks at 10×.** It genuinely does not, for throughput — that is the point of the architecture. The pressures that appear instead are **operational**: compaction keeping up, hot keys, cross-region replication latency, and the cost of the replication factor. <H>A design whose scaling story is "add nodes" has moved its difficulty into operations, which is where the honest answer should point.</H>

</Depth>

---

## 6. What a good answer sounds like

> *"Consistent hashing with virtual nodes for partitioning; replicas are the next N distinct nodes clockwise, placed across availability zones. Quorums tunable per operation — `W=2, R=2, N=3` by default, though `W + R > N` gives overlap, not linearizability, and sloppy quorums break even that. Conflicts are detected with version vectors and returned as siblings rather than resolved by last-write-wins, which silently discards data using clocks we can't trust. Replicas converge via read repair, hinted handoff and Merkle-tree anti-entropy. LSM storage with per-SSTable Bloom filters. Gossip membership with a phi-accrual failure detector. It won't do range queries or multi-key transactions — that's the trade for linear scaling."*

---

## Rapid-fire recall

1. What does a key-value store give up, and what does it buy?
2. Why consistent hashing rather than modulo, and what do virtual nodes add?
3. Where should replicas be placed, and why?
4. State the quorum condition and its two limitations.
5. Why is last-write-wins usually wrong here?
6. What do version vectors detect that timestamps cannot?
7. Why can the store not resolve a cart conflict itself, and what two options exist?
8. Name the three replica-convergence mechanisms.
9. How do Merkle trees make anti-entropy affordable?
10. What is a sloppy quorum, and what guarantee does it break?

<details>
<summary>Answers</summary>

1. Gives up **range queries, multi-key transactions and secondary indexes**. Buys **trivial partitioning and linear scalability** — every operation is scoped to one key, so it can always be routed to one partition.
2. Modulo remaps ~`N/(N+1)` of keys when a node is added. Consistent hashing moves only `1/(N+1)`. **Virtual nodes** even out the distribution and spread a failed node's load across many survivors rather than one neighbour.
3. On the **next N distinct physical nodes clockwise**, skipping nodes that share a rack or availability zone — otherwise the replicas share a failure domain and the independence assumption behind redundancy fails.
4. `W + R > N`. It guarantees the read and write sets **overlap**, not linearizability — and **concurrent writes, partially-failed writes and sloppy quorums** all break the naive reading.
5. Because it **silently discards a real write**, and "last" is decided by **wall clocks that were never synchronised**, so the surviving value may not even be the later one.
6. That two values are **concurrent** — neither descends from the other — which is a genuine conflict rather than an ordering. Timestamps cannot distinguish concurrency from ordering.
7. Because merging requires **domain knowledge** the store does not have (carts union, counters sum, documents merge differently). Options: **return siblings** for the application to resolve, or use a **CRDT** whose type carries its own merge rule.
8. **Read repair** (fix disagreement found during a read) · **hinted handoff** (a neighbour holds writes for a down node and delivers them later) · **anti-entropy** (background comparison and sync).
9. By hashing ranges **hierarchically**, so replicas compare root hashes first — identical roots prove identical data in one exchange — and descend only into differing subtrees, locating divergence in `O(log N)` exchanges rather than shipping all the data.
10. Writing to **any N reachable nodes** rather than the designated replicas when those are unavailable, with hinted handoff later. It preserves availability and **breaks the `W + R > N` overlap guarantee**, because the acknowledging nodes may not be the ones a later read consults.

</details>

---

**Next:** [Design Twitter](./04-twitter.md) — the fan-out drill.
