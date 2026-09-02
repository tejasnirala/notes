---
title: What Is Low-Level Design?
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# What Is Low-Level Design?

> **What you will be able to do after this page**
>
> - Tell an LLD question from an HLD question in one sentence, reliably.
> - Explain why "design a parking lot" is not a scaling question.
> - Run a repeatable five-step method for any object-modelling problem.
> - Recognise the three modelling mistakes that sink most LLD rounds.

Low-level design is the other half of the discipline and the half people skip. It is a separate interview round at most companies, and it is the one that shows up in your daily work far more often.

<Plain>

Two different jobs go into a building.

The **town planner** decides where the hospital goes, how wide the roads need to be, and whether the water supply can serve another ten thousand homes. They think in districts and traffic flows.

The **architect** designs one building. Where the load-bearing walls go, how the rooms connect, whether you can add a floor later without demolishing the ground one. They think in walls and rooms.

Both are design. Neither can do the other's job with the other's tools, and knowing which one you have been asked for is most of the battle.

High-level design is town planning: services, databases, traffic. Low-level design is the architect: **the classes inside one program and how they fit together.**

Here is the part that catches people out. *"Design a parking lot"* sounds like a traffic question, so candidates start talking about scale and servers. It is not. <C color="crimson">Nobody runs ten million parking lots.</C> It is an architect's question — and the real test comes at the end, when the interviewer says *"now add electric vehicle charging"* and watches how much of your design has to be torn up.

</Plain>

---

## 1. The dividing line

> <H>**If two components can fail independently across a network, you are doing high-level design. If the hard part is who owns which responsibility inside one process, you are doing low-level design.**</H>

```
  HIGH-LEVEL DESIGN                    │  LOW-LEVEL DESIGN
  ─────────────────────────────────────┼────────────────────────────────────
  Boxes are services and datastores    │  Boxes are classes
  Arrows are network calls             │  Arrows are method calls / references
  Failure = a machine dies             │  Failure = a race condition or a
                                       │            change that touches 9 files
  Scale = 10M users                    │  Scale = 200 lines that stay readable
                                       │          after the third feature request
  Unit of thought = the request path   │  Unit of thought = the responsibility
  "Design YouTube"                     │  "Design a parking lot"
  Graded on: trade-offs, bottlenecks   │  Graded on: abstraction, extensibility
```

Both are design. Both are about managing change under constraints. They simply operate at different altitudes, and the tools do not transfer: sharding does not help you model a `PricingStrategy`, and the single responsibility principle does not help you decide between fan-out on write and fan-out on read.

---

## 2. Why the parking lot question confuses people

Candidates hear "design a parking lot system" and reach for load balancers. This is a misread, and interviewers watch for it.

<C color="orange">**Nobody operates ten million parking lots.**</C> The scale is one building, a few thousand spots, a handful of concurrent gate operations. A single process with a single database handles it comfortably. There is no scaling problem to solve, and inventing one wastes the round.

What is actually being graded is whether you can absorb change. The interviewer will, near the end, say something like:

- "Now add electric vehicle charging spots."
- "Now pricing differs on weekends."
- "Now handle monthly pass holders."
- "Now support a second floor with different rates."

<C color="green">**Each of those should touch one or two classes.**</C> If your design requires <C color="crimson">editing nine files and a switch statement in each</C>, you modelled it wrong — and the interviewer just proved it in thirty seconds.

That is the whole game: not "does it work today" but "what does the second requirement cost".

---

## 3. A five-step method

Works for parking lot, elevator, vending machine, chess, BookMyShow, a rate limiter, an ATM — the whole genre.

### Step 1 — Clarify, and enumerate the changes you expect

Same discipline as HLD. Ask what is in scope, and — specific to LLD — **ask what is likely to vary**.

> "Will there be different vehicle types? Different pricing rules? Multiple floors? Do I need to handle payments, or just issue the ticket?"

The answers tell you where to put your abstraction boundaries. Anything the interviewer says will vary is a place where a strategy, an interface or a polymorphic type belongs. Anything they say is fixed should be modelled concretely — abstraction you do not need is a cost, not a virtue.

