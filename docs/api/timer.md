# Timer + Clock API (RFC 0001 v0.1)

Declarative timer primitives for Directive. Solves four
MIGRATION_FEEDBACK items in one shape: declarative `after` (#4),
fake-timer integration (#15), clock-in-derivation (#16), and
predicate-gated tick wiring (#18).

> **v0.1 status:** ships the *value layer* — `SignalClock` interface +
> `realClock` / `virtualClock` factories, and a set of pure timer-state
> helpers (`startTimer`, `pauseTimer`, `tickTimer`, etc) plus a
> `timerOps()` bundle for ergonomic single-import use. Engine-integrated
> `t.timer({ms})` schema (where the engine itself ticks the fact) is the
> v0.2 deliverable. The v0.1 surface is enough to write deterministic,
> replay-safe countdown / repeat / elapsed-time logic today; it just
> requires a small amount of consumer-side wiring (a `setInterval` that
> calls `timer.tick()`).

## SignalClock

```ts
import { realClock, virtualClock, defaultClock } from '@directive-run/core';

const clock = realClock();        // production
const test = virtualClock(0);     // tests; advanceBy() to step time
const auto = defaultClock();      // alias for realClock — auto-detect
                                  // was removed (footgun under vitest)
```

The interface:

```ts
interface SignalClock {
  now(): number;
  setTimeout(cb: () => void, ms: number): () => void;  // returns cancel
  advanceBy?(ms: number): void;                        // virtual only
}
```

`virtualClock` is the test ergonomics win — `advanceBy(5000)`
synchronously fires every callback whose deadline falls in the window,
in deadline order, with ties broken by registration order.

## Timer state

```ts
interface TimerFactState {
  startedAtMs: number | null;
  pausedDurationMs: number;
  pausedAtMs: number | null;
  status: 'idle' | 'running' | 'paused' | 'completed';
  repeats: number;
}
```

JSON-roundtrippable — store directly in a Directive fact via
`t.object<TimerFactState>()`. No `Date` instances, no class wrappers.

## Recommended pattern

Capture clock + opts in a closure at module-factory time:

```ts
import { createModule, createSystem, t, realClock, timerOps, initialTimerState, type TimerFactState } from '@directive-run/core';

export function createCountdownModule() {
  const clock = realClock();
  const ops = timerOps({ ms: 60_000, mode: 'down' });

  return createModule('countdown', {
    schema: {
      facts: { state: t.object<TimerFactState>() },
      events: { START: {}, PAUSE: {}, RESUME: {}, RESET: {}, TICK: {} },
    },
    init: (f) => { f.state = initialTimerState(); },
    derivations: { remainingMs: t.number() },
    derive: { remainingMs: (f) => ops.remainingMs(f.state, clock.now()) },
    events: {
      START: (f) => { f.state = ops.start(f.state, clock.now()); },
      PAUSE: (f) => { f.state = ops.pause(f.state, clock.now()); },
      RESUME: (f) => { f.state = ops.resume(f.state, clock.now()); },
      RESET: (f) => { f.state = ops.reset(); },
      TICK: (f) => {
        const sig = ops.tick(f.state, clock.now());
        if (sig.kind === 'complete') {
          f.state = ops.complete(f.state);
        } else if (sig.kind === 'repeat') {
          f.state = ops.registerRepeat(f.state);
        }
      },
    },
  });
}

// Consumer wires the tick:
const sys = createSystem({ module: createCountdownModule() });
sys.start();
sys.events.START();

const interval = setInterval(() => sys.events.TICK(), 100);
// in cleanup: clearInterval(interval); sys.destroy();
```

## Three modes

| Mode | Meaning | Completion |
|---|---|---|
| `'down'` (default) | Counts down from `ms` to 0 | `status` → `'completed'` at 0 |
| `'up'` | Counts elapsed time, no upper bound | Never completes — consumer reads `elapsedMs` |
| `'repeat'` | Fires every `ms`, drift-free | Never completes — `registerRepeat` advances `startedAtMs` cleanly |

## Replay determinism

The clock is the only source of time. Replaying a recorded event log
through the same module + a `virtualClock` seeded from the recording
reproduces the timer fact stream byte-for-byte.

For dehydrate / hydrate: serialize the `TimerFactState` (it's
JSON-safe), serialize the clock-now at dehydrate moment, and on rehydrate
construct a `virtualClock(savedNowMs)` to drive subsequent ticks
deterministically. A live system can transition from virtual to real
clock at any boundary by reading `clock.now()` once and using that as
the seed.

## What's deferred to v0.2

The shipped helpers are pure functions on JSON state. The engine has no
auto-tick integration today — your consumer wires the interval. v0.2
adds `t.timer({ms})` as a real schema constructor that the engine
handles natively, eliminating the consumer-side tick. The pure helpers
ship now because they're sufficient to write correct, deterministic
timers in any consumer (React, server, edge worker), and they're the
foundation v0.2 will be built on.

## See also

- [RFC 0001 — `t.timer({ms})`](../rfcs/0001-t-timer.md) — full design rationale
- [Fake timers](../testing/fake-timers.md) — `vi.useFakeTimers()` integration (still useful for non-Directive setIntervals)
- [Migrating from XState § `after:`](../migrating-from-xstate.md#tldr-concept-mapping)
