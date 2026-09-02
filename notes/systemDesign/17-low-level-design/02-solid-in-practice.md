---
title: SOLID in Practice
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# SOLID in Practice

> **What you will be able to do after this page**
>
> - State each principle as the failure it prevents, not as a definition.
> - Recognise a violation from its symptom in real code.
> - Apply them proportionally, rather than everywhere.
> - Say why over-applying them is its own failure mode.

Five principles, usually recited and rarely applied. <C color="orange">They are far more useful stated as the specific mistake each one prevents.</C>

<Plain>

A workshop builds furniture, and over time develops five habits.

**One job per bench.** The bench that cuts wood does not also do the varnishing. Not because it could not, but because when the varnish supplier changes, you want to alter one bench and not disturb the cutting.

**Add a bench rather than rewiring one.** A new product type gets a new station. The stations that already work correctly are not opened up and modified, because opening working things is how they stop working.

**A replacement part must actually fit.** If a drawer is advertised as a standard drawer, it must slide into a standard slot. <C color="crimson">One that needs a hammer is not a standard drawer</C>, whatever the label says.

**Small, specific tool kits.** A kit containing forty tools for a job needing three means everyone carries thirty-seven tools they never use — and cannot tell which ones matter.

**Depend on the type of tool, not the specific one.** A bench that requires *"a drill"* can use whichever drill is available. One that requires *"this exact drill, serial 4471"* stops working the day it breaks.

<H>None of these is about correctness — a workshop violating all five can produce perfect furniture. They are about what the *next* change costs.</H>

</Plain>

---

## 1. The five, as failures prevented

### S — Single Responsibility

> A class should have **one reason to change**.

<C color="crimson">Prevents:</C> the god class — an `OrderManager` that validates, prices, charges, emails and logs. Every requirement lands in the same file, and every change risks the others.

<C color="green">The test:</C> describe the class in one sentence without "and". Needing "and" usually means two classes.

<C color="orange">The subtlety people miss:</C> it is about **reasons to change**, not about doing one thing. `ParkingLot` legitimately does several things — but they all change when the lot's rules change. Pricing changes when the *business* changes its rates, which is a different reason, so it belongs elsewhere.

### O — Open/Closed

> Open for extension, closed for modification.

<C color="crimson">Prevents:</C> a new requirement forcing edits to code that already works.

<C color="green">The tell of a violation:</C> a `switch` or `if/else` chain on a type code that must be extended every time a variant is added.

```java
// Violation — every new type edits this method
if (type == CAR)        return 10;
else if (type == BIKE)  return 5;
else if (type == TRUCK) return 20;

// Satisfied — a new type is a new class, nothing existing changes
vehicle.getRate();
```

### L — Liskov Substitution

> A subclass must be usable anywhere its parent is.

<C color="crimson">Prevents:</C> inheritance that lies — a subtype that breaks code written against the supertype.

The canonical violation is `Square extends Rectangle`: setting width on a rectangle should not change its height, but for a square it must, so code written against `Rectangle` breaks. <C color="green">The practical test: if a subclass throws on a method its parent supports, or demands more from callers than its parent did, it is not a subtype.</C>

<C color="orange">This is the principle that most often means "use composition instead of inheritance".</C>

### I — Interface Segregation

> Many small interfaces beat one large one.

<C color="crimson">Prevents:</C> classes forced to implement methods they do not need — the tell-tale `throw new UnsupportedOperationException()`.

A `Vehicle` interface with `charge()` forces every petrol car to implement charging. A separate `Chargeable` interface does not.

### D — Dependency Inversion

> Depend on abstractions, not concretions.

<C color="crimson">Prevents:</C> untestable and unswappable code. `ParkingLot` should hold a `PricingStrategy`, not a `WeekendPricing`.

<C color="green">The practical payoff is testing</C>: an object depending on an interface can be given a fake in a test. One that constructs its own dependency cannot.

---

## 2. Recognising violations by symptom

