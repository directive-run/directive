import { describe, expect, it, vi } from "vitest";
import { createHealthMonitor } from "../health-monitor.js";

// ============================================================================
// getAllMetrics caching via generation counter
// ============================================================================

describe("createHealthMonitor", () => {
  it("getAllMetrics returns cached result when no writes occurred", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent-a", 100);
    monitor.recordSuccess("agent-a", 120);

    const first = monitor.getAllMetrics();
    const second = monitor.getAllMetrics();

    // Same reference = cache hit
    expect(first).toBe(second);
  });

  it("getAllMetrics returns fresh result after a write", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent-a", 100);

    const first = monitor.getAllMetrics();

    monitor.recordSuccess("agent-a", 200);

    const second = monitor.getAllMetrics();

    // Different reference = cache miss
    expect(first).not.toBe(second);
  });

  it("getAllMetrics cache invalidates on recordFailure", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent-a", 100);

    const first = monitor.getAllMetrics();

    monitor.recordFailure("agent-a", 500, new Error("fail"));

    const second = monitor.getAllMetrics();

    expect(first).not.toBe(second);
    expect(second["agent-a"]!.recentFailures).toBe(1);
  });

  it("getAllMetrics cache invalidates on updateCircuitState", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent-a", 100);

    const first = monitor.getAllMetrics();

    monitor.updateCircuitState("agent-a", "OPEN");

    const second = monitor.getAllMetrics();

    expect(first).not.toBe(second);
    expect(second["agent-a"]!.circuitState).toBe("OPEN");
  });

  it("getAllMetrics cache invalidates on reset", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent-a", 100);

    const first = monitor.getAllMetrics();

    expect(Object.keys(first)).toHaveLength(1);

    monitor.reset();

    const second = monitor.getAllMetrics();

    expect(first).not.toBe(second);
    expect(Object.keys(second)).toHaveLength(0);
  });
});

// ============================================================================
// Health score computation
// ============================================================================

describe("health score computation", () => {
  it("returns 50 (neutral) when no data exists for an agent", () => {
    const monitor = createHealthMonitor();

    expect(monitor.getHealthScore("unknown")).toBe(50);
  });

  it("returns high score for all-success, low-latency agent", () => {
    const monitor = createHealthMonitor();

    for (let i = 0; i < 10; i++) {
      monitor.recordSuccess("fast-agent", 50);
    }

    const score = monitor.getHealthScore("fast-agent");

    // 100% success rate, low latency, CLOSED circuit → near 100
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it("returns low score for all-failure agent", () => {
    const monitor = createHealthMonitor();

    for (let i = 0; i < 10; i++) {
      monitor.recordFailure("bad-agent", 100, new Error("fail"));
    }

    const score = monitor.getHealthScore("bad-agent");

    // 0% success rate → low score
    expect(score).toBeLessThanOrEqual(50);
  });

  it("penalizes high latency", () => {
    const monitor = createHealthMonitor();

    // Both agents: 100% success, CLOSED circuit
    for (let i = 0; i < 10; i++) {
      monitor.recordSuccess("fast", 50);
      monitor.recordSuccess("slow", 4500); // Near maxNormalLatencyMs (5000)
    }

    const fastScore = monitor.getHealthScore("fast");
    const slowScore = monitor.getHealthScore("slow");

    expect(fastScore).toBeGreaterThan(slowScore);
  });

  it("OPEN circuit state reduces score", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent", 100);
    const closedScore = monitor.getHealthScore("agent");

    monitor.updateCircuitState("agent", "OPEN");
    const openScore = monitor.getHealthScore("agent");

    expect(closedScore).toBeGreaterThan(openScore);
  });

  it("HALF_OPEN circuit state partially reduces score", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent", 100);

    monitor.updateCircuitState("agent", "CLOSED");
    const closedScore = monitor.getHealthScore("agent");

    monitor.updateCircuitState("agent", "HALF_OPEN");
    const halfOpenScore = monitor.getHealthScore("agent");

    monitor.updateCircuitState("agent", "OPEN");
    const openScore = monitor.getHealthScore("agent");

    expect(closedScore).toBeGreaterThan(halfOpenScore);
    expect(halfOpenScore).toBeGreaterThan(openScore);
  });
});

// ============================================================================
// getMetrics
// ============================================================================

