---
title: Caching Patterns
author: Tejas Nirala
---

# Caching Patterns

> **What you will be able to do after this page**
>
> - Implement cache-aside correctly, including the parts everyone skips.
> - Name and fix the three classic failure modes: penetration, avalanche, stampede.
> - Choose an invalidation strategy and know what it costs.
> - Build a two-tier cache and know when it is worth the complexity.

Caching is the most common use of Redis and the easiest to get subtly wrong. "There are only two hard things in Computer Science: cache invalidation and naming things" is a joke that has cost a great deal of money.

---

## 1. Cache-aside (lazy loading) — the default

The application manages the cache. Redis knows nothing about your database.

```
   READ                                  WRITE
   ─────────────────────────────         ─────────────────────────────
   1. GET from cache                     1. write to the database
   2. HIT  → return                      2. DELETE the cache key
   3. MISS → read the database              (do NOT update it — see §4)
   4.       write to the cache
   5.       return
```

```ts
const TTL = 300;

async function getUser(id: string): Promise<User | null> {
  const key = `cache:v1:user:${id}`;

  const hit = await redis.get(key);
  if (hit !== null) return hit === NEGATIVE ? null : (JSON.parse(hit) as User);

  const user = await db.users.findById(id);

  if (!user) {
    await redis.set(key, NEGATIVE, 'EX', 60);          // negative cache, §3
    return null;
  }

  await redis.set(key, JSON.stringify(user), 'EX', jitter(TTL));   // §3
  return user;
}

async function updateUser(id: string, patch: Partial<User>): Promise<User> {
  const user = await db.users.update(id, patch);
  await redis.unlink(`cache:v1:user:${id}`);           // invalidate, don't update
  return user;
}
```

**Pros:** simple; only requested data is cached; a cache failure degrades to database speed rather than breaking.
**Cons:** every miss pays the full database latency; data can be stale for up to one TTL; the first request after a write always misses.

:::tip[Why delete rather than update on write]
```ts
await db.users.update(id, patch);
await redis.set(key, JSON.stringify(patch));    // ❌
await redis.unlink(key);                         // ✅
```

Three reasons deletion wins:

1. **No race.** Two concurrent writes can `SET` in the reverse order they hit the database, leaving the cache holding the older value permanently. Deletion is idempotent and order-independent.
2. **What you write is not what you read.** The database applies defaults, triggers, and computed columns. Caching your `patch` object caches a lie.
3. **You may cache something nobody reads.** Deletion is lazy: the next reader repopulates it, and only if there is a next reader.

The exception is a write-heavy, read-heavy hot key where the extra miss matters — then update, and accept the ordering risk (or serialize with a lock).
:::

---

## 2. The other patterns

### Read-through

The cache itself loads from the database on a miss. Structurally the same as cache-aside, but the loading lives behind a cache abstraction rather than in your business logic.

```ts
class ReadThroughCache<T> {
  constructor(
    private prefix: string,
    private ttl: number,
    private loader: (id: string) => Promise<T | null>,
  ) {}

  async get(id: string): Promise<T | null> {
    const key = `${this.prefix}:${id}`;
    const hit = await redis.get(key);
    if (hit !== null) return hit === NEGATIVE ? null : (JSON.parse(hit) as T);

    const value = await this.loader(id);
    await redis.set(key, value === null ? NEGATIVE : JSON.stringify(value),
                    'EX', value === null ? 60 : jitter(this.ttl));
    return value;
  }

  invalidate = (id: string) => redis.unlink(`${this.prefix}:${id}`);
}

const users = new ReadThroughCache('cache:v1:user', 300, (id) => db.users.findById(id));
```

The value is consistency of behaviour: every caller gets negative caching, jitter, and versioned keys for free, instead of each one reimplementing them slightly differently.

### Write-through

Write to the cache and the database **synchronously**, together.

```ts
async function updateUser(id: string, patch: Partial<User>): Promise<User> {
  const user = await db.users.update(id, patch);
  await redis.set(`cache:v1:user:${id}`, JSON.stringify(user), 'EX', jitter(300));
  return user;
}
```

**Pros:** the cache is never stale; the first read after a write is a hit.
**Cons:** every write pays both latencies; you cache data that may never be read; and the two writes are not atomic — if the Redis write fails after the database write succeeds, you have a stale cache with no signal.

### Write-behind (write-back)

Write to the cache immediately; flush to the database asynchronously.

