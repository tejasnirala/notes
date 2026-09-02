---
title: Event Sourcing and CQRS
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Event Sourcing and CQRS

> **What you will be able to do after this page**
>
> - Explain event sourcing in terms of what it stores instead of current state.
> - Say what CQRS is, and why it is independent of event sourcing.
> - Name the costs that make both a poor default.
> - Recognise the domains where they genuinely earn their complexity.

Two patterns that are frequently confused, frequently combined, and <C color="crimson">frequently adopted by teams who did not need either.</C>

<Plain>

Two ways to keep a bank account.

**Store the balance.** One number. Updating it means overwriting: £500 becomes £400. Simple, and everything except the current number is gone — <C color="crimson">you cannot answer "why is it £400?" or "what was it last Tuesday?"</C>

**Store the transactions.** A list: deposited £1,000, withdrew £300, withdrew £300. The balance is not stored at all — it is **calculated** by adding them up.

The second is how banks actually work, and the reasons are instructive.

**Every question about the past is answerable.** What was the balance in March? Add up everything before April. Why is it £400? Read the list.

**Nothing is ever lost.** With stored balance, a bug that writes the wrong number destroys the truth. With transactions, a bug produces a wrong *calculation* — fix the code, recalculate, and the correct answer returns.

**Corrections are honest.** You do not erase a wrong transaction; you add a reversing one. The record shows what happened *and* that it was corrected.

The costs are equally real. <C color="orange">Getting the balance now requires reading everything</C>, so you keep a running total alongside — and now there are two things that must agree. And a transaction recorded in 1997 must still be interpretable today, so **you can never change what an old entry means.**

</Plain>

---

## 1. Event sourcing

<Jargon
  plain="Storing the sequence of things that happened, and calculating current state from it, instead of storing current state."
  term="event sourcing"
  also={['event store', 'append-only state']}>

The events are the **source of truth**. Current state is a *derived* projection — <C color="orange">it can always be thrown away and rebuilt</C>, which is the property everything else follows from.

</Jargon>

```
  TRADITIONAL                        EVENT SOURCED
  UPDATE orders                      append OrderPlaced
  SET status = 'shipped'             append PaymentCaptured
  WHERE id = 42                      append OrderShipped

  one row, current state             full history; state = fold(events)
  previous states destroyed          nothing ever overwritten
```

| Gain | Cost |
| :--- | :--- |
| <C color="green">Complete audit trail, by construction</C> | <C color="crimson">Reading current state means replaying</C> |
| <C color="green">Time travel — state at any past moment</C> | <C color="crimson">Event schemas can never break</C> |
| <C color="green">Rebuild projections after a bug</C> | <C color="crimson">Storage grows forever</C> |
| <C color="green">New read models from existing history</C> | <C color="crimson">Deleting data is hard (GDPR)</C> |
| <C color="green">Debugging: the exact sequence is recorded</C> | <C color="crimson">Unfamiliar to most developers</C> |

<Trace title="An order, event sourced" subtitle="Watch state being derived rather than stored — and what that unlocks.">

<TraceStep
  title="Events appended"
  state={{ 'Events stored': '3', 'Current state': 'derived', 'Status': 'shipped', 'History available': 'complete' }}
  changed={['Events stored', 'Status']}
  note="Nothing was overwritten. The status is computed, not stored.">

`OrderPlaced(total=4200)` → `PaymentCaptured(4200)` → `OrderShipped(tracking=X)`.

Folding them gives `status = shipped`.

</TraceStep>

<TraceStep
  title="A customer disputes the total"
  cost="answerable"
  state={{ 'Events stored': '3', 'Question': 'why 4200?', 'Answer': 'from the event log', 'History available': 'complete' }}
  changed={['Question', 'Answer']}
  note="With stored state, you would have a number and no explanation — the classic 'why is this field wrong?' with no way to find out.">

<C color="green">The exact sequence, with timestamps and causes, is in the log.</C> No separate audit table, no missing rows.

</TraceStep>

<TraceStep
  title="A bug is found in the projection"
  state={{ 'Events stored': '3', 'Projection': 'wrong', 'Source of truth': 'INTACT', 'Fix': 'rebuild' }}
  changed={['Projection', 'Fix']}
  note="This is the single strongest argument for event sourcing.">

Tax was computed incorrectly in the read model for six months.

<C color="green">The events are untouched.</C> Fix the projection code, delete the read model, replay. The correct data appears — no data-repair migration, no lost information.

