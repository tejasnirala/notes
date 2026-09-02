---
title: Transactions & Isolation Levels
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Transactions & Isolation Levels

> **What you will be able to do after this page**
>
> - Say what each letter of ACID actually guarantees — and which one is misunderstood.
> - Name the anomalies each isolation level permits, and recognise them in real code.
> - Explain why your database's default is probably not `SERIALIZABLE`, and what that means for your code.
> - Choose between pessimistic and optimistic locking from the conflict rate.

Almost every application relies on transactions, and almost every application runs at an isolation level that permits anomalies its developers have never heard of. <C color="orange">This is the page where "it works on my machine" bugs come from.</C>

<Plain>

You are moving money between two accounts. Take £100 out of one, put £100 into the other.

Two things must be true, and neither is automatic.

**Both halves happen, or neither does.** If the power fails between them, £100 has vanished. So the two changes need to be treated as *one indivisible act* — either the whole thing took effect or none of it did. That is a **transaction**.

**Nobody sees the in-between state.** For a brief moment the money has left one account and not arrived in the other. If someone runs a report at exactly that instant, the bank appears to be £100 short. So other people's view of the data must skip over the middle.

The second requirement turns out to be much harder than the first, and the reason is that <C color="orange">making it perfectly true is slow</C>. Guaranteeing that nobody ever sees an intermediate state means transactions have to take turns, and taking turns wastes a lot of time when most of them would never have interfered anyway.

So databases offer a **dial**. At the strict end, everything behaves as though transactions ran one after another. At the relaxed end, they overlap freely and go much faster, but certain odd situations become possible.

Nearly every database ships with that dial **not** set to strictest. This page is about what the middle settings actually allow — because those situations are the ones that reach production and are very hard to reproduce.

</Plain>

---

## 1. ACID, precisely

| Letter | Guarantee | What people get wrong |
| :--- | :--- | :--- |
| **Atomicity** | All changes commit, or none do | It is about **failure**, not concurrency |
| **Consistency** | The database moves from one valid state to another | <C color="crimson">This is the odd one out — see below</C> |
| **Isolation** | Concurrent transactions do not corrupt each other's view | Almost never fully provided by default |
| **Durability** | Committed data survives a crash | "Committed" may mean *in the WAL*, not *on the platter* |

**The C is the misunderstood one.** Atomicity, isolation and durability are properties the *database* provides. Consistency in ACID means **your application's invariants hold** — that an account balance never goes negative, that an order always references a real customer. The database helps by enforcing the constraints you declare, but <C color="orange">it cannot know your business rules unless you express them</C>. Many people conflate it with the "C" in CAP, which is a completely different property (all readers seeing the same value). They share a letter and nothing else.

**Durability has a dial too.** Postgres's `synchronous_commit = off` acknowledges a commit before the WAL reaches disk — a large throughput gain, and a window in which a committed transaction can be lost to a power failure. <C color="green">Perfectly reasonable for analytics events; wrong for payments.</C>

---

## 2. The anomalies

These are the specific bad things isolation levels are defined to prevent. Learn them as concrete situations rather than names.

### Dirty read — reading uncommitted data

```
  T1: UPDATE accounts SET balance = 50 WHERE id = 1     -- not committed
  T2: SELECT balance FROM accounts WHERE id = 1  → 50   -- reads uncommitted value
  T1: ROLLBACK                                          -- that 50 never existed
```

T2 acted on a number that was never real. <C color="green">Prevented at every level above `READ UNCOMMITTED`</C>, and essentially never a concern in practice.

### Non-repeatable read — the same row changes mid-transaction

```
  T1: SELECT balance WHERE id = 1  → 100
  T2: UPDATE balance = 50 WHERE id = 1; COMMIT
  T1: SELECT balance WHERE id = 1  → 50      -- same query, different answer
```

Matters when a transaction reads a value, makes a decision, and reads again — the ground moved underneath it.

### Phantom read — the same query returns new rows

```
  T1: SELECT count(*) FROM orders WHERE user_id = 7  → 3
  T2: INSERT INTO orders (user_id) VALUES (7); COMMIT
  T1: SELECT count(*) FROM orders WHERE user_id = 7  → 4    -- a phantom appeared
```

