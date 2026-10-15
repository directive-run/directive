/** L6: snapshot and restore. */

import { scenario, suite } from "../scenario.js";

suite("L6 snapshots", () => {
  scenario(
    "snapshot and restore round-trip, with reconcile after restore",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number(), when: t.date(), tags: t.array<string>() },
          derivations: { label: t.string() },
          events: {},
          requirements: { FIX: {} },
        },
        init: (facts: any) => {
          facts.n = 1;
          facts.when = new Date(0);
          facts.tags = ["a"];
        },
        derive: { label: (facts: any) => `${facts.n}/${facts.tags.length}` },
        constraints: {
          negative: {
            when: (facts: any) => facts.n < 0,
            require: { type: "FIX" },
          },
        },
        resolvers: {
          fix: {
            requirement: "FIX",
            resolve: async (_req: unknown, context: any) => {
              context.facts.n = 0;
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "n", value: -5 },
      { op: "snapshot", label: "negative" },
      { op: "settle" },
      { op: "set", key: "tags", value: ["a", "b", "c"] },
      { op: "settle" },
      { op: "restore", label: "negative" },
      { op: "settle" },
    ],
  );
});
