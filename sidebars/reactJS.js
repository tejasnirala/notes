// @ts-check

/**
 * React sidebar — a learning path rather than a flat file list.
 *
 * Doc IDs omit the numeric filename prefix (Docusaurus strips `NN-`),
 * so `19-useEffect.md` has the id `useEffect`.
 *
 * @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */

const sidebars = {
  reactJSSidebar: [
    {
      type: "category",
      label: "React",
      link: { type: "doc", id: "index" },
      collapsed: false,
      items: [
        {
          type: "category",
          label: "Prerequisites",
          link: {
            type: "generated-index",
            title: "Prerequisites",
            description:
              "The JavaScript and browser knowledge React is built on — how the DOM and the rendering pipeline actually work, the language features React code leans on, closures and reference identity (the source of almost every confusing hook bug), and the event loop.",
            slug: "/prerequisites",
          },
          collapsed: false,
          items: [
            { type: "doc", id: "dom-and-the-browser", label: "The DOM & The Browser" },
            { type: "doc", id: "javascript-you-need", label: "The JavaScript You Need" },
            { type: "doc", id: "closures-and-identity", label: "Closures & Reference Identity" },
            { type: "doc", id: "async-javascript-and-the-event-loop", label: "Async JS & The Event Loop" },
          ],
        },
        {
          type: "category",
          label: "Core React",
          link: {
            type: "generated-index",
            title: "Core React",
            description:
              "Everything you need to build real components: the problem React solves, what JSX compiles to, components and purity, state as a snapshot, events and forms, keys, conditional rendering and styling, and where state should live.",
            slug: "/core",
          },
          collapsed: false,
          items: [
            { type: "doc", id: "why-react-exists", label: "Why React Exists" },
            { type: "doc", id: "jsx-and-react-elements", label: "JSX & React Elements" },
            { type: "doc", id: "components-and-props", label: "Components & Props" },
            { type: "doc", id: "state-and-usestate", label: "State & useState" },
            { type: "doc", id: "events-and-forms", label: "Events & Forms" },
            { type: "doc", id: "lists-and-keys", label: "Lists & Keys" },
            { type: "doc", id: "conditional-rendering-and-styling", label: "Conditional Rendering & Styling" },
            { type: "doc", id: "lifting-state-and-data-flow", label: "Lifting State & Data Flow" },
          ],
        },
        {
          type: "category",
          label: "The Engine",
          link: {
            type: "generated-index",
            title: "The Engine",
            description:
              "How React actually works — the render and commit phases, the fiber architecture and double buffering, the O(n) diffing heuristics, lanes and the scheduler, concurrent rendering, and what StrictMode is really testing.",
            slug: "/engine",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "the-render-pipeline", label: "The Render Pipeline & Fiber" },
            { type: "doc", id: "reconciliation-and-diffing", label: "Reconciliation & Diffing" },
            { type: "doc", id: "batching-and-the-scheduler", label: "Batching, Lanes & The Scheduler" },
            { type: "doc", id: "concurrent-react", label: "Concurrent React" },
            { type: "doc", id: "strict-mode", label: "StrictMode" },
          ],
        },
        {
          type: "category",
          label: "Hooks",
          link: {
            type: "generated-index",
            title: "Hooks",
            description:
              "Starting from how hooks are actually stored on a fiber — which makes the Rules of Hooks obvious rather than memorised — then every built-in hook, how to write your own, and a catalogue of the bugs they cause.",
            slug: "/hooks",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "how-hooks-work-internally", label: "How Hooks Work Internally" },
            { type: "doc", id: "useEffect", label: "useEffect" },
            { type: "doc", id: "useLayoutEffect-and-effect-timing", label: "useLayoutEffect & Timing" },
            { type: "doc", id: "useRef", label: "useRef" },
            { type: "doc", id: "useMemo-and-useCallback", label: "useMemo & useCallback" },
            { type: "doc", id: "useReducer", label: "useReducer" },
            { type: "doc", id: "useContext", label: "useContext" },
            { type: "doc", id: "concurrent-hooks", label: "Transition & Action Hooks" },
            { type: "doc", id: "other-built-in-hooks", label: "The Remaining Hooks" },
            { type: "doc", id: "custom-hooks", label: "Custom Hooks" },
            { type: "doc", id: "hook-pitfalls", label: "Hook Pitfalls" },
          ],
        },
        {
          type: "category",
          label: "Patterns",
          link: {
            type: "generated-index",
            title: "Patterns",
            description:
              "Composition patterns used by real component libraries, error boundaries, portals and accessible modals, and Suspense with code splitting.",
            slug: "/patterns",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "composition-patterns", label: "Composition Patterns" },
            { type: "doc", id: "error-boundaries", label: "Error Boundaries" },
            { type: "doc", id: "portals-and-modals", label: "Portals, Modals & A11y" },
            { type: "doc", id: "suspense-and-code-splitting", label: "Suspense & Code Splitting" },
          ],
        },
        {
          type: "category",
          label: "Data & State Management",
          link: {
            type: "generated-index",
            title: "Data & State Management",
            description:
              "Server data is a cache, not state. From the naive fetch and its five bugs, through the five kinds of application state and how to choose a tool, to Redux Toolkit and TanStack Query in depth.",
            slug: "/data",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "data-fetching-patterns", label: "Data Fetching Patterns" },
            { type: "doc", id: "state-management-landscape", label: "The State Landscape" },
            { type: "doc", id: "redux-toolkit", label: "Redux Toolkit" },
            { type: "doc", id: "react-query", label: "TanStack Query" },
          ],
        },
        {
          type: "category",
          label: "Performance & Production",
          link: {
            type: "generated-index",
            title: "Performance & Production",
            description:
              "What actually causes re-renders and the structural fixes that beat memoisation, Core Web Vitals and bundle size, testing the way users use your app, and TypeScript patterns that make illegal states unrepresentable.",
            slug: "/production",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "what-causes-rerenders", label: "What Causes Re-renders" },
            { type: "doc", id: "performance-toolkit", label: "The Performance Toolkit" },
            { type: "doc", id: "testing-react", label: "Testing React" },
            { type: "doc", id: "typescript-with-react", label: "TypeScript with React" },
          ],
        },
        {
          type: "category",
          label: "Interview Prep",
          link: { type: "doc", id: "interview-qa" },
          collapsed: true,
          items: [
            { type: "doc", id: "interview-qa", label: "Questions & Answers" },
          ],
        },
      ],
    },
  ],
};

export default sidebars;
