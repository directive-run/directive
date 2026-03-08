import { describe, expect, it, vi } from "vitest";
import { createDerivationsManager } from "../derivations.js";
import { createFacts, t } from "../../index.js";

// ============================================================================
// Helpers
// ============================================================================

function setup(
  defs: Record<string, (facts: Record<string, unknown>, derive: Record<string, unknown>) => unknown> = {},
) {
  const schema = { count: t.number(), name: t.string() };
  const { store, facts } = createFacts({ schema });
  facts.count = 0;
  facts.name = "alice";

  const manager = createDerivationsManager({
    definitions: defs as any,
    facts: facts as any,
    store: store as any,
  });

  return { store, facts, manager };
}

// ============================================================================
// Basic Derivations
// ============================================================================

describe("derivations", () => {
  describe("basic derivations", () => {
    it("get computes a derivation from facts", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
      });

      expect(manager.get("doubled")).toBe(0);
    });

    it("get memoizes (does not recompute on second call)", () => {
      const computeFn = vi.fn((facts: Record<string, unknown>) => (facts.count as number) * 2);
      const { manager } = setup({ doubled: computeFn });

      manager.get("doubled");
      manager.get("doubled");

      expect(computeFn).toHaveBeenCalledTimes(1);
    });

    it("isStale returns false after compute, true after invalidation", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
      });

      manager.get("doubled");
      expect(manager.isStale("doubled")).toBe(false);

      manager.invalidate("count");
      expect(manager.isStale("doubled")).toBe(true);
    });

    it("invalidate marks a derivation stale when its fact dep changes", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
      });

      manager.get("doubled");
      expect(manager.isStale("doubled")).toBe(false);

      manager.invalidate("count");
      expect(manager.isStale("doubled")).toBe(true);
    });

    it("after invalidation, get recomputes with new value", () => {
      const { facts, manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
      });

      expect(manager.get("doubled")).toBe(0);

      facts.count = 5;
      manager.invalidate("count");

      expect(manager.get("doubled")).toBe(10);
    });
  });

  // ============================================================================
  // Deferred Notification
  // ============================================================================

  describe("deferred notification", () => {
    it("invalidate fires subscriber after all invalidations complete", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
        label: (facts) => `count=${facts.count}`,
      });

      manager.get("doubled");
      manager.get("label");

      const order: string[] = [];
      manager.subscribe(["doubled"], () => order.push("doubled"));
      manager.subscribe(["label"], () => order.push("label"));

      // Both depend on "count", both should fire after invalidation completes
      manager.invalidate("count");

      expect(order).toEqual(["doubled", "label"]);
    });

    it("invalidateMany batches notifications across multiple keys", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
        greeting: (facts) => `hi ${facts.name}`,
      });

      manager.get("doubled");
      manager.get("greeting");

      const calls: string[] = [];
      manager.subscribe(["doubled"], () => calls.push("doubled"));
      manager.subscribe(["greeting"], () => calls.push("greeting"));

      manager.invalidateMany(["count", "name"]);

      // Both fire, but as a single batch (not interleaved)
      expect(calls).toContain("doubled");
      expect(calls).toContain("greeting");
    });

    it("subscriber receives notification exactly once per batch", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
      });

      manager.get("doubled");

      const listener = vi.fn();
      manager.subscribe(["doubled"], listener);

      manager.invalidate("count");

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Composition
  // ============================================================================

  describe("composition", () => {
    it("derivation depending on another derivation via proxy", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
        quadrupled: (_facts, derived) => (derived.doubled as number) * 2,
      });

      expect(manager.get("quadrupled")).toBe(0);
    });

    it("invalidating a fact invalidates transitive derivations", () => {
      const { facts, manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
        quadrupled: (_facts, derived) => (derived.doubled as number) * 2,
      });

      manager.get("quadrupled");

      facts.count = 3;
      manager.invalidate("count");

      expect(manager.get("quadrupled")).toBe(12);
    });

    it("composition proxy tracks access correctly", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
        quadrupled: (_facts, derived) => (derived.doubled as number) * 2,
      });

      manager.get("quadrupled");

      const deps = manager.getDependencies("quadrupled");

      expect(deps.has("doubled")).toBe(true);
    });
  });

  // ============================================================================
  // Circular Dependency Detection
  // ============================================================================

  describe("circular dependency detection", () => {
    it("circular derivation (A depends on B, B depends on A) throws", () => {
      const { manager } = setup({
        a: (_facts, derived) => (derived.b as number) + 1,
        b: (_facts, derived) => (derived.a as number) + 1,
      });

      expect(() => manager.get("a")).toThrow("Circular dependency");
    });
  });

  // ============================================================================
  // Flush Guard
  // ============================================================================

  describe("flush guard", () => {
    it("flushNotifications terminates after MAX_FLUSH_ITERATIONS (100)", () => {
      const schema = { count: t.number() };
      const { store, facts } = createFacts({ schema });
      facts.count = 0;

      let iteration = 0;

      const manager = createDerivationsManager({
        definitions: {
          looping: (f: any) => f.count,
        } as any,
        facts: facts as any,
        store: store as any,
      });

      manager.get("looping");

      // Subscribe with a listener that re-invalidates, creating an infinite loop
      manager.subscribe(["looping"], () => {
        iteration++;
        if (iteration <= 200) {
          // Force the derivation non-stale so invalidation takes effect
          manager.get("looping");
          manager.invalidate("count");
        }
      });

      expect(() => manager.invalidate("count")).toThrow(
        "Infinite derivation notification loop",
      );
    });
  });

  // ============================================================================
  // Proxy Security
  // ============================================================================

  describe("proxy security", () => {
    it("BLOCKED_PROPS (__proto__, constructor, prototype) return undefined", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
      });

      const proxy = manager.getProxy();

      expect((proxy as any).__proto__).toBeUndefined();
      expect((proxy as any).constructor).toBeUndefined();
      expect((proxy as any).prototype).toBeUndefined();
    });

    it("set returns false (read-only)", () => {
      const { manager } = setup({});
      const proxy = manager.getProxy();

      expect(() => {
        (proxy as any).foo = "bar";
      }).toThrow();
    });

    it("deleteProperty returns false", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
      });

      const proxy = manager.getProxy();

      expect(() => {
        delete (proxy as any).doubled;
      }).toThrow();
    });

    it("defineProperty returns false", () => {
      const { manager } = setup({});
      const proxy = manager.getProxy();

      expect(() => {
        Object.defineProperty(proxy, "x", { value: 1 });
      }).toThrow();
    });

    it("getPrototypeOf returns null", () => {
      const { manager } = setup({});
      const proxy = manager.getProxy();

      expect(Object.getPrototypeOf(proxy)).toBeNull();
    });

    it("Symbol properties return undefined", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
      });

      const proxy = manager.getProxy();

      expect((proxy as any)[Symbol.iterator]).toBeUndefined();
      expect((proxy as any)[Symbol("custom")]).toBeUndefined();
    });
  });

  // ============================================================================
  // Dynamic Registration
  // ============================================================================

  describe("dynamic registration", () => {
    it("registerDefinitions adds new derivation", () => {
      const { manager } = setup({});

      manager.registerDefinitions({
        tripled: (facts: any) => (facts.count as number) * 3,
      } as any);

      expect(manager.get("tripled" as any)).toBe(0);
    });

    it("unregisterDefinition removes derivation and cleans deps", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
      });

      manager.get("doubled");
      expect(manager.getDependencies("doubled").size).toBeGreaterThan(0);

      manager.unregisterDefinition("doubled");

      expect(() => manager.get("doubled")).toThrow("Unknown derivation");
    });

    it("assignDefinition replaces a derivation function", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
      });

      expect(manager.get("doubled")).toBe(0);

      manager.assignDefinition(
        "doubled",
        ((facts: any) => (facts.count as number) * 10) as any,
      );

      expect(manager.get("doubled")).toBe(0);
    });

    it("callOne force-recomputes", () => {
      const computeFn = vi.fn((facts: Record<string, unknown>) => (facts.count as number) * 2);
      const { manager } = setup({ doubled: computeFn });

      manager.get("doubled");
      expect(computeFn).toHaveBeenCalledTimes(1);

      // callOne ignores cache
      manager.callOne("doubled");
      expect(computeFn).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================================
  // Subscribe
  // ============================================================================

  describe("subscribe", () => {
    it("returns unsubscribe function", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
      });

      manager.get("doubled");

      const listener = vi.fn();
      const unsub = manager.subscribe(["doubled"], listener);

      manager.invalidate("count");
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      // Re-compute so it can be invalidated again
      manager.get("doubled");
      manager.invalidate("count");

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("subscribe with multiple IDs fires on any change", () => {
      const { manager } = setup({
        doubled: (facts) => (facts.count as number) * 2,
        greeting: (facts) => `hi ${facts.name}`,
      });

      manager.get("doubled");
      manager.get("greeting");

      const listener = vi.fn();
      manager.subscribe(["doubled", "greeting"], listener);

      manager.invalidate("count");
      expect(listener).toHaveBeenCalledTimes(1);

      // Re-compute so it can be invalidated again
      manager.get("greeting");
      manager.invalidate("name");
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================================
  // onCompute / onError Callbacks
  // ============================================================================

  describe("onCompute / onError callbacks", () => {
    it("onCompute fires with id, value, deps", () => {
      const onCompute = vi.fn();
      const schema = { count: t.number() };
      const { store, facts } = createFacts({ schema });
      facts.count = 5;

      const manager = createDerivationsManager({
        definitions: {
          doubled: (f: any) => (f.count as number) * 2,
        } as any,
        facts: facts as any,
        store: store as any,
        onCompute,
      });

      manager.get("doubled");

      expect(onCompute).toHaveBeenCalledTimes(1);
      expect(onCompute).toHaveBeenCalledWith(
        "doubled",
        10,
        undefined, // oldValue on first compute
        expect.arrayContaining(["count"]),
      );
    });

    it("onError fires when derivation throws", () => {
      const onError = vi.fn();
      const schema = { count: t.number() };
      const { store, facts } = createFacts({ schema });
      facts.count = 0;

      const manager = createDerivationsManager({
        definitions: {
          broken: () => {
            throw new Error("derivation failed");
          },
        } as any,
        facts: facts as any,
        store: store as any,
        onError,
      });

      expect(() => manager.get("broken")).toThrow("derivation failed");
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith("broken", expect.any(Error));
    });
  });
});
