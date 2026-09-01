---
title: Lists
author: Tejas Nirala
---

# Lists

> **What you will be able to do after this page**
>
> - Build a queue and a stack, and say which end is which without guessing.
> - Use the blocking commands to delete polling from your architecture entirely.
> - Explain quicklist and listpack, and why `LINDEX` in the middle is slow.
> - Build a reliable worker that does not lose jobs when it crashes.

A Redis List is an **ordered sequence of strings**, addressable from both ends. Internally it is a linked list of compressed chunks — so pushing and popping at either end is O(1), and reaching into the middle is O(N).

---

## 1. The mental model

```
   key "queue:emails"

     HEAD (left, index 0)                          TAIL (right, index -1)
        │                                                  │
        ▼                                                  ▼
      ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐
      │ job5 │──►│ job4 │──►│ job3 │──►│ job2 │──►│ job1 │
      └──────┘   └──────┘   └──────┘   └──────┘   └──────┘
        idx 0      idx 1      idx 2      idx 3      idx 4
        idx -5     idx -4     idx -3     idx -2     idx -1

      LPUSH ─┘                                        └─ RPUSH
      LPOP  ─┘                                        └─ RPOP
```

**L = Left = head = index 0. R = Right = tail = index -1.** Every list command starts with `L` or `R` and that letter is always the end it operates on. `LPUSH` adds at the head, `RPOP` removes from the tail. Once you internalize that letter, the entire command set is obvious.

Up to 2³² − 1 elements (about 4.29 billion) per list. Elements are plain strings; there is no uniqueness constraint, so duplicates are fine.

---

## 2. Push and pop

```bash
LPUSH  key v [v ...]     # prepend. Multiple values push in order, so the LAST
                         # argument ends up closest to the head.
RPUSH  key v [v ...]     # append
LPUSHX key v             # push ONLY if the key already exists (no auto-create)
RPUSHX key v
LPOP   key [count]       # remove and return from the head
RPOP   key [count]       # remove and return from the tail
```

```bash
127.0.0.1:6379> RPUSH tasks "a" "b" "c"
(integer) 3
127.0.0.1:6379> LRANGE tasks 0 -1
1) "a"
2) "b"
3) "c"

127.0.0.1:6379> LPUSH tasks "z"
(integer) 4
127.0.0.1:6379> LRANGE tasks 0 -1
1) "z"       ← went to the front
2) "a"
3) "b"
4) "c"
```

:::warning[The multi-value `LPUSH` ordering surprise]
```bash
DEL k
LPUSH k a b c
LRANGE k 0 -1     # → "c", "b", "a"     ← REVERSED from what you typed
```
`LPUSH k a b c` is equivalent to `LPUSH k a` then `LPUSH k b` then `LPUSH k c` — each one goes to the front, so the last argument ends up first. `RPUSH` has no such surprise: `RPUSH k a b c` gives `a, b, c`.

This bites people building "insert these 100 items in order" code. Use `RPUSH` when you want insertion order preserved.
:::

`LPUSHX`/`RPUSHX` exist for a specific reason: they let you append to a list **only if someone else already created it**. That is how you avoid resurrecting a key that a consumer just drained and whose lifecycle has ended.

### Queue vs. Stack — the only two combinations that matter

```
   FIFO QUEUE (a job queue)              LIFO STACK (undo history)
   ────────────────────────              ─────────────────────────
   producer:  LPUSH  q job               push:  LPUSH  s item
   consumer:  RPOP   q                   pop:   LPOP   s
              (or BRPOP)

   in ──► [ head ]…[ tail ] ──► out      in ──► [ head ] ──► out
          push here    pop here                 both here

   The oldest job is popped first.       The newest item is popped first.
```

The convention is **`LPUSH` + `RPOP`** for a queue. You could equally use `RPUSH` + `LPOP` — just pick one and never mix them, or your queue silently becomes a stack.

---

## 3. Reading without removing

```bash
LRANGE key start stop    # inclusive both ends; negatives count from the tail
LINDEX key index         # one element by position
LLEN key                 # length — O(1), it is a stored counter
LPOS key element [RANK n] [COUNT n] [MAXLEN n]   # find the index of a value (6.0.6+)
```

