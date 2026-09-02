---
title: Back-of-the-Envelope Estimation
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Back-of-the-Envelope Estimation

> **What you will be able to do after this page**
>
> - Turn a user count into QPS, storage and bandwidth in under two minutes.
> - Recall the handful of constants that make the arithmetic doable in your head.
> - Size a fleet, a cache and a disk budget well enough to make architectural decisions.
> - Know which estimates change a design and which are theatre.

The goal is never precision. The goal is <C color="orange">**the correct order of magnitude**</C>, because that is what decides whether you need one database or forty.

<Plain>

You are cooking for a party. Someone asks how much rice to buy.

You do not weigh anything. You think: *"about 40 people, most will eat, call it 100 grams of dry rice each — that's 4 kilos. Buy 5."*

That took four seconds and it is **right enough**. It is not 4.0 kg, and it does not need to be. What it tells you is the thing that actually matters: buy bags, not a box, and you do not need a second trip to the shop.

Estimation in system design is exactly this. Nobody wants the true number — they want to know whether you need **one database or forty**, whether photos fit on a normal disk or need a different kind of storage entirely. Those decisions are separated by factors of a hundred, so a rough answer decides them just as well as a precise one.

The whole skill is knowing a few common quantities by heart and being willing to round hard.

</Plain>

---

## 1. The constants

Memorise these. Everything else is multiplication.

### Time

```
  1 day        = 86,400 s   ≈ 10⁵ s      ← the single most useful approximation
  1 month      ≈ 2.5 × 10⁶ s
  1 year       ≈ 3 × 10⁷ s
```

Treating a day as **100,000 seconds** (14% off) makes every QPS calculation a matter of moving a decimal point:

> <H>**QPS ≈ daily events ÷ 100,000**</H>

<Jargon
  plain="How many requests hit your system every second."
  term="QPS — queries per second"
  also={['RPS (requests per second)', 'throughput']}>

The standard unit of load. Always say whether you mean **average** or **peak** — they can differ by 100×, and quoting the average as though it were the peak is a classic way to under-provision. <C color="orange">"6K average, 18K peak"</C> is the shape of a good answer.

</Jargon>

1M events/day ≈ 10 QPS. 1B events/day ≈ 10,000 QPS. Done, in your head.

### Powers of two, as data sizes

| Power | Exact | Approx | Name |
| :--- | ---: | ---: | :--- |
| 2¹⁰ | 1,024 | 1 thousand | 1 KB |
| 2²⁰ | 1,048,576 | 1 million | 1 MB |
| 2³⁰ | ~1.07 × 10⁹ | 1 billion | 1 GB |
| 2⁴⁰ | ~1.10 × 10¹² | 1 trillion | 1 TB |
| 2⁵⁰ | ~1.13 × 10¹⁵ | 1 quadrillion | 1 PB |

### Typical object sizes

| Thing | Size |
| :--- | ---: |
| A UUID | 16 B |
| An int64 / timestamp | 8 B |
| A short text post (280 chars, UTF-8) | ~300 B |
| A typical DB row with metadata | ~1 KB |
| A JSON API response | 1–10 KB |
| A web page (HTML only) | ~50 KB |
| A compressed photo | 200 KB – 2 MB |
| A minute of 1080p video | ~50 MB |
| A minute of 128 kbps audio | ~1 MB |

### Machine capacities (order-of-magnitude, commodity cloud)

| Resource | Rough capacity |
| :--- | :--- |
| App server (simple JSON endpoint) | 1,000–10,000 QPS |
| App server (real business logic, DB calls) | 100–1,000 QPS |
| Relational DB, single primary — reads | ~10,000 QPS |
| Relational DB, single primary — writes | ~1,000–5,000 QPS |
| Redis instance | ~100,000 ops/s |
| One machine's RAM | 16 GB – 1 TB |
| One machine's disk | 1–20 TB |
| NIC bandwidth | 1–25 Gbps |

> The DB write number is the one that matters most. <H>**A single relational primary tops out around a few thousand writes/second.**</H> Cross that and you are sharding, whatever else you had planned.

---

## 2. The procedure

Five steps, always the same order.

```
  1. Users        →  DAU, and actions per user per day
  2. QPS          →  daily actions ÷ 100,000, then × peak factor
  3. Storage      →  writes/day × bytes/write × retention × replication
  4. Bandwidth    →  QPS × response size (in and out separately)
  5. Machines     →  QPS ÷ per-machine capacity, then round up generously
```

### On peak factors

<C color="orange">Average QPS is a planning fiction; provision for peak.</C>

| Traffic shape | Peak ÷ average |
| :--- | ---: |
| Internal tools | 1.5× |
| Global consumer app (time zones smooth it) | 2× |
| Regional consumer app (one daily cycle) | 3–5× |
| Event-driven (sports, on-sales, launches) | 10–100× |

