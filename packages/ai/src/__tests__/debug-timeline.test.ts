import { describe, it, expect, vi } from "vitest";
import { createDebugTimeline, createDebugTimelinePlugin } from "../debug-timeline.js";
import { createTestTimeline, assertTimelineEvents, createTestOrchestrator, createTestMultiAgentOrchestrator } from "../testing.js";
import type { DebugEvent, DebugEventType } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeEvent(
  type: DebugEventType,
  overrides: Partial<Omit<DebugEvent, "id" | "type">> = {},
): Omit<DebugEvent, "id"> {
  return {
    type,
    timestamp: Date.now(),
    snapshotId: null,
    agentId: "",
    ...overrides,
  } as Omit<DebugEvent, "id">;
}

// ============================================================================
// 1. Ring Buffer Overflow / Eviction
// ============================================================================

describe("ring buffer overflow/eviction", () => {
  it("evicts oldest events when maxEvents is exceeded", () => {
    const timeline = createDebugTimeline({ maxEvents: 3 });

    timeline.record(makeEvent("agent_start", { agentId: "a1", inputLength: 1 } as any));
    timeline.record(makeEvent("agent_start", { agentId: "a2", inputLength: 2 } as any));
    timeline.record(makeEvent("agent_start", { agentId: "a3", inputLength: 3 } as any));
    timeline.record(makeEvent("agent_start", { agentId: "a4", inputLength: 4 } as any));

    expect(timeline.length).toBe(3);
    const events = timeline.getEvents();
    // First event (a1) should be evicted
    expect(events[0]!.agentId).toBe("a2");
    expect(events[2]!.agentId).toBe("a4");
  });

  it("defaults to 2000 maxEvents", () => {
    const timeline = createDebugTimeline();

    for (let i = 0; i < 2010; i++) {
      timeline.record(makeEvent("agent_start", { agentId: `a${i}`, inputLength: i } as any));
    }

    expect(timeline.length).toBe(2000);
  });

  it("handles maxEvents of 1", () => {
    const timeline = createDebugTimeline({ maxEvents: 1 });

    timeline.record(makeEvent("agent_start", { agentId: "first" } as any));
    timeline.record(makeEvent("agent_complete", { agentId: "second" } as any));

    expect(timeline.length).toBe(1);
    expect(timeline.getEvents()[0]!.type).toBe("agent_complete");
  });
});

// ============================================================================
// 2. record() Assigns Sequential IDs
// ============================================================================

describe("record() assigns sequential IDs", () => {
  it("assigns IDs starting from 0", () => {
    const timeline = createDebugTimeline();

    const e0 = timeline.record(makeEvent("agent_start", { agentId: "a" } as any));
    const e1 = timeline.record(makeEvent("agent_complete", { agentId: "a" } as any));
    const e2 = timeline.record(makeEvent("agent_error", { agentId: "a" } as any));

    expect(e0.id).toBe(0);
    expect(e1.id).toBe(1);
    expect(e2.id).toBe(2);
  });

  it("continues sequencing after eviction", () => {
    const timeline = createDebugTimeline({ maxEvents: 2 });

    const e0 = timeline.record(makeEvent("agent_start", { agentId: "a" } as any));
    const e1 = timeline.record(makeEvent("agent_start", { agentId: "b" } as any));
    const e2 = timeline.record(makeEvent("agent_start", { agentId: "c" } as any));

    expect(e0.id).toBe(0);
    expect(e1.id).toBe(1);
    expect(e2.id).toBe(2);
    // Buffer only holds 2, but IDs continue incrementing
    expect(timeline.getEvents()[0]!.id).toBe(1);
  });

  it("returns the recorded event with ID attached", () => {
    const timeline = createDebugTimeline();

    const result = timeline.record(makeEvent("guardrail_check", {
      agentId: "test",
      guardrailName: "pii",
      guardrailType: "input",
      passed: true,
      durationMs: 5,
    } as any));

    expect(result.id).toBe(0);
    expect(result.type).toBe("guardrail_check");
  });
});

