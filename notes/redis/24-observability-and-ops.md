---
title: Observability & Operations
author: Tejas Nirala
---

# Observability & Operations

> **What you will be able to do after this page**
>
> - Read `INFO` and know which twenty fields out of two hundred actually matter.
> - Build a dashboard and an alert set that catch real problems and not noise.
> - Work three runbooks: high memory, high latency, and connection exhaustion.
> - Upgrade, migrate, and restart Redis without losing data.

---

## 1. `INFO` — the fields that matter

```bash
redis-cli INFO                # everything
redis-cli INFO memory         # one section
redis-cli INFO replication stats clients      # several
```

### Server

```
redis_version:7.2.4
uptime_in_seconds:8640000       # a very low value after an incident = it restarted
process_id:1234
config_file:/etc/redis/redis.conf
io_threads_active:0
```

### Clients

```
connected_clients:150           # sudden growth = a leak or a traffic spike
blocked_clients:12              # clients in BLPOP/BRPOP/XREAD BLOCK — normal
                                # for workers; unexpectedly high = a stuck queue
tracking_clients:0
maxclients:10000
client_recent_max_input_buffer:20480
client_recent_max_output_buffer:0     # ← growth means a slow consumer
```

### Memory

```
used_memory_human:2.50G
used_memory_rss_human:2.75G
used_memory_peak_human:3.10G    # ← the number to size against, not `used`
maxmemory_human:4.00G
maxmemory_policy:allkeys-lru
mem_fragmentation_ratio:1.10    # < 1.0 = SWAPPING (emergency); > 1.5 = fragmented
mem_allocator:jemalloc-5.3.0
```

### Persistence

```
loading:0                       # 1 = still loading; the server rejects most commands
rdb_last_bgsave_status:ok       # ← ALERT on "err"
rdb_last_bgsave_time_sec:3      # rising = the dataset is growing; fork stalls grow
rdb_changes_since_last_save:1523
aof_enabled:1
aof_last_bgrewrite_status:ok    # ← ALERT on "err"
aof_last_write_status:ok        # ← ALERT on "err"
aof_delayed_fsync:0             # ← rising = your disk cannot sustain everysec
```

### Stats

```
total_connections_received:1000000   # ← rapid growth = no connection pooling
total_commands_processed:5000000000
instantaneous_ops_per_sec:45000
total_net_input_bytes / total_net_output_bytes
rejected_connections:0               # ← non-zero = maxclients hit
expired_keys:1523000
evicted_keys:0                       # ← non-zero on a durable instance = data loss
keyspace_hits:9500000
keyspace_misses:500000               # hit ratio = hits/(hits+misses)
sync_full:2                          # ← climbing = repeated full replica syncs
sync_partial_ok:145
sync_partial_err:0                   # ← non-zero = repl-backlog-size too small
latest_fork_usec:45000               # the last fork's duration — 45 ms here
```

### Replication

```
role:master
connected_slaves:2
slave0:ip=10.0.1.11,port=6379,state=online,offset=1234567,lag=0
master_repl_offset:1234567
```

### Keyspace

```
db0:keys=1000000,expires=250000,avg_ttl=3600000
#             │            └── how many have a TTL
#             └── total. keys >> expires means most keys are permanent —
#                 intentional, or a leak?
```

---

