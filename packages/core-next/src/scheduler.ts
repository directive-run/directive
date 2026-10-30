/**
 * The scheduler: decides when systems flush (L0b).
 *
 * One scheduler can serve many systems. A system asks for a flush on a
 * {@link Lane} with {@link Scheduler.request}; however many systems ask in
 * one tick, each lane arms its host callback once and flushes every waiting
 * system in one pass, in registration order (the deterministic tie-break).
 *
 * Lanes:
 * - `sync`: flushes before `request` returns.
 * - `micro`: one microtask per tick.
 * - `frame`: the host's next frame (a 16 ms host timeout by default; pass
 *   {@link browserHosts} for `requestAnimationFrame`).
 * - `idle`: the host's idle time (a 0 ms host timeout by default;
 *   {@link browserHosts} gives `requestIdleCallback`).
 * - `manual`: only on an explicit {@link Scheduler.flush}.
 *
 * Every host function is injectable, and the defaults are looked up when
 * {@link createScheduler} runs, never at import time. There is no module-level
 * mutable state.
 *
 * A target requested again while its lane is flushing (from its own flush or
 * anyone else's) flushes again in the lane's next pass, so work queued by a
 * late step of a flush always gets another pass. Phases are not a scheduler
 * concern: see `withPhases` (phases.ts), which runs them inside one settle.
 *
 * @module
 */

/** When a flush runs. */
export type Lane = "sync" | "micro" | "frame" | "idle" | "manual";

/** Lanes in the order {@link Scheduler.flush} drains them when given none. */
export const LANES: readonly Lane[] = [
  "sync",
  "micro",
  "frame",
  "idle",
  "manual",
];

/** Something a scheduler flushes: a system or kernel. */
export interface SchedulerTarget {
  /** Settle: run whatever this target has queued (graph effects and so on). */
  flush(lane: Lane): void;
}

/** Runs `cb` later. */
export type HostCallback = (cb: () => void) => void;

export interface SchedulerOptions {
  /** Defaults to `queueMicrotask`, else a resolved promise. */
  micro?: HostCallback;
  /** Defaults to a 16 ms host timeout. */
  frame?: HostCallback;
  /** Defaults to a 0 ms host timeout. */
  idle?: HostCallback;
  /** Most passes one lane flush may take before it throws. Default 100. */
  maxPasses?: number;
}

export interface Scheduler {
  /**
   * Add a target and return its registration index (its tie-break rank).
   * Idempotent. {@link request} registers on first use.
   */
  register(target: SchedulerTarget): number;
  /** Forget a target: drop its pending requests. */
  unregister(target: SchedulerTarget): void;
  /** Ask for `target` to flush on `lane`. */
  request(lane: Lane, target: SchedulerTarget): void;
  /**
   * Flush `lane` now (every lane, in {@link LANES} order, when omitted).
   * With `only`, flush just that target and leave the others waiting.
   * Errors are collected; the first is rethrown once the lane drains. A lane
   * that needs more than `maxPasses` passes throws and drops what still
   * waits on it; later requests flush normally.
   */
  flush(lane?: Lane, only?: SchedulerTarget): void;
  /** True when anything waits on `lane` (any lane when omitted). */
  pending(lane?: Lane): boolean;
}

/**
 * An error collector, shared by every "run them all, rethrow the first
 * error" loop of the kernel's services. `guard(fn)` runs `fn` and keeps its
 * error when it is the first; `guard()` rethrows that one, if any.
 */
export function catcher(): (fn?: () => void) => void {
  // The function itself marks "no error": user code can never throw it.
  let first: unknown = catcher;

  return (fn) => {
    if (fn) {
      try {
        fn();
      } catch (error) {
        if (first === catcher) {
          first = error;
        }
      }
    } else if (first !== catcher) {
      throw first;
    }
  };
}

const hostTimeout =
  (ms: number): HostCallback =>
  (cb) =>
    (globalThis as any).setTimeout(cb, ms);

