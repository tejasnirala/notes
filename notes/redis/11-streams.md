---
title: Streams
author: Tejas Nirala
---

# Streams

> **What you will be able to do after this page**
>
> - Explain how a Stream differs from a List and from Pub/Sub, in one sentence each.
> - Build a consumer group with acknowledgement, retries, and crash recovery.
> - Read the Pending Entries List and reclaim work from a dead consumer.
> - Decide honestly between Redis Streams and Kafka.

A Stream is an **append-only log of entries**, each with an auto-generated ID and a set of field/value pairs. Added in Redis 5.0, it is the most sophisticated type in Redis and the answer to "how do I do reliable messaging without Kafka?"

---

## 1. The mental model

```
   key "events:orders"

   ┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
   │ 1756742400000-0  │ 1756742400000-1  │ 1756742401234-0  │ 1756742405000-0  │
   ├──────────────────┼──────────────────┼──────────────────┼──────────────────┤
   │ type: created    │ type: paid       │ type: shipped    │ type: delivered  │
   │ order: 9981      │ order: 9981      │ order: 9981      │ order: 9981      │
   │ amount: 4999     │ txn: t_abc       │ courier: bd      │                  │
   └──────────────────┴──────────────────┴──────────────────┴──────────────────┘
         ▲                                                          ▲
       oldest                                                     newest
       (never overwritten — entries are IMMUTABLE)

     ID format:  <milliseconds-since-epoch> - <sequence-within-that-ms>
                 monotonically increasing, always
```

Three properties that define everything else:

1. **Entries persist after being read.** Unlike a List pop, reading does not consume. Ten independent consumers can each read the entire history.
2. **IDs are ordered and unique.** Every consumer can record "I have processed up to ID X" and resume from there.
3. **The server tracks delivery state.** With consumer groups, Redis remembers which entries were delivered to whom and which were acknowledged — that is what makes reliable processing possible without you building it.

### How it compares

| | **List** | **Pub/Sub** | **Stream** |
| :--- | :--- | :--- | :--- |
| Message retained after read | ❌ popped | ❌ discarded instantly | ✅ until trimmed |
| Multiple independent consumers | ❌ one takes it | ✅ all receive | ✅ both models |
| Consumer offline → gets it later | ✅ waits in the list | ❌ **lost forever** | ✅ read history |
| Acknowledgement | ❌ build it yourself | ❌ | ✅ built in |
| Retry on consumer crash | ❌ build it yourself | ❌ | ✅ `XAUTOCLAIM` |
| Replay history | ❌ | ❌ | ✅ `XRANGE` |
| Work distribution across a pool | ✅ (naturally) | ❌ | ✅ consumer groups |
| Memory per message | low | zero | moderate (state is tracked) |

**One sentence each:** a List is a queue you destroy as you read; Pub/Sub is a broadcast you must be present for; a Stream is a log you can re-read, with the server tracking who has processed what.

---

## 2. Writing: `XADD`

```bash
XADD key [NOMKSTREAM] [MAXLEN|MINID [=|~] threshold [LIMIT n]] <*|id> field value [field value ...]
```

```bash
127.0.0.1:6379> XADD events:orders * type created order 9981 amount 4999
"1756742400123-0"                  ← the auto-generated ID

127.0.0.1:6379> XADD events:orders * type paid order 9981
"1756742400123-1"                  ← same millisecond → sequence increments

127.0.0.1:6379> XLEN events:orders
(integer) 2
```

- `*` means "generate the ID from the current time". Use it essentially always.
- An explicit ID must be **strictly greater** than the last one, or you get `ERR The ID specified in XADD is equal or smaller than the target stream top item`.
- `NOMKSTREAM` means "don't create the stream if it doesn't exist" — returns `nil` instead.
- Fields are flat strings, exactly like a Hash. **No nesting.** Serialize complex payloads into one field.

### Capping — do this from day one

```bash
XADD s MAXLEN 1000 * f v       # EXACT: keep at most 1000 entries
XADD s MAXLEN ~ 1000 * f v     # APPROXIMATE: keep at least 1000, trim when cheap
XADD s MINID ~ 1756742400000 * f v   # drop entries older than this ID/timestamp
XTRIM s MAXLEN ~ 1000          # trim without adding
XTRIM s MINID ~ <ts> LIMIT 100 # bound the work done in one call
```

:::tip[Always use `~`]
Exact `MAXLEN` forces Redis to remove entries one at a time, potentially splitting a radix-tree node — O(N) work on the main thread on every single `XADD`.

