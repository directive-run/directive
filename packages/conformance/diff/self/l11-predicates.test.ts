/**
 * The fuzz model's data forms (L11-pre; the L11 RFC's "The fuzz, designed
 * in up front", B1, and harness rules 1 and 2).
 *
 * The reach tests pin what an L11 case draws: a constraint `when`, an
 * effect `on` gate (`$changed` among its operators, and with a snapshot
 * and a restore), a derivation `compute`, an event `patch` and a resolver
 * `key`, each in both modules of a two-module case, and the `tools` step.
 * The placement tests pin that each sits at L11 and that none is drawn
 * below it. Rule 1: a predicate flipped on one engine, and a tool answer
 * changed, must each be caught. Each tamper is applied to 1.35 itself,
 * against 1.35, so the first difference can only be the tamper's. Rule 2
 * (the exit bar, L8's A3) is the fuzz's own; development warnings are
 * compared exactly, as at L8 to L10.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type CoreApi, type EngineHandle, engines } from "../engines.js";
import {
  type FuzzModulePredicates,
  type FuzzSpec,
  WHEN_SHAPES,
  specArbitrary,
  specLayer,
  specTriggers,
  toScenario,
  withoutPredicates,
} from "../fuzz/model.js";
import { runScenario } from "../scenario.js";

const sample = (ceiling?: string, numRuns = 1500): FuzzSpec[] =>
  fc.sample(specArbitrary(ceiling === undefined ? {} : { ceiling }), {
    seed: 4242,
    numRuns,
  });

const layer = (spec: FuzzSpec) => Number(specLayer(spec).slice(1));

/** Every module's draws of one kind, flattened, with the module's index. */
const drawsOf = <K extends keyof FuzzModulePredicates>(
  specs: FuzzSpec[],
  kind: K,
): { module: number; draw: FuzzModulePredicates[K][number] }[] =>
  specs.flatMap((s) =>
    (s.predicates?.modules ?? []).flatMap((m, module) =>
      (m[kind] as FuzzModulePredicates[K][number][])
        .filter((d) => d !== null)
        .map((draw) => ({ module, draw })),
    ),
  );