describe("getMetrics", () => {
  it("returns correct metrics for mixed success/failure", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent", 100);
    monitor.recordSuccess("agent", 200);
    monitor.recordFailure("agent", 300, new Error("oops"));

    const metrics = monitor.getMetrics("agent");

    expect(metrics.agentId).toBe("agent");
    expect(metrics.recentSuccesses).toBe(2);
    expect(metrics.recentFailures).toBe(1);
    expect(metrics.successRate).toBeCloseTo(2 / 3);
    expect(metrics.avgLatencyMs).toBeCloseTo(200);
    expect(metrics.circuitState).toBe("CLOSED");
  });

  it("returns zero metrics for unknown agent", () => {
    const monitor = createHealthMonitor();
    const metrics = monitor.getMetrics("unknown");

    expect(metrics.recentSuccesses).toBe(0);
    expect(metrics.recentFailures).toBe(0);
    expect(metrics.successRate).toBe(0);
    expect(metrics.avgLatencyMs).toBe(0);
  });

  it("collects lastErrors from failures", () => {
    const monitor = createHealthMonitor();

    monitor.recordFailure("agent", 100, new Error("first"));
    monitor.recordSuccess("agent", 50);
    monitor.recordFailure("agent", 100, new Error("second"));

    const metrics = monitor.getMetrics("agent");

    expect(metrics.lastErrors).toEqual(["first", "second"]);
  });

  it("limits lastErrors to 5 most recent", () => {
    const monitor = createHealthMonitor();

    for (let i = 0; i < 8; i++) {
      monitor.recordFailure("agent", 100, new Error(`err-${i}`));
    }

    const metrics = monitor.getMetrics("agent");

    expect(metrics.lastErrors).toHaveLength(5);
    expect(metrics.lastErrors[4]).toBe("err-7");
  });

  it("recordFailure without error has no error message", () => {
    const monitor = createHealthMonitor();

    monitor.recordFailure("agent", 100);

    const metrics = monitor.getMetrics("agent");

    expect(metrics.recentFailures).toBe(1);
    expect(metrics.lastErrors).toHaveLength(0);
  });
});

// ============================================================================
// Circuit state transitions
// ============================================================================

describe("circuit state", () => {
  it("defaults to CLOSED", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent", 100);

    expect(monitor.getMetrics("agent").circuitState).toBe("CLOSED");
  });

  it("transitions through all states", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent", 100);

    monitor.updateCircuitState("agent", "OPEN");
    expect(monitor.getMetrics("agent").circuitState).toBe("OPEN");

    monitor.updateCircuitState("agent", "HALF_OPEN");
    expect(monitor.getMetrics("agent").circuitState).toBe("HALF_OPEN");

    monitor.updateCircuitState("agent", "CLOSED");
    expect(monitor.getMetrics("agent").circuitState).toBe("CLOSED");
  });

  it("preserves circuit state across metrics reads", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent", 100);
    monitor.updateCircuitState("agent", "OPEN");

    // Read metrics multiple times
    expect(monitor.getMetrics("agent").circuitState).toBe("OPEN");
    expect(monitor.getMetrics("agent").circuitState).toBe("OPEN");
    expect(monitor.getAllMetrics()["agent"]!.circuitState).toBe("OPEN");
  });
});

// ============================================================================
// Multi-agent tracking
// ============================================================================

describe("multi-agent tracking", () => {
  it("tracks agents independently", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent-a", 50);
    monitor.recordFailure("agent-b", 200, new Error("fail"));

    const all = monitor.getAllMetrics();

    expect(all["agent-a"]!.recentSuccesses).toBe(1);
    expect(all["agent-a"]!.recentFailures).toBe(0);
    expect(all["agent-b"]!.recentSuccesses).toBe(0);
    expect(all["agent-b"]!.recentFailures).toBe(1);
  });

  it("circuit state is per-agent", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent-a", 100);
    monitor.recordSuccess("agent-b", 100);

    monitor.updateCircuitState("agent-a", "OPEN");

    expect(monitor.getMetrics("agent-a").circuitState).toBe("OPEN");
    expect(monitor.getMetrics("agent-b").circuitState).toBe("CLOSED");
  });
});

// ============================================================================
// Event pruning and caps
// ============================================================================

