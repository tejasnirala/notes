---
title: Logs, Metrics and Traces
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Logs, Metrics and Traces

> **What you will be able to do after this page**
>
> - Say what each of the three signals is for, and stop using the wrong one.
> - Explain cardinality, and why it decides your monitoring bill.
> - Design structured logs that are actually queryable.
> - Distinguish monitoring from observability in a way that changes what you build.

Three signals, frequently treated as interchangeable. <C color="orange">They answer different questions, cost wildly different amounts, and using the wrong one is expensive in both directions.</C>

<Plain>

A delivery company wants to understand its operation. Three different records help, and each answers a question the others cannot.

**A tally sheet.** "412 parcels delivered today, 18 late, average 3.2 days." Cheap to keep — a few numbers updated continuously — and it tells you instantly whether today is normal. <C color="crimson">It cannot tell you anything about parcel 8842</C>, because that parcel was only ever a tick mark.

**A logbook.** Every event written down: *"14:22 — parcel 8842 collected from depot by van 7."* Enormously detailed, and enormously bulky. It answers questions about **one specific parcel** perfectly, and answering *"how are we doing overall?"* means reading everything.

**A journey record.** For one parcel, the complete path with timings at each handover: warehouse 2 days, sorting 6 hours, van 40 minutes. <C color="green">This is the only one that shows where the time went</C> — the tally has no breakdown and the logbook has the pieces scattered across thousands of unrelated entries.

The mistake is using one for another's job. Reading the logbook to compute daily averages is slow and expensive. Keeping tallies per individual parcel gives you millions of counters and no useful summary.

<H>"Is something wrong?" is a tally question. "What happened to this one?" is a logbook question. "Where did the time go?" is a journey question.</H>

</Plain>

---

## 1. The three signals

| | Metrics | Logs | Traces |
| :--- | :--- | :--- | :--- |
| **Answers** | Is something wrong? | What happened here? | Where did the time go? |
| **Shape** | Numbers over time | Discrete events | A request's path across services |
| **Cost** | <C color="green">Very cheap</C> | <C color="crimson">Expensive at volume</C> | Moderate (sampled) |
| **Queryable by** | Dimensions (low cardinality) | <C color="green">Anything, if structured</C> | Trace or span id |
| **Retention** | Months to years | Days to weeks | Days |
| **Good for** | Alerting, dashboards, SLOs | Debugging one case, audit | Latency breakdown, dependency maps |

<H>Alert on metrics. Debug with traces. Investigate specifics with logs. Using logs for alerting is slow and expensive; using metrics for debugging one user's problem is impossible.</H>

---

## 2. Cardinality — the thing that decides your bill

<Jargon
  plain="How many distinct combinations of label values a metric produces."
  term="cardinality"
  also={['label cardinality', 'series count']}>

A time-series database stores <C color="orange">one separate series per unique combination of labels.</C> Cardinality multiplies across labels, so adding one high-cardinality label can multiply your storage by millions.

</Jargon>

```
  http_requests_total{method, status, endpoint}
     5 methods × 8 statuses × 40 endpoints  =  1,600 series      ← fine

  add user_id (1,000,000 users):
     1,600 × 1,000,000  =  1.6 BILLION series                    ← catastrophic
```

<C color="crimson">A single unbounded label destroys a metrics system.</C> The offenders are consistent: `user_id`, `request_id`, `trace_id`, `email`, full URL paths with ids in them, and **error messages** containing variable text.

| Safe as a metric label | Never a metric label |
| :--- | :--- |
| `method`, `status`, `region` | `user_id`, `request_id`, `session_id` |
| `endpoint` (**templated**: `/users/:id`) | Raw path (`/users/8842`) |
| `service`, `version`, `environment` | Free-text error messages |
| `error_type` (an enum) | Email, IP address, order id |

<C color="green">High-cardinality data belongs in logs and traces, where it is stored once per event rather than as a permanent series.</C> That division is the whole reason three signals exist.

---

## 3. Logs worth having

<Trace title="Making a log line useful" subtitle="From unqueryable to a complete debugging tool.">

<TraceStep
  title="The typical starting point"
  state={{ 'Format': 'free text', 'Queryable': 'substring only', 'Links to a request': 'no', 'Useful at 3am': 'barely' }}
  changed={['Format', 'Queryable']}
  note="Searchable only by grep. Cannot be aggregated, filtered by field, or joined to anything.">

```
ERROR: payment failed for user
```

<C color="crimson">No identity, no reason, no amount, no way to correlate.</C>

</TraceStep>

