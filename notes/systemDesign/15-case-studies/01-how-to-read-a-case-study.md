---
title: How To Read A Case Study
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# How To Read A Case Study

> **What you will be able to do after this page**
>
> - Extract the transferable lesson from an engineering blog post instead of the cargo cult.
> - Apply six questions to any war story that separate the decision from the context.
> - Explain why postmortems teach more than success stories.
> - Avoid the single most common failure: adopting a solution to a problem you do not have.

Engineering blogs are the best system design material available and the most frequently misread. This page is the lens for the rest of [Part C](/systemDesign/case-studies).

<Plain>

A champion cyclist explains that they train at altitude, sleep nine hours, and eat 6,000 calories a day. All true. All the reason they win.

Now copy it. You have a desk job, you cannot move to the mountains, and 6,000 calories will make you ill rather than fast. You have copied the *behaviour* and none of the *situation* that made the behaviour sensible.

Engineering blog posts work exactly the same way, and are misread exactly the same way. A company writes *"how we scaled to 10 million users with Kafka and Cassandra"*. Everything in it is true. Three weeks later a startup with 4,000 users is running both, understands neither, and ships features at half the speed.

The post was not wrong. The reader took the **answer** and skipped the **question it was answering**.

So this page is not a case study. It is the set of questions to hold in your head while reading one, so you come away with something that transfers to *your* situation rather than a shopping list of other people's tools.

</Plain>

---

## 1. The failure mode this page prevents

A large company publishes *"How we scaled to 10 million users with Kafka and Cassandra."* Three weeks later, a startup with 4,000 users is running Kafka and Cassandra, has no one who understands either, and ships features half as fast as before.

The post was accurate. The lesson taken from it was not, because the reader copied the **decision** and skipped the **constraints**.

> <H>**A design is a function of its constraints. Copy the output without the input and you get a solution to somebody else's problem, at your expense.**</H>

The uncomfortable version: most architecture decisions at large companies are *wrong for you*, not because they were bad decisions, but because you are not operating at their scale, org size, cost structure, or regulatory position. Netflix's architecture is correct for Netflix. It is nearly always wrong for a Series A startup.

---

## 2. The six questions

Apply these to any case study, talk, or engineering post.

### Q1. What were their actual constraints?

Scale, team size, money, latency budget, existing systems, legal position. These are the *inputs*. Without them the story is unfalsifiable.

Note that constraints are often stated obliquely: "our on-call rotation was burning out" is a team constraint. "Our AWS bill grew faster than revenue" is a cost constraint. "We could not change the mobile client" is a compatibility constraint. Read for them.

<Jargon
  plain="The conditions that made their answer the right one — team size, budget, scale, deadlines, rules they had to follow."
  term="constraints"
  also={['the context', 'forcing functions', 'requirements and limits']}>

The most valuable sentence you can say about any architecture is <C color="green">*"that's right for their constraints; ours are different"*</C>. It is also the fastest way to stop a cargo-cult decision in a real design review, because it moves the argument from taste to facts.

</Jargon>

### Q2. What was the problem, specifically?

Not <C color="crimson">"we needed to scale"</C> — that says nothing. <C color="orange">**Which resource ran out?**</C>

```
  read throughput?        →  caching and replicas usually fix it
  write throughput?       →  partitioning
  storage volume?         →  sharding or tiering to object storage
  latency?                →  proximity, precomputation, or fewer hops
  cost?                   →  a completely different set of answers
  team coordination?      →  an organisational answer, not a technical one
```

Six different problems, six different solution families. A post that does not say which resource ran out is not teaching you anything you can reuse.

Apply the six questions to the same post and watch how much of it survives:

<Trace title="Reading one blog post properly" subtitle='"How we scaled to 10M users with Kafka and Cassandra."'>

<TraceStep
  title="The naive read"
  state={{ 'What you take away': 'use Kafka + Cassandra', 'Transfers to you': 'unknown', 'Confidence': 'high (wrongly)' }}
  note="This is the reading that gets a 4,000-user startup running two distributed systems it cannot operate.">

*"They scaled to 10M with Kafka and Cassandra. We want to scale. Let's use Kafka and Cassandra."*

