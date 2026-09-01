---
title: "Internals: Expiration & Eviction"
author: Tejas Nirala
---

# Internals: Expiration & Eviction

> **What you will be able to do after this page**
>
> - State the difference between expiry and eviction in one sentence, and diagnose which one ate your key.
> - Choose the right `maxmemory-policy` for a given workload and defend the choice.
> - Explain approximated LRU and the LFU counter's logarithmic increment and decay.
> - Set `maxmemory` to a number you can justify.

Two separate mechanisms delete keys. Confusing them is the source of a whole category of production mysteries.

| | **Expiration** | **Eviction** |
| :--- | :--- | :--- |
| Why | A TTL you set has passed | `maxmemory` was reached |
| Which keys | Only keys with a TTL | Depends on `maxmemory-policy` |
| Predictable | Yes — you chose the time | No — depends on memory pressure |
| You control it with | `EXPIRE` | `maxmemory-policy` |
| `INFO stats` counter | `expired_keys` | `evicted_keys` |

**"My key disappeared before its TTL"** is always eviction. **"My key is still there after its TTL"** is lazy expiry (it is logically gone, just not yet collected).

---

# Part 1 — Expiration

## 1.1 The `expires` dictionary

Every database keeps two dicts:

```
   db->dict     : key → value             (every key)
   db->expires  : key → expire-at-ms      (ONLY keys with a TTL)
                  ↑ the same key SDS pointer is shared, not duplicated
```

```bash
127.0.0.1:6379> INFO keyspace
db0:keys=1000000,expires=250000,avg_ttl=3600000
#      total ────┘         └── have a TTL      └── average remaining TTL
```

`expires` costs an extra ~30–50 bytes per key with a TTL. Worth knowing when you are considering putting a TTL on 100 million keys.

## 1.2 Lazy expiration — on access

```
   GET session:abc
        │
        ▼
   expireIfNeeded(db, key)
        │
        ├── is the key in db->expires?
        │      no  → proceed with the lookup
        │      yes → is now_ms > expire_at?
        │              no  → proceed
        │              yes → ┌ delete the key from dict and expires
        │                    ├ propagate an explicit DEL/UNLINK to the AOF
        │                    ├ propagate it to every replica
        │                    ├ fire the "expired" keyspace notification
        │                    └ signal the key as modified (WATCH)
        ▼
   the caller sees (nil)
```

**A key that expires and is never accessed again is never freed by this path.** If lazy expiry were the only mechanism, a write-heavy workload with TTLs would leak until OOM.

## 1.3 Active expiration — the probabilistic sweep

`activeExpireCycle()` runs inside `serverCron` (10 times/second) and in a fast variant inside `beforeSleep` (every event-loop iteration, ~1 ms budget).

```
   FOR each database:
     LOOP:
       1. Sample up to 20 random keys from db->expires
       2. Delete those already expired; count them
       3. IF expired_count > 20 × 25%  (i.e. more than 5 of 20)
              → the dict is probably full of dead keys, LOOP again immediately
          ELSE
              → stop; the rest can wait for the next tick
     Bounded by a time budget:
       SLOW cycle: up to 25% of one hz period  (config: active-expire-effort)
       FAST cycle: ~1 ms, at most once per 2 ms
```

```
   Sample 20 →  ●●●●●●●●●●●●●●●○○○○○   15/20 = 75%  → loop again, aggressively
   Sample 20 →  ●●●●●●●○○○○○○○○○○○○○    7/20 = 35%  → loop again
   Sample 20 →  ●●●○○○○○○○○○○○○○○○○○    3/20 = 15%  → stop, we're clean enough
                ● expired   ○ alive

   The cost is proportional to how many keys are ACTUALLY expired,
   not to how many keys exist. A 100-million-key database with few
   expired keys costs almost nothing to sweep.
```

```conf
hz 10                      # serverCron frequency. 10–100. Higher = more
                           # responsive expiry, more CPU.
dynamic-hz yes             # scale hz up automatically with client count
active-expire-effort 1     # 1–10. Higher = more aggressive, more CPU/latency.
```

The mathematics: the algorithm converges so that **fewer than 25% of keys with TTLs are expired-but-present at any time**, in expectation, without ever scanning the full keyspace.

