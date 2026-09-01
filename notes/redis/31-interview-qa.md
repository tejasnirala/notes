---
title: Interview Q&A
author: Tejas Nirala
---

# Interview Q&A

> **How to use this page**
>
> 45 questions with answers written the way you would actually **say** them — not bullet lists. Each has a short answer you could give in ten seconds and, where it matters, the depth to go into if they push.
>
> The pattern in a strong Redis interview is: give the crisp answer, then volunteer *one* piece of depth that shows you have operated it. Do not recite everything you know.

---

## Fundamentals

**1. What is Redis?**

An in-memory data structure server. Three words matter. **Server** — it is a separate process you talk to over TCP, so every application instance sees the same data, which is what makes distributed counters and locks possible. **In-memory** — data lives in RAM, so reads are sub-millisecond, but it must fit in memory and it is volatile unless you configure persistence. **Data structure** — unlike Memcached, the values are real structures the server understands: lists, hashes, sets, sorted sets, streams. So appending to a list is one atomic command, not a fetch-modify-write round trip with a race in the middle.

**2. Why is Redis fast?**

In-memory is only half of it. It is also single-threaded for command execution, so there is no locking, no context switching, and no cache-line contention. It uses I/O multiplexing — one thread with epoll handles tens of thousands of connections. Its data structures have multiple encodings, so small objects use compact, cache-friendly layouts. And RESP is trivially parseable — length-prefixed, so parsing is pointer arithmetic rather than tokenizing.

The thing worth adding: **for most workloads the bottleneck is the network, not Redis.** A single unpipelined client in a datacenter tops out around 2,000 ops/sec because of round-trip time, while the server can do a million. That is why `MGET`, pipelining, and Lua matter far more than server tuning.

**3. Is Redis really single-threaded?**

Command *execution* is — one command runs to completion at a time, and that is where atomicity comes from. But the process has been multi-threaded since 4.0: background threads handle AOF fsync, closing files, and freeing large objects, and since 6.0 there are optional I/O threads that parallelize socket reads, writes, and RESP parsing. Those never touch the keyspace, so serialized execution is preserved.

The consequence to mention: because there is one executor, **one slow command blocks every client**. `KEYS *` on ten million keys is not slow — it is a stop.

**4. Redis vs Memcached?**

Memcached is a key-to-blob cache: multi-threaded, slightly better at raw caching throughput on many cores, and that is it. Redis has rich data types, optional persistence, replication, Lua scripting, transactions, Pub/Sub, and Streams. If all you need is "get this blob back", Memcached is simpler. The moment you need a counter, a ranked list, a queue, or a lock, Redis is the answer.

**5. When would you *not* use Redis?**

Data you cannot lose and cannot rebuild — persistence is asynchronous, so you can lose a second of writes and replication does not close that gap. Datasets larger than RAM. Ad-hoc relational queries or full-text search — there is no query planner, and you can only read data the way you explicitly indexed it at write time. Very large individual values, because copying them blocks the single thread. And when you have not measured a problem: Redis adds a network hop, a failure mode, and cache invalidation, which is genuinely one of the hardest problems in software.

---

## Data types

**6. Name the core types and one real use for each.**

String — a counter or a cached blob; `INCR` is atomic. Hash — an object whose fields you read and update independently. List — a queue or a capped feed, fast at both ends. Set — uniqueness and O(1) membership, plus server-side set algebra. Sorted set — leaderboards, priority queues, sliding-window rate limiters. Stream — an event log with consumer groups and acknowledgement. Plus bitmaps, HyperLogLog, and geo, which are specialized commands over strings and sorted sets.

**7. Why a Hash instead of separate keys?**

Memory, mostly. Each key carries about 50 to 90 bytes of overhead — a dictEntry, an SDS for the key, a `redisObject`, allocator rounding. A small hash is stored as a **listpack**, a single flat array with no per-field pointers or objects, so three fields in a hash can cost a fifth of three separate keys. You also get `HGETALL` in one round trip instead of three, and `HSET` updates one field atomically server-side — whereas updating one field of a JSON string is a read-modify-write with a lost-update race.

