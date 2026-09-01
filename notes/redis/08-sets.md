---
title: Sets
author: Tejas Nirala
---

# Sets

> **What you will be able to do after this page**
>
> - Answer "have I seen this before?" in O(1) instead of scanning.
> - Do set algebra — union, intersection, difference — on the server, in one round trip.
> - Explain intset, listpack, and hashtable encodings and the traps in each.
> - Build tag filtering, follower graphs, and unique-visitor tracking correctly.

A Set is an **unordered collection of unique strings**. Adding a duplicate is a no-op. Membership testing is O(1). And Redis can compute unions, intersections, and differences between sets server-side — which is where the real power is.

---

## 1. The mental model

```
   key "post:88:tags"                 key "user:1042:following"
   ┌─────────────────────┐            ┌──────────────────────┐
   │  "redis"            │            │  "17"                │
   │  "database"         │            │  "204"               │
   │  "internals"        │            │  "1099"              │
   └─────────────────────┘            └──────────────────────┘
     unordered · unique                  unordered · unique
```

**Unordered means unordered.** `SMEMBERS` returns elements in whatever order the internal structure happens to produce, and that order can change when the set is modified or re-encoded. Never write code that depends on it. If you need order, you need a [List](./06-lists.md) or a [Sorted Set](./09-sorted-sets.md).

Up to 2³² − 1 members.

---

## 2. Core commands

```bash
SADD key m [m ...]           # → count of members ACTUALLY added (dupes don't count)
SREM key m [m ...]           # → count removed
SISMEMBER key m              # → 1 / 0.  O(1)
SMISMEMBER key m [m ...]     # → array of 1/0 (Redis 6.2+)
SCARD key                    # → cardinality (size). O(1)
SMEMBERS key                 # → ALL members. O(N) — dangerous on big sets.
SRANDMEMBER key [count]      # → random member(s), WITHOUT removing
SPOP key [count]             # → random member(s), AND removes them
SMOVE src dst member         # → atomically move one member between sets
SSCAN key cursor [MATCH p] [COUNT n]
```

```bash
127.0.0.1:6379> SADD tags redis database redis
(integer) 2                  ← "redis" was added once; the duplicate did nothing
127.0.0.1:6379> SCARD tags
(integer) 2
127.0.0.1:6379> SISMEMBER tags redis
(integer) 1
127.0.0.1:6379> SISMEMBER tags mysql
(integer) 0
127.0.0.1:6379> SMEMBERS tags
1) "database"                ← note: NOT the insertion order
2) "redis"
```

:::tip[The return value of `SADD` is a free deduplication check]
```ts
const isNew = (await redis.sadd('seen:emails', messageId)) === 1;
if (!isNew) return;              // already processed — skip
await process(messageId);
```
One atomic round trip gives you both "record it" and "was it new?". This is the cleanest idempotency primitive in Redis, and it is how you make an at-least-once queue behave like exactly-once at the handler level.

Pair it with a TTL so the set does not grow forever:
```ts
await redis.multi().sadd(key, id).expire(key, 86_400).exec();
```
:::

:::danger[`SMEMBERS` is the `KEYS *` of sets]
`SMEMBERS` on a set with 5 million members builds a 5-million-element reply on the single thread. Every client stalls, and you ship hundreds of megabytes.

- Just checking membership? → `SISMEMBER` / `SMISMEMBER`, O(1).
- Just need the size? → `SCARD`, O(1).
- Need to iterate? → `SSCAN`.
- Need a sample? → `SRANDMEMBER key 10`.

`SMEMBERS` is safe only when you know the set is small and bounded.
:::

### `SPOP` vs `SRANDMEMBER` — and the negative-count trick

```bash
SRANDMEMBER key 3      # 3 DISTINCT random members (or all, if the set is smaller)
SRANDMEMBER key -3     # 3 random members WITH repetition possible
SPOP key 3             # 3 random members, REMOVED from the set
```

The sign is the whole difference: a positive count guarantees distinctness and caps at the set size; a negative count always returns exactly that many, possibly with duplicates.

```ts
// a raffle: draw 3 distinct winners and take them out of the pool
const winners = await redis.spop('raffle:entrants', 3);

// a "random suggestions" widget: sample without consuming
const suggestions = await redis.srandmember('active:users', 5);
```

`SPOP` with no count on a set is also a reasonable "work-stealing" primitive when order does not matter — unlike `LPOP`, several workers can `SPOP` concurrently and are guaranteed distinct items.

---

## 3. Set algebra — the reason Sets exist

