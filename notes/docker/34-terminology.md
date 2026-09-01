---
title: Terminology
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Terminology

Each term gets a one-sentence answer you can say out loud, a deeper explanation, an example, and the misconception attached to it where one exists.

---

## Platform

### Docker

**One-liner.** A platform for packaging applications with their entire userspace into immutable images, and running them as isolated processes on a shared kernel.

**Deeper.** Four jobs behind one CLI: an image format, a build system, a distribution mechanism (registries), and a runtime. It did not invent containers — it made them usable by standardising the artifact and the workflow.

**Example.** `docker build -t api . && docker run -p 8080:8080 api`

**Misconception.** "Docker is virtualisation." It is process isolation on the host kernel.

### Docker Engine

**One-liner.** The server-side of Docker: the daemon, the API it exposes, and the components it delegates to.

**Deeper.** Implements the REST API, manages images/containers/networks/volumes, and delegates builds to BuildKit and container lifecycle to containerd and runc.

**Example.** `systemctl status docker`

### Docker CLI

**One-liner.** The `docker` command — a thin HTTP client that turns your commands into API calls.

**Deeper.** Holds no state and runs nothing. It resolves the Dockerfile, applies `.dockerignore`, streams the build context, and renders responses. It can target a remote engine via `DOCKER_HOST`.

**Example.** `DOCKER_HOST=ssh://server docker ps`

**Misconception.** "The CLI builds the image." The builder does, daemon-side.

### Docker daemon

**One-liner.** `dockerd` — the long-running process implementing the Docker API.

**Deeper.** Orchestrates but delegates: containerd for lifecycle, a shim per container, runc for isolation setup. Because shims own containers, restarting the daemon does not kill them.

**Example.** `/var/run/docker.sock`

**Misconception.** "The daemon does everything." It is a delegation chain.

### Docker API

**One-liner.** The versioned REST interface over a Unix socket or TCP that every Docker client speaks.

**Deeper.** Everything the CLI does is an API call, which is why Compose, Testcontainers and CI systems drive Docker programmatically. <H>Access to the socket is equivalent to root on the host.</H>

**Example.** `curl --unix-socket /var/run/docker.sock http://localhost/v1.43/containers/json`

### BuildKit

**One-liner.** Docker's modern build engine, which compiles a Dockerfile into a dependency graph and solves it with content-addressed caching.

**Deeper.** Default since Docker 23. Parallel stage execution, skipping of unreferenced stages, incremental context transfer, `--mount=type=cache` and `type=secret`, registry-backed cache, and multi-platform builds. `buildx` is the CLI plugin exposing it fully.

**Example.** `docker buildx build --platform linux/amd64,linux/arm64 --push -t org/app:1.0 .`

**Misconception.** "Builds are strictly top-to-bottom." BuildKit solves a DAG.

---

## Images and layers

### Docker image

**One-liner.** An immutable, content-addressed bundle of read-only filesystem layers plus a configuration, identified by the digest of its manifest.

**Deeper.** On disk: a manifest (optionally under a multi-arch index), a config JSON (`CMD`, `ENV`, `USER`, `WorkingDir`, architecture, history), and layer blobs.

**Example.** `docker inspect node:20 --format '{{.Config.Cmd}}'`

**Misconception.** "An image is a single file." It is a small graph of content-addressed objects.

### Docker container

**One-liner.** A running or stopped instance of an image: an isolated process with its own writable layer.

**Deeper.** Namespaces restrict what it sees, cgroups what it consumes, capabilities/seccomp what it may do. Its lifetime equals its PID 1's.

**Example.** `docker run -d --name api -p 8080:8080 myorg/api:1.4.2`

**Misconception.** "A container is always running." Stopped containers persist, with their writable layer.

### Dockerfile

**One-liner.** A declarative recipe of instructions describing how to build an image.

**Deeper.** Not a shell script: each `RUN` is its own process and its own cached step, and instruction order determines both layer structure and build performance.

**Example.** `FROM`, `WORKDIR`, `COPY`, `RUN`, `USER`, `ENTRYPOINT`

**Misconception.** "`RUN cd /app` changes the directory for later steps." Use `WORKDIR`.

### Docker layer

