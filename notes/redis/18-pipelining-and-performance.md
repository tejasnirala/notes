---
title: Pipelining & Performance
author: Tejas Nirala
---

# Pipelining & Performance

> **What you will be able to do after this page**
>
> - Explain why 1,000 commands take 500 ms and 1,000 pipelined commands take 3 ms.
> - Choose correctly between pipelining, `MULTI`, `MGET`, and Lua.
> - Benchmark honestly with `redis-benchmark`, and read the result.
> - Run the "Redis is slow" diagnostic and find the actual cause.

The single most valuable performance idea in Redis is that **the network, not the server, is your bottleneck.** Everything on this page follows from that.

---

## 1. The RTT problem

```
   ONE command, unpipelined:

   client                                            server
     │  ── SET k1 v1 ──────────────────────────────►   │
     │                                        execute (~1 µs)
     │  ◄──────────────────────────────── +OK ─────    │
     │                                                 │
     └── ~0.5 ms elapsed. 0.0002% of it was Redis. ───┘

   1,000 commands, one at a time:
     1,000 × 0.5 ms = 500 ms
     Of which the server worked for 1 ms.
     You spent 499 ms waiting for light to travel down a cable.
```

Redis's throughput ceiling for a single unpipelined client is therefore **1/RTT**, regardless of how fast the server is:

| Network | RTT | Max ops/sec per connection |
| :--- | :--- | :--- |
| Unix socket | ~0.03 ms | ~33,000 |
| Same host (loopback) | ~0.05 ms | ~20,000 |
| Same datacenter | ~0.5 ms | **~2,000** |
| Cross-region | ~50 ms | **~20** |

Read that table again. A Redis server capable of a million operations per second serves **2,000** to a naive client in the same datacenter. The server is idle 99.8% of the time.

---

## 2. Pipelining

Send N commands without waiting for the replies, then read N replies.

```
   UNPIPELINED                          PIPELINED
   ─────────────────────                ──────────────────────────────
   ──► SET k1 v1                        ──► SET k1 v1
   ◄── +OK                                  SET k2 v2
   ──► SET k2 v2                            SET k3 v3
   ◄── +OK                                  … 1,000 commands, one write()
   ──► SET k3 v3                        ◄── +OK +OK +OK … (one read())
   ◄── +OK
                                        1 round trip
   1,000 round trips = 500 ms           ≈ 3 ms
```

It works because [RESP](./04-protocol-resp.md) has no request IDs — **replies come back strictly in the order commands were sent**, so the client matches them positionally. Nothing on the server needs to change; pipelining is purely a client-side technique.

```ts
// ❌ 1,000 round trips ≈ 500 ms
for (let i = 0; i < 1000; i++) await redis.set(`k${i}`, i);

// ✅ 1 round trip ≈ 3 ms
const pipe = redis.pipeline();
for (let i = 0; i < 1000; i++) pipe.set(`k${i}`, i);
const results = await pipe.exec();
// results: [[null, 'OK'], [null, 'OK'], …]  — [error, value] per command
```

### Batch, do not pipeline unboundedly

```ts
async function pipelineInBatches<T>(
  items: T[],
  fn: (pipe: ChainableCommander, item: T) => void,
  batchSize = 1000,
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const pipe = redis.pipeline();
    for (const item of items.slice(i, i + batchSize)) fn(pipe, item);
    const res = await pipe.exec();
    out.push(...(res ?? []));
  }
  return out;
}
```

:::danger[Do not pipeline a million commands at once]
Redis buffers the **entire reply** for the pipeline in the client's output buffer before it can be flushed. A million-command pipeline can allocate gigabytes on the server, and:

```conf
client-output-buffer-limit normal 0 0 0     # unlimited for normal clients (!)
```

Normal clients have **no limit by default**. So a runaway pipeline can OOM the server rather than being disconnected. Your client also buffers the whole request.

**Batch sizes of 100–1,000 capture essentially all of the benefit.** Going from 1,000 to 10,000 buys you a few percent and multiplies your memory risk.
:::

```
   Throughput vs. batch size (illustrative shape, one client)

   ops/sec
     │                    ┌──────────────────────────  diminishing returns
     │                ┌───┘
     │            ┌───┘
     │        ┌───┘
     │    ┌───┘
     │┌───┘
     └────┬────┬────┬────┬─────┬──────────────────────
          1   10  100  1000  10000        batch size
                    ▲
              the sweet spot
```

### Pipelining ≠ transaction

```
   Pipeline:  your commands may INTERLEAVE with other clients' commands.
              Each is still individually atomic; the batch is not.

   MULTI:     nothing interleaves. The batch is atomic.
```

