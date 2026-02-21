import { describe, it, expect } from "vitest";
import { createHealthMonitor } from "../health-monitor.js";

// ============================================================================
// L4: getAllMetrics caching via generation counter
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
