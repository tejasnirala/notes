---
title: Runnable vs Thread
author: Tejas Nirala
---

# Runnable vs Thread

In Java, both `Runnable` and `Thread` are used to define and execute code in a separate thread, but they are used differently and have key differences in terms of design and flexibility.

---

## 🔹 1. `Thread` Class

- `Thread` is a **class** in Java (`java.lang.Thread`) used to create and manage threads.
- You can create a thread by **extending** the `Thread` class and overriding its `run()` method.

### ✅ Example:

```java
class MyThread extends Thread {
    public void run() {
        System.out.println("Thread is running...");
    }
}

public class Main {
    public static void main(String[] args) {
        MyThread t1 = new MyThread();
        t1.start();  // starts a new thread
    }
}
```

---

## 🔹 2. `Runnable` Interface

- `Runnable` is a **functional interface** (has only one abstract method `run()`).
- To use it, you implement the interface and pass the object to a `Thread`.

### ✅ Example:

```java
class MyRunnable implements Runnable {
    public void run() {
        System.out.println("Runnable thread is running...");
    }
}

public class Main {
    public static void main(String[] args) {
        MyRunnable myRunnable = new MyRunnable();
        Thread t1 = new Thread(myRunnable);
        t1.start();  // starts a new thread
    }
}
```

---

## 🔸 Differences Between `Thread` and `Runnable`

| Feature | `Thread` | `Runnable` |
| --- | --- | --- |
| Type | Class | Interface |
| Inheritance | Requires subclassing `Thread` | Allows extending other classes |
| Separation of concerns | Logic and thread control are together | Logic and thread control are separated |
| Recommended usage | Not recommended (less flexible) | Recommended (more flexible and reusable) |
| Use in real-world applications | Rare | Very common (especially with executors) |
| Memory overhead | Slightly more (thread per object) | Less (multiple threads can share the same `Runnable`) |

---

## 🔹 When to Use What?

✅ **Use `Runnable` when**:

- You want to separate the task from the thread execution.
- You need to extend another class (Java doesn't support multiple inheritance with classes).
- You want to share a single task among multiple threads.

🚫 **Avoid extending `Thread`** unless:

- You are creating a simple, one-off thread without reusability.
- There's no need to extend another class.

---

## 3. The design argument, made concrete

### Reason 1: Java has single class inheritance

```java
class ReportGenerator extends BaseService { }        // you already used your one `extends`

class ReportGenerator extends BaseService, Thread { } // ❌ impossible

class ReportGenerator extends BaseService implements Runnable {   // ✅
    public void run() { generate(); }
}
```

The moment your class needs to be *anything else* in the hierarchy, `extends Thread` is off the table. That's not a stylistic preference — it's a hard limit.

### Reason 2: "is-a" vs "has-a"

`class MyTask extends Thread` says **"my task IS a thread."** It isn't. A task is a unit of work; a thread is a mechanism for executing it. Conflating them is exactly the kind of inheritance misuse discussed in [Pillars of OOP](./10-pillars-of-oop.md).

```java
// ❌ MyTask inherits ~40 public methods it has no business exposing
MyTask task = new MyTask();
task.setPriority(9);
task.interrupt();
task.setDaemon(true);
task.join();

// ✅ A Runnable exposes exactly one thing: what to do
Runnable task = () -> generateReport();
```

### Reason 3: One task, many threads

```java
Runnable job = () -> processQueue();

new Thread(job).start();
new Thread(job).start();
new Thread(job).start();      // ✅ one task object, three threads
```

With `extends Thread` you must allocate three full `Thread` objects, each with its own state, name, priority and (once started) an OS thread with its own ~1 MB stack.

### Reason 4 — the decisive one: `Runnable` works with everything else

The entire `java.util.concurrent` package speaks `Runnable` and `Callable`, not `Thread`:

```java
executorService.submit(runnable);
scheduledExecutor.scheduleAtFixedRate(runnable, 0, 1, TimeUnit.SECONDS);
CompletableFuture.runAsync(runnable);
new Thread(runnable);
ForkJoinPool.commonPool().execute(runnable);
```

A `Thread` subclass fits none of those APIs. By separating "what to do" from "how to run it", you can hand the same task to a pool, a scheduler, a virtual thread, or a test that runs it inline.

---

## 4. What `Thread` actually does with your `Runnable`

```java
// java.lang.Thread — simplified
public class Thread implements Runnable {
    private Runnable target;

    public Thread(Runnable target) { this.target = target; }

    @Override
    public void run() {
        if (target != null) {
            target.run();       // delegate to the Runnable
        }
    }
}
```

Two things fall out of this:

**(a) `Thread` itself implements `Runnable`.** So `new Thread(new Thread(r))` compiles. Don't.

**(b) When you `extends Thread` and override `run()`, you're replacing the delegation.** That's why passing a `Runnable` to a `Thread` subclass that also overrides `run()` silently ignores the Runnable:

```java
class MyThread extends Thread {
    MyThread(Runnable r) { super(r); }
    @Override public void run() { System.out.println("subclass wins"); }
}

new MyThread(() -> System.out.println("runnable")).start();   // "subclass wins"
```

---

## 🔸 Bonus: Using Lambda with `Runnable`

Since `Runnable` is a functional interface, you can use lambda:

```java
Thread t = new Thread(() -> {
    System.out.println("Runnable using lambda");
});
t.start();
```

This settles the argument for good — the `Runnable` version is now *shorter* than the `Thread` subclass version as well as more flexible:

```java
// extends Thread
class MyThread extends Thread {
    public void run() { System.out.println("hi"); }
}
new MyThread().start();

// Runnable lambda
new Thread(() -> System.out.println("hi")).start();
```

---

## 5. `Callable` — when the task returns something

`Runnable.run()` returns `void` and cannot throw a checked exception. `Callable<V>` fixes both:

```java
@FunctionalInterface
public interface Runnable {
    void run();                     // no return value, no checked exceptions
}

@FunctionalInterface
public interface Callable<V> {
    V call() throws Exception;      // returns a value, may throw
}
```

```java
import java.util.concurrent.*;

ExecutorService pool = Executors.newFixedThreadPool(2);

// Runnable — fire and forget
pool.submit(() -> System.out.println("no result"));

// Callable — get a result back
Future<Integer> future = pool.submit(() -> {
    Thread.sleep(500);
    return 42;                       // ✅ returns a value
});

System.out.println(future.get());    // 42 — blocks until the task completes
pool.shutdown();
```

`Future.get()` also **rethrows any exception** the task threw, wrapped in an `ExecutionException`:

```java
Future<Integer> f = pool.submit(() -> { throw new IllegalStateException("boom"); });
try {
    f.get();
} catch (ExecutionException e) {
    System.out.println(e.getCause().getMessage());   // boom
}
```

With a raw `Thread`, an exception in `run()` just kills the thread and prints a stack trace — the caller never finds out. That's another strong reason to use executors over raw threads.

### Comparison

| | `Runnable` | `Callable<V>` |
| :-- | :-- | :-- |
| Method | `run()` | `call()` |
| Returns | `void` | `V` |
| Checked exceptions | ❌ cannot throw | ✅ `throws Exception` |
| Usable with `new Thread(...)` | ✅ | ❌ (needs an executor or `FutureTask`) |
| Usable with `ExecutorService.submit` | ✅ | ✅ |

---

## 6. The full progression

```java
// 1. Java 1.0 — extend Thread
class Task extends Thread {
    public void run() { doWork(); }
}
new Task().start();

// 2. Java 1.0 — implement Runnable (already better)
class Task implements Runnable {
    public void run() { doWork(); }
}
new Thread(new Task()).start();

// 3. Java 5 — executors, so you stop managing threads at all
ExecutorService pool = Executors.newFixedThreadPool(4);
pool.submit(() -> doWork());

// 4. Java 8 — lambdas + CompletableFuture for composition
CompletableFuture.supplyAsync(() -> fetchData())
                 .thenApply(this::transform)
                 .thenAccept(this::save);

// 5. Java 21 — virtual threads: cheap enough to have one per task
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (var request : requests) {
        executor.submit(() -> handle(request));     // millions of these are fine
    }
}
```

Notice the direction of travel: **you write less and less about threads, and more and more about tasks.** `extends Thread` is at the wrong end of that arc.

---

## Worked example

```java
import java.util.*;
import java.util.concurrent.*;

public class RunnableVsThreadDemo {

    // ❌ The old way — the task IS a thread, tied to one execution model
    static class DownloadThread extends Thread {
        private final String url;
        DownloadThread(String url) { this.url = url; }
        @Override public void run() { System.out.println("Downloading " + url); }
    }

    // ✅ The task is just a task — runnable anywhere
    record DownloadTask(String url) implements Runnable {
        @Override public void run() { System.out.println("Downloading " + url); }
    }

    // ✅ And when you need a result back
    record SizeTask(String url) implements Callable<Integer> {
        @Override public Integer call() { return url.length() * 100; }
    }

    public static void main(String[] args) throws Exception {
        List<String> urls = List.of("a.com", "b.org", "c.net");

        // Old style — one Thread object per download, no reuse, no results
        for (String url : urls) new DownloadThread(url).start();
        Thread.sleep(100);
        System.out.println("---");

        // Runnable with a plain Thread
        for (String url : urls) new Thread(new DownloadTask(url)).start();
        Thread.sleep(100);
        System.out.println("---");

        // The SAME Runnable, now on a pool — no code change needed
        ExecutorService pool = Executors.newFixedThreadPool(2);
        for (String url : urls) pool.submit(new DownloadTask(url));

        // Callable — results come back
        List<Future<Integer>> sizes = new ArrayList<>();
        for (String url : urls) sizes.add(pool.submit(new SizeTask(url)));
        for (Future<Integer> f : sizes) System.out.println("Size: " + f.get());

        pool.shutdown();
        pool.awaitTermination(5, TimeUnit.SECONDS);
    }
}
```

The `DownloadTask` never changed between running on a raw `Thread` and running on a pool. `DownloadThread` could never make that move.

---

## 🧠 Rapid-fire recall

1. Give the four main reasons to prefer `Runnable` over `extends Thread`.
2. What happens if you both pass a `Runnable` to a `Thread` subclass and override `run()`?
3. Can `Thread` be passed where a `Runnable` is expected? Why?
4. What two things can `Callable` do that `Runnable` cannot?
5. What happens to an exception thrown inside `Thread.run()` versus inside a `Callable` submitted to an executor?
6. Why does `ExecutorService` accept `Runnable`/`Callable` rather than `Thread`?
7. Rewrite `class T extends Thread { public void run() { work(); } } new T().start();` in the modern style.

<details>
<summary>Answers</summary>

1. Java allows only one superclass; a task "is-a" thread is a wrong model (has-a is right); one `Runnable` can be shared by many threads; and the entire concurrency API speaks `Runnable`/`Callable`, not `Thread`.
2. The subclass's `run()` replaces `Thread.run()`, so the delegation to the target `Runnable` never happens and the Runnable is ignored.
3. Yes — `Thread` itself implements `Runnable`. It compiles but is almost always a mistake.
4. Return a value, and throw a checked exception.
5. In a raw `Thread` it kills the thread and prints a stack trace that the caller never sees; from an executor it's captured and rethrown by `Future.get()` as an `ExecutionException`.
6. Separating the task from the execution mechanism lets the same task run on a pool, a scheduler, a virtual thread, or inline in a test.
7. `new Thread(() -> work()).start();` — or better, `executor.submit(this::work);`.

</details>
