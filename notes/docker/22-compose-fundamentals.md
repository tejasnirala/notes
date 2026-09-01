---
title: Docker Compose
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Docker Compose

> **What you will be able to do after this page**
>
> - Say what problem Compose solves and where its usefulness ends.
> - Read and write the top-level structure of a Compose file confidently.
> - Understand the project concept — and why it silently namespaces everything.
> - Know what changed between `docker-compose` and `docker compose`.

---

## 1. What it is and why it exists

> **Docker Compose is a tool for defining a multi-container application declaratively in a single file, and managing its lifecycle as one unit.**

Without it, a three-service application is a pile of imperative commands whose order and flags you must remember exactly:

```bash
docker network create app-net
docker volume create db-data
docker run -d --name database --network app-net -v db-data:/var/lib/... -e ... <db-image>
docker run -d --name cache    --network app-net <cache-image>
docker build -t api . && docker run -d --name api --network app-net -p 8080:8080 -e ... api
```

With Compose, that becomes a committed, reviewable file and one command:

```bash
docker compose up -d
```

What it actually buys you:

| Problem | Compose's answer |
| :--- | :--- |
| Long, forgettable `docker run` invocations | A declarative file, in version control, reviewable in a PR |
| Manual network and volume creation | Created automatically, named per project |
| Services must find each other | An automatic user-defined network with DNS by service name |
| Lifecycle across many containers | `up` / `down` / `logs` / `ps` operate on the whole application |
| "How do I run this project?" | <H>The file *is* the answer, and it is executable documentation</H> |

Where it is the right tool: local development, integration and end-to-end testing in CI, demos, and small single-host deployments. Where it is not: multi-host clusters, autoscaling, rolling updates with health gating, self-healing scheduling — that is orchestrator territory. See [Production Compose](./28-production-compose.md).

---

## 2. The application topology

```text
                        ┌──────────────┐
          host:8080 ───►│   Backend    │
                        └──────┬───────┘
                               │  internal network — no published ports
                    ┌──────────┴──────────┐
                    ▼                     ▼
             ┌────────────┐        ┌────────────┐
             │  Database  │        │   Cache    │
             └─────┬──────┘        └────────────┘
                   │
              named volume
             (data survives)
```

Every element in that picture is a line in the file: services, the network between them, the published port, and the volume.

---

## 3. Anatomy of a Compose file

```yaml
services:                          # the containers that make up the application
  backend:
    build: .                       # build an image from a Dockerfile
    ports:
      - "8080:8080"                # host:container — only the entry point
    environment:
      DATABASE_URL: postgres://app@database:5432/app   # service NAME, not an IP
      CACHE_URL: redis://cache:6379
      LOG_LEVEL: ${LOG_LEVEL:-info}
    depends_on:
      database:
        condition: service_healthy # start ordering + a readiness gate
      cache:
        condition: service_started
    restart: unless-stopped

  database:
    image: <database-image>:<pinned-version>
    environment:
      DB_USER: app
      DB_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - database_data:/var/lib/<database-data-dir>     # persistence
    secrets:
      - db_password
    healthcheck:
      test: ["CMD-SHELL", "<database readiness command>"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    # NO ports: nothing outside needs to reach it

  cache:
    image: <cache-image>:<pinned-version>
    command: ["<cache-server>", "--<tuning-flag>", "<value>"]

volumes:
  database_data:                   # docker-managed named volume

networks:
  default:                         # Compose creates one automatically;
    name: app-net                  # declare it only to customise

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

Top-level keys: `services`, `volumes`, `networks`, `secrets`, `configs`. (`version:` is <C color="crimson">obsolete</C> — the Compose Specification dropped it, and modern Compose warns about it. Delete it from old files.)

### Service names

The service name (`backend`, `database`, `cache`) is doing three jobs at once:

1. It is the **DNS hostname** other services use to reach it.
2. It is the **default container name** prefix and the identifier for CLI subcommands: `docker compose logs database`.
3. It is the **key** other services reference in `depends_on`.

Choose names by role — `database`, `cache`, `queue` — not by product. Then swapping the implementation is a one-line image change instead of an application-wide rename.

---

## 4. The key fields at a glance

| Key | Purpose | Notes |
| :--- | :--- | :--- |
| `image` | Use a prebuilt image | Pin the version; never rely on `latest` |
| `build` | Build from a Dockerfile | Mutually exclusive with `image` in practice; together, `image` names the build result |
| `ports` | Publish to the host | Only for services that must be reachable from outside |
| `expose` | Documentation only | Not needed for inter-service traffic |
| `environment` | Runtime configuration | Values or `KEY=VALUE`; supports `${VAR}` substitution |
| `env_file` | Load variables from a file | Keep the file out of version control |
| `depends_on` | Start order (+ conditions) | <H>Ordering, not readiness</H> — see [next](./24-compose-depends-on-and-health.md) |
| `volumes` | Mounts | Named volumes for state, bind mounts for development |
| `networks` | Attach to networks | A default is created automatically |
| `restart` | Restart policy | `no`, `always`, `on-failure`, `unless-stopped` |
| `command` | Override `CMD` | Prefer exec-form lists |
| `entrypoint` | Override `ENTRYPOINT` | Same |
| `healthcheck` | Readiness probe | Enables `condition: service_healthy` |
| `deploy.resources` | CPU/memory limits | Honoured by `docker compose up` in current versions |
| `secrets` | Mount secrets as files | Better than environment variables |
| `profiles` | Optional service groups | Keep tooling services out of the default `up` |

---

## 5. The project concept

Compose groups everything it creates under a **project name**, which defaults to the directory name (overridable with `-p` or `COMPOSE_PROJECT_NAME`).

```text
   directory: myapp/       project: myapp
   ├── containers   myapp-backend-1, myapp-database-1
   ├── network      myapp_default
   └── volumes      myapp_database_data
