---
title: Zero-Downtime Migrations
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Zero-Downtime Migrations

> **What you will be able to do after this page**
>
> - Run a schema change on a live table without locking it.
> - Execute the expand-migrate-contract pattern, and say why each phase exists.
> - Move data between stores with dual writes, backfill and verification.
> - Recognise the migrations that will lock your table for hours before you run them.

Every design eventually meets this problem: <C color="orange">the data is wrong-shaped, it is being read and written continuously, and you cannot stop.</C> The techniques are mechanical once you know them, and disastrous when improvised.

<Plain>

You need to replace the foundations of a bridge that traffic is crossing all day.

You cannot close it. So you do it in stages.

**Build the new foundation alongside the old one.** Nothing is connected yet; traffic keeps using the old.

**Connect both**, so the bridge is carried by old and new together. If the new one has a flaw, the old one is still holding everything up — you have taken no risk yet.

**Watch, and check the load is really being carried.**

**Disconnect the old**, once you are confident. Traffic never noticed.

**Finally, remove the old foundation** — days later, when you are certain, because taking it away is the only step you cannot undo quickly.

The crucial property is that <C color="green">at every moment, the bridge is fully supported</C>, and until the very last step you can retreat to where you started.

Software migrations work exactly this way, and the mistake is always the same: doing it in one step, at night, hoping. <C color="crimson">The one-step version has no retreat</C> — if it fails halfway, the old shape is already gone and the new one does not work.

</Plain>

---

## 1. Why the obvious approach fails

```sql
ALTER TABLE users ADD COLUMN full_name VARCHAR(255) NOT NULL;
```

On a large table in many databases this takes an **exclusive lock** and rewrites every row. For 100M rows that can be tens of minutes during which <C color="crimson">every query on the table blocks</C> — including the health checks, which then eject your servers.

Worse, it fails for a second reason even if it were instant: <C color="crimson">old application code is still running.</C> During any deploy, old and new versions run simultaneously. A `NOT NULL` column that old code does not populate makes every old-code insert fail.

<Jargon
  plain="Changing the shape of your data in stages so that old and new code both keep working throughout."
  term="expand-migrate-contract"
  also={['expand and contract', 'the parallel change pattern']}>

Also called **parallel change**. The rule underneath it: <C color="green">every intermediate state must be compatible with both the previous and the next version of the code</C>, because you are never able to change code and data at the same instant.

</Jargon>

### Which operations are safe

| Operation | Cost |
| :--- | :--- |
| Add a **nullable** column with no default | <C color="green">Instant — metadata only</C> |
| Add a column with a default | <C color="green">Instant on PG 11+/MySQL 8+</C>; <C color="crimson">full rewrite on older versions</C> |
| Add an index | <C color="crimson">Locks writes</C> — unless `CREATE INDEX CONCURRENTLY` |
| Drop a column | <C color="green">Usually instant</C> (marked dead), but breaks old code reading it |
| Rename a column | <C color="crimson">Instant in the DB, breaks every deployed client</C> |
| Change a column type | <C color="crimson">Usually a full rewrite</C> |
| Add `NOT NULL` | <C color="crimson">Full scan to validate</C> — use a `CHECK … NOT VALID`, then validate |
| Add a foreign key | <C color="crimson">Locks both tables</C> — add `NOT VALID`, then validate separately |

<H>Check what your specific database and version does before running a migration on a large table. "It was instant in staging" means the staging table was small, not that the operation is cheap.</H>

---

## 2. Renaming a column, properly

The canonical example, because a rename looks trivial and is the most dangerous.

<Trace title="Renaming `name` to `full_name` on a live 100M-row table" subtitle="Five deploys. At no point are old and new code incompatible.">

<TraceStep
  title="Phase 1 — EXPAND: add the new column"
  cost="instant"
  state={{ 'Schema': 'name + full_name (nullable)', 'App writes': 'name only', 'App reads': 'name', 'Rollback': 'trivial' }}
  changed={['Schema']}
  note="Nullable, no default, no constraint — pure metadata change. Deployed code does not know it exists.">

`ALTER TABLE users ADD COLUMN full_name VARCHAR(255);`

<C color="green">Nothing uses it yet, so nothing can break.</C>

</TraceStep>

<TraceStep
  title="Phase 2 — write to both columns"
  state={{ 'Schema': 'name + full_name', 'App writes': 'BOTH', 'App reads': 'name', 'Rollback': 'trivial' }}
  changed={['App writes']}
  note="Reads still come from the old column, so this deploy changes nothing a user can observe.">

Deploy code that writes both `name` and `full_name` on every insert and update, but still **reads** `name`.

New rows now have both. Old rows still have `full_name = NULL`.

</TraceStep>

