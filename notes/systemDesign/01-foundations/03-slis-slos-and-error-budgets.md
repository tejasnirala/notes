---
title: SLIs, SLOs & Error Budgets
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# SLIs, SLOs & Error Budgets

> **What you will be able to do after this page**
>
> - Tell an SLI from an SLO from an SLA without hesitating.
> - Convert any number of nines into minutes of downtime, in your head.
> - Explain why 100% availability is the wrong target — and why that is an engineering argument, not an excuse.
> - Compute an error budget and use it to settle a "ship it or harden it" argument with a number.
> - Compute the availability of components in series and in parallel, and see why adding dependencies quietly destroys reliability.

"It should be reliable" is not a requirement. This page turns it into arithmetic.

<Plain>

Imagine a courier promising *"we always deliver on time."* It sounds great, and it is not a promise anyone can keep. Vans break down. Roads flood.

So real couriers promise something different: *"98% of parcels arrive next day."* That is honest, measurable, and — importantly — it tells everyone inside the company **how much lateness they are allowed** before they have to stop everything and fix the problem.

That allowance turns out to be surprisingly useful. If you are well inside it, you can try the new route that might be faster. If you have used it all up, you stop experimenting and drive the safe route until things recover.

This page is that idea, applied to software. Instead of the impossible promise "it never breaks", you pick a number, measure against it, and treat the gap as **a budget you are allowed to spend on taking risks**. Everything else here is arithmetic on top of that one idea.

</Plain>

---

## 1. The three acronyms

They are usually confused, and the distinction is simple: one is a **measurement**, one is a **goal**, one is a **contract**.

```
   SLI  ── a number you measure          "99.94% of requests succeeded last month"
    │
    ▼
   SLO  ── the target you hold it to     "99.9% of requests must succeed"
    │
    ▼
   SLA  ── what you owe if you miss      "below 99.5%, customers get 10% credit"
```

<Jargon
  plain="A measurement, a target for that measurement, and a promise to customers about it."
  term="SLI, SLO, SLA"
  also={['service level indicator / objective / agreement']}>

Three words that get used interchangeably and should not be. The quick test: <C color="orange">an SLI is a **number you measure**, an SLO is a **number you aim at**, an SLA is a **number you owe money over**.</C>

</Jargon>

### SLI — Service Level *Indicator*

A metric that reflects user experience. Good SLIs are ratios of *good events* to *valid events*, because ratios are comparable across traffic levels.

| SLI type | Definition |
| :--- | :--- |
| **Availability** | successful requests ÷ total requests |
| **Latency** | requests faster than 200 ms ÷ total requests |
| **Quality** | requests served with full functionality ÷ total (degraded responses count as failures) |
| **Freshness** | records updated within 5 minutes ÷ total records |
| **Correctness** | records processed without error ÷ total records |

Choose SLIs the *user* would recognise. CPU utilisation is not an SLI — no user has ever noticed CPU. They notice slow and broken.

### SLO — Service Level *Objective*

Your internal target for an SLI, over a window. Always three parts: **indicator, threshold, window**.

> 99.9% of HTTP requests return non-5xx **over a rolling 28-day window**.
> 95% of timeline reads complete in under 200 ms **over a rolling 28-day window**.

Without a window the number is meaningless — 99.9% over a year and 99.9% over an hour are wildly different promises.

### SLA — Service Level *Agreement*

A contract with customers containing financial consequences. <H>**Always set your SLA looser than your SLO.**</H> The SLO is the alarm; the SLA is the fire. You want to be paging engineers well before you are refunding money.

> Typical: SLA 99.5%, SLO 99.9%. That gap is your warning track.

Internal services often have SLIs and SLOs and no SLA at all — nobody is paying you, so there is nothing to refund.

---

## 2. Nines, in minutes

The table worth memorising. The window matters enormously, and this is where intuition usually fails.

| Availability | Downtime / year | / month (30 d) | / week | / day |
| :--- | :--- | :--- | :--- | :--- |
| **90%** (one nine) | 36.5 days | 72 h | 16.8 h | 2.4 h |
| **99%** (two) | 3.65 days | 7.2 h | 1.68 h | 14.4 min |
| **99.9%** (three) | 8.77 h | 43.8 min | 10.1 min | 1.44 min |
| **99.95%** | 4.38 h | 21.9 min | 5 min | 43 s |
| **99.99%** (four) | 52.6 min | 4.38 min | 1 min | 8.6 s |
| **99.999%** (five) | 5.26 min | 26 s | 6 s | 0.86 s |

Two things to take from this:

**Three nines is generous; four nines is hard; five nines is a different sport.** At 99.99% you have 4 minutes of budget *per month*. A human cannot read a page, open a laptop and diagnose anything in 4 minutes. Four nines requires automated failover. Five nines requires that no human is ever in the recovery path, and usually that you own your infrastructure.

