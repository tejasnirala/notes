---
title: CDNs
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# CDNs

> **What you will be able to do after this page**
>
> - Explain what a CDN does for content it cannot even cache.
> - Design a cache key, and avoid the `Vary` header trap that destroys hit ratios.
> - Choose between TTL expiry, purging and versioned URLs — and know why the third usually wins.
> - Say what belongs at the edge and what does not.

A CDN is the highest return-on-effort component in system design. It is also routinely described as *"it caches your images"*, which undersells it by a wide margin.

<Plain>

A shop sells a popular book. Every order goes to one warehouse in another country, so every customer waits two weeks for shipping.

The obvious fix is local warehouses. Keep copies of popular books in twenty cities, and most customers get theirs the next day. Only unusual titles need the long trip.

That is a CDN, and two things about it are less obvious than the warehouse picture suggests.

**Even for a book you do not stock locally, the local branch helps.** The customer walks into a nearby shop to place the order rather than posting a letter overseas — all the back-and-forth of ordering happens locally, and only the book itself makes the long journey. On the internet the back-and-forth is [handshakes](../02-networking/03-tls.md), and there are several of them.

**Stocking copies creates a new problem: keeping them current.** If the publisher issues a correction, twenty warehouses now hold the old edition, and you have no way to reach into each one and swap it. <C color="crimson">Deciding how copies get updated is harder than deciding to make copies</C> — and it is where most of the real design work lives.

</Plain>

---

## 1. What a CDN actually gives you

Four distinct benefits. Most people know the first.

| Benefit | Mechanism |
| :--- | :--- |
| **Cached content served locally** | A copy sits ~10 ms away instead of ~150 ms away |
| **Handshakes terminated locally** | TCP + TLS complete against the edge — <C color="green">even for content it cannot cache</C> |
| **Origin offload** | Your servers never see the traffic the edge absorbs |
| **Attack absorption** | Anycast spreads a DDoS across hundreds of sites instead of concentrating it |

The second row is the one people miss. For a **completely uncacheable** page — a personalised dashboard, say — a CDN still helps substantially, because the [expensive part of a cold request is the round trips](../01-foundations/04-latency-numbers.md), not the bytes.

```
  Without CDN:  4 round trips × 150 ms  = ~600 ms  before content
  With CDN:     3 round trips × 10 ms (to edge)  +  1 fetch over a
                warm, pooled origin connection    = ~200 ms
```

<H>A CDN is worth deploying in front of content it can never cache, purely because it moves the handshakes to within 10 ms of the user.</H>

---

## 2. Hit, miss, and the numbers that matter

<Jargon
  plain="How often the local copy could answer without going back to your servers."
  term="cache hit ratio"
  also={['hit rate', 'offload ratio']}>

Quoted as a percentage. <C color="orange">The gap between 90% and 99% is not 9% — it is a **10× difference in origin traffic**</C> (10% of requests reaching origin versus 1%). This is why hit ratio is the number to optimise, and why small cache-key mistakes are so expensive.

</Jargon>

Follow the same file twice and watch the origin load:

<Trace title="One asset, three requests" subtitle="A user in Sydney, origin in Virginia. Watch where each request terminates.">

<TraceStep
  title="Request 1 — cold edge, a MISS"
  cost="origin hit"
  state={{ 'Edge cache': 'empty', 'Served from': 'origin', 'User latency': '~600 ms', 'Origin requests': '1' }}
  changed={['Served from', 'User latency', 'Origin requests']}
  note="Someone always pays for the first request. The design goal is that it is one person, not everyone.">

The Sydney edge has never seen `/app.js`. It connects to origin, fetches the file, stores it according to the response's `Cache-Control`, and returns it.

</TraceStep>

<TraceStep
  title="Request 2 — a different Sydney user, a HIT"
  cost="0 origin load"
  state={{ 'Edge cache': 'fresh (TTL 3600s)', 'Served from': 'edge', 'User latency': '~15 ms', 'Origin requests': '1' }}
  changed={['Edge cache', 'Served from', 'User latency']}
  note="40× faster, and your origin does not know this request happened.">

The edge has a fresh copy. It answers directly. <C color="green">Origin is never contacted.</C>

