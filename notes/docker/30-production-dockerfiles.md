---
title: Production Dockerfile Examples
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Production Dockerfile Examples

Annotated templates. The placeholders in angle brackets are deliberate — <H>the shape is the lesson; the tool names are interchangeable.</H> Short concrete examples follow at the end to show the same shape across ecosystems.

---

## 1. The language-neutral skeleton

```dockerfile
# syntax=docker/dockerfile:1

FROM <runtime-image>:<pinned-version>

# Runtime configuration defaults. Overridable at run time; never secrets.
ENV APP_ENV=production \
    LOG_LEVEL=info \
    PORT=8080

WORKDIR /app

# Dependency manifests FIRST: they change less often than source, so the
# expensive install below stays cached across most builds.
COPY <dependency-manifest> <lock-file> ./

# Production dependencies only. Cache mount keeps rebuilds fast without
# leaving a cache directory inside the image.
RUN --mount=type=cache,target=<package-manager-cache-dir> \
    <package-manager> install --production --frozen-lockfile

# Source LAST: a code change invalidates only from here down.
COPY --chown=10001:10001 <application-source> ./

# Unprivileged runtime user. Numeric so orchestrators can verify non-root.
RUN <create group 10001 and user 10001 with no login shell>
USER 10001:10001

EXPOSE 8080

# Exec form → the application is PID 1 → it receives SIGTERM → graceful shutdown.
ENTRYPOINT ["<application-command>"]
CMD ["--port", "8080"]
```

Every decision, justified:

| Line | Why |
| :--- | :--- |
| `# syntax=` | Enables modern Dockerfile features (mounts, heredocs) independently of the Docker version |
| Pinned `FROM` | Reproducibility; `latest` makes builds non-deterministic |
| `ENV` defaults | Runnable out of the box, overridable per environment, no secrets |
| `WORKDIR /app` | Explicit; creates the directory; avoids writing into `/` |
| Manifests before source | The cache boundary that protects the expensive install ([ch. 9](./09-build-cache.md)) |
| `--production` / `--frozen` | No dev dependencies; deterministic tree |
| Cache mount | Fast rebuilds, zero image-size cost ([ch. 11](./11-package-manager-caches.md)) |
| `COPY --chown` | Correct ownership without a layer-duplicating `chown -R` |
| Source last | Cheap late layer; small pushes and pulls |
| Numeric `USER` | Least privilege, verifiable by the platform ([ch. 16](./16-non-root-containers.md)) |
| `EXPOSE` | Documentation for humans and tooling |
| Exec-form `ENTRYPOINT` | The app is PID 1 and gets signals ([ch. 17](./17-pid1-and-signals.md)) |
| `CMD` as arguments | Defaults that a run-time override can replace |

---

## 2. Interpreted / runtime-based application

The runtime needs the dependency tree itself, so it is carried into the final image.

```dockerfile
# syntax=docker/dockerfile:1

# ---------- dependencies ----------
FROM <runtime-image>:<pinned> AS deps
WORKDIR /app
COPY <dependency-manifest> <lock-file> ./
RUN --mount=type=cache,target=<pm-cache-dir> \
    <package-manager> install --production --frozen-lockfile

# ---------- build (only if there is a build step) ----------
FROM <runtime-image>:<pinned> AS build
WORKDIR /app
COPY <dependency-manifest> <lock-file> ./
RUN --mount=type=cache,target=<pm-cache-dir> \
    <package-manager> install --frozen-lockfile        # ALL deps, incl. dev
COPY . .
RUN <build / compile assets / generate code>

# ---------- runtime ----------
FROM <runtime-image>:<pinned>-slim
ENV APP_ENV=production LOG_LEVEL=info PORT=8080
WORKDIR /app

RUN <create user/group 10001 with no login shell>

COPY --from=deps  --chown=10001:10001 /app/<dependency-dir> ./<dependency-dir>
COPY --from=build --chown=10001:10001 /app/<build-output>   ./<build-output>
COPY --chown=10001:10001 <runtime-source-files> ./

USER 10001:10001
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["<health-probe-command>"]

ENTRYPOINT ["<runtime>", "<entry-file>"]
```

Notes specific to this shape:

- **Three stages** separate production dependencies (`deps`) from the full set needed to build (`build`). Only production dependencies reach the final image.
- **The runtime base can be slimmer than the build base** — but it must be the same distro family and libc if any dependency is native ([ch. 12](./12-base-images.md)).
- **If there is no build step**, drop the `build` stage entirely; a single stage may then be perfectly correct. Multi-stage is not mandatory ([ch. 13](./13-multi-stage-builds.md)).

---

## 3. Compiled application

The build produces a self-contained artifact, so nothing from the builder needs to survive.

