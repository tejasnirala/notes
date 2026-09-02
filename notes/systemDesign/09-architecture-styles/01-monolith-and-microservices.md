---
title: Monolith and Microservices
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Monolith and Microservices

> **What you will be able to do after this page**
>
> - State what microservices actually buy, and what they charge for it.
> - Explain the modular monolith, and why it is the right default.
> - Recognise the specific pressures that justify splitting.
> - Say why "microservices scale better" is usually false.

The most over-discussed decision in system design, and the one most often made for the wrong reasons. <C color="orange">The deciding factor is almost never technical.</C>

<Plain>

A restaurant has one kitchen. Everyone cooks in it, shares the equipment, and can shout to each other.

It works well until there are forty cooks. Now they collide at the stove, the fridge is always busy, and one person's mess slows everybody. So you consider splitting into separate kitchens — one for starters, one for grills, one for desserts.

Each team gets its own space and can change how they work without disturbing anyone. Real gains, and real costs that are easy to underestimate.

**Passing a plate is now a walk down a corridor**, and things get dropped on the way. In one kitchen, handing something over was turning around.

**A dish needing three kitchens is now genuinely hard.** Coordinating "all three or none" across three rooms is a completely different problem from doing it at one bench.

**Everything needs three of everything** — three sets of equipment, three cleaning schedules, three people on call.

Here is the thing worth noticing: <C color="orange">splitting solved a **people** problem, not a cooking one.</C> Forty cooks colliding is about coordination. A single kitchen with four cooks in it has no such problem, and dividing it into four rooms makes their work strictly harder.

<H>So the question is never "are separate kitchens better?" It is "how many cooks do we have, and are they actually getting in each other's way?"</H>

</Plain>

---

## 1. What microservices actually buy

| Benefit | Real? |
| :--- | :--- |
| **Independent deployment** | <C color="green">Yes — the genuine headline benefit</C> |
| **Team autonomy** | <C color="green">Yes — teams own a service end to end</C> |
| **Independent scaling** | <C color="orange">Yes, and rarely the constraint</C> |
| **Technology diversity** | <C color="orange">Yes, and usually a liability</C> |
| **Fault isolation** | <C color="orange">Only with deliberate design — see below</C> |
| **Easier to understand** | <C color="crimson">No — the opposite, usually</C> |
| **Better performance** | <C color="crimson">No — network calls are slower than function calls</C> |

<H>The whole case rests on the first two, and both are organisational. Microservices are a solution to teams blocking each other — not to a system being slow, large, or hard to scale.</H>

**On fault isolation.** The claim is that one service failing does not take down the rest. That is true only if callers degrade gracefully. <C color="crimson">Without circuit breakers, timeouts and fallbacks, a failing service just spreads its failure across every caller</C> — and [availability multiplies down](../01-foundations/03-slis-slos-and-error-budgets.md), so ten 99.9% services in a request path give 99%. Microservices *make availability worse* by default; better availability is something you engineer on top.

**On independent scaling.** Real, and usually irrelevant. Most systems have one bottleneck — usually the database — and splitting the application tier does not address it. <C color="orange">If your app servers are stateless, you can already scale them by adding instances.</C>

---

## 2. What they cost

<Trace title="One feature, two architectures" subtitle='"Show the customer their order with product details and delivery estimate."'>

<TraceStep
  title="Monolith — one function call"
  state={{ 'Network calls': '0', 'Failure modes': '1 (DB down)', 'Latency': '~5 ms', 'Deploys to ship': '1', 'Teams to coordinate': '1' }}
  changed={['Network calls', 'Latency', 'Deploys to ship']}
  note="One transaction, one stack trace, one place to look when it breaks.">

A single query with joins across orders, products and shipments. <C color="green">Transactional, fast, trivially debuggable.</C>

</TraceStep>

<TraceStep
  title="Microservices — three network calls"
  cost="new failure modes"
  state={{ 'Network calls': '3', 'Failure modes': '~12', 'Latency': '~25 ms', 'Deploys to ship': '1–3', 'Teams to coordinate': '1–3' }}
  changed={['Network calls', 'Failure modes', 'Latency', 'Teams to coordinate']}
  note="Each call can time out, fail, return partial data, or be slow — and combinations of those.">

Order service → product service → shipping service. Each hop adds latency and can fail independently.

</TraceStep>

<TraceStep
  title="Now make it resilient"
  state={{ 'Network calls': '3', 'Failure modes': 'handled', 'Latency': '~25 ms', 'Extra code': 'timeouts, retries, breakers, fallbacks' }}
  changed={['Failure modes', 'Extra code']}
  note="None of this code existed in the monolith, because none of these failures existed.">

Every call needs a timeout, a retry policy, a circuit breaker, and a decision about what to show when a dependency is unavailable.

</TraceStep>

