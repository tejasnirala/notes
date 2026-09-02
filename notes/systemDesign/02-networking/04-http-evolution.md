---
title: HTTP, 1.1 → 2 → 3
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# HTTP, 1.1 → 2 → 3

> **What you will be able to do after this page**
>
> - Say what each version fixed and what it left broken.
> - Explain why domain sharding and sprite sheets were correct in 2010 and harmful now.
> - Name the HTTP semantics that matter in design: methods, status classes, caching headers, idempotency.
> - Choose a version per workload rather than assuming newest is best.

The three versions share identical **semantics** — the same methods, headers and status codes — and differ entirely in **how bytes move on the wire**. Keeping those two layers separate is the key to the whole topic.

<Plain>

Picture a supermarket with one checkout lane. Everyone queues, one person is served at a time, and if someone at the front is slow, everyone behind them waits. That is **HTTP/1.1**.

The obvious fix is more lanes, and that is what browsers did — they opened six. Better, but six is still a fixed limit, and every lane needs its own setup.

**HTTP/2** did something cleverer: one lane, but the cashier handles many customers at once, taking a few items from each in turn. Nobody waits for the person in front to finish.

Then a subtle problem appeared. Everyone is now in **one** queue, so if that single queue jams — one dropped item on the floor — *everybody* stops, not just one lane. On a bad connection, six separate lanes were sometimes better.

**HTTP/3** fixes that by making the customers genuinely independent, so one person dropping something does not freeze the others.

Three versions, one idea being refined: <C color="orange">how do you serve many requests at once without letting one slow one block the rest?</C>

</Plain>

---

## 1. HTTP/1.1 — one request at a time

```
  One TCP connection:

  ──► GET /a          ◄── response a
  ──► GET /b          ◄── response b        strictly sequential
  ──► GET /c          ◄── response c
```

A connection carries one in-flight request. The next may not start until the current response completes. <C color="crimson">This is head-of-line blocking at the HTTP layer</C>, and it is 1.1's defining limitation.

*Pipelining* — sending several requests without waiting — was specified but responses still had to return **in order**, so one slow response blocked the rest. Broken proxies made it worse. <C color="crimson">Effectively no one shipped it.</C>

Browsers worked around it by opening **6 connections per origin**. Which produced an era of optimisations that are now actively harmful:

| 2010 technique | What it did | Why it is <C color="crimson">wrong now</C> |
| :--- | :--- | :--- |
| **Domain sharding** | `img1.`, `img2.`… to get 6 connections each | Multiplies DNS lookups, handshakes and congestion windows |
| **Sprite sheets** | One big image instead of 50 small ones | One byte changes and the whole sheet is re-downloaded |
| **Concatenating JS/CSS** | Fewer requests | Kills granular caching; one edit invalidates everything |
| **Inlining assets** | Zero extra requests | Inlined bytes can never be cached separately |

<H>These were workarounds for a connection limit that HTTP/2 removed. Applying them on HTTP/2 makes performance worse, not better.</H>

Also worth knowing: 1.1 headers are **plaintext and repeated in full on every request**. Cookies, user-agent and accept headers can easily be 800 bytes sent identically 100 times per page load.

---

## 2. HTTP/2 — multiplexing

One TCP connection, many **streams**, interleaved as binary frames.

```
  One TCP connection, frames interleaved:

  ──► [H:1][H:3][D:1][H:5][D:3][D:1][D:5][D:3]  ──►
       stream 1, 3 and 5 progress simultaneously
```

What it brought:

| Feature | Effect |
| :--- | :--- |
| **Multiplexing** | Unlimited concurrent requests on one connection. <C color="green">The 6-connection limit is gone.</C> |
| **Binary framing** | Cheaper, unambiguous parsing |
| **HPACK header compression** | Headers sent once; later requests reference an index. <C color="green">~800 bytes becomes tens.</C> |
| **Stream priorities** | Client can say CSS matters more than a footer image |
| **Server push** | Server sends assets before they are asked for — <C color="crimson">removed from Chrome in 2022</C>; it usually pushed things the client already had cached |

### What it did not fix

<H>HTTP/2 removed head-of-line blocking at the HTTP layer and left it at the TCP layer.</H>

All streams share one TCP connection. TCP guarantees ordered byte delivery, so **one lost packet stalls every stream** until it is retransmitted.

```
  HTTP/1.1, 6 connections:  packet loss stalls 1 of 6 → 5 keep going
  HTTP/2,   1 connection:   packet loss stalls the connection → all stall
```

