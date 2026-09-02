---
title: Cost as a Design Constraint
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Cost as a Design Constraint

> **What you will be able to do after this page**
>
> - Estimate what a design costs per month before building it.
> - Name the line items that dominate real cloud bills, which are rarely compute.
> - Use unit economics to tell a scaling problem from a pricing problem.
> - Recognise the architectural decisions that are really cost decisions.

<C color="orange">Cost is the axis most system design material omits entirely</C>, and it is the one that decides more real architectures than latency or availability ever do.

<Plain>

Two houses are designed to the same brief. Both have four bedrooms, both stay warm, both keep the rain out.

One costs three times as much to run.

Nothing in the brief mentioned heating bills, so nobody optimised for them — and the difference does not appear at handover. It appears every month, forever, and eventually somebody asks why.

Software is the same, with one twist that makes it worse: <C color="crimson">the bill arrives monthly and nobody who wrote the code sees it.</C> The engineer chose a design; the finance team sees a number; the connection between them is invisible from both ends.

The consequence is a familiar conversation. *"Our infrastructure costs have tripled and revenue has not."* Nobody made a bad decision — a hundred small reasonable ones each added a little, and no single one was ever worth objecting to.

The fix is not spending less. It is <C color="green">knowing roughly what a design costs **before** building it</C>, the same way you would estimate its latency. A design you cannot price is a design you do not fully understand — you have specified what it does and not what it costs to keep doing it.

</Plain>

---

## 1. Where the money actually goes

Compute is what people estimate. It is frequently not the largest line.

| Line item | Frequently underestimated because |
| :--- | :--- |
| **Compute** | The one people plan for |
| <C color="crimson">**Data transfer (egress)**</C> | Free inbound, charged outbound; cross-AZ and cross-region add up invisibly |
| <C color="crimson">**NAT gateway**</C> | Charged per GB *and* per hour; every private-subnet call to the internet pays |
| <C color="crimson">**Logging and observability**</C> | Priced per GB ingested; verbose logging can rival the service producing it |
| **Managed database** | 10–20× object storage per GB, plus IOPS |
| **Load balancers** | Per-hour plus per-request; many small ALBs add up |
| **Snapshots and backups** | Accumulate silently, retained forever by default |
| <C color="crimson">**Idle non-production**</C> | Staging running 24/7 for a team that works 8/5 |

<H>Three items dominate surprise bills more than anything else: data transfer between zones, NAT gateway charges, and log ingestion. None appears in a capacity plan, and all three scale with traffic.</H>

<C color="orange">Cross-AZ transfer is the quietest of these.</C> A multi-AZ deployment with services calling each other at random puts roughly two-thirds of internal traffic across zone boundaries, charged in both directions. <C color="green">Zone-aware routing — prefer a local instance, fail over across zones — can remove most of it</C> with no architectural change.

---

## 2. Unit economics

<Jargon
  plain="What one unit of your business costs to serve — per user, per request, per order."
  term="unit economics"
  also={['cost per user', 'COGS per transaction']}>

<C color="green">Total cost tells you nothing on its own.</C> A bill growing with revenue is fine; a **cost per user** that grows is a business problem that scale will make worse, not better.

</Jargon>

<Trace title="Diagnosing a tripled infrastructure bill" subtitle="Total cost is the wrong number to start from.">

<TraceStep
  title="The alarm"
  state={{ 'Monthly cost': '$18,000 → $54,000', 'Users': '40K → 120K', 'Cost per user': '?', 'Verdict': 'panic' }}
  changed={['Monthly cost', 'Users']}
  note="A tripled bill sounds like an emergency. Look at what it is divided by.">

Costs tripled over eight months and leadership wants it cut.

</TraceStep>

<TraceStep
  title="Divide by users"
  state={{ 'Monthly cost': '$54,000', 'Users': '120K', 'Cost per user': '$0.45 → $0.45', 'Verdict': 'not a problem' }}
  changed={['Cost per user', 'Verdict']}
  note="Cost tripled because usage tripled. That is a healthy business, not a cost incident.">

<C color="green">Cost per user is unchanged.</C> The system scales linearly and the bill is doing exactly what it should.

</TraceStep>

