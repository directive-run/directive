import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

/**
 * Tests that batch.enabled works with plain resolve() (no resolveBatch).
 * The system should fall back to calling resolve() individually for each
 * batched requirement instead of throwing.
 */
describe("batch + resolve fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createBatchModule() {
    return createModule("batch-test", {
      schema: {
        facts: {
          items: t.object<Record<string, string>>(),
          trigger: t.number(),
        },
        requirements: {
          FETCH_ITEM: { id: t.string() },
        },
      },
      init: (facts) => {
        facts.items = {};
        facts.trigger = 0;
      },
      constraints: {
        loadItems: {
          when: (facts) => facts.trigger > 0,
          require: (facts) => {
            const reqs = [];
            for (let i = 0; i < facts.trigger; i++) {
              reqs.push({ type: "FETCH_ITEM" as const, id: `item-${i}` });
            }

            return reqs;
          },
        },
      },
      resolvers: {
        fetchItem: {
          requirement: "FETCH_ITEM",
          batch: {
            enabled: true,
            windowMs: 10,
          },
          // Only resolve() — no resolveBatch()
          resolve: async (req, context) => {
            context.facts.items = {
              ...context.facts.items,
              [req.id]: `data-${req.id}`,
            };
          },
        },
      },
    });
  }

  it("resolves requirements individually when batch.enabled but no resolveBatch", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = createBatchModule();
    const system = createSystem({ module: mod });
    system.start();

    // Trigger 3 requirements that will be batched
    system.facts.trigger = 3;

    // Let reconciliation queue the batch requirements
    await vi.advanceTimersByTimeAsync(0);

    // Advance past the batch windowMs (10ms) to fire the batch timer
    await vi.advanceTimersByTimeAsync(50);

    // Let promises resolve
    await vi.advanceTimersByTimeAsync(50);

    // All items should be resolved individually via resolve() fallback
    expect(system.facts.items["item-0"]).toBe("data-item-0");
    expect(system.facts.items["item-1"]).toBe("data-item-1");
    expect(system.facts.items["item-2"]).toBe("data-item-2");

    warnSpy.mockRestore();
  });

  it("emits dev warning when batch.enabled without resolveBatch", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = createBatchModule();
    createSystem({ module: mod });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Falling back to individual resolve() calls"),
    );

    warnSpy.mockRestore();
  });
});

describe("batch maxSize enforcement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes batch immediately when maxSize is reached", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolvedIds: string[] = [];

    const mod = createModule("maxsize-test", {
      schema: {
        facts: {
          trigger: t.number(),
          done: t.boolean(),
        },
        requirements: {
          PROCESS: { id: t.string() },
        },
      },
      init: (facts) => {
        facts.trigger = 0;
        facts.done = false;
      },
      constraints: {
        load: {
          when: (facts) => facts.trigger > 0,
          require: (facts) => {
            const reqs = [];
            for (let i = 0; i < facts.trigger; i++) {
              reqs.push({ type: "PROCESS" as const, id: `id-${i}` });
            }

            return reqs;
          },
        },
      },
      resolvers: {
        process: {
          requirement: "PROCESS",
          batch: {
            enabled: true,
            windowMs: 5000, // Very long window — should NOT wait for this
            maxSize: 2,
          },
          resolve: async (req) => {
            resolvedIds.push(req.id);
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    // Trigger 2 requirements — exactly maxSize
    system.facts.trigger = 2;

    // Let reconciliation run and queue to batch
    await vi.advanceTimersByTimeAsync(0);

    // The batch should have flushed immediately (maxSize=2, 2 queued).
    // Give promises time to resolve.
    await vi.advanceTimersByTimeAsync(10);

    // Both should be resolved WITHOUT waiting for the 5000ms window
    expect(resolvedIds).toContain("id-0");
    expect(resolvedIds).toContain("id-1");

    warnSpy.mockRestore();
  });
});

describe("batch + cancel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops batched resolvers when system is stopped during batch window", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolvedIds: string[] = [];

    const mod = createModule("cancel-test", {
      schema: {
        facts: {
          trigger: t.number(),
        },
        requirements: {
          FETCH: { id: t.string() },
        },
      },
      init: (facts) => {
        facts.trigger = 0;
      },
      constraints: {
        load: {
          when: (facts) => facts.trigger > 0,
          require: (facts) => {
            const reqs = [];
            for (let i = 0; i < facts.trigger; i++) {
              reqs.push({ type: "FETCH" as const, id: `item-${i}` });
            }

            return reqs;
          },
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          batch: {
            enabled: true,
            windowMs: 500, // Long window so we can stop before it fires
          },
          resolve: async (req) => {
            resolvedIds.push(req.id);
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    system.facts.trigger = 2;

    // Let reconciliation queue the batch requirements
    await vi.advanceTimersByTimeAsync(0);

    // Stop the system before the batch window expires — this cancels all batches
    system.stop();

    // Advance past the batch window
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(50);

    // No resolvers should have fired since the system was stopped
    expect(resolvedIds.length).toBe(0);

    warnSpy.mockRestore();
  });
});

describe("batch + settle integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("settle() flushes pending batches instead of hanging", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = createModule("settle-test", {
      schema: {
        facts: {
          items: t.object<Record<string, string>>(),
          trigger: t.number(),
        },
        requirements: {
          LOAD: { id: t.string() },
        },
      },
      init: (facts) => {
        facts.items = {};
        facts.trigger = 0;
      },
      constraints: {
        load: {
          when: (facts) => facts.trigger > 0,
          require: (facts) => {
            const reqs = [];
            for (let i = 0; i < facts.trigger; i++) {
              reqs.push({ type: "LOAD" as const, id: `s-${i}` });
            }

            return reqs;
          },
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          batch: {
            enabled: true,
            windowMs: 100,
          },
          resolve: async (req, context) => {
            context.facts.items = {
              ...context.facts.items,
              [req.id]: `loaded-${req.id}`,
            };
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    system.facts.trigger = 2;

    // settle() should flush the pending batch and resolve
    // Run settle in background while advancing timers
    let settled = false;
    const settlePromise = system.settle(2000).then(() => {
      settled = true;
    });

    // Advance timers enough to let settle flush batches and resolve
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(50);
    }

    await settlePromise;
    expect(settled).toBe(true);
    expect(system.facts.items["s-0"]).toBe("loaded-s-0");
    expect(system.facts.items["s-1"]).toBe("loaded-s-1");

    warnSpy.mockRestore();
  });
});

describe("batch + error handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles errors in batched resolve() fallback without crashing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let callCount = 0;

    const mod = createModule("error-test", {
      schema: {
        facts: {
          trigger: t.number(),
          errorMsg: t.string().nullable(),
        },
        requirements: {
          FAIL: { id: t.string() },
        },
      },
      init: (facts) => {
        facts.trigger = 0;
        facts.errorMsg = null;
      },
      constraints: {
        load: {
          when: (facts) => facts.trigger > 0 && facts.errorMsg === null,
          require: { type: "FAIL" as const, id: "will-fail" },
        },
      },
      resolvers: {
        fail: {
          requirement: "FAIL",
          batch: {
            enabled: true,
            windowMs: 10,
          },
          resolve: async () => {
            callCount++;
            throw new Error("batch item failed");
          },
        },
      },
    });

    const system = createSystem({
      module: mod,
      errorBoundary: {
        onResolverError: "skip",
      },
    });
    system.start();

    system.facts.trigger = 1;

    // Let reconciliation and batch timer fire
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(50);

    // The resolver was called (and failed) — system should not crash
    expect(callCount).toBeGreaterThan(0);

    warnSpy.mockRestore();
  });
});
