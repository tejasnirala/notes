---
title: Base Image Selection
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Base Image Selection & Native Dependencies

> **What you will be able to do after this page**
>
> - Choose a base image on compatibility and operational grounds, not on megabytes.
> - Explain the glibc/musl distinction and the failure modes it produces.
> - Say what distroless and scratch actually give up.
> - Reason about native/compiled dependencies and why they force build/runtime separation.

---

## 1. What "base image" means here

The image your `FROM` names. Everything in it is in your image: its files, its package versions, its CVEs, its libc, its shell (or absence of one), and its maintenance cadence. <H>Choosing a base image is a long-term maintenance commitment, not a size decision.</H>

---

## 2. The size spectrum

```text
  ┌─────────────────────────────────────────────────────────────────┐
  │  FULL DISTRIBUTION        ~120–1000 MB                          │
  │  debian:bookworm, ubuntu:24.04, language images without -slim   │
  │  + everything present: shell, compilers often, package manager, │
  │    debugging tools, locales, docs                               │
  │  − large, wide CVE surface                                      │
  ├─────────────────────────────────────────────────────────────────┤
  │  SLIM DISTRIBUTION        ~30–150 MB                            │
  │  debian:bookworm-slim, <language>:<version>-slim                │
  │  + shell + package manager, docs and extras stripped            │
  │  − some libraries missing; install what you need explicitly     │
  ├─────────────────────────────────────────────────────────────────┤
  │  MINIMAL DISTRIBUTION     ~5–15 MB                              │
  │  alpine (musl libc, busybox userland, apk)                      │
  │  + tiny, has a shell and a package manager                      │
  │  − musl, not glibc: compatibility and performance differences   │
  ├─────────────────────────────────────────────────────────────────┤
  │  DISTROLESS               ~2–50 MB                              │
  │  runtime + libc + CA certs. NO shell, NO package manager        │
  │  + minimal attack surface, nothing to exec into                 │
  │  − no shell: debugging requires other techniques                │
  ├─────────────────────────────────────────────────────────────────┤
  │  SCRATCH                  0 bytes                               │
  │  literally empty                                                │
  │  + nothing to exploit                                           │
  │  − needs a fully static binary; no CA certs, no timezone data,  │
  │    no /etc/passwd, no DNS resolver config unless you add them   │
  └─────────────────────────────────────────────────────────────────┘
```

---

## 3. Why smaller is not automatically better

<H>smaller image ≠ automatically better image</H>

Size is one variable among six. The others regularly dominate:

### 3.1 Compatibility — the libc problem

Alpine uses **musl** libc; Debian/Ubuntu use **glibc**. They are different implementations of the same interface, and the differences are real:

| Symptom | Cause |
| :--- | :--- |
| `exec format error` / `not found` on an existing binary | A glibc-linked binary with no glibc dynamic loader present |
| A dependency compiles from source instead of using a prebuilt binary | Prebuilt binaries are usually published for glibc only, so the install falls back to compiling — turning a 20-second install into 10 minutes and requiring a compiler |
| Subtle DNS resolution differences | musl's resolver historically differs (search domains, parallel A/AAAA queries, no `/etc/nsswitch.conf`) |
| Stack-size crashes in threaded runtimes | musl's default thread stack is much smaller than glibc's |
| Performance regressions in allocation-heavy workloads | musl's malloc is simpler than glibc's; some workloads are measurably slower |

None of these make Alpine bad. They make Alpine <C color="orange">a decision that must be validated for your workload</C>, not a default.

### 3.2 Debuggability

At 3 a.m., with one pod misbehaving, a shell is worth more than 80 MB:

```bash
docker exec -it <container> sh      # impossible on distroless/scratch
```

Mitigations exist and are good practice: `kubectl debug` ephemeral containers, `docker debug`, sidecars, or a `debug` build stage derived from the production stage. But <H>if your team has not set those up, distroless converts an easy investigation into a hard one</H>.

### 3.3 Security surface — in both directions

Fewer packages means fewer CVEs and fewer binaries for an attacker to chain (`curl`, `wget`, a package manager and a shell are all useful to an intruder). That is a genuine argument for minimal images.

But: a minimal image with an outdated runtime is worse than a fat image that is rebuilt weekly. <H>Patch cadence beats package count.</H> And an image so awkward that people bypass it entirely improves nothing.

### 3.4 Build complexity and time

Minimal bases often need extra work: installing `ca-certificates`, timezone data, a compatibility layer, or a compiler to build native modules that would otherwise have installed a prebuilt binary. Slower builds are a real, daily cost.

### 3.5 What actually dominates size

Layer sharing usually matters more than base size. If your organisation's 40 services all use `debian:bookworm-slim`, that base is pulled and stored once per host. Forty *different* minimal bases can consume more disk than one shared larger one — and cost more attention to maintain.

### 3.6 Maintenance

Who patches this image? How often is the tag rebuilt? Is it still supported next year? An unmaintained "tiny" base is a liability. Prefer bases from the runtime's own maintainers, a major distro, or your platform team.

---

## 4. A decision procedure