**8. How does a sorted set achieve O(log N) rank queries?**

It keeps two structures: a dict mapping member to score, giving O(1) `ZSCORE`, and a **skip list** ordered by score, giving O(log N) ranges. A skip list is a sorted linked list with probabilistic express lanes at higher levels — you jump forward in big steps and refine downward.

Rank specifically works because every forward pointer stores a **span** — how many level-0 nodes it skips. Summing the spans along the search path you were already walking gives you the rank for free. That is how "what rank is this player out of fifty million" is about 25 pointer hops.

**9. Why a skip list and not a balanced tree?**

Three reasons antirez gave. Range queries fall out naturally, because level zero is just a sorted doubly linked list — you find the start and walk, with no in-order traversal or parent pointers, and `ZRANGEBYSCORE` is the most common operation. The implementation is far simpler — no rotations, no rebalancing, roughly 200 lines instead of 700. And the constant factors and cache behaviour suit Redis's read/write mix, with a tunable memory-versus-speed knob.

**10. What are internal encodings, and why do they matter?**

Every type has a compact encoding for small collections and a full one for large. A hash under 128 fields with every field and value under 64 bytes is a listpack — one flat allocation, linear scan. Above either threshold it becomes a hashtable, with about 50 to 80 bytes of overhead per field.

The thing that catches people: **conversions are one-way.** Redis never converts back, because checking on every delete would turn O(1) removals into O(N). So a hash's encoding reflects the high-water mark of its entire lifetime — one 100-byte field, deleted an hour later, leaves it a hashtable forever at four times the memory. `OBJECT ENCODING` on a sample is the first thing I check when memory looks wrong.

**11. Set vs sorted set vs list — how do you choose?**

List for insertion order and queue semantics, fast at the ends and O(N) in the middle. Set for uniqueness and O(1) membership, unordered, with server-side unions and intersections. Sorted set when you need ordering by a value you control — a score, a timestamp, a priority — and rank or range queries. If you find yourself scanning a list to check membership, you wanted a set. If you are sorting in the application, you wanted a sorted set.

**12. When would you use a bitmap or a HyperLogLog?**

A bitmap when your identifiers are dense small integers and you need membership. Ten million users' daily activity is 1.25 megabytes — a bit each — versus about 400 megabytes as a set. And `BITOP AND` across two days gives you retention at memory bandwidth.

HyperLogLog when you only need approximate **cardinality** at scale: 12 kilobytes for any number of items, with 0.81% standard error. The property that makes it special is that `PFMERGE` is exact — merging takes the element-wise max of registers, so the union of two HLLs is precisely the HLL of the union. You can add daily counters into a weekly unique count without double-counting, which you cannot do with plain counters at all. What you give up is membership testing and deletion.

---

## Expiry, eviction, memory

**13. How does key expiration work?**

Two mechanisms. **Lazy** — on every read, Redis checks whether the key is in the expires dict and past its time, and deletes it then. **Active** — ten times a second it samples 20 random keys with TTLs, deletes the expired ones, and if more than 25% of the sample was expired it immediately repeats, on the assumption the dict is full of dead keys.

That design means the cost is proportional to how many keys are *actually* expired, not to how many exist. The consequences are that `DBSIZE` can overcount and memory does not drop the instant a TTL passes.

**14. Expiration versus eviction?**

Expiration is time — a TTL you set, counted in `expired_keys`. Eviction is memory pressure — `maxmemory` was reached, counted in `evicted_keys`, and which keys go depends on `maxmemory-policy`. "My key vanished before its TTL" is always eviction.

**15. Walk me through the eviction policies.**

Eight. `noeviction` rejects writes when full. Then LRU, LFU, and random, each in an `allkeys` variant and a `volatile` variant that only considers keys with TTLs — plus `volatile-ttl`, which evicts the shortest remaining TTL.

