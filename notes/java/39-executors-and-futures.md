---
title: Executors, Futures & Modern Concurrency
author: Tejas Nirala
---

# Executors, Futures & Modern Concurrency

You've seen raw `Thread`. In real code you almost never create one. This chapter is what you actually use: thread pools, futures, `CompletableFuture`, concurrent collections, and virtual threads.

---

## 1. Why not just create threads?

```java
// ❌ A web server doing this collapses under load
for (Request r : requests) {
    new Thread(() -> handle(r)).start();
}
```

Three problems:

1. **Cost.** Each OS thread reserves ~1 MB of stack and requires a system call to create. 10,000 requests = 10 GB of stack reservations.
2. **No limit.** 10,000 threads on 8 cores means the OS spends more time context-switching than working.
3. **No result, no error handling.** If `handle` throws, the exception dies with the thread.

A **thread pool** fixes all three: a fixed number of reusable threads, an unbounded (or bounded) queue of tasks, and a `Future` to carry results and exceptions back.

---

## 2. `ExecutorService`

```java
import java.util.concurrent.*;

ExecutorService pool = Executors.newFixedThreadPool(4);

pool.execute(() -> System.out.println("fire and forget"));   // Runnable, no result
Future<Integer> f = pool.submit(() -> 42);                    // Callable, gives a Future

pool.shutdown();                                              // no new tasks; finish existing
pool.awaitTermination(30, TimeUnit.SECONDS);                  // block until done
```

### The factory methods

| Factory | Behaviour | Use for |
| :-- | :-- | :-- |
| `newFixedThreadPool(n)` | Exactly `n` threads, unbounded queue | CPU-bound work; `n` ≈ core count |
| `newCachedThreadPool()` | Grows without limit, reuses idle threads (60s TTL) | Many short-lived tasks; ⚠️ can create thousands of threads |
| `newSingleThreadExecutor()` | One thread, tasks run in order | Serialised work, ordering guaranteed |
| `newScheduledThreadPool(n)` | Supports delayed and repeating tasks | Cron-like scheduling |
| `newWorkStealingPool()` | ForkJoinPool sized to CPU count | Divide-and-conquer, uneven task sizes |
| `newVirtualThreadPerTaskExecutor()` | Java 21+, one virtual thread per task | I/O-bound work at massive scale |

**Sizing a fixed pool:**
- CPU-bound → `Runtime.getRuntime().availableProcessors()`
- I/O-bound → higher, since threads spend most of their time blocked. A rough formula: `cores × (1 + waitTime/computeTime)`.

### Always shut down

```java
ExecutorService pool = Executors.newFixedThreadPool(4);
try {
    // submit work
} finally {
    pool.shutdown();                                     // graceful
    if (!pool.awaitTermination(30, TimeUnit.SECONDS)) {
        pool.shutdownNow();                              // interrupt what's still running
    }
}
```

`ExecutorService` implements `AutoCloseable` from **Java 19**, so you can write:

```java
try (var pool = Executors.newFixedThreadPool(4)) {
    pool.submit(task);
}   // close() shuts down and waits
```

Forgetting to shut down keeps non-daemon threads alive and **your JVM never exits**.

---

## 3. `Future`

```java
Future<Integer> future = pool.submit(() -> {
    Thread.sleep(1000);
    return 42;
});

future.isDone();                     // has it finished?
future.cancel(true);                 // try to cancel (true = interrupt if running)
future.isCancelled();

int result = future.get();                        // BLOCKS until done
int r2     = future.get(2, TimeUnit.SECONDS);     // blocks with a timeout
```

### Exceptions come back wrapped

```java
Future<Integer> f = pool.submit(() -> { throw new IllegalStateException("boom"); });

try {
    f.get();
} catch (ExecutionException e) {
    System.out.println(e.getCause().getMessage());    // "boom" — unwrap with getCause()
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
}
```

This is a big improvement over raw threads, where an exception simply kills the thread silently.

### `invokeAll` and `invokeAny`

```java
List<Callable<String>> tasks = List.of(
    () -> fetch("a.com"),
    () -> fetch("b.com"),
    () -> fetch("c.com")
);

List<Future<String>> all = pool.invokeAll(tasks);    // waits for ALL
for (Future<String> f : all) System.out.println(f.get());

String fastest = pool.invokeAny(tasks);              // returns the FIRST to succeed,
                                                     // cancels the rest
```

### The limitation of `Future`

`Future.get()` **blocks**. You can't say "when this finishes, do that" without a thread sitting there waiting. That's what `CompletableFuture` fixes.

---

## 4. `CompletableFuture` — composable async

