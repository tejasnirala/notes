// @ts-check

/**
 * MongoDB sidebar — a learning path rather than a flat file list.
 *
 * Doc IDs omit the numeric filename prefix (Docusaurus strips `NN-`),
 * so `05-aggregation-fundamentals.md` has the id `aggregation-fundamentals`.
 *
 * @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */

const sidebars = {
  mongoDBSidebar: [
    {
      type: "category",
      label: "MongoDB",
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
              "How MongoDB thinks: the document model and BSON, how reads and writes actually execute, the schema decisions everything else depends on, and the indexes that make it fast.",
            slug: "/foundations",
          },
          collapsed: false,
          items: [
            {
              type: "doc",
              id: "document-model",
              label: "The Document Model & BSON",
            },
            {
              type: "doc",
              id: "crud-deep-dive",
              label: "CRUD Deep Dive",
            },
            {
              type: "doc",
              id: "data-modeling",
              label: "Data Modeling & Schema Design",
            },
            {
              type: "doc",
              id: "indexes-and-performance",
              label: "Indexes & Query Performance",
            },
          ],
        },
        {
          type: "category",
          label: "Aggregation",
          link: {
            type: "generated-index",
            title: "Aggregation",
            description:
              "The pipeline traced document by document — every core stage, the full stages reference, and every query and expression operator with a worked example.",
            slug: "/aggregation",
          },
          collapsed: false,
          items: [
            {
              type: "doc",
              id: "aggregation-fundamentals",
              label: "Aggregation Fundamentals",
            },
            {
              type: "doc",
              id: "aggregation-stages",
              label: "Stages Reference",
            },
            {
              type: "doc",
              id: "operators-reference",
              label: "Operators Reference",
            },
          ],
        },
        {
          type: "category",
          label: "Practice Questions",
          link: {
            type: "doc",
            id: "practice-questions",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "beginner-aggregation",
              label: "Beginner (Q1–8)",
            },
            {
              type: "doc",
              id: "intermediate-aggregation",
              label: "Intermediate (Q9–20)",
            },
            {
              type: "doc",
              id: "advanced-aggregation",
              label: "Advanced (Q21–32)",
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
              "Replica sets and elections, shard key selection, durability and transaction semantics, and the operational playbook for when something is on fire.",
            slug: "/scaling-and-production",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "replication",
              label: "Replication & Replica Sets",
            },
            {
              type: "doc",
              id: "sharding",
              label: "Sharding",
            },
            {
              type: "doc",
              id: "transactions-and-concerns",
              label: "Transactions & Concerns",
            },
            {
              type: "doc",
              id: "production-playbook",
              label: "Production Playbook",
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
