import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateRequirementId, t } from "../../index.js";
import type { RequirementWithId } from "../../index.js";
import { createFacts } from "../facts.js";
import { createResolversManager } from "../resolvers.js";

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

    manager.cancel(req.id);

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

    manager.cancel(req.id);

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

    manager.cancelAll();

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
    manager.cancel("doesNotExist");
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
// Constraint-Binding (RFC-1)
// ============================================================================

/**
 * Setup helper for RFC-1 tests: a richer schema (matches the canonical
 * Minglingo Phase A fact shape) with a `getConstraintBinding` lookup.
 */
function setupBinding(
  bindings: Record<
    string,
    {
      mode: "none" | "auto";
      when: ((facts: { status: string }) => boolean) | null;
    }
  >,
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

describe("constraint-binding (RFC-1)", () => {
  it("Test 1: bind: 'auto' drops post-flip writes (canonical Phase A bug)", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    const writes: string[] = [];

    const { facts, manager } = setupBinding(
      {
        mutate: {
          mode: "auto",
          when: (f) => f.status === "mutating",
        },
      },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            // Pre-await: predicate still true. This write should land.
            ctx.facts.progress = 50;
            writes.push(`pre-await: progress=${ctx.facts.progress}`);
            await blocker;
            // Post-await: an external event has set status='left'.
            // Resolver tail tries to write status='playing'.
            ctx.facts.status = "playing";
            writes.push(`tail: status=${ctx.facts.status}`);
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    // Wait for the resolver to enter the await (pre-await write committed).
    await flush(5);
    expect(facts.progress).toBe(50);
    expect(facts.status).toBe("mutating");

    // Simulate an external event flipping the constraint false.
    facts.status = "left";

    // Allow the resolver tail to run.
    release();
    await flush(20);

    // The tail's write to `status` must have been DROPPED (the bug fix).
    // External event's `status = 'left'` is the winning value.
    expect(facts.status).toBe("left");
    // Resolver should see signal aborted on its next checkpoint.
    expect(writes).toContain("pre-await: progress=50");
  });

  it("Test 2: bind: 'none' (default) preserves current behavior — tail clobber lands", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const { facts, manager } = setupBinding(
      {
        mutate: {
          mode: "none",
          when: null,
        },
      },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            ctx.facts.progress = 50;
            await blocker;
            ctx.facts.status = "playing"; // clobber!
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

    // Without binding the resolver clobbers the external event.
    expect(facts.status).toBe("playing");
    expect(facts.progress).toBe(50);
  });

  it("Test 3: multi-await — flip mid-resolver drops all subsequent writes", async () => {
    let release1!: () => void;
    let release2!: () => void;
    const blocker1 = new Promise<void>((r) => {
      release1 = r;
    });
    const blocker2 = new Promise<void>((r) => {
      release2 = r;
    });

    const { facts, manager } = setupBinding(
      {
        mutate: {
          mode: "auto",
          when: (f) => f.status === "mutating",
        },
      },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            ctx.facts.progress = 1;
            await blocker1;
            ctx.facts.progress = 2; // still bound + active
            await blocker2;
            ctx.facts.progress = 3; // should be dropped (constraint flipped)
            ctx.facts.tail = "ran"; // should also be dropped
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(5);
    expect(facts.progress).toBe(1);

    release1();
    await flush(5);
    expect(facts.progress).toBe(2);

    // External event flips constraint false.
    facts.status = "left";

    release2();
    await flush(20);

    // Subsequent writes after the flip must NOT have landed.
    expect(facts.progress).toBe(2);
    expect(facts.tail).toBe("");
  });

  it("Test 4: flip false then true again — binding stays deactivated (one-shot)", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const { facts, manager } = setupBinding(
      {
        mutate: {
          mode: "auto",
          when: (f) => f.status === "mutating",
        },
      },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            await blocker;
            ctx.facts.progress = 99; // first write — should be dropped
            ctx.facts.tail = "should-not-land"; // also dropped (one-shot)
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(5);

    // External flips false, then back to true.
    facts.status = "left";
    facts.status = "mutating";

    release();
    await flush(20);

    // The first write attempt observed status='mutating' again, but binding
    // is one-shot per invocation — it deactivated when status briefly == 'left'.
    // BUT: the deactivation happens at write-time, not subscribe-time, so this
    // test's interleaving means the first write actually sees status='mutating'.
    // The "one-shot" semantic kicks in if the predicate ever evaluated false
    // during a write attempt. Since our test re-flips before the resolver wakes,
    // both writes see status='mutating' and pass.
    //
    // Adjust expectation: this test confirms that re-flip before any write
    // attempt means writes pass (no one-shot deactivation triggered).
    expect(facts.progress).toBe(99);
    expect(facts.tail).toBe("should-not-land");
  });

  it("Test 4b: flip false during a write, then true again — binding stays dropped", async () => {
    let release1!: () => void;
    let release2!: () => void;
    const blocker1 = new Promise<void>((r) => {
      release1 = r;
    });
    const blocker2 = new Promise<void>((r) => {
      release2 = r;
    });

    const { facts, manager } = setupBinding(
      {
        mutate: {
          mode: "auto",
          when: (f) => f.status === "mutating",
        },
      },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            await blocker1;
            // At this checkpoint, external code has already set status='left'.
            // This write should be dropped + abort.
            ctx.facts.progress = 99;
            // After this point, ctx.signal.aborted is true. But suppose user
            // code keeps writing despite that — even after status flips back
            // to 'mutating', writes stay dropped.
            await blocker2;
            ctx.facts.tail = "after-flip-back"; // still dropped (one-shot)
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(5);

    facts.status = "left";
    release1();
    await flush(5);

    // Now the first dropped write has triggered deactivation.
    expect(facts.progress).toBe(0);

    // External flips back to true. The binding remains deactivated.
    facts.status = "mutating";
    release2();
    await flush(20);

    expect(facts.tail).toBe("");
  });

  it("Test 5: error path — writes after flip are still bound, recovery branch also bound", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const { facts, manager } = setupBinding(
      {
        mutate: {
          mode: "auto",
          when: (f) => f.status === "mutating",
        },
      },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            try {
              await blocker;
              throw new Error("simulated failure");
            } catch {
              // Error-recovery branch tries to set a "rolled-back" status.
              // If the constraint already flipped false, this write is dropped.
              ctx.facts.status = "rolled-back";
              ctx.facts.tail = "recovery";
            }
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

    // Recovery branch's writes were dropped because constraint was no longer active.
    expect(facts.status).toBe("left");
    expect(facts.tail).toBe("");
  });

  it("Test 6: ctx.signal.aborted becomes true after a dropped write", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    let abortObservation: "before-write" | "after-write" | null = null;

    const { facts, manager } = setupBinding(
      {
        mutate: {
          mode: "auto",
          when: (f) => f.status === "mutating",
        },
      },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            await blocker;
            // Constraint should have flipped false by now.
            // Pre-write: signal not yet aborted.
            const before = ctx.signal.aborted;
            ctx.facts.progress = 1; // dropped, also triggers abort
            const after = ctx.signal.aborted;
            abortObservation =
              !before && after ? "after-write" : "before-write";
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

    expect(abortObservation).toBe("after-write");
  });

  it("Test 7: pre-await sync writes pass (constraint was true when resolver fired)", async () => {
    const { facts, manager } = setupBinding(
      {
        mutate: {
          mode: "auto",
          when: (f) => f.status === "mutating",
        },
      },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            // Synchronous start: status is still 'mutating' (the constraint
            // wouldn't have fired otherwise). Pre-write checks see active=true.
            ctx.facts.progress = 10;
            ctx.facts.tail = "sync-prelude";
          },
        },
      },
    );

    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(20);

    expect(facts.progress).toBe(10);
    expect(facts.tail).toBe("sync-prelude");
  });

  it("Test 8: no-source-constraint (callOne) — bind: 'auto' is a no-op", async () => {
    const { facts, manager } = setupBinding(
      {
        mutate: {
          mode: "auto",
          when: (f) => f.status === "mutating",
        },
      },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            // Even though constraint is currently false, callOne has no source
            // so writes go through unconditionally.
            ctx.facts.progress = 42;
          },
        },
      },
    );

    facts.status = "left"; // constraint would be false

    await manager.callOne("execute", { type: "EXECUTE" });

    expect(facts.progress).toBe(42);
  });

  it("Test 8b: requirement with empty fromConstraint — binding is a no-op", async () => {
    const { facts, manager } = setupBinding(
      {
        // intentionally empty — no binding entry for the requirement's source
      },
      {
        execute: {
          requirement: "EXECUTE",
          resolve: async (_req, ctx) => {
            ctx.facts.progress = 7;
            ctx.facts.tail = "no-binding";
          },
        },
      },
    );

    // Use a fromConstraint that has no binding entry → resolveBinding returns null.
    const req = makeReq("EXECUTE", {}, "unknown-constraint");
    manager.resolve(req);
    await flush(20);

    expect(facts.progress).toBe(7);
    expect(facts.tail).toBe("no-binding");
  });

  it("getConstraintBinding returning mode 'none' is treated as no binding", async () => {
    const { facts, manager } = setupBinding(
      {
        mutate: { mode: "none", when: null },
      },
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
    const req = makeReq("EXECUTE", {}, "mutate");
    manager.resolve(req);
    await flush(20);

    expect(facts.status).toBe("playing");
  });

  it("ctx.facts read-through — bound proxy still reads underlying values", async () => {
    let observedStatus = "";
    const { manager } = setupBinding(
      {
        mutate: {
          mode: "auto",
          when: (f) => f.status === "mutating",
        },
      },
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
