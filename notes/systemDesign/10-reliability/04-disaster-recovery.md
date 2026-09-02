---
title: Disaster Recovery
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Disaster Recovery

> **What you will be able to do after this page**
>
> - Define RTO and RPO, and derive an architecture from them.
> - Choose a DR strategy from cost against recovery time.
> - Explain why an untested backup is not a backup.
> - Say what chaos engineering is actually for.

Redundancy handles component failure. <C color="orange">Disaster recovery handles the failures redundancy does not cover</C> — a whole region, a bad migration, a compromised account, or somebody's mistake replicated instantly to every copy.

<Plain>

A business keeps its records in an office. Two questions decide everything about how it protects them.

**How long can we be shut before it is fatal?** An hour is inconvenient. A week may end the business. That number determines how much you spend on being able to reopen quickly.

**How much recent work can we afford to lose?** If the last backup was Friday and it is now Thursday, you lose six days of work. If it was an hour ago, you lose an hour.

These are separate questions with separate costs, and confusing them leads to spending on the wrong thing.

A second office fully staffed and ready means <C color="green">reopening in minutes</C> — and paying for an office you never use. A box of documents in a storage unit is cheap and means **days** to become operational again. Between those sits everything else.

And the part that catches everyone: <C color="crimson">a box of documents nobody has ever opened is not a backup. It is an assumption.</C> You find out whether the copies are readable, complete, and sufficient to rebuild from at the exact moment you need them and cannot afford to be wrong.

<H>The only backup that counts is one you have restored from, recently, on purpose.</H>

</Plain>

---

## 1. RTO and RPO

<Jargon
  plain="How fast you must be back, and how much recent data you can afford to lose."
  term="RTO and RPO"
  also={['recovery time objective', 'recovery point objective']}>

**RTO** — Recovery **Time** Objective — is downtime you can tolerate. **RPO** — Recovery **Point** Objective — is data loss you can tolerate. <C color="orange">They are independent, cost differently, and every DR decision follows from them.</C>

</Jargon>

```
        ← RPO →              disaster              ← RTO →
   ─────┬────────────────────────┬─────────────────────┬────►
     last good                 failure              service
      state                                         restored

     data lost                                  downtime endured
```

**These are business decisions, not technical ones.** Ask the business what each hour of downtime costs and what losing an hour of data would mean, then design to those numbers rather than choosing an architecture and discovering what it gives you.

| Requirement | Implication |
| :--- | :--- |
| RPO = 0 | <C color="crimson">Synchronous replication</C> — every write waits for a remote acknowledgement |
| RPO = seconds | Asynchronous replication |
| RPO = minutes | Frequent snapshots plus log shipping |
| RPO = hours | Periodic backups |
| RTO = minutes | <C color="crimson">Warm or hot standby, automated failover</C> |
| RTO = hours | Restore from backup, automated |
| RTO = days | Manual rebuild from backups |

<C color="orange">RPO = 0 is very expensive</C> — synchronous cross-region replication adds the [full round-trip latency](../01-foundations/04-latency-numbers.md) to every write. Most systems that ask for it discover that a few seconds of RPO costs a fraction as much and is entirely acceptable.

---

## 2. The four strategies

| Strategy | RTO | RPO | Cost |
| :--- | :--- | :--- | :--- |
| **Backup and restore** | Hours–days | Hours | <C color="green">Lowest</C> |
| **Pilot light** | Tens of minutes | Minutes | Low |
| **Warm standby** | Minutes | Seconds | Medium |
| **Hot standby / active-active** | <C color="green">Near zero</C> | <C color="green">Near zero</C> | <C color="crimson">Highest — roughly 2×</C> |

**Backup and restore.** Backups in another region; on disaster, provision everything and restore. Cheap, slow, and <C color="crimson">the restore path is the least-exercised code you own.</C>

**Pilot light.** A minimal always-on core — usually the database, replicating — with everything else provisioned on demand. <C color="green">Good value:</C> the expensive, slow-to-restore part is already warm.

**Warm standby.** A scaled-down but complete copy running continuously. Failover is a traffic switch plus a scale-up.

**Hot standby / active-active.** Full capacity in both regions, both serving. <C color="green">Fastest recovery and continuously tested</C>, because the standby is in constant use — but roughly double the infrastructure, plus multi-region data consistency problems.

---

## 3. Backups that actually work

<Trace title="A restore that fails" subtitle="Every step here has happened to a real team.">

<TraceStep
  title="The backup job reports success"
  state={{ 'Backups': 'nightly, 90 days', 'Monitoring': 'job exit code', 'Confidence': 'high', 'Actually restorable': 'unknown' }}
  changed={['Backups', 'Confidence']}
  note="A zero exit code proves the process ran, not that its output is useful.">

