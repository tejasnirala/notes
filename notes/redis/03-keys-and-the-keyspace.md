---
title: Keys & The Keyspace
author: Tejas Nirala
---

# Keys & The Keyspace

> **What you will be able to do after this page**
>
> - Design a key naming scheme you will not regret in six months.
> - Use every TTL command correctly, and know which write commands silently destroy a TTL.
> - Iterate a million-key keyspace safely with `SCAN`, and explain its guarantees precisely.
> - Explain the difference between *expiry* and *eviction* without hesitating.

The keyspace is the flat namespace of every key in a Redis database. There are no tables, no collections, no schemas. **The key name is your entire data model.** That is why this page comes third.

---

## 1. What a key actually is

A key is a **binary-safe string**. Any sequence of bytes, up to 512 MB. `"user:1"`, `"用户:1"`, a JPEG, an empty string — all legal keys.

Legal is not the same as wise:

```
❌ ""                              legal, unreadable, impossible to grep
❌ "u1"                            saves 12 bytes, costs an hour of debugging
❌ <a 4KB serialized object>       the key is hashed and compared on every lookup
✅ "user:1042:profile"             obvious, greppable, groupable
```

**Rule of thumb:** long enough to be unambiguous, short enough that a million of them do not dominate your memory. 30–60 bytes is a comfortable range. Remember you pay for the key *and* an overhead of roughly 50–90 bytes per entry (hash-table slot, `redisObject`, SDS header, allocator rounding) — so with 10 million keys, every extra 10 bytes of key name is another ~100 MB.

---

## 2. Naming: the colon convention

The universal Redis convention is **colon-separated segments, from general to specific**:

```
   object-type : id : field
   ──────────   ──   ─────
   user:1042:profile
   user:1042:sessions
   post:88:comments
   cart:sess_x7f2:items
   ratelimit:ip:203.0.113.9:minute:20260901T1432
   cache:v3:homepage:trending
   lock:order:9981
```

Colons have no special meaning to the server — Redis does not parse them. But they are conventional, tools display them as a tree, and glob patterns line up with them naturally.

### Five rules that pay for themselves

**1. Put the entity type first.** `user:1042` not `1042:user`. Prefix grouping is the only grouping you get, so make the prefix meaningful.

**2. Version anything cached whose *shape* can change.**

```
cache:v1:user:1042    →    cache:v2:user:1042
```
When you change the JSON schema of a cached object, bump the version in the key. Every old entry becomes unreachable and expires on its own. This turns "deploy requires a cache flush and a thundering herd" into a non-event. **This trick is worth the whole page.**

**3. Encode the type of thing when it disambiguates.**
`ratelimit:ip:1.2.3.4` and `ratelimit:user:1042` will never collide.

**4. Never put unbounded user input directly in a key without normalizing it.**
An attacker who controls part of a key can create millions of keys (a memory-exhaustion DoS) or inject a colon to collide namespaces. Hash it, length-cap it, or validate it.

**5. Use braces when you will run Redis Cluster.**

```
{user:1042}:profile
{user:1042}:sessions
```
In Cluster mode, only the text inside `{...}` is hashed to choose a slot, so both keys land on the same node — which is required for multi-key commands and transactions. See [Redis Cluster](./22-cluster.md). Adding braces later is a migration; adding them now is free.

### Anti-patterns

| Anti-pattern | Why it hurts | Do instead |
| :--- | :--- | :--- |
| `user1042name` | Cannot pattern-match, cannot group | `user:1042:name` |
| One key per field: `user:1:name`, `user:1:age`, … | ~80 bytes overhead × N fields; N round trips to read a user | One Hash `user:1` |
| A single Hash `all_users` with 50 M fields | One giant object; blocks on `HGETALL`; cannot expire individually; a hot slot in Cluster | One key per user |
| Sequential integer keys with no prefix (`1`, `2`, `3`) | Guaranteed collision with the next feature | Prefix everything |
| Keys built from raw user email/URL | Unbounded length, injection, PII in `MONITOR`/logs | Hash it: `user:email:<sha256>` |

---

## 3. Core keyspace commands

