---
title: CAP and PACELC
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# CAP and PACELC

> **What you will be able to do after this page**
>
> - State CAP correctly, and explain why "pick two" is wrong.
> - Say what P actually means and why it is not optional.
> - Use PACELC to describe what a database does when nothing is broken.
> - Classify real databases along both axes.

CAP is the most quoted and most misquoted result in system design. <C color="crimson">Stating it as "pick two of three" is the fastest way to signal you have only read the summary.</C>

<Plain>

Two shops share one stock list. Normally they phone each other after every sale so both lists match.

One day the phone line goes down. A customer walks into shop A wanting the last item. Shop A has exactly two options, and there is no third:

**Sell it.** The customer is served. Shop B's list is now wrong, and if a customer there wants the same item, it will be sold twice.

**Refuse.** *"I can't confirm stock, come back later."* Nothing is oversold — and you turned away a customer who was standing in front of you with money.

That is the entire theorem. <C color="orange">When communication between two parts of a system fails, you must choose: keep serving with possibly-wrong data, or stop serving until you can be sure.</C>

Two things people get wrong about it.

**The phone line going down is not a choice you get to make.** Lines fail. The only decision is what you do when it happens.

**The choice only matters *during* the failure.** When the phone works, you can have both — accurate lists and served customers. Which raises the more useful question, and the one CAP does not answer: *when everything is working normally, do you still wait for the other shop to confirm every sale?* Waiting is slower but always accurate. Not waiting is faster with a brief window of disagreement.

<C color="green">That second question governs your system almost every day. The CAP question governs it for a few minutes a year.</C>

</Plain>

---

## 1. CAP, stated correctly

| Letter | Means |
| :--- | :--- |
| **C — Consistency** | Every read sees the most recent write (**linearizability** — not the C in ACID) |
| **A — Availability** | Every request to a non-failed node gets a non-error response |
| **P — Partition tolerance** | The system keeps operating despite messages between nodes being lost |

<H>The correct statement: when a network partition occurs, you must choose between consistency and availability. That is all it says.</H>

**Why "pick two" is wrong.** Partitions are a property of the network, not a design choice. Cables are cut, switches fail, a config change blackholes traffic. <C color="crimson">You cannot choose "not partition tolerant" any more than you can choose "no hardware failures."</C>

So for any distributed system, P is compulsory, and the real choice is between **CP** and **AP** — and only during a partition.

```
   No partition (99.9%+ of the time)
   ─────────────────────────────────────
   You can have C and A together.
   CAP says nothing. Use PACELC instead.

   Partition
   ─────────────────────────────────────
   CP: refuse requests that cannot be made consistent
   AP: answer anyway, accept temporary divergence
```

<Jargon
  plain="A network failure that splits your machines into groups that cannot reach each other, though each group is still running."
  term="a network partition"
  also={['a split brain scenario', 'split network']}>

The nodes are all **alive** — that is what makes it hard. A dead node is easy: everyone agrees it is gone. <C color="orange">A partitioned node is running, accepting requests, and believes the others have failed</C> — and the others believe the same about it.

</Jargon>

---

## 2. The choice, traced

<Trace title="A partition splits a 5-node cluster 3–2" subtitle="A write arrives at the minority side. Watch what each design does.">

<TraceStep
  title="Normal operation"
  state={{ 'Cluster': '5 nodes, connected', 'Majority side': '—', 'Write accepted?': 'yes', 'Data agrees?': 'yes' }}
  note="Both properties hold. Nothing is being traded.">

All five nodes communicate. Writes replicate, reads are current.

</TraceStep>

<TraceStep
  title="The network splits 3–2"
  cost="the moment of choice"
  state={{ 'Cluster': '3 nodes | 2 nodes', 'Majority side': 'the 3', 'Write accepted?': 'to be decided', 'Data agrees?': 'still yes' }}
  changed={['Cluster', 'Majority side', 'Write accepted?']}
  note="Every node is healthy. Neither side can tell whether the other crashed or is merely unreachable — and those require opposite responses.">

A switch fails. Three nodes on one side, two on the other. <C color="crimson">Neither side knows which situation it is in.</C>

</TraceStep>

<TraceStep
  title="A write arrives at the 2-node minority"
  state={{ 'Cluster': '3 | 2', 'Majority side': 'the 3', 'Write accepted?': 'depends on design', 'Data agrees?': 'depends' }}
  note="This is the exact scenario CAP describes, and the only one it describes.">