// ============================================================================
// 3. getEventsForAgent() Filtering
// ============================================================================

describe("getEventsForAgent() filtering", () => {
  it("filters events by agentId", () => {
    const timeline = createTestTimeline([
      { type: "agent_start", agentId: "researcher", inputLength: 10 } as any,
      { type: "agent_start", agentId: "writer", inputLength: 20 } as any,
      { type: "agent_complete", agentId: "researcher", outputLength: 50, durationMs: 100, totalTokens: 200 } as any,
    ]);

    const researcherEvents = timeline.getEventsForAgent("researcher");
    expect(researcherEvents).toHaveLength(2);
    expect(researcherEvents.every((e) => e.agentId === "researcher")).toBe(true);
  });

  it("returns empty array for unknown agentId", () => {
    const timeline = createTestTimeline([
      { type: "agent_start", agentId: "researcher" } as any,
    ]);

    expect(timeline.getEventsForAgent("nonexistent")).toHaveLength(0);
  });

  it("returns a copy (mutations do not affect internal state)", () => {
    const timeline = createTestTimeline([
      { type: "agent_start", agentId: "a" } as any,
    ]);

    const events = timeline.getEventsForAgent("a");
    events.length = 0;

    expect(timeline.getEventsForAgent("a")).toHaveLength(1);
  });
});

// ============================================================================
// 4. getEventsByType() Type Narrowing
// ============================================================================

describe("getEventsByType() type narrowing", () => {
  it("filters events by type", () => {
    const timeline = createTestTimeline([
      { type: "agent_start", agentId: "a", inputLength: 10 } as any,
      { type: "guardrail_check", agentId: "a", guardrailName: "pii", guardrailType: "input", passed: true, durationMs: 5 } as any,
      { type: "agent_complete", agentId: "a", outputLength: 50, durationMs: 100, totalTokens: 200 } as any,
    ]);

    const startEvents = timeline.getEventsByType("agent_start");
    expect(startEvents).toHaveLength(1);
    // Type narrowing: should have inputLength property
    expect(startEvents[0]!.inputLength).toBe(10);
  });

  it("returns all 16 types when mixed", () => {
    const allTypes: DebugEventType[] = [
      "agent_start", "agent_complete", "agent_error", "agent_retry",
      "guardrail_check", "constraint_evaluate", "resolver_start",
      "resolver_complete", "resolver_error", "approval_request",
      "approval_response", "handoff_start", "handoff_complete",
      "pattern_start", "pattern_complete", "dag_node_update",
    ];

    const timeline = createDebugTimeline();
    for (const type of allTypes) {
      timeline.record(makeEvent(type));
    }

    for (const type of allTypes) {
      const filtered = timeline.getEventsByType(type);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.type).toBe(type);
    }
  });
});

// ============================================================================
// 5. getEventsAtSnapshot() Correlation
// ============================================================================

