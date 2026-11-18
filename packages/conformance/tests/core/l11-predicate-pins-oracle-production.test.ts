// Ported from packages/core/src/core/__tests__/l11-predicate-pins-oracle-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const {
  createModule,
  createSystem,
  evaluatePredicate,
  getSchemaFieldKinds,
  memoizePredicate,
  t,
  validatePredicateAgainstSchema,
} = await import("@directive-run/core");

// The production halves of the L11 RFC's probe pins (l11-predicate-pins-
// oracle): U1, U3, U4 and U8 give the same answers with no warning, and U12
// throws a TypeError (1.35's production message carries a minified name, so
// only the type is pinned; the diff's "predicate validation against a
// schema's field kinds" pins development's message).

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

function logged(): string[] {
  return [
    ...vi.mocked(console.warn).mock.calls,
    ...vi.mocked(console.error).mock.calls,
  ].map((args) => args.map(String).join(" "));
}

function probe(
  constraints: Record<string, unknown>,
  effects: Record<string, unknown> = {},
) {
  const state = { hits: 0, errors: [] as string[] };
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
    effects,
    resolvers: {
      go: {
        requirement: "GO",
        resolve: async () => {
          state.hits++;
        },
      },
    },
  } as never);
  const system = createSystem({
    module: mod,
    plugins: [
      {
        name: "recorder",
        onError: (error: any) =>
          state.errors.push(String(error?.message ?? error)),
      },
    ],
  } as never) as any;
  return { system, state };
}

describe("L11 probe pins (production)", () => {
  it("U1: a global regex in a constraint's $matches never fires; called directly it alternates", async () => {
    const { system, state } = probe({
      c: { when: { s: { $matches: /a/g } }, require: { type: "GO" } },
    });
    system.start();
    await flush();
    system.facts.s = "ab";
    await flush();

    expect(state.hits).toBe(0);
    expect(state.errors.length).toBeGreaterThan(0);
    expect(logged()).toEqual([]);
    system.destroy();

    const spec = { s: { $matches: /a/g } };
    expect([1, 2, 3, 4].map(() => evaluatePredicate(spec, { s: "a" }))).toEqual(
      [true, false, true, false],
    );
    const memo = memoizePredicate({ s: { $matches: /a/g } });
    expect([1, 2, 3].map(() => memo({ s: "a" }))).toEqual([true, false, true]);
  });

  it("U3: a data form that names a derivation never matches, silently", async () => {
    const ran: number[] = [];
    const { system, state } = probe(
      { c: { when: { dbl: { $gte: 4 } }, require: { type: "GO" } } },
      {
        byDerived: {
          on: { dbl: { $gte: 4 } },
          run: (facts: any) => {
            ran.push(facts.n);
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
    expect(logged()).toEqual([]);
    system.destroy();
  });

  it("U4: an unknown operator never matches, and production is silent", async () => {
    const { system, state } = probe({
      c: { when: { n: { $gtee: 1 } }, require: { type: "GO" } },
    });
    system.start();
    system.facts.n = 5;
    await flush();

    expect(state.hits).toBe(0);
    expect(logged()).toEqual([]);
    system.destroy();
  });

  it("U8: past depth 64 the cut part reads false and the $nots above it read true, with no warning", () => {
    let deep: object = { n: 1 };
    for (let i = 0; i < 140; i++) {
      deep = { $not: deep };
    }
    expect(evaluatePredicate(deep, { n: 1 })).toBe(true);
    expect(logged()).toEqual([]);
  });

  it("U12: validatePredicateAgainstSchema given a schema instead of the kind map throws a TypeError", () => {
    const facts = { n: t.number(), s: t.string() };
    expect(() =>
      validatePredicateAgainstSchema({ n: { $gte: 1 } }, { facts } as never),
    ).toThrow(TypeError);
    expect(
      validatePredicateAgainstSchema(
        { n: { $gte: 1 } },
        getSchemaFieldKinds({ facts } as never),
      ),
    ).toEqual({ ok: true, operatorCount: 1 });
  });
});
