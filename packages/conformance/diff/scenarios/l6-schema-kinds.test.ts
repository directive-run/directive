/**
 * L6: every t.* builder validating good and bad writes in development, and
 * the schema introspection functions over the same schema.
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
    "schema introspection: kinds, operators and predicate validation",
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
          attempt("validate good", () =>
            c.validatePredicateAgainstSchema({ n: { $gte: 1 } }, { facts }),
          );
          attempt("validate bad", () =>
            c.validatePredicateAgainstSchema(
              { s: { $gte: 1 }, zz: 1 },
              { facts },
            ),
          );
        },
      },
    ],
  );
});