<TraceStep
  title="A field is added to Product"
  cost="cross-team coordination"
  state={{ 'Monolith': '1 PR, 1 deploy', 'Microservices': 'API version, 2 teams, ordered deploys', 'Elapsed': 'hours vs days' }}
  changed={['Monolith', 'Microservices', 'Elapsed']}
  note="This is the tax paid on every change that crosses a boundary — and it is paid constantly.">

Monolith: change the struct, one deploy. Microservices: version the API, coordinate with the consuming team, deploy in order.

</TraceStep>

<TraceStep
  title="Where the split pays off"
  state={{ 'Teams': '12', 'Monolith deploys': 'queued, blocked, risky', 'Microservices deploys': 'independent, parallel', 'Verdict': 'now worth it' }}
  changed={['Teams', 'Monolith deploys', 'Microservices deploys', 'Verdict']}
  note="The costs did not go away. The benefit finally exceeds them.">

With twelve teams in one repository, every deploy queues behind others, and one team's bug blocks eleven others' releases.

<H>Nothing about the technical costs changed between step 4 and step 5 — only the number of teams. That is the whole decision.</H>

</TraceStep>

</Trace>

**The full bill:**

| Cost | Detail |
| :--- | :--- |
| Network calls instead of function calls | Latency, partial failure, serialisation |
| No cross-service transactions | [Sagas](../06-distributed-systems/06-distributed-transactions.md) and eventual consistency |
| No cross-service joins | Denormalize, or fan out and merge |
| Availability multiplies down | Ten 99.9% services in a path give 99% |
| Distributed debugging | Correlation ids and tracing become mandatory |
| Operational multiplication | N pipelines, N dashboards, N on-call rotations |
| Versioning every boundary | Every shared shape needs a compatibility story |

---

## 3. The modular monolith

<Jargon
  plain="One deployable application, internally divided into modules with enforced boundaries."
  term="modular monolith"
  also={['modulith', 'well-structured monolith']}>

<C color="green">The right default for most teams</C>, and frequently mischaracterised as a compromise. It gives you the discipline of clear boundaries with none of the distribution cost — and, crucially, <C color="orange">it makes a later split cheap</C>, because the boundaries already exist.

</Jargon>

```
  ┌──────────────────────────────────────┐
  │  ONE DEPLOYABLE                      │
  │  ┌────────┐ ┌────────┐ ┌──────────┐  │
  │  │ Orders │ │Catalog │ │ Shipping │  │
  │  └────┬───┘ └───┬────┘ └────┬─────┘  │
  │       └─── public interfaces ───┘    │
  │       ┌──────────────────────┐       │
  │       │ one database, schema  │      │
  │       │ per module            │      │
  │       └──────────────────────┘       │
  └──────────────────────────────────────┘
```

Rules that make it work:

- **Modules talk only through published interfaces.** No reaching into another module's internals.
- <C color="green">**Each module owns its tables.**</C> Other modules query through its interface, never its tables directly. This is the rule that makes a future split possible.
- **Enforce it in the build** — package rules, ArchUnit, module boundaries in the language. <C color="crimson">A convention nobody enforces will be violated within a quarter.</C>
- **Domain events between modules**, in-process for now, over a broker later.

<H>A modular monolith that later needs splitting is a manageable project. A tangled monolith that needs splitting is a rewrite — and the difference is entirely whether the boundaries were enforced while it was still one deployable.</H>

---

## 4. When to split

<Depth title="The real signals, and the ones that mislead">

**Legitimate reasons to extract a service:**

**1. Teams block each other on deploys.** The clearest signal. Deploys queue, one team's failing test blocks another's release, coordination meetings exist purely to sequence deployments. <C color="green">This is the problem microservices actually solve.</C>

**2. Genuinely divergent scaling profiles.** Video transcoding needs GPUs and scales with upload volume; the API scales with request volume. Running them together means provisioning both for the peak of either.

**3. A hard isolation requirement.** Regulatory separation, a component processing card data that must stay inside a narrow PCI boundary, or blast-radius isolation for something safety-critical.

**4. Genuinely different technology needs.** A machine-learning component that needs Python inside a JVM system. Real, and rarer than claimed.

**5. Independent lifecycle.** A component that changes weekly alongside one that changes yearly, where every deploy of the stable part carries risk it need not.

**Reasons that mislead:**

<C color="crimson">**"It'll scale better."**</C> Usually false. The bottleneck is normally the database, which splitting the application does not address — and may worsen, by turning one efficient join into three network round trips.

<C color="crimson">**"The codebase is too big."**</C> A large codebase is a *modularity* problem, and distribution does not fix modularity. <C color="orange">You will get the same tangle with network calls between the tangles</C> — a distributed monolith, which is strictly worse than a monolith.

<C color="crimson">**"It's the modern way."**</C> The companies whose architectures are cited adopted microservices at thousands of engineers, to solve coordination problems a ten-person team does not have.

<C color="crimson">**"Better fault isolation."**</C> Only with deliberate work. By default, distribution makes availability *worse*.

