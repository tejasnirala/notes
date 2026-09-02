---
title: Idempotency and Delivery Semantics
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Idempotency and Delivery Semantics

> **What you will be able to do after this page**
>
> - Explain why "exactly once" delivery is impossible, and what vendors mean when they claim it.
> - Design an idempotency key that survives concurrency, not just sequential retries.
> - Choose between at-most-once and at-least-once from the cost of each failure.
> - Make a non-idempotent operation safe to repeat.

<C color="orange">Networks lose messages, so senders retry, so receivers get duplicates.</C> That sentence is the whole problem, and idempotency is the only real solution.

<Plain>

You post a letter asking someone to send you £100. No reply arrives.

You cannot tell which happened:

- The letter never arrived.
- It arrived, they sent the money, and **their reply** got lost.

From where you sit these look identical. And your options are uncomfortable:

**Ask again.** If the first letter did arrive, you may get £200.

**Don't ask again.** If it never arrived, you get nothing.

There is no third option, and <C color="crimson">no amount of care in writing the letter creates one</C>. Confirming receipt just moves the problem — the confirmation can be lost too, forever.

So the fix has to come from somewhere else entirely: **make asking twice harmless**.

Number your requests. *"Request #47: send me £100."* Now if they receive #47 twice, they check their records, see they have already handled #47, and simply resend the confirmation without sending more money.

<C color="green">You can now retry as often as you like.</C> The uncertainty never went away — you still cannot tell whether your letter arrived — but it stopped mattering, and that is the best available outcome.

</Plain>

---

## 1. The three delivery semantics

| Semantic | Behaviour | You lose |
| :--- | :--- | :--- |
| **At most once** | Send, never retry | <C color="crimson">Messages, on any failure</C> |
| **At least once** | Retry until acknowledged | <C color="crimson">Nothing — but duplicates occur</C> |
| **Exactly once** | Each message handled precisely once | <C color="crimson">Impossible as a delivery guarantee</C> |

<Jargon
  plain="An operation you can safely run twice, because running it again changes nothing."
  term="idempotent"
  also={['replay-safe', 'safe to retry']}>

<C color="green">The property that makes at-least-once behave like exactly-once.</C> Note it is about the **effect**, not the response — a duplicate may legitimately return the original result rather than reprocessing.

</Jargon>

### Why exactly-once delivery is impossible

The sender cannot distinguish "message lost" from "acknowledgement lost". So it must either retry (risking duplicates) or not (risking loss). <C color="crimson">There is no third behaviour</C>, and this is a consequence of the network, not of implementation quality — the Two Generals problem, which is provably unsolvable.

**What vendors mean by "exactly once":** at-least-once delivery combined with **deduplication or transactional state updates** at the consumer. Kafka's exactly-once semantics work by making the read-process-write cycle atomic *within Kafka*, with idempotent producers and transactional offsets. <C color="orange">The moment your consumer writes to an external system, that guarantee stops applying</C> — you are back to needing idempotency.

<H>Exactly-once *processing* is achievable. Exactly-once *delivery* is not. The difference is that processing can be made idempotent; delivery cannot be made certain.</H>

---

## 2. Idempotency keys, done properly

The mechanism: the **client** generates a unique key, sends it with the request, and reuses it on every retry. The server records it.

The naive implementation has a race, and it is the one that actually bites in production.

<Trace title="Making a payment safely repeatable" subtitle="Watch the naive version fail under concurrency, then the fix.">

<TraceStep
  title="Client generates a key before the first attempt"
  state={{ 'Key': 'idem-abc123', 'Server record': 'none', 'Charges': '0', 'Safe?': 'not yet' }}
  changed={['Key']}
  note="Critical: generated ONCE, before the first attempt, and reused on every retry. A key generated per attempt is useless.">

`POST /payments` with `Idempotency-Key: idem-abc123` and the payment body.

</TraceStep>

<TraceStep
  title="Naive server — check, then act"
  cost="a race window"
  state={{ 'Key': 'idem-abc123', 'Server record': 'none (checked)', 'Charges': '0', 'Safe?': 'no — race open' }}
  changed={['Server record', 'Safe?']}
  note="Between the check and the insert there is a window. Sequential retries are fine; concurrent ones are not.">

```
  if key exists → return stored result
  else          → process, then store the key
```

<C color="crimson">A second request with the same key arriving in that window also sees "not found".</C>

</TraceStep>

<TraceStep
  title="Two retries arrive concurrently"
  cost="double charge"
  state={{ 'Key': 'idem-abc123', 'Server record': 'written twice', 'Charges': '2', 'Safe?': 'NO' }}
  changed={['Server record', 'Charges']}
  note="This happens for real: a client retries on timeout while the original request is still in flight.">

