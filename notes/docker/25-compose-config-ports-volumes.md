---
title: Compose Configuration, Ports & Volumes
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Compose Configuration, Ports & Volumes

> **What you will be able to do after this page**
>
> - Use `environment`, `env_file` and `${VAR}` substitution without confusing the two different `.env` roles.
> - Publish ports deliberately and keep internal services unpublished.
> - Choose named volumes vs bind mounts per service, and know what `down -v` destroys.

---

## 1. Environment variables

### `environment`

```yaml
services:
  backend:
    environment:
      LOG_LEVEL: info                       # mapping syntax (preferred)
      DATABASE_URL: postgres://app@database:5432/app
      API_TIMEOUT: "30"                     # quote numbers: YAML would type them
      DEBUG:                                # no value → passed through from the host

    # list syntax, equivalent:
    # environment:
    #   - LOG_LEVEL=info
```

Two YAML pitfalls worth knowing:

- `on`, `off`, `yes`, `no`, `true`, `false` are parsed as booleans in older YAML handling; quote them if the application expects the literal string.
- A bare key with no value (`DEBUG:`) means <H>"take this variable's value from the host environment"</H>, and it silently becomes empty if the host does not have it.

### `env_file`

```yaml
    env_file:
      - .env.local
      - path: .env.secret       # long form
        required: false
```

The file is a plain `KEY=value` list read at container start. It is **not** parsed by a shell: no expansion, no command substitution, and quotes are handled literally in ways that surprise people.

Precedence, highest first:

```text
   1. `environment:` in the Compose file
   2. `env_file:` entries (later files override earlier ones)
   3. Values inherited from the host shell (for pass-through keys)
   4. `ENV` baked into the image
```

### The two different `.env` files

The most common source of confusion in Compose:

| | The project `.env` (next to the Compose file) | A file named in `env_file:` |
| :--- | :--- | :--- |
| Read by | <H>Compose itself</H>, to substitute `${VAR}` in the YAML | The container, as its environment |
| Affects | The Compose file's *text* before parsing | The running process |
| In the container? | <C color="crimson">No, not automatically</C> | Yes |

```bash
# .env  (used for ${...} substitution in the YAML)
TAG=1.4.2
POSTGRES_PORT=5432
```

```yaml
services:
  backend:
    image: myorg/backend:${TAG}                 # ← substituted by Compose
    environment:
      DATABASE_URL: postgres://app@database:${POSTGRES_PORT}/app
```

### Substitution syntax

```yaml
    ${VAR}                # empty string if unset
    ${VAR:-default}       # default if unset OR empty
    ${VAR-default}        # default only if unset
    ${VAR:?error message} # fail the command if unset or empty  ← use for required values
    $$LITERAL             # an escaped $ — passes a literal $ to the container
```

`${VAR:?…}` is underused and valuable: it turns a missing required variable into an immediate, readable failure instead of a container that starts with an empty configuration.

Check the result before wondering why something is empty:

```bash
docker compose config
```

### Configuration and secrets

Keep `.env` files out of version control; commit a `.env.example` with placeholder values instead:

```text
   .gitignore        .env, .env.*, !.env.example
   .dockerignore     .env, .env.*
```

For actual secrets, prefer Compose `secrets` (mounted as files) over environment variables — see [Secrets](./15-secrets.md).

---

## 2. Ports

```yaml
    ports:
      - "8080:8080"              # host:container
      - "127.0.0.1:5432:5432"    # publish only on host loopback
      - "8080"                   # container port only → random host port
      - "9000-9005:9000-9005"    # a range
      - target: 8080             # long syntax
        published: "8080"
        protocol: tcp
        mode: host
```

```text
   "8080:3000"
    │     └── CONTAINER port: where the application listens
    └──────── HOST port: where you connect from outside
```

The rules that follow from [Networking](./21-networking.md):

1. **Publishing is only for access from the host or the outside world.** Services on the same Compose network reach each other directly, on the container port, with no `ports` entry at all.
2. **Publish the entry point only.** A typical application publishes the API or the proxy — and nothing else.

```yaml
services:
  backend:
    ports: ["8080:8080"]      # ✅ the entry point
  database:
    # no ports — reachable at database:5432 internally      ✅
  cache:
    # no ports                                              ✅
```

3. **If you need local access to a data service, bind it to loopback:** `"127.0.0.1:5432:5432"`. Without the address prefix it is published on all host interfaces, and on Linux Docker's forwarding rules can bypass host firewall INPUT rules.
4. **Host ports must be unique** on the machine, which is why fixed `ports` conflicts with `--scale`.
5. **The container port is what other services use.** With `"5433:5432"`, the connection string is still `database:5432`.

`expose:` exists but is effectively documentation; it publishes nothing and is not needed for inter-service traffic.

---

## 3. Volumes

