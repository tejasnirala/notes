---
title: PID 1 & Signal Handling
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# PID 1 & Signal Handling

> **What you will be able to do after this page**
>
> - Explain why PID 1 is special in Linux and what that means inside a container.
> - Trace `docker stop` from signal to exit, second by second.
> - Diagnose the three classic failures: shell-form CMD, entrypoint without `exec`, zombie processes.
> - Implement graceful shutdown correctly.

---

## 1. The main process *is* the container

A container's lifetime equals the lifetime of its PID 1.

```text
   docker run ──► PID 1 starts ──► container is "running"
                       │
                       └── PID 1 exits ──► container is "exited", exit code = its code
```

Everything else follows. If PID 1 forks a server into the background and returns, the container stops instantly. If PID 1 is a shell that ignores signals, the container cannot be stopped gracefully. <H>Choosing what becomes PID 1 is a design decision, not an implementation detail.</H>

---

## 2. Why PID 1 is special in Linux

The kernel treats PID 1 differently in two ways:

### 2.1 Default signal handlers are absent

For a normal process, a signal with no registered handler applies its *default action* — `SIGTERM` terminates, `SIGINT` terminates. For PID 1, the kernel <C color="crimson">does not apply default actions</C>. A signal PID 1 has not explicitly registered a handler for is simply discarded.

```text
   normal process  + SIGTERM + no handler  →  terminates
   PID 1           + SIGTERM + no handler  →  NOTHING HAPPENS
```

This exists so that a real init system cannot be killed accidentally. Inside a container it means: if your PID 1 does not handle `SIGTERM`, `docker stop` does nothing until the grace period expires and `SIGKILL` arrives. (`SIGKILL` cannot be caught or ignored by anyone, PID 1 included.)

### 2.2 Orphans are reparented to PID 1

When any process's parent dies, the orphan is reparented to PID 1, which is expected to `wait()` on it and reap the exit status. A process that has exited but not been reaped is a **zombie** — it holds a PID table entry forever.

A real init reaps orphans. An application used as PID 1 usually does not. In a container that spawns subprocesses, zombies then accumulate until the PID table is exhausted.

---

## 3. What `docker stop` actually does

```text
   t=0    docker stop <container>
          └─► SIGTERM to PID 1 (or the container's STOPSIGNAL)
   t=0…N  the application should:
            · stop accepting new connections
            · finish in-flight requests
            · flush buffers, commit or roll back, close connections
            · deregister from service discovery
            · exit(0)
   t=N    grace period expires (default 10s; --time / stop_grace_period)
          └─► SIGKILL — uncatchable, immediate, no cleanup
```

<H>Everything you care about happens between t=0 and t=N, and only if PID 1 received the signal.</H> `docker kill` skips straight to `SIGKILL`.

The consequences of not handling it: dropped in-flight requests, half-written files, connections left open on the database until its timeout, unacknowledged queue messages redelivered as duplicates, and a rolling deploy that drops traffic on every replica.

---

## 4. The three classic failures

### 4.1 Shell-form `CMD`

```dockerfile
CMD <application-command> --flag       # shell form
```

Docker runs this as `/bin/sh -c "<application-command> --flag"`.

```text
   PID 1  /bin/sh -c "app --flag"        ← receives SIGTERM, has no handler, ignores it
     └─ PID 7  app --flag                ← never told to shut down
```

`docker stop` waits the full grace period and then `SIGKILL`s everything.

```dockerfile
CMD ["<application-binary>", "--flag"]   # ✅ exec form: the app IS PID 1
```

If you genuinely need shell features, keep them and still hand over PID 1:

```dockerfile
CMD ["sh", "-c", "exec <application-command> --flag"]
```

`exec` <H>replaces the shell process image with the application, keeping PID 1</H>.

### 4.2 An entrypoint script without `exec`

```bash
#!/bin/sh
<render configuration>
<wait for dependencies>
<application-command>          # ❌ the script stays PID 1 as the app's parent
```

```bash
#!/bin/sh
set -e
<render configuration>
<wait for dependencies>
exec "$@"                      # ✅ the application replaces the script as PID 1
```

`exec "$@"` also forwards the `CMD` arguments, which is why the pairing of an `ENTRYPOINT` script with a `CMD` argument list works.

### 4.3 Zombie processes

If your PID 1 spawns children (a supervisor, a process manager, a shell pipeline) it must reap them. If it does not, use a minimal init:

```bash
docker run --init myimage        # Docker injects tini as PID 1
```

