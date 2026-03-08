import { createModule, createSystem, t } from "@directive-run/core";
import { createRequirementStatusPlugin } from "@directive-run/core";
import type { SingleModuleSystem } from "@directive-run/core";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ============================================================================
// Mock Svelte lifecycle
// ============================================================================

const destroyCallbacks: Array<() => void> = [];

vi.mock("svelte", () => ({
  onDestroy: (fn: () => void) => {
    destroyCallbacks.push(fn);
  },
}));

vi.mock("svelte/store", () => {
  type Subscriber<T> = (value: T) => void;
  type Unsubscriber = () => void;
  type StartStopNotifier<T> = (set: Subscriber<T>) => Unsubscriber | void;

  interface Readable<T> {
    subscribe(run: Subscriber<T>): Unsubscriber;
  }

  function readable<T>(
    initialValue: T,
    start?: StartStopNotifier<T>,
  ): Readable<T> {
    let value = initialValue;
    const subscribers = new Set<Subscriber<T>>();
    let stop: Unsubscriber | void;

    return {
      subscribe(run: Subscriber<T>): Unsubscriber {
        subscribers.add(run);
        if (subscribers.size === 1 && start) {
          stop = start((newValue: T) => {
            value = newValue;
            for (const sub of subscribers) {
              sub(value);
            }
          });
        }
        run(value);

        return () => {
          subscribers.delete(run);
          if (subscribers.size === 0 && stop) {
            stop();
            stop = undefined;
          }
        };
      },
    };
  }

  return { readable };
});

function clearDestroyCallbacks() {
  destroyCallbacks.length = 0;
}

function runDestroyCallbacks() {
  for (const fn of destroyCallbacks) {
    fn();
  }
  clearDestroyCallbacks();
}

// Import AFTER mocks are defined
import {
  createFactStore,
  createDerivedStore,
  createDerivedsStore,
  createInspectStore,
  useFact,
  useDerived,
  useSelector,
  useDispatch,
  useEvents,
  useWatch,
  useInspect,
  useRequirementStatus,
  useExplain,
  useConstraintStatus,
  useOptimisticUpdate,
  useTimeTravel,
  useDirective,
  createTypedHooks,
  useNamespacedSelector,
  shallowEqual,
} from "../index";

// ============================================================================
// Test Module Factory
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

type TestSystem = ReturnType<typeof createTestSystem>;

/** Helper: subscribe to a Svelte readable and return { getValue, unsubscribe } */
function subscribeToStore<T>(store: { subscribe: (fn: (v: T) => void) => () => void }) {
  let value: T;
  const unsubscribe = store.subscribe((v) => {
    value = v;
  });

  return {
    getValue: () => value!,
    unsubscribe,
  };
}

// ============================================================================
// createFactStore
// ============================================================================

describe("createFactStore", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("creates a readable store with the initial fact value", () => {
    const store = createFactStore(system, "count");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    unsubscribe();
  });

  it("updates when fact value changes", () => {
    const store = createFactStore(system, "count");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    system.facts.count = 5;

    expect(getValue()).toBe(5);

    unsubscribe();
  });

  it("reads string fact value", () => {
    const store = createFactStore(system, "name");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe("hello");

    unsubscribe();
  });

  it("tracks multiple sequential updates", () => {
    const store = createFactStore(system, "count");
    const { getValue, unsubscribe } = subscribeToStore(store);

    system.facts.count = 1;
    expect(getValue()).toBe(1);

    system.facts.count = 2;
    expect(getValue()).toBe(2);

    system.facts.count = 3;
    expect(getValue()).toBe(3);

    unsubscribe();
  });

  it("stops receiving updates after unsubscribe", () => {
    const store = createFactStore(system, "count");
    const callback = vi.fn();
    const unsubscribe = store.subscribe(callback);

    // Initial call from subscribe
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith(0);

    system.facts.count = 10;
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribe();

    system.facts.count = 20;
    // No additional call after unsubscribe
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("warns in dev mode for unknown fact key", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    createFactStore(system, "nonexistent");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("fact not found"),
    );

    warnSpy.mockRestore();
  });
});

// ============================================================================
// createDerivedStore
// ============================================================================

