---
title: Next.js
author: Tejas Nirala
---

# Next.js

A complete path from *why does my React app show a blank page to Google* to *why did one `cookies()` call make my whole route dynamic* — written so that you finish understanding the engineering, not just the API.

**Who this is for:**

- **You know React and have never used a framework.** Start at page 1. Every feature is introduced as the answer to a specific problem you've hit building an SPA, so nothing arrives as arbitrary API surface.
- **You've shipped Next.js for a few years.** Start at Part 3. Server Components, the four caches and the client boundary are where most production Next.js apps are quietly wrong, and where the interesting engineering is.

**Prerequisite:** the [React section](/reactJS). This guide assumes hooks, reconciliation and Suspense, and links back rather than re-explaining them.

**How it's written:** the problem first, then the mechanism, then a traced example showing the state at each step, then the trap. Every page ends with **rapid-fire recall** questions and collapsible answers.

> **A note on versions.** Next.js changed several defaults between 14 and 15 — `fetch` went from cached to uncached, and `params`, `searchParams`, `cookies()` and `headers()` became asynchronous. Both are flagged wherever they matter. Check your `package.json` before trusting any Next.js example on the internet, including this one.

---

## 📚 The curriculum

### Part 1 — Foundations

*Why the framework exists, and how to choose what it renders.*

| | Page | What it answers |
| :-- | :--- | :--- |
| 1 | **[Why Next.js Exists](./01-why-nextjs.md)** | The five problems with a React SPA, the two-runtime mental model, and when *not* to use a framework |
| 2 | **[Rendering Strategies](./02-rendering-strategies.md)** | CSR/SSR/SSG/ISR/streaming/RSC on two axes, ISR traced, the decision tree |
| 3 | **[Project Structure & Configuration](./03-project-structure-and-config.md)** | Where files go, the reserved names, env vars, `next.config` |
| 4 | **[App Router vs Pages Router](./04-app-router-vs-pages-router.md)** | What actually differs, and which to use |

### Part 2 — Routing

| | Page | What it answers |
| :-- | :--- | :--- |
| 5 | **[Routing Fundamentals](./05-routing-fundamentals.md)** | Dynamic segments, catch-alls, route groups, `generateStaticParams`, `notFound`/`redirect` |
| 6 | **[Layouts & Special Files](./06-layouts-and-special-files.md)** | The seven reserved files, the rendering hierarchy, why layouts preserve state |
| 7 | **[Navigation & Linking](./07-navigation-and-linking.md)** | Prefetching, `router.refresh()`, search params as state, the Router Cache |
| 8 | **[Parallel & Intercepting Routes](./08-parallel-and-intercepting-routes.md)** | Independent panels, and modals with real shareable URLs |
| 9 | **[Route Handlers](./09-route-handlers.md)** | When you need an API and when you don't; webhooks, streaming, rate limiting |
| 10 | **[Middleware](./10-middleware.md)** | Auth gates, rewrites, CSP nonces, the Edge constraints, redirect loops |

### Part 3 — Server & Client Components

*The core of modern Next.js. If you read four pages, read these.*

| | Page | What it answers |
| :-- | :--- | :--- |
| 11 | **[React Server Components](./11-server-components.md)** | What crosses the wire, SSR vs RSC, the RSC payload, what you actually gain |
| 12 | **[Client Components & The Boundary](./12-client-components-and-the-boundary.md)** | `'use client'` is a module graph, not a component; pushing the boundary down |
| 13 | **[Composing Server & Client](./13-composition-server-and-client.md)** | The `children` hole, providers, passing promises, the errors you'll hit |
| 14 | **[Streaming & Suspense](./14-streaming-and-suspense.md)** | The wire mechanism, boundary placement, waterfalls, PPR |
| 15 | **[Hydration](./15-hydration.md)** | The hydration gap, every cause of a mismatch, the theme flash solved |

### Part 4 — Data

