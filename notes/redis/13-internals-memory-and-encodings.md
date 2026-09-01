---
title: "Internals: Memory & Encodings"
author: Tejas Nirala
---

# Internals: Memory & Encodings

> **What you will be able to do after this page**
>
> - Draw the full path from a key name to the bytes of its value.
> - Explain `redisObject`, `dict`, and incremental rehashing without notes.
> - Account for every byte of `MEMORY USAGE`, and know where memory actually goes.
> - Diagnose fragmentation, and know which of the three "memory is high" causes you have.

This is the page that turns Redis from a black box into a machine you can reason about. Everything here has been referenced from the earlier type pages; now it gets assembled.

---

## 1. The complete picture

```
   redisServer
     └── db[0 … 15]          (redisDb)
           ├── dict     ──── the KEYSPACE: key → redisObject
           ├── expires  ──── key → expire-at-timestamp (only keys with TTLs)
           └── blocking_keys, ready_keys, watched_keys …

   db->dict
   ┌─────────────────────────────────────────────────────────────────────┐
   │  ht[0]  ← the live table            ht[1]  ← only during rehashing  │
   │  ┌──────────┐                                                       │
   │  │ bucket 0 ┼──► dictEntry ──► dictEntry ──► NULL   (a collision chain)
   │  │ bucket 1 ┼──► NULL                                               │
   │  │ bucket 2 ┼──► dictEntry ──► NULL                                 │
   │  │   …      │                                                       │
   │  └──────────┘                                                       │
   └─────────────────────────────────────────────────────────────────────┘
                        │
                        ▼
   dictEntry (24 bytes)
   ┌────────────────────────────────────┐
   │ void *key    ──► SDS "user:1042"   │
   │ void *val    ──► redisObject       │
   │ dictEntry *next ──► collision      │
   └──────────────┬─────────────────────┘
                  ▼
   redisObject (16 bytes)
   ┌───────────────────────────────────────────────┐
   │ type      : 4 bits   OBJ_STRING/LIST/SET/…    │
   │ encoding  : 4 bits   INT/EMBSTR/RAW/LISTPACK/…│
   │ lru       : 24 bits  clock or LFU counter     │
   │ refcount  : 32 bits                           │
   │ ptr       : 64 bits  ──────────────────┐      │
   └────────────────────────────────────────┼──────┘
                                            ▼
                        one of: SDS · listpack · quicklist · intset
                                · dict · zset(dict+skiplist) · rax
```

**Two levels of indirection, every time.** A key lookup hashes the key name, walks a bucket chain to find a `dictEntry`, follows `val` to a `redisObject`, reads its `type` and `encoding`, then follows `ptr` to the real structure. That is why a Redis "O(1)" lookup is a few hundred nanoseconds rather than a few — it is three potential cache misses.

---

## 2. `redisObject` — 16 bytes that decide everything

```c
typedef struct redisObject {
    unsigned type:4;         // OBJ_STRING, OBJ_LIST, OBJ_SET, OBJ_ZSET,
                             // OBJ_HASH, OBJ_STREAM
    unsigned encoding:4;     // how ptr should be interpreted
    unsigned lru:LRU_BITS;   // 24 bits: LRU clock OR (8-bit freq + 16-bit time)
    int refcount;
    void *ptr;
} robj;
```

The **type** is what `TYPE key` returns and what command dispatch checks (a `GET` on an `OBJ_LIST` produces `WRONGTYPE`). The **encoding** is what `OBJECT ENCODING key` returns and is invisible to your commands — it only changes memory and speed.

### The full type → encoding map

| Type | Encodings | Switch condition |
| :--- | :--- | :--- |
| **String** | `int` | An integer fitting in a `long` — stored *in* `ptr` itself |
| | `embstr` | ≤ 44 bytes — object + SDS in one 64-byte allocation |
| | `raw` | > 44 bytes, or ever mutated |
| **List** | `listpack` | ≤ `list-max-listpack-size` (128) |
| | `quicklist` | above that — a linked list of listpacks |
| **Set** | `intset` | all integers, ≤ `set-max-intset-entries` (512) |
| | `listpack` | small, has non-integers (Redis 7.2+) |
| | `hashtable` | above the thresholds |
| **Hash** | `listpack` | ≤ 128 fields **and** every field/value ≤ 64 bytes |
| | `hashtable` | above either threshold |
| **Sorted Set** | `listpack` | ≤ 128 members **and** every member ≤ 64 bytes |
| | `skiplist` | above either — dict + skiplist together |
| **Stream** | `stream` | always — a rax of listpacks |