:::note[Four observable consequences]
1. **`DBSIZE` overcounts** — it includes expired-but-uncollected keys.
2. **`used_memory` lags** behind what "should" have been freed.
3. **`RANDOMKEY` never returns an expired key** — it filters them explicitly.
4. **Memory does not drop the instant a TTL passes.** If you are watching a graph waiting for a cliff, you will not see one.
:::

## 1.4 Expiry on replicas — and why it works this way

**A replica never expires a key on its own initiative.**

```
   PRIMARY                                REPLICA
   ─────────────────────────────          ────────────────────────────────
   key expires at t=100
   t=105: activeExpireCycle finds it
          → deletes it
          → propagates DEL to replicas ──►  now the replica deletes it

   Meanwhile, between t=100 and t=105:
   a read on the REPLICA for that key
       → the replica CHECKS the clock and returns (nil)
       → but it does NOT delete the key
```

Why the split? **Consistency.** If replicas expired keys independently, clock drift between machines would make primary and replica diverge — and a replica promoted after a failover would have a different dataset than the one that was serving reads. Making deletion flow only from the primary keeps replication a strict, deterministic log.

The read-time clock check means clients never *see* a logically-expired key, even on a replica. The key just occupies memory a little longer.

:::warning[The classic replica trap]
A read-only replica's `DBSIZE` and `used_memory` can be noticeably higher than the primary's, because it is holding expired-but-undeleted keys. This is normal. Do not "fix" it, and do not alert on the divergence.

Related: `WAIT`, `EXPIRE`-heavy workloads, and Lua scripts on replicas all behave subtly differently for this reason. If a script's behaviour depends on whether a key exists, it must not be run on a replica.
:::

## 1.5 The TTL patterns that matter

### Jitter, to avoid a synchronized stampede

```ts
// ❌ 10,000 keys written in a deploy all expire in the same second
await redis.set(key, value, 'EX', 3600);

// ✅ spread the expiry over a 10% window
const jitter = (base: number) => base + Math.floor(Math.random() * base * 0.1);
await redis.set(key, value, 'EX', jitter(3600));
```

Without jitter, a burst of cache writes becomes a burst of cache misses exactly one hour later — every one of them hitting your database in the same second. This is **cache avalanche**, and jitter is the one-line fix. More in [Caching Patterns](./25-caching-patterns.md).

### Sliding vs absolute expiry

```ts
// absolute: 24 hours from creation, no matter what
await redis.set(key, v, 'EX', 86_400);

// sliding: 30 minutes from the last access — one round trip
const value = await redis.getex(key, 'EX', 1800);

// sliding with a hard cap: never extend past the absolute deadline
await redis.set(key, v, 'EX', Math.min(1800, secondsUntilHardExpiry));
```

Sessions usually want sliding expiry with an absolute cap, so an active user is not logged out mid-work but a stolen token cannot live forever.

### Don't lose the TTL

Restating the trap from [Keys & The Keyspace](./03-keys-and-the-keyspace.md), because it is the number one Redis bug:

```ts
await redis.set(key, newValue);                  // ❌ TTL is now gone
await redis.set(key, newValue, 'KEEPTTL');       // ✅
await redis.set(key, newValue, 'EX', 3600);      // ✅ (reset it)
```

---

# Part 2 — Eviction

## 2.1 `maxmemory` — the setting to get right

```conf
maxmemory 4gb
maxmemory-policy allkeys-lru
maxmemory-samples 5
```

```bash
CONFIG SET maxmemory 4gb
CONFIG SET maxmemory-policy allkeys-lru
CONFIG REWRITE                # ← or it reverts on restart
```

:::danger[`maxmemory 0` is the default, and it is a trap]
`0` means **unlimited**. Redis will allocate until the kernel's OOM killer terminates the process — losing everything, with no graceful degradation and no warning.

**Always set `maxmemory` on any production instance.** The number should leave real headroom:

```
   maxmemory ≈ (physical RAM × 0.6)  for a persistence-enabled instance
   maxmemory ≈ (physical RAM × 0.8)  for a pure cache with no BGSAVE

   Why the headroom:
     • fork() for BGSAVE/AOF-rewrite can transiently need up to 2× the
       dataset in the worst case (every page written during the save)
     • client output buffers (a big MGET, a replica sync, Pub/Sub fan-out)
     • the replication backlog
     • allocator fragmentation (~1.1–1.5×)
     • the OS itself needs page cache to function
```

