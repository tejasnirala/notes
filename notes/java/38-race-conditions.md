---
title: Race Conditions
author: Tejas Nirala
---

# Race Condition in Java

---

## ✅ What is a Race Condition?

A **race condition** in Java occurs **when two or more threads access shared data at the same time**, and **the final outcome depends on the sequence of thread execution**. This can lead to **inconsistent or unpredictable behavior** in a multithreaded application.

---

## 🚩 Why is it a problem?

Because thread scheduling is handled by the JVM and OS, **you can't predict which thread will execute when**. If threads modify shared data without proper synchronization, you may end up with:

- Corrupted data
- Wrong outputs
- Application crashes

And the worst property of all: **race conditions are non-deterministic**. The same code passes your tests a hundred times, then fails in production at 3 a.m. under load. They don't reproduce on demand, which is what makes them the hardest class of bug in the language.

---

## 🧠 Real-life Analogy:

Two people editing the same Google Doc at the same time but without live sync. One edits line 1 while another edits line 2, but both save the document at the same time — the last one to save **overwrites** the other's changes.

---

## ⚠️ Example of Race Condition

```java
class Counter {
    int count = 0;

    public void increment() {
        count++;
    }
}

public class RaceConditionExample {
    public static void main(String[] args) throws InterruptedException {
        Counter counter = new Counter();

        Thread t1 = new Thread(() -> {
            for(int i = 0; i < 1000; i++) counter.increment();
        });

        Thread t2 = new Thread(() -> {
            for(int i = 0; i < 1000; i++) counter.increment();
        });

        t1.start();
        t2.start();

        t1.join();
        t2.join();

        System.out.println("Final count: " + counter.count);
    }
}
```

🧨 **Expected output:** `2000`

😱 **Actual output:** It may be **less than 2000** due to race conditions!

> With only 1,000 iterations the threads often don't overlap enough to lose an increment. Bump both loops to **1,000,000** and you will see it fail almost every run. That difficulty of reproduction is precisely the danger.

---

## 💡 Why it happens?

The operation `count++` is **not atomic**. It involves three steps:

1. Read `count`
2. Add `1`
3. Write back the result

Multiple threads may **read the same value before the other writes it**, so increments get lost.

### Watch it happen, step by step

```
count = 5

Time   Thread A                    Thread B                    count
────────────────────────────────────────────────────────────────────
 t1    read count → 5                                            5
 t2                                read count → 5                5
 t3    add 1     → 6                                             5
 t4                                add 1     → 6                 5
 t5    write 6                                                   6
 t6                                write 6                       6   ← LOST!
```

Two increments happened. The count went up by one. That's a **lost update**.

You can see it in the bytecode:

```
getfield  count      // read
iconst_1
iadd                 // add
putfield  count      // write
```

Four instructions. A thread can be pre-empted between any two of them.

### The second, subtler problem: visibility

Even without interleaving, a thread may simply **never see** another thread's write:

```java
class Worker implements Runnable {
    private boolean running = true;         // no volatile

    public void run() {
        while (running) { }                 // may loop forever
        System.out.println("stopped");
    }

    public void stop() { running = false; }
}
```

The JIT compiler is allowed to hoist `running` into a CPU register, because as far as *this thread* can tell, nothing modifies it. The write from another thread lands in main memory and is never re-read.

So there are really **two** problems to solve:

| Problem | Meaning | Fixed by |
| :-- | :-- | :-- |
| **Atomicity** | Compound operations can be interleaved | `synchronized`, `Atomic*`, `Lock` |
| **Visibility** | One thread's write may not be seen by another | `volatile`, `synchronized`, `Atomic*` |

`volatile` fixes visibility only. `synchronized` and the `Atomic` classes fix both.

---

## ✅ How to Prevent Race Conditions in Java

### 1. Use `synchronized` keyword

```java
public synchronized void increment() {
    count++;
}
```

Or synchronize a block:

```java
public void increment() {
    synchronized(this) {
        count++;
    }
}
```

`synchronized` gives you **mutual exclusion** (only one thread in the block at a time) **and** a memory barrier (everything written before the release is visible after the next acquire). That's why it fixes both problems.

Prefer a **private lock object** so external code can't interfere:

```java
class Counter {
    private final Object lock = new Object();
    private int count = 0;

    public void increment() {
        synchronized (lock) { count++; }
    }

    public int get() {
        synchronized (lock) { return count; }    // reads need it too, for visibility!
    }
}
```

> ⚠️ A very common half-fix: synchronizing the writes but not the reads. Without synchronization on `get()`, a reader may see a stale value.

### 2. Use `AtomicInteger`

```java
import java.util.concurrent.atomic.AtomicInteger;

class Counter {
    AtomicInteger count = new AtomicInteger(0);

    public void increment() {
        count.incrementAndGet();
    }
}
```

`incrementAndGet()` compiles down to a single **CAS (compare-and-swap)** CPU instruction. No lock, no blocking, no context switch — just a hardware guarantee that the read-modify-write happens atomically.

```java
// Conceptually, CAS in a loop:
int current;
do {
    current = get();                          // read
} while (!compareAndSet(current, current+1)); // write only if it hasn't changed
```

