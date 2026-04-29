/**
 * Timer fact — a runtime container that advances over time on a
 * SignalClock (RFC 0001 v0.1).
 *
 * Produced by `createTimerFact(clock, opts)`. Holds the durable state
 * (startedAtMs, pausedDurationMs, status) and exposes a control surface
 * (start, pause, resume, reset) plus reactive reads (elapsedMs,
 * remainingMs, status).
 *
 * v0.1 SCOPE: timer is a "thick fact" — a single object you store in a
 * regular Directive fact (e.g. `t.object<TimerFactState>()`). The
 * engine doesn't auto-tick it; the consumer is responsible for calling
 * `timer.tick()` when they want elapsedMs / remainingMs to update.
 * Typical wiring: a setInterval in the consumer that calls `timer.tick()`
 * and dispatches an event when status changes.
 *
 * v0.2 (deferred): true `t.timer({ms})` schema integration where the
 * engine subscribes to the clock and writes the fact deltas itself,
 * eliminating the consumer-side tick wiring.
 *
 * @see ../../docs/rfcs/0001-t-timer.md
 */

// SignalClock is the canonical time source for timer ops; consumers
// pass `clock.now()` into the helpers below. Re-exported by index.ts
// alongside this module so they can `import { realClock, timerOps,
// initialTimerState } from "@directive-run/core"` together.

/**
 * Persistent timer state — JSON-roundtrippable, suitable for storing
 * inside a Directive fact.
 */
export interface TimerFactState {
  /** Unix-ms when the timer last started or resumed. null = not running. */
  startedAtMs: number | null;
  /** Total ms accumulated while paused. */
  pausedDurationMs: number;
  /** ms when the timer was paused, if currently paused. null otherwise. */
  pausedAtMs: number | null;
  /**
   * - 'idle': not yet started, or reset.
   * - 'running': currently counting.
   * - 'paused': paused; pausedAtMs is set.
   * - 'completed': hit the deadline (countdown mode only).
   */
  status: "idle" | "running" | "paused" | "completed";
  /** Number of times the timer has fired (repeat mode only). */
  repeats: number;
}

export interface TimerFactOpts {
  /** Duration in ms. Countdown mode counts this down; up mode counts up to ∞. */
  ms: number;
  /**
   * - 'down' (default): counts down from `ms` to 0; status → 'completed' at 0.
   * - 'up': counts elapsed time; never completes.
   * - 'repeat': fires every `ms`; increments `repeats`; status stays 'running'.
   */
  mode?: "down" | "up" | "repeat";
}

/**
 * Initial state for a newly-created timer. Pass this to your Directive
 * `init()` to seed the fact.
 */
export function initialTimerState(): TimerFactState {
  return {
    startedAtMs: null,
    pausedDurationMs: 0,
    pausedAtMs: null,
    status: "idle",
    repeats: 0,
  };
}

/**
 * Compute elapsed ms for a given timer state at a given clock-now.
 * Pure function — no side effects, no reads beyond its inputs.
 *
 * @example
 * ```ts
 * const elapsed = elapsedMs(facts.countdown, clock.now());
 * if (elapsed >= 60_000) {
 *   facts.countdown = { ...facts.countdown, status: 'completed' };
 * }
 * ```
 */
export function elapsedMs(state: TimerFactState, nowMs: number): number {
  if (state.startedAtMs === null) return 0;
  // Clamp at 0 — a clock step-back (NTP correction, virtual-clock
  // re-entrancy, replay seeded from older snapshot) would otherwise
  // produce negative elapsed values that:
  //   - make tickTimer never report 'complete' (because `elapsed >= ms`
  //     stays false past the deadline)
  //   - make remainingMs report values > the configured ms total
  //   - silently wrap into pausedDurationMs accumulation downstream
  // (R1 sec C4.)
  if (state.status === "paused" && state.pausedAtMs !== null) {
    return Math.max(
      0,
      state.pausedAtMs - state.startedAtMs - state.pausedDurationMs,
    );
  }
  return Math.max(0, nowMs - state.startedAtMs - state.pausedDurationMs);
}

/**
 * Compute remaining ms for a countdown timer at a given clock-now.
 * Returns 0 if the timer has hit zero or hasn't started.
 */
export function remainingMs(
  state: TimerFactState,
  nowMs: number,
  totalMs: number,
): number {
  return Math.max(0, totalMs - elapsedMs(state, nowMs));
}

/**
 * Transition: start an idle (or reset) timer.
 *
 * No-op if already running, paused, or completed (use `reset()` first).
 */
export function startTimer(
  state: TimerFactState,
  nowMs: number,
): TimerFactState {
  if (state.status === "running") return state;
  if (state.status === "paused") return state;
  return {
    ...state,
    startedAtMs: nowMs,
    pausedDurationMs: 0,
    pausedAtMs: null,
    status: "running",
    repeats: 0,
  };
}

/**
 * Transition: pause a running timer. Records the pause moment so a
 * later `resumeTimer()` can correctly extend pausedDurationMs.
 *
 * No-op if not running.
 */