```bash
127.0.0.1:6379> OBJECT ENCODING mykey
127.0.0.1:6379> OBJECT REFCOUNT mykey
127.0.0.1:6379> OBJECT FREQ mykey       # requires an LFU maxmemory-policy
127.0.0.1:6379> DEBUG OBJECT mykey      # serializedlength, ql_nodes, …
```

:::danger[Every conversion is one-way]
Redis converts small → large automatically, and **never converts back**. Not on `HDEL`, not on `SREM`, not on `LPOP`.

The reason is cost: checking "could I shrink now?" would mean scanning the whole collection on every removal — turning O(1) deletes into O(N). Redis chooses to keep deletes fast.

**The consequence:** a hash's encoding is determined by the **high-water mark of its entire lifetime**. A user hash that briefly held a 200-byte field stays a `hashtable` forever, at ~4× the memory. If memory looks unexplainably high, sample `OBJECT ENCODING` across your keys before anything else.
:::

### Shared objects

```bash
127.0.0.1:6379> SET a 100
127.0.0.1:6379> OBJECT REFCOUNT a
(integer) 2147483647            ← INT_MAX: "shared, never free"
```

Redis preallocates `redisObject`s for integers **0–9999** at startup (`OBJ_SHARED_INTEGERS`). A million keys holding the value `1` share one object — the value allocation cost is zero.

But an LRU/LFU eviction policy needs a per-key access clock in `robj.lru`, which a shared object cannot have. **So Redis disables integer sharing when `maxmemory-policy` is LRU or LFU.** That is a real and rarely-mentioned memory cost of enabling eviction.

---

## 3. `dict` — the hash table, and incremental rehashing

```c
typedef struct dict {
    dictType *type;
    dictEntry **ht_table[2];     // TWO tables
    unsigned long ht_used[2];
    long rehashidx;              // -1 = not rehashing; else the bucket index
    int16_t pauserehash;
} dict;
```

Collisions are handled by **separate chaining** — a linked list per bucket, with new entries prepended (O(1), and the newest key is the most likely to be read again).

### The problem: a table that must grow

The load factor is `used / size`. Redis grows when it exceeds 1 (or 5 while a background save is running — more on why in a moment) and shrinks below 0.1.

Growing means allocating a table twice the size and moving every entry. **For a 100-million-key database that is seconds of blocking.** Unacceptable on a single thread.

### The solution: rehash a little at a time

Redis keeps **two tables** and migrates buckets gradually.

```
   STEP 0 — normal operation
   ht[0]: [b0][b1][b2][b3]        (4 buckets, 5 entries → load factor 1.25)
   ht[1]: NULL
   rehashidx = -1

   STEP 1 — rehashing begins: allocate ht[1] at 2× size
   ht[0]: [b0][b1][b2][b3]
   ht[1]: [_][_][_][_][_][_][_][_]
   rehashidx = 0

   STEP 2 — every command moves ONE bucket (dictRehashStep)
   ht[0]: [ ][b1][b2][b3]         ← b0's entries moved
   ht[1]: [x][ ][ ][ ][x][ ][ ][ ]
   rehashidx = 1

   … and serverCron also rehashes in 1 ms time-boxed bursts …

   STEP N — done
   ht[0]: [x][ ][x][ ][x][ ][x][x]   ← ht[1] is PROMOTED to ht[0]
   ht[1]: NULL
   rehashidx = -1
```

**During rehashing, every operation must consider both tables:**

```
   LOOKUP  → search ht[0]; if not found and rehashing, search ht[1]
   INSERT  → ALWAYS into ht[1]  (so ht[0] only ever shrinks — it terminates)
   DELETE  → try both
```

