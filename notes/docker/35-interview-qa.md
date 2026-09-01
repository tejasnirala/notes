---
title: Interview Question Bank
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Interview Question Bank

Each question: the answer to say, the depth behind it, an example, the follow-up you should expect, and what is really being assessed.

---

# Beginner

### What is Docker?

- **Answer.** A platform for packaging an application with its entire userspace into an immutable image and running it as an isolated process on a shared kernel.
- **Deeper.** Four jobs: image format, build system, distribution via registries, and runtime. It solves the gap between the build machine and the run machine.
- **Example.** The same image digest runs on a laptop, in CI, and in production; only injected configuration differs.
- **Follow-up.** "How is that different from a VM?"
- **Testing.** Whether you understand the problem it solves, not just the commands.

### What is a container?

- **Answer.** A process isolated by Linux namespaces, constrained by cgroups, running on a union filesystem of image layers plus a writable layer.
- **Deeper.** Namespaces control what it sees (PID, mount, network, UTS, IPC, user); cgroups what it consumes; capabilities and seccomp what it may do. It appears in the host's process table with a normal PID.
- **Example.** `docker run nginx`, then `ps aux | grep nginx` on the host.
- **Follow-up.** "Does it have its own kernel?" (No.)
- **Testing.** Whether "container" is a mechanism to you or a magic word.

### What is an image?

- **Answer.** An immutable, content-addressed set of read-only layers plus configuration metadata, identified by a digest.
- **Deeper.** Manifest + config JSON + layer blobs. The config holds `CMD`, `ENV`, `USER`, `WorkingDir` — metadata, not files.
- **Example.** `docker inspect node:20 --format '{{.Config.Cmd}}'`
- **Follow-up.** "Image vs container?"
- **Testing.** Whether you know an image is more than "a zip of files".

### What is a Dockerfile?

- **Answer.** A declarative recipe of instructions describing how to build an image.
- **Deeper.** Each `RUN` is a separate process and a separate cached step; instruction order determines layer structure and build performance.
- **Example.** `FROM` → `WORKDIR` → `COPY` manifests → `RUN` install → `COPY` source → `USER` → `CMD`.
- **Follow-up.** "Why is that order significant?"
- **Testing.** Whether you see it as a build graph or a shell script.

### What is Docker Compose?

- **Answer.** A tool for defining a multi-container application declaratively in one file and managing its lifecycle as a unit.
- **Deeper.** It creates a project-scoped network with DNS by service name, named volumes, and starts containers in dependency order.
- **Example.** `docker compose up -d` replacing five `docker run` invocations.
- **Follow-up.** "Would you use it in production?"
- **Testing.** Whether you know its scope — and its limits.

### What does `FROM` do?

- **Answer.** Starts a build stage from a parent image, inheriting its filesystem *and* its configuration.
- **Deeper.** Multiple `FROM`s create multiple stages. Pin the tag — and the digest where reproducibility matters.
- **Example.** `FROM python:3.12-slim AS builder`
- **Follow-up.** "Why not `latest`?"
- **Testing.** Awareness that you inherit `ENV`/`ENTRYPOINT` too, and that pinning matters.

### What does `WORKDIR` do?

- **Answer.** Sets the working directory for subsequent instructions and for the container, creating it if needed.
- **Deeper.** `RUN cd /app` does not persist, because each `RUN` is its own process.
- **Example.** `WORKDIR /app`
- **Follow-up.** "What owns that directory if you later switch to a non-root user?"
- **Testing.** Understanding that build steps are independent processes.

### What does `COPY` do? How does it differ from `ADD`?

- **Answer.** Copies files from the build context (or another stage) into the image. `ADD` additionally fetches URLs and auto-extracts local tar archives.
- **Deeper.** Prefer `COPY` for predictability; `ADD`'s extraction is implicit behaviour. `COPY --from` reads from another stage or image; `--chown` sets ownership as files are written.
- **Example.** `COPY --from=builder --chown=10001:10001 /src/dist ./`
- **Follow-up.** "What does `COPY` do to the build cache?"
- **Testing.** Whether you default to the predictable instruction.

### What does `RUN` do? How is it different from `CMD`?

