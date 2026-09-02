---
title: Partitioning and Sharding
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Partitioning and Sharding

> **What you will be able to do after this page**
>
> - Choose a partition key, and explain why it is close to irreversible.
> - Compare range, hash and directory partitioning on their actual failure modes.
> - Recognise a hot partition before you build one.
> - Say what you permanently lose the moment data spans machines.

Sharding is the last rung on the [scaling ladder](../01-foundations/06-thinking-in-tradeoffs.md) for a reason: <C color="crimson">it is the hardest to undo and the one that takes the most away from you.</C>

<Plain>

A library outgrows its building. There is no room for more shelves, so you open a second building and split the books between them.

Immediately you must answer one question: **how do you decide which building a book goes in?**

**By author surname.** A–M here, N–Z there. Simple, and browsing "everything by Tolkien" means one trip. The snag is that surnames are not evenly distributed — far more people are shelved under S than under Q, so one building fills up while the other has space.

**By a rule that scrambles them.** Take some code from each book and use it to pick a building. Now both fill evenly. But "everything by Tolkien" is scattered across both, so that trip is now two trips.

Notice what happened either way. <C color="crimson">Any question that used to be answerable by walking one building may now require visiting both</C> — and combining results yourself. Sorting all books by publication date used to be a walk down an aisle; now it means collecting from two places and merging.

And the decision is nearly permanent. Changing from surname to scrambled means physically re-shelving every book in both buildings, while people are still borrowing them.

That is sharding: <C color="orange">you get capacity, and you pay for it in every question that crosses the split.</C>

</Plain>

---

## 1. Vertical, horizontal, and what sharding means

Three different things get called "partitioning". Keep them separate.

| | What it splits | Example |
| :--- | :--- | :--- |
| **Vertical partitioning** | Columns of one table | Move rarely-read `bio` and `avatar_blob` to a side table |
| **Horizontal partitioning** | Rows of one table, same machine | Postgres native partitioning by month |
| **Sharding** | Rows across **different machines** | Users 1–1M on shard A, 1M–2M on shard B |

<Jargon
  plain="Splitting your data across separate machines so no one machine holds it all."
  term="sharding"
  also={['horizontal partitioning', 'data partitioning']}>

The word that matters is **shard key** — the column whose value decides which machine a row lives on. <C color="orange">Choosing it is the single most consequential and least reversible decision in the design.</C>

</Jargon>

**Reasons to shard, in order of legitimacy:**

1. **Storage volume** — the data does not fit on one machine, and will not.
2. **Write throughput** — beyond what one primary can sustain (a few thousand writes/sec).
3. **Blast radius** — one shard failing affects a fraction of users rather than all.
4. **Data residency** — EU rows must physically stay in the EU.

<C color="crimson">Read throughput is not on that list.</C> Reads are solved by replicas and caching, which are far cheaper and reversible.

---

## 2. The three strategies

### Range partitioning

Contiguous key ranges per shard. `A–F`, `G–M`, `N–Z`, or by date.

<C color="green">Range scans are efficient</C> — "all orders in March" hits one shard.
<C color="crimson">Uneven distribution, and time-based ranges guarantee a hot shard</C>: if you partition by date, *all of today's writes* go to one machine while the others sit idle.

### Hash partitioning

`shard = hash(key) % N`.

<C color="green">Even distribution, essentially for free.</C>
<C color="crimson">Range queries must hit every shard</C>, and <C color="crimson">changing `N` remaps almost everything</C> — which is what [consistent hashing](./03-consistent-hashing.md) exists to fix.

### Directory-based

A lookup service maps key → shard.

<C color="green">Total flexibility — move any key anywhere, rebalance precisely.</C>
<C color="crimson">The directory is a lookup on every request and a new single point of failure</C> (cache it aggressively, replicate it).

