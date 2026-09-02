---
title: Cloudflare, July 2019
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Cloudflare, July 2019

> **What happened:** A regular expression deployed to Cloudflare's WAF caused catastrophic backtracking, consuming CPU across the global fleet and taking traffic offline for roughly 30 minutes.
>
> *Source: Cloudflare's published incident analysis, 2 July 2019.*

<C color="orange">The clearest case study on deployment blast radius</C>: a small, correct-looking change reaching every machine on the planet within seconds.

<Plain>

A security firm gives every branch office a list of suspicious phrases to check post against.

The list is updated centrally and pushed out — sensibly, because when a new threat appears you want every branch protected immediately, not next week.

One day a new phrase is added. It looks like all the others. On the test post used to check it, it works fine.

Then it reaches the branches. On certain real letters, checking that one phrase makes a clerk try **an astronomical number of combinations** before concluding anything. Not a few hundred — a number they will not finish this century.

Every clerk in every branch is now stuck on that one check. <C color="crimson">No post moves anywhere.</C>

Two things made this bad rather than annoying.

**The list went everywhere at once.** No branch got it first while the others waited, so there was no moment where a few offices stopped and someone noticed.

**And the same list controls the internal systems**, so the tools for pushing a corrected list were themselves affected by the problem they were needed to fix.

<H>The change was small and looked safe. What made it an outage was that it was applied globally and instantly, with nothing between the person who wrote it and every machine in the world.</H>

</Plain>

---

## 1. What catastrophic backtracking is

<Jargon
  plain="A regular expression that, on certain inputs, tries an exponentially large number of ways to match before giving up."
  term="catastrophic backtracking"
  also={['ReDoS', 'regular expression denial of service']}>

Backtracking engines try alternatives when a match fails. <C color="crimson">Certain patterns — nested quantifiers over overlapping alternatives — produce a number of paths that grows exponentially with input length.</C> A 30-character input can require billions of steps.

</Jargon>

The classic shape is nested quantification over a set that can match the same text more than one way:

```
  (a+)+$        against "aaaaaaaaaaaaaaaaaaaaX"

  The engine must try every way of splitting the a's between the
  inner and outer quantifier before concluding there is no match.
  Each additional 'a' doubles the work.
```

The pattern in the Cloudflare incident was a normal-looking expression containing a `.*` between other quantified constructs — <C color="orange">visually unremarkable and computationally explosive on the right input.</C>

<C color="green">The structural defence is an engine that cannot backtrack.</C> RE2 and Rust's `regex` crate guarantee linear time by refusing patterns whose matching cost cannot be bounded — they do not support backreferences and lookaround, which is exactly what makes the guarantee possible.

---

## 2. The chain

<Trace title="From one rule to a global outage" subtitle="Each link is normal practice.">

<TraceStep
  title="A new WAF rule is written"
  state={{ 'Change': 'one regex added', 'Review': 'passed', 'Tested': 'on sample input', 'Risk assessed as': 'low' }}
  changed={['Change', 'Tested', 'Risk assessed as']}
  note="Correctly reviewed and tested for correctness. Nobody tested it for worst-case runtime, which is not a habit most teams have.">

A managed rule intended to catch a class of attack. It matches what it should on the inputs it was tried against.

</TraceStep>

<TraceStep
  title="Deployed globally, immediately"
  cost="no staging in traffic"
  state={{ 'Rollout': 'global, seconds', 'Canary': 'none for this path', 'Machines affected': 'all', 'Risk assessed as': 'low' }}
  changed={['Rollout', 'Canary', 'Machines affected']}
  note="Fast global deployment is a feature for security rules — a new threat should be blocked everywhere at once.">

<C color="orange">Security rules are deliberately deployed fast</C>, because slow rollout means unprotected customers.

</TraceStep>

<TraceStep
  title="CPU saturates on every machine"
  cost="global"
  state={{ 'CPU': '100% on all cores', 'Traffic served': 'none', 'Machines affected': 'all', 'Detection': 'immediate' }}
  changed={['CPU', 'Traffic served', 'Detection']}
  note="Not a crash — the processes were alive and busy, which is a harder failure to reason about than a crash.">

The regex consumed all available CPU. <C color="crimson">Requests were not rejected; they were never processed.</C>

</TraceStep>

<TraceStep
  title="The remediation path is affected too"
  cost="slowed recovery"
  state={{ 'Internal tools': 'behind the same infrastructure', 'Access to push a fix': 'degraded', 'Time to mitigate': 'extended' }}
  changed={['Internal tools', 'Access to push a fix', 'Time to mitigate']}
  note="The same circular-dependency lesson as the S3 dashboard, in a different form.">

<C color="crimson">The systems needed to deploy a correction were themselves behind the affected infrastructure.</C>

</TraceStep>

<TraceStep
  title="Global kill switch"
  state={{ 'Action': 'disable the WAF globally', 'Traffic': 'restored', 'Protection': 'temporarily off', 'Duration': '~30 minutes total' }}
  changed={['Action', 'Traffic', 'Protection', 'Duration']}
  note="A pre-existing global kill switch was what made a fast recovery possible at all.">

<C color="green">Disabling the entire WAF restored traffic</C>, accepting reduced security temporarily.

<H>The recovery depended on a mechanism that existed *before* the incident: the ability to turn a whole subsystem off globally, quickly, without a deploy.</H>

</TraceStep>

</Trace>

---

## 3. What transfers

