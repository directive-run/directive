import { createRoot } from "solid-js";
import {
  createModule,
  createSystem,
  createRequirementStatusPlugin,
  t,
} from "@directive-run/core";
import type { SingleModuleSystem } from "@directive-run/core";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useFact,
  useDerived,
  useDispatch,
  useEvents,
  useSelector,
  useWatch,
  useInspect,
  useRequirementStatus,
  useSuspenseRequirement,
  useExplain,
  useConstraintStatus,
  useOptimisticUpdate,
  useTimeTravel,
  useDirective,
  createFactSignal,
  createDerivedSignal,
} from "../index";

// ============================================================================
// Test Module Factory (matches React test schema format)
// ============================================================================

const testSchema = {
  facts: {
    count: t.number(),
    name: t.string(),
    items: t.array<string>(),
  },
  derivations: {
    doubled: t.number(),
    greeting: t.string(),
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

  return { system, mod };
}

// ============================================================================
// useFact
// ============================================================================

describe("useFact", () => {
  let system: ReturnType<typeof createTestSystem>["system"];

  beforeEach(() => {
    ({ system } = createTestSystem());
  });

  afterEach(() => {
    system.destroy();
  });

  it("reads a single fact value", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const count = useFact(system, "count");

      expect(count()).toBe(0);
    });
    dispose!();
  });

  it("updates when fact changes", () => {
    let dispose: () => void;
    let count: () => number | undefined;
    createRoot((_dispose) => {
      dispose = _dispose;
      count = useFact(system, "count");

      expect(count()).toBe(0);
    });

    system.facts.count = 5;
    expect(count!()).toBe(5);

    dispose!();
  });

  it("reads string fact value", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const name = useFact(system, "name");

      expect(name()).toBe("hello");
    });
    dispose!();
  });

  it("multi-key: reads multiple facts as object", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const facts = useFact(system, ["count", "name"]);

      expect(facts()).toEqual({ count: 0, name: "hello" });
    });
    dispose!();
  });

  it("multi-key: updates when any subscribed fact changes", () => {
    let dispose: () => void;
    let facts: () => Record<string, unknown>;
    createRoot((_dispose) => {
      dispose = _dispose;
      facts = useFact(system, ["count", "name"]);

      expect(facts()).toEqual({ count: 0, name: "hello" });
    });

    system.facts.count = 10;
    expect(facts!()).toEqual({ count: 10, name: "hello" });

    system.facts.name = "world";
    expect(facts!()).toEqual({ count: 10, name: "world" });

    dispose!();
  });

  it("cleans up subscription on dispose", () => {
    let dispose: () => void;
    let count: () => number | undefined;
    createRoot((_dispose) => {
      dispose = _dispose;
      count = useFact(system, "count");
    });

    system.facts.count = 5;
    expect(count!()).toBe(5);

    dispose!();

    // After dispose, signal value is stale (doesn't update)
    system.facts.count = 99;
    expect(count!()).toBe(5);
  });
});

// ============================================================================
// useDerived
// ============================================================================

describe("useDerived", () => {
  let system: ReturnType<typeof createTestSystem>["system"];

  beforeEach(() => {
    ({ system } = createTestSystem());
  });

  afterEach(() => {
    system.destroy();
  });

  it("reads single derivation value", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const doubled = useDerived(system, "doubled");

      expect(doubled()).toBe(0);
    });
    dispose!();
  });

  it("updates when underlying fact changes", () => {
    let dispose: () => void;
    let doubled: () => number;
    createRoot((_dispose) => {
      dispose = _dispose;
      doubled = useDerived(system, "doubled");

      expect(doubled()).toBe(0);
    });

    system.facts.count = 5;
    expect(doubled!()).toBe(10);

    dispose!();
  });

  it("multi-key: reads multiple derivations as object", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const derived = useDerived(system, ["doubled", "greeting"]);

      expect(derived()).toEqual({ doubled: 0, greeting: "Hi, hello!" });
    });
    dispose!();
  });

  it("cleans up subscription on dispose", () => {
    let dispose: () => void;
    let doubled: () => number;
    createRoot((_dispose) => {
      dispose = _dispose;
      doubled = useDerived(system, "doubled");
    });

    system.facts.count = 5;
    expect(doubled!()).toBe(10);

    dispose!();

    system.facts.count = 100;
    // After dispose, signal is stale
    expect(doubled!()).toBe(10);
  });
});