`MAXLEN ~ 1000` lets Redis stop trimming at a node boundary. It removes whole macro-nodes at once, so the stream might hold 1,000–1,100 entries instead of exactly 1,000, and the cost drops to nearly zero. **You almost never care about the exact count, and you always care about latency.**

`MINID ~ <timestamp>` is often the better policy anyway: "keep 24 hours of events" is a more meaningful bound than "keep 100,000 events", because it does not depend on traffic volume.
:::

**A stream without a cap grows forever.** This is the number one way Streams kill an instance — Redis will not trim for you.

---

## 3. Reading without a group

### `XRANGE` / `XREVRANGE` — query the log

```bash
XRANGE key start end [COUNT n]
XREVRANGE key end start [COUNT n]
```

```bash
127.0.0.1:6379> XRANGE events:orders - +
1) 1) "1756742400123-0"
   2) 1) "type"  2) "created"  3) "order"  4) "9981"  5) "amount"  6) "4999"
2) 1) "1756742400123-1"
   2) 1) "type"  2) "paid"     3) "order"  4) "9981"

127.0.0.1:6379> XREVRANGE events:orders + - COUNT 1     # the newest entry
127.0.0.1:6379> XRANGE events:orders 1756742400000 1756742500000   # a time window
127.0.0.1:6379> XRANGE events:orders (1756742400123-0 + COUNT 10   # exclusive: paginate
```

- `-` and `+` are the minimum and maximum possible IDs.
- **A bare millisecond works as an ID** — `XRANGE s 1756742400000 1756742500000` is a time-range query, because IDs are timestamp-prefixed. That is genuinely useful and unique to Streams.
- `(` makes a bound exclusive — the correct way to paginate: pass the last ID you saw.

### `XREAD` — tail the log

```bash
XREAD [COUNT n] [BLOCK ms] STREAMS key [key ...] id [id ...]
```

```bash
# everything after a known ID
XREAD COUNT 10 STREAMS events:orders 1756742400123-0

# block until something NEW arrives.  "$" = "only entries added from now on"
XREAD BLOCK 0 STREAMS events:orders $

# tail several streams at once
XREAD BLOCK 5000 STREAMS orders payments $ $
```

```ts
// a tailing consumer — the fan-out / "every consumer sees everything" model
let lastId = '$';

for (;;) {
  const res = await redis.xread('BLOCK', 0, 'COUNT', 100, 'STREAMS', 'events:orders', lastId);
  if (!res) continue;                              // timeout

  for (const [, entries] of res) {
    for (const [id, fields] of entries) {
      await handle(id, toObject(fields));
      lastId = id;                                 // ← YOU track the offset
    }
  }
}

// XREAD returns fields as a flat array: ['type','created','order','9981']
const toObject = (flat: string[]): Record<string, string> =>
  Object.fromEntries(flat.reduce<[string, string][]>(
    (acc, v, i) => (i % 2 ? acc : [...acc, [v, flat[i + 1]]]), []));
```

:::warning[`$` and the gap it creates]
`$` means "entries added after this call blocks". If your consumer crashes and restarts with `$`, **every entry produced while it was down is skipped**. There is no gap detection.

For fan-out consumers you must persist `lastId` yourself (in Redis, in a database, anywhere durable) and resume from it. Or — better — use a consumer group, where Redis persists the offset for you. That is the main reason consumer groups exist.
:::

---

## 4. Consumer groups — the real feature

A consumer group lets **a pool of workers share the work** of one stream, with the server tracking delivery and acknowledgement.

```
                   stream "events:orders"
   ┌────┬────┬────┬────┬────┬────┬────┬────┬────┐
   │ e1 │ e2 │ e3 │ e4 │ e5 │ e6 │ e7 │ e8 │ e9 │
   └────┴────┴────┴────┴────┴────┴────┴────┴────┘
       │                                    │
       ├─ group "billing" ──────────────────┤   last-delivered-id: e9
       │    consumer-A  → e1, e4, e7        │   each entry goes to
       │    consumer-B  → e2, e5, e8        │   EXACTLY ONE consumer
       │    consumer-C  → e3, e6, e9        │   in the group
       │
       └─ group "analytics" ────────────────┤   last-delivered-id: e9
            consumer-X  → e1..e9                an INDEPENDENT cursor:
                                                this group sees everything too
```