```ts
async function recordView(postId: string): Promise<void> {
  await redis.hincrby('pending:views', postId, 1);     // instant
}

// a flusher, every 10 seconds
setInterval(async () => {
  const pending = await redis.hgetall('pending:views');
  if (Object.keys(pending).length === 0) return;

  // take the whole batch atomically so no increment is lost mid-flush
  await redis.rename('pending:views', 'flushing:views');
  const batch = await redis.hgetall('flushing:views');

  await db.transaction(async (tx) => {
    for (const [postId, count] of Object.entries(batch)) {
      await tx.query('UPDATE posts SET views = views + $1 WHERE id = $2', [Number(count), postId]);
    }
  });

  await redis.unlink('flushing:views');
}, 10_000);
```

**Pros:** extremely fast writes; batching collapses a million increments into a handful of `UPDATE`s.
**Cons:** **you can lose data** if Redis dies before a flush. Only acceptable for values where approximation is fine — view counts, analytics, last-seen timestamps. Never for orders or balances.

Note the `RENAME` trick: it atomically claims the current batch so that increments arriving during the flush accumulate in a fresh key rather than being lost.

### Comparison

| | Cache-aside | Read-through | Write-through | Write-behind |
| :--- | :--- | :--- | :--- | :--- |
| Read latency on miss | DB | DB | DB | DB |
| Write latency | DB | DB | DB + cache | **cache only** |
| Staleness | ≤ TTL | ≤ TTL | none | none (in cache) |
| Data loss risk | none | none | none | **yes** |
| Caches unread data | no | no | **yes** | yes |
| Complexity | low | low | low | **high** |

---

## 3. The three named failure modes

### Cache penetration — requests for data that does not exist

```
   attacker: GET /api/user/999999999    (does not exist)
      → cache MISS  →  database query  →  no row  →  nothing cached
      → repeat 10,000 times/second
      → every single request hits your database
```

The cache provides zero protection because there is nothing to cache. An attacker enumerating non-existent IDs turns your cache into a pass-through.

**Fix 1 — negative caching.**

```ts
const NEGATIVE = '\0';                 // a sentinel no real payload produces

const hit = await redis.get(key);
if (hit === NEGATIVE) return null;
if (hit !== null) return JSON.parse(hit) as T;

const row = await db.find(id);
if (!row) {
  await redis.set(key, NEGATIVE, 'EX', 60);   // ← a SHORT ttl
  return null;
}
```

The TTL must be short (30–120 s), or a legitimately-created record stays invisible for the full cache TTL.

**Fix 2 — validate before querying.**

```ts
if (!/^[0-9]{1,12}$/.test(id)) throw new BadRequest('invalid id');
```

Free, and it stops the whole class of attack for well-formed ID spaces.

**Fix 3 — a Bloom filter** for very large key spaces, where even negative caching would consume too much memory. `BF.EXISTS` (via the Bloom module) answers "definitely not present" or "maybe present" in a few bytes per key.

### Cache avalanche — many keys expiring at once

```
   09:00:00  a deploy warms 100,000 cache keys, all with EX 3600
   10:00:00  all 100,000 expire in the SAME SECOND
             → 100,000 simultaneous misses
             → your database receives a year's worth of load in a minute
             → it falls over
             → every request now times out
             → nothing repopulates the cache
             → the outage is self-sustaining
```

**Fix — jitter.**

```ts
const jitter = (base: number) => base + Math.floor(Math.random() * base * 0.1);
await redis.set(key, value, 'EX', jitter(3600));    // 3600–3960s
```

One line. Spreads the expiry over a six-minute window instead of one second. **Put it in your cache wrapper so nobody can forget it.**

A related avalanche: **Redis itself restarts** and the cache is empty. Mitigate with persistence (so a restart reloads a warm cache), replicas (so a failover keeps the data), and by ensuring your database can survive a cold cache — which you should load-test.

### Cache stampede (thundering herd) — many requests for the *same* missing key

```
   A very popular key expires.
   1,000 concurrent requests all miss simultaneously.
   All 1,000 run the same expensive query.
   999 of them are pure waste, and together they overload the database.

   time ──►
   req1  MISS ──────────► DB (400ms) ──────► SET
   req2  MISS ──────────► DB (400ms) ──────► SET   } all doing
   req3  MISS ──────────► DB (400ms) ──────► SET   } the SAME
   …                                                } query
   req1000 MISS ────────► DB (400ms) ──────► SET
```

**Fix 1 — a lock, so only one request recomputes.**

