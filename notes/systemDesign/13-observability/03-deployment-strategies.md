---
title: Deployment Strategies
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Deployment Strategies

> **What you will be able to do after this page**
>
> - Choose a rollout strategy from your rollback requirements.
> - Separate deploying code from releasing a feature, and say why that matters.
> - Design a canary that actually catches problems.
> - Recognise the changes that cannot be rolled back, and plan for them.

<C color="orange">Most incidents are caused by a change.</C> Deployment strategy is the discipline of making changes without causing them — and of limiting the damage when you do.

<Plain>

A restaurant changes its menu.

**The risky way:** print new menus, throw the old ones away, and change every dish tonight. If the new main course is wrong, there are no old menus, the kitchen has already reorganised, and <C color="crimson">every customer this evening gets the mistake.</C>

**A safer way:** keep the old menus. Offer the new dish to a few tables and watch. Do they finish it? Do they send it back? If it goes badly, stop offering it — nobody else is affected and nothing was thrown away.

Two separate ideas hide in that, and keeping them apart is the whole subject.

**Printing the menus** and **offering the dish** are different acts. You can print them in advance and offer nothing yet — then start offering, one table at a time, and stop instantly without reprinting anything. <C color="green">Reversing "stop offering it" takes seconds; reversing "we threw away the old menus" does not.</C>

And there is a change that cannot be undone at all. If the new dish required rebuilding the kitchen, you cannot un-rebuild it between services. <C color="orange">Those changes need a different approach entirely</C> — done in stages, each one safe on its own, with the irreversible step last and separate.

</Plain>

---

## 1. The strategies

| Strategy | How | Rollback | Cost |
| :--- | :--- | :--- | :--- |
| **Recreate** | Stop old, start new | Redeploy old | <C color="crimson">Downtime</C> |
| **Rolling** | Replace instances gradually | Roll forward or back gradually | <C color="orange">Both versions live simultaneously</C> |
| **Blue-green** | Two full environments, switch traffic | <C color="green">Instant — switch back</C> | <C color="crimson">2× infrastructure</C> |
| **Canary** | Small % to new version, watch, expand | <C color="green">Shift traffic back</C> | Needs good metrics |
| **Shadow** | Duplicate traffic to new version, discard responses | <C color="green">Nothing to roll back</C> | 2× load on dependencies |

<C color="green">Rolling is the sensible default</C> — no extra infrastructure, no downtime. **Blue-green** buys instant rollback for double the cost. <C color="green">**Canary** is the strongest for risky changes</C>, because it limits blast radius *and* gives you evidence before full exposure.

<C color="crimson">Rolling deployments have a consequence people forget:</C> both versions run at once, serving the same traffic against the same database. Every change must be compatible with the version it is replacing — the same [expand-contract discipline](../05-data-at-scale/04-zero-downtime-migrations.md) as schema changes, applied to APIs, message formats and cached shapes.

---

## 2. Deploy is not release

<Jargon
  plain="Getting code onto servers is a separate act from turning a feature on for users."
  term="deploy vs release"
  also={['dark launching', 'feature flags', 'trunk-based development']}>

<C color="green">Deploy the code disabled; release it by flipping a flag.</C> This decouples engineering risk from product risk and makes "undo" a configuration change rather than a redeployment.

</Jargon>

Why the separation matters:

| Deploying | Releasing |
| :--- | :--- |
| Minutes, involves a pipeline | <C color="green">Seconds, a config change</C> |
| Rolls back the whole build | <C color="green">Turns off one feature</C> |
| All-or-nothing | <C color="green">Percentage, cohort, or single user</C> |
| Risk = "does the build work?" | Risk = "is this feature right?" |

<H>With flags, a bad feature is disabled in seconds without touching a deployment pipeline, and without reverting the twelve unrelated changes that shipped in the same build.</H>

**Flag discipline**, because flags become debt fast:

- <C color="green">Every flag needs an owner and a removal date.</C> A codebase with 200 stale flags has 2²⁰⁰ nominal code paths and nobody can reason about it.
- **Default to off**, and make the off path the well-tested one.
- <C color="crimson">Never let the flag system be a hard dependency</C> — if it is unreachable, fall back to the last known values, not to an error.
- **Remove flags after full rollout.** This is the step everyone skips.

---

## 3. A canary that works

<Trace title="Canarying a risky change" subtitle="Watch what catches the problem — and what would have missed it.">

