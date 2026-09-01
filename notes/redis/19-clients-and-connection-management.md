---
title: Clients & Connection Management
author: Tejas Nirala
---

# Clients & Connection Management

> **What you will be able to do after this page**
>
> - Configure an ioredis client that behaves correctly during a failover, not just on a good day.
> - Know when you need a second connection and when multiplexing already handles it.
> - Handle every reconnection and timeout case without losing data or hanging requests.
> - Write a Redis wrapper your team can use without shooting themselves in the foot.

Most Redis production incidents are not Redis's fault — they are client configuration. This page is the boring, high-value one.

---

## 1. Why ioredis

We chose it in these notes for three concrete reasons:

1. **Command names map 1:1.** You learned `ZADD` in `redis-cli`; you write `redis.zadd(...)`. No translation layer, no mental tax.
2. **Real Cluster and Sentinel support**, including slot-map refresh and `MOVED`/`ASK` handling.
3. **`defineCommand`** makes Lua scripts first-class, type-safe commands with automatic `EVALSHA` caching and `NOSCRIPT` recovery.

```bash
npm install ioredis
```

The main alternative, `node-redis` v4+, is the official client with a slightly cleaner options-object API. Everything on this page applies conceptually to both; only the syntax differs.

---

## 2. The connection you should actually create

```ts
// src/redis.ts
import Redis, { type RedisOptions } from 'ioredis';

const options: RedisOptions = {
  // ── identity ──────────────────────────────────────────────────────────
  connectionName: `${process.env.SERVICE_NAME}-${process.env.HOSTNAME}`,
  //   ↑ shows up in CLIENT LIST and SLOWLOG. Costs nothing, saves hours.

  // ── timeouts ──────────────────────────────────────────────────────────
  connectTimeout: 10_000,        // give up on a new connection after 10s
  commandTimeout: 5_000,         // fail a command after 5s rather than hang
  keepAlive: 30_000,             // TCP keepalive: detect dead peers

  // ── retries ───────────────────────────────────────────────────────────
  maxRetriesPerRequest: 3,       // then the command rejects
  retryStrategy: (times) => {
    if (times > 10) return null; // stop reconnecting entirely
    return Math.min(times * 200, 5_000);   // 200ms, 400ms, … capped at 5s
  },

  // ── behaviour during an outage ────────────────────────────────────────
  enableOfflineQueue: true,      // queue commands while disconnected
  enableReadyCheck: true,        // wait for INFO to report ready, not just TCP

  // ── failover awareness ────────────────────────────────────────────────
  reconnectOnError: (err) => {
    // a replica was promoted / demoted under us — reconnect to re-resolve
    if (err.message.includes('READONLY')) return true;
    if (err.message.includes('MASTERDOWN')) return true;
    return false;
  },
};

export const redis = new Redis(process.env.REDIS_URL!, options);

redis.on('connect',      () => log.info('[redis] tcp connected'));
redis.on('ready',        () => log.info('[redis] ready'));
redis.on('error',        (err) => log.error({ err }, '[redis] error'));
redis.on('close',        () => log.warn('[redis] connection closed'));
redis.on('reconnecting', (ms: number) => log.warn({ ms }, '[redis] reconnecting'));
redis.on('end',          () => log.warn('[redis] connection ended, no more retries'));
```

Every one of those options exists because its default caused someone an outage. The four that matter most:

:::danger[`commandTimeout` is not set by default — set it]
Without it, a command issued to a Redis that has stopped responding (a network partition, a hung server, a saturated disk) **hangs forever**. Your request handler never returns. Your connection pool drains. Your service falls over while Redis is merely unreachable.

Set `commandTimeout` to something a little above your p99 — 1–5 seconds is typical. A fast failure that you can turn into a degraded response is enormously better than a hang.
:::

:::warning[`enableOfflineQueue` — understand both sides]
`true` (default): commands issued while disconnected are **queued in memory** and sent on reconnect. Good for brief blips — the caller does not see an error.

The risk: a long outage means an unbounded queue of promises, growing memory, and — when the connection returns — a thundering flush of stale commands. A "set this cache value" from four minutes ago is worse than useless.