```ts
async function getWithLock<T>(
  key: string, ttl: number, produce: () => Promise<T>,
): Promise<T> {
  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit) as T;

  const lockKey = `lock:${key}`;
  const token = randomUUID();
  const acquired = await redis.set(lockKey, token, 'NX', 'PX', 10_000);

  if (acquired === 'OK') {
    try {
      const value = await produce();
      await redis.set(key, JSON.stringify(value), 'EX', jitter(ttl));
      return value;
    } finally {
      await redis.releaseLock(lockKey, token);     // the compare-and-delete script
    }
  }

  // someone else is recomputing — wait briefly and re-read
  for (let i = 0; i < 20; i++) {
    await sleep(50);
    const retry = await redis.get(key);
    if (retry !== null) return JSON.parse(retry) as T;
  }

  return produce();      // the lock holder died; fall through rather than fail
}
```

**Fix 2 — probabilistic early expiration.** Elegant, lock-free, and my preference for read-heavy keys.

```ts
interface Wrapped<T> { value: T; computedAt: number; deltaMs: number }

async function getEarly<T>(
  key: string, ttlMs: number, produce: () => Promise<T>, beta = 1.0,
): Promise<T> {
  const raw = await redis.get(key);

  if (raw !== null) {
    const w = JSON.parse(raw) as Wrapped<T>;
    const expiresAt = w.computedAt + ttlMs;

    // XFetch: recompute early with a probability that rises as expiry nears
    const shouldRefresh =
      Date.now() - w.deltaMs * beta * Math.log(Math.random()) >= expiresAt;

    if (!shouldRefresh) return w.value;
  }

  const started = Date.now();
  const value = await produce();
  const deltaMs = Date.now() - started;      // how expensive this was to compute

  await redis.set(
    key,
    JSON.stringify({ value, computedAt: Date.now(), deltaMs } satisfies Wrapped<T>),
    'PX', ttlMs * 2,                          // the stored TTL outlives the logical one
  );
  return value;
}
```

The idea (from the "XFetch" paper): as a key approaches expiry, each reader independently rolls a die weighted by **how expensive the value was to compute**. Exactly one reader typically refreshes it *before* it expires, so no request ever sees a miss. Expensive values are refreshed earlier; cheap ones are left alone.

**Fix 3 — never expire; refresh in the background.**

```ts
// a cron job repopulates hot keys before they can go stale
setInterval(async () => {
  const trending = await db.query(EXPENSIVE_SQL);
  await redis.set('cache:trending', JSON.stringify(trending), 'EX', 300);
}, 60_000);
```

Simplest and best for a small, known set of very hot keys. Readers never miss, because the key never expires while the refresher is alive. Add monitoring for "the refresher stopped" or you will serve stale data forever.

---

## 4. Invalidation strategies

| Strategy | How | Good | Bad |
| :--- | :--- | :--- | :--- |
| **TTL only** | Let it expire | Trivial; self-healing | Stale for up to one TTL |
| **Explicit delete** | `UNLINK` on write | Immediate | You must find every write path |
| **Versioned keys** | `cache:v2:user:1` | Instant global invalidation; no deletes | Old entries linger until they expire |
| **Tag-based** | A Set of keys per tag | Invalidate related groups | Extra bookkeeping |
| **Pub/Sub fan-out** | Publish a key to invalidate | Clears local L1 caches too | At-most-once; a miss means staleness |
| **Client-side tracking** | RESP3 `CLIENT TRACKING` | Server-driven, correct | Requires RESP3 and client support |

### Versioned keys — the underrated one

```ts
const CACHE_VERSION = 'v3';                     // bump on any schema change
const key = (parts: string) => `cache:${CACHE_VERSION}:${parts}`;
```

Deploying a change to your cached JSON shape? Bump the version. Every old key becomes unreachable and expires on its own. **No flush, no stampede, no migration** — and if you need to roll back, bump it back and the old cache is still warm.

### Tag-based invalidation

```ts
async function cacheWithTags(key: string, value: unknown, ttl: number, tags: string[]) {
  const pipe = redis.pipeline();
  pipe.set(key, JSON.stringify(value), 'EX', ttl);
  for (const tag of tags) {
    pipe.sadd(`tag:${tag}`, key);
    pipe.expire(`tag:${tag}`, ttl + 60);         // the tag set must not outlive its members
  }
  await pipe.exec();
}

async function invalidateTag(tag: string): Promise<void> {
  const keys = await redis.smembers(`tag:${tag}`);
  if (keys.length > 0) await redis.unlink(...keys);
  await redis.unlink(`tag:${tag}`);
}
```

