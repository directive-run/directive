// Ported from packages/core/src/core/__tests__/settle-strands-invalidations.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

/**
 * A write made during the effects phase lands on a fact; a derivation reads
 * that fact; a constraint gates on the derivation. All three should happen in
 * one settle.
 *
 * An effect cannot write through the `facts` it is handed, which is read-only.
 * It can still cause a write, by dispatching an event or through a captured
 * `system.facts`, so these tests write the second way.
 *
 * They did not. The invalidation drain ran once per reconcile, *before* effects,
 * so a derivation invalidated by an effect's write landed in `invalidationRoots`
 * after the only pass that reads them. The constraint's dependency set names the
 * derivation, the announcement set never carried it, and the pass ended.
 *
 * The value stayed correct on pull — `system.derive.x` reads the new number the
 * whole time — so only the *wakeup* was lost. That is the shape that survives a
 * snapshot assertion and shows up as "it works when I check it manually."
 *
 * `settle()` then resolved and reported a quiescent system while
 * `invalidationRoots` was non-empty and nothing was scheduled to drain it. A
 * handler that settles before responding returns pre-resolution state; a durable
 * object that settles before persisting and hibernates loses the requirement
 * outright.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";

describe("an effect's write reaches a derivation-gated constraint", () => {
  it("fires the constraint in the same settle", async () => {
    const seen: number[] = [];

    const module = createModule("relay", {
      schema: {
        facts: { trigger: t.number(), source: t.number(), fired: t.number() },
        derivations: { doubled: t.number() },
        requirements: { NOTE: {} },
      },
      init: (facts) => {
        facts.trigger = 0;
        facts.source = 0;
        facts.fired = 0;
      },
      derive: {
        doubled: (facts) => facts.source * 2,
      },
      effects: {
        // The write that starts the chain, from inside the effects phase.
        propagate: {
          deps: ["trigger"],
          run: (facts) => {
            // Effects cannot write through their own `facts`; a write through
            // a captured system still lands during the effects phase.
            system.facts.source = facts.trigger;
          },
        },
      },
      constraints: {
        // Gates ONLY on the derivation. No fact key in its dependency set, so
        // the fact write alone cannot wake it — the derivation announcement has
        // to arrive.
        note: {
          when: (_facts, derived) => {
            seen.push(derived.doubled);

            return derived.doubled >= 10;
          },
          require: { type: "NOTE" },
        },
      },
      resolvers: {
        note: {
          requirement: "NOTE",
          resolve: async (_req, context) => {
            context.facts.fired += 1;
            context.facts.source = 0;
          },
        },
      },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    system.facts.trigger = 5;
    await system.settle();

    // The value was never wrong — only the wakeup was missing. Asserting that
    // 10 was *seen* rather than seen last, because the resolver zeroes `source`
    // on the way out, so the final evaluation legitimately reads 0 again.
    expect(seen).toContain(10);
    expect(system.facts.fired).toBe(1);

    system.stop();
  });

  it("settles without leaving an undelivered invalidation behind", async () => {
    const module = createModule("quiet", {
      schema: {
        facts: { trigger: t.number(), source: t.number() },
        derivations: { doubled: t.number() },
      },
      init: (facts) => {
        facts.trigger = 0;
        facts.source = 0;
      },
      derive: { doubled: (facts) => facts.source * 2 },
      effects: {
        propagate: {
          deps: ["trigger"],
          run: (facts) => {
            // Effects cannot write through their own `facts`; a write through
            // a captured system still lands during the effects phase.
            system.facts.source = facts.trigger;
          },
        },
        watch: {
          run: (_facts, _prev, derived) => {
            void derived.doubled;
          },
        },
      },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    system.facts.trigger = 7;
    await system.settle();

    // A system that reports quiescence must not be holding an announcement it
    // has not made. Non-zero here is the system claiming settled and lying.
    expect(system.isSettled).toBe(true);
    expect(system.inspect().pendingInvalidations).toBe(0);
    expect(system.derive.doubled).toBe(14);

    system.stop();
  });

  /**
   * The effect half, which used to be pinned as a standing boundary: the keys
   * written while effects ran are carried into the next pass, so an effect
   * gated on the derivation they move is woken too. A self-feeding effect is
   * bounded separately (see engine.test.ts).
   */
  it("wakes a derivation-gated effect from an effect-phase write", async () => {
    const run = vi.fn();

    const module = createModule("chain", {
      schema: {
        facts: { trigger: t.number(), source: t.number() },
        derivations: { tripled: t.number() },
      },
      init: (facts) => {
        facts.trigger = 0;
        facts.source = 0;
      },
      derive: { tripled: (facts) => facts.source * 3 },
      effects: {
        propagate: {
          deps: ["trigger"],
          run: (facts) => {
            // Effects cannot write through their own `facts`; a write through
            // a captured system still lands during the effects phase.
            system.facts.source = facts.trigger;
          },
        },
        report: {
          run: (_facts, _prev, derived) => {
            run(derived.tripled);
          },
        },
      },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    system.facts.trigger = 4;
    await system.settle();

    expect(system.derive.tripled).toBe(12);
    expect(run).toHaveBeenLastCalledWith(12);

    // What matters for correctness is that the system does not lie about it:
    // nothing is left undelivered, so `settle()` is telling the truth when it
    // says there is no more work.
    expect(system.inspect().pendingInvalidations).toBe(0);

    system.stop();
  });
});