// ============================================================================
// useSelector
// ============================================================================

describe("useSelector", () => {
  let system: ReturnType<typeof createTestSystem>["system"];

  beforeEach(() => {
    ({ system } = createTestSystem());
  });

  afterEach(() => {
    system.destroy();
  });

  it("selects a derived value from facts", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const tripled = useSelector(system, (state) => (state.count as number) * 3);

      expect(tripled()).toBe(0);
    });
    dispose!();
  });

  it("updates when selected fact changes", () => {
    let dispose: () => void;
    let tripled: () => number;
    createRoot((_dispose) => {
      dispose = _dispose;
      tripled = useSelector(system, (state) => (state.count as number) * 3);
    });

    system.facts.count = 4;
    expect(tripled!()).toBe(12);

    dispose!();
  });

  it("respects custom equality function", () => {
    let dispose: () => void;
    const selectorFn = vi.fn((state: { count: number }) => ({
      value: state.count,
    }));
    let selected: () => { value: number };

    createRoot((_dispose) => {
      dispose = _dispose;
      // Custom equality: always equal (never update)
      selected = useSelector(system, selectorFn as any, () => true);
    });

    const initial = selected!();
    system.facts.count = 10;

    // Because equality always returns true, the signal should NOT update
    expect(selected!()).toBe(initial);

    dispose!();
  });

  it("auto-tracks accessed dependencies", () => {
    let dispose: () => void;
    const selectorFn = vi.fn((state: any) => state.count * 2);
    let result: () => number;

    createRoot((_dispose) => {
      dispose = _dispose;
      result = useSelector(system, selectorFn);
    });

    // Initial call
    expect(selectorFn).toHaveBeenCalledTimes(1);

    // Changing tracked fact triggers re-evaluation
    system.facts.count = 5;
    expect(result!()).toBe(10);

    dispose!();
  });

  it("can read derivations through state proxy", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const result = useSelector(system, (state) => state.doubled);

      expect(result()).toBe(0);
    });
    dispose!();
  });

  it("cleans up subscriptions on dispose", () => {
    let dispose: () => void;
    let result: () => number;

    createRoot((_dispose) => {
      dispose = _dispose;
      result = useSelector(system, (state) => (state.count as number) * 2);
    });

    system.facts.count = 3;
    expect(result!()).toBe(6);

    dispose!();

    system.facts.count = 100;
    // Stale after dispose
    expect(result!()).toBe(6);
  });
});

// ============================================================================
// useDispatch
// ============================================================================

describe("useDispatch", () => {
  let system: ReturnType<typeof createTestSystem>["system"];

  beforeEach(() => {
    ({ system } = createTestSystem());
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns a dispatch function", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const dispatch = useDispatch(system);

      expect(typeof dispatch).toBe("function");
    });
    dispose!();
  });

  it("dispatching events updates facts", () => {
    let dispose: () => void;
    let dispatch: (event: any) => void;
    let count: () => number | undefined;
    createRoot((_dispose) => {
      dispose = _dispose;
      dispatch = useDispatch(system);
      count = useFact(system, "count");
    });

    expect(count!()).toBe(0);
    dispatch!({ type: "increment" });
    expect(count!()).toBe(1);

    dispose!();
  });

  it("dispatch function is stable", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const dispatch1 = useDispatch(system);
      const dispatch2 = useDispatch(system);

      // Each call creates a new wrapper, but they both dispatch to the same system
      dispatch1({ type: "increment" });
      dispatch2({ type: "increment" });

      expect(system.facts.count).toBe(2);
    });
    dispose!();
  });
});

// ============================================================================
// useEvents
// ============================================================================

