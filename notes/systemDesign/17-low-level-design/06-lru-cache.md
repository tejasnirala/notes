---
title: Design an LRU Cache
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Design an LRU Cache

> **The drill:** a fixed-capacity cache evicting the least recently used entry, with **`O(1)`** get and put. <C color="orange">The one LLD question with a single correct data-structure answer</C> — and the follow-ups about thread safety are where it is actually decided.

<Plain>

A desk with room for five files.

A sixth arrives, so one must go — and the sensible one to remove is whichever you have not touched in longest.

That requires two things at once, and they pull against each other.

**Finding a specific file instantly.** You cannot leaf through the pile; you need to reach straight to it.

**Knowing the order you last touched them.** Which requires keeping them in a sequence, and moving a file to the front every time you use it.

A pile gives you the order and makes finding slow. An index gives you finding and loses the order.

<C color="green">So you keep both.</C> The files sit in a line where each knows the file before and after it, and a separate index tells you exactly where any given file sits in that line. Touching a file means looking it up in the index, unhooking it from its neighbours, and hooking it back in at the front — <C color="green">a fixed number of steps, regardless of how many files there are.</C>

That combination is the answer. Everything else in this problem is what happens when several people share the desk.

</Plain>

---

## 1. The requirement

```
  get(key)        → value or miss     — O(1)
  put(key, value) → evicts LRU if full — O(1)
  capacity fixed at construction
```

<C color="crimson">The `O(1)` constraint is what rules out the obvious answers.</C> An array with a timestamp per entry makes `get` fast and eviction `O(n)`. A sorted structure makes eviction fast and access `O(log n)`.

---

## 2. The structure

<Jargon
  plain="A hash map for instant lookup, plus a doubly-linked list for recency order — each map entry points at its list node."
  term="hash map + doubly-linked list"
  also={['the LRU pattern', 'intrusive list']}>

<C color="green">The map gives `O(1)` lookup; the list gives `O(1)` reordering.</C> The essential detail is that the map's **value is the list node itself**, so you can unlink it without traversing to find it.

</Jargon>

```
  HEAD (most recent) ⇄ [B] ⇄ [D] ⇄ [A] ⇄ [C] TAIL (evict here)
                        ▲     ▲     ▲     ▲
  map:  {A→node, B→node, C→node, D→node}
```

**Why *doubly* linked.** Removing a node requires updating its predecessor. A singly-linked list would need a traversal to find that predecessor — <C color="crimson">`O(n)`, which defeats the whole design.</C> With `prev` and `next` pointers, unlinking is a constant number of assignments.

**Why sentinel head and tail nodes.** They remove every edge case. Without them, inserting into an empty list, removing the only node, and removing the head or tail are each special code paths. <C color="green">With sentinels, every node always has a real `prev` and `next`</C>, and the logic has no branches at all.

<Trace title="Capacity 3, a sequence of operations" subtitle="Watch the list order and the eviction.">

<TraceStep
  title="put(A), put(B), put(C)"
  state={{ 'List (recent→old)': 'C, B, A', 'Map size': '3', 'Capacity': '3', 'Evicted': 'none' }}
  changed={['List (recent→old)', 'Map size']}
  note="Each put inserts at the head. The tail is the eviction candidate.">

</TraceStep>

<TraceStep
  title="get(A) — a hit"
  cost="A moves to head"
  state={{ 'List (recent→old)': 'A, C, B', 'Map size': '3', 'Operations': 'unlink + insert at head', 'Evicted': 'none' }}
  changed={['List (recent→old)', 'Operations']}
  note="This is the step people forget — a read must reorder, which is why get is a mutation.">

<C color="orange">A `get` mutates the structure.</C> That matters enormously for thread safety, below.

</TraceStep>

<TraceStep
  title="put(D) — over capacity"
  cost="evict the tail"
  state={{ 'List (recent→old)': 'D, A, C', 'Map size': '3', 'Evicted': 'B', 'Why B': 'least recently used' }}
  changed={['List (recent→old)', 'Evicted', 'Why B']}
  note="Evict the tail node and remove its key from the map — both, or the map leaks.">