<C color="crimson">On a lossy network — mobile, congested WiFi — HTTP/2 can be *slower* than HTTP/1.1.</C> On a clean network it is decisively faster. This is the honest, awkward result that motivated HTTP/3.

---

## 3. HTTP/3 — the same idea, over QUIC

HTTP/3 is HTTP/2's model moved onto **QUIC**, which runs over **UDP** and implements its own streams, loss recovery and encryption in user space. (Why UDP and not a new transport: [TCP is unchangeable in practice](./02-tcp-and-udp.md).)

| Improvement | Consequence |
| :--- | :--- |
| **Truly independent streams** | <C color="green">Loss in one stream does not stall the others.</C> The last head-of-line blocking is gone |
| **Merged transport + crypto handshake** | 1 RTT to first byte; **0-RTT** on resumption |
| **Connection IDs, not the 4-tuple** | <C color="green">A connection survives an IP change</C> — WiFi to cellular keeps the session alive |
| **Better loss recovery** | Unambiguous packet numbers remove TCP's retransmission ambiguity |

Costs, which are real:

- <C color="crimson">Some corporate firewalls block or throttle UDP</C>, so clients must be able to fall back to HTTP/2.
- <C color="orange">Higher CPU cost per byte</C> — the transport runs in user space without decades of kernel offload, though this keeps improving.

**Where it wins most:** mobile networks, high-latency links, and connections that change network mid-session. **Where it barely matters:** a fast wired connection inside a datacenter.

---

## 4. Choosing a version

| Context | Choice | Why |
| :--- | :--- | :--- |
| Public web, browser clients | <C color="green">HTTP/2 + HTTP/3</C>, negotiated | Browsers pick the best available; the CDN handles both |
| Mobile-heavy traffic | <C color="green">HTTP/3</C> | Loss tolerance and connection migration are exactly its strengths |
| Internal service-to-service | <C color="green">HTTP/2</C> (typically via gRPC) | Clean networks; multiplexing without QUIC's CPU cost |
| Large file downloads | Any — <C color="orange">it barely matters</C> | One big stream; multiplexing is irrelevant |
| Simple server-to-server API calls | HTTP/1.1 is <C color="green">fine</C> | With keep-alive, the difference is negligible at low concurrency |

<H>Version choice is a transport optimisation with real but bounded upside. An extra round trip or an unindexed database query will cost you far more than HTTP/1.1 ever will.</H>

---

## 5. The semantics that actually matter in design

Identical across all three versions, and these are what you reason about in an architecture discussion.

<Jargon
  plain="Doing the same thing twice has the same effect as doing it once."
  term="idempotent"
  also={['safe to retry', 'replay-safe']}>

The single most useful word on this page. Networks lose responses, so <C color="orange">clients retry whether or not you planned for it</C> — a payment request may genuinely arrive twice. "Is this endpoint idempotent?" is asking "what happens if this runs twice?", and the answer must be *"nothing bad"*.

</Jargon>

### Methods, by their two important properties

| Method | Safe? | Idempotent? | Meaning |
| :--- | :---: | :---: | :--- |
| `GET` | <C color="green">yes</C> | <C color="green">yes</C> | Read. Cacheable |
| `HEAD` | <C color="green">yes</C> | <C color="green">yes</C> | Headers only |
| `PUT` | no | <C color="green">yes</C> | Replace at a known URI |
| `DELETE` | no | <C color="green">yes</C> | Remove |
| `POST` | no | <C color="crimson">no</C> | Create / arbitrary action |
| `PATCH` | no | <C color="crimson">no</C> | Partial update |

- **Safe** = no side effects, so crawlers and prefetchers may call it freely.
- **Idempotent** = calling it N times equals calling it once.

<H>Idempotency is what makes automatic retries safe. It is a property you design in — the network will retry whether or not you did.</H>

Because `POST` is not idempotent, any `POST` that must survive a retry needs an explicit **idempotency key**: a client-generated UUID the server records, so a duplicate returns the original result instead of charging the card twice.

Here is the failure and the fix, side by side:

<Trace title="A payment that gets charged twice" subtitle="The network drops a response. Nothing is broken — and the customer is charged twice.">

<TraceStep
  title="Client sends the payment"
  state={{ 'Charges made': '0', 'Client believes': 'unknown', 'Idempotency key': 'none', 'Customer charged': '$0' }}
  note="An ordinary POST. No key attached.">

`POST /payments  { amount: 50 }` leaves the phone.

</TraceStep>

<TraceStep
  title="Server charges the card successfully"
  state={{ 'Charges made': '1', 'Client believes': 'unknown', 'Idempotency key': 'none', 'Customer charged': '$50' }}
  changed={['Charges made', 'Customer charged']}
  note="Everything has worked correctly so far.">

