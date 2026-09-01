---
title: Anti-Patterns & The Production Playbook
author: Tejas Nirala
---

# Anti-Patterns & The Production Playbook

> **What this page is**
>
> Every mistake from the previous 28 pages, collected in one place, with the fix beside it — plus the checklists you run before shipping and the runbooks you run at 3 a.m. This is the page to bookmark.

---

## 1. The twenty anti-patterns

### 🔴 Critical — these cause outages or data loss

**1. `KEYS *` in production**

```bash
KEYS user:*                                    # ❌ O(N), blocks EVERY client
redis-cli --scan --pattern 'user:*'            # ✅
```
One command freezes the whole server for seconds. Deny it: `ACL SETUSER app … -keys`.

**2. No `maxmemory`**

```conf
maxmemory 0        # ❌ the default: allocate until the OOM killer intervenes
maxmemory 6gb      # ✅ ~60% of RAM with persistence, ~80% for a pure cache
```

**3. Locks or queues on an eviction-enabled instance**

```
   maxmemory-policy allkeys-lru + a lock key
   → memory pressure evicts the lock
   → two workers hold it
   → silent data corruption, no error, no log
```
Cache and durable state belong on **separate instances**. `allkeys-lru` for one, `noeviction` for the other.

**4. Losing the TTL on every write**

```ts
await redis.set(key, value);                   // ❌ the TTL is gone; the key is immortal
await redis.set(key, value, 'KEEPTTL');        // ✅
await redis.set(key, value, 'EX', 3600);       // ✅
```
Your session store leaks until it OOMs, six months later.

**5. Transparent Huge Pages enabled**

```bash
echo never > /sys/kernel/mm/transparent_hugepage/enabled     # ✅
```
2 MB copy-on-write pages instead of 4 KB — 512× the memory traffic during a save, and multi-second latency spikes nobody attributes correctly.

**6. Treating Redis as a durable primary store**

`appendfsync everysec` loses up to a second (two on a slow disk). Replication is asynchronous, so replicas do not close that window. Money, orders, and accounts belong in a database with real durability.

**7. `new Redis()` inside a request handler**

```ts
app.get('/x', async (req, res) => { const r = new Redis(url); … });   // ❌
import { redis } from './redis';                                      // ✅
```
A connection per request, never closed. `total_connections_received` climbing is the tell.

**8. No `commandTimeout`**

An unreachable Redis makes every command hang forever. Request handlers never return; your service falls over because a *dependency* is slow.

### 🟠 Serious — these cause incidents

**9. Unbounded collections**

```ts
await redis.lpush(`feed:${id}`, item);                                  // ❌ grows forever
await redis.multi().lpush(`feed:${id}`, item).ltrim(`feed:${id}`, 0, 999).exec();  // ✅
await redis.xadd(stream, 'MAXLEN', '~', 100_000, '*', …);               // ✅
```
Every list, zset, and stream needs a trim or a TTL. Unbounded growth is a top-three cause of dead instances.

**10. `DEL` on huge collections**

```ts
await redis.del(hugeKey);      // ❌ frees N elements on the main thread
await redis.unlink(hugeKey);   // ✅ background free
```
Make `UNLINK` your default, and turn on all six `lazyfree-*` settings.

**11. Fetching whole collections**

```ts
await redis.smembers(bigSet);           // ❌ O(N), a huge reply, blocks
await redis.hgetall(bigHash);           // ❌
await redis.lrange(bigList, 0, -1);     // ❌
await redis.sismember(bigSet, member);  // ✅ O(1)
await redis.hmget(bigHash, 'a', 'b');   // ✅
// iterating? use SSCAN / HSCAN / ZSCAN
```

**12. N sequential round trips**

```ts
for (const id of ids) await redis.get(`user:${id}`);       // ❌ 100 × 0.5 ms
await redis.mget(ids.map((i) => `user:${i}`));             // ✅ 1 × 0.5 ms
```
The single highest-payoff fix in Redis performance work, and the most common problem.

**13. No TTL jitter**

```ts
'EX', 3600                                  // ❌ 10,000 keys expire in one second
'EX', 3600 + Math.random() * 360            // ✅
```

**14. `repl-backlog-size 1mb`**

The default. A one-second network blip on a busy primary triggers a **full resync**. Set 64–256 MB.

**15. Making a cache read fail the request**

```ts
const cached = await redis.get(key);   // ❌ throws → 500
try { … } catch { /* fall through to the database */ }   // ✅ fail open
```
A cache is an optimization. A Redis outage must degrade you, never break you.

**16. Big values**

