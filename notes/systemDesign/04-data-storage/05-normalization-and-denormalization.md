---
title: Normalization & Denormalization
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Normalization & Denormalization

> **What you will be able to do after this page**
>
> - State the one question that decides whether a fact should be stored in one place or many.
> - Name the three anomalies normalization exists to prevent.
> - Denormalize deliberately, with a plan for keeping copies correct.
> - Tell a *cached copy* from a *historical record* — the distinction that decides most schema arguments.

Normalization is taught as a set of numbered rules, which makes it feel academic. <C color="orange">It is really one idea: every fact should live in exactly one place, because a fact stored twice will eventually disagree with itself.</C>

<Plain>

You keep a notebook of everyone you know. For each person you write their name, phone number, and the address of the office they work at.

Forty of your contacts work at the same company. You have written that company's address forty times.

Then the company moves.

Now you must find and correct forty entries. Miss three, and your notebook contains two different addresses for the same building — and nothing tells you which is right. You have to go back to the source to find out.

The obvious fix is a second list: companies and their addresses, written once. Each person's entry just says *"works at Acme"*. When Acme moves, you change **one** line and every contact is instantly correct.

That is **normalization**, and its whole purpose is to make disagreement impossible.

Now the twist, because otherwise the answer would always be obvious. Looking up someone's work address now takes **two lookups** — find the person, then find their company. For forty contacts checked all day long, those extra lookups add up. Sometimes you deliberately write the address next to the name anyway, accepting the update problem, because the reading is what you do constantly.

<C color="orange">That deliberate duplication is **denormalization**</C> — and the skill is knowing when copying is a shortcut worth taking and when it is a bug waiting to happen.

</Plain>

---

## 1. The three anomalies

Normalization exists to prevent three specific failures. Everything else is bookkeeping.

Take a deliberately bad table:

```
  employees
  ┌────┬───────┬─────────────┬──────────────────────┬─────────┐
  │ id │ name  │ dept_name   │ dept_address         │ dept_id │
  ├────┼───────┼─────────────┼──────────────────────┼─────────┤
  │ 1  │ Ana   │ Engineering │ 12 Bridge St         │ 7       │
  │ 2  │ Raj   │ Engineering │ 12 Bridge St         │ 7       │
  │ 3  │ Kim   │ Engineering │ 12 Bridge Street     │ 7       │  ← already diverged
  └────┴───────┴─────────────┴──────────────────────┴─────────┘
```

**Update anomaly.** The department moves. You must update every employee row. <C color="crimson">Miss one and the database now holds two contradictory answers, with no way to tell which is correct.</C> Row 3 shows this has already begun.

**Insertion anomaly.** A new department exists but has no employees yet. <C color="crimson">There is nowhere to put it</C> — you would have to invent a fake employee row.

**Deletion anomaly.** The last employee of a department leaves. Deleting the row <C color="crimson">also deletes the only record that the department exists</C>. You lost a fact you never intended to touch.

<H>All three come from one cause: a single table storing facts about two different things. Split it, and all three disappear at once.</H>

```
  employees                    departments
  ┌────┬───────┬─────────┐     ┌────┬─────────────┬──────────────┐
  │ id │ name  │ dept_id │────►│ id │ name        │ address      │
  ├────┼───────┼─────────┤     ├────┼─────────────┼──────────────┤
  │ 1  │ Ana   │ 7       │     │ 7  │ Engineering │ 12 Bridge St │
  │ 2  │ Raj   │ 7       │     └────┴─────────────┴──────────────┘
  └────┴───────┴─────────┘      one row, one fact, one place to change
```

<Jargon
  plain="Organising tables so each fact is stored exactly once."
  term="normalization"
  also={['normal forms', '3NF', 'normalizing a schema']}>

The **normal forms** (1NF, 2NF, 3NF, BCNF) are progressively stricter rules for achieving this. <C color="green">In practice, "in 3NF" is what people mean by "properly normalized"</C>, and reaching it follows from one habit: never store a fact that depends on something other than the row's primary key.

</Jargon>

<Depth title="The normal forms, stated as the problem each one fixes">

