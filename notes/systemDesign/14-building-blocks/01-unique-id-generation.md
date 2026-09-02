---
title: Unique ID Generation
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Unique ID Generation

> **What you will be able to do after this page**
>
> - Explain why database auto-increment fails once you shard, in mechanism rather than slogan.
> - Lay out a Snowflake ID bit by bit and compute its capacity from the layout.
> - Say why random UUIDv4 primary keys damage database performance, and what UUIDv7 changed.
> - Choose an ID scheme from requirements, and know what each one costs.

Nearly every design needs identifiers for things that do not exist yet, generated on many machines at once, without those machines talking to each other. It is the smallest genuinely distributed problem, which makes it the best first [building block](/systemDesign/building-blocks).

<Plain>

A cloakroom gives out numbered tickets: 1, 2, 3. One attendant, one pad, no confusion.

Now open a second desk. If both attendants start at 1, two coats have ticket 1 and someone goes home in the wrong jacket. The obvious fixes each have a snag: give one desk odd numbers and the other even — then you cannot add a third desk without re-planning everything. Have both phone a central pad before each ticket — now every coat waits for a phone call.

There is a third option. Give each ticket enough information to be unique **without anyone consulting anyone**: the time, plus which desk issued it, plus a counter. `1432-DESK2-007`. Two desks can never collide, because the desk number differs, and one desk cannot collide with itself, because the time or the counter differs.

That is the whole idea behind the ID schemes on this page. <C color="orange">The interesting part is what each design gives up</C> — some tickets are longer, some reveal what time you arrived, some let a curious person guess the ticket next to yours.

</Plain>

---

## 1. What you actually want

Five properties, and **you cannot have all of them**:

| Property | Why you want it |
| :--- | :--- |
| **Unique** | Non-negotiable. A collision is data corruption. |
| **Sortable by time** | Free ordering, cheap range scans, "recent items" without a secondary index |
| **Small** | Every foreign key, index entry and API response carries it |
| **Non-guessable** | `/orders/1002` invites someone to try `/orders/1001` |
| **No coordination** | No network call on the write path; nodes generate independently |

Sortable and non-guessable are in direct tension: a time-sortable ID leaks creation time and adjacency by construction. Small and uncoordinated are in tension too — the fewer bits you have, the more you need agreement about who may use which.

---

## 2. The options

### Database auto-increment

```sql
id BIGSERIAL PRIMARY KEY     -- 1, 2, 3, ...
```

Perfect on a single database: small, sortable, unique, zero effort.

<H>**It fails at exactly one moment: the second database.**</H> Two primaries both hand out `1`. The classic patch is *stepped ranges* — node A issues 1, 3, 5…; node B issues 2, 4, 6… — which works until you add node C and have to re-plan every node's step. It is also a coordination point on the write path, and it leaks volume: a competitor ordering twice a month knows exactly how many orders you took in between.

**Use when:** one database, internal system, no plan to shard. It is genuinely the right answer more often than the internet suggests.

### UUIDv4 (random)

122 random bits. Collision probability is negligible; you can generate one on a phone with no network.

The problem is not uniqueness — it is what randomness does to a <C color="orange">**B-tree index**</C>.

```
  SEQUENTIAL KEYS                        RANDOM KEYS (UUIDv4)

  inserts land at the right edge         inserts land anywhere in the tree
  ┌───┬───┬───┬───┬───┬─▓─┐              ┌─▓─┬───┬─▓─┬───┬─▓─┬───┐
                     ▲                     ▲       ▲       ▲
  one hot page, always in RAM            every insert touches a cold page

  → 1 page read, high fill factor        → 1 random disk read per insert,
  → sequential writes                      page splits, fragmentation,
                                           and the whole index must stay
                                           cached or throughput collapses
```

At scale this is a large constant factor on write throughput, and it gets worse as the index outgrows RAM. Add the size: 16 bytes versus 8, repeated across every index and every foreign key — on a billion-row table with four indexes that is gigabytes of pure overhead. And you get no ordering, so "recent items" needs a separate indexed timestamp column.

**Use when:** IDs must be generated client-side or offline, and the table is not write-hot.

### UUIDv7 (time-ordered)

The fix, standardised in 2024. Same 128-bit UUID shape, but the leading 48 bits are a Unix millisecond timestamp, with the rest random.

```
  UUIDv7:  │ 48-bit ms timestamp │ ver │ 12-bit rand │ var │ 62-bit random │
           └─────────┬───────────┘                          └──────┬──────┘
             sorts chronologically                      uniqueness within the ms
```