```ts
await redis.set(key, hugeJson);         // ❌ a 50 MB value blocks on every read
```
Compress, split, or use a Hash/Stream so you can read a slice. `redis-cli --memkeys` finds them.

### 🟡 Design mistakes — these cost money and flexibility

**17. Separate keys instead of a Hash**

```ts
await redis.mset(`user:${id}:name`, n, `user:${id}:age`, a);   // ❌ ~64 B each
await redis.hset(`user:${id}`, { name: n, age: a });           // ✅ 5–10× less
```

**18. `MONITOR` as a monitoring tool**

It streams every command through the output path and can itself cause an incident. Use `SLOWLOG`, `--hotkeys`, and client-side metrics.

**19. Numbered databases**

`SELECT 1` shares one thread, one memory cap, one eviction pool, and one persistence file — and Cluster only supports db 0. Use key prefixes.

**20. No hash tags, then needing Cluster**

```
   user:1042:profile   +   user:1042:sessions      → different slots
   {user:1042}:profile +   {user:1042}:sessions    → same slot
```
Adding braces later is a full keyspace migration. Adding them now is free.

---

## 2. The pre-production checklist

```
   CONFIGURATION
   □ maxmemory set to ~60% of RAM (80% for a pure cache)
   □ maxmemory-policy chosen deliberately, and correct for this instance's ROLE
   □ appendonly + appendfsync matching your stated loss tolerance
   □ save rules set (RDB, for backups) — or "" if genuinely a pure cache
   □ repl-backlog-size ≥ 64mb
   □ all six lazyfree-* settings = yes
   □ client-output-buffer-limit replica raised for a large dataset
   □ timeout set, so idle clients are reaped
   □ stop-writes-on-bgsave-error: yes for durable, no for a pure cache

   KERNEL / HOST
   □ Transparent Huge Pages = never
   □ vm.overcommit_memory = 1
   □ vm.swappiness = 0 or 1
   □ LimitNOFILE well above maxclients + 32
   □ runs as a non-root user

   SECURITY
   □ bound to a private interface, never 0.0.0.0
   □ protected-mode yes
   □ firewall / security group restricts 6379 to app servers
   □ ACL users per service, starting from -@all
   □ -@dangerous on every application user
   □ credentials from a secrets manager, ≥32 random characters
   □ TLS if traffic leaves a trusted network

   AVAILABILITY
   □ at least one replica
   □ Sentinel (3 nodes, 3 hosts) or Cluster, or a managed service
   □ a failover TESTED in staging, with measured downtime
   □ backups taken from a replica, shipped off-host, and RESTORE-TESTED

   APPLICATION
   □ ONE client instance at module scope, not per request
   □ commandTimeout set
   □ retryStrategy with capped exponential backoff
   □ graceful shutdown calls quit(), not disconnect()
   □ cache reads fail open
   □ every key has a TTL or an explicit trim
   □ keys versioned (cache:v1:…)
   □ hash tags on keys used together, in case of future Cluster
   □ no user input in key names without validation or hashing

   OBSERVABILITY
   □ INFO scraped into metrics
   □ alerts: memory %, fragmentation < 1.0, persistence errors,
     rejected_connections, evicted_keys on durable instances,
     replica link status, hit ratio
   □ SLOWLOG threshold configured and reviewed
   □ CLIENT SETNAME / connectionName on every connection
   □ liveness and readiness checks are SEPARATE (readiness includes loading:0)
```

---

## 3. Instance sizing and separation

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │  INSTANCE A — CACHE                                                 │
   │    maxmemory-policy allkeys-lru                                     │
   │    appendonly no  ·  save ""                                        │
   │    stop-writes-on-bgsave-error no                                   │
   │    holds: cache:*  page:*  api:*  session:*                          │
   │    losing it costs LATENCY                                          │
   ├─────────────────────────────────────────────────────────────────────┤
   │  INSTANCE B — DURABLE STATE                                         │
   │    maxmemory-policy noeviction                                      │
   │    appendonly yes  ·  appendfsync everysec  ·  save 300 100         │
   │    holds: lock:*  queue:*  jobs:*  ratelimit:*  leader:*             │
   │    losing it costs CORRECTNESS                                       │
   └─────────────────────────────────────────────────────────────────────┘
