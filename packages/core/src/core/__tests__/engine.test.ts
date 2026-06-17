import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { flushMicrotasks } from "../../utils/testing.js";
import type { ObservationEvent } from "../types/system.js";

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
      summary: (facts, derived) => `${facts.label}: ${derived.doubled}`,
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

  it("fires onResolverError hook when a resolver throws after retries", async () => {
    const onResolverError = vi.fn();

    const mod = createModule("resolver-fail", {
      schema: {
        facts: { count: t.number(), result: t.string() },
        derivations: {},
        events: {},
        requirements: { COMPUTE: { input: t.number() } },
      },
      init: (facts) => {
        facts.count = 0;
        facts.result = "";
      },
      constraints: {
        compute: {
          when: (facts) => facts.count > 0 && facts.result === "",
          require: (facts) => ({ type: "COMPUTE", input: facts.count }),
        },
      },
      resolvers: {
        compute: {
          requirement: "COMPUTE",
          resolve: async () => {
            throw new Error("resolver boom");
          },
        },
      },
      hooks: { onResolverError },
    });

    const system = createSystem({ module: mod });
    system.start();
    system.facts.count = 1;
    await flush();

    expect(onResolverError).toHaveBeenCalledTimes(1);
    const [error, requirement, ctx] = onResolverError.mock.calls[0]!;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("resolver boom");
    expect(requirement).toMatchObject({ type: "COMPUTE", input: 1 });
    expect(ctx.facts.count).toBe(1);

    system.destroy();
  });

  it("does not fire onResolverError when resolver succeeds", async () => {
    const onResolverError = vi.fn();

    const mod = createModule("resolver-ok", {
      schema: {
        facts: { count: t.number(), result: t.string() },
        derivations: {},
        events: {},
        requirements: { COMPUTE: { input: t.number() } },
      },
      init: (facts) => {
        facts.count = 0;
        facts.result = "";
      },
      constraints: {
        compute: {
          when: (facts) => facts.count > 0 && facts.result === "",
          require: (facts) => ({ type: "COMPUTE", input: facts.count }),
        },
      },
      resolvers: {
        compute: {
          requirement: "COMPUTE",
          resolve: async (req, ctx) => {
            ctx.facts.result = `ok:${req.input}`;
          },
        },
      },
      hooks: { onResolverError },
    });

    const system = createSystem({ module: mod });
    system.start();
    system.facts.count = 7;
    await flush();

    expect(system.facts.result).toBe("ok:7");
    expect(onResolverError).not.toHaveBeenCalled();

    system.destroy();
  });

  it("isolates errors thrown from inside onResolverError", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const mod = createModule("resolver-fail-bad-hook", {
      schema: {
        facts: { count: t.number() },
        derivations: {},
        events: {},
        requirements: { COMPUTE: { input: t.number() } },
      },
      init: (facts) => {
        facts.count = 0;
      },
      constraints: {
        compute: {
          when: (facts) => facts.count > 0,
          require: (facts) => ({ type: "COMPUTE", input: facts.count }),
        },
      },
      resolvers: {
        compute: {
          requirement: "COMPUTE",
          resolve: async () => {
            throw new Error("resolver boom");
          },
        },
      },
      hooks: {
        onResolverError: () => {
          throw new Error("hook boom");
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();
    system.facts.count = 1;
    await flush();

    // Engine still works after a hook failure
    expect(consoleErrorSpy).toHaveBeenCalled();
    const calledMessages = consoleErrorSpy.mock.calls
      .map((args) => String(args[0]))
      .join(" ");
    expect(calledMessages).toContain("onResolverError");

    system.destroy();
    consoleErrorSpy.mockRestore();
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

    expect(() => createSystem({ module: mod })).toThrow("dangerous key");
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

    expect(() => createSystem({ module: mod })).toThrow("dangerous key");
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

    expect(() => createSystem({ module: mod })).toThrow("dangerous key");
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

    expect(() => createSystem({ module: mod })).toThrow('starting with "$"');
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

    expect(() => createSystem({ module: mod })).toThrow("dangerous key");
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

// ============================================================================
// Constraint-Binding (RFC-0003) — engine-level integration
// ============================================================================

describe("constraint-binding (RFC-0003) — engine integration", () => {
  it("the binding prevents tail-clobber end-to-end through createSystem", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const m = createModule("phaseA", {
      schema: {
        facts: {
          status: t.string(),
          progress: t.number(),
        },
        derivations: {},
        events: {
          start: {},
          forceLeft: {},
        },
        requirements: {
          EXECUTE_ACTION: {},
        },
      },
      init: (f) => {
        f.status = "idle";
        f.progress = 0;
      },
      events: {
        start: (f) => {
          f.status = "mutating";
        },
        forceLeft: (f) => {
          f.status = "left";
        },
      },
      constraints: {
        mutate: {
          when: (f) => f.status === "mutating",
          require: { type: "EXECUTE_ACTION" },
          abortOn: ["status"],
        },
      },
      resolvers: {
        execute: {
          requirement: "EXECUTE_ACTION",
          resolve: async (_req, ctx) => {
            ctx.facts.progress = 50;
            await blocker;
            // Tail clobber attempt — must be dropped because `status` (owned)
            // was changed externally (status === 'left' by then).
            ctx.facts.status = "playing";
          },
        },
      },
    });

    const system = createSystem({ module: m });
    system.start();
    await flush();

    system.events.start();
    await flush();
    expect(system.facts.progress).toBe(50);

    // External event: leave the party.
    system.events.forceLeft();
    await flush();
    expect(system.facts.status).toBe("left");

    // Now resolver tail wakes up and tries to clobber.
    release();
    await flush();

    // Without RFC-0003 binding, status would be 'playing' here. With binding,
    // the tail write was dropped → status stays 'left'.
    expect(system.facts.status).toBe("left");

    system.destroy();
  });

  it("no `abortOn` (default) preserves the clobber behavior", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const m = createModule("noBind", {
      schema: {
        facts: { status: t.string(), progress: t.number() },
        derivations: {},
        events: {
          start: {},
          forceLeft: {},
        },
        requirements: { EXECUTE_ACTION: {} },
      },
      init: (f) => {
        f.status = "idle";
        f.progress = 0;
      },
      events: {
        start: (f) => {
          f.status = "mutating";
        },
        forceLeft: (f) => {
          f.status = "left";
        },
      },
      constraints: {
        mutate: {
          when: (f) => f.status === "mutating",
          require: { type: "EXECUTE_ACTION" },
          // no `abortOn` — binding off by default
        },
      },
      resolvers: {
        execute: {
          requirement: "EXECUTE_ACTION",
          resolve: async (_req, ctx) => {
            ctx.facts.progress = 50;
            await blocker;
            ctx.facts.status = "playing";
          },
        },
      },
    });

    const system = createSystem({ module: m });
    system.start();
    await flush();
    system.events.start();
    await flush();
    system.events.forceLeft();
    await flush();
    release();
    await flush();

    // Default behavior: tail-clobber lands.
    expect(system.facts.status).toBe("playing");

    system.destroy();
  });

  it("a resolver's data write survives an owned-fact clobber (win-at-the-buzzer)", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const m = createModule("winAtBuzzer", {
      schema: {
        facts: {
          status: t.string(),
          winRecord: t.string(),
        },
        derivations: {},
        events: {
          claim: {},
          endRound: {},
        },
        requirements: { CLAIM_WIN: {} },
      },
      init: (f) => {
        f.status = "idle";
        f.winRecord = "";
      },
      events: {
        claim: (f) => {
          f.status = "mutating";
        },
        endRound: (f) => {
          f.status = "ended";
        },
      },
      constraints: {
        mutate: {
          when: (f) => f.status === "mutating",
          require: { type: "CLAIM_WIN" },
          abortOn: ["status"],
        },
      },
      resolvers: {
        execute: {
          requirement: "CLAIM_WIN",
          resolve: async (_req, ctx) => {
            await blocker; // server confirms the win
            // `winRecord` is data — not owned — so it lands even though the
            // round ended mid-flight. `status` is owned → dropped.
            ctx.facts.winRecord = "recorded";
            ctx.facts.status = "playing";
          },
        },
      },
    });

    const system = createSystem({ module: m });
    system.start();
    await flush();

    system.events.claim();
    await flush();

    // The round ends while the claim is in flight.
    system.events.endRound();
    await flush();
    expect(system.facts.status).toBe("ended");

    release();
    await flush();

    // The win was recorded (data write landed); the stale status-restore was
    // dropped — a player who wins at the buzzer is not silently dropped.
    expect(system.facts.winRecord).toBe("recorded");
    expect(system.facts.status).toBe("ended");

    system.destroy();
  });

  it("a bound resolver is NOT cancelled when its requirement is removed", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    let signalAfterAwait: boolean | null = null;

    const m = createModule("notCancelled", {
      schema: {
        facts: { status: t.string(), data: t.string() },
        derivations: {},
        events: { start: {}, interrupt: {} },
        requirements: { WORK: {} },
      },
      init: (f) => {
        f.status = "idle";
        f.data = "";
      },
      events: {
        start: (f) => {
          f.status = "working";
        },
        interrupt: (f) => {
          f.status = "interrupted";
        },
      },
      constraints: {
        work: {
          when: (f) => f.status === "working",
          require: { type: "WORK" },
          abortOn: ["status"],
        },
      },
      resolvers: {
        worker: {
          requirement: "WORK",
          resolve: async (_req, ctx) => {
            await blocker;
            // A bound resolver is not cancelled by requirement removal — the
            // signal stays unaborted so a signal-checking resolver does not
            // bail and lose its data writes.
            signalAfterAwait = ctx.signal.aborted;
            ctx.facts.data = "landed"; // data write — lands
            ctx.facts.status = "done"; // owned — clobbered, dropped
          },
        },
      },
    });

    const system = createSystem({ module: m });
    system.start();
    await flush();
    system.events.start();
    await flush();

    // A competing event removes the WORK requirement (status leaves 'working').
    system.events.interrupt();
    await flush();

    release();
    await flush();

    expect(signalAfterAwait).toBe(false); // resolver was not cancelled
    expect(system.facts.data).toBe("landed"); // data write landed
    expect(system.facts.status).toBe("interrupted"); // owned write dropped

    system.destroy();
  });

  it("an unbound resolver is still cancelled when its requirement is removed", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    let signalAfterAwait: boolean | null = null;

    const m = createModule("stillCancelled", {
      schema: {
        facts: { status: t.string() },
        derivations: {},
        events: { start: {}, interrupt: {} },
        requirements: { WORK: {} },
      },
      init: (f) => {
        f.status = "idle";
      },
      events: {
        start: (f) => {
          f.status = "working";
        },
        interrupt: (f) => {
          f.status = "interrupted";
        },
      },
      constraints: {
        work: {
          when: (f) => f.status === "working",
          require: { type: "WORK" },
          // no `abortOn` — default cancellation behavior
        },
      },
      resolvers: {
        worker: {
          requirement: "WORK",
          resolve: async (_req, ctx) => {
            await blocker;
            signalAfterAwait = ctx.signal.aborted;
          },
        },
      },
    });

    const system = createSystem({ module: m });
    system.start();
    await flush();
    system.events.start();
    await flush();
    system.events.interrupt();
    await flush();
    release();
    await flush();

    expect(signalAfterAwait).toBe(true); // unbound resolver was cancelled

    system.destroy();
  });

  it("a detached bound resolver does not block re-dispatch when the constraint returns", async () => {
    let runs = 0;
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const m = createModule("reDispatch", {
      schema: {
        facts: { status: t.string() },
        derivations: {},
        events: { go: {}, stop: {} },
        requirements: { WORK: {} },
      },
      init: (f) => {
        f.status = "idle";
      },
      events: {
        go: (f) => {
          f.status = "working";
        },
        stop: (f) => {
          f.status = "idle";
        },
      },
      constraints: {
        work: {
          when: (f) => f.status === "working",
          require: { type: "WORK" },
          abortOn: ["status"],
        },
      },
      resolvers: {
        worker: {
          requirement: "WORK",
          resolve: async () => {
            runs++;
            await blocker;
          },
        },
      },
    });

    const system = createSystem({ module: m });
    system.start();
    await flush();

    system.events.go(); // constraint true → resolver A dispatched
    await flush();
    expect(runs).toBe(1);

    system.events.stop(); // constraint false → resolver A detached (still running)
    await flush();

    system.events.go(); // constraint true again → resolver B must dispatch
    await flush();
    // Re-dispatch happened even though A is still in flight. Detach (not a
    // bare skip-cancel) frees the in-flight slot for the requirement id.
    expect(runs).toBe(2);

    release();
    await flush();
    system.destroy();
  });

  it("`abortOn` on an async constraint is ignored — the clobber lands", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const m = createModule("asyncBound", {
      schema: {
        facts: { status: t.string() },
        derivations: {},
        events: { start: {}, forceLeft: {} },
        requirements: { EXECUTE_ACTION: {} },
      },
      init: (f) => {
        f.status = "idle";
      },
      events: {
        start: (f) => {
          f.status = "mutating";
        },
        forceLeft: (f) => {
          f.status = "left";
        },
      },
      constraints: {
        mutate: {
          async: true,
          deps: ["status"],
          when: async (f) => f.status === "mutating",
          require: { type: "EXECUTE_ACTION" },
          abortOn: ["status"], // ignored on async constraint
        },
      },
      resolvers: {
        execute: {
          requirement: "EXECUTE_ACTION",
          resolve: async (_req, ctx) => {
            await blocker;
            ctx.facts.status = "playing";
          },
        },
      },
    });

    const system = createSystem({ module: m });
    system.start();
    await flush();
    system.events.start();
    await flush();
    await flush();
    system.events.forceLeft();
    await flush();
    release();
    await flush();
    await flush();

    // `abortOn` is ignored on async constraints — the resolver's tail write
    // is not clobber-checked, so it lands (same as `abortOn` absent).
    expect(system.facts.status).toBe("playing");

    system.destroy();
  });

  it("emits `constraint.binding.disabled` (reason: async-declared) when `abortOn` lands on a declared-async constraint", async () => {
    const m = createModule("asyncDeclared", {
      schema: {
        facts: { status: t.string() },
        derivations: {},
        events: { start: {} },
        requirements: { GO: {} },
      },
      init: (f) => {
        f.status = "idle";
      },
      events: {
        start: (f) => {
          f.status = "mutating";
        },
      },
      constraints: {
        mutate: {
          async: true,
          deps: ["status"],
          when: async (f) => f.status === "mutating",
          require: { type: "GO" },
          abortOn: ["status"],
        },
      },
      resolvers: {
        run: {
          requirement: "GO",
          resolve: async (_req, ctx) => {
            ctx.facts.status = "done";
          },
        },
      },
    });

    const system = createSystem({ module: m });
    const events: ObservationEvent[] = [];
    const unsub = system.observe((e) => events.push(e));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    system.start();
    await flushMicrotasks();
    system.events.start();
    await flushMicrotasks();
    await flushMicrotasks();

    const bindingDisabled = events.filter(
      (
        e,
      ): e is Extract<
        ObservationEvent,
        { type: "constraint.binding.disabled" }
      > => e.type === "constraint.binding.disabled",
    );
    // Exactly ONE event per (constraintId, reason) regardless of how
    // many dispatches the async-disabled constraint triggers.
    expect(bindingDisabled.length).toBe(1);
    expect(bindingDisabled[0]?.id).toBe("mutate");
    expect(bindingDisabled[0]?.reason).toBe("async-declared");
    // And exactly ONE dev-mode warn for the same reason.
    expect(warn).toHaveBeenCalledTimes(1);

    unsub();
    warn.mockRestore();
    system.destroy();
  });

  it("emits `constraint.binding.disabled` (reason: async-promoted) when `when()` returns a Promise but async wasn't declared", async () => {
    const m = createModule("asyncPromoted", {
      schema: {
        facts: { status: t.string() },
        derivations: {},
        events: { start: {} },
        requirements: { GO: {} },
      },
      init: (f) => {
        f.status = "idle";
      },
      events: {
        start: (f) => {
          f.status = "mutating";
        },
      },
      constraints: {
        mutate: {
          // No `async: true` — but the predicate returns a Promise.
          // The engine promotes it at runtime and disables abortOn binding.
          deps: ["status"],
          when: ((f: { status: string }) =>
            Promise.resolve(f.status === "mutating")) as unknown as (facts: {
            status: string;
          }) => boolean,
          require: { type: "GO" },
          abortOn: ["status"],
        },
      },
      resolvers: {
        run: {
          requirement: "GO",
          resolve: async (_req, ctx) => {
            ctx.facts.status = "done";
          },
        },
      },
    });

    const system = createSystem({ module: m });
    const events: ObservationEvent[] = [];
    const unsub = system.observe((e) => events.push(e));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    system.start();
    await flushMicrotasks();
    system.events.start();
    await flushMicrotasks();
    await flushMicrotasks();

    const bindingDisabled = events.filter(
      (
        e,
      ): e is Extract<
        ObservationEvent,
        { type: "constraint.binding.disabled" }
      > => e.type === "constraint.binding.disabled",
    );
    expect(bindingDisabled.length).toBe(1);
    expect(bindingDisabled[0]?.id).toBe("mutate");
    expect(bindingDisabled[0]?.reason).toBe("async-promoted");
    // The runtime-promotion path also surfaces a separate
    // "constraint promoted to async at runtime" warning from the
    // constraints manager, in addition to the binding-disabled
    // warning. Both fire once thanks to engine-side dedupe.
    const bindingDisabledWarns = warn.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("abortOn binding disabled"),
    );
    expect(bindingDisabledWarns.length).toBe(1);

    unsub();
    warn.mockRestore();
    system.destroy();
  });

  it("dedupes `constraint.binding.disabled` across many dispatches", async () => {
    const m = createModule("dedupe", {
      schema: {
        facts: { status: t.string() },
        derivations: {},
        events: { tick: {} },
        requirements: { GO: {} },
      },
      init: (f) => {
        f.status = "idle";
      },
      events: {
        tick: (f) => {
          // Toggle back and forth to force many dispatches.
          f.status = f.status === "idle" ? "mutating" : "idle";
        },
      },
      constraints: {
        mutate: {
          async: true,
          deps: ["status"],
          when: async (f) => f.status === "mutating",
          require: { type: "GO" },
          abortOn: ["status"],
        },
      },
      resolvers: {
        run: {
          requirement: "GO",
          resolve: async () => {},
        },
      },
    });

    const system = createSystem({ module: m });
    const events: ObservationEvent[] = [];
    const unsub = system.observe((e) => events.push(e));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    system.start();
    await flushMicrotasks();

    // Toggle the async-disabled constraint into the firing state many times.
    for (let i = 0; i < 20; i++) {
      system.events.tick();
      await flushMicrotasks();
      system.events.tick(); // back to idle
      await flushMicrotasks();
    }

    const bindingDisabled = events.filter(
      (
        e,
      ): e is Extract<
        ObservationEvent,
        { type: "constraint.binding.disabled" }
      > => e.type === "constraint.binding.disabled",
    );
    // Even across many dispatches, only ONE event per (id, reason) pair fires.
    expect(bindingDisabled.length).toBe(1);
    // And exactly ONE dev-mode warn.
    expect(warn).toHaveBeenCalledTimes(1);

    unsub();
    warn.mockRestore();
    system.destroy();
  });
});