Nightly backups, retained 90 days, alerting on job failure. It has not failed in a year.

</TraceStep>

<TraceStep
  title="Disaster — attempt the restore"
  cost="the file is truncated"
  state={{ 'Backups': 'present', 'Restore': 'FAILS', 'Cause': 'silent truncation', 'Actually restorable': 'NO' }}
  changed={['Restore', 'Cause', 'Actually restorable']}
  note="The upload was cut short by a timeout; the job still exited zero. Nothing ever read the file back.">

The dump file is incomplete. <C color="crimson">Every backup for the last four months has the same problem.</C>

</TraceStep>

<TraceStep
  title="Fall back to an older backup"
  cost="RPO blown"
  state={{ 'Restore': 'succeeds from 5 months ago', 'Data lost': '5 months', 'RPO target': '1 hour', 'Actually restorable': 'partially' }}
  changed={['Restore', 'Data lost', 'Actually restorable']}
  note="Retention was 90 days, so the last good backup was nearly out of the window too.">

An older backup restores — losing five months of data against a one-hour RPO.

</TraceStep>

<TraceStep
  title="Second problem — how long it takes"
  cost="RTO blown"
  state={{ 'Restore time': '14 hours', 'RTO target': '1 hour', 'Cause': 'never measured on full data', 'Actually restorable': 'eventually' }}
  changed={['Restore time', 'Cause']}
  note="Restore time scales with data volume, and it was last measured when the database was a tenth of its size.">

Restoring 4 TB and replaying logs takes 14 hours against a one-hour RTO.

</TraceStep>

<TraceStep
  title="Third problem — what was not backed up"
  cost="incomplete recovery"
  state={{ 'Database': 'restored', 'Object storage': 'not backed up', 'Secrets': 'not backed up', 'Actually operational': 'NO' }}
  changed={['Object storage', 'Secrets', 'Actually operational']}
  note="Backup scope is defined by what someone remembered, and it drifts as the system grows.">

The database is back. <C color="crimson">User uploads, secrets, DNS config and TLS certificates were never in scope</C> — and the application cannot start.

</TraceStep>

<TraceStep
  title="What would have caught all three"
  state={{ 'Practice': 'automated monthly restore drill', 'Verifies': 'integrity, duration, completeness', 'Actually restorable': 'YES, proven' }}
  changed={['Practice', 'Verifies', 'Actually restorable']}
  note="One recurring automated drill catches truncation, RTO drift, and scope gaps together.">

<H>Restore to a scratch environment on a schedule, run integrity checks, measure the duration, and start the application against it. A backup you have not restored from is a hypothesis, and this is the experiment.</H>

</TraceStep>

</Trace>

**The requirements:**

- <C color="green">**3-2-1**</C> — three copies, two media types, one off-site (and ideally one in a different cloud account, so a compromised account cannot delete them).
- <C color="green">**Immutable / object-locked**</C>, so ransomware or a compromised credential cannot delete your recovery path.
- <C color="green">**Point-in-time recovery**</C> — restore to 10:32, just before the bad migration. Snapshots alone give you granularity of hours; log shipping gives you seconds.
- <C color="green">**Tested restores, automatically, on a schedule.**</C>
- <C color="green">**Scope reviewed periodically**</C> — databases, object storage, secrets, configuration, DNS, certificates, infrastructure definitions.

<Depth title="What actually goes wrong in a regional failover">

Multi-region DR is where plans meet reality, and the failures are consistent across organisations.

**1. The dependency you forgot is single-region.** Your application runs in two regions, and it calls a service that exists in one. Or a queue, a secrets store, a licence server, a cron host. <C color="crimson">The exercise that finds these is not a design review — it is actually cutting the region off.</C>

**2. DNS failover is slower than planned.** [TTLs are honoured inconsistently](../02-networking/01-dns.md), some resolvers clamp them, and some clients cache for the process lifetime. A 60-second TTL means most traffic moves in a minute and a long tail does not move for hours. If your RTO is five minutes and your mechanism is DNS, the RTO is aspirational.

**3. The standby has never handled full load.** A warm standby running at 10% capacity is asked to take 100% instantly. It scales up — but cold caches, empty connection pools and unwarmed JITs mean it may fail under the load it was supposed to absorb. <C color="orange">This is the [thundering herd](../07-caching/04-cache-failure-modes.md) arriving at the worst possible time.</C>

**4. Data is inconsistent between regions.** With async replication, the standby is behind by some amount at the moment of failover. Those writes are lost — and if the original region recovers, you have **two divergent histories** to reconcile. Fencing and a clear "the old primary is now read-only forever" procedure matter enormously here.