```bash
127.0.0.1:6379> RPUSH letters a b c d e
127.0.0.1:6379> LRANGE letters 0 2      # first three
1) "a"  2) "b"  3) "c"
127.0.0.1:6379> LRANGE letters -2 -1    # last two
1) "d"  2) "e"
127.0.0.1:6379> LRANGE letters 0 -1     # everything
127.0.0.1:6379> LRANGE letters 0 999    # out-of-range stop is CLAMPED, not an error
1) "a" … 5) "e"
127.0.0.1:6379> LINDEX letters 2        # "c"
127.0.0.1:6379> LINDEX letters -1       # "e"
127.0.0.1:6379> LPOS letters c          # (integer) 2
127.0.0.1:6379> LPOS letters z          # (nil)
```

:::danger[`LRANGE key 0 -1` on a large list]
`LRANGE` is **O(S+N)** where S is the offset and N the number of elements returned. `LRANGE bigqueue 0 -1` on a million-element list builds a million-element reply on the single thread, then ships megabytes down the socket. Everything else stops.

Page it: `LRANGE key 0 99`, `LRANGE key 100 199`, … Or reconsider whether a List is the right structure — if you need to read arbitrary slices of a huge dataset, you probably want a [Sorted Set](./09-sorted-sets.md) or a [Stream](./11-streams.md).
:::

**`LINDEX` is O(N), not O(1).** A List is not an array. `LINDEX list 500000` walks half a million elements. Redis optimizes by starting from whichever end is nearer, so `LINDEX list -1` is fast and `LINDEX list <middle>` is not. **If you need random access by index, a List is the wrong type** — that is what a Hash or a Sorted Set is for.

---

## 4. Modifying

```bash
LSET  key index value            # overwrite by index. Errors if out of range.
LINSERT key BEFORE|AFTER pivot value   # insert relative to the FIRST match of pivot
LREM  key count value            # remove occurrences of a value
LTRIM key start stop             # keep only this range; DELETE everything else
```

### `LREM` and its signed count

```bash
LREM key  2 "a"    # remove the first 2 "a"s, scanning head → tail
LREM key -2 "a"    # remove the last  2 "a"s, scanning tail → head
LREM key  0 "a"    # remove ALL "a"s
```

```bash
127.0.0.1:6379> RPUSH l a b a c a
127.0.0.1:6379> LREM l 2 a
(integer) 2
127.0.0.1:6379> LRANGE l 0 -1
1) "b"  2) "c"  3) "a"       ← the first two "a"s went
```

### `LTRIM` — the capped-collection command

`LTRIM` **keeps** the given range and discards everything else. It is the single most useful list command in production, because it is how you stop a list from growing forever.

```bash
LTRIM key 0 999      # keep the newest 1000 (with LPUSH), drop the rest
LTRIM key 1 -1       # drop the head element
LTRIM key 0 -1       # a no-op (keeps everything)
LTRIM key 1 0        # start > stop → EMPTIES the list, deleting the key
```

```ts
// a bounded activity feed: push and trim in ONE round trip via a pipeline
await redis
  .multi()
  .lpush(`user:${userId}:feed`, JSON.stringify(event))
  .ltrim(`user:${userId}:feed`, 0, 999)
  .exec();
```

:::tip[Every list you create needs a bound]
A List with a producer and no consumer, or a producer faster than its consumer, grows until the instance OOMs. Either:

- `LTRIM` after every push (a capped feed / ring buffer), or
- monitor `LLEN` and alert on backlog, or
- use a [Stream](./11-streams.md) with `XADD … MAXLEN ~ 10000`, which has capping built into the write.

"An unbounded list ate all the memory" is one of the top three ways a Redis instance dies. The others are unbounded key growth and one enormous value.
:::

### An empty list deletes itself

```bash
127.0.0.1:6379> RPUSH k a
127.0.0.1:6379> LPOP k
"a"
127.0.0.1:6379> EXISTS k
(integer) 0        ← the key is GONE, not an empty list
127.0.0.1:6379> LLEN k
(integer) 0        ← commands on a missing list behave like an empty one
```

