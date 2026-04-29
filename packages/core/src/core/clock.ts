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

/**
 * Production clock — wraps `Date.now()` and `globalThis.setTimeout`.
 * No mocking, no virtualization.
 */
export function realClock(): SignalClock {
  return {
    now: () => Date.now(),
    setTimeout: (cb, ms) => {
      const handle = globalThis.setTimeout(cb, ms);
      return () => globalThis.clearTimeout(handle);
    },
  };
}

/**
 * Virtual clock — advances only when `advanceBy(ms)` is called. All
 * scheduled callbacks fire synchronously in order of their deadlines.
 *
 * Two scheduled callbacks at the same deadline fire in registration order.
 * Cancellation is O(1).
 */
export function virtualClock(initialMs = 0): SignalClock {
  let nowMs = initialMs;
  let nextId = 0;
  interface Scheduled {
    id: number;
    deadlineMs: number;
    cb: () => void;
    canceled: boolean;
  }
  const queue: Scheduled[] = [];

  return {
    now: () => nowMs,
    setTimeout: (cb, ms) => {
      const entry: Scheduled = {
        id: nextId++,
        deadlineMs: nowMs + ms,
        cb,
        canceled: false,
      };
      queue.push(entry);
      return () => {
        entry.canceled = true;
      };
    },
    advanceBy: (ms) => {
      const targetMs = nowMs + ms;
      // Fire all callbacks whose deadlines fall in [nowMs, targetMs].
      // Sort live entries by deadline + registration order so ties
      // resolve deterministically.
      while (true) {
        const ready = queue
          .filter((e) => !e.canceled && e.deadlineMs <= targetMs)
          .sort((a, b) =>
            a.deadlineMs !== b.deadlineMs
              ? a.deadlineMs - b.deadlineMs
              : a.id - b.id,
          );
        if (ready.length === 0) break;
        const next = ready[0]!;
        // Advance "now" monotonically — never let a callback that
        // schedules another callback in the past pull `nowMs`
        // backward. Without this clamp, `setTimeout(cb2, -5)` from
        // inside a callback would make `clock.now()` return a smaller
        // value mid-advance, breaking elapsedMs (negative results)
        // and replay determinism. (R1 sec C3.)
        nowMs = Math.max(nowMs, next.deadlineMs);
        next.canceled = true;
        next.cb();
      }
      // Final advance — even if no callbacks fired in [nowMs, targetMs],
      // wall clock still moves forward.
      nowMs = Math.max(nowMs, targetMs);
    },
  };
}

/**
 * Returns `realClock()` always.
 *
 * Earlier drafts auto-detected vitest (`process.env.VITEST === 'true'`)
 * and returned a `virtualClock()` in that environment. AE review
 * flagged this as a footgun: tests that legitimately need real time
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