/**
 * `requestAnimationFrame` / `requestIdleCallback` hosts for the `frame` and
 * `idle` lanes, looked up when called (falling back to host timeouts).
 * Opt-in: `createScheduler({ ...browserHosts() })`.
 */
export function browserHosts(): Pick<SchedulerOptions, "frame" | "idle"> {
  const g = globalThis as any;

  return {
    frame: g.requestAnimationFrame
      ? (cb) => g.requestAnimationFrame(cb)
      : hostTimeout(16),
    idle: g.requestIdleCallback
      ? (cb) => g.requestIdleCallback(cb)
      : hostTimeout(0),
  };
}

/** Create a scheduler. Share it between systems to flush them together. */
export function createScheduler(options: SchedulerOptions = {}): Scheduler {
  const g = globalThis as any;
  const micro: HostCallback =
    options.micro ??
    (g.queueMicrotask
      ? (cb) => g.queueMicrotask(cb)
      : (cb) => Promise.resolve().then(cb));
  const maxPasses = options.maxPasses ?? 100;
  /** Registration index per target: the tie-break rank. */
  const index = new Map<SchedulerTarget, number>();
  /** Targets waiting per lane, in request order. */
  const waiting = Object.fromEntries(
    LANES.map((lane) => [lane, new Set<SchedulerTarget>()]),
  ) as Record<Lane, Set<SchedulerTarget>>;
  /** Lanes whose host callback is armed. */
  const armed = new Set<Lane>();
  /** Lanes flushing now; a request for one joins the running flush. */
  const running = new Set<Lane>();
  let next = 0;

  const register = (target: SchedulerTarget): number => {
    if (!index.has(target)) {
      index.set(target, next++);
    }

    return index.get(target)!;
  };

  const flushLane = (lane: Lane, only?: SchedulerTarget): void => {
    const queue = waiting[lane];
    const guard = catcher();
    const nested = running.has(lane);
    running.add(lane);
    try {
      for (let pass = 0; ; pass++) {
        const batch = only ? (queue.has(only) ? [only] : []) : [...queue];
        if (!batch.length) {
          break;
        }
        if (pass >= maxPasses) {
          // Drop what still waits, so the targets are not wedged: a later
          // request queues them again.
          for (const target of batch) {
            queue.delete(target);
          }
          throw Error(`[Directive] ${lane} lane did not settle`);
        }
        batch.sort((a, b) => index.get(a)! - index.get(b)!);
        for (const target of batch) {
          // Leaves the queue just before its flush: a request from here on
          // (its own flush included) queues it for the next pass, while one
          // made earlier in this pass is met by this flush.
          if (queue.delete(target)) {
            guard(() => target.flush(lane));
          }
        }
      }
    } finally {
      if (!nested) {
        running.delete(lane);
      }
    }
    guard();
  };

  return {
    register,
    unregister(target) {
      if (index.delete(target)) {
        for (const lane of LANES) {
          waiting[lane].delete(target);
        }
      }
    },
    request(lane, target) {
      register(target);
      waiting[lane].add(target);
      if (lane === "sync") {
        // A running sync flush picks this up in its next pass.
        if (!running.has(lane)) {
          flushLane(lane);
        }
      } else if (lane !== "manual" && !armed.has(lane)) {
        // Hosts are looked up on first use of their lane. The callback
        // captures this block's `l`, not the parameter: a capture of `lane`
        // would allocate a context on every request, armed or not.
        const l = lane;
        armed.add(l);
        (l === "micro"
          ? micro
          : (options[l] ?? hostTimeout(l === "frame" ? 16 : 0)))(() => {
          armed.delete(l);
          flushLane(l);
        });
      }
    },
    flush(lane, only) {
      const guard = catcher();
      for (const l of lane ? [lane] : LANES) {
        guard(() => flushLane(l, only));
      }
      guard();
    },
    pending: (lane) => (lane ? [lane] : LANES).some((l) => waiting[l].size > 0),
  };
}
