import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { flushMicrotasks } from "../../utils/testing.js";

// ============================================================================
// Helpers
// ============================================================================

function createTestModule() {
  return createModule("test", {
    schema: {
      facts: {
        count: t.number(),
        label: t.string(),
      },
      derivations: {
        doubled: t.number(),
      },
      events: {
        increment: {},
      },
      requirements: {
        INCREMENT: {},
        LOAD_DATA: { source: t.string() },
      },
    },
    init: (facts) => {
      facts.count = 0;
      facts.label = "default";
    },
    events: {
      increment: (facts) => {
        facts.count = (facts.count as number) + 1;
      },
    },
    derive: {
      doubled: (facts) => (facts.count as number) * 2,
    },
    constraints: {
      autoIncrement: {
        when: (facts) => (facts.count as number) < 0,
        require: { type: "INCREMENT" },
      },
    },
    resolvers: {
      increment: {
        requirement: "INCREMENT",
        resolve: async (_req, context) => {
          context.facts.count = 1;
        },
      },
    },
    effects: {
      log: {
        run: (facts) => {
          void facts.count;
        },
      },
    },
  });
}

function createStartedSystem() {
  const system = createSystem({ module: createTestModule(), pro: true });
  system.start();

  return system;
}

// ============================================================================
// 1. Constraints CRUD
// ============================================================================

describe("Constraints dynamic definitions", () => {
  it("register adds a new constraint, isDynamic returns true, listDynamic includes it", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    system.constraints.register("highCount", {
      when: (facts) => facts.count > 10,
      require: { type: "LOAD_DATA", source: "dynamic" },
    });

    expect(system.constraints.isDynamic("highCount")).toBe(true);
    expect(system.constraints.listDynamic()).toContain("highCount");

    system.destroy();
  });

  it("register throws if ID already exists", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    expect(() => {
      system.constraints.register("autoIncrement", {
        when: () => true,
        require: { type: "INCREMENT" },
      });
    }).toThrow('Constraint "autoIncrement" already exists');

    system.destroy();
  });

  it("assign overrides an existing constraint", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    // Override the static autoIncrement constraint with one that always fires
    system.constraints.assign("autoIncrement", {
      when: () => true,
      require: { type: "INCREMENT" },
    });

    const result = await system.constraints.call("autoIncrement");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.requirement).toHaveProperty("type", "INCREMENT");

    system.destroy();
  });

  it("assign throws if ID does not exist", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    expect(() => {
      system.constraints.assign("nonexistent", {
        when: () => true,
        require: { type: "INCREMENT" },
      });
    }).toThrow('Constraint "nonexistent" does not exist');

    system.destroy();
  });

  it("unregister removes a dynamic constraint, isDynamic returns false", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    system.constraints.register("tempConstraint", {
      when: () => true,
      require: { type: "INCREMENT" },
    });

    expect(system.constraints.isDynamic("tempConstraint")).toBe(true);

    system.constraints.unregister("tempConstraint");

    expect(system.constraints.isDynamic("tempConstraint")).toBe(false);
    expect(system.constraints.listDynamic()).not.toContain("tempConstraint");

    system.destroy();
  });

  it("unregister on static constraint warns and no-ops", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    system.constraints.unregister("autoIncrement");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Cannot unregister static constraint"),
    );

    // Constraint still exists (can still call it)
    const result = await system.constraints.call("autoIncrement");
    expect(Array.isArray(result)).toBe(true);

    warnSpy.mockRestore();
    system.destroy();
  });

  it("call evaluates constraint and returns requirements array", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const system = createStartedSystem();
    await flushMicrotasks();

    // autoIncrement fires when count < 0; count is 0, so it should return empty
    const emptyResult = await system.constraints.call("autoIncrement");
    expect(emptyResult).toEqual([]);

    // Register a constraint that always fires
    system.constraints.register("alwaysFires", {
      when: () => true,
      require: { type: "LOAD_DATA", source: "test" },
    });

    const result = await system.constraints.call("alwaysFires");
    expect(result.length).toBe(1);
    expect(result[0]!.requirement).toHaveProperty("type", "LOAD_DATA");

    await flushMicrotasks();
    system.destroy();
    warnSpy.mockRestore();
  });
});

// ============================================================================
// 2. Resolvers CRUD
// ============================================================================

