---
title: Rate Limiting
author: Tejas Nirala
---

# Rate Limiting

> **What you will be able to do after this page**
>
> - Implement four rate-limiting algorithms and explain the trade-off of each.
> - Draw the boundary-burst problem and know which algorithms have it.
> - Choose between memory cost and precision deliberately.
> - Return the right HTTP headers so clients can behave well.

Rate limiting is Redis's cleanest showcase: an atomic counter shared across every app server, with automatic expiry. Four algorithms, in increasing order of precision and cost.

---

## 1. Fixed window

Divide time into fixed buckets. Count per bucket.

```
   limit = 5 per minute

   12:00:00 ──────────────── 12:01:00 ──────────────── 12:02:00
   │  ● ● ● ● ●             │  ● ● ●                  │
   │  count = 5             │  count = 3              │
   │  the 6th is REJECTED   │                         │
   └────────────────────────┴─────────────────────────┘
      key: rl:user:1042:20260901T1200
```

```lua
-- FIXED_WINDOW
-- KEYS[1] = "rl:<id>:<bucket>",  ARGV[1] = limit, ARGV[2] = window seconds
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return current <= tonumber(ARGV[1]) and 1 or 0
```

```ts
redis.defineCommand('fixedWindow', { numberOfKeys: 1, lua: FIXED_WINDOW });

async function allowFixed(id: string, limit = 100, windowSec = 60): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  return (await redis.fixedWindow(`rl:${id}:${bucket}`, limit, windowSec)) === 1;
}
```

**Cost:** one key per identity per window, ~60 bytes. Cheapest possible.

:::danger[The boundary burst — 2× the limit in an instant]
```
   limit = 100 per minute

   11:59:59  ●●●●●●●●●● ×100   ← all 100 allowed (window A)
   12:00:00  ●●●●●●●●●● ×100   ← all 100 allowed (window B — a NEW counter)

   200 requests in ~1 second, against a "100 per minute" limit.
```

This is not a subtle edge case — a determined client can trigger it deliberately, every minute, forever. Fixed windows are fine for coarse protection and unsuitable when the limit is a real capacity constraint.
:::

Note the `current == 1` check: the `EXPIRE` is set only on the first request of a window. Setting it on every request would slide the window and let a steady stream of requests keep it alive indefinitely.

---

## 2. Sliding window log — precise, expensive

Store a **timestamp per request** in a sorted set. Count what falls inside the window.

```
   limit = 5 per 60s,  now = 12:00:30

   Sorted set "rl:user:1042", score = timestamp
   ┌───────────────────────────────────────────────────────────────┐
   │ 11:59:10 │ 11:59:45 │ 11:59:58 │ 12:00:12 │ 12:00:29 │        │
   │   DROP   │   keep   │   keep   │   keep   │   keep   │        │
   └───────────────────────────────────────────────────────────────┘
        ▲
   ZREMRANGEBYSCORE 0 → (now − 60s)     removes anything older

   ZCARD → 4.  4 < 5 → ALLOW, and ZADD this request.
```

```lua
-- SLIDING_LOG
-- KEYS[1] = the zset
-- ARGV[1] = now_ms, ARGV[2] = window_ms, ARGV[3] = limit, ARGV[4] = request id
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[3]) then
  -- return how long until the OLDEST entry falls out of the window
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry = math.ceil((tonumber(oldest[2]) + tonumber(ARGV[2]) - tonumber(ARGV[1])) / 1000)
  return {0, count, retry}
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return {1, count + 1, 0}
```

```ts
redis.defineCommand('slidingLog', { numberOfKeys: 1, lua: SLIDING_LOG });

interface Decision { allowed: boolean; used: number; retryAfterSec: number }

async function allowSliding(id: string, limit = 100, windowMs = 60_000): Promise<Decision> {
  const [ok, used, retry] = (await redis.slidingLog(
    `rl:${id}`, Date.now(), windowMs, limit, randomUUID(),
  )) as [number, number, number];
  return { allowed: ok === 1, used, retryAfterSec: retry };
}
```

**No boundary burst.** The window truly slides — at any instant, it counts exactly the requests in the trailing 60 seconds.

:::warning[Memory is the price, and it scales with your limit]
One sorted-set member **per request in the window**.

```
   limit 1,000/min × 100,000 users  =  100,000,000 zset members
                                    ≈  6–8 GB
```

Fine for `limit = 10`. Catastrophic for `limit = 10,000`. Also note the request-id member must be unique — reusing one would *update* an existing member's score rather than add an entry ([Sorted Sets](./09-sorted-sets.md)), silently undercounting.
:::