Sequential inserts, so B-tree locality is restored, while keeping uncoordinated generation. Still 16 bytes, and still leaks creation time.

**Use when:** you want UUID ergonomics without the index penalty. For most new systems this is the sensible default.

### Snowflake (Twitter)

The one worth understanding in detail, because it makes the trade-offs explicit in its bit layout. **64 bits**, so it fits a `BIGINT`.

```
 1        41 bits              10 bits        12 bits
┌─┬────────────────────────┬────────────┬──────────────┐
│0│   timestamp (ms since  │  machine   │   sequence   │
│ │     custom epoch)      │     id     │   counter    │
└─┴────────────────────────┴────────────┴──────────────┘
 ▲            ▲                   ▲             ▲
 │            │                   │             └─ 4096 IDs per ms per machine
 │            │                   └─ 1024 machines
 │            └─ 2⁴¹ ms ≈ 69 years from your chosen epoch
 └─ sign bit, always 0 so the value stays positive in signed types
```

<Jargon
  plain="Machines producing values that are guaranteed not to clash, without asking each other first."
  term="coordination-free generation"
  also={['no central coordinator', 'decentralised ID generation']}>

The phrase to reach for is <C color="green">*"this needs no coordination on the write path"*</C> — meaning no network call, no lock, no central sequence before an ID exists. It is the property that makes an ID scheme scale, and the one auto-increment lacks.

</Jargon>

Read the capacity straight off the layout:

```
  4,096 IDs/ms × 1,000 ms = 4.096M IDs per second per machine
  × 1,024 machines         = ~4.2 billion IDs per second, cluster-wide
  lifetime                 = 69 years from the custom epoch
```

Generation is a few instructions and no network call:

```ts
function nextId(): bigint {
  let now = Date.now();

  if (now < lastTimestamp) {
    // Clock moved backwards — NTP correction or a VM pause.
    // Never emit an ID from the past: it risks duplicating one already issued.
    throw new Error("clock moved backwards; refusing to generate");
  }

  if (now === lastTimestamp) {
    sequence = (sequence + 1) & 0xfff;          // 12 bits
    if (sequence === 0) {
      // 4096 exhausted in this millisecond — spin until the next one.
      while (Date.now() <= lastTimestamp) { /* busy-wait */ }
      now = Date.now();
    }
  } else {
    sequence = 0;
  }

  lastTimestamp = now;

  return (BigInt(now - EPOCH) << 22n)
       | (BigInt(machineId) << 12n)
       | BigInt(sequence);
}
```

Build one ID, field by field:

<Trace title="Constructing a single Snowflake ID" subtitle="Machine 5, two IDs generated in the same millisecond.">

<TraceStep
  title="Take the current time"
  state={{ 'Timestamp bits': '1735689600123', 'Machine bits': '—', 'Sequence bits': '—', 'ID so far': '—' }}
  changed={['Timestamp bits']}
  note="Measured from a custom epoch, not 1970 — which is how 41 bits buys 69 years instead of running out in 1970+69.">

Milliseconds since your chosen epoch. This occupies **41 bits** and makes the ID sortable by time.

</TraceStep>

<TraceStep
  title="Add this machine's id"
  state={{ 'Timestamp bits': '1735689600123', 'Machine bits': '5', 'Sequence bits': '—', 'ID so far': '—' }}
  changed={['Machine bits']}
  note="This is the field that requires operational care — see below. Two machines sharing it is the failure people actually hit.">

**10 bits** — up to 1,024 machines. This is what guarantees two machines never collide, without them ever communicating.

</TraceStep>

<TraceStep
  title="Add a per-millisecond counter"
  state={{ 'Timestamp bits': '1735689600123', 'Machine bits': '5', 'Sequence bits': '0', 'ID so far': '7281...20480' }}
  changed={['Sequence bits', 'ID so far']}
  note="Shift and OR: (ts << 22) | (machine << 12) | sequence.">

**12 bits**, starting at 0. This is what stops one machine colliding with *itself* inside a single millisecond.

</TraceStep>

<TraceStep
  title="A second ID in the same millisecond"
  state={{ 'Timestamp bits': '1735689600123', 'Machine bits': '5', 'Sequence bits': '1', 'ID so far': '7281...20481' }}
  changed={['Sequence bits', 'ID so far']}
  note="4,096 available per millisecond per machine — about 4M IDs/sec/machine.">

Same millisecond, same machine, so only the counter advances.

</TraceStep>