describe("Resolvers dynamic definitions", () => {
  it("register adds a new resolver", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    system.resolvers.register("loadData", {
      requirement: "LOAD_DATA",
      resolve: async (req, context) => {
        context.facts.label = `loaded from ${req.source}`;
      },
    });

    expect(system.resolvers.isDynamic("loadData")).toBe(true);
    expect(system.resolvers.listDynamic()).toContain("loadData");

    system.destroy();
  });

  it("register throws if ID already exists", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    expect(() => {
      system.resolvers.register("increment", {
        requirement: "INCREMENT",
        resolve: async () => {},
      });
    }).toThrow('Resolver "increment" already exists');

    system.destroy();
  });

  it("assign overrides an existing resolver", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    system.resolvers.assign("increment", {
      requirement: "INCREMENT",
      resolve: async (_req, context) => {
        context.facts.count = 42;
      },
    });

    await system.resolvers.call("increment", { type: "INCREMENT" });
    await flushMicrotasks();

    expect(system.facts.count).toBe(42);

    system.destroy();
  });

  it("unregister removes a dynamic resolver", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    system.resolvers.register("tempResolver", {
      requirement: "LOAD_DATA",
      resolve: async () => {},
    });

    expect(system.resolvers.isDynamic("tempResolver")).toBe(true);

    system.resolvers.unregister("tempResolver");

    expect(system.resolvers.isDynamic("tempResolver")).toBe(false);
    expect(system.resolvers.listDynamic()).not.toContain("tempResolver");

    system.destroy();
  });

  it("call executes resolver with a requirement object", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    await system.resolvers.call("increment", { type: "INCREMENT" });
    await flushMicrotasks();

    expect(system.facts.count).toBe(1);

    system.destroy();
  });
});

// ============================================================================
// 3. Derivations CRUD
// ============================================================================

describe("Derivations dynamic definitions", () => {
  it("register adds a new derivation, accessible via system.derive", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    system.derive.register("tripled", (facts) => {
      return facts.count * 3;
    });

    expect(system.derive.isDynamic("tripled")).toBe(true);
    expect(system.derive.listDynamic()).toContain("tripled");
    expect((system.derive as unknown as Record<string, unknown>).tripled).toBe(0);

    system.destroy();
  });

  it("register throws if ID already exists", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    expect(() => {
      system.derive.register("doubled", (facts) => {
        return facts.count * 2;
      });
    }).toThrow('Derivation "doubled" already exists');

    system.destroy();
  });

  it("assign overrides an existing derivation (value changes)", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    // doubled currently returns count * 2 = 0
    expect(system.derive.doubled).toBe(0);

    // Override it to return count * 10
    system.derive.assign("doubled", (facts) => {
      return facts.count * 10;
    });

    system.facts.count = 5;
    await flushMicrotasks();

    expect(system.derive.doubled).toBe(50);

    system.destroy();
  });

  it("unregister removes a dynamic derivation", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    system.derive.register("custom", (facts) => {
      return facts.count + 100;
    });

    expect((system.derive as unknown as Record<string, unknown>).custom).toBe(100);
    expect(system.derive.isDynamic("custom")).toBe(true);

    system.derive.unregister("custom");

    expect(system.derive.isDynamic("custom")).toBe(false);
    expect(system.derive.listDynamic()).not.toContain("custom");

    system.destroy();
  });

  it("call recomputes and returns the value", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    const result = system.derive.call("doubled");
    expect(result).toBe(0);

    system.facts.count = 7;
    await flushMicrotasks();

    const updated = system.derive.call("doubled");
    expect(updated).toBe(14);

    system.destroy();
  });
});

// ============================================================================
// 4. Effects CRUD
// ============================================================================

describe("Effects dynamic definitions", () => {
  it("register adds a new effect", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    const spy = vi.fn();
    system.effects.register("newEffect", {
      run: spy,
    });

    expect(system.effects.isDynamic("newEffect")).toBe(true);
    expect(system.effects.listDynamic()).toContain("newEffect");

    system.destroy();
  });

  it("register throws if ID already exists", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    expect(() => {
      system.effects.register("log", {
        run: () => {},
      });
    }).toThrow('Effect "log" already exists');

    system.destroy();
  });

  it("assign overrides an existing effect (new run function executes)", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    const spy = vi.fn();
    system.effects.assign("log", {
      run: spy,
    });

    await system.effects.call("log");

    expect(spy).toHaveBeenCalled();

    system.destroy();
  });

  it("unregister removes a dynamic effect and runs cleanup", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    const cleanupSpy = vi.fn();
    system.effects.register("withCleanup", {
      run: () => {
        return cleanupSpy;
      },
    });

    // Run the effect so cleanup is stored
    await system.effects.call("withCleanup");
    expect(system.effects.isDynamic("withCleanup")).toBe(true);

    system.effects.unregister("withCleanup");

    expect(cleanupSpy).toHaveBeenCalled();
    expect(system.effects.isDynamic("withCleanup")).toBe(false);

    system.destroy();
  });

  it("call executes effect immediately", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    const spy = vi.fn();
    system.effects.register("immediate", {
      run: spy,
    });

    await system.effects.call("immediate");

    expect(spy).toHaveBeenCalledTimes(1);

    system.destroy();
  });
});

