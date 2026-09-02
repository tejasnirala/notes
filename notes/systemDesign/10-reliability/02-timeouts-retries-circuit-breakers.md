---
title: Timeouts, Retries and Circuit Breakers
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Timeouts, Retries and Circuit Breakers

> **What you will be able to do after this page**
>
> - Set a timeout from data rather than from habit.
> - Retry without amplifying the failure you are retrying against.
> - Explain the three circuit-breaker states and what each is for.
> - Recognise the cascading failure these three settings either cause or prevent.

Three small settings that determine whether one slow dependency is a minor blip or a total outage. <C color="crimson">Their defaults are almost always wrong.</C>

<Plain>

You phone a supplier who does not answer.

**How long do you hold?** Hang up after five seconds and you may miss someone about to pick up. Hold for ten minutes and you have wasted your morning — and if you are the only person who can answer your own phone, <C color="crimson">everyone trying to reach *you* is now also waiting.</C> That is the crucial part: your waiting is not free for anyone else.

**Do you call back?** If the line was briefly busy, yes. But if their office is overwhelmed, <C color="orange">everyone calling back repeatedly is exactly what keeps them overwhelmed.</C> Your reasonable individual behaviour is the collective problem.

**When do you stop calling?** After the twentieth failed attempt, continuing is pointless. Better to stop, do something else, and try once in ten minutes to see whether they have recovered. That single check costs almost nothing; two hundred more calls cost them their recovery.

Three questions — how long to wait, whether to try again, and when to stop trying — and the answers determine whether **their** bad morning becomes **your** bad morning, and then your customers'.

</Plain>

---

## 1. Timeouts

<C color="crimson">The most dangerous default in software is no timeout at all.</C> A call with no timeout can hold a thread, a connection and a request slot indefinitely.

### Setting one from data

<C color="green">Do not guess. Use the dependency's observed latency distribution.</C>

```
  dependency p50  = 20 ms
  dependency p99  = 120 ms
  dependency p99.9 = 400 ms

  timeout ≈ p99.9 × 1.5  ≈  600 ms
```

Too tight and you fail requests that would have succeeded, **adding load through retries**. Too loose and you hold resources for calls that will never succeed.

| Layer | Needs its own timeout |
| :--- | :--- |
| Connection establishment | Fast — 1–3 s; a healthy server accepts immediately |
| Socket read | The main one, from the latency distribution |
| Total request (including retries) | Must fit inside the caller's own budget |
| Database query | `statement_timeout` — a runaway query holds a connection |
| Overall user-facing request | The budget everything else divides |

<H>Timeouts must shrink as you go deeper. If your API has a 2-second budget and calls a service with a 5-second timeout, your timeout is a fiction — the caller gives up while the work continues, consuming resources for a response nobody will read.</H>

<Jargon
  plain="Passing the remaining time budget along with a request, so each service knows how long it has left."
  term="deadline propagation"
  also={['request deadlines', 'timeout budget']}>

Instead of each service having its own fixed timeout, the **caller passes a deadline**. Each hop subtracts what it used and passes the remainder. <C color="green">Work guaranteed to miss the deadline is not attempted at all</C> — the single most effective way to stop wasted work under load.

</Jargon>

---

## 2. Retries

Retrying is right for **transient** failures and harmful for everything else.

| Retry | Do not retry |
| :--- | :--- |
| <C color="green">Connection refused, reset</C> | <C color="crimson">`400`, `401`, `403`, `404`, `422`</C> — deterministic |
| <C color="green">Timeout on an idempotent call</C> | <C color="crimson">Any non-idempotent call without an idempotency key</C> |
| <C color="green">`503`, `502`, `504`</C> | <C color="crimson">`501`</C> — it will never be implemented |
| <C color="green">`429` — after `Retry-After`</C> | <C color="crimson">Validation errors of any kind</C> |

<C color="crimson">Retrying a 4xx wastes capacity and will fail identically every time.</C> The 4xx/5xx split is a retry contract; honour it.

<Trace title="Retries turning a blip into an outage" subtitle="A dependency slows for 10 seconds. Watch the load it receives.">

<TraceStep
  title="Normal"
  state={{ 'Incoming': '1,000/s', 'Load on dependency': '1,000/s', 'Retries': '0', 'Dependency': 'healthy' }}
  note="Baseline. The dependency handles 1,200/s at most.">

1,000 req/s, all succeeding.

</TraceStep>

<TraceStep
  title="The dependency slows — naive retries"
  cost="3× load"
  state={{ 'Incoming': '1,000/s', 'Load on dependency': '3,000/s', 'Retries': '2 per request, immediate', 'Dependency': 'overloaded' }}
  changed={['Load on dependency', 'Retries', 'Dependency']}
  note="The retry policy did this — the incoming traffic never changed.">

Requests time out and each retries twice immediately. <C color="crimson">The struggling dependency now receives 3× its normal load</C>, guaranteeing it stays down.

</TraceStep>

