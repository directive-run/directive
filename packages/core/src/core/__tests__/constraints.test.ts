import { createFacts } from "../facts.js";
import { describe, expect, it, vi } from "vitest";
import { createConstraintsManager } from "../constraints.js";
import { t } from "../../index.js";

// ============================================================================
// Helpers
// ============================================================================

function setup() {
  const schema = { count: t.number(), active: t.boolean() };
  const { store, facts } = createFacts({ schema });
  facts.count = 0;
  facts.active = false;

  return { schema, store, facts };
}

// ============================================================================
// Basic evaluation
// ============================================================================

describe("basic evaluation", () => {
  it("constraint with when returning true produces requirements", async () => {
    const { facts } = setup();
    facts.count = 10;

    const manager = createConstraintsManager({
      definitions: {
        load: {
          when: (f) => f.count > 5,
          require: { type: "LOAD_DATA" },
        },
      },
      facts,
    });

    const reqs = await manager.evaluate();

    expect(reqs.length).toBe(1);
    expect(reqs[0]!.requirement.type).toBe("LOAD_DATA");
  });

  it("constraint with when returning false produces no requirements", async () => {
    const { facts } = setup();

    const manager = createConstraintsManager({
      definitions: {
        load: {
          when: (f) => f.count > 5,
          require: { type: "LOAD_DATA" },
        },
      },
      facts,
    });

    const reqs = await manager.evaluate();

    expect(reqs.length).toBe(0);
  });

  it("requirements include type from the constraint's require", async () => {
    const { facts } = setup();
    facts.active = true;

    const manager = createConstraintsManager({
      definitions: {
        activate: {
          when: (f) => f.active === true,
          require: { type: "ACTIVATE_USER", role: "admin" },
        },
      },
      facts,
    });

    const reqs = await manager.evaluate();

    expect(reqs.length).toBe(1);
    expect(reqs[0]!.requirement.type).toBe("ACTIVATE_USER");
    expect((reqs[0]!.requirement as Record<string, unknown>).role).toBe("admin");
  });

  it("evaluate with changedKeys only re-evaluates dirty constraints", async () => {
    const { facts } = setup();
    const evaluateSpy = vi.fn();

    const manager = createConstraintsManager({
      definitions: {
        countCheck: {
          when: (f) => f.count > 5,
          require: { type: "COUNT_HIGH" },
        },
        activeCheck: {
          when: (f) => f.active === true,
          require: { type: "IS_ACTIVE" },
        },
      },
      facts,
      onEvaluate: evaluateSpy,
    });

    // First evaluate — all constraints run
    await manager.evaluate();
    expect(evaluateSpy).toHaveBeenCalledTimes(2);

    evaluateSpy.mockClear();

    // Second evaluate with only "count" changed — only countCheck should re-evaluate
    const changed = new Set(["count"]);
    await manager.evaluate(changed);

    expect(evaluateSpy).toHaveBeenCalledTimes(1);
    expect(evaluateSpy).toHaveBeenCalledWith("countCheck", false);
  });
});

// ============================================================================
// Priority ordering
// ============================================================================

describe("priority ordering", () => {
  it("higher priority constraints evaluate first", async () => {
    const { facts } = setup();
    facts.active = true;
    facts.count = 10;

    const order: string[] = [];

    const manager = createConstraintsManager({
      definitions: {
        low: {
          priority: 1,
          when: () => true,
          require: { type: "LOW" },
        },
        high: {
          priority: 100,
          when: () => true,
          require: { type: "HIGH" },
        },
        mid: {
          priority: 50,
          when: () => true,
          require: { type: "MID" },
        },
      },
      facts,
      onEvaluate: (id) => order.push(id),
    });

    await manager.evaluate();

    expect(order).toEqual(["high", "mid", "low"]);
  });

  it("same-priority constraints maintain stable order", async () => {
    const { facts } = setup();
    const order: string[] = [];

    const manager = createConstraintsManager({
      definitions: {
        alpha: {
          priority: 10,
          when: () => true,
          require: { type: "ALPHA" },
        },
        beta: {
          priority: 10,
          when: () => true,
          require: { type: "BETA" },
        },
        gamma: {
          priority: 10,
          when: () => true,
          require: { type: "GAMMA" },
        },
      },
      facts,
      onEvaluate: (id) => order.push(id),
    });

    await manager.evaluate();

    // Run again to confirm stability
    const firstOrder = [...order];
    order.length = 0;
    await manager.evaluate();

    expect(order).toEqual(firstOrder);
  });
});

// ============================================================================
// After dependencies
// ============================================================================