export function pauseTimer(
  state: TimerFactState,
  nowMs: number,
): TimerFactState {
  if (state.status !== "running") return state;
  return { ...state, pausedAtMs: nowMs, status: "paused" };
}

/**
 * Transition: resume a paused timer. Adds the time spent paused into
 * `pausedDurationMs` so elapsed/remaining math stays correct.
 *
 * No-op if not paused.
 */
export function resumeTimer(
  state: TimerFactState,
  nowMs: number,
): TimerFactState {
  if (state.status !== "paused") return state;
  if (state.pausedAtMs === null) return state;
  // Clamp pausedFor at 0 — clock step-back between pause and resume
  // would otherwise produce a negative pausedDurationMs accumulation,
  // which propagates into elapsedMs (returns inflated values), which
  // prematurely completes countdowns. (R1 sec M1.)
  const pausedFor = Math.max(0, nowMs - state.pausedAtMs);
  return {
    ...state,
    pausedDurationMs: state.pausedDurationMs + pausedFor,
    pausedAtMs: null,
    status: "running",
  };
}

/**
 * Transition: reset a timer to idle. Loses all elapsed time + repeat
 * count. Equivalent to `initialTimerState()`.
 */
export function resetTimer(): TimerFactState {
  return initialTimerState();
}

/**
 * Transition: mark the timer completed. For countdown mode when
 * elapsed >= ms; for repeat mode when consumer wants to halt.
 */
export function completeTimer(state: TimerFactState): TimerFactState {
  return { ...state, status: "completed" };
}

/**
 * Transition: register a repeat firing. Increments `repeats` and
 * advances `startedAtMs` by `ms` so the next interval lands at the
 * intended boundary (drift-free).
 */
export function registerRepeat(
  state: TimerFactState,
  ms: number,
): TimerFactState {
  if (state.startedAtMs === null) return state;
  // Reset pausedDurationMs on each repeat so accumulated pause time
  // from prior intervals does not double-count into the next
  // interval's elapsed math. Without this reset, every repeat after a
  // pause would arithmetic-drift the next deadline by the cumulative
  // pause window. (R1 sec M9.)
  return {
    ...state,
    startedAtMs: state.startedAtMs + ms,
    pausedDurationMs: 0,
    pausedAtMs: null,
    repeats: state.repeats + 1,
  };
}

/**
 * Higher-level helper: given a timer state, total ms, and the current
 * clock, return whether the timer should transition to 'completed' (for
 * countdown mode) or fire a repeat (for repeat mode).
 *
 * Pure — does not mutate state. Returns a structured signal the consumer
 * applies via `completeTimer` / `registerRepeat`.
 */
export function tickTimer(
  state: TimerFactState,
  nowMs: number,
  opts: TimerFactOpts,
): { kind: "no-op" } | { kind: "complete" } | { kind: "repeat" } {
  if (state.status !== "running") return { kind: "no-op" };
  const elapsed = elapsedMs(state, nowMs);

  if (opts.mode === "up") {
    // 'up' never completes; consumer reads elapsedMs directly.
    return { kind: "no-op" };
  }

  if (opts.mode === "repeat") {
    if (elapsed >= opts.ms) return { kind: "repeat" };
    return { kind: "no-op" };
  }

  // 'down' (default)
  if (elapsed >= opts.ms) return { kind: "complete" };
  return { kind: "no-op" };
}

/**
 * Bundle of helpers for one timer in one module — convenience for
 * callers who want a single import. Each method takes the current
 * state and clock-now, returns the next state. No mutation.
 *
 * @example
 * ```ts
 * import {
 *   createSystem,
 *   t,
 *   realClock,
 *   timerOps,
 *   initialTimerState,
 *   type TimerFactState,
 * } from '@directive-run/core';
 *
 * const clock = realClock();
 * const ops = timerOps({ ms: 60_000, mode: 'down' });
 *
 * createModule('countdown', {
 *   schema: { facts: { state: t.object<TimerFactState>() }, events: { START: {} } },
 *   init: (f) => { f.state = initialTimerState(); },
 *   events: {
 *     START: (f) => { f.state = ops.start(f.state, clock.now()); },
 *   },
 * });
 *
 * // In the consumer (React, Node, edge), tick periodically:
 * setInterval(() => {
 *   const signal = ops.tick(f.state, clock.now());
 *   if (signal.kind === 'complete') {
 *     sys.dispatch({ type: 'TIMEOUT' });
 *   }
 * }, 100);
 * ```
 */
export function timerOps(opts: TimerFactOpts) {
  return {
    initial: initialTimerState,
    start: startTimer,
    pause: pauseTimer,
    resume: resumeTimer,
    reset: resetTimer,
    complete: completeTimer,
    registerRepeat: (state: TimerFactState) => registerRepeat(state, opts.ms),
    tick: (state: TimerFactState, nowMs: number) => tickTimer(state, nowMs, opts),
    elapsedMs,
    remainingMs: (state: TimerFactState, nowMs: number) =>
      remainingMs(state, nowMs, opts.ms),
  };
}
