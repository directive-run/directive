/**
 * The fuzz harness's batch drain (diff/scenario.ts `SettleDrain`, the rule
 * in diff/fuzz/model.ts `batchDrain`; Jason, 2026-11-06: "Wait out 1.35's
 * batches (Recommended)"). At a `settle` step 1.35's engines keep their
 * fake clock running until their batches finish, so both engines are
 * compared at the same point; v2 is never drained. Each test proves one
 * edge: 1.35 really does checkpoint with a batch running, the drain makes
 * that case compare equal (on the workspace engine too), a 2.0 whose
 * `settle()` resolves early (1.35's behaviour, the opposite of row (as))
 * still differs, and a drain that does not end fails the case. On v2 only
 * detached batch runs are waited out (Jason, 2026-11-07: "Wait out 2.0's detached batches too (Recommended)"): one that outlives settle() is
 * waited for, and an early settle() on an attached batch still differs.
 * Past its
 * bound on the reference's first run, the case never settles on 1.35: it is
 * discarded, on its own count, at most max(1% of the seed's cases, 3)
 * (Jason, 2026-11-07: "Discard, own count (Recommended)"; the cap, Jason,
 * 2026-11-07: "Cap at 1% of cases, min 3 (Recommended)").
 */

import { describe, expect, it } from "vitest";
import {
  type FuzzRun,
  checkFuzzRuns,
  describeNeverSettles,
} from "../../lib/census.js";
import {
  FUZZ_FLOOR,
  MIN_NEVER_SETTLES,
  maxNeverSettles,
} from "../../lib/fuzz.js";
import { type EngineHandle, engines } from "../engines.js";
import { type FuzzSpec, toScenario } from "../fuzz/model.js";
import {
  DRAIN_ENGINES,
  type FuzzTally,
  type ScenarioResult,
  drains,
  drainsDetached,
  newFuzzTally,
  runScenario,
  tallyCase,
} from "../scenario.js";

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

  it("a 2.0 whose settle() resolves early on an attached batch still differs: v2's attached batches are never waited for", async () => {
    expect(DRAIN_ENGINES.has("v2")).toBe(false);
    expect([drains({ name: "v2" }), drains({ name: "local+control" })]).toEqual(
      [false, true],
    );
    expect([drainsDetached({ name: "v2" }), drainsDetached(local)]).toEqual([
      true,
      false,
    ]);
    const early = settlesEarly(v2);
    expect(early.name).toBe("v2");
    const result = await runScenario(toScenario(spec), {
      candidates: [early],
      divergences: [],
    });
    expect(result.ok).toBe(false);
    expect(result.unexplained.some((d) => d.step === SETTLE_STEP)).toBe(true);
    expect(result.drainedDetached).toBe(0);
  });

  it("v2's detached batch run is waited out at a settle step; without that, 1.35's drained run and v2 differ", async () => {
    // A bound batch (abortOn the handler's write key, f1): its requirement is
    // retracted (f0 back to 0) while the call waits its 5 ms, so v2 detaches
    // the run (RFC-0003) and its settle() resolves at once; 1.35's drain
    // waits the call out. Steps: start, raise, open the window, retract,
    // settle (step 4).
    const detachedSpec: FuzzSpec = {
      ...spec,
      steps: [
        { op: "set", module: 0, fact: 0, value: 5 },
        { op: "advance", ms: 1 },
        { op: "set", module: 0, fact: 0, value: 0 },
      ],
      batch: {
        ...spec.batch!,
        sources: [{ fact: 0, atLeast: 1, items: 1, abortOn: true }],
        writes: 1,
      },
    };
    const def = toScenario(detachedSpec);
    const withRule = await runScenario(def, {
      candidates: [v2],
      divergences: [],
    });
    expect(withRule.report).toBe("");
    expect(withRule.ok).toBe(true);
    expect([withRule.drained, withRule.drainedDetached]).toEqual([1, 1]);

    const { detached: _, ...rule } = def.settleDrain!;
    const without = await runScenario(
      { ...def, settleDrain: rule },
      { candidates: [v2], divergences: [] },
    );
    expect(without.ok).toBe(false);
    expect(without.drainedDetached).toBe(0);
    expect(without.unexplained.some((d) => d.step === 4)).toBe(true);
  });

  it("past its bound on the reference's first run, the case never settles on 1.35: discarded, not compared, and not a runaway", async () => {
    const def = {
      ...toScenario(spec),
      settleDrain: { boundMs: 2, busy: () => "a test batch is live" },
    };
    const result = await runScenario(def, {
      candidates: [v2],
      divergences: [],
    });
    expect(result.neverSettles).toBe(true);
    expect(result.runaway).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.compared).toEqual([]);
    expect(result.report).toMatch(
      /never settles in scenario "fuzz": on the reference \(v1\) the batch drain at step 2 passed its bound: a test batch is live/,
    );
  });

  it("past its bound on the workspace engine only, the drain still fails the case, naming why", async () => {
    // The order runScenario builds systems in: v1, v1 again, then local.
    const seen = new Map<unknown, number>();
    const def = {
      ...toScenario(spec),
      settleDrain: {
        boundMs: 2,
        busy: (_ctx: unknown, system: unknown) => {
          if (!seen.has(system)) {
            seen.set(system, seen.size);
          }

          return (seen.get(system) ?? 0) >= 2 ? "a test batch is live" : false;
        },
      },
    };
    const result = await runScenario(def, {
      candidates: [local],
      divergences: [],
    });
    expect(result.neverSettles).toBeFalsy();
    expect(result.ok).toBe(false);
    expect(result.report).toMatch(
      /local in scenario "fuzz": the batch drain at step 2 passed its bound: a test batch is live/,
    );
  });

  it("the never-settles cap is max(1% of the seed's cases, 3)", () => {
    expect(MIN_NEVER_SETTLES).toBe(3);
    expect(
      [0, 205, 299, 300, 399, 400, 1010, 7000].map(maxNeverSettles),
    ).toEqual([3, 3, 3, 3, 3, 4, 10, 70]);
  });

  it("never-settles cases count on their own: discarded under the cap, and one over it fails the run", async () => {
    const never = await runScenario(
      {
        ...toScenario(spec),
        settleDrain: { boundMs: 2, busy: () => "a test batch is live" },
      },
      { candidates: [v2], divergences: [] },
    );
    const compared = await runScenario(toScenario(spec), {
      candidates: [local, v2],
      divergences: [],
    });
    expect([never.neverSettles, compared.ok]).toEqual([true, true]);

    const runOf = (
      extra: number,
      base = FUZZ_FLOOR,
    ): { tally: FuzzTally; run: FuzzRun } => {
      const tally: FuzzTally = newFuzzTally();
      for (let i = 0; i < base; i++) {
        tallyCase(tally, compared);
      }
      for (let i = 0; i < extra; i++) {
        tallyCase(tally, never as ScenarioResult);
      }

      return {
        tally,
        run: {
          seed: 1,
          runs: tally.ran - tally.runaway - tally.neverSettles,
          runaway: tally.runaway,
          runawayAfterStop: tally.afterStop,
          neverSettles: tally.neverSettles,
          v2: tally.onV2,
        },
      };
    };

    // At the minimum cap (203 cases: 1% is 2, so 3): discarded, never a
    // runaway, nothing fails.
    const within = runOf(3);
    expect(maxNeverSettles(within.tally.ran)).toBe(3);
    expect(within.tally).toMatchObject({
      ran: FUZZ_FLOOR + 3,
      runaway: 0,
      afterStop: 0,
      neverSettles: 3,
      onV2: FUZZ_FLOOR,
    });
    expect(within.run.runs).toBe(FUZZ_FLOOR);
    expect(checkFuzzRuns([within.run], true)).toEqual([]);
    expect(describeNeverSettles([within.run])).toMatch(
      /seed 1: 3 of at most 3$/,
    );

    // One over the cap: the fuzz test's limit and the census fail it, and the
    // runaway limit (max(1% of cases, 2) = 2 here) is not what fires.
    const over = runOf(4);
    expect(over.tally).toMatchObject({ runaway: 0, neverSettles: 4 });
    expect(over.tally.neverSettles).toBeGreaterThan(
      maxNeverSettles(over.tally.ran),
    );
    expect(checkFuzzRuns([over.run], true)).toEqual([
      'conformance:diff: 4 fuzz cases whose reference never settles (seed 1); at most 3 allowed (max(1% of cases, 3); Jason, 2026-11-07: "Cap at 1% of cases, min 3 (Recommended)")',
    ]);

    // A deep seed: 1% of its cases. 1,000 compared and 10 discarded is 1,010
    // cases, a cap of 10: it passes; an 11th (1,011 cases, cap 10) fails.
    const deep = runOf(10, 1000);
    expect(deep.tally.neverSettles).toBe(maxNeverSettles(deep.tally.ran));
    expect(checkFuzzRuns([deep.run], true)).toEqual([]);
    expect(describeNeverSettles([deep.run])).toMatch(
      /seed 1: 10 of at most 10$/,
    );
    const deepOver = runOf(11, 1000);
    expect(checkFuzzRuns([deepOver.run], true)).toEqual([
      'conformance:diff: 11 fuzz cases whose reference never settles (seed 1); at most 10 allowed (max(1% of cases, 3); Jason, 2026-11-07: "Cap at 1% of cases, min 3 (Recommended)")',
    ]);
  });
});
