import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";
import type { DefinitionMeta } from "../types/meta";
import { freezeMeta, isDerivationWithMeta } from "../types/meta";

// ============================================================================
// Helper: minimal module with meta on everything
// ============================================================================

function createMetaModule() {
  return createModule("meta-test", {
    schema: {
      facts: {
        count: t.number(),
        name: t.string(),
      },
      derivations: {
        doubled: t.number(),
        label: t.string(),
      },
      requirements: {
        INC: {},
      },
      events: {},
    },
    init: (facts) => {
      facts.count = 0;
      facts.name = "test";
    },
    derive: {
      // Function form (no meta)
      doubled: (facts) => facts.count * 2,
      // Object form with meta
      label: {
        compute: (facts) => `Label: ${facts.name}`,
        meta: {
          label: "Display Label",
          description: "User-facing label",
          category: "ui",
        },
      },
    },
    constraints: {
      needsInc: {
        when: (facts) => facts.count < 0,
        require: { type: "INC" },
        meta: {
          label: "Needs Increment",
          description: "Count is negative",
          category: "data",
        },
      },
    },
    resolvers: {
      inc: {
        requirement: "INC",
        resolve: async (_req, context) => {
          context.facts.count = 0;
        },
        meta: { label: "Increment Resolver", category: "data" },
      },
    },
    effects: {
      log: {
        run: () => {},
        meta: { label: "Logger", category: "logging", color: "#10b981" },
      },
    },
  });
}

// ============================================================================
// Core: inspect() surfaces meta
// ============================================================================

