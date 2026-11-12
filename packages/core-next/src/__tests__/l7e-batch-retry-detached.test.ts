/**
 * A detached batch run fails under a "retry" boundary, found by the L8
 * gate's fuzz (seed 13, case 56; api/reconcile.ts `onError`).
 *
 * A bound (`abortOn`) requirement retracted while its batch runs detaches
 * the batch; raised again, a fresh batch runs it. When the detached batch
 * then fails, it is not the requirement's run any more. 1.35 dispatches the
 * requirement again at once (its resolve() asks only single runs), and
 * nothing more. Before the fix 2.0 took that failure for the current run's:
 * it waited for the fresh batch to end, and its quirk (a) requeue ran the
 * requirement again after a run that had already met it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/module.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

const tick = async (n = 10) => {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
};

/** The first call waits `firstWait` ms and fails; each later one writes. */
function setup(firstWait: number) {
  const starts: [number, number][] = [];
  const mod = createModule("m", {
    schema: {
      facts: { want: t.boolean(), out: t.number() },
      derivations: {},
      events: {},
      requirements: { FETCH: { id: t.string() } },
    },
    init: (f: any) => {
      f.want = false;
      f.out = 0;
    },
    constraints: {
      fetch: {
        when: (f: any) => f.want,
        require: () => [{ type: "FETCH", id: "x" }],
        abortOn: ["out"],
      },
    },
    resolvers: {
      fetch: {
        requirement: "FETCH",
        key: (r: any) => r.id,
        batch: { enabled: true, windowMs: 0, maxSize: 1 },
        resolveBatch: async (_reqs: any[], ctx: any) => {
          const n = starts.push([starts.length + 1, Date.now()]);
          await new Promise((r) => setTimeout(r, n === 1 ? firstWait : 20));
          if (n === 1) {
            throw new Error("first fails");
          }
          ctx.facts.out = n * 10;
        },
      },
    },
  } as never);
  const system = createSystem({
    module: mod,
    errorBoundary: { onResolverError: "retry" },
  } as never);

  return { starts, system, facts: system.facts as any };
}

/** Raise x (call 1), retract it (detached), raise it again (call 2). */
async function detachAndRaise(facts: any) {
  facts.want = true;
  await vi.advanceTimersByTimeAsync(1);
  facts.want = false;
  await vi.advanceTimersByTimeAsync(1);
  facts.want = true;
  await tick();
}

describe("a detached batch run fails under a retry boundary", () => {
  it("dispatches the requirement again at once while a fresh batch runs (1.35)", async () => {
    const { starts, system, facts } = setup(20);
    system.start();
    await tick();
    await detachAndRaise(facts);
    await vi.advanceTimersByTimeAsync(300);
    // Call 1 fails at 20 ms, while call 2 (from 2 ms) still runs: call 3
    // starts then, not when call 2 ends at 22 ms.
    expect(starts).toEqual([
      [1, 0],
      [2, 2],
      [3, 20],
    ]);
    system.stop();
  });

  it("runs it again once, not again after that run meets it (1.35)", async () => {
    const { starts, system, facts } = setup(50);
    system.start();
    await tick();
    await detachAndRaise(facts);
    await vi.advanceTimersByTimeAsync(300);
    // Call 2 meets x at 22 ms; call 1 fails at 50 ms, so call 3 runs x
    // again and meets it at 70 ms. Before the fix a call 4 followed.
    expect(starts).toEqual([
      [1, 0],
      [2, 2],
      [3, 50],
    ]);
    expect(facts.out).toBe(30);
    system.stop();
  });
});
