---
title: Backpressure and Flow Control
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Backpressure and Flow Control

> **What you will be able to do after this page**
>
> - Say what a system should do when it genuinely cannot keep up.
> - Explain why an unbounded queue guarantees eventual failure.
> - Choose between blocking, dropping and shedding, per workload.
> - Recognise the moment a system stops recovering on its own.

Every system has a limit. <C color="orange">The question is not whether you reach it, but what happens on the way</C> — and the default behaviour of most systems is the worst available option.

<Plain>

A café has one barista and a queue that can grow as long as the street allows.

At lunchtime, customers arrive faster than coffee can be made. Three things could happen.

**The queue simply grows.** Nobody is turned away. The wait reaches forty minutes. People at the back ordered coffee they no longer want and have somewhere else to be — <C color="crimson">the barista is working flat out serving drinks to people who left.</C> Every cup made is wasted effort, and the queue keeps growing.

**The barista says "we're full, come back in ten minutes".** Some people are turned away, immediately and clearly. <C color="green">Everyone who stays gets coffee at a reasonable speed.</C> Those turned away are annoyed, and they found out in five seconds rather than after forty minutes.

**The door only admits people when there is room inside.** The queue outside builds instead — but it builds *somewhere that can afford it*, and the street can be seen. The problem is visible rather than hidden.

The middle option feels rudest and is almost always right. <C color="orange">The first option looks like the kind one and is actually the cruellest</C>: everybody waits, most people get nothing useful, and the barista's entire afternoon is spent on work that no longer matters.

<H>Accepting work you cannot complete is not generosity. It is a way of failing everyone slowly instead of failing some people quickly.</H>

</Plain>

---

## 1. Unbounded queues always fail

A queue with no limit looks like a safety feature. It is a way of converting an overload into a much worse overload, later.

```
  arrival 1,000/s, capacity 900/s

  after  1 min:      6,000 queued    latency ~7 s
  after 10 min:     60,000 queued    latency ~67 s
  after  1 hour:   360,000 queued    latency ~7 min
  after  1 day:  8,640,000 queued    latency ~2.7 hours
```

Three things go wrong at once:

**Latency grows without bound.** By hour two, results are useless even when they arrive.

**Memory or disk fills**, and the failure lands somewhere unrelated — an OOM kill, or a full disk taking down a co-located service.

<C color="crimson">**The work becomes worthless.**</C> A user who waited seven minutes has given up and retried, so completing their original request produces nothing except more load.

<Jargon
  plain="Telling whoever is sending you work to slow down, instead of silently accepting more than you can handle."
  term="backpressure"
  also={['flow control', 'push-back']}>

The essential idea: <C color="green">the limit must be visible to the sender.</C> A system that accepts everything and buffers it has removed the signal that would have let anyone react — which is why unbounded queues are dangerous rather than generous.

</Jargon>

---

## 2. The four responses to overload

<Trace title="A service at 130% of capacity" subtitle="Same overload, four different designs. Watch what users experience.">

<TraceStep
  title="Baseline"
  state={{ 'Arrival': '1,300/s', 'Capacity': '1,000/s', 'Strategy': '—', 'p99 latency': '50 ms', 'Useful work/s': '1,000' }}
  note="Traffic has just risen 30% above what this service can serve.">

Capacity is 1,000 req/s. Traffic is now 1,300 req/s and will stay there.

</TraceStep>

<TraceStep
  title="Response 1 — buffer everything"
  cost="collapse"
  state={{ 'Arrival': '1,300/s', 'Strategy': 'unbounded queue', 'p99 latency': 'growing → minutes', 'Useful work/s': '→ 0' }}
  changed={['Strategy', 'p99 latency', 'Useful work/s']}
  note="Useful work falls to zero even though the server is 100% busy — every completed request is for a client that gave up.">

The queue grows by 300/s. Latency climbs past client timeouts, so clients retry, <C color="crimson">adding load and pushing arrival higher still.</C>

</TraceStep>

<TraceStep
  title="Response 2 — bounded queue, reject when full"
  state={{ 'Arrival': '1,300/s', 'Strategy': 'bounded + 429', 'p99 latency': '80 ms', 'Useful work/s': '1,000' }}
  changed={['Strategy', 'p99 latency', 'Useful work/s']}
  note="Load shedding. 23% of requests fail fast; 77% are served properly.">

The queue caps at 1,000. Beyond that, requests get an immediate `429` with `Retry-After`.

<C color="green">Latency stays flat and 1,000 req/s are served correctly.</C> 300/s are rejected in under a millisecond.

</TraceStep>