- **Answer.** `RUN` executes at build time and creates a layer; `CMD` sets the default command executed at container start and creates no layer.
- **Deeper.** Multiple `RUN`s all execute; only the last `CMD` has effect. `RUN` is cached on its command string, not its effect.
- **Example.** `RUN <install deps>` vs `CMD ["<app>"]`
- **Follow-up.** "And `ENTRYPOINT`?"
- **Testing.** The build-time / run-time boundary — the most common category error.

---

# Intermediate

### What is the Docker build context?

- **Answer.** The file tree made available to the builder — the only source `COPY`/`ADD` can read from — chosen by the final argument to `docker build`.
- **Deeper.** It exists because the build runs elsewhere; it gives reproducibility, isolation, and remote builds. It is an input, not the image, and a file in it enters the image only if a `COPY` names it.
- **Example.** `docker build -f docker/Dockerfile .` — context is `.`, Dockerfile elsewhere.
- **Follow-up.** "Why is a large context a problem?"
- **Testing.** Whether you can distinguish input from output.

### Why use `.dockerignore`?

- **Answer.** To filter the context before transfer: faster builds, no accidental inclusion of secrets or junk, and stable caching.
- **Deeper.** Security is the undersold benefit — excluding `.env` makes `COPY . .` structurally safe. Excluding churny generated files stops needless invalidation. Excluding host dependency directories prevents platform-wrong binaries entering the image.
- **Example.** `.git`, `**/node_modules`, `.env`, `dist/`, `coverage/`
- **Follow-up.** "How is it different from `.gitignore`?"
- **Testing.** Whether you think about what leaves your machine.

### How does Docker layer caching work?

- **Answer.** Each build step has a cache key over its inputs; a matching key reuses the stored result. Because each key includes its parent's result, one miss rebuilds everything downstream.
- **Deeper.** `RUN` is keyed on the command string; `COPY` on the content digests of the files it names. That difference is what makes ordering matter.
- **Example.** `COPY <manifest>` + `RUN install` before `COPY . .` keeps the install cached across code changes.
- **Follow-up.** "What exactly is a cache key?"
- **Testing.** Whether you can explain the mechanism, not just recite the pattern.

### What causes cache invalidation?

- **Answer.** A change to the instruction, to files a `COPY` names, to a referenced build arg, or to the base image digest — and the miss cascades to dependent steps.
- **Deeper.** Notably *not* caused by the outside world: a newly published package version does not invalidate a cached `RUN install`, which is why cached installs can be silently stale.
- **Example.** `--progress=plain`, then find the first non-`CACHED` step.
- **Follow-up.** "Why did my build rebuild when no file content changed?" (Metadata, a generated file, or a fresh CI checkout.)
- **Testing.** Debugging skill, and awareness of the staleness trade-off.

### Why copy dependency manifests before source code?

- **Answer.** So the expensive install step's cache key depends only on dependency inputs, not on every source file.
- **Deeper.** With `COPY . .` first, any file change misses, and the cascade forces a full re-install. Lock files also make the install deterministic, so cache hits and cold builds agree.
- **Example.** 0.3 s vs 38 s on a one-line code change.
- **Follow-up.** "So is `COPY . .` always bad?" (No — only before an expensive step.)
- **Testing.** Whether you can state the rule precisely rather than as folklore.

### Why remove temporary files in the same `RUN`?

- **Answer.** Layers are immutable; a deletion in a later layer writes a whiteout that hides the path while the bytes stay in the earlier layer — so the image grows rather than shrinks.
- **Deeper.** A layer captures the step's end state, so a file created and deleted inside one `RUN` never appears. Counter-pressures: one huge `RUN` is one huge cache unit, and multi-stage builds or cache mounts often express it better.
- **Example.** `RUN <install> && <clean cache> && rm -rf <package lists>`
- **Follow-up.** "How would you get a secret out of an image that was deleted in a later layer?" (You cannot — rotate it.)
- **Testing.** Whether you understand layers or just memorised the rule.

### What is a multi-stage build?

