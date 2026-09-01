---
title: Docker Fundamentals
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Docker Fundamentals

> **What you will be able to do after this page**
>
> - Say precisely what a container *is* at the operating-system level, without using the word "lightweight VM".
> - Name the four kinds of isolation a container gets, and which one is *not* isolation at all.
> - Explain what is inside an image and — more importantly — what is deliberately *not* inside it.
> - Trace a container through its full lifecycle and know which transitions destroy state.

---

## 1. What Docker actually provides

Docker is not one thing. It is a <H>packaging format, a build system, a distribution mechanism, and a runtime</H>, bundled behind a single CLI. Those four jobs are worth separating in your head from the start, because production problems almost always live in exactly one of them:

```text
  PACKAGING        an image format: layered filesystem + metadata
  BUILDING         Dockerfile → image, with a cache
  DISTRIBUTION     push/pull images through a registry, by tag or digest
  RUNTIME          start a process with isolated namespaces + cgroups
```

The thing Docker solved was never "running a process". Linux could already do that. What it solved was <C color="orange">the gap between the machine where software is built and the machine where it runs</C> — the "works on my machine" class of failure. Docker's answer: stop shipping the application and hoping the target host has the right runtime, libraries and configuration. Ship <H>the application together with its entire userspace</H>, as one addressable, versioned, immutable artifact.

---

## 2. What a container really is

A container is <H>an ordinary process on the host, started with a restricted view of the system</H>. There is no container "thing" in the Linux kernel — no `container` syscall, no container object. A container is a *composition* of pre-existing kernel features:

| Kernel feature | What it restricts | The illusion it creates |
| :--- | :--- | :--- |
| **Namespaces** | What the process can *see* | "I am alone on this machine" |
| **cgroups** | What the process can *consume* | "I have this much CPU and RAM" |
| **Union filesystem** (overlayfs) | What the process reads/writes | "I have my own root filesystem" |
| **Capabilities / seccomp / LSM** | What the process is *allowed to do* | "I am root, but a weak root" |

Run a container and then run `ps aux` **on the host**: you will see the process, with a normal host PID, owned by a normal host UID. That is the single most clarifying experiment in all of Docker.

```text
HOST
├── systemd (PID 1)
├── dockerd
├── containerd ── shim ── nginx   ← PID 8412 on the host
│                          ↑         PID 1 *inside its own PID namespace*
└── sshd
```

<H>Same kernel. Same process table. Different view.</H>

### Interview definition

> A container is a process (or process tree) isolated by Linux namespaces and constrained by cgroups, running on top of a union-mounted filesystem assembled from image layers. It shares the host kernel; it does not virtualize hardware.

---

## 3. The four isolations

### 3.1 Process isolation — the PID namespace

Each container gets its own PID namespace. The first process inside becomes <C color="orange">PID 1 of that namespace</C>, and processes in the namespace cannot see or signal processes outside it.

```text
inside the container          on the host
  PID 1  app                    PID 8412  app
  PID 14 worker                 PID 8459  worker
                                PID 1     systemd   ← invisible from inside
```

This has a consequence people meet the hard way: PID 1 has special signal semantics in Linux, so *which* process becomes PID 1 changes how your container reacts to `docker stop`. That is important enough to have [its own page](./17-pid1-and-signals.md).

### 3.2 Filesystem isolation — mount namespace + union filesystem

The container gets its own mount namespace and its root is a union mount of the image's read-only layers plus one writable layer. `/etc/passwd` inside the container is *not* the host's `/etc/passwd`. Nothing on the host filesystem is visible unless you explicitly mount it in.

### 3.3 Network isolation — the network namespace

Each container gets its own network stack: its own interfaces, its own routing table, its own iptables rules, <H>and its own loopback interface</H>. That last clause is the entire reason `localhost` behaves the way it does inside containers — covered in [Networking](./21-networking.md).

### 3.4 Resource "isolation" — cgroups

The honest word here is <C color="crimson">limitation, not isolation</C>. cgroups cap how much CPU time, memory, block I/O and PIDs a container may consume. They do not partition hardware — the container is competing for the same physical CPUs as everything else on the host. Without explicit limits, <H>a container can consume every resource on the machine</H>. Limits are opt-in:

```bash
docker run --memory=512m --cpus=1.5 --pids-limit=200 myapp
```

Note also what cgroups historically did **not** do: many runtimes read `/proc/cpuinfo` or `nproc` and see the *host's* CPU count, not the container's limit — which is why a runtime may spawn 64 worker threads inside a container limited to 1 CPU. See [Workers & Concurrency](./19-workers-and-concurrency.md).

