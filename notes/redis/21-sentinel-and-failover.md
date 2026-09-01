---
title: Sentinel & Automatic Failover
author: Tejas Nirala
---

# Sentinel & Automatic Failover

> **What you will be able to do after this page**
>
> - Deploy a three-Sentinel setup and explain why three, not two.
> - Trace a failover from the first missed `PING` to a repointed client.
> - Explain SDOWN, ODOWN, quorum, and majority — and why quorum ≠ majority.
> - Know Sentinel's honest limits, including the split-brain window.

[Replication](./20-replication.md) ends with six manual steps to fail over. Sentinel automates them. It is Redis's high-availability solution for a **single, unsharded** primary — if you need sharding as well, you want [Cluster](./22-cluster.md).

---

## 1. What Sentinel is

Sentinel is a **separate process** — the same `redis-server` binary in a different mode — that watches your primary and replicas and takes action when the primary dies.

```
   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
   │  SENTINEL 1   │◄─►│  SENTINEL 2   │◄─►│  SENTINEL 3   │
   │  :26379       │   │  :26379       │   │  :26379       │
   └───────┬───────┘   └───────┬───────┘   └───────┬───────┘
           │  monitor          │                   │
           └───────────────────┼───────────────────┘
                               ▼
              ┌────────────────────────────────┐
              │           PRIMARY :6379        │
              └────────────┬───────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
      ┌──────────────┐          ┌──────────────┐
      │  REPLICA 1   │          │  REPLICA 2   │
      └──────────────┘          └──────────────┘

              ▲
              │  clients ask the SENTINELS "who is the primary?"
              │  rather than hardcoding an address
      ┌───────┴────────┐
      │  application   │
      └────────────────┘
```

Its four jobs:

1. **Monitoring** — is the primary reachable? Are the replicas?
2. **Notification** — run a script or emit an event on a state change.
3. **Automatic failover** — promote a replica and reconfigure the others.
4. **Service discovery** — clients ask Sentinel for the current primary's address, so a failover requires no application redeploy.

That fourth one is underrated. Without it, a failover still needs a config change everywhere.

---

## 2. Configuration

```conf
# sentinel.conf
port 26379
sentinel monitor mymaster 10.0.1.10 6379 2
#              └─ name ──┘└─ primary addr ┘└─ QUORUM

sentinel auth-pass mymaster <the primary's password>
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 60000
sentinel parallel-syncs mymaster 1

sentinel notification-script mymaster /opt/notify.sh
sentinel client-reconfig-script mymaster /opt/reconfig.sh
```

| Directive | Meaning |
| :--- | :--- |
| `monitor <name> <ip> <port> <quorum>` | Watch this primary; `quorum` Sentinels must agree it is down |
| `down-after-milliseconds` | No reply for this long → **subjectively** down |
| `failover-timeout` | How long before a stalled failover attempt is abandoned |
| `parallel-syncs` | How many replicas resync from the new primary **simultaneously** |

:::warning[`parallel-syncs 1` is almost always what you want]
Each resyncing replica forks the new primary and streams a full RDB. Setting `parallel-syncs 3` means three simultaneous full syncs off a server that was promoted seconds ago — a network and memory storm at the worst possible moment.

`1` means replicas resync one at a time, so at least some remain available to serve reads throughout. Slower recovery, far safer.
:::

```bash
redis-sentinel /etc/redis/sentinel.conf
# or
redis-server /etc/redis/sentinel.conf --sentinel
```

Sentinel **rewrites its own config file** as topology changes — the `sentinel monitor` line will be updated with a new primary address after a failover, and discovered replicas and sentinels are appended. Do not manage `sentinel.conf` with a configuration tool that overwrites it, and do not be surprised when it changes.

---

## 3. Discovery — Sentinels find each other

You only configure the **primary's** address. Everything else is discovered:

