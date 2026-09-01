---
title: Strings
author: Tejas Nirala
---

# Strings

> **What you will be able to do after this page**
>
> - Use every `SET` flag correctly, and know which one prevents the TTL bug.
> - Explain SDS — why Redis did not use C strings — and the three string encodings.
> - Build an atomic counter, a distributed lock, and a rate limiter from primitives.
> - Know exactly when a String should have been a Hash.

The String is the simplest Redis type and by far the most used. It is also more interesting than it looks: it is a **binary-safe byte array up to 512 MB** that Redis will treat as a number, a bitmap, or a byte-addressable buffer depending on which command you point at it.

---

## 1. The mental model

```
   key                       value
   ─────────────────────     ─────────────────────────────────────────
   "user:1:name"        →    "Ada Lovelace"        ← text
   "user:1:visits"      →    42                    ← integer (encoded as such)
   "user:1:avatar"      →    <PNG bytes>           ← binary
   "cache:page:home"    →    "{\"posts\":[…]}"     ← serialized JSON
   "flags:online"       →    0b10110100…           ← a bitmap (see the bitmaps page)
```

One key, one value, up to 512 MB. The *same value* can be manipulated as text (`APPEND`), as a number (`INCR`), as a bit array (`SETBIT`), or as a byte range (`SETRANGE`) — Redis interprets it per command.

---

## 2. `SET` — every flag matters

```bash
SET key value
    [EX sec | PX ms | EXAT unix-sec | PXAT unix-ms | KEEPTTL]
    [NX | XX]
    [GET]
```

| Flag | Meaning | The reason it exists |
| :--- | :--- | :--- |
| `EX n` | Expire in n seconds | Atomic value+TTL in one command |
| `PX n` | Expire in n milliseconds | Sub-second locks |
| `EXAT ts` | Expire at an absolute time | "Expires at midnight" without clock math |
| `KEEPTTL` | Preserve the existing TTL | **Fixes the #1 Redis bug** |
| `NX` | Only set if the key does **N**ot e**X**ist | Distributed locks |
| `XX` | Only set if it already e**X**ists | "Refresh, don't create" |
| `GET` | Return the old value | Atomic read-and-replace (Redis 6.2+) |

```bash
SET k v                      # → OK
SET k v EX 60                # → OK,  TTL 60
SET k v NX                   # → OK if created; (nil) if k already existed
SET k v XX                   # → OK if replaced; (nil) if k did not exist
SET k v KEEPTTL              # → OK,  the old TTL survives
SET k new GET                # → "v"  (the OLD value), and k is now "new"
SET k v NX EX 30             # → the distributed-lock primitive
```

:::danger[The TTL trap, restated because it bites everyone]
```bash
SET session:abc "data" EX 3600
SET session:abc "updated"        # ← TTL is now GONE. The key is immortal.
TTL session:abc                  # (integer) -1
```
Every plain `SET` on an existing key wipes its expiry. Your session store leaks. Use `KEEPTTL` or re-specify `EX`. Full table of which commands preserve TTLs is on [Keys & The Keyspace](./03-keys-and-the-keyspace.md).
:::

### Related setters

```bash
SETNX key value          # legacy: SET if not exists. Prefer SET ... NX.
SETEX key 60 value       # legacy: SET with expiry. Prefer SET ... EX.
PSETEX key 60000 value   # ms variant
MSET k1 v1 k2 v2         # set many, ATOMICALLY. Always → OK
MSETNX k1 v1 k2 v2       # all-or-nothing: 0 if ANY key already exists
GETSET key value         # deprecated (clears TTL!) — use SET ... GET
```

`MSETNX` is genuinely all-or-nothing: if even one key exists, nothing is written. That is a rarely-needed but occasionally perfect primitive for "initialize this config block only if it has never been initialized".

---

## 3. Reading

