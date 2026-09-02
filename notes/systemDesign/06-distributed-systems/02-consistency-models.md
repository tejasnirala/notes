---
title: Consistency Models
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Consistency Models

> **What you will be able to do after this page**
>
> - Place the common models on a spectrum and say what each guarantees.
> - Pick the weakest model that still satisfies a requirement.
> - Explain the four session guarantees and why they solve most real complaints.
> - Say why "eventual consistency" is a promise about the end, not the middle.

"Consistent" is used to mean at least six different things. <C color="orange">This page makes them distinct, because choosing the weakest model that works is where real performance comes from.</C>

<Plain>

A group of friends keeps a shared shopping list, each with their own copy on their phone.

**The strictest arrangement**: nobody may look at their copy until every phone has been updated. Everyone always sees exactly the same list. It is also slow — one friend on a train with no signal freezes the whole group.

**The loosest**: everyone edits freely and copies sync whenever they can. Fast, and for a while different people see different lists. Eventually they agree.

Between those extremes are the arrangements people actually want, and they are more specific than "strict" or "loose":

- *"I must always see my own additions"* — annoying beyond words if you add milk and it vanishes.
- *"The list must never go backwards for me"* — seeing milk, then not seeing it, feels broken even though both were once true.
- *"If someone adds bread **because** I added butter, nobody sees bread without butter"* — effects must not appear before causes.

<C color="green">Notice that none of those requires everyone to see the same list at the same instant.</C> They are much weaker than the strictest arrangement, much cheaper, and they cover almost every real complaint.

That is the point of this page: <C color="orange">people rarely need "everyone sees the same thing simultaneously". They need a few specific promises</C> — and buying only those is dramatically cheaper.

</Plain>

---

## 1. The spectrum

```
  STRONGEST                                                      WEAKEST
  ├──────────────┬──────────────┬──────────────┬────────────────┤
  linearizable   sequential     causal         eventual
  │              │              │              │
  most           total order,   causes before  converges
  coordination   no real time   effects        someday
  most latency                                 least latency
```

| Model | Guarantee | Cost |
| :--- | :--- | :--- |
| **Linearizable** | Every operation appears atomic at a point in real time; all clients agree | <C color="crimson">Highest — coordination on every operation</C> |
| **Sequential** | All clients see the same *order*, which need not match real time | High |
| **Causal** | Causally related operations are seen in order; concurrent ones may differ | <C color="green">Moderate — no global coordination</C> |
| **Eventual** | If writes stop, all replicas converge | <C color="green">Lowest</C> |

<Jargon
  plain="Every read returns the most recent write, as if there were only one copy of the data."
  term="linearizability"
  also={['strong consistency', 'atomic consistency', 'external consistency']}>

The strongest single-object guarantee. <C color="orange">It is what people mean by "strongly consistent"</C>, and what CAP's C refers to. The critical part is **real time**: if write W completes before read R begins — even on a different client — R must see W.

</Jargon>

### Why linearizability is expensive

Getting it requires that a read cannot be answered from one replica in isolation — the replica cannot know whether a newer write exists elsewhere. So either reads route through a leader, or they consult a quorum. Either way, <C color="crimson">every operation pays a round trip that a local read would not</C>, and across regions that is tens or hundreds of milliseconds.

---

## 2. Eventual consistency, honestly

> If no new writes are made, all replicas **eventually** converge to the same value.

Read that carefully, because the guarantee is unusually weak:

- <C color="crimson">"Eventually" is unbounded.</C> No promise about *when*.
- <C color="crimson">Nothing is promised about the middle.</C> Reads may go backwards, skip values, or return anything previously written.
- <C color="crimson">It is conditional on writes stopping</C>, which on a live system they never do.

<H>Eventual consistency guarantees only where you end up, never what you see on the way. It is strictly a statement about the limit.</H>

It is still the right choice constantly — for follower counts, view counts, recommendations, search indexes, analytics. The mistake is not choosing it; it is choosing it and then being surprised by the middle.

---

## 3. The session guarantees

The genuinely useful middle ground, and the reason most "eventual consistency is unusable" complaints are wrong. These are per-client promises that cost far less than global ordering.

<Trace title="Four promises a user actually notices" subtitle="Each fixes one specific complaint, without requiring global agreement.">

<TraceStep
  title="Read your writes"
  state={{ 'Guarantee': 'read-your-writes', 'Fixes': 'my own change vanished', 'Cost': 'route my reads to leader briefly', 'Global coordination': 'none' }}
  changed={['Guarantee', 'Fixes', 'Cost']}
  note="The single most valuable guarantee in a web application, and the cheapest.">

