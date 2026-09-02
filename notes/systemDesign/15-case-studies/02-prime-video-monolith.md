---
title: Prime Video — Microservices to Monolith
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Prime Video — Microservices to Monolith

> **The claim:** Amazon Prime Video's video quality analysis service moved from a distributed serverless architecture to a single process, cutting infrastructure cost by around 90%.
>
> *Source: the Prime Video Tech blog, 2023. What follows applies [the six questions](./01-how-to-read-a-case-study.md).*

The most-cited architecture case study of recent years, and <C color="crimson">the most consistently misread.</C> It is not an argument against microservices; it is a precise illustration of one specific cost.

<Plain>

A quality inspector checks every frame of a video stream for defects — a frozen picture, a corrupted block, audio out of sync.

**The first design gave each check its own room.** One room extracts frames, another examines them, a third compares audio. A frame is examined, put in a van, driven to the next room, unloaded, and examined again.

For a handful of streams this is tidy — each room can be staffed and improved independently.

Then the volume rises. And the problem is not the inspection: <C color="crimson">it is the driving.</C> Every frame travels between rooms, and there are a great many frames. The vans cost more than the inspectors, and there are only so many vans.

**The second design put every check on one bench.** A frame is extracted, examined, compared, and discarded without moving.

Nothing about the checks changed. What changed is that the frames stopped travelling.

<H>The lesson is not "one room is better than several". It is that you should not put a corridor in the middle of something that passes large amounts of material back and forth very quickly.</H>

</Plain>

---

## 1. The six questions

**Q1 — Constraints.** One internal tool at Amazon, monitoring thousands of concurrent streams, analysing **every frame and every audio sample**. A small team. Judged against an internal infrastructure budget rather than customer revenue.

**Q2 — Which resource ran out?** <C color="orange">Not throughput and not latency — **cost**, and a hard scaling ceiling.</C> Two components dominated: orchestration state transitions billed per step, and passing video frames **between** components through intermediate storage.

**Q3 — What did they try first?** The distributed design *was* the first attempt. It worked correctly and hit a scaling limit well below target while costing far too much.

**Q4 — What did it cost them?** They gave up independent scaling and independent deployment of the pipeline stages. <C color="green">For this workload those were benefits they were paying for and not using</C> — every stage processes the same frames at the same rate, so there is nothing to scale independently.

**Q5 — Doing nothing?** Not viable. The service could not reach required scale at acceptable cost.

**Q6 — What transfers?** Not "monoliths are better". This:

<H>When components exchange large volumes of data at high frequency, the network and serialisation between them dominate everything else. Do not draw a service boundary across a high-bandwidth data path.</H>

---

## 2. Why the cost landed where it did

<Trace title="Following one video frame" subtitle="The same work, two architectures. Watch what the frame does.">

<TraceStep
  title="Distributed — extract the frame"
  state={{ 'Frame location': 'in memory, service A', 'Bytes moved': '0', 'Billable steps': '1', 'Cost driver': '—' }}
  changed={['Frame location', 'Billable steps']}
  note="Correct and cheap so far. One unit of work, one state transition.">

The defect detector extracts a frame from the stream.

</TraceStep>

<TraceStep
  title="Hand it to the next stage"
  cost="a write and a read"
  state={{ 'Frame location': 'object storage', 'Bytes moved': '~1 frame', 'Billable steps': '2', 'Cost driver': 'data transfer' }}
  changed={['Frame location', 'Bytes moved', 'Billable steps', 'Cost driver']}
  note="Serverless functions cannot pass large objects directly, so intermediate storage becomes the transport.">

Service A writes the frame to intermediate storage; service B reads it back. <C color="crimson">The frame has now been serialised, stored and retrieved to travel a few metres.</C>

</TraceStep>

<TraceStep
  title="Multiply by every frame"
  cost="the actual bill"
  state={{ 'Frames/second': 'thousands', 'Bytes moved': 'enormous', 'Billable steps': 'per frame, per stage', 'Cost driver': 'transfer + orchestration' }}
  changed={['Frames/second', 'Bytes moved', 'Billable steps']}
  note="Per-step orchestration charges and per-object storage operations both scale with frame count, not with stream count.">

A video is not one item — it is thousands of frames per stream, across thousands of concurrent streams.

<C color="crimson">Both dominant costs scale with frames, and frames are the thing there are most of.</C>

</TraceStep>

<TraceStep
  title="Single process — the frame does not move"
  cost="near zero"
  state={{ 'Frame location': 'memory, never leaves', 'Bytes moved': '0', 'Billable steps': '0', 'Cost driver': 'compute only' }}
  changed={['Frame location', 'Bytes moved', 'Billable steps', 'Cost driver']}
  note="The same analysis code, called as functions rather than invoked as services.">

Extraction, detection and comparison run in one process. The frame stays in memory.