The full family:

```java
AtomicInteger  ai = new AtomicInteger(0);
AtomicLong     al = new AtomicLong(0);
AtomicBoolean  ab = new AtomicBoolean(false);
AtomicReference<Config> ref = new AtomicReference<>(config);

ai.incrementAndGet();          // ++i
ai.getAndIncrement();          // i++
ai.addAndGet(5);
ai.compareAndSet(10, 20);      // set to 20 only if currently 10
ai.updateAndGet(x -> x * 2);
ai.accumulateAndGet(5, Integer::sum);

// For very high contention, LongAdder beats AtomicLong (it shards the counter)
LongAdder adder = new LongAdder();
adder.increment();
adder.sum();
```

**Atomics are faster than `synchronized` under low-to-moderate contention** because there's no blocking. Under heavy contention, the CAS retry loop can spin, and `LongAdder` becomes the better choice.

### 3. Use `ReentrantLock`

```java
import java.util.concurrent.locks.ReentrantLock;

class Counter {
    private int count = 0;
    private ReentrantLock lock = new ReentrantLock();

    public void increment() {
        lock.lock();
        try {
            count++;
        } finally {
            lock.unlock();
        }
    }
}
```

> The `try/finally` is **mandatory**. `synchronized` releases automatically on exception; `ReentrantLock` does not. Forgetting `finally` means one exception permanently deadlocks your application.

What `ReentrantLock` gives you that `synchronized` cannot:

```java
// Try, and give up rather than block forever
if (lock.tryLock()) {
    try { ... } finally { lock.unlock(); }
} else {
    System.out.println("busy, skipping");
}

// Try with a timeout
if (lock.tryLock(1, TimeUnit.SECONDS)) { ... }

// Interruptible — the thread can be cancelled while waiting
lock.lockInterruptibly();

// Fair ordering — longest waiter goes first (slower, but no starvation)
ReentrantLock fair = new ReentrantLock(true);

// Multiple independent condition queues
Condition notEmpty = lock.newCondition();
Condition notFull  = lock.newCondition();
```

### 4. Use immutable objects (the best fix of all)

If nothing can change, nothing can race.

```java
public record Point(int x, int y) { }         // immutable — inherently thread-safe

// "Modifying" produces a new object; no shared mutable state exists
AtomicReference<Point> position = new AtomicReference<>(new Point(0, 0));
position.updateAndGet(p -> new Point(p.x() + 1, p.y()));
```

`String`, `Integer`, `LocalDate`, `BigDecimal` and records are all safe to share across threads without any synchronization at all.

### 5. Don't share state (better than synchronizing it)

```java
// ❌ Shared mutable accumulator
List<String> results = new ArrayList<>();
items.parallelStream().forEach(results::add);    // race — ArrayList isn't thread-safe

// ✅ No shared state — let the framework merge
List<String> results = items.parallelStream().map(this::process).toList();

// ✅ Or give each thread its own
ThreadLocal<SimpleDateFormat> fmt =
    ThreadLocal.withInitial(() -> new SimpleDateFormat("yyyy-MM-dd"));
```

### 6. Use concurrent collections

```java
Map<String, Integer> counts = new ConcurrentHashMap<>();
counts.merge("key", 1, Integer::sum);       // atomic, no external locking

BlockingQueue<Task> queue = new LinkedBlockingQueue<>();
queue.put(task);        // blocks if full
Task t = queue.take();  // blocks if empty
```

> ⚠️ A concurrent collection makes each **individual** operation atomic — not sequences of them:
> ```java
> if (!map.containsKey(k)) map.put(k, v);      // ❌ still a race (check-then-act)
> map.putIfAbsent(k, v);                        // ✅ one atomic operation
> ```

---

## ✅ Summary

| Concept | Safe? | Notes |
| --- | --- | --- |
| `count++` | ❌ | Not atomic |
| `synchronized` | ✅ | Simple and effective |
| `AtomicInteger` | ✅ | Lightweight and lock-free |
| `ReentrantLock` | ✅ | More control over locking |

Extended:

| Approach | Atomicity | Visibility | Blocking | Best for |
| :-- | :-- | :-- | :-- | :-- |
| nothing | ❌ | ❌ | — | never |
| `volatile` | ❌ | ✅ | no | a simple flag, single writer |
| `synchronized` | ✅ | ✅ | yes | general-purpose, multi-step critical sections |
| `Atomic*` | ✅ | ✅ | no | single-variable counters and flags |
| `LongAdder` | ✅ | ✅ | no | very high-contention counters |
| `ReentrantLock` | ✅ | ✅ | yes | need `tryLock`, timeouts, or conditions |
| immutability | n/a | n/a | no | **the best option when it applies** |
| concurrent collections | per-op | ✅ | mostly no | shared maps, queues, lists |

---

## 4. Other race-condition shapes to recognise

Lost updates aren't the only kind.

### Check-then-act

```java
// ❌ Two threads can both pass the check
if (!map.containsKey(key)) {
    map.put(key, computeValue());
}

// ✅
map.computeIfAbsent(key, k -> computeValue());
```

### Read-modify-write