<TraceStep
  title="The clock jumps backwards"
  cost="refuse to generate"
  state={{ 'Timestamp bits': '1735689600120 (!)', 'Machine bits': '5', 'Sequence bits': 'n/a', 'ID so far': 'ERROR' }}
  changed={['Timestamp bits', 'ID so far']}
  note="An NTP correction or a VM resuming from a snapshot. Rare, and catastrophic if ignored.">

The timestamp is now **earlier than one already used**. Continuing would re-issue an ID that already exists.

<H>The generator throws instead. It trades a silent duplicate — data corruption you may never detect — for a loud, brief outage. That is the right trade, and it is why the check exists.</H>

</TraceStep>

</Trace>

**The two things that actually go wrong in production:**

**Clock skew.** The scheme assumes a monotonic clock. An NTP step backwards, or a VM resuming from a snapshot, can produce a timestamp already used — and therefore a duplicate ID. The code above refuses rather than risking it, which converts a <C color="crimson">silent corruption</C> into a <C color="green">loud, brief unavailability</C>. That is the right trade, and it is why the check exists.

**Machine ID assignment.** 1,024 slots that must be unique across the fleet, forever. Hardcoding them does not survive autoscaling. In practice a coordination service (ZooKeeper, etcd, Consul) leases them, or you derive them from a stable identity like a StatefulSet ordinal. <C color="crimson">Two machines sharing an ID silently emit duplicates</C> — which is the failure people actually hit.

**Use when:** you need 64-bit, time-sortable, high-throughput IDs and can operate machine-ID assignment. Discord, Instagram (a Postgres-stored-procedure variant) and Twitter all run versions of this.

### Ticket server / range allocation

One central service hands out **blocks** of IDs — "you may use 1,000,000–1,000,999" — and each node then issues from its block locally.

Coordination cost is amortised to one call per thousand IDs instead of one per ID. IDs stay small and roughly sortable. Cost: the ticket server is a dependency (make it two, with disjoint ranges), and a node crash burns its unused block, leaving gaps. Flickr famously ran this on MySQL with `REPLACE INTO` and two servers on odd/even offsets.

**Use when:** you want small sequential IDs across many nodes and can tolerate a lightweight central service.

---

## 3. Choosing

| Requirement | Choice |
| :--- | :--- |
| Single database, internal tool | <C color="green">**Auto-increment.**</C> Do not overthink it. |
| Client generates IDs offline | **UUIDv4** — no other option works without a network |
| General-purpose, want ordering + no coordination | <C color="green">**UUIDv7**</C> — the modern default |
| 64-bit required, very high write rate | **Snowflake** |
| Small sequential IDs, many writers | **Ticket server** |
| Must not be guessable or enumerable | <C color="crimson">**Never expose the internal ID**</C> — see below |

<Depth title="Why 128 random bits practically never collide — the birthday bound">

UUIDv4 has 122 random bits, so 2¹²² ≈ 5.3 × 10³⁶ possible values. The intuition people reach for — "that's a big number, so collisions are unlikely" — is right but for the wrong reason, and the correct reasoning is worth knowing because it applies to hashes, shard keys and cache keys too.

The relevant question is not *"will a specific value repeat?"* but *"will **any two** of my n values match?"* — the **birthday problem**. With N possible values, the probability of at least one collision among n draws is approximately:

```
  p ≈ 1 − e^(−n² / 2N)      and for small p:      p ≈ n² / 2N
```

The `n²` is the key term: collision probability grows with the **square** of how many you generate, which is far faster than intuition suggests. The rule of thumb is that you expect a collision around **n ≈ √N** — the "birthday bound".

For UUIDv4, √N ≈ 2⁶¹ ≈ 2.3 × 10¹⁸. Concretely:

| IDs generated | Collision probability |
| ---: | :--- |
| 1 billion (10⁹) | ~10⁻¹⁹ — negligible |
| 1 trillion (10¹²) | ~10⁻¹³ |
| 10¹⁵ | ~10⁻⁷ |
| 2.3 × 10¹⁸ | ~50% |

At a billion IDs per second you would need **~85 years** to reach a 50% chance. So the answer is genuinely "never" for any real system — but note it is *not* because 2¹²² is large; it is because √(2¹²²) is still large.

**Where the same maths bites you badly:**