<Jargon
  plain="How much of your existing design has to change when a new requirement arrives."
  term="extensibility"
  also={['the open–closed principle', 'designing for change']}>

The principle behind it is <C color="orange">*open for extension, closed for modification*</C> — you should be able to add behaviour by adding code, not by editing code that already works. It is the single thing an LLD round is really measuring, and the phrase to say out loud when justifying an interface.

</Jargon>

### Step 2 — Find the nouns

List candidate entities from the problem statement, then prune ruthlessly.

```
  Parking lot:  ParkingLot, Floor, ParkingSpot, Vehicle, Ticket,
                Entrance, Exit, DisplayBoard, Payment, PricingStrategy
```

A noun earns a class if it has **state or behaviour of its own**. If it is only data passed around, it may be a value object or a field. New designers create too many classes; experienced ones create too few and split later.

### Step 3 — Assign responsibilities

The interviewer's real test arrives at the end, as a new requirement. Watch what it costs in two different designs:

<Trace title="&quot;Now add weekend pricing&quot;" subtitle="The same feature request, against a bad design and a good one.">

<TraceStep
  title="The requirement lands"
  state={{ 'Bad design — files touched': '0', 'Good design — files touched': '0', 'Verdict': 'pending' }}
  note="Both designs work perfectly right now. That is the point — working is not the test.">

*"Pricing is different on weekends. And for monthly pass holders. And electric bays cost more."*

</TraceStep>

<TraceStep
  title="Bad design — pricing lives in the manager"
  cost="9 files"
  state={{ 'Bad design — files touched': '9', 'Good design — files touched': '0', 'Verdict': 'pending' }}
  changed={['Bad design — files touched']}
  note="Every branch is a place a future bug hides, and the class grows without bound.">

`ParkingLotManager.calculateFee()` holds the pricing rules as `if` statements. Adding three rules means editing that method, plus the tests, plus the exit flow, plus the receipt printer that duplicated the logic…

<C color="crimson">Nine files, and a method that now has eleven branches.</C>

</TraceStep>

<TraceStep
  title="Good design — pricing is an interface"
  cost="1 new file"
  state={{ 'Bad design — files touched': '9', 'Good design — files touched': '1 (new)', 'Verdict': 'clear' }}
  changed={['Good design — files touched', 'Verdict']}
  note="Nothing that already works is modified. That is 'open for extension, closed for modification' in practice.">

`PricingStrategy` is an interface. Weekend pricing is a **new class** implementing it; the lot is handed whichever strategy applies.

**One new file. Zero existing files edited.**

</TraceStep>

<TraceStep
  title="Why it worked"
  state={{ 'Bad design — files touched': '9', 'Good design — files touched': '1 (new)', 'Verdict': 'the abstraction was placed where variation was stated' }}
  changed={['Verdict']}
  note="And note the discipline: pricing got an interface because the interviewer SAID it would vary. Vehicle type did not need one.">

Not cleverness — **listening**. In step 1 you asked *"what is likely to vary?"* and were told pricing would. So pricing got a seam, and things that were fixed got modelled concretely.

<H>Unused abstraction is a cost, not a virtue. The skill is putting seams exactly where change was predicted, and nowhere else.</H>

</TraceStep>

</Trace>

The step that determines whether the design is good. For each class ask: **what does this object know, and what is it responsible for deciding?**

```
  ParkingSpot       knows its size, its floor, whether it is occupied
                    decides whether it can fit a given vehicle
  Ticket            knows entry time, spot, vehicle
                    decides nothing — it is a record
  PricingStrategy   knows a rate structure
                    decides the fee for a duration          ← varies, so an interface
  ParkingLot        knows its floors
                    decides which spot to assign, orchestrates entry and exit
```

The test: can you state each class's responsibility in one sentence without "and"? A class needing "and" is usually two classes.

### Step 4 — Draw the relationships

Which objects hold references to which, and what kind:

```
  ParkingLot ──1:N──► Floor ──1:N──► ParkingSpot ──0:1──► Vehicle
       │
       └──uses──► PricingStrategy  (interface)
                       ▲
              ┌────────┴────────┐
        HourlyPricing      WeekendPricing
```

