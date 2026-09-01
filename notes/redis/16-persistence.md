---
title: "Internals: Persistence"
author: Tejas Nirala
---

# Internals: Persistence

> **What you will be able to do after this page**
>
> - State exactly how much data each configuration can lose, in seconds.
> - Explain `fork()` and copy-on-write, and why saving can double your memory.
> - Choose between RDB, AOF, and both — and defend it.
> - Recover from a corrupted file and perform a backup correctly.

Redis holds data in RAM. Persistence is how it survives a restart. There are two mechanisms, they solve different problems, and the honest answer to "how much can I lose?" depends entirely on which you chose.

---

## 1. The two mechanisms

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │  RDB — Redis Database                                               │
   │  A point-in-time BINARY SNAPSHOT of the whole dataset.              │
   │  "Photograph the world every 5 minutes."                            │
   │                                                                     │
   │  dump.rdb   ┌──────────────────────────────────────┐                │
   │             │ REDIS0011 │ metadata │ db0 │ k=v … │ │  compact       │
   │             └──────────────────────────────────────┘                │
   ├─────────────────────────────────────────────────────────────────────┤
   │  AOF — Append Only File                                             │
   │  A LOG of every write command, in RESP format.                      │
   │  "Write down every change as it happens."                           │
   │                                                                     │
   │  appendonly.aof  *3\r\n$3\r\nSET\r\n$1\r\na\r\n$1\r\n1\r\n          │
   │                  *3\r\n$3\r\nSET\r\n$1\r\nb\r\n$1\r\n2\r\n          │
   │                  *2\r\n$4\r\nINCR\r\n$1\r\na\r\n         verbose    │
   └─────────────────────────────────────────────────────────────────────┘
```

| | **RDB** | **AOF** |
| :--- | :--- | :--- |
| What it stores | The final state | Every write operation |
| File size | Compact (binary, LZF-compressed) | Large (grows with writes) |
| Restart speed | **Fast** — deserialize a binary image | Slow — re-execute every command |
| Data loss window | **Minutes** | **1 second** (or 0) |
| Write-time cost | A periodic `fork()` spike | Continuous small appends |
| Good for | Backups, replication, disaster recovery | Durability |
| Human-readable | No | Yes (a text log of commands) |

---

# Part 1 — RDB Snapshots

## 1.1 Configuration

```conf
save 3600 1          # snapshot if ≥1 key changed in 3600s
save 300 100         # OR ≥100 keys changed in 300s
save 60 10000        # OR ≥10000 keys changed in 60s
save ""              # ← disable RDB entirely

dbfilename dump.rdb
dir /var/lib/redis

rdbcompression yes            # LZF-compress strings in the file
rdbchecksum yes               # CRC64 at the end — detects corruption
sanitize-dump-payload no      # deep-validate RESTORE payloads (security)

stop-writes-on-bgsave-error yes    # ← see the warning below
rdb-del-sync-files no
```

The `save` lines are **OR'd**: the more the data changes, the more often it is saved. That is a nice property — an idle server does no work, a busy one saves often.

:::danger[`stop-writes-on-bgsave-error yes` will take your site down]
If a background save fails — a full disk, wrong permissions, no memory to fork — Redis **rejects every write** with:

```
   (error) MISCONF Redis is configured to save RDB snapshots, but it
   is currently not able to persist on disk.