```bash
GET key                  # → the value, or (nil)
MGET k1 k2 k3            # → an array; missing keys come back as (nil) in place
STRLEN key               # → length in bytes. O(1) — SDS stores the length.
GETRANGE key 0 4         # → substring, inclusive both ends; negatives from the end
GETDEL key               # → value, and delete atomically (Redis 6.2+)
GETEX key EX 60          # → value, and (re)set the TTL (Redis 6.2+)
GETEX key PERSIST        # → value, and remove the TTL
```

```bash
SET greeting "Hello World"
GETRANGE greeting 0 4        # "Hello"
GETRANGE greeting -5 -1      # "World"
GETRANGE greeting 0 -1       # "Hello World"  (the whole thing)
STRLEN greeting              # (integer) 11
```

:::tip[`MGET` is one of the biggest easy wins in Redis]
```ts
// ❌ 100 round trips ≈ 50 ms
const users: (string | null)[] = [];
for (const id of ids) users.push(await redis.get(`user:${id}`));

// ✅ 1 round trip ≈ 0.6 ms
const users: (string | null)[] = await redis.mget(ids.map((id) => `user:${id}`));
```

Note the return type: `mget` gives you `null` **in position** for every missing key, so the array always has the same length and order as your input. Zip it back yourself:

```ts
const found = ids
  .map((id, i) => [id, users[i]] as const)
  .filter((pair): pair is readonly [string, string] => pair[1] !== null);
```
Same server-side work, ~80× less wall-clock time. The N+1 problem exists in Redis exactly as it does in SQL, and `MGET` is the fix. (In Cluster, `MGET` across slots needs a client that splits the request — see [Cluster](./22-cluster.md).)
:::

---

## 4. Numbers: atomic counters

If a String looks like a base-10 64-bit integer, Redis will do arithmetic on it **atomically**.

```bash
INCR key                 # +1     → the new value
DECR key                 # -1
INCRBY key 100           # +100 (may be negative)
DECRBY key 50
INCRBYFLOAT key 1.5      # floating point; no DECRBYFLOAT — use a negative
```

```bash
127.0.0.1:6379> INCR pageviews        # key doesn't exist
(integer) 1                            # ← treated as 0, then incremented
127.0.0.1:6379> INCR pageviews
(integer) 2
127.0.0.1:6379> INCRBY pageviews 10
(integer) 12
127.0.0.1:6379> SET pageviews "abc"
127.0.0.1:6379> INCR pageviews
(error) ERR value is not an integer or out of range
```

Note the two behaviours worth memorizing: **a missing key is treated as 0**, and a non-numeric value is a hard error (not a silent 0).

### Why atomicity here is the whole point

```
   WITHOUT an atomic INCR — the classic lost update
   ─────────────────────────────────────────────────────────
   t   Client A                     Client B          counter
   1   GET counter → 10                                 10
   2                                GET counter → 10    10
   3   compute 10+1 = 11                                10
   4                                compute 10+1 = 11   10
   5   SET counter 11                                   11
   6                                SET counter 11      11   ← WRONG, should be 12

   WITH INCR
   ─────────────────────────────────────────────────────────
   t   Client A     Client B                            counter
   1   INCR ────────────────────────► executes           11
   2                INCR ───────────► executes           12   ✅
```

Because Redis executes one command at a time, `INCR` cannot interleave. **You get correctness for free, from the single-threaded design.** No transaction, no lock, no compare-and-swap loop.

### `INCRBYFLOAT` and money

```bash
SET price 10.50
INCRBYFLOAT price 0.10      # "10.6"
INCRBYFLOAT price -0.10     # "10.5"
```

The value is stored as a string and re-parsed each time, so this is not IEEE-754 accumulation drift in the usual sense — but it is still decimal-string arithmetic with a 17-significant-digit limit. **For money, count integer minor units** (`INCRBY balance_paise 1050`) rather than floats. Same advice as everywhere else.

---

## 5. Byte manipulation

```bash
APPEND key value         # → the new total length
SETRANGE key offset val  # overwrite bytes starting at offset; zero-pads gaps
GETRANGE key start end
```

