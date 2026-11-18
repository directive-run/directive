/**
 * The L11 gate's three parity differences (run 1), each as 1.35 has it.
 *
 * 1. onDefinitionAssign's old definition for a data-form derivation is the
 *    compiled function: 1.35's derivations manager unwraps a data form at
 *    creation and register (derivations.ts:247–288), so its merged map
 *    holds the function (PR seeds 3 and 10).
 * 2. unregisterModule waits for a resolver run that stop() aborted while it
 *    is still going: 1.35's drainResolvers waits on `running`, which keeps a
 *    run until its promise settles, aborted or not (resolvers.ts:2043–2060;
 *    seed 1).
 * 3. resolvers.unregister drops the resolver's key function before the
 *    registry checks the call (engine.ts:2659–2665), so an unregister it
 *    refuses still leaves the requirement keyed by the default id (PR seeds
 *    8 and 14).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

type Any = any;

afterEach(() => {
  vi.restoreAllMocks();
});

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("L11 gate parity", () => {
  it("onDefinitionAssign is handed a data-form derivation's compiled function as the old definition", () => {
    const olds: unknown[] = [];
    const module = createModule("m", {
      schema: {
        facts: { f0: t.number() },
        derivations: { d0: t.boolean() },
        events: {},
      },
      init: (facts: Any) => {
        facts.f0 = 1;
      },
      derive: { d0: { compute: { f0: { $gte: 0 } } } as Any },
    });
    const system = createSystem({
      module,
      plugins: [
        {
          name: "p",
          onDefinitionAssign: (
            _type: string,
            _id: string,
            _def: unknown,
            old: unknown,
          ) => {
            olds.push(old);
          },
        },
      ],
    } as Any) as Any;
    system.start();
    system.derive.register("d1", { compute: { f0: { $lt: 0 } } });
    system.derive.assign("d0", (facts: Any) => facts.f0 > 5);
    system.derive.assign("d1", (facts: Any) => facts.f0 > 5);

    expect(olds.map((old) => typeof old)).toEqual(["function", "function"]);
    expect((olds[0] as Any)({ f0: 1 })).toBe(true);
    expect((olds[1] as Any)({ f0: 1 })).toBe(false);
    system.destroy();
  });

  it("unregisterModule after stop() waits for an aborted run still going", async () => {
    let release: (() => void) | undefined;
    const z = createModule("z", {
      schema: {
        facts: { g0: t.number() },
        derivations: {},
        events: {},
        requirements: { ZW: {} },
      },
      init: (facts: Any) => {
        facts.g0 = 1;
      },
      constraints: {
        zm: { when: (facts: Any) => facts.g0 >= 1, require: { type: "ZW" } },
      },
      resolvers: {
        zmr: {
          requirement: "ZW",
          resolve: () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        },
      },
    } as Any);
    const a = createModule("a", {
      schema: { facts: { f0: t.number() }, derivations: {}, events: {} },
      init: (facts: Any) => {
        facts.f0 = 0;
      },
    });
    const system = createSystem({ modules: { a } } as Any) as Any;
    system.start();
    system.registerModule("z", z);
    await tick();
    expect(release).toBeTypeOf("function");
    system.stop();
    let state = "pending";
    system.unregisterModule("z").then(() => {
      state = "resolved";
    });
    await tick();
    expect(state).toBe("pending");
    release!();
    await tick();
    expect(state).toBe("resolved");
  });

  it("a refused resolver unregister still drops the resolver's key function", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ids: string[] = [];
    const module = createModule("a", {
      schema: {
        facts: { f0: t.number() },
        derivations: {},
        events: {},
        requirements: { A0: {} },
      },
      init: (facts: Any) => {
        facts.f0 = 0;
      },
      constraints: {
        c0: {
          when: (facts: Any) => facts.f0 >= 1,
          require: (facts: Any) => ({ type: "A0", at: facts.f0 }),
        },
      },
      resolvers: {
        r0: {
          requirement: "A0",
          key: (req: Any) => req.type,
          resolve: async () => {},
        },
      },
    } as Any);
    const system = createSystem({
      module,
      plugins: [
        { name: "p", onRequirementCreated: (req: Any) => ids.push(req.id) },
      ],
    } as Any) as Any;
    system.start();
    // A static resolver: refused with a warning, as 1.35.
    system.resolvers.unregister("r0");
    expect(system.resolvers.isDynamic("r0")).toBe(false);
    system.facts.f0 = 5;
    await system.settle();

    expect(ids[0]).toBe('A0:{"at":5}');
    system.destroy();
  });
});
