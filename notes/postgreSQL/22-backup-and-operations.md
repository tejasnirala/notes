---
title: Backup, PITR & Operations
---

# Backup, PITR & Operations

> **What you will be able to do after this page**
>
> - Choose between logical and physical backups and explain the trade-off precisely.
> - Set up continuous archiving and perform a point-in-time recovery.
> - Upgrade a major version three different ways and pick the right one.
> - Say what you monitor and what you alert on.

---

## 1. Logical backups — `pg_dump`

```bash
# Custom format — compressed, parallel restore, selective restore. Use this.
pg_dump -h host -U user -Fc -f shop.dump shop

# Directory format — supports PARALLEL DUMP (-j)
pg_dump -Fd -j 4 -f shop_dir shop

# Plain SQL — human-readable, restore with psql
pg_dump -Fp -f shop.sql shop

# Selective
pg_dump -t orders -t order_items shop        # only these tables
pg_dump --schema-only shop                    # DDL only
pg_dump --data-only shop
pg_dump --exclude-table-data='audit_log' shop # schema of audit_log, but not its rows

# Every database plus roles and tablespaces
pg_dumpall -f cluster.sql
pg_dumpall --globals-only -f roles.sql        # roles/grants ONLY — pg_dump omits these!
```

Restore:

```bash
createdb shop_restored
pg_restore -d shop_restored -j 4 shop.dump          # parallel restore
pg_restore -d shop_restored -t orders shop.dump     # one table
pg_restore -l shop.dump > toc.txt                   # list contents, edit, then:
pg_restore -d shop_restored -L toc.txt shop.dump    # selective restore
psql -d shop_restored -f shop.sql                   # plain format
```

:::warning[`pg_dump` does not back up roles]
Roles, grants and tablespaces are **cluster-level**, so `pg_dump` of a single database omits them. You need `pg_dumpall --globals-only` alongside it. Restoring a dump into a fresh cluster and finding every grant missing is a rite of passage.
:::

**Properties of `pg_dump`:**

- Runs in a single **repeatable-read transaction**, so the dump is a consistent snapshot with no downtime and no locking of writers.
- But it **holds a transaction open for the whole dump** — which blocks VACUUM cluster-wide and can bloat a busy database during a multi-hour dump. Run it against a replica when you can.
- Output is version-portable: dump from 14, restore into 17.
- **Restore is slow.** A 500 GB dump can take many hours because it rebuilds every index. This is the deciding factor: your RTO is the restore time, not the dump time.

---

## 2. Physical backups and PITR

```ini
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'
# in reality: 'wal-g wal-push %p' or 'pgbackrest --stanza=main archive-push %p'
archive_timeout = 300           # force a WAL switch every 5 min, bounding data loss
```

```bash
pg_basebackup -h primary -U replicator -D /backup/base -Fp -Xs -P
```

**Point-in-time recovery** = a base backup plus every WAL segment since, replayed up to a chosen instant.

```text
 Sun 02:00        Mon              Tue              Wed 14:23         Wed 14:30
 ┌────────┐       │                │                    │                 │
 │  BASE  │══WAL══╪════════WAL═════╪═══════WAL══════════╪═══════WAL═══════╡
 └────────┘       │                │                    │                 │
                                                        ▲                 ▲
                                          "DROP TABLE orders;"      you notice

 Recovery: restore Sunday's base backup, replay WAL, STOP at 14:22:59.
 Result: the database exactly as it was one minute before the mistake.
```

```bash
# 1. Stop the server, move the broken data directory aside
# 2. Restore the base backup into $PGDATA
# 3. Configure recovery
cat >> $PGDATA/postgresql.conf <<'EOF'
restore_command = 'cp /archive/%f %p'
recovery_target_time = '2026-08-30 14:22:59+05:30'
recovery_target_action = 'promote'
EOF
touch $PGDATA/recovery.signal        # PG 12+; pre-12 this was recovery.conf
# 4. Start the server — it replays WAL and stops at the target
```