```bash
127.0.0.1:6379> SET log "line1"
127.0.0.1:6379> APPEND log "\nline2"
(integer) 11
127.0.0.1:6379> GET log
"line1\nline2"

127.0.0.1:6379> SET greeting "Hello World"
127.0.0.1:6379> SETRANGE greeting 6 "Redis"
(integer) 11
127.0.0.1:6379> GET greeting
"Hello Redis"

127.0.0.1:6379> DEL k
127.0.0.1:6379> SETRANGE k 5 "hi"       # gap is filled with NUL bytes
(integer) 7
127.0.0.1:6379> GET k
"\x00\x00\x00\x00\x00hi"
```

`APPEND` is O(1) amortized because SDS over-allocates (see §7). This makes an append-only log in a String genuinely cheap — though a [List](./06-lists.md) or [Stream](./11-streams.md) is usually the better structure, because a String has no way to read "the last N entries" without transferring the whole thing.

---

## 6. Real patterns, complete

### Cache-aside

```ts
const NEGATIVE = '\0';                 // a sentinel no real payload will collide with

async function getUser(id: string): Promise<User | null> {
  const key = `cache:v1:user:${id}`;

  const hit = await redis.get(key);
  if (hit === NEGATIVE) return null;                    // a cached "does not exist"
  if (hit !== null) return JSON.parse(hit) as User;     // note: !== null, not falsy

  const user = await db.users.findById(id);

  if (!user) {
    await redis.set(key, NEGATIVE, 'EX', 60);           // cache the negative, briefly
    return null;                                         // ← prevents cache penetration
  }

  await redis.set(key, JSON.stringify(user), 'EX', 300);
  return user;
}
```

Caching the *absence* of a row for a short TTL is called a **negative cache**, and it defends against an attacker hammering you with requests for IDs that do not exist — each of which would otherwise be a full database query. Details in [Caching Patterns](./25-caching-patterns.md).

### Distributed lock

```bash
SET lock:order:9981 <random-uuid> NX PX 30000
# → OK   you hold the lock for 30 seconds
# → nil  someone else holds it
```

Releasing must be conditional on **you** still being the owner, which needs a script because check-then-delete is two operations:

```lua
-- release.lua — KEYS[1] = lock key, ARGV[1] = your uuid
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
```

```ts
import { randomUUID } from 'node:crypto';

// defineCommand registers the script once; ioredis handles EVALSHA + NOSCRIPT retry
redis.defineCommand('releaseLock', { numberOfKeys: 1, lua: RELEASE_LUA });

async function withLock<T>(resource: string, ttlMs: number, fn: () => Promise<T>) {
  const token = randomUUID();
  const key = `lock:${resource}`;

  const acquired = await redis.set(key, token, 'NX', 'PX', ttlMs);
  if (acquired !== 'OK') throw new Error(`could not acquire ${key}`);

  try {
    return await fn();
  } finally {
    await redis.releaseLock(key, token);      // only deletes if WE still own it
  }
}
```

The uuid, the expiry, and the conditional release are all mandatory. Why each one, and the honest limits of the whole approach, are in [Distributed Locks](./26-distributed-locks.md).

### Fixed-window rate limiter

```lua
-- KEYS[1] = "ratelimit:user:1042:<minute-bucket>",  ARGV[1] = limit, ARGV[2] = window
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return current <= tonumber(ARGV[1]) and 1 or 0
```

```ts
declare module 'ioredis' {
  interface RedisCommander<Context> {
    rateLimit(key: string, limit: number, windowSec: number): Promise<number>;
  }
}

redis.defineCommand('rateLimit', { numberOfKeys: 1, lua: RATE_LIMIT_LUA });

async function allow(userId: string, limit = 100, windowSec = 60): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  return (await redis.rateLimit(`ratelimit:user:${userId}:${bucket}`, limit, windowSec)) === 1;
}
```

That `declare module` block is how you get type safety on a custom Lua command in ioredis — worth doing, because otherwise every script call is `any`.

