---
title: Hashes
author: Tejas Nirala
---

# Hashes

> **What you will be able to do after this page**
>
> - Model an object in Redis without wasting 10× the memory.
> - Know exactly when a Hash beats a serialized JSON String, and when it does not.
> - Explain the listpack → hashtable conversion and why it is one-way.
> - Use hash-field TTLs, and know what people did before they existed.

A Hash is a **map from field names to string values**, stored under one key. It is Redis's object type — the natural home for "a user", "a product", "a config block".

---

## 1. The mental model

```
   key "user:1042"
   ┌──────────────────────────────────────┐
   │  field         │  value              │
   ├────────────────┼─────────────────────┤
   │  name          │  "Ada Lovelace"     │
   │  email         │  "ada@example.com"  │
   │  age           │  "36"               │
   │  city          │  "London"           │
   │  login_count   │  "42"               │
   └────────────────┴─────────────────────┘
```

It is one key in the keyspace. Fields are **not** keys — you cannot `EXPIRE` a field (before Redis 7.4), you cannot `SCAN` the keyspace for a field, and a Cluster hashes only the outer key, so the entire hash always lives on one node.

Up to 2³² − 1 fields. Field names and values are both binary-safe strings. **There is no nesting**: a hash value cannot be another hash. If you need `user:1042.address.city`, you either flatten the field name (`address.city`) or serialize a JSON string into the field.

---

## 2. The commands

### Writing

```bash
HSET key field value [field value ...]   # → count of NEW fields added (not updated)
HSETNX key field value                   # → 1 if set, 0 if the field already existed
HDEL key field [field ...]               # → count deleted
HINCRBY key field n                      # → new value (integer)
HINCRBYFLOAT key field n                 # → new value (string)
# HMSET is deprecated — HSET has taken variadic arguments since Redis 4.0
```

```bash
127.0.0.1:6379> HSET user:1042 name "Ada" age 36 city "London"
(integer) 3                      ← three NEW fields
127.0.0.1:6379> HSET user:1042 age 37
(integer) 0                      ← zero NEW fields; the update still happened
127.0.0.1:6379> HGET user:1042 age
"37"
```

:::warning[The `HSET` return value confuses everyone]
`HSET` returns the number of **newly created** fields, not the number written. Updating an existing field returns `0`. That is **not** a failure — the write succeeded. If your code does `if (await redis.hset(...)) { ... }` you have a bug that only appears on the second write.
:::

### Reading

```bash
HGET key field                # → value / nil
HMGET key f1 f2 f3            # → array, nil in place for missing fields
HGETALL key                   # → all fields and values
HKEYS key                     # → all field names
HVALS key                     # → all values
HLEN key                      # → number of fields — O(1)
HEXISTS key field             # → 1 / 0
HSTRLEN key field             # → byte length of a field's value
HRANDFIELD key [count] [WITHVALUES]   # → random field(s) (Redis 6.2+)
HSCAN key cursor [MATCH p] [COUNT n] [NOVALUES]
```

```bash
127.0.0.1:6379> HGETALL user:1042
1) "name"       ← RESP2 returns a FLAT array, alternating field, value, field, value
2) "Ada"
3) "age"
4) "37"
5) "city"
6) "London"
```

In TypeScript, ioredis reshapes that for you:

```ts
const user: Record<string, string> = await redis.hgetall('user:1042');
// { name: 'Ada', age: '37', city: 'London' }

// a hash that does not exist returns {} — NOT null. Check emptiness, not nullness.
if (Object.keys(user).length === 0) { /* miss */ }
```

:::danger[`HGETALL` on a big hash blocks the server]
`HGETALL` is O(N) and builds the entire reply in memory on the single thread. A hash with 500,000 fields is a 500,000-element reply — hundreds of milliseconds of stall for every client, plus a large output buffer.

- Know the field you want? → `HGET` / `HMGET`.
- Need to iterate a large hash? → `HSCAN` (cursor-based, non-blocking).
- Only need the names? → `HSCAN … NOVALUES` (Redis 7.4+) avoids transferring values entirely.

The real fix, though, is usually **not to have a hash with 500,000 fields**. See §6.
:::

