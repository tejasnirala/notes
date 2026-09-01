---
title: Distributed Locks
author: Tejas Nirala
---

# Distributed Locks

> **What you will be able to do after this page**
>
> - Build a correct single-instance lock and justify every one of its four parts.
> - Explain the Redlock debate and take a defensible position.
> - Name the failure mode that no Redis lock can prevent, and design around it.
> - Know when a lock is the wrong tool entirely.

Distributed locks are the most-implemented and most-often-wrong Redis pattern. The code is ten lines; the reasoning is not.

---

## 1. The problem

```
   Three app servers. One scheduled job. No coordination.

   server-1  ──► sendMonthlyInvoices()  ┐
   server-2  ──► sendMonthlyInvoices()  ├─ all three run
   server-3  ──► sendMonthlyInvoices()  ┘  → every customer billed 3×
```

You want **mutual exclusion across processes** — at most one holder at a time. Redis is attractive for this because it is already there, it is fast, and its single thread makes `SET NX` genuinely atomic.

---

## 2. The correct single-instance lock

```bash
SET lock:resource <unique-token> NX PX 30000
```

Four parts, each load-bearing:

```
   SET lock:resource  <token>  NX  PX 30000
       └── the key ─┘  └─ 1 ─┘ └2┘  └── 3 ──┘

   1. A UNIQUE TOKEN per acquisition (a UUID)
      → so you can prove you still own it before releasing
   2. NX — set only if it does not exist
      → this is the atomic acquisition; no read-then-write race
   3. PX — an expiry
      → so a crashed holder does not deadlock everyone forever
   4. (not shown) A CONDITIONAL RELEASE, which requires Lua
```

### Why each part matters

**Without a unique token:**

```
   t=0   worker-A acquires the lock, TTL 30s
   t=35  worker-A is still working (a GC pause, a slow query)
         → its lock EXPIRED at t=30
   t=31  worker-B acquires the lock
   t=36  worker-A finishes and runs DEL lock:resource
         → it deletes WORKER-B's lock ❌
   t=37  worker-C acquires it. Now B and C both "hold" it.
```

**Without an expiry:** a worker that crashes holding the lock deadlocks the resource permanently. No timeout, no recovery, a human has to notice.

**Without `NX`:** the acquisition becomes read-then-write, and two clients can both observe "free" before either writes.

**Without a conditional release:** `GET` then `DEL` is two commands, so the lock can expire and be re-acquired between them — the same bug as having no token.

### The implementation

```ts
import { randomUUID } from 'node:crypto';
import { redis } from './redis';

const RELEASE_LUA = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  else
    return 0
  end
`;

const EXTEND_LUA = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
  else
    return 0
  end
`;

declare module 'ioredis' {
  interface RedisCommander<Context> {
    releaseLock(key: string, token: string): Promise<number>;
    extendLock(key: string, token: string, ttlMs: number): Promise<number>;
  }
}

redis.defineCommand('releaseLock', { numberOfKeys: 1, lua: RELEASE_LUA });
redis.defineCommand('extendLock',  { numberOfKeys: 1, lua: EXTEND_LUA });

export interface Lock {
  key: string;
  token: string;
  release(): Promise<boolean>;
  extend(ttlMs: number): Promise<boolean>;
}

export async function acquireLock(
  resource: string,
  ttlMs = 30_000,
  opts: { retries?: number; retryDelayMs?: number } = {},
): Promise<Lock | null> {
  const key = `lock:${resource}`;
  const token = randomUUID();
  const retries = opts.retries ?? 0;
  const delay = opts.retryDelayMs ?? 100;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ok = await redis.set(key, token, 'NX', 'PX', ttlMs);
    if (ok === 'OK') {
      return {
        key,
        token,
        release: async () => (await redis.releaseLock(key, token)) === 1,
        extend:  async (ms) => (await redis.extendLock(key, token, ms)) === 1,
      };
    }
    if (attempt < retries) {
      // jittered backoff, so contending workers do not synchronize
      await new Promise((r) => setTimeout(r, delay + Math.random() * delay));
    }
  }

  return null;
}

export async function withLock<T>(
  resource: string, ttlMs: number, fn: (lock: Lock) => Promise<T>,
): Promise<T> {
  const lock = await acquireLock(resource, ttlMs);
  if (!lock) throw new Error(`could not acquire lock:${resource}`);
  try {
    return await fn(lock);
  } finally {
    await lock.release();
  }
}
```

```ts
await withLock('invoices:monthly:2026-09', 300_000, async () => {
  await sendMonthlyInvoices();
});
```

---

## 3. The failure mode no Redis lock can prevent

