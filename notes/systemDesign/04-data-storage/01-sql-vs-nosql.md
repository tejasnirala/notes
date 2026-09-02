---
title: SQL vs NoSQL
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# SQL vs NoSQL

> **What you will be able to do after this page**
>
> - Name the five NoSQL families and what each is genuinely good at.
> - Explain why "NoSQL scales better" is mostly false, and what the real trade is.
> - Choose a database from access patterns rather than from reputation.
> - Say what you give up when you leave the relational model — precisely.

This is the most common database question in interviews and the one most often answered badly, because the popular framing — <C color="crimson">*"SQL for structure, NoSQL for scale"*</C> — is close to wrong.

<Plain>

Two ways to keep records for a shop.

**A filing cabinet with printed forms.** Every customer record has the same fields in the same places. If someone leaves the postcode blank, the form is rejected. Because everything is uniform, you can ask complicated questions — *"which customers in this city bought more than twice last year?"* — and get a reliable answer, because every record is guaranteed to have those fields filled in properly.

**A shelf of folders.** Each customer gets a folder and you put whatever is relevant inside. One has a phone number, another has three addresses and a note about a delivery preference. Nothing is rejected, nothing has to match. Adding a new kind of information takes no planning at all.

Now the important part, because this is where people usually go wrong.

The folders are not *faster*. Pulling one folder off the shelf is quick, and so is pulling one form from a well-organised cabinet. What the folders give up is the **guarantee that records relate to each other correctly** — with forms, the shop's system can refuse to delete a customer who still has open orders. With folders, nothing stops you, and you find out later.

<C color="orange">So the real question is never "which is faster". It is: how much of the checking do you want the database to do, and how much are you willing to do yourself?</C>

</Plain>

---

## 1. What "relational" actually gives you

Before comparing, be precise about what is on offer. A relational database provides four things that are easy to take for granted:

| Guarantee | What it means | What you do without it |
| :--- | :--- | :--- |
| **Schema enforcement** | Every row has the declared columns and types | Validate in every service that writes, and hope none is missed |
| **Joins** | Combine tables at query time | Denormalize, or make N queries and join in application code |
| **Transactions** | Multiple changes commit or roll back together | Build compensating logic for partial failures |
| **Referential integrity** | An order cannot point at a customer who does not exist | Discover orphaned rows in production, months later |

<H>Those four are not features you can bolt on later. Leaving them behind is the actual decision — everything else in this comparison is downstream of it.</H>

<Jargon
  plain="Whether the database checks the shape of your data when you write it, or you interpret it when you read it."
  term="schema-on-write vs schema-on-read"
  also={['strict schema vs flexible schema']}>

Relational databases are **schema-on-write**: a bad row is rejected at insert time. Document stores are typically **schema-on-read**: anything is accepted, and the reader deals with whatever it finds. <C color="orange">The data always has a schema — the only question is whether it is written down and enforced, or lives implicitly in application code.</C>

</Jargon>

---

## 2. The five NoSQL families

"NoSQL" describes five genuinely different things that share only a negation. Grouping them together is the source of most confusion.

### Key–value

`GET key` → `value`. Nothing else. Redis, DynamoDB (in its simplest use), Memcached.

<C color="green">Fastest possible lookups; trivially partitionable</C>, since the key decides the shard.
<C color="crimson">You can only ever fetch by exact key.</C> No querying by anything inside the value.

**Right for:** caches, sessions, feature flags, rate-limit counters, anything with one obvious lookup key.

### Document

Stores JSON-like documents, queryable by fields inside them. MongoDB, Couchbase, DynamoDB with secondary indexes.

<C color="green">Flexible shape; a whole aggregate lives in one place, so one read fetches everything about an entity.</C>
<C color="crimson">Joins are weak or absent; relationships must be denormalized or resolved in application code.</C>

**Right for:** content, catalogues, user profiles, event payloads — data naturally read as a whole document.

### Wide-column

Rows keyed by a partition key, with a sorted clustering key inside each partition. Cassandra, ScyllaDB, HBase, Bigtable.

<C color="green">Enormous write throughput; linear scaling; excellent for time-ordered data within a partition.</C>
<C color="crimson">You must know your queries before designing the schema</C> — the partition key is chosen for the query, and a query it does not support is effectively impossible.

**Right for:** time series, event logs, message histories, feeds — huge write volume with a known access pattern.

### Graph

Nodes and edges as first-class objects. Neo4j, Neptune, TigerGraph.

<C color="green">Traversals stay cheap regardless of depth</C> — "friends of friends of friends" is a walk, not three joins.
<C color="crimson">Harder to shard</C>, since a graph resists partitioning by nature, and aggregate queries are weaker.

