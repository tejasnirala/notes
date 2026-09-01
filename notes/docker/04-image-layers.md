---
title: Image Layers
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Image Layers

> **What you will be able to do after this page**
>
> - Explain what a layer physically is, and what "immutable" means for one.
> - Describe how overlayfs assembles a container's root filesystem out of stacked layers.
> - Explain copy-up and whiteouts — and therefore why `RUN rm -rf` in a later layer can *grow* the image.
> - Distinguish the *visible* filesystem from the *stored* bytes, which is the single most misunderstood idea in Docker.

---

## 1. What a layer is

> **A layer is a tar archive of the filesystem changes produced by one build step** — the files added, the files modified, and markers for the files deleted, relative to the layer beneath it.

Not a snapshot of the whole filesystem. <H>A diff.</H> If a step touches one 2 KB file, the layer is roughly 2 KB, no matter how large the filesystem is.

Each layer is stored as a content-addressed blob, so its digest *is* its identity. Two layers with identical content are the same layer everywhere in the world.

```text
  RUN apt-get install -y curl
        ↓ produces
  layer = { added:    /usr/bin/curl, /usr/lib/x86_64-linux-gnu/libcurl.so.4, …
            modified: /var/lib/dpkg/status, …
            deleted:  (whiteout entries, if any) }
```

### What "immutable" means

Once written, a layer's bytes are never altered. A later build step cannot reach back and edit an earlier layer. This is not a policy choice — <C color="orange">the layer's digest is derived from its content, so changing it would make it a different layer</C>, invalidating every image and cache entry that references it.

Every consequence in this page follows from that one fact.

---

## 2. Stacking: the union filesystem

A container's root filesystem is a **union mount** — several directories overlaid so they appear as one. Docker's default driver on Linux is `overlay2`, which uses the kernel's overlayfs.

```text
  ┌──────────────────────────────────────────────┐
  │  CONTAINER WRITABLE LAYER   (upperdir)       │  ← read-write, per container
  ├──────────────────────────────────────────────┤ ←── the "merged" view is what
  │  layer 4:  COPY . /app                       │      your process actually sees
  ├──────────────────────────────────────────────┤
  │  layer 3:  RUN <package-manager> install     │  ← read-only image layers
  ├──────────────────────────────────────────────┤      (lowerdirs), SHARED across
  │  layer 2:  WORKDIR /app  (metadata only)     │      every container from this image
  ├──────────────────────────────────────────────┤
  │  layer 1:  base image filesystem             │
  └──────────────────────────────────────────────┘
```

Resolution rule: **top-most wins**. Reading `/app/config.json` searches downward and returns the first hit. A file in layer 4 shadows the same path in layer 1 — <H>the lower copy is still stored on disk, just invisible</H>.

overlayfs terminology, so the diagrams elsewhere make sense:

| Term | Meaning |
| :--- | :--- |
| `lowerdir` | The read-only layers, stacked |
| `upperdir` | The single writable layer |
| `workdir` | Scratch space overlayfs needs for atomic operations |
| `merged` | The unified view mounted as the container's `/` |

---

## 3. The writable container layer

At `docker create`, a new empty writable layer is added on top. It is:

- **Per container.** Two containers from one image never see each other's writes.
- **Ephemeral.** `docker rm` deletes it. There is no recovery.
- **Slower for writes** than a real filesystem, because of copy-up.

### Copy-on-write and copy-up

Modifying an existing file that lives in a read-only layer triggers a **copy-up**:

```text
  Process opens /var/lib/app/data.db for writing
        │
        ├─ file found in layer 2 (read-only)
        ├─ overlayfs copies the ENTIRE file up into the writable layer
        └─ the write is applied to the copy

  Cost: a 1 KB write to a 4 GB file first copies 4 GB.
```

Two production consequences:

1. **Never run a database on the container's writable layer.** Copy-up on large files is pathological, and the data dies with the container. Use a volume — see [Runtime Filesystem & Volumes](./20-runtime-filesystem-and-volumes.md).
2. **Write-heavy workloads want a volume or tmpfs mount**, which bypasses the union filesystem entirely and writes at native speed.

Creating a *new* file is cheap: it goes straight into the writable layer with no copy-up.

---

## 4. Deletion: whiteouts, and the size trap

You cannot delete a file from a read-only layer. So overlayfs records a **whiteout**: a marker in the upper layer meaning "this path is gone".

```text
  layer 1:  /tmp/build-cache/  (400 MB)
  layer 2:  RUN rm -rf /tmp/build-cache
            ↓
            layer 2 contains a whiteout entry (a few bytes)

  VISIBLE filesystem:  /tmp/build-cache does not exist       ✅
  STORED image bytes:  400 MB in layer 1 + whiteout in 2     ❌ image got BIGGER
```

<H>Deleting a file in a later layer never removes its bytes from an earlier layer. It only hides it — and adds a little.</H>

