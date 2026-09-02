---
title: Consistent Hashing
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Consistent Hashing

> **What you will be able to do after this page**
>
> - Explain why `hash(key) % N` breaks catastrophically when `N` changes.
> - Describe the ring, and compute how much data moves when a node is added.
> - Say what virtual nodes fix, and why the naive ring is unusable without them.
> - Recognise where consistent hashing appears in systems you already use.

A small idea with an outsized payoff: <C color="orange">a way to map keys to machines such that adding or removing a machine moves as little data as possible.</C>

<Plain>

You and three friends share the job of remembering phone numbers. To decide who remembers which, you use a rule: count the letters in the name, divide by four, and whoever matches the remainder is responsible.

It works — until a fifth friend joins. Now you divide by five instead of four, and <C color="crimson">almost every name changes owner.</C> Everyone has to hand nearly everything to somebody else, all at once, just because one person joined.

Here is a better rule. Imagine everyone standing around a circular table at fixed positions. Each name also gets a position on that circle. A name is the responsibility of **the first person clockwise from where it lands**.

Now a fifth friend sits down somewhere on the circle. Only the names sitting in the arc **just before them** change owner — everyone else is completely unaffected. One person hands over one slice; nobody else does anything.

<C color="green">That is the whole idea.</C> Instead of a rule that depends on *how many* people there are, you use one that depends only on *where they sit* — so adding a person disturbs one neighbourhood instead of the entire arrangement.

</Plain>

---

## 1. Why modulo fails

```
  shard = hash(key) % N

  N = 4                          N = 5
  ─────────────────────────────────────────────
  hash 1001 → 1001 % 4 = 1       1001 % 5 = 1   stays
  hash 1002 → 1002 % 4 = 2       1002 % 5 = 2   stays
  hash 1003 → 1003 % 4 = 3       1003 % 5 = 3   stays
  hash 1004 → 1004 % 4 = 0       1004 % 5 = 4   MOVES
  hash 1005 → 1005 % 4 = 1       1005 % 5 = 0   MOVES
```

In general, going from `N` to `N+1` leaves only about `1/(N+1)` of keys in place. <C color="crimson">Adding one node to a four-node cluster relocates roughly 80% of all data.</C>

For a cache this means a near-total miss storm the instant you scale — every request goes to the origin at once, which is exactly the [stampede](../07-caching/04-cache-failure-modes.md) that brings origins down. For a database it means an impossible migration.

---

## 2. The ring

Map both **keys** and **nodes** onto the same circular hash space (say 0 to 2³²−1). A key belongs to the first node found walking **clockwise**.

```
                    0 / 2³²
                       │
          key:z ●      │      ○ NODE A
                   ╲   │   ╱
                    ╲  │  ╱
        ○ NODE C ────  ●  ──── key:x
                    ╱  │  ╲
                   ╱   │   ╲
          key:y ●      │      ○ NODE B

   key:x → clockwise → NODE B
   key:y → clockwise → NODE C
   key:z → clockwise → NODE A
```

<Jargon
  plain="Placing servers and data on the same imaginary circle, so each server owns the stretch of circle before it."
  term="consistent hashing"
  also={['the hash ring', 'ring-based partitioning']}>

"Consistent" means <C color="green">the mapping stays mostly the same as the set of nodes changes</C> — the property `modulo` lacks. Lookup is a binary search over sorted node positions: **O(log N)**.

</Jargon>

<Trace title="Adding a node to a 3-node ring" subtitle="Watch which keys move — and which do not.">

<TraceStep
  title="Three nodes, keys distributed"
  state={{ 'Nodes': 'A, B, C', 'Keys on A': '~33%', 'Keys moved': '0', 'Cache hit ratio': '95%' }}
  note="Each node owns the arc from the previous node clockwise to itself.">

Nodes A, B and C sit at fixed positions. Every key walks clockwise to its owner.

</TraceStep>

<TraceStep
  title="Node D is added between C and A"
  cost="only C's arc splits"
  state={{ 'Nodes': 'A, B, C, D', 'Keys on A': '~25%', 'Keys moved': '~25%', 'Cache hit ratio': 'briefly 70%' }}
  changed={['Nodes', 'Keys on A', 'Keys moved', 'Cache hit ratio']}
  note="With modulo, this same change would have moved ~80% of keys and collapsed the hit ratio to near zero.">

D takes over the arc between C and D. <C color="green">Only keys in that arc move, and they all come from one node.</C> A and B are untouched.

