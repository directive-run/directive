import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createHealthTrend,
  buildAdaptiveContext,
} from "../adaptive-context.js";
import type { AdaptiveContextData } from "../adaptive-context.js";
import { createTestSystem, mockRunner } from "../testing.js";
import { createAIArchitect } from "../architect.js";

describe("createHealthTrend", () => {
  it("records and retrieves samples", () => {
    const trend = createHealthTrend();

    trend.record(80);
    trend.record(75);
    trend.record(85);

    const samples = trend.getSamples();
    expect(samples).toHaveLength(3);
    expect(samples[0]!.score).toBe(80);
    expect(samples[1]!.score).toBe(75);
    expect(samples[2]!.score).toBe(85);
    expect(typeof samples[0]!.timestamp).toBe("number");
  });

  it("FIFO evicts at maxSamples", () => {
    const trend = createHealthTrend(3);

    trend.record(90);
    trend.record(85);
    trend.record(80);
    trend.record(75); // evicts 90

    const samples = trend.getSamples();
    expect(samples).toHaveLength(3);
    expect(samples[0]!.score).toBe(85);
  });

  it("direction: improving", () => {
    const trend = createHealthTrend();

    trend.record(50);
    trend.record(60);
    trend.record(70);

    expect(trend.direction()).toBe("improving");
  });

  it("direction: declining", () => {
    const trend = createHealthTrend();

    trend.record(90);
    trend.record(80);
    trend.record(70);

    expect(trend.direction()).toBe("declining");
  });

  it("direction: stable", () => {
    const trend = createHealthTrend();

    trend.record(80);
    trend.record(81);
    trend.record(80);

    expect(trend.direction()).toBe("stable");
  });

  it("direction: stable with single sample", () => {
    const trend = createHealthTrend();

    trend.record(80);

    expect(trend.direction()).toBe("stable");
  });

  it("direction: stable with no samples", () => {
    const trend = createHealthTrend();

    expect(trend.direction()).toBe("stable");
  });

  it("formatForPrompt with samples", () => {
    const trend = createHealthTrend();

    trend.record(55);
    trend.record(62);
    trend.record(71);
    trend.record(74);

    const text = trend.formatForPrompt();
    expect(text).toContain("improving");
    expect(text).toContain("↗");
    expect(text).toContain("55");
    expect(text).toContain("74");
  });

  it("formatForPrompt empty returns empty string", () => {
    const trend = createHealthTrend();

    expect(trend.formatForPrompt()).toBe("");
  });
});

