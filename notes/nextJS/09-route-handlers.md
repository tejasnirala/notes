---
title: Route Handlers (API Routes)
author: Tejas Nirala
---

# Route Handlers (API Routes)

`route.ts` files create HTTP endpoints using the Web `Request`/`Response` standard. In an App Router app you need them less than you'd expect — Server Components fetch data directly and Server Actions handle mutations — but they remain essential for webhooks, third-party clients and anything non-HTML.

---

## 1. The basics

```ts
// app/api/posts/route.ts  →  /api/posts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const posts = await db.post.findMany();
  return NextResponse.json(posts);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const post = await db.post.create({ data: body });
  return NextResponse.json(post, { status: 201 });
}

export async function PUT(request: NextRequest) { … }
export async function PATCH(request: NextRequest) { … }
export async function DELETE(request: NextRequest) { … }
```

Rules:

- One `route.ts` per folder, and it **cannot coexist with `page.tsx`** in the same folder.
- Export a named function per HTTP method. Anything not exported returns 405.
- `NextRequest`/`NextResponse` extend the standard `Request`/`Response` — you can return a plain `Response` too.

---

## 2. Reading the request

```ts
export async function POST(request: NextRequest) {
  // Body
  const json = await request.json();
  const text = await request.text();
  const form = await request.formData();

  // Query string
  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get('page') ?? 1);
  // or: request.nextUrl.searchParams.get('page')

  // Headers & cookies
  const auth = request.headers.get('authorization');
  const token = request.cookies.get('session')?.value;

  // Metadata
  request.method;
  request.nextUrl.pathname;
  request.ip;                          // where the platform provides it
}
```

⚠️ The body is a **stream and can only be read once**. Calling `request.json()` after `request.text()` throws. Clone if you truly need both: `request.clone().text()`.

### Dynamic segments

```ts
// app/api/posts/[id]/route.ts
export async function GET(request: NextRequest, { params }) {
  const { id } = await params;                      // ⚠️ Next 15: params is a Promise
  const post = await db.post.findUnique({ where: { id } });
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(post);
}
```

---

## 3. Responses

```ts
NextResponse.json({ ok: true });
NextResponse.json({ error: 'Bad request' }, { status: 400 });

// headers & cookies
const res = NextResponse.json(data);
res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
res.cookies.set('session', token, {
  httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
});
return res;

// redirects
return NextResponse.redirect(new URL('/login', request.url));

// non-JSON
return new Response(csv, { headers: { 'Content-Type': 'text/csv' } });
return new Response(null, { status: 204 });
```

### Streaming

```ts
export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of llm.stream(prompt)) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

This is how LLM token streaming and server-sent events are implemented.

---

## 4. Validation — always

Never trust a request body.

```ts
import { z } from 'zod';

const CreatePost = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  tags: z.array(z.string()).max(5).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = CreatePost.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const post = await db.post.create({ data: parsed.data });   // parsed.data is typed ✅
  return NextResponse.json(post, { status: 201 });
}
```

`safeParse` returns a result instead of throwing, which keeps the error path explicit.

---

## 5. Caching

```ts
// Route handlers are UNCACHED by default (Next 15; GET was cached by default in 14)
export const dynamic = 'force-static';        // opt into caching
export const revalidate = 3600;               // ISR for a route handler

// Per-response control
res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
```

A handler that reads `cookies()`, `headers()` or the request object is always dynamic — it can't be cached, because the response depends on the request.

---

## 6. When to use a route handler, and when not to

```
✅ USE for:
   • Webhooks (Stripe, GitHub, Clerk) — external systems POSTing to you
   • Public APIs consumed by mobile apps or third parties
   • File uploads and downloads
   • Streaming responses (SSE, LLM tokens)
   • OAuth callbacks
   • Non-HTML output: sitemap.xml, RSS, robots.txt, OG images, CSV exports
   • Anything needing precise control over status codes and headers

❌ DON'T USE for:
   • Fetching data for your own Server Components  → just await it directly
   • Mutations from your own forms                 → Server Actions
```

That second list is the important one. Coming from the Pages Router, the reflex is to build `/api/posts` and fetch it from the page. In the App Router that adds a pointless HTTP round trip to your own server:

```jsx
// ❌ the server calls itself over the network
export default async function Page() {
  const res = await fetch('http://localhost:3000/api/posts');
  const posts = await res.json();
}

