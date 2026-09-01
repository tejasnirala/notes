---
title: Production Image Optimization
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Production Image Optimization & Design Principles

> **What you will be able to do after this page**
>
> - Work a 1 GB image down methodically, biggest win first, instead of guessing.
> - Apply the design principles behind a good Dockerfile, not just the rules.
> - Know when to stop optimising.

---

## 1. The governing principle

> <H>Optimize for the smallest *practical* image, not the smallest *possible* image.</H>

Size is a proxy for things that actually matter: pull time during a deploy or scale-up, registry and node storage, and attack surface. Past a certain point, further shrinking costs debuggability, compatibility and engineering time while buying nothing measurable.

A useful sense of scale:

```text
   2 GB   → something is wrong: build tools, caches, or the source tree shipped
   500 MB → typical for an unoptimised runtime-based application
   150 MB → a well-built slim-based image; entirely respectable
   50 MB  → multi-stage onto a minimal base
   10 MB  → a static binary on distroless or scratch
```

Going from 2 GB to 200 MB is transformative. Going from 60 MB to 45 MB is usually not worth a week.

---

## 2. The checklist, in priority order

### Tier 1 — biggest wins, lowest cost

**1. Add a `.dockerignore`.** Often the single highest-value change: faster builds, safer images, better cache behaviour. [Chapter 8](./08-dockerignore.md)

**2. Order instructions by rate of change.** Dependency manifests before source; expensive steps protected by stable cache boundaries. [Chapter 9](./09-build-cache.md)

**3. Use a multi-stage build when the runtime does not need the build tools.** Frequently a 5–20× reduction for compiled or bundled applications. [Chapter 13](./13-multi-stage-builds.md)

**4. Install production dependencies only.** Dev and test dependencies have no place in a runtime image.

**5. Do not ship package-manager caches.** Cache mounts, or clean them in the same instruction. [Chapter 11](./11-package-manager-caches.md)

### Tier 2 — meaningful, needs judgement

**6. Choose an appropriate base image** — on compatibility and operational grounds, not size alone. A `-slim` variant is usually the sweet spot. [Chapter 12](./12-base-images.md)