describe("after dependencies", () => {
  it("constraint with after waits until dependency resolves", async () => {
    const { facts } = setup();
    facts.active = true;

    const manager = createConstraintsManager({
      definitions: {
        first: {
          when: () => true,
          require: { type: "FIRST" },
        },
        second: {
          after: ["first"],
          when: () => true,
          require: { type: "SECOND" },
        },
      },
      facts,
    });

    // First evaluation: "first" fires, "second" is blocked
    const reqs1 = await manager.evaluate();
    const types1 = reqs1.map((r) => r.requirement.type);

    expect(types1).toContain("FIRST");
    expect(types1).not.toContain("SECOND");

    // Mark "first" as resolved
    manager.markResolved("first");

    // Second evaluation: "second" should now fire
    const reqs2 = await manager.evaluate();
    const types2 = reqs2.map((r) => r.requirement.type);

    expect(types2).toContain("SECOND");
  });

  it("markResolved unblocks dependent constraints", async () => {
    const { facts } = setup();

    const manager = createConstraintsManager({
      definitions: {
        setup: {
          when: () => true,
          require: { type: "SETUP" },
        },
        action: {
          after: ["setup"],
          when: () => true,
          require: { type: "ACTION" },
        },
      },
      facts,
    });

    await manager.evaluate();

    // Before resolve — action is blocked
    expect(manager.isResolved("setup")).toBe(false);

    manager.markResolved("setup");

    expect(manager.isResolved("setup")).toBe(true);

    const reqs = await manager.evaluate();
    const types = reqs.map((r) => r.requirement.type);

    expect(types).toContain("ACTION");
  });
});

// ============================================================================
// Async constraints
// ============================================================================

describe("async constraints", () => {
  it("async constraint with async: true evaluates correctly", async () => {
    const { facts } = setup();
    facts.count = 10;

    const manager = createConstraintsManager({
      definitions: {
        asyncCheck: {
          async: true,
          deps: ["count"],
          when: async (f) => {
            await new Promise((r) => setTimeout(r, 10));

            return f.count > 5;
          },
          require: { type: "ASYNC_RESULT" },
        },
      },
      facts,
    });

    const reqs = await manager.evaluate();

    expect(reqs.length).toBe(1);
    expect(reqs[0]!.requirement.type).toBe("ASYNC_RESULT");
  });

  it("async constraint with timeout throws after timeout period", async () => {
    const { facts } = setup();
    const errorSpy = vi.fn();

    const manager = createConstraintsManager({
      definitions: {
        slowConstraint: {
          async: true,
          deps: ["count"],
          timeout: 50,
          when: async () => {
            await new Promise((r) => setTimeout(r, 200));

            return true;
          },
          require: { type: "SLOW" },
        },
      },
      facts,
      onError: errorSpy,
    });

    const reqs = await manager.evaluate();

    expect(reqs.length).toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("slowConstraint", expect.any(Error));

    const state = manager.getState("slowConstraint");

    expect(state?.error).toBeTruthy();
    expect(state?.error?.message).toContain("timed out");
  });

  it("async constraint with explicit deps registers those deps", async () => {
    const { facts } = setup();

    const manager = createConstraintsManager({
      definitions: {
        withDeps: {
          async: true,
          deps: ["count", "active"],
          when: async (f) => f.count > 0,
          require: { type: "HAS_DEPS" },
        },
      },
      facts,
    });

    await manager.evaluate();

    const deps = manager.getDependencies("withDeps");

    expect(deps).toBeDefined();
    expect(deps!.has("count")).toBe(true);
    expect(deps!.has("active")).toBe(true);
  });
});

// ============================================================================
// Cycle detection
// ============================================================================

describe("cycle detection", () => {
  it("circular after dependencies throw descriptive error", () => {
    const { facts } = setup();

    expect(() => {
      createConstraintsManager({
        definitions: {
          a: {
            after: ["b"],
            when: () => true,
            require: { type: "A" },
          },
          b: {
            after: ["a"],
            when: () => true,
            require: { type: "B" },
          },
        },
        facts,
      });
    }).toThrow(/cycle detected/i);
  });
});

// ============================================================================
// Enable / disable
// ============================================================================

describe("enable / disable", () => {
  it("disable(id) prevents constraint evaluation", async () => {
    const { facts } = setup();
    facts.count = 10;

    const manager = createConstraintsManager({
      definitions: {
        check: {
          when: (f) => f.count > 5,
          require: { type: "CHECK" },
        },
      },
      facts,
    });

    manager.disable("check");

    const reqs = await manager.evaluate();

    expect(reqs.length).toBe(0);
  });

  it("enable(id) re-enables constraint", async () => {
    const { facts } = setup();
    facts.count = 10;

    const manager = createConstraintsManager({
      definitions: {
        check: {
          when: (f) => f.count > 5,
          require: { type: "CHECK" },
        },
      },
      facts,
    });

    manager.disable("check");
    const reqs1 = await manager.evaluate();

    expect(reqs1.length).toBe(0);

    manager.enable("check");
    const reqs2 = await manager.evaluate();

    expect(reqs2.length).toBe(1);
    expect(reqs2[0]!.requirement.type).toBe("CHECK");
  });

  it("isDisabled(id) returns correct state", () => {
    const { facts } = setup();

    const manager = createConstraintsManager({
      definitions: {
        check: {
          when: () => true,
          require: { type: "CHECK" },
        },
      },
      facts,
    });

    expect(manager.isDisabled("check")).toBe(false);

    manager.disable("check");

    expect(manager.isDisabled("check")).toBe(true);

    manager.enable("check");

    expect(manager.isDisabled("check")).toBe(false);
  });
});