## 2. The dashboard

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │  THROUGHPUT & LATENCY                                               │
   │    instantaneous_ops_per_sec                                        │
   │    command latency p50 / p99 / p999   (from your client)            │
   │    total_net_input_bytes / total_net_output_bytes  (rate)           │
   ├─────────────────────────────────────────────────────────────────────┤
   │  MEMORY                                                             │
   │    used_memory  vs  maxmemory        (as a percentage)              │
   │    used_memory_rss, used_memory_peak                                │
   │    mem_fragmentation_ratio                                          │
   │    evicted_keys (rate)  ·  expired_keys (rate)                      │
   ├─────────────────────────────────────────────────────────────────────┤
   │  CACHE EFFECTIVENESS                                                │
   │    hit ratio = keyspace_hits / (hits + misses)                      │
   ├─────────────────────────────────────────────────────────────────────┤
   │  CONNECTIONS                                                        │
   │    connected_clients  ·  blocked_clients  ·  rejected_connections   │
   │    total_connections_received (RATE — this is the pooling signal)   │
   ├─────────────────────────────────────────────────────────────────────┤
   │  PERSISTENCE                                                        │
   │    rdb_last_bgsave_status  ·  aof_last_write_status                 │
   │    latest_fork_usec  ·  aof_delayed_fsync                           │
   ├─────────────────────────────────────────────────────────────────────┤
   │  REPLICATION                                                        │
   │    connected_slaves  ·  master_link_status                          │
   │    replication offset lag (bytes)                                   │
   │    sync_full (rate)  ·  sync_partial_err                            │
   └─────────────────────────────────────────────────────────────────────┘
```

### The alerts worth having

| Severity | Condition | Why |
| :--- | :--- | :--- |
| 🔴 **Page** | `mem_fragmentation_ratio < 1.0` | **Swapping.** Latency is about to become catastrophic. |
| 🔴 **Page** | `used_memory / maxmemory > 0.95` | Eviction churn or write rejection is imminent |
| 🔴 **Page** | `rdb_last_bgsave_status != ok` **or** `aof_last_write_status != ok` | Persistence is broken; writes may be rejected |
| 🔴 **Page** | `master_link_status == down` for > 60 s | Not replicating — no HA |
| 🔴 **Page** | `rejected_connections > 0` | At `maxclients`; new requests are failing |
| 🟠 **Ticket** | Hit ratio < 0.8 on a cache | The cache is not earning its keep |
| 🟠 **Ticket** | `evicted_keys > 0` on a `noeviction`/durable instance | Silent data loss |
| 🟠 **Ticket** | `sync_full` rate rising | Repeated full syncs — raise the replica output buffer |
| 🟠 **Ticket** | `sync_partial_err > 0` | `repl-backlog-size` is too small |
| 🟠 **Ticket** | `latest_fork_usec > 500000` | Half-second fork stalls; check THP and instance size |
| 🟠 **Ticket** | `aof_delayed_fsync` rising | The disk cannot sustain `everysec` |
| 🟡 **Info** | `blocked_clients` unexpectedly high | A queue is not draining |
| 🟡 **Info** | `total_connections_received` rate high | No connection pooling |
| 🟡 **Info** | `connected_clients` trending up | A connection leak |

:::tip[Alert on rates and ratios, not absolutes]
`used_memory: 2 GB` means nothing without `maxmemory`. `evicted_keys: 1,000,000` means nothing without knowing whether that accumulated over a year or in the last minute.

Alert on `used_memory / maxmemory`, on `rate(evicted_keys)`, and on `hits/(hits+misses)`. Absolute counters produce alerts that fire once and then never reset.
:::

---

## 3. The diagnostic tools

```bash
# latency
redis-cli --latency                 # continuous min/avg/max
redis-cli --latency-history         # 15-second buckets over time
redis-cli --latency-dist            # a latency spectrum

CONFIG SET latency-monitor-threshold 100
LATENCY LATEST                      # event class · timestamp · last · max
LATENCY HISTORY <event>
LATENCY DOCTOR                      # plain-English analysis
LATENCY RESET

# slow commands
CONFIG SET slowlog-log-slower-than 10000     # microseconds
CONFIG SET slowlog-max-len 256
SLOWLOG GET 20
SLOWLOG LEN
SLOWLOG RESET

# memory
MEMORY DOCTOR
MEMORY STATS
MEMORY USAGE <key> [SAMPLES n]
redis-cli --bigkeys                 # biggest key per type (SCAN-based, safe)
redis-cli --memkeys                 # biggest by actual memory
redis-cli --hotkeys                 # most accessed (needs an LFU policy)

