---
title: Build Cache
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Build Cache

> **What you will be able to do after this page**
>
> - Explain what Docker caches and what a cache hit actually reuses.
> - Order a Dockerfile by *rate of change* and justify every position.
> - Explain, mechanically, why the manifest-then-source pattern is faster than `COPY . .`.
> - Know where the cache lives, and why CI usually has none.

---

## 1. What the cache is

> **The build cache is a store of previously computed build results, keyed by the inputs of each build step. If a step's inputs are unchanged, its stored result is reused instead of re-executed.**

A cache hit does not "skip" a step in the sense of omitting it. <H>The step's *result* — its filesystem snapshot and metadata — is reused, so the resulting image is identical to one that had executed it.</H> That is why caching is safe: the output is the same, only the work is avoided.

```text
  RUN <package-manager> install
        │
        ├── inputs unchanged?  ── yes ──►  CACHED   reuse the existing snapshot (0.0s)
        │
        └────────────────────── no ────►  execute in a sandbox, produce a new layer (38s)
```

---

## 2. Why it exists

Builds are dominated by a handful of expensive, highly repetitive operations: resolving and downloading dependency trees, compiling, and bundling. Those inputs change far less often than application source. Without a cache, <C color="crimson">every one-character code change would re-download the entire dependency tree</C>.

The cache converts the common case — "the code changed, nothing else did" — from minutes into seconds. Its whole value therefore depends on how well your Dockerfile separates what changes often from what does not.

---

## 3. Cache hit and cache miss

| Term | Meaning | Output |
| :--- | :--- | :--- |
| **Cache hit** | Inputs match a stored result; it is reused | `=> CACHED [4/7] RUN …  0.0s` |
| **Cache miss** | Inputs differ, or nothing is stored | The step executes; time is spent |
| **Cache invalidation** | An earlier change causes a miss here and downstream | See [next page](./10-cache-invalidation.md) |

What forms a step's inputs depends on the instruction:

| Instruction | Inputs that determine reuse |
| :--- | :--- |
| `FROM` | The resolved image digest |
| `RUN` | The command string, plus the state of the layer beneath it |
| `COPY` / `ADD` | The **contents and metadata of the files copied**, plus destination and flags |
| `ENV`, `WORKDIR`, `USER`, … | The instruction text |

<H>The critical asymmetry: `RUN` is cached on its *text*, `COPY` is cached on its *file contents*.</H> Docker has no idea what a `RUN` command does — it does not inspect the network, the package registry, or the clock. This cuts both ways and is treated in detail on the [next page](./10-cache-invalidation.md).

---

## 4. Where the cache lives

- **Locally**, in the builder's storage on the machine running the daemon (`docker system df` shows it; `docker builder prune` clears it).
- **Not in the image.** Cache is a build-side artifact, never shipped.
- **Not shared between machines by default.** Your laptop's warm cache means nothing to a CI runner.

That last point is why CI pipelines are so often slow: <H>a fresh runner has an empty cache, so every build is a cold build</H> regardless of how well the Dockerfile is ordered. The fix is a shared cache backend:

```bash
docker buildx build \
  --cache-from type=registry,ref=registry.example.com/team/api:buildcache \
  --cache-to   type=registry,ref=registry.example.com/team/api:buildcache,mode=max \
  -t registry.example.com/team/api:1.4.2 --push .
```

Other backends exist (`type=gha` for GitHub Actions, `type=local` for a mounted directory). `mode=max` also exports intermediate stages, which is what makes multi-stage builds cacheable.

---

## 5. The core pattern

Compare these two Dockerfiles. They produce equivalent images; they do not behave equivalently.

```dockerfile
# ── A ── cache-efficient ──────────────────────────
COPY <dependency-manifest> <lock-file> ./
RUN  <package-manager> install
COPY source/ .
```

```dockerfile
# ── B ── cache-hostile ────────────────────────────
COPY . .
RUN  <package-manager> install
```

Edit one line of source and rebuild:

```text
   A                                        B
   ─────────────────────────────────        ─────────────────────────────────
   COPY manifest        CACHED  0.0s        COPY . .          MISS    0.4s
   RUN install          CACHED  0.0s        RUN install       MISS   38.0s   ← re-downloads
   COPY source/         MISS    0.3s                                    everything
   ─────────────────────────────────        ─────────────────────────────────
   ~0.3s                                    ~38.4s
```

The mechanism, precisely:

1. In **B**, the `COPY . .` cache key covers every file in the context. Any change to any file — source, README, a test fixture — changes that key.
2. A miss at that step invalidates <C color="orange">every subsequent step</C>, because each step's key includes the state of the layer below it.
3. `RUN install` therefore re-executes even though the dependency manifest is byte-identical.

In **A**, the manifest is copied alone. Source edits do not touch it, so the install stays cached; only the small, cheap `COPY source/` re-runs.

