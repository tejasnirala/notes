---
title: depends_on, Health Checks & Readiness
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# `depends_on`, Health Checks & Readiness

> **What you will be able to do after this page**
>
> - State exactly what `depends_on` guarantees — and what it does not.
> - Write a health check that measures readiness rather than liveness.
> - Explain why application-level retries are required even with perfect health checks.
> - Distinguish liveness, readiness and startup probes.

---

## 1. The distinction that causes the bug

```text
   CONTAINER CREATED
          ↓
   PROCESS RUNNING          ← this is all `depends_on` (default) waits for
          ↓
   APPLICATION INITIALISED  ← config parsed, migrations applied, caches warmed
          ↓
   DEPENDENCIES CONNECTED   ← database, cache, message broker reachable
          ↓
   READY TO SERVE TRAFFIC   ← this is what you actually need
```

<H>Container started ≠ service ready.</H> A database container's process starts in milliseconds; the database may not accept connections for another 10–30 seconds while it initialises storage, replays logs, and runs first-time setup.

---

## 2. What `depends_on` actually does

```yaml
services:
  backend:
    depends_on:
      - database
      - cache
```

This guarantees exactly two things:

1. `database` and `cache` containers are **started before** `backend` is started.
2. On `docker compose down`, they are stopped **after** `backend`.

It guarantees <C color="crimson">nothing about readiness</C>. Compose starts the database container, sees a running process, and immediately starts the backend — which tries to connect and gets `connection refused`.

```text
   t=0.0   database container starts
   t=0.1   database process is running          ← depends_on is satisfied
   t=0.1   backend starts, connects → ECONNREFUSED, crash
   t=8.0   database finishes initialising and starts accepting connections
```

This is the origin of the "run `docker compose up` twice and it works" folklore: the second run finds the database already initialised.

### The conditions form

Modern Compose can gate on more:

```yaml
services:
  backend:
    depends_on:
      database:
        condition: service_healthy      # wait for the healthcheck to pass
      cache:
        condition: service_started      # the old behaviour (default)
      migrations:
        condition: service_completed_successfully   # a one-shot job must exit 0
```

| Condition | Waits for |
| :--- | :--- |
| `service_started` | The container to start (the default; weak) |
| `service_healthy` | The service's `healthcheck` to report healthy |
| `service_completed_successfully` | A one-shot container to exit with code 0 |

`service_healthy` is what people wanted from `depends_on` all along — and it requires the dependency to define a `healthcheck`. `service_completed_successfully` is the clean way to run migrations before the application starts.

Add `restart: true` to have Compose restart the dependent service when its dependency is restarted:

```yaml
    depends_on:
      database:
        condition: service_healthy
        restart: true
```

---

## 3. Health checks

```yaml
services:
  database:
    image: <database-image>
    healthcheck:
      test: ["CMD-SHELL", "<command that returns 0 only when ready>"]
      interval: 10s        # how often to probe
      timeout: 5s          # how long a probe may take before it counts as failed
      retries: 5           # consecutive failures before "unhealthy"
      start_period: 30s    # grace window: failures here don't count toward retries
```

Or in a Dockerfile:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD <probe> || exit 1
```

The probe is executed **inside the container** by the runtime; exit code 0 means healthy, anything else means unhealthy. States are `starting` → `healthy` / `unhealthy`.

### Writing a good one

A health check should answer *"can I serve a request right now?"*, not *"is my process alive?"*.

| Check | Verdict |
| :--- | :--- |
| Process is running | <C color="crimson">Useless</C> — the runtime already knows that |
| TCP port is open | Weak — the socket may be listening before the app can serve |
| HTTP endpoint returns 200 | Good baseline |
| Endpoint verifies the database connection | Better for readiness |
| Endpoint runs a full end-to-end transaction | <C color="crimson">Too heavy</C> — expensive, and it makes a dependency's blip your outage |

Guidance that keeps this balanced:

- **Check what this service needs to serve, not the health of the whole world.** If your health check fails because a downstream cache is slow, every replica goes unhealthy at once and you have converted a degradation into an outage.
- **Keep it cheap.** It runs every `interval`, on every replica, forever.
- **Set `start_period` generously.** Without it, a slow-starting application is marked unhealthy and restarted before it ever finishes booting — a restart loop caused entirely by the probe.
- **Use tools that exist in the image.** A distroless image has no shell and no `curl`; ship a tiny health-check binary or use a runtime-native probe. `CMD-SHELL` requires a shell.

---

## 4. Why application-level retries are still required

Even with perfect health checks, <H>your application must handle its dependencies being unavailable at any moment</H>. Startup ordering solves exactly one instant in time; the rest of the container's life is unprotected.

Things that happen after a successful start:

- The database restarts for a failover or a patch.
- A network partition drops connections.
- The cache is evicted or restarted.
- A dependency is redeployed.
- A connection pool's connections go stale.

So the correct shape is:

```text
   on start and on every dependency operation:
     attempt to connect
     on failure:
       retry with EXPONENTIAL BACKOFF + jitter
       cap the delay (e.g. 30s) and the total attempts where appropriate
       log clearly which dependency is failing
     if a required dependency is unavailable at start-up beyond the budget:
       exit non-zero  → let the orchestrator restart and back off