Recovery targets: `recovery_target_time`, `recovery_target_lsn`, `recovery_target_xid`, `recovery_target_name` (set with `pg_create_restore_point('before_migration')`), or `recovery_target = 'immediate'`.

:::tip[Create a named restore point before every risky migration]
```sql
SELECT pg_create_restore_point('before_v2_migration');
```
It costs nothing and gives you an exact, named recovery target instead of guessing at a timestamp.
:::

### Use a real backup tool

Rolling your own `archive_command` with `cp` works until it doesn't. Use one of:

| Tool | Notes |
| :--- | :--- |
| **pgBackRest** | The most complete: parallel backup/restore, incremental and differential, compression, encryption, S3/Azure/GCS, verification, retention. **The default recommendation** |
| **WAL-G** | Simple, fast, cloud-native, Go binary, delta backups |
| **Barman** | Mature, Python, good for on-prem fleets |

They handle the things a hand-rolled script gets wrong: archive verification, retention expiry, parallelism, resumable uploads, and detecting a silently failing `archive_command`.

### Logical vs physical — the comparison

| | `pg_dump` (logical) | Base backup + WAL (physical) |
| :--- | :--- | :--- |
| Granularity | Table, schema, database | Whole cluster only |
| Cross-version restore | ✅ | ❌ same major version |
| Cross-architecture | ✅ | ❌ |
| Point-in-time recovery | ❌ (only as of the dump) | ✅ **any instant** |
| Backup size | Smaller (no bloat, no indexes) | Larger (exact copy) |
| Backup speed | Slower on large data | Fast (file copy) |
| **Restore speed** | **Slow — rebuilds every index** | **Fast — files are already built** |
| Impact on primary | Holds a long transaction → blocks VACUUM | Minimal |
| RPO | Since the last dump (hours) | **Seconds** |

**Run both.** Physical + WAL archiving for your real RPO/RTO, and a nightly `pg_dump` for the "someone dropped one table and we need it back into a scratch database" case that PITR handles clumsily.

:::info[PostgreSQL vs MySQL]
| PostgreSQL | MySQL |
| :--- | :--- |
| `pg_dump` / `pg_dumpall` | `mysqldump` / `mysqlpump` |
| Base backup + WAL archiving for PITR | Physical backup (Percona XtraBackup, MySQL Enterprise Backup) + **binlog** for PITR |
| `pg_basebackup` built in | `XtraBackup` is third-party (Percona); the built-in `mysqlbackup` is Enterprise-only |
| pgBackRest / WAL-G / Barman ecosystem | XtraBackup is the de facto standard |
| `pg_dump` is transactionally consistent without locking | `mysqldump --single-transaction` is consistent for **InnoDB only**; MyISAM tables need `--lock-all-tables` |
| Restore rebuilds indexes (slow) | Same |

The mechanics are near-identical in spirit — a base copy plus a replayable log. The notable difference is that a fully-featured physical backup tool for MySQL has historically come from Percona rather than the vendor.
:::

---

## 3. Major version upgrades

| Method | Downtime | Notes |
| :--- | :--- | :--- |
| **`pg_dumpall` + restore** | Hours to days | Simplest, always works, cross-architecture. Fine below ~50 GB |
| **`pg_upgrade`** | Minutes | Rewrites catalogs in place; `--link` uses hard links so it's near-instant regardless of size |
| **Logical replication** | Seconds | Build the new cluster alongside, sync, cut over. The best option for large or high-availability systems |

```bash
# pg_upgrade with hard links — minutes even for terabytes
pg_upgrade \
  -b /usr/lib/postgresql/16/bin -B /usr/lib/postgresql/17/bin \
  -d /var/lib/postgresql/16/main -D /var/lib/postgresql/17/main \
  --link --check          # --check first: dry run, reports incompatibilities

# After upgrading, statistics are NOT carried over — this is mandatory:
vacuumdb --all --analyze-in-stages
```