**7. Create and delete in the same layer.** A deletion in a later layer only hides bytes. [Chapter 11](./11-package-manager-caches.md#4-create-and-delete-in-the-same-layer)

**8. Copy only what the runtime needs.** Not the whole source tree when a build artifact suffices; not tests, docs, CI configuration or fixtures.

**9. Avoid installing development tooling** — editors, debuggers, network utilities, compilers — in the production stage. Put them in a separate `debug` stage.

**10. Pin versions deliberately.** Base image tag (and digest), dependency lock file, and system package versions where it matters. Reproducibility is a production property. [Chapter 12](./12-base-images.md)

### Tier 3 — security and correctness, not size

**11. Run as a non-root user.** [Chapter 16](./16-non-root-containers.md)

**12. Keep secrets out of images.** Build secrets via mounts; runtime secrets injected. [Chapter 15](./15-secrets.md)

**13. Inject configuration at run time.** One image per version, not per environment. [Chapter 14](./14-runtime-configuration.md)

**14. Use exec form for `CMD`/`ENTRYPOINT`** so the application is PID 1 and shuts down gracefully. [Chapter 17](./17-pid1-and-signals.md)

**15. Add a meaningful `HEALTHCHECK`.** [Chapter 24](./24-compose-depends-on-and-health.md)

**16. Add OCI labels** — source repository, revision, version. They make an image traceable back to a commit.

**17. Scan images** in CI for vulnerabilities and leaked secrets, and rebuild regularly so base-image patches actually reach production.

---

## 3. Debugging a fat image

Do not guess. Measure, then act on the largest contributor.

```bash
docker image history --no-trunc --human myimage:tag
```

Read it from the largest layer down; each row shows the instruction that created it.

```bash
docker run --rm myimage:tag sh -c 'du -sh /* 2>/dev/null | sort -rh | head -20'
docker run --rm myimage:tag sh -c 'du -sh /app/* | sort -rh | head -20'
docker system df -v
```

The usual suspects, in the order you will find them:

| Finding | Fix |
| :--- | :--- |
| Compilers, `-dev` packages, build toolchain | Multi-stage build |
| A package-manager cache directory | Cache mount, or clean in the same `RUN` |
| Dev/test dependencies | Install production dependencies only |
| The full source tree alongside a built artifact | Copy only the artifact |
| `.git` inside the image | `.dockerignore` |
| A host `node_modules`/`venv`/`vendor` copied in | `.dockerignore` |
| Large files created then deleted in a later step | Same-layer cleanup, or multi-stage |
| A base image far larger than needed | Move to a `-slim` variant, with testing |

<H>A layer that is large in `history` but whose files are invisible in the running container is the create-then-delete pattern</H> — the bytes are in an earlier layer behind a whiteout.

---

## 4. Debugging a slow build

```bash
docker build --no-cache --progress=plain .     # true cold-build cost per step
docker build --progress=plain .                # what is missing cache on a warm build
```

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| Slow before any step runs | Large build context | `.dockerignore` |
| Dependency install re-runs on every code change | A broad `COPY` before it | Copy manifests first |
| Everything rebuilds every time in CI | No shared cache on fresh runners | Registry cache with `mode=max` |
| One step is inherently slow | Compilation or a large download | Cache mount; parallelise stages; consider a prebuilt base |
| Rebuilds with no apparent change | File metadata churn, or a generated file in the context | `.dockerignore`; investigate what changed |
| Cross-platform build is very slow | Emulation | Native builders per architecture |

---

## 5. Production Dockerfile design principles

The rules above, stated as the principles behind them:

1. **Stable content first, volatile content last.** The Dockerfile's order is a statement about rate of change.
2. **Separate build dependencies from runtime dependencies.** They are different sets; only one belongs in the shipped image.
3. **Be explicit.** `WORKDIR` over `cd`; exec form over shell form; a numeric `USER`; pinned versions. Implicitness is where surprises live.
4. **Deterministic dependency installation.** Lock files and frozen-install flags, so the same inputs yield the same tree.
5. **A minimal runtime filesystem.** Every file you did not need is storage, pull time and attack surface.
6. **The right process as PID 1**, with correct signal handling.
7. **Configuration from the environment, secrets from a secret mechanism.** Never baked in.
8. **Immutability.** Never mutate a running container; rebuild and redeploy.
9. **Reproducibility over cleverness.** A build a colleague can run and get the same result from beats a marginally smaller one they cannot.
10. **Optimise what you measured.** Layer sizes, build timings, pull times — not intuition.

---

## 6. When to stop

Stop when the next change would:

- Break compatibility you have not tested (a libc switch, an unfamiliar base).
- Remove your ability to debug production without a prepared alternative.
- Save less time than it costs to maintain.
- Make the Dockerfile hard for a colleague to follow.

<C color="orange">A 150 MB image that the team understands and can debug beats a 40 MB image that nobody dares touch.</C> Size is a means; reliable, fast, secure deployment is the end.

---

## Rapid-fire recall

1. State the governing principle in one line.
2. Which single change is usually the highest-value optimisation?
3. Name the top five items on the checklist.
4. Which command shows per-step size, and how do you read it?
5. A layer is large but its files are not visible in the container. What happened?
6. Your CI build never hits cache. Why, and what fixes it?
7. Give three principles behind a well-designed production Dockerfile.
8. Name three reasons to stop optimising.
9. Why does image size matter operationally at all?

<details>
<summary>Answers</summary>

1. Optimise for the smallest practical image, not the smallest possible one.
2. Adding a proper `.dockerignore` — it improves build speed, image safety and cache behaviour at once.
3. `.dockerignore`; instruction ordering by rate of change; multi-stage builds; production-only dependencies; no shipped package-manager caches.
4. `docker image history --no-trunc --human` — read from the largest layer down and look at the instruction that created it.
5. Files were created in an earlier layer and deleted in a later one; the whiteout hides them while the bytes still ship.
6. Fresh runners have an empty local cache. Use a registry-backed cache with `--cache-from`/`--cache-to` and `mode=max`.
7. Any three: stable content first; separate build and runtime dependencies; be explicit; deterministic installs; minimal runtime filesystem; correct PID 1; runtime configuration; immutability; reproducibility; measure before optimising.
8. It would break untested compatibility, remove your debugging path, save less than it costs to maintain, or make the Dockerfile unmaintainable.
9. It drives pull time on deploys and scale-ups, storage on registries and nodes, and the attack surface of what you ship.

</details>

---

**Next:** [Production Dockerfile Examples](./30-production-dockerfiles.md) — annotated templates for interpreted and compiled applications.
