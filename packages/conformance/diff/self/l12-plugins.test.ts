/**
 * L12-pre's fuzz additions (the L12 RFC's B1): the plugins and distributable
 * snapshots come from a phase and seed of their own, so the three phases
 * before them draw byte for byte what they drew before; they reach what they
 * claim; and (rule 2) the comparison catches a dropped watch callback and an
 * edited ledger entry. Rule 1 (the performance plugin's durations by
 * contract) is pinned on `performanceByContract`.
 */
import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type CoreApi, type EngineHandle, engines } from "../engines.js";
import {
  type FuzzSpec,
  baseArbitrary,
  clobbers,
  dataFormArbitrary,
  performanceByContract,
  pluginArbitrary,
  specArbitrary,
  specLayer,
  specTriggers,
  toScenario,
  withoutPlugins,
} from "../fuzz/model.js";
import { runScenario } from "../scenario.js";

const digest = (specs: FuzzSpec[]) =>
  createHash("sha256").update(JSON.stringify(specs)).digest("hex").slice(0, 16);

/**
 * The digests of the three earlier phases' arbitraries at the PR seed 24301
 * and the PR run count (205), taken on main at 32d2dd6f (the L11 gate),
 * before the plugin draws: the base phase, the up-to-L11 phase and the data
 * forms.
 */
const BEFORE = {
  base: "cd45b42ca5d48c12",
  upToL11: "71c9b65f190fc7e0",
  dataForms: "a282aa476bd5ad47",
} as const;

describe("the fuzz's plugin stream (L12-pre)", () => {
  it("draws the earlier phases byte for byte as before the plugin draws", () => {
    const sample = (arbitrary: fc.Arbitrary<FuzzSpec>) =>
      fc.sample(arbitrary, { seed: 24301, numRuns: 205 });
    const base = sample(baseArbitrary());
    const upToL11 = sample(specArbitrary({ ceiling: "L11" }));
    const dataForms = sample(dataFormArbitrary());

    expect(digest(base)).toBe(BEFORE.base);
    expect(digest(upToL11)).toBe(BEFORE.upToL11);
    expect(digest(dataForms)).toBe(BEFORE.dataForms);
    for (const s of [...base, ...upToL11, ...dataForms]) {
      expect(s.plugins).toBeUndefined();
    }
  });

  it("puts plugins in every plugin case, each at L12, over the same base case", () => {
    const plugged = fc.sample(pluginArbitrary(), { seed: 24301, numRuns: 300 });
    const base = fc.sample(baseArbitrary(), { seed: 24301, numRuns: 300 });
    for (const [i, s] of plugged.entries()) {
      expect(s.plugins, `case ${i}`).toBeDefined();
      expect(specLayer(s), `case ${i}`).toBe("L12");
      expect(withoutPlugins(s), `case ${i}`).toEqual(base[i]);
    }
  });

  it("reaches every L12 trigger, and draws clobber plugins only where clobbers happen", () => {
    const plugged = fc.sample(pluginArbitrary(), {
      seed: 24301,
      numRuns: 1500,
    });
    const reached = new Set(plugged.flatMap((s) => specTriggers(s)));
    for (const trigger of [
      "distributable",
      "distributableWatch",
      "auditLedger",
      "loggingPlugin",
      "performancePlugin",
      "clobberAlert",
      "clobberLoop",
    ]) {
      expect(reached.has(trigger as never), trigger).toBe(true);
    }
    for (const s of plugged) {
      if (s.plugins?.clobber !== null) {
        expect(clobbers(s)).toBe(true);
      }
      // A ledger case always ends on a ledger record.
      if (s.plugins?.ledger) {
        expect(s.steps.at(-1)?.op).toBe("ledger");
      }
    }
  });

  it("compares the performance plugin's durations by contract and its counts exactly (rule 1)", () => {
    expect(
      performanceByContract({
        resolvers: {
          r: {
            starts: 2,
            totalDurationMs: 3.25,
            avgDurationMs: 1.6,
            lastCompletedAt: 17,
          },
        },
        reconcile: { runs: 4, maxDurationMs: 0 },
        uptime: 12,
      }),
    ).toEqual({
      resolvers: {
        r: {
          starts: 2,
          totalDurationMs: "<time>",
          avgDurationMs: "<time>",
          lastCompletedAt: "<time>",
        },
      },
      reconcile: { runs: 4, maxDurationMs: "<time>" },
      uptime: "<time>",
    });
    // Outside the contract, a duration is compared as it is.
    expect(performanceByContract({ totalDurationMs: -1 })).toEqual({
      totalDurationMs: -1,
    });
    expect(performanceByContract({ avgDurationMs: Number.NaN })).toEqual({
      avgDurationMs: Number.NaN,
    });
  });
});

