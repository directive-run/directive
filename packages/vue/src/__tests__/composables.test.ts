import {
  createModule,
  createSystem,
  createRequirementStatusPlugin,
  t,
} from "@directive-run/core";
import type { Plugin, SingleModuleSystem } from "@directive-run/core";
import { effectScope, type EffectScope, type Ref, type ShallowRef } from "vue";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
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
  useNamespacedSelector,
  createTypedHooks,
  shallowEqual,
  type StatusPlugin,
} from "../index";

// ============================================================================
// Helpers
// ============================================================================

/** Flush pending microtasks so reconciliation completes */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

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

function createConstraintSystem() {
  const mod = createModule("constrained", {
    schema: {
      facts: {
        count: t.number(),
        ready: t.boolean(),
      },
      derivations: {
        doubled: t.number(),
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
        resolve: async (req, context) => {
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

function createSystemWithStatus(
  resolverFn?: (
    req: { type: string },
    context: { facts: { count: number; ready: boolean } },
  ) => Promise<void>,
) {
  const statusPlugin = createRequirementStatusPlugin();
  const mod = createModule("status-test", {
    schema: {
      facts: { count: t.number(), ready: t.boolean() },
    },
    init: (facts) => {
      facts.count = 0;
      facts.ready = false;
    },
    constraints: {
      needsData: {
        when: (facts) => !facts.ready,
        require: { type: "LOAD_DATA" },
      },
    },
    resolvers: {
      loadData: {
        requirement: "LOAD_DATA",
        resolve:
          resolverFn ??
          (async (_req, context) => {
            context.facts.ready = true;
          }),
      },
    },
  });
  // biome-ignore lint/suspicious/noExplicitAny: Plugin generic variance
  const system = createSystem({
    module: mod,
    plugins: [statusPlugin.plugin as Plugin<any>],
  });

  return { system, statusPlugin };
}

// ============================================================================
// useFact
// ============================================================================

describe("useFact", () => {
  let system: ReturnType<typeof createTestSystem>;
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
    system?.destroy();
  });

  it("reads initial single fact value", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<number | undefined>;

    scope.run(() => {
      value = useFact(system, "count");
    });

    expect(value.value).toBe(0);
  });

  it("updates when fact changes", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<number | undefined>;

    scope.run(() => {
      value = useFact(system, "count");
    });

    expect(value.value).toBe(0);

    system.facts.count = 5;

    expect(value.value).toBe(5);
  });

  it("reads string fact value", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<string | undefined>;

    scope.run(() => {
      value = useFact(system, "name");
    });

    expect(value.value).toBe("hello");
  });

  it("updates string fact when changed", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<string | undefined>;

    scope.run(() => {
      value = useFact(system, "name");
    });

    system.facts.name = "world";

    expect(value.value).toBe("world");
  });

  it("multi-key: reads multiple facts as object", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: ShallowRef<Record<string, unknown>>;

    scope.run(() => {
      value = useFact(system, ["count", "name"]);
    });

    expect(value.value).toEqual({ count: 0, name: "hello" });
  });

  it("multi-key: updates when any subscribed fact changes", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: ShallowRef<Record<string, unknown>>;

    scope.run(() => {
      value = useFact(system, ["count", "name"]);
    });

    system.facts.count = 10;

    expect(value.value).toEqual({ count: 10, name: "hello" });

    system.facts.name = "world";

    expect(value.value).toEqual({ count: 10, name: "world" });
  });

  it("cleanup on scope.stop() unsubscribes from store", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<number | undefined>;

    scope.run(() => {
      value = useFact(system, "count");
    });

    expect(value.value).toBe(0);

    system.facts.count = 5;
    expect(value.value).toBe(5);

    // Stop scope — unsubscribes
    scope.stop();

    // Further changes should not propagate
    system.facts.count = 99;
    expect(value.value).toBe(5);
  });

  it("returns undefined for non-existent fact key", () => {
    system = createTestSystem();
    scope = effectScope();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let value!: Ref<unknown>;

    scope.run(() => {
      // biome-ignore lint/suspicious/noExplicitAny: testing non-existent key
      value = useFact(system, "nonexistent" as any);
    });

    expect(value.value).toBeUndefined();
    warnSpy.mockRestore();
  });
});