<C color="crimson">Both structures must be updated.</C> Removing from the list without removing from the map leaves a dangling entry pointing at an unlinked node.

</TraceStep>

<TraceStep
  title="put(A, newValue) — an update"
  state={{ 'List (recent→old)': 'A, D, C', 'Map size': '3', 'Evicted': 'none', 'Note': 'update counts as a use' }}
  changed={['List (recent→old)', 'Note']}
  note="An existing key updates in place and moves to head — no eviction, no size change.">

</TraceStep>

<TraceStep
  title="The invariant"
  state={{ 'Invariant': 'map.size == list.length', 'Every map value': 'a live list node', 'Every list node': 'a live map key', 'Verdict': 'consistent' }}
  changed={['Invariant', 'Every map value', 'Every list node']}
  note="Stating the invariant explicitly is a strong signal — it is what every operation must preserve.">

<H>Both structures describe the same set. Every operation must leave them consistent, and every bug in this problem is a violation of that invariant.</H>

</TraceStep>

</Trace>

---

## 3. A clean implementation

```java
class LRUCache<K, V> {
    private final int capacity;
    private final Map<K, Node<K, V>> map = new HashMap<>();
    private final Node<K, V> head = new Node<>(null, null);  // sentinels
    private final Node<K, V> tail = new Node<>(null, null);

    LRUCache(int capacity) {
        this.capacity = capacity;
        head.next = tail;
        tail.prev = head;
    }

    V get(K key) {
        Node<K, V> n = map.get(key);
        if (n == null) return null;
        moveToHead(n);
        return n.value;
    }

    void put(K key, V value) {
        Node<K, V> n = map.get(key);
        if (n != null) { n.value = value; moveToHead(n); return; }

        if (map.size() == capacity) {
            Node<K, V> lru = tail.prev;
            unlink(lru);
            map.remove(lru.key);          // both structures, always
        }
        Node<K, V> fresh = new Node<>(key, value);
        map.put(key, fresh);
        insertAfterHead(fresh);
    }

    private void unlink(Node<K, V> n) {
        n.prev.next = n.next;             // no null checks — sentinels guarantee both exist
        n.next.prev = n.prev;
    }
    private void insertAfterHead(Node<K, V> n) { … }
    private void moveToHead(Node<K, V> n) { unlink(n); insertAfterHead(n); }
}
```

<C color="green">Note what the sentinels bought:</C> `unlink` has no null checks and no special cases. That is the difference between code that is obviously correct and code with four branches to get wrong.

---

## 4. The follow-ups that decide it

<Depth title="Thread safety, and the eviction policies beyond LRU">

**"Make it thread-safe."** The question that separates candidates.

<C color="crimson">The naive answer — synchronise every method — works and serialises all access</C>, including reads. Since `get` mutates the list, **a read-write lock does not help**: every `get` needs the write lock anyway. This is worth stating explicitly, because it is a genuinely counter-intuitive consequence.

Better approaches, in order of sophistication:

**1. Lock striping.** Partition into N independent segments, each with its own map, list and lock; a key's segment is `hash(key) % N`. <C color="green">Concurrency improves N-fold</C>, and eviction becomes **per-segment** rather than global — so it is approximately LRU, not exactly. That is almost always an acceptable trade.

**2. Defer the reordering.** Do not move nodes on `get`. Instead **record accesses in a small buffer** and apply them in batch when the buffer fills or under lock. <C color="green">Reads become nearly lock-free</C> at the cost of the recency order lagging slightly. This is roughly what Caffeine does, and it is the technique that makes high-throughput Java caches fast.

**3. Approximate LRU by sampling.** Give up the linked list entirely: store a last-access timestamp per entry, and on eviction sample a handful of random entries and evict the oldest. <C color="green">This is what Redis does</C> — and it is a good answer to give, because it shows you know that maintaining exact LRU ordering costs more than the accuracy is worth at scale.

**"What about TTL as well as capacity?"** Two eviction reasons — expiry and capacity — and they are [genuinely different mechanisms](../07-caching/03-eviction-and-invalidation.md). Expiry can be **lazy** (check on read) plus a background sweep; do not scan the whole structure eagerly.

