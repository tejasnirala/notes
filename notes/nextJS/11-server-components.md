---
title: React Server Components
author: Tejas Nirala
---

# React Server Components

The biggest change to React's model since hooks. A Server Component runs **only on the server**, and its code never reaches the browser. Understanding what actually crosses the wire is what makes the rest of the App Router make sense.

---

## 1. The core idea

```jsx
// app/blog/[slug]/page.jsx — a Server Component. No 'use client'.
import { marked } from 'marked';                 // 40 KB markdown parser
import { db } from '@/lib/db';

export default async function Article({ params }) {
  const { slug } = await params;
  const post = await db.post.findUnique({ where: { slug } });   // direct DB access
  return (
    <article>
      <h1>{post.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: marked(post.body) }} />
    </article>
  );
}
```

What the browser downloads for this component: **nothing**. Not the component, not `marked`, not the database client, not the post data as JSON. Just the rendered output.

```
Traditional React (even with SSR):
   ship: component code + marked (40 KB) + the data as JSON + hydration
   → the browser re-runs the same logic to attach handlers

RSC:
   ship: <article><h1>…</h1><div>…</div></article> as a serialised description
   → nothing to hydrate; there's no interactivity here
```

---

## 2. SSR vs RSC — the distinction people miss

They solve different problems and compose together.

| | SSR | RSC |
| :-- | :-- | :-- |
| Question answered | *When* is the HTML produced? | *Where does the component code live?* |
| Component code shipped to client | ✅ yes (needed for hydration) | ❌ no |
| Runs on the client after load | ✅ yes | ❌ never |
| Can hold state / handlers | ✅ | ❌ |
| Can access DB/secrets | during the server pass only | ✅ always |

```
SSR:  the same component runs twice — once on the server (for HTML),
      once on the client (to hydrate). Its code exists in both places.

RSC:  the component runs ONCE, on the server. Its code exists in one place.
      The client receives its output, not its instructions.
```

A Next.js page uses both: Server Components produce most of the tree, and the Client Components inside it are server-rendered to HTML *and* shipped for hydration.

---

## 3. What actually crosses the wire: the RSC payload

Not HTML, and not JSON of your data — a special streaming format describing the rendered tree, with **holes** where Client Components go.

```
Simplified RSC payload:

0:["$","article",null,{"children":[
     ["$","h1",null,{"children":"My Post"}],
     ["$","div",null,{"dangerouslySetInnerHTML":{"__html":"<p>…</p>"}}],
     ["$","$L1",null,{"postId":"123"}]        ← a reference to client module #1
   ]}]
1:I["./LikeButton.js",["chunk-abc.js"],"default"]   ← the module to load for that hole
```

Two properties of this format matter:

1. **It's streamable.** Rows arrive as they're produced, so slow subtrees don't block fast ones ([Streaming & Suspense](./14-streaming-and-suspense.md)).
2. **It preserves React's tree structure**, so on navigation the client can merge new server output into the existing tree without remounting layouts or losing client state.

That second point is why navigating between server-rendered pages keeps your sidebar's scroll position — something a plain HTML response could never do.

---

## 4. What Server Components can and can't do

```jsx
// ✅ CAN
export default async function Page() {
  const data = await db.query(…);                    // direct data access
  const secret = process.env.API_SECRET;             // secrets stay server-side
  const file = await fs.readFile('./content.md');    // filesystem
  const res = await fetch('https://api.x.com', { headers: { Authorization: secret } });
  const cookieStore = await cookies();               // request context
  return <div>{/* render */}</div>;
}
```

```jsx
// ❌ CANNOT
useState, useReducer, useEffect, useContext, useRef      // no client runtime
onClick, onChange, onSubmit                              // no event handlers
window, document, localStorage                           // no browser
custom hooks that use any of the above
class components with lifecycle methods
```

Trying anyway produces a clear build error:

```
Error: useState only works in Client Components.
Add the "use client" directive at the top of the file to use it.
```

### The async component

```jsx
export default async function Page() {           // ✅ Server Components can be async
  const data = await getData();
}

'use client';
export default async function Page() { … }       // ❌ Client Components cannot be async
```

---

## 5. What you gain, concretely

### a) Bundle size

```
A blog post page, traditional React SPA:
   react + react-dom          45 KB
   markdown parser            40 KB
   syntax highlighter         90 KB
   date formatting            20 KB
   the post content as JSON   15 KB
   ──────────────────────────────────
   ~210 KB downloaded, parsed and executed

Same page with RSC:
   react + react-dom          45 KB   (needed for the interactive parts)
   the interactive bits        5 KB
   ──────────────────────────────────
   ~50 KB — the parser, highlighter and formatter ran on the server and are gone
```

Heavy libraries used only for rendering become **free** for the client.

### b) No API layer for your own data

```jsx
// ❌ the SPA shape: three files, one HTTP hop, two type definitions
// api/posts.ts + a fetch in useEffect + loading/error state

// ✅ RSC
const posts = await db.post.findMany();
```

No endpoint to write, secure, version, document and type twice.

### c) Waterfalls collapse

```jsx
// Client-side: each level's fetch waits for its parent to render and hydrate
// Server-side: this all happens in one process, on the same network as the DB
async function Page() {
  const user = await getUser();         // 5ms — the DB is next door
  return <Posts userId={user.id} />;    // another 5ms
}
```

A "waterfall" of two 5ms server-local queries is 10ms. The same waterfall over the public internet from a phone is 600ms.

### d) Security by construction

