---
title: Cache Invalidation & Cache Keys
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Cache Invalidation & Cache Keys

> **What you will be able to do after this page**
>
> - Give three levels of answer about cache keys: beginner model, accurate mechanism, interview definition.
> - Explain the cascade — why one early miss makes every later step re-run.
> - Correct the widespread "Docker hashes the whole build context" claim.
> - Diagnose an unexpected cache miss from build output.

---

## 1. Cache invalidation

> **Cache invalidation is the point at which a build step's inputs no longer match any stored result, forcing it — and everything that depends on it — to be re-executed.**

The essential property is the **cascade**. Each step is built on the layer below it, so the parent's identity is part of the child's key:

```text
   Step 1  FROM …                       CACHED
   Step 2  COPY manifest .              CACHED
   Step 3  RUN install                  CACHED
   Step 4  COPY . .                     MISS   ← a source file changed
   Step 5  RUN build                    rebuilt (its parent changed)
   Step 6  USER app                     rebuilt
   Step 7  CMD [...]                    rebuilt
           ────────────────────────────────────
           once you miss, you miss for the rest of the stage
```

<H>There is no re-synchronisation.</H> Even if step 6 is byte-identical to last time, its input includes step 5's output, which is new. This is the entire reason instruction order determines build time.

---

## 2. What causes invalidation

| Cause | Effect |
| :--- | :--- |
| Editing the Dockerfile line itself | That step and everything after it |
| A file named by `COPY`/`ADD` changing content | That `COPY` and everything after |
| File metadata changing (mode, ownership; and, depending on the builder, timestamps) | Same — a common cause of "nothing changed but it rebuilt" |
| `--build-arg` value changing, where the `ARG` is used | From the first step that references it |
| Base image digest changing (with `--pull`, or a new local pull) | The entire stage |
| `--no-cache` | Everything |
| Adding/removing/reordering an earlier instruction | From that point down |
| A `.dockerignore` change that alters the copied file set | Any `COPY` whose set changed |

And the crucial non-cause:

<C color="crimson">Changes in the outside world do **not** invalidate anything.</C> A new package version published upstream, a new base-image tag pushed under the same name, a rotated certificate — none of these are inputs Docker knows about. `RUN <package-manager> install` will happily serve a months-old cached result. Docker caches on declared inputs, not on the state of the internet.

---

## 3. Cache keys — three levels

### Level 1: the beginner mental model

> Docker computes a fingerprint for each step from that step's inputs. Same fingerprint, reuse the result. Different fingerprint, re-run the step and everything after it.

Useful, and enough for most day-to-day reasoning.

### Level 2: the technically accurate version

A cache key is <H>a digest computed from the step's *instruction* combined with the digest of its parent step and the digests of the inputs that instruction actually consumes</H>. The word "actually" is doing the work — the inputs differ by instruction type:

```text
  FROM node:20@sha256:abc…
      key ← the resolved image manifest digest

  RUN npm ci
      key ← hash( parent step digest + the literal command string
                  + relevant ARG/ENV values + mount definitions )
      ⚠ the command's EFFECT is never inspected

  COPY package.json package-lock.json ./
      key ← hash( parent step digest + destination + flags
                  + content digests of package.json and package-lock.json )
      ⚠ ONLY those two files. Nothing else in the context is involved.

  COPY . .
      key ← hash( parent + dest + content digests of EVERY file the
                  .dockerignore let through )
```

Under BuildKit this is more precise still: the Dockerfile is compiled to an LLB DAG, each vertex has a content-addressed cache key, and matching is per vertex. BuildKit also does **content-based** matching for local files — if a `COPY`'s resulting file contents are identical to a previous build's, it can reuse the downstream chain even though the operation itself re-ran. That is why BuildKit sometimes recovers a cache hit where the legacy builder could not.

### Level 3: the interview definition

> A cache key is the digest that identifies a build step's inputs — its instruction, its parent step's result, and the specific content it consumes (file digests for `COPY`/`ADD`, the command string for `RUN`). A step is reused when its key matches a stored result. Because each key includes the parent's, one miss invalidates the rest of the chain.

---

## 4. The claim to correct

You will hear, and see written:

> "Docker generates one hash for the whole build context and uses it as the cache key."

<C color="crimson">This is wrong</C>, and it matters, because it makes the manifest-before-source pattern look pointless. If a single context-wide hash were the key, then editing any file would invalidate everything and no ordering could help.

What is true:

1. Cache keys are computed **per step**, not per build.
2. For `COPY`/`ADD`, only the **files that instruction names** contribute — after `.dockerignore` filtering.
3. Therefore `COPY package.json .` is <H>completely unaffected by a change in `src/index.js`</H>.
4. `COPY . .` behaves like the myth only because its named set genuinely *is* the whole context.

