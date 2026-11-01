/**
 * L4: what an effect keeps while it is disabled. Two places where 1.35 does
 * something its own docs do not promise and 2.0 is expected to do differently
 * (the L4 RFC's C3 and C4). Each scenario records only what a user can see
 * through the public API, so the L4 gate's divergence entries have an exact
 * scenario to cover:
 *
 * - (x) `effects.disable()` and the cleanup: 1.35 does not run the effect's
 *   cleanup at `disable`. It runs just before the first run after `enable`,
 *   and at `stop()`;
 * - (y) `disable` and the dependency record: 1.35 throws the record away, so
 *   after `enable` the effect runs on every change, not only on what it
 *   depends on (declared deps, a derivation dep, the last auto-tracked read
 *   set, the `on` gate), and the error boundary's "disable" strategy reaches
 *   the same `disable`.
 *
 * Every (y) scenario uses an effect with no cleanup, so (x) cannot show in it;
 * the (x) scenario writes only the fact its effects depend on, so (y) cannot
 * show in it.
 */

import { type BuildContext, scenario, suite } from "../scenario.js";

/** The module every (y) scenario shares: `a`, `b`, `c` and `d = a + 1`. */
function withEffects(
  { core: { createModule, t } }: BuildContext,
  effects: Record<string, unknown>,
) {
  return createModule("m", {
    schema: {
      facts: { a: t.number(), b: t.number(), c: t.number() },
      derivations: { d: t.number() },
      events: {},
    },
    init: (facts: any) => {
      facts.a = 0;
      facts.b = 0;
      facts.c = 0;
    },
    derive: { d: (facts: any) => facts.a + 1 },
    effects,
  } as any);
}

/** A labelled step that calls `effects.disable` or `effects.enable`. */
const control = (verb: "disable" | "enable", id: string) =>
  ({
    op: "run",
    label: `${verb} ${id}`,
    fn: (system: any, { external }: BuildContext) => {
      system.effects[verb](id);
      external([`${id} enabled?`, system.effects.isEnabled(id)]);
    },
  }) as const;

