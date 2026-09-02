---
title: Rate Limiting
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Rate Limiting

> **What you will be able to do after this page**
>
> - Implement the four classic algorithms and say what each gets wrong.
> - Explain the fixed-window boundary burst, with the arithmetic.
> - Design a distributed limiter that stays correct across many servers.
> - Choose what to key on, and respond in a way clients can actually act on.

Rate limiting protects a system from traffic it cannot serve — <C color="orange">including your own users' well-intentioned traffic</C>, which is more often the cause than malice.

<Plain>

A nightclub holds 200 people. The doorman's job is not to be unfriendly; it is to make sure the 200 people inside can actually move, get to the bar, and leave safely if there is a fire.

Without a doorman, 400 people get in, nobody can move, everyone has a bad night, and the club is dangerous. <C color="orange">Letting everyone in is worse for the crowd than turning some away.</C>

That is the whole argument for rate limiting. A server that accepts every request during a spike does not serve them all — it slows down, times out, and fails *everyone*, including the people it could have served comfortably. Refusing some requests quickly is how the rest succeed.

The interesting question is how you decide. Strictly one person per thirty seconds is predictable but silly — a group of four friends arriving together is fine. So most doors work on a different principle: there is some allowance built up, a small group can enter at once, and then you wait while the allowance refills.

That "allowance that refills" is the **token bucket**, and it is the algorithm most real systems use.

</Plain>

---

## 1. Why limit at all

Four distinct reasons, and they call for different limits:

| Reason | Example | Typical limit |
| :--- | :--- | :--- |
| **Protect capacity** | One client's retry loop saturating your database | Per client, generous |
| **Fairness** | One tenant consuming a shared pool | Per tenant, proportional |
| **Cost control** | An endpoint that calls a paid third-party API | Per account, tight |
| **Abuse prevention** | Credential stuffing, scraping, spam | Per IP + per account, tight |

<C color="crimson">The most common source of a request flood is not an attacker.</C> It is a client with a bug, a retry loop without backoff, or a batch job someone ran twice. Rate limiting is primarily a defence against accidents.

<Jargon
  plain="Refusing or slowing requests so the system stays healthy for everyone else."
  term="rate limiting"
  also={['throttling', 'admission control', 'load shedding']}>

Worth separating three related ideas: **rate limiting** enforces a quota per client; **throttling** slows rather than rejects; **load shedding** drops requests when the *system* is unhealthy regardless of who sent them. <C color="green">A well-defended service does all three at different layers.</C>

</Jargon>

---

## 2. The four algorithms

### Fixed window

Count requests per calendar window. Reset at the boundary.

```
  limit = 100 per minute

  10:00:00 ──────────────── 10:01:00 ──────────────── 10:02:00
     count = 0 → 100            count resets to 0
```

<C color="green">Trivially simple; one counter per key; almost no memory.</C> And it has a real flaw:

<H>A client can send 2× the limit across a window boundary — 100 requests at 10:00:59 and 100 more at 10:01:00, all allowed, 200 requests in one second.</H>

For a limit meant to protect capacity, being wrong by 2× at exactly the wrong moment defeats the purpose.

### Sliding window log

Store a timestamp for every request; count those within the trailing window.

<C color="green">Exactly correct — no boundary artifacts at all.</C> <C color="crimson">Memory is proportional to the request count</C>: 1M users at 100 requests/minute is 100M timestamps to hold and continually trim. Accurate and rarely affordable.

### Sliding window counter

The practical compromise. Keep the current and previous fixed-window counts, and interpolate:

```
  estimate = current_count + previous_count × (overlap fraction of previous window)

  At 10:01:15, with a 1-minute window:
    75% of the window still lies in the previous minute.
    previous = 80, current = 30
    estimate = 30 + 80 × 0.75 = 90   → under a limit of 100, allow
```