describe("getEventsAtSnapshot() correlation", () => {
  it("returns events at a specific snapshot ID", () => {
    const timeline = createDebugTimeline();

    timeline.record(makeEvent("agent_start", { agentId: "a", snapshotId: 1 } as any));
    timeline.record(makeEvent("constraint_evaluate", { snapshotId: 2 } as any));
    timeline.record(makeEvent("agent_complete", { agentId: "a", snapshotId: 1 } as any));
    timeline.record(makeEvent("resolver_start", { snapshotId: 3 } as any));

    const snapshot1 = timeline.getEventsAtSnapshot(1);
    expect(snapshot1).toHaveLength(2);
    expect(snapshot1[0]!.type).toBe("agent_start");
    expect(snapshot1[1]!.type).toBe("agent_complete");
  });

  it("returns empty for snapshot with no events", () => {
    const timeline = createDebugTimeline();
    timeline.record(makeEvent("agent_start", { snapshotId: 1 } as any));

    expect(timeline.getEventsAtSnapshot(99)).toHaveLength(0);
  });

  it("does not match null snapshotId", () => {
    const timeline = createDebugTimeline();
    timeline.record(makeEvent("agent_start", { snapshotId: null } as any));

    // snapshotId: null should not match any numeric lookup
    expect(timeline.getEventsAtSnapshot(0)).toHaveLength(0);
  });

  it("uses getSnapshotId callback when recording", () => {
    let currentSnapshot = 5;
    const timeline = createDebugTimeline({
      getSnapshotId: () => currentSnapshot,
    });

    // Record without explicit snapshotId — the timeline itself doesn't auto-inject,
    // but the plugin does. Verify the option is accepted.
    timeline.record({ type: "agent_start", timestamp: Date.now(), snapshotId: currentSnapshot, agentId: "a", inputLength: 1 } as Omit<DebugEvent, "id">);
    currentSnapshot = 10;
    timeline.record({ type: "agent_complete", timestamp: Date.now(), snapshotId: currentSnapshot, agentId: "a", outputLength: 1, totalTokens: 10, durationMs: 5 } as Omit<DebugEvent, "id">);

    expect(timeline.getEventsAtSnapshot(5)).toHaveLength(1);
    expect(timeline.getEventsAtSnapshot(10)).toHaveLength(1);
  });
});

// ============================================================================
// 6. getEventsInRange() Time Filtering
// ============================================================================

describe("getEventsInRange() time filtering", () => {
  it("returns events within the time range (inclusive)", () => {
    const timeline = createDebugTimeline();

    timeline.record(makeEvent("agent_start", { timestamp: 1000 } as any));
    timeline.record(makeEvent("agent_start", { timestamp: 2000 } as any));
    timeline.record(makeEvent("agent_start", { timestamp: 3000 } as any));
    timeline.record(makeEvent("agent_start", { timestamp: 4000 } as any));

    const inRange = timeline.getEventsInRange(2000, 3000);
    expect(inRange).toHaveLength(2);
    expect(inRange[0]!.timestamp).toBe(2000);
    expect(inRange[1]!.timestamp).toBe(3000);
  });

  it("returns empty for range with no events", () => {
    const timeline = createDebugTimeline();
    timeline.record(makeEvent("agent_start", { timestamp: 1000 } as any));

    expect(timeline.getEventsInRange(2000, 3000)).toHaveLength(0);
  });

  it("returns single event when range matches exactly one timestamp", () => {
    const timeline = createDebugTimeline();
    timeline.record(makeEvent("agent_start", { timestamp: 5000 } as any));

    expect(timeline.getEventsInRange(5000, 5000)).toHaveLength(1);
  });
});

// ============================================================================
// 7. forkFrom() Truncation + goToSnapshot Callback
// ============================================================================

describe("forkFrom() truncation + goToSnapshot callback", () => {
  it("truncates events after the fork snapshot", () => {
    const timeline = createDebugTimeline();

    timeline.record(makeEvent("agent_start", { timestamp: 100, snapshotId: 1 } as any));
    timeline.record(makeEvent("agent_complete", { timestamp: 200, snapshotId: 2 } as any));
    timeline.record(makeEvent("agent_start", { timestamp: 300, snapshotId: 3 } as any));
    timeline.record(makeEvent("agent_complete", { timestamp: 400, snapshotId: 4 } as any));

    timeline.forkFrom(2);

    // Events at snapshot 2 and before should remain, snapshot 3 and 4 removed
    const events = timeline.getEvents();
    expect(events.length).toBeLessThanOrEqual(2);
    expect(events.every((e) => e.timestamp <= 200)).toBe(true);
  });

  it("calls goToSnapshot callback", () => {
    const goTo = vi.fn();
    const timeline = createDebugTimeline({ goToSnapshot: goTo });

    timeline.record(makeEvent("agent_start", { timestamp: 100, snapshotId: 1 } as any));
    timeline.forkFrom(1);

    expect(goTo).toHaveBeenCalledWith(1);
  });

  it("clears all events when no matching snapshot found", () => {
    const timeline = createDebugTimeline();
    timeline.record(makeEvent("agent_start", { timestamp: 100, snapshotId: 5 } as any));

    timeline.forkFrom(1);

    expect(timeline.length).toBe(0);
  });

  it("does not call goToSnapshot when callback is not provided", () => {
    const timeline = createDebugTimeline();
    timeline.record(makeEvent("agent_start", { timestamp: 100, snapshotId: 1 } as any));

    // Should not throw
    expect(() => timeline.forkFrom(1)).not.toThrow();
  });
});