</TraceStep>

<TraceStep
  title="Q1 — What were their constraints?"
  state={{ 'What you take away': 'their situation ≠ yours', 'Transfers to you': 'nothing yet', 'Confidence': 'appropriately low' }}
  changed={['What you take away', 'Confidence']}
  note="Constraints are often stated obliquely — 'our on-call was burning out' is a team constraint.">

40 engineers, a dedicated platform team, 10M users, and a compliance rule requiring 7-year retention.

<C color="crimson">You have 4 engineers and no platform team.</C> Already the situations barely resemble each other.

</TraceStep>

<TraceStep
  title="Q2 — Which resource actually ran out?"
  state={{ 'What you take away': 'they were WRITE-bound', 'Transfers to you': 'a diagnostic method', 'Confidence': 'low but useful' }}
  changed={['What you take away', 'Transfers to you']}
  note="Six different resources, six different solution families. 'We needed to scale' says none of it.">

**Write throughput** — 400K writes/sec, past what a single primary could take.

Your problem is slow reads. <C color="orange">Different resource, different family of answers entirely</C> — reads are solved by caching and replicas, not by Cassandra.

</TraceStep>

<TraceStep
  title="Q3 — What did they try first?"
  cost="the most valuable paragraph"
  state={{ 'What you take away': 'read replicas failed for THEM', 'Transfers to you': 'where the cheap fix stops working', 'Confidence': 'growing' }}
  changed={['What you take away', 'Transfers to you']}
  note="The rejected options map the constraint surface. This is the part most readers skim.">

*"We tried read replicas first; they did not help because our workload was write-bound."*

This one sentence is worth more than the architecture diagram: it tells you **the threshold at which the cheap answer stops working**, which is knowledge you can apply to your own system.

</TraceStep>

<TraceStep
  title="Q4 and Q5 — What did it cost, and what if they'd done nothing?"
  state={{ 'What you take away': '8 months + a permanent team', 'Transfers to you': 'the true price tag', 'Confidence': 'high' }}
  changed={['What you take away', 'Transfers to you']}
  note="Posts under-report this — they are partly recruiting material. Look for the buried sentence.">

Buried in paragraph 14: *"the migration took eight months"*, and they now staff a team to run it. Doing nothing was not viable — they were dropping writes.

</TraceStep>

<TraceStep
  title="Q6 — What actually transfers?"
  state={{ 'What you take away': 'a method, not a stack', 'Transfers to you': 'measure which resource is exhausted first', 'Confidence': 'justified' }}
  changed={['What you take away', 'Transfers to you']}
  note="You end up with something you can use, instead of two databases you cannot operate.">

Not Kafka. Not Cassandra. What transfers is: <C color="green">**identify which specific resource is exhausted before choosing a solution, and try the cheap fixes first so you know why they failed.**</C>

<H>You read the whole post and adopted none of its technology — and you learned more from it than the team that adopted both.</H>

</TraceStep>

</Trace>

### Q3. What did they try first, and why did it fail?

<H>The rejected options are the most valuable part of any case study and the part most often skimmed.</H> They tell you the *shape of the constraint surface* — where the cheap answers stop working.

If a team says "we tried read replicas first and they didn't help because our workload was write-bound", you have learned more than the final architecture teaches you.

### Q4. What did the decision cost them?

Every migration has a bill: engineer-months, an incident during cutover, a permanent increase in operational complexity, a capability lost. Posts under-report this — they are partly recruiting material. Look for the buried sentence: *"the migration took eight months"*, *"we now run a dedicated team for this"*, *"we gave up transactions."*

<C color="crimson">If a case study reports only benefits, it is incomplete</C>, and you should assume the costs were real.

### Q5. What would have happened if they did nothing?

Sometimes the honest answer is "not much". Teams migrate for prestige, boredom, résumé value, or because a new architect wanted to. This is normal and human, and you should discount accordingly.

### Q6. What actually transfers to me?

Usually **not** the architecture. What transfers is:

- the *method* they used to find the bottleneck
- the *class* of trade-off they hit
- the failure mode they discovered
- the threshold at which the cheap approach stopped working