```java
import java.util.concurrent.CompletableFuture;

CompletableFuture<String> future = CompletableFuture
    .supplyAsync(() -> fetchUser(id))            // run async, produce a value
    .thenApply(User::getName)                    // transform (like map)
    .thenApply(String::toUpperCase)
    .thenAccept(System.out::println)             // consume, return nothing
    .exceptionally(ex -> {                       // handle failure
        System.err.println("Failed: " + ex.getMessage());
        return null;
    });
```

Nothing blocks. Each stage runs when the previous one completes.

### The core methods

| Method | Analogy | Signature shape |
| :-- | :-- | :-- |
| `supplyAsync(sup)` | start with a value | `() -> T` |
| `runAsync(run)` | start with no value | `() -> void` |
| `thenApply(fn)` | `map` | `T -> U` |
| `thenCompose(fn)` | `flatMap` | `T -> CompletableFuture<U>` |
| `thenAccept(con)` | `forEach` | `T -> void` |
| `thenRun(run)` | side effect, ignores value | `() -> void` |
| `thenCombine(other, fn)` | zip two futures | `(T, U) -> V` |
| `allOf(...)` / `anyOf(...)` | wait for all / first | — |
| `exceptionally(fn)` | catch | `Throwable -> T` |
| `handle(fn)` | try/finally, sees both | `(T, Throwable) -> U` |
| `whenComplete(con)` | peek at the outcome | `(T, Throwable) -> void` |

Every method has an `...Async` variant that runs the stage on a different thread (`thenApplyAsync`, etc.).

### `thenApply` vs `thenCompose` — the map/flatMap distinction again

```java
CompletableFuture<User> user = fetchUserAsync(id);

user.thenApply(u -> fetchOrdersAsync(u));      // CompletableFuture<CompletableFuture<Orders>> 😖
user.thenCompose(u -> fetchOrdersAsync(u));    // CompletableFuture<Orders> ✅
```

If the function already returns a future, use `thenCompose`.

### Running things in parallel

```java
// Two independent calls, combined
CompletableFuture<User>    user    = CompletableFuture.supplyAsync(() -> fetchUser(id));
CompletableFuture<Account> account = CompletableFuture.supplyAsync(() -> fetchAccount(id));

CompletableFuture<Profile> profile =
    user.thenCombine(account, (u, a) -> new Profile(u, a));

System.out.println(profile.join());     // join() is get() without checked exceptions
```

```java
// Many calls, wait for all
List<CompletableFuture<String>> futures = urls.stream()
    .map(url -> CompletableFuture.supplyAsync(() -> fetch(url)))
    .toList();

CompletableFuture<Void> all =
    CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]));

List<String> results = all.thenApply(v ->
    futures.stream().map(CompletableFuture::join).toList()
).join();
```

### Timeouts and error handling

```java
CompletableFuture.supplyAsync(() -> slowCall())
    .orTimeout(2, TimeUnit.SECONDS)                    // Java 9+ — fail after 2s
    .completeOnTimeout("default", 2, TimeUnit.SECONDS) // or supply a fallback
    .handle((result, ex) -> ex != null ? "fallback" : result)
    .thenAccept(System.out::println);
```

> ⚠️ By default `supplyAsync` uses the **common ForkJoinPool**, which has `cores - 1` threads and is shared with parallel streams. Blocking I/O on it starves everything else. **Pass your own executor for I/O work:**
> ```java
> CompletableFuture.supplyAsync(() -> httpCall(), myIoExecutor);
> ```

---

## 5. Scheduled tasks

```java
ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(2);

// Once, after a delay
scheduler.schedule(() -> System.out.println("later"), 5, TimeUnit.SECONDS);

// Every 10 seconds, measured from each START
scheduler.scheduleAtFixedRate(this::poll, 0, 10, TimeUnit.SECONDS);

// 10 seconds after each task FINISHES
scheduler.scheduleWithFixedDelay(this::cleanup, 0, 10, TimeUnit.SECONDS);

scheduler.shutdown();
```

The difference matters: with `atFixedRate`, if a task takes 15 seconds, the next one starts immediately (and they can pile up). With `withFixedDelay`, there's always a 10-second gap.

> ⚠️ **An uncaught exception silently cancels all future executions** of a scheduled task. Always wrap the body in try/catch.

---

## 6. Concurrent collections

| Instead of | Use | Why |
| :-- | :-- | :-- |
| `HashMap` | `ConcurrentHashMap` | Lock-striped; reads are lock-free |
| `ArrayList` | `CopyOnWriteArrayList` | For read-heavy, write-rare (listeners) |
| `HashSet` | `ConcurrentHashMap.newKeySet()` | |
| producer/consumer | `LinkedBlockingQueue`, `ArrayBlockingQueue` | Blocking `put`/`take` |
| priority + concurrency | `PriorityBlockingQueue` | |
| ~~`Vector`, `Hashtable`~~ | anything above | Whole-object locking, poor scaling |