```

The intent is good: refuse to accept writes you cannot durably store. But on a **pure cache** where you do not care about the RDB at all, a full disk turns a cosmetic problem into a total outage.

- **Durable instance:** leave it `yes` and monitor `rdb_last_bgsave_status`.
- **Pure cache:** set it to `no`, and monitor disk space anyway.
:::

## 1.2 Triggering a save

```bash
BGSAVE            # fork a child and save in the background  ← use this
SAVE              # save on the MAIN THREAD — blocks everything. NEVER in prod.
BGREWRITEAOF      # the AOF equivalent
LASTSAVE          # → the unix timestamp of the last successful save
```

```bash
127.0.0.1:6379> INFO persistence
rdb_bgsave_in_progress:0
rdb_last_save_time:1756742400
rdb_last_bgsave_status:ok            # ← alert if this is "err"
rdb_last_bgsave_time_sec:3
rdb_changes_since_last_save:1523
```

An RDB is also written automatically on a **clean shutdown** (`SHUTDOWN` or `SIGTERM`), which is why a `docker stop` usually preserves data while a `docker kill` does not.

## 1.3 `fork()` and copy-on-write — the mechanism to understand

```
   BEFORE fork()
   ┌────────────────────────────────────┐
   │  redis-server (parent)             │
   │  ┌──────────────────────────────┐  │
   │  │ 4 GB of page tables → RAM    │  │
   │  └──────────────────────────────┘  │
   └────────────────────────────────────┘

   AFTER fork() — instant, no data copied
   ┌────────────────────┐      ┌────────────────────┐
   │ parent             │      │ child              │
   │ page table ────────┼──┬───┼──── page table     │
   └────────────────────┘  │   └────────────────────┘
                           ▼
                ┌──────────────────────┐
                │  4 GB of SHARED,     │   the kernel marks every page
                │  READ-ONLY pages     │   copy-on-write
                └──────────────────────┘

   THE PARENT WRITES to a page (a client runs SET)
   ┌────────────────────┐      ┌────────────────────┐
   │ parent             │      │ child              │
   │ page table         │      │ page table         │
   └─────────┬──────────┘      └─────────┬──────────┘
             ▼                            ▼
   ┌──────────────────┐         ┌──────────────────┐
   │ a NEW COPY of    │         │ the ORIGINAL     │  ← the child keeps
   │ that 4 KB page   │         │ page             │    a consistent
   └──────────────────┘         └──────────────────┘    point-in-time view
   ▲ +4 KB of real memory, per page touched
```

`fork()` gives the child a **frozen, consistent snapshot** for free — no locking, no pausing the parent, no coordination. It is an elegant use of a Unix primitive, and it is why `BGSAVE` does not block your clients.

### The two costs

**1. Memory.** Every page the parent writes to during the save is duplicated.

```
   A read-heavy workload:   +5–20% memory during a save
   A write-heavy workload:  +50% or worse
   Worst case (every page touched): 2× the dataset
```

**This is the main reason `maxmemory` must be well under physical RAM.** A 12 GB dataset on a 16 GB box that forks during a write burst gets OOM-killed.

**2. Latency.** `fork()` itself is not free — the kernel must copy the parent's **page tables**.

```
   ~10–20 ms per GB of dataset on typical hardware
   → a 10 GB instance stalls for 100–200 ms on EVERY BGSAVE
   → and it is worse on EC2/virtualized hardware
```

During that stall the main thread is blocked. `LATENCY LATEST` reports it as a `fork` event.

:::danger[Transparent Huge Pages make this dramatically worse]
With THP enabled, the kernel uses **2 MB pages** instead of 4 KB. A copy-on-write of a single byte now copies 2 MB instead of 4 KB — **512× the memory traffic**. Latency spikes go from milliseconds to seconds, and memory usage during a save can balloon.

```bash
echo never > /sys/kernel/mm/transparent_hugepage/enabled
echo never > /sys/kernel/mm/transparent_hugepage/defrag
# make it permanent in your init system / kernel cmdline
```

Redis prints a warning at startup when THP is on. **This is the single most commonly ignored Redis warning, and it causes real, hard-to-diagnose latency incidents.**

Also required, so `fork()` does not fail outright:
```bash
sysctl vm.overcommit_memory=1
```
Without it, Linux refuses a fork that *might* need more memory than is free, and your saves fail silently — which then trips `stop-writes-on-bgsave-error`.
:::

## 1.4 The RDB file format

```
   REDIS0011              magic + version
   ┌──────────────────────────────────────────────┐
   │ AUX fields: redis-ver, redis-bits, ctime,    │
   │             used-mem, aof-preamble           │
   ├──────────────────────────────────────────────┤
   │ 0xFE 00               SELECTDB 0             │
   │ 0xFB <size> <expires> RESIZEDB hint          │
   │   0x00 <key> <value>            a string     │
   │   0xFC <ms> 0x04 <key> <value>  with an expiry│
   │   …                                          │
   │ 0xFE 01               SELECTDB 1             │
   │   …                                          │
   ├──────────────────────────────────────────────┤
   │ 0xFF                  EOF                    │
   │ <8-byte CRC64 checksum>                      │
   └──────────────────────────────────────────────┘
