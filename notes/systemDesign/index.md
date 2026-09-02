---
title: System Design
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';

# System Design

System design is the discipline of choosing <C color="orange">**which trade-offs to make**</C> for a system you cannot fully test before you build it. <H>Nothing here is a fact to memorise; everything is a decision with a cost on both sides.</H>

That shapes how this section is organised. Most material mixes three different activities together and calls all of them "system design". They are not the same, and they reward different kinds of study:

| Part | What it is | How you study it |
| :-- | :--- | :--- |
| **A — [Concepts](/systemDesign/concepts)** | The reusable vocabulary: load balancers, replication, CAP, queues | Read once, deeply. Understand the mechanism, not the name. |
| **B — [Building Blocks](/systemDesign/building-blocks)** | Small primitives that appear inside half of all designs | Learn each once so you never re-derive it under pressure. |
| **C — [Case Studies](/systemDesign/case-studies)** | What real companies actually built, and what actually broke | Read for the *constraints*, which is where the real lesson lives. |
| **D — [Interview Prep](/systemDesign/interview-prep)** | A framework, then design drills | Practice out loud, timed. Reading these is nearly worthless. |
| **E — [Low-Level Design](/systemDesign/low-level-design)** | Classes and concurrency inside one service | A different interview round and a genuinely different skill. |

Every page traces the <C color="orange">**mechanism**</C>: what the packet does, where the bytes sit, which machine fails and what happens next.

---

## How every page is built

Pages are written in layers so that one read works whether this is your first day or your tenth year. **Read straight down** — the depth is opt-in, not hidden.

| | Layer | Who it is for |
| :-- | :--- | :--- |
| 🧭 | **Start here — in plain words.** An analogy, no jargon, and why the topic matters at all. | Skip it once it is obvious to you. It takes fifteen seconds to skim. |
| 💬 | **The word to use.** The idea in ordinary language, then the exact term an interviewer expects. | Beginners get the concept; experienced readers get the phrasing to say out loud. |
| ▶ | **Traced mechanisms.** Step through what actually happens, one step at a time, watching the state change beside it. | Everyone. This is the spine of the page. |
| 🟣 | **Go deeper.** Collapsed drawers holding the derivations, the maths, the kernel-level detail. | Open them when you want the *why* under the *what*. Skipping them loses nothing. |
| ⚖️ | **Trade-offs and failure modes.** What each choice costs and how it breaks. | The part that separates a design from a diagram. |
| 🔁 | **Rapid-fire recall.** Questions with collapsible answers. | Self-testing before an interview. |

<Plain>

**If you have never studied system design:** read only the plain-words boxes, the traces, and the trade-off tables. Skip every purple drawer on the first pass. That is a complete, honest path through the material — you will not be missing anything you need yet.

</Plain>

Colour is used consistently throughout: <C color="green">green for the correct or safe option</C>, <C color="crimson">crimson for the wrong or dangerous one</C>, <C color="orange">orange for the idea carrying the nuance</C>, and <H>a highlight for the one sentence in a section worth remembering</H>.

---

## Part A — Concepts

Ordered along the path a request travels: in from the network, through the edge, into the data layer, back out — then the concerns that cut across every layer.

### 1. Foundations — before any component

| | Page | What it answers |
| :-- | :--- | :--- |
| 1 | **[What Is System Design?](./01-foundations/01-what-is-system-design.md)** | What the discipline actually is, why there are no right answers, and the four questions behind every design |
| 2 | **[Requirements & Constraints](./01-foundations/02-requirements-and-constraints.md)** | Turning "design Twitter" into numbers; functional vs non-functional; the questions that change the architecture |
| 3 | **[SLIs, SLOs & Error Budgets](./01-foundations/03-slis-slos-and-error-budgets.md)** | Reliability as a number you can spend, why 100% is the wrong target, and what nines actually cost |
| 4 | **[Latency Numbers & The Cost of Distance](./01-foundations/04-latency-numbers.md)** | The numbers to know by heart, why a cross-continent round trip has a floor set by physics |
| 5 | **[Back-of-the-Envelope Estimation](./01-foundations/05-back-of-the-envelope-estimation.md)** | QPS, storage and bandwidth in sixty seconds — with worked examples |
| 6 | **[Thinking In Trade-offs](./01-foundations/06-thinking-in-tradeoffs.md)** | The axes you are actually trading along, cost as a first-class constraint, and when *not* to distribute |

