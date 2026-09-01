---
title: Multi-Stage Builds
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Multi-Stage Builds

> **What you will be able to do after this page**
>
> - Answer the question that trips people up: *if the builder stage is discarded, how can a later stage read its files?*
> - Use `COPY --from` against stages, external images, and named contexts.
> - Decide when multi-stage genuinely helps and when it is ceremony.
> - Build dev/prod/test variants from one Dockerfile with `--target`.

---

## 1. What it is

A Dockerfile with **multiple `FROM` instructions**. Each `FROM` begins a new stage with a fresh filesystem, and a later stage may copy files out of an earlier one.

```dockerfile
FROM <builder-image> AS builder      # stage "builder"
WORKDIR /src
COPY . .
RUN <build the application>          # produces /src/<build-output>

FROM <runtime-image>                 # a NEW filesystem — nothing carried over
WORKDIR /app
COPY --from=builder /src/<build-output> ./
CMD ["<application-command>"]
```

The final image is <H>the last stage only</H> — its base plus whatever was explicitly copied in. The builder's compilers, headers, source tree and caches are not in it.

---

## 2. The question everyone asks

> If the builder stage is discarded, how can the next stage access its files?

The confusion comes from the word "discarded", which sounds temporal — as if the builder is destroyed and *then* the runtime stage runs. That is not the sequence.

```text
  DURING THE BUILD                         AFTER THE BUILD
  ─────────────────────────                ─────────────────────────
  builder stage        exists              builder result:  not part of the
    /usr/bin/compiler                        final image; kept only in the
    /src/ (source)                           build cache
    /src/<build-output>  ─────┐
                              │ COPY --from=builder
  runtime stage        exists │            final image:  runtime base
    /app/<build-output>  ◄────┘                          + /app/<build-output>
```

Both stages exist simultaneously *during* the build. `COPY --from=builder` is resolved at that moment. "Discarded" means only: <H>the builder's layers are not included in the final image</H>. Nothing is deleted mid-build.

Two properties follow, and they are the whole point:

1. **Only what you explicitly copy crosses over.** There is no implicit inheritance between stages.
2. **Build tooling cannot leak in by accident.** If the compiler is not named in a `COPY --from`, it is not in the image — no cleanup required, nothing to remember.

Note that the *first* stage still had to be built, so its results occupy build cache and (with `mode=max`) can be exported for CI reuse. "Discarded" is about the shipped artifact, not about wasted work.

---

## 3. `COPY --from`

```dockerfile
COPY --from=builder /src/dist ./dist        # from a named stage
COPY --from=0 /src/dist ./dist              # from a stage by index (avoid; fragile)
COPY --from=nginx:1.25 /etc/nginx/nginx.conf ./   # from an arbitrary IMAGE
```

The third form is underused: it pulls a file out of any published image without running it — useful for grabbing a CA bundle, a static binary, or a default config.

With BuildKit you can also mount another stage read-only instead of copying:

```dockerfile
RUN --mount=type=bind,from=builder,source=/src/dist,target=/dist \
    <verify or process /dist>
```

Always use `--chown` when the runtime user is not root:

```dockerfile
COPY --from=builder --chown=10001:10001 /src/dist ./
```

Otherwise files arrive as `root:root` and your non-root process may be unable to read or write them.

---

## 4. The generic flow

```text
   ┌──────────────────────── BUILDER STAGE ────────────────────────┐
   │  full-featured base image                                     │
   │       ↓                                                       │
   │  install build tools (compilers, headers, build system)       │
   │       ↓                                                       │
   │  resolve and install dependencies (incl. dev dependencies)    │
   │       ↓                                                       │
   │  compile / bundle / package                                   │
   │       ↓                                                       │
   │  RUNTIME ARTIFACTS  ──────────────────────┐                   │
   └───────────────────────────────────────────┼───────────────────┘
                                               │ COPY --from
   ┌───────────────────────── RUNTIME STAGE ───┼───────────────────┐
   │  minimal base image                       ▼                   │
   │  install runtime-only shared libraries                        │
   │  copy ONLY the artifacts                                      │
   │  create/set a non-root user                                   │
   │  declare the process                                          │
   └───────────────────────────────────────────────────────────────┘
```

What this buys:

| Benefit | Mechanism |
| :--- | :--- |
| **Smaller final image** | Compilers, headers, source and caches never enter it |
| **Reduced attack surface** | No compiler, no build tools, often no shell for an intruder to use |
| **Separation of concerns** | Build environment and runtime environment evolve independently |
| **Reproducibility** | The whole toolchain is pinned in the Dockerfile, not on a CI machine |
| **No cleanup rituals** | Nothing to `rm -rf`; you never had it in this stage |
| **One artifact, many variants** | `--target` produces dev, test, and prod from one definition |

The costs, stated plainly: a longer, more complex Dockerfile; you must know exactly which artifacts to copy (miss a runtime file and you get a runtime error, not a build error); debugging is a little harder; and CI needs `mode=max` cache to keep intermediate stages warm.

---

## 5. Dependency installation across stages

The right pattern depends on whether the runtime needs the dependency *tree* or only a compiled *artifact*.

### Case A — compiled languages / bundled applications

