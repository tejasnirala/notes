---
title: Bitmaps, HyperLogLog & Geospatial
author: Tejas Nirala
---

# Bitmaps, HyperLogLog & Geospatial

> **What you will be able to do after this page**
>
> - Track 10 million users' daily activity in 1.25 MB instead of 400 MB.
> - Count a billion unique visitors in 12 KB, and explain the probabilistic trick that makes it work.
> - Answer "what's near me?" with a radius query, and know why it is really a sorted set.

These three are not separate *types* — a Bitmap and a HyperLogLog are both **Strings**, and a Geo index is a **Sorted Set**. They are specialized *command families* over existing structures. Each solves a problem where the obvious approach costs orders of magnitude more memory.

---

# Part 1 — Bitmaps

## 1.1 The idea

A Bitmap is a String treated as an **array of bits**. Bit `N` is the Nth bit, and you address it directly.

```
   key "active:2026-09-01"

   bit offset:  0    1    2    3    4    5    6    7    8    9   10  …
                │    │    │    │    │    │    │    │    │    │    │
                0    1    1    0    0    1    0    0    1    0    0
                     ▲    ▲         ▲              ▲
                     │    │         │              │
                  user 1 user 2  user 5        user 8 were active today

   1 byte holds 8 users.  1 KB holds 8,192 users.
   10,000,000 users = 1,250,000 bytes = 1.25 MB.
```

Compare: a Set of 10 million integer user ids costs **~400 MB**. A bitmap costs **1.25 MB**. That is a **320× saving** — and it only works because user ids are **dense small integers**.

:::warning[The one hard constraint]
Bitmaps are indexed by integer offset. If your identifiers are UUIDs, emails, or sparse ids like `4,000,000,000`, a bitmap is either impossible or catastrophically wasteful — `SETBIT k 4000000000 1` allocates **500 MB** to store one bit, because Redis zero-fills everything up to that offset.

You need a **dense, small, integer id space**. If you have UUIDs, maintain an `INCR`-based dense id: `HSETNX uuid:to:id <uuid> <next-id>`.
:::

## 1.2 Commands

```bash
SETBIT key offset 0|1          # → the PREVIOUS bit value
GETBIT key offset              # → 0 / 1
BITCOUNT key [start end [BYTE|BIT]]     # → count of set bits
BITPOS key 0|1 [start [end [BYTE|BIT]]] # → offset of the first 0 or 1
BITOP AND|OR|XOR|NOT dst src [src ...]  # → size of the result in bytes
BITFIELD key [GET|SET|INCRBY type offset value] [OVERFLOW WRAP|SAT|FAIL]
```

```bash
127.0.0.1:6379> SETBIT active:2026-09-01 1042 1
(integer) 0                      ← the previous value; 0 = "was not set"
127.0.0.1:6379> GETBIT active:2026-09-01 1042
(integer) 1
127.0.0.1:6379> BITCOUNT active:2026-09-01
(integer) 1
127.0.0.1:6379> STRLEN active:2026-09-01
(integer) 131                    ← 1042/8 rounded up: the string is zero-filled
```

`SETBIT` returning the *previous* value is the same free-idempotency trick as `SADD`:

```ts
const wasAlreadyActive = (await redis.setbit(key, userId, 1)) === 1;
if (!wasAlreadyActive) await redis.incr('stats:new-actives-today');
```

## 1.3 `BITOP` — set algebra at memory-bandwidth speed

```bash
# Users active on BOTH days
BITOP AND result active:2026-09-01 active:2026-08-31
BITCOUNT result

# Users active on EITHER day
BITOP OR result active:2026-09-01 active:2026-08-31

# Users active on exactly one of the two days
BITOP XOR result active:2026-09-01 active:2026-08-31

# Users active yesterday but NOT today (churn)
BITOP NOT tmp active:2026-09-01
BITOP AND churned active:2026-08-31 tmp
```

```
   active:2026-08-31   0 1 1 0 1 0 0 1
   active:2026-09-01   0 1 0 0 1 1 0 0
                       ─────────────────
   AND  (both days)    0 1 0 0 1 0 0 0   → 2 users retained
   OR   (either day)   0 1 1 0 1 1 0 1   → 5 users total
   XOR  (exactly one)  0 0 1 0 0 1 0 1   → 3 users changed state
```

`BITOP` runs at roughly memory bandwidth — the CPU ANDs 8 bytes at a time. **Retention cohort analysis over 30 days across 10 million users takes milliseconds and ~37 MB of keys.** Doing the same in SQL is a self-join over hundreds of millions of rows.