On a 16 GB box running persistence, `maxmemory 8gb` is a defensible number. `maxmemory 15gb` is how you get paged.
:::

## 2.2 The eight policies

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │  noeviction        return an error on writes; reads still work       │
   ├──────────────────────────────────────────────────────────────────────┤
   │  allkeys-lru       evict the least-recently-used, from ALL keys      │
   │  allkeys-lfu       evict the least-FREQUENTLY-used, from ALL keys    │
   │  allkeys-random    evict a random key from ALL keys                  │
   ├──────────────────────────────────────────────────────────────────────┤
   │  volatile-lru      LRU, but only among keys WITH a TTL               │
   │  volatile-lfu      LFU, but only among keys WITH a TTL               │
   │  volatile-random   random, but only among keys WITH a TTL            │
   │  volatile-ttl      evict the key with the SHORTEST remaining TTL     │
   └──────────────────────────────────────────────────────────────────────┘

   allkeys-*   → "everything here is disposable"     (a pure cache)
   volatile-*  → "only TTL'd keys are disposable"    (a mixed workload)
```

### Choosing

| Your situation | Policy | Why |
| :--- | :--- | :--- |
| **Pure cache**, everything is regenerable | `allkeys-lru` | The safe default. Never rejects a write. |
| Pure cache with a **stable hot set** | `allkeys-lfu` | Resists a one-off scan polluting the cache |
| **Mixed**: some keys are cache, some are the only copy (locks, queues, counters) | `volatile-lru` | Protects the keys you did not give a TTL |
| **Primary store** — nothing is disposable | `noeviction` | Fail loudly rather than lose data silently |
| Uniform access, no hot set | `allkeys-random` | Cheapest; LRU tracking buys nothing |
| TTLs genuinely encode importance | `volatile-ttl` | Rarely the right answer in practice |

:::danger[The `volatile-*` failure mode nobody expects]
With a `volatile-*` policy, **if no key has a TTL, Redis has nothing it is allowed to evict** — so it behaves exactly like `noeviction`:

```
   (error) OOM command not allowed when used memory > 'maxmemory'.
```

Your "cache" now rejects every write while sitting at 100% memory. This surprises people at 3 a.m. If you choose `volatile-*`, you must guarantee that a meaningful fraction of your keys carry TTLs — and monitor `INFO keyspace` to confirm it stays true.
:::

:::tip[The strongest architectural recommendation on this page]
**Separate your cache from your durable ephemeral state.**

```
   Instance A — the cache            Instance B — real state
   maxmemory-policy allkeys-lru      maxmemory-policy noeviction
   appendonly no                     appendonly yes
   cache:*  page:*  api:*            lock:*  queue:*  ratelimit:*  session:*
