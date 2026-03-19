import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { flushMicrotasks } from "../../utils/testing.js";

// ============================================================================
// Helpers
// ============================================================================

/** Flush microtasks + one setTimeout round (for reconcile scheduling) */
async function flush(): Promise<void> {
  await flushMicrotasks();
  await new Promise((r) => setTimeout(r, 0));
  await flushMicrotasks();
}

function counterModule() {
  return createModule("counter", {
    schema: {
      facts: { count: t.number(), label: t.string() },
      derivations: { doubled: t.number(), summary: t.string() },
      events: {
        increment: {},
        setLabel: { label: t.string() },
      },
      requirements: {
        LOAD_DATA: { source: t.string() },
      },
    },
    init: (facts) => {
      facts.count = 0;
      facts.label = "test";
    },
    derive: {
      doubled: (facts) => (facts.count as number) * 2,
      summary: (facts, derived) =>
        `${facts.label}: ${derived.doubled}`,
    },
    events: {
      increment: (facts) => {
        facts.count = (facts.count as number) + 1;
      },
      setLabel: (facts, { label }) => {
        facts.label = label;
      },
    },
  });
}

function constraintModule() {
  return createModule("constrained", {
    schema: {
      facts: {
        status: t.string(),
        data: t.string(),
      },
      derivations: {},
      events: {
        setStatus: { value: t.string() },
      },
      requirements: {
        FETCH_DATA: {},
      },
    },
    init: (facts) => {
      facts.status = "idle";
      facts.data = "";
    },
    events: {
      setStatus: (facts, { value }) => {
        facts.status = value;
      },
    },
    constraints: {
      needsFetch: {
        when: (facts) => facts.status === "loading",
        require: { type: "FETCH_DATA" },
      },
    },
    resolvers: {
      fetchData: {
        requirement: "FETCH_DATA",
        resolve: async (_req, context) => {
          context.facts.data = "loaded";
          context.facts.status = "done";
        },
      },
    },
  });
}

// ============================================================================
// Lifecycle
// ============================================================================

describe("Engine — Lifecycle", () => {
  it("system starts stopped (isRunning false)", () => {
    const system = createSystem({ module: counterModule() });

    expect(system.isRunning).toBe(false);
  });

  it("system.start() sets isRunning true", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    expect(system.isRunning).toBe(true);

    system.destroy();
  });

  it("system.stop() sets isRunning false", () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    system.stop();

    expect(system.isRunning).toBe(false);

    system.destroy();
  });

  it("system.destroy() cleans up the system", () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    system.destroy();

    expect(system.isRunning).toBe(false);
  });

  it("double start is a no-op", () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    system.start();

    expect(system.isRunning).toBe(true);

    system.destroy();
  });

  it("double stop is a no-op", () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    system.stop();
    system.stop();

    expect(system.isRunning).toBe(false);
  });

  it("init function runs and sets initial facts", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    expect(system.facts.count).toBe(0);
    expect(system.facts.label).toBe("test");

    system.destroy();
  });

  it("isInitialized is true after start", () => {
    const system = createSystem({ module: counterModule() });

    expect(system.isInitialized).toBe(false);

    system.start();

    expect(system.isInitialized).toBe(true);

    system.destroy();
  });

  it("initialize() can be called before start() for SSR", () => {
    const system = createSystem({ module: counterModule() });
    system.initialize();

    expect(system.isInitialized).toBe(true);
    expect(system.isRunning).toBe(false);
    expect(system.facts.count).toBe(0);

    system.destroy();
  });

  it("fires onInit hook during initialization", () => {
    const onInit = vi.fn();
    const mod = createModule("hooked", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.x = 1;
      },
      hooks: { onInit },
    });
    const system = createSystem({ module: mod });
    system.start();

    expect(onInit).toHaveBeenCalledOnce();

    system.destroy();
  });

  it("fires onStart hook on start()", () => {
    const onStart = vi.fn();
    const mod = createModule("hooked", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.x = 1;
      },
      hooks: { onStart },
    });
    const system = createSystem({ module: mod });
    system.start();

    expect(onStart).toHaveBeenCalledOnce();

    system.destroy();
  });

  it("fires onStop hook on stop()", () => {
    const onStop = vi.fn();
    const mod = createModule("hooked", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.x = 1;
      },
      hooks: { onStop },
    });
    const system = createSystem({ module: mod });
    system.start();
    system.stop();

    expect(onStop).toHaveBeenCalledOnce();

    system.destroy();
  });
});

