---
title: Alerting and On-Call
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Alerting and On-Call

> **What you will be able to do after this page**
>
> - Write alerts that page a human only when a human is needed.
> - Alert on symptoms rather than causes, and say why that scales.
> - Use error budget burn rate to catch both fast and slow failures.
> - Run an incident and a postmortem that produce something durable.

<C color="crimson">The most common alerting failure is not missing alerts — it is too many.</C> An on-call rotation that fires forty times a night stops being read, and then the one that mattered is missed.

<Plain>

A building has fire alarms.

**Too few** and a real fire is discovered too late.

**Too many** and something worse happens. If the alarm sounds three times a week because of burnt toast, people stop leaving the building. <C color="crimson">The alarm still works perfectly and has stopped protecting anyone</C> — the failure is in the humans, and it was caused by the alarm's own unreliability.

So the useful question about any alarm is not "does it detect the thing?" It is: **when this sounds, will somebody act — and should they?**

That leads somewhere counter-intuitive. A sensor detecting that one smoke detector's battery is low should absolutely not sound the building alarm. It is worth knowing, worth fixing this week, and <C color="orange">waking three hundred people at 2am over it is how you teach them to ignore the alarm.</C>

The second idea is about what you detect. You could install sensors for every possible cause of fire — faulty wiring, overloaded sockets, unattended candles. You will never enumerate them all, and most will never happen.

Or you could detect **smoke**. One signal, catching every cause including the ones nobody imagined.

<H>Alert on the thing you care about, not on every way it could come about.</H>

</Plain>

---

## 1. Symptoms, not causes

<Jargon
  plain="Alerting on what users experience rather than on every internal condition that might cause it."
  term="symptom-based alerting"
  also={['alert on SLOs', 'user-facing alerting']}>

<C color="green">Alert on: error rate, latency, throughput dropping to zero, freshness.</C> Not on: CPU, memory, disk queue, thread pool depth. Those are **investigation** signals, not paging signals.

</Jargon>

| Cause-based (poor) | Symptom-based (good) |
| :--- | :--- |
| CPU above 90% | p99 latency above the SLO |
| Memory above 85% | Error rate above 1% |
| Disk 80% full | <C color="orange">This one is legitimate</C> — it is a prediction, not a symptom |
| One instance down | Available capacity below what traffic needs |
| Queue depth above 1,000 | Oldest message older than 5 minutes |

**Why symptoms scale better:**

**One alert catches every cause.** A latency alert fires whether the cause is CPU, a slow dependency, a lock, a bad deploy, or something nobody anticipated. <C color="green">Cause-based alerting only catches causes you enumerated.</C>

**No false positives from healthy states.** CPU at 95% while comfortably meeting SLOs is **good** — you are using what you paid for. Paging for it trains people to ignore pages.

**It matches what users experience.** If p99 is fine and error rate is zero, <C color="crimson">a saturated CPU is not an incident</C>, whatever the dashboard colour.

<C color="orange">The exception is genuine predictions.</C> "Disk full in 4 hours at current growth" is worth paging, because by the time it is a symptom it is an outage and recovery is slow. Alert on the **projection**, not the current value.

---

## 2. Burn-rate alerting

Alerting directly on an [SLO](../01-foundations/03-slis-slos-and-error-budgets.md) has a dilemma: a tight threshold is noisy, a loose one is slow. **Burn rate** resolves it.

Burn rate = how fast you are consuming the error budget relative to a rate that would exactly exhaust it over the window.

```
  30-day window, 99.9% SLO  →  budget = 0.1% of requests

  burn rate 1×   →  budget lasts exactly 30 days
  burn rate 14.4× →  budget gone in ~2 days
  burn rate 6×    →  gone in 5 days
```

<Trace title="Two failures, two alerts" subtitle="A fast outage and a slow leak, caught by the same framework.">

<TraceStep
  title="The naive threshold problem"
  state={{ 'Rule': 'error rate > 0.1%', 'Fast outage': 'caught', 'Slow leak': 'caught', 'False pages/week': '12' }}
  changed={['Rule', 'False pages/week']}
  note="Any brief blip crosses 0.1% momentarily. The rule is correct and unusable.">

Alerting whenever the error rate exceeds the SLO threshold pages constantly on normal variance.

</TraceStep>

<TraceStep
  title="Loosen it"
  cost="slow failures missed"
  state={{ 'Rule': 'error rate > 2%', 'Fast outage': 'caught', 'Slow leak': 'MISSED', 'False pages/week': '0.2' }}
  changed={['Rule', 'Slow leak', 'False pages/week']}
  note="A 0.5% error rate burns the entire monthly budget in six days and never trips a 2% threshold.">

<C color="crimson">Quiet now, and a sustained low-level failure consumes the whole budget without ever alerting.</C>

