---
title: Replication
author: Tejas Nirala
---

# Replication

> **What you will be able to do after this page**
>
> - Set up a replica and trace a full sync and a partial resync, step by step.
> - Say precisely what replication does and does not guarantee about durability.
> - Explain the replication backlog and why `repl-backlog-size` matters.
> - Use `WAIT` and know exactly what it buys you.

Replication gives you copies. Copies give you read scaling, backups without impacting the primary, and — combined with [Sentinel](./21-sentinel-and-failover.md) or [Cluster](./22-cluster.md) — availability. What it does **not** give you is durability.

---

## 1. The topology

```
                    ┌────────────────────────┐
                    │       PRIMARY          │
                    │   (accepts writes)     │
                    └───────────┬────────────┘
                                │  asynchronous command stream
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
      ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
      │  REPLICA 1   │  │  REPLICA 2   │  │  REPLICA 3   │
      │ (read-only)  │  │ (read-only)  │  │ (read-only)  │
      └──────────────┘  └──────────────┘  └──────┬───────┘
                                                  │  chained replication
                                                  ▼
                                          ┌──────────────┐
                                          │ SUB-REPLICA  │
                                          └──────────────┘
```

Key properties:

- **One primary, N replicas.** Redis has no multi-primary mode. (Cluster has many primaries, but each shard still has exactly one.)
- **Replication is asynchronous.** The primary does not wait for replicas before acknowledging a write.
- **Replicas are read-only by default** (`replica-read-only yes`). Writing to a replica is a bug — the write is local, is not replicated anywhere, and is silently destroyed on the next resync.
- **Chained replication** is supported: a replica can have its own replicas, spreading the fan-out cost.

---

## 2. Setting it up

```bash
# on the replica — at runtime
REPLICAOF 192.168.1.10 6379
REPLICAOF NO ONE                 # promote to primary / stop replicating

# or in redis.conf
replicaof 192.168.1.10 6379
masterauth <the primary's password>
masteruser <acl username>        # Redis 6+ ACLs
```

```conf
replica-read-only yes                # do not allow writes on the replica
replica-serve-stale-data yes         # serve reads even when the link is down
repl-diskless-sync yes               # stream the RDB over the socket
repl-diskless-sync-delay 5           # wait 5s to batch multiple replicas
repl-diskless-load disabled          # on the replica: swapdb | on-empty-db
repl-backlog-size 64mb               # the partial-resync buffer
repl-backlog-ttl 3600
repl-ping-replica-period 10
repl-timeout 60
min-replicas-to-write 0              # see §6
min-replicas-max-lag 10
```

```bash
127.0.0.1:6379> INFO replication
role:master
connected_slaves:2
slave0:ip=10.0.1.11,port=6379,state=online,offset=1234567,lag=0
slave1:ip=10.0.1.12,port=6379,state=online,offset=1234500,lag=1
master_replid:8f3c...
master_repl_offset:1234567
```

On the replica:

```bash
role:slave
master_host:10.0.1.10
master_link_status:up             # ← "down" means the link is broken
master_last_io_seconds_ago:0
master_sync_in_progress:0
slave_read_only:1
slave_repl_offset:1234567
```

`master_link_status` and the offset gap (`master_repl_offset` minus `slave_repl_offset`) are the two numbers to monitor.

---

## 3. Full synchronization, traced

When a replica connects for the first time — or cannot do a partial resync — it performs a **full sync**.

```
   REPLICA                                    PRIMARY
   ─────────────────────────────────          ────────────────────────────────
   1. connect, PING                     ───►
                                        ◄───  +PONG
   2. REPLCONF listening-port 6379      ───►
      REPLCONF capa eof capa psync2     ───►
                                        ◄───  +OK
   3. PSYNC ? -1                        ───►   "I have no replication ID
      (or PSYNC <replid> <offset>)             and no offset — full sync"
                                        ◄───  +FULLRESYNC <replid> <offset>
                                              (the replica records both)
   4.                                          fork() a child
                                               the child writes an RDB
                                               MEANWHILE the parent buffers
                                               every new write into this
                                               replica's output buffer
   5.                                   ◄───   the RDB, streamed
      the replica:
        • (optionally) writes it to disk
        • FLUSHES its own dataset
        • loads the RDB
   6.                                   ◄───   the buffered commands, then
                                               the live stream, forever
   7. state:online, lag ≈ 0
```