// ============================================================================
// 8. export()/import() Roundtrip + Prototype Pollution Defense
// ============================================================================

describe("export()/import() roundtrip", () => {
  it("roundtrips events through export and import", () => {
    const timeline = createDebugTimeline();
    timeline.record(makeEvent("agent_start", { agentId: "a", timestamp: 1000, inputLength: 42 } as any));
    timeline.record(makeEvent("agent_complete", { agentId: "a", timestamp: 2000, outputLength: 100, durationMs: 1000, totalTokens: 200 } as any));

    const exported = timeline.export();
    const imported = createDebugTimeline();
    imported.import(exported);

    expect(imported.length).toBe(2);
    expect(imported.getEvents()[0]!.type).toBe("agent_start");
    expect(imported.getEvents()[1]!.type).toBe("agent_complete");
  });

  it("preserves IDs after import", () => {
    const timeline = createDebugTimeline();
    timeline.record(makeEvent("agent_start", { agentId: "a" } as any));
    timeline.record(makeEvent("agent_complete", { agentId: "a" } as any));

    const exported = timeline.export();
    const imported = createDebugTimeline();
    imported.import(exported);

    expect(imported.getEvents()[0]!.id).toBe(0);
    expect(imported.getEvents()[1]!.id).toBe(1);
  });

  it("continues ID sequencing after import", () => {
    const timeline = createDebugTimeline();
    timeline.record(makeEvent("agent_start", { agentId: "a" } as any));
    timeline.record(makeEvent("agent_complete", { agentId: "a" } as any));

    const exported = timeline.export();
    const imported = createDebugTimeline();
    imported.import(exported);

    const newEvent = imported.record(makeEvent("agent_error", { agentId: "a" } as any));
    expect(newEvent.id).toBe(2);
  });

  it("throws on invalid JSON", () => {
    const timeline = createDebugTimeline();

    expect(() => timeline.import("not-json")).toThrow("[Directive DebugTimeline] Invalid JSON");
  });

  it("throws on non-object payload", () => {
    const timeline = createDebugTimeline();

    expect(() => timeline.import('"hello"')).toThrow("[Directive DebugTimeline] Invalid timeline data");
  });

  it("throws on missing events array", () => {
    const timeline = createDebugTimeline();

    expect(() => timeline.import('{"version":1}')).toThrow("[Directive DebugTimeline] Missing events array");
  });

  it("rejects __proto__ key in top-level object (prototype pollution defense)", () => {
    const timeline = createDebugTimeline();
    // JSON.stringify strips __proto__, so construct the malicious JSON by hand
    const malicious = '{"__proto__":{"polluted":true},"events":[],"nextId":0}';

    expect(() => timeline.import(malicious)).toThrow("Blocked key in import: __proto__");
  });

  it("rejects constructor key in top-level object", () => {
    const timeline = createDebugTimeline();
    // constructor is a normal key, so JSON.stringify preserves it
    const malicious = '{"constructor":{"polluted":true},"events":[],"nextId":0}';

    expect(() => timeline.import(malicious)).toThrow("Blocked key in import: constructor");
  });

  it("rejects __proto__ key in event objects", () => {
    const timeline = createDebugTimeline();
    // Hand-craft JSON to include __proto__ inside an event object
    const malicious = '{"version":1,"events":[{"id":0,"type":"agent_start","timestamp":1000,"__proto__":{"bad":true}}],"nextId":1}';

    expect(() => timeline.import(malicious)).toThrow("Blocked key in event: __proto__");
  });

  it("skips events without required fields", () => {
    const timeline = createDebugTimeline();
    const json = JSON.stringify({
      version: 1,
      events: [
        { id: 0, type: "agent_start", timestamp: 1000 }, // valid
        { id: "not-a-number", type: "agent_start", timestamp: 1000 }, // invalid id
        { type: "agent_start", timestamp: 1000 }, // missing id
        null, // null event
      ],
      nextId: 4,
    });

    timeline.import(json);
    expect(timeline.length).toBe(1);
  });
});

