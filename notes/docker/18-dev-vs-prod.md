---
title: Development vs Production Containers
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Development vs Production Containers

> **What you will be able to do after this page**
>
> - Name the ten axes on which a dev container should differ from a production one.
> - Set up hot reload with bind mounts, including the dependency-directory trap.
> - Keep the two variants in one Dockerfile without letting dev tooling reach production.
> - Judge how much divergence is acceptable before "works locally" stops meaning anything.

---

## 1. Different jobs, different optimisation targets

```text
   DEVELOPMENT                          PRODUCTION
   ─────────────────────────            ─────────────────────────
   optimise for FEEDBACK SPEED          optimise for RELIABILITY,
   and DEBUGGABILITY                    SECURITY and EFFICIENCY

   code changes visible in ~1s          image is immutable
   full toolchain available             minimal surface
   verbose logging                      structured logging at a sane level
   size irrelevant                      size matters (pull time, storage)
   security relaxed                     hardened
```

Optimising a development image for size, or a production image for editability, both produce something bad at its actual job.

---

## 2. The axes of difference

| Axis | Development | Production |
| :--- | :--- | :--- |
| **Source code** | Bind-mounted from the host | Baked into the image |
| **Reload** | File-watching, hot reload | Immutable; a change means a new image |
| **Dependencies** | All, including dev/test | Production only |
| **Build tools** | Present | Absent (or confined to a builder stage) |
| **Server** | Framework dev server, single process, auto-restart | Production server, multiple workers, tuned |
| **Debugging** | Debugger port, shell, editors, network tools | None; debug via a separate stage or ephemeral container |
| **Logging** | Verbose, human-readable, colour | Structured (JSON), level-controlled, to stdout |
| **Errors** | Stack traces surfaced to the client | Generic message to the client, detail to logs |
| **User** | Often root for convenience | Non-root, read-only root filesystem where possible |
| **Base image** | Full-featured | Slim/distroless |
| **Image size** | Irrelevant | Minimised, within reason |
| **Configuration** | `.env` files, local defaults | Injected by the platform; secrets from a secret store |
| **Restart** | Manual | `restart: unless-stopped` / orchestrator-managed |

Two of these deserve an explicit warning because they are security-relevant and easy to leave switched on:

- <C color="crimson">Framework debug modes</C> often expose an interactive console or arbitrary code execution on error pages. Shipping one to production is a critical vulnerability, not a cosmetic mistake.
- <C color="crimson">Development servers</C> are single-process, unhardened and explicitly documented as unsuitable for production by their own authors.

---

## 3. Hot reload with bind mounts

The mechanism: mount the host source directory over the image's source directory, so edits on the host are immediately visible inside the container, and let a file watcher restart the process.

```yaml
services:
  api:
    build:
      context: .
      target: development          # the dev stage of a multi-stage Dockerfile
    volumes:
      - .:/app                     # host source over the image's /app
      - /app/<dependency-dir>      # ← anonymous volume: THE IMPORTANT LINE
    environment:
      LOG_LEVEL: debug
    ports:
      - "8080:8080"
      - "9229:9229"                # debugger
    command: <dev-server-with-watch>
```

### The dependency-directory trap

`- .:/app` replaces the container's `/app` **entirely** with the host directory. The dependency tree the image installed at `/app/<dependency-dir>` disappears behind the mount — and if the host has its own copy, it may be built for the wrong OS or architecture.

```text
   image:  /app/<dependency-dir>   installed for linux, correct
   host:   ./<dependency-dir>      absent, or built for macOS
   after mounting . over /app:     the container sees the HOST version ❌
```

The fix is the second volume line: mounting an anonymous volume at `/app/<dependency-dir>` <H>masks that subdirectory back out of the bind mount</H>, so the image's own installed dependencies remain visible. The general solutions:

1. Anonymous or named volume over the dependency directory (shown above).
2. Install dependencies **outside** the mounted path in the image and point the runtime at that location.
3. Mount only source subdirectories (`./src:/app/src`) rather than the whole project.

### Other bind-mount realities

- **File-watching across the boundary** can be unreliable on macOS and Windows, where the mount crosses a VM. Polling mode is the usual workaround, at a CPU cost.
- **Performance** on those platforms is noticeably worse than native; Docker Desktop's newer file-sharing implementations help but do not eliminate it.
- **Ownership** — files created inside the container land on the host with the container user's UID, which can produce root-owned files in your working tree.