Non-repeatable reads concern **rows that changed**; phantoms concern **rows that appeared or vanished** from a range.

### Lost update — two read-modify-writes collide

```
  T1: SELECT stock → 10
  T2: SELECT stock → 10
  T1: UPDATE stock = 10 − 1 = 9 ; COMMIT
  T2: UPDATE stock = 10 − 1 = 9 ; COMMIT      -- two sales, one decrement
```

<C color="crimson">The most common and most damaging anomaly in real applications</C>, because it arises from the completely natural pattern of reading a value into application code, computing, and writing back.

### Write skew — each transaction is fine, together they are not

```
  Rule: at least one doctor must remain on call.
  Currently Alice and Bob are both on call.

  T1 (Alice): SELECT count(*) on_call → 2. "Fine, I can leave."  UPDATE alice = off
  T2 (Bob):   SELECT count(*) on_call → 2. "Fine, I can leave."  UPDATE bob   = off
  Both commit. Nobody is on call.
```

<C color="orange">Neither transaction touched the same row, so no write conflict was detected</C> — yet the invariant is broken. This is the anomaly that `SNAPSHOT`/`REPEATABLE READ` does **not** prevent, and it is the reason `SERIALIZABLE` exists.

---

## 3. The levels

<Jargon
  plain="How strictly the database keeps concurrent transactions from seeing each other's half-finished work."
  term="isolation level"
  also={['transaction isolation', 'the isolation dial']}>

Four standard levels, from loosest to strictest. <C color="crimson">The critical fact: the SQL standard defines them by which anomalies they *permit*, not by how they are implemented</C> — so the same level name behaves differently across databases.

</Jargon>

| Level | Dirty read | Non-repeatable | Phantom | Lost update | Write skew |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `READ UNCOMMITTED` | <C color="crimson">possible</C> | <C color="crimson">possible</C> | <C color="crimson">possible</C> | <C color="crimson">possible</C> | <C color="crimson">possible</C> |
| `READ COMMITTED` | <C color="green">no</C> | <C color="crimson">possible</C> | <C color="crimson">possible</C> | <C color="crimson">possible</C> | <C color="crimson">possible</C> |
| `REPEATABLE READ` | <C color="green">no</C> | <C color="green">no</C> | <C color="orange">varies</C> | <C color="orange">varies</C> | <C color="crimson">possible</C> |
| `SERIALIZABLE` | <C color="green">no</C> | <C color="green">no</C> | <C color="green">no</C> | <C color="green">no</C> | <C color="green">no</C> |

**The defaults, which matter more than the standard:**

| Database | Default | Note |
| :--- | :--- | :--- |
| PostgreSQL | `READ COMMITTED` | Its `REPEATABLE READ` is snapshot isolation — blocks phantoms, allows write skew |
| MySQL / InnoDB | `REPEATABLE READ` | Uses gap locks, so phantoms are largely prevented |
| Oracle | `READ COMMITTED` | `SERIALIZABLE` is really snapshot isolation |
| SQL Server | `READ COMMITTED` | Lock-based by default; optional row-versioning mode |

<H>Your database is almost certainly running at READ COMMITTED, which permits lost updates and write skew. If your code does read-modify-write, it has a race — and it will only surface under concurrency you cannot easily reproduce.</H>

### Watching a lost update happen

<Trace title="Two customers, one item in stock" subtitle="READ COMMITTED. Both transactions are individually correct.">

<TraceStep
  title="Starting state"
  state={{ 'stock (DB)': '1', 'T1 sees': '—', 'T2 sees': '—', 'Items sold': '0' }}
  note="One item left. Two customers click Buy at the same moment.">

The `products` row for this item has `stock = 1`.

</TraceStep>

<TraceStep
  title="T1 reads the stock"
  state={{ 'stock (DB)': '1', 'T1 sees': '1', 'T2 sees': '—', 'Items sold': '0' }}
  changed={['T1 sees']}
  note="Read into application memory. The database is not holding anything for T1.">