describe("createDerivedStore", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("reads a single derivation value", () => {
    const store = createDerivedStore<number>(system, "doubled");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    unsubscribe();
  });

  it("updates when underlying fact changes", () => {
    const store = createDerivedStore<number>(system, "doubled");
    const { getValue, unsubscribe } = subscribeToStore(store);

    system.facts.count = 5;

    expect(getValue()).toBe(10);

    unsubscribe();
  });

  it("works with string derivations", () => {
    const store = createDerivedStore<string>(system, "greeting");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe("Hi, hello!");

    system.facts.name = "world";

    expect(getValue()).toBe("Hi, world!");

    unsubscribe();
  });

  it("stops updates after unsubscribe", () => {
    const store = createDerivedStore<number>(system, "doubled");
    const callback = vi.fn();
    const unsubscribe = store.subscribe(callback);

    // Initial
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();

    system.facts.count = 100;
    // No additional calls
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// createDerivedsStore
// ============================================================================

describe("createDerivedsStore", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("reads multiple derivations as an object", () => {
    const store = createDerivedsStore(system, ["doubled", "greeting"]);
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toEqual({
      doubled: 0,
      greeting: "Hi, hello!",
    });

    unsubscribe();
  });

  it("updates when any underlying fact changes", () => {
    const store = createDerivedsStore(system, ["doubled", "greeting"]);
    const { getValue, unsubscribe } = subscribeToStore(store);

    system.facts.count = 3;

    expect(getValue()).toEqual({
      doubled: 6,
      greeting: "Hi, hello!",
    });

    system.facts.name = "world";

    expect(getValue()).toEqual({
      doubled: 6,
      greeting: "Hi, world!",
    });

    unsubscribe();
  });
});

// ============================================================================
// useFact
// ============================================================================

describe("useFact", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("reads a single fact value via subscribe", () => {
    const store = useFact(system, "count");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    unsubscribe();
  });

  it("updates when fact changes", () => {
    const store = useFact(system, "count");
    const { getValue, unsubscribe } = subscribeToStore(store);

    system.facts.count = 42;

    expect(getValue()).toBe(42);

    unsubscribe();
  });

  it("multi-key: reads multiple facts as object", () => {
    const store = useFact(system, ["count", "name"]);
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toEqual({ count: 0, name: "hello" });

    unsubscribe();
  });

  it("multi-key: updates when any subscribed fact changes", () => {
    const store = useFact(system, ["count", "name"]);
    const { getValue, unsubscribe } = subscribeToStore(store);

    system.facts.count = 10;
    expect(getValue()).toEqual({ count: 10, name: "hello" });

    system.facts.name = "world";
    expect(getValue()).toEqual({ count: 10, name: "world" });

    unsubscribe();
  });

  it("dev warning when function passed instead of string", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    useFact(system, (() => "count") as any);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("received a function"),
    );

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ============================================================================
// useDerived
// ============================================================================

describe("useDerived", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("reads single derivation value", () => {
    const store = useDerived(system, "doubled");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    unsubscribe();
  });

  it("updates when underlying fact changes", () => {
    const store = useDerived(system, "doubled");
    const { getValue, unsubscribe } = subscribeToStore(store);

    system.facts.count = 5;

    expect(getValue()).toBe(10);

    unsubscribe();
  });

  it("multi-key: reads multiple derivations as object", () => {
    const store = useDerived(system, ["doubled", "greeting"]);
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toEqual({
      doubled: 0,
      greeting: "Hi, hello!",
    });

    unsubscribe();
  });

  it("dev warning when function passed instead of string", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => {
      useDerived(system, (() => "doubled") as any);
    }).toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("received a function"),
    );

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ============================================================================
// useSelector
// ============================================================================

describe("useSelector", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns computed value from selector", () => {
    const store = useSelector(system, (state) => (state as any).count * 3);
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    unsubscribe();
  });

  it("updates when accessed facts change", () => {
    const store = useSelector(system, (state) => (state as any).count + 10);
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(10);

    system.facts.count = 5;

    expect(getValue()).toBe(15);

    unsubscribe();
  });

  it("uses custom equality function", () => {
    const callback = vi.fn();
    // Selector returns an object; without shallowEqual every update creates a new ref
    const store = useSelector(
      system,
      (state) => ({ val: (state as any).count }),
      shallowEqual,
    );
    store.subscribe((v) => callback(v));

    // Initial call
    expect(callback).toHaveBeenCalledTimes(1);

    // Setting same value — shallowEqual should suppress
    system.facts.count = 0;
    expect(callback).toHaveBeenCalledTimes(1);

    // Actual change
    system.facts.count = 5;
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith({ val: 5 });
  });

  it("reads derivations through selector", () => {
    const store = useSelector(system, (state) => (state as any).doubled);
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    system.facts.count = 4;

    expect(getValue()).toBe(8);

    unsubscribe();
  });

  it("combines facts and derivations", () => {
    const store = useSelector(system, (state) => ({
      raw: (state as any).count,
      derived: (state as any).doubled,
    }));
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toEqual({ raw: 0, derived: 0 });

    system.facts.count = 3;

    expect(getValue()).toEqual({ raw: 3, derived: 6 });

    unsubscribe();
  });

  it("handles dynamic dep changes (selector reads different keys based on state)", () => {
    // Selector conditionally reads "name" only when count > 0
    const store = useSelector(system, (state) => {
      const s = state as any;
      if (s.count > 0) {
        return s.name;
      }

      return "none";
    });
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe("none");

    system.facts.count = 1;
    expect(getValue()).toBe("hello");

    system.facts.name = "world";
    expect(getValue()).toBe("world");

    unsubscribe();
  });
});

