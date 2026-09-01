---
title: Runtime Configuration
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Runtime Configuration

> **What you will be able to do after this page**
>
> - State the rule that makes one image promotable across every environment.
> - Distinguish build-time from run-time configuration, and know which belongs where.
> - Apply twelve-factor config principles without pretending they are absolute.
> - Handle the awkward cases: config files, build-time-baked frontend variables, defaults.

---

## 1. The rule

> **Build one image. Configure it at run time.**

```text
                       ┌──────────► dev        ─e DATABASE_URL=…  LOG_LEVEL=debug
   ONE IMAGE           │
   api@sha256:9f86…  ──┼──────────► staging    ─e DATABASE_URL=…  LOG_LEVEL=info
   (immutable)         │
                       └──────────► production ─e DATABASE_URL=…  LOG_LEVEL=warn
```

If you build `api:1.4.2-staging` and `api:1.4.2-production` separately, <H>the artifact you tested is not the artifact you shipped</H>. Every property containers were meant to give you — reproducibility, promotable artifacts, trustworthy rollback — is lost at that moment. "It worked in staging" becomes meaningless.

---

## 2. Build-time vs run-time configuration

| | Build-time | Run-time |
| :--- | :--- | :--- |
| Mechanism | `ARG`, files copied in | `ENV` overrides, `-e`, env files, mounted config, secret stores |
| Fixed at | Image creation | Container start |
| Same across environments | Must be | Differs per environment |
| Examples | Runtime version, build metadata, feature compilation flags | Database URL, external endpoints, log level, port, feature flags, credentials |

**Belongs at build time:** things that are properties of *the artifact* — which runtime version it needs, what was compiled in, the commit it was built from.

**Belongs at run time:** things that are properties of *the environment* — where the database lives, how loudly to log, which port to bind, which features are on.

The test: <H>if two environments would need different values, it must not be baked in.</H>

---

## 3. Twelve-factor config, honestly

The twelve-factor principle is "store config in the environment", and its useful core is:

1. **Strict separation of config from code.** Config varies per deploy; code does not.
2. **The litmus test:** could the codebase be open-sourced right now without leaking credentials? If not, config is in the wrong place.
3. **No environment grouping in code.** Avoid `if env == "production"` branches; they multiply combinatorially and hide behaviour in the artifact.

Where it deserves qualification:

- **Environment variables do not scale gracefully.** Sixty variables in a deployment manifest is worse than one mounted, validated, structured config file. Large configuration is legitimately a file.
- **Env vars are flat strings.** Nested structure, lists, and typed values become awkward encodings.
- **Env vars leak.** Into child processes, crash dumps, `docker inspect`, and error-reporting payloads. They are acceptable for configuration; <C color="crimson">they are a poor mechanism for secrets</C> — see [Secrets](./15-secrets.md).
- **Some platforms genuinely bake config in.** Client-side web bundles are compiled with their API URL; that variable is build-time by nature. The mitigation is to build per-environment *frontend* artifacts knowingly, or to fetch runtime config from an endpoint at page load.

A practical synthesis:

```text
  small, flat, per-environment values      → environment variables
  large, structured, per-environment       → a mounted config file
  credentials of any kind                  → a secret mechanism, not either of the above
  properties of the artifact itself        → build time
```

---

## 4. Doing it in practice

### Defaults in the image, overrides outside

```dockerfile
ENV LOG_LEVEL=info \
    PORT=8080 \
    APP_ENV=production
```

`ENV` is the right place for <H>safe defaults</H> — values that make the image runnable with no configuration and that are correct for the common case. They are overridden trivially:

```bash
docker run -e LOG_LEVEL=debug -e PORT=9000 myimage
```

Never put an environment-specific *endpoint* or any credential here.

### Compose

```yaml
services:
  api:
    image: myorg/api:1.4.2
    environment:
      LOG_LEVEL: ${LOG_LEVEL:-info}        # host env, with a default
      DATABASE_URL: postgres://app@database:5432/app
    env_file:
      - .env.local                          # not committed
```