<Trace title="Refactoring a god class" subtitle="One class, five reasons to change, taken apart one at a time.">

<TraceStep
  title="The starting point"
  state={{ 'Class': 'OrderProcessor', 'Responsibilities': '5', 'Reasons to change': '5', 'Testable in isolation': 'no' }}
  changed={['Class', 'Responsibilities', 'Reasons to change']}
  note="Validates, prices, charges the card, sends email, writes audit logs. Everything works.">

<C color="crimson">A 600-line class touched by every team.</C>

</TraceStep>

<TraceStep
  title="Symptom — a switch on order type"
  cost="violates O"
  state={{ 'Adding a type': 'edit 4 methods', 'Risk': 'breaks existing types', 'Violation': 'Open/Closed' }}
  changed={['Adding a type', 'Risk', 'Violation']}
  note="Four separate switch statements on the same enum — a reliable signal.">

Adding `SubscriptionOrder` means editing pricing, validation, fulfilment and receipt generation.

<C color="green">Fix: an `OrderType` interface; each variant is a class.</C>

</TraceStep>

<TraceStep
  title="Symptom — cannot test without a card charge"
  cost="violates D"
  state={{ 'Test': 'hits the real payment API', 'Violation': 'Dependency Inversion', 'Fix': 'inject PaymentGateway' }}
  changed={['Test', 'Violation', 'Fix']}
  note="The class constructs `new StripeClient()` internally, so nothing can substitute it.">

<C color="green">Depend on a `PaymentGateway` interface, injected.</C> Tests pass a fake.

</TraceStep>

<TraceStep
  title="Symptom — email change breaks pricing tests"
  cost="violates S"
  state={{ 'Reasons to change': '5 in one class', 'Violation': 'Single Responsibility', 'Fix': 'separate classes' }}
  changed={['Violation', 'Fix']}
  note="Unrelated tests failing for unrelated reasons is the clearest SRP symptom there is.">

<C color="green">Split by reason to change:</C> `OrderValidator`, `PricingService`, `PaymentGateway`, `NotificationService`, `AuditLog`.

</TraceStep>

<TraceStep
  title="The result"
  state={{ 'Classes': '5 focused', 'Adding an order type': '1 new class', 'Testable in isolation': 'yes', 'Reasons to change': '1 each' }}
  changed={['Classes', 'Adding an order type', 'Testable in isolation', 'Reasons to change']}
  note="Same behaviour. The difference is entirely in what the next change costs.">

<H>Nothing about the program's behaviour changed. What changed is that a new order type is now one new file instead of edits scattered across four methods that already worked.</H>

</TraceStep>

</Trace>

---

## 3. Applying them proportionally

<Depth title="Why over-applying SOLID is its own failure, and how to calibrate">

Each principle can be taken too far, and the results are recognisable:

| Principle | Over-applied |
| :--- | :--- |
| **S** | Classes so small that following one operation means opening fifteen files |
| **O** | An abstraction for every conceivable variation, most of which never arrive |
| **L** | Inheritance avoided so completely that genuine hierarchies are hand-rolled |
| **I** | Dozens of single-method interfaces nobody can navigate |
| **D** | Nothing readable without a dependency-injection container and a debugger |

<C color="crimson">The unifying failure is treating the principles as goals rather than as tools for a purpose.</C> They exist to make **change** cheap. Where change is not expected, they buy nothing and cost indirection.

**The calibration question**, and it is the same one from [the LLD method](./01-what-is-low-level-design.md):

<H>What did the requirements say would vary? Put seams there. Everything else gets modelled concretely, and you refactor when a second reason to change actually appears.</H>

This is why the first step of any LLD problem is asking what is likely to change. <C color="green">Abstraction placed where variation was *stated* is design; abstraction placed everywhere is speculation</C>, and speculative abstraction is a cost paid by every future reader for a benefit that may never arrive.

