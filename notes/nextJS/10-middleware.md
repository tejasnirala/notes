---
title: Middleware
author: Tejas Nirala
---

# Middleware

Code that runs **before** a request is handled — before the route renders, before a route handler executes, sometimes before the cache is even consulted. It's the right place for auth gates, redirects, A/B splits and header manipulation, and the wrong place for almost everything else.

---

## 1. The basics

```ts
// middleware.ts — at the project root, or src/ root. NOT inside app/.
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // do something, then choose one:
  return NextResponse.next();                                    // continue
  return NextResponse.redirect(new URL('/login', request.url));  // send elsewhere
  return NextResponse.rewrite(new URL('/maintenance', request.url)); // serve other content
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); // respond directly
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
```

Where it sits:

```
  request
     │
     ▼
┌─────────────┐   redirect / rewrite / respond ──▶ done
│ MIDDLEWARE  │
└──────┬──────┘   NextResponse.next()
       ▼
┌───────────────────────────────────────────────┐
│ routing → cache lookup → render / route handler│
└───────────────────────────────────────────────┘
```

---

## 2. The matcher

Middleware runs on **every** request by default — including static assets, which is wasteful and slow. Always constrain it.

```ts
export const config = {
  matcher: [
    /*
     * Match everything EXCEPT:
     *   _next/static, _next/image, favicon.ico, and common asset extensions
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

// or, explicitly — clearer and safer
export const config = {
  matcher: ['/dashboard/:path*', '/settings/:path*', '/api/protected/:path*'],
};
```

Matcher syntax:

```
'/about'                 exactly /about
'/blog/:slug'            one segment
'/blog/:path*'           zero or more segments
'/blog/:path+'           one or more segments
'/((?!api|_next).*)'     a negative-lookahead regex
```

The matcher must be **statically analysable** — it's read at build time, so it can't be a variable or computed.

Advanced matchers can also key on headers or cookies:

```ts
export const config = {
  matcher: [{
    source: '/api/:path*',
    has: [{ type: 'header', key: 'authorization' }],
    missing: [{ type: 'cookie', key: 'session' }],
  }],
};
```

---

## 3. What middleware is good at

### Auth gating

```ts
export async function middleware(request: NextRequest) {
  const token = request.cookies.get('session')?.value;

  if (!token) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', request.nextUrl.pathname);   // remember where they wanted to go
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/dashboard/:path*', '/settings/:path*'] };
```

⚠️ **Middleware auth is an optimisation, not a security boundary.** Check only for the *presence* of a token here; verify it properly in the page, the Server Action or the route handler that actually touches data. Reasons: middleware may be skipped by some deployment configurations, matcher mistakes silently leave routes open, and full verification (a DB lookup) is slow to do on every request. See [Authentication](./20-authentication.md).

### Rewrites: A/B tests, multi-tenancy, geo

```ts
export function middleware(request: NextRequest) {
  // A/B test — sticky per visitor
  let bucket = request.cookies.get('bucket')?.value;
  if (!bucket) bucket = Math.random() < 0.5 ? 'a' : 'b';

  const res = NextResponse.rewrite(new URL(`/home-${bucket}`, request.url));
  res.cookies.set('bucket', bucket, { maxAge: 60 * 60 * 24 * 30 });
  return res;      // the URL stays "/" for the user
}
```

```ts
// Multi-tenancy by subdomain: acme.app.com → /tenants/acme
export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const subdomain = host.split('.')[0];
  if (subdomain && subdomain !== 'www' && subdomain !== 'app') {
    return NextResponse.rewrite(new URL(`/tenants/${subdomain}${request.nextUrl.pathname}`, request.url));
  }
}
```

```ts
// Geo redirect
const country = request.headers.get('x-vercel-ip-country') ?? 'US';
if (country === 'DE' && !request.nextUrl.pathname.startsWith('/de')) {
  return NextResponse.redirect(new URL(`/de${request.nextUrl.pathname}`, request.url));
}
```

### Security headers

```ts
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `frame-ancestors 'none'`,
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);                        // pass it to the app

  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}
```

A nonce-based CSP has to be generated per request, which is exactly what middleware is for. Static headers belong in `next.config.js` instead — cheaper.

### Passing data downstream

```ts
const headers = new Headers(request.headers);
headers.set('x-user-id', userId);
return NextResponse.next({ request: { headers } });
```

```jsx
// in a Server Component
import { headers } from 'next/headers';
const userId = (await headers()).get('x-user-id');
```

Note this is *request* headers (visible to your app) rather than *response* headers (sent to the browser). Don't put anything sensitive in response headers.

---

## 4. The constraints

Middleware runs in the **Edge runtime** by default: a lightweight V8 environment, not Node.js.