# live
redis-cli --stat                    # one line per second: keys, mem, clients, ops
redis-cli MONITOR                   # ⚠ every command — DEV/short bursts only
redis-cli INFO everything
```

:::danger[`MONITOR` is a production hazard]
It streams **every command from every client** through the output path. On a busy instance it consumes a large fraction of throughput and can itself cause the incident you were investigating.

Use `SLOWLOG` for slow commands, `--hotkeys` for hot keys, and client-side instrumentation for command mix. If you must use `MONITOR`, pipe it to a file for a few seconds and stop:
```bash
timeout 3 redis-cli MONITOR > /tmp/sample.txt
```
:::

---

## 4. Runbook: memory is high

```
   1. HOW BAD?
      redis-cli INFO memory
      → mem_fragmentation_ratio < 1.0  ⇒ SWAPPING. Go to step 6 NOW.
      → used_memory / maxmemory > 0.95 ⇒ eviction or write rejection imminent

   2. IS IT DATA, OR OVERHEAD?
      redis-cli MEMORY STATS
      → dataset.percentage high (>80%)  ⇒ it really is your keys. Step 3.
      → dataset.percentage low          ⇒ overhead. Check:
            clients.slaves        a replica mid-full-sync, buffering
            replication.backlog   repl-backlog-size set too large
            clients.normal        thousands of connections, or a huge pipeline

   3. WHICH KEYS?
      redis-cli --memkeys
      redis-cli --bigkeys
      → one enormous key      ⇒ split it (a Hash, a Stream, or paginate)
      → millions of tiny keys ⇒ wrong type; bucket into Hashes (§07)

   4. IS IT AN ENCODING PROBLEM?
      redis-cli OBJECT ENCODING <a sample of your keys>
      → unexpectedly "hashtable"/"skiplist"/"raw" ⇒ a threshold was crossed
        once and never reverts. Raise hash-max-listpack-* , or move the
        oversized field to its own key.

   5. DO THE KEYS HAVE TTLs?
      redis-cli INFO keyspace
      → keys >> expires ⇒ most keys are permanent. Intentional, or a leak?
      → find unbounded collections: --bigkeys shows lists/sets with no LTRIM

   6. IMMEDIATE RELIEF (in order of preference)
      a. Raise maxmemory if there is physical headroom:
             CONFIG SET maxmemory 6gb   &&   CONFIG REWRITE
      b. Delete a known-safe prefix:
             redis-cli --scan --pattern 'cache:v1:*' | xargs -L 500 redis-cli UNLINK
      c. Switch to an eviction policy if it is genuinely a cache:
             CONFIG SET maxmemory-policy allkeys-lru
      d. Enable defrag if fragmentation > 1.5:
             CONFIG SET activedefrag yes
      e. Scale up — and if you are swapping, do it now, not after more analysis.
```

---

## 5. Runbook: latency is high

```
   1. IS IT REDIS AT ALL?
      redis-cli --latency          # from the REDIS host
      redis-cli --latency          # from an APP host
      → both low, app still slow ⇒ NOT REDIS. Look at your connection pool,
        GC pauses, DNS, app CPU, or an N+1 making 500 sequential calls.

   2. SLOW COMMANDS?
      SLOWLOG GET 20
      → KEYS / SMEMBERS / HGETALL / LRANGE 0 -1 / a Lua loop?
        Fix: SCAN, pagination, a different type. Then:
        ACL SETUSER app … -keys       so it cannot happen again.

   3. WHAT CLASS OF LATENCY?
      CONFIG SET latency-monitor-threshold 100
      LATENCY LATEST  &&  LATENCY DOCTOR
      → "fork"              persistence. Save on a replica; disable THP;
                            smaller instances.
      → "aof-fsync-always"  appendfsync always, or a saturated disk.
      → "expire-cycle"      a mass-expiry storm. Add TTL jitter.
      → "eviction-cycle"    at maxmemory. Scale up.
      → "command"           back to step 2.

   4. MEMORY PRESSURE?
      INFO memory → fragmentation < 1.0 = swapping (the usual hidden cause)

   5. CONNECTION CHURN?
      INFO stats → total_connections_received climbing fast
      ⇒ a new connection per request. Fix pooling. Very common.

   6. ONE HOT KEY?
      redis-cli --hotkeys
      ⇒ a single key taking all the traffic cannot be sharded by Cluster.
        Fix: read replicas, a client-side cache (RESP3 tracking), or split it.

   7. THE NETWORK?
      Check bandwidth saturation, packet loss, and whether a big MGET or a
      Pub/Sub fan-out is moving far more bytes than you expect.
