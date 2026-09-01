---
title: Transactions & Scripting
author: Tejas Nirala
---

# Transactions & Scripting

> **What you will be able to do after this page**
>
> - Explain why a Redis transaction is not an SQL transaction, and what it actually guarantees.
> - Use `WATCH` correctly to implement optimistic locking, with the retry loop.
> - Write, deploy, and debug a Lua script, and know the four rules that keep one safe.
> - Choose between `MULTI`, `EVAL`, and Functions for a given problem.

Redis gives you three ways to make several operations happen as one unit. They have different guarantees, and choosing wrong is a correctness bug.

---

## 1. `MULTI` / `EXEC` — queued batch execution

```bash
MULTI                # start queueing
  <command>          # → QUEUED (not executed)
  <command>          # → QUEUED
EXEC                 # execute ALL of them, atomically
DISCARD              # throw the queue away
```

```bash
127.0.0.1:6379> MULTI
OK
127.0.0.1:6379> SET account:a 100
QUEUED               ← the reply is a placeholder; nothing has run
127.0.0.1:6379> DECRBY account:a 30
QUEUED
127.0.0.1:6379> INCRBY account:b 30
QUEUED
127.0.0.1:6379> EXEC
1) OK
2) (integer) 70      ← now all three run, back to back, uninterrupted
3) (integer) 30
```

```
   HOW IT WORKS

   MULTI          → sets CLIENT_MULTI on your connection
   each command   → validated for existence and arity, then pushed onto
                    this client's queue. NOT executed.
   EXEC           → the server executes the whole queue inside ONE
                    call() sequence. No other client's command can
                    interleave, because there is one thread.
   DISCARD        → clears the queue, unsets the flag
```

### What it guarantees, and what it does not

| Property | Redis `MULTI`/`EXEC` | SQL transaction |
| :--- | :--- | :--- |
| **Isolation** | ✅ Total — nothing interleaves | ✅ (per isolation level) |
| **Atomicity of execution** | ✅ All commands run | ✅ |
| **Rollback on error** | ❌ **No** | ✅ |
| Read a value and branch on it | ❌ Not inside `MULTI` | ✅ |
| Durability | Per your [persistence](./16-persistence.md) config | ✅ |

:::danger[There is no rollback. This is the thing to know.]
```bash
127.0.0.1:6379> MULTI
127.0.0.1:6379> SET key1 "value"
QUEUED
127.0.0.1:6379> LPUSH key1 "oops"        # key1 is a String — this WILL fail
QUEUED
127.0.0.1:6379> SET key2 "value"
QUEUED
127.0.0.1:6379> EXEC
1) OK                                     ← executed
2) (error) WRONGTYPE Operation against…   ← failed
3) OK                                     ← executed ANYWAY
```

The failing command does **not** abort the transaction and does **not** undo the ones before it. You are left in a partial state.

**Why:** Redis commands only fail for programming errors (wrong type, wrong arity) — never for transient or business reasons. antirez's argument is that rollback support would add significant complexity to serve a case that indicates a bug in your code, which rolling back would only hide. You may disagree with the trade, but you must know it exists.

**Two kinds of error behave differently:**

| Error type | When detected | Effect |
| :--- | :--- | :--- |
| **Syntax / unknown command** | At queue time | `EXEC` is **aborted** — `EXECABORT`, nothing runs |
| **Runtime (`WRONGTYPE`, OOM)** | At `EXEC` time | Only that command fails; the rest still run |
:::

```bash
127.0.0.1:6379> MULTI
127.0.0.1:6379> NOSUCHCOMMAND foo
(error) ERR unknown command 'NOSUCHCOMMAND'
127.0.0.1:6379> SET a 1
QUEUED
127.0.0.1:6379> EXEC
(error) EXECABORT Transaction discarded because of previous errors.
```

### The real limitation: you cannot read and decide

```bash
MULTI
  GET balance          # → QUEUED. You do NOT get the value here.
  # you cannot write "if balance > 100 then..." — there is nothing to branch on
EXEC
```

The replies only arrive after `EXEC`. So `MULTI` is fine for a **fixed batch of writes** and useless for **conditional logic**. For that you need `WATCH` (§2) or Lua (§3).

### In TypeScript

```ts
const results = await redis
  .multi()
  .set('account:a', 100)
  .decrby('account:a', 30)
  .incrby('account:b', 30)
  .exec();

// ioredis returns [error, result] pairs, one per command
// [[null, 'OK'], [null, 70], [null, 30]]
for (const [err, value] of results!) {
  if (err) log.error({ err }, 'command failed inside MULTI');
}
```