Use the sliding log when the limit is small and precision matters — login attempts, password resets, expensive API endpoints.

---

## 3. Sliding window counter — the practical compromise

Keep two fixed-window counters and **interpolate** between them.

```
   limit = 100/min.  now = 12:00:30 (50% through the current window)

   previous window (11:59–12:00): 80 requests
   current  window (12:00–12:01): 30 requests

   estimate = current + previous × (fraction of the previous window still in view)
            = 30 + 80 × (1 − 0.5)
            = 30 + 40
            = 70

   70 < 100 → ALLOW

   ┌──────────────────────────┬──────────────────────────┐
   │  previous: 80            │  current: 30             │
   └────────────┬─────────────┴────────────┬─────────────┘
                └───── the sliding 60s window ─────┘
                  50% of "previous" is still inside it
```

```lua
-- SLIDING_COUNTER
-- KEYS[1] = the current bucket, KEYS[2] = the previous bucket
-- ARGV[1] = limit, ARGV[2] = window seconds, ARGV[3] = elapsed fraction (0..1)
local current  = tonumber(redis.call('GET', KEYS[1]) or '0')
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')

local estimate = current + previous * (1 - tonumber(ARGV[3]))

if estimate >= tonumber(ARGV[1]) then
  return {0, math.floor(estimate)}
end

redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
return {1, math.floor(estimate) + 1}
```

```ts
redis.defineCommand('slidingCounter', { numberOfKeys: 2, lua: SLIDING_COUNTER });

async function allowSlidingCounter(id: string, limit = 100, windowSec = 60) {
  const nowSec = Date.now() / 1000;
  const bucket = Math.floor(nowSec / windowSec);
  const elapsed = (nowSec % windowSec) / windowSec;      // 0..1 through the window

  const [ok, used] = (await redis.slidingCounter(
    `rl:${id}:${bucket}`, `rl:${id}:${bucket - 1}`, limit, windowSec, elapsed,
  )) as [number, number];

  return { allowed: ok === 1, used };
}
```

**Two keys per identity, ~120 bytes.** Constant memory regardless of the limit. Accuracy is within a few percent of a true sliding log, and there is no boundary burst.

The approximation assumes the previous window's requests were **evenly distributed**. If they were all in its final second, the estimate under-counts slightly. In practice the error is small and bounded, and this is the algorithm Cloudflare published as their production choice.

**This is the right default for HTTP API rate limiting.**

---

## 4. Token bucket — allows controlled bursts

A bucket refills at a steady rate; each request consumes a token.

```
   capacity = 10, refill = 1 token/second

   t=0    ▓▓▓▓▓▓▓▓▓▓  10 tokens (full)
   t=0    a burst of 10 requests → all allowed
          ░░░░░░░░░░  0 tokens
   t=1    ▓░░░░░░░░░  1 token refilled
   t=5    ▓▓▓▓▓░░░░░  5 tokens
   t=10   ▓▓▓▓▓▓▓▓▓▓  10 (capped at capacity)

   → allows a burst up to `capacity`, then settles to the refill rate.
```

```lua
-- TOKEN_BUCKET
-- KEYS[1] = the bucket hash
-- ARGV[1] = capacity, ARGV[2] = refill/sec, ARGV[3] = now_ms, ARGV[4] = requested
local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local want     = tonumber(ARGV[4])

local tokens = tonumber(state[1]) or capacity
local ts     = tonumber(state[2]) or now

-- refill for the time that has passed
tokens = math.min(capacity, tokens + ((now - ts) / 1000) * rate)

local allowed = 0
if tokens >= want then
  tokens = tokens - want
  allowed = 1
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil((capacity / rate) * 1000 * 2))

local retry = 0
if allowed == 0 then retry = math.ceil(((want - tokens) / rate)) end
return {allowed, math.floor(tokens), retry}
```

```ts
redis.defineCommand('tokenBucket', { numberOfKeys: 1, lua: TOKEN_BUCKET });

async function allowTokens(id: string, capacity = 10, refillPerSec = 1, cost = 1) {
  const [ok, remaining, retry] = (await redis.tokenBucket(
    `rl:tb:${id}`, capacity, refillPerSec, Date.now(), cost,
  )) as [number, number, number];
  return { allowed: ok === 1, remaining, retryAfterSec: retry };
}
```

Two properties nothing else on this page gives you:

**Bursts are a feature.** A user who has been idle accumulates tokens and can then make a batch of requests — which matches how real clients behave (a page load fires eight API calls at once) far better than a strict per-second cap.

**Variable cost.** A cheap endpoint costs 1 token; an expensive report costs 50. That is genuine capacity-based limiting rather than request counting, and it is why this is the algorithm most API gateways use.