- **Answer.** A Dockerfile with multiple `FROM`s where later stages copy artifacts from earlier ones; only the final stage becomes the image.
- **Deeper.** Smaller images, reduced attack surface, no cleanup rituals, and dev/test/prod variants via `--target`. Both stages exist during the build — "discarded" means "not included in the final image".
- **Example.** A 900 MB builder collapsing to a 20 MB runtime image.
- **Follow-up.** "If the builder is discarded, how does the next stage read its files?"
- **Testing.** Whether you understand build-time versus image content.

### Why run containers as non-root?

- **Answer.** Because container root is host UID 0; least privilege limits what a compromise can reach.
- **Deeper.** Build-time root is fine and usually necessary; drop with `USER` before the runtime. Prefer a numeric UID, use `COPY --chown`, and pair it with `--cap-drop=ALL`, `no-new-privileges` and a read-only root filesystem. `USER` is a default the platform must enforce.
- **Example.** `USER 10001:10001`
- **Follow-up.** "How do you serve port 80 as non-root?" (Listen on 8080 and publish `-p 80:8080`.)
- **Testing.** Security instinct, and whether you know isolation is not a guarantee.

### `EXPOSE` vs `ports`?

- **Answer.** `EXPOSE` is documentation in image metadata and publishes nothing; `ports`/`-p` installs a host NAT rule mapping a host port to a container port.
- **Deeper.** Containers on the same network reach each other on any port with neither. Publishing is only about access from the host or outside.
- **Example.** `EXPOSE 8080` + `-p 80:8080`
- **Follow-up.** "Should a database service publish ports?" (No — and if needed locally, bind to `127.0.0.1`.)
- **Testing.** Whether you know what actually changes networking.

### What is a Docker volume?

