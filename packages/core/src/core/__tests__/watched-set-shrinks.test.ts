/**
 * The watched set is the bound the per-reconcile invalidation walk is measured
 * against. It grows when a constraint or an effect reads a derivation, and it
 * used to shrink only when a derivation was destroyed — so a gate that opened
 * once was watched for the life of the system.
 *
 * These tests assert on the count, because it is the only part of this a user
 * can observe, and because a test that passes equally well before and after the
 * change is not evidence of anything. Each one below was run against the old
 * behaviour first and failed there.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";

describe("the watched set shrinks when readers stop reading", () => {
  it("a gate that closes gives its value back", async () => {
    const module = createModule("gate", {
      schema: {
        facts: { n: t.number(), open: t.boolean() },
        derivations: { doubled: t.number() },
        requirements: { NOTE: {} },
      },
      init: (facts) => {
        facts.n = 1;
        facts.open = false;
      },
      derive: { doubled: (facts) => facts.n * 2 },
      constraints: {
        watch: {
          // Reads `doubled` only while the gate is open.
          when: (facts, derived) =>
            facts.open ? derived.doubled > 1e9 : false,
          require: { type: "NOTE" },
        },
      },
      resolvers: { watch: { requirement: "NOTE", resolve: async () => {} } },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();
    expect(system.inspect().observedDerivations).toBe(0);

    system.facts.open = true;
    await system.settle();
    expect(system.inspect().observedDerivations).toBe(1);

    system.facts.open = false;
    await system.settle();

    // Before: still 1, for the life of the system.
    expect(system.inspect().observedDerivations).toBe(0);

    system.stop();
  });

  it("does not accumulate across many gates", async () => {
    const GATES = 8;
    const facts: Record<string, unknown> = { phase: t.number() };
    const derivations: Record<string, unknown> = {};
    const derive: Record<string, unknown> = {};
    const constraints: Record<string, unknown> = {};

    for (let g = 0; g < GATES; g++) {
      derivations[`v${g}`] = t.number();
      derive[`v${g}`] = () => g;
      constraints[`c${g}`] = {
        when: (f: { phase: number }, d: Record<string, number | undefined>) =>
          f.phase === g ? (d[`v${g}`] ?? 0) > 1e9 : false,
        require: { type: "NOTE" },
      };
    }

    const module = createModule("gates", {
      schema: { facts, derivations, requirements: { NOTE: {} } } as never,
      init: (f: Record<string, number>) => {
        f.phase = -1;
      },
      derive: derive as never,
      constraints: constraints as never,
      resolvers: {
        note: { requirement: "NOTE", resolve: async () => {} },
      } as never,
    });

    const system = createSystem({ module });
    // The module config is built dynamically, so its fact keys are not in the
    // inferred type. Naming the shape once here keeps the assertions readable.
    const facts_ = system.facts as unknown as { phase: number };
    system.start();
    await system.settle();

    // Each gate opens in turn. Only ever one is reading.
    for (let g = 0; g < GATES; g++) {
      facts_.phase = g;
      await system.settle();
      expect(system.inspect().observedDerivations).toBe(1);
    }

    facts_.phase = -1;
    await system.settle();

    // Before: 8, and never fewer.
    expect(system.inspect().observedDerivations).toBe(0);

    system.stop();
  });

  it("keeps watching a value a constraint still reads", async () => {
    const module = createModule("steady", {
      schema: {
        facts: { n: t.number() },
        derivations: { doubled: t.number() },
        requirements: { NOTE: {} },
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: { doubled: (facts) => facts.n * 2 },
      constraints: {
        watch: {
          // Reads it on every pass, unconditionally.
          when: (_facts, derived) => derived.doubled > 1e9,
          require: { type: "NOTE" },
        },
      },
      resolvers: { watch: { requirement: "NOTE", resolve: async () => {} } },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();
    expect(system.inspect().observedDerivations).toBe(1);

    // Many passes later it is still watched — the prune must not take a live one.
    for (let i = 0; i < 10; i++) {
      system.facts.n = i;
      await system.settle();
    }
    expect(system.inspect().observedDerivations).toBe(1);

    system.stop();
  });

  it("still wakes a gate that reopens after being pruned", async () => {
    let fired = 0;
    const module = createModule("reopen", {
      schema: {
        facts: { n: t.number(), open: t.boolean() },
        derivations: { doubled: t.number() },
        requirements: { NOTE: {} },
      },
      init: (facts) => {
        facts.n = 1;
        facts.open = false;
      },
      derive: { doubled: (facts) => facts.n * 2 },
      constraints: {
        watch: {
          when: (facts, derived) => (facts.open ? derived.doubled > 4 : false),
          require: { type: "NOTE" },
        },
      },
      resolvers: {
        watch: {
          requirement: "NOTE",
          resolve: async () => {
            fired++;
          },
        },
      },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    system.facts.open = true;
    await system.settle();
    system.facts.open = false;
    await system.settle();
    expect(system.inspect().observedDerivations).toBe(0);

    // Reopen, and move the value past the threshold. The wakeup must still
    // happen — pruning is only allowed to forget, never to go deaf.
    system.facts.open = true;
    system.facts.n = 10;
    await system.settle();

    expect(system.inspect().observedDerivations).toBe(1);
    expect(fired).toBeGreaterThan(0);

    system.stop();
  });
});