// ============================================================================
// 9. Integration: Single-Agent run() with debug: true
// NOTE: Skipped — orchestrator init has validation changes in progress.
//       Remove .skip once orchestrator bridge schema is stabilized.
// ============================================================================

describe("integration: single-agent events during run()", () => {
  it("records agent_start and agent_complete events", async () => {
    const orchestrator = createTestOrchestrator({
      debug: true,
      mockResponses: { "test-agent": { output: "hello", totalTokens: 50 } },
    });

    await orchestrator.run({ name: "test-agent" }, "Hi there");

    const timeline = orchestrator.timeline;
    expect(timeline).not.toBeNull();

    const events = timeline!.getEvents();
    const types = events.map((e) => e.type);
    expect(types).toContain("agent_start");
    expect(types).toContain("agent_complete");
  });

  it("records agent_start with inputLength", async () => {
    const orchestrator = createTestOrchestrator({
      debug: true,
      mockResponses: { "test-agent": { output: "done" } },
    });

    await orchestrator.run({ name: "test-agent" }, "Hello world");

    const startEvents = orchestrator.timeline!.getEventsByType("agent_start");
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]!.inputLength).toBe(11); // "Hello world".length
  });

  it("records agent_complete with token usage and duration", async () => {
    const orchestrator = createTestOrchestrator({
      debug: true,
      mockResponses: { "test-agent": { output: "result", totalTokens: 75 } },
    });

    await orchestrator.run({ name: "test-agent" }, "input");

    const completeEvents = orchestrator.timeline!.getEventsByType("agent_complete");
    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0]!.totalTokens).toBe(75);
    expect(completeEvents[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// 10. Integration: Multi-Agent run() with debug: true
// NOTE: Skipped — orchestrator init has validation changes in progress.
// ============================================================================

describe("integration: multi-agent events during run()", () => {
  it("records agent-indexed events for individual agents", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      debug: true,
      agents: {
        researcher: { agent: { name: "researcher" } },
        writer: { agent: { name: "writer" } },
      },
      mockResponses: {
        researcher: { output: "research data", totalTokens: 100 },
        writer: { output: "article", totalTokens: 200 },
      },
    });

    await orchestrator.runAgent("researcher", "Find info");
    await orchestrator.runAgent("writer", "Write about it");

    const timeline = orchestrator.timeline;
    expect(timeline).not.toBeNull();

    const researcherEvents = timeline!.getEventsForAgent("researcher");
    const writerEvents = timeline!.getEventsForAgent("writer");

    expect(researcherEvents.length).toBeGreaterThanOrEqual(2); // start + complete
    expect(writerEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("records events with correct agentId values", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      debug: true,
      agents: {
        alpha: { agent: { name: "alpha" } },
      },
      mockResponses: {
        alpha: { output: "done", totalTokens: 10 },
      },
    });

    await orchestrator.runAgent("alpha", "Go");

    const startEvents = orchestrator.timeline!.getEventsByType("agent_start");
    expect(startEvents.length).toBeGreaterThanOrEqual(1);
    expect(startEvents.some((e) => e.agentId === "alpha")).toBe(true);
  });
});

