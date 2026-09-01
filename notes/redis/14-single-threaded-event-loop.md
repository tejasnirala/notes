---
title: "Internals: The Single-Threaded Event Loop"
author: Tejas Nirala
---

# Internals: The Single-Threaded Event Loop

> **What you will be able to do after this page**
>
> - Explain `ae`, `epoll`, and one iteration of the event loop in order.
> - Answer "is Redis really single-threaded?" precisely — the answer is *no, but*.
> - Name every background thread and what it exists to avoid.
> - Diagnose a latency spike by knowing which of the six causes it can possibly be.

"Redis is single-threaded" is the most-repeated fact about Redis and the most commonly misunderstood. This page makes it exact.

---

## 1. What is actually single-threaded

**Command execution.** One command runs at a time, start to finish, with nothing interleaved. That is the invariant, and it is the source of Redis's atomicity guarantees.

**Not single-threaded:** network I/O (optionally), background deletion, persistence (a forked child), and several housekeeping threads. Redis has been a multi-threaded *process* since 4.0. It has always been a single-threaded *executor*.

```
   redis-server process
   ┌─────────────────────────────────────────────────────────────────────┐
   │                                                                     │
   │  MAIN THREAD                                                        │
   │  ┌───────────────────────────────────────────────────────────────┐  │
   │  │  the event loop (ae)                                          │  │
   │  │    • accept connections                                       │  │
   │  │    • read + parse requests                                    │  │
   │  │    • ►► EXECUTE COMMANDS ◄◄  ← THE serialized part            │  │
   │  │    • write replies                                            │  │
   │  │    • serverCron (100×/sec): expiry, rehashing, stats          │  │
   │  └───────────────────────────────────────────────────────────────┘  │
   │                                                                     │
   │  BIO THREADS (background I/O, since 2.4/4.0)                        │
   │  ┌─────────────────┬──────────────────┬────────────────────────┐    │
   │  │ BIO_CLOSE_FILE  │ BIO_AOF_FSYNC    │ BIO_LAZY_FREE          │    │
   │  │ close() old AOF │ fsync() the AOF  │ free() big objects     │    │
   │  │ without blocking│ without blocking │ (UNLINK, FLUSHALL ASYNC)│   │
   │  └─────────────────┴──────────────────┴────────────────────────┘    │
   │                                                                     │
   │  I/O THREADS (optional, since 6.0)                                  │
   │  ┌───────────────────────────────────────────────────────────────┐  │
   │  │ io-threads N — parallelize socket read()/write() and PARSING   │  │
   │  │ Execution still happens on the main thread, one at a time.     │  │
   │  └───────────────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────────────┘

   FORKED CHILD PROCESS (during BGSAVE / BGREWRITEAOF)
   ┌─────────────────────────────────────────────────────────────────────┐
   │  a full copy-on-write snapshot of memory, written to disk           │
   └─────────────────────────────────────────────────────────────────────┘
```

---

## 2. `ae` — the event loop

Redis ships its own ~1,000-line event library, `ae.c` (A simple Event driven programming library), which wraps the best mechanism each platform offers:

| Platform | Backend |
| :--- | :--- |
| Linux | `epoll` |
| macOS / BSD | `kqueue` |
| Solaris | `evport` |
| fallback | `select` |

It handles two kinds of event:

- **File events** — a socket became readable or writable.
- **Time events** — `serverCron`, which runs `hz` times per second (default 10, effectively 100 with dynamic-hz).

### The classic problem it solves

How do you serve 10,000 concurrent connections with one thread?

```
   ❌ THREAD PER CONNECTION
      10,000 threads × 8 MB stack = 80 GB of virtual memory
      the scheduler thrashes; context switches dominate the CPU

   ❌ BLOCKING LOOP OVER SOCKETS
      read(fd1) blocks with no data → the other 9,999 clients wait

   ✅ I/O MULTIPLEXING
      epoll_wait() → "these 12 of the 10,000 sockets have data right now"
      Handle exactly those 12. Sleep again.
      One thread. Cost proportional to ACTIVE connections, not total.
```

`epoll` is O(1) in the number of watched descriptors (the kernel maintains a ready list) as opposed to `select`'s O(N) scan — which is why 10,000 mostly-idle connections cost almost nothing.

---

