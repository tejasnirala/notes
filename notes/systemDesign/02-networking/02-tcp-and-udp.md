---
title: TCP & UDP
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# TCP & UDP

> **What you will be able to do after this page**
>
> - Trace the three-way handshake and say exactly what it costs in round trips.
> - Explain congestion control and slow start well enough to know why a new connection is slow.
> - Name head-of-line blocking and say at which layer it occurs.
> - Choose between TCP and UDP from requirements, and know what QUIC changed.

TCP is the substrate under almost everything you design. Most of its behaviour is invisible until you are debugging a latency problem, at which point it explains the whole thing.

<Plain>

There are two ways to send someone a message.

**A phone call.** You dial, they pick up, you both say hello, and only then do you start talking. You know they heard you, because they respond. If the line crackles you say "sorry, repeat that?" You hang up at the end. Setting it up takes effort, but nothing gets lost and everything arrives in the order you said it.

**A postcard.** You write it, post it, and hope. No setup, no confirmation, no way to know it arrived. Send five and they may arrive out of order, or four may arrive and one may not.

That is exactly TCP and UDP. TCP is the phone call — reliable and ordered, at the cost of a greeting before every conversation. UDP is the postcard — no guarantees, no waiting.

The postcard sounds strictly worse, and for most things it is. But consider a live video call: if one frame of video goes missing, you do **not** want the system to stop and re-request it. By the time it arrives the conversation has moved on. <C color="green">Skipping the lost frame is better than delivering it late.</C> That is the one situation where "no guarantees" is the right answer — and it is why both protocols exist.

</Plain>

---

## 1. What TCP gives you

Four guarantees, and <C color="orange">every one of them is paid for in round trips</C>:

| Guarantee | Mechanism | Cost |
| :--- | :--- | :--- |
| **Delivery** | Every byte is acknowledged; unacked data is retransmitted | Waiting for ACKs |
| **Ordering** | Sequence numbers; the receiver reassembles in order | Head-of-line blocking |
| **Integrity** | Checksums | Negligible |
| **Flow control** | The receiver advertises a window; the sender respects it | Throughput capped by window ÷ RTT |
| **Congestion control** | The sender infers network capacity from loss and delay | A slow start on every new connection |

UDP gives you none of these. It gives you: *here is a datagram, it might arrive*. That sounds useless until you notice that <C color="green">some applications can recover from loss better than TCP can</C> — a dropped audio frame is better skipped than retransmitted 200 ms late.

---

## 2. The three-way handshake

```
   CLIENT                                  SERVER
     │                                       │
     │──────── SYN, seq=x ──────────────────►│   "let's talk; my seq starts at x"
     │                                       │
     │◄─────── SYN-ACK, seq=y, ack=x+1 ──────│   "ok; mine starts at y"
     │                                       │
     │──────── ACK, ack=y+1 ────────────────►│   "confirmed"
     │                                       │
     │═══════ data can now flow ════════════►│
     │                                       │
                 cost: 1 full RTT before the first byte of data
```

**One RTT.** On a 150 ms transcontinental link, <C color="crimson">that is 150 ms spent before you have sent a single byte of your request</C> — and TLS then adds its own (see [TLS](./03-tls.md)).

Two consequences that dominate real systems:

<Jargon
  plain="The short greeting two machines exchange before any real data flows."
  term="the three-way handshake"
  also={['connection setup', 'SYN / SYN-ACK / ACK']}>

*"That's an extra round trip for the handshake"* is a normal sentence in a design review. The thing being counted is <C color="orange">setup cost you pay per connection, not per request</C> — which is exactly why connection pooling matters so much.

</Jargon>

**Connection reuse is the highest-value optimisation available.** HTTP keep-alive, connection pools in your database driver, HTTP/2 multiplexing — all of them exist to amortise this handshake. <H>A connection pool is not a micro-optimisation; it removes a full round trip from every request.</H>

**Closing costs too.** The four-way `FIN`/`ACK` teardown leaves the closing side in `TIME_WAIT` for 2× the maximum segment lifetime (typically 60 s on Linux), holding the port. A server churning short-lived connections can <C color="crimson">exhaust its ephemeral port range and start refusing connections while looking completely idle</C> — a classic and confusing production failure.

---

## 3. Congestion control, and why new connections are slow

TCP does not know the network's capacity. It **discovers** it, by increasing the send rate until something is lost.

### Slow start

The sender keeps a **congestion window** (`cwnd`) — how many bytes may be in flight unacknowledged. It begins small (typically 10 segments, ~14 KB) and **doubles every RTT**.