The formal definitions are precise and unmemorable. Each form is more usefully understood as banning one specific mistake.

**1NF — no repeating groups.** Every column holds a single atomic value; no comma-separated lists, no `phone1, phone2, phone3` columns.
*The problem it fixes:* you cannot query, index or constrain values buried inside a string. `WHERE phones LIKE '%555%'` is not a search, it is a scan with false positives.
*The modern caveat:* JSON and array columns technically violate 1NF and are often <C color="green">the right choice</C> for genuinely non-relational sub-data. The test is whether you ever need to query, join or constrain the inner values individually.

**2NF — no partial dependency on a composite key.** If the primary key is `(order_id, product_id)`, every non-key column must depend on **both**, not one.
*The problem it fixes:* storing `order_date` in `order_items` means repeating it for every line of the order, and one line can end up disagreeing with the others about when the order was placed.

**3NF — no transitive dependency.** No non-key column may depend on another non-key column.
*The problem it fixes:* the department example above. `dept_address` depends on `dept_name`, not on the employee. That is precisely the shape that produces all three anomalies.

**BCNF — every determinant is a candidate key.** A stricter 3NF, catching a rare case involving overlapping candidate keys.
*The problem it fixes:* mostly theoretical for typical business schemas; worth knowing the name exists.

**4NF and 5NF — multi-valued and join dependencies.** Genuinely rare in practice.

**The working shortcut**, which gets you to 3NF without consulting the definitions:

> <H>Every non-key column must describe **the thing the primary key identifies** — the whole key, and nothing but the key. If a column describes something else, it belongs in that something else's table.</H>

Applied to the example: does `dept_address` describe *this employee*? No — it describes their department. So it belongs in `departments`. That single question resolves the overwhelming majority of real schema decisions, without ever naming a normal form.

</Depth>

---

## 2. Denormalizing on purpose

Normalization optimises for **correct writes**. Denormalization trades some of that for **fast reads**. On a [read-heavy system](../01-foundations/02-requirements-and-constraints.md) — and most systems are — that trade is often correct.

The forms it takes, from cheapest to most invasive:

| Technique | Example | Cost |
| :--- | :--- | :--- |
| **Copy a column** | Put `author_name` on `posts` | Must update when the author renames |
| **Store a computed aggregate** | `comment_count` on `posts` | Must maintain on every comment insert/delete |
| **Precompute a whole view** | A materialised timeline per user | Storage, plus a rebuild path |
| **Embed a child collection** | Line items inside an order document | The children can no longer be queried across parents |

### The question that decides it

<H>Is this copy a cache of the current truth, or is it a record of what was true at a moment in time?</H>

This single distinction settles most schema arguments, and it is worth being explicit about because the two look identical in a table.

```
  order_items.price_at_purchase        ← a HISTORICAL RECORD.
                                          It must NOT change when the product's
                                          price changes. This is not duplication —
                                          it is a different fact.

  posts.author_name                    ← a CACHE of users.name.
                                          It MUST change when the user renames.
                                          This IS duplication, and it needs a
                                          maintenance plan.
```

<C color="green">A historical record needs no synchronisation, because it was never meant to track the source.</C> Storing the price at purchase is not denormalization at all — it is recording a genuinely separate fact that happens to have started as a copy.

<C color="crimson">A cache needs a maintenance plan, and "we'll remember to update it" is not one.</C>

### Watch a denormalized copy go stale

<Trace title="An author changes their display name" subtitle="posts.author_name was copied in to avoid a join. Watch what it costs.">

<TraceStep
  title="The schema, as designed"
  state={{ 'Posts by this author': '12,000', 'Rows to change': '—', 'Read cost': '1 query, no join', 'Data correct': 'yes' }}
  note="The denormalization is doing its job: the feed query needs no join at all.">

`posts` carries `author_id` **and** `author_name`. The feed renders 20 posts with one query and zero joins.

</TraceStep>

<TraceStep
  title="The user renames themselves"
  cost="12,000 rows now stale"
  state={{ 'Posts by this author': '12,000', 'Rows to change': '12,001', 'Read cost': '1 query, no join', 'Data correct': 'NO' }}
  changed={['Rows to change', 'Data correct']}
  note="One logical change became twelve thousand physical ones. This is write amplification from denormalization.">

