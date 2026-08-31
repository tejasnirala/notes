---
title: Threads & Multithreading
author: Tejas Nirala
---

# Threads in Java

---

## 🔹 What is a Thread in Java?

A **Thread** in Java is a lightweight process that enables concurrent execution of two or more parts of a program. Every thread runs in parallel and can perform tasks independently.

Java supports **multithreading** — the ability to run multiple threads simultaneously — using the `java.lang.Thread` class or implementing the `Runnable` interface.

### Process vs Thread

```
      PROCESS (one JVM)
   ┌──────────────────────────────────────────────┐
   │  HEAP (shared by all threads)                │
   │  ┌────────────────────────────────────────┐  │
   │  │  objects, arrays, static fields        │  │
   │  └────────────────────────────────────────┘  │
   │                                               │
   │  Thread 1        Thread 2        Thread 3     │
   │  ┌────────┐      ┌────────┐      ┌────────┐  │
   │  │ stack  │      │ stack  │      │ stack  │  │  ← each thread gets its own
   │  │ PC reg │      │ PC reg │      │ PC reg │  │
   │  └────────┘      └────────┘      └────────┘  │
   └──────────────────────────────────────────────┘
```

- **Each thread has its own stack** (local variables, call frames) — private.
- **All threads share the heap** (objects, static fields) — and that sharing is exactly where every concurrency bug comes from.

If you're coming from **JavaScript**, this is the big conceptual shift. JavaScript is single-threaded with an event loop: two pieces of your code never run at literally the same instant, so shared state is safe. Java runs code on genuinely simultaneous CPU cores, so two threads *can* be inside the same method, touching the same field, at the same nanosecond.

---

## 🔹 Life Cycle of a Thread

```
New → Runnable → Running → Blocked/Waiting → Terminated
```

1. **New**: Thread is created but not started.
2. **Runnable**: `start()` is called, and it's ready to run.
3. **Running**: JVM picks the thread for execution.
4. **Blocked/Waiting**: Thread is paused due to wait/sleep/I/O.
5. **Terminated**: Execution completes or is stopped.

Full detail on the [Thread States](./36-thread-states.md) page.

---

## 🔹 Creating Threads in Java

### ✅ 1. By Extending the Thread class

```java
class MyThread extends Thread {
    public void run() {
        System.out.println("Thread is running...");
    }
}

public class Main {
    public static void main(String[] args) {
        MyThread t1 = new MyThread();
        t1.start();  // starts the thread
    }
}
```

---

### ✅ 2. By Implementing Runnable Interface

```java
class MyRunnable implements Runnable {
    public void run() {
        System.out.println("Thread using Runnable...");
    }
}

public class Main {
    public static void main(String[] args) {
        Thread t1 = new Thread(new MyRunnable());
        t1.start();
    }
}
```

### ⚠️ `start()` vs `run()` — the classic mistake

```java
Thread t = new Thread(() -> System.out.println(Thread.currentThread().getName()));

t.start();    // "Thread-0"  — creates a NEW thread and calls run() on it ✅
t.run();      // "main"      — just an ordinary method call on the CURRENT thread ❌
```

`run()` is a plain method. `start()` is what asks the OS for a thread. Calling `run()` directly gives you zero concurrency and no error message — the code just quietly runs sequentially.

Also: **a thread can only be started once.**

```java
t.start();
t.start();    // 💥 IllegalThreadStateException
```

### ✅ 3. With a lambda (the modern way)

Since `Runnable` is a functional interface:

```java
Thread t = new Thread(() -> System.out.println("Running with lambda"));
t.start();
```

---

## 🔹 Thread Methods

| Method | Description |
| --- | --- |
| `start()` | Starts the thread |
| `run()` | Entry point of the thread logic |
| `sleep(ms)` | Pauses the thread for given milliseconds |
| `join()` | Waits for thread to finish |
| `isAlive()` | Checks if thread is alive |
| `setName()` | Set thread's name |
| `getName()` | Get thread's name |
| `setPriority()` | Set priority (1 to 10) |
| `yield()` | Suggests giving other threads a chance |

### More you'll meet

| Method | Description |
| :-- | :-- |
| `Thread.currentThread()` | The thread executing right now |
| `interrupt()` | Politely asks a thread to stop |
| `isInterrupted()` | Has this thread been interrupted? |
| `setDaemon(true)` | Make it a background thread |
| `getState()` | The current `Thread.State` |
| ~~`stop()`, `suspend()`, `resume()`~~ | **Deprecated and unsafe** — never use |

### `join()` — waiting for a thread to finish

```java
Thread t1 = new Thread(() -> heavyWork());
Thread t2 = new Thread(() -> otherWork());

t1.start();
t2.start();

t1.join();          // main waits here until t1 finishes
t2.join();          // then until t2 finishes

System.out.println("Both done");   // guaranteed to print last
```

Without the `join()` calls, `main` would print "Both done" immediately, probably before either thread had done anything.

### `interrupt()` — the correct way to stop a thread