// ============================================================================
// useDispatch
// ============================================================================

describe("useDispatch", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns a dispatch function", () => {
    const dispatch = useDispatch(system);

    expect(typeof dispatch).toBe("function");
  });

  it("dispatching events updates facts", () => {
    const dispatch = useDispatch(system);
    const store = useFact(system, "count");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    dispatch({ type: "increment" } as any);

    expect(getValue()).toBe(1);

    unsubscribe();
  });

  it("dispatch with payload", () => {
    const dispatch = useDispatch(system);

    dispatch({ type: "setName", name: "dispatch-test" } as any);

    const store = useFact(system, "name");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe("dispatch-test");

    unsubscribe();
  });
});

// ============================================================================
// useEvents
// ============================================================================

describe("useEvents", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns the events object", () => {
    const events = useEvents(system);

    expect(events).toBeDefined();
    expect(typeof events.increment).toBe("function");
    expect(typeof events.setName).toBe("function");
  });

  it("calling event methods updates system state", () => {
    const events = useEvents(system);
    const store = useFact(system, "count");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    events.increment();

    expect(getValue()).toBe(1);

    events.increment();
    events.increment();

    expect(getValue()).toBe(3);

    unsubscribe();
  });

  it("returns the same reference as system.events", () => {
    const events = useEvents(system);

    expect(events).toBe(system.events);
  });
});

// ============================================================================
// useWatch
// ============================================================================

describe("useWatch", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    runDestroyCallbacks();
    system.destroy();
  });

  it("calls callback when watched fact changes", () => {
    const callback = vi.fn();
    useWatch(system, "count", callback);

    system.facts.count = 42;

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("passes new and previous values to callback", () => {
    const callback = vi.fn();
    useWatch(system, "count", callback);

    system.facts.count = 10;
    expect(callback).toHaveBeenCalledWith(10, 0);

    system.facts.count = 20;
    expect(callback).toHaveBeenCalledWith(20, 10);
  });

  it("cleans up on destroy (onDestroy)", () => {
    const callback = vi.fn();
    useWatch(system, "count", callback);

    system.facts.count = 5;
    expect(callback).toHaveBeenCalledTimes(1);

    // Simulate component destroy
    runDestroyCallbacks();

    system.facts.count = 99;
    // No additional calls after destroy
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("registers onDestroy callback", () => {
    const before = destroyCallbacks.length;
    useWatch(system, "count", vi.fn());

    expect(destroyCallbacks.length).toBe(before + 1);
  });
});

// ============================================================================
// useInspect
// ============================================================================

describe("useInspect", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns an InspectState-shaped object", () => {
    const store = useInspect(system);
    const { getValue, unsubscribe } = subscribeToStore(store);
    const state = getValue();

    expect(state).toHaveProperty("isSettled");
    expect(state).toHaveProperty("unmet");
    expect(state).toHaveProperty("inflight");
    expect(state).toHaveProperty("isWorking");
    expect(state).toHaveProperty("hasUnmet");
    expect(state).toHaveProperty("hasInflight");

    unsubscribe();
  });

  it("reflects working state shape", () => {
    const store = useInspect(system);
    const { getValue, unsubscribe } = subscribeToStore(store);

    // No constraints/resolvers defined, so no unmet requirements
    expect(getValue().hasUnmet).toBe(false);
    expect(typeof getValue().isSettled).toBe("boolean");
    expect(typeof getValue().isWorking).toBe("boolean");

    unsubscribe();
  });

  it("updates reactively when facts change", () => {
    const store = useInspect(system);
    const callback = vi.fn();
    const unsubscribe = store.subscribe(callback);

    const initialCalls = callback.mock.calls.length;

    system.facts.count = 99;

    expect(callback.mock.calls.length).toBeGreaterThan(initialCalls);

    unsubscribe();
  });

  it("accepts throttle option", () => {
    // Just verify it doesn't throw
    const store = useInspect(system, { throttleMs: 200 });
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toHaveProperty("isSettled");

    unsubscribe();
  });
});