Two levels of fan-out at once:

- **Across groups:** every group receives every entry. `billing` and `analytics` both see all nine.
- **Within a group:** each entry goes to exactly one consumer. That is load balancing.

This is precisely Kafka's consumer-group model, and the vocabulary maps directly.

### Setting up

```bash
XGROUP CREATE key groupname <id|$> [MKSTREAM] [ENTRIESREAD n]
XGROUP CREATECONSUMER key group consumer
XGROUP DELCONSUMER key group consumer
XGROUP DESTROY key group
XGROUP SETID key group <id|$> [ENTRIESREAD n]
```

```bash
# start from the beginning of history
XGROUP CREATE events:orders billing 0 MKSTREAM

# start from now, ignoring history
XGROUP CREATE events:orders billing $ MKSTREAM
```

`MKSTREAM` creates the stream if it does not exist — without it you get `ERR The XGROUP subcommand requires the key to exist`, which is the first error everyone hits.

### Consuming

```bash
XREADGROUP GROUP group consumer [COUNT n] [BLOCK ms] [NOACK] STREAMS key [key…] <>|id
XACK key group id [id ...]
```

The special ID `>` means **"entries never delivered to any consumer in this group"**. Any other ID means "my own pending entries, from that ID onward" — which is how you recover after a restart.

```ts
const STREAM = 'events:orders';
const GROUP = 'billing';
const CONSUMER = `worker-${process.pid}`;

async function ensureGroup(): Promise<void> {
  try {
    await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM');
  } catch (err) {
    if (!String(err).includes('BUSYGROUP')) throw err;   // already exists — fine
  }
}

async function consume(): Promise<void> {
  await ensureGroup();

  for (;;) {
    const res = await redis.xreadgroup(
      'GROUP', GROUP, CONSUMER,
      'COUNT', 10,
      'BLOCK', 5000,
      'STREAMS', STREAM, '>',            // only new, undelivered entries
    );
    if (!res) continue;

    for (const [, entries] of res as [string, [string, string[]][]][]) {
      for (const [id, fields] of entries) {
        try {
          await handle(toObject(fields));
          await redis.xack(STREAM, GROUP, id);       // ← ONLY on success
        } catch (err) {
          // do NOT ack — the entry stays pending and will be reclaimed
          log.error({ err, id }, 'handler failed');
        }
      }
    }
  }
}
```

`BUSYGROUP` on `XGROUP CREATE` means the group already exists — every worker calls `CREATE` on startup and all but the first get this error. Swallowing it specifically (not all errors) is the correct idiom.

---

## 5. The Pending Entries List — the heart of reliability

When `XREADGROUP` delivers an entry, Redis records it in the group's **PEL**:

```
   PEL for group "billing"
   ┌──────────────────┬─────────────┬────────────────────┬──────────────┐
   │ entry ID         │ consumer    │ delivery time      │ delivery cnt │
   ├──────────────────┼─────────────┼────────────────────┼──────────────┤
   │ 1756742400123-0  │ worker-A    │ 1756742400200      │      1       │
   │ 1756742400123-1  │ worker-B    │ 1756742400210      │      1       │
   │ 1756742401000-0  │ worker-A    │ 1756742350000      │      3       │  ← stuck!
   └──────────────────┴─────────────┴────────────────────┴──────────────┘

   XACK removes the row.  No XACK → it stays forever, available for reclaim.
```

```
   THE LIFECYCLE OF ONE ENTRY

   XADD ──► in the stream, not delivered
              │
              │ XREADGROUP … >
              ▼
        DELIVERED, in the PEL, owned by worker-A ──────┐
              │                                        │
    ┌─────────┴──────────┐                             │ worker-A dies
    │                    │                             ▼
  XACK               handler                  idle time grows past
    │                 throws                  min-idle-time
    ▼                    │                             │
 removed from            │                     XAUTOCLAIM / XCLAIM
 the PEL                 └────────────────────────────►│
 (DONE)                        stays pending           ▼
                                              reassigned to worker-B,
                                              delivery-count++
                                                       │
                                     count > max? ─────┴──► dead-letter
```

### Inspecting the PEL

```bash
XPENDING key group                                    # summary
XPENDING key group [IDLE ms] start end count [consumer]   # detailed
```

