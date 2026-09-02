---
title: Message Queues
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Message Queues

> **What you will be able to do after this page**
>
> - Say what a queue actually buys you, beyond "it makes things async".
> - Trace a message through acknowledgement, redelivery and the dead-letter queue.
> - Distinguish queues from pub/sub, and pick the right one.
> - Recognise the failure where a queue makes an outage worse rather than better.

A queue is the standard answer to "this work is slow". <C color="orange">It is also a new component that can fill up, lose messages, deliver them twice, and hide a failure until it is much larger.</C>

<Plain>

A restaurant kitchen has a rail where waiters clip order tickets. Cooks take them off one at a time.

Without the rail, a waiter would stand at the pass describing the order and wait until the food was ready before serving anyone else. The rail lets the waiter <C color="green">hand over the work and immediately get back to customers</C>.

That is the whole idea, and it buys three distinct things people usually merge into one.

**The waiter stops waiting.** Serving the next table no longer depends on how long the steak takes.

**A rush is absorbed.** Twenty orders in two minutes does not break anything — the tickets queue up, and cooks work through them. The dining room and the kitchen no longer have to run at the same speed.

**A dropped ticket is recoverable.** A cook who takes a ticket and then burns the dish can put it back on the rail. Nothing is lost just because one attempt failed.

Now the part that matters. <C color="crimson">A long rail is not a solution to a slow kitchen.</C> If orders arrive faster than cooks can work, the rail grows all evening, and every ticket on it represents a customer waiting longer than they think. The rail hid the problem for a while and made it worse when it surfaced — food arriving cold, forty minutes late, for people who left.

<C color="orange">A queue converts "I can't keep up" into "I'm slow", and delays the moment you notice.</C>

</Plain>

---

## 1. What a queue actually buys

| Benefit | What it means |
| :--- | :--- |
| **Decoupling in time** | Producer and consumer need not be up simultaneously |
| **Load levelling** | A spike is absorbed, not passed on |
| **Retry for free** | A failed message is redelivered; the producer never knows |
| **Independent scaling** | Add consumers without touching producers |
| **Failure isolation** | A dead consumer does not fail the user's request |

<H>The most valuable of these is load levelling. Without a queue, your consumer must be sized for peak. With one, it can be sized for average — which is often 5–10× cheaper.</H>

**What it costs:** end-to-end latency, at-least-once duplicates, out-of-order delivery, a new component to operate, and — most importantly — the user no longer gets a synchronous answer, so your API must return `202 Accepted` and offer a way to learn the outcome.

---

## 2. A message's life

<Jargon
  plain="Telling the queue you finished with a message, so it can stop tracking it."
  term="acknowledgement (ack)"
  also={['ack/nack', 'message acknowledgement']}>

The critical detail is **when** you ack. <C color="crimson">Acking on receipt means a crash loses the message</C>; acking after processing means a crash redelivers it. The second is nearly always what you want — which is why consumers must be [idempotent](../06-distributed-systems/05-idempotency-and-delivery.md).

</Jargon>

<Trace title="A message that fails four times" subtitle="Order confirmation email. Visibility timeout 30 s, max 3 attempts.">

<TraceStep
  title="Producer enqueues"
  state={{ 'Queue depth': '1', 'Message state': 'visible', 'Attempts': '0', 'User waiting?': 'no' }}
  changed={['Queue depth', 'Message state']}
  note="The API already returned 202 to the user. Everything after this is invisible to them.">

The order service writes the message and returns immediately.

</TraceStep>

<TraceStep
  title="Consumer receives it"
  state={{ 'Queue depth': '1', 'Message state': 'invisible (30 s)', 'Attempts': '1', 'User waiting?': 'no' }}
  changed={['Message state', 'Attempts']}
  note="Not deleted — hidden. If the consumer dies now, it reappears when the timer expires.">

The message becomes **invisible** to other consumers for 30 seconds while this one works.

</TraceStep>

<TraceStep
  title="The consumer crashes mid-processing"
  cost="redelivery"
  state={{ 'Queue depth': '1', 'Message state': 'visible again', 'Attempts': '1', 'User waiting?': 'no' }}
  changed={['Message state']}
  note="This is the guarantee working correctly — and the reason duplicates exist. The email may already have been sent.">

No ack arrives. After 30 seconds the message becomes visible again.

<C color="orange">It may have been fully processed before the crash</C> — the queue cannot tell.

</TraceStep>

<TraceStep
  title="Attempt 2 — the email provider is down"
  state={{ 'Queue depth': '1', 'Message state': 'invisible → visible', 'Attempts': '2', 'User waiting?': 'no' }}
  changed={['Message state', 'Attempts']}
  note="A transient failure. Retrying is exactly right here.">

