---
title: Redis in an Express App
author: Tejas Nirala
---

# Redis in an Express App

> **What you will be able to do after this page**
>
> - Wire Redis into a TypeScript Express service correctly, from connection to shutdown.
> - Ship cache, rate-limit, session, and idempotency middleware you can reuse.
> - Run a worker process alongside your API without them fighting over connections.
> - Handle every degraded state so a Redis blip never becomes an outage.

Everything from the previous 29 pages, assembled into a service you could actually deploy.

---

## 1. Project shape

```
   src/
     redis.ts             the clients — ONE place
     cache.ts             the cache wrapper
     middleware/
       cache.ts           HTTP response caching
       rateLimit.ts       rate limiting
       idempotency.ts     safe POST retries
     session.ts           session store
     queue.ts             BullMQ queues
     health.ts            liveness + readiness
     app.ts               the Express app
     server.ts            bootstrap + graceful shutdown
     worker.ts            a SEPARATE process for background jobs
```

```bash
npm install express ioredis bullmq express-session connect-redis
npm install -D typescript @types/express @types/node @types/express-session tsx
```

---

## 2. The connections

```ts
// src/redis.ts
import Redis, { type RedisOptions } from 'ioredis';
import { logger } from './logger';

const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

const base: RedisOptions = {
  connectionName: `${process.env.SERVICE_NAME ?? 'api'}-${process.env.HOSTNAME ?? 'local'}`,
  connectTimeout: 10_000,
  commandTimeout: 5_000,               // ← never let a command hang forever
  keepAlive: 30_000,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: true,
  retryStrategy: (times) => (times > 10 ? null : Math.min(times * 200, 5_000)),
  reconnectOnError: (err) =>
    err.message.includes('READONLY') || err.message.includes('MASTERDOWN'),
};

function instrument(client: Redis, name: string): Redis {
  client.on('connect',      () => logger.info({ name }, 'redis connected'));
  client.on('ready',        () => logger.info({ name }, 'redis ready'));
  client.on('error',        (err) => logger.error({ name, err }, 'redis error'));
  client.on('close',        () => logger.warn({ name }, 'redis closed'));
  client.on('reconnecting', (ms) => logger.warn({ name, ms }, 'redis reconnecting'));
  client.on('end',          () => logger.error({ name }, 'redis gave up reconnecting'));
  return client;
}

/** The general-purpose client. ioredis multiplexes, so ONE is enough. */
export const redis = instrument(new Redis(url, base), 'main');

/** Blocking commands occupy a connection — they need their own. */
export const blocking = instrument(redis.duplicate(), 'blocking');

/** Subscriber mode restricts a connection — it needs its own. */
export const subscriber = instrument(redis.duplicate(), 'subscriber');

/** BullMQ requires maxRetriesPerRequest: null; give it a dedicated config. */
export const queueConnection = { url, maxRetriesPerRequest: null } as const;

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), blocking.quit(), subscriber.quit()]);
}
```

```ts
// src/redis-scripts.ts — every Lua script, registered once, typed
import { redis } from './redis';

declare module 'ioredis' {
  interface RedisCommander<Context> {
    releaseLock(key: string, token: string): Promise<number>;
    extendLock(key: string, token: string, ttlMs: number): Promise<number>;
    slidingCounter(
      current: string, previous: string,
      limit: number, windowSec: number, elapsed: number,
    ): Promise<[number, number]>;
  }
}

redis.defineCommand('releaseLock', {
  numberOfKeys: 1,
  lua: `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
});

redis.defineCommand('extendLock', {
  numberOfKeys: 1,
  lua: `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`,
});

redis.defineCommand('slidingCounter', {
  numberOfKeys: 2,
  lua: `
    local current  = tonumber(redis.call('GET', KEYS[1]) or '0')
    local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
    local estimate = current + previous * (1 - tonumber(ARGV[3]))
    if estimate >= tonumber(ARGV[1]) then return {0, math.floor(estimate)} end
    redis.call('INCR', KEYS[1])
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
    return {1, math.floor(estimate) + 1}
  `,
});
```

Import `./redis-scripts` once at startup so the commands exist before any route uses them.

---

## 3. Response-cache middleware

```ts
// src/middleware/cache.ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { redis } from '../redis';
import { logger } from '../logger';