```bash
127.0.0.1:6379> XPENDING events:orders billing
1) (integer) 3                    ← total pending
2) "1756742400123-0"              ← smallest pending ID
3) "1756742401000-0"              ← largest pending ID
4) 1) 1) "worker-A"  2) "2"       ← per-consumer counts
   2) 1) "worker-B"  2) "1"

127.0.0.1:6379> XPENDING events:orders billing IDLE 60000 - + 10
1) 1) "1756742401000-0"
   2) "worker-A"
   3) (integer) 300000            ← idle for 5 minutes — worker-A is gone
   4) (integer) 3                 ← delivered 3 times already
```

**A growing `XPENDING` count is the health metric for a stream consumer.** Alert on it. It means handlers are failing, workers are dying, or nobody is acking.

### Reclaiming: `XAUTOCLAIM`

```bash
XAUTOCLAIM key group consumer min-idle-time start [COUNT n] [JUSTID]
XCLAIM key group consumer min-idle-time id [id…] [IDLE ms] [FORCE] [JUSTID]
```

`XAUTOCLAIM` (Redis 6.2+) scans the PEL and transfers ownership of anything idle longer than the threshold. It replaces the old `XPENDING`-then-`XCLAIM` two-step.

```ts
const MAX_DELIVERIES = 5;

async function reclaimStale(): Promise<void> {
  let cursor = '0-0';

  do {
    const [next, entries] = (await redis.xautoclaim(
      STREAM, GROUP, CONSUMER,
      60_000,          // idle longer than 60s → the owner is presumed dead
      cursor,
      'COUNT', 50,
    )) as [string, [string, string[]][], string[]];

    cursor = next;

    for (const [id, fields] of entries) {
      if (fields === null) continue;             // the entry was trimmed away

      // check the delivery count so a poison message cannot loop forever
      const [[, , , deliveries]] = (await redis.xpending(
        STREAM, GROUP, '-', '+', 1, CONSUMER,
      )) as [[string, string, number, number]];

      if (deliveries > MAX_DELIVERIES) {
        await redis.xadd('events:orders:dlq', '*', 'originalId', id, ...fields);
        await redis.xack(STREAM, GROUP, id);     // ack so it leaves the PEL
        continue;
      }

      try {
        await handle(toObject(fields));
        await redis.xack(STREAM, GROUP, id);
      } catch { /* leave it pending for the next sweep */ }
    }
  } while (cursor !== '0-0');
}

setInterval(reclaimStale, 30_000);
```

:::danger[Without a delivery-count check you build an infinite loop]
A **poison message** — one whose handler always throws — is redelivered forever, burning a worker every cycle. Redis gives you `delivery_count` precisely so you can detect this. Route it to a **dead-letter stream** after N attempts, then `XACK` it so it leaves the PEL.

Every reliable queue needs this. If you skip it, you will find out at 3 a.m. when one malformed event has been retried 400,000 times.
:::

### Recovering your own pending entries after a restart

```ts
// on startup, drain what THIS consumer already owns before taking new work
let cursor = '0';
for (;;) {
  const res = await redis.xreadgroup(
    'GROUP', GROUP, CONSUMER, 'COUNT', 100, 'STREAMS', STREAM, cursor,
  );
  const entries = res?.[0]?.[1] ?? [];
  if (entries.length === 0) break;              // caught up — switch to '>'
  for (const [id, fields] of entries) { await handle(toObject(fields)); await redis.xack(STREAM, GROUP, id); }
  cursor = entries[entries.length - 1][0];
}
// now loop on '>' for new work
```

Passing an ID instead of `>` reads **your own PEL**, not new entries. A correct worker does this recovery pass on startup, then switches to `>`.

---

## 6. Introspection

```bash
XLEN key
XINFO STREAM key [FULL]
XINFO GROUPS key
XINFO CONSUMERS key group
XDEL key id [id…]            # ⚠ removes the entry but NOT its PEL references
XSETID key id [ENTRIESADDED n] [MAXDELETEDID id]
```

```bash
127.0.0.1:6379> XINFO GROUPS events:orders
1) 1) "name"              2) "billing"
   3) "consumers"         4) (integer) 3
   5) "pending"           6) (integer) 2
   7) "last-delivered-id" 8) "1756742401000-0"
   9) "entries-read"     10) (integer) 9
  11) "lag"              12) (integer) 0      ← entries not yet delivered
```

**`lag`** (Redis 7+) is the number that matters operationally: how far behind the group is. Graph it. Alert on it. It is the direct analogue of Kafka consumer lag.

---

## 7. Internals: the radix tree of listpacks

