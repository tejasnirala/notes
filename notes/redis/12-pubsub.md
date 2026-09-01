---
title: Pub/Sub
author: Tejas Nirala
---

# Pub/Sub

> **What you will be able to do after this page**
>
> - Build real-time fan-out across many app servers in about ten lines.
> - State the four guarantees Pub/Sub does **not** give you, before you depend on it.
> - Scale WebSockets horizontally, which is the pattern people actually need it for.
> - Know when to use sharded Pub/Sub in a Cluster, and why plain Pub/Sub does not scale there.

Pub/Sub is Redis's **fire-and-forget broadcast** mechanism. A publisher sends a message to a channel; every client currently subscribed to that channel receives it. Nothing is stored. Nothing is acknowledged. It is the simplest messaging primitive in Redis and the easiest to misuse.

---

## 1. The mental model

```
                      ┌──────────────────────┐
   PUBLISH news "hi" ►│  channel: "news"     │
                      │  (nothing is stored) │
                      └──────────┬───────────┘
                                 │  delivered synchronously, right now
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
        ┌───────────┐      ┌───────────┐      ┌───────────┐
        │subscriber │      │subscriber │      │subscriber │
        │     A     │      │     B     │      │     C     │
        └───────────┘      └───────────┘      └───────────┘

        ┌───────────┐
        │subscriber │   ← OFFLINE at this moment.
        │     D     │     It receives NOTHING, now or ever.
        └───────────┘     The message is not queued for it.
```

**A channel is not an object.** It is not stored in the keyspace, it consumes no memory when idle, it does not appear in `KEYS`, and it has no TTL. It exists only as an entry in a dispatch table for as long as someone is subscribed.

---

## 2. Commands

```bash
SUBSCRIBE   channel [channel ...]
UNSUBSCRIBE [channel ...]              # no args = unsubscribe from all
PSUBSCRIBE  pattern [pattern ...]      # glob patterns
PUNSUBSCRIBE [pattern ...]
PUBLISH     channel message            # → the number of clients that received it
PUBSUB CHANNELS [pattern]              # active channels with ≥1 subscriber
PUBSUB NUMSUB [channel ...]            # subscriber count per channel
PUBSUB NUMPAT                          # number of active pattern subscriptions
```

```bash
# terminal 1
127.0.0.1:6379> SUBSCRIBE news
Reading messages... (press Ctrl-C to quit)
1) "subscribe"  2) "news"  3) (integer) 1     ← a confirmation, not a message

# terminal 2
127.0.0.1:6379> PUBLISH news "Redis 8 released"
(integer) 1                                   ← ONE client received it

# terminal 1 immediately prints:
1) "message"  2) "news"  3) "Redis 8 released"
```

:::tip[The return value of `PUBLISH` is your only feedback]
`PUBLISH` returns the number of clients the message was delivered to. **`0` means nobody was listening and the message is gone forever.**

```ts
const delivered = await redis.publish('notifications:1042', payload);
if (delivered === 0) {
  await db.notifications.insert(payload);   // fall back to durable storage
}
```
This is the single most useful defensive pattern with Pub/Sub. Note the race is still there — a subscriber can disconnect microseconds after the count is computed — so treat it as a strong hint, not a guarantee.
:::

### Pattern subscriptions

```bash
PSUBSCRIBE news:*            # news:sports, news:tech, …
PSUBSCRIBE user:*:notify
PSUBSCRIBE *                 # everything — for debugging only
```

```bash
# a pattern subscriber receives a 4-element reply, not 3:
1) "pmessage"     ← type
2) "news:*"       ← the pattern that matched
3) "news:tech"    ← the ACTUAL channel
4) "Redis 8 released"
```

:::warning[`PSUBSCRIBE` costs real CPU on every publish]
Exact-channel delivery is a **hash-table lookup** — O(1). Pattern delivery requires Redis to test the published channel against **every registered pattern**, on every single `PUBLISH`. That is O(N) in the number of distinct patterns, on the single thread.

A hundred patterns × 50,000 publishes/sec = five million glob matches per second, stealing throughput from every other client. Use explicit channel names and let the *client* subscribe to many of them (`SUBSCRIBE` takes a list) rather than reaching for a pattern.
:::

---

## 3. Subscriber mode: the constraint that surprises people

In RESP2, once a connection issues `SUBSCRIBE` it enters **subscriber mode** and may only run:

```
SUBSCRIBE   UNSUBSCRIBE   PSUBSCRIBE   PUNSUBSCRIBE
SSUBSCRIBE  SUNSUBSCRIBE  PING         QUIT         RESET
```

Any other command errors. The reason is protocol-level: with no out-of-band message type, there is no way to tell a pushed message apart from a command reply.

