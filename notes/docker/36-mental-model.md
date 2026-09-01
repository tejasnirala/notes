---
title: The Production Mental Model
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# The Production Mental Model

Everything in these notes, connected.

---

## 1. The map

```text
                              DOCKER
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
           BUILD                                 RUNTIME
              │                                     │
        Dockerfile                              Container
              │                                     │
        Build context                            Process
              │                                     │
         Build cache                     Filesystem / Network
              │                                     │
           Layers                                Volumes
              │
            Image
              │
          Registry ──────────────────────────────► pulled by the runtime
```

The left branch happens once, in CI. The right branch happens on every container start, everywhere. <H>Most Docker mistakes are a value from one branch frozen into the other</H> — an environment-specific setting baked at build time, or an expectation that a run-time mount is visible during a build.

---

## 2. The full flow, end to end

```text
   Application source code
           ↓
   .dockerignore                 filters what leaves your machine
           ↓
   Build context                 the file set the builder may read
           ↓
   Dockerfile                    the recipe: instructions in rate-of-change order
           ↓
   BuildKit                      compiles it to a DAG and solves it
           ↓
   Cache keys                    per step: instruction + parent + consumed inputs
           ↓
   Build cache                   hit → reuse; miss → execute, and cascade downstream
           ↓
   Image layers                  immutable diffs, content-addressed, shared
           ↓
   Docker image                  layers + config metadata, identified by digest
           ↓
   Registry                      deduplicated blobs; the artifact's home
           ↓
   Container runtime             containerd + shim + runc
           ↓
   Container                     namespaces + cgroups + union filesystem
           ↓
   Writable container layer      ephemeral; dies with the container
           ↓
   Application process           PID 1; handles SIGTERM; shuts down gracefully
           ↓
   Network / ports / environment service names, published ports, injected config
           ↓
   Volumes                       the only thing that survives
```

And for a multi-container application:

```text
   Docker Compose
         │
         ├── Application container    built once, configured at run time
         ├── Database container       named volume, health check, no published ports
         ├── Cache container          internal network only
         ├── Network                  user-defined bridge, DNS by service name
         └── Persistent volumes       survive `down`, destroyed by `down -v`
```

---

## 3. Reading the flow backwards

Diagnosis usually runs the other way. Given a symptom, walk up the chain:

| Symptom | Walk up to |
| :--- | :--- |
| Data lost | Volumes — was one mounted at all? |
| Cannot reach the service | Network — `localhost`, bind address, service name, published port |
| Container will not stay up | The application process and PID 1 — exit code first |
| Config wrong in one environment | Runtime configuration — was it baked in? |
| Image far too big | Layers — `docker image history`, largest first |
| Build slow | Cache keys and context — first non-`CACHED` step |
| A secret got out | Layers and image config — and rotate it |
| Works locally, fails in production | The dev/prod differences: workers, limits, user, read-only rootfs |

---

## 4. Production engineering principles

**Build**

1. Keep build contexts small.
2. Use `.dockerignore` — for speed, safety, and cache stability.
3. Design instruction order around cache stability.
4. Put rarely changing, expensive operations earlier.
5. Put frequently changing source code later.
6. Keep build-time dependencies out of runtime images when practical.
7. Use multi-stage builds when they provide a real benefit — not by default.
8. Avoid shipping package-manager caches; prefer cache mounts.
9. Clean temporary files and package metadata in the same instruction where cleanup is the only option.
10. Choose base images on compatibility and operational requirements, not size alone.
11. Pin versions where determinism matters, and automate the bumps.

**Run**

12. Run applications as non-root, with dropped capabilities and a read-only root filesystem where possible.
13. Keep secrets out of images; inject them at run time, and prefer short-lived credentials.
14. Inject environment-specific configuration at run time — one image per version, not per environment.
15. Treat containers as ephemeral.
16. Externalise persistent state.
17. Understand container networking: `localhost` is the container, service names are stable, `EXPOSE` publishes nothing.
18. Use service discovery, never hardcoded container IPs.
19. Understand start-up ordering versus readiness — and implement retries with backoff and jitter regardless.
20. Understand your process and worker model, and size it from the container's limits.
21. Set explicit CPU and memory limits.
22. Make the application PID 1 and handle `SIGTERM`.

**Judgement**

23. Optimise based on measurable bottlenecks, not intuition.
24. Prefer the smallest *practical* image rather than the smallest possible one.
25. Favour reproducibility and maintainability alongside size.
26. Build once, test that artifact, promote the same digest.

