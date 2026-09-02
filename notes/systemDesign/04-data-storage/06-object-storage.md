---
title: Object & Blob Storage
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Object & Blob Storage

> **What you will be able to do after this page**
>
> - Say why large files never belong in a database, in specifics rather than as a rule.
> - Design an upload that never passes bytes through your servers.
> - Use storage classes and lifecycle rules to cut a storage bill by an order of magnitude.
> - Explain what object storage cannot do, and when you need a filesystem instead.

Object storage is the cheapest place to keep bytes, and the pattern around it — <C color="orange">metadata in the database, bytes in the object store</C> — appears in almost every design that handles files.

<Plain>

A shop keeps two very different kinds of thing.

**A ledger** — small entries, constantly read and updated, cross-referenced against each other. It sits on the desk, and it is worth keeping it fast and tidy.

**A warehouse** — crates. Each is large, arrives once, gets collected occasionally, and is never edited in place. Nobody opens a crate to change one item inside; if the contents change, a new crate replaces it.

Nobody would store crates on the desk. They would bury the ledger, and the desk is expensive space designed for a completely different job.

So the shop keeps the crates in a warehouse and writes in the ledger: *"customer 42's order — crate B-7741, warehouse 3."* The ledger stays small and quick, the warehouse stays cheap, and each does what it is good at.

That is the entire pattern. Photos, videos, PDFs and backups are crates. <C color="crimson">Putting them in your database is putting crates on the desk</C> — it works for a while, and it slowly ruins the thing that was working.

The other idea worth taking from the picture: when a delivery arrives, it goes **straight to the warehouse**. You would not have every crate carried through the shop floor so a clerk could look at it before sending it out the back. Yet that is exactly what most upload code does.

</Plain>

---

## 1. Why not the database

The rule *"don't put files in your database"* is repeated more often than it is explained. The specifics:

| Cost | Detail |
| :--- | :--- |
| **Backup time** | A 500 GB database of mostly images takes hours to back up and restore. <C color="crimson">Your recovery time objective is now set by your images.</C> |
| **Buffer cache pollution** | Reading one 5 MB image evicts thousands of hot index pages, degrading every other query |
| **Replication lag** | Every byte crosses to every replica, over and over |
| **Cost per GB** | Database storage is <C color="crimson">10–20× object storage</C> — you are paying for an engine you cannot use on a JPEG |
| **No CDN path** | Bytes cannot be served from an edge; every download hits your origin and your database |
| **Connection occupancy** | Streaming a large blob holds a database connection from a small pool for the whole transfer |

<H>The database gives you transactions, indexes, joins and constraints. None of those applies to the bytes of a photo — so you are paying the full price of a relational engine for storage it cannot help you with.</H>

### The standard pattern

```
  DATABASE (small, fast, transactional)      OBJECT STORE (huge, cheap, immutable)
  ┌───────────────────────────────┐          ┌──────────────────────────────┐
  │ photos                        │          │  bucket: user-uploads        │
  │  id, user_id, caption,        │          │   photos/42/a1b2c3.jpg       │
  │  created_at, width, height,   │──key────►│   photos/42/a1b2c3_thumb.jpg │
  │  s3_key, content_type, bytes  │          │                              │
  └───────────────────────────────┘          └──────────────────────────────┘
     queryable, joinable, indexed               cheap, replicated, CDN-frontable
```

<C color="green">The database stores everything you might query on. The object store holds the bytes and nothing else.</C>

---

## 2. What object storage actually is

Not a filesystem. A **key–value store for large immutable values**, accessed over HTTP.

<Jargon
  plain="A store where each file has a name and you can only put, get, or delete it whole — never edit part of it."
  term="object storage"
  also={['blob storage', 'S3-compatible storage', 'a bucket']}>

The defining constraint is **immutability**: there is no seek, no append, no in-place edit. <C color="orange">To change one byte you upload the whole object again.</C> Everything else about it — the pricing, the durability, the scalability — follows from accepting that constraint.

</Jargon>

| Property | Detail |
| :--- | :--- |
| **Flat namespace** | "Folders" are a UI illusion; `photos/42/a.jpg` is just a key containing slashes |
| **Immutable objects** | Whole-object PUT and GET only. No partial writes |
| **HTTP API** | No mounting, no POSIX. `GET`/`PUT`/`DELETE` with authentication |
| **Extreme durability** | S3 quotes 99.999999999% (eleven nines) annual durability, via erasure coding across facilities |
| **Modest availability** | ~99.9% — <C color="orange">durability and availability are different promises</C> |
| **Effectively unlimited** | No capacity planning; petabytes are routine |
| **Per-request cost** | You pay per operation as well as per GB — <C color="crimson">millions of tiny objects can cost more in requests than in storage</C> |