The consumer nacks explicitly. The message returns to the queue, ideally with backoff.

</TraceStep>

<TraceStep
  title="Attempt 3 — a malformed address"
  cost="permanent failure"
  state={{ 'Queue depth': '1', 'Message state': 'attempts exhausted', 'Attempts': '3', 'User waiting?': 'no' }}
  changed={['Message state', 'Attempts']}
  note="Retrying will never help — the data itself is bad. This is a poison message.">

The address fails validation. <C color="crimson">No number of retries will fix this</C>, and without a limit it would retry forever, consuming capacity indefinitely.

</TraceStep>

<TraceStep
  title="Moved to the dead-letter queue"
  state={{ 'Queue depth': '0', 'DLQ depth': '1', 'Message state': 'parked in DLQ', 'Attempts': '3 (final)' }}
  changed={['Queue depth', 'DLQ depth', 'Message state']}
  note="A DLQ with no alert is a black hole. The whole value is in noticing.">

After the attempt limit, the message moves to a **dead-letter queue** — preserved for inspection, out of the main flow.

<H>A DLQ is not a failure bin, it is a work queue for humans. Alert on depth greater than zero, or you will discover six months of silently failed messages during an unrelated incident.</H>

</TraceStep>

</Trace>

---

## 3. Queue versus pub/sub

Two different shapes, and mixing them up produces designs that cannot work.

```
  QUEUE (competing consumers)          PUB/SUB (fan-out)
  one message → exactly one consumer   one message → every subscriber

  ┌───┐                                ┌───┐──► email service
  │ P │──► [ queue ]──┬──► worker 1    │ P │──► analytics
  └───┘               ├──► worker 2    └───┘──► search indexer
                      └──► worker 3
  scales by adding workers             each subscriber gets its own copy
```

| | Queue | Pub/Sub |
| :--- | :--- | :--- |
| Delivery | One consumer per message | Every subscriber |
| Adding consumers | <C color="green">More throughput</C> | <C color="orange">More copies of the work</C> |
| Use for | Work distribution | Event notification |
| Producer knows consumers? | No | No — and that is the point |

<C color="crimson">The classic mistake is using a queue where you needed pub/sub.</C> Three services need to react to `order.placed`; you use one queue, so each message goes to exactly one of them and the other two never hear about it. The fix is a topic with three subscriptions, each backed by its own queue.

**Common systems:** SQS, RabbitMQ (queues) · SNS, Google Pub/Sub, RabbitMQ topic exchanges (pub/sub) · Kafka does both via [consumer groups](./02-log-based-streams.md).

---

## 4. Ordering, and why it fights throughput

Most queues guarantee ordering only within a **partition** or **message group** — never globally.

The reason is structural: <C color="orange">parallel consumers process messages concurrently, so the only way to guarantee global order is one consumer, processing one message at a time.</C> That is a throughput of one.

<C color="green">The practical answer is a partition key.</C> Messages sharing a key go to the same partition and are processed in order relative to each other; different keys proceed in parallel.

```
  key = user_id  →  all of user 42's events stay ordered
                    user 43's events proceed independently
```

Choose the key as the **smallest scope where order actually matters**. It is almost never "all messages" — it is per user, per order, per document.

<Depth title="When a queue makes things worse">

Queues are so standard that adding one is rarely questioned. Four situations where it actively hurts:

**1. The user is waiting for the result.** If the client must have the answer to continue, a queue adds latency and a polling mechanism for no benefit. <C color="crimson">"Async" is not free when the caller cannot proceed without the result</C> — you have replaced a 200 ms call with a 200 ms call plus polling, plus a job store, plus a status endpoint.

**2. The queue hides a capacity problem until it is severe.** A consumer that can handle 900 msg/s receiving 1,000 msg/s does not error. The queue grows by 100/s — 360,000 messages in an hour. Latency rises from milliseconds to hours while every dashboard shows green and every request succeeds.

<C color="crimson">The single most important queue metric is not depth — it is **age of the oldest message**.</C> Depth conflates a brief spike with sustained under-capacity; age tells you directly how far behind you are, in units your users experience.

**3. Retry storms amplify a downstream failure.** A dependency slows; messages fail; the queue redelivers them; redelivered messages add load to the struggling dependency. <C color="crimson">The queue's helpfulness becomes the mechanism of the outage.</C> Needs exponential backoff, a circuit breaker, and a cap on in-flight retries — [the same amplification](../03-traffic-and-edge/05-service-mesh.md) as mesh retries.