```
   THE TIMELINE, with the costs marked

   t=0   PSYNC ? -1
   t=0   fork()                    ← ⚠ latency spike on the PRIMARY
                                       (~10-20 ms per GB of page tables)
   t=0-30  the child writes the RDB
           the parent buffers writes ← ⚠ MEMORY on the primary
                                       (client-output-buffer-limit replica)
   t=30-45 the RDB is transferred   ← ⚠ NETWORK saturation
   t=45-60 the replica loads it     ← ⚠ the REPLICA is unavailable
                                       (or serves stale data)
   t=60  the buffered backlog is applied
   t=61  online
```

:::danger[A full sync is expensive on the primary — plan for it]
Four costs, all on the primary except the last:

1. **`fork()`** — a latency stall proportional to dataset size, plus copy-on-write memory.
2. **The replica output buffer** — every write during the sync is buffered *per replica*. If it exceeds `client-output-buffer-limit replica`, the primary **kills the connection and the sync restarts** — an infinite loop of failing syncs that saturates your network and never converges.

```conf
client-output-buffer-limit replica 512mb 128mb 60   # raise for big/busy datasets
```

3. **Network** — a 20 GB RDB across the wire, potentially several times if multiple replicas sync at once.
4. **The replica flushes its own data first**, so it is unavailable (or serving stale data) for the duration.

**The failing-sync loop is a real and vicious outage mode.** If `INFO` shows `sync_full` climbing repeatedly, that is what you are looking at, and the fix is raising the replica output buffer limit.
:::

### Diskless replication

```conf
repl-diskless-sync yes            # default since Redis 7
repl-diskless-sync-delay 5
repl-diskless-load on-empty-db    # or swapdb, or disabled
```

The forked child writes the RDB **directly to the replica's socket** instead of to a file. This avoids disk I/O entirely, which is a large win on slow disks or in containers with network storage.

`repl-diskless-sync-delay 5` makes the primary wait five seconds before starting, so that several replicas connecting at once can be served by **one** fork and one RDB stream rather than N. When you restart three replicas after a deploy, this setting is the difference between one fork and three.

On the replica side, `repl-diskless-load`:
- `disabled` (safest) — buffer the RDB to disk, then load it.
- `on-empty-db` — load directly from the socket when the replica has no data. Safe and fast.
- `swapdb` — keep the old dataset in memory while loading the new one, so a failed sync does not leave you empty. Costs 2× memory.

---

## 4. Partial resynchronization

A brief network blip should not trigger a full sync. `PSYNC2` (Redis 4.0+) makes that work.

### The replication backlog

The primary keeps a **circular buffer** of the recent command stream:

```
   repl-backlog-size 64mb

   ┌──────────────────────────────────────────────────────────┐
   │  … SET a 1 │ INCR b │ LPUSH c x │ DEL d │ SET e 5 …      │
   └──────────────────────────────────────────────────────────┘
   offset:      1000000                              1234567
                ▲                                          ▲
          the oldest offset still available      the current offset

   Replica reconnects with PSYNC <replid> 1234500
     → 1234500 is INSIDE the window → +CONTINUE, send from there ✅
   Replica reconnects with PSYNC <replid> 900000
     → 900000 has been overwritten → +FULLRESYNC, start over ❌
```

```
   REPLICA                                    PRIMARY
   ────────────────────────────────           ─────────────────────────────
   (link drops for 20 seconds)
   reconnect
   PSYNC 8f3c… 1234500              ───►      is 8f3c… my replication ID
                                              (or my second ID from a failover)?
                                              is 1234500 still in the backlog?
                                    ◄───      +CONTINUE
                                    ◄───      commands from offset 1234500
   caught up in milliseconds ✅
```

:::tip[Size the backlog for your worst realistic disconnection]
```
   repl-backlog-size ≈ write_throughput_bytes_per_sec × expected_downtime_sec × 2

   Example: 10 MB/s of writes, tolerate a 60-second network blip
            → 10 × 60 × 2 = 1.2 GB … which is a lot of RAM.
            More realistically: tolerate 10s → 200 MB.
```

The default of 1 MB is far too small for any busy instance — a 1-second blip on a write-heavy primary triggers a full sync. **64 MB–256 MB is a much more sensible starting point.**

The backlog is allocated **once**, when the first replica attaches, and is shared by all replicas. It shows up as `replication.backlog` in `MEMORY STATS`, and it is a common answer to "why is `dataset.percentage` low?"
:::

### Replication IDs and failover

```bash
127.0.0.1:6379> INFO replication
master_replid:8f3c1a...              # the current replication history ID
master_replid2:0000000...            # the PREVIOUS one, after a failover
second_repl_offset:-1                # the offset at which the history diverged
```

When a replica is promoted to primary, it starts a **new replication ID** but remembers the old one in `replid2`. That lets the other replicas — which still reference the old ID — perform a *partial* resync against the new primary instead of a full one.

