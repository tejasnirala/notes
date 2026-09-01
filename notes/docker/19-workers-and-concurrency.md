---
title: Workers, Processes & Concurrency
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';

# Workers, Processes & Concurrency

> **What you will be able to do after this page**
>
> - Distinguish process, thread, concurrency and parallelism precisely.
> - Explain why four workers cost roughly four times the memory — and where copy-on-write changes that.
> - Choose a worker count from the container's CPU limit rather than the host's core count.
> - Decide between scaling workers inside a container and scaling containers.

---

## 1. Why this belongs in Docker notes

Because container resource limits and process models interact badly by default. The classic incident:

```text
   Host: 64 cores
   Container limit: --cpus=1, --memory=512m
   Application: "workers = number of CPUs"   → reads the HOST count → 64 workers
   Result: 64 × ~80 MB = 5 GB requested inside a 512 MB limit → OOM-killed at start
```

The runtime asked the kernel how many CPUs exist, and the kernel answered honestly: 64. <H>cgroup limits restrict what you may *use*; they do not change what you can *see*.</H> Newer runtimes read cgroup limits, but many libraries and configuration defaults still do not.

---

## 2. Process vs thread

```text
   PROCESS                                THREAD
   ─────────────────────────              ─────────────────────────
   Own virtual address space              Shares the process's address space
   Own file descriptor table              Shares descriptors
   Crash is contained                     A crash can take down the process
   IPC needed to communicate              Communicates via shared memory
   Heavier to create (~ms)                Lighter (~µs)
   Truly parallel across cores            Parallel unless a global lock serialises it
```

The consequence people misstate: <C color="crimson">"all workers share the application's memory."</C> They do not. Separate processes have <H>separate address spaces</H> — that is the definition of a process. A cache built in worker 1 is invisible to worker 2. In-process state, connection pools, rate-limit counters and scheduled jobs all exist *per worker*.

That is exactly why state must be externalised — to a database, a cache, or a message broker — the moment there is more than one worker. It is the same reason it must be externalised the moment there is more than one container.

### Copy-on-write — the honest nuance

When a process forks, the child does not copy the parent's memory; both map the same physical pages, and a page is copied only when one side writes to it.

```text
   after fork:   parent ──┐
                          ├──► shared physical pages (read-only mapping)
                 child  ──┘
   on write:     the touched page is copied — only that page diverges
```

So a pre-fork worker model *does* share memory initially, and a large read-only structure loaded before forking can be shared cheaply. Caveats: reference-counting or garbage-collecting runtimes write to object headers when merely reading, which triggers copies and erodes the saving over time; and this only applies to `fork`-based models, not to independently spawned processes or separate containers.

Summary: <H>threads share memory by design; forked processes share it opportunistically and temporarily; separate containers share nothing.</H>

---

## 3. Concurrency vs parallelism

- **Concurrency** — many tasks *in progress*, interleaved. One core suffices. It is a structuring property.
- **Parallelism** — many tasks *executing simultaneously*. Requires multiple cores. It is an execution property.

```text
   CONCURRENT, 1 core        A──B──A──B──A──B      (interleaved)
   PARALLEL,  2 cores        A──A──A
                             B──B──B               (simultaneous)
```

Which one your workload needs decides the model:

| Workload | Bottleneck | Model that helps |
| :--- | :--- | :--- |
| I/O-bound (database calls, HTTP, disk) | Waiting | Concurrency: async event loops, or many threads |
| CPU-bound (encoding, compression, computation) | Cycles | Parallelism: multiple processes across cores |
| Mixed | Both | Processes for cores × concurrency within each |

Adding processes to an I/O-bound service that is idle waiting achieves nothing but memory consumption. Adding threads to a CPU-bound workload in a runtime with a global interpreter lock achieves nothing at all.

---

## 4. The master/worker model

```text
             ┌──────────────────────┐
             │  MASTER / SUPERVISOR │   binds the socket, forks workers,
             │       (PID 1)        │   restarts them on crash, forwards signals
             └──────────┬───────────┘
          ┌─────────────┼─────────────┬─────────────┐
          ▼             ▼             ▼             ▼
      Worker 1      Worker 2      Worker 3      Worker 4
      own memory    own memory    own memory    own memory
          └─────────────┴──────┬──────┴─────────────┘
                               ▼
                    shared listening socket
                    (kernel distributes connections)
```

Why it exists:

- **Use multiple cores** in runtimes where one process cannot.
- **Fault isolation** — one worker crashing takes one worker's requests, not the service.
- **Rolling restarts** — workers can be recycled (after N requests, or on a code change) without dropping the listener.

