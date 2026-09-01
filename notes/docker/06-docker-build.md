---
title: Docker Build
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Docker Build

> **What you will be able to do after this page**
>
> - Explain every token of `docker build .`, especially the `.`.
> - Describe the build as BuildKit really performs it: a graph, not a script.
> - Read build output — `CACHED`, `transferring context`, step timings — as diagnostic data.
> - Use `--target`, `--platform`, `--build-arg` and cache flags with intent.

---

## 1. Anatomy of the command

```bash
docker build .
│      │     │
│      │     └── BUILD CONTEXT: the directory sent to the builder. NOT "build here".
│      └──────── the subcommand
└─────────────── the CLI: packages the request and streams it to the engine
```

<H>The `.` is not "build the current directory". It is "the context is the current directory".</H> It answers one question: *which files may `COPY` and `ADD` read from?* The Dockerfile is a separate input — it defaults to `./Dockerfile` inside that context, but `-f` decouples the two entirely.

A realistic invocation:

```bash
docker build \
  -f docker/Dockerfile \          # which Dockerfile (path is NOT relative to context)
  -t registry.example.com/team/api:1.4.2 \   # name:tag for the result
  -t registry.example.com/team/api:latest \  # tags are cheap; add as many as useful
  --target runtime \              # stop at this stage (multi-stage)
  --build-arg APP_VERSION=1.4.2 \ # value for an ARG
  --platform linux/amd64 \        # target architecture
  --no-cache=false \              # (default) use the cache
  --progress=plain \              # full, non-collapsing output — use when debugging
  .                               # the context, always last
```

| Flag | Purpose | Gotcha |
| :--- | :--- | :--- |
| `-t` / `--tag` | Name the result | Without it the image is untagged (`<none>`) and easy to lose |
| `-f` / `--file` | Choose the Dockerfile | It may live outside the context |
| `--target` | Build only up to a named stage | Cheap dev/prod split from one file |
| `--build-arg` | Supply an `ARG` | <C color="crimson">Not for secrets</C> — leaks into history |
| `--no-cache` | Ignore all cache | Debugging tool, not a habit |
| `--pull` | Re-resolve the parent image | Your `FROM` tag may be stale locally |
| `--platform` | Target architecture | Emulated cross-builds can be very slow |
| `--progress=plain` | Full log output | Essential for seeing why a step ran |
| `--secret`, `--ssh` | BuildKit secret/agent mounts | The correct way to use credentials |

---

## 2. What happens, in order

```text
 1. CLI     locate the Dockerfile; read .dockerignore
 2. CLI     open a BuildKit session; make the filtered context available
 3. FRONTEND parse the Dockerfile → LLB graph (a DAG of build steps)
 4. SOLVER  for each reachable node, compute its cache key
 5. SOLVER  cache hit  → reuse the existing snapshot, print CACHED
            cache miss → execute the step in a sandboxed container
 6. SOLVER  resolve and pull base images as needed
 7. EXPORT  write new layers as content-addressed blobs; build the image config
 8. ENGINE  register the image; apply the -t tags
 9. CLI     render progress; exit with the build's status
```

Two properties of step 3–5 separate BuildKit from the old mental model:

- **It is a graph.** Independent stages build **in parallel**. Stages that nothing depends on are **never built at all** — so `--target dev` genuinely skips the production-only stage.
- **The context is transferred lazily and incrementally.** BuildKit asks for the files a step actually needs, and re-sends only what changed since the previous build.

---

## 3. Build stages

Any Dockerfile with more than one `FROM` has multiple stages:

```dockerfile
FROM <builder-image> AS deps      # stage 0
FROM <builder-image> AS build     # stage 1  (may COPY --from=deps)
FROM <runtime-image> AS runtime   # stage 2  (COPY --from=build)
FROM runtime AS debug             # stage 3  (adds shell tooling)
```

```bash
docker build --target runtime -t app:prod .
docker build --target debug   -t app:dbg  .
```

<H>Without `--target`, the build produces the *last* stage in the file.</H> Put your production stage last so that a plain `docker build .` cannot accidentally ship a debug image. Full treatment in [Multi-Stage Builds](./13-multi-stage-builds.md).

---

## 4. Reading build output

