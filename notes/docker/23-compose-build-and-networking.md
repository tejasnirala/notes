---
title: Compose Build & Networking
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Compose Build & Networking

> **What you will be able to do after this page**
>
> - Map every Compose `build` field onto the equivalent `docker build` flag.
> - Know when Compose rebuilds an image and when it silently reuses a stale one.
> - Explain Compose's automatic network and DNS, including scaling behaviour.
> - Design multi-network topologies that keep a database unreachable from the edge.

---

## 1. `build` in Compose

```yaml
services:
  backend:
    build: .              # shorthand: context = ".", Dockerfile = "./Dockerfile"
```

is exactly:

```bash
docker build -t <project>-backend .
```

The long form exposes the full build surface:

```yaml
services:
  backend:
    image: myorg/backend:1.4.2      # name the RESULT (and the pull target)
    build:
      context: .                    # the build context — see chapter 7
      dockerfile: docker/Dockerfile # relative to the context
      target: production            # which stage to stop at
      args:                         # values for ARG (NOT for secrets)
        APP_VERSION: ${APP_VERSION:-dev}
      cache_from:
        - myorg/backend:buildcache
      secrets:
        - npm_token                 # BuildKit build secrets
      platforms:
        - linux/amd64
```

| Field | `docker build` equivalent | Notes |
| :--- | :--- | :--- |
| `context` | the final positional argument | Same semantics; `.dockerignore` applies |
| `dockerfile` | `-f` | Resolved relative to `context` |
| `target` | `--target` | The dev/prod split from one file |
| `args` | `--build-arg` | <C color="crimson">Visible in image history — never secrets</C> |
| `cache_from` | `--cache-from` | Essential in CI |
| `secrets` | `--secret` | The correct mechanism for build credentials |
| `platforms` | `--platform` | Multi-arch |

### `image` together with `build`

When both are present, `image` names the built result rather than pulling it. That is the pattern you want for anything you will push:

```yaml
    image: registry.example.com/team/backend:1.4.2
    build: .
```

```bash
docker compose build && docker compose push
```

---

## 2. When Compose builds — and when it does not

This trips up nearly everyone at least once:

| Command | Behaviour |
| :--- | :--- |
| `docker compose up` | Builds **only if the image does not exist locally** |
| `docker compose up --build` | Always rebuilds services that declare `build` |
| `docker compose build` | Builds without starting anything |
| `docker compose build --no-cache` | Rebuild ignoring the cache |
| `docker compose up --force-recreate` | Recreates containers; does *not* rebuild images |
| `docker compose watch` | Rebuilds/syncs automatically on file changes |

<H>Plain `docker compose up` will happily run a months-old image after you changed the Dockerfile.</H> "My change isn't showing up" is nearly always a missing `--build`.

For development, `develop.watch` avoids the whole problem:

```yaml
services:
  backend:
    build: .
    develop:
      watch:
        - action: sync              # copy changed files into the container
          path: ./src
          target: /app/src
        - action: rebuild           # a dependency change requires a rebuild
          path: ./<dependency-manifest>
```

```bash
docker compose watch
```

`sync` gives hot-reload behaviour without a bind mount (avoiding the dependency-directory trap), and `rebuild` handles the cases where a sync is not enough.

---

## 3. Automatic networking

For every project, Compose creates a **user-defined bridge network** named `<project>_default` and attaches every service to it.

```text
   myapp_default  (bridge, 172.20.0.0/16)
   ├── myapp-backend-1    172.20.0.4   DNS: backend
   ├── myapp-database-1   172.20.0.2   DNS: database
   └── myapp-cache-1      172.20.0.3   DNS: cache
```

Because it is user-defined (not the legacy default bridge), embedded DNS is active and <H>service names resolve automatically</H>. This is the single most valuable thing Compose does for you.

```yaml
    environment:
      DATABASE_URL: postgres://app@database:5432/app
      CACHE_URL:    redis://cache:6379
```

Here `database` and `cache` are **service names**, resolved by Docker's embedded DNS to whatever IP those containers currently hold.

### What resolves to what

| Name | Resolves | Notes |
| :--- | :--- | :--- |
| Service name (`database`) | <C color="green">Yes</C> | The canonical form; use this |
| Container name (`myapp-database-1`) | Yes | Project-prefixed; avoid depending on it |
| `container_name:` value | Yes | Setting it breaks scaling — two replicas cannot share a name |
| Network alias | Yes | Extra names for the same service |
| An IP address | Works until the next recreate | <C color="crimson">Never hardcode</C> |

### Why service names, not IPs

- IPs are assigned from the subnet pool at container start and change on every recreate — every `up` after a rebuild.
- Start order affects who gets which address.
- The same file must work on every developer's machine and in CI, where IPs will differ.
- Names are stable, self-documenting, and identical everywhere.

