---
title: Serverless
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Serverless

> **What you will be able to do after this page**
>
> - Say what serverless actually changes, beyond "no servers to manage".
> - Explain cold starts, and when they matter.
> - Compute the crossover point where serverless stops being cheaper.
> - Recognise the workloads it suits and the ones it punishes.

Serverless removes a genuine class of work and <C color="orange">replaces it with a different set of constraints that are less obvious and harder to escape.</C>

<Plain>

Two ways to get around a city.

**Own a car.** You pay for it whether you drive or not — insurance, parking, servicing. It is always there, always ready, and the marginal cost of a trip is small. If you drive constantly, it is much cheaper than the alternative.

**Take taxis.** You pay only when you travel. No maintenance, no parking, nothing sitting idle. For occasional trips this is obviously better.

Two things about taxis are easy to miss.

**You wait for one to arrive.** Usually a couple of minutes; occasionally longer, at exactly the times everyone wants one. <C color="orange">Your own car is already in the driveway.</C>

**You cannot leave things in it.** Everything you need must come with you each time, and anything you produce must be taken out at the end — because the next trip is a different car.

And the arithmetic flips. Occasional trips: taxis, easily. Commuting daily: <C color="crimson">taxis become far more expensive than owning</C>, and the crossover arrives sooner than people expect.

<H>The decision is not "which is better". It is "how often do I travel, and does waiting a couple of minutes matter?"</H>

</Plain>

---

## 1. What actually changes

<Jargon
  plain="Code that runs on demand, on infrastructure you never see, billed per invocation."
  term="serverless / FaaS"
  also={['functions as a service', 'Lambda', 'Cloud Functions']}>

Servers obviously still exist. What changes is that <C color="green">you no longer provision, scale, patch or pay for idle capacity</C> — and in exchange you accept a per-request execution model with hard limits.

</Jargon>

| Gain | Cost |
| :--- | :--- |
| <C color="green">No capacity planning</C> | <C color="crimson">Cold starts</C> |
| <C color="green">Scales to zero — no idle cost</C> | <C color="crimson">Execution time limits</C> (typically ~15 min) |
| <C color="green">Scales up automatically, fast</C> | <C color="crimson">Statelessness enforced</C> — nothing survives an invocation |
| <C color="green">Per-request billing</C> | <C color="crimson">Expensive at sustained high volume</C> |
| <C color="green">No patching or OS management</C> | <C color="crimson">Vendor lock-in</C> |
| <C color="green">Built-in availability</C> | <C color="crimson">Local development and debugging are harder</C> |

---

## 2. Cold starts

The first invocation on a new instance must download the code, start a runtime, and initialise the application.

```
  WARM  → invoke handler                          ~1–10 ms
  COLD  → provision + download + init runtime
          + init app + invoke handler             ~100 ms – 5 s
```

| Factor | Effect |
| :--- | :--- |
| **Runtime** | Go/Rust ~100 ms · Node/Python ~200–400 ms · <C color="crimson">JVM/.NET 1–5 s</C> |
| **Package size** | Larger bundles download slower — trim dependencies |
| **VPC attachment** | Historically added seconds; much improved, still non-zero |
| **Init work** | Connection pools, config loads, DI containers all run on cold start |

<C color="green">When cold starts do not matter:</C> async work off a queue, scheduled jobs, and anything where a user is not waiting.

<C color="crimson">When they do:</C> user-facing APIs with tight latency budgets, and especially **spiky traffic** — a burst provisions many new instances at once, so <C color="orange">a large fraction of the burst pays the cold-start penalty</C>, exactly when you least want it.

**Mitigations:** provisioned concurrency (pre-warmed instances — which reintroduces idle cost), a lighter runtime, smaller bundles, and moving heavy initialisation out of the request path.

---

## 3. The cost crossover

Serverless is dramatically cheaper at low and spiky volume, and dramatically more expensive at sustained high volume. The crossover is closer than most people assume.

<Trace title="Serverless versus containers, as traffic grows" subtitle="100 ms average execution, 512 MB memory. Watch where the lines cross.">

<TraceStep
  title="1,000 requests/day"
  state={{ 'Requests/month': '30K', 'Serverless': '~$0 (free tier)', 'Containers': '~$30 (min 2 instances)', 'Winner': 'serverless' }}
  changed={['Requests/month', 'Serverless', 'Containers', 'Winner']}
  note="Containers must run continuously for availability, so you pay for idle capacity 24/7.">

An internal tool. <C color="green">Serverless is essentially free; containers cost the same whether used or not.</C>