/** An engine whose core and `/plugins` entry are changed by `over`. */
function tampered(
  engine: EngineHandle,
  over: {
    core?: (core: CoreApi) => Record<string, unknown>;
    plugins?: (plugins: Record<string, any>) => Record<string, unknown>;
  },
): EngineHandle {
  return {
    ...engine,
    async load() {
      const core = await engine.load();

      return {
        ...core,
        ...(over.core?.(core) ?? {}),
      } as unknown as CoreApi;
    },
    async loadPlugins() {
      const plugins = (await engine.loadPlugins()) ?? {};

      return { ...plugins, ...(over.plugins?.(plugins) ?? {}) };
    },
  };
}

describe("the fuzzer catches injected plugin faults (L12-pre, rule 2)", () => {
  const cases = (trigger: string) =>
    pluginArbitrary().filter((s) => specTriggers(s).includes(trigger as never));

  async function caughtOnV1(
    arbitrary: fc.Arbitrary<FuzzSpec>,
    candidate: EngineHandle,
  ): Promise<string> {
    let caught = "";
    await expect(
      fc.assert(
        fc.asyncProperty(arbitrary, async (spec) => {
          const result = await runScenario(toScenario(spec), {
            candidates: [candidate],
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

    return caught;
  }

  it("control: 1.35 against itself, and against the workspace engine, passes on the plugin cases", async () => {
    const [v1, local] = engines() as [EngineHandle, EngineHandle];
    let compared = 0;
    for (const spec of fc.sample(pluginArbitrary(), {
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

  it("drops a watch callback on one engine", async () => {
    const [v1] = engines() as [EngineHandle];
    const caught = await caughtOnV1(
      cases("distributableWatch"),
      tampered(v1, {
        core: (core) => ({
          createSystem: (config: unknown) => {
            const system = (core.createSystem as (c: unknown) => any)(config);
            const watch = system.watchDistributableSnapshot.bind(system);
            system.watchDistributableSnapshot = (
              options: unknown,
              callback: (snapshot: unknown) => void,
            ) => {
              let calls = 0;

              return watch(options, (snapshot: unknown) => {
                calls += 1;
                if (calls !== 1) {
                  callback(snapshot);
                }
              });
            };

            return system;
          },
        }),
      }),
    );

    expect(caught).toMatch(/watch/);
  });

  it("edits a ledger entry on one engine", async () => {
    const [v1] = engines() as [EngineHandle];
    const caught = await caughtOnV1(
      cases("auditLedger"),
      tampered(v1, {
        plugins: (plugins) => ({
          createAuditLedger: (...args: unknown[]) => {
            const ledger = plugins.createAuditLedger(...args);
            const query = ledger.query.bind(ledger);

            return {
              ...ledger,
              plugin: ledger.plugin,
              verify: ledger.verify.bind(ledger),
              query: (q: unknown) => {
                const entries = query(q) as Array<Record<string, unknown>>;

                return entries.map((e, i) =>
                  i === 0 ? { ...e, kind: `${String(e.kind)}!` } : e,
                );
              },
            };
          },
        }),
      }),
    );

    expect(caught).toMatch(/ledger/);
  });
});
