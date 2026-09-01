---
title: Queues & Background Jobs
author: Tejas Nirala
---

# Queues & Background Jobs

> **What you will be able to do after this page**
>
> - List the eight things a production job system needs, and check any design against them.
> - Build a reliable queue on Lists and on Streams, and say which to pick.
> - Use BullMQ properly, and know what it is doing underneath.
> - Explain at-least-once delivery and why idempotency is not optional.

Background jobs are the second-most-common Redis workload after caching. The naive version is four lines; the production version is this page.

---

## 1. What a production job system actually needs

```
   □ 1. DURABILITY        a job survives a worker crash
   □ 2. ACKNOWLEDGEMENT   a job is only removed once it genuinely succeeded
   □ 3. RETRIES           with exponential backoff, not an instant retry storm
   □ 4. DEAD LETTERING    a poison job stops after N attempts instead of looping
   □ 5. PRIORITIES        urgent work jumps the queue
   □ 6. DELAYED JOBS      "run this in 30 minutes"
   □ 7. CONCURRENCY       N workers, no duplicate delivery
   □ 8. OBSERVABILITY     queue depth, processing time, failure rate
```

Measure any design against those eight. A `LPUSH`/`BRPOP` pair satisfies exactly one.

---

## 2. The naive version, and why it loses jobs

```ts
// producer
await redis.lpush('queue:emails', JSON.stringify(job));

// worker
for (;;) {
  const [, raw] = (await blocking.brpop('queue:emails', 0))!;
  await handle(JSON.parse(raw));
}
```

```
   THE FAILURE

   t=0   worker pops job-42.  It is now OUT of Redis and IN worker memory.
   t=1   the worker begins processing
   t=2   💥 the worker is OOM-killed / the pod is evicted / the host dies

   job-42 exists nowhere. It is not in the queue. It was never completed.
   Nobody will ever know it existed.
```

Good for genuinely disposable work. Unacceptable for anything a user is waiting on.

---

## 3. Reliable queues on Lists

Move the job atomically to a per-worker processing list instead of removing it.

```
   BLMOVE queue processing:worker-3 RIGHT LEFT 0

   BEFORE                              AFTER
   queue:              [j4 j3 j2 j1]   queue:              [j4 j3 j2]
   processing:worker-3 []              processing:worker-3 [j1]
                                                            ▲
                                       atomically moved — never absent
                                       from both lists
```

```ts
const QUEUE = 'queue:emails';
const PROCESSING = `processing:${WORKER_ID}`;
const DLQ = 'queue:emails:dead';
const MAX_ATTEMPTS = 5;

interface Job { id: string; type: string; payload: unknown; attempts: number }

async function work(): Promise<void> {
  // heartbeat, so the janitor can tell whether we are alive
  setInterval(() => redis.set(`worker:${WORKER_ID}:alive`, '1', 'EX', 30), 10_000);

  for (;;) {
    const raw = await blocking.blmove(QUEUE, PROCESSING, 'RIGHT', 'LEFT', 0);
    if (raw === null) continue;

    const job = JSON.parse(raw) as Job;

    try {
      await handle(job);
      await redis.lrem(PROCESSING, 1, raw);              // ACK
      metrics.increment('jobs.completed', { type: job.type });
    } catch (err) {
      job.attempts += 1;
      metrics.increment('jobs.failed', { type: job.type });

      const pipe = redis.multi().lrem(PROCESSING, 1, raw);

      if (job.attempts >= MAX_ATTEMPTS) {
        pipe.lpush(DLQ, JSON.stringify({ ...job, failedAt: Date.now(), error: String(err) }));
        log.error({ err, jobId: job.id }, 'job dead-lettered');
      } else {
        // exponential backoff with jitter, via the delayed-jobs zset (§5)
        const delayMs = Math.min(2 ** job.attempts * 1000, 300_000);
        const runAt = Date.now() + delayMs + Math.random() * 1000;
        pipe.zadd('queue:emails:delayed', runAt, JSON.stringify(job));
      }

      await pipe.exec();
    }
  }
}
```

And a janitor to reclaim jobs stranded by a dead worker:

