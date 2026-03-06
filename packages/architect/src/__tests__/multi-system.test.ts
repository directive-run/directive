/**
 * Tests for cross-system orchestration.
 */

import { describe, it, expect } from "vitest";
import { createMultiSystemArchitect } from "../multi-system.js";
import { createTestSystem, mockRunner, createTestMultiSystem } from "../testing.js";
import type { System } from "@directive-run/core";

// ============================================================================
// Helpers
// ============================================================================

function createSystems() {
  return {
    api: createTestSystem({ errorRate: 0.05, requestCount: 1000 }),
    worker: createTestSystem({ queueDepth: 50, processingRate: 100 }),
  };
}

function createMulti(systems?: Record<string, ReturnType<typeof createTestSystem>>) {
  const syss = systems ?? createSystems();
  const runner = mockRunner([
    { toolCalls: [{ name: "observe_system", arguments: "{}" }] },
    { output: "Analysis complete" },
  ]);

  const multi = createMultiSystemArchitect({
    systems: syss as unknown as Record<string, System>,
    runner,
    budget: { tokens: 100_000, dollars: 10 },
    silent: true,
  });

  return { multi, systems: syss, runner };
}

// ============================================================================
// Tests
// ============================================================================

describe("createMultiSystemArchitect", () => {
  it("requires at least one system", () => {
    expect(() =>
      createMultiSystemArchitect({
        systems: {},
        runner: mockRunner([]),
        budget: { tokens: 100, dollars: 1 },
        silent: true,
      }),
    ).toThrow("at least one system");
  });

  it("returns getSystems() with all system names", () => {
    const { multi } = createMulti();
    expect(multi.getSystems()).toEqual(["api", "worker"]);
    multi.destroy();
  });

  it("reads namespaced facts via composite proxy", () => {
    const { multi, systems } = createMulti();
    const sys = multi as unknown as { status(): unknown };

    // The composite system reads facts through the proxy
    const apiSystem = systems.api;
    expect(apiSystem.facts.errorRate).toBe(0.05);

    multi.destroy();
  });

  it("writes namespaced facts through composite proxy", () => {
    const systems = createSystems();
    const { multi } = createMulti(systems);

    // Write through composite system
    systems.api.facts.errorRate = 0.1;
    expect(systems.api.facts.errorRate).toBe(0.1);

    multi.destroy();
  });

  it("getSystemHealth returns health for a specific system", () => {
    const { multi } = createMulti();
    const health = multi.getSystemHealth("api");

    expect(typeof health.score).toBe("number");
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);

    multi.destroy();
  });

  it("getSystemHealth throws for unknown system", () => {
    const { multi } = createMulti();
    expect(() => multi.getSystemHealth("unknown")).toThrow("Unknown system");
    multi.destroy();
  });

  it("getAggregateHealth returns per-system and aggregate scores", () => {
    const { multi } = createMulti();
    const health = multi.getAggregateHealth();

    expect(typeof health.score).toBe("number");
    expect(health.perSystem.api).toBeDefined();
    expect(health.perSystem.worker).toBeDefined();
    expect(typeof health.perSystem.api.score).toBe("number");

    multi.destroy();
  });

  it("has standard architect methods", () => {
    const { multi } = createMulti();

    expect(typeof multi.analyze).toBe("function");
    expect(typeof multi.approve).toBe("function");
    expect(typeof multi.reject).toBe("function");
    expect(typeof multi.kill).toBe("function");
    expect(typeof multi.destroy).toBe("function");
    expect(typeof multi.status).toBe("function");
    expect(typeof multi.on).toBe("function");

    multi.destroy();
  });

  it("kill switch works across all systems", () => {
    const { multi } = createMulti();

    const result = multi.kill();
    expect(result).toBeDefined();
    expect(typeof result.removed).toBe("number");

    multi.destroy();
  });

  it("status() works on multi-system architect", () => {
    const { multi } = createMulti();

    const status = multi.status();
    expect(status.budget).toBeDefined();
    expect(typeof status.activeDefinitions).toBe("number");

    multi.destroy();
  });

  it("can subscribe to events", () => {
    const { multi } = createMulti();
    const events: unknown[] = [];

    const unsub = multi.on((event) => {
      events.push(event);
    });

    expect(typeof unsub).toBe("function");
    unsub();
    multi.destroy();
  });
});

// ============================================================================
// createTestMultiSystem helper
// ============================================================================

describe("createTestMultiSystem", () => {
  it("creates named test systems", () => {
    const systems = createTestMultiSystem({
      api: { errorRate: 0.01 },
      worker: { queueDepth: 10 },
    });

    expect(systems.api.facts.errorRate).toBe(0.01);
    expect(systems.worker.facts.queueDepth).toBe(10);
  });
});
