/**
 * `derived` as the second argument to a constraint's `when()` and `require()`,
 * and the third to an effect's `run()`.
 *
 * The point of the parameter is composition. A module that gates on its own
 * derivations used to have to reach back through `system.derive`, which is the
 * single-module accessor: the identical read resolves a *namespace* once the
 * module is composed with others, the gate goes falsy, and nothing runs with
 * nothing logged. The namespaced tests below are the ones that matter — they
 * fail against the reach-back and pass against the parameter.
 */

import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index";

/** A module whose constraint gates on its own derivation, not on a raw fact. */
function counterModule() {
  return createModule("counter", {
    schema: {
      facts: {
        n: t.number(),
        resets: t.number(),
      },
      derivations: {
        tooHigh: t.boolean(),
      },
      requirements: {
        RESET: {},
      },
    },
    init: (facts) => {
      facts.n = 0;
      facts.resets = 0;
    },
    derive: {
      tooHigh: (facts) => facts.n > 2,
    },
    constraints: {
      reset: {
        when: (_facts, derived) => derived.tooHigh,
        require: { type: "RESET" },
      },
    },
    resolvers: {
      reset: {
        requirement: "RESET",
        resolve: async (_req, context) => {
          context.facts.n = 0;
          context.facts.resets += 1;
        },
      },
    },
  });
}

/** Something to compose against, so the system takes the namespaced shape. */
function bystanderModule() {
  return createModule("bystander", {
    schema: { facts: { idle: t.boolean() } },
    init: (facts) => {
      facts.idle = true;
    },
  });
}

describe("derived in constraints", () => {
  it("gates a constraint on a derivation in a single-module system", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    system.facts.n = 5;
    await system.settle();

    expect(system.facts.n).toBe(0);
    expect(system.facts.resets).toBe(1);

    system.stop();
  });

  it("gates the same constraint once composed with another module", async () => {
    const system = createSystem({
      modules: { counter: counterModule(), bystander: bystanderModule() },
    });
    system.start();

    system.facts.counter.n = 5;
    await system.settle();

    expect(system.facts.counter.n).toBe(0);
    expect(system.facts.counter.resets).toBe(1);

    system.stop();
  });

  it("scopes `derived` to the reading module, not the flat keyspace", async () => {
    const seen: number[] = [];

    const watcher = createModule("watcher", {
      schema: {
        facts: { n: t.number() },
        derivations: { doubled: t.number() },
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: {
        doubled: (facts) => facts.n * 2,
      },
      effects: {
        record: {
          run: (_facts, _prev, derived) => {
            seen.push(derived.doubled);
          },
        },
      },
    });

    const other = createModule("other", {
      schema: {
        facts: { m: t.number() },
        derivations: { doubled: t.number() },
      },
      init: (facts) => {
        facts.m = 100;
      },
      derive: {
        doubled: (facts) => facts.m * 2,
      },
    });

    const system = createSystem({ modules: { watcher, other } });
    system.start();
    await system.settle();

    // `other` also has a `doubled`, computed from a different fact. The
    // watcher's `derived.doubled` is its own, not the other module's 200.
    expect(seen.at(-1)).toBe(2);

    system.stop();
  });

  it("passes `derived` to a function-form require()", async () => {
    const module = createModule("labeler", {
      schema: {
        facts: { n: t.number(), label: t.string() },
        derivations: { band: t.string() },
        requirements: {
          LABEL: { band: t.string() },
        },
      },
      init: (facts) => {
        facts.n = 0;
        facts.label = "";
      },
      derive: {
        band: (facts) => (facts.n > 10 ? "high" : "low"),
      },
      constraints: {
        label: {
          when: (facts) => facts.label === "",
          require: (_facts, derived) => ({
            type: "LABEL" as const,
            band: derived.band,
          }),
        },
      },
      resolvers: {
        label: {
          requirement: "LABEL",
          resolve: async (req, context) => {
            context.facts.label = req.band;
          },
        },
      },
    });

    const system = createSystem({ modules: { labeler: module } });
    system.start();

    system.facts.labeler.n = 50;
    await system.settle();

    expect(system.facts.labeler.label).toBe("high");

    system.stop();
  });
});

describe("derived in effects", () => {
  it("wakes a sync effect when a derivation it read moves", async () => {
    const run = vi.fn();

    const module = createModule("watched", {
      schema: {
        facts: { n: t.number(), unrelated: t.number() },
        derivations: { isEven: t.boolean() },
      },
      init: (facts) => {
        facts.n = 0;
        facts.unrelated = 0;
      },
      derive: {
        isEven: (facts) => facts.n % 2 === 0,
      },
      effects: {
        onParity: {
          // No `deps` — the read through `derived` is what records the
          // dependency, exactly as it does inside a derivation body.
          run: (_facts, _prev, derived) => {
            run(derived.isEven);
          },
        },
      },
    });

    const system = createSystem({ modules: { watched: module } });
    system.start();
    await system.settle();

    expect(run).toHaveBeenLastCalledWith(true);

    system.facts.watched.n = 1;
    await system.settle();

    expect(run).toHaveBeenLastCalledWith(false);

    // A fact the effect never read must not wake it.
    const callsBefore = run.mock.calls.length;
    system.facts.watched.unrelated = 99;
    await system.settle();

    expect(run.mock.calls.length).toBe(callsBefore);

    system.stop();
  });

  it("leaves `prev` in the second position", async () => {
    const observed: Array<{ prev: unknown; derived: unknown }> = [];

    const module = createModule("ordering", {
      schema: {
        facts: { n: t.number() },
        derivations: { doubled: t.number() },
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: {
        doubled: (facts) => facts.n * 2,
      },
      effects: {
        record: {
          run: (_facts, prev, derived) => {
            observed.push({ prev: prev?.n, derived: derived.doubled });
          },
        },
      },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    system.facts.n = 4;
    await system.settle();

    expect(observed.at(-1)).toEqual({ prev: 1, derived: 8 });

    system.stop();
  });
});