- **Short IDs.** A 32-bit random ID has √(2³²) ≈ 65,536 — you expect a collision after only ~65K values. This is why an 8-character random URL-shortener code needs collision handling, and a UUID does not.
- **Truncating hashes.** Taking the first 8 hex characters of a SHA-256 leaves 32 bits, and the birthday bound applies to the truncation, not the original. Git's short hashes collide in large repositories for exactly this reason.
- **Random shard assignment.** Placing n items into N shards randomly, you get *balance* problems from the same distribution long before you get collisions — the fullest shard holds roughly `n/N + √(n log N / N)` items, which is why consistent hashing uses virtual nodes.

<C color="orange">The general lesson: whenever you shorten an identifier, the safety margin shrinks with the square root, not linearly.</C> Halving the bits does not halve your safety — it square-roots it.

</Depth>

### Sortability and secrecy are different problems

If IDs appear in URLs, a time-sortable ID tells anyone the creation time and, worse, lets them enumerate neighbours by nudging the sequence bits.

Do not solve this by making the primary key random — that costs you index locality for a property you can get elsewhere. Instead:

- Keep the sortable ID internally, and expose a separate opaque **public ID** (random, indexed).
- Or encrypt the internal ID for display with a format-preserving cipher — reversible, so no second lookup.
- And regardless: **authorise every request.** <H>An unguessable ID is not access control.</H> It is a speed bump, and the underlying bug is the missing permission check.

---

## 4. Where this shows up

- **URL shorteners** — the short code *is* the ID; base62 of a Snowflake is a common answer.
- **Message ordering** — Discord uses Snowflake IDs as message cursors, so pagination and ordering come free from the primary key.
- **Sharding keys** — extracting the timestamp from an ID lets you route to a time-partitioned shard without a lookup.
- **Idempotency keys** — client-generated UUIDv4 sent with a request so a retry is recognised as a duplicate.
- **Distributed tracing** — trace IDs are 128-bit random values, generated at the edge, no coordination.

---

## Rapid-fire recall

1. Name the five desirable properties and one pair that are in direct tension.
2. Precisely when does auto-increment stop working, and what does it leak?
3. Why do random UUIDv4 primary keys hurt write throughput? Name the mechanism.
4. What did UUIDv7 change, and what did it keep?
5. Give the Snowflake bit layout and the capacity of each field.
6. Why does a Snowflake generator refuse to emit an ID when the clock moves backwards?
7. What is the practical difficulty with machine IDs, and what goes wrong if it is mishandled?
8. How does a ticket server amortise coordination cost, and what does a node crash cost you?
9. You need sortable IDs internally but must not let users enumerate records. What do you do?
10. Why is an unguessable ID not access control?

<details>
<summary>Answers</summary>

1. Unique · time-sortable · small · non-guessable · no coordination. **Sortable and non-guessable** conflict directly — a time-ordered ID leaks creation time and adjacency. (Small vs uncoordinated is a second tension.)
2. At the **second database/primary** — both hand out the same values. It leaks **volume**: two IDs observed at different times reveal how many records were created in between.
3. Random keys scatter inserts across the whole **B-tree**, so each insert touches a cold page: a random read, page splits, fragmentation, and a poor fill factor. Sequential keys hit one hot right-edge page that stays in RAM.
4. It made the leading 48 bits a **millisecond timestamp**, restoring index locality and time-ordering, while keeping 128-bit uncoordinated generation. It kept the 16-byte size and still leaks creation time.
5. 1 sign bit (always 0) · **41 bits** timestamp (~69 years) · **10 bits** machine id (1,024 machines) · **12 bits** sequence (4,096 IDs per ms per machine) → ~4.2 billion IDs/sec cluster-wide.
6. Because a repeated timestamp can reproduce an ID already issued — a silent duplicate. Refusing converts silent data corruption into brief, loud unavailability, which is the better failure.
7. The 1,024 slots must be **unique across the fleet and survive autoscaling**. Hardcoding breaks; in practice they are leased from ZooKeeper/etcd/Consul or derived from a stable ordinal. Two machines sharing a slot emit duplicate IDs silently.
8. It hands out **blocks** (e.g. 1,000 IDs at a time), so coordination happens once per block instead of once per ID. A crash **burns the unused remainder of the block**, leaving gaps in the sequence.
9. Keep the sortable ID internally and expose a separate **opaque public ID** (random, indexed), or display a format-preserving encryption of the internal ID. Do not make the primary key random.
10. Because it is only obscurity — IDs leak through logs, referrers, shared links and screenshots. The real control is an **authorisation check on every request**; a missing check is the actual bug.

</details>

---

**Next:** more building blocks — rate limiter algorithms, Bloom filters, the consistent-hash ring, geohashing. *(Coming soon.)*
