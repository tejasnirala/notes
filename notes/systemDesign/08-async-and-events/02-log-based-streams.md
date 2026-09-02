---
title: Log-Based Streams
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Log-Based Streams

> **What you will be able to do after this page**
>
> - Explain how a log differs from a queue, and what that difference unlocks.
> - Trace partitions, offsets and consumer groups.
> - Say why Kafka is fast despite writing everything to disk.
> - Decide between a queue and a log from the requirements.

A traditional queue **deletes** a message once it is consumed. A log **keeps** it. <C color="orange">That single difference is the whole topic</C> — and it turns out to change what the system can do.

<Plain>

Compare two ways of handling incoming mail.

**A pile of letters.** You take one off the top, read it, and throw it away. Simple. And once it is gone, it is gone — if a colleague also needed to see it, or you realise a week later you misread it, there is nothing to go back to.

**A bound ledger.** Every letter is written into a book in order, and nothing is ever erased. Instead of removing entries, each reader keeps a **bookmark** — "I have read up to page 412".

The ledger changes what is possible in ways the pile cannot match.

**Several readers, independently.** Accounts reads it, legal reads it, and the archivist reads it. Each keeps their own bookmark, at their own pace. Nobody's reading removes anything from anyone else.

**Going back.** A new department starts and reads from page 1 to catch up on history. Someone finds a bug in how they interpreted entries and simply **moves their bookmark back** to reprocess.

**The order is permanent.** Entry 411 is before 412, forever, for everyone.

The cost is the obvious one: <C color="orange">the ledger keeps growing, and you must decide how long to keep it.</C> A pile disposes of itself; a ledger needs shelves and a retention policy.

</Plain>

---

## 1. The log

An append-only, ordered, durable sequence. Consumers track their own position.

```
  PARTITION 0
  ┌────┬────┬────┬────┬────┬────┬────┬────┐
  │ 0  │ 1  │ 2  │ 3  │ 4  │ 5  │ 6  │ 7  │ ← new messages appended here
  └────┴────┴────┴────┴────┴────┴────┴────┘
              ▲              ▲         ▲
        analytics       search    email service
        offset 2        offset 5   offset 7

  Nothing is deleted on read. Each consumer group owns its offsets.
```

<Jargon
  plain="Each reader's bookmark — the position they have processed up to."
  term="offset"
  also={['consumer offset', 'log position', 'cursor']}>

<C color="green">Because the offset belongs to the consumer, not the broker, replay is a matter of setting it backwards.</C> This is what a queue fundamentally cannot do — a deleted message has nowhere to be replayed from.

</Jargon>

| | Traditional queue | Log |
| :--- | :--- | :--- |
| After consumption | <C color="crimson">Deleted</C> | <C color="green">Retained</C> |
| Multiple independent consumers | Needs a queue each | <C color="green">Built in</C> |
| Replay history | <C color="crimson">Impossible</C> | <C color="green">Move the offset</C> |
| Ordering | Per queue, weak | <C color="green">Strict per partition</C> |
| Storage | Bounded by backlog | <C color="orange">Bounded by retention</C> |
| Per-message TTL, priorities | <C color="green">Yes</C> | <C color="crimson">No</C> |
| Selective ack of one message | <C color="green">Yes</C> | <C color="crimson">No — offsets move forward</C> |

---

## 2. Partitions and consumer groups

A topic is split into **partitions**. Each partition is an independent ordered log, and <C color="orange">parallelism comes entirely from partition count.</C>

<Trace title="Scaling consumers on a 4-partition topic" subtitle="Watch what happens as consumers are added — and where it stops helping.">

<TraceStep
  title="One consumer, four partitions"
  state={{ 'Partitions': '4', 'Consumers': '1', 'Assignment': 'C1 → P0,P1,P2,P3', 'Idle consumers': '0' }}
  changed={['Partitions', 'Consumers', 'Assignment']}
  note="One consumer reads all partitions. Order is preserved within each, but they are processed by one process.">

A single consumer in the group is assigned every partition.

</TraceStep>

<TraceStep
  title="Add a second consumer — rebalance"
  state={{ 'Partitions': '4', 'Consumers': '2', 'Assignment': 'C1 → P0,P1 · C2 → P2,P3', 'Idle consumers': '0' }}
  changed={['Consumers', 'Assignment']}
  note="A rebalance briefly pauses consumption for the whole group — worth knowing before you autoscale aggressively.">

Kafka **rebalances**, splitting partitions between them. <C color="green">Throughput roughly doubles.</C>

</TraceStep>

<TraceStep
  title="Four consumers — one partition each"
  state={{ 'Partitions': '4', 'Consumers': '4', 'Assignment': '1 partition each', 'Idle consumers': '0' }}
  changed={['Consumers', 'Assignment']}
  note="Maximum useful parallelism for this topic.">

Perfect distribution, four times the throughput.

</TraceStep>

