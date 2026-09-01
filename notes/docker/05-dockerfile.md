---
title: The Dockerfile
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# The Dockerfile

> **What you will be able to do after this page**
>
> - Classify every instruction as build-time or runtime, and layer-producing or metadata-only.
> - Use `ENTRYPOINT` and `CMD` together deliberately instead of by superstition.
> - Explain exec form vs shell form, and why the shell form breaks `docker stop`.
> - Know the traps in `COPY` vs `ADD`, `ENV` vs `ARG`, and `WORKDIR` vs `RUN cd`.

---

## 1. What a Dockerfile is

> **A Dockerfile is a declarative recipe describing how to construct an image: a sequence of instructions, each contributing either filesystem content or image metadata.**

It is *not* a shell script, even though it contains shell commands. Three differences matter:

1. **Each `RUN` is its own process, in its own step.** `RUN cd /app` followed by `RUN ls` lists the wrong directory — the `cd` died with its shell.
2. **The result of each step is cached and content-addressed**, so ordering has performance consequences a script would not have.
3. **It is declarative about the end state**, not about a procedure. Under BuildKit it is compiled into a dependency graph, not executed as a script.

### Parsing, briefly

```dockerfile
# syntax=docker/dockerfile:1          ← parser directive: MUST be the first line
# This is a comment
ARG BASE_TAG=20-bookworm              ← the only instruction allowed before FROM

FROM node:${BASE_TAG}                 ← every stage starts here
```

- Instruction keywords are case-insensitive; `UPPERCASE` is universal convention.
- Continuation is `\` at end of line.
- The `# syntax=` directive pins the Dockerfile frontend version, which is how you get newer syntax (`RUN --mount`, heredocs) without upgrading Docker itself. <H>It only works as the very first line.</H>
- `ARG` before `FROM` is a special case and is only visible to `FROM` lines, not inside stages, unless re-declared.

---

## 2. The instruction map

| Instruction | Phase | Effect | Creates a filesystem layer |
| :--- | :--- | :--- | :--- |
| `FROM` | Build | Starts a stage from a parent image | Inherits parent's layers |
| `ARG` | Build | Build-time variable | No |
| `RUN` | Build | Executes a command in an intermediate container | <C color="green">Yes</C> |
| `COPY` | Build | Copies from context or another stage | <C color="green">Yes</C> |
| `ADD` | Build | `COPY` + URL fetch + auto-extract | <C color="green">Yes</C> |
| `WORKDIR` | Build+Run | Sets cwd for later instructions and for the container | Metadata (may create the dir) |
| `ENV` | Build+Run | Environment variable, persisted into the image | Metadata |
| `USER` | Build+Run | User for later `RUN`s and for the container | Metadata |
| `EXPOSE` | Documentation | Declares intended ports | Metadata |
| `LABEL` | Metadata | Key/value image metadata | Metadata |
| `VOLUME` | Runtime | Declares a path as a volume mount point | Metadata |
| `CMD` | Runtime | Default command / default arguments | Metadata |
| `ENTRYPOINT` | Runtime | The executable the container runs | Metadata |
| `HEALTHCHECK` | Runtime | How the runtime probes health | Metadata |
| `STOPSIGNAL` | Runtime | Signal used to stop the container | Metadata |
| `SHELL` | Build | Changes the shell used by shell-form `RUN`/`CMD` | Metadata |
| `ONBUILD` | Deferred | Triggers when this image is used as a parent | Metadata |

The build-time/runtime split is the one to internalise: <H>build-time instructions run once, when the image is created; runtime instructions never execute during a build — they only record defaults.</H> Nothing in a Dockerfile "runs the app". `CMD` merely says what *would* run.

---

## 3. `FROM`

```dockerfile
FROM <image>[:<tag>|@<digest>] [AS <stage-name>]
```

Sets the starting filesystem and inherits the parent's configuration (`ENV`, `WORKDIR`, `USER`, `ENTRYPOINT`, `CMD` — all of it, which is a frequent surprise: your image may already have an `ENTRYPOINT` you did not write).

Roles `FROM` plays:

- **Runtime base** — contains what the app needs to *run*.
- **Builder base** — contains compilers, headers and build tooling, and is discarded in multi-stage builds.
- **`FROM scratch`** — an empty filesystem; only viable for fully static binaries.

Multiple `FROM` lines start multiple stages, which is the mechanism behind [multi-stage builds](./13-multi-stage-builds.md).

**Choosing one is a trade-off**, treated fully in [Base Image Selection](./12-base-images.md). The short version: pin specifically (`node:20.11.1-bookworm-slim`, not `node:latest`), and prefer digest-pinning where reproducibility matters.

---

## 4. `WORKDIR`

```dockerfile
WORKDIR /app
```

Sets the working directory for every subsequent `RUN`, `CMD`, `ENTRYPOINT`, `COPY` and `ADD` *in that stage*, and the container's starting directory at run time. It <C color="orange">creates the directory if it does not exist</C>.

```dockerfile
# ✅ correct
WORKDIR /app
RUN ./build.sh

# ❌ broken: each RUN is a separate process; the cd does not persist
RUN cd /app
RUN ./build.sh
```

Notes:

- Always use **absolute paths**. Relative `WORKDIR` is resolved against the previous one and is only ever confusing.
- Directories created by `WORKDIR` are owned by root. If you later `USER app`, the app may not be able to write there — set ownership explicitly. See [Non-Root Containers](./16-non-root-containers.md).
- It is the correct way to avoid writing your app into `/`.

---

## 5. `COPY`

```dockerfile
COPY [--chown=user:group] [--from=<stage>] [--chmod=<mode>] <src>... <dest>
```

Copies from the [build context](./07-build-context.md) (or from another stage / image with `--from`) into the image.

Rules worth knowing before they bite:

- Sources are **relative to the build context root**, and <H>cannot escape it</H> — `COPY ../secrets .` is an error by design.
- If `<dest>` ends in `/` it is treated as a directory. With multiple sources, it must be a directory.
- `COPY dir/ /target/` copies the *contents* of `dir`, not the directory itself.
- Wildcards use Go's `filepath.Match`, which is not full shell globbing.
- Files keep their permissions; ownership defaults to `root:root` unless `--chown` is given.
- `--from=builder` pulls from a previous stage; `--from=nginx:alpine` even pulls from an arbitrary image.

### `COPY` and the cache

The cache key for a `COPY` is computed from <H>the contents and metadata of the files actually being copied</H>. Change one byte in one copied file and this step — and every step after it — is rebuilt.

```dockerfile
COPY . .          # cache key covers EVERYTHING in the context (post-.dockerignore)
```

That is why a broad `COPY . .` placed early is a cache disaster: editing `README.md` invalidates your dependency installation. It is *not* that `COPY . .` is inherently wrong — as the last content step in a stage it is completely normal and fine. Details in [Build Cache](./09-build-cache.md).

### `COPY` vs `ADD`

| | `COPY` | `ADD` |
| :--- | :--- | :--- |
| Local files | Yes | Yes |
| Remote URLs | No | Yes |
| Auto-extracts local tar archives | No | <C color="crimson">Yes — silently</C> |
| Git repositories (BuildKit) | No | Yes |
| Predictable | Yes | Less so |

<H>Default to `COPY`.</H> `ADD`'s auto-extraction is implicit behaviour that surprises people (`ADD archive.tar /x` extracts; `COPY` would have copied the file). Use `ADD` deliberately for its extra features — `ADD --checksum=sha256:… <url>` is genuinely good — never by habit.

---

## 6. `RUN`

```dockerfile
RUN <command>                        # shell form: /bin/sh -c "<command>"
RUN ["executable", "arg1", "arg2"]   # exec form: no shell involved
```

Executes at **build time** in a temporary container on top of the current layer; the resulting filesystem diff becomes a layer. Used for installing dependencies, compiling, generating assets, creating users, and cleanup.

Key behaviours:

- Shell form gets shell features (pipes, `&&`, variable expansion); exec form does not — `RUN ["echo", "$HOME"]` prints the literal `$HOME`.
- Commands are cached by their *string*, not their effect. `RUN <package-manager> update` will be reused from cache for weeks, silently pinning you to stale package indexes. This is why update-and-install belong in one instruction.
- A non-zero exit fails the build. Note that in a shell-form pipeline, only the *last* command's status counts unless you set `SHELL ["/bin/sh", "-eo", "pipefail", "-c"]`.

Chaining is a size decision, not a style one:

```dockerfile
# One layer; the cleanup actually reduces the image
RUN <package-manager> update \
 && <package-manager> install -y --no-install-recommends <packages> \
 && <clean package cache> \
 && rm -rf <package-manager metadata>
```

Why splitting these into separate `RUN`s does not work is the whole point of [Layers](./04-image-layers.md#4-deletion-whiteouts-and-the-size-trap).

BuildKit adds mounts that make `RUN` far more capable — cache mounts, secret mounts, bind mounts — covered in [Package Manager Caches](./11-package-manager-caches.md) and [Secrets](./15-secrets.md).

---

## 7. `ENV` (and `ARG`)

```dockerfile
ENV LOG_LEVEL=info \
    PATH=/opt/app/bin:$PATH
```

`ENV` sets an environment variable that is <H>baked into the image config and present in every container started from it</H>, plus in all subsequent build steps.

Legitimate uses: making a runtime discoverable (`PATH`), setting language-runtime behaviour (unbuffered output, disabling bytecode writing), and providing *defaults* for configuration that operators can override.

### `ENV` vs `ARG`

| | `ARG` | `ENV` |
| :--- | :--- | :--- |
| Available during build | Yes | Yes |
| Present in the final image | <C color="green">No</C> | <C color="crimson">Yes</C> |
| Set from CLI | `--build-arg K=V` | `-e K=V` at run time |
| Visible in image config / `docker inspect` | No | Yes |

```dockerfile
ARG APP_VERSION=dev        # build-time only
ENV APP_VERSION=$APP_VERSION   # …unless you deliberately promote it
```

### Why secrets do not belong in `ENV`

Three independent reasons:

1. `docker inspect` on the image prints every `ENV` value — no container needed.
2. `ENV` is inherited by every child image built `FROM` yours.
3. Environment variables leak: into child processes, crash dumps, log lines and error-reporting payloads.

And `--build-arg` is not the fix either: build args appear in build history and in the image metadata of many setups. The real mechanisms are in [Secrets](./15-secrets.md).

---

## 8. `USER`

```dockerfile
RUN <create a non-root user and group>
USER 10001:10001
```

Sets the user for subsequent `RUN` instructions *and* for the container's process. Default is `root` (UID 0).

The split that matters:

```text
  BUILD-TIME root     usually fine and often necessary: installing packages,
                      creating users, chowning files
  RUNTIME root        rarely necessary and a real risk: a compromise starts
                      with UID 0, and with a bind mount or a kernel bug that
                      reaches the host
```

So the canonical shape is: do privileged work first, then drop:

```dockerfile
RUN <install packages>            # as root
COPY --chown=10001:10001 . /app   # ownership set at copy time
USER 10001                        # everything after this — including CMD — is unprivileged
```

Prefer a numeric UID: orchestrators can enforce `runAsNonRoot` only when they can tell the UID is not 0, and a name requires resolving `/etc/passwd`, which may not exist in a minimal image. Full treatment: [Non-Root Containers](./16-non-root-containers.md).

---

## 9. `EXPOSE`

```dockerfile
EXPOSE 8080
```

<H>`EXPOSE` publishes nothing. It opens no port. It changes no networking.</H> It is metadata: documentation of the port the image intends to serve on, readable via `docker inspect`, and usable by `docker run -P` (capital P) to auto-publish to random host ports.

```text
  EXPOSE 8080                 → "this image serves on 8080"      (declaration)
  docker run -p 3000:8080     → host:3000 → container:8080       (actual publishing)
```

Containers on the same Docker network can reach each other on *any* port regardless of `EXPOSE`. Omitting `EXPOSE` blocks nothing; including it grants nothing. Keep it because it documents intent and some tooling (including Compose and orchestrators) reads it.

---

## 10. `CMD`

```dockerfile
CMD ["node", "server.js"]        # exec form  ✅
CMD node server.js               # shell form → /bin/sh -c "node server.js"
CMD ["--verbose"]                # arguments-only form, when ENTRYPOINT is set
```

The **default command**, run when the container starts and nothing was specified on the command line. It is <C color="orange">completely overridden</C> by `docker run myimage <anything>`.

`RUN` vs `CMD` — the classic confusion:

| | `RUN` | `CMD` |
| :--- | :--- | :--- |
| When | Build time | Container start |
| How often | Once per build | Every container start |
| Produces | A layer | Nothing; it is metadata |
| Multiple allowed | Yes, all execute | Yes, but <H>only the last one has any effect</H> |

---

## 11. `ENTRYPOINT`

```dockerfile
ENTRYPOINT ["/usr/local/bin/app"]
CMD ["--port", "8080"]
```

`ENTRYPOINT` declares the executable the container *is*. `CMD` supplies its default arguments.

### How they combine

| `ENTRYPOINT` | `CMD` | `docker run img` executes | `docker run img --debug` executes |
| :--- | :--- | :--- | :--- |
| — | `["app","--port","80"]` | `app --port 80` | `--debug` (<C color="crimson">CMD replaced entirely</C>) |
| `["app"]` | `["--port","80"]` | `app --port 80` | `app --debug` |
| `["app"]` | — | `app` | `app --debug` |

The rule: <H>with exec-form `ENTRYPOINT`, run-time arguments are appended to it and replace `CMD`; without an `ENTRYPOINT`, they replace the command outright.</H>

Practical guidance:

- **Fixed-purpose service images:** `ENTRYPOINT` = the binary, `CMD` = default flags. `docker run img --help` then does the obvious thing.
- **Toolbox / general images:** `CMD` only, so users can run whatever they need.
- **Need a shell for debugging an `ENTRYPOINT` image?** `docker run --entrypoint /bin/sh -it img`.
- **`ENTRYPOINT` scripts** are the standard place for pre-flight work (waiting on dependencies, rendering config, fixing permissions). End them with `exec "$@"` so the real application <C color="orange">replaces the script as PID 1</C> and receives signals. Missing that `exec` is one of the most common production bugs in containers — see [PID 1 & Signals](./17-pid1-and-signals.md).

### Exec form vs shell form — the reason it matters

```dockerfile
CMD ["node", "server.js"]   # PID 1 = node          → receives SIGTERM ✅
CMD node server.js          # PID 1 = /bin/sh       → sh ignores SIGTERM, app never
                            #                         shuts down gracefully ❌
```

The shell form wraps your process in `/bin/sh -c`. That shell becomes PID 1, and it does not forward signals to its child by default. `docker stop` then waits the full grace period and `SIGKILL`s everything — no clean shutdown, no draining connections, no flushing writes. <H>Always use exec form for `CMD` and `ENTRYPOINT` unless you specifically need shell features</H> (and if you do, prefix with `exec`: `CMD ["sh","-c","exec node server.js"]`).

---

## 12. The remaining instructions

**`LABEL`** — image metadata. Standardise on OCI keys; they show up in registries and tooling.

```dockerfile
LABEL org.opencontainers.image.source="https://github.com/org/repo" \
      org.opencontainers.image.revision="$GIT_SHA"
```

**`HEALTHCHECK`** — a command the runtime executes periodically to decide `healthy`/`unhealthy`.

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD <probe the app's health endpoint> || exit 1
```

Note `--start-period`: without it, slow-starting applications are marked unhealthy and restarted in a loop. Kubernetes ignores Dockerfile healthchecks entirely and uses its own probes. See [Health Checks](./24-compose-depends-on-and-health.md).

**`STOPSIGNAL`** — which signal `docker stop` sends. Default `SIGTERM`; some runtimes want something else.

**`VOLUME /data`** — marks a path as a mount point; if nothing is mounted there, Docker creates an anonymous volume. Use it sparingly: it silently creates unnamed volumes that accumulate, and it makes later `RUN`s writing to that path behave surprisingly. Prefer declaring volumes in Compose or at `docker run`.

**`SHELL`** — changes the interpreter for shell-form instructions. Two real uses: enabling `pipefail`, and Windows containers (`SHELL ["powershell", "-command"]`).

**`ONBUILD`** — defers an instruction until *another* image builds `FROM` yours. Powerful and confusing; largely superseded by multi-stage builds and better base images.

---

## 13. A complete annotated Dockerfile

```dockerfile
# syntax=docker/dockerfile:1
ARG RUNTIME_TAG=1.2.3-slim

# ---------- build stage ----------
FROM <builder-image>:${RUNTIME_TAG} AS builder
WORKDIR /src

# Dependency manifests first: they change far less often than source code,
# so this expensive step stays cached across most builds.
COPY <dependency-manifest> <lock-file> ./
RUN <package-manager> install --frozen-lockfile

# Source last: a code change invalidates only from here down.
COPY . .
RUN <build / compile / bundle>

# ---------- runtime stage ----------
FROM <runtime-image>:${RUNTIME_TAG}

ENV APP_ENV=production \
    LOG_LEVEL=info

WORKDIR /app

# Only the artifacts. No compilers, no build caches, no source tree.
COPY --from=builder --chown=10001:10001 /src/<build-output> ./

USER 10001:10001
EXPOSE 8080

# Exec form → the app is PID 1 → it receives SIGTERM → graceful shutdown.
ENTRYPOINT ["<application-binary>"]
CMD ["--port", "8080"]
```

Every line here is a decision, and each is justified in a later page: stage split ([13](./13-multi-stage-builds.md)), manifest-before-source ([9](./09-build-cache.md)), non-root ([16](./16-non-root-containers.md)), exec form ([17](./17-pid1-and-signals.md)), config via env ([14](./14-runtime-configuration.md)).

---

## Rapid-fire recall

1. Why does `RUN cd /app` not affect the next instruction?
2. Which instructions create filesystem layers?
3. What does `EXPOSE 8080` actually do to networking?
4. `ENTRYPOINT ["app"]`, `CMD ["--a"]`. What runs for `docker run img --b`?
5. No `ENTRYPOINT`, `CMD ["app","--a"]`. What runs for `docker run img --b`?
6. Why does the shell form of `CMD` break graceful shutdown?
7. Give two reasons a secret in `ENV` is exposed even if the container never prints it.
8. Difference between `ARG` and `ENV` in the final image?
9. When is `ADD` the right choice over `COPY`?
10. What does `exec "$@"` at the end of an entrypoint script accomplish?
11. Why prefer a numeric UID in `USER`?
12. What problem does `HEALTHCHECK --start-period` solve?

<details>
<summary>Answers</summary>

1. Each `RUN` executes in its own shell/process; the working-directory change dies with it. Use `WORKDIR`.
2. `RUN`, `COPY`, `ADD`. Everything else is metadata.
3. Nothing. It is documentation, readable via `inspect` and used by `docker run -P`. Publishing is `-p` / Compose `ports`.
4. `app --b` — run-time args replace `CMD` and are appended to `ENTRYPOINT`.
5. `--b` — with no `ENTRYPOINT`, the arguments replace the command entirely, and it will fail.
6. `/bin/sh -c` becomes PID 1 and does not forward `SIGTERM` to the app, so `docker stop` ends in `SIGKILL`.
7. `docker inspect` on the *image* shows all `ENV` values, and every image built `FROM` yours inherits them; environment also propagates to child processes and crash reports.
8. `ARG` exists only during the build and is not part of the runtime environment; `ENV` is persisted in the image config and present in every container.
9. When you want its extra features deliberately: fetching a remote URL with `--checksum`, or auto-extracting a local tar archive.
10. It replaces the shell process with the application, so the app becomes PID 1 and receives signals, and forwards the original arguments.
11. Orchestrators can verify `runAsNonRoot` from a numeric UID, and minimal images may have no `/etc/passwd` to resolve a name.
12. It gives slow-starting apps a grace window in which failing probes do not count, preventing restart loops.

</details>

---

**Next:** [Docker Build](./06-docker-build.md) — what `docker build .` really does, argument by argument.