```ts
await allowTokens(userId, 100, 10, endpointCost(req.path));
```

**Leaky bucket** is the sibling algorithm: requests enter a queue that drains at a fixed rate, smoothing output completely and allowing *no* bursts. Use it when you are protecting a downstream system that cannot absorb spikes at all.

---

## 5. Choosing

| | Fixed window | Sliding log | Sliding counter | Token bucket |
| :--- | :--- | :--- | :--- | :--- |
| Memory per identity | ~60 B | **O(limit)** | ~120 B | ~100 B |
| Boundary burst | ❌ **2× limit** | ✅ none | ✅ none | ✅ none |
| Precision | Low | **Exact** | ~High | High |
| Bursts allowed | Accidentally | No | No | ✅ **By design** |
| Variable cost per request | No | No | No | ✅ |
| Redis ops | 1–2 | 4–5 | 2–3 | 3 |
| Complexity | Trivial | Medium | Medium | Medium |

```
   Choosing:
     Coarse abuse protection, memory is tight   → FIXED WINDOW
     Small limits, precision matters
       (login attempts, password resets, OTPs)  → SLIDING LOG
     General HTTP API limiting                  → SLIDING COUNTER  ← default
     API gateway, tiered plans, bursty clients,
       variable endpoint cost                   → TOKEN BUCKET
```

---

## 6. Multi-tier limiting

Real systems apply several limits at once.

```ts
interface Tier { key: string; limit: number; windowSec: number }

async function checkAll(tiers: Tier[]): Promise<Decision & { tier?: string }> {
  const pipe = redis.pipeline();
  const nowSec = Date.now() / 1000;

  for (const t of tiers) {
    const bucket = Math.floor(nowSec / t.windowSec);
    const elapsed = (nowSec % t.windowSec) / t.windowSec;
    pipe.slidingCounter(
      `rl:${t.key}:${bucket}`, `rl:${t.key}:${bucket - 1}`,
      t.limit, t.windowSec, elapsed,
    );
  }

  const results = await pipe.exec();

  for (let i = 0; i < tiers.length; i++) {
    const [ok] = results![i][1] as [number, number];
    if (ok !== 1) return { allowed: false, used: 0, retryAfterSec: tiers[i].windowSec, tier: tiers[i].key };
  }
  return { allowed: true, used: 0, retryAfterSec: 0 };
}
```

```ts
const decision = await checkAll([
  { key: `ip:${ip}`,               limit: 1000, windowSec: 60 },     // per IP
  { key: `user:${userId}`,         limit: 100,  windowSec: 60 },     // per user
  { key: `user:${userId}:expensive`, limit: 10, windowSec: 60 },     // per endpoint
  { key: 'global',                 limit: 50_000, windowSec: 60 },   // total capacity
]);
```

The pipeline makes all four checks **one round trip**. Note the check is not fully atomic across tiers — a request can consume a token from tier 1 and then be rejected by tier 2, slightly over-consuming. For rate limiting that inaccuracy is acceptable; if it is not, do the whole thing in one Lua script.

---

## 7. The HTTP contract

```ts
import type { Request, Response, NextFunction } from 'express';

export function rateLimit(opts: { limit: number; windowSec: number; keyFn?: (req: Request) => string }) {
  const keyFn = opts.keyFn ?? ((req) => req.ip ?? 'unknown');

  return async (req: Request, res: Response, next: NextFunction) => {
    let decision: { allowed: boolean; used: number };

    try {
      decision = await allowSlidingCounter(keyFn(req), opts.limit, opts.windowSec);
    } catch (err) {
      // FAIL OPEN — a Redis outage must not reject all legitimate traffic.
      // Log it loudly; this is a security-relevant degradation.
      log.error({ err }, '[ratelimit] Redis unavailable — failing open');
      metrics.increment('ratelimit.degraded');
      return next();
    }

    const remaining = Math.max(0, opts.limit - decision.used);
    const resetAt = Math.ceil(Date.now() / 1000 / opts.windowSec) * opts.windowSec;

    // the IETF draft standard headers
    res.setHeader('RateLimit-Limit', opts.limit);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetAt - Math.floor(Date.now() / 1000));

    // the legacy X- headers most clients still look for
    res.setHeader('X-RateLimit-Limit', opts.limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetAt);

    if (!decision.allowed) {
      res.setHeader('Retry-After', resetAt - Math.floor(Date.now() / 1000));
      return res.status(429).json({
        error: 'Too Many Requests',
        limit: opts.limit,
        windowSeconds: opts.windowSec,
        retryAfter: resetAt - Math.floor(Date.now() / 1000),
      });
    }

    next();
  };
}
```

