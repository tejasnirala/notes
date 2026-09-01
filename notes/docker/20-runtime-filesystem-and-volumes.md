---
title: Runtime Filesystem & Volumes
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Runtime Filesystem & Volumes

> **What you will be able to do after this page**
>
> - Explain exactly what happens to data written inside a container, and when it disappears.
> - Choose between a named volume, a bind mount and tmpfs on the merits.
> - Predict what happens when you mount over a path that already has content.
> - Reason about volume lifecycle, backups and ownership.

---

## 1. The runtime filesystem

```text
   ┌──────────────────────────────────────────┐
   │  WRITABLE CONTAINER LAYER                │  ← per container, ephemeral
   ├──────────────────────────────────────────┤
   │  image layer N                           │
   │  …                                       │  ← read-only, shared by all
   │  image layer 1                           │     containers from this image
   └──────────────────────────────────────────┘
                    ⇅
   mounts punch through this stack entirely:
       volumes, bind mounts, tmpfs
```

Three properties of the writable layer:

1. **Ephemeral.** It is created at `docker create` and destroyed at `docker rm`. There is no recovery.
2. **Per container.** Two containers from the same image never see each other's writes.
3. **Slow for modifying existing files**, because of copy-up: writing one byte to an existing file first copies the whole file up from the read-only layer.

<H>A container's filesystem is not persistent. Treat every container as disposable and every write to it as temporary.</H>

What survives what:

| Event | Writable layer | Volume |
| :--- | :--- | :--- |
| Process crashes, container restarts | Survives | Survives |
| `docker stop` then `docker start` | Survives | Survives |
| `docker rm` | <C color="crimson">Destroyed</C> | Survives |
| `docker run` of a new container from the same image | Not present (a fresh layer) | Survives if attached |
| Image rebuild and redeploy | Not present | Survives |
| `docker compose down` | Destroyed (containers removed) | Survives |
| `docker compose down -v` | Destroyed | <C color="crimson">Destroyed</C> |

Which is why anything that must outlive a container — database files, uploaded content, generated reports, application state — must be written to a mount, not to the container filesystem.

---

## 2. Mount types

```text
   NAMED VOLUME          docker-managed storage, referenced by name
     -v app_data:/var/lib/app

   ANONYMOUS VOLUME      a volume with a generated name; created by `VOLUME` in a
                         Dockerfile or by `-v /path` with no source
     -v /var/lib/app

   BIND MOUNT            a specific host path mapped into the container
     -v /home/user/project:/app        (or -v "$(pwd)":/app)

   TMPFS MOUNT           memory-backed; never touches disk
     --tmpfs /tmp
```

### Named volumes

Docker manages the storage (under its data root; the exact location is an implementation detail you should not depend on).

- **Portable.** No dependency on host paths, so the same Compose file works on any machine.
- **First-use initialisation.** When an *empty* named volume is mounted over a path that has content in the image, <H>Docker copies the image's content into the volume</H>. This is why mounting a volume onto a database's data directory works out of the box — and why editing the image's files there afterwards has no effect, since the volume now shadows them.
- **Ownership** is taken from the image's directory at initialisation, which is the usual source of non-root permission problems ([see §16](./16-non-root-containers.md)).
- **Managed lifecycle:** `docker volume create|ls|inspect|rm|prune`.
- **Drivers** allow network storage (NFS, cloud block storage) behind the same interface.

### Bind mounts

A host path is mapped directly in. Changes are visible in both directions immediately.

- **The development workhorse** — this is what makes hot reload possible.
- **No initialisation copy.** A bind mount <C color="crimson">completely hides</C> whatever the image had at that path, even if the host directory is empty.
- **Host-dependent**, so a Compose file with absolute host paths is not portable.
- **Host ownership is preserved** and cannot be changed from inside, which causes permission friction with non-root containers.
- **Powerful and dangerous:** `-v /:/host` gives a root container the entire host filesystem. Mount narrowly, and use `:ro` whenever writes are not required.

### tmpfs

Memory-backed, never persisted, gone when the container stops.

- Correct for scratch space, and for anything sensitive that must not touch disk.
- Counts against the container's memory limit.
- The natural companion to a read-only root filesystem:

```bash
docker run --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m myimage
```

### Choosing

| Need | Use |
| :--- | :--- |
| Database files, uploads, any production state | **Named volume** (or a proper external/network volume) |
| Live source code for hot reload | **Bind mount** |
| Injecting a config file or certificate | **Bind mount, read-only** |
| Temporary or sensitive scratch data | **tmpfs** |
| Sharing data between containers | **Named volume** |
| Anything at all in production, if it must survive | <H>Not the container filesystem</H> |

---

## 3. Mount semantics you must know

**Mounts shadow image content.** The mount point is replaced by the mounted source. The image's files at that path still exist in the layers — they are simply not visible while something is mounted over them.

```text
   image:        /app/dist/index.html
   run with:     -v ./dist:/app/dist     (host ./dist is empty)
   container sees: an empty /app/dist    ← the image content is hidden, not deleted
```

