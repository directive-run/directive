---
"@directive-run/core": minor
---

Add `SignalClock` + timer helpers (RFC 0001 v0.1)

Resolves four MIGRATION_FEEDBACK items in one shape: declarative `after` (#4), fake-timer integration (#15), clock-in-derivation (#16), and predicate-gated tick wiring (#18).

**New exports** (all from `@directive-run/core`):
- `SignalClock` interface — injectable time source.
- `realClock()` — production clock backed by `Date.now()` + `globalThis.setTimeout`.
- `virtualClock(initialMs?)` — test clock; advance synchronously via `clock.advanceBy(ms)` to fire scheduled callbacks in deadline order.
- `defaultClock()` — auto-detects vitest (`process.env.VITEST === 'true'`) and returns `virtualClock()` there, `realClock()` everywhere else.
- `TimerFactState` interface — JSON-roundtrippable timer state (idle / running / paused / completed) suitable for storing inside any Directive fact.
- `initialTimerState()`, `startTimer()`, `pauseTimer()`, `resumeTimer()`, `resetTimer()`, `completeTimer()`, `registerRepeat()` — pure transition helpers.
- `elapsedMs()`, `remainingMs()`, `tickTimer()` — pure read helpers; `tickTimer` returns a structured signal (`'no-op' | 'complete' | 'repeat'`).
- `timerOps({ms, mode})` — convenience bundle of all of the above closed over a single timer's options.

**Scope:** v0.1 ships the value layer. The engine doesn't auto-tick timer facts yet — consumers wire a small `setInterval(() => sys.events.TICK(), 100)`. Engine-integrated `t.timer({ms})` schema is the v0.2 deliverable.

**Replay determinism:** the clock is the only source of time in timer ops. Replaying through a `virtualClock` seeded from a recorded stream reproduces fact streams byte-for-byte. Pause durations survive dehydrate/hydrate intact.

35 new tests (`clock.test.ts` ×14, `timer.test.ts` ×21).

Docs: [`docs/api/timer.md`](https://github.com/directive-run/directive/blob/main/docs/api/timer.md).