</TraceStep>

<TraceStep
  title="A new question arrives"
  state={{ 'Events stored': '3', 'New read model': 'built from history', 'Backfill needed': 'none', 'History available': 'complete' }}
  changed={['New read model', 'Backfill needed']}
  note="With stored state you would only have data from the day you added the column.">

Analytics wants time-to-ship per region. Build a new projection and replay history — <C color="green">the answer covers all of time, not just from today.</C>

</TraceStep>

<TraceStep
  title="Then GDPR arrives"
  cost="the hard problem"
  state={{ 'Events stored': '3', 'Deletion request': 'received', 'Immutable log': 'conflicts', 'Fix': 'crypto-shredding' }}
  changed={['Deletion request', 'Immutable log', 'Fix']}
  note="An append-only log and a legal right to erasure are in direct tension.">

A user requests deletion. <C color="crimson">The log is append-only, and rewriting it destroys the guarantees the whole design rests on.</C>

The standard answer is **crypto-shredding**: encrypt personal data per subject and **delete the key**. The events remain, structurally intact; their personal content becomes permanently unreadable.

<H>Event sourcing makes history indelible — which is exactly what you wanted, until a law requires you to erase it.</H>

</TraceStep>

</Trace>

**Snapshots.** Replaying 100,000 events on every read is impractical, so you periodically store a snapshot and replay only events after it. <C color="orange">Snapshots are a cache, not truth</C> — they must always be discardable and rebuildable.

---

## 2. CQRS

**Command Query Responsibility Segregation:** separate the model you write through from the model you read through.

```
  ┌──────────┐   commands   ┌──────────────┐
  │  Client  │─────────────►│  WRITE model │──┐
  │          │              │  normalized  │  │ events / sync
  │          │   queries    ┌──────────────┐  │
  │          │◄─────────────│  READ models │◄─┘
  └──────────┘              │  denormalized│
                            └──────────────┘
```

<C color="orange">CQRS is independent of event sourcing.</C> You can have either without the other, and conflating them is the most common misconception in this area.

| | |
| :--- | :--- |
| CQRS without event sourcing | <C color="green">Very common</C> — a normalized write DB plus a denormalized read replica or search index |
| Event sourcing without CQRS | Possible, awkward — every read replays events |
| Both together | <C color="green">Natural fit</C> — events feed the read models |

**What CQRS buys:** read and write models optimised independently; reads scale separately; each read model shaped for its screen with no compromise.

**What it costs:** <C color="crimson">the read model is eventually consistent</C>. A user performs an action and queries immediately — and does not see their own change. This produces the [read-your-writes problem](../05-data-at-scale/01-replication.md), and here it is architectural rather than incidental.

<C color="green">Mitigations:</C> return the result from the command so the UI updates optimistically; version the read model so the client can wait for its write to appear; or read from the write model for the acting user immediately after a write.

<Depth title="Why both are usually the wrong default">

Both patterns are legitimate, well-understood, and adopted far more often than justified. The costs are concentrated in places that are invisible at design time.

**Event sourcing's real costs:**

**1. Schema evolution is permanent.** An event written in 2019 must still be interpretable in 2029. You cannot migrate it — rewriting history destroys the guarantee. So you carry **upcasters**: code that translates old event versions into the current shape, accumulating a layer per historical change that can never be deleted.

**2. Querying is genuinely hard.** *"All orders over £500 from last quarter"* is a trivial `SELECT` against a table and a **full replay** against an event log. You must build a projection for every query shape in advance — which means <C color="crimson">a question nobody anticipated cannot be answered without new code and a replay.</C>

**3. Eventual consistency is architectural, not incidental.** Projections lag the write model, so "write then immediately read" does not work by default. Every UI flow must account for it.

**4. It is unfamiliar.** Most developers have not worked this way. Onboarding is slower, mistakes are more common, and library support is thinner than for CRUD. <C color="orange">This is a real engineering cost, not a soft one.</C>

**5. Deletion conflicts with the model.** GDPR and similar rights of erasure sit in direct tension with an immutable log. Crypto-shredding works and must be designed in from the start — retrofitting per-subject encryption across an existing event store is very expensive.

**When event sourcing genuinely earns it:**