```ts
async function reclaimOrphans(): Promise<void> {
  const stream = redis.scanStream({ match: 'processing:*', count: 100 });

  for await (const keys of stream) {
    for (const key of keys) {
      const workerId = key.slice('processing:'.length);
      if (await redis.exists(`worker:${workerId}:alive`)) continue;   // still alive

      let moved = 0;
      for (;;) {
        const job = await redis.lmove(key, QUEUE, 'RIGHT', 'LEFT');
        if (job === null) break;
        moved++;
      }
      if (moved) log.warn({ workerId, moved }, 'reclaimed jobs from a dead worker');
    }
  }
}

setInterval(reclaimOrphans, 30_000);
```

**Scorecard:** durability ✅, acknowledgement ✅, retries ✅, dead-lettering ✅, concurrency ✅ — but priorities, delays, and observability all have to be bolted on, and you now maintain a janitor, a heartbeat, and a backoff scheduler. That is a lot of infrastructure to own.

---

## 4. Reliable queues on Streams

[Streams](./11-streams.md) put the delivery tracking **in the server**.

```ts
const STREAM = 'jobs:emails';
const GROUP = 'workers';
const CONSUMER = `worker-${process.pid}`;

// producer — cap the stream so it cannot grow forever
await redis.xadd(STREAM, 'MAXLEN', '~', 100_000, '*',
  'type', 'welcome-email', 'userId', String(userId));

async function work(): Promise<void> {
  try { await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM'); }
  catch (e) { if (!String(e).includes('BUSYGROUP')) throw e; }

  // 1. drain OUR OWN pending entries first (recovery after a restart)
  await drainPending();

  // 2. then take new work
  for (;;) {
    const res = await redis.xreadgroup(
      'GROUP', GROUP, CONSUMER, 'COUNT', 10, 'BLOCK', 5000,
      'STREAMS', STREAM, '>',
    );
    if (!res) continue;

    for (const [, entries] of res as [string, [string, string[]][]][]) {
      for (const [id, fields] of entries) {
        try {
          await handle(toObject(fields));
          await redis.xack(STREAM, GROUP, id);           // ACK
        } catch (err) {
          log.error({ err, id }, 'job failed — leaving pending for reclaim');
        }
      }
    }
  }
}
```

```ts
// reclaim entries whose owner died, with dead-lettering
const MAX_DELIVERIES = 5;

async function reclaim(): Promise<void> {
  let cursor = '0-0';
  do {
    const [next, entries] = (await redis.xautoclaim(
      STREAM, GROUP, CONSUMER, 60_000, cursor, 'COUNT', 50,
    )) as [string, [string, string[]][], string[]];
    cursor = next;

    for (const [id, fields] of entries) {
      if (fields === null) { await redis.xack(STREAM, GROUP, id); continue; }

      const pending = (await redis.xpending(STREAM, GROUP, '-', '+', 1, CONSUMER)) as
        [string, string, number, number][];
      const deliveries = pending[0]?.[3] ?? 1;

      if (deliveries > MAX_DELIVERIES) {
        await redis.xadd(`${STREAM}:dead`, '*', 'originalId', id, ...fields);
        await redis.xack(STREAM, GROUP, id);
        log.error({ id, deliveries }, 'dead-lettered');
        continue;
      }

      try { await handle(toObject(fields)); await redis.xack(STREAM, GROUP, id); }
      catch { /* leave it pending for the next sweep */ }
    }
  } while (cursor !== '0-0');
}

setInterval(reclaim, 30_000);
```

**Scorecard:** durability ✅, acknowledgement ✅ (server-tracked), retries ✅ (via `XAUTOCLAIM`), dead-lettering ✅, concurrency ✅ (the group guarantees one consumer per entry), observability ✅ (`XPENDING`, `XINFO GROUPS`, `lag`). Priorities and delays still need extra structure — but the janitor, the heartbeat, and the per-worker processing lists are **all gone**, replaced by the PEL.

### Lists vs Streams

| | List + `BLMOVE` | Stream + consumer group |
| :--- | :--- | :--- |
| Delivery tracking | You build it | **Server-side (PEL)** |
| Crash recovery | Your janitor + heartbeat | `XAUTOCLAIM` |
| Delivery count | You store it in the payload | **Built in** |
| Queue depth | `LLEN` | `XLEN` + `lag` |
| Job history | Gone once acked | Retained until trimmed — **replayable** |
| Multiple independent consumers | ❌ | ✅ (one group each) |
| Memory | Lower | Higher (entries persist, PEL tracked) |
| Complexity | More app code | More Redis concepts |