```ts
app.use('/api', rateLimit({ limit: 1000, windowSec: 60 }));
app.post('/api/login', rateLimit({
  limit: 5, windowSec: 900,
  keyFn: (req) => `login:${req.body.email ?? req.ip}`,
}), loginHandler);
```

:::warning[Fail open or fail closed?]
**Fail open** (shown above): a Redis outage means no rate limiting. An attacker who can DoS your Redis gets unlimited requests.

**Fail closed**: a Redis outage rejects *all* traffic, turning a Redis blip into a total outage.

For most APIs, fail open is right — availability beats limiting, and you have other defences (a WAF, a CDN, upstream limits). But **log it loudly and alert on it**: an unrate-limited API is a security-relevant state, not a benign degradation.

The better answer is **fail open with a local fallback**: keep a coarse in-process counter so you degrade to per-instance limiting rather than to none.

```ts
const localFallback = new Map<string, { count: number; resetAt: number }>();
```

For genuinely security-critical limits — login attempts, password resets, OTP sends — **fail closed**. Locking users out for two minutes is far better than allowing unlimited credential stuffing.
:::

---

## 8. Practical notes

**Choose the identity carefully.**

```ts
req.ip                          // ⚠ shared by everyone behind a corporate NAT
req.headers['x-forwarded-for']  // ⚠ SPOOFABLE unless your proxy is trusted
userId                          // ✅ best, when authenticated
apiKey                          // ✅ best for machine clients
`${userId ?? ip}`               // a reasonable fallback chain
```

If you use `X-Forwarded-For`, configure `app.set('trust proxy', 1)` correctly and take the client IP from the **right position** in the chain. Taking the leftmost value blindly lets any client set their own IP and bypass your limits entirely.

**Cluster:** all keys for one identity must share a slot for a multi-key Lua script.

```ts
`rl:{${userId}}:${bucket}`      // the hash tag co-locates current and previous
```

**Never let limiter keys live on a cache instance.** Same reasoning as [locks](./26-distributed-locks.md): an `allkeys-lru` eviction under memory pressure silently resets someone's counter, and nothing errors.

**Give successful requests a different budget from failed ones.** A login endpoint should count *failed* attempts strictly and successful ones loosely — otherwise a legitimate user with several devices trips their own limit.

---

## Rapid-fire recall

1. Draw the boundary-burst problem. Which algorithms have it?
2. In the fixed-window script, why is `EXPIRE` only set when `current == 1`?
3. Why does the sliding log need a unique member per request?
4. How does the sliding counter estimate the count, and what does it assume?
5. What two things does a token bucket give you that no other algorithm here does?
6. Which algorithm's memory scales with the limit, and when does that matter?
7. Which is the right default for general HTTP API rate limiting?
8. Should a rate limiter fail open or fail closed? Give the nuance.
9. Why is `X-Forwarded-For` dangerous as a rate-limit identity?
10. Why must rate-limit keys not live on an `allkeys-lru` instance?

<details>
<summary>Answers</summary>

1. 100 requests at 11:59:59 and 100 more at 12:00:00 both pass, because the second window is a fresh counter — 200 requests in a second against a 100/min limit. Only fixed window has it.
2. So the window is anchored to its first request. Setting it on every request would slide the expiry forward and let a steady stream keep the counter alive indefinitely.
3. Sorted-set members are unique — re-adding one *updates its score* instead of adding an entry, silently undercounting requests.
4. `current + previous × (1 − elapsed_fraction)`. It assumes the previous window's requests were evenly distributed within it; the error is small and bounded.
5. Bursts as a deliberate feature (idle users accumulate tokens), and variable cost per request (an expensive endpoint consumes more tokens).
6. The sliding window log — one zset member per request in the window. It matters as soon as the limit is large: 1,000/min × 100,000 users is gigabytes.
7. The sliding window counter — constant memory, no boundary burst, accurate within a few percent.
8. Usually fail open, since availability beats limiting and you have other defences — but log and alert loudly, and keep a coarse in-process fallback. Fail **closed** for security-critical limits like login attempts and OTP sends.
9. It is client-controlled and spoofable unless your proxy chain is trusted and you read the correct position; otherwise any client can bypass the limit by setting the header.
10. Under memory pressure Redis silently evicts a counter, resetting someone's budget with no error and no log — a security failure that is invisible.

</details>

---

**Next:** [Queues & Background Jobs](./28-queues-and-jobs.md) — Lists vs Streams vs BullMQ, and what a production job system actually needs.