<TraceStep
  title="Break it down by line item"
  cost="one item is superlinear"
  state={{ 'Compute': '$0.18/user', 'Database': '$0.11/user', 'Logging': '$0.04 → $0.13/user', 'Verdict': 'found it' }}
  changed={['Compute', 'Database', 'Logging', 'Verdict']}
  note="Aggregate unit cost was flat because one item falling offset one item rising.">

Most items are flat per user. <C color="crimson">Logging cost per user has more than tripled</C> — it is growing superlinearly.

</TraceStep>

<TraceStep
  title="Find the cause"
  state={{ 'Logging': '$16,000/month', 'Cause': 'debug logging left on', 'Volume': '4 TB/day', 'Fix': 'one config change' }}
  changed={['Logging', 'Cause', 'Volume', 'Fix']}
  note="Enabled during an incident four months ago and never reverted — a change nobody would call an architecture decision.">

A verbose log level was left enabled after an incident. <C color="crimson">Logging now costs more than the database.</C>

</TraceStep>

<TraceStep
  title="The reading"
  state={{ 'Total cost': 'grew as expected', 'Real issue': 'one line item, one config', 'Saved': '$12,000/month', 'Verdict': 'resolved' }}
  changed={['Total cost', 'Real issue', 'Saved']}
  note="Cutting 30% off the bill by reverting a config change nobody had connected to cost.">

<H>Track cost per unit, per line item. Total cost growing with usage is health; a unit cost growing is a defect — and the aggregate can hide it when one item falls while another rises.</H>

</TraceStep>

</Trace>

---

## 3. Design decisions that are cost decisions

Many choices presented as architectural are really economic, and stating them that way makes the trade explicit.

| Decision | The cost dimension |
| :--- | :--- |
| Multi-region active-active | <C color="crimson">~2× everything</C>, for availability most products do not need |
| Microservices | More instances, more load balancers, more cross-service transfer |
| Serverless vs containers | [Utilisation decides it](../09-architecture-styles/04-serverless.md), not request volume |
| Caching | RAM is 50–100× disk per GB — cache selectively |
| Log retention | 90 days hot can exceed the service producing it |
| Replication factor | Every copy is a full storage cost |
| Storage tiering | 5–10× reduction for lifecycle rules and no code change |
| Over-provisioned headroom | Reliability you are buying; price it deliberately |

<C color="green">The point is not to choose the cheap option.</C> It is to know the price of the expensive one, so the choice is deliberate. Multi-region for a product that can survive an hour of downtime is a real decision to make with a real number attached — not a default.

<Depth title="Estimating cost at design time, and the traps in doing it">

Cost should be estimated alongside latency and capacity, from the same [back-of-the-envelope numbers](../01-foundations/05-back-of-the-envelope-estimation.md).

**The method:**

1. **Take your traffic and storage estimates** — you already computed them.
2. **Multiply by rough unit prices**, to one significant figure.
3. **Include the items people forget** — transfer, NAT, logging, backups.
4. **Divide by users or requests** to get unit economics.
5. **Compare against revenue per user.** If infrastructure is 40% of revenue, the architecture is a business problem.

**Rough figures to reason with** (order of magnitude; check current pricing):

```
  Compute            ~$0.04 / vCPU-hour
  Managed DB storage ~$0.10 / GB-month
  Object storage     ~$0.023 / GB-month     (~4× cheaper than block, ~20× vs DB)
  Internet egress    ~$0.09 / GB            ← usually the surprise
  Cross-AZ transfer  ~$0.01 / GB each way   ← the quiet one
  NAT gateway        ~$0.045 / GB + hourly
  Log ingestion      ~$0.50 / GB            ← 20× object storage, per GB, once
```

<C color="crimson">Log ingestion at roughly $0.50/GB is the number that surprises people most.</C> One terabyte a day is ~$15,000 a month — routinely more than the compute generating it.

**The traps:**

**1. Estimating steady state and being billed for peak.** Provisioned capacity is charged whether used or not. A fleet sized for a 10× spike costs 10× around the clock unless it autoscales.

**2. Forgetting non-production.** Staging, QA, preview environments and abandoned experiments often total 30–50% of the production bill, running continuously for teams that work eight hours a day. <C color="green">Scheduled shutdown of non-production is one of the highest-value, lowest-risk savings available.</C>

**3. Ignoring the retention tail.** Storage costs are cumulative. 3 TB/day at $0.023/GB is ~$70 on day one and ~$25,000 a month after three years. <C color="green">Lifecycle policies must be designed at the start</C>, because retrofitting them means deciding what to delete under pressure.

