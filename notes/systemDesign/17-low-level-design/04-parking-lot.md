---
title: Design a Parking Lot
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Design a Parking Lot

> **The canonical LLD problem.** It looks trivial and it is not a scaling question — <C color="orange">the interviewer will add three requirements at the end and count how many classes you have to change.</C>

<Plain>

A car park with several floors, different sizes of bay, and a ticket machine.

The whole thing could be one program that works perfectly on the first day: take a car, find a space, print a ticket, charge on exit.

Then the requests start.

*"Electric bays with charging."* *"Weekend rates are different."* *"Monthly pass holders don't pay hourly."* *"Add a second site with its own rates."*

Each is small. What matters is <C color="orange">whether each lands in one place or is scattered through the program.</C>

The design question is not *"can you model a car park?"* — almost anyone can. It is *"when the fourth request arrives, do you add a file or edit nine?"*

<H>Every decision below is about that: putting the seams where the requirements said things would vary, and nowhere else.</H>

</Plain>

---

## 1. Clarify first

The step candidates skip. <C color="green">Ask what varies</C> — the answers tell you where the abstractions belong.

| Question | Typical answer | Design consequence |
| :--- | :--- | :--- |
| Vehicle types? | Motorcycle, car, van | Spot sizing rules |
| Spot types? | Small, medium, large, **electric**, disabled | A spot has a type and possibly capabilities |
| <C color="orange">Does pricing vary?</C> | <C color="green">Yes — by duration, day, vehicle type</C> | <C color="green">Pricing is a strategy</C> |
| Multiple floors? | Yes | Floor is a real entity |
| Multiple sites? | <C color="orange">Eventually</C> | Do not hard-code one lot |
| Payment methods? | Cash, card | A payment abstraction |
| How is a spot chosen? | Nearest to entrance, or any free one | <C color="green">Allocation is a strategy too</C> |

<C color="crimson">Anything stated as fixed should be modelled concretely.</C> If there are exactly three vehicle types and they will not change, an enum is better than a class hierarchy with a factory.

---

## 2. The model

```
  ParkingLot
    ├── Floor*
    │     └── ParkingSpot*  (id, SpotType, occupied, Vehicle?)
    ├── Entrance* / Exit*
    ├── SpotAllocator        ← interface (varies: nearest, random, by floor)
    └── PricingStrategy      ← interface (varies: hourly, weekend, pass)

  Ticket (id, spot, vehicle, entryTime, TicketState)
  Vehicle (registration, VehicleType)
  Payment (amount, method, status)
```

**Responsibilities, one sentence each — the SRP test:**

| Class | Knows | Decides |
| :--- | :--- | :--- |
| `ParkingSpot` | Its type, floor, occupancy | Whether it can fit a given vehicle |
| `Floor` | Its spots | Which of its spots are free |
| `Ticket` | Entry time, spot, vehicle | Nothing — it is a record with a state |
| `SpotAllocator` | Allocation policy | Which spot to assign |
| `PricingStrategy` | A rate structure | The fee for a duration |
| `ParkingLot` | Its floors and strategies | Orchestrates entry and exit |

<C color="green">`spot.canFit(vehicle)` rather than `if (spot.size >= vehicle.size)` in the lot.</C> The object holding the information makes the decision — otherwise the comparison is duplicated at every call site and must be updated everywhere when sizing rules change.

---

## 3. The interfaces that matter

```java
interface PricingStrategy {
    Money calculate(Instant entry, Instant exit, SpotType type, VehicleType vehicle);
}

interface SpotAllocator {
    Optional<ParkingSpot> allocate(Vehicle vehicle);
}

class ParkingLot {
    Ticket park(Vehicle v);              // throws LotFullException
    Money  unpark(TicketId id);          // idempotent if already exited
}
```

<C color="green">Two seams, both justified by the clarifying answers.</C> Pricing varies (they said so) and allocation varies (nearest vs any). <C color="crimson">Vehicle type does not need a seam</C> if there are three fixed types.

---

## 4. The requirement changes

<Trace title="Four new requirements" subtitle="Counting files touched — which is what is actually being scored.">

