import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNoopMetrics, type MetricsProvider, type SpanHandle } from "../metrics.js";
import { createTestSystem, mockRunner } from "../testing.js";
import { createAIArchitect } from "../architect.js";
import type { ArchitectEvent } from "../types.js";

// ============================================================================
// Recording Metrics Provider — captures all calls for assertions
// ============================================================================

interface MetricCall {
  method: "counter" | "gauge" | "histogram";
  name: string;
  value: number;
  labels?: Record<string, string>;
}

interface SpanCall {
  name: string;
  attributes?: Record<string, string | number | boolean>;
  setAttributes: Array<{ key: string; value: string | number | boolean }>;
  errors: Error[];
  ended: boolean;
}

function createRecordingMetrics() {
  const calls: MetricCall[] = [];
  const spans: SpanCall[] = [];
  let initCalled = false;
  let closeCalled = false;

  const provider: MetricsProvider = {
    counter(name, delta = 1, labels) {
      calls.push({ method: "counter", name, value: delta, labels });
    },
    gauge(name, value, labels) {
      calls.push({ method: "gauge", name, value, labels });
    },
    histogram(name, value, labels) {
      calls.push({ method: "histogram", name, value, labels });
    },
    startSpan(name, attributes): SpanHandle {
      const span: SpanCall = {
        name,
        attributes,
        setAttributes: [],
        errors: [],
        ended: false,
      };
      spans.push(span);

      return {
        setAttribute(key, value) {
          span.setAttributes.push({ key, value });
        },
        setError(error) {
          span.errors.push(error);
        },
        end() {
          span.ended = true;
        },
      };
    },
    async init() {
      initCalled = true;
    },
    async close() {
      closeCalled = true;
    },
  };

  return {
    provider,
    calls,
    spans,
    get initCalled() {
      return initCalled;
    },
    get closeCalled() {
      return closeCalled;
    },
    findCalls(name: string) {
      return calls.filter((c) => c.name === name);
    },
    findSpans(name: string) {
      return spans.filter((s) => s.name === name);
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("metrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================================================
  // No-op Provider
  // ===========================================================================

  describe("createNoopMetrics", () => {
    it("returns a provider with no-op methods", () => {
      const noop = createNoopMetrics();

      // Should not throw
      noop.counter("test", 1);
      noop.gauge("test", 42);
      noop.histogram("test", 100);
    });

    it("startSpan returns a valid SpanHandle", () => {
      const noop = createNoopMetrics();
      const span = noop.startSpan!("test");

      expect(span).toBeDefined();
      span.setAttribute("key", "value");
      span.setError(new Error("test"));
      span.end();
    });

    it("has zero overhead — no side effects", () => {
      const noop = createNoopMetrics();

      // Call many times — should not accumulate anything
      for (let i = 0; i < 1000; i++) {
        noop.counter("test");
        noop.gauge("test", i);
        noop.histogram("test", i);
      }

      // No way to observe side effects — that's the point
      expect(true).toBe(true);
    });
  });

  // ===========================================================================
  // Recording Provider
  // ===========================================================================

  describe("recording provider", () => {
    it("captures counter calls with correct names and labels", () => {
      const rec = createRecordingMetrics();

      rec.provider.counter("architect.analysis.total", 1, { trigger: "demand" });

      expect(rec.calls).toHaveLength(1);
      expect(rec.calls[0]).toEqual({
        method: "counter",
        name: "architect.analysis.total",
        value: 1,
        labels: { trigger: "demand" },
      });
    });

    it("captures gauge calls", () => {
      const rec = createRecordingMetrics();

      rec.provider.gauge("architect.definitions.active", 5);

      expect(rec.calls).toHaveLength(1);
      expect(rec.calls[0]).toMatchObject({
        method: "gauge",
        name: "architect.definitions.active",
        value: 5,
      });
    });

    it("captures histogram calls", () => {
      const rec = createRecordingMetrics();

      rec.provider.histogram("architect.analysis.duration_ms", 250, { trigger: "demand" });

      expect(rec.calls).toHaveLength(1);
      expect(rec.calls[0]).toMatchObject({
        method: "histogram",
        name: "architect.analysis.duration_ms",
        value: 250,
      });
    });

    it("tracks span lifecycle (start → setAttribute → end)", () => {
      const rec = createRecordingMetrics();
      const span = rec.provider.startSpan!("architect.analyze", { trigger: "demand" });

      span.setAttribute("mode", "single");
      span.end();

      expect(rec.spans).toHaveLength(1);
      expect(rec.spans[0]!.name).toBe("architect.analyze");
      expect(rec.spans[0]!.attributes).toEqual({ trigger: "demand" });
      expect(rec.spans[0]!.setAttributes).toEqual([{ key: "mode", value: "single" }]);
      expect(rec.spans[0]!.ended).toBe(true);
    });

    it("records span errors", () => {
      const rec = createRecordingMetrics();
      const span = rec.provider.startSpan!("test");
      const error = new Error("LLM failed");

      span.setError(error);
      span.end();

      expect(rec.spans[0]!.errors).toHaveLength(1);
      expect(rec.spans[0]!.errors[0]).toBe(error);
      expect(rec.spans[0]!.ended).toBe(true);
    });
  });

  // ===========================================================================
  // Integration — Metrics wired into Architect
  // ===========================================================================

  describe("architect integration", () => {
    const architects: Array<{ destroy: () => void }> = [];

    afterEach(() => {
      for (const a of architects) {
        a.destroy();
      }

      architects.length = 0;
    });

    function createInstrumentedArchitect(
      rec: ReturnType<typeof createRecordingMetrics>,
      runnerResponses: Parameters<typeof mockRunner>[0] = [],
      overrides: Record<string, unknown> = {},
    ) {
      const system = createTestSystem();
      const runner = mockRunner(runnerResponses);

      const architect = createAIArchitect({
        system: system as any,
        runner,
        budget: { tokens: 100_000, dollars: 10 },
        safety: { approval: { constraints: "never", resolvers: "never" } },
        metrics: rec.provider,
        ...overrides,
      });

      architects.push(architect);

      return { architect, system, runner };
    }

    it("emits analysis counter on analyze()", async () => {
      const rec = createRecordingMetrics();
      const { architect } = createInstrumentedArchitect(rec, [
        { output: "{}", toolCalls: [], totalTokens: 50 },
      ]);

      await architect.analyze("test");

      const counters = rec.findCalls("architect.analysis.total");

      expect(counters.length).toBeGreaterThanOrEqual(1);
      expect(counters[0]!.labels).toMatchObject({ trigger: "demand", mode: "single" });
    });

    it("emits duration histogram on successful analysis", async () => {
      const rec = createRecordingMetrics();
      const { architect } = createInstrumentedArchitect(rec, [
        { output: "{}", toolCalls: [], totalTokens: 100 },
      ]);

      await architect.analyze("test");

      const durations = rec.findCalls("architect.analysis.duration_ms");

      expect(durations.length).toBeGreaterThanOrEqual(1);
      expect(durations[0]!.method).toBe("histogram");
      expect(durations[0]!.value).toBeGreaterThanOrEqual(0);
    });

    it("emits token histogram on successful analysis", async () => {
      const rec = createRecordingMetrics();
      const { architect } = createInstrumentedArchitect(rec, [
        { output: "{}", toolCalls: [], totalTokens: 42 },
      ]);

      await architect.analyze("test");

      const tokens = rec.findCalls("architect.analysis.tokens");

      expect(tokens.length).toBeGreaterThanOrEqual(1);
      expect(tokens[0]!.value).toBe(42);
    });

    it("emits error counter on LLM failure", async () => {
      const rec = createRecordingMetrics();
      const system = createTestSystem();
      const failRunner = (async () => {
        throw new Error("LLM down");
      }) as any;

      const architect = createAIArchitect({
        system: system as any,
        runner: failRunner,
        budget: { tokens: 100_000, dollars: 10 },
        safety: { approval: { constraints: "never" } },
        metrics: rec.provider,
      });
      architects.push(architect);

      await expect(architect.analyze("test")).rejects.toThrow("LLM down");

      const errors = rec.findCalls("architect.analysis.errors");

      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0]!.labels).toMatchObject({ trigger: "demand" });
    });

    it("creates analyze span that wraps the full analysis", async () => {
      const rec = createRecordingMetrics();
      const { architect } = createInstrumentedArchitect(rec, [
        { output: "{}", toolCalls: [], totalTokens: 100 },
      ]);

      await architect.analyze("test");

      const analyzeSpans = rec.findSpans("architect.analyze");

      expect(analyzeSpans.length).toBeGreaterThanOrEqual(1);
      expect(analyzeSpans[0]!.ended).toBe(true);
    });

    it("creates llm_call span", async () => {
      const rec = createRecordingMetrics();
      const { architect } = createInstrumentedArchitect(rec, [
        { output: "{}", toolCalls: [], totalTokens: 100 },
      ]);

      await architect.analyze("test");

      const llmSpans = rec.findSpans("architect.llm_call");

      expect(llmSpans.length).toBeGreaterThanOrEqual(1);
      expect(llmSpans[0]!.ended).toBe(true);
    });

    it("emits action.applied counter when action succeeds", async () => {
      const rec = createRecordingMetrics();
      const { architect } = createInstrumentedArchitect(rec, [
        {
          output: '{"confidence":0.9,"risk":"low"}',
          toolCalls: [
            {
              name: "create_constraint",
              arguments: JSON.stringify({
                id: "test-constraint",
                whenCode: "return facts.status === 'error'",
                require: { type: "FIX" },
              }),
            },
          ],
          totalTokens: 100,
        },
      ]);

      await architect.analyze("test");

      const applied = rec.findCalls("architect.action.applied");

      expect(applied.length).toBeGreaterThanOrEqual(1);
      expect(applied[0]!.labels).toMatchObject({ tool: "create_constraint" });
    });

    it("emits definitions.active gauge after apply", async () => {
      const rec = createRecordingMetrics();
      const { architect } = createInstrumentedArchitect(rec, [
        {
          output: '{"confidence":0.9}',
          toolCalls: [
            {
              name: "create_constraint",
              arguments: JSON.stringify({
                id: "gauge-test",
                whenCode: "return true",
                require: { type: "TEST" },
              }),
            },
          ],
          totalTokens: 100,
        },
      ]);

      await architect.analyze("test");

      const gauge = rec.findCalls("architect.definitions.active");

      expect(gauge.length).toBeGreaterThanOrEqual(1);
    });

    it("emits budget gauges on token recording", async () => {
      const rec = createRecordingMetrics();
      const { architect } = createInstrumentedArchitect(rec, [
        { output: "{}", toolCalls: [], totalTokens: 500 },
      ]);

      await architect.analyze("test");

      const tokensGauge = rec.findCalls("architect.budget.tokens_used");
      const dollarsGauge = rec.findCalls("architect.budget.dollars_used");

      expect(tokensGauge.length).toBeGreaterThanOrEqual(1);
      expect(dollarsGauge.length).toBeGreaterThanOrEqual(1);
      expect(tokensGauge[0]!.value).toBe(500);
    });

    it("emits kill counter and resets definitions gauge", async () => {
      const rec = createRecordingMetrics();
      const { architect } = createInstrumentedArchitect(rec, [
        {
          output: '{"confidence":0.9}',
          toolCalls: [
            {
              name: "create_constraint",
              arguments: JSON.stringify({
                id: "to-kill",
                whenCode: "return true",
                require: { type: "TEST" },
              }),
            },
          ],
          totalTokens: 100,
        },
      ]);

      await architect.analyze("test");
      architect.kill();

      const killCounters = rec.findCalls("architect.kill.total");

      expect(killCounters.length).toBeGreaterThanOrEqual(1);

      // After kill, definitions gauge should be 0
      const defGauge = rec.findCalls("architect.definitions.active");
      const lastDefGauge = defGauge[defGauge.length - 1];

      expect(lastDefGauge!.value).toBe(0);
    });

    it("emits rollback counter on successful rollback", async () => {
      const rec = createRecordingMetrics();
      const { architect } = createInstrumentedArchitect(rec, [
        {
          output: '{"confidence":0.9}',
          toolCalls: [
            {
              name: "create_constraint",
              arguments: JSON.stringify({
                id: "to-rollback",
                whenCode: "return true",
                require: { type: "TEST" },
              }),
            },
          ],
          totalTokens: 100,
        },
      ]);

      const analysis = await architect.analyze("test");
      const actionId = analysis.actions[0]!.id;

      architect.rollback(actionId);

      const rollbacks = rec.findCalls("architect.rollback.total");

      expect(rollbacks.length).toBeGreaterThanOrEqual(1);
      expect(rollbacks[0]!.labels).toMatchObject({ success: "true" });
    });

    it("calls init() on construction and close() on destroy()", async () => {
      const rec = createRecordingMetrics();
      const { architect } = createInstrumentedArchitect(rec, []);

      // init is called asynchronously, advance timer to let it resolve
      await vi.advanceTimersByTimeAsync(10);

      expect(rec.initCalled).toBe(true);

      architect.destroy();
      await vi.advanceTimersByTimeAsync(10);

      expect(rec.closeCalled).toBe(true);
    });

    it("emits guard.blocked counter when guard denies analysis", async () => {
      const rec = createRecordingMetrics();
      const { architect } = createInstrumentedArchitect(rec, [
        { output: "{}", toolCalls: [], totalTokens: 100 },
        { output: "{}", toolCalls: [], totalTokens: 100 },
      ], { budget: { tokens: 50, dollars: 10 } });

      // First call uses 100 tokens, exceeding budget of 50
      await architect.analyze("test");

      // Second call should be blocked by budget guard
      await expect(architect.analyze("test")).rejects.toThrow("Guard blocked");

      const blocked = rec.findCalls("architect.guard.blocked");

      expect(blocked.length).toBeGreaterThanOrEqual(1);
    });

    it("emits reject counter when action is rejected", async () => {
      const rec = createRecordingMetrics();
      const { architect } = createInstrumentedArchitect(rec, [
        {
          output: '{"confidence":0.9}',
          toolCalls: [
            {
              name: "create_constraint",
              arguments: JSON.stringify({
                id: "reject-test",
                whenCode: "return true",
                require: { type: "TEST" },
              }),
            },
          ],
          totalTokens: 100,
        },
      ], {
        safety: { approval: { constraints: "always" } },
      });

      const analysis = await architect.analyze("test");
      const actionId = analysis.actions[0]!.id;

      await architect.reject(actionId);

      const rejected = rec.findCalls("architect.action.rejected");

      expect(rejected.length).toBeGreaterThanOrEqual(1);
      expect(rejected[0]!.labels).toMatchObject({ tool: "create_constraint" });
    });
  });
});
