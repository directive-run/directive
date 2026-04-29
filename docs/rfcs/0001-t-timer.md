# RFC 0001 — `t.timer({ms})` declarative timer

- **Status:** Draft (2026-04-29)
- **Author:** Jason Comes
- **MIGRATION_FEEDBACK refs:** #4 (declarative timer), #15 (fake-timer integration), #16 (clock-in-derivation), #18 (`useTickWhile`)
- **Domain Expert verdict:** *killer differentiator — would make `vi.useFakeTimers`, `useTickWhile`, and clock-in-derivation evaporate*

## Summary

Add `t.timer({ms})` as a first-class schema type that represents "elapsed
time since a reference point" as a reactive fact. The runtime owns the
clock source, advances the fact deterministically, and integrates cleanly
with replay, dehydrate/hydrate, fake timers, and SSR.

## Motivation

Across the 55-cycle Minglingo migration, four distinct items all converged
on the same root problem: **time is not currently a first-class fact in
Directive.**

1. **Item #4 — No declarative `after`.** XState's `after: { 5000: 'TIMEOUT' }`
   becomes an imperative `setTimeout` in an effect. The effect can't be
   replayed; the dehydrated state can't restore the timer. Every cycle that
   needed a delay paid this tax.

2. **Item #15 — Fake-timer integration.** `vi.useFakeTimers()` freezes the
   microtask queue, starving Directive's resolver chain. Workarounds exist
   (`shouldAdvanceTime: true`) but the docs page (`docs/testing/fake-timers.md`)
   reads as a list of caveats.

3. **Item #16 — Clock reads in derivations are silently broken.** A
   derivation reading `Date.now()` won't invalidate when the clock moves.
   The fix is to thread elapsed time through a fact, manually ticked by the
   consumer. Every "is this stale?" check pays the cost.

4. **Item #18 — `useTickWhile` React hook.** The shipped escape hatch for
   predicate-gated intervals. Useful but consumer-side and React-only;
   doesn't help non-React consumers (Node services, edge handlers).

A `t.timer({ms})` primitive collapses all four into one: a fact whose value
advances on a clock the engine controls. Consumers read it like any other
fact. Replay, dehydrate, fake-timer integration, and SSR all become
problems the engine solves once instead of every consumer solving them
from scratch.

## Proposed API

### Schema declaration

```ts
const schema = {
  // Counts down from 60s when set; null when inactive.
  countdown: t.timer({ ms: 60_000 }),

  // Counts up from 0 when set.
  elapsed: t.timer({ ms: 0, mode: 'up' }),

  // Repeats every 1s while active.
  pollTicker: t.timer({ ms: 1_000, repeat: true }),
};
```

### Runtime fact shape

```ts
interface TimerFact {
  startedAtMs: number | null; // null = not running
  elapsedMs: number;          // advances reactively
  remainingMs: number;        // for countdown mode
  repeats: number;            // for repeat mode
  status: 'idle' | 'running' | 'paused' | 'completed';
}
```

The fact reads as a reactive object — `facts.countdown.remainingMs` is a
cache-tracked read. Derivations and React hooks subscribe granularly to
each subfield.

### Control surface

```ts
// Inside an event handler:
event.handle('START_GAME', ({ facts }) => {
  facts.countdown.start(); // sets startedAtMs, status → 'running'
});

event.handle('PAUSE', ({ facts }) => {
  facts.countdown.pause(); // status → 'paused'
});

event.handle('RESUME', ({ facts }) => {
  facts.countdown.resume();
});

event.handle('CANCEL', ({ facts }) => {
  facts.countdown.reset(); // back to idle
});
```

### Constraint integration

```ts
constraint.create({
  given: ({ facts }) => facts.countdown.status === 'completed',
  effect: ({ facts }) => {
    facts.status = 'timeUp';
  },
});
```

When the timer hits zero (countdown) or the repeat tick fires (repeat
mode), the engine writes the fact deltas synchronously. The constraint
fires on the next tick. No imperative `setTimeout` in the module.

## Clock source contract (the central design question)

