---
title: Requirements & Constraints
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Requirements & Constraints

> **What you will be able to do after this page**
>
> - Split any vague ask into functional and non-functional requirements.
> - Ask the six questions that actually change an architecture — and skip the ones that don't.
> - Recognise the four constraints that decide more designs than any technology choice.
> - Write a requirements block in three minutes that the rest of a design can hang off.

"Design Twitter" is not a problem statement. It is an invitation to ask questions. This page is about which questions.

<Plain>

Suppose you ask a builder for "a house". They cannot start. They need to know: how many people live there? What is the budget? What is the plot like — flat, sloped, near a river? Do you need it in six months or three years?

None of those questions is about *building*. They are about **what would make this house the right house**. Get them wrong and you build something beautiful that has one bedroom for a family of six.

Software works the same way, with one twist: the questions that change the design most are almost never the ones people volunteer. Nobody says *"by the way, it must handle a hundred times normal traffic for ninety seconds when a match ends."* You have to ask.

This page is the list of questions worth asking, and the reason each one changes what you build.

</Plain>

---

## 1. Two kinds of requirement

### Functional — *what the system does*

Verbs. Features. Things a user can do.

> A user can post a message. A user can follow another user. A user sees a timeline of posts from people they follow.

Functional requirements define the **surface**: the API, the data model, the screens. They are usually easy to enumerate and rarely the interesting part.

### Non-functional — *how well it must do it*

Adverbs. Qualities. Numbers.

> The timeline loads in under 200 ms at p99. The system serves 10M daily active users. A posted message appears to followers within 5 seconds. No posted message is ever lost.

<C color="orange">**Non-functional requirements are what determine the architecture.**</C> "A user can post a message" is satisfied by a PHP script and MySQL on one box. Add "500M messages a day, p99 under 200 ms, never lose one" and you have specified a distributed system whether you wanted one or not.

> <H>**Functional requirements decide what you build. Non-functional requirements decide how you build it.**</H>

This is why jumping to a diagram before pinning the numbers is fatal: you are choosing an architecture before knowing which one the problem needs.

<Jargon
  plain="What the system does versus how well it has to do it."
  term="functional vs non-functional requirements"
  also={['features vs qualities', 'behaviour vs constraints']}>

You may also hear non-functional requirements called **"the -ilities"** — scalability, availability, reliability, maintainability. In an interview, saying *"let me separate the functional from the non-functional requirements"* is a strong opening move, because it signals you know the second set is what drives the architecture.

</Jargon>

---

## 2. The six questions that change the design

Interview time is short and real design meetings are shorter. Most clarifying questions are noise. These six are not — each has answers that lead to *materially different* architectures.

Watch how a vague request narrows into a design as each answer arrives. Nothing is drawn yet — and yet by the end, most of the architecture is already decided.

<Trace title="Turning &quot;build us a photo app&quot; into a design" subtitle="Six questions. Watch the right-hand column fill in.">

<TraceStep
  title="The request arrives"
  state={{ 'Scale': 'unknown', 'Data layer': 'unknown', 'Freshness': 'unknown', 'Storage': 'unknown', 'Decided so far': 'nothing' }}
  note="At this point every architecture is still possible, which means none is justified.">

*"We want to build a photo-sharing app."* That is all you have been given. It is not enough to draw a single box.

</TraceStep>

<TraceStep
  title="Q1 — How many daily active users?"
  state={{ 'Scale': '50M DAU', 'Data layer': 'unknown', 'Freshness': 'unknown', 'Storage': 'unknown', 'Decided so far': 'not one machine' }}
  changed={['Scale', 'Decided so far']}
  note="At 500 users the honest answer is one server and a managed database. At 50M it is not.">

**50 million.** This single number eliminates the simple answer and tells you the rest of the questions are worth asking.

</TraceStep>

<TraceStep
  title="Q2 — What is the read:write ratio?"
  state={{ 'Scale': '50M DAU', 'Data layer': 'read-heavy 200:1', 'Freshness': 'unknown', 'Storage': 'unknown', 'Decided so far': 'cache + replicas + precompute' }}
  changed={['Data layer', 'Decided so far']}
  note="Read-heavy is solved by duplication. Write-heavy is solved by partitioning. Two different toolkits.">