```

---

## 6. Runbook: connection exhaustion

```
   SYMPTOM: rejected_connections > 0
            "ERR max number of clients reached"

   1. WHAT IS THE REAL LIMIT?
      redis-cli CONFIG GET maxclients
      cat /proc/$(pgrep -f redis-server)/limits | grep 'open files'
      ⇒ Redis silently reduces maxclients to (ulimit -n) − 32.
        Raise LimitNOFILE in the systemd unit, not just `ulimit` in a shell.

   2. WHO IS CONNECTED?
      redis-cli CLIENT LIST | awk '{print $2}' | cut -d= -f2 | cut -d: -f1 \
        | sort | uniq -c | sort -rn
      ⇒ one host with thousands of connections = the culprit

   3. WHAT ARE THEY DOING?
      redis-cli CLIENT LIST | grep -oP 'cmd=\S+' | sort | uniq -c | sort -rn
      ⇒ all "cmd=NULL" with high age/idle = leaked, never-closed connections

   4. IS IT A LEAK OR REAL LOAD?
      redis-cli INFO stats | grep total_connections_received
      # sample twice, 10 seconds apart
      ⇒ climbing fast = a new connection per request (the classic bug)
      ⇒ flat but high connected_clients = connections opened and never closed

   5. IMMEDIATE RELIEF
      redis-cli CLIENT KILL TYPE normal MAXAGE 3600     # kill old idle clients
      redis-cli CONFIG SET maxclients 20000             # if FDs allow
      redis-cli CONFIG SET timeout 300                  # auto-close idle clients

   6. THE ACTUAL FIX
      Create the client ONCE at module scope. See §19.
```

---

## 7. Upgrades and restarts, without losing data

### A rolling upgrade with replication

```bash
# 1. Upgrade the REPLICAS first (they serve no writes)
systemctl stop redis          # on replica-1
apt install redis-server=7.2.4
systemctl start redis
redis-cli -h replica-1 INFO replication | grep master_link_status   # wait for "up"

# repeat for every replica

# 2. Fail over so a NEW-version replica becomes primary
redis-cli -p 26379 SENTINEL failover mymaster
#   or in Cluster:
redis-cli -h replica-1 -p 6379 CLUSTER FAILOVER

# 3. Upgrade the OLD primary, which is now a replica
systemctl stop redis && apt install … && systemctl start redis
```

Replicas first, then fail over, then the old primary. Never upgrade the primary in place while it is serving traffic.

### A safe restart of a standalone instance

```bash
# 1. Force a fresh snapshot
redis-cli BGSAVE
until [ "$(redis-cli INFO persistence | grep -c 'rdb_bgsave_in_progress:0')" = 1 ]; do sleep 1; done
redis-cli LASTSAVE

# 2. Copy it somewhere safe
cp /var/lib/redis/dump.rdb /backups/pre-restart-$(date +%s).rdb

# 3. Restart
systemctl restart redis