Watch a 200 KB response being delivered over a brand-new connection on a 150 ms link — with unlimited bandwidth available the whole time.

<Trace title="Why a fast link delivers 200 KB slowly" subtitle="Cold connection, 150 ms RTT, gigabit link. Bandwidth is never the constraint here.">

<TraceStep
  title="Handshake — before any data"
  cost="+150 ms"
  state={{ 'Elapsed': '150 ms', 'Window (cwnd)': '—', 'Sent so far': '0 KB', 'Remaining': '200 KB', 'Link utilised': '0%' }}
  changed={['Elapsed']}
  note="One round trip spent agreeing to talk.">

SYN → SYN-ACK → ACK. The connection exists; nothing has been transferred.

</TraceStep>

<TraceStep
  title="Round trip 1 — the sender starts tiny"
  state={{ 'Elapsed': '300 ms', 'Window (cwnd)': '~14 KB', 'Sent so far': '14 KB', 'Remaining': '186 KB', 'Link utilised': '~0.1%' }}
  changed={['Elapsed', 'Window (cwnd)', 'Sent so far', 'Remaining', 'Link utilised']}
  note="The sender has no idea how much the network can take, so it starts conservatively and finds out.">

TCP sends ~10 packets (~14 KB) and **stops**, waiting for acknowledgement. It is not allowed to send more until it hears back.

</TraceStep>

<TraceStep
  title="Round trip 2 — the window doubles"
  state={{ 'Elapsed': '450 ms', 'Window (cwnd)': '~28 KB', 'Sent so far': '42 KB', 'Remaining': '158 KB', 'Link utilised': '~0.2%' }}
  changed={['Elapsed', 'Window (cwnd)', 'Sent so far', 'Remaining']}
  note="Every acknowledgement is evidence the network coped, so the sender doubles its bet.">

Acknowledgements arrive, nothing was lost, so the allowance doubles.

</TraceStep>

<TraceStep
  title="Round trips 3 and 4 — doubling continues"
  state={{ 'Elapsed': '750 ms', 'Window (cwnd)': '~112 KB', 'Sent so far': '210 KB', 'Remaining': '0 KB', 'Link utilised': '~1%' }}
  changed={['Elapsed', 'Window (cwnd)', 'Sent so far', 'Remaining', 'Link utilised']}
  note="Five round trips, ~750 ms, on a link that could have moved this in under a millisecond.">

28 → 56 → 112 KB. The transfer completes.

<H>Bandwidth was never the limit. The limit was how many round trips it took the sender to learn it was allowed to go faster.</H>

</TraceStep>

<TraceStep
  title="Now reuse the connection"
  cost="−600 ms"
  state={{ 'Elapsed': '~150 ms', 'Window (cwnd)': 'already ~112 KB', 'Sent so far': '200 KB', 'Remaining': '0 KB', 'Link utilised': '~1%' }}
  changed={['Elapsed', 'Window (cwnd)', 'Sent so far']}
  note="This is what a connection pool actually buys: no handshake, and a window that has already grown.">

The second request on the **same** connection skips the handshake *and* inherits the grown window. One round trip instead of five.

<C color="green">Same code, same network, ~5× faster — purely from not throwing the connection away.</C>

</TraceStep>

</Trace>

```
  RTT 1:  ~14 KB in flight
  RTT 2:  ~28 KB
  RTT 3:  ~56 KB
  RTT 4:  ~112 KB
  RTT 5:  ~224 KB
```

<H>A brand-new TCP connection cannot send a 200 KB response in one round trip, no matter how much bandwidth exists. It needs four or five.</H>

This is why bandwidth is often not the constraint. On a 150 ms RTT link, delivering 200 KB over a cold connection takes ~5 RTTs ≈ **750 ms**, on a connection that could theoretically stream it in milliseconds. And it is another argument for connection reuse: <C color="green">a warm connection has already grown its window</C>.

### After slow start

Once loss occurs, TCP switches to **congestion avoidance** — additive increase, multiplicative decrease. Grow the window by one segment per RTT; halve it on loss.

<Depth title="AIMD, and why the window doubles up but halves down">

TCP's congestion control is **AIMD** — additive increase, multiplicative decrease — and the asymmetry is deliberate, not arbitrary.

After slow start, the sender adds roughly one segment per round trip (additive increase) and, on detecting loss, **halves** the window (multiplicative decrease). Why not increase and decrease symmetrically?

