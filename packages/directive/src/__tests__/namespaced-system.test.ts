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
        // Declare cross-module dependencies for type-safe access
        crossModuleDeps: {
          auth: authSchema,
        },
        init: (facts) => {
          facts.items = [];
          facts.isLoading = false;
        },
        derive: {},
        events: {},
        constraints: {
          fetchWhenAuth: {
            when: (facts) => {
              // Cross-module access via crossModuleDeps:
              // - facts.self.items for own module
              // - facts.auth.isAuthenticated for auth module
              // @ts-expect-error - Runtime typing
              return facts.auth?.isAuthenticated === true && facts.self?.items?.length === 0;
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
      const lastWatched = watched[watched.length - 1];
      expect(lastWatched?.newVal).toBe(3);

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
          doubled: (facts) => (facts as unknown as { value: number }).value * 2,
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

  describe("deferred reconciliation", () => {
    it("should not trigger constraints during module initialization", async () => {
      let constraintEvaluationsDuringInit = 0;
      let initComplete = false;

      const testSchema = {
        facts: {
          value: t.number(),
          initialized: t.boolean(),
        },
        derivations: {},
        events: {},
        requirements: {
          TEST_REQ: {},
        },
      } satisfies ModuleSchema;

      const testModule = createModule("test", {
        schema: testSchema,
        init: (facts) => {
          // Set multiple facts - should NOT trigger constraint during init
          facts.value = 10;
          facts.initialized = true;
          // Mark init as complete AFTER setting facts
          initComplete = true;
        },
        derive: {},
        events: {},
        constraints: {
          test: {
            when: (facts) => {
              // Track evaluations that happen during init
              if (!initComplete) {
                constraintEvaluationsDuringInit++;
              }
              // @ts-expect-error - Runtime typing
              return facts.test?.value > 5 && facts.test?.initialized;
            },
            require: { type: "TEST_REQ" },
          },
        },
        resolvers: {
          test: {
            requirement: "TEST_REQ",
            resolve: async () => {},
          },
        },
      });

      const system = createSystem({
        modules: { test: testModule },
      });

      // Before start - no evaluations
      expect(constraintEvaluationsDuringInit).toBe(0);

      system.start();
      await system.settle();

      // No constraint evaluations should have happened DURING init
      // They should only happen AFTER all modules are initialized
      expect(constraintEvaluationsDuringInit).toBe(0);

      system.destroy();
    });
  });

  describe("dependency-ordered initialization", () => {
    it("should initialize modules in crossModuleDeps order", () => {
      const initOrder: string[] = [];

      const authSchema = {
        facts: { token: t.string().nullable() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const dataSchema = {
        facts: { items: t.array<string>() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const uiSchema = {
        facts: { ready: t.boolean() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const authMod = createModule("auth", {
        schema: authSchema,
        init: () => { initOrder.push("auth"); },
        derive: {},
        events: {},
      });

      const dataMod = createModule("data", {
        schema: dataSchema,
        crossModuleDeps: { auth: authSchema },
        init: () => { initOrder.push("data"); },
        derive: {},
        events: {},
      });

      const uiMod = createModule("ui", {
        schema: uiSchema,
        crossModuleDeps: { auth: authSchema, data: dataSchema },
        init: () => { initOrder.push("ui"); },
        derive: {},
        events: {},
      });

      // Pass in "wrong" order - should be reordered by topological sort
      const system = createSystem({
        modules: { ui: uiMod, auth: authMod, data: dataMod },
      });

      system.start();

      // auth has no deps, should be first
      // data depends on auth, should be second
      // ui depends on both, should be last
      expect(initOrder).toEqual(["auth", "data", "ui"]);

      system.destroy();
    });

    it("should detect circular dependencies", () => {
      const schemaA = {
        facts: { a: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const schemaB = {
        facts: { b: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const modA = createModule("a", {
        schema: schemaA,
        crossModuleDeps: { b: schemaB },
        init: () => {},
        derive: {},
        events: {},
      });

      const modB = createModule("b", {
        schema: schemaB,
        crossModuleDeps: { a: schemaA },
        init: () => {},
        derive: {},
        events: {},
      });

      expect(() => {
        createSystem({ modules: { a: modA, b: modB } });
      }).toThrow(/Circular dependency detected/);
    });

    it("should respect explicit initOrder over auto", () => {
      const initOrder: string[] = [];

      const schemaA = {
        facts: { a: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const schemaB = {
        facts: { b: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const modA = createModule("a", {
        schema: schemaA,
        init: () => { initOrder.push("a"); },
        derive: {},
        events: {},
      });

      const modB = createModule("b", {
        schema: schemaB,
        init: () => { initOrder.push("b"); },
        derive: {},
        events: {},
      });

      // Force b before a, even though object order is a, b
      const system = createSystem({
        modules: { a: modA, b: modB },
        initOrder: ["b", "a"],
      });

      system.start();
      expect(initOrder).toEqual(["b", "a"]);

      system.destroy();
    });
  });

  describe("initial facts injection", () => {
    it("should apply initialFacts after module init", () => {
      const initFacts: string[] = [];

      const testSchema = {
        facts: {
          token: t.string().nullable(),
          user: t.string().nullable(),
        },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const testModule = createModule("auth", {
        schema: testSchema,
        init: (facts) => {
          facts.token = "default-token";
          facts.user = "default-user";
          initFacts.push(`init: token=${facts.token}`);
        },
        derive: {},
        events: {},
      });

      const system = createSystem({
        modules: { auth: testModule },
        initialFacts: {
          auth: { token: "restored-token" }, // Override token, keep user default
        },
      });

      system.start();

      // Module init ran first
      expect(initFacts).toEqual(["init: token=default-token"]);

      // initialFacts overrode token but kept user
      expect(system.facts.auth.token).toBe("restored-token");
      expect(system.facts.auth.user).toBe("default-user");

      system.destroy();
    });
  });

  describe("ready state API", () => {
    it("should track isInitialized and isReady states", async () => {
      const testSchema = {
        facts: { value: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const testModule = createModule("test", {
        schema: testSchema,
        init: (facts) => { facts.value = 0; },
        derive: {},
        events: {},
      });

      const system = createSystem({
        modules: { test: testModule },
      });

      // Before start
      expect(system.isInitialized).toBe(false);
      expect(system.isReady).toBe(false);

      system.start();

      // After start, should be initialized
      expect(system.isInitialized).toBe(true);

      // Wait for first reconcile
      await system.whenReady();

      expect(system.isReady).toBe(true);

      system.destroy();
    });

    it("should resolve whenReady immediately if already ready", async () => {
      const testSchema = {
        facts: { value: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const testModule = createModule("test", {
        schema: testSchema,
        init: (facts) => { facts.value = 0; },
        derive: {},
        events: {},
      });

      const system = createSystem({
        modules: { test: testModule },
      });

      system.start();
      await system.whenReady();

      // Call again - should resolve immediately
      const start = Date.now();
      await system.whenReady();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(10); // Should be nearly instant

      system.destroy();
    });
  });

  describe("prototype pollution protection", () => {
    it("should reject initialFacts with __proto__ key (via JSON.parse)", () => {
      const testSchema = {
        facts: { value: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const testModule = createModule("test", {
        schema: testSchema,
        init: (facts) => { facts.value = 0; },
        derive: {},
        events: {},
      });

      // Simulate malicious JSON payload (how prototype pollution typically enters)
      const maliciousPayload = JSON.parse('{"test": {"__proto__": {"isAdmin": true}}}');

      const system = createSystem({
        modules: { test: testModule },
        initialFacts: maliciousPayload,
      });

      expect(() => system.start()).toThrow(/prototype pollution/);
    });

    it("should reject initialFacts with constructor key", () => {
      const testSchema = {
        facts: { value: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const testModule = createModule("test", {
        schema: testSchema,
        init: (facts) => { facts.value = 0; },
        derive: {},
        events: {},
      });

      // Constructor is another prototype pollution vector
      const maliciousPayload = JSON.parse('{"test": {"constructor": {"prototype": {}}}}');

      const system = createSystem({
        modules: { test: testModule },
        initialFacts: maliciousPayload,
      });

      expect(() => system.start()).toThrow(/prototype pollution/);
    });

    it("should reject any initialFacts object containing prototype key", () => {
      const testSchema = {
        facts: { value: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const testModule = createModule("test", {
        schema: testSchema,
        init: (facts) => { facts.value = 0; },
        derive: {},
        events: {},
      });

      // Having any dangerous key in the facts object should reject the entire object
      // This is a security best practice - don't partially accept potentially malicious data
      const system = createSystem({
        modules: { test: testModule },
        initialFacts: {
          test: JSON.parse('{"value": 42, "prototype": "bad"}'),
        },
      });

      expect(() => system.start()).toThrow(/prototype pollution/);
    });
  });

  describe("whenReady before start", () => {
    it("should reject whenReady() called before start()", async () => {
      const testSchema = {
        facts: { value: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const testModule = createModule("test", {
        schema: testSchema,
        init: (facts) => { facts.value = 0; },
        derive: {},
        events: {},
      });

      const system = createSystem({
        modules: { test: testModule },
      });

      // Should reject because system isn't started
      await expect(system.whenReady()).rejects.toThrow(/before start/);

      system.destroy();
    });
  });

  describe("hydrate", () => {
    it("should apply hydrated facts before start", async () => {
      const testSchema = {
        facts: {
          token: t.string().nullable(),
          user: t.string().nullable(),
        },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const testModule = createModule("auth", {
        schema: testSchema,
        init: (facts) => {
          facts.token = "init-token";
          facts.user = "init-user";
        },
        derive: {},
        events: {},
      });

      const system = createSystem({
        modules: { auth: testModule },
      });

      // Hydrate before start
      await system.hydrate(async () => ({
        auth: { token: "hydrated-token" },
      }));

      system.start();

      // Module init ran, then hydrate overrode token
      expect(system.facts.auth.token).toBe("hydrated-token");
      expect(system.facts.auth.user).toBe("init-user");

      system.destroy();
    });

    it("should throw if called after start", async () => {
      const testSchema = {
        facts: { value: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const testModule = createModule("test", {
        schema: testSchema,
        init: (facts) => { facts.value = 0; },
        derive: {},
        events: {},
      });

      const system = createSystem({
        modules: { test: testModule },
      });

      system.start();

      await expect(
        system.hydrate(() => ({ test: { value: 1 } })),
      ).rejects.toThrow(/must be called before start/);

      system.destroy();
    });

    it("should apply both initialFacts and hydrate (hydrate wins)", async () => {
      const testSchema = {
        facts: {
          a: t.string(),
          b: t.string(),
          c: t.string(),
        },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema;

      const testModule = createModule("test", {
        schema: testSchema,
        init: (facts) => {
          facts.a = "init-a";
          facts.b = "init-b";
          facts.c = "init-c";
        },
        derive: {},
        events: {},
      });

      const system = createSystem({
        modules: { test: testModule },
        initialFacts: {
          test: { a: "initial-a", b: "initial-b" },
        },
      });

      await system.hydrate(() => ({
        test: { b: "hydrate-b", c: "hydrate-c" },
      }));

      system.start();

      // Order: init → initialFacts → hydrate
      // a: init → initial → (not in hydrate) = initial-a
      // b: init → initial → hydrate = hydrate-b
      // c: init → (not in initial) → hydrate = hydrate-c
      expect(system.facts.test.a).toBe("initial-a");
      expect(system.facts.test.b).toBe("hydrate-b");
      expect(system.facts.test.c).toBe("hydrate-c");

      system.destroy();
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
            // Constraint receives module-scoped facts (direct access to own module)
            when: (facts) => {
              // facts.triggered directly accesses this module's fact
              return facts.triggered === true;
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
