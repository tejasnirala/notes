---
title: Failure and Redundancy
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Failure and Redundancy

> **What you will be able to do after this page**
>
> - Enumerate the ways a component fails, including the one people forget.
> - Explain why redundancy often fails to deliver the availability it promises.
> - Contain blast radius deliberately rather than hoping it is small.
> - Recognise correlated failure in a design that looks redundant.

At any real scale, <C color="orange">something is always broken.</C> Reliability is not the absence of failure — it is the property that failures stay small.

<Plain>

A hospital needs power. Losing it is unacceptable, so a second generator is installed.

That is the obvious step, and on its own it delivers much less than it appears to.

**Both generators run off the same fuel tank.** The tank runs dry and both stop together. Two generators, one failure.

**Both are in the same basement.** It floods.

**Nobody has started the second one in three years.** When it is finally needed, it does not start — <C color="crimson">it was redundant on paper and broken in reality, and nothing revealed that until the moment it mattered.</C>

**The switch that transfers load between them fails.** Both generators are healthy and neither is connected to anything.

Notice the pattern. Each is a way that <C color="orange">two things that were supposed to fail independently actually fail together</C> — or a way the *mechanism* for using the backup fails rather than the backup itself.

So the real questions are not "do we have a spare?" They are:

- **What do the two copies share?** Shared anything is where they fail together.
- **Have we ever actually used the spare?** An untested backup is a hypothesis.
- **Does the switchover work?** It is a component too, and often the one that fails.

<H>Redundancy is not a property you install. It is a claim about independence that must be checked, and it is almost always weaker than it looks.</H>

</Plain>

---

## 1. How things fail

Most designs consider two failure modes. There are more, and the ones people miss cause the worst outages.

| Mode | Behaviour | Difficulty |
| :--- | :--- | :--- |
| **Crash** | Stops entirely | <C color="green">Easiest — obvious, detected quickly</C> |
| **Omission** | Drops some requests | Moderate |
| **Timing** | Responds, far too slowly | <C color="crimson">Hard — often worse than crashing</C> |
| **Response** | Responds with wrong data | <C color="crimson">Hardest — looks healthy</C> |
| **Byzantine** | Arbitrary, inconsistent behaviour | Rare outside adversarial settings |
| **Partial** | Some functions work, others do not | <C color="crimson">Health checks miss it entirely</C> |

<H>A crashed node is the easiest failure to handle: everyone agrees it is gone and traffic moves elsewhere. A node that is slow, or that returns wrong answers while passing health checks, is far more damaging — it keeps receiving traffic and poisons everything it touches.</H>

<C color="crimson">The gray failure — degraded but not dead — is what most redundancy designs handle badly.</C> A node at 100× normal latency still answers health checks, still gets its share of traffic, and drags every caller's p99 with it. Detecting it requires latency-aware health checking, not liveness checks.

---

## 2. Redundancy that does not work

<Jargon
  plain="Failures that happen together because the 'independent' components share something."
  term="correlated failure"
  also={['common-mode failure', 'shared fate']}>

The reason [the parallel availability formula](../01-foundations/03-slis-slos-and-error-budgets.md) `1 − (1−a)^N` so often overpromises. <C color="crimson">It assumes independence, and real replicas share far more than their diagrams show.</C>

</Jargon>

<Trace title="Three replicas, one outage" subtitle="Each step adds redundancy. Watch what is still shared.">

<TraceStep
  title="One instance"
  state={{ 'Instances': '1', 'Claimed availability': '99%', 'Shared: zone': 'n/a', 'Real weak point': 'the instance' }}
  changed={['Instances', 'Claimed availability']}
  note="Honest baseline. Nothing is pretending to be more reliable than it is.">

A single server. One failure takes everything down.

</TraceStep>

<TraceStep
  title="Three instances, one availability zone"
  cost="shared zone"
  state={{ 'Instances': '3', 'Claimed availability': '99.9999%', 'Shared: zone': 'YES', 'Real weak point': 'the zone' }}
  changed={['Instances', 'Claimed availability', 'Shared: zone', 'Real weak point']}
  note="The formula says six nines. The zone's own availability caps you far below that.">

The formula promises `1 − 0.01³` = 99.9999%. <C color="crimson">All three share power, cooling and network fabric</C> — so a zone failure takes all three, and your real ceiling is the zone's availability.

</TraceStep>

<TraceStep
  title="Three instances, three zones"
  state={{ 'Instances': '3', 'Zones': '3', 'Shared: deploy pipeline': 'YES', 'Real weak point': 'a bad deploy' }}
  changed={['Zones', 'Shared: deploy pipeline', 'Real weak point']}
  note="Physical independence achieved. Logical independence not yet.">