**This is the feature that makes failover cheap.** Before PSYNC2 (Redis < 4.0), every failover forced a full sync from every remaining replica simultaneously — a stampede on a server that had just been promoted. If you read older material warning about that, this is what fixed it.

---

## 5. The durability question — answer it precisely

:::danger[Replication is for availability, not durability]
```
   client ──► PRIMARY: SET k v
              PRIMARY: writes to memory
              PRIMARY: appends to the AOF buffer
              PRIMARY ──► client: +OK          ← ACKNOWLEDGED HERE
              PRIMARY ──► replicas: SET k v    ← sent AFTERWARD, asynchronously
```

Between the acknowledgement and the replica receiving it, **the primary can die and that write is gone** — even with three replicas, even with AOF enabled (the fsync had not happened yet either).

Redis replication is **asynchronous**. There is no quorum, no consensus, no two-phase commit. This is a deliberate choice: synchronous replication would put a network round trip on every write, and Redis's entire value proposition is not doing that.

**Redis is an AP system** in CAP terms. It chooses availability and partition tolerance over consistency. If you need a CP datastore, you need a different datastore.
:::

### `WAIT` — narrowing, not closing, the window

```bash
SET critical:key value
WAIT 2 1000          # block until 2 replicas have acknowledged, or 1000 ms
# → (integer) 2      the number that actually acknowledged
```

```ts
await redis.set('order:9981:status', 'paid');
const acked = await redis.wait(2, 1000);
if (acked < 2) {
  log.warn({ acked }, 'write not replicated to a quorum');
  // …now what? The write ALREADY HAPPENED. You cannot roll it back.
}
```

:::warning[What `WAIT` actually gives you, and what it does not]
✅ It confirms that N replicas have **received** the write into memory.

❌ It is **not** synchronous replication — the write is already applied on the primary before `WAIT` is called. If the answer is "only 1 acknowledged", there is nothing to undo.
❌ It does **not** guarantee the replicas have **fsynced** it. (`WAITAOF numlocal numreplicas timeout`, added in Redis 7.2, does address fsync — `WAITAOF 1 2 1000` waits for the local AOF fsync plus two replicas.)
❌ It does **not** prevent a failover from choosing a replica that missed the write.
❌ It **costs a round trip on every write you use it on**, which is exactly the latency you came to Redis to avoid.

Use `WAIT` sparingly, on genuinely critical writes only. Do not sprinkle it everywhere.
:::

---

## 6. `min-replicas` — failing safe

```conf
min-replicas-to-write 1
min-replicas-max-lag 10
```

**"Refuse writes unless at least 1 replica has been in contact within the last 10 seconds."**

```
   Normal:      primary + 2 healthy replicas  → writes accepted
   Partition:   primary loses BOTH replicas   → writes REJECTED with
                                                 -NOREPLICAS
```

This is a partial defence against **split-brain**: an isolated primary that keeps accepting writes which will be discarded when it rejoins and is demoted. By refusing writes when it cannot see any replica, you bound the data loss.

It is a trade — you are choosing "reject writes" over "accept writes that may vanish". For a cache, that is usually the wrong trade. For a queue or a counter, it is usually the right one.

---

## 7. Reading from replicas

```ts
const replica = new Redis(process.env.REDIS_REPLICA_URL!);

const readHeavy  = () => replica.get('cache:trending');
const mustBeFresh = () => redis.get('user:1042:balance');
```

Or let Sentinel/Cluster route for you:

```ts
const redis = new Redis({ sentinels: [...], name: 'mymaster', role: 'slave' });
const cluster = new Redis.Cluster([...], { scaleReads: 'slave' });
```

:::warning[Reading from a replica means accepting stale reads]
```
   t=0.000  client A writes to the PRIMARY:  SET balance 50
   t=0.001  client B reads from a REPLICA:   GET balance → "100"  ← STALE
   t=0.003  the replica applies the write
```

Typical lag is sub-millisecond on a LAN, but it spikes during a full sync, under heavy write load, or across regions.

**The read-your-own-writes problem is the one that bites.** A user updates their profile, is redirected, the read hits a replica, and they see their old data — and conclude your app is broken.

Fixes, in order of preference:
1. **Route reads that follow a write to the primary** — for a bounded window after the write, pin that user's session to the primary.
2. Track `master_repl_offset` at write time and only read from a replica whose `slave_repl_offset` has passed it.
3. Just read from the primary for anything user-visible and use replicas only for genuinely tolerant workloads (analytics, batch jobs, search index building).

Also remember from [Expiration & Eviction](./15-expiration-and-eviction.md): a replica does not expire keys itself, so its `DBSIZE` and memory can legitimately exceed the primary's.
:::