**4. The failure surfaces far from its cause.** Synchronously, a bad request returns `400` to the caller with a stack trace. Asynchronously it lands in a DLQ hours later, with no user session, no request context, and often no way to reproduce. <C color="orange">You have traded immediate, attributable failure for delayed, anonymous failure</C> — which is why correlation IDs propagated into messages matter far more in async systems than sync ones.

**The honest test before adding a queue:**

| Question | If yes… |
| :--- | :--- |
| Does the user need the result now? | <C color="crimson">Don't queue it</C> |
| Is the consumer able to handle sustained peak? | Queue is for smoothing, not capacity |
| Is the work idempotent? | If not, fix that **first** |
| Will anyone watch the DLQ? | If not, you are building a silent failure sink |
| Can we alert on oldest-message age? | If not, you will not notice falling behind |

<H>A queue is the right answer when work genuinely does not need to happen now. It is the wrong answer to "this is slow" — that is a capacity problem, and a queue only changes where the waiting happens.</H>

</Depth>

---

## 5. Choosing a broker

| Need | Reach for |
| :--- | :--- |
| Simple work queue, managed | <C color="green">SQS</C> — cheap, unlimited scale, no ops |
| Complex routing, priorities, per-message TTL | <C color="green">RabbitMQ</C> |
| Replay, ordering per key, many independent consumers | <C color="green">Kafka</C> — see [next page](./02-log-based-streams.md) |
| Fan-out to many services | <C color="green">SNS + SQS</C>, or Kafka topics |
| Already running Redis, modest volume | Redis Streams — fine, with less durability |

<C color="orange">Use the managed option unless you have a specific reason not to.</C> A broker is exactly the kind of stateful infrastructure whose operational burden is easy to underestimate.

---

## 6. In a design discussion

- **"The upload returns `202` and queues transcoding — the user gets a job id and polls, or we send a webhook."** Names the API consequence, not just the queue.
- **"Partition by `user_id`, so one user's events stay ordered while different users process in parallel."** Ordering at the smallest scope that matters.
- **"DLQ with an alert on depth greater than zero. A DLQ nobody watches is a place messages go to die quietly."** Operational maturity.
- **"I'd alert on oldest-message age rather than depth — depth can't distinguish a spike from being permanently under-provisioned."** The metric most teams get wrong.

---

## Rapid-fire recall

1. Name five things a queue buys, and say which is most valuable.
2. What does a queue cost, including the API-level consequence?
3. Why must you ack after processing rather than on receipt, and what does that imply?
4. What is a visibility timeout, and what happens when it expires?
5. What is a poison message, and what stops it consuming capacity forever?
6. Why is a DLQ without an alert worse than useless?
7. Distinguish a queue from pub/sub, and describe the classic mistake.
8. Why can no queue guarantee global ordering at scale, and what is the practical answer?
9. Why is oldest-message age a better metric than queue depth?
10. Give four situations where adding a queue makes things worse.

<details>
<summary>Answers</summary>

1. **Decoupling in time** · **load levelling** · **free retries** · **independent scaling** · **failure isolation**. Most valuable is **load levelling** — the consumer can be sized for average instead of peak, often 5–10× cheaper.
2. **End-to-end latency**, **duplicates** (at-least-once), **out-of-order delivery**, **a new component to operate**, and the API must return **`202 Accepted`** with a way to learn the outcome — the user no longer gets a synchronous answer.
3. Because acking on receipt means a **crash loses the message**. Acking after processing means a crash **redelivers** it, which implies consumers must be **idempotent**.
4. The period a received message is **hidden from other consumers**. If no ack arrives before it expires, the message becomes **visible again** and is redelivered — possibly after it was already fully processed.
5. A message that **can never succeed** (malformed data, a permanently invalid reference). A **max-attempts limit** plus a **dead-letter queue** stops it retrying forever.
6. Because failures accumulate **silently**. Without an alert on depth > 0, you discover months of failed messages during an unrelated incident. A DLQ is a work queue for humans, not a failure bin.
7. **Queue**: each message goes to exactly one consumer — adding consumers adds throughput. **Pub/sub**: every subscriber gets a copy. The classic mistake is using one queue where three services each need to react — two of them silently never see the message.
8. Because **parallel consumers process concurrently**; the only way to guarantee global order is a single consumer handling one message at a time, giving throughput of one. The answer is a **partition key** — order within a key, parallelism across keys.
9. Because **depth cannot distinguish a brief spike from sustained under-capacity**. Age directly measures how far behind you are, in the units users actually experience.
10. **The user is waiting for the result** · **it hides a capacity problem** until it is severe · **retry storms amplify a downstream failure** · **failures surface far from their cause**, with no request context.

</details>

---

**Next:** [Log-Based Streams](./02-log-based-streams.md) — the queue that remembers everything.
