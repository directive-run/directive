import { createModule, createSystem, createRequirementStatusPlugin, t } from "@directive-run/core";
import type { ReactiveControllerHost, ReactiveController } from "lit";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  FactController,
  DerivedController,
  DirectiveSelectorController,
  WatchController,
  InspectController,
  RequirementStatusController,
  ExplainController,
  ConstraintStatusController,
  OptimisticUpdateController,
  TimeTravelController,
  SystemController,
  ModuleController,
  createFact,
  createDerived,
  createInspect,
  createWatch,
  createDirectiveSelector,
  createExplain,
  createConstraintStatus,
  createOptimisticUpdate,
  createModule as createModuleController,
  shallowEqual,
} from "../index";

// ============================================================================
// Mock Host
// ============================================================================

function createMockHost(): ReactiveControllerHost & {
  controllers: ReactiveController[];
  updateCount: number;
} {
  const controllers: ReactiveController[] = [];
  const host: ReactiveControllerHost & {
    controllers: ReactiveController[];
    updateCount: number;
  } = {
    controllers,
    updateCount: 0,
    addController(controller: ReactiveController) {
      controllers.push(controller);
    },
    removeController(_controller: ReactiveController) {
      // no-op for testing
    },
    requestUpdate() {
      host.updateCount++;
    },
    get updateComplete() {
      return Promise.resolve(true);
    },
  };

  return host;
}

// ============================================================================
// Helpers
// ============================================================================

/** Flush pending microtasks so reconciliation completes */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================================
// Test Module
// ============================================================================

const testSchema = {
  facts: {
    count: t.number(),
    name: t.string(),
    items: t.array<string>(),
  },
  derivations: {
    doubled: { _type: 0 as number },
    greeting: { _type: "" as string },
  },
  events: {
    increment: {},
    setName: { name: t.string() },
  },
  requirements: {},
};

function createTestSystem() {
  const mod = createModule("test", {
    schema: testSchema,
    init: (facts) => {
      facts.count = 0;
      facts.name = "hello";
      facts.items = [];
    },
    derive: {
      doubled: (facts) => (facts.count as number) * 2,
      greeting: (facts) => `Hi, ${facts.name}!`,
    },
    events: {
      increment: (facts) => {
        facts.count = (facts.count as number) + 1;
      },
      setName: (facts, { name }: { name: string }) => {
        facts.name = name;
      },
    },
  });

  const system = createSystem({ module: mod });
  system.start();

  return system;
}

function createTimeTravelSystem() {
  const mod = createModule("tt", {
    schema: testSchema,
    init: (facts) => {
      facts.count = 0;
      facts.name = "hello";
      facts.items = [];
    },
    derive: {
      doubled: (facts) => (facts.count as number) * 2,
      greeting: (facts) => `Hi, ${facts.name}!`,
    },
    events: {
      increment: (facts) => {
        facts.count = (facts.count as number) + 1;
      },
      setName: (facts, { name }: { name: string }) => {
        facts.name = name;
      },
    },
  });

  const system = createSystem({
    module: mod,
    debug: { timeTravel: true, maxSnapshots: 50 },
  });
  system.start();

  return system;
}

// ============================================================================
// FactController
// ============================================================================