```bash
SUNION       key [key ...]              # → members in ANY set
SINTER       key [key ...]              # → members in ALL sets
SDIFF        key [key ...]              # → in the FIRST set but not the others
SUNIONSTORE  dst key [key ...]          # → store the result, return its size
SINTERSTORE  dst key [key ...]
SDIFFSTORE   dst key [key ...]
SINTERCARD numkeys key [key…] [LIMIT n] # → just the SIZE of the intersection (7.0+)
```

```bash
127.0.0.1:6379> SADD alice:skills  redis python sql
127.0.0.1:6379> SADD bob:skills    redis java   sql
127.0.0.1:6379> SADD carol:skills  redis python go

127.0.0.1:6379> SINTER alice:skills bob:skills carol:skills
1) "redis"                   ← everyone knows Redis

127.0.0.1:6379> SUNION alice:skills bob:skills
1) "redis" 2) "python" 3) "sql" 4) "java"

127.0.0.1:6379> SDIFF alice:skills bob:skills
1) "python"                  ← Alice has it, Bob doesn't
```

Visually:

```
        alice                    bob
      ┌─────────────┐      ┌─────────────┐
      │   python    │      │             │
      │        ┌────┼──────┼────┐        │
      │        │  redis    │    │  java  │
      │        │   sql     │    │        │
      │        └────┼──────┼────┘        │
      └─────────────┘      └─────────────┘

   SINTER → { redis, sql }          the overlap
   SUNION → { python, redis, sql, java }
   SDIFF alice bob → { python }     left minus right
   SDIFF bob alice → { java }       ← NOT commutative; order matters
```

:::warning[`SDIFF` is not commutative, and `SINTER` is not free]
`SDIFF a b` ≠ `SDIFF b a`. The first key is the base; every other key is subtracted from it.

And `SINTER` is **O(N × M)** in the worst case — N being the size of the *smallest* set and M the number of sets. Redis optimizes by sorting the sets smallest-first and iterating the smallest one, checking membership in the others. So intersecting a 10-element set with a 10-million-element set is fast (10 lookups), but intersecting two 10-million-element sets is not.

`SUNION` is O(total elements across all sets) — genuinely expensive on large sets, and it blocks. Use `SUNIONSTORE` to keep the result server-side rather than shipping it, and consider whether you should be precomputing it on write instead.
:::

### `SINTERCARD` — count without materializing

```bash
SINTERCARD 2 users:premium users:active
(integer) 15234

SINTERCARD 2 users:premium users:active LIMIT 100
(integer) 100        ← stops counting at 100. "At least 100" answered cheaply.
```

This is a real win. Before Redis 7 you had to `SINTERSTORE` into a temp key, `SCARD` it, and `DEL` it — three commands, plus the memory to hold a result you only wanted the size of. `LIMIT` additionally lets you answer "are there at least N?" without walking the whole intersection.

---

## 4. Worked patterns

### Tag filtering

```bash
# index at write time — one set per tag
SADD tag:redis:posts    88 91 104
SADD tag:database:posts 88 104 200
SADD tag:golang:posts   91 305

# "posts tagged redis AND database"
SINTER tag:redis:posts tag:database:posts        # → 88, 104

# "posts tagged redis OR golang"
SUNION tag:redis:posts tag:golang:posts          # → 88, 91, 104, 305

# "tagged redis but NOT golang"
SDIFF  tag:redis:posts tag:golang:posts          # → 88, 104
```

```ts
async function findPosts(include: string[], exclude: string[] = []): Promise<string[]> {
  const inc = include.map((t) => `tag:${t}:posts`);
  const exc = exclude.map((t) => `tag:${t}:posts`);

  if (exc.length === 0) return redis.sinter(...inc);

  // intersect the includes into a temp key, then subtract the excludes
  const tmp = `tmp:query:${randomUUID()}`;
  const [, results] = await redis
    .multi()
    .sinterstore(tmp, ...inc)
    .sdiff(tmp, ...exc)
    .unlink(tmp)                          // always clean up temp keys
    .exec()
    .then((r) => [r![0], r![1][1] as string[]]);

  return results;
}
```

Note the temp key gets a UUID and is unlinked in the same transaction. **A temp key without a TTL or a guaranteed cleanup is a memory leak**; belt-and-braces is to also `EXPIRE tmp 60` in case the process dies before the `UNLINK`.

### A social graph

```bash
SADD user:1042:following 17 204 1099
SADD user:17:followers   1042 88

# mutual follows — "friends"
SINTER user:1042:following user:1042:followers

# "people you may know": followed by the people you follow, minus who you already follow
SUNIONSTORE tmp:fof user:17:following user:204:following user:1099:following
SDIFF tmp:fof user:1042:following

# do we both follow X?  (O(1), no set algebra needed)
SMISMEMBER user:1042:following 17 204 999
```

