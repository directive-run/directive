import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
	createObservability,
	createAgentMetrics,
	type ObservabilityInstance,
} from "../adapters/plugins/observability.js";

// ============================================================================
// Metrics
// ============================================================================

describe("Observability Metrics", () => {
	let obs: ObservabilityInstance;

	beforeEach(() => {
		obs = createObservability();
	});

	afterEach(async () => {
		await obs.dispose();
	});

	it("should increment a counter", () => {
		obs.incrementCounter("my.counter");
		const metric = obs.getMetric("my.counter");

		expect(metric).toBeDefined();
		expect(metric!.type).toBe("counter");
		expect(metric!.sum).toBe(1);
		expect(metric!.count).toBe(1);
	});

	it("should increment counter with custom value", () => {
		obs.incrementCounter("my.counter", {}, 5);
		obs.incrementCounter("my.counter", {}, 3);

		const metric = obs.getMetric("my.counter");
		expect(metric!.sum).toBe(8);
		expect(metric!.count).toBe(2);
	});

	it("should set a gauge", () => {
		obs.setGauge("cpu.usage", 0.75);
		const metric = obs.getMetric("cpu.usage");

		expect(metric!.type).toBe("gauge");
		expect(metric!.lastValue).toBe(0.75);
	});

	it("should observe histogram values", () => {
		obs.observeHistogram("latency", 100);
		obs.observeHistogram("latency", 200);
		obs.observeHistogram("latency", 300);

		const metric = obs.getMetric("latency");
		expect(metric!.min).toBe(100);
		expect(metric!.max).toBe(300);
		expect(metric!.avg).toBe(200);
		expect(metric!.count).toBe(3);
	});

	it("should calculate percentiles", () => {
		for (let i = 1; i <= 100; i++) {
			obs.observeHistogram("latency", i);
		}

		const metric = obs.getMetric("latency");
		expect(metric!.p50).toBe(50);
		expect(metric!.p90).toBe(90);
		expect(metric!.p99).toBe(99);
	});

	it("should not record metrics when disabled", () => {
		const disabledObs = createObservability({ metrics: { enabled: false } });
		disabledObs.incrementCounter("my.counter");
		expect(disabledObs.getMetric("my.counter")).toBeUndefined();
	});

	it("should support labels", () => {
		obs.incrementCounter("requests", { agent: "support" });
		obs.incrementCounter("requests", { agent: "billing" });

		// Each label combination is a separate metric key
		const metric = obs.getMetric("requests");
		// The metric aggregation uses name-only lookup, so both will aggregate under "requests"
		expect(metric).toBeDefined();
	});

	it("should call onMetricRecorded callback", () => {
		const callback = vi.fn();
		const obsWithCallback = createObservability({
			events: { onMetricRecorded: callback },
		});

		obsWithCallback.incrementCounter("test");
		expect(callback).toHaveBeenCalledOnce();
		expect(callback.mock.calls[0][0].name).toBe("test");
	});
});

// ============================================================================
// Tracing
// ============================================================================

describe("Observability Tracing", () => {
	let obs: ObservabilityInstance;

	beforeEach(() => {
		obs = createObservability({ tracing: { sampleRate: 1.0 } });
	});

	afterEach(async () => {
		await obs.dispose();
	});

	it("should start and end a span", () => {
		const span = obs.startSpan("agent.run");
		expect(span.spanId).toBeTruthy();
		expect(span.operationName).toBe("agent.run");

		obs.endSpan(span.spanId, "ok");

		const traces = obs.getTraces();
		expect(traces.length).toBe(1);
		expect(traces[0].duration).toBeGreaterThanOrEqual(0);
		expect(traces[0].status).toBe("ok");
	});

	it("should support parent spans", () => {
		const parent = obs.startSpan("parent-op");
		const child = obs.startSpan("child-op", parent.spanId);

		expect(child.parentSpanId).toBe(parent.spanId);
		expect(child.traceId).toBe(parent.traceId);
	});

	it("should add logs to spans", () => {
		const span = obs.startSpan("agent.run");
		obs.addSpanLog(span.spanId, "Starting work", "info");
		obs.addSpanLog(span.spanId, "Error occurred", "error");

		// Read span from active (not completed yet)
		obs.endSpan(span.spanId);
		const traces = obs.getTraces();
		expect(traces[0].logs.length).toBe(2);
		expect(traces[0].logs[0].message).toBe("Starting work");
	});

	it("should add tags to spans", () => {
		const span = obs.startSpan("agent.run");
		obs.addSpanTag(span.spanId, "agent", "support");
		obs.addSpanTag(span.spanId, "priority", 1);

		obs.endSpan(span.spanId);
		const traces = obs.getTraces();
		expect(traces[0].tags.agent).toBe("support");
		expect(traces[0].tags.priority).toBe(1);
	});

	it("should respect sample rate of 0", () => {
		const sampledObs = createObservability({ tracing: { sampleRate: 0 } });
		const span = sampledObs.startSpan("agent.run");
		expect(span.spanId).toBe("sampled-out");

		sampledObs.endSpan(span.spanId); // Should be a no-op
		expect(sampledObs.getTraces().length).toBe(0);
	});

	it("should record latency metric on span end", () => {
		const span = obs.startSpan("agent.run");
		obs.endSpan(span.spanId, "ok");

		const latencyMetric = obs.getMetric("agent.run.latency");
		expect(latencyMetric).toBeDefined();
		expect(latencyMetric!.count).toBe(1);
	});

	it("should record error metric on error span", () => {
		const span = obs.startSpan("agent.run");
		obs.endSpan(span.spanId, "error");

		const errorMetric = obs.getMetric("agent.run.errors");
		expect(errorMetric).toBeDefined();
		expect(errorMetric!.sum).toBe(1);
	});

	it("should call span lifecycle callbacks", () => {
		const onStart = vi.fn();
		const onEnd = vi.fn();
		const obsWithCallbacks = createObservability({
			events: { onSpanStart: onStart, onSpanEnd: onEnd },
		});

		const span = obsWithCallbacks.startSpan("test");
		expect(onStart).toHaveBeenCalledOnce();

		obsWithCallbacks.endSpan(span.spanId);
		expect(onEnd).toHaveBeenCalledOnce();
	});

	it("should trim old spans to maxSpans", () => {
		const smallObs = createObservability({ tracing: { maxSpans: 3 } });

		for (let i = 0; i < 5; i++) {
			const span = smallObs.startSpan(`op-${i}`);
			smallObs.endSpan(span.spanId);
		}

		expect(smallObs.getTraces().length).toBe(3);
	});
});

