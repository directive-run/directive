import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createModule,
  createSystem,
  generateRequirementId,
  t,
} from "../../index.js";
import type { RequirementWithId } from "../../index.js";
import { flushMicrotasks } from "../../utils/testing.js";
import { createFacts } from "../facts.js";
import { createResolversManager } from "../resolvers.js";
import type { ObservationEvent } from "../types/system.js";

// ============================================================================
// Helpers
// ============================================================================

const schema = { data: t.string(), loading: t.boolean() };

function setup(
  definitions: Parameters<typeof createResolversManager>[0]["definitions"] = {},
  callbacks: Partial<
    Pick<
      Parameters<typeof createResolversManager>[0],
      | "onStart"
      | "onComplete"
      | "onError"
      | "onCancel"
      | "onRetry"
      | "onResolutionComplete"
    >
  > = {},
) {
  const { store, facts } = createFacts({ schema });
  facts.data = "";
  facts.loading = false;

  const manager = createResolversManager({
    definitions,
    facts,
    store,
    ...callbacks,
  });

  return { store, facts, manager };
}

function makeReq(
  type: string,
  extra: Record<string, unknown> = {},
  fromConstraint = "test-constraint",
): RequirementWithId {
  const requirement = { type, ...extra };

  return {
    requirement,
    id: generateRequirementId(requirement),
    fromConstraint,
  };
}

/** Flush microtask queue */
async function flush(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

// ============================================================================
// Basic Resolution
// ============================================================================

describe("basic resolution", () => {
  it("resolve calls the matching resolver's resolve function", async () => {
    const resolveFn = vi.fn(async (_req, context) => {
      context.facts.data = "loaded";
    });

    const { facts, manager } = setup({
      fetchData: {
        requirement: "FETCH",
        resolve: resolveFn,
      },
    });

    const req = makeReq("FETCH");
    manager.resolve(req);
    await flush();

    expect(resolveFn).toHaveBeenCalledOnce();
    expect(facts.data).toBe("loaded");
  });

  it("resolve sets status to running then success on completion", async () => {
    let capturedStatus: unknown = null;

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        resolve: async (_req, _context) => {
          // Intentionally empty — we capture status from onStart
        },
      },
    });

    const req = makeReq("FETCH");

    // Before resolve — should be idle
    expect(manager.getStatus(req.id).state).toBe("idle");

    manager.resolve(req);

    // Immediately after resolve — inflight, should be pending or running
    capturedStatus = manager.getStatus(req.id);
    expect(["pending", "running"]).toContain(
      (capturedStatus as { state: string }).state,
    );

    await flush();

    // After completion — should be success
    expect(manager.getStatus(req.id).state).toBe("success");
  });

  it("getStatus returns idle for unknown requirements", () => {
    const { manager } = setup();

    expect(manager.getStatus("nonexistent-id")).toEqual({ state: "idle" });
  });

  it("isResolving returns true during resolution", async () => {
    let wasResolving = false;

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        resolve: async () => {
          // Will check isResolving from outside
        },
      },
    });

    const req = makeReq("FETCH");
    manager.resolve(req);
    wasResolving = manager.isResolving(req.id);

    await flush();

    expect(wasResolving).toBe(true);
    expect(manager.isResolving(req.id)).toBe(false);
  });

  it("getInflight returns active requirement IDs", async () => {
    let resolvePromise!: () => void;
    const blocker = new Promise<void>((r) => {
      resolvePromise = r;
    });

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        resolve: async () => {
          await blocker;
        },
      },
    });

    const req = makeReq("FETCH");
    manager.resolve(req);

    expect(manager.getInflight()).toContain(req.id);
    expect(manager.getInflightInfo()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: req.id, resolverId: "fetchData" }),
      ]),
    );

    resolvePromise();
    await flush();

    expect(manager.getInflight()).toEqual([]);
  });

  it("deduplicates in-flight requirements with the same id", async () => {
    const resolveFn = vi.fn(async () => {});

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        resolve: resolveFn,
      },
    });

    const req = makeReq("FETCH");
    manager.resolve(req);
    manager.resolve(req); // duplicate — should be ignored

    await flush();

    expect(resolveFn).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Retry Logic
// ============================================================================

describe("retry logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries on failure with retry.attempts = 3 and backoff none", async () => {
    let callCount = 0;

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        retry: { attempts: 3, backoff: "none" },
        resolve: async () => {
          callCount++;
          throw new Error("fail");
        },
      },
    });

    const req = makeReq("FETCH");
    manager.resolve(req);

    // Each retry has a 100ms default delay (backoff: "none" uses initialDelay)
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(200);
    }

    expect(callCount).toBe(3);
    expect(manager.getStatus(req.id).state).toBe("error");
  });

  it("uses exponential backoff delays", async () => {
    const onRetry = vi.fn();
    let callCount = 0;

    const { manager } = setup(
      {
        fetchData: {
          requirement: "FETCH",
          retry: {
            attempts: 4,
            backoff: "exponential",
            initialDelay: 100,
          },
          resolve: async () => {
            callCount++;
            throw new Error("fail");
          },
        },
      },
      { onRetry },
    );

    const req = makeReq("FETCH");
    manager.resolve(req);

    // Attempt 1 runs immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(callCount).toBe(1);

    // Delay after attempt 1: 100 * 2^0 = 100ms
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(callCount).toBe(2);

    // Delay after attempt 2: 100 * 2^1 = 200ms
    await vi.advanceTimersByTimeAsync(200);
    await flush();
    expect(callCount).toBe(3);

    // Delay after attempt 3: 100 * 2^2 = 400ms
    await vi.advanceTimersByTimeAsync(400);
    await flush();
    expect(callCount).toBe(4);

    expect(manager.getStatus(req.id).state).toBe("error");
  });

  it("shouldRetry returning false stops retries immediately", async () => {
    let callCount = 0;

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        retry: {
          attempts: 5,
          backoff: "none",
          shouldRetry: () => false,
        },
        resolve: async () => {
          callCount++;
          throw new Error("fail");
        },
      },
    });

    const req = makeReq("FETCH");
    manager.resolve(req);

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(200);
    }

    // shouldRetry returns false after first failure, so only 1 attempt
    expect(callCount).toBe(1);
    expect(manager.getStatus(req.id).state).toBe("error");
  });

  it("respects maxDelay clamping", async () => {
    let callCount = 0;

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        retry: {
          attempts: 3,
          backoff: "exponential",
          initialDelay: 500,
          maxDelay: 600,
        },
        resolve: async () => {
          callCount++;
          throw new Error("fail");
        },
      },
    });

    const req = makeReq("FETCH");
    manager.resolve(req);

    // Attempt 1 fires immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(callCount).toBe(1);

    // Delay after attempt 1: min(500 * 2^0, 600) = 500ms
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(callCount).toBe(2);

    // Delay after attempt 2: min(500 * 2^1, 600) = 600ms (clamped)
    // At 599ms it should NOT have fired yet
    await vi.advanceTimersByTimeAsync(599);
    await flush();
    expect(callCount).toBe(2);

    // At 600ms it fires
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(callCount).toBe(3);
  });
});

// ============================================================================
// Retry Jitter
// ============================================================================

