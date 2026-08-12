/**
 * Who is reading decides what a derivation read means.
 *
 * A derivation body reading another derivation is an internal edge — the
 * derivation graph invalidates along it already. A constraint or an effect
 * reading one is an outside observer, and the manager records that or the reader
 * is never woken when the value moves.
 *
 * That distinction used to live in a counter in the derivations module while the
 * tracking stack lived in another module: two structures that had to agree by
 * hand, and did not. The composition proxy consulted the counter; the
 * `system.derive` door did not, so a derivation composing through that door
 * registered *itself* as an external watcher. It now rides on the tracking frame,
 * which is the one place that already knows whose body is running.
 *
 * The observable consequence is the size of the watched set, which is the bound
 * the per-reconcile invalidation walk is measured against. These tests assert on
 * that number, because it is the only thing about this that a user can see —
 * and because a test that passes equally well before and after a change is not
 * evidence of anything.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";

describe("the watched set counts external readers only", () => {
  it("does not count a derivation composing through system.derive", async () => {
    const inner = createModule("inner", {
      schema: {
        facts: { n: t.number() },
        derivations: { doubled: t.number(), plusOne: t.number() },
      },
      init: (facts) => {
        facts.n = 2;
      },
      derive: {
        doubled: (facts) => facts.n * 2,
        // Composes through the accessor rather than the parameter. Still an
        // internal edge: nothing outside the derivation graph is reading here.
        plusOne: (facts): number => {
          void facts.n;

          return (system.derive.doubled as number) + 1;
        },
      },
    });

    const system = createSystem({ module: inner });
    system.start();
    await system.settle();

    // Force both to compute.
    expect(system.derive.plusOne).toBe(5);

    // No constraint, no effect, no explicit deps — nothing outside the graph is
    // watching, so the walk has no audience and the set is empty. Counting the
    // internal edge here is what inflated the bound the walk is measured
    // against, and announced a name nobody was waiting for.
    expect(system.inspect().observedDerivations).toBe(0);

    system.stop();
  });

  it("counts a constraint reading through the same accessor", async () => {
    const module = createModule("watcher", {
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
          when: () => {
            void system.derive.doubled;

            return false;
          },
          require: { type: "NOTE" },
        },
      },
      resolvers: {
        watch: { requirement: "NOTE", resolve: async () => {} },
      },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    // The other half of one rule: through the very same door, a constraint IS
    // an external reader and must be counted, or classifying the derivation
    // case correctly has only traded one silent failure for another.
    expect(system.inspect().observedDerivations).toBe(1);

    system.stop();
  });

  it("counts a derivation read through the parameter, once", async () => {
    const module = createModule("param", {
      schema: {
        facts: { n: t.number() },
        derivations: { a: t.number(), b: t.number() },
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: {
        a: (facts) => facts.n * 2,
        // Composes via the parameter — the ordinary internal edge.
        b: (_facts, derived) => derived.a + 1,
      },
      effects: {
        // The only external reader in the module, and it reads one derivation.
        report: {
          run: (_facts, _prev, derived) => {
            void derived.b;
          },
        },
      },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    // `b` is watched. `a` is reached only through `b`'s body, which is internal,
    // so it is not — the graph already invalidates along that edge.
    expect(system.inspect().observedDerivations).toBe(1);

    system.stop();
  });
});

describe("a derivation's private reads stay in its own frame", () => {
  it("keeps the dependency shape stable across the fast-path threshold", async () => {
    // After enough runs with an unchanged dependency set, the manager skips
    // re-tracking. That path used to push no frame at all, so the body's reads
    // landed in whatever frame was above it on the stack. Nothing in the public
    // surface reaches that today — a derivation is fresh by the time a
    // constraint reads it — so this is a guard, not a reproduction: what it
    // holds is that the reported shape does not change when the threshold trips.
    const module = createModule("stable", {
      schema: {
        facts: { a: t.number(), b: t.number(), gate: t.boolean() },
        derivations: { total: t.number() },
        requirements: { NOTE: {} },
      },
      init: (facts) => {
        facts.a = 1;
        facts.b = 1;
        facts.gate = true;
      },
      derive: { total: (facts) => facts.a + facts.b },
      constraints: {
        watch: {
          when: (facts, derived) => facts.gate && derived.total > 0,
          require: { type: "NOTE" },
        },
      },
      resolvers: {
        watch: { requirement: "NOTE", resolve: async () => {} },
      },
    });

    const system = createSystem({ module, trace: true });
    system.start();
    await system.settle();

    const shapes = new Set<string>();
    for (let i = 0; i < 8; i++) {
      system.facts.a = i + 2;
      await system.settle();
      const hit = (system.inspect().trace ?? [])
        .flatMap((entry) => entry.constraintsHit)
        .filter((c) => c.id === "watch")
        .at(-1);
      if (hit) {
        shapes.add([...hit.deps].sort().join(","));
      }
    }

    expect(shapes.size).toBe(1);
    // `b` belongs to the derivation, not to the constraint that pulls it.
    expect([...shapes][0]).not.toContain("b");

    system.stop();
  });
});