| | Page | What it answers |
| :-- | :--- | :--- |
| 16 | **[Data Fetching](./16-data-fetching.md)** | Colocation, deduplication, killing waterfalls, `server-only` |
| 17 | **[Caching](./17-caching.md)** | All four caches, what makes a route dynamic, invalidation recipes |
| 18 | **[Server Actions](./18-server-actions.md)** | How they work, the four security steps, optimistic updates |
| 19 | **[Forms & Mutations](./19-forms-and-mutations.md)** | Progressive enhancement, `useActionState`, validation, uploads, a11y |

### Part 5 — Production

| | Page | What it answers |
| :-- | :--- | :--- |
| 20 | **[Authentication & Authorization](./20-authentication.md)** | The four layers, and why the data access layer is the real boundary |
| 21 | **[Images, Fonts & Scripts](./21-images-fonts-and-scripts.md)** | `sizes`, `priority`, why `next/font` eliminates font CLS |
| 22 | **[Metadata & SEO](./22-metadata-and-seo.md)** | The Metadata API, OG image generation, JSON-LD, canonicals |
| 23 | **[Styling](./23-styling.md)** | Tailwind, CSS Modules, and why runtime CSS-in-JS fights RSC |
| 24 | **[Performance & Bundle Size](./24-performance-and-bundles.md)** | Reading the build output, a worked audit from 4.2s to 1.1s LCP |
| 25 | **[Deployment & Runtimes](./25-deployment-and-runtimes.md)** | Node vs Edge, Docker, and what self-hosting makes you own |
| 26 | **[Testing & Debugging](./26-testing-and-debugging.md)** | Testing actions and RSC, "where is this running?", monitoring |
| 27 | **[Internationalization](./27-internationalization.md)** | Locale routing, ICU plurals, hreflang, RTL |
| 28 | **[Security](./28-security.md)** | Boundary leaks, injection, XSS, CSP, SSRF, uploads |

### Part 6 — Migration & Interview

| | Page | What it answers |
| :-- | :--- | :--- |
| 29 | **[Migrating from Pages to App](./29-migrating-pages-to-app.md)** | Every API mapping, a staged plan, the bugs you'll hit |
| 30 | **[Interview Questions & Answers](./30-interview-qa.md)** | Forty questions by theme, plus system-design walkthroughs |

---

## 🗺️ Suggested paths

**New to Next.js (1–2 weeks):**
1 → 7 in order, building something small. Then 11 → 15 (the Server Component model), then 16 → 19 (data). Then whatever your project needs from Part 5.

**Shipping Next.js already (2–3 days):**
11, 12, 17 and 24. Server Components, the client boundary and the four caches are where most production apps are quietly wrong — usually a `'use client'` too high in the tree and a route that's dynamic without anyone noticing.

**Interview in three days:**
30 first to find your gaps, then 11, 02, 17 and 18. Those cover most of what senior Next.js interviews actually probe.

**Migrating an existing app:**
29, then 04, then 11 → 13.

---

## 🔍 Quick reference

| I want to… | Go to |
| :-- | :-- |
| Choose between SSG, SSR and ISR | [Rendering Strategies](./02-rendering-strategies.md) |
| Understand why my route became dynamic | [Caching](./17-caching.md) |
| Fix "hydration failed" | [Hydration](./15-hydration.md) |
| Shrink my JavaScript bundle | [Client Components](./12-client-components-and-the-boundary.md), [Performance](./24-performance-and-bundles.md) |
| Fix stale data after a mutation | [Caching](./17-caching.md), [Server Actions](./18-server-actions.md) |
| Build a form properly | [Forms & Mutations](./19-forms-and-mutations.md) |
| Secure an app | [Security](./28-security.md), [Authentication](./20-authentication.md) |
| Make a modal with a shareable URL | [Parallel & Intercepting Routes](./08-parallel-and-intercepting-routes.md) |
| Self-host without breaking ISR | [Deployment & Runtimes](./25-deployment-and-runtimes.md) |
| Get social previews working | [Metadata & SEO](./22-metadata-and-seo.md) |
