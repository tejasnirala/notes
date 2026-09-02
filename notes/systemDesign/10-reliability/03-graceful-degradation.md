---
title: Graceful Degradation
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Graceful Degradation

> **What you will be able to do after this page**
>
> - Rank features so the system sheds the right ones first.
> - Design fallbacks that are genuinely useful rather than error pages.
> - Use feature flags as a reliability mechanism, not just a release one.
> - Explain why a degraded response usually beats a correct error.

<C color="orange">Most outages are not total.</C> One dependency is down, and the question is whether that takes everything with it — which is a design decision, made in advance or by accident.

<Plain>

A restaurant's dessert freezer breaks during service.

**The catastrophic response:** close the restaurant. Nobody eats. Every table is turned away because one part of the menu is unavailable.

**The sensible response:** cross desserts off the menu and keep serving. Most people came for dinner. A few are disappointed. <C color="green">The evening continues.</C>

Obvious in a restaurant, and software does the first thing constantly — a recommendations service fails and the entire product page returns an error, because the code fetched recommendations and did not consider what to do if it could not.

There is a second, better move available. The freezer is broken, but there is ice cream in the back that was made this morning. It is not today's menu, and it is <C color="green">much better than nothing</C>. Serving slightly stale dessert beats serving no dessert, and it certainly beats closing.

<H>Both responses require deciding in advance which parts of the menu are essential and which are not. A kitchen that has never asked that question can only stop entirely.</H>

</Plain>

---

## 1. Rank your features first

You cannot degrade gracefully without knowing what matters. Do this before an incident, not during one.

| Tier | Meaning | Example (e-commerce) |
| :--- | :--- | :--- |
| **Critical** | The system is pointless without it | Browse products, add to cart, checkout |
| **Important** | Noticeably worse without it | Search, order history, saved addresses |
| **Nice to have** | Most users would not notice | Recommendations, "recently viewed", reviews summary |
| **Invisible** | Only you notice | Analytics events, A/B assignment, telemetry |

<C color="green">Under pressure, shed from the bottom.</C> The design consequence is that <C color="crimson">a nice-to-have dependency must never be able to fail a critical path</C> — which means it needs a timeout, a fallback, and often to be loaded asynchronously rather than inline.

<Jargon
  plain="Continuing to work with reduced functionality instead of failing completely."
  term="graceful degradation"
  also={['fallbacks', 'degraded mode', 'brownout']}>

Related but distinct from **load shedding**, which drops *requests* to protect capacity. Degradation drops *features* to protect the core experience. <C color="green">A well-designed system does both, at different layers.</C>

</Jargon>

---

## 2. Fallbacks that are actually useful

A fallback is what you serve when the real answer is unavailable. Ranked by value:

| Fallback | Quality |
| :--- | :--- |
| **Stale cached data** | <C color="green">Best — usually indistinguishable to the user</C> |
| **A simpler computation** | <C color="green">Very good</C> — trending instead of personalised |
| **A static default** | <C color="green">Good</C> — a default image, a standard shipping estimate |
| **Empty but valid** | <C color="orange">Acceptable</C> — hide the section entirely |
| **A partial response** | <C color="orange">Acceptable</C> — return what you have, flag what is missing |
| **An error** | <C color="crimson">Last resort</C> |

<Trace title="A product page during a partial outage" subtitle="Four dependencies, two of them down. Watch what the user gets.">

<TraceStep
  title="Everything healthy"
  state={{ 'Product': 'live', 'Price': 'live', 'Recommendations': 'live', 'Reviews': 'live', 'User sees': 'full page' }}
  note="The normal case. Four calls, all succeeding.">

Product details, current price, personalised recommendations, and review summary all load.

</TraceStep>

<TraceStep
  title="Recommendations service fails — naive handling"
  cost="whole page down"
  state={{ 'Product': 'live', 'Price': 'live', 'Recommendations': 'FAILED', 'Reviews': 'live', 'User sees': '500 error' }}
  changed={['Recommendations', 'User sees']}
  note="A nice-to-have feature just prevented every sale on this page.">

The exception propagates. <C color="crimson">A tier-3 dependency has taken down a tier-1 page</C>, and the user cannot buy anything.

</TraceStep>

