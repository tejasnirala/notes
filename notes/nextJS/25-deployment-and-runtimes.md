---
title: Deployment & Runtimes
author: Tejas Nirala
---

# Deployment & Runtimes

Where your Next.js app actually runs, what the two runtimes can and can't do, and how to deploy without a platform doing it for you.

---

## 1. The two runtimes

```jsx
export const runtime = 'nodejs';    // the default
export const runtime = 'edge';
```

| | Node.js | Edge |
| :-- | :-- | :-- |
| APIs | full Node standard library | Web APIs only |
| Cold start | ~250ms–1s | ~5ms |
| Location | a region you choose | close to the user, globally |
| Database drivers | ✅ all (TCP) | ⚠️ HTTP-based only |
| npm packages | ✅ nearly all | ⚠️ many fail |
| Memory / duration limits | higher | tight |
| Streaming | ✅ | ✅ |

```
✅ EDGE:  fetch, Web Crypto, URL, Headers, Request/Response, TextEncoder,
          ReadableStream, atob/btoa
❌ EDGE:  fs, path, child_process, net, Node's crypto, Buffer (partially),
          native modules, most ORMs and TCP database drivers
```

**When Edge wins:** middleware, geo-based redirects, A/B tests, simple personalisation, streaming AI responses, anything latency-sensitive with no database. Being 20ms from every user beats being 200ms from most of them.

**When Node wins:** essentially everything that touches a database, uses an ORM, processes files, or depends on a real npm ecosystem. Which is most application code.

**The default is right.** Choose Edge deliberately for a specific latency reason, not on the assumption that it's faster in general — an Edge function that makes a cross-region database call is slower than a Node function next to the database.

---

## 2. Deployment targets

### Vercel

```bash
vercel                          # preview deployment
vercel --prod
```

Zero config, and every Next.js feature works — ISR, on-demand revalidation, image optimisation, Edge middleware, streaming, PPR. It's built by the same team, so it's the reference implementation.

Trade-offs to be aware of: bandwidth and function-invocation pricing can rise sharply with traffic, and some capabilities (particularly around ISR and image optimisation) require extra work elsewhere.

### Self-hosting with Docker

```js
// next.config.mjs
export default { output: 'standalone' };     // emits a minimal self-contained server
```

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
```

`output: 'standalone'` traces exactly which files the server needs and copies them, producing an image of roughly 150 MB instead of 1 GB+. The multi-stage build keeps `node_modules` out of the final layer, and the non-root user is standard hardening.

Deploy that image anywhere: AWS ECS/Fargate, Google Cloud Run, Fly.io, Railway, Render, a plain VPS behind nginx.

### Other options

| | Notes |
| :-- | :-- |
| **Netlify / Cloudflare** | Good Next.js adapters; check ISR and image-optimisation parity for your version |
| **AWS via SST / OpenNext** | Full control, full complexity; OpenNext maps Next.js features onto Lambda + CloudFront |
| **Static export** | `output: 'export'` — a pure static site |

### Static export

```js
export default { output: 'export' };
```

```bash
npm run build       # emits out/ — deployable to any static host
```

You lose: SSR, ISR, Route Handlers, Middleware, Server Actions, `next/image` optimisation (unless you supply a custom loader), dynamic routes without `generateStaticParams`, cookies and headers.

Right for genuinely static sites — documentation, a blog, a marketing page — deployed to GitHub Pages, S3 or any CDN. Wrong for anything with a server-side concern.

---

## 3. Self-hosting: the parts you have to think about

Platforms handle these silently. Self-hosting means owning them.

### ISR across multiple instances

By default the ISR cache is on the local filesystem. With three containers behind a load balancer, each keeps its own copy — so a `revalidatePath` on instance 1 leaves instances 2 and 3 serving stale content.

```js
// next.config.mjs — a shared cache handler
export default {
  cacheHandler: require.resolve('./cache-handler.mjs'),
  cacheMaxMemorySize: 0,          // disable the in-memory cache; use the shared one
};
```

Back it with Redis (`@neshca/cache-handler` is a maintained implementation). This is the single most-missed self-hosting detail.

### Image optimisation

`next/image` optimises on the server, which costs CPU and memory. Options: install `sharp` (Next.js uses it automatically when present), put a CDN in front, or configure a custom loader pointing at an image CDN (Cloudinary, imgix, Cloudflare Images).

### Graceful shutdown, health checks, logs

```js
// a health endpoint for your load balancer
// app/api/health/route.ts
export async function GET() {
  return Response.json({ ok: true, ts: Date.now() });
}
```

Set `NODE_ENV=production`, run behind a reverse proxy that terminates TLS, and ship logs somewhere you can query.

---

## 4. Environment variables

```bash
# build time — inlined into the bundle, requires a rebuild to change
NEXT_PUBLIC_API_URL=https://api.example.com