```

Backoff with **jitter** matters: without it, every replica retries in lockstep and hammers a recovering dependency in synchronised waves — the thundering-herd problem.

This makes `depends_on` a convenience rather than a correctness mechanism. <H>Ordering is a nicety; resilience is the requirement.</H> In Kubernetes there is no `depends_on` at all, precisely because the platform assumes applications tolerate dependency unavailability.

The one legitimate exception is a **one-shot job that must run first** — database migrations, for example — which is what `service_completed_successfully` expresses:

```yaml
  migrations:
    image: myorg/backend:1.4.2
    command: ["<migration-command>"]
    depends_on:
      database:
        condition: service_healthy
    restart: "no"

  backend:
    depends_on:
      migrations:
        condition: service_completed_successfully
```

---

## 5. Liveness, readiness, startup

Orchestrators separate three questions that Docker's single `healthcheck` conflates:

| Probe | Question | Failure action |
| :--- | :--- | :--- |
| **Startup** | Has it finished booting? | Keep waiting; suppress the other probes |
| **Readiness** | Can it serve traffic *right now*? | Remove from load balancing; do **not** restart |
| **Liveness** | Is it irrecoverably broken? | Restart the container |

The distinction is operationally critical. A service that is temporarily unable to reach its database should <C color="orange">fail readiness</C> (stop receiving traffic, keep running, keep retrying) — not fail liveness, which would restart it and lose in-flight work and warm caches for no benefit.

Practical rules:

- **Liveness should be nearly trivial** — a process-internal check that the event loop or main thread is not wedged. Never check dependencies in a liveness probe.
- **Readiness should check dependencies** the service genuinely requires to serve.
- **Startup probes protect slow starters** from both of the others.

Compose has only `healthcheck`, which behaves like a readiness probe for `depends_on` gating. Write it as a readiness check, and remember that when you move to an orchestrator the three probes must be split apart.

Finally, the misconception to name: <C color="crimson">"a running container means the application is healthy."</C> It means PID 1 has not exited. It may be deadlocked, out of connections, thrashing, or serving 500s to every request. Health is something you must define and measure explicitly.

---

## Rapid-fire recall

1. What exactly does plain `depends_on` guarantee?
2. Why does "run `compose up` twice and it works" happen?
3. Name the three `depends_on` conditions and what each waits for.
4. What does `service_healthy` require of the dependency?
5. Why is checking a downstream dependency in your health check sometimes harmful?
6. What problem does `start_period` solve?
7. Why are application retries required even with perfect health checks?
8. Why does backoff need jitter?
9. Liveness vs readiness: which one restarts the container, and which one should check dependencies?
10. What does a "running" container actually tell you?

<details>
<summary>Answers</summary>

1. Start ordering (dependencies start first) and stop ordering (they stop last). Nothing about readiness.
2. The first run starts the app before the database has finished initialising; by the second run the database is already up.
3. `service_started` (container started, the default), `service_healthy` (its healthcheck passes), `service_completed_successfully` (a one-shot container exited 0).
4. That it defines a `healthcheck`; without one the condition cannot be satisfied.
5. A blip in that dependency marks every replica unhealthy simultaneously, turning a degradation into a full outage.
6. It gives a slow-starting application a grace window during which failing probes do not count, preventing a restart loop.
7. Ordering only covers the start-up instant; dependencies restart, fail over and become unreachable throughout the container's life.
8. Without jitter every replica retries in lockstep, hammering a recovering dependency in synchronised waves.
9. Liveness restarts the container and should be trivial; readiness removes the instance from load balancing and is where dependency checks belong.
10. Only that PID 1 has not exited. It may be deadlocked, saturated, or failing every request.

</details>

---

**Next:** [Compose Configuration, Ports & Volumes](./25-compose-config-ports-volumes.md) — environment variables, `.env`, publishing, and persistence.
