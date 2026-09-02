---
title: Replication
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Replication

> **What you will be able to do after this page**
>
> - Choose between single-leader, multi-leader and leaderless, and say what each costs.
> - Explain replication lag and the three read anomalies it causes.
> - Say why replication is not a backup, and why failover can lose committed writes.
> - Design read-your-own-writes without giving up read scaling.

Replication is the first thing you reach for when one database is not enough, and <C color="orange">it buys three different things that people constantly conflate</C>: read capacity, availability, and durability.

<Plain>

A shop keeps its only ledger behind the counter. Two problems follow.

**If it burns, everything is gone.** So you photocopy it and keep a copy elsewhere.

**Only one person can read it at a time.** So the copies are also useful for answering questions — three people can consult three copies simultaneously.

Now the hard part, and it is the whole subject. When someone writes a new entry in the original, the copies are briefly **out of date**. Somebody reading a copy at that moment gets an answer that was true a second ago.

You can prevent that by making every write wait until all copies are updated — but then a single slow or unreachable copy stops the shop from taking any new entries at all.

So there is a genuine choice, and no option escapes it:

- <C color="green">Wait for the copies</C> — always correct, and slower, and fragile if one copy is unreachable.
- <C color="green">Don't wait</C> — fast and resilient, and readers sometimes see slightly stale information.

Nearly everything else on this page is a consequence of which of those two you pick, and for which piece of data.

</Plain>

---

## 1. Single-leader replication

The default, and what "read replicas" means. One node accepts writes; others copy from it and serve reads.

```
                 writes
                   │
                   ▼
             ┌──────────┐
             │  LEADER  │
             └────┬─────┘
        ┌─────────┼─────────┐   replication stream
        ▼         ▼         ▼
   ┌────────┐┌────────┐┌────────┐
   │follower││follower││follower│   reads
   └────────┘└────────┘└────────┘
```

<Jargon
  plain="One database is in charge of accepting changes; the others copy from it and answer questions."
  term="single-leader replication"
  also={['leader-follower', 'primary-replica', 'master-slave (dated)']}>

<C color="green">The safest default</C>, because with one writer there is never a conflict to resolve — the leader's order is *the* order. Nearly every relational database does this out of the box, and it scales reads without changing your application's write path at all.

</Jargon>

**What it gives you:** read scaling, a failover target, and a natural place to run backups and analytics without disturbing production.

**What it does not:** <C color="crimson">write scaling.</C> Every write still goes to one machine, so a write-bound system gains nothing from adding followers. That is what [partitioning](./02-partitioning-and-sharding.md) is for.

### Synchronous, asynchronous, and the middle

| Mode | Leader waits for | Write latency | On leader failure |
| :--- | :--- | :--- | :--- |
| **Asynchronous** | Nothing | <C color="green">Fastest</C> | <C color="crimson">Recent writes can be lost</C> |
| **Synchronous** | All followers | <C color="crimson">Slowest; one slow follower blocks writes</C> | <C color="green">No loss</C> |
| **Semi-synchronous** | <C color="green">At least one follower</C> | Moderate | <C color="green">No loss if that follower is promoted</C> |

<H>Fully synchronous replication to all followers means any single follower being slow or unreachable stops all writes. Almost nobody runs it. Semi-synchronous — wait for one — is the usual production answer.</H>

---

## 2. Replication lag, and the anomalies it causes

Asynchronous replication means followers are behind by some amount — microseconds normally, seconds under load, minutes if something is wrong. Three specific bugs follow, and they are the ones you will actually hit.

<Trace title="A user posts a comment and it vanishes" subtitle="Async replication, ~200 ms lag. Nothing is broken.">

<TraceStep
  title="The write goes to the leader"
  state={{ 'Leader has': 'the comment', 'Follower has': 'nothing yet', 'User sees': '—', 'Lag': '0 ms' }}
  changed={['Leader has']}
  note="Normal, correct behaviour up to here.">

The user posts a comment. It commits on the leader and returns `201`.

</TraceStep>

<TraceStep
  title="The page reloads and reads from a follower"
  cost="the bug"
  state={{ 'Leader has': 'the comment', 'Follower has': 'nothing yet', 'User sees': 'NO COMMENT', 'Lag': '150 ms' }}
  changed={['User sees', 'Lag']}
  note="This is read-after-write inconsistency, and it is the single most common replication bug in web applications.">

The load balancer sends the follow-up read to a follower that has not received the comment yet.

<C color="crimson">The user sees their own comment missing.</C> They post it again.

</TraceStep>

<TraceStep
  title="Moments later, it appears"
  state={{ 'Leader has': '2 comments', 'Follower has': '2 comments', 'User sees': 'both', 'Lag': '0 ms' }}
  changed={['Leader has', 'Follower has', 'User sees', 'Lag']}
  note="Duplicate content, and a support ticket about a 'flaky' site.">

Replication catches up and both copies appear.

</TraceStep>