// ============================================================================
// useDerived
// ============================================================================

describe("useDerived", () => {
  let system: ReturnType<typeof createTestSystem>;
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
    system?.destroy();
  });

  it("reads single derivation value", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<number>;

    scope.run(() => {
      value = useDerived(system, "doubled");
    });

    expect(value.value).toBe(0);
  });

  it("updates when underlying fact changes", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<number>;

    scope.run(() => {
      value = useDerived(system, "doubled");
    });

    expect(value.value).toBe(0);

    system.facts.count = 5;

    expect(value.value).toBe(10);
  });

  it("reads greeting derivation", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<string>;

    scope.run(() => {
      value = useDerived(system, "greeting");
    });

    expect(value.value).toBe("Hi, hello!");
  });

  it("multi-key: reads multiple derivations as object", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: ShallowRef<Record<string, unknown>>;

    scope.run(() => {
      value = useDerived(system, ["doubled", "greeting"]);
    });

    expect(value.value).toEqual({
      doubled: 0,
      greeting: "Hi, hello!",
    });
  });

  it("multi-key: updates when any underlying fact changes", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: ShallowRef<Record<string, unknown>>;

    scope.run(() => {
      value = useDerived(system, ["doubled", "greeting"]);
    });

    system.facts.count = 3;

    expect(value.value).toEqual({
      doubled: 6,
      greeting: "Hi, hello!",
    });
  });

  it("cleanup on scope.stop() unsubscribes", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<number>;

    scope.run(() => {
      value = useDerived(system, "doubled");
    });

    expect(value.value).toBe(0);

    system.facts.count = 5;
    expect(value.value).toBe(10);

    scope.stop();

    system.facts.count = 20;
    // Should remain at old value after scope stopped
    expect(value.value).toBe(10);
  });
});

// ============================================================================
// useSelector
// ============================================================================

describe("useSelector", () => {
  let system: ReturnType<typeof createTestSystem>;
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
    system?.destroy();
  });

  it("selects a single fact", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<number>;

    scope.run(() => {
      value = useSelector(system, (s) => s.count as number);
    });

    expect(value.value).toBe(0);
  });

  it("updates when selected fact changes", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<number>;

    scope.run(() => {
      value = useSelector(system, (s) => s.count as number);
    });

    system.facts.count = 5;

    expect(value.value).toBe(5);
  });

  it("does NOT update when an unselected fact changes", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<number>;

    scope.run(() => {
      value = useSelector(system, (s) => s.count as number);
    });

    const before = value.value;

    // Change unrelated fact
    system.facts.name = "world";

    expect(value.value).toBe(before);
  });

  it("selects from derivations", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<number>;

    scope.run(() => {
      value = useSelector(system, (s) => s.doubled as number);
    });

    expect(value.value).toBe(0);

    system.facts.count = 3;

    expect(value.value).toBe(6);
  });

  it("custom equality function prevents unnecessary updates", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<{ count: number }>;

    scope.run(() => {
      value = useSelector(
        system,
        (s) => ({ count: s.count as number }),
        shallowEqual,
      );
    });

    const first = value.value;
    expect(first).toEqual({ count: 0 });

    // Changing unrelated fact should not produce a new reference
    // because count is still 0 and shallowEqual returns true
    system.facts.name = "world";

    expect(value.value).toBe(first);
  });

  it("handles multiple rapid updates", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<number>;

    scope.run(() => {
      value = useSelector(system, (s) => s.count as number);
    });

    system.facts.count = 1;
    system.facts.count = 2;
    system.facts.count = 3;

    expect(value.value).toBe(3);
  });

  it("cleanup on scope.stop() unsubscribes", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<number>;

    scope.run(() => {
      value = useSelector(system, (s) => s.count as number);
    });

    system.facts.count = 5;
    expect(value.value).toBe(5);

    scope.stop();

    system.facts.count = 99;
    expect(value.value).toBe(5);
  });

  it("selects combined facts and derivations", () => {
    system = createTestSystem();
    scope = effectScope();
    let value!: Ref<{ count: number; doubled: number }>;

    scope.run(() => {
      value = useSelector(
        system,
        (s) => ({ count: s.count as number, doubled: s.doubled as number }),
        shallowEqual,
      );
    });

    expect(value.value).toEqual({ count: 0, doubled: 0 });

    system.facts.count = 4;

    expect(value.value).toEqual({ count: 4, doubled: 8 });
  });
});

