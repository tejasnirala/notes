---
title: Package Manager Caches & Layer Cleanup
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Package Manager Caches & Layer Cleanup

> **What you will be able to do after this page**
>
> - Distinguish the Docker build cache from a package manager's own cache — they are unrelated systems.
> - Explain why disabling a package cache does not disable installing dependencies.
> - Apply the "create and delete in the same layer" rule and explain the mechanism, not the ritual.
> - Choose between cache-disable, cache-clean, cache-mount and multi-stage for a given situation.

---

## 1. Two caches with the same word

| | Docker build cache | Package manager cache |
| :--- | :--- | :--- |
| Owned by | BuildKit / the daemon | The package tool (npm, pip, Maven, NuGet, Go, Cargo, apt…) |
| Stores | Results of build **steps** | Downloaded archives, extracted packages, compiled artifacts |
| Lives | On the builder, outside images | <C color="crimson">Inside the image filesystem</C>, unless you prevent it |
| Purpose | Skip re-executing a step | Skip re-downloading/re-building a package |
| Affects image size | No | <C color="crimson">Yes, often by hundreds of MB</C> |

Both are called "cache" and both make builds faster, and they are completely separate mechanisms. The one that ends up in your production image — where nobody will ever install anything again — is the second one.

---

## 2. What package manager caches are and why they exist

Every ecosystem's tooling keeps a local store so repeated work is avoided:

```text
   npm / pnpm / yarn    a content-addressed store of downloaded tarballs
   pip                  an HTTP + wheel cache of downloaded and built wheels
   Maven / Gradle       ~/.m2 and ~/.gradle: JARs plus build daemons' caches
   NuGet                a global packages folder
   Go modules           a module cache plus a compiled-object build cache
   Cargo                a registry cache plus a compiled-artifact target directory
   apt / apk / dnf      package archives and index metadata
```

On a developer machine this is unambiguously good: install once, reuse forever. Inside a **final production image** it is dead weight. The image is built once; nothing will consult that cache again at run time.

<H>The general principle: caches that speed up *building* should not be shipped in an artifact that only *runs*.</H>

---

## 3. Four strategies

### 3.1 Disable the cache during install

Most tools accept a flag meaning "do not persist a cache". The download still happens; the packages are still installed; only the *copy kept for next time* is skipped.

```dockerfile
RUN <package-manager> install --no-cache-option
```

<H>This is the point that confuses people most: disabling the cache does not mean the dependencies are not installed.</H> It means the tool does not keep a second copy of the downloaded archives inside the image.

Trade-off: it also gives up any speed benefit within that single build (usually negligible) and — importantly — it does *not* help if the tool writes its cache somewhere anyway.

### 3.2 Clean the cache in the same instruction

For tools with no disable flag, or for system package managers:

```dockerfile
RUN <system-package-manager> update \
 && <system-package-manager> install -y --no-recommended-extras <packages> \
 && <clean the package cache> \
 && rm -rf <package index metadata>
```

The `&&` chaining is not cosmetic — see section 4.

### 3.3 BuildKit cache mounts (usually the best answer)

```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=cache,target=<package-manager-cache-dir> \
    <package-manager> install
```

A cache mount is a persistent directory that exists *only during* the step. It survives across builds, so re-running the install is fast — and it is <H>never committed into any layer</H>, so it contributes zero image size.

This gets you both properties at once: fast rebuilds and a small image. It is the strategy to reach for when the install step is expensive and misses often.

Notes: mounts are per-builder (a fresh CI runner has an empty one unless you use a persistent builder), and concurrent builds sharing a mount may need `sharing=locked` for tools that are not safe under concurrency.

### 3.4 Multi-stage builds

Install in a builder stage; copy only the resulting artifacts into the runtime stage. Whatever caches the builder accumulated stay behind entirely.

```dockerfile
FROM <builder> AS build
RUN <package-manager> install        # cache pollution here is irrelevant
RUN <build the application>

FROM <runtime>
COPY --from=build <artifacts> /app   # only the output crosses over
```

<H>This is the most robust option, because it does not require you to know where each tool hides its cache.</H> See [Multi-Stage Builds](./13-multi-stage-builds.md).

### Choosing

```text
  Runtime needs the installed dependency tree itself (interpreted languages)
      → cache mount, or disable/clean in the same instruction
  Runtime needs only a compiled artifact (compiled languages, bundlers)
      → multi-stage; do not think about caches at all
  System packages (apt/apk/dnf)
      → always clean lists/archives in the same RUN
  Build is slow and cache misses are frequent
      → cache mount, plus multi-stage if applicable
```

---

## 4. Create and delete in the same layer

### The rule

```dockerfile
# ❌ the deletion does nothing for image size
RUN <create temporary files>
RUN <delete temporary files>

# ✅ create, use and delete within one step
RUN <create temporary files> \
 && <use them> \
 && <delete them>
```

### The mechanism