### 2. Networking & Communication — how a request reaches you

| | Page | What it answers |
| :-- | :--- | :--- |
| 7 | **[DNS](./02-networking/01-dns.md)** | The four server roles, why TTL is a deploy constraint, and why DNS is a poor load balancer |
| 8 | **[TCP & UDP](./02-networking/02-tcp-and-udp.md)** | The handshake you pay for every time, slow start, head-of-line blocking, and why QUIC runs on UDP |
| 9 | **[TLS](./02-networking/03-tls.md)** | What encryption guarantees, what 1.3 removed, the 0-RTT replay risk, and where to terminate |
| 10 | **[HTTP, 1.1 → 2 → 3](./02-networking/04-http-evolution.md)** | What each version fixed and left broken, plus the semantics that matter: idempotency, status classes, caching headers |
| 11 | **[REST, gRPC & GraphQL](./02-networking/05-rest-grpc-graphql.md)** | Who decides the response shape, over- and under-fetching, and GraphQL's three real costs |
| 12 | **[Real-Time Communication](./02-networking/06-realtime-communication.md)** | Polling, long polling, SSE, **WebSockets** and webhooks — and why WebSockets make your servers stateful |

### 3. Traffic Management & The Edge — before your code runs

| | Page | What it answers |
| :-- | :--- | :--- |
| 13 | **[Load Balancers](./03-traffic-and-edge/01-load-balancers.md)** | L4 vs L7 and why it's really a TLS decision, choosing an algorithm, and the health check that ejects your whole fleet |
| 14 | **[Reverse Proxies & API Gateways](./03-traffic-and-edge/02-reverse-proxy-and-api-gateway.md)** | Forward vs reverse settled, what belongs in a gateway, BFF, and how a gateway becomes a distributed monolith |
| 15 | **[CDNs](./03-traffic-and-edge/03-cdn.md)** | Why a CDN helps content it can't cache, cache-key design, the `Vary` trap, and cache stampedes |
| 16 | **[Rate Limiting](./03-traffic-and-edge/04-rate-limiting.md)** | Four algorithms and what each gets wrong, distributed counters, and what happens when the limiter itself fails |
| 17 | **[Service Mesh](./03-traffic-and-edge/05-service-mesh.md)** | Sidecars, data vs control plane, the real costs, and why retries multiply to 27× along a call chain |

### 4. Data Storage & Modeling — where the bytes rest

| | Page | What it answers |
| :-- | :--- | :--- |
| 18 | **[SQL vs NoSQL](./04-data-storage/01-sql-vs-nosql.md)** | The five NoSQL families, why "NoSQL scales better" is mostly false, and the one question that picks a model |
| 19 | **[Indexes & Query Plans](./04-data-storage/02-indexes-and-query-plans.md)** | A query traced from text to results, reading `EXPLAIN`, composite column order, and why an index gets ignored |
| 20 | **[Storage Engines — B-Tree vs LSM](./04-data-storage/03-storage-engines.md)** | Why some databases are fast to write and others fast to read, the three amplifications, and why a delete can grow your disk |
| 21 | **[Transactions & Isolation Levels](./04-data-storage/04-transactions-and-isolation.md)** | What ACID really promises, the anomalies your default level still allows, and lost updates traced step by step |
| 22 | **[Normalization & Denormalization](./04-data-storage/05-normalization-and-denormalization.md)** | The three anomalies, the cache-vs-historical-record distinction, and what a copied column actually costs |
| 23 | **[Object & Blob Storage](./04-data-storage/06-object-storage.md)** | Why files never belong in a database, uploads that bypass your servers, and what eleven nines does *not* protect |