`allkeys-lru` is the safe default for a pure cache. `noeviction` for anything that is the only copy of its data. The trap is `volatile-*`: if no key has a TTL, there is nothing eligible to evict, so Redis behaves exactly like `noeviction` and starts rejecting writes at 100% memory. That surprises people at three in the morning.

**16. Why is Redis's LRU approximate?**

True LRU needs a doubly linked list reordered on every access — sixteen extra bytes per key and pointer churn on every read. Instead each object carries a 24-bit access clock, and eviction samples `maxmemory-samples` keys (default 5) and evicts the idlest.

The clever part is the **eviction pool**: sixteen slots that persist *between* eviction calls, so good candidates spotted earlier compete with new samples. That is what makes sampling five keys converge close to true LRU. Raising it to ten is nearly indistinguishable from real LRU at about twice the CPU.

**17. How does LFU fit into 8 bits?**

Two tricks. **Logarithmic increment** — the probability of incrementing falls as the counter rises, so with the default log factor an 8-bit counter spans about a million accesses instead of 255. And **time decay** — the counter decreases with elapsed minutes, so "frequently used" means "frequently used recently" rather than "was popular last year".

Use LFU when you have a stable hot set and periodic full scans — an analytics job or a backup would pollute an LRU cache but not an LFU one.

**18. Redis memory is high. Walk me through diagnosing it.**

First `INFO memory`. If `mem_fragmentation_ratio` is below 1.0, the OS has swapped Redis to disk and that is an emergency, because a single-threaded server waiting on a disk seek blocks everyone. Above 1.5 means real fragmentation, not data.

Then `MEMORY STATS` and look at `dataset.percentage`. If it is low, the problem is overhead, not keys — usually a replica mid-full-sync buffering, an oversized replication backlog, or thousands of connections. If it is high, `redis-cli --memkeys` to find the offenders, and `OBJECT ENCODING` on a sample to check whether a threshold was crossed once and never came back.

---

## Persistence

**19. RDB versus AOF?**

RDB is a point-in-time binary snapshot — compact, fast to load, ideal for backups and replica sync, but you lose everything since the last save, which may be minutes. AOF is a log of every write command — larger, slower to load, but with `appendfsync everysec` you lose at most a second.

Run both. AOF gives you the durability guarantee; RDB gives you a file you can copy off the box. The modern default is `aof-use-rdb-preamble yes`, which writes a hybrid: an RDB image as the base plus a command tail. You get RDB's compactness and load speed with AOF's durability.

**20. What are the `appendfsync` options and the real loss window?**

`always` fsyncs every write — essentially zero loss, about ten times slower. `everysec` fsyncs once a second on a background thread — at most one second lost, at essentially full speed. `no` lets the OS decide — up to about thirty seconds.

`everysec` is right for almost everyone. One detail worth mentioning: if a previous fsync is still in flight, Redis delays the write rather than blocking the main thread, so the real worst case is **two** seconds on a saturated disk. `aof_delayed_fsync` in `INFO` tells you if that is happening.

**21. Explain `fork()` and copy-on-write here.**

`BGSAVE` forks a child. The child inherits the page tables with everything marked copy-on-write, so it has a consistent, frozen snapshot with no locking and no pause. When the parent writes to a page, the kernel copies just that page.

Two costs. Memory — every page the parent touches during the save is duplicated, so a write-heavy workload can add 50% or more, and worst case doubles. And latency — copying page tables costs roughly 10 to 20 milliseconds per gigabyte, during which the main thread is blocked.

The thing I would raise unprompted: **Transparent Huge Pages make this dramatically worse.** With 2 MB pages, a one-byte write copies 2 MB instead of 4 KB — 512 times the memory traffic. Latency spikes go from milliseconds to seconds. Redis warns about it at startup and it is the most ignored warning in the ecosystem.

**22. How much data can Redis lose?**