If you only want fewer round trips, use `pipeline()` — it is cheaper than `multi()` because it skips the queueing and the `MULTI`/`EXEC` overhead. Use `multi()` only when you need the isolation.

---

## 3. The four batching tools, compared

```
   1,000 GETs. Four ways:

   ──────────────────────────────────────────────────────────────────────
   A. A LOOP                 1,000 RTT   ≈ 500 ms       ❌
   B. MGET k1 … k1000            1 RTT   ≈ 1 ms         ✅ best for plain reads
   C. pipeline()                 1 RTT   ≈ 3 ms         ✅ best for mixed commands
   D. Lua (a loop inside)        1 RTT   ≈ 2 ms         ✅ when you need LOGIC
   ──────────────────────────────────────────────────────────────────────
```

| Tool | Use when |
| :--- | :--- |
| **`MGET`/`MSET`/`HMGET`** | Homogeneous operations on many keys. Cheapest — one command, one parse. |
| **Pipeline** | Many *different* commands. No isolation needed. |
| **`MULTI`** | You need isolation from other clients. |
| **Lua** | You need to read a value and branch on it, or loop with logic. |

:::warning[In Redis Cluster, multi-key commands need all keys in one slot]
`MGET k1 k2 k3` fails with `CROSSSLOT` if the keys hash to different slots. ioredis's `Cluster` client splits a `pipeline()` across nodes for you, but it cannot split `MGET`.

Fix with hash tags: `{user:1042}:name` and `{user:1042}:email` share a slot. See [Cluster](./22-cluster.md).
:::

---

## 4. Connection-level performance

### Use a pool, and size it deliberately

```ts
import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  connectTimeout: 10_000,
  commandTimeout: 5_000,              // ← fail fast rather than hang
  keepAlive: 30_000,
  connectionName: `api-${process.env.HOSTNAME}`,
  retryStrategy: (times) => Math.min(times * 200, 5_000),
});
```

**ioredis multiplexes a single connection**: concurrent commands from your application are automatically written back-to-back into one socket, which gives you *implicit pipelining* for free under concurrency. That is a genuine advantage over pooled clients and one reason a single ioredis instance handles a lot of load.

You need additional connections for exactly three things:

1. **Blocking commands** (`BRPOP`, `BLMOVE`, `XREADGROUP … BLOCK`) — the connection is occupied.
2. **Subscribers** — subscriber mode restricts the connection.
3. **Watched transactions** — `WATCH` state is per-connection.

```ts
const sub = redis.duplicate();       // for Pub/Sub
const blocking = redis.duplicate();  // for BRPOP workers
```

### Unix sockets, when you are on the same host

```conf
unixsocket /var/run/redis/redis.sock
unixsocketperm 770
```

```ts
const redis = new Redis({ path: '/var/run/redis/redis.sock' });
```

Roughly **25–50% lower latency** than TCP on loopback, because you skip the entire network stack. Free performance if your app and Redis share a machine — though co-locating them has its own trade-offs.

### Turn off Nagle's algorithm

```conf
tcp-nodelay yes         # the default; do not change it
```

Nagle's algorithm batches small TCP writes to reduce packet overhead, adding up to 40 ms of delay. For a request/response protocol with tiny messages, that is catastrophic. Redis disables it by default; make sure your **client** does too (ioredis sets `noDelay: true` by default).

---

## 5. Benchmarking honestly

```bash
# the basics
redis-benchmark -h localhost -p 6379 -n 100000 -c 50

# only the commands you actually use
redis-benchmark -t set,get,lpush,zadd -n 100000 -q

# with pipelining — this is where the big numbers come from
redis-benchmark -t set,get -n 1000000 -P 16 -q

# realistic payload sizes and a realistic keyspace
redis-benchmark -t set,get -n 100000 -d 1024 -r 1000000 -q

# your own command
redis-benchmark -n 100000 ZADD leaderboard __rand_int__ member:__rand_int__

# a Lua script
redis-benchmark -n 100000 EVAL "return redis.call('GET', KEYS[1])" 1 mykey
```

| Flag | Meaning |
| :--- | :--- |
| `-n` | Total requests |
| `-c` | Parallel connections (default 50) |
| `-P` | Pipeline depth |
| `-d` | Payload size in bytes (default 3 — unrealistically small) |
| `-r` | Use this many random keys (default: one key — unrealistically cache-friendly) |
| `-t` | Only these tests |
| `-q` | Quiet: just the summary |
| `--csv` | Machine-readable output |

:::danger[The default benchmark lies to you in three ways]
Running `redis-benchmark` with no flags gives you a beautiful number that means nothing:

1. **`-d 3`** — a 3-byte payload. Your real values are hundreds of bytes to kilobytes, and payload size dominates at high throughput.
2. **No `-r`** — every operation hits the *same key*, which is perfectly cached and never triggers a resize or an eviction. Use `-r 1000000`.
3. **It runs on localhost** — zero network latency, which is the entire thing you were trying to measure.

Benchmark **from an application host**, with **your payload sizes**, against **a realistic keyspace**, using **your access pattern**. Otherwise you are measuring your loopback interface.
:::

### Reading the output

```
$ redis-benchmark -t get -n 100000 -c 50 -d 512 -r 1000000 -q
GET: 87719.30 requests per second, p50=0.271 msec

$ redis-benchmark -t get -n 100000 -c 50 -d 512 -r 1000000 -P 16 -q
GET: 892857.12 requests per second, p50=0.807 msec
```

Note what pipelining did: **10× the throughput**, and per-request latency went *up* (0.27 → 0.81 ms) because each request now waits behind 15 others in its batch. That is the trade — pipelining optimizes throughput, not latency. If you need the lowest possible latency for a single operation, do not pipeline it.

---

## 6. The "Redis is slow" runbook

```
   STEP 1 — Is it Redis at all?
   ────────────────────────────────────────────────────────────
   redis-cli --latency                # from the REDIS host
   redis-cli --latency                # from an APP host
   → both low, app still slow?  IT IS NOT REDIS.
     Look at: your connection pool, GC pauses, DNS, the app's own CPU,
     or an N+1 pattern making 500 sequential calls.

   STEP 2 — Slow commands?
   ────────────────────────────────────────────────────────────
   CONFIG SET slowlog-log-slower-than 10000
   SLOWLOG GET 20
   → KEYS, SMEMBERS, HGETALL, LRANGE 0 -1, a Lua loop?
     Fix: SCAN/HSCAN, pagination, or a different data type.

   STEP 3 — What KIND of latency?
   ────────────────────────────────────────────────────────────
   CONFIG SET latency-monitor-threshold 100
   LATENCY LATEST                     # names the event class
   LATENCY DOCTOR
   → "fork"              persistence. Save on a replica; disable THP.
   → "aof-fsync-always"  appendfsync always, or a slow disk.
   → "expire-cycle"      a mass-expiry storm. Add TTL jitter.
   → "eviction-del"      at maxmemory. Scale up.
   → "command"           back to step 2.

   STEP 4 — Memory pressure?
   ────────────────────────────────────────────────────────────
   INFO memory
   → mem_fragmentation_ratio < 1.0   → SWAPPING. Emergency.
   → used_memory near maxmemory      → eviction churn on every command
   → INFO stats: evicted_keys rising → the instance is too small

   STEP 5 — Connection churn?
   ────────────────────────────────────────────────────────────
   INFO clients          # connected_clients, blocked_clients
   INFO stats            # total_connections_received
   → total_connections_received climbing fast means your app opens a
     NEW connection per request. Each costs a TCP handshake + AUTH.
     Fix your pooling. This is extremely common and easy to miss.

   STEP 6 — Is it one hot key?
   ────────────────────────────────────────────────────────────
   redis-cli --hotkeys            # needs an LFU maxmemory-policy
   redis-cli --bigkeys
   → one key taking all the traffic cannot be sharded by Cluster.
     Fix: replicate reads, add a client-side cache, or split the key.
```

---

## 7. The optimization checklist, in order of payoff

**1. Stop making N sequential calls.** `MGET`, pipelines, and Lua. This is usually a 10–100× win and dwarfs everything below.

**2. Fix connection churn.** One connection per request is a hidden tax of a handshake plus `AUTH` on every operation.

**3. Eliminate O(N) commands from the hot path.** `KEYS`, `SMEMBERS`, `HGETALL` on big collections, `LRANGE 0 -1`.

**4. Right-size values.** Compress large payloads client-side; split multi-megabyte values.

**5. Use the right data type.** A Hash instead of N keys is a memory *and* round-trip win.

**6. Set TTLs.** Less data means better cache locality and fewer evictions.

**7. Read from replicas** for read-heavy workloads (accepting eventual consistency).

**8. Only then**: `io-threads`, Unix sockets, kernel tuning, Cluster.

:::tip[The ordering is the point]
Most "Redis performance" work is really "stop doing 500 round trips" work. Teams reach for Cluster and threaded I/O when the actual fix was one `MGET`. Measure first, and start at the top of this list.
:::

---

## 8. Two worked before/afters

### An N+1 in a feed endpoint