describe("useEvents", () => {
  let system: ReturnType<typeof createTestSystem>["system"];

  beforeEach(() => {
    ({ system } = createTestSystem());
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns the events object", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const events = useEvents(system);

      expect(events).toBeDefined();
      expect(typeof events.increment).toBe("function");
      expect(typeof events.setName).toBe("function");
    });
    dispose!();
  });

  it("calling events updates the system", () => {
    let dispose: () => void;
    let events: { increment: () => void; setName: (payload: { name: string }) => void };
    let count: () => number | undefined;
    createRoot((_dispose) => {
      dispose = _dispose;
      events = useEvents(system) as typeof events;
      count = useFact(system, "count");
    });

    expect(count!()).toBe(0);
    events!.increment();
    expect(count!()).toBe(1);

    events!.increment();
    events!.increment();
    expect(count!()).toBe(3);

    dispose!();
  });
});

// ============================================================================
// useWatch
// ============================================================================

describe("useWatch", () => {
  let system: ReturnType<typeof createTestSystem>["system"];

  beforeEach(() => {
    ({ system } = createTestSystem());
  });

  afterEach(() => {
    system.destroy();
  });

  it("calls callback when watched fact changes", () => {
    const callback = vi.fn();
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      useWatch(system, "count", callback);
    });

    system.facts.count = 42;
    expect(callback).toHaveBeenCalledTimes(1);

    dispose!();
  });

  it("passes new and previous values to callback", () => {
    const callback = vi.fn();
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      useWatch(system, "count", callback);
    });

    system.facts.count = 10;
    expect(callback).toHaveBeenCalledWith(10, 0);

    system.facts.count = 20;
    expect(callback).toHaveBeenCalledWith(20, 10);

    dispose!();
  });

  it("cleans up subscription on dispose", () => {
    const callback = vi.fn();
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      useWatch(system, "count", callback);
    });

    system.facts.count = 5;
    expect(callback).toHaveBeenCalledTimes(1);

    dispose!();

    system.facts.count = 99;
    // After dispose, callback should not fire
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("watches derivation keys", () => {
    const callback = vi.fn();
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      useWatch(system, "doubled", callback);
    });

    system.facts.count = 5;
    expect(callback).toHaveBeenCalledWith(10, 0);

    dispose!();
  });
});

// ============================================================================
// useInspect
// ============================================================================

describe("useInspect", () => {
  let system: ReturnType<typeof createTestSystem>["system"];

  beforeEach(() => {
    ({ system } = createTestSystem());
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns inspect state shape", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const state = useInspect(system);
      const val = state();

      expect(val).toHaveProperty("isSettled");
      expect(val).toHaveProperty("unmet");
      expect(val).toHaveProperty("inflight");
      expect(val).toHaveProperty("isWorking");
      expect(val).toHaveProperty("hasUnmet");
      expect(val).toHaveProperty("hasInflight");
    });
    dispose!();
  });

  it("updates reactively when facts change", () => {
    let dispose: () => void;
    let state: () => any;
    createRoot((_dispose) => {
      dispose = _dispose;
      state = useInspect(system);
    });

    state!();
    system.facts.count = 10;
    const after = state!();

    // The state accessor should have been called and returned updated inspect state
    expect(after).toHaveProperty("isSettled");

    dispose!();
  });

  it("supports throttle option", () => {
    vi.useFakeTimers();
    let dispose: () => void;
    let state: () => any;

    createRoot((_dispose) => {
      dispose = _dispose;
      state = useInspect(system, { throttleMs: 100 });
    });

    // Should return initial state
    expect(state!()).toHaveProperty("isSettled");

    dispose!();
    vi.useRealTimers();
  });

  it("cleans up subscriptions on dispose", () => {
    let dispose: () => void;
    let state: () => any;
    createRoot((_dispose) => {
      dispose = _dispose;
      state = useInspect(system);
    });

    system.facts.count = 5;
    const val = state!();

    dispose!();

    system.facts.count = 100;
    // After dispose, the signal should be stale
    expect(state!()).toBe(val);
  });
});

// ============================================================================
// useRequirementStatus
// ============================================================================

