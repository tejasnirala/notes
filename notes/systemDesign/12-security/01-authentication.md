---
title: Authentication
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Authentication

> **What you will be able to do after this page**
>
> - Choose between sessions and tokens, knowing what each costs.
> - Explain why a JWT cannot be revoked, and what to do about it.
> - Trace an OAuth2 authorization code flow and say what each step prevents.
> - Store credentials correctly, and recognise the common mistakes.

<C color="orange">Authentication answers "who are you?"</C> — a different question from "what may you do?", which is [the next page](./02-authorization.md). Conflating them is the source of a large share of access-control bugs.

<Plain>

A building has a reception desk.

**Proving who you are** happens once, at the door. You show something only you should have — a card, a code, your face. The receptionist checks it and gives you a visitor badge.

**The badge is the interesting part**, and there are two ways to make one.

**A badge with a number on it, checked against a list.** The receptionist writes down "badge 447 = Anna, until 6pm". Anyone can check the list. If Anna is asked to leave at 3pm, <C color="green">they cross her off and badge 447 stops working immediately.</C> The cost is that every check requires consulting the list.

**A badge with the details written on it and an official seal.** "Anna, valid until 6pm", stamped so it cannot be forged. Anyone who recognises the seal can verify it without consulting anyone — <C color="green">much faster, and it works even if reception is closed.</C>

The catch is the one that matters: <C color="crimson">if Anna is asked to leave at 3pm, her badge still says valid until 6pm and still carries a genuine seal.</C> There is no list to cross her off. The only options are to check a list after all — defeating the point — or to issue badges that expire so quickly that being wrong barely matters.

That is the entire sessions-versus-tokens argument, and neither side wins outright.

</Plain>

---

## 1. Sessions versus tokens

| | Session (server-side) | JWT (self-contained) |
| :--- | :--- | :--- |
| Where state lives | <C color="orange">Server (Redis/DB)</C> | <C color="green">In the token</C> |
| Verification | Look it up | <C color="green">Verify a signature — no lookup</C> |
| Revocation | <C color="green">Immediate — delete it</C> | <C color="crimson">Not possible before expiry</C> |
| Scales across services | Needs a shared store | <C color="green">Any service with the public key</C> |
| Size | A small opaque id | <C color="crimson">Hundreds of bytes, on every request</C> |
| Can carry claims | Via lookup | <C color="green">Embedded</C> |

<Jargon
  plain="A signed blob of JSON that carries who you are and when it expires, verifiable without asking anyone."
  term="JWT — JSON Web Token"
  also={['bearer token', 'access token']}>

<C color="crimson">Signed, not encrypted</C> — anyone holding it can read its contents. Never put secrets in one. And "bearer" is literal: whoever holds it *is* the user, so a leaked token is a leaked account until it expires.

</Jargon>

**The revocation problem is the whole decision.** A stateless token cannot be withdrawn. Password changed, account compromised, employee terminated, permissions reduced — <C color="crimson">the issued token keeps working until it expires.</C>

The standard mitigations:

- <C color="green">**Short-lived access tokens** (5–15 minutes) plus a long-lived refresh token.</C> The refresh token *is* checked against server state, so revocation takes effect within one access-token lifetime. This is the usual answer.
- **A denylist of revoked token ids** — correct, and it reintroduces the lookup you avoided.
- **A `token_version` claim** compared against the user record — again a lookup, but a cheap and cacheable one.

<H>The honest summary: a JWT with a refresh token is not stateless. It is stateless for 5–15 minutes at a time, which is usually the right trade — but claiming full statelessness while running a refresh-token store is a common misdescription.</H>

---

## 2. OAuth2 and OIDC

<C color="orange">OAuth2 is an **authorization** framework — delegating access — routinely misused for authentication.</C> **OIDC** is the thin layer on top that does authentication properly, adding an `id_token` describing who the user is.

```
  OAuth2  →  "this app may read your calendar"      (delegated access)
  OIDC    →  "this user is alice@example.com"        (identity)
```

<Trace title="Authorization code flow with PKCE" subtitle='"Sign in with Google". Each step exists to prevent a specific attack.'>

<TraceStep
  title="App generates a code verifier"
  state={{ 'Stage': 'start', 'Code verifier': 'held by app only', 'Tokens issued': 'none', 'Attack blocked': 'code interception' }}
  changed={['Code verifier', 'Attack blocked']}
  note="PKCE. Without it, an attacker who intercepts the authorization code can redeem it themselves.">

A random `code_verifier` is created and kept locally; its SHA-256 hash (`code_challenge`) is sent with the request.

</TraceStep>

<TraceStep
  title="Redirect to the identity provider"
  state={{ 'Stage': 'at provider', 'State param': 'random, stored', 'Tokens issued': 'none', 'Attack blocked': 'CSRF' }}
  changed={['Stage', 'State param', 'Attack blocked']}
  note="The `state` parameter is checked on return — without it, an attacker can force a victim to log in as the attacker.">