| | Range | Hash | Directory |
| :--- | :--- | :--- | :--- |
| Even distribution | <C color="crimson">No</C> | <C color="green">Yes</C> | <C color="green">Yes</C> |
| Range queries | <C color="green">Efficient</C> | <C color="crimson">Fan out to all</C> | Depends |
| Rebalancing | <C color="orange">Split a range</C> | <C color="crimson">Painful with modulo</C> | <C color="green">Easy</C> |
| Extra dependency | No | No | <C color="crimson">Yes</C> |

---

## 3. Choosing the key

Four requirements. A good key satisfies all four; most candidate keys fail at least one.

**1. High cardinality.** Enough distinct values to spread across shards and keep spreading as you grow. `country` has ~200 values — fine for 4 shards, useless at 500.

**2. Even distribution.** Values should appear with roughly equal frequency. <C color="crimson">`country` fails here too</C> — a US-heavy product puts most rows on one shard.

**3. Present in most queries.** If the key is not in the `WHERE` clause, the query fans out to every shard. This is the requirement people forget, and it does the most damage.

**4. Stable.** A key that changes means the row must physically move between machines. Never shard on something mutable.

### The trace that matters

<Trace title="Choosing a shard key for a SaaS app" subtitle="Multi-tenant. Queries: 'my dashboard', 'my team's activity', 'admin: all activity today'.">

<TraceStep
  title="Candidate 1 — shard by created_at"
  cost="hot shard"
  state={{ 'Distribution': 'even over time', 'Today write load': '100% on one shard', 'Dashboard query': 'fans out', 'Verdict': 'reject' }}
  changed={['Distribution', 'Today write load', 'Dashboard query', 'Verdict']}
  note="Time-based keys always concentrate writes, because all new data has today's date.">

Data spreads evenly across history — and <C color="crimson">every write today goes to one shard</C> while the others idle. The dashboard query has no date filter, so it fans out to all shards.

</TraceStep>

<TraceStep
  title="Candidate 2 — shard by user_id"
  state={{ 'Distribution': 'even', 'Today write load': 'even', 'Dashboard query': 'single shard', 'Verdict': 'close, but…' }}
  changed={['Distribution', 'Today write load', 'Dashboard query', 'Verdict']}
  note="Good on three of four requirements. The failure is in the second query, not the first.">

High cardinality, even, stable. "My dashboard" hits <C color="green">one shard</C>.

But *"my team's activity"* spans many users — <C color="crimson">and those users are scattered across every shard.</C>

</TraceStep>

<TraceStep
  title="Candidate 3 — shard by tenant_id"
  state={{ 'Distribution': 'uneven (tenant sizes vary)', 'Today write load': 'even-ish', 'Dashboard query': 'single shard', 'Team query': 'single shard', 'Verdict': 'best fit' }}
  changed={['Distribution', 'Team query', 'Verdict']}
  note="A tenant is the natural boundary: nearly every query in a B2B product is scoped to one.">

All of a tenant's data lives together, so <C color="green">both the dashboard and the team query hit one shard</C>. Cross-tenant queries are rare and can fan out.

The remaining problem: <C color="crimson">tenants are wildly different sizes.</C> One enterprise customer may be larger than a thousand small ones.

</TraceStep>

<TraceStep
  title="The hot tenant appears"
  cost="one shard at 90% while others idle"
  state={{ 'Shard 3 load': '90%', 'Other shards': '~15%', 'Dashboard query': 'slow for everyone on shard 3', 'Verdict': 'needs mitigation' }}
  changed={['Shard 3 load', 'Other shards', 'Dashboard query', 'Verdict']}
  note="The classic multi-tenant failure: your biggest customer degrades everyone unlucky enough to share their shard.">

Your largest customer lands on shard 3. Now every tenant sharing that shard suffers.

</TraceStep>

<TraceStep
  title="The mitigations"
  state={{ 'Shard 3 load': '40%', 'Other shards': '~35%', 'Dashboard query': 'fast', 'Verdict': 'workable' }}
  changed={['Shard 3 load', 'Other shards', 'Dashboard query', 'Verdict']}
  note="Directory-based mapping is what makes the first two possible — with plain hash-modulo you cannot place a specific tenant.">

