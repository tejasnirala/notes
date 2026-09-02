---
title: Thinking In Trade-offs
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Thinking In Trade-offs

> **What you will be able to do after this page**
>
> - Name the seven axes every design decision trades along.
> - Recognise that most "best practices" are one point on an axis, not a law.
> - Treat cost as a first-class design constraint rather than an afterthought.
> - Say when *not* to distribute, and defend it.
> - Write down a decision so that the next person understands why, not just what.

This is the last Foundations page and the one that generalises. The specific technologies in [Part A](/systemDesign/concepts) will change over your career. The axes will not.

<Plain>

Think about choosing where to live.

Close to the office means a short commute and expensive rent. Further out means cheap space and two hours a day on a train. A middle option gets you a bit of both and neither properly.

There is no correct answer, and anyone who insists there is has simply not said what they are optimising for. Someone with small children weighs space heavily. Someone working late weighs the commute. **Same choices, different constraints, different right answers.**

Engineering is identical, and the mistake people make is identical too: treating a preference as a law. "Always use microservices" is exactly as sensible as "always live in the city centre" — true for some people, expensive for others, and useless as advice until you know whose life it is.

This page is about the handful of dials you are actually turning, so you can say *what you are trading for what* rather than reaching for whatever is fashionable.

</Plain>

---

## 1. The seven axes

Every design decision moves you along at least one of these. Nothing is free; if a choice looks free, you have not found what it costs yet.

<Jargon
  plain="Something you give up in order to get something else."
  term="a trade-off"
  also={['a design constraint', 'a tension']}>

The single most useful sentence pattern in a design discussion is <C color="green">*"X buys us A at the cost of B"*</C>. It is what separates a design conversation from a shopping list, and interviewers listen for it specifically.

</Jargon>

### Axis 1 — Consistency ↔ Availability (and latency)

Do all readers see the same value immediately, or can some see stale data so the system stays fast and up?

```
  STRONG                                                    EVENTUAL
  ├──────────────┬──────────────┬─────────────┬────────────────┤
  linearizable   read-your-      bounded       eventual
                 writes          staleness
  bank balance   your own        analytics     follower count
                 profile edit    dashboard     "likes"
```

Formalised by [CAP and PACELC](/systemDesign/concepts). The practical version: **strong consistency costs coordination, and coordination costs round trips.** You pay for it in latency on every write, always — not only during a partition.

### Axis 2 — Latency ↔ Throughput

Batching improves throughput and worsens individual latency. Committing to disk per write is durable and slow; committing in groups is fast and loses the last few milliseconds on a crash. Kafka's `linger.ms` is exactly this dial exposed as a config field.

### Axis 3 — Space ↔ Time

Precompute (spend storage) or compute on demand (spend CPU and latency)? Caches, materialised views, denormalized tables, precomputed timelines, search indexes and thumbnails are all "store it now so you needn't compute it later". The cost is storage *and* the obligation to keep the copy correct.

> <C color="orange">Every derived copy is a correctness liability.</C> That is the real price of denormalization — not the disk.

### Axis 4 — Simplicity ↔ Flexibility

A single Postgres instance is simple and will not scale to a billion users. A sharded polyglot architecture scales and demands a platform team. Generalising early to "support any future requirement" usually buys a requirement that never arrives at the cost of complexity you pay for daily.

### Axis 5 — Cost ↔ Everything

More availability, lower latency, stronger consistency and more retention all cost money. Multi-region active-active roughly doubles the infrastructure bill. Hot storage for 90 days of logs can exceed the cost of the service producing them.

<H>**Cost is the axis most study material silently omits, and the one most real decisions turn on.**</H>

### Axis 6 — Build ↔ Buy

Managed services cost more per unit and less in engineer-time and on-call load. Self-hosting is cheaper per unit and buys you an operational obligation forever. For a small team the arithmetic is rarely close: a managed database costs less than the fraction of an engineer required to run one properly.

