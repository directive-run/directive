import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOutcomeTracker } from "../outcomes.js";
import { createTestSystem, mockRunner } from "../testing.js";
import { createAIArchitect } from "../architect.js";

describe("createOutcomeTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records outcome after measurement delay", () => {
    const tracker = createOutcomeTracker({ measurementDelay: 500 });

    tracker.scheduleOutcome("a1", "create_constraint", "demand", "test action", 80, () => 85);

    // Not yet recorded
    expect(tracker.getOutcomes()).toHaveLength(0);

    vi.advanceTimersByTime(500);

    const outcomes = tracker.getOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      actionId: "a1",
      tool: "create_constraint",
      healthBefore: 80,
      healthAfter: 85,
      healthDelta: 5,
      rolledBack: false,
      trigger: "demand",
      summary: "test action",
      measurementDelayMs: 500,
    });

    tracker.destroy();
  });

  it("computes positive and negative health deltas", () => {
    const tracker = createOutcomeTracker({ measurementDelay: 100 });

    tracker.scheduleOutcome("a1", "create_constraint", "demand", "good", 50, () => 70);
    tracker.scheduleOutcome("a2", "set_fact", "demand", "bad", 70, () => 60);

    vi.advanceTimersByTime(100);

    const outcomes = tracker.getOutcomes();
    expect(outcomes).toHaveLength(2);

    // Newest first
    const good = outcomes.find((o) => o.actionId === "a1")!;
    const bad = outcomes.find((o) => o.actionId === "a2")!;

    expect(good.healthDelta).toBe(20);
    expect(bad.healthDelta).toBe(-10);

    tracker.destroy();
  });

  it("marks rolled-back actions before measurement", () => {
    const tracker = createOutcomeTracker({ measurementDelay: 1000 });

    const measureFn = vi.fn(() => 90);
    tracker.scheduleOutcome("a1", "create_constraint", "demand", "will rollback", 80, measureFn);

    // Rollback before measurement fires
    tracker.markRolledBack("a1");

    vi.advanceTimersByTime(1000);

    // Timer was cancelled, no outcome recorded
    expect(tracker.getOutcomes()).toHaveLength(0);
    expect(measureFn).not.toHaveBeenCalled();

    tracker.destroy();
  });

  it("marks rolled-back actions after measurement", () => {
    const tracker = createOutcomeTracker({ measurementDelay: 100 });

    tracker.scheduleOutcome("a1", "create_constraint", "demand", "completed", 80, () => 90);

    vi.advanceTimersByTime(100);
    expect(tracker.getOutcomes()).toHaveLength(1);
    expect(tracker.getOutcomes()[0]!.rolledBack).toBe(false);

    tracker.markRolledBack("a1");
    expect(tracker.getOutcomes()[0]!.rolledBack).toBe(true);

    tracker.destroy();
  });

  it("FIFO evicts at maxOutcomes", () => {
    const tracker = createOutcomeTracker({ measurementDelay: 100, maxOutcomes: 3 });

    for (let i = 0; i < 5; i++) {
      tracker.scheduleOutcome(`a${i}`, "create_constraint", "demand", `action ${i}`, 50 + i, () => 60 + i);
    }

    vi.advanceTimersByTime(100);

    const outcomes = tracker.getOutcomes();
    expect(outcomes).toHaveLength(3);

    // Newest first, oldest evicted
    expect(outcomes[0]!.actionId).toBe("a4");
    expect(outcomes[1]!.actionId).toBe("a3");
    expect(outcomes[2]!.actionId).toBe("a2");

    tracker.destroy();
  });

  it("getOutcomes returns newest first", () => {
    const tracker = createOutcomeTracker({ measurementDelay: 100 });

    tracker.scheduleOutcome("first", "create_constraint", "demand", "first", 50, () => 60);

    vi.advanceTimersByTime(100);

    tracker.scheduleOutcome("second", "set_fact", "schedule", "second", 60, () => 70);

    vi.advanceTimersByTime(100);

    const outcomes = tracker.getOutcomes();
    expect(outcomes[0]!.actionId).toBe("second");
    expect(outcomes[1]!.actionId).toBe("first");

    tracker.destroy();
  });

  it("aggregates patterns by tool", () => {
    const tracker = createOutcomeTracker({ measurementDelay: 100 });

    // 3 constraint outcomes: +10, +5, -5
    tracker.scheduleOutcome("a1", "create_constraint", "demand", "c1", 50, () => 60);
    tracker.scheduleOutcome("a2", "create_constraint", "demand", "c2", 60, () => 65);
    tracker.scheduleOutcome("a3", "create_constraint", "demand", "c3", 70, () => 65);

    // 1 resolver outcome: +8
    tracker.scheduleOutcome("a4", "create_resolver", "demand", "r1", 50, () => 58);

    vi.advanceTimersByTime(100);

    const patterns = tracker.getPatterns();
    expect(patterns).toHaveLength(2);

    // Sorted by success rate descending
    const resolver = patterns.find((p) => p.tool === "create_resolver")!;
    const constraint = patterns.find((p) => p.tool === "create_constraint")!;

    expect(resolver.count).toBe(1);
    expect(resolver.avgHealthDelta).toBe(8);
    expect(resolver.successRate).toBe(1);

    expect(constraint.count).toBe(3);
    // avg = (10 + 5 + -5) / 3 = 3.333... → rounded to 3.3
    expect(constraint.avgHealthDelta).toBe(3.3);
    // 2 out of 3 had positive delta
    expect(constraint.successRate).toBe(0.67);

    tracker.destroy();
  });

  it("formatForPrompt produces text with outcomes and patterns", () => {
    const tracker = createOutcomeTracker({ measurementDelay: 100 });

    tracker.scheduleOutcome("a1", "create_constraint", "demand", "rate limiter", 50, () => 62);
    tracker.scheduleOutcome("a2", "create_resolver", "demand", "retry handler", 62, () => 59);

    vi.advanceTimersByTime(100);

    const text = tracker.formatForPrompt();

    expect(text).toContain("### Recent Action Outcomes");
    expect(text).toContain("rate limiter");
    expect(text).toContain("+12");
    expect(text).toContain("50→62");
    expect(text).toContain("-3");
    expect(text).toContain("62→59");
    expect(text).toContain("### Outcome Patterns");
    expect(text).toContain("create_constraint");

    tracker.destroy();
  });

  it("formatForPrompt returns empty string with no outcomes", () => {
    const tracker = createOutcomeTracker();

    expect(tracker.formatForPrompt()).toBe("");

    tracker.destroy();
  });

  it("formatForPrompt respects maxEntries", () => {
    const tracker = createOutcomeTracker({ measurementDelay: 100 });

    for (let i = 0; i < 5; i++) {
      tracker.scheduleOutcome(`a${i}`, "create_constraint", "demand", `action-${i}`, 50, () => 60);
    }

    vi.advanceTimersByTime(100);

    const text2 = tracker.formatForPrompt(2);
    // Count outcome lines (contain "→" for health transition), not pattern lines
    const lines = text2.split("\n").filter((l) => l.startsWith("- create_constraint") && l.includes("→"));
    expect(lines).toHaveLength(2);

    tracker.destroy();
  });

  it("formatForPrompt marks rolled-back outcomes", () => {
    const tracker = createOutcomeTracker({ measurementDelay: 100 });

    tracker.scheduleOutcome("a1", "create_constraint", "demand", "will rollback", 50, () => 60);

    vi.advanceTimersByTime(100);

    tracker.markRolledBack("a1");

    const text = tracker.formatForPrompt();
    expect(text).toContain("(rolled back)");

    tracker.destroy();
  });

  it("formatForPrompt marks negative delta with warning", () => {
    const tracker = createOutcomeTracker({ measurementDelay: 100 });

    tracker.scheduleOutcome("a1", "set_fact", "demand", "bad action", 70, () => 60);

    vi.advanceTimersByTime(100);

    const text = tracker.formatForPrompt();
    expect(text).toContain("⚠");

    tracker.destroy();
  });

  it("destroy cleans up pending timers", () => {
    const tracker = createOutcomeTracker({ measurementDelay: 5000 });
    const measureFn = vi.fn(() => 90);

    tracker.scheduleOutcome("a1", "create_constraint", "demand", "pending", 80, measureFn);

    tracker.destroy();

    vi.advanceTimersByTime(5000);

    // Timer was cleared, measureFn never called
    expect(measureFn).not.toHaveBeenCalled();
    expect(tracker.getOutcomes()).toHaveLength(0);
  });

  it("handles multiple concurrent measurements", () => {
    const tracker = createOutcomeTracker({ measurementDelay: 100 });

    tracker.scheduleOutcome("a1", "create_constraint", "demand", "first", 50, () => 60);
    tracker.scheduleOutcome("a2", "create_resolver", "schedule", "second", 60, () => 75);
    tracker.scheduleOutcome("a3", "set_fact", "fact-change", "third", 70, () => 65);

    vi.advanceTimersByTime(100);

    expect(tracker.getOutcomes()).toHaveLength(3);
    expect(tracker.getPatterns()).toHaveLength(3);

    tracker.destroy();
  });

  it("uses default config values", () => {
    const tracker = createOutcomeTracker();

    tracker.scheduleOutcome("a1", "create_constraint", "demand", "test", 80, () => 85);

    // Default delay is 10000ms
    vi.advanceTimersByTime(9999);
    expect(tracker.getOutcomes()).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(tracker.getOutcomes()).toHaveLength(1);

    tracker.destroy();
  });
});

