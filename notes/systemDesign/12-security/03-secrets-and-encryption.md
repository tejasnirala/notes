---
title: Secrets and Encryption
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Secrets and Encryption

> **What you will be able to do after this page**
>
> - Say what encryption at rest actually protects against, and what it does not.
> - Manage secrets so that a leaked one can be rotated in minutes.
> - Use envelope encryption, and explain why keys are not stored beside data.
> - Choose per-field encryption deliberately, knowing what it breaks.

<C color="orange">Encryption is widely deployed and widely misunderstood.</C> Most systems encrypt the thing that is least likely to be attacked and leave the actual risk untouched.

<Plain>

A shop keeps cash in a safe.

**The safe protects against the wall being knocked through overnight.** Somebody carries the safe away and cannot open it. Genuinely useful.

**It does nothing about the cashier who has the combination.** During the day the safe is open and money moves in and out. Anyone who can convince the system they are the cashier gets the money — and the safe is irrelevant to that entirely.

That distinction is the whole of encryption at rest. It protects <C color="green">the stolen disk, the discarded drive, the backup left somewhere</C>. It does nothing about someone who compromises the application, because the application must be able to read the data to work — <C color="crimson">so it holds the key, and anyone who becomes the application holds it too.</C>

The second idea is about the combination itself. Writing it on a note stuck to the safe defeats the safe. Yet that is what storing a database password in the source code amounts to — and worse, once it is in version history <C color="crimson">it is in every clone, forever, and changing it later does not remove it.</C>

So the useful questions are: what is this actually protecting against, and how quickly could we change the combination if it leaked?

</Plain>

---

## 1. What encryption at rest does and does not do

| Protects against | Does not protect against |
| :--- | :--- |
| <C color="green">Stolen or discarded physical disks</C> | <C color="crimson">A compromised application</C> |
| <C color="green">A leaked backup file</C> | <C color="crimson">SQL injection</C> |
| <C color="green">Cloud provider staff reading raw storage</C> | <C color="crimson">A stolen credential</C> |
| <C color="green">Compliance requirements</C> | <C color="crimson">An authorized user exfiltrating data</C> |

<H>Full-disk and database-level encryption protect against physical access and nothing else. If your threat model is an attacker who reaches your application, encryption at rest contributes nothing — the application decrypts everything by design.</H>

<C color="green">This is not an argument against it</C> — it is cheap, often mandatory, and closes a real category of risk. It is an argument against treating it as a security posture. The controls that address application compromise are [authorization](./02-authorization.md), input validation, least privilege, and monitoring.

<C color="orange">Application-level (per-field) encryption is different</C>, because the database never sees plaintext — so a compromised database, or a DBA, cannot read those fields. It costs you the ability to query them, which is covered below.

---

## 2. Secrets management

<Jargon
  plain="Credentials your application needs at runtime — database passwords, API keys, signing keys."
  term="secrets"
  also={['credentials', 'key material']}>

The property that matters is not secrecy alone but <C color="green">**rotatability**</C>: how fast can you replace one that has leaked? A secret you cannot rotate in minutes is a permanent liability.

</Jargon>

**Ranked, worst to best:**

| Approach | Verdict |
| :--- | :--- |
| Hardcoded in source | <C color="crimson">In every clone and in git history forever</C> |
| Committed config file | <C color="crimson">Same problem</C> |
| Environment variables | <C color="orange">Common; visible in `/proc`, crash dumps, `docker inspect`, and child processes</C> |
| Secrets manager, fetched at startup | <C color="green">Good</C> — central, audited, rotatable |
| Secrets manager with dynamic short-lived credentials | <C color="green">Best</C> — the secret expires before it can be misused |
| Workload identity (no secret at all) | <C color="green">Best</C> — nothing to leak |

<C color="green">The strongest move is eliminating the secret entirely.</C> IAM roles, Kubernetes service accounts and SPIFFE identities let a workload prove *what it is* to obtain short-lived credentials — so there is no long-lived string to leak, commit, or forget to rotate.

**Dynamic credentials** are the next best: a secrets manager generates a database user valid for one hour, and revokes it afterwards. <C color="green">A credential leaked in a log is worthless by the time anyone reads it.</C>

**Rules regardless of approach:**

- <C color="crimson">Never log secrets</C> — and scrub them from error reports, which is where they most often escape.
- **Rotate on a schedule and after any suspicion**, and rehearse it, or you will discover it does not work during an incident.
- **Scope narrowly** — a key that can only read one bucket is a much smaller problem than an admin key.
- **Audit access.** A secret being read from an unexpected place is a strong compromise signal.
- <C color="crimson">A secret committed once is compromised.</C> Rotate it; do not merely delete the commit.

---

## 3. Envelope encryption

<Trace title="Encrypting a field with envelope encryption" subtitle="Why there are two keys instead of one.">

