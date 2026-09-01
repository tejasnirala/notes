---
title: Sorted Sets
author: Tejas Nirala
---

# Sorted Sets

> **What you will be able to do after this page**
>
> - Build a leaderboard with O(log N) rank queries and explain why it is O(log N).
> - Draw a skip list from memory and explain why Redis chose it over a balanced tree.
> - Use score ranges, lexicographic ranges, and `ZRANGEBYLEX` for autocomplete.
> - Recognize the six production patterns that are secretly sorted sets.

The Sorted Set (`zset`) is **the most powerful type in Redis** and the one interviews probe hardest. It is a Set where every member also carries a **score** (a double), and the collection is permanently ordered by that score.

---

## 1. The mental model

```
   key "leaderboard"

   score:    100        250        400        400        890
             │          │          │          │          │
   member:  "dave"    "alice"    "bob"     "carol"    "erin"
   rank:      0          1          2          3          4      (ascending)
   revrank:   4          3          2          1          0      (descending)

   • Members are UNIQUE (it is a Set).
   • Scores are NOT unique.
   • Ties are broken LEXICOGRAPHICALLY by member — that's why "bob" precedes
     "carol" at score 400. This is deterministic, which matters more than
     it sounds: pagination is stable.
```

**Two access paths, both fast:**

```
   member ──► score      O(1)       via a hash table  (ZSCORE)
   score  ──► members    O(log N)   via a skip list   (ZRANGEBYSCORE, ZRANK)
```

That dual structure is the whole design. Redis keeps **both** a `dict` (member → score) and a **skip list** (ordered by score), kept in sync. You pay ~2× memory for a structure that is fast in both directions. Details in §7.

---

## 2. Writing

```bash
ZADD key [NX|XX] [GT|LT] [CH] [INCR] score member [score member ...]
ZINCRBY key increment member
ZREM key member [member ...]
```

| Flag | Meaning |
| :--- | :--- |
| `NX` | Only add **new** members; never update an existing score |
| `XX` | Only update **existing** members; never add |
| `GT` | Update only if the new score is **greater** than the current |
| `LT` | Update only if **less** |
| `CH` | Return the count of **changed** (added + updated) rather than just added |
| `INCR` | Behave like `ZINCRBY` — increment instead of set, return the new score |

```bash
127.0.0.1:6379> ZADD leaderboard 100 dave 250 alice 400 bob
(integer) 3
127.0.0.1:6379> ZADD leaderboard 500 alice
(integer) 0                       ← 0 NEW members. The update still happened.
127.0.0.1:6379> ZADD leaderboard CH 600 alice
(integer) 1                       ← CH counts the update
127.0.0.1:6379> ZINCRBY leaderboard 50 dave
"150"
127.0.0.1:6379> ZADD leaderboard GT 100 dave
(integer) 0
127.0.0.1:6379> ZSCORE leaderboard dave
"150"                             ← unchanged: 100 was not > 150
```

:::tip[`GT` is the correct primitive for a high-score table]
```ts
// ❌ racy: two clients, both read 150, both write their own result
const current = Number(await redis.zscore('leaderboard', user));
if (score > current) await redis.zadd('leaderboard', score, user);

// ✅ atomic, one round trip, cannot regress
await redis.zadd('leaderboard', 'GT', 'CH', score, user);
```
`GT`/`LT` (Redis 6.2+) turn a check-then-act into a single atomic command. Before them you needed `WATCH`/`MULTI` or a Lua script. Reach for them any time the rule is "only move in one direction" — high scores, latest-seen timestamps, maximum bid.
:::

### Scores are IEEE-754 doubles — know the limits

```bash
ZADD z 1.5 a                  # fine
ZADD z inf b                  # +infinity is a legal score, and sorts last
ZADD z -inf c                 # -infinity sorts first
ZADD z 9007199254740993 d     # ⚠ silently rounded — beyond 2^53
```

