---
title: Common Misconceptions
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Common Misconceptions

Each entry: the claim, why it is wrong, and the accurate version. These are also the highest-yield interview questions, because getting one right shows you understand a mechanism rather than a slogan.

---

## Containers and isolation

### ❌ "A container is a lightweight VM."

A VM virtualises hardware and runs its own kernel under a hypervisor. A container is <H>an ordinary host process with a restricted view</H>, created from namespaces, cgroups and a union filesystem. The isolation boundary is the kernel's syscall interface, not virtualised hardware.

Why the difference matters: it makes people assume VM-grade security isolation. A kernel vulnerability can cross a container boundary; that is why hostile-multi-tenant platforms run containers inside VMs.

<C color="green">✅ A container is an isolated process on a shared kernel. It is not a machine.</C>

### ❌ "Every container has its own kernel."

They all share the host's. That is precisely why containers start in milliseconds and cost almost nothing per instance — and why you cannot run a Windows container on a Linux kernel, or load a kernel module for one container only.

<C color="green">✅ Containers share the host kernel; only userspace is isolated.</C>

### ❌ "Running as root is safe because containers are isolated."

Container root is <H>host UID 0</H> without user-namespace remapping. Combine it with a bind mount, an added capability, a mounted docker socket, or a kernel bug, and it is host root.

<C color="green">✅ Drop privilege at run time; add `--cap-drop=ALL`, `no-new-privileges` and a read-only root filesystem.</C>

### ❌ "Containers eliminate the need for process and resource management."

They add a limit boundary your process model must be tuned against. Runtimes that size worker pools or heaps from the host's CPU/RAM will over-allocate inside a limited container and get OOM-killed.

<C color="green">✅ Set explicit limits, and configure worker counts and heap sizes from the container's limits.</C>

---

## Architecture

### ❌ "The Docker CLI builds the image."

The CLI is a thin API client. It resolves the Dockerfile, applies `.dockerignore`, and streams a request; <H>BuildKit, daemon-side, executes the build</H>. This is why a huge build context costs time before any instruction runs, and why builds can run on a remote or in-container builder.

<C color="green">✅ The CLI sends a build request; the builder executes it.</C>

### ❌ "The daemon does absolutely everything."

`dockerd` implements the API and orchestrates, but delegates: BuildKit builds, `containerd` manages container lifecycle and images, a per-container shim owns stdio and the exit status, and `runc` sets up namespaces and cgroups then exits.

<C color="green">✅ Modern Docker is a delegation chain — which is why restarting `dockerd` does not kill running containers.</C>

---

## Build context and images

### ❌ "The build context is the image."

The context is an *input* to the build; the image is the *output*. They share only what a `COPY`/`ADD` explicitly moves across.

<C color="green">✅ Context in, image out; nothing crosses implicitly.</C>

### ❌ "Everything in the build context ends up in the image."

Only what a `COPY`/`ADD` names. Being in the context means "reachable", not "included".

<C color="green">✅ …but `COPY . .` names everything, which is why `.dockerignore` is what makes it safe.</C>

### ❌ "`COPY . .` is always bad."

It is idiomatic as the last content step of a stage. The problem is placing a broad `COPY` <H>before</H> an expensive step, which destroys that step's cache.

<C color="green">✅ Copy dependency manifests first, install, then copy the source.</C>

### ❌ "Docker hashes the whole build context to get one cache key."

Keys are computed **per step**. A `COPY package.json .` key covers that file only, which is exactly why the manifest-then-source pattern works.

<C color="green">✅ Cache keys are per instruction, over the inputs that instruction actually consumes.</C>

### ❌ "Every Dockerfile line becomes a separate permanent layer exactly as written."

A good approximation, not a law. `RUN`/`COPY`/`ADD` produce filesystem layers; metadata instructions do not. BuildKit compiles a DAG, skips unreferenced stages, never commits cache mounts, and matches cache on content.

<C color="green">✅ Reason per instruction, but know the model is an approximation.</C>

### ❌ "Deleting a file in a later layer removes its bytes."

Layers are immutable. A deletion writes a **whiteout** that hides the path; the bytes remain in the earlier layer, and the image gets slightly *larger*.

