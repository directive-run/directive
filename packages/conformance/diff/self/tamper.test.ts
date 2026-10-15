/**
 * The recorder and the comparison catch what they must. Each test injects
 * one fault into the engine under test through a test-only wrapper and
 * proves the scenario fails on it — and that the same scenario passes
 * without the fault, so the failure is the fault's and not the scenario's.
 * (Faults inside the engine's own source are in faults.test.ts.)
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compareContract } from "../compare.js";
import {
  type CoreApi,
  type EngineHandle,
  engineAt,
  engines,
  v2Status,
} from "../engines.js";
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
  /** Run something as the engine loads. */
  onLoad?: () => void;
}

function faulty(fault: Fault) {
  return (engine: EngineHandle): EngineHandle => ({
    ...engine,
    async load() {
      const core = await engine.load();
      fault.onLoad?.();

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
    { op: "destroy" },
  ],
};

/** Wrap the recorder plugin's hook functions. */
function wrapRecorder(
  wrap: (
    key: string,
    fn: (...args: unknown[]) => void,
  ) => (...args: unknown[]) => void,
) {
  return (config: Record<string, unknown>) => ({
    ...config,
    plugins: (config.plugins as Record<string, any>[]).map((p) => {
      if (p.name !== "conformance-recorder") {
        return p;
      }
      const wrapped: Record<string, any> = { name: p.name };
      for (const [key, fn] of Object.entries(p)) {
        if (typeof fn === "function") {
          wrapped[key] = wrap(key, fn);
        }
      }

      return wrapped;
    }),
  });
}

/** Hold the first `hook` call back until after the next hook call. */
function reorder(hook: string) {
  let held: (() => void) | null = null;
  let done = false;

  return wrapRecorder((key, fn) => (...args) => {
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
  });
}

async function expectCaught(fault: Fault, where: RegExp) {
  const result = await runScenario(def, {
    wrapCandidate: faulty(fault),
    divergences: [],
  });

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
    const result = await expectCaught(
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
      /observe "requirement\.created" .*missing on local/,
    );
    expect(result.unexplained).toHaveLength(1);
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
      /facts\.n differs/,
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
      /notify "done" .*extra on local/,
    );
  });

  it("one inserted hook is exactly one difference (no cascade)", async () => {
    let once = false;
    const result = await expectCaught(
      {
        config: wrapRecorder((key, fn) => (...args) => {
          fn(...args);
          if (key === "onRequirementCreated" && !once) {
            once = true;
            fn(...args);
          }
        }),
      },
      /hook "onRequirementCreated" .*extra on local/,
    );
    expect(result.unexplained).toHaveLength(1);
  });

  it("a notification moved from inside the write to after it", async () => {
    // Same stream order, but it now happens after the step's call returned.
    await expectCaught(
      {
        system: (system) => ({
          subscribe: (ids: string[], listener: () => void) =>
            system.subscribe(ids, () => queueMicrotask(listener)),
        }),
      },
      /notify ".*" in step \d+ \(sync\): missing on local/,
    );
  });

  it("a timer left running after destroy", async () => {
    await expectCaught(
      {
        system: (system) => ({
          destroy: () => {
            setInterval(() => {}, 1000);

            return system.destroy();
          },
        }),
      },
      /timers "destroy".*pending differs/,
    );
  });

  it("a warning printed while the engine loads", async () => {
    await expectCaught(
      { onLoad: () => console.warn("[Directive] loaded twice") },
      /console "warn" in step -1 \(setup\): extra on local/,
    );
  });

  it("a subscriber that would read a stale derivation", async () => {
    // The recorder reads the value at notification time.
    await expectCaught(
      {
        system: (system) => ({
          read: (id: string) => (id === "twice" ? -1 : system.read(id)),
        }),
      },
      /notify "twice".*value differs/,
    );
  });
});