With `everysec`, up to a second — two on a slow disk. With RDB only, everything since the last snapshot. With `always`, essentially nothing, at about a tenth of the throughput.

And **replication does not change any of that**, because it is asynchronous: the primary acknowledges the client before the replica has the write. `WAIT` lets you block until N replicas confirm receipt, which narrows the window, but it is not consensus and it does not make Redis a CP system.

---

## Replication, HA, scaling

**23. How does replication work?**

Asynchronous, one primary and N replicas, replicas read-only by default. A replica sends `PSYNC`. If it has a valid replication ID and its offset is still inside the primary's **replication backlog** — a circular buffer of recent commands — the primary replies `+CONTINUE` and streams from there. Otherwise it is a full sync: the primary forks, streams an RDB, buffers writes during the transfer, then sends the buffered commands and goes live.

The operational detail worth knowing: the backlog defaults to **1 MB**, which is far too small. On a busy primary a one-second blip triggers a full resync — a fork, an RDB transfer, and a replica that flushes and reloads. Sixty-four to 256 megabytes is a sensible starting point.

**24. What is the failing-full-sync loop?**

During a full sync the primary buffers every new write into that replica's output buffer. If it exceeds `client-output-buffer-limit replica`, the primary kills the connection — and the sync restarts, buffers again, and gets killed again. It never converges, and it saturates your network while doing so. If `sync_full` is climbing in `INFO stats`, that is what you are looking at, and the fix is raising the replica output buffer limit.

**25. Explain Sentinel, and quorum versus majority.**

Sentinel is a separate process that monitors the primary, performs automatic failover, and acts as service discovery so clients ask it for the current primary rather than hardcoding an address.

Two numbers matter and people conflate them. **Quorum** is how many Sentinels must agree the primary is down — you configure it, and it produces ODOWN, which authorizes a failover attempt. **Majority** is how many Sentinels must vote to authorize a specific Sentinel to *run* the failover, and it is always `floor(N/2)+1` of all known Sentinels and **not configurable**.

Which is why you need at least three Sentinels on three separate hosts. With two, majority is two — lose one and the survivor cannot fail over at exactly the moment you needed it. Setting quorum to 1 does not help, because it only affects detection.

**26. Trace a Sentinel failover.**

Missed pings for `down-after-milliseconds` gives SDOWN — one Sentinel's local opinion. Sentinels ask each other; once quorum agrees it becomes ODOWN. A leader is elected in a Raft-like term vote requiring majority. The leader ranks replicas — discarding stale ones, then by `replica-priority`, then by replication offset, then run ID — and sends `REPLICAOF NO ONE` to the winner. It reconfigures the other replicas one at a time per `parallel-syncs`, then publishes `+switch-master`, which clients are subscribed to.

Total is roughly `down-after-milliseconds` plus a couple of seconds. And **writes acknowledged by the old primary but not replicated are gone** — that is the asynchronous replication cost showing up.

**27. Explain Redis Cluster and hash slots.**

The keyspace is split into 16,384 slots, `CRC16(key) mod 16384`, and slots are assigned to primaries each with their own replicas. Every node knows the full map, and clients cache it, so there is one hop and no proxy.

Why 16,384: every node broadcasts its slot assignment as a bitmap in every gossip heartbeat. 16,384 slots is 2 KB; 65,536 would be 8 KB. The cluster was never designed beyond about a thousand nodes, so 16,384 gives ample granularity at a quarter of the header size.

**28. `MOVED` versus `ASK`?**

`MOVED` is permanent — the slot lives on another node now, so the client updates its cached slot map and retries. `ASK` is a one-shot redirect during migration: this particular key has already moved, but the slot has not, so the client sends `ASKING` followed by the command to the named node and does **not** update its map. `ASKING` exists because the target does not own the slot yet and would otherwise reply `MOVED` straight back, ping-ponging forever.

**29. What does Cluster take away?**

