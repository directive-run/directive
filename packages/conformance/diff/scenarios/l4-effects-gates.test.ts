/** L4: effect `on` gates, deps at startup, order, derived reads, controls. */

import { scenario, suite } from "../scenario.js";

suite("L4 effect gates and startup", () => {
  scenario(
    "deps at startup: an effect runs once on start, then on its deps only",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { a: t.number(), b: t.number() },
          derivations: { sum: t.number() },
          events: {},
        },
        init: (facts: any) => {
          facts.a = 1;
          facts.b = 1;
        },
        derive: { sum: (facts: any) => facts.a + facts.b },
        effects: {
          first: {
            deps: ["a"],
            run: (facts: any) => external(["first", facts.a]),
          },
          second: {
            deps: ["a", "sum"],
            run: (facts: any, prev: any) =>
              external(["second", facts.a, prev?.a ?? null]),
          },
          third: {
            run: (facts: any) => external(["third (tracked)", facts.b]),
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "b", value: 2 },
      { op: "settle" },
      { op: "set", key: "a", value: 3 },
      { op: "settle" },
      {
        op: "batch",
        writes: [
          ["a", 4],
          ["b", 4],
        ],
      },
      { op: "settle" },
    ],
  );

  scenario(
    "an `on` predicate gates an effect; derived values read inside run",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { status: t.string(), n: t.number() },
          derivations: { big: t.boolean(), label: t.string() },
          events: {},
        },
        init: (facts: any) => {
          facts.status = "idle";
          facts.n = 0;
        },
        derive: {
          big: (facts: any) => facts.n > 5,
          label: (facts: any, derived: any) =>
            `${facts.status}:${derived.big ? "big" : "small"}`,
        },
        effects: {
          gated: {
            on: { status: "ready" },
            run: (facts: any, _prev: any) =>
              external(["gated", facts.status, facts.n]),
          },
          readsDerived: {
            deps: ["n", "label"],
            run: (facts: any) => external(["reads", facts.n]),
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "n", value: 6 },
      { op: "settle" },
      { op: "set", key: "status", value: "ready" },
      { op: "settle" },
      { op: "set", key: "n", value: 7 },
      { op: "settle" },
      { op: "set", key: "status", value: "idle" },
      { op: "settle" },
    ],
  );

  scenario(
    "effects disable, enable and run in declaration order",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: { facts: { n: t.number() }, derivations: {}, events: {} },
        init: (facts: any) => {
          facts.n = 0;
        },
        effects: {
          one: { deps: ["n"], run: (f: any) => external(["one", f.n]) },
          two: { deps: ["n"], run: (f: any) => external(["two", f.n]) },
          three: { deps: ["n"], run: (f: any) => external(["three", f.n]) },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "n", value: 1 },
      { op: "settle" },
      {
        op: "run",
        label: "disable two",
        fn: (system, { external }) => {
          system.effects.disable("two");
          external(["two enabled?", system.effects.isEnabled("two")]);
        },
      },
      { op: "set", key: "n", value: 2 },
      { op: "settle" },
      {
        op: "run",
        label: "enable two",
        fn: (system) => system.effects.enable("two"),
      },
      { op: "set", key: "n", value: 3 },
      { op: "settle" },
      { op: "destroy" },
    ],
  );
});