:::danger[`BITOP` is O(N) on the longest input, on the main thread]
Two 100 MB bitmaps produce a 100 MB result, and the whole thing happens synchronously. At 1.25 MB per day that is fine; at gigabyte scale it is not. Also note `BITOP NOT` flips *every* bit up to the string length, including padding bits for users that do not exist — always `AND` against a "known users" bitmap afterwards.
:::

## 1.4 Worked example: daily active users

```ts
const dayKey = (d: Date) => `active:${d.toISOString().slice(0, 10)}`;

const markActive = (userId: number, d = new Date()) =>
  redis.setbit(dayKey(d), userId, 1);

const dau = (d: Date) => redis.bitcount(dayKey(d));

async function retention(cohort: Date, later: Date): Promise<number> {
  const dst = `tmp:retention:${randomUUID()}`;
  const [, both] = await redis
    .multi()
    .bitop('AND', dst, dayKey(cohort), dayKey(later))
    .bitcount(dst)
    .unlink(dst)
    .exec()
    .then((r) => [r![0], r![1][1] as number]);

  const base = await redis.bitcount(dayKey(cohort));
  return base === 0 ? 0 : both / base;
}

// MAU: OR together 30 daily bitmaps
async function mau(days: Date[]): Promise<number> {
  const dst = `tmp:mau:${randomUUID()}`;
  const [, count] = await redis
    .multi()
    .bitop('OR', dst, ...days.map(dayKey))
    .bitcount(dst)
    .unlink(dst)
    .exec()
    .then((r) => [r![0], r![1][1] as number]);
  return count;
}
```

**One year of daily-active bitmaps for 10 M users: 365 × 1.25 MB ≈ 456 MB.** Entirely reasonable, and every cohort question is a `BITOP` away.

## 1.5 `BITFIELD` — packed integer arrays

`BITFIELD` treats a String as an array of arbitrary-width integers. This is how you store millions of small counters in a fraction of the memory.

```bash
# u8 = unsigned 8-bit, i16 = signed 16-bit, up to u63 / i64
BITFIELD counters SET u8 #0 250 GET u8 #0
#   "#0" means "offset 0 counters of this width" — i.e. bit offset 0*8

BITFIELD counters INCRBY u8 #0 10 GET u8 #0
BITFIELD counters OVERFLOW SAT INCRBY u8 #0 100 GET u8 #0
```

```bash
127.0.0.1:6379> BITFIELD stats SET u8 #0 250
1) (integer) 0
127.0.0.1:6379> BITFIELD stats OVERFLOW WRAP INCRBY u8 #0 10
1) (integer) 4            ← 250+10 = 260, wraps modulo 256
127.0.0.1:6379> BITFIELD stats SET u8 #0 250 OVERFLOW SAT INCRBY u8 #0 10
1) (integer) 250
2) (integer) 255          ← SATURATES at the max instead of wrapping
127.0.0.1:6379> BITFIELD stats SET u8 #0 250 OVERFLOW FAIL INCRBY u8 #0 10
1) (integer) 250
2) (nil)                  ← FAIL returns nil and does not modify
```

| `OVERFLOW` | Behaviour |
| :--- | :--- |
| `WRAP` (default) | Modular arithmetic — 255 + 1 = 0 |
| `SAT` | Clamp at the type's min/max |
| `FAIL` | Return `nil` and leave the value alone |

`SAT` is the useful one for counters you never want to roll over. A million `u8` counters cost **1 MB**; a million `INCR` keys cost **~64 MB**.

## 1.6 Feature flags and permissions

```ts
enum Flag { NewUI = 0, BetaSearch = 1, DarkMode = 2 }

const enable  = (uid: number, f: Flag) => redis.setbit(`flags:${f}`, uid, 1);
const enabled = (uid: number, f: Flag) => redis.getbit(`flags:${f}`, uid);
const rolloutCount = (f: Flag) => redis.bitcount(`flags:${f}`);

// "users with BOTH beta flags" — one command, no scanning
await redis.bitop('AND', 'tmp', `flags:${Flag.NewUI}`, `flags:${Flag.BetaSearch}`);
```

One bit per user per flag. A percentage rollout across 50 flags and 10 M users: **62 MB**, with instant "who has this?" queries.

---

# Part 2 — HyperLogLog

## 2.1 The problem it solves

"How many **unique** visitors did we have?" Exactly counting uniques requires remembering every one of them:

| Approach | 100 M uniques | Exact? |
| :--- | :--- | :--- |
| Redis Set | ~4 GB | ✅ |
| Bitmap (dense int ids) | 12.5 MB | ✅ |
| **HyperLogLog** | **12 KB** | ❌ ±0.81% |