</TraceStep>

<TraceStep
  title="Node B fails"
  cost="B's arc absorbed by C"
  state={{ 'Nodes': 'A, C, D', 'Keys on C': 'C + all of B', 'Keys moved': "B's share only", 'Load balance': 'C now overloaded' }}
  changed={['Nodes', 'Keys on C', 'Keys moved', 'Load balance']}
  note="Correct, and unbalanced — the entire failed node's load lands on exactly one neighbour.">

B's keys now walk clockwise to C. Only B's keys are affected — but <C color="crimson">C now carries double load</C>, which can cascade into C failing too.

</TraceStep>

<TraceStep
  title="The distribution problem, even without failures"
  cost="unusable in practice"
  state={{ 'Node A share': '55%', 'Node B share': '30%', 'Node C share': '15%', 'Load balance': 'badly skewed' }}
  changed={['Node A share', 'Node B share', 'Node C share', 'Load balance']}
  note="Three random points on a circle do not divide it into three equal arcs — the variance is large.">

With few nodes placed at random positions, arcs are wildly unequal. <C color="crimson">A plain ring with 3 nodes routinely gives one node three times another's load.</C>

</TraceStep>

<TraceStep
  title="Virtual nodes fix both problems"
  state={{ 'Node A share': '34%', 'Node B share': '33%', 'Node C share': '33%', 'Load balance': 'even' }}
  changed={['Node A share', 'Node B share', 'Node C share', 'Load balance']}
  note="Each physical node is placed at ~150 positions. Averaging over many small arcs makes the shares converge.">

Each physical node gets **many** positions on the ring — typically 100–200 virtual nodes each.

<H>Now a failed node's load is spread across all remaining nodes rather than dumped on one neighbour, and random placement averages out into an even distribution. Virtual nodes are not an optimisation — the naive ring is unusable without them.</H>

</TraceStep>

</Trace>

---

## 3. Virtual nodes, precisely

Instead of hashing `"node-A"` once, hash `"node-A#0"`, `"node-A#1"`, … `"node-A#149"` and place all 150 on the ring.

| Problem with a plain ring | What virtual nodes do |
| :--- | :--- |
| <C color="crimson">Uneven arcs from random placement</C> | 150 samples per node average out; skew drops to a few percent |
| <C color="crimson">A failed node dumps all load on one neighbour</C> | <C color="green">Its 150 arcs are inherited by many different nodes</C> |
| <C color="crimson">Heterogeneous hardware ignored</C> | <C color="green">Give a 2× machine 2× the virtual nodes</C> |
| <C color="crimson">Adding a node drains only one neighbour</C> | New node's 150 arcs take a little from everyone |

The trade-off is memory and lookup cost: 1,000 physical nodes × 150 = 150,000 ring entries. Still trivial, and lookup remains `O(log)` over the sorted positions.

<Depth title="How much actually moves, and where consistent hashing is used">

**The movement guarantee.** With `N` nodes and virtual nodes making arcs approximately uniform, adding one node moves about `1/(N+1)` of keys — the new node's share, and nothing else. Removing one moves that node's `1/N`, redistributed across the rest.

| Change | Modulo hashing | Consistent hashing |
| :--- | ---: | ---: |
| 4 → 5 nodes | ~80% of keys | <C color="green">~20%</C> |
| 10 → 11 nodes | ~91% | <C color="green">~9%</C> |
| 100 → 101 nodes | ~99% | <C color="green">~1%</C> |

Note that the advantage **grows with cluster size**, which is the opposite of most techniques. At 100 nodes, modulo is catastrophic and the ring is nearly free.

**Where you will meet it:**

- **Cassandra and DynamoDB** — the ring is the core partitioning scheme; a key's replicas are the next `R` distinct nodes clockwise.
- **Memcached clients** (`ketama`) — the original popular use. This is where consistent hashing entered mainstream engineering, precisely to stop cache scaling from causing a miss storm.
- **CDN edge selection** — mapping a URL to a cache server within a location.
- **Nginx** — `hash $request_uri consistent;` for upstream selection.
- **Envoy and load balancers** — `ring_hash` for session affinity without sticky cookies.

**Two refinements worth knowing by name:**

**Bounded loads.** Plain consistent hashing has no upper limit on how much one node can receive — a popular key or unlucky arc can still overload a node. The *consistent hashing with bounded loads* variant caps any node at `(1 + ε)` times the average; when a node is at its cap, keys walk on to the next node. <C color="green">Guarantees a load bound while keeping the low-movement property.</C>