**Redis never stores an empty collection.** When the last element is removed, the key is deleted. This is true for Lists, Sets, Hashes, and Sorted Sets, and it has three consequences:

1. `EXISTS` is not a reliable "has this queue been initialized" check.
2. Any TTL on the key disappears with it.
3. `LPUSHX` returning 0 tells you the list is empty *or* never existed — you cannot distinguish them.

---

## 5. Blocking commands — the feature that removes polling

This is the reason to use a List for a queue instead of a table.

```bash
BLPOP  key [key ...] timeout      # block until an element is available at the head
BRPOP  key [key ...] timeout      # ... at the tail
BLMOVE src dst LEFT|RIGHT LEFT|RIGHT timeout
BLMPOP timeout numkeys key [key ...] LEFT|RIGHT [COUNT n]   # Redis 7+
```

`timeout` is in seconds and may be fractional (`0.5`). **`0` means block forever.**

```bash
# terminal 1 — a worker, waiting
127.0.0.1:6379> BRPOP tasks 0
   ... hangs, consuming zero CPU on client and server ...

# terminal 2
127.0.0.1:6379> LPUSH tasks "send-email-42"
(integer) 1

# terminal 1 wakes IMMEDIATELY (sub-millisecond) and prints:
1) "tasks"                ← which key it came from
2) "send-email-42"        ← the value
```

Note the reply shape: **an array of `[key, value]`**, because you can block on several keys at once. On timeout you get `(nil)`.

### Why blocking is strictly better than polling

```
   POLLING every 100 ms                 BLOCKING
   ──────────────────────────────       ─────────────────────────────
   while (true) {                       while (true) {
     job = RPOP q                         job = BRPOP q 0
     if (!job) sleep(100ms)               handle(job)
     else handle(job)                   }
   }

   • 10 pointless commands/sec/worker    • 0 commands while idle
   • 50 workers = 500 ops/sec of         • 50 workers = 0 ops/sec of noise
     pure noise on the server
   • up to 100 ms of added latency       • ~0 latency: the pusher's own
     on every job                          command wakes the waiter
   • a tuning dilemma: poll faster       • no tuning at all
     (more load) or slower (more lag)
```

### How blocking works internally — it is not a loop

Redis does **not** spin. When `BRPOP` finds the list empty:

```
  1. The client is marked CLIENT_BLOCKED and REMOVED from the event loop's
     ready set. It is not polled, not scheduled, not woken by a timer.
  2. Its client struct is appended to a per-key list:
         server.blocking_keys["tasks"] → [clientA, clientB, clientC]
  3. The event loop carries on serving everyone else. Zero cost.

  Later, another client runs LPUSH tasks "job":
  4. signalKeyAsReady("tasks") adds the key to server.ready_keys.
  5. Before the NEXT event-loop iteration, handleClientsBlockedOnKeys() runs:
         pop the value → hand it to clientA (the LONGEST waiter) → unblock it
  6. clientA's reply is written. It never knew it was asleep.
```

Two properties fall out, and both are interview answers:

- **FIFO fairness.** Blocked clients are served in the order they blocked. The longest waiter gets the next job — no starvation, no thundering herd.
- **Exactly one consumer per element.** The value is handed to one client while nothing else runs. Two workers can never receive the same job from a `BRPOP`.

:::danger[Three real constraints on blocking commands]
1. **A blocked connection can do nothing else.** It is occupied. So a worker needs **at least two connections**: one blocked on `BRPOP`, one for the `GET`/`SET`/`HSET` work it does while handling a job. In ioredis, `redis.duplicate()` gives you a second connection cheaply.
2. **Blocking commands are not allowed inside `MULTI` or Lua.** Inside a transaction they degrade to their non-blocking form (returning `nil` immediately) — because blocking would deadlock the single thread. This is by design and is a common gotcha.
3. **`timeout 0` plus a firewall or NAT that drops idle connections = a worker that silently stops receiving jobs.** Either set `tcp-keepalive` on the server (it defaults to 300s, which is usually enough) or use a finite timeout and loop.
:::

---

## 6. Reliable queues: `LMOVE` and the processing list