`SELECT stock FROM products WHERE id = 9` → **1**. The application code checks `stock > 0` and proceeds.

</TraceStep>

<TraceStep
  title="T2 reads the stock — before T1 writes"
  cost="the race window"
  state={{ 'stock (DB)': '1', 'T1 sees': '1', 'T2 sees': '1', 'Items sold': '0' }}
  changed={['T2 sees']}
  note="Nothing prevents this. READ COMMITTED takes no locks on plain reads.">

T2 runs the identical query and also gets **1**. Both transactions now believe an item is available.

</TraceStep>

<TraceStep
  title="T1 writes and commits"
  state={{ 'stock (DB)': '0', 'T1 sees': '1', 'T2 sees': '1 (stale)', 'Items sold': '1' }}
  changed={['stock (DB)', 'T2 sees', 'Items sold']}
  note="Correct in isolation. T1 has done nothing wrong.">

`UPDATE products SET stock = 0 WHERE id = 9` — computed as 1 − 1 in application code. Committed.

</TraceStep>

<TraceStep
  title="T2 writes and commits — overwriting"
  cost="oversold"
  state={{ 'stock (DB)': '0', 'T1 sees': '1', 'T2 sees': '1 (stale)', 'Items sold': '2' }}
  changed={['Items sold']}
  note="Two customers were charged. One item exists. The database reports no error whatsoever.">

T2 also writes `stock = 0`, from its own stale read of 1.

<C color="crimson">Two sales, one item, and `stock` is 0 rather than −1 — so nothing looks wrong in the data.</C> You discover it in the warehouse.

</TraceStep>

<TraceStep
  title="Fix 1 — atomic update, no read-modify-write"
  cost="0 extra queries"
  state={{ 'stock (DB)': '0', 'T1 sees': 'n/a', 'T2 sees': 'n/a', 'Items sold': '1' }}
  changed={['T1 sees', 'T2 sees', 'Items sold']}
  note="The database evaluates and writes in one step, holding a row lock for the duration. Simplest and fastest fix.">

```sql
UPDATE products SET stock = stock - 1
WHERE id = 9 AND stock > 0;
```

<C color="green">Check the affected row count.</C> T2's update matches zero rows and its sale is rejected.

</TraceStep>

<TraceStep
  title="Fix 2 — pessimistic lock"
  cost="serialised, T2 waits"
  state={{ 'stock (DB)': '0', 'T1 sees': '1', 'T2 sees': '0 (after wait)', 'Items sold': '1' }}
  changed={['T2 sees', 'Items sold']}
  note="Use when you must read, compute in application code, and then write.">

```sql
SELECT stock FROM products WHERE id = 9 FOR UPDATE;
```

T1 holds a row lock; T2 **blocks** until T1 commits, then reads the true value of 0 and correctly refuses.

</TraceStep>

<TraceStep
  title="Fix 3 — optimistic lock"
  cost="T2 retries"
  state={{ 'stock (DB)': '0', 'T1 sees': 'v5', 'T2 sees': 'v5 → stale', 'Items sold': '1' }}
  changed={['T1 sees', 'T2 sees', 'Items sold']}
  note="No locks held. Better under low contention because readers never block.">

```sql
UPDATE products SET stock = 0, version = 6
WHERE id = 9 AND version = 5;
```

T1 succeeds and bumps the version. <C color="green">T2's update matches zero rows — it detects the conflict and retries or fails.</C>

</TraceStep>

</Trace>

---

## 4. Pessimistic vs optimistic

Two strategies for the same problem, and the right choice follows from one number: **how often do conflicts actually happen?**

| | Pessimistic (`SELECT … FOR UPDATE`) | Optimistic (version column) |
| :--- | :--- | :--- |
| Assumes | Conflicts are likely | Conflicts are rare |
| Mechanism | Lock the row, others wait | Detect the clash at write time, retry |
| Under low contention | <C color="crimson">Wasteful — locks nobody needed</C> | <C color="green">Excellent — no blocking at all</C> |
| Under high contention | <C color="green">Efficient — one waits, one proceeds</C> | <C color="crimson">Retry storms; wasted work</C> |
| Risk | <C color="crimson">Deadlocks; blocked connections</C> | <C color="crimson">Livelock if retries never succeed</C> |
| Long transactions | Dangerous — holds locks | <C color="green">Safe — holds nothing</C> |