<TraceStep
  title="Phase 3 — backfill the old rows"
  cost="hours, in batches"
  state={{ 'Schema': 'name + full_name', 'App writes': 'BOTH', 'App reads': 'name', 'Backfill': '100M rows, batched' }}
  changed={['Backfill']}
  note="Never one statement. A single UPDATE over 100M rows holds locks, bloats the WAL, and blocks replication.">

```sql
UPDATE users SET full_name = name
WHERE full_name IS NULL AND id BETWEEN ? AND ?;   -- 10k rows at a time
```

Run in batches with a pause between them, rate-limited, and <C color="green">restartable</C> — it will be interrupted at some point.

</TraceStep>

<TraceStep
  title="Phase 4 — read from the new column"
  cost="the moment of truth"
  state={{ 'Schema': 'name + full_name', 'App writes': 'BOTH', 'App reads': 'full_name', 'Rollback': 'one deploy' }}
  changed={['App reads', 'Rollback']}
  note="Verify the backfill completed before this deploy: SELECT count(*) WHERE full_name IS NULL should be zero.">

Deploy code that reads `full_name`. Writes still go to both columns.

<C color="green">If anything is wrong, roll back this one deploy</C> — `name` is still being written and is still correct.

</TraceStep>

<TraceStep
  title="Phase 5 — stop writing the old column"
  state={{ 'Schema': 'name + full_name', 'App writes': 'full_name only', 'App reads': 'full_name', 'Rollback': 'harder now' }}
  changed={['App writes', 'Rollback']}
  note="From here, name begins to drift. Rolling back past this point means backfilling in reverse.">

Deploy code that writes only `full_name`. Wait — days, not hours — and watch for anything still reading `name`.

</TraceStep>

<TraceStep
  title="Phase 6 — CONTRACT: drop the old column"
  cost="irreversible"
  state={{ 'Schema': 'full_name only', 'App writes': 'full_name', 'App reads': 'full_name', 'Rollback': 'restore from backup' }}
  changed={['Schema', 'Rollback']}
  note="The only genuinely one-way step, deliberately left until last and separated from everything else.">

`ALTER TABLE users DROP COLUMN name;`

<H>Six deploys instead of one, and at every step before the last you can retreat by reverting a single deploy. That is the entire point — not elegance, but the existence of a retreat.</H>

</TraceStep>

</Trace>

---

## 3. Moving between stores

The same shape, at a larger scale: Postgres to Cassandra, one database to a sharded cluster, a monolith's table to a service's own store.

```
  1. DUAL WRITE      write to old AND new; read from old
  2. BACKFILL        copy history into new, in batches
  3. VERIFY          compare old vs new continuously; alert on drift
  4. SHADOW READ     read from both, return old, log differences
  5. FLIP READS      read from new; keep writing both
  6. STOP DUAL WRITE write only to new
  7. DECOMMISSION    delete the old — last, and much later
```

Two steps make the difference between this working and not:

**Step 3, verification, is not optional.** Dual writes fail silently — a failed write to the new store that you swallow to protect the request path leaves a gap you will not notice for months. Run a continuous reconciliation job comparing samples from both, and <C color="crimson">treat any drift as a blocking bug</C>.

**Step 4, shadow reads, is where you find the real problems.** Read from both, return the old answer, and log every difference. This exposes subtle issues — different sort ordering, timezone handling, floating-point representation, NULL semantics — <C color="green">under real production traffic, with zero user impact.</C>

<Depth title="Making dual writes trustworthy, and why CDC is usually better">

**Dual writes are not atomic, and that is the whole problem.** Writing to two stores in the application means four outcomes, and one of them is silent corruption:

```
  old OK, new OK      → correct
  old FAIL, new FAIL  → request fails, nothing written — acceptable
  old OK,  new FAIL   → the stores now disagree, and the user saw success
  old FAIL, new OK    → the stores now disagree, the other way
```

You cannot wrap them in a transaction, because they are different systems. Three real options:

**1. Write to old, then asynchronously to new, with retries.** Simple. The gap is real but bounded, and a reconciliation job catches what the retries miss. <C color="green">Adequate for most migrations</C>, provided the reconciliation actually exists.

**2. The outbox pattern.** In the **same transaction** as the write to the old store, insert a row into an `outbox` table. A separate process reads the outbox and applies to the new store. <C color="green">Because the outbox row and the data change commit atomically, no event is ever lost</C> — the write either happened with its outbox row, or not at all. This is the correct answer when you cannot tolerate gaps.

**3. Change data capture.** Do not dual-write at all. Read the database's **replication log** (Postgres logical decoding, MySQL binlog) with something like Debezium, and apply changes to the new store.

CDC is usually the best option for a store migration, for reasons worth knowing:

- <C color="green">**No application changes.**</C> The migration does not touch product code, so it does not compete with feature work or introduce bugs in the request path.
- <C color="green">**Nothing can be missed.**</C> The log is the authoritative record of every committed change — including writes from cron jobs, admin tools, and manual `psql` sessions that dual-write code would never see.
- <C color="green">**Ordering is preserved**</C>, per partition, for free.
- <C color="green">**Backfill and streaming unify.**</C> Snapshot the table, then stream from the log position the snapshot was taken at — no gap, no overlap.