```
❌ No Node APIs: fs, path, child_process, net, crypto (Node's version)
❌ No native modules
❌ Most database drivers won't work (pg, mysql2, mongodb use TCP sockets)
❌ Full ORMs (Prisma's default client) generally don't run here
✅ fetch, Web Crypto, URL, Headers, Request/Response, TextEncoder
✅ HTTP-based data access: Upstash Redis, PlanetScale's HTTP driver, Neon serverless
```

```ts
// ❌ won't run in middleware
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';          // uses Node crypto

// ✅ edge-compatible
import { jwtVerify } from 'jose';        // Web Crypto based
import { Redis } from '@upstash/redis';  // HTTP based
```

And the other constraints:

```
❌ No response body modification — you can't read or rewrite the HTML
❌ Size limit (~1–4 MB depending on the platform)
❌ Execution time limit (typically a few seconds)
⚠️  It runs on EVERY matched request — including prefetches
```

> Newer Next.js versions allow opting middleware into the Node.js runtime. If you can, prefer keeping middleware edge-light and doing heavy verification in the page or handler — the latency budget here is the whole point.

---

## 5. Performance: it's on the critical path

Every millisecond in middleware is added to **every matched request**, before anything else happens.

```
❌ BAD — a database round trip on every page view
export async function middleware(request) {
  const user = await db.user.findUnique(…);      // +80ms on EVERYTHING
}

✅ GOOD — a stateless local check
export function middleware(request) {
  const token = request.cookies.get('session')?.value;
  if (!token) return NextResponse.redirect(…);   // ~0ms
  return NextResponse.next();
}
```

Rules of thumb:

1. Narrow the matcher as much as possible.
2. Keep it synchronous where you can.
3. No database calls. If you must verify a JWT, use `jose` — signature verification is local and fast.
4. Do full authorisation in the page or handler, where you're already paying for a render.

---

## 6. Ordering and debugging

There is exactly **one** middleware file per project — no chaining. Compose it yourself:

```ts
type Handler = (req: NextRequest) => NextResponse | undefined;

const handlers: Handler[] = [maintenanceMode, geoRedirect, authGate, addSecurityHeaders];

export function middleware(request: NextRequest) {
  for (const handler of handlers) {
    const response = handler(request);
    if (response) return response;               // the first one to respond wins
  }
  return NextResponse.next();
}
```

Order matters: a maintenance-mode check should come before auth; security headers should be applied last so they're on whatever response you end up with.

```ts
// debugging: logs appear in the SERVER terminal, not the browser console
console.log('[mw]', request.method, request.nextUrl.pathname);
```

A checklist when it "doesn't run": is the file at the *root* (not in `app/`)? Does the matcher actually match? Is the matcher statically analysable? Did you restart the dev server after creating the file?

---

## 7. Common mistakes

```ts
// 1. Wrong location
app/middleware.ts             // ❌ never runs
middleware.ts (root)          // ✅

// 2. No matcher → runs on every asset request too
// 3. Node-only imports → runtime crash
// 4. Treating middleware as the security boundary
// 5. Redirect loops
if (!token) return NextResponse.redirect(new URL('/login', request.url));
// ❌ if /login is in the matcher, this redirects forever
// ✅ exclude it: matcher: ['/((?!login|register|api/auth).*)']

// 6. Relative URLs
NextResponse.redirect('/login');                       // ❌ throws
NextResponse.redirect(new URL('/login', request.url)); // ✅ absolute

// 7. Forgetting it runs on prefetches too — so it fires more often than you think
```

The redirect loop is the most common and the most alarming, because it takes the whole site down. Always exclude your auth pages from the matcher.

---

## 🧠 Rapid-fire recall

1. Where must `middleware.ts` live, and how many can a project have?
2. Why is a matcher effectively mandatory?
3. Why is middleware auth an optimisation rather than a security boundary?
4. Name four things you can't do in the Edge runtime.
5. Difference between `NextResponse.redirect` and `NextResponse.rewrite`?
6. How do you pass data from middleware to a Server Component?
7. What causes a middleware redirect loop, and how do you prevent it?

<details>
<summary>Answers</summary>

1. At the project root or the `src/` root — never inside `app/`. Exactly one per project; compose multiple concerns yourself inside it.
2. Without one it runs on every request including static assets and images, adding latency to everything and burning invocations for no benefit.
3. It may be skipped by some deployment configurations, a matcher mistake silently leaves routes unprotected, and it can only afford a cheap presence check. Real verification belongs in the page, action or handler that touches data.
4. Node APIs (`fs`, `path`, `child_process`, Node `crypto`), native modules, TCP-socket database drivers and most ORMs, and modifying the response body. Also size and execution-time limits.
5. `redirect` sends a 3xx and the browser's URL changes. `rewrite` keeps the URL and serves content from a different path — used for A/B tests, multi-tenancy and proxying.
6. Set a request header via `NextResponse.next({ request: { headers } })` and read it with `headers()` in the component.
7. Redirecting unauthenticated users to `/login` while `/login` itself is matched by the middleware. Exclude the auth routes from the matcher (or return early for them).

</details>
