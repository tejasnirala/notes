---
title: Transactions, Isolation & Locking
---

# Transactions, Isolation & Locking

> **What you will be able to do after this page**
>
> - Define the four anomalies and trace each one through two concurrent sessions.
> - Explain PostgreSQL's three isolation levels — and why `REPEATABLE READ` here is stronger than MySQL's.
> - Choose between `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `SKIP LOCKED` and advisory locks.
> - Diagnose a deadlock from the log and prevent the next one.

---

## 1. ACID, concretely

| | What it means in PostgreSQL |
| :--- | :--- |
| **A**tomicity | All or nothing. Implemented by the commit record in WAL — a transaction whose xid isn't committed is simply invisible. **Rollback is free** (nothing to undo) |
| **C**onsistency | Constraints hold before and after. Your job as much as the database's |
| **I**solation | Concurrent transactions don't see each other's partial work. Implemented by MVCC snapshots |
| **D**urability | Committed means fsynced to WAL. Tunable with `synchronous_commit` |

```sql
BEGIN;
  UPDATE accounts SET balance = balance - 100 WHERE id = 1;
  UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;                     -- or ROLLBACK
```

Savepoints for partial rollback:

```sql
BEGIN;
  INSERT INTO orders ...;
  SAVEPOINT after_order;
  INSERT INTO risky_thing ...;      -- fails
  ROLLBACK TO SAVEPOINT after_order;  -- the order insert survives
COMMIT;
```

:::warning[Any error aborts the whole transaction in PostgreSQL]
```sql
BEGIN;
SELECT 1/0;                 -- ERROR
SELECT 1;                   -- ERROR: current transaction is aborted,
                            --        commands ignored until end of transaction block
```
Postgres refuses everything until you `ROLLBACK` or `ROLLBACK TO SAVEPOINT`. MySQL, by contrast, lets you continue after a statement error — the statement is rolled back, the transaction isn't. This surprises people porting either way, and it's why ORMs on Postgres wrap risky statements in savepoints (which is not free — each savepoint consumes a subtransaction slot, and more than 64 in one transaction triggers the notorious `SubtransSLRU` contention).
:::

---

## 2. The four anomalies, traced

### Dirty read — reading uncommitted data

```text
 T1                                  T2
 ─────────────────────────────────   ──────────────────────────────
 BEGIN;
 UPDATE accounts SET bal=0
   WHERE id=1;                       BEGIN;
                                     SELECT bal FROM accounts WHERE id=1;
                                       → 0  ← reads uncommitted data!
 ROLLBACK;                           (the value 0 never existed)
```

**PostgreSQL never allows this at any isolation level** — `READ UNCOMMITTED` is accepted as syntax but behaves as `READ COMMITTED`. MVCC makes it structurally impossible: you only ever see committed row versions.

### Non-repeatable read — the same row changes within a transaction

```text
 T1                                        T2
 ────────────────────────────────────      ─────────────────────────────
 BEGIN;  -- READ COMMITTED
 SELECT bal FROM accounts WHERE id=1;
   → 500
                                           UPDATE accounts SET bal=300
                                             WHERE id=1;
                                           COMMIT;
 SELECT bal FROM accounts WHERE id=1;
   → 300     ⚠️ DIFFERENT ANSWER, same transaction
 COMMIT;
```

Allowed at `READ COMMITTED`. Prevented at `REPEATABLE READ`.

### Phantom read — the same *query* returns new rows

```text
 T1                                        T2
 ────────────────────────────────────      ─────────────────────────────
 BEGIN;  -- READ COMMITTED
 SELECT count(*) FROM orders
   WHERE status='paid';   → 10
                                           INSERT INTO orders(status)
                                             VALUES ('paid');
                                           COMMIT;
 SELECT count(*) FROM orders
   WHERE status='paid';   → 11   ⚠️ a phantom row appeared
 COMMIT;