### 5. Scaling The Data Layer — when one machine is not enough

| | Page | What it answers |
| :-- | :--- | :--- |
| 24 | **[Replication](./05-data-at-scale/01-replication.md)** | Single-leader vs multi-leader vs leaderless, replication lag anomalies, and why replication is not a backup |
| 25 | **[Partitioning and Sharding](./05-data-at-scale/02-partitioning-and-sharding.md)** | Choosing a shard key you cannot undo, hot partitions, and everything you lose when data spans machines |
| 26 | **[Consistent Hashing](./05-data-at-scale/03-consistent-hashing.md)** | Adding a node without moving everything, and why virtual nodes are mandatory |
| 27 | **[Zero-Downtime Migrations](./05-data-at-scale/04-zero-downtime-migrations.md)** | Expand-migrate-contract, batched backfills, and why CDC beats application dual writes |

### 6. Distributed Systems Theory — the constraints underneath

| | Page | What it answers |
| :-- | :--- | :--- |
| 28 | **[CAP and PACELC](./06-distributed-systems/01-cap-and-pacelc.md)** | Why "pick two" is wrong, and the model that describes what your system does every other day |
| 29 | **[Consistency Models](./06-distributed-systems/02-consistency-models.md)** | The spectrum from linearizable to eventual, and the session guarantees that fix most real complaints |
| 30 | **[Consensus and Quorums](./06-distributed-systems/03-consensus-and-quorums.md)** | Why a majority is the smallest safe quorum, Raft traced, and why your distributed lock is unsafe |
| 31 | **[Time and Ordering](./06-distributed-systems/04-time-and-ordering.md)** | Why clocks cannot order events, Lamport vs vector clocks, and how last-write-wins loses data |
| 32 | **[Idempotency and Delivery](./06-distributed-systems/05-idempotency-and-delivery.md)** | Why exactly-once delivery is impossible, and idempotency keys that survive concurrency |
| 33 | **[Distributed Transactions](./06-distributed-systems/06-distributed-transactions.md)** | Why 2PC blocks, how sagas compensate, the outbox pattern, and how to avoid needing any of it |

### 7. Caching — the highest-leverage optimisation

| | Page | What it answers |
| :-- | :--- | :--- |
| 34 | **[Caching Fundamentals](./07-caching/01-caching-fundamentals.md)** | Every layer that can cache, hit-ratio arithmetic, and why caching a fast query makes it slower |
| 35 | **[Caching Patterns](./07-caching/02-caching-patterns.md)** | The five patterns, the cache-aside race, and why you delete rather than update |
| 36 | **[Eviction and Invalidation](./07-caching/03-eviction-and-invalidation.md)** | Two different problems, choosing a policy, and why a scan can destroy your cache |
| 37 | **[Cache Failure Modes](./07-caching/04-cache-failure-modes.md)** | Stampedes, penetration, avalanches, hot keys — and what happens when the cache itself dies |

### 8. Asynchronous and Event-Driven — work that happens later

| | Page | What it answers |
| :-- | :--- | :--- |
| 38 | **[Message Queues](./08-async-and-events/01-message-queues.md)** | What a queue really buys, acks and DLQs traced, and when a queue makes an outage worse |
| 39 | **[Log-Based Streams](./08-async-and-events/02-log-based-streams.md)** | Why a log beats a queue, partitions and consumer groups, and where exactly-once stops applying |
| 40 | **[Workers and Background Jobs](./08-async-and-events/03-workers-and-jobs.md)** | Surviving being killed halfway, running a scheduled job exactly once, and noticing when it stops |
| 41 | **[Backpressure and Flow Control](./08-async-and-events/04-backpressure.md)** | Why unbounded queues guarantee failure, and the four responses to overload |
| 42 | **[Event-Driven Architecture](./08-async-and-events/05-event-driven-architecture.md)** | Events vs commands, thin vs fat events, schema evolution, and the comprehension cost |

