// @ts-check

/**
 * Redis sidebar — a learning path rather than a flat file list.
 *
 * Doc IDs omit the numeric filename prefix (Docusaurus strips `NN-`),
 * so `09-sorted-sets.md` has the id `sorted-sets`.
 *
 * @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */

const sidebars = {
  redisSidebar: [
    {
      type: "category",
      label: "Redis",
      link: {
        type: "doc",
        id: "index",
      },
      collapsed: false,
      items: [
        {
          type: "category",
          label: "Foundations",
          link: {
            type: "generated-index",
            title: "Foundations",
            description:
              "The mental model: what an in-memory data structure server actually is, a SET traced from keystroke to RAM, how the keyspace and TTLs work, and the wire protocol underneath it all.",
            slug: "/foundations",
          },
          collapsed: false,
          items: [
            { type: "doc", id: "what-is-redis", label: "What Is Redis?" },
            {
              type: "doc",
              id: "installation-and-first-commands",
              label: "Installation & First Commands",
            },
            { type: "doc", id: "keys-and-the-keyspace", label: "Keys & The Keyspace" },
            { type: "doc", id: "protocol-resp", label: "RESP — The Wire Protocol" },
          ],
        },
        {
          type: "category",
          label: "Data Types",
          link: {
            type: "generated-index",
            title: "Data Types",
            description:
              "Every type, with its commands, its production patterns, and the internal encodings that decide how much memory it costs and how fast it is.",
            slug: "/data-types",
          },
          collapsed: false,
          items: [
            { type: "doc", id: "strings", label: "Strings" },
            { type: "doc", id: "lists", label: "Lists" },
            { type: "doc", id: "hashes", label: "Hashes" },
            { type: "doc", id: "sets", label: "Sets" },
            { type: "doc", id: "sorted-sets", label: "Sorted Sets" },
            {
              type: "doc",
              id: "bitmaps-hyperloglog-geo",
              label: "Bitmaps, HyperLogLog & Geo",
            },
            { type: "doc", id: "streams", label: "Streams" },
            { type: "doc", id: "pubsub", label: "Pub/Sub" },
          ],
        },
        {
          type: "category",
          label: "Internals",
          link: {
            type: "generated-index",
            title: "Internals",
            description:
              "How Redis actually works: the redisObject and the dict, incremental rehashing, the event loop, the probabilistic expiry sweep, and fork-based persistence.",
            slug: "/internals",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "internals-memory-and-encodings",
              label: "Memory & Encodings",
            },
            {
              type: "doc",
              id: "single-threaded-event-loop",
              label: "The Event Loop",
            },
            {
              type: "doc",
              id: "expiration-and-eviction",
              label: "Expiration & Eviction",
            },
            { type: "doc", id: "persistence", label: "Persistence" },
          ],
        },
        {
          type: "category",
          label: "Using It Well",
          link: {
            type: "generated-index",
            title: "Using It Well",
            description:
              "Transactions and Lua, why the network is your real bottleneck, and the client configuration that survives a failover.",
            slug: "/using-it-well",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "transactions-and-scripting",
              label: "Transactions & Scripting",
            },
            {
              type: "doc",
              id: "pipelining-and-performance",
              label: "Pipelining & Performance",
            },
            {
              type: "doc",
              id: "clients-and-connection-management",
              label: "Clients & Connections",
            },
          ],
        },
        {
          type: "category",
          label: "Scaling & Production",
          link: {
            type: "generated-index",
            title: "Scaling & Production",
            description:
              "Replication and what it does not guarantee, Sentinel failover second by second, Cluster and its 16,384 slots, ACLs and TLS, and the operational runbooks.",
            slug: "/scaling-and-production",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "replication", label: "Replication" },
            {
              type: "doc",
              id: "sentinel-and-failover",
              label: "Sentinel & Failover",
            },
            { type: "doc", id: "cluster", label: "Redis Cluster" },
            { type: "doc", id: "security", label: "Security" },
            {
              type: "doc",
              id: "observability-and-ops",
              label: "Observability & Ops",
            },
          ],
        },
        {
          type: "category",
          label: "Patterns",
          link: {
            type: "generated-index",
            title: "Patterns",
            description:
              "The things people actually build with Redis — caches, locks, rate limiters, and job queues — each with its failure modes and the fix, then all of it wired into a real Express service.",
            slug: "/patterns",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "caching-patterns", label: "Caching Patterns" },
            { type: "doc", id: "distributed-locks", label: "Distributed Locks" },
            { type: "doc", id: "rate-limiting", label: "Rate Limiting" },
            { type: "doc", id: "queues-and-jobs", label: "Queues & Jobs" },
            {
              type: "doc",
              id: "antipatterns-and-production-playbook",
              label: "Anti-Patterns & Playbook",
            },
            {
              type: "doc",
              id: "redis-with-express",
              label: "Redis in an Express App",
            },
          ],
        },
        {
          type: "doc",
          id: "interview-qa",
          label: "Interview Q&A",
        },
      ],
    },
  ],
};

export default sidebars;
