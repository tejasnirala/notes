---
title: Design Patterns Worth Knowing
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Design Patterns Worth Knowing

> **What you will be able to do after this page**
>
> - Recognise the six or seven patterns that actually appear in LLD rounds.
> - Reach for one because a problem calls for it, not because you know its name.
> - Say what each costs, since none is free.
> - Recognise the patterns that are usually a mistake.

There are twenty-three classic patterns and <C color="orange">perhaps seven you will genuinely use.</C> Knowing which seven, and when, matters far more than being able to recite the catalogue.

<Plain>

A workshop accumulates a handful of standard arrangements — ways of organising work that keep coming up.

*"When the job varies by customer, keep the varying step on a swappable card."* *"When several people need telling that something finished, keep a list and notify it."* *"When building something has many optional parts, use a step-by-step form rather than a forty-argument order slip."*

These are not rules. They are <C color="green">names for arrangements experienced people arrive at anyway</C>, and the value of the name is that two people can discuss the arrangement without describing it from scratch.

The failure mode is treating the catalogue as a checklist. Someone learns the arrangements and starts applying them to jobs that did not need them — <C color="crimson">a swappable card for a step that will never vary, a notification list with one subscriber that will always be one.</C>

<H>A pattern applied where the problem does not exist is pure cost: indirection every reader must follow, for flexibility nobody will use.</H>

</Plain>

---

## 1. The ones that actually appear

### Strategy — swap an algorithm

The single most useful pattern in LLD rounds, because *"this varies"* is the most common requirement.

```java
interface PricingStrategy { Money calculate(Duration d, SpotType t); }

class HourlyPricing  implements PricingStrategy { … }
class WeekendPricing implements PricingStrategy { … }

class ParkingLot {
    private final PricingStrategy pricing;   // injected, swappable
}
```

<C color="green">Use when:</C> a behaviour varies and the variants are known kinds of the same thing.
<C color="orange">Costs:</C> one interface and one class per variant.

### Factory — centralise construction

<C color="green">Use when:</C> deciding *which* class to instantiate is itself logic — from a type code, a config value, or input.
<C color="crimson">Do not use when:</C> there is one implementation. `new Thing()` is fine and clearer.

### Observer — notify without coupling

```java
subject.subscribe(emailNotifier);
subject.subscribe(auditLogger);
// subject calls notify(event) — it does not know who is listening
```

<C color="green">Use when:</C> several parties must react to an event and the source should not know them.
<C color="crimson">Costs:</C> the flow becomes implicit — the same [comprehension cost](../08-async-and-events/05-event-driven-architecture.md) as event-driven architecture, in miniature. Also a real memory-leak source when subscribers are never unsubscribed.

### State — behaviour that changes with state

<C color="green">Use when:</C> an object behaves differently by state and the transitions are non-trivial — a vending machine, an order lifecycle, a connection.

<C color="green">The tell you need it:</C> methods full of `if (state == X)`, repeated in several places. State makes each state a class that knows its own valid transitions, so invalid transitions become impossible rather than merely checked.

### Builder — construct something complex

<C color="green">Use when:</C> an object has many optional parameters and a constructor with eight arguments has become unreadable.

<C color="crimson">Do not use when:</C> there are three fields. It is boilerplate for no gain.

### Singleton — exactly one instance

<C color="crimson">The most over-used and most often wrong.</C> It is a global variable with a respectable name: it hides dependencies, makes testing hard (you cannot substitute it), and creates thread-safety problems.

<C color="green">If you genuinely need one instance, inject it</C> — construct it once at startup and pass it in. The object gets its single instance; callers keep their testability.

### Adapter — make an incompatible interface fit

<C color="green">Use when:</C> integrating a third-party library whose interface does not match yours, or isolating your domain from an external API. <C color="green">Also excellent for testability</C>, since the adapter is the seam where a fake goes.

---

## 2. Choosing by symptom

<Trace title="Extending a parking lot design" subtitle="Each new requirement, and the pattern the symptom points to.">