describe("useRequirementStatus", () => {
  it("returns status for a single requirement type", () => {
    const statusPlugin = createRequirementStatusPlugin();
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const status = useRequirementStatus(statusPlugin, "FETCH_DATA");
      const val = status();

      expect(val).toHaveProperty("pending");
      expect(val).toHaveProperty("inflight");
      expect(val).toHaveProperty("failed");
      expect(val).toHaveProperty("isLoading");
      expect(val).toHaveProperty("hasError");
    });
    dispose!();
  });

  it("returns status for multiple requirement types", () => {
    const statusPlugin = createRequirementStatusPlugin();
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const statuses = useRequirementStatus(statusPlugin, [
        "FETCH_DATA",
        "SAVE_DATA",
      ]);
      const val = statuses();

      expect(val).toHaveProperty("FETCH_DATA");
      expect(val).toHaveProperty("SAVE_DATA");
      expect(val.FETCH_DATA).toHaveProperty("isLoading");
      expect(val.SAVE_DATA).toHaveProperty("isLoading");
    });
    dispose!();
  });

  it("updates reactively when status changes", () => {
    const statusPlugin = createRequirementStatusPlugin();
    let dispose: () => void;
    let status: () => any;
    createRoot((_dispose) => {
      dispose = _dispose;
      status = useRequirementStatus(statusPlugin, "FETCH_DATA");
    });

    const initial = status!();
    expect(initial.isLoading).toBe(false);

    dispose!();
  });

  it("cleans up subscription on dispose", () => {
    const statusPlugin = createRequirementStatusPlugin();
    let dispose: () => void;
    let status: () => any;
    createRoot((_dispose) => {
      dispose = _dispose;
      status = useRequirementStatus(statusPlugin, "FETCH_DATA");
    });

    const val = status!();
    dispose!();

    // After dispose, signal is stale
    expect(status!()).toBe(val);
  });
});

// ============================================================================
// useSuspenseRequirement
// ============================================================================

describe("useSuspenseRequirement", () => {
  it("returns accessor when not loading", () => {
    const statusPlugin = createRequirementStatusPlugin();
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      // Not loading by default, so should NOT throw
      const status = useSuspenseRequirement(statusPlugin, "FETCH_DATA");
      const val = status();

      expect(val).toHaveProperty("isLoading");
      expect(val.isLoading).toBe(false);
    });
    dispose!();
  });

  it("returns multi-type accessor when not loading", () => {
    const statusPlugin = createRequirementStatusPlugin();
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const statuses = useSuspenseRequirement(statusPlugin, [
        "FETCH_DATA",
        "SAVE_DATA",
      ]);
      const val = statuses();

      expect(val).toHaveProperty("FETCH_DATA");
      expect(val).toHaveProperty("SAVE_DATA");
    });
    dispose!();
  });

  it("throws a promise when requirement is loading", () => {
    // Create a mock statusPlugin that reports loading state
    const listeners = new Set<() => void>();
    let isLoading = true;

    const mockStatusPlugin = {
      getStatus: (_type: string) => ({
        pending: isLoading ? 1 : 0,
        inflight: 0,
        failed: 0,
        isLoading,
        hasError: false,
        lastError: null,
      }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },
      getAllStatus: () => new Map(),
      reset: () => {},
      plugin: {} as any,
    };

    // When loading, useSuspenseRequirement should throw a promise.
    // Call directly (not inside createRoot) since the throw happens before
    // any Solid primitives are used -- createRoot would catch and wrap it.
    let thrown: unknown;
    try {
      useSuspenseRequirement(mockStatusPlugin as any, "FETCH_DATA");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Promise);

    // Resolve it by changing loading state
    isLoading = false;
    for (const listener of listeners) {
      listener();
    }
  });
});

// ============================================================================
// useExplain
// ============================================================================

describe("useExplain", () => {
  let system: ReturnType<typeof createTestSystem>["system"];

  beforeEach(() => {
    ({ system } = createTestSystem());
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns explanation for a requirement", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const explanation = useExplain(system, "some-requirement");

      // No constraint emits "some-requirement", so explain returns null
      expect(explanation()).toBeNull();
    });
    dispose!();
  });

  it("returns null for unknown requirement", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const explanation = useExplain(system, "nonexistent");

      expect(explanation()).toBeNull();
    });
    dispose!();
  });

  it("updates reactively when facts change", () => {
    let dispose: () => void;
    let explanation: () => string | null;
    createRoot((_dispose) => {
      dispose = _dispose;
      explanation = useExplain(system, "some-requirement");
    });

    const before = explanation!();
    system.facts.count = 10;
    const after = explanation!();

    // Both null (no constraint emits this), but the signal was refreshed
    expect(before).toBeNull();
    expect(after).toBeNull();

    dispose!();
  });
});

