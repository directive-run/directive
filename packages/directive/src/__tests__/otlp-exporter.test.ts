import { describe, expect, it, vi } from "vitest";
import { createOTLPExporter } from "../adapters/plugins/otlp-exporter.js";
import type { AggregatedMetric, TraceSpan } from "../adapters/plugins/observability.js";

describe("OTLP Exporter", () => {
	const mockFetch = vi.fn(async () => ({
		ok: true,
		status: 200,
		statusText: "OK",
	})) as unknown as typeof globalThis.fetch;

	it("should export metrics to /v1/metrics endpoint", async () => {
		const exporter = createOTLPExporter({
			endpoint: "http://localhost:4318",
			fetch: mockFetch,
		});

		const metrics: AggregatedMetric[] = [
			{
				name: "agent.requests",
				type: "counter",
				count: 10,
				sum: 10,
				min: 1,
				max: 1,
				avg: 1,
				lastValue: 1,
				lastUpdated: Date.now(),
			},
		];

		await exporter.exportMetrics(metrics);

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://localhost:4318/v1/metrics");
		expect(options.method).toBe("POST");
		expect(options.headers).toHaveProperty("Content-Type", "application/json");

		const body = JSON.parse(options.body as string);
		expect(body.resourceMetrics).toBeDefined();
		expect(body.resourceMetrics[0].scopeMetrics[0].metrics.length).toBe(1);
		expect(body.resourceMetrics[0].scopeMetrics[0].metrics[0].name).toBe("agent.requests");
	});

	it("should export traces to /v1/traces endpoint", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
		})) as unknown as typeof globalThis.fetch;

		const exporter = createOTLPExporter({
			endpoint: "http://localhost:4318",
			fetch: fetchMock,
		});

		const traces: TraceSpan[] = [
			{
				traceId: "abc123",
				spanId: "def456",
				operationName: "agent.run",
				serviceName: "test",
				startTime: Date.now() - 1000,
				endTime: Date.now(),
				duration: 1000,
				status: "ok",
				tags: { agent: "support" },
				logs: [
					{ timestamp: Date.now(), message: "Starting", level: "info" },
				],
			},
		];

		await exporter.exportTraces(traces);

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://localhost:4318/v1/traces");

		const body = JSON.parse(options.body as string);
		expect(body.resourceSpans).toBeDefined();
		expect(body.resourceSpans[0].scopeSpans[0].spans.length).toBe(1);
		expect(body.resourceSpans[0].scopeSpans[0].spans[0].name).toBe("agent.run");
	});

	it("should include custom headers", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
		})) as unknown as typeof globalThis.fetch;

		const exporter = createOTLPExporter({
			endpoint: "http://localhost:4318",
			headers: { Authorization: "Bearer token123" },
			fetch: fetchMock,
		});

		await exporter.exportMetrics([{
			name: "test",
			type: "counter",
			count: 1,
			sum: 1,
			min: 1,
			max: 1,
			avg: 1,
			lastValue: 1,
			lastUpdated: Date.now(),
		}]);

		const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((options.headers as Record<string, string>).Authorization).toBe("Bearer token123");
	});

	it("should include service name in resource attributes", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
		})) as unknown as typeof globalThis.fetch;

		const exporter = createOTLPExporter({
			endpoint: "http://localhost:4318",
			serviceName: "my-agent-service",
			fetch: fetchMock,
		});

		await exporter.exportMetrics([{
			name: "test",
			type: "counter",
			count: 1,
			sum: 1,
			min: 1,
			max: 1,
			avg: 1,
			lastValue: 1,
			lastUpdated: Date.now(),
		}]);

		const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
		const attrs = body.resourceMetrics[0].resource.attributes;
		expect(attrs.find((a: { key: string }) => a.key === "service.name").value.stringValue).toBe("my-agent-service");
	});

	it("should skip export for empty arrays", async () => {
		const fetchMock = vi.fn() as unknown as typeof globalThis.fetch;

		const exporter = createOTLPExporter({
			endpoint: "http://localhost:4318",
			fetch: fetchMock,
		});

		await exporter.exportMetrics([]);
		await exporter.exportTraces([]);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("should call onError on fetch failure", async () => {
		const onError = vi.fn();
		const failingFetch = vi.fn(async () => {
			throw new Error("Network error");
		}) as unknown as typeof globalThis.fetch;

		const exporter = createOTLPExporter({
			endpoint: "http://localhost:4318",
			fetch: failingFetch,
			onError,
		});

		await exporter.exportMetrics([{
			name: "test",
			type: "counter",
			count: 1,
			sum: 1,
			min: 1,
			max: 1,
			avg: 1,
			lastValue: 1,
			lastUpdated: Date.now(),
		}]);

		expect(onError).toHaveBeenCalledOnce();
		expect(onError.mock.calls[0][0].message).toBe("Network error");
		expect(onError.mock.calls[0][1]).toBe("metrics");
	});

	it("should handle non-OK response", async () => {
		const onError = vi.fn();
		const badFetch = vi.fn(async () => ({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
		})) as unknown as typeof globalThis.fetch;

		const exporter = createOTLPExporter({
			endpoint: "http://localhost:4318",
			fetch: badFetch,
			onError,
		});

		await exporter.exportTraces([{
			traceId: "t1",
			spanId: "s1",
			operationName: "test",
			serviceName: "test",
			startTime: Date.now(),
			status: "ok",
			tags: {},
			logs: [],
		}]);

		expect(onError).toHaveBeenCalledOnce();
		expect(onError.mock.calls[0][0].message).toContain("500");
	});

	it("should call onError with abort error after timeout", async () => {
		const onError = vi.fn();
		const hangingFetch = vi.fn((_url: string, init?: RequestInit) => {
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					reject(new DOMException("The operation was aborted.", "AbortError"));
				});
			});
		}) as unknown as typeof globalThis.fetch;

		const exporter = createOTLPExporter({
			endpoint: "http://localhost:4318",
			fetch: hangingFetch,
			timeoutMs: 10,
			onError,
		});

		await exporter.exportMetrics([{
			name: "test",
			type: "counter",
			count: 1,
			sum: 1,
			min: 1,
			max: 1,
			avg: 1,
			lastValue: 1,
			lastUpdated: Date.now(),
		}]);

		expect(onError).toHaveBeenCalledOnce();
		expect(onError.mock.calls[0][0].name).toBe("AbortError");
		expect(onError.mock.calls[0][1]).toBe("metrics");
	});

	it("should convert gauge metrics with gauge.dataPoints", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
		})) as unknown as typeof globalThis.fetch;

		const exporter = createOTLPExporter({
			endpoint: "http://localhost:4318",
			fetch: fetchMock,
		});

		await exporter.exportMetrics([{
			name: "cpu.usage",
			type: "gauge",
			count: 5,
			sum: 250,
			min: 40,
			max: 60,
			avg: 50,
			lastValue: 55,
			lastUpdated: Date.now(),
		}]);

		const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
		const metric = body.resourceMetrics[0].scopeMetrics[0].metrics[0];
		expect(metric.gauge).toBeDefined();
		expect(metric.gauge.dataPoints).toBeDefined();
		expect(metric.gauge.dataPoints.length).toBe(1);
		expect(metric.gauge.dataPoints[0].asDouble).toBe(55);
		expect(metric.sum).toBeUndefined();
		expect(metric.histogram).toBeUndefined();
	});

	it("should convert histogram metrics with histogram.dataPoints containing count/sum/min/max", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
		})) as unknown as typeof globalThis.fetch;

		const exporter = createOTLPExporter({
			endpoint: "http://localhost:4318",
			fetch: fetchMock,
		});

		await exporter.exportMetrics([{
			name: "request.duration",
			type: "histogram",
			count: 100,
			sum: 5000,
			min: 10,
			max: 200,
			avg: 50,
			lastValue: 45,
			lastUpdated: Date.now(),
		}]);

		const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
		const metric = body.resourceMetrics[0].scopeMetrics[0].metrics[0];
		expect(metric.histogram).toBeDefined();
		expect(metric.histogram.dataPoints).toBeDefined();
		expect(metric.histogram.dataPoints.length).toBe(1);
		expect(metric.histogram.dataPoints[0].count).toBe(100);
		expect(metric.histogram.dataPoints[0].sum).toBe(5000);
		expect(metric.histogram.dataPoints[0].min).toBe(10);
		expect(metric.histogram.dataPoints[0].max).toBe(200);
		expect(metric.sum).toBeUndefined();
		expect(metric.gauge).toBeUndefined();
	});

	it("should use custom scopeVersion in exported body", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
		})) as unknown as typeof globalThis.fetch;

		const exporter = createOTLPExporter({
			endpoint: "http://localhost:4318",
			scopeVersion: "2.5.0",
			fetch: fetchMock,
		});

		await exporter.exportMetrics([{
			name: "test",
			type: "counter",
			count: 1,
			sum: 1,
			min: 1,
			max: 1,
			avg: 1,
			lastValue: 1,
			lastUpdated: Date.now(),
		}]);

		const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
		const scope = body.resourceMetrics[0].scopeMetrics[0].scope;
		expect(scope.version).toBe("2.5.0");
	});

	it("should throw on invalid endpoint URL", () => {
		expect(() =>
			createOTLPExporter({ endpoint: "not-a-url" })
		).toThrow(/Invalid endpoint URL/);
	});

	it("should throw on non-http/https protocol (ftp://)", () => {
		expect(() =>
			createOTLPExporter({ endpoint: "ftp://localhost:4318" })
		).toThrow(/Only http: and https: protocols are supported/);
	});

	it("should throw on invalid timeoutMs", () => {
		expect(() =>
			createOTLPExporter({ endpoint: "http://localhost:4318", timeoutMs: 0 })
		).toThrow(/timeoutMs must be > 0/);
	});

	it("should include parentSpanId in OTLP span when provided", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
		})) as unknown as typeof globalThis.fetch;

		const exporter = createOTLPExporter({
			endpoint: "http://localhost:4318",
			fetch: fetchMock,
		});

		await exporter.exportTraces([{
			traceId: "abc123",
			spanId: "child1",
			parentSpanId: "parent1",
			operationName: "child.operation",
			serviceName: "test",
			startTime: Date.now() - 500,
			endTime: Date.now(),
			duration: 500,
			status: "ok",
			tags: {},
			logs: [],
		}]);

		const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
		const span = body.resourceSpans[0].scopeSpans[0].spans[0];
		expect(span.parentSpanId).toBeDefined();
		expect(span.parentSpanId).toBe("parent10000000000".slice(0, 16));
	});

	it("should include custom resourceAttributes in the resource", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
		})) as unknown as typeof globalThis.fetch;

		const exporter = createOTLPExporter({
			endpoint: "http://localhost:4318",
			resourceAttributes: {
				"deployment.environment": "staging",
				"host.name": "worker-01",
			},
			fetch: fetchMock,
		});

		await exporter.exportMetrics([{
			name: "test",
			type: "counter",
			count: 1,
			sum: 1,
			min: 1,
			max: 1,
			avg: 1,
			lastValue: 1,
			lastUpdated: Date.now(),
		}]);

		const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
		const attrs = body.resourceMetrics[0].resource.attributes;
		const envAttr = attrs.find((a: { key: string }) => a.key === "deployment.environment");
		const hostAttr = attrs.find((a: { key: string }) => a.key === "host.name");
		expect(envAttr).toBeDefined();
		expect(envAttr.value.stringValue).toBe("staging");
		expect(hostAttr).toBeDefined();
		expect(hostAttr.value.stringValue).toBe("worker-01");
	});
});