Default to **2×** and say so. The number matters less than showing you know average ≠ peak.

---

## 3. Worked example — a Twitter-like service

**Given:** 300M DAU. Each user reads their timeline 20×/day. 10% of users post once/day. Average post 300 B of text; 10% of posts carry a 1 MB image. Retain everything for 5 years.

The whole estimate, one step at a time. Watch which numbers force which decisions.

<Trace title="Sizing a Twitter-like service" subtitle="300M DAU. 20 timeline reads/user/day. 10% post once. 10% of posts carry a 1 MB image.">

<TraceStep
  title="Start from users and actions"
  state={{ 'Reads/day': '6 billion', 'Writes/day': '30 million', 'Read QPS': '—', 'Storage/day': '—', 'Forced decisions': 'none yet' }}
  changed={['Reads/day', 'Writes/day']}
  note="Always compute daily volumes first — QPS and storage both derive from them.">

300M × 20 = **6 billion** timeline reads/day. 30M users × 1 = **30 million** posts/day.

</TraceStep>

<TraceStep
  title="Divide by 100,000 to get QPS"
  state={{ 'Reads/day': '6 billion', 'Writes/day': '30 million', 'Read QPS': '60K avg / 120K peak', 'Storage/day': '—', 'Forced decisions': 'none yet' }}
  changed={['Read QPS']}
  note="A day is ~86,400 s. Calling it 100,000 is 14% off and turns every division into moving a decimal point.">

6×10⁹ ÷ 10⁵ = **60,000 reads/sec** average, ~120,000 at peak.
3×10⁷ ÷ 10⁵ = **300 writes/sec** average, ~600 at peak.

</TraceStep>

<TraceStep
  title="Take the ratio — the most important number"
  cost="decides the data layer"
  state={{ 'Reads/day': '6 billion', 'Writes/day': '30 million', 'Read QPS': '60K avg / 120K peak', 'Storage/day': '—', 'Forced decisions': 'cache + replicas + precompute' }}
  changed={['Forced decisions']}
  note="Read-heavy is solved by duplication; write-heavy by partitioning. This number picks your toolkit.">

**200 reads per write.** Heavily read-dominated.

Also note what the write number says: 600 peak writes/sec is comfortably inside what a single database can handle. <C color="green">Sharding is not required for write throughput here</C> — a conclusion you can only reach by computing it.

</TraceStep>

<TraceStep
  title="Storage — and split it by data type"
  cost="3 TB/day"
  state={{ 'Reads/day': '6 billion', 'Writes/day': '30 million', 'Read QPS': '60K avg / 120K peak', 'Storage/day': '3 TB (99% images)', 'Forced decisions': '+ object storage' }}
  changed={['Storage/day', 'Forced decisions']}
  note="A single blended storage number would have hidden the entire finding.">

Text: 3×10⁷ × 300 B = **9 GB/day**. Images: 3×10⁶ × 1 MB = **3 TB/day**. Metadata: ~30 GB/day.

Images are **99% of the volume**. They go to object storage; the database carries ~40 GB/day.

</TraceStep>

<TraceStep
  title="Project the storage forward"
  state={{ 'Reads/day': '6 billion', 'Writes/day': '30 million', 'Read QPS': '60K avg / 120K peak', 'Storage/day': '3 TB', '5-year total': '5.5 PB raw / 17 PB replicated', 'Forced decisions': '+ ~40 DB shards' }}
  changed={['5-year total', 'Forced decisions']}
  note="Multiply by 3 for replication. Forgetting this is the most common estimation error.">

5 years ≈ **5.5 PB**, or ~17 PB with 3× replication. The database's share is ~73 TB — call it **40 shards** at 2 TB each.

Here sharding *is* required — for **volume**, not for write rate.

</TraceStep>

<TraceStep
  title="Say the summary out loud"
  state={{ 'Read QPS': '120K peak', 'Write QPS': '600 peak', 'Ratio': '200:1', 'Storage': '3 TB/day, 99% images', 'Forced decisions': 'cache, replicas, object storage, CDN, 40 shards' }}
  note="This paragraph is the point of the whole exercise. It tells the listener you know where the difficulty is.">

> *"120K peak reads, 600 peak writes, 200:1 read-heavy. 3 TB/day, almost all images — so images go to object storage behind a CDN, and the database carries ~73 TB over five years, about 40 shards. **The read path is the design problem; the write path is easy.**"*

</TraceStep>

</Trace>

### Step 1 — daily volumes

