---
title: Capacity Planning
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Capacity Planning

> **What you will be able to do after this page**
>
> - Find your actual bottleneck instead of guessing at it.
> - Choose a utilisation target and defend the number.
> - Say what autoscaling cannot do for you.
> - Design a load test that measures something real.

Capacity planning is deciding how much to buy before you need it, <C color="orange">using measurements rather than intuition</C> — because intuition about where systems run out is reliably wrong.

<Plain>

A road is being widened to reduce congestion.

Before spending anything, the sensible question is: **where does the traffic actually stop?** If the jam is caused by a single narrow bridge, adding lanes on either side achieves nothing — cars simply reach the bridge faster and wait there.

<C color="orange">Every road has exactly one narrowest point at a time</C>, and only work on that point improves anything. Widen it, and the jam moves somewhere else, which is the correct outcome — you now have a new narrowest point and a new question.

The second question is how much capacity to build. Sizing for the average is obviously wrong; sizing for the absolute worst imaginable day means building something enormous that sits empty. So you size for a realistic peak, plus margin, and you accept that on the very worst day it will be slow.

And the third question is the one people skip: <C color="crimson">how do you know how much the road actually carries?</C> Not the number from the design documents — the number it carries today, with today's junctions and today's traffic mix. That is measured by deliberately loading it until it fails, which nobody enjoys doing and which is the only way to know.

</Plain>

---

## 1. Find the bottleneck first

<Jargon
  plain="The one component that limits the whole system's throughput. There is always exactly one."
  term="the bottleneck"
  also={['the constraint', 'the limiting resource']}>

<C color="green">Only work on the bottleneck improves the system.</C> Optimising anything else moves work to the bottleneck faster and changes nothing — a fact that makes "find it before optimising" the highest-value rule in performance work.

</Jargon>

**The candidates, and how to tell:**

| Resource | Symptom | Check |
| :--- | :--- | :--- |
| **CPU** | Utilisation near 100%, run queue growing | `top`, load average, CPU throttling |
| **Memory** | Swapping, OOM kills, GC pressure | RSS vs limit, GC pause time |
| **Disk I/O** | High iowait, queue depth | `iostat`, await time |
| **Network** | Bandwidth saturated, retransmits | Interface counters, packet loss |
| **Connections** | Requests waiting for a pool slot | Pool wait time, `max_connections` |
| **Locks / hot rows** | CPU low, latency high, contention visible | DB lock waits, mutex profiling |
| **A downstream service** | Your CPU idle, latency tracks theirs | Dependency latency correlation |

<C color="crimson">The most commonly missed bottleneck is not a resource at all — it is a connection pool or a lock.</C> The symptom is distinctive: **latency rises while every utilisation graph looks healthy**. If CPU, memory, disk and network are all comfortable and requests are still slow, you are waiting on a queue somewhere.

<Trace title="Finding the real bottleneck" subtitle="A service that slows under load. Watch each hypothesis get tested.">

<TraceStep
  title="The symptom"
  state={{ 'p99': '2,400 ms', 'CPU': '35%', 'Memory': '40%', 'Hypothesis': 'need more servers?' }}
  changed={['p99', 'CPU', 'Memory']}
  note="The instinct is to scale out. Note that CPU is idle — that instinct is already suspect.">

Latency is bad. The obvious move is to add instances.

</TraceStep>

<TraceStep
  title="Add instances — nothing improves"
  cost="wasted spend"
  state={{ 'p99': '2,350 ms', 'CPU': '18%', 'Instances': 'doubled', 'Hypothesis': 'not compute' }}
  changed={['p99', 'CPU', 'Instances', 'Hypothesis']}
  note="Classic confirmation that you were not compute-bound. CPU went down; latency did not.">

Doubling the fleet moves latency by 2%. <C color="crimson">You have doubled the bill and fixed nothing.</C>

</TraceStep>

<TraceStep
  title="Check the database"
  state={{ 'p99': '2,350 ms', 'DB CPU': '25%', 'DB slow queries': 'none', 'Hypothesis': 'not the DB engine' }}
  changed={['DB CPU', 'DB slow queries', 'Hypothesis']}
  note="Queries are fast when they run. So the time is being spent before they run.">

Query times are fine and the database is not busy.

</TraceStep>

<TraceStep
  title="Check the connection pool"
  cost="found it"
  state={{ 'p99': '2,350 ms', 'Pool size': '20', 'Pool wait time': '2,100 ms', 'Hypothesis': 'CONFIRMED' }}
  changed={['Pool size', 'Pool wait time', 'Hypothesis']}
  note="2.1 s of the 2.35 s p99 is spent waiting for a connection — not doing work.">