**4. Missing the multiplier on replication.** Every stored byte is typically three. A "5 PB" estimate is a 15 PB bill.

**5. Counting only marginal cost.** A design needing a platform team to operate has a salary cost dwarfing its infrastructure. <C color="orange">Operational burden is a cost line, and it is usually the largest one</C> — which is the strongest argument for managed services and against premature distribution.

**The most valuable practice: make cost visible to the people making the decisions.**

- **Tag everything** by team, service and environment, so the bill can be attributed.
- **Show cost per service** on the same dashboard as latency and error rate.
- **Include a cost estimate in design documents**, alongside the capacity estimate.
- **Alert on anomalies** — a sudden increase is usually a bug, not growth.

<H>Engineers optimise what they can see. A team shown their service's monthly cost next to its p99 will make different decisions than one shown only the p99 — without anyone being told to spend less.</H>

</Depth>

---

## 4. In a design discussion

- **"Roughly $4,000 a month at this scale, dominated by log ingestion and cross-AZ transfer — not compute."** Prices the design and names the real drivers.
- **"Cost per user is flat, so the bill tripling is just growth. The line item to investigate is the one growing superlinearly."** The right diagnostic frame.
- **"Multi-region doubles the bill for availability we haven't been asked for. Single region with tested DR gets us most of the way at half the cost."** Makes an implicit decision explicit.
- **"Lifecycle rules from day one — storage is cumulative, and retrofitting retention means deleting data under pressure."** Designs for the tail.

---

## Rapid-fire recall

1. Why is cost invisible to the people who determine it?
2. Name the three line items that dominate surprise bills.
3. Why does cross-AZ transfer accumulate quietly, and what removes most of it?
4. What is unit economics, and why is total cost the wrong starting number?
5. In the trace, why did flat aggregate unit cost hide the problem?
6. Give five design decisions that are really cost decisions.
7. Roughly how does log ingestion compare to object storage per GB?
8. Why must lifecycle policies be designed at the start?
9. Which cost line is usually largest and least counted?
10. What single practice most changes engineering behaviour on cost?

<details>
<summary>Answers</summary>

1. Because **the bill arrives monthly and goes to a different team**. The engineer choosing the design never sees the number, and the person seeing the number cannot trace it to a decision.
2. **Data transfer** (egress and cross-AZ) · **NAT gateway** charges · **log and observability ingestion**. None appears in a capacity plan, and all three scale with traffic.
3. Because services calling each other at random across a multi-AZ deployment send roughly **two-thirds of internal traffic across zone boundaries**, charged in **both directions**. **Zone-aware routing** — prefer a local instance, fail over across zones — removes most of it with no architectural change.
4. **Cost per unit of business** — per user, per request, per order. Total cost is the wrong start because a bill that grows with usage is **healthy**; only a **rising unit cost** indicates a defect.
5. Because **one line item fell while another rose**, so the aggregate stayed flat. The superlinear growth in logging was only visible when broken down per line item.
6. **Multi-region** (~2×) · **microservices** (more instances, LBs, cross-service transfer) · **serverless vs containers** (decided by utilisation) · **caching** (RAM is 50–100× disk) · **log retention** · **replication factor** · **storage tiering** · **headroom**.
7. Log ingestion is roughly **$0.50/GB** against object storage at roughly **$0.023/GB-month** — about **20×**, charged per GB ingested. One TB/day is ~$15,000 a month, often exceeding the compute producing it.
8. Because **storage costs are cumulative** — 3 TB/day is ~$70 in month one and ~$25,000/month after three years. Retrofitting retention means deciding what to delete under pressure, with no plan.
9. **Operational burden** — the engineering salaries required to run the architecture. It dwarfs infrastructure spend and is the strongest argument for managed services and against premature distribution.
10. **Making cost visible next to the metrics engineers already watch** — cost per service on the same dashboard as latency and error rate, plus cost estimates in design documents. Engineers optimise what they can see.

</details>

---

**Part A is complete.** From here: **[Building Blocks](/systemDesign/building-blocks)** for the reusable primitives, **[Case Studies](/systemDesign/case-studies)** for what real companies did, **[Interview Prep](/systemDesign/interview-prep)** for the framework and drills, and **[Low-Level Design](/systemDesign/low-level-design)** for the object-level round.
