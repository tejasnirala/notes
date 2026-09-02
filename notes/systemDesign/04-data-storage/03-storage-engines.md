---
title: Storage Engines — B-Tree vs LSM
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Storage Engines — B-Tree vs LSM

> **What you will be able to do after this page**
>
> - Explain why some databases are fast to write and others fast to read, in mechanism.
> - Trace a write through an LSM tree, from memory to compacted file.
> - Define read, write and space amplification, and say which engine pays which.
> - Predict which engine a workload wants, from the read:write ratio alone.

Two designs sit underneath almost every database you will use. <C color="orange">Knowing which one you are on explains most of its performance behaviour</C> — and it is the layer beneath the SQL/NoSQL question, which is why "Postgres vs Cassandra" is really "B-tree vs LSM" wearing a different label.

<Plain>

You run an office and paperwork arrives all day. Two ways to handle it.

**File each document immediately.** Someone walks to the cabinet, finds the right drawer, opens it, and slots the page into position. Retrieval is wonderful — everything is always exactly where it should be. But every single document costs a walk to the cabinet, and if two arrive at once, one waits.

**Drop everything in an in-tray, and sort in batches.** Filing costs nothing now: put it on the pile. Later, someone takes the whole tray and merges it into the cabinet in one efficient pass.

The second way accepts far more paperwork per hour, because writing to a pile is cheap and batch-filing is efficient. The cost lands on **retrieval**: to find a document you check the in-tray first, then yesterday's tray, then the cabinet — several places instead of one.

And there is a subtler cost. When you throw a document away, you cannot reach into the cabinet mid-batch; you write *"discard the blue form"* on a note and drop it in the tray. So for a while, <C color="orange">the office holds both the document and the note saying to delete it</C> — using more space than the information actually requires, until the next merge cleans up.

Those are the two storage engines, and neither is better. **The cabinet is B-tree. The in-tray is LSM.**

</Plain>

---

## 1. B-trees — update in place

Postgres, MySQL/InnoDB, Oracle, SQL Server, SQLite. Almost every traditional relational database.

Data lives in fixed-size **pages** (typically 8 or 16 KB) arranged as a balanced tree. A write finds the correct page and modifies it **where it sits**.

```
  WRITE PATH

  1. Find the leaf page for this key            ~3–4 page reads (usually cached)
  2. Write the change to the WAL first          sequential append — this is the durability point
  3. Modify the page in the buffer pool         in memory
  4. Mark the page dirty                        flushed to disk later, in the background
```

Two properties follow directly:

**Reads are excellent and predictable.** One key lives in exactly one place. Finding it is a tree descent — three or four page reads, bounded, no ambiguity.

**Writes cost more than they look.** A 100-byte update rewrites an entire 8 KB page. Worse, a page that has no room for the new entry must **split** — allocate a new page, move half the entries, update the parent, possibly splitting it too.

<Jargon
  plain="A log of every change, written before the change itself, so a crash can be recovered from."
  term="the write-ahead log, or WAL"
  also={['redo log', 'journal', 'commit log']}>

The rule is in the name: <C color="green">the log entry hits disk **before** the data page changes.</C> After a crash, the engine replays the log to redo committed work and undo incomplete work. It is what makes the **D** in ACID possible, and it is why a "durable" write is really a sequential append rather than a random page write.

</Jargon>

---

## 2. LSM trees — never modify, only append

Cassandra, RocksDB, LevelDB, ScyllaDB, HBase, InfluxDB, and MySQL's MyRocks. Also the storage layer under many time-series and key-value stores.

**LSM** — Log-Structured Merge tree. The core idea is that <C color="green">you never modify data on disk. You only ever write new files and merge them later.</C>

Follow one key through its whole life:

<Trace title="A write through an LSM tree" subtitle="Setting user:42 → 'Ana', then updating it, then deleting it.">

<TraceStep
  title="Write arrives — append to the commit log"
  state={{ 'Memtable': 'empty', 'SSTables on disk': '0', 'Read cost for user:42': 'n/a', 'Space used': 'minimal' }}
  note="Sequential append. No seeking, no page to locate — this is why LSM write throughput is so high.">

`SET user:42 = 'Ana'` is first appended to a commit log for durability.

</TraceStep>

<TraceStep
  title="Insert into the memtable"
  cost="~0 disk I/O"
  state={{ 'Memtable': "user:42 → 'Ana'", 'SSTables on disk': '0', 'Read cost for user:42': '1 memory lookup', 'Space used': 'minimal' }}
  changed={['Memtable', 'Read cost for user:42']}
  note="A sorted in-memory structure — usually a skip list or balanced tree. The write is now complete from the client's perspective.">

