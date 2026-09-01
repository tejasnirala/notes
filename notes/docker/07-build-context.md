---
title: Build Context
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Build Context

> **What you will be able to do after this page**
>
> - Define the build context precisely and say why the concept has to exist at all.
> - State the three things the context is *not* — and why each confusion is dangerous.
> - Predict which files a build can and cannot reach.
> - Diagnose a slow build that is slow before any instruction runs.

---

## 1. Definition

> **The build context is the set of files made available to the builder for a given build — the only file tree that `COPY` and `ADD` may read from.**

You choose it with the final argument to `docker build`:

```bash
docker build .            # context = current directory
docker build ./service    # context = ./service
docker build ../..        # context = two levels up (usually a mistake)
docker build https://github.com/org/repo.git#main   # context = a git repo
docker build -             # context = a tar stream on stdin
```

---

## 2. Why it exists

Because the build does not happen where you typed the command. The builder is a separate process — often a different machine, often inside a VM. It has no access to your filesystem. So Docker must define, explicitly, <H>which files cross the boundary from your machine into the build sandbox</H>.

That boundary buys three properties:

1. **Reproducibility.** The build depends on a declared file set, not on whatever happens to exist on the builder's disk.
2. **Isolation.** A Dockerfile cannot read `~/.ssh`, `/etc/shadow`, or a sibling project. `COPY ../secrets .` is <C color="crimson">a hard error</C>, by design.
3. **Remote builds.** Because the context is transferred, the builder can be anywhere — a remote engine, a CI runner, a Docker Desktop VM.

---

## 3. What is in it, and how it is filtered

Everything under the context path, **recursively**, minus whatever `.dockerignore` excludes.

```text
  project/                        docker build .
  ├── src/                        ────────────────►  every file under project/
  ├── package.json                                   walked, filtered by
  ├── .git/            (900 MB)                      .dockerignore, and made
  ├── node_modules/    (600 MB)                      available to the builder
  ├── build/           (200 MB)
  ├── logs/
  └── .env             ← a secret, sitting in the context
```

Under legacy Docker this was a literal tar of the whole tree, sent up front. <H>Under BuildKit it is smarter — the context is transferred lazily and incrementally, with only changed files re-sent</H> — but the file *set* is still defined the same way, and it must still be walked, hashed and tracked. A huge context is still slow, and `.dockerignore` still matters just as much.

---

## 4. The three things it is not

### 4.1 The context is not the image

The context is an *input*. The image is an *output*. They share nothing automatically.

```text
   BUILD CONTEXT  ──(only what COPY/ADD names)──►  IMAGE LAYERS
```

### 4.2 The context is not the container filesystem

At run time the container's filesystem is the image layers plus a writable layer. The context does not exist any more — it was a build-time input on a different machine. A file present during the build is only in the container if some `COPY` put it there.

### 4.3 A file in the context does not enter the image

This is the one that gets stated backwards most often. Presence in the context means <C color="orange">"reachable by a `COPY`"</C>, nothing more.

```dockerfile
COPY package.json .      # only package.json enters the image
```

`.git`, `node_modules` and `.env` were all in the context and none of them entered the image.

**But the inverse trap is real:**

```dockerfile
COPY . .                 # now EVERYTHING in the context enters the image,
                         # including .env, .git and any credentials
```

<H>`.dockerignore` is what makes `COPY . .` safe.</H> That is why the two topics are inseparable.

---

## 5. Why a large context is a problem

| Cost | Explanation |
| :--- | :--- |
| **Transfer time** | Files must be walked, hashed and moved to the builder — on every build |
| **Cache noise** | A broad `COPY` hashes far more files, so unrelated changes cause cache misses |
| **Accidental inclusion** | With `COPY . .`, junk and secrets ship inside the image |
| **Image bloat** | `node_modules`/`vendor` from the host may be wrong for the target platform *and* huge |
| **Correctness** | Host-built native artifacts copied in can be binary-incompatible with the image |
| **CI cost** | Multiplied by every build, every branch, every day |

The last row is the one that matters organisationally: a 400 MB context on a 50-build day is 20 GB of pointless movement.

---