// ============================================================================
// 5. Safety
// ============================================================================

describe("Dynamic definitions safety", () => {
  it("register with __proto__ throws", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    expect(() => {
      system.constraints.register("__proto__", {
        when: () => true,
        require: { type: "INCREMENT" },
      });
    }).toThrow("blocked property");

    system.destroy();
  });

  it("register with constructor throws", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    expect(() => {
      system.resolvers.register("constructor", {
        requirement: "INCREMENT",
        resolve: async () => {},
      });
    }).toThrow("blocked property");

    system.destroy();
  });

  it("register with ID containing :: throws", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    expect(() => {
      system.effects.register("my::effect", {
        run: () => {},
      });
    }).toThrow('cannot contain "::"');

    system.destroy();
  });

  it("register with empty string throws", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    expect(() => {
      system.constraints.register("", {
        when: () => true,
        require: { type: "INCREMENT" },
      });
    }).toThrow("non-empty string");

    system.destroy();
  });

  it("all operations throw on destroyed system", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    system.destroy();

    expect(() => {
      system.constraints.register("x", {
        when: () => true,
        require: { type: "INCREMENT" },
      });
    }).toThrow("destroyed");

    expect(() => {
      system.constraints.assign("autoIncrement", {
        when: () => true,
        require: { type: "INCREMENT" },
      });
    }).toThrow("destroyed");

    expect(() => {
      system.constraints.unregister("autoIncrement");
    }).toThrow("destroyed");

    expect(() => {
      system.constraints.call("autoIncrement");
    }).toThrow("destroyed");

    expect(() => {
      system.resolvers.register("x", {
        requirement: "INCREMENT",
        resolve: async () => {},
      });
    }).toThrow("destroyed");

    expect(() => {
      system.effects.register("x", { run: () => {} });
    }).toThrow("destroyed");

    expect(() => {
      system.derive.register("x", () => 0);
    }).toThrow("destroyed");

    system.destroy();
  });

  it("derivation register with reserved name throws", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    const reservedNames = [
      "register",
      "assign",
      "unregister",
      "call",
      "isDynamic",
      "listDynamic",
    ];

    for (const name of reservedNames) {
      expect(() => {
        system.derive.register(name, () => 0);
      }).toThrow("reserved derive method name");
    }

    system.destroy();
  });

  it("derivation assign with reserved name throws", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    const reservedNames = [
      "register",
      "assign",
      "unregister",
      "call",
      "isDynamic",
      "listDynamic",
    ];

    for (const name of reservedNames) {
      expect(() => {
        system.derive.assign(name, () => 0);
      }).toThrow("reserved derive method name");
    }

    system.destroy();
  });

  it("call on non-existent ID throws for all types", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    await expect(system.constraints.call("nope")).rejects.toThrow();

    await expect(
      system.resolvers.call("nope", { type: "NOPE" }),
    ).rejects.toThrow();

    expect(() => system.derive.call("nope")).toThrow();

    await expect(system.effects.call("nope")).rejects.toThrow();

    system.destroy();
  });
});

// ============================================================================
// 6. isDynamic / listDynamic
// ============================================================================