---

## 4. Container vs virtual machine

The comparison everyone reaches for, drawn accurately:

```text
        VIRTUAL MACHINES                        CONTAINERS

  ┌─────────┬─────────┬─────────┐        ┌─────────┬─────────┬─────────┐
  │  App A  │  App B  │  App C  │        │  App A  │  App B  │  App C  │
  ├─────────┼─────────┼─────────┤        ├─────────┼─────────┼─────────┤
  │  libs   │  libs   │  libs   │        │  libs   │  libs   │  libs   │
  ├─────────┼─────────┼─────────┤        └────┬────┴────┬────┴────┬────┘
  │ Guest   │ Guest   │ Guest   │             │         │         │
  │ KERNEL  │ KERNEL  │ KERNEL  │        ┌────┴─────────┴─────────┴────┐
  ├─────────┴─────────┴─────────┤        │      Container runtime      │
  │        Hypervisor           │        ├─────────────────────────────┤
  ├─────────────────────────────┤        │       HOST KERNEL           │  ← ONE kernel
  │        Host kernel/HW       │        ├─────────────────────────────┤
  └─────────────────────────────┘        │        Hardware             │
                                         └─────────────────────────────┘
```

| | Virtual machine | Container |
| :--- | :--- | :--- |
| Isolation boundary | Hypervisor (hardware-level) | Kernel (syscall-level) |
| Kernel | Its own | <C color="orange">Shared with host</C> |
| Boot time | Tens of seconds | Milliseconds |
| Overhead per instance | Hundreds of MB–GB | Bytes to MB beyond the process |
| Can run a different OS kernel | Yes | No |
| Blast radius of a kernel exploit | One VM | Potentially the whole host |

**Where the "lightweight VM" phrase does real damage:** it makes people assume a container is a security boundary of the same strength as a VM. It is not. <H>A container escape is a kernel exploit away; a VM escape is a hypervisor exploit away, and the hypervisor's attack surface is far smaller.</H> That is why hostile-multi-tenant platforms run containers *inside* VMs (Firecracker, Kata, gVisor), rather than trusting namespaces alone.

### Why containers are lightweight — precisely

Three reasons, in order of importance:

1. **No guest kernel to boot.** Starting a container is `clone()` + `mount` + `execve`. There is no bootloader, no kernel init, no device probing.
2. **No pre-allocated memory.** A VM reserves its RAM up front. A container uses what its process touches.
3. **Layers are shared.** Ten containers from the same image share one on-disk copy of the read-only layers. Ten VMs from the same template have ten disk images.

---

## 5. What is inside an image

An image contains <H>everything above the kernel that the application needs</H>, and nothing below it:

```text
  ┌───────────────────────────────────────────┐
  │  Application code / compiled binary       │  your artifact
  ├───────────────────────────────────────────┤
  │  Application dependencies                 │  libraries pulled by a package manager
  ├───────────────────────────────────────────┤
  │  Language runtime / interpreter / VM      │  only if the app needs one
  ├───────────────────────────────────────────┤
  │  System libraries (libc, libssl, zlib…)   │  the userspace ABI the binary links against
  ├───────────────────────────────────────────┤
  │  Base OS userland (shell, coreutils, CA   │  optional — some images have none
  │  certificates, timezone data)             │
  ├───────────────────────────────────────────┤
  │  Image metadata (CMD, ENV, USER, ports,   │  not files — configuration
  │  labels, architecture)                    │
  └───────────────────────────────────────────┘
  ═════════════════ NOT IN THE IMAGE ═════════════════
       Kernel · device drivers · init system · host config
```

Two entries deserve emphasis because they cause most real bugs:

- **System libraries.** Your binary is dynamically linked against a specific C library. An image built against glibc will not run on a musl-only base image, and vice versa. This is the root of the whole "Alpine broke my build" genre — see [Base Images](./12-base-images.md).
- **Metadata.** `CMD`, `ENTRYPOINT`, `ENV`, `USER`, `WORKDIR`, `EXPOSE` and labels are stored in the image *config JSON*, not as files. They are defaults the runtime applies, and every one of them can be overridden at `docker run` time.

**Configuration is the interesting omission.** Environment-specific configuration should *not* be baked in — an image containing a production database URL cannot be promoted from staging to production, which defeats the point of having an immutable artifact. See [Runtime Configuration](./14-runtime-configuration.md).