The `current == 1` check sets the TTL only on the first request of a window — so the window is anchored to the first request, not slid on every one. The failure mode of fixed windows (2× burst at a boundary) and the sliding-window fix are in [Rate Limiting](./27-rate-limiting.md).

### Session store

```ts
interface Session { uid: string; roles: string[] }

await redis.set(`session:${sid}`, JSON.stringify(session), 'EX', 86_400);

// sliding expiry — read AND refresh in ONE round trip
const raw = await redis.getex(`session:${sid}`, 'EX', 86_400);
const session: Session | null = raw === null ? null : (JSON.parse(raw) as Session);
```

`GETEX` does read-and-refresh atomically; without it you needed `GET` + `EXPIRE`, two round trips and a race.

### Optimistic ID generation

```bash
INCR global:user:id     # → 1000001, guaranteed unique across every client
```

One of the cleanest uses of Redis. Note it is **not gap-free** — if the caller crashes after `INCR`, that ID is burned. For dense sequences you need the database. For "unique" this is perfect and vastly faster than a database sequence.

---

## 7. Internals: SDS and the three encodings

### Why not C strings?

C strings are NUL-terminated: `"Ada\0"`. That gives you three problems a database cannot accept.

1. **Not binary-safe.** A JPEG contains `0x00` bytes; a C string would truncate there.
2. **`strlen()` is O(N).** It scans for the terminator. `STRLEN` must be O(1).
3. **Every append risks a buffer overflow** unless you check capacity by hand every time.

So Redis defines **SDS — Simple Dynamic String**:

```c
struct sdshdr8 {
    uint8_t  len;      // bytes currently used
    uint8_t  alloc;    // bytes allocated (excluding header and terminator)
    unsigned char flags;   // 3 bits: which header size this is (5/8/16/32/64)
    char     buf[];    // the actual bytes, plus a trailing '\0' for free
};
```

```
   SDS layout for "Ada"
   ┌─────┬───────┬───────┬───────────────────────┐
   │ len │ alloc │ flags │  A  d  a  \0          │
   │  3  │   3   │  8-bit│                       │
   └─────┴───────┴───────┴───────────────────────┘
                          ▲
                          └─ the pointer Redis passes around points HERE,
                             so an SDS can be handed to any C function
                             expecting a char* (printf, strcasecmp, …)
```

What this buys:

| Property | How |
| :--- | :--- |
| **O(1) `STRLEN`** | Read `len`. |
| **Binary safe** | Length-delimited, not NUL-delimited. NUL bytes are just data. |
| **Overflow-proof appends** | `sdscat` checks `alloc - len` and grows first. |
| **Amortized O(1) `APPEND`** | On growth under 1 MB, Redis allocates **2×** what is needed; beyond 1 MB it adds a flat 1 MB. So repeated appends rarely reallocate. |
| **Compatible with C** | The trailing `\0` means `printf("%s", sds)` works for text. |
| **Low overhead for small strings** | Five header sizes (`sdshdr5/8/16/32/64`) — a 10-byte string pays a 3-byte header, not a 16-byte one. |

### The three String encodings

```bash
127.0.0.1:6379> SET n 12345
127.0.0.1:6379> OBJECT ENCODING n
"int"

127.0.0.1:6379> SET s "hello"
127.0.0.1:6379> OBJECT ENCODING s
"embstr"

127.0.0.1:6379> SET l "a string longer than forty-four characters, definitely"
127.0.0.1:6379> OBJECT ENCODING l
"raw"

127.0.0.1:6379> SET n 12345
127.0.0.1:6379> APPEND n "6"
127.0.0.1:6379> OBJECT ENCODING n
"raw"                    # ← APPEND always converts to raw; it never converts back
```