# runtime — read on the server; changeable with a restart
DATABASE_URL=postgres://…
```

```dockerfile
# ⚠️ NEXT_PUBLIC_ values are baked in at BUILD time
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build
```

The consequence: you cannot build one image and deploy it to staging and production with different `NEXT_PUBLIC_` values — the build is environment-specific. Either build per environment, or fetch such configuration at runtime through a server-rendered value instead.

---

## 5. CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy
on: { push: { branches: [main] } }

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
        env:
          NEXT_PUBLIC_API_URL: ${{ vars.NEXT_PUBLIC_API_URL }}
      - name: Build and push image
        run: |
          docker build -t $IMAGE:${{ github.sha }} .
          docker push $IMAGE:${{ github.sha }}
```

Cache `.next/cache` between runs — it makes incremental builds dramatically faster:

```yaml
- uses: actions/cache@v4
  with:
    path: ${{ github.workspace }}/.next/cache
    key: ${{ runner.os }}-nextjs-${{ hashFiles('**/package-lock.json') }}-${{ hashFiles('**/*.js','**/*.tsx') }}
    restore-keys: ${{ runner.os }}-nextjs-${{ hashFiles('**/package-lock.json') }}-
```

---

## 6. Production checklist

```
□ NODE_ENV=production
□ Secrets in the platform's secret store, never in the repo
□ No NEXT_PUBLIC_ prefix on anything sensitive
□ Environment variables validated at build time (Zod)
□ Security headers set (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
□ Error monitoring wired up (Sentry or equivalent)
□ Web Vitals reported from real users
□ A health check endpoint
□ Database connection pooling configured for your concurrency model
□ Shared ISR cache if running more than one instance
□ sharp installed if self-hosting image optimisation
□ `next build` output reviewed — no route unexpectedly dynamic
□ Rollback plan (image tags, not "redeploy the previous commit and hope")
```

---

## 7. Regions and cold starts

```jsx
export const preferredRegion = 'iad1';       // put the function near the database
```

The rule: **compute should be near the data.** A serverless function in Europe querying a database in Virginia pays the round trip on every query, and a page with five sequential queries pays it five times. Co-locate first, then think about edge distribution.

Cold starts:

```
Edge:      ~5ms       — negligible
Node:      250ms–1s   — noticeable on a low-traffic app
Container: none once warm — this is a real advantage of self-hosting
```

Mitigations: keep the dependency graph small (a smaller bundle means a faster cold start), and for consistently low-latency requirements prefer always-on containers over serverless functions.

---

## 🧠 Rapid-fire recall

1. Compare the Node and Edge runtimes on APIs, cold start and database access.
2. When should you deliberately choose Edge, and when is it the wrong call?
3. What does `output: 'standalone'` do and why does it matter?
4. What breaks with `output: 'export'`?
5. What goes wrong with ISR when self-hosting multiple instances, and what's the fix?
6. Why can't one Docker image serve staging and production with different `NEXT_PUBLIC_` values?
7. What's the rule about compute and data location?

<details>
<summary>Answers</summary>

1. Node has the full standard library, cold starts of roughly 250ms–1s, and works with any database driver. Edge has Web APIs only, ~5ms cold starts, runs close to the user, and needs HTTP-based data access since TCP drivers and most ORMs don't run there.
2. Choose Edge for middleware, geo redirects, A/B tests and streaming responses with no database. It's the wrong call whenever you need an ORM, a TCP database connection, Node APIs, or when the data lives in one region anyway.
3. It traces exactly the files the server needs and emits a self-contained server, shrinking a Docker image from over a gigabyte to roughly 150 MB and removing the need to ship `node_modules`.
4. SSR, ISR, Route Handlers, Middleware, Server Actions, server-side image optimisation, cookies/headers, and dynamic routes without `generateStaticParams`.
5. Each instance keeps its own filesystem cache, so revalidating on one leaves the others serving stale content. Configure a shared `cacheHandler` backed by Redis.
6. `NEXT_PUBLIC_` variables are inlined into the client bundle at build time, so the built artifact is environment-specific. Build per environment, or deliver that configuration at runtime from the server.
7. Put compute next to the data. Cross-region database round trips are paid per query, so a page with several sequential queries multiplies the penalty — co-locate before distributing.

</details>