<TraceStep
  title="'Pricing differs on weekends'"
  state={{ 'Symptom': 'a behaviour varies by rule', 'Pattern': 'Strategy', 'Cost': 'one interface + classes', 'Alternative': 'if/else in one method' }}
  changed={['Symptom', 'Pattern', 'Cost']}
  note="The classic Strategy trigger — a named, swappable variation stated in the requirements.">

<C color="green">`PricingStrategy` with implementations per rule.</C>

</TraceStep>

<TraceStep
  title="'A ticket changes as the car parks, pays, leaves'"
  state={{ 'Symptom': 'if (status ==) repeated everywhere', 'Pattern': 'State', 'Cost': 'a class per state', 'Benefit': 'invalid transitions impossible' }}
  changed={['Symptom', 'Pattern', 'Cost', 'Benefit']}
  note="Status checks scattered across methods is the reliable signal.">

Each state becomes a class knowing its own legal transitions — <C color="green">so "pay an already-paid ticket" is structurally impossible rather than caught by a check someone might forget.</C>

</TraceStep>

<TraceStep
  title="'Display boards must update when a spot frees'"
  state={{ 'Symptom': 'several parties react to an event', 'Pattern': 'Observer', 'Cost': 'implicit flow, leak risk', 'Alternative': 'direct calls' }}
  changed={['Symptom', 'Pattern', 'Cost']}
  note="With one subscriber that will always be one, a direct call is simpler and clearer.">

<C color="orange">Justified only if there are genuinely several independent listeners.</C>

</TraceStep>

<TraceStep
  title="'Support electric spots with charging'"
  cost="no pattern needed"
  state={{ 'Symptom': 'a new kind of spot', 'Pattern': 'none — a subclass or field', 'Cost': 'minimal', 'Verdict': 'do not over-engineer' }}
  changed={['Symptom', 'Pattern', 'Cost', 'Verdict']}
  note="Not everything needs a pattern. A new spot type is a new type.">

<C color="green">Sometimes the answer is a new class and nothing else.</C>

</TraceStep>

<TraceStep
  title="The interviewer's real question"
  state={{ 'Asked': 'add a requirement', 'Watching': 'how much changes', 'Good outcome': '1–2 classes touched', 'Pattern names': 'incidental' }}
  changed={['Asked', 'Watching', 'Good outcome', 'Pattern names']}
  note="Naming the pattern is how you explain the design — it is not what is being scored.">

<H>Patterns are the vocabulary for explaining why a change was cheap. Reaching for one where no variation was stated is the failure the interviewer is watching for just as carefully.</H>

</TraceStep>

</Trace>

---

## 3. The ones to be careful with

<Depth title="Patterns that are usually a mistake, and what to use instead">