```java
ConcurrentHashMap<String, Integer> counts = new ConcurrentHashMap<>();
counts.merge("hits", 1, Integer::sum);              // atomic
counts.computeIfAbsent("k", k -> expensive());       // atomic, computed once
counts.putIfAbsent("k", 0);                          // atomic

// Producer / consumer
BlockingQueue<Task> queue = new LinkedBlockingQueue<>(1000);

// Producer thread
queue.put(task);           // blocks if the queue is full → natural backpressure

// Consumer thread
Task t = queue.take();     // blocks if the queue is empty
```

`BlockingQueue` is the backbone of the producer-consumer pattern, and it gives you **backpressure for free**: if consumers can't keep up, producers block instead of exhausting memory.

---

## 7. Other coordination tools

```java
// CountDownLatch — wait for N things to finish (one-shot)
CountDownLatch latch = new CountDownLatch(3);
for (int i = 0; i < 3; i++) {
    pool.submit(() -> { doWork(); latch.countDown(); });
}
latch.await();                          // blocks until the count hits zero
System.out.println("all three done");

// Semaphore — limit concurrent access to a resource
Semaphore permits = new Semaphore(5);   // at most 5 at a time
permits.acquire();
try { callRateLimitedApi(); }
finally { permits.release(); }

// CyclicBarrier — N threads wait for each other, then all proceed (reusable)
CyclicBarrier barrier = new CyclicBarrier(3, () -> System.out.println("round done"));
barrier.await();
```

| Tool | Purpose | Reusable? |
| :-- | :-- | :-- |
| `CountDownLatch` | Wait for N events | ❌ one-shot |
| `CyclicBarrier` | N threads rendezvous | ✅ |
| `Semaphore` | Limit concurrency to N | ✅ |
| `Phaser` | Flexible multi-phase barrier | ✅ |
| `Exchanger` | Two threads swap objects | ✅ |

---

## 8. Virtual threads (Java 21)

The biggest change to Java concurrency in 20 years.

A **platform thread** is an OS thread: expensive, ~1 MB stack, thousands is a lot. A **virtual thread** is managed by the JVM: cheap, a few hundred bytes, **millions** is fine.

```java
// One virtual thread per task — this is now a reasonable thing to do
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (int i = 0; i < 1_000_000; i++) {
        executor.submit(() -> {
            Thread.sleep(1000);          // blocks the VIRTUAL thread, not the OS thread
            return null;
        });
    }
}   // a million concurrent tasks, on a handful of OS threads

// Directly
Thread v = Thread.ofVirtual().start(() -> System.out.println("virtual!"));
```

**The key insight:** when a virtual thread blocks on I/O, the JVM *unmounts* it from its carrier OS thread and mounts another virtual thread there. The OS thread is never idle.

This makes the old advice obsolete for I/O-bound work:

| | Platform threads | Virtual threads |
| :-- | :-- | :-- |
| Pooling | **essential** | **unnecessary** — don't pool them |
| Blocking I/O | expensive, must avoid | **cheap, just block** |
| Async/reactive style | needed for scale | often unnecessary |
| CPU-bound work | correct choice | no benefit |

Write plain, blocking, sequential code — and get the throughput of an async framework. That's the promise.

> Caveat: a virtual thread **pinned** inside a `synchronized` block during I/O can't unmount, blocking its carrier. Prefer `ReentrantLock` over `synchronized` in virtual-thread-heavy code (this is being addressed in later JDK releases).

---

## 9. Worked example: a concurrent pipeline

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.*;

public class ConcurrencyDemo {

    record Page(String url, int words) { }