**The rule of three is a useful discipline.** The first time you need a behaviour, write it directly. The second time, note the duplication. The third time, abstract — because by then you have three examples and can see the actual shape of the variation, rather than guessing it from one.

<C color="crimson">Abstracting from a single example reliably produces the wrong abstraction</C> — one shaped around incidental details of that case, which then has to be reworked when the second case does not fit.

**What interviewers actually assess.** In an LLD round, nobody asks you to recite the principles. They add a requirement and watch how much of your design has to change. <C color="green">SOLID is the vocabulary for *explaining* why your design absorbs the change well</C> — "pricing is behind an interface because you said rates vary by day" — rather than a checklist to satisfy.

A candidate who names the principles while producing a rigid design scores worse than one who never names them and produces a design where the new requirement is one new class.

**A note on where these came from.** The principles were articulated in the context of large, long-lived object-oriented codebases, and they carry assumptions from that setting. In a small script, or in a functional style where data and behaviour are separate, several apply differently or not at all. <C color="orange">Treat them as well-tested heuristics for managing change in OO systems, not as universal laws of software</C> — which is roughly how their author has always described them.

</Depth>

---

## 4. In an interview

- **"Pricing is behind a `PricingStrategy` interface because you said rates vary by day — that's open/closed applied where variation was actually stated."** Names the principle *and* its justification.
- **"Those four switch statements on order type are the open/closed violation. A new type should be a new class, not four edits."** Diagnoses from a symptom.
- **"I'd inject the payment gateway so this is testable without charging a real card."** The practical payoff of dependency inversion.
- **"I've deliberately not abstracted vehicle type — you said there are exactly two and they won't change. Unused abstraction costs every reader."** Restraint, justified.

---

## Rapid-fire recall

1. State each principle as the failure it prevents.
2. What is the one-sentence test for single responsibility, and the subtlety about "reasons to change"?
3. What is the tell-tale symptom of an open/closed violation?
4. Give the Liskov test, and the classic violation.
5. What symptom indicates an interface segregation violation?
6. What is the practical payoff of dependency inversion?
7. Give the over-applied form of each principle.
8. State the calibration question for where to put abstractions.
9. What is the rule of three, and why does abstracting from one example fail?
10. What do interviewers actually assess in an LLD round?

<details>
<summary>Answers</summary>

1. **S** — the god class. **O** — new requirements forcing edits to working code. **L** — inheritance that lies, breaking code written against the parent. **I** — classes implementing methods they do not need. **D** — untestable, unswappable code.
2. Describe it in **one sentence without "and"**. The subtlety: it is about **reasons to change**, not about doing one thing — a class may do several things that all change for the same reason.
3. A **`switch` or `if/else` chain on a type code** that must be extended every time a variant is added — especially the same switch repeated in several methods.
4. **If a subclass throws on a method its parent supports, or demands more from callers than its parent did, it is not a subtype.** Classic violation: `Square extends Rectangle`, where setting width must change height, breaking code written against `Rectangle`.
5. `throw new UnsupportedOperationException()` — a class forced to implement methods that make no sense for it.
6. **Testability** — an object depending on an interface can be given a fake, whereas one constructing its own dependency cannot be tested in isolation.
7. **S**: fifteen files per operation. **O**: abstractions for variations that never arrive. **L**: avoiding inheritance even where a genuine hierarchy exists. **I**: dozens of unnavigable single-method interfaces. **D**: nothing readable without a DI container.
8. <H>What did the requirements say would vary? Put seams there, and model everything else concretely.</H>
9. Write it directly the first time, note the duplication the second, **abstract on the third** — when you have enough examples to see the real shape. Abstracting from one example produces an abstraction shaped around **incidental details of that case**, which breaks when the second case arrives.
10. **How much of your design changes when they add a requirement.** SOLID is the vocabulary for explaining why it absorbed the change — not a checklist. A rigid design with correct terminology scores worse than a flexible one with none.

</details>

---

**Next:** [Design Patterns Worth Knowing](./03-design-patterns.md) — the handful that actually appear.