Details in [Compose Configuration](./25-compose-config-ports-volumes.md).

### Config files mounted at run time

```yaml
    volumes:
      - ./config/production.yaml:/etc/app/config.yaml:ro
```

Read-only, injected at start, never in the image. The application reads a fixed path; the *content* varies per environment.

### Fail fast on missing configuration

The most valuable habit in this whole area:

```text
   at start-up:
     read every required setting
     validate types and formats
     if anything required is missing or malformed → log clearly and EXIT NON-ZERO
```

A container that dies immediately with `DATABASE_URL is required` is <H>vastly better than one that starts healthy and fails on the first request</H>. It turns a configuration mistake into a deploy failure instead of a production incident, and orchestrators will surface it as a crash-loop with a readable reason.

### Common settings, generically

| Variable | Kind | Notes |
| :--- | :--- | :--- |
| `DATABASE_URL` | Secret-bearing | Contains credentials — treat as a secret |
| `API_BASE_URL` | Config | Differs per environment |
| `LOG_LEVEL` | Config | Safe default in `ENV` |
| `PORT` | Config | Bind to `0.0.0.0`, not `127.0.0.1`, or nothing outside the container can reach it |
| `FEATURE_FLAG_X` | Config | Prefer a flag service for anything dynamic |

That `PORT` note is worth its own line: <C color="crimson">binding to `127.0.0.1` inside a container makes the service unreachable</C> even with `-p` published, because loopback in the container's network namespace is not the host's. See [Networking](./21-networking.md).

---

## 5. Why environment-specific images are an anti-pattern

Concretely, what breaks:

- **Testing is invalidated.** You verified a different binary artifact than the one deployed.
- **Rollback is unreliable.** "Roll back to the previous version" now means rebuilding, and the rebuild may not be identical.
- **The image count multiplies.** Environments × versions, each needing storage, scanning, and patching.
- **Promotion becomes a rebuild.** Instead of re-tagging a tested digest, you rebuild — reintroducing every risk the test was meant to eliminate.

The healthy pipeline:

```text
  build once ──► test that image ──► push by digest ──► promote the SAME digest
                                                        through each environment
```

---

## Rapid-fire recall

1. State the rule in one sentence, and the main thing that breaks when it is violated.
2. Give the test for whether a value belongs at build time or run time.
3. Name two legitimate limits of "config in environment variables".
4. What kind of value is `ENV` in a Dockerfile actually good for?
5. Why is `DATABASE_URL` not merely configuration?
6. Why should an application exit on missing configuration rather than start?
7. Why is binding to `127.0.0.1` inside a container a bug?
8. Give two operational costs of building one image per environment.
9. What is the one common case where configuration genuinely must be baked in, and how is it mitigated?

<details>
<summary>Answers</summary>

1. Build one image, configure it at run time. Violating it means the artifact you tested is not the artifact you shipped, so testing and rollback stop being trustworthy.
2. Would two environments need different values? If yes, it is run-time configuration.
3. Env vars are flat strings that scale badly to large or structured config, and they leak into child processes, crash dumps and `docker inspect`.
4. Safe defaults that make the image runnable out of the box and are correct in the common case.
5. It embeds credentials, so it needs secret handling, not plain environment configuration.
6. It converts a configuration error into an immediate, clearly-labelled deploy failure instead of a runtime incident on the first request.
7. Loopback inside the container's network namespace is not the host's; published ports forward to the container's external interface, which a loopback-bound process is not listening on.
8. Multiplied image count to store, scan and patch; and promotion becomes a rebuild rather than a re-tag, so rollback is unreliable.
9. Client-side bundles compiled with their API endpoint. Mitigate by knowingly building per-environment frontend artifacts, or by fetching runtime config from an endpoint at load time.

</details>

---

**Next:** [Secrets](./15-secrets.md) — why `ENV` is the wrong tool and what the right ones are.