suite("L4 what an effect keeps while it is disabled", () => {
  scenario(
    "disable then enable: an effect with declared deps and a write to an unrelated fact",
    (ctx) => ({
      module: withEffects(ctx, {
        declared: {
          deps: ["a"],
          run: (facts: any) => ctx.external(["declared", facts.a]),
        },
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "a", value: 1 },
      { op: "settle" },
      control("disable", "declared"),
      { op: "set", key: "a", value: 2 },
      { op: "settle" },
      { op: "set", key: "b", value: 1 },
      { op: "settle" },
      control("enable", "declared"),
      { op: "set", key: "b", value: 2 },
      { op: "settle" },
      { op: "set", key: "c", value: 3 },
      { op: "settle" },
      { op: "set", key: "a", value: 4 },
      { op: "settle" },
      { op: "destroy" },
    ],
  );

  scenario(
    "disable then enable: an effect with a derivation dep and a write to an unrelated fact",
    (ctx) => ({
      module: withEffects(ctx, {
        derived: {
          deps: ["d"],
          run: (_facts: any, _prev: any, derived: any) =>
            ctx.external(["derived", derived.d]),
        },
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "a", value: 1 },
      { op: "settle" },
      control("disable", "derived"),
      { op: "set", key: "a", value: 2 },
      { op: "settle" },
      control("enable", "derived"),
      { op: "set", key: "b", value: 1 },
      { op: "settle" },
      { op: "set", key: "c", value: 1 },
      { op: "settle" },
      { op: "set", key: "a", value: 3 },
      { op: "settle" },
      { op: "destroy" },
    ],
    // The effect is the derivation's only reader, so it is the only thing
    // that keeps the derivation watched.
    { observeDerivations: false },
  );

  scenario(
    "disable then enable: an auto-tracked effect and a write to an unrelated fact",
    (ctx) => ({
      module: withEffects(ctx, {
        tracked: {
          run: (facts: any) => ctx.external(["tracked", facts.a]),
        },
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "a", value: 1 },
      { op: "settle" },
      control("disable", "tracked"),
      { op: "set", key: "b", value: 1 },
      { op: "settle" },
      control("enable", "tracked"),
      { op: "set", key: "b", value: 2 },
      { op: "settle" },
      { op: "set", key: "b", value: 3 },
      { op: "settle" },
      { op: "set", key: "a", value: 2 },
      { op: "settle" },
      { op: "set", key: "c", value: 1 },
      { op: "settle" },
      { op: "destroy" },
    ],
  );

  scenario(
    "disable then enable: an effect the error boundary disabled and a write to an unrelated fact",
    (ctx) => ({
      module: withEffects(ctx, {
        fragile: {
          deps: ["a"],
          run: (facts: any) => {
            ctx.external(["fragile", facts.a]);
            if (facts.a === 1) {
              throw new Error("fragile failed");
            }
          },
        },
      }),
      errorBoundary: {
        onEffectError: "disable",
        onError: (error: unknown) => ctx.external(["onError", error]),
      },
    }),
    [
      { op: "start" },
      { op: "set", key: "a", value: 1 },
      { op: "settle" },
      {
        op: "run",
        label: "is it enabled after the boundary",
        fn: (system, { external }) =>
          external(["fragile enabled?", system.effects.isEnabled("fragile")]),
      },
      { op: "set", key: "a", value: 2 },
      { op: "settle" },
      control("enable", "fragile"),
      { op: "set", key: "b", value: 1 },
      { op: "settle" },
      { op: "set", key: "c", value: 1 },
      { op: "settle" },
      { op: "set", key: "a", value: 3 },
      { op: "settle" },
      { op: "destroy" },
    ],
  );

  // Needs data-form predicates (`on` with an operator), so it sits at L11.
  scenario(
    "disable then enable: an effect with an on gate and a write to an unrelated fact",
    (ctx) => ({
      module: withEffects(ctx, {
        gated: {
          on: { a: { $gt: 5 } },
          run: (facts: any) => ctx.external(["gated", facts.a]),
        },
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "a", value: 1 },
      { op: "settle" },
      { op: "set", key: "a", value: 6 },
      { op: "settle" },
      control("disable", "gated"),
      { op: "set", key: "a", value: 7 },
      { op: "settle" },
      control("enable", "gated"),
      { op: "set", key: "a", value: 2 },
      { op: "settle" },
      { op: "set", key: "b", value: 1 },
      { op: "settle" },
      { op: "set", key: "a", value: 8 },
      { op: "settle" },
      { op: "destroy" },
    ],
  );

  scenario(
    "an effect's cleanup when disabled",
    (ctx) => {
      const withCleanup = (name: string) => ({
        deps: ["a"],
        run: (facts: any) => {
          const seen = facts.a;
          ctx.external([`${name} runs`, seen]);

          return () => ctx.external([`${name} cleanup of the run at`, seen]);
        },
      });

      return {
        module: withEffects(ctx, {
          // disabled, enabled, then asked to run again
          rerun: withCleanup("rerun"),
          // disabled, and still disabled when the system stops
          stopped: withCleanup("stopped"),
          // disabled, enabled, and stopped before it runs again
          enabledThenStopped: withCleanup("enabledThenStopped"),
        }),
      };
    },
    [
      { op: "start" },
      { op: "set", key: "a", value: 1 },
      { op: "settle" },
      control("disable", "rerun"),
      control("disable", "stopped"),
      control("disable", "enabledThenStopped"),
      { op: "set", key: "a", value: 2 },
      { op: "settle" },
      control("enable", "rerun"),
      { op: "set", key: "a", value: 3 },
      { op: "settle" },
      control("enable", "enabledThenStopped"),
      { op: "stop" },
      { op: "destroy" },
    ],
  );
});