</TraceStep>

<TraceStep
  title="100,000 requests/day"
  state={{ 'Requests/month': '3M', 'Serverless': '~$8', 'Containers': '~$60', 'Winner': 'serverless' }}
  changed={['Requests/month', 'Serverless', 'Containers']}
  note="Still comfortably ahead — average utilisation is nowhere near a full instance.">

A modest production API. Serverless still wins clearly.

</TraceStep>

<TraceStep
  title="10 million requests/day"
  state={{ 'Requests/month': '300M', 'Serverless': '~$800', 'Containers': '~$300 (3 instances)', 'Winner': 'containers' }}
  changed={['Requests/month', 'Serverless', 'Containers', 'Winner']}
  note="The crossover has already passed — and the gap widens linearly from here.">

<C color="crimson">Serverless now costs roughly 2.5× more</C>, because you are paying per invocation for load that keeps a few instances continuously busy.

</TraceStep>

<TraceStep
  title="100 million requests/day"
  state={{ 'Requests/month': '3B', 'Serverless': '~$8,000', 'Containers': '~$1,200', 'Winner': 'containers, decisively' }}
  changed={['Requests/month', 'Serverless', 'Containers', 'Winner']}
  note="At sustained high volume you are renting compute at a large premium for elasticity you no longer use.">

<C color="crimson">Roughly 7× more expensive.</C> The elasticity you are paying for is worthless when load is steady.

</TraceStep>

<TraceStep
  title="But now make the traffic spiky"
  cost="containers lose again"
  state={{ 'Pattern': '2 h/day at 10× peak', 'Serverless': '~$700', 'Containers': '~$3,000 (provisioned for peak)', 'Winner': 'serverless' }}
  changed={['Pattern', 'Serverless', 'Containers', 'Winner']}
  note="Containers must be provisioned for peak and sit idle the rest of the time; serverless bills only the peak hours.">

Same monthly volume, concentrated into two hours a day.

<H>The deciding variable is not request count — it is **utilisation**. Serverless wins whenever average utilisation is low, and loses whenever it is high, regardless of absolute volume.</H>

</TraceStep>

</Trace>

<C color="orange">And the compute bill is often not the largest number.</C> API Gateway, per-request logging, NAT gateway data transfer and cross-service calls frequently exceed function cost at scale — worth modelling before committing.

---

## 4. Where it fits

| Workload | Verdict |
| :--- | :--- |
| Event handlers (S3 upload, queue message) | <C color="green">Excellent — the canonical use</C> |
| Scheduled jobs, cron | <C color="green">Excellent</C> — no idle cost |
| Webhook receivers | <C color="green">Excellent</C> — spiky and unpredictable |
| Internal tools, admin APIs | <C color="green">Excellent</C> — low volume, scale to zero |
| Glue between managed services | <C color="green">Excellent</C> |
| Spiky public APIs | <C color="green">Good</C> — watch cold starts |
| Steady high-volume APIs | <C color="crimson">Poor — cost and cold starts both work against you</C> |
| Long-running processing | <C color="crimson">Poor</C> — execution limits |
| WebSocket servers | <C color="crimson">Poor</C> — [stateful connections](../02-networking/06-realtime-communication.md) are the opposite of the model |
| Anything needing a big connection pool | <C color="crimson">Poor</C> — see below |

<Depth title="The database connection problem, and other constraints of statelessness">

The most common serverless failure in production, and it is structural rather than a configuration mistake.

**The mechanism.** Traditional servers hold a connection pool: 10 servers × 20 connections = 200 connections, stable, reused across requests. Serverless scales by **instance per concurrent request** — 1,000 concurrent invocations means up to 1,000 instances, each opening its own connection.

<C color="crimson">Postgres defaults to `max_connections = 100`.</C> A traffic spike exhausts it, and the failure is total: not just the functions, but **every other service using that database**. A serverless function scaling up can take down your monolith.

Worse, each connection costs the database memory (~10 MB in Postgres), so even a database configured for thousands of connections spends most of its RAM on connection overhead rather than caching data.

**The fixes, in order:**

**1. A connection proxy.** RDS Proxy, PgBouncer, Data API. Functions connect to the proxy, which multiplexes many client connections onto few database connections. <C color="green">This is the standard answer</C> and should be the default for any serverless workload touching a relational database.

**2. HTTP-based data access.** Databases with HTTP APIs — DynamoDB, Firestore, Neon's serverless driver, PlanetScale — have no persistent connection to exhaust. The model fits naturally.

