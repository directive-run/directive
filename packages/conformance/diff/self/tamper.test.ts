/**
 * The recorder catches what it must. Each test injects one fault into the
 * engine under test through a test-only wrapper and proves the scenario
 * fails on it — and that the same scenario passes without the fault, so the
 * failure is the fault's and not the scenario's.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type CoreApi, type EngineHandle, engines } from "../engines.js";
import { specArbitrary, toScenario } from "../fuzz/model.js";
import { createRecorder } from "../record.js";
import {
  type BuildContext,
  type Divergence,
  type ScenarioDef,
  runOn,
  runScenario,
} from "../scenario.js";

type Sys = any;

interface Fault {
  /** Change the createSystem config (e.g. wrap the recorder plugin). */
  config?: (config: Record<string, unknown>) => Record<string, unknown>;
  /** Override members of the created system. */
  system?: (system: Sys) => Record<string, unknown>;
}

function faulty(fault: Fault) {
  return (engine: EngineHandle): EngineHandle => ({
    ...engine,
    async load() {
      const core = await engine.load();

      return {
        ...core,
        createSystem: (config: Record<string, unknown>) => {
          const system = (core.createSystem as (c: unknown) => Sys)(
            fault.config ? fault.config(config) : config,
          );
          const over = fault.system ? fault.system(system) : {};

          return new Proxy(system, {
            get: (target, prop) =>
              prop in over ? over[prop as string] : Reflect.get(target, prop),
          });
        },
      } as unknown as CoreApi;
    },
  });
}

/** A system that exercises hooks, observe, notifications and checkpoints. */
const def: ScenarioDef = {
  name: "tamper target",
  build: ({ core: { createModule, t }, external }: BuildContext) => ({
    module: createModule("m", {
      schema: {
        facts: { go: t.boolean(), done: t.boolean(), n: t.number() },
        derivations: { twice: t.number() },
        events: {},
        requirements: { LOAD: {} },
      },
      init: (facts: any) => {
        facts.go = false;
        facts.done = false;
        facts.n = 1;
      },
      derive: { twice: (facts: any) => facts.n * 2 },
      constraints: {
        load: {
          when: (facts: any) => facts.go && !facts.done,
          require: { type: "LOAD" },
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (_req: unknown, context: any) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            context.facts.done = true;
            context.facts.n = 2;
          },
        },
      },
      effects: {
        view: { run: (facts: any) => external(["view", facts.n]) },
      },
    } as any),
  }),
  steps: [
    { op: "start" },
    { op: "set", key: "go", value: true },
    { op: "settle" },
  ],
};

/** Hold the first `hook` call back until after the next hook call. */
function reorder(hook: string) {
  return (config: Record<string, unknown>) => {
    const plugins = (config.plugins as Record<string, any>[]).map((p) => {
      if (p.name !== "conformance-recorder") {
        return p;
      }
      let held: (() => void) | null = null;
      let done = false;
      const wrapped: Record<string, any> = { name: p.name };
      for (const [key, fn] of Object.entries(p)) {
        if (typeof fn !== "function") {
          continue;
        }
        wrapped[key] = (...args: unknown[]) => {
          if (key === hook && !done) {
            done = true;
            held = () => fn(...args);

            return;
          }
          fn(...args);
          if (held) {
            const release = held;
            held = null;
            release();
          }
        };
      }

      return wrapped;
    });

    return { ...config, plugins };
  };
}

async function expectCaught(fault: Fault, where: RegExp) {
  const result = await runScenario(def, { wrapCandidate: faulty(fault) });

  expect(result.ok).toBe(false);
  expect(result.nondeterministic).toEqual([]);
  expect(result.unexplained.length).toBeGreaterThan(0);
  expect(result.report).toMatch(/engines differ/);
  expect(result.report).toMatch(where);

  return result;
}

describe("the recorder catches injected faults", () => {
  it("control: the unfaulted scenario passes", async () => {
    const result = await runScenario(def);

    expect(result.report).toBe("");
    expect(result.ok).toBe(true);
  });

  it("(i) a reordered hook", async () => {
    await expectCaught(
      { config: reorder("onRequirementCreated") },
      /onRequirementCreated/,
    );
  });

  it("(ii) a missing observe event", async () => {
    await expectCaught(
      {
        system: (system) => ({
          observe: (fn: (e: any) => void) => {
            let dropped = false;

            return system.observe((event: any) => {
              if (event.type === "requirement.created" && !dropped) {
                dropped = true;

                return;
              }
              fn(event);
            });
          },
        }),
      },
      /requirement\.created/,
    );
  });

  it("(iii) a changed fact value at a settle", async () => {
    await expectCaught(
      {
        system: (system) => ({
          getSnapshot: () => {
            const snapshot = system.getSnapshot();

            return { ...snapshot, facts: { ...snapshot.facts, n: 99 } };
          },
        }),
      },
      /facts\.n/,
    );
  });

  it("(iv) an extra store notification", async () => {
    await expectCaught(
      {
        system: (system) => ({
          subscribe: (ids: string[], listener: () => void) => {
            let extra = ids[0] === "done";

            return system.subscribe(ids, () => {
              listener();
              if (extra) {
                extra = false;
                listener();
              }
            });
          },
        }),
      },
      /"notify"/,
    );
  });
});

