---
title: Search Autocomplete
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Search Autocomplete

> **What you will be able to do after this page**
>
> - Serve prefix suggestions in single-digit milliseconds.
> - Explain why a trie alone is not the answer, and what completes it.
> - Handle the enormous read volume autocomplete generates.
> - Keep suggestions fresh without rebuilding the index constantly.

Autocomplete has an unusual profile: <C color="orange">a query on every keystroke, a latency budget under 100 ms, and a result set that is mostly the same for everyone.</C> That combination decides the design.

<Plain>

A shop assistant is asked to finish people's sentences.

A customer says *"choc…"* and the assistant must instantly suggest the five most likely things — chocolate, chocolate biscuits, chocolate cake.

**The slow way:** read the whole product list and pick out everything starting with "choc". Fifty thousand products, every time, on every letter typed. The customer types six letters and this happens six times.

**Better:** keep an index card box, alphabetical, with dividers. Flip to "cho" and the matching products are physically together — you never look at anything else.

<C color="green">And there is one more step that is where the real speed comes from.</C> On the divider itself, write the five best answers for that prefix. Now the assistant does not even read the cards behind it — they read the divider and answer.

That precomputation is the whole trick. <C color="orange">The set of things people type is small and changes slowly, while the number of times they type them is enormous.</C> So you do the work once per prefix, in advance, and every request afterwards is a single lookup.

The consequence is the trade you accept: a new product does not appear in suggestions until the dividers are rewritten. For a search box, being a few minutes behind is invisible.

</Plain>

---

## 1. Why a trie is not enough

<Jargon
  plain="A tree where each level is one character, so a prefix is a path from the root."
  term="trie (prefix tree)"
  also={['prefix tree', 'digital tree', 'radix tree']}>

Finding a prefix is `O(length of prefix)` — <C color="green">independent of how many terms exist.</C> A radix tree (compressing single-child chains) reduces memory substantially.

</Jargon>

```
        (root)
          │c
          o
          ├─ f ─ f ─ e ─ e     "coffee"
          └─ l ─ d            "cold"
```

<C color="crimson">The trie finds the subtree, and that is only half the problem.</C> The prefix `co` may have 50,000 descendants, and you need the **top 5 by popularity**. Walking the subtree to rank them is `O(descendants)` — exactly the scan you were avoiding.

<C color="green">The fix: store the top K at every node.</C> Each node caches its own best suggestions, so a lookup is a descent to the node and a read — no subtree traversal at all.

<Trace title="Serving 'cof' in under 5 ms" subtitle="Each step removes work from the request path.">

<TraceStep
  title="Scan every term"
  cost="unusable"
  state={{ 'Terms': '50M', 'Work per query': 'scan 50M', 'Latency': '~seconds', 'QPS supported': '<10' }}
  changed={['Terms', 'Work per query', 'Latency']}
  note="A LIKE 'cof%' query against a large table, which is where most first attempts start.">

Filter all terms by prefix, sort by popularity, take 5.

</TraceStep>

<TraceStep
  title="Trie lookup"
  state={{ 'Work per query': 'descend 3 nodes + rank subtree', 'Subtree size': '~120K', 'Latency': '~80 ms', 'QPS supported': 'hundreds' }}
  changed={['Work per query', 'Subtree size', 'Latency', 'QPS supported']}
  note="The descent is instant; ranking 120,000 descendants is not.">

<C color="green">Finding the `cof` node is three steps.</C> <C color="crimson">Ranking its descendants dominates.</C>

</TraceStep>

<TraceStep
  title="Precompute top-K at each node"
  cost="the key change"
  state={{ 'Work per query': 'descend 3 nodes, read 5', 'Latency': '~1 ms', 'QPS supported': 'very high', 'Memory': 'higher' }}
  changed={['Work per query', 'Latency', 'QPS supported', 'Memory']}
  note="Storing 5 suggestions per node costs memory and removes all ranking from the request path.">

Each node holds its five best completions, computed offline.

<C color="green">A query is a three-step descent and a read of a small list.</C>

</TraceStep>