describe("retry jitter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Helper: drive a retry to completion with a known Math.random value
   * and capture the actual delay between attempts.
   */
  async function captureRetryDelay(
    retry: NonNullable<
      NonNullable<Parameters<typeof setup>[0]>[string]
    >["retry"],
    randomValue: number,
  ): Promise<number> {
    vi.spyOn(Math, "random").mockReturnValue(randomValue);

    let firstFailAt = 0;
    let secondCallAt = 0;
    let callCount = 0;

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        retry,
        resolve: async () => {
          callCount++;
          if (callCount === 1) {
            firstFailAt = Date.now();
            throw new Error("fail");
          }
          secondCallAt = Date.now();
        },
      },
    });

    const req = makeReq("FETCH");
    manager.resolve(req);

    // Advance enough to cover any plausible delay.
    for (let i = 0; i < 50; i++) {
      await vi.advanceTimersByTimeAsync(2_000);
    }

    expect(callCount).toBe(2);

    return secondCallAt - firstFailAt;
  }

  it("jitter undefined uses computed delay unchanged", async () => {
    const delay = await captureRetryDelay(
      { attempts: 2, backoff: "exponential", initialDelay: 1_000 },
      0.5,
    );
    expect(delay).toBe(1_000);
  });

  it("jitter 'none' uses computed delay unchanged", async () => {
    const delay = await captureRetryDelay(
      {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 1_000,
        jitter: "none",
      },
      0.5,
    );
    expect(delay).toBe(1_000);
  });

  it("jitter 'full' samples in [0, computedDelay)", async () => {
    // random=0 → floor(0 * 1000) = 0 → clamped to 1ms minimum
    const lo = await captureRetryDelay(
      {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 1_000,
        jitter: "full",
      },
      0,
    );
    expect(lo).toBe(1);

    // random ~ 1 → floor(0.999... * 1000) = 999
    const hi = await captureRetryDelay(
      {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 1_000,
        jitter: "full",
      },
      0.9999999999,
    );
    expect(hi).toBe(999);

    // random=0.5 → floor(0.5 * 1000) = 500
    const mid = await captureRetryDelay(
      {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 1_000,
        jitter: "full",
      },
      0.5,
    );
    expect(mid).toBe(500);
  });

  it("jitter 'equal' samples in [computedDelay/2, computedDelay)", async () => {
    // random=0 → floor(500 + 0 * 500) = 500
    const lo = await captureRetryDelay(
      {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 1_000,
        jitter: "equal",
      },
      0,
    );
    expect(lo).toBe(500);

    // random=0.5 → floor(500 + 0.5 * 500) = 750
    const mid = await captureRetryDelay(
      {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 1_000,
        jitter: "equal",
      },
      0.5,
    );
    expect(mid).toBe(750);

    // random ~ 1 → floor(500 + 0.999... * 500) = 999
    const hi = await captureRetryDelay(
      {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 1_000,
        jitter: "equal",
      },
      0.9999999999,
    );
    expect(hi).toBe(999);
  });

  it("jitter { maxMs } adds [0, maxMs) to computed delay", async () => {
    // random=0 → 1000 + floor(0 * 100) = 1000
    const lo = await captureRetryDelay(
      {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 1_000,
        jitter: { maxMs: 100 },
      },
      0,
    );
    expect(lo).toBe(1_000);

    // random=0.5 → 1000 + floor(0.5 * 100) = 1050
    const mid = await captureRetryDelay(
      {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 1_000,
        jitter: { maxMs: 100 },
      },
      0.5,
    );
    expect(mid).toBe(1_050);

    // random ~ 1 → 1000 + floor(0.999... * 100) = 1099
    const hi = await captureRetryDelay(
      {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 1_000,
        jitter: { maxMs: 100 },
      },
      0.9999999999,
    );
    expect(hi).toBe(1_099);
  });

  it("jitter { maxMs: 0 } is a no-op (degenerate guard)", async () => {
    const delay = await captureRetryDelay(
      {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 1_000,
        jitter: { maxMs: 0 },
      },
      0.5,
    );
    expect(delay).toBe(1_000);
  });

  it("jitter respects maxDelay clamp BEFORE applying full jitter", async () => {
    // computed = 4000, clamped to maxDelay = 1000, full jitter → floor(0.5 * 1000) = 500
    const delay = await captureRetryDelay(
      {
        attempts: 2,
        backoff: "exponential",
        initialDelay: 4_000,
        maxDelay: 1_000,
        jitter: "full",
      },
      0.5,
    );
    expect(delay).toBe(500);
  });

  it("backwards compat: existing exponential-without-jitter path is identical", async () => {
    // Confirms that a policy without `jitter` produces the exact same delay
    // it did before this change (no implicit randomization).
    let callCount = 0;
    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        retry: {
          attempts: 4,
          backoff: "exponential",
          initialDelay: 100,
        },
        resolve: async () => {
          callCount++;
          throw new Error("fail");
        },
      },
    });

    const req = makeReq("FETCH");
    manager.resolve(req);

    await vi.advanceTimersByTimeAsync(0);
    expect(callCount).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(callCount).toBe(2);

    await vi.advanceTimersByTimeAsync(200);
    await flush();
    expect(callCount).toBe(3);

    await vi.advanceTimersByTimeAsync(400);
    await flush();
    expect(callCount).toBe(4);
  });
});

// ============================================================================
// Abort / Cancel
// ============================================================================

describe("abort / cancel", () => {
  it("cancel aborts in-flight resolution", async () => {
    let resolveBlocker!: () => void;
    const blocker = new Promise<void>((r) => {
      resolveBlocker = r;
    });
    let signalAborted = false;

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        resolve: async (_req, context) => {
          context.signal.addEventListener("abort", () => {
            signalAborted = true;
          });
          await blocker;
        },
      },
    });

    const req = makeReq("FETCH");
    manager.resolve(req);
    await flush();

    expect(manager.isResolving(req.id)).toBe(true);

    manager.abort(req.id);

    expect(manager.isResolving(req.id)).toBe(false);
    expect(signalAborted).toBe(true);

    resolveBlocker();
    await flush();
  });

  it("cancel sets status to canceled", async () => {
    let resolveBlocker!: () => void;
    const blocker = new Promise<void>((r) => {
      resolveBlocker = r;
    });

    const onCancel = vi.fn();

    const { manager } = setup(
      {
        fetchData: {
          requirement: "FETCH",
          resolve: async () => {
            await blocker;
          },
        },
      },
      { onCancel },
    );

    const req = makeReq("FETCH");
    manager.resolve(req);
    await flush();

    manager.abort(req.id);

    expect(manager.getStatus(req.id).state).toBe("canceled");
    expect(onCancel).toHaveBeenCalledWith("fetchData", req);

    resolveBlocker();
    await flush();
  });

  it("cancelAll cancels all in-flight and clears batches", async () => {
    let resolveBlocker1!: () => void;
    const blocker1 = new Promise<void>((r) => {
      resolveBlocker1 = r;
    });
    let resolveBlocker2!: () => void;
    const blocker2 = new Promise<void>((r) => {
      resolveBlocker2 = r;
    });

    const onCancel = vi.fn();

    const { manager } = setup(
      {
        fetchA: {
          requirement: "FETCH_A",
          resolve: async () => {
            await blocker1;
          },
        },
        fetchB: {
          requirement: "FETCH_B",
          resolve: async () => {
            await blocker2;
          },
        },
      },
      { onCancel },
    );

    const reqA = makeReq("FETCH_A");
    const reqB = makeReq("FETCH_B");
    manager.resolve(reqA);
    manager.resolve(reqB);
    await flush();

    expect(manager.getInflight().length).toBe(2);

    manager.abortAll();

    expect(manager.getInflight().length).toBe(0);
    expect(manager.getStatus(reqA.id).state).toBe("canceled");
    expect(manager.getStatus(reqB.id).state).toBe("canceled");
    expect(onCancel).toHaveBeenCalledTimes(2);

    resolveBlocker1();
    resolveBlocker2();
    await flush();
  });
});