describe("divergences", () => {
  const fault: Fault = {
    system: (system) => ({
      getSnapshot: () => {
        const snapshot = system.getSnapshot();

        return { ...snapshot, facts: { ...snapshot.facts, n: 99 } };
      },
    }),
  };
  const approved = (overrides: Partial<Divergence>): Divergence => ({
    id: "test-n",
    scenario: def.name,
    path: "",
    reason: "test-only divergence",
    approvedBy: "test",
    date: "2026-10-14",
    ...overrides,
  });

  it("an entry covering every difference makes the scenario pass and is used", async () => {
    const first = await runScenario(def, {
      wrapCandidate: faulty(fault),
      divergences: [],
    });
    const paths = [...new Set(first.differences.map((d) => d.path))];
    const result = await runScenario(def, {
      wrapCandidate: faulty(fault),
      divergences: paths.map((path, i) => approved({ id: `d${i}`, path })),
    });

    expect(paths.length).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
    expect(result.used.sort()).toEqual(paths.map((_, i) => `d${i}`).sort());
  });

  it("an entry for another scenario covers nothing", async () => {
    const first = await runScenario(def, {
      wrapCandidate: faulty(fault),
      divergences: [],
    });
    const result = await runScenario(def, {
      wrapCandidate: faulty(fault),
      divergences: first.differences.map((d, i) =>
        approved({
          id: `d${i}`,
          path: d.path,
          scenario: "some other scenario",
        }),
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.used).toEqual([]);
  });

  it("a path prefix covers only paths under it", async () => {
    const result = await runScenario(def, {
      wrapCandidate: faulty(fault),
      divergences: [approved({ path: "trace[0]" })],
    });

    expect(result.ok).toBe(false);
  });
});

describe("determinism", () => {
  it("state that leaks between runs is reported as nondeterminism", async () => {
    let calls = 0;
    const leaky: ScenarioDef = {
      ...def,
      name: "leaky",
      build: (ctx) => {
        calls += 1;
        ctx.external(["call", calls]);

        return def.build(ctx);
      },
    };
    const result = await runScenario(leaky);

    expect(result.ok).toBe(false);
    expect(result.nondeterministic.length).toBeGreaterThan(0);
    expect(result.report).toMatch(/not deterministic/);
  });

  it("1.35 keeps dev-warning state per process: a reused instance differs", async () => {
    // Why every run loads a fresh engine (diff/engines.ts): run twice on one
    // instance, the second run of a Date-fact system loses its warning.
    const [v1] = engines();
    const core = await v1.load();
    const shared: EngineHandle = { ...v1, load: async () => core };
    const dated: ScenarioDef = {
      name: "dated",
      build: ({ core: { createModule, t } }) => ({
        module: createModule("m", {
          schema: { facts: { when: t.date() }, derivations: {}, events: {} },
          init: (facts: any) => {
            facts.when = new Date(0);
          },
        } as any),
      }),
      steps: [{ op: "start" }, { op: "settle" }],
    };
    const warnings = (trace: Awaited<ReturnType<typeof runOn>>) =>
      trace.filter((e) => e.k === "console").length;
    const first = await runOn(shared, dated);
    const second = await runOn(shared, dated);
    const fresh = await runOn(v1, dated);

    expect(warnings(first)).toBeGreaterThan(0);
    expect(warnings(second)).toBe(0);
    expect(warnings(fresh)).toBe(warnings(first));
  });
});

describe("the fuzzer catches injected faults", () => {
  it("drops one requirement.created observe event", async () => {
    const fault = faulty({
      system: (system) => ({
        observe: (fn: (e: any) => void) =>
          system.observe((event: any) => {
            if (event.type !== "requirement.created") {
              fn(event);
            }
          }),
      }),
    });

    let caught = "";
    await expect(
      fc.assert(
        fc.asyncProperty(specArbitrary(), async (spec) => {
          const result = await runScenario(toScenario(spec), {
            wrapCandidate: fault,
          });
          if (!result.ok) {
            caught = result.report;
            throw new Error(result.report);
          }
        }),
        { seed: 0x5eed, numRuns: 200 },
      ),
    ).rejects.toThrow(/Property failed/);
    expect(caught).toMatch(/engines differ/);
    expect(caught).toMatch(/requirement\.created/);
  });
});

describe("recorder", () => {
  it("records nothing until attached, and checkpoints need a system", () => {
    const rec = createRecorder();

    expect(rec.trace).toEqual([]);
    expect(() => rec.checkpoint("x")).toThrow(/record\(system\)/);
  });
});
