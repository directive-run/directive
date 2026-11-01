/**
 * L4: what a membership test (`"d" in derived`) makes a reader depend on.
 * Two places where 1.35 does something its own docs do not promise and 2.0 is
 * expected to do differently (GATE-1 quirk (c), and (w), approved). Each
 * scenario records only what a user can see through the public API, so the L4
 * gate's divergence entries have an exact scenario to cover:
 *
 * - (c) an effect that only tests whether `d` is a derivation: 1.35 re-runs
 *   it at every change of `d`'s value, 2.0 only when membership changes;
 * - (w) an effect that tests a name that is not a derivation: 1.35, the effect
 *   having read nothing else, re-runs it at every change, 2.0 only when that
 *   name comes to exist;
 * - the control: a constraint that only tests `d`'s membership. Constraints
 *   (and derivations) are not affected, so 1.35's rule holds on every engine
 *   (the constraint is asked again at every change of `d`). It guards that
 *   (c) stays effects-only, and sits at L2 because it needs no effect.
 *
 * Each (c) and (w) scenario writes the fact `d` is derived from at least
 * three times (the pattern shows from the second change on) and an unrelated
 * fact once or more.
 */

import { type BuildContext, scenario, suite } from "../scenario.js";

/** Facts `a`, `b`; the derivation `d = a + 1`; whatever else the scenario adds. */
function withMembers(
  { core: { createModule, t } }: BuildContext,
  rest: Record<string, unknown>,
  requirements?: Record<string, unknown>,
) {
  return createModule("m", {
    schema: {
      facts: { a: t.number(), b: t.number() },
      derivations: { d: t.number() },
      events: {},
      ...(requirements ? { requirements } : {}),
    },
    init: (facts: any) => {
      facts.a = 0;
      facts.b = 0;
    },
    derive: { d: (facts: any) => facts.a + 1 },
    ...rest,
  } as any);
}

/** Writes of `a` (the derivation's input) with one unrelated write between. */
const writes = [
  { op: "start" },
  { op: "set", key: "a", value: 1 },
  { op: "settle" },
  { op: "set", key: "a", value: 2 },
  { op: "settle" },
  { op: "set", key: "a", value: 3 },
  { op: "settle" },
  { op: "set", key: "b", value: 1 },
  { op: "settle" },
  { op: "set", key: "a", value: 4 },
  { op: "settle" },
  { op: "set", key: "b", value: 2 },
  { op: "settle" },
  { op: "destroy" },
] as const;

suite("L4 what a membership test depends on", () => {
  scenario(
    "an effect that only tests a derivation's membership",
    (ctx) => ({
      module: withMembers(ctx, {
        effects: {
          asks: {
            run: (_facts: any, _prev: any, derived: any) =>
              ctx.external(["asks: d is a derivation?", "d" in derived]),
          },
        },
      }),
    }),
    [...writes],
    // The effect is the derivation's only reader, so the recorder must not
    // be a second one.
    { observeDerivations: false },
  );

  scenario(
    "an effect that tests a name that is not a derivation",
    (ctx) => ({
      module: withMembers(ctx, {
        effects: {
          asks: {
            run: (_facts: any, _prev: any, derived: any) =>
              ctx.external(["asks: nope is a derivation?", "nope" in derived]),
          },
        },
      }),
    }),
    [...writes],
  );

  scenario(
    "a constraint that only tests a derivation's membership",
    (ctx) => ({
      module: withMembers(
        ctx,
        {
          constraints: {
            asks: {
              when: (_facts: any, derived: any) => {
                ctx.external(["asks: d is a derivation?", "d" in derived]);

                return false;
              },
              require: { type: "R" },
            },
          },
        },
        { R: {} },
      ),
    }),
    [...writes],
    { observeDerivations: false },
  );
});
