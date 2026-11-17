import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createModule,
  createSystem,
  describePredicate,
  evaluatePredicate,
  isPredicate,
  memoizePredicate,
  predicateToMongo,
  predicateToPostgrest,
  predicateToSQL,
  t,
  validatePredicate,
} from "../../index.js";

// The L11 RFC's probe pins (U1 to U5, U7 to U10, U17 to U19), development
// build. Each pins what 1.35 does today, through the public API only. U1, U2
// and U3 are where the approved rows (bp), (bq) and (br) will show: each
// fails on 2.0 once its row is built, and passes again only with the row's
// signed entry. U4 and U17 pin the declined (bs) and (bt). U6, U11 and U16
// are cases in l11-predicate-oracle (the ported predicate.test.ts); U10 and
// U2's diff half are in diff/scenarios/l11-pins; U12's production half is in
// l11-predicate-pins-oracle-production.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await wait();
  }
}

/** Every console.warn and console.error line so far, joined. */
function logged(): string[] {
  return [
    ...vi.mocked(console.warn).mock.calls,
    ...vi.mocked(console.error).mock.calls,
  ].map((args) => args.map(String).join(" "));
}

const count = (needle: string) =>
  logged().filter((line) => line.includes(needle)).length;

interface Evaluation {
  id: string;
  active: boolean;
  whenExplain?: unknown;
}

/**
 * The probes' system: module m with facts n (0), phase ("red") and s ("a"),
 * a derivation dbl (n * 2), a requirement GO whose resolver counts its runs,
 * and (unless `plugin` is false) a plugin that records onError and
 * onConstraintEvaluate.
 */
function probe(
  constraints: Record<string, unknown>,
  options: { plugin?: boolean; effects?: Record<string, unknown> } = {},
) {
  const state = {
    hits: 0,
    errors: [] as string[],
    evaluations: [] as Evaluation[],
  };
  const mod = createModule("m", {
    schema: {
      facts: { n: t.number(), phase: t.string(), s: t.string() },
      derivations: { dbl: t.number() },
      events: {},
      requirements: { GO: {} },
    },
    init: (facts: any) => {
      facts.n = 0;
      facts.phase = "red";
      facts.s = "a";
    },
    derive: { dbl: (facts: any) => facts.n * 2 },
    constraints,
    effects: options.effects ?? {},
    resolvers: {
      go: {
        requirement: "GO",
        resolve: async () => {
          state.hits++;
        },
      },
    },
  } as never);
  const plugins =
    options.plugin === false
      ? []
      : [
          {
            name: "recorder",
            onError: (error: any) =>
              state.errors.push(String(error?.message ?? error)),
            onConstraintEvaluate: (
              id: string,
              active: boolean,
              whenExplain?: unknown,
            ) => state.evaluations.push({ id, active, whenExplain }),
          },
        ];
  const system = createSystem({ module: mod, plugins } as never) as any;
  return { system, state };
}

/** The leaf rows of a whenExplain breakdown, combinators flattened. */
function leaves(rows: unknown): { path: string; pass: boolean }[] {
  const out: { path: string; pass: boolean }[] = [];
  for (const row of (rows ?? []) as any[]) {
    if (Array.isArray(row.children) && row.children.length > 0) {
      out.push(...leaves(row.children));
    } else {
      out.push({ path: row.path, pass: row.pass });
    }
  }
  return out;
}

