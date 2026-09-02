---
title: Workers and Background Jobs
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Workers and Background Jobs

> **What you will be able to do after this page**
>
> - Design a job that survives being killed halfway through.
> - Schedule recurring work without running it twice or missing a run.
> - Give the user a sensible experience for work that happens later.
> - Recognise the jobs that will silently stop running.

The queue delivers the message; <C color="orange">the worker is where the actual difficulty lives</C> — because a worker can be killed at any moment, and usually is.

<Plain>

A workshop takes repair jobs. Each has a docket, and someone picks it up and works on it.

The awkward reality is that the workshop closes at 6pm regardless of what is half-finished — and people go home mid-repair, every day.

So the way you write dockets matters enormously.

**A bad docket says "repair the bike".** Someone picks it up, does forty minutes of work, and leaves. The next morning another person picks it up and starts from the beginning, because <C color="crimson">nothing recorded what was already done.</C> Worse, if the first person had already fitted a new tyre, the second fits another one.

**A good docket has steps that can be re-checked.** *"Tyre fitted? Brakes adjusted? Chain replaced?"* Whoever picks it up looks at what is already done and continues. Being interrupted costs a little repeated checking and nothing else.

There is a second problem the workshop has to solve. A note on the wall says *"service the delivery van every Monday"*. If two people read it, the van gets serviced twice. If everyone assumes someone else did it, <C color="crimson">it silently never happens</C> — and nobody notices for months, because a task not happening produces no evidence.

Those two problems — **surviving interruption** and **running exactly once on a schedule** — are what this page is about. The processing itself is usually the easy part.

</Plain>

---

## 1. Every worker gets killed

Not occasionally — routinely. Deploys, autoscaling, spot instance reclamation, OOM kills, node drains. <C color="crimson">A job that only works when it runs to completion will fail every single deploy.</C>

Design for interruption from the start:

| Property | Why |
| :--- | :--- |
| **Idempotent** | It will be redelivered after an interruption |
| **Resumable** | Long jobs record progress so a restart does not begin again |
| **Chunked** | A 6-hour job becomes 360 one-minute jobs |
| **Time-bounded** | Nothing should outlive a deploy cycle |
| **Graceful on `SIGTERM`** | Finish the current item, ack it, then exit |

### Graceful shutdown

On `SIGTERM`, the orchestrator gives you a grace period — often 30 seconds — before `SIGKILL`.

```
  1. Stop accepting new messages
  2. Finish the message in hand
  3. Ack it
  4. Exit cleanly
```

<C color="green">Done properly, a deploy causes zero redeliveries.</C> <C color="crimson">Ignored, every deploy redelivers everything in flight</C> — which is survivable only because your handlers are idempotent, and is a poor reason to rely on that.

<Trace title="A 4-hour export job meets a deploy" subtitle="Exporting 10 million rows to a file. Watch what interruption costs.">

<TraceStep
  title="Naive version — one long job"
  state={{ 'Rows exported': '0', 'Progress recorded': 'none', 'Restart cost': 'full 4 h', 'Survives deploy?': 'no' }}
  changed={['Rows exported', 'Restart cost']}
  note="Works perfectly in testing, where nobody deploys during the test.">

One message: *"export everything"*. The worker streams rows into a file.

</TraceStep>

<TraceStep
  title="Three hours in, a deploy happens"
  cost="all work lost"
  state={{ 'Rows exported': '7.5M (discarded)', 'Progress recorded': 'none', 'Restart cost': 'full 4 h', 'Survives deploy?': 'NO' }}
  changed={['Rows exported', 'Survives deploy?']}
  note="And with a daily deploy cadence, a 4-hour job may never complete at all.">

The pod is terminated. No ack was sent, so the message is redelivered — <C color="crimson">and the new worker starts from row 1.</C>

</TraceStep>

<TraceStep
  title="Chunked version — 1,000 jobs of 10,000 rows"
  state={{ 'Rows exported': '7.5M (kept)', 'Progress recorded': 'per chunk', 'Restart cost': '~10 s', 'Survives deploy?': 'yes' }}
  changed={['Rows exported', 'Progress recorded', 'Restart cost', 'Survives deploy?']}
  note="Each chunk acks independently, so an interruption loses at most one chunk's work.">

Each chunk handles rows `[n, n+10000)` and writes its own output part. <C color="green">A deploy loses at most ten seconds of work.</C>

</TraceStep>

<TraceStep
  title="Chunks also unlock parallelism"
  cost="4 h → 15 min"
  state={{ 'Rows exported': '10M', 'Workers': '20', 'Restart cost': '~10 s', 'Wall time': '~15 min' }}
  changed={['Rows exported', 'Workers', 'Wall time']}
  note="An unintended benefit that usually dwarfs the resilience one.">

Independent chunks run on twenty workers concurrently.

</TraceStep>