**Prefer Streams for new work.** The PEL replaces roughly a hundred lines of janitor code you would otherwise have to write, test, and operate.

---

## 5. Delayed and scheduled jobs

A sorted set scored by run time, plus a promoter.

```
   ZADD jobs:delayed <runAtMs> <job>

   ┌──────────────────────────────────────────────────────────┐
   │ 12:00:30 │ 12:00:45 │ 12:01:00 │ 12:05:00 │ 13:00:00     │
   └──────────────────────────────────────────────────────────┘
              now = 12:00:50
              ├── these two are DUE ──┤
              → move them atomically into the ready queue
```

```lua
-- PROMOTE_DUE
-- KEYS[1] = the delayed zset, KEYS[2] = the ready stream
-- ARGV[1] = now_ms, ARGV[2] = max jobs to promote
local due = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, ARGV[2])
if #due == 0 then return 0 end
for _, job in ipairs(due) do
  redis.call('XADD', KEYS[2], '*', 'payload', job)
end
redis.call('ZREM', KEYS[1], unpack(due))
return #due
```

```ts
redis.defineCommand('promoteDue', { numberOfKeys: 2, lua: PROMOTE_DUE });

export const schedule = (job: Job, runAt: number) =>
  redis.zadd('jobs:delayed', runAt, JSON.stringify(job));

setInterval(async () => {
  const promoted = await redis.promoteDue('jobs:delayed', STREAM, Date.now(), 100);
  if (promoted) metrics.increment('jobs.promoted', promoted);
}, 1000);
```

:::danger[The promoter must be a Lua script]
Without it: two promoter instances both run `ZRANGEBYSCORE`, both see the same due jobs, and both enqueue them. Every delayed job runs twice.

The script makes read-move-delete atomic. It is also why running several promoter replicas is safe — exactly one wins each batch.

Note also the promotion granularity is your poll interval, so a 1-second tick means up to 1 second of scheduling imprecision. That is almost always fine; if it is not, you need a different system, not a smaller interval.
:::

---

## 6. Priorities

**Option A — several streams, checked in order.**

```ts
for (;;) {
  const res = await redis.xreadgroup(
    'GROUP', GROUP, CONSUMER, 'COUNT', 10, 'BLOCK', 1000,
    'STREAMS', 'jobs:high', 'jobs:normal', 'jobs:low', '>', '>', '>',
  );
  // Redis returns entries from each stream that has any; process high first
}
```

Simple and effective. **Watch for starvation** — if `jobs:high` is never empty, `jobs:low` never runs. A common fix is to dedicate a fraction of workers to low-priority work regardless.

**Option B — a sorted set as a priority queue.**

```ts
await redis.zadd('jobs:priority', priority, JSON.stringify(job));
const [job] = await blocking.bzpopmin('jobs:priority', 0);      // lowest score first
```

True priority ordering with blocking consumption in one command. The trade-off: you lose the PEL, so you are back to building acknowledgement yourself.

---

## 7. BullMQ — use this in production

Everything above, already built and battle-tested.

```bash
npm install bullmq
```

```ts
// src/queues.ts
import { Queue, Worker, QueueEvents, type Job } from 'bullmq';
import { redis } from './redis';

const connection = { host: 'localhost', port: 6379, maxRetriesPerRequest: null };
//                                       ↑ BullMQ REQUIRES this to be null

export interface EmailJob { to: string; template: string; vars: Record<string, string> }

export const emailQueue = new Queue<EmailJob>('emails', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },   // 1s, 2s, 4s, 8s, 16s
    removeOnComplete: { age: 3600, count: 1000 },    // ← or Redis fills up
    removeOnFail: { age: 86_400 },
  },
});
```

```ts
// producing
await emailQueue.add('welcome', { to, template: 'welcome', vars: { name } });

await emailQueue.add('digest', payload, { delay: 60_000 });          // delayed
await emailQueue.add('urgent', payload, { priority: 1 });            // 1 = highest
await emailQueue.add('daily', payload, { repeat: { pattern: '0 9 * * *' } });  // cron
await emailQueue.add('once', payload, { jobId: `welcome:${userId}` });
//                                       ↑ DEDUPLICATION: the same jobId is
//                                         only ever enqueued once
```

