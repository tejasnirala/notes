// @ts-check

/**
 * Next.js sidebar — a learning path rather than a flat file list.
 *
 * Doc IDs omit the numeric filename prefix (Docusaurus strips `NN-`),
 * so `17-caching.md` has the id `caching`.
 *
 * @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */

const sidebars = {
  nextJSSidebar: [
    {
      type: "category",
      label: "Next.js",
      link: { type: "doc", id: "index" },
      collapsed: false,
      items: [
        {
          type: "category",
          label: "Foundations",
          link: {
            type: "generated-index",
            title: "Foundations",
            description:
              "Why the framework exists at all — the five problems a React SPA runs into — then the rendering strategies on two axes, how a project is laid out, and how the App Router differs from the Pages Router.",
            slug: "/foundations",
          },
          collapsed: false,
          items: [
            { type: "doc", id: "why-nextjs", label: "Why Next.js Exists" },
            { type: "doc", id: "rendering-strategies", label: "Rendering Strategies" },
            { type: "doc", id: "project-structure-and-config", label: "Project Structure & Config" },
            { type: "doc", id: "app-router-vs-pages-router", label: "App Router vs Pages Router" },
          ],
        },
        {
          type: "category",
          label: "Routing",
          link: {
            type: "generated-index",
            title: "Routing",
            description:
              "File-system routes and dynamic segments, the seven reserved filenames and the rendering hierarchy they build, navigation and prefetching, parallel and intercepting routes, API endpoints, and middleware.",
            slug: "/routing",
          },
          collapsed: false,
          items: [
            { type: "doc", id: "routing-fundamentals", label: "Routing Fundamentals" },
            { type: "doc", id: "layouts-and-special-files", label: "Layouts & Special Files" },
            { type: "doc", id: "navigation-and-linking", label: "Navigation & Linking" },
            { type: "doc", id: "parallel-and-intercepting-routes", label: "Parallel & Intercepting Routes" },
            { type: "doc", id: "route-handlers", label: "Route Handlers" },
            { type: "doc", id: "middleware", label: "Middleware" },
          ],
        },
        {
          type: "category",
          label: "Server & Client Components",
          link: {
            type: "generated-index",
            title: "Server & Client Components",
            description:
              "The core of modern Next.js. What actually crosses the wire, why 'use client' marks a module graph rather than a component, how to compose the two, how streaming works over the wire, and every cause of a hydration mismatch.",
            slug: "/components",
          },
          collapsed: false,
          items: [
            { type: "doc", id: "server-components", label: "React Server Components" },
            { type: "doc", id: "client-components-and-the-boundary", label: "Client Components & The Boundary" },
            { type: "doc", id: "composition-server-and-client", label: "Composing Server & Client" },
            { type: "doc", id: "streaming-and-suspense", label: "Streaming & Suspense" },
            { type: "doc", id: "hydration", label: "Hydration" },
          ],
        },
        {
          type: "category",
          label: "Data",
          link: {
            type: "generated-index",
            title: "Data",
            description:
              "Fetching with await, request deduplication and killing waterfalls; all four caches and what makes a route dynamic; Server Actions and the four security steps every one of them needs; and forms that work before JavaScript loads.",
            slug: "/data",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "data-fetching", label: "Data Fetching" },
            { type: "doc", id: "caching", label: "Caching" },
            { type: "doc", id: "server-actions", label: "Server Actions" },
            { type: "doc", id: "forms-and-mutations", label: "Forms & Mutations" },
          ],
        },
        {
          type: "category",
          label: "Production",
          link: {
            type: "generated-index",
            title: "Production",
            description:
              "Everything between a working app and a shippable one: layered auth, asset optimisation, SEO, styling under RSC, a worked performance audit, deployment and runtimes, testing and debugging, i18n, and security.",
            slug: "/production",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "authentication", label: "Authentication & Authorization" },
            { type: "doc", id: "images-fonts-and-scripts", label: "Images, Fonts & Scripts" },
            { type: "doc", id: "metadata-and-seo", label: "Metadata & SEO" },
            { type: "doc", id: "styling", label: "Styling" },
            { type: "doc", id: "performance-and-bundles", label: "Performance & Bundle Size" },
            { type: "doc", id: "deployment-and-runtimes", label: "Deployment & Runtimes" },
            { type: "doc", id: "testing-and-debugging", label: "Testing & Debugging" },
            { type: "doc", id: "internationalization", label: "Internationalization" },
            { type: "doc", id: "security", label: "Security" },
          ],
        },
        {
          type: "category",
          label: "Migration & Interview",
          link: {
            type: "generated-index",
            title: "Migration & Interview",
            description:
              "Every Pages-to-App API mapping with a staged plan, and forty interview questions answered the way you'd say them out loud.",
            slug: "/migration-and-interview",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "migrating-pages-to-app", label: "Migrating Pages → App" },
            { type: "doc", id: "interview-qa", label: "Interview Q&A" },
          ],
        },
      ],
    },
  ],
};

export default sidebars;