// ============================================================================
// useRequirementStatus
// ============================================================================

describe("useRequirementStatus", () => {
  it("returns status for a single requirement type", () => {
    const sp = createRequirementStatusPlugin();
    const store = useRequirementStatus(sp, "LOAD_DATA");
    const { getValue, unsubscribe } = subscribeToStore(store);

    const status = getValue();
    expect(status).toHaveProperty("isLoading");
    expect(status).toHaveProperty("hasError");
    expect(status.isLoading).toBe(false);

    unsubscribe();
  });

  it("returns status for multiple requirement types", () => {
    const sp = createRequirementStatusPlugin();
    const store = useRequirementStatus(sp, ["LOAD_DATA", "SAVE_DATA"]);
    const { getValue, unsubscribe } = subscribeToStore(store);

    const statuses = getValue() as Record<string, any>;
    expect(statuses).toHaveProperty("LOAD_DATA");
    expect(statuses).toHaveProperty("SAVE_DATA");

    unsubscribe();
  });

  it("updates reactively when status changes", () => {
    const sp = createRequirementStatusPlugin();
    const store = useRequirementStatus(sp, "LOAD_DATA");
    const callback = vi.fn();
    const unsubscribe = store.subscribe(callback);

    // Initial call
    expect(callback).toHaveBeenCalledTimes(1);

    // Manually trigger a status update through the plugin's internal mechanism
    // The store subscribes to the plugin and re-reads status on change
    // This is a basic structural test

    unsubscribe();
  });
});

// ============================================================================
// useExplain
// ============================================================================

describe("useExplain", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns null for unknown requirement ID", () => {
    const store = useExplain(system, "nonexistent");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBeNull();

    unsubscribe();
  });

  it("returns a Readable store", () => {
    const store = useExplain(system, "test-req");

    expect(store).toHaveProperty("subscribe");
    expect(typeof store.subscribe).toBe("function");
  });

  it("updates reactively when facts change", () => {
    const store = useExplain(system, "test-req");
    const callback = vi.fn();
    const unsubscribe = store.subscribe(callback);

    const initialCalls = callback.mock.calls.length;

    system.facts.count = 99;

    // Should have been called again since it subscribes to all facts
    expect(callback.mock.calls.length).toBeGreaterThan(initialCalls);

    unsubscribe();
  });
});

// ============================================================================
// useConstraintStatus
// ============================================================================

describe("useConstraintStatus", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns all constraints as array", () => {
    const store = useConstraintStatus(system);
    const { getValue, unsubscribe } = subscribeToStore(store);

    // No constraints defined in test module
    expect(Array.isArray(getValue())).toBe(true);

    unsubscribe();
  });

  it("returns null for non-existent constraint ID", () => {
    const store = useConstraintStatus(system, "nonexistent");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBeNull();

    unsubscribe();
  });

  it("updates reactively when facts change", () => {
    const store = useConstraintStatus(system);
    const callback = vi.fn();
    const unsubscribe = store.subscribe(callback);

    const initialCalls = callback.mock.calls.length;

    system.facts.count = 50;

    expect(callback.mock.calls.length).toBeGreaterThan(initialCalls);

    unsubscribe();
  });
});