> <C color="green">"Fan-out on write breaks when the follower distribution has an extreme tail" transfers to everyone.</C> <C color="crimson">"Use a hybrid timeline service written in Scala" transfers to nobody.</C>

---

<Depth title="How to read a postmortem — the structure, and the sentences that matter">

Public postmortems follow a near-universal shape, and knowing it lets you extract the value in five minutes.

**Timeline.** What happened, minute by minute. The number to find is **time-to-detection** versus **time-to-mitigation**. A four-hour outage where detection took three hours is a *monitoring* failure; one where detection took two minutes and mitigation took four hours is an *architecture* failure. Completely different lessons, and the headline duration hides which one it was.

**Root cause.** Read this sceptically. A single "root cause" is usually a simplification — most large outages are a **chain**, where each link was individually survivable. The useful question is not *"what broke?"* but *"which safeguard was supposed to catch this, and why didn't it?"*

**Contributing factors.** Often the most valuable section and the least read. This is where you find things like *"the runbook referenced a dashboard that had been decommissioned"* or *"the rollback had not been exercised in 14 months."*

**Action items.** Read these as a description of what the system *lacked*. If an action item is "add a canary deploy", the design had no incremental rollout — that is a transferable finding about a category of risk, independent of the specific bug.

**Sentences worth hunting for**, because each names a generalisable failure mode:

| If you see… | The lesson is |
| :--- | :--- |
| "the change was applied globally within seconds" | No incremental rollout; blast radius was unbounded |
| "the retry logic amplified the load" | Retry storm; missing backoff, jitter, or a circuit breaker |
| "we were unable to access the dashboard during the incident" | Monitoring depended on the thing that was down — circular dependency |
| "failover did not trigger as expected" | The recovery path was never tested under real conditions |
| "the replicas were in the same availability zone" | Correlated failure; the redundancy was nominal, not real |
| "a configuration change" | Config is code, deployed without code's safeguards |

<C color="orange">Notice that almost none of these is about the specific bug.</C> The bug is unique to them; the *shape of the failure* is not, and it is what recurs in your system too.

**The strongest habit:** after reading a postmortem, spend five minutes asking *"could this exact failure mode happen to us?"* — not the bug, the **mode**. Could a config change of ours go global in seconds? Does our dashboard depend on the service it monitors? Are our replicas genuinely independent? That exercise turns someone else's bad day into your roadmap, at zero cost.

</Depth>

## 3. Why postmortems teach more

Success stories describe a system that works, which means their constraints are invisible — you cannot see what the design was protecting against, because it protected successfully.

Postmortems are the opposite. An outage is a **constraint made visible**: a hidden coupling, an assumption that was false, a dependency nobody knew was on the critical path.

The recurring lessons across large public postmortems are remarkably consistent:

| Pattern | What it looks like |
| :--- | :--- |
| **Correlated failure** | "Redundant" replicas shared a rack, a zone, a config push, or a deploy pipeline. The parallel-availability formula assumed independence that did not exist. |
| **Retry storms** | A brief blip causes clients to retry; retries multiply load; the system cannot recover because recovery requires capacity the retries are consuming. |
| **The recovery path was never tested** | Failover worked in theory. The first real invocation found the runbook stale, the credentials expired, or the backup unrestorable. |
| **Metadata as a hidden SPOF** | The data plane was replicated beautifully; the control plane — config, service discovery, DNS, the coordination service — was not. |
| **Capacity cliffs** | The system ran at 85% utilisation and behaved fine, until a 20% shift pushed it past the queueing knee and latency went vertical. |
| **Blast radius of a config change** | A change validated in staging, applied globally in seconds, with no incremental rollout. |

Each of these is worth more than a hundred architecture diagrams, because each names a way your design can be wrong while looking right.

---

## 4. A worked reading

Take the most-cited recent example: **Amazon Prime Video's video-quality monitoring service**, which moved from a serverless, distributed microservice pipeline to a single process — and cut infrastructure cost by about **90%**.

Read through the six questions:

**Constraints.** One internal tool, monitoring thousands of concurrent streams, analysing every frame and audio sample. A small team. Cost measured against internal budget rather than customer revenue.