### Atomic field counters

```bash
127.0.0.1:6379> HSET product:88 stock 100 views 0
127.0.0.1:6379> HINCRBY product:88 views 1
(integer) 1
127.0.0.1:6379> HINCRBY product:88 stock -1
(integer) 99
127.0.0.1:6379> HINCRBYFLOAT product:88 rating 4.5
"4.5"
```

`HINCRBY` is atomic exactly as `INCR` is — the whole read-modify-write happens with nothing else interleaved. This makes a Hash a genuinely good place for a bundle of related counters:

```bash
HINCRBY stats:2026-09-01 pageviews 1
HINCRBY stats:2026-09-01 signups   1
HINCRBY stats:2026-09-01 errors    1
HGETALL stats:2026-09-01      # the whole day's dashboard in one round trip
EXPIRE stats:2026-09-01 7776000   # 90 days, set once on the whole bundle
```

One key, one TTL, one round trip, and a fraction of the memory of nine separate `INCR` keys.

:::note[Decrementing stock is not the same as reserving it]
```bash
HINCRBY product:88 stock -1     # can go negative!
```
`HINCRBY` will happily take stock to −3. A correct reservation needs a conditional decrement, which needs Lua:

```lua
-- KEYS[1] = product hash, ARGV[1] = quantity
local stock = tonumber(redis.call('HGET', KEYS[1], 'stock'))
if stock == nil or stock < tonumber(ARGV[1]) then return 0 end
redis.call('HINCRBY', KEYS[1], 'stock', -ARGV[1])
return 1
```
This is the general shape of every "check then act" in Redis. See [Transactions & Scripting](./17-transactions-and-scripting.md).
:::

---

## 3. Hash-field TTLs (Redis 7.4+)

For a decade, a TTL could only apply to a whole key. Redis 7.4 added per-field expiry:

```bash
HEXPIRE   key seconds [NX|XX|GT|LT] FIELDS numfields field [field ...]
HPEXPIRE  key millis  … FIELDS …
HEXPIREAT key unix-sec … FIELDS …
HTTL      key FIELDS numfields field [field ...]     # → seconds, -1 no TTL, -2 gone
HPERSIST  key FIELDS numfields field [field ...]
HGETEX    key [EX s|PERSIST] FIELDS n field…         # read and adjust TTL
HGETDEL   key FIELDS n field…                        # read and delete
```

```bash
127.0.0.1:6379> HSET user:1042 name "Ada" otp "483920"
127.0.0.1:6379> HEXPIRE user:1042 300 FIELDS 1 otp
1) (integer) 1
127.0.0.1:6379> HTTL user:1042 FIELDS 2 name otp
1) (integer) -1        ← name never expires
2) (integer) 297       ← otp has 297s left
```

Note the `FIELDS numfields` syntax — it is verbose because the command needed to stay unambiguously parseable alongside the option flags. Count your fields correctly or you get a syntax error.

**Before 7.4**, the workaround was: put the expiring item in its own key, and keep a Sorted Set of `member → expiry-timestamp` swept by a periodic `ZRANGEBYSCORE 0 <now>`. If you inherit code doing that, this feature is why it can be deleted.

---

## 4. Hash vs. JSON String vs. separate keys

The decision you will actually make. All three model the same user.

```bash
# A — separate String keys
SET user:1042:name "Ada"
SET user:1042:age  37
SET user:1042:city "London"

# B — one JSON String
SET user:1042 '{"name":"Ada","age":37,"city":"London"}'

# C — one Hash
HSET user:1042 name "Ada" age 37 city "London"
```

| | **A: separate keys** | **B: JSON string** | **C: Hash** |
| :--- | :--- | :--- | :--- |
| Memory (3 small fields) | ~200 B | ~110 B | **~100 B** |
| Read one field | 1 trip | fetch **all** + parse | **1 trip, just that field** |
| Read everything | N trips (or `MGET`) | 1 trip | **1 trip** |
| Update one field | 1 trip | GET + parse + serialize + SET (**and a race**) | **1 atomic trip** |
| Atomic counter on a field | ✅ `INCR` | ❌ | ✅ `HINCRBY` |
| Nested / typed data | ❌ | ✅ | ❌ (flat strings only) |
| Per-item TTL | ✅ | ❌ | ✅ (7.4+) |
| Client-side cost | none | JSON parse on every read | none |