`false`: commands fail immediately with `Stream isn't writeable`. Harsher, but you find out instantly and can serve a degraded response.

**Guidance:** `true` for caches (a brief blip should be invisible), `false` for a queue producer or anything where a stale write is harmful. If you keep it `true`, always pair it with `commandTimeout`.
:::

`retryStrategy` returning `null` gives up permanently and emits `end`. Returning a number means "retry in this many ms". The exponential-with-cap shape above avoids hammering a recovering server.

`reconnectOnError` catching `READONLY` is the [Sentinel](./21-sentinel-and-failover.md) failover case: your connection is pinned to a node that just became a replica, and every write now fails. Reconnecting forces re-resolution of the current primary.

---

## 3. How many connections do you need?

**ioredis multiplexes.** One `Redis` instance = one TCP connection, and concurrent commands from your application are written back-to-back into it. You get **implicit pipelining under concurrency** for free.

```ts
// these three run concurrently over ONE socket, in one write() if they
// land in the same tick — no pool needed
const [user, posts, followers] = await Promise.all([
  redis.hgetall('user:1042'),
  redis.lrange('user:1042:feed', 0, 9),
  redis.scard('user:1042:followers'),
]);
```

So the answer to "how big should my pool be?" is usually **one**, plus a dedicated connection for each of these three cases:

```
   ┌──────────────────────────────────────────────────────────────────┐
   │ 1. BLOCKING COMMANDS                                             │
   │    BRPOP, BLMOVE, BZPOPMIN, XREADGROUP … BLOCK                   │
   │    The connection is occupied for the whole block. One per worker.│
   ├──────────────────────────────────────────────────────────────────┤
   │ 2. PUB/SUB SUBSCRIBERS                                           │
   │    Subscriber mode restricts what the connection may run (RESP2). │
   ├──────────────────────────────────────────────────────────────────┤
   │ 3. WATCHed TRANSACTIONS                                          │
   │    WATCH state is per-connection and leaks between logical ops.   │
   └──────────────────────────────────────────────────────────────────┘
```

```ts
export const redis = new Redis(url, options);          // everything normal
export const sub = redis.duplicate();                  // Pub/Sub
export const blocking = redis.duplicate();             // BRPOP workers
```

`duplicate()` clones the options, so configuration stays in one place.

:::tip[When you *do* want more than one connection for normal commands]
Multiplexing has one weakness: **head-of-line blocking**. If a slow command (`SUNION` on big sets, a Lua script) is in flight, every other command queued behind it on that socket waits.

If you have a mix of latency-critical and occasionally-slow operations, use two clients:

```ts
export const redisFast = new Redis(url, { ...options, commandTimeout: 1_000 });
export const redisBulk = new Redis(url, { ...options, commandTimeout: 30_000 });
```
Route your hot path to `redisFast` and your batch jobs to `redisBulk`. Cheap isolation.
:::

---

## 4. Lifecycle: startup and shutdown

```ts
// graceful shutdown — flush in-flight commands, then close
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'shutting down');

  server.close();                        // stop accepting new HTTP requests
  await new Promise((r) => setTimeout(r, 5_000));   // let in-flight ones finish

  await Promise.all([
    redis.quit(),                        // ← graceful: sends QUIT, drains
    sub.quit(),
    blocking.quit(),
  ]);

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

:::warning[`quit()` vs `disconnect()`]
- **`quit()`** sends the `QUIT` command, waits for queued commands to finish, then closes. **Use this.**
- **`disconnect()`** rips the socket down immediately. In-flight commands reject. Use it only when you are already in an unrecoverable state.

Calling `disconnect()` in a shutdown handler is a common bug: pending writes are lost silently, and in a queue producer that means dropped jobs.
:::

```ts
// health check — do not just check the object, actually talk to the server
export async function redisHealthy(): Promise<boolean> {
  try {
    const res = await redis.ping();
    return res === 'PONG';
  } catch {
    return false;
  }
}
```

`redis.status` (`'ready'`, `'connecting'`, `'end'`) tells you what the client *thinks*. A `PING` tells you the truth. Health endpoints should use `PING` with a short timeout.

---

## 5. The wrapper worth writing

Raw Redis calls scattered through a codebase produce inconsistent key naming, missing TTLs, and unhandled failures. A thin typed layer fixes all three.

```ts
// src/cache.ts
import { redis } from './redis';

