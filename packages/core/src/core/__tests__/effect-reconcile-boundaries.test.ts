import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import * as core from "../../index.js";
import { createModule, createSystem, t } from "../../index.js";
import type { ObservationEvent } from "../../index.js";
import * as internals from "../../internals.js";
import type { CrossModuleEffectDef } from "../types/module.js";

/**
 * Where effects meet the reconcile loop: writes made while the loop runs, the
 * loop bound that makes carrying them safe, what a history navigation does to
 * requirements, and how a refused write is reported.
 */

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a write made while a pass is running", () => {
  it("wakes the effect for the first write after start()", async () => {
    // The opening pass was still running when this write landed, and its keys
    // were cleared after the effects phase, so the write was lost.
    const log: number[] = [];
    const mod = createModule("m", {
      schema: { facts: { n: t.number() } },
      init: (facts) => {
        facts.n = 0;
      },
      effects: {
        view: {
          deps: ["n"],
          run: (facts) => {
            log.push(facts.n);
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    for (let i = 1; i <= 3; i++) {
      system.facts.n = i;
      await system.settle();
    }

    expect(log).toEqual([0, 1, 2, 3]);

    await system.stop();
  });

  it("cuts an effect that keeps waking itself, warns, and settles", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let runs = 0;
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number() },
        events: { bump: {} },
      },
      init: (facts) => {
        facts.n = 0;
      },
      events: {
        bump: (facts) => {
          facts.n = facts.n + 1;
        },
      },
      effects: {
        echo: {
          deps: ["n"],
          run: (facts) => {
            runs++;
            if (facts.n > 0) {
              system.events.bump();
            }
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    await system.settle();

    system.events.bump();
    await system.settle();

    expect(runs).toBeLessThan(150);
    expect(runs).toBeGreaterThan(50);
    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("kept waking each other"),
      ),
    ).toBe(true);

    // Ordinary work afterwards is untouched.
    const before = runs;
    system.facts.n = -5;
    await system.settle();
    expect(runs).toBe(before + 1);

    await system.stop();
  });
});

function ruleModule(dispatched: number[]) {
  return createModule("m", {
    schema: {
      facts: { n: t.number() },
      requirements: { HIGH: {} },
    },
    init: (facts) => {
      facts.n = 0;
    },
    constraints: {
      high: {
        when: (facts) => facts.n >= 3,
        require: { type: "HIGH" },
      },
    },
    resolvers: {
      high: {
        requirement: "HIGH",
        resolve: async () => {
          dispatched.push(1);
        },
      },
    },
  });
}

async function settled(system: { settle: () => Promise<void> }) {
  await system.settle();
  await tick();
}

describe("requirements after a history navigation", () => {
  it("does not re-dispatch resolvers for the rewound state", async () => {
    const dispatched: number[] = [];
    const system = createSystem({
      module: ruleModule(dispatched),
      history: { maxSnapshots: 50 },
    });
    await system.start();
    system.facts.n = 5;
    await settled(system);
    system.facts.n = 1;
    await settled(system);
    expect(dispatched).toHaveLength(1);

    system.history!.goBack();
    await settled(system);

    expect(system.facts.n).toBe(5);
    expect(dispatched).toHaveLength(1);

    await system.stop();
  });

  it("dispatches when a later write satisfies the constraint again", async () => {
    // The rewind left the pre-rewind requirement as the baseline, so this
    // write looked like no change.
    const dispatched: number[] = [];
    const system = createSystem({
      module: ruleModule(dispatched),
      history: { maxSnapshots: 50 },
    });
    await system.start();
    system.facts.n = 2;
    await settled(system);
    system.facts.n = 3;
    await settled(system);
    expect(dispatched).toHaveLength(1);

    system.history!.goBack();
    await settled(system);
    expect(system.facts.n).toBe(2);

    system.facts.n = 4;
    await settled(system);

    expect(dispatched).toHaveLength(2);

    await system.stop();
  });
});

describe("an effect re-run by a navigation", () => {
  it("warns when it dispatches, naming the effect", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number(), seen: t.number() },
        events: { saw: { v: t.number() } },
      },
      init: (facts) => {
        facts.n = 0;
        facts.seen = 0;
      },
      events: {
        saw: (facts, { v }) => {
          facts.seen = v;
        },
      },
      effects: {
        notify: {
          deps: ["n"],
          run: (facts) => {
            system.events.saw({ v: facts.n });
          },
        },
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();
    for (let i = 1; i <= 3; i++) {
      system.facts.n = i;
      await settled(system);
    }
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("onNavigate"),
    );

    // Back until `n` itself moves (the `seen` write takes a snapshot too).
    while (system.facts.n === 3) {
      system.history!.goBack();
      await settled(system);
    }

    expect(
      warn.mock.calls.some(
        (args) =>
          String(args[0]).includes('effect "notify"') &&
          String(args[0]).includes('onNavigate: "skip"'),
      ),
    ).toBe(true);

    await system.stop();
  });
});

