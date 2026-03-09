import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { createErrorBoundaryManager } from "../errors.js";
import type { RecoveryStrategy } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function createFailingModule(opts?: {
  resolverError?: boolean;
  constraintError?: boolean;
  effectError?: boolean;
  derivationError?: boolean;
}) {
  let resolverShouldFail = opts?.resolverError ?? false;
  let constraintShouldFail = opts?.constraintError ?? false;
  let effectShouldFail = opts?.effectError ?? false;
  let derivationShouldFail = opts?.derivationError ?? false;

  const module = createModule("test", {
    schema: {
      facts: {
        count: t.number(),
        status: t.string(),
      },
      events: {
        trigger: {},
        setStatus: { value: t.string() },
      },
      derivations: {
        doubled: t.number(),
      },
      requirements: {
        DO_WORK: { value: t.number() },
      },
    },
    init: (facts) => {
      facts.count = 0;
      facts.status = "idle";
    },
    events: {
      trigger: (facts) => {
        facts.count = (facts.count as number) + 1;
      },
      setStatus: (facts, { value }) => {
        facts.status = value;
      },
    },
    derive: {
      doubled: (facts) => {
        if (derivationShouldFail) {
          throw new Error("derivation failure");
        }

        return (facts.count as number) * 2;
      },
    },
    effects: {
      sideEffect: {
        run: (facts) => {
          if (effectShouldFail && (facts.count as number) > 0) {
            throw new Error("effect failure");
          }
        },
      },
    },
    constraints: {
      needsWork: {
        priority: 10,
        when: (facts) => {
          if (constraintShouldFail) {
            throw new Error("constraint failure");
          }

          return facts.status === "loading";
        },
        require: (facts) => ({
          type: "DO_WORK",
          value: facts.count as number,
        }),
      },
    },
    resolvers: {
      doWork: {
        requirement: "DO_WORK",
        resolve: async (_req, context) => {
          if (resolverShouldFail) {
            throw new Error("resolver failure");
          }

          context.facts.status = "done";
        },
      },
    },
  });

  return {
    module,
    setResolverFail: (v: boolean) => {
      resolverShouldFail = v;
    },
    setConstraintFail: (v: boolean) => {
      constraintShouldFail = v;
    },
    setEffectFail: (v: boolean) => {
      effectShouldFail = v;
    },
    setDerivationFail: (v: boolean) => {
      derivationShouldFail = v;
    },
  };
}

// ============================================================================
// Suppress expected console.warn/error from error boundary tests
// ============================================================================

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.mocked(console.warn).mockRestore();
  vi.mocked(console.error).mockRestore();
});

// ============================================================================
// Tests: Skip Strategy
// ============================================================================

describe("error boundary: skip strategy", () => {
  it("catches resolver errors and continues", async () => {
    const { module, setResolverFail } = createFailingModule();
    setResolverFail(true);

    const system = createSystem({
      module,
      errorBoundary: { onResolverError: "skip" },
    });
    system.start();

    system.events.setStatus({ value: "loading" });
    await system.settle();

    // System is still running (didn't crash)
    expect(system.facts.count).toBe(0);

    system.destroy();
  });

  it("catches constraint errors and continues", async () => {
    const { module, setConstraintFail } = createFailingModule();
    setConstraintFail(true);

    const system = createSystem({
      module,
      errorBoundary: { onConstraintError: "skip" },
    });
    system.start();

    system.events.trigger();
    await system.settle();

    expect(system.facts.count).toBe(1);

    system.destroy();
  });

  it("catches effect errors and continues", async () => {
    const { module, setEffectFail } = createFailingModule();
    setEffectFail(true);

    const system = createSystem({
      module,
      errorBoundary: { onEffectError: "skip" },
    });
    system.start();

    system.events.trigger();
    await system.settle();

    expect(system.facts.count).toBe(1);

    system.destroy();
  });
});

// ============================================================================
// Tests: Throw Strategy
// ============================================================================