const PREFIX = 'cache:v1';

/** A cache read must NEVER take down the request. Fail open. */
async function safe<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await op();
  } catch (err) {
    log.warn({ err }, '[cache] degraded — falling through to the source');
    metrics.increment('cache.error');
    return fallback;
  }
}

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  const full = `${PREFIX}:${key}`;

  const hit = await safe(() => redis.get(full), null);
  if (hit !== null) {
    metrics.increment('cache.hit');
    return JSON.parse(hit) as T;
  }

  metrics.increment('cache.miss');
  const value = await produce();

  // jitter the TTL so a burst of writes does not become a burst of misses
  const ttl = ttlSeconds + Math.floor(Math.random() * ttlSeconds * 0.1);
  await safe(() => redis.set(full, JSON.stringify(value), 'EX', ttl), null);

  return value;
}

export const invalidate = (key: string) => safe(() => redis.unlink(`${PREFIX}:${key}`), 0);
```

```ts
const user = await cached(`user:${id}`, 300, () => db.users.findById(id));
```

Four decisions encoded there, each of which is a lesson from an earlier page:

1. **Fail open.** A Redis outage degrades you to database speed; it does not take you down. **This is the single most important line in the file.**
2. **A versioned prefix** (`cache:v1`) — bump it to invalidate every entry on a schema change, instead of flushing.
3. **TTL jitter** — no synchronized expiry avalanche.
4. **`UNLINK`, not `DEL`** — background frees by default.

:::danger[Fail open for caches, fail closed for correctness]
```ts
// ✅ a cache read fails → hit the database, serve the user
// ✅ a rate-limit check fails → …now what?
```
For a rate limiter, "fail open" means an attacker who can DoS your Redis gets unlimited requests. "Fail closed" means a Redis blip rejects all legitimate traffic.

The usual answer is **fail open with a local fallback**: keep a coarse in-process counter as a backstop so you degrade to per-instance limiting rather than to no limiting. Decide this deliberately per feature — the default should never be implicit.
:::

---

## 6. Client-side introspection and control

```bash
CLIENT LIST                       # every connection with its state
CLIENT LIST TYPE normal|master|replica|pubsub
CLIENT INFO                       # just this connection
CLIENT ID
CLIENT SETNAME app-worker-3
CLIENT GETNAME
CLIENT KILL ID 42
CLIENT KILL ADDR 10.0.1.5:52134
CLIENT KILL LADDR … TYPE … USER … MAXAGE …
CLIENT NO-EVICT on                # protect this client's buffer from eviction
CLIENT NO-TOUCH on                # don't update LRU/LFU on this client's reads
CLIENT UNPAUSE
CLIENT PAUSE 1000 [WRITE|ALL]     # briefly stop processing — used during failover
```

```bash
127.0.0.1:6379> CLIENT LIST
id=42 addr=10.0.1.5:52134 laddr=10.0.1.2:6379 fd=8 name=api-worker-3
age=3600 idle=0 flags=N db=0 sub=0 psub=0 multi=-1 watch=0
qbuf=26 qbuf-free=20448 argv-mem=10 multi-mem=0 tot-net-in=1234
tot-net-out=5678 rbs=1024 rbp=0 obl=0 oll=0 omem=0 tot-mem=20512
events=r cmd=get user=default redir=-1 resp=2
```

The fields worth reading:

| Field | Meaning | Watch for |
| :--- | :--- | :--- |
| `name` | `CLIENT SETNAME` | Empty = you cannot identify the culprit |
| `age` / `idle` | Seconds connected / since last command | High `idle` on many clients = a leak |
| `omem` / `oll` | Output buffer memory / list length | **Growing = a slow consumer about to be killed** |
| `qbuf` | Query buffer size | Huge = a giant pipeline or a huge value being written |
| `multi` | Queued commands in a `MULTI` | ≥ 0 means it is mid-transaction |
| `watch` | Number of watched keys | **> 0 on an idle pooled connection = a leaked `WATCH`** |
| `cmd` | Last command | What this connection is doing right now |
| `tot-mem` | Total memory for this client | Sum across clients = `clients.normal` in `MEMORY STATS` |

`CLIENT NO-TOUCH on` is a nice detail: set it on your monitoring and backup connections so their scans do not pollute the LRU/LFU statistics that eviction depends on.

### Server-side connection limits

```conf
maxclients 10000            # refuse connections beyond this
timeout 0                   # close idle clients after N seconds. 0 = never.
tcp-keepalive 300           # send TCP keepalives every 300s