The last one is the important lesson: **`SMISMEMBER` beats `SINTER` when you already know the candidates.** Set algebra is for when you do not.

### Unique visitors per day

```bash
SADD visitors:2026-09-01 user:1042
SCARD visitors:2026-09-01                 # today's unique count
EXPIRE visitors:2026-09-01 604800         # keep a week

# uniques across a week
SUNIONSTORE visitors:week visitors:2026-08-26 … visitors:2026-09-01
SCARD visitors:week

# returning visitors: here today AND yesterday
SINTERCARD 2 visitors:2026-09-01 visitors:2026-08-31
```

Exact and simple. The catch is memory: **10 million visitors ≈ 400+ MB per day**. If you only need the *count* and can tolerate ~0.81% error, [HyperLogLog](./10-bitmaps-hyperloglog-geo.md) does the same job in **12 KB** — a 30,000× saving. Use a Set when you need the actual member list or exact counts; use HLL when you need cardinality at scale.

---

## 5. Internals: three encodings

```bash
127.0.0.1:6379> DEL s
127.0.0.1:6379> SADD s 1 2 3
127.0.0.1:6379> OBJECT ENCODING s
"intset"

127.0.0.1:6379> SADD s "hello"
127.0.0.1:6379> OBJECT ENCODING s
"listpack"                       ← Redis 7.2+; older versions jump to hashtable

127.0.0.1:6379> for i in 1..200: SADD s "member$i"
127.0.0.1:6379> OBJECT ENCODING s
"hashtable"
```

| Encoding | Condition | Structure |
| :--- | :--- | :--- |
| **`intset`** | **All** members are integers, and count ≤ `set-max-intset-entries` (512) | A **sorted array of integers** |
| **`listpack`** | Small, has non-integers, count ≤ `set-max-listpack-entries` (128) and each ≤ `set-max-listpack-value` (64 B) | One flat contiguous array |
| **`hashtable`** | Anything larger | A `dict` where values are all `NULL` |

```conf
set-max-intset-entries   512
set-max-listpack-entries 128
set-max-listpack-value   64
```

### `intset` — a sorted integer array

```
   SADD s 5 1 3 9    →  stored as:

   ┌──────────┬────────┬────┬────┬────┬────┐
   │ encoding │ length │  1 │  3 │  5 │  9 │      ← ALWAYS SORTED
   │ INT16    │   4    │    │    │    │    │
   └──────────┴────────┴────┴────┴────┴────┘

   • encoding upgrades automatically: INT16 → INT32 → INT64 when a member
     needs more bits. It NEVER downgrades.
   • SISMEMBER is a BINARY SEARCH — O(log N), not O(1). Fast enough that
     nobody notices at N ≤ 512.
   • SADD is O(N): binary search for the position, then memmove to insert.
   • Memory: 2, 4, or 8 bytes per member. Nothing else. This is by far the
     most compact structure in Redis.
```

A set of 500 user IDs costs about **4 KB** as an intset. The same 500 IDs as a hashtable would cost roughly **50 KB**. That is why `SADD user:1042:following 17 204 1099` (numeric IDs) is dramatically cheaper than storing usernames.

:::tip[Store numeric IDs in Sets, not strings]
```bash
SADD following 17 204 1099           # intset — ~24 bytes
SADD following "ada" "bob" "carol"   # listpack/hashtable — several times more
```
Adding **one** non-integer member converts the whole set out of intset, permanently. If your set is a collection of entity IDs, keep them numeric.
:::

### `hashtable` — a dict with no values

A large Set is literally a Redis `dict` where every key maps to `NULL`. That gives O(1) `SISMEMBER` and O(1) `SADD`, at roughly 50–70 bytes of overhead per member.

```
   ht[0]
   ┌────────────┐
   │ bucket 0 ──┼──► [ key: sds "redis"  │ val: NULL │ next ] ──► [ … ]
   │ bucket 1 ──┼──► NULL
   │ bucket 2 ──┼──► [ key: sds "database" │ val: NULL │ next ]
   └────────────┘
```

The same incremental-rehashing machinery as the keyspace applies — see [Internals: Memory & Encodings](./13-internals-memory-and-encodings.md).

### Complexity summary

| Operation | intset | listpack | hashtable |
| :--- | :--- | :--- | :--- |
| `SADD` | O(N) (memmove) | O(N) | **O(1)** |
| `SISMEMBER` | O(log N) | O(N) | **O(1)** |
| `SCARD` | O(1) | O(1) | **O(1)** |
| `SREM` | O(N) | O(N) | **O(1)** |
| `SMEMBERS` | O(N) | O(N) | O(N) |
| `SRANDMEMBER` | O(1) | O(N) | O(1) |