**The rule:**

- **Flat object, fields read or written independently → Hash.** This is the default and the right answer most of the time.
- **Nested structure, always read whole, never partially updated → JSON String.** A cached API response is the canonical case: you never update one field of it, you replace it wholesale.
- **Separate keys → almost never.** The only good reason is genuinely independent lifetimes, and hash-field TTLs removed even that.

:::danger[Why B has a race and C does not]
```ts
// ❌ read-modify-write on a JSON string — the lost update, again
const raw = await redis.get('user:1042');
const user = JSON.parse(raw!);
user.age = 38;
await redis.set('user:1042', JSON.stringify(user));
```
Between the `get` and the `set`, another process can write `city`. Your `set` overwrites it with the stale value you read. The bug is invisible in testing and constant under load.

```ts
// ✅ a Hash updates one field server-side, atomically
await redis.hset('user:1042', 'age', 38);
```
This is the strongest practical argument for Hashes over serialized blobs, and it is the one people forget.
:::

---

## 5. Internals: two encodings, one-way

```bash
127.0.0.1:6379> DEL h
127.0.0.1:6379> HSET h a 1 b 2
127.0.0.1:6379> OBJECT ENCODING h
"listpack"

127.0.0.1:6379> HSET h bigfield "a value longer than sixty-four bytes ......................."
127.0.0.1:6379> OBJECT ENCODING h
"hashtable"
```

### `listpack` — small hashes

```
   ONE contiguous allocation, fields and values alternating:

   ┌───────┬─────────┬──────┬──────┬──────┬──────┬──────┬──────┬─────┐
   │ bytes │ entries │ "a"  │ "1"  │ "b"  │ "2"  │ "c"  │ "3"  │ END │
   └───────┴─────────┴──────┴──────┴──────┴──────┴──────┴──────┴─────┘
              field ──┘  value ─┘

   • Zero pointers, zero per-field allocations, zero per-field redisObjects.
   • Lookup is a LINEAR SCAN — O(N) — but N ≤ 128 over one cache-resident
     array is faster in wall-clock terms than hashing plus a pointer chase.
   • Insertion order is preserved (an incidental but occasionally useful property).
```

### `hashtable` — large hashes

```
   dict → two hash tables (ht[0], ht[1]) for incremental rehashing

   ht[0]
   ┌────────────┐
   │ bucket 0 ──┼──► [ dictEntry: field* → sds  val* → robj  next ]
   │ bucket 1 ──┼──► NULL
   │ bucket 2 ──┼──► [ dictEntry ] ──► [ dictEntry ]     ← chained collision
   │ bucket 3 ──┼──► [ dictEntry ]
   └────────────┘

   • O(1) lookup.
   • ~50–80 bytes of overhead PER FIELD: dictEntry (24 B) + field SDS +
     value redisObject + allocator rounding.
```

### The thresholds

```conf
hash-max-listpack-entries 128    # more fields than this → hashtable
hash-max-listpack-value   64     # any field name OR value longer than this
                                 # (in bytes) → hashtable
```

Exceed **either** limit and Redis converts. The conversion is **permanent**:

```bash
127.0.0.1:6379> DEL h
127.0.0.1:6379> HSET h f "<a 100-byte value>"
127.0.0.1:6379> OBJECT ENCODING h
"hashtable"
127.0.0.1:6379> HDEL h f
127.0.0.1:6379> HSET h f "small"
127.0.0.1:6379> OBJECT ENCODING h
"hashtable"                       ← it does NOT convert back
```

:::warning[One oversized field poisons the whole hash]
A single 65-byte value converts a 3-field hash from a ~100-byte listpack to a ~400-byte hashtable. Multiply by ten million users and that is gigabytes.

Redis never converts back, because checking "could I shrink now?" on every `HDEL` would cost more than it saves in the common case. So the encoding is decided by the **high-water mark** of the hash's entire life.

