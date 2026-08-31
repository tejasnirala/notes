// @ts-check

/**
 * PostgreSQL sidebar — a learning path rather than a flat file list.
 *
 * Doc IDs omit the numeric filename prefix (Docusaurus strips `NN-`),
 * so `07-window-functions.md` has the id `window-functions`.
 *
 * NOTE: every `category` MUST have a `link`. A category without one renders its
 * collapse arrow as a CSS pseudo-element inside `.menu__link`, which a rule in
 * src/css/custom.css sets to `display: block` — that breaks the arrow position
 * and inflates the row height. Categories with links are unaffected.
 *
 * @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */

const sidebars = {
  postgreSQLSidebar: [
    {
      type: "category",
      label: "PostgreSQL",
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
              "How PostgreSQL thinks: the process model and MVCC, the type system that sets it apart, the DDL and constraints everything else rests on, and the logical order in which SQL actually executes.",
            slug: "/foundations",
          },
          collapsed: false,
          items: [
            {
              type: "doc",
              id: "architecture-and-internals",
              label: "Architecture & Internals",
            },
            {
              type: "doc",
              id: "data-types",
              label: "Data Types",
            },
            {
              type: "doc",
              id: "ddl-and-constraints",
              label: "DDL, Constraints & Schemas",
            },
            {
              type: "doc",
              id: "sql-fundamentals",
              label: "SQL Fundamentals & CRUD",
            },
          ],
        },
        {
          type: "category",
          label: "Querying",
          link: {
            type: "generated-index",
            title: "Querying",
            description:
              "The row set traced clause by clause — joins that duplicate and drop, aggregation, window frames, recursive CTEs, and LATERAL.",
            slug: "/querying",
          },
          collapsed: false,
          items: [
            {
              type: "doc",
              id: "joins-and-set-operations",
              label: "Joins & Set Operations",
            },
            {
              type: "doc",
              id: "aggregation-and-grouping",
              label: "Aggregation & Grouping",
            },
            {
              type: "doc",
              id: "window-functions",
              label: "Window Functions",
            },
            {
              type: "doc",
              id: "ctes-and-recursive-queries",
              label: "CTEs & Recursive Queries",
            },
            {
              type: "doc",
              id: "subqueries-and-lateral",
              label: "Subqueries, LATERAL & EXISTS",
            },
          ],
        },
        {
          type: "category",
          label: "Advanced Data",
          link: {
            type: "generated-index",
            title: "Advanced Data",
            description:
              "The types MySQL doesn't have — JSONB with direct GIN indexing, arrays, ranges and exclusion constraints — plus full-text search and trigram matching.",
            slug: "/advanced-data",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "json-and-jsonb",
              label: "JSON & JSONB",
            },
            {
              type: "doc",
              id: "arrays-and-ranges",
              label: "Arrays, Ranges & Composite Types",
            },
            {
              type: "doc",
              id: "full-text-search",
              label: "Full-Text Search",
            },
          ],
        },
        {
          type: "category",
          label: "Performance",
          link: {
            type: "generated-index",
            title: "Performance",
            description:
              "Every index type and when each wins, reading EXPLAIN line by line, isolation and locking, partitioning, and the runbook for when something is on fire.",
            slug: "/performance",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "indexes",
              label: "Indexes",
            },
            {
              type: "doc",
              id: "explain-and-the-planner",
              label: "EXPLAIN & the Planner",
            },
            {
              type: "doc",
              id: "transactions-and-locking",
              label: "Transactions, Isolation & Locking",
            },
            {
              type: "doc",
              id: "partitioning",
              label: "Partitioning",
            },
            {
              type: "doc",
              id: "vacuum-and-performance",
              label: "VACUUM & Performance Playbook",
            },
          ],
        },
        {
          type: "category",
          label: "Programmability",
          link: {
            type: "generated-index",
            title: "Programmability",
            description:
              "Server-side code: functions and procedures, PL/pgSQL, volatility as a correctness decision, triggers, and the extension ecosystem.",
            slug: "/programmability",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "functions-and-plpgsql",
              label: "Functions, Procedures & PL/pgSQL",
            },
            {
              type: "doc",
              id: "triggers-and-extensions",
              label: "Triggers & Extensions",
            },
          ],
        },
        {
          type: "category",
          label: "Operations",
          link: {
            type: "generated-index",
            title: "Operations",
            description:
              "Roles, row-level security, streaming and logical replication, point-in-time recovery, major upgrades, and what to monitor.",
            slug: "/operations",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "roles-and-security",
              label: "Roles, Privileges & Security",
            },
            {
              type: "doc",
              id: "replication",
              label: "Replication & High Availability",
            },
            {
              type: "doc",
              id: "backup-and-operations",
              label: "Backup, PITR & Operations",
            },
          ],
        },
        {
          type: "doc",
          id: "postgresql-vs-mysql",
          label: "PostgreSQL vs MySQL",
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
              id: "beginner-queries",
              label: "Beginner (Q1–10)",
            },
            {
              type: "doc",
              id: "intermediate-queries",
              label: "Intermediate (Q11–22)",
            },
            {
              type: "doc",
              id: "advanced-queries",
              label: "Advanced (Q23–34)",
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