**Right for:** social graphs, recommendations, fraud rings, dependency and permission trees.

### Search

Inverted indexes over text. Elasticsearch, OpenSearch, Solr.

<C color="green">Full-text relevance ranking, fuzzy matching, faceting, aggregations.</C>
<C color="crimson">Not a system of record</C> — near-real-time rather than immediately consistent, and unsuited to being your only copy of the data.

**Right for:** search boxes, log analytics, dashboards — always **alongside** a primary store, never instead of one.

---

## 3. The scaling claim, examined

The usual justification for NoSQL is that it scales better. Here is what is actually true.

**True:** many NoSQL systems were designed from the start to run on many machines, with partitioning and replication built in rather than added on.

**Also true, and usually omitted:** <C color="orange">they achieve that by removing the features that are hard to distribute.</C>

```
  What is hard to distribute, and why:

  JOIN across two tables      →  needs data from two machines. Network round trips,
                                 or one machine pulling everything.
  Multi-row TRANSACTION      →  needs agreement across machines. Two-phase commit,
                                 locks held across the network, coordinated failure.
  Referential integrity      →  needs a check against a row that lives elsewhere,
                                 on every write.
  Global UNIQUE constraint   →  needs to consult every shard on every insert.
```

<H>NoSQL databases did not solve distributed joins and distributed transactions. They removed them — which is a completely legitimate engineering choice, and a very different claim.</H>

Two further corrections worth having ready:

**Relational databases shard too.** Vitess runs MySQL at YouTube scale; Citus does it for Postgres. The work moves into the application (you must pick a shard key and avoid cross-shard queries) — which is exactly the same work a wide-column store makes you do up front. <C color="orange">The difference is when you are forced to think about it, not whether.</C>

**A single Postgres instance is far larger than people assume.** Tens of thousands of QPS, terabytes of data, on one well-provisioned machine. The scale at which relational genuinely stops working is much further away than the discourse suggests, and [the scaling ladder](../01-foundations/06-thinking-in-tradeoffs.md) has several cheaper rungs before it.

<Depth title="What NewSQL changed, and why distributed transactions got practical">

For about a decade the trade looked binary: relational guarantees on one machine, or scale without them. That is no longer accurate, and it is worth knowing why.

**The obstacle was always time.** A distributed transaction must decide a global order for operations happening on different machines. Machines have independent clocks that drift, so you cannot simply timestamp events and sort them — a write on machine A stamped 10:00:00.100 may genuinely have happened after one on machine B stamped 10:00:00.200. Traditional two-phase commit avoids clocks by using a coordinator and locks, but that means holding locks across the network for the duration, which is slow and fragile: a coordinator failure can leave participants blocked indefinitely.

**Google Spanner's move was to make clock uncertainty explicit rather than pretend it away.** Using GPS receivers and atomic clocks in every datacenter, its `TrueTime` API returns not a timestamp but an **interval** — "the current time is between `earliest` and `latest`", with the uncertainty typically a few milliseconds. To commit a transaction, Spanner picks a timestamp and then **waits out the uncertainty window** before making it visible. That wait guarantees that any transaction starting afterwards sees a strictly later timestamp, which yields **external consistency** — the strongest guarantee available in a distributed database — at the cost of a few milliseconds of commit latency.

**CockroachDB and YugabyteDB reach a similar place without atomic clocks**, using hybrid logical clocks and, when uncertainty cannot be resolved, restarting the transaction. Slightly weaker guarantees, no exotic hardware.

**What this means practically:**

| | Traditional relational | Classic NoSQL | NewSQL |
| :--- | :--- | :--- | :--- |
| SQL and joins | <C color="green">Yes</C> | <C color="crimson">No</C> | <C color="green">Yes</C> |
| Multi-key transactions | <C color="green">Yes</C> | <C color="crimson">Usually no</C> | <C color="green">Yes</C> |
| Horizontal write scaling | <C color="crimson">Manual sharding</C> | <C color="green">Built in</C> | <C color="green">Built in</C> |
| Write latency | <C color="green">Low</C> | <C color="green">Low</C> | <C color="orange">Higher — coordination is not free</C> |
| Operational complexity | <C color="green">Low</C> | Medium | <C color="crimson">High</C> |

The honest summary: <C color="green">NewSQL genuinely removes the old either/or</C>, and it charges for it in write latency and operational complexity. For a system that truly needs both transactions and horizontal write scaling, it is now a real option rather than a research paper. For most systems, <C color="orange">a single Postgres with read replicas remains simpler, cheaper and faster</C> — and choosing a distributed SQL database before you have a distribution problem is the same mistake as choosing Cassandra before you have a write-volume problem.