```ts
await cacheWithTags(`cache:v3:post:${id}`, post, 300, [`post:${id}`, `author:${post.authorId}`]);
// an author changes their display name → every one of their posts' caches clears
await invalidateTag(`author:${authorId}`);
```

Give the tag set a TTL slightly longer than its members, or it accumulates dead key names forever.

---

## 5. Two-tier caching

```
   ┌─────────────────────────────────────────────────────────────────┐
   │ L1 — in-process (a Map / LRU in Node)                           │
   │    ~0.0001 ms  ·  per-instance  ·  small  ·  lost on restart    │
   ├─────────────────────────────────────────────────────────────────┤
   │ L2 — Redis                                                       │
   │    ~0.5 ms  ·  shared by every instance  ·  large  ·  survives  │
   ├─────────────────────────────────────────────────────────────────┤
   │ L3 — the database                                                │
   │    ~50 ms  ·  the source of truth                                │
   └─────────────────────────────────────────────────────────────────┘
```

```ts
import { LRUCache } from 'lru-cache';

const l1 = new LRUCache<string, unknown>({ max: 10_000, ttl: 30_000 });

async function get<T>(key: string, ttl: number, produce: () => Promise<T>): Promise<T> {
  const local = l1.get(key) as T | undefined;
  if (local !== undefined) return local;                  // L1

  const remote = await redis.get(key);
  if (remote !== null) {
    const value = JSON.parse(remote) as T;
    l1.set(key, value);
    return value;                                          // L2
  }

  const value = await produce();                           // L3
  l1.set(key, value);
  await redis.set(key, JSON.stringify(value), 'EX', jitter(ttl));
  return value;
}

// L1 invalidation across every instance
await sub.subscribe('cache:invalidate');
sub.on('message', (_c, key) => l1.delete(key));

async function invalidate(key: string): Promise<void> {
  l1.delete(key);
  await redis.unlink(key);
  await redis.publish('cache:invalidate', key);            // clear the OTHER instances
}
```

:::warning[L1 is eventually consistent, and the window is your L1 TTL]
The Pub/Sub invalidation is [at-most-once](./12-pubsub.md) — if an instance is momentarily disconnected, it never learns and serves stale data until its own L1 TTL expires.

**So keep the L1 TTL short (10–60 seconds).** It bounds your worst-case staleness regardless of whether the invalidation arrived. Use two tiers only for data where seconds of staleness are genuinely acceptable — reference data, feature flags, configuration — never for a user's own recently-edited content.

[RESP3 client-side caching](./04-protocol-resp.md) (`CLIENT TRACKING`) does this properly: the server tracks which clients read which keys and pushes invalidations. When your client supports it, prefer it.
:::

---

## 6. What to cache, and what not to

| Cache it | Do not cache it |
| :--- | :--- |
| Expensive aggregations | Data that changes on every read |
| Data read far more than written | Data written more than read |
| External API responses | Anything that must be strictly consistent |
| Rendered fragments / templates | Large objects rarely read (they just evict better entries) |
| Reference data (countries, config) | Per-user data with a very low hit rate |
| Session data | Secrets, unencrypted |
| Computed permissions | Data with legal freshness requirements |

**The test:** `hit_rate × (db_latency − cache_latency) > cost_of_complexity`.

A key read once an hour has a near-zero hit rate. Caching it adds an invalidation bug surface and evicts things that were earning their keep. **A cache entry that is not read before it expires is pure cost.**

```bash
# is your cache actually working?
redis-cli INFO stats | grep -E 'keyspace_hits|keyspace_misses'
# hit ratio below 0.8 on a cache instance means you are caching the wrong things
```

---

## 7. A complete, production-shaped cache module