// ============================================================================
// useDispatch
// ============================================================================

describe("useDispatch", () => {
  let system: ReturnType<typeof createTestSystem>;
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
    system?.destroy();
  });

  it("returns a dispatch function", () => {
    system = createTestSystem();
    scope = effectScope();
    let dispatch!: ReturnType<typeof useDispatch>;

    scope.run(() => {
      dispatch = useDispatch(system);
    });

    expect(typeof dispatch).toBe("function");
  });

  it("dispatching events updates facts", () => {
    system = createTestSystem();
    scope = effectScope();
    let dispatch!: ReturnType<typeof useDispatch>;
    let count!: Ref<number | undefined>;

    scope.run(() => {
      dispatch = useDispatch(system);
      count = useFact(system, "count");
    });

    expect(count.value).toBe(0);

    dispatch({ type: "increment" });

    expect(count.value).toBe(1);

    dispatch({ type: "setName", name: "dispatch-test" });

    expect(system.facts.name).toBe("dispatch-test");
  });

  it("dispatching increment multiple times", () => {
    system = createTestSystem();
    scope = effectScope();
    let dispatch!: ReturnType<typeof useDispatch>;

    scope.run(() => {
      dispatch = useDispatch(system);
    });

    dispatch({ type: "increment" });
    dispatch({ type: "increment" });
    dispatch({ type: "increment" });

    expect(system.facts.count).toBe(3);
  });
});

// ============================================================================
// useEvents
// ============================================================================

describe("useEvents", () => {
  let system: ReturnType<typeof createTestSystem>;
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
    system?.destroy();
  });

  it("returns events object with expected methods", () => {
    system = createTestSystem();
    scope = effectScope();
    let events!: ReturnType<typeof useEvents>;

    scope.run(() => {
      events = useEvents(system);
    });

    expect(events).toBeDefined();
    expect(typeof events.increment).toBe("function");
    expect(typeof events.setName).toBe("function");
  });

  it("calling event method updates system", () => {
    system = createTestSystem();
    scope = effectScope();
    let events!: ReturnType<typeof useEvents>;
    let count!: Ref<number | undefined>;

    scope.run(() => {
      events = useEvents(system);
      count = useFact(system, "count");
    });

    expect(count.value).toBe(0);

    events.increment();
    expect(count.value).toBe(1);

    events.increment();
    events.increment();
    expect(count.value).toBe(3);
  });
});

// ============================================================================
// useWatch
// ============================================================================