<C color="green">✅ Create and delete within one instruction — or use multi-stage builds so the polluted stage never ships.</C>

### ❌ "`:latest` is the newest version."

It is just the default tag name. It points wherever it was last pushed, which may be years old, and it makes deployments unreproducible.

<C color="green">✅ Pin specific tags; pin digests where reproducibility matters.</C>

---

## Dependencies and base images

### ❌ "The package-manager cache and the installed dependencies are the same thing."

The cache holds downloaded archives kept for *future* installs. The installed dependencies are what the application actually uses. Deleting the cache removes only the former.

<C color="green">✅ They are separate directories with separate purposes.</C>

### ❌ "Disabling the package-manager cache means dependencies are not installed."

The download and install happen exactly as before; only the retained copy is skipped.

<C color="green">✅ It changes what is *kept*, not what is *installed*.</C>

### ❌ "A smaller base image is always better."

Size is one variable among compatibility, debuggability, security surface, build time, layer sharing and maintenance. A minimal image with an unpatched runtime is worse than a larger one rebuilt weekly.

<C color="green">✅ smaller image ≠ automatically better image.</C>

### ❌ "Alpine is always the best production choice."

Alpine uses musl, not glibc. Consequences: glibc-linked binaries fail to load; prebuilt binaries are often unavailable so dependencies compile from source (needing a compiler and minutes of build time); DNS behaviour differs; default thread stacks are smaller; allocation-heavy workloads can be slower.

<C color="green">✅ Alpine is excellent for static binaries and simple services, and must be validated for anything with native dependencies.</C>

### ❌ "Multi-stage builds are mandatory for every production image."

They are mandatory when the final image would otherwise contain things it will never use. If your image already contains only the runtime and production dependencies, multi-stage adds lines and no value.

<C color="green">✅ Ask "is anything here unused at run time?" — not "am I using multi-stage?"</C>

---

## Runtime

### ❌ "A container's filesystem is persistent."

The writable layer is created at `docker create` and destroyed at `docker rm`. Anything that must survive belongs in a volume.

<C color="green">✅ Containers are ephemeral; externalise state.</C>

### ❌ "`localhost` refers to another container."

`localhost` is the current network namespace — the container itself. Nothing in another container is reachable that way.

<C color="green">✅ Use the service name on a shared user-defined network. And bind your server to `0.0.0.0`, or published ports will not reach it.</C>

### ❌ "`EXPOSE` publishes a port."

`EXPOSE` is metadata. It opens nothing and changes no networking. Publishing is `-p` or Compose `ports`, and containers on the same network reach each other regardless.

<C color="green">✅ `EXPOSE` documents; `-p` publishes.</C>

### ❌ "`depends_on` means the dependency is ready."

It waits for the container to *start*, not for the service to be *ready*. A database process starts in milliseconds and may accept connections 30 seconds later.

<C color="green">✅ Use `condition: service_healthy` with a real health check — and implement retries with backoff regardless, because dependencies fail after start-up too.</C>

### ❌ "A running container means the application is healthy."

It means PID 1 has not exited. The application may be deadlocked, out of connections, or returning 500s to everything.

<C color="green">✅ Health must be defined and measured; distinguish liveness from readiness.</C>

### ❌ "All worker processes share the application's memory."

Separate processes have separate address spaces. A cache built in one worker is invisible to the others. `fork` gives *temporary* copy-on-write sharing, which erodes as refcounting or GC writes to pages.

<C color="green">✅ Threads share memory; forked processes share opportunistically; containers share nothing. Externalise shared state.</C>

---

## Secrets

### ❌ "Secrets are safe inside `ENV`."

`docker inspect` prints every `ENV` value from the image — no container needed. Child images inherit them, and the environment leaks into child processes, crash dumps and error reports.

<C color="green">✅ Build secrets via `RUN --mount=type=secret`; runtime secrets as mounted files, ideally short-lived credentials.</C>

### ❌ "Deleting the secret in a later `RUN` cleans it up."

Same whiteout mechanism as any other file — and the command string may itself be in the build history.

<C color="green">✅ If a secret was ever in an image, rotate it. Distribution cannot be undone.</C>

---

**Next:** [Conceptual Distinctions](./33-distinctions.md) — the pairs worth being able to separate on demand.
