---
title: REST, gRPC & GraphQL
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# REST, gRPC & GraphQL

> **What you will be able to do after this page**
>
> - Choose an API style from the shape of the traffic rather than from fashion.
> - Explain over-fetching and under-fetching, and what each style does about them.
> - Name GraphQL's three genuine operational costs.
> - Say why gRPC dominates internal traffic and is rare on the public web.

Three styles, three different bets about <C color="orange">who decides the shape of a response — the server, the schema, or the client</C>.

<Plain>

Three ways to order dinner.

**A printed menu.** You ask for dish number 12 and receive exactly what the restaurant decided dish 12 is — including the garnish you did not want. Simple, everyone understands it, and the kitchen can prepare popular dishes in advance. That is **REST**.

**A regular order between two businesses.** A bakery supplies a café every morning. They agreed the format long ago, so the order is a short code, not a description — compact and unambiguous, but meaningless to an outsider. That is **gRPC**: fast and precise between parties who share a contract, opaque to anyone else.

**Telling the chef exactly what you want on the plate.** "Chicken, no sauce, the potatoes from the other dish, and a small salad." You get precisely what you asked for and nothing wasted — but the kitchen has to do more work per order, and cannot prepare it ahead. That is **GraphQL**.

None is better. A restaurant with a fixed menu serves a lunch rush faster. A kitchen taking custom orders makes each diner happier. <C color="orange">The right answer depends on how many different kinds of diner you have, and how much you can predict what they want.</C>

</Plain>

---

## 1. REST

Resources identified by URLs, manipulated with HTTP methods, usually returning JSON.

```http
GET    /v1/users/42
GET    /v1/users/42/posts?limit=20&cursor=abc
POST   /v1/posts            { "text": "hello" }
DELETE /v1/posts/99
```

**The server decides the response shape.** That is REST's central property, and the source of both its strengths and its two named problems.

| | |
| :--- | :--- |
| <C color="green">Uses HTTP as designed</C> | Caching, status codes, methods, proxies and CDNs all work for free |
| <C color="green">Universally understood</C> | Any client, any language, debuggable with `curl` |
| <C color="green">Cacheable at every layer</C> | A `GET` with an `ETag` is cacheable by the browser, the CDN and a proxy |
| <C color="crimson">Over-fetching</C> | You need a name; you receive a 4 KB user object |
| <C color="crimson">Under-fetching (N+1)</C> | A list of 20 posts, then 20 requests for each author |

<Jargon
  plain="Getting a list, then having to make one more request for each item in it."
  term="the N+1 problem"
  also={['under-fetching', 'the N+1 query problem']}>

Named because one request for a list becomes 1 + N requests. It appears at every layer — in SQL against a database, and across the network against an API — and <C color="orange">the fix is always the same shape: batch the N into one</C>.

</Jargon>

The N+1 problem in practice:

```
  GET /posts?limit=20                    → 20 posts, each with author_id
  GET /users/1 … GET /users/20           → 20 more round trips
  ────────────────────────────────────────
  21 requests to render one screen
```

<C color="green">The standard fixes are cheap</C>: an `?include=author` expansion parameter, a batch endpoint (`GET /users?ids=1,2,3`), or a purpose-built endpoint for that screen. <C color="orange">Most teams reaching for GraphQL to solve N+1 could have solved it with an include parameter.</C>

### API design details that matter more than the style

- **Version in the path** (`/v1/`) — crude and it works. Header-based versioning is more elegant and much harder to debug and cache.
- <C color="green">**Cursor pagination, not offset.**</C> `?cursor=abc&limit=20` beats `?offset=1000&limit=20`, which <C color="crimson">skews when rows are inserted mid-scroll and gets slower the deeper you page</C> (the database must count past every skipped row).
- **Consistent error bodies.** A stable shape — `code`, `message`, `details` — because clients parse errors too.
- **Idempotency keys on unsafe writes.** See [HTTP semantics](./04-http-evolution.md).

---

## 2. gRPC

Remote procedure calls over HTTP/2, with **Protocol Buffers** as the serialisation format and the schema as the contract.

```protobuf
service UserService {
  rpc GetUser (GetUserRequest) returns (User);
  rpc ListPosts (ListPostsRequest) returns (stream Post);   // server streaming
}

message User {
  int64  id    = 1;      // field numbers, not names, go on the wire
  string name  = 2;
  string email = 3;
}
```