**Rendezvous hashing (HRW).** An alternative that reaches the same goal differently: for each key, compute `hash(key, node)` for every node and pick the **highest**. Adding a node only steals the keys for which it now scores highest — again about `1/(N+1)`.

- <C color="green">No ring, no virtual nodes, perfectly even distribution by construction.</C>
- <C color="crimson">Lookup is `O(N)`</C> rather than `O(log N)`, since you must score every node.

For small `N` — picking among a handful of caches or replicas — rendezvous is simpler and better. For large `N`, the ring's logarithmic lookup wins. <C color="orange">Rendezvous hashing is under-used and worth reaching for whenever the node count is small</C>, because it removes the virtual-node tuning entirely.

</Depth>

---

## 4. Where it does and does not help

<C color="green">Use it when</C> nodes join and leave routinely and the cost of moving data is the constraint: distributed caches, DHTs, sharded stores that autoscale, stateful connection routing.

<C color="crimson">It does not help when</C> the mapping needs to be arbitrary rather than hash-determined — placing a specific large tenant on a specific node, or honouring data-residency rules. That is what a [directory](./02-partitioning-and-sharding.md) is for, and a directory beats a ring whenever you need per-key control.

<H>Consistent hashing minimises movement; it does not give you control over placement. If you need to say "this customer lives on that machine", you want a directory, not a ring.</H>

---

## 5. In a design discussion

- **"Consistent hashing with ~150 virtual nodes per physical node — adding a node moves `1/(N+1)` of keys instead of the ~80% that modulo would."** The number, and the reason.
- **"Without virtual nodes a failed node dumps its entire load on one neighbour, which can cascade."** The failure mode that makes them mandatory.
- **"For a handful of cache nodes I'd use rendezvous hashing — same movement property, no virtual-node tuning, and `O(N)` doesn't matter at N=5."** Shows range.
- **"A ring can't place a specific tenant on a specific shard, so for that requirement I'd use a directory instead."** Knows the limit.

---

## Rapid-fire recall

1. Going from 4 nodes to 5 with modulo hashing, roughly what fraction of keys move? Why?
2. Describe how a key finds its node on the ring.
3. What does "consistent" actually refer to?
4. Give the two problems a plain ring has, even with no failures.
5. What are virtual nodes, and how many per physical node is typical?
6. How do virtual nodes prevent a cascading failure after a node dies?
7. How do you handle a machine twice as powerful as the others?
8. Compare movement for modulo and consistent hashing at 100 → 101 nodes.
9. What does consistent hashing with bounded loads add, and why is it needed?
10. When is rendezvous hashing the better choice, and what does it cost?

<details>
<summary>Answers</summary>

1. About **80%**. `hash(key) % N` changes for nearly every key when `N` changes — only roughly `1/(N+1)` happen to map to the same slot.
2. Both keys and nodes are hashed onto the same circular space. A key belongs to the **first node clockwise** from its position, found by binary search over sorted node positions — `O(log N)`.
3. That the **mapping stays mostly unchanged** as nodes are added or removed — the property modulo hashing lacks.
4. **Uneven arcs** — a few random points do not divide a circle evenly, so one node can carry several times another's load. And **a failed node dumps its entire share on its single clockwise neighbour**, which can cascade.
5. Placing each physical node at **many positions** on the ring (hashing `node-A#0` … `node-A#149`). Typically **100–200** per physical node.
6. Because a node's ~150 arcs are scattered around the ring, so its load is **inherited by many different nodes** rather than concentrated on one — no single survivor absorbs a doubling.
7. Give it **twice as many virtual nodes**, so it owns roughly twice the ring.
8. Modulo moves ~**99%** of keys; consistent hashing moves ~**1%**. The advantage grows with cluster size.
9. It **caps any node at `(1 + ε)` times the average load**, with overflow keys walking on to the next node. Needed because plain consistent hashing bounds *movement* but places no upper bound on how much load one node can end up with.
10. When **`N` is small** — a handful of caches or replicas. It gives perfectly even distribution with no virtual-node tuning, at the cost of **`O(N)` lookup** (scoring every node) instead of `O(log N)`.

</details>

---

**Next:** [Zero-Downtime Migrations](./04-zero-downtime-migrations.md) — changing data that is being read and written the whole time.
