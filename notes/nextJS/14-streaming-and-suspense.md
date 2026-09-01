---
title: Streaming & Suspense
author: Tejas Nirala
---

# Streaming & Suspense

The feature that changes what "server rendering is slow" means. Instead of waiting for the whole page before sending anything, the server sends the shell immediately and streams each section in as its data resolves.

---

## 1. The problem

```jsx
export default async function Page() {
  const user   = await getUser();          // 100ms
  const posts  = await getPosts();         // 300ms
  const feed   = await getFeed();          // 2000ms  ← the slow one
  return <><Header user={user} /><Posts posts={posts} /><Feed feed={feed} /></>;
}
```

```
Without streaming:
  |──────────────── 2400ms of blank screen ────────────────| everything at once

The user waits 2.4 seconds to see a header that was ready at 100ms.
The slowest query on the page determines TTFB for the entire page.
```

---

## 2. The fix: Suspense boundaries

```jsx
export default function Page() {
  return (
    <>
      <Header />                                     {/* fast — renders in the shell */}
      <Suspense fallback={<PostsSkeleton />}>
        <Posts />                                    {/* fetches its own data */}
      </Suspense>
      <Suspense fallback={<FeedSkeleton />}>
        <Feed />                                     {/* slow, but isolated */}
      </Suspense>
    </>
  );
}

async function Posts() {
  const posts = await getPosts();
  return <PostList posts={posts} />;
}
```

```
With streaming:
  t=50ms   ─┐ shell: header + two skeletons        🖼 the user sees the layout
  t=350ms  ─┤ posts HTML streams in                 🖼 posts appear
  t=2050ms ─┘ feed HTML streams in                  🖼 feed appears

TTFB: 50ms instead of 2400ms.
LCP: usually the posts at 350ms instead of the whole page at 2400ms.
```

Note the structural change: each component now fetches **its own** data. That's what makes independent streaming possible, and it's viable because of request deduplication ([Server Components](./11-server-components.md)).

---

## 3. How it actually works over the wire

HTTP responses can be sent in chunks. Next.js uses that plus a small amount of inline JavaScript.

```html
<!-- Chunk 1, sent at t=50ms — the browser starts parsing and painting immediately -->
<html><body>
  <header>…</header>
  <div id="B:0"><div class="skeleton">Loading posts…</div></div>
  <div id="B:1"><div class="skeleton">Loading feed…</div></div>

<!-- … the connection stays open … -->

<!-- Chunk 2, sent at t=350ms -->
  <div hidden id="S:0"><ul><li>Real post…</li></ul></div>
  <script>$RC("B:0","S:0")</script>   <!-- swap the real content into the placeholder -->

<!-- Chunk 3, sent at t=2050ms -->
  <div hidden id="S:1">…the feed…</div>
  <script>$RC("B:1","S:1")</script>
</body></html>
```

`$RC` is a tiny inlined function that moves the hidden real content into the placeholder's position. Three properties worth noting:

1. **It works without client-side React.** The swap is plain DOM manipulation, so content appears even before hydration completes.
2. **Order doesn't matter.** If the feed resolved before the posts, its chunk would be sent first — boundaries resolve independently.
3. **It's one connection.** No extra requests, no client-side fetch waterfall.

---

## 4. `loading.tsx` — a boundary by convention

```
app/dashboard/
├── loading.tsx      ← automatically becomes <Suspense fallback={<Loading/>}>
└── page.tsx
```

That's the whole-segment version. It's the right default for a page whose content is uniformly slow. Use explicit `<Suspense>` when parts of the page differ in speed:

```jsx
export default function Page() {
  return (
    <>
      <Metrics />                                    {/* fast: in the shell */}
      <Suspense fallback={<ChartSkeleton />}><Chart /></Suspense>
      <Suspense fallback={<TableSkeleton />}><Table /></Suspense>
    </>
  );
}
```

You can use both: `loading.tsx` for the initial segment shell, and inner boundaries for slow parts within it.

---

## 5. Boundary placement is a UX decision

```jsx
// ❌ too coarse — the fast content is gated by the slow query
<Suspense fallback={<PageSkeleton />}>
  <Header /><Sidebar /><Feed />
</Suspense>

// ❌ too fine — twelve skeletons popping in at different times is visual noise
{items.map(i => <Suspense key={i.id} fallback={<RowSkeleton/>}><Row id={i.id}/></Suspense>)}

// ✅ grouped by what belongs together perceptually
<Header />
<Suspense fallback={<SidebarSkeleton />}><Sidebar /></Suspense>
<Suspense fallback={<FeedSkeleton />}><Feed /></Suspense>
```

Guidance:

- Put the **shell** (nav, headings, layout chrome) outside every boundary so it's in the first chunk.
- Group content that a user perceives as one block into one boundary.
- Give each boundary a skeleton that matches the final layout's dimensions — otherwise you trade a slow paint for a layout shift (bad CLS).

---

## 6. Streaming and waterfalls

Suspense doesn't fix a waterfall; it just makes one visible.