A client connected to the minority side attempts a write.

</TraceStep>

<TraceStep
  title="CP system — refuse"
  cost="minority unavailable"
  state={{ 'Cluster': '3 | 2', 'Write accepted?': 'NO (minority errors)', 'Data agrees?': 'yes', 'User impact': 'errors for 40% of clients' }}
  changed={['Write accepted?', 'User impact']}
  note="The majority side keeps serving normally — CP does not mean the whole system stops, only the side that cannot form a quorum.">

The minority cannot reach a quorum, so it **rejects** the write and returns an error.

<C color="green">Data never diverges.</C> Clients on the minority side are down until the partition heals.

</TraceStep>

<TraceStep
  title="AP system — accept"
  cost="divergence"
  state={{ 'Cluster': '3 | 2', 'Write accepted?': 'YES (both sides)', 'Data agrees?': 'NO', 'User impact': 'none visible' }}
  changed={['Write accepted?', 'Data agrees?', 'User impact']}
  note="Every client is served. The cost is deferred, not avoided.">

Both sides accept writes. <C color="green">No user sees an error</C> — and the two sides now hold different values for the same key.

</TraceStep>

<TraceStep
  title="The partition heals — and AP pays"
  cost="conflict resolution"
  state={{ 'Cluster': '5 nodes, connected', 'Write accepted?': 'yes', 'Data agrees?': 'after merge', 'User impact': 'possible lost update' }}
  changed={['Cluster', 'Data agrees?', 'User impact']}
  note="Last-write-wins silently discards one side's data — and 'last' depends on clocks that were never synchronised.">

The AP system must now reconcile two histories: last-write-wins, application merge, or CRDTs.

<H>The CP system was unavailable for the partition's duration. The AP system was available and now owes a conflict resolution that may silently discard a user's write. Neither is free — you chose which bill to pay.</H>

</TraceStep>

</Trace>

---

## 3. PACELC — the more useful model

CAP covers a rare event. **PACELC** (Abadi, 2012) covers both cases:

```
  if (Partition)  then  choose Availability or Consistency
  Else            then  choose Latency      or Consistency
```

The `ELSE` half is the one that governs your system every day. <C color="orange">Even with a perfectly healthy network, strong consistency requires coordination, and coordination requires round trips.</C> A write that must be confirmed by a quorum across three availability zones costs several milliseconds it would not otherwise cost.

| System | Partition | Normal operation | Classification |
| :--- | :--- | :--- | :--- |
| **Cassandra / DynamoDB (default)** | Availability | Latency | <C color="orange">PA/EL</C> |
| **HBase / Bigtable** | Consistency | Consistency | <C color="green">PC/EC</C> |
| **MongoDB (default)** | Consistency | Consistency | PC/EC |
| **Spanner** | Consistency | Consistency | PC/EC — pays in commit latency |
| **Postgres (single node)** | <C color="orange">n/a — not distributed</C> | Consistency | EC |
| **Postgres + async replicas** | Consistency (leader) | <C color="orange">Latency (stale reads)</C> | PC/EL |

That last row is worth pausing on: <C color="green">adding an asynchronous read replica to a single-node database moves you from EC to EL.</C> You did not think of it as a consistency decision, but it is exactly one — and it is where [read-your-writes bugs](../05-data-at-scale/01-replication.md) come from.

<Depth title="What CAP does not say, and the mistakes that follow">

CAP is a narrow result, and most misuse comes from stretching it past what it claims.

**It is not "pick two."** P is not selectable. The genuine choice is CP or AP, and only during a partition.

**"CA systems" are a category error.** A single-node database is not "CA" — it is **not distributed**, so CAP does not apply. Any system with two machines and a network between them faces partitions.

**Consistency here means *linearizability*, not ACID's C.** Linearizability is a very strong property: every operation appears to take effect instantaneously at some point between its start and end, and all clients agree on the order. <C color="orange">Many systems described as "consistent" provide something weaker</C> — snapshot isolation, causal consistency, or read-your-writes — and those are not the C in CAP.

**Availability in CAP is stricter than uptime.** It means *every* request to *every* non-failed node succeeds. A system that keeps 80% of users served during a partition is not "available" by CAP's definition, though it is obviously a good outcome operationally. This is why CAP's binary framing maps poorly onto real systems.