**5. Failing back is harder than failing over.** Everyone plans the failover. Almost nobody plans the return: the original region must be resynchronised from the new primary, which now holds hours of writes it never had. <C color="crimson">Teams frequently run in their DR region for weeks because failing back is unplanned and frightening.</C>

**6. The runbook is stale.** Written 18 months ago, referencing a decommissioned dashboard, an employee who left, and a step that is no longer possible. Runbooks decay silently, exactly like backups.

**Why chaos engineering exists.** Not to break things for its own sake — to <C color="green">convert unknown failure modes into known ones, on a Tuesday afternoon rather than at 3 a.m.</C>

The discipline: form a hypothesis ("if we lose an availability zone, error rate stays below 1%"), define a blast radius, run the experiment in production with a kill switch, and either confirm the hypothesis or fix what it revealed. Start in staging, start small, and progress to production — because <H>staging does not have production's traffic, data volume, or hidden dependencies, and those are precisely what make the difference.</H>

**The DR exercises worth running, in increasing order:**

| Exercise | Reveals |
| :--- | :--- |
| Restore a backup to scratch | Backup integrity, restore duration, scope gaps |
| Kill one instance | Health check and rebalance behaviour |
| Kill an availability zone | Correlated failures and capacity assumptions |
| Fail over the database | Failover automation and application reconnection |
| Cut off an entire region | Hidden single-region dependencies |
| Fail *back* | The half of the plan nobody wrote |

</Depth>

---

## 4. In a design discussion

- **"RTO of 15 minutes and RPO of 30 seconds — so warm standby with async replication. RPO zero would mean synchronous cross-region writes and a latency cost on every request."** Derives architecture from the numbers.
- **"Automated monthly restore drills that measure duration — restore time scales with data volume and silently drifts past the RTO."** The failure that catches everyone.
- **"Backups in a separate account with object lock, so a compromised credential can't delete our recovery path."** Threat model, not just hardware failure.
- **"We'd rehearse failing *back* too. Most teams plan the failover and then run in DR for a month because the return was never designed."** Shows real operational experience.

---

## Rapid-fire recall

1. Define RTO and RPO, and say why they are independent.
2. What does RPO = 0 require, and what does it cost on every write?
3. Name the four DR strategies with rough RTO and cost.
4. Why is hot standby continuously tested in a way the others are not?
5. Give three ways a backup can fail despite the job reporting success.
6. Why does restore time drift past the RTO over time?
7. What is commonly missing from backup scope beyond the database?
8. State the 3-2-1 rule and the modern addition to it.
9. Give three reasons a regional failover fails in practice.
10. What is chaos engineering for, and why must it eventually run in production?

<details>
<summary>Answers</summary>

1. **RTO** = tolerable **downtime**; **RPO** = tolerable **data loss**. Independent because you can recover quickly while losing a lot of data (fast restore from an old backup), or slowly while losing none (synchronous replication with a manual rebuild).
2. **Synchronous replication** — every write must be acknowledged by a remote region before committing, adding the **full cross-region round trip** (tens to hundreds of milliseconds) to every write.
3. **Backup and restore** (hours–days, lowest cost) · **pilot light** (tens of minutes, low) · **warm standby** (minutes, medium) · **hot standby/active-active** (near zero, ~2× cost).
4. Because the standby is **in constant use serving real traffic**, so there is no untested path. Every other strategy has a recovery mechanism exercised only during an actual disaster.
5. **Silent truncation** (upload cut short, job still exits zero) · **the backup is not actually restorable** (corrupt, wrong format, missing dependencies) · **incomplete scope** (secrets, object storage, config never included) · **retention too short** to reach the last good copy.
6. Because **restore time scales with data volume**, and it is typically measured once when the database is small. The database grows; the measurement does not get repeated.
7. **Object storage / user uploads** · **secrets** · **DNS configuration** · **TLS certificates** · **infrastructure definitions**. Without them the database restores and the application still cannot start.
8. **Three copies, two media types, one off-site.** Modern addition: **one in a separate account or provider**, and **immutable/object-locked**, so a compromised credential or ransomware cannot delete the recovery path.
9. **A forgotten single-region dependency** · **DNS failover slower than planned** (TTLs honoured inconsistently, long tail of stale clients) · **the standby has never handled full load** (cold caches, empty pools) · **data divergence between regions** · **no plan for failing back** · **a stale runbook**.
10. To **convert unknown failure modes into known ones** at a chosen time rather than at 3 a.m. It must eventually run in production because **staging lacks production's traffic, data volume and hidden dependencies** — which are exactly what cause real failures.

</details>

---

**Next:** Performance and Capacity — latency, throughput, and sizing a system deliberately. *(Coming next.)*
