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

function chainWithLateWrite(writeOnRun: number) {
  const seenB: number[] = [];
  const counts = { late: 0, atCut: -1 };
  const mod = createModule("m", {
    schema: {
      facts: { n: t.number(), b: t.number() },
      events: { bump: {} },
    },
    init: (facts) => {
      facts.n = 0;
      facts.b = 0;
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
          if (facts.n > 0) {
            system.events.bump();
          }
        },
      },
      // Not part of the chain: it writes once, while the phase is open, from
      // outside any effect's body, like a caller would.
      late: {
        deps: ["n"],
        run: async () => {
          counts.late++;
          const run = counts.late;
          await Promise.resolve();
          if (run === writeOnRun) {
            system.facts.b = 5;
          }
        },
      },
      watchB: {
        deps: ["b"],
        run: (facts) => {
          seenB.push(facts.b);
        },
      },
    },
  });
  const system = createSystem({ module: mod });

  return { system, seenB, counts };
}

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

describe("cutting a self-waking chain", () => {
  it("keeps a write that is not the chain's own", async () => {
    // Find the run of `late` that lands in the pass the cut happens on.
    const probe = chainWithLateWrite(-1);
    const warn = vi.spyOn(console, "warn").mockImplementation((message) => {
      if (String(message).includes("kept waking each other")) {
        probe.counts.atCut = probe.counts.late;
      }
    });
    await probe.system.start();
    await probe.system.settle();
    probe.system.events.bump();
    await probe.system.settle();
    await probe.system.stop();
    expect(probe.counts.atCut).toBeGreaterThan(50);

    // Write `b` from the last run before the cut, so it is carried into the
    // pass that is cut.
    const { system, seenB, counts } = chainWithLateWrite(probe.counts.atCut);
    warn.mockImplementation((message) => {
      if (String(message).includes("kept waking each other")) {
        counts.atCut = counts.late;
      }
    });
    await system.start();
    await system.settle();
    system.events.bump();
    await system.settle();
    await tick();

    expect(counts.atCut).toBe(probe.counts.atCut);
    expect(system.facts.b).toBe(5);
    expect(seenB).toContain(5);

    await system.stop();
  });
});

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

describe("a rewind followed by a write in the same pass", () => {
  it("dispatches for the write", async () => {
    // The baseline was rebuilt from current facts, which already held the
    // write, so the write looked like no change.
    const dispatched: number[] = [];
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number(), x: t.number() },
        requirements: { ONE: {} },
      },
      init: (facts) => {
        facts.n = 0;
        facts.x = 0;
      },
      constraints: {
        one: {
          when: (facts) => facts.x === 1,
          require: { type: "ONE" },
        },
      },
      resolvers: {
        one: {
          requirement: "ONE",
          resolve: async () => {
            dispatched.push(1);
          },
        },
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();
    system.facts.n = 1;
    await settled(system);
    system.facts.n = 2;
    await settled(system);

    system.history!.goBack();
    system.facts.x = 1;
    await settled(system);

    expect(dispatched).toHaveLength(1);

    await system.stop();
  });
});