<TraceStep
  title="'Add electric spots with charging'"
  cost="1 new value + 1 field"
  state={{ 'Files touched': '1–2', 'What changed': 'SpotType enum, a capability flag', 'Existing code edited': 'minimal', 'Verdict': 'good' }}
  changed={['Files touched', 'What changed', 'Verdict']}
  note="Electric is a kind of spot, and charging is a capability — no new hierarchy needed.">

`SpotType.ELECTRIC` plus a `hasCharger` capability. <C color="green">Allocation and pricing consult it through existing interfaces.</C>

</TraceStep>

<TraceStep
  title="'Weekend pricing'"
  cost="1 new file"
  state={{ 'Files touched': '1 (new)', 'What changed': 'new PricingStrategy impl', 'Existing code edited': 'NONE', 'Verdict': 'ideal' }}
  changed={['Files touched', 'What changed', 'Existing code edited', 'Verdict']}
  note="Open/closed working as intended — extension by addition, with nothing existing modified.">

`WeekendPricing implements PricingStrategy`. <C color="green">Nothing that already works is opened.</C>

</TraceStep>

<TraceStep
  title="'Monthly pass holders'"
  state={{ 'Files touched': '1–2', 'What changed': 'PassHolderPricing + pass lookup', 'Existing code edited': 'minimal', 'Verdict': 'good' }}
  changed={['Files touched', 'What changed']}
  note="Also a pricing rule — the same seam absorbs it.">

Another `PricingStrategy`, selected by whether the vehicle has a valid pass.

</TraceStep>

<TraceStep
  title="'A second site with its own rates'"
  state={{ 'Files touched': '0 structural', 'Why': 'ParkingLot was never a singleton', 'Existing code edited': 'none', 'Verdict': 'free' }}
  changed={['Files touched', 'Why', 'Verdict']}
  note="This is the payoff for rejecting Singleton — two lots are simply two instances.">

<C color="green">Construct a second `ParkingLot` with its own floors and its own strategies.</C>

<H>Had `ParkingLot` been a Singleton — as candidates frequently make it — this requirement would mean unpicking a global from every call site. It is the clearest illustration of why Singleton is usually wrong.</H>

</TraceStep>

<TraceStep
  title="What a bad design would have cost"
  cost="9 files"
  state={{ 'Files touched': '9', 'Why': 'pricing as if/else in the manager', 'Risk': 'each edit can break existing rules', 'Verdict': 'the failing answer' }}
  changed={['Files touched', 'Why', 'Risk', 'Verdict']}
  note="Pricing branches in the manager, the exit flow, the receipt printer and the tests.">

<C color="crimson">A `ParkingLotManager` with pricing branches inline means every new rule edits the same methods</C>, plus their tests, plus anything that duplicated the logic.

</TraceStep>

</Trace>

---

## 5. Concurrency — the part most candidates miss

<Depth title="The last-spot race, and how far to take it">

<C color="crimson">Two cars arrive at two entrances simultaneously and one spot remains.</C> Both threads find it free; both assign it. Two tickets, one space.

This is the [lost update](../04-data-storage/04-transactions-and-isolation.md) at object level, and <C color="green">raising it unprompted is one of the strongest signals available in an LLD round</C> — most candidates never mention concurrency at all.

**The fixes, in increasing scope:**

**1. Atomic state transition on the spot.** The cleanest:

```java
// AtomicBoolean, or a compare-and-set on a status field
if (spot.occupied.compareAndSet(false, true)) {
    // this thread won — safe to issue the ticket
} else {
    // someone else took it; try the next candidate
}
```

<C color="green">No lock held, no contention beyond the single spot</C>, and the loser simply retries with another spot.

**2. A lock around allocation.** Synchronise the allocator so only one thread allocates at a time. Correct, simpler to reason about, and <C color="crimson">it serialises every entry</C> — fine for a car park, wrong as a general habit.

**3. Per-floor locking.** A middle ground: lock the floor being searched rather than the whole lot, so different floors allocate in parallel.