:::danger[This is the core of the whole topic. Read it twice.]
```
   t=0    worker-A acquires the lock, TTL 30s
   t=5    worker-A begins work
   t=10   ⏸ worker-A stops — a stop-the-world GC pause, a hypervisor
          migration, a page fault storm, a suspended container.
          The PROCESS is frozen. It does not know time is passing.
   t=30   The lock EXPIRES in Redis.
   t=31   worker-B acquires the lock. Begins the same work.
   t=45   ▶ worker-A resumes. It has NO IDEA it lost the lock.
          It continues, and writes to the shared resource.

   → TWO WORKERS ARE IN THE CRITICAL SECTION SIMULTANEOUSLY.
```

**No lock service can prevent this** — not Redis, not ZooKeeper, not etcd, not Consul. The lock service knows its own state perfectly; what it cannot control is whether a client that was paused **notices** before it acts.

This is Martin Kleppmann's central point in the Redlock critique, and it is not a Redis-specific criticism. It is a property of distributed systems: **a lease can expire without the leaseholder observing it.**
:::

### The real defences

**1. Fencing tokens — the theoretically correct answer.**

```ts
// every acquisition gets a monotonically increasing number
const ACQUIRE_FENCED = `
  if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
    return redis.call('INCR', KEYS[2])
  end
  return nil
`;
redis.defineCommand('acquireFenced', { numberOfKeys: 2, lua: ACQUIRE_FENCED });

const fence = await redis.acquireFenced(`lock:${res}`, `fence:${res}`, token, ttlMs);
```

```
   worker-A acquires → fence token 33
   (worker-A pauses)
   lock expires
   worker-B acquires → fence token 34

   worker-B writes with token 34   → the storage records "last seen: 34"
   worker-A resumes, writes with 33 → the storage REJECTS it (33 < 34) ✅
```

The critical requirement: **the protected resource must check the token.** That means your database, S3 layer, or file system needs a conditional-write facility (`WHERE version < ?`, an S3 precondition, a compare-and-swap). If it does, fencing makes the lock genuinely safe. If it does not — and most systems do not — fencing tokens buy you nothing, and you are back to mitigation.

**2. Make the operation idempotent.** By far the most practical answer. If running twice is harmless, the lock is an *optimization* rather than a *correctness requirement*, and the whole problem class evaporates.

```ts
// ❌ running twice charges twice
await stripe.charges.create({ amount, customer });

// ✅ running twice is a no-op
await stripe.charges.create({ amount, customer }, { idempotencyKey: `invoice:${invoiceId}` });
```

**3. Keep the critical section far shorter than the TTL.** If the work takes 2 seconds and the TTL is 60, a pause long enough to matter is very unlikely.

**4. Extend the lock while working (a watchdog).**

```ts
async function withLockWatchdog<T>(
  resource: string, ttlMs: number, fn: () => Promise<T>,
): Promise<T> {
  const lock = await acquireLock(resource, ttlMs);
  if (!lock) throw new Error('lock unavailable');

  let lost = false;
  const timer = setInterval(async () => {
    const ok = await lock.extend(ttlMs);
    if (!ok) { lost = true; clearInterval(timer); }   // we no longer own it
  }, Math.floor(ttlMs / 3));

  try {
    const result = await fn();
    if (lost) throw new Error('lock was lost mid-operation — result is unsafe');
    return result;
  } finally {
    clearInterval(timer);
    await lock.release();
  }
}
```

A watchdog **narrows** the window; it does not close it. The same GC pause that let the lock expire also pauses the watchdog. It is a genuine improvement and not a proof.

---

## 4. Redlock — the multi-instance algorithm

antirez designed **Redlock** for the case where a single Redis instance is itself a single point of failure.

```
   5 INDEPENDENT Redis primaries (no replication between them)

   To acquire:
     1. Record the start time.
     2. Try SET NX PX on ALL 5, with a short per-instance timeout.
     3. Count successes. Compute elapsed time.
     4. The lock is HELD if:
            successes >= 3  (a majority, N/2 + 1)
        AND elapsed < TTL
     5. The VALIDITY TIME = TTL − elapsed − clock_drift.
        This is how long you may safely hold it.
     6. On failure, release on ALL instances (including ones you may
        have succeeded on without noticing).
```

```
   ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
   │ R1 │ │ R2 │ │ R3 │ │ R4 │ │ R5 │
   └─▲──┘ └─▲──┘ └─▲──┘ └─▲──┘ └─▲──┘
     │ ✅   │ ✅   │ ✅   │ ❌   │ ❌
     └──────┴──────┴──────┴──────┘
        3 of 5 = a majority → the lock is held
        Losing up to 2 instances does not lose the lock.
```

### The critique

Martin Kleppmann's argument, and Redlock's honest weaknesses:

1. **It depends on bounded clock drift.** Redlock's safety argument assumes clocks advance at roughly the same rate everywhere. An NTP step, a leap-second bug, or a VM snapshot restore breaks that assumption and can make two clients hold the lock simultaneously.
2. **It does not solve the pause problem** — nothing does, without fencing tokens.
3. **It provides no fencing tokens.** There is no monotonic counter you can hand to the protected resource.
4. **It is five times the operational cost** — five independent Redis deployments — for a guarantee that is still not a guarantee.

antirez's response was, in essence: the pause criticism applies equally to ZooKeeper and every other lock service; the clock assumption is bounded and practically satisfiable; and Redlock targets **efficiency** locks, not **correctness** locks.

That distinction is the useful takeaway:

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  EFFICIENCY LOCK                                                 │
   │  "Don't do this work twice — it's wasteful."                     │
   │  Occasional double-execution costs money or CPU, not correctness.│
   │  → a single-instance Redis lock is FINE. Redlock is overkill.    │
   ├──────────────────────────────────────────────────────────────────┤
   │  CORRECTNESS LOCK                                                │
   │  "If two run, data is corrupted or money is lost."               │
   │  → Redis is NOT SUFFICIENT, with or without Redlock.             │
   │  → Use a database transaction, a unique constraint, a conditional│
   │    write, or a consensus system with fencing (ZooKeeper/etcd).   │
   └──────────────────────────────────────────────────────────────────┘
```

:::tip[The position to take in an interview]
"For efficiency locks — preventing duplicate work — a single-instance `SET NX PX` with a UUID and a Lua release is correct and sufficient. For correctness locks, I would not use Redis at all: I would push the invariant into the database with a unique constraint or a conditional update, because that is the system that actually owns the data. Redlock sits awkwardly between the two: five times the operational cost, and it still cannot survive a client pause without fencing tokens that the protected resource has to honour anyway."

That answer shows you know the algorithm, the critique, and — most importantly — that the right move is usually to avoid needing a distributed lock.
:::

### If you do use Redlock

```ts
import Redlock from 'redlock';
import Redis from 'ioredis';

const redlock = new Redlock(
  [
    new Redis('redis://node-1:6379'),
    new Redis('redis://node-2:6379'),
    new Redis('redis://node-3:6379'),
  ],
  { retryCount: 3, retryDelay: 200, retryJitter: 200, driftFactor: 0.01 },
);

await redlock.using(['resource:x'], 30_000, async (signal) => {
  await doWork();
  if (signal.aborted) throw signal.error;      // the lock was lost — bail out
});
```

Use the library. The `signal.aborted` check is the watchdog pattern built in, and it is the part hand-rolled implementations forget.

:::danger[Do not run Redlock against a primary–replica pair]
```
   client acquires the lock on the PRIMARY
   the primary dies BEFORE the write replicates (replication is async)
   a replica is promoted — it has NO lock
   a second client acquires the "same" lock  → two holders
```
Redlock requires **N independent primaries with no replication between them**. Running it against one Sentinel-managed cluster gives you the cost without the guarantee — and is a common misimplementation.
:::

---

## 5. When not to use a lock

Most "I need a distributed lock" problems have a better answer.

| Instead of a lock | Use |
| :--- | :--- |
| "Only process this job once" | A [Stream consumer group](./11-streams.md) — the server guarantees one consumer per entry |
| "Only one instance runs this cron" | A leader election with a TTL key, or your scheduler's own singleton support |
| "Prevent duplicate order creation" | A **unique constraint in the database** — the strongest guarantee available |
| "Atomic read-modify-write on one key" | A [Lua script](./17-transactions-and-scripting.md) — atomic by construction, no lock |
| "Prevent a cache stampede" | The lock is an *efficiency* lock here, so a simple one is fine — or use [probabilistic early expiration](./25-caching-patterns.md) |
| "Rate limit" | [`INCR` with a TTL](./27-rate-limiting.md) — atomic, no lock |
| "Only one worker per user" | Partition the work by `hash(userId) % N` so no two workers can collide by construction |

:::tip[The single best piece of advice on this page]
**Design the lock away.**

A unique constraint, an idempotency key, a partitioned work assignment, or an atomic Lua script gives you a *guarantee*. A distributed lock gives you a *probabilistic mitigation*. Prefer the guarantee.

If you cannot avoid a lock, keep it an efficiency lock — make the operation idempotent so that a double execution is a wasted cycle rather than an incident.
:::

---

## 6. Leader election — a lock with a lease

A very common, well-suited use: exactly one instance should run scheduled jobs.

```ts
const LEADER_KEY = 'leader:scheduler';
const INSTANCE_ID = randomUUID();
const LEASE_MS = 15_000;

let isLeader = false;

async function campaign(): Promise<void> {
  // try to take leadership
  const won = await redis.set(LEADER_KEY, INSTANCE_ID, 'NX', 'PX', LEASE_MS);
  if (won === 'OK') {
    if (!isLeader) log.info('became leader');
    isLeader = true;
    return;
  }

  // already leader? renew the lease
  const renewed = await redis.extendLock(LEADER_KEY, INSTANCE_ID, LEASE_MS);
  if (renewed === 1) { isLeader = true; return; }

  if (isLeader) log.warn('lost leadership');
  isLeader = false;
}

