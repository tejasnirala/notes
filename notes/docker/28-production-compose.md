---
title: Production Compose Architecture
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Production Compose Architecture

> **What you will be able to do after this page**
>
> - Say honestly where Compose is sufficient in production and where it is not.
> - Structure a hardened single-host deployment: proxy, tiers, limits, logging, secrets.
> - Split development and production configuration cleanly with override files.

---

## 1. Compose in production: the honest assessment

<H>Docker Compose is a single-host tool.</H> It is legitimate in production when that is genuinely enough.

**Reasonable:**

- Single-server deployments — internal tools, small products, staging environments.
- Applications whose availability requirement tolerates the host being a single point of failure.
- Edge or on-premise deployments where an orchestrator is not viable.
- CI environments spinning up a full stack for integration tests.

**Not reasonable:**

| Requirement | Why Compose falls short |
| :--- | :--- |
| Multiple hosts | No scheduling across machines |
| Autoscaling | No metric-driven scaling |
| Zero-downtime rolling updates | `up` recreates containers; there is no health-gated rollout |
| Self-healing | `restart:` restarts a container; it cannot reschedule off a dead host |
| Load balancing across replicas | DNS round-robin only, with no health awareness |
| Managed secrets with rotation and RBAC | File-based secrets, unencrypted at rest |
| Declarative reconciliation | `up` is imperative and one-shot |

The honest framing: <C color="orange">Compose describes a topology; an orchestrator maintains one.</C> If you need something to keep the system in a desired state without a human, you have outgrown Compose.

---

## 2. A production-shaped stack

```text
      internet
         │  443
   ┌─────▼─────────────────────────────────────────────┐
   │  proxy  (TLS termination, routing, rate limiting) │  network: frontend
   └─────┬─────────────────────────────────────────────┘
         │  8080 (internal only)
   ┌─────▼─────────────────────────────────────────────┐
   │  backend  × N replicas                            │  networks: frontend, backend
   └─────┬───────────────────────┬─────────────────────┘
         │                       │
   ┌─────▼──────┐         ┌──────▼─────┐
   │  database  │         │   cache    │                 network: backend (internal)
   └─────┬──────┘         └────────────┘
         │
    named volume (backed up)
```

```yaml
name: myapp

services:
  proxy:
    image: <reverse-proxy-image>:<pinned>
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./proxy/proxy.conf:/etc/proxy/proxy.conf:ro
      - certs:/etc/certs:ro
    networks: [frontend]
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
    logging: &logging
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  backend:
    image: registry.example.com/team/backend:${TAG:?TAG is required}
    # no `build:` in production — deploy a tested, pushed image by tag/digest
    environment:
      APP_ENV: production
      LOG_LEVEL: ${LOG_LEVEL:-info}
      DATABASE_URL: postgres://app@database:5432/app
      CACHE_URL: redis://cache:6379
      DB_PASSWORD_FILE: /run/secrets/db_password
    secrets: [db_password]
    networks: [frontend, backend]
    depends_on:
      database:
        condition: service_healthy
      cache:
        condition: service_started
    healthcheck:
      test: ["CMD", "<health-probe>", "http://localhost:8080/healthz"]
      interval: 15s
      timeout: 3s
      retries: 3
      start_period: 30s
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
        reservations:
          memory: 256M
    user: "10001:10001"
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    stop_grace_period: 30s
    restart: unless-stopped
    logging: *logging
    # NO published ports — only the proxy reaches it

  database:
    image: <database-image>:<pinned-version>
    environment:
      DB_USER: app
      DB_PASSWORD_FILE: /run/secrets/db_password
    secrets: [db_password]
    volumes:
      - database_data:/var/lib/<database-data-dir>
    networks: [backend]
    healthcheck:
      test: ["CMD-SHELL", "<readiness command>"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 60s
    deploy:
      resources:
        limits:
          memory: 2G
    stop_grace_period: 60s        # let it checkpoint and shut down cleanly
    restart: unless-stopped
    logging: *logging
    # NO published ports

  cache:
    image: <cache-image>:<pinned-version>
    command: ["<cache-server>", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    networks: [backend]
    deploy:
      resources:
        limits:
          memory: 320M
    restart: unless-stopped
    logging: *logging

networks:
  frontend:
  backend:
    internal: true                 # the data tier has no route out

volumes:
  database_data:
    external: true                 # `down -v` cannot destroy it
    name: myapp_database_data
  certs:
    external: true

secrets:
  db_password:
    file: /run/secrets/db_password    # provisioned outside the repository
```

### Why each production-specific choice

| Choice | Reason |
| :--- | :--- |
| `image:` with a pinned tag, no `build:` | Deploy the artifact CI built and tested; production is not a build machine |
| `${TAG:?...}` | Deploying without an explicit version fails loudly instead of silently using a default |
| Only the proxy publishes ports | Nothing else is reachable from the network |
| `internal: true` on the data tier | No outbound path from database or cache |
| `deploy.resources.limits` | One service cannot starve the host; OOM is contained to a container |
| `user`, `read_only`, `cap_drop`, `no-new-privileges` | Least privilege at run time |
| `stop_grace_period` | Graceful shutdown that the default 10s would truncate |
| `logging` options | The default `json-file` driver grows unbounded and fills the disk |
| `external: true` volumes | `down -v` cannot delete production data |
| `secrets` as files | Not visible in `docker inspect` or the process environment |
| `healthcheck` everywhere | Makes `depends_on: service_healthy` and `up --wait` meaningful |
| `restart: unless-stopped` | Survives daemon restarts and reboots, but respects a deliberate stop |