Prefer <C color="orange">**composition over inheritance**</C>. Inheritance is the strongest coupling available; a subclass depends on its parent's internals and cannot change independently. <C color="green">`Car extends Vehicle` is fine</C> — a genuine "is-a" that will not change. <C color="crimson">`WeekendParkingLot extends ParkingLot` is a trap</C>, because pricing behaviour should be a field you swap, not a type you subclass.

### Step 5 — Write the key interfaces

Not the whole implementation. Signatures for the two or three operations that carry the design.

```ts
interface PricingStrategy {
  calculate(entry: Date, exit: Date, spotType: SpotType): Money;
}

interface SpotAllocator {
  findSpot(vehicle: Vehicle): ParkingSpot | null;
}

class ParkingLot {
  park(vehicle: Vehicle): Ticket;           // throws LotFullError
  unpark(ticket: Ticket): Money;            // idempotent on an already-exited ticket
}
```

Then walk one scenario end to end out loud: *a car arrives → allocator finds a compact spot → spot is marked occupied → ticket issued → three hours later, unpark → pricing strategy computes the fee → spot released.* Narrating the scenario is what exposes a missing responsibility, and it exposes it before the interviewer finds it.

---

<Depth title="SOLID, stated as the problems each principle prevents">

The five principles are usually recited as definitions, which makes them hard to apply under pressure. They are more useful stated as **the failure each one prevents**.

