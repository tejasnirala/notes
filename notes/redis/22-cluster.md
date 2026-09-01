---
title: Redis Cluster
author: Tejas Nirala
---

# Redis Cluster

> **What you will be able to do after this page**
>
> - Explain the 16,384 hash slots and why that number.
> - Fix a `CROSSSLOT` error, and design keys so you never see one.
> - Trace `MOVED` and `ASK` redirection and say precisely how they differ.
> - Decide honestly whether you need Cluster at all.

Cluster is Redis's horizontal scaling solution: the keyspace is split across many primaries, each with its own replicas, with automatic failover built in — no separate Sentinel processes.

---

## 1. The architecture

```
      ┌──────────── 16,384 HASH SLOTS ────────────┐
      │  0 ─────── 5460 │ 5461 ─── 10922 │ 10923 ─── 16383 │
      └────────┬────────┴───────┬────────┴────────┬────────┘
               ▼                ▼                 ▼
       ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
       │  PRIMARY A   │  │  PRIMARY B   │  │  PRIMARY C   │
       │  :7000       │  │  :7001       │  │  :7002       │
       └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
              │                 │                 │
       ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐
       │  REPLICA A'  │  │  REPLICA B'  │  │  REPLICA C'  │
       │  :7003       │  │  :7004       │  │  :7005       │
       └──────────────┘  └──────────────┘  └──────────────┘

       All nodes gossip over the CLUSTER BUS (port 6379 + 10000 = 16379)
       Every node knows the full slot→node map.
```

- **Every key maps to exactly one of 16,384 slots.** Slots are assigned to primaries.
- **Every node knows the whole map**, so a client can be redirected from any node to the right one.
- **No proxy.** Clients hold the map themselves and connect directly to the right node — one hop, no extra latency.
- **Minimum viable cluster: 3 primaries.** With replicas for HA: 6 nodes.

---

## 2. Key → slot

```
   slot = CRC16(key) mod 16384
```

```bash
127.0.0.1:7000> CLUSTER KEYSLOT user:1042
(integer) 5798
127.0.0.1:7000> CLUSTER KEYSLOT foo
(integer) 12182
```

:::note[Why 16,384 and not 65,536?]
Every node broadcasts its slot assignment as a **bitmap** in every gossip heartbeat.

```
   16,384 slots → 16384/8 = 2 KB per heartbeat
   65,536 slots → 65536/8 = 8 KB per heartbeat
```

antirez's reasoning: heartbeats are sent constantly between every pair of nodes, so an 8 KB header would waste real bandwidth — and Redis Cluster was never designed for more than about 1,000 nodes, for which 16,384 slots gives ample granularity (16 slots per node at 1,000 nodes). 2 KB was the right trade. It is a favourite interview question precisely because the answer is a concrete engineering trade-off, not a magic number.
:::

### Hash tags — forcing co-location

If a key contains `{...}`, **only the text inside the first non-empty pair of braces is hashed**:

```bash
127.0.0.1:7000> CLUSTER KEYSLOT user:1042:profile
(integer) 5798
127.0.0.1:7000> CLUSTER KEYSLOT user:1042:sessions
(integer) 11298                     ← a DIFFERENT node!

127.0.0.1:7000> CLUSTER KEYSLOT {user:1042}:profile
(integer) 5798
127.0.0.1:7000> CLUSTER KEYSLOT {user:1042}:sessions
(integer) 5798                      ← same slot, same node ✅
```

```
   Hash tag rules:
     {user:1042}:profile      → hash "user:1042"
     prefix:{1042}:suffix     → hash "1042"
     {}:key                   → empty braces are IGNORED; hash the whole key
     {a}{b}:key               → hash "a" (the FIRST non-empty pair)
     key{a                    → no closing brace; hash the whole key
```

:::tip[Design your keys with hash tags before you need Cluster]
Adding braces to a live keyspace is a migration — every key has to be rewritten, and reads must handle both formats during the transition. Adding them on day one is free.

**The rule: put a hash tag around whatever your multi-key operations group by.**

```
   {user:1042}:profile     {user:1042}:sessions     {user:1042}:feed
   {order:9981}:items      {order:9981}:payment
   {room:7}:messages       {room:7}:presence
```