A double holds integers exactly up to **2⁵³ (≈ 9.007 × 10¹⁵)**. Beyond that, precision is lost silently. Millisecond Unix timestamps (~1.7 × 10¹²) are comfortably safe. Nanosecond timestamps (~1.7 × 10¹⁸) are **not** — a classic bug in event-ordering code. Snowflake IDs are also past the limit.

`+inf` and `-inf` are genuinely useful: `+inf` pins a member permanently at the top (a sticky/pinned item), and they are the natural bounds in every range query.

---

## 3. Reading

### By rank

```bash
ZRANGE key start stop [REV] [WITHSCORES]   # by rank, ascending by default
ZREVRANGE key start stop [WITHSCORES]      # (legacy; prefer ZRANGE … REV)
ZRANK key member [WITHSCORE]               # 0-based rank ascending
ZREVRANK key member [WITHSCORE]            # 0-based rank descending
ZSCORE key member                          # → the score as a string, or nil
ZMSCORE key m [m ...]                      # → array of scores (6.2+)
ZCARD key                                  # → member count. O(1)
ZCOUNT key min max                         # → count within a score range. O(log N)
ZRANDMEMBER key [count] [WITHSCORES]
```

```bash
127.0.0.1:6379> ZADD lb 100 dave 250 alice 400 bob 890 erin

127.0.0.1:6379> ZRANGE lb 0 -1 WITHSCORES
1) "dave"   2) "100"
3) "alice"  4) "250"
5) "bob"    6) "400"
7) "erin"   8) "890"

127.0.0.1:6379> ZRANGE lb 0 2 REV WITHSCORES     # top 3
1) "erin"   2) "890"
3) "bob"    4) "400"
5) "alice"  6) "250"

127.0.0.1:6379> ZREVRANK lb bob
(integer) 1                      ← bob is 2nd from the top (0-based)
127.0.0.1:6379> ZSCORE lb bob
"400"                            ← always a STRING; Number() it
```

:::tip[The killer feature: `ZREVRANK` is O(log N)]
"What rank is this player out of 50 million?" is answered in about 25 pointer hops.

In SQL that is `SELECT COUNT(*) FROM scores WHERE score > ?` — a full index scan, hundreds of milliseconds, and it gets worse as you grow. In Redis it is a single skip-list traversal that reads the cached span counters. This one capability is why every game leaderboard in the world runs on Redis.
:::

### By score range

```bash
ZRANGEBYSCORE key min max [WITHSCORES] [LIMIT offset count]   # legacy
ZRANGE key min max BYSCORE [REV] [LIMIT offset count]         # modern (6.2+)
ZREMRANGEBYSCORE key min max
```

Interval notation matters:

```bash
ZRANGE lb 100 400 BYSCORE       # 100 <= score <= 400   (inclusive by default)
ZRANGE lb (100 400 BYSCORE      # 100 <  score <= 400   ( "(" = exclusive )
ZRANGE lb -inf +inf BYSCORE     # everything
ZRANGE lb (250 +inf BYSCORE     # strictly above 250
ZRANGE lb 400 100 BYSCORE REV   # ⚠ with REV, min and max SWAP: max comes first
```

:::warning[Two things that trip everyone up]
1. **`(` means exclusive** and must be attached to the number: `(100`, not `( 100`.
2. **With `REV`, the argument order flips.** `ZRANGE key max min BYSCORE REV`. Getting it backwards returns an empty array rather than an error, which makes it a silent bug. When in doubt, test it in the CLI first.
:::

### By lexicographic range

When **every member has the same score**, a sorted set falls back to sorting by member name — and you can range over that:

```bash
ZRANGE key min max BYLEX [REV] [LIMIT offset count]
ZLEXCOUNT key min max
ZREMRANGEBYLEX key min max
```

Lex bounds use their own notation:

```
   [   inclusive      [apple
   (   exclusive      (apple
   -   minimum        (the smallest possible string)
   +   maximum        (the largest possible string)
```

