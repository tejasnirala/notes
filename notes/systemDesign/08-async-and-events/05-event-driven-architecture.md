---
title: Event-Driven Architecture
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Event-Driven Architecture

> **What you will be able to do after this page**
>
> - Distinguish an event from a command, and say why the difference decides coupling.
> - Design an event schema that can evolve without breaking consumers.
> - Choose between thin and fat events, knowing what each costs.
> - Recognise when event-driven design has made a system harder to understand.

<C color="orange">An event says *something happened*. A command says *do this*.</C> That distinction sounds pedantic and determines whether your services stay decoupled.

<Plain>

Two ways to run an office.

**Commands.** The manager tells accounts to raise an invoice, tells the warehouse to pack a box, and tells marketing to send an email. Clear, and the manager must know every department, what each does, and in what order. <C color="crimson">Add a department and the manager's job changes.</C>

**Announcements.** The manager posts a notice: *"Order 4471 has been placed."* Accounts sees it and raises an invoice. The warehouse sees it and packs. Marketing sees it and sends an email. The manager <C color="green">does not know or care who is reading</C>.

Adding a new department is now free — it reads the notice board and starts reacting. Nobody rewrites the manager's job.

That is the appeal, and the cost is on the same page. **With commands you can read the manager's instructions and know exactly what happens.** With announcements, understanding what an order triggers means asking every department whether they watch that board — and <C color="orange">nobody, anywhere, has the whole picture written down.</C>

You have traded *"easy to change"* for *"easy to understand"*, and that trade is the whole subject.

</Plain>

---

## 1. Events versus commands

| | Command | Event |
| :--- | :--- | :--- |
| Says | *Do this* | *This happened* |
| Tense | Imperative — `SendEmail` | <C color="green">Past — `OrderPlaced`</C> |
| Recipients | One, named | Any number, unknown |
| Sender knows receiver? | <C color="crimson">Yes</C> | <C color="green">No</C> |
| Can be rejected? | Yes | <C color="crimson">No — it already happened</C> |
| Coupling | Sender → receiver | <C color="green">Receiver → event shape</C> |

<Jargon
  plain="A record that something already happened, published without knowing who will care."
  term="an event"
  also={['domain event', 'a fact']}>

<C color="green">Name events in the **past tense**</C> — `OrderPlaced`, `PaymentCaptured`, `UserDeactivated`. It is not a style preference: if you find yourself naming one `SendConfirmationEmail`, you have written a command and disguised it as an event, and the publisher now implicitly knows what the consumer should do.

</Jargon>

**Both are legitimate.** Commands are right when you need a specific thing done and want to know whether it succeeded. Events are right when you are announcing a fact and other parties decide what it means to them.

<C color="crimson">The failure is a command wearing an event's clothes.</C> Publishing `SendWelcomeEmail` to a topic gives you all the indirection of events with none of the decoupling — the publisher still knows exactly what must happen, it just cannot tell whether it did.

---

## 2. Thin or fat events

How much should an event carry?

```
  THIN (notification)                FAT (state transfer)
  { "type": "OrderPlaced",           { "type": "OrderPlaced",
    "orderId": "4471" }                "orderId": "4471",
                                       "customer": {...},
  consumer must call back              "items": [...],
  to fetch details                     "total": 4200 }
```

| | Thin | Fat |
| :--- | :--- | :--- |
| Message size | <C color="green">Tiny</C> | Large |
| Consumer needs a callback | <C color="crimson">Yes — a synchronous dependency</C> | <C color="green">No</C> |
| Data freshness | <C color="green">Always current</C> | <C color="orange">Snapshot at publish time</C> |
| Works when producer is down | <C color="crimson">No</C> | <C color="green">Yes</C> |
| Replay gives historical truth | <C color="crimson">No — refetch returns *today's* data</C> | <C color="green">Yes</C> |
| Coupling to producer's schema | Low | <C color="crimson">High</C> |

<H>Thin events secretly reintroduce synchronous coupling: the consumer must call the producer to do anything useful, so the producer being down still breaks it. That defeats much of the point.</H>

<C color="green">Prefer fat events carrying the data consumers actually need</C> — enough to act without a callback. The replay property matters too: reprocessing a thin event fetches *current* state, not the state at the time, which silently corrupts any historical reprocessing.

---

## 3. Schema evolution

Events outlive the code that produced them. An event published today may be replayed in two years by a consumer written next month.

<Trace title="Evolving an event without breaking consumers" subtitle="Adding, renaming and removing a field on OrderPlaced.">