**What it cannot do**, and these are the reasons you sometimes need something else:

- <C color="crimson">No partial updates</C> — changing one row of a 1 GB CSV means rewriting 1 GB.
- <C color="crimson">No rename</C> — a rename is a copy plus a delete, and for large objects that is genuinely expensive.
- <C color="crimson">No POSIX semantics</C> — no file locking, no `fseek` for writes, no directory operations that are atomic.
- <C color="crimson">Listing is slow and paginated</C> — `LIST` on a bucket with millions of keys is not a directory listing, and using it in a request path is a mistake.

<C color="green">If you need a real filesystem — random writes, locking, POSIX — you want a network filesystem (EFS, FSx) instead, at several times the price.</C>

---

## 3. Uploading without touching your servers

The most valuable pattern on this page. Most upload code routes bytes through the application, and it is unnecessary.

<Trace title="A 50 MB video upload" subtitle="First the obvious way, then the way that scales.">

<TraceStep
  title="The naive approach — proxy through your server"
  cost="50 MB through your app"
  state={{ 'Bytes through your app': '50 MB', 'App memory held': '~50 MB', 'Worker occupied': '~40 s', 'Bandwidth cost': 'in + out' }}
  changed={['Bytes through your app', 'App memory held', 'Worker occupied']}
  note="Works fine in development with one user on a fast connection. Falls apart under real traffic.">

The client `POST`s the file to your API. Your server buffers it, then uploads it to S3.

</TraceStep>

<TraceStep
  title="Why it fails at scale"
  cost="capacity collapse"
  state={{ 'Bytes through your app': '50 MB × N', 'App memory held': 'N × 50 MB', 'Worker occupied': '40 s each', 'Bandwidth cost': 'paid twice' }}
  changed={['Bytes through your app', 'App memory held', 'Bandwidth cost']}
  note="A hundred concurrent uploads on slow connections can exhaust a fleet that handles thousands of normal requests per second.">

<C color="crimson">Every concurrent upload holds a worker for the duration of a slow client's connection</C>, consumes memory or disk, and you pay ingress **and** egress bandwidth. Your request timeout must also exceed the slowest acceptable upload — which weakens it for every other endpoint.

</TraceStep>

<TraceStep
  title="Better — client asks your API for permission"
  state={{ 'Bytes through your app': '0', 'App memory held': '~0', 'Worker occupied': '~5 ms', 'Bandwidth cost': 'none' }}
  changed={['Bytes through your app', 'App memory held', 'Worker occupied', 'Bandwidth cost']}
  note="This is the only step your server is involved in — and it is a fast, small, ordinary request.">

`POST /uploads` with the filename, content type and size. Your server authenticates the user, validates the request (size limit, allowed type), generates a key, and returns a **presigned URL**.

</TraceStep>

<TraceStep
  title="The presigned URL — a time-limited capability"
  state={{ 'Bytes through your app': '0', 'App memory held': '~0', 'Worker occupied': '0', 'URL validity': '15 minutes' }}
  changed={['Worker occupied', 'URL validity']}
  note="Signed with your credentials, but computed locally — generating one makes no call to S3 at all.">

The URL embeds the bucket, key, an expiry, and a signature over those. <C color="green">It authorises exactly one operation, on exactly one key, for a limited time.</C> The client never receives your credentials.

</TraceStep>

<TraceStep
  title="Client uploads straight to S3"
  cost="0 load on you"
  state={{ 'Bytes through your app': '0', 'App memory held': '0', 'Worker occupied': '0', 'Upload path': 'client → S3 directly' }}
  changed={['Upload path']}
  note="For large files the client uses multipart upload — parallel parts, and a failed part retries alone rather than restarting 50 MB.">

The 50 MB goes from the client to S3 <C color="green">without passing through your infrastructure at all</C>.

</TraceStep>

<TraceStep
  title="Confirm, then process asynchronously"
  state={{ 'Bytes through your app': '0', 'DB row': 'created', 'Worker occupied': '~5 ms', 'Processing': 'queued' }}
  changed={['DB row', 'Worker occupied', 'Processing']}
  note="Prefer the S3 event over trusting the client to call back — a client that uploads and then crashes would otherwise leave an orphan.">

An **S3 event notification** fires on object creation, landing on a queue. A worker writes the database row and starts transcoding.

<H>Your API handled two small requests totalling ~10 ms of work, for a 50 MB upload. The bytes never touched your servers, and no worker was ever held open by a slow client.</H>

</TraceStep>

</Trace>