client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60
```

:::warning[`maxclients` is silently reduced by the file-descriptor limit]
Redis needs one FD per client plus ~32 for itself. If `ulimit -n` is 1024, your effective `maxclients` is ~992 regardless of the config, and Redis logs a warning at startup that nobody reads.

```bash
# check what you actually got
redis-cli CONFIG GET maxclients
redis-cli INFO clients
cat /proc/$(pgrep -f redis-server)/limits | grep 'open files'
```
Raise `LimitNOFILE` in the systemd unit, not just `ulimit` in a shell.
:::

---

## 7. The failure modes, and what to do about each

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| `ECONNREFUSED` | Redis is down, or the wrong port | Health checks; `retryStrategy` |
| `ETIMEDOUT` on connect | Network/firewall, or Redis is overloaded | `connectTimeout`; check `INFO clients` |
| Requests hang forever | No `commandTimeout` | **Set `commandTimeout`** |
| `READONLY You can't write against a read only replica` | You are pinned to a demoted primary after a failover | `reconnectOnError` returning true on `READONLY`; use Sentinel/Cluster mode |
| `MOVED 3999 …` in your logs | Cluster keys moved and your client is not cluster-aware | Use `new Redis.Cluster([...])` |
| `CROSSSLOT Keys in request don't hash to the same slot` | Multi-key command across slots in Cluster | Hash tags `{...}` |
| `NOAUTH` / `WRONGPASS` | Missing or wrong credentials | Check the URL/ACL |
| `OOM command not allowed` | At `maxmemory` with `noeviction` (or `volatile-*` with no TTL'd keys) | Scale up; review the eviction policy |
| `LOADING Redis is loading the dataset` | Just restarted, still reading the AOF/RDB | Retry with backoff; a health check should report not-ready |
| `BUSY Redis is busy running a script` | A long Lua script is blocking | `SCRIPT KILL`; fix the script |
| `max number of clients reached` | Connection leak, or `maxclients`/FD limit too low | Fix pooling; raise `LimitNOFILE` |
| `Stream isn't writeable` (ioredis) | Disconnected with `enableOfflineQueue: false` | Expected — handle it as a degraded path |
| Connections climb forever | A new client per request | Create the client **once**, at module scope |

:::danger[The single most common client bug in Node.js]
```ts
// ❌ inside a request handler — creates a NEW TCP connection per request,
//    never closes it, and exhausts maxclients within minutes
app.get('/user/:id', async (req, res) => {
  const redis = new Redis(process.env.REDIS_URL!);   // ← NO
  ...
});

// ✅ create it once, at module scope, and import it everywhere
import { redis } from './redis';
```
`total_connections_received` climbing steadily in `INFO stats` is the tell. It is astonishingly common, usually introduced by copy-pasting a "getting started" snippet into a handler.
:::

---

## 8. Sentinel and Cluster clients

Both are covered in depth on their own pages; here is the client-side shape.

```ts
// SENTINEL — the client asks the sentinels who the primary is,
// and re-resolves automatically after a failover
const redis = new Redis({
  sentinels: [
    { host: 'sentinel-1', port: 26379 },
    { host: 'sentinel-2', port: 26379 },
    { host: 'sentinel-3', port: 26379 },
  ],
  name: 'mymaster',                 // the monitored primary's name
  sentinelPassword: process.env.SENTINEL_PASSWORD,
  password: process.env.REDIS_PASSWORD,
  role: 'master',                   // or 'slave' to read from replicas
});
```

```ts
// CLUSTER — the client keeps a slot map and routes each key to its node
const cluster = new Redis.Cluster(
  [
    { host: 'node-1', port: 6379 },
    { host: 'node-2', port: 6379 },
    { host: 'node-3', port: 6379 },
  ],
  {
    redisOptions: { password: process.env.REDIS_PASSWORD },
    scaleReads: 'slave',            // 'master' | 'slave' | 'all'
    clusterRetryStrategy: (times) => Math.min(times * 100, 3_000),
    enableOfflineQueue: true,
  },
);
```

**Never point a plain `new Redis()` at a cluster node.** It will work for keys that happen to live on that node and return `MOVED` errors for everything else — an intermittent, load-dependent bug that looks like data loss.

---

## 9. Observability worth wiring up

```ts
// per-command timing and error rates
redis.on('error', (err) => metrics.increment('redis.error', { type: err.name }));

// a light periodic scrape of server health
setInterval(async () => {
  try {
    const info = await redis.info();
    const get = (k: string) => Number(new RegExp(`^${k}:(\\S+)`, 'm').exec(info)?.[1] ?? 0);

    metrics.gauge('redis.used_memory', get('used_memory'));
    metrics.gauge('redis.connected_clients', get('connected_clients'));
    metrics.gauge('redis.blocked_clients', get('blocked_clients'));
    metrics.gauge('redis.evicted_keys', get('evicted_keys'));
    metrics.gauge('redis.ops_per_sec', get('instantaneous_ops_per_sec'));

    const hits = get('keyspace_hits');
    const misses = get('keyspace_misses');
    metrics.gauge('redis.hit_ratio', hits / (hits + misses || 1));
  } catch (err) {
    log.warn({ err }, '[redis] metrics scrape failed');
  }
}, 15_000);
```

Full alerting guidance is in [Observability & Operations](./24-observability-and-ops.md).

---

## Rapid-fire recall

1. Why does ioredis usually need only one connection for normal commands?
2. Name the three cases that genuinely require a separate connection.
3. What happens without `commandTimeout` when Redis becomes unreachable?
4. `enableOfflineQueue: true` vs `false` — what does each cost you?
5. What is `reconnectOnError` catching `READONLY` for?
6. `quit()` vs `disconnect()` — which belongs in a shutdown handler and why?
7. Which `CLIENT LIST` fields reveal (a) a slow consumer and (b) a leaked `WATCH`?
8. Your effective `maxclients` is lower than configured. Why?
9. What is the most common Node.js Redis bug, and which metric reveals it?
10. Should a cache read fail open or fail closed? What about a rate-limit check?

<details>
<summary>Answers</summary>

1. It multiplexes — concurrent commands are written back-to-back into one socket, giving implicit pipelining. A pool adds little for ordinary commands.
2. Blocking commands (the connection is occupied), Pub/Sub subscribers (subscriber mode restricts the connection in RESP2), and `WATCH`ed transactions (`WATCH` state is per-connection).
3. Commands hang indefinitely. Request handlers never return, your service's own concurrency limit is exhausted, and you fall over even though Redis is merely unreachable.
4. `true` hides brief blips but can build an unbounded queue of stale commands during a long outage, then flush them all at once. `false` fails immediately — harsher, but honest and safe for writes.
5. A Sentinel failover can leave your connection pinned to a node that was demoted to a replica, so every write fails with `READONLY`. Reconnecting forces re-resolution of the current primary.
6. `quit()` — it drains queued commands before closing. `disconnect()` rips the socket down and rejects in-flight commands, silently losing writes.
7. (a) `omem`/`oll` growing — an output buffer filling up before Redis kills the client. (b) `watch` > 0 on an idle connection — a `WATCH` that was never cleared.
8. Redis needs one file descriptor per client plus ~32; the process `ulimit -n` caps it below the configured value, and Redis only logs a startup warning.
9. Creating `new Redis()` inside a request handler, so every request opens a connection that is never closed. `total_connections_received` in `INFO stats` climbs steadily.
10. A cache read should fail open — degrade to database speed rather than erroring. A rate-limit check should be decided deliberately; the usual answer is fail open with a coarse in-process fallback, so a Redis outage degrades to per-instance limiting rather than to none.

</details>

---

**Next:** [Replication](./20-replication.md) — how a second copy of your data stays in sync, and what it does not guarantee.