const VERSION = 'v1';

interface CachedResponse { status: number; body: unknown; contentType: string }

interface CacheOptions {
  ttlSeconds: number;
  keyFn?: (req: Request) => string;
  shouldCache?: (req: Request, res: Response) => boolean;
  varyBy?: string[];                   // header names that change the response
}

export function cache(opts: CacheOptions): RequestHandler {
  const {
    ttlSeconds,
    keyFn = (req) => req.originalUrl,
    shouldCache = (_req, res) => res.statusCode === 200,
    varyBy = [],
  } = opts;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') return next();

    const vary = varyBy.map((h) => `${h}=${req.get(h) ?? ''}`).join('|');
    const key = `cache:${VERSION}:http:${keyFn(req)}${vary ? `:${vary}` : ''}`;

    // ── try the cache; NEVER let a failure break the request ──────────────
    try {
      const hit = await redis.get(key);
      if (hit !== null) {
        const cached = JSON.parse(hit) as CachedResponse;
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Content-Type', cached.contentType);
        return res.status(cached.status).send(cached.body);
      }
    } catch (err) {
      logger.warn({ err, key }, 'cache read failed — serving fresh');
    }

    res.setHeader('X-Cache', 'MISS');

    // ── intercept res.json to capture the body ───────────────────────────
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (shouldCache(req, res)) {
        const jitter = ttlSeconds + Math.floor(Math.random() * ttlSeconds * 0.1);
        const payload: CachedResponse = {
          status: res.statusCode,
          body,
          contentType: res.getHeader('Content-Type')?.toString() ?? 'application/json',
        };
        // fire-and-forget: the response must not wait on the cache write
        redis.set(key, JSON.stringify(payload), 'EX', jitter)
          .catch((err) => logger.warn({ err, key }, 'cache write failed'));
      }
      return originalJson(body);
    };

    next();
  };
}

/** Invalidate by prefix. Uses SCAN — never KEYS. */
export async function invalidatePrefix(prefix: string): Promise<number> {
  let removed = 0;
  const stream = redis.scanStream({ match: `cache:${VERSION}:http:${prefix}*`, count: 200 });

  for await (const keys of stream) {
    if (keys.length === 0) continue;
    await redis.unlink(...keys);
    removed += keys.length;
  }
  return removed;
}
```

```ts
app.get('/api/posts', cache({ ttlSeconds: 60 }), listPosts);

app.get('/api/me',
  cache({ ttlSeconds: 30, keyFn: (req) => `me:${req.user!.id}`, varyBy: ['Accept-Language'] }),
  getMe,
);

app.post('/api/posts', async (req, res) => {
  const post = await db.posts.create(req.body);
  await invalidatePrefix('/api/posts');
  res.status(201).json(post);
});
```

:::warning[Three things people get wrong in cache middleware]
1. **Never cache authenticated responses under a shared key.** The `keyFn` must include the user id, or user A gets user B's data. This is a real, serious bug that ships regularly.
2. **The cache write must not block the response.** Note the un-awaited `.catch()` — the user should not wait for Redis to store a copy.
3. **`res.json` interception only catches `res.json()`.** If a route uses `res.send()` or streams a response, nothing is cached and nothing warns you. Either wrap `send` too, or standardize on `json`.
:::

---

## 4. Rate-limit middleware

```ts
// src/middleware/rateLimit.ts
import type { Request, RequestHandler } from 'express';
import { redis } from '../redis';
import { logger } from '../logger';
import { metrics } from '../metrics';