// ============================================================================
// Error isolation
// ============================================================================

describe("error isolation", () => {
  it("throwing when() function is caught and isolated", async () => {
    const { facts } = setup();
    const errorSpy = vi.fn();

    const manager = createConstraintsManager({
      definitions: {
        good: {
          when: () => true,
          require: { type: "GOOD" },
        },
        bad: {
          when: () => {
            throw new Error("boom");
          },
          require: { type: "BAD" },
        },
      },
      facts,
      onError: errorSpy,
    });

    const reqs = await manager.evaluate();

    // Good constraint still produces requirements
    expect(reqs.some((r) => r.requirement.type === "GOOD")).toBe(true);
    // Bad constraint does not
    expect(reqs.some((r) => r.requirement.type === "BAD")).toBe(false);
    // Error was reported
    expect(errorSpy).toHaveBeenCalledWith("bad", expect.any(Error));
  });

  it("throwing require() function is caught (F2 fix)", async () => {
    const { facts } = setup();
    const errorSpy = vi.fn();
    facts.active = true;

    const manager = createConstraintsManager({
      definitions: {
        crashRequire: {
          when: () => true,
          require: () => {
            throw new Error("require boom");
          },
        },
        stable: {
          when: () => true,
          require: { type: "STABLE" },
        },
      },
      facts,
      onError: errorSpy,
    });

    const reqs = await manager.evaluate();

    // Stable constraint still works
    expect(reqs.some((r) => r.requirement.type === "STABLE")).toBe(true);
    // Error was caught
    expect(errorSpy).toHaveBeenCalledWith("crashRequire", expect.any(Error));
  });
});

// ============================================================================
// Dynamic registration
// ============================================================================

describe("dynamic registration", () => {
  it("registerDefinitions adds new constraints", async () => {
    const { facts } = setup();
    facts.count = 10;

    const manager = createConstraintsManager({
      definitions: {},
      facts,
    });

    const reqs1 = await manager.evaluate();

    expect(reqs1.length).toBe(0);

    manager.registerDefinitions({
      dynamic: {
        when: (f: Record<string, unknown>) => (f.count as number) > 5,
        require: { type: "DYNAMIC" },
      },
    });

    const reqs2 = await manager.evaluate();

    expect(reqs2.length).toBe(1);
    expect(reqs2[0]!.requirement.type).toBe("DYNAMIC");
  });

  it("unregisterDefinition removes and cleans up", async () => {
    const { facts } = setup();
    facts.count = 10;

    const manager = createConstraintsManager({
      definitions: {
        removable: {
          when: (f) => f.count > 5,
          require: { type: "REMOVABLE" },
        },
      },
      facts,
    });

    const reqs1 = await manager.evaluate();

    expect(reqs1.length).toBe(1);

    manager.unregisterDefinition("removable");

    const reqs2 = await manager.evaluate();

    expect(reqs2.length).toBe(0);
    expect(manager.getState("removable")).toBeUndefined();
  });

  it("assignDefinition replaces a constraint", async () => {
    const { facts } = setup();
    facts.count = 10;

    const manager = createConstraintsManager({
      definitions: {
        mutable: {
          when: () => true,
          require: { type: "ORIGINAL" },
        },
      },
      facts,
    });

    const reqs1 = await manager.evaluate();

    expect(reqs1[0]!.requirement.type).toBe("ORIGINAL");

    manager.assignDefinition("mutable", {
      when: () => true,
      require: { type: "REPLACED" },
    });

    const reqs2 = await manager.evaluate();

    expect(reqs2[0]!.requirement.type).toBe("REPLACED");
  });
});

// ============================================================================
// Normalize requirements
// ============================================================================

describe("normalize requirements", () => {
  it("single requirement object is wrapped in array", async () => {
    const { facts } = setup();

    const manager = createConstraintsManager({
      definitions: {
        single: {
          when: () => true,
          require: { type: "SINGLE" },
        },
      },
      facts,
    });

    const reqs = await manager.evaluate();

    expect(reqs.length).toBe(1);
    expect(reqs[0]!.requirement.type).toBe("SINGLE");
  });

  it("null/undefined require produces empty requirements", async () => {
    const { facts } = setup();

    const manager = createConstraintsManager({
      definitions: {
        nullReq: {
          when: () => true,
          require: null as unknown as { type: string },
        },
      },
      facts,
    });

    const reqs = await manager.evaluate();

    expect(reqs.length).toBe(0);
  });

  it("array require passes through", async () => {
    const { facts } = setup();

    const manager = createConstraintsManager({
      definitions: {
        multi: {
          when: () => true,
          require: [
            { type: "FIRST" },
            { type: "SECOND" },
          ],
        },
      },
      facts,
    });

    const reqs = await manager.evaluate();

    expect(reqs.length).toBe(2);

    const types = reqs.map((r) => r.requirement.type);

    expect(types).toContain("FIRST");
    expect(types).toContain("SECOND");
  });
});
