/**
 * Phases: an opt-in, ordered split of one kernel settle (L0b).
 *
 * {@link withPhases} adds the `phases` feature to a kernel. Each settle then
 * runs every phase's handlers in {@link PHASES} order, then the graph's
 * effects run once, at the end (effects never see a half-settled tick;
 * computeds are pull-based, so a phase reading one sees current values).
 *
 * Graph writes made in a phase are settled by that closing graph flush; they
 * do not re-run the phases. A step that needs the phases to run again (a
 * resolver whose result the constraints must see) calls `kernel.request()`,
 * which gives the kernel another pass in the same lane flush.
 *
 * Also per-phase context: {@link Phases.ctx}.
 *
 * @module
 */

import type { Kernel } from "./kernel.js";
import type { Lane } from "./scheduler.js";

/** The ordered phases of one settle. */
export const PHASES = [
  "input",
  "simulate",
  "constraints",
  "resolvers",
  "render",
] as const;

export type Phase = (typeof PHASES)[number];

/** Context object built for user functions in one phase. */
export type Ctx = Record<string, unknown>;

export interface Phases {
  /** Run `fn` in `phase` each time the kernel settles. Returns a remover. */
  on(phase: Phase, fn: (lane: Lane) => void): () => void;
  readonly ctx: {
    /** Add members to the ctx of `phase`. Returns a remover. */
    extend(phase: Phase, fn: (ctx: Ctx) => void): () => void;
    /** Build a ctx for `phase`: `base` with every extender applied in order. */
    make<T extends Ctx>(phase: Phase, base: T): T;
  };
}

function phaseIndex(phase: Phase): number {
  const i = PHASES.indexOf(phase);
  if (i < 0) {
    throw Error(`[Directive] Unknown phase "${phase}"`);
  }

  return i;
}

const add = <T>(lists: T[][], phase: Phase, fn: T): (() => void) => {
  const list = lists[phaseIndex(phase)]!;
  list.push(fn);

  return () => {
    const i = list.indexOf(fn);
    if (i >= 0) {
      list.splice(i, 1);
    }
  };
};

/** Add (or get) the `phases` feature of `kernel`. */
export function withPhases(kernel: Kernel): Phases {
  if (kernel.has("phases")) {
    return kernel.feature("phases");
  }
  const handlers: Array<Array<(lane: Lane) => void>> = PHASES.map(() => []);
  const extenders: Array<Array<(ctx: Ctx) => void>> = PHASES.map(() => []);
  kernel.onSettle((lane) => {
    let error: unknown = handlers;
    for (const list of handlers) {
      for (const fn of list.slice()) {
        try {
          fn(lane);
        } catch (e) {
          if (error === handlers) {
            error = e;
          }
        }
      }
    }
    if (error !== handlers) {
      throw error;
    }
  });
  const phases: Phases = {
    on: (phase, fn) => add(handlers, phase, fn),
    ctx: {
      extend: (phase, fn) => add(extenders, phase, fn),
      make(phase, base) {
        for (const fn of extenders[phaseIndex(phase)]!) {
          fn(base);
        }

        return base;
      },
    },
  };
  kernel.define("phases", phases);

  return phases;
}