Multi-key commands must stay within one slot, or you get `CROSSSLOT` — that affects `MGET`, `MSET`, set operations, `ZUNIONSTORE`, transactions, and Lua whose `KEYS` span slots. Only database 0. `SCAN` and `KEYS` are per-node, so a full scan means visiting every primary. Plain Pub/Sub is broadcast to every node, so you want sharded Pub/Sub. And `WATCH` is fragile across slots.

Hash tags fix the co-location cases — braces around the part you group by, so `{user:1042}:profile` and `{user:1042}:sessions` share a slot. The mistake is over-tagging: tagging by tenant puts all of a tenant's data on one node, which recreates a single-node bottleneck inside your cluster and produces a slot too large to reshard.

**30. Do I actually need Cluster?**

Usually not yet. One node handles a hundred thousand ops per second, over a million pipelined, and hundreds of gigabytes of RAM, and reads scale with replicas at no complexity cost. I would try a bigger instance, then read replicas, then application-level sharding across independent instances — pick the instance by `hash(userId) % N` — before Cluster, because the costs are permanent: they shape your entire key design.

---

## Transactions and scripting

**31. What does `MULTI`/`EXEC` guarantee?**

Total isolation — commands are queued and then executed back to back with nothing from another client interleaved — and that all queued commands execute.

What it does **not** give you is rollback. If one command fails at runtime, say a `WRONGTYPE`, the others still run and you are left partial. antirez's reasoning is that Redis commands only fail for programming errors, and rollback would add real complexity to hide a bug. Two error classes behave differently: a syntax error at queue time aborts the whole `EXEC`; a runtime error only fails that command.

**32. What is `WATCH` and when does it break?**

Optimistic locking. You `WATCH` keys, read them normally, compute, then `MULTI`/`EXEC` — and if anything modified a watched key, `EXEC` returns null and nothing ran, so you retry. Note it triggers on any *modification*, not on an actual value change.

It breaks in two places. **Connection pools** — `WATCH` state lives on the connection, so a watch you forgot to clear travels to the next borrower and makes unrelated transactions fail mysteriously. Always `UNWATCH` on early returns. And **Cluster**, where cross-slot watches give no guarantee. In both cases the answer is usually Lua, which has no connection state.

**33. When Lua over `MULTI`?**

Whenever you need to read a value and branch on it. Inside `MULTI` the replies only arrive after `EXEC`, so there is nothing to branch on. Lua runs inside the server, atomically, in one round trip, with no retry loop and no connection state.

The rules that matter: **every key must be passed in `KEYS`**, because Cluster routes by inspecting declared keys — a key built from `ARGV` is invisible to the router and silently reads the wrong node, which works perfectly in single-node development. Scripts must be deterministic. And Lua numbers returned to Redis are truncated to integers, so return floats as strings.

The danger: a script blocks the whole server for its duration, and once it has written, `SCRIPT KILL` will not work — your only option is `SHUTDOWN NOSAVE`. So scripts must be short and bounded.

---

## Patterns

**34. How would you implement a distributed lock?**

`SET lock:resource <uuid> NX PX 30000`, released with a Lua script that deletes only if the value still matches your UUID. Four parts, all load-bearing: the UUID so you cannot delete someone else's lock after yours expired, `NX` for atomic acquisition, `PX` so a crashed holder does not deadlock forever, and the conditional release because `GET` then `DEL` has a race.

Then the honest caveat: **no lock service prevents the pause problem.** A client acquires the lock, freezes on a GC pause, the lock expires, someone else takes it, and the first client resumes still believing it holds the lock. Not Redis, not ZooKeeper, not etcd. The real defences are fencing tokens — which only help if the protected resource checks them — or, far more practically, making the operation idempotent so a double execution is a wasted cycle rather than an incident.

**35. What is Redlock and what is your position on it?**

Acquire on a majority of N independent Redis primaries with no replication between them, within less than the TTL. Kleppmann's critique is that it depends on bounded clock drift, does not solve the pause problem, and provides no fencing tokens.