`UPDATE users SET name = 'Ana Ruiz' WHERE id = 42`.

<C color="crimson">Every one of their 12,000 posts still displays the old name.</C>

</TraceStep>

<TraceStep
  title="Option A — update synchronously"
  cost="slow write"
  state={{ 'Posts by this author': '12,000', 'Rows to change': '0', 'Read cost': '1 query, no join', 'Data correct': 'yes' }}
  changed={['Rows to change', 'Data correct']}
  note="Correct, and the user waits. Worse for a celebrity with 5 million posts — which is where this design breaks.">

Update `users` and all 12,000 posts in one transaction. Correct, <C color="orange">but the rename now takes seconds and holds locks the whole time</C>.

</TraceStep>

<TraceStep
  title="Option B — update asynchronously"
  cost="temporary inconsistency"
  state={{ 'Posts by this author': '12,000', 'Rows to change': '0 (after ~30 s)', 'Read cost': '1 query, no join', 'Data correct': 'eventually' }}
  changed={['Rows to change', 'Data correct']}
  note="The usual production answer — and it requires you to have decided that a stale name for 30 seconds is acceptable.">

The rename commits immediately; a background job fixes the posts. <C color="green">The write is fast and the data converges.</C>

Now you own a job that can fail, and you need a way to detect and repair copies it missed.

</TraceStep>

<TraceStep
  title="Option C — do not denormalize this column"
  cost="1 join per read"
  state={{ 'Posts by this author': '12,000', 'Rows to change': '1', 'Read cost': '1 query + join', 'Data correct': 'always' }}
  changed={['Rows to change', 'Read cost', 'Data correct']}
  note="Twenty posts joined to twenty users, by primary key, from a cached page. Often under a millisecond.">

Join `posts` to `users` at read time. The rename touches **one row** and every post is instantly correct.

<H>The join you were avoiding costs perhaps 0.3 ms. The denormalization cost a background job, a repair path, and a class of bug where two posts show different names for the same person. Measure before assuming the copy was worth it.</H>

</TraceStep>

</Trace>

---

## 3. Keeping copies correct

If you do denormalize, pick a synchronisation strategy deliberately. There are four, and the difference between them is real.

| Strategy | How | Good for |
| :--- | :--- | :--- |
| **Same transaction** | Update source and copies together | Small fan-out; correctness critical |
| **Background job** | Commit the source, fix copies asynchronously | Large fan-out; brief staleness acceptable |
| **Database trigger** | The database maintains the copy | <C color="orange">Correct but invisible — logic hidden from application developers</C> |
| **Change data capture** | Read the WAL, publish changes, update copies | Large systems; also feeds search indexes and caches |
| **Rebuild periodically** | Recompute from source on a schedule | Aggregates that tolerate lag |

Whichever you pick, <C color="green">you also need a **reconciliation** path</C> — a job that compares copies against the source and reports drift. Copies *will* drift: a job fails, a deploy interrupts a batch, someone runs a manual `UPDATE`. A system with denormalized data and no way to detect drift will accumulate silent corruption over years.

### Counters deserve special care

`comment_count` on a post is the most common denormalization, and the most commonly broken one.

```sql
-- WRONG: read-modify-write, loses updates under concurrency
count = SELECT comment_count FROM posts WHERE id = 9;
UPDATE posts SET comment_count = count + 1 WHERE id = 9;

-- RIGHT: atomic, safe at any isolation level
UPDATE posts SET comment_count = comment_count + 1 WHERE id = 9;
```

The first is exactly the [lost update](./04-transactions-and-isolation.md) anomaly. And even the correct version has a scaling limit: <C color="crimson">every comment on a popular post contends on the same row</C>. At high write rates you need sharded counters — N rows summed on read — or an approximate counter in Redis reconciled periodically.

---

## 4. Choosing, in practice

**Start normalized.** It is easier to denormalize later than to reconstruct facts you overwrote. Normalization loses no information; denormalization can.

