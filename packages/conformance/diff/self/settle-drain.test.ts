/**
 * The fuzz harness's batch drain (diff/scenario.ts `SettleDrain`, the rule
 * in diff/fuzz/model.ts `batchDrain`; Jason, 2026-11-06: "Wait out 1.35's
 * batches (Recommended)"). At a `settle` step 1.35's engines keep their
 * fake clock running until their batches finish, so both engines are
 * compared at the same point; v2 is never drained. Each test proves one
 * edge: 1.35 really does checkpoint with a batch running, the drain makes
 * that case compare equal (on the workspace engine too), a 2.0 whose
 * `settle()` resolves early (1.35's behaviour, the opposite of row (as))
 * still differs, and a drain that does not end fails the case.
 */

import { describe, expect, it } from "vitest";
import { type EngineHandle, engines } from "../engines.js";
import { type FuzzSpec, toScenario } from "../fuzz/model.js";
import { DRAIN_ENGINES, runScenario } from "../scenario.js";

/**
 * One module; a write raises one batched requirement, whose handler waits
 * 5 ms and writes the source fact back below its threshold. Steps: start,
 * the write, then the case's closing `settle` (step 2).
 */
const spec: FuzzSpec = {
  modules: [
    {
      facts: 3,
      date: false,
      derivations: [],
      events: [],
      constraints: [],
      effects: [],
      source: null,
    },
  ],
  boundary: null,
  history: false,
  trace: false,
  steps: [{ op: "set", module: 0, fact: 0, value: 5 }],
  batch: {
    sources: [{ fact: 0, atLeast: 1, items: 1, abortOn: false }],
    handler: "batch",
    failing: "all",
    windowMs: 0,
    maxSize: null,
    delay: 5,
    fails: 0,
    retry: 0,
    timeout: null,
    writes: 0,
    value: -1,
  },
};
const SETTLE_STEP = 2;

const [, local, v2] = engines() as [EngineHandle, EngineHandle, EngineHandle];

/** v2 with 1.35's `settle()`: it resolves after a microtask, batch or not. */
function settlesEarly(engine: EngineHandle): EngineHandle {
  return {
    ...engine,
    async load() {
      const core = await engine.load();

      return {
        ...core,
        createSystem(config: unknown) {
          const system = (core as any).createSystem(config);

          return new Proxy(system, {
            get(target, key) {
              if (key === "settle") {
                return async () => {
                  await Promise.resolve();
                };
              }
              const value = Reflect.get(target, key, target);

              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      } as typeof core;
    },
  };
}

describe("the fuzz batch drain at a settle step", () => {
  it("without it, 1.35 checkpoints with the batch still running and differs", async () => {
    const def = { ...toScenario(spec), settleDrain: undefined };
    const result = await runScenario(def, {
      candidates: [v2],
      divergences: [],
    });
    expect(result.ok).toBe(false);
    expect(result.unexplained.some((d) => d.step === SETTLE_STEP)).toBe(true);
  });

  it("with it, the same case compares equal, on the workspace engine too", async () => {
    const result = await runScenario(toScenario(spec), {
      candidates: [local, v2],
      divergences: [],
    });
    expect(result.report).toBe("");
    expect(result.ok).toBe(true);
    expect(result.drained).toBe(1);
  });

  it("a 2.0 whose settle() resolves early still differs: v2 is never drained", async () => {
    expect(DRAIN_ENGINES.has("v2")).toBe(false);
    const early = settlesEarly(v2);
    expect(early.name).toBe("v2");
    const result = await runScenario(toScenario(spec), {
      candidates: [early],
      divergences: [],
    });
    expect(result.ok).toBe(false);
    expect(result.unexplained.some((d) => d.step === SETTLE_STEP)).toBe(true);
  });

  it("a drain still busy past its bound fails the case, naming why", async () => {
    const def = {
      ...toScenario(spec),
      settleDrain: { boundMs: 2, busy: () => "a test batch is live" },
    };
    const result = await runScenario(def, {
      candidates: [v2],
      divergences: [],
    });
    expect(result.ok).toBe(false);
    expect(result.report).toMatch(
      /v1 in scenario "fuzz": the batch drain at step 2 passed its bound: a test batch is live/,
    );
  });
});
