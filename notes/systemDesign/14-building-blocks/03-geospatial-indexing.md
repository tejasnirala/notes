---
title: Geospatial Indexing
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Geospatial Indexing

> **What you will be able to do after this page**
>
> - Explain why a normal index cannot answer "what is near me?"
> - Use geohashing to turn a 2D problem into a 1D string prefix search.
> - Choose between geohash, quadtree, S2 and H3 from the requirements.
> - Handle the boundary problem that makes naive implementations wrong.

Proximity search appears in every ride-hailing, delivery, dating and mapping design. <C color="orange">The difficulty is that databases index one dimension at a time and location has two.</C>

<Plain>

You have ten thousand shops listed on cards, and you want the ones near you.

**Sorted by street name**, you cannot answer it — nearby shops are on many different streets, scattered through the box.

**Two sorted lists, one by latitude and one by longitude**, is better and still awkward. You pull everything in the right latitude band, then everything in the right longitude band, then intersect. <C color="crimson">Both bands are enormous</C> — a latitude band spans the entire planet east to west.

The trick is to stop sorting by coordinates and start **naming regions**.

Divide the world into four quarters and label them 0 to 3. Divide each quarter into four again, so a shop in the second sub-quarter of quarter 1 is `12`. Keep going, and a longer label means a smaller area. `1203` is a district; `120312` is a few streets.

Now something useful happens. <C color="green">Two shops in the same neighbourhood share a long label prefix</C> — so "find everything near `120312`" becomes "find all cards whose label starts with `12031`", which is an ordinary sorted lookup. You have turned a two-dimensional problem into a one-dimensional one.

The catch arrives at the boundaries. Two shops facing each other across a street can sit in different quarters at the very first division — <C color="crimson">so they share no prefix at all, despite being twenty metres apart.</C> Any correct implementation has to handle that, and naive ones do not.

</Plain>

---

## 1. Why a normal index fails

```sql
SELECT * FROM drivers
WHERE lat BETWEEN 51.49 AND 51.53
  AND lng BETWEEN -0.14 AND -0.10;
```

A B-tree indexes **one ordering**. With an index on `(lat, lng)`, the database seeks the latitude range — <C color="crimson">a band circling the entire planet</C> — then filters by longitude within it. Two separate single-column indexes are worse: each returns a huge set to intersect.

<C color="green">The fix is a **space-filling curve**</C>: a single number per location such that nearby locations usually get nearby numbers. That restores one-dimensional ordering, which B-trees handle perfectly.

---

## 2. Geohash

<Jargon
  plain="Turning a latitude and longitude into a short string, where a shared prefix means physical proximity."
  term="geohash"
  also={['Z-order curve', 'Morton code', 'space-filling curve']}>

Interleave the bits of latitude and longitude, then base32-encode. <C color="green">Longer string = smaller cell</C>, and prefix length maps directly to precision.

</Jargon>

| Length | Cell size (approx) |
| ---: | :--- |
| 4 | ~40 km |
| 5 | ~5 km |
| 6 | ~1.2 km |
| 7 | ~150 m |
| 8 | ~40 m |

```
  gcpvj0u  →  central London, ~150 m cell
  gcpvj0   →  its ~1.2 km parent
  gcpvj    →  its ~5 km parent
```

<Trace title="Finding drivers within 2 km" subtitle="Prefix search, and the boundary bug that catches everyone.">

<TraceStep
  title="Index every driver by geohash"
  state={{ 'Storage': 'geohash string, indexed', 'Query type': 'prefix', 'Correct': '—', 'Missed drivers': '—' }}
  changed={['Storage', 'Query type']}
  note="An ordinary B-tree index on a string column. No special database features required.">

Each driver row stores `geohash` (precision 6, ~1.2 km cells) with a normal index.

</TraceStep>

<TraceStep
  title="Naive query — one cell"
  cost="misses most of them"
  state={{ 'Query': "geohash LIKE 'gcpvj0%'", 'Returns': 'drivers in one cell', 'Correct': 'NO', 'Missed drivers': 'most nearby' }}
  changed={['Query', 'Returns', 'Correct', 'Missed drivers']}
  note="A 2 km radius spans several 1.2 km cells. One cell covers a fraction of the circle.">

<C color="crimson">A single prefix returns only the user's own cell</C> — drivers 300 m away in the adjacent cell are invisible.

</TraceStep>

