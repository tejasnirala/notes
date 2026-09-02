---
title: Design a Movie Booking System
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Design a Movie Booking System

> **The drill:** BookMyShow or similar. <C color="orange">The object model is easy; the concurrency is the entire question</C> — and unlike most LLD problems, getting it wrong has a visible real-world consequence.

<Plain>

A cinema box office where several people can be buying at once.

Most of it is bookkeeping — films, screens, showings, seats, prices. Straightforward.

The difficulty is a single moment. <C color="crimson">Two people click seat F7 for the same showing at the same instant.</C>

Both see it free. Both are shown a payment page. Both pay.

One of them turns up to find someone else in their seat. <C color="crimson">There is no graceful recovery from that</C> — no refund makes it not have happened, and it is exactly the kind of failure that is invisible in testing and obvious to a customer.

And the awkward part is that the seat cannot simply be marked taken at the moment of clicking, because the person needs two minutes to enter card details and may abandon. So there is a middle state — <C color="orange">*"claimed, but not yet paid for"*</C> — and that state must expire, or an abandoned checkout removes the seat from sale permanently.

Two people, one seat, a payment step in between, and a timer. That is the whole problem.

</Plain>

---

## 1. The model

```
  Movie      (id, title, duration, …)
  Cinema     ── Screen*   ── Seat*  (row, number, SeatType)
  Show       (movie, screen, startTime)
  ShowSeat   (show, seat, ShowSeatState, heldBy?, holdExpiresAt?)   ← the contended entity
  Booking    (user, show, seats*, BookingState, payment)
  PricingStrategy  ← interface (varies: seat type, time of day, day of week)
```

<Jargon
  plain="A seat for one specific showing — not the physical seat, and not the booking."
  term="ShowSeat"
  also={['seat inventory', 'the contended resource']}>

<C color="green">The single most important modelling decision.</C> `Seat` is a physical property of a screen and is never contended. `ShowSeat` is the sellable unit — the same seat is a different `ShowSeat` for each showing — and <C color="orange">it is the only entity with a concurrency problem.</C>

</Jargon>

**Two state machines, and keeping them separate matters:**

```
  ShowSeatState:  AVAILABLE → HELD → BOOKED
                        └──── (hold expires) ────┘

  BookingState:   CREATED → PENDING_PAYMENT → CONFIRMED
                        └──> EXPIRED / CANCELLED / FAILED
```

<C color="crimson">Conflating them is a common error.</C> A booking covers several seats and can fail as a unit; each seat's availability is independent and must be released individually if the booking fails.

---

## 2. The race, and the fix

<Trace title="Two users, one seat" subtitle="The bug, then the correct mechanism.">

<TraceStep
  title="Both see F7 as available"
  state={{ 'F7 state': 'AVAILABLE', 'User A sees': 'free', 'User B sees': 'free', 'Bookings': '0' }}
  changed={['F7 state', 'User A sees', 'User B sees']}
  note="Correct — the seat map is a read, and both reads are accurate at the moment they happen.">

</TraceStep>

<TraceStep
  title="Naive: check then update"
  cost="both succeed"
  state={{ 'A checks': 'available ✓', 'B checks': 'available ✓', 'Both write': 'HELD', 'Result': 'DOUBLE BOOKED' }}
  changed={['A checks', 'B checks', 'Both write', 'Result']}
  note="The lost update, in the one place it is least acceptable — someone attends and finds their seat occupied.">

```java
if (showSeat.getState() == AVAILABLE) {   // both pass
    showSeat.setState(HELD);              // both write
}
```

<C color="crimson">Two independent operations with a gap between them.</C>

</TraceStep>

<TraceStep
  title="Fix: atomic conditional transition"
  state={{ 'A attempts': 'CAS AVAILABLE→HELD', 'B attempts': 'CAS AVAILABLE→HELD', 'Winners': 'exactly 1', 'Result': 'correct' }}
  changed={['A attempts', 'B attempts', 'Winners', 'Result']}
  note="One atomic operation. Whoever loses is told immediately and clearly.">

```java
boolean won = showSeat.compareAndSetState(AVAILABLE, HELD, userId, expiry);
if (!won) throw new SeatUnavailableException(seatId);
```

<C color="green">In a database this is `UPDATE … WHERE state = 'AVAILABLE'` and checking the affected row count.</C>

</TraceStep>