The value goes into an in-memory sorted structure. <C color="green">The client's write is acknowledged with no random disk I/O at all.</C>

</TraceStep>

<TraceStep
  title="Memtable fills — flush to an SSTable"
  cost="1 sequential write"
  state={{ 'Memtable': 'empty (new)', 'SSTables on disk': '1', 'Read cost for user:42': '1 file', 'Space used': '1 copy' }}
  changed={['Memtable', 'SSTables on disk', 'Read cost for user:42', 'Space used']}
  note="Written once, sequentially, and never modified again. Immutability is what makes the whole design work.">

At a size threshold (say 64 MB) the memtable is written to disk as an **SSTable** — a Sorted String Table, immutable, with a small index.

</TraceStep>

<TraceStep
  title="The value is updated"
  cost="no in-place edit"
  state={{ 'Memtable': "user:42 → 'Anna'", 'SSTables on disk': '1', 'Read cost for user:42': 'memtable hit', 'Space used': '2 copies' }}
  changed={['Memtable', 'Read cost for user:42', 'Space used']}
  note="Two versions now exist. Nothing has been overwritten — the old SSTable is immutable.">

`SET user:42 = 'Anna'` goes into the **new** memtable. <C color="orange">The old value still sits in SSTable 1, untouched.</C> Recency decides which wins.

</TraceStep>

<TraceStep
  title="Several flushes later — reads get expensive"
  cost="read amplification"
  state={{ 'Memtable': 'other keys', 'SSTables on disk': '6', 'Read cost for user:42': 'up to 7 places', 'Space used': 'multiple copies' }}
  changed={['Memtable', 'SSTables on disk', 'Read cost for user:42']}
  note="This is the LSM read problem in one line — and why Bloom filters are not optional here.">

Reading `user:42` now means checking the memtable, then **each SSTable newest-first**, until the key is found.

<C color="crimson">A key that does not exist is the worst case — every file must be checked before you can say "not found".</C> This is why every LSM engine keeps a **Bloom filter** per SSTable: a tiny probabilistic structure that answers *"definitely not here"* in memory, skipping the file entirely.

</TraceStep>

<TraceStep
  title="The key is deleted — a tombstone"
  cost="space grows on delete"
  state={{ 'Memtable': 'user:42 → ⌫ tombstone', 'SSTables on disk': '6', 'Read cost for user:42': 'tombstone found first', 'Space used': 'MORE than before' }}
  changed={['Memtable', 'Read cost for user:42', 'Space used']}
  note="Deleting uses more space than not deleting, until compaction runs. Genuinely counter-intuitive, and a real operational trap.">

You cannot erase from an immutable file, so a **tombstone** marker is written instead — a record saying *"this key is deleted"*.

Reads find the tombstone first and correctly report nothing. But <C color="crimson">the old values are all still on disk</C>, plus the tombstone.

</TraceStep>

<TraceStep
  title="Compaction — merge and discard"
  cost="background I/O"
  state={{ 'Memtable': 'other keys', 'SSTables on disk': '2', 'Read cost for user:42': '1–2 files', 'Space used': 'reclaimed' }}
  changed={['SSTables on disk', 'Read cost for user:42', 'Space used']}
  note="Compaction is what keeps reads bounded and space in check — and it competes with live traffic for disk and CPU.">

A background process merges SSTables: obsolete versions are dropped, tombstoned keys disappear, and files are rewritten sorted.

<H>Compaction is the price of cheap writes. It runs forever, consumes disk bandwidth and CPU, and if it falls behind, read latency and disk usage both grow until something breaks.</H>

</TraceStep>

</Trace>

---

## 3. The three amplifications

The vocabulary for comparing engines precisely. Every storage engine trades these three against each other.

<Jargon
  plain="How much extra work the database does beyond the bytes you actually asked for."
  term="read, write and space amplification"
  also={['the amplification factors', 'RUM (read-update-memory)']}>

**Read amplification** — disk reads per logical read. **Write amplification** — bytes written per logical byte. **Space amplification** — disk used per byte of live data. <C color="orange">You can optimise any two at the expense of the third; no design wins all three.</C>

</Jargon>

| | B-tree | LSM |
| :--- | :--- | :--- |
| **Read amplification** | <C color="green">Low — one place, ~4 page reads</C> | <C color="crimson">Higher — several SSTables, mitigated by Bloom filters</C> |
| **Write amplification** | <C color="crimson">High — full page rewritten per change, plus WAL, plus splits</C> | <C color="orange">Also high, but sequential — data rewritten several times by compaction</C> |
| **Space amplification** | <C color="orange">Moderate — pages sit ~⅔ full due to splits</C> | <C color="crimson">Higher — obsolete versions and tombstones until compacted</C> |
| **Write pattern** | Random | <C color="green">Sequential</C> |
| **Compression** | <C color="orange">Weaker — fixed pages</C> | <C color="green">Better — large immutable blocks</C> |
| **Latency profile** | <C color="green">Predictable</C> | <C color="crimson">Spiky — compaction competes with live traffic</C> |