```
   1. Each Sentinel connects to the primary and runs INFO every 10s
      → the INFO reply lists every connected replica
      → Sentinel now monitors those replicas too, automatically

   2. Each Sentinel PUBLISHes to the __sentinel__:hello channel on the
      primary and on every replica, every 2 seconds:
         <sentinel-ip>,<port>,<runid>,<epoch>,<master-name>,<master-ip>,…

   3. Each Sentinel SUBSCRIBEs to __sentinel__:hello
      → it learns about every other Sentinel watching the same primary
      → and about their view of the current configuration
```

So adding a Sentinel means starting it with the primary's address. It finds the replicas and its peers by itself. That is a genuinely nice piece of design — and it uses [Pub/Sub](./12-pubsub.md), which is a good illustration of why Pub/Sub is fine for "state signal, re-read the authority" traffic.

---

## 4. Failure detection: SDOWN → ODOWN

### SDOWN — Subjectively Down

```
   Sentinel 1 PINGs the primary every second.
   No valid reply for `down-after-milliseconds` (5000)?
      → Sentinel 1 marks it +sdown

   "I think it's down." A LOCAL opinion. Might be a network blip
   between this Sentinel and the primary — not the primary being dead.
```

A "valid reply" is `+PONG`, `-LOADING`, or `-MASTERDOWN`. Anything else — including a timeout or a reply from a node that now reports `role:slave` — counts against it.

### ODOWN — Objectively Down

```
   Sentinel 1 asks the others:  SENTINEL is-master-down-by-addr …
      Sentinel 2: "yes, I see it down too"
      Sentinel 3: "yes"

   Count of Sentinels reporting down >= QUORUM ?
      → the primary is marked +odown
      → a failover may begin
```

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  SDOWN  = one Sentinel's opinion.        Never triggers failover. │
   │  ODOWN  = `quorum` Sentinels agree.      This authorizes failover.│
   └──────────────────────────────────────────────────────────────────┘
```

---

## 5. Quorum vs. majority — the distinction people get wrong

**Two different numbers must both be satisfied.**

```
   QUORUM    (you configure it) — how many Sentinels must agree the
                                  primary is DOWN, to reach ODOWN.

   MAJORITY  (automatic)        — how many Sentinels must vote to
                                  AUTHORIZE a specific Sentinel to
                                  perform the failover. Always
                                  floor(N/2) + 1 of ALL known Sentinels.
```

```
   5 Sentinels, quorum = 2

   Scenario: a network partition isolates 2 Sentinels with the primary.

   ┌─── minority side (2 sentinels) ───┐   ┌─── majority side (3) ───┐
   │  S1, S2 can see the primary       │   │  S3, S4, S5             │
   │  they see the OTHER 3 as down     │   │  they see the primary   │
   │                                    │   │  as down → ODOWN (2≥2) │
   │  ODOWN reached? maybe              │   │  MAJORITY? 3 ≥ 3  ✅   │
   │  MAJORITY? 2 < 3  ❌               │   │  → FAILOVER PROCEEDS   │
   │  → CANNOT fail over                │   │                        │
   └────────────────────────────────────┘   └────────────────────────┘

   Only ONE side can act. No split-brain among the Sentinels.