<TraceStep
  title="Response 3 — block the sender"
  state={{ 'Arrival': 'throttled to 1,000/s', 'Strategy': 'backpressure', 'p99 latency': '50 ms', 'Useful work/s': '1,000' }}
  changed={['Arrival', 'Strategy', 'p99 latency']}
  note="Best when the sender is a system you control — a batch job, a pipeline stage, a stream consumer.">

The consumer stops requesting more work until it has room. The producer slows to match.

<C color="green">The queue never grows and nothing is lost</C> — the backlog builds at the source, where it is visible and affordable.

</TraceStep>

<TraceStep
  title="Response 4 — drop the oldest"
  state={{ 'Arrival': '1,300/s', 'Strategy': 'drop oldest', 'p99 latency': '50 ms', 'Useful work/s': '1,000 (freshest)' }}
  changed={['Strategy', 'Useful work/s']}
  note="Right when newer data supersedes older — metrics, sensor readings, position updates, live prices.">

The queue is bounded, and a full queue **discards the oldest entry** to admit the newest.

<C color="green">You always process the freshest data</C>, which for telemetry is exactly right — a stale reading has no value.

</TraceStep>

<TraceStep
  title="The comparison that matters"
  state={{ 'Buffer everything': '0 useful/s', 'Shed load': '1,000 useful/s', 'Backpressure': '1,000 useful/s', 'Drop oldest': '1,000 useful/s' }}
  changed={['Buffer everything', 'Shed load', 'Backpressure', 'Drop oldest']}
  note="The kind-looking option is the only one that fails completely.">

<H>Three strategies deliver full capacity under overload. The one that accepts everything delivers nothing — and it is the default in almost every system nobody has thought about this in.</H>

</TraceStep>

</Trace>

---

## 3. Choosing a strategy

| Workload | Strategy | Why |
| :--- | :--- | :--- |
| User-facing HTTP request | <C color="green">Shed load — `429`/`503` + `Retry-After`</C> | Fast failure beats a long wait |
| Internal pipeline stage | <C color="green">Backpressure</C> | The producer can slow down; nothing is lost |
| Metrics, logs, telemetry | <C color="green">Drop — oldest or sampled</C> | Volume is high, individual items are cheap |
| Live position or price updates | <C color="green">Drop oldest</C> | Newer supersedes older |
| Orders, payments | <C color="green">Bounded queue, shed at the edge</C> | Never drop silently; reject visibly so the client can retry |
| Batch ingest | <C color="green">Backpressure</C> | The source can wait; correctness matters more than speed |

<C color="crimson">Never drop silently on anything that matters.</C> Rejecting with `429` tells the client to retry; dropping tells them nothing, and the work is simply lost with no record.

### Shedding well

Not all requests are equally valuable. Under overload, shed the cheapest to lose:

```
  1. shed  background/batch and prefetch requests
  2. shed  anonymous traffic before authenticated
  3. shed  retries before first attempts
  4. shed  expensive endpoints before cheap ones
  5. never shed  health checks, or you eject yourself from the load balancer
```

That last line is a real production failure: an overloaded service starts rejecting everything including its own health checks, the load balancer removes it, remaining traffic concentrates on fewer instances, and <C color="crimson">the shedding cascades until nothing is left.</C>

---

## 4. Backpressure in practice

The mechanism differs by layer, but the shape is identical — **the consumer controls the rate**.

| Layer | Mechanism |
| :--- | :--- |
| TCP | Receive window — the receiver advertises how much it can take |
| HTTP/2, gRPC | Per-stream flow control windows |
| Kafka | Consumer **pulls**; it simply asks for less |
| Reactive streams | `request(n)` — the subscriber demands a specific amount |
| Thread pools | Bounded queue + `CallerRunsPolicy`, which slows the submitter |
| Your own code | A bounded channel, a semaphore, a concurrency cap |

<H>Notice that pull-based systems get backpressure for free. A consumer that fetches when ready cannot be overwhelmed; a producer that pushes can overwhelm anything. That is the strongest architectural argument for pull-based designs.</H>

<Depth title="Why overload does not recover on its own">

The dangerous property of overload is that it is often **self-sustaining**: removing the original trigger does not restore service. Three mechanisms drive this, and all three are feedback loops.

**1. Retry amplification.** Requests time out, clients retry, and the retries add load. At 130% capacity with clients retrying three times, effective arrival becomes ~390% — <C color="crimson">so the system stays overloaded even after the original spike ends.</C> This is the [same amplification](../03-traffic-and-edge/05-service-mesh.md) as mesh retries, arriving from the client side.

Fixes: **retry budgets** (retries capped as a fraction of traffic), **exponential backoff with jitter**, and **circuit breakers** that stop retrying entirely for a cooldown.