Now `MGET`, `MULTI`, Lua scripts, and `SUNION` all work across those keys.
:::

:::danger[Do not over-tag]
```
   ❌ {tenant:acme}:user:1  {tenant:acme}:user:2  … {tenant:acme}:user:5000000
```
Every key for that tenant lands on **one node**. You have re-created a single-node bottleneck inside your cluster: one node holds all the data and all the traffic while the others idle. This is a **hot slot**, and it is the most common Cluster design mistake.

Tag at the granularity of your *transactions*, not your *tenants*.
:::

---

## 3. `MOVED` and `ASK` — the redirection protocol

### `MOVED` — a permanent reassignment

```bash
# a client with a stale or empty map asks the wrong node
127.0.0.1:7000> GET user:1042
(error) MOVED 5798 127.0.0.1:7001
#              │    └─ go here
#              └─ this slot
```

The client should **update its cached slot map** and retry against 7001. `MOVED` means "slot 5798 lives there now, permanently."

```bash
redis-cli -c -p 7000        # -c makes the CLI follow redirections
127.0.0.1:7000> GET user:1042
-> Redirected to slot [5798] located at 127.0.0.1:7001
"Ada"
```

### `ASK` — a temporary, one-shot redirect during migration

While a slot is being moved from node A to node B, keys are migrated one at a time. Some are already on B; the rest are still on A.

```
   Slot 5798 is MIGRATING from A to B.

   Client asks A for key "user:1042":
     A: do I still have it?
        YES → serve it normally
        NO  → -ASK 5798 <B's address>
                "this specific key has already moved; ask B THIS ONCE.
                 Do NOT update your slot map — the slot is still mine."

   The client must then send to B:
        ASKING            ← a one-command permission flag
        GET user:1042
```

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │  MOVED   permanent   → UPDATE the slot map, retry                    │
   │  ASK     temporary   → do NOT update the map; send ASKING + retry     │
   │                        just this one command to the named node        │
   └──────────────────────────────────────────────────────────────────────┘
```

Without the `ASKING` flag, node B would reply `MOVED` back to A — because B does not own the slot yet — and the client would ping-pong forever. `ASKING` says "I know you do not own this slot; I was sent here; serve it anyway, once."

**A cluster-aware client handles all of this invisibly.** If you see raw `MOVED` errors in your application logs, your client is not in cluster mode:

```ts
// ❌ a plain client against a cluster — works for some keys, MOVED for others
const redis = new Redis('redis://node-1:6379');

// ✅
const cluster = new Redis.Cluster([
  { host: 'node-1', port: 6379 },
  { host: 'node-2', port: 6379 },
  { host: 'node-3', port: 6379 },
]);
```

---

## 4. What Cluster takes away

This is the section that decides whether Cluster is right for you.

### `CROSSSLOT` — multi-key commands must stay in one slot

```bash
127.0.0.1:7000> MGET user:1 user:2
(error) CROSSSLOT Keys in request don't hash to the same slot

127.0.0.1:7000> MGET {group1}:user:1 {group1}:user:2
1) "Ada"  2) "Bob"                    ✅
```

Affected: `MGET`, `MSET`, `SUNION`/`SINTER`/`SDIFF`, `ZUNIONSTORE`, `SMOVE`, `RENAME`, `BITOP`, `PFMERGE`, `LMOVE`, `MULTI` spanning slots, and any Lua script whose `KEYS` span slots.

```ts
// ioredis Cluster splits a PIPELINE across nodes automatically…
const pipe = cluster.pipeline();
for (const id of ids) pipe.get(`user:${id}`);
const results = await pipe.exec();          // ✅ works across slots

