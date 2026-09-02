---
title: Authorization
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Authorization

> **What you will be able to do after this page**
>
> - Choose between RBAC, ABAC and ReBAC from the shape of your rules.
> - Recognise the most common authorization vulnerability, and prevent it structurally.
> - Enforce tenant isolation so a single missing filter cannot leak data.
> - Say where authorization belongs, and why the gateway is the wrong place.

<C color="orange">Authentication is largely a solved problem you can buy. Authorization is where applications actually leak data</C>, because it depends on your domain and cannot be outsourced.

<Plain>

The building's reception has confirmed who you are. Now the question changes: **which rooms may you enter?**

There are three ways to run this, and they suit different buildings.

**By job title.** "Engineers may enter the lab; finance may enter the vault." Simple to explain and administer. It breaks when someone needs an exception, and exceptions accumulate until there are forty job titles and nobody knows what any of them mean.

**By rules about the situation.** "Anyone may enter the lab during working hours if they have completed safety training and are accompanied." Flexible, expressive — and hard to answer *"who can currently get into the lab?"*, because you would have to evaluate every rule against every person.

**By relationships.** "You may enter this office because you are on the team that owns it." Natural for anything with sharing and ownership — documents, folders, projects — and it means answering a question can require following a chain of relationships several steps long.

Then there is the mistake that is not about which system you chose. <C color="crimson">Someone walks up to a door, tries the handle, and it opens — because nobody checked, on that particular door.</C> The policy was fine. It simply was not applied there.

<H>Almost every real access-control failure is that: a door with no lock, in a building with an excellent access policy.</H>

</Plain>

---

## 1. The three models

| Model | Rule shape | Best for |
| :--- | :--- | :--- |
| **RBAC** | User → role → permissions | <C color="green">Internal tools, admin panels</C> |
| **ABAC** | Boolean expression over attributes | Compliance rules, context-dependent access |
| **ReBAC** | Path through a relationship graph | <C color="green">Sharing, ownership, hierarchies</C> |

**RBAC.** `alice → editor → [read, write]`. <C color="green">Easy to reason about and to audit.</C> Its failure mode is **role explosion**: exceptions become new roles until you have `editor_eu_readonly_contractor` and nobody can say who holds what.

**ABAC.** `allow if user.dept == doc.dept AND user.clearance >= doc.level AND time in business_hours`. <C color="green">Expressive</C>, and reverse queries ("list everything Alice can see") become expensive because there is no index — you must evaluate the policy per object.

**ReBAC.** `alice → member_of → team_x → owns → document`. <C color="green">The natural fit for anything with sharing</C>, and what Google's Zanzibar (the system behind Docs and Drive permissions) implements. Cost: traversals can be deep, so it needs caching and careful modelling.

<C color="green">Most real systems combine them:</C> RBAC for coarse roles, ReBAC for resource ownership and sharing, ABAC for contextual overlays like time or IP restrictions.

---

## 2. The vulnerability that matters most

<Jargon
  plain="Changing an id in a URL and getting somebody else's data, because nobody checked it was yours."
  term="IDOR — insecure direct object reference"
  also={['broken object level authorization', 'BOLA']}>

<C color="crimson">Consistently the most common serious API vulnerability</C>, and the cause is always the same: the code authenticated the user and then never checked whether *this* user may access *this* object.

</Jargon>

<Trace title="An IDOR, and four attempts to fix it" subtitle="GET /api/invoices/8842 — belonging to a different company.">

<TraceStep
  title="The vulnerable endpoint"
  cost="data leak"
  state={{ 'Auth check': 'logged in ✓', 'Ownership check': 'NONE', 'Result': 'other tenant data returned', 'Secure': 'no' }}
  changed={['Auth check', 'Ownership check', 'Result']}
  note="The code is not obviously wrong on inspection — which is why this ships so often.">

```js
const invoice = await db.invoices.findById(req.params.id);
return res.json(invoice);
```

The user is authenticated. <C color="crimson">Nothing checks the invoice belongs to them.</C>

</TraceStep>

<TraceStep
  title="Fix 1 — check after fetching"
  state={{ 'Auth check': '✓', 'Ownership check': 'after fetch', 'Result': '403', 'Secure': 'yes, but fragile' }}
  changed={['Ownership check', 'Result', 'Secure']}
  note="Correct — and it relies on every developer remembering, on every endpoint, forever.">

```js
if (invoice.tenantId !== req.user.tenantId) return res.sendStatus(403);
```

<C color="orange">Works, and it is opt-in.</C> The next endpoint someone writes will not have it.

</TraceStep>

