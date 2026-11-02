/**
 * L6: every t.* builder validating good and bad writes in development, and
 * the schema introspection functions over the same schema, and `.default()`
 * (U11, row (al): 1.35 stores a default and never applies it; 2.0 fills a fact
 * still undefined after init, initialFacts and restore). Validating a
 * predicate against the schema is an L11 export: l11-predicates.test.ts.
 */

import { type BuildContext, scenario, suite } from "../scenario.js";

function schema({ core: { t } }: BuildContext) {
  const tt = t as any;

  return {
    s: tt
      .string()
      .minLength(2)
      .maxLength(5)
      .pattern(/^[a-z]+$/),
    n: tt.number().min(0).max(10),
    b: tt.boolean(),
    arr: tt.array().of(tt.number()).nonEmpty().maxLength(3),
    obj: tt.object().shape({ x: tt.number() }).hasKeys("x"),
    e: tt.enum("a", "b"),
    lit: tt.literal(3),
    nul: tt.nullable(tt.string()),
    opt: tt.optional(tt.number()),
    rec: tt.record(tt.number()),
    tup: tt.tuple(tt.string(), tt.number()),
    date: tt.date(),
    id: tt.uuid(),
    mail: tt.email(),
    link: tt.url(),
    big: tt.bigint(),
    dflt: tt.number().default(7).describe("has a default"),
  };
}

const GOOD: Record<string, unknown> = {
  s: "abc",
  n: 5,
  b: true,
  arr: [1],
  obj: { x: 1 },
  e: "a",
  lit: 3,
  nul: null,
  opt: undefined,
  rec: { k: 1 },
  tup: ["a", 1],
  date: new Date(0),
  id: "123e4567-e89b-12d3-a456-426614174000",
  mail: "a@b.co",
  link: "https://directive.run",
  big: BigInt(1),
  dflt: 1,
};

const BAD: [string, unknown][] = [
  ["s", "A"],
  ["s", "toolong"],
  ["n", 11],
  ["b", "yes"],
  ["arr", []],
  ["arr", [1, 2, 3, 4]],
  ["arr", ["x"]],
  ["obj", { y: 1 }],
  ["e", "c"],
  ["lit", 4],
  ["nul", 1],
  ["rec", { k: "x" }],
  ["tup", [1, "a"]],
  ["date", "2020"],
  ["id", "nope"],
  ["mail", "nope"],
  ["link", "not a url"],
  ["big", 1],
];

suite("L6 schema kinds", () => {
  scenario(
    "every t.* builder accepts good writes and refuses bad ones",
    (ctx) => ({
      module: ctx.core.createModule("m", {
        schema: { facts: schema(ctx), derivations: {}, events: {} },
        init: (facts: any) => {
          for (const [k, v] of Object.entries(GOOD)) {
            facts[k] = v;
          }
        },
      } as any),
    }),
    [
      { op: "start" },
      {
        op: "run",
        label: "bad writes",
        fn: (system, { external }) => {
          for (const [key, value] of BAD) {
            try {
              system.facts[key] = value;
              external(["accepted", key]);
            } catch (error) {
              external(["refused", key, error]);
            }
          }
        },
      },
      { op: "settle" },
    ],
  );

  scenario(
    "schema introspection: kinds and operators",
    (ctx) => ({
      module: ctx.core.createModule("m", {
        schema: { facts: schema(ctx), derivations: {}, events: {} },
        init: (facts: any) => {
          for (const [k, v] of Object.entries(GOOD)) {
            facts[k] = v;
          }
        },
      } as any),
    }),
    [
      {
        op: "run",
        label: "introspect",
        fn: (_s, ctx) => {
          const c = ctx.core as any;
          const facts = schema(ctx);
          const attempt = (name: string, fn: () => unknown) => {
            try {
              ctx.external([name, fn()]);
            } catch (error) {
              ctx.external([name, "threw", error]);
            }
          };
          attempt("kinds", () =>
            Object.fromEntries(
              Object.entries(facts).map(([k, v]) => [k, c.getKind(v)]),
            ),
          );
          attempt("field kinds", () => c.getSchemaFieldKinds({ facts }));
          attempt("operators", () => c.getOperatorsForKind("number"));
          attempt("all operators", () => c.listAllPredicateOperators());
        },
      },
    ],
  );

  scenario(
    "a .default(): a fact init leaves alone, one a ??= init sets, one it sets to undefined (U11)",
    (ctx) => ({
      module: ctx.core.createModule("m", {
        schema: { facts: defaults(ctx), derivations: {}, events: {} },
        init: (facts: any) => {
          facts.nullish ??= 1;
          facts.cleared = undefined;
          facts.plain = 0;
        },
      } as any),
    }),
    [
      readDefaults("created"),
      { op: "start" },
      { op: "settle" },
      readDefaults("started"),
    ],
  );

  scenario(
    "a .default() with initialFacts: one they give, one they leave out (U11)",
    (ctx) => ({
      module: ctx.core.createModule("m", {
        schema: { facts: defaults(ctx), derivations: {}, events: {} },
        init: () => {},
      } as any),
      initialFacts: { given: 8 },
    }),
    [
      readDefaults("created"),
      { op: "start" },
      { op: "settle" },
      readDefaults("started"),
    ],
  );
});

/** U11's facts: four with a default, and one without. */
function defaults({ core: { t } }: BuildContext) {
  const tt = t as any;

  return {
    untouched: tt.number().default(5),
    nullish: tt.number().default(6),
    // t.any(): the one kind whose development check lets init write
    // undefined (a t.number() refuses it on both engines).
    cleared: tt.any().default(7),
    given: tt.number().default(9),
    plain: tt.number(),
  };
}

/** Each U11 fact's value, and the snapshot's keys, at `label`. */
function readDefaults(label: string) {
  return {
    op: "run" as const,
    label,
    fn: (system: any, { external }: { external(data: unknown): void }) => {
      const keys = ["untouched", "nullish", "cleared", "given", "plain"];
      external([
        label,
        Object.fromEntries(keys.map((k) => [k, system.facts[k]])),
        Object.keys(system.getSnapshot().facts).sort(),
      ]);
    },
  };
}