That last rule is what guarantees the process finishes: nothing is ever added to the table being drained.

:::note[Why this is a beautiful piece of engineering]
The cost of resizing a 100-million-entry table is not eliminated — it is **amortized across millions of commands**, each paying a few hundred nanoseconds. No single client ever waits for the whole migration.

It is also the reason `SCAN`'s cursor uses reverse-binary increments: the table can grow or shrink *mid-iteration*, and reverse-binary ordering ensures buckets that split are always visited after your current cursor. See [Keys & The Keyspace](./03-keys-and-the-keyspace.md). The two designs are directly connected.
:::

### Rehashing and `fork()`

The load-factor threshold rises from 1 to **5** while an RDB save or AOF rewrite is running (`dict_can_resize` is set to false). This is deliberate: resizing touches enormous numbers of pages, and during a `fork()`-based save, every touched page is **copied** by copy-on-write. Deferring the resize avoids doubling memory at the worst possible moment. See [Persistence](./16-persistence.md).

---

## 4. Where the memory actually goes

```bash
127.0.0.1:6379> INFO memory
used_memory:1073741824              # what Redis thinks it uses (allocator's view)
used_memory_human:1.00G
used_memory_rss:1288490188          # what the OS says the process holds
used_memory_peak:2147483648         # the high-water mark — the number that matters
used_memory_lua:36864
used_memory_scripts:8192
maxmemory:2147483648
maxmemory_policy:allkeys-lru
mem_fragmentation_ratio:1.20        # rss / used_memory
mem_allocator:jemalloc-5.3.0
```

```bash
127.0.0.1:6379> MEMORY DOCTOR              # a plain-English diagnosis
127.0.0.1:6379> MEMORY STATS               # a full per-category breakdown
127.0.0.1:6379> MEMORY USAGE key [SAMPLES n]
127.0.0.1:6379> MEMORY PURGE               # ask jemalloc to release free pages
```

`MEMORY STATS` is the one to learn:

```
   peak.allocated            the high-water mark
   total.allocated           current
   startup.allocated         the empty-server baseline
   replication.backlog       the repl backlog buffer (repl-backlog-size)
   clients.slaves            replica output buffers  ← can be huge during a sync
   clients.normal            regular client buffers
   aof.buffer                pending AOF writes
   dataset.bytes             your ACTUAL DATA
   dataset.percentage        dataset / (total - startup)
   keys.count
   keys.bytes-per-key
   overhead.hashtable.main   the keyspace dict itself
   overhead.hashtable.expires the TTL dict
```

:::tip[Read `dataset.percentage` first]
If `dataset.percentage` is 60%, then **40% of your memory is overhead** — client buffers, the replication backlog, dict structures. That is often the real answer to "why is Redis using so much memory", and no amount of deleting keys will fix it.

The usual culprits: a large `repl-backlog-size`, a replica mid-sync holding a giant output buffer, or thousands of idle connections each with a 16 KB query buffer.
:::

### The per-key overhead, itemized

```
   ONE key "user:1042" → embstr "Ada"

   dictEntry                              24 bytes  (key ptr, val ptr, next)
   key SDS ("user:1042", 9 chars + hdr)  ~16 bytes  (jemalloc-rounded)
   value redisObject + embstr SDS         64 bytes  (one allocation)
   bucket pointer, amortized               ~8 bytes
   ─────────────────────────────────────────────────
                                          ~112 bytes for 3 bytes of data
```

The practical rule from [Strings](./05-strings.md): **budget 50–100 bytes of overhead per key.**

```
   10 M keys  →  ~600 MB–1 GB  before any value data at all
```

Which is the entire argument for [hash bucketing](./07-hashes.md).

---

## 5. Fragmentation

```
   mem_fragmentation_ratio = used_memory_rss / used_memory
```

| Ratio | Meaning | Action |
| :--- | :--- | :--- |
| **~1.0–1.1** | Healthy | None |
| **> 1.5** | Real fragmentation — the OS holds pages the allocator cannot reuse | Activedefrag, or restart |
| **< 1.0** | **The OS has swapped Redis to disk** | 🚨 Emergency — latency will be catastrophic |