</TraceStep>

<TraceStep
  title="Request 3 — a user in Tokyo"
  cost="origin hit again"
  state={{ 'Edge cache': 'fresh in Sydney, empty in Tokyo', 'Served from': 'origin', 'User latency': '~400 ms', 'Origin requests': '2' }}
  changed={['Edge cache', 'Served from', 'User latency', 'Origin requests']}
  note="Caches are per-location. A global CDN with 300 sites can mean 300 origin fetches for one file.">

Tokyo is a separate cache. It misses, and fetches from origin independently.

<C color="orange">This is why **tiered caching** exists</C> — edges fetch from a regional parent cache rather than all going to origin, so one origin fetch serves many edges.

</TraceStep>

<TraceStep
  title="One hour later — the TTL expires"
  state={{ 'Edge cache': 'stale', 'Served from': 'revalidating', 'User latency': '~600 ms', 'Origin requests': '3' }}
  changed={['Edge cache', 'Served from', 'User latency', 'Origin requests']}
  note="With ETags this is cheap — a 304 Not Modified transfers no body. Without them, the full file is re-sent.">

The entry is stale. The next request triggers a revalidation: `If-None-Match: "abc"` → `304 Not Modified`, and the TTL resets.

</TraceStep>

<TraceStep
  title="The same moment, but with stale-while-revalidate"
  cost="0 ms user impact"
  state={{ 'Edge cache': 'stale, serving anyway', 'Served from': 'edge', 'User latency': '~15 ms', 'Origin requests': '3 (background)' }}
  changed={['Edge cache', 'Served from', 'User latency']}
  note="The user never waits for expiry. The refresh happens behind their request.">

`Cache-Control: max-age=3600, stale-while-revalidate=86400` lets the edge serve the stale copy **immediately** and refresh in the background.

<H>This removes the latency cliff at expiry, and prevents a popular object's expiry from sending a burst of simultaneous requests to origin.</H>

</TraceStep>

</Trace>

---

## 3. The cache key, and the trap

The **cache key** determines whether two requests are "the same object". Get it wrong and your hit ratio collapses without anything appearing broken.

By default the key is roughly: `host + path + query string`. Every distinct key is a separate cached copy.

### Where hit ratios go to die

**Query strings you do not care about.** Marketing links carry `?utm_source=twitter&utm_campaign=spring`. Each unique combination is a **separate cache entry** for a byte-identical file.

```
  /logo.png                        ← one object
  /logo.png?utm_source=twitter     ← a second copy
  /logo.png?utm_source=email       ← a third copy
  /logo.png?fbclid=IwAR3xY…        ← one copy per user, effectively
```

<C color="crimson">That last one is the killer</C> — click identifiers are unique per click, so the hit ratio for that object approaches zero. <C color="green">The fix is to strip or allow-list query parameters in the cache key</C>, keeping only ones that genuinely change the response.

**The `Vary` header.** `Vary` tells caches "the response depends on this request header", so a separate copy is stored per distinct value.

| `Vary` value | Copies stored | Verdict |
| :--- | :--- | :--- |
| `Accept-Encoding` | 2–3 (gzip, br, none) | <C color="green">Fine and necessary</C> |
| `Accept-Language` | One per language you serve | <C color="green">Fine if bounded</C> |
| `User-Agent` | <C color="crimson">Thousands</C> — every browser/OS/version combination | <C color="crimson">Destroys caching</C> |
| `Cookie` | <C color="crimson">One per user</C> | <C color="crimson">Effectively disables caching</C> |

<H>`Vary: User-Agent` or `Vary: Cookie` on a cacheable asset silently turns your CDN into a very expensive proxy. It is the single most common cause of a mysteriously low hit ratio.</H>

**Cookies on static paths.** Many frameworks set a session cookie on *every* response. If a static asset comes back with `Set-Cookie`, most CDNs refuse to cache it at all — correctly, since it now looks user-specific. Serve static assets from a path or hostname that never sets cookies.

---

## 4. Invalidation

The genuinely hard part. Three approaches, and they are not equally good.

### Approach 1 — wait for the TTL

Set `max-age` and accept staleness until it expires.