```

Values are stored in their **encoded form** — a listpack hash is written as a listpack blob, not as N field/value pairs. That is why RDB files are compact and load fast: there is little to reconstruct.

```bash
redis-check-rdb /var/lib/redis/dump.rdb     # verify integrity
redis-cli --rdb /backup/dump.rdb            # ask a live server for a snapshot
```

---

# Part 2 — AOF

## 2.1 Configuration

```conf
appendonly yes
appenddirname "appendonlydir"       # Redis 7+: a directory of files
appendfilename "appendonly.aof"

appendfsync everysec         # always | everysec | no
no-appendfsync-on-rewrite no

auto-aof-rewrite-percentage 100     # rewrite when the file is 2× its post-
auto-aof-rewrite-min-size 64mb      # rewrite size, and at least this big

aof-use-rdb-preamble yes            # ← the hybrid format. Keep this on.
aof-timestamp-enabled no            # annotate with timestamps (7.0+), enables
                                    # point-in-time recovery with redis-check-aof
```

## 2.2 `appendfsync` — where your durability guarantee actually lives

This is the most important persistence setting in Redis, and it is a three-way trade.

```
   Your command → Redis's AOF buffer → write() → the OS page cache → fsync() → DISK
                                        ▲                              ▲
                                   fast, in RAM              slow, the real guarantee
```

| Setting | `fsync()` frequency | Worst-case loss | Throughput |
| :--- | :--- | :--- | :--- |
| `always` | Every write command | **0** (essentially) | ~10× slower |
| `everysec` | Once per second, on a **BIO thread** | **≤ 1 second** | ~full speed |
| `no` | Never — the OS decides | **Up to 30 s** (the kernel's dirty-page window) | Fastest |

:::tip[`everysec` is the right answer for almost everyone]
`always` makes every write wait on a physical disk flush. Even on NVMe that is ~0.1–1 ms per write, cutting throughput by an order of magnitude — and you came to Redis for throughput.

`everysec` bounds your loss at one second and costs essentially nothing, because the `fsync` happens on a background BIO thread. **One second of loss is an acceptable trade for the overwhelming majority of workloads that would otherwise use Redis.**

If one second of loss is genuinely unacceptable, the honest answer is that Redis is probably the wrong system for that data — put it in Postgres, and use Redis for the parts that can tolerate loss.
:::

:::warning[The `everysec` edge case]
If a previous `fsync` is still in flight when the next one is due, Redis will delay the `write()` for up to 2 seconds rather than block the main thread — so on a slow or saturated disk your actual loss window is up to **2 seconds**, not 1. `INFO persistence` exposes `aof_delayed_fsync` — a non-zero and growing value means your disk cannot keep up.
:::

## 2.3 AOF rewrite

The AOF grows forever if left alone:

```
   INCR counter        ← 1
   INCR counter        ← 2
   … 1,000,000 times …
   INCR counter        ← 1,000,000

   1 million commands on disk to represent:  SET counter 1000000
```

`BGREWRITEAOF` forks a child that writes a **minimal** AOF representing the current state:

```
   1. fork() a child
   2. The child walks the dataset and writes a compact file
        — with aof-use-rdb-preamble yes, it writes an RDB IMAGE, not commands
   3. Meanwhile the parent keeps serving, buffering new writes in the
      AOF rewrite buffer
   4. When the child finishes, the buffered commands are appended
   5. The new file atomically replaces the old one (rename())
```

Triggered automatically when the file grows to `auto-aof-rewrite-percentage` above its size after the last rewrite (default 100% = doubled), and at least `auto-aof-rewrite-min-size`.

### The hybrid format — the current default and the right choice

```conf
aof-use-rdb-preamble yes
```

```
   appendonly.aof after a rewrite:
   ┌───────────────────────────────────────────────────────┐
   │ REDIS0011 <a full binary RDB image of the dataset>     │  ← compact, fast
   ├───────────────────────────────────────────────────────┤
   │ *3\r\n$3\r\nSET\r\n…    commands since the rewrite     │  ← durable tail
   │ *2\r\n$4\r\nINCR\r\n…                                  │
   └───────────────────────────────────────────────────────┘
```

**You get RDB's compactness and fast loading, with AOF's one-second durability.** There is no reason to disable this.

## 2.4 Multi-part AOF (Redis 7.0+)

Redis 7 replaced the single AOF file with a directory:

```
   appendonlydir/
     appendonly.aof.1.base.rdb      the snapshot (base)
     appendonly.aof.1.incr.aof      commands since the base
     appendonly.aof.manifest        which files are current