interface RateLimitOptions {
  limit: number;
  windowSec: number;
  keyFn?: (req: Request) => string;
  failClosed?: boolean;              // true for security-critical endpoints
  message?: string;
}

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const { limit, windowSec, failClosed = false, message = 'Too Many Requests' } = opts;
  const keyFn = opts.keyFn ?? ((req) => req.ip ?? 'unknown');

  return async (req, res, next) => {
    const id = keyFn(req);
    const nowSec = Date.now() / 1000;
    const bucket = Math.floor(nowSec / windowSec);
    const elapsed = (nowSec % windowSec) / windowSec;

    let allowed: boolean;
    let used: number;

    try {
      // the hash tag keeps both buckets on one Cluster slot
      const [ok, count] = await redis.slidingCounter(
        `rl:{${id}}:${bucket}`, `rl:{${id}}:${bucket - 1}`, limit, windowSec, elapsed,
      );
      allowed = ok === 1;
      used = count;
    } catch (err) {
      metrics.increment('ratelimit.degraded');
      logger.error({ err, id }, 'rate limiter unavailable');

      if (failClosed) {
        return res.status(503).json({ error: 'Service Unavailable' });
      }
      logger.warn('failing OPEN — traffic is currently unlimited');
      return next();
    }

    const remaining = Math.max(0, limit - used);
    const resetIn = Math.ceil((bucket + 1) * windowSec - nowSec);

    res.setHeader('RateLimit-Limit', limit);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetIn);
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (!allowed) {
      res.setHeader('Retry-After', resetIn);
      metrics.increment('ratelimit.rejected');
      return res.status(429).json({ error: message, retryAfter: resetIn });
    }

    next();
  };
}
```

```ts
app.set('trust proxy', 1);       // ← required, or req.ip is your load balancer

// a broad limit for everything
app.use('/api', rateLimit({ limit: 1000, windowSec: 60 }));

// per-user, once authenticated
app.use('/api', requireAuth, rateLimit({
  limit: 300, windowSec: 60,
  keyFn: (req) => `user:${req.user!.id}`,
}));

// strict, FAIL CLOSED, on credential endpoints
app.post('/api/auth/login', rateLimit({
  limit: 5, windowSec: 900,
  keyFn: (req) => `login:${String(req.body?.email ?? req.ip)}`,
  failClosed: true,
  message: 'Too many login attempts. Try again in 15 minutes.',
}), login);
```

---

## 5. Sessions

```ts
// src/session.ts
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { redis } from './redis';

export const sessionMiddleware = session({
  store: new RedisStore({ client: redis, prefix: 'session:', ttl: 86_400 }),
  secret: process.env.SESSION_SECRET!,
  name: 'sid',
  resave: false,             // ← don't rewrite an unchanged session every request
  saveUninitialized: false,  // ← don't create a session for anonymous visitors
  rolling: true,             // ← refresh the TTL on each request (sliding expiry)
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 86_400_000,
  },
});
```

:::warning[`resave` and `saveUninitialized` must both be `false`]
`resave: true` writes the session to Redis on **every request**, even when nothing changed — a large, pointless write load, and it can clobber a concurrent update from another tab.

`saveUninitialized: true` creates a Redis key for **every visitor**, including bots and health checks. A crawler produces millions of empty sessions that expire in a day but consume memory the whole time.

Both default to `true` in older documentation. Both should be `false`.
:::

```ts
// managing a user's sessions — logout-everywhere, device lists
export async function trackSession(userId: string, sid: string): Promise<void> {
  await redis.multi()
    .sadd(`user:${userId}:sessions`, sid)
    .expire(`user:${userId}:sessions`, 86_400 * 30)
    .exec();
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const sids = await redis.smembers(`user:${userId}:sessions`);
  if (sids.length === 0) return 0;

  await redis.unlink(...sids.map((s) => `session:${s}`), `user:${userId}:sessions`);
  return sids.length;
}
```

---

## 6. Idempotent POSTs

The middleware that prevents a double-submitted payment.

```ts
// src/middleware/idempotency.ts
import type { RequestHandler } from 'express';
import { redis } from '../redis';

interface StoredResult { status: number; body: unknown }