**The test worth applying**, from Sam Newman: extract a service when the **cost of coordination** exceeds the **cost of distribution**. Both are measurable. Coordination cost shows up as blocked deploys, sequencing meetings, and merge conflicts across team boundaries. Distribution cost shows up as latency, resilience code, and operational surface.

**And the counter-examples matter.** [Amazon's Prime Video team](/systemDesign/case-studies) consolidated a distributed pipeline into a monolith and cut costs 90%. Segment did the same and cited operational overhead. Shopify runs an enormous, deliberately modular monolith. Stack Overflow served hundreds of millions of monthly page views from a handful of servers.

<H>These are not arguments against microservices. They are evidence that the decision is about your organisation's coordination cost, not about what good architecture looks like in the abstract.</H>

**If you do split:** extract one service at a time, starting with something at the edge with few dependencies. Use the [strangler fig pattern](https://martinfowler.com/bliki/StranglerFigApplication.html) — route traffic for one capability to the new service while the monolith handles everything else — and keep the monolith authoritative until the new service has proven itself. <C color="crimson">A big-bang decomposition is how multi-year rewrites happen.</C>

</Depth>

---

## 5. Choosing

| Situation | Architecture |
| :--- | :--- |
| 1–3 teams | <C color="green">Modular monolith</C> |
| 4–10 teams, some deploy friction | <C color="green">Modular monolith + extract the painful parts</C> |
| 10+ teams blocking each other | <C color="green">Microservices</C> |
| Genuinely different scaling or isolation needs | <C color="green">Extract that component only</C> |
| Startup finding product-market fit | <C color="green">Monolith</C> — boundaries are still moving |
| Existing tangled monolith | <C color="green">Modularise first</C>, then extract |

<C color="green">Start with a modular monolith. Extract services when a specific, named pressure justifies it.</C> That path costs almost nothing if you never need to split, and is far cheaper than the reverse if you do.

---

## 6. In a design discussion

- **"Modular monolith — three teams don't have a coordination problem yet, and enforced module boundaries mean splitting later is cheap."** Default with a reason and an exit.
- **"Microservices solve teams blocking each other. Our bottleneck is the database, which splitting the app tier won't fix."** Corrects the common justification.
- **"Ten 99.9% services in a request path give 99%. Distribution makes availability worse by default."** The arithmetic that surprises people.
- **"I'd extract transcoding specifically — GPUs and a completely different scaling profile — and leave the rest together."** Surgical rather than ideological.

---

## Rapid-fire recall

1. Which two microservice benefits are genuine, and what do they have in common?
2. Why is "better fault isolation" only conditionally true?
3. Why is "microservices scale better" usually false?
4. Name five costs of distribution.
5. What is a modular monolith, and which rule makes a future split possible?
6. Why must module boundaries be enforced by the build?
7. Give three legitimate reasons to extract a service.
8. Why does "the codebase is too big" not justify splitting?
9. State the test for when to extract, and how both sides are observable.
10. How should a split actually be carried out?

<details>
<summary>Answers</summary>

1. **Independent deployment** and **team autonomy**. Both are **organisational** — they solve teams blocking each other, not technical limits.
2. Because one service failing only stays contained if callers **degrade gracefully** — timeouts, circuit breakers, fallbacks. Without that, failure spreads to every caller, and availability multiplies down (ten 99.9% services ⇒ 99%).
3. Because the bottleneck is usually the **database**, which splitting the application tier does not address — and stateless app servers could already be scaled by adding instances.
4. **Network calls instead of function calls** · **no cross-service transactions** · **no cross-service joins** · **availability multiplies down** · **distributed debugging** · **N pipelines/dashboards/rotations** · **versioning every boundary**.
5. One deployable, internally divided into modules that communicate only through **published interfaces**. The rule that makes a split possible is that **each module owns its tables** and others never query them directly.
6. Because **a convention nobody enforces will be violated within a quarter**, and once modules reach into each other's internals the boundaries are fictional — which is exactly what turns a split into a rewrite.
7. **Teams blocking each other on deploys** · **genuinely divergent scaling profiles** (GPU transcoding vs API) · **a hard isolation requirement** (regulatory, PCI, blast radius) · genuinely different technology needs · independent lifecycle.
8. Because size is a **modularity** problem, and distribution does not fix modularity — you get the same tangle with network calls between the pieces, which is a **distributed monolith** and strictly worse.
9. Extract when the **cost of coordination exceeds the cost of distribution**. Coordination shows up as blocked deploys, sequencing meetings and cross-team merge conflicts; distribution shows up as latency, resilience code and operational surface.
10. **One service at a time**, starting at the edge with few dependencies, using the **strangler fig** pattern — route one capability to the new service while the monolith handles the rest, keeping it authoritative until the new service proves itself. Never big-bang.

</details>

---

**Next:** [Service Boundaries](./02-service-boundaries.md) — where to draw the lines, if you draw them at all.