`BRPOP` has a real flaw for job processing: **if the worker crashes after popping, the job is gone forever.** It is out of Redis and not yet done.

The fix is an atomic move to a second list:

```bash
LMOVE  src dst LEFT|RIGHT LEFT|RIGHT
BLMOVE src dst LEFT|RIGHT LEFT|RIGHT timeout
# (RPOPLPUSH / BRPOPLPUSH are the older, LEFT/RIGHT-fixed equivalents — deprecated)
```

```
   BEFORE                                    AFTER  BLMOVE queue processing RIGHT LEFT
   ─────────────────────────                 ─────────────────────────────────────────
   queue:      [ j4 j3 j2 j1 ]               queue:      [ j4 j3 j2 ]
   processing: [ ]                           processing: [ j1 ]
                                                          ▲
                                             atomically moved — it was never
                                             in a state where it existed in
                                             neither list
```

```ts
const QUEUE = 'queue:emails';
const PROCESSING = `processing:${process.env.WORKER_ID}`;   // one per worker

async function work(): Promise<void> {
  for (;;) {
    // atomically take a job AND record that we are holding it
    const job = await redis.blmove(QUEUE, PROCESSING, 'RIGHT', 'LEFT', 0);
    if (job === null) continue;              // timeout (unreachable with 0)

    try {
      await handle(JSON.parse(job));
      await redis.lrem(PROCESSING, 1, job);  // ack: remove it, we are done
    } catch (err) {
      // nack: put it back at the tail of the queue for someone else
      await redis.multi().lrem(PROCESSING, 1, job).lpush(QUEUE, job).exec();
    }
  }
}
```

If the worker dies mid-job, the job is still sitting in *its* processing list. A janitor process finds orphans and requeues them:

```ts
// run periodically; a worker's heartbeat key expiring means it is dead
async function reclaimOrphans(): Promise<void> {
  const stream = redis.scanStream({ match: 'processing:*' });

  for await (const keys of stream) {
    for (const key of keys) {
      const workerId = key.split(':')[1];
      const alive = await redis.exists(`worker:${workerId}:heartbeat`);
      if (alive) continue;

      // move every stranded job back to the main queue
      for (;;) {
        const job = await redis.lmove(key, QUEUE, 'RIGHT', 'LEFT');
        if (job === null) break;
      }
    }
  }
}
```

This gives you **at-least-once delivery**: a job is never lost, but it may be processed twice if a worker dies *after* finishing the side effects but *before* the `LREM`. Your handler must therefore be **idempotent** — the universal requirement of every reliable queue, Redis or not.

:::note[When to stop hand-rolling this]
The pattern above is correct and worth understanding, but a production system also wants retries with backoff, dead-letter queues, delayed jobs, priorities, and metrics. At that point use **[Redis Streams with consumer groups](./11-streams.md)** — which have acknowledgement, pending-entry tracking, and claim-on-timeout built into the server — or a library like **BullMQ**, which is these patterns already debugged. [Queues & Background Jobs](./28-queues-and-jobs.md) compares them.
:::

---

## 7. Internals: quicklist and listpack

Run this and watch the encoding change:

```bash
127.0.0.1:6379> DEL mylist
127.0.0.1:6379> RPUSH mylist a b c
127.0.0.1:6379> OBJECT ENCODING mylist
"listpack"

127.0.0.1:6379> RPUSH mylist $(python3 -c "print('x'*100)")
127.0.0.1:6379> OBJECT ENCODING mylist
"quicklist"
```

### Small lists: a single listpack

```
   listpack — ONE flat, contiguous allocation

   ┌────────┬─────────┬───────────────┬───────────────┬───────────────┬─────┐
   │ total  │ num     │ entry "a"     │ entry "b"     │ entry "c"     │ END │
   │ bytes  │ entries │ [enc|data|len]│ [enc|data|len]│ [enc|data|len]│ 0xFF│
   └────────┴─────────┴───────────────┴───────────────┴───────────────┴─────┘

   • No pointers. No per-element allocation. No per-element redisObject.
   • Sequentially laid out → CPU prefetcher loves it → very few cache misses.
   • Each entry stores its own length at BOTH ends, so you can walk backwards.
   • O(N) to traverse — but for N ≤ 128 with tiny elements, an O(N) walk over
     one cache-resident array beats an O(1) pointer chase through scattered RAM.
```