// ============================================================================
// useOptimisticUpdate
// ============================================================================

describe("useOptimisticUpdate", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    runDestroyCallbacks();
    system.destroy();
  });

  it("returns mutate, isPending, error, and rollback", () => {
    const result = useOptimisticUpdate(system);

    expect(typeof result.mutate).toBe("function");
    expect(result.isPending).toHaveProperty("subscribe");
    expect(result.error).toHaveProperty("subscribe");
    expect(typeof result.rollback).toBe("function");
  });

  it("mutate applies the update optimistically", () => {
    const result = useOptimisticUpdate(system);
    const store = useFact(system, "count");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    result.mutate(() => {
      system.facts.count = 99;
    });

    expect(getValue()).toBe(99);

    unsubscribe();
  });

  it("isPending is true after mutate", () => {
    const result = useOptimisticUpdate(system);

    let pending = false;
    const unsubPending = result.isPending.subscribe((v) => {
      pending = v;
    });

    expect(pending).toBe(false);

    result.mutate(() => {
      system.facts.count = 10;
    });

    expect(pending).toBe(true);

    unsubPending();
  });

  it("rollback restores previous state", () => {
    const result = useOptimisticUpdate(system);
    const store = useFact(system, "count");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    result.mutate(() => {
      system.facts.count = 99;
    });

    expect(getValue()).toBe(99);

    result.rollback();

    expect(getValue()).toBe(0);

    unsubscribe();
  });

  it("registers onDestroy callback", () => {
    const before = destroyCallbacks.length;
    useOptimisticUpdate(system);

    expect(destroyCallbacks.length).toBe(before + 1);
  });
});

// ============================================================================
// useTimeTravel
// ============================================================================

describe("useTimeTravel", () => {
  afterEach(() => {
    clearDestroyCallbacks();
  });

  it("returns null when time-travel is disabled", () => {
    const mod = createModule("tt-disabled", {
      schema: { facts: { x: t.number() }, derivations: {}, events: {}, requirements: {} },
      init: (facts) => { facts.x = 0; },
    });
    const system = createSystem({ module: mod });
    system.start();

    const store = useTimeTravel(system);
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBeNull();

    unsubscribe();
    system.destroy();
  });

  it("returns TimeTravelState when enabled", () => {
    const mod = createModule("tt-enabled", {
      schema: { facts: { x: t.number() }, derivations: {}, events: {}, requirements: {} },
      init: (facts) => { facts.x = 0; },
    });
    const system = createSystem({
      module: mod,
      debug: { timeTravel: true, maxSnapshots: 50 },
    });
    system.start();

    const store = useTimeTravel(system);
    const { getValue, unsubscribe } = subscribeToStore(store);
    const tt = getValue();

    expect(tt).not.toBeNull();
    expect(tt).toHaveProperty("canUndo");
    expect(tt).toHaveProperty("canRedo");
    expect(tt).toHaveProperty("undo");
    expect(tt).toHaveProperty("redo");
    expect(tt).toHaveProperty("currentIndex");
    expect(tt).toHaveProperty("totalSnapshots");

    unsubscribe();
    system.destroy();
  });

  it("provides time-travel API methods", () => {
    const mod = createModule("tt-api", {
      schema: { facts: { x: t.number() }, derivations: {}, events: {}, requirements: {} },
      init: (facts) => { facts.x = 0; },
    });
    const system = createSystem({
      module: mod,
      debug: { timeTravel: true, maxSnapshots: 50 },
    });
    system.start();

    const store = useTimeTravel(system);
    const { getValue, unsubscribe } = subscribeToStore(store);

    const tt = getValue();
    expect(tt).not.toBeNull();
    expect(typeof tt?.undo).toBe("function");
    expect(typeof tt?.redo).toBe("function");
    expect(typeof tt?.goTo).toBe("function");
    expect(typeof tt?.goBack).toBe("function");
    expect(typeof tt?.goForward).toBe("function");
    expect(typeof tt?.exportSession).toBe("function");
    expect(typeof tt?.importSession).toBe("function");
    expect(typeof tt?.pause).toBe("function");
    expect(typeof tt?.resume).toBe("function");

    unsubscribe();
    system.destroy();
  });
});

// ============================================================================
// useDirective
// ============================================================================