// ============================================================================
// Alerts
// ============================================================================

describe("Observability Alerts", () => {
	it("should trigger alert when threshold exceeded", () => {
		const onAlert = vi.fn();
		const obs = createObservability({
			alerts: [
				{ metric: "error.count", threshold: 5, action: "callback", callback: onAlert },
			],
		});

		// Alert checks lastValue > threshold, so a single increment with value > 5 triggers it
		obs.incrementCounter("error.count", {}, 6);

		expect(onAlert).toHaveBeenCalled();
	});

	it("should respect cooldown period", () => {
		const onAlert = vi.fn();
		const obs = createObservability({
			alerts: [
				{ metric: "error.count", threshold: 0, action: "callback", callback: onAlert, cooldownMs: 60000 },
			],
		});

		obs.incrementCounter("error.count");
		obs.incrementCounter("error.count");
		obs.incrementCounter("error.count");

		// Only first alert should fire due to cooldown
		expect(onAlert).toHaveBeenCalledOnce();
	});

	it("should support different operators", () => {
		const onAlert = vi.fn();
		const obs = createObservability({
			alerts: [
				{ metric: "cpu", threshold: 0.5, operator: "<", action: "callback", callback: onAlert },
			],
		});

		obs.setGauge("cpu", 0.3); // 0.3 < 0.5 → triggers
		expect(onAlert).toHaveBeenCalledOnce();
	});

	it("should record alert events", () => {
		const obs = createObservability({
			alerts: [
				{ metric: "errors", threshold: 0, action: "log" },
			],
		});

		obs.incrementCounter("errors");
		const alerts = obs.getAlerts();
		expect(alerts.length).toBe(1);
		expect(alerts[0].metric).toBe("errors");
	});
});

// ============================================================================
// Dashboard
// ============================================================================

describe("Observability Dashboard", () => {
	it("should return dashboard data", () => {
		const obs = createObservability({ serviceName: "test-service" });

		obs.incrementCounter("agent.requests", {}, 1);
		obs.incrementCounter("agent.errors", {}, 1);
		obs.observeHistogram("agent.latency", 150);

		const dashboard = obs.getDashboard();

		expect(dashboard.service.name).toBe("test-service");
		expect(dashboard.service.uptime).toBeGreaterThanOrEqual(0);
		expect(dashboard.summary.totalRequests).toBe(1);
		expect(dashboard.summary.totalErrors).toBe(1);
		expect(dashboard.summary.errorRate).toBe(1);
		expect(dashboard.summary.avgLatency).toBe(150);
	});

	it("should use custom summary metric names", () => {
		const obs = createObservability({
			summaryMetrics: {
				requests: "custom.requests",
				errors: "custom.errors",
			},
		});

		obs.incrementCounter("custom.requests", {}, 10);
		obs.incrementCounter("custom.errors", {}, 2);

		const dashboard = obs.getDashboard();
		expect(dashboard.summary.totalRequests).toBe(10);
		expect(dashboard.summary.totalErrors).toBe(2);
		expect(dashboard.summary.errorRate).toBeCloseTo(0.2);
	});
});

// ============================================================================
// Health Status
// ============================================================================