<TraceStep
  title="Then a coordinator finishes the job"
  state={{ 'Chunks complete': '1000/1000', 'Workers': '20', 'Final artifact': 'assembled', 'Wall time': '~15 min' }}
  changed={['Chunks complete', 'Final artifact']}
  note="Tracking chunk completion in a database row is usually enough — no orchestration framework required.">

A parent job row tracks chunk completion. When the count reaches 1,000, it stitches the parts and notifies the user.

<H>Chunking is the single highest-value technique for background work: it converts an interruption from catastrophic to trivial, and it makes the job parallelisable at the same time.</H>

</TraceStep>

</Trace>

---

## 2. Scheduled jobs

<Jargon
  plain="Making sure a scheduled task runs on exactly one machine, even though many machines are running the same code."
  term="distributed cron / leader election for jobs"
  also={['singleton job', 'scheduled task locking']}>

<C color="crimson">If ten servers each run the same cron entry, the job runs ten times.</C> If you run it on one designated server, it silently stops when that server is replaced. Both failures are common, and the second is much harder to notice.

</Jargon>

**Approaches, worst to best:**

| Approach | Problem |
| :--- | :--- |
| Cron on every server | <C color="crimson">Runs N times</C> |
| Cron on one "special" server | <C color="crimson">Silently stops when it is replaced; a snowflake to maintain</C> |
| Database lock | <C color="green">Works</C> — `INSERT` a row for `(job, time_slot)` with a unique constraint; the winner runs it |
| Distributed lock with fencing | <C color="green">Works</C>, with the [caveats about locks](../06-distributed-systems/03-consensus-and-quorums.md) |
| Orchestrator-native | <C color="green">Best</C> — Kubernetes `CronJob`, EventBridge, Cloud Scheduler |

<C color="green">The database-lock approach is the simplest thing that is actually correct:</C>

```sql
INSERT INTO job_runs (job_name, scheduled_for) VALUES ('nightly-report', '2026-09-02T02:00');
-- UNIQUE(job_name, scheduled_for). Exactly one instance can win.
```

Every server tries; the unique constraint means one succeeds and runs the job. No lock service, no leader election, no coordination beyond the database you already have.

### The failure nobody notices

<C color="crimson">A job that stops running produces no error, no alert, and no log line.</C> Its absence is invisible by construction — which makes it the most under-monitored failure in this whole area.

<C color="green">Monitor for absence, not just for failure.</C> A "dead man's switch": the job reports success to a heartbeat service on every run, and the *monitor* alerts if a report does not arrive within the expected window. Healthchecks.io, Cronitor and Prometheus's `Pushgateway` all do this; a `last_success_at` column with an alert works fine too.

---

## 3. What the user sees

Moving work off the request path means the user no longer gets an answer. Design that experience deliberately.

```
  POST /exports        → 202 Accepted, { job_id: "j_881", status: "queued" }
  GET  /exports/j_881  → { status: "processing", progress: 0.42 }
  GET  /exports/j_881  → { status: "complete", url: "https://..." }
```

| Pattern | Good for |
| :--- | :--- |
| **Poll a status endpoint** | Simple, works everywhere; keep the interval sane |
| **Webhook on completion** | Server-to-server |
| **[SSE or WebSocket](../02-networking/06-realtime-communication.md)** | Live progress in a UI |
| **Email or notification** | Long jobs where the user will leave |

<C color="green">Always expose progress if the job takes more than a few seconds.</C> "Processing…" with no movement is indistinguishable from "broken", and generates support tickets and duplicate submissions.

<C color="crimson">And always make submission idempotent</C> — a user who sees no feedback will click again.

<Depth title="Priorities, fairness, and the noisy-neighbour problem">

A single queue processed FIFO breaks in two specific and predictable ways.

**Problem 1 — urgent work stuck behind bulk work.** A user requests a password reset email while 500,000 marketing emails sit ahead of it in the same queue. The reset arrives four hours later, by which time it has expired.

<C color="crimson">Priority fields inside one queue mostly do not solve this</C> — most brokers implement them approximately or not at all, and even where supported, a flood of high-priority messages starves the low-priority ones completely.

<C color="green">Separate queues with separate worker pools is the reliable answer:</C>

```
  queue:critical    → 10 workers    password resets, payment webhooks
  queue:default     → 20 workers    normal user-triggered work
  queue:bulk        →  5 workers    exports, marketing sends, backfills
```

Each pool is isolated, so bulk work **cannot** delay critical work regardless of volume. The cost is fixed capacity per class — critical workers sit idle while bulk is backed up. Usually a good trade; where it is not, allow bulk workers to *also* poll the critical queue but never the reverse.

**Problem 2 — one tenant starves the rest.** A single customer submits 100,000 jobs. FIFO means every other customer waits behind them, even though each has only a handful of jobs.

<C color="orange">This is the noisy-neighbour problem, and it is the default behaviour of every simple queue.</C> Three fixes:

**Per-tenant queues with round-robin.** Workers cycle across tenant queues, taking one job from each in turn. Fair by construction; needs dynamic queue management as tenants come and go.

**Weighted fair queuing.** Track work done per tenant in a window and deprioritise those over their share. More flexible, more machinery.

