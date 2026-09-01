---
title: Compose Reference
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Compose Reference

A lookup page: the keys you will actually use, with one example each. Concepts are explained in chapters [22](./22-compose-fundamentals.md)–[26](./26-compose-lifecycle.md); this is for when you know what you want and need the syntax.

---

## Top-level keys

| Key | Purpose |
| :--- | :--- |
| `name` | The project name (otherwise the directory name) |
| `services` | The containers making up the application |
| `volumes` | Named volume declarations |
| `networks` | Network declarations |
| `secrets` | Secret declarations, mounted as files |
| `configs` | Non-secret config files mounted into containers |
| `include` | Pull in another Compose file as part of this project |
| ~~`version`~~ | <C color="crimson">Obsolete</C> — remove it from old files |

---

## Service keys

| Key | Purpose | Chapter |
| :--- | :--- | :--- |
| `image` | Image to run (or the name for a built image) | [3](./03-images.md) |
| `build` | Build from a Dockerfile | [23](./23-compose-build-and-networking.md) |
| `command` | Override `CMD` | [5](./05-dockerfile.md) |
| `entrypoint` | Override `ENTRYPOINT` | [5](./05-dockerfile.md) |
| `environment` | Environment variables | [25](./25-compose-config-ports-volumes.md) |
| `env_file` | Load variables from a file | [25](./25-compose-config-ports-volumes.md) |
| `ports` | Publish to the host | [25](./25-compose-config-ports-volumes.md) |
| `expose` | Documentation only | [21](./21-networking.md) |
| `volumes` | Mounts | [20](./20-runtime-filesystem-and-volumes.md) |
| `networks` | Networks to attach to | [21](./21-networking.md) |
| `depends_on` | Start ordering and conditions | [24](./24-compose-depends-on-and-health.md) |
| `healthcheck` | Readiness probe | [24](./24-compose-depends-on-and-health.md) |
| `restart` | Restart policy | below |
| `user` | Run as this UID/GID | [16](./16-non-root-containers.md) |
| `read_only` | Read-only root filesystem | [16](./16-non-root-containers.md) |
| `tmpfs` | Memory-backed mounts | [20](./20-runtime-filesystem-and-volumes.md) |
| `secrets` | Mount declared secrets | [15](./15-secrets.md) |
| `deploy.resources` | CPU and memory limits | [28](./28-production-compose.md) |
| `logging` | Logging driver and options | [28](./28-production-compose.md) |
| `profiles` | Group optional services | below |
| `stop_grace_period` | Time before SIGKILL | [17](./17-pid1-and-signals.md) |
| `stop_signal` | Signal used to stop | [17](./17-pid1-and-signals.md) |
| `init` | Inject a minimal init as PID 1 | [17](./17-pid1-and-signals.md) |
| `develop.watch` | Sync/rebuild on file changes | [23](./23-compose-build-and-networking.md) |
| `extra_hosts` | Extra `/etc/hosts` entries | [21](./21-networking.md) |
| `container_name` | Fixed container name (breaks scaling) | [23](./23-compose-build-and-networking.md) |
| `working_dir` | Override `WORKDIR` | [5](./05-dockerfile.md) |
| `cap_add` / `cap_drop` | Linux capabilities | [16](./16-non-root-containers.md) |
| `security_opt` | Seccomp/AppArmor/`no-new-privileges` | [16](./16-non-root-containers.md) |
| `pull_policy` | When to pull the image | below |
| `labels` | Metadata on the container | — |

---

## Examples

### `image` / `build`

```yaml
services:
  cache:
    image: <cache-image>:7.2          # pin the version
  backend:
    image: myorg/backend:1.4.2        # names the build result
    build:
      context: .
      dockerfile: docker/Dockerfile
      target: production
      args:
        APP_VERSION: ${TAG:-dev}
      cache_from:
        - myorg/backend:buildcache
```

### `command` / `entrypoint`

```yaml
    command: ["<server>", "--workers", "4"]      # exec form — prefer this
    entrypoint: ["/app/entrypoint.sh"]
```

Exec-form lists avoid the shell-wrapper PID 1 problem described in [chapter 17](./17-pid1-and-signals.md).

### `environment` / `env_file`

```yaml
    environment:
      LOG_LEVEL: ${LOG_LEVEL:-info}
      DATABASE_URL: postgres://app@database:5432/app
    env_file:
      - path: .env.local
        required: false
```

### `ports` / `expose`

```yaml
    ports:
      - "8080:8080"                # published
      - "127.0.0.1:5432:5432"      # host loopback only
    expose:
      - "9090"                     # documentation; publishes nothing
```

### `volumes`

```yaml
    volumes:
      - database_data:/var/lib/<data-dir>       # named volume
      - ./config.yaml:/etc/app/config.yaml:ro   # bind mount, read-only
      - /app/<dependency-dir>                   # anonymous volume (masking)
      - type: tmpfs
        target: /tmp
```

### `networks`

```yaml
services:
  backend:
    networks: [frontend, backend]
networks:
  frontend:
  backend:
    internal: true          # no external connectivity
  shared:
    external: true          # created outside this project
    name: company-net
```

### `depends_on`

```yaml
    depends_on:
      database:
        condition: service_healthy
      migrations:
        condition: service_completed_successfully
```

### `healthcheck`

```yaml
    healthcheck:
      test: ["CMD-SHELL", "<readiness command>"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    # disable an inherited healthcheck:
    # healthcheck:
    #   disable: true
```

### `restart`

```yaml
    restart: unless-stopped
```

| Policy | Behaviour |
| :--- | :--- |
| `no` | Never restart (the default) |
| `on-failure[:N]` | Restart on non-zero exit, optionally capped |
| `always` | Always restart, including after a daemon restart |
| `unless-stopped` | Like `always`, but respects a manual stop — <H>usually the right choice</H> |

### Resource limits and logging

```yaml
    deploy:
      resources:
        limits:
          cpus: "1.5"
          memory: 512M
        reservations:
          memory: 256M
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Without `logging` options, the default `json-file` driver <C color="crimson">grows without bound</C> and will eventually fill the disk.

### `secrets` / `configs`

```yaml
services:
  database:
    secrets: [db_password]
    environment:
      DB_PASSWORD_FILE: /run/secrets/db_password
secrets:
  db_password:
    file: ./secrets/db_password.txt
configs:
  app_config:
    file: ./config/production.yaml
```

### `profiles`

```yaml
services:
  backend:
    build: .
  admin-tools:
    image: <tooling-image>
    profiles: [tools]        # not started by a plain `up`
```

```bash
docker compose up                      # backend only
docker compose --profile tools up      # backend + admin-tools
```

### Security hardening

```yaml
    user: "10001:10001"
    read_only: true
    tmpfs:
      - /tmp
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    security_opt:
      - no-new-privileges:true
```

### `pull_policy`

```yaml
    pull_policy: always        # always | missing (default) | never | build
```

### `include`

```yaml
include:
  - path: ../shared/compose.observability.yaml
```

---

## Deprecated / avoid

| Key | Why |
| :--- | :--- |
| `version` | Obsolete under the Compose Specification |
| `links` | Superseded by user-defined networks and DNS |
| `container_name` | Breaks scaling; the generated name is fine |
| `volumes_from` | Legacy; use named volumes |
| `network_mode: host` | Removes isolation and DNS-based discovery; Linux only |
| `privileged: true` | Effectively disables container security; needs a very specific justification |

---

**Next:** [Production Compose Architecture](./28-production-compose.md) — what changes when this is not a laptop.