```

:::tip[This separation is the highest-leverage architectural decision on this page]
It removes an entire class of incident: a traffic spike filling the cache can no longer evict a distributed lock, a rate-limit counter, or a job's state. Those failures are **silent** — nothing errors, nothing logs, and you find out from a customer.

Two instances cost a little more. One instance costs you an outage you cannot explain.
:::

**Sizing:**

```
   dataset size          = keys × (avg key bytes + avg value bytes + ~60 B overhead)
   working memory        = dataset × 1.3    (fragmentation + client buffers)
   maxmemory             = working memory × 1.2  (headroom)
   physical RAM          = maxmemory / 0.6  (fork copy-on-write headroom)

   Example: 10 M keys × 200 B  = 2 GB dataset
            × 1.3               = 2.6 GB
            × 1.2               = 3.1 GB  → maxmemory 3gb
            / 0.6               = 5.2 GB  → a 8 GB instance
```

---

## 4. The three runbooks

### 🔴 Redis is down

```
   1. Is the process alive?
      systemctl status redis  ·  docker ps  ·  kubectl get pods

   2. Why did it die?
      journalctl -u redis -n 200
      dmesg | grep -i 'killed process'        ← the OOM killer
      grep -i 'error\|warning' /var/log/redis/redis.log

   3. OOM-killed?
      → maxmemory was unset, or set too close to physical RAM
      → lower maxmemory BEFORE restarting, or it dies again immediately
      → CONFIG SET maxmemory 4gb in the config file, then start

   4. It starts but rejects commands?
      INFO persistence → loading:1 ⇒ it is replaying the AOF/RDB.
      WAIT. A large AOF can take minutes. Do not restart it again.

   5. It will not start at all?
      redis-check-aof --fix appendonlydir/appendonly.aof.1.incr.aof
      redis-check-rdb dump.rdb
      ⚠ COPY THE FILE FIRST — --fix truncates in place, irreversibly.

   6. Failover instead of repair?
      SENTINEL failover mymaster        (or CLUSTER FAILOVER on a replica)
      Restoring service beats debugging a corpse. Debug the old node after.
```

### 🟠 Memory is critical

```
   1. INFO memory
      mem_fragmentation_ratio < 1.0  ⇒ SWAPPING. Act now, analyse later.
      used_memory / maxmemory > 0.95 ⇒ eviction churn / write rejection

   2. Data, or overhead?
      MEMORY STATS → dataset.percentage
        low ⇒ overhead: clients.slaves (a replica syncing),
              replication.backlog, clients.normal (connection count)
        high ⇒ it really is your keys → step 3

   3. redis-cli --memkeys  ·  redis-cli --bigkeys
      one huge key      ⇒ split it
      millions of tiny  ⇒ wrong type → bucket into Hashes

   4. OBJECT ENCODING on a sample
      unexpectedly hashtable/skiplist/raw ⇒ a threshold was crossed once

   5. RELIEF, in order:
      a. raise maxmemory (if there is physical headroom)
      b. redis-cli --scan --pattern 'cache:v1:*' | xargs -L 500 redis-cli UNLINK
      c. CONFIG SET maxmemory-policy allkeys-lru   (ONLY if it is truly a cache)
      d. CONFIG SET activedefrag yes               (if fragmentation > 1.5)
      e. scale up
```

### 🟠 Latency is high

```
   1. Is it Redis?
      redis-cli --latency  from the REDIS host AND from an APP host
      both fine ⇒ NOT REDIS. Look at your pool, GC, DNS, app CPU, N+1s.

   2. SLOWLOG GET 20
      KEYS / SMEMBERS / HGETALL / LRANGE 0 -1 / a Lua loop?
      → fix the call site, then deny the command in the ACL.

   3. LATENCY LATEST  ·  LATENCY DOCTOR
      "fork"              → persistence. Save on a replica; check THP.
      "aof-fsync-always"  → appendfsync, or a saturated disk.
      "expire-cycle"      → a mass-expiry storm. Add TTL jitter.
      "eviction-cycle"    → at maxmemory. Scale up.

   4. INFO memory → fragmentation < 1.0 ⇒ swapping (the usual hidden cause)

   5. INFO stats → total_connections_received climbing ⇒ no pooling

   6. redis-cli --hotkeys ⇒ one key taking all traffic; Cluster will not help.
      Fix: read replicas, a client-side cache, or split the key.