describe("error boundary: throw strategy", () => {
  it("re-throws constraint errors (caught by reconcile)", async () => {
    const { module, setConstraintFail } = createFailingModule();

    const errors: string[] = [];
    const system = createSystem({
      module,
      errorBoundary: {
        onConstraintError: "throw",
        onError: (err) => errors.push(err.message),
      },
    });
    system.start();

    setConstraintFail(true);
    system.events.trigger();
    await system.settle();

    // The error was thrown and caught — verify it was recorded
    expect(errors).toContain("constraint failure");

    system.destroy();
  });

  it("records resolver errors with throw strategy", async () => {
    const { module, setResolverFail } = createFailingModule();
    setResolverFail(true);

    const errors: string[] = [];

    // Catch the unhandled rejection from the throw strategy in async resolvers
    const rejectionHandler = () => {};
    process.on("unhandledRejection", rejectionHandler);

    try {
      const system = createSystem({
        module,
        errorBoundary: {
          onResolverError: "throw",
          onError: (err) => errors.push(err.message),
        },
      });
      system.start();

      system.events.setStatus({ value: "loading" });

      // Wait for the resolver to execute and error
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The error was recorded before the throw
      expect(errors).toContain("resolver failure");

      system.destroy();
    } finally {
      process.removeListener("unhandledRejection", rejectionHandler);
    }
  });
});

// ============================================================================
// Tests: Disable Strategy
// ============================================================================

describe("error boundary: disable strategy", () => {
  it("disables a constraint after error", async () => {
    const { module, setConstraintFail } = createFailingModule();

    const system = createSystem({
      module,
      errorBoundary: { onConstraintError: "disable" },
    });
    system.start();

    expect(system.constraints.isDisabled("needsWork")).toBe(false);

    // Make the constraint throw
    setConstraintFail(true);
    system.events.trigger();
    await system.settle();

    // After error, the constraint should be disabled
    expect(system.constraints.isDisabled("needsWork")).toBe(true);

    system.destroy();
  });

  it("disables an effect after error", async () => {
    const { module, setEffectFail } = createFailingModule();

    const system = createSystem({
      module,
      errorBoundary: { onEffectError: "disable" },
    });
    system.start();

    expect(system.effects.isEnabled("sideEffect")).toBe(true);

    // Make the effect throw
    setEffectFail(true);
    system.events.trigger();
    await system.settle();

    // After error, the effect should be disabled
    expect(system.effects.isEnabled("sideEffect")).toBe(false);

    system.destroy();
  });

  it("disables the originating constraint when a resolver fails", async () => {
    const { module, setResolverFail } = createFailingModule();

    const system = createSystem({
      module,
      errorBoundary: { onResolverError: "disable" },
    });
    system.start();

    expect(system.constraints.isDisabled("needsWork")).toBe(false);

    setResolverFail(true);
    system.events.setStatus({ value: "loading" });
    await system.settle();

    // The constraint that produced the requirement should be disabled
    expect(system.constraints.isDisabled("needsWork")).toBe(true);

    system.destroy();
  });
});

// ============================================================================
// Tests: Retry Strategy
// ============================================================================

describe("error boundary: retry strategy", () => {
  it("marks derivation stale on retry so it recomputes", async () => {
    const { module, setDerivationFail } = createFailingModule();

    const errors: string[] = [];
    const system = createSystem({
      module,
      errorBoundary: {
        onDerivationError: "retry",
        onError: (err) => errors.push(err.message),
      },
    });
    system.start();
    await system.settle();

    // Derivation works initially
    expect(system.derive.doubled).toBe(0);

    // Make the derivation fail, trigger invalidation, then read it
    setDerivationFail(true);
    system.events.trigger();
    await system.settle();

    // Reading the derivation triggers recomputation which throws
    try {
      void system.derive.doubled;
    } catch {
      // Expected — derivation still fails
    }

    // The error was recorded
    expect(errors.length).toBeGreaterThan(0);

    // Fix the derivation, trigger another change, then read
    setDerivationFail(false);
    system.events.trigger();
    await system.settle();

    // Derivation should now compute correctly (count=2, doubled=4)
    expect(system.derive.doubled).toBe(4);

    system.destroy();
  });

  it("forces effects to re-run on retry", async () => {
    const { module, setEffectFail } = createFailingModule();
    setEffectFail(true);

    const system = createSystem({
      module,
      errorBoundary: { onEffectError: "retry" },
    });
    system.start();

    system.events.trigger();
    await system.settle();

    // System should still be functional (retry scheduled another reconcile)
    expect(system.facts.count).toBe(1);

    system.destroy();
  });
});