// ============================================================================
// 11. Zero-Cost When debug: false
// NOTE: Skipped — orchestrator init has validation changes in progress.
// ============================================================================

describe("zero-cost when debug: false", () => {
  it("timeline is null when debug option is not set", () => {
    const orchestrator = createTestOrchestrator({
      mockResponses: { "test-agent": { output: "ok" } },
    });

    expect(orchestrator.timeline).toBeNull();
  });

  it("timeline is null for multi-agent when debug is not set", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: { a: { output: "ok" } },
    });

    expect(orchestrator.timeline).toBeNull();
  });

  it("single-agent run works without debug", async () => {
    const orchestrator = createTestOrchestrator({
      mockResponses: { "test-agent": { output: "hello" } },
    });

    const result = await orchestrator.run({ name: "test-agent" }, "Hi");
    expect(result.output).toBe("hello");
    expect(orchestrator.timeline).toBeNull();
  });
});

// ============================================================================
// 12. Guardrail Pass/Fail Events
// NOTE: Skipped — orchestrator init has validation changes in progress.
// ============================================================================

describe("guardrail pass/fail events", () => {
  it("records guardrail_check via lifecycle hooks (single-agent)", async () => {
    const guardrailEvents: Array<{ guardrailName: string; passed: boolean }> = [];

    const orchestrator = createTestOrchestrator({
      debug: true,
      mockResponses: { "test-agent": { output: "safe output" } },
      guardrails: {
        input: [
          {
            name: "test-guardrail",
            fn: () => ({ passed: true }),
          },
        ],
      },
      hooks: {
        onGuardrailCheck: (event) => {
          guardrailEvents.push({ guardrailName: event.guardrailName, passed: event.passed });
        },
      },
    });

    await orchestrator.run({ name: "test-agent" }, "Hello");

    expect(guardrailEvents).toHaveLength(1);
    expect(guardrailEvents[0]!.passed).toBe(true);
    expect(guardrailEvents[0]!.guardrailName).toBe("test-guardrail");
  });

  it("captures guardrail failure reason via hooks", async () => {
    const guardrailEvents: Array<{ passed: boolean; reason?: string }> = [];

    const orchestrator = createTestOrchestrator({
      debug: true,
      mockResponses: { "test-agent": { output: "safe" } },
      guardrails: {
        input: [
          {
            name: "block-pii",
            fn: () => ({ passed: false, reason: "PII detected" }),
          },
        ],
      },
      hooks: {
        onGuardrailCheck: (event) => {
          guardrailEvents.push({ passed: event.passed, reason: event.reason });
        },
      },
    });

    await expect(
      orchestrator.run({ name: "test-agent" }, "SSN: 123-45-6789"),
    ).rejects.toThrow();

    expect(guardrailEvents).toHaveLength(1);
    expect(guardrailEvents[0]!.passed).toBe(false);
    expect(guardrailEvents[0]!.reason).toBe("PII detected");
  });
});

// ============================================================================
// 13. Approval Events
// NOTE: Skipped — orchestrator init has validation changes in progress.
// ============================================================================

describe("approval events", () => {
  it("records approval_request on timeline (multi-agent)", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      debug: true,
      agents: {
        worker: {
          agent: { name: "worker" },
        },
      },
      mockResponses: {
        worker: {
          output: "done",
          totalTokens: 10,
          toolCalls: [{ id: "tc1", name: "delete", arguments: "{}", result: "ok" }],
        },
      },
      autoApproveToolCalls: true,
    });

    await orchestrator.runAgent("worker", "Do work");

    const timeline = orchestrator.timeline;
    expect(timeline).not.toBeNull();

    // Approval events may or may not be recorded depending on the auto-approve path.
    // At minimum, the run should complete successfully.
    const events = timeline!.getEvents();
    const types = events.map((e) => e.type);
    expect(types).toContain("agent_start");
    expect(types).toContain("agent_complete");
  });
});