describe("useWatch", () => {
  let system: ReturnType<typeof createTestSystem>;
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
    system?.destroy();
  });

  it("calls callback when watched fact changes", () => {
    system = createTestSystem();
    scope = effectScope();
    const callback = vi.fn();

    scope.run(() => {
      useWatch(system, "count", callback);
    });

    system.facts.count = 42;

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("passes new and previous values to callback", () => {
    system = createTestSystem();
    scope = effectScope();
    const callback = vi.fn();

    scope.run(() => {
      useWatch(system, "count", callback);
    });

    system.facts.count = 10;

    expect(callback).toHaveBeenCalledWith(10, 0);

    system.facts.count = 20;

    expect(callback).toHaveBeenCalledWith(20, 10);
  });

  it("cleanup on scope.stop() stops watching", () => {
    system = createTestSystem();
    scope = effectScope();
    const callback = vi.fn();

    scope.run(() => {
      useWatch(system, "count", callback);
    });

    system.facts.count = 5;
    expect(callback).toHaveBeenCalledTimes(1);

    scope.stop();

    system.facts.count = 99;
    // Should not fire again after scope stopped
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("watches derivation changes", () => {
    system = createTestSystem();
    scope = effectScope();
    const callback = vi.fn();

    scope.run(() => {
      useWatch(system, "doubled", callback);
    });

    system.facts.count = 5;

    expect(callback).toHaveBeenCalled();
    // doubled goes from 0 to 10
    expect(callback).toHaveBeenCalledWith(10, 0);
  });
});

// ============================================================================
// useInspect
// ============================================================================

describe("useInspect", () => {
  let system: ReturnType<typeof createConstraintSystem>;
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
    system?.destroy();
  });

  it("returns InspectState with correct shape", () => {
    system = createConstraintSystem();
    scope = effectScope();
    let state!: ShallowRef<ReturnType<typeof useInspect>["value"]>;

    scope.run(() => {
      state = useInspect(system);
    });

    expect(state.value).toHaveProperty("isSettled");
    expect(state.value).toHaveProperty("unmet");
    expect(state.value).toHaveProperty("inflight");
    expect(state.value).toHaveProperty("isWorking");
    expect(state.value).toHaveProperty("hasUnmet");
    expect(state.value).toHaveProperty("hasInflight");
    expect(typeof state.value.isSettled).toBe("boolean");
    expect(Array.isArray(state.value.unmet)).toBe(true);
    expect(Array.isArray(state.value.inflight)).toBe(true);
  });

  it("updates reactively when system state changes", async () => {
    system = createConstraintSystem();
    scope = effectScope();
    let state!: ShallowRef<ReturnType<typeof useInspect>["value"]>;

    scope.run(() => {
      state = useInspect(system);
    });

    // Wait for the system to settle (resolver sets ready=true)
    await system.settle();

    expect(state.value.isSettled).toBe(true);
  });

  it("after resolver runs, unmet becomes empty", async () => {
    system = createConstraintSystem();
    scope = effectScope();
    let state!: ShallowRef<ReturnType<typeof useInspect>["value"]>;

    scope.run(() => {
      state = useInspect(system);
    });

    await system.settle();

    expect(state.value.unmet).toHaveLength(0);
    expect(state.value.hasUnmet).toBe(false);
  });

  it("with throttleMs option still returns valid InspectState", async () => {
    system = createConstraintSystem();
    scope = effectScope();
    let state!: ShallowRef<ReturnType<typeof useInspect>["value"]>;

    scope.run(() => {
      state = useInspect(system, { throttleMs: 200 });
    });

    expect(state.value).toHaveProperty("isSettled");
    expect(state.value).toHaveProperty("unmet");
    expect(state.value).toHaveProperty("isWorking");

    await system.settle();
    // After settle + throttle period
    await new Promise((r) => setTimeout(r, 300));

    expect(state.value.isSettled).toBe(true);
  });
});

// ============================================================================
// useRequirementStatus
// ============================================================================