```
  reads  = 300M × 20   = 6 × 10⁹  timeline reads/day
  writes = 30M  × 1    = 3 × 10⁷  posts/day
  images = 10% of 30M  = 3 × 10⁶  images/day
```

### Step 2 — QPS

```
  read  QPS avg  = 6e9 / 1e5  = 60,000       peak (×2) = 120,000
  write QPS avg  = 3e7 / 1e5  =    300       peak (×2) =     600

  read : write ≈ 200 : 1      ← the number that shapes everything
```

**Immediate design consequences, before drawing anything:**
- 200:1 read-heavy → cache aggressively, replicate reads, precompute timelines.
- 600 peak writes/sec → a single well-tuned primary *could* handle this. Sharding is for storage volume and safety here, not write throughput.
- 120K peak reads/sec → far beyond one database. This must be served from cache and replicas.

### Step 3 — storage

```
  text/day   = 3e7 posts × 300 B          = 9 GB/day
  images/day = 3e6 × 1 MB                 = 3 TB/day
  metadata   = 3e7 × 1 KB (ids, indexes)  = 30 GB/day
  ───────────────────────────────────────────────────
  ≈ 3.04 TB/day, dominated entirely by images

  5 years  = 3.04 TB × 365 × 5            ≈ 5.5 PB
  ×3 replication                          ≈ 17 PB
```

Consequence: images go to **object storage** (S3-class, cheap per GB, replicated for you), never into the database. The database holds ~40 GB/day of text and metadata — **73 TB over five years**, which is large but sane for a sharded cluster.

> Splitting the storage estimate by data type is what surfaces this. A single blended number would have hidden it.

### Step 4 — bandwidth

```
  Outbound: a timeline response ≈ 20 posts ≈ 10 KB text + a few images.
  Text     : 120,000 QPS × 10 KB   = 1.2 GB/s  ≈  10 Gbps
  Images   : served from CDN, not origin — this is the entire point of a CDN

  Inbound  : 600 writes/s, 10% with a 1 MB image
             = 60 MB/s ≈ 0.5 Gbps   (trivial)
```

Consequence: origin bandwidth is manageable *only because* images are offloaded to a CDN. Serving images from origin would mean hundreds of Gbps and a bill to match.

### Step 5 — machines

```
  App tier : 120,000 peak QPS ÷ 1,000 QPS/server  = 120 servers
             ×1.5 for headroom and failures       ≈ 180 servers

  Cache    : hold 5 days of active timelines.
             300M users × 20 KB of precomputed timeline = 6 TB
             ÷ 100 GB usable per node                   = 60 cache nodes
             (or: cache only the ~20% of users active daily → ~12 nodes)

  Database : 73 TB over 5 years ÷ ~2 TB per shard  ≈ 40 shards
             (write throughput is not the constraint; volume is)
```

### The summary you say out loud

> ~120K peak read QPS, ~600 peak write QPS, 200:1 read-heavy. About 3 TB/day of new data, ~99% of it images, so images go to object storage behind a CDN and the database carries ~73 TB of text and metadata over five years — call it 40 shards. Roughly 180 app servers and a 6 TB timeline cache. The read path is the whole design problem; the write path is comparatively easy.

That paragraph is the entire point of the exercise. It tells the listener you know where the difficulty is.

---

## 4. Sanity checks that catch mistakes

Cheap tests to run on your own numbers:

| Check | Red flag |
| :--- | :--- |
| Does DAU exceed plausible population? | 5B DAU for a niche app |
| Is QPS per user sane? | 1,000 actions/user/day means a bot, not a human |
| Would this fit on one machine? | If storage is 50 GB, stop designing a distributed system |
| Is the bandwidth physically possible? | 10 Tbps from one region is not a thing |
| Does write QPS exceed a primary's ~5K ceiling? | If yes, say <C color="green">"so we shard"</C> — if no, <C color="crimson">do not shard</C> |
| Is the read:write ratio consistent with the product? | A chat app is not 1000:1 read-heavy |

### The one that catches the most errors

<H>**Compare storage per user against reality.**</H> If your estimate says each user consumes 500 GB, something is off by orders of magnitude. Divide total storage by DAU and ask whether that number is believable for the product.

---

## 5. Which estimates actually matter

Not all arithmetic earns its time. Rank by whether the answer changes the architecture:

| Estimate | Changes the design? | Why |
| :--- | :--- | :--- |
| **Read:write ratio** | ★★★ | Decides caching, replication, denormalization, whole data layer |
| **Peak write QPS** | ★★★ | Decides whether you shard at all |
| **Total storage** | ★★★ | Decides one DB vs sharded cluster vs object storage |
| **Peak read QPS** | ★★☆ | Decides cache and replica sizing |
| **Bandwidth** | ★★☆ | Decides CDN and where large objects live |
| **Server count** | ★☆☆ | Rarely changes the *shape*, mostly a cost number |
| **Exact RAM per cache node** | ☆☆☆ | Tuning, not design |