**The schema decides the shape**, and it is compiled into both sides.

| | |
| :--- | :--- |
| <C color="green">Compact binary encoding</C> | Field *numbers* on the wire, no field names, no braces — often 3–10× smaller than JSON |
| <C color="green">Fast serialisation</C> | Parsing is a fixed-layout decode, not a text tokenise |
| <C color="green">Generated clients</C> | Type-safe stubs in a dozen languages from one `.proto` |
| <C color="green">Streaming built in</C> | Client, server and bidirectional streams, from HTTP/2 |
| <C color="green">Schema is enforced</C> | The contract cannot silently drift from the code |
| <C color="crimson">Not human-readable</C> | You cannot `curl` it; debugging needs `grpcurl` and the schema |
| <C color="crimson">Poor browser support</C> | Browsers cannot control HTTP/2 framing; needs a `grpc-web` proxy |
| <C color="crimson">Not HTTP-cacheable</C> | Everything is a `POST`; CDNs and proxies cannot help |

### Schema evolution is the underrated part

Protobuf's field-numbering rules give you safe, independent deploys:

- <C color="green">Adding a new field with a new number is always backward compatible</C> — old readers skip what they do not recognise.
- <C color="crimson">Reusing a retired field number is a silent data-corruption bug</C>, which is why you mark numbers `reserved` rather than deleting them.

<H>This is what makes gRPC so well suited to internal traffic: services can be deployed independently without a coordinated release, because the wire format tolerates version skew by construction.</H>

<Depth title="What protobuf actually puts on the wire, byte by byte">

Take this message:

```protobuf
message User {
  int64  id   = 1;
  string name = 2;
}
```

with `id = 42` and `name = "Ana"`. JSON would send `{"id":42,"name":"Ana"}` — **22 bytes**, most of it field names and punctuation.

Protobuf sends **7 bytes**:

```
  08 2A 12 03 41 6E 61
  ─┬ ─┬ ─┬ ─┬ ─────┬──
   │  │  │  │      └── "Ana" as UTF-8
   │  │  │  └───────── length = 3
   │  │  └──────────── tag byte: field 2, wire type 2 (length-delimited)
   │  └─────────────── value 42
   └────────────────── tag byte: field 1, wire type 0 (varint)
```

Each field is preceded by a single **tag byte** packing two things: `(field_number << 3) | wire_type`. Field 1 with wire type 0 gives `0x08`; field 2 with wire type 2 gives `0x12`.

Two consequences follow directly from this encoding, and they are the whole reason protobuf suits internal service traffic:

**Unknown fields are skippable.** The wire type tells a reader how to *measure* a field it does not recognise — varint, 64-bit, length-delimited, 32-bit — so it can skip exactly the right number of bytes and carry on. <C color="green">This is what makes adding a field backward compatible: old readers step over it safely without needing the schema that defined it.</C>

**Field numbers are the contract; names are not.** Renaming `name` to `full_name` changes nothing on the wire. But <C color="crimson">reusing a retired field number silently reinterprets old bytes as a new meaning</C> — the reader has no way to detect it, because the tag byte looks perfectly valid. Hence `reserved 2;` rather than deletion.

Also note `int64` uses **varint** encoding: small numbers take one byte, and only large ones take ten. Field numbers 1–15 fit their tag in one byte, 16+ take two — which is why the convention is to assign 1–15 to your hottest fields.

</Depth>

**Why it dominates internal service-to-service traffic:** the bandwidth and CPU savings compound across millions of calls, the streaming is genuinely useful, and the browser limitation does not apply.

---

## 3. GraphQL

A single endpoint, a typed schema, and <C color="orange">the **client** specifies exactly what it wants</C>.

```graphql
query {
  user(id: 42) {
    name
    posts(last: 5) {
      title
      comments(last: 3) { text author { name } }
    }
  }
}
```

One round trip, exactly the fields requested, nested arbitrarily deep. For a mobile client on a slow network assembling a complex screen, this is a genuine improvement — <C color="green">it solves over-fetching and under-fetching simultaneously</C>, which nothing else does.

And it moves real costs onto the server:

### Cost 1 — the N+1 problem moved, not removed

Step through what that innocent-looking query actually does to the database:

<Trace title="One query, 22 database round trips" subtitle="The client sent a single request. Watch the backend.">

<TraceStep
  title="The client sends one query"
  state={{ 'Network requests': '1', 'DB queries': '0', 'Rows fetched': '0', 'Client sees': 'one clean request' }}
  note="From the client's side this looks like a strict improvement over REST. It is — for the client.">

One `POST /graphql`, asking for a user, their last 5 posts, and 3 comments per post with each comment's author.

</TraceStep>

<TraceStep
  title="Resolve the user"
  state={{ 'Network requests': '1', 'DB queries': '1', 'Rows fetched': '1', 'Client sees': 'one clean request' }}
  changed={['DB queries', 'Rows fetched']}>

`SELECT * FROM users WHERE id = 42`. Fine.

</TraceStep>

<TraceStep
  title="Resolve the posts"
  state={{ 'Network requests': '1', 'DB queries': '2', 'Rows fetched': '6', 'Client sees': 'one clean request' }}
  changed={['DB queries', 'Rows fetched']}>

`SELECT * FROM posts WHERE user_id = 42 LIMIT 5`. Still fine — one query for all five.

</TraceStep>

<TraceStep
  title="Resolve comments — once per post"
  cost="5 queries"
  state={{ 'Network requests': '1', 'DB queries': '7', 'Rows fetched': '21', 'Client sees': 'one clean request' }}
  changed={['DB queries', 'Rows fetched']}
  note="The resolver runs independently per parent object. It has no idea the other four exist.">

The comments resolver fires **once for each of the 5 posts**. Five separate queries.

</TraceStep>

<TraceStep
  title="Resolve comment authors — once per comment"
  cost="15 queries"
  state={{ 'Network requests': '1', 'DB queries': '22', 'Rows fetched': '36', 'Client sees': 'one clean request' }}
  changed={['DB queries', 'Rows fetched']}
  note="Many of those 15 authors are the same people, fetched repeatedly.">

15 comments, each triggering its own author lookup. **22 database queries** for one client request.

<C color="crimson">The client's N+1 problem did not disappear. It moved to the server, where it is harder to see.</C>

</TraceStep>

<TraceStep
  title="With DataLoader batching"
  cost="4 queries"
  state={{ 'Network requests': '1', 'DB queries': '4', 'Rows fetched': '36', 'Client sees': 'one clean request' }}
  changed={['DB queries']}
  note="DataLoader collects every id requested within one tick, then issues a single WHERE id IN (…) per entity type.">

Batching collapses it: one query for the user, one for posts, one for **all** comments, one for **all** authors — de-duplicated.

<H>This is why DataLoader is mandatory rather than optional. GraphQL without batching does not fail loudly; it just quietly multiplies your database load.</H>

</TraceStep>

</Trace>

That query looks like one request. Naively resolved, it is: 1 user + 1 posts query + <C color="crimson">5 separate comment queries + 15 separate author queries</C>. The database load did not shrink; it became invisible to the client and harder to see from the API layer.

The mitigation is the **DataLoader** pattern — batch and de-duplicate loads within a single request tick — and it is <C color="orange">mandatory rather than optional</C>. A GraphQL server without batching will melt its database.

### Cost 2 — caching mostly stops working

Every query is a `POST` to `/graphql` with a different body. <C color="crimson">HTTP caching, CDN caching and proxy caching all become useless.</C> You replace them with application-level caching keyed by entity — more machinery, entirely your problem now. Persisted queries (send a hash instead of the query text, allowing `GET`) recover some of it.

### Cost 3 — the attack surface

A client can request arbitrarily deep nesting and arbitrarily expensive joins. <C color="crimson">A single crafted query can take down the backend.</C> You need query depth limits, complexity scoring, and timeouts — and in practice an allow-list of persisted queries for public-facing deployments.

<H>GraphQL trades a client problem for a server problem. Take it when you have many diverse clients whose data needs you cannot predict — and not when you have one first-party client and control both ends.</H>

---

## 4. Choosing