export function idempotent(ttlSeconds = 86_400): RequestHandler {
  return async (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!key) return next();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
      return res.status(400).json({ error: 'invalid Idempotency-Key' });
    }

    const userId = req.user?.id ?? req.ip ?? 'anon';
    const redisKey = `idem:{${userId}}:${key}`;

    // claim it atomically; the marker doubles as an in-progress flag
    const claimed = await redis.set(redisKey, 'IN_PROGRESS', 'NX', 'EX', ttlSeconds);

    if (claimed !== 'OK') {
      const existing = await redis.get(redisKey);

      if (existing === 'IN_PROGRESS') {
        res.setHeader('Retry-After', '1');
        return res.status(409).json({ error: 'A request with this key is in progress' });
      }

      const stored = JSON.parse(existing!) as StoredResult;
      res.setHeader('Idempotent-Replay', 'true');
      return res.status(stored.status).json(stored.body);
    }

    // first time through — capture the result
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode < 500) {
        redis.set(redisKey, JSON.stringify({ status: res.statusCode, body }), 'EX', ttlSeconds)
          .catch(() => { /* logged elsewhere */ });
      } else {
        // a 5xx should be retryable — release the claim
        redis.unlink(redisKey).catch(() => {});
      }
      return originalJson(body);
    };

    next();
  };
}
```

```ts
app.post('/api/payments', requireAuth, idempotent(), createPayment);
```

A client that times out and retries with the same `Idempotency-Key` receives the **original response** rather than creating a second payment. This is exactly how Stripe's API works, and it is roughly forty lines.

---

## 7. Health checks

```ts
// src/health.ts
import { redis } from './redis';

export async function liveness(): Promise<boolean> {
  // ONLY "is the process responsive?" — must NOT fail on high memory,
  // or your orchestrator will restart a healthy-but-busy Redis.
  try { return (await redis.ping()) === 'PONG'; } catch { return false; }
}

export async function readiness(): Promise<{ ready: boolean; issues: string[] }> {
  const issues: string[] = [];
  try {
    if ((await redis.ping()) !== 'PONG') issues.push('ping failed');

    const info = await redis.info();
    const num = (k: string) => Number(new RegExp(`^${k}:(\\S+)`, 'm').exec(info)?.[1] ?? NaN);
    const str = (k: string) => new RegExp(`^${k}:(\\S+)`, 'm').exec(info)?.[1] ?? null;

    if (num('loading') === 1) issues.push('redis is still loading its dataset');
    if (num('mem_fragmentation_ratio') < 1.0) issues.push('redis is swapping');
    if (str('rdb_last_bgsave_status') !== 'ok') issues.push('last BGSAVE failed');
  } catch (err) {
    issues.push(`redis unreachable: ${(err as Error).message}`);
  }
  return { ready: issues.length === 0, issues };
}
```

```ts
app.get('/healthz', async (_req, res) =>
  (await liveness()) ? res.sendStatus(200) : res.sendStatus(503));

app.get('/readyz', async (_req, res) => {
  const { ready, issues } = await readiness();
  res.status(ready ? 200 : 503).json({ ready, issues });
});
```

:::danger[Do not make `/healthz` depend on Redis being *healthy*]
If liveness fails when memory is high, Kubernetes restarts your **API pods** because **Redis** is under pressure — turning a degraded cache into a full outage while the restarts make it worse.

Liveness = "is this process responsive?" Readiness = "should traffic come here?" Keep them separate, and let the API stay alive and degrade gracefully when Redis is unwell.
:::

---

## 8. The app and graceful shutdown

```ts
// src/app.ts
import express from 'express';
import './redis-scripts';                 // register Lua commands at startup
import { sessionMiddleware } from './session';
import { rateLimit } from './middleware/rateLimit';
import { cache } from './middleware/cache';
import { liveness, readiness } from './health';

export const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(sessionMiddleware);

app.get('/healthz', async (_r, res) => ((await liveness()) ? res.sendStatus(200) : res.sendStatus(503)));
app.get('/readyz',  async (_r, res) => {
  const { ready, issues } = await readiness();
  res.status(ready ? 200 : 503).json({ ready, issues });
});