<TraceStep
  title="Flatten it into a key-value store"
  state={{ 'Structure': 'prefix → top-5 list', 'Work per query': '1 lookup', 'Latency': '~0.5 ms', 'Scales by': 'adding cache nodes' }}
  changed={['Structure', 'Work per query', 'Latency', 'Scales by']}
  note="The tree structure was only ever needed to build the answers — not to serve them.">

<C color="green">Once every node caches its answer, the tree is unnecessary at read time.</C> Store `cof → [coffee, coffee shop, …]` in Redis.

<H>The trie is a build-time structure. At serve time it collapses into a flat map from prefix to a precomputed list — which is trivially shardable and cacheable.</H>

</TraceStep>

<TraceStep
  title="Cache at the edge"
  state={{ 'Structure': 'prefix → top-5', 'Origin QPS': 'a fraction', 'Latency': '~10 ms to user', 'Freshness': 'minutes' }}
  changed={['Origin QPS', 'Latency', 'Freshness']}
  note="Suggestions are identical for most users, so they cache extremely well — an unusually good CDN fit.">

Popular prefixes are the same for everybody. <C color="green">A CDN with a short TTL absorbs the overwhelming majority of traffic.</C>

</TraceStep>

</Trace>

---

## 2. The read volume

Autocomplete generates far more requests than search itself. A user typing an 8-character query produces up to **8 requests** where the search produces one — <C color="crimson">so autocomplete traffic can be an order of magnitude above search traffic.</C>

The mitigations, all on the client:

| Technique | Effect |
| :--- | :--- |
| **Debounce** (~100–150 ms) | <C color="green">Only query when typing pauses — often halves requests</C> |
| **Minimum prefix length** (2–3) | Single characters have useless suggestions and enormous subtrees |
| **Cancel in-flight requests** | Avoid out-of-order responses overwriting newer results |
| **Client-side caching** | Backspacing re-uses a result already fetched |
| **Prefix-set responses** | Return results for `cof` **and** likely extensions, so the next keystroke needs no request |

<C color="green">Debouncing is the single highest-value change</C>, and it is free — a change to the client with no server-side work at all.

---

## 3. Building and updating the index

<Depth title="Freshness, personalisation, and the things you must not suggest">

**The build pipeline.** Suggestions come from what people actually search, not from a product catalogue:

```
  query logs → aggregate by (prefix, term) over a window
             → filter (min frequency, blocklist, language)
             → rank (frequency, recency, CTR)
             → compute top-K per prefix
             → publish a new index atomically
```

<C color="green">Publish atomically</C> — build the new index alongside the old and switch a pointer, so no request ever sees a half-built index. This is the same [versioned-key](../07-caching/03-eviction-and-invalidation.md) idea: never mutate in place.

**How fresh does it need to be?** Almost always less fresh than people assume. A rebuild every few hours is fine for most terms, because <C color="orange">the head of the distribution is remarkably stable</C> — "weather", "amazon", "football" do not change hourly.

<C color="crimson">The exception is breaking news</C>, where a term goes from zero to enormous within minutes and stale suggestions look badly wrong. The standard answer is a **two-tier index**: a large, stable base rebuilt every few hours, plus a small real-time layer from the last few minutes of queries, merged at read time. Only the second tier needs to be fast, and it is tiny.

**Ranking is not just frequency.** Useful signals:

- **Frequency** over a window — the base.
- **Recency weighting** — decay old counts so trends surface.
- **Click-through rate** — a suggestion shown often and never clicked is a bad suggestion.
- **Result quality** — do not suggest a query that returns nothing.
- **Session context** — a previous query in the same session narrows intent.

**Personalisation, and why it is usually a mistake to start with.** Personalised suggestions destroy the property that makes autocomplete cheap: <C color="crimson">identical results for everyone, cacheable everywhere.</C> Per-user results mean no shared cache and a per-user lookup on every keystroke.

<C color="green">The practical compromise is a two-list merge</C>: serve the shared global list from cache, and blend in a small personal list — the user's own recent searches, held client-side or in a small per-user key. Most of the benefit, almost none of the cost, and the global list remains cacheable.

**What must not be suggested.** This is a safety requirement, not a ranking one, and it is where autocomplete systems cause real harm:

- <C color="crimson">Offensive, defamatory or harassing completions</C>, especially completions of a person's name.
- Queries revealing private information — an autocomplete that completes a partial email or phone number is a data leak.
- Illegal content, and completions that suggest it.
- <C color="crimson">Manipulated terms</C> — autocomplete is a visible ranking, so it will be gamed by automated querying.

The controls are a **blocklist applied at build time**, a **minimum distinct-user threshold** (so one actor cannot promote a term by querying it repeatedly), and **entity-aware suppression** for person names. <H>An autocomplete built purely from query frequency will eventually suggest something that becomes a news story — the filtering is part of the system, not an optional refinement.</H>

**Beyond exact prefixes.** Real implementations also handle typo tolerance (edit distance, usually via a compact automaton), mid-word matching ("york" → "new york"), and transliteration. Each multiplies index size and build complexity, so <C color="green">start with exact prefixes and add tolerance only where the query logs show users need it</C> — which they demonstrate by typing something, getting nothing, and correcting themselves.

</Depth>

---

## 4. In a design discussion

- **"Precompute the top 5 at each trie node — otherwise the descent is instant and ranking 120,000 descendants is not."** The insight the naive trie answer misses.
- **"At serve time it collapses to a flat prefix → list map in Redis, fronted by a CDN. Suggestions are the same for everyone, so they cache extremely well."** Turns a tree problem into a cache problem.
- **"Debounce at 150 ms on the client — autocomplete generates roughly one request per keystroke, which is an order of magnitude above search traffic."** Attacks the volume at its source.
- **"Two-tier index: a stable base rebuilt every few hours plus a small real-time layer, because the head of the distribution barely moves but breaking news does."** Right freshness for each part.

---

## Rapid-fire recall

1. What is autocomplete's unusual traffic profile, and why does it decide the design?
2. What does a trie give you, and what does it not?
3. What is the key change that makes queries constant-time?
4. Why is the tree unnecessary at serve time?
5. Why does autocomplete cache unusually well?
6. Name four client-side techniques for reducing request volume, and the highest-value one.
7. Why publish the index atomically rather than updating in place?
8. Why is a two-tier index used, and which tier needs to be fast?
9. Why does personalisation undermine the design, and what is the compromise?
10. Name three categories that must be suppressed, and two controls that do it.

<details>
<summary>Answers</summary>

1. **A query on every keystroke**, a **sub-100 ms budget**, and results that are **mostly identical across users**. The last property is what makes heavy precomputation and caching the right answer.
2. It finds the node for a prefix in `O(prefix length)`, **independent of corpus size**. It does **not** rank — the subtree may have 120,000 descendants, and finding the top 5 among them is a scan.
3. **Storing the top K at every node**, computed offline. A query becomes a short descent plus a read of a small list, with no subtree traversal.
4. Because once every node caches its own answer, the only thing needed at read time is a **map from prefix to a precomputed list** — the tree was a build-time structure for computing those lists.
5. Because **suggestions are identical for most users**, so a single cached entry per prefix serves everyone. Very few systems have that property.
6. **Debounce** (~150 ms) · **minimum prefix length** · **cancel in-flight requests** · **client-side caching** · **prefix-set responses**. **Debouncing** is highest-value — it often halves requests and costs nothing server-side.
7. So **no request ever sees a half-built index**. Build alongside the old and switch a pointer — the same never-mutate-in-place discipline as versioned cache keys.
8. Because the **head of the distribution is stable** (hours of staleness is invisible) while **breaking news changes within minutes**. Only the small **real-time tier** needs to be fast; the large base tier does not.
9. Because it destroys the property that results are **identical for everyone and cacheable** — per-user results mean no shared cache and a per-user lookup per keystroke. The compromise is **merging a small personal list** (the user's own recent searches) into the cached global list.
10. **Offensive or defamatory completions** (especially of person names) · **private information** (partial emails, phone numbers) · **illegal content** · **manipulated terms**. Controls: a **build-time blocklist**, a **minimum distinct-user threshold** so one actor cannot promote a term, and **entity-aware suppression** for names.

</details>

---

**Next:** [How To Read A Case Study](../15-case-studies/01-how-to-read-a-case-study.md) — the lens for Part C.