<TraceStep
  title="It gets worse — retries across layers"
  cost="27× load"
  state={{ 'Incoming': '1,000/s', 'Load on dependency': '27,000/s', 'Retries': 'multiplied over 3 hops', 'Dependency': 'dead' }}
  changed={['Load on dependency', 'Retries', 'Dependency']}
  note="Retries multiply along a call chain rather than adding — the same amplification as in a service mesh.">

Three layers each retrying three times: **3 × 3 × 3 = 27×**.

</TraceStep>

<TraceStep
  title="Add exponential backoff"
  state={{ 'Incoming': '1,000/s', 'Load on dependency': 'spread over time', 'Retries': '100 ms, 200 ms, 400 ms', 'Dependency': 'recovering' }}
  changed={['Load on dependency', 'Retries', 'Dependency']}
  note="Backoff spreads retries in time, giving the dependency room to recover.">

Each retry waits longer than the last. <C color="green">Instantaneous load drops sharply.</C>

</TraceStep>

<TraceStep
  title="Backoff alone is not enough — add jitter"
  cost="synchronised waves without it"
  state={{ 'Incoming': '1,000/s', 'Load on dependency': 'smooth', 'Retries': 'randomised delays', 'Dependency': 'recovering' }}
  changed={['Load on dependency', 'Retries']}
  note="Without jitter, every client that failed at the same instant retries at the same instant — repeatedly.">

1,000 clients failing simultaneously and backing off by exactly 100 ms return as <C color="crimson">one synchronised wave</C>, then another at 200 ms.

<C color="green">Randomise: `delay = random(0, base × 2^attempt)`.</C>

</TraceStep>

<TraceStep
  title="Add a retry budget"
  state={{ 'Incoming': '1,000/s', 'Load on dependency': '≤1,100/s', 'Retries': 'capped at 10% of traffic', 'Dependency': 'recovering' }}
  changed={['Load on dependency', 'Retries']}
  note="The most robust control: retries can never become a significant fraction of load, whatever the failure rate.">

Cap retries at a **percentage of total traffic** rather than per request. Under isolated failures all retries proceed; under widespread failure the budget exhausts and retries stop automatically.

<H>Backoff and jitter shape *when* retries happen. A retry budget bounds *how many* — which is the only control that holds when everything is failing at once.</H>

</TraceStep>

</Trace>

---

## 3. Circuit breakers

When a dependency is definitively down, retrying is pure waste. A circuit breaker <C color="green">stops calling it entirely</C> and fails fast.

```
        ┌────────┐  failure threshold  ┌────────┐
        │ CLOSED │────────────────────►│  OPEN  │
        │ calls  │                     │ reject │
        │ pass   │◄────────────────────│immediately│
        └────────┘   success           └────┬───┘
             ▲                              │ after cooldown
             │       ┌───────────┐          │
             └───────│ HALF-OPEN │◄─────────┘
               ok    │ let a few │
                     │  through  │──── fail ──► back to OPEN
                     └───────────┘
```

| State | Behaviour |
| :--- | :--- |
| **Closed** | Normal. Failures counted |
| **Open** | <C color="green">Reject immediately without calling</C> — fail in microseconds, not after a timeout |
| **Half-open** | After a cooldown, allow a few probes. Success closes it; failure reopens it |

<C color="green">The open state is what protects both sides.</C> The caller stops wasting threads on calls that will time out, and the failing dependency gets breathing room to recover instead of being hammered.

**Tuning:** open after a **failure rate** over a rolling window (say 50% of at least 20 requests), not a raw count — a raw count trips on low traffic. Cooldown of 5–30 seconds. Half-open with a small, capped number of probes.

<C color="crimson">Always pair a breaker with a fallback.</C> An open breaker fails fast — which is still a failure unless you have something to serve instead: cached data, a default, or a degraded response.

<Depth title="How a cascading failure actually unfolds">

Cascading failure is the mechanism behind most large outages, and it follows a repeatable script. Recognising it early is the difference between a five-minute blip and a two-hour incident.

**The script:**

1. **One dependency slows.** Not down — slow. p99 goes from 100 ms to 5 s.
2. **Callers' threads block.** A service with 200 threads calling it synchronously now has all 200 waiting.
3. **The caller stops serving anything.** Including requests that never touch the slow dependency — <C color="crimson">this is the moment a local problem becomes a global one.</C>
4. **The caller's callers block**, for the same reason. The failure climbs the dependency graph.
5. **Health checks fail.** Load balancers eject instances. Traffic concentrates on fewer instances, which fail faster.
6. **Retries multiply the load** on everything already struggling.
7. **Recovery is impossible** while retries consume the capacity recovery needs.

<H>Step 3 is the critical transition. A slow dependency becomes a total outage because the caller's thread pool is a shared resource, and one dependency consumed all of it.</H>

**Where to break the chain, in order of effectiveness:**

**Bulkheads (step 3).** Separate thread pools or concurrency limits **per dependency**. The slow one exhausts its own pool of 50; the other 150 threads keep serving everything else. <C color="green">This single change prevents most cascades</C>, and it is the least-used of the techniques here.