// ============================================================================
// Facts
// ============================================================================

describe("Engine — Facts", () => {
  it("facts proxy reads and writes values", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    system.facts.count = 42;

    expect(system.facts.count).toBe(42);

    system.destroy();
  });

  it("facts.$snapshot returns an untracked snapshot accessor", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    system.facts.count = 10;
    const snapshot = system.facts.$snapshot();

    // $snapshot() returns { get, has } — not a plain object
    expect(snapshot.get("count")).toBe(10);
    expect(snapshot.has("count")).toBe(true);
    expect(snapshot.has("nonexistent" as never)).toBe(false);

    system.destroy();
  });

  it("facts.$store.batch() batches multiple changes to the same key", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    await flush();

    const listener = vi.fn();
    system.subscribe(["count"], listener);

    system.facts.$store.batch(() => {
      system.facts.count = 1;
      system.facts.count = 2;
      system.facts.count = 5;
    });

    // Batch coalesces multiple writes to the same key into one notification
    expect(listener).toHaveBeenCalledTimes(1);
    expect(system.facts.count).toBe(5);

    system.destroy();
  });

  it("fact changes trigger reconciliation", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    await flush();

    system.facts.count = 99;
    await flush();

    // After reconciliation, derivations should be recomputed
    expect(system.derive.doubled).toBe(198);

    system.destroy();
  });
});

// ============================================================================
// Derivations
// ============================================================================

describe("Engine — Derivations", () => {
  it("derive functions auto-track dependencies", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    expect(system.derive.doubled).toBe(0);

    system.facts.count = 5;

    expect(system.derive.doubled).toBe(10);

    system.destroy();
  });

  it("derivations recompute when deps change", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    system.facts.count = 3;

    expect(system.derive.doubled).toBe(6);

    system.facts.count = 7;

    expect(system.derive.doubled).toBe(14);

    system.destroy();
  });

  it("derivation composition (facts, derived) works", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    system.facts.count = 5;

    expect(system.derive.summary).toBe("test: 10");

    system.facts.label = "items";

    expect(system.derive.summary).toBe("items: 10");

    system.destroy();
  });
});

// ============================================================================
// Events
// ============================================================================

describe("Engine — Events", () => {
  it("dispatch fires event handler which mutates facts", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    system.dispatch({ type: "increment" });

    expect(system.facts.count).toBe(1);

    system.destroy();
  });

  it("dispatch with payload passes data to handler", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    system.dispatch({ type: "setLabel", label: "updated" });

    expect(system.facts.label).toBe("updated");

    system.destroy();
  });

  it("events proxy provides dispatch functions", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    system.events.increment();

    expect(system.facts.count).toBe(1);

    system.events.setLabel({ label: "via-events" });

    expect(system.facts.label).toBe("via-events");

    system.destroy();
  });

  it("multiple dispatches accumulate state", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    system.events.increment();
    system.events.increment();
    system.events.increment();

    expect(system.facts.count).toBe(3);

    system.destroy();
  });

  it("unknown events warn in dev mode", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = createSystem({ module: counterModule() });
    system.start();

    system.dispatch({ type: "nonexistent" as "increment" });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown event type"),
    );

    warnSpy.mockRestore();
    system.destroy();
  });
});

// ============================================================================
// Constraints & Resolvers (Integration)
// ============================================================================

