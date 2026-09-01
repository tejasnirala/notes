// @ts-check

/**
 * Docker sidebar — a learning path rather than a flat file list.
 *
 * Doc IDs omit the numeric filename prefix (Docusaurus strips `NN-`),
 * so `09-build-cache.md` has the id `build-cache`.
 *
 * @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */

const sidebars = {
  dockerSidebar: [
    {
      type: "category",
      label: "Docker",
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
              "What a container actually is at the operating-system level, what the daemon really delegates to, and what an image is on disk — manifest, config and content-addressed layer blobs.",
            slug: "/foundations",
          },
          collapsed: false,
          items: [
            { type: "doc", id: "docker-fundamentals", label: "Docker Fundamentals" },
            { type: "doc", id: "docker-architecture", label: "Docker Architecture" },
            { type: "doc", id: "images", label: "Docker Images" },
            { type: "doc", id: "image-layers", label: "Image Layers" },
          ],
        },
        {
          type: "category",
          label: "Building Images",
          link: {
            type: "generated-index",
            title: "Building Images",
            description:
              "Every Dockerfile instruction that matters, what `docker build .` really does, and the build context — the most misunderstood input to a Docker build.",
            slug: "/building-images",
          },
          collapsed: false,
          items: [
            { type: "doc", id: "dockerfile", label: "The Dockerfile" },
            { type: "doc", id: "docker-build", label: "Docker Build" },
            { type: "doc", id: "build-context", label: "Build Context" },
            { type: "doc", id: "dockerignore", label: ".dockerignore" },
          ],
        },
        {
          type: "category",
          label: "Caching",
          link: {
            type: "generated-index",
            title: "Caching",
            description:
              "Where build time actually goes: cache keys computed per instruction, the invalidation cascade, and the package-manager caches that quietly ship inside your image.",
            slug: "/caching",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "build-cache", label: "Build Cache" },
            { type: "doc", id: "cache-invalidation", label: "Cache Invalidation & Keys" },
            {
              type: "doc",
              id: "package-manager-caches",
              label: "Package Caches & Cleanup",
            },
          ],
        },
        {
          type: "category",
          label: "Designing the Image",
          link: {
            type: "generated-index",
            title: "Designing the Image",
            description:
              "Choosing a base on compatibility rather than megabytes, the glibc/musl trap, native dependencies, and how a discarded builder stage still hands its output forward.",
            slug: "/designing-the-image",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "base-images", label: "Base Image Selection" },
            { type: "doc", id: "multi-stage-builds", label: "Multi-Stage Builds" },
          ],
        },
        {
          type: "category",
          label: "Running Containers",
          link: {
            type: "generated-index",
            title: "Running Containers",
            description:
              "Configuration and secrets, dropping privilege, PID 1 and graceful shutdown, worker models against container limits, and what survives when a container is removed.",
            slug: "/running-containers",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "runtime-configuration", label: "Runtime Configuration" },
            { type: "doc", id: "secrets", label: "Secrets" },
            { type: "doc", id: "non-root-containers", label: "Non-Root Containers" },
            { type: "doc", id: "pid1-and-signals", label: "PID 1 & Signals" },
            { type: "doc", id: "dev-vs-prod", label: "Development vs Production" },
            {
              type: "doc",
              id: "workers-and-concurrency",
              label: "Workers & Concurrency",
            },
            {
              type: "doc",
              id: "runtime-filesystem-and-volumes",
              label: "Filesystem & Volumes",
            },
            { type: "doc", id: "networking", label: "Docker Networking" },
          ],
        },
        {
          type: "category",
          label: "Docker Compose",
          link: {
            type: "generated-index",
            title: "Docker Compose",
            description:
              "Declaring a whole application topology in one file: builds, service discovery, readiness gating, configuration, ports, volumes, and the lifecycle commands — including the one that destroys your data.",
            slug: "/docker-compose",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "compose-fundamentals", label: "Docker Compose" },
            {
              type: "doc",
              id: "compose-build-and-networking",
              label: "Build & Networking",
            },
            {
              type: "doc",
              id: "compose-depends-on-and-health",
              label: "depends_on & Health",
            },
            {
              type: "doc",
              id: "compose-config-ports-volumes",
              label: "Config, Ports & Volumes",
            },
            { type: "doc", id: "compose-lifecycle", label: "Lifecycle Commands" },
            { type: "doc", id: "compose-reference", label: "Compose Reference" },
            { type: "doc", id: "production-compose", label: "Production Compose" },
          ],
        },
        {
          type: "category",
          label: "Production",
          link: {
            type: "generated-index",
            title: "Production",
            description:
              "Working a fat image down methodically, annotated Dockerfile templates for interpreted and compiled applications, and diagnosing the five failures you will actually meet.",
            slug: "/production",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "image-optimization", label: "Image Optimization" },
            {
              type: "doc",
              id: "production-dockerfiles",
              label: "Production Dockerfiles",
            },
            { type: "doc", id: "debugging", label: "Debugging & Inspection" },
          ],
        },
        {
          type: "category",
          label: "Reference & Revision",
          link: {
            type: "generated-index",
            title: "Reference & Revision",
            description:
              "The claims worth correcting, the distinctions worth separating on demand, interview-ready definitions, and a question bank from beginner to advanced.",
            slug: "/reference",
          },
          collapsed: true,
          items: [
            { type: "doc", id: "misconceptions", label: "Common Misconceptions" },
            { type: "doc", id: "distinctions", label: "Conceptual Distinctions" },
            { type: "doc", id: "terminology", label: "Terminology" },
            { type: "doc", id: "interview-qa", label: "Interview Q&A" },
          ],
        },
        {
          type: "doc",
          id: "mental-model",
          label: "The Production Mental Model",
        },
      ],
    },
  ],
};

export default sidebars;
