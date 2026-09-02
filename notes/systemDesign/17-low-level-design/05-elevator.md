---
title: Design an Elevator System
author: Tejas Nirala
---

import H from '@site/src/components/Highlight';
import C from '@site/src/components/Color';
import Plain from '@site/src/components/Plain';
import Jargon from '@site/src/components/Jargon';
import Depth from '@site/src/components/Depth';
import Trace, { TraceStep } from '@site/src/components/Trace';

# Design an Elevator System

> **The drill:** several lifts, many floors, competing requests. <C color="orange">The distinguishing feature is that this is a *scheduling* problem</C> — the object model is straightforward and the dispatch policy is where the thinking is.

<Plain>

A building with four lifts and twenty floors.

Someone on floor 12 presses **down**. Which lift goes?

The obvious answer — the nearest — is often wrong. A lift on floor 11 travelling **upward** with passengers inside is close and heading the wrong way; it must finish its journey, turn round, and come back. <C color="green">A lift on floor 8 already travelling down passes floor 12 anyway</C> and can collect this passenger at no extra cost.

<C color="orange">So the useful measure is not distance — it is *"how long until you could actually get here, given what you are already committed to?"*</C>

There is a second distinction that catches people out. Pressing **down** in the hallway says only *"I want to go down"*; it does not say where to. The floor button and the buttons inside the car are different kinds of request, and a lift can serve several hallway calls on one trip.

And there is a rule that has nothing to do with efficiency: <C color="crimson">the doors must not open between floors.</C> No amount of clever scheduling justifies violating it — which is why the lift's own state machine, not the scheduler, owns that decision.

</Plain>

---

## 1. Clarify

| Question | Typical answer | Consequence |
| :--- | :--- | :--- |
| How many lifts and floors? | 4 lifts, 20 floors | Multiple cars, so dispatch matters |
| Request types? | <C color="orange">Hall calls (with direction) and car calls</C> | Two different request models |
| Optimise for? | Average wait, or worst-case wait | Changes the dispatch policy |
| Special modes? | Fire, maintenance, VIP | A mode concept, overriding normal dispatch |
| Capacity limits? | Yes — weight and occupancy | A full lift must skip hall calls |

<C color="green">The optimise-for question is the one to ask.</C> Minimising *average* wait and minimising *worst-case* wait produce genuinely different policies, and the interviewer will have an opinion.

---

## 2. The model

```
  ElevatorSystem
    ├── Elevator*           (id, currentFloor, Direction, State, requests)
    ├── DispatchStrategy    ← interface (varies: nearest, SCAN, look-ahead)
    └── Request
          ├── HallCall (floor, direction)      — from the hallway
          └── CarCall  (floor)                  — from inside a car

  Elevator has a State: IDLE | MOVING_UP | MOVING_DOWN | DOORS_OPEN | MAINTENANCE
```

<Jargon
  plain="A request from the hallway names a direction but not a destination; a request from inside names a destination."
  term="hall call vs car call"
  also={['landing call', 'cabin call']}>

<C color="green">Modelling these as one type is a common mistake.</C> A hall call can be served by any lift travelling the right way past that floor; a car call belongs to one specific lift and must be served by it.

</Jargon>

**Responsibilities:**

| Class | Decides |
| :--- | :--- |
| `Elevator` | Its own next move, given its committed stops — and **never** opens doors while moving |
| `DispatchStrategy` | Which lift should serve a new hall call |
| `ElevatorSystem` | Routes requests, holds the lifts, applies modes |
| `Request` | Nothing — a value |

<C color="green">The safety-critical decision lives in `Elevator`, not the scheduler.</C> A scheduler bug should never be able to open doors mid-shaft — the lift refuses regardless of what it is told.

---

## 3. Dispatch is the design

<Trace title="A hall call on floor 12, going down" subtitle="Four lifts, four policies. The best answer is not the nearest.">

<TraceStep
  title="The situation"
  state={{ 'Lift A': 'floor 11, moving UP', 'Lift B': 'floor 8, moving DOWN', 'Lift C': 'floor 20, IDLE', 'Lift D': 'floor 2, moving UP' }}
  changed={['Lift A', 'Lift B', 'Lift C', 'Lift D']}
  note="Someone on 12 presses down.">

</TraceStep>

<TraceStep
  title="Nearest-first picks A"
  cost="wrong"
  state={{ 'Chosen': 'Lift A (1 floor away)', 'Actual wait': 'long — must finish up, then return', 'Policy': 'nearest by distance', 'Verdict': 'naive' }}
  changed={['Chosen', 'Actual wait', 'Policy', 'Verdict']}
  note="Distance ignores commitment and direction — the classic wrong answer.">

