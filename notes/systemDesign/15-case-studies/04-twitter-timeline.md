---
title: Twitter's Timeline
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Twitter's Timeline

> **The claim:** Twitter moved timeline construction from read-time assembly to write-time fan-out, then adopted a hybrid because celebrity accounts made pure fan-out untenable.
>
> *Source: Twitter engineering talks and posts, principally 2012–2014. Details below are the widely-documented shape rather than current internals.*

The canonical fan-out case study, and the clearest example of <C color="orange">a design that is correct until one part of the distribution breaks it.</C>

<Plain>

A newsagent assembles personalised newspapers.

**Assemble on request.** A customer arrives, and you gather every article from each of the 300 writers they follow, sort by time, and hand over the top 20. Nothing is prepared in advance; storage is minimal.

<C color="crimson">And the customer waits while you do it</C>, every single visit — and most visits produce nearly the same paper as the last.

**Prepare in advance.** When a writer files an article, you immediately add it to the pile of every reader who follows them. A customer arriving takes their pile off the shelf. <C color="green">Instant.</C>

Storage grows — one copy per reader per article — and storage is cheap while customers waiting is expensive. A clear improvement.

Then a famous columnist joins, with **three million** readers.

They file an article, and you must add it to three million piles. <C color="crimson">One act of writing becomes three million acts of filing</C>, and while you are doing it, the shop stops.

The fix is neither of the two designs. It is noticing that **the famous columnist is a different case**. Ordinary writers are handled in advance as before. For the handful of famous ones, you keep a single copy and add it when the reader arrives — one extra lookup on a shelf they were already visiting.

<H>The right answer was not one strategy. It was recognising that a single strategy could not serve both ends of a very skewed distribution.</H>

</Plain>

---

## 1. The two designs

| | Fan-out on read (pull) | Fan-out on write (push) |
| :--- | :--- | :--- |
| On post | <C color="green">1 write</C> | <C color="crimson">1 write per follower</C> |
| On read | <C color="crimson">N lookups + merge + sort</C> | <C color="green">1 lookup</C> |
| Storage | <C color="green">1 copy</C> | <C color="crimson">1 copy per follower</C> |
| Breaks on | <C color="crimson">Everyone, as traffic grows</C> | <C color="crimson">Celebrities</C> |

<Jargon
  plain="Doing the work when content is created versus when it is requested."
  term="fan-out on write vs fan-out on read"
  also={['push vs pull', 'precompute vs compute-on-demand']}>

The read:write ratio decides it. Twitter's is <C color="orange">heavily read-dominated</C> — far more timeline views than posts — which points strongly at precomputing.

</Jargon>

<Trace title="Why pure push fails on one account" subtitle="The same system, an ordinary user and a celebrity.">

<TraceStep
  title="Ordinary user posts"
  state={{ 'Followers': '300', 'Writes triggered': '300', 'Time to complete': '~50 ms', 'System impact': 'negligible' }}
  changed={['Followers', 'Writes triggered', 'Time to complete']}
  note="Three hundred small writes into per-user timeline caches. Entirely routine.">

The post is written once, then inserted into 300 follower timelines. <C color="green">Reads for all 300 are now a single lookup.</C>

</TraceStep>

<TraceStep
  title="Reads are excellent"
  state={{ 'Timeline read': '1 lookup', 'Latency': '~1–5 ms', 'Read:write ratio': 'heavily read-dominated', 'Verdict': 'push is right' }}
  changed={['Timeline read', 'Latency', 'Verdict']}
  note="For the overwhelming majority of accounts, this is straightforwardly the correct design.">

Precomputation pays off exactly as intended.

</TraceStep>

<TraceStep
  title="A celebrity posts"
  cost="write amplification"
  state={{ 'Followers': '30M', 'Writes triggered': '30M', 'Time to complete': 'minutes', 'System impact': 'severe' }}
  changed={['Followers', 'Writes triggered', 'Time to complete', 'System impact']}
  note="One user action generating tens of millions of writes — the fan-out queue backs up for everyone.">

<C color="crimson">One post becomes 30 million writes.</C> The fan-out pipeline saturates, and **other users' posts are delayed behind it**.

</TraceStep>

<TraceStep
  title="Several celebrities post during an event"
  cost="cascading delay"
  state={{ 'Concurrent fan-outs': 'multiple × tens of millions', 'Queue depth': 'growing', 'Ordinary users': 'delayed', 'System impact': 'critical' }}
  changed={['Concurrent fan-outs', 'Queue depth', 'Ordinary users']}
  note="Exactly what happens during a major live event — several high-follower accounts posting at once.">

<C color="crimson">The tail of the follower distribution consumes the capacity the head needs.</C>

</TraceStep>

<TraceStep
  title="The hybrid — exclude celebrities from fan-out"
  state={{ 'Celebrity posts': 'stored once, not fanned out', 'Ordinary posts': 'fanned out as before', 'Reader work': '1 lookup + merge a few', 'System impact': 'stable' }}
  changed={['Celebrity posts', 'Reader work', 'System impact']}
  note="Accounts above a follower threshold are handled by the pull path; everyone else keeps the push path.">

<C color="green">Above a threshold, posts are not fanned out at all.</C> A reader's timeline is their precomputed list, **merged at read time** with recent posts from the few celebrities they follow.

</TraceStep>

<TraceStep
  title="Why the merge stays cheap"
  state={{ 'Celebrities followed (typical)': 'a handful', 'Extra lookups per read': 'few', 'Read latency': 'still low', 'Verdict': 'both ends served' }}
  changed={['Celebrities followed (typical)', 'Extra lookups per read', 'Verdict']}
  note="The asymmetry that makes the hybrid work: celebrities have many followers, but users follow few celebrities.">