```bash
127.0.0.1:6379> ZADD words 0 apple 0 apricot 0 banana 0 blueberry 0 cherry

127.0.0.1:6379> ZRANGE words [a (c BYLEX
1) "apple"  2) "apricot"  3) "banana"  4) "blueberry"

127.0.0.1:6379> ZRANGE words [ap [ap\xff BYLEX      # prefix search for "ap"
1) "apple"  2) "apricot"
```

That last line is **autocomplete**. Full worked example in §5.

:::danger[`BYLEX` requires identical scores]
If scores differ, members are ordered by score first and the lexicographic range is meaningless — you will get results that look random. Redis does not warn you. Always `ZADD key 0 member` for a lex-only sorted set.
:::

### Removal by range — how you keep a zset bounded

```bash
ZREMRANGEBYRANK key start stop      # by position
ZREMRANGEBYSCORE key min max        # by score
ZREMRANGEBYLEX key min max          # lexicographically
ZPOPMIN key [count]                 # remove and return the lowest-scored
ZPOPMAX key [count]                 # ... the highest
BZPOPMIN / BZPOPMAX key… timeout    # blocking variants
ZMPOP / BZMPOP numkeys key… MIN|MAX [COUNT n]   # (7.0+)
```

```bash
# keep only the top 100 (the leaderboard trim)
ZREMRANGEBYRANK leaderboard 0 -101

# drop everything older than an hour (a sliding time window)
ZREMRANGEBYSCORE events 0 (Date.now() - 3600000)
```

Those two lines are how you stop a sorted set growing forever — the same discipline as `LTRIM` for Lists. **Every zset needs one of them, or a TTL.**

`BZPOPMIN` gives you a **priority queue with blocking pop** — a job queue where the lowest score runs first. That is a genuinely powerful primitive and the basis of delayed-job scheduling (§5).

---

## 4. Set algebra with scores

```bash
ZUNIONSTORE  dst numkeys key… [WEIGHTS w…] [AGGREGATE SUM|MIN|MAX]
ZINTERSTORE  dst numkeys key… [WEIGHTS w…] [AGGREGATE SUM|MIN|MAX]
ZDIFFSTORE   dst numkeys key…
ZUNION / ZINTER / ZDIFF numkeys key… [WITHSCORES]    # return, don't store (6.2+)
ZINTERCARD numkeys key… [LIMIT n]                    # count only (7.0+)
```

`numkeys` is mandatory and must be exact — it tells the parser where the key list ends and the options begin. Getting it wrong is a syntax error, which is at least loud.

```bash
127.0.0.1:6379> ZADD sales:jan 100 alice 200 bob
127.0.0.1:6379> ZADD sales:feb 150 alice 50 bob 300 carol

127.0.0.1:6379> ZUNIONSTORE sales:q1 2 sales:jan sales:feb
(integer) 3
127.0.0.1:6379> ZRANGE sales:q1 0 -1 WITHSCORES REV
1) "carol"  2) "300"
3) "alice"  4) "250"      ← 100 + 150, SUMmed by default
5) "bob"    6) "250"      ← 200 + 50
```

### `WEIGHTS` — the ranking trick worth knowing

Each key's scores are multiplied by its weight before aggregation:

```bash
# a relevance score: recency counts triple, popularity counts once
ZUNIONSTORE feed:ranked 2 posts:recency posts:popularity WEIGHTS 3 1

# a decaying leaderboard: this week matters 4×, last week 2×, older 1×
ZUNIONSTORE lb:overall 3 lb:w0 lb:w1 lb:w2 WEIGHTS 4 2 1
```

This is a **weighted ranking engine in one command**. Combined with `AGGREGATE MAX` (take the best signal rather than the sum) it covers a surprising amount of what people reach for a search engine to do.

```bash
# "users active in BOTH periods, scored by their better session count"
ZINTERSTORE active 2 sessions:jan sessions:feb AGGREGATE MAX
```