describe("isDynamic / listDynamic", () => {
  it("isDynamic returns false for static definitions", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    expect(system.constraints.isDynamic("autoIncrement")).toBe(false);
    expect(system.resolvers.isDynamic("increment")).toBe(false);
    expect(system.derive.isDynamic("doubled")).toBe(false);
    expect(system.effects.isDynamic("log")).toBe(false);

    system.destroy();
  });

  it("isDynamic returns true after register, false after unregister", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    // Constraints
    system.constraints.register("dynConstraint", {
      when: () => true,
      require: { type: "INCREMENT" },
    });
    expect(system.constraints.isDynamic("dynConstraint")).toBe(true);
    system.constraints.unregister("dynConstraint");
    expect(system.constraints.isDynamic("dynConstraint")).toBe(false);

    // Resolvers
    system.resolvers.register("dynResolver", {
      requirement: "INCREMENT",
      resolve: async () => {},
    });
    expect(system.resolvers.isDynamic("dynResolver")).toBe(true);
    system.resolvers.unregister("dynResolver");
    expect(system.resolvers.isDynamic("dynResolver")).toBe(false);

    // Derivations
    system.derive.register("dynDerive", () => 0);
    expect(system.derive.isDynamic("dynDerive")).toBe(true);
    system.derive.unregister("dynDerive");
    expect(system.derive.isDynamic("dynDerive")).toBe(false);

    // Effects
    system.effects.register("dynEffect", { run: () => {} });
    expect(system.effects.isDynamic("dynEffect")).toBe(true);
    system.effects.unregister("dynEffect");
    expect(system.effects.isDynamic("dynEffect")).toBe(false);

    system.destroy();
  });

  it("listDynamic returns only dynamic IDs", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    // Initially, no dynamic definitions
    expect(system.constraints.listDynamic()).toEqual([]);
    expect(system.resolvers.listDynamic()).toEqual([]);
    expect(system.derive.listDynamic()).toEqual([]);
    expect(system.effects.listDynamic()).toEqual([]);

    // Register dynamic definitions
    system.constraints.register("dyn1", {
      when: () => true,
      require: { type: "INCREMENT" },
    });
    system.constraints.register("dyn2", {
      when: () => false,
      require: { type: "INCREMENT" },
    });
    system.resolvers.register("dynR", {
      requirement: "LOAD_DATA",
      resolve: async () => {},
    });
    system.derive.register("dynD", () => 42);
    system.effects.register("dynE", { run: () => {} });

    expect(system.constraints.listDynamic()).toEqual(
      expect.arrayContaining(["dyn1", "dyn2"]),
    );
    expect(system.constraints.listDynamic()).toHaveLength(2);
    // Static "autoIncrement" should not appear
    expect(system.constraints.listDynamic()).not.toContain("autoIncrement");

    expect(system.resolvers.listDynamic()).toEqual(["dynR"]);
    expect(system.resolvers.listDynamic()).not.toContain("increment");

    expect(system.derive.listDynamic()).toEqual(["dynD"]);
    expect(system.derive.listDynamic()).not.toContain("doubled");

    expect(system.effects.listDynamic()).toEqual(["dynE"]);
    expect(system.effects.listDynamic()).not.toContain("log");

    system.destroy();
  });
});

// ============================================================================
// 7. Deferred operations during reconciliation
// ============================================================================

describe("Deferred operations during reconciliation", () => {
  it("register from within an effect is deferred and applied after reconciliation", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Test — system type varies by overload
    let systemRef: any = null;

    const module = createModule("deferred", {
      schema: {
        facts: {
          trigger: t.boolean(),
          result: t.string(),
        },
      },
      init: (facts) => {
        facts.trigger = false;
        facts.result = "";
      },
      effects: {
        selfModify: {
          deps: ["trigger"],
          run: (facts) => {
            if (facts.trigger && systemRef) {
              // This runs during reconciliation, so registration is deferred
              systemRef.derive.register("dynamicDerived", (f: { trigger: boolean; result: string }) => {
                return `derived-${f.trigger}`;
              });
            }
          },
        },
      },
    });

    const system = createSystem({ module, pro: true });
    systemRef = system;
    system.start();
    await flushMicrotasks();

    system.facts.trigger = true;
    await flushMicrotasks();
    await system.settle();

    // The deferred registration should have been applied after reconciliation
    expect(system.derive.isDynamic("dynamicDerived")).toBe(true);
    expect((system.derive as unknown as Record<string, unknown>).dynamicDerived).toBe("derived-true");

    system.destroy();
  });
});

// ============================================================================
// 8. Disabled interactions
// ============================================================================