## 3. One iteration, in order

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │  beforeSleep()                                                       │
   │    • process clients unblocked by the last iteration (BLPOP wakeups)  │
   │    • flush the AOF buffer to the OS (write(), per appendfsync policy) │
   │    • send pending replies (handleClientsWithPendingWrites)            │
   │    • process the tracking-invalidation table (RESP3 client caching)   │
   │    • fast expire cycle (ACTIVE_EXPIRE_CYCLE_FAST, ~1 ms budget)       │
   └────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │  aeApiPoll()  —  epoll_wait(timeout = time until the next time event) │
   │    THE ONLY PLACE THE PROCESS SLEEPS.                                 │
   │    Returns the set of ready file descriptors.                         │
   └────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │  FILE EVENTS                                                          │
   │    readable on the listening socket → acceptTcpHandler(): new client   │
   │    readable on a client socket      → readQueryFromClient():           │
   │         read() → append to the query buffer → processInputBuffer()     │
   │           → parse RESP → build argv/argc                               │
   │           → processCommand():                                          │
   │                lookupCommand · arity · AUTH · ACL · OOM · readonly     │
   │                → ►► call(cmd) ◄◄   THE ATOMIC EXECUTION                │
   │                → propagate to AOF buffer + replica buffers             │
   │                → addReply() into the client's output buffer            │
   │    writable on a client socket      → sendReplyToClient(): write()      │
   └────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │  TIME EVENTS  —  serverCron(), every 1000/hz ms                       │
   │    • activeExpireCycle()      sample & delete expired keys            │
   │    • incremental rehashing of the keyspace dicts                      │
   │    • evict keys if maxmemory is exceeded                              │
   │    • clientsCron(): close idle/timed-out clients, resize query buffers│
   │    • replicationCron(): pings, reconnects, replica timeouts           │
   │    • check whether a BGSAVE/AOF-rewrite child has finished            │
   │    • update stats: ops/sec, memory peak, LRU clock                    │
   └────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    └───────► back to beforeSleep()
```

**The whole server is that loop.** Follow it once and Redis stops being mysterious.

### Where atomicity comes from

`call(cmd)` runs to completion before the loop moves on. There is no preemption, no yield point, no interleaving.

```
   Client A: INCR counter        ─┐
   Client B: INCR counter        ─┤ arrive in the same millisecond
   Client C: GET counter         ─┘

   The loop processes them ONE AT A TIME, in arrival order:
      call(INCR) → 1  ... complete ...
      call(INCR) → 2  ... complete ...
      call(GET)  → 2

   There is no moment where two commands are half-executed.
   That is why INCR has no lost-update race and why MULTI/EXEC and Lua
   are atomic without any locking machinery.
```

This is the answer to "how does Redis achieve atomicity?" — **it does not achieve it, it inherits it from having one executor.**

---

## 4. Threaded I/O (Redis 6.0+)

Profiling showed that at high throughput, Redis spends **most of its CPU in `read()`, `write()`, and RESP parsing** — not in executing commands. So 6.0 parallelized exactly that.

```conf
io-threads 4                 # 1 = disabled (default). Try (cores/2)–(cores−1).
io-threads-do-reads yes      # also parallelize reading+parsing, not just writes
```

```
   WITHOUT io-threads                    WITH io-threads 4
   ─────────────────────────────         ──────────────────────────────────
   main: read c1 parse exec reply        io1: read+parse c1  ┐
   main: read c2 parse exec reply        io2: read+parse c2  ├ IN PARALLEL
   main: read c3 parse exec reply        io3: read+parse c3  ┘
   main: read c4 parse exec reply        main: exec c1, c2, c3, c4  ← still serial
                                         io1..3: write replies in parallel
```

**Execution remains strictly serial.** The I/O threads only move bytes and parse them; they never touch the keyspace. Every atomicity guarantee is preserved.

:::warning[When threaded I/O helps, and when it does not]
It helps when the bottleneck is **network syscalls**: very high throughput, large values, many connections. Reported gains are up to ~2× on write-heavy workloads with big payloads.

It does **not** help when the bottleneck is command execution (`SORT`, `ZUNIONSTORE`, Lua) or memory bandwidth. And it costs CPU — the threads spin-wait for work by design.

Do not enable it speculatively. Benchmark with `redis-benchmark` on your actual workload and payload sizes. The official guidance is to leave it off unless you have measured a problem, and never to set `io-threads` above the number of physical cores.
:::

---

## 5. The background threads

```
   BIO_CLOSE_FILE   close() an old AOF file. On a large file this can take
                    hundreds of ms because the kernel flushes buffers.

   BIO_AOF_FSYNC    fsync() the AOF. This is a DISK operation — tens of ms
                    on a busy device. Doing it on the main thread with
                    appendfsync everysec would stall the server every second.

   BIO_LAZY_FREE    free() large objects. UNLINK, FLUSHALL ASYNC, and
                    implicit lazy-free hand the object here.