Users open the app ~10× a day and post ~once. **Roughly 200 reads per write.**

The data layer is now largely decided: cache aggressively, add read replicas, precompute the feed.

</TraceStep>

<TraceStep
  title="Q3 — How stale may the feed be?"
  state={{ 'Scale': '50M DAU', 'Data layer': 'read-heavy 200:1', 'Freshness': '30 s allowed', 'Storage': 'unknown', 'Decided so far': '+ async fan-out' }}
  changed={['Freshness', 'Decided so far']}
  note="Every second of allowed staleness is permission to move work off the critical path.">

**Thirty seconds is fine.** Nobody notices a photo appearing half a minute late.

That single sentence buys you an asynchronous fan-out pipeline. Had the answer been *"instantly"*, you would owe the user a synchronous write path and a much harder design.

</TraceStep>

<TraceStep
  title="Q4 — What must never be lost?"
  state={{ 'Scale': '50M DAU', 'Data layer': 'read-heavy 200:1', 'Freshness': '30 s allowed', 'Storage': 'photos durable, feeds rebuildable', 'Decided so far': '+ object storage, cheap caches' }}
  changed={['Storage', 'Decided so far']}
  note="Anything you can regenerate does not need durability guarantees — and paying for them anyway is a common, expensive habit.">

**Photos, absolutely.** Feeds and thumbnails can be rebuilt from the photos.

Now you know photos need durable replicated storage, while feeds can live in a cache you are allowed to lose.

</TraceStep>

<TraceStep
  title="Q5 and Q6 — Spikiness and geography"
  cost="design ~70% settled"
  state={{ 'Scale': '50M DAU, 3× peak', 'Data layer': 'read-heavy 200:1', 'Freshness': '30 s allowed', 'Storage': 'photos durable, feeds rebuildable', 'Decided so far': 'single region + global CDN' }}
  changed={['Scale', 'Decided so far']}
  note="Six questions, no boxes drawn, and most of the architecture is already determined.">

**Peaks around 3× average; users mostly in one region.** So: provision for 3×, single region to start, global CDN for image delivery.

You still have not drawn anything — and the design is largely fixed. That is what a good requirements pass buys you.

</TraceStep>

</Trace>

### Q1. How many users, and how active?

Ask for <C color="green">**DAU**</C>, not <C color="crimson">total registered</C>. Registered users include everyone who signed up in 2019 and left.

```
 100 DAU      →  one server, one database. Genuinely. Stop designing.
 100K DAU     →  a few app servers, a managed DB with a read replica, a cache.
 10M DAU      →  sharding, CDN, async pipelines, multi-AZ. Real work.
 500M DAU     →  multi-region, custom infrastructure, a platform team.
```

Getting this wrong by two orders of magnitude invalidates everything downstream. It is the first question, every time.

<Depth title="Why DAU is a poor proxy for load, and what to ask instead">

DAU is the best *single* question, but it hides three things that can move your estimate by an order of magnitude:

**Sessions per user per day.** A messaging app might see 30 opens per user; a tax-filing tool sees 1 per year. The same DAU produces wildly different QPS.

**Concurrency, not just volume.** 50M DAU spread evenly is ~600 concurrent users per second of activity. 50M DAU who all watch the same live event is 50M concurrent. Concurrency drives connection counts, memory, and whether you need a [WebSocket gateway tier](../02-networking/06-realtime-communication.md); daily volume does not.

**The action mix.** 50M users who each read one page is a trivially cacheable workload. 50M users who each upload a video is a completely different system with the same DAU.

The pragmatic follow-up questions are therefore: *"how many sessions per user per day, how long is a session, and what is the single most expensive action a user can take?"* The last one matters most — <C color="orange">systems are usually sized by their most expensive operation, not their most common one</C>.

</Depth>

### Q2. What is the read:write ratio?

This single number reshapes the data layer more than any other.

| Ratio | Typical of | What it implies |
| :--- | :--- | :--- |
| **1000 : 1** | Twitter, news, blogs | Read replicas, aggressive caching, denormalize freely, precompute |
| **10 : 1** | Most CRUD apps | A cache and one replica cover it |
| **1 : 1** | Chat, collaborative editing | Cache buys little; write path is the design problem |
| **1 : 10** | Metrics, logs, IoT ingest | Write-optimised storage (LSM), batching, partition by time |

