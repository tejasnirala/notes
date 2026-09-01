---
title: Project Structure & Configuration
author: Tejas Nirala
---

# Project Structure & Configuration

Where files go, what the special names mean, and the configuration you'll actually touch. Boring, but a project laid out badly stays painful for years.

---

## 1. The anatomy of a Next.js app

```
my-app/
├── src/
│   ├── app/                      ← the App Router. Routing lives HERE.
│   │   ├── layout.tsx            ← root layout (REQUIRED — renders <html> and <body>)
│   │   ├── page.tsx              ← the route "/"
│   │   ├── globals.css
│   │   ├── loading.tsx           ← streaming fallback for this segment
│   │   ├── error.tsx             ← error boundary for this segment
│   │   ├── not-found.tsx
│   │   ├── (marketing)/          ← route GROUP — not part of the URL
│   │   │   ├── about/page.tsx    ← /about
│   │   │   └── pricing/page.tsx  ← /pricing
│   │   ├── blog/
│   │   │   ├── page.tsx          ← /blog
│   │   │   └── [slug]/page.tsx   ← /blog/:slug
│   │   └── api/
│   │       └── posts/route.ts    ← the API endpoint /api/posts
│   │
│   ├── components/               ← shared components (NOT routable)
│   │   ├── ui/                   ← primitives: Button, Input, Dialog
│   │   └── features/             ← feature components
│   ├── lib/                      ← non-React code: db, api clients, utils
│   ├── hooks/                    ← shared custom hooks
│   ├── types/
│   └── styles/
│
├── public/                       ← served at the root: /logo.png
├── next.config.mjs
├── tsconfig.json
├── middleware.ts                 ← must sit at the src/ root (or project root)
└── package.json
```

The critical rule: **only files with reserved names create routes.** You can freely put `components/`, `utils.ts` and tests inside `app/` — a folder without a `page.tsx` or `route.ts` produces no URL. This is called *colocation*, and it's a genuine improvement over the Pages Router, where every file under `pages/` became a route.

```
app/dashboard/
├── page.tsx          ← /dashboard
├── layout.tsx
├── components/       ← NOT routable — colocated with the only route that uses it
│   └── Chart.tsx
├── actions.ts        ← colocated server actions
└── utils.ts
```

---

## 2. The reserved filenames

| File | Purpose |
| :-- | :-- |
| `layout.tsx` | Shared UI that wraps children; **preserves state across navigation** |
| `page.tsx` | Makes the segment publicly routable |
| `loading.tsx` | Automatic Suspense fallback for the segment |
| `error.tsx` | Error boundary (must be a Client Component) |
| `not-found.tsx` | UI for `notFound()` and unmatched URLs |
| `global-error.tsx` | Catches errors in the root layout itself |
| `template.tsx` | Like `layout`, but remounts on every navigation |
| `route.ts` | An API endpoint (cannot coexist with `page.tsx` in the same folder) |
| `default.tsx` | Fallback for parallel routes |
| `middleware.ts` | Runs before every matching request |
| `instrumentation.ts` | Server startup hooks (OpenTelemetry, etc.) |

All covered in [Layouts & Special Files](./06-layouts-and-special-files.md).

---

## 3. Structuring by feature, not by type

The `components/ui` + `components/features` split works to about 50 components. Past that, group by domain:

```
src/
├── app/                          ← routes only; thin, mostly composition
├── features/
│   ├── auth/
│   │   ├── components/
│   │   ├── actions.ts
│   │   ├── queries.ts
│   │   └── schema.ts
│   ├── billing/
│   └── posts/
│       ├── components/PostCard.tsx
│       ├── actions.ts            ← 'use server' mutations
│       ├── queries.ts            ← data access
│       └── schema.ts             ← Zod schemas shared by form + server
├── components/ui/                ← genuinely generic primitives only
└── lib/
```

Now a feature is one folder you can read, move or delete. The test: *if we removed billing tomorrow, how many folders would I touch?* One is the right answer.

---

## 4. Path aliases