Requests wait an average of **2.1 seconds** for a free connection. <C color="green">The bottleneck is a pool of 20 against a workload needing far more.</C>

</TraceStep>

<TraceStep
  title="Size it with Little's Law"
  state={{ 'p99': '180 ms', 'Pool size': '150', 'Pool wait time': '~5 ms', 'Instances': 'back to original' }}
  changed={['p99', 'Pool size', 'Pool wait time', 'Instances']}
  note="700 req/s × 0.2 s ≈ 140 concurrent. One config value, no extra hardware.">

Raise the pool to 150 (with the database's `max_connections` raised to match, or a proxy in front).

<H>A configuration change fixed what doubling the fleet could not — and the fleet is scaled back down. The bottleneck was never the resource everyone assumed.</H>

</TraceStep>

</Trace>

---

## 2. Choosing a utilisation target

<C color="green">Target 60–70% of measured capacity at peak.</C> The reasons compound:

| Reason | Headroom needed |
| :--- | :--- |
| [Queueing goes non-linear](./01-latency-and-throughput.md) near saturation | The main reason |
| Traffic is bursty — the peak minute exceeds the peak hour | 10–20% |
| Instance failures shift load onto survivors | `1/N` of the fleet |
| Deploys temporarily reduce capacity | One instance's worth |
| Growth between planning cycles | Depends on cadence |

<C color="crimson">The failure-shift term is the one people forget.</C> With 4 instances at 75% each, losing one puts the remaining three at 100% — and they fail, cascading. With 10 instances at 75%, losing one takes the rest to 83%: survivable. <C color="orange">Smaller fleets need more headroom per instance</C>, which is a genuine argument for more, smaller instances.

---

## 3. Autoscaling, and what it cannot do

Autoscaling is valuable and routinely over-trusted.

| It handles | It does not handle |
| :--- | :--- |
| <C color="green">Predictable daily and weekly cycles</C> | <C color="crimson">Instant spikes — it reacts too slowly</C> |
| <C color="green">Gradual growth</C> | <C color="crimson">Bottlenecks that are not the scaled tier</C> |
| <C color="green">Cost reduction in quiet periods</C> | <C color="crimson">Stateful components</C> |
| <C color="green">Absorbing instance failures</C> | <C color="crimson">Downstream capacity you don't control</C> |

**Why it is too slow for spikes.** Detect (30–60 s of metrics) → decide (cooldown) → provision (30–60 s) → boot and warm (30 s to minutes) → pass health checks. <C color="crimson">Two to five minutes is typical</C>, and a flash sale or a viral post does its damage in the first thirty seconds.

<C color="green">For known spikes, pre-scale on a schedule.</C> For unknown ones, keep headroom and shed load — autoscaling is not a substitute for either.

**And scaling one tier moves the bottleneck.** Tripling app servers triples database connections; if the database was the constraint, <C color="crimson">autoscaling actively accelerates the outage.</C> Autoscaling policies should be capped at what downstream dependencies can absorb.

<Depth title="Load testing that measures something true">

Most load tests measure the load generator. Getting a real number requires avoiding several specific traps.

**1. Use an open workload model.** A **closed** model has N virtual users each waiting for a response before sending again — so when the system slows, the test **sends less load**, and you never see behaviour beyond the knee. An **open** model sends at a fixed arrival rate regardless of responses, which is how real traffic behaves. <C color="crimson">Closed-model tests systematically under-report tail latency</C> — this is [coordinated omission](./01-latency-and-throughput.md) again, and it is why wrk2 and Gatling's open model exist.

**2. Test with realistic data volume.** A query against 10,000 rows and the same query against 100 million behave completely differently: the index no longer fits in memory, the plan may change, and cache hit ratios collapse. <C color="crimson">A load test against a small dataset measures nothing useful.</C>

**3. Test with a realistic access distribution.** Uniformly random keys defeat every cache you have, making results pessimistic. A single hot key makes them optimistic. Model the actual distribution — usually [Zipf-like](../07-caching/01-caching-fundamentals.md).

**4. Include the think time and the mix.** Real users pause between actions and use many endpoints. Hammering one endpoint at maximum rate tells you that endpoint's ceiling, not the system's.

**5. Warm up first, and measure separately.** JIT compilation, connection pools and caches all need to reach steady state. Discard the first minutes rather than averaging them in.

**The four test types, and what each answers:**

| Test | Question |
| :--- | :--- |
| **Load test** | Does it meet SLOs at expected peak? |
| **Stress test** | <C color="green">Where does it break, and how?</C> |
| **Soak test** | Does it survive 24+ hours? (Finds leaks, disk fill, connection exhaustion) |
| **Spike test** | Does it survive a sudden 10× and recover? |

<C color="orange">The stress test is the one that produces your capacity number.</C> Load tests confirm you are fine today; stress tests tell you the ceiling, and — more usefully — **how** it fails. Does it degrade, shed load, or collapse? Do error rates rise gracefully or does the whole thing stop? That behaviour is what you are actually planning against.

**Read the failure, not just the number.** A system that hits 5,000 req/s then collapses to zero is worse than one that hits 4,000 and holds there under further load. <C color="green">The second is safe to run near its limit; the first is not</C> — and no load test that stops at the SLO threshold would ever reveal the difference.

</Depth>

---

## 4. A working procedure

1. **Measure current peak** — requests/second, at the busiest minute, not the busiest hour.
2. **Stress test to find real capacity**, on production-like data.
3. **Divide**: `headroom = capacity / peak`. Below 1.4, act now.
4. **Project growth** to the next planning cycle, plus known events.
5. **Identify the next bottleneck** — the one you will hit *after* fixing this one.
6. **Decide the lever**: optimise, scale vertically, scale horizontally, or shed.
7. **Re-measure after every change**, because the bottleneck has moved.

<H>Step 5 is what separates planning from firefighting. There is always a next bottleneck, and knowing what it is turns a surprise into a scheduled piece of work.</H>

---

## 5. In a design discussion

- **"CPU is at 35% and latency is 2 seconds — that is not a compute problem. I would look at connection pool wait time before adding instances."** The diagnosis that saves money.
- **"70% utilisation target: with 6 instances, losing one takes the rest to 84%, which stays under the queueing knee."** Derives the number.
- **"Autoscaling takes two to five minutes end to end, so it cannot handle a flash sale. We pre-scale for known events and shed for unknown ones."** Knows the limit.
- **"Stress test with an open workload model on production-sized data — a closed model stops sending load when we slow down and hides the tail entirely."** Methodological rigour.

---

## Rapid-fire recall

1. Why does optimising anything other than the bottleneck achieve nothing?
2. What is the distinctive symptom of a connection-pool or lock bottleneck?
3. In the trace, why did doubling the fleet fail, and what fixed it?
4. Give five reasons to target 60–70% utilisation.
5. Why do smaller fleets need more headroom per instance?
6. Why is autoscaling too slow for a spike? Break down the time.
7. How can autoscaling accelerate an outage?
8. What is a closed workload model, and what does it hide?
9. Why does a load test on a small dataset measure nothing useful?
10. Why is a system that plateaus at 4,000 req/s safer than one peaking at 5,000?

<details>
<summary>Answers</summary>

1. Because the bottleneck sets total throughput. Improving anything else only **delivers work to the bottleneck faster**, where it queues — total throughput is unchanged.
2. **Latency rises while every utilisation graph looks healthy.** If CPU, memory, disk and network are all comfortable and requests are slow, you are waiting on a queue.
3. Because the system was **not compute-bound** — CPU fell and latency did not. The fix was raising the **connection pool** from 20 to 150 (sized with Little's Law), a configuration change requiring no extra hardware.
4. **Queueing goes non-linear near saturation** · traffic is bursty (peak minute exceeds peak hour) · **instance failures shift load onto survivors** · deploys temporarily reduce capacity · growth between planning cycles.
5. Because losing one instance shifts `1/N` of the load onto the rest. With 4 instances at 75%, losing one puts the others at **100%**; with 10 at 75%, losing one takes them to **83%**.
6. Detect (30–60 s of metrics) → decide (cooldown) → provision (30–60 s) → boot and warm (30 s to minutes) → pass health checks. **Two to five minutes** — and a spike does its damage in the first thirty seconds.
7. By **scaling one tier into a downstream bottleneck** — tripling app servers triples database connections, so if the database was the constraint, autoscaling makes the overload worse.
8. N virtual users each **waiting for a response before sending again**. When the system slows, the test **sends less load**, so it never explores behaviour past the knee and systematically **under-reports tail latency**.
9. Because behaviour changes qualitatively with data volume — the index no longer fits in memory, query plans change, and cache hit ratios collapse. The small-data result does not predict the large-data one.
10. Because it **degrades predictably and holds** under further load, so it is safe to run near its limit. The system that collapses to zero past its peak has no safe operating margin — and a load test stopping at the SLO threshold would never reveal the difference.

</details>

---

**Next:** [Performance Optimisation](./03-performance-optimisation.md) — where the time actually goes.