There is no way to forcibly kill a thread safely (`Thread.stop()` was deprecated because it could leave objects half-modified). Instead you **request** cooperation:

```java
Thread worker = new Thread(() -> {
    while (!Thread.currentThread().isInterrupted()) {
        doWork();
    }
    System.out.println("Cleaning up and exiting");
});

worker.start();
Thread.sleep(1000);
worker.interrupt();       // sets the interrupt flag
```

If the thread is blocked in `sleep()`, `wait()` or `join()`, `interrupt()` makes that call throw `InterruptedException` **and clears the flag** — so you must re-set it:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();    // ✅ restore the flag
    return;                                 // and stop
}
```

> **Never write `catch (InterruptedException e) { }`.** Swallowing it makes the thread unstoppable.

---

## 🔹 Example: Multiple Threads

```java
class PrintJob implements Runnable {
    private String jobName;

    public PrintJob(String jobName) {
        this.jobName = jobName;
    }

    public void run() {
        System.out.println(jobName + " started by " + Thread.currentThread().getName());
        try {
            Thread.sleep(1000);
        } catch (InterruptedException e) {}
        System.out.println(jobName + " finished by " + Thread.currentThread().getName());
    }
}

public class Main {
    public static void main(String[] args) {
        Thread t1 = new Thread(new PrintJob("Job1"));
        Thread t2 = new Thread(new PrintJob("Job2"));
        t1.start();
        t2.start();
    }
}
```

Run it several times and note that **the output order changes**. That's not a bug — it's the defining property of concurrency. You do not control the scheduler.

---

## 🔹 Thread Priorities

Java threads have priorities from **1 (MIN_PRIORITY)** to **10 (MAX_PRIORITY)**. Default is **5 (NORM_PRIORITY)**.

```java
thread.setPriority(Thread.MAX_PRIORITY);
```

Note: Thread priorities are hints to the scheduler, not strict rules.

In practice they are almost entirely ignored — the OS scheduler maps them differently on every platform, and on some they do nothing at all. **Never write code whose correctness depends on priority.**

---

## 🔹 Thread Synchronization

When multiple threads access shared resources, you need synchronization to prevent **race conditions**.

```java
synchronized void increment() {
    count++;
}
```

Or:

```java
synchronized (this) {
    // critical section
}
```

### What `synchronized` actually does

Every Java object has an invisible **monitor lock**. `synchronized` acquires it on entry and releases it on exit (including on exception). Only one thread can hold a given object's monitor at a time.

```java
class Counter {
    private int count = 0;

    // Locks on `this`
    public synchronized void increment() { count++; }

    // Exactly equivalent, but explicit
    public void increment2() {
        synchronized (this) { count++; }
    }

    // A static synchronized method locks on Counter.class, NOT on any instance
    public static synchronized void staticMethod() { }
}
```

**Prefer a dedicated lock object** so external code can't accidentally lock on your instance:

```java
class Counter {
    private final Object lock = new Object();     // private, nobody else can grab it
    private int count = 0;

    public void increment() {
        synchronized (lock) { count++; }
    }
}
```

**Keep the critical section as small as possible:**

```java
// ❌ Holds the lock through slow I/O — every other thread waits
synchronized void process(Data d) {
    var result = expensiveNetworkCall(d);
    cache.put(d.key(), result);
}

// ✅ Only the shared-state mutation is locked
void process(Data d) {
    var result = expensiveNetworkCall(d);        // outside the lock
    synchronized (lock) { cache.put(d.key(), result); }
}
```

### `volatile` — visibility, not atomicity

```java
class Worker implements Runnable {
    private volatile boolean running = true;      // ← without volatile this can hang forever

    public void run() {
        while (running) { doWork(); }
    }

    public void stop() { running = false; }
}
```

Without `volatile`, the JVM may cache `running` in a CPU register and never re-read it, so the loop never sees the change. `volatile` guarantees every read sees the latest write from any thread.

But `volatile` does **not** make compound operations atomic:

```java
private volatile int count;
count++;              // ❌ still a race — this is read, add, write (three steps)
```

For that you need `synchronized` or an `Atomic` class. See [Race Conditions](./38-race-conditions.md).

### Deadlock — the failure mode to recognise

```java
// Thread 1                          Thread 2
synchronized (lockA) {               synchronized (lockB) {
    synchronized (lockB) { ... }         synchronized (lockA) { ... }
}                                    }
```

Thread 1 holds A and wants B; thread 2 holds B and wants A. Neither can proceed, forever. **The standard fix: always acquire locks in the same global order** (e.g. always A then B).

---

## 🔹 Daemon Threads

Daemon threads run in the background (like garbage collector).

```java
Thread t = new Thread(new MyRunnable());
t.setDaemon(true);
t.start();
```

Daemon threads die when all user threads die.

More precisely: the JVM exits when **only** daemon threads remain — it does not wait for them, and it does not run their `finally` blocks. So never put important cleanup in a daemon thread. Good for monitoring, heartbeats, cache eviction; bad for anything that must finish.

`setDaemon()` must be called **before** `start()`.

---

## 🔹 Thread Pool (ExecutorService)

Better for handling large numbers of threads efficiently.

```java
import java.util.concurrent.*;