<TraceStep
  title="Make it structured"
  state={{ 'Format': 'JSON', 'Queryable': 'by field', 'Links to a request': 'no', 'Useful at 3am': 'better' }}
  changed={['Format', 'Queryable']}
  note="Now you can ask 'all card_declined errors for this user in the last hour' as a real query.">

```json
{ "level":"error", "event":"payment_failed", "user_id":"8842",
  "amount_cents":4200, "reason":"card_declined" }
```

<C color="green">Every field is queryable</C>, and events can be counted and grouped.

</TraceStep>

<TraceStep
  title="Add correlation"
  cost="the critical field"
  state={{ 'Format': 'JSON', 'Queryable': 'by field', 'Links to a request': 'YES', 'Useful at 3am': 'yes' }}
  changed={['Links to a request', 'Useful at 3am']}
  note="Without this, an async failure is unlinkable to the request that caused it — debugging becomes archaeology.">

Add `trace_id` and `span_id`, propagated from the originating request through every service and every queued message.

<C color="green">One query now returns every log line from every service for that one request.</C>

</TraceStep>

<TraceStep
  title="Add context, not just the error"
  state={{ 'Includes': 'attempt, provider, latency, idempotency key', 'Reproducible': 'yes', 'Useful at 3am': 'much' }}
  changed={['Includes', 'Reproducible']}
  note="The question at 3am is always 'why?' — log the inputs to the decision, not just its outcome.">

```json
{ "…":"…", "attempt":2, "provider":"stripe",
  "provider_latency_ms":840, "idempotency_key":"idem-abc123" }
```

</TraceStep>

<TraceStep
  title="And remove what must not be there"
  cost="compliance"
  state={{ 'PII': 'redacted', 'Card number': 'never logged', 'Retention': 'bounded', 'Useful at 3am': 'yes' }}
  changed={['PII', 'Card number', 'Retention']}
  note="Logs are copied into search indexes, backups and third-party tools — every copy inherits the problem.">

<C color="crimson">Never log card numbers, passwords, tokens, or full request bodies that may contain any of them.</C>

<H>A log line is not a temporary artefact. It is replicated into an indexing system, retained, backed up, and often sent to a third-party vendor — so anything sensitive in it has been distributed far more widely than intended.</H>

</TraceStep>

</Trace>

**Log levels, used consistently:**

| Level | Meaning |
| :--- | :--- |
| `ERROR` | <C color="green">A human must look</C> — something is broken |
| `WARN` | Unusual and handled; investigate if frequent |
| `INFO` | Significant business events — a small number per request |
| `DEBUG` | Off in production; enabled temporarily under a flag |

<C color="crimson">The most common failure is logging everything at `INFO`</C>, producing volume nobody reads and a bill nobody questions — until `ERROR` becomes noise too and real failures go unnoticed.

---

## 4. Traces

A trace is a request's path across services, as a tree of **spans** with timings.

```
  ── GET /checkout ─────────────────────────────── 840 ms
     ├─ auth.verify ──── 12 ms
     ├─ cart.get ─────── 45 ms
     ├─ inventory.check ───────────── 180 ms
     └─ payment.charge ──────────────────────── 590 ms
        └─ stripe.api ─────────────────────── 560 ms   ← the answer
```

<C color="green">This is the only signal that answers "why was this request slow?"</C> without guessing. Metrics tell you *that* p99 rose; traces tell you *which* span grew.

**Sampling.** Tracing every request is expensive, so most systems sample.

- **Head sampling** — decide at the start (e.g. keep 1%). Cheap, and <C color="crimson">it discards most of the interesting requests</C>, since the slow ones are rare.
- <C color="green">**Tail sampling**</C> — buffer the trace, decide once complete. Keep everything slow or erroring, and 1% of the rest. Much more useful; needs buffering infrastructure.

<C color="green">Always propagate context, even when not sampling.</C> W3C `traceparent` costs nothing to carry and means a request can be reconstructed if it turns out to matter.

<Depth title="Monitoring versus observability, and why the distinction changes what you build">

The words are used interchangeably in marketing and mean genuinely different things.

**Monitoring** watches for **known** failure modes. You decide in advance what could go wrong — disk full, error rate high, latency elevated — and build a dashboard and an alert for each. It answers *"is the thing I predicted happening?"*

**Observability** is the property that you can answer **unanticipated** questions about the system from its outputs, without shipping new code. It answers *"why is this specific user on Android in Brazil seeing timeouts only on Tuesdays?"* — which nobody built a dashboard for.

The distinction has a concrete consequence:

<C color="crimson">Dashboards only show failures you anticipated.</C> In a distributed system, most real incidents are combinations nobody predicted — an interaction between a canary deploy, a cache warm-up, and one tenant's unusual usage. <C color="green">A dashboard for that does not exist, and never will.</C>

