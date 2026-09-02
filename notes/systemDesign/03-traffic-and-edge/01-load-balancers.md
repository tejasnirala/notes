---
title: Load Balancers
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Load Balancers

> **What you will be able to do after this page**
>
> - Say what L4 and L7 balancing each can and cannot do, and why the difference is about TLS.
> - Pick a balancing algorithm from the shape of the traffic rather than by habit.
> - Explain health checks, draining and why a naive check makes outages worse.
> - Recognise when the load balancer itself is the single point of failure, and what to do about it.

A load balancer is the first component most people add when one server stops being enough. It is also the component most often drawn without being understood.

<Plain>

A bank has one teller and a growing queue. The fix is more tellers — but now someone has to decide who goes to which window, or everyone piles into the first one.

So you add a person at the door directing people to free windows. Simple idea, and immediately there are decisions to make.

**Do you send people strictly in turn?** Fair, until one customer needs an hour and the person behind them waits while another window sits idle.

**Do you send them to whoever has the shortest queue?** Better — but you now have to keep watching every window.

**What if a teller goes for lunch without telling you?** You keep sending people to an empty window and they wait forever. So you need to *check* periodically that each teller is still there.

**And what if the person at the door is off sick?** Then nobody gets served at all — even though every teller is fine. <C color="crimson">You have made the door the most fragile part of the whole bank.</C>

Every one of those questions has a direct equivalent in software, and this page is those answers.

</Plain>

---

## 1. What it actually does

A load balancer accepts connections on one address and forwards them to one of many backends.

```
                          ┌──────────┐
                          │ server A │  healthy
   clients ──────┐    ┌──►└──────────┘
                 │    │   ┌──────────┐
              ┌──▼────┴──►│ server B │  healthy
              │  LB   ├──►└──────────┘
              └───────┤   ┌──────────┐
                      └─X─│ server C │  failing health checks
                          └──────────┘   ← removed from rotation
```

Four jobs, and only the first is in the name:

| Job | What it means |
| :--- | :--- |
| **Distribute** | Spread requests so no backend is overwhelmed |
| **Detect failure** | Notice a dead backend and stop sending to it |
| **Decouple** | Clients address one stable name; backends come and go behind it |
| **Terminate** | Often ends TLS, so backends speak plain HTTP |

<H>The failure detection is worth as much as the distribution. A load balancer with one backend is still useful, because it turns a crash into a brief error instead of a total outage.</H>

---

## 2. Layer 4 vs Layer 7

The single most important distinction, and it comes down to one question: **does the balancer decrypt the traffic?**

<Jargon
  plain="Whether the balancer looks only at addresses and ports, or actually reads the request inside."
  term="L4 vs L7 load balancing"
  also={['transport-level vs application-level', 'TCP vs HTTP load balancing']}>

Named after the OSI layers — layer 4 is TCP, layer 7 is HTTP. In a design discussion you might say <C color="green">*"L7 so we can route by path"*</C> or <C color="green">*"L4 because we need raw throughput and the payload isn't HTTP"*</C>. The trade is **visibility versus cost**.

</Jargon>

```
  LAYER 4                              LAYER 7
  sees: IP, port, TCP flags            sees: method, path, headers, cookies, body
  does: pick a backend, forward bytes  does: everything L4 does, plus decide on content

  ┌─────────────────────────┐          ┌─────────────────────────────────┐
  │ 203.0.113.9:443 → ?     │          │ GET /api/users  Host: x.com     │
  │ (contents opaque)       │          │ Cookie: session=… → api pool    │
  └─────────────────────────┘          │ GET /img/logo.png → static pool │
                                       └─────────────────────────────────┘
```

| | Layer 4 | Layer 7 |
| :--- | :--- | :--- |
| Throughput | <C color="green">Very high — mostly kernel-level packet forwarding</C> | Lower — must parse, and usually decrypt |
| Latency added | <C color="green">Microseconds</C> | Sub-millisecond, but real |
| Route by URL path | <C color="crimson">No</C> | <C color="green">Yes</C> |
| Route by header, cookie, tenant | <C color="crimson">No</C> | <C color="green">Yes</C> |
| Retry a failed request | <C color="crimson">No — it cannot tell a request from a byte</C> | <C color="green">Yes</C> |
| Cache responses | <C color="crimson">No</C> | <C color="green">Yes</C> |
| Works for non-HTTP (databases, gRPC streams, game traffic) | <C color="green">Yes</C> | Only if it speaks the protocol |
| Sees plaintext | <C color="green">No — better for confidentiality</C> | <C color="crimson">Yes — it must decrypt</C> |

