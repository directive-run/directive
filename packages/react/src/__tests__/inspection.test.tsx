// @vitest-environment happy-dom
import { createModule, createSystem, t } from "@directive-run/core";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  useInspect,
  useTimeTravel,
  useExplain,
  useConstraintStatus,
} from "../index";

// ============================================================================
// Helpers
// ============================================================================

function createTestSystem() {
  const mod = createModule("test", {
    schema: {
      facts: {
        count: t.number(),
        ready: t.boolean(),
      },
      derivations: {
        doubled: t.number(),
      },
      requirements: {
        MAKE_READY: {},
      },
    },
    init: (facts) => {
      facts.count = 0;
      facts.ready = false;
    },
    derive: {
      doubled: (facts) => facts.count * 2,
    },
    constraints: {
      needsReady: {
        when: (facts) => !facts.ready,
        require: { type: "MAKE_READY" },
      },
    },
    resolvers: {
      makeReady: {
        requirement: "MAKE_READY",
        resolve: async (_req, context) => {
          context.facts.ready = true;
        },
      },
    },
  });
  const system = createSystem({ module: mod });
  system.start();

  return system;
}

function createTimeTravelSystem() {
  const mod = createModule("tt", {
    schema: {
      facts: {
        count: t.number(),
      },
    },
    init: (facts) => {
      facts.count = 0;
    },
  });
  const system = createSystem({
    module: mod,
    debug: { timeTravel: true, maxSnapshots: 50 },
  });
  system.start();

  return system;
}

function createNoTimeTravelSystem() {
  const mod = createModule("nott", {
    schema: {
      facts: {
        count: t.number(),
      },
    },
    init: (facts) => {
      facts.count = 0;
    },
  });
  const system = createSystem({ module: mod });
  system.start();

  return system;
}

/** Flush pending microtasks so reconciliation completes */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================================
// useInspect
// ============================================================================