The card is charged. The server writes the record and sends `201 Created`.

</TraceStep>

<TraceStep
  title="The response is lost"
  cost="the actual failure"
  state={{ 'Charges made': '1', 'Client believes': 'it failed', 'Idempotency key': 'none', 'Customer charged': '$50' }}
  changed={['Client believes']}
  note="Note that nothing malfunctioned. A packet was dropped — the single most ordinary event on the internet.">

The user walks into a tunnel. The `201` never arrives. The client sees a timeout.

<C color="crimson">The client and the server now disagree about what happened, and neither can tell.</C>

</TraceStep>

<TraceStep
  title="The client retries — as it should"
  cost="$50 lost"
  state={{ 'Charges made': '2', 'Client believes': 'success', 'Idempotency key': 'none', 'Customer charged': '$100' }}
  changed={['Charges made', 'Client believes', 'Customer charged']}
  note="Retrying was correct behaviour. The design was wrong, not the client.">

The client resends the identical request. The server has no way to know it is a duplicate, so it charges the card **again**.

</TraceStep>

<TraceStep
  title="The fix — one extra field"
  cost="$0 lost"
  state={{ 'Charges made': '1', 'Client believes': 'success', 'Idempotency key': 'abc-123', 'Customer charged': '$50' }}
  changed={['Charges made', 'Idempotency key', 'Customer charged']}
  note="The client generates the key once, before the first attempt, and reuses it on every retry.">

`POST /payments  { amount: 50 }` with header `Idempotency-Key: abc-123`.

The server records the key with the result. On the retry it recognises `abc-123`, skips the charge, and **returns the original `201`**.

<H>The retry now succeeds and the customer is charged once. Idempotency does not prevent duplicate requests — it makes them harmless.</H>

</TraceStep>

</Trace>

This is standard in every payments API and belongs in any design involving money.

### Status codes, by class

| Class | Meaning | The ones worth knowing |
| :--- | :--- | :--- |
| **2xx** | Success | `200` OK · `201` Created · `202` <C color="orange">Accepted — queued, not done</C> · `204` No Content |
| **3xx** | Redirect | `301` permanent · `302`/`307` temporary · `304` <C color="green">Not Modified — the cache revalidation win</C> |
| **4xx** | <C color="crimson">Client error — do not retry unchanged</C> | `400` · `401` unauthenticated · `403` unauthorised · `404` · `409` conflict · `422` · `429` <C color="orange">rate limited — retry after</C> |
| **5xx** | <C color="green">Server error — retrying may work</C> | `500` · `502` bad gateway · `503` unavailable · `504` gateway timeout |

The 4xx/5xx split is a **retry contract**: <C color="crimson">retrying a 4xx wastes capacity and will keep failing</C>; retrying a 5xx or 429 with backoff is correct. `429` and `503` may carry `Retry-After`, which a well-behaved client honours instead of guessing.

`202 Accepted` is the status that shows up constantly in design: it is how you tell a client *"I have durably queued this; poll or wait for a webhook"*, which is the honest response for anything moved off the [synchronous path](../01-foundations/01-what-is-system-design.md).

<Depth title="How HPACK compresses headers, and the attack that shaped it">

HTTP/1.1 sends headers as plain text, in full, on every request. A typical browser request carries 500–800 bytes of `Cookie`, `User-Agent`, `Accept`, `Accept-Encoding` and friends — **identical every time**. On a page making 100 requests that is ~80 KB of pure repetition, and on an uplink-constrained mobile connection it is a genuine cost.

**HPACK** removes it with three mechanisms working together:

1. **A static table.** 61 of the most common header fields and values are pre-agreed and numbered — `:method: GET` is index 2, `:status: 200` is index 8. Sending index 2 costs **one byte** instead of eleven.
2. **A dynamic table.** Headers not in the static table get appended to a per-connection table as they are seen. The first request sends the full `Cookie: …`; every later request on that connection sends its **index**. A 700-byte cookie becomes 1–2 bytes.
3. **Huffman coding.** Anything that must be sent literally is Huffman-encoded with a table tuned for HTTP header characters, saving a further ~30%.

The result routinely exceeds 90% compression on the second and subsequent requests of a connection.

**Why a purpose-built format rather than gzip?** Because gzip on a stream of secrets is a vulnerability. The **CRIME** attack (2012) worked exactly this way: an attacker who can inject a guessed string into a request observes the *compressed size*. If the guess matches a real secret already in the stream — a session cookie — the compressor deduplicates and the output shrinks by a byte. Repeat character by character and you extract the cookie, without breaking any encryption.