**Denormalize in response to a measured problem.** A join that shows up in a slow-query log, not one you imagine will be slow. <C color="orange">Joins on indexed foreign keys are fast</C> — often far faster than developers expect.

**Prefer other tools first.** A materialised view, a covering index, or a cache often gives you the read speed without putting duplicated data in your schema permanently. A [covering index](./02-indexes-and-query-plans.md) in particular is denormalization that the database maintains for you, correctly, automatically.

**Write down why.** A denormalized column with no comment is indistinguishable from a mistake. Six months later nobody knows whether `author_name` is meant to track `users.name` or preserve a historical value — and the answer changes what the correct behaviour is.

| Situation | Approach |
| :--- | :--- |
| Transactional system, moderate reads | <C color="green">Normalized</C> |
| Read-heavy, joins measured as the bottleneck | <C color="green">Selective denormalization</C> |
| Analytics / reporting | <C color="green">Denormalized (star schema)</C> — written once, read many ways |
| Document store | <C color="green">Denormalized by nature</C> — embed what is read together |
| Historical accuracy required | <C color="green">Copy the value</C> — it is a separate fact, not duplication |

---

## 5. In a design discussion

- **"Normalized to 3NF, then denormalize where the read path proves it's needed. It's easier to copy a column later than to recover a fact you overwrote."** States the default and the direction of travel.
- **"`price_at_purchase` is a historical record, not a cache — it must not change when the product's price does."** The distinction that shows real schema experience.
- **"`author_name` on posts costs a background job and a reconciliation path. I'd measure the join first — twenty primary-key lookups is well under a millisecond."** Prices the denormalization properly.
- **"Any denormalized copy needs a drift-detection job. Copies always diverge eventually."** Operational maturity.

---

## Rapid-fire recall

1. Name the three anomalies, with an example of each.
2. What single cause produces all three, and what fixes them at once?
3. Give the working shortcut that gets you to 3NF without naming a normal form.
4. When is a JSON column the right choice despite violating 1NF?
5. State the question that decides whether a copied column is legitimate.
6. Why is `price_at_purchase` not really denormalization?
7. In the rename trace, what did the denormalized `author_name` cost, and what was the join worth?
8. Name four strategies for keeping denormalized copies in sync.
9. Why does every denormalized system also need reconciliation?
10. Why is `SET count = count + 1` correct where read-then-write is not — and what limit does it still have?

<details>
<summary>Answers</summary>

1. **Update** — a department moves and you must change every employee row; miss one and the data contradicts itself. **Insertion** — a new department with no employees has nowhere to be stored. **Deletion** — removing the last employee also erases the department's existence.
2. One table storing facts about **two different things**. Splitting it into separate tables removes all three simultaneously.
3. <H>Every non-key column must describe the thing the primary key identifies — the whole key and nothing but the key.</H> If it describes something else, it belongs in that thing's table.
4. When the inner values are **never queried, joined or constrained individually** — genuinely non-relational sub-data such as a settings blob or an event payload. If you ever need `WHERE` on an inner field, it should be a column.
5. <C color="orange">Is this a **cache of current truth** (must be kept in sync) or a **record of what was true at a moment** (must not change)?</C>
6. Because it records a **genuinely different fact** — the price at the time of purchase — which is not supposed to track the product's current price. It began as a copy but was never intended to stay synchronised.
7. It cost a background job, a repair path, temporary inconsistency, and a bug class where two posts show different names for one person. The join it avoided was ~**0.3 ms** — twenty primary-key lookups against a cached page.
8. **Same transaction** · **background job** · **database trigger** · **change data capture** (or periodic rebuild).
9. Because copies **will** drift — a job fails, a deploy interrupts a batch, someone runs a manual `UPDATE`. Without a job that compares copies to their source and reports differences, corruption accumulates silently.
10. Read-then-write is a **lost update** race: two transactions read the same value and both write the same increment, losing one. `count = count + 1` is evaluated atomically by the database under a row lock. It still contends on **one row**, so a very popular post needs sharded counters (N rows summed on read) or an approximate counter reconciled periodically.

</details>

---

**Next:** [Object & Blob Storage](./06-object-storage.md) — where the big things go, and why they never belong in a database.