```bash
EXISTS key [key ...]     # → count of keys that exist (so EXISTS k k → 2!)
TYPE key                 # → string | list | set | zset | hash | stream | none
DEL key [key ...]        # → count deleted. BLOCKS: O(N) for big collections.
UNLINK key [key ...]     # → same, but frees memory in a background thread
RENAME key newkey        # → OK. Overwrites newkey. Errors if key is missing.
RENAMENX key newkey      # → 1 if renamed, 0 if newkey already existed
RANDOMKEY                # → a random key name, or nil
DBSIZE                   # → number of keys. O(1) — it is a counter.
COPY src dst [DB n] [REPLACE]
TOUCH key [key ...]      # → bumps the LRU/LFU clock without reading the value
OBJECT ENCODING key      # → the internal representation. Your window into internals.
OBJECT REFCOUNT key
OBJECT FREQ key          # LFU access frequency (requires an LFU maxmemory-policy)
MEMORY USAGE key         # → bytes this key+value occupy, including overhead
```

:::tip[Prefer `UNLINK` to `DEL` for big values]
`DEL` on a list with 10 million elements frees 10 million allocations **on the main thread** — a multi-second stall for every client. `UNLINK` removes the key from the keyspace immediately (O(1) as far as clients are concerned) and hands the deallocation to a background thread.

Make `UNLINK` your default. There is no downside for small keys — Redis falls back to synchronous deletion when the object is cheap to free.
:::

### `TYPE` and the `WRONGTYPE` error

Every key has exactly one type, fixed when it is created:

```bash
LPUSH mylist a
GET mylist
# (error) WRONGTYPE Operation against a key holding the wrong kind of value
```

This error means *"you used a String command on a List"* (or similar). It is a bug in your code — usually two features that accidentally chose the same key name. It is also the reason for the naming discipline above.

---

## 4. Expiration: TTLs

Redis can automatically delete a key after a time. This is the feature that makes it a cache.

### Setting a TTL

```bash
EXPIRE key 60             # seconds        → 1 if set, 0 if key missing
PEXPIRE key 60000         # milliseconds
EXPIREAT key 1893456000   # absolute Unix timestamp in seconds
PEXPIREAT key 1893456000000
PERSIST key               # remove the TTL, making the key permanent → 1 or 0

# Redis 7+ conditional flags
EXPIRE key 100 NX         # only if the key currently has NO expiry
EXPIRE key 100 XX         # only if it already HAS an expiry
EXPIRE key 100 GT         # only if 100 is GREATER than the current TTL
EXPIRE key 100 LT         # only if LESS than the current TTL
```

`GT` is the correct primitive for "extend this session, but never shorten it" — without it you need a `WATCH`/`MULTI` dance or a Lua script.

### Reading a TTL

```bash
TTL key       # → remaining seconds
              #   -1 = key exists but has NO expiry
              #   -2 = key does not exist
PTTL key      # → same, in milliseconds
EXPIRETIME key   # → absolute Unix time when it will die (Redis 7+)
```

Memorize `-1` and `-2`. They are asked in interviews and they are the source of "why is my TTL negative" confusion.

### Setting a value and TTL atomically

```bash
SET key value EX 60        # seconds
SET key value PX 60000     # milliseconds
SET key value EXAT <ts>    # absolute
SET key value KEEPTTL      # overwrite value, KEEP the existing TTL (Redis 6+)
SETEX key 60 value         # older equivalent of SET ... EX
GETEX key EX 60            # read the value AND (re)set the TTL in one trip
GETEX key PERSIST          # read and remove the TTL
GETDEL key                 # read and delete atomically
```

:::danger[The TTL-destroying trap — the single most common Redis bug]
**Writing a new value to a key with `SET` clears its TTL.** The key becomes permanent.

```bash
SET session:abc "data" EX 3600
TTL session:abc          # (integer) 3600

SET session:abc "updated"     # ← the TTL is GONE
TTL session:abc          # (integer) -1     ← leaks forever
```

Your session store slowly fills memory with sessions that will never expire, and six months later you get an OOM at 2 a.m.

**The fixes:**
```bash
SET session:abc "updated" KEEPTTL     # keep whatever TTL was there
SET session:abc "updated" EX 3600     # or set a fresh one (sliding expiry)
```

**Which commands clear a TTL, and which do not:**