<C color="green">Dedicated shards</C> for the largest tenants · <C color="green">a directory</C> so any tenant can be moved individually · <C color="green">a composite key</C> `(tenant_id, user_id)` for tenants big enough to split internally.

<H>Notice that the fix required the directory strategy. Choosing plain hash-modulo early would have left you unable to place a specific tenant anywhere — the key choice constrains the mitigations available years later.</H>

</TraceStep>

</Trace>

---

## 4. What you give up

The part that makes sharding a last resort rather than a scaling technique.

| Lost | Consequence |
| :--- | :--- |
| **Cross-shard joins** | Join in application code, or denormalize so joins are unnecessary |
| **Multi-shard transactions** | No atomic write across shards without 2PC — usually replaced by [sagas](../06-distributed-systems/06-distributed-transactions.md) |
| **Global uniqueness** | `UNIQUE(email)` cannot be enforced across shards; you need a separate registry, or shard *by* email |
| **Global auto-increment** | Use [Snowflake IDs or a ticket server](../14-building-blocks/01-unique-id-generation.md) |
| **Cheap `ORDER BY` + `LIMIT`** | Must fetch N from every shard, merge, then take N |
| **Cheap aggregates** | `COUNT(*)` becomes a scatter-gather across every shard |
| **Simple schema migrations** | Every DDL change now runs on every shard, and can partially fail |

<H>Sharding does not make your database bigger. It makes it into several smaller databases that cannot see each other — and every capability that depended on them seeing each other is now your problem.</H>

<Depth title="Rebalancing without downtime, and why modulo is a trap">

**The modulo problem.** With `shard = hash(key) % N`, going from 4 shards to 5 changes the destination of roughly **80% of all keys**. Every one must physically move, while the system is live. This is why naive hash sharding is essentially a one-time decision that you cannot revisit.

**Fix 1 — many more partitions than nodes.** Create a fixed, large number of logical partitions (say 1,024) at the start, and assign ranges of them to physical nodes. Adding a node means **moving whole partitions**, not rehashing keys:

```
  1,024 logical partitions, 4 nodes → 256 partitions each
  Add a 5th node → move ~51 partitions per existing node → each node keeps ~205
```

Only ~20% of data moves, the mapping is a small table you can hold anywhere, and no key ever changes its logical partition. This is what Cassandra, Elasticsearch and Kafka all do, and <C color="green">it is the design to choose up front</C> — 1,024 partitions costs nothing at four nodes and saves you an impossible migration later.

**Fix 2 — consistent hashing.** Covered on the [next page](./03-consistent-hashing.md); moves ~`1/N` of keys when a node is added.

**Fix 3 — dynamic splitting.** Partitions split when they exceed a size threshold, as in HBase and MongoDB. Adapts automatically to skew, at the cost of split operations happening under load.

**The live rebalance procedure**, which is the same shape as any data move:

1. **Mark the partition as moving** in the routing layer.
2. **Copy the bulk** of the data to the new node while the old one still serves.
3. **Stream the changes** that occurred during the copy.
4. **Briefly pause writes** for that partition — milliseconds — while the last delta catches up.
5. **Flip the routing** and unpause.
6. **Verify, then delete** the old copy — <C color="crimson">not before verifying, and not immediately</C>.

**Rate-limit the transfer.** Rebalancing competes with production traffic for disk, network and CPU. Unthrottled, it can cause the exact outage you were rebalancing to prevent — and it is a common way to turn a capacity problem into an incident.

</Depth>

---

## 5. Practical guidance

**Do not shard until you must.** A single Postgres handles terabytes and tens of thousands of QPS. Exhaust vertical scaling, caching and read replicas first.

**Design the key as though it were permanent**, because it nearly is. Write down the queries it must serve, and check each one against the four requirements.