Costs: memory multiplied by worker count, per-worker connection pools multiplying database connections, no shared in-process state, and a more complex signal path (the master must forward `SIGTERM` and reap children — see [PID 1](./17-pid1-and-signals.md)).

---

## 5. Choosing a worker count

Start from the container's limits, never the host's:

```text
   CPU-bound        workers ≈ CPU limit                      (1–2× )
   I/O-bound        workers ≈ 2–4 × CPU limit, or 1 worker with high concurrency
   Memory ceiling   workers ≤ (memory limit − headroom) / per-worker RSS
```

Then take the **minimum** of the CPU-derived and memory-derived numbers, and verify under load. A container limited to `--cpus=1` gains nothing from 8 workers except 8× the memory and more context switching.

Also check the database side: `workers × connections_per_worker × replicas` is the real connection count arriving at your database. Four workers × 10 connections × 6 replicas is 240 connections — enough to exhaust a default Postgres `max_connections` of 100.

Practical rules:

1. **Make the worker count explicit configuration**, defaulting sensibly, never auto-detected from `nproc` inside a container.
2. **Set container CPU and memory limits explicitly.** Unlimited containers make capacity planning impossible and let one service starve the host.
3. **Leave memory headroom.** Runtime overhead, page cache and allocator fragmentation mean the limit must exceed the sum of worker RSS.
4. **Measure.** Per-worker memory varies enormously between applications; there is no universal number.

---

## 6. Workers inside a container vs more containers

```text
   ONE CONTAINER, N WORKERS              N CONTAINERS, 1 WORKER EACH
   ────────────────────────              ────────────────────────────
   + fewer containers to schedule        + granular horizontal scaling
   + shared image page cache             + a crash kills one replica, not N workers
   + one network endpoint                + orchestrator handles restarts and placement
   + lower per-instance overhead         + rolling updates per replica
   − in-container failures are opaque    − more scheduling overhead
     to the orchestrator                 − more connections and more endpoints
   − scaling granularity is coarse       − each replica pays full runtime overhead
```

The usual guidance: <H>with an orchestrator, prefer more replicas with a small worker count (1–4); without one, a master/worker process manager inside the container is a reasonable way to use the machine.</H>

Whichever you choose, the design constraint is identical and non-negotiable: **the application must be stateless with respect to in-process memory.** Sessions, caches, counters, locks and scheduled jobs must live in shared infrastructure. That property is what makes both scaling directions work, and its absence is what makes them both fail intermittently and mysteriously.

Finally, the misconception to name explicitly: <C color="crimson">"containers eliminate the need for process and resource management."</C> They do the opposite — they add a limit boundary that your process model must be tuned against. Docker will happily start a container whose configured worker count cannot fit in its memory limit, and the kernel will happily OOM-kill it.

---

## Rapid-fire recall

1. Why do many runtimes spawn far too many workers inside a limited container?
2. Do four worker processes share the application's memory?
3. What is copy-on-write, and why does it erode over time in some runtimes?
4. Concurrency vs parallelism in one line each.
5. Which model helps an I/O-bound service, and which helps a CPU-bound one?
6. Give two benefits of the master/worker model beyond using more cores.
7. How do you pick a worker count for a container with `--cpus=2 --memory=1g`?
8. Why can worker count cause a database outage?
9. When are more replicas preferable to more workers?
10. What single application property is required for either scaling direction to work?

<details>
<summary>Answers</summary>

1. They auto-detect CPUs from the host's core count; cgroup limits restrict usage but historically do not change what the process can see.
2. No — separate processes have separate address spaces. In-process caches, pools and counters exist per worker.
3. On fork, parent and child share physical pages until one writes; refcounting or GC writes to object headers even on reads, gradually copying pages that were meant to be shared.
4. Concurrency: many tasks in progress, interleaved on any number of cores. Parallelism: many tasks executing at the same instant, requiring multiple cores.
5. I/O-bound: concurrency (async or threads). CPU-bound: parallelism (multiple processes across cores).
6. Fault isolation (one worker crash does not kill the service) and rolling worker recycling without dropping the listening socket.
7. Take the minimum of a CPU-derived count (≈2 for CPU-bound, 4–8 for I/O-bound) and a memory-derived count ((1 GB − headroom) / per-worker RSS), then verify under load.
8. Total connections are workers × pool size × replicas, which easily exceeds the database's connection limit.
9. When an orchestrator is present: it gives granular scaling, per-replica restarts and rolling updates, and makes failures visible to the scheduler.
10. Statelessness with respect to in-process memory — all shared state must live in external infrastructure.

</details>

---

**Next:** [Runtime Filesystem & Volumes](./20-runtime-filesystem-and-volumes.md) — where data survives, and where it does not.