```yaml
services:
  database:
    volumes:
      - database_data:/var/lib/<database-data-dir>    # named volume — persistence
      - ./init:/docker-entrypoint-initdb.d:ro         # bind mount, read-only
  backend:
    volumes:
      - ./src:/app/src                                 # bind mount — hot reload (dev)
      - /app/<dependency-dir>                          # anonymous volume — masks the bind
      - uploads:/app/uploads                           # named volume — user content
      - type: tmpfs                                    # long syntax
        target: /tmp

volumes:
  database_data:
  uploads:
```

Short-syntax forms:

```text
   name:/path/in/container      named volume
   ./relative:/path             bind mount (relative to the Compose file)
   /absolute:/path              bind mount
   /path                        anonymous volume
   …:ro                         read-only
```

The behavioural differences are covered in [Runtime Filesystem & Volumes](./20-runtime-filesystem-and-volumes.md); the ones that matter here:

- A **named volume** is created and managed by Docker, named `<project>_<volume>`, and is initialised with the image's content at that path on first use.
- A **bind mount** hides whatever the image had at that path, performs no initialisation copy, and keeps host ownership.
- Mount **read-only** (`:ro`) for anything the container should not modify — config files, certificates, seed scripts.

### External volumes

```yaml
volumes:
  database_data:
    external: true
    name: production_db_data     # created and managed outside this project
```

Compose will use it but never create or delete it — a deliberate safety measure for production data, since `down -v` cannot destroy it.

### `down` vs `down -v`

```bash
docker compose down       # stops and removes containers + the project network
                          # named volumes SURVIVE
docker compose down -v    # ALSO removes named volumes declared in this file
                          # → database data is GONE
```

<H>`-v` is irreversible. There is no confirmation prompt and no undo.</H> Habits worth forming: never type `down -v` from muscle memory; mark real data volumes `external: true`; and take a backup before any destructive operation ([see §20](./20-runtime-filesystem-and-volumes.md#5-operating-volumes)).

---

## 4. A worked example

```yaml
name: myapp

services:
  backend:
    build:
      context: .
      target: ${BUILD_TARGET:-production}
    image: myorg/backend:${TAG:-dev}
    ports:
      - "${HOST_PORT:-8080}:8080"
    environment:
      LOG_LEVEL: ${LOG_LEVEL:-info}
      DATABASE_URL: postgres://app@database:5432/app
      CACHE_URL: redis://cache:6379
      DB_PASSWORD_FILE: /run/secrets/db_password
    env_file:
      - path: .env.local
        required: false
    secrets:
      - db_password
    depends_on:
      database:
        condition: service_healthy
      cache:
        condition: service_started
    volumes:
      - uploads:/app/uploads
    restart: unless-stopped

  database:
    image: <database-image>:${DB_VERSION:?DB_VERSION is required}
    environment:
      DB_USER: app
      DB_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - database_data:/var/lib/<database-data-dir>
      - ./init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "<readiness command>"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    restart: unless-stopped
    # deliberately no `ports`

  cache:
    image: <cache-image>:${CACHE_VERSION:-7}
    restart: unless-stopped

volumes:
  database_data:
  uploads:

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

Every choice here is deliberate: pinned image versions, a required variable that fails fast, defaults for the optional ones, a health-gated dependency, secrets as files rather than environment values, persistence on named volumes, and <H>exactly one published port</H>.

---

## Rapid-fire recall

1. What is the difference between the project `.env` and a file listed in `env_file`?
2. Give the precedence order for a variable's value.
3. What does `${DB_VERSION:?...}` do, and when should you use it?
4. Why quote `"30"` and `"true"` in `environment`?
5. Which services in a typical stack should have a `ports` entry?
6. With `"5433:5432"`, what does another service connect to?
7. How do you expose a database locally for debugging without exposing it to the network?
8. What does the bare entry `- /app/node_modules` do in a service's `volumes`?
9. What does `down -v` remove that `down` does not?
10. What does marking a volume `external: true` protect against?

<details>
<summary>Answers</summary>

1. The project `.env` is read by Compose to substitute `${VAR}` in the YAML; an `env_file` is passed to the container as its environment. The former does not enter the container automatically.
2. `environment:` > `env_file:` (later files win) > host shell pass-through > the image's `ENV`.
3. It fails the command with a message if the variable is unset or empty — use it for values with no safe default.
4. YAML would otherwise type them as a number or a boolean, and the application may require the literal string.
5. Only the externally-reachable entry point — typically the API or reverse proxy.
6. `database:5432`, the container port. The host-side 5433 is irrelevant internally.
7. Publish it bound to loopback: `"127.0.0.1:5432:5432"`.
8. Creates an anonymous volume at that path, masking the bind mount beneath it so the image's installed dependencies stay visible.
9. Named volumes declared in the file — and therefore all persistent data in them.
10. It stops Compose creating or deleting the volume, so `down -v` cannot destroy production data.

</details>

---

**Next:** [Compose Lifecycle Commands](./26-compose-lifecycle.md) — `up`, `down`, `logs`, `ps` and their side effects.