```

---

## 5. The decision tables

### Which data type?

| You need | Type |
| :--- | :--- |
| A single value, a counter, a cached blob | **String** |
| An object with independently-read fields | **Hash** |
| A queue, a stack, a capped feed | **List** |
| Uniqueness, O(1) membership, set algebra | **Set** |
| Ranking, leaderboards, time-ordered ranges, priorities | **Sorted Set** |
| Membership over dense integer ids, at 1 bit each | **Bitmap** |
| Approximate unique counts at massive scale | **HyperLogLog** |
| "What's near me?" | **Geo** (a Sorted Set) |
| An event log with acknowledgement and replay | **Stream** |
| Fire-and-forget broadcast | **Pub/Sub** |

### Which persistence?

| Loss tolerance | Config |
| :--- | :--- |
| Everything (pure cache) | `save ""`, `appendonly no` |
| Minutes | RDB only: `save 300 100` |
| **1 second** ← the usual answer | `appendonly yes`, `appendfsync everysec`, plus RDB for backups |
| Near zero | `appendfsync always` — ~10× slower; reconsider whether Redis is right |

### Which eviction policy?

| Instance role | Policy |
| :--- | :--- |
| Pure cache | `allkeys-lru` |
| Cache with a stable hot set + periodic scans | `allkeys-lfu` |
| Mixed (some keys have no other home) | `volatile-lru` — **and ensure keys actually have TTLs** |
| Durable state: locks, queues, counters | `noeviction` |

### Which topology?

| Need | Answer |
| :--- | :--- |
| Just a cache, downtime acceptable | A single instance |
| Read scaling | Primary + replicas |
| Automatic failover | Sentinel (3 nodes) — or a managed service |
| More RAM or write throughput than one machine | Cluster |
| The least operational work | **A managed service** |

---

## 6. The twelve sentences worth memorizing

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

---

## 7. Quick command reference

```bash
# ── keyspace ──────────────────────────────────────────────────────────
TYPE k · EXISTS k · TTL k · EXPIRE k 60 · PERSIST k · UNLINK k
SCAN 0 MATCH 'p:*' COUNT 100 · OBJECT ENCODING k · MEMORY USAGE k

# ── strings ───────────────────────────────────────────────────────────
SET k v [EX n|KEEPTTL|NX|XX|GET] · GET k · MGET · MSET · INCR · INCRBY
APPEND · STRLEN · GETRANGE · GETDEL · GETEX

# ── hashes ────────────────────────────────────────────────────────────
HSET k f v · HGET · HMGET · HGETALL · HDEL · HINCRBY · HSCAN · HLEN
HEXPIRE k 60 FIELDS 1 f    (7.4+)

# ── lists ─────────────────────────────────────────────────────────────
LPUSH · RPUSH · LPOP · RPOP · LRANGE · LLEN · LTRIM · LREM · LPOS
BLPOP · BRPOP · LMOVE · BLMOVE

# ── sets ──────────────────────────────────────────────────────────────
SADD · SREM · SISMEMBER · SMISMEMBER · SCARD · SPOP · SRANDMEMBER
SUNION · SINTER · SDIFF · S*STORE · SINTERCARD · SSCAN

# ── sorted sets ───────────────────────────────────────────────────────
ZADD [NX|XX|GT|LT|CH|INCR] · ZRANGE k s e [BYSCORE|BYLEX] [REV] [LIMIT]
ZRANK · ZREVRANK · ZSCORE · ZCARD · ZCOUNT · ZINCRBY
ZPOPMIN · ZPOPMAX · BZPOPMIN · ZREMRANGEBY{RANK,SCORE,LEX}
ZUNIONSTORE · ZINTERSTORE [WEIGHTS] [AGGREGATE]

# ── streams ───────────────────────────────────────────────────────────
XADD k MAXLEN ~ 1000 * f v · XLEN · XRANGE · XREAD [BLOCK]
XGROUP CREATE · XREADGROUP GROUP g c … STREAMS k > · XACK
XPENDING · XAUTOCLAIM · XINFO GROUPS

# ── transactions & scripting ──────────────────────────────────────────
MULTI · EXEC · DISCARD · WATCH · UNWATCH
EVAL script numkeys k… a… · EVALSHA · SCRIPT LOAD · FCALL

# ── admin ─────────────────────────────────────────────────────────────
INFO [section] · DBSIZE · CONFIG GET/SET · CONFIG REWRITE
SLOWLOG GET · LATENCY LATEST · LATENCY DOCTOR · MEMORY DOCTOR/STATS
CLIENT LIST · CLIENT KILL · ACL LIST/SETUSER/LOG
BGSAVE · BGREWRITEAOF · LASTSAVE
REPLICAOF host port · CLUSTER INFO/NODES/SHARDS

# ── CLI utilities ─────────────────────────────────────────────────────
redis-cli --scan --pattern 'p:*'   --bigkeys   --memkeys   --hotkeys
redis-cli --latency   --latency-history   --stat   --rdb backup.rdb
redis-benchmark -t get,set -n 100000 -P 16 -d 512 -r 1000000 -q
```

---

**Next:** [Redis in an Express App](./30-redis-with-express.md) — wiring all of this into a real TypeScript service.
