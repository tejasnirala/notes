---
title: Segment — 140 Services Back to One
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Segment — 140 Services Back to One

> **The claim:** Segment moved from a monolith to over 140 microservices, then back to a monolith — because the operational overhead of the services exceeded the isolation benefit they were adopted for.
>
> *Source: "Goodbye Microservices: From 100s of problem children to 1 superstar", Segment engineering blog, 2018.*

<C color="orange">A more useful case study than [Prime Video](./02-prime-video-monolith.md), because the cost was organisational rather than technical</C> — and organisational costs are the ones people systematically underestimate.

<Plain>

A translation agency handles documents for two hundred clients, each wanting a different output format.

**One team doing all of it** works until a difficult client's job jams the queue and everyone else waits.

**So each client gets a dedicated translator**, with their own desk, their own procedures, their own filing. One jam now affects one client — exactly the isolation that was wanted.

Then the second-order costs arrive, and they are not about translation.

**Two hundred desks to maintain.** Each needs supplies, a rota, a supervisor.

**A change to the house style must reach all two hundred.** It is applied to the busy desks quickly and the quiet ones eventually — so after a year, <C color="crimson">the desks are running different versions of the standard, and nobody knows which.</C>

**A new client means setting up a whole desk.** What was adding a line to a procedure is now a small project.

**The quiet desks are the worst.** A translator handling one document a month still has a desk, a rota slot, and a stale procedure nobody has checked in eight months. <C color="crimson">They cost as much to maintain as the busy ones and produce almost nothing.</C>

None of that is about translating. It is about **two hundred of anything**, and the cost scales with the count regardless of how much work each does.

</Plain>

---

## 1. The six questions

**Q1 — Constraints.** A customer-data platform routing events to 100+ third-party destinations, each with its own API, rate limits and failure behaviour. A small engineering team. Destinations added continuously as a **product** requirement.

**Q2 — Which resource ran out?** <C color="orange">Engineering capacity, not compute.</C> Operational overhead grew linearly with destination count while the team did not.

**Q3 — What did they try first?** The monolith came first. <C color="green">The move to services was a correct response to a real problem</C>: one slow or failing destination created head-of-line blocking that delayed events for every other destination.

**Q4 — What did the reversal cost?** They gave up per-destination isolation and had to rebuild it differently — in-process, with separate queues per destination rather than separate services.

**Q5 — Doing nothing?** Increasingly untenable. The overhead was consuming the capacity needed to add destinations, which was the product.

**Q6 — What transfers?**

<H>Operational cost scales with the *number* of services, not their size. A service handling one event a day costs nearly as much to own, deploy, monitor and keep current as one handling a million.</H>

---

## 2. Why 140 services broke a small team

<Trace title="The cost curve nobody plotted" subtitle="Following what happens as destination count grows.">

<TraceStep
  title="Monolith — one deployable"
  cost="head-of-line blocking"
  state={{ 'Services': '1', 'Repos': '1', 'Isolation': 'NONE', 'Adding a destination': 'a pull request' }}
  changed={['Services', 'Repos', 'Isolation', 'Adding a destination']}
  note="The genuine problem that motivated the split — one bad destination delayed everyone's events.">

A single queue for all destinations. <C color="crimson">One slow destination backs up the queue and every customer's events are delayed.</C>

</TraceStep>

<TraceStep
  title="One service per destination"
  state={{ 'Services': '~140', 'Repos': '~140', 'Isolation': 'excellent', 'Adding a destination': 'a new service' }}
  changed={['Services', 'Repos', 'Isolation', 'Adding a destination']}
  note="The isolation problem is genuinely solved. The bill arrives later and in a different currency.">

<C color="green">Each destination has its own queue, its own scaling and its own failure domain.</C> A failing destination affects only itself.

</TraceStep>

<TraceStep
  title="The shared library problem"
  cost="version drift"
  state={{ 'Shared libs': 'many', 'Versions in production': 'dozens', 'Updating one': '140 PRs', 'Consistency': 'lost' }}
  changed={['Shared libs', 'Versions in production', 'Updating one', 'Consistency']}
  note="This is the cost the original decision did not price, and it compounds silently.">

Common code — queue handling, retries, HTTP clients — lives in shared libraries. <C color="crimson">Updating one means updating 140 services</C>, so in practice the busy ones are updated and the quiet ones are not.

Production now runs many versions simultaneously, and <C color="orange">a bug fixed nine months ago is still live in thirty services.</C>

</TraceStep>

<TraceStep
  title="Testing and CI"
  state={{ 'Test suites': '140', 'CI pipelines': '140', 'Time to make a global change': 'days', 'Team size': 'unchanged' }}
  changed={['Test suites', 'CI pipelines', 'Time to make a global change']}
  note="Every dimension of overhead multiplies by the service count, and none of it multiplies by value delivered.">

Each service needs its own tests, pipeline, dashboards, alerts and deployment. <C color="crimson">All of it scales with count, none with usage.</C>

</TraceStep>

<TraceStep
  title="The long tail is the worst part"
  cost="cost without value"
  state={{ 'High-volume destinations': 'a handful', 'Low-volume destinations': 'most of them', 'Cost per service': 'roughly equal', 'Value per service': 'wildly unequal' }}
  changed={['High-volume destinations', 'Low-volume destinations', 'Cost per service', 'Value per service']}
  note="A destination used by three customers costs the same to own as one used by thousands.">