// …but it CANNOT split a single multi-key command
await cluster.mget(...ids.map((id) => `user:${id}`));   // ❌ CROSSSLOT
```

**The practical fix is usually a pipeline instead of `MGET`.** You lose a little efficiency (N commands instead of 1) and keep the single round trip.

### The other restrictions

| Restriction | Detail |
| :--- | :--- |
| **Only database 0** | `SELECT 1` is an error. Any code using numbered DBs must be rewritten. |
| **No cross-slot transactions** | `MULTI` must stay within one slot. Use hash tags. |
| **Lua `KEYS` must share a slot** | And every key must be **declared** in `KEYS` — a key built from `ARGV` is invisible to the router and silently reads the wrong node. |
| **`KEYS`/`SCAN` are per-node** | You must iterate every primary yourself to scan the whole keyspace. |
| **Pub/Sub is broadcast to all nodes** | Use `SPUBLISH`/`SSUBSCRIBE` ([sharded Pub/Sub](./12-pubsub.md)) instead. |
| **`WATCH` is fragile** | Cross-slot watches give no guarantees. Prefer Lua. |
| **Bigger client footprint** | The client holds connections to every node and a slot map to refresh. |

---

## 5. Setting one up

```bash
# 6 nodes: 3 primaries + 3 replicas
for port in 7000 7001 7002 7003 7004 7005; do
  mkdir -p /data/$port
  cat > /data/$port/redis.conf <<EOF
port $port
cluster-enabled yes
cluster-config-file nodes-$port.conf
cluster-node-timeout 15000
appendonly yes
dir /data/$port
EOF
  redis-server /data/$port/redis.conf --daemonize yes
done

# create the cluster: the first 3 become primaries, the rest replicas
redis-cli --cluster create \
  127.0.0.1:7000 127.0.0.1:7001 127.0.0.1:7002 \
  127.0.0.1:7003 127.0.0.1:7004 127.0.0.1:7005 \
  --cluster-replicas 1
```

```conf
cluster-enabled yes
cluster-config-file nodes.conf         # Redis MANAGES this — do not edit it
cluster-node-timeout 15000             # ms before a node is considered failing
cluster-replica-validity-factor 10     # a stale replica won't be promoted
cluster-migration-barrier 1            # keep ≥1 replica before donating one
cluster-require-full-coverage yes      # ← see the warning below
cluster-allow-replica-migration yes
```

:::warning[`cluster-require-full-coverage` is a real availability decision]
`yes` (the default): if **any** slot is unassigned — one shard is entirely down — the **whole cluster** refuses all reads and writes with `CLUSTERDOWN`.

`no`: the surviving shards keep serving their own slots; only keys on the dead shard fail.

`yes` is the consistent choice ("either the whole dataset is available or none of it"). `no` is usually the *practical* choice for a cache, where serving two-thirds of your traffic beats serving none of it.

Choose deliberately. The default failing your entire site because one shard lost both its nodes surprises people.
:::

### Inspection

```bash
redis-cli --cluster check 127.0.0.1:7000
redis-cli --cluster info 127.0.0.1:7000
redis-cli -p 7000 CLUSTER INFO
redis-cli -p 7000 CLUSTER NODES
redis-cli -p 7000 CLUSTER SHARDS          # Redis 7+, the modern view
redis-cli -p 7000 CLUSTER SLOTS           # older equivalent
redis-cli -p 7000 CLUSTER MYID
redis-cli -p 7000 CLUSTER COUNTKEYSINSLOT 5798
redis-cli -p 7000 CLUSTER GETKEYSINSLOT 5798 10
```

```bash
127.0.0.1:7000> CLUSTER INFO
cluster_enabled:1
cluster_state:ok                     # ← "fail" means slots are uncovered
cluster_slots_assigned:16384         # ← must be 16384
cluster_slots_ok:16384
cluster_slots_pfail:0
cluster_slots_fail:0
cluster_known_nodes:6
cluster_size:3                       # number of primaries serving slots
```

The two lines to alert on: **`cluster_state:ok`** and **`cluster_slots_assigned:16384`**.

---

## 6. Resharding and scaling

```bash
# add a new primary
redis-cli --cluster add-node 127.0.0.1:7006 127.0.0.1:7000

# give it slots (moving live data)
redis-cli --cluster reshard 127.0.0.1:7000 \
  --cluster-from <src-node-ids> \
  --cluster-to <new-node-id> \
  --cluster-slots 4096 \
  --cluster-yes

# rebalance automatically
redis-cli --cluster rebalance 127.0.0.1:7000 --cluster-use-empty-masters

# add a replica for an existing primary
redis-cli --cluster add-node 127.0.0.1:7007 127.0.0.1:7000 \
  --cluster-slave --cluster-master-id <primary-id>