app.use('/api', rateLimit({ limit: 1000, windowSec: 60 }));
app.get('/api/posts', cache({ ttlSeconds: 60 }), listPosts);
```

```ts
// src/server.ts
import { app } from './app';
import { closeRedis } from './redis';
import { closeQueues } from './queue';
import { logger } from './logger';

const server = app.listen(Number(process.env.PORT ?? 3000), () =>
  logger.info('listening'));

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  // 1. fail readiness so the load balancer drains us BEFORE we stop listening
  app.locals.draining = true;
  await new Promise((r) => setTimeout(r, 5_000));

  // 2. stop accepting new connections, let in-flight requests finish
  await new Promise<void>((resolve) => server.close(() => resolve()));

  // 3. close Redis LAST — in-flight requests may still need it
  await closeQueues();
  await closeRedis();

  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// force-exit if a connection hangs
process.on('SIGTERM', () => setTimeout(() => process.exit(1), 30_000).unref());
```

**The order matters.** Fail readiness → drain → stop listening → finish in-flight work → close Redis. Closing Redis first makes every in-flight request fail during the exact window you were trying to make graceful.

---

## 9. The worker process

Background jobs belong in a **separate process**, not in your API.

```ts
// src/queue.ts
import { Queue, Worker, type Job } from 'bullmq';
import { queueConnection } from './redis';
import { logger } from './logger';

export interface EmailJob { to: string; template: string; vars: Record<string, string> }

export const emailQueue = new Queue<EmailJob>('emails', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600, count: 1000 },     // ← or Redis fills up
    removeOnFail: { age: 86_400 },
  },
});

export const closeQueues = () => emailQueue.close();

export function startEmailWorker(): Worker<EmailJob> {
  const worker = new Worker<EmailJob>(
    'emails',
    async (job: Job<EmailJob>) => {
      // idempotent: the provider dedupes on this key
      await sendEmail(job.data, { idempotencyKey: `job:${job.id}` });
    },
    { connection: queueConnection, concurrency: 10, limiter: { max: 100, duration: 60_000 } },
  );

  worker.on('failed', (job, err) => logger.error({ err, jobId: job?.id }, 'job failed'));
  worker.on('error',  (err) => logger.error({ err }, 'worker error'));
  return worker;
}
```

```ts
// src/worker.ts — a separate entrypoint
import { startEmailWorker } from './queue';
import { closeRedis } from './redis';

const worker = startEmailWorker();

process.on('SIGTERM', async () => {
  await worker.close();        // waits for in-flight jobs
  await closeRedis();
  process.exit(0);
});
```

```json
{
  "scripts": {
    "dev":        "tsx watch src/server.ts",
    "dev:worker": "tsx watch src/worker.ts",
    "start":      "node dist/server.js",
    "start:worker": "node dist/worker.js"
  }
}
```

:::tip[Why a separate process, not a separate function]
1. **A CPU-heavy job blocks the Node event loop**, so running it in your API process adds latency to every HTTP request.
2. **You scale them independently** — 3 API pods and 10 workers, or the reverse.
3. **A worker crash does not take down your API**, and a deploy can restart them separately.
4. **Different shutdown semantics**: the API drains requests in seconds; a worker may need minutes to finish a long job.
:::

---

## 10. Local development

```yaml
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    command: >
      redis-server
      --appendonly yes
      --maxmemory 256mb
      --maxmemory-policy noeviction
      --lazyfree-lazy-eviction yes
      --lazyfree-lazy-expire yes
      --lazyfree-lazy-server-del yes
      --lazyfree-lazy-user-del yes
    volumes: ['redis-data:/data']
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 5

  redis-insight:                       # a GUI at http://localhost:5540
    image: redis/redisinsight:latest
    ports: ['5540:5540']

volumes:
  redis-data:
```

```ts
// tests — an isolated database per test file, and always clean up
import Redis from 'ioredis';

