import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// ============================================================================
// Helpers
// ============================================================================

function createTestModule() {
  return createModule("test", {
    schema: {
      facts: {
        count: t.number(),
      },
      events: {
        increment: {},
      },
      requirements: {
        LOAD_DATA: { source: t.string() },
      },
    },
    init: (facts) => {
      facts.count = 0;
    },
    events: {
      increment: (facts) => {
        facts.count = (facts.count as number) + 1;
      },
    },
    constraints: {
      needsData: {
        priority: 10,
        when: (facts) => (facts.count as number) > 5,
        require: { type: "LOAD_DATA", source: "api" },
      },
      alwaysActive: {
        priority: 5,
        when: () => true,
        require: { type: "LOAD_DATA", source: "always" },
      },
    },
    resolvers: {
      loadData: {
        requirement: "LOAD_DATA",
        key: (req) => `load-${req.source}`,
        resolve: async () => {
          // No-op
        },
      },
    },
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("constraints.disable / constraints.enable / constraints.isDisabled", () => {
  it("isDisabled returns false for enabled constraints", () => {
    const system = createSystem({ module: createTestModule() });
    system.start();

    expect(system.constraints.isDisabled("alwaysActive")).toBe(false);
    expect(system.constraints.isDisabled("needsData")).toBe(false);

    system.destroy();
  });

  it("isDisabled returns true after disable()", () => {
    const system = createSystem({ module: createTestModule() });
    system.start();

    system.constraints.disable("alwaysActive");
    expect(system.constraints.isDisabled("alwaysActive")).toBe(true);
    expect(system.constraints.isDisabled("needsData")).toBe(false);

    system.destroy();
  });

  it("isDisabled returns false after enable()", () => {
    const system = createSystem({ module: createTestModule() });
    system.start();

    system.constraints.disable("alwaysActive");
    expect(system.constraints.isDisabled("alwaysActive")).toBe(true);

    system.constraints.enable("alwaysActive");
    expect(system.constraints.isDisabled("alwaysActive")).toBe(false);

    system.destroy();
  });

  it("disable() on unknown constraint does not throw", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const system = createSystem({ module: createTestModule() });
    system.start();

    expect(() => system.constraints.disable("nonexistent")).not.toThrow();

    system.destroy();
    warnSpy.mockRestore();
  });

  it("enable() on unknown constraint does not throw", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const system = createSystem({ module: createTestModule() });
    system.start();

    expect(() => system.constraints.enable("nonexistent")).not.toThrow();

    system.destroy();
    warnSpy.mockRestore();
  });
});

describe("inspect() includes disabled field on constraints", () => {
  it("inspect().constraints includes disabled: false by default", () => {
    const system = createSystem({ module: createTestModule() });
    system.start();

    const inspection = system.inspect();
    const alwaysActive = inspection.constraints.find(
      (c) => c.id === "alwaysActive",
    );

    expect(alwaysActive).toBeDefined();
    expect(alwaysActive!.disabled).toBe(false);

    system.destroy();
  });

  it("inspect().constraints shows disabled: true after disable()", () => {
    const system = createSystem({ module: createTestModule() });
    system.start();

    system.constraints.disable("alwaysActive");

    const inspection = system.inspect();
    const alwaysActive = inspection.constraints.find(
      (c) => c.id === "alwaysActive",
    );
    const needsData = inspection.constraints.find((c) => c.id === "needsData");

    expect(alwaysActive).toBeDefined();
    expect(alwaysActive!.disabled).toBe(true);
    expect(needsData).toBeDefined();
    expect(needsData!.disabled).toBe(false);

    system.destroy();
  });

  it("inspect().constraints shows disabled: false after re-enable()", () => {
    const system = createSystem({ module: createTestModule() });
    system.start();

    system.constraints.disable("alwaysActive");
    system.constraints.enable("alwaysActive");

    const inspection = system.inspect();
    const alwaysActive = inspection.constraints.find(
      (c) => c.id === "alwaysActive",
    );

    expect(alwaysActive!.disabled).toBe(false);

    system.destroy();
  });

  it("inspect().traceEnabled reflects trace config", () => {
    const withHistory = createSystem({
      module: createTestModule(),
      trace: true,
    });
    withHistory.start();
    expect(withHistory.inspect().traceEnabled).toBe(true);
    withHistory.destroy();

    const withoutHistory = createSystem({ module: createTestModule() });
    withoutHistory.start();
    expect(withoutHistory.inspect().traceEnabled).toBe(false);
    withoutHistory.destroy();
  });
});