```

:::tip[PostgreSQL's `REPEATABLE READ` prevents phantoms — the standard doesn't require that]
The SQL standard allows phantoms at `REPEATABLE READ`. PostgreSQL implements `REPEATABLE READ` as a true **snapshot isolation**: the transaction sees the database exactly as it was at the moment of its first statement, so no new rows can appear either. That's stronger than the standard requires, and it's a great detail to have ready.
:::

### Serialization anomaly — each transaction is fine, the combination isn't

The write-skew example: a hospital rule that **at least one doctor must be on call**.

```text
 Initially: Alice on-call = true, Bob on-call = true

 T1 (Alice)                                 T2 (Bob)
 ──────────────────────────────────────     ──────────────────────────────────────
 BEGIN;  -- REPEATABLE READ
 SELECT count(*) FROM doctors
   WHERE on_call;  → 2                      BEGIN;  -- REPEATABLE READ
 -- "2 > 1, safe for me to go off call"     SELECT count(*) FROM doctors
                                              WHERE on_call;  → 2
                                            -- "2 > 1, safe for me to go off call"
 UPDATE doctors SET on_call=false
   WHERE name='Alice';                      UPDATE doctors SET on_call=false
                                              WHERE name='Bob';
 COMMIT;                                    COMMIT;

 RESULT: ZERO doctors on call. Neither transaction saw the other — they
         touched DIFFERENT rows, so there is no update conflict to detect.
         Both were individually correct. The combination violates the invariant.
```

**Only `SERIALIZABLE` prevents this.** Row locks don't, because the rows written are disjoint.

---

## 3. The isolation levels

| Level | Dirty read | Non-repeatable read | Phantom | Serialization anomaly |
| :--- | :--- | :--- | :--- | :--- |
| `READ UNCOMMITTED` | ❌ never in PG | possible | possible | possible |
| **`READ COMMITTED`** (PG default) | ❌ | possible | possible | possible |
| `REPEATABLE READ` | ❌ | ❌ | **❌ in PG** | possible |
| `SERIALIZABLE` | ❌ | ❌ | ❌ | ❌ |

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;
-- or
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
-- or per session / cluster
SET default_transaction_isolation = 'repeatable read';
```

### `READ COMMITTED` — the default, and its subtlety

**Each statement takes a fresh snapshot.** So two identical `SELECT`s in one transaction can differ, and — the part people miss — a single long `UPDATE ... WHERE` can see a *mix*:

```text
 T1: UPDATE products SET price = price * 1.1 WHERE category = 'books';
     (a long-running statement over 1 million rows)

 T2: concurrently inserts a new 'books' row and commits.

 T1's snapshot was taken at the start of the UPDATE statement, so the new
 row is not seen. But if T2 UPDATES a row that T1 is about to reach:
   → T1 BLOCKS on the row lock
   → when T2 commits, T1 RE-EVALUATES the WHERE clause against the NEW version
   → if the new version no longer matches WHERE, T1 SKIPS the row
```

That re-evaluation ("EvalPlanQual") is why `READ COMMITTED` can produce surprising results in read-modify-write patterns and why you should use `SELECT ... FOR UPDATE` or `REPEATABLE READ` when correctness depends on a consistent read.

### `REPEATABLE READ` — snapshot isolation

One snapshot for the whole transaction, taken at the first statement. All reads are consistent. Writes to a row someone else has modified since your snapshot fail:

```text
ERROR:  could not serialize access due to concurrent update
```

**You must be prepared to retry.** That's the deal: no blocking, but occasional aborts.

### `SERIALIZABLE` — SSI

PostgreSQL implements **Serializable Snapshot Isolation**: it's snapshot isolation plus tracking of read/write dependencies between concurrent transactions, aborting one if it detects a cycle that could produce a non-serializable outcome.

```text
ERROR:  could not serialize access due to read/write dependencies among transactions
HINT:   The transaction might succeed if retried.
```

- **Takes no extra locks that block** — it uses predicate locks (SIRead), which don't block anything, they just record what was read.
- Cost is memory for the predicate locks and a rate of aborts under contention.
- **Every application using `SERIALIZABLE` must implement retry.** No exceptions.

```javascript
async function withRetry(fn, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      // 40001 serialization_failure, 40P01 deadlock_detected
      if ((e.code === '40001' || e.code === '40P01') && i < attempts - 1) {
        await new Promise(r => setTimeout(r, 50 * 2 ** i));   // backoff
        continue;
      }
      throw e;
    }
  }
}
```

