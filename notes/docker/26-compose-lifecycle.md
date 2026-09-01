---
title: Compose Lifecycle Commands
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Compose Lifecycle Commands

> **What you will be able to do after this page**
>
> - Use each lifecycle command knowing its side effects, especially the destructive ones.
> - Choose between `restart`, `up`, `up --build` and `up --force-recreate` correctly.
> - Read logs and status across a whole application.

---

## 1. `up`

```bash
docker compose up            # foreground: starts everything, streams logs, Ctrl-C stops
docker compose up -d         # detached: starts and returns
docker compose up -d api     # only this service (and its depends_on chain)
```

What `up` does, in order:

```text
   1. read and merge Compose files; resolve ${VAR} substitution
   2. create the project network(s) if missing
   3. create named volumes if missing
   4. build images for services with `build:` — ONLY if the image is absent
   5. pull images that are missing locally
   6. create and start containers in dependency order
   7. (foreground) attach to and stream all logs
```

<H>Step 4 is the one that surprises people:</H> `up` does not rebuild when your source or Dockerfile has changed. It only builds when the image does not exist.

Useful flags:

| Flag | Effect |
| :--- | :--- |
| `-d` | Detached |
| `--build` | Always rebuild services that declare `build` |
| `--force-recreate` | Recreate containers even if configuration is unchanged |
| `--no-deps` | Do not start linked services |
| `--wait` | Block until services are healthy (or a timeout) — <C color="green">excellent in CI</C> |
| `--pull always` | Re-pull images |
| `--scale svc=N` | Run N replicas of a service |
| `--remove-orphans` | Remove containers for services no longer in the file |

In the foreground, **Ctrl-C sends SIGTERM** to the containers and stops them (a second Ctrl-C kills). It does not remove them — that is `down`.

---

## 2. `down`

```bash
docker compose down          # stop + remove containers and the project network
docker compose down -v       # ALSO remove named volumes  ← DESTROYS DATA
docker compose down --rmi all         # also remove images
docker compose down --remove-orphans  # also remove containers not in the file
docker compose down -t 30    # allow 30s for graceful shutdown before SIGKILL
```

| Removed by | Containers | Network | Named volumes | Images |
| :--- | :--- | :--- | :--- | :--- |
| `stop` | No (stopped only) | No | No | No |
| `down` | <C color="crimson">Yes</C> | <C color="crimson">Yes</C> | No | No |
| `down -v` | Yes | Yes | <C color="crimson">Yes</C> | No |
| `down --rmi all` | Yes | Yes | No | <C color="crimson">Yes</C> |

<H>`down -v` is irreversible and unprompted.</H> Everything on the [volumes page](./20-runtime-filesystem-and-volumes.md) about backups and `external: true` exists because of this command.

---

## 3. `ps`, `logs`, `exec`, and friends

```bash
docker compose ps                    # services in THIS project, with state and ports
docker compose ps -a                 # including stopped ones
docker compose ps --format json      # machine-readable
```

```bash
docker compose logs                  # all services, interleaved, colour-coded by service
docker compose logs -f               # follow
docker compose logs -f backend       # one service
docker compose logs --tail=100 -f    # last 100 lines, then follow
docker compose logs --since=10m      # recent only
docker compose logs -t               # timestamps
```

Interleaved, per-service-coloured logs are one of Compose's most useful features when debugging a startup ordering problem — you can see the backend's connection failure next to the database's initialisation messages.

```bash
docker compose exec backend sh       # a shell in a RUNNING container
docker compose exec -T backend <cmd> # no TTY — for scripts
docker compose run --rm backend <cmd>  # a NEW throwaway container
```

`exec` vs `run` matters:

| | `exec` | `run` |
| :--- | :--- | :--- |
| Target | An existing running container | A new container |
| Requires the service to be up | Yes | No |
| Ports published | Already published | <C color="orange">Not, unless `--service-ports`</C> |
| Typical use | Debugging a live service, opening a shell | One-off tasks: migrations, a REPL, tests |

Add `--rm` to `run` or you will accumulate stopped containers.

---

## 4. Start, stop, restart