<C color="green">Zero machinery</C>. <C color="crimson">You cannot fix a bad deploy quickly</C>, and you are choosing between short TTLs (poor hit ratio) and fast updates.

### Approach 2 — purge

Call the CDN's API to evict an object everywhere.

<C color="green">Immediate and precise.</C> <C color="crimson">Costs</C>: propagation across hundreds of sites takes seconds to minutes, providers rate-limit purges, and it is an extra failure mode in your deploy pipeline — a purge that silently fails leaves stale content with no error.

### Approach 3 — never invalidate; change the URL

Put a content hash in the filename. `app.js` becomes `app.a1b2c3d4.js`.

```html
<script src="/static/app.a1b2c3d4.js"></script>
```

A new build produces a new hash, therefore a **new URL**, therefore a guaranteed miss and a fresh fetch. The old URL is never requested again.

<H>Immutable, versioned URLs turn invalidation from a distributed-systems problem into a build-step problem — which is why it is the standard answer for static assets.</H>

This also unlocks the most aggressive caching available:

```http
Cache-Control: public, max-age=31536000, immutable
```

A year, never revalidated. <C color="green">Safe precisely because the URL can never mean anything else.</C>

**The combination that works in practice:**

| Content | Strategy |
| :--- | :--- |
| JS, CSS, images, fonts | <C color="green">Hashed filenames + `immutable`, one year</C> |
| The HTML that references them | Short TTL (60 s) or `no-cache` + `ETag` — it must point at the new hashes |
| API responses | Short TTL + `stale-while-revalidate`, or no caching |
| User-specific pages | <C color="crimson">`private`, never cached at a shared edge</C> |

Note the asymmetry: the HTML is the only thing that must change quickly, and it is small. Everything large is immutable. <C color="orange">That inversion — cache the big things forever, revalidate only the small index — is the whole trick.</C>

<Depth title="Cache stampedes, and the three fixes">

A popular object expires. Within the same second, 5,000 requests arrive at the edge, all miss, and all forward to origin — for the identical object.

Your origin, sized for the ~1% of traffic that normally reaches it, receives a burst that assumes a 100% miss rate. It slows, so responses take longer, so more requests pile up behind them, so it slows further. <C color="crimson">The cache expiring is what took the origin down.</C>

This is a **cache stampede** (also *thundering herd*, or *dog-piling*). It is not CDN-specific — the identical failure occurs with Redis in front of a database, and the fixes are the same.

**Fix 1 — request coalescing.** The cache recognises that N concurrent requests want the same key, forwards **one**, and holds the rest until it returns. Most CDNs do this by default (Nginx calls it `proxy_cache_lock`; Varnish calls it request coalescing). <C color="green">It reduces the burst from 5,000 to 1</C> and is the single most effective fix. Verify it is on — it is not always the default in self-managed caches.

**Fix 2 — serve stale while revalidating.** `stale-while-revalidate` means expiry never produces a synchronous miss at all. The stale copy is served immediately and a single background fetch refreshes it. Combined with `stale-if-error`, the edge also keeps serving the stale copy when origin is *down* — <C color="green">turning an origin outage into invisible staleness rather than a user-visible error</C>.

**Fix 3 — jitter the TTLs.** If 10,000 objects were populated during the same deploy with an identical 3600 s TTL, they all expire in the same second, forever, in a synchronised wave. Add randomness — `max-age = 3600 ± 10%` — so expiry spreads out. This matters most for caches you populate programmatically, where it is easy to write the same TTL for every entry.

**The general lesson**, which recurs across the whole discipline: <C color="orange">systems that synchronise accidentally will synchronise catastrophically.</C> Retries without jitter, cron jobs at `* * * * *`, TTLs set in a loop, clients reconnecting after a deploy — all the same failure shape, all fixed by adding randomness.

</Depth>

---

## 5. What runs at the edge

Modern CDNs execute code at the edge (Cloudflare Workers, Lambda@Edge, Fastly Compute). Constrained environments — small memory, tight CPU budgets, no persistent local state — running physically close to users.