</TraceStep>

<TraceStep
  title="Fast burn alert — page"
  state={{ 'Rule': '14.4× burn over 1 h AND 5 min', 'Detects': 'budget gone in 2 days', 'Action': 'page immediately', 'False pages/week': '~0' }}
  changed={['Rule', 'Detects', 'Action']}
  note="Two windows required simultaneously — the short one confirms it is still happening, avoiding pages for something already over.">

At 14.4× burn, two days of budget go in two hours. <C color="green">Page.</C>

</TraceStep>

<TraceStep
  title="Slow burn alert — ticket"
  state={{ 'Rule': '6× burn over 6 h AND 30 min', 'Detects': 'sustained low-level failure', 'Action': 'ticket, business hours', 'False pages/week': '~0' }}
  changed={['Rule', 'Detects', 'Action']}
  note="Real and not urgent. It needs attention this week, not at 3am — and routing it correctly is what keeps the pager credible.">

A 0.5% error rate is invisible to a threshold alert and exhausts the budget in days. <C color="green">Ticket it.</C>

</TraceStep>

<TraceStep
  title="The result"
  state={{ 'Fast outage': 'paged in minutes', 'Slow leak': 'ticketed same day', 'False pages/week': '~0', 'Pager credibility': 'intact' }}
  changed={['Fast outage', 'Slow leak', 'Pager credibility']}
  note="Both failure shapes covered, with severity matched to urgency.">

<H>Burn rate lets one framework catch both a sudden outage and a slow leak, and — crucially — route each to the response it deserves. Severity should follow how fast the budget is disappearing, not how large the number looks.</H>

</TraceStep>

</Trace>

---

## 3. What deserves a page

<C color="green">Three tiers, and only one of them wakes anybody:</C>

| Tier | Criteria | Route |
| :--- | :--- | :--- |
| **Page** | Urgent, actionable, user-impacting **now** | Wake someone |
| **Ticket** | Real, needs work, not urgent | Business hours queue |
| **Dashboard** | Informational | No notification at all |

**The test for a page**, all three required:

1. <C color="green">**Is it urgent?**</C> If it can wait until morning, it is a ticket.
2. <C color="green">**Is it actionable?**</C> If the responder can do nothing, paging them is cruelty.
3. <C color="green">**Is it real?**</C> If it self-resolves half the time, it is noise.

<C color="crimson">Any alert failing one of these should be demoted immediately.</C> Every unactionable page erodes the credibility of every future one.

**Every page needs a runbook** linked from the alert, covering: what this means, how to confirm it, what to check first, how to mitigate, and when to escalate. <C color="crimson">A page with no runbook is a puzzle handed to someone at 3am</C>, and the person who wrote the alert already knew the answer.

---

## 4. Running an incident

Clear roles prevent the common failure where five people debug in parallel and nobody communicates.

| Role | Does |
| :--- | :--- |
| **Incident commander** | Coordinates; <C color="crimson">does not debug</C> |
| **Operations lead** | Makes the changes |
| **Communications lead** | Updates stakeholders and status page |
| **Scribe** | Timestamps everything for the postmortem |

<C color="green">Mitigate before diagnosing.</C> Roll back, fail over, shed load, disable the feature flag. <C color="crimson">Understanding the root cause during an incident is the wrong priority</C> — restore service, then investigate with the pressure off.

The most valuable question early on: <C color="green">*"what changed?"*</C> Most incidents follow a deploy, a config change, a flag flip, or a traffic shift. Checking the last hour of changes resolves a large share of incidents faster than debugging does.

<Depth title="Postmortems that produce change, and the alert-fatigue trap">

**Blameless means structural, not polite.** The point is not sparing feelings; it is that <C color="orange">"an engineer made a mistake" is never a root cause</C>. The useful questions are why the system permitted it, why nothing caught it, and why the impact was that large.

An engineer running a destructive command against production is not the finding. The findings are: why did that credential have that permission, why was there no confirmation step, why did no canary catch it, why did recovery take four hours.

**The five questions worth answering:**

1. **What was the user impact?** In user-facing terms — how many, how long, what could they not do — not in CPU graphs.
2. **What was the timeline?** With **time-to-detect** and **time-to-mitigate** separately. A four-hour outage where detection took three hours is a *monitoring* failure; where mitigation took four is an *architecture* failure. Different lessons entirely.
3. **What was the contributing chain?** Not a single root cause — most incidents are several individually-survivable failures aligning.
4. **What made it worse or slower?** Missing runbooks, a dashboard that was down, an unclear escalation path, a rollback that did not work.
5. **What are the action items?** Specific, owned, dated. <C color="crimson">A postmortem with no owned actions is a document.</C>

**Action items ranked by durability:**