```ts
// consuming
const worker = new Worker<EmailJob>(
  'emails',
  async (job: Job<EmailJob>) => {
    await job.updateProgress(10);
    await sendEmail(job.data);
    await job.updateProgress(100);
    return { sentAt: Date.now() };
  },
  {
    connection,
    concurrency: 10,
    limiter: { max: 100, duration: 60_000 },       // 100 jobs/minute, cluster-wide
  },
);

worker.on('completed', (job) => metrics.increment('jobs.completed', { name: job.name }));
worker.on('failed',    (job, err) => log.error({ err, jobId: job?.id }, 'job failed'));
worker.on('error',     (err) => log.error({ err }, 'worker error'));

// graceful shutdown — let in-flight jobs finish
process.on('SIGTERM', async () => {
  await worker.close();
  await emailQueue.close();
  process.exit(0);
});
```

```ts
// observability
const counts = await emailQueue.getJobCounts(
  'waiting', 'active', 'completed', 'failed', 'delayed', 'paused',
);
// { waiting: 42, active: 10, completed: 100000, failed: 3, delayed: 5, paused: 0 }

const failed = await emailQueue.getFailed(0, 10);
for (const job of failed) await job.retry();          // manual retry

await emailQueue.pause();                              // stop taking new work
await emailQueue.resume();
await emailQueue.drain();                              // discard waiting jobs
```

BullMQ additionally gives you **flows** (parent jobs that wait for children), **sandboxed processors** (CPU-heavy jobs in a separate process so they do not block the event loop), and **Bull Board** — a web UI for inspecting and retrying jobs.

Internally it is exactly the primitives from these notes: Lists for waiting jobs, sorted sets for delayed and prioritized jobs, hashes for job state, Pub/Sub for events, and Lua scripts for every atomic state transition. Nothing magic — just the hundred lines you did not have to debug.

:::warning[Three BullMQ configuration mistakes]
1. **`maxRetriesPerRequest: null` is required.** BullMQ manages its own retry semantics; ioredis's default of 20 causes hard-to-diagnose failures during a reconnect.
2. **Set `removeOnComplete`.** Without it, every completed job's hash is kept forever. A million jobs a day will fill your instance in a week, and this is the single most common BullMQ production incident.
3. **BullMQ needs `noeviction`.** It is state, not cache. On an `allkeys-lru` instance, Redis will evict job hashes under pressure and jobs vanish mid-flight, silently.
:::

---

## 8. At-least-once, and why idempotency is mandatory

**Every Redis-based queue is at-least-once.** So are SQS, RabbitMQ (in practice), and Kafka without transactions.

```
   t=0   the worker receives job-42
   t=1   the worker charges the customer $50   ← the SIDE EFFECT happened
   t=2   💥 the worker dies before ACKing
   t=60  the janitor / XAUTOCLAIM reclaims job-42
   t=61  another worker charges the customer $50 AGAIN
```

There is no way to make "do the side effect" and "acknowledge the job" a single atomic operation across two systems. So the handler must be safe to run twice.

```ts
// ❌ not idempotent
async function handle(job: Job) {
  await stripe.charges.create({ amount: job.payload.amount, customer: job.payload.customer });
}

// ✅ idempotent via a provider-supported idempotency key
async function handle(job: Job) {
  await stripe.charges.create(
    { amount: job.payload.amount, customer: job.payload.customer },
    { idempotencyKey: `job:${job.id}` },
  );
}

// ✅ idempotent via a Redis marker (when the provider has no support)
async function handle(job: Job) {
  const claimed = await redis.set(`job:done:${job.id}`, '1', 'NX', 'EX', 86_400);
  if (claimed !== 'OK') { log.info({ id: job.id }, 'already processed — skipping'); return; }
  await doTheWork(job);
}

// ✅ idempotent via a database unique constraint — the STRONGEST option
async function handle(job: Job) {
  await db.query(
    'INSERT INTO sent_emails (job_id, recipient) VALUES ($1, $2) ON CONFLICT (job_id) DO NOTHING',
    [job.id, job.payload.to],
  );
}
```

:::warning[The Redis-marker approach has a gap]
Setting the marker *before* the work means a crash mid-work leaves the job marked done but not actually done. Setting it *after* means a crash after the work but before the marker allows a re-run.