:::info[PostgreSQL vs MySQL — isolation]
| | PostgreSQL | MySQL (InnoDB) |
| :--- | :--- | :--- |
| **Default level** | **`READ COMMITTED`** | **`REPEATABLE READ`** |
| `READ UNCOMMITTED` | Behaves as READ COMMITTED — dirty reads impossible | Genuinely allows dirty reads |
| `REPEATABLE READ` phantoms | **Prevented** (true snapshot isolation) | Prevented for plain `SELECT` via the consistent snapshot, but **locking reads and writes see the latest committed data** — so you can get phantoms in `SELECT ... FOR UPDATE` and inside `INSERT ... SELECT` |
| Preventing phantoms in range locks | Not needed at RR; SERIALIZABLE uses predicate locks | **Gap locks / next-key locks** on the index range — these block inserts and are a major source of MySQL deadlocks |
| `SERIALIZABLE` implementation | **SSI** — optimistic, no blocking reads, aborts on conflict | Converts every plain `SELECT` into `SELECT ... LOCK IN SHARE MODE` — **pessimistic**, blocks heavily |
| Write conflict at RR | `ERROR: could not serialize access` — you retry | Last-write-wins on the row; no error |
| Write skew at RR | Possible (needs SERIALIZABLE) | Possible |

**The three sentences worth memorising:**
1. Postgres defaults to `READ COMMITTED`, MySQL to `REPEATABLE READ` — the same application code behaves differently on each.
2. Postgres' `REPEATABLE READ` gives true snapshot isolation and *errors* on a write conflict; MySQL's silently lets the second write win.
3. Postgres' `SERIALIZABLE` is optimistic (SSI, abort-and-retry); MySQL's is pessimistic (shared locks everywhere, blocking). They have the same name and completely different performance profiles.

And MySQL's **gap locks** have no Postgres equivalent at all: on MySQL at `REPEATABLE READ`, a `SELECT ... FOR UPDATE` on a range locks the *gaps between* index entries to stop inserts, which is why MySQL deadlocks in situations where Postgres wouldn't.
:::

---

## 4. Locking

### Row-level locks

```sql
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;            -- exclusive; blocks other writers & lockers
SELECT * FROM accounts WHERE id = 1 FOR NO KEY UPDATE;     -- weaker; allows FK checks to proceed
SELECT * FROM accounts WHERE id = 1 FOR SHARE;             -- shared; blocks writers, allows readers
SELECT * FROM accounts WHERE id = 1 FOR KEY SHARE;         -- weakest; what an FK check takes

SELECT ... FOR UPDATE NOWAIT;         -- error immediately if locked
SELECT ... FOR UPDATE SKIP LOCKED;    -- silently skip locked rows  ← job queues
```

**Plain `SELECT` takes no row locks at all** — MVCC means readers don't block and aren't blocked.

### `SKIP LOCKED` — the correct job queue

```sql
WITH claimed AS (
  SELECT id FROM jobs
  WHERE status = 'pending'
  ORDER BY priority DESC, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 10
)
UPDATE jobs j
SET status = 'processing', claimed_at = now(), worker_id = $1
FROM claimed c WHERE j.id = c.id
RETURNING j.*;
```

```text
 Worker A                              Worker B (concurrent)
 ──────────────────────────────        ──────────────────────────────
 locks jobs 1..10                      sees 1..10 locked → SKIPS them
 returns jobs 1..10                    locks and returns jobs 11..20

 No blocking. No duplicates. No polling collisions.
```

Without `SKIP LOCKED`, worker B blocks waiting for A, and you get a queue of workers instead of a queue of jobs. **`SKIP LOCKED` exists in MySQL 8.0.1+ too** — this one is portable, and it's the right answer to "how would you build a job queue on a relational database."

### Table-level locks

Acquired automatically; you rarely take them by hand.

