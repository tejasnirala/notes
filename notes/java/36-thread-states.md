---
title: Thread States
author: Tejas Nirala
---

# Thread States in Java

Java threads follow a well-defined **life cycle**, which consists of **six states** as per the `java.lang.Thread.State` enum.

---

## 📊 All Thread States

```
NEW → RUNNABLE → RUNNING → WAITING/TIMED_WAITING/BLOCKED → TERMINATED
```

> A note before we start: the `Thread.State` **enum** actually has six constants — `NEW`, `RUNNABLE`, `BLOCKED`, `WAITING`, `TIMED_WAITING`, `TERMINATED`. There is **no separate `RUNNING` constant**; the JVM folds "ready to run" and "actually executing on a CPU" both into `RUNNABLE`, because whether the OS has scheduled you *right now* is not something the JVM tracks. Conceptually the distinction is still useful for understanding, which is why it's described separately below.

---

## 🧠 1. NEW

- **Definition**: A thread is in the `NEW` state when it is created but not yet started.
- **How it happens**: You create a thread using `new Thread()` but haven't called `start()` yet.

```java
Thread t = new Thread();  // NEW state
```

At this point it's just an ordinary object on the heap. No OS thread exists yet.

---

## 🏃 2. RUNNABLE

- **Definition**: After calling `start()`, the thread moves to `RUNNABLE`.
- **Note**: It is eligible to run, but the **thread scheduler** decides when it actually runs.

```java
t.start();  // Now in RUNNABLE state
```

---

## ⚙️ 3. RUNNING

- **Definition**: When the thread scheduler picks the thread, it enters the `RUNNING` state.
- **Note**: You don't control this. It's up to the JVM scheduler.

With 8 CPU cores and 100 runnable threads, at most 8 are truly executing at any instant. The other 92 sit in a run queue waiting for a slice. Both groups report `RUNNABLE` from `getState()`.

---

## 🔒 4. BLOCKED

- **Definition**: A thread is in the `BLOCKED` state when it is waiting to acquire a lock (e.g. synchronized block or method) held by another thread.

```java
synchronized(obj) {
    // thread waits here if obj is already locked
}
```

`BLOCKED` has exactly **one** cause: waiting for a monitor lock to enter a `synchronized` block or method. That's it. (Waiting on a `ReentrantLock` shows up as `WAITING`, not `BLOCKED`, because it's implemented with `LockSupport.park()`.)

---

## ⏳ 5. WAITING

- **Definition**: The thread is waiting **indefinitely** for another thread to perform a specific action (like `notify()`).

### Enters WAITING state when using:

- `Object.wait()` (without timeout)
- `Thread.join()` (on a thread that never terminates)
- `LockSupport.park()`

The defining feature: **there is no timeout**. This thread will sit here forever unless another thread explicitly wakes it. A thread stuck in `WAITING` when nobody will ever notify it is one flavour of deadlock.

---

## ⏰ 6. TIMED_WAITING

- **Definition**: The thread waits **for a specified period** of time.

### Enters TIMED_WAITING state when using:

- `Thread.sleep(time)`
- `Object.wait(time)`
- `Thread.join(time)`
- `LockSupport.parkNanos()` / `parkUntil()`

The key difference from `WAITING`: this thread **will** wake up on its own eventually, even if nobody notifies it.

> ⚠️ `Thread.sleep()` does **not** release any locks it holds. `Object.wait()` **does**. That distinction is the single most important thing to know about the two, and it's a very common interview question.

---

## ☠️ 7. TERMINATED (a.k.a. DEAD)

- **Definition**: The thread has **finished execution** or was terminated due to an exception.

```java
public void run() {
    System.out.println("Done");  // After this, thread is TERMINATED
}
```

A terminated thread **cannot be restarted**:

```java
t.start();
t.join();
t.start();     // 💥 IllegalThreadStateException
```

---

## 🧭 Thread State Diagram

```
        +---------------+
        |    NEW        |
        +---------------+
               |
               | start()
               v
        +---------------+
        |   RUNNABLE    |
        +---------------+
               |
         picked by CPU
               v
        +---------------+
        |   RUNNING     |
        +---------------+
         /    |     \
        /     |      \
sleep()  wait()   blocked on lock
  |       |              |
  v       v              v
TIMED_  WAITING       BLOCKED
WAITING
        \     |       /
         \    |      /
           notified /
             join done
                v
        +---------------+
        | TERMINATED    |
        +---------------+
```

### The transitions, listed exhaustively

| From | To | Trigger |
| :-- | :-- | :-- |
| `NEW` | `RUNNABLE` | `start()` |
| `RUNNABLE` | `BLOCKED` | tries to enter a `synchronized` block whose lock is held |
| `RUNNABLE` | `WAITING` | `wait()`, `join()`, `LockSupport.park()` |
| `RUNNABLE` | `TIMED_WAITING` | `sleep(n)`, `wait(n)`, `join(n)`, `parkNanos(n)` |
| `RUNNABLE` | `TERMINATED` | `run()` returns, or throws |
| `BLOCKED` | `RUNNABLE` | acquires the lock |
| `WAITING` | `BLOCKED` | notified — but must **re-acquire** the monitor first |
| `WAITING` | `RUNNABLE` | notified and lock available; or `join()` target finished; or interrupted |
| `TIMED_WAITING` | `RUNNABLE` | timeout expires, notified, or interrupted |

That `WAITING → BLOCKED` row surprises people: `notify()` doesn't hand you the CPU. It moves you from the wait set into the lock's entry queue, and you still have to win the monitor back.