```bash
127.0.0.1:6379> SUBSCRIBE news
1) "subscribe" 2) "news" 3) (integer) 1
127.0.0.1:6379> GET foo
(error) ERR Can't execute 'get': only (P|S)SUBSCRIBE / (P|S)UNSUBSCRIBE / PING / QUIT / RESET are allowed in this context
```

**So you always need two connections**: one subscribed, one for regular commands.

```ts
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);   // commands
const sub = redis.duplicate();                     // subscriptions

await sub.subscribe('news');
sub.on('message', async (channel, message) => {
  await redis.incr('stats:messages');              // ← uses the OTHER connection
  handle(channel, message);
});

// pattern subscribers get an extra argument
await sub.psubscribe('news:*');
sub.on('pmessage', (pattern, channel, message) => handle(channel, message));
```

`redis.duplicate()` clones the connection options, so it is the idiomatic way to get a second connection without repeating configuration.

:::note[RESP3 removes the restriction]
With [RESP3](./04-protocol-resp.md), pushed messages use the distinct `>` type, so a subscribed connection can still run ordinary commands. You still generally want a separate connection — a slow subscriber's output buffer should not be shared with your latency-sensitive command path — but the hard error is gone.
:::

---

## 4. The four things Pub/Sub does not do

This is the part to read twice. Every Pub/Sub incident is one of these four.

### ❌ 1. No persistence — at-most-once delivery

```
   t=0   PUBLISH orders "order-9981-paid"   → 0 subscribers → GONE
   t=1   a consumer starts and subscribes
   t=2   it will never learn about order 9981
```

There is no buffer, no queue, no replay. **If you publish to an empty channel, the message ceases to exist.** Not "delivered later" — gone.

### ❌ 2. No acknowledgement

The publisher learns how many clients the message was *written toward*, not how many processed it. A subscriber can receive a message and crash before handling it. Nothing retries.

### ❌ 3. Messages are dropped when a subscriber is slow

Redis buffers outgoing messages per client. If a subscriber cannot keep up, the buffer grows — and when it crosses the limit, **Redis disconnects that client**:

```conf
client-output-buffer-limit pubsub 32mb 8mb 60
#                                 │     │   └─ ...for 60 continuous seconds
#                                 │     └───── or soft limit 8 MB...
#                                 └─────────── hard limit: kill at 32 MB
```

```bash
redis-cli INFO clients
# client_recent_max_output_buffer:...
redis-cli CLIENT LIST | grep -E 'omem|cmd=subscribe'
```

The subscriber sees a dropped connection with no explanation, reconnects, and has silently lost every message in between. **This is the most common Pub/Sub failure in production, and it is invisible unless you monitor for it.**

### ❌ 4. Fan-out cost is paid by the single thread

`PUBLISH` to 10,000 subscribers means writing the payload into 10,000 output buffers, synchronously, before anything else runs. A 100 KB message to 10,000 subscribers is **1 GB of memory copying** in one command.

```
   Keep messages SMALL. Publish an ID, not a payload:

   ❌  PUBLISH post:updated '<the entire 80 KB post JSON>'
   ✅  PUBLISH post:updated '9981'      → subscribers fetch what they need
```

:::danger[The decision rule]
**If losing a message is unacceptable, do not use Pub/Sub.** Use [Streams](./11-streams.md) — persistent, acknowledged, replayable, with consumer groups.

Pub/Sub is correct for messages that are **worthless if late**: a live cursor position, a typing indicator, a cache-invalidation ping (where the worst case is a stale read until the TTL), a metrics tick. It is wrong for orders, payments, emails, and anything a user will ask about later.
:::

---

## 5. The pattern people actually need: scaling WebSockets

This is the canonical, genuinely-correct use of Pub/Sub.

**The problem.** You run three app servers behind a load balancer. Alice's WebSocket is on server 1; Bob's is on server 3. Alice sends Bob a message. Server 1 has no socket for Bob.

```
   WITHOUT Redis                          WITH Redis Pub/Sub
   ────────────────────────────           ────────────────────────────────
   Alice ──► server 1                     Alice ──► server 1
             │  where is Bob?                       │ PUBLISH chat:room:7
             ✗  not my problem                      ▼
                                              ┌──────────┐
   Bob   ──► server 3                         │  Redis   │
             (never hears anything)           └────┬─────┘
                                        ┌──────────┼──────────┐
                                        ▼          ▼          ▼
                                    server 1   server 2   server 3
                                        │                     │
                                     (Alice)               (Bob) ✅
```

Each server subscribes to the rooms its own clients are in, and re-emits over the local sockets.