<TraceStep
  title="With a fallback"
  state={{ 'Product': 'live', 'Price': 'live', 'Recommendations': 'trending (cached)', 'Reviews': 'live', 'User sees': 'full page' }}
  changed={['Recommendations', 'User sees']}
  note="Most users cannot tell the difference — personalised versus popular is not an obvious downgrade.">

On failure, serve a cached list of **trending products** instead of personalised ones.

<C color="green">The page renders completely. Conversion is essentially unaffected.</C>

</TraceStep>

<TraceStep
  title="Reviews service also fails"
  state={{ 'Product': 'live', 'Price': 'live', 'Recommendations': 'trending', 'Reviews': 'section hidden', 'User sees': 'page, minus reviews' }}
  changed={['Reviews', 'User sees']}
  note="Hiding a section is a legitimate fallback — better than an error block where content should be.">

No cached reviews are available, so the section is **omitted entirely** rather than showing an error box.

</TraceStep>

<TraceStep
  title="Now the price service fails"
  cost="cannot degrade"
  state={{ 'Product': 'live', 'Price': 'FAILED', 'Recommendations': 'trending', 'Reviews': 'hidden', 'User sees': 'error — correctly' }}
  changed={['Price', 'User sees']}
  note="Some things genuinely cannot be faked. Showing a stale price risks selling at the wrong one.">

<C color="crimson">A stale price is worse than no page</C> — you could sell at the wrong price, or be legally obliged to honour it.

<C color="green">This is the correct place to fail.</C> Show an honest error for this product and keep the rest of the site working.

</TraceStep>

<TraceStep
  title="The principle"
  state={{ 'Tier 1 down': 'fail honestly', 'Tier 2 down': 'degrade or hide', 'Tier 3 down': 'silent fallback', 'Blast radius': 'one page, not the site' }}
  changed={['Tier 1 down', 'Tier 2 down', 'Tier 3 down', 'Blast radius']}
  note="Every dependency needs an answer to 'what do we show if this is unavailable?' — decided at design time.">

<H>Degradation is not "never show errors". It is deciding, per dependency, what the honest best response is when it fails — and making sure a low-tier failure can never produce a high-tier one.</H>

</TraceStep>

</Trace>

---

## 3. Techniques

**Feature flags as a reliability control.** A flag that disables an expensive feature under load is an incident tool, not just a release tool. <C color="green">Being able to turn off recommendations, or search suggestions, in ten seconds is often the fastest available mitigation.</C> Keep a documented list of "things we can turn off", and make sure the flag system itself does not depend on what is failing.

**Read-only mode.** When the write path is broken, serving reads is far better than serving nothing. Most users on most visits are reading. Design for it explicitly: a flag that rejects writes with an honest message while reads continue.

**Static fallback pages.** A pre-rendered version served from a CDN when the origin is unreachable, via `stale-if-error`. Users get *something* — often enough to keep them from leaving.

**Asynchronous loading of non-critical content.** Render the page with the critical content, and load recommendations and reviews after. A tier-3 failure then cannot delay or block the first render, <C color="green">turning a hard dependency into a soft one at the architecture level.</C>

**Queue writes when the database is down.** For non-transactional writes — analytics, activity logs, notifications — accept and buffer rather than reject. <C color="crimson">Never for anything the user is told succeeded and must be durable.</C>

<Depth title="Degraded and lying: when a fallback is worse than an error">

Degradation is not universally correct. Some fallbacks are actively harmful, and shipping one is worse than failing honestly.

**When a fallback must not be used:**

**1. When staleness has financial or legal consequences.** A stale price may bind you to a sale. A stale account balance may allow an overdraft. A stale inventory count oversells. <C color="crimson">"Approximately right" is not a category that exists for money.</C>

**2. When the fallback is a security decision.** An authorisation service that is unreachable must **deny**, not allow. A fallback of "assume permitted" is a vulnerability, and it is a genuinely tempting one to write during an incident.

Note this is the one place where **fail closed** is correct without argument — availability is not the priority when the alternative is unauthorised access.

**3. When the user will act on wrong information.** Showing a delivery estimate from a cache that no longer reflects reality is worse than showing none: the user makes a decision on false information and blames you when it is wrong. <C color="green">An honest "we can't calculate this right now" preserves trust; a confident wrong answer destroys it.</C>