**One-liner.** A tar of the filesystem changes produced by one build step, stored as a content-addressed blob.

**Deeper.** A diff, not a snapshot. Identical layers are stored once and shared by every image and container that references them, which is what makes pulls and storage efficient.

**Example.** `docker image history --human myimage:tag`

### Immutable layer

**One-liner.** A layer whose bytes never change after creation, because its digest is derived from its content.

**Deeper.** Everything else follows: caching is safe, sharing is safe, and a later deletion can only *hide* a file, never remove its bytes.

**Misconception.** "`RUN rm` in a later step shrinks the image." It adds a whiteout and grows it slightly.

### Writable container layer

**One-liner.** The thin read-write layer added on top of the image layers for each container.

**Deeper.** Ephemeral (destroyed by `docker rm`), per container, and subject to copy-up: modifying a file that lives in a read-only layer copies the whole file up first.

**Example.** `docker diff <container>` shows exactly what a container has written.

---

## Build inputs

### Build context

**One-liner.** The file tree made available to the builder — the only source `COPY` and `ADD` can read from.

**Deeper.** Chosen by the final argument to `docker build`. It exists because the build runs elsewhere; it provides reproducibility, isolation from the rest of your disk, and remote builds. BuildKit transfers it lazily and incrementally.

**Example.** `docker build -f docker/Dockerfile .`

**Misconception.** "The context is the image", or "everything in it enters the image". Only what `COPY`/`ADD` names does.

### `.dockerignore`

**One-liner.** A file at the context root that filters the build context before it reaches the builder.

**Deeper.** Three benefits: speed (less transferred), security (a secret excluded from the context cannot be copied in by accident), and cache stability (churny files stop invalidating broad `COPY`s).

**Example.** `.git`, `**/node_modules`, `.env`, `dist/`, `coverage/`

**Misconception.** "It is the same as `.gitignore`." Different consumers, different scope, and a miss here can publish a credential.

---

## Caching

### Build cache

**One-liner.** A store of previous build-step results, reused when a step's inputs are unchanged.

**Deeper.** Lives on the builder, never in the image, and is not shared between machines by default — which is why fresh CI runners build cold unless you configure a registry cache.

**Example.** `--cache-from type=registry,ref=…:buildcache --cache-to …,mode=max`

### Cache hit / cache miss

**One-liner.** A hit reuses a stored step result; a miss re-executes the step.

**Deeper.** A hit reuses the *result*, so the resulting image is identical to one that ran the step. `CACHED` in build output marks hits; the first non-cached step is the boundary.

**Example.** `=> CACHED [builder 3/6] COPY package.json ./`

### Cache invalidation

**One-liner.** The point where a step's inputs stop matching any stored result, forcing it and its dependents to rebuild.

**Deeper.** Cascades downstream because each key includes its parent's result. Caused by instruction edits, changed copied files, changed build args, a new base digest — <H>never by changes in the outside world</H>.

**Misconception.** "A newly published package version invalidates my install step." It does not; Docker caches on declared inputs.

### Cache key

**One-liner.** The digest identifying a build step's inputs: its instruction, its parent's result, and the content it consumes.

**Deeper.** Instruction-dependent: `FROM` uses the resolved image digest; `RUN` uses the command string; `COPY` uses the content digests of the files it names.

**Misconception.** "One hash over the whole context." Keys are per step.

### Hash / checksum

**One-liner.** A digest of content used to detect whether it changed.

**Deeper.** Content digests of copied files feed `COPY` cache keys; layer and manifest digests are the identity of layers and images. Identical bytes always produce the same digest.

---

## Build structure

### Multi-stage build

**One-liner.** A Dockerfile with multiple `FROM` instructions, where later stages copy artifacts out of earlier ones.

**Deeper.** Only the final stage becomes the image, so build tooling cannot leak in. It also enables dev/test/prod variants from one file via `--target`.

**Example.** `COPY --from=builder /src/dist ./`

**Misconception.** "Mandatory for every production image." Only when the final image would otherwise carry unused build-time content.

### Builder stage

**One-liner.** A stage that exists only to produce artifacts and is not part of the final image.

**Deeper.** It can be as large as needed — full toolchain, headers, caches — because none of it ships.

