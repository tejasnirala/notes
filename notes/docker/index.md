---
title: Docker
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Docker

A complete path from *what is actually happening when a container starts* to *why is my image 1.2 GB and why did my deploy drop every in-flight request* — written from a production-engineering perspective and <H>language-agnostic at its core</H>.

Every page traces the **mechanism**, not just the syntax: what a layer physically is, how a cache key is computed, why deleting a file can make an image bigger, why `localhost` betrays you. Concrete languages and frameworks appear only as labelled examples showing that the same Docker concept holds across Node.js, Python, Java, Go, .NET, Ruby, PHP and Rust alike.

Every page ends with **rapid-fire recall** questions and collapsible answers.

---

## 📚 The curriculum

### Foundations — the mental model

| | Page | What it answers |
| :-- | :--- | :--- |
| 1 | **[Docker Fundamentals](./01-docker-fundamentals.md)** | What a container *is* at the OS level, the four isolations, container vs VM, and what an image contains |
| 2 | **[Docker Architecture](./02-docker-architecture.md)** | CLI → API → daemon → containerd → runc, what BuildKit changed, and where a given failure lives |
| 3 | **[Docker Images](./03-images.md)** | Manifest, config and blobs; tags vs digests; where the "blueprint/instance" analogy breaks |
| 4 | **[Image Layers](./04-image-layers.md)** | Union filesystems, copy-up, whiteouts, and why a `rm` can *grow* an image |

### Building images

| | Page | What it answers |
| :-- | :--- | :--- |
| 5 | **[The Dockerfile](./05-dockerfile.md)** | Every instruction, `CMD` vs `ENTRYPOINT`, and why exec form matters |
| 6 | **[Docker Build](./06-docker-build.md)** | What `docker build .` really does — especially the `.` |
| 7 | **[Build Context](./07-build-context.md)** | The most misunderstood input: what it is, and the three things it is not |
| 8 | **[`.dockerignore`](./08-dockerignore.md)** | Speed, security and cache stability from one file |

### Caching — where build time actually goes

| | Page | What it answers |
| :-- | :--- | :--- |
| 9 | **[Build Cache](./09-build-cache.md)** | Hits, misses, ordering by rate of change, and why CI has no cache |
| 10 | **[Cache Invalidation & Cache Keys](./10-cache-invalidation.md)** | The cascade, and why "one hash for the whole context" is wrong |
| 11 | **[Package Manager Caches & Layer Cleanup](./11-package-manager-caches.md)** | Two different caches, and "create and delete in the same layer" |

### Designing the image

| | Page | What it answers |
| :-- | :--- | :--- |
| 12 | **[Base Image Selection](./12-base-images.md)** | glibc vs musl, distroless, scratch, and native dependencies |
| 13 | **[Multi-Stage Builds](./13-multi-stage-builds.md)** | How a discarded stage still hands its output forward |

### Running containers

| | Page | What it answers |
| :-- | :--- | :--- |
| 14 | **[Runtime Configuration](./14-runtime-configuration.md)** | Build one image; configure it at run time |
| 15 | **[Secrets](./15-secrets.md)** | The four leak paths, build secrets, and runtime injection |
| 16 | **[Non-Root Containers](./16-non-root-containers.md)** | Container root is host root — and what else to drop |
| 17 | **[PID 1 & Signal Handling](./17-pid1-and-signals.md)** | Why `docker stop` takes ten seconds and loses requests |
| 18 | **[Development vs Production](./18-dev-vs-prod.md)** | Hot reload, the dependency-directory trap, one Dockerfile for both |
| 19 | **[Workers, Processes & Concurrency](./19-workers-and-concurrency.md)** | Why four workers cost four times the memory |
| 20 | **[Runtime Filesystem & Volumes](./20-runtime-filesystem-and-volumes.md)** | What survives what, and named volumes vs bind mounts |
| 21 | **[Docker Networking](./21-networking.md)** | Bridges, DNS, published ports, and what `localhost` means |

### Docker Compose

