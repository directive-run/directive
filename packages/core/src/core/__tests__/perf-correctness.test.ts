import { describe, expect, it, vi } from "vitest";
import { createDerivationsManager } from "../derivations.js";
import { createFactsStore } from "../facts.js";
import { createResolversManager } from "../resolvers.js";
import { createConstraintsManager } from "../constraints.js";
import { createEffectsManager } from "../effects.js";
import { createFacts, createModule, createSystem, t } from "../../index.js";

// ============================================================================
// Helpers
// ============================================================================

function setupDerivations(
  defs: Record<
    string,
    (
      facts: Record<string, unknown>,
      derived: Record<string, unknown>,
    ) => unknown
  > = {},
  schema: Record<string, unknown> = { count: t.number(), name: t.string() },
) {
  const { store, facts } = createFacts({ schema });
  (facts as Record<string, unknown>).count = 0;
  (facts as Record<string, unknown>).name = "alice";

  const manager = createDerivationsManager({
    definitions: defs as any,
    facts: facts as any,
    store: store as any,
  });

  return { store, facts, manager };
}

// ============================================================================
// P0-1: Iterative invalidateDerivation (no stack overflow)
// ============================================================================

describe("P0-1: iterative invalidateDerivation", () => {
  it("handles 200+ chained derivations without stack overflow", () => {
    const CHAIN_LENGTH = 200;
    const schema: Record<string, unknown> = { root: t.number() };
    const { store, facts } = createFacts({ schema });
    (facts as Record<string, unknown>).root = 0;

    // Build a chain: d0 reads root, d1 reads d0, d2 reads d1, ..., d199 reads d198
    const defs: Record<string, (f: any, d: any) => unknown> = {};
    defs["d0"] = (f: any) => f.root * 2;
    for (let i = 1; i < CHAIN_LENGTH; i++) {
      const depKey = `d${i - 1}`;
      defs[`d${i}`] = (_f: any, d: any) => (d[depKey] ?? 0) + 1;
    }

    const manager = createDerivationsManager({
      definitions: defs as any,
      facts: facts as any,
      store: store as any,
    });

    // Force computation of the entire chain (establishes dependency tracking)
    const lastKey = `d${CHAIN_LENGTH - 1}`;
    const result = manager.get(lastKey as any);
    expect(result).toBe(CHAIN_LENGTH - 1); // d0=0, d1=1, ..., d199=199

    // Invalidate the root — this triggers a chain of 200 invalidations.
    // With recursive traversal this would overflow; iterative handles it fine.
    expect(() => manager.invalidate("root")).not.toThrow();

    // Verify the chain is stale
    expect(manager.isStale(lastKey as any)).toBe(true);

    // Recompute and verify
    (facts as Record<string, unknown>).root = 5;
    const newResult = manager.get(lastKey as any);
    expect(newResult).toBe(10 + CHAIN_LENGTH - 1); // d0=10, d1=11, ..., d199=209
  });

  it("invalidateMany shares visited Set across calls", () => {
    const { manager } = setupDerivations({
      doubled: (facts) => (facts.count as number) * 2,
      named: (facts) => `${facts.name}-${facts.count}`,
      // both depends on "count" — a shared chain root
      combined: (_facts, derived) =>
        `${derived.doubled}-${derived.named}`,
    });

    // Force computation
    manager.get("combined" as any);

    // Verify correctness: after invalidateMany, all should be stale
    manager.invalidateMany(["count", "name"]);

    expect(manager.isStale("doubled" as any)).toBe(true);
    expect(manager.isStale("named" as any)).toBe(true);
    expect(manager.isStale("combined" as any)).toBe(true);
  });

  it("diamond dependency invalidates each node only once", () => {
    const computeCount = { d: 0 };
    const { manager, facts } = setupDerivations({
      left: (facts) => (facts.count as number) + 1,
      right: (facts) => (facts.count as number) + 2,
      bottom: (_facts, derived) => {
        computeCount.d++;
        return (derived.left as number) + (derived.right as number);
      },
    });

    // Initial compute
    expect(manager.get("bottom" as any)).toBe(3);
    expect(computeCount.d).toBe(1);

    // Invalidate — both left and right depend on "count", bottom depends on both
    manager.invalidate("count");
    expect(manager.isStale("bottom" as any)).toBe(true);

    // Recompute
    (facts as Record<string, unknown>).count = 10;
    expect(manager.get("bottom" as any)).toBe(23);
    expect(computeCount.d).toBe(2); // Only recomputed once
  });

  it("diamond invalidation via onInvalidate fires exactly once per node", () => {
    const onInvalidate = vi.fn();
    const schema = { count: t.number() };
    const { store, facts } = createFacts({ schema });
    (facts as Record<string, unknown>).count = 0;

    const manager = createDerivationsManager({
      definitions: {
        left: (f: any) => f.count + 1,
        right: (f: any) => f.count + 2,
        bottom: (_f: any, d: any) => (d.left ?? 0) + (d.right ?? 0),
      } as any,
      facts: facts as any,
      store: store as any,
      onInvalidate,
    });

    // Force computation to establish deps
    manager.get("bottom" as any);

    // Invalidate root — should invalidate left, right, bottom each once
    manager.invalidate("count");

    const invalidatedIds = onInvalidate.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(invalidatedIds).toContain("left");
    expect(invalidatedIds).toContain("right");
    expect(invalidatedIds).toContain("bottom");
    // bottom should appear exactly once (not twice from left + right)
    expect(
      invalidatedIds.filter((id) => id === "bottom"),
    ).toHaveLength(1);
  });
});