**The decisive question is not performance.** On modern hardware, L7 balancing is fast enough for nearly everything. The real question is whether you need the balancer to *understand* requests — to route `/api` and `/static` differently, to retry a `GET` on a failed backend, to rate-limit per user, to add tracing headers.

<C color="orange">If you need any of that, you need L7, and therefore you need TLS terminated at the balancer</C> — which is also why the [TLS termination decision](../02-networking/03-tls.md) and the L4/L7 decision are really the same decision wearing two hats.

---

## 3. The algorithms

How the balancer chooses a backend. Each is right for a different traffic shape.

| Algorithm | How it picks | Best when |
| :--- | :--- | :--- |
| **Round robin** | Strictly in turn | Requests cost about the same, backends are identical |
| **Weighted round robin** | In turn, but bigger servers get more | Heterogeneous hardware |
| **Least connections** | Fewest open connections wins | <C color="green">Request durations vary a lot</C> |
| **Least response time** | Fewest connections, tie-broken by latency | Backends differ in speed |
| **IP hash** | Hash the client IP → always the same backend | Crude session stickiness |
| **Consistent hashing** | Hash a key onto a ring | <C color="green">Cache locality — same key to same backend</C> |
| **Random two choices** | Pick two at random, take the less loaded | <C color="green">Large fleets — near-optimal, almost no coordination</C> |

**Round robin is the default and is wrong more often than people think.** It assumes every request costs the same. The moment some requests take 10 ms and others take 3 seconds, round robin will cheerfully queue a fast request behind a slow one while another backend idles.

<C color="green">Least connections is the better default for most real traffic</C>, because open connections are a decent proxy for current load and it needs no cooperation from the backend.

<Depth title="Power of two choices — why picking the best of two beats picking the best of all">

There is a result from the balanced-allocations literature that is genuinely surprising and directly useful at scale.

Suppose you place n balls into n bins. If each ball goes to a **uniformly random** bin, the fullest bin ends up with roughly

```
  log n / log log n     balls     — for n = 1,000,000, about 6
```

Now change one thing: for each ball, pick **two** bins at random and put it in the less loaded of the two. The fullest bin now holds about

```
  log log n / log 2 + O(1)   balls  — for n = 1,000,000, about 4
```

That looks like a small improvement in the constants, but the asymptotics are dramatically different — `log n / log log n` grows without bound; `log log n` is essentially flat. Going from **one** random choice to **two** gives an exponential improvement in the maximum load. Going from two to three, or to ten, gives only a further constant-factor gain. <C color="orange">Almost all of the benefit is in the second choice.</C>

Why this matters for load balancing specifically:

**True "least connections" does not scale across balancers.** With a fleet of 20 load balancers each holding its own view, "least connections" is only least-connections *as far as that balancer knows*. Worse, if several balancers independently decide the same backend is least loaded, they all pile onto it simultaneously — a **herd effect** that makes the imbalance worse than random would have been.

**Two random choices is immune to that.** Each balancer samples two backends and compares. There is no shared "current best" for everyone to stampede toward, so the herd effect disappears while the load distribution stays near-optimal. This is why it appears in Nginx (`random two least_conn`), in HAProxy, and inside most large-scale internal balancers.

The same result underpins several other designs you will meet: hash-with-two-choices in distributed caches, and replica selection in Cassandra-style systems.

</Depth>

### Sticky sessions

Pinning a client to one backend, usually via a cookie the balancer sets.

<C color="crimson">Treat this as a smell, not a feature.</C> It exists because a backend is holding state that should not be there — a session in local memory, an uploaded file on local disk, a WebSocket connection.

| Consequence | Why it hurts |
| :--- | :--- |
| Uneven load | Sticky clients cannot be rebalanced when a backend gets hot |
| Bad failure behaviour | When that backend dies, **its** users lose state, not just a request |
| Blocks autoscaling | Removing a backend evicts everyone pinned to it |

The fix is nearly always to move the state out — into Redis, a database, or a signed token — after which any backend can serve any request. <C color="green">The genuine exception is WebSockets</C>, where the connection *is* server state by definition; that is what the [gateway pattern](../02-networking/06-realtime-communication.md) exists to contain.

---

## 4. Health checks, and how they go wrong

A backend is only useful if the balancer knows it is alive. But *"alive"* is subtler than it looks.

<Jargon
  plain="Two different questions: is the process running, and is it actually able to serve requests?"
  term="liveness vs readiness"
  also={['health check vs readiness probe']}>

<C color="crimson">A process that is running but cannot reach its database is *live* but not *ready*.</C> Sending it traffic produces errors; restarting it fixes nothing. Kubernetes makes the distinction explicit with separate probes, and the same distinction matters at the load balancer.

</Jargon>

Walk through a backend dying, and watch what the balancer knows at each moment:

<Trace title="A backend dies at 14:02:00" subtitle="Health check every 5 s, 3 consecutive failures required to eject.">

<TraceStep
  title="14:01:55 — everything healthy"
  state={{ 'Healthy backends': '3 of 3', 'Traffic to C': '33%', 'Failed requests': '0', 'LB believes': 'all good' }}
  note="Three backends, traffic split evenly.">

The balancer's last check of server C succeeded. Requests are spread across A, B and C.

</TraceStep>

<TraceStep
  title="14:02:00 — C crashes"
  cost="requests start failing"
  state={{ 'Healthy backends': '3 of 3 (believed)', 'Traffic to C': '33%', 'Failed requests': 'rising', 'LB believes': 'all good' }}
  changed={['Failed requests']}
  note="This window is unavoidable. The only question is how long it lasts.">

C's process dies. The balancer does not know yet — <C color="crimson">it is still sending a third of all traffic into a hole.</C>

</TraceStep>

<TraceStep
  title="14:02:03 — first failed check"
  state={{ 'Healthy backends': '3 of 3 (believed)', 'Traffic to C': '33%', 'Failed requests': 'rising', 'LB believes': 'C failed once' }}
  changed={['LB believes']}
  note="One failure is not enough. A single dropped packet must not eject a healthy server.">

The health check times out. The balancer records **one** failure and keeps routing to C.

</TraceStep>

<TraceStep
  title="14:02:13 — third failed check, C ejected"
  cost="13 s of errors"
  state={{ 'Healthy backends': '2 of 3', 'Traffic to C': '0%', 'Failed requests': 'stopped', 'LB believes': 'C is down' }}
  changed={['Healthy backends', 'Traffic to C', 'Failed requests', 'LB believes']}
  note="Detection time = interval × threshold. 5 s × 3 = 15 s worst case. That number is a design decision, not a default to accept.">

Three consecutive failures. C is removed from rotation; A and B now take 50% each.

</TraceStep>

<TraceStep
  title="14:05:00 — C restarts, and the trap appears"
  cost="the dangerous moment"
  state={{ 'Healthy backends': '3 of 3', 'Traffic to C': '33% instantly', 'Failed requests': 'rising again', 'LB believes': 'C is fine' }}
  changed={['Healthy backends', 'Traffic to C', 'Failed requests', 'LB believes']}
  note="A naive check — 'is the port open?' — passes long before the process can actually serve.">

C's process starts and its port opens. The health check passes immediately and the balancer sends it **a third of production traffic** — while C still has a cold cache, an empty connection pool, and a JIT that has not warmed.

<C color="crimson">C is overwhelmed, fails its checks again, and gets ejected. Then restarts. Then repeats.</C> This is a flapping loop, and it can keep a service degraded indefinitely.

</TraceStep>

<TraceStep
  title="The fix — a readiness check plus slow start"
  state={{ 'Healthy backends': '3 of 3', 'Traffic to C': 'ramped 0→33% over 60 s', 'Failed requests': '0', 'LB believes': 'C is ready' }}
  changed={['Traffic to C', 'Failed requests', 'LB believes']}
  note="Readiness answers 'can I serve?', not 'am I running?'. Slow start gives caches and pools time to fill.">

C's readiness endpoint reports healthy only after it has connected to its database and warmed its pool. The balancer then **ramps** traffic in over 60 seconds rather than all at once.

<H>A health check that only asks "is the port open?" will happily route production traffic to a process that cannot serve a single request.</H>

</TraceStep>

</Trace>

### Designing the check itself

| Do | Don't |
| :--- | :--- |
| <C color="green">Check a dedicated `/health` endpoint that exercises real dependencies</C> | <C color="crimson">Check only that the TCP port accepts connections</C> |
| <C color="green">Separate liveness (restart me) from readiness (route to me)</C> | <C color="crimson">Use one check for both</C> |
| <C color="green">Require N consecutive failures before ejecting</C> | <C color="crimson">Eject on a single timeout</C> |
| <C color="green">Fail readiness when a critical dependency is gone</C> | <C color="crimson">Fail readiness when *any* dependency is degraded</C> |
| <C color="green">Ramp traffic to newly healthy backends</C> | <C color="crimson">Send full share immediately</C> |

That fourth row is a genuine trap worth dwelling on. If every backend's health check calls the database, and the **database** has a bad minute, then *every* backend fails its check simultaneously, the balancer ejects all of them, and <C color="crimson">a slow database becomes a total outage</C>. The health check amplified a partial failure into a complete one.

<C color="green">The rule: a health check should fail when *this instance* is broken, not when a shared dependency is.</C> If the dependency is down, every instance is equally bad — and serving degraded responses beats serving none.

