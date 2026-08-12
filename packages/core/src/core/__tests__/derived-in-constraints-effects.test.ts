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

/**
 * The findings from the review of this feature, pinned.
 *
 * Two kinds live here. Some are behaviours that were broken and are now fixed —
 * the object protocol below. The rest are limits that are *staying*: the
 * tracking carve-outs match what facts already do, and documenting a boundary
 * without a test that holds it there is how the boundary moves.
 */
describe("derived is an object", () => {
  function probeModule() {
    return createModule("probe", {
      schema: {
        facts: { n: t.number() },
        derivations: { doubled: t.number(), tripled: t.number() },
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: {
        doubled: (facts) => facts.n * 2,
        tripled: (facts) => facts.n * 3,
      },
    });
  }

  it("answers `in`, Object.keys, spread, and JSON.stringify", async () => {
    let probe: unknown;

    const module = createModule("probe", {
      schema: {
        facts: { n: t.number() },
        derivations: { doubled: t.number(), tripled: t.number() },
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: {
        doubled: (facts) => facts.n * 2,
        tripled: (facts) => facts.n * 3,
      },
      effects: {
        record: {
          run: (_facts, _prev, derived) => {
            probe = {
              has: "doubled" in derived,
              missing: "nope" in derived,
              keys: Object.keys(derived).sort(),
              spread: { ...derived },
              json: JSON.parse(JSON.stringify(derived)),
            };
          },
        },
      },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    expect(probe).toEqual({
      has: true,
      missing: false,
      keys: ["doubled", "tripled"],
      spread: { doubled: 2, tripled: 3 },
      json: { doubled: 2, tripled: 3 },
    });

    system.stop();
  });

  it("answers the same way once the module is composed", async () => {
    let keys: string[] = [];

    const watcher = createModule("watcher", {
      schema: {
        facts: { n: t.number() },
        derivations: { own: t.number() },
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: { own: (facts) => facts.n },
      effects: {
        record: {
          run: (_facts, _prev, derived) => {
            keys = Object.keys(derived);
          },
        },
      },
    });

    const system = createSystem({
      modules: { watcher, other: probeModule() },
    });
    system.start();
    await system.settle();

    // Its own key, bare — not `watcher::own`, and not the other module's.
    expect(keys).toEqual(["own"]);

    system.stop();
  });

  it("keeps the prototype guards through enumeration", async () => {
    let probe: unknown;

    const module = createModule("guarded", {
      schema: { facts: { n: t.number() }, derivations: { v: t.number() } },
      init: (facts) => {
        facts.n = 1;
      },
      derive: { v: (facts) => facts.n },
      effects: {
        record: {
          run: (_facts, _prev, derived) => {
            probe = {
              proto: Object.getPrototypeOf(derived),
              polluted: "__proto__" in derived,
              ctor: "constructor" in derived,
            };
          },
        },
      },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    expect(probe).toEqual({ proto: null, polluted: false, ctor: false });

    system.stop();
  });
});

describe("when a derived read is tracked, and when it is not", () => {
  it("does not wake a body that declared deps without naming the derivation", async () => {
    const seen: boolean[] = [];

    const module = createModule("declared", {
      schema: {
        facts: { n: t.number(), unrelated: t.number() },
        derivations: { big: t.boolean() },
        requirements: { NOOP: {} },
      },
      init: (facts) => {
        facts.n = 0;
        facts.unrelated = 0;
      },
      derive: { big: (facts) => facts.n > 2 },
      constraints: {
        gate: {
          // `deps` is the whole dependency set. `big` is read but not named,
          // so moving it does not bring the constraint back. Same rule as facts.
          deps: ["unrelated"],
          when: (_facts, derived) => {
            seen.push(derived.big);

            return false;
          },
          require: { type: "NOOP" },
        },
      },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    const before = seen.length;
    system.facts.n = 50;
    await system.settle();

    expect(seen.length).toBe(before);

    system.stop();
  });

  it("wakes that same body once the derivation is named in deps", async () => {
    const seen: boolean[] = [];

    const module = createModule("named", {
      schema: {
        facts: { n: t.number() },
        derivations: { big: t.boolean() },
        requirements: { NOOP: {} },
      },
      init: (facts) => {
        facts.n = 0;
      },
      derive: { big: (facts) => facts.n > 2 },
      constraints: {
        gate: {
          deps: ["big"],
          when: (_facts, derived) => {
            seen.push(derived.big);

            return false;
          },
          require: { type: "NOOP" },
        },
      },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    const before = seen.length;
    system.facts.n = 50;
    await system.settle();

    expect(seen.length).toBeGreaterThan(before);
    expect(seen.at(-1)).toBe(true);

    system.stop();
  });
});

describe("dynamic registration receives derived", () => {
  it("hands it to a constraint registered after start", async () => {
    const module = createModule("dyn", {
      schema: {
        facts: { n: t.number(), hits: t.number() },
        derivations: { big: t.boolean() },
        requirements: { BUMP: {} },
      },
      init: (facts) => {
        facts.n = 0;
        facts.hits = 0;
      },
      derive: { big: (facts) => facts.n > 2 },
      resolvers: {
        bump: {
          requirement: "BUMP",
          resolve: async (_req, context) => {
            context.facts.hits += 1;
            context.facts.n = 0;
          },
        },
      },
    });

    const system = createSystem({ module });
    system.start();

    system.constraints.register("late", {
      when: (_facts, derived) => derived.big,
      require: { type: "BUMP" },
    });

    system.facts.n = 10;
    await system.settle();

    expect(system.facts.hits).toBe(1);

    system.stop();
  });
});