<TraceStep
  title="A different anomaly — time going backwards"
  cost="monotonic read violation"
  state={{ 'Read 1 (follower A)': 'sees comment', 'Read 2 (follower B)': 'does NOT', 'User sees': 'it disappeared', 'Lag': 'A: 0 ms, B: 800 ms' }}
  changed={['Read 1 (follower A)', 'Read 2 (follower B)', 'User sees']}
  note="Caused by consecutive reads hitting followers with different lag. Fix: pin a user to one replica.">

Two consecutive reads land on **different** followers with different lag. The user sees the comment, refreshes, and it is gone again.

</TraceStep>

<TraceStep
  title="Fix 1 — read from the leader after a write"
  state={{ 'Strategy': 'leader reads for 1 min after write', 'Correct': 'yes', 'Read scaling': 'mostly preserved', 'Complexity': 'low' }}
  changed={['Strategy', 'Correct', 'Read scaling']}
  note="The pragmatic default: only the writing user pays, and only briefly.">

After a user writes, route **their** reads to the leader for a short window (tracked in their session).

<C color="green">Everyone else still reads from followers, so read scaling is preserved.</C>

</TraceStep>

<TraceStep
  title="Fix 2 — wait for the replica to catch up"
  state={{ 'Strategy': 'client tracks write position (LSN)', 'Correct': 'yes', 'Read scaling': 'fully preserved', 'Complexity': 'higher' }}
  changed={['Strategy', 'Read scaling', 'Complexity']}
  note="Cleaner and more precise, and it requires the client or middleware to carry the position token.">

The write returns a log position. Reads pass it along, and a follower either serves the read once it has caught up to that position, or forwards it to the leader.

<H>The general shape: the user who wrote must see their own write, and nobody else needs that guarantee. Solve it for that user only, and you keep the read scaling you replicated for.</H>

</TraceStep>

</Trace>

**The three anomalies, named:**

| Anomaly | What the user sees | Fix |
| :--- | :--- | :--- |
| **Read-your-writes** | Your own write is missing | Read from leader after writing, or track log position |
| **Monotonic reads** | Data appears, then disappears | <C color="green">Pin a user to one replica</C> (hash their id) |
| **Consistent prefix** | A reply appears before the message it answers | Route causally related writes to the same partition |

---

## 3. Multi-leader and leaderless

### Multi-leader

Several nodes accept writes and replicate to each other. Used across regions, or for offline-capable clients.

<C color="green">Writes are accepted locally, so they are fast everywhere and survive a regional outage.</C>
<C color="crimson">Two leaders can accept conflicting writes to the same row</C>, and now you must resolve it — and there is no universally correct answer.

| Resolution strategy | Behaviour |
| :--- | :--- |
| **Last write wins** | Simple; <C color="crimson">silently discards data</C>, and "last" depends on unreliable clocks |
| **Application merge** | Correct but requires domain logic per conflict type |
| **CRDTs** | Data types that merge deterministically; excellent where they fit (counters, sets, text) |

<C color="orange">Avoid multi-leader unless you genuinely need local writes in several regions.</C> The conflict resolution is a permanent tax on every feature you build afterwards.

### Leaderless

Any node accepts any operation; the client (or a coordinator) writes to several and reads from several. Dynamo, Cassandra, Riak.

Correctness comes from **quorums**:

```
  N = replicas,  W = nodes that must ack a write,  R = nodes read from

  W + R > N   →  read and write sets overlap  →  a read sees the latest write
```

With `N=3, W=2, R=2`: any two nodes acknowledging a write, and any two answering a read, must share at least one node — which holds the newest value. <C color="green">Tune `W` and `R` per operation</C>: `W=1` for fast lossy writes, `R=N` for a critical read.

<C color="crimson">Quorums are weaker than they look.</C> `W + R > N` guarantees overlap, not linearizability — concurrent writes, node failures during a write, and the sloppy-quorum optimisation all break the intuitive reading. Details on the [consensus page](../06-distributed-systems/03-consensus-and-quorums.md).

---

## 4. Failover, and how it loses data

When the leader dies, a follower is promoted. Every step of that is a place things go wrong.

<Depth title="The four ways failover hurts, and why replication is not a backup">

**1. Asynchronous replication loses committed writes.** The leader acknowledged a write, then died before shipping it. The promoted follower has never seen it. <C color="crimson">A client was told "success" for a write that no longer exists</C> — and if that write was an order, you have taken money for something with no record.

The usual mitigation is to discard the old leader's un-replicated writes when it rejoins. GitHub's 2018 incident is the canonical illustration of what happens when they are not discarded cleanly: 24 hours of degraded service reconciling data written on both sides of a network partition.