The costs: another moving part to operate, and the new store is **eventually consistent** with the old, typically by milliseconds to seconds. For a migration that is nearly always fine, since you are not flipping reads until verification passes anyway.

<H>The general principle: if you find yourself writing the same data to two places from application code, ask whether the database's own replication log can do it for you instead. It is more reliable than anything you will write, because it cannot miss a write that committed.</H>

</Depth>

---

## 4. Rules that prevent most incidents

**Never combine a schema change and a code change in one deploy.** They cannot be atomic, so design for the window in which both versions run.

**Batch every backfill.** Small batches, a pause between them, restartable from a stored position, and rate-limited so replication lag stays bounded. <C color="crimson">A single `UPDATE` over 100M rows will bloat the WAL, block vacuum, and lag every replica.</C>

**Watch replication lag during backfills.** It is the first symptom, and rising lag means your replicas are serving increasingly stale reads while you work.

**Use `CONCURRENTLY` for indexes** in Postgres. It takes longer and does not lock writes. It can also fail and leave an invalid index behind, so check for that afterwards.

**Set a lock timeout.** `SET lock_timeout = '5s'` means a migration that cannot get its lock **fails fast** instead of queueing — and a queued `ALTER` blocks every subsequent query on that table, turning a slow migration into a full outage.

**Keep the contract phase far from the expand phase.** Days, not minutes. The dropped column is the only irreversible step; there is no prize for doing it sooner.

**Test on production-sized data.** A migration that takes 200 ms on 10,000 rows may take 40 minutes on 100 million. Staging with a small dataset tells you the migration is *correct*, never that it is *fast*.

---

## 5. In a design discussion

- **"Expand-migrate-contract: add nullable, dual write, backfill in batches, flip reads, stop writing the old, drop it days later."** The whole pattern in one sentence.
- **"CDC rather than application dual writes — the replication log can't miss a write, including ones from cron jobs and manual sessions."** The insight that separates experience from theory.
- **"Shadow reads before flipping, so we find ordering and NULL-handling differences under real traffic with no user impact."** The step people skip.
- **"`lock_timeout` set, or a blocked `ALTER` queues behind it and takes the whole table down."** A specific, real production failure.

---

## Rapid-fire recall

1. Give the two reasons a single `ALTER TABLE ADD COLUMN NOT NULL` fails on a live system.
2. State the compatibility rule underlying expand-migrate-contract.
3. Which schema operations are effectively instant, and which rewrite the table?
4. Walk the six phases of a live column rename.
5. Which phase is the only irreversible one, and what follows from that?
6. Why must a backfill be batched, and what three properties should the batch loop have?
7. Give the seven steps of a store-to-store migration.
8. What are shadow reads and what kind of bug do they catch?
9. Name the four outcomes of a non-atomic dual write and say which is dangerous.
10. Give three reasons CDC beats application-level dual writes.

<details>
<summary>Answers</summary>

1. It takes an **exclusive lock and rewrites every row** (blocking all queries, including health checks); and **old application code is still running** during the deploy and will not populate the new column, so its inserts fail.
2. <H>Every intermediate state must be compatible with both the previous and the next version of the code</H> — because code and schema can never change at the same instant.
3. **Instant**: adding a nullable column, adding a column with a default (PG 11+/MySQL 8+), dropping a column. **Rewrite or lock**: adding an index without `CONCURRENTLY`, changing a column type, adding `NOT NULL`, adding a foreign key.
4. Add the nullable column → write to both → backfill in batches → read from the new one → stop writing the old one → drop the old column.
5. **Dropping the column.** Therefore it is left until last, separated by days, and everything before it can be undone by reverting one deploy.
6. A single statement over 100M rows holds locks for the duration, bloats the WAL, blocks vacuum and lags replicas. The loop should be **restartable** (store position), **rate-limited**, and **paused between batches** while watching replication lag.
7. Dual write → backfill → verify → shadow read → flip reads → stop dual writing → decommission the old store.
8. Reading from **both** stores, returning the old answer and logging differences. It catches subtle mismatches — sort order, timezone handling, floating-point representation, NULL semantics — under real traffic with **zero user impact**.
9. Both succeed (fine) · both fail (request fails, acceptable) · **old succeeds, new fails** · **new succeeds, old fails**. The last two are dangerous: the stores disagree and the user was told it worked.
10. **No application changes** (does not touch the request path) · **cannot miss a write**, including from cron jobs, admin tools and manual sessions · **ordering preserved for free** · snapshot-then-stream unifies backfill and streaming with no gap.

</details>

---

**Next:** [CAP and PACELC](../06-distributed-systems/01-cap-and-pacelc.md) — the theorem everyone quotes and most people state wrongly.
