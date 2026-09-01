---
title: .dockerignore
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# `.dockerignore`

> **What you will be able to do after this page**
>
> - Write a `.dockerignore` that is correct for *your* application rather than copied from a blog post.
> - Explain its three distinct benefits: speed, safety, and cache stability.
> - Use the allowlist pattern, and know why its rule ordering is subtle.
> - Say precisely how `.dockerignore` differs from `.gitignore`.

---

## 1. Purpose

`.dockerignore` sits at the root of the build context and <H>filters the context before it ever reaches the builder</H>.

```text
   project/                    .dockerignore              context sent
   ├── src/          ────►     .git                ────►  src/
   ├── .git/                   node_modules              package.json
   ├── node_modules/           *.log                     lock-file
   ├── app.log
   ├── package.json
   └── lock-file
```

Filtering happens at the boundary. An excluded file is not transferred, not hashed, not visible to `COPY`, and cannot end up in the image — even by accident.

---

## 2. The three benefits

### 2.1 Performance

Every excluded byte is a byte not walked, hashed or transferred — on every build, by every developer, in every CI job. Dropping a 600 MB `node_modules` and a 900 MB `.git` from the context is routinely the difference between a 12-second build and a 90-second one.

### 2.2 Security

<H>This is the benefit people undersell.</H> A `.env` file, a cloud credentials file, a private key or a `.npmrc` with a token, combined with `COPY . .`, ships that secret inside a published image — and [layers make deletion useless](./04-image-layers.md#4-deletion-whiteouts-and-the-size-trap). Excluding it from the context makes the mistake structurally impossible.

### 2.3 Cache stability

Files that change constantly and matter not at all — logs, coverage reports, test output, editor state — will invalidate a broad `COPY` and force expensive rebuilds. Excluding them keeps the cache keyed on <C color="orange">only the inputs that actually affect the image</C>. See [Cache Invalidation](./10-cache-invalidation.md).

There is a correctness benefit too: host-built `node_modules`, a Python `venv`, or `vendor/` compiled for macOS will be silently wrong inside a Linux image. Excluding them forces the image to build its own, correct dependency tree.

---

## 3. Syntax

```dockerfile
# comment
node_modules            # matches at ANY depth? No — see below
**/node_modules         # matches at any depth
*.log                   # glob
logs/                   # a directory
!important.log          # negation: re-include something an earlier rule excluded
src/**/*.test.js        # ** spans directories
temp?                   # ? matches a single character
```

Rules to keep straight:

- Patterns are matched against paths **relative to the context root**. A bare `node_modules` matches only the top-level one; use `**/node_modules` for nested ones.
- <H>Later rules win.</H> Negations must come *after* the exclusion they are carving an exception out of.
- A trailing `/` is conventional for directories but not required.
- `.dockerignore` must be at the **context root**, not next to the Dockerfile. In a monorepo where the context is the repo root, the root file is the one that applies.
- BuildKit also supports a per-Dockerfile ignore file (`<dockerfile-name>.dockerignore`), which is useful when one context serves several Dockerfiles.

### The allowlist pattern

For maximum safety, exclude everything and re-include only what the build needs:

```dockerfile
# Deny by default
*

# Allow exactly what the build requires
!src/
!<dependency-manifest>
!<lock-file>
!<build-config>
```

This inverts the failure mode: forgetting to add a *needed* file breaks the build loudly, instead of accidentally shipping a secret silently. The cost is maintenance — new build inputs must be added. Worth it for images that are published publicly or handle sensitive data.

One subtlety with `*`: excluding a directory prevents descending into it, so `!src/deep/file` after `*` may not work as expected. Re-include the directory (`!src/`) rather than individual deep paths.

---

## 4. A generic starting point

```dockerfile
# ---- version control ----
.git
.gitignore
.svn

# ---- local dependency directories (rebuilt inside the image) ----
**/node_modules
**/vendor
**/.venv
**/venv
**/__pycache__
**/target
**/.gradle

# ---- build output produced on the host ----
build/
dist/
out/
*.o
*.class

# ---- secrets and local configuration ----
.env
.env.*
*.pem
*.key
secrets/
.aws/
.npmrc
.netrc

# ---- test, coverage, and reports ----
coverage/
test-results/
.pytest_cache/
.nyc_output/

# ---- logs and temporary files ----
logs/
*.log
tmp/
.cache/

# ---- editor and OS noise ----
.idea/
.vscode/
*.swp
.DS_Store
Thumbs.db

# ---- docker and CI files not needed inside the image ----
Dockerfile*
docker-compose*.yml
.dockerignore
.github/
```

<H>Treat this as a checklist of categories, not a file to copy verbatim.</H> The right `.dockerignore` depends entirely on the application:

- A **compiled-language** build may legitimately need `vendor/` in the context (vendored dependencies are the build input).
- A build that **embeds a git SHA** needs `.git`, or needs the SHA passed as a build arg instead.
- A **multi-stage build that runs tests** in the builder stage needs the test directory in the context.
- Excluding `Dockerfile` is safe — the builder reads it through a separate path, not through the context filter.

---

## 5. `.dockerignore` vs `.gitignore`

They overlap heavily and are not interchangeable.

| | `.gitignore` | `.dockerignore` |
| :--- | :--- | :--- |
| Consumed by | Git | The Docker build context filter |
| Scope | Repository | One build context |
| Nested files | Honoured at any depth | Only the context-root file (plus the optional per-Dockerfile variant) |
| Negation `!` | Supported, similar semantics | Supported, order-sensitive |
| Effect of a miss | Junk in a commit | <C color="crimson">A secret in a published image</C> |

The important asymmetry: files that are *committed* and needed by Git are often things you do **not** want in the image (CI configuration, docs, Dockerfiles themselves), and files Git ignores are sometimes needed by the build. Do not symlink one to the other.

---

## 6. Verifying it works

There is no `docker build --show-context`, so use these:

```bash
# 1. What is the context actually costing? Watch the build output.
docker build --progress=plain . 2>&1 | grep "transferring context"

# 2. What ended up in the image?
docker run --rm myimage:tag find /app -maxdepth 2

# 3. Is a secret present anywhere in any layer?
docker save myimage:tag | tar -tv | grep -i -E '\.env|\.pem|id_rsa'

# 4. Which step made the image fat?
docker image history myimage:tag
```

Check #3 in particular is worth putting in CI. It reads the layer blobs directly, so it finds files that were deleted in a later layer and are invisible to `docker run`.

---

## Rapid-fire recall

1. At what point in the build does `.dockerignore` take effect?
2. Give the three distinct benefits, and which is most often undersold.
3. Does a bare `node_modules` entry exclude `services/api/node_modules`?
4. Why must a `!` negation come after the rule it is excepting?
5. What is the allowlist pattern and what failure mode does it invert?
6. Where must the file live in a monorepo whose context is the repo root?
7. Why can including a host `node_modules` or `venv` be a correctness bug, not just a size one?
8. Why is excluding `.git` sometimes wrong, and what is the fix?
9. How do you prove a secret is not in any layer of a built image?

<details>
<summary>Answers</summary>

1. At the context boundary, before transfer — excluded files never reach the builder at all.
2. Speed, security, and cache stability. Security is the undersold one: it makes shipping a secret via `COPY . .` structurally impossible.
3. No. Use `**/node_modules` for nested directories.
4. Rules are applied in order and the last match wins, so a negation placed before its exclusion is overridden.
5. `*` followed by `!`-allowlisted paths. Forgetting a file then breaks the build loudly instead of leaking a file silently.
6. At the context root — the repo root — not beside the Dockerfile (unless you use the per-Dockerfile `<name>.dockerignore` variant).
7. Host-built dependencies may contain native binaries compiled for the wrong OS/architecture, producing an image that fails at run time.
8. Builds that read git metadata (commit SHA, git-derived version) need it. Pass the value as a build arg instead of shipping repository history.
9. `docker save` the image and inspect the layer tarballs directly; `docker run` cannot see files hidden by whiteouts in later layers.

</details>

---

**Next:** [Build Cache](./09-build-cache.md) — the mechanism that makes instruction order the most consequential decision in a Dockerfile.