If you have millions of small objects, `OBJECT ENCODING` on a sample is one of the highest-value five seconds you can spend. And if one field is a big blob (an avatar URL, a serialized preference tree), move it to its own key and keep the hash small.
:::

### The memory saving, measured

```bash
# A — 100 separate String keys
127.0.0.1:6379> for i in 1..100: SET obj:field:$i "value$i"
   ≈ 100 keys × ~64 B  =  ~6,400 bytes

# B — one Hash with 100 fields (listpack: needs entries ≤ 128, values ≤ 64 B)
127.0.0.1:6379> HSET obj field1 value1 … field100 value100
127.0.0.1:6379> MEMORY USAGE obj
   ≈ 1,400 bytes
```

Roughly **4–5×**, and the gap widens as fields get smaller — because the fixed per-key overhead (~64 B) dominates when your values are 6 bytes.

:::tip[The classic memory optimization: hash bucketing]
Suppose you need 100 million `id → value` mappings. As plain keys that is 100 M × ~64 B ≈ **6.4 GB of pure overhead**.

Instead, **bucket them into hashes**, using the id divided by 1000 as the hash key:

```ts
const BUCKET = 1000;

const set = (id: number, value: string) =>
  redis.hset(`bucket:${Math.floor(id / BUCKET)}`, String(id % BUCKET), value);

const get = (id: number) =>
  redis.hget(`bucket:${Math.floor(id / BUCKET)}`, String(id % BUCKET));
```

Now you have 100,000 hashes of 1,000 fields each. Set `hash-max-listpack-entries 1024` so they stay listpacks, and total memory can drop by **5–10×**.

This is the technique Instagram famously wrote up for storing photo→user mappings, cutting memory from 21 GB to 5 GB. The trade-offs are real: you lose per-id TTLs (pre-7.4), all ids in a bucket share one Cluster slot, and `HGETALL` on a bucket is O(1000). Use it when you have a very large number of small, uniform, permanent mappings — not as a default.
:::

---

## 6. When a Hash is the wrong choice

| Symptom | Why it hurts | Do instead |
| :--- | :--- | :--- |
| One hash with millions of fields | `HGETALL` blocks; cannot shard; one hot Cluster slot; no per-field TTL pre-7.4 | One key per entity, or bucketed hashes |
| Needing to query "all users in London" | A Hash has no secondary index | A Set per city: `SADD city:london:users 1042` |
| Needing fields sorted by value | Hashes are unordered | [Sorted Set](./09-sorted-sets.md) |
| Nested objects | Values are flat strings | JSON String, or flatten the field names |
| Very large individual field values | Converts to hashtable and blocks on read | Separate key per blob |

The secondary-index point deserves emphasis, because it is how Redis modeling works in general: **Redis does not build indexes for you. You build them, explicitly, at write time.**

```bash
# write the entity
HSET user:1042 name "Ada" city "London" age 37
# AND every index you will want to query by
SADD city:london:users 1042
ZADD users:by:age 37 1042
```

Every index is another write you must keep in sync — ideally in a `MULTI` or a Lua script so they cannot drift. That is the cost of a database with no query planner.

---

## 7. Worked example: a session store

```ts
import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL!);

const TTL = 86_400;                        // 24 hours

interface Session {
  uid: string;
  email: string;
  role: string;
  createdAt: number;
  lastSeen: number;
}

async function createSession(sid: string, s: Session): Promise<void> {
  const key = `session:${sid}`;
  await redis
    .multi()
    .hset(key, {
      uid: s.uid,
      email: s.email,
      role: s.role,
      createdAt: String(s.createdAt),
      lastSeen: String(s.lastSeen),
    })
    .expire(key, TTL)                      // ← the hash itself carries the TTL
    .exec();
}

async function touchSession(sid: string): Promise<Session | null> {
  const key = `session:${sid}`;

  // one round trip: read everything, bump lastSeen, slide the expiry
  const [[, data]] = (await redis
    .multi()
    .hgetall(key)
    .hset(key, 'lastSeen', String(Date.now()))
    .expire(key, TTL)
    .exec()) as [[null, Record<string, string>], ...unknown[]];

  if (Object.keys(data).length === 0) return null;

  return {
    uid: data.uid,
    email: data.email,
    role: data.role,
    createdAt: Number(data.createdAt),     // ← everything comes back as a string
    lastSeen: Number(data.lastSeen),
  };
}

const destroySession = (sid: string) => redis.unlink(`session:${sid}`);
```