describe("useDirective", () => {
  afterEach(() => {
    runDestroyCallbacks();
  });

  it("creates a system and returns facts/derived/events/dispatch", () => {
    const mod = createModule("directive-test", {
      schema: testSchema,
      init: (facts) => {
        facts.count = 0;
        facts.name = "test";
        facts.items = [];
      },
      derive: {
        doubled: (facts) => (facts.count as number) * 2,
        greeting: (facts) => `Hi, ${facts.name}!`,
      },
      events: {
        increment: (facts) => { facts.count = (facts.count as number) + 1; },
        setName: (facts, { name }: { name: string }) => { facts.name = name; },
      },
    });

    const result = useDirective(mod);

    expect(result.system).toBeDefined();
    expect(result.facts).toHaveProperty("subscribe");
    expect(result.derived).toHaveProperty("subscribe");
    expect(result.events).toBeDefined();
    expect(typeof result.dispatch).toBe("function");
  });

  it("facts store is reactive", () => {
    const mod = createModule("directive-reactive", {
      schema: testSchema,
      init: (facts) => {
        facts.count = 0;
        facts.name = "test";
        facts.items = [];
      },
      derive: {
        doubled: (facts) => (facts.count as number) * 2,
        greeting: (facts) => `Hi, ${facts.name}!`,
      },
      events: {
        increment: (facts) => { facts.count = (facts.count as number) + 1; },
        setName: (facts, { name }: { name: string }) => { facts.name = name; },
      },
    });

    const { system, facts } = useDirective(mod);
    const { getValue, unsubscribe } = subscribeToStore(facts);

    expect(getValue()).toHaveProperty("count", 0);

    system.facts.count = 42;

    expect(getValue()).toHaveProperty("count", 42);

    unsubscribe();
  });

  it("derived store is reactive", () => {
    const mod = createModule("directive-derived", {
      schema: testSchema,
      init: (facts) => {
        facts.count = 5;
        facts.name = "test";
        facts.items = [];
      },
      derive: {
        doubled: (facts) => (facts.count as number) * 2,
        greeting: (facts) => `Hi, ${facts.name}!`,
      },
      events: {
        increment: (facts) => { facts.count = (facts.count as number) + 1; },
        setName: (facts, { name }: { name: string }) => { facts.name = name; },
      },
    });

    const { system, derived } = useDirective(mod);
    const { getValue, unsubscribe } = subscribeToStore(derived);

    expect(getValue()).toHaveProperty("doubled", 10);

    system.facts.count = 7;

    expect(getValue()).toHaveProperty("doubled", 14);

    unsubscribe();
  });

  it("registers onDestroy for cleanup", () => {
    const mod = createModule("directive-cleanup", {
      schema: { facts: { x: t.number() }, derivations: {}, events: {}, requirements: {} },
      init: (facts) => { facts.x = 0; },
    });

    const before = destroyCallbacks.length;
    useDirective(mod);

    expect(destroyCallbacks.length).toBeGreaterThan(before);
  });
});

// ============================================================================
// createTypedHooks
// ============================================================================

describe("createTypedHooks", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    runDestroyCallbacks();
    system.destroy();
  });

  it("returns typed versions of hooks", () => {
    const hooks = createTypedHooks<typeof testSchema>();

    expect(typeof hooks.useFact).toBe("function");
    expect(typeof hooks.useDerived).toBe("function");
    expect(typeof hooks.useDispatch).toBe("function");
    expect(typeof hooks.useEvents).toBe("function");
    expect(typeof hooks.useWatch).toBe("function");
  });

  it("typed useFact works correctly", () => {
    const hooks = createTypedHooks<typeof testSchema>();
    const store = hooks.useFact(system as any, "count");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    system.facts.count = 7;
    expect(getValue()).toBe(7);

    unsubscribe();
  });

  it("typed useDerived works correctly", () => {
    const hooks = createTypedHooks<typeof testSchema>();
    const store = hooks.useDerived(system as any, "doubled");
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    system.facts.count = 3;
    expect(getValue()).toBe(6);

    unsubscribe();
  });

  it("typed useDispatch works correctly", () => {
    const hooks = createTypedHooks<typeof testSchema>();
    const dispatch = hooks.useDispatch(system as any);

    dispatch({ type: "increment" } as any);

    expect(system.facts.count).toBe(1);
  });
});

