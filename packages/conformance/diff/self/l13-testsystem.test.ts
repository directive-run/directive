/**
 * L13-pre's fuzz addition (the L13 RFC's fuzz section): a single-module case
 * built through `createTestSystem`, its facts history, requirements and event
 * history recorded at every checkpoint, from a phase and seed of its own. The
 * earlier phases draw byte for byte what they drew before; the phase draws
 * what it claims; the view is the same on 1.35 and the workspace engine; and
 * (the harness rule for a new view) the comparison catches a dropped history
 * row.
 */
import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type EngineHandle, engines } from "../engines.js";
import {
  type FuzzSpec,
  baseArbitrary,
  dataFormArbitrary,
  pluginArbitrary,
  specArbitrary,
  specLayer,
  specTriggers,
  testSystemArbitrary,
  toScenario,
  withoutTestSystem,
} from "../fuzz/model.js";
import { runScenario } from "../scenario.js";

const digest = (specs: FuzzSpec[]) =>
  createHash("sha256").update(JSON.stringify(specs)).digest("hex").slice(0, 16);

describe("the fuzz's test-system view (L13-pre)", () => {
  it("leaves the earlier phases' draws as they were (no `via` anywhere)", () => {
    const sample = (arbitrary: fc.Arbitrary<FuzzSpec>) =>
      fc.sample(arbitrary, { seed: 24301, numRuns: 205 });
    for (const arbitrary of [
      baseArbitrary(),
      specArbitrary({ ceiling: "L11" }),
      specArbitrary(),
      dataFormArbitrary(),
      pluginArbitrary(),
    ]) {
      for (const s of sample(arbitrary)) {
        expect(s.via).toBeUndefined();
      }
    }
  });

  it("draws only single-module cases, each at L13, over a base case", () => {
    const cases = fc.sample(testSystemArbitrary(), {
      seed: 24301,
      numRuns: 100,
    });
    for (const [i, s] of cases.entries()) {
      expect(s.via, `case ${i}`).toBe("testSystem");
      expect(s.modules, `case ${i}`).toHaveLength(1);
      expect(specLayer(s), `case ${i}`).toBe("L13");
      expect(specTriggers(s), `case ${i}`).toContain("testSystem");
      // Without the view it is a base case, at or below the base ceiling.
      expect(withoutTestSystem(s).via, `case ${i}`).toBeUndefined();
      expect(
        Number(specLayer(withoutTestSystem(s)).slice(1)),
        `case ${i}`,
      ).toBeLessThanOrEqual(10);
    }
    expect(digest(cases)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("control: 1.35 against the workspace engine passes on the test-system cases", async () => {
    const [v1, local] = engines() as [EngineHandle, EngineHandle];
    let compared = 0;
    for (const spec of fc.sample(testSystemArbitrary(), {
      seed: 0x5eed,
      numRuns: 40,
    })) {
      const result = await runScenario(toScenario(spec), {
        candidates: [v1, local],
        divergences: [],
      });
      if (!result.runaway && !result.neverSettles) {
        compared += 1;
        expect(result.report).toBe("");
      }
    }
    expect(compared).toBeGreaterThan(25);
  });

  it("the view is recorded: the trace carries the facts history at each checkpoint", async () => {
    const [v1] = engines() as [EngineHandle];
    const spec = fc.sample(testSystemArbitrary(), {
      seed: 0x5eed,
      numRuns: 1,
    })[0] as FuzzSpec;
    const { runOn } = await import("../scenario.js");
    const trace = await runOn(v1, toScenario(spec));
    const views = trace.filter(
      (e: any) => e.k === "external" && e.data?.[0] === "view",
    ) as any[];

    expect(views.length).toBeGreaterThan(0);
    expect(views.at(-1)?.data[2]).toMatchObject({
      facts: expect.any(Array),
      requirements: expect.any(Array),
      events: expect.any(Array),
    });
    expect(views.at(-1).data[2].facts.length).toBeGreaterThan(0);
  });

  it("catches a dropped history row on one engine (the harness rule for a new view)", async () => {
    const [v1] = engines() as [EngineHandle];
    const tampered: EngineHandle = {
      ...v1,
      async loadEntries() {
        const entries = await v1.loadEntries();
        const testing = entries["./testing"] as Record<string, any>;

        return {
          ...entries,
          "./testing": {
            ...testing,
            createTestSystem: (options: unknown) => {
              const ts = testing.createTestSystem(options);
              const rows = ts.getFactsHistory.bind(ts);
              ts.getFactsHistory = () =>
                rows().filter((_: unknown, i: number) => i !== 1);

              return ts;
            },
          },
        };
      },
    };
    let caught = "";
    await expect(
      fc.assert(
        fc.asyncProperty(testSystemArbitrary(), async (spec) => {
          const result = await runScenario(toScenario(spec), {
            candidates: [tampered],
            divergences: [],
          });
          if (!result.ok) {
            caught = result.report;
            throw new Error(result.report);
          }
        }),
        { seed: 0x5eed, numRuns: 100 },
      ),
    ).rejects.toThrow(/Property failed/);

    expect(caught).toMatch(/engines differ/);
    expect(caught).toMatch(/view/);
  });
});