describe("L11 probe pins (development)", () => {
  it("U1: a global or sticky regex in a constraint's $matches throws on its frozen lastIndex, so the rule never fires (shows (bp))", async () => {
    const { system, state } = probe({
      global: { when: { s: { $matches: /a/g } }, require: { type: "GO" } },
      sticky: { when: { s: { $matches: /a/y } }, require: { type: "GO" } },
    });
    system.start();
    await flush();
    system.facts.s = "ab";
    await flush();
    system.facts.s = "a";
    await flush();

    expect(state.hits).toBe(0);
    expect(state.errors.length).toBeGreaterThan(0);
    expect(state.errors.every((e) => e.includes("lastIndex"))).toBe(true);
    expect(
      state.evaluations.some(
        (e) => (e.id === "global" || e.id === "sticky") && e.active,
      ),
    ).toBe(false);
    system.destroy();
  });

  it("U1: called directly, a global regex alternates: evaluatePredicate and memoizePredicate keep 1.35's answer", () => {
    const spec = { s: { $matches: /a/g } };
    expect([1, 2, 3, 4].map(() => evaluatePredicate(spec, { s: "a" }))).toEqual(
      [true, false, true, false],
    );
    const memo = memoizePredicate({ s: { $matches: /a/g } });
    expect([1, 2, 3].map(() => memo({ s: "a" }))).toEqual([true, false, true]);
  });

  it("U2: a combinator beside a fact key ignores the fact key at run time and in describePredicate; the compilers refuse it; validatePredicate accepts it (shows (bq))", async () => {
    const spec = { $any: [{ n: 1 }], phase: "green" };
    const { system, state } = probe({
      c: { when: spec, require: { type: "GO" } },
    });
    system.start();
    system.facts.n = 1;
    await flush();

    expect(system.facts.phase).toBe("red");
    expect(state.hits).toBeGreaterThan(0);
    expect(evaluatePredicate(spec, { n: 1, phase: "red" })).toBe(true);
    expect(describePredicate(spec)).toBe("n is 1");
    expect(() => validatePredicate(spec)).not.toThrow();
    for (const compile of [
      predicateToSQL,
      predicateToPostgrest,
      predicateToMongo,
    ] as ((p: object, options: object) => unknown)[]) {
      expect(() => compile(spec, { table: "t" })).toThrow(
        /\$any cannot coexist with sibling keys \(phase\)/,
      );
    }
    system.destroy();
  });

  it("U3: a data-form when or on that names a derivation reads undefined and never matches, with no warning (shows (br))", async () => {
    const ran: number[] = [];
    const { system, state } = probe(
      { c: { when: { dbl: { $gte: 4 } }, require: { type: "GO" } } },
      {
        effects: {
          byDerived: {
            on: { dbl: { $gte: 4 } },
            run: (facts: any) => {
              ran.push(facts.n);
            },
          },
        },
      },
    );
    system.start();
    system.facts.n = 2;
    await flush();

    expect(system.derive.dbl).toBe(4);
    expect(state.hits).toBe(0);
    expect(ran).toEqual([]);
    expect(logged().filter((line) => line.includes("dbl"))).toEqual([]);
    system.destroy();
  });

  it("U4: an unknown operator never matches and warns on every evaluation in development; validatePredicate and isPredicate accept it", async () => {
    const spec = { n: { $gtee: 1 } };
    const { system, state } = probe(
      { c: { when: spec, require: { type: "GO" } } },
      { plugin: false },
    );
    const counts: number[] = [];
    system.start();
    await flush();
    counts.push(count('unknown operator "$gtee"'));
    system.facts.n = 5;
    await flush();
    counts.push(count('unknown operator "$gtee"'));
    system.facts.n = 6;
    await flush();
    counts.push(count('unknown operator "$gtee"'));

    expect(state.hits).toBe(0);
    // Two at registration and the first pass, then one per evaluation.
    expect(counts).toEqual([3, 4, 5]);
    expect(() => validatePredicate(spec)).not.toThrow();
    expect(isPredicate(spec)).toBe(true);
    system.destroy();
  });

  it("U5: registration deep-freezes the caller's spec, and inspect()'s whenSpec is that same object", () => {
    const spec = { phase: { $in: ["red", "green"] }, n: { $gte: 0 } };
    const { system } = probe({ c: { when: spec, require: { type: "GO" } } });

    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.phase)).toBe(true);
    expect(Object.isFrozen(spec.phase.$in)).toBe(true);
    expect(Object.isFrozen(spec.n)).toBe(true);
    const row = system
      .inspect()
      .constraints.find((c: { id: string }) => c.id === "c");
    expect(row.whenSpec).toBe(spec);
    system.destroy();
  });

  it("U7: two operators in one object are ANDed, with a development warning per evaluation", () => {
    const spec = { n: { $gte: 1, $lte: 5 } };
    expect(evaluatePredicate(spec, { n: 3 })).toBe(true);
    expect(evaluatePredicate(spec, { n: 9 })).toBe(false);
    expect(count("operator object has 2 operators")).toBe(2);
  });

  it("U8: past depth 64 the cut part reads false, and a $not above it reads true, directly and as a constraint", async () => {
    let deep: object = { n: 1 };
    for (let i = 0; i < 140; i++) {
      deep = { $not: deep };
    }
    expect(evaluatePredicate(deep, { n: 1 })).toBe(true);
    expect(evaluatePredicate({ $not: { $not: { n: 1 } } }, { n: 1 })).toBe(
      true,
    );
    expect(count("predicate depth limit (64) exceeded")).toBeGreaterThan(0);

    const { system, state } = probe({
      c: { when: deep, require: { type: "GO" } },
    });
    system.start();
    await flush();
    expect(state.hits).toBeGreaterThan(0);
    system.destroy();
  });

  it("U9: a data-form when with deps and async still fires, with the two development warnings", async () => {
    const { system, state } = probe({
      c: {
        when: { n: { $eq: 1 } },
        deps: ["phase"],
        async: true,
        require: { type: "GO" },
      },
    });
    system.start();
    system.facts.n = 1;
    await flush();

    expect(state.hits).toBeGreaterThan(0);
    expect(count("data `when` is always sync")).toBeGreaterThan(0);
    expect(count("cannot be combined with explicit `deps`")).toBeGreaterThan(0);
    system.destroy();
  });

  it("U10: $changed in an effect's on fires on the first run, then on a change", async () => {
    const ran: number[] = [];
    const { system } = probe(
      {},
      {
        effects: {
          changed: {
            on: { n: { $changed: true } },
            run: (facts: any) => {
              ran.push(facts.n);
            },
          },
        },
      },
    );
    system.start();
    await flush();
    const atStart = [...ran];
    system.facts.n = 2;
    await flush();

    expect(atStart).toEqual([0]);
    expect(ran).toEqual([0, 2]);
    system.destroy();
  });

  it("U17: with a plugin installed a data form is evaluated a second time per pass, so the unknown-operator warning prints twice; with none, once", async () => {
    const run = async (plugin: boolean, spec: object, needle: string) => {
      vi.mocked(console.warn).mockClear();
      const { system } = probe(
        { c: { when: spec, require: { type: "GO" } } },
        { plugin },
      );
      const counts = [count(needle)];
      system.start();
      await flush();
      counts.push(count(needle));
      system.facts.n = 9;
      await flush();
      counts.push(count(needle));
      system.destroy();
      return counts;
    };
    const unknown = { n: { $gtee: 1 } };
    expect(await run(false, unknown, 'unknown operator "$gtee"')).toEqual([
      2, 3, 4,
    ]);
    expect(await run(true, unknown, 'unknown operator "$gtee"')).toEqual([
      2, 4, 6,
    ]);
    // The two-operator warning is the tracked evaluation's alone: the
    // breakdown's walk does not print it, so it is once per pass either way.
    const two = { n: { $gte: 1, $lte: 5 } };
    expect(await run(false, two, "operator object has 2 operators")).toEqual([
      0, 1, 2,
    ]);
    expect(await run(true, two, "operator object has 2 operators")).toEqual([
      0, 1, 2,
    ]);
  });

  it("U17: the tracked evaluation short-circuits, so only what it read is a dependency; whenExplain visits every clause", async () => {
    const { system, state } = probe({
      c: {
        when: { $all: [{ n: { $gte: 1 } }, { phase: "green" }] },
        require: { type: "GO" },
      },
    });
    const of = () => state.evaluations.filter((e) => e.id === "c");
    system.start();
    await flush();
    expect(leaves(of().at(-1)?.whenExplain)).toEqual([
      { path: "n", pass: false },
      { path: "phase", pass: false },
    ]);

    const before = of().length;
    system.facts.phase = "blue";
    await flush();
    expect(of().length).toBe(before);

    system.facts.n = 2;
    await flush();
    expect(of().length).toBeGreaterThan(before);
    expect(leaves(of().at(-1)?.whenExplain)).toEqual([
      { path: "n", pass: true },
      { path: "phase", pass: false },
    ]);
    system.destroy();
  });

  it("U18: unregister leaves a data-form constraint's whenSpec behind, and a function-form register under the same id reports it", async () => {
    const { system } = probe({});
    system.start();
    await flush();
    const spec = { n: { $gte: 1 } };
    const row = () =>
      system.inspect().constraints.find((c: { id: string }) => c.id === "c") as
        | { whenSpec?: unknown }
        | undefined;

    system.constraints.register("c", { when: spec, require: { type: "GO" } });
    await flush();
    expect(row()?.whenSpec).toBe(spec);

    system.constraints.unregister("c");
    await flush();
    expect(row()).toBeUndefined();

    system.constraints.register("c", {
      when: (facts: any) => facts.n >= 1,
      require: { type: "GO" },
    });
    await flush();
    expect(row()?.whenSpec).toBe(spec);
    system.destroy();
  });

  it("U19: a constraint registered or assigned at run time is normalized as at creation: data over function sets whenSpec, function over data removes it (R1, R2)", async () => {
    const { system, state } = probe({
      f: { when: (facts: any) => facts.n >= 100, require: { type: "GO" } },
    });
    system.start();
    await flush();
    const whenSpec = (id: string) =>
      system.inspect().constraints.find((c: { id: string }) => c.id === id)
        ?.whenSpec;
    expect(whenSpec("f")).toBeUndefined();

    const data = { n: { $gte: 1 } };
    system.constraints.assign("f", { when: data, require: { type: "GO" } });
    await flush();
    expect(whenSpec("f")).toBe(data);
    expect(Object.isFrozen(data.n)).toBe(true);
    system.facts.n = 1;
    await flush();
    expect(state.hits).toBeGreaterThan(0);

    system.constraints.assign("f", {
      when: (facts: any) => facts.n >= 1,
      require: { type: "GO" },
    });
    await flush();
    expect(whenSpec("f")).toBeUndefined();

    const registered = { phase: "red" };
    system.constraints.register("g", {
      when: registered,
      require: { type: "GO" },
    });
    await flush();
    expect(whenSpec("g")).toBe(registered);
    expect(Object.isFrozen(registered)).toBe(true);
    system.destroy();
  });

  it("U19: an effect registered with an on gate runs only while it holds, and stops once unregistered (R4)", async () => {
    const ran: number[] = [];
    const { system } = probe({});
    system.start();
    await flush();
    system.effects.register("gated", {
      on: { n: { $gte: 5 } },
      run: (facts: any) => {
        ran.push(facts.n);
      },
    });
    await flush();
    system.facts.n = 1;
    await flush();
    system.facts.n = 5;
    await flush();
    system.effects.unregister("gated");
    await flush();
    system.facts.n = 6;
    await flush();

    expect(ran).toEqual([5]);
    system.destroy();
  });

  it("U19: a derivation registered with a data-form compute is unwrapped, a predicate to a boolean and a template to a string; assign keeps the object and reading it throws (R5)", async () => {
    const { system } = probe({});
    system.start();
    await flush();
    system.derive.register("big", { compute: { n: { $gte: 3 } } });
    system.derive.register("label", { compute: { $template: "n=${n}" } });
    await flush();
    expect(system.derive.big).toBe(false);
    expect(system.derive.label).toBe("n=0");

    system.facts.n = 4;
    await flush();
    expect(system.derive.big).toBe(true);
    expect(system.derive.label).toBe("n=4");

    // assign does not unwrap an object compute on 1.35: the object is kept
    // as the compute function, and reading the derivation throws.
    let error: unknown;
    try {
      system.derive.assign("big", { compute: { n: { $gte: 10 } } });
      void system.derive.big;
    } catch (caught) {
      error = caught;
    }
    expect(String((error as Error | undefined)?.message)).toMatch(
      /is not a function/,
    );
    try {
      system.destroy();
    } catch {
      // the broken definition may throw again on teardown
    }
  });
});