describe("fuzz predicate reach (L11-pre; the L11 RFC's reach table, B1)", () => {
  const specs = () => sample("L11");

  it("draws every data form in about one case in three, in both modules", () => {
    const all = specs();
    const drawn = all.filter((s) => s.predicates !== undefined);
    expect(drawn.length).toBeGreaterThan(all.length / 5);
    expect(drawn.length).toBeLessThan(all.length / 2);

    const when = drawsOf(drawn, "when");
    expect(new Set(when.map((w) => w.draw))).toEqual(
      new Set(Array.from({ length: WHEN_SHAPES }, (_, i) => i)),
    );
    const on = drawsOf(drawn, "on");
    expect(new Set(on.map((g) => g.draw?.op))).toEqual(
      new Set(["$gte", "$lt", "$eq", "$ne", "$changed"]),
    );
    const compute = drawsOf(drawn, "compute");
    expect(
      new Set(
        compute.map((c) =>
          c.draw?.kind === "predicate" ? c.draw.op : c.draw?.kind,
        ),
      ),
    ).toEqual(new Set(["$gte", "$gt", "$lte", "$in", "template"]));
    const patch = drawsOf(drawn, "patch");
    expect(new Set(patch.map((p) => p.draw?.kind))).toEqual(
      new Set(["ref", "literal", "template"]),
    );
    const key = drawsOf(drawn, "key");
    expect(new Set(key.map((k) => k.draw))).toEqual(new Set(["fn", "list"]));

    // The namespaced forms (D5): every kind in module b too, and a `when`
    // through module b's `self` and `a` pivots.
    for (const list of [when, on, compute, patch, key]) {
      expect(list.some((d) => d.module === 1)).toBe(true);
    }
    expect(
      drawn.some((s) =>
        (s.modules[1]?.constraints ?? []).some(
          (c, j) =>
            c.crossAtLeast !== null &&
            (s.predicates?.modules[1]?.when[j] ?? null) !== null,
        ),
      ),
    ).toBe(true);

    // Never on an effect with explicit deps, never on a `tagBoundary`
    // derivation.
    for (const s of drawn) {
      s.modules.forEach((m, i) => {
        m.effects.forEach((e, j) => {
          if (e.explicitDeps) {
            expect(s.predicates?.modules[i]?.on[j]).toBeNull();
          }
        });
        for (const b of m.boundaries ?? []) {
          expect(s.predicates?.modules[i]?.compute[b]).toBeNull();
        }
      });
    }
  });

  it("draws the tools step, and a `$changed` gate that sees a restore", () => {
    const drawn = specs().filter((s) => s.predicates !== undefined);
    const triggers = drawn.map(specTriggers);
    for (const name of [
      "dataWhen",
      "onGate",
      "changedRestore",
      "dataCompute",
      "eventPatch",
      "resolverKey",
      "predicateTools",
    ] as const) {
      expect(
        triggers.filter((t) => t.includes(name)).length,
        name,
      ).toBeGreaterThan(10);
    }
    // The restore the draw puts in follows its snapshot.
    for (const s of drawn) {
      const inserted = (s.predicates?.inserted ?? []).map(
        (i) => s.steps[i]?.op,
      );
      const snapshot = inserted.indexOf("snapshot");
      if (snapshot >= 0) {
        expect(inserted.slice(snapshot + 1)).toContain("restore");
      }
    }
  });

  it("draws none of it below L11, and every case without it is the one L10-pre drew", () => {
    expect(
      sample("L10", 600).filter(
        (s) =>
          s.predicates !== undefined || s.steps.some((x) => x.op === "tools"),
      ),
    ).toEqual([]);
    for (const s of specs()
      .filter((x) => x.predicates !== undefined)
      .slice(0, 80)) {
      const plain = withoutPredicates(s);
      expect(plain.predicates).toBeUndefined();
      expect(plain.steps.some((x) => x.op === "tools")).toBe(false);
      expect(plain.steps.length).toBe(
        s.steps.length - (s.predicates?.inserted.length ?? 0),
      );
      expect(layer(plain)).toBeLessThanOrEqual(10);
      expect(layer(s)).toBe(11);
    }
  });

  it("places each addition at L11 on its own", () => {
    const base: FuzzSpec = {
      modules: [
        {
          facts: 1,
          date: false,
          derivations: [
            { facts: [0], derived: [], threshold: null, throwsAt: null },
          ],
          events: [{ target: 0, add: true }],
          constraints: [],
          effects: [
            { reads: [0], explicitDeps: false, cleanup: false, throwsAt: null },
          ],
          source: null,
        },
      ],
      boundary: null,
      history: false,
      trace: false,
      steps: [{ op: "settle" }],
    };
    expect(specLayer(base)).toBe("L0");
    const none: FuzzModulePredicates = {
      when: [],
      on: [null],
      compute: [null],
      patch: [null],
      key: [],
    };
    const variants: FuzzModulePredicates[] = [
      { ...none, on: [{ fact: 0, op: "$changed", value: 0 }] },
      { ...none, compute: [{ kind: "template" }] },
      { ...none, patch: [{ kind: "ref" }] },
      none,
    ];
    for (const m of variants) {
      expect(
        specLayer({ ...base, predicates: { modules: [m], inserted: [] } }),
      ).toBe("L11");
    }
    expect(
      specLayer({
        ...base,
        steps: [{ op: "tools" }, { op: "settle" }],
      }),
    ).toBe("L11");
  });
});