<C color="orange">The right answer for this problem is (1)</C>, with (3) mentioned if the interviewer pushes on contention. Reaching for a global lock immediately is a smaller signal than reaching for a compare-and-set.

**Other races worth naming if asked:**

- **Double payment.** Two exit terminals processing the same ticket. Fix: make `unpark` **idempotent** — a ticket already in `PAID` returns the original receipt rather than charging again.
- **Spot freed while being allocated.** A vehicle leaves as another is being assigned that spot. The compare-and-set handles it: the leaving car sets occupied to false, and the arriving allocation either succeeds or moves on.
- **Ticket state transitions.** Modelling `Ticket` with a **State** pattern makes "pay an already-paid ticket" structurally impossible rather than a check somebody might omit.

**How far to take it.** <C color="green">Naming the race and giving a one-line fix is what is being assessed.</C> Writing a full concurrent implementation is not — and spending ten minutes on lock ordering in a 45-minute round is a scoping error.

The signal the interviewer wants is: *"two entrances can race for the last spot; I'd make the spot's occupancy a compare-and-set so exactly one allocation wins, and the loser retries."* That sentence is worth more than a page of synchronised blocks.

</Depth>

---

## 6. What a good answer sounds like

> *"First, what varies? You've said pricing varies by day and by pass type, and that allocation might be nearest-first — so those two get interfaces and everything else is concrete. `ParkingSpot` decides whether it can fit a vehicle, rather than the lot comparing sizes, so sizing rules live in one place. `ParkingLot` is an ordinary object, not a Singleton, because a second site should just be a second instance. Ticket is a state machine so an already-paid ticket can't be paid again. The concurrency issue is two entrances racing for the last spot — I'd make occupancy a compare-and-set so exactly one wins and the loser tries the next candidate. Adding electric spots is a new enum value and a capability; weekend pricing is one new class and no edits to existing code."*

---

## Rapid-fire recall

1. What is this problem actually testing, and what is it not?
2. Which clarifying question determines where the abstractions go?
3. Why should `spot.canFit(vehicle)` live on the spot?
4. Which two seams are justified, and which is not?
5. Why is `ParkingLot` as a Singleton a design error?
6. How many files should "weekend pricing" touch, and why?
7. What would a bad design have cost for the same requirement, and why?
8. Describe the last-spot race and the preferred fix.
9. Why make `unpark` idempotent?
10. How much concurrency detail is appropriate in the round?

<details>
<summary>Answers</summary>

1. **Testing:** extensibility — how many classes change when a requirement is added. **Not testing:** scale. Nobody operates ten million parking lots; a single process with one database handles it.
2. **"What is likely to vary?"** Stated variations (pricing by day, allocation policy) get interfaces; anything stated as fixed is modelled concretely.
3. Because the **object holding the information should make the decision**. Comparing sizes in the lot duplicates the logic at every call site and requires updating all of them when sizing rules change.
4. Justified: **`PricingStrategy`** and **`SpotAllocator`** — both were stated to vary. Not justified: an abstraction over **vehicle type** when there are three fixed types.
5. Because a second site becomes a rewrite — the global must be unpicked from every call site. As an ordinary object, a second lot is simply **a second instance**.
6. **One new file**, with **no edits to existing code** — a new `PricingStrategy` implementation. That is open/closed working as intended.
7. **Around nine files.** Pricing as `if/else` inside a manager means every new rule edits the same methods plus their tests, plus anywhere the logic was duplicated — and each edit risks breaking rules that already worked.
8. **Two entrances allocate the last free spot simultaneously**, both seeing it free and both assigning it. Preferred fix: **compare-and-set on the spot's occupancy**, so exactly one allocation wins and the loser retries with another spot.
9. Because **two exit terminals can process the same ticket**, or a request can be retried. An already-paid ticket should **return the original receipt** rather than charging again.
10. **Name the race and give a one-line fix.** A full concurrent implementation is out of scope — spending ten minutes on lock ordering in a 45-minute round is a scoping error.

</details>

---

**Next:** [Design an Elevator System](./05-elevator.md) — state machines and scheduling.
