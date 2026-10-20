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
 * - `frame`: the host's next frame (`requestAnimationFrame` when present).
 * - `idle`: the host's idle time (`requestIdleCallback` when present).
 * - `manual`: only on an explicit {@link Scheduler.flush}.
 *
 * Every host function is injectable, and the defaults are looked up when
 * {@link createScheduler} runs, never at import time. There is no module-level
 * mutable state.
 *
 * A lane flush runs in named {@link PHASES}: for each phase in order, every
 * waiting system's handlers for that phase run (registration order), then
 * each system settles (its `flush`). A system with no phase handlers settles
 * exactly once per lane flush.
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

/** The ordered phases of one lane flush. */
export const PHASES = [
  "input",
  "simulate",
  "constraints",
  "resolvers",
  "render",
] as const;

export type Phase = (typeof PHASES)[number];

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
  /** Defaults to `requestAnimationFrame`, else a 16 ms host timeout. */
  frame?: HostCallback;
  /** Defaults to `requestIdleCallback`, else a 0 ms host timeout. */
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
  /** Forget a target: drop its pending requests and phase handlers. */
  unregister(target: SchedulerTarget): void;
  /** Ask for `target` to flush on `lane`. */
  request(lane: Lane, target: SchedulerTarget): void;
  /**
   * Flush `lane` now (every lane, in {@link LANES} order, when omitted).
   * With `only`, flush just that target and leave the others waiting.
   * Errors are collected; the first is rethrown once the lane drains.
   */
  flush(lane?: Lane, only?: SchedulerTarget): void;
  /**
   * Run `fn` in `phase` whenever `target` flushes. Returns a remover.
   */
  phase(
    phase: Phase,
    target: SchedulerTarget,
    fn: (lane: Lane) => void,
  ): () => void;
  /** True when anything waits on `lane` (any lane when omitted). */
  pending(lane?: Lane): boolean;
}

interface Entry {
  index: number;
  target: SchedulerTarget;
  /** Lanes this entry waits on, one bit per {@link LANES} index. */
  mask: number;
  /**
   * Lanes whose running pass has this entry and has yet to settle it for the
   * last time. A request on such a lane is already covered by that settle.
   */
  busy: number;
  /** Phase handlers, by phase index. */
  handlers: Array<Array<(lane: Lane) => void> | undefined>;
}

const laneBit = (lane: Lane): number => 1 << LANES.indexOf(lane);

function hostTimeout(ms: number): HostCallback {
  const g = globalThis as any;

  return (cb) => g.setTimeout(cb, ms);
}

/** Create a scheduler. Share it between systems to flush them together. */
export function createScheduler(options: SchedulerOptions = {}): Scheduler {
  const g = globalThis as any;
  const micro: HostCallback =
    options.micro ??
    (g.queueMicrotask
      ? (cb) => g.queueMicrotask(cb)
      : (cb) => Promise.resolve().then(cb));
  const host: Record<Lane, HostCallback | undefined> = {
    sync: undefined,
    micro,
    frame:
      options.frame ??
      (g.requestAnimationFrame
        ? (cb) => g.requestAnimationFrame(cb)
        : hostTimeout(16)),
    idle:
      options.idle ??
      (g.requestIdleCallback
        ? (cb) => g.requestIdleCallback(cb)
        : hostTimeout(0)),
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
      e = { index: next++, target, mask: 0, busy: 0, handlers: [] };
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
          batch = e && e.mask & bit ? [e] : [];
          if (batch.length) {
            queue.splice(queue.indexOf(e!), 1);
          }
        } else {
          batch = queue.splice(0);
        }
        if (!batch.length) {
          break;
        }
        if (pass >= maxPasses) {
          throw Error(`[Directive] ${lane} lane did not settle`);
        }
        batch.sort((a, b) => a.index - b.index);
        for (const e of batch) {
          e.mask &= ~bit;
          e.busy |= bit;
        }
        for (let p = 0; p < PHASES.length; p++) {
          let ran = false;
          for (const e of batch) {
            const list = e.handlers[p];
            if (list?.length) {
              ran = true;
              for (const fn of list.slice()) {
                try {
                  fn(lane);
                } catch (err) {
                  if (error === queue) {
                    error = err;
                  }
                }
              }
            }
          }
          // Settle after each phase that did work, so the next phase sees a
          // settled graph. With no handlers this is skipped until the end.
          const last = p === PHASES.length - 1;
          if (ran || last) {
            for (const e of batch) {
              if (last) {
                e.busy &= ~bit;
              }
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
      if (e.busy & bit) {
        return;
      }
      if (!(e.mask & bit)) {
        e.mask |= bit;
        waiting[lane].push(e);
      }
      if (lane === "sync") {
        // A running sync flush picks this up in its next pass.
        if (!(running & bit)) {
          flushLane(lane);
        }
      } else {
        arm(lane);
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
    phase(phase, target, fn) {
      const p = PHASES.indexOf(phase);
      if (p < 0) {
        throw Error(`[Directive] Unknown phase "${phase}"`);
      }
      const list = (entry(target).handlers[p] ??= []);
      list.push(fn);

      return () => {
        const i = list.indexOf(fn);
        if (i >= 0) {
          list.splice(i, 1);
        }
      };
    },
    pending(lane) {
      return lane
        ? waiting[lane].length > 0
        : LANES.some((l) => waiting[l].length > 0);
    },
  };
}
