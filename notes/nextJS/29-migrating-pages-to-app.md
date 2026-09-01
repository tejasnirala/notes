---
title: Migrating from Pages to App
author: Tejas Nirala
---

# Migrating from Pages to App

A practical migration guide. The good news: the two routers coexist, so this is incremental and reversible page by page rather than a big-bang rewrite.

---

## 1. Decide whether to migrate at all

**Good reasons:**

- You need streaming — a slow page currently blocks on its slowest query.
- Your bundle is dominated by code that only renders (markdown, formatting, charting).
- You want nested layouts that preserve state across navigation.
- You're rewriting a section anyway.
- You want Server Actions instead of maintaining a parallel API surface.

**Bad reasons:**

- "It's the new way." A working Pages Router app is not technical debt.
- A blog with three pages will not measurably benefit.

**Honest blockers:** a critical dependency that doesn't support RSC (some CSS-in-JS and animation libraries were slow to adapt), a team without the bandwidth to learn a second mental model, or a highly interactive authenticated dashboard where RSC's bundle savings are small.

---

## 2. Coexistence

```
app/           takes precedence for conflicting routes
pages/         continues to work for everything else
```

You cannot have both `pages/about.tsx` and `app/about/page.tsx` — `app/` wins and the build warns. Everything else lives side by side.

**Suggested order:**

```
1. Create app/layout.tsx (absorbing _app and _document)
2. Migrate simple static pages — about, pricing, terms
3. Migrate pages using getStaticProps
4. Migrate pages using getServerSideProps
5. Migrate API routes
6. Migrate the highest-traffic, most complex pages LAST, with monitoring
7. Delete pages/ when it's empty
```

Migrate leaves first. Your most valuable page should benefit from everything you learned on the others.

---

## 3. `_app` and `_document` → `layout.tsx`

```jsx
// BEFORE — pages/_app.tsx
export default function App({ Component, pageProps }) {
  return (
    <ThemeProvider>
      <Layout><Component {...pageProps} /></Layout>
    </ThemeProvider>
  );
}

// BEFORE — pages/_document.tsx
export default function Document() {
  return <Html lang="en"><Head /><body><Main /><NextScript /></body></Html>;
}
```

```jsx
// AFTER — app/layout.tsx (both files collapse into this one)
import './globals.css';
import { Providers } from './providers';

export const metadata = { title: 'My App' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>            {/* 'use client' — the client-only providers */}
          <Layout>{children}</Layout>
        </Providers>
      </body>
    </html>
  );
}
```

Note there's no `<Head />` or `<NextScript />` — Next.js injects those. And the providers go in a separate `'use client'` file so the layout itself stays a Server Component ([Composing Server & Client](./13-composition-server-and-client.md)).

---

## 4. Data fetching

### `getStaticProps` → an async component

```jsx
// BEFORE
export async function getStaticProps() {
  const posts = await getPosts();
  return { props: { posts }, revalidate: 60 };
}
export default function Blog({ posts }) { return <List posts={posts} />; }

// AFTER
export const revalidate = 60;

export default async function Blog() {
  const posts = await getPosts();
  return <List posts={posts} />;
}
```

### `getStaticPaths` → `generateStaticParams`

```jsx
// BEFORE
export async function getStaticPaths() {
  const posts = await getPosts();
  return { paths: posts.map(p => ({ params: { slug: p.slug } })), fallback: 'blocking' };
}

// AFTER
export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map(p => ({ slug: p.slug }));
}
export const dynamicParams = true;      // ≈ fallback: 'blocking'   (false ≈ fallback: false)
```

### `getServerSideProps` → an async component + request APIs

```jsx
// BEFORE
export async function getServerSideProps({ req, params }) {
  const session = await getSession(req);
  if (!session) return { redirect: { destination: '/login', permanent: false } };
  const data = await getData(params.id, session.user.id);
  return { props: { data } };
}

// AFTER
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function Page({ params }) {
  const { id } = await params;                     // ⚠️ Next 15: a Promise
  const session = await getSession(await cookies());
  if (!session) redirect('/login');
  const data = await getData(id, session.user.id);
  return <View data={data} />;
}
```

### `notFound` and `redirect`

```jsx
// BEFORE
return { notFound: true };
return { redirect: { destination: '/x', permanent: true } };

// AFTER
import { notFound, redirect, permanentRedirect } from 'next/navigation';
notFound();
permanentRedirect('/x');
```

---

## 5. Routing APIs

```jsx
// BEFORE
import { useRouter } from 'next/router';
const router = useRouter();
router.query.id;
router.query.page;
router.pathname;
router.push('/x');
router.events.on('routeChangeStart', fn);

// AFTER
import { useRouter, usePathname, useSearchParams, useParams } from 'next/navigation';
const params = useParams();              // { id: '1' }        ← path segments
const search = useSearchParams();        // ?page=2            ← query string
const pathname = usePathname();
const router = useRouter();              // push, replace, back, forward, refresh, prefetch
```

Three specific losses to plan for:

```jsx
// 1. router.query is split into params + searchParams
// 2. router.events is GONE. For route-change side effects:
'use client';
useEffect(() => { analytics.page(pathname); }, [pathname, searchParams]);

// 3. router.isFallback is gone — use loading.tsx and Suspense instead
```

And every component calling these hooks must be a Client Component.

---

## 6. `next/head` → the Metadata API

