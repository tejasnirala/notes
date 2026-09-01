---
title: Debugging & Inspection
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Debugging & Inspection

> **What you will be able to do after this page**
>
> - Reach for the right command for each class of problem instead of guessing.
> - Diagnose the five common failures: container won't start, image too big, build too slow, no network, data lost.

---

## 1. The command map

| Question | Command |
| :--- | :--- |
| What images do I have? | `docker images` |
| What is running? | `docker ps` (add `-a` for stopped) |
| Why did it stop? | `docker logs`, `docker inspect … .State` |
| What is inside the image? | `docker run --rm -it <img> sh`, `docker image history` |
| What is this container's full configuration? | `docker inspect <container>` |
| What is it doing right now? | `docker stats`, `docker top` |
| Where did my disk go? | `docker system df -v` |
| What is on this network? | `docker network inspect` |
| What is in this volume? | `docker run --rm -v vol:/d <img> ls -la /d` |
| What changed in the container filesystem? | `docker diff <container>` |

---

## 2. Listing and inspecting

```bash
docker images                        # local images: repo, tag, ID, size
docker images --digests              # with manifest digests
docker images -f dangling=true       # untagged layers taking up space

docker ps                            # running
docker ps -a                         # all, including exited — with exit codes
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
docker ps -f status=exited -f name=api

docker inspect <container|image>     # the complete JSON: config, mounts, network, state
docker inspect <c> --format '{{.State.ExitCode}}'
docker inspect <c> --format '{{json .Config.Env}}'
docker inspect <c> --format '{{json .Mounts}}'
docker inspect <c> --format '{{json .NetworkSettings.Networks}}'
docker inspect <c> --format '{{.HostConfig.Memory}}'
```

`docker inspect` is the answer to almost every "what is it actually configured with?" question — <H>especially when the answer differs from what the Dockerfile or Compose file says</H>, which is exactly when it matters.

```bash
docker image history --no-trunc --human myimage:tag   # size per build step
docker image inspect myimage:tag --format '{{json .RootFS.Layers}}'
docker diff <container>              # A=added, C=changed, D=deleted vs the image
```

`docker diff` is underused: it shows precisely what a running container has written, which finds unexpected writes to the writable layer that should have gone to a volume.

---

## 3. Logs

```bash
docker logs <container>
docker logs -f <container>              # follow
docker logs --tail=100 -f <container>
docker logs --since=10m <container>
docker logs -t <container>              # timestamps

docker compose logs -f                  # all services, interleaved
docker compose logs -f backend
```

Two things to know:

- Docker captures **stdout and stderr of PID 1 only**. An application logging to a file inside the container produces <C color="crimson">no `docker logs` output at all</C> — which is why "log to stdout" is a container rule, not a preference.
- The default `json-file` driver grows unbounded. Set `max-size` and `max-file`, or ship logs elsewhere.

---

## 4. Getting inside

```bash
docker exec -it <container> sh          # a shell in a RUNNING container
docker exec -it <container> bash        # if bash exists
docker exec <container> env             # its actual environment
docker exec <container> ps -ef          # is the app really PID 1?
docker exec -u root -it <container> sh  # as root, when the app runs non-root

docker run --rm -it <image> sh          # explore the IMAGE, not a container
docker run --rm -it --entrypoint sh <image>   # when ENTRYPOINT gets in the way
```

**For a container that will not stay up**, `exec` is useless — there is nothing to attach to. Override the command instead:

```bash
docker run --rm -it --entrypoint sh <image>
docker compose run --rm --entrypoint sh backend
```

**For minimal images with no shell**, attach a debug container to the same namespaces:

```bash
docker debug <container>                                  # Docker Desktop
docker run --rm -it --pids-limit=-1 --network container:<c> <tools-image> sh
kubectl debug -it <pod> --image=<tools-image> --target=<container>   # Kubernetes
```

```bash
docker cp <container>:/app/logs/app.log ./     # pull a file out
docker cp ./fix.conf <container>:/etc/app/     # push one in (debugging only)
```

---

## 5. Resources and disk

```bash
docker stats                       # live CPU, memory, network, block I/O per container
docker stats --no-stream           # one snapshot
docker top <container>             # processes inside, as seen from the host

docker system df                   # images / containers / volumes / build cache
docker system df -v                # itemised
docker builder prune               # build cache only
docker image prune                 # dangling images
docker system prune                # containers, networks, dangling images
docker system prune -a --volumes   # ⚠ everything unused, INCLUDING VOLUMES
```

In `docker stats`, memory is shown against the container's limit — the number to watch for an OOM kill. Exit code **137** plus `"OOMKilled": true` in `docker inspect` is the signature of a memory-limit kill, distinct from a `SIGKILL` after a stop timeout (also 137, but without the OOM flag).

---

## 6. Networking and volumes

```bash
docker network ls
docker network inspect <net>              # subnet, gateway, containers, IPs
docker port <container>                   # published mappings
docker exec <c> getent hosts <service>    # does the name resolve?
docker exec <c> nc -zv <service> <port>   # is the port reachable?

docker volume ls
docker volume inspect <vol>
docker run --rm -it -v <vol>:/data <minimal-image> ls -la /data
docker ps -a --filter volume=<vol>        # who uses it
```

---

## 7. Five failures, diagnosed