The write-amplification row deserves care, since both are "high" but for different reasons and with very different consequences:

```
  B-tree:  100-byte update → 8 KB page write, in a RANDOM location
           On an HDD that is a seek. On an SSD it is a page-program.

  LSM:     100-byte update → appended sequentially, ~0 cost now,
           then rewritten ~10–30× over its life by compaction,
           always SEQUENTIALLY.
```

<C color="orange">LSM often writes *more total bytes* than a B-tree, and still achieves far higher write throughput</C> — because [sequential I/O is dramatically faster than random](../01-foundations/04-latency-numbers.md), by up to 1000× on spinning disks and still ~10× on SSDs. It is a straight trade of total work for access pattern.

<Depth title="Compaction strategies, and the write-vs-space choice">

Compaction is where an LSM's real behaviour is decided, and the strategy is usually the most consequential tuning knob available.

**Size-tiered compaction (STCS)** — Cassandra's default. SSTables of similar size are merged together; the output is roughly the sum of the inputs, so files grow geometrically in tiers.

- <C color="green">Low write amplification</C> — each record is rewritten relatively few times.
- <C color="crimson">High space amplification</C> — merging four 100 GB files needs 400 GB of free space to produce the output before deleting the inputs. The classic guidance of *"keep 50% of your disk free"* comes from exactly this.
- <C color="crimson">Higher read amplification</C> — a key may live in any tier, so more files must be consulted.

**Leveled compaction (LCS)** — LevelDB, RocksDB, and Cassandra optionally. Data is organised into levels, each ~10× larger than the last, and within a level SSTables have **non-overlapping key ranges**.

- <C color="green">Low read amplification</C> — at most one SSTable per level can contain a given key, so lookups are bounded by the level count.
- <C color="green">Low space amplification</C> — typically ~10% overhead, since obsolete data is cleaned promptly.
- <C color="crimson">High write amplification</C> — a record may be rewritten 10–30× as it migrates down levels. On write-saturated systems compaction can consume most of the disk bandwidth.

**Time-window compaction (TWCS)** — for time-series data. SSTables are grouped by time window and only compacted within a window.

- <C color="green">Excellent when data is written once, read by time range, and expires wholesale</C> — an entire window's files are deleted at once when the TTL passes, with no merge work at all.
- <C color="crimson">Wrong for any workload that updates old data</C>, since old windows are never rewritten.

**The choice, summarised:**

| Workload | Strategy |
| :--- | :--- |
| Write-heavy, disk is plentiful | <C color="green">Size-tiered</C> |
| Read-heavy, space matters | <C color="green">Leveled</C> |
| Time-series with TTLs | <C color="green">Time-window</C> |

**The operational failure to know about:** if writes arrive faster than compaction can keep up, SSTable count grows without bound. Read amplification rises, so reads slow down; disk fills with obsolete data; and compaction — already behind — now competes with degraded live traffic. <C color="crimson">This is a positive feedback loop that does not self-correct</C>, and "pending compactions" is therefore the metric to alert on for any LSM database. The fix is throttling writes, adding compaction throughput, or adding nodes — and it must happen well before the disk fills.

</Depth>

---

## 4. Bloom filters — why LSM reads are survivable

An LSM read may have to check many files. A **Bloom filter** makes most of those checks free.

A bit array plus `k` hash functions. To add a key, set the bits its hashes point to. To test a key, check those bits:

```
  all bits set   →  "probably present"  →  must actually read the file
  any bit unset  →  "definitely absent" →  skip the file entirely
```

<C color="green">False positives are possible; false negatives are not.</C> That asymmetry is exactly what is needed — a false positive costs one wasted file read, while a false negative would return wrong data.

With ~10 bits per key you get roughly a **1% false-positive rate**, at about 1.2 MB per million keys held in memory. So a lookup for a key that is genuinely absent skips ~99% of SSTables without touching disk.

<H>Bloom filters are what make LSM reads acceptable rather than terrible. Without them, "not found" would require reading every file on disk.</H>

---

## 5. Choosing