**Always check the per-command errors.** Because there is no rollback, ignoring them means silently accepting a partial write. ioredis's `exec()` resolves rather than rejects on individual command failures — that array is your only signal.

:::note[`MULTI` is not the same as pipelining]
Both send several commands in one round trip, but:
- **Pipelining** = a network optimization. Commands may interleave with other clients'.
- **`MULTI`/`EXEC`** = an isolation guarantee. Nothing interleaves.

`redis.pipeline()` in ioredis is the former; `redis.multi()` is the latter. If you only want fewer round trips, use `pipeline()` — it is cheaper. See [Pipelining & Performance](./18-pipelining-and-performance.md).
:::

---

## 2. `WATCH` — optimistic locking

`WATCH` makes `EXEC` conditional: if any watched key was modified by anyone between the `WATCH` and the `EXEC`, the transaction aborts.

```bash
WATCH key [key ...]      # monitor these until EXEC or UNWATCH
UNWATCH                  # forget all watches on this connection
```

```
   THE CHECK-AND-SET LOOP

   ┌─────────────────────────────────────────────────────────────┐
   │ 1. WATCH balance                                            │
   │ 2. current = GET balance          ← a NORMAL read; you see  │
   │                                     the value               │
   │ 3. compute the new value in your application                │
   │ 4. MULTI                                                    │
   │ 5.   SET balance <new>                                      │
   │ 6. EXEC                                                     │
   │      • nobody touched `balance` → the replies array         │
   │      • someone DID              → (nil) ⇒ retry from step 1 │
   └─────────────────────────────────────────────────────────────┘
```

```bash
127.0.0.1:6379> WATCH balance
OK
127.0.0.1:6379> GET balance
"100"
# ... meanwhile ANOTHER client runs: SET balance 50 ...
127.0.0.1:6379> MULTI
OK
127.0.0.1:6379> SET balance 70
QUEUED
127.0.0.1:6379> EXEC
(nil)                    ← ABORTED. Nothing ran. Retry.
```

```ts
async function withdraw(userId: string, amount: number, maxRetries = 5): Promise<boolean> {
  const key = `balance:${userId}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await redis.watch(key);

    const raw = await redis.get(key);
    const balance = Number(raw ?? 0);

    if (balance < amount) {
      await redis.unwatch();                 // ← don't leak the watch
      return false;
    }

    const res = await redis.multi().set(key, balance - amount).exec();

    if (res !== null) return true;           // committed
    // null ⇒ the key changed under us; loop and retry
  }

  throw new Error('withdraw: too much contention');
}
```

Three details that make this correct:

1. **`UNWATCH` on every early return.** A `WATCH` left dangling on a pooled connection makes the *next* unrelated transaction on that connection fail mysteriously.
2. **A retry limit.** Under heavy contention this loop can spin forever. Bound it and surface the failure.
3. **`EXEC` returning `null` is not an error** — it is the expected outcome of a race. ioredis resolves with `null`; it does not throw.

### How `WATCH` works internally

```
   db->watched_keys :  "balance" → [ clientA, clientC ]

   When ANY client runs a command that modifies "balance":
     signalModifiedKey("balance")
       → for each client watching it: set CLIENT_DIRTY_CAS

   At EXEC:
     if (client->flags & CLIENT_DIRTY_CAS) → discard the queue, reply (nil)
```

Note what this means: **the flag is set on any modification, not on an actual value change.** `SET balance 100` when it was already 100 still invalidates the watch. It is a pessimistic detector for an optimistic scheme.

:::warning[`WATCH` and connection pools do not mix well]
`WATCH` state lives on the **connection**, not on your logical operation. With a pool, a `WATCH` you forgot to clear travels to whoever checks out that connection next.

Symptoms: transactions failing "randomly" in unrelated code paths. Cures: always `UNWATCH` (including on the error path), use a dedicated connection for watched transactions, or — usually best — **use Lua instead**, which has no connection state at all.
:::

:::danger[`WATCH` is broken by design in Redis Cluster]
Watched keys and the transaction's keys must be on the same node, and `WATCH` gives no cross-slot guarantees. In Cluster, use `{}` hash tags to force co-location, or use Lua. See [Cluster](./22-cluster.md).
:::

---

## 3. Lua scripting — where the real power is

`EVAL` runs a Lua script **inside** the server, atomically, with the ability to read values and branch on them.

```bash
EVAL script numkeys key [key ...] arg [arg ...]
EVALSHA sha1 numkeys key [key ...] arg [arg ...]
SCRIPT LOAD script        # → the SHA1
SCRIPT EXISTS sha1 …      # → 1/0 per sha
SCRIPT FLUSH [ASYNC|SYNC]
SCRIPT KILL               # kill a long-running script (only if it hasn't written)
```

```bash
127.0.0.1:6379> EVAL "return redis.call('SET', KEYS[1], ARGV[1])" 1 mykey myvalue
OK