<H>Optimistic is the better default for web applications, because two users editing the same row in the same second is genuinely rare. Switch to pessimistic where contention is real — inventory on a flash sale, seat booking, a hot counter.</H>

### Deadlocks

Two transactions each holding a lock the other wants.

```
  T1: lock row A ─────► wants row B
  T2: lock row B ─────► wants row A          neither can proceed
```

Databases detect the cycle and kill one, which surfaces as a retryable error. Two things follow:

<C color="green">**Always acquire locks in a consistent order.**</C> If every transaction locks accounts in ascending id order, the cycle cannot form. This one convention eliminates most application deadlocks.

<C color="green">**Always be prepared to retry.**</C> A deadlock victim is not a bug — it is expected under concurrency, and the correct response is to retry the transaction with backoff.

<Depth title="How MVCC lets readers and writers stop blocking each other">

The reason a modern database can offer `READ COMMITTED` without readers ever waiting is **MVCC** — Multi-Version Concurrency Control — and it explains several behaviours that otherwise look mysterious.

**The core idea:** an update never overwrites a row. It writes a **new version** and marks the old one as valid only up to a point in time. Every row version carries visibility metadata — in Postgres, `xmin` (the transaction that created it) and `xmax` (the transaction that deleted or superseded it).

Each transaction gets a **snapshot**: the set of transaction IDs that had committed when it started. When it reads a row, it walks the version chain and picks the version visible to *its* snapshot.

<C color="green">The consequence is the property that makes MVCC worth the complexity: **readers never block writers, and writers never block readers.**</C> A long analytical query sees a consistent snapshot from its start time while writes proceed at full speed alongside it — no shared read locks, no lock table contention.

**What this costs, and the operational consequences:**

**Old versions accumulate.** Every update leaves a dead tuple behind. Postgres reclaims them with `VACUUM`; without it, tables **bloat** — a table with 1M live rows can occupy the space of 10M. Autovacuum handles this normally, and falls behind under heavy update loads, which is why table bloat is a standard Postgres operational concern.

**Long-running transactions are unusually harmful.** A transaction open for hours holds a snapshot, and <C color="crimson">vacuum cannot remove *any* version newer than the oldest live snapshot</C> — even versions that transaction will never look at. One forgotten `BEGIN` in a psql session can prevent cleanup across the entire database and bloat unrelated tables. This is why `idle_in_transaction_session_timeout` exists and should be set.

**Transaction ID wraparound.** Postgres transaction IDs are 32-bit and wrap around. If vacuum falls far enough behind that IDs approach wraparound, Postgres **refuses new writes** to protect data — a genuinely alarming production event, and the reason wraparound age is worth monitoring.

**Implementations differ in where old versions live**, and it changes the failure mode:

- **Postgres** keeps versions in the table itself → fast updates, bloat, vacuum required.
- **MySQL/InnoDB** keeps them in a separate undo log → tables stay compact, but long transactions grow the undo log and can slow reads that must walk it.
- **Oracle** uses undo segments and can fail a long query outright with "snapshot too old" when the undo it needs has been recycled.

<C color="orange">The general lesson: MVCC trades space and background maintenance for concurrency</C> — and the tax is collected by a background process that you must keep ahead of your write rate. It is the same shape as LSM compaction, on the [previous page](./03-storage-engines.md): cheap in the foreground, paid for by a background job that must not fall behind.

</Depth>

---

## 5. Practical guidance

**Keep transactions short.** A transaction is a period during which you hold locks and pin a snapshot. <C color="crimson">Never call an external API inside one</C> — a slow third party becomes a database problem, and a timeout becomes a stuck lock.

**Do not read-modify-write when you can update atomically.** `SET stock = stock - 1` is safe at any isolation level. `SELECT` then `UPDATE` is not.

**Use the right level per transaction, not globally.** Most databases let you raise the level for one transaction. Run at `READ COMMITTED` normally; use `SERIALIZABLE` for the handful of operations with a real invariant to protect.

