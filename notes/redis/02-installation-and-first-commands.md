---
title: Installation & Your First Commands
author: Tejas Nirala
---

# Installation & Your First Commands

> **What you will be able to do after this page**
>
> - Have a Redis server running locally, three different ways.
> - Drive `redis-cli` confidently, including the flags that matter.
> - Trace a single `SET foo bar` from your keystroke, across the socket, into RAM, and back — every step.
> - Read a reply and know which of the five RESP reply types you are looking at.

---

## 1. Getting a server running

### Option A — Docker (recommended for learning)

Nothing to install, nothing to uninstall, no version drift.

```bash
# start a server in the background, port 6379 exposed
docker run -d --name redis -p 6379:6379 redis:7-alpine

# open a CLI inside it
docker exec -it redis redis-cli

# stop / remove when finished
docker stop redis && docker rm redis
```

With persistence and a config file, which is what you actually want once you start experimenting:

```bash
docker run -d --name redis \
  -p 6379:6379 \
  -v "$PWD/redis-data:/data" \
  redis:7-alpine \
  redis-server --appendonly yes --save 60 1000
```

- `-v $PWD/redis-data:/data` — the container writes `dump.rdb` and the AOF into a folder on your machine, so data survives `docker rm`.
- `--appendonly yes` — turn on the append-only log ([persistence](./16-persistence.md)).
- everything after `redis-server` is a config override; the same directives you would put in `redis.conf`.

### Option B — Native install

```bash
# macOS
brew install redis
brew services start redis          # run as a background service
# or just: redis-server

# Debian / Ubuntu
sudo apt update && sudo apt install redis-server
sudo systemctl enable --now redis-server

# from source (the way antirez intended; ~2 minutes)
wget https://download.redis.io/redis-stable.tar.gz
tar xzf redis-stable.tar.gz && cd redis-stable
make && sudo make install
```

### Option C — Managed

AWS ElastiCache / MemoryDB, Google Memorystore, Azure Cache, Redis Cloud, Upstash. You get an endpoint and credentials; you skip the ops. Note that managed offerings **disable some commands** (`CONFIG SET`, `DEBUG`, sometimes `FLUSHALL`) and may run Valkey rather than Redis.

### Verify it is alive

```bash
redis-cli ping
# PONG
```

`PONG` means: your client resolved the host, opened a TCP connection, sent a command, and the server executed and replied. Every layer works.

---

## 2. `redis-cli` — the tool you will live in

```bash
redis-cli                                   # localhost:6379
redis-cli -h redis.example.com -p 6380      # remote host and port
redis-cli -a 'password'                     # auth (prefer REDISCLI_AUTH env var)
redis-cli -u redis://user:pass@host:6379/0  # full connection URI
redis-cli -n 3                              # use logical database 3
redis-cli --tls --cacert ca.crt             # TLS

redis-cli SET k v                           # one-shot: run and exit
redis-cli --scan --pattern 'user:*'         # safely iterate keys (never KEYS)
redis-cli --stat                            # live one-line-per-second dashboard
redis-cli --bigkeys                          # sample the keyspace for huge values
redis-cli --memkeys                          # same, ranked by memory
redis-cli --latency                          # continuous latency sampling
redis-cli --latency-history                  # latency over time, 15s buckets
redis-cli --hotkeys                          # most-accessed keys (needs LFU policy)
redis-cli MONITOR                            # firehose of every command (DEV ONLY)
redis-cli --rdb backup.rdb                   # trigger + download a snapshot
redis-cli --pipe < commands.txt              # bulk-load via the pipe protocol
```

:::warning[Two of these can hurt you]
`MONITOR` streams **every command from every client** to your terminal — on a busy server it can consume a large fraction of the server's throughput. Use it on a development box or for a few seconds, never as a monitoring solution. Use the [`SLOWLOG`](./18-pipelining-and-performance.md) instead.

`--bigkeys` uses `SCAN` and is safe, but it does issue `STRLEN`/`LLEN`/etc. per key — fine, but run it off-peak on huge datasets.
:::

Inside the interactive CLI:

```
127.0.0.1:6379> help @string      # docs for the whole string command group
127.0.0.1:6379> help SET          # docs for one command
127.0.0.1:6379> <TAB>             # command completion
127.0.0.1:6379> CLEAR             # clear the screen
```

---

## 3. Your first five commands, with what each reply means

```bash
127.0.0.1:6379> SET greeting "hello world"
OK

127.0.0.1:6379> GET greeting
"hello world"

127.0.0.1:6379> EXISTS greeting
(integer) 1

127.0.0.1:6379> DEL greeting
(integer) 1

127.0.0.1:6379> GET greeting
(nil)
```

Read the reply *decorations* — they tell you the type, and understanding them now saves confusion later:

| What you see | RESP type | Meaning |
| :--- | :--- | :--- |
| `OK` | Simple String | A status. The command succeeded. |
| `"hello world"` | Bulk String | Actual binary-safe data. Quotes are the CLI's, not part of the value. |
| `(integer) 1` | Integer | A number: a count, a length, or a boolean-as-1/0. |
| `(nil)` | Null | The key does not exist. **Distinct from the empty string `""`.** |
| `(error) ERR ...` | Error | The command failed. |
| `1) "a"` `2) "b"` | Array | A multi-element reply. |

:::tip[`(nil)` vs `""` — a real bug source]
```bash
SET empty ""
GET empty        # ""      → the key exists and holds zero bytes
GET nosuchkey    # (nil)   → the key does not exist
EXISTS empty     # (integer) 1
```
In JavaScript both are falsy, so `if (!cached) { refetch() }` silently refetches forever when the cached value is legitimately an empty string. Check `=== null` explicitly when it matters.
:::

---

## 4. The full trace: what happens when you type `SET user:1:name "Ada"`

This is the picture to hold in your head for the rest of these notes. Every step is real.

```
 ┌────────────────────────────────────────────────────────────────────────────┐
 │ STEP 1 — you type into redis-cli                                           │
 │                                                                            │
 │   SET user:1:name "Ada"                                                    │
 │   The CLI splits this into 3 arguments: ["SET", "user:1:name", "Ada"]       │
 └────────────────────────────────────┬───────────────────────────────────────┘
                                      │
 ┌────────────────────────────────────▼───────────────────────────────────────┐
 │ STEP 2 — encode as RESP and write to the socket                            │
 │                                                                            │
 │   *3\r\n            ← array of 3 elements                                  │
 │   $3\r\nSET\r\n     ← bulk string, 3 bytes                                 │
 │   $11\r\nuser:1:name\r\n                                                   │
 │   $3\r\nAda\r\n                                                            │
 │                                                                            │
 │   43 bytes total, one write() to the TCP socket                            │
 └────────────────────────────────────┬───────────────────────────────────────┘
                                      │  ~0.1–0.5 ms over the network
 ┌────────────────────────────────────▼───────────────────────────────────────┐
 │ STEP 3 — the event loop wakes up                                           │
 │                                                                            │
 │   epoll_wait() returns: "fd 7 is readable"                                 │
 │   → readQueryFromClient(): read() bytes into that client's query buffer    │
 └────────────────────────────────────┬───────────────────────────────────────┘
                                      │
 ┌────────────────────────────────────▼───────────────────────────────────────┐
 │ STEP 4 — parse                                                             │
 │                                                                            │
 │   processInputBuffer() walks the buffer, splits on the length prefixes,    │
 │   builds argv = [robj("SET"), robj("user:1:name"), robj("Ada")], argc = 3  │
 │   No tokenizer, no allocation-per-character — just pointer arithmetic.     │
 └────────────────────────────────────┬───────────────────────────────────────┘
                                      │
 ┌────────────────────────────────────▼───────────────────────────────────────┐
 │ STEP 5 — look up the command                                               │
 │                                                                            │
 │   lookupCommand("set") → the redisCommand struct for SET                   │
 │   Checks: does arity match? is the client authenticated? do the ACL rules  │
 │   allow it? is this a write on a read-only replica? is maxmemory exceeded  │
 │   and this a "denyoom" command?                                            │
 └────────────────────────────────────┬───────────────────────────────────────┘
                                      │
 ┌────────────────────────────────────▼───────────────────────────────────────┐
 │ STEP 6 — EXECUTE (this is the atomic part — nothing else runs)             │
 │                                                                            │
 │   setCommand() →                                                           │
 │     • create an SDS string "Ada"                                           │
 │     • wrap it in a redisObject { type: STRING, encoding: EMBSTR, refcount } │
 │     • dictAdd(db->dict, "user:1:name", theObject)                          │
 │         hash the key → bucket index → append to the bucket's chain         │
 │     • remove any old TTL from db->expires                                  │
 │     • server.dirty++   (used to decide when to snapshot)                   │
 │                                                                            │
 │   Wall-clock cost: roughly 1 microsecond.                                  │
 └────────────────────────────────────┬───────────────────────────────────────┘
                                      │
 ┌────────────────────────────────────▼───────────────────────────────────────┐
 │ STEP 7 — propagate the side effects                                        │
 │                                                                            │
 │   • append to the AOF buffer (if appendonly yes)                           │
 │   • send to every connected replica's output buffer                        │
 │   • fire keyspace notifications, if enabled                                │
 │   • invalidate client-side caches tracking this key (RESP3)                │
 └────────────────────────────────────┬───────────────────────────────────────┘
                                      │
 ┌────────────────────────────────────▼───────────────────────────────────────┐
 │ STEP 8 — reply                                                             │
 │                                                                            │
 │   addReply(c, shared.ok)  → "+OK\r\n" into the client's output buffer      │
 │   The event loop flushes it with write() before the next iteration.        │
 └────────────────────────────────────┬───────────────────────────────────────┘
                                      │  ~0.1–0.5 ms back over the network
 ┌────────────────────────────────────▼───────────────────────────────────────┐
 │ STEP 9 — the CLI decodes "+OK\r\n" and prints:  OK                         │
 └────────────────────────────────────────────────────────────────────────────┘

  Total: ~0.5 ms, of which Redis itself used ~0.000001 s.
  99.8% of the time was the network. Remember this on the pipelining page.
```