</Depth>

---

## 4. The same data, both ways

Model an e-commerce order relationally and as a document, then ask the same two questions of each:

<Trace title="One dataset, two models, two very different queries" subtitle="Orders with line items. Watch what each model makes easy and what it makes hard.">

<TraceStep
  title="Relational — data split across tables"
  state={{ 'Model': 'normalized, 3 tables', 'Product price stored': 'once', 'Read one order': '—', 'Top products query': '—' }}
  changed={['Model', 'Product price stored']}
  note="Each fact lives in exactly one place. That is the defining property of a normalized model.">

`customers`, `orders`, `order_items` — with `order_items` referencing both an order and a product. A product's name and price live only in `products`.

</TraceStep>

<TraceStep
  title="Document — the whole order in one place"
  state={{ 'Model': 'one document per order', 'Product price stored': 'copied into every order', 'Read one order': '—', 'Top products query': '—' }}
  changed={['Model', 'Product price stored']}
  note="The product name and price are copied in — deliberately. That copy is the trade being made.">

One document holding the customer summary and an array of line items, each with the product name and price **embedded**.

</TraceStep>

<TraceStep
  title="Query 1 — display one order"
  cost="document wins"
  state={{ 'Relational': '3 joins, ~4 page reads', 'Document': '1 read', 'Winner': 'document', 'Top products query': '—' }}
  changed={['Relational', 'Document', 'Winner']}
  note="Everything needed for the screen is contiguous on disk. This is the case documents are built for.">

**Relational:** join `orders` → `order_items` → `products`, then to `customers`. Fast, but four tables touched.

**Document:** <C color="green">one lookup by `_id`, everything already there.</C>

</TraceStep>

<TraceStep
  title="Query 2 — top 10 products by revenue last month"
  cost="relational wins"
  state={{ 'Relational': '1 GROUP BY, indexed', 'Document': 'scan every order document', 'Winner': 'relational', 'Top products query': 'done' }}
  changed={['Relational', 'Document', 'Winner', 'Top products query']}
  note="The document model optimised for reading one order and made cross-order questions expensive.">

**Relational:** `SELECT product_id, SUM(...) FROM order_items JOIN ... GROUP BY` — one query the planner handles well.

**Document:** <C color="crimson">there is no `order_items` collection to aggregate.</C> You must scan every order document and unwind its array — or maintain a separate aggregate collection yourself.

</TraceStep>

<TraceStep
  title="The requirement that decides it — a price correction"
  cost="the real difference"
  state={{ 'Relational': 'UPDATE 1 row', 'Document': 'depends on intent', 'Winner': 'neither — it depends', 'Top products query': 'done' }}
  changed={['Relational', 'Document', 'Winner']}
  note="This is the question to ask in an interview, and it decides the model more reliably than any scale estimate.">

A product's price was entered wrong. Fix it.

**Relational:** update one row in `products`; every order now reflects the correct price.

**Document:** update thousands of embedded copies — **unless** you *wanted* orders to keep the price at time of purchase, in which case the copy was correct and relational is the one that needs a `price_at_purchase` column.

<H>The model is decided by whether the copy is a bug or a feature. For an order line, historical price is a feature. For a customer's shipping address, the copy is a bug.</H>

</TraceStep>

</Trace>

---

## 5. Choosing

Ask these, in order:

**1. What are the access patterns?** Not "how much data" — *how will it be read*. Key-value stores and wide-column stores require you to know this in advance; relational lets you defer it, which is worth real money when requirements are still moving.

**2. Do you need transactions across multiple entities?** *"Deduct from this balance and add to that one, or neither."* If yes, that is a strong pull toward relational or NewSQL, and building it yourself is much harder than it sounds.

**3. Is the data actually relational?** Most business data is. Orders belong to customers, comments belong to posts, permissions belong to roles. <C color="crimson">Fighting the relational model on genuinely relational data is a long, losing fight.</C>

**4. What is the write volume?** Below a few thousand writes/second, a single relational primary handles it. Above that, sharding or a wide-column store becomes relevant — see [the estimation page](../01-foundations/05-back-of-the-envelope-estimation.md).

**5. What does the team know?** A team that knows Postgres well will build a better system on Postgres than on a database they are learning during the project. This is a real engineering factor, not a cop-out.