<TraceStep
  title="The naive approach — one key"
  cost="unrotatable"
  state={{ 'Keys': '1 master', 'Rotating it means': 're-encrypting all data', 'Blast radius': 'everything', 'Practical': 'no' }}
  changed={['Keys', 'Rotating it means', 'Blast radius']}
  note="Rotation is supposed to be routine. With one key over terabytes, it becomes a project nobody schedules.">

Encrypt every record with one master key. <C color="crimson">Rotating it means decrypting and re-encrypting every record</C> — so in practice it is never rotated.

</TraceStep>

<TraceStep
  title="Generate a data key per record"
  state={{ 'Keys': 'master + per-record DEK', 'Data encrypted with': 'DEK', 'Blast radius': 'one record', 'Practical': 'yes' }}
  changed={['Keys', 'Data encrypted with', 'Blast radius']}
  note="DEK = data encryption key. Cheap to generate, used once, never reused across records.">

A fresh random **data key (DEK)** encrypts this record's field.

</TraceStep>

<TraceStep
  title="Encrypt the data key with the master key"
  state={{ 'Keys': 'KEK in KMS, DEK stored encrypted', 'Stored': 'ciphertext + wrapped DEK', 'Master key location': 'KMS/HSM only', 'Practical': 'yes' }}
  changed={['Keys', 'Stored', 'Master key location']}
  note="KEK = key encryption key. It never leaves the KMS — you send it the DEK to wrap and unwrap.">

The DEK is encrypted by the **key encryption key (KEK)**, held in a KMS or HSM. The wrapped DEK is stored **beside the ciphertext**.

<C color="green">The plaintext DEK is discarded from memory immediately.</C>

</TraceStep>

<TraceStep
  title="Reading it back"
  state={{ 'Step 1': 'KMS unwraps the DEK', 'Step 2': 'DEK decrypts the field', 'KMS calls': '1 per record (cacheable)', 'Practical': 'yes' }}
  changed={['Step 1', 'Step 2', 'KMS calls']}
  note="The KMS never sees your data — only the small wrapped key. That is what makes it affordable and safe.">

Send the wrapped DEK to the KMS, get the plaintext DEK back, decrypt the field, discard the DEK.

</TraceStep>

<TraceStep
  title="Now rotate the master key"
  cost="minutes, not months"
  state={{ 'Re-encrypted': 'only the wrapped DEKs', 'Data touched': 'none', 'Duration': 'minutes', 'Practical': 'yes' }}
  changed={['Re-encrypted', 'Data touched', 'Duration']}
  note="Rewrapping a few kilobytes of keys versus re-encrypting terabytes of data.">

Unwrap each DEK with the old KEK and rewrap with the new one. <C color="green">The encrypted data itself is never touched.</C>

<H>This is the entire point of the two-key structure: it makes key rotation a small operation on keys rather than a migration over all your data — which is the difference between rotation happening and not happening.</H>

</TraceStep>

<TraceStep
  title="And it enables crypto-shredding"
  state={{ 'Delete a user': 'discard their DEK', 'Data': 'remains, unreadable', 'Use case': 'GDPR, immutable logs', 'Practical': 'yes' }}
  changed={['Delete a user', 'Data', 'Use case']}
  note="The technique that makes erasure possible in append-only systems like event stores and backups.">

Give each **user** a DEK. Deleting the key renders all their data permanently unreadable — <C color="green">including in immutable backups and [event logs](../09-architecture-styles/03-event-sourcing-and-cqrs.md) you cannot rewrite.</C>

</TraceStep>

</Trace>

---

## 4. Field-level encryption, and what it costs

<Depth title="What you lose by encrypting a column, and the alternatives">

Encrypting a field means the database stores ciphertext, so <C color="crimson">every operation the database used to do on that column stops working.</C>

**What breaks:**

- <C color="crimson">**Equality search.**</C> `WHERE email = 'x@y.com'` cannot match, because standard encryption is **randomised** — the same plaintext produces different ciphertext every time (which is exactly what makes it secure).
- <C color="crimson">**Range queries and sorting.**</C> Ciphertext ordering is meaningless.
- <C color="crimson">**Indexes.**</C> A B-tree over random ciphertext is useless.
- <C color="crimson">**Joins, `LIKE`, aggregation.**</C> All gone.
- <C color="crimson">**Uniqueness constraints.**</C> Two encryptions of the same value differ, so the constraint cannot fire.

**The workarounds, and their honest costs:**

**1. Deterministic encryption** — the same plaintext always produces the same ciphertext. Restores equality search and uniqueness. <C color="crimson">And it leaks the frequency distribution</C>: an attacker seeing that one ciphertext appears 40% of the time in a `country` column can infer the value without any key. Acceptable for high-cardinality values like email; <C color="crimson">unsafe for low-cardinality ones</C> like gender, status or country.