describe("history with an effect that dispatches", () => {
  it("records settled states only, so undo lands on one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number(), seen: t.number() },
        events: { mark: { v: t.number() } },
      },
      init: (facts) => {
        facts.n = 0;
        facts.seen = 0;
      },
      events: {
        mark: (facts, { v }) => {
          facts.seen = v;
        },
      },
      effects: {
        mirror: {
          deps: ["n"],
          onNavigate: "skip",
          run: (facts) => {
            system.events.mark({ v: facts.n });
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

    const history = system.history!;
    const states = history.snapshots.map((snapshot) => {
      const facts = snapshot.facts as Record<string, number>;

      return [facts.n, facts.seen];
    });
    for (const [n, seen] of states) {
      expect(seen).toBe(n);
    }

    history.goBack();
    await settled(system);
    expect(system.facts.n).toBe(2);
    expect(system.facts.seen).toBe(2);

    await system.stop();
  });
});

describe("the retry strategy for an effect", () => {
  it("re-runs the failed effect until it succeeds", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let runs = 0;
    const mod = createModule("m", {
      schema: { facts: { n: t.number() } },
      init: (facts) => {
        facts.n = 0;
      },
      effects: {
        flaky: {
          deps: ["n"],
          run: (facts) => {
            if (facts.n === 0) {
              return;
            }
            runs++;
            if (runs < 3) {
              throw new Error("flaky");
            }
          },
        },
      },
    });
    const system = createSystem({
      module: mod,
      errorBoundary: { onEffectError: "retry" },
    });
    await system.start();
    await settled(system);
    system.facts.n = 1;
    await settled(system);

    expect(runs).toBe(3);

    await system.stop();
  });

  it("stops after three retries in a row", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let runs = 0;
    const mod = createModule("m", {
      schema: { facts: { n: t.number() } },
      init: (facts) => {
        facts.n = 0;
      },
      effects: {
        broken: {
          deps: ["n"],
          run: (facts) => {
            if (facts.n === 0) {
              return;
            }
            runs++;
            throw new Error("broken");
          },
        },
      },
    });
    const system = createSystem({
      module: mod,
      errorBoundary: { onEffectError: "retry" },
    });
    await system.start();
    await settled(system);
    system.facts.n = 1;
    await settled(system);

    expect(runs).toBe(4);

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

  it("hands out stored values, so cloning works as it does in production", async () => {
    let cloned: unknown = null;
    let same = false;
    const pos = { x: 1 };
    const mod = createModule("m", {
      schema: { facts: { pos: t.object<{ x: number }>() } },
      init: (facts) => {
        facts.pos = pos;
      },
      effects: {
        save: {
          run: (facts) => {
            cloned = structuredClone(facts.pos);
            same = Object.isFrozen(facts.pos) === Object.isFrozen(pos);
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    await system.settle();

    expect(cloned).toEqual({ x: 1 });
    expect(same).toBe(true);

    await system.stop();
  });

  it("reports a nested mutation in development, naming the path", async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args[1]);
    });
    const blocked: string[] = [];
    const mod = createModule("m", {
      schema: {
        facts: {
          n: t.number(),
          pos: t.object<{ x: number }>(),
          list: t.array<number>(),
          box: t.object<{ y: number }>(),
          frozen: t.object<{ z: number }>(),
        },
        derivations: { pair: t.object<{ a: number }>() },
      },
      init: (facts) => {
        facts.n = 0;
        facts.pos = { x: 0 };
        facts.list = [];
        facts.box = { y: 0 };
        facts.frozen = { z: 0 };
      },
      derive: { pair: (facts) => ({ a: facts.n }) },
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
          },
        },
        previous: {
          deps: ["n"],
          run: (facts, prev) => {
            if (facts.n > 0 && prev) {
              (prev.box as { y: number }).y = 99;
            }
          },
        },
        derivedValue: {
          deps: ["n"],
          run: (facts, _prev, derived) => {
            if (facts.n > 0) {
              (derived.pair as { a: number }).a = 5;
            }
          },
        },
        freezer: {
          deps: ["n"],
          run: (facts) => {
            if (facts.n > 0) {
              Object.freeze(facts.frozen);
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
            blocked.push(`${id}:${key}`);
          },
        },
      ],
    });
    await system.start();
    await system.settle();
    system.facts.n = 1;
    await system.settle();

    expect(blocked).toEqual(
      expect.arrayContaining([
        "moveX:pos.x",
        "append:list.0",
        "previous:prevFacts.box.y",
        "derivedValue:derived.pair.a",
        "freezer:frozen (frozen)",
      ]),
    );
    const messages = errors.map((error) => String((error as Error).message));
    expect(messages.some((m) => m.includes('changed "pos.x" in place'))).toBe(
      true,
    );

    await system.stop();
  });
});

describe("the retired legacy effect-writes key", () => {
  it("grants nothing: an effect carrying it still cannot write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const blocked: string[] = [];
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), out: t.number() } },
      init: (facts) => {
        facts.n = 0;
        facts.out = 0;
      },
      effects: {
        sneaky: {
          [Symbol.for("directive.internal.legacyEffectWrites")]: true,
          deps: ["n"],
          run: (facts: { n: number; out: number }) => {
            facts.out = facts.n;
          },
        } as never,
      },
    });
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "watch",
          onEffectWriteBlocked: (id, key) => {
            blocked.push(`${id}:${key}`);
          },
        },
      ],
    });
    await system.start();
    system.facts.n = 3;
    await system.settle();

    expect(system.facts.out).toBe(0);
    expect(blocked).toContain("sneaky:out");
    expect(Object.keys(internals)).not.toContain("unlockEffectFacts");
    expect(Object.keys(core)).not.toContain("LEGACY_EFFECT_WRITES");
    await system.stop();
  });
});

describe("effect facts types", () => {
  it("are read-only all the way down in every namespace", () => {
    const own = {
      facts: { x: t.number(), pos: t.object<{ p: { q: number } }>() },
    } as const;
    const auth = { facts: { tags: t.array<string>() } } as const;
    type Def = CrossModuleEffectDef<typeof own, { auth: typeof auth }>;
    type Facts = Parameters<Def["run"]>[0];
    type Prev = NonNullable<Parameters<Def["run"]>[1]>;

    const check = (facts: Facts, prev: Prev) => {
      // @ts-expect-error effects never write facts
      facts.self.x = 1;
      // @ts-expect-error nor nested values
      facts.self.pos.p.q = 2;
      // @ts-expect-error nor arrays in a dependency
      facts.auth.tags.push("a");
      // @ts-expect-error nor replace a namespace
      facts.self = { x: 1 };
      // @ts-expect-error prevFacts is read-only too
      prev.self.pos.p.q = 3;

      return facts.self.x + facts.auth.tags.length + prev.self.pos.p.q;
    };
    expectTypeOf(check).returns.toEqualTypeOf<number>();
  });

  it("are read-only all the way down in a single module", () => {
    createModule("m", {
      schema: {
        facts: {
          pos: t.object<{ p: { q: number } }>(),
          list: t.array<number>(),
        },
      },
      init: (facts) => {
        facts.pos = { p: { q: 0 } };
        facts.list = [];
      },
      effects: {
        look: {
          run: (facts, prev) => {
            // @ts-expect-error nested write
            facts.pos.p.q = 1;
            // @ts-expect-error array mutation
            facts.list.push(1);
            if (prev) {
              // @ts-expect-error prevFacts nested write
              prev.pos.p.q = 1;
            }
          },
        },
      },
    });
  });
});