:::note[Using a Set as an operand]
`ZUNIONSTORE`/`ZINTERSTORE` accept plain **Sets** too — each member is treated as having score `1`. That makes this idiom work:

```bash
# rank posts by tag matches: a post matching 3 of your tags scores 3
ZUNIONSTORE ranked 3 tag:redis:posts tag:db:posts tag:perf:posts
ZRANGE ranked 0 9 REV WITHSCORES
```
A poor man's relevance ranking, in one command, with no extra data structures.
:::

---

## 5. The six patterns that are secretly sorted sets

### 1 — Leaderboard

```ts
const LB = 'leaderboard:global';

const submit = (user: string, score: number) =>
  redis.zadd(LB, 'GT', 'CH', score, user);          // never regress

async function topN(n = 10): Promise<{ user: string; score: number }[]> {
  const flat = await redis.zrange(LB, 0, n - 1, 'REV', 'WITHSCORES');
  const out = [];
  for (let i = 0; i < flat.length; i += 2)
    out.push({ user: flat[i], score: Number(flat[i + 1]) });
  return out;
}

async function playerCard(user: string) {
  const [rank, score, total] = await redis
    .multi()
    .zrevrank(LB, user)
    .zscore(LB, user)
    .zcard(LB)
    .exec()
    .then((r) => r!.map(([, v]) => v));

  if (rank === null) return null;
  return {
    rank: (rank as number) + 1,                     // 0-based → human 1-based
    score: Number(score),
    percentile: (1 - (rank as number) / (total as number)) * 100,
  };
}

// the neighbourhood around a player — "you and the 5 above and below"
async function around(user: string, radius = 5) {
  const rank = await redis.zrevrank(LB, user);
  if (rank === null) return [];
  return redis.zrange(LB, Math.max(0, rank - radius), rank + radius, 'REV', 'WITHSCORES');
}
```

Every one of those is O(log N) or better against 50 million players.

### 2 — Sliding-window rate limiter

The score is a timestamp; the member is a unique request id.

```lua
-- KEYS[1] = "ratelimit:user:1042"
-- ARGV[1] = now_ms, ARGV[2] = window_ms, ARGV[3] = limit, ARGV[4] = request id
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1] - ARGV[2])   -- drop old
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
```

```
   window = 60s, limit = 5, now = 12:00:30

   ZREMRANGEBYSCORE  0 → 11:59:30      drops everything older than the window
   ┌──────────────────────────────────────────────────────┐
   │ 11:59:10  11:59:45  11:59:58  12:00:12  12:00:29     │
   │   DROP      keep      keep      keep      keep       │
   └──────────────────────────────────────────────────────┘
   ZCARD → 4,  4 < 5  → allow, ZADD this request
```

This is a **true** sliding window with no boundary burst — unlike the fixed-window `INCR` version, which lets 2× the limit through at a window edge. The cost is memory: one zset member per request in the window. [Rate Limiting](./27-rate-limiting.md) compares all four algorithms.

### 3 — Delayed jobs / scheduler

Score = the Unix timestamp at which the job should run.

```ts
const schedule = (job: string, runAt: number) =>
  redis.zadd('jobs:scheduled', runAt, job);

// a poller moves due jobs into the ready queue, atomically
const DUE_LUA = `
  local due = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, ARGV[2])
  if #due == 0 then return {} end
  redis.call('ZREM', KEYS[1], unpack(due))
  redis.call('LPUSH', KEYS[2], unpack(due))
  return due
`;
redis.defineCommand('promoteDue', { numberOfKeys: 2, lua: DUE_LUA });

await redis.promoteDue('jobs:scheduled', 'jobs:ready', Date.now(), 100);
```

The Lua wrapper is what makes it safe: without it, two pollers can read the same due jobs and both enqueue them. This is exactly how BullMQ implements delayed jobs.

### 4 — Autocomplete