| Type | Durability |
| :--- | :--- |
| <C color="green">Make the failure impossible</C> — remove the permission, add a constraint | Permanent |
| <C color="green">Make it automatically detected and mitigated</C> | Strong |
| <C color="orange">Add an alert</C> | Moderate — someone must still act |
| <C color="orange">Add a runbook</C> | Weak — it will go stale |
| <C color="crimson">"Be more careful" / "add training"</C> | None |

**The alert-fatigue trap**, which is where most on-call cultures fail:

Every incident generates *"we should have alerted on X"*, and the alert is duly added. Over two years, hundreds accumulate. Most fire occasionally, and most are not actionable. The rotation stops reading them. <C color="crimson">The next real incident is missed because the page looked like the other forty that week.</C>

<C color="green">The counter-practice is deleting alerts, on a schedule.</C> Quarterly, review every alert that fired and ask: did anyone act? Did the action matter? An alert that fired twelve times with no action taken is **actively harmful** and should be deleted, not tuned.

**Measure the pager, and treat it as a product:**

- **Pages per shift** — more than a couple per night is unsustainable; sustained, it causes attrition.
- **Actionable percentage** — below ~75%, fatigue is already setting in.
- **Pages outside working hours** — the number that predicts burnout.
- **Repeat pages for the same cause** — a fix that was never made.

<H>On-call load is a system property you can measure and change. A rotation that is quiet because the system is well-built is achievable; a rotation that is loud because nobody deletes alerts is a choice, and it degrades the humans who are your last line of defence.</H>

</Depth>

---

## 5. In a design discussion

- **"Alert on symptoms — error rate and latency against the SLO. CPU at 95% while meeting SLOs is good news, not a page."** The principle with its consequence.
- **"Multi-window burn-rate alerts: 14.4× over an hour pages, 6× over six hours tickets. Catches a sudden outage and a slow leak with one framework."** Specific and correct.
- **"Every page needs a runbook and must pass three tests: urgent, actionable, real. Anything failing one gets demoted."** A usable rule.
- **"We review and delete alerts quarterly. An alert that fired twelve times with no action taken is doing harm."** The practice almost nobody has.

---

## Rapid-fire recall

1. Why is too many alerts a worse failure than too few?
2. Give three reasons symptom-based alerting beats cause-based.
3. Which cause-based alert is legitimate, and why?
4. What is burn rate, and what problem does it solve?
5. Why do burn-rate alerts use two windows simultaneously?
6. Give burn rates and actions for a fast outage and a slow leak.
7. State the three tests an alert must pass to page someone.
8. Why mitigate before diagnosing, and what is the most valuable early question?
9. Why is "an engineer made a mistake" never a root cause?
10. Rank postmortem action items by durability, and give the counter-practice to alert fatigue.

<details>
<summary>Answers</summary>

1. Because **the humans stop responding**. An alarm that fires constantly on non-events trains people to ignore it, so the one that matters is missed — the detection still works and has stopped protecting anything.
2. **One alert catches every cause**, including unanticipated ones · **no false positives from healthy states** (high CPU while meeting SLOs is good) · **it matches what users actually experience**.
3. **Predictions**, such as "disk full in 4 hours at current growth". By the time it becomes a symptom it is an outage with slow recovery, so you alert on the **projection** rather than the current value.
4. How fast you are consuming the **error budget** relative to the rate that would exhaust it exactly over the window. It solves the threshold dilemma — tight thresholds are noisy, loose ones miss sustained low-level failures.
5. The **long window** confirms significant budget consumption; the **short window** confirms it is **still happening**, so you are not paged for something that already resolved.
6. **Fast**: ~14.4× burn over 1 hour (and 5 minutes) — budget gone in two days — **page**. **Slow**: ~6× over 6 hours (and 30 minutes) — a sustained low-level failure — **ticket** for business hours.
7. **Urgent** (cannot wait until morning), **actionable** (the responder can do something), and **real** (it does not self-resolve half the time). Failing any one means demote it.
8. Because **restoring service is the priority** and diagnosis is slower under pressure — roll back, fail over, shed load, flip the flag. The most valuable early question is <C color="green">**"what changed?"**</C>, since most incidents follow a deploy, config change, flag flip or traffic shift.
9. Because it stops the analysis before the useful questions: **why did the system permit it**, why did nothing catch it, why was the blast radius that large, and why did recovery take so long. Those produce durable fixes; blame produces none.
10. **Make the failure impossible** (permanent) → **automatic detection and mitigation** → **add an alert** → **add a runbook** (goes stale) → **"be more careful"** (worthless). The counter-practice to fatigue is **deleting alerts on a schedule** — reviewing quarterly and removing any that fired repeatedly with no action taken.

</details>

---

**Next:** [Deployment Strategies](./03-deployment-strategies.md) — shipping change without causing the incident.