| Encoding | When | Layout | Why |
| :--- | :--- | :--- | :--- |
| **`int`** | The value is a base-10 integer that fits in a `long` | The number is stored **directly in the `redisObject`'s pointer field** — no separate allocation at all | Zero allocation, and `INCR` is a register add |
| **`embstr`** | Length ≤ 44 bytes | `redisObject` **and** SDS in **one contiguous 64-byte malloc** | One allocation instead of two; both halves land in the same CPU cache line |
| **`raw`** | Length > 44 bytes, or the value was ever mutated | `redisObject` and SDS are two separate allocations | Needed when the buffer must grow independently |

```
   embstr — one allocation, cache-friendly
   ┌───────────────────────────────────────────────────────┐
   │ redisObject (16 B) │ sdshdr8 (3 B) │ "hello" │ \0     │   ← 64 bytes total
   │ type/enc/lru/rc/ptr┼──────────────►│                  │
   └───────────────────────────────────────────────────────┘

   raw — two allocations, two potential cache misses
   ┌────────────────────┐        ┌──────────────────────────────┐
   │ redisObject   ptr ─┼───────►│ sdshdr │ "a longer string…"  │
   └────────────────────┘        └──────────────────────────────┘
```

:::note[Why exactly 44?]
A `redisObject` is 16 bytes. An `sdshdr8` header is 3 bytes. jemalloc's most convenient small size class is **64 bytes**. `64 − 16 − 3 − 1 (the NUL) = 44`. The constant is not arbitrary — it is the largest string that still fits the object and its data into a single 64-byte allocation.

(It was 39 before Redis 3.2, when the SDS header was larger. If you see 39 in an old article, that is why.)
:::

:::warning[`embstr` is immutable in practice]
An `embstr` shares one allocation with its object, so it cannot grow in place. Any mutating command (`APPEND`, `SETRANGE`, `SETBIT`) converts it to `raw` — **permanently**, even if the result is short. This is why a key you `APPEND` to repeatedly consumes more memory than the same value written once with `SET`. If you find yourself surprised by `used_memory`, `OBJECT ENCODING` is the first thing to check.
:::

### Shared integers

```bash
127.0.0.1:6379> SET a 100
127.0.0.1:6379> OBJECT REFCOUNT a
(integer) 2147483647        # INT_MAX = "shared, never free this"
```

Redis preallocates `redisObject`s for the integers **0–9999** at startup. Every key whose value is a small integer points at the same shared object. A million keys holding the value `1` cost a million hash-table entries but **zero** value allocations.

This is also why `maxmemory-policy` with LRU has a wrinkle: shared objects cannot carry a per-key LRU clock, so Redis disables integer sharing when an LRU/LFU policy is active.

---

## 8. Memory: the number that surprises people

```bash
127.0.0.1:6379> SET k v
127.0.0.1:6379> MEMORY USAGE k
(integer) 56
```

Two bytes of data, 56 bytes of memory. Where it goes:

```
   dictEntry (key ptr, value ptr, next ptr)          24 bytes
   the key's SDS  ("k": header + 1 byte + NUL)       ~8 bytes (allocator-rounded)
   the value redisObject + embstr SDS                ~16 bytes
   hash table slot amortized                          ~8 bytes
   jemalloc size-class rounding                        varies
   ──────────────────────────────────────────────────────────
                                                     ~56 bytes
```

**Overhead per key is roughly 50–90 bytes before your data.** The implications are direct:

```
   10,000,000 keys × 60 B overhead   =   600 MB   before a single byte of value
```

:::tip[The single biggest memory optimization in Redis]
```bash
# ❌ 3 keys, ~200 bytes of overhead
SET user:1:name  "Ada"
SET user:1:email "ada@x.com"
SET user:1:age   "36"

# ✅ 1 key, ~100 bytes total, and one round trip to read it all
HSET user:1 name "Ada" email "ada@x.com" age 36
```

A small Hash is stored as a **listpack** — a single flat, contiguous byte array with no per-field pointers, no per-field `redisObject`, no per-field dictEntry. For objects with a handful of small fields the saving is often **5–10×**, and `HGETALL` reads them all in one trip.

**Rule: if fields share a lifetime and are read together, they belong in a Hash.** See [Hashes](./07-hashes.md).
:::