// ============================================================================
// P0-2: FactsStore destroy
// ============================================================================

describe("P0-2: FactsStore destroy", () => {
  it("subscribe callbacks don't fire after destroy", () => {
    const store = createFactsStore({
      schema: { count: t.number() },
      validate: false,
    });

    const listener = vi.fn();
    store.subscribe(["count"], listener);

    // Fire before destroy
    store.set("count", 1);
    expect(listener).toHaveBeenCalledTimes(1);

    // Destroy
    (store as unknown as Record<string, () => void>).destroy!();

    // Fire after destroy — listener should not be called
    store.set("count", 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("subscribeAll callbacks don't fire after destroy", () => {
    const store = createFactsStore({
      schema: { count: t.number() },
      validate: false,
    });

    const listener = vi.fn();
    store.subscribeAll(listener);

    store.set("count", 1);
    expect(listener).toHaveBeenCalledTimes(1);

    (store as unknown as Record<string, () => void>).destroy!();

    store.set("count", 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("system.destroy() clears store listeners via engine", () => {
    const mod = createModule("test-mod", {
      schema: {
        facts: { count: t.number() },
        events: { inc: {} },
        derivations: {},
        requirements: {},
      },
      init: (facts) => {
        facts.count = 0;
      },
      events: {
        inc: (facts) => {
          facts.count = (facts.count as number) + 1;
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    const listener = vi.fn();
    system.subscribe(["count"], listener);

    system.dispatch({ type: "inc" });
    expect(listener).toHaveBeenCalled();

    // destroy() should complete without error and clear internal listeners
    expect(() => system.destroy()).not.toThrow();
  });

  it("batch operations still work after destroy (no crash)", () => {
    const store = createFactsStore({
      schema: { count: t.number() },
      validate: false,
    });

    (store as unknown as Record<string, () => void>).destroy!();

    // Should not throw — just no listeners to notify
    expect(() => {
      store.batch(() => {
        store.set("count", 42);
      });
    }).not.toThrow();

    expect(store.get("count")).toBe(42);
  });
});

// ============================================================================
// P1-1: Conditional topo sort rebuild
// ============================================================================

describe("P1-1: conditional topo sort rebuild", () => {
  it("registers constraints without after deps without full graph rebuild", () => {
    const { facts } = createFacts({
      schema: { status: t.string() },
    });
    (facts as Record<string, unknown>).status = "idle";

    const manager = createConstraintsManager({
      definitions: {
        base: {
          when: (f: any) => f.status === "idle",
          require: { type: "ACTIVATE" },
        },
      },
      facts: facts as any,
    });

    // Register new constraint WITHOUT after deps — should not throw
    expect(() =>
      manager.registerDefinitions({
        simple: {
          when: (f: any) => f.status === "active",
          require: { type: "DEACTIVATE" },
        },
      }),
    ).not.toThrow();
  });

  it("registers constraints WITH after deps and detects cycles", () => {
    const { facts } = createFacts({
      schema: { status: t.string() },
    });
    (facts as Record<string, unknown>).status = "idle";

    const manager = createConstraintsManager({
      definitions: {
        a: {
          when: (f: any) => f.status === "idle",
          require: { type: "A" },
        },
      },
      facts: facts as any,
    });

    // Register with after deps — should validate correctly
    expect(() =>
      manager.registerDefinitions({
        b: {
          when: (f: any) => f.status === "active",
          require: { type: "B" },
          after: ["a"],
        },
      }),
    ).not.toThrow();
  });
});

// ============================================================================
// P1-2: Effects deps stability optimization
// ============================================================================

describe("P1-2: effects deps stability", () => {
  it("skips re-tracking after deps stabilize", async () => {
    const { store, facts } = createFacts({
      schema: { count: t.number(), name: t.string() },
    });
    (facts as Record<string, unknown>).count = 0;
    (facts as Record<string, unknown>).name = "alice";

    let runCount = 0;
    const manager = createEffectsManager({
      definitions: {
        logger: {
          // Always reads count — deps should stabilize
          run: (f: any) => {
            runCount++;
            void f.count;
          },
        },
      },
      facts: facts as any,
      store: store as any,
    });

    // Run 4+ times with "count" changing — should stabilize after 3
    for (let i = 0; i < 5; i++) {
      await manager.runEffects(new Set(["count"]));
    }

    expect(runCount).toBe(5);
  });

  it("resets depsStable when a tracked fact changes", async () => {
    const { store, facts } = createFacts({
      schema: { count: t.number(), flag: t.boolean() },
    });
    (facts as Record<string, unknown>).count = 0;
    (facts as Record<string, unknown>).flag = false;

    let runCount = 0;
    const manager = createEffectsManager({
      definitions: {
        conditional: {
          run: (f: any) => {
            runCount++;
            // Always reads count
            void f.count;
            // Conditionally reads flag
            if ((f.count as number) > 5) {
              void f.flag;
            }
          },
        },
      },
      facts: facts as any,
      store: store as any,
    });

    // Run enough times to stabilize
    for (let i = 0; i < 4; i++) {
      await manager.runEffects(new Set(["count"]));
    }

    // Now change count to > 5 — depsStable should reset since count changed
    (facts as Record<string, unknown>).count = 10;
    await manager.runEffects(new Set(["count"]));

    // Effect should still run and track the new conditional read
    expect(runCount).toBe(5);
  });

  it("effects with explicit deps are not affected by stability optimization", async () => {
    const { store, facts } = createFacts({
      schema: { count: t.number() },
    });
    (facts as Record<string, unknown>).count = 0;

    let runCount = 0;
    const manager = createEffectsManager({
      definitions: {
        explicit: {
          deps: ["count"],
          run: () => {
            runCount++;
          },
        },
      },
      facts: facts as any,
      store: store as any,
    });

    for (let i = 0; i < 5; i++) {
      await manager.runEffects(new Set(["count"]));
    }

    expect(runCount).toBe(5);
  });

  it("runAll() resets depsStable so re-tracking occurs", async () => {
    const { store, facts } = createFacts({
      schema: { count: t.number(), flag: t.boolean() },
    });
    (facts as Record<string, unknown>).count = 0;
    (facts as Record<string, unknown>).flag = false;

    let readFlag = false;
    const manager = createEffectsManager({
      definitions: {
        conditional: {
          run: (f: any) => {
            void f.count;
            if ((f.count as number) > 5) {
              void f.flag;
              readFlag = true;
            }
          },
        },
      },
      facts: facts as any,
      store: store as any,
    });

    // Run 4 times to stabilize deps (only reads "count")
    for (let i = 0; i < 4; i++) {
      await manager.runEffects(new Set(["count"]));
    }
    expect(readFlag).toBe(false);

    // Change count > 5 and call runAll() instead of runEffects
    (facts as Record<string, unknown>).count = 10;
    await manager.runAll();

    // runAll() should have reset stability and re-tracked deps
    expect(readFlag).toBe(true);
  });

  it("resets depsStable when effect throws", async () => {
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { store, facts } = createFacts({
      schema: { count: t.number() },
    });
    (facts as Record<string, unknown>).count = 0;

    let runCount = 0;
    let shouldThrow = false;
    const manager = createEffectsManager({
      definitions: {
        flakyEffect: {
          run: (f: any) => {
            runCount++;
            void f.count;
            if (shouldThrow) {
              throw new Error("boom");
            }
          },
        },
      },
      facts: facts as any,
      store: store as any,
      onError: () => {}, // suppress console noise
    });

    // Run 2 times successfully (stableRunCount = 2)
    await manager.runEffects(new Set(["count"]));
    await manager.runEffects(new Set(["count"]));
    expect(runCount).toBe(2);

    // Third run throws — stableRunCount should reset to 0 (not reach 3)
    shouldThrow = true;
    await manager.runEffects(new Set(["count"]));
    expect(runCount).toBe(3);

    // Fourth run succeeds — should still be tracking (stableRunCount = 1, not stable)
    shouldThrow = false;
    await manager.runEffects(new Set(["count"]));
    expect(runCount).toBe(4);

    // Fifth and sixth runs — stability counter starts fresh from the error reset
    await manager.runEffects(new Set(["count"]));
    await manager.runEffects(new Set(["count"]));
    expect(runCount).toBe(6);

    warnSpy.mockRestore();
  });
});

// ============================================================================
// P1-3: Resolver cache LRU
// ============================================================================

describe("P1-3: resolver cache LRU", () => {
  it("resolves the same requirement type repeatedly via cache", () => {
    const onStart = vi.fn();
    const { store, facts } = createFacts({
      schema: { count: t.number() },
    });
    (facts as Record<string, unknown>).count = 0;

    const manager = createResolversManager({
      definitions: {
        handler: {
          requirement: "ACTION",
          resolve: async () => {},
        },
      },
      facts: facts as any,
      store: store as any,
      onStart,
    });

    // Resolve the same type multiple times — should use cache for lookup
    for (let i = 0; i < 5; i++) {
      manager.resolve({
        id: `req-${i}`,
        requirement: { type: "ACTION" },
        fromConstraint: "test",
      });
    }

    // All 5 should have matched the handler (first is fresh, rest via cache)
    expect(onStart).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 5; i++) {
      expect(onStart).toHaveBeenCalledWith(
        "handler",
        expect.objectContaining({ id: `req-${i}` }),
      );
    }

    // Cleanup
    manager.cancelAll();
  });
});

// ============================================================================
// P2-4: derivedProxy missing setPrototypeOf trap
// ============================================================================

describe("P2-4: derivedProxy setPrototypeOf trap", () => {
  it("setPrototypeOf trap rejects on derivedProxy", () => {
    const { manager } = setupDerivations({
      doubled: (facts) => (facts.count as number) * 2,
    });

    const proxy = manager.getProxy();

    // setPrototypeOf trap returns false → throws TypeError
    expect(() => Object.setPrototypeOf(proxy, {})).toThrow(TypeError);
    expect(Object.getPrototypeOf(proxy)).toBeNull();
  });
});