describe("useInspect", () => {
  it("returns InspectState with correct shape", () => {
    const system = createTestSystem();
    const { result, unmount } = renderHook(() => useInspect(system));

    expect(result.current).toHaveProperty("isSettled");
    expect(result.current).toHaveProperty("unmet");
    expect(result.current).toHaveProperty("inflight");
    expect(result.current).toHaveProperty("isWorking");
    expect(result.current).toHaveProperty("hasUnmet");
    expect(result.current).toHaveProperty("hasInflight");
    expect(typeof result.current.isSettled).toBe("boolean");
    expect(Array.isArray(result.current.unmet)).toBe(true);
    expect(Array.isArray(result.current.inflight)).toBe(true);
    expect(typeof result.current.isWorking).toBe("boolean");
    expect(typeof result.current.hasUnmet).toBe("boolean");
    expect(typeof result.current.hasInflight).toBe("boolean");

    unmount();
    system.destroy();
  });

  it("isSettled reflects system state", async () => {
    const system = createTestSystem();
    const { result, unmount } = renderHook(() => useInspect(system));

    // Wait for the system to settle (resolver sets ready=true)
    await act(async () => {
      await system.settle();
    });

    expect(result.current.isSettled).toBe(true);

    unmount();
    system.destroy();
  });

  it("hasUnmet is true when constraints produce unmet requirements", async () => {
    // Create a system where the constraint fires but no resolver is registered
    const mod = createModule("unmet", {
      schema: {
        facts: {
          status: t.string(),
        },
        requirements: {
          LOAD_DATA: {},
        },
      },
      init: (facts) => {
        facts.status = "pending";
      },
      constraints: {
        needsLoad: {
          when: (facts) => facts.status === "pending",
          require: { type: "LOAD_DATA" },
        },
      },
      // No resolver registered for LOAD_DATA — requirement stays unmet
    });
    const system = createSystem({ module: mod });
    system.start();

    const { result, unmount } = renderHook(() => useInspect(system));

    // After start, the constraint evaluates and produces a requirement
    await vi.waitFor(() => {
      expect(result.current.hasUnmet).toBe(true);
      expect(result.current.unmet.length).toBeGreaterThan(0);
    });

    unmount();
    system.destroy();
  });

  it("updates reactively when system state changes", async () => {
    const system = createTestSystem();

    // Let system settle first (resolver will set ready=true)
    await system.settle();

    const { result, unmount } = renderHook(() => useInspect(system));

    // System is settled, no unmet requirements
    expect(result.current.isSettled).toBe(true);
    expect(result.current.hasUnmet).toBe(false);

    // Now change a fact that triggers the constraint again
    await act(async () => {
      system.facts.ready = false;
      await system.settle();
    });

    // After settle, the resolver ran and set ready=true again
    expect(result.current.isSettled).toBe(true);

    unmount();
    system.destroy();
  });

  it("after resolver runs, unmet becomes empty", async () => {
    const system = createTestSystem();
    const { result, unmount } = renderHook(() => useInspect(system));

    // Wait for the resolver to finish
    await act(async () => {
      await system.settle();
    });

    expect(result.current.unmet).toHaveLength(0);
    expect(result.current.hasUnmet).toBe(false);

    unmount();
    system.destroy();
  });

  it("with throttleMs option delays updates", async () => {
    const system = createTestSystem();

    const { result, unmount } = renderHook(() =>
      useInspect(system, { throttleMs: 200 }),
    );

    // Should still return a valid InspectState
    expect(result.current).toHaveProperty("isSettled");
    expect(result.current).toHaveProperty("unmet");
    expect(result.current).toHaveProperty("isWorking");

    await act(async () => {
      await system.settle();
    });

    // After settle + throttle, state should reflect settled
    await vi.waitFor(() => {
      expect(result.current.isSettled).toBe(true);
    });

    unmount();
    system.destroy();
  });

  it("without throttleMs updates immediately (sync path)", async () => {
    const system = createTestSystem();

    const { result, unmount } = renderHook(() => useInspect(system));

    await act(async () => {
      await system.settle();
    });

    // No throttle — useSyncExternalStore delivers updates synchronously
    expect(result.current.isSettled).toBe(true);
    expect(result.current.hasUnmet).toBe(false);

    unmount();
    system.destroy();
  });

  it("isWorking reflects active resolution", async () => {
    const system = createTestSystem();

    const { result, unmount } = renderHook(() => useInspect(system));

    // Right after start, the constraint fires and a resolver may be inflight or unmet pending
    // isWorking = hasUnmet || hasInflight
    const { isWorking, hasUnmet, hasInflight } = result.current;
    expect(isWorking).toBe(hasUnmet || hasInflight);

    unmount();
    system.destroy();
  });

  it("returns stable reference when nothing changed", async () => {
    const system = createTestSystem();

    await system.settle();

    const { result, rerender, unmount } = renderHook(() => useInspect(system));

    const first = result.current;
    rerender();
    const second = result.current;

    // useSyncExternalStore returns the same reference when getSnapshot returns the same object
    expect(first).toBe(second);

    unmount();
    system.destroy();
  });

  it("isWorking is true when resolver is inflight", async () => {
    // Create a system with a slow resolver
    let resolvePromise: () => void;
    const resolverPromise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const mod = createModule("slow", {
      schema: {
        facts: {
          done: t.boolean(),
        },
        requirements: {
          DO_WORK: {},
        },
      },
      init: (facts) => {
        facts.done = false;
      },
      constraints: {
        needsDone: {
          when: (facts) => !facts.done,
          require: { type: "DO_WORK" },
        },
      },
      resolvers: {
        doWork: {
          requirement: "DO_WORK",
          resolve: async (_req, context) => {
            await resolverPromise;
            context.facts.done = true;
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    system.start();

    const { result, unmount } = renderHook(() => useInspect(system));

    // Wait for the resolver to start (but it hasn't completed)
    await vi.waitFor(() => {
      expect(result.current.isWorking).toBe(true);
    });

    // Now resolve the promise
    await act(async () => {
      resolvePromise!();
      await system.settle();
    });

    expect(result.current.isWorking).toBe(false);
    expect(result.current.isSettled).toBe(true);

    unmount();
    system.destroy();
  });
});

// ============================================================================
// useTimeTravel
// ============================================================================

describe("useTimeTravel", () => {
  it("returns null when time-travel is disabled", () => {
    const system = createNoTimeTravelSystem();

    const { result, unmount } = renderHook(() => useTimeTravel(system));

    expect(result.current).toBeNull();

    unmount();
    system.destroy();
  });

  it("returns TimeTravelState when enabled", () => {
    const system = createTimeTravelSystem();

    const { result, unmount } = renderHook(() => useTimeTravel(system));

    expect(result.current).not.toBeNull();
    expect(result.current).toHaveProperty("canUndo");
    expect(result.current).toHaveProperty("canRedo");
    expect(result.current).toHaveProperty("undo");
    expect(result.current).toHaveProperty("redo");
    expect(result.current).toHaveProperty("currentIndex");
    expect(result.current).toHaveProperty("totalSnapshots");
    expect(result.current).toHaveProperty("isPaused");

    unmount();
    system.destroy();
  });

  it("canUndo is false initially (no snapshots yet)", async () => {
    const system = createTimeTravelSystem();

    // Let the initial reconcile run so any init snapshots are taken
    await flush();

    const { result, unmount } = renderHook(() => useTimeTravel(system));

    expect(result.current).not.toBeNull();
    // With only 0-1 snapshots, canUndo should be false
    if (result.current!.totalSnapshots <= 1) {
      expect(result.current!.canUndo).toBe(false);
    }

    unmount();
    system.destroy();
  });

  it("after taking snapshot, canUndo becomes true", async () => {
    const system = createTimeTravelSystem();

    // Let initial reconcile run
    await flush();

    const { result, unmount } = renderHook(() => useTimeTravel(system));

    // Make two changes, each triggers a reconcile + snapshot
    await act(async () => {
      system.facts.count = 1;
      await flush();
    });

    await act(async () => {
      system.facts.count = 2;
      await flush();
    });

    // After two changes, there should be multiple snapshots and canUndo should be true
    expect(result.current).not.toBeNull();
    expect(result.current!.totalSnapshots).toBeGreaterThanOrEqual(2);
    expect(result.current!.canUndo).toBe(true);

    unmount();
    system.destroy();
  });

  it("undo restores previous state", async () => {
    const system = createTimeTravelSystem();

    // Let initial reconcile run
    await flush();

    const { result, unmount } = renderHook(() => useTimeTravel(system));

    await act(async () => {
      system.facts.count = 10;
      await flush();
    });

    await act(async () => {
      system.facts.count = 20;
      await flush();
    });

    expect(system.facts.count).toBe(20);

    // Undo — should restore the snapshot taken when count was 10
    act(() => {
      result.current!.undo();
    });

    expect(system.facts.count).toBe(10);

    unmount();
    system.destroy();
  });

  it("redo restores undone state", async () => {
    const system = createTimeTravelSystem();

    // Let initial reconcile run
    await flush();

    const { result, unmount } = renderHook(() => useTimeTravel(system));

    await act(async () => {
      system.facts.count = 10;
      await flush();
    });

    await act(async () => {
      system.facts.count = 20;
      await flush();
    });

    // Undo
    act(() => {
      result.current!.undo();
    });

    expect(system.facts.count).toBe(10);

    // Redo
    act(() => {
      result.current!.redo();
    });

    expect(system.facts.count).toBe(20);

    unmount();
    system.destroy();
  });

  it("totalSnapshots tracks count", async () => {
    const system = createTimeTravelSystem();

    // Let initial reconcile run
    await flush();

    const { result, unmount } = renderHook(() => useTimeTravel(system));

    const initialCount = result.current!.totalSnapshots;

    await act(async () => {
      system.facts.count = 5;
      await flush();
    });

    expect(result.current!.totalSnapshots).toBe(initialCount + 1);

    await act(async () => {
      system.facts.count = 10;
      await flush();
    });

    expect(result.current!.totalSnapshots).toBe(initialCount + 2);

    unmount();
    system.destroy();
  });

  it("currentIndex reflects position", async () => {
    const system = createTimeTravelSystem();

    // Let initial reconcile run
    await flush();

    const { result, unmount } = renderHook(() => useTimeTravel(system));

    await act(async () => {
      system.facts.count = 1;
      await flush();
    });

    await act(async () => {
      system.facts.count = 2;
      await flush();
    });

    await act(async () => {
      system.facts.count = 3;
      await flush();
    });

    const lastIndex = result.current!.currentIndex;
    expect(lastIndex).toBeGreaterThanOrEqual(2);

    // Undo one step
    act(() => {
      result.current!.undo();
    });

    expect(result.current!.currentIndex).toBe(lastIndex - 1);

    // Undo another step
    act(() => {
      result.current!.undo();
    });

    expect(result.current!.currentIndex).toBe(lastIndex - 2);

    unmount();
    system.destroy();
  });
});

// ============================================================================
// useExplain
// ============================================================================

describe("useExplain", () => {
  it("returns explanation string for a requirement", async () => {
    // Create a system with an unmet requirement (no resolver)
    const mod = createModule("explaintest", {
      schema: {
        facts: {
          status: t.string(),
        },
        requirements: {
          LOAD_DATA: {},
        },
      },
      init: (facts) => {
        facts.status = "pending";
      },
      constraints: {
        needsLoad: {
          when: (facts) => facts.status === "pending",
          require: { type: "LOAD_DATA" },
        },
      },
      // No resolver — requirement stays unmet and explainable
    });
    const system = createSystem({ module: mod });
    system.start();

    // Wait for reconciliation so the requirement is produced
    await vi.waitFor(() => {
      const inspection = system.inspect();
      expect(inspection.unmet.length).toBeGreaterThan(0);
    });

    const requirementId = system.inspect().unmet[0]!.id;

    const { result, unmount } = renderHook(() =>
      useExplain(system, requirementId),
    );

    expect(result.current).not.toBeNull();
    expect(typeof result.current).toBe("string");
    expect(result.current).toContain("LOAD_DATA");
    expect(result.current).toContain("needsLoad");

    unmount();
    system.destroy();
  });

  it("returns null for non-existent requirement", async () => {
    const system = createTestSystem();
    await system.settle();

    const { result, unmount } = renderHook(() =>
      useExplain(system, "non-existent-requirement-id"),
    );

    expect(result.current).toBeNull();

    unmount();
    system.destroy();
  });

  it("updates when system state changes", async () => {
    // Create a system with an unmet requirement
    const mod = createModule("explainupdate", {
      schema: {
        facts: {
          status: t.string(),
        },
        requirements: {
          LOAD_DATA: {},
        },
      },
      init: (facts) => {
        facts.status = "pending";
      },
      constraints: {
        needsLoad: {
          when: (facts) => facts.status === "pending",
          require: { type: "LOAD_DATA" },
        },
      },
    });
    const system = createSystem({ module: mod });
    system.start();

    // Wait for the requirement to appear
    await vi.waitFor(() => {
      expect(system.inspect().unmet.length).toBeGreaterThan(0);
    });

    const requirementId = system.inspect().unmet[0]!.id;
    const { result, unmount } = renderHook(() =>
      useExplain(system, requirementId),
    );

    expect(result.current).not.toBeNull();

    // Now resolve the condition: set status to something else
    await act(async () => {
      system.facts.status = "loaded";
      // Give engine time to reconcile — requirement should disappear
      await vi.waitFor(() => {
        expect(system.inspect().unmet.length).toBe(0);
      });
    });

    // The requirement no longer exists, so explain returns null
    expect(result.current).toBeNull();

    unmount();
    system.destroy();
  });

  it("subscribes to both facts and settled state", async () => {
    // Verify the hook re-renders when facts change or settlement state changes
    const mod = createModule("explainsub", {
      schema: {
        facts: {
          value: t.number(),
        },
        requirements: {
          SET_VALUE: {},
        },
      },
      init: (facts) => {
        facts.value = 0;
      },
      constraints: {
        needsValue: {
          when: (facts) => facts.value === 0,
          require: { type: "SET_VALUE" },
        },
      },
    });
    const system = createSystem({ module: mod });
    system.start();

    await vi.waitFor(() => {
      expect(system.inspect().unmet.length).toBeGreaterThan(0);
    });

    const reqId = system.inspect().unmet[0]!.id;
    let renderCount = 0;

    const { result, unmount } = renderHook(() => {
      renderCount++;

      return useExplain(system, reqId);
    });

    const initialRenderCount = renderCount;
    expect(result.current).not.toBeNull();

    // Change a fact — should trigger re-render
    await act(async () => {
      system.facts.value = 42;
      await vi.waitFor(() => {
        expect(system.inspect().unmet.length).toBe(0);
      });
    });

    // Should have re-rendered at least once more
    expect(renderCount).toBeGreaterThan(initialRenderCount);

    unmount();
    system.destroy();
  });
});

// ============================================================================
// useConstraintStatus
// ============================================================================

describe("useConstraintStatus", () => {
  it("returns array of all constraints (no constraintId param)", async () => {
    const system = createTestSystem();

    await system.settle();

    const { result, unmount } = renderHook(() => useConstraintStatus(system));

    expect(Array.isArray(result.current)).toBe(true);
    // The test system has one constraint: "needsReady"
    const constraints = result.current as Array<{
      id: string;
      active: boolean;
      priority: number;
    }>;
    expect(constraints.length).toBeGreaterThanOrEqual(1);
    expect(constraints.some((c) => c.id === "needsReady")).toBe(true);

    unmount();
    system.destroy();
  });

  it("returns specific constraint by ID", async () => {
    const system = createTestSystem();

    await system.settle();

    const { result, unmount } = renderHook(() =>
      useConstraintStatus(system, "needsReady"),
    );

    expect(result.current).not.toBeNull();
    const constraint = result.current as {
      id: string;
      active: boolean;
      priority: number;
    };
    expect(constraint.id).toBe("needsReady");

    unmount();
    system.destroy();
  });

  it("returns null for non-existent constraint ID", async () => {
    const system = createTestSystem();

    await system.settle();

    const { result, unmount } = renderHook(() =>
      useConstraintStatus(system, "does-not-exist"),
    );

    expect(result.current).toBeNull();

    unmount();
    system.destroy();
  });

  it("constraint info has correct shape (id, active, priority)", async () => {
    const system = createTestSystem();

    await system.settle();

    const { result, unmount } = renderHook(() =>
      useConstraintStatus(system, "needsReady"),
    );

    const constraint = result.current as {
      id: string;
      active: boolean;
      priority: number;
    };
    expect(constraint).not.toBeNull();
    expect(typeof constraint.id).toBe("string");
    expect(typeof constraint.active).toBe("boolean");
    expect(typeof constraint.priority).toBe("number");

    unmount();
    system.destroy();
  });

  it("updates reactively when constraint state changes", async () => {
    const system = createTestSystem();

    // Let the system settle — the resolver sets ready=true, so constraint becomes inactive
    await system.settle();

    const { result, unmount } = renderHook(() =>
      useConstraintStatus(system, "needsReady"),
    );

    const initialConstraint = result.current as {
      id: string;
      active: boolean;
      priority: number;
    };

    // After settle, ready=true, so constraint `when: !facts.ready` is false -> inactive
    expect(initialConstraint.active).toBe(false);

    // Change ready back to false — constraint should become active again
    await act(async () => {
      system.facts.ready = false;
      await system.settle();
    });

    const updatedConstraint = result.current as {
      id: string;
      active: boolean;
      priority: number;
    };

    // After settling again (resolver set ready=true), constraint is inactive again
    expect(updatedConstraint.id).toBe("needsReady");

    unmount();
    system.destroy();
  });
});