```

Consequences that catch people out:

- **Renaming the directory changes the project**, so `up` creates *new* volumes and your data appears to have vanished. It is still there under the old project's volume name.
- **Two checkouts of the same repo in differently-named directories are two independent applications** — occasionally useful, often surprising.
- **`docker compose down` only affects its own project**, which is what makes concurrent projects on one machine safe.

Set the project name explicitly for anything that matters:

```yaml
name: myapp
```

---

## 6. Multiple files and overrides

Compose merges files, which is the idiomatic way to separate environments:

```bash
docker compose up                                              # base + override (automatic)
docker compose -f compose.yaml -f compose.prod.yaml up -d      # explicit
```

- `compose.yaml` — the shared definition.
- `compose.override.yaml` — <H>loaded automatically</H>; the natural home for development-only settings (bind mounts, debug ports, dev commands).
- `compose.prod.yaml` — production settings, applied explicitly.

Merge semantics: scalars are replaced, most sequences are appended (`ports`, `volumes`), and mappings are merged key-by-key. It is worth checking what you actually got:

```bash
docker compose config          # print the fully merged, resolved configuration
```

`docker compose config` is the single most useful debugging command in Compose — it shows variable substitution results, merged files, and defaults, so you can see exactly what will run.

**File names:** `compose.yaml` is the current canonical name; `docker-compose.yml` still works and is everywhere in existing projects.

---

## 7. `docker-compose` vs `docker compose`

| | `docker-compose` (v1) | `docker compose` (v2) |
| :--- | :--- | :--- |
| Implementation | A separate Python program | A Go plugin built into the Docker CLI |
| Status | End of life | Current |
| Naming | `myapp_backend_1` (underscores) | `myapp-backend-1` (hyphens) |
| `version:` key | Required | Obsolete and warned about |
| Speed / features | Slower; feature-frozen | Faster; actively developed; profiles, `--wait`, better `depends_on` conditions |

Use `docker compose` (space). Old tutorials, scripts and CI configurations still use the hyphenated form; the flags are mostly compatible, so migration is usually mechanical.

---

## Rapid-fire recall

1. What problem does Compose solve, in one sentence?
2. Name the three jobs a service name performs.
3. Why is `version:` no longer used?
4. What does Compose create automatically that you did not declare?
5. What is a Compose project, and what determines its name by default?
6. Why does renaming your project directory appear to delete your database?
7. Which file is merged automatically without being named on the command line?
8. Which command shows the fully resolved configuration, and why is it valuable?
9. Where does Compose stop being the right tool?

<details>
<summary>Answers</summary>

1. It replaces a pile of imperative `docker run` commands with a declarative, version-controlled definition of a multi-container application and manages its lifecycle as one unit.
2. DNS hostname for other services, identifier for CLI subcommands and container naming, and the key referenced by `depends_on`.
3. The Compose Specification dropped it; modern Compose infers the schema and warns when the key is present.
4. A default user-defined network with DNS by service name, plus the named volumes declared at the top level.
5. A namespace grouping the containers, networks and volumes it creates; it defaults to the directory name.
6. Volume names are project-scoped, so a renamed directory means a new project and therefore a new, empty volume.
7. `compose.override.yaml`.
8. `docker compose config` — it shows merged files, resolved variable substitution and defaults, so you see exactly what will run.
9. At multi-host clustering, autoscaling, rolling updates with health gating, and self-healing scheduling — that is an orchestrator's job.

</details>

---

**Next:** [Compose Build & Networking](./23-compose-build-and-networking.md) — building images from Compose, and how service discovery is wired.
