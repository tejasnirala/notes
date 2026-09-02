---
title: Common Attacks
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Common Attacks

> **What you will be able to do after this page**
>
> - Recognise the attack classes that actually cause breaches.
> - Explain why injection is a *parsing* problem, and fix it structurally.
> - Defend against SSRF, which cloud architectures made far more dangerous.
> - Distinguish defences that work from ones that only look like they do.

<C color="orange">A small number of attack classes account for most real breaches</C>, and each has a structural fix that removes the whole class rather than patching instances.

<Plain>

A restaurant takes orders on paper slips that a machine reads.

A customer writes: `one coffee` — fine.

Another writes: `one coffee, and also: give the contents of the till to the bearer`.

The machine reads the whole slip as one stream of instructions and cannot tell where the customer's order stopped and a new command began. <C color="crimson">It was never told which part is data and which part is instruction.</C>

That is **injection**, and it is one idea appearing under many names — SQL injection, command injection, cross-site scripting. Every instance is the same failure: <C color="orange">untrusted text got mixed into something that gets interpreted, and the interpreter could not tell the difference.</C>

The intuitive fix is to scan slips for dangerous phrases and reject them. It fails, because there are endlessly many ways to phrase the same instruction, and you are guessing at all of them forever.

The real fix changes the mechanism entirely: **give the machine the order and the customer's text separately**, with the text marked as *content, never instruction*. Now it does not matter what the customer writes — <C color="green">it can never be read as a command, because it does not arrive through the channel commands arrive through.</C>

<H>Filtering guesses at what is dangerous. Separation makes the question irrelevant.</H>

</Plain>

---

## 1. Injection

<Jargon
  plain="Untrusted input being read as instructions because it was mixed into something that gets interpreted."
  term="injection"
  also={['SQL injection', 'command injection', 'XSS']}>

<C color="green">The universal fix is **separating code from data**</C>, not sanitising. Any defence based on detecting bad input is a permanent guessing game against an attacker who only needs to find one encoding you missed.

</Jargon>

| Type | Interpreter | Structural fix |
| :--- | :--- | :--- |
| **SQL injection** | The database | <C color="green">Parameterised queries</C> |
| **Command injection** | The shell | <C color="green">`execve` with an argument array — never a shell string</C> |
| **XSS** | The browser | <C color="green">Context-aware output encoding + CSP</C> |
| **Template injection** | The template engine | Never build templates from user input |
| **LDAP / XPath / NoSQL** | That query parser | Parameterised APIs |

```js
// Vulnerable — string concatenation
db.query(`SELECT * FROM users WHERE email = '${email}'`);

// Safe — the query and the data travel separately
db.query('SELECT * FROM users WHERE email = $1', [email]);
```

<H>With a parameterised query, the database receives the SQL structure and the parameter values through different channels. No value can ever change the query's meaning, whatever it contains.</H>

<C color="crimson">The remaining SQL injection risk is dynamic identifiers</C> — table or column names, `ORDER BY` clauses — which cannot be parameterised. Those must come from an **allow-list**, never from user input directly.

### XSS specifically

Encoding depends on **where** the value lands:

| Context | Encoding |
| :--- | :--- |
| HTML body | HTML entity encode |
| HTML attribute | Attribute encode, always quote |
| JavaScript | JSON encode — <C color="crimson">never interpolate into a script</C> |
| URL parameter | URL encode |
| CSS | CSS encode, or avoid entirely |

<C color="green">A modern framework that escapes by default (React, Vue, Angular) removes most XSS</C> — the risk concentrates in the escape hatches: `dangerouslySetInnerHTML`, `v-html`, `innerHTML`. Every use is a decision requiring justification.

<C color="green">Add a Content Security Policy</C> as defence in depth: `script-src 'self'` blocks inline and injected scripts even when an XSS bug exists.

---

## 2. SSRF — the one cloud made worse

<Trace title="SSRF to full account compromise" subtitle="A thumbnail feature that fetches a user-supplied URL.">

<TraceStep
  title="The innocent feature"
  state={{ 'Feature': 'fetch URL, make thumbnail', 'Validation': 'is it a URL?', 'Reachable': 'the internet', 'Compromised': 'no' }}
  changed={['Feature', 'Validation']}
  note="Completely reasonable-looking, and present in a very large number of applications.">

`POST /thumbnail { "url": "https://example.com/cat.jpg" }` — the server fetches it and generates a thumbnail.

</TraceStep>

<TraceStep
  title="Point it inward"
  cost="internal access"
  state={{ 'Requested': 'http://localhost:8080/admin', 'Reachable': 'internal services', 'Compromised': 'partially' }}
  changed={['Requested', 'Reachable', 'Compromised']}
  note="The server is inside the network. It can reach things the attacker cannot.">