```

This removed the old rewrite buffer entirely. Previously, the parent buffered every write during a rewrite in memory and then wrote it all at the end — a memory spike and a latency spike proportional to how long the rewrite took. Now the parent simply keeps appending to a new `incr` file while the child writes the `base`, and the manifest is swapped atomically at the end.

If you are on Redis 7+, this is already how it works and it is strictly better.

## 2.5 Repairing a truncated AOF

A power loss mid-write leaves a partial final command.

```conf
aof-load-truncated yes      # default: log a warning and load what's valid
```

For real corruption in the middle of the file:

```bash
redis-check-aof --fix appendonlydir/appendonly.aof.1.incr.aof
# truncates everything from the first invalid byte onward
```

**Always copy the file before running `--fix`.** It truncates in place and there is no undo.

---

# Part 3 — Choosing and operating

## 3.1 The decision

```
   Can you lose this data entirely?
        │
   ┌────┴─────────────────────────────┐
   YES                                NO
    │                                  │
    │  A PURE CACHE                    │  How much can you lose?
    │  save ""                         │       │
    │  appendonly no                   │  ┌────┴──────────┬─────────────┐
    │  → fastest, zero disk I/O        │  MINUTES      1 SECOND      NEAR ZERO
    │  → a restart means a cold cache; │   │              │              │
    │    make sure your app survives   │  RDB only    RDB + AOF      RDB + AOF
    │    a stampede (see §25)          │  save 300 100  everysec     always
    │                                  │  appendonly no appendonly    ← 10× slower;
    │                                  │  (fast restart) yes           reconsider
    └──────────────────────────────────┴──────────────────────────────  whether
                                                                        Redis is
                                                                        right
```

### The recommended production default

```conf
# durability
appendonly yes
appendfsync everysec
aof-use-rdb-preamble yes
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# ALSO keep RDB — for backups and fast replica sync
save 3600 1
save 300 100
save 60 10000

# memory safety
maxmemory 6gb
maxmemory-policy noeviction        # for a durable instance
stop-writes-on-bgsave-error yes

# latency safety
lazyfree-lazy-expire yes
lazyfree-lazy-eviction yes
lazyfree-lazy-server-del yes
lazyfree-lazy-user-del yes
```

**Run both.** They are not alternatives:

- **AOF** gives you the one-second durability guarantee.
- **RDB** gives you a compact file you can copy off the box for backups, and it is what replicas use for a full sync.

On restart Redis loads the **AOF** when `appendonly yes`, because it is the more complete record.

## 3.2 Backups, properly

```bash
# 1. Ask the server for a fresh snapshot and stream it to you
redis-cli --rdb /backups/redis-$(date +%F-%H%M).rdb

# 2. Or trigger a save and copy the file
redis-cli BGSAVE
while [ "$(redis-cli LASTSAVE)" = "$BEFORE" ]; do sleep 1; done
cp /var/lib/redis/dump.rdb /backups/dump-$(date +%F).rdb

# 3. Ship it somewhere that is not this machine
aws s3 cp /backups/dump-$(date +%F).rdb s3://my-backups/redis/

# 4. Verify — a backup you have never restored is not a backup
redis-check-rdb /backups/dump-$(date +%F).rdb
```

:::tip[Take backups from a replica]
`BGSAVE` on the primary costs a `fork()` stall and copy-on-write memory. A replica has an identical dataset and serves no writes, so saving there is free from the primary's perspective.

```
   primary  ──replicates──►  replica  ──BGSAVE──►  dump.rdb  ──►  S3
   (never forks for backup)  (forks freely, nobody notices)