```dockerfile
# syntax=docker/dockerfile:1

# ---------- builder ----------
FROM <builder-image>:<pinned> AS builder
WORKDIR /src

# Dependency manifests first, again for cache stability.
COPY <dependency-manifest> <lock-file> ./
RUN --mount=type=cache,target=<pm-cache-dir> \
    <fetch dependencies>

COPY . .
RUN --mount=type=cache,target=<build-cache-dir> \
    <compile to a self-contained artifact, statically linked where possible>

# ---------- runtime ----------
FROM <minimal-runtime-image>          # distroless, alpine, or scratch
WORKDIR /app

COPY --from=builder --chown=10001:10001 /src/<artifact> ./<artifact>
# Only if the program needs them and the base lacks them:
# COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
# COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/app/<artifact>"]
```

Notes specific to this shape:

- **The builder can be as large as it likes** — a full toolchain, headers, caches. None of it ships.
- **`scratch` requires a truly static binary**, and gives you nothing else: no CA certificates (TLS fails), no timezone data, no `/etc/passwd`, no shell. Copy in what you actually need.
- **On distroless there is no shell**, so `HEALTHCHECK` must invoke a binary, not `CMD-SHELL`.
- **A UID with no `/etc/passwd` entry** is fine for the kernel; some programs that look up the current user's name will complain, so test it.

---

## 4. Dev / test / prod from one file

```dockerfile
# syntax=docker/dockerfile:1

FROM <base-image>:<pinned> AS base
WORKDIR /app
COPY <dependency-manifest> <lock-file> ./

FROM base AS development
RUN <install ALL dependencies>
COPY . .
ENV LOG_LEVEL=debug
EXPOSE 8080 9229
CMD ["<dev-server-with-hot-reload>"]

FROM base AS test
RUN <install ALL dependencies>
COPY . .
RUN <lint>
RUN <run the test suite>            # a failure fails the build

FROM base AS build
RUN <install ALL dependencies>
COPY . .
RUN <build production artifacts>

FROM <minimal-runtime-image> AS production
ENV APP_ENV=production LOG_LEVEL=info
WORKDIR /app
RUN <create user 10001>
COPY --from=build --chown=10001:10001 /app/<build-output> ./
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["<application-command>"]
```

```bash
docker build --target development -t app:dev  .
docker build --target test        -t app:test .
docker build                      -t app:prod .    # production is last
```

<H>Production last</H>, so a plain `docker build .` cannot ship a development image. Unreferenced stages are never built, and all stages share `base`'s cache.

---

## 5. An entrypoint script, done correctly

```bash
#!/bin/sh
set -eu

# Validate required configuration and fail fast with a readable message.
: "${DATABASE_URL:?DATABASE_URL is required}"

# Optional pre-flight work: render config, fix volume ownership, warm caches.
<render configuration from environment>

# Hand PID 1 to the application so it receives SIGTERM.
exec "$@"
```

```dockerfile
COPY --chmod=0755 entrypoint.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["<application-command>", "--port", "8080"]
```

The two load-bearing details: `exec` replaces the shell so the application becomes PID 1, and `"$@"` forwards the `CMD` arguments. Omit either and you get the ten-second-`docker stop` bug from [chapter 17](./17-pid1-and-signals.md).

---

## 6. The same shape across ecosystems

Short, concrete illustrations that the structure does not change — only the tool names.

**Node.js (interpreted, dependency tree needed at run time):**

```dockerfile
FROM node:20.11-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM node:20.11-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
EXPOSE 8080
CMD ["node", "server.js"]
```

**Python (interpreted, with native dependencies):**

```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefix=/install -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY --from=builder /install /usr/local
COPY --chown=10001:10001 . .
RUN useradd -u 10001 -m -s /usr/sbin/nologin app
USER 10001
EXPOSE 8000
CMD ["<production-wsgi-or-asgi-server>", "app:application", "--bind", "0.0.0.0:8000"]
```

**Go (compiled, static binary):**

```dockerfile
FROM golang:1.22 AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/app ./cmd/app

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/app /app
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app"]
```

**Java (compiled to an artifact, JVM needed at run time):**

```dockerfile
FROM eclipse-temurin:21-jdk AS builder
WORKDIR /src
COPY <build-files> ./
RUN --mount=type=cache,target=/root/.m2 <resolve dependencies>
COPY . .
RUN --mount=type=cache,target=/root/.m2 <package the application>

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder --chown=10001:10001 /src/<target>/app.jar ./app.jar
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
```

The four differ only in tool names and in whether the runtime needs a dependency tree, an interpreter, a VM, or nothing at all. <H>Manifests first, dependencies installed behind a cache boundary, source later, build tools left behind, non-root user, exec-form entrypoint</H> — that shape is Docker, not any language.

(The JVM flag in the last example is a container-specific detail worth knowing: without a percentage-of-RAM setting, older JVMs sized their heap from the *host's* memory and were OOM-killed inside a limited container — the same class of bug as [worker auto-detection](./19-workers-and-concurrency.md).)

---

**Next:** [Debugging & Inspection](./31-debugging.md) — the commands, and what each is actually for.
