---
title: RESP — The Wire Protocol
author: Tejas Nirala
---

# RESP — The Wire Protocol

> **What you will be able to do after this page**
>
> - Read raw Redis traffic with `nc` or `tcpdump` and understand every byte.
> - Explain why the protocol design is part of the reason Redis is fast.
> - Say what RESP3 added and why client-side caching depends on it.
> - Talk to Redis with nothing but a TCP socket — no client library.

Most people never think about the wire protocol. It is worth one page, because it explains the performance story, it demystifies [pipelining](./18-pipelining-and-performance.md), and it turns "the client library is magic" into "the client library is 200 lines of string parsing".

---

## 1. The design goals

RESP — **RE**dis **S**erialization **P**rotocol — was designed for three things at once:

1. **Simple to implement.** A working client is a weekend project. This is why Redis has good clients in ~50 languages.
2. **Fast to parse.** Every element is length-prefixed, so parsing is `read the length → jump that many bytes`. There is no tokenizing, no escaping, no scanning for delimiters, no schema.
3. **Human-readable.** You can debug it with `telnet`. Compare with a binary protocol where you need a decoder ring.

It is a request/response protocol over TCP, with two exceptions: Pub/Sub (the server pushes unsolicited messages) and `MONITOR`.

---

## 2. RESP2 — the five types

Every reply's **first byte** declares its type. Every element ends with `\r\n` (CRLF).

| Byte | Type | Example on the wire | Prints as |
| :--- | :--- | :--- | :--- |
| `+` | Simple String | `+OK\r\n` | `OK` |
| `-` | Error | `-ERR unknown command 'foo'\r\n` | `(error) ERR …` |
| `:` | Integer | `:1000\r\n` | `(integer) 1000` |
| `$` | Bulk String | `$5\r\nhello\r\n` | `"hello"` |
| `*` | Array | `*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n` | `1) "foo"  2) "bar"` |

Two special forms carry "nothing":

```
$-1\r\n      Null Bulk String   → GET on a missing key
*-1\r\n      Null Array         → BLPOP that timed out
$0\r\n\r\n   Empty Bulk String  → a key holding ""      ← not the same thing!
*0\r\n       Empty Array        → SMEMBERS on a missing set
```

That distinction between `$-1` and `$0\r\n\r\n` is exactly the `(nil)` vs `""` issue from the [first commands page](./02-installation-and-first-commands.md), seen at the byte level.

### Simple String vs Bulk String

- **Simple String** (`+`) cannot contain `\r` or `\n`, is not length-prefixed, and is used only for short server-generated statuses (`+OK`, `+PONG`, `+QUEUED`). It is slightly cheaper.
- **Bulk String** (`$`) is length-prefixed and **binary-safe** — it can contain newlines, null bytes, a JPEG. All user data travels as bulk strings.

---

## 3. Requests: everything is an array of bulk strings

The client always sends a **RESP array of bulk strings**. There is no separate "request format".

`SET user:1 Ada`:

```
*3\r\n
$3\r\n
SET\r\n
$6\r\n
user:1\r\n
$3\r\n
Ada\r\n
```

On one line, escaped: `*3\r\n$3\r\nSET\r\n$6\r\nuser:1\r\n$3\r\nAda\r\n`

Read it as: *"an array of 3 elements; element 1 is 3 bytes: SET; element 2 is 6 bytes: user:1; element 3 is 3 bytes: Ada"*.

**Note the uniformity.** The command name is just argument zero. There is no special casing — which is why `COMMAND`, ACLs, and Cluster key-extraction can all operate generically on `argv[]`.

### Inline commands

For convenience (telnet, health-check scripts), Redis also accepts plain text terminated by CRLF:

```
PING\r\n
SET foo bar\r\n
```

This is a legacy convenience. It is not binary-safe, it cannot express arguments containing spaces without quoting, and real clients never use it.

---

## 4. Do it by hand

The best way to internalize this is to be the client.

```bash
$ printf 'PING\r\n' | nc localhost 6379
+PONG
```

```bash
$ printf '*3\r\n$3\r\nSET\r\n$5\r\nmykey\r\n$7\r\nmyvalue\r\n' | nc localhost 6379
+OK

$ printf '*2\r\n$3\r\nGET\r\n$5\r\nmykey\r\n' | nc localhost 6379
$7
myvalue
```

Three commands in **one packet** — this is pipelining, and there is nothing more to it than concatenating the bytes:

```bash
$ printf 'SET a 1\r\nSET b 2\r\nGET a\r\n' | nc localhost 6379
+OK
+OK
$1
1
```

:::tip[This is the whole secret of pipelining]
The protocol has no request IDs and no correlation tokens. Replies come back **in the order the commands were sent**, period. So a client can write ten commands into the socket without waiting, then read ten replies and match them up positionally.

One round trip instead of ten. That is a 10× latency win for free, and it costs the server nothing extra. See [Pipelining & Performance](./18-pipelining-and-performance.md).
:::

You can also watch the protocol without writing it:

```bash
redis-cli --no-raw GET mykey     # show the raw reply decorations
redis-cli --verbose              # more detail
```

---

## 5. Reading real replies

```
LPUSH mylist a b c
   → :3\r\n

LRANGE mylist 0 -1
   → *3\r\n$1\r\nc\r\n$1\r\nb\r\n$1\r\na\r\n

HGETALL user:1                          (RESP2 — a FLAT array, alternating)
   → *4\r\n$4\r\nname\r\n$3\r\nAda\r\n$3\r\nage\r\n$2\r\n36\r\n
        └─ name ─┘└─ Ada ─┘└─ age ─┘└─ 36 ─┘
     The client must zip pairs into a map itself.

XRANGE events - +                        (nested arrays)
   → *1\r\n
       *2\r\n
         $15\r\n1756742400000-0\r\n
         *2\r\n$5\r\nfield\r\n$5\r\nvalue\r\n

EXEC when a WATCH was invalidated
   → *-1\r\n                             ← Null Array = the transaction aborted
```

Arrays nest arbitrarily, which is how commands like `XRANGE`, `CLUSTER SLOTS`, and `CONFIG GET` return structured data without a schema.

---

## 6. RESP3 — what Redis 6 added and why

RESP2 has a real weakness: **it is not self-describing.** A flat array from `HGETALL` *means* a map, but the protocol does not say so, so every client hardcodes per-command knowledge of how to reshape replies. Multiply that by 240 commands × 50 languages and you have a lot of duplicated, drift-prone code.

RESP3 adds types that carry their own semantics:

| Byte | Type | Purpose |
| :--- | :--- | :--- |
| `_` | Null | `_\r\n` — one null for everything, instead of `$-1` and `*-1` |
| `,` | Double | `,3.14\r\n` — real floats; RESP2 sent scores as strings |
| `#` | Boolean | `#t\r\n` / `#f\r\n` |
| `(` | Big number | Arbitrary-precision integers |
| `!` | Blob error | A binary-safe error |
| `=` | Verbatim string | Text with a format hint (e.g. `txt:`, `mkd:`) |
| `%` | **Map** | `%1\r\n$4\r\nname\r\n$3\r\nAda\r\n` — a real dictionary |
| `~` | Set | An unordered collection |
| `>` | **Push** | An **out-of-band** message from the server |
| `\|` | Attribute | Metadata attached to a reply, ignorable by old clients |

Switch a connection over with:

```bash
redis-cli -3                   # connect in RESP3 mode
127.0.0.1:6379> HELLO 3
127.0.0.1:6379> HGETALL user:1
1# "name" => "Ada"             ← note: rendered as a map, not a flat list
2# "age" => "36"
```

`HELLO 3` upgrades an existing connection; `HELLO` with no argument returns server info and the current protocol version.

### The `>` push type is the important one

In RESP2, a Pub/Sub subscriber's connection enters a special mode where it can no longer run ordinary commands, because there is no way to tell an unsolicited message apart from a reply. RESP3's push type is explicitly out-of-band, which unlocks three things:

1. **Pub/Sub on a normal connection** — you can subscribe and still run `GET` on the same socket.
2. **Client-side caching (server-assisted, "tracking")** — the big one.
3. **Client eviction / server notifications** without a dedicated connection.

### Client-side caching, because it is genuinely useful

```bash
CLIENT TRACKING ON
GET user:1042        # the client caches this locally
# ... later, someone else runs: SET user:1042 "new"
# the server PUSHES an invalidation to your connection:
>2\r\n$10\r\ninvalidate\r\n*1\r\n$9\r\nuser:1042\r\n
# your client evicts its local copy
```

You get a **local, in-process cache with correct invalidation** — reads that hit it cost zero network round trips (~0.5 ms → ~0.0001 ms) and zero Redis CPU. The server keeps an invalidation table mapping keys to the clients tracking them.

Two modes:

- **Default mode** — the server remembers exactly which keys each client read. Precise, but costs server memory proportional to the tracked key set.
- **Broadcast mode** (`CLIENT TRACKING ON BCAST PREFIX user:`) — the server sends invalidations for a *prefix* to all subscribed clients without remembering per-client keys. Cheap for the server, noisier for the client.

```js
// ioredis-style sketch of the two-level pattern
const local = new Map();
async function get(key) {
  if (local.has(key)) return local.get(key);     // L1: process memory, ~0 ms
  const v = await redis.get(key);                // L2: Redis, ~0.5 ms
  local.set(key, v);
  return v;
}
// on the invalidation push: local.delete(key)
```

:::note[When RESP3 matters to you]
Mostly it does not — modern clients negotiate it and reshape replies for you. The two times it does: you want client-side caching, or you are debugging why a `ZSCORE` came back as a string in one client and a float in another. That difference is RESP2 vs RESP3.
:::

---

## 7. Errors on the wire