describe("useRequirementStatus", () => {
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
  });

  it("returns status for a single requirement type", async () => {
    const gate = deferred();
    const { system, statusPlugin } = createSystemWithStatus(
      async (_req, context) => {
        await gate.promise;
        context.facts.ready = true;
      },
    );
    system.start();
    scope = effectScope();
    let status!: ShallowRef<{ pending: number; isLoading: boolean }>;

    scope.run(() => {
      status = useRequirementStatus(statusPlugin, "LOAD_DATA");
    });

    expect(status.value).toBeDefined();
    expect(typeof status.value.pending).toBe("number");
    expect(typeof status.value.isLoading).toBe("boolean");

    gate.resolve();
    await system.settle();
    scope.stop();
    system.destroy();
  });

  it("returns record of statuses for multiple types", async () => {
    const statusPlugin = createRequirementStatusPlugin();
    const mod = createModule("multi", {
      schema: {
        facts: { a: t.boolean(), b: t.boolean() },
      },
      init: (facts) => {
        facts.a = false;
        facts.b = false;
      },
      constraints: {
        needsA: {
          when: (facts) => !facts.a,
          require: { type: "LOAD_A" },
        },
        needsB: {
          when: (facts) => !facts.b,
          require: { type: "LOAD_B" },
        },
      },
      resolvers: {
        loadA: {
          requirement: "LOAD_A",
          resolve: async (_req, context) => {
            context.facts.a = true;
          },
        },
        loadB: {
          requirement: "LOAD_B",
          resolve: async (_req, context) => {
            context.facts.b = true;
          },
        },
      },
    });
    // biome-ignore lint/suspicious/noExplicitAny: Plugin generic variance
    const system = createSystem({
      module: mod,
      plugins: [statusPlugin.plugin as Plugin<any>],
    });
    system.start();
    scope = effectScope();
    let statuses!: ShallowRef<Record<string, { isLoading: boolean }>>;

    scope.run(() => {
      statuses = useRequirementStatus(statusPlugin, ["LOAD_A", "LOAD_B"]);
    });

    expect(statuses.value).toHaveProperty("LOAD_A");
    expect(statuses.value).toHaveProperty("LOAD_B");

    await system.settle();
    scope.stop();
    system.destroy();
  });

  it("updates reactively when requirement status changes", async () => {
    const gate = deferred();
    const { system, statusPlugin } = createSystemWithStatus(
      async (_req, context) => {
        await gate.promise;
        context.facts.ready = true;
      },
    );
    scope = effectScope();
    let status!: ShallowRef<{ isLoading: boolean; pending: number; inflight: number }>;

    scope.run(() => {
      status = useRequirementStatus(statusPlugin, "LOAD_DATA");
    });

    // Before start: nothing pending
    expect(status.value.isLoading).toBe(false);

    // Start the system
    system.start();
    await new Promise((r) => setTimeout(r, 50));

    expect(status.value.isLoading).toBe(true);

    // Resolve
    gate.resolve();
    await system.settle();

    expect(status.value.isLoading).toBe(false);

    scope.stop();
    system.destroy();
  });

  it("status has correct shape", () => {
    const { system, statusPlugin } = createSystemWithStatus();
    scope = effectScope();
    let status!: ShallowRef<Record<string, unknown>>;

    scope.run(() => {
      status = useRequirementStatus(statusPlugin, "LOAD_DATA");
    });

    expect(status.value).toHaveProperty("pending");
    expect(status.value).toHaveProperty("inflight");
    expect(status.value).toHaveProperty("failed");
    expect(status.value).toHaveProperty("isLoading");
    expect(status.value).toHaveProperty("hasError");
    expect(status.value).toHaveProperty("lastError");

    scope.stop();
    system.destroy();
  });
});

// ============================================================================
// useExplain
// ============================================================================