<TraceStep
  title="v1 in production"
  state={{ 'Producers': 'v1', 'Consumers': 'v1 (4 services)', 'Broken': '0', 'In-flight old events': 'yes' }}
  note="Four independent teams consume this event. None deploys at the same moment as you.">

`{ orderId, customerId, total }`, consumed by billing, warehouse, analytics and email.

</TraceStep>

<TraceStep
  title="Add an optional field — safe"
  state={{ 'Producers': 'v2', 'Consumers': 'v1 (unchanged)', 'Broken': '0', 'In-flight old events': 'yes' }}
  changed={['Producers']}
  note="Old consumers ignore unknown fields. This is the only change that is unconditionally safe.">

Add `currency`, optional with a default. <C color="green">Existing consumers ignore it and keep working.</C>

</TraceStep>

<TraceStep
  title="Rename a field — breaks everything"
  cost="4 consumers down"
  state={{ 'Producers': 'v2', 'Consumers': 'v1 (broken)', 'Broken': '4', 'In-flight old events': 'yes' }}
  changed={['Consumers', 'Broken']}
  note="A rename is a delete plus an add, and the delete is what breaks people.">

Renaming `total` to `totalAmount` <C color="crimson">breaks all four consumers simultaneously</C>, and there is no deploy ordering that avoids it.

</TraceStep>

<TraceStep
  title="The safe rename — publish both"
  state={{ 'Producers': 'v3 (both fields)', 'Consumers': 'migrating', 'Broken': '0', 'In-flight old events': 'handled' }}
  changed={['Producers', 'Consumers', 'Broken']}
  note="Exactly the expand-migrate-contract pattern from schema migrations, applied to a message format.">

Publish `total` **and** `totalAmount` for a transition period. Consumers migrate at their own pace. Only once every consumer has moved — and every retained event has aged out — is `total` removed.

</TraceStep>

<TraceStep
  title="The constraint replay adds"
  cost="retention-length compatibility"
  state={{ 'Producers': 'v3', 'Consumers': 'v3', 'Broken': '0', 'Must still parse': 'v1 events from 90 days ago' }}
  changed={['Consumers', 'Must still parse']}
  note="A consumer replaying from the start of retention meets every schema version ever published in that window.">

With 90-day retention, a consumer resetting its offset encounters **v1 events**.

<H>Consumers must be able to parse every schema version still inside the retention window — so retention length is also your backward-compatibility obligation.</H>

</TraceStep>

</Trace>

**The rules:**

- <C color="green">Add optional fields freely</C> — the only unconditionally safe change.
- <C color="crimson">Never rename or remove</C> without a dual-publish transition.
- <C color="green">Version the event type</C> (`OrderPlaced.v2`) when a breaking change is unavoidable, and publish both during migration.
- <C color="green">Use a schema registry</C> (Avro, Protobuf) to enforce compatibility at publish time rather than discovering breakage in a consumer's error logs.
- <C color="green">Consumers ignore unknown fields.</C> A strict parser that rejects them makes every producer change a breaking change.

---

## 4. Where event-driven hurts

<Depth title="The debugging and comprehension costs, and how to contain them">

Event-driven systems are excellent at accommodating change and poor at explaining themselves. Four specific costs, and what actually helps.

**1. No single place describes the flow.** *"What happens when an order is placed?"* has no answer in any one repository. It is distributed across every consumer, and consumers can be added without the producer knowing — so the answer changes without anyone editing anything you would think to read.

<C color="green">Containment:</C> maintain an **event catalogue** — a registry of event types, their schemas, their producers and their known consumers, generated from code or schema registry metadata where possible. It goes stale, and a stale catalogue still beats none.

**2. Debugging is archaeology.** A synchronous failure gives you a stack trace across the whole call path. An event-driven failure gives you a message in a DLQ, hours later, with no request context.

<C color="green">Containment:</C> **propagate a correlation id** from the originating request into every event and every derived event. Then one query reconstructs the full causal chain. This is the single highest-value practice in event-driven systems, and it costs almost nothing to add on day one — and a great deal to retrofit.

**3. Cycles are easy to create and hard to see.** Service A emits an event; B reacts and emits another; C reacts and emits a third — which A consumes, emitting the first again. <C color="crimson">An infinite loop that no single team can see</C>, because each service's behaviour is locally reasonable.

<C color="green">Containment:</C> a **hop count** or causation chain on every event, dropped and alerted past a threshold. Also: services should generally not consume events they can cause.

**4. Ordering assumptions that were never true.** A consumer written assuming `OrderPlaced` arrives before `PaymentCaptured` works fine in testing and fails in production, where they were published to different partitions.