**Timeouts (step 2).** A 500 ms timeout means a thread blocks for 500 ms, not 5 seconds — a 10× reduction in resource consumption per failed call.

**Circuit breakers (steps 4–6).** Once open, calls fail in microseconds. Threads are never consumed at all.

**Load shedding (step 5).** Reject excess work at the edge so instances stay healthy enough to pass health checks and keep serving reduced traffic.

**Retry budgets (step 6).** Cap total retry volume so recovery capacity is not consumed.

**Why recovery is hard once you are in it.** Fixing the original dependency is not enough:

- **Queued work** from the outage arrives all at once.
- **Every client's retries** fire simultaneously — a thundering herd.
- **Caches are cold**, so the restored dependency faces full load with none of its usual protection.
- **Connection pools** must re-establish, and re-establishment itself is load.

<C color="green">Recovery therefore requires deliberately serving less than capacity while things warm up</C>: shed aggressively, ramp traffic gradually, warm caches before accepting full load, and keep retries suppressed until things stabilise. Restoring 100% of traffic to a just-recovered system is the classic way to cause a second outage immediately after the first.

</Depth>

---

## 4. Defaults worth adopting

| Setting | Sensible default |
| :--- | :--- |
| Connect timeout | 1–3 s |
| Read timeout | p99.9 of the dependency × 1.5 |
| Retries | 2 attempts maximum, **only** for idempotent operations |
| Backoff | Exponential from ~100 ms, **with full jitter** |
| Retry budget | ≤10% of request volume |
| Circuit breaker | Open at 50% failures over 20+ requests; 10 s cooldown |
| Bulkhead | A separate concurrency limit per dependency |
| Deadline | Propagated, checked before each downstream call |

<C color="crimson">The single most valuable change in most systems is adding timeouts where there are none</C> — followed by bulkheads, which prevent the transition that turns a slow dependency into a total outage.

---

## 5. In a design discussion

- **"Timeout from the dependency's p99.9 times 1.5, and it must fit inside our own request budget — otherwise it's fiction."** Sets it from data with the nesting constraint.
- **"Two retries with exponential backoff and full jitter, plus a budget capping retries at 10% of traffic. Backoff shapes when; the budget bounds how many."** The distinction that matters.
- **"Separate concurrency limits per dependency, so a slow payment provider can't consume every thread and fail requests that never touch it."** The bulkhead answer.
- **"Recovery needs a gradual ramp — restoring full traffic sends every queued retry at once into a cold cache."** Shows you have seen the second outage.

---

## Rapid-fire recall

1. Why is having no timeout the most dangerous default?
2. How do you set a read timeout from data?
3. Why must timeouts shrink as you go deeper, and what happens if they do not?
4. What is deadline propagation, and what does it prevent?
5. Which failures should be retried and which must not be?
6. Why do retries multiply rather than add across a call chain?
7. What does jitter fix that backoff alone does not?
8. Why is a retry budget more robust than backoff and jitter?
9. Name the three circuit breaker states, and what half-open is for.
10. Which step turns a slow dependency into a total outage, and what prevents it?

<details>
<summary>Answers</summary>

1. Because a call can **hold a thread, connection and request slot indefinitely**, so one slow dependency consumes the caller's entire capacity — including for requests that never touch it.
2. From the dependency's **observed latency distribution** — roughly **p99.9 × 1.5**. Too tight fails requests that would have succeeded (adding retry load); too loose holds resources for calls that will never succeed.
3. Because a caller's timeout bounds the whole operation. If your budget is 2 s and you call a service with a 5 s timeout, **you give up while the work continues** — consuming resources for a response nobody will read.
4. Passing the **remaining time budget** with each request, so each hop subtracts what it used. It prevents work that **cannot possibly finish in time** from being attempted at all.
5. **Retry**: connection refused/reset, timeouts on idempotent calls, `502`/`503`/`504`, `429` after `Retry-After`. **Do not retry**: `400`, `401`, `403`, `404`, `422`, `501`, or any non-idempotent call without an idempotency key.
6. Because each layer retries the layer below, so attempts compound: 3 retries over 3 hops is **3 × 3 × 3 = 27×**, not 9×.
7. Clients that failed at the same instant back off by the **same** interval and return as a **synchronised wave**. Jitter randomises the delay so retries spread out.
8. Because backoff and jitter shape **when** retries happen but not **how many**. A budget caps retries as a fraction of total traffic, so under widespread failure they **stop automatically** rather than amplifying.
9. **Closed** (normal, counting failures) · **open** (reject immediately without calling) · **half-open** (after cooldown, allow a few probes — success closes, failure reopens). Half-open is how it tests recovery without resuming full load.
10. **Step 3** — the caller's shared thread pool is exhausted by the slow dependency, so it stops serving *everything*, including unrelated requests. **Bulkheads** — separate concurrency limits per dependency — prevent it.

</details>

---

**Next:** [Graceful Degradation](./03-graceful-degradation.md) — being partly useful instead of entirely broken.