# remove a node — reshard its slots away FIRST
redis-cli --cluster del-node 127.0.0.1:7000 <node-id>
```

Resharding is **live** — the cluster serves traffic throughout, using `ASK` redirection for keys in flight. It is genuinely one of the better-engineered parts of Redis. But:

:::warning[Resharding a large slot is not free]
Keys are migrated with `MIGRATE`, which **serializes, transfers, and deletes** each key — synchronously on both nodes. A slot containing one 500 MB key blocks both the source and destination while it moves.

Combined with the hot-slot problem: an over-tagged keyspace produces slots too large to migrate smoothly, which means you cannot rebalance the thing that most needs rebalancing. Another reason not to over-tag.
:::

---

## 7. Failover in Cluster

There are no Sentinel processes — **the nodes do it themselves.**

```
   t=0        PRIMARY B stops responding.

   t=0–15s    Other nodes ping it over the cluster bus. No PONG.

   t=15s      cluster-node-timeout elapsed.
              Node A marks B as PFAIL (possible failure) — a local view,
              exactly like Sentinel's SDOWN.

   t=15.1s    Nodes gossip their PFAIL reports in heartbeats.
              When a MAJORITY OF PRIMARIES report B as PFAIL,
              it is promoted to FAIL and broadcast cluster-wide.
              (Only primaries with slots vote — replicas do not.)

   t=15.2s    B's replicas notice B is FAIL.
              Each waits a rank-based delay:
                 delay = 500ms + random(0..500ms)
                       + (replica_rank × 1000ms)
              Rank is by replication offset — the MOST up-to-date
              replica has rank 0 and therefore campaigns FIRST.

   t=15.7s    B' requests votes from all primaries in a new epoch.
              A majority of primaries vote for it.

   t=15.8s    B' promotes itself, claims B's slots, and broadcasts
              the new configuration with a higher config epoch.
              Higher epoch always wins conflicts.

   t=16s      Clients receive MOVED and update their slot maps.

   ─────────────────────────────────────────────────────────────
   TOTAL ≈ cluster-node-timeout + ~1s
   ─────────────────────────────────────────────────────────────
```

:::danger[A shard with no surviving replica takes its slots down]
If primary B and replica B' both die, slots 5461–10922 have **no owner**. With `cluster-require-full-coverage yes`, the entire cluster returns `CLUSTERDOWN` — including nodes A and C which are perfectly healthy.

Mitigations:
- **`cluster-allow-replica-migration yes`** (default) lets a spare replica from a shard with two replicas migrate to cover an orphaned primary. This is genuinely useful and worth understanding.
- Spread primaries and their replicas across **availability zones**, never on the same host or rack.
- Set `cluster-require-full-coverage no` for caches.
:::

**A majority of primaries must be reachable for any failover to happen.** This is why the minimum is 3 primaries: with 2, losing one leaves no majority and the cluster is stuck.

---

## 8. The client

```ts
import Redis from 'ioredis';

export const cluster = new Redis.Cluster(
  [
    { host: 'node-1', port: 6379 },
    { host: 'node-2', port: 6379 },
    { host: 'node-3', port: 6379 },
  ],
  {
    redisOptions: {
      password: process.env.REDIS_PASSWORD,
      commandTimeout: 5_000,
    },
    scaleReads: 'slave',              // 'master' | 'slave' | 'all' | a function
    maxRedirections: 16,
    retryDelayOnFailover: 200,
    retryDelayOnClusterDown: 500,
    clusterRetryStrategy: (times) => Math.min(times * 100, 3_000),
    enableOfflineQueue: true,
    slotsRefreshTimeout: 2_000,
    slotsRefreshInterval: 5_000,
  },
);
```

`scaleReads: 'slave'` sends reads to replicas — more throughput, at the cost of [stale reads](./20-replication.md). Keep it `'master'` for anything a user reads immediately after writing.

```ts
// scanning the whole keyspace requires visiting every primary
async function scanCluster(pattern: string): Promise<string[]> {
  const found: string[] = [];

  await Promise.all(
    cluster.nodes('master').map(async (node) => {
      let cursor = '0';
      do {
        const [next, keys] = await node.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        found.push(...keys);
      } while (cursor !== '0');
    }),
  );

  return found;
}
```

---

## 9. Do you actually need Cluster?

:::tip[Almost certainly not yet]
A single Redis node handles:
- **~100,000+ ops/sec** on one core (over 1,000,000 with pipelining)
- **Hundreds of gigabytes** of RAM on a large instance
- Read scaling via replicas, with no Cluster complexity at all

Reach for Cluster only when you have measured one of:

```
   1. Your dataset genuinely exceeds the RAM of the largest
      instance you can buy.
   2. Your WRITE throughput exceeds one core. (Reads scale
      with replicas — check this before assuming.)
   3. You need the blast radius of a single node failure to be
      a fraction of your data rather than all of it.
