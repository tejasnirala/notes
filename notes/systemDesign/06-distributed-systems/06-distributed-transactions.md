---
title: Distributed Transactions
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Distributed Transactions

> **What you will be able to do after this page**
>
> - Explain why two-phase commit blocks, and why that makes it unpopular.
> - Design a saga, including the compensating actions.
> - Use the outbox pattern to publish events without dual-write bugs.
> - Say when the right answer is to avoid the distributed transaction entirely.

Once data spans services, `BEGIN … COMMIT` no longer exists. <C color="orange">Everything here is about replacing atomicity with something weaker that you can actually operate.</C>

<Plain>

Booking a holiday means a flight, a hotel and a car — three separate companies. You want all three or none; a flight with nowhere to sleep is worse than no booking at all.

**The strict approach:** call all three, have each hold their reservation, and only once all three confirm do you tell them to finalise. Genuinely atomic.

The flaw is what happens if you have a heart attack midway. <C color="crimson">All three are holding reservations, waiting for a final word that never comes.</C> They cannot sell those seats to anyone else — they were told to hold them — and they cannot release them either, because you might still confirm. Everyone is stuck until somebody sorts it out manually.

**The practical approach:** book them one at a time. Flight confirmed. Hotel confirmed. Car — none available.

You do not have a magic undo. What you do instead is **cancel the hotel, then cancel the flight** — real actions that reverse the earlier ones. For a while you genuinely had a flight with no car; now you have nothing, which is what you wanted.

It is messier. The cancellations might incur a fee. Someone briefly saw a booking that no longer exists.

<C color="green">And nobody is ever stuck holding a reservation waiting for a word that never comes</C> — which is why almost every real system chooses the second approach.

</Plain>

---

## 1. Two-phase commit

A coordinator asks every participant to **prepare**, then tells them all to **commit** or **abort**.

```
  PHASE 1 — PREPARE
  coordinator ──"can you commit?"──► A, B, C
  each: do the work, hold locks, write to durable log, reply YES
        (a YES is a PROMISE it can commit even after a crash)

  PHASE 2 — COMMIT
  all YES → coordinator ──"commit"──► A, B, C
  any NO  → coordinator ──"abort"───► A, B, C
```

<C color="green">It genuinely provides atomicity across systems.</C> And it has one flaw serious enough that most architectures avoid it entirely:

<Jargon
  plain="Participants are stuck holding locks, unable to finish or give up, because the coordinator went away."
  term="the blocking problem in 2PC"
  also={['coordinator failure', 'in-doubt transactions']}>

A participant that answered YES <C color="crimson">cannot unilaterally commit or abort</C> — it promised to be able to do either. If the coordinator dies before phase 2, it waits, **holding its locks**, until the coordinator returns or a human intervenes.

</Jargon>

| Problem | Consequence |
| :--- | :--- |
| **Coordinator is a SPOF** | Its failure blocks every in-flight transaction |
| **Locks held across the network** | Throughput collapses under any latency |
| **Availability multiplies down** | All participants must be up; three 99.9% services give 99.7% |
| **Slowest participant sets the pace** | Every commit waits for the worst |

<H>2PC trades availability for atomicity — a distributed transaction is available only when every participant is. That is the opposite of what most systems want.</H>

It is still used where it belongs: within a single database's internal partitions, in XA transactions across a database and a message broker on one host, and inside NewSQL systems where the coordinator is itself a fault-tolerant consensus group — <C color="green">which is precisely how Spanner and CockroachDB remove the blocking problem</C>.

---

## 2. Sagas

Break the transaction into local steps, each with a **compensating action** that semantically undoes it.

```
  Forward:      reserve flight → reserve hotel → reserve car
  Compensate:   cancel flight  ← cancel hotel  ←  (car failed)
```

<C color="orange">Compensation is not rollback.</C> A rollback erases history; a compensation is a new action that reverses the effect. The intermediate state was real and observable — a refund is not the same as the payment never happening, and if a confirmation email went out, it cannot be unsent.

<Trace title="A holiday booking saga" subtitle="Three services, no shared database. Step three fails.">

<TraceStep
  title="Step 1 — reserve the flight"
  state={{ 'Flight': 'reserved', 'Hotel': '—', 'Car': '—', 'Saga state': 'step 1 done' }}
  changed={['Flight', 'Saga state']}
  note="Each step commits locally and is immediately visible. There is no isolation across the saga.">

The flight service reserves a seat and **commits**. Anyone querying now sees a confirmed flight.

</TraceStep>

<TraceStep
  title="Step 2 — reserve the hotel"
  state={{ 'Flight': 'reserved', 'Hotel': 'reserved', 'Car': '—', 'Saga state': 'step 2 done' }}
  changed={['Hotel', 'Saga state']}
  note="The saga's progress must be persisted — if the orchestrator crashes now, recovery needs to know where it was.">

