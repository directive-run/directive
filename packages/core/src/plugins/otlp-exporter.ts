/**
 * OTLP (OpenTelemetry Protocol) Exporter
 *
 * Converts Directive observability data to OTLP JSON format for export to
 * Grafana, Datadog, Jaeger, and other OpenTelemetry-compatible backends.
 *
 * @example
 * ```typescript
 * import { createObservability } from '@directive-run/ai';
 * import { createOTLPExporter } from '@directive-run/ai';
 *
 * const exporter = createOTLPExporter({
 *   endpoint: 'http://localhost:4318',
 *   headers: { 'Authorization': 'Bearer token' },
 *   serviceName: 'my-agent-service',
 * });
 *
 * const obs = createObservability({
 *   metrics: { exporter: exporter.exportMetrics, exportInterval: 10000 },
 *   tracing: { exporter: exporter.exportTraces },
 * });
 * ```
 */

import type { AggregatedMetric, TraceSpan } from "./observability.js";

// ============================================================================
// Types
// ============================================================================

/** OTLP exporter configuration */
export interface OTLPExporterConfig {
	/** OTLP endpoint base URL (e.g., http://localhost:4318) */
	endpoint: string;
	/** Optional headers (e.g., auth tokens) */
	headers?: Record<string, string>;
	/** Service name for resource identification */
	serviceName?: string;
	/** Service version */
	serviceVersion?: string;
	/** Custom resource attributes */
	resourceAttributes?: Record<string, string>;
	/** Instrumentation scope version (default: "0.1.0") */
	scopeVersion?: string;
	/** Request timeout in ms (default: 10000) */
	timeoutMs?: number;
	/** Custom fetch function (for testing or custom HTTP clients) */
	fetch?: typeof globalThis.fetch;
	/** Callback on export error */
	onError?: (error: Error, type: "metrics" | "traces") => void;
}

/** OTLP exporter instance */
export interface OTLPExporter {
	/** Export metrics in OTLP format (compatible with ObservabilityConfig.metrics.exporter) */
	exportMetrics: (metrics: AggregatedMetric[]) => Promise<void>;
	/** Export traces in OTLP format (compatible with ObservabilityConfig.tracing.exporter) */
	exportTraces: (traces: TraceSpan[]) => Promise<void>;
}

// ============================================================================
// OTLP JSON Conversion
// ============================================================================

interface OTLPResource {
	attributes: Array<{ key: string; value: { stringValue: string } }>;
}

function buildResource(config: OTLPExporterConfig): OTLPResource {
	const attrs: Array<{ key: string; value: { stringValue: string } }> = [
		{ key: "service.name", value: { stringValue: config.serviceName ?? "directive-agents" } },
	];

	if (config.serviceVersion) {
		attrs.push({ key: "service.version", value: { stringValue: config.serviceVersion } });
	}

	if (config.resourceAttributes) {
		for (const [key, val] of Object.entries(config.resourceAttributes)) {
			attrs.push({ key, value: { stringValue: val } });
		}
	}

	return { attributes: attrs };
}

function toNanos(timestampMs: number): string {
	return `${BigInt(timestampMs) * BigInt(1_000_000)}`;
}

function metricTypeToOTLP(type: string): string {
	switch (type) {
		case "counter":
			return "sum";
		case "gauge":
			return "gauge";
		case "histogram":
			return "histogram";
		default:
			return "gauge";
	}
}

function convertMetrics(
	metrics: AggregatedMetric[],
	resource: OTLPResource,
	scopeVersion: string,
): Record<string, unknown> {
	const scopeMetrics = metrics.map((metric) => {
		// Known limitation: startTimeUnixNano is approximated as lastUpdated minus 60s.
		// A more accurate value would require tracking the actual collection start time
		// per metric, which is not available in the current AggregatedMetric type.
		const startTimeMs = metric.lastUpdated - 60000;

		const dataPoints = [
			{
				asInt: metric.type === "counter" ? metric.sum : undefined,
				asDouble: metric.type !== "counter" ? metric.lastValue : undefined,
				timeUnixNano: toNanos(metric.lastUpdated),
				startTimeUnixNano: toNanos(startTimeMs),
				attributes: [],
			},
		];

		const otlpType = metricTypeToOTLP(metric.type);
		const metricData: Record<string, unknown> = {
			name: metric.name,
			unit: "",
		};

		if (otlpType === "sum") {
			metricData.sum = {
				dataPoints,
				aggregationTemporality: 2, // CUMULATIVE
				isMonotonic: true,
			};
		} else if (otlpType === "histogram") {
			metricData.histogram = {
				dataPoints: [
					{
						count: metric.count,
						sum: metric.sum,
						min: metric.min,
						max: metric.max,
						timeUnixNano: toNanos(metric.lastUpdated),
						startTimeUnixNano: toNanos(startTimeMs),
						attributes: [],
					},
				],
				aggregationTemporality: 2,
			};
		} else {
			metricData.gauge = { dataPoints };
		}

		return metricData;
	});

	return {
		resourceMetrics: [
			{
				resource,
				scopeMetrics: [
					{
						scope: { name: "directive", version: scopeVersion },
						metrics: scopeMetrics,
					},
				],
			},
		],
	};
}