**2. Queueing cost exceeding service cost.** Near saturation, more time is spent managing queued work — context switching, cache misses from too many concurrent connections, garbage collecting queued objects — than doing it. <C color="crimson">Goodput (useful work completed) actually *falls* as load rises past the knee.</C>

This is why a bounded queue matters more than a large one. A queue of 10,000 does not help a service that can only hold 100 in flight; it just means 9,900 requests wait past their timeout before being served.

**3. Work that has already expired.** Requests still in the queue past the client's timeout are worthless. Processing them consumes capacity that could serve live requests.

<C color="green">The fix is a deadline carried with each request.</C> On dequeue, check whether it is still wanted:

```
  if (now > request.deadline) { drop it; continue; }
```

Under overload this **automatically** discards dead work and lets the system catch up. Deadline propagation across services makes it work end to end — a downstream call that cannot finish within the remaining budget is not attempted at all.

**How to escape overload once you are in it.** Recovery requires deliberately serving less than capacity for a while:

1. **Shed aggressively** — more than the overload requires, to build headroom.
2. **Stop retries** at the edge, or the amplification continues.
3. **Drain expired work** rather than processing it.
4. **Restore gradually** — a slow ramp, not an instant restoration, or you re-enter overload immediately as the pent-up demand arrives at once.

<C color="orange">Step 4 catches people out.</C> Restoring full traffic to a just-recovered service sends the accumulated backlog and every client's queued retries simultaneously, pushing it straight back into overload — the same **thundering herd** as a [cold cache](../07-caching/04-cache-failure-modes.md) or a WebSocket reconnect storm.

<H>The general principle: a system under overload cannot recover by trying harder. It recovers by accepting less, and the mechanisms that make that automatic — bounded queues, deadlines, load shedding, circuit breakers — must be built before you need them.</H>

</Depth>

---

## 5. In a design discussion

- **"Bounded queue with a `429` and `Retry-After` when full. An unbounded queue converts overload into a much worse overload later."** The core point.
- **"Deadlines on requests, checked at dequeue — under overload we drop work nobody is waiting for any more."** The mechanism most designs lack.
- **"Shed batch and anonymous traffic first, and never shed health checks, or we eject ourselves from the load balancer."** A specific real failure.
- **"Recovery needs a gradual ramp — restoring full traffic instantly sends every queued retry at once and we go straight back into overload."** Shows you have watched this happen.

---

## Rapid-fire recall

1. Give three things that go wrong with an unbounded queue.
2. Compute the backlog after one hour at 1,000/s arrival and 900/s capacity.
3. Define backpressure, and say what makes it work.
4. Name the four responses to overload and the useful throughput of each.
5. Why is "buffer everything" the worst option despite looking kindest?
6. When is dropping the oldest message correct?
7. Give the shedding priority order, and the one thing never to shed.
8. Why do pull-based systems get backpressure for free?
9. Name the three feedback loops that make overload self-sustaining.
10. Give the four steps to escape overload, and why the last one matters.

<details>
<summary>Answers</summary>

1. **Latency grows without bound** (results become useless) · **memory or disk fills**, failing somewhere unrelated · **the work becomes worthless** because clients have given up and retried.
2. 100/s accumulating × 3,600 s = **360,000 queued**, giving roughly **7 minutes** of latency.
3. Signalling the sender to slow down instead of silently accepting more than you can handle. It works because **the limit becomes visible to the sender** — a system that buffers everything has destroyed that signal.
4. **Buffer everything** → 0 useful/s. **Shed load** → full capacity. **Backpressure** → full capacity. **Drop oldest** → full capacity, freshest data.
5. Because it serves nobody: latency exceeds client timeouts, so every completed request is for a client that already gave up, while retries push arrival even higher. **Useful throughput falls to zero while the server is 100% busy.**
6. When **newer data supersedes older** — metrics, sensor readings, live positions, price ticks. A stale reading has no value, so discarding it costs nothing.
7. Shed **batch/prefetch** → **anonymous before authenticated** → **retries before first attempts** → **expensive before cheap**. **Never shed health checks** — you will be ejected from the load balancer and the shedding will cascade.
8. Because the **consumer controls the rate** — it fetches only when ready, so it cannot be overwhelmed. A pushing producer can overwhelm any consumer.
9. **Retry amplification** (retries multiply load, sustaining overload after the trigger ends) · **queueing cost exceeding service cost** (goodput falls as load rises past the knee) · **expired work** consuming capacity that live requests need.
10. **Shed aggressively** (build headroom) → **stop retries at the edge** → **drain expired work** → **restore gradually**. The last matters because instant restoration delivers the entire accumulated backlog and every queued retry simultaneously, pushing you straight back into overload.

</details>

---

**Next:** [Event-Driven Architecture](./05-event-driven-architecture.md) — designing around things that happened.