*"I posted a comment and it wasn't there."*

<C color="green">Once you write a value, your subsequent reads never return an older one.</C> Implemented by routing that user's reads to the leader for a window, or tracking their write position.

</TraceStep>

<TraceStep
  title="Monotonic reads"
  state={{ 'Guarantee': 'monotonic reads', 'Fixes': 'data went backwards', 'Cost': 'pin user to one replica', 'Global coordination': 'none' }}
  changed={['Guarantee', 'Fixes', 'Cost']}
  note="Implemented by hashing the user id to a replica — no coordination at all.">

*"I saw 5 comments, refreshed, and saw 3."*

<C color="green">Successive reads never move backwards in time.</C> Caused by consecutive reads hitting replicas with different lag; fixed by pinning a session to one replica.

</TraceStep>

<TraceStep
  title="Monotonic writes"
  state={{ 'Guarantee': 'monotonic writes', 'Fixes': 'my writes applied out of order', 'Cost': 'per-session ordering', 'Global coordination': 'none' }}
  changed={['Guarantee', 'Fixes', 'Cost']}
  note="Matters for sequences like 'create record, then update it' — the update must not land first.">

*"I renamed it twice and the first name stuck."*

<C color="green">Your writes are applied in the order you issued them.</C>

</TraceStep>

<TraceStep
  title="Writes follow reads (causal)"
  state={{ 'Guarantee': 'causal consistency', 'Fixes': 'reply appeared before the message', 'Cost': 'track causal dependencies', 'Global coordination': 'none' }}
  changed={['Guarantee', 'Fixes', 'Cost']}
  note="This is the guarantee that makes comment threads read sensibly.">

*"A reply shows above the message it answers."*

<C color="green">If you read a value and then write, your write is ordered after what you read.</C>

</TraceStep>

<TraceStep
  title="What the four together give you"
  state={{ 'Guarantee': 'all four', 'Fixes': 'essentially every user complaint', 'Cost': 'session pinning + position tracking', 'Global coordination': 'STILL NONE' }}
  changed={['Guarantee', 'Fixes', 'Cost', 'Global coordination']}
  note="This is the practical sweet spot for the overwhelming majority of applications.">

A system providing all four feels correct to every individual user, while different users may still briefly see different states.

<H>None of these requires global coordination. You get the user-visible behaviour of a consistent system at close to the cost of an eventually consistent one — which is why session guarantees, not linearizability, are the right target for most applications.</H>

</TraceStep>

</Trace>

---

## 4. Causal consistency

The strongest model achievable **without** giving up availability during a partition — a genuinely important result.

If operation A causally precedes B — same client in sequence, or B was written after reading A — every replica applies A before B. Operations with no causal relationship may be seen in different orders by different replicas, <C color="green">and that is fine, because nothing depended on their order.</C>

```
  Alice: "Has anyone seen my keys?"       (A)
  Bob (after reading A): "On the table"   (B, caused by A)
  Carol: "Nice weather today"             (C, unrelated)

  Every replica must show A before B.
  C may appear anywhere — nobody can tell.
```

Tracked with [vector clocks or version vectors](./04-time-and-ordering.md). The cost is metadata proportional to the number of writers, which is why it appears more in research systems and CRDT libraries than in mainstream databases.

<Depth title="Consistency of a single object versus consistency across objects">

An under-appreciated distinction, and the source of a lot of confusion: **linearizability is a single-object guarantee**. It says a register behaves as though there were one copy. It says nothing about *two* objects.

```
  Transfer £100 from A to B, both linearizable registers:

     write A = 0     (linearizable ✓)
     write B = 100   (linearizable ✓)

  A reader between them sees A=0, B=0 — £100 has vanished.
  Both operations were perfectly linearizable.
```

What you need there is a **transaction** — an atomic multi-object operation — and that is a different axis entirely. The two combine into a lattice people rarely draw:

|  | Single object | Multiple objects |
| :--- | :--- | :--- |
| **Weak** | Eventual consistency | Read committed |
| **Strong** | Linearizability | Serializability |
| **Both** | — | **Strict serializability** |

- **Linearizability** — one object, real-time order.
- **Serializability** — many objects, some serial order exists, but *not necessarily one respecting real time*. A serializable system may order a transaction that started later before one that finished earlier.
- **Strict serializability** — both. Spanner's headline guarantee, and the strongest thing on offer.

<C color="orange">This is why a database can be "fully serializable" and still surprise you</C>: transaction T1 commits, then T2 begins and is ordered *before* T1 in the serial order. No isolation anomaly occurred; real time was simply not respected. It matters when an external channel carries information between clients — you commit an order, tell a colleague, and their transaction does not see it.