```ts
// ❌ 1 + 3N round trips. 50 posts = 151 calls ≈ 75 ms of pure waiting.
const postIds = await redis.lrange('feed:1042', 0, 49);
const posts = [];
for (const id of postIds) {
  const post = await redis.hgetall(`post:${id}`);
  const author = await redis.hgetall(`user:${post.authorId}`);
  const likes = await redis.scard(`post:${id}:likes`);
  posts.push({ ...post, author, likes: Number(likes) });
}

// ✅ 3 round trips total ≈ 2 ms
const postIds = await redis.lrange('feed:1042', 0, 49);

const postPipe = redis.pipeline();
for (const id of postIds) {
  postPipe.hgetall(`post:${id}`);
  postPipe.scard(`post:${id}:likes`);
}
const postRes = await postPipe.exec();

const posts = postIds.map((id, i) => ({
  ...(postRes![i * 2][1] as Record<string, string>),
  likes: postRes![i * 2 + 1][1] as number,
}));

const authorIds = [...new Set(posts.map((p) => p.authorId))];
const authorPipe = redis.pipeline();
for (const aid of authorIds) authorPipe.hgetall(`user:${aid}`);
const authors = new Map(
  (await authorPipe.exec())!.map((r, i) => [authorIds[i], r[1] as Record<string, string>]),
);

const result = posts.map((p) => ({ ...p, author: authors.get(p.authorId) }));
```

**151 calls → 3.** Note also the de-duplication of author IDs: in a feed, the same author appears many times, so a `Set` cuts the second batch dramatically.

### A read-modify-write becoming one script

```ts
// ❌ 3 round trips, plus a race between the read and the write
const raw = await redis.get(key);
const doc = JSON.parse(raw ?? '{}');
doc.views = (doc.views ?? 0) + 1;
await redis.set(key, JSON.stringify(doc));

// ✅ 1 round trip, atomic, no race
const BUMP = `
  local raw = redis.call('GET', KEYS[1])
  local doc = raw and cjson.decode(raw) or {}
  doc.views = (doc.views or 0) + 1
  redis.call('SET', KEYS[1], cjson.encode(doc), 'KEEPTTL')
  return doc.views
`;
redis.defineCommand('bumpViews', { numberOfKeys: 1, lua: BUMP });
const views = await redis.bumpViews(key);
```

Three trips to one, **and** the lost-update race disappears. This is the general shape: moving logic to the server usually improves correctness and latency at the same time.

---

## Rapid-fire recall

1. Why does an unpipelined client top out at ~2,000 ops/sec in a datacenter?
2. What property of RESP makes pipelining possible with no server support?
3. What is the difference between a pipeline and a `MULTI`?
4. What batch size should you pipeline in, and what happens if you send a million?
5. When is `MGET` better than a pipeline of `GET`s?
6. Why does pipelining increase per-request latency while increasing throughput?
7. Name the three ways `redis-benchmark` defaults mislead you.
8. `total_connections_received` is climbing rapidly. What does that tell you?
9. Both `--latency` runs are fast but the app is slow. Where do you look?
10. What is the first thing to fix when "Redis is slow", and why is it first?

<details>
<summary>Answers</summary>

1. Throughput per connection is `1/RTT`. At 0.5 ms round trip that is 2,000 ops/sec, no matter how fast the server is — the server is idle 99.8% of the time.
2. Replies are returned strictly in the order commands were received, so a client can write N commands and match N replies positionally. No request IDs needed.
3. A pipeline is a network optimization — commands may interleave with other clients'. `MULTI` is an isolation guarantee — nothing interleaves.
4. 100–1,000. A million-command pipeline buffers the entire reply in the server's output buffer, and normal clients have **no** output-buffer limit by default, so it can OOM the server.
5. For homogeneous reads of many keys — one command, one parse, no per-command overhead. A pipeline is for *different* commands.
6. Each request now waits for the whole batch to be written and processed, so individual latency rises while total operations per second rises much more.
7. `-d 3` (a 3-byte payload), no `-r` (every op hits the same key, perfectly cached), and running on localhost (zero network latency — the thing you meant to measure).
8. Your application is opening a new connection per request instead of pooling. Each one costs a TCP handshake plus `AUTH`.
9. Not at Redis. Look at your connection pool, GC pauses, DNS, the app's own CPU, and especially N+1 patterns making hundreds of sequential calls.
10. Stop making N sequential calls — `MGET`, pipelines, Lua. It is typically a 10–100× win, and most "Redis performance problems" are really round-trip problems that Cluster and threaded I/O would not fix.

</details>

---

**Next:** [Clients & Connection Management](./19-clients-and-connection-management.md) — pooling, retries, timeouts, and the failure modes that only appear in production.
