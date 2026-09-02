---
title: Service Boundaries
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Service Boundaries

> **What you will be able to do after this page**
>
> - Draw a boundary that does not need a distributed transaction to work.
> - Recognise the three wrong ways to split a system.
> - Use aggregates and bounded contexts to decide what belongs together.
> - Say why the same word means different things in different services — and why that is correct.

If you are splitting a system, <C color="orange">where you cut matters more than whether you cut.</C> A bad boundary produces all the costs of distribution with none of the benefits.

<Plain>

You are dividing a company into departments. There are two ways to do it, and only one works.

**By activity.** One department writes things, another checks things, a third files things. Every piece of work now visits all three, in order, with a handoff each time. <C color="crimson">Nothing can be completed by one department</C>, so any change to how work flows requires all three to agree.

**By outcome.** One department handles everything to do with orders — writing, checking, filing. Another handles everything about deliveries. <C color="green">Most work is completed inside one department</C>, and each can change how it operates without consulting anyone.

The second is obviously better, and here is the test that reveals it: **pick a common task and count how many departments it touches.** One is excellent. Two is normal. <C color="crimson">Four means you divided along the wrong lines.</C>

There is a second, subtler point. Two departments may use the same word for genuinely different things. To sales, a "customer" is someone who might buy — a name, a company, a budget. To support, a "customer" is someone with an account and a history of problems. <C color="orange">Forcing them to share one definition produces something that serves neither well</C> and that neither can change without breaking the other.

Letting each keep its own meaning of the word is not duplication. It is recognising that they are different things that happen to share a name.

</Plain>

---

## 1. The wrong ways to split

**By technical layer.** A "controller service", a "business logic service", a "data access service".

```
  Every feature touches all three. Every change requires three
  deployments in order, coordinated across three teams.
```

<C color="crimson">This is the worst possible split</C> — you have taken a layered monolith and put a network between the layers, gaining latency and failure modes while keeping every coordination cost.

**By entity/table.** A "user service", an "order service", a "product service", one per database table.

This *looks* right and often is not. <C color="crimson">Real operations span entities</C>: placing an order touches user, order, product and inventory. You now need a distributed transaction for a single business action. The tell is a service whose API is `getX`, `createX`, `updateX` — <C color="orange">that is not a service, it is a remote table with extra latency.</C>

**By what a team happens to own.** Boundaries following the org chart at a moment in time, then the org reorganises and the boundaries no longer match anything. Conway's Law says the architecture will mirror the organisation — <C color="green">so the useful move is to organise teams around the domain first</C>, not to freeze whatever structure exists today.

---

## 2. The right way: capabilities and aggregates

<Jargon
  plain="A cluster of data that must always change together, treated as one unit."
  term="an aggregate"
  also={['consistency boundary', 'transactional boundary']}>

From Domain-Driven Design. <C color="green">Inside an aggregate, changes are transactional; across aggregates, they are eventually consistent.</C> This is the single most useful concept for drawing service boundaries, because **an aggregate is the largest thing that never needs a distributed transaction**.

</Jargon>

The procedure that works:

1. **List the business capabilities** — what the business *does*, not what data it stores. "Take an order", "fulfil a delivery", "manage a catalogue".
2. **Find the aggregates** — what must change atomically. An order and its line items. A shopping cart and its contents.
3. **Group aggregates that change together** into one service.
4. **Check the transaction test:** does a common operation need a transaction spanning two services? <C color="crimson">If yes, the boundary is wrong.</C>
5. **Check the chattiness test:** does one operation need many calls between two services? If yes, they probably belong together.

<Trace title="Splitting an e-commerce system" subtitle="Watch the boundaries move as the tests are applied.">

<TraceStep
  title="Attempt 1 — one service per table"
  cost="distributed transaction"
  state={{ 'Services': 'user, order, product, inventory, payment', 'Calls to place an order': '6', 'Needs distributed txn': 'YES', 'Verdict': 'wrong' }}
  changed={['Services', 'Calls to place an order', 'Needs distributed txn', 'Verdict']}
  note="Every service is a remote table. The business operation lives nowhere.">

Placing an order: read user, read product, check inventory, decrement inventory, create order, charge payment.

<C color="crimson">Decrementing inventory and creating the order must be atomic — and they are in different services.</C>

</TraceStep>

<TraceStep
  title="Attempt 2 — group by what changes together"
  state={{ 'Services': 'ordering (order+inventory), catalogue, payments, identity', 'Calls to place an order': '2', 'Needs distributed txn': 'no', 'Verdict': 'much better' }}
  changed={['Services', 'Calls to place an order', 'Needs distributed txn', 'Verdict']}
  note="Order and inventory are one aggregate for this business — you cannot reserve stock and create an order independently.">