```json
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

```jsx
import { Button } from '@/components/ui/button';       // ✅
import { Button } from '../../../components/ui/button'; // ❌
```

`create-next-app` sets this up. Add more aliases if it helps (`@/features/*`), but don't create ten — they become their own lookup problem.

---

## 5. Environment variables

```bash
# .env.local          — local secrets, gitignored (highest priority)
# .env.development    — development defaults
# .env.production     — production defaults
# .env                — shared defaults, committed

DATABASE_URL="postgresql://…"           # server only
STRIPE_SECRET_KEY="sk_live_…"           # server only
NEXT_PUBLIC_API_URL="https://api.x.com" # ⚠️ INLINED INTO THE CLIENT BUNDLE
```

**The rule that matters:** only `NEXT_PUBLIC_`-prefixed variables reach the browser. Everything else is available on the server only, and referencing it in a Client Component yields `undefined`.

```jsx
// Server Component / Route Handler / Server Action
const key = process.env.STRIPE_SECRET_KEY;         // ✅ works

// 'use client' component
const key = process.env.STRIPE_SECRET_KEY;         // ❌ undefined
const url = process.env.NEXT_PUBLIC_API_URL;       // ✅ works — but it's PUBLIC
```

`NEXT_PUBLIC_` values are **inlined at build time** — they end up as literal strings in your JavaScript. Never put a secret behind that prefix, and remember that changing one requires a rebuild, not just a restart.

### Validate them at startup

```ts
// src/lib/env.ts
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  STRIPE_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_API_URL: z.string().url(),
});

export const env = schema.parse(process.env);      // fails the BUILD, not production
```

A typo'd env var should break your build, not page 40 of your funnel at 2am.

---

## 6. `next.config.mjs` — the parts you'll use

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Remote images must be allow-listed (an SSRF guard)
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.example.com', pathname: '/uploads/**' },
    ],
    formats: ['image/avif', 'image/webp'],
  },

  async redirects() {
    return [
      { source: '/old-blog/:slug', destination: '/blog/:slug', permanent: true },
    ];
  },

  async rewrites() {
    // the URL stays /api/legacy/x; the request is proxied elsewhere
    return [{ source: '/api/legacy/:path*', destination: 'https://old.example.com/:path*' }];
  },

  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },

  output: 'standalone',            // a minimal self-contained build for Docker
  poweredByHeader: false,
  reactStrictMode: true,           // keep this on — see the React section
};

export default nextConfig;
```

**Redirect vs rewrite:** a redirect changes the URL in the browser (a 301/308); a rewrite keeps the URL and serves different content. Use redirects for moved pages, rewrites for proxying and for gradual migrations.

---

## 7. Where things run — a reference

| Location | Runs on | Can use |
| :-- | :-- | :-- |
| `app/**/page.tsx` (no `'use client'`) | server | `await`, db, secrets, `cookies()` |
| Component with `'use client'` | server (SSR) **and** client (hydration) | hooks, events, browser APIs |
| `app/**/route.ts` | server only | full request/response control |
| `middleware.ts` | Edge, before every matching request | cookies, headers, redirects, rewrites |
| `'use server'` functions | server only | db, secrets — callable from the client |
| `next.config.mjs` | build time (Node) | filesystem, env |

The most common beginner surprise: a `'use client'` component still **runs on the server once**, for the initial HTML. So `typeof window === 'undefined'` code paths matter even in client components ([Hydration](./15-hydration.md)).

---

## 8. TypeScript setup

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "moduleResolution": "bundler",
    "plugins": [{ "name": "next" }],       // Next's TS plugin: route/link type checking
    "paths": { "@/*": ["./src/*"] }
  }
}
```

```js
// next.config.mjs — statically typed hrefs
const nextConfig = { typedRoutes: true };
```

```tsx
<Link href="/blog/hello" />       // ✅ checked against your actual routes
<Link href="/blogg/hello" />      // ❌ compile error
```

Typed routes catch broken internal links at build time — cheap and genuinely useful once the app has more than a dozen pages.

---

## 9. Useful scripts

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "analyze": "ANALYZE=true next build"
  }
}
```

`next build` is also your architecture report — it prints, per route, whether it's static or dynamic and how much JavaScript it ships. Read it after every significant change; a route silently flipping from ○ to ƒ is a regression worth catching.

---

## 🧠 Rapid-fire recall

1. Which files inside `app/` create routes, and what does that enable?
2. What's the difference between a route group `(name)` and a normal folder?
3. What does the `NEXT_PUBLIC_` prefix do, and what's the trap?
4. Where must `middleware.ts` live?
5. Redirect vs rewrite?
6. Does a `'use client'` component ever run on the server?
7. What does `next build`'s route legend tell you, and why check it regularly?

<details>
<summary>Answers</summary>

1. Only reserved filenames — `page.tsx`, `route.ts`, `layout.tsx`, `loading.tsx`, `error.tsx` and the rest. Everything else is inert, which lets you colocate components, tests and utilities beside the route that uses them.
2. A route group's folder name is wrapped in parentheses and is omitted from the URL. It exists to organise files and to apply a shared layout to a set of routes without adding a path segment.
3. It marks a variable as safe to inline into the client bundle at build time. The trap is that it *is* inlined as a literal string — never put a secret behind it, and changing one requires a rebuild.
4. At the root of `src/` (or the project root if you're not using `src/`) — not inside `app/`.
5. A redirect sends a 301/308 and changes the URL in the browser. A rewrite keeps the URL and serves content from a different destination, which is what you want for proxying and gradual migrations.
6. Yes — once, during SSR, to produce the initial HTML. Only after hydration does it become browser-only, which is why `window`-dependent code needs guarding.
7. Whether each route is static (○), prerendered with `generateStaticParams` (●) or dynamic (ƒ), plus the JS shipped per route. A route unexpectedly flipping to dynamic usually means something like a `cookies()` call crept into a shared component.

</details>