```ts
// src/cache.ts
import { randomUUID } from 'node:crypto';
import { redis } from './redis';

const VERSION = 'v3';
const NEGATIVE = '\0';

const jitter = (s: number) => s + Math.floor(Math.random() * s * 0.1);
const k = (key: string) => `cache:${VERSION}:${key}`;

/** Caches NEVER take down a request. Fail open, always. */
async function safe<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try { return await op(); }
  catch (err) { log.warn({ err }, '[cache] degraded'); metrics.increment('cache.error'); return fallback; }
}

export async function cached<T>(
  key: string,
  ttl: number,
  produce: () => Promise<T | null>,
  opts: { negativeTtl?: number; tags?: string[]; lock?: boolean } = {},
): Promise<T | null> {
  const full = k(key);

  const hit = await safe(() => redis.get(full), null);
  if (hit === NEGATIVE) { metrics.increment('cache.hit.negative'); return null; }
  if (hit !== null)     { metrics.increment('cache.hit'); return JSON.parse(hit) as T; }

  metrics.increment('cache.miss');

  if (opts.lock) return withStampedeLock(full, ttl, produce, opts);
  return fill(full, ttl, produce, opts);
}

async function fill<T>(
  full: string, ttl: number,
  produce: () => Promise<T | null>,
  opts: { negativeTtl?: number; tags?: string[] },
): Promise<T | null> {
  const value = await produce();

  await safe(async () => {
    const pipe = redis.pipeline();
    if (value === null) {
      pipe.set(full, NEGATIVE, 'EX', opts.negativeTtl ?? 60);
    } else {
      pipe.set(full, JSON.stringify(value), 'EX', jitter(ttl));
      for (const tag of opts.tags ?? []) {
        pipe.sadd(`cache:tag:${tag}`, full);
        pipe.expire(`cache:tag:${tag}`, ttl + 60);
      }
    }
    await pipe.exec();
  }, null);

  return value;
}

async function withStampedeLock<T>(
  full: string, ttl: number,
  produce: () => Promise<T | null>,
  opts: { negativeTtl?: number; tags?: string[] },
): Promise<T | null> {
  const lockKey = `lock:${full}`;
  const token = randomUUID();
  const got = await safe(() => redis.set(lockKey, token, 'NX', 'PX', 10_000), null);

  if (got === 'OK') {
    try { return await fill(full, ttl, produce, opts); }
    finally { await safe(() => redis.releaseLock(lockKey, token), 0); }
  }

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const retry = await safe(() => redis.get(full), null);
    if (retry === NEGATIVE) return null;
    if (retry !== null) return JSON.parse(retry) as T;
  }
  return produce();                       // the holder died — do the work ourselves
}

export const invalidate = (key: string) => safe(() => redis.unlink(k(key)), 0);

export async function invalidateTag(tag: string): Promise<void> {
  await safe(async () => {
    const keys = await redis.smembers(`cache:tag:${tag}`);
    if (keys.length) await redis.unlink(...keys);
    await redis.unlink(`cache:tag:${tag}`);
  }, undefined);
}
```

Every defence from this page, in one file: versioned keys, jitter, negative caching, optional stampede locking, tags, metrics, and **fail-open error handling**.

---

## Rapid-fire recall

1. On a write, should you update the cache or delete it? Give two reasons.
2. What is cache penetration and what are the two cheapest defences?
3. What is cache avalanche and what is the one-line fix?
4. What is a cache stampede, and name three fixes?
5. How does probabilistic early expiration avoid a miss entirely?
6. What does bumping a cache key's version give you that `FLUSHALL` does not?
7. Why must a tag set have a longer TTL than its members?
8. In two-tier caching, why must the L1 TTL be short?
9. When is a cache entry pure cost?
10. Why must a cache read fail open?

<details>
<summary>Answers</summary>

1. Delete. Concurrent writes can `SET` out of order and leave a stale value permanently; and what you write is not what the database returns after defaults, triggers, and computed columns.
2. Repeated requests for records that do not exist, which the cache cannot absorb. Defences: negative caching with a short TTL, and validating the ID format before querying.
3. Many keys expiring in the same second, producing a simultaneous flood of misses. Fix: add random jitter to every TTL.
4. Many concurrent requests missing the **same** key and all running the same expensive query. Fixes: a lock so only one recomputes; probabilistic early expiration; or never expiring and refreshing in the background.
5. Each reader rolls a die weighted by how expensive the value was to compute and by how close expiry is, so one reader typically refreshes it *before* it expires — no request ever sees a miss.
6. Instant, zero-cost global invalidation with no deletes and no stampede, and it is reversible — roll the version back and the old cache is still warm.
7. Otherwise the tag set outlives its members and accumulates key names that no longer exist, growing forever.
8. The Pub/Sub invalidation is at-most-once, so a disconnected instance never learns. The L1 TTL is your guaranteed staleness bound regardless.
9. When it is never read before it expires — it added invalidation risk and evicted entries that were being used, for no benefit. A hit ratio below ~0.8 suggests you are caching the wrong things.
10. Because a cache is an optimization, not a dependency. A Redis outage should degrade you to database latency, never turn into an outage of your own.

</details>

---

**Next:** [Distributed Locks](./26-distributed-locks.md) — `SET NX PX`, the Redlock debate, and the honest limits.