## 6. What to exclude, by category

```text
project/
├── source/              ✅ needed — this is the point
├── dependency-manifest  ✅ needed — and copy it before the source
├── lock-file            ✅ needed — determinism
├── .git/                ❌ VCS metadata: huge, and it can leak history and tokens
├── build/ dist/ target/ ❌ host build output: rebuilt in the image anyway
├── local dependencies/  ❌ node_modules, venv, vendor — platform-specific, huge
├── logs/                ❌ noise; changes constantly → cache churn
├── test-results/        ❌ generated, irrelevant to the runtime image
├── coverage/            ❌ same
├── IDE configuration/   ❌ .idea, .vscode — personal, not application
├── temporary files/     ❌ .cache, tmp, OS files like .DS_Store
└── .env, secrets/       ❌❌ NEVER — a leaked credential in a shipped image
```

The reasoning splits three ways:

- **Size** (`.git`, `node_modules`, `build/`) — transfer cost and image bloat.
- **Churn** (`logs/`, `coverage/`, `test-results/`) — these change on every run and would invalidate the cache for no reason.
- **Safety** (`.env`, key material, cloud credentials) — the cost of getting this wrong is a rotated production secret at best.

There is one nuance to state: <C color="orange">excluding `.git` breaks builds that read git metadata</C> (embedding a commit SHA, using a git-based versioning tool). The fix is to pass the value in as a build arg rather than to ship the repository history.

---

## 7. Choosing the context path

The context should be <H>the smallest directory that contains everything the build needs</H>.

```text
  monorepo/
  ├── services/api/       ← Dockerfile here
  ├── services/web/
  └── libs/shared/        ← the api build needs this too
```

- `docker build services/api` — small and fast, but cannot reach `libs/shared`. Fails.
- `docker build .` (repo root) with `-f services/api/Dockerfile` — works, and now `.dockerignore` at the root is doing heavy lifting.
- Better in large monorepos: a purpose-built context (a tar stream, a bazel-style staging directory) or BuildKit named contexts:

```bash
docker build -f services/api/Dockerfile \
  --build-context shared=libs/shared \
  services/api
```

```dockerfile
COPY --from=shared . /app/shared
```

Never solve the problem by pointing the context at a parent directory "just in case" — `docker build ../..` quietly hands your whole workspace to the builder.

---

## Rapid-fire recall

1. Define the build context in one sentence.
2. Why does the concept need to exist — what would break without it?
3. Why can't `COPY ../file .` work?
4. Is a file in the context automatically in the image? When does the answer flip?
5. Name the three categories of reason for excluding something from the context.
6. Under BuildKit, is the whole context still uploaded before the build starts?
7. Your build shows `transferring context: 780MB` — what do you check first?
8. In a monorepo, what is the trade-off between a narrow and a wide context?
9. What breaks if you exclude `.git`, and what is the correct fix?

<details>
<summary>Answers</summary>

1. The file tree made available to the builder for a build — the only source `COPY` and `ADD` can read from.
2. Builds do not run on your filesystem. Without an explicit, transferred file set there would be no reproducibility, no isolation from the rest of your disk, and no remote or containerised builders.
3. The context is a boundary; paths outside it are unreachable by design, which is what prevents a Dockerfile from reading arbitrary host files.
4. No — only what a `COPY`/`ADD` names. It flips with `COPY . .`, which pulls in everything the `.dockerignore` did not exclude.
5. Size (transfer and bloat), churn (needless cache invalidation), and safety (secrets and credentials).
6. No — it is transferred lazily and incrementally, but the file set is still walked and hashed, so a big context is still expensive.
7. `.dockerignore` — almost always a missing entry for local dependencies, `.git`, or a build output directory.
8. A narrow context is fast and safe but cannot reach shared code; a wide context can, at the cost of transfer size and a much more important `.dockerignore`. Named build contexts are the middle path.
9. Anything reading git metadata at build time (commit SHA, git-derived versions). Pass the value in with `--build-arg` instead of shipping the history.

</details>

---

**Next:** [`.dockerignore`](./08-dockerignore.md) — the one file that fixes most of the problems on this page.