```
-ERR unknown command 'FOO', with args beginning with:
-WRONGTYPE Operation against a key holding the wrong kind of value
-MOVED 3999 127.0.0.1:6381        ← Cluster: this key lives on another node
-ASK 3999 127.0.0.1:6381          ← Cluster: it's mid-migration, ask over there
-NOAUTH Authentication required.
-NOPERM this user has no permissions to run the 'get' command
-OOM command not allowed when used memory > 'maxmemory'
-READONLY You can't write against a read only replica.
-LOADING Redis is loading the dataset in memory
-BUSY Redis is busy running a script.
-EXECABORT Transaction discarded because of previous errors.
-CLUSTERDOWN The cluster is down
-MASTERDOWN Link with MASTER is down and replica-serve-stale-data is set to 'no'
```

The **first word is a machine-readable error code**; the rest is human prose. Clients switch on that first word. `MOVED` and `ASK` in particular are not really errors — they are redirections that a cluster-aware client handles transparently, updating its slot map and retrying. If you ever see a raw `MOVED` in your application logs, your client is not in cluster mode.

---

## 8. Writing a minimal client

Under 40 lines, to prove there is no magic:

```js
import net from 'node:net';

function encode(...args) {
  let out = `*${args.length}\r\n`;
  for (const a of args) {
    const buf = Buffer.from(String(a));
    out += `$${buf.length}\r\n${buf}\r\n`;
  }
  return out;
}

function decode(buf) {
  const type = buf[0];
  const end  = buf.indexOf('\r\n');
  const head = buf.slice(1, end).toString();

  if (type === 0x2b) return head;                       // '+' simple string
  if (type === 0x2d) throw new Error(head);              // '-' error
  if (type === 0x3a) return Number(head);                // ':' integer
  if (type === 0x24) {                                   // '$' bulk string
    const len = Number(head);
    if (len === -1) return null;
    return buf.slice(end + 2, end + 2 + len).toString();
  }
  if (type === 0x2a) { /* '*' array: recurse, tracking offsets */ }
}

const sock = net.createConnection(6379, 'localhost', () => {
  sock.write(encode('SET', 'hello', 'world'));
  sock.write(encode('GET', 'hello'));                    // pipelined!
});
sock.on('data', (d) => console.log(d.toString()));       // +OK\r\n$5\r\nworld\r\n
```

The real work in a production client is everything *around* this: connection pooling, reconnection with backoff, cluster slot maps, `MOVED`/`ASK` handling, TLS, and correctly buffering partial reads (TCP does not respect your message boundaries — a reply can arrive split across three `data` events). That last one is the bug every hand-rolled client has.

---

## 9. Why the protocol design is a performance feature

```
   Parsing "$6\r\nuser:1\r\n":
     1. read type byte      →  '$'
     2. read digits to \r\n →  6
     3. memcpy 6 bytes      →  "user:1"
     4. skip \r\n
   Four pointer operations. No allocation per character, no state machine,
   no escape handling, no UTF-8 validation, no schema lookup.

   Parsing {"cmd":"set","key":"user:1","val":"Ada"} as JSON:
     tokenize → validate → build a DOM of allocated objects → walk it →
     extract strings → handle escapes → free the DOM
   Orders of magnitude more CPU, and a garbage-collection burden.
```

Redis serves hundreds of thousands of commands per second on a single core. It can only do that because parsing is nearly free. **A "nicer" self-describing protocol like JSON or Protobuf would have made Redis several times slower** — the CPU has to go into executing commands, not into decoding them.

This is the same reasoning that produced BSON's length prefixes in MongoDB and the fixed-width headers in Kafka's protocol: at high message rates, parse cost dominates.

---

## Rapid-fire recall

1. What are the five RESP2 type bytes?
2. How do you distinguish `(nil)` from `""` on the wire?
3. What property of the protocol makes pipelining possible, and why does it need no request IDs?
4. Why is `HGETALL` a flat array in RESP2 but a map in RESP3?
5. What does the RESP3 `>` push type unlock?
6. Is `-MOVED 3999 127.0.0.1:6381` an error? What should a client do with it?
7. Why would switching Redis to JSON-based messaging make it dramatically slower?

<details>
<summary>Answers</summary>

1. `+` simple string, `-` error, `:` integer, `$` bulk string, `*` array.
2. `$-1\r\n` is a null bulk string (key absent); `$0\r\n\r\n` is a zero-length bulk string (key present, empty value).
3. Replies are returned strictly in the order commands were received, so a client can write N commands and read N replies, matching them positionally. No correlation IDs needed.
4. RESP2 has no map type, so semantics live in the client's per-command knowledge. RESP3 added `%`, making the reply self-describing.
5. Out-of-band server-to-client messages: Pub/Sub on a normal connection, server-assisted client-side caching (invalidation pushes), and server notifications.
6. Not really — it is a cluster redirection. A cluster-aware client updates its slot map and retries against the named node, transparently to your code.
7. Parsing would go from a few pointer operations per argument to full tokenizing, validation, allocation, and GC — and at hundreds of thousands of commands per second, parse cost would dominate execution cost.

</details>

---

**Next:** [Strings](./05-strings.md) — the simplest type, and the one with the most surprising depth.
