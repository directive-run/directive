/** L1: prev views, data-form predicates (when / on / patch), namespaced events. */

import { scenario, suite } from "../scenario.js";

suite("L1 prev views and data forms", () => {
  scenario(
    "an effect sees the previous facts in prev",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number(), label: t.string() },
          derivations: {},
          events: {},
        },
        init: (facts: any) => {
          facts.n = 0;
          facts.label = "a";
        },
        effects: {
          diff: {
            run: (facts: any, prev: any) =>
              external([
                "now",
                facts.n,
                facts.label,
                "prev",
                prev ? [prev.n, prev.label] : null,
              ]),
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "n", value: 1 },
      { op: "settle" },
      {
        op: "batch",
        writes: [
          ["n", 2],
          ["label", "b"],
        ],
      },
      { op: "settle" },
      { op: "set", key: "label", value: "c" },
      { op: "tick" },
      { op: "set", key: "n", value: 9 },
      { op: "settle" },
    ],
  );

  scenario(
    "data-form when, on and comparison operators",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("light", {
        schema: {
          facts: { phase: t.string(), elapsed: t.number(), fixed: t.boolean() },
          derivations: {},
          events: {},
          requirements: { CHANGE: {} },
        },
        init: (facts: any) => {
          facts.phase = "red";
          facts.elapsed = 0;
          facts.fixed = false;
        },
        constraints: {
          change: {
            when: { phase: "red", elapsed: { $gte: 30 } },
            require: { type: "CHANGE" },
          },
        },
        resolvers: {
          change: {
            requirement: "CHANGE",
            resolve: async (_req: unknown, context: any) => {
              context.facts.phase = "green";
              context.facts.elapsed = 0;
            },
          },
        },
        effects: {
          onRed: {
            on: { phase: "red" },
            run: (facts: any) => external(["red", facts.elapsed]),
          },
          onLong: {
            on: { elapsed: { $gt: 10, $lt: 40 } },
            run: (facts: any) => external(["long", facts.elapsed]),
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "elapsed", value: 15 },
      { op: "settle" },
      { op: "set", key: "elapsed", value: 31 },
      { op: "settle" },
      { op: "set", key: "phase", value: "red" },
      { op: "set", key: "elapsed", value: 50 },
      { op: "settle" },
    ],
  );

  scenario(
    "namespaced events, wildcard subscriptions and cross-module reads",
    ({ core: { createModule, t } }) => {
      const counter = (id: string) =>
        createModule(id, {
          schema: {
            facts: { n: t.number() },
            derivations: { odd: t.boolean() },
            events: { inc: { by: t.number() } },
          },
          init: (facts: any) => {
            facts.n = 0;
          },
          derive: { odd: (facts: any) => facts.n % 2 === 1 },
          events: {
            inc: (facts: any, event: any) => {
              facts.n += event.by;
            },
          },
        } as any);

      return { modules: { left: counter("left"), right: counter("right") } };
    },
    [
      { op: "start" },
      {
        op: "run",
        label: "subscribe left.*, dispatch both",
        fn: (system, { external }) => {
          system.subscribe(["left.*"], () =>
            external([
              "left changed",
              system.facts.left.n,
              system.read("left.odd"),
            ]),
          );
          system.events.left.inc({ by: 1 });
          system.events.right.inc({ by: 2 });
          system.dispatch({ type: "left::inc", by: 2 });
        },
      },
      { op: "settle" },
      {
        op: "run",
        label: "subscribeModule right, watch right.n",
        fn: (system, { external }) => {
          system.subscribeModule("right", () =>
            external(["right module", system.facts.right.n]),
          );
          system.watch("right.n", (next: unknown, prev: unknown) =>
            external(["watch right.n", next, prev]),
          );
          system.events.right.inc({ by: 5 });
          system.subscribe(["nope.*"], () => {});
        },
      },
      { op: "settle" },
    ],
  );
});