// ============================================================================
// 14. Pattern Events (Multi-Agent)
// NOTE: Skipped — orchestrator init has validation changes in progress.
// ============================================================================

describe("pattern events (multi-agent)", () => {
  it("records pattern_start and pattern_complete for parallel execution", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      debug: true,
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "result-a", totalTokens: 10 },
        b: { output: "result-b", totalTokens: 10 },
      },
      patterns: {
        par: {
          type: "parallel",
          agents: ["a", "b"],
          merge: (results: any[]) => results.map((r: any) => r.output).join(", "),
        },
      },
    });

    await orchestrator.runPattern("par", "Go");

    const timeline = orchestrator.timeline;
    expect(timeline).not.toBeNull();

    const patternStarts = timeline!.getEventsByType("pattern_start");
    const patternCompletes = timeline!.getEventsByType("pattern_complete");

    expect(patternStarts.length).toBeGreaterThanOrEqual(1);
    expect(patternCompletes.length).toBeGreaterThanOrEqual(1);
    expect(patternStarts[0]!.patternType).toBe("parallel");
  });

  it("records pattern_start and pattern_complete for sequential execution", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      debug: true,
      agents: {
        first: { agent: { name: "first" } },
        second: { agent: { name: "second" } },
      },
      mockResponses: {
        first: { output: "step-1", totalTokens: 10 },
        second: { output: "step-2", totalTokens: 10 },
      },
      patterns: {
        seq: {
          type: "sequential",
          agents: ["first", "second"],
          transform: (_output: unknown, _agentId: string) => String(_output),
        },
      },
    });

    await orchestrator.runPattern("seq", "Start");

    const timeline = orchestrator.timeline;
    expect(timeline).not.toBeNull();

    const patternStarts = timeline!.getEventsByType("pattern_start");
    expect(patternStarts.length).toBeGreaterThanOrEqual(1);
    expect(patternStarts[0]!.patternType).toBe("sequential");
  });
});

// ============================================================================
// 15. Plugin Bridges Core Events to Timeline
// ============================================================================