function convertTraces(
	traces: TraceSpan[],
	resource: OTLPResource,
	scopeVersion: string,
): Record<string, unknown> {
	const spans = traces.map((span) => {
		const events = span.logs.map((log) => ({
			timeUnixNano: toNanos(log.timestamp),
			name: log.level,
			attributes: [
				{ key: "message", value: { stringValue: log.message } },
				{ key: "level", value: { stringValue: log.level } },
			],
		}));

		const attributes = Object.entries(span.tags).map(([key, val]) => ({
			key,
			value:
				typeof val === "string"
					? { stringValue: val }
					: typeof val === "number"
						? { intValue: `${val}` }
						: { boolValue: val },
		}));

		const statusCode =
			span.status === "ok" ? 1 : span.status === "error" ? 2 : 0;

		return {
			traceId: span.traceId.replace(/-/g, "").padEnd(32, "0").slice(0, 32),
			spanId: span.spanId.replace(/-/g, "").padEnd(16, "0").slice(0, 16),
			parentSpanId: span.parentSpanId
				? span.parentSpanId.replace(/-/g, "").padEnd(16, "0").slice(0, 16)
				: undefined,
			name: span.operationName,
			kind: 1, // INTERNAL
			startTimeUnixNano: toNanos(span.startTime),
			endTimeUnixNano: span.endTime ? toNanos(span.endTime) : toNanos(span.startTime),
			attributes,
			events,
			status: { code: statusCode },
		};
	});

	return {
		resourceSpans: [
			{
				resource,
				scopeSpans: [
					{
						scope: { name: "directive", version: scopeVersion },
						spans,
					},
				],
			},
		],
	};
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an OTLP exporter for sending metrics and traces to OpenTelemetry-compatible backends.
 *
 * Supports:
 * - Grafana (via OTLP endpoint)
 * - Datadog (via OTLP ingest)
 * - Jaeger (via OTLP collector)
 * - Any OpenTelemetry Collector
 *
 * @example
 * ```typescript
 * const exporter = createOTLPExporter({
 *   endpoint: 'http://localhost:4318',
 *   serviceName: 'my-agent-service',
 * });
 *
 * // Wire into observability
 * const obs = createObservability({
 *   metrics: { exporter: exporter.exportMetrics, exportInterval: 10000 },
 *   tracing: { exporter: exporter.exportTraces },
 * });
 * ```
 */
export function createOTLPExporter(config: OTLPExporterConfig): OTLPExporter {
	const {
		endpoint,
		headers = {},
		scopeVersion = "0.1.0",
		timeoutMs = 10000,
		fetch: fetchFn = globalThis.fetch,
		onError,
	} = config;

	// Validate endpoint URL
	try {
		const url = new URL(endpoint);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			throw new Error("Only http: and https: protocols are supported");
		}
	} catch (error) {
		throw new Error(
			`[Directive OTLP] Invalid endpoint URL "${endpoint}": ${error instanceof Error ? error.message : String(error)}`
		);
	}

	// Warn if endpoint already contains a path like /v1/metrics or /v1/traces
	if (/\/v1\/(metrics|traces)/.test(endpoint)) {
		console.warn(
			`[Directive OTLP] Endpoint "${endpoint}" already contains a /v1/metrics or /v1/traces path. ` +
			`The exporter will append /v1/metrics or /v1/traces automatically. ` +
			`Use the base URL (e.g., "http://localhost:4318") instead.`
		);
	}

	// Validate timeoutMs
	if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) {
		throw new Error(`[Directive OTLP] timeoutMs must be > 0, got ${timeoutMs}`);
	}

	const resource = buildResource(config);

	async function send(path: string, body: Record<string, unknown>, type: "metrics" | "traces"): Promise<void> {
		const url = `${endpoint.replace(/\/$/, "")}${path}`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetchFn(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...headers,
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new Error(`OTLP export failed: ${response.status} ${response.statusText}`);
			}
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			if (onError) {
				onError(err, type);
			} else {
				console.error(`[Directive OTLP] Export ${type} error:`, err.message);
			}
		} finally {
			clearTimeout(timer);
		}
	}

	return {
		async exportMetrics(metrics: AggregatedMetric[]): Promise<void> {
			if (metrics.length === 0) return;
			const body = convertMetrics(metrics, resource, scopeVersion);
			await send("/v1/metrics", body, "metrics");
		},

		async exportTraces(traces: TraceSpan[]): Promise<void> {
			if (traces.length === 0) return;
			const body = convertTraces(traces, resource, scopeVersion);
			await send("/v1/traces", body, "traces");
		},
	};
}