**It is per-operation, not per-system.** The same database can be CP for one operation and AP for another. Cassandra with `QUORUM` reads and writes behaves like CP for that query and `ONE` behaves like AP — <C color="green">tuned per statement</C>. DynamoDB offers eventually-consistent and strongly-consistent reads on the same table. Classifying a whole database as "an AP system" is a useful shorthand and often wrong in detail.

**Partitions are not only cut cables.** A GC pause, an overloaded node, a misconfigured firewall, or asymmetric routing where A can reach B but B cannot reach A — all present as partitions. The asymmetric case is particularly nasty because failure detectors disagree about who is alive.

**The practical framing that beats CAP**, and the one worth using in a design discussion:

> For each operation: what should happen if this node cannot reach the others? Serve possibly-stale data, or return an error?

<H>Answered per operation, that question is far more useful than any classification. Reading a follower count during a partition should absolutely serve stale data. Debiting an account should not.</H>

</Depth>

---

## 4. Using it in practice

The classification is per operation, driven by the cost of being wrong:

| Operation | Choice | Reason |
| :--- | :--- | :--- |
| Read a follower count | <C color="green">AP</C> | Stale by seconds is invisible |
| Post a comment | <C color="green">AP</C> | Accept, reconcile later |
| Read a product page | <C color="green">AP</C> | Serve from cache during a partition |
| Deduct account balance | <C color="green">CP</C> | Double-spend is unacceptable |
| Reserve the last seat | <C color="green">CP</C> | Two people in one seat is a real-world failure |
| Change a password | <C color="green">CP</C> | Security state must not diverge |

<C color="green">The pattern in nearly every real system: AP by default, CP for the small set of operations where divergence costs money or safety.</C>

---

## 5. In a design discussion

- **"P isn't optional — the network will partition. The choice is what we do when it does, and it differs per operation."** Correct framing in one sentence.
- **"PACELC is more useful here: even with no partition, we're choosing latency over consistency by reading from async replicas."** Shows the everyday trade.
- **"Browsing is AP — serve from cache. Checkout is CP — I'd rather show an error than sell the same seat twice."** Applies it concretely.
- **"CAP's C is linearizability, not ACID's C. Our transactions are still ACID on a single shard."** Corrects the common conflation.

---

## Rapid-fire recall

1. State CAP correctly in one sentence.
2. Why is "pick two of three" wrong?
3. What does the C in CAP mean, and how does it differ from ACID's C?
4. Why is a partition harder to handle than a crashed node?
5. During a 3–2 partition, what does a CP system do? An AP system?
6. What bill does the AP system pay when the partition heals?
7. State PACELC, and say which half governs day-to-day behaviour.
8. Classify Cassandra and Spanner in PACELC terms.
9. Why does adding an async read replica change your PACELC classification?
10. Give the practical per-operation question that beats classifying a whole system.

<details>
<summary>Answers</summary>

1. <H>When a network partition occurs, you must choose between consistency and availability.</H> Nothing more.
2. Because **P is not a choice** — partitions are a property of networks, not of designs. The real choice is CP or AP, and only during a partition.
3. **Linearizability**: every read sees the most recent write, and all clients agree on the order of operations. ACID's C means **your application's invariants hold**. They share a letter only.
4. A crashed node is unambiguous — everyone agrees it is gone. A **partitioned node is alive**, still accepting requests, and believes the *others* failed. Both sides hold the same belief about each other, and neither can distinguish the two cases.
5. **CP**: the minority side cannot reach a quorum, so it **rejects** the write and errors; the majority keeps serving. **AP**: both sides accept writes and diverge.
6. **Conflict resolution.** Two histories must be merged — last-write-wins (which silently discards data, using clocks that were never synchronised), an application-level merge, or CRDTs.
7. *If Partition, choose Availability or Consistency; Else, choose Latency or Consistency.* The **ELSE** half governs day-to-day behaviour, since partitions are rare and coordination latency is paid on every request.
8. **Cassandra**: PA/EL — available during partitions, favours latency normally. **Spanner**: PC/EC — consistent in both cases, paying for it in commit latency.
9. Because reads from an async replica can be **stale**, which is choosing **latency over consistency** in the no-partition case — moving from EC to EL. It is a consistency decision that rarely gets recognised as one.
10. *For each operation: if this node cannot reach the others, should it serve possibly-stale data or return an error?* Answered per operation, it is far more actionable than any whole-system label.

</details>

---

**Next:** [Consistency Models](./02-consistency-models.md) — the spectrum between "always correct" and "eventually correct".