describe("an effect that dispatches while re-run by a navigation", () => {
  it("keeps the redo stack", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number(), seen: t.number() },
        events: { saw: { v: t.number() } },
      },
      init: (facts) => {
        facts.n = 0;
        facts.seen = 0;
      },
      events: {
        saw: (facts, { v }) => {
          facts.seen = v;
        },
      },
      effects: {
        notify: {
          deps: ["n"],
          run: (facts) => {
            system.events.saw({ v: facts.n });
          },
        },
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();
    for (let i = 1; i <= 5; i++) {
      system.facts.n = i;
      await settled(system);
    }
    for (let i = 0; i < 4; i++) {
      system.history!.goBack();
      await settled(system);
    }
    const back = system.facts.n;
    expect(back).toBeLessThan(5);
    for (let i = 0; i < 4; i++) {
      system.history!.goForward();
      await settled(system);
    }

    expect(system.facts.n).toBe(5);

    await system.stop();
  });
});

describe("a refused effect write", () => {
  it("names the effect, shows an example and links the docs", async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args[1]);
    });
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), count: t.number() } },
      init: (facts) => {
        facts.n = 0;
        facts.count = 0;
      },
      effects: {
        sync: {
          deps: ["n"],
          run: (facts) => {
            (facts as { count: number }).count = 1;
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    system.facts.n = 1;
    await system.settle();

    const message = String((errors.at(-1) as Error).message);
    expect(message).toContain('effect "sync" tried to write "count"');
    expect(message).toContain("events: {");
    expect(message).toContain("/docs/effects#effects-never-write-facts");

    await system.stop();
  });

  it("is reported to plugins and observers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const blocked: Array<[string, string]> = [];
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), count: t.number() } },
      init: (facts) => {
        facts.n = 0;
        facts.count = 0;
      },
      effects: {
        sync: {
          deps: ["n"],
          run: (facts) => {
            if (facts.n > 0) {
              (facts as { count: number }).count = 1;
            }
          },
        },
      },
    });
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "watch",
          onEffectWriteBlocked: (id, key) => {
            blocked.push([id, key]);
          },
        },
      ],
    });
    const events: ObservationEvent[] = [];
    system.observe((event) => events.push(event));
    await system.start();
    system.facts.n = 1;
    await system.settle();

    expect(blocked).toEqual([["sync", "count"]]);
    expect(events).toContainEqual({
      type: "effect.write-blocked",
      id: "sync",
      key: "count",
    });

    await system.stop();
  });

  it("refuses a nested mutation in development", async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args[1]);
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = createModule("m", {
      schema: {
        facts: {
          n: t.number(),
          pos: t.object<{ x: number }>(),
          list: t.array<number>(),
        },
      },
      init: (facts) => {
        facts.n = 0;
        facts.pos = { x: 0 };
        facts.list = [];
      },
      effects: {
        moveX: {
          deps: ["n"],
          run: (facts) => {
            if (facts.n > 0) {
              (facts.pos as { x: number }).x = 7;
            }
          },
        },
        append: {
          deps: ["n"],
          run: (facts) => {
            if (facts.n > 0) {
              (facts.list as number[]).push(1);
            }
            // Reads still work, including array methods.
            expect(facts.list.map((v) => v + 1)).toEqual(
              facts.list.map((v) => v + 1),
            );
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    system.facts.n = 1;
    await system.settle();

    expect(system.facts.pos.x).toBe(0);
    expect(system.facts.list).toEqual([]);
    const messages = errors.map((error) => String((error as Error).message));
    expect(messages.some((m) => m.includes('"pos.x"'))).toBe(true);
    expect(messages.some((m) => m.includes('"list.0"'))).toBe(true);

    await system.stop();
  });
});

describe("the legacy effect-writes capability", () => {
  it("is not exported from any entry point", () => {
    expect(Object.keys(internals)).not.toContain("unlockEffectFacts");
    expect(Object.keys(internals)).not.toContain("LEGACY_EFFECT_WRITES");
    expect(Object.keys(core)).not.toContain("LEGACY_EFFECT_WRITES");
  });
});

describe("cross-module effect facts", () => {
  it("are read-only one level into every namespace", () => {
    const own = { facts: { x: t.number() } } as const;
    const auth = { facts: { token: t.string() } } as const;
    type Def = CrossModuleEffectDef<typeof own, { auth: typeof auth }>;
    type Facts = Parameters<Def["run"]>[0];

    const check = (facts: Facts) => {
      // @ts-expect-error effects never write facts
      facts.self.x = 1;
      // @ts-expect-error not in a dependency either
      facts.auth.token = "";
      // @ts-expect-error nor replace a namespace
      facts.self = { x: 1 };

      return facts.self.x + facts.auth.token.length;
    };
    expectTypeOf(check).returns.toEqualTypeOf<number>();
  });
});
