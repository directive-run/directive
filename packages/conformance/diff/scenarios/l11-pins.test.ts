/**
 * L11-pre's diff pins from the L11 RFC's untested list: U2 (a combinator
 * beside a fact key, at run time and through the tools; shows (bq)) and U10
 * (`$changed` in an effect's `on` fires on the first run). U12's
 * development half is "predicate validation against a schema's field kinds"
 * in l11-predicates.
 */

import { scenario, suite } from "../scenario.js";

const MIXED = { $any: [{ n: 1 }], phase: "green" };

suite("L11 pins", () => {
  scenario(
    "a combinator beside a fact key: the fact key is ignored at run time, and the compilers refuse it (U2)",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number(), phase: t.string() },
          derivations: {},
          events: {},
          requirements: { GO: {} },
        },
        init: (facts: any) => {
          facts.n = 0;
          facts.phase = "red";
        },
        constraints: {
          mixed: { when: MIXED, require: { type: "GO" } },
        },
        resolvers: {
          go: {
            requirement: "GO",
            resolve: async (_req: unknown, context: any) => {
              context.facts.n = 2;
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "settle" },
      { op: "set", key: "n", value: 1 },
      { op: "settle" },
      {
        op: "run",
        label: "the tools on the mixed predicate",
        fn: (_s, ctx) => {
          const c = ctx.core as any;
          const attempt = (name: string, fn: () => unknown) => {
            try {
              ctx.external([name, fn()]);
            } catch (error) {
              ctx.external([name, "threw", error]);
            }
          };
          attempt("evaluate", () =>
            c.evaluatePredicate(MIXED, { n: 1, phase: "red" }),
          );
          attempt("explained", () =>
            c.evaluatePredicateExplained(MIXED, { n: 1, phase: "red" }),
          );
          attempt("describe", () => c.describePredicate(MIXED));
          attempt("validate", () => c.validatePredicate(MIXED));
          attempt("sql", () => c.predicateToSQL(MIXED, { table: "t" }));
          attempt("postgrest", () => c.predicateToPostgrest(MIXED));
          attempt("mongo", () => c.predicateToMongo(MIXED));
        },
      },
    ],
  );

  scenario(
    "`$changed` in an effect's on fires on the first run, then on each change (U10)",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number(), other: t.number() },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: (facts: any) => {
          facts.n = 0;
          facts.other = 0;
        },
        effects: {
          changed: {
            on: { n: { $changed: true } },
            run: (facts: any) => {
              external(["changed ran", facts.n, facts.other]);
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "settle" },
      { op: "set", key: "n", value: 2 },
      { op: "settle" },
      { op: "set", key: "other", value: 5 },
      { op: "settle" },
      { op: "set", key: "n", value: 2 },
      { op: "settle" },
      { op: "set", key: "n", value: 3 },
      { op: "settle" },
    ],
  );
});