### Axis 7 — Now ↔ Later

Shipping in three weeks with known debt can beat shipping in six months. Legitimate, provided you say out loud that you are borrowing and roughly what repayment will cost. Debt taken deliberately is a strategy; debt taken accidentally is a defect.

---

## 2. "Best practices" are points on an axis

Most advice presented as universal is actually one setting of one dial. Each of these is right *somewhere*:

| Common advice | Actually a trade-off | <C color="crimson">Wrong when</C> |
| :--- | :--- | :--- |
| "Use microservices" | Team autonomy vs operational complexity + network failure | Small team, or a domain that will not decompose cleanly |
| "Normalize your schema" | Write integrity vs read speed | Read-heavy systems where joins dominate the latency budget |
| "Cache everything" | Latency vs staleness + invalidation bugs | Data that must be correct, or cheap to compute anyway |
| "Always use a queue" | Resilience vs end-to-end latency + ordering complexity | The user is waiting for the result |
| "Go multi-region" | Availability + proximity vs 2× cost and consistency pain | Users in one region and a business that survives an hour down |
| "Use NoSQL for scale" | Write scalability vs losing joins and transactions | Data that is genuinely relational, which is most data |
| "Never have a single point of failure" | Availability vs cost and complexity | A SPOF that fails once a year, recovers in a minute, and costs $2M to remove |

> <H>A senior answer is rarely "yes" or "no". It is **"yes, when ___; no, when ___"**.</H>

---

## 3. When *not* to distribute

The most valuable instinct in system design is knowing when the answer is "one machine".

### The case for boring

A single well-provisioned server today can hold **1 TB of RAM and 64+ cores**. A single Postgres instance comfortably serves tens of thousands of QPS and terabytes of data. Stack Overflow served hundreds of millions of monthly page views for years on a handful of servers and a small SQL Server cluster.

Meanwhile, distributing costs you:

- **Network calls that fail** — every in-process call that becomes a network call gains timeouts, retries, partial failure and idempotency requirements.
- **Availability multiplication** — ten 99.9% services in series give 99.0%. ([Why](./03-slis-slos-and-error-budgets.md).)
- **Debugging by archaeology** — one stack trace becomes correlating traces across eight services.
- **Distributed data** — no more joins, no more single-statement transactions. You get sagas, eventual consistency and reconciliation jobs instead.
- **Operational load** — deploys, dashboards, alerts, on-call rotation, per service.

### A rough decision rule

```
  Does it fit on one machine, with room to grow 10×?
        │
        ├── YES → one machine. Add a replica for failover. Stop.
        │
        └── NO → what specifically does not fit?
                 ├── storage volume     → shard, or move blobs to object storage
                 ├── read throughput    → cache + read replicas (usually enough)
                 ├── write throughput   → now you actually need sharding
                 └── team coordination  → split services along team boundaries,
                                          not along technical ones
```

Note the last branch. <C color="orange">**Microservices are frequently an organisational solution, not a performance one**</C> — they let teams deploy without coordinating. If you have one team, you probably do not have that problem, and Amazon's Prime Video team [found the reverse](/systemDesign/case-studies): collapsing a distributed pipeline into a monolith cut cost by 90% because the workload never needed independent scaling in the first place.

### Scale in the right order

The cheapest fix is usually the one you have not tried yet:

```
  1. Make the code faster        (a missing index beats a cache; profile first)
  2. Vertical scaling            (buying a bigger box is cheap next to an engineer-quarter)
  3. Caching                     (biggest win per unit complexity for read-heavy work)
  4. Read replicas               (read scaling with no application redesign)
  5. Async / queues              (take slow work off the critical path)
  6. Sharding                    (last, because it is nearly irreversible)
  7. Multi-region                (only when latency or law requires it)
```

<C color="crimson">Teams that jump to step 6 first spend a year building what step 3 would have solved in a week.</C>