```

That third one deserves its own section, because it is directly actionable:

```conf
lazyfree-lazy-eviction    yes   # freeing evicted keys → background
lazyfree-lazy-expire      yes   # freeing expired keys → background
lazyfree-lazy-server-del  yes   # implicit deletes (e.g. overwriting a big key)
lazyfree-lazy-user-del    yes   # make plain DEL behave like UNLINK
lazyfree-lazy-user-flush  yes   # FLUSHALL/FLUSHDB run async
replica-lazy-flush        yes   # a replica's full-sync flush → background
```

:::tip[Turn all six of these on]
Without them, deleting a key holding 10 million elements calls `free()` 10 million times **on the main thread** — a multi-second stall for every client. With them, the object is detached from the keyspace in O(1) and freed by `BIO_LAZY_FREE`.

There is no meaningful downside: Redis still frees small objects synchronously (a background handoff would cost more than the free). These are among the highest-value configuration changes you can make, and they are still off by default for historical compatibility.
:::

---

## 6. The consequence: one slow command stops everything

The flip side of the design. **There is one queue, and no preemption.**

```
   t=0.000  client A: SMEMBERS huge-set     (5,000,000 members)
   t=0.001  client B: GET foo               ← queued, not "slow", STOPPED
   t=0.002  client C: SET bar 1             ← queued
   t=0.003  … 2,000 more requests           ← queued
   t=2.400  SMEMBERS finishes
   t=2.401  everyone else runs

   Your p99 for that second: 2,400 ms. Your dashboards say "Redis is fine"
   because average CPU looks normal and no command errored.
```

### The commands that can do this

```
   O(N) over the keyspace       KEYS *  ·  FLUSHALL  ·  FLUSHDB  ·  DBSIZE on
                                 some forks  ·  RANDOMKEY in pathological cases
   O(N) over a collection       SMEMBERS  ·  LRANGE 0 -1  ·  HGETALL  ·
                                 ZRANGE 0 -1  ·  SORT  ·  SUNION/SINTER on
                                 large sets  ·  ZUNIONSTORE
   O(N) deletion                DEL on a huge collection (use UNLINK)
   Unbounded user code          a Lua script with a long loop
   Huge values                  GET on a 200 MB string (the copy alone)
   Fan-out                      PUBLISH to 10,000 subscribers with a big payload
```

### Finding them

```bash
CONFIG SET slowlog-log-slower-than 10000    # log anything over 10 ms (µs units)
CONFIG SET slowlog-max-len 256
SLOWLOG GET 10
SLOWLOG RESET
SLOWLOG LEN
```

```bash
127.0.0.1:6379> SLOWLOG GET 1
1) 1) (integer) 14                     ← entry id
   2) (integer) 1756742400             ← unix timestamp
   3) (integer) 2400193                ← MICROSECONDS: 2.4 seconds
   4) 1) "SMEMBERS"  2) "huge-set"     ← the offending command
   5) "10.0.1.42:51234"                ← the client
   6) "worker-7"                       ← the client name (set CLIENT SETNAME!)
```

:::tip[Set `CLIENT SETNAME` on every connection]
```ts
const redis = new Redis(url, { connectionName: `api-${process.env.HOSTNAME}` });
```
When the slowlog names `worker-7` instead of an ephemeral port, you know which service to fix in seconds rather than hours. It costs nothing.
:::

```bash
# is the server itself stalling, or is it the network?
redis-cli --latency              # continuous min/avg/max sampling
redis-cli --latency-history      # 15-second buckets over time
redis-cli --latency-dist         # a latency distribution spectrum

# the built-in latency monitor records WHY, not just how long
CONFIG SET latency-monitor-threshold 100     # ms
LATENCY LATEST                   # → event, timestamp, last, max
LATENCY HISTORY command
LATENCY RESET
LATENCY DOCTOR                   # a plain-English analysis
```

`LATENCY LATEST` names the *event class* — `command`, `fork`, `expire-cycle`, `aof-fsync-always`, `eviction-del` — which tells you which of the six causes you actually have. It is far more useful than a raw latency number.

---

## 7. The six causes of a Redis latency spike

```
   1. A SLOW COMMAND                → SLOWLOG GET. Fix: SCAN, HSCAN, pagination.
   2. fork() for BGSAVE / AOF       → LATENCY LATEST shows "fork".
      rewrite                          Fix: less frequent saves, disable THP,
                                       smaller instances, save on a replica.
   3. SWAP                          → mem_fragmentation_ratio < 1.
                                       Fix: lower maxmemory, vm.swappiness=0.
   4. AOF fsync                     → appendfsync always, or a slow disk.
                                       LATENCY shows "aof-fsync-always".
                                       Fix: everysec, faster disk.
   5. EXPIRY / EVICTION storms      → many keys expiring at once, or maxmemory
                                       churn. INFO: expired_keys, evicted_keys.
                                       Fix: TTL jitter, more memory.
   6. THE NETWORK / THE CLIENT      → redis-cli --latency from the SAME host
                                       shows low numbers while your app sees
                                       high ones. Fix: it's not Redis. Look at
                                       your connection pool, GC pauses, DNS.
