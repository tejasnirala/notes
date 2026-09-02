---
title: Consensus and Quorums
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Consensus and Quorums

> **What you will be able to do after this page**
>
> - Explain why a majority is the smallest safe quorum, from first principles.
> - Trace a Raft leader election and a log commit.
> - Say why clusters have odd numbers of nodes, and why five is common.
> - Recognise the problems that are secretly consensus problems.

Consensus is how a group of machines agrees on a single value despite failures. <C color="orange">It is the foundation under leader election, distributed locks, and every "exactly once" claim you will ever evaluate.</C>

<Plain>

Five people must agree on one decision. They can only exchange messages, messages sometimes go missing, and some of them may be asleep.

The obvious rule works surprisingly well: **a decision counts if more than half agree.**

Why more than half specifically? Because <C color="green">any two groups of more than half must share at least one person.</C> With five people, two groups of three always overlap. That shared person remembers the earlier decision and can say *"we already settled this"* — so two different decisions can never both be made.

Try it with exactly half and it fails immediately: two groups of two out of four need not overlap at all, and both could decide different things while each believes it had proper support.

Two more consequences fall out of the same arithmetic.

**You do not need everybody.** Three of five is enough, so two can be asleep and the group still functions. Requiring unanimity means one absent person paralyses everyone.

**Odd numbers are better.** Four people still require three to agree — exactly what five requires — so the fourth person adds cost without adding tolerance. <C color="orange">Four is strictly worse than three: same failure tolerance, more machines, more messages.</C>

That is consensus. Everything else is careful handling of the awkward cases: what if someone falls asleep mid-decision, wakes up, and does not know it happened?

</Plain>

---

## 1. Quorums

<Jargon
  plain="The smallest group whose agreement counts as the whole group's decision."
  term="a quorum"
  also={['majority', 'quorum set']}>

Usually a **strict majority**: `⌊N/2⌋ + 1`. The essential property is <C color="green">any two quorums overlap in at least one node</C>, which is what makes conflicting decisions impossible.

</Jargon>

| Nodes | Quorum | Failures tolerated |
| ---: | ---: | ---: |
| 3 | 2 | 1 |
| 4 | 3 | <C color="crimson">1 — same as 3</C> |
| 5 | 3 | 2 |
| 6 | 4 | <C color="crimson">2 — same as 5</C> |
| 7 | 4 | 3 |

<H>An even node count never improves fault tolerance over the odd number below it. Four nodes cost more than three and tolerate the same single failure — which is why clusters are 3, 5 or 7.</H>

**Why five is the common production choice:** three tolerates only one failure, so during a planned upgrade — one node deliberately down — a single unexpected failure takes you below quorum. Five tolerates two, giving you headroom to do maintenance safely. Seven adds latency (more nodes to hear from) for tolerance you rarely need.

### Read and write quorums

In leaderless systems you tune `W` and `R` against `N`:

```
  W + R > N   →  read and write sets overlap  →  reads see the latest write

  N=3, W=3, R=1   fast reads, writes need everyone (fragile)
  N=3, W=2, R=2   balanced — the usual default
  N=3, W=1, R=3   fast writes, slow reads, writes survive little
```

<C color="crimson">`W + R > N` is weaker than it looks.</C> It guarantees the read set touches a node that saw the write — it does not give you linearizability. Concurrent writes, a write that failed partway through, and sloppy quorums (writing to *any* N reachable nodes, not the designated ones) all break the naive reading.

---

## 2. Raft, traced

Raft achieves consensus by electing a leader and replicating a log. Understanding these two mechanisms covers most of what you need.

<Trace title="A leader dies, a new one is elected, a write commits" subtitle="Five nodes. Watch the terms and the commit rule.">

<TraceStep
  title="Normal operation"
  state={{ 'Term': '4', 'Leader': 'node A', 'Followers': 'B C D E', 'Committed index': '100' }}
  note="The leader sends heartbeats every ~50 ms. Followers reset an election timer on each one.">

Node A is leader for term 4. All writes go through it and replicate to the followers.

</TraceStep>

<TraceStep
  title="The leader stops responding"
  cost="election timeout"
  state={{ 'Term': '4', 'Leader': 'none (A unreachable)', 'Followers': 'B C D E waiting', 'Committed index': '100' }}
  changed={['Leader']}
  note="Timeouts are randomised (150-300 ms) precisely so two followers rarely time out together.">

Heartbeats stop. Each follower's election timer runs down. <C color="orange">Node C's randomised timer fires first.</C>

</TraceStep>