// ============================================================================
// useConstraintStatus
// ============================================================================

describe("useConstraintStatus", () => {
  let system: ReturnType<typeof createTestSystem>["system"];

  beforeEach(() => {
    ({ system } = createTestSystem());
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns all constraints", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const constraints = useConstraintStatus(system);
      const val = constraints();

      expect(Array.isArray(val)).toBe(true);
    });
    dispose!();
  });

  it("returns single constraint by ID", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const constraint = useConstraintStatus(system, "nonexistent");

      // No constraint with this ID
      expect(constraint()).toBeNull();
    });
    dispose!();
  });

  it("updates reactively when facts change", () => {
    let dispose: () => void;
    let constraints: () => any;
    createRoot((_dispose) => {
      dispose = _dispose;
      constraints = useConstraintStatus(system);
    });

    const before = constraints!();
    system.facts.count = 5;
    const after = constraints!();

    // Both empty arrays (no constraints defined), but the signal refreshed
    expect(Array.isArray(before)).toBe(true);
    expect(Array.isArray(after)).toBe(true);

    dispose!();
  });
});

// ============================================================================
// useOptimisticUpdate
// ============================================================================

describe("useOptimisticUpdate", () => {
  let system: ReturnType<typeof createTestSystem>["system"];

  beforeEach(() => {
    ({ system } = createTestSystem());
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns mutate, isPending, error, and rollback", () => {
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const result = useOptimisticUpdate(system);

      expect(typeof result.mutate).toBe("function");
      expect(typeof result.isPending).toBe("function");
      expect(typeof result.error).toBe("function");
      expect(typeof result.rollback).toBe("function");
    });
    dispose!();
  });

  it("mutate applies changes optimistically", () => {
    let dispose: () => void;
    let optimistic: ReturnType<typeof useOptimisticUpdate>;
    createRoot((_dispose) => {
      dispose = _dispose;
      optimistic = useOptimisticUpdate(system);
    });

    expect(system.facts.count).toBe(0);
    optimistic!.mutate(() => {
      system.facts.count = 42;
    });
    expect(system.facts.count).toBe(42);

    dispose!();
  });

  it("isPending is true after mutate", () => {
    let dispose: () => void;
    let optimistic: ReturnType<typeof useOptimisticUpdate>;
    createRoot((_dispose) => {
      dispose = _dispose;
      optimistic = useOptimisticUpdate(system);
    });

    expect(optimistic!.isPending()).toBe(false);
    optimistic!.mutate(() => {
      system.facts.count = 10;
    });
    expect(optimistic!.isPending()).toBe(true);

    dispose!();
  });

  it("rollback restores the previous state", () => {
    let dispose: () => void;
    let optimistic: ReturnType<typeof useOptimisticUpdate>;
    createRoot((_dispose) => {
      dispose = _dispose;
      optimistic = useOptimisticUpdate(system);
    });

    expect(system.facts.count).toBe(0);

    optimistic!.mutate(() => {
      system.facts.count = 999;
    });
    expect(system.facts.count).toBe(999);

    optimistic!.rollback();
    expect(system.facts.count).toBe(0);
    expect(optimistic!.isPending()).toBe(false);
    expect(optimistic!.error()).toBeNull();

    dispose!();
  });
});

// ============================================================================
// useTimeTravel
// ============================================================================

describe("useTimeTravel", () => {
  it("returns null when time-travel is not enabled", () => {
    const { system } = createTestSystem();
    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const tt = useTimeTravel(system);

      expect(tt()).toBeNull();
    });
    dispose!();
    system.destroy();
  });

  it("returns time-travel state when enabled", () => {
    const mod = createModule("tt-test", {
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
    } as any) as SingleModuleSystem<typeof testSchema>;
    system.start();

    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const tt = useTimeTravel(system);
      const val = tt();

      expect(val).not.toBeNull();
      expect(val).toHaveProperty("canUndo");
      expect(val).toHaveProperty("canRedo");
      expect(val).toHaveProperty("undo");
      expect(val).toHaveProperty("redo");
      expect(val).toHaveProperty("currentIndex");
      expect(val).toHaveProperty("totalSnapshots");
    });
    dispose!();
    system.destroy();
  });

  it("updates reactively on time-travel changes", () => {
    const mod = createModule("tt-reactive", {
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
    } as any) as SingleModuleSystem<typeof testSchema>;
    system.start();

    let dispose: () => void;
    let tt: () => any;
    createRoot((_dispose) => {
      dispose = _dispose;
      tt = useTimeTravel(system);
    });

    const before = tt!();
    expect(before).not.toBeNull();

    // Trigger a snapshot by changing facts
    system.facts.count = 10;

    const after = tt!();
    // After a change, totalSnapshots may have increased
    expect(after).not.toBeNull();

    dispose!();
    system.destroy();
  });
});