This is where Item #4 becomes hard. There are three viable clock-source
models:

### Option A: Engine-owned `SignalClock` interface

```ts
interface SignalClock {
  now(): number;
  setTimeout(cb: () => void, ms: number): () => void;
  advanceBy?(ms: number): void; // test-only
}

createSystem({
  module: createX(),
  clock: nodeRealClock(), // default in node
  // OR
  clock: virtualClock(),  // for tests
});
```

The clock is injectable. Real clock in production. Virtual clock in tests
— `clock.advanceBy(5000)` synchronously advances all running timers and
fires their effects.

**Pros:** clean separation, replays deterministically, fake-timer
integration becomes trivial.

**Cons:** every consumer that wants timers has to know about the clock
parameter; default-real-clock means SSR rehydration can drift.

### Option B: Fact-derived from a global `nowMs`

```ts
const schema = {
  nowMs: t.number(), // ticked externally
  countdown: t.timer({ ms: 60_000, source: 'nowMs' }),
};
```

The timer derives from a `nowMs` fact that the consumer ticks. Equivalent
to today's manual pattern but blessed.

**Pros:** zero new infrastructure, makes the existing pattern first-class.

**Cons:** still requires the consumer to tick — doesn't solve Item #18.

### Option C: Engine schedules ticks; consumer can observe

```ts
createSystem({
  module: createX(),
  // no clock param — engine uses a default scheduler
  // optionally:
  scheduler: { mode: 'real' | 'virtual', granularityMs: 16 },
});
```

The engine has a built-in scheduler that ticks at a configurable rate.
Tests swap to virtual mode and call `sys.scheduler.advance(5000)`.

**Pros:** no consumer wiring; SSR-safe via mode switch.

**Cons:** hidden global ticker = harder to reason about; tick granularity
becomes a contract surface.

### Recommendation

**Option A (SignalClock injection).** The other two leak abstractions:
B forces consumers to keep ticking manually (the original pain point), and
C hides the clock in a way that makes deterministic replay harder. Option
A's "every consumer needs to know about the clock" cost is paid once at
`createSystem` and is inert thereafter.

Default the clock to `realClock()` in Node, `realClock()` in browser, and
`virtualClock()` in vitest (auto-detected via `process.env.VITEST`). The
85% case is zero-config.

## Determinism contract

A timer fact MUST be deterministic under three operations:

1. **Replay.** Recording the events and replaying through a `virtualClock`
   that matches the original `startedAtMs` reproduces the same fact stream.
2. **Dehydrate / hydrate.** Serializing the system mid-flight and
   rehydrating later resumes the timer from the recorded `startedAtMs +
   pausedDurationMs`. The clock's `now()` provides the new wall-clock
   reference.
3. **Fake timers.** `vi.useFakeTimers()` is detected and the virtual clock
   takes over. `vi.advanceTimersByTime(N)` advances the timer N ms.

Concrete invariants:

- `startedAtMs`, `pausedDurationMs`, `repeatCount` are JSON-roundtrippable
  facts. The proxy contract from `docs/api/facts.md` applies.
- `elapsedMs` and `remainingMs` are derivations off `(now - startedAtMs -
  pausedDurationMs)`. They invalidate when the clock advances.
- The clock never fires effects faster than the engine can process them —
  if a constraint is mid-flight when a timer would fire, the timer waits
  for the next tick.

## How it subsumes existing patterns

| Existing pattern | After `t.timer` |
|---|---|
| Imperative `setTimeout` in effect | `facts.timer.start()` + constraint on `status === 'completed'` |
| `useTickWhile(sys, predicate, EVENT, ms)` | `facts.poll.start()` (mode: `'repeat'`) — works in any consumer, not just React |
| Manual `nowMs` tick + derivation | `facts.timer.elapsedMs` — direct read |
| `vi.useFakeTimers({ shouldAdvanceTime: true })` + manual advance | `clock.advanceBy(ms)` on the injected virtual clock |
| Stale-check derivation | `facts.staleTimer.status === 'completed'` |

