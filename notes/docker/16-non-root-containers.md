---
title: Non-Root Containers
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Non-Root Containers

> **What you will be able to do after this page**
>
> - Explain why container root is host root, and why isolation is not a defence.
> - Write the build-time-root / run-time-non-root pattern correctly, including ownership.
> - Handle the practical obstacles: ports below 1024, writable paths, volume ownership.
> - Know what else to drop besides UID 0.

---

## 1. The default and why it is dangerous

Unless told otherwise, a container runs as **root, UID 0**. Not a special "container root" — <H>the same UID 0 the host kernel knows</H>. The user namespace is not enabled by default in Docker, so there is no remapping: UID 0 inside is UID 0 outside.

What follows from that:

```text
   1. A bind-mounted host directory is writable BY HOST ROOT rules.
      docker run -v /etc:/host-etc … as root  →  edit the host's /etc

   2. A container escape starts with full privilege.
      A kernel bug, a misconfigured mount, or a mounted docker.sock turns
      "code execution in a container" into "root on the host".

   3. Every added capability is more dangerous.
      --privileged, --cap-add=SYS_ADMIN, hostPath mounts, host networking —
      all compound with UID 0.

   4. An intruder inside the container can install tooling, rewrite the
      application, and read every file, regardless of file permissions.
```

The claim to reject explicitly: <C color="crimson">"running as root is fine because containers are isolated."</C> Namespace isolation is a kernel-enforced boundary, and kernel vulnerabilities are found regularly. Defence in depth means assuming that boundary can fail and making the attacker's starting position as weak as possible.

---

## 2. Why root is convenient during a build

Build steps legitimately need privilege:

- Installing system packages
- Writing to `/usr/local`, `/opt`, `/etc`
- Creating users and groups
- Setting file ownership

So the pattern is not "never be root" — it is **be root while building, drop before running**:

```text
   BUILD TIME                    RUN TIME
   ──────────────────            ──────────────────
   root: install packages        non-root: run the application
   root: create the app user     no package manager needed
   root: copy and chown files    no writes outside declared paths
   ───────────── USER <uid> ────────────►
```

---

## 3. The pattern

```dockerfile
FROM <base-image>

# --- privileged build work happens first, as root ---
RUN <install runtime system packages> \
 && <clean the package cache>

# --- create an unprivileged user ---
# System account: no login shell, no home directory needed, fixed UID/GID.
RUN <create group appgroup with GID 10001> \
 && <create user appuser with UID 10001, no login shell, in appgroup>

WORKDIR /app

# --- copy with correct ownership, rather than chown-ing afterwards ---
COPY --chown=10001:10001 <application-files> ./

# --- drop privilege; everything after this, including CMD, is unprivileged ---
USER 10001:10001

EXPOSE 8080
ENTRYPOINT ["<application-binary>"]
```

Details that matter:

**Use a numeric UID in `USER`.** Two reasons: orchestrators can only verify `runAsNonRoot` when the UID is unambiguously non-zero, and a minimal image may have no `/etc/passwd` to resolve a name against. A named user is fine as documentation; the number is what is enforceable.

**Prefer `COPY --chown` over a later `RUN chown`.** A `chown` of a large tree <H>duplicates every file into a new layer</H>, because changing ownership changes the file's metadata — potentially doubling image size. `--chown` sets ownership as the files are written.

**Pick a high, fixed UID** (10000+). It avoids collisions with distro system accounts, and pinning it means volume ownership stays consistent across image rebuilds.

**`USER` applies to subsequent `RUN`s too.** Anything privileged must come before it. If you must return to root temporarily, `USER root` then drop again — but that is usually a sign the ordering is wrong.

---

## 4. The practical obstacles

### Ports below 1024

Binding a privileged port requires `CAP_NET_BIND_SERVICE`. Options, best first:

1. **Listen on a high port** (8080) and publish it wherever you like: `-p 80:8080`. The host-side number is unconstrained. <H>This is almost always the right answer.</H>
2. Grant just that capability: `--cap-add=NET_BIND_SERVICE`, or set the file capability on the binary at build time.
3. Put a proxy or load balancer in front — which you probably have anyway.

Never solve it by staying root.

### Writable paths

A non-root process cannot write where root could. Decide deliberately where writes are allowed:

```dockerfile
RUN <create /app/tmp and /var/cache/app owned by 10001:10001>
```

Better still, aim for a **read-only root filesystem** and mount writable areas explicitly:

```bash
docker run --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m myimage
```

