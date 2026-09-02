---
title: Time and Ordering
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Time and Ordering

> **What you will be able to do after this page**
>
> - Say why wall-clock timestamps cannot order events across machines.
> - Use Lamport clocks and vector clocks, and say what each can and cannot detect.
> - Explain why last-write-wins silently loses data.
> - Recognise the bugs that come from trusting a clock.

Every distributed system eventually needs to know what happened first. <C color="crimson">The obvious answer — compare timestamps — is wrong, and it fails silently.</C>

<Plain>

Two people in different cities each write a note and stamp it with the time from their own watch.

Later you try to work out which was written first. You compare the stamps — and you cannot trust the answer, because the watches were never perfectly synchronised. One may be four seconds fast. A note genuinely written second can carry an earlier time.

You cannot fix this by buying better watches. Any two clocks drift, and even correcting them from a shared source leaves uncertainty, because the correction itself takes time to arrive.

So how do you order things at all?

<C color="green">You use what actually connects the events instead.</C> If one person **read the other's note before writing theirs**, the order is certain — not because of any clock, but because information flowed. Cause before effect, regardless of what the watches say.

And for two notes written independently, with neither writer aware of the other? <C color="orange">There is genuinely no fact about which came first.</C> They were concurrent. Forcing an order on them is inventing information you do not have — and inventing it by comparing untrustworthy watches is how one note quietly disappears.

</Plain>

---

## 1. Why clocks lie

<Jargon
  plain="The clock showing the actual date and time, which can jump backwards or forwards."
  term="wall-clock time (time-of-day clock)"
  also={['NTP-synced clock', 'CLOCK_REALTIME']}>

Distinct from a **monotonic clock**, which only ever counts forwards and is meaningless as an absolute time. <C color="green">Use monotonic for measuring durations; use wall-clock for displaying dates</C> — and use neither for ordering events across machines.

</Jargon>

| Problem | Effect |
| :--- | :--- |
| **Drift** | Quartz clocks drift ~10–100 ppm — seconds per day untreated |
| **NTP steps backwards** | A correction can move the clock **backwards**; a duration measured across it can be negative |
| **NTP accuracy is limited** | Typically 1–50 ms over the internet; worse on congested networks |
| **VM pauses** | A migrated or snapshotted VM can resume with a clock far off |
| **Leap seconds** | Historically caused repeated or stalled seconds and real production outages |

<H>Two events one millisecond apart on different machines cannot be reliably ordered by their timestamps. The clock error is larger than the interval you are trying to measure.</H>

---

## 2. Last-write-wins, and what it costs

The most common ordering strategy, and it is a data-loss mechanism.

<Trace title="Two users edit the same field" subtitle="Last-write-wins with node clocks 3 seconds apart.">

<TraceStep
  title="Both read the same value"
  state={{ 'Stored value': "'draft'", 'Alice writes': '—', 'Bob writes': '—', 'Data lost': 'no' }}
  note="Two users, two nodes, one field. Nothing unusual so far.">

Alice hits node A; Bob hits node B. Both read `status = 'draft'`.

</TraceStep>

<TraceStep
  title="Alice writes first, in real time"
  state={{ 'Stored value': "'review'", 'Alice writes': "'review' @ 10:00:05 (node A clock)", 'Bob writes': '—', 'Data lost': 'no' }}
  changed={['Stored value', 'Alice writes']}
  note="Node A's clock happens to be 3 seconds behind true time.">

At true time 10:00:08, Alice sets `status = 'review'`. Node A stamps it **10:00:05**.

</TraceStep>

<TraceStep
  title="Bob writes second, in real time"
  cost="stamped earlier? no — later"
  state={{ 'Stored value': "'published'", 'Alice writes': "'review' @ 10:00:05", 'Bob writes': "'published' @ 10:00:10", 'Data lost': 'no' }}
  changed={['Stored value', 'Bob writes']}
  note="Here the clocks happen to agree with reality — this time.">

At true time 10:00:10, Bob sets `status = 'published'`. Node B stamps it **10:00:10**. Later timestamp wins; Bob's value is kept. Correct.

</TraceStep>

<TraceStep
  title="Now reverse the clock skew"
  cost="silent data loss"
  state={{ 'Stored value': "'review' (WRONG)", 'Alice writes': "'review' @ 10:00:12", 'Bob writes': "'published' @ 10:00:10", 'Data lost': 'YES — Bob' }}
  changed={['Stored value', 'Alice writes', 'Data lost']}
  note="Same sequence of real events, different clock skew, opposite outcome — and no error anywhere.">

Suppose node A's clock is instead 4 seconds **ahead**. Alice's earlier write carries **10:00:12**, later than Bob's **10:00:10**.