```

**Cause 6 is the most common and the least diagnosed.** Always run `redis-cli --latency` from the Redis host *and* from an app host. If the numbers differ wildly, the problem is between them — or inside your application process — and no amount of Redis tuning will help.

---

## 8. Is single-threaded actually a limitation?

For most workloads, no — because **Redis is rarely CPU-bound.**

```
   The bottleneck ladder, in the order you hit it:
   1. NETWORK bandwidth / round trips  ← almost always first
   2. MEMORY capacity
   3. CPU (a single core)              ← rarely reached
```

A single core handles ~100,000 ops/sec easily, and over 1,000,000 with [pipelining](./18-pipelining-and-performance.md). Most applications never approach that.

When you genuinely need more CPU:

```
   ┌─ Vertical:  a faster core beats more cores. Redis benefits from
   │             high single-thread performance, not core count.
   │
   ├─ io-threads: if the bottleneck is network syscalls (measure first).
   │
   ├─ MULTIPLE INSTANCES on one box: run 4 redis-servers on ports
   │             6379–6382, pinned to different cores. Simple, effective,
   │             and how many large deployments actually do it.
   │
   └─ REDIS CLUSTER: shard the keyspace across nodes. Each node is still
                 single-threaded; you get N cores by having N nodes.
                 See ./22-cluster.md
```

And what you get in exchange for the constraint is worth restating:

| Because there is one executor | You get |
| :--- | :--- |
| No interleaving | Every command is atomic, free |
| No locks or mutexes | No contention, no deadlocks, no lock-convoy latency |
| No context switching in the hot path | Predictable, low-variance latency |
| One timeline | `MULTI`/`EXEC` and Lua are trivially correct |
| Simple code | Fewer bugs; the whole thing is auditable |

A multi-threaded Redis would need locking around every keyspace access, and the cost of that locking would likely exceed the gain — which is precisely the argument antirez made when he declined to multi-thread execution, and it has held up.

---

## Rapid-fire recall

1. What exactly is single-threaded in Redis, and what is not?
2. Name the four steps of one event-loop iteration, in order.
3. Where in the loop does the process actually sleep?
4. What do the I/O threads do and, crucially, what do they *not* do?
5. Name the three BIO threads and what each avoids blocking on.
6. Which six `lazyfree-*` settings should you turn on, and why are they off by default?
7. A `SMEMBERS` on a 5-million-member set takes 2.4 seconds. What is the effect on other clients?
8. Which command tells you *which class* of thing caused a latency spike?
9. Give the six causes of latency spikes, and say which is most commonly misattributed.
10. When Redis is genuinely CPU-bound, what are your four options?

<details>
<summary>Answers</summary>

1. **Command execution** is single-threaded — one command runs to completion at a time. Network I/O (optionally), background frees, AOF fsync, file closing, and persistence (a forked child) all happen off the main thread.
2. `beforeSleep()` (flush AOF, send pending replies, handle unblocked clients, fast expire) → `aeApiPoll()`/`epoll_wait` → file events (accept, read+parse+**execute**, write) → time events (`serverCron`: expiry, rehashing, eviction, replication cron).
3. In `aeApiPoll()` — the `epoll_wait` call is the only blocking point, and its timeout is the time until the next scheduled time event.
4. They parallelize socket `read()`/`write()` and RESP parsing. They **never execute commands or touch the keyspace**, so serialized execution and atomicity are preserved.
5. `BIO_CLOSE_FILE` (closing a large AOF, which flushes kernel buffers), `BIO_AOF_FSYNC` (the `fsync` disk operation), `BIO_LAZY_FREE` (freeing large objects).
6. `lazyfree-lazy-eviction`, `-expire`, `-server-del`, `-user-del`, `-user-flush`, and `replica-lazy-flush`. They are off by default only for historical compatibility; turning them on prevents multi-second stalls when a huge object is freed.
7. Every other client is **stopped**, not slowed — there is one queue and no preemption. The p99 for that second is 2,400 ms.
8. `LATENCY LATEST` — it reports the event class (`command`, `fork`, `expire-cycle`, `aof-fsync-always`, `eviction-del`), which points at the actual cause.
9. Slow commands; `fork()` for persistence; swap; AOF fsync; expiry/eviction storms; the network or the client itself. The last is the most commonly blamed on Redis when it is not Redis — compare `redis-cli --latency` from the Redis host against an app host.
10. A faster single core; `io-threads` if network syscalls are the bottleneck; multiple instances pinned to different cores on one box; Redis Cluster.

</details>

---

**Next:** [Expiration & Eviction](./15-expiration-and-eviction.md) — how keys disappear, on purpose and under pressure.