describe("useExplain", () => {
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
  });

  it("returns explanation string for a requirement", async () => {
    const mod = createModule("explaintest", {
      schema: {
        facts: {
          status: t.string(),
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

    // Wait for reconciliation
    await vi.waitFor(() => {
      expect(system.inspect().unmet.length).toBeGreaterThan(0);
    });

    const requirementId = system.inspect().unmet[0]!.id;

    scope = effectScope();
    let explanation!: Ref<string | null>;

    scope.run(() => {
      explanation = useExplain(system, requirementId);
    });

    expect(explanation.value).not.toBeNull();
    expect(typeof explanation.value).toBe("string");
    expect(explanation.value).toContain("LOAD_DATA");

    scope.stop();
    system.destroy();
  });

  it("returns null for non-existent requirement", async () => {
    const system = createConstraintSystem();
    await system.settle();

    scope = effectScope();
    let explanation!: Ref<string | null>;

    scope.run(() => {
      explanation = useExplain(system, "non-existent-requirement-id");
    });

    expect(explanation.value).toBeNull();

    scope.stop();
    system.destroy();
  });

  it("updates when system state changes", async () => {
    const mod = createModule("explainupdate", {
      schema: {
        facts: {
          status: t.string(),
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

    await vi.waitFor(() => {
      expect(system.inspect().unmet.length).toBeGreaterThan(0);
    });

    const requirementId = system.inspect().unmet[0]!.id;
    scope = effectScope();
    let explanation!: Ref<string | null>;

    scope.run(() => {
      explanation = useExplain(system, requirementId);
    });

    expect(explanation.value).not.toBeNull();

    // Resolve the condition
    system.facts.status = "loaded";

    await vi.waitFor(() => {
      expect(system.inspect().unmet.length).toBe(0);
    });

    // The requirement no longer exists
    expect(explanation.value).toBeNull();

    scope.stop();
    system.destroy();
  });
});

// ============================================================================
// useConstraintStatus
// ============================================================================

describe("useConstraintStatus", () => {
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
  });

  it("returns array of all constraints (no constraintId param)", async () => {
    const system = createConstraintSystem();
    await system.settle();

    scope = effectScope();
    let constraints!: ReturnType<typeof useConstraintStatus>;

    scope.run(() => {
      constraints = useConstraintStatus(system);
    });

    const list = constraints.value as Array<{ id: string }>;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((c) => c.id === "needsReady")).toBe(true);

    scope.stop();
    system.destroy();
  });

  it("returns specific constraint by ID", async () => {
    const system = createConstraintSystem();
    await system.settle();

    scope = effectScope();
    let constraint!: ReturnType<typeof useConstraintStatus>;

    scope.run(() => {
      constraint = useConstraintStatus(system, "needsReady");
    });

    const c = constraint.value as { id: string; active: boolean; priority: number } | null;
    expect(c).not.toBeNull();
    expect(c!.id).toBe("needsReady");

    scope.stop();
    system.destroy();
  });

  it("returns null for non-existent constraint ID", async () => {
    const system = createConstraintSystem();
    await system.settle();

    scope = effectScope();
    let constraint!: ReturnType<typeof useConstraintStatus>;

    scope.run(() => {
      constraint = useConstraintStatus(system, "does-not-exist");
    });

    expect(constraint.value).toBeNull();

    scope.stop();
    system.destroy();
  });
});

// ============================================================================
// useOptimisticUpdate
// ============================================================================

describe("useOptimisticUpdate", () => {
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
  });

  it("mutate applies update immediately", async () => {
    const { system } = createSystemWithStatus();
    system.start();
    await system.settle();

    scope = effectScope();
    let result!: ReturnType<typeof useOptimisticUpdate>;

    scope.run(() => {
      result = useOptimisticUpdate(system);
    });

    result.mutate(() => {
      system.facts.count = 42;
    });

    expect(system.facts.count).toBe(42);

    scope.stop();
    system.destroy();
  });

  it("isPending is true after mutate", async () => {
    const gate = deferred();
    const { system, statusPlugin } = createSystemWithStatus(
      async (_req, context) => {
        await gate.promise;
        context.facts.ready = true;
      },
    );
    system.start();
    await new Promise((r) => setTimeout(r, 50));

    scope = effectScope();
    let result!: ReturnType<typeof useOptimisticUpdate>;

    scope.run(() => {
      result = useOptimisticUpdate(system, statusPlugin, "LOAD_DATA");
    });

    result.mutate(() => {
      system.facts.count = 99;
    });

    expect(result.isPending.value).toBe(true);

    gate.resolve();
    await system.settle();

    scope.stop();
    system.destroy();
  });

  it("rollback restores previous state", async () => {
    const { system } = createSystemWithStatus();
    system.start();
    await system.settle();

    scope = effectScope();
    let result!: ReturnType<typeof useOptimisticUpdate>;

    scope.run(() => {
      result = useOptimisticUpdate(system);
    });

    const originalCount = system.facts.count;

    result.mutate(() => {
      system.facts.count = 999;
    });

    expect(system.facts.count).toBe(999);

    result.rollback();

    expect(system.facts.count).toBe(originalCount);

    scope.stop();
    system.destroy();
  });

  it("error is null initially", () => {
    const { system, statusPlugin } = createSystemWithStatus();
    system.start();

    scope = effectScope();
    let result!: ReturnType<typeof useOptimisticUpdate>;

    scope.run(() => {
      result = useOptimisticUpdate(system, statusPlugin, "LOAD_DATA");
    });

    expect(result.error.value).toBeNull();

    scope.stop();
    system.destroy();
  });
});

// ============================================================================
// useTimeTravel
// ============================================================================

describe("useTimeTravel", () => {
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
  });

  it("returns null when time-travel is disabled", () => {
    const system = createNoTimeTravelSystem();
    scope = effectScope();
    let state!: ShallowRef<ReturnType<typeof useTimeTravel>["value"]>;

    scope.run(() => {
      state = useTimeTravel(system);
    });

    expect(state.value).toBeNull();

    scope.stop();
    system.destroy();
  });

  it("returns TimeTravelState when enabled", () => {
    const system = createTimeTravelSystem();
    scope = effectScope();
    let state!: ShallowRef<ReturnType<typeof useTimeTravel>["value"]>;

    scope.run(() => {
      state = useTimeTravel(system);
    });

    expect(state.value).not.toBeNull();
    expect(state.value).toHaveProperty("canUndo");
    expect(state.value).toHaveProperty("canRedo");
    expect(state.value).toHaveProperty("undo");
    expect(state.value).toHaveProperty("redo");
    expect(state.value).toHaveProperty("currentIndex");
    expect(state.value).toHaveProperty("totalSnapshots");

    scope.stop();
    system.destroy();
  });

  it("after taking snapshots, canUndo becomes true", async () => {
    const system = createTimeTravelSystem();

    await flush();

    scope = effectScope();
    let state!: ShallowRef<ReturnType<typeof useTimeTravel>["value"]>;

    scope.run(() => {
      state = useTimeTravel(system);
    });

    system.facts.count = 1;
    await flush();

    system.facts.count = 2;
    await flush();

    expect(state.value).not.toBeNull();
    expect(state.value!.totalSnapshots).toBeGreaterThanOrEqual(2);
    expect(state.value!.canUndo).toBe(true);

    scope.stop();
    system.destroy();
  });

  it("undo restores previous state", async () => {
    const system = createTimeTravelSystem();

    await flush();

    scope = effectScope();
    let state!: ShallowRef<ReturnType<typeof useTimeTravel>["value"]>;

    scope.run(() => {
      state = useTimeTravel(system);
    });

    system.facts.count = 10;
    await flush();

    system.facts.count = 20;
    await flush();

    expect(system.facts.count).toBe(20);

    state.value!.undo();

    expect(system.facts.count).toBe(10);

    scope.stop();
    system.destroy();
  });
});