Walk the ladder with a concrete system and watch how far the cheap rungs get you:

<Trace title="Your app just got 10× more traffic" subtitle="A read-heavy app on one server and one database. 500 QPS → 5,000 QPS.">

<TraceStep
  title="Where you start"
  state={{ 'Handles': '500 QPS', 'Servers': '1 app + 1 DB', 'Monthly cost': '$400', 'Complexity': 'trivial', 'Engineer-weeks': '0' }}
  note="Note the complexity row. It is the column people forget to price.">

One app server, one database. It works fine today and the whole thing fits in one person's head.

</TraceStep>

<TraceStep
  title="Rung 1 — profile and fix the code"
  cost="1 week"
  state={{ 'Handles': '1,500 QPS', 'Servers': '1 app + 1 DB', 'Monthly cost': '$400', 'Complexity': 'trivial', 'Engineer-weeks': '1' }}
  changed={['Handles', 'Engineer-weeks']}
  note="A missing index routinely beats a cache. Always look here first — it is the only rung that adds no complexity at all.">

Profiling finds one query doing a full table scan. Adding an index takes it from 200 ms to 3 ms and **triples capacity for free**.

</TraceStep>

<TraceStep
  title="Rung 2 — buy a bigger machine"
  cost="$800/mo"
  state={{ 'Handles': '3,000 QPS', 'Servers': '1 app + 1 DB (larger)', 'Monthly cost': '$1,200', 'Complexity': 'trivial', 'Engineer-weeks': '1' }}
  changed={['Handles', 'Servers', 'Monthly cost']}
  note="Deeply unfashionable and frequently correct. An engineer-quarter costs far more than a bigger instance.">

Double the CPU and RAM. Capacity doubles, complexity does not move, and it took an afternoon.

</TraceStep>

<TraceStep
  title="Rung 3 — add a cache"
  cost="2 weeks"
  state={{ 'Handles': '8,000 QPS', 'Servers': '+ Redis', 'Monthly cost': '$1,400', 'Complexity': 'low', 'Engineer-weeks': '3' }}
  changed={['Handles', 'Servers', 'Monthly cost', 'Complexity', 'Engineer-weeks']}
  note="Target already exceeded, at rung 3 of 7. This is where most systems should stop.">

A read-heavy workload caches well. Most reads never reach the database.

You are now **past the 5,000 QPS target** — and you bought it with an index, a bigger box and a cache. Total: three engineer-weeks.

</TraceStep>

<TraceStep
  title="Rung 6 — what sharding would have cost"
  cost="6 months"
  state={{ 'Handles': '50,000 QPS', 'Servers': '+ 8 DB shards, routing layer', 'Monthly cost': '$6,000', 'Complexity': 'high — permanent', 'Engineer-weeks': '26+' }}
  changed={['Handles', 'Servers', 'Monthly cost', 'Complexity', 'Engineer-weeks']}
  note="You get 10× more headroom than you needed, and you pay the complexity every day thereafter — not once.">

Had you started here: no cross-shard joins, no single-statement transactions across shards, a resharding project whenever the key choice proves wrong, and every future engineer paying the tax.

<C color="crimson">And it is close to irreversible.</C> Unsharding a live 40 TB database is not a project anyone volunteers for.

</TraceStep>

<TraceStep
  title="The actual lesson"
  state={{ 'Handles': '8,000 QPS', 'Servers': '1 app + 1 DB + Redis', 'Monthly cost': '$1,400', 'Complexity': 'low', 'Engineer-weeks': '3' }}
  changed={['Handles', 'Servers', 'Monthly cost', 'Complexity', 'Engineer-weeks']}
  note="Climb one rung at a time and stop the moment the problem is solved.">

<H>Three engineer-weeks and $1,000/month solved it. Six months and permanent architectural complexity would also have solved it — and that is the choice teams make when they skip to the bottom of the ladder.</H>

</TraceStep>

</Trace>

---

## 4. Cost as a design constraint