| <C color="green">Good at the edge</C> | <C color="crimson">Not at the edge</C> |
| :--- | :--- |
| Redirects, URL rewriting | Anything needing your primary database |
| A/B test bucketing | Multi-step transactions |
| Auth token validation (signature only) | Heavy computation |
| Geo-based routing and personalisation | Long-running jobs |
| Header manipulation, security headers | Anything needing strong consistency |
| Serving personalised HTML from cached fragments | State shared globally in real time |

The rule follows from geography: <C color="orange">an edge function that calls your origin database has moved the compute closer and left the data far away</C>, so it pays the full round trip anyway — plus a cold start. Edge compute pays off when the decision can be made from the request itself plus data already at the edge.

---

## 6. In a design discussion

- **"Everything static behind the CDN with hashed filenames and a one-year immutable TTL; the HTML gets a 60-second TTL because it's the pointer."** The complete static-asset answer in one sentence.
- **"Even for the uncacheable dashboard I'd front it with the CDN — the handshakes terminate 10 ms away instead of 150."** Shows you understand what a CDN is beyond caching.
- **"I'd strip `utm_*` and `fbclid` from the cache key, or the hit ratio goes to zero on shared links."** A specific, real, frequently-missed detail.
- **"`stale-while-revalidate` so expiry never causes a stampede, plus `stale-if-error` so an origin outage shows as staleness instead of errors."** Connects a header to a failure mode.

---

## Rapid-fire recall

1. Name four benefits of a CDN, and explain the one that applies to uncacheable content.
2. Why is 99% hit ratio meaningfully different from 90%?
3. Why does a global CDN with 300 sites sometimes cause 300 origin fetches for one file, and what fixes it?
4. What is a cache key by default, and what does `fbclid` do to it?
5. Which two `Vary` values are safe and which two destroy caching? Why?
6. Why do many CDNs refuse to cache a response carrying `Set-Cookie`?
7. Compare the three invalidation strategies and say why versioned URLs usually win.
8. Why can a hashed asset safely use a one-year TTL, and what must have a short one?
9. Describe a cache stampede and give the three fixes.
10. Why is an edge function that queries your origin database usually pointless?

<details>
<summary>Answers</summary>

1. **Cached content served locally**, **handshakes terminated locally**, **origin offload**, **attack absorption**. The second applies to uncacheable content: the expensive part of a cold request is the round trips (DNS, TCP, TLS), and terminating those ~10 ms away instead of ~150 ms away can cut latency by two-thirds even when every request reaches origin.
2. Because it is origin traffic that matters: 10% reaching origin versus 1% is a **10× difference in load**.
3. Caches are **per location**, so each edge misses independently. **Tiered caching** — edges fetching from a regional parent rather than origin — collapses many origin fetches into one.
4. Roughly `host + path + query string`. `fbclid` is **unique per click**, so every share creates a distinct cache key for a byte-identical object and the hit ratio approaches zero. Strip or allow-list query parameters.
5. Safe: `Accept-Encoding` (2–3 variants) and `Accept-Language` (bounded). Destructive: `User-Agent` (thousands of variants) and `Cookie` (one per user) — each multiplies stored copies until nothing is ever reused.
6. Because `Set-Cookie` makes the response look **user-specific**, and serving one user's cookie to another would be a security failure.
7. **TTL expiry** — no machinery, but you cannot fix mistakes quickly. **Purge** — immediate and precise, but propagation lag, provider rate limits, and a silent-failure mode in your pipeline. **Versioned URLs** — a new build gives a new URL, so no invalidation is ever needed; it converts a distributed-systems problem into a build-step problem.
8. Because the URL contains a **content hash** and can never refer to different bytes. The **HTML that references those URLs** must have a short TTL, since it is the pointer that has to change.
9. A popular object expires and thousands of concurrent requests all miss and hit origin simultaneously, overwhelming infrastructure sized for a low miss rate. Fixes: **request coalescing** (forward one, hold the rest), **`stale-while-revalidate`** (never a synchronous miss), and **jittered TTLs** (prevent synchronised expiry).
10. Because it has moved the **compute** close to the user while leaving the **data** far away — the round trip to origin is paid anyway, plus cold-start cost. Edge compute pays off only when the decision can be made from the request itself plus data already at the edge.

</details>

---

**Next:** [Rate Limiting](./04-rate-limiting.md) — deciding who gets to make a request at all.