<Depth title="Blast radius, the tension with security velocity, and bounding untrusted computation">

**1. Global instant deployment is the root cause, not the regex.** A bad regex reaching 1% of machines is an alert. Reaching 100% within seconds is an outage. <C color="green">The regex was the trigger; the deployment model was the cause.</C>

The standard mitigations — [staged rollout, canary, automatic rollback](../13-observability/03-deployment-strategies.md) — apply to **configuration and rules**, not only to code. <C color="crimson">Config and rule changes routinely bypass every safeguard that code changes have</C>, which is why they cause a disproportionate share of large outages.

**2. And there is a genuine tension here worth stating honestly.** Security rules are deployed fast **for good reasons**: a new attack should be blocked everywhere immediately, and a staged rollout means some customers are unprotected while it proceeds.

<C color="orange">This is a real conflict between two safety properties, not an oversight.</C> The resolution is not "always stage everything" but:

- **Stage by default**, with an explicit fast path for genuine emergencies.
- **Make the fast path require justification** and generate a record, so it is used when warranted rather than by habit.
- **Automate rollback on health signals**, so even a fast rollout self-corrects within seconds — which is what actually bounds the damage when staging is skipped.

**3. Untrusted or unbounded computation needs a bound, not just review.** The deeper issue is that a rule engine executed a computation whose cost was **unbounded and not obvious from inspection**.

Defences, in increasing order of strength:

| Defence | Strength |
| :--- | :--- |
| Review the pattern | <C color="crimson">Weak — the dangerous shape is not visually distinctive</C> |
| Test for correctness | <C color="crimson">Weak — worst-case inputs are rarely in the test set</C> |
| Static analysis for backtracking risk | Moderate — catches known shapes |
| **CPU or step budget per evaluation** | <C color="green">Strong — bounds any pattern</C> |
| **A non-backtracking engine (RE2)** | <C color="green">Strongest — makes the class impossible</C> |

<H>The pattern is the same as [injection](../12-security/04-common-attacks.md): a defence that must identify every dangerous input will eventually fail, while a defence that bounds what is structurally possible cannot.</H>

Cloudflare's own follow-up included both — a CPU budget per rule evaluation, and moving toward engines with linear-time guarantees.

**4. Kill switches must exist before you need them.** The recovery was fast because a **global WAF disable** already existed. Building one during an incident, on infrastructure that is itself degraded, is not feasible.

<C color="green">Every subsystem that could plausibly cause an outage should have a tested way to turn it off</C>, and the switch must not depend on the subsystem it disables. Keep a documented list of what can be disabled and what each costs — during an incident, knowing *"we can turn off recommendations, search suggestions and the WAF"* is worth more than any dashboard.

**5. "100% CPU, alive, serving nothing" is a distinct failure mode.** Processes were healthy by liveness checks and doing no useful work. <C color="orange">This is the [gray failure](../10-reliability/01-failure-and-redundancy.md) again</C>, and it is why saturation belongs among the golden signals — an error-rate-only view would show nothing wrong for some time, because there were no errors, only requests that never completed.

</Depth>

---

## Rapid-fire recall

1. What is catastrophic backtracking, and what pattern shape causes it?
2. Why is reviewing a regex a weak defence against it?
3. What made this a global outage rather than a local alert?
4. Why are security rules deliberately deployed fast, and what tension does that create?
5. How is that tension resolved without abandoning either property?
6. Why did the remediation path itself slow recovery?
7. What made fast recovery possible, and when must it be built?
8. Rank the defences against unbounded pattern evaluation.
9. What is structurally guaranteed by a non-backtracking engine, and what does it give up?
10. Why would an error-rate-only monitoring view have missed this initially?

<details>
<summary>Answers</summary>

1. A regex that tries an **exponentially growing number of match paths** on certain inputs. Caused by **nested quantifiers over overlapping alternatives** — `(a+)+$` being the canonical shape — where each extra character doubles the work.
2. Because **the dangerous shape is not visually distinctive** — the Cloudflare pattern looked like an ordinary rule. Danger depends on subtle interaction between quantifiers, not on anything a reader notices.
3. **Global, instant deployment.** The same regex reaching 1% of machines would have been an alert; reaching 100% in seconds left no window for detection before full impact.
4. Because a **new attack should be blocked everywhere immediately** — staged rollout leaves customers unprotected meanwhile. The tension is between **deployment safety** and **security velocity**, both legitimate.
5. **Stage by default** with an **explicit, justified fast path** for emergencies, plus **automatic rollback on health signals** so even a fast rollout self-corrects within seconds.
6. Because the **internal tools needed to push a correction were behind the affected infrastructure** — the same circular-dependency problem as the S3 status dashboard.
7. A **pre-existing global kill switch** for the WAF. It must be built **before** the incident — creating one during an outage, on degraded infrastructure, is not feasible.
8. **Review** (weak) → **correctness tests** (weak) → **static analysis for backtracking shapes** (moderate) → **CPU/step budget per evaluation** (strong) → **non-backtracking engine** (strongest).
9. **Linear-time matching, guaranteed** regardless of pattern or input. It gives up **backreferences and lookaround** — precisely the features that make bounded matching impossible.
10. Because there were **no errors** — requests were never processed rather than being rejected. The processes were alive and at 100% CPU, so **saturation** was the signal that showed it, which is why saturation is one of the golden signals.

</details>

---

**Next:** [Roblox, October 2021](./10-roblox-2021.md) — 73 hours, and a dependency nobody could route around.