```ts
import { Server } from 'socket.io';
import Redis from 'ioredis';

const io = new Server(httpServer);
const pub = new Redis(process.env.REDIS_URL!);
const sub = pub.duplicate();

await sub.psubscribe('chat:room:*');

// Redis → this server's local sockets
sub.on('pmessage', (_pattern, channel, raw) => {
  const roomId = channel.split(':')[2];
  const msg = JSON.parse(raw) as ChatMessage;
  if (msg.origin === SERVER_ID) return;              // don't echo our own
  io.to(roomId).emit('message', msg);
});

// a local socket → Redis → every server
io.on('connection', (socket) => {
  socket.on('message', async (roomId: string, text: string) => {
    const msg = { roomId, text, userId: socket.data.userId, ts: Date.now(), origin: SERVER_ID };

    io.to(roomId).emit('message', msg);               // local delivery, instant
    await pub.publish(`chat:room:${roomId}`, JSON.stringify(msg));
    await db.messages.insert(msg);                    // ← durability lives HERE
  });
});
```

Three details that make this correct rather than merely working:

1. **The `origin` check.** Without it, the publishing server receives its own message back and every client in that room sees it twice.
2. **Local emit first, then publish.** Local users get sub-millisecond delivery; remote users take a Redis hop.
3. **The database write is the durability story, not Redis.** Pub/Sub delivers to who is online *now*; history comes from Postgres when a client reconnects. Pub/Sub is the transport, never the record.

In practice, use the official adapter (`@socket.io/redis-adapter`) — it is this pattern already debugged, with room bookkeeping handled.

---

## 6. Other legitimate uses

### Cache invalidation across app servers

```ts
// each server keeps a local in-process cache
const local = new Map<string, unknown>();

await sub.subscribe('cache:invalidate');
sub.on('message', (_c, key) => local.delete(key));

async function updateUser(id: string, data: Partial<User>) {
  await db.users.update(id, data);
  await redis.del(`cache:user:${id}`);                 // clear the shared cache
  await redis.publish('cache:invalidate', `cache:user:${id}`);  // clear local ones
}
```

