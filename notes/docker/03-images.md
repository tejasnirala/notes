---
title: Docker Images
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Docker Images

> **What you will be able to do after this page**
>
> - Describe an image as it exists on disk: manifest, config, and layer blobs.
> - Explain exactly where the "blueprint / instance" analogy stops being true.
> - Say why a tag is not an identity and a digest is, and when to pin which.
> - Read a full image reference and know what every part of it means.

---

## 1. Definition

> **A Docker image is an immutable, content-addressed bundle of read-only filesystem layers plus a metadata configuration, identified by the digest of its manifest.**

Three words in that sentence carry all the weight:

- **Immutable** — an image never changes. Anything that looks like modification produces a *new* image.
- **Content-addressed** — its identity is derived from its bytes (a SHA-256 digest), not from a name someone assigned.
- **Configuration** — an image is not only files. Half of what it does at runtime comes from metadata.

---

## 2. What an image is on disk

An image is not a single file. It is a small graph of objects in a content store:

```text
  IMAGE MANIFEST  (application/vnd.oci.image.manifest.v1+json)
  ├── config      → sha256:a1b2…   the image config JSON
  └── layers      → [ sha256:11aa…,   layer blob (tar, usually gzip/zstd compressed)
                      sha256:22bb…,
                      sha256:33cc… ]

  IMAGE CONFIG JSON
  ├── architecture: "amd64"      os: "linux"
  ├── rootfs.diff_ids: [ … ]     the UNCOMPRESSED layer digests, in order
  ├── history: [ … ]             one entry per build step (the Dockerfile trail)
  └── config:
        ├── Env         ["PATH=…", "APP_ENV=production"]
        ├── Cmd         ["node", "server.js"]
        ├── Entrypoint  ["/usr/bin/tini", "--"]
        ├── WorkingDir  "/app"
        ├── User        "10001"
        ├── ExposedPorts{"8080/tcp":{}}
        ├── Volumes, Labels, StopSignal, Healthcheck
```

For multi-architecture images there is one more level: an **index** (or "manifest list") that maps each platform to its own manifest.

```text
  INDEX  sha256:deadbeef…            ← what `myapp:1.4.2` usually points at today
   ├── linux/amd64  → manifest sha256:aaa…
   ├── linux/arm64  → manifest sha256:bbb…
   └── linux/arm/v7 → manifest sha256:ccc…
```

This is why the same tag works on an ARM laptop and an x86 server, and why pulling on the wrong platform gives `no match for platform` rather than a broken binary.

---

## 3. Image contents vs image metadata

| | Contents (layers) | Metadata (config) |
| :--- | :--- | :--- |
| What | Files: binaries, libraries, runtime, app code, certs | `CMD`, `ENTRYPOINT`, `ENV`, `USER`, `WORKDIR`, `EXPOSE`, labels, healthcheck |
| Produced by | `RUN`, `COPY`, `ADD` | `ENV`, `CMD`, `ENTRYPOINT`, `USER`, `WORKDIR`, `EXPOSE`, `LABEL`, `HEALTHCHECK` |
| Occupies image size | Yes | Essentially no |
| Overridable at run time | No (only shadowed by mounts) | <C color="green">Yes — every one of them</C> |

<H>Metadata instructions are defaults, not guarantees.</H> `USER app` in the Dockerfile is undone by `docker run --user root`. `ENV LOG_LEVEL=info` is undone by `-e LOG_LEVEL=debug`. Security properties enforced only through image metadata are advisory; enforcement belongs to the runtime or orchestrator.

---

## 4. Image vs container

The standard analogy:

```text
   Image  =  class / blueprint / template        (definition, read-only, shared)
   Container = object / instance / building      (running, writable, disposable)
```

**Where it holds.** One image spawns many containers. Each container gets its own writable layer, its own namespaces, its own lifecycle. The image is unaffected by anything a container does.

**Where it breaks down** — and interviewers ask exactly this:

1. **A container is not "an image plus a process".** A stopped container still exists, with its writable layer intact. `docker ps -a` is full of containers with no process at all.
2. **The image is not copied.** Instances of a class each get their own memory; containers <C color="orange">share the very same read-only layers</C> on disk. Ten containers from a 900 MB image consume ~900 MB total, not 9 GB.
3. **A container can outgrow its image at runtime.** Volumes, bind mounts, tmpfs, injected environment and overridden commands mean the running thing may look quite different from the image.
4. **Inheritance is not what `FROM` does.** `FROM` is not subclassing — there is no dynamic dispatch and no link back to the parent. It is a *starting filesystem plus inherited config*, resolved once at build time. Rebuilding the parent does not change your image.

A more accurate one-liner: <H>an image is a frozen filesystem plus default settings; a container is a mutable, running (or stopped) delta on top of it.</H>

---

## 5. Naming: tags, digests, and full references

A complete reference:

```text
  registry.example.com:5000/team/service:1.4.2@sha256:9f86d0…
  └──────── registry ─────┘ └─ repo ────┘ └ tag ┘ └──── digest ────┘

  Defaults when parts are omitted:
    no registry  → docker.io          no namespace → library/  (official images)
    no tag       → :latest
```

So `nginx` means `docker.io/library/nginx:latest`.

### Tags

A tag is <H>a mutable, human-friendly pointer to a digest</H>. It can be moved at any time. Consequences:

- `myapp:1.4.2` today and `myapp:1.4.2` tomorrow may be different images. Nothing prevents a re-push.
- `:latest` is <C color="crimson">not "the newest version"</C>. It is the default tag name, applied when none is given. An abandoned repository can have a `latest` that is three years old.
- Deploying by mutable tag makes rollbacks unreliable and makes "which build is running?" unanswerable.

### Digests

A digest is the SHA-256 of the manifest. It is <H>immutable and self-verifying</H>: pull `@sha256:9f86d0…` and you provably get those exact bytes, from any registry, forever.

```bash
docker pull nginx@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f7b0b0e0e5a86c7b0e2f9c1d2e3
```

**Practical policy** — tags and digests are for different jobs:

| Context | Use |
| :--- | :--- |
| Developing locally | Tags — convenience wins |
| Dockerfile `FROM` in a serious pipeline | Tag *and* digest: `FROM node:20.11.1-bookworm@sha256:…` |
| Deploying to production | The digest your CI built and tested |
| Anything security- or compliance-sensitive | Digest, always |

Two distinct digests exist and get confused: the **manifest digest** (what `docker pull` and registries use, shown by `docker images --digests`) and the **image ID** (the digest of the *config* JSON, shown by `docker images`). They are different hashes of different objects; both are stable identifiers, but only the manifest digest is meaningful to a registry.

---

## 6. Base images and parent images

The terms are used loosely; the precise distinction:

- **Parent image** — the image named in your `FROM`. Your image is one layer set on top of it.
- **Base image** — strictly, an image with `FROM scratch` — nothing beneath it. Colloquially, "base image" means whatever you build on.

```text
scratch                     ← truly base: an empty filesystem, zero layers
   ↑
debian:bookworm-slim        ← a distro base image
   ↑
python:3.12-slim            ← official language image (parent = debian slim)
   ↑
mycompany/python-base:2     ← your hardened internal base
   ↑
mycompany/api:1.4.2         ← your application image
```

Every layer in that chain is in your image, and every CVE in that chain is your CVE. Choosing a parent is a long-term maintenance commitment, not a one-line decision — see [Base Image Selection](./12-base-images.md).

---

## 7. Immutability and reuse

**Immutability** means an image's bytes never change once created. `docker commit`, a rebuild, `docker tag`, `docker build --tag same:tag` — none of these mutate an image; they create a new one and possibly move a name.

This buys three things:

1. **Cacheability** — an unchanging object can be cached anywhere with no invalidation logic.
2. **Sharing** — layers are content-addressed, so identical layers are stored once and reused by every image and container that references them.
3. **Reproducible deployment** — a digest is a complete, verifiable description of what will run.

The reuse story, concretely:

```text
  python:3.12-slim   layers:  [ A ][ B ][ C ]
  service-a:1.0               [ A ][ B ][ C ][ D ][ E ]
  service-b:2.3               [ A ][ B ][ C ][ F ]
  service-c:0.9               [ A ][ B ][ C ][ G ][ H ]

  Disk:  A,B,C stored ONCE.  Pull of service-b: only F crosses the network.
```

<H>This is why standardising your organisation on one base image is worth more than shaving 20 MB off each image individually.</H> Shared layers mean faster pulls, less disk, less registry traffic, and one place to patch a CVE.

---

## 8. Distribution and registries

A registry is a content-addressable store speaking the OCI Distribution spec over HTTP. `docker push` and `docker pull` are the client side of it.

```text
  docker build ──► local image store ──push──► REGISTRY ──pull──► other hosts
                                                 │
                        Docker Hub · GHCR · ECR · GCR/Artifact Registry ·
                        Azure ACR · Harbor · a plain `registry:2` container
```

The mechanics that matter operationally:

- **Blobs are deduplicated by digest.** Pushing an image whose layers already exist uploads nothing for them — the registry replies "already present". This is why the second push of a large image is fast.
- **Pulls are per-layer and parallel.** Only missing layers are fetched, which is the whole reason for keeping your frequently-changing content in *small, late* layers.
- **`docker pull` verifies digests.** Corruption and tampering in transit are detected.
- **Registries are a production dependency.** If your deploy pulls at container start and the registry is unreachable, you cannot scale up. Mirrors, pull-through caches and pre-pulled nodes exist for this reason.
- **Registries hold your CVEs.** Image scanning, signing (cosign/Notary), retention policies and immutable-tag settings all live at this layer.

---

## Rapid-fire recall

1. What are the three kinds of object that make up an image in a registry?
2. Where do `CMD` and `ENV` live — in a layer, or somewhere else?
3. Ten containers run from one 900 MB image. Roughly how much disk do the image layers consume?
4. Give two ways the "image is a class, container is an object" analogy misleads.
5. Is `:latest` the newest image? Explain.
6. What is the difference between an image ID and a manifest digest?
7. Expand the reference `redis` into its full canonical form.
8. Why does pushing a rebuilt image usually upload far less than its total size?
9. What is the difference between a base image and a parent image, strictly speaking?
10. Why is standardising on a shared internal base image an efficiency win beyond aesthetics?

<details>
<summary>Answers</summary>

1. A manifest (optionally under a multi-platform index), a config JSON, and the layer blobs.
2. In the image config JSON — metadata, not files. They cost no meaningful image size and can all be overridden at run time.
3. About 900 MB. The read-only layers are shared; each container adds only its own writable layer.
4. Any two: a container exists without running; layers are shared rather than copied per instance; run-time overrides and mounts make the container diverge from the image; `FROM` is not inheritance — there is no live link to the parent.
5. No. It is just the default tag name. It points wherever it was last pushed, which may be very old.
6. The image ID is the digest of the config JSON (local identity); the manifest digest is the digest of the manifest (registry identity, what `@sha256:` refers to).
7. `docker.io/library/redis:latest`.
8. Layers are content-addressed and deduplicated; the registry already has every unchanged layer, so only new blobs are uploaded.
9. A base image has `FROM scratch` — nothing below it. A parent image is whatever your `FROM` names. Colloquially the terms are merged.
10. Shared layers are stored once, pulled once per host, and patched in one place — saving disk, network and CVE-remediation effort across every service.

</details>

---

**Next:** [Image Layers](./04-image-layers.md) — the union filesystem, why deleting a file can *increase* image size, and where caching comes from.