<C color="crimson">A is one floor away and travelling the wrong way</C>, with passengers who must be delivered first.

</TraceStep>

<TraceStep
  title="Direction-aware picks B"
  state={{ 'Chosen': 'Lift B (4 floors, already descending)', 'Actual wait': 'short — passes 12 anyway', 'Policy': 'direction + distance', 'Verdict': 'much better' }}
  changed={['Chosen', 'Actual wait', 'Policy', 'Verdict']}
  note="B is further in floors and nearer in time — and serving this call costs it almost nothing.">

<C color="green">B is already travelling down and will pass floor 12.</C> It collects the passenger essentially for free.

</TraceStep>

<TraceStep
  title="Cost-based dispatch generalises it"
  state={{ 'Score': 'estimated time to arrive', 'Includes': 'direction, committed stops, load, door times', 'Chosen': 'lowest cost', 'Verdict': 'the right model' }}
  changed={['Score', 'Includes', 'Chosen', 'Verdict']}
  note="Score every lift; pick the minimum. Distance and direction become inputs rather than the rule.">

<H>Score each lift by **estimated time to serve this call**, accounting for its direction, its already-committed stops, its load and door dwell times. Distance is one input, not the policy.</H>

</TraceStep>

<TraceStep
  title="Reassignment when conditions change"
  state={{ 'Later': 'B fills to capacity', 'Effect': 'B must skip floor 12', 'Fix': 're-dispatch the call', 'Verdict': 'needed' }}
  changed={['Later', 'Effect', 'Fix']}
  note="A hall call assigned to a lift that can no longer serve it must be reassigned, not silently dropped.">

<C color="crimson">Assignment cannot be permanent.</C> A full lift skips the floor, so the call returns to the pool and is re-scored.

</TraceStep>

<TraceStep
  title="Starvation, and why worst case matters"
  cost="a real failure"
  state={{ 'Policy': 'pure cost minimisation', 'Effect': 'a top-floor call can wait indefinitely', 'Fix': 'age requests into priority', 'Verdict': 'must handle' }}
  changed={['Policy', 'Effect', 'Fix', 'Verdict']}
  note="Greedy optimisation of average wait can leave one person waiting arbitrarily long.">

<C color="green">Age hall calls</C> so a long-waiting request gains priority regardless of cost — otherwise minimising the average produces an unacceptable worst case.

</TraceStep>

</Trace>

---

## 4. Scheduling policies, named

| Policy | Behaviour | Trade |
| :--- | :--- | :--- |
| **FCFS** | Serve in request order | <C color="crimson">Very inefficient</C> — ignores position entirely |
| **Nearest-first** | Closest lift wins | Ignores direction and commitment |
| **SCAN / elevator algorithm** | Sweep to one end, reverse, sweep back | <C color="green">Efficient, bounded worst case</C> |
| **LOOK** | Like SCAN, but reverse at the last request rather than the shaft end | <C color="green">SCAN without wasted travel</C> |
| **Cost-based** | Score every lift, take the minimum | <C color="green">Best in practice; needs a cost function</C> |

<C color="green">SCAN/LOOK is worth naming</C> — it is the same algorithm as disk head scheduling, which is where the name "elevator algorithm" comes from, and mentioning that connection reads well.

---

## 5. The elevator's own state machine

<Depth title="Safety, modes, and where the interviewer pushes">

**The lift's state machine is safety-critical and belongs to the lift.**

```
  IDLE ──request──> MOVING_UP / MOVING_DOWN
    ▲                        │ arrive at a committed stop
    │                        ▼
    └──no requests──── DOORS_OPEN ──timeout / close──> (next move)

  Any state ──emergency──> MAINTENANCE / FIRE_MODE
```

<C color="crimson">Invalid transitions must be impossible, not merely checked.</C> Modelling each state as a class ([the State pattern](./03-design-patterns.md)) means `MOVING_UP` has no `openDoors()` operation — so the bug cannot be written, rather than being caught by an `if` somebody might remove.

<H>This is the strongest argument for the State pattern in any LLD round: it converts a rule that must be enforced into a structure where violating it does not compile.</H>

**Modes override dispatch entirely:**

| Mode | Behaviour |
| :--- | :--- |
| **Fire** | All lifts descend to the ground floor, doors open, service suspended |
| **Maintenance** | Lift removed from dispatch; responds only to the maintenance panel |
| **Full** | Skips hall calls; still serves its own car calls |
| **Out of service** | Removed from the pool; its assigned calls are re-dispatched |

<C color="green">Modes should be a property the dispatcher consults</C>, not special cases scattered through the scheduling logic — otherwise adding a mode edits every branch.