```

:::danger[This is why you need at least THREE Sentinels, on three machines]
With **two** Sentinels, majority = 2. If one Sentinel dies (or is on the same machine as the primary that just died), the survivor **cannot reach majority and cannot fail over**. Your automatic failover does nothing, at exactly the moment you needed it.

With **three** Sentinels, majority = 2, so one can be lost and failover still works.

Rules:
- **Minimum 3 Sentinels**, on **3 separate physical hosts / availability zones**.
- Three Sentinels on one machine protect you from nothing.
- Setting `quorum` to 1 does **not** help — majority is still `floor(N/2)+1` and is not configurable.
- Odd numbers only. Four Sentinels need a majority of 3 — the same fault tolerance as three, at more cost.
:::

**Quorum lower than majority** (e.g. quorum 2 of 5) makes failure *detection* more sensitive while leaving the *authorization* bar unchanged. **Quorum higher than majority** (e.g. quorum 4 of 5) makes detection more conservative — you need more agreement before even trying. Tune quorum for how trigger-happy you want detection to be; you cannot tune away the majority requirement.

---

## 6. A failover, traced end to end

```
   t=0.0s   PRIMARY dies (process crash, host failure, network partition)

   t=0.0-5.0s
            Each Sentinel PINGs every second. No replies.

   t=5.0s   S1: down-after-milliseconds (5000) elapsed
            → +sdown master mymaster 10.0.1.10 6379

   t=5.1s   S1 → S2, S3: SENTINEL is-master-down-by-addr 10.0.1.10 6379 …
            S2: "yes"    S3: "yes"
            2 >= quorum(2)
            → +odown master mymaster

   t=5.2s   LEADER ELECTION (a Raft-like term-based vote)
            S1 increments the config epoch and requests votes.
            Each Sentinel votes for the FIRST requester in that epoch.
            S1 receives 2 votes ≥ majority(2) → S1 is the leader.
            (Ties are broken by a random delay and a retry in a new epoch.)

   t=5.3s   REPLICA SELECTION — the leader ranks candidates:
              1. Discard replicas that are SDOWN, disconnected, or whose
                 last reply is older than 5 × down-after-milliseconds
              2. Sort by replica-priority   (LOWEST wins; 0 = never promote)
              3. Then by replication offset (HIGHEST = most up to date)
              4. Then by run ID             (lexicographically, as a tiebreak)
            → REPLICA 1 selected.

   t=5.4s   S1 → REPLICA 1:  REPLICAOF NO ONE
            REPLICA 1 becomes a primary with a new replication ID.

   t=5.5s   S1 waits for REPLICA 1's INFO to report role:master
            → +promoted-slave, +failover-state-reconf-slaves

   t=5.6s   S1 → REPLICA 2:  REPLICAOF <replica-1-addr> 6379
            (one at a time, per parallel-syncs)

   t=6.0s   S1 → all Sentinels: the new configuration, with the new epoch.
            Every Sentinel updates and REWRITES its sentinel.conf.

   t=6.1s   +switch-master mymaster 10.0.1.10 6379 10.0.1.11 6379
            published on the __sentinel__:hello and +switch-master channels.

   t=6.2s   CLIENTS: ioredis in sentinel mode is subscribed to
            +switch-master. It reconnects to the new primary.
            Writes resume.

   ─────────────────────────────────────────────────────────────────
   TOTAL: ~6 seconds, dominated by down-after-milliseconds.
   ─────────────────────────────────────────────────────────────────

   t=later  The OLD primary comes back.
            Sentinel sends it REPLICAOF <new-primary> — it is demoted.
            ⚠ Any writes it accepted while partitioned are DISCARDED
              when it resyncs.
```

### Tuning the detection window

```conf
sentinel down-after-milliseconds mymaster 5000
```

```
   LOWER (1000ms)   faster failover, but a GC pause, a brief network
                    hiccup, or a slow BGSAVE fork can trigger a
                    spurious failover — which costs you a full
                    resync storm for nothing.

   HIGHER (30000ms) fewer false positives, but 30 seconds of write
                    downtime when the primary genuinely dies.

   5000–10000ms is the usual compromise. Measure your p99.9 latency
   and your GC pause distribution before going below 5000.
```

:::warning[A big `fork()` can look exactly like a dead primary]
A `BGSAVE` on a 30 GB dataset can stall the main thread for close to a second, and on slow virtualized storage, longer. If `down-after-milliseconds` is too aggressive, Sentinel sees missed `PING`s and fails over a perfectly healthy server — causing a full resync storm and real downtime.

This is another argument for taking backups on a replica and keeping instances modestly sized.
:::

---

## 7. The client side

```ts
import Redis from 'ioredis';