And the resulting state in memory:

```
                        db->dict  (the keyspace hash table)
                     ┌─────────────────────────────────────┐
   hash("user:1:na") │  bucket 0  →  ∅                     │
        = bucket 3   │  bucket 1  →  ∅                     │
                     │  bucket 2  →  ∅                     │
                     │  bucket 3  →  ┌──────────────────┐  │
                     │               │ key: "user:1:na…"│  │
                     │               │ val: ──────────┐ │  │
                     │               │ next: NULL     │ │  │
                     │               └────────────────┼─┘  │
                     │  bucket 4  →  ∅                │    │
                     └────────────────────────────────┼────┘
                                                      ▼
                                        redisObject
                                        ┌───────────────────────┐
                                        │ type     = OBJ_STRING │
                                        │ encoding = EMBSTR     │
                                        │ lru      = <clock>    │
                                        │ refcount = 1          │
                                        │ ptr      → SDS "Ada"  │
                                        └───────────────────────┘
```

Every key in Redis looks like this: an entry in a hash table pointing at a `redisObject` that wraps one of the encodings. The full detail is in [Internals: Memory & Encodings](./13-internals-memory-and-encodings.md).

### And the read back

```
 GET user:1:name
   → parse → lookupKeyRead(db, "user:1:name")
       → is it in db->expires and already past its TTL?  → yes: delete, reply nil
       → dictFind(db->dict, "user:1:name") → the redisObject
       → touch its LRU/LFU counter (this is how eviction knows what is hot)
   → type check: is it a String? (if it were a List → WRONGTYPE error)
   → addReplyBulk → "$3\r\nAda\r\n"
```

---

## 5. Getting oriented on a live server