<C color="orange">**Each nine costs roughly 10× the last.**</C> Going 99% → 99.9% might be a load balancer and a replica. 99.9% → 99.99% is multi-AZ, automated failover, and rehearsed runbooks. 99.99% → 99.999% is multi-region active-active, a dedicated reliability team, and a business that can justify it.

> Ask which nine the business actually needs. Most consumer products are fine at three. Paying for five because it sounds impressive is one of the most expensive mistakes available.

---

## 3. Availability arithmetic

### Components in series — dependencies multiply

If your request path touches N components and **any** one failing fails the request, availabilities multiply:

```
   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐
   │  LB  │──►│ API  │──►│Cache │──►│  DB  │
   │99.99 │   │99.9  │   │99.9  │   │99.95 │
   └──────┘   └──────┘   └──────┘   └──────┘

   0.9999 × 0.999 × 0.999 × 0.9995 = 0.99730  →  99.73%
```

Every service is *below* three nines even though three of the four components meet or beat it. This is the most under-appreciated fact in the discipline:

> <H>**Adding a dependency to the critical path can only lower availability. Ten 99.9% services in series give you 99.0% — two nines, from three-nine parts.**</H>

It is also the strongest argument against gratuitous microservices, and the reason **graceful degradation** matters so much. If a cache failure serves stale data instead of an error, the cache leaves the series chain entirely and stops multiplying against you.

### Components in parallel — redundancy compounds the other way

With N independent replicas where **any one** suffices:

```
   Availability = 1 − (1 − a)^N

   one   99%  instance                    →  99%
   two   99%  instances (independent)     →  1 − 0.01²  = 99.99%
   three 99%  instances                   →  1 − 0.01³  = 99.9999%
```

Two mediocre machines beat one excellent machine. This is why horizontal redundancy is the default answer to availability, and why it beats buying a more reliable server.

<C color="orange">**The word doing the work is *independent*.**</C> Three replicas in one availability zone share a power feed, a network fabric, and a deploy pipeline. A bad config push takes all three at once and the formula silently does not apply. <C color="crimson">Correlated failure is what turns a "99.9999%" design into an outage</C> — which is exactly the story in most large postmortems.

---

<Depth title="Why availability multiplies, and why real systems beat the formula">

**The series formula.** If a request needs components 1…n and each fails independently with probability `fᵢ`, the request succeeds only when all succeed:

```
  A_total = A₁ × A₂ × … × Aₙ
```

For small failure probabilities there is a much easier mental shortcut. Write each availability as `1 − fᵢ`; then

```
  A_total = ∏(1 − fᵢ)  ≈  1 − Σfᵢ        (when all fᵢ are small)
```

**Failure probabilities simply add.** Four components at 0.01%, 0.1%, 0.1% and 0.05% give ~0.26% total failure — 99.74%, matching the exact product to two decimals. This is far easier to do in your head than multiplying, and it makes the lesson obvious: <C color="crimson">each dependency you add contributes its full failure rate to the total, and nothing you do to the *other* components can offset it.</C>

**Why real systems do better than this predicts.** The formula assumes every component is *required*. Most well-built systems arrange for that to be false:

- **Degradation removes a component from the chain.** If a cache failure serves stale data instead of an error, the cache's availability stops appearing in the product entirely. This is the single highest-leverage reliability move available, and it costs no hardware.
- **Retries convert a transient failure into latency.** A component that fails 0.1% of requests *independently* on each attempt fails ~0.0001% after one retry. This is why timeouts and retries matter so much — they change the exponent.
- **Not every request touches every component.** If only 5% of requests hit the search index, a search outage costs you 5% of requests, not 100%.

**Why real systems also do worse.** The parallel formula `1 − (1−a)^N` assumes **independence**, and that assumption is routinely false in ways that are invisible until the incident:

- Three replicas in one availability zone share power, cooling and network fabric.
- All replicas share a **deploy pipeline** — a bad config reaches all of them in seconds.
- All replicas share a **certificate expiry date**, a leap-second bug, a dependency version.

If replicas fail together with probability `c`, availability is bounded by `1 − c` no matter how many you add. <C color="orange">Adding a fourth replica to a design whose real risk is a global config push buys you nothing at all</C> — which is why so many large postmortems describe redundancy that was nominal rather than real.

**The practical reading:** compute the series product to find which dependency dominates, then ask of each one *"can this degrade instead of fail?"* — and compute the parallel formula only after asking *"what do these replicas share?"*

</Depth>

## 4. Error budgets

The idea that makes SLOs useful rather than decorative.

> **Error budget = 1 − SLO.** If your SLO is 99.9%, you are *permitted* 0.1% failure. That is not a shameful residue; it is a resource you are allowed to spend.

For a service handling 100M requests over 28 days:

```
  SLO 99.9%       →  budget = 0.1% × 100M = 100,000 failed requests
  Consumed so far →  38,000
  Remaining       →  62,000  (62% of budget, on day 14 of 28)
```

### Why it changes conversations

Every organisation has the same standing argument: product wants to ship, SRE wants to harden. The error budget replaces opinion with a policy agreed in advance.

Step through a single month and watch a budget get spent:

<Trace title="One month of a 99.9% error budget" subtitle="100M requests over 28 days. Budget: 100,000 failed requests.">

<TraceStep
  title="Day 1 — the window opens"
  state={{ 'Budget': '100,000', 'Spent': '0', 'Remaining': '100%', 'Policy': 'ship freely' }}
  note="A fresh budget is permission to take risks, not a target to protect at all costs.">

The rolling 28-day window resets. You are allowed 100,000 failed requests — 0.1% of 100M.

</TraceStep>

<TraceStep
  title="Days 1–9 — normal operation"
  state={{ 'Budget': '100,000', 'Spent': '12,000', 'Remaining': '88%', 'Policy': 'ship freely' }}
  changed={['Spent', 'Remaining']}
  note="Background failure is normal and expected. It is what the budget is for.">

Ordinary background errors: a few timeouts, a node restart, a deploy blip. **12,000 requests failed.** Nobody was paged, and nothing is wrong.

</TraceStep>

<TraceStep
  title="Day 10 — a bad deploy"
  cost="26,000 requests"
  state={{ 'Budget': '100,000', 'Spent': '38,000', 'Remaining': '62%', 'Policy': 'ship freely' }}
  changed={['Spent', 'Remaining']}
  note="A 22-minute incident is survivable precisely because the budget existed to absorb it.">

A release breaks a code path for 22 minutes before rollback. **26,000 requests fail.**

Notice what does *not* happen: no argument about whether shipping is too risky. The budget absorbed it, and 62% remains.

</TraceStep>

<TraceStep
  title="Day 17 — a dependency degrades"
  cost="49,000 requests"
  state={{ 'Budget': '100,000', 'Spent': '87,000', 'Remaining': '13%', 'Policy': 'freeze risky launches' }}
  changed={['Spent', 'Remaining', 'Policy']}
  note="The policy change is automatic. Nobody had to win an argument — it was agreed when the SLO was set.">

An upstream provider has a bad afternoon. **49,000 more requests fail.**

The budget crosses its warning threshold, and the pre-agreed policy takes over: **risky launches are frozen**, reliability work is prioritised.

</TraceStep>

<TraceStep
  title="Day 22 — budget exhausted"
  cost="feature freeze"
  state={{ 'Budget': '100,000', 'Spent': '104,000', 'Remaining': '−4%', 'Policy': 'feature freeze' }}
  changed={['Spent', 'Remaining', 'Policy']}
  note="The SLO is missed for this window. The response is mechanical, not political.">

Another small incident pushes spending past 100%. The SLO is now missed for this rolling window.

**Feature work stops.** Only reliability work ships until the window rolls forward and old failures age out.

</TraceStep>

<TraceStep
  title="The lesson, either way"
  state={{ 'Budget': '100,000', 'Spent': '104,000', 'Remaining': '−4%', 'Policy': 'feature freeze' }}
  note="A month ending at 5% spent is also a signal — that the SLO is too loose to inform any decision, or that you shipped too little.">

Had the month ended at 40% spent, the correct reading is *"we could have taken more risk"* — shipped faster, attempted the migration, run the experiment.

<H>The budget is a resource. Underspending it is a missed opportunity, not a victory.</H>

</TraceStep>

</Trace>

| Budget state | Policy |
| :--- | :--- |
| <C color="green">**Healthy** (plenty left)</C> | Ship. Take risks. Do the risky migration now. |
| **Nearly exhausted** | Freeze risky launches; only reliability work and safe fixes. |
| <C color="crimson">**Exhausted**</C> | Feature freeze until the window rolls and the budget refills. |

Nobody has to win an argument about how reliable is reliable enough. That was decided when the SLO was set.

### Why 100% is the wrong target

Three reasons, and none of them is laziness.

1. **The user cannot tell.** Their WiFi, their ISP and their phone are less reliable than your service. Perfection on your side is invisible beneath the noise on theirs.
2. **The cost curve is vertical.** The last 0.09% can cost more than the first 99.9%.
3. **Zero budget means zero change.** Every deploy, migration and config change carries risk. A service that may never fail is a service that may never change — and change is how it stays useful and secure.

> <H>A perfect month is not a triumph. It usually means your SLO is too loose, or you shipped too little.</H>

---

## 5. Picking the number

A rough procedure that works:

1. **Measure first.** Instrument the SLI and observe reality for a month. Setting an SLO before measuring is guessing.
2. **Set it just above where users complain.** Not where you'd like to be — where dissatisfaction actually starts.
3. **Check what you depend on.** You cannot promise 99.99% while sitting on a datastore that promises 99.9%. Your ceiling is your weakest critical dependency.
4. **Set the SLA looser.** Leave the warning track.
5. **Revisit quarterly.** Chronically unmet means it is aspirational, not an objective. Never once threatened means it is too loose to inform any decision.

### Different paths deserve different SLOs

One number for a whole system is a blunt instrument. Split by **user journey**:

| Journey | SLO | Why |
| :--- | :--- | :--- |
| Checkout / payment | 99.99% availability, p99 < 500 ms | Failure is lost revenue and lost trust |
| Product browse | 99.9%, p99 < 300 ms | Failure is annoying, retryable |
| Recommendations | 99%, p99 < 1 s | Degrade to "trending" and almost nobody notices |
| Analytics export | 99%, hours of freshness | Nobody is watching in real time |

Spending checkout-grade reliability money on the recommendations panel is a pure waste, and the panel is exactly the thing that should be allowed to fail so that checkout does not.

---

## 6. Latency SLOs and the tail

<Jargon
  plain="Instead of the average, look at how bad it gets for the unluckiest few percent of requests."
  term="tail latency, quoted as p99"
  also={['percentile latency', 'the long tail', 'p50 / p95 / p99.9']}>

*"Our p99 is 400 ms"* means one request in a hundred takes longer than 400 ms. Saying **p99** rather than *"average response time"* is one of the fastest ways to signal you have operated a real service — averages hide exactly the requests users complain about.

</Jargon>

Averages lie. Consider ten requests: nine at 10 ms, one at 5,000 ms.

```
  mean  = 509 ms     ← describes nothing that happened
  p50   = 10 ms      ← the typical experience
  p99   ≈ 5,000 ms   ← the experience people write support tickets about
```

Always specify latency SLOs at a **percentile**, never a mean. And note the arithmetic that makes tails so dangerous: if one page issues 100 backend calls and each has a 1% chance of being slow, the probability that *at least one* is slow is 1 − 0.99¹⁰⁰ ≈ **63%**. The slowest call sets the page's latency, so a rare tail on a single service becomes the common case for the user.

> <H>**A p99 problem on a dependency is a p50 problem for anything that fans out to it.**</H>

---

## Rapid-fire recall

1. Define SLI, SLO and SLA in one line each.
2. Why must an SLA be looser than the corresponding SLO?
3. How much downtime per month is 99.9%? Per month at 99.99%?
4. Why does four nines rule out humans in the recovery path?
5. Four services in series at 99.99%, 99.9%, 99.9%, 99.95% — roughly what availability, and what is the lesson?
6. Give the parallel-redundancy formula, and the word that makes it fail in practice.
7. What is an error budget, and how does it settle the ship-vs-harden argument?
8. Give three reasons 100% availability is the wrong target.
9. Why is a month with zero errors not necessarily good news?
10. A page makes 100 backend calls, each 1% likely to be slow. How often is the page slow, and what does that mean for setting latency SLOs?

<details>
<summary>Answers</summary>

1. **SLI** — a measured number reflecting user experience (good events ÷ valid events). **SLO** — an internal target for that SLI over a stated window. **SLA** — a customer contract with financial consequences for missing it.
2. So you are paging engineers well before you are paying refunds. The gap between them is your warning track.
3. 99.9% → **43.8 minutes/month**. 99.99% → **4.38 minutes/month**.
4. Because 4 minutes of monthly budget is less time than a human needs to read a page, get to a laptop and diagnose anything. Recovery has to be automatic.
5. 0.9999 × 0.999 × 0.999 × 0.9995 ≈ **99.73%** — below three nines despite three components meeting it. **Dependencies on the critical path multiply and can only lower availability**, which argues for fewer hops and for degrading instead of failing.
6. `1 − (1 − a)^N`. The word is **independent** — replicas sharing a zone, a power feed, or a deploy pipeline fail together, and correlated failure voids the formula.
7. `1 − SLO`, a budgeted allowance of failure. It converts a values argument into a policy agreed in advance: budget healthy → ship; budget exhausted → freeze features and do reliability work.
8. Users cannot perceive it beneath their own network's unreliability; the cost curve goes vertical at the end; and a zero error budget means you can never safely change anything.
9. It usually means the SLO is too loose to inform decisions, or you under-shipped — you left budget unspent that could have bought features or migrations.
10. 1 − 0.99¹⁰⁰ ≈ **63%** of pages are slow. A p99 problem on a fanned-out dependency becomes a p50 problem for the caller, so latency SLOs must be set at percentiles and dependency tails matter far more than their frequency suggests.

</details>

---

**Next:** [Latency Numbers & The Cost of Distance](./04-latency-numbers.md) — the numbers to know by heart, and the floor physics puts under them.