```ts
// index: every prefix of every term, all at score 0
async function index(term: string): Promise<void> {
  const pipe = redis.pipeline();
  for (let i = 1; i <= term.length; i++) pipe.zadd('autocomplete', 0, term.slice(0, i) + '*');
  pipe.zadd('autocomplete', 0, term);      // the complete term, unmarked
  await pipe.exec();
}

async function suggest(prefix: string, limit = 10): Promise<string[]> {
  const results = await redis.zrangebylex(
    'autocomplete', `[${prefix}`, `[${prefix}\xff`, 'LIMIT', 0, limit * 5,
  );
  return results.filter((r) => !r.endsWith('*')).slice(0, limit);
}
```

The `\xff` upper bound is the trick: it is a byte greater than any printable character, so `[ap` → `[ap\xff` captures exactly the members beginning with `ap`.

### 5 — Time-series / recent events

```bash
ZADD user:1042:events <timestamp-ms> "<event json>"
ZRANGE user:1042:events (now-3600000 +inf BYSCORE      # the last hour
ZREMRANGEBYSCORE user:1042:events 0 (now-604800000     # prune older than a week
ZCOUNT user:1042:events <from> <to>                    # events in a window
```

Fine at small scale. Beyond that, use a [Stream](./11-streams.md) — it has native capping, consumer groups, and better memory characteristics for append-only data.

### 6 — Priority queue

```bash
ZADD tasks 1 "urgent:pay-failure"
ZADD tasks 5 "normal:send-receipt"
ZADD tasks 9 "low:rebuild-thumbnails"

BZPOPMIN tasks 0        # blocks until a task exists, returns the lowest score first
```

One command gives you priority ordering *and* blocking consumption *and* exactly-one-consumer semantics.

---

## 6. `ZADD` is not a good "unique with timestamp" store

A pitfall worth naming: because members are unique, re-adding a member **updates its score rather than creating a second entry**.

```bash
ZADD events 1000 "user-logged-in"
ZADD events 2000 "user-logged-in"
ZCARD events                       # (integer) 1   ← not 2!
```

If you want to record every occurrence, the member must be unique per occurrence — hence the request-id in the rate limiter above. Forgetting this makes an event log silently lose entries.

---

## 7. Internals: the skip list

This is the deepest internals question in Redis interviews. It is worth understanding properly.

### Two encodings

```bash
127.0.0.1:6379> DEL z && ZADD z 1 a 2 b
127.0.0.1:6379> OBJECT ENCODING z
"listpack"

127.0.0.1:6379> for i in 1..200: ZADD z $i "member$i"
127.0.0.1:6379> OBJECT ENCODING z
"skiplist"
```

```conf
zset-max-listpack-entries 128     # more members than this → skiplist
zset-max-listpack-value   64      # any member longer than this (bytes) → skiplist
```

A small zset is a **listpack** of alternating `member, score` pairs, kept in score order — one flat allocation, linear scan, minimal memory. Same trade as everywhere else.

### The large encoding: dict + skiplist together

```c
typedef struct zset {
    dict *dict;         // member → score        : O(1) ZSCORE
    zskiplist *zsl;     // ordered by (score, member) : O(log N) ranges & ranks
} zset;
```

**Both structures hold every member.** That is the ~2× memory cost, and it buys O(1) score lookup *and* O(log N) ordered access. `ZADD` updates both; `ZSCORE` reads only the dict; `ZRANGE`/`ZRANK` read only the skip list.

### What a skip list is

A skip list is a **sorted linked list with extra "express lane" pointers at higher levels**. Each node is assigned a random height; higher levels are exponentially sparser, so traversal skips forward in big jumps and then refines.

```
   Searching for score 400 in a 6-element skip list:

   L4:  HEAD ──────────────────────────────────────────────────► NIL
   L3:  HEAD ────────────────────► [400 bob] ───────────────────► NIL
   L2:  HEAD ────► [250 alice] ──► [400 bob] ──────► [890 erin] ► NIL
   L1:  HEAD ────► [250 alice] ──► [400 bob] ──────► [890 erin] ► NIL
   L0:  HEAD ──► [100 dave] ──► [250 alice] ──► [400 bob] ──► [500 carol] ──► [890 erin] ──► NIL
                     ▲               ▲              ▲
                     │               │              │
   Path: start at HEAD level 4 → nothing → drop to L3 → jump straight to
         [400 bob] → found. TWO hops instead of THREE linear steps — and the
         advantage grows as log N against N.
```

Node heights come from a coin flip: level 1 with probability 1, level 2 with p=0.25, level 3 with p=0.0625, and so on (`ZSKIPLIST_P = 0.25`, max 32 levels). The expected height is 1/(1−p) ≈ 1.33 pointers per node, and search, insert, and delete are all **O(log N) expected**.

### Why a skip list and not a red-black tree?

Both are O(log N). antirez gave three reasons, and this is the answer interviewers want:

1. **Range queries are trivial.** Level 0 is a plain sorted doubly linked list. Once you find the start of a range, you walk forward — no in-order tree traversal with a stack, no parent pointers. `ZRANGEBYSCORE` is the single most common zset operation, so optimizing it matters most.
2. **The implementation is far simpler.** No rotations, no rebalancing, no colour invariants. Roughly 200 lines instead of 700, and dramatically easier to get right. antirez has said explicitly that he valued this above all.
3. **Better constant factors and cache behaviour** for the mixed read/write pattern Redis sees, and the memory/speed trade is tunable by changing `p`.

The cost is that the bounds are *probabilistic* rather than worst-case guaranteed. In practice, with 32 levels, the probability of degenerate behaviour is negligible.

### How `ZRANK` is O(log N)

A plain skip list can find a member in O(log N) but cannot say *how many* elements precede it without counting. Redis adds a **span** to every forward pointer — the number of level-0 nodes it jumps over:

```
   L2:  HEAD ──span 2──► [250 alice] ──span 1──► [400 bob] ──span 2──► [890 erin]
   L0:  HEAD ─1─► [100 dave] ─1─► [250 alice] ─1─► [400 bob] ─1─► [500 carol] ─1─► [890 erin]

   ZRANK "bob":  walk the search path and SUM the spans you traverse.
                 HEAD --2--> alice   (running total 2)
                 alice --1--> bob    (running total 3)
                 rank = 3 - 1 = 2  ✅
```

Summing spans along a path you were already walking costs nothing extra — so **rank comes free with the search**. That is the mechanism behind "what rank is this player out of 50 million" in 25 hops.

### Complexity table

| Operation | Complexity | Which structure |
| :--- | :--- | :--- |
| `ZADD` | O(log N) | both (dict O(1) + skiplist O(log N)) |
| `ZSCORE` | **O(1)** | dict only |
| `ZCARD` | **O(1)** | a stored counter |
| `ZRANK` / `ZREVRANK` | O(log N) | skiplist span sums |
| `ZRANGE` by rank | O(log N + M) | seek, then walk M |
| `ZRANGEBYSCORE` | O(log N + M) | seek, then walk M |
| `ZCOUNT` | O(log N) | two rank lookups, subtracted |
| `ZREM` | O(log N) | both |
| `ZINCRBY` | O(log N) | remove + reinsert at the new position |
| `ZPOPMIN` / `ZPOPMAX` | O(log N) | head/tail of the skiplist |
| `ZUNIONSTORE` | O(N log N) | N = total input elements |
| `ZREMRANGEBY*` | O(log N + M) | M = number removed |

**The one to remember: `ZRANGE key 0 -1` is O(N).** Same rule as always — never fetch a whole large collection.

---

## 8. Complete command table

| Command | Returns |
| :--- | :--- |
| `ZADD k [NX\|XX] [GT\|LT] [CH] [INCR] s m…` | count added (or changed with `CH`; new score with `INCR`) |
| `ZINCRBY k n m` | new score |
| `ZREM k m…` | count removed |
| `ZSCORE k m` / `ZMSCORE k m…` | score(s) as strings, `nil` if absent |
| `ZCARD k` | member count |
| `ZCOUNT k min max` | count in a score range |
| `ZLEXCOUNT k min max` | count in a lex range |
| `ZRANK` / `ZREVRANK k m [WITHSCORE]` | 0-based rank, `nil` if absent |
| `ZRANGE k s e [BYSCORE\|BYLEX] [REV] [LIMIT o c] [WITHSCORES]` | members |
| `ZRANGESTORE dst src …` | store a range in another key (6.2+) |
| `ZRANDMEMBER k [count] [WITHSCORES]` | random member(s) |
| `ZPOPMIN` / `ZPOPMAX k [count]` | `[member, score]` pairs |
| `BZPOPMIN` / `BZPOPMAX k… timeout` | `[key, member, score]` / `nil` |
| `ZMPOP` / `BZMPOP numkeys k… MIN\|MAX` | `[key, entries]` (7.0+) |
| `ZREMRANGEBYRANK\|SCORE\|LEX k min max` | count removed |
| `ZUNION\|ZINTER\|ZDIFF numkeys k… [WEIGHTS][AGGREGATE][WITHSCORES]` | members (6.2+) |
| `ZUNIONSTORE\|ZINTERSTORE\|ZDIFFSTORE dst numkeys k…` | size of result |
| `ZINTERCARD numkeys k… [LIMIT n]` | intersection size (7.0+) |
| `ZSCAN k cur [MATCH][COUNT]` | `[cursor, member/score pairs]` |

---

## Rapid-fire recall

1. What two data structures make up a large sorted set, and what does each give you?
2. How are score ties broken, and why does that property matter for pagination?
3. Why is `ZADD key GT score member` better than read-compare-write?
4. What is the largest integer a score holds exactly, and which real-world value breaks it?
5. What does `BYLEX` require, and what does `\xff` do in an autocomplete bound?
6. Give the three reasons Redis uses a skip list instead of a balanced tree.
7. How does `ZRANK` achieve O(log N) when a plain skip list cannot count?
8. `ZADD events 1000 "login"` then `ZADD events 2000 "login"` — what is `ZCARD`?
9. Two ways to stop a sorted set growing forever.

<details>
<summary>Answers</summary>

1. A `dict` (member → score) giving O(1) `ZSCORE`, and a skip list ordered by (score, member) giving O(log N) ranks and ranges. Both hold every member, hence ~2× memory.
2. Lexicographically by member name. It makes the ordering fully deterministic, so paging through `ZRANGE` slices never skips or repeats an element.
3. It is a single atomic command — no window between the read and the write for a concurrent client to interleave, so a lower score can never overwrite a higher one.
4. 2⁵³ ≈ 9.007 × 10¹⁵. Millisecond timestamps are fine; **nanosecond timestamps and Snowflake IDs are not** and get silently rounded.
5. Every member must have the **same score**, or the lex ordering is meaningless. `\xff` is a byte greater than any printable character, so `[ap` → `[ap\xff` bounds exactly the members starting with `ap`.
6. Range queries fall out naturally from the level-0 sorted linked list; the implementation is far simpler (no rotations or rebalancing); and it has good constant factors with a tunable memory/speed trade.
7. Every forward pointer stores a **span** — how many level-0 nodes it skips. Summing the spans along the search path you are already walking yields the rank for free.
8. `1`. Members are unique, so the second `ZADD` updates the score rather than adding an entry. Make members unique per occurrence if you need every event.
9. `ZREMRANGEBYRANK` (keep the top N) or `ZREMRANGEBYSCORE` (drop everything outside a time window) — or a TTL on the whole key.

</details>

---

**Next:** [Bitmaps, HyperLogLog & Geospatial](./10-bitmaps-hyperloglog-geo.md) — three specialist types that solve problems nothing else can.