The user is sent to Google with `client_id`, `redirect_uri`, `scope`, `state` and `code_challenge`. <C color="green">Credentials are entered at Google, never at your app.</C>

</TraceStep>

<TraceStep
  title="User authenticates and consents"
  state={{ 'Stage': 'consent', 'Password seen by app': 'NEVER', 'Tokens issued': 'none', 'Attack blocked': 'credential theft' }}
  changed={['Stage', 'Password seen by app']}
  note="The central benefit of federated login: your application never handles the password at all.">

Google authenticates the user and asks them to approve the requested scopes.

</TraceStep>

<TraceStep
  title="Redirect back with a code"
  state={{ 'Stage': 'callback', 'Code': 'in URL', 'Tokens issued': 'none', 'Attack blocked': 'token leakage via URL' }}
  changed={['Stage', 'Code', 'Attack blocked']}
  note="A short-lived, single-use code — not a token. URLs leak via history, referrers and logs, so a token here would be dangerous.">

The browser returns to `redirect_uri` carrying a **code**. Your app verifies `state` matches.

</TraceStep>

<TraceStep
  title="Exchange the code — back channel"
  cost="server to server"
  state={{ 'Stage': 'exchange', 'Code verifier': 'sent now', 'Tokens issued': 'access + id + refresh', 'Attack blocked': 'stolen code reuse' }}
  changed={['Stage', 'Code verifier', 'Tokens issued']}
  note="The verifier proves the exchanging party is the one that started the flow — so an intercepted code alone is useless.">

Your **server** posts the code plus `code_verifier` (plus a client secret, for confidential clients) to Google's token endpoint, over TLS, never through the browser.

</TraceStep>

<TraceStep
  title="Validate the id_token"
  cost="the step people skip"
  state={{ 'Stage': 'complete', 'Validated': 'signature, iss, aud, exp, nonce', 'Session': 'created', 'Attack blocked': 'token substitution' }}
  changed={['Stage', 'Validated', 'Session']}
  note="Accepting an id_token without checking `aud` lets a token issued for a different application authenticate against yours.">

Verify the **signature** against the provider's public keys, and check `iss`, `aud`, `exp` and `nonce`.

<H>Every step here blocks a specific attack. Implementations that skip PKCE, `state`, or `aud` validation look like they work and are exploitable — which is why using a maintained library beats hand-rolling this.</H>

</TraceStep>

</Trace>

---

## 3. Storing credentials

<C color="crimson">Never store a password in a form that can be reversed.</C> Not encrypted — hashed, with a slow, salted algorithm.

| Algorithm | Verdict |
| :--- | :--- |
| **Argon2id** | <C color="green">Best choice today</C> — memory-hard, tunable |
| **scrypt** | <C color="green">Good</C> — memory-hard |
| **bcrypt** | <C color="green">Acceptable</C> — widely available, 72-byte input limit |
| **PBKDF2** | <C color="orange">Acceptable where required by compliance</C> — not memory-hard |
| SHA-256, MD5, SHA-1 | <C color="crimson">Wrong — designed to be fast, which is the opposite of what you need</C> |

**Why slow and memory-hard.** A fast hash lets an attacker with the database try billions of guesses per second on a GPU. <C color="green">Memory-hard algorithms resist GPU and ASIC acceleration</C> because they need substantial RAM per guess, which parallel hardware cannot supply cheaply.

**Salting** — a unique random value per password, stored alongside — means identical passwords produce different hashes, defeating precomputed rainbow tables and preventing an attacker from cracking many accounts at once.

**Other rules that matter more than complexity requirements:**