Committed. The saga log records that steps 1 and 2 succeeded.

</TraceStep>

<TraceStep
  title="Step 3 — no cars available"
  cost="compensation begins"
  state={{ 'Flight': 'reserved', 'Hotel': 'reserved', 'Car': 'FAILED', 'Saga state': 'compensating' }}
  changed={['Car', 'Saga state']}
  note="The customer currently holds a flight and hotel they did not want on their own — a real, externally visible state.">

The car service has nothing available. <C color="crimson">Two reservations exist that should not.</C>

</TraceStep>

<TraceStep
  title="Compensate step 2 — cancel the hotel"
  state={{ 'Flight': 'reserved', 'Hotel': 'cancelled', 'Car': 'failed', 'Saga state': 'compensating' }}
  changed={['Hotel']}
  note="Compensations run in reverse order and must themselves be idempotent and retried until they succeed.">

`cancelHotel(reservationId)` — a **new** transaction that reverses the effect. It may incur a cancellation fee, which is a real consequence the rollback metaphor hides.

</TraceStep>

<TraceStep
  title="Compensate step 1 — cancel the flight"
  state={{ 'Flight': 'cancelled', 'Hotel': 'cancelled', 'Car': 'failed', 'Saga state': 'compensated' }}
  changed={['Flight', 'Saga state']}
  note="If a compensation fails, it must retry indefinitely — and eventually alert a human. It cannot simply be abandoned.">

`cancelFlight(reservationId)`. The system is back to a consistent state.

</TraceStep>

<TraceStep
  title="What was visible during all this"
  cost="no isolation"
  state={{ 'Flight': 'cancelled', 'Hotel': 'cancelled', 'Car': 'failed', 'Observed states': 'flight-only, then flight+hotel' }}
  changed={['Observed states']}
  note="This is the fundamental difference from ACID, and it must be designed for rather than discovered.">

Other parts of the system saw a flight-only booking, then a flight-and-hotel booking, then nothing.

<H>Sagas give you atomicity — all or nothing, eventually — but no isolation. Intermediate states are real, visible, and can be acted upon by other processes.</H>

</TraceStep>

</Trace>

### Orchestration vs choreography

| | Orchestration | Choreography |
| :--- | :--- | :--- |
| Control | A central orchestrator calls each step | Each service reacts to events |
| <C color="green">Good</C> | Flow is explicit and readable in one place; easy to debug | No central component; services stay decoupled |
| <C color="crimson">Bad</C> | The orchestrator knows every service — coupling | <C color="crimson">The flow exists nowhere</C>; understanding it means reading every service |

<C color="green">Prefer orchestration for anything with more than about three steps.</C> Choreography is elegant with two or three participants and becomes very hard to reason about beyond that — nobody can answer "what happens when this fails?" without tracing events across six repositories.

---

## 3. The outbox pattern

The most useful pattern here, because it solves a bug nearly every service has.

**The dual-write problem:** you need to update your database *and* publish an event. They are separate systems, so they cannot be atomic.

```
  BEGIN; UPDATE orders SET status='paid'; COMMIT;
  publish("order.paid")     ← fails? DB says paid, nobody was told
                            ← succeeds but DB rolled back? event about a
                              state that does not exist
```

<C color="green">The fix: write the event into your own database, in the same transaction.</C>

```sql
BEGIN;
  UPDATE orders SET status = 'paid' WHERE id = 42;
  INSERT INTO outbox (topic, payload) VALUES ('order.paid', '{...}');
COMMIT;
```

A separate process reads the `outbox` table — by polling, or by tailing the [replication log](../05-data-at-scale/04-zero-downtime-migrations.md) — publishes each row, and marks it sent.

<H>Because the outbox row and the state change commit together, an event can never describe a state that did not happen, and a state change can never fail to produce its event.</H>

The cost is that publishing becomes **asynchronous** and **at-least-once** — the publisher can crash after publishing but before marking sent, so consumers must be [idempotent](./05-idempotency-and-delivery.md). That is the right trade: at-least-once with idempotent consumers is a solved problem; dual writes are not.

<Depth title="Avoiding the distributed transaction entirely">

Before designing a saga, it is worth asking whether the transaction should cross a boundary at all. Frequently the distributed transaction is a **symptom of a service boundary drawn in the wrong place**.

**Signal 1: two services always change together.** If every order update also updates inventory, and neither is meaningful without the other, they may be one service with one database. <C color="orange">Service boundaries should follow transactional boundaries</C> — the useful rule is that a boundary is well-placed when a single business operation touches only one service.

This is Domain-Driven Design's **aggregate**: the unit of consistency. Data inside an aggregate is transactionally consistent; data across aggregates is eventually consistent. A design that constantly needs cross-service transactions has probably split an aggregate.