// ============================================================================
// Tests: Retry-Later Strategy
// ============================================================================

describe("error boundary: retry-later strategy", () => {
  it("schedules a retry entry when resolver fails", async () => {
    const { module, setResolverFail } = createFailingModule();
    setResolverFail(true);

    const errors: string[] = [];
    const system = createSystem({
      module,
      errorBoundary: {
        onResolverError: "retry-later",
        retryLater: { delayMs: 5000, maxRetries: 3 },
        onError: (err) => errors.push(err.message),
      },
    });
    system.start();

    system.events.setStatus({ value: "loading" });
    await system.settle();

    // Error was recorded
    expect(errors).toContain("resolver failure");

    system.destroy();
  });

  it("clears retry attempts on resolver success", async () => {
    const { module, setResolverFail } = createFailingModule();

    const system = createSystem({
      module,
      errorBoundary: {
        onResolverError: "retry-later",
        retryLater: { delayMs: 5000, maxRetries: 3 },
      },
    });
    system.start();

    // First: trigger a failure
    setResolverFail(true);
    system.events.setStatus({ value: "loading" });
    await system.settle();

    // Fix resolver and reset status so constraint re-fires
    setResolverFail(false);
    system.events.setStatus({ value: "idle" });
    await system.settle();
    system.events.setStatus({ value: "loading" });
    await system.settle();

    // System should be in "done" state after successful resolution
    expect(system.facts.status).toBe("done");

    system.destroy();
  });
});

// ============================================================================
// Tests: Retry-Later Manager (unit-level)
// ============================================================================

describe("error boundary: retry-later manager", () => {
  it("schedules entries with exponential backoff", () => {
    const boundary = createErrorBoundaryManager({
      config: {
        onResolverError: "retry-later",
        retryLater: { delayMs: 100, maxRetries: 3, backoffMultiplier: 2 },
      },
    });

    // First error → schedules retry
    boundary.handleError("resolver", "testResolver", new Error("fail"), {});
    const pending = boundary.getRetryLaterManager().getPendingRetries();
    expect(pending.length).toBe(1);
    expect(pending[0]!.attempt).toBe(1);
    expect(pending[0]!.sourceId).toBe("testResolver");
  });

  it("respects maxRetries limit", () => {
    const boundary = createErrorBoundaryManager({
      config: {
        onResolverError: "retry-later",
        retryLater: { delayMs: 100, maxRetries: 2, backoffMultiplier: 1 },
      },
    });

    // First error
    boundary.handleError("resolver", "testResolver", new Error("fail"), {});
    // Second error
    boundary.handleError("resolver", "testResolver", new Error("fail"), {});

    // Third error → should fall back to "skip" (max 2 retries)
    const strategy = boundary.handleError(
      "resolver",
      "testResolver",
      new Error("fail"),
      {},
    );
    expect(strategy).toBe("skip");
  });

  it("clearRetryAttempts resets the counter", () => {
    const boundary = createErrorBoundaryManager({
      config: {
        onResolverError: "retry-later",
        retryLater: { delayMs: 100, maxRetries: 2, backoffMultiplier: 1 },
      },
    });

    // Two errors
    boundary.handleError("resolver", "testResolver", new Error("fail"), {});
    boundary.handleError("resolver", "testResolver", new Error("fail"), {});

    // Clear attempts (simulates success)
    boundary.clearRetryAttempts("testResolver");

    // Next error should be attempt 1 again (not over the limit)
    const strategy = boundary.handleError(
      "resolver",
      "testResolver",
      new Error("fail"),
      {},
    );
    expect(strategy).toBe("retry-later");
  });

  it("processDueRetries returns entries past their delay", () => {
    const boundary = createErrorBoundaryManager({
      config: {
        onResolverError: "retry-later",
        retryLater: { delayMs: 0, maxRetries: 3, backoffMultiplier: 1 },
      },
    });

    boundary.handleError("resolver", "testResolver", new Error("fail"), {});

    // With delayMs=0, the entry is immediately due
    const due = boundary.processDueRetries();
    expect(due.length).toBe(1);
    expect(due[0]!.sourceId).toBe("testResolver");

    // No more pending
    const remaining = boundary.getRetryLaterManager().getPendingRetries();
    expect(remaining.length).toBe(0);
  });
});