<C color="crimson">Bob's write is discarded even though it happened afterwards.</C> No error, no warning — Bob saw a success response and his change is simply gone.

</TraceStep>

<TraceStep
  title="What detection would have looked like"
  state={{ 'Stored value': 'CONFLICT: both versions kept', 'Alice writes': 'version [A:1]', 'Bob writes': 'version [B:1]', 'Data lost': 'no' }}
  changed={['Stored value', 'Alice writes', 'Bob writes', 'Data lost']}
  note="Version vectors detect concurrency without needing any clock at all.">

With **version vectors**, the two writes are recognised as **concurrent** — neither descends from the other.

<H>The system can then keep both and let the application or user resolve it. LWW does not resolve conflicts; it hides them by discarding one side.</H>

</TraceStep>

</Trace>

<C color="orange">LWW is acceptable when losing a concurrent write is genuinely harmless</C> — a cache entry, a last-seen timestamp, a presence indicator. <C color="crimson">It is not acceptable for anything a user typed.</C>

---

## 3. Logical clocks

Order events by **causality** rather than by time.

### Lamport clocks

One counter per node. Rules:

```
  On any local event:      counter += 1
  On sending a message:    counter += 1, send counter with the message
  On receiving:            counter = max(local, received) + 1
```

<C color="green">Guarantee: if A causally precedes B, then `L(A) < L(B)`.</C>
<C color="crimson">The converse fails: `L(A) < L(B)` does **not** mean A caused B</C> — they may be concurrent.

So a Lamport clock gives a **total order** (ties broken by node id) that never contradicts causality, but cannot tell you whether two events were actually related. Fine for a consistent ordering; useless for detecting conflicts.

### Vector clocks

One counter **per node**, carried as a vector.

```
  A: [2,0,0] ──► B: [2,1,0]      B knows about A's 2 events
  C: [0,0,1]                     C knows nothing of either

  Compare [2,1,0] and [0,0,1]:
    2 > 0 but 0 < 1  →  neither dominates  →  CONCURRENT
```

<C color="green">Vector clocks detect concurrency exactly.</C> `V(A) < V(B)` in every position means A happened before B; if neither dominates, they are genuinely concurrent and there is a real conflict to resolve.

The cost: <C color="crimson">the vector grows with the number of writers</C>. For a client-per-writer system that is unbounded, which is why **version vectors** (one entry per *replica*, not per client) are used in practice.

| | Lamport | Vector |
| :--- | :--- | :--- |
| Size | One integer | One integer per node |
| Gives a total order | <C color="green">Yes</C> | No (partial order) |
| Detects concurrency | <C color="crimson">No</C> | <C color="green">Yes</C> |
| Use for | Consistent ordering | Conflict detection |

<Depth title="Hybrid logical clocks, and how Spanner buys real-time ordering">

Logical clocks order events correctly but carry no relation to real time — you cannot ask "what did this look like at 10:00?" or expire something after 24 hours. Wall clocks relate to real time but cannot order reliably. Two production approaches bridge the gap.

**Hybrid Logical Clocks (HLC).** A timestamp pairs a wall-clock component with a logical counter:

```
  on local event:   l = max(l, physical_now)
                    if l unchanged then c += 1 else c = 0

  on receive(l', c'):  l = max(l, l', physical_now)
                       c = (appropriate increment based on which max won)
```

The result is a timestamp that <C color="green">stays within a small bound of physical time **and** never violates causality</C>. It is one 64-bit value, sorts naturally, and can be compared like a timestamp. CockroachDB, YugabyteDB and MongoDB all use HLCs.

What it does **not** give you: certainty that two *concurrent* transactions on different nodes are correctly ordered relative to real time. HLC bounds the error; it does not eliminate it. CockroachDB handles the residual with an **uncertainty interval** — a read that encounters a value written within the uncertainty window restarts, so it can be sure it saw everything it should have.

**Spanner's TrueTime.** Google attacked the problem at the hardware layer. GPS receivers and atomic clocks in every datacenter keep clock error small **and, crucially, bounded and known**. `TT.now()` returns an interval `[earliest, latest]` rather than a point, typically a few milliseconds wide.

To commit, Spanner picks a timestamp and then **waits until the interval has passed** before making the transaction visible — the "commit wait". That wait guarantees any transaction starting later gets a strictly greater timestamp, delivering **external consistency**: if T1 commits before T2 starts in real time, T1's timestamp is smaller. It is the strongest guarantee available in a distributed database.

The price is direct and visible: <C color="orange">every commit waits out the clock uncertainty — a few milliseconds added to every write transaction.</C> Google's engineering effort went into making the uncertainty *small*, because it is paid on every commit.