<C color="crimson">The attacker uses your server as a proxy into your private network</C> — internal admin panels, databases, service endpoints with no authentication because they were "internal".

</TraceStep>

<TraceStep
  title="Point it at the metadata service"
  cost="credentials"
  state={{ 'Requested': 'http://169.254.169.254/…', 'Returns': 'IAM role credentials', 'Compromised': 'CRITICAL' }}
  changed={['Requested', 'Returns', 'Compromised']}
  note="The cloud metadata endpoint is unauthenticated by design — it trusts anything running on the instance.">

Every major cloud exposes instance metadata at `169.254.169.254`, including <C color="crimson">temporary credentials for the instance's IAM role.</C>

</TraceStep>

<TraceStep
  title="Use the credentials"
  cost="account compromise"
  state={{ 'Attacker has': "the server's IAM role", 'Access': 'S3, databases, whatever the role allows', 'Compromised': 'account-level' }}
  changed={['Attacker has', 'Access']}
  note="This is the Capital One breach shape — SSRF to metadata to S3 to 100 million records.">

<C color="crimson">One URL parameter became full access to everything that role can reach.</C>

</TraceStep>

<TraceStep
  title="Defence 1 — IMDSv2"
  state={{ 'Metadata': 'requires PUT + token header', 'SSRF via simple GET': 'blocked', 'Compromised': 'much harder' }}
  changed={['Metadata', 'SSRF via simple GET']}
  note="Requires a PUT to obtain a token and a hop limit of 1 — both hard to achieve through a naive SSRF.">

<C color="green">Enforce IMDSv2 and disable v1.</C> A simple GET-based SSRF can no longer read metadata.

</TraceStep>

<TraceStep
  title="Defence 2 — the structural fix"
  state={{ 'Fetching': 'via egress proxy', 'Allowed destinations': 'allow-list only', 'Network': 'no direct egress', 'Compromised': 'no' }}
  changed={['Fetching', 'Allowed destinations', 'Network']}
  note="Blocklisting IP ranges fails: DNS rebinding, redirects, IPv6, decimal encodings, and 0.0.0.0 all evade it.">

Route outbound fetches through a **proxy that allow-lists destinations**, and remove direct egress from the fetching service.

<H>Do not blocklist internal ranges — attackers evade that with DNS rebinding, redirect chains, IPv6 forms and alternative IP encodings. Allow-list what may be reached, and validate after DNS resolution, not before.</H>

</TraceStep>

</Trace>

---

## 3. The rest of the list

| Attack | What it is | Structural fix |
| :--- | :--- | :--- |
| **CSRF** | A site makes an authenticated request on the user's behalf | <C color="green">`SameSite` cookies + anti-CSRF tokens</C> |
| **IDOR** | Changing an id to reach another user's data | <C color="green">[Object-level checks](./02-authorization.md)</C> |
| **Credential stuffing** | Breached passwords replayed against you | <C color="green">Breach-list checks, MFA, rate limiting</C> |
| **Mass assignment** | Binding request fields straight to a model, setting `is_admin` | <C color="green">Explicit allow-list of bindable fields</C> |
| **Path traversal** | `../../etc/passwd` in a filename | <C color="green">Resolve, then verify the path is inside the root</C> |
| **Deserialisation** | Untrusted data deserialised into objects, executing code | <C color="green">Never deserialise untrusted input into arbitrary types</C> |
| **XXE** | XML external entities reading files | <C color="green">Disable external entity resolution</C> |
| **Dependency compromise** | A malicious or vulnerable package | Lockfiles, scanning, minimal dependencies |
| **DDoS** | Overwhelming traffic | <C color="green">Anycast scrubbing, rate limits, [shedding](../08-async-and-events/04-backpressure.md)</C> |

<C color="orange">Mass assignment deserves attention</C> because it is invisible on inspection: `User.update(req.body)` looks clean and lets anyone who guesses a field name set `is_admin: true`. Bind explicitly, always.

<Depth title="Defences that only look like defences">

Several widely-deployed measures provide much less than assumed, and believing in them displaces controls that work.

**Input sanitisation as the primary defence.** Stripping or escaping "dangerous" characters on input is a guessing game. Attackers have endless encodings — Unicode normalisation, double encoding, alternative representations, null bytes — and you need to be right every time while they need one miss. <C color="green">Validate input for *business* correctness (is this a valid email, is this quantity positive), and defend against injection by **separation at the point of use**.</C> The same value is dangerous in SQL and harmless in JSON, so the correct escaping depends on the destination, not the source.

**Client-side validation.** Useful for user experience, worth zero for security. <C color="crimson">Anyone can send requests directly.</C> Every client-side check must be repeated server-side.