<C color="green">Two counters per key, boundary bursts largely eliminated, small approximation error</C> (it assumes the previous window's requests were evenly spread). This is what most production limiters use.

### Token bucket

A bucket holds up to `B` tokens and refills at `R` tokens/second. Each request removes one; an empty bucket means rejection.

```
        refill: R tokens/sec
              │
              ▼
        ┌───────────┐
        │ ●●●●●●    │  capacity B = 10, currently 6
        └─────┬─────┘
              │ one token per request
              ▼
```

<C color="green">The best default</C>, because it separates two things every other algorithm conflates:

- **`R` — the sustained rate** you are willing to serve indefinitely
- **`B` — the burst** you are willing to absorb at once

That distinction matters because <C color="orange">real traffic is bursty and legitimate</C>. A page load firing 8 parallel API calls is normal; a strict rate limit would reject half of them. Token bucket allows the burst and then enforces the average.

Watch one client's bucket over ten seconds:

<Trace title="A token bucket in motion" subtitle="Capacity 10 tokens, refill 2 tokens/second. One token per request.">

<TraceStep
  title="t = 0s — bucket full, idle client"
  state={{ 'Tokens': '10 / 10', 'Requests this step': '0', 'Allowed': '—', 'Rejected': '0' }}
  note="Tokens accumulate while the client is quiet — that accumulated allowance is the burst capacity.">

The client has not made a request recently, so the bucket has refilled to capacity.

</TraceStep>

<TraceStep
  title="t = 1s — a page load fires 8 requests at once"
  state={{ 'Tokens': '2 / 10', 'Requests this step': '8', 'Allowed': '8', 'Rejected': '0' }}
  changed={['Tokens', 'Requests this step', 'Allowed']}
  note="A fixed 2-per-second limit would have rejected 6 of these — all legitimate.">

Eight tokens are consumed instantly. <C color="green">All eight succeed</C>, because the bucket had banked allowance while idle.

</TraceStep>

<TraceStep
  title="t = 2s — 4 more requests, but only 2 tokens refilled"
  cost="2 rejected"
  state={{ 'Tokens': '0 / 10', 'Requests this step': '4', 'Allowed': '2', 'Rejected': '2' }}
  changed={['Tokens', 'Requests this step', 'Allowed', 'Rejected']}
  note="The burst is spent. From here the client is held to the sustained rate.">

Refill added 2 tokens (2/sec × 1s). Two requests take them; the other two get **`429 Too Many Requests`**.

</TraceStep>

<TraceStep
  title="t = 3–5s — client keeps pushing"
  state={{ 'Tokens': '0 / 10', 'Requests this step': '5/sec', 'Allowed': '2/sec', 'Rejected': '3/sec' }}
  changed={['Requests this step', 'Allowed', 'Rejected']}
  note="Exactly the intended behaviour: sustained throughput is capped at R, regardless of how hard the client tries.">

The bucket stays empty. The client is now served at precisely the refill rate — **2 requests/second**.

</TraceStep>

<TraceStep
  title="t = 6–9s — client backs off"
  state={{ 'Tokens': '8 / 10', 'Requests this step': '0', 'Allowed': '—', 'Rejected': '0' }}
  changed={['Tokens', 'Requests this step', 'Allowed', 'Rejected']}
  note="A well-behaved client that honours Retry-After ends up with burst capacity restored.">

The client honours `Retry-After` and pauses for 4 seconds. The bucket refills: 4 s × 2/s = **8 tokens**.

</TraceStep>

<TraceStep
  title="t = 10s — burst capacity is back"
  state={{ 'Tokens': '10 / 10', 'Requests this step': '0', 'Allowed': '—', 'Rejected': '0' }}
  changed={['Tokens']}
  note="B and R are separate dials: B sets how forgiving you are of bursts, R sets what you will sustain.">

Full again, and ready to absorb another burst.

<H>Token bucket lets you say "bursts of 10 are fine, but you may not average more than 2 per second" — two independent statements that every other algorithm forces you to conflate into one.</H>

</TraceStep>

</Trace>

### Leaky bucket

The mirror image: requests enter a queue that drains at a fixed rate. Overflow is rejected.

<C color="green">Output is perfectly smooth</C>, which is what you want when the thing downstream cannot tolerate bursts — a third-party API with a hard rate limit, or a legacy system. <C color="crimson">Adds queueing latency</C>, and a request may sit waiting rather than failing fast.

> **The distinction in one line:** token bucket limits the **average** while allowing bursts; leaky bucket enforces a **constant output rate** and smooths bursts away.

### Choosing

| Need | Algorithm |
| :--- | :--- |
| Simple, memory-cheap, approximate | Fixed window |
| Exact, small user base | Sliding window log |
| Good accuracy at scale | <C color="green">Sliding window counter</C> |
| Allow bursts, cap the average | <C color="green">Token bucket</C> — the usual default |
| Protect a downstream that hates bursts | Leaky bucket |

---

## 3. Doing it across many servers

Everything above assumes one counter. With 50 API servers, <C color="crimson">a per-server limit of 100 is really a limit of 5,000</C> — and worse, it moves depending on how the load balancer distributes requests.

**Option 1 — local limits, divided.** Each server allows `limit / N`. <C color="green">Zero coordination, zero latency.</C> <C color="crimson">Breaks whenever traffic is uneven</C> — a client whose requests land mostly on one server is throttled at a fraction of their real quota — and every autoscaling event changes `N`.

**Option 2 — a shared counter in Redis.** Every server increments the same key.

```lua
-- Atomic token bucket in a Lua script: one round trip, no race.
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens') or ARGV[1])
local last   = tonumber(redis.call('HGET', KEYS[1], 'ts') or ARGV[4])
local delta  = math.max(0, ARGV[4] - last)

tokens = math.min(ARGV[1], tokens + delta * ARGV[2])   -- refill, capped at capacity
local allowed = tokens >= 1
if allowed then tokens = tokens - 1 end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', ARGV[4])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return { allowed and 1 or 0, tokens }
```

<C color="green">Accurate and global.</C> <C color="crimson">Costs</C>: a network round trip on every request, and Redis becomes a dependency on your hot path. The script matters — doing read-then-write as separate commands is a race that lets concurrent requests both pass.

**Option 3 — local buckets, async reconciliation.** Each server keeps a local bucket and periodically syncs with a shared store, adjusting its local allowance. <C color="green">No per-request round trip</C>, <C color="orange">slightly approximate</C>. This is what large-scale limiters actually do.

<H>Perfect accuracy is rarely worth a synchronous round trip on every request. Being within 10% of the limit, cheaply, is almost always the better trade.</H>

<Depth title="What happens when the rate limiter itself fails">

You have added a component that every request must consult. That component can be slow, or down, and you must decide *in advance* what happens then — because the default behaviour of most implementations is worse than either deliberate choice.

**Fail open** — if Redis is unreachable, allow the request.
<C color="green">Availability is preserved.</C> <C color="crimson">All protection vanishes at once</C>, and the moment your limiter fails is plausibly correlated with the moment you need it — a traffic surge overloading both. Fail-open on a limiter that exists for *capacity protection* means the surge that broke Redis now reaches your database unfiltered.

**Fail closed** — if Redis is unreachable, reject.
<C color="green">Protection holds.</C> <C color="crimson">A Redis blip becomes a total outage</C>, converting a dependency failure into a user-visible one. Almost never right for a general API; occasionally right for something where the downside of over-admitting is severe — a paid third-party call, or a security-sensitive endpoint.

**The pragmatic answer is neither, and it is worth stating explicitly in a design discussion.** Keep an in-process fallback:

1. Every server maintains a **local** token bucket sized at `limit / N` (approximately), used only as a backstop.
2. Normal operation consults the shared store.
3. When the shared store times out — with a **tight timeout**, 5–10 ms, not the default — fall back to the local bucket.
4. Emit a metric and alert on it, because you are now running degraded and approximate.

This gives you <C color="green">accurate limiting when healthy, approximate limiting when degraded, and never a total outage</C>. It is more code, and it is the right shape for anything on a hot path.

**Two related failure modes worth designing against:**

**The limiter's own timeout is on the critical path.** If your Redis call has a 500 ms timeout and Redis is slow rather than down, every request now takes 500 ms longer — you have made a latency problem out of an availability protection. Keep the timeout well below your latency budget and treat a timeout as a fallback trigger, not an error.

**Rejections are not free.** A `429` still costs TLS termination, parsing, a limiter lookup and a response. Under a genuine flood, the rejections themselves can saturate you. Which is why <C color="orange">limiting must happen as early as possible</C> — at the CDN or edge rather than in your application — and why volumetric attacks are handled upstream at the network layer, not by application rate limits at all.

</Depth>

---

## 4. What to key on

The key determines who shares a budget, and getting it wrong is either useless or unfair.

| Key | Good for | Weakness |
| :--- | :--- | :--- |
| **IP address** | Unauthenticated endpoints | <C color="crimson">Shared NATs punish whole offices and mobile carriers; trivially evaded with a proxy pool</C> |
| **User / account ID** | Authenticated APIs | Requires auth first — so it cannot protect the login endpoint |
| **API key** | Third-party developers | The standard for public APIs; pairs naturally with tiers |
| **Tenant ID** | Multi-tenant SaaS | Prevents one customer starving the rest |
| **IP + endpoint** | Login, password reset, signup | <C color="green">Tight limits precisely where abuse concentrates</C> |
| **Global** | Total system protection | A blunt backstop, not a fairness mechanism |

<C color="green">Real systems layer several.</C> A typical arrangement: a generous per-user limit, a tighter per-IP limit on auth endpoints, a per-tenant quota, and a global ceiling as a last line of defence.

Note the ordering constraint: <C color="orange">you cannot limit by user before you know who the user is</C>, so authentication must come first in the [gateway pipeline](./02-reverse-proxy-and-api-gateway.md) — and endpoints *before* authentication (login, signup, password reset) can only be limited by IP, which is exactly why they need the tightest limits and additional defences like CAPTCHAs and progressive delays.

---

## 5. Responding well

A rejection should tell the client what to do. Most do not, which is why so many clients retry immediately and make things worse.

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 1735689660
Content-Type: application/json

{ "error": "rate_limited",
  "message": "Rate limit exceeded. Retry after 30 seconds.",
  "retry_after": 30 }
```

| Rule | Why |
| :--- | :--- |
| Use **`429`**, not `503` | `503` means *the server* is unhealthy; `429` means *you* exceeded a quota. Different client action |
| Always send **`Retry-After`** | Otherwise clients guess, and they guess badly — usually "immediately" |
| Send limit headers on **successful** responses too | Lets clients self-pace before hitting the wall |
| Never `429` a health check | <C color="crimson">You will eject your own healthy servers</C> |

And on the client side: **exponential backoff with jitter**. Backoff alone is not enough — if a thousand clients are rejected at the same instant and all back off by exactly 30 seconds, they return as a synchronised wave. <C color="green">Randomise it</C>, for the same reason CDN TTLs need jitter.

---

## 6. In a design discussion

- **"Token bucket, because a page load legitimately fires eight parallel calls — I want to allow the burst and cap the average."** Justifies the algorithm from actual traffic shape.
- **"Redis for the shared counter with an atomic Lua script, a 10 ms timeout, and a local bucket as fallback so a Redis blip doesn't take us down."** Covers correctness *and* the failure mode.
- **"Per-user limits generally, but per-IP on login — you can't key on a user before authentication, which is exactly why that endpoint gets abused."** Shows the ordering constraint.
- **"Limit at the edge so rejected traffic never reaches our servers."** The right layer.

---

## Rapid-fire recall

1. Name four reasons to rate limit, and the most common real source of a flood.
2. Show the fixed-window boundary problem with numbers.
3. How does the sliding window counter approximate the log, and what does it assume?
4. What two independent things does token bucket let you specify, and why does that matter?
5. Distinguish token bucket from leaky bucket in one sentence.
6. Why is a per-server limit of `limit / N` fragile?
7. Why must a distributed token bucket use an atomic script rather than read-then-write?
8. Compare fail-open and fail-closed, and describe the arrangement that beats both.
9. Why can the login endpoint only be limited by IP, and what follows from that?
10. Why is `429` correct and `503` wrong, and why must backoff be jittered?

<details>
<summary>Answers</summary>

1. **Protect capacity**, **fairness between tenants**, **cost control**, **abuse prevention**. The most common source is not an attacker but a **client bug** — a retry loop without backoff, or a batch job run twice.
2. With a limit of 100/minute: 100 requests at 10:00:59 and 100 more at 10:01:00 are both allowed, giving **200 requests in one second** — 2× the intended limit at the worst possible moment.
3. It keeps the **current and previous** window counts and interpolates by how much of the sliding window overlaps the previous one. It assumes the previous window's requests were **evenly distributed**, which introduces a small, bounded error.
4. **`B`** — the burst it will absorb at once — and **`R`** — the sustained rate. It matters because real traffic is legitimately bursty (a page load firing 8 parallel calls), and a limiter that cannot express "bursts are fine, sustained load is not" will reject valid traffic.
5. Token bucket **caps the average while allowing bursts**; leaky bucket **enforces a constant output rate**, smoothing bursts away at the cost of queueing latency.
6. Traffic is not evenly distributed, so a client landing mostly on one server is throttled at a fraction of their real quota — and **`N` changes with every autoscaling event**, silently changing the effective global limit.
7. Because read-then-write is a **race**: two concurrent requests can both read "1 token remaining" and both decrement, letting both through. A Lua script executes atomically on the Redis server, in one round trip.
8. **Fail open** preserves availability but removes protection exactly when a surge may be causing the failure. **Fail closed** preserves protection but turns a dependency blip into a total outage. Better: consult the shared store with a **tight timeout (5–10 ms)** and fall back to a **local per-server bucket**, alerting that you are degraded — accurate when healthy, approximate when not, never fully down.
9. Because **authentication has not happened yet** — there is no user identity to key on. It follows that login/signup/password-reset need the **tightest IP-based limits** plus additional defences (CAPTCHA, progressive delays), since IP keying is both unfair on shared NATs and easy to evade.
10. `503` says **the server** is unhealthy; `429` says **this client** exceeded its quota — different client actions. Backoff must be **jittered** because a thousand clients rejected simultaneously and backing off by an identical interval return as one synchronised wave.

</details>

---

**Next:** [Service Mesh](./05-service-mesh.md) — pushing retries, mTLS and observability out of your code and into the network.