**The specific problem.** Not throughput and not latency — <C color="orange">**cost**</C>, driven by two things: orchestration state transitions billed per step, and passing large volumes of video frames *between* components through object storage. The data movement between services dominated the bill.

**What they tried first.** The distributed design was the first attempt. It scaled correctly and hit a hard scaling *limit* well below their target while costing far too much.

**What it cost them.** They gave up independent scaling of the pipeline stages and independent deployability. For this workload — where every stage processes the same frames at the same rate — those were benefits they were paying for and not using.

**Doing nothing?** Not viable. The service could not reach the required scale at an acceptable cost.

**What transfers?** Not "monoliths are better". What transfers is the mechanism:

> <H>**When components must exchange large volumes of data at high frequency, the network and the serialisation between them can dominate everything else. Service boundaries should not be drawn across a high-bandwidth data path.**</H>

That principle applies to a two-person startup and to Amazon equally. It is also the exact inverse of the usual reading of this story — which is why the six questions matter.

---

## 5. Reading habits

**Check the date, and the scale at the time.** "How we built X" from 2015 describes tooling that no longer exists and constraints that no longer apply. And a post about 10M users written when the company had 500K is aspirational.

**Notice who is selling.** A post from a database vendor about why you need that class of database is marketing with citations. A post from an infrastructure team that just migrated *off* something is usually more honest, because there is less to sell.

**Look for the second post.** Many companies publish "why we adopted X" and, two years later, "what we learned running X". The second one is the useful one.

**Prefer specific numbers.** <C color="crimson">"Improved performance significantly"</C> is unusable. "p99 dropped from 1.2 s to 180 ms while cost fell 40%" lets you check whether your situation resembles theirs at all.

**Ask what they gave up.** If the post does not say, assume the answer is "transactions", "consistency", or "eight engineer-months" — those are the usual ones.

---

## Rapid-fire recall

1. State the core failure mode this page exists to prevent.
2. What are the six questions?
3. Why is "we needed to scale" an unusable problem statement?
4. Which section of a case study is most valuable and most often skimmed?
5. Why do success stories hide their constraints while postmortems expose them?
6. Name four recurring patterns across large public postmortems.
7. In the Prime Video case, which resource was actually the problem?
8. What is the transferable principle from Prime Video — and what is the common misreading?
9. Why is the follow-up post ("what we learned running X") more useful than the adoption post?
10. A case study reports only benefits. What should you conclude?

<details>
<summary>Answers</summary>

1. Copying a **decision** without its **constraints** — adopting someone else's solution to a problem you do not have, and paying their complexity cost for none of their benefit.
2. What were their constraints? What was the problem specifically? What did they try first and why did it fail? What did the decision cost? What if they'd done nothing? What actually transfers to me?
3. Because it does not say **which resource ran out** — read throughput, write throughput, storage, latency, cost, or team coordination each lead to a different family of solutions.
4. **What they tried first and why it failed.** The rejected options map the constraint surface — they show where the cheap answers stop working, which is the reusable part.
5. A working system's constraints are invisible precisely because the design handles them. An outage makes a constraint visible: a hidden coupling, a false assumption, an untested recovery path.
6. Correlated failure in "independent" replicas · retry storms preventing recovery · untested recovery paths · control-plane/metadata SPOFs · capacity cliffs from queueing · global config changes with no incremental rollout. (Any four.)
7. **Cost** — specifically orchestration state transitions and moving large volumes of video frames between components via object storage. Not throughput and not latency.
8. Transferable: **do not draw a service boundary across a high-bandwidth data path**, because network and serialisation costs will dominate. The common misreading is "microservices are bad / monoliths are better".
9. Because it reports the operational reality and the costs, after the novelty and the recruiting value have worn off.
10. That it is incomplete. Every migration costs engineer-months, an incident, permanent operational complexity, or a lost capability — the absence of a cost section means it was omitted, not that there wasn't one.

</details>

---

**Next:** the pivots and the postmortems — Prime Video and Segment's returns to the monolith, Twitter's fan-out redesign, Discord's storage migrations, and the outages worth studying. *(Coming soon.)*
