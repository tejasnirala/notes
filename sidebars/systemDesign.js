// @ts-check

/**
 * System Design sidebar.
 *
 * The section is split by *kind of thing you are learning*, not by topic:
 *
 *   Part A — Concepts          the reusable vocabulary, ordered along the path a request travels
 *   Part B — Building Blocks   small primitives that show up inside half of all designs
 *   Part C — Case Studies      what real companies actually did, and what broke
 *   Part D — Interview Prep    the framework, then design drills grouped by the pattern they teach
 *   Part E — Low-Level Design  object-level design; a different interview round, a different skill
 *
 * Doc IDs omit numeric prefixes on BOTH folders and files, so
 * `01-foundations/03-slos-and-error-budgets.md` has the id
 * `foundations/slos-and-error-budgets`.
 *
 * The `slug` on each Part's generated-index is a public URL referenced by the
 * navbar dropdown in docusaurus.config.js — do not rename one without the other.
 *
 * @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */

const sidebars = {
  systemDesignSidebar: [
    {
      type: "category",
      label: "System Design",
      link: {
        type: "doc",
        id: "index",
      },
      collapsed: false,
      items: [
        {
          type: "category",
          label: "Part A — Concepts",
          link: {
            type: "generated-index",
            title: "Concepts",
            description:
              "The vocabulary of system design, ordered along the path a request actually travels: in from the network, through the edge, into the data layer, and back out — then the concerns that cut across every layer.",
            slug: "/concepts",
          },
          collapsed: false,
          items: [
            {
              type: "category",
              label: "1. Foundations",
              link: {
                type: "generated-index",
                title: "Foundations",
                description:
                  "Before any component: what the discipline actually is, how to turn a vague ask into constraints, how to express reliability as a number, and how to size a system on the back of an envelope.",
                slug: "/foundations",
              },
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "foundations/what-is-system-design",
                  label: "What Is System Design?",
                },
                {
                  type: "doc",
                  id: "foundations/requirements-and-constraints",
                  label: "Requirements & Constraints",
                },
                {
                  type: "doc",
                  id: "foundations/slis-slos-and-error-budgets",
                  label: "SLIs, SLOs & Error Budgets",
                },
                {
                  type: "doc",
                  id: "foundations/latency-numbers",
                  label: "Latency Numbers & The Cost of Distance",
                },
                {
                  type: "doc",
                  id: "foundations/back-of-the-envelope-estimation",
                  label: "Back-of-the-Envelope Estimation",
                },
                {
                  type: "doc",
                  id: "foundations/thinking-in-tradeoffs",
                  label: "Thinking In Trade-offs",
                },
              ],
            },
            {
              type: "category",
              label: "2. Networking & Communication",
              link: {
                type: "generated-index",
                title: "Networking & Communication",
                description:
                  "How a request physically reaches your server and gets an answer back: name resolution, the transport handshakes you pay for, the HTTP versions layered on top, and the API styles and real-time patterns built from them.",
                slug: "/networking",
              },
              collapsed: true,
              items: [
                { type: "doc", id: "networking/dns", label: "DNS" },
                { type: "doc", id: "networking/tcp-and-udp", label: "TCP & UDP" },
                { type: "doc", id: "networking/tls", label: "TLS" },
                {
                  type: "doc",
                  id: "networking/http-evolution",
                  label: "HTTP, 1.1 → 2 → 3",
                },
                {
                  type: "doc",
                  id: "networking/rest-grpc-graphql",
                  label: "REST, gRPC & GraphQL",
                },
                {
                  type: "doc",
                  id: "networking/realtime-communication",
                  label: "Real-Time Communication",
                },
              ],
            },
            {
              type: "category",
              label: "3. Traffic Management & The Edge",
              link: {
                type: "generated-index",
                title: "Traffic Management & The Edge",
                description:
                  "Everything between the user and your application code: spreading traffic across servers, the proxy that fronts them, the caches that keep requests from arriving at all, and the controls that decide who gets served.",
                slug: "/traffic-and-edge",
              },
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "traffic-and-edge/load-balancers",
                  label: "Load Balancers",
                },
                {
                  type: "doc",
                  id: "traffic-and-edge/reverse-proxy-and-api-gateway",
                  label: "Reverse Proxies & API Gateways",
                },
                { type: "doc", id: "traffic-and-edge/cdn", label: "CDNs" },
                {
                  type: "doc",
                  id: "traffic-and-edge/rate-limiting",
                  label: "Rate Limiting",
                },
                {
                  type: "doc",
                  id: "traffic-and-edge/service-mesh",
                  label: "Service Mesh",
                },
              ],
            },
            {
              type: "category",
              label: "4. Data Storage & Modeling",
              link: {
                type: "generated-index",
                title: "Data Storage & Modeling",
                description:
                  "Where bytes actually rest and how they are found again: choosing a database from access patterns, what an index really does, the two storage engines under almost everything, what transactions promise, and how many places one fact should live.",
                slug: "/data-storage",
              },
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "data-storage/sql-vs-nosql",
                  label: "SQL vs NoSQL",
                },
                {
                  type: "doc",
                  id: "data-storage/indexes-and-query-plans",
                  label: "Indexes & Query Plans",
                },
                {
                  type: "doc",
                  id: "data-storage/storage-engines",
                  label: "Storage Engines — B-Tree vs LSM",
                },
                {
                  type: "doc",
                  id: "data-storage/transactions-and-isolation",
                  label: "Transactions & Isolation Levels",
                },
                {
                  type: "doc",
                  id: "data-storage/normalization-and-denormalization",
                  label: "Normalization & Denormalization",
                },
                {
                  type: "doc",
                  id: "data-storage/object-storage",
                  label: "Object & Blob Storage",
                },
              ],
            },
            {
              type: "category",
              label: "5. Scaling The Data Layer",
              link: {
                type: "generated-index",
                title: "Scaling The Data Layer",
                description:
                  "Once one machine is not enough: copying data for reads and safety, splitting it across machines for capacity, and moving it all without downtime.",
                slug: "/data-at-scale",
              },
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "data-at-scale/replication",
                  label: "Replication",
                },
                {
                  type: "doc",
                  id: "data-at-scale/partitioning-and-sharding",
                  label: "Partitioning and Sharding",
                },
                {
                  type: "doc",
                  id: "data-at-scale/consistent-hashing",
                  label: "Consistent Hashing",
                },
                {
                  type: "doc",
                  id: "data-at-scale/zero-downtime-migrations",
                  label: "Zero-Downtime Migrations",
                },
              ],
            },
            {
              type: "category",
              label: "6. Distributed Systems Theory",
              link: {
                type: "generated-index",
                title: "Distributed Systems Theory",
                description:
                  "The results that constrain every distributed design: what you must give up during a partition, how machines agree on anything, why clocks cannot order events, and what to do when atomicity is unavailable.",
                slug: "/distributed-systems",
              },
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "distributed-systems/cap-and-pacelc",
                  label: "CAP and PACELC",
                },
                {
                  type: "doc",
                  id: "distributed-systems/consistency-models",
                  label: "Consistency Models",
                },
                {
                  type: "doc",
                  id: "distributed-systems/consensus-and-quorums",
                  label: "Consensus and Quorums",
                },
                {
                  type: "doc",
                  id: "distributed-systems/time-and-ordering",
                  label: "Time and Ordering",
                },
                {
                  type: "doc",
                  id: "distributed-systems/idempotency-and-delivery",
                  label: "Idempotency and Delivery Semantics",
                },
                {
                  type: "doc",
                  id: "distributed-systems/distributed-transactions",
                  label: "Distributed Transactions",
                },
              ],
            },
            {
              type: "category",
              label: "7. Caching",
              link: {
                type: "generated-index",
                title: "Caching",
                description:
                  "The highest return-on-effort optimisation available, and the one most likely to introduce a bug you cannot reproduce: where caches live, who writes to them, what to throw away, and how they fail.",
                slug: "/caching",
              },
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "caching/caching-fundamentals",
                  label: "Caching Fundamentals",
                },
                {
                  type: "doc",
                  id: "caching/caching-patterns",
                  label: "Caching Patterns",
                },
                {
                  type: "doc",
                  id: "caching/eviction-and-invalidation",
                  label: "Eviction and Invalidation",
                },
                {
                  type: "doc",
                  id: "caching/cache-failure-modes",
                  label: "Cache Failure Modes",
                },
              ],
            },
            {
              type: "category",
              label: "8. Asynchronous and Event-Driven",
              link: {
                type: "generated-index",
                title: "Asynchronous and Event-Driven",
                description:
                  "Work that does not happen now: queues and logs that carry it, workers that survive being killed halfway, what to do when you genuinely cannot keep up, and designing around things that happened.",
                slug: "/async-and-events",
              },
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "async-and-events/message-queues",
                  label: "Message Queues",
                },
                {
                  type: "doc",
                  id: "async-and-events/log-based-streams",
                  label: "Log-Based Streams",
                },
                {
                  type: "doc",
                  id: "async-and-events/workers-and-jobs",
                  label: "Workers and Background Jobs",
                },
                {
                  type: "doc",
                  id: "async-and-events/backpressure",
                  label: "Backpressure and Flow Control",
                },
                {
                  type: "doc",
                  id: "async-and-events/event-driven-architecture",
                  label: "Event-Driven Architecture",
                },
              ],
            },
            {
              type: "category",
              label: "9. Architecture Styles",
              link: {
                type: "generated-index",
                title: "Architecture Styles",
                description:
                  "How big a deployable should be, where to draw the lines between them, whether to store state or the events that produced it, and what paying per request changes.",
                slug: "/architecture-styles",
              },
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "architecture-styles/monolith-and-microservices",
                  label: "Monolith and Microservices",
                },
                {
                  type: "doc",
                  id: "architecture-styles/service-boundaries",
                  label: "Service Boundaries",
                },
                {
                  type: "doc",
                  id: "architecture-styles/event-sourcing-and-cqrs",
                  label: "Event Sourcing and CQRS",
                },
                {
                  type: "doc",
                  id: "architecture-styles/serverless",
                  label: "Serverless",
                },
              ],
            },
            {
              type: "category",
              label: "10. Reliability and Resilience",
              link: {
                type: "generated-index",
                title: "Reliability and Resilience",
                description:
                  "Designing for the assumption that everything breaks: how components actually fail, why redundancy underdelivers, the three settings that decide whether a failure spreads, and planning for what redundancy does not cover.",
                slug: "/reliability",
              },
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "reliability/failure-and-redundancy",
                  label: "Failure and Redundancy",
                },
                {
                  type: "doc",
                  id: "reliability/timeouts-retries-circuit-breakers",
                  label: "Timeouts, Retries and Circuit Breakers",
                },
                {
                  type: "doc",
                  id: "reliability/graceful-degradation",
                  label: "Graceful Degradation",
                },
                {
                  type: "doc",
                  id: "reliability/disaster-recovery",
                  label: "Disaster Recovery",
                },
              ],
            },
            {
              type: "category",
              label: "11. Performance and Capacity",
              link: {
                type: "generated-index",
                title: "Performance and Capacity",
                description:
                  "Two numbers that get conflated, how much to buy before you need it, and where the time actually goes when you go looking for it.",
                slug: "/performance",
              },
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "performance/latency-and-throughput",
                  label: "Latency and Throughput",
                },
                {
                  type: "doc",
                  id: "performance/capacity-planning",
                  label: "Capacity Planning",
                },
                {
                  type: "doc",
                  id: "performance/performance-optimisation",
                  label: "Performance Optimisation",
                },
              ],
            },
            {
              type: "category",
              label: "12. Security",
              link: {
                type: "generated-index",
                title: "Security",
                description:
                  "Proving who someone is, deciding what they may do, protecting data you have to store, and the attack classes that cause most real breaches.",
                slug: "/security",
              },
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "security/authentication",
                  label: "Authentication",
                },
                {
                  type: "doc",
                  id: "security/authorization",
                  label: "Authorization",
                },
                {
                  type: "doc",
                  id: "security/secrets-and-encryption",
                  label: "Secrets and Encryption",
                },
                {
                  type: "doc",
                  id: "security/common-attacks",
                  label: "Common Attacks",
                },
              ],
            },
            {
              type: "category",
              label: "13. Observability and Delivery",
              link: {
                type: "generated-index",
                title: "Observability and Delivery",
                description:
                  "Knowing what your system is doing, waking the right person for the right reason, shipping change without causing the incident, and the constraint most material leaves out.",
                slug: "/observability",
              },
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "observability/logs-metrics-traces",
                  label: "Logs, Metrics and Traces",
                },
                {
                  type: "doc",
                  id: "observability/alerting-and-oncall",
                  label: "Alerting and On-Call",
                },
                {
                  type: "doc",
                  id: "observability/deployment-strategies",
                  label: "Deployment Strategies",
                },
                {
                  type: "doc",
                  id: "observability/cost-as-a-constraint",
                  label: "Cost as a Design Constraint",
                },
              ],
            },
          ],
        },
        {
          type: "category",
          label: "Part B — Building Blocks",
          link: {
            type: "generated-index",
            title: "Building Blocks",
            description:
              "Self-contained primitives that appear inside half of all designs. Learn each one once, then drop it into a design instead of re-deriving it under interview pressure.",
            slug: "/building-blocks",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "building-blocks/unique-id-generation",
              label: "Unique ID Generation",
            },
            {
              type: "doc",
              id: "building-blocks/bloom-filters",
              label: "Bloom Filters",
            },
            {
              type: "doc",
              id: "building-blocks/geospatial-indexing",
              label: "Geospatial Indexing",
            },
            {
              type: "doc",
              id: "building-blocks/leaderboards-and-top-k",
              label: "Leaderboards and Top-K",
            },
            {
              type: "doc",
              id: "building-blocks/counters-at-scale",
              label: "Counters at Scale",
            },
            {
              type: "doc",
              id: "building-blocks/notification-systems",
              label: "Notification Systems",
            },
            {
              type: "doc",
              id: "building-blocks/search-autocomplete",
              label: "Search Autocomplete",
            },
          ],
        },
        {
          type: "category",
          label: "Part C — Case Studies",
          link: {
            type: "generated-index",
            title: "Case Studies",
            description:
              "Real architectures and real failures. Success stories hide their constraints; outages expose them — so both belong here.",
            slug: "/case-studies",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "case-studies/how-to-read-a-case-study",
              label: "How To Read A Case Study",
            },
            {
              type: "category",
              label: "Architecture Pivots",
              collapsed: true,
              items: [
              {
              type: "doc",
              id: "case-studies/prime-video-monolith",
              label: "Prime Video — Microservices to Monolith",
            },
              {
              type: "doc",
              id: "case-studies/segment-monolith",
              label: "Segment — 140 Services Back to One",
            },
              {
              type: "doc",
              id: "case-studies/twitter-timeline",
              label: "Twitter's Timeline",
            },
              {
              type: "doc",
              id: "case-studies/discord-storage",
              label: "Discord's Storage Migrations",
            },
              {
              type: "doc",
              id: "case-studies/figma-sharding",
              label: "Figma's Sharding",
            },
              ],
            },
            {
              type: "category",
              label: "Postmortems",
              collapsed: true,
              items: [
              {
              type: "doc",
              id: "case-studies/aws-s3-2017",
              label: "AWS S3, February 2017",
            },
              {
              type: "doc",
              id: "case-studies/github-2018",
              label: "GitHub, October 2018",
            },
              {
              type: "doc",
              id: "case-studies/cloudflare-2019",
              label: "Cloudflare, July 2019",
            },
              {
              type: "doc",
              id: "case-studies/roblox-2021",
              label: "Roblox, October 2021",
            },
              ],
            },
          ],
        },
        {
          type: "category",
          label: "Part D — Interview Prep",
          link: {
            type: "generated-index",
            title: "Interview Preparation",
            description:
              "A repeatable framework for the 45-minute design round, then drills grouped by the pattern each one teaches rather than by the company whose logo is on it.",
            slug: "/interview-prep",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "interview-prep/the-framework",
              label: "The Framework",
            },
            {
              type: "category",
              label: "Warm-ups",
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "interview-prep/url-shortener",
                  label: "Design a URL Shortener",
                },
                {
                  type: "doc",
                  id: "interview-prep/key-value-store",
                  label: "Design a Distributed Key-Value Store",
                },
              ],
            },
            {
              type: "category",
              label: "Feed and Social",
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "interview-prep/twitter",
                  label: "Design Twitter",
                },
                {
                  type: "doc",
                  id: "interview-prep/instagram",
                  label: "Design Instagram",
                },
              ],
            },
            {
              type: "category",
              label: "Media and Streaming",
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "interview-prep/youtube",
                  label: "Design YouTube",
                },
                {
                  type: "doc",
                  id: "interview-prep/spotify",
                  label: "Design Spotify",
                },
              ],
            },
            {
              type: "category",
              label: "Realtime and Collaboration",
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "interview-prep/whatsapp",
                  label: "Design WhatsApp",
                },
                {
                  type: "doc",
                  id: "interview-prep/google-docs",
                  label: "Design Google Docs",
                },
              ],
            },
            {
              type: "category",
              label: "Geospatial and Commerce",
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "interview-prep/uber",
                  label: "Design Uber",
                },
                {
                  type: "doc",
                  id: "interview-prep/ticketmaster",
                  label: "Design Ticketmaster",
                },
                {
                  type: "doc",
                  id: "interview-prep/ad-click-aggregator",
                  label: "Design an Ad Click Aggregator",
                },
              ],
            },
            {
              type: "category",
              label: "Infrastructure Scale",
              collapsed: true,
              items: [
                {
                  type: "doc",
                  id: "interview-prep/web-crawler",
                  label: "Design a Web Crawler",
                },
                {
                  type: "doc",
                  id: "interview-prep/dropbox",
                  label: "Design Dropbox",
                },
              ],
            },
          ],
        },
        {
          type: "category",
          label: "Part E — Low-Level Design",
          link: {
            type: "generated-index",
            title: "Low-Level Design",
            description:
              "Design below the box-and-arrow line: classes, responsibilities, and concurrency inside a single service. A separate interview round and a genuinely separate skill.",
            slug: "/low-level-design",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "low-level-design/what-is-low-level-design",
              label: "What Is Low-Level Design?",
            },
            {
              type: "doc",
              id: "low-level-design/solid-in-practice",
              label: "SOLID in Practice",
            },
            {
              type: "doc",
              id: "low-level-design/design-patterns",
              label: "Design Patterns Worth Knowing",
            },
            {
              type: "doc",
              id: "low-level-design/parking-lot",
              label: "Design a Parking Lot",
            },
            {
              type: "doc",
              id: "low-level-design/elevator",
              label: "Design an Elevator System",
            },
            {
              type: "doc",
              id: "low-level-design/lru-cache",
              label: "Design an LRU Cache",
            },
            {
              type: "doc",
              id: "low-level-design/movie-booking",
              label: "Design a Movie Booking System",
            },
          ],
        },
      ],
    },
  ],
};

export default sidebars;