My position: the useful distinction is efficiency locks versus correctness locks. For an efficiency lock — "don't do this expensive work twice" — a single-instance `SET NX PX` is fine and Redlock is overkill. For a correctness lock, Redis is not sufficient with or without Redlock, and I would push the invariant into the database as a unique constraint or a conditional update, because that is the system that owns the data. Redlock sits awkwardly between: five times the operational cost for a guarantee that still is not one.

I would also mention that running Redlock against a Sentinel-managed primary–replica pair is a common misimplementation — asynchronous replication means the promoted replica has no lock.

**36. Design a rate limiter.**

Four options. Fixed window with `INCR` and a TTL is cheapest but allows a 2× boundary burst — a hundred requests at 11:59:59 and a hundred at 12:00:00 both pass. A sliding log in a sorted set is exact with no burst, but costs one member per request, so it does not scale with large limits. A sliding window counter keeps two fixed-window counters and interpolates — constant memory, no boundary burst, accurate within a few percent, and that is my default for HTTP APIs. A token bucket allows deliberate bursts and variable cost per request, which is what API gateways want.

I would also mention the operational decisions: fail open or closed — open for general traffic, closed for login endpoints, because unlimited credential stuffing is worse than a two-minute lockout — and never put limiter keys on an eviction-enabled instance, because an eviction silently resets someone's budget with no error.

**37. Explain the three caching failure modes.**

**Penetration** — repeated requests for records that do not exist, which the cache cannot absorb because there is nothing to cache. Fix with negative caching under a short TTL, and validating the ID format.

**Avalanche** — many keys expiring in the same second, producing a simultaneous flood of misses that overloads the database. One-line fix: jitter every TTL.

**Stampede** — many concurrent requests missing the *same* hot key and all running the same expensive query. Fix with a lock so only one recomputes, or probabilistic early expiration, where each reader rolls a die weighted by how close expiry is and how expensive the value was to compute, so one reader refreshes it *before* it expires and nobody ever sees a miss.

**38. On a write, do you update the cache or delete it?**

Delete. Two reasons. Concurrent writes can `SET` in the reverse order they hit the database, leaving the cache holding an older value permanently — deletion is idempotent and order-independent. And what you write is not what you read back: the database applies defaults, triggers, and computed columns, so caching your patch object caches a lie.

**39. Streams versus Pub/Sub versus a List?**

A List is a queue you destroy as you read — a pop removes it, so a crash mid-job loses the job unless you use `BLMOVE` into a processing list. Pub/Sub is a fire-and-forget broadcast with no persistence, no acknowledgement, and at-most-once delivery — publish to an empty channel and the message ceases to exist. A Stream is a persistent log you can re-read, with the **server** tracking which entries were delivered to whom and which were acknowledged.

For jobs I would use a Stream with a consumer group. The Pending Entries List replaces about a hundred lines of janitor and heartbeat code: `XREADGROUP` records delivery, `XACK` clears it, `XAUTOCLAIM` reassigns anything idle past a threshold, and the delivery count lets you dead-letter a poison message instead of retrying it forever.

**40. Why is every Redis queue at-least-once?**

Because the side effect and the acknowledgement are in two different systems and cannot be made atomic. A worker charges a customer and dies before `XACK`; the job is reclaimed and charged again. That is true of SQS and RabbitMQ too. So handlers must be idempotent — an idempotency key with your payment provider, or a unique constraint in your own database, which is strongest because the marker and the effect commit in the same transaction.

---

## Operations

**41. What is `KEYS` and why can you not use it?**

O(N) over the whole keyspace on the single thread. Ten million keys is several seconds during which every other client is stopped — not slow, stopped. Use `SCAN`, which is cursor-based and non-blocking.

The guarantees to state precisely: every key present for the whole iteration is returned at least once; keys added and removed during it may or may not appear; **keys may be returned more than once**, so your code must be idempotent; and there is no snapshot. `COUNT` is a hint, not a limit, and only a cursor of `"0"` means you are done — an empty batch does not.