Inventory moves in with ordering, because reserving stock and creating an order **must** be atomic.

<C color="green">Placing an order is now one local transaction plus a payment call.</C>

</TraceStep>

<TraceStep
  title="Apply the chattiness test to catalogue"
  state={{ 'Services': 'unchanged', 'Calls to render a listing': '1 + N', 'Verdict': 'needs data, not calls' }}
  changed={['Calls to render a listing', 'Verdict']}
  note="The fix is not to merge the services — it is to stop needing a call per item.">

Rendering search results needs a product name and price per result — <C color="crimson">an N+1 across a service boundary.</C>

Fix: the catalogue publishes product events; ordering keeps a **local read model** of the fields it needs. No call at all.

</TraceStep>

<TraceStep
  title="Payments stays separate — deliberately"
  state={{ 'Services': '4', 'Payment coupling': 'saga', 'Compliance': 'isolated', 'Verdict': 'correct' }}
  changed={['Payment coupling', 'Compliance', 'Verdict']}
  note="Sometimes an isolation requirement outweighs the transactional cost, and that is a valid reason to accept a saga.">

Payment genuinely cannot be atomic with the order — it calls an external provider. It also has PCI isolation requirements.

<C color="green">Accept a saga here</C>: reserve stock, take payment, confirm — with compensation if payment fails.

</TraceStep>

<TraceStep
  title="The finished boundaries"
  state={{ 'Services': 'ordering, catalogue, payments, identity', 'Common ops crossing 3+ services': '0', 'Distributed txns': '1 (unavoidable)', 'Verdict': 'good' }}
  changed={['Common ops crossing 3+ services', 'Distributed txns']}
  note="One saga, deliberately, for a boundary justified by an external dependency and a compliance requirement.">

<H>The test that did the work: does a common operation need a transaction across two services? Every time the answer was yes, the boundary moved — except where an external system made atomicity impossible anyway.</H>

</TraceStep>

</Trace>

---

## 3. Bounded contexts, and the same word twice

<C color="orange">The instinct to build one canonical `User` shared by every service is the most common and most damaging modelling mistake.</C>

```
  IDENTITY context:   User = credentials, MFA, sessions, login history
  BILLING context:    Customer = payment methods, tax id, invoices
  SUPPORT context:    Contact = tickets, satisfaction, contact preferences
  MARKETING context:  Lead = source, campaign, engagement score
```

These are four different concepts that share a person. A shared canonical model becomes:

- **Enormous**, holding the union of every context's fields.
- <C color="crimson">**Impossible to change**</C>, because every service depends on it.
- **Wrong everywhere** — every context carries dozens of fields it does not use, and each field's meaning is subtly contextual.

<C color="green">The right approach: each context has its own model, linked by a shared identifier.</C> Billing's `Customer` has a `user_id` referencing identity's `User`, and nothing else about them.

<H>A shared canonical model recreates the coupling you split the system to remove. Duplicate the concept, share the identifier.</H>

<Depth title="Coupling, cohesion, and the tests that expose a bad boundary">

**The two properties that define a good boundary:**

**High cohesion** — things inside change together for the same reasons. **Low coupling** — things across change independently.

They pull in the same direction: put things that change together on the same side of the line, and things that change independently on opposite sides. <C color="orange">Note that this is about **reasons to change**, not similarity.</C> Two entities can look alike and change for entirely different reasons, and they do not belong together.

**Four diagnostic tests, in order of usefulness:**

**1. The transaction test.** Does a common business operation require atomicity across two services? <C color="crimson">If yes, the boundary is wrong</C> — you have split an aggregate. This is the strongest single signal, and it is the one to check first.

**2. The chattiness test.** Does one user action produce many calls between two services? Latency compounds and failure probability multiplies. Either merge them, or replicate the needed data locally via events.

**3. The lockstep-deploy test.** Do these two services always have to deploy together? <C color="crimson">Then they are one service with a network between them</C> — the definition of a distributed monolith. Check your last twenty releases; if two services appear together every time, the boundary is fictional.

**4. The single-team test.** Can one team own this service end to end, including its on-call? A service requiring three teams to change anything meaningful is not a service, it is a shared library with worse ergonomics.

**A boundary that passes all four is probably right. Failing the first is disqualifying.**

**On data ownership.** Every piece of data must have exactly one **owning** service — the only one that writes it. Others may hold read-only copies, kept current by events.

