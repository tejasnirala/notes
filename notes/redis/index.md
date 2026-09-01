---
title: Redis
---

# Redis

A complete path from *what is an in-memory data structure server* to *why did my distributed lock get evicted* — written so that someone who has never heard of Redis can read it end to end and come out able to design, operate, and debug it in production.

Every page traces the **mechanism**, not just the syntax: what happens in memory when you run `SET`, how a skip list answers a rank query in 25 hops, why one slow command stops every client. Every page ends with **rapid-fire recall** questions and collapsible answers.

**Application code is TypeScript with [ioredis](https://github.com/redis/ioredis)**, chosen because its method names map 1:1 onto the commands you learn in `redis-cli` — no translation step. Commands are always shown first in the CLI with their exact replies, because that is where the internals are visible.

---

## 📚 The curriculum

### Foundations — the mental model

| | Page | What it answers |
| :-- | :--- | :--- |
| 1 | **[What Is Redis?](./01-what-is-redis.md)** | The three load-bearing words, where it sits in an architecture, the full reason it is fast, and when *not* to use it |
| 2 | **[Installation & First Commands](./02-installation-and-first-commands.md)** | Get a server running; trace `SET` from keystroke to RAM and back, all nine steps |
| 3 | **[Keys & The Keyspace](./03-keys-and-the-keyspace.md)** | Naming that survives six months, every TTL command, why `KEYS *` will page you, and how `SCAN`'s cursor really works |
| 4 | **[RESP — The Wire Protocol](./04-protocol-resp.md)** | What actually travels over the socket, why it parses so fast, and what RESP3 unlocked |

### The data types — each with internals and traces

| | Page | What it answers |
| :-- | :--- | :--- |
| 5 | **[Strings](./05-strings.md)** | Every `SET` flag, atomic counters, SDS, and the three encodings — including why the threshold is exactly 44 bytes |
| 6 | **[Lists](./06-lists.md)** | Queues and stacks, blocking commands that delete polling from your architecture, quicklist and listpack |
| 7 | **[Hashes](./07-hashes.md)** | The type that cuts your memory bill 5–10×, hash-field TTLs, and why one big field poisons a whole hash |
| 8 | **[Sets](./08-sets.md)** | O(1) membership, server-side set algebra, and why `intset` makes numeric IDs so much cheaper |
| 9 | **[Sorted Sets](./09-sorted-sets.md)** | The most powerful type — leaderboards, sliding windows, autocomplete — and the skip list, drawn |
| 10 | **[Bitmaps, HyperLogLog & Geo](./10-bitmaps-hyperloglog-geo.md)** | 10 M users in 1.25 MB, a billion uniques in 12 KB, and radius queries as sorted-set ranges |
| 11 | **[Streams](./11-streams.md)** | Consumer groups, the Pending Entries List, `XAUTOCLAIM`, and an honest Kafka comparison |
| 12 | **[Pub/Sub](./12-pubsub.md)** | Real-time fan-out in ten lines — and the four guarantees it does not give you |

### Internals — how it actually works

| | Page | What it answers |
| :-- | :--- | :--- |
| 13 | **[Memory & Encodings](./13-internals-memory-and-encodings.md)** | `redisObject`, the dict, incremental rehashing, fragmentation, and where every byte goes |
| 14 | **[The Single-Threaded Event Loop](./14-single-threaded-event-loop.md)** | `ae` and `epoll`, one loop iteration in order, the I/O and BIO threads, and the six causes of a latency spike |
| 15 | **[Expiration & Eviction](./15-expiration-and-eviction.md)** | The probabilistic expiry sweep, all eight policies, approximated LRU, and LFU's 8-bit counter |
| 16 | **[Persistence](./16-persistence.md)** | RDB, AOF, `fork()` and copy-on-write, and exactly how many seconds you can lose |

### Using it well

| | Page | What it answers |
| :-- | :--- | :--- |
| 17 | **[Transactions & Scripting](./17-transactions-and-scripting.md)** | Why there is no rollback, `WATCH` and its connection-pool hazard, Lua's four rules, Functions |
| 18 | **[Pipelining & Performance](./18-pipelining-and-performance.md)** | Why 1,000 commands take 500 ms and pipelined take 3 ms; honest benchmarking |
| 19 | **[Clients & Connection Management](./19-clients-and-connection-management.md)** | The ioredis config that survives a failover, and every failure mode with its fix |

### Scaling & production

| | Page | What it answers |
| :-- | :--- | :--- |
| 20 | **[Replication](./20-replication.md)** | Full sync and partial resync traced, the backlog, and why replication is not durability |
| 21 | **[Sentinel & Failover](./21-sentinel-and-failover.md)** | SDOWN vs ODOWN, quorum vs majority, and a failover second by second |
| 22 | **[Redis Cluster](./22-cluster.md)** | 16,384 slots and why that number, `MOVED` vs `ASK`, `CROSSSLOT`, and whether you need it at all |
| 23 | **[Security](./23-security.md)** | The attack chain that owns your host, ACLs done properly, TLS, and Lua injection |
| 24 | **[Observability & Operations](./24-observability-and-ops.md)** | The twenty `INFO` fields that matter, the alert set, and three runbooks |

### Patterns

| | Page | What it answers |
| :-- | :--- | :--- |
| 25 | **[Caching Patterns](./25-caching-patterns.md)** | Cache-aside done right, and penetration / avalanche / stampede with fixes |
| 26 | **[Distributed Locks](./26-distributed-locks.md)** | The correct lock, the Redlock debate, and the failure mode no lock service prevents |
| 27 | **[Rate Limiting](./27-rate-limiting.md)** | Four algorithms traced, with memory and precision trade-offs made explicit |
| 28 | **[Queues & Background Jobs](./28-queues-and-jobs.md)** | Lists vs Streams vs BullMQ, and why every queue is at-least-once |
| 29 | **[Anti-Patterns & Playbook](./29-antipatterns-and-production-playbook.md)** | Twenty mistakes, the pre-production checklist, and the 3 a.m. runbooks |
| 30 | **[Redis in an Express App](./30-redis-with-express.md)** | All of it wired into a real TypeScript service — middleware, sessions, workers, shutdown |

### Interview prep

| | Page | |
| :-- | :--- | :--- |
| 31 | **[Interview Q&A](./31-interview-qa.md)** | 45 questions with answers written the way you would say them out loud |

---

## 🎯 Suggested paths

**"I have never heard of Redis."**
→ Straight through 1 → 4, then the data types 5 → 9 (skip 10 for now). Stop and actually run the commands in `redis-cli`. Then 25 (caching) to see why any of it matters, then come back for the internals.

**"I've used Redis via `SET`/`GET` and want to actually understand it."**
→ [Keys & The Keyspace](./03-keys-and-the-keyspace.md) → [Hashes](./07-hashes.md) → [Sorted Sets](./09-sorted-sets.md) → [Memory & Encodings](./13-internals-memory-and-encodings.md) → [Expiration & Eviction](./15-expiration-and-eviction.md) → [Caching Patterns](./25-caching-patterns.md).
Hashes and sorted sets are where most of the value you are not using lives.

**"I have an interview next week."**
→ [Interview Q&A](./31-interview-qa.md) first to find your gaps, then fill them from [Sorted Sets](./09-sorted-sets.md), [Memory & Encodings](./13-internals-memory-and-encodings.md), [The Event Loop](./14-single-threaded-event-loop.md), [Persistence](./16-persistence.md), [Replication](./20-replication.md), and [Distributed Locks](./26-distributed-locks.md).
Internals and honest trade-offs are what separate a good answer from a memorized one.

**"I'm shipping this to production on Monday."**
→ [Anti-Patterns & Playbook](./29-antipatterns-and-production-playbook.md) → [Clients](./19-clients-and-connection-management.md) → [Security](./23-security.md) → [Observability](./24-observability-and-ops.md) → [Redis with Express](./30-redis-with-express.md).
Run the pre-production checklist on page 29 before you deploy.

**"I'm the person who gets paged."**
→ [The Event Loop](./14-single-threaded-event-loop.md) → [Expiration & Eviction](./15-expiration-and-eviction.md) → [Persistence](./16-persistence.md) → [Replication](./20-replication.md) → [Observability](./24-observability-and-ops.md) → the runbooks on [page 29](./29-antipatterns-and-production-playbook.md).

**"I need to build X."**
→ A cache: [25](./25-caching-patterns.md). A queue: [28](./28-queues-and-jobs.md). A leaderboard: [9](./09-sorted-sets.md). A rate limiter: [27](./27-rate-limiting.md). A lock: [26](./26-distributed-locks.md). Real-time fan-out: [12](./12-pubsub.md). Sessions: [7](./07-hashes.md) + [30](./30-redis-with-express.md).

---

## The twelve sentences this whole section is built around

1. **Redis is an in-memory data structure server** — the value is a real structure the server understands, and every operation on it is atomic.
2. **Atomicity is free**, because there is one thread and no interleaving.
3. **The network is your bottleneck, not Redis** — so `MGET`, pipelines, and Lua are where the wins are.
4. **One slow command blocks every client.** `KEYS *` is not slow; it is a stop.
5. **`SET` clears the TTL.** Use `KEEPTTL` or re-specify `EX`.
6. **Encoding conversions are one-way.** A collection's memory reflects its lifetime high-water mark.
7. **Expiry is time; eviction is memory pressure.** `expired_keys` versus `evicted_keys`.
8. **Replication is for availability, not durability.** It is asynchronous; Redis is AP.
9. **Every collection needs a bound** — a TTL, an `LTRIM`, a `ZREMRANGEBY*`, or `MAXLEN ~`.
10. **Cache and durable state belong on separate instances**, because eviction is silent correctness loss.
11. **Every Redis queue is at-least-once**, so every handler must be idempotent.
12. **A cache must fail open.** It is an optimization, never a dependency.