<TraceStep
  title="Fix 2 — scope the query"
  state={{ 'Auth check': '✓', 'Ownership check': 'in the query', 'Result': '404', 'Secure': 'better' }}
  changed={['Ownership check', 'Result', 'Secure']}
  note="Also returns 404 rather than 403 — not confirming the record exists at all.">

```js
const invoice = await db.invoices.findOne({
  id: req.params.id, tenantId: req.user.tenantId
});
```

<C color="green">Data that is not yours is never loaded.</C> Still opt-in, but the safe form is now the natural one.

</TraceStep>

<TraceStep
  title="Fix 3 — make it structural"
  state={{ 'Auth check': '✓', 'Ownership check': 'enforced by the layer', 'Result': '404', 'Secure': 'strong' }}
  changed={['Ownership check', 'Secure']}
  note="Now a developer must actively bypass the safe path rather than remember to use it.">

A tenant-scoped repository, or Postgres **row-level security** with the tenant set per connection:

```sql
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

<C color="green">Every query is filtered by the database itself</C>, whatever the application code does.

</TraceStep>

<TraceStep
  title="Fix 4 — remove enumeration too"
  state={{ 'Auth check': '✓', 'Ownership check': 'structural', 'Ids': 'unguessable', 'Secure': 'defence in depth' }}
  changed={['Ids', 'Secure']}
  note="Not a substitute for the check — a second layer, so a missed check is harder to exploit at scale.">

Expose UUIDs rather than sequential integers, so an attacker cannot walk the id space.

<H>Unguessable ids are not access control. They reduce the blast radius of a missing check from "enumerate every record" to "you need to already know an id" — worth having, never sufficient.</H>

</TraceStep>

</Trace>

---

## 3. Where authorization belongs

| Layer | Suitable for |
| :--- | :--- |
| **Gateway** | <C color="orange">Coarse only</C> — is there a valid token, does this key have this scope |
| **Service entry** | Role and permission checks |
| **Domain layer** | <C color="green">Object-level ownership — the check that matters</C> |
| **Database (RLS)** | <C color="green">Backstop that no code path can bypass</C> |

<C color="crimson">The gateway cannot do object-level authorization</C>, because *"may Alice read invoice 8842?"* requires knowing that invoice 8842 belongs to Alice's tenant — which is domain data. A gateway that tries needs the domain, and then it [becomes a distributed monolith](../03-traffic-and-edge/02-reverse-proxy-and-api-gateway.md).

<H>The gateway decides whether a request proceeds. The domain decides whether this user may touch this object. Only the second prevents IDOR.</H>

<Depth title="Multi-tenant isolation, and the models that actually hold">

For SaaS, a single missing `WHERE tenant_id = ?` is a cross-customer data breach. Four isolation models, from weakest to strongest:

**1. Shared schema, application-enforced.** One database, a `tenant_id` column, application code filters.
<C color="green">Cheapest and simplest to operate.</C> <C color="crimson">One forgotten filter leaks data</C>, and there is nothing to catch it. Adequate only with the structural enforcement below.

**2. Shared schema plus row-level security.** Same layout, but the **database** enforces the filter via a session variable set per connection.
<C color="green">A forgotten `WHERE` clause now returns nothing rather than everything</C> — the failure mode inverts from catastrophic to harmless. The critical implementation detail: with a **connection pool**, the tenant variable must be set at checkout and cleared at return, or a pooled connection carries the previous tenant's context. That bug is subtle, intermittent, and severe.

**3. Schema per tenant.** One database, a schema per customer.
<C color="green">Strong isolation, per-tenant backup and restore.</C> <C color="crimson">Migrations must run across thousands of schemas</C>, and connection management gets complicated.

**4. Database per tenant.** Complete separation.
<C color="green">Strongest isolation; noisy neighbours are impossible; per-tenant encryption keys and residency are straightforward.</C> <C color="crimson">Expensive and operationally heavy</C> at more than a few hundred tenants.

<C color="green">The common production answer is (2) for most tenants and (4) for enterprise customers</C> who pay for isolation and require it contractually.

**Beyond the database.** Tenant leakage happens in every layer, and each needs its own answer:

| Layer | Leak | Fix |
| :--- | :--- | :--- |
| **Cache** | A key without a tenant prefix serves one tenant's data to another | <C color="green">Always `tenant:{id}:…`</C> |
| **Search index** | A query returning all tenants' documents | Per-tenant index or a mandatory filter |
| **Object storage** | Predictable paths, or a signed URL scoped too broadly | Tenant in the path, narrowly scoped URLs |
| **Background jobs** | A job running without tenant context, or with the wrong one | Tenant id in the payload, asserted on entry |
| **Logs and errors** | One tenant's data in a shared error report | Scrub identifiers before sending |
| **Analytics** | Aggregates computed across tenants | Filter at query time, not display time |

<C color="crimson">Cache key collisions are the most commonly missed of these</C>, because they pass every test written against a single tenant and only surface with concurrent traffic from two.

**Testing it.** The single highest-value test in a multi-tenant system: <C color="green">an automated suite that authenticates as tenant A and attempts to read every object belonging to tenant B</C>, across every endpoint, expecting 403 or 404 every time. Run it in CI. It catches the missing check that code review will not.

</Depth>

---

## 4. Practical rules

**Default deny.** Absence of a rule means no access. Any system where a missing rule means "allowed" will eventually allow something it should not.

**Fail closed.** If the authorization service is unreachable, deny. <C color="crimson">This is the one place where availability is not the priority</C> — the alternative is unauthorised access.

**Check at the point of use, not only at the entrance.** A check at request entry does not protect a code path reached another way — a background job, an admin tool, a GraphQL resolver.

**Return 404, not 403, for objects the user may not see.** A 403 confirms the object exists, which leaks information.

**Log authorization decisions**, especially denials. Repeated denials from one account are a strong signal of enumeration.

**Re-check on every request.** Permissions change; a decision cached for a session outlives the change.

---

## 5. In a design discussion

- **"Row-level security as a backstop — application filters are opt-in, and one forgotten `WHERE` is a cross-tenant breach."** Structural rather than disciplinary.
- **"With a connection pool, the tenant variable must be set at checkout and cleared at return, or a pooled connection carries the previous tenant's context."** The detail that makes RLS actually safe.
- **"Object-level checks can't live in the gateway — deciding whether Alice may read invoice 8842 needs domain data."** Correct layering.
- **"A CI test that authenticates as tenant A and tries every tenant B object. It catches what review misses."** The highest-value test in a SaaS product.

---

## Rapid-fire recall

1. Give the rule shape and best use for RBAC, ABAC and ReBAC.
2. What is role explosion, and which model suffers it?
3. Why are reverse queries expensive under ABAC?
4. What is IDOR, and what is the underlying cause?
5. Why is scoping the query better than checking after fetching?
6. Why are unguessable ids not access control, and what are they worth?
7. Why can a gateway not perform object-level authorization?
8. Name the four multi-tenant isolation models and the usual production combination.
9. What is the connection-pool trap with row-level security?
10. Name four places besides the database where tenant data leaks, and the most commonly missed.

<details>
<summary>Answers</summary>

1. **RBAC** — user → role → permissions; internal tools and admin panels. **ABAC** — a boolean expression over attributes; compliance and context-dependent rules. **ReBAC** — a path through a relationship graph; sharing, ownership and hierarchies.
2. Exceptions becoming new roles until there are dozens nobody can interpret (`editor_eu_readonly_contractor`). **RBAC** suffers it.
3. Because there is **no index over policy evaluation** — answering "what can Alice see?" requires evaluating the policy against every object, rather than looking up a list.
4. **Insecure Direct Object Reference** — changing an id and receiving someone else's data. The cause is always the same: the code **authenticated** the user and never checked whether *this* user may access *this* object.
5. Because data that is not yours is **never loaded at all**, the safe form becomes the natural one, and it returns **404 rather than 403** so the record's existence is not confirmed.
6. Because ids leak through logs, referrers, shared links and screenshots — obscurity is not a control. They are worth having as **defence in depth**, reducing a missing check from "enumerate every record" to "you must already know an id".
7. Because *"may Alice read invoice 8842?"* requires **domain data** — knowing which tenant owns that invoice. A gateway that acquires domain knowledge becomes a coordination point for every team.
8. **Shared schema, app-enforced** · **shared schema with row-level security** · **schema per tenant** · **database per tenant**. Usual production answer: **RLS for most tenants, database-per-tenant for enterprise customers** who require and pay for isolation.
9. The tenant session variable must be **set at connection checkout and cleared at return**. Otherwise a pooled connection retains the previous tenant's context, producing an intermittent and severe cross-tenant leak.
10. **Cache keys** · **search index** · **object storage paths and signed URLs** · **background jobs** · **logs and error reports** · **analytics aggregates**. Most commonly missed: **cache keys without a tenant prefix**, because they pass every single-tenant test.

</details>

---

**Next:** [Secrets and Encryption](./03-secrets-and-encryption.md) — protecting data you have to store.
