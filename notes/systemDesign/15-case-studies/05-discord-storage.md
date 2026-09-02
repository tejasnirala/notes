---
title: Discord's Storage Migrations
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Discord's Storage Migrations

> **The claim:** Discord moved message storage from MongoDB to Cassandra, then years later from Cassandra to ScyllaDB — each time because the previous choice failed in a way that only appeared at their next order of magnitude.
>
> *Source: Discord engineering blog, "How Discord Stores Billions of Messages" (2017) and "How Discord Stores Trillions of Messages" (2023).*

<C color="orange">A case study in something rarer than a rewrite: the same team, the same problem, twice</C> — which makes the second decision unusually informative.

<Plain>

A company stores customer letters.

**Filing cabinets** work well until there are too many to fit in the building.

**A warehouse system** is installed — designed for enormous volume, and it delivers. Millions of letters, no problem.

Then a specific failure keeps recurring. <C color="crimson">Every so often the whole warehouse pauses.</C> Not because it is full or broken — the automated tidying system stops everything to reorganise shelves, and while it does, nobody can retrieve anything.

Most days it is a few seconds and nobody notices. On the busiest days it takes much longer, and it happens precisely when demand is highest, because more activity means more tidying.

Worse, one popular shelf receives most of the traffic. <C color="crimson">Requests for it queue while the rest of the warehouse is idle.</C>

The team tries everything: tuning the tidying schedule, adding staff, reorganising shelves. It helps and does not fix it, because the pausing is **built into how the system works.**

Eventually they replace it with a warehouse built on the same organising principles and a completely different control system — one that does its tidying **without stopping everything**, and that gives each shelf its own attendant so a busy shelf does not block the others.

<H>The second migration was not about capacity. It was about a specific, structural source of unpredictable pauses that no amount of tuning could remove.</H>

</Plain>

---

## 1. Why MongoDB was left

The first migration, around 2015–2017. The immediate cause was a scale threshold:

- Message volume was growing rapidly, heading past 100 million messages.
- <C color="crimson">The working set no longer fitted in memory</C>, so random reads hit disk and latency became unpredictable.
- Sharding and operational behaviour at their access pattern were not what they needed.

**The access pattern is the key detail**, and it drove the choice that followed. Messages are:

- <C color="green">Written once, essentially never updated.</C>
- <C color="green">Read by channel, in reverse time order.</C>
- Rarely read outside a recent window, except when someone scrolls history.

<Jargon
  plain="Grouping rows so that everything you read together is stored together, in the order you read it."
  term="partition key and clustering key"
  also={['wide-column data modelling']}>

Cassandra's model fits this exactly: <C color="green">partition by channel, cluster by message id descending.</C> A channel's recent messages are physically contiguous and already in the read order, so fetching them is a single sequential scan.

</Jargon>

The partition key was `(channel_id, bucket)` — bucketing by time so a very active channel's partition does not grow without bound.

---

## 2. Why Cassandra was left

Cassandra worked, at trillions of messages. <C color="orange">The problems were operational and structural rather than about capacity.</C>

<Trace title="The three failures that accumulated" subtitle="None was a capacity limit.">

<TraceStep
  title="Latency spikes from garbage collection"
  cost="unpredictable pauses"
  state={{ 'Cause': 'JVM GC pauses', 'Effect': 'p99 spikes', 'Tuning helped': 'partially', 'Structural': 'yes' }}
  changed={['Cause', 'Effect', 'Structural']}
  note="A managed-runtime cost that tuning mitigates and cannot eliminate.">

Cassandra runs on the JVM. <C color="crimson">Garbage collection pauses produced latency spikes</C> that were tunable but never removable, and worsened as heap sizes grew.

</TraceStep>