---

## 5. What this should feel like

Not <C color="crimson">"a list of Docker commands I need to memorise"</C>, but:

> <H>A complete mental model of how Docker builds, stores, distributes and runs applications — and how Compose connects several containers into one system.</H>

The test of it: given a new symptom you have never seen, you know which stage of the flow to look at, and why.

---

## 6. Where to go next

- **Orchestration** — Kubernetes or a managed container platform, when a single host stops being enough. Every concept here transfers; only the layer that maintains desired state changes.
- **Supply chain security** — image signing, SBOMs, provenance attestations, continuous scanning.
- **Reproducible builds** — digest pinning, deterministic timestamps, and build attestation.
- **Runtime security** — seccomp and AppArmor profiles, user namespaces, rootless Docker, and stronger sandboxes such as gVisor or Kata.
- **Observability** — structured logs to stdout, metrics, tracing, and health checks that reflect real readiness.

---

## Rapid-fire recall — the whole curriculum

1. Name the four jobs Docker does.
2. What three kernel mechanisms make a container?
3. What is in an image that is not a file?
4. Why does deleting a file in a later layer not shrink an image?
5. What is the build context, and what are the three things it is not?
6. What are the inputs to a `COPY` cache key? To a `RUN` cache key?
7. Why do dependency manifests get copied before source?
8. What is the difference between a package-manager cache and the Docker build cache?
9. When is a multi-stage build unnecessary?
10. Why is a smaller base image not automatically better?
11. Why is `ENV` the wrong place for a secret — give two mechanisms.
12. Why must the application be PID 1?
13. What does `localhost` mean inside a container?
14. What does `EXPOSE` do?
15. What does `depends_on` guarantee?
16. What survives `docker rm`? What survives `docker compose down -v`?
17. Why do four workers use roughly four times the memory?
18. Why must configuration be injected at run time?
19. State the image-optimisation principle in one line.
20. Trace the full flow from source code to a running process.

<details>
<summary>Answers</summary>

1. Packaging (image format), building, distribution (registries), and running (runtime).
2. Namespaces (what it sees), cgroups (what it consumes), and a union filesystem (its root) — plus capabilities/seccomp for what it may do.
3. The config metadata: `CMD`, `ENTRYPOINT`, `ENV`, `USER`, `WORKDIR`, `EXPOSE`, labels, architecture.
4. Layers are immutable; the deletion writes a whiteout that hides the path while the bytes remain below — the image grows slightly.
5. The file tree available to the builder. It is not the image, not the container filesystem, and presence in it does not put a file in the image.
6. `COPY`: parent digest, destination and flags, and the content digests of the named files. `RUN`: parent digest and the literal command string (plus referenced args and mounts) — never its effect.
7. So the expensive install's cache key depends only on dependency inputs, keeping it cached across source changes; lock files also make it deterministic.
8. The Docker cache stores build-step results on the builder and never ships; the package-manager cache is written into the image filesystem and adds size.
9. When the final image would contain nothing it does not use at run time — a small interpreted app with a clean production-only install, for instance.
10. Compatibility (libc, native dependencies), debuggability, patch cadence, build time, layer sharing and maintenance can all outweigh megabytes.
11. `docker inspect` exposes image `ENV` without running anything, and child images inherit it. Use `RUN --mount=type=secret` at build time and mounted secret files or a secret manager at run time.
12. So it receives `SIGTERM` from `docker stop` and can shut down gracefully; the kernel gives PID 1 no default signal handling, and a shell wrapper does not forward signals.
13. The container's own loopback interface — never the host, never another container.
14. Nothing to networking; it is metadata documenting the intended port, usable by `docker run -P`.
15. Start ordering and stop ordering only — unless you use `condition: service_healthy` or `service_completed_successfully`.
16. Named volumes survive `docker rm`; `docker compose down -v` destroys them.
17. Separate processes have separate address spaces; only `fork`-time copy-on-write pages are shared, and that erodes as pages are written.
18. So one tested image can be promoted through every environment; baking it in means the artifact you tested is not the one you shipped.
19. Optimise for the smallest practical image, not the smallest possible image.
20. source → `.dockerignore` → build context → Dockerfile → BuildKit → cache keys → build cache → layers → image → registry → runtime → container → writable layer → application process → network/ports/env → volumes.

</details>

---

**Back to:** [the index](./index.md).