```bash
docker compose stop          # SIGTERM, then SIGKILL after the grace period; keeps containers
docker compose start         # start existing stopped containers
docker compose restart       # stop + start — SAME container, SAME image
docker compose pause/unpause # freeze/resume processes (SIGSTOP-based)
docker compose kill          # SIGKILL immediately, no grace period
```

The distinction that causes confusion:

```text
   restart  →  same container, same image, same environment
               ⚠ does NOT pick up Compose file changes or a new image

   up       →  recreates the container IF its configuration changed
               ✅ picks up Compose file changes

   up --build → also rebuilds the image first
               ✅ picks up source and Dockerfile changes
```

<H>If your change is not taking effect, you almost certainly needed `up --build` and used `restart`.</H>

---

## 5. Build, pull, push, config

```bash
docker compose build                 # build all services that declare `build`
docker compose build --no-cache api  # ignore the cache for one service
docker compose pull                  # pull images for services using `image:`
docker compose push                  # push built images (requires `image:` names)
docker compose config                # print the fully merged, resolved configuration
docker compose config --services     # list service names
docker compose images                # images in use by this project
docker compose top                   # running processes per service
docker compose port backend 8080     # which host port maps to this container port
docker compose watch                 # sync/rebuild automatically on file changes
docker compose cp backend:/app/x .   # copy files out of (or into) a container
```

`docker compose config` deserves repeating: it resolves substitution, merges override files, and applies defaults, so it answers "why is this variable empty?" and "which file won?" definitively.

---

## 6. Everyday sequences

```bash
# start work
docker compose up -d --build
docker compose logs -f backend

# after changing source (with a bind mount and a watcher, nothing is needed;
# otherwise:)
docker compose up -d --build backend

# after changing the Compose file
docker compose up -d                 # recreates only what changed

# run a one-off task
docker compose run --rm backend <migration-command>

# inspect a running service
docker compose exec backend sh

# tear down, keeping data
docker compose down

# full reset INCLUDING data (be certain)
docker compose down -v --remove-orphans

# CI: start, wait for health, test, tear down
docker compose up -d --wait
<run the test suite>
docker compose down -v
```

That last block is the pattern that makes Compose genuinely valuable in CI: `--wait` blocks until every service with a health check is healthy, which removes the sleep-and-hope step from integration tests.

### Disk housekeeping

```bash
docker system df                     # where disk is going
docker compose down -v               # this project's data
docker system prune                  # dangling images, stopped containers, unused networks
docker system prune -a --volumes     # ⚠ everything unused, including volumes
docker builder prune                 # build cache only
```

<C color="crimson">`docker system prune -a --volumes` deletes data.</C> It is a fine command on a laptop that has run out of disk and a dangerous one on a server.

---

## Rapid-fire recall

1. Does `docker compose up` rebuild after you edit the Dockerfile?
2. Difference between `stop`, `down`, and `down -v`?
3. What does Ctrl-C do in a foreground `up`?
4. `restart` vs `up` vs `up --build` — which picks up what?
5. `exec` vs `run` — when do you need each?
6. Why add `--rm` to `compose run`?
7. What does `--wait` do, and why is it valuable in CI?
8. Which command answers "why is this environment variable empty?"
9. Which prune command can destroy data?

<details>
<summary>Answers</summary>

1. No. It builds only when the image is missing; use `up --build`.
2. `stop` leaves containers in place; `down` removes containers and the network; `down -v` also deletes named volumes and their data.
3. Sends SIGTERM to the containers and stops them; it does not remove them.
4. `restart` reuses the same container and image; `up` recreates containers whose configuration changed; `up --build` also rebuilds the image, picking up source and Dockerfile changes.
5. `exec` runs in an already-running container (debugging a live service); `run` creates a new throwaway container for one-off tasks and works even when the service is not up.
6. Otherwise every invocation leaves a stopped container behind.
7. It blocks until services with health checks report healthy, replacing arbitrary sleeps in integration test pipelines.
8. `docker compose config`.
9. `docker system prune -a --volumes` — and `docker compose down -v` for the project's own volumes.

</details>

---

**Next:** [Compose Reference](./27-compose-reference.md) — a lookup table for the service-level keys.