export const redis = new Redis({
  sentinels: [
    { host: 'sentinel-1', port: 26379 },
    { host: 'sentinel-2', port: 26379 },
    { host: 'sentinel-3', port: 26379 },
  ],
  name: 'mymaster',                       // ← the monitored primary's name
  sentinelPassword: process.env.SENTINEL_PASSWORD,
  password: process.env.REDIS_PASSWORD,
  role: 'master',                         // 'slave' to read from replicas

  sentinelRetryStrategy: (times) => Math.min(times * 100, 3_000),
  enableOfflineQueue: true,               // queue during the failover window
  commandTimeout: 5_000,
});
```

What the client does:

1. Connects to a Sentinel and runs `SENTINEL get-master-addr-by-name mymaster`.
2. Connects to the returned address.
3. **Subscribes to `+switch-master`** on the Sentinels.
4. On a failover event, reconnects to the new primary automatically.

:::tip[List *all* the Sentinels, and never a single one]
The `sentinels` array is a bootstrap list. If you list one and it is down, your client cannot discover the primary at all — you have moved the single point of failure from Redis to Sentinel. List all three (or more).
:::

:::danger[Writes are lost during the failover window]
```
   t=0     primary dies
   t=0–6s  no primary exists. Writes fail (or queue in the offline queue).
   t=6s    a new primary is live
```

Six seconds of write unavailability, and **any write acknowledged by the old primary but not yet replicated is gone forever** (see [Replication](./20-replication.md) — replication is asynchronous).

Your application must handle this:
- `enableOfflineQueue: true` for caches, so brief blips are invisible.
- **Idempotent retries** for anything important.
- A circuit breaker so you serve a degraded response instead of piling up.
- The real fix for a critical write is: **write to your durable database first, then to Redis.**
:::

---

## 8. Operating Sentinel

```bash
redis-cli -p 26379 SENTINEL masters
redis-cli -p 26379 SENTINEL master mymaster
redis-cli -p 26379 SENTINEL replicas mymaster
redis-cli -p 26379 SENTINEL sentinels mymaster
redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster
redis-cli -p 26379 SENTINEL ckquorum mymaster        # can we actually fail over?
redis-cli -p 26379 SENTINEL failover mymaster        # force one, for testing
redis-cli -p 26379 SENTINEL reset mymaster           # forget & rediscover
redis-cli -p 26379 SENTINEL set mymaster down-after-milliseconds 10000
```

:::tip[`SENTINEL ckquorum` is the health check to run]
```
$ redis-cli -p 26379 SENTINEL ckquorum mymaster
OK 3 usable Sentinels. Quorum and failover authorization can be reached
```
It tells you whether a failover **would actually succeed right now** — both quorum and majority. Run it in monitoring. Discovering that you cannot reach majority *during* an incident is the worst possible time to find out.
:::

Watch the event stream while testing:

```bash
redis-cli -p 26379 PSUBSCRIBE '*'
```

```
+sdown master mymaster 10.0.1.10 6379
+odown master mymaster 10.0.1.10 6379 #quorum 2/2
+try-failover master mymaster …
+vote-for-leader <runid> <epoch>
+elected-leader master mymaster …
+selected-slave slave 10.0.1.11:6379 …
+failover-state-send-slaveof-noone slave …
+promoted-slave slave 10.0.1.11:6379 …
+switch-master mymaster 10.0.1.10 6379 10.0.1.11 6379    ← clients act on this
+slave slave 10.0.1.10:6379 … (the old primary, demoted)
```

**Test your failover before you need it.** `SENTINEL failover mymaster` forces one on demand. Run it in staging, watch your application's behaviour, measure the actual downtime, and confirm your clients reconnect. A failover mechanism that has never been exercised is a failover mechanism that does not work.

---

## 9. Sentinel's honest limits

| Limitation | Detail |
| :--- | :--- |
| **No sharding** | One primary holds everything. Memory and single-core write throughput are your ceiling. Use [Cluster](./22-cluster.md) for that. |
| **Data loss on failover** | Asynchronous replication means acknowledged-but-unreplicated writes are lost. `min-replicas-to-write` bounds it; nothing eliminates it. |
| **A write-unavailability window** | Roughly `down-after-milliseconds` + a few seconds. |
| **Split-brain window** | An isolated old primary keeps accepting writes until it notices it has no replicas. `min-replicas-to-write 1` + `min-replicas-max-lag 10` closes most of it. |
| **Extra processes to run** | Three more nodes to deploy, monitor, and patch. |
| **Client support required** | The client must speak the Sentinel protocol. A plain `new Redis(host)` gains nothing from Sentinel. |
| **Spurious failovers** | An aggressive `down-after-milliseconds` plus a fork stall or GC pause causes failovers you did not need. |

### Sentinel vs. Cluster vs. managed

```
   Do you need to shard (more data than one machine's RAM,
   or more write throughput than one core)?
        │
   ┌────┴────┐
   NO        YES
    │         │
    │      CLUSTER
    │      (sharding + built-in HA, no separate Sentinel processes)
    │
    └─► Do you need automatic failover?
             │
        ┌────┴────┐
       YES        NO
        │          │
    SENTINEL   a plain primary + replica, failed over by hand
    (or a managed service that does this for you — ElastiCache,
     Memorystore, Redis Cloud all provide it, and you should
     strongly consider letting them)