```text
 => [internal] load build definition from Dockerfile              0.0s
 => [internal] load .dockerignore                                 0.0s
 => [internal] load metadata for docker.io/library/node:20        0.6s
 => [internal] load build context                                 4.8s   ← ①
 =>  => transferring context: 412.66MB                            4.7s   ← ①
 => CACHED [builder 2/6] WORKDIR /src                             0.0s   ← ②
 => CACHED [builder 3/6] COPY package.json package-lock.json ./   0.0s
 => [builder 4/6] RUN npm ci                                     38.2s   ← ③
 => [builder 5/6] COPY . .                                        0.3s
 => [builder 6/6] RUN npm run build                              21.9s
 => [stage-1 2/3] COPY --from=builder /src/dist ./                0.2s
 => exporting to image                                            1.1s
```

① **412 MB of context.** Something is wrong with `.dockerignore` — probably `node_modules`, `.git` or a build directory. This cost is paid on *every* build. See [Build Context](./07-build-context.md).

② **`CACHED`** means the step was not executed. The first non-cached step is your cache boundary; everything below it necessarily re-ran. See [Cache Invalidation](./10-cache-invalidation.md).

③ **The expensive step.** If this re-runs on builds where dependencies did not change, your instruction ordering is wrong.

Use `--progress=plain` to see the *inside* of `RUN` steps (the collapsing default output hides it), and `docker build --no-cache` to establish the true cold-build cost.

---

## 5. Build vs run — hold them apart

| | Build time | Run time |
| :--- | :--- | :--- |
| Produces | An image | A container |
| Executes | `RUN` | `ENTRYPOINT` / `CMD` |
| Sees | The build context | Volumes, bind mounts, injected env |
| Variables | `ARG` (+ `ENV`) | `ENV`, `-e`, env files |
| Network | Available (packages can be fetched) | Container networks, published ports |
| Happens | Once, in CI | Every container start, everywhere |
| Result | Immutable, shared | Ephemeral, per instance |

Most Docker mistakes are a category error between these two columns: baking environment-specific configuration at build time, expecting `RUN` to execute at start-up, or expecting a run-time volume to be visible during a build.

---

## 6. Modern build tooling

```bash
docker buildx create --name multi --use          # a builder instance
docker buildx build --platform linux/amd64,linux/arm64 -t org/app:1.0 --push .
```

- **`buildx`** exposes BuildKit fully: multiple builders (local, remote, in-container), multi-platform builds, and cache backends. Multi-platform builds must `--push` rather than `--load`, because the local image store cannot hold a multi-arch index.
- **Registry cache** makes CI builds cache-effective across ephemeral runners, where the local cache is empty every time:

```bash
docker buildx build \
  --cache-from type=registry,ref=registry.example.com/team/api:buildcache \
  --cache-to   type=registry,ref=registry.example.com/team/api:buildcache,mode=max \
  -t registry.example.com/team/api:1.4.2 --push .
```

`mode=max` exports intermediate-stage cache too, which is what makes multi-stage builds cacheable in CI. Without a shared cache, every CI build is a cold build — usually the single biggest win available in a slow pipeline.

---

## Rapid-fire recall

1. What exactly does the `.` in `docker build .` mean?
2. Can the Dockerfile live outside the build context?
3. Which stage does a build produce when `--target` is omitted?
4. What does `CACHED` in the output tell you about every step below it?
5. Why might a build spend 5 seconds before executing any instruction?
6. Why is `--build-arg` unsuitable for a secret?
7. Why do multi-platform `buildx` builds require `--push`?
8. In CI with fresh runners every time, why is the local build cache useless, and what replaces it?
9. Name two things BuildKit does that make the "top-to-bottom script" model inaccurate.

<details>
<summary>Answers</summary>

1. It sets the build context — the file tree that `COPY`/`ADD` may read from. It does not mean "build the current directory".
2. Yes. `-f` is independent of the context path, which is common in monorepos.
3. The last stage defined in the Dockerfile.
4. Nothing directly — but the *first* non-cached step marks the boundary: every step after it necessarily re-ran.
5. It is transferring the build context to the builder; a large or unfiltered context costs this on every build.
6. Build args are recorded in build history and image metadata, so anyone with the image can recover the value.
7. The result is a multi-arch index, which the local single-platform image store cannot represent.
8. Each runner starts with an empty local cache, so every build is cold. Registry-backed cache (`--cache-from`/`--cache-to`, `mode=max`) restores cache hits.
9. It builds a DAG — independent stages run in parallel, and unreferenced stages are skipped entirely; and it transfers context lazily rather than up front.

</details>

---

**Next:** [Build Context](./07-build-context.md) — the most misunderstood input to a Docker build.