:::danger[Two things people forget after an upgrade]
1. **Statistics are not migrated.** Until you run `ANALYZE`, every plan is based on nothing and the database appears catastrophically slow. `vacuumdb --all --analyze-in-stages` does it in three passes of increasing accuracy so you get usable plans quickly.
2. **`pg_upgrade --link` makes the old cluster unusable.** The hard links mean the new server writes into the same files. There is no rollback — take a backup first, and don't delete it until you're confident.
:::

**Minor version upgrades** (17.2 → 17.3) are just a binary swap and a restart, with no dump/restore. Do them promptly; they're security and correctness fixes.

---

## 4. What to monitor

| Metric | Query / source | Alert at |
| :--- | :--- | :--- |
| Connections used | `pg_stat_activity` vs `max_connections` | `> 80 %` |
| Idle in transaction | `pg_stat_activity` where `state = 'idle in transaction'` | any `> 5 min` |
| Longest transaction | `age(clock_timestamp(), xact_start)` | `> 10 min` |
| Replication lag (bytes) | `pg_stat_replication` | `> 100 MB` |
| Replication lag (time) | `now() - pg_last_xact_replay_timestamp()` | `> 30 s` |
| Inactive replication slots | `pg_replication_slots` where `NOT active` | **any** |
| Cache hit ratio | `pg_statio_user_tables` | `< 95 %` |
| Dead tuple ratio | `pg_stat_user_tables` | `> 20 %` |
| Transaction ID age | `age(relfrozenxid)` from `pg_class` | `> 500 M` |
| Disk usage — data and `pg_wal` separately | filesystem | `> 80 %` |
| Deadlocks / conflicts | `pg_stat_database` | rising rate |
| Checkpoint frequency | `pg_stat_bgwriter`, `log_checkpoints` | `checkpoints_req` climbing |
| Slow queries | `pg_stat_statements` | p99 regression |
| Backup age & restore test | your tooling | `> 25 h` |
| WAL archiving failures | `pg_stat_archiver.last_failed_time` | any recent |

```sql
-- One health-check query worth keeping in a snippet file
SELECT
  (SELECT count(*) FROM pg_stat_activity)                                  AS conns,
  (SELECT count(*) FROM pg_stat_activity WHERE state='idle in transaction') AS idle_in_txn,
  (SELECT max(age(clock_timestamp(), xact_start))
     FROM pg_stat_activity WHERE state<>'idle')                            AS longest_txn,
  (SELECT max(age(relfrozenxid)) FROM pg_class WHERE relkind='r')          AS max_xid_age,
  (SELECT count(*) FROM pg_replication_slots WHERE NOT active)             AS dead_slots,
  (SELECT round(100.0*sum(heap_blks_hit)
                /nullif(sum(heap_blks_hit)+sum(heap_blks_read),0), 2)
     FROM pg_statio_user_tables)                                           AS cache_hit_pct;
```

Useful log settings:

```ini
log_min_duration_statement = '1s'
log_checkpoints = on
log_lock_waits = on
log_autovacuum_min_duration = '1s'
log_temp_files = 0
log_connections = on
log_disconnections = on
log_line_prefix = '%m [%p] %q%u@%d/%a '
```

`log_temp_files = 0` logs every temp file created, which is the clearest signal that `work_mem` is too small for a real workload.

---

## 5. Operational rules that come from experience

:::tip[The eight]
1. **An untested backup is not a backup.** Schedule an automated restore into a scratch environment and verify row counts. Most backup failures are discovered during the first real restore.
2. **Set `lock_timeout` before every DDL.** A one-millisecond `ALTER` behind a slow `SELECT` blocks every subsequent query.
3. **Set `idle_in_transaction_session_timeout`.** One forgotten `BEGIN;` bloats the whole cluster.
4. **Alert on inactive replication slots.** They fill the disk and stop VACUUM, silently, until the primary goes down.
5. **`ANALYZE` after any bulk load or major upgrade.** No statistics means no reasonable plans.
6. **Never `VACUUM FULL` in production.** `pg_repack`, or drop a partition.
7. **The application should not own its tables and must never be superuser.** A compromised credential should not be able to `DROP TABLE`.
8. **Separate `pg_wal` onto its own filesystem** if you can — a full data volume shouldn't take WAL down with it, and vice versa.
:::