<TraceStep
  title="Deploy to 1% of instances"
  state={{ 'Traffic on new': '1%', 'Error rate': 'baseline', 'p99': 'baseline', 'Decision': 'observing' }}
  changed={['Traffic on new']}
  note="Small enough that a total failure affects 1% of users, large enough to produce statistically usable data.">

The new version takes 1% of traffic. The other 99% is untouched.

</TraceStep>

<TraceStep
  title="Compare against the control — not against history"
  cost="the critical detail"
  state={{ 'Traffic on new': '1%', 'Comparison': 'canary vs current, same time', 'Decision': 'observing' }}
  changed={['Comparison']}
  note="Comparing to yesterday confounds the change with time-of-day, traffic mix and other deploys.">

<C color="green">Metrics are compared against the *old version running right now*</C>, not against yesterday's numbers.

</TraceStep>

<TraceStep
  title="Error rate looks fine — but check the right signals"
  state={{ 'Error rate': 'equal', 'p99 latency': '+40%', 'Saturation': 'CPU +25%', 'Decision': 'roll back' }}
  changed={['p99 latency', 'Saturation', 'Decision']}
  note="A latency regression is invisible in error rate and would degrade everything once fully rolled out.">

Errors are identical. <C color="crimson">p99 is 40% worse and CPU is up 25%</C> — a change that would have looked successful on an error-rate-only canary.

</TraceStep>

<TraceStep
  title="Automatic rollback"
  state={{ 'Traffic on new': '0%', 'Users affected': '1%, briefly', 'Rollback time': '<1 min', 'Decision': 'rolled back' }}
  changed={['Traffic on new', 'Users affected', 'Rollback time']}
  note="Automated on metric comparison — a human watching a dashboard is slower and does not scale.">

Traffic shifts back. <C color="green">One percent of users saw degraded latency for a few minutes.</C>

</TraceStep>

<TraceStep
  title="What a bad canary would have done"
  cost="full outage"
  state={{ 'Bad canary': '1% for 30 s, errors only', 'Result': 'passed', 'Then': '100% rollout', 'Users affected': 'ALL' }}
  changed={['Bad canary', 'Result', 'Then', 'Users affected']}
  note="Too short to accumulate data, and measuring only the one signal that happened not to move.">

<C color="crimson">A canary that watches only error rate, for 30 seconds, would have passed this change</C> and rolled it to everyone.

<H>A canary is only as good as the signals it compares and the time it runs. Too short and there is no signal; too narrow and it misses the regression that is actually there.</H>

</TraceStep>

</Trace>

**A canary needs, at minimum:** error rate · **latency percentiles** · saturation (CPU, memory) · a **key business metric** (checkout rate, sign-ups) · enough duration to accumulate significance · comparison against a concurrent control.

<C color="orange">The business metric is the one teams omit and the one that catches subtle breakage</C> — a change where every request succeeds quickly and the button no longer works produces perfect technical metrics.

---

## 4. Changes you cannot roll back

<Depth title="Irreversible changes, and how to make them reversible">

Rollback is the safety net under every strategy here. Some changes remove it, and identifying them in advance is what prevents the worst incidents.

**What cannot be rolled back:**

**1. Destructive schema changes.** Dropping a column deletes data. Rolling the code back does not restore it. Handled by [expand-contract](../05-data-at-scale/04-zero-downtime-migrations.md): the drop happens days after the code stops using it, as a separate deployment.

**2. Data migrations that transform in place.** Rewriting every row into a new format, then rolling back to code that expects the old one. <C color="green">Fix: write the new format alongside the old, and only stop writing the old once the new is proven.</C>

**3. Messages already published.** An event with a bad schema, consumed by four services, is not recallable. Fix: validate against a schema registry before publishing, and version event types.

**4. External side effects.** Emails sent, payments captured, webhooks delivered, third-party records created. <C color="crimson">There is no rollback for an email.</C> Fix: gate these behind flags, test with internal cohorts, and rate-limit the first rollout so a bug affects hundreds rather than millions.

**5. Cache and client state.** A new version writes a new cached shape; rolling back leaves old code reading data it cannot parse. Fix: **version cache keys**, so old code reads old keys and the new shape is simply unused.

**6. Anything a mobile client already downloaded.** You cannot roll back an app on someone's phone. <C color="orange">The server must support every client version still in the wild</C>, sometimes for years — which makes server APIs effectively append-only.