| Domain | Why |
| :--- | :--- |
| Finance, ledgers, accounting | Audit is a legal requirement; the domain **is** a list of transactions |
| Trading, order books | Exact sequence matters; replay is needed for analysis |
| Collaborative editing | The document is naturally a sequence of operations |
| Healthcare records | Regulatory history requirements |
| Anything where "how did we get here?" is asked routinely | The answer is free rather than impossible |

<C color="green">The strongest signal: the domain experts already think in events.</C> Accountants do not think about "the current balance" as the primary object — they think in transactions and derive balances. When the business language is already event-shaped, event sourcing removes an impedance mismatch instead of adding one.

<C color="crimson">The strongest counter-signal: a CRUD application where users edit records and nobody has ever asked what a field used to be.</C> There, event sourcing adds every cost and collects no benefit.

**A pragmatic middle ground**, which covers most of what people actually want: keep a normal, mutable current-state table, **and** append an audit/event log alongside it in the same transaction.

- <C color="green">Queries stay simple</C> — normal SQL against normal tables.
- <C color="green">You get the audit trail and the ability to derive new read models.</C>
- <C color="crimson">You lose the guarantee that the log is complete</C>, since state can be changed without an event if someone bypasses the code path.

<H>That trade — most of the benefit, a fraction of the cost, and one weaker guarantee — is the right answer far more often than full event sourcing. Reach for the complete version when the domain is genuinely event-shaped, not because the audit trail sounds appealing.</H>

</Depth>

---

## 3. In a design discussion

- **"CQRS without event sourcing — a normalized write model and a denormalized read model. They're independent patterns."** Corrects the usual conflation.
- **"Event sourcing here because it's a ledger: the domain is already a sequence of transactions, and audit is a legal requirement."** Justifies from the domain, not from the pattern's appeal.
- **"The read model is eventually consistent, so the UI updates optimistically from the command response rather than re-querying."** Handles the consequence.
- **"Crypto-shredding for deletion — encrypt per subject, delete the key. It has to be designed in from the start."** Shows you have thought past the happy path.

---

## Rapid-fire recall

1. What does event sourcing store, and what becomes derived?
2. Why can a projection bug be fixed without a data migration?
3. Why can new read models cover all of history?
4. What is a snapshot, and what must remain true about it?
5. Why do GDPR deletion requests conflict with event sourcing, and what is the standard fix?
6. What is CQRS, and how is it independent of event sourcing?
7. What is CQRS's main cost, and give two mitigations.
8. Why is event schema evolution permanent, and what are upcasters?
9. Why is ad-hoc querying hard, and what does that mean for unanticipated questions?
10. Give the strongest signal for and against event sourcing, and the pragmatic middle ground.

<details>
<summary>Answers</summary>

1. It stores the **sequence of events that happened**. **Current state becomes derived** — computed by folding events — so it can always be discarded and rebuilt.
2. Because the **events are untouched** and are the source of truth. Fix the projection code, delete the read model, and replay — no data-repair migration, and nothing lost.
3. Because the full history is retained, so a new projection replays it from the beginning. With stored current state you would only have data from the day the column was added.
4. A periodically stored materialised state, replayed forward from. It must remain a **cache, never truth** — always discardable and rebuildable from events.
5. The log is **append-only**, and rewriting it destroys the guarantees the design rests on. Standard fix: **crypto-shredding** — encrypt personal data per subject and delete the key, so events remain structurally intact but unreadable.
6. **Separating the write model from the read model.** It is independent because you can have a normalized write DB plus a denormalized read replica **without** event sourcing — which is the most common form of CQRS in practice.
7. The **read model is eventually consistent**, so users may not see their own writes. Mitigations: **return the result from the command** for optimistic UI updates · **version the read model** so the client waits for its write · **read from the write model** for the acting user briefly after a write.
8. Because an old event can never be migrated — rewriting history destroys the guarantee — so it must remain interpretable forever. **Upcasters** are translation layers converting old event versions to the current shape, accumulating permanently.
9. Because there are no tables to query — an arbitrary query means a **full replay**. Projections must be built **in advance per query shape**, so an unanticipated question requires new code plus a replay.
10. **For**: the domain experts already think in events (accountants think in transactions, not balances). **Against**: a CRUD app where nobody has ever asked what a field used to be. **Middle ground**: a normal mutable state table **plus** an event log written in the same transaction — most of the benefit, a fraction of the cost, at the price of the log no longer being guaranteed complete.

</details>

---

**Next:** [Serverless](./04-serverless.md) — paying per request, and what you give up for it.