**2. A blind index** — store a keyed HMAC of the plaintext in a separate column and search on that. `WHERE email_hmac = HMAC(key, 'x@y.com')`. <C color="green">Equality search works, ordering is not leaked</C>, and frequency analysis is still possible on the HMAC, so the same low-cardinality caution applies. Truncating the HMAC deliberately creates collisions, trading precision for reduced leakage.

**3. Encrypt only the sensitive subset.** Encrypt the card number; leave the last four digits, the expiry and the cardholder name in plaintext for display and search. <C color="green">Usually the right answer</C> — most fields do not need encryption, and being selective preserves your ability to query.

**4. Tokenisation.** Replace the value with a random token and keep the mapping in a separate, tightly controlled vault. Your main database holds only tokens, so a breach of it yields nothing. <C color="green">This is how card data is usually handled</C>, and it removes most systems from PCI scope entirely — a large practical benefit beyond the security one.

**5. Searchable encryption schemes.** Order-preserving and order-revealing encryption exist and allow range queries. <C color="crimson">They leak substantially more than their names suggest</C>, and published attacks recover large fractions of plaintext from ciphertext ordering alone. Treat with caution.

**Deciding what to encrypt at the field level:**

| Encrypt | Leave in plaintext |
| :--- | :--- |
| Government identifiers, card numbers | Anything you must query or sort on |
| Health and biometric data | Data already public |
| Credentials and API keys (hashed, not encrypted, for passwords) | Non-sensitive metadata |
| Free-text notes that may contain anything | Foreign keys and identifiers |

<H>Field-level encryption is a real control with a real cost. Apply it to the small set of fields where a database compromise would be genuinely harmful, and accept that those fields become opaque — rather than encrypting broadly and discovering half your queries no longer work.</H>

</Depth>

---

## 5. In a design discussion

- **"Encryption at rest covers stolen disks and leaked backups. It does nothing against a compromised application, because the app decrypts by design."** States the threat model precisely.
- **"Envelope encryption with per-user data keys — rotation rewraps keys instead of re-encrypting terabytes, and it gives us crypto-shredding for GDPR."** Two benefits from one structure.
- **"Workload identity rather than a stored secret. Nothing to leak, nothing to rotate."** The strongest available answer.
- **"Deterministic encryption on `country` would leak the distribution — an attacker infers values by frequency without the key."** A specific, real failure.

---

## Rapid-fire recall

1. What does encryption at rest protect against, and what does it not?
2. Why does it not help against a compromised application?
3. What property matters most about a secret, besides being secret?
4. Why are environment variables an imperfect place for secrets?
5. What is the strongest approach to secrets, and why?
6. Why is a secret that was committed once compromised even after deletion?
7. Explain envelope encryption and the roles of DEK and KEK.
8. Why does envelope encryption make key rotation practical?
9. What is crypto-shredding, and which problem does it solve?
10. Name four things that break when a column is encrypted, and the leak in deterministic encryption.

<details>
<summary>Answers</summary>

1. **Protects:** stolen or discarded disks, leaked backup files, cloud staff reading raw storage, compliance requirements. **Does not protect:** a compromised application, SQL injection, stolen credentials, or an authorized user exfiltrating data.
2. Because the application **must decrypt the data to function**, so it holds the key. Anyone who compromises the application inherits that ability.
3. <C color="green">**Rotatability**</C> — how quickly it can be replaced after a leak. A secret you cannot rotate in minutes is a permanent liability.
4. They are visible in `/proc`, **crash dumps**, `docker inspect`, and are **inherited by child processes** — so they escape more easily than people expect.
5. **Workload identity** (IAM roles, service accounts, SPIFFE) — the workload proves *what it is* to obtain short-lived credentials, so **there is no long-lived secret to leak, commit or forget to rotate**.
6. Because it exists in **git history and in every clone**. Deleting the commit does not remove it from other copies — the only remedy is rotation.
7. A per-record **data key (DEK)** encrypts the data; the DEK is itself encrypted by a **key encryption key (KEK)** held in a KMS/HSM, and the wrapped DEK is stored beside the ciphertext.
8. Because rotation only requires **unwrapping and rewrapping the small DEKs** with the new KEK — the encrypted data is never touched, turning a data migration into a minutes-long key operation.
9. Encrypting each subject's data with its own key and **deleting the key** to render it permanently unreadable. It solves **erasure in append-only systems** — event stores, immutable backups — where rewriting history is impossible.
10. **Equality search**, **range queries and sorting**, **indexes**, **joins/`LIKE`/aggregation**, **uniqueness constraints**. **Deterministic encryption** restores equality and uniqueness but **leaks the frequency distribution**, so a low-cardinality column's values can be inferred without the key.

</details>

---

**Next:** [Common Attacks](./04-common-attacks.md) — the failures that actually happen.