```text
1. Does the app produce a fully static binary?
       yes → scratch or distroless static.  Add CA certs and tzdata if needed.
       no  ↓
2. Does it need an interpreter/VM at run time?
       yes → the official runtime image, -slim variant, pinned specifically
       no  ↓
3. Does it have native dependencies?
       yes → match the build base to the runtime base (same libc!)
             build in a full image, run in a slim one
       no  ↓
4. Does the team have non-shell debugging in place?
       yes → distroless is viable
       no  → keep a shell; add a debug stage
5. Is a base already standard in your organisation?
       yes → strongly prefer it: shared layers, one patch pipeline
```

And pin properly regardless of choice:

```dockerfile
FROM node:latest                                    # ❌ unreproducible
FROM node:20                                        # ⚠ moves with every minor release
FROM node:20.11.1-bookworm-slim                     # ✅ specific
FROM node:20.11.1-bookworm-slim@sha256:9f86d0…      # ✅✅ immutable and verifiable
```

Digest pinning gives reproducibility but freezes security updates, so it needs automation (Renovate/Dependabot) to bump the digest regularly. <H>Pinning without a bump process is how images rot.</H>

---

## 5. Native and compiled dependencies

Most ecosystems have dependencies that are not pure source: database drivers, cryptography, compression, image processing, numerical libraries. These contain C/C++/Rust code that must be **compiled** for the target platform, or downloaded as a prebuilt binary.

```text
   PURE dependency        source only → installs anywhere, no compiler
   NATIVE dependency      needs, at install time, either:
                            (a) a matching prebuilt binary for OS+arch+libc, or
                            (b) a compiler + development headers to build from source
```

This produces the build/runtime asymmetry that motivates multi-stage builds:

```text
   BUILD TIME needs                    RUN TIME needs
   ────────────────────────            ────────────────────────
   compiler toolchain                  the compiled artifact
   development headers (-dev/-devel)    the shared runtime libraries it links to
   build system, linkers               (typically much smaller)
   package manager caches
```

A concrete generic example: a dependency that binds to a compression library needs `libfoo-dev` (headers) to compile and only `libfoo` (the shared object) to run. Installing `-dev` packages in the runtime image is pure waste.

### Why minimal bases complicate this

- Prebuilt binaries are typically published for glibc. On musl, the install falls back to compiling — so you must add a compiler, which enlarges the image and slows the build, which was the opposite of the goal.
- Development headers may not exist in a minimal base, or may be split differently.
- **The build and runtime bases must have the same libc.** Compile against glibc, run on musl, and the binary will not load. <H>If you build in `<lang>:1.2-bookworm` you must run on a Debian-family image, not Alpine.</H>

### The standard resolution

```dockerfile
FROM <full-or-builder-image> AS builder
RUN <install compilers and development headers>
RUN <install/compile dependencies>
RUN <build the application>

FROM <slim-runtime-image>            # SAME distro family / same libc
RUN <install only runtime shared libraries>
COPY --from=builder <compiled artifacts> /app
```

The builder can be as large as it needs to be — <C color="green">none of it ships</C>. Details in [Multi-Stage Builds](./13-multi-stage-builds.md).

### Special case: statically linked binaries

Languages that produce a single static binary (Go with cgo disabled, Rust with a musl target, some C/C++ builds) sidestep the whole problem — the binary has no external library dependencies, so `scratch` or distroless-static is genuinely viable and genuinely tiny. This is the one case where "very small" is easy and safe. Remember CA certificates and timezone data if the program does TLS or local time.

---

## Rapid-fire recall

1. Complete: "smaller image ≠ …"
2. Name three concrete failure modes caused by musl vs glibc.
3. Why can Alpine make a build *slower*?
4. What do distroless images remove, and what does that cost operationally?
5. What must you add manually when using `scratch` for a program that makes HTTPS calls?
6. Why can forty different tiny bases use more disk than one shared slim base?
7. Which matters more for security: package count or patch cadence?
8. What breaks when the builder stage uses glibc and the runtime stage uses musl?
9. What is the difference between a `-dev` package and its runtime counterpart?
10. What is the risk of digest-pinning a base image, and what mitigates it?

<details>
<summary>Answers</summary>

1. "…automatically better image." Size is one factor among compatibility, debuggability, security surface, build complexity, layer sharing, and maintenance.
2. Any three: glibc-linked binaries failing to load; prebuilt binaries unavailable so dependencies compile from source; DNS resolution differences; smaller default thread stacks causing crashes; allocator performance differences.
3. Prebuilt binaries are usually glibc-only, so native dependencies compile from source — which also forces a compiler into the image.
4. The shell and package manager (and most of the userland). Cost: no `docker exec` shell, so debugging requires ephemeral containers, a debug stage, or other tooling.
5. CA certificates — and timezone data if it handles local time, plus `/etc/passwd` entries if you need a named non-root user.
6. Because layer sharing dedupes one common base across all images, while forty distinct bases are stored and pulled separately.
7. Patch cadence. A minimal image with an unpatched runtime is worse than a larger image rebuilt weekly.
8. The compiled binary cannot find a compatible dynamic loader or C library and fails to start. Build and runtime bases must share a libc.
9. `-dev`/`-devel` packages contain headers and static libraries needed only to *compile* against a library; the runtime package contains the shared object needed to *run*.
10. It freezes security updates. Mitigate with automated dependency-update tooling that bumps the digest regularly.

</details>

---

**Next:** [Multi-Stage Builds](./13-multi-stage-builds.md) — how the builder stage can be thrown away and still hand its output forward.