describe("contract vs incidental", () => {
  const masked = (edit: (inspection: any) => void) =>
    faulty({
      system: (system) => ({
        inspect: () => {
          const inspection = system.inspect();
          edit(inspection);

          return inspection;
        },
      }),
    });

  it("an inspect() counter's value is advisory, not a failure", async () => {
    const result = await runScenario(def, {
      wrapCandidate: masked((i) => {
        i.pendingInvalidations = 42;
      }),
      divergences: [],
    });

    expect(result.ok).toBe(true);
    expect(result.advisories.join("\n")).toMatch(/pendingInvalidations/);
  });

  it("a removed inspect() counter is a failure (the shape is contract)", async () => {
    const result = await runScenario(def, {
      wrapCandidate: masked((i) => {
        i.pendingInvalidations = undefined;
        for (const c of i.constraints ?? []) {
          // biome-ignore lint/performance/noDelete: the field must be absent, not undefined
          delete c.hitCount;
        }
      }),
      divergences: [],
    });

    expect(result.ok).toBe(false);
    expect(result.report).toMatch(/hitCount|pendingInvalidations/);
  });

  it("console wording is advisory; an extra message is not", () => {
    const contractOf = (text: string) =>
      compareContract(
        [{ k: "console", level: "warn", args: ["one wording"] }],
        [{ k: "console", level: "warn", args: [text] }],
        "local",
      );
    expect(contractOf("another wording")).toEqual([]);
    expect(
      compareContract(
        [{ k: "console", level: "warn", args: ["x"] }],
        [
          { k: "console", level: "warn", args: ["x"] },
          { k: "console", level: "warn", args: ["x"] },
        ],
        "local",
      ),
    ).toHaveLength(1);
  });

  it("an error's DirectiveError fields are compared, not just its message", () => {
    const err = (recoverable: boolean) => {
      const e = new Error("boom") as Error & Record<string, unknown>;
      e.source = "resolver";
      e.recoverable = recoverable;
      e.cause = new Error("root");

      return e;
    };
    const rec = createRecorder();
    rec.external(err(true));
    const other = createRecorder();
    other.external(err(false));
    const diffs = compareContract(rec.trace, other.trace, "local");

    expect(diffs.map((d) => d.path)).toEqual(["data.$error.recoverable"]);
    expect(JSON.stringify(rec.trace)).toMatch(/"cause":\{"\$error"/);
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
    stream: "state",
    kind: "settle",
    path: "facts.n",
    reason: "test-only divergence",
    approvedBy: "test",
    date: "2026-10-14",
    ...overrides,
  });

  it("an entry keyed by content covers the difference and is used", async () => {
    const result = await runScenario(def, {
      wrapCandidate: faulty(fault),
      divergences: [
        approved({}),
        // The same read reaches a subscriber notified of n.
        approved({
          id: "notify-n",
          stream: "notify",
          kind: "n",
          path: "value",
        }),
      ],
    });

    expect(result.differences.length).toBeGreaterThan(0);
    expect(result.report).toBe("");
    expect(result.ok).toBe(true);
    expect(result.used.sort()).toEqual(["notify-n", "test-n"]);
  });

  it("an entry for another scenario, stream or path covers nothing", async () => {
    for (const wrong of [
      { scenario: "some other scenario" },
      { stream: "hook" },
      { path: "facts.go" },
      { engine: "v2" },
    ]) {
      const result = await runScenario(def, {
        wrapCandidate: faulty(fault),
        divergences: [approved(wrong)],
      });

      expect(result.ok).toBe(false);
      expect(result.used).toEqual([]);
    }
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
    const [v1] = engines() as [EngineHandle];
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

describe("engines", () => {
  it("compares v2 only when core-next exists, and says why not", async () => {
    const status = v2Status();
    const names = engines().map((e) => e.name);

    expect(names.slice(0, 2)).toEqual(["v1", "local"]);
    expect(names.includes("v2")).toBe(status.present);
    if (!status.present) {
      expect(status.reason).toMatch(/core-next does not exist/);
    }
  });

  it("an explicit candidate set is compared, each under its own name", async () => {
    const [, local] = engines() as [EngineHandle, EngineHandle];
    const result = await runScenario(def, {
      candidates: [local, engineAt("v2", local.file)],
      divergences: [],
    });

    expect(result.compared).toEqual(["local", "v2"]);
    expect(result.ok).toBe(true);
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
            divergences: [],
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