```yaml
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - app_data:/var/lib/app
```

A read-only root filesystem stops an intruder from modifying the application, dropping tools, or persisting anything. It is one of the highest-value, lowest-cost hardening steps available.

### Volume and bind-mount ownership

The most common real friction. A named volume is initialised with the ownership of the image's mount point — so if the directory is `root:root` in the image, the volume is too, and your UID 10001 process cannot write to it.

```dockerfile
RUN mkdir -p /var/lib/app && chown 10001:10001 /var/lib/app
VOLUME /var/lib/app     # optional; ownership is taken from the image path
```

Bind mounts are worse: they keep the **host's** ownership, which the container cannot change. Fixes: match UIDs between host and container, use an entrypoint that adjusts ownership before dropping privilege (running the entrypoint as root and `exec`ing the app as the app user), or prefer named volumes in production and bind mounts only in development.

### Existing images that assume root

Many official images already run as non-root (`nginx` unprivileged variants, `node` ships a `node` user, `postgres` runs as `postgres`). Where an image assumes root, `--user` at run time often works, but check that the writable paths it needs are accessible.

---

## 5. Beyond UID: what else to drop

Non-root is one control. The full set, in rough order of value:

```bash
docker run \
  --user 10001:10001 \
  --read-only \
  --tmpfs /tmp \
  --cap-drop=ALL \                       # drop every Linux capability…
  --cap-add=NET_BIND_SERVICE \           # …then add back only what is needed
  --security-opt=no-new-privileges \     # setuid binaries cannot escalate
  --pids-limit=200 \
  --memory=512m --cpus=1 \
  myimage
```

- **`--cap-drop=ALL`** removes the ~14 capabilities Docker grants by default. Most applications need none of them.
- **`no-new-privileges`** prevents a setuid binary inside the image from regaining privilege — it closes the gap where "non-root" was only nominal.
- **Resource limits** turn a runaway or a fork bomb into a container problem rather than a host outage.
- **Seccomp and AppArmor/SELinux** profiles restrict which syscalls are reachable at all; the defaults already help, and custom profiles help more.

<H>`USER` in the Dockerfile is a default, not an enforcement.</H> `docker run --user root` overrides it. Enforcement belongs to the platform: Kubernetes `securityContext` with `runAsNonRoot: true`, admission policies, or the equivalent in your orchestrator. The Dockerfile makes the right thing easy; the platform makes the wrong thing impossible.

---

## Rapid-fire recall

1. Is container root the same UID as host root by default?
2. Rebut "running as root is fine, containers are isolated".
3. Why is build-time root acceptable but run-time root not?
4. Why prefer a numeric UID in `USER`?
5. Why is `COPY --chown` better than a later `RUN chown -R`?
6. Your app must serve on port 80 as non-root. Give the best option and one fallback.
7. What ownership does a fresh named volume get, and why does that break non-root containers?
8. Why are bind mounts harder than named volumes for non-root?
9. What does `no-new-privileges` prevent?
10. Does `USER` in a Dockerfile guarantee the container runs unprivileged?

<details>
<summary>Answers</summary>

1. Yes — without user namespace remapping, UID 0 inside is UID 0 on the host.
2. Namespaces are a kernel-enforced boundary and kernel bugs are found regularly; root also makes bind mounts, capabilities and a mounted docker socket immediately dangerous. Assume the boundary can fail.
3. Build steps need privilege to install packages and set ownership, and the build environment is discarded. At run time privilege only increases the blast radius of a compromise.
4. Orchestrators can verify a non-zero UID for `runAsNonRoot`, and minimal images may have no `/etc/passwd` to resolve a name.
5. `chown -R` rewrites metadata for every file, duplicating the whole tree into a new layer; `--chown` sets ownership as files are written.
6. Best: listen on 8080 and publish `-p 80:8080`. Fallback: grant `CAP_NET_BIND_SERVICE` only.
7. The ownership of the image's mount-point directory. If that is `root:root`, a non-root process cannot write to the volume.
8. Bind mounts keep host ownership, which the container cannot change; you must align UIDs or adjust ownership in a root entrypoint before dropping privilege.
9. A setuid binary inside the container from escalating privilege, closing the loophole where non-root is only nominal.
10. No. It is a default that `docker run --user` overrides. Enforcement requires platform policy such as a Kubernetes `securityContext` or admission control.

</details>

---

**Next:** [PID 1 & Signal Handling](./17-pid1-and-signals.md) — why your container takes ten seconds to stop and loses in-flight requests.