**3. Reserved concurrency.** Cap how many instances a function may run, bounding connection count. Blunt: excess requests are throttled rather than served.

**Other consequences of enforced statelessness:**

**No in-process caching that survives.** Each instance has its own memory and disappears without warning. A cache populated on one invocation may not exist on the next. <C color="orange">Instances *are* reused between invocations</C>, so caching in a module-level variable helps — but you cannot rely on it, and cache hit rates are unpredictable.

**No background work after responding.** Traditional servers can return a response and continue working. Serverless typically freezes the instance the moment the handler returns — <C color="crimson">work started but not awaited may simply never finish</C>, and this produces genuinely baffling bugs where an operation succeeds locally and silently vanishes in production.

**Fan-out is dangerously easy.** A function triggered per S3 upload will happily scale to thousands of concurrent invocations. If each queries a database or calls a third-party API, you have built an accidental denial-of-service against your own dependency. <C color="green">Reserved concurrency and queue-based decoupling exist for this.</C>

**Local development and debugging are genuinely harder.** Reproducing the runtime, IAM permissions, event shapes and service integrations locally is imperfect. Teams end up testing in a deployed environment, which lengthens the feedback loop — a real productivity cost that rarely appears in comparisons.

<H>The pattern across all of these: serverless removes infrastructure work and replaces it with constraint work. Whether that is a good trade depends entirely on whether your workload fits the constraints — and most of them are discovered after you have committed.</H>

</Depth>

---

## 5. In a design discussion

- **"Serverless for the webhook receivers and scheduled jobs — spiky, low average utilisation, nobody waiting on a cold start."** Matches workload to model.
- **"Containers for the main API. At our volume, serverless would cost several times more, and steady traffic means we get no benefit from elasticity."** The cost argument, correctly framed on utilisation.
- **"RDS Proxy in front of Postgres, or a concurrency spike exhausts `max_connections` and takes down everything else using that database."** The failure most teams meet in production.
- **"Not for WebSockets — persistent connections are the opposite of the execution model."** Knows the boundary.

---

## Rapid-fire recall

1. What does serverless actually remove, and what does it impose?
2. What happens during a cold start, and which runtimes suffer most?
3. Why are cold starts worst during a traffic burst?
4. Name three cold-start mitigations, and the cost of the main one.
5. What variable actually decides the cost crossover?
6. Why does a spiky workload flip the cost comparison back?
7. Which costs besides compute often dominate a serverless bill?
8. Explain the connection exhaustion problem and why it affects other services.
9. Give three fixes, and say which is standard.
10. Why can background work started after responding silently vanish?

<details>
<summary>Answers</summary>

1. It removes **capacity planning, scaling, patching and idle cost**. It imposes **cold starts**, **execution time limits**, **enforced statelessness**, **per-request billing** and **vendor lock-in**.
2. Provisioning an instance, downloading code, starting the runtime, and running application initialisation before the handler executes. Worst on **JVM/.NET (1–5 s)**; best on **Go/Rust (~100 ms)**.
3. Because a burst provisions **many new instances simultaneously**, so a large fraction of the burst pays the penalty — precisely when latency matters most.
4. **Provisioned concurrency** (pre-warmed instances — which reintroduces idle cost, the thing you adopted serverless to avoid) · **a lighter runtime** · **smaller deployment bundles** · **moving heavy init out of the request path**.
5. **Utilisation**, not request volume. Serverless wins when average utilisation is low and loses when it is high, whatever the absolute number of requests.
6. Because containers must be **provisioned for peak and sit idle the rest of the time**, while serverless bills only during the peak hours — so the same monthly volume concentrated into a few hours favours serverless again.
7. **API Gateway**, **per-request logging**, **NAT gateway data transfer**, and **cross-service call charges** — frequently exceeding function compute cost at scale.
8. Serverless scales to roughly **one instance per concurrent request**, each opening its own database connection. A spike exhausts `max_connections` (Postgres defaults to 100), and because the limit is on the **database**, it fails **every other service using it** — not just the functions.
9. **A connection proxy** (RDS Proxy, PgBouncer) — the standard answer · **HTTP-based data access** (DynamoDB, serverless drivers) with no persistent connections · **reserved concurrency** to cap instances, which throttles excess requests.
10. Because the platform typically **freezes the instance the moment the handler returns**. Work that was started but not awaited never resumes — succeeding locally and silently vanishing in production.

</details>

---

**Next:** [Failure and Redundancy](../10-reliability/01-failure-and-redundancy.md) — designing for the assumption that everything breaks.