This is the mechanism behind the rule "create and delete in the same layer", which has [its own page](./11-package-manager-caches.md#4-create-and-delete-in-the-same-layer).

It is also a **security** issue, not just a size issue. A secret copied in one layer and deleted in the next is <C color="crimson">still in the image and still extractable</C>, because anyone with the image can unpack the layer blobs directly:

```bash
docker save myimage:tag -o img.tar   # then untar and read every layer
```

No `docker run` is needed, so no `USER`, no whiteout, and no filesystem permission protects you.

---

## 5. Visible filesystem vs stored layers

Hold these two views apart permanently:

```text
  VISIBLE (merged view)                STORED (what you ship and pull)
  what your process sees               sum of all layer blobs
  after shadowing + whiteouts          nothing ever removed from a lower layer
  ─────────────────────────            ─────────────────────────
  `du -sh /` inside container          `docker image history` / registry size
```

They can differ enormously. An image whose `du` reports 200 MB can easily be a 1.4 GB pull if intermediate steps created and deleted large artifacts.

Diagnose the gap with:

```bash
docker image history myimage:tag     # size per build step — find the fat layer
docker image inspect myimage:tag     # RootFS.Layers, config
docker system df -v                  # what is actually consuming disk
```

---

## 6. Reuse, sharing, and distribution efficiency

Because layers are content-addressed and immutable, the same blob serves everyone:

```text
  Host disk
  ┌──────────────────────────────────────────────────────┐
  │  [A] debian base       ← used by 12 images           │
  │  [B] runtime installed ← used by 7 images            │
  │  [C] api deps          ← used by api:1.0, api:1.1    │
  │  [D] api:1.0 code      [E] api:1.1 code              │
  └──────────────────────────────────────────────────────┘
  Deploying api:1.1 when api:1.0 is present → pull only [E].
```

This is the payoff and the design constraint at once:

- **Efficient distribution.** Only missing layers cross the network. A code-only change should be a small pull.
- **Efficient storage.** Shared bases are stored once per host.
- **It only works if you order your Dockerfile correctly.** Put frequently-changing content *last*, or every rebuild produces a new fat layer that must be pushed and pulled in full.

Note that layer sizes on the wire are *compressed* blobs, while on-disk they are extracted — so registry size and `docker images` size legitimately differ.

---

## 7. Which instructions create layers

```dockerfile
FROM <runtime-base>            # the parent's layers come along
WORKDIR /app                   # metadata only
COPY dependency-manifest .     # ← layer: the manifest file
RUN <package-manager> install  # ← layer: the whole installed dependency tree
COPY . .                       # ← layer: application source
```

Roughly: <H>`RUN`, `COPY` and `ADD` create filesystem layers; everything else writes metadata.</H> `ENV`, `WORKDIR`, `USER`, `CMD`, `ENTRYPOINT`, `EXPOSE`, `LABEL`, `ARG` change the image config and contribute effectively nothing to size. (In legacy Docker these still appeared as zero-byte "empty layers" in history; with BuildKit they are config changes and cache-graph nodes.)

Why this ordering is the canonical one:

```text
  changes rarely  →  base image           ┐
                     dependency manifest  │ cached across almost every build
                     dependency install   ┘ ← the expensive step, protected
  changes often   →  application source   ← cheap layer, rebuilt constantly
```

If source were copied before the install, <C color="crimson">every one-character code edit would invalidate the dependency installation</C> and re-download the whole tree. The full treatment is in [Build Cache](./09-build-cache.md).

### A BuildKit caveat, stated honestly

The "one instruction = one permanent layer, exactly as written" model is a good approximation but not literally true today. BuildKit compiles the Dockerfile into a DAG; results are content-addressed snapshots, empty steps do not produce blobs, `--mount=type=cache` directories are *never* committed into any layer, and multi-stage stages that nothing copies from produce no layers in the final image at all. The *final image* is still an ordered list of layers, and reasoning per instruction still works — just do not treat it as a physical law.

---

## Rapid-fire recall

1. Is a layer a filesystem snapshot or a diff? Why does the answer matter for size?
2. Why can't a later layer modify an earlier one?
3. What are `lowerdir`, `upperdir` and `merged`?
4. Explain copy-up, and give a workload where it is a serious performance problem.
5. What is a whiteout, and what does it do to image size?
6. A secret was `COPY`d in step 3 and `rm`'d in step 4. Is the image safe? How would an attacker get it?
7. Two images share a 700 MB base and differ by 5 MB. How much disk on a host holding both?
8. Which Dockerfile instructions produce filesystem layers?
9. Why must frequently-changing content go into late layers?
10. In what ways is "one instruction = one layer" an approximation under BuildKit?

<details>
<summary>Answers</summary>

1. A diff — only the changes from one step. That is why a step touching one small file yields a tiny layer regardless of total filesystem size.
2. Layers are content-addressed and immutable; altering one would change its digest and break every image, cache entry and container referencing it.
3. The read-only image layers, the single writable container layer, and the unified view mounted as the container's root.
4. Writing to a file that exists in a read-only layer copies the whole file into the writable layer first. Databases and any large-file random writes suffer badly — use a volume.
5. A marker in an upper layer that hides a path from lower layers. It removes nothing: the image grows slightly.
6. Not safe. `docker save` (or pulling and unpacking the layer blobs) exposes the deleted file directly; whiteouts and file permissions are irrelevant to that.
7. About 705 MB — the base is stored once.
8. `RUN`, `COPY`, `ADD`. The rest are metadata/config changes.
9. So that a change to them invalidates only a small late layer, leaving expensive earlier layers cached, small to push, and small to pull.
10. BuildKit builds a DAG rather than a strict sequence; metadata instructions are config nodes, not blobs; cache mounts are never committed; unreferenced stages produce nothing in the final image.

</details>

---

**Next:** [The Dockerfile](./05-dockerfile.md) — every instruction that matters, and the ones people get subtly wrong.