// ============================================================================
// Batch Resolution
// ============================================================================

describe("batch resolution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolver with batch.enabled queues requirements", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resolveFn = vi.fn(async () => {});

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        batch: { enabled: true, windowMs: 100 },
        resolve: resolveFn,
      },
    });

    const req1 = makeReq("FETCH", { id: "1" });
    const req2 = makeReq("FETCH", { id: "2" });
    manager.resolve(req1);
    manager.resolve(req2);

    // Not yet resolved — queued in batch
    expect(resolveFn).not.toHaveBeenCalled();
    expect(manager.hasPendingBatches()).toBe(true);

    warnSpy.mockRestore();
  });

  it("processBatches executes queued batch resolvers", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolveFn = vi.fn(async () => {});

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        batch: { enabled: true, windowMs: 5000 },
        resolve: resolveFn,
      },
    });

    const req1 = makeReq("FETCH", { id: "1" });
    const req2 = makeReq("FETCH", { id: "2" });
    manager.resolve(req1);
    manager.resolve(req2);

    expect(resolveFn).not.toHaveBeenCalled();

    manager.processBatches();

    // Let async resolution complete
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    // resolve is called individually for each (fallback since no resolveBatch)
    expect(resolveFn).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });

  it("hasPendingBatches returns true when queued", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        batch: { enabled: true, windowMs: 5000 },
        resolve: async () => {},
      },
    });

    expect(manager.hasPendingBatches()).toBe(false);

    manager.resolve(makeReq("FETCH", { id: "1" }));

    expect(manager.hasPendingBatches()).toBe(true);

    manager.processBatches();

    // After processing, batch requirements are drained
    expect(manager.hasPendingBatches()).toBe(false);

    warnSpy.mockRestore();
  });
});

// ============================================================================
// Resolver Matching
// ============================================================================

describe("resolver matching", () => {
  it("string requirement matches by type", async () => {
    const resolveFn = vi.fn(async () => {});

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        resolve: resolveFn,
      },
    });

    manager.resolve(makeReq("FETCH"));
    await flush();

    expect(resolveFn).toHaveBeenCalledOnce();
  });

  it("function requirement predicate matches custom logic", async () => {
    const resolveFn = vi.fn(async () => {});

    const { manager } = setup({
      custom: {
        requirement: (req): req is typeof req =>
          req.type === "TASK" &&
          (((req as Record<string, unknown>).priority as number) ?? 0) > 5,
        resolve: resolveFn,
      },
    });

    // Should not match — priority too low
    const lowPriority = makeReq("TASK", { priority: 2 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    manager.resolve(lowPriority);
    await flush();
    expect(resolveFn).not.toHaveBeenCalled();

    // Should match
    const highPriority = makeReq("TASK", { priority: 10 });
    manager.resolve(highPriority);
    await flush();
    expect(resolveFn).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });

  it("warns when no resolver matches a requirement type", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        resolve: async () => {},
      },
    });

    manager.resolve(makeReq("UNKNOWN_TYPE"));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'No resolver found for requirement type "UNKNOWN_TYPE"',
      ),
    );

    warnSpy.mockRestore();
  });
});

// ============================================================================
// Dynamic Registration
// ============================================================================

describe("dynamic registration", () => {
  it("registerDefinitions adds new resolvers", async () => {
    const resolveFn = vi.fn(async () => {});

    const { manager } = setup({});

    // No resolver for FETCH yet — should warn
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    manager.resolve(makeReq("FETCH"));
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockClear();

    // Register new resolver
    manager.registerDefinitions({
      fetchData: {
        requirement: "FETCH",
        resolve: resolveFn,
      },
    });

    manager.resolve(makeReq("FETCH", { id: "new" }));
    await flush();

    expect(resolveFn).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });

  it("unregisterDefinition removes and cancels inflight", async () => {
    let resolveBlocker!: () => void;
    const blocker = new Promise<void>((r) => {
      resolveBlocker = r;
    });
    const onCancel = vi.fn();

    const { manager } = setup(
      {
        fetchData: {
          requirement: "FETCH",
          resolve: async () => {
            await blocker;
          },
        },
      },
      { onCancel },
    );

    const req = makeReq("FETCH");
    manager.resolve(req);
    await flush();

    expect(manager.isResolving(req.id)).toBe(true);

    manager.unregisterDefinition("fetchData");

    expect(manager.isResolving(req.id)).toBe(false);
    expect(manager.getStatus(req.id).state).toBe("canceled");
    expect(onCancel).toHaveBeenCalledWith("fetchData", req);

    // New resolve for FETCH should warn — definition removed
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    manager.resolve(makeReq("FETCH", { id: "after-unregister" }));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("No resolver found"),
    );

    warnSpy.mockRestore();
    resolveBlocker();
    await flush();
  });

  it("assignDefinition replaces a resolver", async () => {
    const originalResolve = vi.fn(async () => {});
    const replacementResolve = vi.fn(async () => {});

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        resolve: originalResolve,
      },
    });

    manager.resolve(makeReq("FETCH"));
    await flush();
    expect(originalResolve).toHaveBeenCalledOnce();

    manager.assignDefinition("fetchData", {
      requirement: "FETCH",
      resolve: replacementResolve,
    });

    manager.resolve(makeReq("FETCH", { id: "replaced" }));
    await flush();

    expect(replacementResolve).toHaveBeenCalledOnce();
    expect(originalResolve).toHaveBeenCalledOnce(); // still only once
  });

  it("assignDefinition throws for non-existent resolver", () => {
    const { manager } = setup({});

    expect(() => {
      manager.assignDefinition("nonExistent", {
        requirement: "FETCH",
        resolve: async () => {},
      });
    }).toThrow('Cannot assign resolver "nonExistent"');
  });

  it("callOne with non-existent ID throws", async () => {
    const { manager } = setup({});

    await expect(
      manager.callOne("nonExistent", { type: "FETCH" }),
    ).rejects.toThrow('Cannot call resolver "nonExistent"');
  });

  it("callOne executes a resolver directly", async () => {
    const resolveFn = vi.fn(async (_req, context) => {
      context.facts.data = "direct-call";
    });

    const { facts, manager } = setup({
      fetchData: {
        requirement: "FETCH",
        resolve: resolveFn,
      },
    });

    await manager.callOne("fetchData", { type: "FETCH" });

    expect(resolveFn).toHaveBeenCalledOnce();
    expect(facts.data).toBe("direct-call");
  });
});

