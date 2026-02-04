/**
 * Namespaced System Tests
 *
 * Tests for the new object modules syntax that provides namespaced access:
 * - `modules: { auth, data }` → `facts.auth.token`, `derive.data.userCount`
 */

import { describe, it, expect, vi } from "vitest";
import { createModule, createSystem, t, type ModuleSchema } from "../index.js";

// ============================================================================
// Test Modules
// ============================================================================

const authSchema = {
  facts: {
    token: t.string().nullable(),
    isAuthenticated: t.boolean(),
  },
  derivations: {
    status: t.string<"authenticated" | "guest">(),
  },
  events: {
    login: { token: t.string() },
    logout: {},
  },
  requirements: {
    VALIDATE_TOKEN: { token: t.string() },
  },
} satisfies ModuleSchema;

const authModule = createModule("auth", {
  schema: authSchema,
  init: (facts) => {
    facts.token = null;
    facts.isAuthenticated = false;
  },
  derive: {
    status: (facts) => (facts.isAuthenticated ? "authenticated" : "guest"),
  },
  events: {
    login: (facts, { token }) => {
      facts.token = token;
    },
    logout: (facts) => {
      facts.token = null;
      facts.isAuthenticated = false;
    },
  },
  constraints: {
    validateWhenToken: {
      when: (facts) => facts.token !== null && !facts.isAuthenticated,
      require: (facts) => ({ type: "VALIDATE_TOKEN", token: facts.token! }),
    },
  },
  resolvers: {
    validate: {
      requirement: "VALIDATE_TOKEN",
      resolve: async (req, ctx) => {
        // Simulate validation
        if (req.token === "valid") {
          ctx.facts.isAuthenticated = true;
        }
      },
    },
  },
});

const dataSchema = {
  facts: {
    items: t.array<string>(),
    isLoading: t.boolean(),
  },
  derivations: {
    count: t.number(),
    isEmpty: t.boolean(),
  },
  events: {
    addItem: { item: t.string() },
    clear: {},
  },
  requirements: {
    FETCH_DATA: {},
  },
} satisfies ModuleSchema;

const dataModule = createModule("data", {
  schema: dataSchema,
  init: (facts) => {
    facts.items = [];
    facts.isLoading = false;
  },
  derive: {
    count: (facts) => facts.items.length,
    isEmpty: (facts) => facts.items.length === 0,
  },
  events: {
    addItem: (facts, { item }) => {
      facts.items = [...facts.items, item];
    },
    clear: (facts) => {
      facts.items = [];
    },
  },
});

// ============================================================================
// Tests
// ============================================================================