| Situation | Choose | Why |
| :--- | :--- | :--- |
| Public API for third parties | <C color="green">REST</C> | Lowest adoption friction, cacheable, debuggable with tools everyone has |
| Internal service-to-service | <C color="green">gRPC</C> | Compact, fast, streaming, schema-enforced, safe version skew |
| Many clients, unpredictable data needs | <C color="green">GraphQL</C> | Mobile + web + partners each needing different fields off one graph |
| Mobile-first with complex screens | <C color="green">GraphQL</C> | One round trip on a slow network is worth real server complexity |
| Simple CRUD, one client | <C color="green">REST</C> | Everything else is complexity you will not use |
| Real-time bidirectional | Neither — see [WebSockets](./06-realtime-communication.md) | Request/response is the wrong shape |

**They coexist.** A very common and sensible arrangement:

```
  browser / mobile  ──GraphQL or REST──►  BFF / API gateway
                                              │
                                              ├──gRPC──►  user service
                                              ├──gRPC──►  post service
                                              └──gRPC──►  feed service
```

<C color="green">REST or GraphQL at the edge, gRPC behind it.</C> Each style is used where its trade-offs pay: cacheable and debuggable facing the world, compact and typed inside.

---

## 5. In a design discussion

- **"REST at the edge, gRPC internally."** Reads as experience, because it is what most large systems actually do.
- **"GraphQL solves *our* fetching problem by giving the backend an N+1 problem and a caching problem — worth it here because we have three client types with different needs."** Shows you know the cost, not just the pitch.
- **"Cursor pagination, since offsets skew when rows are inserted and degrade as you page deeper."** A small detail that signals you have operated an API.
- **"Adding a field is backward compatible in protobuf, so these two services deploy independently."** Connects the format to the deployment model, which is the real reason it was chosen.

---

## Rapid-fire recall

1. Who decides the response shape in each of the three styles?
2. Define over-fetching and under-fetching, with an example of each.
3. Give three REST fixes for N+1 that do not involve GraphQL.
4. Why is cursor pagination better than offset pagination? Give both reasons.
5. What actually goes on the wire in protobuf, and why is that a compatibility rule?
6. Why is gRPC dominant internally but rare on the public web? Give two reasons.
7. Name GraphQL's three operational costs.
8. What is DataLoader for, and why is it mandatory?
9. Why does HTTP caching stop working with GraphQL, and what partly restores it?
10. Sketch the arrangement that uses two of these styles together, and justify each placement.

<details>
<summary>Answers</summary>

1. **REST** — the server. **gRPC** — the schema (compiled into both sides). **GraphQL** — the client, per query.
2. **Over-fetching**: you want a name and receive a 4 KB user object. **Under-fetching**: a list of 20 posts forces 20 more requests to get each author — the N+1 problem.
3. An `?include=author` expansion parameter, a **batch endpoint** (`GET /users?ids=1,2,3`), or a **purpose-built endpoint** for that screen.
4. Offsets **skew** when rows are inserted mid-scroll (you see duplicates or skip rows), and they get **slower the deeper you page** because the database must scan past every skipped row. A cursor points at a position and does neither.
5. **Field numbers**, not field names. Therefore: adding a field with a **new** number is always backward compatible (old readers skip unknowns), and **reusing a retired number silently corrupts data** — so retired numbers are marked `reserved`.
6. Browsers cannot control HTTP/2 framing, so gRPC needs a `grpc-web` proxy; and everything is a `POST` with a binary body, so **HTTP caching and CDNs cannot help**. Internally neither limitation applies, while the size, speed, streaming and schema benefits all do.
7. **N+1 moved to the server** (and made invisible), **HTTP/CDN caching stops working**, and **an attack surface** where one deeply nested query can exhaust the backend.
8. Batching and de-duplicating data loads within a single request tick. Mandatory because a naive resolver turns one client query into dozens or hundreds of database queries.
9. Every query is a `POST` to a single endpoint with a different body, so no cache can key on it. **Persisted queries** — sending a hash of a pre-registered query, allowing `GET` — restore much of it.
10. **REST or GraphQL at the edge** (cacheable, debuggable, low friction for external and browser clients), **gRPC behind it** (compact, typed, streaming, safe version skew for internal calls).

</details>

---

**Next:** [Real-Time Communication](./06-realtime-communication.md) — polling, long polling, SSE, WebSockets and webhooks, and how to pick between them.