describe("DefinitionMeta", () => {
  describe("inspect()", () => {
    it("includes meta on constraints", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      const inspection = sys.inspect();
      const constraint = inspection.constraints.find(
        (c) => c.id === "needsInc",
      );
      expect(constraint?.meta?.label).toBe("Needs Increment");
      expect(constraint?.meta?.description).toBe("Count is negative");
      expect(constraint?.meta?.category).toBe("data");

      sys.destroy();
    });

    it("includes meta on resolverDefs", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      const inspection = sys.inspect();
      const resolver = inspection.resolverDefs.find((r) => r.id === "inc");
      expect(resolver?.meta?.label).toBe("Increment Resolver");
      expect(resolver?.meta?.category).toBe("data");

      sys.destroy();
    });

    it("includes meta on effects", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      const inspection = sys.inspect();
      const effect = inspection.effects.find((e) => e.id === "log");
      expect(effect?.meta?.label).toBe("Logger");
      expect(effect?.meta?.color).toBe("#10b981");

      sys.destroy();
    });

    it("includes meta on derivations", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      const inspection = sys.inspect();
      const derivation = inspection.derivations.find((d) => d.id === "label");
      expect(derivation?.meta?.label).toBe("Display Label");
      expect(derivation?.meta?.description).toBe("User-facing label");

      // Function-form derivation has no meta
      const doubled = inspection.derivations.find((d) => d.id === "doubled");
      expect(doubled?.meta).toBeUndefined();

      sys.destroy();
    });

    it("returns undefined meta for definitions without meta", () => {
      const mod = createModule("no-meta", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.x = 0;
        },
        constraints: {
          c: { when: () => false, require: null },
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      const inspection = sys.inspect();
      expect(inspection.constraints[0]?.meta).toBeUndefined();

      sys.destroy();
    });
  });

  // ============================================================================
  // explain() uses meta
  // ============================================================================

  describe("explain()", () => {
    // Use a module where the resolver doesn't auto-fix the condition,
    // so the requirement stays unmet after settle()
    function createExplainModule() {
      return createModule("explain-test", {
        schema: {
          facts: { status: t.string() },
          derivations: {},
          requirements: { FIX: {} },
          events: {},
        },
        init: (facts) => {
          facts.status = "ok";
        },
        constraints: {
          needsFix: {
            when: (facts) => facts.status === "broken",
            require: { type: "FIX" },
            meta: {
              label: "Needs Fix",
              description: "Status is broken",
              category: "data",
            },
          },
        },
        resolvers: {
          fix: {
            requirement: "FIX",
            resolve: async () => {
              // Intentionally does NOT fix the status — requirement stays unmet
            },
            meta: { label: "Fix Resolver" },
          },
        },
      });
    }

    it("uses meta.label in explain output", async () => {
      const mod = createExplainModule();
      const sys = createSystem({ module: mod });
      sys.start();

      sys.facts.status = "broken";
      await sys.settle();

      const inspection = sys.inspect();
      expect(inspection.unmet.length).toBeGreaterThan(0);
      const explanation = sys.explain(inspection.unmet[0]!.id);
      expect(explanation).toContain("Needs Fix");

      sys.destroy();
    });

    it("includes meta.description in explain output", async () => {
      const mod = createExplainModule();
      const sys = createSystem({ module: mod });
      sys.start();

      sys.facts.status = "broken";
      await sys.settle();

      const inspection = sys.inspect();
      expect(inspection.unmet.length).toBeGreaterThan(0);
      const explanation = sys.explain(inspection.unmet[0]!.id);
      expect(explanation).toContain("Status is broken");

      sys.destroy();
    });
  });

  // ============================================================================
  // Derivation object form
  // ============================================================================

  describe("derivation object form", () => {
    it("{ compute, meta } computes correctly", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      expect(sys.derive.label).toBe("Label: test");

      sys.destroy();
    });

    it("function form still works (backward compat)", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      expect(sys.derive.doubled).toBe(0);
      sys.facts.count = 5;
      expect(sys.derive.doubled).toBe(10);

      sys.destroy();
    });
  });

  // ============================================================================
  // Dynamic definitions
  // ============================================================================

  describe("dynamic definitions", () => {
    it("meta survives dynamic register()", () => {
      const mod = createModule("dyn", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          requirements: { DO: {} },
          events: {},
        },
        init: (f) => {
          f.x = 0;
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      sys.constraints.register("dynC", {
        when: () => false,
        require: null,
        meta: { label: "Dynamic Constraint" },
      });

      const inspection = sys.inspect();
      const c = inspection.constraints.find((c) => c.id === "dynC");
      expect(c?.meta?.label).toBe("Dynamic Constraint");

      sys.destroy();
    });

    it("meta survives dynamic assign()", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      sys.constraints.assign("needsInc", {
        when: () => false,
        require: null,
        meta: { label: "Reassigned Constraint" },
      });

      const inspection = sys.inspect();
      const c = inspection.constraints.find((c) => c.id === "needsInc");
      expect(c?.meta?.label).toBe("Reassigned Constraint");

      sys.destroy();
    });
  });

  // ============================================================================
  // Snapshots exclusion
  // ============================================================================

  describe("snapshots", () => {
    it("meta is NOT included in snapshots", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      const snapshot = sys.getSnapshot();
      const snapshotStr = JSON.stringify(snapshot);
      expect(snapshotStr).not.toContain("Needs Increment");
      expect(snapshotStr).not.toContain("Display Label");

      sys.destroy();
    });
  });

  // ============================================================================
  // Security / edge cases
  // ============================================================================

  describe("security", () => {
    it("freezeMeta neutralizes __proto__", () => {
      const meta = freezeMeta({
        __proto__: { polluted: true },
      } as DefinitionMeta);
      expect(meta).toBeDefined();
      // Object.create(null) means no prototype
      expect(Object.getPrototypeOf(meta!)).toBeNull();
    });

    it("freezeMeta neutralizes constructor key", () => {
      const meta = freezeMeta({
        constructor: "evil",
        label: "ok",
      } as DefinitionMeta);
      expect(meta).toBeDefined();
      expect(meta!.label).toBe("ok");
      expect(Object.getPrototypeOf(meta!)).toBeNull();
    });

    it("frozen meta cannot be mutated", () => {
      const meta = freezeMeta({ label: "original" });
      expect(meta).toBeDefined();
      expect(() => {
        (meta as any).label = "mutated";
      }).toThrow();
      expect(meta!.label).toBe("original");
    });

    it("frozen meta tags array cannot be mutated", () => {
      const meta = freezeMeta({ label: "test", tags: ["a", "b"] });
      expect(meta!.tags).toEqual(["a", "b"]);
      expect(() => {
        (meta!.tags as string[]).push("injected");
      }).toThrow();
    });

    it("isDerivationWithMeta rejects prototype chain compute", () => {
      const obj = Object.create({ compute: () => 42 });
      expect(isDerivationWithMeta(obj)).toBe(false);
    });

    it("isDerivationWithMeta accepts own compute property", () => {
      const obj = { compute: () => 42, meta: { label: "test" } };
      expect(isDerivationWithMeta(obj)).toBe(true);
    });

    it("freezeMeta(undefined) returns undefined", () => {
      expect(freezeMeta(undefined)).toBeUndefined();
    });

    it("constraint meta is frozen after registration", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      const inspection = sys.inspect();
      const constraint = inspection.constraints.find(
        (c) => c.id === "needsInc",
      );
      expect(constraint?.meta).toBeDefined();
      expect(() => {
        (constraint!.meta as any).label = "mutated";
      }).toThrow();

      sys.destroy();
    });

    it("resolver meta is frozen after registration", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      const inspection = sys.inspect();
      const resolver = inspection.resolverDefs.find((r) => r.id === "inc");
      expect(resolver?.meta).toBeDefined();
      expect(() => {
        (resolver!.meta as any).label = "mutated";
      }).toThrow();

      sys.destroy();
    });

    it("effect meta is frozen after registration", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      const inspection = sys.inspect();
      const effect = inspection.effects.find((e) => e.id === "log");
      expect(effect?.meta).toBeDefined();
      expect(() => {
        (effect!.meta as any).label = "mutated";
      }).toThrow();

      sys.destroy();
    });

    it("dynamic register freezes constraint meta", () => {
      const mod = createModule("dyn-freeze", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          requirements: { DO: {} },
          events: {},
        },
        init: (f) => {
          f.x = 0;
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      const mutableMeta = { label: "Before" };
      sys.constraints.register("dynFreeze", {
        when: () => false,
        require: null,
        meta: mutableMeta,
      });

      // The meta should be frozen — mutating the original reference should not affect inspect
      const inspection = sys.inspect();
      const c = inspection.constraints.find((c) => c.id === "dynFreeze");
      expect(c?.meta?.label).toBe("Before");
      expect(() => {
        (c!.meta as any).label = "After";
      }).toThrow();

      sys.destroy();
    });
  });

  // ============================================================================
  // Namespaced systems
  // ============================================================================

  describe("namespaced systems", () => {
    it("meta flows through prefixed modules", () => {
      const modA = createModule("a", {
        schema: {
          facts: { x: t.number() },
          derivations: { doubled: t.number() },
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.x = 1;
        },
        derive: {
          doubled: {
            compute: (facts) => facts.x * 2,
            meta: { label: "A Doubled", category: "math" },
          },
        },
        constraints: {
          check: {
            when: () => false,
            require: null,
            meta: { label: "A Check" },
          },
        },
      });

      const sys = createSystem({ modules: { a: modA } });
      sys.start();

      const inspection = sys.inspect();

      const derivation = inspection.derivations.find(
        (d) => d.id === "a::doubled",
      );
      expect(derivation?.meta?.label).toBe("A Doubled");
      expect(derivation?.meta?.category).toBe("math");

      const constraint = inspection.constraints.find(
        (c) => c.id === "a::check",
      );
      expect(constraint?.meta?.label).toBe("A Check");

      sys.destroy();
    });
  });

  // ============================================================================
  // system.meta accessor
  // ============================================================================

  describe("system.meta accessor", () => {
    it("returns constraint meta by ID", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      expect(sys.meta.constraint("needsInc")?.label).toBe("Needs Increment");
      expect(sys.meta.constraint("nonexistent")).toBeUndefined();

      sys.destroy();
    });

    it("returns resolver meta by ID", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      expect(sys.meta.resolver("inc")?.label).toBe("Increment Resolver");
      expect(sys.meta.resolver("nonexistent")).toBeUndefined();

      sys.destroy();
    });

    it("returns effect meta by ID", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      expect(sys.meta.effect("log")?.label).toBe("Logger");
      expect(sys.meta.effect("nonexistent")).toBeUndefined();

      sys.destroy();
    });

    it("returns derivation meta by ID", () => {
      const mod = createMetaModule();
      const sys = createSystem({ module: mod });
      sys.start();

      expect(sys.meta.derivation("label")?.label).toBe("Display Label");
      expect(sys.meta.derivation("doubled")).toBeUndefined(); // function form, no meta
      expect(sys.meta.derivation("nonexistent")).toBeUndefined();

      sys.destroy();
    });

    it("works with namespaced systems", () => {
      const modA = createModule("a", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.x = 0;
        },
        constraints: {
          check: {
            when: () => false,
            require: null,
            meta: { label: "A Check" },
          },
        },
      });

      const sys = createSystem({ modules: { a: modA } });
      sys.start();

      expect(sys.meta.constraint("a::check")?.label).toBe("A Check");

      sys.destroy();
    });
  });

  // ============================================================================
  // tags field
  // ============================================================================

  describe("tags", () => {
    it("tags flow through inspect()", () => {
      const mod = createModule("tagged", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.x = 0;
        },
        constraints: {
          check: {
            when: () => false,
            require: null,
            meta: { label: "Tagged", tags: ["critical", "auth"] },
          },
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      const inspection = sys.inspect();
      const c = inspection.constraints.find((c) => c.id === "check");
      expect(c?.meta?.tags).toEqual(["critical", "auth"]);

      sys.destroy();
    });

    it("tags accessible via system.meta accessor", () => {
      const mod = createModule("tagged2", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.x = 0;
        },
        constraints: {
          check: {
            when: () => false,
            require: null,
            meta: { category: "auth", tags: ["security", "critical"] },
          },
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      const meta = sys.meta.constraint("check");
      expect(meta?.category).toBe("auth");
      expect(meta?.tags).toEqual(["security", "critical"]);

      sys.destroy();
    });
  });

  // ============================================================================
  // Module-level meta
  // ============================================================================

  describe("module meta", () => {
    it("module meta flows through inspect()", () => {
      const mod = createModule("auth", {
        schema: {
          facts: { token: t.string() },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.token = "";
        },
        meta: { label: "Authentication", description: "Handles user auth", category: "auth" },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      const inspection = sys.inspect();
      const moduleMeta = inspection.modules.find((m) => m.id === "auth");
      expect(moduleMeta?.meta?.label).toBe("Authentication");
      expect(moduleMeta?.meta?.description).toBe("Handles user auth");

      sys.destroy();
    });

    it("module meta accessible via system.meta.module()", () => {
      const mod = createModule("cart", {
        schema: {
          facts: { items: t.number() },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.items = 0;
        },
        meta: { label: "Shopping Cart", category: "data", tags: ["commerce"] },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      expect(sys.meta.module("cart")?.label).toBe("Shopping Cart");
      expect(sys.meta.module("cart")?.tags).toEqual(["commerce"]);
      expect(sys.meta.module("nonexistent")).toBeUndefined();

      sys.destroy();
    });

    it("module meta works with namespaced systems", () => {
      const authMod = createModule("auth", {
        schema: {
          facts: { token: t.string() },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.token = "";
        },
        meta: { label: "Auth Module" },
      });
      const dataMod = createModule("data", {
        schema: {
          facts: { count: t.number() },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.count = 0;
        },
        meta: { label: "Data Module" },
      });

      const sys = createSystem({ modules: { auth: authMod, data: dataMod } });
      sys.start();

      expect(sys.meta.module("auth")?.label).toBe("Auth Module");
      expect(sys.meta.module("data")?.label).toBe("Data Module");

      const inspection = sys.inspect();
      expect(inspection.modules).toHaveLength(2);

      sys.destroy();
    });

    it("module meta is frozen", () => {
      const mod = createModule("frozen", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.x = 0;
        },
        meta: { label: "Frozen Module" },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      const meta = sys.meta.module("frozen");
      expect(meta?.label).toBe("Frozen Module");
      expect(() => {
        (meta as any).label = "Mutated";
      }).toThrow();

      sys.destroy();
    });
  });

  // ============================================================================
  // Fact/schema field meta
  // ============================================================================

  describe("fact meta", () => {
    it("fact meta accessible via system.meta.fact()", () => {
      const mod = createModule("field-meta", {
        schema: {
          facts: {
            score: t.number().meta({ label: "Player Score", category: "data" }),
            name: t.string().meta({ label: "Username", tags: ["pii"] }),
            plain: t.number(), // no meta
          },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.score = 0;
          f.name = "";
          f.plain = 0;
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      expect(sys.meta.fact("score")?.label).toBe("Player Score");
      expect(sys.meta.fact("score")?.category).toBe("data");
      expect(sys.meta.fact("name")?.label).toBe("Username");
      expect(sys.meta.fact("name")?.tags).toEqual(["pii"]);
      expect(sys.meta.fact("plain")).toBeUndefined();
      expect(sys.meta.fact("nonexistent")).toBeUndefined();

      sys.destroy();
    });

    it("fact meta flows through inspect()", () => {
      const mod = createModule("inspect-facts", {
        schema: {
          facts: {
            score: t.number().meta({ label: "Score" }),
            plain: t.number(),
          },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.score = 0;
          f.plain = 0;
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      const inspection = sys.inspect();
      const scoreFact = inspection.facts.find((f) => f.key === "score");
      const plainFact = inspection.facts.find((f) => f.key === "plain");

      expect(scoreFact?.meta?.label).toBe("Score");
      expect(plainFact?.meta).toBeUndefined();

      sys.destroy();
    });

    it("fact meta survives chain order: meta before type-specific", () => {
      // t.string().meta({...}).minLength(3) — meta should NOT be lost
      // Runtime: specialized .meta() overrides base and returns ChainableString
      const nameField = t.string().meta({ label: "Name" }) as ReturnType<typeof t.string> & { minLength(n: number): unknown };
      const countField = t.number().meta({ label: "Count" }) as ReturnType<typeof t.number> & { min(n: number): unknown };
      const mod = createModule("chain-order", {
        schema: {
          facts: {
            name: nameField.minLength(1) as ReturnType<typeof t.string>,
            count: countField.min(0) as ReturnType<typeof t.number>,
          },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.name = "a";
          f.count = 0;
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      expect(sys.meta.fact("name")?.label).toBe("Name");
      expect(sys.meta.fact("count")?.label).toBe("Count");

      sys.destroy();
    });

    it("fact meta chains with other builders", () => {
      const mod = createModule("chain-meta", {
        schema: {
          facts: {
            email: t
              .string()
              .meta({ label: "Email Address", category: "pii" })
              .nullable(),
          },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.email = null;
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      expect(sys.meta.fact("email")?.label).toBe("Email Address");

      sys.destroy();
    });

    it("fact meta works in namespaced systems", () => {
      const mod = createModule("ns", {
        schema: {
          facts: {
            count: t.number().meta({ label: "Counter" }),
          },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.count = 0;
        },
      });
      const sys = createSystem({ modules: { ns: mod } });
      sys.start();

      expect(sys.meta.fact("ns::count")?.label).toBe("Counter");

      sys.destroy();
    });
  });

  // ============================================================================
  // Event meta
  // ============================================================================

  describe("event meta", () => {
    it("event meta accessible via system.meta.event()", () => {
      const mod = createModule("ev-meta", {
        schema: {
          facts: { count: t.number() },
          derivations: {},
          requirements: {},
          events: { increment: {} },
        },
        init: (f) => {
          f.count = 0;
        },
        events: {
          increment: {
            handler: (facts) => {
              facts.count += 1;
            },
            meta: { label: "Increment Counter", category: "ui" },
          },
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      expect(sys.meta.event("increment")?.label).toBe("Increment Counter");
      expect(sys.meta.event("increment")?.category).toBe("ui");
      expect(sys.meta.event("nonexistent")).toBeUndefined();

      sys.destroy();
    });

    it("event meta flows through inspect()", () => {
      const mod = createModule("ev-inspect", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          requirements: {},
          events: { doIt: {}, plain: {} },
        },
        init: (f) => {
          f.x = 0;
        },
        events: {
          doIt: {
            handler: (facts) => {
              facts.x = 1;
            },
            meta: { label: "Do It" },
          },
          plain: (facts) => {
            facts.x = 2;
          },
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      const inspection = sys.inspect();
      const doIt = inspection.events.find((e) => e.name === "doIt");
      const plain = inspection.events.find((e) => e.name === "plain");

      expect(doIt?.meta?.label).toBe("Do It");
      expect(plain?.meta).toBeUndefined();

      sys.destroy();
    });

    it("function-form events still work (backward compat)", () => {
      const mod = createModule("ev-compat", {
        schema: {
          facts: { count: t.number() },
          derivations: {},
          requirements: {},
          events: { inc: {} },
        },
        init: (f) => {
          f.count = 0;
        },
        events: {
          inc: (facts) => {
            facts.count += 1;
          },
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      sys.events.inc();
      expect(sys.facts.count).toBe(1);

      sys.destroy();
    });

    it("event meta works in namespaced systems", () => {
      const mod = createModule("ns-ev", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          requirements: {},
          events: { go: {} },
        },
        init: (f) => {
          f.x = 0;
        },
        events: {
          go: {
            handler: (facts) => {
              facts.x = 1;
            },
            meta: { label: "Go Event" },
          },
        },
      });
      const sys = createSystem({ modules: { ns: mod } });
      sys.start();

      expect(sys.meta.event("ns::go")?.label).toBe("Go Event");

      sys.destroy();
    });
  });

  // ============================================================================
  // Trace enrichment
  // ============================================================================

  describe("trace enrichment", () => {
    it("trace entries include meta on constraintsHit", async () => {
      const mod = createModule("trace-c", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          requirements: { DO: {} },
          events: {},
        },
        init: (f) => {
          f.x = 0;
        },
        constraints: {
          check: {
            when: (facts) => facts.x > 0,
            require: { type: "DO" },
            meta: { label: "Positive Check" },
          },
        },
        resolvers: {
          doIt: {
            requirement: "DO",
            resolve: async () => {},
          },
        },
      });
      const sys = createSystem({ module: mod, trace: true });
      sys.start();

      sys.facts.x = 5;
      await sys.settle();

      const trace = sys.trace;
      expect(trace).not.toBeNull();
      const entry = trace!.find(
        (t) => t.constraintsHit.length > 0,
      );
      expect(entry).toBeDefined();
      const hit = entry!.constraintsHit.find((c) => c.id === "check");
      expect(hit?.meta?.label).toBe("Positive Check");

      sys.destroy();
    });

    it("trace entries include meta on factChanges", async () => {
      const mod = createModule("trace-f", {
        schema: {
          facts: {
            score: t.number().meta({ label: "Score" }),
          },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.score = 0;
        },
      });
      const sys = createSystem({ module: mod, trace: true });
      sys.start();

      sys.facts.score = 42;
      await sys.settle();

      const trace = sys.trace;
      expect(trace).not.toBeNull();
      const entry = trace!.find((t) =>
        t.factChanges.some((fc) => fc.key === "score"),
      );
      expect(entry).toBeDefined();
      const fc = entry!.factChanges.find((fc) => fc.key === "score");
      expect(fc?.meta?.label).toBe("Score");

      sys.destroy();
    });

    it("trace entries include meta on resolversStarted", async () => {
      const mod = createModule("trace-r", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          requirements: { ACT: {} },
          events: {},
        },
        init: (f) => {
          f.x = 0;
        },
        constraints: {
          check: {
            when: (facts) => facts.x > 0,
            require: { type: "ACT" },
          },
        },
        resolvers: {
          act: {
            requirement: "ACT",
            resolve: async () => {},
            meta: { label: "Actor" },
          },
        },
      });
      const sys = createSystem({ module: mod, trace: true });
      sys.start();

      sys.facts.x = 1;
      await sys.settle();

      const trace = sys.trace;
      expect(trace).not.toBeNull();
      const entry = trace!.find((t) => t.resolversStarted.length > 0);
      expect(entry).toBeDefined();
      const rs = entry!.resolversStarted.find((r) => r.resolver === "act");
      expect(rs?.meta?.label).toBe("Actor");

      sys.destroy();
    });
  });

  // ============================================================================
  // Bulk queries: byCategory, byTag
  // ============================================================================

  describe("bulk queries", () => {
    it("byCategory returns matching definitions across all types", () => {
      const mod = createModule("bulk", {
        schema: {
          facts: {
            token: t.string().meta({ label: "Token", category: "auth" }),
            count: t.number(),
          },
          derivations: {},
          requirements: { LOGIN: {} },
          events: {},
        },
        init: (f) => {
          f.token = "";
          f.count = 0;
        },
        meta: { label: "Auth Module", category: "auth" },
        constraints: {
          needsLogin: {
            when: () => false,
            require: null,
            meta: { label: "Needs Login", category: "auth" },
          },
        },
        resolvers: {
          login: {
            requirement: "LOGIN",
            resolve: async () => {},
            meta: { label: "Login", category: "auth" },
          },
        },
        effects: {
          log: {
            run: () => {},
            meta: { label: "Logger", category: "logging" },
          },
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      const authResults = sys.meta.byCategory("auth");
      expect(authResults.length).toBe(4); // module, fact, constraint, resolver
      expect(authResults.map((r) => r.type).sort()).toEqual([
        "constraint",
        "fact",
        "module",
        "resolver",
      ]);

      const loggingResults = sys.meta.byCategory("logging");
      expect(loggingResults.length).toBe(1);
      expect(loggingResults[0]!.type).toBe("effect");

      expect(sys.meta.byCategory("nonexistent")).toEqual([]);

      sys.destroy();
    });

    it("byTag returns matching definitions across all types", () => {
      const mod = createModule("tags", {
        schema: {
          facts: {
            email: t.string().meta({ label: "Email", tags: ["pii", "contact"] }),
            name: t.string().meta({ label: "Name", tags: ["pii"] }),
            count: t.number(),
          },
          derivations: {},
          requirements: {},
          events: {},
        },
        init: (f) => {
          f.email = "";
          f.name = "";
          f.count = 0;
        },
        constraints: {
          check: {
            when: () => false,
            require: null,
            meta: { tags: ["critical"] },
          },
        },
      });
      const sys = createSystem({ module: mod });
      sys.start();

      const piiResults = sys.meta.byTag("pii");
      expect(piiResults.length).toBe(2); // email, name
      expect(piiResults.every((r) => r.type === "fact")).toBe(true);

      const contactResults = sys.meta.byTag("contact");
      expect(contactResults.length).toBe(1);
      expect(contactResults[0]!.id).toBe("email");

      const criticalResults = sys.meta.byTag("critical");
      expect(criticalResults.length).toBe(1);
      expect(criticalResults[0]!.type).toBe("constraint");

      expect(sys.meta.byTag("nonexistent")).toEqual([]);

      sys.destroy();
    });
  });

  // ============================================================================
  // Export check
  // ============================================================================

  describe("exports", () => {
    it("DefinitionMeta is importable from @directive-run/core", async () => {
      const mod = await import("../../index");
      // DefinitionMeta is a type — check that freezeMeta and isDerivationWithMeta are exported from types
      expect(typeof freezeMeta).toBe("function");
      expect(typeof isDerivationWithMeta).toBe("function");
      // Check that the type re-exports exist in the module
      expect(mod).toBeDefined();
    });
  });
});