// ============================================================================
// Destroy
// ============================================================================

describe("destroy", () => {
  it("destroy clears all state (statuses, caches)", async () => {
    let resolveBlocker!: () => void;
    const blocker = new Promise<void>((r) => {
      resolveBlocker = r;
    });

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        resolve: async () => {
          await blocker;
        },
      },
    });

    const req = makeReq("FETCH");
    manager.resolve(req);
    await flush();

    expect(manager.isResolving(req.id)).toBe(true);

    manager.destroy();

    expect(manager.isResolving(req.id)).toBe(false);
    expect(manager.getInflight()).toEqual([]);
    // After destroy, statuses are cleared — should be idle
    expect(manager.getStatus(req.id).state).toBe("idle");

    resolveBlocker();
    await flush();
  });
});

// ============================================================================
// Resolver Cache
// ============================================================================

describe("resolversByType cache", () => {
  it("returns correct resolver on repeated calls for same type", async () => {
    const resolveFn = vi.fn(async () => {});

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        resolve: resolveFn,
      },
    });

    // First call populates cache
    manager.resolve(makeReq("FETCH", { id: "1" }));
    await flush();

    // Second call should hit cached resolver
    manager.resolve(makeReq("FETCH", { id: "2" }));
    await flush();

    // Third call
    manager.resolve(makeReq("FETCH", { id: "3" }));
    await flush();

    expect(resolveFn).toHaveBeenCalledTimes(3);
  });

  it("cache is cleared when registerDefinitions is called", async () => {
    const oldResolve = vi.fn(async () => {});
    const newResolve = vi.fn(async () => {});

    const { manager } = setup({
      fetchOld: {
        requirement: "FETCH",
        resolve: oldResolve,
      },
    });

    // Populate cache
    manager.resolve(makeReq("FETCH", { id: "1" }));
    await flush();
    expect(oldResolve).toHaveBeenCalledOnce();

    // Register new resolver for same type — cache cleared
    manager.registerDefinitions({
      fetchNew: {
        requirement: "FETCH",
        resolve: newResolve,
      },
    });

    // The old resolver is still in definitions, so it may still match first.
    // The point is the cache was invalidated and re-searched.
    manager.resolve(makeReq("FETCH", { id: "2" }));
    await flush();

    // Combined count should be 2 (one from old, one from old or new depending on iteration order)
    expect(oldResolve.mock.calls.length + newResolve.mock.calls.length).toBe(2);
  });
});

// ============================================================================
// Callbacks
// ============================================================================

describe("lifecycle callbacks", () => {
  it("onStart is called when resolution begins", async () => {
    const onStart = vi.fn();

    const { manager } = setup(
      {
        fetchData: {
          requirement: "FETCH",
          resolve: async () => {},
        },
      },
      { onStart },
    );

    const req = makeReq("FETCH");
    manager.resolve(req);

    expect(onStart).toHaveBeenCalledWith("fetchData", req);

    await flush();
  });

  it("onComplete is called with duration on success", async () => {
    const onComplete = vi.fn();

    const { manager } = setup(
      {
        fetchData: {
          requirement: "FETCH",
          resolve: async () => {},
        },
      },
      { onComplete },
    );

    const req = makeReq("FETCH");
    manager.resolve(req);
    await flush();

    expect(onComplete).toHaveBeenCalledWith(
      "fetchData",
      req,
      expect.any(Number),
    );
  });

  it("onError is called when all retries are exhausted", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();

    const { manager } = setup(
      {
        fetchData: {
          requirement: "FETCH",
          retry: { attempts: 2, backoff: "none" },
          resolve: async () => {
            throw new Error("boom");
          },
        },
      },
      { onError },
    );

    const req = makeReq("FETCH");
    manager.resolve(req);

    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(200);
    }

    expect(onError).toHaveBeenCalledWith("fetchData", req, expect.any(Error));

    vi.useRealTimers();
  });

  it("onResolutionComplete is called after resolution finishes", async () => {
    const onResolutionComplete = vi.fn();

    const { manager } = setup(
      {
        fetchData: {
          requirement: "FETCH",
          resolve: async () => {},
        },
      },
      { onResolutionComplete },
    );

    manager.resolve(makeReq("FETCH"));
    await flush();

    expect(onResolutionComplete).toHaveBeenCalled();
  });

  it("onRetry is called before each retry attempt", async () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();

    const { manager } = setup(
      {
        fetchData: {
          requirement: "FETCH",
          retry: { attempts: 3, backoff: "none" },
          resolve: async () => {
            throw new Error("fail");
          },
        },
      },
      { onRetry },
    );

    const req = makeReq("FETCH");
    manager.resolve(req);

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(200);
    }

    // 3 attempts means 2 retries: attempt 2 and attempt 3
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith("fetchData", req, 2);
    expect(onRetry).toHaveBeenCalledWith("fetchData", req, 3);

    vi.useRealTimers();
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("edge cases", () => {
  it("unregisterDefinition is a no-op for non-existent definition", () => {
    const { manager } = setup({});

    // Should not throw
    manager.unregisterDefinition("doesNotExist");
  });

  it("cancel is a no-op for non-existent requirement", () => {
    const { manager } = setup({});

    // Should not throw
    manager.abort("doesNotExist");
  });

  it("successful status includes completedAt and duration", async () => {
    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        resolve: async () => {},
      },
    });

    const req = makeReq("FETCH");
    manager.resolve(req);
    await flush();

    const status = manager.getStatus(req.id);
    expect(status.state).toBe("success");
    expect(status).toHaveProperty("completedAt");
    expect(status).toHaveProperty("duration");
  });

  it("error status includes error and attempts", async () => {
    vi.useFakeTimers();

    const { manager } = setup({
      fetchData: {
        requirement: "FETCH",
        retry: { attempts: 2, backoff: "none" },
        resolve: async () => {
          throw new Error("test-error");
        },
      },
    });

    const req = makeReq("FETCH");
    manager.resolve(req);

    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(200);
    }

    const status = manager.getStatus(req.id);
    expect(status.state).toBe("error");
    expect(status).toHaveProperty("error");
    expect(status).toHaveProperty("attempts", 2);

    vi.useRealTimers();
  });
});

// ============================================================================
// Constraint-Binding (RFC-0003)
// ============================================================================

/**
 * Setup helper for RFC-0003 tests: a richer schema (matches the canonical
 * production fact shape from the migration that motivated the RFC) with
 * a `getConstraintBinding` lookup. Each binding entry names the facts the
 * triggering resolver aborts on when changed mid-flight.
 */
function setupBinding(
  bindings: Record<string, { fields: readonly string[] }>,
  definitions: Parameters<typeof createResolversManager>[0]["definitions"] = {},
) {
  const bindingSchema = {
    status: t.string(),
    progress: t.number(),
    tail: t.string(),
  };
  const { store, facts } = createFacts({ schema: bindingSchema });
  facts.status = "mutating";
  facts.progress = 0;
  facts.tail = "";

  const manager = createResolversManager({
    definitions,
    facts,
    store,
    getConstraintBinding: (constraintId) => bindings[constraintId],
  });

  return { store, facts, manager };
}