```bash
127.0.0.1:6379> INFO server        # version, uptime, PID, config file
127.0.0.1:6379> INFO memory        # used_memory, peak, fragmentation ratio
127.0.0.1:6379> INFO clients       # connected_clients, blocked_clients
127.0.0.1:6379> INFO stats         # ops/sec, hits/misses, evictions
127.0.0.1:6379> INFO replication   # role: master|slave, connected replicas
127.0.0.1:6379> INFO keyspace      # db0:keys=1024,expires=300,avg_ttl=0

127.0.0.1:6379> DBSIZE             # (integer) 1024  — number of keys, O(1)
127.0.0.1:6379> CONFIG GET maxmemory
127.0.0.1:6379> CONFIG GET 'save'
127.0.0.1:6379> COMMAND COUNT      # how many commands this server knows
127.0.0.1:6379> COMMAND DOCS SET   # machine-readable docs for SET
```

The three lines to read first on any unfamiliar instance:

```bash
redis-cli INFO | grep -E 'redis_version|used_memory_human|maxmemory_human|role|connected_clients|instantaneous_ops_per_sec|keyspace_hits|keyspace_misses|evicted_keys'
```

That tells you the version, how much memory it is using against its cap, whether it is a primary or replica, how busy it is, whether your cache is actually working (hits vs misses), and whether it is under memory pressure (evictions > 0). Full treatment in [Observability & Operations](./24-observability-and-ops.md).

---

## 6. Config: where the knobs live

Redis is configured by `redis.conf`, by command-line flags, or at runtime with `CONFIG SET`.

```bash
# read
CONFIG GET maxmemory
CONFIG GET 'max*'                 # glob patterns work

# write, live, no restart
CONFIG SET maxmemory 2gb
CONFIG SET maxmemory-policy allkeys-lru

# persist the running config back into redis.conf
CONFIG REWRITE
```

:::danger[`CONFIG SET` does not survive a restart]
A `CONFIG SET` change lives only in the running process's memory. If the box reboots, you are back to whatever `redis.conf` says. Either follow it with `CONFIG REWRITE`, or — far better — change the config file through whatever manages your infrastructure. Undocumented drift between the running config and the file on disk is a classic 3 a.m. surprise.
:::

The directives worth knowing on day one:

```conf
bind 127.0.0.1 -::1        # which interfaces to listen on. NEVER 0.0.0.0 unprotected.
protected-mode yes         # refuse outside connections when there is no password
port 6379
requirepass <long-random>  # a password (see the ACL page for the better way)
maxmemory 2gb              # the memory cap
maxmemory-policy noeviction  # what to do when full (see the eviction page)
appendonly yes             # enable the AOF
save 3600 1 300 100 60 10000  # RDB snapshot triggers
databases 16
timeout 0                  # idle client timeout; 0 = never
tcp-keepalive 300
```

---

## 7. Talking to Redis from application code