describe("the drawn data forms run on 1.35 (L11-pre)", () => {
  it("a data-form when, on, compute, patch and key each take effect, with no error", async () => {
    const [v1] = engines() as [EngineHandle];
    const core = (await v1.load()) as any;
    const spec: FuzzSpec = {
      modules: [
        {
          facts: 2,
          date: false,
          derivations: [
            { facts: [0], derived: [], threshold: null, throwsAt: null },
            { facts: [0, 1], derived: [], threshold: null, throwsAt: null },
            { facts: [1], derived: [0, 1], threshold: null, throwsAt: null },
          ],
          events: [
            { target: 0, add: true },
            { target: 1, add: false },
          ],
          constraints: [
            {
              fact: 0,
              atLeast: 2,
              crossAtLeast: null,
              priority: 0,
              writes: 1,
              value: 4,
              delay: 0,
              fails: 0,
              retry: 0,
              timeout: null,
            },
          ],
          effects: [
            { reads: [0], explicitDeps: false, cleanup: false, throwsAt: null },
          ],
          source: null,
        },
      ],
      boundary: null,
      history: false,
      trace: false,
      steps: [],
      predicates: {
        modules: [
          {
            when: [2],
            on: [{ fact: 0, op: "$gte", value: 2 }],
            compute: [
              { kind: "predicate", op: "$gte", value: 2 },
              { kind: "template" },
              null,
            ],
            patch: [{ kind: "ref" }, { kind: "template" }],
            key: ["list"],
          },
        ],
        inserted: [],
      },
    };
    const records: unknown[] = [];
    const errors: unknown[] = [];
    const config = toScenario(spec).build({
      core,
      plugins: {},
      entries: {},
      handles: {},
      external: (data) => records.push(data),
    });
    const system = core.createSystem({
      ...config,
      plugins: [{ name: "errors", onError: (e: unknown) => errors.push(e) }],
    });
    system.start();
    expect(system.read("d0")).toBe(false);
    expect(system.read("d1")).toBe("0+0");
    system.dispatch({ type: "e0", v: 3 });
    system.dispatch({ type: "e1", v: 7 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await system.settle();
    // The `$ref` patch set f0 to 3 (a handler would have added it); the
    // template patch wrote `tx`; the resolver then wrote f1 = 4.
    expect(system.facts.f0).toBe(3);
    expect(system.facts.tx).toBe("v=7");
    expect(system.read("d0")).toBe(true);
    expect(system.read("d1")).toBe("3+4");
    // d2 adds d0 (true is 1), d1's length and f1.
    expect(system.read("d2")).toBe(1 + 3 + 4);
    expect(records).toContainEqual(["start", "a.r0", 1]);
    expect(records).toContainEqual(["effect", "a.x0", [3]]);
    expect(records).not.toContainEqual(["effect", "a.x0", [0]]);
    expect(errors).toEqual([]);
    system.destroy();
  });
});

/** `def` with each constraint's data-form `when` negated (rule 1). */
function flipWhen(def: Record<string, any>): Record<string, any> {
  const constraints: Record<string, unknown> = {};
  for (const [id, c] of Object.entries(def.constraints ?? {})) {
    const when = (c as { when?: unknown }).when;
    constraints[id] =
      when !== null && typeof when === "object"
        ? { ...(c as object), when: { $not: when } }
        : c;
  }

  return { ...def, constraints };
}

/** An engine whose public API is changed by `over` (rule 1's tampers). */
function tampered(
  engine: EngineHandle,
  over: (core: CoreApi) => Record<string, unknown>,
): EngineHandle {
  return {
    ...engine,
    async load() {
      const core = await engine.load();

      return { ...core, ...over(core) } as unknown as CoreApi;
    },
  };
}

describe("the fuzzer catches injected predicate faults (L11-pre, rule 1)", () => {
  const predicateCases = (trigger: string) =>
    specArbitrary({ ceiling: "L11" }).filter(
      (s) =>
        s.predicates !== undefined &&
        specTriggers(s).includes(trigger as never),
    );

  async function caughtOnV1(
    cases: fc.Arbitrary<FuzzSpec>,
    candidate: EngineHandle,
  ): Promise<string> {
    let caught = "";
    await expect(
      fc.assert(
        fc.asyncProperty(cases, async (spec) => {
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

  it("control: 1.35 against itself, and against the workspace engine, passes on the predicate cases", async () => {
    const [v1, local] = engines() as [EngineHandle, EngineHandle];
    let compared = 0;
    for (const spec of fc.sample(predicateCases("dataWhen"), {
      seed: 0x5eed,
      numRuns: 30,
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
    expect(compared).toBeGreaterThan(20);
  });

  it("flips a data-form `when` on one engine", async () => {
    const [v1] = engines() as [EngineHandle];
    const caught = await caughtOnV1(
      predicateCases("dataWhen"),
      tampered(v1, (core) => ({
        createModule: (id: string, def: Record<string, any>) =>
          (core.createModule as (i: string, d: unknown) => unknown)(
            id,
            flipWhen(def),
          ),
      })),
    );

    expect(caught).toMatch(/constraint|requirement|start/);
  });

  it("changes a tool's answer on one engine", async () => {
    const [v1] = engines() as [EngineHandle];
    const caught = await caughtOnV1(
      predicateCases("predicateTools").filter((s) =>
        specTriggers(s).some((t) => t === "dataWhen" || t === "onGate"),
      ),
      tampered(v1, (core) => ({
        describePredicate: (...args: unknown[]) =>
          `${(core as any).describePredicate(...args)}!`,
      })),
    );

    expect(caught).toMatch(/tools/);
  });
});
