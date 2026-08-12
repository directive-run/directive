/**
 * An effect writes a fact; a derivation reads that fact; a constraint gates on
 * the derivation. All three should happen in one settle.
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

import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index";

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
            facts.source = facts.trigger;
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
            facts.source = facts.trigger;
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
   * Deliberately NOT fixed here, and the boundary is pinned so the next attempt
   * knows where it is.
   *
   * The constraint half above works because the announcement is drained after
   * the effects phase and read by the constraint pass in the same reconcile.
   * The effects have already run by then, so reaching *them* means carrying the
   * keys past the clear into the following pass — and that is the shape a
   * previous fix took before being withdrawn the same day. See the sibling
   * suite "effects and the reconcile boundary — pinned known limitation" in
   * engine.test.ts for the full account.
   *
   * Re-derived here rather than taken on faith: carrying the keys forward and
   * pointing a self-feeding effect at it produced 2,001 runs in 41ms, bounded
   * only by the probe's own counter. An effect that writes a fact inside its
   * own dependency set has no damping — `Object.is` suppresses a repeated
   * value, so any effect writing a *changing* one runs until the process does.
   *
   * Closing this needs a bound on the feedback path, which is its own change.
   */
  it("does not wake a derivation-gated effect from an effect-phase write", async () => {
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
            facts.source = facts.trigger;
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

    // The value is right on pull, and a constraint gated the same way *would*
    // have fired. The effect does not, and that is the standing boundary.
    expect(system.derive.tripled).toBe(12);
    expect(run).toHaveBeenLastCalledWith(0);

    // What matters for correctness is that the system does not lie about it:
    // nothing is left undelivered, so `settle()` is telling the truth when it
    // says there is no more work.
    expect(system.inspect().pendingInvalidations).toBe(0);

    system.stop();
  });
});