<H>A user may follow 300 accounts and only three of them are celebrities. The pull path is applied to a handful of accounts, so the read stays fast — the distribution is skewed in exactly the direction that makes this work.</H>

</TraceStep>

</Trace>

---

## 2. What generalises

<Depth title="Skewed distributions, and designing for both ends">

**The transferable finding is not "use a hybrid timeline".** It is:

<H>When a distribution has an extreme tail, a single strategy will be wrong at one end. Detect which end an item falls in and route it to the appropriate strategy.</H>

The pattern recurs constantly, under different names:

| Domain | Head | Tail | Hybrid |
| :--- | :--- | :--- | :--- |
| Social feeds | Ordinary accounts | Celebrities | Push + pull merge |
| [Caching](../07-caching/04-cache-failure-modes.md) | Normal keys | Hot keys | Local L1 for hot keys only |
| [Sharding](../05-data-at-scale/02-partitioning-and-sharding.md) | Normal tenants | Huge tenants | Dedicated shards for the largest |
| Rate limiting | Normal users | Heavy API consumers | Separate tiers and quotas |
| Search | Common queries | Rare queries | Cache the head, compute the tail |

<C color="green">In every case the fix is the same shape</C>: identify the small number of outliers, handle them differently, and keep the simple path for everything else.

**Choosing the threshold.** Twitter's celebrity cutoff is a tunable, and the trade is direct:

- **Too low** — too many accounts on the pull path, so reads do more merging and read latency rises.
- **Too high** — celebrity fan-outs still saturate the write pipeline.

<C color="orange">It should be derived from the distribution, not chosen aesthetically</C>: set it where the write cost of fanning out exceeds the aggregate read cost of merging, and revisit it as the follower distribution shifts.

**Other constraints that shaped the real system, worth knowing:**

**Timelines are capped.** A precomputed timeline holds a bounded number of recent entries — a few hundred — not a user's full history. Deeper scrolling falls back to a different path. <C color="green">This bounds storage to `users × cap` rather than `users × posts`.</C>

**Timelines are rebuildable.** They are a **cache**, not the source of truth. Posts live durably elsewhere; a lost timeline is regenerated. This is what makes it acceptable to hold them in memory.

**Timelines hold references, not content.** Storing post ids and hydrating the text at read time means one copy of the post body regardless of follower count — <C color="green">turning 30 million copies of a post into 30 million 8-byte ids.</C>

**A new follow needs backfill.** Following someone must surface their recent posts, which means either backfilling the timeline or merging at read time — a small version of the same push/pull decision.

**Ordering is not purely chronological any more.** Modern feeds rank by predicted engagement, which changes the problem substantially: the "top 20" cannot be precomputed by insertion order alone. <C color="orange">Ranked feeds typically precompute a candidate set and rank at read time</C> — a third hybrid, trading more read work for relevance.

**The interview-relevant summary.** When asked to design a feed, the sequence that reads as informed: establish the read:write ratio → choose push as the default → identify the celebrity problem yourself → propose the hybrid with a threshold → note the timeline is a capped, rebuildable cache of ids. <C color="crimson">Proposing pure pull or pure push and not noticing the tail is the common failure</C>, and the interviewer's follow-up question is always about the celebrity.

</Depth>

---

## Rapid-fire recall

1. Compare push and pull on write cost, read cost and storage.
2. What does the read:write ratio suggest, and why is that not the whole answer?
3. What exactly breaks when a celebrity posts, and who else is affected?
4. Describe the hybrid, and which accounts take which path.
5. Which asymmetry makes the read-time merge cheap?
6. State the generalisable finding about skewed distributions.
7. Give three other systems where the same head/tail split appears.
8. How should the celebrity threshold be chosen?
9. Why are timelines capped, and why does storing ids rather than content matter?
10. How do ranked feeds change the problem?

<details>
<summary>Answers</summary>

1. **Push**: expensive write (one per follower), cheap read (one lookup), storage one copy per follower. **Pull**: cheap write (one row), expensive read (N lookups plus merge and sort), storage one copy.
2. Heavily read-dominated traffic points at **push** (precompute). It is not the whole answer because the **follower distribution has an extreme tail**, and push's cost scales with follower count.
3. One post becomes **tens of millions of writes**, saturating the fan-out pipeline. **Ordinary users' posts are delayed behind it** — the tail consumes the capacity the head needs.
4. Accounts **above a follower threshold are excluded from fan-out**; their posts are stored once. A reader's timeline is their **precomputed list merged at read time** with recent posts from the few celebrities they follow. Everyone else keeps the push path.
5. **Celebrities have many followers, but users follow few celebrities.** So the pull path applies to only a handful of accounts per read, keeping the merge small.
6. <H>When a distribution has an extreme tail, a single strategy will be wrong at one end — so detect which end an item falls in and route it to the appropriate strategy.</H>
7. **Hot keys in caching** (local L1 for the hot ones) · **large tenants in sharding** (dedicated shards) · **heavy consumers in rate limiting** (separate tiers) · **common queries in search** (cache the head).
8. From the **distribution**, not aesthetically — set it where the **write cost of fanning out exceeds the aggregate read cost of merging**, and revisit as the follower distribution shifts.
9. **Capped** so storage is `users × cap` rather than `users × posts`, with deeper scrolling served by another path. **Storing ids** means one copy of the post body regardless of follower count — 30 million copies become 30 million 8-byte references.
10. Ranking by predicted engagement means the top entries **cannot be precomputed by insertion order**. Ranked feeds typically **precompute a candidate set and rank at read time**, trading more read work for relevance.

</details>

---

**Next:** [Discord's Storage Migrations](./05-discord-storage.md) — two database migrations, a decade apart.