- <C color="green">Check new passwords against a breached-password list</C> (Have I Been Pwned's k-anonymity API). This blocks credential stuffing, which is the actual attack.
- <C color="crimson">Drop composition rules</C> ("one uppercase, one symbol"). NIST no longer recommends them — they push users toward `Password1!` and reuse.
- <C color="green">Enforce a minimum length (12+), and allow long passphrases</C> and paste, so password managers work.
- <C color="crimson">Never expire passwords on a schedule</C> without cause — it produces predictable incremental changes.
- <C color="green">Rate limit login by IP and by account</C>, with progressive delays.
- <C color="green">Use a constant-time comparison</C> for tokens and hashes, to avoid timing leaks.

<Depth title="Where to put the token, and why every option is a trade">

The most consequential and least discussed decision in web authentication: where the browser stores its credential.

**`localStorage`.** Accessible from JavaScript, sent manually.

- <C color="green">Immune to CSRF</C> — not sent automatically, so a cross-site request carries nothing.
- <C color="crimson">Fully exposed to XSS.</C> Any injected script reads the token and exfiltrates it. Given the number of dependencies in a modern front end, this is a real and common risk.

**A cookie with `HttpOnly`.** Sent automatically, invisible to JavaScript.

- <C color="green">Immune to XSS theft</C> — script cannot read it, which is a large win.
- <C color="crimson">Vulnerable to CSRF</C> unless mitigated, precisely *because* it is sent automatically.

**The mitigations make the cookie the better default:**

```
  Set-Cookie: session=…; HttpOnly; Secure; SameSite=Lax; Path=/
```

- `HttpOnly` — no JavaScript access.
- `Secure` — HTTPS only.
- <C color="green">`SameSite=Lax`</C> — not sent on cross-site POSTs, which eliminates most CSRF. `Strict` is stronger and breaks inbound links from other sites.
- Plus an **anti-CSRF token** for state-changing requests where `SameSite` support is uncertain.

<H>The asymmetry that settles it: CSRF has a complete, well-understood mitigation you can apply once and rely on. XSS does not — it is a whole class of bug across every dependency you ship, and one instance defeats localStorage entirely.</H>

**The refresh-token pattern that follows:**

- **Refresh token** → `HttpOnly`, `Secure`, `SameSite`, scoped to the refresh path only.
- **Access token** → short-lived, kept **in memory** (a JavaScript variable, not `localStorage`), refreshed as needed.

An access token in memory dies with the tab and is never persisted anywhere a script can find later. On page load, the app calls the refresh endpoint, the cookie is sent automatically, and a new access token arrives. <C color="green">This gets XSS resistance for the long-lived credential and keeps the short-lived one out of persistent storage.</C>

**Refresh token rotation.** Issue a new refresh token on every use and invalidate the old one. If an old one is ever presented again, that means it was stolen and replayed — <C color="green">so revoke the entire family and force re-authentication.</C> This turns an undetectable theft into a detectable one.

**For mobile and native apps**, use the platform keystore (iOS Keychain, Android Keystore) rather than shared preferences or a file. **For server-to-server**, prefer [mTLS](../02-networking/03-tls.md) or short-lived workload identity over long-lived shared secrets.

</Depth>

---

## 4. In a design discussion

- **"Short-lived JWTs with refresh tokens — a plain JWT can't be revoked, so a compromised account stays valid until expiry."** The trade-off named.
- **"Refresh token in an `HttpOnly` `SameSite` cookie, access token in memory. XSS is a whole bug class; CSRF has a complete mitigation."** The reasoning behind the placement.
- **"Argon2id, and check new passwords against a breach list — credential stuffing is the actual attack, not brute force."** Current practice rather than folklore.
- **"OIDC, not raw OAuth2, for login. OAuth2 is an authorization framework and using it for identity is how you get token-substitution bugs."** A distinction most candidates miss.

---

## Rapid-fire recall

1. What question does authentication answer, and how does it differ from authorization?
2. Give the core trade between sessions and JWTs.
3. Why can a JWT not be revoked, and what are the three mitigations?
4. In what sense is "stateless JWT authentication" a misdescription?
5. Distinguish OAuth2 from OIDC.
6. What does PKCE prevent, and what does the `state` parameter prevent?
7. Why is a code returned in the URL rather than a token?
8. Which `id_token` claim, if unvalidated, allows token substitution?
9. Why must password hashes be slow and memory-hard, and what does salting prevent?
10. Why is an `HttpOnly` cookie generally safer than `localStorage`?

<details>
<summary>Answers</summary>

1. **"Who are you?"** Authorization answers **"what may you do?"** Conflating them causes a large share of access-control bugs.
2. **Sessions**: server-side state, so revocation is immediate, at the cost of a lookup per request and a shared store. **JWTs**: self-contained and verifiable without a lookup, at the cost of **being unrevocable before expiry**.
3. Because it is **self-contained and verified by signature alone** — no server is consulted. Mitigations: **short-lived access tokens plus a checked refresh token**, a **denylist of revoked ids**, or a **`token_version` claim** compared to the user record (the last two reintroduce a lookup).
4. Because the **refresh token is checked against server state**. The system is stateless only for the 5–15 minute access-token lifetime, while still operating a refresh-token store.
5. **OAuth2** is an **authorization** framework for delegating access ("this app may read your calendar"). **OIDC** is a layer on top providing **authentication**, adding an `id_token` that states who the user is.
6. **PKCE** prevents an intercepted authorization code from being redeemed by an attacker, by requiring the `code_verifier` known only to the initiator. **`state`** prevents **CSRF** on the callback — an attacker forcing a victim to complete a login as the attacker.
7. Because **URLs leak** through browser history, referrer headers and server logs. A code is **short-lived and single-use**, and is exchanged for tokens over a server-to-server back channel.
8. **`aud`** (audience). Without checking it, a token legitimately issued for a *different* application will authenticate against yours.
9. **Slow and memory-hard** so an attacker with the database cannot try billions of guesses per second on GPUs — memory-hardness defeats GPU and ASIC parallelism. **Salting** gives identical passwords different hashes, defeating rainbow tables and preventing many accounts being cracked at once.
10. Because `HttpOnly` makes the token **unreadable by JavaScript**, so XSS cannot steal it. Its weakness — CSRF — has a **complete, well-understood mitigation** (`SameSite`, anti-CSRF tokens), whereas XSS is an open-ended bug class that entirely defeats `localStorage`.

</details>

---

**Next:** [Authorization](./02-authorization.md) — deciding what someone may do.