The thresholds:

```conf
list-max-listpack-size 128      # (a.k.a. list-max-ziplist-size)
                                # positive = max entries per node
                                # negative = max size per node:
                                #   -1 = 4 KB, -2 = 8 KB (default), … -5 = 64 KB
```

:::note[listpack vs ziplist]
Redis ≤ 6 used **ziplist**. Redis 7 replaced it with **listpack** everywhere. They serve the same purpose — a compact flat encoding for small collections — but ziplist stored a "previous entry length" field, which created a pathological **cascading update**: inserting one element near the front could force every subsequent entry to be re-sized and the whole array rewritten, turning an O(1) insert into O(N²) in the worst case. Listpack removed that field. If you read an older article discussing "cascade update", this is the bug that was fixed.
:::

### Large lists: a quicklist

Once a list outgrows the threshold, Redis uses a **quicklist**: a doubly linked list *of listpacks*.

```
                          quicklist
   head ─┐                                                        ┌─ tail
         ▼                                                        ▼
   ┌───────────┐      ┌───────────┐      ┌───────────┐     ┌───────────┐
   │ quicklist │◄────►│ quicklist │◄────►│ quicklist │◄───►│ quicklist │
   │  Node     │      │  Node     │      │  Node     │     │  Node     │
   │           │      │  (LZF     │      │  (LZF     │     │           │
   │ listpack: │      │ compressed│      │ compressed│     │ listpack: │
   │ [a b c …] │      │  listpack)│      │  listpack)│     │ [… x y z] │
   │ 128 items │      │           │      │           │     │ 128 items │
   └───────────┘      └───────────┘      └───────────┘     └───────────┘
     UNCOMPRESSED       compressed         compressed       UNCOMPRESSED
     (hot end)                                              (hot end)
```

This is a deliberate compromise between two bad extremes:

| | Pure linked list | Pure array | **Quicklist** |
| :--- | :--- | :--- | :--- |
| Memory per element | ~11 bytes of pointers + allocation | minimal | **amortized over ~128 items** |
| Push/pop at ends | O(1) | O(1) / O(N) | **O(1)** |
| Cache locality | terrible (scattered nodes) | perfect | **good within a node** |
| Insert in middle | O(1) given the node | O(N) memmove | O(N) to find + local memmove |

```conf
list-compress-depth 0     # 0 = no compression (default)
                          # 1 = compress all nodes EXCEPT the first and last
                          # 2 = except the first two and last two, etc.
```

`list-compress-depth 1` is a genuinely good setting for a long queue or feed: you only ever touch the ends, so the middle can sit LZF-compressed at roughly half the memory, and you never pay to decompress it.

### Where the complexities come from

| Operation | Complexity | Why |
| :--- | :--- | :--- |
| `LPUSH` / `RPUSH` / `LPOP` / `RPOP` | **O(1)** | Head and tail node pointers are held directly |
| `LLEN` | **O(1)** | A stored counter |
| `LINDEX i` | **O(N)** | Walk nodes from the nearer end, summing their counts |
| `LRANGE s e` | **O(S+N)** | Seek to S, then read N |
| `LINSERT` | **O(N)** | Must scan for the pivot |
| `LREM` | **O(N)** | Must scan for matches |
| `LSET` | **O(N)** | Must seek to the index |
| `LTRIM` | **O(N)** | N = the number of elements *removed* |

**Read that table as a design rule: a List is fast at its ends and slow in its middle.** Use it for queues, stacks, and capped feeds. Do not use it as an array, a set, or anything you need to search.

---

## 8. Complete command table

