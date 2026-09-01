---
title: Docker Architecture
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Docker Architecture

> **What you will be able to do after this page**
>
> - Trace a command from your keyboard to a running process, naming every component it passes through.
> - Explain why "the Docker daemon does everything" was true in 2015 and is wrong today.
> - Say what BuildKit is, why it replaced the legacy builder, and what it changed about builds.
> - Reason about *where* a given failure lives: client, API, daemon, builder, or runtime.

---

## 1. The conceptual model

Start with the model you should give in an interview when asked "how does Docker work?":

```text
   Developer
       ↓            types a command
   Docker CLI       parses it, builds an HTTP request
       ↓            
   Docker API       REST over a Unix socket (/var/run/docker.sock) or TCP
       ↓
   Docker Engine / daemon (dockerd)
       ↓
   ┌───────────┬───────────┬───────────┬───────────┐
   │   BUILD   │    RUN    │  NETWORK  │  VOLUME   │
   └───────────┴───────────┴───────────┴───────────┘
```

This is correct as a *model*. It is not the implementation. The implementation matters as soon as you debug something real, so both are covered here — separately and labelled.

---

## 2. The components

### 2.1 Docker CLI (the client)

The `docker` binary is <H>a thin HTTP client, nothing more</H>. It parses arguments, resolves the build context, packages requests, and renders the streamed responses. It holds no state, has no images, and cannot start a process.

The most useful consequence: <C color="orange">the client and the daemon do not have to be on the same machine</C>. `DOCKER_HOST=ssh://server docker ps` runs the client on your laptop against a remote engine. Docker Desktop on macOS and Windows is exactly this — a native CLI talking to a daemon inside a Linux VM.

> **Correcting a common claim:** "the Docker CLI builds the image". It does not. It archives the build context and sends it to the builder. The build happens daemon-side. This is why a build with a 4 GB context is slow before a single instruction runs — those bytes are being transferred over the socket.

### 2.2 Docker API

A versioned REST API. Everything the CLI does is an API call, which is why Docker has clients in every language and why Compose, Testcontainers and CI systems drive Docker without shelling out.

```bash
curl --unix-socket /var/run/docker.sock http://localhost/v1.43/containers/json
```

<H>Access to the Docker socket is equivalent to root on the host.</H> Anyone who can call this API can run a container that bind-mounts `/` and mounts the host filesystem read-write. That is why "just mount the docker socket into the container" is a security decision, not a convenience.

### 2.3 Docker Engine / daemon (`dockerd`)

The engine is the long-running server: it implements the API, manages images, containers, networks and volumes, wires up logging drivers, and delegates the actual work downward. In the classic mental model, this is where everything happens.

### 2.4 The runtime layer — what actually starts processes

Modern Docker delegates. `dockerd` does not create containers itself:

```text
  dockerd                 API, images, networks, volumes, build orchestration
     │  gRPC
     ▼
  containerd              container lifecycle, image pull/unpack, snapshotters
     │
     ▼
  containerd-shim         one per container; keeps it alive across daemon restarts,
     │                    owns stdio and reports the exit code
     ▼
  runc                    OCI runtime: sets up namespaces + cgroups, execve()s,
                          then EXITS — it does not stay running
```

Two facts fall out of this diagram that are worth memorising:

1. **`runc` is not a supervisor.** It configures the isolation and hands control to your process, then exits. There is no per-container daemon babysitting your app; the shim only holds stdio and the exit status.
2. **Restarting `dockerd` does not kill your containers.** Because the shims own them, `systemctl restart docker` leaves running containers alive. This surprises people who assume containers are children of the daemon.

Everything here is standardised by the **OCI** (Open Container Initiative): the *image spec* (what an image is on disk) and the *runtime spec* (how to run a bundle). That standardisation is why Podman, containerd, and Kubernetes' CRI can consume images built by Docker without any Docker code involved.

### 2.5 BuildKit — the modern builder

Since Docker 23, `docker build` uses **BuildKit** by default. Legacy builder mental models are the source of a lot of stale advice, so treat this as its own component:

```text
  docker build / docker buildx
        │
        ▼
   BuildKit frontend      parses the Dockerfile into an LLB graph
        │                 (Low Level Build definition — a DAG, not a list)
        ▼
   BuildKit solver        walks the DAG, checks cache, executes only what is needed
        │
        ▼
   snapshots / layers     content-addressed results
```

What BuildKit changed, concretely:

| Legacy builder | BuildKit |
| :--- | :--- |
| Executes instructions strictly top to bottom | Builds a <C color="orange">dependency graph</C> and executes only reachable nodes |
| Sequential stages | Independent stages run <C color="orange">in parallel</C> |
| Unused stages still built | Unused stages are skipped entirely |
| Whole context uploaded up front | Context transferred <C color="orange">incrementally, on demand</C> |
| Every instruction produced a layer, always | Layers still produced, but caching is content-based and richer |
| No secret support | `RUN --mount=type=secret` — secrets never land in a layer |
| No persistent build caches | `RUN --mount=type=cache` — package caches survive across builds |
| Local cache only | Cache export/import to a registry (`--cache-from`, `--cache-to`) |