### Why fragmentation happens

jemalloc allocates from fixed **size classes** (8, 16, 32, 48, 64, 80, 96, 112, 128, 192, 256, …). A 130-byte request gets a 192-byte slot; 62 bytes are lost. Then a workload that writes many 100-byte values, deletes them, and writes 200-byte values leaves free space scattered in slots the new size cannot use.

```
   A page after churn:
   ┌────┬────┬────┬────┬────┬────┬────┬────┐
   │used│FREE│used│FREE│used│FREE│used│FREE│
   └────┴────┴────┴────┴────┴────┴────┴────┘
   Half free — but no contiguous run large enough for a bigger object,
   and the page cannot be returned to the OS while ANY slot is in use.
```

### Active defragmentation

```conf
activedefrag yes
active-defrag-ignore-bytes 100mb        # don't bother below this much waste
active-defrag-threshold-lower 10        # start at 10% fragmentation
active-defrag-threshold-upper 100       # go full-effort at 100%
active-defrag-cycle-min 1               # min % of CPU to spend
active-defrag-cycle-max 25              # max % of CPU to spend
```

Redis walks the keyspace and **reallocates and copies** values into fresh, compact slots — using a jemalloc-specific hook that reports whether a pointer sits in a sparse run. It costs CPU and adds latency, so it is off by default.

Turn it on when `mem_fragmentation_ratio > 1.5` persistently and you cannot restart. Watch `active_defrag_running` in `INFO`.

:::danger[A ratio below 1.0 means swap, and swap means death]
Redis assumes RAM latency. When the kernel swaps its pages to disk, a "sub-millisecond" operation becomes a 10 ms disk seek — and because the server is single-threaded, **every** client blocks behind it.

```bash
# check whether Redis is swapped
cat /proc/$(pgrep -f redis-server)/status | grep VmSwap
```

Prevent it:
```conf
maxmemory 6gb          # leave real headroom below physical RAM
```
```bash
sysctl vm.overcommit_memory=1    # required for fork()-based saves to succeed
sysctl vm.swappiness=0           # or 1; discourage swapping Redis out
```
Transparent Huge Pages must also be disabled — they cause large latency spikes during copy-on-write:
```bash
echo never > /sys/kernel/mm/transparent_hugepage/enabled
```
Redis logs a warning at startup if THP is on. Do not ignore it.
:::

---

## 6. Practical memory optimization, in priority order

**1. Use the right type.** A Hash instead of N keys is often 5–10×. This dwarfs everything else on this list.

**2. Keep collections under the listpack thresholds.** Then tune the thresholds up if your objects are slightly larger than the defaults:

```conf
hash-max-listpack-entries 512     # up from 128
hash-max-listpack-value   128     # up from 64
zset-max-listpack-entries 256
set-max-intset-entries    1024
```

Raising them trades CPU (linear scans over larger listpacks) for memory. Worth measuring, not guessing — a listpack scan of 512 entries is still fast, but at 4096 it is not.

**3. Shorten key names — but only at scale.** `u:1042:n` vs `user:1042:name` saves 8 bytes. At 100 M keys that is 800 MB; at 100 K keys it is 800 KB and not worth the loss of readability.

**4. Store numeric ids as integers.** They use `int` encoding and `intset`, both dramatically cheaper. One string member converts a whole set out of `intset`.

**5. Compress large values client-side.**

```ts
import { gzipSync, gunzipSync } from 'node:zlib';

const setJson = (k: string, v: unknown, ttl: number) =>
  redis.set(k, gzipSync(Buffer.from(JSON.stringify(v))), 'EX', ttl);

const getJson = async <T>(k: string): Promise<T | null> => {
  const buf = await redis.getBuffer(k);
  return buf === null ? null : (JSON.parse(gunzipSync(buf).toString()) as T);
};
```

JSON compresses 5–10×. You pay CPU on your app servers — which you can scale horizontally — to save memory on Redis, which you cannot. That trade is usually correct.

**6. Set TTLs on everything that can have one.** The cheapest key is the one that deleted itself.

**7. Find the offenders before optimizing anything.**