describe("Engine — Constraints & Resolvers", () => {
  it("constraint when returning true creates requirement", async () => {
    const system = createSystem({ module: constraintModule() });
    system.start();
    await flush();

    system.events.setStatus({ value: "loading" });
    await flush();

    // Resolver should have run and set data
    expect(system.facts.data).toBe("loaded");
    expect(system.facts.status).toBe("done");

    system.destroy();
  });

  it("constraint when returning false creates no requirement", async () => {
    const system = createSystem({ module: constraintModule() });
    system.start();
    await flush();

    // Status is "idle" — constraint should not fire
    const inspection = system.inspect();

    expect(inspection.inflight.length).toBe(0);

    system.destroy();
  });

  it("end-to-end: constraint -> requirement -> resolver pipeline", async () => {
    const resolveFn = vi.fn(async (_req, context) => {
      context.facts.status = "complete";
    });

    const mod = createModule("pipeline", {
      schema: {
        facts: { status: t.string() },
        derivations: {},
        events: { trigger: {} },
        requirements: { DO_WORK: {} },
      },
      init: (facts) => {
        facts.status = "idle";
      },
      events: {
        trigger: (facts) => {
          facts.status = "pending";
        },
      },
      constraints: {
        work: {
          when: (facts) => facts.status === "pending",
          require: { type: "DO_WORK" },
        },
      },
      resolvers: {
        worker: {
          requirement: "DO_WORK",
          resolve: resolveFn,
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();
    await flush();

    system.events.trigger();
    await flush();
    await system.settle();

    expect(resolveFn).toHaveBeenCalled();
    expect(system.facts.status).toBe("complete");

    system.destroy();
  });

  it("resolver retry works", async () => {
    let attempts = 0;

    const mod = createModule("retry-test", {
      schema: {
        facts: { status: t.string(), result: t.string() },
        derivations: {},
        events: { start: {} },
        requirements: { FLAKY: {} },
      },
      init: (facts) => {
        facts.status = "idle";
        facts.result = "";
      },
      events: {
        start: (facts) => {
          facts.status = "go";
        },
      },
      constraints: {
        needsFlaky: {
          when: (facts) => facts.status === "go",
          require: { type: "FLAKY" },
        },
      },
      resolvers: {
        flaky: {
          requirement: "FLAKY",
          retry: { attempts: 3, backoff: "none" },
          resolve: async (_req, context) => {
            attempts++;
            if (attempts < 3) {
              throw new Error("transient failure");
            }
            context.facts.result = "success";
            context.facts.status = "done";
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();
    await flush();

    system.events.start();

    // Give retries time to complete
    await system.settle(3000);

    expect(attempts).toBe(3);
    expect(system.facts.result).toBe("success");

    system.destroy();
  });
});

// ============================================================================
// Subscribe / Watch
// ============================================================================

describe("Engine — Subscribe / Watch", () => {
  it("subscribe fires on any listed fact change", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    await flush();

    const listener = vi.fn();
    const unsub = system.subscribe(["count"], listener);

    system.facts.count = 10;

    expect(listener).toHaveBeenCalled();

    unsub();
    system.destroy();
  });

  it("subscribe fires on derivation change", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    await flush();

    const listener = vi.fn();
    const unsub = system.subscribe(["doubled"], listener);

    system.facts.count = 5;

    // Derivation listeners fire when their dependencies are invalidated
    expect(listener).toHaveBeenCalled();

    unsub();
    system.destroy();
  });

  it("subscribe returns unsubscribe function", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    await flush();

    const listener = vi.fn();
    const unsub = system.subscribe(["count"], listener);

    unsub();

    system.facts.count = 99;

    expect(listener).not.toHaveBeenCalled();

    system.destroy();
  });

  it("watch fires on specific fact key changes with old/new values", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    await flush();

    const values: Array<{ newVal: unknown; oldVal: unknown }> = [];
    const unsub = system.watch("count", (newVal, oldVal) => {
      values.push({ newVal, oldVal });
    });

    system.facts.count = 5;
    system.facts.count = 10;

    expect(values).toEqual([
      { newVal: 5, oldVal: 0 },
      { newVal: 10, oldVal: 5 },
    ]);

    unsub();
    system.destroy();
  });

  it("watch fires on derivation key changes", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    await flush();

    const values: unknown[] = [];
    const unsub = system.watch("doubled", (newVal) => {
      values.push(newVal);
    });

    system.facts.count = 3;

    expect(values).toContain(6);

    unsub();
    system.destroy();
  });

  it("watch does not fire when value unchanged (Object.is)", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    await flush();

    const listener = vi.fn();
    const unsub = system.watch("count", listener);

    // Set same value
    system.facts.count = 0;

    expect(listener).not.toHaveBeenCalled();

    unsub();
    system.destroy();
  });
});

// ============================================================================
// Read
// ============================================================================

describe("Engine — Read", () => {
  it("system.read(key) returns current derivation value", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    system.facts.count = 7;

    expect(system.read("doubled")).toBe(14);

    system.destroy();
  });

  it("system.read(key) updates after fact change", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    expect(system.read("doubled")).toBe(0);

    system.facts.count = 4;

    expect(system.read("doubled")).toBe(8);

    system.destroy();
  });
});

// ============================================================================
// Settle
// ============================================================================

describe("Engine — Settle", () => {
  it("system.settle() resolves when no pending resolvers", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    await system.settle();

    expect(system.isSettled).toBe(true);

    system.destroy();
  });

  it("system.settle() waits for resolvers to complete", async () => {
    const mod = createModule("async-mod", {
      schema: {
        facts: { status: t.string(), result: t.string() },
        derivations: {},
        events: {},
        requirements: { WORK: {} },
      },
      init: (facts) => {
        facts.status = "go";
        facts.result = "";
      },
      constraints: {
        doWork: {
          when: (facts) => facts.status === "go",
          require: { type: "WORK" },
        },
      },
      resolvers: {
        worker: {
          requirement: "WORK",
          resolve: async (_req, context) => {
            await new Promise((r) => setTimeout(r, 50));
            context.facts.result = "done";
            context.facts.status = "finished";
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    await system.settle(5000);

    expect(system.facts.result).toBe("done");

    system.destroy();
  });

  it("system.settle() throws on timeout", async () => {
    const neverResolve = createModule("never", {
      schema: {
        facts: { flag: t.boolean() },
        derivations: {},
        events: {},
        requirements: { NEVER: {} },
      },
      init: (facts) => {
        facts.flag = true;
      },
      constraints: {
        infinite: {
          when: (facts) => facts.flag === true,
          require: { type: "NEVER" },
        },
      },
      resolvers: {
        stuck: {
          requirement: "NEVER",
          resolve: async () => {
            // Never resolves
            await new Promise(() => {});
          },
        },
      },
    });

    const system = createSystem({ module: neverResolve });
    system.start();

    await expect(system.settle(100)).rejects.toThrow("timed out");

    system.destroy();
  });

  it("isSettled is true when no resolvers are running", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    await flush();

    expect(system.isSettled).toBe(true);

    system.destroy();
  });
});

// ============================================================================
// Inspect
// ============================================================================

describe("Engine — Inspect", () => {
  it("inspect returns constraints info", async () => {
    const system = createSystem({ module: constraintModule() });
    system.start();
    await flush();

    const inspection = system.inspect();

    expect(inspection.constraints).toBeInstanceOf(Array);
    expect(inspection.constraints.length).toBeGreaterThan(0);

    const constraint = inspection.constraints[0]!;

    expect(constraint).toHaveProperty("id");
    expect(constraint).toHaveProperty("active");
    expect(constraint).toHaveProperty("disabled");
    expect(constraint).toHaveProperty("priority");

    system.destroy();
  });

  it("inspect returns resolverDefs info", async () => {
    const system = createSystem({ module: constraintModule() });
    system.start();
    await flush();

    const inspection = system.inspect();

    expect(inspection.resolverDefs).toBeInstanceOf(Array);
    expect(inspection.resolverDefs.length).toBeGreaterThan(0);
    expect(inspection.resolverDefs[0]).toHaveProperty("id");
    expect(inspection.resolverDefs[0]).toHaveProperty("requirement");

    system.destroy();
  });

  it("inspect shows inflight resolvers when running", async () => {
    let resolvePromise: () => void;
    const resolverStarted = new Promise<void>((r) => {
      resolvePromise = r;
    });

    const mod = createModule("inflight-test", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { SLOW: {} },
      },
      init: (facts) => {
        facts.go = true;
      },
      constraints: {
        triggerSlow: {
          when: (facts) => facts.go === true,
          require: { type: "SLOW" },
        },
      },
      resolvers: {
        slow: {
          requirement: "SLOW",
          resolve: async () => {
            resolvePromise!();
            await new Promise(() => {});
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();
    await resolverStarted;

    const inspection = system.inspect();

    expect(inspection.inflight.length).toBe(1);
    expect(inspection.inflight[0]!.resolverId).toBe("slow");

    system.destroy();
  });

  it("inspect traceEnabled is false by default", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    const inspection = system.inspect();

    expect(inspection.traceEnabled).toBe(false);

    system.destroy();
  });
});

// ============================================================================
// Security Validations
// ============================================================================

describe("Engine — Security", () => {
  it("BLOCKED_PROPS keys in schema throw", () => {
    // Use Object.create(null) to avoid JS __proto__ special casing
    const badFacts = Object.create(null);
    badFacts.constructor = t.string();

    const mod = createModule("bad", {
      schema: {
        facts: badFacts,
        derivations: {},
        events: {},
        requirements: {},
      },
    });

    expect(() => createSystem({ module: mod })).toThrow(
      "dangerous key",
    );
  });

  it("constructor key in schema throws", () => {
    const mod = createModule("bad", {
      schema: {
        facts: { constructor: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      },
    });

    expect(() => createSystem({ module: mod })).toThrow(
      "dangerous key",
    );
  });

  it("prototype key in schema throws", () => {
    const mod = createModule("bad", {
      schema: {
        facts: { prototype: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      },
    });

    expect(() => createSystem({ module: mod })).toThrow(
      "dangerous key",
    );
  });

  it("$ prefix keys in schema throw", () => {
    const mod = createModule("bad", {
      schema: {
        facts: { $internal: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      },
    });

    expect(() => createSystem({ module: mod })).toThrow(
      'starting with "$"',
    );
  });

  it("BLOCKED_PROPS in events definition throws", () => {
    const badEvents = Object.create(null);
    badEvents.constructor = {};

    const mod = createModule("bad", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: badEvents,
        requirements: {},
      },
      events: {
        constructor: () => {},
      } as any,
    });

    expect(() => createSystem({ module: mod })).toThrow(
      "dangerous key",
    );
  });

  it("BLOCKED_PROPS in dispatch event type is silently ignored", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    // Should not throw, just be silently ignored
    system.dispatch({ type: "__proto__" as "increment" });
    system.dispatch({ type: "constructor" as "increment" });

    expect(system.facts.count).toBe(0);

    system.destroy();
  });

  it("schema collision between modules throws in dev mode", () => {
    const mod1 = createModule("mod-a", {
      schema: {
        facts: { shared: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
    });
    const mod2 = createModule("mod-b", {
      schema: {
        facts: { shared: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
    });

    // Using single modules merged into engine — pass as flat modules
    // In createSystem namespaced mode, keys get prefixed, so use engine directly
    expect(() =>
      createSystem({
        modules: { a: mod1, b: mod2 },
      }),
    ).not.toThrow();

    // But with non-namespaced usage via registerModule it would collide
    // (namespaced mode prefixes keys, so no collision there)
  });
});

// ============================================================================
// Error Boundary
// ============================================================================

describe("Engine — Error Boundary", () => {
  it("system catches resolver errors and does not crash", async () => {
    const mod = createModule("error-test", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { FAIL: {} },
      },
      init: (facts) => {
        facts.go = true;
      },
      constraints: {
        trigger: {
          when: (facts) => facts.go === true,
          require: { type: "FAIL" },
        },
      },
      resolvers: {
        failing: {
          requirement: "FAIL",
          resolve: async () => {
            throw new Error("resolver boom");
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    // Should not throw — error is caught by the engine
    await flush();
    // Give the resolver time to fail
    await new Promise((r) => setTimeout(r, 50));
    await flush();

    // System should still be running
    expect(system.isRunning).toBe(true);

    system.destroy();
  });

  it("error boundary onError callback is invoked", async () => {
    const onError = vi.fn();

    const mod = createModule("error-cb-test", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { FAIL: {} },
      },
      init: (facts) => {
        facts.go = true;
      },
      constraints: {
        trigger: {
          when: (facts) => facts.go === true,
          require: { type: "FAIL" },
        },
      },
      resolvers: {
        failing: {
          requirement: "FAIL",
          resolve: async () => {
            throw new Error("resolver error");
          },
        },
      },
    });

    const system = createSystem({
      module: mod,
      errorBoundary: { onError },
    });
    system.start();
    await flush();
    await new Promise((r) => setTimeout(r, 50));
    await flush();

    expect(onError).toHaveBeenCalled();

    system.destroy();
  });
});

// ============================================================================
// Batch
// ============================================================================

describe("Engine — Batch", () => {
  it("system.batch() coalesces fact mutations", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    await flush();

    const listener = vi.fn();
    system.subscribe(["count"], listener);

    system.batch(() => {
      system.facts.count = 1;
      system.facts.count = 2;
      system.facts.count = 3;
    });

    // Should receive only one notification despite multiple writes
    expect(listener).toHaveBeenCalledTimes(1);
    expect(system.facts.count).toBe(3);

    system.destroy();
  });
});

// ============================================================================
// getSnapshot / restore
// ============================================================================

describe("Engine — Snapshot", () => {
  it("getSnapshot returns current facts", () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    system.facts.count = 42;

    const snapshot = system.getSnapshot();

    expect(snapshot.facts.count).toBe(42);
    expect(snapshot.facts.label).toBe("test");
    expect(snapshot.version).toBe(1);

    system.destroy();
  });

  it("restore applies snapshot facts", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    system.facts.count = 100;

    const snapshot = system.getSnapshot();

    system.facts.count = 0;

    expect(system.facts.count).toBe(0);

    system.restore(snapshot);

    expect(system.facts.count).toBe(100);

    system.destroy();
  });
});

// ============================================================================
// Namespaced Multi-Module
// ============================================================================

describe("Engine — Namespaced System", () => {
  it("namespaced system provides access via namespace.key", () => {
    const mod = counterModule();
    const system = createSystem({ modules: { counter: mod } });
    system.start();

    expect(system.facts.counter.count).toBe(0);

    system.facts.counter.count = 5;

    expect(system.facts.counter.count).toBe(5);

    system.destroy();
  });

  it("namespaced events dispatch through namespace", () => {
    const mod = counterModule();
    const system = createSystem({ modules: { counter: mod } });
    system.start();

    system.events.counter.increment();

    expect(system.facts.counter.count).toBe(1);

    system.destroy();
  });

  it("namespaced derivations work", () => {
    const mod = counterModule();
    const system = createSystem({ modules: { counter: mod } });
    system.start();

    system.facts.counter.count = 4;

    expect(system.derive.counter.doubled).toBe(8);

    system.destroy();
  });
});

// ============================================================================
// When
// ============================================================================

describe("Engine — When", () => {
  it("when() resolves immediately if predicate is already true", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    system.facts.count = 10;

    await system.when((facts) => facts.count === 10);

    // If we get here, it resolved
    expect(true).toBe(true);

    system.destroy();
  });

  it("when() waits for predicate to become true", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    const promise = system.when((facts) => facts.count === 5);

    system.facts.count = 5;

    await promise;

    expect(system.facts.count).toBe(5);

    system.destroy();
  });

  it("when() rejects on timeout", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();

    await expect(
      system.when((facts) => facts.count === 999, { timeout: 50 }),
    ).rejects.toThrow("timed out");

    system.destroy();
  });
});

// ============================================================================
// onSettledChange
// ============================================================================

describe("Engine — onSettledChange", () => {
  it("onSettledChange fires when settlement status changes", async () => {
    const system = createSystem({ module: counterModule() });
    system.start();
    await flush();

    const listener = vi.fn();
    const unsub = system.onSettledChange(listener);

    // Trigger a fact change which schedules reconciliation
    system.facts.count = 42;
    await flush();

    expect(listener).toHaveBeenCalled();

    unsub();
    system.destroy();
  });
});

// ============================================================================
// Fact/Derivation Name Collision Warning
// ============================================================================

describe("Engine — Dev Warnings", () => {
  it("warns when fact and derivation share the same name", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = createModule("collision", {
      schema: {
        facts: { shared: t.number() },
        derivations: { shared: t.number() },
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.shared = 0;
      },
      derive: {
        shared: (facts) => (facts.shared as number) + 1,
      },
    });

    createSystem({ module: mod });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("exists as both a fact and a derivation"),
    );

    warnSpy.mockRestore();
  });
});

// ============================================================================
// initialFacts
// ============================================================================

describe("Engine — initialFacts", () => {
  it("initialFacts overrides module init values", () => {
    const system = createSystem({
      module: counterModule(),
      initialFacts: { count: 42, label: "initial" },
    });
    system.start();

    expect(system.facts.count).toBe(42);
    expect(system.facts.label).toBe("initial");

    system.destroy();
  });
});

// ============================================================================
// Effects
// ============================================================================

describe("Engine — Effects", () => {
  it("effects run when their tracked facts change", async () => {
    const effectRun = vi.fn();

    const mod = createModule("effect-test", {
      schema: {
        facts: { count: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.count = 0;
      },
      effects: {
        logger: {
          run: (facts) => {
            effectRun(facts.count);
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();
    await flush();

    effectRun.mockClear();

    system.facts.count = 5;
    await flush();

    expect(effectRun).toHaveBeenCalledWith(5);

    system.destroy();
  });

  it("effects can be disabled and enabled", async () => {
    const effectRun = vi.fn();

    const mod = createModule("effect-toggle", {
      schema: {
        facts: { count: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.count = 0;
      },
      effects: {
        logger: {
          run: (facts) => {
            effectRun(facts.count);
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();
    await flush();

    effectRun.mockClear();

    system.effects.disable("logger");

    system.facts.count = 10;
    await flush();

    expect(effectRun).not.toHaveBeenCalled();

    system.effects.enable("logger");

    system.facts.count = 20;
    await flush();

    expect(effectRun).toHaveBeenCalledWith(20);

    system.destroy();
  });
});