```bash
127.0.0.1:6379> OBJECT ENCODING events:orders
"stream"                     ← one encoding only; no small/large variants
```

A Stream is a **radix tree (rax)** keyed by entry ID, whose leaves are **listpacks** holding many entries each.

```
                      rax (radix tree, keyed by 128-bit entry ID)
                              ┌──────────┐
                              │ 17567424 │
                              └────┬─────┘
                    ┌──────────────┴──────────────┐
              ┌─────▼─────┐                 ┌─────▼─────┐
              │   00123   │                 │   05000   │
              └─────┬─────┘                 └─────┬─────┘
                    ▼                             ▼
        ┌───────────────────────┐     ┌───────────────────────┐
        │  LISTPACK (macro node)│     │  LISTPACK             │
        │  master fields:       │     │  ...                  │
        │    [type, order, amt] │     └───────────────────────┘
        │  entry -0: created 9981 4999│
        │  entry -1: SAME_FIELDS paid │  ← delta-encoded!
        │  entry -2: ...              │
        │  … up to ~100 entries       │
        └───────────────────────┘
```

Two optimizations do the heavy lifting:

**1. Macro nodes.** Each listpack holds up to `stream-node-max-entries` (default 100) entries or `stream-node-max-bytes` (default 4096) bytes. So the tree has ~1% of the nodes it would with one node per entry, and the per-entry pointer overhead is amortized.

**2. Field-name delta encoding.** The first entry in a listpack stores a **master field list**. Subsequent entries with the *same* field names store only a flag plus their values — the names are not repeated.

```
   Without delta encoding, 100 entries of {type, order, amount}:
       100 × ("type" + "order" + "amount") = 100 × 16 bytes of NAMES = 1,600 B

   With delta encoding:
       1 × 16 bytes of names + 100 × 1 flag byte = 116 B

   ~14× less overhead on field names alone.
```

This is why Streams are memory-efficient for the common case of homogeneous events, and why **you should keep field names short and consistent across entries** — varying the field set defeats the optimization entirely.

```conf
stream-node-max-entries 100
stream-node-max-bytes   4096
```

Larger nodes mean better compression and less pointer overhead, but `XDEL` and exact trimming get more expensive (a whole node must be rewritten). The defaults are good.

### Where the complexities come from

| Operation | Complexity | Why |
| :--- | :--- | :--- |
| `XADD` | O(1) | Append to the rightmost node |
| `XLEN` | O(1) | A stored counter |
| `XRANGE` | O(log N + M) | Radix lookup, then walk M |
| `XREAD` | O(log N + M) | Same |
| `XREADGROUP` | O(log N + M) | Plus a PEL insert per entry |
| `XACK` | O(1) per id | PEL removal |
| `XDEL` | O(1) amortized | Marks a tombstone; the node is rewritten later |
| `XTRIM MAXLEN ~` | O(1) amortized | Drops whole nodes |
| `XTRIM MAXLEN` (exact) | O(N) | Must split a node |
| `XAUTOCLAIM` | O(log N + M) | Scans the PEL |

:::note[`XDEL` does not shrink memory immediately]
`XDEL` marks the entry deleted inside its listpack; the memory is reclaimed only when the whole macro node is freed. Do not use `XDEL` for routine cleanup — use `XTRIM`/`MAXLEN ~`. And note `XDEL` does **not** remove PEL references, so a deleted-but-unacked entry shows up in `XAUTOCLAIM` with `null` fields, which is why the reclaim loop above checks for that.
:::

---

## 8. Redis Streams vs. Kafka — honestly

| | **Redis Streams** | **Kafka** |
| :--- | :--- | :--- |
| Storage | RAM (persisted via RDB/AOF) | Disk, designed for it |
| Retention | Hours to days, RAM-bound | Weeks to forever, TB-scale |
| Throughput | ~100k–1M msg/s per instance | Millions/s across a cluster |
| Partitioning | Manual (one stream per shard) | Native, automatic |
| Ordering | Total, within one stream | Total, within one partition |
| Consumer groups | ✅ | ✅ |
| Exactly-once | ❌ at-least-once + idempotency | ✅ with transactions |
| Replay from arbitrary offset | ✅ if not trimmed | ✅ |
| Operational weight | You already run Redis | ZooKeeper/KRaft, brokers, a team |
| Latency | sub-ms | single-digit ms |

**Use Streams when:** you already run Redis, retention is hours-to-days, volume fits in RAM, and you want reliable job processing without adding infrastructure. That covers a very large fraction of "we need a queue" situations.