**Over-provision logical partitions from day one.** 1,024 logical partitions across 4 nodes costs nothing now and makes every future rebalance routine.

**Keep a routing layer.** An application that computes `hash(key) % N` inline has hard-coded `N` into every service. A routing layer — a proxy like Vitess, or a directory service — makes the topology changeable.

**Plan the cross-shard queries you will need.** Admin dashboards, exports and analytics all want to cross shards. The usual answer is a separate denormalized store fed by [change data capture](./04-zero-downtime-migrations.md), rather than fanning out live queries.

---

## 6. In a design discussion

- **"Shard by `tenant_id` — nearly every query is tenant-scoped, so it stays single-shard. The risk is a hot tenant, so I'd use a directory to place large tenants individually."** Names the key, the reason, the risk, and the mitigation.
- **"1,024 logical partitions mapped onto 4 nodes, so adding nodes moves partitions rather than rehashing keys."** Removes the future migration before it exists.
- **"Sharding buys write throughput and storage, not read throughput. If reads are the problem, replicas and cache come first."** Correct ordering.
- **"Cross-shard aggregates go to a separate analytics store via CDC — I don't want admin queries fanning out across every shard."** Handles the query the design breaks.

---

## Rapid-fire recall

1. Distinguish vertical partitioning, horizontal partitioning and sharding.
2. Give the four legitimate reasons to shard, and the one common reason that is not.
3. Compare range, hash and directory partitioning on distribution and rebalancing.
4. Why does date-based range partitioning guarantee a hot shard?
5. State the four requirements for a shard key.
6. In the SaaS example, why did `user_id` fail despite meeting three requirements?
7. What is the hot tenant problem, and give three mitigations?
8. Name five capabilities you lose when data spans machines.
9. Why does going from 4 to 5 shards with modulo hashing move ~80% of keys, and what fixes it?
10. Give the six steps of a live partition move, and say what must be rate-limited.

<details>
<summary>Answers</summary>

1. **Vertical** splits **columns** of a table. **Horizontal** splits **rows**, possibly on one machine. **Sharding** splits rows across **different machines** — which is what introduces all the difficulty.
2. Legitimate: **storage volume**, **write throughput**, **blast radius**, **data residency**. Not legitimate: **read throughput** — solved far more cheaply and reversibly by replicas and caching.
3. **Range**: uneven distribution, efficient range scans, rebalance by splitting a range. **Hash**: even distribution, range queries fan out, painful rebalancing with modulo. **Directory**: even and flexible, easy rebalancing, but adds a lookup and a dependency.
4. Because all new rows carry **today's date**, so every write lands in the newest range — one shard absorbs 100% of write traffic while the rest sit idle.
5. **High cardinality** · **even distribution** · **present in most queries** · **stable** (never changes, since a change means physically moving the row).
6. It failed **"present in most queries"** for the second query — *"my team's activity"* spans many users, and those users hash to different shards, so the query fans out.
7. One tenant far larger than the others lands on a shard and degrades every tenant sharing it. Mitigations: **dedicated shards** for the largest tenants · a **directory** so any tenant can be relocated individually · a **composite key** `(tenant_id, user_id)` to split a huge tenant internally.
8. **Cross-shard joins** · **multi-shard transactions** · **global uniqueness constraints** · **global auto-increment** · **cheap `ORDER BY`/`LIMIT`** · **cheap aggregates** · **simple migrations** (any five).
9. Because `hash(key) % N` changes for almost every key when `N` changes — only keys whose hash happens to map identically stay put. Fixes: **many more logical partitions than nodes** (move whole partitions), **consistent hashing**, or **dynamic splitting**.
10. Mark the partition moving → bulk copy → stream changes → brief write pause for that partition → flip routing → verify, then delete the old copy. **The transfer must be rate-limited**, or it competes with production traffic and causes the outage you were trying to prevent.

</details>

---

**Next:** [Consistent Hashing](./03-consistent-hashing.md) — adding a node without moving everything.