**Only empty *named volumes* get the initialisation copy.** Bind mounts never do. A non-empty volume is never re-initialised.

**Nested mounts win by specificity.** A mount at `/app/node_modules` takes precedence over a mount at `/app`. That is the entire mechanism behind the dependency-directory trick in [Dev vs Prod](./18-dev-vs-prod.md).

**`:ro` and mount options:**

```bash
docker run -v config:/etc/app:ro …
docker run --mount type=bind,source="$(pwd)",target=/app,readonly …
```

The `--mount` syntax is more verbose and more explicit than `-v`; it is preferred in scripts and it fails loudly on typos, where `-v` silently creates a directory.

**Anonymous volumes accumulate.** `VOLUME` in a Dockerfile creates one on every `docker run` that does not supply a mount. They are invisible in normal workflows and consume disk until `docker volume prune`. This is the main reason to avoid `VOLUME` in Dockerfiles and declare volumes at run time instead.

---

## 4. Volumes in Compose

```yaml
services:
  database:
    image: <database-image>
    volumes:
      - database_data:/var/lib/<database-data-dir>   # named volume: persistent
      - ./init:/docker-entrypoint-initdb.d:ro        # bind mount, read-only

  api:
    build: .
    volumes:
      - ./src:/app/src                                # dev hot reload
      - uploads:/app/uploads                          # persistent user content

volumes:
  database_data:        # docker-managed; created on first `up`
  uploads:
```

Named volumes declared at the top level get a project-scoped name (`<project>_database_data`). Two consequences: different project directory names create *different* volumes, and renaming the directory appears to lose your data — it is still there, under the old name.

```bash
docker compose down       # removes containers and networks; KEEPS named volumes
docker compose down -v    # ALSO deletes named volumes → data is gone
```

<H>`down -v` is the command that destroys production data.</H> Learn the distinction before you need it.

---

## 5. Operating volumes

```bash
docker volume ls                          # what exists
docker volume inspect app_data            # driver, mountpoint, labels
docker volume rm app_data                 # remove (must be unused)
docker volume prune                       # remove ALL unused volumes — careful
docker ps -a --filter volume=app_data     # who is using it
```

**Backup and restore** — a volume is just a directory; mount it into a throwaway container:

```bash
# backup
docker run --rm -v app_data:/data -v "$(pwd)":/backup <minimal-image> \
  tar czf /backup/app_data.tar.gz -C /data .

# restore
docker run --rm -v app_data:/data -v "$(pwd)":/backup <minimal-image> \
  tar xzf /backup/app_data.tar.gz -C /data
```

For databases, prefer the engine's own dump tool over a filesystem copy of a running data directory — a tar of live database files is not guaranteed to be consistent.

**Inspecting content:**

```bash
docker run --rm -it -v app_data:/data <minimal-image> ls -la /data
```

### Production reality

A Docker volume lives on **one host**. That is fine for a single-server deployment and insufficient for a cluster: a container rescheduled onto another node will not find its data. Real answers are network or cloud block storage behind a volume driver, a managed database service, or object storage. <H>The strongest version of the rule: keep persistent state out of your application containers entirely.</H> Stateless application containers can be killed, rescheduled and scaled freely; stateful ones cannot.

---

## Rapid-fire recall

1. What is written where when a container writes a file, and when does it vanish?
2. Which survives `docker rm`: the writable layer or a named volume?
3. Why is writing to a large existing file in the writable layer slow?
4. What happens when you mount an empty named volume over a path with image content? And an empty bind mount?
5. Why does a mount at `/app/deps` beat a mount at `/app`?
6. Why do anonymous volumes accumulate, and where do they come from?
7. What ownership does a fresh named volume get, and what problem does that cause?
8. `docker compose down` vs `down -v`?
9. Why does renaming your project directory appear to lose Compose volume data?
10. Why is a Docker volume insufficient for a multi-node cluster?

<details>
<summary>Answers</summary>

1. Into the container's writable layer, unless the path is covered by a mount. It vanishes when the container is removed.
2. The named volume. The writable layer is destroyed.
3. Copy-up: overlayfs copies the entire file from the read-only layer into the writable layer before applying the write.
4. The named volume is initialised with a copy of the image's content; a bind mount performs no copy and hides the image content entirely.
5. Nested mounts are resolved by specificity — the deeper mount point takes precedence.
6. `VOLUME` in a Dockerfile, or `-v /path` with no source, creates one per container run; they are unnamed, easy to miss, and only removed by `docker volume prune`.
7. The ownership of the image's directory at that path — commonly `root:root`, which a non-root container process then cannot write to.
8. `down` removes containers and networks but keeps named volumes; `down -v` also deletes the volumes and their data.
9. Volume names are project-scoped, and the project name defaults to the directory name, so a rename references a different volume.
10. It is local to one host; a container rescheduled to another node cannot see it. Use network/cloud storage, a managed database, or object storage.

</details>

---

**Next:** [Docker Networking](./21-networking.md) — bridges, DNS, published ports, and what `localhost` means inside a container.
