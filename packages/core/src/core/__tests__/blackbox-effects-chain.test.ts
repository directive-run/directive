/**
 * Black-box conformance for effects that wake themselves: an effect that
 * dispatches an event through a captured system each time it runs.
 *
 * Public API only. Pins 1.35's two observable behaviours: each follow-up
 * pass runs on its own microtask, and a chain of passes started only by
 * effects is cut after 100 passes with a warning, leaving the system live.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  it("is cut after 100 chained passes, with a warning, and the system stays live", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { module, runs, bind } = selfWaking();
    const system = bind(createSystem({ module }));
    system.start();
    await Promise.resolve();
    system.events.inc();
    await sleep(20);

    // One pass on start, one from the dispatch, then 100 chained passes.
    expect(runs.length).toBe(102);
    expect(system.facts.n).toBe(102);
    expect(system.isSettled).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "[Directive] Effects kept waking each other for 100 passes in a row",
      ),
    );

    runs.length = 0;
    system.facts.n = -100;
    await sleep(5);
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
    await sleep(5);

    expect(ticks).toEqual([0, 2, 3, 4]);
    system.destroy();
  });
});
