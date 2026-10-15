/**
 * L11: the predicate DSL and its tools, driven from a running system's
 * history — explained evaluation, describe, hash, SQL/Mongo/PostgREST
 * compilers, predict, doctor, rules diff, replay and sweep.
 */

import { scenario, suite } from "../scenario.js";

const WHEN = { phase: "red", elapsed: { $gte: 30 } };
const PROPOSED = { phase: { $in: ["red", "yellow"] }, elapsed: { $gte: 20 } };

suite("L11 predicates", () => {
  scenario(
    "predicate tools over a light's recorded history",
    ({ core: { createModule, t } }) => ({
      module: createModule("light", {
        schema: {
          facts: { phase: t.string(), elapsed: t.number(), note: t.string() },
          derivations: {},
          events: {},
          requirements: { NEXT: {} },
        },
        init: (facts: any) => {
          facts.phase = "red";
          facts.elapsed = 0;
          facts.note = "";
        },
        constraints: {
          next: { when: WHEN, require: { type: "NEXT" } },
          caution: {
            when: { phase: "yellow", note: { $exists: true, $ne: "" } },
            require: { type: "NEXT" },
          },
        },
        resolvers: {
          next: {
            requirement: "NEXT",
            resolve: async (_req: unknown, context: any) => {
              context.facts.phase =
                context.facts.phase === "red" ? "green" : "red";
              context.facts.elapsed = 0;
            },
          },
        },
      } as any),
      history: { maxSnapshots: 20 },
    }),
    [
      { op: "start" },
      { op: "set", key: "elapsed", value: 10 },
      { op: "settle" },
      { op: "set", key: "elapsed", value: 25 },
      { op: "settle" },
      { op: "set", key: "elapsed", value: 35 },
      { op: "settle" },
      {
        op: "batch",
        writes: [
          ["phase", "yellow"],
          ["note", "slow"],
        ],
      },
      { op: "settle" },
      {
        op: "run",
        label: "run every predicate tool",
        fn: (system, { core, external }) => {
          const attempt = (name: string, fn: () => unknown) => {
            try {
              external([name, fn()]);
            } catch (error) {
              external([name, "threw", error]);
            }
          };
          const facts = system.getSnapshot().facts;
          const frames = core.framesFromHistory(system.history);
          attempt("frames", () => frames.length);
          attempt("evaluate", () => core.evaluatePredicate(WHEN, facts));
          attempt("explained", () =>
            core.evaluatePredicateExplained(WHEN, facts),
          );
          attempt("validate", () =>
            core.validatePredicate({ x: { $bogus: 1 } }),
          );
          attempt("is predicate", () => [
            core.isPredicate(WHEN),
            core.isPredicate(() => true),
          ]);
          attempt("extract deps", () => core.extractDeps(PROPOSED));
          attempt("describe natural", () => core.describePredicate(PROPOSED));
          attempt("describe code", () =>
            core.describePredicate(PROPOSED, { style: "code" } as never),
          );
          attempt("hash", () => [
            core.predicateHash(WHEN),
            core.predicateHash({ elapsed: { $gte: 30 }, phase: "red" }),
          ]);
          attempt("sql", () =>
            core.predicateToSQL(PROPOSED, { table: "lights" }),
          );
          attempt("mongo", () => core.predicateToMongo(PROPOSED));
          attempt("pgrest", () => core.predicateToPostgrest(PROPOSED));
          attempt("predict", () => core.predict(WHEN, facts));
          attempt("doctor", () =>
            core.doctor.checkAgainst({ elapsed: { $lt: 10 }, phase: "red" }, [
              { id: "next", whenSpec: WHEN },
            ]),
          );
          attempt("rules diff", () =>
            core.diffRules({
              before: { next: WHEN },
              after: { next: PROPOSED, extra: { note: "x" } },
            } as never),
          );
          attempt("replay", () =>
            core.replayUnder({ frames, original: WHEN, proposed: PROPOSED }),
          );
          attempt("sweep", () =>
            core.sweepUnder({
              frames,
              original: WHEN,
              template: { phase: "red", elapsed: { $gte: { $hole: "t" } } },
              sweep: { t: [10, 20, 30, 40] },
            } as never),
          );
          attempt("template", () =>
            core.evaluateTemplate(
              { $template: "light is {phase}" } as never,
              facts,
            ),
          );
        },
      },
    ],
  );
});