---

## 9. The 512 MB limit, and why you should stop far short of it

A String can hold 512 MB. You should treat a few hundred **kilobytes** as your practical ceiling.

- Reading a 100 MB value copies 100 MB into an output buffer **on the single thread** — every other client stalls.
- Replicas must receive all 100 MB on every write.
- `APPEND`-driven growth reallocs and copies repeatedly.
- The allocator fragments badly around huge blocks.

`redis-cli --bigkeys` finds these. When you have one, the fix is almost always to split it into a Hash, a List, or a Stream so you can read a slice instead of the whole thing.

---

## 10. Complete command table

| Command | Complexity | Returns |
| :--- | :--- | :--- |
| `SET k v [flags]` | O(1) | `OK` / `nil` (NX/XX failed) / old value (`GET`) |
| `GET k` | O(1) | value / `nil` |
| `MSET k v …` | O(N) | `OK` |
| `MGET k …` | O(N) | array, `nil` for missing |
| `MSETNX k v …` | O(N) | 1 all set, 0 none set |
| `GETSET k v` | O(1) | old value *(deprecated — clears TTL)* |
| `GETDEL k` | O(1) | value, then deletes |
| `GETEX k [EX…]` | O(1) | value, adjusts TTL |
| `SETNX k v` | O(1) | 1 / 0 *(legacy)* |
| `SETEX k s v` | O(1) | `OK` *(legacy)* |
| `STRLEN k` | O(1) | length in bytes |
| `APPEND k v` | O(1) amortized | new length |
| `SETRANGE k off v` | O(len of v) | new length |
| `GETRANGE k s e` | O(N) | substring |
| `INCR` / `DECR` | O(1) | new value |
| `INCRBY` / `DECRBY` | O(1) | new value |
| `INCRBYFLOAT k f` | O(1) | new value as a string |
| `LCS k1 k2` | O(N·M) | longest common subsequence (Redis 7+) |

---

## Rapid-fire recall

1. Which `SET` flag prevents the TTL-loss bug, and which flag makes a lock possible?
2. `INCR` on a key that does not exist — error, or something else?
3. Why is `INCR` correct under concurrency without any locking?
4. Name the three String encodings and the condition for each.
5. Why is the `embstr` threshold 44 bytes specifically?
6. Why does `APPEND` on a short string increase memory usage more than you would expect?
7. Roughly how much memory does an empty key cost before its value?
8. Three separate `SET user:1:*` keys vs one Hash — what is the saving and why?
9. What is a negative cache and what attack does it defend against?

<details>
<summary>Answers</summary>

1. `KEEPTTL` preserves the expiry; `NX` (set-if-not-exists) combined with `PX` is the lock primitive.
2. Missing keys are treated as `0`, so `INCR` returns `1`. A non-numeric *existing* value is a hard error.
3. Redis executes one command at a time on a single thread, so read-modify-write cannot interleave — the lost-update race is structurally impossible.
4. `int` (value is an integer fitting in a long, stored inline in the object pointer); `embstr` (≤ 44 bytes, object + SDS in one 64-byte allocation); `raw` (> 44 bytes, or after any mutation).
5. `64 (jemalloc size class) − 16 (redisObject) − 3 (sdshdr8) − 1 (NUL) = 44`.
6. `APPEND` converts `embstr` → `raw` permanently, splitting one allocation into two, and SDS over-allocates (2× under 1 MB) to make future appends cheap.
7. About 50–90 bytes: dictEntry, key SDS, value `redisObject`, hash slot, and allocator rounding.
8. Roughly 5–10× less memory plus one round trip instead of three, because a small Hash is a single flat listpack with no per-field object or pointer overhead.
9. Caching "this key does not exist" for a short TTL, so repeated lookups of non-existent IDs do not each become a database query — a defence against cache penetration.

</details>

---

**Next:** [Lists](./06-lists.md) — queues, stacks, and the blocking commands that remove polling from your architecture.