**Downloads work the same way in reverse:** for private files, return a short-lived presigned `GET` URL rather than streaming bytes through your application. For public files, put a CDN in front of the bucket and serve from the edge.

---

## 4. Storage classes and lifecycle

Object storage has tiers, and using them is one of the largest cost reductions available for the least work.

| Class | Relative cost | Retrieval | For |
| :--- | ---: | :--- | :--- |
| **Standard** | 1× | Instant | Active data |
| **Infrequent Access** | ~0.55× | Instant, plus a per-GB retrieval fee | Monthly access |
| **Glacier Instant** | ~0.25× | Instant, higher retrieval fee | Quarterly access |
| **Glacier Flexible** | ~0.15× | <C color="orange">Minutes to hours</C> | Archives |
| **Deep Archive** | ~0.04× | <C color="crimson">Up to 12 hours</C> | Compliance retention |

A **lifecycle policy** moves objects automatically as they age:

```
  after  30 days  → Infrequent Access
  after  90 days  → Glacier Instant
  after 365 days  → Deep Archive
  after   7 years → delete
```

For data with a typical access pattern — heavily read when new, almost never after a few months — <C color="green">this cuts the storage bill by 5–10× and requires no application changes at all.</C>

**The traps worth knowing:**

- <C color="crimson">Retrieval fees can exceed the savings</C> if you tier data you actually read. IA charges per GB retrieved; a "cold" dataset that turns out to be read weekly costs *more* in IA than in Standard.
- <C color="crimson">Minimum storage durations</C> — IA bills a minimum of 30 days, Glacier 90, Deep Archive 180. Deleting early still incurs the full minimum charge, which makes aggressive tiering of short-lived data actively counterproductive.
- <C color="crimson">Transition requests cost money too</C>, so lifecycle-transitioning millions of tiny objects can cost more than leaving them in Standard.

<Depth title="How eleven nines of durability is achieved, and what it does not protect you from">

"99.999999999% durability" means that if you store 10 million objects, you should expect to lose one **every 10,000 years**. It is worth understanding how that is reached, and — more importantly — what it does not cover.

**Erasure coding, not replication.** Naive triple replication gives 3× storage overhead for the ability to survive two failures. Erasure coding does better. An object is split into `k` data fragments and `m` parity fragments using Reed–Solomon codes; any `k` of the `k+m` fragments reconstruct the original.

With a common configuration like `k=10, m=4`: 14 fragments stored, any 10 sufficient, so **four simultaneous losses are survivable** at only 1.4× storage overhead — versus 3× for replication that survives two. Fragments are distributed across independent racks and facilities so correlated failure is unlikely.

**Continuous verification.** Background processes constantly read stored fragments, verify checksums, and rebuild any that fail — so bit rot and dying drives are repaired long before enough fragments are lost to threaten an object.

**Why durability and availability differ so much.** S3 quotes eleven nines of durability but only ~99.9% availability — a difference of eight orders of magnitude. They are different promises: durability says *the bytes still exist*; availability says *you can reach them right now*. A network partition or a control-plane failure makes data temporarily unreachable without endangering it, and that is the common failure mode.

**What eleven nines does not protect you from** — and every item here has caused real data loss at real companies:

- <C color="crimson">**You deleting it.**</C> A `DELETE` is faithfully executed with eleven nines of reliability. Durability is not backup. Enable **versioning** so deletes create markers rather than destroying data, and **MFA delete** on critical buckets.
- <C color="crimson">**A bad deploy overwriting objects.**</C> A `PUT` to an existing key replaces it. Without versioning, the previous content is gone.
- <C color="crimson">**Ransomware or a compromised credential.**</C> An attacker with write access can encrypt or delete everything. **Object Lock** in compliance mode makes objects genuinely immutable for a retention period — even to the account root.
- <C color="crimson">**Account-level loss.**</C> Billing failure, account closure or compromise affects every bucket at once. Genuinely critical data belongs in a second account or a second provider.
- <C color="crimson">**Region loss.**</C> Standard storage is one region. Cross-region replication is opt-in and costs extra.

<H>The lesson generalises: a provider's durability number describes their hardware, not your operational mistakes — and operational mistakes cause overwhelmingly more data loss than hardware failure does.</H>

</Depth>

---

## 5. Practical design notes

**Key naming.** Old advice said to randomise key prefixes to spread load across partitions. S3 removed that requirement in 2018 — <C color="green">use human-meaningful keys</C> like `photos/{user_id}/{uuid}.jpg`. Do include a UUID or content hash so keys are unique and never guessable by enumeration.

**Content-addressed keys.** Naming an object by the hash of its content gives free deduplication (identical files write once) and makes objects immutable by construction — the same reasoning as [versioned CDN URLs](../03-traffic-and-edge/03-cdn.md), so you can cache them forever.