Three things to notice, because they generalize:

1. **`HSET` clears no TTL, but it does not set one either.** The `EXPIRE` is a separate step, batched into the same `MULTI` so there is no window where a session exists without an expiry.
2. **Everything comes back as a string.** `Number(data.createdAt)` is not optional. This is the single most common bug when moving from an ORM to Redis.
3. **`UNLINK`, not `DEL`** — free in the background, as a default habit.

Wiring this into Express (`express-session` with `connect-redis`, plus graceful shutdown) is on [Redis in an Express App](./30-redis-with-express.md).

---

## 8. Complete command table

| Command | Complexity | Returns |
| :--- | :--- | :--- |
| `HSET k f v [f v…]` | O(N) fields | count of **new** fields |
| `HSETNX k f v` | O(1) | 1 / 0 |
| `HGET k f` | O(1) | value / `nil` |
| `HMGET k f…` | O(N) | array, `nil` in place |
| `HGETALL k` | O(N) | all field/value pairs |
| `HKEYS` / `HVALS k` | O(N) | array |
| `HLEN k` | O(1) | field count |
| `HSTRLEN k f` | O(1) | byte length |
| `HEXISTS k f` | O(1) | 1 / 0 |
| `HDEL k f…` | O(N) | count deleted |
| `HINCRBY k f n` | O(1) | new value |
| `HINCRBYFLOAT k f n` | O(1) | new value as a string |
| `HRANDFIELD k [count] [WITHVALUES]` | O(N) | random field(s) |
| `HSCAN k cur [MATCH][COUNT][NOVALUES]` | O(1) per call | `[cursor, entries]` |
| `HEXPIRE` / `HTTL` / `HPERSIST` (7.4+) | O(N) fields | per-field status array |
| `HGETEX` / `HGETDEL` (7.4+) | O(N) fields | values |

---

## Rapid-fire recall

1. `HSET` returned `0`. Did the write fail?
2. What does `HGETALL` return in ioredis for a key that does not exist?
3. Why is updating one field of a JSON String racy when `HSET` is not?
4. What are the two Hash encodings, what are the two thresholds, and is the conversion reversible?
5. One field of a 3-field hash is 100 bytes. What happens, and what does it cost across 10 M keys?
6. Describe hash bucketing and what you give up for the memory saving.
7. You need "all users in London". How do you do it, and when do you build that index?
8. Why does `HINCRBY product:88 stock -1` not implement stock reservation?

<details>
<summary>Answers</summary>

1. No. `HSET` returns the number of **newly created** fields; an update of an existing field returns 0 and succeeded.
2. `{}` — an empty object, not `null`. Test with `Object.keys(x).length === 0`.
3. The JSON path is GET → parse → mutate → SET across two round trips, so a concurrent write in between is silently overwritten. `HSET` mutates one field inside the server, atomically.
4. `listpack` and `hashtable`. Thresholds: `hash-max-listpack-entries` (128) and `hash-max-listpack-value` (64 bytes) — exceeding either converts. The conversion is one-way and permanent.
5. The value exceeds `hash-max-listpack-value`, so the whole hash converts to `hashtable` — roughly 4× the memory. Across 10 M keys that is gigabytes of avoidable usage.
6. Store `id → value` as `HSET bucket:{id/1000} {id%1000} value`, turning millions of keys into thousands of listpack hashes — often 5–10× less memory. You give up per-id TTLs (pre-7.4), you tie all ids in a bucket to one Cluster slot, and `HGETALL` on a bucket is O(bucket size).
7. Build the index yourself at write time: `SADD city:london:users 1042` in the same `MULTI` as the `HSET`. Redis has no query planner and builds no indexes for you.
8. Nothing stops it going negative. A correct reservation is a check-then-act, which must be a Lua script to be atomic.

</details>

---

**Next:** [Sets](./08-sets.md) — uniqueness, membership in O(1), and set algebra on the server.