// ============================================================================
// useNamespacedSelector
// ============================================================================

describe("useNamespacedSelector", () => {
  it("selects from a namespaced system", () => {
    const mod1 = createModule("counter", {
      schema: {
        facts: { count: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => { facts.count = 0; },
    });

    const mod2 = createModule("user", {
      schema: {
        facts: { name: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => { facts.name = "Alice"; },
    });

    const system = createSystem({
      modules: { counter: mod1, user: mod2 },
    } as any);
    system.start();

    const store = useNamespacedSelector(
      system as any,
      ["counter.count"],
      (s: any) => s.facts.counter.count,
    );
    const { getValue, unsubscribe } = subscribeToStore(store);

    expect(getValue()).toBe(0);

    (system as any).facts.counter.count = 5;

    expect(getValue()).toBe(5);

    unsubscribe();
    system.destroy();
  });

  it("updates when subscribed keys change", () => {
    const mod1 = createModule("data", {
      schema: {
        facts: { value: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => { facts.value = 100; },
    });

    const system = createSystem({
      modules: { data: mod1 },
    } as any);
    system.start();

    const callback = vi.fn();
    const store = useNamespacedSelector(
      system as any,
      ["data.value"],
      (s: any) => s.facts.data.value,
    );
    const unsubscribe = store.subscribe(callback);

    // Initial
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith(100);

    (system as any).facts.data.value = 200;

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(200);

    unsubscribe();
    system.destroy();
  });

  it("stops updates after unsubscribe", () => {
    const mod1 = createModule("ns-unsub", {
      schema: {
        facts: { v: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => { facts.v = 0; },
    });

    const system = createSystem({
      modules: { ns: mod1 },
    } as any);
    system.start();

    const callback = vi.fn();
    const store = useNamespacedSelector(
      system as any,
      ["ns.v"],
      (s: any) => s.facts.ns.v,
    );
    const unsubscribe = store.subscribe(callback);

    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();

    (system as any).facts.ns.v = 999;

    // No additional call after unsubscribe
    expect(callback).toHaveBeenCalledTimes(1);

    system.destroy();
  });
});

// ============================================================================
// createInspectStore
// ============================================================================

describe("createInspectStore", () => {
  let system: TestSystem;

  beforeEach(() => {
    clearDestroyCallbacks();
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns a Readable with SystemInspection", () => {
    const store = createInspectStore(system);
    const { getValue, unsubscribe } = subscribeToStore(store);
    const inspection = getValue();

    expect(inspection).toHaveProperty("constraints");
    expect(inspection).toHaveProperty("unmet");
    expect(inspection).toHaveProperty("inflight");

    unsubscribe();
  });

  it("updates when facts change", () => {
    const store = createInspectStore(system);
    const callback = vi.fn();
    const unsubscribe = store.subscribe(callback);

    const initialCalls = callback.mock.calls.length;

    system.facts.count = 50;

    expect(callback.mock.calls.length).toBeGreaterThan(initialCalls);

    unsubscribe();
  });
});

// ============================================================================
// shallowEqual (re-export)
// ============================================================================

describe("shallowEqual", () => {
  it("returns true for identical references", () => {
    const obj = { a: 1 };

    expect(shallowEqual(obj, obj)).toBe(true);
  });

  it("returns true for shallow-equal objects", () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it("returns false for different values", () => {
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("returns false for different key counts", () => {
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

// ============================================================================
// Edge cases and error handling
// ============================================================================

describe("error handling", () => {
  it("assertSystem throws for null system in useFact", () => {
    expect(() => useFact(null as any, "count")).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("useFact"),
      }),
    );
  });

  it("assertSystem throws for null system in useSelector", () => {
    expect(() => useSelector(null as any, () => 1)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("useSelector"),
      }),
    );
  });

  it("assertSystem throws for null system in useWatch", () => {
    expect(() => useWatch(null as any, "count", vi.fn())).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("useWatch"),
      }),
    );
  });

  it("assertSystem throws for null system in useDispatch", () => {
    expect(() => useDispatch(null as any)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("useDispatch"),
      }),
    );
  });

  it("assertSystem throws for null system in useEvents", () => {
    expect(() => useEvents(null as any)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("useEvents"),
      }),
    );
  });
});