---

## 6. The container lifecycle

```text
             docker create                docker start
   [image] ─────────────────► [created] ─────────────────► [running]
                                                            │  ▲   │
                                       docker pause ────────┘  │   └──────── docker stop
                                                    ▼          │                 │
                                                 [paused] ──────┘                ▼
                                                  unpause                    [exited]
                                                                              │    ▲
                                                                docker rm ────┘    └──── docker start
                                                                    ▼                     (state SURVIVES)
                                                                [removed]
                                                          writable layer DESTROYED
```

The transitions that matter:

| Transition | Command | What happens to the writable layer |
| :--- | :--- | :--- |
| created → running | `docker start` | Created on first start |
| running → exited | `docker stop` (SIGTERM, then SIGKILL after a grace period) | <C color="green">Preserved</C> |
| exited → running | `docker start` | <C color="green">Preserved</C> — a stopped container is not a dead one |
| any → removed | `docker rm` | <C color="crimson">Destroyed permanently</C> |

`docker run` is not a primitive: it is `create` + `start`, and with `--rm` it appends an automatic `rm` on exit.

<H>A container "dies" when its main process exits.</H> There is no daemon keeping it alive. If your `CMD` starts a background service and returns, the container exits immediately — the classic "my container starts and stops right away" bug. The main process must stay in the foreground.

---

## 7. Why this shape is useful for deployment

Pulling the threads together, containers give deployment four properties that are hard to get otherwise:

1. **One artifact, all environments.** The same image digest runs on a laptop, in CI, in staging, in production. Only injected configuration differs. If it works in staging and fails in production, the difference is *not* the dependency tree.
2. **Immutability.** You do not patch a running container; you build a new image and replace the container. Rollback is "run the previous digest" instead of "undo whatever the last deploy script did".
3. **Density and speed.** Start-up in milliseconds and near-zero per-instance overhead is what makes autoscaling and rolling deploys practical.
4. **A uniform operational interface.** Every service — regardless of whether it is written in Go, Java, Python, Ruby or Rust — is started, stopped, logged, limited, health-checked and networked identically. <H>This uniformity, not size, is the real production payoff.</H>

The cost side, stated honestly: a weaker security boundary than a VM, a new layer of networking and storage to understand, images that rot if you never rebuild them, and a build system with its own cache semantics that you must learn — which is what most of these notes are about.

---

## Rapid-fire recall

1. Name the kernel mechanism responsible for each of: what a container can see, what it can consume, what it can do.
2. Is a container visible in the host's process table? Why does the answer matter?
3. Which of the four "isolations" is not really isolation?
4. Give two reasons a container starts faster than a VM.
5. What is in an image that is *not* a file?
6. Why can a binary built on Debian fail to start on an Alpine base image?
7. Does `docker stop` destroy the container's writable layer? Does `docker rm`?
8. Your container exits immediately after start with code 0. What is the most likely cause?
9. Why is "a container is a lightweight VM" dangerous rather than merely imprecise?

<details>
<summary>Answers</summary>

1. See → namespaces (PID, mount, network, UTS, IPC, user); consume → cgroups; do → capabilities, seccomp, and LSMs like AppArmor/SELinux.
2. Yes — with a normal host PID and UID. It matters because it makes concrete that there is no VM: `kill` from the host works, host `top` accounts for its CPU, and a kernel bug is a *host* problem.
3. cgroups. They limit consumption of shared hardware; they do not partition it. Without explicit limits a container can starve the whole host.
4. No guest kernel to boot, and no pre-allocated memory — starting a container is essentially `clone` + `mount` + `execve`.
5. The image config metadata: `CMD`, `ENTRYPOINT`, `ENV`, `USER`, `WORKDIR`, `EXPOSE`, labels, architecture.
6. Alpine uses musl libc; a glibc-linked binary has no dynamic loader to satisfy it. The kernel is shared, but the userspace ABI is not.
7. `docker stop` preserves it — a stopped container can be restarted with its filesystem intact. `docker rm` destroys it permanently.
8. The main process forked into the background and returned, or it was a one-shot command. A container lives exactly as long as its PID 1.
9. Because it implies VM-grade isolation. Namespaces are a kernel-level boundary, so one kernel vulnerability can cross it; that assumption leads to running untrusted code with root and no seccomp profile.

</details>

---

**Next:** [Docker Architecture](./02-docker-architecture.md) — what actually happens between typing `docker build` and getting an image, and why the daemon does far less of it than people think.