HPACK is designed so that this cannot happen: it never applies a general-purpose compressor across attacker-controlled and secret data. Header values are indexed as **whole units**, and a value may be marked *never-indexed* so it is excluded from the dynamic table entirely. Huffman coding is applied per-value with a fixed table, so the output length reveals nothing about *other* values in the stream.

<C color="orange">This is a recurring lesson: compression and encryption interact badly, because compression makes output length depend on content, and length is not encrypted.</C> The same reasoning is why TLS 1.3 removed compression altogether. (HTTP/3 uses **QPACK**, the same idea reworked so that a lost packet cannot stall the header table.)

</Depth>

### Caching headers

The mechanism behind the entire [CDN and caching](/systemDesign/concepts) layer.

```http
Cache-Control: public, max-age=31536000, immutable   ← fingerprinted asset: app.a1b2c3.js
Cache-Control: private, no-cache                     ← must revalidate every time
Cache-Control: public, max-age=60, stale-while-revalidate=300
ETag: "a1b2c3"                                       ← content fingerprint
```

Two revalidation flows, both turning a full response into a cheap `304`:

```
  ETag:           client sends If-None-Match: "a1b2c3"     → 304 if unchanged
  Last-Modified:  client sends If-Modified-Since: <date>   → 304 if unchanged
```

Three directives worth having at your fingertips:

- <C color="green">`immutable`</C> — with a content hash in the filename, cache for a year and never revalidate. The correct pattern for static assets.
- <C color="green">`stale-while-revalidate`</C> — serve the stale copy instantly and refresh in the background. <C color="orange">Removes the latency cliff at expiry and defuses cache stampedes.</C>
- <C color="crimson">`no-store` vs `no-cache`</C> — constantly confused. `no-store` means never write it down at all (use for sensitive data); `no-cache` means store it but revalidate before every use.

---

## Rapid-fire recall

1. What do the three versions share, and what differs?
2. Why did browsers open six connections per origin, and what did that produce?
3. Name three 2010-era techniques that are now harmful, and why.
4. What did HTTP/2 fix and what did it leave broken?
5. On what kind of network can HTTP/2 be slower than HTTP/1.1, and why?
6. Name three things QUIC gives HTTP/3 beyond independent streams.
7. What is connection migration and which users notice it?
8. Which methods are idempotent, and why does that matter for retries?
9. How do you make a `POST` safely retryable?
10. Explain the 4xx/5xx retry contract, and the difference between `no-store` and `no-cache`.

<details>
<summary>Answers</summary>

1. They share **semantics** — methods, headers, status codes. They differ entirely in **wire format and transport**: how bytes are framed and multiplexed.
2. Because HTTP/1.1 allows one in-flight request per connection and pipelining was unusable. It produced domain sharding, sprite sheets, concatenation and inlining.
3. **Domain sharding** (extra DNS lookups, handshakes and congestion windows), **sprite sheets** (one changed byte re-downloads everything), **concatenation/inlining** (destroys granular caching). All were workarounds for a connection limit HTTP/2 removed.
4. Fixed: **HTTP-layer head-of-line blocking**, via multiplexed binary streams, plus HPACK header compression. Left broken: **TCP-layer head-of-line blocking** — all streams share one TCP connection.
5. A **lossy** network (mobile, congested WiFi). One lost packet stalls every multiplexed stream, whereas HTTP/1.1's six connections lose only one of six.
6. A **merged transport+crypto handshake** (1 RTT, 0-RTT on resumption), **connection IDs** that survive IP changes, and **better loss recovery** via unambiguous packet numbers.
7. A QUIC connection is identified by a **connection ID** rather than the IP/port 4-tuple, so it survives a network change. Mobile users moving from WiFi to cellular keep their session instead of reconnecting.
8. `GET`, `HEAD`, `PUT`, `DELETE` are idempotent; `POST` and `PATCH` are not. Idempotency is what makes an automatic retry safe — and the network will retry regardless of whether you designed for it.
9. Attach a client-generated **idempotency key** (a UUID). The server records it and returns the original result for any duplicate, so a retried payment does not charge twice.
10. **4xx** = client error, retrying unchanged will fail again and wastes capacity; **5xx** and **429** = retry with backoff, honouring `Retry-After`. `no-store` = never persist it anywhere (sensitive data); `no-cache` = persist it, but revalidate before every use.

</details>

---

**Next:** [REST, gRPC & GraphQL](./05-rest-grpc-graphql.md) — choosing an API style from the shape of the traffic.