describe("FactController", () => {
  let system: ReturnType<typeof createTestSystem>;
  let host: ReturnType<typeof createMockHost>;

  beforeEach(() => {
    system = createTestSystem();
    host = createMockHost();
  });

  afterEach(() => {
    system.destroy();
  });

  it("reads initial fact value", () => {
    const controller = new FactController(host, system, "count");
    controller.hostConnected();

    expect(controller.value).toBe(0);
  });

  it("updates when fact changes", () => {
    const controller = new FactController(host, system, "count");
    controller.hostConnected();

    expect(controller.value).toBe(0);

    system.facts.count = 5;

    expect(controller.value).toBe(5);
  });

  it("reads string fact value", () => {
    const controller = new FactController(host, system, "name");
    controller.hostConnected();

    expect(controller.value).toBe("hello");
  });

  it("calls requestUpdate on host when fact changes", () => {
    const controller = new FactController(host, system, "count");
    controller.hostConnected();

    const countBefore = host.updateCount;
    system.facts.count = 42;

    expect(host.updateCount).toBeGreaterThan(countBefore);
  });

  it("cleans up subscription on hostDisconnected", () => {
    const controller = new FactController(host, system, "count");
    controller.hostConnected();

    system.facts.count = 1;
    expect(controller.value).toBe(1);

    controller.hostDisconnected();
    const countBefore = host.updateCount;

    system.facts.count = 99;

    // Value should NOT update after disconnect
    expect(controller.value).toBe(1);
    expect(host.updateCount).toBe(countBefore);
  });

  it("registers itself with the host via addController", () => {
    const controller = new FactController(host, system, "count");

    expect(host.controllers).toContain(controller);
  });
});

// ============================================================================
// DerivedController
// ============================================================================

describe("DerivedController", () => {
  let system: ReturnType<typeof createTestSystem>;
  let host: ReturnType<typeof createMockHost>;

  beforeEach(() => {
    system = createTestSystem();
    host = createMockHost();
  });

  afterEach(() => {
    system.destroy();
  });

  it("reads a single derivation value", () => {
    const controller = new DerivedController(host, system, "doubled");
    controller.hostConnected();

    expect(controller.value).toBe(0);
  });

  it("updates when underlying fact changes", () => {
    const controller = new DerivedController(host, system, "doubled");
    controller.hostConnected();

    system.facts.count = 5;

    expect(controller.value).toBe(10);
  });

  it("reads multiple derivations as object (multi-key)", () => {
    const controller = new DerivedController(host, system, [
      "doubled",
      "greeting",
    ]);
    controller.hostConnected();

    expect(controller.value).toEqual({
      doubled: 0,
      greeting: "Hi, hello!",
    });
  });

  it("cleans up subscription on hostDisconnected", () => {
    const controller = new DerivedController(host, system, "doubled");
    controller.hostConnected();

    controller.hostDisconnected();
    const countBefore = host.updateCount;

    system.facts.count = 100;

    expect(host.updateCount).toBe(countBefore);
  });
});

// ============================================================================
// DirectiveSelectorController
// ============================================================================

describe("DirectiveSelectorController", () => {
  let system: ReturnType<typeof createTestSystem>;
  let host: ReturnType<typeof createMockHost>;

  beforeEach(() => {
    system = createTestSystem();
    host = createMockHost();
  });

  afterEach(() => {
    system.destroy();
  });

  it("selects initial value from state", () => {
    const controller = new DirectiveSelectorController(
      host,
      system,
      (state) => state.count,
    );
    controller.hostConnected();

    expect(controller.value).toBe(0);
  });

  it("updates when selected fact changes", () => {
    const controller = new DirectiveSelectorController(
      host,
      system,
      (state) => state.count,
    );
    controller.hostConnected();

    system.facts.count = 7;

    expect(controller.value).toBe(7);
  });

  it("supports custom equality function", () => {
    // Custom equality: values are "equal" if both are even or both are odd
    const controller = new DirectiveSelectorController(
      host,
      system,
      (state) => state.count as number,
      (a, b) => a % 2 === b % 2,
    );
    controller.hostConnected();

    const countBefore = host.updateCount;

    // 0 -> 2 (both even — should NOT update)
    system.facts.count = 2;

    expect(host.updateCount).toBe(countBefore);

    // 2 -> 3 (even to odd — SHOULD update)
    system.facts.count = 3;

    expect(controller.value).toBe(3);
    expect(host.updateCount).toBeGreaterThan(countBefore);
  });

  it("uses auto-tracking by default", () => {
    // Selector that reads count only
    const controller = new DirectiveSelectorController(
      host,
      system,
      (state) => state.count,
    );
    controller.hostConnected();

    const countBefore = host.updateCount;

    // Changing name (not accessed by selector) should NOT trigger update
    system.facts.name = "world";

    expect(host.updateCount).toBe(countBefore);
  });

  it("can disable auto-tracking", () => {
    const controller = new DirectiveSelectorController(
      host,
      system,
      (state) => state.count,
      undefined,
      { autoTrack: false },
    );
    controller.hostConnected();

    // With autoTrack disabled, all store changes trigger selector re-evaluation
    system.facts.name = "world";

    // Since the selector value hasn't changed (still 0), host should NOT be updated
    // because the equality check still applies — but the selector was still called
    expect(controller.value).toBe(0);
  });

  it("cleans up on hostDisconnected", () => {
    const controller = new DirectiveSelectorController(
      host,
      system,
      (state) => state.count,
    );
    controller.hostConnected();

    controller.hostDisconnected();
    const countBefore = host.updateCount;

    system.facts.count = 999;

    expect(host.updateCount).toBe(countBefore);
  });
});