**The general principle worth taking away:**

<H>You cannot make clocks perfect, so you either stop depending on them (logical clocks) or you make their error explicitly bounded and wait it out (TrueTime). What you must never do is assume the error is zero — which is exactly what comparing two timestamps does.</H>

</Depth>

---

## 4. Practical rules

**Never order events across machines by wall-clock timestamp.** Use sequence numbers from a single source, logical clocks, or a consensus-ordered log.

**Use monotonic clocks for durations.** `System.nanoTime()`, `CLOCK_MONOTONIC`, `performance.now()`. <C color="crimson">A duration measured with wall-clock time can be negative</C> after an NTP correction, and code that assumes otherwise will divide by it.

**Treat client timestamps as untrusted input.** A mobile device's clock can be wrong by hours, or deliberately set. Stamp on the server; keep the client's value as metadata if you need it.

**Give TTLs a margin.** A cache entry expiring "in 60 seconds" can expire in 55 or 65 across nodes. Never let correctness depend on precise expiry — see the [unsafe lock](./03-consensus-and-quorums.md).

**Monitor clock skew.** It is a standard node health metric and it predicts a class of bug that is otherwise very hard to diagnose.

**Prefer causality tokens over timestamps in APIs.** Returning an opaque version or position token, which the client passes back, is more robust than exposing a timestamp clients will compare.

---

## 5. In a design discussion

- **"We can't order these by timestamp — clock skew between nodes exceeds the interval. I'd use a sequence from a single source, or version vectors."** Identifies the flaw and offers alternatives.
- **"LWW here would silently discard a user's edit. For the document body I want conflict detection; for `last_seen_at`, LWW is fine."** Applies it per field.
- **"Vector clocks detect concurrency, Lamport clocks only give an order — we need detection to resolve conflicts."** The distinction that matters.
- **"Spanner buys real-time ordering by waiting out clock uncertainty on every commit. That's a real latency cost, not free."** Shows you know what the guarantee costs.

---

## Rapid-fire recall

1. Name four reasons wall-clock time is unreliable for ordering.
2. Distinguish wall-clock from monotonic clocks and say what each is for.
3. Show how last-write-wins loses data with two clocks a few seconds apart.
4. When is LWW acceptable, and when is it not?
5. Give the three Lamport clock rules.
6. What does a Lamport clock guarantee, and what can it not tell you?
7. How does a vector clock detect concurrency? Compare `[2,1,0]` and `[0,0,1]`.
8. What is the cost of vector clocks, and what practical variant reduces it?
9. What does an HLC combine, and what does it still not guarantee?
10. How does TrueTime achieve external consistency, and what does it cost per commit?

<details>
<summary>Answers</summary>

1. **Drift** (10–100 ppm) · **NTP steps backwards** · **limited NTP accuracy** (1–50 ms) · **VM pauses/migrations** resuming with a wrong clock · **leap seconds**.
2. **Wall-clock** shows date and time and can jump forwards or backwards — use it for display. **Monotonic** only counts forwards and has no absolute meaning — use it for measuring durations.
3. Alice writes before Bob in real time, but Alice's node clock is ahead, so her write carries the later timestamp. LWW keeps hers and **silently discards Bob's**, with no error and a success response already sent to Bob.
4. Acceptable when losing a concurrent write is harmless — cache entries, `last_seen_at`, presence. **Not acceptable for anything a user typed**, since it destroys their work without any signal.
5. Local event: `counter += 1`. Send: `counter += 1` and include it. Receive: `counter = max(local, received) + 1`.
6. Guarantee: if A causally precedes B then `L(A) < L(B)`. It **cannot** tell you the converse — `L(A) < L(B)` does not mean A caused B, so it cannot detect concurrency.
7. Compare element-wise. `[2,1,0]` vs `[0,0,1]`: the first is greater in position 1 but smaller in position 3, so **neither dominates** — the events are **concurrent**, a genuine conflict.
8. The vector **grows with the number of writers**, which is unbounded if clients are writers. **Version vectors** — one entry per *replica* rather than per client — bound the size.
9. A **wall-clock component and a logical counter**, so timestamps stay close to physical time while never violating causality. It still does not guarantee correct real-time ordering of genuinely concurrent transactions — it bounds the error rather than removing it.
10. `TT.now()` returns a bounded **interval** rather than a point, using GPS and atomic clocks. Spanner picks a commit timestamp and **waits out the interval** before making it visible, so any later transaction gets a strictly greater timestamp. Cost: **a few milliseconds added to every commit**.

</details>

---

**Next:** [Idempotency and Delivery Semantics](./05-idempotency-and-delivery.md) — why "exactly once" is mostly a marketing claim.