| Lock mode | Taken by | Conflicts with |
| :--- | :--- | :--- |
| `ACCESS SHARE` | `SELECT` | Only `ACCESS EXCLUSIVE` |
| `ROW SHARE` | `SELECT FOR UPDATE/SHARE` | `EXCLUSIVE`, `ACCESS EXCLUSIVE` |
| `ROW EXCLUSIVE` | `INSERT`, `UPDATE`, `DELETE` | `SHARE` and above |
| `SHARE UPDATE EXCLUSIVE` | `VACUUM`, `ANALYZE`, `CREATE INDEX CONCURRENTLY`, `ALTER TABLE VALIDATE` | itself and above |
| `SHARE` | `CREATE INDEX` (non-concurrent) | writes |
| `SHARE ROW EXCLUSIVE` | `CREATE TRIGGER`, some `ALTER TABLE` | writes |
| `EXCLUSIVE` | `REFRESH MATERIALIZED VIEW CONCURRENTLY` | everything but `ACCESS SHARE` |
| `ACCESS EXCLUSIVE` | Most `ALTER TABLE`, `DROP`, `TRUNCATE`, `VACUUM FULL`, `REINDEX` | **everything** |

:::danger[The lock queue is why "instant" DDL causes outages]
Lock requests **queue in FIFO order**. If a long `SELECT` holds `ACCESS SHARE` and your `ALTER TABLE` requests `ACCESS EXCLUSIVE`, the ALTER waits — and **every query arriving after it also waits**, even harmless `SELECT`s that would not have conflicted with the running one.

```text
 t=0   long SELECT running (ACCESS SHARE) ─────────────────────────────▶ 5 min
 t=1   ALTER TABLE requests ACCESS EXCLUSIVE  ── waits ────────────────▶
 t=2   SELECT arrives ── waits behind the ALTER ───────────────────────▶
 t=3   SELECT arrives ── waits ────────────────────────────────────────▶
 …     the site is down, and `EXPLAIN` on any of those queries is fine
```

**Always guard DDL:**
```sql
SET lock_timeout = '3s';
ALTER TABLE ...;              -- fails fast instead of blocking the world; retry in a loop
```
:::

### Advisory locks — application-level mutexes

```sql
SELECT pg_advisory_lock(12345);                -- session-level, held until unlock/disconnect
SELECT pg_try_advisory_lock(12345);            -- non-blocking, returns boolean
SELECT pg_advisory_xact_lock(12345);           -- released at COMMIT — usually what you want
SELECT pg_advisory_unlock(12345);
SELECT pg_advisory_xact_lock(hashtext('nightly-report'));
```

Not tied to any row or table — the key is just a number you agree on. Perfect for "only one instance of this cron job may run," leader election, and serialising a critical section without a lock table.

:::warning[Advisory locks and connection poolers]
Session-level advisory locks live on the **connection**. With PgBouncer in transaction pooling mode, your next statement may land on a different server connection, so the lock isn't where you think it is. Use `pg_advisory_xact_lock` (transaction-scoped), which is safe under transaction pooling.
:::

MySQL's equivalents are `GET_LOCK()` / `RELEASE_LOCK()` — similar idea, named strings instead of integers.

---

## 5. Deadlocks

```text
 T1                                       T2
 ────────────────────────────────         ────────────────────────────────
 BEGIN;                                   BEGIN;
 UPDATE accounts SET .. WHERE id=1;       UPDATE accounts SET .. WHERE id=2;
   (holds lock on row 1)                    (holds lock on row 2)
 UPDATE accounts SET .. WHERE id=2;       UPDATE accounts SET .. WHERE id=1;
   ↓ waits for T2                           ↓ waits for T1
   └────────────── CYCLE ───────────────────┘

 After deadlock_timeout (1s default), Postgres runs cycle detection,
 picks a victim, and aborts it:
   ERROR: deadlock detected
   DETAIL: Process 123 waits for ShareLock on transaction 456; blocked by process 789.
```

**Prevention, in order of usefulness:**

1. **Always acquire locks in a consistent order.** Sort the IDs before updating: `WHERE id = ANY(ARRAY[...] ORDER BY 1)` or update in ascending `id` order in application code. This alone eliminates most deadlocks.
2. **Keep transactions short.** Never hold a transaction open across a network call, a user interaction, or an external API request.
3. **Touch fewer rows** — batch, and lock what you'll update in one statement rather than several.
4. **Use `SKIP LOCKED`** for queue-like access patterns.
5. **Retry on `40P01`.** Deadlocks are a normal, expected condition in a concurrent system, not a bug to be eliminated entirely.

