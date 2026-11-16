/**
 * L10b's second and third finishes: 1.35 behaviours the fuzz met at forced
 * L10 once module registration ran. Each test names the code it pins: it fails
 * when that code is removed.
 */
import { describe, expect, it } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

type Any = any;

const started = (
  def: Record<string, unknown>,
  plugin: Record<string, unknown> = {},
) => {
  const system = createSystem({
    module: createModule("m", {
      schema: {
        facts: { n: t.number(), other: t.number() },
        derivations: { d0: t.number(), d1: t.number(), d2: t.number() },
      },
      init: (facts: Any) => {
        facts.n = 1;
        facts.other = 0;
      },
      ...def,
    } as never),
    plugins: [{ name: "spy", ...plugin }],
  } as never) as Any;
  system.start();

  return system;
};

describe("onDefinitionAssign's original for a derivation (dynamic.ts apply, ASSIGNED)", () => {
  it("is the compute 1.35 unwrapped from an object form, and an assigned one as given", () => {
    const originals: unknown[] = [];
    const compute = (facts: Any) => facts.n;
    const system = started(
      {
        derive: {
          d0: { compute, meta: { label: "zero" } },
          d1: () => 0,
          d2: () => 0,
        },
      },
      {
        onDefinitionAssign: (
          _t: string,
          _id: string,
          _d: unknown,
          o: unknown,
        ) => originals.push(o),
      },
    );
    const assigned = { compute: () => 5, meta: { label: "five" } };
    system.derive.assign("d0", assigned);
    system.derive.assign("d0", () => 6);
    expect(originals).toEqual([compute, assigned]);
  });
});

describe("effects.call inside an effect (effects.ts callOne, run's `bare`)", () => {
  it("runs the called effect in its caller's tracking frame, so the caller depends on its reads (1.35)", async () => {
    const runs: string[] = [];
    const box: { system?: Any } = {};
    const system = (box.system = started({
      derive: { d0: () => 0, d1: () => 0, d2: () => 0 },
      effects: {
        inner: {
          run: (facts: Any) => {
            runs.push(`inner ${facts.other}`);
          },
        },
        outer: {
          run: (facts: Any) => {
            void facts.n;
            runs.push("outer");
            box.system?.effects.call("inner");
          },
        },
      },
    }));
    await system.settle();
    runs.length = 0;
    system.facts.n = 2;
    await system.settle();
    runs.length = 0;
    system.facts.other = 3;
    await system.settle();
    // `outer` read `other` through the call, so it runs again (and calls).
    expect(runs).toEqual(["inner 3", "outer", "inner 3"]);
  });
});

describe("the walk at a replaced derivation (core.ts replace_, invalidate's root)", () => {
  it("staled first, then each reader in order with what it feeds, as 1.35's invalidateReplacedDefinition", () => {
    const order: string[] = [];
    const system = started(
      {
        derive: {
          d0: (facts: Any) => facts.n,
          d1: (_f: Any, derived: Any) => derived.d0 + 1,
          d2: (_f: Any, derived: Any) => derived.d0 + 2,
        },
      },
      { onDerivationInvalidate: (id: string) => order.push(id) },
    );
    expect([system.derive.d1, system.derive.d2]).toEqual([2, 3]);
    system.derive.assign("d0", (facts: Any) => facts.n * 10);
    expect(order).toEqual(["d0", "d1", "d2"]);
  });
});

describe("a derivation whose dependencies change (dynamic.ts relink, 1.35's updateDependencies)", () => {
  it("moves to the end of each of its sources' readers, so the next write meets it last", () => {
    const order: string[] = [];
    const system = started(
      {
        derive: {
          d0: (facts: Any) => facts.n,
          d1: (facts: Any, derived: Any) => facts.n + derived.d0,
          d2: (facts: Any, derived: Any) => facts.n + derived.d1,
        },
      },
      { onDerivationInvalidate: (id: string) => order.push(id) },
    );
    expect(system.derive.d2).toBe(3);
    // d1 now reads `n` alone: 1.35 unlinks {n, d0} and links {n} at the end.
    system.derive.assign("d1", (facts: Any) => facts.n * 3);
    expect(system.derive.d2).toBe(4);
    order.length = 0;
    system.facts.n = 2;
    expect(order).toEqual(["d0", "d2", "d1"]);
  });
});

describe("dynamic definitions after destroy() (dynamic.ts isDynamic, listDynamic and flush)", () => {
  it("lists none and knows none, as 1.35's destroy clears its four sets", () => {
    const system = started({
      derive: { d0: () => 0, d1: () => 0, d2: () => 0 },
    });
    system.resolvers.register("zr", { requirement: "DYN", resolve: () => {} });
    system.constraints.register("zk", {
      when: () => false,
      require: { type: "DYN" },
    });
    system.effects.register("ze", { run: () => {} });
    system.derive.register("zd", () => 1);
    system.destroy();
    for (const kind of ["resolvers", "constraints", "effects", "derive"]) {
      expect(system[kind].listDynamic()).toEqual([]);
    }
    expect(system.resolvers.isDynamic("zr")).toBe(false);
    expect(system.constraints.isDynamic("zk")).toBe(false);
    expect(system.effects.isDynamic("ze")).toBe(false);
    expect(system.derive.isDynamic("zd")).toBe(false);
  });

  it("drops a change queued in the pass that destroyed the system, as 1.35's destroy empties its queue", async () => {
    const registered: string[] = [];
    const ref: { system?: Any } = {};
    const system = (ref.system = started(
      {
        derive: { d0: () => 0, d1: () => 0, d2: () => 0 },
        effects: {
          e: {
            run: () => {
              ref.system?.constraints.register("late", {
                when: () => false,
                require: { type: "DYN" },
              });
              ref.system?.destroy();
            },
          },
        },
      },
      { onDefinitionRegister: (_t: string, id: string) => registered.push(id) },
    ));
    system.facts.n = 2;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(registered).toEqual([]);
  });
});