**Never make a bucket public by default.** Public buckets are among the most common causes of data breaches. Serve private content through presigned URLs or a CDN with origin access control, and leave "block public access" on.

**Validate after upload, not before.** A client can claim any content type. Once the object lands, check the actual bytes — magic numbers, dimensions, a virus scan — in a worker, and quarantine anything that fails. <C color="crimson">Never trust the `Content-Type` the client supplied.</C>

**Store the metadata you will query.** Size, content type, dimensions, checksum and upload time belong in the database. Object stores support metadata on objects, but <C color="crimson">you cannot query it without listing the bucket</C> — which is slow, paginated, and wrong for a request path.

**Plan for orphans.** Uploads that never get confirmed, and database rows whose objects were deleted. Both accumulate. A periodic reconciliation job comparing the two is the standard fix — the same [drift detection](./05-normalization-and-denormalization.md) that any duplicated state needs.

---

## 6. In a design discussion

- **"Metadata in Postgres, bytes in S3, with the S3 key on the row."** The pattern, stated in one sentence.
- **"Presigned URLs so uploads go straight to S3 — our API handles a 5 ms permission request instead of holding a worker for a 50 MB transfer."** The scaling insight.
- **"An S3 event triggers processing rather than trusting the client to call back, so a client that crashes mid-upload doesn't leave an orphan."** Handles the failure case.
- **"Lifecycle to IA at 30 days and Glacier at 90 — though I'd check the access pattern first, because retrieval fees can exceed the savings."** Shows you know the trap.
- **"Versioning on, public access blocked. Eleven nines protects against disk failure, not against us deleting the wrong prefix."** The distinction that matters operationally.

---

## Rapid-fire recall

1. Give four specific costs of storing large files in a relational database.
2. What is the defining constraint of object storage, and name two things it makes impossible?
3. Why is durability quoted eight orders of magnitude higher than availability?
4. Why does proxying uploads through your application fail under load? Give three reasons.
5. What is a presigned URL, and what does generating one cost?
6. Why prefer an S3 event over a client callback to trigger processing?
7. Give two lifecycle traps that can make tiering cost more than it saves.
8. How does erasure coding beat triple replication? Use `k=10, m=4`.
9. Name four things eleven nines of durability does not protect against.
10. Why should queryable metadata live in the database rather than as object metadata?

<details>
<summary>Answers</summary>

1. **Backup/restore time** (your RTO becomes hostage to image volume) · **buffer cache pollution** (one 5 MB read evicts thousands of hot index pages) · **replication cost** (every byte to every replica) · **10–20× cost per GB** · no CDN path · connections held open during transfers.
2. **Immutability** — whole-object PUT/GET only. It makes **partial updates** impossible (changing one byte rewrites the whole object) and **rename** impossible (it becomes copy + delete). Also no POSIX locking or seeking.
3. They are different promises. **Durability** = the bytes still exist; **availability** = you can reach them right now. A network partition or control-plane failure makes data temporarily unreachable without endangering it.
4. Each upload **holds a worker** for the duration of a slow client's connection · it consumes **memory or disk** per concurrent upload · you pay **bandwidth twice** (ingress and egress) · your request timeout must exceed the slowest acceptable upload, weakening it for every endpoint.
5. A URL embedding a bucket, key, expiry and signature, authorising **one operation on one key for a limited time**. Generating one is **local computation** — no API call to S3 — so it is essentially free.
6. Because a client that uploads successfully and then crashes or loses connectivity never calls back, leaving an **orphaned object** with no database row. The storage event fires regardless of what the client does afterwards.
7. **Retrieval fees** — data you actually read costs more in IA than in Standard. **Minimum storage durations** — IA 30 days, Glacier 90, Deep Archive 180, charged in full even if deleted early. (Also: per-object transition requests cost money, so tiering millions of tiny objects can be counterproductive.)
8. With `k=10, m=4`, an object becomes 14 fragments of which any 10 reconstruct it — surviving **four simultaneous losses at 1.4× overhead**. Triple replication survives only two losses at 3× overhead.
9. **You deleting it** · **a bad deploy overwriting objects** · **ransomware or a compromised credential** · **account-level loss** (billing failure, closure, compromise) · **region loss**. Mitigations: versioning, MFA delete, Object Lock, a second account or provider, cross-region replication.
10. Because object metadata **cannot be queried without listing the bucket** — which is slow, paginated, and unsuitable for a request path. Anything you filter, sort or join on belongs in the database.

</details>

---

**Next:** Scaling The Data Layer — replication, sharding, consistent hashing, and moving data without downtime. *(Coming next.)*