---

## 🔍 Get Current Thread State

```java
Thread t = new Thread(() -> {
    System.out.println(Thread.currentThread().getState());
});

System.out.println(t.getState()); // NEW
t.start();
System.out.println(t.getState()); // RUNNABLE or RUNNING
```

Note the subtlety in that snippet: a thread asking for **its own** state can only ever get `RUNNABLE` — it's running, by definition, in order to ask.

### Seeing all the states in one program

```java
public class StateDemo {
    static final Object lock = new Object();

    public static void main(String[] args) throws Exception {
        // TIMED_WAITING — sleeping
        Thread sleeper = new Thread(() -> {
            try { Thread.sleep(5000); } catch (InterruptedException e) { }
        });

        // WAITING — waiting on a monitor with no timeout
        Thread waiter = new Thread(() -> {
            synchronized (lock) {
                try { lock.wait(); } catch (InterruptedException e) { }
            }
        });

        // BLOCKED — wants a lock that main is holding
        Thread blocked = new Thread(() -> {
            synchronized (lock) { System.out.println("got the lock"); }
        });

        System.out.println("sleeper before start: " + sleeper.getState());   // NEW

        sleeper.start();
        waiter.start();
        Thread.sleep(100);            // give them time to reach their states

        synchronized (lock) {          // main now holds the lock
            blocked.start();
            Thread.sleep(100);

            System.out.println("sleeper: " + sleeper.getState());   // TIMED_WAITING
            System.out.println("waiter:  " + waiter.getState());    // WAITING
            System.out.println("blocked: " + blocked.getState());   // BLOCKED
            System.out.println("main:    " + Thread.currentThread().getState()); // RUNNABLE

            lock.notifyAll();
        }                              // main releases the lock here

        sleeper.interrupt();
        sleeper.join();
        System.out.println("sleeper after join: " + sleeper.getState());  // TERMINATED
    }
}
```

---

## ✅ Summary Table

| State | Description | Trigger |
| --- | --- | --- |
| `NEW` | Thread created but not started | `new Thread()` |
| `RUNNABLE` | Ready to run, waiting for CPU | `start()` |
| `RUNNING` | Thread is executing | Selected by scheduler |
| `BLOCKED` | Waiting for a lock | `synchronized` access conflict |
| `WAITING` | Waiting indefinitely for another thread | `wait()`, `join()`, `park()` |
| `TIMED_WAITING` | Waiting for a fixed time | `sleep()`, `wait(ms)`, `join(ms)` |
| `TERMINATED` | Thread finished or crashed | Run method ends or exception occurs |

### One more table: does it release the lock?

| Call | Releases the monitor? | Resulting state |
| :-- | :-- | :-- |
| `Thread.sleep(n)` | ❌ **no** | `TIMED_WAITING` |
| `Object.wait()` | ✅ **yes** | `WAITING` |
| `Object.wait(n)` | ✅ yes | `TIMED_WAITING` |
| `Thread.join()` | ❌ no (holds its own locks) | `WAITING` |
| `Thread.yield()` | ❌ no | stays `RUNNABLE` |
| blocked on `synchronized` | n/a — trying to acquire | `BLOCKED` |

---

## Why this matters in practice: reading a thread dump

When a production Java app hangs, you take a thread dump (`jstack <pid>`, or Ctrl+Break) and read the states:

```
"http-worker-3" #23 waiting for monitor entry  [0x00007f...]
   java.lang.Thread.State: BLOCKED (on object monitor)
	at com.app.Cache.get(Cache.java:44)
	- waiting to lock <0x000000076ab> (a java.lang.Object)
	- locked <0x000000076cd> (a java.lang.Object)
```

- **Many threads `BLOCKED` on the same monitor** → lock contention. One synchronized method is a bottleneck.
- **Two threads each `BLOCKED` while holding what the other wants** → deadlock. (The JVM will often say `Found one Java-level deadlock` outright.)
- **Threads `WAITING` forever** → a missing `notify()`, or a task queue that never gets fed.
- **Many threads `RUNNABLE` in the same method** → a genuine CPU hot spot, not a locking problem.

Knowing these six states is what turns a thread dump from noise into a diagnosis.

---

## 🧠 Rapid-fire recall

1. How many constants are in the `Thread.State` enum, and which "state" from the classic diagram isn't one of them?
2. What is the one and only cause of `BLOCKED`?
3. What's the difference between `WAITING` and `TIMED_WAITING`?
4. Does `sleep()` release locks? Does `wait()`?
5. What state does a thread go to immediately after being notified, and why isn't it `RUNNABLE`?
6. Can a `TERMINATED` thread be restarted?
7. In a thread dump, what does it mean if many threads are `BLOCKED` on the same monitor?

<details>
<summary>Answers</summary>

1. Six: `NEW`, `RUNNABLE`, `BLOCKED`, `WAITING`, `TIMED_WAITING`, `TERMINATED`. `RUNNING` is not a separate constant — it's folded into `RUNNABLE`.
2. Waiting to acquire a monitor lock in order to enter a `synchronized` block or method.
3. `WAITING` has no timeout and requires another thread to wake it; `TIMED_WAITING` wakes itself when the time expires.
4. `sleep()` does not release any locks; `wait()` does release the monitor it was called on.
5. `BLOCKED` — it must re-acquire the monitor before it can continue, and another thread may still hold it.
6. No — `start()` on a terminated thread throws `IllegalThreadStateException`.
7. Lock contention: that monitor is a bottleneck, and the synchronized region it guards should be narrowed or replaced with a concurrent data structure.

</details>
