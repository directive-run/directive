import { describe, expect, it, vi } from "vitest";
import { createDebugTimeline } from "../debug-timeline.js";
import type { DebugTimeline } from "../debug-timeline.js";
import {
  type OtelPlugin,
  OtelStatusCode,
  type SpanData,
  createOtelPlugin,
} from "../otel.js";

// ============================================================================
// Test helpers
// ============================================================================

function setup(): { timeline: DebugTimeline; otel: OtelPlugin } {
  const timeline = createDebugTimeline({ maxEvents: 500 });
  const otel = createOtelPlugin({ serviceName: "test-app" });
  otel.attach(timeline);

  return { timeline, otel };
}

function recordAgentRun(
  timeline: DebugTimeline,
  agentId: string,
  opts: { durationMs?: number; totalTokens?: number; error?: string } = {},
): void {
  timeline.record({
    type: "agent_start",
    timestamp: Date.now(),
    agentId,
    inputLength: 50,
    snapshotId: null,
  });

  if (opts.error) {
    timeline.record({
      type: "agent_error",
      timestamp: Date.now(),
      agentId,
      errorMessage: opts.error,
      durationMs: opts.durationMs ?? 100,
      snapshotId: null,
    });
  } else {
    timeline.record({
      type: "agent_complete",
      timestamp: Date.now(),
      agentId,
      outputLength: 200,
      totalTokens: opts.totalTokens ?? 150,
      durationMs: opts.durationMs ?? 100,
      snapshotId: null,
    });
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("createOtelPlugin", () => {
  it("creates plugin with built-in collector", () => {
    const otel = createOtelPlugin({ serviceName: "test" });

    expect(otel.getSpans()).toEqual([]);
    expect(otel.getTracer()).toBeDefined();
    expect(otel.getActiveSpanCount()).toBe(0);
  });

  it("collects spans from agent runs", () => {
    const { timeline, otel } = setup();

    recordAgentRun(timeline, "researcher");

    const spans = otel.getSpans();

    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("directive.ai.agent.run");
    expect(spans[0]!.attributes["directive.agent.name"]).toBe("researcher");
    expect(spans[0]!.attributes["directive.agent.total_tokens"]).toBe(150);
    expect(spans[0]!.status.code).toBe(OtelStatusCode.OK);
  });

  it("records error spans for failed agents", () => {
    const { timeline, otel } = setup();

    recordAgentRun(timeline, "flaky", { error: "Network timeout" });

    const spans = otel.getSpans();

    expect(spans).toHaveLength(1);
    expect(spans[0]!.status.code).toBe(OtelStatusCode.ERROR);
    expect(spans[0]!.status.message).toBe("Network timeout");
    expect(spans[0]!.attributes["directive.agent.error"]).toBe(
      "Network timeout",
    );
  });

  it("records guardrail spans", () => {
    const { timeline, otel } = setup();

    timeline.record({
      type: "guardrail_check",
      timestamp: Date.now(),
      guardrailName: "pii_check",
      guardrailType: "output",
      passed: true,
      durationMs: 5,
      snapshotId: null,
    });

    const spans = otel.getSpans();

    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("directive.ai.guardrail.check");
    expect(spans[0]!.attributes["directive.guardrail.name"]).toBe("pii_check");
    expect(spans[0]!.attributes["directive.guardrail.passed"]).toBe(true);
  });

  it("records failed guardrail with reason", () => {
    const { timeline, otel } = setup();

    timeline.record({
      type: "guardrail_check",
      timestamp: Date.now(),
      guardrailName: "safety",
      guardrailType: "output",
      passed: false,
      reason: "PII detected",
      durationMs: 10,
      snapshotId: null,
    });

    const spans = otel.getSpans();

    expect(spans[0]!.status.code).toBe(OtelStatusCode.ERROR);
    expect(spans[0]!.attributes["directive.guardrail.reason"]).toBe(
      "PII detected",
    );
  });

  it("records resolver spans", () => {
    const { timeline, otel } = setup();

    timeline.record({
      type: "resolver_start",
      timestamp: Date.now(),
      resolverId: "run_agent",
      requirementType: "RUN_AGENT",
      snapshotId: null,
    });

    timeline.record({
      type: "resolver_complete",
      timestamp: Date.now(),
      resolverId: "run_agent",
      durationMs: 500,
      snapshotId: null,
    });

    const spans = otel.getSpans();

    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("directive.ai.resolver.execute");
    expect(spans[0]!.attributes["directive.resolver.id"]).toBe("run_agent");
  });

  it("records resolver error spans", () => {
    const { timeline, otel } = setup();

    timeline.record({
      type: "resolver_start",
      timestamp: Date.now(),
      resolverId: "broken",
      requirementType: "BROKEN_TYPE",
      snapshotId: null,
    });

    timeline.record({
      type: "resolver_error",
      timestamp: Date.now(),
      resolverId: "broken",
      errorMessage: "Resolution failed",
      durationMs: 200,
      snapshotId: null,
    });

    const spans = otel.getSpans();

    expect(spans).toHaveLength(1);
    expect(spans[0]!.status.code).toBe(OtelStatusCode.ERROR);
    expect(spans[0]!.attributes["directive.resolver.error"]).toBe(
      "Resolution failed",
    );
  });

  it("records pattern spans", () => {
    const { timeline, otel } = setup();

    timeline.record({
      type: "pattern_start",
      timestamp: Date.now(),
      patternId: "dag_1",
      patternType: "dag",
      snapshotId: null,
    });

    timeline.record({
      type: "pattern_complete",
      timestamp: Date.now(),
      patternId: "dag_1",
      patternType: "dag",
      durationMs: 2000,
      snapshotId: null,
    });

    const spans = otel.getSpans();

    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("directive.ai.pattern.dag");
    expect(spans[0]!.attributes["directive.pattern.type"]).toBe("dag");
  });

  it("records constraint events on parent agent span", () => {
    const { timeline, otel } = setup();

    // Start agent span
    timeline.record({
      type: "agent_start",
      timestamp: Date.now(),
      agentId: "writer",
      inputLength: 100,
      snapshotId: null,
    });

    // Constraint evaluation (should be attached to agent span)
    timeline.record({
      type: "constraint_evaluate",
      timestamp: Date.now(),
      agentId: "writer",
      constraintId: "needs_review",
      fired: true,
      snapshotId: null,
    });

    // Complete agent
    timeline.record({
      type: "agent_complete",
      timestamp: Date.now(),
      agentId: "writer",
      outputLength: 200,
      totalTokens: 100,
      durationMs: 500,
      snapshotId: null,
    });

    const spans = otel.getSpans();

    // Only 1 span (agent run) — constraint is an event on it
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("directive.ai.agent.run");
  });

  it("creates standalone constraint span when no parent agent", () => {
    const { timeline, otel } = setup();

    timeline.record({
      type: "constraint_evaluate",
      timestamp: Date.now(),
      constraintId: "global_constraint",
      fired: false,
      snapshotId: null,
    });

    const spans = otel.getSpans();

    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("directive.ai.constraint.evaluate");
  });

  it("supports custom span prefix", () => {
    const timeline = createDebugTimeline({ maxEvents: 500 });
    const otel = createOtelPlugin({ serviceName: "test", spanPrefix: "myapp" });
    otel.attach(timeline);

    recordAgentRun(timeline, "agent");

    expect(otel.getSpans()[0]!.name).toBe("myapp.agent.run");
  });

  it("fires onSpanEnd callback", () => {
    const onSpanEnd = vi.fn();
    const timeline = createDebugTimeline({ maxEvents: 500 });
    const otel = createOtelPlugin({ serviceName: "test", onSpanEnd });
    otel.attach(timeline);

    recordAgentRun(timeline, "agent");

    expect(onSpanEnd).toHaveBeenCalledTimes(1);
    expect(onSpanEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "directive.ai.agent.run",
      }),
    );
  });

  it("filters events via instrumentEvents", () => {
    const timeline = createDebugTimeline({ maxEvents: 500 });
    const otel = createOtelPlugin({
      serviceName: "test",
      instrumentEvents: new Set(["guardrail_check"]),
    });
    otel.attach(timeline);

    // This should be skipped
    recordAgentRun(timeline, "agent");

    // This should be recorded
    timeline.record({
      type: "guardrail_check",
      timestamp: Date.now(),
      guardrailName: "safety",
      guardrailType: "output",
      passed: true,
      durationMs: 5,
      snapshotId: null,
    });

    const spans = otel.getSpans();

    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toContain("guardrail");
  });

  it("clearSpans empties the collection", () => {
    const { timeline, otel } = setup();

    recordAgentRun(timeline, "agent");

    expect(otel.getSpans()).toHaveLength(1);

    otel.clearSpans();

    expect(otel.getSpans()).toHaveLength(0);
  });

  it("supports custom tracer", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mockSpan = {
      setAttribute: vi.fn(),
      addEvent: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
    const mockTracer = {
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };

    const timeline = createDebugTimeline({ maxEvents: 500 });
    const otel = createOtelPlugin({ serviceName: "test", tracer: mockTracer });
    otel.attach(timeline);

    recordAgentRun(timeline, "agent");

    expect(mockTracer.startSpan).toHaveBeenCalledWith(
      "directive.ai.agent.run",
      expect.any(Object),
    );
    expect(mockSpan.setAttribute).toHaveBeenCalled();
    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: OtelStatusCode.OK,
    });
    expect(mockSpan.end).toHaveBeenCalled();

    // External tracer — getSpans returns empty (no built-in collector)
    expect(otel.getSpans()).toEqual([]);

    warnSpy.mockRestore();
  });

  it("attach returns unsubscribe function", () => {
    const timeline = createDebugTimeline({ maxEvents: 500 });
    const otel = createOtelPlugin({ serviceName: "test" });
    const unsub = otel.attach(timeline);

    recordAgentRun(timeline, "before_unsub");

    expect(otel.getSpans()).toHaveLength(1);

    unsub();

    recordAgentRun(timeline, "after_unsub");

    // No new spans after unsubscribe
    expect(otel.getSpans()).toHaveLength(1);
  });

  it("handles multiple concurrent agent runs", () => {
    const { timeline, otel } = setup();

    // Start two agents
    timeline.record({
      type: "agent_start",
      timestamp: Date.now(),
      agentId: "a",
      inputLength: 50,
      snapshotId: null,
    });
    timeline.record({
      type: "agent_start",
      timestamp: Date.now(),
      agentId: "b",
      inputLength: 60,
      snapshotId: null,
    });

    // Complete in reverse order
    timeline.record({
      type: "agent_complete",
      timestamp: Date.now(),
      agentId: "b",
      outputLength: 200,
      totalTokens: 100,
      durationMs: 300,
      snapshotId: null,
    });
    timeline.record({
      type: "agent_complete",
      timestamp: Date.now(),
      agentId: "a",
      outputLength: 150,
      totalTokens: 80,
      durationMs: 500,
      snapshotId: null,
    });

    const spans = otel.getSpans();

    expect(spans).toHaveLength(2);
    const names = spans.map((s) => s.attributes["directive.agent.name"]);

    expect(names).toContain("a");
    expect(names).toContain("b");
  });

  it("records other events as span events on parent", () => {
    const { timeline, otel } = setup();

    timeline.record({
      type: "agent_start",
      timestamp: Date.now(),
      agentId: "worker",
      inputLength: 50,
      snapshotId: null,
    });

    // A breakpoint event (no dedicated handler — should attach to parent)
    timeline.record({
      type: "breakpoint_hit",
      timestamp: Date.now(),
      agentId: "worker",
      breakpointId: "bp1",
      breakpointType: "before_run",
      snapshotId: null,
    });

    timeline.record({
      type: "agent_complete",
      timestamp: Date.now(),
      agentId: "worker",
      outputLength: 100,
      totalTokens: 50,
      durationMs: 200,
      snapshotId: null,
    });

    const spans = otel.getSpans();

    expect(spans).toHaveLength(1);
    // The breakpoint event was attached to the agent span
  });

  it("service name is set on all spans", () => {
    const { timeline, otel } = setup();

    recordAgentRun(timeline, "agent1");

    timeline.record({
      type: "guardrail_check",
      timestamp: Date.now(),
      guardrailName: "check",
      guardrailType: "input",
      passed: true,
      durationMs: 1,
      snapshotId: null,
    });

    for (const span of otel.getSpans()) {
      expect(span.attributes["directive.service"]).toBe("test-app");
    }
  });

  // ============================================================================
  // New tests for AE review fixes
  // ============================================================================

  it("spans have traceId and spanId", () => {
    const { timeline, otel } = setup();

    recordAgentRun(timeline, "agent");

    const spans = otel.getSpans();

    expect(spans[0]!.traceId).toBeDefined();
    expect(spans[0]!.traceId.length).toBeGreaterThan(0);
    expect(spans[0]!.spanId).toBeDefined();
    expect(spans[0]!.spanId.length).toBeGreaterThan(0);
  });

  it("OtelStatusCode is a const object (not enum)", () => {
    // Verify the values are the same as OTEL spec
    expect(OtelStatusCode.UNSET).toBe(0);
    expect(OtelStatusCode.OK).toBe(1);
    expect(OtelStatusCode.ERROR).toBe(2);
  });

  it("getActiveSpanCount tracks in-flight spans", () => {
    const { timeline, otel } = setup();

    expect(otel.getActiveSpanCount()).toBe(0);

    timeline.record({
      type: "agent_start",
      timestamp: Date.now(),
      agentId: "tracked",
      inputLength: 50,
      snapshotId: null,
    });

    expect(otel.getActiveSpanCount()).toBe(1);

    timeline.record({
      type: "agent_complete",
      timestamp: Date.now(),
      agentId: "tracked",
      outputLength: 100,
      totalTokens: 50,
      durationMs: 100,
      snapshotId: null,
    });

    expect(otel.getActiveSpanCount()).toBe(0);
  });

  it("detach cleans up active spans", () => {
    const timeline = createDebugTimeline({ maxEvents: 500 });
    const otel = createOtelPlugin({ serviceName: "test" });
    const unsub = otel.attach(timeline);

    // Start an agent but don't complete it
    timeline.record({
      type: "agent_start",
      timestamp: Date.now(),
      agentId: "orphan",
      inputLength: 50,
      snapshotId: null,
    });

    expect(otel.getActiveSpanCount()).toBe(1);

    // Detach should clean up
    unsub();

    expect(otel.getActiveSpanCount()).toBe(0);
    // The orphaned span should be ended with error status
    const spans = otel.getSpans();

    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes["directive.detached"]).toBe(true);
  });

  it("uses GenAI semantic conventions on agent spans", () => {
    const { timeline, otel } = setup();

    recordAgentRun(timeline, "researcher", { totalTokens: 200 });

    const spans = otel.getSpans();

    expect(spans[0]!.attributes["gen_ai.operation.name"]).toBe("agent.run");
    expect(spans[0]!.attributes["gen_ai.agent.name"]).toBe("researcher");
    expect(spans[0]!.attributes["gen_ai.usage.total_tokens"]).toBe(200);
  });

  it("uses GenAI semantic conventions on error agent spans", () => {
    const { timeline, otel } = setup();

    recordAgentRun(timeline, "flaky", { error: "timeout" });

    const spans = otel.getSpans();

    expect(spans[0]!.attributes["gen_ai.error.message"]).toBe("timeout");
  });

  it("uses GenAI semantic conventions on guardrail spans", () => {
    const { timeline, otel } = setup();

    timeline.record({
      type: "guardrail_check",
      timestamp: Date.now(),
      guardrailName: "pii",
      guardrailType: "input",
      passed: true,
      durationMs: 5,
      snapshotId: null,
    });

    const spans = otel.getSpans();

    expect(spans[0]!.attributes["gen_ai.guardrail.name"]).toBe("pii");
    expect(spans[0]!.attributes["gen_ai.guardrail.type"]).toBe("input");
    expect(spans[0]!.attributes["gen_ai.guardrail.passed"]).toBe(true);
  });

  it("handles unique span keys for same agent ID running twice", () => {
    const { timeline, otel } = setup();

    // First run
    recordAgentRun(timeline, "worker");

    // Second run of the same agent
    recordAgentRun(timeline, "worker");

    const spans = otel.getSpans();

    // Both runs should produce separate spans
    expect(spans).toHaveLength(2);
    expect(spans[0]!.spanId).not.toBe(spans[1]!.spanId);
  });

  it("parent-child: agent spans are children of pattern spans", () => {
    const { timeline, otel } = setup();

    // Start a pattern
    timeline.record({
      type: "pattern_start",
      timestamp: Date.now(),
      patternId: "dag_1",
      patternType: "dag",
      snapshotId: null,
    });

    // Agent runs within the pattern
    recordAgentRun(timeline, "child_agent");

    // Complete the pattern
    timeline.record({
      type: "pattern_complete",
      timestamp: Date.now(),
      patternId: "dag_1",
      patternType: "dag",
      durationMs: 1000,
      snapshotId: null,
    });

    const spans = otel.getSpans();

    // Should have 2 spans: agent + pattern
    expect(spans).toHaveLength(2);

    const agentSpan = spans.find((s) => s.name.includes("agent"))!;
    const patternSpan = spans.find((s) => s.name.includes("pattern"))!;

    // Agent span should reference pattern span as parent
    expect(agentSpan.parentSpanId).toBe(patternSpan.spanId);
    // Pattern span is a root (no parent)
    expect(patternSpan.parentSpanId).toBeUndefined();
    // Both share a trace ID
    expect(agentSpan.traceId).toBe(patternSpan.traceId);
  });

  it("onSpanEnd provides meaningful data for external tracer", () => {
    const onSpanEnd = vi.fn();
    const mockSpan = {
      setAttribute: vi.fn(),
      addEvent: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
    const mockTracer = {
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };

    const timeline = createDebugTimeline({ maxEvents: 500 });
    const otel = createOtelPlugin({
      serviceName: "test",
      tracer: mockTracer,
      onSpanEnd,
    });
    otel.attach(timeline);

    recordAgentRun(timeline, "agent");

    expect(onSpanEnd).toHaveBeenCalledTimes(1);
    const spanData = onSpanEnd.mock.calls[0]![0] as SpanData;

    // Should have meaningful data, not just a dummy
    expect(spanData.name).toBe("directive.ai.agent.run");
    expect(spanData.traceId).toBeDefined();
    expect(spanData.spanId).toBeDefined();
    expect(spanData.attributes["directive.agent.name"]).toBe("agent");
  });

  // ==========================================================================
  // Nested patterns use stack (not single variable)
  // ==========================================================================

  it("nested patterns: inner agents get innermost pattern as parent", () => {
    const { timeline, otel } = setup();

    // Outer pattern
    timeline.record({
      type: "pattern_start",
      timestamp: Date.now(),
      patternId: "outer",
      patternType: "sequential",
      snapshotId: null,
    });

    // Inner pattern
    timeline.record({
      type: "pattern_start",
      timestamp: Date.now(),
      patternId: "inner",
      patternType: "parallel",
      snapshotId: null,
    });

    // Agent inside inner pattern
    recordAgentRun(timeline, "nested_agent");

    // Complete inner pattern
    timeline.record({
      type: "pattern_complete",
      timestamp: Date.now(),
      patternId: "inner",
      patternType: "parallel",
      durationMs: 500,
      snapshotId: null,
    });

    // Complete outer pattern
    timeline.record({
      type: "pattern_complete",
      timestamp: Date.now(),
      patternId: "outer",
      patternType: "sequential",
      durationMs: 1000,
      snapshotId: null,
    });

    const spans = otel.getSpans();

    expect(spans).toHaveLength(3);

    const agentSpan = spans.find((s) => s.name.includes("agent"))!;
    const innerSpan = spans.find(
      (s) => s.attributes["directive.pattern.id"] === "inner",
    )!;
    const outerSpan = spans.find(
      (s) => s.attributes["directive.pattern.id"] === "outer",
    )!;

    // Agent's parent should be the inner (most recent) pattern
    expect(agentSpan.parentSpanId).toBe(innerSpan.spanId);
    // Inner pattern's parent should be the outer pattern
    expect(innerSpan.parentSpanId).toBe(outerSpan.spanId);
    // Outer pattern is root
    expect(outerSpan.parentSpanId).toBeUndefined();
  });

  // ==========================================================================
  // Shadow status tracking for external tracers
  // ==========================================================================

  it("external tracer shadow tracks status via setStatus calls", () => {
    const onSpanEnd = vi.fn();
    const mockSpan = {
      setAttribute: vi.fn(),
      addEvent: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
    const mockTracer = {
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };

    const timeline = createDebugTimeline({ maxEvents: 500 });
    const otel = createOtelPlugin({
      serviceName: "test",
      tracer: mockTracer,
      onSpanEnd,
    });
    otel.attach(timeline);

    recordAgentRun(timeline, "agent", { error: "something broke" });

    // External tracer should have setStatus called with error
    expect(mockSpan.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        code: OtelStatusCode.ERROR,
        message: "something broke",
      }),
    );

    // onSpanEnd should report error status in the shadow data
    expect(onSpanEnd).toHaveBeenCalledTimes(1);
    const spanData = onSpanEnd.mock.calls[0]![0] as SpanData;

    expect(spanData.status.code).toBe(OtelStatusCode.ERROR);
  });

  // ==========================================================================
  // cleanupStaleSpans fires onSpanEnd
  // ==========================================================================

  it("detach fires onSpanEnd for orphaned spans", () => {
    const onSpanEnd = vi.fn();
    const timeline = createDebugTimeline({ maxEvents: 500 });
    const otel = createOtelPlugin({ serviceName: "test", onSpanEnd });
    const unsub = otel.attach(timeline);

    // Start agent but don't complete
    timeline.record({
      type: "agent_start",
      timestamp: Date.now(),
      agentId: "orphan",
      inputLength: 50,
      snapshotId: null,
    });

    unsub();

    // onSpanEnd should have been called for the orphaned span
    expect(onSpanEnd).toHaveBeenCalledTimes(1);
    const spanData = onSpanEnd.mock.calls[0]![0] as SpanData;

    expect(spanData.attributes["directive.detached"]).toBe(true);
  });

  // ==========================================================================
  // Instance-scoped counters (separate plugin instances don't share IDs)
  // ==========================================================================

  // ==========================================================================
  // L3: Periodic stale span cleanup via setInterval
  // ==========================================================================

  it("cleans up stale spans via periodic timer", () => {
    vi.useFakeTimers();

    try {
      const timeline = createDebugTimeline({ maxEvents: 500 });
      const otel = createOtelPlugin({ serviceName: "test", spanTtlMs: 1000 });
      const unsub = otel.attach(timeline);

      // Start an agent but don't complete it
      timeline.record({
        type: "agent_start",
        timestamp: Date.now(),
        agentId: "stale_agent",
        inputLength: 50,
        snapshotId: null,
      });

      expect(otel.getActiveSpanCount()).toBe(1);

      // Advance past the TTL + one more interval tick (TTL check uses strict >)
      vi.advanceTimersByTime(2100);

      // The periodic cleanup should have fired and cleaned up the stale span
      expect(otel.getActiveSpanCount()).toBe(0);

      const spans = otel.getSpans();

      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes["directive.stale"]).toBe(true);

      unsub();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clearInterval on detach prevents further cleanup", () => {
    vi.useFakeTimers();

    try {
      const timeline = createDebugTimeline({ maxEvents: 500 });
      const otel = createOtelPlugin({ serviceName: "test", spanTtlMs: 1000 });
      const unsub = otel.attach(timeline);

      unsub();

      // After detach, advancing timers should not throw or cause issues
      vi.advanceTimersByTime(5000);

      expect(otel.getActiveSpanCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("separate plugin instances produce independent span IDs", () => {
    const timeline1 = createDebugTimeline({ maxEvents: 500 });
    const otel1 = createOtelPlugin({ serviceName: "app1" });
    otel1.attach(timeline1);

    const timeline2 = createDebugTimeline({ maxEvents: 500 });
    const otel2 = createOtelPlugin({ serviceName: "app2" });
    otel2.attach(timeline2);

    recordAgentRun(timeline1, "a");
    recordAgentRun(timeline2, "b");

    const spans1 = otel1.getSpans();
    const spans2 = otel2.getSpans();

    expect(spans1).toHaveLength(1);
    expect(spans2).toHaveLength(1);
    // IDs should be independent (not sharing a counter)
    expect(spans1[0]!.traceId).not.toBe(spans2[0]!.traceId);
  });
});
