/**
 * L0: what readers see while the graph updates — two systems in one engine
 * stay apart, a diamond is read consistently by subscribers and effects
 * (no glitch), derivations compute exactly as often as they must, a fact
 * delete, and the per-system/per-process non-JSON warning.
 */

import { type BuildContext, scenario, suite } from "../scenario.js";

/** a → (b = a+1, c = a*2) → d = b + c; plus an impure probe of each compute. */
function diamond({ core: { createModule, t }, external }: BuildContext) {
  return createModule("m", {
    schema: {
      facts: { a: t.number() },
      derivations: { b: t.number(), c: t.number(), d: t.number() },
      events: {},
    },
    init: (facts: any) => {
      facts.a = 1;
    },
    derive: {
      b: (facts: any) => {
        external(["compute b", facts.a]);

        return facts.a + 1;
      },
      c: (facts: any) => {
        external(["compute c", facts.a]);

        return facts.a * 2;
      },
      d: (_facts: any, derived: any) => {
        external(["compute d"]);

        return derived.b + derived.c;
      },
    },
    effects: {
      sees: {
        run: (facts: any, _prev: any) => external(["effect sees", facts.a]),
      },
    },
  } as any);
}

suite("L0 isolation and glitch-free reads", () => {
  scenario(
    "a subscriber reads derivations inside its notification",
    (ctx) => ({ module: diamond(ctx) }),
    [
      { op: "start" },
      { op: "checkpoint", label: "warm" },
      {
        op: "run",
        label: "subscribe to a, read d and b inside",
        fn: (system, { external }) => {
          system.subscribe(["a"], () =>
            external([
              "subscriber",
              system.facts.a,
              system.read("b"),
              system.read("d"),
            ]),
          );
          system.subscribe(["d"], () =>
            external(["d subscriber", system.read("c"), system.read("d")]),
          );
        },
      },
      { op: "set", key: "a", value: 5 },
      { op: "set", key: "a", value: 6 },
      { op: "settle" },
      {
        op: "batch",
        writes: [
          ["a", 7],
          ["a", 8],
        ],
      },
      { op: "settle" },
    ],
  );

  scenario(
    "a subscriber reads an unobserved derivation inside its notification",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: { a: t.number(), b: t.number() },
          derivations: { double: t.number(), sum: t.number() },
          events: {},
        },
        init: (facts: any) => {
          facts.a = 1;
          facts.b = 1;
        },
        derive: {
          double: (facts: any) => facts.a * 2,
          sum: (facts: any, derived: any) => derived.double + facts.b,
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "checkpoint", label: "warm" },
      {
        op: "run",
        label: "subscribe to the facts, read the derivations inside",
        fn: (system, { external }) => {
          system.subscribe(["a"], () =>
            external([
              "a listener",
              system.facts.a,
              system.read("double"),
              system.read("sum"),
            ]),
          );
          system.subscribe(["b"], () =>
            external(["b listener", system.facts.b, system.read("sum")]),
          );
        },
      },
      { op: "set", key: "a", value: 5 },
      { op: "settle" },
      {
        op: "batch",
        writes: [
          ["a", 6],
          ["b", 2],
        ],
      },
      { op: "settle" },
      {
        op: "run",
        label: "two writes inside one batch call",
        fn: (system) =>
          system.batch(() => {
            system.facts.a = 7;
            system.facts.b = 3;
          }),
      },
      { op: "settle" },
    ],
    { observeDerivations: false },
  );

  scenario(
    "an effect reads a diamond's derivations without a glitch",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { a: t.number() },
          derivations: { b: t.number(), c: t.number(), d: t.number() },
          events: {},
        },
        init: (facts: any) => {
          facts.a = 1;
        },
        derive: {
          b: (facts: any) => facts.a + 1,
          c: (facts: any) => facts.a * 2,
          d: (_facts: any, derived: any) => derived.b + derived.c,
        },
        effects: {
          reads: {
            run: (facts: any, _prev: any) => external(["effect", facts.a]),
          },
        },
      } as any),
      plugins: [
        {
          name: "reader",
          onFactsBatch: () => external(["batch"]),
        },
      ],
    }),
    [
      { op: "start" },
      {
        op: "run",
        label: "watch d",
        fn: (system, { external }) => {
          system.watch("d", (next: unknown, prev: unknown) =>
            external(["watch d", next, prev, system.read("b")]),
          );
        },
      },
      { op: "set", key: "a", value: 2 },
      { op: "settle" },
      { op: "set", key: "a", value: 3 },
      { op: "tick" },
      { op: "set", key: "a", value: 3 },
      { op: "settle" },
    ],
  );

  scenario(
    "derivations compute only as often as they must",
    (ctx) => ({ module: diamond(ctx) }),
    [
      { op: "start" },
      { op: "checkpoint", label: "first read" },
      { op: "checkpoint", label: "second read (cached)" },
      { op: "set", key: "a", value: 2 },
      { op: "checkpoint", label: "after write" },
      { op: "set", key: "a", value: 2 },
      { op: "settle" },
    ],
  );

  scenario(
    "two systems in one engine instance stay isolated",
    (ctx) => ({ module: diamond(ctx) }),
    [
      { op: "start" },
      {
        op: "run",
        label: "a second system of the same module",
        fn: async (system, ctx) => {
          const { core, external } = ctx;
          const other = core.createSystem({
            module: diamond(ctx),
          } as never) as any;
          other.start();
          other.subscribe(["a"], () =>
            external(["other notified", other.facts.a]),
          );
          system.facts.a = 10;
          other.facts.a = 20;
          await other.settle();
          external([
            "both",
            system.facts.a,
            system.read("d"),
            other.facts.a,
            other.read("d"),
          ]);
          other.destroy();
        },
      },
      { op: "settle" },
    ],
  );

  scenario(
    "a fact delete",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { a: t.number(), b: t.number().optional() },
          derivations: { hasB: t.boolean() },
          events: {},
        },
        init: (facts: any) => {
          facts.a = 1;
          facts.b = 2;
        },
        derive: { hasB: (facts: any) => facts.b !== undefined },
        effects: {
          watchB: {
            deps: ["b"],
            run: (facts: any) => external(["b is", facts.b ?? null]),
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      {
        op: "run",
        label: "delete b",
        fn: (system) => {
          // biome-ignore lint/performance/noDelete: the delete operator is what is under test
          delete system.facts.b;
        },
      },
      { op: "settle" },
      { op: "set", key: "b", value: 3 },
      { op: "settle" },
    ],
  );

  scenario(
    "a Date written twice warns once per system",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: { facts: { when: t.date() }, derivations: {}, events: {} },
        init: (facts: any) => {
          facts.when = new Date(0);
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "when", value: new Date(5) },
      { op: "settle" },
      { op: "set", key: "when", value: new Date(9) },
      { op: "settle" },
    ],
  );
});