```dockerfile
ENTRYPOINT ["/usr/bin/tini", "--", "<application-binary>"]
```

`tini` and Docker's `--init` do exactly two things: reap orphans, and forward signals to the real process. They are the correct answer when your application is not itself an init. <C color="orange">They are not a substitute for the application handling `SIGTERM`</C> — the signal is forwarded, and the app still has to act on it.

---

## 5. Implementing graceful shutdown

Language-agnostic shape:

```text
   on SIGTERM (and SIGINT):
     1. set a flag: "shutting down"
     2. fail readiness checks immediately
        → the load balancer stops sending new traffic
     3. stop accepting new connections; keep serving existing ones
     4. wait for in-flight work, up to a deadline shorter than the grace period
     5. close database connections, flush logs and metrics, release locks
     6. exit(0)
```

Two details that are easy to get wrong:

- **Fail readiness before closing the listener.** Load balancers need a moment to notice; closing first drops requests that were already routed to you.
- **Your shutdown deadline must be shorter than the platform's grace period.** If the platform kills at 30 s, finish by ~25 s, or your cleanup is truncated by `SIGKILL` anyway.

Set an explicit grace period where the default is too short:

```bash
docker stop --time=30 <container>
```

```yaml
services:
  api:
    stop_grace_period: 30s
```

`STOPSIGNAL` in the Dockerfile changes which signal is sent, for runtimes that expect something other than `SIGTERM`.

---

## 6. One process per container — the nuance

The guidance "one process per container" is really "one *concern* per container, with a well-defined PID 1". A master process with worker children is entirely normal and correct — see [Workers & Concurrency](./19-workers-and-concurrency.md) — as long as the master forwards signals and reaps children, which real process managers do.

What the guidance actually rules out is bundling *unrelated* services (an app plus a database plus a cron daemon) behind a supervisor, because then: a crash of one is invisible to the orchestrator, scaling is all-or-nothing, logs are interleaved, and the container's health becomes ambiguous. Separate concerns into separate containers; keep a legitimate process tree inside one.

---

## 7. Verifying it

```bash
# Is the app really PID 1, or is a shell?
docker exec <container> ps -ef | head

# Time a stop: instant means the signal was handled; ~10s means it was not.
time docker stop <container>

# Exit code: 0 = clean, 137 = SIGKILL (128+9), 143 = SIGTERM (128+15)
docker inspect <container> --format '{{.State.ExitCode}}'

# Are zombies accumulating?
docker exec <container> ps -ef | grep defunct
```

Exit code **137** after a `docker stop` is the signature of this whole class of bug: the process was killed, not shut down.

---

## Rapid-fire recall

1. What ends a container's life?
2. State the two ways the Linux kernel treats PID 1 differently.
3. What happens when SIGTERM reaches a PID 1 with no handler?
4. Walk through `docker stop` with timings.
5. Why does `CMD app --flag` break graceful shutdown, and what are the two fixes?
6. What does `exec "$@"` do, and why both halves matter?
7. What does `--init` provide, and what does it *not* provide?
8. Why fail readiness checks before closing the listening socket?
9. Why must the app's shutdown deadline be shorter than the platform grace period?
10. Your container exits with 137 after `docker stop`. What does that tell you?

<details>
<summary>Answers</summary>

1. Its PID 1 exiting. The container's exit code is that process's exit code.
2. Signals with no registered handler are discarded rather than applying their default action; and orphaned processes are reparented to it and must be reaped.
3. Nothing — it is discarded. The container survives until the grace period expires and `SIGKILL` arrives.
4. t=0 SIGTERM to PID 1; the app drains and exits; at t=N (default 10s) SIGKILL, uncatchable, no cleanup.
5. The shell becomes PID 1, ignores SIGTERM and does not forward it. Fix with exec form `CMD ["app","--flag"]`, or `CMD ["sh","-c","exec app --flag"]`.
6. `exec` replaces the shell with the application so it becomes PID 1; `"$@"` forwards the `CMD` arguments so the ENTRYPOINT/CMD pairing still works.
7. It injects a minimal init that reaps orphans and forwards signals. It does not make the application handle SIGTERM — the app must still shut down on it.
8. Load balancers need time to observe the state change; closing the socket first drops requests already routed to the instance.
9. Otherwise `SIGKILL` truncates the cleanup, defeating the point of handling the signal at all.
10. It was killed by `SIGKILL` (128+9) — the grace period expired, so the signal was never handled or shutdown took too long.

</details>

---

**Next:** [Development vs Production Containers](./18-dev-vs-prod.md) — one Dockerfile, two very different targets.