describe("outcome tracking integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("architect exposes getOutcomes and getOutcomePatterns", () => {
    const system = createTestSystem({ phase: "running" });

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([]),
      budget: { tokens: 100_000, dollars: 10 },
      outcomeTracking: { measurementDelay: 100 },
    });

    expect(architect.getOutcomes()).toEqual([]);
    expect(architect.getOutcomePatterns()).toEqual([]);

    architect.destroy();
  });

  it("returns empty arrays when outcome tracking is not configured", () => {
    const system = createTestSystem({ phase: "running" });

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([]),
      budget: { tokens: 100_000, dollars: 10 },
      // No outcomeTracking
    });

    expect(architect.getOutcomes()).toEqual([]);
    expect(architect.getOutcomePatterns()).toEqual([]);

    architect.destroy();
  });

  it("records outcomes after pipeline applies actions", async () => {
    const system = createTestSystem({ phase: "running" });

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([
        {
          toolCalls: [{ name: "observe_system", arguments: "{}" }],
          totalTokens: 50,
        },
      ]),
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      outcomeTracking: { measurementDelay: 500 },
    });

    await architect.analyze();

    // Wait for outcome measurement
    await vi.advanceTimersByTimeAsync(500);

    const outcomes = architect.getOutcomes();
    expect(outcomes.length).toBeGreaterThanOrEqual(1);
    expect(outcomes[0]!.tool).toBe("observe_system");
    expect(typeof outcomes[0]!.healthBefore).toBe("number");
    expect(typeof outcomes[0]!.healthAfter).toBe("number");

    architect.destroy();
  });
});