<H>Most destinations were low volume. Each still had a repository, a pipeline, alerts, dependencies and an on-call surface — full operational cost for a fraction of the traffic.</H>

</TraceStep>

<TraceStep
  title="Back to one deployable, with per-destination queues"
  state={{ 'Services': '1', 'Repos': '1', 'Isolation': 'per-destination queues', 'Adding a destination': 'a pull request' }}
  changed={['Services', 'Repos', 'Isolation', 'Adding a destination']}
  note="The isolation requirement was real; separate services were only one way to satisfy it.">

<C color="green">Isolation was rebuilt **inside** the monolith</C> — separate queues and worker pools per destination, so head-of-line blocking is still prevented.

One deployable, one library version, one pipeline.

</TraceStep>

</Trace>

---

## 3. The lesson people miss

<Depth title="Isolation is a requirement; separate services are one implementation of it">

The move to microservices solved a **real** problem. Head-of-line blocking between destinations was genuinely harming customers, and separating them was a reasonable response.

<C color="orange">The error was treating "separate services" as the only way to get isolation.</C> Isolation can be provided at several levels, and their costs differ by orders of magnitude:

| Isolation mechanism | Cost |
| :--- | :--- |
| **Separate queues** in one process | <C color="green">Very low — a data structure</C> |
| **Separate thread pools / bulkheads** | <C color="green">Low — configuration</C> |
| **Separate processes**, same deployable | Moderate |
| **Separate services** | <C color="crimson">High — repo, pipeline, dashboards, on-call, per service</C> |
| **Separate clusters** | Very high |

<C color="green">Segment's rebuilt monolith used the first two</C>, and got the isolation that mattered at a tiny fraction of the cost.

**The general question to ask** when isolation motivates a split:

<H>What exactly must be isolated — failure, resources, deployment, or teams? Only the last two genuinely require separate services. Failure and resource isolation can nearly always be achieved within one deployable.</H>

**How to price the operational cost before committing.** Each service carries a roughly fixed annual overhead regardless of its size: a repository and its dependency updates, a CI pipeline, deployment configuration, dashboards, alerts, runbooks, on-call surface, and a share of every cross-cutting migration. Multiply that by the number of services and compare it against your engineering capacity.

<C color="crimson">The number that matters is services **per engineer**.</C> Segment's ratio made routine maintenance impossible: any change touching shared code became a project, so shared code stopped being updated, and consistency was lost silently rather than loudly.

**When per-destination services *would* have been right:**

- If different **teams** owned different destinations — then independent deploys are the point, and the overhead buys real autonomy.
- If destinations had genuinely different **scaling profiles** requiring separate infrastructure.
- If some destinations had **compliance isolation** requirements.
- If the team were large enough that services-per-engineer stayed manageable.

None applied. <C color="orange">One team, similar workloads, no compliance boundary — so the split bought isolation they could have had for far less, and charged them 140× the operational overhead for it.</C>

**Read alongside [Prime Video](./02-prime-video-monolith.md).** Both reversed a distributed design; the reasons share nothing. Prime Video's cost was **data movement**; Segment's was **operational overhead per service**. <H>Two entirely different failure modes, both invisible on an architecture diagram, and both discovered only after the boundaries were live.</H>

</Depth>

---

## Rapid-fire recall

1. What real problem motivated the original split?
2. Which resource actually ran out, and why did it scale badly?
3. Describe the shared library problem and its silent consequence.
4. Why is the long tail of low-volume services the worst part?
5. How was isolation preserved after returning to one deployable?
6. Rank the isolation mechanisms by cost.
7. Which two kinds of isolation genuinely require separate services?
8. What ratio should be checked before splitting, and what happens when it is too high?
9. Name three conditions under which the per-destination split would have been correct.
10. How do the Prime Video and Segment reversals differ?

<details>
<summary>Answers</summary>

1. **Head-of-line blocking** — one slow or failing destination backed up a shared queue and delayed events for every other destination.
2. **Engineering capacity.** Operational overhead scaled with the **number of services**, which grew continuously as a product requirement, while the team did not.
3. Common code lived in shared libraries; updating one meant updating **140 services**. In practice busy services were updated and quiet ones were not, so **production ran many versions simultaneously** and fixes silently failed to reach much of the fleet.
4. Because **cost per service is roughly fixed** — repo, pipeline, dashboards, alerts, on-call — while **value per service varies enormously**. A destination used by three customers cost as much to own as one used by thousands.
5. With **separate queues and worker pools per destination inside one process** — preserving failure isolation without separate deployables.
6. **Separate queues** (very low) → **separate thread pools/bulkheads** (low) → **separate processes in one deployable** (moderate) → **separate services** (high) → **separate clusters** (very high).
7. **Deployment isolation** and **team isolation**. Failure and resource isolation can nearly always be achieved within one deployable.
8. **Services per engineer.** When it is too high, any change touching shared code becomes a project, so shared code stops being updated — and consistency is lost **silently** rather than through a visible failure.
9. If **different teams owned different destinations** · if destinations had **genuinely different scaling profiles** · if some had **compliance isolation requirements** · if the team were large enough to keep services-per-engineer manageable.
10. **Prime Video's** cost was **data movement** across boundaries crossed per frame. **Segment's** was **fixed operational overhead per service**, multiplied by 140. Same reversal, entirely different mechanism.

</details>

---

**Next:** [Twitter's Timeline](./04-twitter-timeline.md) — the fan-out problem, solved twice.
