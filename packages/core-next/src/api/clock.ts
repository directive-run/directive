/**
 * SignalClock — injectable clock source for declarative timers (RFC 0001).
 *
 * The clock interface decouples Directive's timer primitives from any
 * single time source. Production uses `realClock()`. Tests use
 * `virtualClock()` which advances synchronously via `clock.advanceBy()`.
 * Replay / dehydrate scenarios use a clock seeded from the recorded
 * stream.
 *
 * Auto-detection: `defaultClock()` returns `virtualClock()` when running
 * under Vitest (process.env.VITEST === 'true'), otherwise `realClock()`.
 * Consumers can pass an explicit clock to `createSystem({ clock })` to
 * override.
 *
 * @see ../../docs/rfcs/0001-t-timer.md
 */

import { type Clock, createClock, createVirtualClock } from "../clock.js";

/**
 * Stable interface for any time source.
 */
export interface SignalClock {
  /** Current time, in milliseconds since the Unix epoch. */
  now(): number;
  /**
   * Schedule a callback to fire after `ms` milliseconds. Returns a
   * cancellation function. Implementations may queue callbacks or fire
   * them on a tick boundary; the only contract is "fires no earlier
   * than `ms` from now."
   */
  setTimeout(cb: () => void, ms: number): () => void;
  /**
   * (Test-only.) Synchronously advance the clock by `ms` milliseconds,
   * firing all scheduled callbacks whose deadlines fall within the
   * advanced window. Real clocks throw if called.
   */
  advanceBy?(ms: number): void;
}

/** The 1.35 shape over one of the kernel's clocks (clock.ts). */
const signalClock = (clock: Clock): SignalClock => ({
  now: () => clock.now(),
  setTimeout(cb, ms) {
    const id = clock.setTimeout(cb, ms);

    return () => clock.clearTimeout(id);
  },
});

/**
 * Production clock: `Date.now()` and the host `setTimeout`, through the
 * kernel's real clock ({@link createClock}).
 */
export function realClock(): SignalClock {
  return signalClock(createClock({ now: () => Date.now() }));
}

/**
 * Virtual clock: advances only when `advanceBy(ms)` is called, firing every
 * callback whose deadline falls in the window, in deadline order (ties in
 * registration order), with `now()` at each callback's deadline. Time never
 * moves backwards: a callback set "in the past" fires at the current time.
 * Built on the kernel's virtual clock ({@link createVirtualClock}).
 */
export function virtualClock(initialMs = 0): SignalClock {
  const clock = createVirtualClock(initialMs);

  return {
    ...signalClock(clock),
    advanceBy: (ms) => clock.advanceTo(clock.now() + ms),
  };
}

/**
 * Returns `realClock()` always.
 *
 * Earlier drafts auto-detected vitest (`process.env.VITEST === 'true'`)
 * and returned a `virtualClock()` in that environment. That behavior
 * turned out to be a footgun: tests that legitimately need real time
 * (sleep-based debounce checks, real-`setTimeout`-bound integration
 * fixtures) silently received a virtual clock that never advanced
 * unless the test author called `advanceBy()`, producing apparent
 * deadlocks indistinguishable from genuine bugs. Auto-detection is
 * therefore opt-in.
 *
 * Use {@link virtualClock} explicitly in tests:
 *
 * ```ts
 * const clock = virtualClock(0);
 * const sys = createSystem({ module, clock });
 * clock.advanceBy(1_000);
 * ```
 */
export function defaultClock(): SignalClock {
  return realClock();
}