**A precise statement of the rule:** it is not that `COPY . .` is bad. It is that <H>a broad `COPY` placed *before* an expensive step destroys that step's cache</H>. As the final content step in a stage, `COPY . .` is idiomatic and fine.

---

## 6. The ordering strategy

```text
   ┌──────────────────────────────────────────────────┐
   │  RARELY changing inputs                          │  ← base image
   │            ↓                                     │     system packages
   │  EXPENSIVE cacheable operations                  │     dependency manifest
   │            ↓                                     │     dependency install
   │  FREQUENTLY changing inputs                      │     application source
   │            ↓                                     │     build/bundle step
   │  CHEAP final steps                               │     metadata, USER, CMD
   └──────────────────────────────────────────────────┘
              order by RATE OF CHANGE, not by logical grouping
```

Typical rate-of-change ranking, slowest-changing first:

```text
   base image             months
   system packages        weeks
   dependency manifest    days-weeks     ← the natural cache boundary
   lock file              days-weeks
   build configuration    weeks
   application source     minutes        ← everything below here is cheap
   tests                  minutes
   documentation          minutes
   generated files        every build
```

Which gives the canonical skeleton:

```dockerfile
FROM <base>                             # months
RUN <install system packages>           # weeks
WORKDIR /app
COPY <dependency-manifest> <lock-file> ./   # days
RUN <install dependencies>              # ← protected by everything above
COPY . .                                # minutes
RUN <build>
```

### Why manifests and lock files are copied separately

Because they are the *only* files that change what `install` produces. Copying them alone makes the cache key for the install step depend on exactly the right inputs — nothing more, nothing less. Copying the whole tree adds thousands of irrelevant files to that key.

The lock file matters twice over: it also makes the install **deterministic**, so a cache hit and a cold build produce the same dependency tree. A build without a lock file can silently install different versions on different days, which makes cache hits actively misleading.

---

## 7. Nuances worth knowing

**Multi-stage caching.** Each stage caches independently, and BuildKit runs independent stages in parallel. A change to your runtime stage does not invalidate the builder stage.

**Copy only what a step needs.** Splitting a `COPY` can save large amounts of time:

```dockerfile
COPY <build-config> ./           # rarely changes → protects the next step
RUN  <generate-code>
COPY src/ ./src/                 # changes constantly
```

**Cache mounts sit beside the layer cache.** `RUN --mount=type=cache` gives a step a persistent directory that survives across builds and is never committed into a layer — so a package-manager download cache can persist even when the step itself must re-run. This is a different mechanism from the layer cache; see [Package Manager Caches](./11-package-manager-caches.md).

**`--no-cache` and `--pull`.** `--no-cache` forces every step to execute; use it to reproduce a clean build or to pick up upstream package updates that a cached `RUN` is hiding. `--pull` re-resolves the base image tag. Neither belongs in a normal build.

**Cache hits can hide staleness.** A cached `RUN <package-manager> update && install` may be months old. That is a *correctness* consideration, not a performance one: rebuild without cache periodically, and pin versions where determinism matters.

---

## Rapid-fire recall

1. What does a cache hit actually reuse?
2. What are the cache inputs for `RUN` versus for `COPY`?
3. Why does a `COPY . .` before `RUN install` cost you 38 seconds on a one-line code change?
4. Is `COPY . .` bad? Give the precise version of the rule.
5. Why does a CI pipeline get no benefit from a beautifully ordered Dockerfile, and what fixes it?
6. What does `mode=max` add to a registry cache export?
7. What ordering principle should govern a Dockerfile?
8. Why copy the lock file separately from the source, for two independent reasons?
9. When is `--no-cache` the right tool?
10. How can a cache hit be a correctness problem?

<details>
<summary>Answers</summary>

1. The step's stored result — its filesystem snapshot and metadata — so the resulting image is identical to one that executed the step.
2. `RUN` is keyed on the command string plus the parent layer state; `COPY` is keyed on the contents and metadata of the files it copies.
3. That `COPY` includes every file in the context in its key, so any edit misses; the miss cascades, forcing the install below it to re-execute.
4. Not inherently. The rule is: a broad `COPY` placed *before* an expensive step destroys that step's cache. As the last content step, it is fine.
5. Fresh runners start with an empty local cache, so every build is cold. Use a shared cache backend (`--cache-from`/`--cache-to` with registry, gha, or local).
6. Export of intermediate stage results, not just the final stage — which is what makes multi-stage builds cacheable across runners.
7. Order by rate of change: slowest-changing and most expensive first, most frequently changing last.
8. It keeps the install step's cache key dependent only on the dependency inputs, and it makes the installed tree deterministic.
9. To reproduce a genuinely clean build, or to force pickup of upstream package updates that a stale cached `RUN` is hiding.
10. Docker caches `RUN` on its text, so a cached package-index update or install can be months out of date while appearing to succeed.

</details>

---

**Next:** [Cache Invalidation & Cache Keys](./10-cache-invalidation.md) — what a cache key really is, and why the "one hash for the whole context" story is wrong.