127.0.0.1:6379> EVAL "return {KEYS[1], KEYS[2], ARGV[1]}" 2 k1 k2 a1
1) "k1"  2) "k2"  3) "a1"
```

### The three things Lua gives you that `MULTI` cannot

```
   1. READ AND BRANCH        local v = redis.call('GET', KEYS[1])
                             if tonumber(v) > 100 then … end

   2. LOOPS AND COMPUTATION  for i, member in ipairs(members) do … end

   3. ONE ROUND TRIP FOR      complex multi-step logic that would otherwise
      COMPLEX LOGIC           be WATCH-retry-WATCH-retry
```

### Atomicity — the same guarantee, and the same danger

A script runs **as one command**. Nothing interleaves. But that also means:

:::danger[A slow script blocks the entire server]
There is one thread. A script that loops a million times stops every client for its whole duration.

```conf
busy-reply-threshold 5000     # ms (formerly lua-time-limit)
```

After this threshold Redis starts replying `-BUSY` to other clients — but **it does not kill the script**. You then have two options:

```bash
SCRIPT KILL      # works ONLY if the script has not yet written anything
SHUTDOWN NOSAVE  # if it HAS written, this is your only option —
                 # killing it mid-write would leave a partial state that
                 # cannot be replicated consistently
```

`SHUTDOWN NOSAVE` on a production primary is a very bad afternoon. **Keep scripts short, bounded, and loop-free where possible.** Never write `while true`. Never iterate an unbounded collection.
:::

### The four rules

**Rule 1 — Every key must be passed in `KEYS`.**

```lua
-- ❌ the key is invisible to Redis
redis.call('GET', 'user:' .. ARGV[1])

-- ✅ declared up front
redis.call('GET', KEYS[1])
```

Redis Cluster routes a command by inspecting its declared keys. A script that constructs key names from `ARGV` **will silently read the wrong node's data** in a cluster. It works perfectly in development on a single node and breaks in production. This is the most important rule on the page.

**Rule 2 — Scripts must be deterministic.**

```lua
-- ❌ nondeterministic: the primary and the replica compute different values
redis.call('SET', KEYS[1], math.random())
redis.call('SET', KEYS[1], os.time())

-- ✅ pass nondeterminism in as an argument
redis.call('SET', KEYS[1], ARGV[1])       -- the caller supplies the value
```

Modern Redis (5+) replicates **script effects** rather than the script itself, which makes this safer than it used to be. But determinism is still required for `redis.replicate_commands()` semantics, for `SORT` without `BY`, and for reasoning about what actually happened. `math.random` is seeded deterministically per script by Redis for this reason.

**Rule 3 — Know the type conversions.** They are lossy in one specific way that bites everyone.

```
   Lua → Redis                          Redis → Lua
   ────────────────────────────         ─────────────────────────────
   number  → integer (TRUNCATED!)       integer     → number
   string  → bulk string                bulk string → string
   table   → array (stops at the        array       → table
             first nil!)                nil reply   → false
   true    → 1                          status      → {ok = "..."}
   false   → nil (a null reply)         error       → {err = "..."}
   nil     → nil
```

:::warning[The float truncation trap]
```lua
return 3.9        -- the client receives (integer) 3
return "3.9"      -- the client receives "3.9"  ✅
return tostring(3.9)
```
Lua numbers returned to Redis are **truncated to integers**. To return a float, return it as a **string**. Every Lua-in-Redis codebase has hit this once.

And the table trap:
```lua
return {1, nil, 3}    -- the client receives just {1} — conversion STOPS at nil
```
:::

**Rule 4 — `redis.call` vs `redis.pcall`.**

```lua
redis.call('GET', KEYS[1])    -- an error ABORTS the script and propagates
redis.pcall('GET', KEYS[1])   -- an error is RETURNED as a table {err = "..."}

local ok = redis.pcall('INCR', KEYS[1])
if type(ok) == 'table' and ok.err then
  return redis.error_reply('cannot increment: ' .. ok.err)
