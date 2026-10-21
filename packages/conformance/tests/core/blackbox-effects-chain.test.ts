// Ported from packages/core/src/core/__tests__/blackbox-effects-chain.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

/**
 * Black-box conformance for effects that wake themselves: an effect that
 * dispatches an event through a captured system each time it runs.
 *
 * Public API only. Pins 1.35's two observable behaviours: each follow-up
 * pass runs on its own microtask, and a chain of passes started only by
 * effects is cut after a bounded number of passes with a warning, leaving
 * the system live. The exact limit and warning text are not contracts.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Lets queued microtasks run; no real timers. */
async function drain(turns = 2000) {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

/** An effect that dispatches `inc` while 0 < n < limit. */
function selfWaking(limit = Number.POSITIVE_INFINITY) {
  const runs: number[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: the system is captured before it exists
  let sys: any;
  const module = createModule("chain", {
    schema: { facts: { n: t.number() }, events: { inc: {} } },
    init: (facts) => {
      facts.n = 0;
    },
    events: {
      inc: (facts) => {
        facts.n = facts.n + 1;
      },
    },
    effects: {
      wake: {
        run: (facts) => {
          runs.push(facts.n);
          if (facts.n > 0 && facts.n < limit) {
            sys.events.inc();
          }
        },
      },
    },
  });

  return {
    module,
    runs,
    // biome-ignore lint/suspicious/noExplicitAny: see above
    bind: <S>(s: S): S => (sys = s as any),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("an effect that keeps waking itself", () => {
  it("is cut after a bounded number of chained passes, with a warning, and the system stays live", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { module, runs, bind } = selfWaking();
    const system = bind(createSystem({ module }));
    system.start();
    await Promise.resolve();
    system.events.inc();
    await drain();

    // The chain ran for a while, then stopped on its own.
    expect(runs.length).toBeGreaterThan(10);
    expect(runs.length).toBeLessThan(1000);
    // The last dispatch lands; only its effect pass is cut.
    expect(
      system.facts.n - (runs[runs.length - 1] as number),
    ).toBeLessThanOrEqual(1);
    expect(system.isSettled).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/kept waking/i));

    runs.length = 0;
    system.facts.n = -100;
    await drain();
    expect(runs).toEqual([-100]);
    expect(system.isSettled).toBe(true);
    system.destroy();
  });

  it("runs each follow-up pass on its own microtask", async () => {
    const { module, bind } = selfWaking(3);
    const ticks: number[] = [];
    let tick = 0;
    const system = bind(
      createSystem({
        module,
        plugins: [{ name: "ticks", onReconcileStart: () => ticks.push(tick) }],
      }),
    );
    system.start();
    tick = 0;
    const ticker = (async () => {
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
        tick++;
      }
    })();
    await Promise.resolve();
    system.events.inc();
    await ticker;
    await drain();

    // Start, the dispatch, then two chained passes (n reaches 3).
    expect(ticks).toHaveLength(4);
    // Each pass after the dispatch lands on a strictly later microtask.
    expect(ticks[2]).toBeGreaterThan(ticks[1] as number);
    expect(ticks[3]).toBeGreaterThan(ticks[2] as number);
    system.destroy();
  });
});