# 4. Wait for loading to finish — the server rejects most commands until then
until [ "$(redis-cli INFO persistence | grep -c 'loading:0')" = 1 ]; do sleep 1; done
redis-cli DBSIZE
```

:::warning[`loading:1` is a real state your app must handle]
While Redis reads its AOF or RDB at startup, it replies `-LOADING Redis is loading the dataset in memory` to most commands. On a large dataset this can be **minutes**.

Your health check must report not-ready during this window, or your orchestrator will route traffic to an instance that rejects every command. `enableReadyCheck: true` in ioredis handles the client side.
:::

### Migrating data between instances

```bash
# Option A — replication (zero downtime, the best way)
redis-cli -h new-redis REPLICAOF old-redis 6379
# wait for master_link_status:up and the offsets to converge
redis-cli -h new-redis REPLICAOF NO ONE      # promote
# repoint the application

# Option B — an RDB file copy (requires downtime)
redis-cli -h old-redis --rdb /tmp/dump.rdb
scp /tmp/dump.rdb new-redis:/var/lib/redis/dump.rdb
# ⚠ if appendonly is yes on the target, it IGNORES the RDB. Disable it first.

# Option C — per-key MIGRATE (selective, online)
redis-cli -h old-redis --scan --pattern 'user:*' | while read key; do
  redis-cli -h old-redis MIGRATE new-redis 6379 "$key" 0 5000 COPY REPLACE
done

# Option D — DUMP / RESTORE (a serialized value, useful for one key)
VAL=$(redis-cli --no-raw DUMP mykey)
redis-cli -h new-redis RESTORE mykey 0 "$VAL"
```

Option A is almost always correct. It is online, incremental, verifiable, and reversible.

---

## 8. A health check you can actually use

```ts
// src/health.ts
import { redis } from './redis';

interface RedisHealth {
  healthy: boolean;
  latencyMs: number | null;
  memoryUsedPct: number | null;
  hitRatio: number | null;
  role: string | null;
  issues: string[];
}