```jsx
// BEFORE
import Head from 'next/head';
<Head>
  <title>My Page</title>
  <meta name="description" content="…" />
</Head>

// AFTER — static
export const metadata = { title: 'My Page', description: '…' };

// AFTER — dynamic
export async function generateMetadata({ params }) {
  const post = await getPost((await params).slug);
  return { title: post.title, description: post.excerpt };
}
```

`next/head` has no effect in the App Router. If titles stop updating after a migration, this is why.

---

## 7. API routes → Route Handlers

```ts
// BEFORE — pages/api/posts.ts
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const posts = await getPosts();
    return res.status(200).json(posts);
  }
  res.setHeader('Allow', ['GET']);
  return res.status(405).end();
}

// AFTER — app/api/posts/route.ts
export async function GET() {
  const posts = await getPosts();
  return Response.json(posts);
}
// unexported methods return 405 automatically
```

The mapping:

```
req.body            → await request.json() / .formData() / .text()
req.query           → new URL(request.url).searchParams
req.cookies         → request.cookies.get(name)?.value
res.status(n).json()→ Response.json(data, { status: n })
res.redirect()      → NextResponse.redirect(new URL(...))
res.setHeader()     → the headers option, or response.headers.set()
```

Also note the App Router parses the body *for you* on demand — there's no `bodyParser` config, and `formData()` handles multipart natively.

---

## 8. Making components client components

Anything with hooks, event handlers or browser APIs needs `'use client'`. Migrating naively means putting it everywhere; migrating well means pushing it down.

```jsx
// step 1 (naive but working): 'use client' at the top of the migrated page
// step 2 (the actual win): extract the interactive parts

export default async function Page({ params }) {          // server
  const product = await getProduct((await params).id);
  return (
    <>
      <ProductInfo product={product} />                   {/* server */}
      <AddToCart id={product.id} />                       {/* 'use client' */}
    </>
  );
}
```

Do step 1 to get the page working, then step 2 to actually gain something. Migrating everything to `'use client'` and stopping there gives you the App Router's complexity with none of its benefit.

---

## 9. Common migration bugs

```jsx
// 1. next/router imported in app/ → "NextRouter was not mounted"
// 2. router.query on a path segment → undefined; use params
// 3. next/head silently doing nothing
// 4. Forgetting 'use client' → "useState only works in Client Components"
// 5. Not awaiting params/searchParams/cookies()/headers() in Next 15
// 6. getServerSideProps left in an app/ page — it's simply ignored
// 7. CSS-in-JS with no registry → unstyled flash on first paint
// 8. useSearchParams without a Suspense boundary → a build error on static routes
// 9. A route that used to be static is now dynamic (a cookies() call crept in)
```

Number 9 is the sneaky one — it doesn't error, it just costs money and TTFB. Check the `next build` legend after every migrated page.

---

## 10. Verifying a migrated page

```bash
npm run build
```

```
□ Is the route still static (○/●) where it used to be?
□ Is First Load JS the same or lower? (If it went UP, 'use client' is too high.)
□ Does the page render with JavaScript disabled?
□ Do the title, description and OG tags still appear in view-source?
□ Do loading and error states behave? (Add loading.tsx and error.tsx.)
□ Does navigation preserve layout state where it should?
□ Do the E2E tests for this flow still pass?
```

```bash
# does the crawler still see your content?
curl -s https://localhost:3000/blog/post | grep -o '<title>.*</title>'
```

---

## 11. A staged plan

```
Week 1   app/layout.tsx + providers; migrate 2–3 static pages; add the tooling
Week 2   Migrate getStaticProps pages; add generateMetadata; verify build output
Week 3   Migrate getServerSideProps pages; introduce a Data Access Layer
Week 4   Migrate API routes to route handlers; convert form flows to Server Actions
Week 5   Migrate the complex pages; push 'use client' boundaries down; measure
Week 6   Delete pages/; remove dead API routes; audit the bundle
```

Deploy after each step. A migration that lands as one enormous pull request is a migration you cannot roll back.

---

## 🧠 Rapid-fire recall

1. Can `app/` and `pages/` coexist, and which wins on a conflict?
2. What replaces `_app.tsx` and `_document.tsx`?
3. Map `getStaticProps`, `getStaticPaths` and `getServerSideProps` to their App Router equivalents.
4. What two things does `router.query` split into, and what replaces `router.events`?
5. Why does `next/head` stop working, and what replaces it?
6. What's the difference between a naive and a good component migration?
7. What should you check in the build output after migrating a page?

<details>
<summary>Answers</summary>

1. Yes. `app/` takes precedence for conflicting routes, which is what makes incremental migration possible — but the same route can't exist in both.
2. A single `app/layout.tsx`, which renders `<html>` and `<body>` itself and exports `metadata`. Client-only providers move into a separate `'use client'` file wrapped around `{children}`.
3. `getStaticProps` → an async Server Component (with `export const revalidate` for ISR); `getStaticPaths` → `generateStaticParams` (plus `dynamicParams`); `getServerSideProps` → an async component using `cookies()`/`headers()` or `cache: 'no-store'`.
4. Into `params` (path segments, a page prop or `useParams`) and `useSearchParams` (the query string). `router.events` is gone — use an effect keyed on `usePathname()`/`useSearchParams()`.
5. The App Router uses the Metadata API instead; `next/head` has no effect there. Use `export const metadata` or `generateMetadata`.
6. Naive: put `'use client'` at the top of the migrated page so it works. Good: extract the interactive parts into small client leaves so most of the page stays on the server and the bundle actually shrinks.
7. That the route is still static where it used to be (the ○/●/ƒ symbol), and that First Load JS didn't increase — an increase means a client boundary is too high in the tree.

</details>