The build produces a self-contained artifact. Dependencies exist only in the builder.

```dockerfile
FROM <builder> AS build
WORKDIR /src
COPY <manifest> <lock> ./
RUN <fetch dependencies>
COPY . .
RUN <compile to a single artifact>

FROM <minimal-runtime>
COPY --from=build /src/<artifact> /app/<artifact>
USER 10001
ENTRYPOINT ["/app/<artifact>"]
```

<H>This is where multi-stage pays the most</H> — often a 900 MB builder collapsing to a 20 MB runtime image.

### Case B — interpreted runtimes

The runtime genuinely needs the installed dependency tree, so you copy the tree itself:

```dockerfile
FROM <runtime-image> AS deps
WORKDIR /app
COPY <manifest> <lock> ./
RUN <install PRODUCTION dependencies only>

FROM <runtime-image>
WORKDIR /app
COPY --from=deps --chown=10001:10001 /app/<dependency-dir> ./<dependency-dir>
COPY --chown=10001:10001 <application-source> ./
USER 10001
CMD ["<runtime>", "<entry-file>"]
```

The gain here is narrower: you drop build tools, dev dependencies, and package caches. Whether that is worth the extra complexity depends on how large those are. <C color="orange">If your install is pure, cache-clean and dev-dependency-free, a single stage may be entirely correct.</C>

### Case C — three stages, dev dependencies needed to build

Common in ecosystems where building requires dev dependencies that must not ship:

```dockerfile
FROM <base> AS deps          # production dependencies only
FROM <base> AS build         # all dependencies + compile/bundle
FROM <runtime>               # copy production deps from `deps`, artifacts from `build`
```

---

## 6. `--target`: several images, one Dockerfile

```dockerfile
FROM <base> AS base
WORKDIR /app
COPY <manifest> <lock> ./

FROM base AS development
RUN <install ALL dependencies>
COPY . .
CMD ["<dev-server-with-hot-reload>"]

FROM base AS test
RUN <install ALL dependencies>
COPY . .
RUN <run the test suite>

FROM base AS build
RUN <install ALL dependencies>
COPY . .
RUN <build>

FROM <minimal-runtime> AS production
WORKDIR /app
COPY --from=build --chown=10001:10001 /app/<build-output> ./
USER 10001
CMD ["<application-command>"]
```

```bash
docker build --target development -t app:dev .
docker build --target test        -t app:test .    # fails the build if tests fail
docker build                      -t app:prod .    # last stage = production
```

Two things to note: unreferenced stages are <H>never built</H>, so `--target development` does not compile the production image; and stages share the `base` stage's cache, so the common work happens once.

**Put the production stage last.** A plain `docker build .` then cannot accidentally ship a debug image.

---

## 7. When multi-stage is *not* needed

It is a tool, not a commandment. Skip it when:

- The application is a single file or a small set of files with no build step and no native dependencies.
- The runtime image and the build image would be identical anyway, and the only extra content is a small, cache-cleaned dependency tree.
- The complexity would exceed the benefit — for example a 40 MB image where multi-stage saves 6 MB.
- You need the build tools at run time (rare, but real: some plugin systems compile at start-up).

<H>Multi-stage builds are not mandatory for every production image.</H> The right question is not "am I using multi-stage?" but "is anything in my final image that will never be used at run time?" If the answer is no, you are done.

A useful diagnostic:

```bash
docker image history myimage:tag       # any step installing compilers or headers?
docker run --rm myimage:tag <list the largest directories under />
```

If a compiler toolchain, a package cache, or the full source tree shows up, multi-stage will help. If not, it will only add lines.

---

## Rapid-fire recall

1. Does the runtime stage inherit anything from the builder stage automatically?
2. Explain, without the word "discarded", how a later stage reads builder files.
3. Which stage does `docker build .` produce with no `--target`?
4. Give the three sources `COPY --from` can read from.
5. Why does the final image contain no compiler even though you never removed one?
6. Why is `--chown` usually needed on `COPY --from` in a non-root image?
7. When does multi-stage save the most, and when does it save almost nothing?
8. What happens to stages that nothing references?
9. Where should the production stage sit in the file, and why?
10. What is the failure mode of copying too few artifacts across?

<details>
<summary>Answers</summary>

1. No. Each `FROM` starts a fresh filesystem; only explicit `COPY --from` moves anything.
2. Both stages exist simultaneously during the build; `COPY --from` resolves then. Only the final stage's layers are included in the resulting image.
3. The last stage in the file.
4. A named stage, a stage index, or an arbitrary image reference (BuildKit also supports named build contexts).
5. Because the compiler only ever existed in the builder stage's filesystem, which is not part of the final image.
6. Files land as `root:root` by default, so a non-root runtime user may be unable to read or write them.
7. Most: compiled or bundled applications where a big toolchain collapses to a small artifact. Least: small interpreted apps with a clean, production-only dependency install.
8. They are never built at all — BuildKit only solves reachable nodes in the graph.
9. Last, so a plain `docker build .` cannot accidentally produce a debug or development image.
10. A build that succeeds and a container that fails at run time with a missing file or library — the error surfaces late.

</details>

---

**Next:** [Runtime Configuration](./14-runtime-configuration.md) — why the same image must run in every environment.
