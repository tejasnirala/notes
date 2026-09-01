---
title: Composing Server & Client Components
author: Tejas Nirala
---

# Composing Server & Client Components

The rules for mixing the two, the patterns that make the boundary manageable, and the traps that produce the errors you'll actually hit.

---

## 1. The four rules

```
1. Server can import and render Client.                          ✅
2. Client CANNOT import Server.                                  ❌
3. Client CAN render Server, if passed as children or a prop.    ✅
4. Props crossing the boundary must be serialisable.             ⚠️
```

Rule 2 exists because the import graph is resolved at build time: if a client module imports another module, that module must be bundled for the browser. A Server Component would then be running in the browser, where it has no database and no secrets.

Rule 3 works because `children` is not an import — it's a **hole**. The server renders the child and passes the result in.

---

## 2. The `children` hole — the pattern that makes everything work

```jsx
// ❌ error: you cannot import a server component into a client component
'use client';
import ServerData from './ServerData';

export default function Tabs() {
  const [tab, setTab] = useState(0);
  return <div>{tab === 0 && <ServerData />}</div>;
}
```

```jsx
// ✅ the server renders it and passes it in
// app/page.jsx (server)
import Tabs from './Tabs';
import ServerData from './ServerData';

export default function Page() {
  return <Tabs dataPanel={<ServerData />} />;      // rendered on the SERVER
}
```

```jsx
// Tabs.jsx
'use client';
export default function Tabs({ dataPanel }) {
  const [tab, setTab] = useState(0);
  return <div>{tab === 0 ? dataPanel : <Other />}</div>;   // just renders the prop
}
```

**What actually happens:**

```
SERVER
  renders <Page/>
    renders <ServerData/> → its OUTPUT becomes part of the RSC payload
    emits a reference to the Tabs client module, with `dataPanel` filled by that output

CLIENT
  loads Tabs.js (small)
  hydrates it, receiving `dataPanel` as an already-rendered React node
  toggling tabs is pure client work; ServerData's code was never downloaded ✅
```

The client component controls *where* and *whether* it renders; the server controls *what* it is.

---

## 3. Providers

```jsx
// app/providers.jsx
'use client';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState } from 'react';

export function Providers({ children }) {
  const [queryClient] = useState(() => new QueryClient());   // one per browser session
  return (
    <ThemeProvider attribute="class">
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
```

```jsx
// app/layout.jsx — still a Server Component
export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
```

Note `useState(() => new QueryClient())` rather than a module-level instance: on the server, a module-level client would be shared across **all users' requests**, leaking one user's cached data into another's response. Anything request-scoped must be created inside a component.

---

## 4. Passing data down

```jsx
// server: fetch, then hand serialisable data to the client island
export default async function Page() {
  const products = await db.product.findMany();
  return <ProductFilter products={products} />;      // ⚠️ this whole array is serialised
}
```

```jsx
'use client';
export function ProductFilter({ products }) {
  const [query, setQuery] = useState('');
  const visible = products.filter(p => p.name.includes(query));
  return <>…</>;
}
```

⚠️ Everything you pass is embedded in the RSC payload and downloaded. Passing 5,000 products means a 2MB page. Prefer:

```jsx
// pass only what's needed
const products = await db.product.findMany({
  select: { id: true, name: true, price: true },     // not the 40 KB description
  take: 50,
});

// or keep the filtering on the server via search params
export default async function Page({ searchParams }) {
  const { q } = await searchParams;
  const products = await db.product.findMany({ where: { name: { contains: q } } });
  return <><SearchInput /><Grid products={products} /></>;
}
```

---

## 5. Passing a promise across the boundary

```jsx
// server — start the fetch but DON'T await it
export default function Page({ params }) {
  const commentsPromise = getComments(params.id);       // no await

  return (
    <>
      <Article id={params.id} />                        {/* renders immediately */}
      <Suspense fallback={<CommentsSkeleton />}>
        <Comments promise={commentsPromise} />          {/* client component */}
      </Suspense>
    </>
  );
}
```

```jsx
'use client';
import { use } from 'react';

export function Comments({ promise }) {
  const comments = use(promise);                        // suspends until it resolves
  return comments.map(c => <p key={c.id}>{c.text}</p>);
}
```

The request starts on the server immediately (no client round trip), the page streams without waiting for it, and the client component unwraps the result. This is the render-as-you-fetch pattern, and it's why `use()` exists ([React: The Remaining Hooks](/reactJS/other-built-in-hooks)).

---

## 6. Client → server: Server Actions

The only function that may cross the boundary.

