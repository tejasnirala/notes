// @ts-check

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
  - create an ordered group of docs
  - render a sidebar for each doc of that group
  - provide next/previous navigation

  The sidebars can be generated from the filesystem, or explicitly defined here.

  Create as many sidebars as you want.

  @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */

const sidebars = {
  frontendSidebar: [
    {
      type: "category",
      label: "Frontend Engineering",
      link: {
        type: "doc",
        id: "frontend-index",
      },
      collapsed: true,
      items: [
        {
          type: "category",
          label: "Rendering Strategies",
          link: {
            type: "doc",
            id: "csr-ssr-isr-ssg/rendering-strategies-index",
          },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "csr-ssr-isr-ssg/csr",
              label: "Client-Side Rendering (CSR)",
            },
            {
              type: "doc",
              id: "csr-ssr-isr-ssg/ssr",
              label: "Server-Side Rendering (SSR)",
            },
            {
              type: "doc",
              id: "csr-ssr-isr-ssg/ssg",
              label: "Static Site Generation (SSG)",
            },
            {
              type: "doc",
              id: "csr-ssr-isr-ssg/isr",
              label: "Incremental Static Regeneration (ISR)",
            },
          ],
        },
        {
          type: "doc",
          id: "hydration",
          label: "Hydration",
        },
      ],
    },
  ],
};

export default sidebars;