<C color="crimson">Two services writing the same table is the single worst violation available.</C> You have all the costs of distribution and none of the isolation: neither team can change the schema, neither can reason about concurrent writes, and the database becomes a hidden coupling that no architecture diagram shows.

**On getting it wrong**, which you will. Boundaries chosen before you understand the domain are usually wrong, and that is normal — the domain is not fully known at the start.

<C color="green">This is the strongest argument for starting with a [modular monolith](./01-monolith-and-microservices.md):</C> moving a boundary is a refactor when everything is in one deployable, and a migration project once it is distributed. Get the boundaries wrong cheaply, learn, and only distribute the ones that have proven stable.

The signal that a boundary has settled: <H>it has survived several rounds of feature work without needing to move. Distribute boundaries that have earned it, not boundaries you hope are right.</H>

</Depth>

---

## 4. Practical guidance

**Name services after capabilities, not entities.** `ordering`, not `order-service`. A capability name suggests behaviour; an entity name suggests a table.

**Boundaries follow the domain, then teams follow boundaries.** Conway's Law means the architecture will mirror the organisation — so shape the organisation around the domain deliberately, rather than letting an accidental org chart shape the architecture.

**Prefer fewer, larger services.** The cost of a boundary is high and the cost of a large module is low. <C color="green">Merging two services later is far easier than splitting one</C>, so err toward too few.

**Replicate read data; never share write access.** A service needing another's data should keep a local read model fed by events, not query its database.

**Watch for boundaries that never change independently.** If two services always ship together, delete the boundary.

---

## 5. In a design discussion

- **"Inventory lives with ordering — reserving stock and creating an order must be atomic, and splitting them would force a saga on the hot path."** The transaction test, applied.
- **"No shared `User` model. Identity owns authentication, billing owns its own customer concept, joined by user id."** Bounded contexts, correctly.
- **"If those two always deploy together, they are one service with a network between them."** The distributed-monolith tell.
- **"I'd keep this in the monolith until the boundary has survived a few rounds of feature work — moving it later is a refactor, not a migration."** Sequencing that shows judgement.

---

## Rapid-fire recall

1. Why is splitting by technical layer the worst option?
2. Why does one-service-per-table often fail, and what is the tell?
3. Define an aggregate and say why it is the key concept for boundaries.
4. Give the five-step procedure for finding boundaries.
5. In the e-commerce trace, why did inventory move in with ordering?
6. What fixed the catalogue chattiness, and why was merging not the answer?
7. Why is a shared canonical `User` model harmful, and what replaces it?
8. Give the four diagnostic tests, and say which is disqualifying.
9. Why is two services writing one table the worst violation?
10. Why start with a modular monolith, and what signals a boundary is ready to distribute?

<details>
<summary>Answers</summary>

1. Because **every feature touches every layer**, so each change needs coordinated deploys across all of them. You get the latency and failure modes of distribution while keeping every coordination cost.
2. Because **real operations span entities** — placing an order touches user, order, product and inventory — forcing a distributed transaction for one business action. The tell is a service whose API is `getX`/`createX`/`updateX`: **a remote table, not a service**.
3. A cluster of data that **must change together atomically**. It matters because it is **the largest thing that never needs a distributed transaction** — so aggregate boundaries are natural service boundaries.
4. List **business capabilities** → find the **aggregates** → **group aggregates that change together** → apply the **transaction test** → apply the **chattiness test**.
5. Because **reserving stock and creating an order must be atomic**. Split, that would require a distributed transaction on the most common operation in the system.
6. The catalogue **publishes product events** and ordering keeps a **local read model** of the fields it needs, eliminating the per-item call. Merging was not the answer because the services genuinely change for different reasons — only the *data access* was wrong.
7. It becomes enormous (the union of every context's fields), **impossible to change** (every service depends on it), and wrong everywhere. Replace it with a **model per bounded context**, linked by a shared identifier.
8. **Transaction test** (disqualifying — a shared transaction means a split aggregate) · **chattiness test** · **lockstep-deploy test** · **single-team test**.
9. Because neither team can change the schema or reason about concurrent writes, and the database becomes a **hidden coupling no architecture diagram shows** — all the costs of distribution with none of the isolation.
10. Because moving a boundary is a **refactor** in one deployable and a **migration project** once distributed. A boundary is ready when it has **survived several rounds of feature work without moving**.

</details>

---

**Next:** [Event Sourcing and CQRS](./03-event-sourcing-and-cqrs.md) — storing what happened instead of what is.
