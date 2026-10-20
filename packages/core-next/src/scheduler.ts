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

interface Entry {
  index: number;
  target: SchedulerTarget;
  /** Lanes this entry waits on, one bit per {@link LANES} index. */
  mask: number;
}

const laneBit = (lane: Lane): number => 1 << LANES.indexOf(lane);

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
  const host: Record<Lane, HostCallback | undefined> = {
    sync: undefined,
    micro:
      options.micro ??
      (g.queueMicrotask
        ? (cb) => g.queueMicrotask(cb)
        : (cb) => Promise.resolve().then(cb)),
    frame: options.frame ?? hostTimeout(16),
    idle: options.idle ?? hostTimeout(0),
    manual: undefined,
  };
  const maxPasses = options.maxPasses ?? 100;
  const entries = new Map<SchedulerTarget, Entry>();
  const waiting: Record<Lane, Entry[]> = {
    sync: [],
    micro: [],
    frame: [],
    idle: [],
    manual: [],
  };
  /** Lanes whose host callback is armed. */
  let armed = 0;
  /** Lanes flushing now; a request for one joins the running flush. */
  let running = 0;
  let next = 0;

  const entry = (target: SchedulerTarget): Entry => {
    let e = entries.get(target);
    if (!e) {
      e = { index: next++, target, mask: 0 };
      entries.set(target, e);
    }

    return e;
  };

  const flushLane = (lane: Lane, only?: SchedulerTarget): void => {
    const bit = laneBit(lane);
    const queue = waiting[lane];
    // The queue itself marks "no error": user code can never throw it.
    let error: unknown = queue;
    const prevRunning = running;
    running |= bit;
    try {
      for (let pass = 0; ; pass++) {
        let batch: Entry[];
        if (only) {
          const e = entries.get(only);
          batch = e && e.mask & bit ? queue.splice(queue.indexOf(e), 1) : [];
        } else {
          batch = queue.splice(0);
        }
        if (!batch.length) {
          break;
        }
        if (pass >= maxPasses) {
          // Drop what still waits, so the targets are not wedged: a later
          // request queues them again.
          for (const e of batch) {
            e.mask &= ~bit;
          }
          throw Error(`[Directive] ${lane} lane did not settle`);
        }
        batch.sort((a, b) => a.index - b.index);
        for (const e of batch) {
          // Cleared just before its flush: a request from here on (its own
          // flush included) queues it for the next pass.
          e.mask &= ~bit;
          if (entries.get(e.target) === e) {
            try {
              e.target.flush(lane);
            } catch (err) {
              if (error === queue) {
                error = err;
              }
            }
          }
        }
      }
    } finally {
      running = prevRunning;
    }
    if (error !== queue) {
      throw error;
    }
  };

  const arm = (lane: Lane): void => {
    const bit = laneBit(lane);
    const cb = host[lane];
    if (!cb || armed & bit) {
      return;
    }
    armed |= bit;
    cb(() => {
      armed &= ~bit;
      flushLane(lane);
    });
  };

  return {
    register: (target) => entry(target).index,
    unregister(target) {
      const e = entries.get(target);
      if (!e) {
        return;
      }
      entries.delete(target);
      for (const lane of LANES) {
        const q = waiting[lane];
        const i = q.indexOf(e);
        if (i >= 0) {
          q.splice(i, 1);
        }
      }
      e.mask = 0;
    },
    request(lane, target) {
      const bit = laneBit(lane);
      const e = entry(target);
      if (!(e.mask & bit)) {
        e.mask |= bit;
        waiting[lane].push(e);
      }
      if (lane !== "sync") {
        arm(lane);
      } else if (!(running & bit)) {
        // A running sync flush picks this up in its next pass.
        flushLane(lane);
      }
    },
    flush(lane, only) {
      if (lane) {
        flushLane(lane, only);

        return;
      }
      let error: unknown = entries;
      for (const l of LANES) {
        try {
          flushLane(l, only);
        } catch (err) {
          if (error === entries) {
            error = err;
          }
        }
      }
      if (error !== entries) {
        throw error;
      }
    },
    pending(lane) {
      return lane
        ? waiting[lane].length > 0
        : LANES.some((l) => waiting[l].length > 0);
    },
  };
}