### Ports on the internal network

All ports are open between services on the same network; `expose` and `EXPOSE` are documentation. `ports` is only for reaching a container from the host or outside world — so the database should have none. See [Compose Ports](./25-compose-config-ports-volumes.md).

### Scaling and DNS

```bash
docker compose up -d --scale worker=4
```

`worker` now resolves to four A records. The resolver returns them in varying order, which distributes connections crudely. It is <C color="orange">not load balancing</C>: no health awareness, no connection-count awareness, and client-side DNS caching often pins a client to one replica. For anything real, put a proxy in front or use an orchestrator's service abstraction.

Also note: `container_name` and host port publishing both conflict with scaling — a fixed name cannot be duplicated, and a fixed host port cannot be bound twice.

---

## 4. Custom networks and segmentation

```yaml
services:
  proxy:
    image: <reverse-proxy-image>
    ports:
      - "443:443"
    networks:
      - frontend

  backend:
    build: .
    networks:
      - frontend        # reachable by the proxy
      - backend         # can reach the data tier

  database:
    image: <database-image>
    networks:
      - backend         # invisible to anything on `frontend`
    volumes:
      - database_data:/var/lib/<database-data-dir>

networks:
  frontend:
  backend:
    internal: true      # no outbound connectivity at all

volumes:
  database_data:
```

```text
   internet ──► proxy ──[frontend]──► backend ──[backend]──► database
                                                              ▲
                        nothing on `frontend` can reach here ─┘
```

This is defence in depth expressed in six lines of YAML: even a fully compromised proxy has no network path to the database. `internal: true` additionally prevents the data tier from making outbound connections, which blocks a common exfiltration route.

### Connecting to an externally-created network

```yaml
networks:
  shared:
    external: true
    name: company-shared-net
```

Useful when several Compose projects — or a Compose project and a standalone container — must talk to each other. Compose will not create or delete it.

---

## 5. Debugging Compose networking

```bash
docker compose config                      # what will actually run
docker network ls                          # is the project network there?
docker network inspect <project>_default   # who is attached, with which IPs
docker compose exec backend getent hosts database    # does the name resolve?
docker compose exec backend nc -zv database 5432     # is the port reachable?
docker compose port backend 8080           # what host port is published
```

The ladder, in order:

```text
 1. Are the services in the same project and on the same network?
 2. Does the service NAME resolve? (not the container name, not an IP)
 3. Is the target listening on 0.0.0.0, not 127.0.0.1, inside its container?
 4. Is the port correct — the CONTAINER port, not the published host port?
 5. Is the target actually up and ready?  → docker compose logs, healthchecks
```

Point 4 deserves emphasis: with `ports: ["5433:5432"]`, other services still connect to <H>`database:5432`</H> — the container port. The host-side `5433` is irrelevant on the internal network, and using it is a very common mistake.

---

## Rapid-fire recall

1. What is `build: .` shorthand for?
2. What does `image:` mean when `build:` is also present?
3. Why might `docker compose up` run stale code, and what fixes it?
4. What does `docker compose watch` do that a bind mount does not?
5. What network does Compose create, and why does DNS work on it?
6. Give three reasons to use service names instead of IP addresses.
7. `ports: ["5433:5432"]` — what port do other services connect to?
8. Why is DNS round-robin under `--scale` not load balancing?
9. What does `internal: true` protect against?
10. Which two settings conflict with scaling a service?

<details>
<summary>Answers</summary>

1. `docker build -t <project>-<service> .` — context `.`, Dockerfile `./Dockerfile`.
2. It names the resulting image rather than pulling it, which is what lets you `compose push`.
3. `up` builds only when the image is missing locally; use `up --build` (or `compose build`).
4. It syncs changed files into the container without mounting the host directory over it, so the image's dependency tree is not shadowed, and it can trigger a rebuild for changes that need one.
5. A user-defined bridge named `<project>_default`; user-defined networks have Docker's embedded DNS, which resolves service names.
6. IPs change on every container recreate; start order affects assignment; and names work identically across machines and CI.
7. `database:5432` — the container port. The host-side 5433 is irrelevant on the internal network.
8. There is no health or load awareness, and client-side DNS caching often pins a client to one replica.
9. It removes outbound connectivity from that network, blocking a common data-exfiltration path and isolating the data tier.
10. `container_name` (names must be unique) and fixed host port publishing (a host port can be bound only once).

</details>

---

**Next:** [`depends_on`, Health Checks & Readiness](./24-compose-depends-on-and-health.md) — the difference between "started" and "ready", and why it causes flaky startups.