```bash
redis-cli --bigkeys        # largest key per type, by element count
redis-cli --memkeys        # largest by actual memory
redis-cli --hotkeys        # most accessed (needs an LFU policy)
redis-cli MEMORY DOCTOR
```

Both `--bigkeys` and `--memkeys` use `SCAN`, so they are safe on production. Run them before you guess.

---

## 7. Reading a real diagnosis

```bash
$ redis-cli MEMORY DOCTOR
Sam, I detected a few issues in this Redis instance memory implants:

 * Peak memory: 2.10 GB, current 1.05 GB. Peak is more than 1.5 times
   current. This means the instance had a memory spike; RSS may stay high.
 * High allocator fragmentation: 1.75. This is usually due to a workload
   with many deletes. Consider enabling activedefrag.
```

The diagnostic sequence for "Redis memory is high":

```
   1. INFO memory
        used_memory vs maxmemory   → are we actually near the cap?
        mem_fragmentation_ratio    → < 1.0 = SWAP (emergency, act now)
                                   → > 1.5 = fragmentation, not data

   2. MEMORY STATS
        dataset.percentage low     → the problem is OVERHEAD, not keys:
                                     check clients.slaves (a replica syncing),
                                     replication.backlog, clients.normal

   3. redis-cli --memkeys
        one giant key              → split it
        many similar keys          → wrong type; consider a Hash

   4. OBJECT ENCODING <sample keys>
        unexpectedly "hashtable" /
        "skiplist" / "raw"         → a threshold was crossed once and
                                     never came back. Raise the config,
                                     or keep the outlier field elsewhere.

   5. INFO keyspace
        keys >> expires            → most keys have no TTL. Should they?
```

---

## Rapid-fire recall

1. Draw the chain from a key name to its value bytes. How many pointer hops?
2. What do `type` and `encoding` each control in a `redisObject`?
3. Why does Redis never convert a large encoding back to a small one?
4. Why does enabling an LRU eviction policy cost memory?
5. Why does a `dict` keep two hash tables, and what rule guarantees rehashing terminates?
6. Why does the load-factor threshold rise from 1 to 5 during a background save?
7. `mem_fragmentation_ratio` is 0.85. What is happening and how urgent is it?
8. `dataset.percentage` is 45%. Where should you look?
9. Give the memory optimizations in priority order, and the one that matters most.

<details>
<summary>Answers</summary>

1. `db->dict` bucket → `dictEntry` → `redisObject` → the encoding structure (SDS/listpack/dict/…). Roughly three pointer hops, each a potential cache miss.
2. `type` is the user-visible data type — it drives command dispatch and the `WRONGTYPE` check. `encoding` is the internal representation — invisible to commands, it only affects memory and speed.
3. Checking "could this shrink?" on every removal would require scanning the collection, turning O(1) deletes into O(N). Redis prioritizes fast deletes, so the encoding reflects the collection's lifetime high-water mark.
4. LRU/LFU needs a per-key access clock in `robj.lru`, which shared objects cannot have — so Redis disables the shared-integer pool (values 0–9999) when eviction is enabled.
5. So a resize can be spread across millions of commands instead of blocking once. Inserts always go into `ht[1]`, so `ht[0]` only shrinks and the migration is guaranteed to finish.
6. Resizing touches huge numbers of pages, and during a `fork()`ed save every touched page is copy-on-write duplicated. Deferring the resize avoids doubling memory at the worst moment.
7. RSS is *less* than allocated memory, which means the OS has swapped Redis pages to disk. It is an emergency — every operation now waits on disk, and the single thread means everyone blocks.
8. 55% of memory is overhead, not data. Check `clients.slaves` (a replica mid-sync), `replication.backlog`, and `clients.normal` in `MEMORY STATS`.
9. Right type (Hash over N keys) → stay under listpack thresholds → integer ids → compress big values → shorten keys at scale → TTL everything → and always profile with `--memkeys` first. The type choice dominates everything else.

</details>

---

**Next:** [The Single-Threaded Event Loop](./14-single-threaded-event-loop.md) — how one thread serves a million operations a second.