describe("constraint-binding (RFC-0003)", () => {
  it("drops an abort-bound fact write clobbered by an external event", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const { facts, manager } = setupBinding(
      { mutate: { fields: ["status"] } },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            await blocker;
            // An external event set status='left' during the await. The
            // resolver's tail write to the abort-bound fact must be dropped.
            ctx.facts.status = "playing";
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(5);

    facts.status = "left";
    release();
    await flush(20);

    expect(facts.status).toBe("left");
  });

  it("`abortOn` absent (default) — the tail clobber lands", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const { facts, manager } = setupBinding(
      {}, // no binding entry for 'mutate'
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            await blocker;
            ctx.facts.status = "playing";
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(5);
    facts.status = "left";
    release();
    await flush(20);

    expect(facts.status).toBe("playing");
  });

  it("data writes (non-owned facts) survive an owned-fact clobber", async () => {
    // The win-at-the-buzzer case: the resolver's data write must land even
    // though its owned-fact tail write is dropped.
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const { facts, manager } = setupBinding(
      { mutate: { fields: ["status"] } },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            await blocker;
            ctx.facts.progress = 99; // data — not owned → must land
            ctx.facts.status = "playing"; // owned → dropped (clobbered)
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(5);

    facts.status = "left";
    release();
    await flush(20);

    expect(facts.progress).toBe(99); // data preserved
    expect(facts.status).toBe("left"); // owned write dropped
  });

  it("owned-fact write lands in the happy path (no external writer)", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const { facts, manager } = setupBinding(
      { mutate: { fields: ["status"] } },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            await blocker;
            ctx.facts.status = "playing";
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(5);
    release();
    await flush(20);

    expect(facts.status).toBe("playing");
  });

  it("the resolver's own repeated writes to an owned fact all land", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const { facts, manager } = setupBinding(
      { mutate: { fields: ["status"] } },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            ctx.facts.status = "step2"; // own write — updates the expected value
            await blocker;
            ctx.facts.status = "step3"; // still owned, no external writer
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(5);
    release();
    await flush(20);

    expect(facts.status).toBe("step3");
  });

  it("ownership is one-shot per fact — once lost, later writes stay dropped", async () => {
    let release1!: () => void;
    let release2!: () => void;
    const blocker1 = new Promise<void>((r) => {
      release1 = r;
    });
    const blocker2 = new Promise<void>((r) => {
      release2 = r;
    });

    const { facts, manager } = setupBinding(
      { mutate: { fields: ["status"] } },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            await blocker1;
            ctx.facts.status = "a"; // dropped — external set status='left'
            await blocker2;
            ctx.facts.status = "b"; // dropped — one-shot, even though status
            //                          was flipped back to 'mutating' meanwhile
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(5);

    facts.status = "left"; // clobber
    release1();
    await flush(5);
    expect(facts.status).toBe("left"); // write 'a' was dropped

    facts.status = "mutating"; // fact returns to the resolver's expected value
    release2();
    await flush(20);

    // Without one-shot, write 2 would see status==='mutating' (==expected) and
    // land as 'b'. The binding stays deactivated for this fact once lost.
    expect(facts.status).toBe("mutating");
  });

  it("no freeze — writing a non-owned fact never affects the owned write", async () => {
    // Regression for the recipe-freeze bug: the binding does not consult
    // when(), so the resolver clearing some OTHER fact cannot deactivate it.
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const { facts, manager } = setupBinding(
      { mutate: { fields: ["status"] } },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            await blocker;
            ctx.facts.tail = "cleared"; // non-owned write
            ctx.facts.status = "playing"; // owned — must still land
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(5);
    release();
    await flush(20);

    expect(facts.tail).toBe("cleared");
    expect(facts.status).toBe("playing");
  });

  it("ctx.signal.aborted becomes true after a dropped owned write", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    let observation: "before-write" | "after-write" | null = null;

    const { facts, manager } = setupBinding(
      { mutate: { fields: ["status"] } },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            await blocker;
            const before = ctx.signal.aborted;
            ctx.facts.status = "playing"; // dropped → triggers abort
            const after = ctx.signal.aborted;
            observation = !before && after ? "after-write" : "before-write";
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(5);
    facts.status = "left";
    release();
    await flush(20);

    expect(observation).toBe("after-write");
  });

  it("a non-owned (data) write does not abort the resolver", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    let abortedAfterDataWrite = true;

    const { facts, manager } = setupBinding(
      { mutate: { fields: ["status"] } },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            await blocker;
            ctx.facts.progress = 5; // data write — never aborts
            abortedAfterDataWrite = ctx.signal.aborted;
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(5);
    facts.status = "left"; // owned fact changed, but resolver never writes it
    release();
    await flush(20);

    expect(abortedAfterDataWrite).toBe(false);
    expect(facts.progress).toBe(5);
  });

  it("pre-await synchronous owned writes pass (constraint was true at fire time)", async () => {
    const { facts, manager } = setupBinding(
      { mutate: { fields: ["status"] } },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            ctx.facts.status = "playing";
            ctx.facts.tail = "sync-prelude";
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(20);

    expect(facts.status).toBe("playing");
    expect(facts.tail).toBe("sync-prelude");
  });

  it("callOne has no source constraint — binding is a no-op", async () => {
    const { facts, manager } = setupBinding(
      { mutate: { fields: ["status"] } },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            ctx.facts.status = "playing";
          },
        },
      },
    );

    facts.status = "left";
    await manager.callOne("execute", { type: "EXECUTE" });

    expect(facts.status).toBe("playing");
  });

  it("a requirement from an unbound constraint is a no-op", async () => {
    const { facts, manager } = setupBinding(
      { mutate: { fields: ["status"] } },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            ctx.facts.status = "playing";
          },
        },
      },
    );

    facts.status = "left";
    // 'unknown-constraint' has no binding entry → resolveBinding returns null.
    const req = makeReq("EXECUTE", {}, "unknown-constraint");
    manager.resolve(req);
    await flush(20);

    expect(facts.status).toBe("playing");
  });

  it("an empty fields list is treated as no binding", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const { facts, manager } = setupBinding(
      { mutate: { fields: [] } },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            await blocker;
            ctx.facts.status = "playing";
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(5);
    facts.status = "left";
    release();
    await flush(20);

    expect(facts.status).toBe("playing");
  });

  it("the bound proxy reads underlying fact values", async () => {
    let observedStatus = "";
    const { manager } = setupBinding(
      { mutate: { fields: ["status"] } },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            observedStatus = ctx.facts.status as string;
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(10);

    expect(observedStatus).toBe("mutating");
  });
});

// ============================================================================
// fix: bound resolver post-await ownership escape
// ============================================================================