<TraceStep
  title="Add a fifth — it does nothing"
  cost="idle consumer"
  state={{ 'Partitions': '4', 'Consumers': '5', 'Assignment': '4 assigned, 1 idle', 'Idle consumers': '1' }}
  changed={['Consumers', 'Assignment', 'Idle consumers']}
  note="A partition is never shared by two consumers in a group — that is what preserves ordering.">

<C color="crimson">A partition is assigned to at most one consumer per group</C>, so the fifth sits idle.

<H>Partition count is the hard ceiling on consumer parallelism, and it must be chosen up front — increasing it later breaks key-to-partition mapping and therefore ordering.</H>

</TraceStep>

<TraceStep
  title="A second consumer group joins"
  state={{ 'Partitions': '4', 'Group A': '4 consumers', 'Group B': '2 consumers', 'Interference': 'none' }}
  changed={['Group A', 'Group B', 'Interference']}
  note="This is the fan-out property: adding a consumer group costs the producer nothing and affects no existing consumer.">

The analytics team creates its own group with its own offsets. <C color="green">It reads every message independently</C>, at its own pace, without affecting group A.

</TraceStep>

<TraceStep
  title="A bug is found — replay"
  cost="reprocess 3 days"
  state={{ 'Partitions': '4', 'Group B offsets': 'reset to 3 days ago', 'Messages reprocessed': '~40M', 'Group A': 'unaffected' }}
  changed={['Group B offsets', 'Messages reprocessed']}
  note="The single most valuable property of a log, and the reason to choose one over a queue.">

The analytics consumer had a calculation error. Reset its offsets and reprocess three days of history.

<C color="green">No other consumer is affected, and no data had to be re-sent by producers.</C>

</TraceStep>

</Trace>

### Choosing the partition key

Same rules as [sharding](../05-data-at-scale/02-partitioning-and-sharding.md), for the same reasons:

- Messages with the same key always go to the same partition → <C color="green">ordering per key</C>.
- <C color="crimson">A skewed key creates a hot partition</C> — one consumer saturated while others idle.
- No key means round-robin: even distribution, **no ordering guarantee at all**.

---

## 3. Why a log is fast

Counter-intuitively, writing everything to disk is what makes it quick.

| Mechanism | Effect |
| :--- | :--- |
| **Append-only writes** | Pure [sequential I/O](../01-foundations/04-latency-numbers.md) — hundreds of MB/s even on spinning disks |
| **Page cache** | Recent messages are served from OS memory; consumers usually read what was just written |
| **Zero-copy (`sendfile`)** | Data goes from page cache to socket without passing through the application |
| **Batching** | Messages are grouped, compressed and written together, amortising per-message overhead |
| **No per-message state** | The broker tracks one offset per partition per group, not per-message acks |

<H>That last row is the structural advantage. A traditional broker tracks the state of every individual message; a log tracks one integer per consumer group per partition — so its bookkeeping does not grow with message volume.</H>

---

## 4. Retention and compaction

Two policies:

**Time or size based.** Keep 7 days, or 100 GB per partition, then delete the oldest. <C color="green">Simple and right for event streams.</C>

**Log compaction.** Keep the **latest value per key** forever, discarding superseded ones.

```
  Before:  (k1,a) (k2,x) (k1,b) (k3,p) (k1,c) (k2,y)
  After:   (k3,p) (k1,c) (k2,y)          ← latest per key retained
```

<C color="green">This turns a log into a durable, replayable snapshot of current state.</C> A new consumer reads from the beginning and reconstructs the full current state, then continues with live updates — which is exactly what you want for configuration, entity state, or a materialised view. It is also how Kafka stores its own consumer offsets.

<Depth title="Exactly-once, and where the guarantee actually stops">

Kafka advertises "exactly-once semantics", and it is real — within precisely defined boundaries that are easy to overrun.

**Three mechanisms combine:**

**1. Idempotent producer.** Each producer gets an id, and each message a sequence number per partition. The broker rejects duplicates from a retry, so a network-level retry does not append the message twice. <C color="orange">Scoped to one producer session</C> — a producer restart gets a new id and this protection lapses.

**2. Transactions.** A producer can write to several partitions atomically. Consumers with `read_committed` never see messages from an aborted transaction.

**3. Transactional offset commits.** The critical piece: a consumer can commit its **offsets** in the **same transaction** as the messages it produces. So the read-process-write cycle is atomic — either the output was written and the offset advanced, or neither.

```
  BEGIN
    produce(output-topic, result)
    commit_offset(input-topic, current)
  COMMIT
```

<C color="green">Within Kafka, this genuinely gives exactly-once stream processing.</C> It is what makes Kafka Streams and Flink correct.

**And here is where it stops.** The moment your consumer writes to something outside Kafka — a database, a payment API, an email provider — <C color="crimson">the transaction cannot include it</C>, and you are back to at-least-once:

```
  read message  →  charge a card  →  commit offset
                        ▲
              crash here: the card is charged,
              the offset is not committed,
              the message is redelivered, and
              the card is charged again.
```

