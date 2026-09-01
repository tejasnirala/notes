---
title: Secrets
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Secrets

> **What you will be able to do after this page**
>
> - Distinguish configuration from secrets, and treat each correctly.
> - Explain, mechanically, every way a secret leaks out of an image.
> - Use BuildKit secret mounts for build-time credentials.
> - Choose a run-time injection mechanism and know its weaknesses.

---

## 1. Configuration vs secret

```text
   CONFIGURATION                       SECRET
   ─────────────────────────           ─────────────────────────
   Changes behaviour                   Grants access
   Safe in a git repository            Never in a repository
   Safe in `docker inspect`            Must not appear there
   Safe in logs                        Must never be logged
   Rotated when requirements change    Rotated on a schedule, and after any exposure
   LOG_LEVEL, PORT, API_BASE_URL       passwords, API keys, private keys,
                                       tokens, certificates, DATABASE_URL
```

The dividing question: <H>would an attacker gain anything by reading this value?</H> If yes, it is a secret, regardless of how it is transported. `DATABASE_URL` is the classic case people misfile — it looks like configuration and contains a password.

---

## 2. Why secrets must not be in images

An image is a **distributable artifact**. It is pushed to registries, pulled by CI, cached on nodes, shared between teams, and often scanned or mirrored. Anything inside it should be assumed to be readable by anyone who can obtain it.

The four leak paths, each independent:

```text
  1. IMAGE LAYERS
     A COPYed file lives in a layer forever. `docker save` + untar reads it
     without ever running the container. Deleting it later only adds a whiteout.

  2. IMAGE CONFIG (ENV)
     `docker inspect` prints every ENV value. No container required.
     Every image built FROM yours inherits them.

  3. BUILD HISTORY
     `docker image history --no-trunc` shows the command strings of RUN steps
     and, in many setups, build-arg values. A secret on a RUN line is in there.

  4. THE RUNNING PROCESS
     Environment is visible to child processes, in /proc, in crash dumps, and
     in error-reporting payloads that helpfully attach "environment".
```

Concretely, all four of these are broken:

```dockerfile
ENV API_KEY=sk_live_abc123                         # ❌ leak path 2
COPY .env /app/.env                                # ❌ leak path 1
ARG NPM_TOKEN
RUN echo "//registry/:_authToken=${NPM_TOKEN}" > ~/.npmrc \
 && <install> \
 && rm ~/.npmrc                                    # ❌ leak paths 1 and 3
RUN --network=host curl -H "Authorization: Bearer ${TOKEN}" …   # ❌ leak path 3
```

<H>The `rm` in the third example fixes nothing.</H> The file is in the layer where it was created, and the token is in the build history string.

---

## 3. Build-time secrets: the correct mechanism

Sometimes the build genuinely needs a credential — a private package registry, a private git dependency. BuildKit's secret mount solves it:

```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=secret,id=registry_token \
    <read the token from /run/secrets/registry_token and use it>
```

```bash
docker build --secret id=registry_token,src=./token.txt .
# or from the environment:
docker build --secret id=registry_token,env=REGISTRY_TOKEN .
```

The secret is mounted into the step's filesystem <H>only for the duration of that step</H>. It is not in any layer, not in the build history, and not in the final image.

For SSH-based private dependencies:

```dockerfile
RUN --mount=type=ssh <fetch private dependencies over SSH>
```

```bash
docker build --ssh default .        # forwards your local ssh-agent
```

A multi-stage build is a partial mitigation but not a substitute: a secret used in a discarded builder stage does not reach the final image, but it may still be present in the build cache and in exported cache, which in CI is often pushed to a registry.

---

## 4. Run-time secrets

The image should contain no secret at all; the *runtime* supplies it.

| Mechanism | Strength | Weakness |
| :--- | :--- | :--- |
| `-e KEY=value` | Trivial | Visible in `docker inspect`, shell history, process listings |
| `--env-file` | Keeps it out of the command line | Still an env var at run time; the file must be protected |
| Compose `secrets` | Mounted as a file, not env | Not encrypted at rest in plain Compose |
| Orchestrator secrets (Swarm/Kubernetes) | Mounted as files, RBAC-controlled | Kubernetes Secrets are base64, not encrypted, unless encryption at rest is enabled |
| Dedicated secret manager (Vault, cloud KMS/Secrets Manager) | Rotation, audit, short-lived credentials, fine-grained policy | Operational complexity; an auth bootstrap problem |
| Workload identity (IAM roles, OIDC federation) | <C color="green">No long-lived secret exists at all</C> | Cloud/platform specific |