```

**Honest advice:** if you are on a cloud provider, use their managed offering. Sentinel is well-engineered and you should understand it — the concepts here apply directly to how the managed services behave — but running it yourself means three more nodes to operate, patch, and page someone about, in exchange for a feature your provider already offers.

---

## Rapid-fire recall

1. What are Sentinel's four jobs?
2. What is the difference between SDOWN and ODOWN?
3. What is the difference between quorum and majority, and which is configurable?
4. Why is three Sentinels the minimum, and why not two?
5. Does setting `quorum 1` let two Sentinels fail over? Why not?
6. Trace the failover sequence. What dominates the total time?
7. How does Sentinel choose which replica to promote — all four criteria?
8. What is `parallel-syncs` and why is `1` almost always right?
9. What happens to writes accepted by the old primary during a partition?
10. What does `SENTINEL ckquorum` tell you, and why run it continuously?

<details>
<summary>Answers</summary>

1. Monitoring, notification, automatic failover, and service discovery (clients ask Sentinel for the current primary's address).
2. SDOWN is one Sentinel's local opinion that the primary is unreachable. ODOWN is `quorum` Sentinels agreeing — only ODOWN authorizes a failover attempt.
3. Quorum is how many Sentinels must agree the primary is down (configurable). Majority is how many must vote to authorize a specific Sentinel to run the failover — always `floor(N/2)+1` of all known Sentinels, and **not** configurable.
4. With two, majority is 2; losing one leaves the survivor unable to authorize a failover. With three, majority is 2, so one can be lost. They must be on three separate hosts.
5. No. Quorum only affects failure *detection*. Authorization still needs `floor(N/2)+1 = 2` of 2, so losing one Sentinel still blocks the failover.
6. PING failures → SDOWN at `down-after-milliseconds` → ODOWN at quorum → leader election → replica selection → `REPLICAOF NO ONE` → reconfigure other replicas → `+switch-master` → clients reconnect. Total time is dominated by `down-after-milliseconds`.
7. Discard unreachable/stale replicas; then lowest `replica-priority` (0 means never); then highest replication offset; then lowest run ID as a tiebreak.
8. How many replicas resync from the new primary simultaneously. `1` avoids several concurrent full syncs forking a just-promoted server, and keeps some replicas serving reads throughout.
9. They are discarded when it rejoins and is demoted to a replica — it resyncs from the new primary. `min-replicas-to-write` bounds this by refusing writes when no replica is reachable.
10. Whether a failover would actually succeed right now — both quorum and majority are reachable. Running it continuously means you learn you cannot fail over *before* the incident, not during it.

</details>

---

**Next:** [Redis Cluster](./22-cluster.md) — sharding across nodes, hash slots, and the `CROSSSLOT` error that will change how you name keys.