**12 KB. Constant. Regardless of whether you counted 100 items or 100 billion.** That is not a typo, and it is the most surprising number in Redis.

## 2.2 Commands

```bash
PFADD key element [element ...]     # → 1 if the estimate CHANGED, else 0
PFCOUNT key [key ...]               # → the cardinality estimate
PFMERGE dst src [src ...]           # → union of several HLLs into one
```

```bash
127.0.0.1:6379> PFADD visitors user1 user2 user3
(integer) 1
127.0.0.1:6379> PFCOUNT visitors
(integer) 3
127.0.0.1:6379> PFADD visitors user1
(integer) 0                        ← estimate unchanged; already counted
127.0.0.1:6379> STRLEN visitors
(integer) 28                       ← sparse encoding while small

# after a million adds:
127.0.0.1:6379> PFCOUNT visitors
(integer) 999,684                  ← ~0.03% off in this run
127.0.0.1:6379> STRLEN visitors
(integer) 12,304                   ← dense encoding: the fixed 12 KB ceiling
```

```ts
const seen = (day: string, uid: string) => redis.pfadd(`uv:${day}`, uid);
const uniques = (day: string) => redis.pfcount(`uv:${day}`);

// uniques across a week, WITHOUT double-counting people who visited twice
const weekly = (days: string[]) => redis.pfcount(...days.map((d) => `uv:${d}`));
```

That last line is the property that makes HLL genuinely special: **unions are exact and free.** Summing seven daily counts would double-count returning visitors. `PFCOUNT` over seven HLLs gives you the true union cardinality — something you cannot do with plain counters at all.

## 2.3 How it works — the intuition

The core observation is about **randomness and leading zeros**.

```
   Hash each element to a uniform random 64-bit number.
   Look at how many leading zeros the hash has.

   P(≥1 leading zero)  = 1/2      → seen after ~2 elements
   P(≥2 leading zeros) = 1/4      → seen after ~4 elements
   P(≥3 leading zeros) = 1/8      → seen after ~8 elements
   P(≥k leading zeros) = 1/2^k    → seen after ~2^k elements

   So: if the MAXIMUM number of leading zeros you have ever seen is k,
       you have probably seen about 2^k distinct elements.
```

You just estimated a cardinality by storing **one number** (the max k). But a single estimator has enormous variance — one unlucky hash with 20 leading zeros ruins it.

The fix is **stochastic averaging**: split the elements into many independent buckets ("registers") and combine their estimates.

```
   Redis uses 2^14 = 16,384 registers, each 6 bits wide.

   For each element:
     h = hash64(element)
     register_index = the first 14 bits of h          → which of the 16,384
     rest           = the remaining 50 bits
     k = position of the leftmost 1-bit in `rest`     → 1..51, fits in 6 bits
     registers[index] = max(registers[index], k)      ← only ever grows

   Estimate = harmonic_mean(2^registers[i]) × 16384 × alpha
              (the harmonic mean suppresses the effect of unlucky large values,
               alpha is a bias-correction constant)

   Memory: 16,384 registers × 6 bits = 98,304 bits = 12,288 bytes ≈ 12 KB
   Standard error: 1.04 / sqrt(16384) = 0.0081 = 0.81%
```

```
        16,384 registers, 6 bits each
   ┌────┬────┬────┬────┬────┬─────┬────┐
   │  3 │  1 │  7 │  2 │  4 │ ... │  2 │     ← max leading-zeros seen per bucket
   └────┴────┴────┴────┴────┴─────┴────┘
     0    1    2    3    4          16383

   ▲ Each register only ever INCREASES. That is why:
     • adding the same element twice changes nothing (idempotent)
     • PFMERGE is just a per-register max() — union is exact
     • you cannot delete, and you cannot ask "is X in here?"
```

Three properties follow directly from "registers only take maxima", and they are exactly the interview answers:

- **Idempotent.** Re-adding an element cannot change any register.
- **Mergeable exactly.** `PFMERGE` takes the element-wise max of the registers. The union of two HLLs is precisely the HLL of the union — no error compounding.
- **No membership, no deletion.** The registers retain no identity, so "was user X counted?" and "remove user X" are both impossible.

## 2.4 Sparse and dense representations

Redis is cleverer than a flat 12 KB allocation. A young HLL, with most registers still zero, is stored in a **sparse** run-length-encoded form of a few dozen bytes. When it grows past `hll-sparse-max-bytes` (default 3000), it converts once to the **dense** 12 KB form.

```bash
CONFIG SET hll-sparse-max-bytes 3000
```

So an HLL that will only ever count a handful of things costs ~30 bytes, not 12 KB. You can create millions of per-page or per-user HLLs without blowing up memory — which makes the pattern practical at a granularity you would not otherwise attempt.