| Command | Complexity | Returns |
| :--- | :--- | :--- |
| `LPUSH` / `RPUSH k v…` | O(N) values | new length |
| `LPUSHX` / `RPUSHX k v` | O(1) | new length, or 0 if key absent |
| `LPOP` / `RPOP k [count]` | O(N) popped | element / array / `nil` |
| `LLEN k` | O(1) | length |
| `LRANGE k s e` | O(S+N) | array |
| `LINDEX k i` | O(N) | element / `nil` |
| `LSET k i v` | O(N) | `OK` / error if out of range |
| `LINSERT k BEFORE\|AFTER pivot v` | O(N) | new length, or −1 if pivot not found |
| `LREM k count v` | O(N) | number removed |
| `LTRIM k s e` | O(N removed) | `OK` |
| `LPOS k v [RANK][COUNT]` | O(N) | index / array / `nil` |
| `LMOVE src dst L\|R L\|R` | O(1) | the moved element |
| `LMPOP numkeys k… L\|R [COUNT]` | O(N) | `[key, elements]` (Redis 7+) |
| `BLPOP` / `BRPOP k… timeout` | O(1) | `[key, element]` / `nil` on timeout |
| `BLMOVE src dst L\|R L\|R timeout` | O(1) | element / `nil` |
| `BLMPOP timeout numkeys k… L\|R` | O(N) | `[key, elements]` / `nil` |

---

## 9. When a List is the wrong choice

| You want | Don't use a List | Use |
| :--- | :--- | :--- |
| Random access by index, fast | `LINDEX` is O(N) | Hash keyed by index, or a Sorted Set |
| "Is X in here?" | `LPOS` is O(N) | [Set](./08-sets.md) — `SISMEMBER` is O(1) |
| Uniqueness | Lists allow duplicates | [Set](./08-sets.md) |
| Ordering by a score, not insertion | Lists only know insertion order | [Sorted Set](./09-sorted-sets.md) |
| Multiple independent consumers of the same events | A pop removes the element for everyone | [Streams](./11-streams.md) or [Pub/Sub](./12-pubsub.md) |
| Acknowledgement, retries, dead-lettering | You must build all of it | [Streams](./11-streams.md) consumer groups |
| Very large collections read in slices | `LRANGE` is O(S+N) from the end | [Sorted Set](./09-sorted-sets.md) or Stream |

---

## Rapid-fire recall

1. Which end is `LPUSH`, and which pop pairs with it to make a FIFO queue?
2. `LPUSH k a b c` — what order does `LRANGE k 0 -1` return, and why?
3. Why is `LINDEX list 500000` slow when `LINDEX list -1` is fast?
4. What does `LTRIM k 1 0` do?
5. Precisely how does `BRPOP` avoid burning CPU while it waits, and who gets the next job when three workers are blocked?
6. Why does a worker using `BRPOP` need two connections?
7. What does `BLMOVE` give you that `BRPOP` does not, and what delivery guarantee results?
8. What are the two encodings of a List, and what triggers the switch?
9. What problem did listpack fix that ziplist had?

<details>
<summary>Answers</summary>

1. `LPUSH` adds at the head (left, index 0). Pair it with `RPOP`/`BRPOP` at the tail for FIFO.
2. `c, b, a`. Each value is pushed to the head in turn, so the last argument ends up first. `RPUSH` preserves the order you typed.
3. A List is a linked list of chunks, not an array. Redis walks from the nearer end, so an index near either end is cheap and the middle costs O(N).
4. `start > stop` empties the list, which deletes the key.
5. The client is removed from the event loop and parked on `server.blocking_keys[key]`; a subsequent push calls `signalKeyAsReady` and the loop hands the value to the **longest-waiting** client. Zero polling, FIFO fairness.
6. A blocked connection cannot issue any other command, so the worker needs a second connection to do the actual work (`GET`, `HSET`, …) while the first sits in `BRPOP`.
7. `BLMOVE` atomically records that a specific worker is holding the job, in a processing list — so a crash does not lose it. That yields at-least-once delivery, which requires idempotent handlers.
8. `listpack` (small: ≤ 128 entries and small elements — one flat allocation) and `quicklist` (a doubly linked list of listpacks, optionally LZF-compressed in the middle).
9. Ziplist stored a previous-entry-length field, so one insert could cascade a resize through every following entry — O(N²) worst case. Listpack removed that field.

</details>

---

**Next:** [Hashes](./07-hashes.md) — the type that will cut your memory bill by 5–10×.