// ✅ just query
export default async function Page() {
  const posts = await db.post.findMany();
}
```

The second version is faster, simpler, fully typed end to end, and has one fewer thing to secure.

---

## 7. Webhooks — the pattern

Webhooks are the clearest case for a route handler, and signature verification is not optional.

```ts
// app/api/webhooks/stripe/route.ts
import Stripe from 'stripe';
import { headers } from 'next/headers';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const body = await request.text();                    // RAW body — required for the signature
  const signature = (await headers()).get('stripe-signature')!;

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await fulfilOrder(event.data.object);
      break;
  }

  return NextResponse.json({ received: true });         // ACK fast — providers retry on timeout
}
```

Four things that bite people:

1. **Use `request.text()`, not `.json()`** — signature verification needs the exact raw bytes.
2. **Verify the signature.** Without it, anyone can POST fake events to your endpoint.
3. **Return 200 quickly.** Providers retry on timeout; do slow work in a queue.
4. **Be idempotent.** Retries mean the same event will arrive twice. Key on the event id.

---

## 8. CORS

```ts
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://trusted.example.com',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
```

You only need CORS for **cross-origin** callers. Your own frontend on the same domain doesn't need it — if you're adding CORS to make your own app work, something else is wrong.

Never ship `Access-Control-Allow-Origin: *` on an endpoint that reads cookies.

---

## 9. Rate limiting

```ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'),
});

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'anonymous';
  const { success, limit, remaining, reset } = await ratelimit.limit(ip);

  if (!success) {
    return NextResponse.json({ error: 'Too many requests' }, {
      status: 429,
      headers: { 'X-RateLimit-Limit': String(limit), 'X-RateLimit-Reset': String(reset) },
    });
  }
  …
}
```

In-memory counters don't work on serverless (each invocation may be a fresh instance), so use a shared store. Rate-limit anything public: auth, search, uploads, and anything that costs you money per call.

---

## 10. Special file-generating routes

```ts
// app/sitemap.ts
export default async function sitemap() {
  const posts = await getPosts();
  return [
    { url: 'https://x.com', lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    ...posts.map(p => ({ url: `https://x.com/blog/${p.slug}`, lastModified: p.updatedAt })),
  ];
}

// app/robots.ts
export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin/'] }],
    sitemap: 'https://x.com/sitemap.xml',
  };
}

// app/opengraph-image.tsx — a generated social preview image
import { ImageResponse } from 'next/og';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    <div style={{ fontSize: 64, background: '#111', color: '#fff', width: '100%',
                  height: '100%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center' }}>
      My Site
    </div>,
    size
  );
}
```

These are conventions, not route handlers you write by hand — Next.js generates the correctly-formatted output.

---

## 🧠 Rapid-fire recall

1. What creates an endpoint, and what can't share a folder with it?
2. Why can't you call both `request.json()` and `request.text()`?
3. When should you *not* write a route handler in an App Router app, and why?
4. Name four things that go wrong with webhook handlers.
5. Why must webhook signature verification use the raw text body?
6. Why do in-memory rate limiters fail on serverless?
7. What makes a route handler dynamic rather than cacheable?

<details>
<summary>Answers</summary>

1. A `route.ts` exporting named functions per HTTP method. It cannot coexist with a `page.tsx` in the same folder.
2. The request body is a stream that can only be consumed once. Use `request.clone()` if you genuinely need to read it twice.
3. For fetching data for your own Server Components or handling your own form mutations — query the database directly or use a Server Action. A route handler there adds an HTTP round trip from your server to itself, plus another surface to secure.
4. Parsing the body as JSON so the signature check fails, not verifying the signature at all, doing slow work before returning 200 (causing provider retries), and not being idempotent when those retries arrive.
5. The signature is computed over the exact bytes the provider sent; parsing and re-serialising changes whitespace and key order, so the hash won't match.
6. Each invocation may run in a fresh instance with its own memory, so counters aren't shared. Use a shared store like Redis.
7. Reading request-specific data — `cookies()`, `headers()`, or the request object itself — since the response then varies per request and cannot be cached.

</details>
