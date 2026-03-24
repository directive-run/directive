import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Minimal module for SSR tests
function createTestModule() {
  return createModule("ssr-test", {
    schema: {
      facts: {
        userId: t.string(),
        name: t.string(),
        count: t.number(),
      },
      derivations: {
        displayName: t.string(),
        isAuthenticated: t.boolean(),
      },
      events: {},
      requirements: {},
    },
    init: (facts) => {
      facts.userId = "";
      facts.name = "";
      facts.count = 0;
    },
    derive: {
      displayName: (facts) => (facts.name as string) || "Anonymous",
      isAuthenticated: (facts) => (facts.userId as string) !== "",
    },
  });
}

describe("SSR", () => {
  describe("hydrate() before start() round-trip", () => {
    it("applies hydrated facts on start", async () => {
      const mod = createTestModule();
      const system = createSystem({ module: mod });

      await system.hydrate(async () => ({
        userId: "user-1",
        name: "Alice",
        count: 42,
      }));

      system.start();

      expect(system.facts.userId).toBe("user-1");
      expect(system.facts.name).toBe("Alice");
      expect(system.facts.count).toBe(42);

      system.stop();
      system.destroy();
    });

    it("hydrated facts take precedence over initialFacts", async () => {
      const mod = createTestModule();
      const system = createSystem({
        module: mod,
        initialFacts: { userId: "initial-user", name: "Bob", count: 10 },
      });

      await system.hydrate(async () => ({
        userId: "hydrated-user",
        name: "Alice",
      }));

      system.start();

      expect(system.facts.userId).toBe("hydrated-user");
      expect(system.facts.name).toBe("Alice");
      // count should come from initialFacts since hydrate didn't include it
      expect(system.facts.count).toBe(10);

      system.stop();
      system.destroy();
    });

    it("works with sync loader", async () => {
      const mod = createTestModule();
      const system = createSystem({ module: mod });

      await system.hydrate(() => ({
        userId: "sync-user",
        name: "Sync",
      }));

      system.start();

      expect(system.facts.userId).toBe("sync-user");
      expect(system.facts.name).toBe("Sync");

      system.stop();
      system.destroy();
    });
  });

  describe("hydrate() after start() throws", () => {
    it("throws when called after start", async () => {
      const mod = createTestModule();
      const system = createSystem({ module: mod });

      system.start();

      await expect(
        system.hydrate(async () => ({ userId: "late" })),
      ).rejects.toThrow("hydrate() must be called before start()");

      system.stop();
      system.destroy();
    });
  });

  describe("getSnapshot() → restore() round-trip", () => {
    it("restores facts from a snapshot into a running system", () => {
      const mod = createTestModule();

      // Create and populate the source system
      const source = createSystem({
        module: mod,
        initialFacts: { userId: "user-1", name: "Alice", count: 99 },
      });
      source.start();

      const snapshot = source.getSnapshot();

      source.stop();
      source.destroy();

      // Create a new system, start it, then restore
      const target = createSystem({ module: mod });
      target.start();
      target.restore(snapshot);

      expect(target.facts.userId).toBe("user-1");
      expect(target.facts.name).toBe("Alice");
      expect(target.facts.count).toBe(99);

      target.stop();
      target.destroy();
    });
  });

  describe("settle() timeout behavior", () => {
    it("resolves when system has no async work", async () => {
      const mod = createTestModule();
      const system = createSystem({
        module: mod,
        initialFacts: { userId: "user-1", name: "Alice" },
      });
      system.start();

      // Should resolve immediately with no pending resolvers
      await system.settle(100);

      system.stop();
      system.destroy();
    });

    it("settle() with timeout rejects on slow resolvers", async () => {
      const slowModule = createModule("slow", {
        schema: {
          facts: {
            status: t.string(),
            data: t.string(),
          },
          derivations: {},
          events: {},
          requirements: {
            SLOW_FETCH: {},
          },
        },
        init: (facts) => {
          facts.status = "pending";
          facts.data = "";
        },
        constraints: {
          fetchData: {
            when: (facts) => facts.status === "pending",
            require: { type: "SLOW_FETCH" },
          },
        },
        resolvers: {
          slowFetch: {
            requirement: "SLOW_FETCH",
            resolve: async (_req, context) => {
              // Simulate a very slow resolver
              await new Promise((resolve) => setTimeout(resolve, 10000));
              context.facts.status = "done";
              context.facts.data = "fetched";
            },
          },
        },
      });

      const system = createSystem({ module: slowModule });
      system.start();

      await expect(system.settle(50)).rejects.toThrow();

      system.stop();
      system.destroy();
    });
  });

  describe("isPrototypeSafe validation in single-module hydrate()", () => {
    it("skips hydrated facts with __proto__ key", async () => {
      const mod = createTestModule();
      const system = createSystem({ module: mod });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await system.hydrate(async () => {
        // Build object with __proto__ key without triggering literal __proto__ assignment
        const obj = Object.create(null);
        obj.__proto__ = { malicious: true };
        obj.userId = "evil";

        return obj;
      });

      system.start();

      // Facts should NOT have been applied
      expect(system.facts.userId).toBe("");

      warnSpy.mockRestore();
      system.stop();
      system.destroy();
    });

    it("skips hydrated facts with constructor key", async () => {
      const mod = createTestModule();
      const system = createSystem({ module: mod });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await system.hydrate(async () => {
        const obj = Object.create(null);
        obj.constructor = { prototype: { malicious: true } };
        obj.userId = "evil";

        return obj;
      });

      system.start();

      // Facts should NOT have been applied
      expect(system.facts.userId).toBe("");

      warnSpy.mockRestore();
      system.stop();
      system.destroy();
    });

    it("top-level isPrototypeSafe throws for initialFacts with dangerous keys", () => {
      const mod = createTestModule();

      const dangerousFacts = Object.create(null);
      dangerousFacts.__proto__ = { malicious: true };
      dangerousFacts.userId = "evil";

      expect(() => {
        createSystem({
          module: mod,
          initialFacts: dangerousFacts,
        });
      }).toThrow("potentially dangerous keys");
    });

    it("allows clean hydrated facts", async () => {
      const mod = createTestModule();
      const system = createSystem({ module: mod });

      await system.hydrate(async () => ({
        userId: "safe-user",
        name: "Safe",
        count: 7,
      }));

      system.start();

      expect(system.facts.userId).toBe("safe-user");
      expect(system.facts.name).toBe("Safe");
      expect(system.facts.count).toBe(7);

      system.stop();
      system.destroy();
    });
  });

  describe("server-side lifecycle", () => {
    it("full SSR lifecycle: create → start → settle → snapshot → destroy", async () => {
      const mod = createTestModule();
      const system = createSystem({
        module: mod,
        initialFacts: { userId: "ssr-user", name: "Server", count: 1 },
      });
      system.start();
      await system.settle();

      const snapshot = system.getSnapshot();
      expect(snapshot).toBeDefined();

      system.stop();
      system.destroy();

      // Verify the snapshot can hydrate a new system
      const client = createSystem({ module: mod });
      client.start();
      client.restore(snapshot);

      expect(client.facts.userId).toBe("ssr-user");
      expect(client.facts.name).toBe("Server");

      client.stop();
      client.destroy();
    });

    it("distributable snapshot round-trip", async () => {
      const mod = createTestModule();
      const system = createSystem({
        module: mod,
        initialFacts: { userId: "dist-user", name: "Dist" },
      });
      system.start();
      await system.settle();

      const snapshot = system.getDistributableSnapshot({
        includeDerivations: ["displayName", "isAuthenticated"],
        ttlSeconds: 300,
      });

      expect(snapshot.data.displayName).toBe("Dist");
      expect(snapshot.data.isAuthenticated).toBe(true);
      expect(snapshot.expiresAt).toBeDefined();

      system.stop();
      system.destroy();
    });
  });
});
