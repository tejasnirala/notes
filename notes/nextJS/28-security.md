---
title: Security
author: Tejas Nirala
---

# Security

Next.js gives you a server, and a server is an attack surface. This page covers the vulnerabilities that actually appear in Next.js applications, in roughly the order they show up in real audits.

---

## 1. The server/client boundary is a security boundary

```jsx
// ❌ this key ends up in the JavaScript bundle, readable by anyone
'use client';
const key = process.env.NEXT_PUBLIC_STRIPE_SECRET;
```

```
NEXT_PUBLIC_*  →  inlined into the client bundle at BUILD time. PUBLIC. Forever.
everything else →  server only
```

Anything with that prefix is published. Rotate immediately if a secret ever carried it — it's in every built artifact and every browser cache that ever loaded the page.

```ts
// lib/db.ts — turn accidental exposure into a build error
import 'server-only';
export const db = new PrismaClient();
```

Now importing this from a Client Component fails the build instead of silently bundling your database client.

### Data leaking through props

```jsx
// ❌ the ENTIRE user object is serialised into the RSC payload — visible in the page source
export default async function Page() {
  const user = await db.user.findUnique({ where: { id } });   // includes passwordHash, tokens…
  return <Profile user={user} />;                              // ← a client component
}

// ✅ select only what the UI needs
const user = await db.user.findUnique({
  where: { id },
  select: { id: true, name: true, avatarUrl: true },
});
```

Everything passed to a Client Component is embedded in the HTML/RSC payload. "The UI doesn't display it" is irrelevant — view-source does.

React's experimental **taint APIs** can enforce this:

```ts
import { experimental_taintObjectReference as taint } from 'react';
taint('Do not pass the full user object to the client', user);
```

---

## 2. Server Actions are public endpoints

Covered in [Server Actions](./18-server-actions.md), and repeated here because it's the most consequential Next.js-specific vulnerability.

```jsx
// ❌ anyone can POST to this with any id
'use server';
export async function deletePost(id) { await db.post.delete({ where: { id } }); }
```

```jsx
// ✅
'use server';
export async function deletePost(id) {
  const user = await requireUser();                                    // authenticate
  const { id: safe } = z.object({ id: z.string().uuid() }).parse({ id }); // validate
  const post = await db.post.findUnique({ where: { id: safe } });
  if (post?.authorId !== user.id) throw new Error('Forbidden');        // authorize
  await db.post.delete({ where: { id: safe } });
  revalidatePath('/posts');
}
```

Remember: **every export in a `'use server'` file is a live endpoint**, including ones no UI calls any more.

---

## 3. Injection

### SQL

```ts
// ❌
await db.$queryRawUnsafe(`SELECT * FROM users WHERE email = '${email}'`);
// email = "' OR '1'='1" → returns every user

// ✅ parameterised
await db.$queryRaw`SELECT * FROM users WHERE email = ${email}`;
// ✅ or just use the query builder
await db.user.findUnique({ where: { email } });
```

### NoSQL

```ts
// ❌ a JSON body of {"email": {"$ne": null}} matches any user
await User.findOne({ email: req.body.email });

// ✅ validate the shape and coerce the type
const { email } = z.object({ email: z.string().email() }).parse(body);
```

### Command injection

```ts
exec(`convert ${filename} out.png`);                    // ❌
execFile('convert', [filename, 'out.png']);             // ✅ no shell interpolation
```

The general rule: **never build a query or a command by string concatenation with user input.**

---

## 4. XSS

React escapes interpolated content by default, which removes most of the risk. The exceptions:

```jsx
// ❌ raw HTML from a user or a CMS
<div dangerouslySetInnerHTML={{ __html: userContent }} />

// ✅ sanitise first
import DOMPurify from 'isomorphic-dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }} />
```

```jsx
// ❌ javascript: URLs
<a href={userProvidedUrl}>Link</a>              // href="javascript:alert(1)"

// ✅ validate the protocol
const safe = /^https?:\/\//.test(url) ? url : '#';
```

```jsx
// ❌ injecting user data into an inline script
<script dangerouslySetInnerHTML={{ __html: `var d = ${JSON.stringify(userData)}` }} />
// JSON.stringify does NOT escape </script> — an attacker can break out of the tag
```

### CSP

```ts
// middleware.ts — a nonce-based policy, generated per request
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}
```

A working CSP is genuine defence in depth: even if an XSS gets in, the injected script can't execute without the nonce.

---

## 5. Security headers

```js
// next.config.mjs — for the static ones
async headers() {
  return [{
    source: '/(.*)',
    headers: [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ],
  }];
}
```

| Header | Prevents |
| :-- | :-- |
| `Strict-Transport-Security` | Protocol downgrade / SSL stripping |
| `X-Frame-Options: DENY` | Clickjacking (also `frame-ancestors` in CSP) |
| `X-Content-Type-Options: nosniff` | MIME sniffing turning an upload into a script |
| `Referrer-Policy` | Leaking URLs (with tokens in them) to third parties |
| `Permissions-Policy` | Unwanted access to camera, mic, location |

---

## 6. Authentication and session security

Covered in [Authentication](./20-authentication.md); the security essentials:

```
□ Session cookies: httpOnly, secure, sameSite='lax'
□ Never store tokens in localStorage (any XSS steals every session)
□ Passwords hashed with bcrypt or argon2 — never SHA-256, never unsalted
□ Rate-limit login, registration, password reset and anything that sends email
□ Identical error messages for "no such user" and "wrong password"
□ Rotate the session on login and on privilege change
□ Server-side session invalidation on logout
□ Short-lived tokens; refresh tokens revocable
```

---

## 7. SSRF and open redirects

```ts
// ❌ your server will fetch anything, including internal addresses
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')!;
  return Response.json(await (await fetch(url)).json());
  // ?url=http://169.254.169.254/latest/meta-data/  → cloud instance credentials
}

// ✅ allow-list
const ALLOWED = new Set(['api.trusted.com', 'cdn.trusted.com']);
const parsed = new URL(url);
if (!ALLOWED.has(parsed.hostname) || parsed.protocol !== 'https:') {
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}
```

This is exactly why `next/image` requires `remotePatterns` — an unrestricted image optimiser is an SSRF proxy.

```ts
// ❌ open redirect — used in phishing to lend your domain's credibility
redirect(searchParams.next);

// ✅ relative paths only
const next = searchParams.next;
redirect(next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
```

The `//` check matters: `//evil.com` is a protocol-relative URL and navigates off-site.

---

## 8. File uploads

```ts
'use server';
export async function upload(formData: FormData) {
  const file = formData.get('file') as File;

  if (file.size > 5 * 1024 * 1024) throw new Error('Too large');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Invalid type');
  }

  const key = `uploads/${crypto.randomUUID()}`;      // never trust file.name
  await storage.put(key, Buffer.from(await file.arrayBuffer()));
}
```

Four rules:

1. **Never use the client-supplied filename** — `../../etc/passwd` is a path traversal, and `evil.php` may be executed by some hosts.
2. **`file.type` is client-controlled.** Verify the actual content (magic bytes) for anything served back to users.
3. **Serve uploads from a different origin** (a storage bucket or a CDN subdomain), so a malicious file can't run in your app's origin.
4. **Cap the size**, and prefer presigned direct-to-storage uploads for large files.

---

## 9. Rate limiting and abuse

```ts
import { Ratelimit } from '@upstash/ratelimit';
const ratelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '60 s') });

const { success } = await ratelimit.limit(ip);
if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
```

Rate-limit anything that: authenticates, sends email or SMS, costs money per call (LLM APIs, third-party services), or performs an expensive query. In-memory counters don't work on serverless — use a shared store.

---

## 10. Dependencies and disclosure

```bash
npm audit
npx depcheck                    # unused dependencies are still attack surface
```

Enable Dependabot or Renovate. Most real-world compromises of JavaScript applications come through the dependency tree, not through code someone wrote.

```
□ Don't commit .env files (check .gitignore, and check git history)
□ Rotate any secret that has ever been committed — history is forever
□ Turn off poweredByHeader (it advertises the framework and version)
□ Don't return stack traces or internal error messages to clients
□ Verify webhook signatures
□ Keep Next.js itself current — security fixes ship in patch releases
```

---

## 11. Audit checklist

```
□ No secrets behind NEXT_PUBLIC_
□ import 'server-only' on every data-access module
□ Every Server Action: authenticate → validate → authorize
□ Every Route Handler: the same
□ Queries scoped by user, not filtered afterwards
□ No string-concatenated SQL or shell commands
□ dangerouslySetInnerHTML sanitised with DOMPurify
□ CSP with a per-request nonce
□ Security headers set
□ Session cookies httpOnly/secure/sameSite
□ Rate limiting on auth and anything costly
□ Redirect targets validated (relative paths only)
□ Outbound fetch destinations allow-listed
□ Uploads: size capped, type verified, renamed, served from another origin
□ Only necessary fields selected and passed to Client Components
□ Dependencies audited and updated
```

---

## 🧠 Rapid-fire recall

1. What happens to a secret accidentally given the `NEXT_PUBLIC_` prefix?
2. Why is passing a whole database record to a Client Component dangerous even if you don't render the sensitive fields?
3. Why is every export in a `'use server'` file a security concern?
4. Name three injection classes and the general rule that prevents all of them.
5. Why does `next/image` require `remotePatterns`?
6. What's wrong with `redirect(searchParams.next)`, and what's the correct check?
7. Give four rules for handling file uploads.

<details>
<summary>Answers</summary>

1. It's inlined into the client bundle at build time — published permanently in every built artifact and in browser caches. It must be rotated, not just renamed.
2. Everything passed across the boundary is serialised into the RSC payload embedded in the page, so it's visible in view-source regardless of what the UI displays. Select only the fields the UI needs.
3. Each one becomes a callable public HTTP endpoint. Anyone can POST arbitrary arguments to it, including to exports whose UI was deleted long ago.
4. SQL injection, NoSQL operator injection, and command injection. The rule: never build a query or a command by concatenating user input — use parameterised queries, validated/coerced input, and argument arrays rather than shell strings.
5. An unrestricted optimiser will fetch any URL on your server's behalf — an SSRF vector reaching internal services and cloud metadata endpoints, plus a way for others to consume your bandwidth.
6. It's an open redirect usable for phishing under your domain. Accept only paths starting with a single `/` — and explicitly reject `//`, which is protocol-relative and navigates off-site.
7. Cap the size; verify the real content type rather than trusting `file.type`; never use the client-supplied filename (generate one); and serve uploads from a different origin.

</details>