### 9. Architecture Styles — how big a deployable should be

| | Page | What it answers |
| :-- | :--- | :--- |
| 43 | **[Monolith and Microservices](./09-architecture-styles/01-monolith-and-microservices.md)** | What microservices actually buy, why the modular monolith is the default, and what justifies splitting |
| 44 | **[Service Boundaries](./09-architecture-styles/02-service-boundaries.md)** | Aggregates, bounded contexts, the three wrong ways to split, and four tests for a bad boundary |
| 45 | **[Event Sourcing and CQRS](./09-architecture-styles/03-event-sourcing-and-cqrs.md)** | Storing what happened instead of what is, why the two patterns are independent, and when they earn it |
| 46 | **[Serverless](./09-architecture-styles/04-serverless.md)** | Cold starts, the cost crossover, and the connection-exhaustion failure most teams meet in production |

### 10. Reliability and Resilience — designing for failure

| | Page | What it answers |
| :-- | :--- | :--- |
| 47 | **[Failure and Redundancy](./10-reliability/01-failure-and-redundancy.md)** | The six failure modes, why redundancy underdelivers, blast radius and shuffle sharding |
| 48 | **[Timeouts, Retries and Circuit Breakers](./10-reliability/02-timeouts-retries-circuit-breakers.md)** | Setting a timeout from data, retrying without amplifying, and how a cascading failure unfolds |
| 49 | **[Graceful Degradation](./10-reliability/03-graceful-degradation.md)** | Ranking features, fallbacks worth having, and when a fallback is worse than an error |
| 50 | **[Disaster Recovery](./10-reliability/04-disaster-recovery.md)** | RTO and RPO, the four strategies, why an untested backup is a hypothesis, and what breaks in a real failover |


### 11. Performance and Capacity — making it fast, and knowing how much to buy

| | Page | What it answers |
| :-- | :--- | :--- |
| 51 | **[Latency and Throughput](./11-performance/01-latency-and-throughput.md)** | Why improving one worsens the other, Little's Law, and why tail latency is what users feel |
| 52 | **[Capacity Planning](./11-performance/02-capacity-planning.md)** | Finding the real bottleneck, choosing a utilisation target, and load tests that measure something true |
| 53 | **[Performance Optimisation](./11-performance/03-performance-optimisation.md)** | Where the time actually goes, Amdahl's ceiling, and the optimisations that make things slower |

### 12. Security — who you are, what you may do, and what goes wrong

| | Page | What it answers |
| :-- | :--- | :--- |
| 54 | **[Authentication](./12-security/01-authentication.md)** | Sessions vs tokens, why a JWT cannot be revoked, OAuth2 traced, and where to put the token |
| 55 | **[Authorization](./12-security/02-authorization.md)** | RBAC vs ABAC vs ReBAC, IDOR and how to prevent it structurally, and multi-tenant isolation |
| 56 | **[Secrets and Encryption](./12-security/03-secrets-and-encryption.md)** | What encryption at rest really protects, envelope encryption, and what field-level encryption breaks |
| 57 | **[Common Attacks](./12-security/04-common-attacks.md)** | Injection as a parsing problem, SSRF to account compromise, and defences that only look like defences |

### 13. Observability and Delivery — knowing, and shipping safely

| | Page | What it answers |
| :-- | :--- | :--- |
| 58 | **[Logs, Metrics and Traces](./13-observability/01-logs-metrics-traces.md)** | What each signal is for, why cardinality decides your bill, and monitoring vs observability |
| 59 | **[Alerting and On-Call](./13-observability/02-alerting-and-oncall.md)** | Symptoms not causes, burn-rate alerting, and postmortems that produce change |
| 60 | **[Deployment Strategies](./13-observability/03-deployment-strategies.md)** | Deploy vs release, canaries that actually catch things, and changes you cannot roll back |
| 61 | **[Cost as a Design Constraint](./13-observability/04-cost-as-a-constraint.md)** | What dominates a real cloud bill, unit economics, and pricing a design before building it |

