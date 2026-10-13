import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

/**
 * A history navigation restores facts without reconciling them: the state was
 * reconciled when it was captured. But an effect mirrors state to the outside
 * world, so a view drawn by one stayed on the pre-rewind state. Effects now run
 * again for the restored keys they depend on, and nothing else a replay must
 * not do happens in that pass.
 */

function counterModule(log: string[]) {
  return createModule("m", {
    schema: { facts: { n: t.number() } },
    init: (facts) => {
      facts.n = 0;
    },
    effects: {
      view: {
        deps: ["n"],
        run: (facts) => {
          log.push(`view n=${facts.n}`);
        },
      },
      analytics: {
        deps: ["n"],
        onNavigate: "skip",
        run: (facts) => {
          log.push(`analytics n=${facts.n}`);
        },
      },
    },
  });
}

async function systemAt(log: string[], steps: number) {
  const system = createSystem({
    module: counterModule(log),
    history: { maxSnapshots: 50 },
  });
  await system.start();
  for (let i = 1; i <= steps; i++) {
    system.facts.n = i;
    await system.settle();
  }

  return system;
}

describe("effects after a history navigation", () => {
  it("re-runs an effect whose dependency was restored", async () => {
    const log: string[] = [];
    const system = await systemAt(log, 3);
    log.length = 0;

    system.history!.goBack();
    await system.settle();

    expect(system.facts.n).toBeLessThan(3);
    expect(log).toContain(`view n=${system.facts.n}`);

    await system.stop();
  });

  it("keeps the redo stack intact", async () => {
    const log: string[] = [];
    const system = await systemAt(log, 3);

    system.history!.goBack();
    await system.settle();
    const rewound = system.facts.n;
    system.history!.goForward();
    await system.settle();

    expect(system.facts.n).toBeGreaterThan(rewound);
    expect(log.at(-1)).toBe(`view n=${system.facts.n}`);

    await system.stop();
  });

  it('leaves an onNavigate: "skip" effect alone', async () => {
    const log: string[] = [];
    const system = await systemAt(log, 3);
    log.length = 0;

    system.history!.goBack();
    await system.settle();

    expect(log.some((line) => line.startsWith("analytics"))).toBe(false);
    expect(log.some((line) => line.startsWith("view"))).toBe(true);

    // An ordinary change still wakes it.
    system.facts.n = 10;
    await system.settle();
    expect(log).toContain("analytics n=10");

    await system.stop();
  });

  it("does not re-attach a gated source", async () => {
    const attaches: string[] = [];
    const mod = createModule("m", {
      schema: { facts: { open: t.boolean() } },
      init: (facts) => {
        facts.open = false;
      },
      effects: {
        view: { deps: ["open"], run: () => {} },
      },
      sources: {
        channel: {
          active: (facts) => facts.open === true,
          attach: () => {
            attaches.push("attach");

            return () => {
              attaches.push("detach");
            };
          },
        },
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();

    // `settle()` resolving does not mean the pass has run, and the first write
    // after `start()` has its pass swallowed, so a warm-up write and a
    // macrotask after each one (see navigation-side-effects.test.ts).
    const settled = async () => {
      await system.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    system.facts.open = false;
    await settled();
    system.facts.open = true;
    await settled();
    system.facts.open = false;
    await settled();
    const before = [...attaches];
    expect(before).toEqual(["attach", "detach"]);

    // Rewinding to `open: true` must not open the transport again.
    system.history!.goBack();
    await settled();

    expect(system.facts.open).toBe(true);
    expect(attaches).toEqual(before);

    await system.stop();
  });
});