<TraceStep
  title="Multiple seats — all or nothing"
  cost="partial failure"
  state={{ 'Requested': 'F7, F8, F9', 'F8 taken by someone else': 'yes', 'Naive result': 'F7 and F9 held, booking failed', 'Verdict': 'wrong' }}
  changed={['Requested', 'F8 taken by someone else', 'Naive result', 'Verdict']}
  note="Nobody wants two of three adjacent seats — and the two held seats are now blocked for no reason.">

<C color="crimson">Holding seats one at a time leaves orphaned holds when one fails.</C>

</TraceStep>

<TraceStep
  title="Fix: hold them in one transaction, ordered"
  state={{ 'Approach': 'single transaction, seats locked in id order', 'On partial failure': 'roll back all', 'Deadlock': 'prevented by ordering', 'Verdict': 'correct' }}
  changed={['Approach', 'On partial failure', 'Deadlock', 'Verdict']}
  note="Consistent lock ordering is what stops two concurrent multi-seat bookings deadlocking on each other.">

<C color="green">Acquire all seats in one transaction, always in ascending seat id order.</C>

Two users requesting `{F7,F8}` and `{F8,F7}` would otherwise deadlock — <C color="green">ordering makes the cycle impossible.</C>

</TraceStep>

<TraceStep
  title="The hold expires"
  state={{ 'User abandoned': 'yes', 'Without expiry': 'seat blocked forever', 'With expiry': 'returns to AVAILABLE', 'Mechanism': 'TTL + lazy check' }}
  changed={['User abandoned', 'With expiry', 'Mechanism']}
  note="A sweeper plus a lazy check on read, so a stopped sweeper does not block seats indefinitely.">

<H>The expiry is doing the work a distributed transaction would otherwise do: if payment never completes, nothing needs compensating — the hold simply lapses and the seat returns to sale.</H>

</TraceStep>

</Trace>

---

## 3. Payment, and idempotency

Payment is an **external call**, so it is [at-least-once by nature](../06-distributed-systems/05-idempotency-and-delivery.md) — the response can be lost after the charge succeeded.

```
  1. Hold seats (atomic, all-or-nothing, with expiry)
  2. Create Booking in PENDING_PAYMENT with an idempotency key
  3. Charge, passing that key to the provider
  4. On success: seats HELD → BOOKED, booking CONFIRMED
  5. On failure/timeout: release seats, booking FAILED
  6. On startup: reconcile anything stuck in PENDING_PAYMENT against the provider
```

<C color="crimson">Step 6 is the one candidates omit</C>, and it is where real money is lost. A crash between charging and confirming leaves a booking that is paid and not recorded — only reconciliation against the provider resolves it.

<C color="green">Extend the hold when payment begins</C>, so a slow provider does not cause the hold to expire mid-transaction and hand the seat to someone else after the card has been charged.

---

## 4. Where the concurrency really lives

<Depth title="In-process locking versus the database, and what the interviewer is testing">

**This is where LLD meets system design, and the interviewer may push in either direction.**

**If it is a single process** (the pure LLD framing), the mechanisms are:

| Approach | Notes |
| :--- | :--- |
| <C color="green">Per-`ShowSeat` atomic state</C> | Best — contention only on the specific seat |
| Per-`Show` lock | Simpler, and serialises all bookings for a popular showing |
| Global lock | <C color="crimson">Correct and needlessly serialises everything</C> |

<C color="green">Lock granularity is the thing being assessed.</C> Reaching for a global lock is a smaller signal than reaching for per-seat compare-and-set, because it shows you have not thought about what actually contends.

**If it is multiple servers** — and the interviewer will often ask — <C color="crimson">in-process locks are worthless.</C> Two servers each hold their own lock and both succeed.

The correct answer moves the arbitration to a shared authority:

- <C color="green">**The database's conditional update.**</C> `UPDATE show_seats SET state='HELD', … WHERE id = ? AND state='AVAILABLE'`, checking the affected row count. The database serialises it; no external lock service needed. <C color="green">This is the right answer for this problem</C> — write volume is bounded by seats, so a single primary is comfortable.
- **A distributed lock** — and note it needs a **fencing token** to be safe, and even then the seat's conditional update is simpler and stronger. <C color="orange">Proposing a lock service where a conditional update suffices is over-engineering.</C>

**Other things worth raising:**

**Best-available allocation reduces contention structurally.** If users request "three seats together" rather than picking specific ones, the system assigns from a pool and <C color="green">no two users compete for the same specific seat</C> — the same insight as [Ticketmaster](../16-interview-prep/11-ticketmaster.md).