end
```

Use `call` by default — failing loudly is correct. Use `pcall` when you genuinely want to handle a failure and continue.

### Useful helpers

```lua
redis.status_reply('OK')                    -- a +status reply
redis.error_reply('my error message')       -- a -error reply
redis.sha1hex(value)
redis.breakpoint()  redis.debug()           -- with the Lua debugger
redis.log(redis.LOG_WARNING, 'message')     -- writes to the Redis log
redis.setresp(3)                            -- use RESP3 replies inside the script
cjson.encode(table)  cjson.decode(str)      -- JSON, built in
```

`cjson` is genuinely useful — you can store JSON in a String and manipulate it server-side without a round trip.

### `EVALSHA` and the caching protocol

Sending a 2 KB script on every call wastes bandwidth. Load it once and call it by hash:

```bash
127.0.0.1:6379> SCRIPT LOAD "return redis.call('GET', KEYS[1])"
"4e6d8fc8bb01276962cce5371fa5a1c00b0c9b8f"
127.0.0.1:6379> EVALSHA 4e6d8fc8bb01276962cce5371fa5a1c00b0c9b8f 1 mykey
```

The script cache is **not persisted** and is cleared by a restart, by `SCRIPT FLUSH`, and on a replica after a full resync. So the correct pattern is: try `EVALSHA`, and on a `NOSCRIPT` error, `EVAL` the full script (which also re-caches it).

**ioredis does all of this for you:**

```ts
const RATE_LIMIT_LUA = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[2])
  end
  if current > tonumber(ARGV[1]) then
    return 0
  end
  return 1
`;

declare module 'ioredis' {
  interface RedisCommander<Context> {
    rateLimit(key: string, limit: number, windowSec: number): Promise<number>;
  }
}

redis.defineCommand('rateLimit', { numberOfKeys: 1, lua: RATE_LIMIT_LUA });

// call it like any other command — EVALSHA, NOSCRIPT retry, and
// reloading after a failover are handled internally
const allowed = (await redis.rateLimit('rl:user:1042', 100, 60)) === 1;
```

`defineCommand` plus the `declare module` block is the idiomatic, type-safe way to use Lua from TypeScript. Use it for every script.

### Worked scripts

**Conditional decrement (stock reservation):**

```lua
-- KEYS[1] = the product hash, ARGV[1] = quantity
local stock = tonumber(redis.call('HGET', KEYS[1], 'stock'))
if stock == nil then return -1 end        -- no such product
if stock < tonumber(ARGV[1]) then return 0 end   -- insufficient
redis.call('HINCRBY', KEYS[1], 'stock', -tonumber(ARGV[1]))
return 1
```

**Safe lock release (compare-and-delete):**

```lua
-- KEYS[1] = the lock key, ARGV[1] = the token we believe we hold
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
```

**Atomic multi-key transfer with a check:**

```lua
-- KEYS[1] = from, KEYS[2] = to, ARGV[1] = amount
local amount = tonumber(ARGV[1])
local from = tonumber(redis.call('GET', KEYS[1]) or '0')
if from < amount then
  return redis.error_reply('INSUFFICIENT_FUNDS')
end
redis.call('DECRBY', KEYS[1], amount)
redis.call('INCRBY', KEYS[2], amount)
return 1
```

That last one is the canonical example of something `MULTI` fundamentally cannot do, and `WATCH` can only do with a retry loop.

### Debugging

```bash
redis-cli --ldb --eval script.lua key1 key2 , arg1 arg2
#   note the COMMA separating keys from args
```

```
lua debugger> s          # step
lua debugger> c          # continue
lua debugger> p var      # print a variable
lua debugger> r          # show the redis command replies so far
lua debugger> b 5        # breakpoint at line 5
lua debugger> abort
```

A real, interactive, server-side debugger. Almost nobody knows it exists, and it turns Lua from write-only code into something maintainable.

---

## 4. Functions (Redis 7.0+)

Functions are the successor to `EVAL`: named, versioned, **persisted** libraries.

```lua
#!lua name=mylib

local function rate_limit(keys, args)
  local current = redis.call('INCR', keys[1])
  if current == 1 then
    redis.call('EXPIRE', keys[1], args[2])
  end
  return current <= tonumber(args[1]) and 1 or 0
end

redis.register_function('rate_limit', rate_limit)
```

```bash
redis-cli -x FUNCTION LOAD < mylib.lua
# → "mylib"
redis-cli FCALL rate_limit 1 ratelimit:user:1 100 60
redis-cli FCALL_RO rate_limit 1 …            # read-only, safe on replicas
redis-cli FUNCTION LIST
redis-cli FUNCTION STATS
redis-cli FUNCTION DUMP > functions.bak
redis-cli FUNCTION DELETE mylib
```