**The technique that makes hard changes safe: dark launching and shadow traffic.**

Deploy the new code path and **run it without using its result**:

```
  result_old = oldPath(request)      ← returned to the user
  result_new = newPath(request)      ← computed, compared, discarded
  if (result_old != result_new) log_discrepancy(...)
```

<C color="green">You get production traffic, production data volume and production edge cases, with zero user risk.</C> Run it for days, drive the discrepancy rate to near zero, then switch which result is returned — by which point the change is boring.

This is how large systems replace payment logic, pricing engines, search ranking and permission checks. The cost is double computation and care that the new path has no side effects while shadowed.

**The checklist before any risky change:**

| Question | If the answer is bad |
| :--- | :--- |
| Can we roll this back in under 5 minutes? | Split it into reversible steps |
| Does it change data irreversibly? | Expand-contract, drop later |
| Does it produce external side effects? | Flag it, start with an internal cohort |
| Will old and new run simultaneously? | Verify compatibility in both directions |
| Can we shadow it first? | Do that instead of a direct cutover |

<H>The question is never "are we confident this works?" It is "what happens if it doesn't, and how fast can we undo it?" A change that cannot be undone quickly needs to be split until each step can.</H>

</Depth>

---

## 5. In a design discussion

- **"Deploy disabled behind a flag, then release by percentage. Rolling back a feature becomes a config change, not a redeploy of twelve unrelated changes."** The separation and its payoff.
- **"Canary comparing against the concurrent control, on latency and a business metric — not just error rate, and not against yesterday."** The three things bad canaries get wrong.
- **"Rolling deploys mean both versions run at once, so every change has to be compatible in both directions."** The constraint people forget.
- **"We'd shadow the new pricing engine for a week and compare outputs before switching. There's no rollback for having charged the wrong amount."** Matches technique to irreversibility.

---

## Rapid-fire recall

1. Compare the five strategies on rollback speed and cost.
2. What constraint does a rolling deployment impose?
3. Distinguish deploying from releasing, and give two benefits.
4. Give four rules for feature flag discipline.
5. Why must a canary compare against a concurrent control?
6. Name five signals a canary should watch, and which is most often omitted.
7. Why would a 30-second error-rate-only canary have passed a bad change?
8. Give five categories of change that cannot be rolled back.
9. How do you make a cache-shape change reversible?
10. What is shadow traffic, what does it cost, and what is it best used for?

<details>
<summary>Answers</summary>

1. **Recreate** — slow rollback, downtime. **Rolling** — gradual both ways, no extra cost. **Blue-green** — instant rollback, 2× infrastructure. **Canary** — fast rollback, needs good metrics. **Shadow** — nothing to roll back, 2× load on dependencies.
2. **Both versions run simultaneously** against the same data, so every change must be compatible with the version it is replacing — in both directions.
3. **Deploying** puts code on servers; **releasing** turns a feature on for users. Benefits: rollback becomes a **seconds-long config change** rather than a pipeline run, and you can revert **one feature** rather than the whole build including unrelated changes.
4. **Every flag has an owner and a removal date** · **default to off**, with the off path well tested · **never make the flag system a hard dependency** (fall back to last known values) · **remove flags after full rollout**.
5. Because comparing against historical data **confounds the change with time-of-day, traffic mix and other concurrent deploys**. The old version running right now is the only valid control.
6. **Error rate** · **latency percentiles** · **saturation (CPU/memory)** · **a key business metric** · sufficient duration. The **business metric** is most often omitted — and it catches changes where every request succeeds quickly and the feature is broken.
7. Because it was **too short to accumulate significance** and watched **only the signal that did not move**. The regression was in p99 latency and CPU, both invisible to an error-rate check.
8. **Destructive schema changes** · **in-place data migrations** · **published messages** · **external side effects** (emails, payments, webhooks) · **cache and client state** · **anything already downloaded by a mobile client**.
9. **Version the cache keys**, so rolled-back old code reads the old keys and simply ignores the new shape rather than failing to parse it.
10. Running the new code path on real production traffic while **discarding its result** and comparing it to the old one. It costs **double computation** and requires the new path to have **no side effects**. Best for high-risk replacements — pricing, payments, search ranking, permissions — where there is no rollback for a wrong answer.

</details>

---

**Next:** [Cost as a Design Constraint](./04-cost-as-a-constraint.md) — the axis most material leaves out.