A dropped message means one server serves a stale value until its TTL — usually acceptable, and *that is why Pub/Sub is allowed here*. Always pair it with a TTL so a missed invalidation self-heals. (RESP3's [client-side caching](./04-protocol-resp.md) does this properly, with server-tracked invalidation.)

### Config / feature-flag propagation

```ts
await sub.subscribe('config:changed');
sub.on('message', async () => {
  config = await redis.hgetall('config:global');       // re-read on the ping
});
```

The pattern to copy here: **publish a signal, not the state.** The subscriber then reads the authoritative value from a key. A missed ping is repaired by the next one, and there is no risk of applying an out-of-order payload.

### Live dashboards and presence

Metrics ticks, "user is typing", online indicators. Losing one is genuinely fine — the next one arrives in a second.

---

## 7. Sharded Pub/Sub (Redis 7.0+)

Plain Pub/Sub has a serious problem in [Cluster](./22-cluster.md): **channels are not sharded**. Since any client may subscribe on any node, every `PUBLISH` is broadcast to **every node** in the cluster over the cluster bus.

```
   PLAIN PUB/SUB IN A CLUSTER — O(N) node traffic per publish
   ┌────────┐     ┌────────┐     ┌────────┐
   │ node 1 │◄───►│ node 2 │◄───►│ node 3 │
   └────────┘     └────────┘     └────────┘
        ▲              ▲              ▲
        └──── every publish reaches all ───┘
   Adding nodes makes Pub/Sub SLOWER. It does not scale.
```

Sharded Pub/Sub fixes it by hashing the **channel name** to a slot, exactly like a key:

```bash
SSUBSCRIBE   channel [channel ...]
SUNSUBSCRIBE [channel ...]
SPUBLISH     channel message
PUBSUB SHARDCHANNELS [pattern]
PUBSUB SHARDNUMSUB [channel ...]
```

```
   SHARDED PUB/SUB — the message stays on one shard
   ┌────────┐     ┌────────┐     ┌────────┐
   │ node 1 │     │ node 2 │     │ node 3 │
   │        │     │ chat:7 │     │        │
   └────────┘     └───▲────┘     └────────┘
                      │
              SPUBLISH chat:room:7 → routed to the owning shard only
```

```ts
const cluster = new Redis.Cluster([{ host: 'node1', port: 6379 }]);
await cluster.ssubscribe('chat:room:7');
cluster.on('smessage', (channel, message) => handle(channel, message));
await cluster.spublish('chat:room:7', payload);
```

The trade-off: a subscriber must connect to the node owning that channel's slot, and **there are no pattern subscriptions** (a pattern could span slots). In exchange, Pub/Sub throughput now scales with cluster size instead of degrading.

**In Cluster, prefer `SPUBLISH`/`SSUBSCRIBE`.** Use `{}` hash tags to co-locate related channels: `chat:{room7}:messages` and `chat:{room7}:presence` land on the same shard.

---

## 8. Choosing between the three messaging options

```
   Can you afford to LOSE this message?
        │
   ┌────┴────┐
   YES       NO
    │         │
    │         └─► Do multiple independent consumers need it?
    │                  │
    │             ┌────┴────┐
    │            YES        NO
    │             │          │
    │        STREAMS      STREAMS with a consumer group
    │        (one group      (or a LIST + BLMOVE if you
    │         per consumer)   want the simplest thing)
    │
    └─► Is it high-fan-out and latency-critical?
             │
        ┌────┴────┐
       YES        NO
        │          │
    PUB/SUB   either is fine — Pub/Sub is simpler
   (sharded in
    a Cluster)
```

| | Pub/Sub | Streams | List |
| :--- | :--- | :--- | :--- |
| Persistence | ❌ | ✅ | ✅ |
| Delivery | at-most-once | at-least-once | at-least-once |
| Multiple consumers get all | ✅ | ✅ (groups) | ❌ |
| Acknowledgement / retry | ❌ | ✅ | ❌ (DIY) |
| Replay | ❌ | ✅ | ❌ |
| Memory when idle | zero | grows | grows |
| Latency | lowest | very low | very low |
| Complexity | trivial | moderate | low |

---

## 9. Operating it

```bash
PUBSUB CHANNELS                  # active channels (with ≥1 subscriber)
PUBSUB CHANNELS 'chat:*'
PUBSUB NUMSUB chat:room:7        # → "chat:room:7"  (integer) 42
PUBSUB NUMPAT                    # active pattern subscriptions

CLIENT LIST TYPE pubsub          # every subscriber connection
INFO clients                     # blocked_clients, output-buffer highwater
INFO stats | grep pubsub         # pubsub_channels, pubsub_patterns
```

The three things to actually alert on:

1. **`client_output_buffer` growth on pubsub clients** — the silent-drop failure. `CLIENT LIST TYPE pubsub` shows `omem` per client.
2. **`PUBSUB NUMSUB` unexpectedly at 0** — your subscribers died and messages are vanishing.
3. **`PUBSUB NUMPAT` creeping up** — pattern subscriptions leaking, each one taxing every publish.

:::warning[Subscriptions do not survive a reconnect]
When a subscriber's connection drops — a failover, a network blip, an output-buffer kill — **its subscriptions are gone**. The client reconnects with a clean slate and silently receives nothing.

ioredis re-subscribes automatically after a reconnect, which is one of the strongest practical reasons to use it. If you hand-roll a client, you must re-subscribe in your reconnect handler, and you must accept that everything published during the gap is lost.
:::

---

## Rapid-fire recall

1. What does `PUBLISH` return, and what does `0` mean?
2. Why does a subscriber need a second connection in RESP2, and what changed in RESP3?
3. Why is `PSUBSCRIBE news:*` more expensive for the server than `SUBSCRIBE` on ten explicit channels?
4. A subscriber is slow. What does Redis do, and what does the subscriber observe?
5. Why should you publish an ID rather than a full payload?
6. In the WebSocket fan-out pattern, what does the `origin` check prevent, and where does durability live?
7. Why does plain Pub/Sub not scale in a Redis Cluster, and what fixes it?
8. What do you lose by using `SPUBLISH` instead of `PUBLISH`?
9. Name the one situation where Pub/Sub is the right choice over Streams.

<details>
<summary>Answers</summary>

1. The number of clients the message was delivered to. `0` means nobody was subscribed and the message is gone permanently.
2. In RESP2 a subscribed connection can only run subscribe/unsubscribe/ping/quit/reset, because there is no way to distinguish a pushed message from a reply. RESP3's `>` push type removes that restriction.
3. Exact channels are an O(1) hash lookup; every pattern must be glob-tested against the channel on **every** publish, so cost is O(number of patterns) per message on the single thread.
4. Its output buffer grows past `client-output-buffer-limit pubsub` and Redis **disconnects it**. The subscriber just sees a dropped connection and silently loses every message in the gap.
5. `PUBLISH` copies the payload into every subscriber's output buffer synchronously — 100 KB × 10,000 subscribers is 1 GB of copying on the main thread.
6. It stops the publishing server re-emitting its own message, which would show duplicates to local clients. Durability lives in the database write, not in Redis.
7. Channels are not sharded, so every publish is broadcast to every node over the cluster bus — adding nodes makes it slower. Sharded Pub/Sub (`SPUBLISH`/`SSUBSCRIBE`) hashes the channel name to a slot so the message stays on one shard.
8. Pattern subscriptions — a pattern could span slots, so they are not supported. Subscribers must also connect to the node owning the channel's slot.
9. High-fan-out, latency-critical messages that are worthless if late — live cursors, typing indicators, presence, metrics ticks, cache-invalidation pings backed by a TTL.

</details>

---

**Next:** [Internals: Memory & Encodings](./13-internals-memory-and-encodings.md) — `redisObject`, the dict, incremental rehashing, and where every byte goes.