The small encodings are asymptotically worse and practically faster, because N is capped and the data fits in cache. This trade-off — **compact-and-linear for small, indexed-and-scattered for large** — is the single most repeated idea in Redis internals, and it appears again in Lists, Hashes, and Sorted Sets.

---

## 6. Set vs. the alternatives

| You need | Set? | Better |
| :--- | :--- | :--- |
| Uniqueness + O(1) membership | ✅ | — |
| Set algebra across collections | ✅ | — |
| Insertion order preserved | ❌ | [List](./06-lists.md) |
| Ordering by a score / ranking | ❌ | [Sorted Set](./09-sorted-sets.md) |
| Just the count of uniques, at massive scale | ❌ (memory) | [HyperLogLog](./10-bitmaps-hyperloglog-geo.md) — 12 KB |
| Membership over dense integer IDs | ❌ (memory) | [Bitmap](./10-bitmaps-hyperloglog-geo.md) — 1 bit per id |
| Values attached to members | ❌ | [Hash](./07-hashes.md) |

The Bitmap row is worth a moment. For "which of my 10 million users are online?", a Set of 10 M ids costs hundreds of megabytes; a Bitmap costs **1.25 MB** — one bit per user id. Bitmaps only work when your identifiers are dense small integers, but when they are, nothing beats them.

---

## 7. Complete command table

| Command | Complexity | Returns |
| :--- | :--- | :--- |
| `SADD k m…` | O(N) members | count added |
| `SREM k m…` | O(N) | count removed |
| `SISMEMBER k m` | O(1) | 1 / 0 |
| `SMISMEMBER k m…` | O(N) | array of 1/0 |
| `SCARD k` | O(1) | size |
| `SMEMBERS k` | O(N) | all members |
| `SRANDMEMBER k [count]` | O(count) | member(s), not removed |
| `SPOP k [count]` | O(count) | member(s), removed |
| `SMOVE src dst m` | O(1) | 1 / 0 |
| `SUNION k…` | O(total N) | members |
| `SINTER k…` | O(N×M) | members |
| `SDIFF k…` | O(total N) | members |
| `SUNIONSTORE` / `SINTERSTORE` / `SDIFFSTORE dst k…` | same | size of result |
| `SINTERCARD numkeys k… [LIMIT n]` | O(N×M) | size only (7.0+) |
| `SSCAN k cur [MATCH][COUNT]` | O(1) per call | `[cursor, members]` |

---

## Rapid-fire recall

1. `SADD s a a a` on an empty set — what does it return, and what is `SCARD`?
2. How do you use `SADD`'s return value as an idempotency check?
3. Why is `SMEMBERS` dangerous, and what are the four safer alternatives?
4. What is the difference between `SRANDMEMBER k 3` and `SRANDMEMBER k -3`?
5. Is `SDIFF a b` the same as `SDIFF b a`?
6. What does `SINTERCARD ... LIMIT 100` let you answer cheaply?
7. Name the three Set encodings and the exact condition for each.
8. Why does `SADD following "ada"` on a set of numeric ids cost so much more than `SADD following 17`?
9. When should a Set be a Bitmap instead, and when should it be a HyperLogLog?

<details>
<summary>Answers</summary>

1. Returns `1` (one member actually added); `SCARD` is `1`. Duplicates are silently ignored.
2. `(await redis.sadd(key, id)) === 1` means this id was new — so you process it; `0` means already seen, so you skip. One atomic round trip.
3. It is O(N) and materializes the whole set as a reply on the single thread. Use `SISMEMBER`/`SMISMEMBER` for membership, `SCARD` for size, `SSCAN` to iterate, `SRANDMEMBER` for a sample.
4. Positive: up to 3 **distinct** members, capped at the set size. Negative: exactly 3 members, repetition allowed.
5. No. The first key is the base and the rest are subtracted from it.
6. "Are there at least 100 members in the intersection?" — it stops counting at the limit instead of walking the whole intersection.
7. `intset` (all members integers, ≤ 512 entries — a sorted int array); `listpack` (small, has non-integers, ≤ 128 entries and ≤ 64 B each); `hashtable` (everything else).
8. One non-integer member converts the set out of `intset` permanently. An intset stores 2–8 raw bytes per member with no per-member overhead; a hashtable costs ~50–70 bytes per member.
9. Bitmap when identifiers are dense small integers and you need membership (1 bit each). HyperLogLog when you only need approximate cardinality at massive scale (12 KB, ~0.81% error).

</details>

---

**Next:** [Sorted Sets](./09-sorted-sets.md) — the most powerful type in Redis, and the one worth the most in an interview.