---

## 4. One Dockerfile, both targets

```dockerfile
# syntax=docker/dockerfile:1

FROM <base-image> AS base
WORKDIR /app
COPY <dependency-manifest> <lock-file> ./

# ---------- development ----------
FROM base AS development
RUN <install ALL dependencies, including dev>
COPY . .
ENV LOG_LEVEL=debug
EXPOSE 8080 9229
CMD ["<dev-server-with-hot-reload>"]

# ---------- build ----------
FROM base AS build
RUN <install ALL dependencies>
COPY . .
RUN <run tests>
RUN <build production artifacts>

# ---------- production ----------
FROM <minimal-runtime-image> AS production
WORKDIR /app
ENV LOG_LEVEL=info APP_ENV=production
COPY --from=build --chown=10001:10001 /app/<build-output> ./
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["<application-binary>"]
```

```bash
docker build --target development -t app:dev .
docker build -t app:prod .          # last stage = production
```

Why this works well:

- The shared `base` stage means dependency resolution is cached once for both.
- Unreferenced stages are never built, so a dev build does not compile the production image.
- <H>Production is the last stage, so a plain `docker build .` cannot accidentally ship the dev image.</H>
- Development tooling is structurally unable to reach production — it exists only in a stage that production never copies from.

---

## 5. How much divergence is acceptable?

The tension: the more the dev container differs, the less "it works locally" tells you.

**Keep identical:**

- The base image family and the runtime version. A version difference between dev and prod reintroduces exactly the problem containers were adopted to solve.
- The dependency versions (same lock file).
- The service topology — same database engine and version, same cache, same message broker, reached by the same service names.
- The configuration *mechanism* (environment variables and file paths), even when the values differ.

**Accept differing:**

- Source delivery (mounted vs baked).
- The server process and worker count.
- Logging verbosity and format.
- Presence of debug tooling.
- Image size and hardening.

**Where the real bugs hide** — the differences that produce "works locally, breaks in production":

```text
  · dev runs one process; production runs N workers  → shared-state bugs appear only in prod
  · dev has no resource limits                       → OOM kills only in prod
  · dev is root                                      → permission errors only in prod
  · dev has a writable filesystem                    → read-only rootfs failures only in prod
  · dev talks to localhost services                  → service-discovery bugs only in prod
  · dev has no TLS or proxy in front                 → header/redirect bugs only in prod
```

A worthwhile habit: run the **production image** locally from time to time, with production-like limits and a read-only filesystem. It surfaces this entire class of problem before a deploy does.

---

## Rapid-fire recall

1. What is a development image optimised for, and a production one?
2. Why is a framework's debug mode a security issue, not a cosmetic one?
3. Explain the dependency-directory trap with bind mounts, and two fixes.
4. Why does `- /app/<dependency-dir>` in Compose fix it?
5. How does one Dockerfile serve both targets without dev tooling reaching production?
6. Why should the production stage be last in the file?
7. Name three things that must stay identical between dev and prod.
8. Name three differences that commonly cause "works locally, fails in production".
9. What is the cheapest way to catch those before deploying?

<details>
<summary>Answers</summary>

1. Development: feedback speed and debuggability. Production: reliability, security and efficiency.
2. Debug modes commonly expose interactive consoles or code execution on error pages, and leak stack traces and configuration to clients.
3. Mounting the host directory over `/app` hides the image's installed dependency tree and may substitute a host copy built for the wrong platform. Fix by masking the directory with an anonymous/named volume, or by installing dependencies outside the mounted path.
4. It mounts a separate volume at that path, which takes precedence over the bind mount, so the image's own dependency tree stays visible.
5. Multi-stage with `--target`: dev tooling lives only in the development stage, and the production stage copies only build artifacts.
6. So a plain `docker build .` produces production and cannot accidentally ship a development image.
7. Runtime version and base family, dependency versions (same lock file), and service topology/configuration mechanism.
8. Any three: single process vs multiple workers, no resource limits, running as root, writable vs read-only filesystem, localhost vs service discovery, no TLS/proxy in front.
9. Periodically run the production image locally with production-like resource limits, a non-root user and a read-only root filesystem.

</details>

---

**Next:** [Workers, Processes & Concurrency](./19-workers-and-concurrency.md) — why four workers use four times the memory, and how container limits interact.