<TraceStep
  title="Query the cell plus its 8 neighbours"
  state={{ 'Query': '9 prefixes', 'Returns': '3×3 cell block', 'Correct': 'mostly', 'Missed drivers': 'few' }}
  changed={['Query', 'Returns', 'Correct', 'Missed drivers']}
  note="Computing the 8 neighbours of a geohash cell is standard and provided by every library.">

<C color="green">Query the 3×3 block of cells around the user.</C> This is the fix the boundary problem requires, and it is the step naive implementations skip.

</TraceStep>

<TraceStep
  title="Filter by true distance"
  state={{ 'Query': '9 prefixes + haversine', 'Returns': 'exact radius', 'Correct': 'yes', 'Extra rows fetched': '~30%' }}
  changed={['Query', 'Returns', 'Correct', 'Extra rows fetched']}
  note="The index narrows candidates cheaply; exact distance is computed only on that small set.">

Cells are squares and the query is a circle, so compute the haversine distance on the candidates and discard those outside 2 km.

<H>The index does not answer the question — it produces a small candidate set cheaply. Exact geometry runs only on that set. Nearly every spatial system works this way.</H>

</TraceStep>

<TraceStep
  title="Handle sparse and dense areas"
  cost="fixed precision is wrong"
  state={{ 'Rural': '9 cells, 0 drivers', 'City centre': '9 cells, 4,000 drivers', 'Fix': 'adaptive precision' }}
  changed={['Rural', 'City centre', 'Fix']}
  note="A fixed cell size cannot serve both a city centre and a rural area.">

<C color="crimson">One precision cannot fit both.</C> Use a coarser prefix where density is low and expand precision where it is high — or switch to a structure that adapts automatically.

</TraceStep>

</Trace>

---

## 3. The alternatives

| Structure | Idea | Best for |
| :--- | :--- | :--- |
| **Geohash** | Interleaved bits, base32 string | <C color="green">Simplicity — works with any database that indexes strings</C> |
| **Quadtree** | Recursively split until a cell has few points | <C color="green">Non-uniform density — adapts automatically</C> |
| **S2 (Google)** | Project the sphere onto a cube, Hilbert curve per face | <C color="green">Accurate at scale; better locality; no pole distortion</C> |
| **H3 (Uber)** | Hexagonal cells | <C color="green">Uniform neighbour distance</C> — every neighbour equidistant |
| **R-tree / PostGIS** | Bounding-box tree | <C color="green">Polygons, not just points</C> |

**Why hexagons.** In a square grid, the four edge-neighbours are one cell-width away and the four corner-neighbours are 1.41× further — so "adjacent" means two different distances. <C color="green">Hexagons have six neighbours, all equidistant</C>, which makes flow, spread and coverage calculations far cleaner. That is why Uber built H3 for surge pricing and supply positioning.

**Why S2 for accuracy.** Geohash cells distort badly near the poles and its Z-order curve has discontinuities — points adjacent in space can be far apart in the ordering. S2 projects onto a cube and uses a **Hilbert curve**, which has much better locality: <C color="green">points close on the curve are reliably close in space.</C>

<C color="green">In practice, if you use PostgreSQL, the answer is usually PostGIS</C> with a GiST index — mature, exact, and handles polygons, which the curve-based approaches do not.

<Depth title="The moving-objects problem, and how ride-hailing systems really work">

Everything above assumes static points. Drivers move — and a design that re-indexes on every location update behaves very differently.

**The write load is the real problem.** 100,000 active drivers reporting every 4 seconds is **25,000 writes/second**, each updating an indexed column. <C color="crimson">Updating an indexed column means deleting and reinserting an index entry</C>, so the index churns constantly and write amplification is severe.

**How production systems handle it:**

**1. Keep live positions out of the durable database.** Current location is high-churn and low-value — losing a few seconds of it is harmless, because another update arrives immediately. <C color="green">Keep it in Redis</C>, using `GEOADD`/`GEOSEARCH` (which are sorted sets over geohash-derived scores). Persist to the database only for history and billing, asynchronously and batched.

**2. Shard by region.** Location queries are inherently local — a rider in London never needs Tokyo's drivers. <C color="green">Partition by city or region</C> so each shard holds a manageable set and queries never cross shards. This is one of the rare cases where a natural, stable, evenly-loaded shard key exists.

**3. Do not update on every ping.** A driver who has moved 8 metres does not need reindexing. Update the index only when the cell changes, or when movement exceeds a threshold. <C color="green">This alone can cut index writes by an order of magnitude.</C>