// ============================================================================
// WatchController
// ============================================================================

describe("WatchController", () => {
  let system: ReturnType<typeof createTestSystem>;
  let host: ReturnType<typeof createMockHost>;

  beforeEach(() => {
    system = createTestSystem();
    host = createMockHost();
  });

  afterEach(() => {
    system.destroy();
  });

  it("calls callback when watched fact changes", () => {
    const callback = vi.fn();
    const controller = new WatchController(host, system, "count", callback);
    controller.hostConnected();

    system.facts.count = 42;

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("passes new and previous values to callback", () => {
    const callback = vi.fn();
    const controller = new WatchController(host, system, "count", callback);
    controller.hostConnected();

    system.facts.count = 10;

    expect(callback).toHaveBeenCalledWith(10, 0);

    system.facts.count = 20;

    expect(callback).toHaveBeenCalledWith(20, 10);
  });

  it("watches derivation keys too", () => {
    const callback = vi.fn();
    const controller = new WatchController(host, system, "doubled", callback);
    controller.hostConnected();

    system.facts.count = 5;

    expect(callback).toHaveBeenCalledWith(10, 0);
  });

  it("cleans up subscription on hostDisconnected", () => {
    const callback = vi.fn();
    const controller = new WatchController(host, system, "count", callback);
    controller.hostConnected();

    system.facts.count = 5;
    expect(callback).toHaveBeenCalledTimes(1);

    controller.hostDisconnected();

    system.facts.count = 99;
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// InspectController
// ============================================================================

describe("InspectController", () => {
  let system: ReturnType<typeof createTestSystem>;
  let host: ReturnType<typeof createMockHost>;

  beforeEach(() => {
    system = createTestSystem();
    host = createMockHost();
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns InspectState shape", () => {
    const controller = new InspectController(host, system);
    controller.hostConnected();

    expect(controller.value).toEqual(
      expect.objectContaining({
        isSettled: expect.any(Boolean),
        isWorking: expect.any(Boolean),
        hasUnmet: expect.any(Boolean),
        hasInflight: expect.any(Boolean),
        unmet: expect.any(Array),
        inflight: expect.any(Array),
      }),
    );
  });

  it("updates reactively when facts change", () => {
    const controller = new InspectController(host, system);
    controller.hostConnected();

    const countBefore = host.updateCount;

    system.facts.count = 10;

    expect(host.updateCount).toBeGreaterThan(countBefore);
  });

  it("supports throttle option", () => {
    vi.useFakeTimers();

    const controller = new InspectController(host, system, {
      throttleMs: 200,
    });
    controller.hostConnected();

    // First update fires immediately (leading edge of throttle window)
    system.facts.count = 1;
    const countAfterFirst = host.updateCount;

    // Rapid subsequent updates within the throttle window
    system.facts.count = 2;
    system.facts.count = 3;

    // Should still be at the same count (throttled)
    expect(host.updateCount).toBe(countAfterFirst);

    // Advance past throttle window
    vi.advanceTimersByTime(300);

    // Now the trailing-edge throttle should have fired
    expect(host.updateCount).toBeGreaterThan(countAfterFirst);

    controller.hostDisconnected();
    vi.useRealTimers();
  });

  it("cleans up on hostDisconnected", () => {
    const controller = new InspectController(host, system);
    controller.hostConnected();

    controller.hostDisconnected();
    const countBefore = host.updateCount;

    system.facts.count = 999;

    expect(host.updateCount).toBe(countBefore);
  });
});

// ============================================================================
// RequirementStatusController
// ============================================================================

describe("RequirementStatusController", () => {
  it("returns status for a requirement type", () => {
    const host = createMockHost();
    const statusPlugin = createRequirementStatusPlugin();

    const controller = new RequirementStatusController(
      host,
      statusPlugin,
      "FETCH_DATA",
    );
    controller.hostConnected();

    expect(controller.value).toEqual(
      expect.objectContaining({
        pending: expect.any(Number),
        inflight: expect.any(Number),
        failed: expect.any(Number),
        isLoading: expect.any(Boolean),
        hasError: expect.any(Boolean),
      }),
    );
  });

  it("registers itself with the host", () => {
    const host = createMockHost();
    const statusPlugin = createRequirementStatusPlugin();

    const controller = new RequirementStatusController(
      host,
      statusPlugin,
      "FETCH_DATA",
    );

    expect(host.controllers).toContain(controller);
  });

  it("cleans up on hostDisconnected", () => {
    const host = createMockHost();
    const statusPlugin = createRequirementStatusPlugin();

    const controller = new RequirementStatusController(
      host,
      statusPlugin,
      "FETCH_DATA",
    );
    controller.hostConnected();
    controller.hostDisconnected();

    // Should not throw after disconnect
    expect(() => controller.hostDisconnected()).not.toThrow();
  });
});

// ============================================================================
// ExplainController
// ============================================================================

describe("ExplainController", () => {
  let system: ReturnType<typeof createTestSystem>;
  let host: ReturnType<typeof createMockHost>;

  beforeEach(() => {
    system = createTestSystem();
    host = createMockHost();
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns null for an unknown requirement ID", () => {
    const controller = new ExplainController(host, system, "nonexistent");
    controller.hostConnected();

    expect(controller.value).toBeNull();
  });

  it("updates reactively", () => {
    const controller = new ExplainController(host, system, "someReq");
    controller.hostConnected();

    const countBefore = host.updateCount;

    system.facts.count = 1;

    expect(host.updateCount).toBeGreaterThan(countBefore);
  });

  it("cleans up on hostDisconnected", () => {
    const controller = new ExplainController(host, system, "someReq");
    controller.hostConnected();

    controller.hostDisconnected();
    const countBefore = host.updateCount;

    system.facts.count = 999;

    expect(host.updateCount).toBe(countBefore);
  });
});

// ============================================================================
// ConstraintStatusController
// ============================================================================

describe("ConstraintStatusController", () => {
  let system: ReturnType<typeof createTestSystem>;
  let host: ReturnType<typeof createMockHost>;

  beforeEach(() => {
    system = createTestSystem();
    host = createMockHost();
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns all constraints when no ID provided", () => {
    const controller = new ConstraintStatusController(host, system);
    controller.hostConnected();

    // With no constraints defined in the test module, should return an empty array
    expect(Array.isArray(controller.value)).toBe(true);
  });

  it("returns null for an unknown constraint ID", () => {
    const controller = new ConstraintStatusController(
      host,
      system,
      "nonexistent",
    );
    controller.hostConnected();

    expect(controller.value).toBeNull();
  });

  it("updates reactively when facts change", () => {
    const controller = new ConstraintStatusController(host, system);
    controller.hostConnected();

    const countBefore = host.updateCount;

    system.facts.count = 1;

    expect(host.updateCount).toBeGreaterThan(countBefore);
  });
});

// ============================================================================
// OptimisticUpdateController
// ============================================================================

describe("OptimisticUpdateController", () => {
  let system: ReturnType<typeof createTestSystem>;
  let host: ReturnType<typeof createMockHost>;

  beforeEach(() => {
    system = createTestSystem();
    host = createMockHost();
  });

  afterEach(() => {
    system.destroy();
  });

  it("applies optimistic mutation to facts", () => {
    const controller = new OptimisticUpdateController(host, system);
    controller.hostConnected();

    controller.mutate(() => {
      system.facts.count = 100;
    });

    expect(system.facts.count).toBe(100);
    expect(controller.isPending).toBe(true);
  });

  it("tracks isPending state", () => {
    const controller = new OptimisticUpdateController(host, system);
    controller.hostConnected();

    expect(controller.isPending).toBe(false);

    controller.mutate(() => {
      system.facts.count = 50;
    });

    expect(controller.isPending).toBe(true);
  });

  it("rollback restores snapshot", () => {
    const controller = new OptimisticUpdateController(host, system);
    controller.hostConnected();

    expect(system.facts.count).toBe(0);

    controller.mutate(() => {
      system.facts.count = 100;
    });

    expect(system.facts.count).toBe(100);

    controller.rollback();

    expect(system.facts.count).toBe(0);
    expect(controller.isPending).toBe(false);
    expect(controller.error).toBeNull();
  });

  it("calls requestUpdate on host during mutate and rollback", () => {
    const controller = new OptimisticUpdateController(host, system);
    controller.hostConnected();

    const countBefore = host.updateCount;

    controller.mutate(() => {
      system.facts.count = 10;
    });

    expect(host.updateCount).toBeGreaterThan(countBefore);

    const countAfterMutate = host.updateCount;

    controller.rollback();

    expect(host.updateCount).toBeGreaterThan(countAfterMutate);
  });
});

// ============================================================================
// TimeTravelController
// ============================================================================

describe("TimeTravelController", () => {
  it("returns null when time-travel is disabled", () => {
    const system = createTestSystem();
    const host = createMockHost();

    const controller = new TimeTravelController(host, system);
    controller.hostConnected();

    expect(controller.value).toBeNull();

    controller.hostDisconnected();
    system.destroy();
  });

  it("returns TimeTravelState when time-travel is enabled", () => {
    const system = createTimeTravelSystem();
    const host = createMockHost();

    const controller = new TimeTravelController(host, system);
    controller.hostConnected();

    expect(controller.value).not.toBeNull();
    expect(controller.value).toEqual(
      expect.objectContaining({
        canUndo: expect.any(Boolean),
        canRedo: expect.any(Boolean),
        undo: expect.any(Function),
        redo: expect.any(Function),
        currentIndex: expect.any(Number),
        totalSnapshots: expect.any(Number),
      }),
    );

    controller.hostDisconnected();
    system.destroy();
  });

  it("supports undo and redo after state changes", async () => {
    const system = createTimeTravelSystem();
    const host = createMockHost();

    const controller = new TimeTravelController(host, system);
    controller.hostConnected();

    // Let initial reconcile run
    await flush();

    // Initial — can't undo
    expect(controller.value!.canUndo).toBe(false);

    system.facts.count = 10;
    await flush();

    system.facts.count = 20;
    await flush();

    // After changes and reconcile, we should be able to undo
    expect(controller.value!.canUndo).toBe(true);

    controller.value!.undo();

    expect(system.facts.count).toBe(10);
    expect(controller.value!.canRedo).toBe(true);

    controller.hostDisconnected();
    system.destroy();
  });
});

// ============================================================================
// SystemController
// ============================================================================

describe("SystemController", () => {
  it("creates and starts a system on hostConnected", () => {
    const host = createMockHost();
    const mod = createModule("sys-test", {
      schema: testSchema,
      init: (facts) => {
        facts.count = 0;
        facts.name = "hello";
        facts.items = [];
      },
      derive: {
        doubled: (facts) => (facts.count as number) * 2,
        greeting: (facts) => `Hi, ${facts.name}!`,
      },
    });

    const controller = new SystemController(host, mod);

    // Before connect, system should not be available
    expect(() => controller.system).toThrow();

    controller.hostConnected();

    expect(controller.system).toBeDefined();
    expect(controller.system.facts.count).toBe(0);
  });

  it("destroys system on hostDisconnected", () => {
    const host = createMockHost();
    const mod = createModule("sys-test2", {
      schema: testSchema,
      init: (facts) => {
        facts.count = 0;
        facts.name = "hello";
        facts.items = [];
      },
      derive: {
        doubled: (facts) => (facts.count as number) * 2,
        greeting: (facts) => `Hi, ${facts.name}!`,
      },
    });

    const controller = new SystemController(host, mod);
    controller.hostConnected();

    expect(controller.system).toBeDefined();

    controller.hostDisconnected();

    expect(() => controller.system).toThrow();
  });

  it("accepts full system options", () => {
    const host = createMockHost();
    const mod = createModule("sys-test3", {
      schema: testSchema,
      init: (facts) => {
        facts.count = 0;
        facts.name = "hello";
        facts.items = [];
      },
      derive: {
        doubled: (facts) => (facts.count as number) * 2,
        greeting: (facts) => `Hi, ${facts.name}!`,
      },
    });

    const controller = new SystemController(host, { module: mod });
    controller.hostConnected();

    expect(controller.system.facts.count).toBe(0);

    controller.hostDisconnected();
  });
});

// ============================================================================
// ModuleController
// ============================================================================

describe("ModuleController", () => {
  it("creates system and exposes facts and derived", () => {
    const host = createMockHost();
    const mod = createModule("mod-test", {
      schema: testSchema,
      init: (facts) => {
        facts.count = 0;
        facts.name = "hello";
        facts.items = [];
      },
      derive: {
        doubled: (facts) => (facts.count as number) * 2,
        greeting: (facts) => `Hi, ${facts.name}!`,
      },
      events: {
        increment: (facts) => {
          facts.count = (facts.count as number) + 1;
        },
        setName: (facts, { name }: { name: string }) => {
          facts.name = name;
        },
      },
    });

    const controller = new ModuleController(host, mod);
    controller.hostConnected();

    expect(controller.facts).toEqual(
      expect.objectContaining({
        count: 0,
        name: "hello",
      }),
    );
    expect(controller.derived).toEqual(
      expect.objectContaining({
        doubled: 0,
        greeting: "Hi, hello!",
      }),
    );

    controller.hostDisconnected();
  });

  it("updates facts reactively", () => {
    const host = createMockHost();
    const mod = createModule("mod-test2", {
      schema: testSchema,
      init: (facts) => {
        facts.count = 0;
        facts.name = "hello";
        facts.items = [];
      },
      derive: {
        doubled: (facts) => (facts.count as number) * 2,
        greeting: (facts) => `Hi, ${facts.name}!`,
      },
      events: {
        increment: (facts) => {
          facts.count = (facts.count as number) + 1;
        },
        setName: (facts, { name }: { name: string }) => {
          facts.name = name;
        },
      },
    });

    const controller = new ModuleController(host, mod);
    controller.hostConnected();

    controller.system.facts.count = 10;

    expect(controller.facts).toEqual(
      expect.objectContaining({ count: 10 }),
    );
    expect(controller.derived).toEqual(
      expect.objectContaining({ doubled: 20 }),
    );

    controller.hostDisconnected();
  });

  it("cleans up and destroys system on hostDisconnected", () => {
    const host = createMockHost();
    const mod = createModule("mod-test3", {
      schema: testSchema,
      init: (facts) => {
        facts.count = 0;
        facts.name = "hello";
        facts.items = [];
      },
      derive: {
        doubled: (facts) => (facts.count as number) * 2,
        greeting: (facts) => `Hi, ${facts.name}!`,
      },
    });

    const controller = new ModuleController(host, mod);
    controller.hostConnected();

    expect(controller.system).toBeDefined();

    controller.hostDisconnected();

    expect(() => controller.system).toThrow();
  });
});

// ============================================================================
// Factory Functions
// ============================================================================

describe("Factory functions", () => {
  let system: ReturnType<typeof createTestSystem>;
  let host: ReturnType<typeof createMockHost>;

  beforeEach(() => {
    system = createTestSystem();
    host = createMockHost();
  });

  afterEach(() => {
    system.destroy();
  });

  it("createFact returns a FactController", () => {
    const controller = createFact(host, system, "count");

    expect(controller).toBeInstanceOf(FactController);
    controller.hostConnected();
    expect(controller.value).toBe(0);
  });

  it("createDerived returns a DerivedController", () => {
    const controller = createDerived(host, system, "doubled");

    expect(controller).toBeInstanceOf(DerivedController);
    controller.hostConnected();
    expect(controller.value).toBe(0);
  });

  it("createWatch returns a WatchController", () => {
    const callback = vi.fn();
    const controller = createWatch(host, system, "count", callback);

    expect(controller).toBeInstanceOf(WatchController);
    controller.hostConnected();

    system.facts.count = 5;
    expect(callback).toHaveBeenCalledWith(5, 0);
  });

  it("createDirectiveSelector returns a DirectiveSelectorController", () => {
    const controller = createDirectiveSelector(
      host,
      system,
      (state) => state.count,
    );

    expect(controller).toBeInstanceOf(DirectiveSelectorController);
    controller.hostConnected();
    expect(controller.value).toBe(0);
  });

  it("createInspect returns an InspectController", () => {
    const controller = createInspect(host, system);

    expect(controller).toBeInstanceOf(InspectController);
    controller.hostConnected();
    expect(controller.value).toEqual(
      expect.objectContaining({ isSettled: expect.any(Boolean) }),
    );
  });

  it("createExplain returns an ExplainController", () => {
    const controller = createExplain(host, system, "test-req");

    expect(controller).toBeInstanceOf(ExplainController);
    controller.hostConnected();
    expect(controller.value).toBeNull();
  });

  it("createConstraintStatus returns a ConstraintStatusController", () => {
    const controller = createConstraintStatus(host, system);

    expect(controller).toBeInstanceOf(ConstraintStatusController);
    controller.hostConnected();
    expect(Array.isArray(controller.value)).toBe(true);
  });

  it("createOptimisticUpdate returns an OptimisticUpdateController", () => {
    const controller = createOptimisticUpdate(host, system);

    expect(controller).toBeInstanceOf(OptimisticUpdateController);
    controller.hostConnected();
    expect(controller.isPending).toBe(false);
  });

  it("createModule (controller factory) returns a ModuleController", () => {
    const mod = createModule("factory-test", {
      schema: testSchema,
      init: (facts) => {
        facts.count = 0;
        facts.name = "hello";
        facts.items = [];
      },
      derive: {
        doubled: (facts) => (facts.count as number) * 2,
        greeting: (facts) => `Hi, ${facts.name}!`,
      },
    });

    const controller = createModuleController(host, mod);

    expect(controller).toBeInstanceOf(ModuleController);
    controller.hostConnected();
    expect(controller.facts).toEqual(
      expect.objectContaining({ count: 0 }),
    );
    controller.hostDisconnected();
  });
});

// ============================================================================
// shallowEqual
// ============================================================================

describe("shallowEqual", () => {
  it("returns true for identical references", () => {
    const obj = { a: 1 };

    expect(shallowEqual(obj, obj)).toBe(true);
  });

  it("returns true for objects with same keys and values", () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it("returns false for objects with different values", () => {
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("returns false for objects with different keys", () => {
    expect(shallowEqual({ a: 1 }, { b: 1 } as any)).toBe(false);
  });
});