**Per-tenant concurrency limits.** The simplest effective option: a tenant may have at most N jobs in flight. Additional jobs stay queued. <C color="green">A single counter per tenant in Redis is enough</C>, and it caps the blast radius without any queue restructuring.

**Problem 3 — retries competing with new work.** Failed messages retrying in the same queue consume capacity that new work needs, and a downstream outage means the queue fills with retries while fresh requests wait behind them. <C color="green">Route retries to a separate delay queue</C> with backoff, so they do not compete with first attempts.

**What to monitor**, since these failures are invisible in throughput numbers:

| Metric | Tells you |
| :--- | :--- |
| **Oldest message age**, per queue | How far behind you are, in user-visible units |
| **Processing rate vs arrival rate** | Whether you are falling behind at all |
| **p99 job duration** | A slow job type poisoning a shared pool |
| **DLQ depth** | Accumulated permanent failures |
| **Per-tenant in-flight count** | A noisy neighbour, before customers report it |

<H>Throughput looks healthy right up until it does not. Arrival rate minus processing rate is the number that predicts an incident, and oldest-message age is the number that describes it.</H>

</Depth>

---

## 4. Practical rules

**Make the payload a reference, not the data.** Put an id in the message and fetch the record. <C color="crimson">Embedding a large object means the message is stale by the time it is processed</C>, and brokers have size limits.

**Set a timeout on every job.** A job with no timeout can hang forever holding a worker slot. Bound it, and let it fail loudly.

**Separate the queue from the job store.** The queue triggers work; a database row holds status, progress, attempts and result. Users can then query state, and you can retry from your own records rather than the broker's.

**Version your message schemas.** Old messages will be in flight during a deploy. A consumer must handle the previous format — the same [expand-contract discipline](../05-data-at-scale/04-zero-downtime-migrations.md) as schema changes.

**Log a correlation id.** Async failures arrive with no request context. Propagate a trace id from the original request into the message, or debugging becomes archaeology.

---

## 5. In a design discussion

- **"Chunk the export into 10,000-row jobs — a deploy then costs ten seconds instead of four hours, and we get parallelism for free."** Two benefits from one decision.
- **"Separate queues for critical and bulk with their own worker pools. Priority fields inside one queue don't reliably prevent starvation."** Knows why the obvious fix fails.
- **"Per-tenant concurrency cap in Redis, so one customer submitting 100,000 jobs can't starve everyone else."** The noisy-neighbour answer.
- **"Alert on the job *not* running — a scheduled job that stops produces no error at all."** The failure people discover months late.

---

## Rapid-fire recall

1. Name five routine reasons a worker gets killed.
2. Give the four steps of graceful shutdown, and what it prevents.
3. What did chunking buy in the export trace, beyond resilience?
4. Give two ways naive scheduled jobs fail, and say which is harder to detect.
5. Show the database-lock approach to running a scheduled job exactly once.
6. Why is a job that stops running so hard to notice, and what detects it?
7. Give four ways to tell a user about async work, and when to use each.
8. Why do priority fields inside a single queue usually not solve starvation?
9. Give three fixes for the noisy-neighbour problem, and the simplest effective one.
10. Which two metrics predict and describe a backlog incident?

<details>
<summary>Answers</summary>

1. **Deploys** · **autoscaling scale-in** · **spot instance reclamation** · **OOM kills** · **node drains/maintenance**.
2. Stop accepting new messages → finish the current one → ack it → exit. It prevents **redelivery of in-flight work on every deploy**.
3. **Parallelism** — 1,000 independent chunks ran on 20 workers, cutting wall time from ~4 hours to ~15 minutes.
4. **Cron on every server** runs it N times. **Cron on one special server** silently stops when that server is replaced. The second is far harder to detect, because a job not running produces no error.
5. `INSERT INTO job_runs (job_name, scheduled_for) VALUES (...)` with a **`UNIQUE(job_name, scheduled_for)`** constraint. Every instance attempts it; exactly one insert succeeds and that instance runs the job.
6. Because **absence produces no error, log line or alert**. Detect it with a **dead man's switch** — the job reports success on each run, and the monitor alerts when a report fails to arrive within the expected window.
7. **Poll a status endpoint** (simple, universal) · **webhook** (server-to-server) · **SSE/WebSocket** (live UI progress) · **email/notification** (long jobs the user will leave).
8. Because most brokers implement them approximately or not at all, and even where supported, **a flood of high-priority messages starves low-priority ones entirely**. Separate queues with separate worker pools isolate them properly.
9. **Per-tenant queues with round-robin** · **weighted fair queuing** · **per-tenant concurrency limits**. The last is simplest and effective — a counter per tenant in Redis capping in-flight jobs.
10. **Arrival rate minus processing rate** predicts it (you are falling behind before anything looks wrong), and **oldest-message age** describes it in user-visible terms.

</details>

---

**Next:** [Backpressure and Flow Control](./04-backpressure.md) — what to do when you genuinely cannot keep up.