The direction of travel is clear: **files beat environment variables**, and **short-lived credentials beat stored ones**.

Why files beat environment variables for secrets:

- Not visible in `docker inspect` or in a process's environment.
- Not inherited automatically by child processes.
- Can be rotated by rewriting the file — no restart needed if the app re-reads it.
- Unix permissions apply.

### Compose secrets

```yaml
services:
  api:
    image: myorg/api:1.4.2
    secrets:
      - db_password
    environment:
      DB_PASSWORD_FILE: /run/secrets/db_password    # pass the PATH, not the value

secrets:
  db_password:
    file: ./secrets/db_password.txt     # local dev; keep it out of version control
```

The container sees the secret at `/run/secrets/db_password`, read-only, as a tmpfs file. The `*_FILE` convention — passing a path in an environment variable and having the application read the file — is supported by many official images and is a good pattern to adopt in your own.

---

## 5. Operational practice

1. **Never commit secrets.** Use `.gitignore` and `.dockerignore` for `.env`, `*.pem`, `*.key`; add a scanner (gitleaks, trufflehog) to CI.
2. **Scan images too:**

```bash
docker save myimage:tag | tar -xO | grep -aE 'BEGIN (RSA|OPENSSH) PRIVATE KEY|sk_live_|AKIA[0-9A-Z]{16}'
docker image history --no-trunc myimage:tag | grep -iE 'token|password|secret|key'
docker image inspect myimage:tag --format '{{json .Config.Env}}'
```

3. **Assume exposure is permanent.** If a secret ever entered an image or a repository, <H>rotate it</H>. Rewriting history or deleting a tag does not un-distribute it.
4. **Least privilege.** A leaked read-only credential scoped to one bucket is an incident; a leaked admin credential is a catastrophe.
5. **Prefer short-lived credentials.** A token that expires in an hour limits the blast radius of every other mistake on this list.

---

## Rapid-fire recall

1. Give the one-question test that separates a secret from configuration.
2. Why is `DATABASE_URL` a secret?
3. Name the four independent paths by which a secret leaks out of an image.
4. Why does deleting a secret file in a later `RUN` not help?
5. Why is `--build-arg` unsuitable for a token?
6. What does `RUN --mount=type=secret` guarantee, precisely?
7. Give three reasons a mounted secret file is safer than an environment variable.
8. What is the `*_FILE` convention?
9. A secret was pushed in an image last month, and the tag has since been deleted. What must you do?
10. Why do workload identity / short-lived credentials beat any storage mechanism?

<details>
<summary>Answers</summary>

1. Would an attacker gain anything by reading it? If yes, it is a secret.
2. It embeds a password, so possession of it grants database access.
3. Image layers (readable via `docker save`), the image config `ENV` (via `docker inspect`), build history (`docker image history`, including build args), and the running process environment (`/proc`, child processes, crash dumps).
4. Layers are immutable; the deletion writes a whiteout that hides the file while its bytes remain in the earlier layer.
5. Build-arg values appear in build history and image metadata, so anyone with the image can recover them.
6. The secret is mounted into that single build step's filesystem only — never written to a layer, the build history, or the final image.
7. Not visible in `docker inspect`; not automatically inherited by child processes; rotatable by rewriting the file, with Unix permissions applying.
8. Passing the *path* of a secret file in an environment variable (e.g. `DB_PASSWORD_FILE=/run/secrets/db_password`) and having the application read the file, instead of passing the value itself.
9. Rotate the credential. Distribution cannot be undone — the image may be cached, mirrored or copied anywhere.
10. Because there is no long-lived value to leak: credentials are issued on demand and expire, which caps the blast radius of any exposure.

</details>

---

**Next:** [Non-Root Containers](./16-non-root-containers.md) — dropping privilege, and why "containers are isolated" is not a defence.