<TraceStep
  title="C becomes a candidate for term 5"
  state={{ 'Term': '5', 'Leader': 'none — C campaigning', 'Votes for C': '1 (itself)', 'Committed index': '100' }}
  changed={['Term', 'Leader', 'Votes for C']}
  note="The term number increments on every election attempt and only ever moves forward — it is the fencing mechanism.">

C increments the term to 5, votes for itself, and requests votes from the others.

</TraceStep>

<TraceStep
  title="Followers vote — with a safety check"
  cost="needs 3 of 5"
  state={{ 'Term': '5', 'Leader': 'C elected', 'Votes for C': '3 (C, B, D)', 'Committed index': '100' }}
  changed={['Leader', 'Votes for C']}
  note="A node whose log is more up to date will refuse the vote — this is what stops a lagging node becoming leader and losing committed entries.">

Each follower votes at most once per term, and <C color="green">only for a candidate whose log is at least as up to date as its own</C>.

C gets 3 votes — a majority — and becomes leader for term 5.

</TraceStep>

<TraceStep
  title="A client writes; C appends and replicates"
  state={{ 'Term': '5', 'Leader': 'C', 'Log entry 101': 'on C, B, D', 'Committed index': '100 → deciding' }}
  changed={['Log entry 101']}
  note="The entry exists on three nodes but is not yet committed — the client has not been told anything.">

C appends entry 101 to its log and sends it to the followers. B and D acknowledge.

</TraceStep>

<TraceStep
  title="Committed once a majority has it"
  state={{ 'Term': '5', 'Leader': 'C', 'Log entry 101': 'committed', 'Committed index': '101' }}
  changed={['Log entry 101', 'Committed index']}
  note="Committed means durable against any minority failing — the entry cannot be lost, because any future leader must have it.">

Three of five hold entry 101, so C marks it **committed**, applies it to the state machine, and responds to the client.

<H>The commit rule and the election rule work together: an entry is committed once a majority holds it, and a candidate needs a majority to win — so any future leader's log must contain every committed entry. Committed data cannot be lost.</H>

</TraceStep>

<TraceStep
  title="The old leader A comes back"
  cost="steps down immediately"
  state={{ 'Term': '5', 'Leader': 'C', 'A status': 'follower, truncating log', 'Committed index': '101' }}
  changed={['A status']}
  note="This is how split brain is prevented — not by detecting A, but by A discovering it is stale.">

A returns believing it is leader for term 4. It sees term 5, and <C color="green">a node always steps down on seeing a higher term.</C>

A becomes a follower and truncates any uncommitted entries that conflict with C's log.

</TraceStep>

</Trace>

---

## 3. Where consensus actually lives

You will rarely implement it. You will constantly *depend* on it, and recognising that is the useful skill.

| Problem | Why it is consensus |
| :--- | :--- |
| **Leader election** | Exactly one leader must be agreed |
| **Distributed locks** | Exactly one holder must be agreed |
| **Cluster membership** | Everyone must agree who is in the cluster |
| **Configuration / feature flags** | All nodes must agree on the current value |
| **Unique constraint across shards** | Agreement that nobody else took the value |
| **"Exactly once" processing** | Agreement that a message was processed |