Diagnose:

```sql
-- what is blocked, and by whom
SELECT blocked.pid       AS blocked_pid,
       blocked.query     AS blocked_query,
       blocking.pid      AS blocking_pid,
       blocking.query    AS blocking_query,
       blocked.wait_event_type, blocked.wait_event
FROM pg_stat_activity blocked
JOIN pg_stat_activity blocking
  ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
WHERE cardinality(pg_blocking_pids(blocked.pid)) > 0;

-- all current locks
SELECT locktype, relation::regclass, mode, granted, pid FROM pg_locks WHERE NOT granted;
```

```sql
-- postgresql.conf: log every deadlock's full detail
log_lock_waits = on
deadlock_timeout = '1s'
```

:::info[PostgreSQL vs MySQL — deadlocks]
Both detect deadlocks automatically and abort a victim. The differences: MySQL's `REPEATABLE READ` **gap locks** create deadlocks that simply cannot occur in Postgres, because Postgres has no gap locking. MySQL exposes the last deadlock with `SHOW ENGINE INNODB STATUS`; Postgres logs each one with full detail when `log_lock_waits = on`. And MySQL by default rolls back only the *statement* on a lock-wait timeout (`innodb_rollback_on_timeout` off), whereas Postgres aborts the entire transaction — so your retry logic has to be different.
:::

---

## 6. Optimistic vs pessimistic concurrency

```sql
-- PESSIMISTIC: lock, then act. Correct, but serialises and can deadlock.
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;

-- OPTIMISTIC: version column, no locks, retry on conflict.
UPDATE accounts SET balance = $1, version = version + 1
WHERE id = 1 AND version = $2;
-- 0 rows affected → someone else changed it → re-read and retry

-- BEST when it applies: make the update ATOMIC and skip the read entirely.
UPDATE accounts SET balance = balance - 100
WHERE id = 1 AND balance >= 100
RETURNING balance;
-- 0 rows → insufficient funds. No race, no lock, one statement.
```

That third form is the one to reach for first: **if the new value can be expressed in terms of the old one, let the database compute it and you have no race to manage.**

---

## 7. Durability tuning

| Setting | Effect |
| :--- | :--- |
| `synchronous_commit = on` (default) | Commit waits for WAL fsync. Zero data loss on crash |
| `synchronous_commit = off` | Commit returns before fsync. **Loses up to `wal_writer_delay` (200 ms) of recent commits on a crash — but never corrupts the database.** Big throughput win |
| `synchronous_commit = local` | Wait for local fsync only, not replicas |
| `synchronous_commit = remote_apply` | Wait until a sync replica has applied it — read-your-writes on replicas |
| `fsync = off` | **Never.** Corrupts on crash |

`synchronous_commit` is per-transaction, so you can be selective:

```sql
BEGIN;
SET LOCAL synchronous_commit = off;    -- analytics event, losing it is acceptable
INSERT INTO page_views ...;
COMMIT;
```

MySQL's equivalent axis is `innodb_flush_log_at_trx_commit` (1 = safe, 2 = OS buffer, 0 = every second) plus `sync_binlog`.

---

## 8. Rapid-fire recall

<details>
<summary>**What's PostgreSQL's default isolation level, and MySQL's?**</summary>

PostgreSQL defaults to `READ COMMITTED`, MySQL to `REPEATABLE READ`. That means the identical application code behaves differently on the two: on Postgres two `SELECT`s in one transaction can return different data, on MySQL they won't. It's one of the most consequential silent differences when porting, and it cuts both ways — code written against MySQL may assume a stable read, and code written against Postgres may assume it sees other transactions' commits.
</details>

<details>
<summary>**Explain the four anomalies.**</summary>