From [Image Layers](./04-image-layers.md): layers are immutable diffs, and a deletion in a later layer is recorded as a **whiteout** — a marker that hides the path. It removes nothing from the earlier layer.

```text
  ❌ two instructions
     layer N   : + 400 MB of temporary files
     layer N+1 : whiteout marker (a few bytes)
     ────────────────────────────────────────
     visible:  files gone       image size: 400 MB, plus a little

  ✅ one instruction
     layer N   : the net diff after creation AND deletion — the temporary
                 files never appear in it at all
     ────────────────────────────────────────
     visible:  files gone       image size: ~0 for the temporary files
```

The layer is a *diff of the step's end state*. Within one `RUN`, only the final filesystem state is captured, so anything created and removed inside it leaves no trace.

### Where it applies

```dockerfile
# system package metadata and archives
RUN <pkg> update && <pkg> install -y <packages> && <clean cache and lists>

# a downloaded, extracted, installed toolchain
RUN <download archive> && <extract> && <install> && <remove archive and extracted dir>

# a build that needs compilers only temporarily
RUN <install build tools> \
 && <build> \
 && <remove build tools>
```

### The counter-pressures — this is a trade-off, not a law

1. **One giant `RUN` is one giant cache unit.** Chain too much and any change re-runs all of it. Group by *rate of change and purpose*, not into a single mega-instruction.
2. **Readability suffers.** A 25-line `&&` chain is hard to review and hard to debug. Multi-stage builds usually express the same intent more clearly.
3. **BuildKit softens the need.** With cache mounts, the cache directory is never in a layer, so there is nothing to clean. With multi-stage builds, the polluted stage is discarded wholesale.
4. **Layer squashing exists** (`--squash`, or exporting a flattened image) but it discards layer sharing and cache benefits — usually a bad trade.

<H>Modern guidance: prefer multi-stage builds and cache mounts; use same-layer cleanup where those do not apply — most notably for system package managers in a runtime stage.</H>

### The security dimension

The same mechanism makes this fatal:

```dockerfile
COPY id_rsa /root/.ssh/id_rsa       # layer N
RUN <use the key>
RUN rm /root/.ssh/id_rsa            # layer N+2 — the key is STILL in layer N
```

The key is recoverable by anyone with the image, with no container required. Same-layer chaining is not a fix here either — the correct mechanism is `RUN --mount=type=secret`, covered in [Secrets](./15-secrets.md).

---

## 5. Build dependencies vs runtime dependencies

A related distinction that determines how much of this you need to care about:

| | Build dependency | Runtime dependency |
| :--- | :--- | :--- |
| Examples | Compilers, headers/dev packages, build tools, test frameworks, bundlers | The runtime/interpreter, shared libraries the binary links against, production libraries |
| Needed at run time | No | Yes |
| Should be in the final image | <C color="crimson">No</C> | Yes |
| Typical size | Hundreds of MB | Tens of MB |

Most "why is my image 1.2 GB?" investigations end here: a compiler toolchain and a package cache shipped to production. The two structural fixes are the ones above — install production dependencies only, and use a builder stage for everything else.

---

## Rapid-fire recall

1. Docker build cache vs package manager cache: which one ends up inside your image?
2. Does disabling a package manager's cache mean dependencies are not installed?
3. Why does `RUN rm -rf <cache>` as a separate instruction not shrink the image?
4. What does a `RUN --mount=type=cache` directory contribute to image size?
5. Give the two properties a cache mount provides simultaneously.
6. Why is multi-stage the most *robust* answer to cache pollution?
7. Name two costs of chaining everything into one enormous `RUN`.
8. Which cleanup strategy applies to system package managers in a runtime stage?
9. Why is same-layer chaining not an acceptable fix for a leaked SSH key?
10. Give three examples of build-only dependencies.

<details>
<summary>Answers</summary>

1. The package manager cache — it is written into the image filesystem. The Docker build cache lives on the builder and is never shipped.
2. No. The packages are downloaded and installed as normal; only the retained copy of the downloaded archives is skipped.
3. Deletion in a later layer writes a whiteout that hides the path; the bytes remain in the earlier layer and still ship.
4. Nothing — cache mounts are never committed into a layer.
5. Fast rebuilds (the cache persists across builds) and zero image-size cost.
6. Because you do not need to know where each tool hides its caches — the whole builder filesystem is discarded and only named artifacts are copied forward.
7. A single huge cache unit (any change re-runs all of it) and poor readability/debuggability.
8. Clean package archives and index metadata inside the same `RUN` as the install.
9. The key is still in the layer where it was copied, and layer blobs can be unpacked directly from the image without running it. Use a build secret mount instead.
10. Compilers, development headers/dev packages, and build tools or test frameworks (also: bundlers, linters, code generators).

</details>

---

**Next:** [Base Image Selection](./12-base-images.md) — why "smaller is better" is the most expensive piece of Docker folklore.