Systems that provide it as a service: **etcd** (Kubernetes' store), **ZooKeeper**, **Consul**. Databases with it built in: **Spanner**, **CockroachDB**, **TiDB**, **MongoDB** (elections).

<C color="green">Use one of these rather than writing your own.</C> Consensus implementations are notoriously difficult to get right — the subtle cases involve failures during elections, log truncation, and membership changes, and they are exactly where naive implementations lose data.

<Depth title="FLP, failure detectors, and why your distributed lock is not safe">

**The FLP impossibility result** (Fischer, Lynch and Paterson, 1985) proves that in an **asynchronous** system — no bound on message delay — no deterministic algorithm can guarantee consensus if even one process may fail.

The intuition: with no timing bound, you cannot distinguish a **crashed** node from a **slow** one. Any algorithm that waits forever may wait forever; any algorithm that gives up may give up on a node that was about to reply. There is always an execution where the algorithm cannot decide.

**Why Raft and Paxos work anyway.** They sidestep FLP rather than refuting it, by giving up **guaranteed termination** while keeping **guaranteed safety**:

- <C color="green">**Safety always holds**</C> — two leaders are never elected for the same term, committed entries are never lost. Under any timing, any failures.
- <C color="orange">**Liveness is only probabilistic**</C> — progress requires the network to behave for long enough. Randomised election timeouts make repeated collisions vanishingly unlikely in practice, but not impossible in theory.

That is the correct trade: <H>a system that occasionally stalls is recoverable; a system that occasionally corrupts data is not.</H>

**Failure detectors are always wrong sometimes.** In practice we use timeouts, which are heuristics. A 5-second timeout says "probably dead" and is wrong whenever a node is merely GC-pausing, swapping, or behind a congested link. This is why fencing matters more than detection accuracy.

**Why your distributed lock is probably unsafe.** The classic broken pattern:

```
  1. Client A acquires a lock with a 30 s TTL
  2. Client A begins work
  3. Client A stops for 45 s   (GC pause, VM migration, CPU starvation)
  4. The lock expires; client B acquires it and begins work
  5. Client A wakes up, still believing it holds the lock, and writes
     → two clients wrote concurrently; the lock provided nothing
```

<C color="crimson">No lock service can prevent this on its own</C>, because A is not misbehaving — it simply cannot know time passed. The fix must involve the **resource being protected**:

**Fencing tokens.** The lock service returns a monotonically increasing token with each grant. Every write to the protected resource carries the token, and <C color="green">the resource rejects any token lower than the highest it has seen.</C> A wakes up with token 33, the storage has already accepted token 34 from B, and A's write is rejected — regardless of what A believes.

This is the same mechanism that prevents [split brain in failover](../05-data-at-scale/01-replication.md), and Raft's **term number** is exactly a fencing token.

**The practical rule:** a distributed lock is only as safe as the resource's willingness to check a token. If the resource cannot check, treat the lock as an **optimisation that reduces contention**, not a **correctness guarantee** — and make the operation [idempotent](./05-idempotency-and-delivery.md) so that a duplicate execution is harmless anyway.

</Depth>

---

## 4. In a design discussion

- **"Five nodes, so we tolerate two failures and can still take one down for maintenance safely."** Explains the number rather than reciting it.
- **"Four nodes tolerate the same single failure as three — even counts never help."** A small correct detail people notice.
- **"etcd for leader election rather than rolling our own — the failure cases are during elections and membership changes, and that's where hand-written implementations lose data."** Correct build/buy judgement.
- **"The lock needs a fencing token, or a GC pause lets two clients believe they hold it."** The senior answer on distributed locks.

---

## Rapid-fire recall

1. Why is a strict majority the smallest safe quorum?
2. Why does a 4-node cluster tolerate no more failures than a 3-node one?
3. Why is 5 the common production size rather than 3?
4. Give the quorum condition for leaderless reads and writes, and its limitation.
5. In Raft, what is a term and what job does it do?
6. Why are election timeouts randomised?
7. What check stops a lagging node from becoming leader, and what does it protect?
8. When exactly is a Raft entry committed, and why can committed entries never be lost?
9. State FLP, and explain how Raft works despite it.
10. Describe the unsafe-lock scenario and the fix.

<details>
<summary>Answers</summary>

1. Because **any two majorities must overlap in at least one node**, and that node remembers the earlier decision — so two conflicting decisions cannot both be made. With exactly half, two groups need not overlap.
2. Both require **3 nodes** to form a majority, so both survive only **1** failure. The fourth node adds cost and message overhead without adding tolerance.
3. Three tolerates only one failure, so during planned maintenance (one node down) a single unexpected failure loses quorum. **Five tolerates two**, leaving headroom to operate safely.
4. `W + R > N`, so read and write sets overlap. Limitation: it guarantees **overlap, not linearizability** — concurrent writes, partially-failed writes, and sloppy quorums all break the naive reading.
5. A monotonically increasing **election epoch**. It orders leadership periods, and a node seeing a higher term immediately steps down — making it a **fencing token** that prevents split brain.
6. So two followers rarely time out simultaneously and split the vote. Randomisation (typically 150–300 ms) makes repeated collisions vanishingly unlikely.
7. A voter only grants its vote to a candidate whose **log is at least as up to date as its own**. This protects **committed entries** — a lagging node can never win and then truncate data a majority had already committed.
8. Once a **majority of nodes hold it**. It cannot be lost because winning an election also requires a majority, and any two majorities overlap — so every future leader's log necessarily contains it.
9. **FLP**: in an asynchronous system with no bound on message delay, no deterministic algorithm guarantees consensus if even one process may fail — because a crashed node is indistinguishable from a slow one. Raft sidesteps it by guaranteeing **safety always** and **liveness only probabilistically**, using randomised timeouts to make stalls unlikely in practice.
10. A client acquires a lock with a TTL, pauses (GC, VM migration) past the expiry, the lock is granted to another client, and the first wakes believing it still holds it — two writers. Fix: **fencing tokens** — a monotonically increasing number with each grant, which the **protected resource** checks and rejects if lower than the highest seen.

</details>

---

**Next:** [Time and Ordering](./04-time-and-ordering.md) — why you cannot trust a clock, and what to use instead.