**42. Why does the `SCAN` cursor use reverse binary increments?**

Because the hash table can grow or shrink mid-iteration. Redis increments the cursor by adding one to the most significant bit and carrying rightward, so when a bucket splits during a resize, both halves are always visited *after* the cursor you currently hold. With normal ordering a resize would scatter unvisited keys into buckets you had already passed, and you would miss them. It is also why keys can repeat — a shrink can pull an already-visited key into a bucket you have not reached.

**43. Explain incremental rehashing.**

Growing a hash table with a hundred million entries would block for seconds. So a `dict` keeps **two** tables. When it grows, it allocates the second at twice the size and migrates one bucket per command, plus time-boxed bursts in `serverCron`. During rehashing, lookups check both tables, deletes try both, and **inserts always go into the new one** — which is what guarantees the old table only shrinks and the migration terminates.

The cost is amortized across millions of commands rather than paid once. And it is directly why `SCAN` needs reverse-binary cursors.

**44. Your latency spiked. Walk me through it.**

First, is it Redis at all — I run `redis-cli --latency` from the Redis host and from an app host. If both are fine and the app is still slow, it is not Redis: it is the connection pool, GC pauses, DNS, or an N+1 making five hundred sequential calls. That is the most commonly misattributed cause.

If it is Redis: `SLOWLOG GET` for O(N) commands. Then `LATENCY LATEST`, which names the *event class* — `fork` means persistence, so check THP and consider saving on a replica; `aof-fsync-always` means the disk; `expire-cycle` means a mass-expiry storm needing TTL jitter; `eviction-cycle` means you are at `maxmemory`. Then `INFO memory` for fragmentation below 1.0, which means swapping. Then `total_connections_received` for connection churn. Then `--hotkeys`.

**45. What are the five configuration mistakes you see most?**

`maxmemory 0`, the default, so the OOM killer eventually takes the whole dataset. Transparent Huge Pages enabled, causing multi-second latency spikes during saves that get blamed on everything else. `repl-backlog-size` left at 1 MB, so a brief blip triggers a full resync. All the `lazyfree-*` settings left off, so one big `DEL` stalls the server for seconds. And `vm.overcommit_memory 0`, which makes `fork()` fail, which makes saves fail, which then trips `stop-writes-on-bgsave-error` and rejects all writes.

I would add a sixth that is architectural rather than a config line: **putting locks, queues, and rate-limit counters on the same instance as your cache.** A traffic spike fills memory, `allkeys-lru` evicts a lock, and two workers enter the critical section — with no error, no log, and no way to find it after the fact. Cache and durable state belong on separate instances with different eviction policies.

---

## The five closing questions people fumble

**Why is single-threaded an advantage?**
No locks, no context switching, no contention — and every command is atomic for free, which is exactly what makes counters, locks, and `SET NX` correct.

**What breaks a TTL?**
A plain `SET` on an existing key clears it. Commands that modify in place — `INCR`, `HSET`, `LPUSH`, `APPEND` — preserve it. `KEEPTTL` fixes it.

**Is Redis CP or AP?**
AP. Replication is asynchronous, there is no consensus, and a primary acknowledges before replicating. Sentinel and Cluster give you availability, not consistency.

**What is the most common way a Redis instance dies?**
Unbounded growth — a list or stream with a producer and no consumer, or a keyspace with no TTLs — combined with `maxmemory` unset. Every collection needs a bound: a TTL, an `LTRIM`, a `ZREMRANGEBY*`, or `MAXLEN ~`.

**What is the highest-payoff performance fix?**
Stop making N sequential round trips. `MGET`, a pipeline, or a Lua script. It is typically 10 to 100×, and most "Redis is slow" investigations end there — long before anything a Cluster or threaded I/O would have fixed.

---

**Back to:** [the index](./index.md) · [Anti-Patterns & Playbook](./29-antipatterns-and-production-playbook.md)