---

## 8. Operating replication

```bash
# is the link healthy?
redis-cli -h replica INFO replication | grep -E 'master_link_status|master_last_io'

# how far behind?
PRIMARY_OFF=$(redis-cli -h primary INFO replication | grep master_repl_offset | cut -d: -f2)
REPLICA_OFF=$(redis-cli -h replica INFO replication | grep slave_repl_offset | cut -d: -f2)
echo "lag: $((PRIMARY_OFF - REPLICA_OFF)) bytes"

# how many full syncs have happened? (should be near-static)
redis-cli INFO stats | grep -E 'sync_full|sync_partial_ok|sync_partial_err'
```

| Metric | Healthy | What a bad value means |
| :--- | :--- | :--- |
| `master_link_status` | `up` | `down` = not replicating at all |
| offset gap | Small and stable | Growing = the replica cannot keep up |
| `sync_full` | Near-constant | Climbing = repeated full syncs — check the replica output buffer |
| `sync_partial_err` | 0 | Non-zero = the backlog is too small |
| `connected_slaves` | Your expected count | Fewer = a replica is gone |
| `master_last_io_seconds_ago` | < `repl-ping-replica-period` | High = the link is stalled |

### Manual failover

```bash
# 1. verify the replica is caught up
redis-cli -h replica INFO replication | grep slave_repl_offset

# 2. stop writes to the old primary
redis-cli -h primary CLIENT PAUSE 10000 WRITE

# 3. promote
redis-cli -h replica REPLICAOF NO ONE

# 4. repoint the other replicas
redis-cli -h replica2 REPLICAOF <new-primary> 6379

# 5. repoint your application (DNS, config, service discovery)

# 6. demote the old primary — AFTER confirming it has no unreplicated writes
redis-cli -h old-primary REPLICAOF <new-primary> 6379
```

That is six manual steps with a data-loss risk at each one. **Which is exactly why [Sentinel](./21-sentinel-and-failover.md) exists** — to do this automatically, in seconds, at 3 a.m., correctly.

---

## Rapid-fire recall

1. Is Redis replication synchronous or asynchronous, and what does that mean for durability?
2. Walk through a full sync. Name the four costs and which side pays each.
3. What is the failing-full-sync loop, what causes it, and what fixes it?
4. What is the replication backlog and how do you size it?
5. What are `master_replid` and `master_replid2` for?
6. What exactly does `WAIT 2 1000` guarantee, and what does it not?
7. What does `min-replicas-to-write 1` protect against, and what does it cost?
8. Name the read-your-own-writes problem and two fixes.
9. Which `INFO` metric tells you your backlog is too small?
10. Why is a replica's `DBSIZE` sometimes higher than the primary's?

<details>
<summary>Answers</summary>

1. Asynchronous. The primary acknowledges the client *before* sending to replicas, so a primary crash can lose acknowledged writes even with replicas. Replication provides availability, not durability. Redis is AP.
2. `fork()` on the primary (latency stall + copy-on-write memory); the per-replica output buffer on the primary (memory); the RDB transfer (network); and the replica flushing and loading (the replica is unavailable).
3. The primary buffers writes per replica during a sync; if that buffer exceeds `client-output-buffer-limit replica`, the primary kills the connection and the sync restarts — forever. Raise the replica output buffer limit.
4. A circular buffer of the recent command stream on the primary. Size it as write-throughput × the disconnection you want to tolerate × 2. The 1 MB default is far too small; 64–256 MB is a better start.
5. `master_replid` is the current replication history ID; `master_replid2` is the previous one, kept after a promotion so other replicas can partially resync against the new primary instead of doing a full sync.
6. It confirms N replicas have **received** the write into memory. It does not make replication synchronous (the write already happened), does not guarantee they fsynced it (use `WAITAOF`), does not prevent a failover to a replica that missed it, and costs a round trip.
7. Split-brain data loss — an isolated primary accepting writes that will be discarded on rejoin. It costs availability: writes are rejected when no replica is reachable.
8. A user writes, then reads from a replica that has not yet applied the write, and sees stale data. Fix by routing post-write reads to the primary for a window, or by comparing replication offsets before trusting a replica.
9. `sync_partial_err` being non-zero — partial resyncs are failing because the requested offset has already been overwritten.
10. A replica does not expire keys on its own; it waits for the primary's replicated `DEL`. Logically-expired keys are hidden from reads but still occupy memory.

</details>

---

**Next:** [Sentinel & Automatic Failover](./21-sentinel-and-failover.md) — making the six manual steps above happen by themselves.