// ============================================================================
// useDirective
// ============================================================================

describe("useDirective", () => {
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
  });

  it("creates system with correct initial facts", () => {
    const mod = createModule("counter", {
      schema: {
        facts: {
          count: t.number(),
          name: t.string(),
        },
        derivations: {
          doubled: t.number(),
        },
        events: {
          increment: {},
        },
        requirements: {},
      },
      init: (facts) => {
        facts.count = 0;
        facts.name = "test";
      },
      derive: {
        doubled: (facts) => facts.count * 2,
      },
      events: {
        increment: (facts) => {
          facts.count += 1;
        },
      },
    });

    scope = effectScope();
    let result!: ReturnType<typeof useDirective>;

    scope.run(() => {
      result = useDirective(mod);
    });

    expect(result.system).toBeDefined();
    expect(result.facts.value).toHaveProperty("count");
    expect((result.facts.value as Record<string, unknown>).count).toBe(0);
    expect(result.derived.value).toHaveProperty("doubled");
    expect((result.derived.value as Record<string, unknown>).doubled).toBe(0);
  });

  it("facts and derived update reactively", () => {
    const mod = createModule("reactive-test", {
      schema: {
        facts: {
          count: t.number(),
        },
        derivations: {
          doubled: t.number(),
        },
      },
      init: (facts) => {
        facts.count = 0;
      },
      derive: {
        doubled: (facts) => facts.count * 2,
      },
    });

    scope = effectScope();
    let result!: ReturnType<typeof useDirective>;

    scope.run(() => {
      result = useDirective(mod);
    });

    expect((result.facts.value as Record<string, unknown>).count).toBe(0);

    result.system.facts.count = 5;

    expect((result.facts.value as Record<string, unknown>).count).toBe(5);
    expect((result.derived.value as Record<string, unknown>).doubled).toBe(10);
  });

  it("cleanup destroys system on scope.stop()", () => {
    const mod = createModule("cleanup-test", {
      schema: {
        facts: {
          count: t.number(),
        },
      },
      init: (facts) => {
        facts.count = 0;
      },
    });

    scope = effectScope();
    let result!: ReturnType<typeof useDirective>;

    scope.run(() => {
      result = useDirective(mod);
    });

    const destroySpy = vi.spyOn(result.system, "destroy");

    scope.stop();

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it("with status: true returns statusPlugin", () => {
    const mod = createModule("status-test", {
      schema: {
        facts: {
          count: t.number(),
        },
      },
      init: (facts) => {
        facts.count = 0;
      },
    });

    scope = effectScope();
    let result!: ReturnType<typeof useDirective>;

    scope.run(() => {
      result = useDirective(mod, { status: true });
    });

    expect(result.statusPlugin).toBeDefined();
    expect(typeof result.statusPlugin!.getStatus).toBe("function");
  });
});