const redis = new Redis({ db: Number(process.env.VITEST_WORKER_ID ?? 1) });

beforeEach(async () => { await redis.flushdb(); });
afterAll(async () => { await redis.quit(); });
```

:::warning[Never point tests at a shared Redis without a dedicated database]
`FLUSHDB` in a test suite pointed at a shared development instance wipes a colleague's data mid-debugging. Use `db` numbering per test worker locally (one of the very few good uses of numbered databases), or spin up a container per run.
:::

---

## 11. The complete checklist for this service

```
   □ ONE Redis client at module scope, plus duplicates for blocking & pubsub
   □ commandTimeout set — no command can hang forever
   □ Lua scripts registered once via defineCommand, with declare module types
   □ cache middleware keys include the user id for authenticated routes
   □ cache writes are fire-and-forget; cache reads fail open
   □ TTL jitter on every cached value
   □ versioned cache keys (cache:v1:) so a schema change is a one-line deploy
   □ invalidation uses SCAN, never KEYS
   □ rate limits: broad + per-user + strict-and-fail-closed on auth endpoints
   □ app.set('trust proxy', …) configured, so req.ip is real
   □ sessions: resave false, saveUninitialized false, rolling true
   □ idempotency middleware on every non-idempotent POST
   □ liveness = PING only; readiness also checks loading and swap
   □ graceful shutdown: drain → stop listening → finish → close Redis LAST
   □ workers in a separate process, with their own shutdown
   □ BullMQ: maxRetriesPerRequest null, removeOnComplete set
   □ tests use an isolated database and clean up
```

---

## Rapid-fire recall

1. How many Redis connections does this service open, and why each one?
2. Why must a cache middleware key include the user id?
3. Why is the cache write not awaited?
4. Why does the rate limiter fail closed on `/login` but open elsewhere?
5. Why must `resave` and `saveUninitialized` both be `false`?
6. How does the idempotency middleware distinguish "in progress" from "done"?
7. Why must `/healthz` not fail when Redis memory is high?
8. What is the correct shutdown order, and what breaks if you close Redis first?
9. Give four reasons workers run in a separate process.
10. Why does BullMQ need `maxRetriesPerRequest: null` and `removeOnComplete`?

<details>
<summary>Answers</summary>

1. Three from ioredis — a multiplexed main client, one for blocking commands (which occupy a connection), one for Pub/Sub (subscriber mode restricts the connection) — plus whatever BullMQ opens internally with its own config.
2. Otherwise one user's cached response is served to another. It is a real data-leak bug that ships regularly.
3. The user should not wait for Redis to store a copy of a response they already have. The write is fire-and-forget with a `.catch()`.
4. An unlimited login endpoint enables credential stuffing, so rejecting traffic is safer than allowing it. For general API traffic, availability matters more and other defences exist.
5. `resave: true` rewrites the session on every request — pointless write load and a clobbering risk. `saveUninitialized: true` creates a Redis key for every anonymous visitor, including bots.
6. The claim is set to the literal `IN_PROGRESS` with `NX`; a second request that reads that value gets a 409. Once the handler responds, the value is replaced with the serialized result, so later retries get a replay.
7. Liveness failure restarts the pod. Restarting your API because Redis is under memory pressure turns a degraded cache into an outage, and the restart storm makes it worse.
8. Fail readiness → wait for the load balancer to drain → stop listening → let in-flight requests finish → close Redis. Closing Redis first makes every in-flight request fail during the window you were trying to make graceful.
9. A CPU-heavy job blocks the event loop and adds latency to HTTP requests; independent scaling; a worker crash does not take down the API; and different shutdown semantics (seconds versus minutes).
10. BullMQ manages its own retry semantics and ioredis's default interferes during reconnects. Without `removeOnComplete`, every finished job's hash is retained forever and fills the instance — the most common BullMQ production incident.

</details>

---

**Next:** [Interview Q&A](./31-interview-qa.md) — the questions, with answers written the way you would say them out loud.