| Workload | Engine | Why |
| :--- | :--- | :--- |
| Read-heavy, complex queries | <C color="green">B-tree</C> | Predictable reads; range scans without merging |
| Write-heavy ingest (events, metrics, logs) | <C color="green">LSM</C> | Sequential writes absorb far higher throughput |
| Mixed OLTP with transactions | <C color="green">B-tree</C> | Mature transaction support, stable latency |
| Time-series with TTL expiry | <C color="green">LSM</C> + time-window compaction | Whole windows dropped without merge work |
| Latency-sensitive p99 | <C color="orange">B-tree</C> | LSM's compaction produces latency spikes |
| Large data, compression matters | <C color="green">LSM</C> | Immutable blocks compress much better |

**In practice you rarely choose the engine directly** — you choose a database, and the engine comes with it. But knowing which one you are on tells you what to expect:

- On Postgres, a sudden write slowdown may be **page splits** or WAL pressure — check `full_page_writes` and checkpoint tuning.
- On Cassandra, a sudden read slowdown is very often **compaction falling behind**; check pending compactions before anything else.
- On either, a delete that *increases* disk usage means an LSM and tombstones, and it is expected rather than a bug.

> Note that MySQL lets you pick: InnoDB is a B-tree, MyRocks is an LSM. Same SQL, same transactions, very different performance envelope — MyRocks exists specifically because Facebook's write volume made InnoDB's write amplification untenable.

---

## 6. In a design discussion

- **"Write-heavy event ingest, so an LSM store — the writes are sequential and compaction happens off the request path."** Ties the engine to the traffic shape.
- **"LSM writes more total bytes than a B-tree but achieves higher throughput, because the writes are sequential rather than random."** The non-obvious point, stated correctly.
- **"Deletes are tombstones, so disk usage goes up until compaction runs — worth knowing before someone pages us about it."** Operational awareness.
- **"I'd alert on pending compactions; if compaction falls behind, reads and disk usage degrade together and it doesn't recover on its own."** The specific failure mode.

---

## Rapid-fire recall

1. What does a B-tree do on a write that an LSM never does?
2. Why does a 100-byte update cost 8 KB in a B-tree, and what is a page split?
3. What is a WAL, and what does "write-ahead" mean literally?
4. Trace an LSM write from arrival to disk, naming each structure.
5. Why is reading a **non-existent** key the LSM worst case, and what fixes it?
6. Why can a delete increase disk usage on an LSM?
7. Define the three amplifications and state which engine pays most of each.
8. LSM writes more total bytes yet achieves higher throughput. Explain.
9. Compare size-tiered and leveled compaction on write and space amplification.
10. Why are Bloom filter false positives acceptable but false negatives not?

<details>
<summary>Answers</summary>

1. **Modify data in place.** A B-tree finds the correct page and rewrites it; an LSM only ever appends new files and merges them later.
2. Because the page is the **unit of I/O** — the whole 8 KB page is rewritten regardless of how few bytes changed. A **page split** happens when a page has no room for a new entry: a new page is allocated, roughly half the entries move to it, and the parent is updated — which can cascade upward.
3. The **write-ahead log**: a sequential record of every change. "Write-ahead" means the log entry reaches disk **before** the data page is modified, so a crash can be recovered by replaying committed changes and undoing incomplete ones.
4. Appended to the **commit log** for durability → inserted into the in-memory sorted **memtable** → flushed at a size threshold to an immutable **SSTable** on disk → later merged with other SSTables by **compaction**.
5. Because the key must be looked for in the memtable and **every** SSTable before "not found" can be concluded — there is no early exit. **Bloom filters** per SSTable answer "definitely absent" in memory, skipping ~99% of files.
6. Immutable files cannot be edited, so a delete writes a **tombstone** marker. Until compaction runs, the disk holds the old values **and** the tombstone — more data than before the delete.
7. **Read amplification** (disk reads per logical read) — worse on LSM. **Write amplification** (bytes written per logical byte) — high on both, but random on B-tree and sequential on LSM. **Space amplification** (disk per byte of live data) — worse on LSM, from obsolete versions and tombstones.
8. Because **sequential I/O is far faster than random** — up to 1000× on spinning disks, ~10× on SSDs. LSM trades more total bytes written for a better access pattern, and the access pattern dominates.
9. **Size-tiered**: low write amplification, but high space amplification (merging four 100 GB files needs 400 GB free) and higher read amplification. **Leveled**: low read and space amplification (~10% overhead), but high write amplification — records rewritten 10–30× as they migrate down levels.
10. A **false positive** costs one unnecessary file read — a performance cost only. A **false negative** would report a key as absent when it exists, returning **wrong data** — a correctness failure. The structure is deliberately built to make only the harmless error possible.

</details>

---

**Next:** [Transactions & Isolation Levels](./04-transactions-and-isolation.md) — what ACID actually promises, and the anomalies each level still allows.