**Where each is genuinely needed:**

- **Linearizability**: distributed locks, leader election, uniqueness checks, anything where two clients must not both believe they hold something. <C color="crimson">A lock service that is not linearizable will hand the same lock to two clients</C>, and every guarantee built on it collapses.
- **Serializability**: transactions with invariants spanning rows — the [write skew](../04-data-storage/04-transactions-and-isolation.md) cases.
- **Strict serializability**: when clients communicate outside the system and expect the database to reflect that ordering.

The practical lesson: <H>"is this system consistent?" is not one question. Ask *"consistent for one key, or across keys?"* and *"does real-time ordering matter here?"* — they have different answers and different costs.</H>

</Depth>

---

## 5. Choosing

Pick the **weakest** model that satisfies the requirement, because every step up costs latency and availability.

| Requirement | Model |
| :--- | :--- |
| Distributed lock, leader election, uniqueness | <C color="green">Linearizable</C> — nothing weaker is safe |
| Account balance, inventory, seat booking | <C color="green">Linearizable or serializable transaction</C> |
| User sees their own edits | <C color="green">Read-your-writes</C> — cheap, and usually all that was wanted |
| Feed, timeline, comment thread | <C color="green">Causal</C> — replies after messages |
| Follower counts, view counts, likes | <C color="green">Eventual</C> |
| Search index, recommendations, analytics | <C color="green">Eventual</C> |

<C color="crimson">The most common design error is defaulting to strong consistency everywhere</C>, paying coordination latency on every request to protect data where nobody could tell the difference. The second most common is defaulting to eventual and then discovering the lock service is not safe.

---

## 6. In a design discussion

- **"Read-your-writes for the user who posted, eventual for everyone else — that covers the complaint without global coordination."** The cheapest correct answer.
- **"Causal consistency for the comment thread, so a reply never appears before the message it answers."** Names the model and the symptom it prevents.
- **"The lock service must be linearizable. Anything weaker and two clients hold the same lock."** Where strength is non-negotiable.
- **"Linearizability is per-object — for the transfer we need a transaction, which is a different guarantee."** The distinction most candidates miss.

---

## Rapid-fire recall

1. Order linearizable, causal, sequential and eventual from strongest to weakest.
2. What does linearizability add that sequential consistency does not?
3. Why is linearizability expensive to implement?
4. State eventual consistency precisely, and name its three weaknesses.
5. Name the four session guarantees and the complaint each fixes.
6. Why do the session guarantees cost so much less than linearizability?
7. What is causal consistency, and what is its notable theoretical property?
8. Show how two linearizable operations can still expose an inconsistent state.
9. Distinguish linearizability, serializability and strict serializability.
10. Give one requirement where nothing weaker than linearizability is safe, and say why.

<details>
<summary>Answers</summary>

1. **Linearizable → sequential → causal → eventual.**
2. **Real-time ordering.** Sequential requires all clients to agree on *an* order; linearizability requires that order to respect actual time — if W completes before R starts, R must see W.
3. Because a replica cannot know in isolation whether a newer write exists elsewhere, so every operation must route through a leader or consult a quorum — **a round trip on every operation**, which across regions is tens to hundreds of milliseconds.
4. *If writes stop, all replicas converge.* Weaknesses: **"eventually" is unbounded**, **nothing is promised about intermediate reads** (they may go backwards), and it is **conditional on writes stopping**, which never happens live.
5. **Read-your-writes** (my change vanished) · **monotonic reads** (data went backwards) · **monotonic writes** (my writes applied out of order) · **writes follow reads / causal** (a reply appeared before its message).
6. Because they are **per-session** promises requiring no global agreement — implemented by pinning a user to one replica or tracking their own write position, with no coordination between clients.
7. Causally related operations are applied in order everywhere; concurrent ones may be seen in different orders. Its notable property: it is the **strongest model achievable while remaining available during a partition**.
8. Transferring £100 as two linearizable writes — `A = 0`, then `B = 100` — lets a reader between them see both as 0, so the money has vanished. Each operation was linearizable; **linearizability is a single-object guarantee**.
9. **Linearizability**: one object, real-time order. **Serializability**: many objects, *some* serial order exists, not necessarily respecting real time. **Strict serializability**: both — many objects, real-time order respected.
10. A **distributed lock** (or leader election, or a uniqueness check). Anything weaker allows two clients to both believe they hold the lock, and every guarantee built on top of it collapses.

</details>

---

**Next:** [Consensus and Quorums](./03-consensus-and-quorums.md) — how a group of machines agrees on anything at all.