export async function checkRedis(): Promise<RedisHealth> {
  const issues: string[] = [];
  const started = Date.now();

  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') issues.push('unexpected PING reply');
    const latencyMs = Date.now() - started;

    const info = await redis.info();
    const num = (k: string) => Number(new RegExp(`^${k}:(\\S+)`, 'm').exec(info)?.[1] ?? NaN);
    const str = (k: string) => new RegExp(`^${k}:(\\S+)`, 'm').exec(info)?.[1] ?? null;

    const used = num('used_memory');
    const max = num('maxmemory');
    const hits = num('keyspace_hits');
    const misses = num('keyspace_misses');
    const frag = num('mem_fragmentation_ratio');

    const memoryUsedPct = max > 0 ? (used / max) * 100 : null;
    const hitRatio = hits + misses > 0 ? hits / (hits + misses) : null;

    if (latencyMs > 100) issues.push(`slow PING: ${latencyMs}ms`);
    if (memoryUsedPct !== null && memoryUsedPct > 90) issues.push(`memory at ${memoryUsedPct.toFixed(1)}%`);
    if (frag < 1.0) issues.push('SWAPPING — fragmentation ratio below 1.0');
    if (str('rdb_last_bgsave_status') !== 'ok') issues.push('last BGSAVE failed');
    if (str('aof_enabled') === '1' && str('aof_last_write_status') !== 'ok') issues.push('AOF write failed');
    if (num('loading') === 1) issues.push('still loading the dataset');

    return {
      healthy: issues.length === 0,
      latencyMs,
      memoryUsedPct,
      hitRatio,
      role: str('role'),
      issues,
    };
  } catch (err) {
    return {
      healthy: false, latencyMs: null, memoryUsedPct: null,
      hitRatio: null, role: null,
      issues: [`unreachable: ${(err as Error).message}`],
    };
  }
}
```

:::tip[Separate liveness from readiness]
- **Liveness** ("is the process alive?") → just `PING`. A failing liveness check restarts the container, and restarting Redis for high memory would be actively harmful.
- **Readiness** ("should traffic come here?") → `PING` **plus** `loading:0`. An instance replaying a 10 GB AOF is alive but must not receive traffic.

Conflating them means Kubernetes kills a Redis that was merely loading — and then it starts loading again, forever.
:::

---

## 9. The configuration audit

Run this against every instance you own:

```bash
redis-cli CONFIG GET maxmemory                # 0 = unbounded ⇒ OOM-kill risk
redis-cli CONFIG GET maxmemory-policy         # noeviction on a cache? volatile-* with no TTLs?
redis-cli CONFIG GET appendonly               # durability expectations vs reality
redis-cli CONFIG GET save                     # snapshot cadence
redis-cli CONFIG GET bind                     # 0.0.0.0? 🚨
redis-cli CONFIG GET protected-mode
redis-cli CONFIG GET timeout                  # 0 = idle clients never closed
redis-cli CONFIG GET repl-backlog-size        # 1mb default is too small
redis-cli CONFIG GET 'lazyfree-*'             # all should be yes
redis-cli CONFIG GET 'client-output-buffer-limit'
redis-cli ACL LIST                            # who can do what
cat /sys/kernel/mm/transparent_hugepage/enabled   # must be [never]
sysctl vm.overcommit_memory                   # must be 1
sysctl vm.swappiness                          # 0 or 1
```

The five that most often come back wrong, in order of how much damage they cause:

1. **`maxmemory 0`** — no cap, so the OOM killer eventually takes the whole dataset.
2. **THP enabled** — multi-second latency spikes during every save, blamed on everything else.
3. **`repl-backlog-size 1mb`** — a one-second blip triggers a full resync.
4. **`lazyfree-*` all `no`** — a single big `DEL` stalls the server for seconds.
5. **`vm.overcommit_memory 0`** — `fork()` fails, saves fail, and `stop-writes-on-bgsave-error` then rejects writes.

---

## Rapid-fire recall

1. Which `INFO` field indicates swapping, and what value means it?
2. Which field reveals that your app is not pooling connections?
3. What does `sync_partial_err > 0` tell you, and what is the fix?
4. Why alert on ratios and rates rather than absolute counters?
5. Why is `MONITOR` dangerous, and what should you use instead?
6. Both `--latency` runs are fine but the app is slow. Where do you look?
7. What order do you upgrade a primary and its replicas in, and why?
8. What is `loading:1` and why must liveness and readiness checks differ?
9. If `appendonly yes`, what happens when you restore an RDB backup?
10. Name the five configuration mistakes that cause the most damage.

<details>
<summary>Answers</summary>

1. `mem_fragmentation_ratio` below 1.0 — RSS is less than allocated memory, meaning the OS has paged Redis to disk.
2. `total_connections_received` climbing rapidly — a new connection per request rather than a reused one.
3. Partial resyncs are failing because the requested offset has already been overwritten in the replication backlog. Raise `repl-backlog-size` (64–256 MB rather than the 1 MB default).
4. Absolutes lack context — 2 GB is meaningless without `maxmemory`, and a cumulative counter fires once and never resets. Ratios and rates describe the current state.
5. It streams every command from every client through the output path and can consume a large share of throughput on a busy instance. Use `SLOWLOG`, `--hotkeys`, and client-side instrumentation.
6. Not at Redis. Check the connection pool, GC pauses, DNS, application CPU, and N+1 patterns making hundreds of sequential calls.
7. Replicas first, then fail over so an upgraded node becomes primary, then upgrade the old primary as a replica. Never upgrade a serving primary in place.
8. The server is still reading its AOF/RDB and rejects most commands with `-LOADING`. Liveness should be a bare `PING` (so the orchestrator does not kill a loading instance); readiness must also require `loading:0` so traffic is not routed there.
9. Redis loads the **AOF** and silently ignores your restored RDB. Disable `appendonly` first, verify the data, then re-enable it (which triggers a rewrite from memory).
10. `maxmemory 0`; Transparent Huge Pages enabled; `repl-backlog-size 1mb`; all `lazyfree-*` set to `no`; `vm.overcommit_memory 0`.

</details>

---

**Next:** [Caching Patterns](./25-caching-patterns.md) — cache-aside, write-through, and the three failure modes with names.