Zone failure is now survivable. <C color="crimson">But all three run the same code, deployed by the same pipeline, at the same time.</C>

A bad release reaches all three within seconds.

</TraceStep>

<TraceStep
  title="Add staged rollout"
  state={{ 'Instances': '3', 'Zones': '3', 'Deploy': 'canary + staged', 'Shared: config': 'YES', 'Real weak point': 'a config change' }}
  changed={['Deploy', 'Shared: config', 'Real weak point']}
  note="Config changes are the most common cause of large outages precisely because they bypass code-deploy safeguards.">

Deploys now roll out gradually with automatic rollback. <C color="crimson">Config changes still apply globally in seconds</C> — and config typically has none of code's review, testing or staging.

</TraceStep>

<TraceStep
  title="Stage config too — then find the real one"
  cost="the shared dependency"
  state={{ 'Instances': '3', 'Zones': '3', 'Deploy': 'staged', 'Config': 'staged', 'Real weak point': 'the shared database' }}
  changed={['Config', 'Real weak point']}
  note="All three replicas are perfectly healthy and none can serve a request.">

<C color="crimson">All three talk to the same database.</C> When it is unavailable, three healthy replicas serve three sets of errors.

</TraceStep>

<TraceStep
  title="The honest accounting"
  state={{ 'Instances': '3', 'Zones': '3', 'Shared': 'DB, DNS, auth, certificates, cloud control plane', 'Real availability': 'min(shared dependencies)' }}
  changed={['Shared', 'Real availability']}
  note="Redundancy at one layer does not remove single points of failure at another.">

<H>Your availability is bounded by your least available *shared* dependency, not by how many replicas you run. Adding a fourth replica to a design whose real risk is a global config push buys exactly nothing.</H>

</TraceStep>

</Trace>

**The checklist for any redundant design — what do these copies share?**

- Physical: rack, power, cooling, network fabric, availability zone, region
- Logical: code version, deploy pipeline, configuration, feature flags
- Dependencies: database, cache, auth service, DNS, certificate expiry
- Operational: the same runbook, the same on-call engineer, the same monitoring
- Temporal: a leap second, a certificate expiring, a shared cron schedule

<C color="orange">Certificate expiry deserves special mention</C> — every replica typically holds a certificate expiring at the same instant, making it a perfectly correlated failure with a known date.

---

## 3. Blast radius

<C color="green">If failures are inevitable, the design goal is to make each one affect as little as possible.</C>

| Technique | Effect |
| :--- | :--- |
| **Cells / shuffle sharding** | Partition users into independent cells; one failure affects one cell |
| **Bulkheads** | Separate resource pools per dependency, so one saturating does not starve others |
| **Circuit breakers** | Stop calling a failing dependency instead of piling on |
| **Rate limits per tenant** | One customer cannot consume everyone's capacity |
| **Staged rollout** | A bad release reaches 1% before 100% |
| **Regional isolation** | A region's failure does not cascade globally |

**Bulkheads**, named after ship compartments, are the most under-used of these. If service A calls B and C from one thread pool, then B becoming slow consumes every thread and <C color="crimson">requests that only need C also fail.</C> Separate pools mean B's failure stays contained to B's callers.

<Depth title="Shuffle sharding, and why it works so well">

**Plain cells.** Partition users into independent groups, each with its own full stack. With 8 cells and one failing, 12.5% of users are affected. Better than 100%, and it means one bad customer or one poisonous request can only harm their own cell.

**Shuffle sharding** does dramatically better for the same resources, and the mechanism is worth understanding because it is counter-intuitive.

Instead of assigning each customer to one cell, assign each to a **random subset** of nodes. With 8 nodes and 2 per customer:

```
  customer A → nodes {1, 5}
  customer B → nodes {3, 7}
  customer C → nodes {1, 7}
  customer D → nodes {2, 4}
```

Now suppose customer A sends traffic that breaks the nodes serving them — nodes 1 and 5 go down.

- **Customer C** shares node 1, but still has node 7. <C color="green">Degraded, not down.</C>
- **Customers B and D** are entirely unaffected.

The number of customers who lose *all* their nodes is the number assigned to exactly `{1,5}`. With `C(8,2) = 28` possible pairs, that is roughly **1 in 28** of customers — not 1 in 4 as simple cells would give.

**The combinatorics are the point.** With 100 nodes and 5 per customer, there are `C(100,5) ≈ 75 million` combinations. Two random customers share all five nodes with probability ~1 in 75 million. <C color="green">A single customer's failure can take out their own service and almost certainly nobody else's</C> — with no dedicated capacity per customer.

**Where it is used:** AWS Route 53 and several other AWS services, Amazon's internal load balancers, and multi-tenant systems generally. It is one of the highest-leverage isolation techniques available and remains under-known.