### Runtime stage

**One-liner.** The final stage, containing only what is needed to run the application.

**Deeper.** Typically a slim or distroless base plus the copied artifacts, a non-root user, and the entrypoint. It must share a libc with the builder if any dependency is native.

### `COPY --from`

**One-liner.** Copies files from a previous stage — or from an arbitrary image — into the current stage.

**Deeper.** The only path between stages; nothing is inherited implicitly. Resolved during the build, while both stages exist. Use `--chown` when the runtime user is non-root.

**Example.** `COPY --from=builder --chown=10001:10001 /src/dist ./`

---

## Base images

### Base image

**One-liner.** The image your `FROM` names — everything in it is in your image, including its CVEs.

**Deeper.** Strictly, a "base" image is one built `FROM scratch`; the image you build on is the "parent". Colloquially the terms merge.

**Example.** `FROM node:20.11.1-bookworm-slim@sha256:…`

### Minimal image / slim image

**One-liner.** A stripped-down base with documentation, extras and optional tooling removed.

**Deeper.** `-slim` variants usually keep a shell and package manager while dropping most of the userland — commonly the best compatibility/size trade-off.

### Alpine

**One-liner.** A ~5 MB distribution built on musl libc and busybox.

**Deeper.** Excellent for static binaries and simple services. For native dependencies it can force source compilation (no glibc prebuilt binaries), and it differs in DNS behaviour, thread stack sizes and allocator performance.

**Misconception.** "Alpine is always best." It is a validated choice, not a default.

### Distroless

**One-liner.** An image containing a runtime, its libraries and CA certificates — with no shell and no package manager.

**Deeper.** Minimal attack surface: nothing for an intruder to exec. The cost is debuggability, so you need ephemeral debug containers or a `debug` stage first.

### `scratch`

**One-liner.** A completely empty base image.

**Deeper.** Viable only for fully static binaries. You must add anything you need: CA certificates for TLS, timezone data, `/etc/passwd` entries.

**Example.** `FROM scratch` + `COPY --from=builder /out/app /app`

---

## Dependencies and configuration

### Build dependency

**One-liner.** Something needed to build the application but not to run it — compilers, headers, build tools, test frameworks.

**Deeper.** Its presence in a runtime image is the usual reason a 1 GB image is 1 GB. Confine it to a builder stage.

### Runtime dependency

**One-liner.** Something the application needs while running — the runtime/interpreter, shared libraries it links against, production libraries.

**Deeper.** A native dependency needs `-dev` headers to compile and only the shared library to run; installing the `-dev` package in a runtime image is pure waste.

### Environment variable

**One-liner.** A key/value passed to the process, used for runtime configuration.

**Deeper.** `ENV` in a Dockerfile bakes a default into the image config; `-e`, `env_file` and orchestrator config override it. Flat strings only, and they leak into child processes and crash dumps.

**Example.** `docker run -e LOG_LEVEL=debug myimage`

**Misconception.** "Env vars are a fine place for secrets." They are visible in `docker inspect` and inherited by child images.

### Secret

**One-liner.** A value that grants access, and therefore must never be in an image or a repository.

**Deeper.** Build-time: `RUN --mount=type=secret`. Run-time: mounted files, orchestrator secrets, a secret manager, or workload identity with short-lived credentials.

**Misconception.** "Deleting it in a later layer cleans it up." If a secret was ever in an image, rotate it.

---

## Networking

### `EXPOSE`

**One-liner.** Metadata declaring the port an image intends to serve on.

**Deeper.** Opens nothing. Readable via `inspect` and used by `docker run -P` to auto-publish. Containers on the same network reach each other regardless.

### Port publishing

**One-liner.** Mapping a host port to a container port with `-p` or Compose `ports`, via a NAT rule.

**Deeper.** Only needed for access from the host or the outside world. Bind to `127.0.0.1:` on the host side to keep a service local; never publish databases in production.

**Example.** `-p 127.0.0.1:5432:5432`

### Docker network

**One-liner.** A virtual network that containers attach to, giving them addresses and a name-resolution scope.

**Deeper.** Drivers: `bridge` (default), `host`, `none`, `overlay` (multi-host), `macvlan`. Compose creates one user-defined bridge per project.