```jsx
// ❌ sequential: Comments can't start until Post's data resolves
async function Post({ id }) {
  const post = await getPost(id);              // 300ms
  return <><Article post={post} /><Comments postId={post.id} /></>;
}
async function Comments({ postId }) {
  const comments = await getComments(postId);  // +300ms → 600ms total
}
```

```jsx
// ✅ start both at once
export default function Page({ params }) {
  const postPromise = getPost(params.id);          // both begin immediately
  const commentsPromise = getComments(params.id);

  return (
    <>
      <Suspense fallback={<ArticleSkeleton />}><Article promise={postPromise} /></Suspense>
      <Suspense fallback={<CommentsSkeleton />}><Comments promise={commentsPromise} /></Suspense>
    </>
  );
}

async function Article({ promise }) { const post = await promise; … }
```

```
Sequential: post [────300ms────] comments [────300ms────]   = 600ms
Parallel:   post [────300ms────]
            comments [────300ms────]                        = 300ms
```

The trick is starting the promise **before** awaiting it, so both requests are in flight while React renders. Look at the Network tab: requests starting in a staircase are the tell.

---

## 7. Streaming and SEO

A common worry, and the answer is reassuring: Googlebot renders JavaScript and waits for the stream to complete, so streamed content **is indexed**.

But two things still matter:

- Put anything that must be in the *initial* HTML — the `<h1>`, the meta description, the canonical link, structured data — outside Suspense boundaries. Some crawlers and most link-preview bots don't execute JS.
- `generateMetadata` blocks the shell, so a slow query there delays the entire response. Keep it fast, and rely on `cache()` so it shares the page's query rather than issuing a second one.

---

## 8. Streaming and errors

```jsx
<ErrorBoundary fallback={<FeedError />}>       {/* or an error.tsx at this segment */}
  <Suspense fallback={<FeedSkeleton />}>
    <Feed />
  </Suspense>
</ErrorBoundary>
```

If `Feed` throws *after* the shell has been sent, the response headers are already out — the server can't change the status code. Instead, the error boundary's fallback is streamed into the placeholder.

```
t=50ms    shell sent, status 200 already committed
t=2000ms  Feed throws
          → the error UI is streamed into the feed's placeholder
          → the rest of the page is intact and interactive ✅
```

This is a real trade: with streaming you cannot return a 500 for a late failure. If a page must fail atomically with a proper status code, don't stream that part — await it in the shell.

---

## 9. Partial Prerendering (PPR)

The direction Next.js is heading: one page, static shell plus dynamic holes, in a single response.

```jsx
export const experimental_ppr = true;

export default function Page() {
  return (
    <>
      <StaticHeader />                                  {/* prerendered at BUILD time */}
      <Suspense fallback={<CartSkeleton />}>
        <Cart />                                        {/* dynamic, per user */}
      </Suspense>
    </>
  );
}
```

```
Request:
  the static shell is served instantly from the CDN edge (TTFB ~20ms)
  the dynamic hole streams in from the server
```

Today the choice is per-route: a page with any dynamic dependency renders dynamically in full. PPR makes it per-**boundary**, so one personalised widget no longer forfeits static delivery for the entire page. Check its stability status for your Next.js version before relying on it.

---

## 10. Debugging streaming

```bash
# watch the chunks arrive
curl -N https://yoursite.com/dashboard
```

```
Chrome DevTools → Network → the document request → Timing
  "Waiting (TTFB)" should be small
  "Content Download" spans the streaming duration
```

If TTFB is large, something is blocking the shell: an `await` outside a Suspense boundary, a slow `generateMetadata`, or slow middleware.

```jsx
// find the blocker by timing your data functions
console.time('getPosts'); const p = await getPosts(); console.timeEnd('getPosts');
```

---

## 🧠 Rapid-fire recall

1. What determines TTFB without streaming, and what determines it with?
2. Describe the wire mechanism — what does the server send, and what is `$RC`?
3. Why does streamed content appear before hydration completes?
4. Give one boundary placement that's too coarse and one that's too fine.
5. Why must a skeleton match the final layout's dimensions?
6. Does Suspense fix a data waterfall? What does?
7. What happens if a component throws after the shell has been sent?

<details>
<summary>Answers</summary>

1. Without streaming, the slowest query on the page. With streaming, the time to render the shell — everything outside Suspense boundaries.
2. The server sends the shell with placeholder divs, keeps the connection open, and later sends hidden divs containing the real content plus a tiny inline script. `$RC` is that script — it moves the hidden content into the placeholder's position.
3. The swap is plain DOM manipulation performed by an inline script, so it doesn't depend on React having loaded or hydrated.
4. Too coarse: one boundary around the header, sidebar and feed, so fast content waits for the slow query. Too fine: a boundary per list row, producing a cascade of independently popping skeletons.
5. Otherwise the content landing changes the layout, causing a visible jump and a poor CLS score — you'd be trading a slow paint for an unstable one.
6. No — it only makes the waterfall visible as sequentially appearing sections. Starting the promises before awaiting them (or `Promise.all`) makes the requests parallel.
7. The headers and status are already sent, so the server can't return a 500. The nearest error boundary's fallback is streamed into that placeholder while the rest of the page stays intact.

</details>