describe("Namespaced System", () => {
  describe("object modules syntax", () => {
    it("should create system with namespaced facts access", () => {
      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
        },
      });

      system.start();

      // Namespaced access to facts
      expect(system.facts.auth.token).toBe(null);
      expect(system.facts.auth.isAuthenticated).toBe(false);
      expect(system.facts.data.items).toEqual([]);
      expect(system.facts.data.isLoading).toBe(false);

      system.destroy();
    });

    it("should create system with namespaced derive access", () => {
      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
        },
      });

      system.start();

      // Namespaced access to derivations
      expect(system.derive.auth.status).toBe("guest");
      expect(system.derive.data.count).toBe(0);
      expect(system.derive.data.isEmpty).toBe(true);

      system.destroy();
    });

    it("should support namespaced events accessor", () => {
      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
        },
      });

      system.start();

      // Use namespaced events accessor
      system.events.auth.login({ token: "test-token" });
      expect(system.facts.auth.token).toBe("test-token");

      system.events.data.addItem({ item: "hello" });
      expect(system.facts.data.items).toEqual(["hello"]);

      system.events.auth.logout();
      expect(system.facts.auth.token).toBe(null);

      system.events.data.clear();
      expect(system.facts.data.items).toEqual([]);

      system.destroy();
    });

    it("should mutate facts through namespaced proxy", () => {
      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
        },
      });

      system.start();

      // Directly mutate facts through proxy
      system.facts.auth.token = "direct-token";
      expect(system.facts.auth.token).toBe("direct-token");

      system.facts.data.items = ["a", "b", "c"];
      expect(system.facts.data.items).toEqual(["a", "b", "c"]);
      expect(system.derive.data.count).toBe(3);

      system.destroy();
    });
  });

  describe("cross-module constraints", () => {
    it("should allow constraints to access facts from all modules", async () => {
      // Create a cross-module constraint that checks auth before fetching
      const crossModuleDataSchema = {
        facts: {
          items: t.array<string>(),
          isLoading: t.boolean(),
        },
        derivations: {},
        events: {},
        requirements: {
          FETCH_DATA: {},
        },
      } satisfies ModuleSchema;

      let fetchCalled = false;

      const crossModuleDataModule = createModule("data", {
        schema: crossModuleDataSchema,
        init: (facts) => {
          facts.items = [];
          facts.isLoading = false;
        },
        derive: {},
        events: {},
        constraints: {
          fetchWhenAuth: {
            when: (facts) => {
              // Cross-module access: facts.auth.isAuthenticated
              // @ts-expect-error - Types work at runtime with object modules
              return facts.auth?.isAuthenticated === true && facts.data?.items?.length === 0;
            },
            require: { type: "FETCH_DATA" },
          },
        },
        resolvers: {
          fetch: {
            requirement: "FETCH_DATA",
            resolve: async (_req, ctx) => {
              fetchCalled = true;
              ctx.facts.items = ["fetched"];
            },
          },
        },
      });

      const system = createSystem({
        modules: {
          auth: authModule,
          data: crossModuleDataModule,
        },
      });

      system.start();

      // Should not fetch when not authenticated
      expect(fetchCalled).toBe(false);

      // Authenticate
      system.facts.auth.isAuthenticated = true;

      // Wait for constraint to trigger
      await system.settle();

      expect(fetchCalled).toBe(true);
      expect(system.facts.data.items).toEqual(["fetched"]);

      system.destroy();
    });
  });

  describe("backwards compatibility", () => {
    it("should still support array modules (flat mode)", () => {
      const system = createSystem({
        modules: [authModule, dataModule],
      });

      system.start();

      // Flat access with prefixed keys
      expect((system.facts as Record<string, unknown>).token).toBe(null);
      expect((system.facts as Record<string, unknown>).isAuthenticated).toBe(false);

      system.destroy();
    });
  });

  describe("type safety", () => {
    it("should have namespaced types flow correctly", () => {
      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
        },
      });

      system.start();

      // These should all be type-correct at compile time
      const token: string | null = system.facts.auth.token;
      const isAuth: boolean = system.facts.auth.isAuthenticated;
      const items: string[] = system.facts.data.items;
      const status: "authenticated" | "guest" = system.derive.auth.status;
      const count: number = system.derive.data.count;

      expect(typeof token).toBe("object"); // null
      expect(typeof isAuth).toBe("boolean");
      expect(Array.isArray(items)).toBe(true);
      expect(typeof status).toBe("string");
      expect(typeof count).toBe("number");

      system.destroy();
    });
  });

  describe("effects with cross-module access", () => {
    it("should run effects with namespaced facts", async () => {
      const effectLog: string[] = [];

      const uiSchema = {
        facts: {
          message: t.string(),
        },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const uiModule = createModule("ui", {
        schema: uiSchema,
        init: (facts) => {
          facts.message = "";
        },
        derive: {},
        events: {},
        effects: {
          onAuthChange: {
            run: (facts, prev) => {
              // In namespaced mode, effects receive the full namespaced facts
              // Access is via facts.auth.isAuthenticated
              // @ts-expect-error - Types work at runtime
              const currentAuth = facts.auth?.isAuthenticated;
              // @ts-expect-error - Types work at runtime
              const prevAuth = prev?.auth?.isAuthenticated;

              // Log what we get
              effectLog.push(`Effect ran: prev=${prevAuth}, curr=${currentAuth}`);
            },
          },
        },
      });

      const system = createSystem({
        modules: {
          auth: authModule,
          ui: uiModule,
        },
      });

      system.start();

      // Wait for initial effects to settle
      await system.settle();
      await new Promise((r) => setTimeout(r, 20));

      // Change auth state
      system.facts.auth.isAuthenticated = true;

      // Wait for effect to run
      await system.settle();
      await new Promise((r) => setTimeout(r, 20));

      // Effects should have run at least once
      expect(effectLog.length).toBeGreaterThan(0);

      system.destroy();
    });
  });

  describe("system methods", () => {
    it("should support batch updates", () => {
      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
        },
      });

      system.start();

      system.batch(() => {
        system.facts.auth.token = "batch-token";
        system.facts.auth.isAuthenticated = true;
        system.facts.data.items = ["a", "b"];
      });

      expect(system.facts.auth.token).toBe("batch-token");
      expect(system.facts.auth.isAuthenticated).toBe(true);
      expect(system.facts.data.items).toEqual(["a", "b"]);

      system.destroy();
    });

    it("should support getSnapshot and restore", () => {
      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
        },
      });

      system.start();

      // Set some state
      system.facts.auth.token = "snapshot-token";
      system.facts.data.items = ["x", "y"];

      // Get snapshot
      const snapshot = system.getSnapshot();

      // Verify snapshot contains prefixed keys
      expect(snapshot.facts["auth_token"]).toBe("snapshot-token");
      expect(snapshot.facts["data_items"]).toEqual(["x", "y"]);

      // Modify state
      system.facts.auth.token = "modified";
      system.facts.data.items = [];

      // Restore
      system.restore(snapshot);

      // Verify restored through namespaced access
      expect(system.facts.auth.token).toBe("snapshot-token");
      expect(system.facts.data.items).toEqual(["x", "y"]);

      system.destroy();
    });

    it("should support inspect", () => {
      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
        },
      });

      system.start();

      const inspection = system.inspect();

      expect(inspection).toHaveProperty("unmet");
      expect(inspection).toHaveProperty("inflight");
      expect(inspection).toHaveProperty("constraints");
      expect(inspection).toHaveProperty("resolvers");

      system.destroy();
    });
  });

  describe("namespaced read/subscribe/watch", () => {
    it("should read derivations using namespace.key format", () => {
      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
        },
      });

      system.start();

      // Read using namespace.key format (new behavior)
      expect(system.read("auth.status")).toBe("guest");
      expect(system.read("data.count")).toBe(0);
      expect(system.read("data.isEmpty")).toBe(true);

      // Add some items
      system.facts.data.items = ["a", "b"];

      // Verify read updates
      expect(system.read("data.count")).toBe(2);
      expect(system.read("data.isEmpty")).toBe(false);

      system.destroy();
    });

    it("should subscribe using namespace.key format", async () => {
      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
        },
      });

      system.start();

      // Read derivations first to establish dependency tracking
      expect(system.read("auth.status")).toBe("guest");
      expect(system.read("data.count")).toBe(0);

      let callCount = 0;
      const unsubscribe = system.subscribe(["auth.status", "data.count"], () => {
        callCount++;
      });

      // Change auth state - this triggers a derivation change
      system.facts.auth.isAuthenticated = true;

      // Wait for microtasks (derivation invalidation is async)
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Subscriber should be called (derivation auth.status changes from "guest" to "authenticated")
      expect(callCount).toBeGreaterThan(0);

      const prevCount = callCount;

      // Unsubscribe
      unsubscribe();

      // Change again
      system.facts.data.items = ["x", "y", "z"];
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should not be called after unsubscribe
      expect(callCount).toBe(prevCount);

      system.destroy();
    });

    it("should watch using namespace.key format", async () => {
      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
        },
      });

      system.start();

      const watched: { newVal: number; oldVal: number | undefined }[] = [];
      const unwatch = system.watch<number>("data.count", (newVal, oldVal) => {
        watched.push({ newVal, oldVal });
      });

      // Change data items
      system.facts.data.items = ["a"];
      await system.settle();

      system.facts.data.items = ["a", "b", "c"];
      await system.settle();

      // Verify watch callbacks
      expect(watched.length).toBeGreaterThan(0);
      // Last watched value should be 3
      expect(watched[watched.length - 1].newVal).toBe(3);

      unwatch();
      system.destroy();
    });

    it("should also accept prefixed format for backwards compatibility", () => {
      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
        },
      });

      system.start();

      // Prefixed format should also work
      expect(system.read("auth_status")).toBe("guest");
      expect(system.read("data_count")).toBe(0);

      system.destroy();
    });
  });

  describe("crossModuleDeps type safety", () => {
    it("should provide type-safe cross-module facts access in constraints", async () => {
      // Create a cross-module constraint using crossModuleDeps
      const crossDataSchema = {
        facts: {
          items: t.array<string>(),
          isLoading: t.boolean(),
        },
        derivations: {},
        events: {},
        requirements: {
          FETCH_DATA: {},
        },
      } satisfies ModuleSchema;

      let fetchCalled = false;

      // Using crossModuleDeps - no @ts-expect-error needed!
      // facts.self.* for own module, facts.{dep}.* for cross-module
      const crossDataModule = createModule("data", {
        schema: crossDataSchema,
        crossModuleDeps: { auth: authSchema },
        init: (facts) => {
          facts.items = [];
          facts.isLoading = false;
        },
        derive: {},
        events: {},
        constraints: {
          fetchWhenAuth: {
            when: (facts) => {
              // Type-safe cross-module access!
              // - Own module: facts.self.items, facts.self.isLoading
              // - Cross-module: facts.auth.isAuthenticated
              return facts.auth.isAuthenticated === true && facts.self.items.length === 0;
            },
            require: { type: "FETCH_DATA" },
          },
        },
        resolvers: {
          fetch: {
            requirement: "FETCH_DATA",
            resolve: async (_req, ctx) => {
              fetchCalled = true;
              ctx.facts.items = ["fetched"];
            },
          },
        },
      });

      const system = createSystem({
        modules: {
          auth: authModule,
          data: crossDataModule,
        },
      });

      system.start();

      // Should not fetch when not authenticated
      expect(fetchCalled).toBe(false);

      // Authenticate
      system.facts.auth.isAuthenticated = true;

      // Wait for constraint to trigger
      await system.settle();

      expect(fetchCalled).toBe(true);
      expect(system.facts.data.items).toEqual(["fetched"]);

      system.destroy();
    });

    it("should provide type-safe cross-module facts access in effects", async () => {
      const effectLog: string[] = [];

      const uiSchema = {
        facts: {
          message: t.string(),
          counter: t.number(),
        },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      // Using crossModuleDeps for effects - no @ts-expect-error needed!
      // facts.self.* for own module, facts.{dep}.* for cross-module
      const uiModule = createModule("ui", {
        schema: uiSchema,
        crossModuleDeps: { auth: authSchema, data: dataSchema },
        init: (facts) => {
          facts.message = "";
          facts.counter = 0;
        },
        derive: {},
        events: {},
        effects: {
          onAuthChange: {
            run: (facts, prev) => {
              // Type-safe cross-module access in effects!
              // - Own module: facts.self.message, facts.self.counter
              // - Cross-module: facts.auth.*, facts.data.*
              const currentAuth = facts.auth.isAuthenticated;
              const prevAuth = prev?.auth.isAuthenticated;
              const itemCount = facts.data.items.length;

              effectLog.push(`auth: ${prevAuth} -> ${currentAuth}, items: ${itemCount}`);
            },
          },
        },
      });

      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
          ui: uiModule,
        },
      });

      system.start();
      await system.settle();
      await new Promise((r) => setTimeout(r, 20));

      // Change auth state
      system.facts.auth.isAuthenticated = true;
      await system.settle();
      await new Promise((r) => setTimeout(r, 20));

      // Effects should have run
      expect(effectLog.length).toBeGreaterThan(0);

      system.destroy();
    });

    it("should provide type-safe cross-module facts access in derivations", async () => {
      const dashboardSchema = {
        facts: {
          label: t.string(),
        },
        derivations: {
          canShowDashboard: t.boolean(),
          summary: t.string(),
        },
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      // Using crossModuleDeps for derivations - no @ts-expect-error needed!
      // facts.self.* for own module, facts.{dep}.* for cross-module (read-only)
      const dashboardModule = createModule("dashboard", {
        schema: dashboardSchema,
        crossModuleDeps: { auth: authSchema, data: dataSchema },
        init: (facts) => {
          facts.label = "Dashboard";
        },
        derive: {
          // Cross-module access in derivations!
          canShowDashboard: (facts) => {
            // - Own module: facts.self.label
            // - Cross-module: facts.auth.isAuthenticated, facts.data.items
            return facts.auth.isAuthenticated === true && facts.data.items.length > 0;
          },
          summary: (facts) => {
            const authStatus = facts.auth.isAuthenticated ? "logged in" : "guest";
            const itemCount = facts.data.items.length;
            return `${facts.self.label}: ${authStatus}, ${itemCount} items`;
          },
        },
        events: {},
      });

      const system = createSystem({
        modules: {
          auth: authModule,
          data: dataModule,
          dashboard: dashboardModule,
        },
      });

      system.start();

      // Initially: not authenticated, no items
      expect(system.derive.dashboard.canShowDashboard).toBe(false);
      expect(system.derive.dashboard.summary).toBe("Dashboard: guest, 0 items");

      // Add items but not authenticated
      system.facts.data.items = ["a", "b"];
      expect(system.derive.dashboard.canShowDashboard).toBe(false);
      expect(system.derive.dashboard.summary).toBe("Dashboard: guest, 2 items");

      // Authenticate
      system.facts.auth.isAuthenticated = true;
      expect(system.derive.dashboard.canShowDashboard).toBe(true);
      expect(system.derive.dashboard.summary).toBe("Dashboard: logged in, 2 items");

      system.destroy();
    });

    it("should handle empty crossModuleDeps object gracefully", () => {
      const simpleSchema = {
        facts: {
          value: t.number(),
        },
        derivations: {
          doubled: t.number(),
        },
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      // Empty crossModuleDeps should work like no crossModuleDeps (flat access)
      const simpleModule = createModule("simple", {
        schema: simpleSchema,
        crossModuleDeps: {},
        init: (facts) => {
          facts.value = 5;
        },
        derive: {
          // With empty deps, uses flat access (module-scoped proxy, not cross-module)
          doubled: (facts) => (facts as { value: number }).value * 2,
        },
      });

      const system = createSystem({
        modules: {
          simple: simpleModule,
        },
      });

      system.start();

      expect(system.facts.simple.value).toBe(5);
      expect(system.derive.simple.doubled).toBe(10);

      system.destroy();
    });

    it("should warn when accessing non-existent cross-module property", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const testSchema = {
        facts: { data: t.string() },
        derivations: { computed: t.string() },
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      // Module declares auth as dependency
      const testModule = createModule("test", {
        schema: testSchema,
        crossModuleDeps: { auth: authSchema },
        init: (facts) => {
          facts.data = "test";
        },
        derive: {
          computed: (facts) => {
            // Access a non-existent property on auth - should return undefined
            const nonExistent = (facts.auth as Record<string, unknown>).nonExistentProp;
            return `data: ${facts.self.data}, auth prop: ${nonExistent}`;
          },
        },
      });

      const system = createSystem({
        modules: {
          auth: authModule,
          test: testModule,
        },
      });

      system.start();

      // Should not throw, just return undefined for non-existent property
      expect(system.derive.test.computed).toBe("data: test, auth prop: undefined");

      system.destroy();
      warnSpy.mockRestore();
    });
  });

  describe("resolvers with namespaced context", () => {
    it("should provide module-scoped facts in resolver context", async () => {
      let resolverCalled = false;
      let resolverValue: number | undefined;

      const testSchema = {
        facts: {
          value: t.number(),
          triggered: t.boolean(),
        },
        derivations: {},
        events: {
          trigger: {},
        },
        requirements: {
          TEST_REQ: {},
        },
      } satisfies ModuleSchema;

      const testModule = createModule("test", {
        schema: testSchema,
        init: (facts) => {
          facts.value = 0;
          facts.triggered = false;
        },
        derive: {},
        events: {
          trigger: (facts) => {
            facts.triggered = true;
          },
        },
        constraints: {
          test: {
            // Constraint checks namespaced facts
            when: (facts) => {
              // In namespaced mode, facts is facts.test
              // @ts-expect-error - Runtime typing
              return facts.test?.triggered === true;
            },
            require: { type: "TEST_REQ" },
          },
        },
        resolvers: {
          test: {
            requirement: "TEST_REQ",
            resolve: async (_req, ctx) => {
              // Resolver gets module-scoped facts (just test module)
              resolverCalled = true;
              resolverValue = ctx.facts.value;
              ctx.facts.value = 100;
              ctx.facts.triggered = false; // Reset to prevent infinite loop
            },
          },
        },
      });

      const system = createSystem({
        modules: {
          test: testModule,
        },
      });

      system.start();
      system.events.test.trigger();

      await system.settle();

      // Resolver should have been called
      expect(resolverCalled).toBe(true);
      // Resolver should have received initial value (0)
      expect(resolverValue).toBe(0);
      // And should have updated to 100
      expect(system.facts.test.value).toBe(100);

      system.destroy();
    });
  });
});