**What it requires:** a routing layer that maps customers to their subset, and a client (or router) that can retry against another node in the subset. It works best where nodes are interchangeable — stateless services, caches, DNS resolvers — and less well where each node holds distinct state.

**The general principle beyond shuffle sharding:** <H>the question is never "will this fail?" but "when it fails, who notices?" Design so that the answer is as small a group as possible — and prefer arrangements where the affected group is *different* for each failure, so no single customer is repeatedly unlucky.</H>

</Depth>

---

## 4. Redundancy patterns

| Pattern | How it works | Cost |
| :--- | :--- | :--- |
| **Active-active** | All instances serve traffic | <C color="green">No idle capacity; failover is instant</C> |
| **Active-passive** | Standby idle until needed | Wasted capacity; <C color="crimson">failover is untested by definition</C> |
| **N+1** | One spare beyond required capacity | Cheap insurance |
| **N+2** | Two spares | Survives a failure during maintenance |

<C color="green">Prefer active-active wherever possible.</C> The passive node in active-passive is exercised only during a real failure — which is precisely when you least want to discover it does not work. An active-active design has no untested path, because every instance is in constant use.

<C color="orange">Choose N+2 when you take instances down for maintenance</C>: with N+1, a single unexpected failure during a planned upgrade leaves you short — the same reasoning as [five-node consensus clusters](../06-distributed-systems/03-consensus-and-quorums.md).

---

## 5. In a design discussion

- **"Three replicas across three zones — same-zone replicas share power and network, so the formula would overpromise badly."** Names the correlation.
- **"A gray failure is worse than a crash: it keeps passing health checks and dragging every caller's p99. We need latency-aware health checks."** The failure mode most designs miss.
- **"Separate connection pools per dependency, so a slow payment provider can't consume every thread and fail requests that never touch it."** Bulkheads, concretely.
- **"Shuffle sharding rather than plain cells — with 5 of 100 nodes per tenant, two tenants sharing all five is about one in 75 million."** A strong, specific answer.

---

## Rapid-fire recall

1. Name the six failure modes, and say which is easiest and which is hardest.
2. Why is a slow node often worse than a crashed one?
3. Why does the parallel availability formula overpromise in practice?
4. List five categories of thing "independent" replicas commonly share.
5. Why is certificate expiry a perfectly correlated failure?
6. Why do config changes cause disproportionately large outages?
7. What is a bulkhead, and what failure does it contain?
8. With 8 nodes and 2 per customer, what fraction of customers lose all their nodes when one customer's two fail?
9. Why does shuffle sharding scale so well with node count?
10. Why prefer active-active over active-passive, and when do you need N+2?

<details>
<summary>Answers</summary>

1. **Crash** (easiest — obvious and quickly detected) · **omission** · **timing** · **response** (wrong data) · **Byzantine** · **partial**. Hardest are **response** and **partial**, because the component still looks healthy.
2. Because it **keeps passing health checks and receiving traffic**, dragging every caller's p99 and consuming their connections and threads. A crashed node is removed from rotation immediately.
3. Because `1 − (1−a)^N` assumes **independence**, and real replicas share zones, deploy pipelines, configuration, dependencies, runbooks and certificate expiry dates. Correlated failure means they go down together.
4. **Physical** (rack, power, zone, region) · **logical** (code version, pipeline, config, flags) · **dependencies** (database, DNS, auth, certificates) · **operational** (runbook, on-call, monitoring) · **temporal** (leap seconds, certificate expiry, shared cron).
5. Because **every replica typically holds a certificate expiring at the same instant** — so all of them fail simultaneously, on a date that is known in advance and still routinely missed.
6. Because config typically **bypasses the safeguards code has** — review, testing, staging, staged rollout — and applies **globally within seconds**.
7. **Separate resource pools per dependency.** It contains a slow dependency: without it, one slow downstream consumes the whole thread pool and requests that never touch it also fail.
8. Roughly **1 in 28** — the number of possible pairs `C(8,2)`. Only customers assigned the identical pair lose everything, versus 1 in 4 with plain cells.
9. Because the number of possible subsets grows **combinatorially**: 5 of 100 nodes gives `C(100,5) ≈ 75 million` combinations, so two customers sharing their entire subset is vanishingly unlikely — near-perfect isolation with no dedicated capacity.
10. Because active-passive's standby is **exercised only during a real failure**, which is exactly when discovering it is broken is worst. **N+2** is needed when instances are taken down for maintenance, so an unexpected failure during a planned upgrade does not leave you short.

</details>

---

**Next:** [Timeouts, Retries and Circuit Breakers](./02-timeouts-retries-circuit-breakers.md) — the three settings that decide whether a failure spreads.