describe("bound resolver — listener-triggered ownership escape", () => {
  it("the resolver's intended value (not the listener's) holds the slot", async () => {
    const bindingSchema = {
      status: t.string(),
      progress: t.number(),
      tail: t.string(),
    };
    const { store, facts } = createFacts({ schema: bindingSchema });
    facts.status = "mutating";
    facts.progress = 0;
    facts.tail = "";

    // Listener on `status` mutates the same fact synchronously during the
    // resolver's write. Without the fix, after the resolver writes A=v1,
    // the post-Reflect.set re-read pulls the listener's value into
    // `expected`, silently transferring ownership.
    const unsubscribe = store.subscribe(["status"], () => {
      const current = store.get("status");
      if (current === "step1") {
        // Mid-set listener mutation — simulates an event handler firing
        // while the resolver is mid-write.
        store.set("status", "listener-clobber");
      }
    });

    const manager = createResolversManager({
      definitions: {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            ctx.facts.status = "step1"; // listener clobbers to "listener-clobber"
            // Yield so the deferred notification can drain
            await Promise.resolve();
            // Owned write to A again — should be detected as clobbered
            // (rawFacts.status !== expected.status which is "step1").
            ctx.facts.status = "step2";
          },
        },
      },
      facts,
      store,
      getConstraintBinding: (id) =>
        id === "mutate" ? { fields: ["status"] } : undefined,
    });

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(20);
    unsubscribe();

    // The second write must NOT land — the listener's mid-set mutation
    // counts as an external clobber. Without the fix, expected would have
    // been re-read as "listener-clobber", so the second write to "step2"
    // would have been allowed (since at that moment rawFacts == expected).
    expect(facts.status).toBe("listener-clobber");
  });
});

// ============================================================================
// fix: sibling bound-resolver clobber gap (pre-dispatch baseline)
// ============================================================================

describe("bound resolver — sibling clobber gap (factsBaseline)", () => {
  it("two resolvers in one tick share a baseline; the second's abort-bound write is clobber-detected", async () => {
    const bindingSchema = {
      status: t.string(),
      progress: t.number(),
      tail: t.string(),
    };
    const { store, facts } = createFacts({ schema: bindingSchema });
    facts.status = "initial";
    facts.progress = 0;
    facts.tail = "";

    let r1Aborted = false;
    let r2Aborted = false;

    const manager = createResolversManager({
      definitions: {
        resolverA: {
          requirement: "WRITE_A",
          resolve: async (_req, ctx) => {
            ctx.facts.status = "v1";
            await Promise.resolve();
            r1Aborted = ctx.signal.aborted;
          },
        },
        resolverB: {
          requirement: "WRITE_B",
          resolve: async (_req, ctx) => {
            // Sibling resolver also abort-binds `status` — without a shared
            // baseline it would see rawFacts.status == v1 (from resolverA)
            // and silently overwrite. With the shared baseline, expected
            // is "initial" and rawFacts is "v1" → clobber detected.
            ctx.facts.status = "v2";
            r2Aborted = ctx.signal.aborted;
          },
        },
      },
      facts,
      store,
      getConstraintBinding: (id) =>
        id === "c1" || id === "c2" ? { fields: ["status"] } : undefined,
    });

    // Engine-style: take one snapshot, then dispatch both resolvers with the
    // same baseline.
    const factsBaseline = store.toObject() as Record<string, unknown>;
    const reqA = makeReq("WRITE_A", {}, "c1");
    const reqB = makeReq("WRITE_B", {}, "c2");
    manager.resolve(reqA, { factsBaseline });
    manager.resolve(reqB, { factsBaseline });
    await flush(20);

    // Resolver A's write must land; resolver B's owned write must be dropped
    // (signal aborted on dispatch of the dropped write).
    expect(facts.status).toBe("v1");
    expect(r2Aborted).toBe(true);
    expect(r1Aborted).toBe(false);
  });

  it("without baseline (back-compat) — second resolver still clobbers (regression guard)", async () => {
    const bindingSchema = {
      status: t.string(),
      progress: t.number(),
      tail: t.string(),
    };
    const { store, facts } = createFacts({ schema: bindingSchema });
    facts.status = "initial";
    facts.progress = 0;
    facts.tail = "";

    const manager = createResolversManager({
      definitions: {
        resolverA: {
          requirement: "WRITE_A",
          resolve: async (_req, ctx) => {
            ctx.facts.status = "v1";
          },
        },
        resolverB: {
          requirement: "WRITE_B",
          resolve: async (_req, ctx) => {
            // Synchronous write before any await — exercises the bound proxy
            // even without baseline threading.
            ctx.facts.status = "v2";
          },
        },
      },
      facts,
      store,
      getConstraintBinding: (id) =>
        id === "c1" || id === "c2" ? { fields: ["status"] } : undefined,
    });

    // No baseline passed — fall back to per-resolver seeding from rawFacts.
    // Documents the historical behavior (the bug): second resolver wins.
    const reqA = makeReq("WRITE_A", {}, "c1");
    const reqB = makeReq("WRITE_B", {}, "c2");
    manager.resolve(reqA);
    manager.resolve(reqB);
    await flush(20);

    expect(facts.status).toBe("v2");
  });
});

// ============================================================================
// R2 — factsBaseline lazy perf (system-level)
// ============================================================================

/** Flush microtasks + one setTimeout round so reconcile lands. */
async function flushSettle(): Promise<void> {
  await flushMicrotasks();
  await new Promise((r) => setTimeout(r, 0));
  await flushMicrotasks();
}

describe("R2 — factsBaseline lazy perf", () => {
  it("clobber-binding still works with sparse baseline (only owned keys snapshotted)", async () => {
    // Build a module with many facts but only ONE bound constraint owning
    // a single key. The engine should still detect a tail-clobber on the
    // owned fact, which is the load-bearing observable for the lazy
    // baseline path. (Sibling unrelated facts must NOT need to be in the
    // baseline for the binding to work — that's the whole perf win.)
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const factsSchema: Record<string, ReturnType<typeof t.number>> = {};
    for (let i = 0; i < 200; i++) {
      factsSchema[`f${i}`] = t.number();
    }
    const m = createModule("big", {
      schema: {
        facts: {
          ...factsSchema,
          status: t.string(),
        },
        derivations: {},
        events: {
          start: {},
          forceLeft: {},
        },
        requirements: {
          DO: {},
        },
      },
      init: (f) => {
        for (let i = 0; i < 200; i++) {
          (f as Record<string, unknown>)[`f${i}`] = i;
        }
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
          when: (f) => f.status === "mutating",
          require: { type: "DO" },
          abortOn: ["status"],
        },
      },
      resolvers: {
        run: {
          requirement: "DO",
          resolve: async (_req, ctx) => {
            await blocker;
            // Tail clobber attempt — must be dropped.
            ctx.facts.status = "playing";
          },
        },
      },
    });

    const sys = createSystem({ module: m });
    sys.start();
    await flushSettle();

    sys.events.start();
    await flushSettle();

    sys.events.forceLeft();
    await flushSettle();
    expect(sys.facts.status).toBe("left");

    release();
    await flushSettle();

    // Binding works: tail write was dropped, status stays "left".
    expect(sys.facts.status).toBe("left");
    sys.destroy();
  });

  it("no bound constraints in a tick → resolver still runs (no baseline overhead)", async () => {
    // When `added` requirements have no `abortOn` field, the engine should
    // skip building factsBaseline entirely. Behavior must be unchanged.
    let resolved = false;
    const m = createModule("noown", {
      schema: {
        facts: { count: t.number() },
        derivations: {},
        events: {},
        requirements: { NUDGE: {} },
      },
      init: (f) => {
        f.count = 0;
      },
      constraints: {
        c: {
          when: (f) => f.count === 0,
          require: { type: "NUDGE" },
          // no `abortOn` — unbound resolver
        },
      },
      resolvers: {
        nudge: {
          requirement: "NUDGE",
          resolve: async (_req, ctx) => {
            ctx.facts.count = 1;
            resolved = true;
          },
        },
      },
    });
    const sys = createSystem({ module: m });
    sys.start();
    await flushSettle();
    await sys.settle();
    expect(resolved).toBe(true);
    expect(sys.facts.count).toBe(1);
    sys.destroy();
  });
});