---

## 6. Rapid-fire recall

<details>
<summary>**Logical or physical backups?**</summary>

Both, for different jobs. `pg_dump` gives you portability and granularity — restore one table, or move from version 14 to 17 — but its restore is slow because it rebuilds every index, and it holds a long transaction that blocks VACUUM cluster-wide while it runs. A base backup plus archived WAL gives you point-in-time recovery to any instant, fast restores because the files are already built, and minimal impact on the primary — but only whole-cluster granularity and only the same major version. So: physical plus WAL archiving defines your real RPO and RTO, and a nightly logical dump handles "someone dropped one table."
</details>

<details>
<summary>**Explain point-in-time recovery.**</summary>

You take a base backup of the data directory and continuously archive every completed WAL segment. To recover, you restore the base backup, set `restore_command` so the server can fetch archived WAL, set a `recovery_target_time` — or an LSN, transaction ID, or a named restore point — create `recovery.signal`, and start the server. It replays WAL from the base backup forward and stops exactly at the target, so you can land one second before an accidental `DROP TABLE`. Creating a named restore point before every risky migration costs nothing and beats guessing at timestamps afterwards.
</details>

<details>
<summary>**What does `pg_dump` miss?**</summary>

Roles, grants and tablespaces, because those are cluster-level rather than database-level objects. You need `pg_dumpall --globals-only` alongside the per-database dumps. It's also worth knowing that `pg_dump` runs inside a single repeatable-read transaction — which is what makes it consistent without locking writers, but also means a multi-hour dump holds the xmin horizon back and prevents VACUUM from reclaiming anything cluster-wide. That's a good reason to dump from a replica.
</details>

<details>
<summary>**How do you upgrade a major version with minimal downtime?**</summary>

Three options by size. Dump and restore is simplest and always works, but takes hours to days, so it's for small databases. `pg_upgrade --link` rewrites the catalogs and hard-links the data files, so it takes minutes regardless of database size — but it makes the old cluster unusable, so there's no rollback without a backup. For large or high-availability systems, logical replication: stand up the new major version alongside, subscribe, wait for lag to reach zero, stop writes for a few seconds, advance the sequences manually because logical replication doesn't carry them, and repoint the application. Whichever route, run `vacuumdb --all --analyze-in-stages` afterwards, because statistics aren't migrated and the database looks broken until you do.
</details>

<details>
<summary>**What do you monitor and alert on?**</summary>

Connection saturation against `max_connections`; anything idle-in-transaction for more than a few minutes, and the longest running transaction, because those two cause cluster-wide bloat; replication lag in both bytes and seconds; any inactive replication slot, which is an immediate alert because it fills the disk and stops VACUUM; cache hit ratio; dead tuple percentage; `age(relfrozenxid)` for wraparound; disk usage on the data and WAL volumes separately; WAL archiving failures; and query latency regressions from `pg_stat_statements`. Plus the age of the last successful backup and the last successful *test restore* — an untested backup isn't a backup.
</details>

<details>
<summary>**How is MySQL's backup story different?**</summary>

Structurally the same idea — a physical base copy plus a replayable log, which for MySQL is the binlog rather than WAL. The notable practical difference is that the standard physical backup tool, XtraBackup, comes from Percona rather than Oracle; the vendor's own hot-backup tool is Enterprise-only. On the logical side `mysqldump --single-transaction` gives a consistent snapshot for InnoDB tables, but not for MyISAM, which needs a full lock. Restore speed is a problem for both, for the same reason: rebuilding indexes.
</details>

---

**Next:** [PostgreSQL vs MySQL →](./23-postgresql-vs-mysql.md) — the whole comparison in one place.