    static Page fetch(String url) {
        try { Thread.sleep(300); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        return new Page(url, url.length() * 100);
    }

    public static void main(String[] args) throws Exception {
        List<String> urls = List.of("a.com", "bb.org", "ccc.net", "dddd.io", "eeeee.dev");

        // ── 1. Sequential baseline ────────────────────────────────
        long t0 = System.currentTimeMillis();
        List<Page> seq = urls.stream().map(ConcurrencyDemo::fetch).toList();
        System.out.println("Sequential: " + (System.currentTimeMillis() - t0) + "ms");
        // ~1500ms — 5 × 300ms

        // ── 2. Fixed pool with invokeAll ──────────────────────────
        try (var pool = Executors.newFixedThreadPool(5)) {
            long t1 = System.currentTimeMillis();
            List<Callable<Page>> tasks = urls.stream()
                .<Callable<Page>>map(u -> () -> fetch(u))
                .toList();
            List<Page> results = new ArrayList<>();
            for (Future<Page> f : pool.invokeAll(tasks)) results.add(f.get());
            System.out.println("Pool: " + (System.currentTimeMillis() - t1) + "ms");
            // ~300ms — all five in parallel
        }

        // ── 3. CompletableFuture pipeline ─────────────────────────
        ExecutorService io = Executors.newFixedThreadPool(5);
        long t2 = System.currentTimeMillis();

        List<CompletableFuture<Page>> futures = urls.stream()
            .map(u -> CompletableFuture.supplyAsync(() -> fetch(u), io)
                                       .orTimeout(2, TimeUnit.SECONDS)
                                       .exceptionally(ex -> new Page(u, 0)))
            .toList();

        int totalWords = CompletableFuture
            .allOf(futures.toArray(new CompletableFuture[0]))
            .thenApply(v -> futures.stream().mapToInt(f -> f.join().words()).sum())
            .join();

        System.out.println("CompletableFuture: " + (System.currentTimeMillis() - t2)
                           + "ms, total words = " + totalWords);
        io.shutdown();

        // ── 4. Virtual threads (Java 21) ──────────────────────────
        long t3 = System.currentTimeMillis();
        try (var vpool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<Page>> fs = urls.stream()
                .map(u -> vpool.submit(() -> fetch(u)))
                .toList();
            for (Future<Page> f : fs) f.get();
        }
        System.out.println("Virtual threads: " + (System.currentTimeMillis() - t3) + "ms");

        // ── 5. Shared state, done right ───────────────────────────
        ConcurrentHashMap<String, Integer> stats = new ConcurrentHashMap<>();
        try (var pool = Executors.newFixedThreadPool(4)) {
            for (String u : urls) {
                pool.submit(() -> stats.merge(u.substring(u.indexOf('.') + 1),
                                              1, Integer::sum));
            }
        }
        System.out.println(stats);      // {com=1, org=1, net=1, io=1, dev=1}

        // ── 6. Backpressure with a bounded queue ──────────────────
        BlockingQueue<String> queue = new ArrayBlockingQueue<>(2);
        Thread producer = Thread.ofVirtual().start(() -> {
            try {
                for (String u : urls) { queue.put(u); System.out.println("produced " + u); }
                queue.put("DONE");
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        });
        Thread consumer = Thread.ofVirtual().start(() -> {
            try {
                String u;
                while (!(u = queue.take()).equals("DONE")) {
                    Thread.sleep(200);
                    System.out.println("  consumed " + u);
                }
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        });
        producer.join();
        consumer.join();
    }
}
```

---

## 10. Rules of thumb

1. **Don't create raw threads.** Use an executor.
2. **Always shut down executors** — ideally with try-with-resources (Java 19+).
3. **Never block the common ForkJoinPool** with I/O; pass your own executor.
4. **Prefer immutability and message passing over shared mutable state.**
5. **Use concurrent collections** rather than synchronizing ordinary ones.
6. **Wrap scheduled task bodies in try/catch** — an escaped exception cancels all future runs.
7. **Bound your queues.** Unbounded queues turn overload into `OutOfMemoryError`.
8. **On Java 21+, use virtual threads for I/O-bound work** and stop pooling.
9. **Measure.** Concurrency intuitions are wrong more often than they're right.

---

## 🧠 Rapid-fire recall

1. Name three problems with `new Thread(...)` per task that a pool solves.
2. What happens to an exception thrown inside a `Callable` submitted to an executor?
3. What's the difference between `thenApply` and `thenCompose`?
4. Why shouldn't you do blocking I/O on the default `CompletableFuture` executor?
5. What's the difference between `scheduleAtFixedRate` and `scheduleWithFixedDelay`?
6. What does a `BlockingQueue` give you beyond thread safety?
7. What changes about pooling advice when you use virtual threads, and why?

<details>
<summary>Answers</summary>

1. Thread creation cost (~1 MB stack + a syscall each), no limit on concurrency so the OS thrashes on context switches, and no way to get results or exceptions back.
2. It's captured and rethrown by `Future.get()` wrapped in an `ExecutionException`; use `getCause()` to unwrap it.
3. `thenApply` is `map` (the function returns a plain value); `thenCompose` is `flatMap` (the function returns another `CompletableFuture`).
4. It uses the common ForkJoinPool, which has only `cores - 1` threads and is shared with parallel streams — blocking it starves everything else in the JVM.
5. `atFixedRate` measures the interval from each task's start (so slow tasks can pile up); `withFixedDelay` measures from each task's completion, guaranteeing a gap.
6. Backpressure — `put` blocks when full and `take` blocks when empty, so a slow consumer throttles the producer instead of exhausting memory.
7. You stop pooling entirely — one virtual thread per task is correct, because virtual threads are cheap and unmount from their carrier OS thread while blocked on I/O.

</details>