Make cost visible in the design, not in a surprise invoice.

**Rough relative costs (cloud, per unit, order of magnitude):**

| Resource | Relative cost | Note |
| :--- | :--- | :--- |
| Object storage (S3-class) | 1× | The cheap place to keep bytes |
| Block storage (EBS-class) | 5–10× | Only for what a database needs live |
| Managed database storage | 10–20× | You pay for the engine, not just the bytes |
| RAM (cache) | 50–100× | Per GB, dramatically more than disk |
| **Cross-region data transfer** | — | Egregious, and the most common surprise |
| **Internet egress** | — | Frequently the largest single line item |

**Patterns that follow directly:**

- **Tier storage by age.** Hot in the DB, warm in object storage, cold in archive. Log retention is where this pays most.
- **Cache selectively.** RAM is ~100× disk. Caching everything is not a strategy, it is a bill.
- **Keep traffic inside a region and inside a zone.** Cross-AZ and cross-region transfer charges quietly dominate real bills.
- **Serve bytes from a CDN.** Cheaper per GB than origin egress *and* faster. One of the rare choices with no downside except cache invalidation.
- **Autoscale for peaks.** Provisioning for a 10× spike around the clock means paying 10× around the clock.

> <H>If you cannot say roughly what your design costs per month, you have not finished designing it.</H>

---

## 5. Writing the decision down

Six months later nobody remembers why. The cheapest fix is an **ADR** — an Architecture Decision Record — a short file in the repo, one per significant decision.

```markdown
# ADR 014: Precompute timelines instead of assembling on read

## Status
Accepted — 2026-03-11

## Context
Read:write is ~200:1. Assembling a timeline on read requires ~200 lookups
per request, which alone consumes the entire 200 ms p99 budget.

## Decision
Fan out on write into a per-user precomputed timeline in Redis, capped at
800 entries. Accounts above 1M followers are excluded and merged at read
time instead.

## Consequences
+ Timeline read becomes a single lookup, ~2 ms.
- A post costs N writes, where N is the follower count.
- Timelines become derived state that must be rebuildable from the source
  of truth; a rebuild job is required.
- The celebrity threshold (1M) is a tunable that will need revisiting.

## Alternatives considered
- Pure fan-out on read: rejected, blows the latency budget.
- Pure fan-out on write: rejected, celebrity accounts cause write storms.
```

The <C color="orange">**Consequences**</C> section is the one that matters. Anyone can record what was chosen; recording what it cost is what lets a future team decide whether the trade-off still holds. Note that this ADR does not claim the decision was correct — it claims it was correct *given these constraints*, which is the only kind of correctness available.

---

## 6. Habits that make trade-off thinking automatic

**Say the cost unprompted.** Train yourself so every "I'd add X" is followed by "which costs us Y". It is the single clearest signal of seniority in a design discussion.

**Argue the other side.** Before committing, spend thirty seconds building the strongest case against your own choice. If you cannot, you do not understand it yet.

**Ask what has to be true.** "This works if the follower distribution is roughly uniform." Then ask whether it is. It is usually not — long tails are the norm in social data, and they are where designs break.

**Find your own bottleneck.** Every system has exactly one component that limits throughput. Name it before someone else does, and say what you would do when you hit it.

**Design for 10×, not 1000×.** Enough headroom to buy time, not so much that you build for users who may never arrive. At 10× you re-examine; the architecture you would need at 1000× is unknowable today anyway.

**Prefer reversible decisions.** Adding a cache is <C color="green">reversible</C>. Sharding a 40 TB database is <C color="crimson">not</C>. Spend your deliberation budget on the one-way doors and move fast on the two-way ones.

<Depth title="One-way doors: how to tell, and how to buy your way back through">

Amazon's internal framing is **Type 1 / Type 2 decisions**. Type 2 decisions are two-way doors — walk through, and if it is wrong, walk back. Type 1 are one-way: reversing costs more than the original decision did. The failure mode in most organisations is applying a Type 1 process (committees, documents, months) to Type 2 decisions, which is how companies get slow.