### Bridge network

**One-liner.** A virtual switch on the host that containers attach to via veth pairs.

**Deeper.** A **user-defined** bridge provides DNS-based service discovery and isolation; the legacy default bridge does not resolve container names.

### DNS / service discovery

**One-liner.** Docker's embedded DNS at `127.0.0.11` resolving container and service names to current IPs.

**Deeper.** Works on user-defined networks only. Scaled services resolve to multiple A records — crude distribution, not load balancing.

**Misconception.** "Use the container IP." It changes on every recreate.

---

## Storage

### Docker volume

**One-liner.** Storage managed outside the container's writable layer so data survives the container.

**Deeper.** Named, anonymous, or bind mounts; plus tmpfs for memory-backed scratch. Volume drivers allow network and cloud storage.

### Named volume

**One-liner.** A Docker-managed, named storage area referenced by name in `-v` or Compose.

**Deeper.** Portable across machines, initialised from the image's content at that path when empty, project-scoped in Compose, and destroyed by `docker compose down -v`.

**Example.** `-v database_data:/var/lib/<data-dir>`

### Bind mount

**One-liner.** A specific host path mapped into the container.

**Deeper.** No initialisation copy — it hides whatever the image had at that path. Keeps host ownership. The mechanism behind hot reload, and the reason `-v /:/host` is dangerous.

**Example.** `-v "$(pwd)":/app`

---

## Compose and lifecycle

### `depends_on`

**One-liner.** Declares start (and stop) ordering between Compose services.

**Deeper.** Plain form waits only for the container to start. `condition: service_healthy` and `service_completed_successfully` add real gating; application retries are still required.

**Misconception.** "It waits for readiness." Not by default.

### Health check

**One-liner.** A command the runtime runs inside a container to decide whether it is healthy.

**Deeper.** Exit 0 = healthy. `interval`, `timeout`, `retries`, `start_period`. Should answer "can I serve a request now?" and should not check the whole downstream world.

**Example.** `HEALTHCHECK CMD <probe> || exit 1`

### Readiness

**One-liner.** Whether a service can serve traffic right now.

**Deeper.** Distinct from liveness (is it irrecoverably broken → restart) and startup (has it finished booting). A failing dependency should fail readiness, not liveness.

**Misconception.** "Running means healthy." It means PID 1 has not exited.

### Root container / non-root container

**One-liner.** A container whose process runs as UID 0 versus one that has dropped to an unprivileged UID.

**Deeper.** Container root is host root without user-namespace remapping. Do privileged work at build time, then `USER 10001`. `USER` is a default — platform policy enforces it.

**Example.** `USER 10001:10001`, `--cap-drop=ALL`, `--read-only`

### PID 1

**One-liner.** The first process in the container's PID namespace, whose lifetime is the container's lifetime.

**Deeper.** The kernel gives PID 1 no default signal handlers, so an unhandled `SIGTERM` is discarded; it is also the reaper for orphaned processes.

**Misconception.** "Any process can be PID 1 safely." A shell wrapper breaks graceful shutdown.

### Signal handling

**One-liner.** Responding to `SIGTERM` by shutting down gracefully before `SIGKILL` arrives.

**Deeper.** `docker stop` sends `SIGTERM`, waits the grace period, then `SIGKILL`s. Use exec form so the app is PID 1; end entrypoint scripts with `exec "$@"`; exit 137 means it was killed, not stopped.

### Worker process

**One-liner.** One of several application processes, usually managed by a master, used to exploit multiple CPUs.

**Deeper.** Separate processes have separate memory, so shared state must be external. Size the count from the *container's* CPU and memory limits, not the host's.

**Misconception.** "Workers share application memory." Only `fork`-time copy-on-write pages, temporarily.

### Docker Compose

**One-liner.** A tool for defining a multi-container application declaratively in one file and managing its lifecycle as a unit.

**Deeper.** Creates a project-scoped network with DNS by service name, named volumes, and containers in dependency order. A single-host tool: no multi-host scheduling, autoscaling, or health-gated rolling updates.

**Example.** `docker compose up -d --build`

---

**Next:** [Interview Question Bank](./35-interview-qa.md).