Read-heavy systems are solved by <C color="orange">**duplication**</C> — copies, caches, replicas, precomputed views. Write-heavy systems are solved by <C color="orange">**partitioning**</C> — spreading writes so no single node is the bottleneck. Two different sets of tools. Ask the ratio first.

### Q3. How stale may data be?

Rarely asked, and it decides more than CAP debates do.

```
  Bank balance                → zero staleness. Strong consistency, no exceptions.
  Chat message                → sub-second, or it feels broken.
  Twitter timeline            → seconds. Nobody notices.
  Follower count              → minutes. Nobody notices this either.
  Analytics dashboard         → hours. Batch it.
```

Every second of staleness you are *allowed* is permission to add a cache, a replica, or an async pipeline. Teams that never ask this end up paying for strong consistency on a follower count.

### Q4. What must never be lost?

Sort the data into three buckets. They get three different storage strategies, and treating them alike is how you either lose money or waste it.

| Bucket | Example | Strategy |
| :--- | :--- | :--- |
| <C color="crimson">**Must never be lost**</C> | Payments, orders, user accounts | Durable DB, synchronous replication, backups, audit trail |
| **Should not be lost** | Posts, messages, uploads | Replicated DB, async backups |
| <C color="green">**Can be regenerated**</C> | Cache entries, thumbnails, search index, recommendations | Rebuild from source; store cheaply, lose freely |

The third bucket is where the savings live. Anything reconstructible does not need durability guarantees, and paying for them anyway is a common and expensive habit.

### Q5. How spiky is the traffic?

<H>Average load is a planning fiction. Systems fail at the peak.</H>

```
 steady        ────────────────────     internal tools        peak ≈ 1.5× avg
 daily cycle   ──╱▔▔▔╲──╱▔▔▔╲──        consumer apps          peak ≈ 3×  avg
 event-driven  ──────╱█╲──────────      ticket sales, sports   peak ≈ 100× avg
```

The last shape is a different engineering problem, not a bigger version of the first. A Ticketmaster on-sale or a World Cup goal means queues, admission control, precomputed everything, and a plan for shedding load gracefully. Design for the peak or explicitly decide to degrade during it — but decide.

### Q6. Where are the users?

One region or global? Global means the [speed of light](./04-latency-numbers.md) enters your latency budget: a round trip London → Sydney has a floor near 250 ms that no amount of engineering removes. Global also means data residency law — GDPR may require EU user data to physically stay in the EU, which is an *architectural* constraint disguised as a legal one.

### Questions that usually don't earn their time

Not because they never matter — because they rarely change the architecture, and you can state an assumption instead:

- "What programming language?" — almost never load-bearing at this altitude.
- "Which cloud provider?" — assume one, move on.
- "Do we support dark mode?" — not a system design concern.
- Deep feature detail on something you have already scoped out.

---

## 3. The four constraints that decide most designs

Requirements say what the system must do. **Constraints say what you are not allowed to do**, and they win the argument more often than any technical merit.

### Money

Cloud costs are a design input. Multi-region active-active roughly doubles infrastructure spend. Keeping 90 days of logs hot instead of archived can cost more than the service that produces them. Amazon's Prime Video team rebuilt a distributed pipeline as a monolith and cut cost 90% — the distributed version worked fine, it was simply unaffordable at their volume.

### Team

A six-person team cannot operate forty microservices. This is not a skill issue; it is arithmetic about on-call rotations and cognitive load. Architecture that outruns the team that must run it fails in production regardless of its whiteboard quality.

> **Conway's Law:** systems come to mirror the communication structure of the organisation that builds them. Design against that and the organisation usually wins.

### Existing systems

Greenfield is rare. Real constraints sound like: "the legacy Oracle instance cannot be replaced this year", "billing owns that table and will not change its schema", "the mobile client on 30% of devices cannot be updated". A design that ignores these is not a design; it is a wish.

### Time

"Correct in six months" loses to "adequate in three weeks" when a competitor ships next month. Deliberately taking on technical debt is a legitimate design decision — as long as you say out loud that you are doing it and what it will cost to undo.

---

## 4. Doing it in three minutes

A worked pass at "design a photo-sharing app". Aim for something like this before drawing a single box.