---


## Part B — [Building Blocks](/systemDesign/building-blocks)

| | Page | What it answers |
| :-- | :--- | :--- |
| 1 | **[Unique ID Generation](./14-building-blocks/01-unique-id-generation.md)** | Why auto-increment dies at scale, and how Snowflake buys sortable 64-bit IDs with no coordination |
| 2 | **[Bloom Filters](./14-building-blocks/02-bloom-filters.md)** | Membership in constant space, why false negatives are impossible, and sizing one from two numbers |
| 3 | **[Geospatial Indexing](./14-building-blocks/03-geospatial-indexing.md)** | Turning "what is near me?" into a prefix search, and the boundary bug that makes naive versions wrong |
| 4 | **[Leaderboards and Top-K](./14-building-blocks/04-leaderboards-and-top-k.md)** | Ranking without sorting everything, answering "what is my rank?", and top-K on an unbounded stream |
| 5 | **[Counters at Scale](./14-building-blocks/05-counters-at-scale.md)** | Why one row cannot absorb increments, sharding and batching, and which counters must be exact |
| 6 | **[Notification Systems](./14-building-blocks/06-notification-systems.md)** | Celebrity-scale fan-out, third-party providers that fail, and why duplicates lose users permanently |
| 7 | **[Search Autocomplete](./14-building-blocks/07-search-autocomplete.md)** | Suggestions in single-digit milliseconds, and why the trie disappears at serve time |

---

## Part C — [Case Studies](/systemDesign/case-studies)

| | Page | What it answers |
| :-- | :--- | :--- |
| 1 | **[How To Read A Case Study](./15-case-studies/01-how-to-read-a-case-study.md)** | Why "X uses Kafka" is worthless without X's constraints, and the six questions to ask of any war story |

**Architecture pivots** — teams that changed their minds, and why