A dirty read is seeing another transaction's uncommitted data — impossible in Postgres at any level, because MVCC only exposes committed row versions. A non-repeatable read is re-reading the same row and getting a different value because someone committed in between. A phantom read is re-running the same query and getting extra rows. A serialization anomaly is when each transaction is individually correct but their interleaving produces a state no serial order could — the classic case being write skew, where two transactions read the same condition and each modifies a different row, together violating an invariant neither could see breaking.
</details>

<details>
<summary>**Why is PostgreSQL's `REPEATABLE READ` stronger than the standard requires?**</summary>

Because it's implemented as true snapshot isolation: the transaction sees the database as of its first statement and nothing new can appear, so phantoms are prevented even though the SQL standard permits them at that level. What it does *not* prevent is write skew, where two transactions read overlapping data and write to disjoint rows — for that you need `SERIALIZABLE`. And unlike MySQL, a write conflict at `REPEATABLE READ` raises `could not serialize access` rather than silently letting the last writer win, so you must implement retry.
</details>

<details>
<summary>**How does PostgreSQL implement `SERIALIZABLE`?**</summary>

Serializable Snapshot Isolation — snapshot isolation plus tracking of read-write dependencies between concurrent transactions. It takes predicate locks called SIRead locks that record what a transaction read, but those locks never block anything; when Postgres detects a dependency cycle that could produce a non-serializable outcome, it aborts one transaction with a serialization failure. So it's optimistic: no blocking, but you must retry. MySQL's `SERIALIZABLE` is the opposite — it turns every plain `SELECT` into a shared locking read, so it's pessimistic and blocks heavily. Same name, entirely different performance characteristics.
</details>

<details>
<summary>**How would you build a job queue?**</summary>

`SELECT ... FROM jobs WHERE status = 'pending' ORDER BY priority, created_at FOR UPDATE SKIP LOCKED LIMIT n`, wrapped in a CTE whose result an `UPDATE` marks as processing, with `RETURNING` to hand the rows back — all in one statement. `SKIP LOCKED` is what makes it work: concurrent workers skip rows another worker has locked instead of queueing behind them, so N workers scale linearly with no duplicates and no polling collisions. Then a sweeper resets rows stuck in processing past a visibility timeout, to handle worker crashes. `SKIP LOCKED` also exists in MySQL 8, so this design is portable.
</details>

<details>
<summary>**What causes deadlocks and how do you prevent them?**</summary>

Two transactions acquiring the same locks in opposite orders, so each waits on the other. Postgres detects the cycle after `deadlock_timeout` and aborts a victim with SQLSTATE 40P01. The single most effective prevention is acquiring locks in a consistent order — sort the IDs before updating them. Beyond that: keep transactions short and never hold one across a network call, touch fewer rows, use `SKIP LOCKED` for queue patterns, and retry on deadlock, because in a concurrent system deadlocks are an expected condition rather than a defect. Worth noting that MySQL's gap locks at `REPEATABLE READ` create a whole class of deadlocks that can't happen on Postgres.
</details>

<details>
<summary>**How do you safely run `ALTER TABLE` on a busy table?**</summary>

Set `lock_timeout` first — three seconds or so — and retry in a loop. The reason is that most `ALTER TABLE` forms need `ACCESS EXCLUSIVE`, and lock requests queue in order, so if a long-running `SELECT` is holding `ACCESS SHARE`, the ALTER waits and every query arriving after it waits behind the ALTER, including ones that wouldn't have conflicted. A one-millisecond DDL statement becomes a site-wide outage. With `lock_timeout` the ALTER simply fails and you try again in a quieter moment.
</details>

<details>
<summary>**Optimistic or pessimistic locking?**</summary>

Pessimistic — `SELECT ... FOR UPDATE` — when conflicts are likely and the work between read and write is short; it's simple and correct, at the cost of serialising and risking deadlocks. Optimistic — a version column checked in the `WHERE` clause, with retry on zero rows affected — when conflicts are rare and you don't want to hold locks across a user's think time. But the first thing I'd check is whether the update can be expressed atomically in terms of the current value: `UPDATE accounts SET balance = balance - 100 WHERE id = 1 AND balance >= 100 RETURNING balance` has no race to manage at all, because the read and the write are the same statement.
</details>

---

**Next:** [Partitioning →](./16-partitioning.md)