**Signal 2: the atomicity is not actually required.** Many "must be atomic" requirements are habit rather than analysis. Does the order *really* have to be created atomically with the welcome email? Almost never — the email can be retried independently, and a few seconds of lag is invisible.

**Signal 3: reservation works better than transaction.** Rather than atomically confirming across services, **reserve** with a TTL and confirm later:

```
  1. Reserve inventory (expires in 15 min)
  2. Take payment
  3. Confirm the reservation
  If step 2 fails, do nothing — the reservation expires by itself.
```

<C color="green">The TTL replaces the compensating action entirely.</C> Nothing has to be undone, because nothing was permanently committed. This is how ticketing, seat booking and inventory holds actually work, and it is considerably simpler than a saga.

**Signal 4: a single-writer design removes the problem.** If exactly one service owns a piece of data and others request changes through it, there is no distributed transaction — just a request. The consistency question becomes a local one again.

**When you genuinely need a distributed transaction:**

| Situation | Approach |
| :--- | :--- |
| Multiple partitions, one database | <C color="green">The database handles it</C> — Spanner, CockroachDB, Vitess |
| Long-running business process | <C color="green">Saga with orchestration</C> |
| State change plus event publication | <C color="green">Outbox</C> |
| Temporary hold before confirming | <C color="green">Reservation with TTL</C> |
| Genuinely atomic across two databases | <C color="orange">2PC</C> — and reconsider the boundary first |

<H>The best distributed transaction is the one you designed out of existence. Sagas are the answer when the business process genuinely spans services; they are the wrong answer to a service boundary in the wrong place.</H>

</Depth>

---

## 4. In a design discussion

- **"Saga with orchestration — the flow is explicit in one place, and with five steps choreography would leave nobody able to explain what happens on failure."** Chooses and justifies.
- **"Outbox for publishing, so the event and the state change commit together. Dual writes fail silently."** Names the bug it prevents.
- **"Sagas give atomicity but no isolation — intermediate states are visible, so the UI needs a 'pending' state rather than pretending it is instant."** The consequence people forget.
- **"Before the saga: could these be one service? If every order change also changes inventory, the boundary may be wrong."** The senior move.

---

## Rapid-fire recall

1. Describe both phases of 2PC and what a YES vote commits a participant to.
2. What is the blocking problem, and why can a participant not resolve it alone?
3. Give three consequences of 2PC beyond blocking.
4. Where is 2PC still appropriate?
5. What is a compensating action, and how does it differ from a rollback?
6. What do sagas guarantee, and what do they explicitly not guarantee?
7. Compare orchestration and choreography, and say when to prefer each.
8. State the dual-write problem and how the outbox solves it.
9. What does the outbox cost, and what must consumers therefore be?
10. Give three ways to avoid needing a distributed transaction at all.

<details>
<summary>Answers</summary>

1. **Prepare** — every participant does the work, holds locks, durably logs, and replies YES/NO. **Commit** — if all said YES the coordinator says commit, otherwise abort. A YES is a **promise that the participant can commit even after crashing**, so it may no longer decide for itself.
2. If the coordinator fails after phase 1, participants that voted YES **cannot commit or abort unilaterally** — they promised either is possible — so they wait, **holding locks**, until the coordinator returns or a human intervenes.
3. The **coordinator is a single point of failure** · **locks are held across the network**, collapsing throughput under latency · **availability multiplies down** (all participants must be up) · **the slowest participant sets the pace**.
4. Within one database's internal partitions, in XA across a database and broker on one host, and inside NewSQL systems where the **coordinator is itself a fault-tolerant consensus group** — which removes the blocking problem.
5. A **new transaction that semantically reverses** an earlier committed one. A rollback erases history as if nothing happened; a compensation cannot — the intermediate state was real, observable, and may have side effects (fees, emails) that cannot be undone.
6. They guarantee **atomicity** — all steps or all compensations, eventually. They do **not** guarantee **isolation** — intermediate states are committed, visible, and can be acted on by other processes.
7. **Orchestration**: a central coordinator drives each step — explicit, debuggable, but couples the orchestrator to every service. **Choreography**: services react to events — decoupled, but the flow exists nowhere and cannot be read in one place. Prefer orchestration beyond about three steps.
8. Updating the database and publishing an event are **separate systems and cannot be atomic**, so either the state changes with no event, or an event describes a state that rolled back. The **outbox** writes the event into the same database in the same transaction; a separate process publishes it afterwards.
9. Publishing becomes **asynchronous and at-least-once** — the publisher can crash after sending but before marking sent. Consumers must therefore be **idempotent**.
10. **Redraw the service boundary** so one operation touches one service (aggregates) · **question whether atomicity is genuinely required** · **use a reservation with a TTL** so expiry replaces compensation · **single-writer ownership**, turning the transaction into a request.

</details>

---

**Next:** [Caching Fundamentals](../07-caching/01-caching-fundamentals.md) — the highest-leverage performance work available.