<TraceStep
  title="Compaction competing with live traffic"
  cost="worse when busiest"
  state={{ 'Cause': 'LSM compaction', 'Effect': 'IO contention', 'When worst': 'peak traffic', 'Structural': 'yes' }}
  changed={['Cause', 'Effect', 'When worst']}
  note="Inherent to LSM storage — the background work that makes writes cheap must eventually run.">

[Compaction](../04-data-storage/03-storage-engines.md) consumes disk and CPU, and <C color="crimson">more writes means more compaction — so it competes hardest exactly when traffic peaks.</C>

</TraceStep>

<TraceStep
  title="Hot partitions"
  cost="one channel saturates a node"
  state={{ 'Cause': 'a very busy channel', 'Effect': 'one node overloaded', 'Others': 'idle', 'Structural': 'yes' }}
  changed={['Cause', 'Effect', 'Others']}
  note="The tail of the distribution again — a huge public channel is to messaging what a celebrity is to a timeline.">

<C color="crimson">A single extremely active channel hashes to one partition on one set of replicas</C>, saturating those nodes while the rest of the cluster is idle.

</TraceStep>

<TraceStep
  title="The workaround, and its own problem"
  state={{ 'Fix attempted': 'request coalescing in a data service', 'Effect': 'reduced duplicate reads', 'Underlying cause': 'still present', 'Verdict': 'mitigation, not fix' }}
  changed={['Fix attempted', 'Effect', 'Verdict']}
  note="A genuinely good mitigation — collapsing concurrent identical reads into one — that treats the symptom.">

<C color="green">A data service in front of the database coalesced concurrent identical requests</C>, so a hot channel produced one database read rather than thousands.

Effective, and the node-level hotspot remained.

</TraceStep>

<TraceStep
  title="Move to ScyllaDB"
  state={{ 'Compatibility': 'same data model and protocol', 'GC pauses': 'none — C++, no managed runtime', 'Concurrency': 'shard-per-core', 'Verdict': 'structural fix' }}
  changed={['Compatibility', 'GC pauses', 'Concurrency', 'Verdict']}
  note="Same model, different implementation — which is why the migration was feasible at all.">

ScyllaDB implements Cassandra's data model and wire protocol in **C++**, with a **shard-per-core** architecture.

<H>Because the data model was unchanged, this was a migration of *data and operations* rather than a redesign — the schema, the queries and the application code carried over.</H>

</TraceStep>

</Trace>

---

## 3. What generalises

<Depth title="Choosing an implementation versus choosing a model, and the cost of a runtime">

**The most useful distinction this case makes** is between a **data model** and its **implementation**.

Discord's move from MongoDB to Cassandra was a **model** change: from documents to wide-column, with a different way of thinking about partitioning and access patterns. It required redesigning the schema and the queries.

The move from Cassandra to ScyllaDB was an **implementation** change: same model, same query language, same partition and clustering semantics. <C color="green">Enormously cheaper</C>, because everything above the storage layer stayed as it was.

<H>When a database's *model* fits and its *implementation* does not, look for a different implementation of the same model before redesigning. The second migration is a fraction of the cost of the first.</H>

Comparable pairs worth knowing: MySQL and MariaDB · PostgreSQL and its distributed derivatives · Cassandra and ScyllaDB · Redis and its API-compatible alternatives.

**On the runtime cost.** GC pauses are a recurring theme in latency-sensitive infrastructure, and the pattern is consistent: managed runtimes give you productivity and safety at the cost of **unpredictable pauses that grow with heap size**. For a stateless application server that is usually irrelevant. <C color="crimson">For a stateful data node holding tens of gigabytes, it becomes a p99 problem you cannot tune away</C>, only mitigate.

This is why so much recent infrastructure is written in C++, Rust or Go — and why the ones written in Go still face it, more gently, since Go's collector has short pauses but is not pause-free.

<C color="orange">The design lesson is not "avoid the JVM"</C> — Cassandra ran Discord's workload for years at enormous scale. It is that **the runtime is part of the operational profile of a data store**, and it belongs in the evaluation alongside the data model.