### Connection draining

When you deliberately remove a backend — a deploy, a scale-down — do not cut it off. **Drain** it: stop sending *new* requests, let in-flight ones finish, then shut down. Without draining, every deploy kills every request currently being served on that instance.

---

## 5. The balancer as a single point of failure

You added a load balancer for availability, and created a component whose death takes everything down.

```
  clients ──► [ LB ] ──► servers        one LB = one SPOF
```

Three standard answers, usually combined:

**Redundant balancers with a floating address.** Two balancers, one virtual IP. If the active one dies, the standby claims the IP (VRRP/keepalived). Failover in seconds.

**DNS to multiple balancers.** Return several balancer addresses. Coarse and slow to react — [DNS caching](../02-networking/01-dns.md) means clients keep using a dead one — so it distributes but does not fail over well.

**Anycast.** Announce the same IP from several locations and let BGP route. This is what large providers do, and it is why a managed balancer (ALB, Cloud Load Balancing) is usually the right call: <C color="green">the provider has already solved this, across availability zones, and you have not.</C>

<H>If you are drawing a load balancer as a single box in a design discussion, say out loud that it is replicated. Interviewers notice when the thing you added for availability is itself a single point of failure.</H>

---

## 6. In a design discussion

- **"L7 at the edge so I can route `/api` and `/static` to different pools and retry idempotent requests, L4 in front of the database because it isn't HTTP."** Shows you pick per layer, not by habit.
- **"Least connections rather than round robin — our request durations vary by two orders of magnitude."** Ties the algorithm to a property of the traffic.
- **"Readiness checks the database connection; liveness doesn't. Otherwise a slow database ejects the whole fleet at once."** This one signals real operational experience.
- **"The balancers are a pair with a floating IP, or I'd just use the managed one."** Closes the SPOF you would otherwise be asked about.

---

## Rapid-fire recall

1. Name the four jobs a load balancer does, and say which is most valuable with a single backend.
2. What single question separates L4 from L7?
3. Give three things L7 can do that L4 cannot, and one thing L4 does better.
4. Why is round robin a poor default, and what is usually better?
5. What does "power of two choices" buy you, and why does true least-connections fail across many balancers?
6. Why are sticky sessions a smell, and what is the legitimate exception?
7. Distinguish liveness from readiness, with an example that is one but not the other.
8. Compute detection time for a 5-second interval and a 3-failure threshold.
9. Describe the flapping loop that follows a restart, and the two fixes.
10. Why can a health check that calls the database turn a slow database into a total outage?

<details>
<summary>Answers</summary>

1. **Distribute**, **detect failure**, **decouple** clients from backends, **terminate TLS**. With one backend, **failure detection** still turns a crash into a brief error rather than an outage.
2. **Does it decrypt and read the request?** L4 sees only IP/port/TCP; L7 parses the application protocol.
3. L7 can **route by path/header/cookie**, **retry a failed request**, and **cache responses** (also rate-limit per user, add tracing headers). L4 gives **much higher throughput** and never sees plaintext — better for confidentiality and for non-HTTP protocols.
4. It assumes all requests cost the same, so a 3-second request can be queued ahead of 10 ms ones while another backend idles. **Least connections** is the better default, since open connections approximate current load.
5. Sampling **two** backends at random and taking the less loaded reduces maximum load from `log n / log log n` to `≈ log log n` — an exponential improvement, with almost all the gain coming from the second choice. True least-connections fails across many balancers because each has only a local view, and several balancers can independently pick the same "least loaded" backend and stampede it.
6. They mean a backend holds state that should live elsewhere — causing uneven load, state loss on failure, and blocked autoscaling. The genuine exception is **WebSockets**, where the connection itself is server state.
7. **Liveness** = is the process running (if not, restart it). **Readiness** = can it serve (if not, stop routing to it). A process running but unable to reach its database is **live but not ready** — restarting it would not help, and routing to it produces errors.
8. Interval × threshold = 5 s × 3 = **15 s worst case** before ejection.
9. A restarted instance opens its port, passes a naive check, receives its full traffic share with cold caches and empty pools, gets overwhelmed, fails checks, is ejected, restarts — repeating indefinitely. Fixes: a **readiness check** that reflects real serving capability, and **slow start** ramping traffic in gradually.
10. Because every backend's check fails at the same moment, so the balancer ejects **all** of them and serves nothing. A health check should report whether *this instance* is broken, not whether a shared dependency is — when the dependency is down, degraded responses beat no responses.

</details>

---

**Next:** [Reverse Proxies & API Gateways](./02-reverse-proxy-and-api-gateway.md) — the box in front of the box, and what else it can usefully do.