**S — Single Responsibility.** *A class should have one reason to change.*
Prevents: the god class. The test is the one-sentence description without "and". Note the phrasing is about **reasons to change**, not "does one thing" — `ParkingLot` legitimately does several things, but they all change for the same reason (the lot's rules changed). Pricing changes for a different reason (the business changed its rates), so it belongs elsewhere.

**O — Open/Closed.** *Open for extension, closed for modification.*
Prevents: the nine-files problem in the trace above. In practice this means: when a requirement varies, add a class rather than an `if`. The give-away that you have violated it is a `switch` on a type code.

**L — Liskov Substitution.** *A subclass must be usable anywhere its parent is.*
Prevents: inheritance that lies. The classic violation is `Square extends Rectangle` — setting width on a rectangle should not change its height, but for a square it must, so code written against `Rectangle` breaks. The practical test: <C color="crimson">if a subclass throws on a method its parent supports, or strengthens what callers must provide, it is not really a subtype</C>. This is the principle that most often means "use composition instead".

**I — Interface Segregation.** *Many small interfaces beat one large one.*
Prevents: classes forced to implement methods they do not need — the tell-tale `throw new UnsupportedOperationException()`. A `Vehicle` interface with `charge()` forces every petrol car to implement charging; a separate `Chargeable` interface does not.

**D — Dependency Inversion.** *Depend on abstractions, not concretions.*
Prevents: untestable, unswappable code. `ParkingLot` should hold a `PricingStrategy`, not a `WeekendPricing`. This is what makes the object testable in isolation, because you can pass a fake — and in an interview, saying *"I'd inject this so it can be tested and swapped"* lands well.

**The honest caveat.** SOLID describes forces, not laws, and each can be over-applied. Interface segregation taken to extremes produces dozens of single-method interfaces nobody can navigate. Dependency inversion applied everywhere produces a program where nothing can be read without a dependency-injection container. <C color="orange">The mature position is that these principles buy you *changeability*, and changeability is only worth paying for where change is actually likely</C> — which is why step 1 of the method is asking what will vary.

</Depth>

## 4. The three mistakes that sink rounds

<C color="crimson">**The god class.**</C> A `ParkingLotManager` that allocates spots, computes prices, handles payments, prints tickets and tracks occupancy. Everything works and nothing can change, because every requirement lands in the same file. Symptom: one class holds most of the methods.

<C color="crimson">**Abstraction with no variation behind it.**</C> An `AbstractVehicleFactoryProvider` for a problem with two vehicle types. <C color="orange">Abstraction is not free</C> — it costs a layer of indirection every reader must traverse. Add it where you were *told* something varies, not everywhere. Interviewers read this as pattern-recall rather than judgement.

<C color="crimson">**Modelling data instead of behaviour.**</C> Classes that are bags of getters and setters, with all logic in one service that reaches into them. This is a procedural program wearing objects as a costume, and it is the most common shape people arrive with. The fix is to ask, for each decision the system makes, *which object has the information to make it* — and put the decision there.

> <H>`spot.canFit(vehicle)` beats `if (spot.size >= vehicle.size)` written in a service</H>, because the second version has to be repeated everywhere and updated everywhere when sizing rules change.

---

## 5. What actually gets graded

| Signal | What it looks like |
| :--- | :--- |
| **Extensibility** | The new requirement touches one class |
| **Single responsibility** | Every class describable in one sentence, no "and" |
| **Right abstractions** | Interfaces exactly where variation was stated |
| **Encapsulation** | Objects make their own decisions; no logic reaching into another's fields |
| **Concurrency awareness** | You noticed that two cars can reach the last spot simultaneously |
| **Pragmatism** | You did not build a framework for a parking lot |

That fifth row is worth calling out, because it is the one candidates most often miss entirely. In a parking lot, two entrances allocating the last spot at the same instant is a **real race**, and mentioning it — plus a one-line fix, an atomic compare-and-set on the spot's occupied flag, or allocation behind a lock — separates a good answer from an average one. Nearly every LLD problem has one such race: two users buying the last seat, two threads dispensing the last can, two clients incrementing the same counter.

---

## Rapid-fire recall

1. Give the one-sentence test that distinguishes HLD from LLD.
2. Why is "design a parking lot" not a scaling question?
3. What is actually being graded, and how does the interviewer test it in thirty seconds?
4. In step 1, which question is specific to LLD, and why does its answer matter?
5. When does a noun deserve to be a class?
6. Give the one-sentence test for whether a class has a single responsibility.
7. Why prefer composition over inheritance? Give one example of each being correct.
8. Name the three mistakes that sink LLD rounds.
9. What is wrong with `if (spot.size >= vehicle.size)` in a service, and what replaces it?
10. Name a concurrency race in the parking lot problem and a one-line fix.

<details>
<summary>Answers</summary>

1. If two components can fail independently **across a network**, it is HLD. If the hard part is **who owns which responsibility inside one process**, it is LLD.
2. Nobody runs ten million parking lots. One building, a few thousand spots and occasional gate operations fit in a single process with a single database — there is no scaling problem to solve.
3. **Extensibility.** The interviewer adds a requirement — EV charging, weekend pricing, monthly passes — and sees how many classes you must edit. One or two is a good design; nine is a failed one.
4. **"What is likely to vary?"** Every stated variation is where an interface, strategy or polymorphic type belongs; everything stated as fixed should be modelled concretely, because unused abstraction is a cost.
5. When it has **state or behaviour of its own**. If it is only data being passed around, it is a value object or a field.
6. You can state its responsibility in one sentence without the word "and". Needing "and" usually means it is two classes.
7. Inheritance is the tightest coupling available — a subclass depends on its parent's internals and cannot vary independently. `Car extends Vehicle` is a genuine, stable "is-a". `WeekendParkingLot extends ParkingLot` is wrong: pricing is behaviour you should swap as a field (`PricingStrategy`), not a type you subclass.
8. The **god class** · **abstraction with no variation behind it** · **modelling data instead of behaviour** (getter/setter bags with logic in a service).
9. The comparison gets duplicated at every call site and must be updated everywhere when sizing rules change, and the spot's internals leak to its callers. Replace it with `spot.canFit(vehicle)` — the object holding the information makes the decision.
10. Two entrances allocating the **last free spot** simultaneously. Fix: an atomic compare-and-set on the spot's `occupied` flag (or perform allocation under a lock / in a transaction), so exactly one allocation wins.

</details>

---

**Next:** SOLID in practice, the patterns worth knowing, and the full designs — parking lot, elevator, vending machine, BookMyShow. *(Coming soon.)*