```

The costs are real and permanent: `CROSSSLOT` shapes your entire key design, only db 0, no cross-slot transactions, per-node `SCAN`, hot slots, resharding operations, and a much larger operational surface.

**Try these first, in order:** a bigger instance → read replicas → application-level sharding across several independent Redis instances → *then* Cluster.

Application-level sharding is underrated: pick the instance by `hash(userId) % N` in your code. You keep full command support per instance and you give up automatic rebalancing and failover — which, if you are already on a managed service, you may not be giving up at all.
:::

### Comparison

| | **Single** | **Sentinel** | **Cluster** |
| :--- | :--- | :--- | :--- |
| Sharding | ❌ | ❌ | ✅ |
| Auto failover | ❌ | ✅ | ✅ |
| Multi-key commands | ✅ all | ✅ all | ⚠ same slot only |
| Multiple databases | ✅ | ✅ | ❌ db 0 only |
| Extra processes | none | 3 Sentinels | none |
| Min nodes for HA | 2 | 2 + 3 Sentinels | 6 |
| Client complexity | trivial | moderate | high |
| Operational weight | low | medium | **high** |

---

## Rapid-fire recall

1. How many hash slots, how is a key's slot computed, and why that number?
2. What does `{...}` do in a key name, and what is hashed in `a{b}{c}:d`?
3. What is a hot slot and what causes it?
4. `MOVED` vs `ASK` — what should the client do differently for each?
5. What does the `ASKING` command exist to prevent?
6. Name five things Cluster takes away.
7. `MGET` across users fails with `CROSSSLOT`. Two fixes?
8. What does `cluster-require-full-coverage yes` do when one shard dies?
9. Trace a Cluster failover. Which nodes vote, and how is the replica chosen?
10. What three things should you try before reaching for Cluster?

<details>
<summary>Answers</summary>

1. 16,384. `CRC16(key) mod 16384`. The slot assignment is broadcast as a bitmap in every gossip heartbeat — 16,384 slots is 2 KB, 65,536 would be 8 KB, and the cluster was never designed beyond ~1,000 nodes.
2. Only the text inside the first non-empty brace pair is hashed, forcing keys onto the same slot. `a{b}{c}:d` hashes `b`.
3. All the traffic and data for one slot landing on one node — usually caused by over-tagging (e.g. tagging by tenant instead of by transaction unit), which also makes that slot too large to reshard smoothly.
4. `MOVED` is permanent: update the cached slot map and retry. `ASK` is a one-shot redirect during migration: do **not** update the map, send `ASKING` followed by the command to the named node.
5. Ping-ponging. The target node does not own the slot yet, so without `ASKING` it would reply `MOVED` back to the source node, forever.
6. Multi-key commands across slots (`CROSSSLOT`), databases other than 0, cross-slot transactions and `WATCH`, cluster-wide `SCAN`/`KEYS` (you must visit every primary), and efficient plain Pub/Sub (use sharded Pub/Sub).
7. Add a hash tag so the keys share a slot, or use `cluster.pipeline()` — ioredis splits a pipeline across nodes automatically, giving one round trip without the slot constraint.
8. The entire cluster refuses all commands with `CLUSTERDOWN`, including healthy shards. Set it to `no` for a cache so surviving shards keep serving.
9. Nodes mark the primary PFAIL after `cluster-node-timeout`, gossip it, and a **majority of slot-owning primaries** promote it to FAIL. Its replicas then campaign after a rank-based delay — rank is by replication offset, so the most up-to-date replica campaigns first — and needs a majority of primaries' votes.
10. A bigger instance; read replicas (reads scale without Cluster); application-level sharding across independent instances.

</details>

---

**Next:** [Security](./23-security.md) — ACLs, TLS, and why an unprotected Redis on the internet is compromised within minutes.