**Door handling is more than a boolean.** Real requirements include a dwell time, obstruction detection (reopen and restart the timer), a door-open button (extends dwell), and a maximum hold before an alarm. <C color="orange">Worth mentioning briefly to show you have thought past the happy path</C>, without designing the whole subsystem.

**Concurrency.** Multiple entities act concurrently: button presses from every floor, lifts moving on their own timers, the dispatcher assigning calls. The shared mutable state is the **set of pending hall calls** and each lift's **committed stops**.

<C color="green">The clean model is one thread (or actor) per lift owning its own state</C>, with the dispatcher communicating by message rather than by shared mutation. That removes most locking entirely — each lift's state is touched only by its own thread.

If asked for a simpler answer: a lock around the pending-call set, with each lift's stop list owned by that lift.

**What is *not* being asked.** Not scale — one building, a handful of lifts. Not persistence — this is in-memory control. <C color="crimson">Candidates who start discussing databases and load balancers have misread the question</C>, exactly as with the parking lot.

**The follow-ups to expect:** *"Add a VIP mode that prioritises one floor"* (a dispatch policy variation — the strategy interface absorbs it). *"How would you test this?"* (inject a clock and a simulated lift, so time-dependent behaviour is deterministic — a strong answer, and dependency inversion paying off). *"Two lifts arrive at the same floor going the same way"* (the dispatcher should not have assigned both; if it did, the second releases the call).

</Depth>

---

## 6. What a good answer sounds like

> *"The object model is straightforward — the design is in the dispatch policy. Hall calls and car calls are different: a hall call names a direction and can be served by any lift passing that way; a car call belongs to one lift. Dispatch scores every lift by estimated time to serve, which accounts for direction and committed stops — nearest-by-distance is wrong, because a lift one floor away travelling the other way is further in time than one four floors away already coming down. Assignments aren't permanent: if a lift fills, the call is re-dispatched. And I'd age requests so minimising average wait doesn't starve someone. The lift owns its own state machine, with each state a class, so opening doors while moving isn't a check that can be removed — it's a method that doesn't exist. Modes are a property the dispatcher consults, not branches through the scheduler."*

---

## Rapid-fire recall

1. What kind of problem is this really, and what is straightforward?
2. Distinguish a hall call from a car call, and why modelling them as one type fails.
3. Why is the nearest lift often the wrong choice?
4. What should a dispatch cost function account for?
5. Why can an assignment not be permanent?
6. What is starvation here, and how is it prevented?
7. Name the scheduling policies, and which two are worth naming aloud.
8. Why does the safety-critical decision belong to the lift rather than the scheduler?
9. How does the State pattern make an invalid transition impossible rather than checked?
10. What concurrency model removes most locking, and what is being shared?

<details>
<summary>Answers</summary>

1. A **scheduling** problem. The object model — lifts, floors, requests, states — is straightforward; the dispatch policy is where the design work is.
2. A **hall call** names a floor and a direction but no destination, and can be served by **any lift travelling that way past the floor**. A **car call** names a destination and belongs to **one specific lift**. Merging them loses the fact that hall calls are reassignable and shareable.
3. Because **distance ignores direction and commitment**. A lift one floor away travelling the opposite way must finish its journey and return; one four floors away already travelling toward you arrives sooner and serves the call almost for free.
4. **Direction of travel**, **already-committed stops**, **current load and capacity**, **door dwell times**, and distance — producing an **estimated time to serve** rather than a distance.
5. Because conditions change — a lift **fills to capacity** and must skip the floor, or goes **out of service**. The call must return to the pool and be re-scored, not silently dropped.
6. A request that **waits indefinitely** because greedy cost minimisation always finds a better use for every lift. Prevented by **ageing** requests so waiting time raises priority regardless of cost.
7. **FCFS**, **nearest-first**, **SCAN**, **LOOK**, **cost-based**. Worth naming: **SCAN/LOOK** (the "elevator algorithm", also used for disk head scheduling) and **cost-based**, which is what real systems use.
8. Because a **scheduler bug must never be able to open doors mid-shaft**. The lift refuses regardless of what it is instructed to do, so safety does not depend on the correctness of the scheduling code.
9. By making each state a **class exposing only its legal operations** — `MOVING_UP` has no `openDoors()` method at all, so the invalid call **does not compile**, rather than being prevented by an `if` that could be removed.
10. **One thread or actor per lift**, owning its own state, with the dispatcher communicating by message. The genuinely shared state is the **set of pending hall calls**; each lift's committed stops are owned by that lift alone.

</details>

---

**Next:** [Design an LRU Cache](./06-lru-cache.md) — the data-structure LLD question.