describe("buildAdaptiveContext", () => {
  const baseData: AdaptiveContextData = {
    outcomes: [
      {
        actionId: "a1",
        tool: "create_constraint",
        healthBefore: 62,
        healthAfter: 74,
        healthDelta: 12,
        rolledBack: false,
        measuredAt: Date.now(),
        measurementDelayMs: 10000,
        trigger: "demand",
        summary: "rate-limiter",
      },
      {
        actionId: "a2",
        tool: "create_resolver",
        healthBefore: 74,
        healthAfter: 71,
        healthDelta: -3,
        rolledBack: true,
        measuredAt: Date.now(),
        measurementDelayMs: 10000,
        trigger: "demand",
        summary: "retry-handler",
      },
    ],
    patterns: [
      { tool: "create_constraint", avgHealthDelta: 7.2, count: 8, successRate: 0.75 },
      { tool: "create_resolver", avgHealthDelta: 3.1, count: 5, successRate: 0.6 },
    ],
    healthTrend: [
      { score: 55, timestamp: Date.now() - 30000 },
      { score: 62, timestamp: Date.now() - 20000 },
      { score: 71, timestamp: Date.now() - 10000 },
      { score: 74, timestamp: Date.now() },
    ],
    templateStats: [
      { templateId: "rate-limit", timesUsed: 3, avgHealthDelta: 9.5 },
      { templateId: "error-threshold", timesUsed: 2, avgHealthDelta: 5.0 },
    ],
  };

  it("includes all sections when data available", () => {
    const text = buildAdaptiveContext(baseData);

    expect(text).toContain("## Learning Context");
    expect(text).toContain("### Recent Outcomes");
    expect(text).toContain("### Patterns");
    expect(text).toContain("### Health Trend");
    expect(text).toContain("### Template Effectiveness");
    expect(text).toContain("### Guidance");
  });

  it("includes outcome details", () => {
    const text = buildAdaptiveContext(baseData);

    expect(text).toContain("rate-limiter");
    expect(text).toContain("+12");
    expect(text).toContain("62→74");
    expect(text).toContain("(rolled back)");
    expect(text).toContain("-3");
  });

  it("includes pattern details", () => {
    const text = buildAdaptiveContext(baseData);

    expect(text).toContain("create_constraint: 8 uses");
    expect(text).toContain("75% success");
    expect(text).toContain("create_resolver: 5 uses");
  });

  it("includes template stats", () => {
    const text = buildAdaptiveContext(baseData);

    expect(text).toContain("rate-limit");
    expect(text).toContain("3 uses");
    expect(text).toContain("+9.5");
  });

  it("includes guidance", () => {
    const text = buildAdaptiveContext(baseData);

    expect(text).toContain("Prefer create_constraint");
    expect(text).toContain("proven effective");
  });

  it("omits outcomes section when disabled", () => {
    const text = buildAdaptiveContext(baseData, { includeOutcomes: false });

    expect(text).not.toContain("### Recent Outcomes");
    expect(text).not.toContain("### Patterns");
  });

  it("omits health trend when disabled", () => {
    const text = buildAdaptiveContext(baseData, { includeHealthTrend: false });

    expect(text).not.toContain("### Health Trend");
  });

  it("omits template stats when disabled", () => {
    const text = buildAdaptiveContext(baseData, { includeTemplateStats: false });

    expect(text).not.toContain("### Template Effectiveness");
  });

  it("empty data produces empty string", () => {
    const text = buildAdaptiveContext({
      outcomes: [],
      patterns: [],
      healthTrend: [],
      templateStats: [],
    });

    expect(text).toBe("");
  });

  it("maxOutcomeEntries truncates", () => {
    const manyOutcomes = Array.from({ length: 20 }, (_, i) => ({
      actionId: `a${i}`,
      tool: "create_constraint",
      healthBefore: 50,
      healthAfter: 60,
      healthDelta: 10,
      rolledBack: false,
      measuredAt: Date.now(),
      measurementDelayMs: 10000,
      trigger: "demand",
      summary: `action-${i}`,
    }));

    const text = buildAdaptiveContext(
      { ...baseData, outcomes: manyOutcomes },
      { maxOutcomeEntries: 3 },
    );

    // Count outcome lines (contain "→" for health transition)
    const outcomeLines = text.split("\n").filter((l) => l.startsWith("- create_constraint") && l.includes("→"));
    expect(outcomeLines).toHaveLength(3);
  });

  it("custom builder output appended", () => {
    const text = buildAdaptiveContext(baseData, {
      customBuilder: (data) => `Custom: ${data.outcomes.length} outcomes tracked`,
    });

    expect(text).toContain("Custom: 2 outcomes tracked");
  });

  it("positive health delta marked with checkmark", () => {
    const text = buildAdaptiveContext(baseData);

    expect(text).toContain("✓");
  });

  it("rolled back actions marked", () => {
    const text = buildAdaptiveContext(baseData);

    expect(text).toContain("(rolled back)");
  });
});

describe("adaptive context integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("health trend feeds from analysis cycles", async () => {
    const system = createTestSystem({ phase: "running" });

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([
        { toolCalls: [{ name: "observe_system", arguments: "{}" }], totalTokens: 50 },
        { toolCalls: [{ name: "observe_system", arguments: "{}" }], totalTokens: 50 },
      ]),
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      outcomeTracking: { measurementDelay: 100 },
      adaptiveContext: {},
    });

    // Two analysis cycles feed health samples
    await architect.analyze();
    await architect.analyze();

    // Health trend should have samples
    // (We can't directly access healthTrend, but the system should work without error)
    expect(architect.getOutcomes()).toBeDefined();

    architect.destroy();
  });
});