**What makes a decision hard to reverse** is almost always one of three things:

1. **Data has moved and must move back.** Changing a shard key, migrating databases, changing a serialisation format — all require rewriting data that is being read and written concurrently. Cost scales with data volume, and data volume only grows.
2. **Someone else depends on it.** A public API shape, an event schema on a shared bus, a URL structure. Reversal now requires coordinating parties you do not control, some of whom are customers on old mobile builds.
3. **The organisation reshaped around it.** Split into eight services and you get eight teams with eight on-call rotations. Merging back is now a re-org, not a refactor — which is Conway's Law running in reverse.

**Buying reversibility** is often cheap if you do it up front:

- **Version everything at a boundary.** `/v1/` in the path and a version field in every event costs nothing on day one and is what makes a change survivable later.
- **Dual-write before you cut over.** Write to old and new, read from old, compare, then flip the read. Reversal is flipping it back.
- **Feature-flag the behaviour, not just the UI.** A flag around a new query path means rollback is a config change instead of a deploy.
- **Keep the old data until you are certain.** Storage is the cheapest thing you can buy; deleting the only copy of the old shape is what makes a decision one-way.

<C color="orange">The practical rule: spend deliberation proportional to reversal cost, and spend engineering to convert one-way doors into two-way ones.</C>

</Depth>

---

## Rapid-fire recall

1. Name the seven axes.
2. Why is strong consistency expensive even when nothing has failed?
3. What is the real cost of denormalization — and it is not disk space?
4. Rewrite "use microservices" as a proper trade-off statement.
5. Give the decision rule for whether to distribute at all.
6. List the scaling steps in the order you should try them.
7. Why are microservices often an organisational solution rather than a performance one?
8. Roughly how does the cost of RAM compare to object storage per GB, and what pattern follows?
9. Which section of an ADR carries the most long-term value, and why?
10. Why design for 10× rather than 1000×?

<details>
<summary>Answers</summary>

1. Consistency↔availability · latency↔throughput · space↔time · simplicity↔flexibility · cost↔everything · build↔buy · now↔later.
2. Because it requires **coordination**, and coordination requires round trips on the write path. You pay latency on every write, not only during a partition.
3. Every derived copy is a **correctness liability** — it must be kept in sync, rebuilt when it drifts, and reasoned about on every write path. Storage is the cheap part.
4. "Microservices buy team autonomy and independent deploys at the cost of operational complexity and network calls that can fail — worth it when multiple teams block on each other's deploys, wrong when one small team owns everything."
5. Does it fit on one machine with 10× headroom? If yes, one machine plus a failover replica. If no, identify *what* does not fit — storage, read throughput, write throughput, or team coordination — and apply the fix for that specific limit.
6. Optimise the code → vertical scaling → caching → read replicas → async/queues → sharding → multi-region.
7. Because their primary benefit is letting teams deploy and own their code without coordinating. One team does not have that problem, and pays the operational cost for a benefit it cannot use.
8. RAM is roughly **50–100× more expensive per GB**. So cache selectively, tier storage by access age, and treat "cache everything" as a bill rather than a strategy.
9. **Consequences.** Anyone can record the choice; recording what it cost is what lets a future team judge whether the trade-off still holds under changed constraints.
10. 10× buys enough headroom to keep working while remaining buildable and affordable today. The architecture required at 1000× depends on constraints you cannot know yet, and building for it means paying for complexity daily against users who may never arrive.

</details>

---

**Next:** [DNS](../02-networking/01-dns.md) — the four server roles, and why the first thing every request does is the thing most outages are traced back to.

Or jump ahead: **[The Interview Framework](../16-interview-prep/01-the-framework.md)** · **[How To Read A Case Study](../15-case-studies/01-how-to-read-a-case-study.md)**