describe("Disabled interactions with call", () => {
  it("constraints.call respects disabled state (returns empty array)", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    // Register a constraint that always fires
    system.constraints.register("alwaysOn", {
      when: () => true,
      require: { type: "INCREMENT" },
    });

    // Verify it fires when enabled
    const result = await system.constraints.call("alwaysOn");
    expect(result.length).toBe(1);

    // Disable it
    system.constraints.disable("alwaysOn");

    // Should return empty array when disabled
    const disabledResult = await system.constraints.call("alwaysOn");
    expect(disabledResult).toEqual([]);

    system.destroy();
  });

  it("effects.call respects disabled state (does not run)", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    const spy = vi.fn();
    system.effects.register("toggleable", {
      run: spy,
    });

    // Disable it
    system.effects.disable("toggleable");

    // Call should not execute the run function
    await system.effects.call("toggleable");
    expect(spy).not.toHaveBeenCalled();

    // Re-enable and verify it runs
    system.effects.enable("toggleable");
    await system.effects.call("toggleable");
    expect(spy).toHaveBeenCalledTimes(1);

    system.destroy();
  });
});

// ============================================================================
// 9. Lifecycle: assign → unregister
// ============================================================================

describe("Lifecycle: assign → unregister", () => {
  it("register → assign → unregister preserves dynamic tracking through assign", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    // Register a dynamic constraint
    system.constraints.register("lifecycle", {
      when: () => true,
      require: { type: "INCREMENT" },
    });

    expect(system.constraints.isDynamic("lifecycle")).toBe(true);

    // Assign (override) the dynamic constraint
    system.constraints.assign("lifecycle", {
      when: () => false,
      require: { type: "INCREMENT" },
    });

    // Should still be dynamic after assign
    expect(system.constraints.isDynamic("lifecycle")).toBe(true);
    expect(system.constraints.listDynamic()).toContain("lifecycle");

    // Unregister should work since it's still dynamic
    system.constraints.unregister("lifecycle");

    expect(system.constraints.isDynamic("lifecycle")).toBe(false);
    expect(system.constraints.listDynamic()).not.toContain("lifecycle");

    system.destroy();
  });

  it("resolver assign → unregister lifecycle", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    system.resolvers.register("dynRes", {
      requirement: "LOAD_DATA",
      resolve: async (_req, context) => {
        context.facts.label = "v1";
      },
    });

    expect(system.resolvers.isDynamic("dynRes")).toBe(true);

    // Assign override
    system.resolvers.assign("dynRes", {
      requirement: "LOAD_DATA",
      resolve: async (_req, context) => {
        context.facts.label = "v2";
      },
    });

    // Call the overridden resolver
    await system.resolvers.call("dynRes", { type: "LOAD_DATA", source: "test" });
    await flushMicrotasks();

    expect(system.facts.label).toBe("v2");
    expect(system.resolvers.isDynamic("dynRes")).toBe(true);

    // Unregister
    system.resolvers.unregister("dynRes");

    expect(system.resolvers.isDynamic("dynRes")).toBe(false);

    system.destroy();
  });
});

// ============================================================================
// 10. Lifecycle: register → unregister → re-register
// ============================================================================

describe("Lifecycle: register → unregister → re-register", () => {
  it("constraint ID can be reused after unregister", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    // Register
    system.constraints.register("reusable", {
      when: () => true,
      require: { type: "INCREMENT" },
    });

    expect(system.constraints.isDynamic("reusable")).toBe(true);

    // Unregister
    system.constraints.unregister("reusable");

    expect(system.constraints.isDynamic("reusable")).toBe(false);

    // Re-register with same ID, different definition
    system.constraints.register("reusable", {
      when: () => false,
      require: { type: "LOAD_DATA", source: "reused" },
    });

    expect(system.constraints.isDynamic("reusable")).toBe(true);
    expect(system.constraints.listDynamic()).toContain("reusable");

    // Call should use the new definition (when returns false → empty)
    const result = await system.constraints.call("reusable");
    expect(result).toEqual([]);

    system.destroy();
  });

  it("effect ID can be reused after unregister", async () => {
    const system = createStartedSystem();
    await flushMicrotasks();

    const spy1 = vi.fn();
    system.effects.register("reusable", { run: spy1 });

    await system.effects.call("reusable");
    expect(spy1).toHaveBeenCalledTimes(1);

    system.effects.unregister("reusable");

    const spy2 = vi.fn();
    system.effects.register("reusable", { run: spy2 });

    await system.effects.call("reusable");
    expect(spy2).toHaveBeenCalledTimes(1);
    expect(spy1).toHaveBeenCalledTimes(1); // old spy not called again

    system.destroy();
  });
});

// ============================================================================
// 11. Namespaced system dynamic registration
// ============================================================================