Because AIMD is the only simple rule that converges to a **fair and stable** share when many independent senders compete for one bottleneck, with no coordination between them. Chiu and Jain proved this in 1989. Sketch the intuition with two senders on one link:

- If both increase *multiplicatively*, their ratio never changes — an unfair split stays unfair forever.
- If both increase *additively*, the absolute gap stays fixed while the total grows, so the **ratio** moves toward 1:1.
- Decreasing multiplicatively shrinks the larger sender's share by more in absolute terms, pulling them together faster.

Additive-increase/multiplicative-decrease therefore walks the system toward equal shares and keeps it there, oscillating gently around the bottleneck capacity. That sawtooth you see in throughput graphs is not a defect; it is the algorithm probing for more capacity and backing off when it overshoots.

**Where the assumption breaks.** AIMD infers congestion from **loss**. On a wired link that inference is sound — packets are dropped because a queue overflowed. On a wireless or mobile link, packets are also lost to **radio interference**, which has nothing to do with congestion. Classic TCP responds by halving its window anyway, so <C color="crimson">a lossy-but-fast mobile link gets treated as a congested one and throughput collapses</C>.

That is precisely the gap **BBR** targets: instead of treating loss as the signal, it continuously estimates the bottleneck bandwidth and the minimum round-trip time, and paces sending to match the bandwidth-delay product directly. On clean links it behaves similarly to CUBIC; on lossy links it can be several times faster. The trade-off is that BBR can be aggressive toward loss-based flows sharing the same bottleneck, which is why its fairness behaviour has been a live area of tuning across versions.

</Depth>