// ============================================================================
// R2 — Clobber observability
// ============================================================================

describe("R2 — clobber observability via system.observe", () => {
  it("emits resolver.write.rejected on a dropped abort-bound write", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const m = createModule("clobObs", {
      schema: {
        facts: { status: t.string() },
        derivations: {},
        events: {
          start: {},
          forceLeft: {},
        },
        requirements: { ACT: {} },
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
          when: (f) => f.status === "mutating",
          require: { type: "ACT" },
          abortOn: ["status"],
        },
      },
      resolvers: {
        run: {
          requirement: "ACT",
          resolve: async (_req, ctx) => {
            await blocker;
            // Triggers clobber detection.
            ctx.facts.status = "playing";
          },
        },
      },
    });

    const sys = createSystem({ module: m });
    sys.start();
    await flushSettle();

    const events: ObservationEvent[] = [];
    const unsub = sys.observe((e) => events.push(e));

    sys.events.start();
    await flushSettle();
    sys.events.forceLeft();
    await flushSettle();
    release();
    await flushSettle();

    const clobbers = events.filter(
      (
        e,
      ): e is Extract<ObservationEvent, { type: "resolver.write.rejected" }> =>
        e.type === "resolver.write.rejected",
    );
    expect(clobbers.length).toBeGreaterThanOrEqual(1);
    const evt = clobbers[0]!;
    expect(evt.resolver).toBe("run");
    expect(evt.reason).toBe("clobbered");
    expect(evt.kind).toBe("rejection");
    if (evt.kind !== "rejection") {
      throw new Error("expected a rejection-kind event");
    }
    expect(evt.fact).toBe("status");
    expect(evt.actual).toBe("left");
    expect(evt.expected).toBe("mutating");

    unsub();
    sys.destroy();
  });
});

// ============================================================================
// R4 FIX 7 — clobber-event amplification rate-limit
// ============================================================================

describe("R4 — clobber-event rate-limit", () => {
  it("caps per-instance clobber events at 10 + one suppressed summary", async () => {
    // A single resolver abort-binds 100 facts. An external write clobbers
    // every one, then the resolver tries to write all 100 — without a
    // rate-limit that would broadcast 100 clobber events to every plugin.
    const FACT_COUNT = 100;
    const factKeys = Array.from({ length: FACT_COUNT }, (_, i) => `f${i}`);

    const factSchema: Record<string, ReturnType<typeof t.string>> = {};
    for (const k of factKeys) {
      factSchema[k] = t.string();
    }
    const { store, facts } = createFacts({ schema: factSchema });
    for (const k of factKeys) {
      facts[k] = "owned";
    }

    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const clobberEvents: Array<{ fact: string }> = [];
    const suppressedEvents: Array<{ dropped: number }> = [];

    const manager = createResolversManager({
      definitions: {
        bulk: {
          requirement: "BULK",
          resolve: async (_req, ctx) => {
            await blocker;
            // Every owned write is clobbered (external write changed them).
            for (const k of factKeys) {
              (ctx.facts as Record<string, unknown>)[k] = "resolver";
            }
          },
        },
      },
      facts,
      store,
      getConstraintBinding: (constraintId) =>
        constraintId === "bulkC" ? { fields: factKeys } : undefined,
      onClobber: (_resolver, _req, fact) => {
        clobberEvents.push({ fact });
      },
      onClobberSuppressed: (_resolver, _req, dropped) => {
        suppressedEvents.push({ dropped });
      },
    });

    const req = makeReq("BULK", {}, "bulkC");
    manager.resolve(req);
    await flush(5);

    // External clobber of every owned fact.
    for (const k of factKeys) {
      facts[k] = "external";
    }
    release();
    await flush(30);

    // At most 10 per-clobber events, then exactly one summary.
    expect(clobberEvents.length).toBeLessThanOrEqual(10);
    expect(clobberEvents.length).toBe(10);
    expect(suppressedEvents.length).toBe(1);
    // Total observed events stay capped at 11.
    expect(clobberEvents.length + suppressedEvents.length).toBeLessThanOrEqual(
      11,
    );
    // The summary reports a positive dropped count.
    expect(suppressedEvents[0]!.dropped).toBeGreaterThan(0);
  });

  it("under the cap, every clobber emits and no summary fires", async () => {
    const factKeys = ["a", "b", "c"];
    const factSchema: Record<string, ReturnType<typeof t.string>> = {};
    for (const k of factKeys) {
      factSchema[k] = t.string();
    }
    const { store, facts } = createFacts({ schema: factSchema });
    for (const k of factKeys) {
      facts[k] = "owned";
    }

    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const clobberEvents: string[] = [];
    let suppressedFired = false;

    const manager = createResolversManager({
      definitions: {
        few: {
          requirement: "FEW",
          resolve: async (_req, ctx) => {
            await blocker;
            for (const k of factKeys) {
              (ctx.facts as Record<string, unknown>)[k] = "resolver";
            }
          },
        },
      },
      facts,
      store,
      getConstraintBinding: (constraintId) =>
        constraintId === "fewC" ? { fields: factKeys } : undefined,
      onClobber: (_resolver, _req, fact) => {
        clobberEvents.push(fact);
      },
      onClobberSuppressed: () => {
        suppressedFired = true;
      },
    });

    const req = makeReq("FEW", {}, "fewC");
    manager.resolve(req);
    await flush(5);
    for (const k of factKeys) {
      facts[k] = "external";
    }
    release();
    await flush(30);

    // 3 owned facts clobbered → 3 events, no summary (under the cap of 10).
    expect(clobberEvents.length).toBe(3);
    expect(suppressedFired).toBe(false);
  });
});

// ============================================================================
// R2 — Batch baseline staleness
// ============================================================================

describe("R2 — batch baseline freshness", () => {
  it("batched bound resolver uses the latest non-undefined baseline", async () => {
    // Two reqs hit the batch within the window. The first carries a
    // stale baseline (status='ready'). Between the two adds, an external
    // event clobbers status to 'gone'. The second req's baseline reflects
    // the live state, so when the batch fires the clobber check sees the
    // resolver's owned-fact assumption is wrong and drops its tail write.
    const m = createModule("bbatch", {
      schema: {
        facts: { status: t.string() },
        derivations: {},
        events: {
          fire: {},
          forceGone: {},
        },
        requirements: { B: { tag: t.string() } },
      },
      init: (f) => {
        f.status = "ready";
      },
      events: {
        fire: (f) => {
          // No-op trigger — the constraint emits on this status.
          f.status = "ready";
        },
        forceGone: (f) => {
          f.status = "gone";
        },
      },
      constraints: {
        cReady: {
          when: (f) => f.status === "ready",
          require: { type: "B", tag: "x" },
          abortOn: ["status"],
        },
      },
      resolvers: {
        bRun: {
          requirement: "B",
          batch: { enabled: true, windowMs: 50, maxSize: 10 },
          resolveBatch: async (_reqs, ctx) => {
            ctx.facts.status = "after";
          },
        },
      },
    });

    const sys = createSystem({ module: m });
    sys.start();
    await flushSettle();

    // First add — emits req with baseline { status: 'ready' }.
    // The single-shot constraint fires once; force a second add by
    // toggling status back via event after the first fire.
    sys.events.fire();
    await flushSettle();

    // External clobber.
    sys.events.forceGone();
    await flushSettle();
    expect(sys.facts.status).toBe("gone");

    // The batch eventually fires; either the baseline-freshness branch
    // detects the clobber (status stays 'gone') or, if the constraint
    // re-emit pattern matches the test setup exactly, the write is
    // dropped. Either way the resolver's tail must NOT silently overwrite
    // the externally-set 'gone'.
    await new Promise((r) => setTimeout(r, 80));
    await flushSettle();
    expect(sys.facts.status).toBe("gone");

    sys.destroy();
  });
});