- **Answer.** Storage outside the container's writable layer, so data survives the container.
- **Deeper.** Named volumes (Docker-managed, portable, initialised from the image path when empty), bind mounts (a host path, no initialisation, host ownership), tmpfs (memory-backed). `docker rm` destroys the writable layer; volumes survive — unless `down -v`.
- **Example.** `-v database_data:/var/lib/<data-dir>`
- **Follow-up.** "What ownership does a fresh named volume get?" (The image path's — a non-root pitfall.)
- **Testing.** Whether you treat containers as ephemeral.

### How does Compose networking work?

- **Answer.** Compose creates a user-defined bridge per project and attaches every service; Docker's embedded DNS resolves service names to current IPs.
- **Deeper.** Use service names, never IPs — IPs change on every recreate. Other services connect to the *container* port; the published host port is irrelevant internally. Scaling gives multiple A records, which is distribution, not load balancing.
- **Example.** `DATABASE_URL: postgres://app@database:5432/app`
- **Follow-up.** "Why doesn't `localhost` work between containers?"
- **Testing.** The single most common practical Docker bug.

---

# Advanced

### How does Docker determine cache reuse?

- **Answer.** It computes a cache key per step from the instruction, the parent step's result, and the inputs that instruction consumes, then reuses a stored result whose key matches.
- **Deeper.** BuildKit compiles the Dockerfile to a content-addressed DAG and matches per vertex; it also does content-based matching for local files, recovering hits the legacy builder could not. A miss cascades to dependents, not to independent stages.
- **Example.** `COPY package.json .` is unaffected by a change to `src/index.js`.
- **Follow-up.** "So what invalidates a `RUN` whose command string is unchanged?" (Its parent changed, or a referenced build arg did.)
- **Testing.** Depth beyond "Docker caches layers".

### What is a cache key, and how do file hashes relate?

- **Answer.** A cache key identifies a step's inputs as a digest; file content digests are ingredients in that key for `COPY`/`ADD`.
- **Deeper.** `FROM` keys on the resolved image digest, `RUN` on the command string, `COPY` on the content and metadata of the named files. <H>There is no single hash over the whole build context</H> — that myth makes the manifest-first pattern look pointless.
- **Example.** Editing whitespace changes a file's digest and therefore the `COPY` key.
- **Follow-up.** "Why did an unchanged file still invalidate?" (Metadata: mode, or timestamps in the legacy builder.)
- **Testing.** Whether you can correct a widespread inaccuracy.

### Why can deleting a file fail to reduce image size?

- **Answer.** Because layers are immutable: the deletion is a whiteout in a later layer, and the file's bytes remain in the earlier one.
- **Deeper.** The image gets marginally larger. It is also a security issue: `docker save` and untar reads deleted files with no container involved.
- **Example.** `COPY id_rsa` then `RUN rm id_rsa` — the key is still extractable.
- **Follow-up.** "How do you use a credential during a build safely?" (`RUN --mount=type=secret`.)
- **Testing.** Layer mechanics and their security implications.

### How does `COPY --from` work if the builder stage is discarded?

- **Answer.** Both stages exist during the build; `COPY --from` resolves then. "Discarded" means the builder's layers are not part of the final image.
- **Deeper.** Nothing is inherited implicitly, so build tooling cannot leak in. `--from` also accepts an arbitrary image reference. The builder's result still occupies build cache and can be exported for CI reuse.
- **Example.** `COPY --from=nginx:1.25 /etc/nginx/nginx.conf ./`
- **Follow-up.** "What happens to stages nothing references?" (They are never built.)
- **Testing.** Whether the build model is clear or magical to you.

### Why might minimal images create compatibility problems? Why isn't Alpine automatically better?

- **Answer.** Alpine uses musl rather than glibc, so glibc-linked binaries will not load and prebuilt binaries are often unavailable, forcing source compilation.
- **Deeper.** Also: DNS resolution differences, much smaller default thread stacks, allocator performance differences, and no shell on distroless/scratch. Size is one variable among compatibility, debuggability, security surface, build time, layer sharing and maintenance. A shared slim base across 40 services can beat 40 distinct tiny ones on total disk.
- **Example.** A native dependency compiling for 10 minutes on Alpine and installing a prebuilt binary in 20 seconds on a Debian slim.
- **Follow-up.** "When *is* Alpine or scratch clearly right?" (Fully static binaries.)
- **Testing.** Engineering judgement over cargo-culted rules.

### Why does changing one file cause an expensive step to repeat?

- **Answer.** Because a broad `COPY` before it includes that file in its cache key; the miss cascades to every dependent step.
- **Deeper.** The fix is ordering by rate of change: manifests, install, then source. In CI the extra factor is an empty cache on fresh runners, fixed with a registry cache and `mode=max`.
- **Example.** Editing `README.md` re-running a full dependency install.
- **Follow-up.** "How would you diagnose it?" (`--progress=plain`, find the first non-`CACHED` step.)
- **Testing.** Whether you can reason from mechanism to fix.

### Why does `localhost` behave differently inside containers?

- **Answer.** Each container has its own network namespace and therefore its own loopback interface; `localhost` means "this container".
- **Deeper.** Container-to-container needs the service name on a shared user-defined network. Host-to-container needs a published port. The mirror-image bug: binding to `127.0.0.1` inside the container makes the process unreachable even with `-p`, because published traffic arrives on `eth0`.
- **Example.** `postgres://app@database:5432/app`, not `localhost:5432`.
- **Follow-up.** "How does a container reach a service running on the host?" (`host.docker.internal`, or the bridge gateway.)
- **Testing.** Whether you understand namespaces concretely.

### What does `depends_on` actually guarantee?

- **Answer.** Start ordering and stop ordering. Nothing about readiness.
- **Deeper.** `condition: service_healthy` gates on a health check, and `service_completed_successfully` on a one-shot job. But dependencies also fail after start-up, so retries with exponential backoff and jitter are required regardless. Kubernetes has no equivalent at all, for that reason.
- **Example.** The "run `compose up` twice and it works" symptom.
- **Follow-up.** "What does your health check check, and why not more?"
- **Testing.** Distributed-systems thinking, not YAML recall.

### Why can multiple workers increase memory consumption so much?

- **Answer.** Each worker is a separate process with its own address space; there is no automatic sharing of application memory.
- **Deeper.** `fork` gives copy-on-write sharing that erodes as refcounting or GC writes to pages. Worker counts auto-detected from the *host's* CPU count inside a limited container are a classic OOM cause. Connection counts multiply as workers × pool × replicas.
- **Example.** 64 workers × 80 MB inside a 512 MB limit.
- **Follow-up.** "How do you size worker count?" (Minimum of CPU-derived and memory-derived, from the container's limits, then measure.)
- **Testing.** Whether you connect runtime behaviour to container limits.

### What is PID 1 and why does it matter?

- **Answer.** The first process in the container's PID namespace. The kernel applies no default signal actions to it, and orphaned processes are reparented to it.
- **Deeper.** So a PID 1 without a `SIGTERM` handler ignores `docker stop` until `SIGKILL`. A shell-form `CMD` makes `/bin/sh` PID 1, which does not forward signals; an entrypoint script must end with `exec "$@"`. Use `--init`/tini when your app spawns children and does not reap.
- **Example.** Exit code 137 after `docker stop` is the signature.
- **Follow-up.** "What does a correct graceful shutdown do, in order?"
- **Testing.** Whether you have operated containers, not just built them.

### How should secrets be handled?

- **Answer.** Never in the image. Build-time via `RUN --mount=type=secret`; run-time via mounted files, orchestrator secrets, a secret manager, or workload identity.
- **Deeper.** Four leak paths: layers (`docker save`), image config `ENV` (`docker inspect`), build history (including build args), and the process environment. Files beat environment variables; short-lived credentials beat stored ones. If a secret was ever in an image, rotate it.
- **Example.** `DB_PASSWORD_FILE=/run/secrets/db_password`
- **Follow-up.** "A secret was committed to an image last month and the tag is deleted. What now?" (Rotate.)
- **Testing.** Whether you know the leak paths, not just the slogan.

### How would you optimise a 1 GB image?

- **Answer.** Measure first with `docker image history` and `du` inside the container, then act on the largest contributor.
- **Deeper.** The usual order: `.dockerignore`; multi-stage to drop the toolchain; production-only dependencies; no package caches; same-layer cleanup; a slimmer base if compatibility allows; copy artifacts rather than the source tree. <H>Smallest practical, not smallest possible.</H>
- **Example.** Finding a compiler toolchain and a package cache in `history`.
- **Follow-up.** "When would you stop?" (When it breaks untested compatibility or your debugging path, or costs more than it saves.)
- **Testing.** Method over memorised tips.

### How would you debug a slow build?

- **Answer.** `--progress=plain`, find the first non-`CACHED` step, and check the context transfer size.
- **Deeper.** Slow before any step → oversized context. Install re-running on code changes → ordering. Everything cold in CI → no shared cache; add `--cache-from`/`--cache-to` with `mode=max`. Inherently slow step → a cache mount, parallel stages, or a prebuilt base. Emulated cross-builds → native builders per architecture.
- **Example.** `transferring context: 412MB` as the first clue.
- **Follow-up.** "Why is CI slower than your laptop?"
- **Testing.** Systematic diagnosis.

### Design a production Dockerfile for a compiled application.

- **Answer.** Two stages: a builder with the full toolchain producing a self-contained artifact, and a minimal runtime that copies only the artifact, runs as non-root, and uses an exec-form entrypoint.
- **Deeper.** Manifests before source for cache stability; cache mounts for dependency and build caches; a static binary allows distroless or scratch — remembering CA certificates and timezone data; if it is dynamically linked, builder and runtime must share a libc.
- **Example.** See [chapter 30 §3](./30-production-dockerfiles.md).
- **Follow-up.** "What does the runtime image need beyond the binary?"
- **Testing.** Whether you can synthesise everything above into one file.

### Design one for an interpreted application.

- **Answer.** Install production dependencies behind a manifest-first cache boundary, copy source last, run as non-root with an exec-form entrypoint — and use extra stages only if there is a build step or dev dependencies to exclude.
- **Deeper.** The runtime needs the dependency tree, so it is carried across; the gain from multi-stage is narrower than for compiled applications, and a single stage can be entirely correct. Watch for native dependencies requiring build tools that the runtime image should not carry.
- **Example.** See [chapter 30 §2](./30-production-dockerfiles.md).
- **Follow-up.** "When would you *not* use multi-stage here?"
- **Testing.** Judgement — whether you apply patterns or follow them.

---

## Questions worth asking back

Interviews go better when you have these ready:

- How are images built and promoted — is the same digest deployed through every environment?
- Where does the build cache live in CI?
- How are secrets injected at run time?
- Do containers run as non-root with resource limits set?
- How is graceful shutdown verified during deploys?
- What runs the containers in production, and why that choice?

---

**Next:** [The Production Mental Model](./36-mental-model.md) — everything on one page.