**2. Split brain.** The old leader has not actually died — it is unreachable. It keeps accepting writes while the new leader also accepts them. Two divergent histories, both believing they are authoritative. Mitigations include **fencing tokens** (a monotonically increasing epoch number that storage checks, so the old leader's writes are rejected) and STONITH ("shoot the other node in the head" — forcibly power it off).

**3. Choosing the timeout is genuinely hard.** Too short and a brief network blip triggers an unnecessary failover, which is itself disruptive and can cascade under load. Too long and you are down for that duration. There is no correct value, only a trade between availability and stability — and load spikes make it worse, because a loaded leader looks exactly like a dead one.

**4. The new leader may be cold.** Empty buffer cache, no warm connection pool. Promoted under full production traffic, it can be slow enough to fail its own health checks — [the flapping loop](../03-traffic-and-edge/01-load-balancers.md) again, now with your only writable node.

**Why replication is not a backup**, which is the practical takeaway from all of this:

<H>Replication copies your mistakes faithfully and instantly. `DROP TABLE orders` replicates in milliseconds. A bad migration replicates. Ransomware replicates.</H>

Replication protects against **hardware and node failure**. Backups protect against **you**, and against corruption, and against a bad deploy. They solve different problems, and one cannot substitute for the other.

What backups need that replication does not provide: **point-in-time recovery** (restore to 10:32, just before the bad migration), **immutability** (an attacker with database access cannot delete them), **isolation** (a separate account or provider), and — most importantly — <C color="crimson">**a restore that has actually been tested**</C>. An untested backup is a hypothesis, and a surprising number of them turn out to be false at the worst possible moment.

</Depth>

---

## 5. What replication does and does not buy

| Goal | Does replication solve it? |
| :--- | :--- |
| Read scaling | <C color="green">Yes — the main reason to do it</C> |
| Write scaling | <C color="crimson">No — every write still hits one leader</C>. Use partitioning |
| High availability | <C color="green">Partly</C> — a failover target, if failover actually works |
| Durability against hardware failure | <C color="green">Yes</C> |
| Protection from human error | <C color="crimson">No — it replicates the mistake</C> |
| Lower latency for distant users | <C color="green">Yes for reads</C>, with a regional replica |
| Analytics without disturbing production | <C color="green">Yes</C> — a dedicated replica is the standard answer |

---

## 6. In a design discussion

- **"Single leader with semi-synchronous replication to one follower — fully synchronous to all means one slow replica blocks every write."** Names the mode and the failure it avoids.
- **"Read-your-writes by routing that user's reads to the leader for a minute after they write; everyone else keeps reading replicas."** Solves the anomaly without giving up the scaling.
- **"Replication is not a backup — `DROP TABLE` replicates in milliseconds. We need point-in-time recovery separately, and a restore we've actually tested."** The point most candidates miss.
- **"Replicas scale reads, not writes. If writes are the constraint we need to partition, not add followers."** Corrects the common conflation.

---

## Rapid-fire recall

1. Name the three distinct things replication buys, and the one it does not.
2. Compare synchronous, asynchronous and semi-synchronous on latency and data loss.
3. Why does almost nobody run fully synchronous replication to all followers?
4. Describe the read-your-writes anomaly and two fixes.
5. What causes a monotonic read violation, and what is the simple fix?
6. Give the quorum condition and explain why `W=2, R=2, N=3` works.
7. Why avoid multi-leader unless you truly need it?
8. Name two ways failover can lose or corrupt committed data.
9. What is a fencing token and which failure does it prevent?
10. Give three things a backup provides that replication cannot.

<details>
<summary>Answers</summary>

1. **Read capacity**, **availability** (a failover target), and **durability** against hardware failure. It does **not** provide write scaling — every write still goes to one leader.
2. **Async**: fastest writes, can lose recent committed writes on failover. **Sync (all)**: no loss, slowest, and one slow follower blocks all writes. **Semi-sync (one)**: moderate latency, no loss provided the acknowledged follower is the one promoted.
3. Because any single follower being slow or unreachable **stops all writes**. It converts one replica's problem into a total write outage.
4. A user writes, then reads from a lagging follower and **does not see their own write**. Fixes: route that user's reads to the **leader** for a short window after they write, or have the client carry a **log position** so a follower serves the read only once caught up.
5. Two consecutive reads hitting **different followers with different lag**, so data appears then disappears. Fix: **pin a user to one replica**, e.g. by hashing their user id.
6. `W + R > N`. With `N=3, W=2, R=2`: any 2 write-acknowledging nodes and any 2 read nodes must **share at least one node**, and that node holds the latest value.
7. Because two leaders can accept **conflicting writes to the same row**, and conflict resolution has no universally correct answer — last-write-wins silently discards data, and application merges are a permanent tax on every feature.
8. **Async replication loses acknowledged writes** the dead leader never shipped. **Split brain** — an unreachable-but-alive old leader keeps accepting writes, producing two divergent histories.
9. A monotonically increasing epoch number that storage checks on every write, so a **deposed leader's writes are rejected**. It prevents split brain from corrupting data.
10. **Point-in-time recovery** (restore to just before a bad migration) · **immutability** (an attacker with database access cannot delete them) · **isolation** (separate account or provider) · **a tested restore path**. Replication provides none of these, because it faithfully copies mistakes.

</details>

---

**Next:** [Partitioning and Sharding](./02-partitioning-and-sharding.md) — splitting data across machines, and the key choice you cannot easily undo.
