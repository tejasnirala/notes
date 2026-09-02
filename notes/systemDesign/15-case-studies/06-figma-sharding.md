---
title: Figma's Sharding
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Figma's Sharding

> **The claim:** Figma horizontally sharded PostgreSQL while running, by separating the *logical* sharding decision from the *physical* move — so the risky, irreversible part could be validated before anything was relocated.
>
> *Source: "How Figma's databases team lived to tell the scale", Figma engineering blog, 2024.*

<C color="orange">The most practically useful case study here, because sharding is the change everyone eventually faces and almost nobody gets to rehearse.</C>

<Plain>

A library outgrows its building and must split across two.

The obviously terrifying step is moving the books. Once they are in two buildings, undoing it is another enormous move — and if the split turns out to be wrong (all the popular books in one building), you find out **after** the hard part is done.

So a careful librarian does something clever first.

**Draw the line without moving anything.** Decide which books belong to building A and which to building B, and label them. Every book stays exactly where it is. <C color="green">Nothing has moved, nothing is at risk, and the labelling can be corrected freely.</C>

Then run normally for weeks, with the catalogue routing every request through the labels. Requests that would need books from both buildings now show up as **problems you can see and fix**, while everything is still in one place.

Only once the labelling has proven itself — no awkward cross-building requests, no unbalanced load — do you actually move the books.

<H>By the time the irreversible step happens, it is the least interesting part. All the risk was in the decision, and the decision was validated separately, while it was still free to change.</H>

</Plain>

---

## 1. Separating the decision from the move

The central idea, and the one that transfers directly.

<Jargon
  plain="Assigning every row to a shard without yet putting it on a different machine."
  term="logical sharding before physical sharding"
  also={['colos / colocation groups', 'shard key validation']}>

<C color="green">Logical sharding makes the shard key a real, enforced constraint while all data still lives in one database.</C> Every query must declare its shard key, and cross-shard queries fail loudly — so they are found and fixed before any move.

</Jargon>

<Trace title="Sharding without a big-bang migration" subtitle="Each step is reversible until the last.">

<TraceStep
  title="Choose colocation groups"
  state={{ 'Data moved': 'none', 'Shard key enforced': 'no', 'Cross-shard queries': 'unknown', 'Reversible': 'entirely' }}
  changed={['Data moved', 'Cross-shard queries']}
  note="Tables that must be queried together are grouped so they share a shard key — the aggregate boundary made explicit.">

Tables sharing a shard key are grouped into **colos** — sets that will always live together, so joins within a group remain possible.

</TraceStep>

<TraceStep
  title="Add the shard key to every table"
  state={{ 'Data moved': 'none', 'Shard key present': 'yes', 'Cross-shard queries': 'unknown', 'Reversible': 'entirely' }}
  changed={['Shard key present']}
  note="A backfill of a column — significant work, and entirely safe and reversible.">

Every table in a colo carries the shard key, backfilled while live.

</TraceStep>

<TraceStep
  title="Route through a proxy that enforces the key"
  cost="the discovery phase"
  state={{ 'Data moved': 'none', 'Shard key enforced': 'YES', 'Cross-shard queries': 'now visible', 'Reversible': 'entirely' }}
  changed={['Shard key enforced', 'Cross-shard queries']}
  note="This is where the real work is: every query that cannot declare a shard key is a design problem to solve.">

A **query proxy** sits between the application and the database, requiring every query to declare its shard key.

<C color="crimson">Queries that cannot are surfaced as failures</C> — and each is fixed while everything still lives in one database and a rollback is trivial.

</TraceStep>

<TraceStep
  title="Run in production, still unsharded"
  state={{ 'Data moved': 'none', 'Cross-shard queries': 'fixed', 'Load per logical shard': 'measurable', 'Reversible': 'entirely' }}
  changed={['Cross-shard queries', 'Load per logical shard']}
  note="Now you can measure whether the shard key actually distributes load evenly — before committing to it.">

<C color="green">Real traffic validates the shard key</C>: is the distribution even, are there hot logical shards, does anything still need to cross?

If the key is wrong, <C color="green">change it — nothing has moved.</C>

</TraceStep>

<TraceStep
  title="Move one logical shard to its own database"
  cost="the first irreversible step"
  state={{ 'Data moved': 'one shard', 'Rollback': 'possible but costly', 'Risk': 'contained to one shard', 'Reversible': 'partially' }}
  changed={['Data moved', 'Rollback', 'Risk', 'Reversible']}
  note="Physical move using logical replication, with a brief cutover — the standard live-migration procedure.">

Replicate the shard's data to a new database, catch up, briefly pause writes for that shard, flip routing.

<C color="green">Only one shard is at risk, and the rest of the system is untouched.</C>

</TraceStep>

<TraceStep
  title="Repeat"
  state={{ 'Data moved': 'incrementally', 'Risk': 'one shard at a time', 'Learning': 'compounds', 'Reversible': 'per shard' }}
  changed={['Data moved', 'Learning']}
  note="Each move is routine by the time it happens, because the decision was validated long before.">