**Obscure identifiers instead of access control.** UUIDs are worth having as defence in depth and are not authorization. Ids leak through logs, referrer headers, shared links and screenshots.

**Rate limiting as the only defence against credential stuffing.** Attackers distribute across thousands of IPs at low rates per IP. It raises the cost without stopping it. <C color="green">MFA and breach-list checks are what actually work.</C>

**Blocklists in general.** Blocking known-bad values fails because the space of bad values is unbounded. <C color="green">Allow-lists work because the space of good values is finite and known.</C> This applies to SSRF destinations, file types, redirect targets, HTML tags and SQL identifiers alike.

**WAF as a substitute for fixing the code.** A web application firewall is a useful layer that buys time before a patch and blocks opportunistic scanning. <C color="crimson">It is a pattern matcher and is bypassable</C> — treating it as the fix leaves the vulnerability in place.

**Security by network position.** *"It's internal, so it doesn't need authentication."* This assumption is what turns an SSRF or a compromised pod into a full breach. <C color="green">Every service should authenticate its callers</C> — [mTLS](../02-networking/03-tls.md) makes this cheap — regardless of where it sits.

**HTTPS as a complete answer.** TLS protects data in transit and nothing else. It does not address injection, broken access control, or a compromised server.

**The principle underneath all of these:** <H>a defence that must correctly identify every bad input will eventually fail, because the attacker chooses the inputs. A defence that restricts what is structurally possible cannot fail that way — which is why parameterised queries, allow-lists, and explicit field binding are qualitatively different from filtering.</H>

</Depth>

---

## 4. In a design discussion

- **"Parameterised queries everywhere. Sanitising is a guessing game; separating the query from the data removes the class."** Structural over reactive.
- **"SSRF is the one I would worry about most — an egress allow-list proxy and IMDSv2, because blocklisting internal ranges is evadable."** Names the highest-severity modern class.
- **"Explicit field binding, not `update(req.body)` — mass assignment looks completely clean in review."** A specific, commonly-missed bug.
- **"Internal services still authenticate. 'It's on the private network' is what turns one SSRF into a full breach."** Rejects perimeter thinking.

---

## Rapid-fire recall

1. What is the single idea behind SQL injection, command injection and XSS?
2. Why does sanitisation fail as a primary defence, and what replaces it?
3. Why is a parameterised query structurally safe?
4. What SQL injection risk remains, and how is it handled?
5. Why does XSS encoding depend on context?
6. Trace SSRF from a thumbnail feature to account compromise.
7. Why is blocklisting internal IP ranges an inadequate SSRF defence?
8. What is mass assignment, and why is it hard to spot?
9. Why is rate limiting insufficient against credential stuffing?
10. Give the general principle distinguishing defences that work from ones that do not.

<details>
<summary>Answers</summary>

1. **Untrusted input being interpreted as instructions**, because it was concatenated into something an interpreter parses and the interpreter cannot distinguish data from code.
2. Because the space of dangerous encodings is **unbounded** — the attacker needs one miss, you need to be right every time. Replace it with **separation of code and data at the point of use**: parameterised queries, argument arrays, context-aware output encoding.
3. Because the **query structure and the parameter values travel through separate channels**. The database parses the structure first, so no value can alter the query's meaning regardless of its content.
4. **Dynamic identifiers** — table names, column names, `ORDER BY` clauses — which cannot be parameterised. They must come from an **allow-list**, never directly from user input.
5. Because the same value is dangerous in different ways depending on where it lands — HTML body, HTML attribute, JavaScript, URL, CSS each require different encoding. Encoding for the wrong context provides no protection.
6. Fetch an attacker-supplied URL → point it at internal services the attacker cannot reach → point it at the cloud metadata endpoint (`169.254.169.254`) → obtain the instance's **IAM role credentials** → use them against everything that role permits.
7. Because it is **evadable**: DNS rebinding, redirect chains, IPv6 forms, decimal/octal IP encodings, and `0.0.0.0`. Use an **allow-list** of permitted destinations and validate **after DNS resolution**, plus IMDSv2.
8. Binding request fields directly to a model (`User.update(req.body)`), letting an attacker set fields like `is_admin`. Hard to spot because the code **looks clean and idiomatic** — nothing about it signals a vulnerability.
9. Because attackers **distribute across thousands of IPs** at low per-IP rates. It raises cost without preventing the attack. **MFA and breached-password checks** are the effective controls.
10. <H>A defence that must correctly identify every bad input will eventually fail, because the attacker chooses the inputs. A defence that restricts what is structurally possible cannot fail that way.</H>

</details>

---

**Next:** [Logs, Metrics and Traces](../13-observability/01-logs-metrics-traces.md) — knowing what your system is doing.