You will not use `redis-cli` from an app. **Throughout these notes, application code is TypeScript using [`ioredis`](https://github.com/redis/ioredis)** — chosen because its method names map 1:1 onto the commands you are learning (`ZADD` → `redis.zadd`), so there is no translation step between the CLI and your code, and because it has the strongest Cluster, Sentinel, and Lua support. Full treatment in [Clients & Connection Management](./19-clients-and-connection-management.md) and [Redis in an Express App](./30-redis-with-express.md).

```bash
npm install ioredis
npm install -D @types/node          # ioredis ships its own types
```

```ts
// src/redis.ts — one shared client for the whole process
import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

redis.on('error',   (err) => console.error('[redis] error', err));
redis.on('connect', ()    => console.log('[redis] connected'));
```

```ts
import { redis } from './redis';

await redis.set('user:1:name', 'Ada');
const name: string | null = await redis.get('user:1:name');   // 'Ada'

// flags are positional arguments, exactly as in the CLI
await redis.set('session:abc', 'data', 'EX', 3600);
await redis.set('lock:order:9981', uuid, 'NX', 'PX', 30_000);

await redis.hset('user:1', { name: 'Ada', age: 36 });
const user: Record<string, string> = await redis.hgetall('user:1');

await redis.quit();
```

:::tip[The one ioredis rule to internalize now]
**Every reply comes back as a `string` (or `null`, or an array/record of strings).** Redis stores bytes; it has no idea your value was a number.

```ts
await redis.set('count', 42);
const n = await redis.get('count');    // '42'  ← a STRING, not 42
n + 1                                   // '421'  ← the bug
Number(n) + 1                           // 43     ← correct

await redis.hgetall('user:1');          // { name: 'Ada', age: '36' }  ← age is a string
```

Because of this, `redis.get()` is typed `Promise<string | null>` and TypeScript will force you to handle both halves — which is exactly the `(nil)`-vs-`""` distinction from §3, caught at compile time.

```ts
const hit = await redis.get(key);
if (hit) { … }              // ❌ an empty cached string looks like a miss forever
if (hit !== null) { … }     // ✅
```
:::

<details>
<summary>The same thing in other languages, for reference</summary>

```python
# Python — redis-py
import redis
r = redis.Redis(host='localhost', port=6379, decode_responses=True)

r.set('user:1:name', 'Ada')
r.get('user:1:name')            # 'Ada'
r.setex('session:abc', 3600, 'data')
```

```java
// Java — Jedis
try (JedisPool pool = new JedisPool("localhost", 6379);
     Jedis jedis = pool.getResource()) {
    jedis.set("user:1:name", "Ada");
    String name = jedis.get("user:1:name");
    jedis.setex("session:abc", 3600, "data");
}
```

```go
// Go — go-redis
rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
rdb.Set(ctx, "user:1:name", "Ada", 0)
name, err := rdb.Get(ctx, "user:1:name").Result()
```

Every client is a thin wrapper over [RESP](./04-protocol-resp.md); the commands and their semantics are identical everywhere. Only the argument style differs.

</details>

:::note[Binary safety]
Redis stores **bytes**, not text. Most clients decode them to UTF-8 strings for you (`redis-py` needs `decode_responses=True`; ioredis does it by default). This matters the moment you store something that is not valid UTF-8 — a protobuf, a gzip blob, an image thumbnail. Then you want the raw bytes:

```ts
const buf: Buffer = await redis.getBuffer('thumb:88');   // ioredis: any command + "Buffer"
await redis.set('thumb:88', someBuffer);                 // Buffers can be written directly
```
:::

---

## 8. Cleaning up while you experiment

```bash
FLUSHDB              # wipe the current logical database
FLUSHALL             # wipe every database
FLUSHALL ASYNC       # wipe in a background thread — does not block the server
```

:::danger
`FLUSHALL` on the wrong terminal tab is one of the most common self-inflicted production incidents in this ecosystem. On any real server, rename or disable it:

```conf
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command KEYS ""
rename-command CONFIG "CONFIG_a8f7d2e1"
```
:::

---

## Rapid-fire recall

1. What are the six RESP reply types you see in `redis-cli`, and how does each look?
2. Why is `(nil)` different from `""`, and what bug does confusing them cause?
3. In the `SET` trace, which step is the atomic one, and roughly how long does it take?
4. Of the ~0.5 ms a `SET` takes end to end, where does the time actually go?
5. Why is running `MONITOR` on production a bad idea?
6. What does `CONFIG SET maxmemory 2gb` fail to do that you probably wanted?
7. What two `INFO` fields tell you whether your cache is actually working?

<details>
<summary>Answers</summary>

1. Simple String (`OK`), Error (`(error) ERR …`), Integer (`(integer) 1`), Bulk String (`"value"`), Null (`(nil)`), Array (`1) …  2) …`).
2. `(nil)` means the key is absent; `""` means the key exists with a zero-length value. Falsy checks (`if (!v)`) treat them identically, so a legitimately empty cached value causes an infinite cache miss.
3. Step 6, command execution — roughly one microsecond. Nothing else in the server runs during it, which is where atomicity comes from.
4. Almost all of it is network round trip. Redis's own execution is ~0.2% of the total. That is why pipelining and Lua exist.
5. It streams every command from every client through the server's output path, consuming a large share of throughput on a busy instance.
6. It does not write the change to `redis.conf`, so a restart reverts it. Follow with `CONFIG REWRITE` or change the file properly.
7. `keyspace_hits` and `keyspace_misses` from `INFO stats` — the hit ratio is `hits / (hits + misses)`.

</details>

---

**Next:** [Keys & The Keyspace](./03-keys-and-the-keyspace.md) — naming, TTLs, expiry, and why `KEYS *` will get you paged.