// ============================================================================
// Tests: Callback Returning Strategy
// ============================================================================

describe("error boundary: callback returning strategy", () => {
  it("uses the strategy returned by the callback", async () => {
    const { module, setConstraintFail } = createFailingModule();

    const system = createSystem({
      module,
      errorBoundary: {
        onConstraintError: () => "disable" as RecoveryStrategy,
      },
    });
    system.start();

    setConstraintFail(true);
    system.events.trigger();
    await system.settle();

    expect(system.constraints.isDisabled("needsWork")).toBe(true);

    system.destroy();
  });

  it("falls back to skip when callback returns void", async () => {
    const { module, setConstraintFail } = createFailingModule();
    const errorsSeen: string[] = [];

    const system = createSystem({
      module,
      errorBoundary: {
        onConstraintError: (error) => {
          errorsSeen.push(error.message);
          // Return void — should fall back to "skip"
        },
      },
    });
    system.start();

    setConstraintFail(true);
    system.events.trigger();
    await system.settle();

    expect(errorsSeen).toContain("constraint failure");
    // Constraint was NOT disabled (skip, not disable)
    expect(system.constraints.isDisabled("needsWork")).toBe(false);

    system.destroy();
  });

  it("supports dynamic strategy selection", async () => {
    const { module, setResolverFail } = createFailingModule();
    let strategy: RecoveryStrategy = "skip";

    const system = createSystem({
      module,
      errorBoundary: {
        onResolverError: () => strategy,
      },
    });
    system.start();

    // First failure with "skip" — constraint stays enabled
    setResolverFail(true);
    system.events.setStatus({ value: "loading" });
    await system.settle();
    expect(system.constraints.isDisabled("needsWork")).toBe(false);

    // Change strategy to "disable" and re-trigger
    strategy = "disable";
    // Reset status so the constraint re-fires
    system.events.setStatus({ value: "idle" });
    await system.settle();
    system.events.setStatus({ value: "loading" });
    await system.settle();

    expect(system.constraints.isDisabled("needsWork")).toBe(true);

    system.destroy();
  });
});

// ============================================================================
// Tests: callback-returns-strategy (unit level)
// ============================================================================

describe("error boundary: getStrategy callback integration", () => {
  it("callback returning a strategy string is used", () => {
    const boundary = createErrorBoundaryManager({
      config: {
        onResolverError: () => "disable",
      },
    });

    const strategy = boundary.handleError(
      "resolver",
      "test",
      new Error("fail"),
    );
    expect(strategy).toBe("disable");
  });

  it("callback returning void falls back to skip", () => {
    const boundary = createErrorBoundaryManager({
      config: {
        onResolverError: () => {
          // void
        },
      },
    });

    const strategy = boundary.handleError(
      "resolver",
      "test",
      new Error("fail"),
    );
    expect(strategy).toBe("skip");
  });

  it("callback returning retry-later schedules a retry", () => {
    const boundary = createErrorBoundaryManager({
      config: {
        onResolverError: () => "retry-later",
        retryLater: { delayMs: 100, maxRetries: 3 },
      },
    });

    const strategy = boundary.handleError(
      "resolver",
      "test",
      new Error("fail"),
    );
    expect(strategy).toBe("retry-later");

    const pending = boundary.getRetryLaterManager().getPendingRetries();
    expect(pending.length).toBe(1);
  });
});