<H>The irreversible step became mechanical because every judgement it depended on had already been tested under production traffic.</H>

</TraceStep>

</Trace>

---

## 2. Why this ordering matters

<Depth title="What normally goes wrong, and the techniques that avoid it">

**The usual sharding failure** is to make the decision and the move at the same time. The shard key is chosen from reasoning, a migration is planned, data is relocated — and only then does the team discover:

- A common query does not include the shard key and now fans out to every shard.
- One shard holds 40% of the load because the key was skewed in a way that was invisible beforehand.
- Two tables that are joined constantly landed on different shards.

<C color="crimson">All of these are now expensive to fix, because the data has moved.</C> Figma's ordering surfaces every one of them while a change still costs nothing.

**The techniques worth taking, in order of value:**

**1. Enforce the shard key before sharding.** A proxy or data-access layer that **rejects any query without a shard key** turns "we think this will work" into a list of concrete failures to resolve. <C color="green">This is the single highest-value idea in the case study</C>, and it can be adopted independently of any actual sharding plan.

**2. Group tables that must stay together.** Colocation groups are [aggregate boundaries](../09-architecture-styles/02-service-boundaries.md) written down and enforced. Deciding them explicitly is much better than discovering them when a join breaks.

**3. Move one shard at a time.** The blast radius of each move is one shard's users. A problem affects a fraction, is learned from, and the procedure improves before the next.

**4. Keep the routing layer separate from the application.** With a proxy, topology changes are configuration rather than code, and the application does not hard-code `N`. This is also what makes moving a single shard possible without a deploy.

**5. Design for rebalancing from the start.** Many logical shards mapped onto fewer physical databases means adding capacity moves whole logical shards rather than rehashing keys — the [1,024-partitions pattern](../05-data-at-scale/02-partitioning-and-sharding.md).

**What still could not be avoided.** Sharding removes capabilities regardless of how carefully it is done: no cross-shard transactions, no cross-shard joins, no global unique constraints, and every schema change now runs across every shard. <C color="orange">Figma's approach reduced the risk of the transition, not the permanent cost of being sharded.</C>

**The judgement worth copying.** Sharding is a **one-way door**. The technique here is to convert it into a sequence in which almost every step is a two-way door, leaving one small irreversible step at the end whose inputs have all been validated.

<H>That generalises far beyond sharding. Whenever facing an irreversible change, ask what part of it can be made reversible and validated first — and whether the risky decision can be tested while it is still free to change.</H>

The same shape appears in [expand-contract migrations](../05-data-at-scale/04-zero-downtime-migrations.md), in [shadow traffic](../13-observability/03-deployment-strategies.md), and in dual-write cutovers. It is arguably the single most valuable pattern in operating systems at scale.

</Depth>

---

## Rapid-fire recall

1. What is logical sharding, and what does it make possible?
2. What is a colocation group, and what existing concept does it correspond to?
3. What does the query proxy enforce, and why is that the highest-value step?
4. What can you measure after logical sharding that you could not before?
5. Which step is the first irreversible one, and how is its risk contained?
6. Name three discoveries that normally arrive too late in a sharding project.
7. Why keep routing in a proxy rather than the application?
8. What does sharding cost permanently, regardless of how carefully it is done?
9. State the general pattern this case demonstrates.
10. Where else does the same pattern appear?

<details>
<summary>Answers</summary>

1. **Assigning every row to a shard and enforcing the shard key while all data still lives in one database.** It makes the shard-key decision testable under production traffic before anything is physically moved.
2. A set of tables that will always live on the same shard so they can still be joined. It corresponds to an **aggregate** — the transactional boundary — made explicit and enforced.
3. That **every query declares its shard key**, so queries that cannot are surfaced as failures. Highest-value because it converts an assumption into a **concrete list of problems**, fixable while rollback is trivial.
4. Whether the shard key **distributes load evenly**, whether any logical shard is hot, and how many queries genuinely need to cross shards — all under real traffic, before committing.
5. **Moving the first logical shard to its own database.** Risk is contained because only that shard's data and users are affected; the rest of the system is untouched.
6. A **common query lacks the shard key** and now fans out · **one shard holds a disproportionate share of load** · **two frequently-joined tables landed on different shards**. All are expensive once data has moved.
7. Because topology changes become **configuration rather than code**, the application never hard-codes the shard count, and individual shards can be moved without a deploy.
8. **No cross-shard transactions or joins**, **no global unique constraints**, and **every schema change must run across every shard**. The approach reduces transition risk, not the permanent cost.
9. <H>Convert an irreversible change into a sequence where almost every step is reversible, leaving one small irreversible step at the end whose inputs have all been validated.</H>
10. **Expand-contract schema migrations**, **shadow traffic before a cutover**, and **dual-write store migrations** — all the same shape.

</details>

---

**Next:** [AWS S3, 2017](./07-aws-s3-2017.md) — the first of the postmortems.