Modern stacks mostly run **CUBIC** (window growth as a cubic function of time since the last loss — better on high-bandwidth, high-latency links) or **BBR** (Google's, which models bottleneck bandwidth and RTT directly rather than treating loss as the only signal — <C color="orange">substantially better on lossy links like mobile networks, where loss is often not congestion at all</C>).

### Bandwidth-delay product

The ceiling on a single connection's throughput:

```
  max throughput  =  window size ÷ RTT

  64 KB window, 100 ms RTT   →  640 KB/s ≈ 5 Mbps
```

<C color="crimson">A gigabit link delivers 5 Mbps on one connection if the window is small and the RTT is large.</C> Window scaling (RFC 1323) lifts the 64 KB limit, and it is why bulk transfers over long links use large windows or many parallel connections.

---

## 4. Head-of-line blocking

The cost of TCP's ordering guarantee, and a term worth being precise about because it happens at two different layers.

```
  Sender transmits:   [1] [2] [3] [4] [5]
  Packet [3] is lost.

  Receiver holds:     [1] [2]  ??  [4] [5]
                                ▲
        [4] and [5] have ARRIVED, sitting in the kernel buffer —
        but TCP must deliver bytes in order, so the application
        sees nothing until [3] is retransmitted (one full RTT).
```

<H>Head-of-line blocking is TCP delivering data late that has already arrived, because something earlier in the stream has not.</H>

**Two layers, two different problems:**

| Layer | Problem | Fixed by |
| :--- | :--- | :--- |
| **HTTP/1.1** | One request per connection at a time; a slow response blocks the ones behind it | HTTP/2 multiplexing |
| **TCP** | One lost packet stalls *every* multiplexed stream on that connection | <C color="green">QUIC</C> — independent streams over UDP |

This is the specific reason HTTP/2 did not deliver everything it promised: it removed HTTP-layer blocking but left all its streams sharing one TCP connection, so <C color="crimson">a single lost packet stalls every stream at once</C> — sometimes worse than HTTP/1.1's six parallel connections on a lossy network. [HTTP/3](./04-http-evolution.md) fixes it by moving to UDP.

---

## 5. UDP, and when it is right

UDP is a thin wrapper over IP: source port, destination port, length, checksum. No connection, no ordering, no retransmission, no congestion control.

That last omission matters: <C color="crimson">UDP will happily saturate a link and cause congestion collapse for everyone else unless your application implements its own rate control</C>. Anything serious built on UDP re-implements the parts of TCP it needs.

**Where UDP is the right choice:**

| Use case | Why |
| :--- | :--- |
| **Video/voice calls** | A late frame is worthless. <C color="green">Skipping beats retransmitting.</C> |
| **Game state updates** | Position 60 is obsolete once 61 arrives — do not resend it |
| **DNS** | One small query, one small reply. A handshake would cost more than the query |
| **Metrics (StatsD)** | Losing 0.1% of samples is irrelevant; blocking the app is not |
| **QUIC / HTTP/3** | Builds better guarantees than TCP's *on top of* UDP, in user space |

### Why QUIC is on UDP

Not because UDP is better — because <C color="orange">TCP is implemented in the kernel and in middleboxes, so it cannot be changed</C>. Deploying a new transport protocol means waiting a decade for OS upgrades and firewall vendors. Building on UDP puts the transport in **user space**, where it ships with the application and can evolve on a normal release cycle.

QUIC then reimplements, better:

- <C color="green">Streams that are genuinely independent</C> — loss in one does not stall the others
- <C color="green">Handshake and encryption merged</C> — 1 RTT to first byte, 0-RTT on resumption
- <C color="green">Connection IDs instead of the 4-tuple</C> — a connection survives a network change, so a phone moving from WiFi to cellular keeps its session

---

## 6. What this means for design

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| First request slow, rest fast | Handshake + slow start | <C color="green">Connection pooling; keep-alive</C> |
| Throughput far below link capacity | Bandwidth-delay product; small window | Window scaling; parallel connections; move data closer |
| Latency spikes on mobile only | Loss treated as congestion by CUBIC | BBR; or QUIC |
| One slow resource stalls a whole page | Head-of-line blocking | HTTP/2 for the HTTP layer; HTTP/3 for the TCP layer |
| "Connection refused" while CPU is idle | <C color="crimson">Ephemeral port exhaustion from `TIME_WAIT`</C> | Reuse connections; tune port range |
| Cross-region calls dominate p99 | 1 RTT handshake + 1 RTT TLS + slow start | Terminate at the edge; keep persistent pools |

<H>Almost every TCP-related performance problem is solved by the same two moves: make fewer connections, and keep the ones you have alive.</H>

---

## Rapid-fire recall

1. Name TCP's five guarantees and the cost of each.
2. How many round trips does the handshake cost before the first data byte?
3. What is `TIME_WAIT`, and what production failure does it cause?
4. What is slow start, and how long does it take to reach ~200 KB in flight?
5. Give the formula for a single connection's maximum throughput, and compute it for a 64 KB window at 100 ms RTT.
6. Define head-of-line blocking precisely.
7. At which two layers does it occur, and what fixes each?
8. Why did HTTP/2's multiplexing not fully deliver on lossy networks?
9. Give three cases where UDP is the correct choice and say what they have in common.
10. Why is QUIC built on UDP rather than replacing TCP?

<details>
<summary>Answers</summary>

1. **Delivery** (ACKs and retransmission — waiting), **ordering** (sequence numbers — head-of-line blocking), **integrity** (checksums — negligible), **flow control** (receiver window — throughput capped at window ÷ RTT), **congestion control** (inferred capacity — slow start on every new connection).
2. **One full RTT** (SYN → SYN-ACK → ACK, with data able to ride the third packet). On a 150 ms link that is 150 ms before any request byte is sent.
3. The state a closing socket holds for ~2× the maximum segment lifetime (~60 s on Linux) to absorb stray packets. A server churning short-lived connections can **exhaust its ephemeral ports** and refuse connections while appearing idle.
4. The congestion window starts at ~10 segments (~14 KB) and **doubles every RTT**. Reaching ~200 KB in flight takes **4–5 RTTs** — ~750 ms on a 150 ms link.
5. `throughput = window ÷ RTT`. 64 KB ÷ 0.1 s = **640 KB/s ≈ 5 Mbps**, regardless of how fast the link is.
6. Data that has **already arrived** is withheld from the application because something earlier in the ordered stream has not arrived yet.
7. **HTTP/1.1** — one in-flight request per connection; fixed by HTTP/2 multiplexing. **TCP** — one lost packet stalls all multiplexed streams; fixed by QUIC/HTTP/3's independent streams over UDP.
8. Because all HTTP/2 streams share **one TCP connection**. A single lost packet stalls every stream at once — sometimes worse than HTTP/1.1's six independent connections on a lossy link.
9. Voice/video (a late frame is worthless), game state (newer updates supersede older), DNS (one small query/reply), metrics (sampling loss is acceptable). Common thread: **stale data is worse than missing data**, or the handshake costs more than the payload.
10. Because TCP lives in the **kernel and in middleboxes** and effectively cannot be changed — a new transport would take a decade to deploy. UDP puts the transport in **user space**, shipping with the application and evolving on its release cycle.

</details>

---

**Next:** [TLS](./03-tls.md) — the second round trip, what encryption actually guarantees, and where to terminate it.