The confusion is understandable: with `COPY . .` early in the file, the behaviour is indistinguishable from a context-wide hash. The pattern that fixes it exists precisely because the real mechanism is finer-grained.

### File hashes and checksums

The content digest of a copied file is what makes `COPY` caching work: identical bytes produce an identical digest, so the step's key is unchanged and the step is reused.

Two practical implications:

- **Touching a file may or may not invalidate.** A change that alters only the mtime affects the cache in the legacy builder; BuildKit is primarily content-based for local files. If a build rebuilds "for no reason", suspect metadata — a `chmod` in a script, CI checking out with fresh timestamps, or line-ending normalisation rewriting every file.
- **Reordering has no effect on content digests.** Moving a function inside a file changes its bytes and therefore its digest; whitespace changes count too. There is no semantic understanding of your code.

---

## 5. Diagnosing an unexpected miss

```bash
docker build --progress=plain .
```

Read down the output and find the **first** step that is not `CACHED` — that is the boundary. Everything below it re-ran as a consequence, not as a cause.

| First miss at | Likely cause |
| :--- | :--- |
| `FROM` | Base tag re-resolved (`--pull`, or a fresh pull moved the tag) |
| A `COPY` of manifests | The manifest genuinely changed — or a tool rewrote it (a version field, a checksum, reordered keys) |
| `COPY . .` | Expected on any source change; suspicious only if it is placed too early |
| A `RUN` whose command is unchanged | Its parent step changed, or a referenced `ARG`/`ENV` changed |
| Everything, always | `--no-cache` is set somewhere; the CI runner has no shared cache; or the `.dockerignore` is letting churn through |

Common real-world culprits:

- A generated file inside the context (a build timestamp, a version stamp, a coverage report) that changes on every run. <H>Fix it in `.dockerignore`, not in the Dockerfile.</H>
- A dependency manifest that a tool rewrites on every install.
- CI that builds in a fresh workspace, so file metadata differs each time.
- A build arg like `BUILD_DATE` or `GIT_SHA` declared *early* in the file — put it as late as possible, ideally only in a `LABEL` near the end.

---

## 6. The honest caveat about the linear model

The step-by-step model in this page is a good approximation, but do not state it as an absolute:

- BuildKit executes a **DAG**, so "everything after the miss" means everything *downstream in the graph*, not everything lower in the file. A change in the builder stage does not invalidate an independent stage that nothing shares with it.
- Independent stages build in parallel, and unreferenced stages are skipped entirely.
- Content-based matching can recover hits that a strict layer-chain model would say are impossible.
- `RUN --mount=type=cache` directories are exempt from the layer cache entirely — they persist even across a cache miss, which is why a re-run install can still be fast.

A safe formulation: <H>within a chain of dependent steps, a miss cascades downstream; across independent stages, it does not.</H>

---

## Rapid-fire recall

1. Define cache invalidation and describe the cascade in one sentence.
2. Name two things that invalidate a step and one significant thing that does not.
3. What are the inputs to the cache key of `COPY package.json .`?
4. What are the inputs to the cache key of a `RUN`? What is conspicuously absent?
5. Correct the statement "Docker hashes the whole build context to get the cache key".
6. Why does `COPY . .` make that false statement look true?
7. A build rebuilds everything although no file content changed. Two hypotheses?
8. Where in a Dockerfile should a `GIT_SHA` build arg be used, and why?
9. In what sense is "a miss invalidates everything below it" imprecise under BuildKit?
10. Why can a cached `RUN <package-manager> install` be a security problem?

<details>
<summary>Answers</summary>

1. It is the point where a step's inputs stop matching any stored result; because each step's key includes its parent's result, every dependent step downstream must be rebuilt too.
2. Invalidate: editing the instruction, changing a file that a `COPY` names, changing a referenced build arg, a new base digest. Does not invalidate: a newer package version published upstream — the outside world is not an input.
3. The parent step's digest, the destination and flags, and the content digest of `package.json` alone.
4. The parent digest, the literal command string, and referenced build args/env plus mount definitions. What the command *does* is never inspected.
5. Keys are computed per step, and for `COPY`/`ADD` only the files that instruction names — after `.dockerignore` — contribute.
6. Because the file set that instruction names *is* the entire context, so the behaviour coincides.
7. File metadata changed (fresh CI checkout timestamps, a `chmod`, line-ending rewriting), or a generated file inside the context changes every run.
8. As late as possible — ideally only in a `LABEL` near the end — so it does not invalidate expensive steps above it.
9. BuildKit solves a graph: a miss invalidates downstream *dependents*, not everything lower in the file. Independent stages are unaffected and may be skipped or run in parallel.
10. It can serve a months-old result, so security updates in the package index are silently never applied.

</details>

---

**Next:** [Package Manager Caches & Layer Cleanup](./11-package-manager-caches.md) — a different cache entirely, and the "create and delete in the same layer" rule.