**What observability actually requires:**

**1. High-cardinality, high-dimensionality events.** One wide structured event per request, carrying *everything* — user id, tenant, region, version, feature flags, cache hit or miss, upstream latencies, error details. Dozens of fields.

**2. The ability to slice by any of them, after the fact.** Group by any dimension, filter by any combination, without having predefined it.

This is why the "wide event" approach differs from traditional metrics: <C color="orange">metrics require you to choose your dimensions in advance and keep them low-cardinality; wide events let you keep everything and decide what matters when you are debugging.</C> The cost model differs too — events are stored once, not as permanent series per combination.

**The practical arrangement most teams land on:**

| Purpose | Signal |
| :--- | :--- |
| Alerting | <C color="green">Low-cardinality metrics</C> — cheap, fast, reliable |
| Dashboards for known concerns | Metrics |
| "Why is p99 up?" | <C color="green">Traces</C> |
| "Why is *this* request broken?" | <C color="green">Wide events / structured logs</C> |
| Long-term trends and capacity | Metrics with long retention |

**The four golden signals** remain the right default for what to measure per service:

- **Latency** — split successful from failed, since a fast failure otherwise flatters the number
- **Traffic** — requests per second
- **Errors** — rate, by type
- **Saturation** — how full the constrained resource is

<H>Instrument the golden signals as metrics for alerting, emit one wide structured event per request for investigation, and trace enough to see where time goes. The three are complements, and a team that only has one of them will be blind in a way they cannot see from inside that signal.</H>

</Depth>

---

## 5. In a design discussion

- **"Alert on metrics, debug with traces, investigate with logs. Alerting off log searches is slow and expensive."** Assigns each signal its job.
- **"`user_id` never goes in a metric label — one unbounded label turns 1,600 series into a billion."** The cardinality trap, with numbers.
- **"Trace id propagated into every service and every queued message. Without it, an async failure can't be linked to the request that caused it."** The practice that is painful to retrofit.
- **"Tail sampling — head sampling at 1% throws away almost all the slow requests, which are the only ones we wanted."** Shows why the default is wrong.

---

## Rapid-fire recall

1. What question does each of the three signals answer?
2. Which signal should alerts fire from, and why not logs?
3. Define cardinality and show how one bad label explodes it.
4. Give four labels that are safe and four that are never safe.
5. Where does high-cardinality data belong instead?
6. What single field makes logs useful across services, and when must it be added?
7. Why is a log line not a temporary artefact?
8. What is the most common logging failure, and what does it cause?
9. Compare head and tail sampling, and say why head sampling is usually wrong.
10. Distinguish monitoring from observability, and say what observability requires.

<details>
<summary>Answers</summary>

1. **Metrics** — "is something wrong?" **Logs** — "what happened in this specific case?" **Traces** — "where did the time go?"
2. **Metrics** — they are cheap, fast to query, and numeric so thresholds are meaningful. Alerting off log searches is slow, expensive at volume, and scales badly with retention.
3. The number of **distinct label-value combinations**, each stored as a separate time series. `{method, status, endpoint}` at 5 × 8 × 40 = 1,600 series; adding `user_id` for 1M users gives **1.6 billion**.
4. **Safe**: `method`, `status`, `region`, templated `endpoint`, `service`, `version`, `environment`, enum `error_type`. **Never**: `user_id`, `request_id`, `trace_id`, raw paths with ids, free-text error messages, email, IP.
5. In **logs and traces**, where it is stored **once per event** rather than as a permanent time series per combination.
6. A **trace id** (with span id), propagated through every service and every queued message. It must be added **from day one** — it is cheap then and very expensive to retrofit.
7. Because it is **replicated into an indexing system, retained, backed up, and often sent to a third-party vendor**. Anything sensitive in it has been distributed far more widely than the writer intended.
8. **Logging everything at `INFO`.** It produces volume nobody reads, a large bill, and eventually makes `ERROR` itself noisy — so real failures go unnoticed.
9. **Head** decides at the start (keep 1%); **tail** buffers the trace and decides once complete, keeping everything slow or erroring plus a sample of the rest. Head sampling is usually wrong because slow requests are **rare**, so random sampling discards almost all of them — exactly the ones you wanted.
10. **Monitoring** watches for **predicted** failure modes via dashboards and alerts. **Observability** is being able to answer **unanticipated** questions from existing outputs without shipping code. It requires **high-cardinality, high-dimensionality wide events** and the ability to **slice by any dimension after the fact**.

</details>

---

**Next:** [Alerting and On-Call](./02-alerting-and-oncall.md) — waking the right person for the right reason.