| | `EVAL` scripts | Functions |
| :--- | :--- | :--- |
| Persisted across restart | ❌ (cache only) | ✅ in the RDB/AOF |
| Replicated to replicas | ❌ (each must be loaded) | ✅ automatically |
| Named | ❌ (a SHA1) | ✅ (`mylib.myfunc`) |
| Multiple functions per unit | ❌ | ✅ a library |
| Read-only variant | ❌ (`EVAL_RO` exists but per-script) | ✅ `FCALL_RO` |
| Client library support | Universal | Patchy |

**Functions are the better design** — they are application logic that lives with the data, deployed once rather than shipped on every connection. In practice `EVAL` is still more common because client support and tooling are more mature, and `defineCommand` makes `EVAL` painless. Use Functions when you have a substantial body of server-side logic you want to version and deploy deliberately.

---

## 5. Choosing between the three

```
   Do you need to READ a value and BRANCH on it?
        │
   ┌────┴────┐
   NO        YES
    │         │
  MULTI       │  Is it a simple compare-and-set on ONE key?
  (or just    │        │
   pipeline   │   ┌────┴────┐
   if you     │  YES       NO / multi-key / needs a loop
   only want  │   │         │
   fewer      │   Is a retry loop acceptable under contention?
   round      │        │
   trips)     │   ┌────┴────┐
              │  YES        NO
              │   │          │
              │ WATCH +    LUA / FUNCTION
              │ MULTI      (one round trip, no retries,
              │ (simple,    works in Cluster with hash tags,
              │  no Lua)    but blocks the server while it runs)
```

| | `MULTI`/`EXEC` | `WATCH` + `MULTI` | Lua / Functions |
| :--- | :--- | :--- | :--- |
| Atomic | ✅ | ✅ | ✅ |
| Read then branch | ❌ | ✅ (client-side) | ✅ (server-side) |
| Round trips | 2 | 3+ per attempt | **1** |
| Retries under contention | n/a | ✅ required | ❌ never needed |
| Rollback on error | ❌ | ❌ | ❌ |
| Blocks the server | briefly | briefly | **as long as it runs** |
| Works in Cluster | same slot only | fragile | ✅ with hash tags |
| Connection state | yes | **yes — a pool hazard** | none |

**Practical guidance:** reach for **Lua via `defineCommand`** for anything conditional. It is one round trip, has no connection state, needs no retry loop, and works in Cluster. Use `MULTI` for a plain batch of unconditional writes. Use `WATCH` when you specifically want optimistic concurrency and prefer to keep logic in your application language.

---

## Rapid-fire recall

1. What does a Redis transaction guarantee, and which SQL guarantee is missing?
2. A `WRONGTYPE` error inside `MULTI` — what happens to the other commands?
3. What is the difference between a queue-time error and a runtime error inside `MULTI`?
4. Why can you not write `if` logic inside `MULTI`?
5. What does `EXEC` return when a watched key changed, and is that an error?
6. Why is a dangling `WATCH` dangerous with a connection pool?
7. Why must every key a Lua script touches be passed in `KEYS`?
8. `return 3.9` from Lua — what does the client receive, and how do you fix it?
9. A Lua script has been running for 30 seconds and has written data. What are your options?
10. Name three advantages Functions have over `EVAL`.

<details>
<summary>Answers</summary>

1. Total isolation (no command from another client interleaves) and that all queued commands execute. **Rollback is missing** — a failed command does not undo the others.
2. They all still execute. Only the failing command errors; you are left in a partial state.
3. A queue-time error (unknown command, wrong arity) causes `EXEC` to abort with `EXECABORT` and nothing runs. A runtime error (`WRONGTYPE`, OOM) fails only that one command at `EXEC` time.
4. Commands are queued, not executed — the replies only arrive after `EXEC`, so there is no value to branch on.
5. `null` (a RESP Null Array). It is **not** an error; it is the expected outcome of a lost race, and you should retry.
6. `WATCH` state lives on the connection. A watch you forgot to clear travels to the next borrower of that connection and makes an unrelated transaction fail mysteriously.
7. Redis Cluster routes commands by inspecting declared keys. A key built from `ARGV` is invisible to the router, so the script silently operates on the wrong node — and it works fine in single-node development.
8. `(integer) 3` — Lua numbers are truncated when converted to Redis integers. Return `"3.9"` or `tostring(3.9)` instead.
9. `SCRIPT KILL` only works if the script has not written. Since it has, the only option is `SHUTDOWN NOSAVE` — which is why scripts must be short and bounded.
10. They are persisted in the RDB/AOF, replicated automatically to replicas, and named/versioned as libraries (plus `FCALL_RO` for replica-safe reads).

</details>

---

**Next:** [Pipelining & Performance](./18-pipelining-and-performance.md) — how to get 10× more throughput from the same server.