Both pass the check, both charge the card, both store the key. <C color="crimson">Two charges for one idempotency key</C> — the exact thing the key existed to prevent.

</TraceStep>

<TraceStep
  title="Fix — insert the key first, atomically"
  state={{ 'Key': 'idem-abc123', 'Server record': 'IN_PROGRESS', 'Charges': '0', 'Safe?': 'yes' }}
  changed={['Server record', 'Safe?']}
  note="A unique constraint makes the database arbitrate. Exactly one INSERT can win — no application-level locking needed.">

```sql
INSERT INTO idempotency_keys (key, status)
VALUES ('idem-abc123', 'IN_PROGRESS');   -- UNIQUE constraint on key
```

<C color="green">The database guarantees exactly one insert succeeds.</C> The loser gets a constraint violation and knows the request is already being handled.

</TraceStep>

<TraceStep
  title="Winner processes; loser waits or returns 409"
  state={{ 'Key': 'idem-abc123', 'Server record': 'COMPLETED + response', 'Charges': '1', 'Safe?': 'yes' }}
  changed={['Server record', 'Charges']}
  note="Store the response body, not just the key — a retry must return the same answer, not just avoid re-charging.">

The winner charges the card, then updates the row to `COMPLETED` with the stored response. The loser polls briefly and returns the same response, or returns `409` for the client to retry.

</TraceStep>

<TraceStep
  title="The crash case — why status matters"
  cost="the subtle failure"
  state={{ 'Key': 'idem-abc123', 'Server record': 'IN_PROGRESS (stale)', 'Charges': '1 (maybe)', 'Safe?': 'needs recovery' }}
  changed={['Server record', 'Safe?']}
  note="Without expiry, this key is permanently stuck and the client can never succeed or retry.">

If the server dies **after** charging but **before** writing `COMPLETED`, the row is stuck at `IN_PROGRESS`.

<C color="green">Needs a lease</C>: a timestamp on `IN_PROGRESS`, after which another attempt may take over — and a reconciliation against the payment provider to determine whether the charge actually happened.

<H>The whole design comes down to one rule: record the intent atomically before doing the work, not after. Everything else is recovery for the window between intent and completion.</H>

</TraceStep>

</Trace>

**Practical requirements:**

- <C color="green">Client-generated key</C>, created once before the first attempt.
- <C color="green">Unique constraint</C> doing the arbitration, not application code.
- <C color="green">Store the response</C>, so retries return the same answer.
- <C color="green">Scope the key</C> to the user or account, so keys cannot collide or be guessed across tenants.
- <C color="green">Expire keys</C> after a bounded window (24 hours is typical) — they cannot be kept forever.

---

## 3. Making operations naturally idempotent

Often better than bolting on a key. Four techniques:

| Technique | Example |
| :--- | :--- |
| **Use a natural unique key** | `INSERT … ON CONFLICT (order_id) DO NOTHING` |
| **Make it a set operation, not a delta** | `SET status = 'paid'` rather than `INCREMENT attempts` |
| **Include the expected current state** | `UPDATE … WHERE version = 5` — a replay matches nothing |
| **Derive the ID from content** | Hash the payload; the same input produces the same ID |

<C color="crimson">The pattern to avoid is a blind increment.</C> `balance = balance - 100` run twice deducts 200. `balance = 400 WHERE balance = 500` run twice affects one row and then zero — safe by construction.

<Depth title="Deduplication windows, and where idempotency has to live">

**Every deduplication scheme has a window, and the window is the guarantee.** You cannot remember every key you have ever seen — the store grows without bound — so you keep them for some period, and duplicates arriving after that period are **not detected**.

Choosing it is a real trade:

- **Too short** — a message stuck in a dead-letter queue for six hours is replayed and processed twice.
- **Too long** — the key store grows large and expensive; at high volume it can rival the data itself.

Typical windows: 24 hours for API idempotency keys, minutes to hours for stream deduplication. <C color="orange">Whatever you choose, it must exceed your maximum retry horizon</C> — including manual replays, which are usually the longest and least considered.

**Where deduplication belongs matters more than people expect.** There are three layers, and only one is sufficient:

**1. At the broker.** Kafka's idempotent producer deduplicates on `(producer id, sequence number)` — but only for retries **by that producer session**. A producer restart gets a new id, so a message re-sent after a crash is not deduplicated. <C color="crimson">This protects against network retries, not application-level replays.</C>

**2. At the consumer, in memory.** Fast, and lost on restart — which is exactly when you replay from the last committed offset and encounter the duplicates you just forgot.

**3. In the same transaction as the effect.** <C color="green">The only approach that actually works.</C> If processing writes to a database, write the deduplication key **in the same transaction**:

```sql
BEGIN;
  INSERT INTO processed_messages (message_id) VALUES ($1);  -- unique; fails on duplicate
  UPDATE accounts SET balance = balance - 100 WHERE id = $2;
COMMIT;
```

Now the dedup record and the effect are **atomic**. Either both happened or neither did — no window exists in which one is true and the other is not. A duplicate hits the unique violation, the transaction rolls back, and the message is acknowledged without reprocessing.

**Why this is the whole answer.** People reach for exactly-once brokers hoping to avoid this work, and it does not help: <H>the guarantee must live where the side effect lives. If the effect is a row in your database, the deduplication must be a row in the same database, committed in the same transaction.</H>

**When the effect is external** — charging a card, sending an email — you cannot make it transactional with your database. Then you need:

1. Record the intent transactionally **before** calling out (`IN_PROGRESS`).
2. Call the external system, passing **its** idempotency key (every serious payment API supports one).
3. Record the outcome.
4. Reconcile on startup for anything stuck at `IN_PROGRESS`, by querying the external system.

Step 4 is the one teams skip, and it is the one that matters after a crash.

</Depth>

---

## 4. Choosing a semantic

| Situation | Choice |
| :--- | :--- |
| Metrics, logs, telemetry samples | <C color="green">At most once</C> — loss is cheap, volume is high |
| Video frames, live position updates | <C color="green">At most once</C> — stale data is worthless |
| Orders, payments, messages | <C color="green">At least once + idempotency</C> |
| Anything that changes money or state | <C color="green">At least once + idempotency</C> |
| Notifications | At least once — a duplicate email beats a missing one |

<C color="green">At-least-once with idempotent handlers is the correct default for essentially everything that matters.</C> At-most-once is a deliberate choice for high-volume, low-value data.

---

## 5. In a design discussion

- **"At-least-once delivery with idempotent consumers — exactly-once delivery isn't achievable, so we make duplicates harmless."** The correct framing.
- **"The dedup key goes in the same transaction as the effect. A broker's exactly-once guarantee stops at its own boundary."** The insight that separates real experience from reading a docs page.
- **"Client-generated idempotency key, unique constraint on insert — checking then inserting has a race that two concurrent retries will find."** The bug most implementations have.
- **"`SET status = 'paid'` rather than incrementing, so replay is naturally safe without any key at all."** Prefers structure over machinery.

---

## Rapid-fire recall

1. Name the three delivery semantics and what each loses.
2. Why is exactly-once delivery impossible?
3. What do vendors actually mean by "exactly once", and where does it stop applying?
4. Distinguish exactly-once delivery from exactly-once processing.
5. Why must the idempotency key be generated before the first attempt?
6. Describe the race in check-then-act, and the fix.
7. Why store the response body, not just the key?
8. What happens if the server crashes mid-processing, and what is needed?
9. Give four ways to make an operation naturally idempotent.
10. Why must the dedup key be written in the same transaction as the effect?

<details>
<summary>Answers</summary>

1. **At most once** — never retry; loses messages on failure. **At least once** — retry until acknowledged; produces duplicates. **Exactly once** — impossible as a delivery guarantee.
2. The sender cannot distinguish **"message lost"** from **"acknowledgement lost"**, so it must either retry (duplicates) or not (loss). There is no third behaviour — this is the Two Generals problem.
3. **At-least-once delivery plus deduplication or transactional state updates at the consumer.** It stops applying the moment the consumer writes to a system outside the broker's transactional boundary.
4. **Delivery** concerns the message arriving once — impossible. **Processing** concerns the effect happening once — achievable, by making the handler idempotent.
5. Because it must be **identical across all retries**. A key generated per attempt makes every retry look like a new request, which is exactly what it was meant to prevent.
6. Two concurrent requests with the same key both pass the "does this key exist?" check before either inserts, so both process. Fix: **`INSERT` the key first with a unique constraint**, letting the database arbitrate — exactly one insert wins.
7. So a retry returns the **same answer**, not just avoids re-executing. A client that receives a different response on retry cannot tell whether its original request succeeded.
8. The key can be stuck at `IN_PROGRESS` forever, blocking all retries. You need a **lease/timeout** so another attempt can take over, plus **reconciliation** against the external system to determine whether the effect actually occurred.
9. **Natural unique key** (`ON CONFLICT DO NOTHING`) · **set instead of delta** (`SET status='paid'`, not `INCREMENT`) · **include expected state** (`WHERE version = 5`) · **content-derived IDs** (hash the payload).
10. Because otherwise a window exists where one succeeded and the other did not — the effect applied but the key was not recorded (duplicate on replay), or the reverse (message dropped). <H>The guarantee must live where the side effect lives.</H>

</details>

---

**Next:** [Distributed Transactions](./06-distributed-transactions.md) — atomicity across systems that do not share a database.