**4. Invert the query where possible.** Rather than *"which drivers are near this rider?"*, many systems maintain per-cell driver **sets** and read the relevant cells. Cell membership changes only on cell transitions, which are far rarer than position updates.

**5. Accept staleness deliberately.** A driver's position being 5 seconds old is fine — they cannot have travelled far, and the dispatch will re-verify. <C color="orange">Trying to keep a global index perfectly current is expensive and buys nothing a user can perceive.</C>

**Matching is a separate problem from indexing.** Finding the nearest drivers is proximity search. Deciding **which** one to dispatch involves estimated arrival time (not straight-line distance — a river or motorway changes everything), driver acceptance likelihood, fairness across drivers, and global efficiency across concurrent requests. <C color="orange">Straight-line distance is a candidate generator, not the answer</C> — the ranking uses a routing engine over the small candidate set.

**In an interview**, the sequence that reads as experienced: geohash or H3 for the index → Redis for live positions → shard by city → query the cell plus neighbours → filter by real distance → rank the small candidate set by ETA. The give-away of inexperience is proposing to store live driver positions in the primary relational database and query them with `BETWEEN`.

</Depth>

---

## 4. In a design discussion

- **"Geohash at precision 6, query the cell plus its eight neighbours, then filter by haversine — one cell misses everyone just across the boundary."** The bug and the fix in one sentence.
- **"H3 if neighbour distances matter — hexagons make all six neighbours equidistant, which squares do not."** Knows why the alternative exists.
- **"Live positions in Redis, sharded by city. 25,000 writes a second against an indexed column in Postgres would thrash the index."** Separates high-churn from durable data.
- **"Proximity gives candidates; ranking is by ETA over a routing engine, because straight-line distance ignores rivers."** Distinguishes the two problems.

---

## Rapid-fire recall

1. Why can a B-tree not answer a proximity query efficiently?
2. What does a geohash do, and what does a shared prefix mean?
3. Give approximate cell sizes for geohash lengths 5, 6 and 7.
4. What is the boundary problem, and what is the standard fix?
5. Why must you still compute exact distance after the prefix query?
6. Why is a single fixed precision wrong, and what adapts automatically?
7. Why did Uber choose hexagons?
8. What advantage does S2's Hilbert curve have over a Z-order curve?
9. Give three techniques for handling moving objects.
10. Why is straight-line distance only a candidate generator?

<details>
<summary>Answers</summary>

1. Because a B-tree indexes **one ordering**. A latitude range seek returns a band circling the entire planet, which must then be filtered by longitude — and two separate indexes each return huge sets to intersect.
2. It **interleaves the bits of latitude and longitude** into a single base32 string, so nearby points usually get nearby strings. A **shared prefix means the points fall in the same cell** — longer shared prefix, smaller cell, closer together.
3. Length 5 ≈ **5 km**, length 6 ≈ **1.2 km**, length 7 ≈ **150 m**.
4. Two points metres apart can fall on **opposite sides of a cell division** — sometimes the very first one — so they share no prefix. Fix: query the target cell **plus its eight neighbours** (a 3×3 block).
5. Because cells are **squares and the query is a circle**. The prefix search produces a cheap candidate set; exact haversine distance filters it to the true radius.
6. Because density varies — nine cells may contain zero drivers in a rural area and thousands in a city centre. **Quadtrees** adapt automatically by splitting only where points are dense.
7. Because a hexagon's **six neighbours are all equidistant**, whereas a square's edge-neighbours and corner-neighbours differ by a factor of 1.41. That makes flow, spread and coverage calculations much cleaner — relevant to surge pricing and supply positioning.
8. **Better locality.** Points close along a Hilbert curve are reliably close in space, whereas Z-order curves have discontinuities where spatially adjacent points land far apart in the ordering. S2 also avoids geohash's polar distortion.
9. **Keep live positions in Redis** rather than the durable database · **shard by city/region** · **only reindex on cell change or movement threshold** · **maintain per-cell sets** rather than per-object positions · **accept a few seconds of staleness**.
10. Because the real question is **estimated arrival time**, and straight-line distance ignores rivers, motorways, one-way systems and traffic. Proximity narrows the field cheaply; a routing engine ranks the small candidate set.

</details>

---

**Next:** [Leaderboards and Top-K](./04-leaderboards-and-top-k.md) — ranking at scale without sorting everything.