:::note[HLLs are Strings]
```bash
PFADD hll a b c
TYPE hll               # "string"
GET hll                # "HYLL\x01..." — a magic header plus the registers
```
So you can `DUMP`/`RESTORE` them, set a TTL on them, and replicate them like any other key. You must **never** modify one with `SET`/`APPEND`, though — Redis validates the header and will error out.
:::

## 2.5 When to use which

| Requirement | Use |
| :--- | :--- |
| Exact count, and you need the member list | Set |
| Exact count, dense integer ids, membership needed | Bitmap |
| Approximate count only, any id type, massive scale | **HyperLogLog** |
| Approximate count **and** membership | [Bloom filter](https://redis.io/docs/latest/develop/data-types/probabilistic/) (a module, not core) |

**Do not use HLL for anything that must be exact.** Billing, quotas, and legal reporting need real counts. Use it for dashboards, analytics, trending, and capacity signals — anywhere "1,240,000 ± 10,000" is as useful as the exact number.

---

# Part 3 — Geospatial

## 3.1 It is a Sorted Set

```bash
127.0.0.1:6379> GEOADD cities 77.2090 28.6139 "Delhi"
(integer) 1
127.0.0.1:6379> TYPE cities
"zset"                             ← it really is just a sorted set
127.0.0.1:6379> ZSCORE cities Delhi
"3631527565580574"                 ← the geohash, as a 52-bit integer
```

`GEOADD` interleaves the latitude and longitude bits into a single 52-bit **geohash** and stores it as the sorted-set score. That single number has a magic property: **points that are close on Earth have numerically close geohashes**, because interleaving bits is a Z-order (Morton) curve traversal of the map.

```
   Recursive quadrant subdivision, one bit per split:

   ┌─────────┬─────────┐          Interleave: lon-bit, lat-bit, lon-bit, …
   │   01    │   11    │          Each pair of bits picks a quadrant.
   │         │         │          26 splits per axis = 52 bits = ~0.6 m
   ├─────────┼─────────┤          precision.
   │   00    │   10    │
   │         │         │          Nearby points share long PREFIXES,
   └─────────┴─────────┘          so they are numerically adjacent →
                                  a RANGE QUERY on the score finds neighbours.
```

Which is why a radius search is just `ZRANGEBYSCORE` over nine geohash cells (the target cell plus its eight neighbours, to handle points near a boundary), followed by an exact distance filter.

## 3.2 Commands

```bash
GEOADD key [NX|XX] [CH] longitude latitude member [lon lat member ...]
GEOPOS key member [member ...]              # → [lon, lat] per member
GEODIST key m1 m2 [M|KM|MI|FT]              # → distance as a string
GEOHASH key member [member ...]             # → standard geohash strings
GEOSEARCH key <FROMMEMBER m | FROMLONLAT lon lat>
           <BYRADIUS r unit | BYBOX w h unit>
           [ASC|DESC] [COUNT n [ANY]] [WITHCOORD] [WITHDIST] [WITHHASH]
GEOSEARCHSTORE dst src …                    # store results in another key
```

:::warning[Longitude comes FIRST]
`GEOADD key <longitude> <latitude> member`. Every mapping API in the world writes coordinates as *lat, lon*; Redis takes *lon, lat*. Swapping them puts Delhi in the Indian Ocean, and Redis will happily accept it — the only error you get is if latitude exceeds ±85.05112878.

(`GEORADIUS` and `GEORADIUSBYMEMBER` are the deprecated predecessors of `GEOSEARCH`. Use `GEOSEARCH`.)
:::

```bash
127.0.0.1:6379> GEOADD cities 77.2090 28.6139 "Delhi" \
                              72.8777 19.0760 "Mumbai" \
                              88.3639 22.5726 "Kolkata" \
                              77.5946 12.9716 "Bangalore"
(integer) 4

127.0.0.1:6379> GEODIST cities Delhi Mumbai KM
"1148.9349"

127.0.0.1:6379> GEOSEARCH cities FROMMEMBER Delhi BYRADIUS 1500 KM ASC WITHDIST
1) 1) "Delhi"     2) "0.0000"
2) 1) "Kolkata"   2) "1305.8478"
3) 1) "Mumbai"    2) "1148.9349"

127.0.0.1:6379> GEOSEARCH cities FROMLONLAT 77.0 28.0 BYBOX 400 400 KM ASC WITHCOORD
1) 1) "Delhi"
   2) 1) "77.20899999141693115"
      2) "28.61389896950061"
```

## 3.3 Worked example: "drivers near me"

```ts
const DRIVERS = 'drivers:live';

const updateLocation = (driverId: string, lon: number, lat: number) =>
  redis.geoadd(DRIVERS, lon, lat, driverId);

interface Nearby { id: string; distanceKm: number; lon: number; lat: number }

async function findNearby(lon: number, lat: number, radiusKm = 5): Promise<Nearby[]> {
  const raw = (await redis.geosearch(
    DRIVERS,
    'FROMLONLAT', lon, lat,
    'BYRADIUS', radiusKm, 'km',
    'ASC',                       // nearest first
    'COUNT', 20,
    'WITHDIST', 'WITHCOORD',
  )) as [string, string, [string, string]][];

  return raw.map(([id, dist, [dLon, dLat]]) => ({
    id,
    distanceKm: Number(dist),
    lon: Number(dLon),
    lat: Number(dLat),
  }));
}
```

:::danger[Geo keys have no TTL per member — and drivers go offline]
A `GEOADD`ed member lives until you `ZREM` it. A driver who closes the app stays on the map forever.

There is no per-member expiry, so you need a companion structure:

```ts
// on every location ping, ALSO record the timestamp
await redis.multi()
  .geoadd(DRIVERS, lon, lat, driverId)
  .zadd('drivers:seen', Date.now(), driverId)
  .exec();

// a sweeper drops anyone who has not pinged in 60 seconds
const stale = await redis.zrangebyscore('drivers:seen', 0, Date.now() - 60_000);
if (stale.length) {
  await redis.multi()
    .zrem(DRIVERS, ...stale)
    .zrem('drivers:seen', ...stale)
    .exec();
}
```
This "companion sorted set of last-seen timestamps" pattern shows up constantly — presence tracking, connection registries, session lists. Learn it once.
:::

## 3.4 Limits worth knowing

- **`COUNT n ANY`** returns as soon as `n` matches are found rather than sorting all of them — much faster when you just need "some nearby drivers", not "the nearest".
- Latitude is limited to **±85.05112878** (the Mercator projection limit). The poles are unrepresentable.
- Distances use a **spherical** Earth model, so there is up to ~0.5% error versus a true ellipsoid. Fine for "find nearby", wrong for surveying.
- **`GEOSEARCH` is O(N + log M)** where N is the elements in the searched area. A dense city centre with a 50 km radius is an expensive query — cap it with `COUNT`.
- All of a geo key's members share one Cluster slot, so a global index is a hot key. Shard by region: `drivers:live:{delhi}`.

---

## Rapid-fire recall

1. What is a Bitmap actually stored as, and what is the constraint on your ids?
2. `SETBIT k 4000000000 1` — what does it cost?
3. Why is `BITOP` so fast, and what is the trap with `BITOP NOT`?
4. What does `OVERFLOW SAT` do in `BITFIELD` and when do you want it?
5. How much memory does a HyperLogLog use at 100 items, and at 100 billion?
6. What is HLL's standard error, and where does the number come from?
7. Why is `PFMERGE` exact when the counts themselves are approximate?
8. Two things a HyperLogLog fundamentally cannot do.
9. What is a Geo index really, and what is stored as the score?
10. Why does a "drivers near me" feature need a second sorted set?

<details>
<summary>Answers</summary>

1. A String, addressed bit by bit. Ids must be **dense small integers** — bit N is user N.
2. Redis zero-fills up to the offset, so it allocates ~500 MB for one bit. Sparse ids destroy the memory advantage.
3. It operates word-at-a-time at roughly memory bandwidth. `BITOP NOT` flips every bit up to the string length, including padding for non-existent ids — always `AND` the result against a known-users bitmap.
4. It clamps at the type's maximum instead of wrapping to zero. You want it for counters that must never silently roll over.
5. About 30 bytes (sparse encoding) at 100 items; a fixed **12 KB** (dense) at any large cardinality, including 100 billion.
6. 0.81%, from `1.04 / sqrt(16384)` — 16,384 being the number of 6-bit registers.
7. Merging takes the element-wise **max** of registers, and registers only ever hold maxima. The merged HLL is byte-identical to one built from the union directly, so no error compounds.
8. Test membership ("was X counted?") and delete an element. The registers keep no identity.
9. A Sorted Set whose score is a 52-bit interleaved **geohash** — a Z-order curve value, so geographically close points are numerically close, making a radius search a score range query.
10. Geo members have no per-member TTL, so a companion sorted set of last-seen timestamps lets a sweeper `ZREM` drivers who stopped pinging.

</details>

---

**Next:** [Streams](./11-streams.md) — an append-only log with consumer groups: Kafka semantics without Kafka.
