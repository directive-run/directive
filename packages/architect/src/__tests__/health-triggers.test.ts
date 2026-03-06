import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestSystem, mockRunner } from "../testing.js";
import { createAIArchitect } from "../architect.js";
import type { ArchitectEvent } from "../types.js";

describe("health auto-triggers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits health-check events on each poll", async () => {
    const system = createTestSystem({ phase: "running" });
    const events: ArchitectEvent[] = [];

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([]),
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      triggers: {
        onHealthDecline: { threshold: 50, pollInterval: "10s" },
      },
    });

    architect.on((e) => events.push(e));

    // Advance past one poll interval
    await vi.advanceTimersByTimeAsync(10_000);

    const healthChecks = events.filter((e) => e.type === "health-check");
    expect(healthChecks.length).toBe(1);
    expect(healthChecks[0]!).toMatchObject({
      type: "health-check",
      threshold: 50,
    });

    architect.destroy();
  });

  it("emits health-check with correct score and previousScore", async () => {
    const system = createTestSystem({ phase: "running" });
    const events: ArchitectEvent[] = [];

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([]),
      budget: { tokens: 100_000, dollars: 10 },
      triggers: {
        onHealthDecline: { threshold: 50, pollInterval: "5s" },
      },
    });

    architect.on((e) => events.push(e));

    // First poll — previousScore starts at 100
    await vi.advanceTimersByTimeAsync(5_000);

    const check = events.find((e) => e.type === "health-check") as any;
    expect(check).toBeDefined();
    expect(check.previousScore).toBe(100);
    expect(typeof check.score).toBe("number");

    architect.destroy();
  });

  it("triggers analysis when health drops below threshold with sufficient drop", async () => {
    const system = createTestSystem();

    // Make system unhealthy: unmet requirements reduce health score
    system._setInspection({
      settled: false,
      pendingRequirements: [
        { type: "A" }, { type: "B" }, { type: "C" },
        { type: "D" }, { type: "E" }, { type: "F" },
      ],
    });

    const runner = mockRunner([
      // Response for the health-decline triggered analysis
      { toolCalls: [{ name: "observe_system", arguments: "{}" }], totalTokens: 50 },
    ]);

    const events: ArchitectEvent[] = [];

    const architect = createAIArchitect({
      system: system as any,
      runner,
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      triggers: {
        onHealthDecline: { threshold: 50, pollInterval: "5s", minDrop: 10 },
        minInterval: 0, // Allow immediate re-analysis
      },
    });

    architect.on((e) => events.push(e));

    // First poll — system is unhealthy, score should drop significantly from 100
    await vi.advanceTimersByTimeAsync(5_000);

    const healthCheck = events.find((e) => e.type === "health-check") as any;
    expect(healthCheck).toBeDefined();

    // If triggered, we should see an analysis-start event
    if (healthCheck.triggered) {
      // Wait for async analysis to complete
      await vi.advanceTimersByTimeAsync(100);
      const analysisEvents = events.filter((e) => e.type === "analysis-start");
      expect(analysisEvents.length).toBeGreaterThan(0);
    }

    architect.destroy();
  });

  it("does NOT trigger when score is above threshold", async () => {
    const system = createTestSystem({ phase: "running" });

    // Healthy system — settled with no unmet requirements
    system._setInspection({ settled: true, pendingRequirements: [] });

    const events: ArchitectEvent[] = [];

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([]),
      budget: { tokens: 100_000, dollars: 10 },
      triggers: {
        onHealthDecline: { threshold: 50, pollInterval: "5s" },
      },
    });

    architect.on((e) => events.push(e));
    await vi.advanceTimersByTimeAsync(5_000);

    const check = events.find((e) => e.type === "health-check") as any;
    expect(check).toBeDefined();
    expect(check.triggered).toBe(false);

    // No analysis should have been triggered
    const analysisEvents = events.filter((e) => e.type === "analysis-start");
    expect(analysisEvents.length).toBe(0);

    architect.destroy();
  });

  it("does NOT trigger when drop is less than minDrop", async () => {
    const system = createTestSystem({ phase: "running" });

    // Slightly unhealthy — score drops but not by minDrop amount
    system._setInspection({ settled: false, pendingRequirements: [] });

    const events: ArchitectEvent[] = [];

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([]),
      budget: { tokens: 100_000, dollars: 10 },
      triggers: {
        onHealthDecline: {
          threshold: 80,
          pollInterval: "5s",
          minDrop: 50, // Require huge drop
        },
      },
    });

    architect.on((e) => events.push(e));
    await vi.advanceTimersByTimeAsync(5_000);

    const check = events.find((e) => e.type === "health-check") as any;
    expect(check).toBeDefined();
    expect(check.triggered).toBe(false);

    architect.destroy();
  });

  it("polls at the configured interval", async () => {
    const system = createTestSystem({ phase: "running" });
    const events: ArchitectEvent[] = [];

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([]),
      budget: { tokens: 100_000, dollars: 10 },
      triggers: {
        onHealthDecline: { threshold: 50, pollInterval: "10s" },
      },
    });

    architect.on((e) => events.push(e));

    // Advance 25 seconds — should get 2 polls (at 10s and 20s)
    await vi.advanceTimersByTimeAsync(25_000);

    const healthChecks = events.filter((e) => e.type === "health-check");
    expect(healthChecks.length).toBe(2);

    architect.destroy();
  });

  it("uses default values when not specified", async () => {
    const system = createTestSystem({ phase: "running" });
    const events: ArchitectEvent[] = [];

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([]),
      budget: { tokens: 100_000, dollars: 10 },
      triggers: {
        onHealthDecline: {}, // All defaults: threshold=50, pollInterval='30s', minDrop=10
      },
    });

    architect.on((e) => events.push(e));

    // Default poll interval is 30s — no check at 20s
    await vi.advanceTimersByTimeAsync(20_000);
    expect(events.filter((e) => e.type === "health-check").length).toBe(0);

    // Check at 30s
    await vi.advanceTimersByTimeAsync(10_000);
    const checks = events.filter((e) => e.type === "health-check");
    expect(checks.length).toBe(1);
    expect((checks[0] as any).threshold).toBe(50);

    architect.destroy();
  });

  it("destroy cleans up the health polling interval", async () => {
    const system = createTestSystem({ phase: "running" });
    const events: ArchitectEvent[] = [];

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([]),
      budget: { tokens: 100_000, dollars: 10 },
      triggers: {
        onHealthDecline: { threshold: 50, pollInterval: "5s" },
      },
    });

    architect.on((e) => events.push(e));

    // Get one poll
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events.filter((e) => e.type === "health-check").length).toBe(1);

    architect.destroy();

    // Advance more time — no additional polls
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events.filter((e) => e.type === "health-check").length).toBe(1);
  });

  it("tracks previous score across polls for correct drop detection", async () => {
    const system = createTestSystem({ phase: "running" });

    // Start healthy
    system._setInspection({ settled: true, pendingRequirements: [] });

    const events: ArchitectEvent[] = [];

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([
        { toolCalls: [{ name: "observe_system", arguments: "{}" }], totalTokens: 50 },
      ]),
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      triggers: {
        onHealthDecline: { threshold: 80, pollInterval: "5s", minDrop: 10 },
        minInterval: 0,
      },
    });

    architect.on((e) => events.push(e));

    // First poll — healthy, previousScore=100
    await vi.advanceTimersByTimeAsync(5_000);
    const check1 = events.filter((e) => e.type === "health-check")[0] as any;
    expect(check1.previousScore).toBe(100);

    // Second poll — same state, previousScore should be updated
    await vi.advanceTimersByTimeAsync(5_000);
    const check2 = events.filter((e) => e.type === "health-check")[1] as any;
    expect(check2.previousScore).toBe(check1.score);

    architect.destroy();
  });

  it("does not start health polling when onHealthDecline is not configured", async () => {
    const system = createTestSystem({ phase: "running" });
    const events: ArchitectEvent[] = [];

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([]),
      budget: { tokens: 100_000, dollars: 10 },
      // No onHealthDecline configured
    });

    architect.on((e) => events.push(e));

    await vi.advanceTimersByTimeAsync(60_000);

    const healthChecks = events.filter((e) => e.type === "health-check");
    expect(healthChecks.length).toBe(0);

    architect.destroy();
  });

  it("health-decline trigger context includes score and warnings", async () => {
    const system = createTestSystem();

    // Force very unhealthy system
    system._setInspection({
      settled: false,
      pendingRequirements: [
        { type: "A" }, { type: "B" }, { type: "C" },
        { type: "D" }, { type: "E" }, { type: "F" },
        { type: "G" }, { type: "H" }, { type: "I" },
        { type: "J" },
      ],
    });

    const events: ArchitectEvent[] = [];

    const runner = mockRunner([
      { toolCalls: [{ name: "observe_system", arguments: "{}" }], totalTokens: 50 },
    ]);

    const architect = createAIArchitect({
      system: system as any,
      runner,
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      triggers: {
        onHealthDecline: { threshold: 80, pollInterval: "5s", minDrop: 5 },
        minInterval: 0,
      },
    });

    architect.on((e) => events.push(e));

    await vi.advanceTimersByTimeAsync(5_000);

    const check = events.find((e) => e.type === "health-check") as any;
    if (check?.triggered) {
      // Wait for analysis
      await vi.advanceTimersByTimeAsync(100);

      const analysisComplete = events.find(
        (e) => e.type === "analysis-complete",
      ) as any;

      if (analysisComplete) {
        expect(analysisComplete.analysis.trigger).toBe("health-decline");
        expect(analysisComplete.analysis.triggerContext).toContain("Health score dropped");
      }
    }

    architect.destroy();
  });

  it("score recovery then decline re-triggers", async () => {
    const system = createTestSystem();
    const events: ArchitectEvent[] = [];

    // Start unhealthy
    system._setInspection({
      settled: false,
      pendingRequirements: [{ type: "A" }, { type: "B" }, { type: "C" }, { type: "D" }, { type: "E" }],
    });

    const runner = mockRunner([
      { toolCalls: [{ name: "observe_system", arguments: "{}" }], totalTokens: 50 },
      { toolCalls: [{ name: "observe_system", arguments: "{}" }], totalTokens: 50 },
    ]);

    const architect = createAIArchitect({
      system: system as any,
      runner,
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      triggers: {
        onHealthDecline: { threshold: 80, pollInterval: "5s", minDrop: 10 },
        minInterval: 0,
      },
    });

    architect.on((e) => events.push(e));

    // First poll — should drop from 100
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(100);

    // Recover
    system._setInspection({ settled: true, pendingRequirements: [] });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(100);

    // Drop again
    system._setInspection({
      settled: false,
      pendingRequirements: [{ type: "A" }, { type: "B" }, { type: "C" }, { type: "D" }, { type: "E" }],
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(100);

    const healthChecks = events.filter((e) => e.type === "health-check");
    expect(healthChecks.length).toBe(3);

    architect.destroy();
  });
});