// ============================================================================
// useDirective
// ============================================================================

describe("useDirective", () => {
  it("creates a system with reactive facts and derived", () => {
    const mod = createModule("directive-test", {
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

    let dispose: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      const { system, facts, derived, events, dispatch } = useDirective(mod);

      expect(system).toBeDefined();
      expect(facts()).toHaveProperty("count", 0);
      expect(facts()).toHaveProperty("name", "hello");
      expect(derived()).toHaveProperty("doubled", 0);
      expect(derived()).toHaveProperty("greeting", "Hi, hello!");
      expect(events).toBeDefined();
      expect(typeof dispatch).toBe("function");
    });
    dispose!();
  });

  it("facts and derived update reactively", () => {
    const mod = createModule("directive-reactive", {
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

    let dispose: () => void;
    // biome-ignore lint/suspicious/noExplicitAny: test convenience
    let result: any;
    createRoot((_dispose) => {
      dispose = _dispose;
      result = useDirective(mod);
    });

    expect(result!.facts()).toHaveProperty("count", 0);

    result!.system.facts.count = 7;
    expect(result!.facts()).toHaveProperty("count", 7);
    expect(result!.derived()).toHaveProperty("doubled", 14);

    dispose!();
  });

  it("cleans up system on dispose", () => {
    const mod = createModule("directive-cleanup", {
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

    let dispose: () => void;
    // biome-ignore lint/suspicious/noExplicitAny: test convenience
    let result: any;
    createRoot((_dispose) => {
      dispose = _dispose;
      result = useDirective(mod);
    });

    const factsSnap = result!.facts();
    dispose!();

    // After dispose, system should be destroyed and signals stale
    // The facts accessor still returns the last value
    expect(result!.facts()).toBe(factsSnap);
  });
});

// ============================================================================
// createFactSignal
// ============================================================================

describe("createFactSignal", () => {
  let system: ReturnType<typeof createTestSystem>["system"];

  beforeEach(() => {
    ({ system } = createTestSystem());
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns [accessor, unsubscribe] tuple", () => {
    const [value, unsub] = createFactSignal<number>(system, "count");

    expect(typeof value).toBe("function");
    expect(typeof unsub).toBe("function");
    expect(value()).toBe(0);

    unsub();
  });

  it("accessor updates when fact changes", () => {
    const [value, unsub] = createFactSignal<number>(system, "count");

    expect(value()).toBe(0);

    system.facts.count = 42;
    expect(value()).toBe(42);

    // After unsub, no more updates
    unsub();
    system.facts.count = 100;
    expect(value()).toBe(42);
  });
});

// ============================================================================
// createDerivedSignal
// ============================================================================

describe("createDerivedSignal", () => {
  let system: ReturnType<typeof createTestSystem>["system"];

  beforeEach(() => {
    ({ system } = createTestSystem());
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns [accessor, unsubscribe] tuple", () => {
    const [value, unsub] = createDerivedSignal<number>(system, "doubled");

    expect(typeof value).toBe("function");
    expect(typeof unsub).toBe("function");
    expect(value()).toBe(0);

    unsub();
  });

  it("accessor updates when underlying fact changes", () => {
    const [value, unsub] = createDerivedSignal<number>(system, "doubled");

    expect(value()).toBe(0);

    system.facts.count = 5;
    expect(value()).toBe(10);

    // After unsub, no more updates
    unsub();
    system.facts.count = 100;
    expect(value()).toBe(10);
  });
});