describe("Observability Health Status", () => {
	it("should report healthy when no errors", () => {
		const obs = createObservability();
		obs.incrementCounter("agent.requests", {}, 10);

		const health = obs.getHealthStatus();
		expect(health.healthy).toBe(true);
		expect(health.errorRate).toBe(0);
		expect(health.uptime).toBeGreaterThanOrEqual(0);
	});

	it("should report unhealthy when error rate > 10%", () => {
		const obs = createObservability();
		obs.incrementCounter("agent.requests", {}, 10);
		obs.incrementCounter("agent.errors", {}, 2); // 20% error rate

		const health = obs.getHealthStatus();
		expect(health.healthy).toBe(false);
		expect(health.errorRate).toBeCloseTo(0.2);
	});

	it("should use custom metric names for health", () => {
		const obs = createObservability({
			summaryMetrics: {
				requests: "my.reqs",
				errors: "my.errs",
			},
		});

		obs.incrementCounter("my.reqs", {}, 10);
		obs.incrementCounter("my.errs", {}, 5);

		const health = obs.getHealthStatus();
		expect(health.errorRate).toBe(0.5);
		expect(health.healthy).toBe(false);
	});
});

// ============================================================================
// Export / Import / Clear / Dispose
// ============================================================================

describe("Observability Lifecycle", () => {
	it("should export all data", () => {
		const obs = createObservability();
		obs.incrementCounter("test");
		const span = obs.startSpan("op");
		obs.endSpan(span.spanId);

		const data = obs.export();
		expect(data.metrics.length).toBeGreaterThan(0);
		expect(data.traces.length).toBeGreaterThan(0);
	});

	it("should clear all data", () => {
		const obs = createObservability();
		obs.incrementCounter("test");
		obs.clear();

		expect(obs.getMetric("test")).toBeUndefined();
		expect(obs.getTraces().length).toBe(0);
		expect(obs.getAlerts().length).toBe(0);
	});

	it("should dispose and flush to exporters", async () => {
		const metricsExporter = vi.fn(async () => {});
		const tracingExporter = vi.fn(async () => {});

		const obs = createObservability({
			metrics: {
				enabled: true,
				exporter: metricsExporter,
				exportInterval: 999999, // Won't fire during test
			},
			tracing: {
				enabled: true,
				exporter: tracingExporter,
			},
		});

		obs.incrementCounter("test");
		const span = obs.startSpan("op");
		obs.endSpan(span.spanId);

		await obs.dispose();

		expect(metricsExporter).toHaveBeenCalledOnce();
		expect(tracingExporter).toHaveBeenCalledOnce();
	});

	it("destroy should work as alias for dispose", async () => {
		const obs = createObservability();
		obs.incrementCounter("test");

		await obs.destroy();
		// After destroy, data should be cleared
		expect(obs.getMetric("test")).toBeUndefined();
	});
});

// ============================================================================
// Agent Metrics Helper
// ============================================================================

describe("createAgentMetrics", () => {
	it("should track agent run metrics", () => {
		const obs = createObservability();
		const metrics = createAgentMetrics(obs);

		metrics.trackRun("support", {
			success: true,
			latencyMs: 1500,
			inputTokens: 100,
			outputTokens: 500,
			cost: 0.05,
			toolCalls: 3,
		});

		expect(obs.getMetric("agent.requests")!.sum).toBe(1);
		expect(obs.getMetric("agent.latency")!.lastValue).toBe(1500);
		expect(obs.getMetric("agent.tokens")!.sum).toBe(600);
		expect(obs.getMetric("agent.cost")!.sum).toBe(0.05);
		expect(obs.getMetric("agent.tool_calls")!.sum).toBe(3);
	});

	it("should track error on failed run", () => {
		const obs = createObservability();
		const metrics = createAgentMetrics(obs);

		metrics.trackRun("support", { success: false, latencyMs: 500 });

		expect(obs.getMetric("agent.errors")!.sum).toBe(1);
	});

	it("should track guardrail metrics", () => {
		const obs = createObservability();
		const metrics = createAgentMetrics(obs);

		metrics.trackGuardrail("pii-check", {
			passed: false,
			latencyMs: 5,
			blocked: true,
		});

		expect(obs.getMetric("guardrail.checks")!.sum).toBe(1);
		expect(obs.getMetric("guardrail.failures")!.sum).toBe(1);
		expect(obs.getMetric("guardrail.blocks")!.sum).toBe(1);
	});

	it("should track approval metrics", () => {
		const obs = createObservability();
		const metrics = createAgentMetrics(obs);

		metrics.trackApproval("file_write", {
			approved: true,
			waitTimeMs: 3000,
		});

		expect(obs.getMetric("approval.requests")!.sum).toBe(1);
		expect(obs.getMetric("approval.approved")!.sum).toBe(1);
	});

	it("should track handoff metrics", () => {
		const obs = createObservability();
		const metrics = createAgentMetrics(obs);

		metrics.trackHandoff("researcher", "writer", 200);

		expect(obs.getMetric("handoff.count")!.sum).toBe(1);
		expect(obs.getMetric("handoff.latency")!.lastValue).toBe(200);
	});
});