| Situation | Choose |
| :--- | :--- |
| Most applications, most of the time | <C color="green">Relational (Postgres)</C> |
| Cache, session, counter | <C color="green">Key–value (Redis)</C> |
| Content, catalogue, varied shapes | <C color="green">Document</C> |
| Huge write volume, known query pattern | <C color="green">Wide-column (Cassandra)</C> |
| Deep relationship traversal | <C color="green">Graph</C> |
| Full-text search, log analytics | <C color="green">Search — alongside a primary store</C> |
| Global scale *and* transactions | <C color="green">NewSQL (Spanner, CockroachDB)</C> |

<H>Postgres is the correct default. Not because it is the best at everything, but because it is good at nearly everything, and you can defer the decision to specialise until you have evidence you need it.</H>

### Polyglot persistence

Real systems use several. A typical arrangement:

```
  Postgres        orders, users, payments        the system of record
  Redis           sessions, counters, cache      speed
  S3              images, video, backups         cheap bytes at volume
  Elasticsearch   product search                 relevance ranking
  Cassandra       activity events                write volume
```

The cost is real: each store is another thing to operate, back up, monitor and keep consistent with the others. <C color="orange">Add a second database when a specific access pattern demands it, not because the architecture diagram looks more serious with four.</C>

---

## 6. In a design discussion

- **"Postgres, because this data is relational and we need transactions across orders and inventory. I'd revisit if writes exceed a few thousand a second."** States the choice, the reason, and the trigger to change.
- **"Cassandra for the event stream specifically — huge write volume, we always query by user and time range, and we never need to join it."** Justifies from the access pattern.
- **"NoSQL didn't solve distributed joins, it removed them. The question is whether we need them here."** Corrects the framing precisely.
- **"Embedding the price in the order line is deliberate — we want the price at time of purchase, not the current one."** Shows denormalization as a decision rather than an accident.

---

## Rapid-fire recall

1. Name the four guarantees a relational database provides that you would otherwise build yourself.
2. Define schema-on-write vs schema-on-read, and say where the schema lives in the second case.
3. Name the five NoSQL families with one strength and one weakness each.
4. What is wrong with "NoSQL scales better"? Give the accurate version.
5. Name four things that are hard to distribute, and why each is hard.
6. Why is a search engine not a system of record?
7. In the order example, which query favours documents and which favours relational, and why?
8. What single question decides whether embedding product price is right?
9. What did Spanner's TrueTime actually change, and what does it cost?
10. Why is Postgres the right default, and when should you add a second database?

<details>
<summary>Answers</summary>

1. **Schema enforcement**, **joins**, **transactions**, **referential integrity**. Without them you validate in every writing service, denormalize or join in application code, write compensating logic for partial failures, and eventually find orphaned rows in production.
2. **Schema-on-write** rejects malformed data at insert time; **schema-on-read** accepts anything and the reader interprets it. In the second case the schema still exists — it lives **implicitly in application code**, unenforced and undocumented.
3. **Key–value**: fastest lookups, partitions trivially / only exact-key access. **Document**: flexible shape, whole aggregate in one read / weak joins. **Wide-column**: huge write throughput, linear scaling / must know queries before designing the schema. **Graph**: cheap deep traversals / hard to shard. **Search**: relevance and fuzzy matching / not a system of record.
4. It implies NoSQL solved distributed data. Accurate version: <H>they achieved scale by **removing** the features that are hard to distribute — joins, multi-row transactions, referential integrity, global constraints.</H> Relational databases also shard (Vitess, Citus); the difference is when you are forced to think about it.
5. **Joins** (data on two machines), **multi-row transactions** (agreement across machines, locks held over the network), **referential integrity** (checking a row that lives elsewhere on every write), **global unique constraints** (consulting every shard on every insert).
6. Because it is **near-real-time rather than immediately consistent**, and is designed as a derived index rather than a durable authority. It belongs alongside a primary store, populated from it.
7. **Reading one order** favours documents — everything is in one place, one read. **Top products by revenue** favours relational — the document model has no `order_items` collection to aggregate, so it requires scanning every order.
8. <C color="orange">Is the copy a bug or a feature?</C> If you want the **price at time of purchase**, embedding is correct. If you want the **current** price everywhere, it is a bug and the data should be referenced, not copied.
9. It made **clock uncertainty explicit** — returning a time *interval* rather than a timestamp — and commits wait out that interval before becoming visible, yielding external consistency without a lock-holding coordinator. It costs a few milliseconds of commit latency and requires GPS/atomic-clock hardware.
10. Because it is good at nearly everything, so it lets you **defer specialisation until you have evidence you need it**. Add a second store when a specific access pattern demands it — not to make the architecture look more serious, since every store adds operating, backup, monitoring and consistency burden.

</details>

---

**Next:** [Indexes & Query Plans](./02-indexes-and-query-plans.md) — what actually happens between `SELECT` and your results.