**Singleton.** Covered above and worth repeating because it is the most common misuse in interviews. <C color="crimson">It is a global variable, and its problems are the problems of global variables:</C> hidden dependencies (a class's true requirements are invisible from its constructor), untestable code (no substitution point), thread-safety complications, and unclear initialisation order.

<C color="green">Instead:</C> create one instance at composition root and inject it. You get "exactly one" without any of the costs.

**Abstract Factory.** A factory that produces factories. Occasionally right for genuinely swappable **families** of related objects — a cross-platform UI toolkit is the classic case. <C color="crimson">In an interview it is almost always over-engineering</C>, and it is a common signal of pattern-recall rather than judgement.

**Visitor.** Solves a real problem — adding operations to a type hierarchy without modifying the types. <C color="crimson">The double-dispatch machinery is heavy and unfamiliar</C>, and it makes adding a new *type* expensive (every visitor must change), which is usually the more likely direction of change. Rarely worth it unless the hierarchy is genuinely stable and operations are added often.

**Template Method.** An abstract base class defining a skeleton with subclass hooks. Works, and it uses inheritance where <C color="green">Strategy would use composition</C> — usually preferable, since it avoids the tight coupling of inheritance and allows the varying behaviour to be swapped at runtime.

**Deep inheritance hierarchies generally.** Three or more levels is a signal to reconsider. <C color="crimson">Inheritance is the strongest coupling available</C> — a subclass depends on its parent's internals and cannot vary independently. Composition is nearly always the better default, and "favour composition over inheritance" is the single most reliable rule in this area.

**On patterns as language rather than machinery.** Their original value was **shared vocabulary** — saying "use a strategy here" conveys a whole arrangement in three words. That value is entirely preserved when you use the name to *describe* what you built.

<C color="orange">Some patterns have also been absorbed into languages.</C> Strategy in a language with first-class functions is often just passing a function. Iterator is built in. Singleton is a module-level value. <H>The pattern's *idea* survives; its ceremony frequently does not, and reproducing the 1994 class diagram in a language that has closures is a sign of learning the catalogue rather than the concept.</H>

**The honest summary for an interview.** Know Strategy, Factory, Observer, State, Builder and Adapter well enough to use them without thinking. Know why Singleton is usually wrong. Know the names of the rest so you recognise them. <C color="green">And apply them only where the requirements stated a variation</C> — because the same interviewer who rewards a well-placed Strategy will mark down an `AbstractVehicleFactoryProvider` for a problem with two vehicle types.

</Depth>

---

## 4. Quick reference

| Symptom | Pattern |
| :--- | :--- |
| A behaviour varies by rule | <C color="green">Strategy</C> |
| Choosing which class to build is logic | <C color="green">Factory</C> |
| Several parties react to an event | <C color="green">Observer</C> |
| `if (state == …)` repeated in several methods | <C color="green">State</C> |
| A constructor with eight arguments | <C color="green">Builder</C> |
| A third-party interface does not fit | <C color="green">Adapter</C> |
| "There must be only one" | <C color="crimson">Inject a single instance — not Singleton</C> |
| Adding a variant edits a switch | <C color="green">Polymorphism</C> (often Strategy or State) |

---

## Rapid-fire recall

1. Roughly how many of the classic patterns actually appear, and which?
2. What is Strategy's trigger, and what does it cost?
3. When is Factory unnecessary?
4. What are Observer's two hidden costs?
5. What symptom points to State, and what does it make impossible?
6. Why is Singleton usually wrong, and what replaces it?
7. Why is Strategy generally preferable to Template Method?
8. Why does Visitor make adding a new type expensive?
9. What happens to several patterns in languages with first-class functions?
10. What is the failure interviewers watch for as closely as rigidity?

<details>
<summary>Answers</summary>

1. About **seven**: **Strategy, Factory, Observer, State, Builder, Adapter**, plus knowing why **Singleton** is usually wrong.
2. A **behaviour that varies by rule**, with variants that are kinds of the same thing. Costs **one interface plus one class per variant**.
3. When there is **only one implementation** — `new Thing()` is simpler and clearer, and a factory adds indirection for no decision.
4. **The flow becomes implicit** — you cannot read what happens on an event without finding every subscriber — and **memory leaks** when subscribers are never unsubscribed.
5. **`if (state == X)` repeated across several methods.** It makes **invalid transitions structurally impossible**, since each state class knows only its own legal transitions, rather than relying on a check someone might omit.
6. Because it is a **global variable with a respectable name** — hidden dependencies, no substitution point for tests, thread-safety issues, unclear initialisation. Replace with **one instance created at startup and injected**.
7. Because Template Method uses **inheritance** (the tightest coupling, fixed at compile time) where Strategy uses **composition** — which allows swapping behaviour at runtime and avoids depending on a parent's internals.
8. Because **every existing visitor must be modified** to handle the new type. It optimises for adding operations, at the cost of making the more common change — adding a type — expensive.
9. Their **ceremony largely disappears** — Strategy becomes passing a function, Iterator is built in, Singleton is a module value. The **idea survives**; reproducing the original class diagram signals learning the catalogue rather than the concept.
10. **Over-application** — reaching for a pattern where no variation was stated. An `AbstractVehicleFactoryProvider` for two vehicle types is marked down as readily as a rigid design.

</details>

---

**Next:** [Design a Parking Lot](./04-parking-lot.md) — the canonical LLD problem.