<C color="green">Data transfer and orchestration cost disappear entirely.</C>

</TraceStep>

<TraceStep
  title="What was actually given up"
  state={{ 'Independent scaling': 'lost', 'Independent deploys': 'lost', 'Was it being used?': 'NO', 'Verdict': 'a good trade here' }}
  changed={['Independent scaling', 'Independent deploys', 'Was it being used?', 'Verdict']}
  note="The benefits were real in general and worthless for this specific workload.">

<H>Every stage processes the same frames at the same rate, so there was never anything to scale independently. They were paying for optionality the workload could not use.</H>

</TraceStep>

</Trace>

---

## 3. What this does and does not say

<Depth title="Reading it honestly — what generalises and what does not">

**What is genuinely transferable:**

**1. Service boundaries have a data-movement cost that scales with data volume, not request count.** A boundary crossed once per user request is cheap. <C color="crimson">A boundary crossed once per *frame*, or per row, or per event within a request, is not.</C> The question to ask of any boundary: how much data crosses it, how often?

**2. Serverless orchestration is priced per state transition.** Excellent for workflows measured in steps per request; <C color="crimson">ruinous for workflows measured in steps per megabyte.</C> The pricing model, not the technology, is the constraint.

**3. Independent scaling is only valuable when the stages genuinely scale differently.** In a strict pipeline where every stage handles identical volume, it buys nothing and costs the coupling of network calls.

**4. "Serverless first" can be exactly wrong for sustained, high-throughput work.** This is the [utilisation argument](../09-architecture-styles/04-serverless.md) again — serverless wins at low or spiky utilisation and loses at sustained high utilisation.

**What does not generalise, and where the popular reading goes wrong:**

<C color="crimson">This was one internal tool, not Prime Video's streaming architecture.</C> Amazon did not abandon microservices; a single team changed one component's deployment shape. The headline "Amazon dumps microservices" was never accurate.

<C color="crimson">It says nothing about systems whose boundaries follow team ownership.</C> The costs microservices *do* buy you — independent deploys, team autonomy — were not what this team needed, because it was one team.

<C color="crimson">It is not evidence that monoliths are cheaper in general.</C> It is evidence that this workload's costs were dominated by data movement, and that removing the movement removed the cost.

**The honest version of the finding:**

> A pipeline where every stage processes the same high-volume data at the same rate, owned by one team, is a bad fit for a distributed architecture — because you pay for data movement and orchestration on every unit of data while collecting none of the organisational benefits.

**What it should change in your practice.** When drawing a boundary, add one question to the usual ones about [aggregates and transactions](../09-architecture-styles/02-service-boundaries.md):

<H>How much data crosses this line, and how often? If the answer is "a lot, continuously", the boundary is in the wrong place regardless of how clean it looks on the diagram.</H>

That question would have caught this design before it was built, and it catches a whole class of similar mistakes — image processing pipelines, ETL stages, ML feature pipelines, log processing — where the temptation to give each transformation its own service is strong and the data volume makes it expensive.

</Depth>

---

## Rapid-fire recall

1. Which resource ran out, and which two components drove it?
2. Why is "Amazon abandoned microservices" an inaccurate reading?
3. Why did passing frames through intermediate storage cost so much?
4. What benefit did the distributed version provide that this workload could not use?
5. What question should be added when drawing a service boundary?
6. Why is serverless orchestration a poor fit for this workload specifically?
7. What kinds of pipeline does this finding generalise to?
8. What does the case say about boundaries that follow team ownership?

<details>
<summary>Answers</summary>

1. **Cost**, plus a hard scaling ceiling. Driven by **orchestration state transitions billed per step** and **passing video frames between components through intermediate storage**.
2. Because it concerned **one internal tool** — a video quality analysis service — not Prime Video's streaming architecture, and it was **one team changing one component's deployment shape**.
3. Because the unit of work was a **frame**, not a request. Thousands of frames per stream across thousands of streams meant serialisation, storage and retrieval costs scaled with the thing there was most of.
4. **Independent scaling and independent deployment of pipeline stages.** Useless here because every stage processes the same frames at the same rate — there was nothing to scale independently.
5. <H>How much data crosses this boundary, and how often?</H> A boundary crossed once per user request is cheap; one crossed per frame or per row within a request is not.
6. Because it is **priced per state transition**, which suits workflows measured in steps per request and is ruinous for workflows measured in steps per megabyte.
7. Any **high-volume data pipeline where stages pass large payloads at high frequency** — image and video processing, ETL, ML feature pipelines, log processing.
8. Nothing. The benefits microservices genuinely provide — **independent deploys and team autonomy** — were irrelevant here because a single team owned the whole pipeline.

</details>

---

**Next:** [Segment — 140 Services Back to One](./03-segment-monolith.md) — the same reversal for entirely different reasons.
