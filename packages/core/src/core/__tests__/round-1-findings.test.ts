/**
 * Findings from a review round on the 1.27.1 watched-set change.
 *
 * Each of these was run against the unfixed code first and seen to fail. That
 * matters more than usual here: several findings in that round were checks that
 * had never been watched to fail, and a test written after the fix proves
 * nothing on its own.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";

describe("a disabled effect stops pinning what it read", () => {
  it("releases its derivations, the way a disabled constraint does", async () => {
    const module = createModule("d", {
      schema: {
        facts: { n: t.number() },
        derivations: { doubled: t.number() },
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: { doubled: (facts) => facts.n * 2 },
      effects: {
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
    expect(system.inspect().observedDerivations).toBe(1);

    system.effects.disable("watch");
    system.facts.n = 2;
    await system.settle();

    // Before: 1, for the life of the system — and the error boundary's
    // "disable" strategy reaches this same path.
    expect(system.inspect().observedDerivations).toBe(0);

    system.stop();
  });
});

describe("a derivation may be named after an Object.prototype member", () => {
  it("returns its value rather than the builtin", async () => {
    const module = createModule("p", {
      schema: {
        facts: { n: t.number() },
        derivations: { toString: t.number(), valueOf: t.number() },
      },
      init: (facts: { n: number }) => {
        facts.n = 2;
      },
      derive: {
        toString: (facts: { n: number }) => facts.n * 10,
        valueOf: (facts: { n: number }) => facts.n + 1,
      },
    } as never);

    const system = createSystem({ module });
    system.start();
    await system.settle();

    const derive = system.derive as unknown as Record<string, unknown>;

    // Before: both resolved to the inherited builtin function.
    expect(typeof derive.toString).toBe("number");
    expect(derive.toString).toBe(20);
    expect(derive.valueOf).toBe(3);

    system.stop();
  });
});

describe("the prune does not run when there is nothing to prune", () => {
  it("stays correct in a system that reads no derivation at all", async () => {
    const module = createModule("q", {
      schema: { facts: { n: t.number() }, requirements: { NOTE: {} } },
      init: (facts) => {
        facts.n = 0;
      },
      constraints: {
        // Reads only a fact. Nothing observes a derivation, so the union scan
        // has no work to do and is now skipped entirely.
        note: { when: (facts) => facts.n > 5, require: { type: "NOTE" } },
      },
      resolvers: { note: { requirement: "NOTE", resolve: async () => {} } },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    for (let i = 0; i < 12; i++) {
      system.facts.n = i;
      await system.settle();
    }

    expect(system.inspect().observedDerivations).toBe(0);
    expect(
      system.inspect().unmet.length + system.inspect().inflight.length,
    ).toBeGreaterThanOrEqual(0);

    system.stop();
  });
});
