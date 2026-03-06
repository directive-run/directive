import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGuards } from "../guards.js";
import type { ArchitectEvent } from "../types.js";

describe("guards", () => {
  const emittedEvents: ArchitectEvent[] = [];
  const emitEvent = (event: ArchitectEvent) => {
    emittedEvents.push(event);
  };

  beforeEach(() => {
    emittedEvents.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeGuards(overrides = {}) {
    return createGuards(
      {
        maxCallsPerMinute: 3,
        maxPerHour: 10,
        circuitBreakerThreshold: 2,
        circuitBreakerWindowMs: 5000,
        maxCascadeDepth: 2,
        maxDefinitions: 5,
        maxPending: 3,
        ...overrides,
      },
      { tokens: 1000, dollars: 10 },
      emitEvent,
    );
  }

  // ===========================================================================
  // Rate Limiter
  // ===========================================================================

  describe("rate limiter", () => {
    it("allows calls under limit", () => {
      const guards = makeGuards();

      guards.recordCall();
      guards.recordCall();

      expect(guards.checkRateLimit().allowed).toBe(true);
    });

    it("blocks calls over limit", () => {
      const guards = makeGuards();

      guards.recordCall();
      guards.recordCall();
      guards.recordCall();

      const result = guards.checkRateLimit();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("calls/minute");
    });

    it("resets after 1 minute", () => {
      const guards = makeGuards();

      guards.recordCall();
      guards.recordCall();
      guards.recordCall();

      expect(guards.checkRateLimit().allowed).toBe(false);

      vi.advanceTimersByTime(61_000);

      expect(guards.checkRateLimit().allowed).toBe(true);
    });
  });

  // ===========================================================================
  // Circuit Breaker
  // ===========================================================================

  describe("circuit breaker", () => {
    it("starts closed", () => {
      const guards = makeGuards();

      expect(guards.getCircuitBreakerState()).toBe("closed");
      expect(guards.checkCircuitBreaker().allowed).toBe(true);
    });

    it("opens after threshold failures", () => {
      const guards = makeGuards();

      guards.recordFailure();
      guards.recordFailure();

      expect(guards.getCircuitBreakerState()).toBe("open");
      expect(guards.checkCircuitBreaker().allowed).toBe(false);
    });

    it("transitions to half-open after window", () => {
      const guards = makeGuards();

      guards.recordFailure();
      guards.recordFailure();

      expect(guards.getCircuitBreakerState()).toBe("open");

      vi.advanceTimersByTime(6000);

      expect(guards.getCircuitBreakerState()).toBe("half-open");
    });

    it("closes after success in half-open state", () => {
      const guards = makeGuards();

      guards.recordFailure();
      guards.recordFailure();

      vi.advanceTimersByTime(6000);

      expect(guards.getCircuitBreakerState()).toBe("half-open");

      guards.recordSuccess();

      expect(guards.getCircuitBreakerState()).toBe("closed");
    });
  });

  // ===========================================================================
  // Cascade Depth
  // ===========================================================================

  describe("cascade depth", () => {
    it("allows within limit", () => {
      const guards = makeGuards();

      guards.incrementCascade();

      expect(guards.checkCascadeDepth().allowed).toBe(true);
    });

    it("blocks at limit", () => {
      const guards = makeGuards();

      guards.incrementCascade();
      guards.incrementCascade();

      const result = guards.checkCascadeDepth();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Cascade depth");
    });

    it("resets cascade counter", () => {
      const guards = makeGuards();

      guards.incrementCascade();
      guards.incrementCascade();

      expect(guards.checkCascadeDepth().allowed).toBe(false);

      guards.resetCascade();

      expect(guards.checkCascadeDepth().allowed).toBe(true);
    });
  });

  // ===========================================================================
  // Definition Count
  // ===========================================================================

  describe("definition count", () => {
    it("allows under limit", () => {
      const guards = makeGuards();

      guards.setDefinitionCount(4);

      expect(guards.checkDefinitionCount().allowed).toBe(true);
    });

    it("blocks at limit", () => {
      const guards = makeGuards();

      guards.setDefinitionCount(5);

      const result = guards.checkDefinitionCount();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Definition limit");
    });
  });

  // ===========================================================================
  // Pending Count
  // ===========================================================================

  describe("pending count", () => {
    it("allows under limit", () => {
      const guards = makeGuards();

      guards.setPendingCount(2);

      expect(guards.checkPendingCount().allowed).toBe(true);
    });

    it("blocks at limit", () => {
      const guards = makeGuards();

      guards.setPendingCount(3);

      const result = guards.checkPendingCount();

      expect(result.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // Budget
  // ===========================================================================

  describe("budget", () => {
    it("allows under budget", () => {
      const guards = makeGuards();

      guards.recordTokens(500, 5);

      expect(guards.checkBudget().allowed).toBe(true);
    });

    it("blocks when tokens exceeded", () => {
      const guards = makeGuards();

      guards.recordTokens(1001, 0);

      const result = guards.checkBudget();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Token budget");
    });

    it("blocks when dollars exceeded", () => {
      const guards = makeGuards();

      guards.recordTokens(0, 11);

      const result = guards.checkBudget();

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Dollar budget");
    });

    it("emits budget-warning at 50%", () => {
      const guards = makeGuards();

      guards.recordTokens(500, 0);

      const warning = emittedEvents.find((e) => e.type === "budget-warning");

      expect(warning).toBeDefined();
      expect(warning!.budgetPercent).toBe(50);
    });

    it("emits budget-warning at 80%", () => {
      const guards = makeGuards();

      guards.recordTokens(800, 0);

      const warnings = emittedEvents.filter((e) => e.type === "budget-warning");

      expect(warnings.length).toBeGreaterThanOrEqual(2); // 50% + 80%
    });

    it("emits budget-exceeded at 100%", () => {
      const guards = makeGuards();

      guards.recordTokens(1000, 0);

      const exceeded = emittedEvents.find((e) => e.type === "budget-exceeded");

      expect(exceeded).toBeDefined();
    });

    it("reports usage correctly", () => {
      const guards = makeGuards();

      guards.recordTokens(250, 2.5);

      const usage = guards.getBudgetUsage();

      expect(usage.tokens).toBe(250);
      expect(usage.dollars).toBe(2.5);
      expect(usage.percent.tokens).toBe(25);
      expect(usage.percent.dollars).toBe(25);
    });

    it("resets budget", () => {
      const guards = makeGuards();

      guards.recordTokens(500, 5);
      guards.resetBudget();

      const usage = guards.getBudgetUsage();

      expect(usage.tokens).toBe(0);
      expect(usage.dollars).toBe(0);
    });
  });

  // ===========================================================================
  // checkAll
  // ===========================================================================

  describe("checkAll", () => {
    it("allows when all guards pass", () => {
      const guards = makeGuards();

      expect(guards.checkAll().allowed).toBe(true);
    });

    it("blocks on first failing guard", () => {
      const guards = makeGuards();

      guards.recordTokens(2000, 0); // Exceed budget

      const result = guards.checkAll();

      expect(result.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // Debounce
  // ===========================================================================

  describe("debounce", () => {
    it("coalesces rapid calls", () => {
      const guards = makeGuards({ debounceMs: 100 });
      const callback = vi.fn();

      guards.debounce("test", callback);
      guards.debounce("test", callback);
      guards.debounce("test", callback);

      vi.advanceTimersByTime(150);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("handles different trigger types independently", () => {
      const guards = makeGuards({ debounceMs: 100 });
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      guards.debounce("error", cb1);
      guards.debounce("fact-change", cb2);

      vi.advanceTimersByTime(150);

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });
});