Spend your two minutes at the top of that list. In an interview, the ratio and the write QPS are what a good interviewer is listening for.

---

## 6. Common traps

**Confusing bits and bytes.** Network figures are bits per second, storage is bytes. 1 Gbps = 125 MB/s. <C color="crimson">An 8× error is easy and embarrassing.</C>

**Forgetting replication.** Every stored byte is usually 3 bytes. Do not quote raw logical volume as your capacity number.

**Forgetting indexes.** Indexes routinely add 20–50% on top of table data — more if you index generously.

**Estimating for total registered users.** Load comes from DAU. A service with 2B registered and 50M daily is a 50M-user system.

**Ignoring metadata.** A 1 MB photo also carries a row, a thumbnail set, EXIF, permissions and search entries. Small per item, meaningful in aggregate.

<Depth title="Why order-of-magnitude answers are good enough — and when they are not">

This style of reasoning is called **Fermi estimation**, after Enrico Fermi, who was known for producing usable answers to questions like *"how many piano tuners are there in Chicago?"* from nothing but decomposition and rounding.

It works because of how errors combine. If you make six independent estimates, each possibly off by 2× in either direction, the errors do not stack — they partially cancel. Under-guessing the post rate offsets over-guessing the image size. In log-space the errors add as a random walk, so n estimates each off by a factor f give a total error near `f^√n`, not `f^n`. Six estimates each 2× off give roughly **5× total error, not 64×**.

<C color="green">A 5× error is fine when the decision boundaries are 100× apart</C> — "one database or forty" survives that comfortably.

**Where the method breaks down:**

- **The answer sits near a decision boundary.** If you estimate 4,000 writes/sec and a primary handles ~5,000, the estimate cannot decide whether you shard. Measure instead.
- **Errors are correlated rather than independent.** Get DAU wrong and *every* downstream number is wrong in the same direction — nothing cancels. This is why DAU is the input worth interrogating hardest.
- **The distribution is heavy-tailed.** Averages are meaningless for follower counts, file sizes, or requests per user. "Average follower count" tells you nothing about a system that must survive a celebrity — estimate the tail separately.

</Depth>

**Over-precision.** <C color="crimson">"6,214,891 QPS"</C> signals you are computing rather than reasoning. Say "about 6 million" and keep moving — the whole method has ±50% error bars built in, and that is fine.

---

## Rapid-fire recall

1. Approximate a day in seconds, and give the one-step QPS formula it enables.
2. 500M events/day is roughly what QPS? Peak, assuming a global consumer app?
3. Roughly how many writes/second can a single relational primary sustain, and what design decision does that number trigger?
4. In the Twitter example, why do images go to object storage rather than the database?
5. Which single computed number told you the read path was the hard part?
6. Convert 1 Gbps to MB/s.
7. Name three multipliers people forget when estimating storage.
8. Why estimate against DAU rather than registered users?
9. Which two estimates most often change the architecture?
10. Your estimate implies 500 GB of storage per user. What do you do?

<details>
<summary>Answers</summary>

1. ~86,400 s, approximated as **10⁵ s**. So **QPS ≈ daily events ÷ 100,000**.
2. 5 × 10⁸ ÷ 10⁵ = **5,000 QPS** average; ~**10,000 QPS** peak at 2×.
3. Roughly **1,000–5,000 writes/sec**. Exceeding it forces **sharding** regardless of what else you planned; staying under it means sharding is only about storage volume or blast radius.
4. Images are ~3 TB/day versus ~40 GB/day of text and metadata — 99% of the volume. Object storage is far cheaper per GB, replicates for you, and fronts cleanly with a CDN, leaving the database a manageable ~73 TB.
5. The **200:1 read:write ratio**, reinforced by 120K peak read QPS against 600 peak write QPS.
6. **125 MB/s** (divide by 8).
7. **Replication** (×3), **indexes** (+20–50%), and **metadata/derived data** (thumbnails, search entries, permissions). Retention period is a fourth.
8. Load is generated by active users. A service with 2B registered and 50M daily is a 50M-user system, and sizing for 2B overbuilds by 40×.
9. The **read:write ratio** and **peak write QPS** — the first shapes the whole data layer, the second decides whether you shard.
10. Treat it as an arithmetic error and recheck. Per-user storage is the sanity check that catches order-of-magnitude slips fastest: divide total storage by DAU and ask whether the number is believable for the product.

</details>

---

**Next:** [Thinking In Trade-offs](./06-thinking-in-tradeoffs.md) — the axes you are actually trading along, and when not to distribute at all.
