---
title: MongoDB
---

# MongoDB

A complete path from *what is a document* to *why is my shard key wrong* — written so that someone with a few years of MERN experience can read it end to end and walk into an interview without needing another source.

Every concept page ends with **rapid-fire recall** questions. Every practice question includes a **stage-by-stage trace** showing exactly what the documents look like after each stage of the pipeline.

---

## 📚 The curriculum

### Foundations — how MongoDB thinks

| | Page | What it answers |
| :-- | :--- | :--- |
| 1 | **[The Document Model & BSON](./01-document-model.md)** | Why documents instead of rows, what BSON buys you, ObjectId internals, the missing-vs-null trap, WiredTiger |
| 2 | **[CRUD Deep Dive](./02-crud-deep-dive.md)** | Cursors, every update operator, the three array positional operators, atomic writes without transactions |
| 3 | **[Data Modeling & Schema Design](./03-data-modeling.md)** | Embed vs reference, the six schema patterns, anti-patterns, a design interview worked end to end |
| 4 | **[Indexes & Query Performance](./04-indexes-and-performance.md)** | The ESR rule, reading `explain()`, covered queries, and when *not* to index |

### Aggregation — the pipeline, traced

| | Page | What it answers |
| :-- | :--- | :--- |
| 5 | **[Aggregation Fundamentals](./05-aggregation-fundamentals.md)** | Every core stage traced document by document, stage vs expression, `$$ROOT`/`$$REMOVE`, optimiser rewrites |
| 6 | **[Aggregation Stages Reference](./06-aggregation-stages.md)** | `$facet`, `$bucket`, `$graphLookup`, `$setWindowFields`, `$merge` — each with a worked trace |
| 7 | **[Operators Reference](./07-operators-reference.md)** | Every query and expression operator with a runnable example and its result |

### Practice — 32 questions, fully traced

| | Page | Covers |
| :-- | :--- | :--- |
| 8 | **[Beginner (Q1–8)](./08-beginner-aggregation.md)** | `$match`, `$project`, `$group`, `$lookup`, `$unwind` |
| 9 | **[Intermediate (Q9–20)](./09-intermediate-aggregation.md)** | `HAVING` semantics, `$bucket`, `$facet`, `$filter`/`$map`, date grouping |
| 10 | **[Advanced (Q21–32)](./10-advanced-aggregation.md)** | `$$ROOT`, `$$REMOVE`, pipeline `$lookup`, top-N-per-group, `$reduce`, window functions |

### Scaling & Production

| | Page | What it answers |
| :-- | :--- | :--- |
| 11 | **[Replication & Replica Sets](./11-replication.md)** | Elections, the oplog and why it's idempotent, read preference, rollback |
| 12 | **[Sharding](./12-sharding.md)** | Shard key selection, targeted vs scatter-gather, when to shard (later than you think) |
| 13 | **[Transactions & Concerns](./13-transactions-and-concerns.md)** | `w`/`j`/read concern, correct transaction code, change streams |
| 14 | **[Production Playbook](./14-production-playbook.md)** | Connection pooling, NoSQL injection, backups, the "it's slow" runbook |

### Interview Prep

| | Page | |
| :-- | :--- | :--- |
| 15 | **[Interview Q&A](./15-interview-qa.md)** | 38 questions with model answers, written the way you'd say them out loud |

---

## 🎯 Suggested paths

**"I have ~3 years of MERN and an interview next week."**
→ [Data Modeling](./03-data-modeling.md) → [Indexes](./04-indexes-and-performance.md) → [Aggregation Fundamentals](./05-aggregation-fundamentals.md) → [Interview Q&A](./15-interview-qa.md), then work the [Intermediate](./09-intermediate-aggregation.md) and [Advanced](./10-advanced-aggregation.md) questions.
Modeling and indexes are where interviews are won or lost — syntax can be looked up, judgment cannot.

**"I want to actually understand aggregation, not memorise stages."**
→ [Aggregation Fundamentals](./05-aggregation-fundamentals.md) cover to cover, then all 32 practice questions in order. Read every trace.

**"I'm the person who gets paged."**
→ [Indexes](./04-indexes-and-performance.md) → [Replication](./11-replication.md) → [Transactions & Concerns](./13-transactions-and-concerns.md) → [Production Playbook](./14-production-playbook.md).

**"Start from zero."**
→ Straight through, 1 to 15.

---

## The five sentences this whole section is built around

1. **Data that is accessed together should be stored together.**
2. **`$group` destroys the document** — everything you need afterwards must be explicitly rebuilt.
3. **Equality, Sort, Range** — compound index field order.
4. **`$first` means "whichever arrived first"** — so the `$sort` before it is load-bearing.
5. **Replication is for availability; sharding is for scale.** Replication cannot scale writes.