No broker feature can prevent that, because the broker has no way to roll back an external side effect.

**The correct pattern** is the one from [idempotency](../06-distributed-systems/05-idempotency-and-delivery.md): make the effect idempotent, and where the effect is a database write, **store the offset in the same database transaction** as the effect:

```sql
BEGIN;
  INSERT INTO orders (...) VALUES (...);
  UPDATE consumer_offsets SET offset = 4711 WHERE partition = 2;
COMMIT;
```

Now the effect and the position advance atomically, in the store that holds the effect. On restart, resume from the offset in **your** database rather than Kafka's.

<H>The pattern generalises: exactly-once requires the offset and the effect to commit together, so the guarantee must live wherever the effect lives. A broker can only give it to you for effects inside the broker.</H>

**The cost of transactions**, worth knowing before enabling them: throughput drops (typically 3–20% depending on batch size), latency rises because consumers must wait for transaction markers, and `read_committed` consumers cannot read past an in-flight transaction — <C color="crimson">so one long-running transaction stalls consumption of that partition entirely.</C>

</Depth>

---

## 5. Queue or log?

| Requirement | Choose |
| :--- | :--- |
| Distribute work among workers | <C color="green">Queue</C> — simpler, per-message ack |
| Multiple services react to the same event | <C color="green">Log</C> — independent consumer groups |
| Replay history, or reprocess after a bug | <C color="green">Log</C> — the decisive capability |
| Strict ordering per entity | <C color="green">Log</C> — partition by entity id |
| Priorities, per-message TTL, selective ack | <C color="green">Queue</C> — a log cannot do these |
| Very high throughput | <C color="green">Log</C> |
| Small volume, want zero operations | <C color="green">Queue</C> (SQS) |

<C color="orange">The strongest single argument for a log is replay.</C> The ability to fix a consumer bug and reprocess a week of history — without asking producers to re-send anything — changes how confidently you can iterate on a data pipeline.

<C color="crimson">The strongest argument against is operational weight.</C> Self-hosted Kafka needs real expertise: partition planning, rebalance behaviour, retention sizing, broker tuning. If you need a work queue, SQS costs almost nothing to run.

---

## 6. In a design discussion

- **"Kafka rather than a queue, because search, analytics and notifications all need the same events, and we want to replay after a consumer bug."** Names the deciding capability.
- **"Partition by `user_id`, 24 partitions — that caps consumer parallelism, and increasing it later breaks key-to-partition mapping."** Shows the constraint is up-front.
- **"Compacted topic for entity state, so a new consumer reads from the beginning and rebuilds current state before going live."** A powerful, under-used pattern.
- **"Kafka's exactly-once stops at Kafka's boundary. Writing to Postgres, I'd store the offset in the same transaction as the effect."** The point most candidates miss.

---

## Rapid-fire recall

1. What is the single structural difference between a queue and a log?
2. Where do offsets live, and what does that enable?
3. Why does a fifth consumer on a 4-partition topic do nothing?
4. Why must partition count be chosen carefully up front?
5. What does a second consumer group cost the first?
6. Name four reasons a log is fast despite writing to disk.
7. Why does a log's bookkeeping not grow with message volume?
8. What is log compaction, and what does it turn a topic into?
9. Where exactly does Kafka's exactly-once guarantee stop applying?
10. Give three things a queue can do that a log cannot.

<details>
<summary>Answers</summary>

1. A queue **deletes** a message on consumption; a log **retains** it and consumers track their own position.
2. With the **consumer** (per consumer group), not the broker. That enables **replay** — moving an offset backwards reprocesses history — and independent consumption by multiple groups.
3. Because a **partition is assigned to at most one consumer per group**, which is what preserves per-partition ordering. With four partitions, the fifth consumer has nothing to be assigned.
4. Because it is the **hard ceiling on consumer parallelism**, and **increasing it later changes key-to-partition mapping**, breaking ordering guarantees for existing keys.
5. **Nothing.** Each group has its own offsets and reads every message independently. Fan-out is free to existing consumers and to producers.
6. **Append-only sequential writes** · **page cache** serving recent messages from memory · **zero-copy (`sendfile`)** from page cache to socket · **batching and compression** · **no per-message state**.
7. Because it tracks **one offset per partition per consumer group** — a single integer — rather than acknowledgement state for every individual message.
8. Retaining only the **latest value per key**, discarding superseded ones. It turns the topic into a **durable, replayable snapshot of current state** that a new consumer can read from the beginning to rebuild state, then follow live.
9. At **Kafka's own boundary**. It covers the read-process-write cycle when input, output and offsets are all in Kafka. Any external side effect — a database write, a card charge, an email — cannot be in the transaction, so it reverts to at-least-once.
10. **Priorities** · **per-message TTL** · **selective acknowledgement of an individual message** (log offsets only move forward).

</details>

---

**Next:** [Workers and Background Jobs](./03-workers-and-jobs.md) — the code on the other end of the queue.