There is no perfect answer without a transaction spanning both systems. **The database unique constraint is the strongest option** because the marker and the effect are in the same transaction. Prefer it whenever the side effect touches your own database.
:::

---

## 9. Choosing

```
   Do you need retries, dead-lettering, delays, and priorities?
        │
   ┌────┴────┐
   YES       NO
    │         │
   BULLMQ    Is losing a job acceptable?
   (do not        │
    rebuild  ┌────┴────┐
    this)   YES        NO
             │          │
        LIST +      STREAM +
        BRPOP       consumer group
        (simplest)  (server-side ACK,
                     retries, replay)
```

| | List + `BRPOP` | List + `BLMOVE` | Stream + group | **BullMQ** |
| :--- | :--- | :--- | :--- | :--- |
| Durability | ❌ | ✅ | ✅ | ✅ |
| Acknowledgement | ❌ | manual | **server** | ✅ |
| Retries + backoff | ❌ | you build it | you build it | ✅ |
| Dead letter | ❌ | you build it | you build it | ✅ |
| Delayed | ❌ | + zset | + zset | ✅ |
| Priorities | ❌ | multi-queue | multi-stream | ✅ |
| Repeatable / cron | ❌ | ❌ | ❌ | ✅ |
| Dashboard | ❌ | ❌ | ❌ | ✅ |
| Lines of your code | ~5 | ~150 | ~100 | ~20 |

:::tip[The honest recommendation]
**Use BullMQ.** Understanding the primitives underneath — which is what pages 6, 9, and 11 gave you — makes you able to debug it, tune it, and know its limits. It does not mean you should rebuild it.

Build it yourself only when your requirements are genuinely simpler than BullMQ (a fire-and-forget notification fan-out) or genuinely stranger than it (an unusual scheduling model). "We want fewer dependencies" is not a good enough reason to own a distributed job system.
:::

---

## Rapid-fire recall

1. List the eight requirements of a production job system.
2. Exactly how does `LPUSH` + `BRPOP` lose a job?
3. What does `BLMOVE` change, and what does it still leave you to build?
4. What replaces the janitor and heartbeat when you use Streams?
5. Why must the delayed-job promoter be a Lua script?
6. What is starvation in a multi-priority queue, and how do you mitigate it?
7. Name the three most common BullMQ misconfigurations.
8. Why is every Redis queue at-least-once rather than exactly-once?
9. Which idempotency approach is strongest, and why?
10. When should you build a queue yourself instead of using BullMQ?

<details>
<summary>Answers</summary>

1. Durability, acknowledgement, retries with backoff, dead-lettering, priorities, delayed jobs, safe concurrency, and observability.
2. `BRPOP` removes the job from Redis before it is processed. If the worker dies mid-job, the job exists nowhere — not in the queue, not completed, and unrecoverable.
3. It atomically moves the job to a per-worker processing list, so a crash leaves it recoverable. You still build the heartbeat, the janitor that reclaims orphans, retry backoff, dead-lettering, priorities, and delays.
4. The Pending Entries List. `XREADGROUP` records delivery, `XACK` clears it, and `XAUTOCLAIM` reassigns entries idle beyond a threshold — with a delivery count for dead-lettering.
5. Otherwise two promoters both read the same due jobs and both enqueue them, so every delayed job runs twice. The script makes read-move-delete atomic.
6. If a higher-priority queue is never empty, lower-priority jobs never run. Mitigate by dedicating a fraction of workers to low-priority work regardless of backlog.
7. Not setting `maxRetriesPerRequest: null`; omitting `removeOnComplete` so completed job hashes accumulate forever; and running it on an `allkeys-lru` instance where job state gets evicted.
8. The side effect and the acknowledgement are in two different systems and cannot be made atomic. A crash between them forces a redelivery.
9. A database unique constraint, because the idempotency marker and the side effect are committed in the same transaction — there is no window where one exists without the other.
10. When your requirements are genuinely simpler (fire-and-forget fan-out) or genuinely unusual (a scheduling model BullMQ does not express). "Fewer dependencies" is not sufficient reason to own a distributed job system.

</details>

---

**Next:** [Anti-Patterns & The Production Playbook](./29-antipatterns-and-production-playbook.md) — every mistake in these notes, collected.