**"Why might LRU be the wrong policy?"** Its known weakness is **scan resistance**: a sequential pass over cold data marks everything recently-used and evicts the entire hot set. <C color="green">Fixes: segmented LRU</C> (promote only on a second access) or an **admission policy** like TinyLFU, which admits a new entry only if it looks more valuable than the eviction candidate.

Naming that weakness unprompted is a strong signal, because it shows you know the policy rather than just the data structure.

**"What if entries have different sizes?"** Capacity in *entries* becomes capacity in *bytes*, so eviction may need to remove several entries for one insertion, and a single item larger than the capacity must be rejected rather than emptying the cache.

**What is actually being assessed.** The data structure is the entry ticket — <C color="green">the discriminating questions are thread safety and knowing that exact LRU is often not worth its cost.</C> A candidate who produces the map-plus-list, then says *"synchronising every method serialises reads too, since `get` mutates — so I'd stripe, or defer reordering, or sample like Redis"* has demonstrated substantially more than one who writes perfect single-threaded code.

</Depth>

---

## 5. What a good answer sounds like

> *"Hash map plus doubly-linked list, with the map's value being the list node itself so unlinking is `O(1)` — a singly-linked list would need a traversal to find the predecessor. Sentinel head and tail nodes remove every edge case, so `unlink` has no null checks. The invariant is that the map and list always describe the same set; every bug here is a violation of it. Note that `get` mutates, which means a read-write lock buys nothing for thread safety — reads need the write lock anyway. So: stripe into segments with per-segment eviction, which is approximately LRU and fine; or buffer accesses and apply reordering in batches, which is what Caffeine does; or drop the list entirely and sample random entries by timestamp, which is what Redis does. And LRU isn't scan-resistant — a sequential pass evicts the whole hot set, so segmented LRU or an admission policy if that matters."*

---

## Rapid-fire recall

1. What does the `O(1)` requirement rule out?
2. What two structures are combined, and what does each provide?
3. Why must the map's value be the list node itself?
4. Why doubly linked rather than singly?
5. What do sentinel nodes buy?
6. Why is `get` a mutating operation, and what does that imply?
7. State the invariant, and the bug that violates it.
8. Why does a read-write lock not help here?
9. Give three approaches to concurrency beyond a global lock.
10. What is LRU's known weakness, and two fixes?

<details>
<summary>Answers</summary>

1. **Timestamp-per-entry with a scan on eviction** (`O(n)` eviction) and **sorted structures** (`O(log n)` access). Only the map-plus-list combination gives constant time for both operations.
2. A **hash map** (instant lookup by key) and a **doubly-linked list** (constant-time reordering by recency).
3. So a node can be **unlinked without traversing the list to find it**. If the map stored only the value, locating the node would be `O(n)` and the whole design would collapse.
4. Because unlinking requires updating the node's **predecessor**, and a singly-linked list would need an `O(n)` traversal to find it. `prev` and `next` make it a constant number of assignments.
5. They **remove every edge case** — empty list, single node, removing the head or tail. Every node always has a real `prev` and `next`, so `unlink` needs no null checks or branches.
6. Because a read **updates recency**, moving the node to the head. It implies **reads are writes for concurrency purposes**, which is why read-write locks do not help.
7. **`map.size == list.length`, every map value is a live list node, and every list node's key is in the map.** The classic bug is evicting the tail from the list but **forgetting to remove its key from the map**, leaving a dangling entry.
8. Because **`get` mutates the list**, so every read needs the write lock anyway — there are effectively no read-only operations to run concurrently.
9. **Lock striping** into independent segments with per-segment (approximate) eviction · **deferring reordering** by buffering accesses and applying them in batch (Caffeine) · **sampling** — dropping the list and evicting the oldest of a few random entries by timestamp (Redis).
10. **Poor scan resistance** — a sequential pass over cold data marks everything recently-used and evicts the entire hot set. Fixes: **segmented LRU** (promote only on a second access) and an **admission policy** such as TinyLFU.

</details>

---

**Next:** [Design a Movie Booking System](./07-movie-booking.md) — concurrency where correctness is the whole point.