// ============================================================================
// createTypedHooks
// ============================================================================

describe("createTypedHooks", () => {
  let system: ReturnType<typeof createTestSystem>;
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
    system?.destroy();
  });

  it("returns typed hook functions", () => {
    const hooks = createTypedHooks<typeof testSchema>();

    expect(typeof hooks.useFact).toBe("function");
    expect(typeof hooks.useDerived).toBe("function");
    expect(typeof hooks.useDispatch).toBe("function");
    expect(typeof hooks.useEvents).toBe("function");
    expect(typeof hooks.useWatch).toBe("function");
  });

  it("typed hooks work correctly", () => {
    system = createTestSystem();
    scope = effectScope();
    const hooks = createTypedHooks<typeof testSchema>();
    let count!: Ref<number | undefined>;

    scope.run(() => {
      count = hooks.useFact(system, "count");
    });

    expect(count.value).toBe(0);

    system.facts.count = 7;

    expect(count.value).toBe(7);
  });
});

// ============================================================================
// useNamespacedSelector
// ============================================================================

describe("useNamespacedSelector", () => {
  let scope: EffectScope;

  afterEach(() => {
    scope?.stop();
  });

  function createNamespacedSystem() {
    const auth = createModule("auth", {
      schema: {
        facts: { token: t.string() },
      },
      init: (facts) => {
        facts.token = "";
      },
    });
    const data = createModule("data", {
      schema: {
        facts: { count: t.number() },
        derivations: { doubled: t.number() },
      },
      init: (facts) => {
        facts.count = 0;
      },
      derive: { doubled: (facts) => (facts.count as number) * 2 },
    });
    const system = createSystem({ modules: { auth, data } });
    system.start();

    return system;
  }

  it("selects from a namespaced system", () => {
    const system = createNamespacedSystem();
    scope = effectScope();
    let value!: Ref<string>;

    scope.run(() => {
      value = useNamespacedSelector(
        system,
        ["auth.token"],
        (s) => s.facts.auth.token as string,
      );
    });

    expect(value.value).toBe("");

    scope.stop();
    system.destroy();
  });

  it("updates when subscribed key changes", () => {
    const system = createNamespacedSystem();
    scope = effectScope();
    let value!: Ref<number>;

    scope.run(() => {
      value = useNamespacedSelector(
        system,
        ["data.count"],
        (s) => s.facts.data.count as number,
      );
    });

    expect(value.value).toBe(0);

    system.facts.data.count = 42;

    expect(value.value).toBe(42);

    scope.stop();
    system.destroy();
  });

  it("does NOT update when unsubscribed key changes", () => {
    const system = createNamespacedSystem();
    scope = effectScope();
    let value!: Ref<number>;
    let updateCount = 0;

    scope.run(() => {
      value = useNamespacedSelector(
        system,
        ["data.count"],
        (s) => {
          updateCount++;

          return s.facts.data.count as number;
        },
      );
    });

    const initialUpdateCount = updateCount;

    // Change unsubscribed key
    system.facts.auth.token = "new-token";

    // Selector should not have been called again
    expect(updateCount).toBe(initialUpdateCount);
    expect(value.value).toBe(0);

    scope.stop();
    system.destroy();
  });
});
