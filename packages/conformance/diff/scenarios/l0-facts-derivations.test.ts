/** L0: facts, derivations, events and batching. */

import { scenario, suite } from "../scenario.js";

suite("L0 facts, derivations and events", () => {
  scenario(
    "derivation chain recomputes once per change",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: { a: t.number(), b: t.number() },
          derivations: {
            sum: t.number(),
            doubled: t.number(),
            big: t.boolean(),
          },
          events: {},
        },
        init: (facts: any) => {
          facts.a = 1;
          facts.b = 2;
        },
        derive: {
          sum: (facts: any) => facts.a + facts.b,
          doubled: (_facts: any, derived: any) => derived.sum * 2,
          big: (_facts: any, derived: any) => derived.doubled > 10,
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "checkpoint", label: "started" },
      { op: "set", key: "a", value: 5 },
      { op: "settle" },
      { op: "set", key: "b", value: 2 },
      { op: "settle" },
      { op: "set", key: "a", value: -100 },
      { op: "settle" },
    ],
  );

  scenario(
    "conditional dependencies move with the branch taken",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: { useA: t.boolean(), a: t.number(), b: t.number() },
          derivations: { pick: t.number() },
          events: {},
        },
        init: (facts: any) => {
          facts.useA = true;
          facts.a = 1;
          facts.b = 2;
        },
        derive: {
          pick: (facts: any) => (facts.useA ? facts.a : facts.b),
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "checkpoint", label: "read" },
      { op: "set", key: "b", value: 20 },
      { op: "settle" },
      { op: "set", key: "useA", value: false },
      { op: "settle" },
      { op: "set", key: "a", value: 10 },
      { op: "settle" },
      { op: "set", key: "b", value: 30 },
      { op: "settle" },
    ],
  );

  scenario(
    "same-tick writes coalesce, writes after a tick do not",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: { facts: { n: t.number() }, derivations: {}, events: {} },
        init: (facts: any) => {
          facts.n = 0;
        },
        effects: {
          mirror: { run: (facts: any) => external(["mirror", facts.n]) },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "n", value: 1 },
      { op: "set", key: "n", value: 2 },
      { op: "set", key: "n", value: 3 },
      { op: "tick" },
      { op: "set", key: "n", value: 4 },
      { op: "settle" },
      {
        op: "batch",
        writes: [
          ["n", 5],
          ["n", 6],
        ],
      },
      { op: "settle" },
    ],
  );

  scenario(
    "writing an equal value changes nothing; NaN and null compare as stored",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number(), maybe: t.string().nullable() },
          derivations: { label: t.string() },
          events: {},
        },
        init: (facts: any) => {
          facts.n = 0;
          facts.maybe = null;
        },
        derive: { label: (facts: any) => `${facts.n}:${facts.maybe}` },
        effects: {
          watch: {
            deps: ["n", "maybe"],
            run: (facts: any) => external(["watch", facts.n, facts.maybe]),
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "n", value: 0 },
      { op: "settle" },
      { op: "set", key: "n", value: Number.NaN },
      { op: "settle" },
      { op: "set", key: "n", value: Number.NaN },
      { op: "settle" },
      { op: "set", key: "maybe", value: null },
      { op: "settle" },
      { op: "set", key: "maybe", value: "x" },
      { op: "settle" },
    ],
  );

  scenario(
    "events mutate facts and payloads arrive intact",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: { items: t.array<string>(), count: t.number() },
          derivations: { total: t.number() },
          events: { add: { item: t.string() }, clear: {} },
        },
        init: (facts: any) => {
          facts.items = [];
          facts.count = 0;
        },
        derive: { total: (facts: any) => facts.items.length + facts.count },
        events: {
          add: (facts: any, event: any) => {
            facts.items = [...facts.items, event.item];
            facts.count += 1;
          },
          clear: (facts: any) => {
            facts.items = [];
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "dispatch", event: { type: "add", item: "a" } },
      { op: "dispatch", event: { type: "add", item: "b" } },
      { op: "settle" },
      { op: "dispatch", event: { type: "clear" } },
      { op: "dispatch", event: { type: "unknown-event" } },
      { op: "settle" },
    ],
  );

  scenario(
    "a throwing derivation reports and recovers",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number() },
          derivations: { inverse: t.number() },
          events: {},
        },
        init: (facts: any) => {
          facts.n = 1;
        },
        derive: {
          inverse: (facts: any) => {
            if (facts.n === 0) {
              throw new Error("division by zero");
            }

            return 1 / facts.n;
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "checkpoint", label: "ok" },
      { op: "set", key: "n", value: 0 },
      { op: "settle" },
      { op: "set", key: "n", value: 4 },
      { op: "settle" },
    ],
  );
});