| | Page | The transferable finding |
| :-- | :--- | :--- |
| 2 | **[Prime Video — Microservices to Monolith](./15-case-studies/02-prime-video-monolith.md)** | Do not draw a service boundary across a high-bandwidth data path |
| 3 | **[Segment — 140 Services Back to One](./15-case-studies/03-segment-monolith.md)** | Operational cost scales with the *number* of services, not their size |
| 4 | **[Twitter's Timeline](./15-case-studies/04-twitter-timeline.md)** | An extreme tail means one strategy will be wrong at one end |
| 5 | **[Discord's Storage Migrations](./15-case-studies/05-discord-storage.md)** | When the model fits and the implementation does not, change the implementation |
| 6 | **[Figma's Sharding](./15-case-studies/06-figma-sharding.md)** | Validate an irreversible decision while it is still free to change |

**Postmortems** — where the constraints become visible

| | Page | What made it long |
| :-- | :--- | :--- |
| 7 | **[AWS S3, February 2017](./15-case-studies/07-aws-s3-2017.md)** | An unexercised restart path, and a dashboard that depended on S3 |
| 8 | **[GitHub, October 2018](./15-case-studies/08-github-2018.md)** | 43 seconds of partition, 24 hours of reconciliation |
| 9 | **[Cloudflare, July 2019](./15-case-studies/09-cloudflare-2019.md)** | One regex, deployed globally in seconds, with no staging |
| 10 | **[Roblox, October 2021](./15-case-studies/10-roblox-2021.md)** | A dependency with no degraded mode and no way to route around |

---

## Part D — [Interview Prep](/systemDesign/interview-prep)

| | Page | What it answers |
| :-- | :--- | :--- |
| 1 | **[The Framework](./16-interview-prep/01-the-framework.md)** | The seven moves of a 45-minute design round, minute by minute, and the four ways candidates lose |

Each drill follows the same shape — scope, estimate, API, data model, design, deep dive, bottlenecks — so the framework becomes habitual rather than something you remember to apply.

| Group | | Drill | The pattern it teaches |
| :--- | :-- | :--- | :--- |
| **Warm-ups** | 2 | **[URL Shortener](./16-interview-prep/02-url-shortener.md)** | Read-heavy caching; ID generation without coordination |
| | 3 | **[Distributed Key-Value Store](./16-interview-prep/03-key-value-store.md)** | Partitioning, quorums and conflict resolution together |
| **Feed and social** | 4 | **[Twitter](./16-interview-prep/04-twitter.md)** | Fan-out, and the celebrity tail |
| | 5 | **[Instagram](./16-interview-prep/05-instagram.md)** | The same feed, plus an async media pipeline |
| **Media** | 6 | **[YouTube](./16-interview-prep/06-youtube.md)** | Bandwidth as the dominant constraint |
| | 7 | **[Spotify](./16-interview-prep/07-spotify.md)** | A bounded catalogue; licensing and billable counts |
| **Realtime** | 8 | **[WhatsApp](./16-interview-prep/08-whatsapp.md)** | Connections as server state; offline as the common case |
| | 9 | **[Google Docs](./16-interview-prep/09-google-docs.md)** | Concurrent mutation of shared ordered state — OT and CRDTs |
| **Geo and commerce** | 10 | **[Uber](./16-interview-prep/10-uber.md)** | Disposable telemetry; candidate generation vs ranking |
| | 11 | **[Ticketmaster](./16-interview-prep/11-ticketmaster.md)** | Extreme contention where correctness beats throughput |
| | 12 | **[Ad Click Aggregator](./16-interview-prep/12-ad-click-aggregator.md)** | Fast-and-approximate versus slow-and-exact, from one log |
| **Infra scale** | 13 | **[Web Crawler](./16-interview-prep/13-web-crawler.md)** | Politeness, deduplication at scale, and traps |
| | 14 | **[Dropbox](./16-interview-prep/14-dropbox.md)** | Content-addressed chunking; conflicts you cannot merge |

---

## Part E — [Low-Level Design](/systemDesign/low-level-design)

| | Page | What it answers |
| :-- | :--- | :--- |
| 1 | **[What Is Low-Level Design?](./17-low-level-design/01-what-is-low-level-design.md)** | Where HLD stops and LLD starts, and why the parking lot question is not a scaling question |
| 2 | **[SOLID in Practice](./17-low-level-design/02-solid-in-practice.md)** | Each principle as the failure it prevents, and why over-applying it is its own failure |
| 3 | **[Design Patterns Worth Knowing](./17-low-level-design/03-design-patterns.md)** | The six or seven that actually appear, and the ones that are usually a mistake |
| 4 | **[Design a Parking Lot](./17-low-level-design/04-parking-lot.md)** | The canonical problem — counting how many classes a new requirement touches |
| 5 | **[Design an Elevator System](./17-low-level-design/05-elevator.md)** | Dispatch as the real problem, and a safety-critical state machine |
| 6 | **[Design an LRU Cache](./17-low-level-design/06-lru-cache.md)** | Map plus doubly-linked list, and why a read-write lock does not help |
| 7 | **[Design a Movie Booking System](./17-low-level-design/07-movie-booking.md)** | Identifying the contended entity, and making the transition atomic |

---

## How to use this section

- **Learning from scratch?** Part A, in order. Concepts build on each other; page 6 assumes page 3.
- **Interviewing in two weeks?** [The Framework](./16-interview-prep/01-the-framework.md), then one drill per day out loud with a timer. Dip into Part A only when a drill exposes a gap.
- **Already senior?** Part C. The pivots and postmortems are where the assumptions you have accumulated get tested.