**Scope — in:**
- Upload a photo with a caption
- View a feed of photos from people you follow
- Follow / unfollow a user

**Scope — out** (state it, do not silently skip it): stories, DMs, comments, search, ads, moderation.

**Scale:**
- 50M DAU, each opening the app ~10×/day → ~500M feed reads/day → **~6K QPS average, ~18K peak**
- 5% of users post once a day → 2.5M uploads/day → **~30 writes/sec, ~100 peak**
- **Read:write ≈ 200:1** → read-heavy, so: cache hard, precompute feeds, replicate
- Average photo 2 MB → ~5 TB of new photos per day → object storage, not a database

**Quality bars:**
- Feed loads p99 < 300 ms
- A new photo appears in followers' feeds within 30 s (staleness is *allowed* — that permits async fan-out)
- Photos are never lost (bucket 1); feeds and thumbnails are regenerable (bucket 3)

**Constraints:**
- Single region to start; global CDN for image delivery
- Small team, so prefer managed services over anything self-operated

Everything after this is downstream of that block. The 200:1 ratio already tells you the feed is precomputed. The 30-second staleness allowance already tells you fan-out is asynchronous. The 5 TB/day already tells you photos live in object storage with only metadata in the database.

> <H>**A good requirements block makes half the architecture obvious. That is the point of writing one.**</H>

---

## 5. Failure modes

| <C color="crimson">Mistake</C> | Why it hurts | <C color="green">Instead</C> |
| :--- | :--- | :--- |
| Drawing boxes first | You commit to an architecture before knowing which the problem needs | Numbers first, always |
| Asking twenty clarifying questions | Burns the clock, reads as indecision | Six good ones, then state assumptions |
| Accepting "it should be fast" | Unfalsifiable; you cannot design against it | "p99 under 200 ms" — pin a number, even if you pick it yourself |
| Designing for 500M users when asked for 50K | Over-engineering is a real error, not extra credit | Design for the stated scale; mention what would change at 10× |
| Ignoring what data may be lost | Either you lose money or you pay to protect thumbnails | Sort into the three buckets |
| Treating the average as the peak | Systems fail at the peak | Ask the spike shape |

---

## Rapid-fire recall

1. Which kind of requirement determines the architecture, and why?
2. Why ask for DAU rather than registered users?
3. Read-heavy systems are solved by ____; write-heavy systems are solved by ____.
4. Why is "how stale may this be?" such a high-leverage question?
5. Name the three durability buckets and how each is stored.
6. Why is average traffic a planning fiction?
7. Give two ways user geography changes a design — one physical, one legal.
8. State Conway's Law and give one design consequence.
9. In the photo-sharing example, which single number tells you the feed must be precomputed?
10. Which number tells you fan-out can be asynchronous?

<details>
<summary>Answers</summary>

1. **Non-functional.** "A user can post" is satisfied by one script and one database; adding "500M/day, p99 under 200 ms, never lose one" specifies a distributed system regardless of the feature set.
2. Registered users include everyone who ever signed up and left. DAU is the number that generates load.
3. **Duplication** (caches, replicas, precomputed views) · **partitioning** (sharding so no single node absorbs all writes).
4. Every second of allowed staleness is permission to add a cache, a replica, or an async pipeline. It converts directly into cheaper, simpler architecture.
5. **Must never be lost** — durable DB, sync replication, backups. **Should not be lost** — replicated DB, async backups. **Regenerable** — store cheaply, rebuild from source, no durability guarantees.
6. Systems fail at the peak, not the average. An event-driven profile can peak at 100× average, which is a different engineering problem rather than a bigger one.
7. **Physical:** the speed of light puts a hard floor (~250 ms round trip London↔Sydney) under cross-region latency. **Legal:** data residency rules like GDPR can require bytes to stay in a jurisdiction, forcing regional data stores.
8. Systems mirror the communication structure of the organisation that builds them. Consequence: a six-person team should not design forty services — the architecture must fit the org chart and the on-call rotation.
9. The **200:1 read:write ratio**. Reads that heavily outnumber writes should be served from something precomputed rather than assembled per request.
10. The **30-second staleness allowance** on new photos appearing in feeds.

</details>

---

**Next:** [SLIs, SLOs & Error Budgets](./03-slis-slos-and-error-budgets.md) — turning "it should be reliable" into a number you can spend.