```
This is standard practice and costs one extra small instance.
:::

**Restoring:**

```bash
systemctl stop redis
cp /backups/dump-2026-09-01.rdb /var/lib/redis/dump.rdb
chown redis:redis /var/lib/redis/dump.rdb
# ⚠ if appendonly is yes, Redis loads the AOF and IGNORES your RDB.
#   Either disable AOF first, or:
systemctl start redis
redis-cli CONFIG SET appendonly no
# ... verify the data ...
redis-cli CONFIG SET appendonly yes    # this triggers a rewrite from memory
```

That AOF-shadows-RDB detail catches people during real recovery, when they can least afford surprises. Practise it once, in advance.

## 3.3 Monitoring

```bash
127.0.0.1:6379> INFO persistence
loading:0                            # 1 = still loading at startup; reads fail
rdb_bgsave_in_progress:0
rdb_last_bgsave_status:ok            # ← alert on "err"
rdb_last_bgsave_time_sec:3
rdb_changes_since_last_save:1523
aof_enabled:1
aof_rewrite_in_progress:0
aof_last_bgrewrite_status:ok         # ← alert on "err"
aof_last_write_status:ok             # ← alert on "err"
aof_delayed_fsync:0                  # ← growing = your disk cannot keep up
aof_current_size:104857600
aof_base_size:52428800
```

| Alert on | Meaning |
| :--- | :--- |
| `rdb_last_bgsave_status:err` | Saves are failing — disk full, permissions, fork failure |
| `aof_last_write_status:err` | Writes are not reaching disk |
| `aof_delayed_fsync` rising | Disk cannot sustain `everysec`; real loss window > 1 s |
| `rdb_last_bgsave_time_sec` rising | The dataset is growing; fork stalls are getting longer |
| `rdb_changes_since_last_save` very high | A long time since the last save — check the `save` rules |

## 3.4 The honest durability statement

Say this precisely, because interviews ask it and production depends on it:

> **Redis with `appendfsync everysec` can lose up to one second of writes** — up to two if the disk is saturated. **Redis with RDB only can lose everything since the last snapshot**, which may be minutes. **Redis with `appendfsync always` loses essentially nothing but runs about ten times slower.**
>
> Replication does not change this, because **replication is asynchronous**: a primary acknowledges a write to the client before the replica has it. A primary that dies immediately after acknowledging loses that write even with replicas. `WAIT numreplicas timeout` lets you block until N replicas confirm, which narrows the window but is not a distributed consensus protocol and does not make Redis a CP system.

That last sentence is the one that separates a confident answer from a hand-wavy one.

---

## Rapid-fire recall

1. What does RDB store versus AOF, and which restarts faster?
2. Explain `fork()` and copy-on-write. What are the two costs?
3. Why do Transparent Huge Pages make persistence dramatically worse?
4. What are the three `appendfsync` settings and the exact loss window of each?
5. Why can `everysec` actually lose two seconds, and which metric tells you?
6. What does `aof-use-rdb-preamble yes` produce, and why is it strictly better?
7. What problem did Redis 7's multi-part AOF solve?
8. `stop-writes-on-bgsave-error yes` — when is it right and when is it an outage?
9. If both RDB and AOF are enabled, which does Redis load on restart, and what does that mean for restoring a backup?
10. Does replication protect you from losing a write? Explain precisely.

<details>
<summary>Answers</summary>

1. RDB stores a binary point-in-time snapshot of the final state; AOF stores a log of every write command. RDB restarts far faster because it deserializes an image instead of re-executing commands.
2. `fork()` gives the child a copy of the page tables, with all pages shared read-only. When either process writes a page, the kernel copies that page. Costs: extra memory (up to 2× worst case) for every page written during the save, and a latency stall of ~10–20 ms per GB while page tables are copied.
3. THP uses 2 MB pages, so a one-byte write copies 2 MB instead of 4 KB — 512× the copy-on-write traffic. Latency spikes go from milliseconds to seconds.
4. `always` (fsync per write, ~0 loss, ~10× slower); `everysec` (fsync once per second on a BIO thread, ≤ 1 s loss, full speed); `no` (the OS decides, up to ~30 s loss, fastest).
5. If the previous fsync is still in flight, Redis delays the write rather than blocking the main thread — up to 2 seconds. `aof_delayed_fsync` in `INFO persistence` counts it.
6. A hybrid file: a compact binary RDB image as the base, followed by a tail of RESP commands. You get RDB's size and load speed with AOF's one-second durability.
7. It removed the in-memory AOF rewrite buffer. The parent now appends to a separate `incr` file while the child writes the `base`, avoiding the memory and latency spike at the end of a rewrite.
8. Right on a durable instance — refuse writes you cannot persist. An outage on a pure cache, where a full disk turns a cosmetic problem into total write rejection; set it to `no` there.
9. It loads the **AOF**. So restoring an RDB backup requires disabling `appendonly` first, or Redis will silently ignore the file you just restored.
10. No, not fully. Replication is asynchronous — the primary acknowledges the client before the replica has the write. `WAIT numreplicas timeout` narrows the window but is not consensus; Redis remains an AP system.

</details>

---

**Next:** [Transactions & Scripting](./17-transactions-and-scripting.md) — `MULTI`/`EXEC`, `WATCH`, Lua, and Functions.
