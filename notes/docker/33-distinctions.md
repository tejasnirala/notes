---
title: Conceptual Distinctions
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Conceptual Distinctions

Pairs that are routinely conflated. Each one is a plausible interview question in the form "what's the difference between X and Y?".

---

## Docker CLI vs Docker daemon

| | CLI | Daemon (`dockerd`) |
| :--- | :--- | :--- |
| What | A thin HTTP client | A long-running server |
| State | None | Images, containers, networks, volumes |
| Location | Anywhere (`DOCKER_HOST`) | Where the containers run |
| Builds images | <C color="crimson">No</C> | Orchestrates; BuildKit executes |

<H>The CLI packages requests; the engine does the work.</H>

---

## Image vs container

| | Image | Container |
| :--- | :--- | :--- |
| Nature | Immutable template: layers + config | A running or stopped instance |
| Storage | Read-only layers, shared | Its own writable layer |
| Count | One | Many from the same image |
| Lifecycle | Built, pushed, pulled | Created, started, stopped, removed |

Where the class/object analogy breaks: a container exists without running; layers are *shared*, not copied per instance; run-time overrides and mounts make the container diverge; and `FROM` is not inheritance.

---

## Image layers vs the writable container layer

| | Image layers | Writable layer |
| :--- | :--- | :--- |
| Mutability | Immutable | Read-write |
| Sharing | Shared by every container | One container only |
| Lifetime | As long as the image | Destroyed by `docker rm` |
| Written by | Build steps | The running process |
| Performance | Read-only, no copy-up | Copy-up on modifying existing files |

---

## Build context vs image

The context is an **input** (a file set on your machine, filtered by `.dockerignore`); the image is the **output** (layers plus config). <H>Nothing crosses except what `COPY`/`ADD` names.</H>

## Build context vs container filesystem

The context exists only during the build, on the builder. The container filesystem exists at run time and consists of image layers plus a writable layer plus mounts. A file in the context is not in the container unless it was copied into the image.

---

## Build time vs run time

| | Build time | Run time |
| :--- | :--- | :--- |
| Produces | An image | A container |
| Executes | `RUN` | `ENTRYPOINT`/`CMD` |
| Variables | `ARG` (and `ENV`) | `ENV`, `-e`, env files, mounted config |
| Sees | The build context | Volumes, mounts, injected configuration |
| Frequency | Once, in CI | Every container start |

Most Docker mistakes are a category error across this line.

---

## `RUN` vs `CMD`

| | `RUN` | `CMD` |
| :--- | :--- | :--- |
| When | Build time | Container start |
| Effect | Creates a layer | Sets metadata |
| Repeats | Every build (unless cached) | Every container start |
| Multiple | All execute | <H>Only the last has effect</H> |

## `CMD` vs `ENTRYPOINT`

| | `CMD` | `ENTRYPOINT` |
| :--- | :--- | :--- |
| Means | Default command or default arguments | The executable the container *is* |
| Run-time args | Replace it entirely | Are appended to it |
| Typical use | Toolbox images, default flags | Fixed-purpose service images |

`ENTRYPOINT ["app"]` + `CMD ["--port","80"]` → `docker run img --debug` runs `app --debug`.

---

## `COPY` vs build context

`COPY` is the instruction; the context is the file set it may read from. `COPY` selects; the context bounds what is selectable. `COPY ../x .` fails because it leaves the context.

---

## Docker build cache vs package-manager cache

| | Docker build cache | Package-manager cache |
| :--- | :--- | :--- |
| Owned by | BuildKit | The package tool |
| Contains | Step results | Downloaded archives, build artifacts |
| Location | The builder | <C color="crimson">Inside the image, unless prevented</C> |
| Affects image size | No | Yes |
| Cleared by | `docker builder prune` | The tool's clean command, or a cache mount |

---

## Cache key vs file hash

A **file hash** is a digest of one file's contents. A **cache key** is the digest identifying a whole build step: its instruction, its parent step's result, and the digests of the inputs it consumes. <H>File hashes are ingredients; the cache key is the dish.</H>

---

## Host `localhost` vs container `localhost`

`localhost` always means "this network namespace". On the host that is the host; inside a container it is that container. They are different loopback interfaces.

- Container → container: the service name.
- Host → container: `localhost:<published-port>`, which requires `-p`.
- Container → host services: `host.docker.internal` (or the bridge gateway).

## Container IP vs Compose service name

| | IP address | Service name |
| :--- | :--- | :--- |
| Stability | Changes on every recreate | Stable |
| Portability | Machine-specific | Identical everywhere |
| Resolution | None needed | Docker's embedded DNS |
| Use in config | <C color="crimson">Never</C> | <C color="green">Always</C> |

---

## `EXPOSE` vs `ports`

`EXPOSE` is documentation in image metadata; it opens nothing. `ports` (or `-p`) installs a host NAT rule that forwards a host port to a container port. Containers on the same network communicate without either.

---

## `depends_on` vs health/readiness

`depends_on` orders **starts** (and stops). Readiness is whether the service can serve. `condition: service_healthy` bridges them by gating on a health check — and even then, application retries with backoff are required, because dependencies also fail *after* start-up.

---

## Build-time root vs run-time root

Build-time root is normal and usually necessary (installing packages, creating users, setting ownership) and the build environment is discarded. Run-time root is a standing risk: a compromise begins with UID 0, which is host UID 0. Do privileged work first, then `USER`.

---

## Build dependencies vs runtime dependencies

| | Build dependency | Runtime dependency |
| :--- | :--- | :--- |
| Examples | Compilers, `-dev` headers, build tools, test frameworks | Runtime/interpreter, shared libraries, production libraries |
| Needed at run time | No | Yes |
| Belongs in the final image | No | Yes |

## Builder stage vs runtime stage

The builder holds the toolchain and produces artifacts; the runtime stage holds only what is needed to run. They exist simultaneously during the build; only the final stage becomes the image. <H>Only what `COPY --from` names crosses over.</H>

---

## Process memory vs thread-shared memory

Processes have separate address spaces — a cache in one worker is invisible to another. Threads share the process's memory, which is why they need synchronisation. `fork` gives temporary copy-on-write sharing that erodes as pages are written.

---

## Named volume vs container filesystem

| | Named volume | Container filesystem |
| :--- | :--- | :--- |
| Survives `docker rm` | <C color="green">Yes</C> | <C color="crimson">No</C> |
| Shared between containers | Yes | No |
| Performance | Native | Copy-up penalty on existing files |
| Managed by | Docker (`docker volume`) | The container's lifecycle |
| For | Databases, uploads, any state | Ephemeral scratch only |

## Named volume vs bind mount

| | Named volume | Bind mount |
| :--- | :--- | :--- |
| Source | Docker-managed storage | A specific host path |
| Portable | Yes | No |
| Initialised from the image | Yes, when empty | <C color="crimson">Never</C> — it hides image content |
| Ownership | From the image path | From the host |
| Best for | Production state | Development hot reload, injected config |

---

**Next:** [Terminology](./34-terminology.md) — interview-ready definitions for everything named in these notes.