### 7.1 The container exits immediately

```bash
docker ps -a                                   # look at the exit code
docker logs <container>
docker inspect <c> --format '{{.State.ExitCode}} {{.State.Error}} {{.State.OOMKilled}}'
```

| Exit code | Meaning | Usual cause |
| :--- | :--- | :--- |
| 0 | Clean exit | The main process finished — a one-shot command, or it forked to the background |
| 1 | Application error | Read the logs; often missing configuration |
| 125 | Docker itself failed | Bad `docker run` flags |
| 126 | Command not executable | Missing execute bit, or a bad shebang |
| 127 | Command not found | Typo, or the binary is not in this image (a frequent multi-stage mistake) |
| 137 | SIGKILL | OOM kill (check `OOMKilled`) or a stop-timeout kill |
| 139 | SIGSEGV | Segfault — often an architecture or libc mismatch |
| 143 | SIGTERM | Stopped, handled correctly |

<H>Exit 0 immediately after start almost always means the process backgrounded itself.</H> Run the application in the foreground.

### 7.2 The image is far too big

Follow [chapter 29](./29-image-optimization.md): `docker image history` first, then `du` inside the container, then act on the largest contributor.

### 7.3 The build is slow

`docker build --progress=plain` and find the first non-`CACHED` step. Check context transfer size. See [chapter 10](./10-cache-invalidation.md).

### 7.4 Services cannot reach each other

```text
 1. Same network?          docker network inspect <net>
 2. Name resolves?         docker exec <c> getent hosts <service>
 3. Port reachable?        docker exec <c> nc -zv <service> <port>
 4. Bound to 0.0.0.0?      check the app's configuration, not the network
 5. Using the CONTAINER port, not the published host port?
 6. Target actually ready? docker logs / healthcheck status
```

Roughly half of these turn out to be [`localhost` inside a container](./21-networking.md#3-localhost-inside-a-container) or a `127.0.0.1` bind.

### 7.5 Data disappeared

```bash
docker volume ls                       # does the volume exist?
docker inspect <c> --format '{{json .Mounts}}'   # was it actually mounted?
docker diff <container>                # is the app writing to the writable layer?
```

Causes, in order of frequency: no volume was mounted (data went to the writable layer and died with the container); `docker compose down -v` was run; the project directory was renamed so a *different* project-scoped volume is now in use; or a bind mount shadowed the path.

---

## 8. Command reference

```bash
# build & run
docker build . -t <image>[:tag]
docker build . --target <stage> -t <image>
docker run -it <image>
docker run -d --name <name> -p <host>:<container> <image>
docker run --rm -it --entrypoint sh <image>

# lifecycle
docker start|stop|restart|kill|pause|unpause <container>
docker rm <container>            # add -f to force a running one
docker rmi <image>

# listing
docker images
docker ps            /  docker ps -a
docker volume ls     /  docker network ls

# ports, volumes, networks
docker run -p 8080:80 <image>
docker volume create <vol>
docker run -v <vol>:/path <image>              # named volume
docker run -v "$(pwd)":/app <image>            # bind mount (hot reload)
docker network create <net>
docker run --network <net> --name <svc> <image>

# inspection
docker logs -f <container>
docker exec -it <container> sh
docker inspect <container|image>
docker image history <image>
docker stats / docker top <container>
docker system df -v

# registry
docker login / docker tag <img> <registry>/<repo>:<tag> / docker push / docker pull

# compose
docker compose up -d --build
docker compose ps / logs -f / exec <svc> sh
docker compose down          # keeps volumes
docker compose down -v       # DELETES volumes
```

> Docker's official cheat sheet: [docker_cheatsheet.pdf](https://docs.docker.com/get-started/docker_cheatsheet.pdf)

---

## Rapid-fire recall

1. Your app logs to a file. Why does `docker logs` show nothing?
2. Exit code 127 — what happened?
3. Exit code 137 — what two distinct causes, and how do you tell them apart?
4. A container exits with 0 immediately. What is the usual cause?
5. Which command shows what a running container has written?
6. How do you get a shell in an image whose container will not stay up?
7. How do you debug a distroless container with no shell?
8. Which command shows per-build-step image size?
9. Which command answers "was the volume actually mounted?"
10. Give the first three steps of the network diagnostic ladder.

<details>
<summary>Answers</summary>

1. Docker captures only PID 1's stdout and stderr; file logs never reach the driver. Log to stdout.
2. The command was not found in the image — a typo, or a binary that never made it into the final stage of a multi-stage build.
3. SIGKILL: either an OOM kill (`docker inspect` shows `OOMKilled: true`) or a stop-timeout kill after the grace period, where the flag is false.
4. The main process forked into the background and returned; a container lives exactly as long as its PID 1.
5. `docker diff <container>`.
6. `docker run --rm -it --entrypoint sh <image>` (or `docker compose run --rm --entrypoint sh <service>`).
7. Attach a tools container to its namespaces — `docker debug`, `--network container:<c>`, or `kubectl debug` with `--target`.
8. `docker image history --no-trunc --human`.
9. `docker inspect <c> --format '{{json .Mounts}}'`.
10. Same network? Does the service name resolve? Is the port reachable from the source container?

</details>

---

**Next:** [Common Misconceptions](./32-misconceptions.md) — every claim in these notes that needed correcting, in one place.