`buildx` is the CLI plugin exposing BuildKit's fuller feature set: multiple *builder instances* (local, remote, in a container), multi-platform builds (`--platform linux/amd64,linux/arm64`), and cache backends.

---

## 3. The full flow, for real

`docker build -t app .`:

```text
1. CLI      resolves the Dockerfile, applies .dockerignore, prepares to send context
2. CLI      POST /build (or a BuildKit session) over the socket
3. BuildKit parses the Dockerfile → LLB DAG
4. BuildKit for each node: compute cache key → hit? reuse : execute in a sandbox
5. BuildKit pulls base images it does not have (through containerd's content store)
6. BuildKit writes new layers as content-addressed blobs, assembles the image config
7. daemon   registers the image and applies the tag `app:latest`
8. CLI      renders the streamed progress and exits
```

`docker run -p 8080:80 app`:

```text
1. CLI      POST /containers/create, then POST /containers/{id}/start
2. dockerd  resolves the image; if absent, pulls it
3. dockerd  allocates the network endpoint: veth pair, bridge attachment, IP, iptables DNAT for -p
4. dockerd  prepares mounts: volumes, bind mounts, tmpfs
5. dockerd  hands an OCI spec to containerd
6. containerd unpacks the union filesystem (image layers + a new writable layer) and starts a shim
7. shim     invokes runc → namespaces, cgroups, capabilities, seccomp → execve(your CMD)
8. runc     exits; your process is now PID 1 in its namespace
9. dockerd  streams stdout/stderr into the configured logging driver
```

Being able to place a failure on this timeline is most of container debugging:

| Symptom | Component to suspect |
| :--- | :--- |
| `Cannot connect to the Docker daemon` | Client ↔ socket: daemon down, or permissions |
| Build is slow before any step runs | Context transfer — see [Build Context](./07-build-context.md) |
| `no match for platform` | Builder/registry: image has no build for your architecture |
| `exec format error` | Wrong architecture image, or a script missing its shebang |
| Container exits instantly, code 127 | Runtime: the command does not exist in the image |
| Port unreachable from host | Network layer: publishing, not the app |
| Data gone after `docker rm` | Storage: writable layer, not a volume |

---

## 4. Where the simple model breaks down

Be able to state both of these:

> **Conceptual model (fine for interviews and 90% of reasoning):** the CLI talks to the daemon over an API; the daemon builds images, runs containers, and manages networks and volumes.
>
> **Implementation (needed when debugging):** the CLI is a thin API client; `dockerd` orchestrates but delegates; builds are executed by BuildKit as a parallel DAG; container lifecycle is `containerd` + a per-container shim; isolation setup is `runc`, which exits immediately; and all of it conforms to OCI specs so the pieces are swappable.

Saying "the daemon does absolutely everything" will get you three things wrong in practice: you will expect a daemon restart to kill containers, you will reason about builds as a strict top-to-bottom sequence, and you will not know where to look when a build hangs.

---

## Rapid-fire recall

1. Where does the image build actually execute — client side or daemon side?
2. Why can `docker` on your Mac control containers that are really running in a Linux VM?
3. Name the three processes below `dockerd` in the runtime chain and what each is for.
4. `runc` is running for as long as my container is running — true or false?
5. What happens to running containers when you restart the Docker daemon, and why?
6. Give three things BuildKit does that the legacy builder could not.
7. What is LLB?
8. Why is granting access to `/var/run/docker.sock` a privilege escalation?
9. What does the OCI specify, and why does that matter to Kubernetes?

<details>
<summary>Answers</summary>

1. Daemon side, in BuildKit. The client only prepares and streams the build context and renders progress output.
2. Because the CLI is just an HTTP client over a socket; the engine can live anywhere the socket can be reached.
3. `containerd` (lifecycle, image content, snapshots), `containerd-shim` (one per container; owns stdio and exit status, keeps the container alive independently of the daemon), `runc` (applies the OCI runtime spec: namespaces, cgroups, capabilities, then `execve`).
4. False. It sets up isolation, `execve`s your process, and exits.
5. They keep running, because the shims — not the daemon — are their parents.
6. Any three of: parallel stage execution, skipping unreachable stages, incremental context transfer, `--mount=type=cache`, `--mount=type=secret`, registry-backed cache import/export, multi-platform builds.
7. Low Level Build definition — the content-addressable DAG that BuildKit compiles a Dockerfile into and then solves.
8. Because the API lets you start a privileged container that bind-mounts the host filesystem, which is equivalent to root on the host.
9. The image spec (on-disk image format) and the runtime spec (how to run a bundle). It is why Kubernetes can drop Docker entirely and still run images that Docker built.

</details>

---

**Next:** [Docker Images](./03-images.md) — what the artifact actually is: a config JSON, a manifest, and a pile of content-addressed blobs.