**Expect serialisation failures and retry.** At `SERIALIZABLE`, transactions are aborted when the database cannot prove they were serialisable. <C color="green">Retry logic is not optional — it is part of using the level.</C>

**Explicitly decide about distributed transactions.** Everything on this page assumes a single database. Across services, ACID is not available and you need [sagas or the outbox pattern](/systemDesign/concepts) instead — which trade atomicity for eventual consistency and compensating actions.

---

## 6. In a design discussion

- **"`READ COMMITTED` generally, but this balance transfer runs `SERIALIZABLE` with a retry loop — write skew would let both withdrawals through."** Names the anomaly and the fix.
- **"Optimistic locking with a version column, since two users editing the same record concurrently is rare. Inventory during a flash sale gets `FOR UPDATE` instead."** Chooses from the conflict rate.
- **"`UPDATE stock = stock - 1 WHERE stock > 0` and check the row count — no read-modify-write, so no race at any isolation level."** The cleanest possible answer.
- **"Locks acquired in ascending id order so deadlock cycles can't form, and the transaction retries on a deadlock victim error."** Shows you have operated this.

---

## Rapid-fire recall

1. Which letter of ACID is not a database guarantee, and what is it really about?
2. How does the C in ACID differ from the C in CAP?
3. In what sense is durability tunable, and when is the loose setting acceptable?
4. Distinguish a non-repeatable read from a phantom read.
5. Describe write skew with the on-call doctors example, and say why no write conflict is detected.
6. What are the defaults for Postgres and MySQL, and which anomalies does each permit?
7. Walk through a lost update, and give the three fixes.
8. When is optimistic locking better than pessimistic, and when does it fail badly?
9. Give the one convention that eliminates most application deadlocks.
10. Under MVCC, why does one forgotten open transaction bloat unrelated tables?

<details>
<summary>Answers</summary>

1. **Consistency.** Atomicity, isolation and durability are provided by the database; consistency means **your application's invariants hold**, and the database can only enforce the constraints you actually declare.
2. ACID's C = *application invariants remain valid*. CAP's C = *all readers see the same value* (linearizability). They share a letter and nothing else.
3. Settings like Postgres's `synchronous_commit = off` acknowledge a commit before the WAL reaches disk — faster, with a window where a committed transaction can be lost to power failure. Acceptable for analytics events; **wrong for payments**.
4. **Non-repeatable read**: an existing row's value changes between two reads in the same transaction. **Phantom**: rows **appear or disappear** from a range query between two reads.
5. Both doctors read `count(on_call) = 2`, each concludes it is safe to go off call, and each updates **their own row**. No two transactions wrote the same row, so no write conflict exists to detect — yet the invariant "at least one on call" is broken. Only `SERIALIZABLE` prevents it.
6. **Postgres**: `READ COMMITTED` — permits non-repeatable reads, phantoms, lost updates, write skew. **MySQL/InnoDB**: `REPEATABLE READ` — blocks non-repeatable reads and (via gap locks) most phantoms, still permits write skew.
7. Both transactions read `stock = 1`, both compute 1 − 1 = 0 in application code, both write 0 — two sales of one item, with no error. Fixes: **atomic update** (`SET stock = stock - 1 WHERE stock > 0`, check row count), **pessimistic lock** (`SELECT … FOR UPDATE`), or **optimistic lock** (a version column in the `WHERE` clause).
8. Better when **conflicts are rare** — no locks are held and readers never block. It fails badly under **high contention**, where repeated conflicts cause retry storms and wasted work; use pessimistic locking there.
9. **Acquire locks in a consistent order** (e.g. ascending primary key). A deadlock requires a cycle, and consistent ordering makes a cycle impossible.
10. Vacuum cannot remove **any** row version newer than the oldest live snapshot — including versions that transaction will never read. One idle `BEGIN` pins a snapshot and blocks cleanup **database-wide**, which is why `idle_in_transaction_session_timeout` should be set.

</details>

---

**Next:** [Normalization and Denormalization](./05-normalization-and-denormalization.md) — how many places one fact should live.