```

Mixing them means a traffic spike that fills the cache can evict a distributed lock — and now two workers hold the "same" lock and corrupt your data. Two instances cost a little more and remove an entire class of incident. Do this.
:::

## 2.3 How eviction actually runs

Eviction is checked **before every command that could allocate memory** — in `processCommand`, via `performEvictions()`:

```
   command arrives
        │
        ▼
   used_memory > maxmemory ?
        │  no  → execute normally
        │
        yes ▼
   is the policy noeviction (or volatile-* with no TTL'd keys)?
        │  yes → is this command flagged "denyoom"?
        │           yes → reply  -OOM command not allowed…
        │           no  → allow it (reads, DEL, etc. still work)
        │
        no ▼
   LOOP until used_memory <= maxmemory (or nothing left to evict):
        1. sample `maxmemory-samples` keys from the candidate pool
        2. score them (LRU idle time / LFU frequency / TTL)
        3. push them into a 16-slot EVICTION POOL, kept sorted
        4. evict the single best candidate from the pool
        5. propagate a DEL to the AOF and to replicas
        6. fire the "evicted" keyspace notification
        7. free the memory (lazily, if lazyfree-lazy-eviction yes)
```

Note step 5: **evictions are replicated as explicit `DEL`s.** Replicas do not evict independently — same reasoning as expiry.

Note also that eviction happens **synchronously, on the main thread, before your command runs**. Under heavy memory pressure, every command pays for evicting several keys. That shows up as a latency spike — `LATENCY LATEST` reports it as `eviction-del` or `eviction-cycle`.

## 2.4 Approximated LRU — and why it is approximate

True LRU requires a doubly linked list of every key, reordered on every access. That is 16 extra bytes per key plus pointer churn on every read. Redis refuses to pay it.

Instead, each `redisObject` carries a **24-bit LRU clock** (seconds resolution, wrapping every ~194 days), updated on access. Eviction **samples**:

```
   maxmemory-samples 5        (the default)

   1. Pick 5 random keys from the candidate set
   2. Compute idle time = now − obj.lru for each
   3. Insert them into a 16-entry EVICTION POOL, sorted by idle time
      (the pool persists BETWEEN eviction calls — so good candidates
       spotted earlier are remembered and compete with new samples)
   4. Evict the idlest key in the pool
```

The eviction pool is the clever part: without it, sampling 5 keys would frequently miss the truly-idle ones. By retaining the best candidates across calls, the approximation converges close to true LRU.

```
   Accuracy vs cost  (from antirez's published measurements)

   samples=3   ▓▓▓▓▓░░░░░  noticeably worse than true LRU
   samples=5   ▓▓▓▓▓▓▓▓░░  the default — very close to true LRU
   samples=10  ▓▓▓▓▓▓▓▓▓▓  nearly indistinguishable from true LRU
                            ~2× the CPU of samples=5
```

`maxmemory-samples 10` is worth it if you have CPU headroom and eviction accuracy matters. Above 10 there is essentially nothing left to gain.

## 2.5 LFU — and its two clever mechanisms

LRU has a real weakness: **one scan pollutes the cache.** A nightly analytics job that reads every key makes everything look "recently used", and your genuinely hot keys get evicted alongside the cold ones.

LFU tracks **frequency** instead. The same 24 bits are repurposed:

```
   robj.lru (24 bits) under LFU:
   ┌────────────────────────────┬──────────────────┐
   │  16 bits: last decay time  │  8 bits: counter │
   │  (minutes since epoch)     │  (0–255)         │
   └────────────────────────────┴──────────────────┘
```

Eight bits cannot count to a million. So Redis uses two tricks.

### Logarithmic increment

```
   On each access:
       r = random()  in [0,1)
       p = 1 / ((counter − LFU_INIT_VAL) × lfu-log-factor + 1)
       if r < p:  counter++

   The higher the counter, the LESS likely it is to increase.
   With lfu-log-factor 10, an 8-bit counter saturates at roughly
   ONE MILLION accesses instead of 255.
```

```
   factor=10:   counter 5 ≈ 10 hits · counter 100 ≈ 10K hits ·
                counter 255 ≈ 1M hits
```

### Decay over time

```
   On access, before incrementing:
       elapsed_minutes = now − last_decay_time
       counter -= elapsed_minutes / lfu-decay-time
```

Without decay, a key that was extremely hot last year would outrank a key that is hot today, forever. Decay makes "frequently used" mean "frequently used *recently*".

```conf
maxmemory-policy allkeys-lfu
lfu-log-factor 10        # higher = counter saturates more slowly
lfu-decay-time 1         # minutes per decrement. 0 = decay on every access.
```

```bash
127.0.0.1:6379> OBJECT FREQ mykey     # only valid under an LFU policy
(integer) 42
127.0.0.1:6379> redis-cli --hotkeys   # uses OBJECT FREQ to rank keys
```

:::tip[When LFU beats LRU]
Use **LFU** when you have a **stable hot set** and periodic full scans (analytics jobs, backups, crawlers, sequential ID enumeration). LFU is immune to them; LRU is not.

Use **LRU** when access patterns shift over time and recency genuinely predicts future access better than historical frequency — a news feed, trending content, session data.

LFU is also the prerequisite for `--hotkeys`, which is reason enough to try it on a cache instance.
:::

## 2.6 Monitoring

```bash
127.0.0.1:6379> INFO stats
expired_keys:1523000              # deleted by TTL
evicted_keys:0                    # deleted by memory pressure ← watch this
keyspace_hits:9500000
keyspace_misses:500000

127.0.0.1:6379> INFO memory
used_memory:3900000000
maxmemory:4294967296
maxmemory_policy:allkeys-lru
```

The four numbers to alert on:

| Metric | Healthy | What a bad value means |
| :--- | :--- | :--- |
| `evicted_keys` rate | **0** for a `noeviction` or well-sized instance | You are at the memory cap. Either scale up or accept churn. |
| Hit ratio `hits/(hits+misses)` | > 0.9 for a cache | Your cache is not helping. Wrong TTLs, wrong keys, or too small. |
| `used_memory / maxmemory` | < 0.8 sustained | Approaching the cliff |
| `mem_fragmentation_ratio` | 1.0–1.5 | < 1.0 = **swapping**, an emergency |

```ts
// a genuinely useful health check
async function cacheHealth() {
  const info = await redis.info('stats');
  const num = (k: string) => Number(/^\w+:(\d+)$/m.exec(info.match(new RegExp(`^${k}:(\\d+)`, 'm'))?.[0] ?? '')?.[1] ?? 0);

  const hits = num('keyspace_hits');
  const misses = num('keyspace_misses');
  const evicted = num('evicted_keys');

  return {
    hitRatio: hits / (hits + misses || 1),
    evictedKeys: evicted,
    healthy: hits / (hits + misses || 1) > 0.9,
  };
}
```

:::warning[A rising `evicted_keys` on an instance holding locks or queues is an incident]
On a pure cache, eviction is normal and healthy — it is the mechanism working. On an instance that also holds locks, rate-limit counters, or queues, **eviction is silent data loss**. A lock evicted under memory pressure means two workers believe they hold it.

This is the concrete reason for the two-instance recommendation in §2.2.
:::

---

## Rapid-fire recall

1. One sentence each: expiry vs eviction. Which counter shows each?
2. Why does Redis not use a timer per key?
3. Walk through the active expiry cycle. What is the 25% rule doing?
4. Why does a replica never expire a key on its own?
5. What is `maxmemory 0`, and why is it dangerous?
6. Roughly what fraction of RAM should `maxmemory` be, and name four things that consume the headroom.
7. What happens with `volatile-lru` when no key has a TTL?
8. Why is Redis's LRU approximate, and what does the eviction pool contribute?
9. Explain the two mechanisms that let an 8-bit LFU counter be useful.
10. When does LFU beat LRU?
11. Why should locks and caches live on different Redis instances?

<details>
<summary>Answers</summary>

1. Expiry deletes a key because the TTL you set has passed (`expired_keys`). Eviction deletes a key because `maxmemory` was reached (`evicted_keys`).
2. A million keys would mean a million timer allocations and a scheduling burden. Sampling plus lazy checks costs proportional to the number of *actually expired* keys instead.
3. Sample 20 random keys from `db->expires`, delete the expired ones, and repeat immediately if more than 25% were expired — otherwise stop until the next tick. The 25% rule bounds the steady-state fraction of dead-but-present keys without ever scanning the whole keyspace.
4. To keep the replica byte-identical with the primary. Independent expiry plus clock drift would cause divergence, and a promoted replica would then have a different dataset. Reads still return `nil` for logically-expired keys via a clock check.
5. Unlimited memory — the default. Redis allocates until the kernel OOM-killer terminates it, losing everything with no graceful degradation.
6. Roughly 60% of RAM with persistence, 80% for a pure cache. Headroom covers `fork()` copy-on-write, client output buffers, the replication backlog, and allocator fragmentation.
7. There is nothing eligible to evict, so Redis behaves like `noeviction` and rejects writes with `OOM command not allowed`.
8. True LRU needs a linked list reordered on every access — too expensive. Redis samples `maxmemory-samples` keys and scores them by a 24-bit access clock; the 16-slot eviction pool persists good candidates *between* calls, so the approximation converges close to true LRU.
9. **Logarithmic increment** — the probability of incrementing falls as the counter rises, so 8 bits span ~1M accesses. **Time decay** — the counter decreases with elapsed minutes, so "frequent" means "frequent recently".
10. When there is a stable hot set and periodic full scans (analytics, backups, crawlers). LFU is immune to scan pollution; LRU is not.
11. A memory spike on the cache side can evict a lock or a rate-limit counter, which is silent correctness loss. `allkeys-lru` for the cache, `noeviction` + persistence for real state.

</details>

---

**Next:** [Persistence](./16-persistence.md) — RDB, AOF, `fork()`, and exactly how much data you can lose.