describe("Namespaced system dynamic registration", () => {
  it("dynamic constraint registration works in multi-module system", async () => {
    const authModule = createModule("auth", {
      schema: {
        facts: {
          role: t.string(),
        },
        requirements: {
          UPGRADE: {},
        },
      },
      init: (facts) => {
        facts.role = "guest";
      },
    });

    const dataModule = createModule("data", {
      schema: {
        facts: {
          loaded: t.boolean(),
        },
        requirements: {
          FETCH: {},
        },
      },
      init: (facts) => {
        facts.loaded = false;
      },
    });

    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
      pro: true,
    });
    system.start();
    await flushMicrotasks();

    // Dynamic IDs don't use :: (that's reserved for engine-internal namespacing).
    // Users register with plain IDs; the constraint references namespaced fact keys.
    system.constraints.register("dynamicAuthCheck", {
      when: (facts) => facts["auth::role"] === "admin",
      require: { type: "UPGRADE" },
    });

    expect(system.constraints.isDynamic("dynamicAuthCheck")).toBe(true);
    expect(system.constraints.listDynamic()).toContain("dynamicAuthCheck");

    // Register a dynamic resolver
    system.resolvers.register("dynamicFetch", {
      requirement: "FETCH",
      resolve: async (_req, context) => {
        context.facts["data::loaded"] = true;
      },
    });

    expect(system.resolvers.isDynamic("dynamicFetch")).toBe(true);

    // Call the resolver
    await system.resolvers.call("dynamicFetch", { type: "FETCH" });
    await flushMicrotasks();

    // Unregister both
    system.constraints.unregister("dynamicAuthCheck");
    system.resolvers.unregister("dynamicFetch");

    expect(system.constraints.isDynamic("dynamicAuthCheck")).toBe(false);
    expect(system.resolvers.isDynamic("dynamicFetch")).toBe(false);

    system.destroy();
  });
});

// ============================================================================
// 12. Concurrent deferred operations
// ============================================================================

describe("Concurrent deferred operations", () => {
  it("multiple effects defer different operations in a single reconciliation", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Test — system type varies by overload
    let systemRef: any = null;

    const module = createModule("concurrent-defer", {
      schema: {
        facts: {
          trigger: t.boolean(),
          value: t.number(),
        },
        requirements: {
          INCREMENT: {},
        },
      },
      init: (facts) => {
        facts.trigger = false;
        facts.value = 0;
      },
      effects: {
        deferRegister: {
          deps: ["trigger"],
          run: (facts) => {
            if (facts.trigger && systemRef) {
              systemRef.constraints.register("deferred1", {
                when: () => false,
                require: { type: "INCREMENT" },
              });
            }
          },
        },
        deferRegister2: {
          deps: ["trigger"],
          run: (facts) => {
            if (facts.trigger && systemRef) {
              systemRef.effects.register("deferred2", {
                run: () => {},
              });
            }
          },
        },
      },
      constraints: {
        placeholder: {
          when: () => false,
          require: { type: "INCREMENT" },
        },
      },
      resolvers: {
        increment: {
          requirement: "INCREMENT",
          resolve: async (_req, context) => {
            context.facts.value = 1;
          },
        },
      },
    });

    const system = createSystem({ module, pro: true });
    systemRef = system;
    system.start();
    await flushMicrotasks();

    system.facts.trigger = true;
    await flushMicrotasks();
    await system.settle();

    // Both deferred registrations should have been applied
    expect(system.constraints.isDynamic("deferred1")).toBe(true);
    expect(system.effects.isDynamic("deferred2")).toBe(true);

    system.destroy();
  });
});

// ============================================================================
// 13. Resolver assign triggers reconciliation (M1)
// ============================================================================

describe("Resolver assign triggers reconciliation", () => {
  it("assigning a resolver schedules reconciliation", async () => {
    const settleSpy = vi.fn();

    const system = createStartedSystem();
    await flushMicrotasks();
    await system.settle();

    // Listen for settlement changes (proof that reconciliation was scheduled)
    const unsub = system.onSettledChange(settleSpy);

    // Assign a new resolver — should trigger scheduleReconcile
    system.resolvers.assign("increment", {
      requirement: "INCREMENT",
      resolve: async (_req, context) => {
        context.facts.count = 99;
      },
    });

    await flushMicrotasks();
    await system.settle();

    // Settlement listener should have been called, proving reconciliation was triggered
    expect(settleSpy).toHaveBeenCalled();

    unsub();
    system.destroy();
  });
});