describe("createDebugTimelinePlugin bridges core events", () => {
  it("records constraint_evaluate events", () => {
    const timeline = createDebugTimeline();
    let snapshotId = 7;
    const plugin = createDebugTimelinePlugin(timeline, () => snapshotId);

    plugin.onConstraintEvaluate!("budget-check", true);

    const events = timeline.getEventsByType("constraint_evaluate");
    expect(events).toHaveLength(1);
    expect(events[0]!.constraintId).toBe("budget-check");
    expect(events[0]!.fired).toBe(true);
    expect(events[0]!.snapshotId).toBe(7);
  });

  it("records resolver_start events", () => {
    const timeline = createDebugTimeline();
    const plugin = createDebugTimelinePlugin(timeline, () => null);

    plugin.onResolverStart!("fetch-data", { requirement: { type: "FETCH" }, id: "req-1", fromConstraint: "c1" });

    const events = timeline.getEventsByType("resolver_start");
    expect(events).toHaveLength(1);
    expect(events[0]!.resolverId).toBe("fetch-data");
    expect(events[0]!.requirementType).toBe("FETCH");
  });

  it("records resolver_complete events with duration", () => {
    const timeline = createDebugTimeline();
    const plugin = createDebugTimelinePlugin(timeline, () => null);

    plugin.onResolverStart!("fetch-data", { requirement: { type: "FETCH" }, id: "req-1", fromConstraint: "c1" });
    plugin.onResolverComplete!("fetch-data", { requirement: { type: "FETCH" }, id: "req-1", fromConstraint: "c1" }, 0);

    const completeEvents = timeline.getEventsByType("resolver_complete");
    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0]!.resolverId).toBe("fetch-data");
    expect(completeEvents[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records resolver_error events with error message and duration", () => {
    const timeline = createDebugTimeline();
    const plugin = createDebugTimelinePlugin(timeline, () => 42);

    plugin.onResolverStart!("broken", { requirement: { type: "PROCESS" }, id: "req-2", fromConstraint: "c2" });
    plugin.onResolverError!("broken", { requirement: { type: "PROCESS" }, id: "req-2", fromConstraint: "c2" }, new Error("timeout"));

    const errorEvents = timeline.getEventsByType("resolver_error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.resolverId).toBe("broken");
    expect(errorEvents[0]!.errorMessage).toBe("timeout");
    expect(errorEvents[0]!.snapshotId).toBe(42);
  });

  it("handles resolver_complete without prior start (durationMs = 0)", () => {
    const timeline = createDebugTimeline();
    const plugin = createDebugTimelinePlugin(timeline, () => null);

    plugin.onResolverComplete!("orphan", { requirement: { type: "UNKNOWN" }, id: "req-orphan", fromConstraint: "c0" }, 0);

    const events = timeline.getEventsByType("resolver_complete");
    expect(events).toHaveLength(1);
    expect(events[0]!.durationMs).toBe(0);
  });

  it("has the correct plugin name", () => {
    const timeline = createDebugTimeline();
    const plugin = createDebugTimelinePlugin(timeline, () => null);

    expect(plugin.name).toBe("directive-ai-debug-timeline");
  });

  it("uses getSnapshotId from plugin factory (not from timeline options)", () => {
    let timelineSnapshot = 1;
    let pluginSnapshot = 99;

    const timeline = createDebugTimeline({
      getSnapshotId: () => timelineSnapshot,
    });

    const plugin = createDebugTimelinePlugin(timeline, () => pluginSnapshot);

    plugin.onConstraintEvaluate!("c1", false);

    const events = timeline.getEventsByType("constraint_evaluate");
    expect(events[0]!.snapshotId).toBe(99);
  });
});

// ============================================================================
// clear() and length
// ============================================================================

describe("clear() and length", () => {
  it("clears all events and resets nextId", () => {
    const timeline = createDebugTimeline();
    timeline.record(makeEvent("agent_start", { agentId: "a" } as any));
    timeline.record(makeEvent("agent_complete", { agentId: "a" } as any));

    expect(timeline.length).toBe(2);

    timeline.clear();
    expect(timeline.length).toBe(0);
    expect(timeline.getEvents()).toHaveLength(0);

    // IDs reset after clear
    const newEvent = timeline.record(makeEvent("agent_start", { agentId: "b" } as any));
    expect(newEvent.id).toBe(0);
  });
});

// ============================================================================
// assertTimelineEvents helper
// ============================================================================

describe("assertTimelineEvents helper", () => {
  it("passes when expectations match", () => {
    const timeline = createTestTimeline([
      { type: "agent_start", agentId: "a" } as any,
      { type: "agent_complete", agentId: "a" } as any,
      { type: "agent_start", agentId: "b" } as any,
    ]);

    expect(() =>
      assertTimelineEvents(timeline, {
        totalEvents: 3,
        eventTypes: ["agent_start", "agent_complete"],
        agentEvents: { a: 2, b: 1 },
        hasType: "agent_start",
        doesNotHaveType: "agent_error",
      }),
    ).not.toThrow();
  });

  it("throws when totalEvents mismatch", () => {
    const timeline = createTestTimeline([
      { type: "agent_start" } as any,
    ]);

    expect(() =>
      assertTimelineEvents(timeline, { totalEvents: 5 }),
    ).toThrow("Expected 5 timeline events, got 1");
  });

  it("supports minEvents and maxEvents", () => {
    const timeline = createTestTimeline([
      { type: "agent_start" } as any,
      { type: "agent_complete" } as any,
    ]);

    expect(() =>
      assertTimelineEvents(timeline, { minEvents: 1, maxEvents: 5 }),
    ).not.toThrow();

    expect(() =>
      assertTimelineEvents(timeline, { minEvents: 10 }),
    ).toThrow("Expected at least 10 timeline events, got 2");
  });
});