describe("event pruning", () => {
  it("prunes events outside the time window", () => {
    vi.useFakeTimers();

    try {
      const monitor = createHealthMonitor({ windowMs: 1000 });

      monitor.recordSuccess("agent", 100);

      vi.advanceTimersByTime(1500);

      // Old event is outside window — should be pruned on next read
      const metrics = monitor.getMetrics("agent");

      // After pruning, no events remain
      expect(metrics.recentSuccesses).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps events per agent at maxEventsPerAgent", () => {
    const monitor = createHealthMonitor({ maxEventsPerAgent: 5 });

    for (let i = 0; i < 10; i++) {
      monitor.recordSuccess("agent", 100);
    }

    const metrics = monitor.getMetrics("agent");

    // Only last 5 events should remain
    expect(metrics.recentSuccesses + metrics.recentFailures).toBeLessThanOrEqual(
      5,
    );
  });

  it("reset clears all agents and circuit states", () => {
    const monitor = createHealthMonitor();

    monitor.recordSuccess("agent-a", 100);
    monitor.recordFailure("agent-b", 200, new Error("fail"));
    monitor.updateCircuitState("agent-a", "OPEN");

    monitor.reset();

    const all = monitor.getAllMetrics();

    expect(Object.keys(all)).toHaveLength(0);
    expect(monitor.getHealthScore("agent-a")).toBe(50);
    expect(monitor.getMetrics("agent-a").circuitState).toBe("CLOSED");
  });
});

// ============================================================================
// Configuration validation
// ============================================================================

describe("configuration validation", () => {
  it("throws on non-positive windowMs", () => {
    expect(() => createHealthMonitor({ windowMs: 0 })).toThrow(
      "windowMs must be a positive number",
    );
    expect(() => createHealthMonitor({ windowMs: -1 })).toThrow(
      "windowMs must be a positive number",
    );
  });

  it("throws on non-positive maxNormalLatencyMs", () => {
    expect(() => createHealthMonitor({ maxNormalLatencyMs: 0 })).toThrow(
      "maxNormalLatencyMs must be a positive number",
    );
  });

  it("throws on maxEventsPerAgent < 1", () => {
    expect(() => createHealthMonitor({ maxEventsPerAgent: 0 })).toThrow(
      "maxEventsPerAgent must be >= 1",
    );
  });

  it("throws when weights do not sum to ~1.0", () => {
    expect(() =>
      createHealthMonitor({
        weights: { successRate: 0.5, latency: 0.5, circuitState: 0.5 },
      }),
    ).toThrow("weights must sum to ~1.0");
  });

  it("throws when individual weight is out of 0-1 range", () => {
    expect(() =>
      createHealthMonitor({
        weights: { successRate: -0.1, latency: 0.6, circuitState: 0.5 },
      }),
    ).toThrow('weight "successRate" must be between 0 and 1');
  });

  it("accepts custom weights that sum to 1", () => {
    const monitor = createHealthMonitor({
      weights: { successRate: 0.8, latency: 0.1, circuitState: 0.1 },
    });

    monitor.recordSuccess("agent", 100);

    // Should not throw
    expect(monitor.getHealthScore("agent")).toBeGreaterThan(0);
  });
});

// ============================================================================
// Custom weight influence
// ============================================================================

describe("custom weights", () => {
  it("high successRate weight penalizes failures more", () => {
    const highSuccessWeight = createHealthMonitor({
      weights: { successRate: 0.9, latency: 0.05, circuitState: 0.05 },
    });
    const lowSuccessWeight = createHealthMonitor({
      weights: { successRate: 0.1, latency: 0.45, circuitState: 0.45 },
    });

    // Both: 50% success rate, low latency, CLOSED
    for (let i = 0; i < 5; i++) {
      highSuccessWeight.recordSuccess("agent", 50);
      highSuccessWeight.recordFailure("agent", 50, new Error("fail"));
      lowSuccessWeight.recordSuccess("agent", 50);
      lowSuccessWeight.recordFailure("agent", 50, new Error("fail"));
    }

    const scoreHigh = highSuccessWeight.getHealthScore("agent");
    const scoreLow = lowSuccessWeight.getHealthScore("agent");

    // With 50% success, the one weighting success at 0.9 is penalized more
    expect(scoreLow).toBeGreaterThan(scoreHigh);
  });
});