**The seat map is a read model.** Thousands browsing must not touch the transactional path. Serve availability from a cache that may be a second stale — <C color="green">the hold attempt is authoritative and will fail honestly if the seat has gone.</C>

**Cancellation and refunds.** `BOOKED → CANCELLED` returns seats to `AVAILABLE`, subject to a policy (no cancellation within an hour of the show). The refund is another external call requiring the same idempotency treatment.

**Testing this is the real challenge.** The race is timing-dependent and will not appear in ordinary tests. <C color="green">Write a test that fires N concurrent bookings for one seat and asserts exactly one succeeds</C> — that test is worth more than the rest of the suite combined, and mentioning it is a strong signal.

<H>What is being assessed: do you identify the contended resource precisely (`ShowSeat`, not `Seat`, not `Show`), make the transition atomic rather than check-then-act, handle multi-seat bookings as a unit with consistent ordering, and give the hold an expiry so an abandoned checkout self-heals? Those four points are the answer.</H>

</Depth>

---

## 5. What a good answer sounds like

> *"The contended entity is `ShowSeat` — the seat for one specific showing — not the physical seat and not the show. Everything else is bookkeeping. Holding a seat must be one atomic conditional transition, `AVAILABLE → HELD`, not a check followed by a write, or two users both pass the check. Multi-seat bookings acquire all seats in a single transaction in ascending id order, so a partial failure rolls back and two concurrent bookings can't deadlock. The hold carries a TTL, which is what removes the need for a compensating transaction — an abandoned checkout just lapses. Payment is external and at-least-once, so it needs an idempotency key and a startup reconciliation for anything stuck pending. Across multiple servers, in-process locks are useless — the database's conditional update is the arbiter, and write volume is bounded by seats so that's comfortable. And I'd write a test firing concurrent bookings at one seat asserting exactly one wins."*

---

## Rapid-fire recall

1. What is the contended entity, and what are the two things it is not?
2. Why must `ShowSeatState` and `BookingState` be separate?
3. Show the naive hold and explain precisely why it fails.
4. What is the correct hold operation, in code and in SQL?
5. Why must multi-seat holds be one transaction, and why in seat-id order?
6. What work is the hold TTL doing?
7. Which payment step do candidates omit, and what does it cost?
8. Why extend the hold when payment begins?
9. Why are in-process locks useless across multiple servers, and what replaces them?
10. What single test is worth more than the rest of the suite?

<details>
<summary>Answers</summary>

1. **`ShowSeat`** — a specific seat for a specific showing. Not the physical **`Seat`** (a property of the screen, never contended) and not the **`Show`** (locking which would needlessly serialise all bookings for that showing).
2. Because a **booking covers several seats and fails as a unit**, while **each seat's availability is independent** and must be released individually when a booking fails. Conflating them makes partial failure unrepresentable.
3. `if (state == AVAILABLE) state = HELD;` — **two separate operations with a gap**, so two threads both pass the check before either writes. Both then hold the same seat.
4. **`compareAndSetState(AVAILABLE, HELD, …)`** in memory, or **`UPDATE show_seats SET state='HELD' … WHERE id = ? AND state='AVAILABLE'`** with a check on the affected row count.
5. **One transaction** so a partial failure rolls back rather than leaving orphaned holds on the seats that succeeded. **Ascending seat-id order** so two concurrent multi-seat bookings cannot form a deadlock cycle.
6. It **replaces a compensating transaction** — if payment never completes, nothing must be undone; the hold lapses and the seat returns to sale automatically.
7. **Reconciliation on startup** for bookings stuck in `PENDING_PAYMENT`. A crash between charging and confirming leaves a customer charged with no booking recorded, and only checking against the provider resolves it.
8. So a **slow payment provider does not let the hold expire mid-transaction**, handing the seat to someone else after the card has already been charged.
9. Because **each server holds its own lock**, so two servers both succeed. Replaced by the **database's conditional update**, which serialises the transition at a shared authority — sufficient here because write volume is bounded by the number of seats.
10. A test that **fires N concurrent booking attempts at one seat and asserts exactly one succeeds.** The race is timing-dependent and invisible to ordinary sequential tests.

</details>

---

**Part E is complete.** Return to [What Is Low-Level Design?](./01-what-is-low-level-design.md) for the method, or [the interview framework](../16-interview-prep/01-the-framework.md) for the high-level round.