```jsx
// app/actions.js
'use server';
export async function createPost(formData) {
  const title = formData.get('title');
  await db.post.create({ data: { title } });
  revalidatePath('/posts');
}
```

```jsx
'use client';
import { createPost } from './actions';

export function Form() {
  return <form action={createPost}><input name="title" /><button>Save</button></form>;
}
```

The client imports a *reference*; Next.js turns the call into a POST to the server, where the real function runs. Full treatment in [Server Actions](./18-server-actions.md).

---

## 7. The "server component in a client slot" table

| You want | Do this |
| :-- | :-- |
| A client wrapper around server content | Pass the server content as `children` |
| A client tab bar with server panels | Pass panels as props: `<Tabs panels={[<A/>, <B/>]} />` |
| A client modal containing server content | Render the server content in the page; the modal wraps `children` |
| A client component to trigger server work | A Server Action |
| A client component to read server data on demand | A Route Handler + fetch, or React Query |
| A client component to re-read server data | `router.refresh()` or `revalidatePath` |

---

## 8. A realistic page

```jsx
// app/products/[id]/page.jsx — SERVER
import { AddToCart } from './add-to-cart';         // client
import { ImageGallery } from './gallery';          // client
import { Reviews } from './reviews';               // server
import { Recommendations } from './recommendations'; // server

export default async function ProductPage({ params }) {
  const { id } = await params;
  const product = await getProduct(id);

  return (
    <div>
      {/* client island: needs state for the selected image */}
      <ImageGallery images={product.images} />

      {/* server: pure rendering, 0 KB */}
      <h1>{product.name}</h1>
      <div dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />

      {/* client island: quantity state + a server action */}
      <AddToCart productId={product.id} stock={product.stock} />

      {/* server, streamed independently */}
      <Suspense fallback={<ReviewsSkeleton />}>
        <Reviews productId={id} />
      </Suspense>

      <Suspense fallback={<RecsSkeleton />}>
        <Recommendations productId={id} />
      </Suspense>
    </div>
  );
}
```

```
Client JS for this page:  the gallery (~3 KB) + add-to-cart (~1 KB) + React
Everything else — the markdown, the reviews, the recommendation model — server only.
Reviews and recommendations stream in independently and can fail independently.
```

---

## 9. The errors you'll see, and what they mean

```
"You're importing a component that needs useState. It only works in a
 Client Component but none of its parents are marked with 'use client'."
  → add 'use client' to the leaf that uses the hook (not to the parent page)

"Functions cannot be passed directly to Client Components unless you
 explicitly expose it by marking it with 'use server'."
  → you passed a callback prop across the boundary; use a Server Action,
    or move the handler inside the client component

"Error: async/await is not yet supported in Client Components."
  → you put 'use client' on an async component; split it, or use use()

"Hydration failed because the initial UI does not match what was rendered
 on the server."
  → see the Hydration page

"Only plain objects can be passed to Client Components from Server Components."
  → you passed a class instance (a Prisma model with methods, a Date subclass,
    a Mongoose document). Map it to a plain object first.
```

That last one is common with ORMs: `JSON.parse(JSON.stringify(doc))` works but loses Dates. Prefer an explicit `select` or a mapping function.

---

## 🧠 Rapid-fire recall

1. Why can't a Client Component import a Server Component?
2. Why does passing one as `children` work instead?
3. Why must a `QueryClient` be created inside a component rather than at module scope?
4. What's the risk of passing a large array from server to client?
5. What does passing a promise plus `use()` achieve?
6. What is the only kind of function that may cross the boundary?
7. What causes "Only plain objects can be passed to Client Components"?

<details>
<summary>Answers</summary>

1. Imports are resolved at build time, so importing it would require bundling it for the browser — where it has no database access, no secrets, and no server runtime.
2. `children` isn't an import. The server renders the component and passes its *output* into a hole in the client component's tree, so the server component's code is never bundled.
3. A module-scope instance on the server is shared across every user's request, so one user's cached data can leak into another's response. Creating it in `useState` makes it per-request/per-session.
4. Everything passed is serialised into the RSC payload and downloaded by the browser, so a large array becomes a large page. Select only the fields you need, limit the rows, or keep filtering on the server via search params.
5. The fetch starts on the server immediately with no client round trip, the page streams without waiting for it, and the client component suspends until it resolves — render-as-you-fetch rather than fetch-on-render.
6. A Server Action — a function in a module marked `'use server'`. The client receives a reference and calling it becomes a POST to the server.
7. Passing a class instance across the boundary — an ORM document with methods, a custom class, a Mongoose model. Map it to a plain object (ideally via an explicit `select`) first.

</details>