public class Main {
    public static void main(String[] args) {
        ExecutorService service = Executors.newFixedThreadPool(3);
        for (int i = 0; i < 5; i++) {
            service.execute(() -> System.out.println("Running in: " + Thread.currentThread().getName()));
        }
        service.shutdown();
    }
}
```

**Why pools matter:** creating a thread is expensive (~1 MB of stack, plus an OS-level system call). A pool creates a few threads once and reuses them for many tasks. A web server creating a fresh thread per request would collapse under load; with a pool, it queues.

Full treatment on [Executors & Futures](./39-executors-and-futures.md).

> **Java 21 note:** *virtual threads* (`Thread.ofVirtual()`) make threads cheap enough that you can have millions of them. They're managed by the JVM rather than the OS, which changes a lot of this advice for I/O-bound workloads. Covered briefly in the Executors chapter.

---

## 🔹 Summary

| Topic | Description |
| --- | --- |
| Thread | Lightweight sub-process |
| Runnable | Functional interface for thread logic |
| Synchronization | Prevents race conditions |
| ThreadPool | Efficient thread management |
| Daemon Threads | Background threads |

---

## Worked example

```java
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public class ThreadDemo {
    public static void main(String[] args) throws InterruptedException {

        // 1. Basic threads with join
        Thread t1 = new Thread(() -> work("Alpha", 3), "worker-1");
        Thread t2 = new Thread(() -> work("Beta", 3),  "worker-2");
        t1.start();
        t2.start();
        t1.join();
        t2.join();
        System.out.println("--- both finished ---");

        // 2. Unsynchronized shared counter — demonstrates the problem
        var unsafe = new Object() { int count = 0; };
        Thread a = new Thread(() -> { for (int i = 0; i < 100_000; i++) unsafe.count++; });
        Thread b = new Thread(() -> { for (int i = 0; i < 100_000; i++) unsafe.count++; });
        a.start(); b.start(); a.join(); b.join();
        System.out.println("Unsafe count: " + unsafe.count);   // usually < 200000 😱

        // 3. The same, done safely
        AtomicInteger safe = new AtomicInteger();
        Thread c = new Thread(() -> { for (int i = 0; i < 100_000; i++) safe.incrementAndGet(); });
        Thread d = new Thread(() -> { for (int i = 0; i < 100_000; i++) safe.incrementAndGet(); });
        c.start(); d.start(); c.join(); d.join();
        System.out.println("Safe count: " + safe.get());        // exactly 200000 ✅

        // 4. Cooperative cancellation
        Thread poller = new Thread(() -> {
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    Thread.sleep(200);
                    System.out.println("poll...");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();          // restore the flag
                }
            }
            System.out.println("poller stopped cleanly");
        });
        poller.start();
        Thread.sleep(700);
        poller.interrupt();
        poller.join();

        // 5. A thread pool instead of raw threads
        ExecutorService pool = Executors.newFixedThreadPool(2);
        for (int i = 1; i <= 4; i++) {
            int id = i;
            pool.submit(() -> System.out.println("Task " + id + " on " +
                                Thread.currentThread().getName()));
        }
        pool.shutdown();
        pool.awaitTermination(5, TimeUnit.SECONDS);
    }

    static void work(String label, int steps) {
        for (int i = 1; i <= steps; i++) {
            System.out.println(label + " step " + i + " [" +
                               Thread.currentThread().getName() + "]");
            try { Thread.sleep(100); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); return; }
        }
    }
}
```

---

## 🧠 Rapid-fire recall

1. What does each thread have of its own, and what do all threads share?
2. What's the difference between `t.start()` and `t.run()`?
3. What happens if you call `start()` twice on the same thread?
4. Why is `Thread.stop()` deprecated, and how do you stop a thread instead?
5. What does `volatile` guarantee, and what does it *not* guarantee?
6. When does the JVM exit with respect to daemon threads?
7. What is a deadlock, and what is the standard way to prevent one?

<details>
<summary>Answers</summary>

1. Each thread has its own stack and program counter; all threads share the heap (objects and static fields).
2. `start()` asks the OS for a new thread and runs `run()` on it; `run()` is an ordinary method call on the current thread with no concurrency at all.
3. `IllegalThreadStateException` — a thread can only be started once.
4. It could kill a thread mid-update, leaving shared objects in a corrupt state. Use `interrupt()` and have the thread check `isInterrupted()` and exit cooperatively.
5. It guarantees visibility — every read sees the most recent write from any thread. It does not make compound operations like `count++` atomic.
6. When only daemon threads remain, the JVM exits immediately without waiting for them or running their `finally` blocks.
7. Two threads each holding a lock the other needs, so neither can proceed. Prevent it by always acquiring locks in a consistent global order.

</details>