The YAML anchor (`&logging` / `*logging`) is worth adopting: it keeps repeated blocks consistent and honest.

---

## 3. Development and production from one base

```text
   compose.yaml            shared definition: services, networks, volumes
   compose.override.yaml   development (loaded automatically)
   compose.prod.yaml       production (named explicitly)
```

```yaml
# compose.override.yaml — development only
services:
  backend:
    build:
      context: .
      target: development
    volumes:
      - ./src:/app/src
      - /app/<dependency-dir>
    environment:
      LOG_LEVEL: debug
    ports:
      - "8080:8080"        # direct access, bypassing the proxy
      - "9229:9229"        # debugger
    user: "0:0"            # convenience in dev only
    read_only: false
  database:
    ports:
      - "127.0.0.1:5432:5432"   # local inspection, loopback only
```

```bash
docker compose up -d --build                                # dev (override applied)
docker compose -f compose.yaml -f compose.prod.yaml up -d    # production
docker compose -f compose.yaml -f compose.prod.yaml config   # verify before deploying
```

Always run `config` before a production `up` — it is the only way to see exactly what the merge produced.

---

## 4. Operating it

**Deployment** on a single host is roughly:

```bash
export TAG=1.4.2
docker compose -f compose.yaml -f compose.prod.yaml pull
docker compose -f compose.yaml -f compose.prod.yaml up -d --wait
```

Note the gap this leaves: <H>`up -d` recreates containers, which means a brief outage per service.</H> Compose has no health-gated rolling update. Mitigations: run two replicas behind the proxy and recreate them one at a time by hand, or accept the gap for services where it is tolerable. If it is not tolerable, that is the signal to move to an orchestrator.

**Backups** are your responsibility, and volumes are not backups. Use the database's own dump tool on a schedule, store copies off the host, and <C color="crimson">test a restore</C> — an untested backup is a hypothesis.

**Monitoring** — Compose gives you `ps`, `logs`, `top` and `stats`, and nothing else. Production needs log shipping to somewhere central, metrics and alerts, and an uptime check that exercises a real request path. Health checks tell Docker about a container; they do not tell you the service is working.

**Updates** — rebuild and redeploy images regularly for base-image security patches, and pin versions so updates are deliberate rather than accidental.

---

## 5. When to move on

Signals that Compose has stopped fitting:

```text
   · you need more than one host
   · a deploy's downtime gap has become unacceptable
   · you are writing shell scripts to restart replicas one at a time
   · you need autoscaling
   · you are hand-rolling service discovery or secret rotation
   · a single host's failure is no longer an acceptable outcome
```

The migration path is usually Compose → Kubernetes (or a managed container platform). The concepts transfer directly — images, volumes, networks, environment, health checks, resource limits are all the same ideas with different syntax. <H>Everything in these notes remains true; only the layer that maintains the desired state changes.</H>

---

## Rapid-fire recall

1. Give three production requirements Compose cannot satisfy.
2. Why should a production Compose file use `image:` rather than `build:`?
3. Which services should publish ports in the production stack, and which must not?
4. What does `internal: true` protect against?
5. Why mark data volumes `external: true`?
6. What happens without `logging` options on the default driver?
7. Why is `stop_grace_period: 60s` reasonable for a database?
8. What is the downtime characteristic of `compose up -d` on an existing stack?
9. Why is `docker compose config` important before a production deploy?
10. Name three signals that you have outgrown Compose.

<details>
<summary>Answers</summary>

1. Any three: multi-host scheduling, autoscaling, health-gated rolling updates, self-healing/rescheduling, real load balancing, managed secret rotation with RBAC, declarative reconciliation.
2. Production should run the exact artifact CI built and tested; building on the production host reintroduces variability and makes the deployed image unverified.
3. Only the reverse proxy. The backend, database and cache must not be reachable from outside the host.
4. It removes outbound connectivity from the data tier's network, blocking exfiltration and limiting lateral movement.
5. So `docker compose down -v` cannot delete them.
6. The `json-file` driver grows without bound and eventually fills the host's disk.
7. Databases need time to checkpoint, flush and close connections cleanly; the 10s default would truncate that with SIGKILL.
8. Containers are recreated, so there is a brief outage per service — Compose has no health-gated rolling update.
9. It shows the fully merged, substituted configuration, which is the only reliable way to confirm what will actually run.
10. Any three: needing more than one host, unacceptable deploy downtime, hand-rolled restart scripting, autoscaling needs, manual service discovery or secret rotation, single-host failure being unacceptable.

</details>

---

**Next:** [Production Image Optimization](./29-image-optimization.md) — the full checklist, in priority order.