```java
// ❌
balance = balance - amount;

// ✅
synchronized (lock) { balance -= amount; }
```

### Unsafe lazy initialization

```java
// ❌ Two threads can both see null and both construct
private Config config;
public Config get() {
    if (config == null) config = new Config();
    return config;
}

// ✅ Holder idiom — thread-safe, lazy, no synchronization cost after init
private static class Holder {
    static final Config INSTANCE = new Config();
}
public static Config get() { return Holder.INSTANCE; }
```

The holder idiom works because the JVM guarantees class initialization is thread-safe and happens exactly once, on first access.

### Escaping `this` from a constructor

```java
// ❌ The listener may see a half-constructed object
public Service() {
    registry.register(this);        // published before the constructor finishes!
    this.name = "service";
}
```

---

## 5. Worked example: a bank account, three ways

```java
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.concurrent.locks.*;

public class RaceDemo {

    interface Account { void deposit(int n); int balance(); }

    static class Unsafe implements Account {
        private int balance = 0;
        public void deposit(int n) { balance += n; }
        public int balance() { return balance; }
    }

    static class Synchronized implements Account {
        private final Object lock = new Object();
        private int balance = 0;
        public void deposit(int n) { synchronized (lock) { balance += n; } }
        public int balance()       { synchronized (lock) { return balance; } }
    }

    static class Atomic implements Account {
        private final AtomicInteger balance = new AtomicInteger();
        public void deposit(int n) { balance.addAndGet(n); }
        public int balance()       { return balance.get(); }
    }

    static class Locked implements Account {
        private final ReentrantLock lock = new ReentrantLock();
        private int balance = 0;
        public void deposit(int n) {
            lock.lock();
            try { balance += n; }
            finally { lock.unlock(); }         // ← never omit this
        }
        public int balance() {
            lock.lock();
            try { return balance; }
            finally { lock.unlock(); }
        }
    }

    static void hammer(Account acc, String label) throws Exception {
        int threads = 8, perThread = 100_000;
        var pool = Executors.newFixedThreadPool(threads);
        long start = System.nanoTime();

        for (int i = 0; i < threads; i++) {
            pool.submit(() -> { for (int j = 0; j < perThread; j++) acc.deposit(1); });
        }
        pool.shutdown();
        pool.awaitTermination(30, TimeUnit.SECONDS);

        long ms = (System.nanoTime() - start) / 1_000_000;
        int expected = threads * perThread;
        System.out.printf("%-14s expected=%d actual=%d  %s  (%d ms)%n",
            label, expected, acc.balance(),
            acc.balance() == expected ? "✅" : "❌ LOST UPDATES", ms);
    }

    public static void main(String[] args) throws Exception {
        hammer(new Unsafe(),       "Unsafe");
        hammer(new Synchronized(), "Synchronized");
        hammer(new Atomic(),       "Atomic");
        hammer(new Locked(),       "ReentrantLock");
    }
}
```

Typical output:

```
Unsafe         expected=800000 actual=214773  ❌ LOST UPDATES  (24 ms)
Synchronized   expected=800000 actual=800000  ✅  (61 ms)
Atomic         expected=800000 actual=800000  ✅  (38 ms)
ReentrantLock  expected=800000 actual=800000  ✅  (55 ms)
```

Three things to take away:

1. The unsafe version lost **over 70%** of its updates. This is not a rare edge case.
2. It was also the *fastest* — which is exactly why the bug is tempting and why "it seems to work" is not evidence.
3. `Atomic` beat the lock-based approaches, as expected for a single-variable counter.

---

## 🧠 Rapid-fire recall

1. Why isn't `count++` atomic? How many bytecode instructions is it?
2. What are the two distinct problems concurrency creates, and which keyword fixes which?
3. Why is `volatile` insufficient for a counter?
4. Why must `ReentrantLock.unlock()` be in a `finally` block?
5. What does `AtomicInteger.incrementAndGet()` use under the hood, and why is it faster than a lock?
6. Why is `if (!map.containsKey(k)) map.put(k, v)` still a race on a `ConcurrentHashMap`?
7. What is the single most reliable way to avoid race conditions entirely?

<details>
<summary>Answers</summary>

1. It's a read-modify-write: four bytecode instructions (`getfield`, `iconst_1`, `iadd`, `putfield`), and a thread can be pre-empted between any two.
2. Atomicity (operations can interleave) and visibility (writes may not be seen by other threads). `volatile` fixes only visibility; `synchronized` and the `Atomic` classes fix both.
3. `volatile` guarantees each read sees the latest write, but the read-add-write sequence can still interleave, so updates are still lost.
4. Unlike `synchronized`, it isn't released automatically on exception — without `finally`, one thrown exception deadlocks the application permanently.
5. A hardware compare-and-swap (CAS) instruction. It never blocks or context-switches, so under low-to-moderate contention it's much cheaper than acquiring a monitor.
6. Each operation is individually atomic, but the sequence isn't — two threads can both pass the `containsKey` check. Use `putIfAbsent` or `computeIfAbsent`.
7. Don't share mutable state: use immutable objects (records, `String`), or give each thread its own data.

</details>