| Behaviour | Commands |
| :--- | :--- |
| **Clears the TTL** | `SET` (without `KEEPTTL`/`EX`), `GETSET` |
| **Keeps the TTL** | `INCR`/`DECR`, `APPEND`, `SETRANGE`, `SETBIT`, `LPUSH`/`RPUSH`, `HSET`, `SADD`, `ZADD`, `XADD` — **every command that modifies a value in place** |
| **Transfers the TTL** | `RENAME` (the destination inherits the source's TTL) |

The mental model: **replacing a key resets its lifetime; modifying a key does not.** Since `SET` conceptually creates a brand-new key, it starts with a clean slate.
:::

### Hash-field TTLs (Redis 7.4+)

Historically a TTL applied only to a whole key — you could not expire one field of a hash. Redis 7.4 changed that:

```bash
HSET user:1 name Ada session_token xyz
HEXPIRE user:1 300 FIELDS 1 session_token    # only that field expires
HTTL user:1 FIELDS 1 session_token           # → 300
HPERSIST user:1 FIELDS 1 session_token
```

Before 7.4, the workaround was a separate key per expiring item plus a sorted set of expiry timestamps swept by a cron. If you inherit code that does that, this is why.

---

## 5. How expiry actually works internally

A key with a TTL is **not** deleted by a timer at the exact moment it expires. Redis has no per-key timer — a million timers would be a million allocations and a scheduling nightmare. Instead, two mechanisms cooperate.

Redis keeps a **second dictionary per database**:

```
   db->dict     : key  →  value           (every key)
   db->expires  : key  →  expire-at-ms    (only keys that have a TTL)
```

### Mechanism 1 — Lazy expiration (on access)

```
   client: GET session:abc
              │
              ▼
   lookupKeyRead()
       │
       ├─► is "session:abc" in db->expires ?
       │        no  → return the value
       │        yes → is now_ms > expire_at ?
       │                 no  → return the value
       │                 yes → DELETE the key, propagate a DEL to replicas
       │                       and the AOF, then reply (nil)
```

**Consequence: an expired key that is never read is never deleted by this path.** It sits in memory consuming bytes. If lazy expiry were the only mechanism, a workload that writes keys with TTLs and never re-reads them would leak until OOM.

### Mechanism 2 — Active expiration (the background cycle)

Ten times per second (`hz 10`), inside `serverCron`, Redis runs a probabilistic sweep:

```
   LOOP (up to a time budget of ~25% of the CPU in fast mode):
     1. Sample 20 random keys from db->expires
     2. Delete the ones that are already expired
     3. If MORE THAN 25% of the sample were expired
            → the dictionary is probably full of dead keys
            → repeat immediately from step 1
        else
            → stop; try again in the next cron tick
```

This is elegant: the probability that more than 25% of keys are expired-but-present converges to under 25% within a few iterations, without ever scanning the whole keyspace. The cost is proportional to how many keys are actually expired, not to how many keys exist.

```
   Sample 20 →  ●●●●●○○○○○○○○○○○○○○○   5/20 = 25% expired  → borderline, repeat
   Sample 20 →  ●●○○○○○○○○○○○○○○○○○○   2/20 = 10% expired  → stop, cheap
   Sample 20 →  ●●●●●●●●●●●●●●●○○○○○  15/20 = 75% expired  → repeat aggressively
                ● = expired    ○ = alive
```

:::note[The consequences you can actually observe]
- `DBSIZE` may **overcount**: it includes expired-but-not-yet-collected keys.
- `used_memory` may lag behind what "should" have been freed.
- `RANDOMKEY` will not return an expired key — it filters them.
- **A replica never expires keys on its own.** It waits for the `DEL` that the primary replicates, so that primary and replica agree. A read on a replica for a logically-expired key returns `nil` (the replica checks the clock) but the key remains in the replica's memory until the primary's `DEL` arrives. This preserves consistency — otherwise a replica's clock drift would create divergence.
:::

### Expiry vs. eviction — get this right

| | **Expiry** | **Eviction** |
| :--- | :--- | :--- |
| Trigger | Time passed (a TTL you set) | `maxmemory` reached |
| Which keys | Only keys with a TTL | Depends on `maxmemory-policy` — may include keys with no TTL |
| Predictable? | Yes — you chose the time | No — depends on memory pressure |
| Your control | `EXPIRE` | `maxmemory-policy` |
| Observable in | `INFO stats: expired_keys` | `INFO stats: evicted_keys` |

**"My key vanished before its TTL"** is almost always eviction, not expiry. Check `evicted_keys`. Full treatment in [Expiration & Eviction](./15-expiration-and-eviction.md).

---

## 6. Finding keys: `KEYS` vs `SCAN`

### `KEYS` — the command that will get you paged

```bash
KEYS *              # every key
KEYS user:*         # every key starting with user:
KEYS user:?0:*      # ? matches one char
KEYS user:[13]:*    # character class
```

`KEYS` is **O(N) over the entire keyspace** and it runs on the single thread. On 10 million keys it can block the server for **several seconds**. Every other client — every request in your application — waits.

```
   ┌─────────────────────────────────────────────────────────┐
   │  t=0.000s  client A: KEYS *                             │
   │  t=0.001s  client B: GET foo    ← queued                │
   │  t=0.002s  client C: SET bar 1  ← queued                │
   │     …      2,000 more clients   ← queued                │
   │  t=3.400s  KEYS finishes, ships a 400 MB reply          │
   │  t=3.401s  everyone else finally runs                   │
   │            your p99 latency for this second: 3,400 ms   │
   └─────────────────────────────────────────────────────────┘
```

:::danger[Rule]
**Never run `KEYS` against a production server.** Not "be careful with" — never. Rename it away in `redis.conf`:
```conf
rename-command KEYS ""
```
It is acceptable only on a local dev database with a few hundred keys.
:::

### `SCAN` — the cursor-based way

`SCAN` returns a **small batch plus a cursor**. You call it repeatedly until the cursor comes back `0`. Each call is O(1)-ish, so the server never blocks.

```bash
127.0.0.1:6379> SCAN 0 MATCH user:* COUNT 100
1) "17"                 ← the next cursor. NOT an offset, NOT a count.
2) 1) "user:1042"
   2) "user:1043"

127.0.0.1:6379> SCAN 17 MATCH user:* COUNT 100
1) "0"                  ← 0 means the iteration is complete
2) 1) "user:1044"
```

```ts
// the correct loop, every time
let cursor = '0';
do {
  const [next, keys] = await redis.scan(cursor, 'MATCH', 'user:*', 'COUNT', 100);
  cursor = next;                       // ← the ONLY termination signal
  for (const key of keys) await handle(key);
} while (cursor !== '0');
```

```ts
// ioredis also exposes it as a Node stream, which handles the loop for you
const stream = redis.scanStream({ match: 'user:*', count: 100 });

for await (const keys of stream) {
  if (keys.length === 0) continue;     // empty batches are normal — see below
  await Promise.all(keys.map(handle));
}
```

```bash
# or just let the CLI do it
redis-cli --scan --pattern 'user:*'
redis-cli --scan --pattern 'session:*' | xargs -L 100 redis-cli UNLINK
```

#### The guarantees — say these exactly in an interview

A full `SCAN` iteration guarantees:

1. ✅ **Every key present at the start AND at the end of the iteration is returned at least once.**
2. ✅ **A key added and removed entirely during the iteration may or may not be returned.**
3. ⚠️ **A key may be returned MULTIPLE times.** Your code must be idempotent, or de-duplicate with a `Set`.
4. ⚠️ **No snapshot.** You are scanning a live, changing keyspace.

Compare with `KEYS`, which gives you an exact, atomic snapshot — at the cost of freezing the server. That is the trade.

#### `COUNT` and `MATCH` — the two gotchas

- **`COUNT` is a hint, not a limit.** It tells Redis roughly how much work to do per call (default 10). A call may return more or fewer elements — **including zero elements with a non-zero cursor**. An empty batch does *not* mean you are done; only `cursor == "0"` means done. Getting this wrong is the classic `SCAN` bug.
- **`MATCH` filters *after* fetching.** Redis pulls `COUNT` keys from the table, then discards non-matching ones. So `SCAN 0 MATCH rare:*` over 10 M keys still walks 10 M keys — it just returns almost nothing each call. It is safe (never blocking) but not instant.

#### How the cursor works — reverse binary iteration

This is the internals question, and it is genuinely clever.

The cursor is **a bucket index of the hash table, with its bits reversed**. Redis increments the cursor by adding 1 to the *most significant* bit and carrying *rightward*:

```
  normal counting:   000 → 001 → 010 → 011 → 100 → 101 → 110 → 111
  reverse binary:    000 → 100 → 010 → 110 → 001 → 101 → 011 → 111
```

Why bother? Because the keyspace hash table **resizes during your scan** ([rehashing](./13-internals-memory-and-encodings.md)). When the table doubles from 4 buckets to 8, the contents of old bucket `01` split across new buckets `001` and `101`. With reverse-binary ordering, those two buckets are visited *after* the cursor you already hold, so nothing is skipped. With normal ordering, a resize would scatter unvisited keys into buckets you already passed — and you would miss them.

That is the whole reason guarantee #1 holds while the table grows and shrinks underneath you, and the reason keys can repeat (a shrink can pull an already-visited key into a bucket you have not reached).

#### The `SCAN` family

The same cursor mechanism works *inside* a collection:

```bash
SCAN   cursor [MATCH p] [COUNT n] [TYPE string]   # the keyspace
HSCAN  key cursor [MATCH p] [COUNT n] [NOVALUES]  # fields of a hash
SSCAN  key cursor [MATCH p] [COUNT n]             # members of a set
ZSCAN  key cursor [MATCH p] [COUNT n]             # members+scores of a sorted set
```

Use these instead of `HGETALL`/`SMEMBERS`/`ZRANGE 0 -1` on any collection that might be large. `TYPE` on `SCAN` (Redis 6+) filters by value type server-side — handy for "find all my lists".

---

## 7. Logical databases (and why to ignore them)

Redis ships with 16 numbered databases, `0`–`15`.

```bash
SELECT 1          # switch this connection to db 1
SWAPDB 0 1        # atomically swap two databases
MOVE key 1        # move one key to db 1
FLUSHDB           # wipe the current db only
INFO keyspace     # db0:keys=1000,... db1:keys=5,...
```

They are **namespaces on one process**, not separate servers:

- They share **one thread**, so a slow command in db 3 blocks db 0.
- They share **one memory limit** and **one eviction pool**.
- They share **one persistence file** — you cannot back up db 1 alone.
- **Redis Cluster supports only db 0.** Any code using `SELECT` cannot be moved to Cluster without a rewrite.
- Connection-pooled clients must re-issue `SELECT` per checkout, a classic source of "my data went to the wrong database" bugs.

:::warning[Practical guidance]
antirez himself has called numbered databases a design mistake. **Use key prefixes instead of databases.** `staging:user:1` and `prod:user:1` in db 0 beats db 1 and db 2 in every dimension.

The one defensible use is a genuinely separate concern on a dev box, or `SWAPDB` for an atomic cache rebuild: build the new dataset in db 1, then `SWAPDB 0 1` to flip it in instantly.
:::

---

## 8. Keyspace notifications

Redis can publish an event whenever a key changes. This is how you build cache-invalidation fan-out or "session expired" hooks.

```bash
CONFIG SET notify-keyspace-events "KEA"    # everything (noisy)
CONFIG SET notify-keyspace-events "Ex"     # just expired-key events
```

The flag characters:

```
 K  keyspace events:  __keyspace@<db>__:<key>  → <event>
 E  keyevent events:  __keyevent@<db>__:<event> → <key>
 g  generic commands (DEL, EXPIRE, RENAME…)
 $  string   l  list    s  set    h  hash    z  sorted set
 x  expired  e  evicted  t  stream   n  new key   m  key-miss
 A  alias for "g$lshzxet" — everything except m and n
```

```bash
# terminal 1
redis-cli PSUBSCRIBE '__keyevent@0__:expired'

# terminal 2
redis-cli SET temp "x" EX 5
# ...five seconds later, terminal 1 prints:
#   pmessage  __keyevent@0__:expired  temp
```

:::danger[Three things people get wrong about expired-key events]
1. **The event fires when the key is *collected*, not when it logically expires.** Because collection is lazy + probabilistic, the notification can arrive seconds late. Never use it for anything time-critical.
2. **Delivery is fire-and-forget Pub/Sub.** If no subscriber is connected, the event is lost forever. There is no queue, no replay, no acknowledgement. For reliable delivery use [Streams](./11-streams.md).
3. **The event carries the key name, not the value** — the value is already gone. If you need the value, store it elsewhere or use a Stream.
:::

---

## 9. Worked example: designing the keyspace for a small app

A blogging app. Requirements: user profiles, posts, per-post view counts, tags, a homepage cache, session storage, and rate limiting.

```bash
# ── Users ────────────────────────────────────────────────────────────
HSET   user:1042 name "Ada" email "ada@x.com" joined 1735689600
SET    user:email:5e88…  1042              # sha256(email) → id, a secondary index
                                            # (raw email in a key would be PII in logs)

# ── Posts ────────────────────────────────────────────────────────────
HSET   post:88 title "Redis internals" author 1042 body "…" created 1756...
SADD   post:88:tags redis database internals
SADD   tag:redis:posts 88 91 104            # the reverse index
INCR   post:88:views                        # a plain counter, no TTL

# ── Feeds & ranking ──────────────────────────────────────────────────
LPUSH  user:1042:timeline 88                # newest first
LTRIM  user:1042:timeline 0 999             # bounded: keep 1000
ZADD   posts:trending 1523 88               # score = a computed hotness value

# ── Ephemeral state ──────────────────────────────────────────────────
SET    session:s_7f3a "{\"uid\":1042}" EX 86400
SET    cache:v2:homepage "<html>…" EX 60
INCR   ratelimit:ip:203.0.113.9:1756742400  # bucketed per minute
EXPIRE ratelimit:ip:203.0.113.9:1756742400 120
SET    lock:post:88:reindex <uuid> NX EX 30
```

Read the shape of it:

```
  PERMANENT (no TTL)          EPHEMERAL (TTL, safe to lose)
  ────────────────────        ─────────────────────────────
  user:*                      session:*      24 h
  post:*                      cache:v2:*     60 s
  tag:*:posts                 ratelimit:*    120 s
  post:*:views                lock:*         30 s
  posts:trending
  user:*:timeline (LTRIM-bounded)
```

Two questions worth asking of every key you ever add:

1. **Does it have a bound?** Either a TTL or an explicit trim (`LTRIM`, `ZREMRANGEBYRANK`). A key with neither grows forever. Unbounded keys are how Redis instances die.
2. **Which job is it doing?** If losing it costs only latency, it can live in an `allkeys-lru` instance. If losing it changes behaviour (a counter, a lock, a queue), it needs persistence — and quite possibly a *different instance* with `noeviction`, so a cache surge cannot evict your locks.

---

## Rapid-fire recall

1. What does `TTL key` return for (a) a key with no expiry, (b) a key that does not exist?
2. Which common command silently deletes a key's TTL, and what are the two fixes?
3. Give the four guarantees of a full `SCAN` iteration.
4. `SCAN` returned an empty array and cursor `"31"`. Are you done?
5. Why does the `SCAN` cursor use reverse binary increments?
6. Why does a replica not expire keys by itself?
7. What is the difference between `expired_keys` and `evicted_keys` in `INFO`?
8. Why do people say to use key prefixes instead of numbered databases?
9. Why should `UNLINK` be your default instead of `DEL`?

<details>
<summary>Answers</summary>

1. (a) `-1`, (b) `-2`.
2. `SET` without flags. Fix with `SET … KEEPTTL` or `SET … EX <n>`. Commands that *modify in place* (`INCR`, `HSET`, `LPUSH`, `APPEND`…) preserve the TTL.
3. Keys present for the whole iteration are returned at least once; keys added-and-removed during it may or may not appear; keys may be returned more than once; there is no snapshot.
4. No. Only `cursor == "0"` means done. `COUNT` is a hint and `MATCH` filters after fetching, so empty batches are normal.
5. So that when the hash table grows or shrinks mid-iteration, buckets that split are always visited *after* the current cursor — nothing gets skipped.
6. To stay byte-identical with the primary. The replica waits for the primary's replicated `DEL`; it only *hides* logically-expired keys from reads.
7. `expired_keys` = deleted because their TTL passed. `evicted_keys` = deleted because `maxmemory` was hit. A non-zero `evicted_keys` means memory pressure.
8. Databases share one thread, one memory cap, one eviction pool, and one persistence file, and Cluster supports only db 0 — so they give isolation in name only while blocking your future scaling path.
9. `DEL` frees every element on the main thread, so deleting a huge collection blocks all clients; `UNLINK` returns immediately and frees in the background.

</details>

---

**Next:** [RESP — The Wire Protocol](./04-protocol-resp.md) — what actually travels over the socket, and why it parses so fast.