| | Page | What it answers |
| :-- | :--- | :--- |
| 22 | **[Docker Compose](./22-compose-fundamentals.md)** | The file, the project, override files, and where Compose stops |
| 23 | **[Compose Build & Networking](./23-compose-build-and-networking.md)** | Why `up` runs stale code, and how service discovery is wired |
| 24 | **[`depends_on`, Health Checks & Readiness](./24-compose-depends-on-and-health.md)** | Started ≠ ready, and liveness vs readiness |
| 25 | **[Configuration, Ports & Volumes](./25-compose-config-ports-volumes.md)** | The two different `.env` files, publishing, and `down -v` |
| 26 | **[Lifecycle Commands](./26-compose-lifecycle.md)** | `up`, `down`, `logs`, `exec` vs `run`, and their side effects |
| 27 | **[Compose Reference](./27-compose-reference.md)** | Every key you will use, with one example each |
| 28 | **[Production Compose Architecture](./28-production-compose.md)** | Where Compose is enough — and where it is not |

### Production

| | Page | What it answers |
| :-- | :--- | :--- |
| 29 | **[Production Image Optimization](./29-image-optimization.md)** | The checklist in priority order, and when to stop |
| 30 | **[Production Dockerfile Examples](./30-production-dockerfiles.md)** | Annotated templates for interpreted and compiled applications |
| 31 | **[Debugging & Inspection](./31-debugging.md)** | Five common failures, diagnosed — plus the command reference |

### Reference & revision

| | Page | What it answers |
| :-- | :--- | :--- |
| 32 | **[Common Misconceptions](./32-misconceptions.md)** | Twenty-two claims, corrected |
| 33 | **[Conceptual Distinctions](./33-distinctions.md)** | The pairs worth separating on demand |
| 34 | **[Terminology](./34-terminology.md)** | Interview-ready definitions for every term |
| 35 | **[Interview Question Bank](./35-interview-qa.md)** | Beginner → advanced, with follow-ups and what is being tested |
| 36 | **[The Production Mental Model](./36-mental-model.md)** | Everything connected, on one page |

---

## 🧭 Suggested paths

**Learning it properly:** 1 → 36, in order. Each page assumes the previous ones.

**Revising before an interview:** [32](./32-misconceptions.md) → [33](./33-distinctions.md) → [34](./34-terminology.md) → [35](./35-interview-qa.md) → [36](./36-mental-model.md).

**"My build is slow":** [7](./07-build-context.md) → [8](./08-dockerignore.md) → [9](./09-build-cache.md) → [10](./10-cache-invalidation.md).

**"My image is huge":** [4](./04-image-layers.md) → [11](./11-package-manager-caches.md) → [12](./12-base-images.md) → [13](./13-multi-stage-builds.md) → [29](./29-image-optimization.md).

**"Something is broken at run time":** [17](./17-pid1-and-signals.md) → [20](./20-runtime-filesystem-and-volumes.md) → [21](./21-networking.md) → [31](./31-debugging.md).

**Hardening for production:** [14](./14-runtime-configuration.md) → [15](./15-secrets.md) → [16](./16-non-root-containers.md) → [29](./29-image-optimization.md) → [28](./28-production-compose.md).

---

## 🎯 The one-line summary of each big idea

- <C color="orange">A container is an isolated process on a shared kernel</C> — not a lightweight VM.
- <C color="orange">An image is immutable layers plus configuration metadata</C>, identified by a digest.
- <C color="orange">A layer is a diff, and it is immutable</C> — so deleting a file later only hides it.
- <C color="orange">The build context is an input, not the image</C> — and only what `COPY` names crosses over.
- <C color="orange">Cache keys are per instruction</C>, over the inputs that instruction actually consumes.
- <C color="orange">Order the Dockerfile by rate of change</C>, slowest first.
- <C color="orange">Smaller image ≠ automatically better image.</C>
- <C color="orange">Build one image; configure it at run time.</C>
- <C color="orange">Secrets never belong in an image</C>, and deletion does not undo it.
- <C color="orange">The application should be PID 1</C> and handle `SIGTERM`.
- <C color="orange">`localhost` is the container</C>; use service names.
- <C color="orange">Containers are ephemeral</C>; state lives in volumes or outside entirely.
- <C color="orange">`depends_on` orders starts, not readiness.</C>