**Use Kafka when:** you need long retention, terabytes of data, cross-datacenter replication, a genuine event-sourcing backbone, or exactly-once semantics.

:::warning[The honest limits of Streams]
- **Everything is in RAM.** A stream with 10 million entries at 200 bytes each is 2 GB *plus* PEL overhead. Cap aggressively.
- **No native partitioning.** To scale past one core you shard manually into `events:{0}`, `events:{1}`, … and route by hash. Consumer groups do not span streams.
- **A stream lives on one Cluster node.** No cross-slot parallelism for a single stream.
- **At-least-once only.** Handlers must be idempotent. There is no transactional produce-and-consume.
- **PELs grow if consumers never ack.** An abandoned consumer group is a memory leak — `XGROUP DELCONSUMER` and `XGROUP DESTROY` are maintenance you must actually perform.
:::

---

## 9. Complete command table

| Command | Purpose |
| :--- | :--- |
| `XADD k [MAXLEN\|MINID [~] n] <*\|id> f v…` | Append an entry |
| `XLEN k` | Entry count |
| `XRANGE` / `XREVRANGE k start end [COUNT]` | Query by ID/time range |
| `XREAD [COUNT][BLOCK] STREAMS k… id…` | Tail, no group |
| `XDEL k id…` | Delete entries (tombstone) |
| `XTRIM k MAXLEN\|MINID [~] n [LIMIT m]` | Cap the stream |
| `XGROUP CREATE\|DESTROY\|SETID\|CREATECONSUMER\|DELCONSUMER` | Group management |
| `XREADGROUP GROUP g c [COUNT][BLOCK][NOACK] STREAMS k… <>\|id>` | Consume in a group |
| `XACK k g id…` | Acknowledge |
| `XPENDING k g [IDLE ms] [start end count [consumer]]` | Inspect the PEL |
| `XCLAIM k g c min-idle id… [FORCE][JUSTID]` | Take ownership explicitly |
| `XAUTOCLAIM k g c min-idle start [COUNT]` | Take ownership by scan (6.2+) |
| `XINFO STREAM\|GROUPS\|CONSUMERS k [g]` | Introspection |
| `XSETID k id` | Force the last-ID (dangerous) |

---

## Rapid-fire recall

1. One sentence each: List vs Pub/Sub vs Stream.
2. What is the Stream ID format, and what useful query does it enable for free?
3. Why should `MAXLEN` almost always be written `MAXLEN ~`?
4. What does `$` mean in `XREAD`, and what does a consumer lose by restarting with it?
5. What does `>` mean in `XREADGROUP`, and what does passing an explicit ID do instead?
6. What is the PEL, what four things does each row hold, and what removes a row?
7. What is a poison message and what exactly stops it looping forever?
8. What are the two memory optimizations inside a Stream's internal structure?
9. Name three honest limitations of Streams versus Kafka.

<details>
<summary>Answers</summary>

1. A List is a queue you destroy as you read. Pub/Sub is a broadcast you must be connected for. A Stream is a persistent log you can re-read, with the server tracking who processed what.
2. `<milliseconds>-<sequence>`. Because IDs are timestamp-prefixed, `XRANGE s <ms1> <ms2>` is a time-range query with no extra index.
3. Exact trimming is O(N) on every `XADD` because it may split a radix node; `~` trims whole macro nodes and is amortized O(1). You rarely care about the exact count and always care about latency.
4. "Only entries added from now on." A consumer restarting with `$` silently skips everything produced while it was down.
5. `>` means entries never delivered to any consumer in this group. An explicit ID reads **your own pending entries** from that ID — the startup recovery path.
6. The Pending Entries List: entry ID, owning consumer, last delivery time, and delivery count. `XACK` removes a row.
7. An entry whose handler always throws, so it is redelivered forever. The `delivery_count` in the PEL lets you route it to a dead-letter stream after N attempts and then `XACK` it.
8. Macro nodes (one listpack holds ~100 entries, amortizing pointer overhead) and field-name delta encoding (the field names are stored once per node, not per entry).
9. Everything lives in RAM so retention is short; there is no native partitioning (you shard manually and a stream cannot span Cluster nodes); at-least-once only, so handlers must be idempotent.

</details>

---

**Next:** [Pub/Sub](./12-pubsub.md) — fire-and-forget messaging, and the four things it cannot do.