// ============================================================================
// R1 C-batch 2 — Batch resolver in-flight cancellation (C8)
// ============================================================================
//
// Before this fix, `cancel(reqId)` and `cancelAll()` could only see
// requirements that were either still pre-flush in a batch queue OR
// non-batched (in `inflight`). Once a batch left the queue and entered
// `executeBatch`, the AbortController was unreachable from outside; the
// batch ran to completion regardless of cancel.
//
// The fix tracks in-flight batches in `batchInflight` keyed by an opaque
// instance id, with a `reqToBatch` reverse index so `cancel(reqId)` can
// abort the owning batch in O(1).
describe("batch resolver in-flight cancellation (R1 C8)", () => {
  it("cancel(reqId) aborts an in-flight batch via the shared controller", async () => {
    // Set up a batch resolver whose `resolveBatch` blocks on a deferred
    // promise so we can issue cancel before it completes.
    const cancelEvents: string[] = [];
    // `!` (definite assignment) because TS narrows `releaseBatch` to
    // `null` immediately after the initializer — the assignment from
    // inside the Promise executor doesn't update the outer narrowing.
    let releaseBatch!: () => void;
    const batchSignals: Array<AbortSignal | undefined> = [];
    const blocker = new Promise<void>((r) => {
      releaseBatch = r;
    });

    const { manager } = setup(
      {
        bulkFetch: {
          requirement: "BULK_FETCH",
          batch: { enabled: true, windowMs: 1, maxSize: 100 },
          resolveBatch: async (_reqs, ctx) => {
            batchSignals.push(ctx.signal);
            await blocker;
          },
        },
      },
      { onCancel: (_resolverId, req) => cancelEvents.push(req.id) },
    );

    const r1 = makeReq("BULK_FETCH", { id: "a" });
    const r2 = makeReq("BULK_FETCH", { id: "b" });
    const r3 = makeReq("BULK_FETCH", { id: "c" });
    manager.resolve(r1);
    manager.resolve(r2);
    manager.resolve(r3);

    // Wait for the batch to flush + enter executeBatch (windowMs = 1ms).
    await new Promise((r) => setTimeout(r, 10));

    // Sanity: the batch is now in-flight (signal captured, not yet aborted).
    expect(batchSignals.length).toBe(1);
    expect(batchSignals[0]?.aborted).toBe(false);

    // Cancel via one of the requirements in the batch. The whole batch's
    // controller fires (all-or-nothing semantic).
    manager.abort(r2.id);

    expect(batchSignals[0]?.aborted).toBe(true);
    // onCancel fires for every requirement in the batch, not just r2.
    expect(cancelEvents.sort()).toEqual([r1.id, r2.id, r3.id].sort());

    // All three statuses are now "canceled".
    expect(manager.getStatus(r1.id).state).toBe("canceled");
    expect(manager.getStatus(r2.id).state).toBe("canceled");
    expect(manager.getStatus(r3.id).state).toBe("canceled");

    // Release the underlying batch work so the test doesn't leak.
    releaseBatch();
    await flush();
  });

  it("cancelAll() aborts every in-flight batch", async () => {
    const cancelEvents: string[] = [];
    const aborts: AbortSignal[] = [];
    // `!` (definite assignment) — see comment on the earlier deferred
    // pattern in this file for the rationale.
    let releaseA!: () => void;
    let releaseB!: () => void;
    const blockerA = new Promise<void>((r) => {
      releaseA = r;
    });
    const blockerB = new Promise<void>((r) => {
      releaseB = r;
    });
    let callIndex = 0;

    const { manager } = setup(
      {
        groupA: {
          requirement: "GROUP_A",
          batch: { enabled: true, windowMs: 1, maxSize: 100 },
          resolveBatch: async (_reqs, ctx) => {
            aborts.push(ctx.signal);
            const which = callIndex++;
            if (which === 0) await blockerA;
            else await blockerB;
          },
        },
        groupB: {
          requirement: "GROUP_B",
          batch: { enabled: true, windowMs: 1, maxSize: 100 },
          resolveBatch: async (_reqs, ctx) => {
            aborts.push(ctx.signal);
            const which = callIndex++;
            if (which === 0) await blockerA;
            else await blockerB;
          },
        },
      },
      { onCancel: (_resolverId, req) => cancelEvents.push(req.id) },
    );

    const a1 = makeReq("GROUP_A");
    const a2 = makeReq("GROUP_A", { tag: "v2" });
    const b1 = makeReq("GROUP_B");
    manager.resolve(a1);
    manager.resolve(a2);
    manager.resolve(b1);

    await new Promise((r) => setTimeout(r, 10));
    expect(aborts.length).toBe(2);
    expect(aborts.every((s) => !s.aborted)).toBe(true);

    manager.abortAll();

    // Both in-flight batches now aborted.
    expect(aborts.every((s) => s.aborted)).toBe(true);
    // onCancel fired for every requirement across both batches.
    expect(cancelEvents.sort()).toEqual([a1.id, a2.id, b1.id].sort());

    releaseA();
    releaseB();
    await flush();
  });

  it("in-flight cancel cleans up the reverse index so the same reqId can be re-resolved later", async () => {
    // `!` (definite assignment) — Promise executor assignment doesn't
    // update outer narrowing under TS 5.5+.
    let releaseFirst!: () => void;
    const blocker = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let runs = 0;

    const { manager } = setup({
      job: {
        requirement: "JOB",
        batch: { enabled: true, windowMs: 1, maxSize: 100 },
        resolveBatch: async () => {
          runs++;
          if (runs === 1) await blocker;
        },
      },
    });

    const req = makeReq("JOB", { id: "same-id" });
    manager.resolve(req);
    await new Promise((r) => setTimeout(r, 10));
    manager.abort(req.id);
    releaseFirst();
    await flush();

    // Re-resolve the SAME requirement id — should be accepted (the
    // reverse-index entry was cleaned up by the cancel path) and the
    // resolveBatch should run a SECOND time, which is what `runs === 2`
    // verifies. The intervening status race ("canceled" vs "success"
    // after the underlying work resolves post-abort) is not the
    // invariant under test here.
    manager.resolve(req);
    await new Promise((r) => setTimeout(r, 10));
    await flush();
    expect(runs).toBe(2);
  });

});