`useTickWhile` doesn't go away — it's still useful for non-timer interval
dispatch. But `t.timer` covers the cases where the interval is part of the
*module's logic* (countdown, polling, debounce) rather than a consumer
concern.

## Open questions

1. **Granularity.** Real clocks tick at `setInterval` granularity (~4ms in
   browser, 1ms in node). What's the contract for `elapsedMs`? Proposal:
   round to 16ms (one frame) by default, configurable per-timer.

2. **Pause/resume semantics under hydrate.** If a system dehydrates while
   a timer is paused, then rehydrates 1 hour later, does `pausedDurationMs`
   include the offline hour? Proposal: yes — pauses freeze; the wall-clock
   gap during dehydration is irrelevant.

3. **Multiple timers in one module.** Naming convention? Proposal:
   each timer is its own fact in the schema; there's no "timer registry."

4. **N-of-same-shape (`atomFamily` style).** A poker module with one timer
   per player. Today this is blocked by the spawn-model gap (Item #26).
   Proposal: defer — `t.timer` ships as singletons; multi-instance follows
   when the spawn API lands.

5. **Throttle / debounce.** Are these special timer modes (`mode:
   'throttle'`, `mode: 'debounce'`) or do consumers compose from
   primitives? Proposal: composable from primitives, no special modes.
   Throttle = countdown + flag. Debounce = reset-on-event. Document the
   recipe rather than building it in.

6. **Server / edge runtime.** Do timers in a server-only module fire
   during request handling? Proposal: server modules destroy at
   request-end; timers don't persist across requests unless explicitly
   dehydrated to a long-lived store.

## Migration path

`t.timer` is strictly additive. No breaking changes. Existing `useTickWhile`
consumers keep working. Existing manual `nowMs` patterns keep working.

Once shipped, the docs migrate (in order):
1. `docs/testing/fake-timers.md` — note that `t.timer` is the preferred
   pattern, link to the new API doc; keep the manual-fake-timers escape
   hatch for non-Directive setIntervals
2. `docs/derivations.md` — clock-in-derivation section pivots to "if you
   need elapsed time, use `t.timer` instead of `Date.now()`"
3. `docs/migrating-from-xstate.md` — `after:` row in the cheat-sheet
   updates to point at `t.timer`

The two helper packages currently in Phase 3:
- `@directive-run/mutator` — unaffected; `pendingAction` doesn't involve time
- `@directive-run/optimistic` — unaffected; rollback doesn't involve time

So `t.timer` doesn't obsolete the helpers. It does likely deprecate
`useTickWhile` for in-module use; the React hook stays for consumer-side
intervals (chat polling, cursor heartbeat) that aren't part of any module's
logic.

## Implementation sketch

```
packages/core/src/core/
  schema-builders.ts       # add t.timer({ms, mode?, source?})
  timer-fact.ts            # new — TimerFact runtime, clock binding
  clock.ts                 # new — SignalClock interface, realClock(),
                           #       virtualClock(), auto-detect
  engine.ts                # tick integration in flush phase
```

Estimated LOC delta: +400 source / +600 tests / +300 docs.
Estimated effort: 1.5 weeks for a solo dev with the surface area locked.

## Decision

This RFC is **draft**. Open for review. Defer implementation until:

1. AE-review-loop on this doc (security/correctness, architecture, DX,
   domain expert). Settle the clock-source choice on paper.
2. One concrete use-case prototype (in Minglingo: pick the simplest
   timer-using machine — likely `gameLobbyMachine`'s start-countdown — and
   sketch how it would read with `t.timer` before / after).
3. Budget confirmation. 1.5 weeks is a real fraction of the program; if
   Phase 5 (Time-travel REPL) is the bigger viral lever, this RFC may be
   queued behind it.

## See also

- [`MIGRATION_FEEDBACK.md`](../MIGRATION_FEEDBACK.md) — items 4, 15, 16, 18
- [Fake timers](../testing/fake-timers.md) — current escape hatch
- [Derivations § clock reads](../derivations.md#anti-pattern-clock-reads-in-derivations)
- [`@directive-run/react` `useTickWhile`](https://www.npmjs.com/package/@directive-run/react)