**On shard-per-core.** ScyllaDB pins one shard to each CPU core with its own memory and its own slice of data, communicating by message passing rather than shared memory. <C color="green">This removes lock contention entirely</C> and makes performance scale predictably with cores. The same architecture appears in Redis's threaded I/O model, in Seastar-based systems generally, and in the general move away from shared-memory concurrency for data-plane software.

**On hot partitions, which no engine fixes.** <C color="crimson">Both Cassandra and ScyllaDB hash a partition key to specific nodes, so an extremely hot key overloads those nodes regardless of implementation.</C> The mitigations are architectural rather than about the database:

- **Request coalescing** in front — collapsing concurrent identical reads into one, which is what Discord's data services do.
- **Sub-partitioning** hot keys — adding a bucket to the partition key, at the cost of reads needing to query several buckets.
- **A caching tier** for the hottest partitions.

This is the same [hot key problem](../07-caching/04-cache-failure-modes.md) as everywhere else, and the same answers apply.

**The reading that transfers.** Neither migration was triggered by running out of capacity. <C color="green">The first was triggered by a working set exceeding memory; the second by structural latency variance and hotspots.</C> Both are qualities of behaviour rather than limits of size — and both were only visible at the scale they occurred, which is the honest reason the first choice was not "wrong".

</Depth>

---

## Rapid-fire recall

1. What access pattern do messages have, and why does it suit a wide-column store?
2. What was the partition key, and why was a time bucket included?
3. Name the three failures that accumulated with Cassandra.
4. Why does compaction cause problems precisely when traffic is highest?
5. What is a hot partition here, and why does changing engines not fix it?
6. What did request coalescing achieve, and what did it not?
7. Why was the Cassandra-to-ScyllaDB migration far cheaper than the first one?
8. State the distinction between changing a model and changing an implementation.
9. Why do GC pauses matter more for a data node than an application server?
10. What does shard-per-core remove, and where else does the architecture appear?

<details>
<summary>Answers</summary>

1. Messages are **written once, never updated, read by channel in reverse time order**, and mostly read within a recent window. A wide-column store can **partition by channel and cluster by message id descending**, making a channel's recent messages contiguous and already in read order.
2. **`(channel_id, bucket)`** — the time bucket prevents a very active channel's partition from growing without bound.
3. **JVM garbage collection pauses** causing latency spikes · **LSM compaction** competing with live traffic for disk and CPU · **hot partitions** where one busy channel saturates a single set of replicas.
4. Because **more writes produce more compaction work**, so the background load is heaviest exactly when foreground traffic peaks — the two contend for the same disk and CPU.
5. A **single extremely active channel** whose partition key hashes to one set of replicas, saturating them while the rest of the cluster idles. Changing engines does not fix it because **any engine hashes the partition key to specific nodes**.
6. It **collapsed concurrent identical reads into one database query**, greatly reducing duplicate load from a hot channel. It did **not** remove the underlying node-level hotspot — it treated the symptom.
7. Because it changed the **implementation, not the model**. ScyllaDB shares Cassandra's data model and wire protocol, so the schema, queries and application code carried over — a data and operations migration rather than a redesign.
8. <H>A model change alters how you think about partitioning and querying and requires redesign. An implementation change keeps the model and swaps what runs underneath — a fraction of the cost.</H>
9. Because a data node holds **tens of gigabytes of heap**, and pause duration grows with heap size. A stateless application server can be restarted or load-balanced around; a data node's pause is a **p99 problem for every client** and cannot be tuned away, only mitigated.
10. It removes **lock contention** by giving each core its own shard, memory and data slice, communicating by message passing. The architecture appears in **Seastar-based systems**, Redis's threaded I/O, and generally in modern data-plane software moving away from shared-memory concurrency.

</details>

---

**Next:** [Figma's Sharding](./06-figma-sharding.md) — splitting a Postgres database without stopping.