```jsx
// this cannot leak — the code never reaches the browser
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
```

---

## 6. Data fetching in Server Components

```jsx
// Just await. No useEffect, no loading state, no library.
export default async function Page() {
  const posts = await fetch('https://api.example.com/posts').then(r => r.json());
  return <PostList posts={posts} />;
}
```

### Parallel by default — if you write it that way

```jsx
// ❌ sequential: 300ms + 300ms
const user = await getUser(id);
const posts = await getPosts(id);

// ✅ parallel: 300ms total
const [user, posts] = await Promise.all([getUser(id), getPosts(id)]);
```

The `await` keyword makes waterfalls easy to write by accident. Always ask whether the second call actually needs the first one's result.

### Request deduplication

React's `cache()` and Next's extended `fetch` deduplicate identical calls within a single render pass:

```jsx
import { cache } from 'react';

export const getUser = cache(async (id) => db.user.findUnique({ where: { id } }));
```

```jsx
// Both of these run the query ONCE per request
async function Layout() { const user = await getUser('1'); … }
async function Page()   { const user = await getUser('1'); … }
```

This is what makes "each component fetches its own data" viable instead of catastrophic. Without it, a user object needed in five components would be five queries.

---

## 7. Composition rules

```
Server Component  →  can import and render a Client Component     ✅
Client Component  →  CANNOT import a Server Component             ❌
Client Component  →  CAN render one passed as `children`/props    ✅
```

```jsx
// ❌ this makes ServerThing part of the client bundle (and it will break)
'use client';
import ServerThing from './ServerThing';
export default function Client() { return <ServerThing />; }

// ✅ pass it through as children — it's rendered on the server, slotted in
// app/page.jsx (server)
import ClientWrapper from './ClientWrapper';
import ServerThing from './ServerThing';

export default function Page() {
  return <ClientWrapper><ServerThing /></ClientWrapper>;   // ✅
}
```

The mechanism: `<ServerThing />` is evaluated on the server, and the client component receives its *output* in the `children` hole. Full treatment in [Composing Server & Client](./13-composition-server-and-client.md).

---

## 8. Serialisation: what can cross the boundary

Props passed from a Server Component to a Client Component must be serialisable.

```jsx
// ✅
<Client
  str="a" num={1} bool={true} nul={null}
  arr={[1,2]} obj={{a:1}}
  date={new Date()}            // Dates, Maps, Sets, BigInt, TypedArrays are supported
  promise={somePromise}        // ✅ promises can be passed and unwrapped with use()
  node={<ServerThing />}       // ✅ JSX elements
/>

// ❌
<Client
  fn={() => {}}                // functions — EXCEPT 'use server' actions
  cls={new MyClass()}          // class instances
  sym={Symbol('x')}
/>
```

```
Error: Functions cannot be passed directly to Client Components
       unless you explicitly expose it by marking it with "use server".
```

Server Actions are the deliberate exception — a function reference that the client can call, which executes on the server ([Server Actions](./18-server-actions.md)).

---

## 9. When *not* to use a Server Component

Server Components are the default, but not always right:

- **A highly interactive page** (an editor, a canvas, a drag-and-drop board) is mostly client code anyway; forcing a server shell around it adds complexity for little gain.
- **Data that changes constantly per user interaction** may be better in a client cache (React Query) than a server round trip per change.
- **Optimistic UI** needs client state by definition.

The right instinct is not "everything on the server" but "the server by default, and push the client boundary as low as it can go".

---

## 10. Debugging: where is this running?

```jsx
console.log('here');
// Server Component → your TERMINAL
// Client Component → the browser console AND the terminal (it runs once during SSR)

export default function Component() {
  console.log(typeof window === 'undefined' ? 'server' : 'client');
}
```

```bash
npm run build     # shows First Load JS per route — the number RSC is supposed to shrink
```

If a route's client bundle is bigger than you expect, something in it has a `'use client'` above it that you didn't intend — usually an icon library or a UI wrapper imported into a layout.

---

## 🧠 Rapid-fire recall

1. What exactly does the browser receive for a Server Component?
2. Give the precise difference between SSR and RSC.
3. What is the RSC payload, and name two properties of the format that matter.
4. List four things a Server Component cannot do.
5. Why is `cache()` essential to the "every component fetches its own data" model?
6. State the four composition rules between server and client components.
7. What can and can't be passed as props across the boundary?

<details>
<summary>Answers</summary>

1. Only the rendered output, as part of the RSC payload. The component's code, its imports and the raw data never reach the client.
2. SSR is about *when* HTML is produced — the component runs on the server *and* ships to the client for hydration. RSC is about *where the code lives* — the component runs only on the server and its code never ships.
3. A streaming, line-based description of the rendered tree with references to client modules for interactive holes. It's streamable (slow subtrees don't block fast ones) and it preserves React's tree structure, so client state and layouts survive navigation.
4. Use state or effects, attach event handlers, access browser APIs like `window`/`localStorage`, use context, or call custom hooks that do any of those.
5. Without deduplication, a value needed in five components would trigger five identical queries per request. `cache()` collapses them into one within a single render pass.
6. Server can import and render Client; Client cannot import Server; Client can render a Server Component passed as `children` or a prop; the `'use client'` directive applies to a module and everything it imports.
7. Serialisable values: primitives, arrays, plain objects, Dates, Maps, Sets, BigInt, TypedArrays, JSX elements and promises. Not functions (except `'use server'` actions), class instances or symbols.

</details>