<C color="green">Containment:</C> make consumers **order-independent** where possible — handle events arriving in any order, using the entity's state rather than the event sequence. Where ordering genuinely matters, put the events on the **same partition key**.

**When *not* to go event-driven:**

| Situation | Better choice |
| :--- | :--- |
| You need the result to continue | <C color="green">Synchronous call</C> |
| Exactly one service must react | <C color="green">A command, or a direct call</C> |
| Strong consistency required across the effect | <C color="green">A transaction</C> |
| Small team, few services | <C color="green">Direct calls</C> — the indirection buys nothing yet |
| The flow is a fixed sequence with error handling | <C color="green">Orchestrated [saga](../06-distributed-systems/06-distributed-transactions.md)</C> |

<H>Event-driven architecture buys the ability to add consumers without changing producers. If you are not adding consumers — and most systems are not, most of the time — you are paying the comprehension cost for a benefit you never collect.</H>

</Depth>

---

## 5. Patterns worth knowing

**Event notification.** Thin events; consumers call back for detail. <C color="orange">Simplest, and reintroduces synchronous coupling.</C>

**Event-carried state transfer.** Fat events; consumers keep a local copy of what they need. <C color="green">Fully decoupled and resilient</C>, at the cost of duplicated data that must be kept current.

**Event sourcing.** The event log **is** the source of truth; current state is derived by replaying it. Covered in [its own page](../09-architecture-styles/03-event-sourcing-and-cqrs.md).

**Outbox.** Publishing events atomically with the state change that produced them — the fix for [dual writes](../06-distributed-systems/06-distributed-transactions.md).

**Choreography vs orchestration.** Whether the flow is implicit in reactions or explicit in a coordinator. <C color="green">Prefer orchestration once a flow has more than about three steps.</C>

---

## 6. In a design discussion

- **"`OrderPlaced`, past tense — if I were naming it `SendConfirmationEmail`, that is a command and the publisher would know too much."** The distinction, applied.
- **"Fat events carrying what consumers need. Thin events force a callback, so the producer being down still breaks them."** Names the hidden coupling.
- **"Add optional fields freely; renames need dual publishing for the full retention window, because replay meets old versions."** Schema evolution with the replay constraint.
- **"Correlation ids into every event from day one — without them, debugging an async failure is archaeology."** The practice that is painful to retrofit.

---

## Rapid-fire recall

1. Give the defining difference between an event and a command, including tense.
2. What goes wrong when a command is published as an event?
3. Compare thin and fat events on coupling, replay and producer availability.
4. Why does replaying a thin event corrupt historical reprocessing?
5. Which schema change is unconditionally safe, and why?
6. Why can a rename never be deployed safely in one step, and what is the fix?
7. How does retention length become a compatibility obligation?
8. Name the four comprehension costs of event-driven systems.
9. What single practice most improves async debugging, and when must it be added?
10. Give three situations where event-driven is the wrong choice.

<details>
<summary>Answers</summary>

1. A **command** says *do this* (imperative, one named recipient, can be rejected). An **event** says *this happened* (**past tense**, any number of unknown recipients, cannot be rejected because it already occurred).
2. You get the **indirection of events with none of the decoupling** — the publisher still knows exactly what must happen, but can no longer tell whether it did.
3. **Thin**: tiny messages, but consumers must call back, so they break when the producer is down and they couple to its API. **Fat**: larger messages, consumers act independently and survive producer outages, at the cost of coupling to the producer's data shape.
4. Because a callback returns **today's** state rather than the state at the time of the event, so reprocessing history produces results based on current data.
5. **Adding an optional field.** Existing consumers ignore unknown fields, so no consumer needs to change or redeploy.
6. Because a rename is a **delete plus an add**, and every existing consumer reads the deleted name — there is no deploy ordering that avoids breaking them. Fix: **publish both fields** during a transition, migrate consumers, then remove the old one.
7. Because a consumer resetting its offset replays events from the start of retention, encountering **every schema version published in that window** — so consumers must parse all of them for as long as retention lasts.
8. **No single place describes the flow** · **debugging is archaeology** without request context · **cycles are easy to create and invisible locally** · **ordering assumptions that were never guaranteed**.
9. **Propagating a correlation id** from the originating request into every event and derived event. It must be added on **day one** — it is cheap then and very expensive to retrofit.
10. **The caller needs the result to continue** · **exactly one service must react** (use a command or direct call) · **strong consistency is required** (use a transaction) · a small team with few services, where the indirection buys nothing.

</details>

---

**Next:** [Monolith and Microservices](../09-architecture-styles/01-monolith-and-microservices.md) — how big a deployable should be.