setInterval(campaign, LEASE_MS / 3);        // renew well before expiry

setInterval(async () => {
  if (!isLeader) return;
  await runScheduledJobs();
}, 60_000);
```

```
   Renew at TTL/3, not TTL/2. If one renewal fails transiently, you get two
   more attempts before the lease expires — so a single dropped packet does
   not trigger a leadership change.
```

Note the same caveat applies: a paused leader may believe it is still the leader. So `runScheduledJobs()` should be idempotent, or should itself use per-job idempotency keys.

---

## 7. Operating locks

```bash
redis-cli --scan --pattern 'lock:*'            # what is currently held?
redis-cli TTL lock:invoices:monthly            # how long until it frees?
redis-cli GET lock:invoices:monthly            # which token holds it?
```

```ts
// alert on locks that are held far longer than expected
const stream = redis.scanStream({ match: 'lock:*', count: 100 });
for await (const keys of stream) {
  for (const key of keys) {
    const ttl = await redis.pttl(key);
    if (ttl > 300_000) log.warn({ key, ttl }, 'lock held unusually long');
    if (ttl === -1)    log.error({ key }, 'LOCK WITH NO TTL — will deadlock forever');
  }
}
```

**`TTL == -1` on a lock key is a bug, always.** It means someone acquired without `PX`, or a plain `SET` overwrote the lock and cleared its expiry. That lock will never release.

:::danger[Never put locks on an instance with an eviction policy]
```
   maxmemory-policy allkeys-lru
   → a traffic spike fills memory
   → Redis evicts lock:invoices:monthly
   → a second worker acquires it
   → two workers in the critical section, with no pause and no bug in your code
```

Locks belong on an instance with `maxmemory-policy noeviction`, separate from your cache. This is the concrete scenario behind the two-instance recommendation in [Expiration & Eviction](./15-expiration-and-eviction.md), and it is a *silent* correctness failure — nothing errors, nothing logs.
:::

---

## Rapid-fire recall

1. Write the acquisition command and justify each of its parts.
2. Why can you not release a lock with `DEL`?
3. Why does the token have to be unique per acquisition?
4. Describe the pause scenario. Which lock service prevents it?
5. What is a fencing token, and what must be true for it to help?
6. What is the majority rule in Redlock, and what two assumptions does it rest on?
7. Distinguish an efficiency lock from a correctness lock. Which is Redis suitable for?
8. Why is Redlock against a Sentinel-managed primary–replica pair wrong?
9. Give three problems where the right answer is "don't use a lock".
10. Why must locks never live on an instance with `allkeys-lru`?

<details>
<summary>Answers</summary>

1. `SET lock:resource <uuid> NX PX 30000`. The UUID proves ownership at release; `NX` makes acquisition atomic; `PX` prevents a crashed holder deadlocking forever; and release must be a Lua compare-and-delete.
2. `GET` then `DEL` is two commands. The lock can expire and be re-acquired by someone else in between, and your `DEL` then deletes *their* lock.
3. Without it you cannot distinguish "my lock" from "someone else's lock that replaced mine after expiry", so you can release a lock you no longer hold.
4. A client acquires the lock, then freezes (GC pause, hypervisor migration, page-fault storm). The lock expires, another client takes it, and the first resumes still believing it holds the lock. **No lock service prevents this** — not ZooKeeper, etcd, or Consul.
5. A monotonically increasing number issued with each acquisition. It only helps if the **protected resource** checks it and rejects writes bearing an older token — which requires a conditional-write facility there.
6. Acquire on N/2+1 of N independent primaries within less than the TTL. It assumes bounded clock drift between nodes, and that the elapsed-time measurement is reliable.
7. An efficiency lock prevents wasted duplicate work; a correctness lock prevents data corruption. Redis is suitable for efficiency locks. For correctness, push the invariant into the database (unique constraint, conditional update).
8. Replication is asynchronous, so the primary can acknowledge the lock and die before it replicates. The promoted replica has no lock, and a second client acquires it. Redlock needs N **independent** primaries with no replication between them.
9. "Process this job once" → a Stream consumer group. "Prevent duplicate orders" → a database unique constraint. "Atomic read-modify-write" → a Lua script. (Also: rate limiting → `INCR` with a TTL; per-user serialization → partition the work.)
10. Under memory pressure Redis will evict the lock key, letting a second holder acquire it — a silent correctness failure with no error and no log line. Locks need `noeviction`.

</details>

---

**Next:** [Rate Limiting](./27-rate-limiting.md) — four algorithms, traced, with the trade-offs made explicit.