**4. When degradation is silent and permanent.** The dangerous case: a fallback works so well that nobody notices it engaged. Recommendations have been serving the trending list for three weeks because a config change broke the personalisation call, and no alert fired because <C color="crimson">the page renders fine and every metric is green.</C>

This is the most common failure of degradation as a practice. The mitigations:

- **Alert on fallback rate**, not just on errors. A fallback firing more than a small fraction of the time is an incident.
- **Label degraded responses** in telemetry, so dashboards distinguish "served" from "served properly".
- **Show it in the UI** where honest — "showing popular items" rather than silently substituting.
- **Track business metrics**, not just technical ones. Conversion falling 4% with no errors is exactly what silent degradation looks like.

**5. When degradation hides an outage from your own monitoring.** If every dependency has a fallback and every fallback is silent, your availability SLI reports 100% while users get a progressively emptier product. <C color="orange">Define the SLI on the *quality* of responses, not merely on their status codes</C> — a `200` carrying a degraded payload is not a fully successful request.

<H>The rule: degrade when the fallback is honestly useful, fail when it would mislead — and always make degradation visible, because a fallback nobody notices is a bug that lives forever.</H>

</Depth>

---

## 4. In a design discussion

- **"Recommendations get a 200 ms timeout and fall back to a cached trending list — a tier-3 dependency must never be able to fail the buy button."** Tier thinking, applied.
- **"Price has no fallback. A stale price is worse than an error, so we fail honestly for that product and keep the rest of the site up."** Knows where degradation stops.
- **"Read-only mode when the write path is down — most visits are reads, so we keep serving most of the value."** A high-value mode most systems lack.
- **"Alert on fallback rate. A fallback that works silently for three weeks is a bug nobody finds."** The failure of degradation as a practice.

---

## Rapid-fire recall

1. Give the four feature tiers, and the design rule that follows.
2. Distinguish graceful degradation from load shedding.
3. Rank six fallback types from best to worst.
4. In the product page trace, why was hiding the reviews section acceptable?
5. Why did price have no fallback?
6. How do feature flags act as a reliability mechanism, and what must be true of the flag system?
7. What is read-only mode, and why is it high value?
8. How does asynchronous loading turn a hard dependency into a soft one?
9. Give three situations where a fallback is worse than an error.
10. Why is silent degradation dangerous, and give three mitigations.

<details>
<summary>Answers</summary>

1. **Critical** · **important** · **nice to have** · **invisible**. The rule: <H>a lower-tier dependency must never be able to fail a higher-tier path</H> — so it needs a timeout, a fallback, and often asynchronous loading.
2. **Load shedding** drops *requests* to protect capacity. **Degradation** drops *features* to protect the core experience. Good systems do both, at different layers.
3. **Stale cached data** → **a simpler computation** → **a static default** → **empty but valid** → **a partial response** → **an error** (last resort).
4. Because reviews are a lower tier, and **omitting a section is less harmful than an error box** where content should be — the page still renders and the user can still buy.
5. Because a **stale price has financial and legal consequences** — you could sell at the wrong price or be obliged to honour it. Some values cannot be approximately right.
6. A flag that disables an expensive feature is often the **fastest available mitigation** during an incident. The flag system must **not depend on whatever is failing**, or it is unavailable exactly when needed.
7. Rejecting writes with an honest message while **reads continue**. High value because **most users on most visits are reading**, so it preserves most of the product's value during a write-path outage.
8. Rendering the page with critical content first and loading non-critical content afterwards means a tier-3 failure **cannot delay or block the first render** — it can only leave a section empty.
9. **Staleness with financial or legal consequences** (prices, balances, inventory) · **security decisions** (an unreachable auth service must deny, not allow) · **when the user will act on wrong information** (a stale delivery estimate) · **when degradation is silent and permanent**.
10. Because the system looks healthy — pages render, status codes are `200`, dashboards are green — while users get a progressively worse product. Mitigations: **alert on fallback rate**, **label degraded responses in telemetry**, **show degradation in the UI**, and **track business metrics** like conversion alongside technical ones.

</details>

---

**Next:** [Disaster Recovery](./04-disaster-recovery.md) — planning for the failures that redundancy does not cover.
