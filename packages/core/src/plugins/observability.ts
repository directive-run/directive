/**
 * Observability Dashboard Plugin
 *
 * Provides comprehensive monitoring, metrics collection, and dashboard integration
 * for AI agent operations.
 *
 * @example
 * ```typescript
 * import { createObservability, createAgentMetrics } from '@directive-run/ai';
 *
 * const observability = createObservability({
 *   metrics: {
 *     enabled: true,
 *     exportInterval: 10000, // Export every 10 seconds
 *   },
 *   tracing: {
 *     enabled: true,
 *     sampleRate: 1.0, // 100% sampling for dev
 *   },
 *   alerts: [
 *     { metric: 'agent.errors', threshold: 10, action: 'warn' },
 *     { metric: 'agent.latency', threshold: 5000, action: 'alert' },
 *   ],
 * });
 *
 * // Use createAgentMetrics for standard metric names (required for getDashboard() summary)
 * const agentMetrics = createAgentMetrics(observability);
 *
 * // Access dashboard data
 * const dashboard = observability.getDashboard();
 *
 * // Clean up when done
 * await observability.dispose();
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/** Metric types that can be collected */
export type MetricType =
	| "counter"
	| "gauge"
	| "histogram"
	| "summary";

/** A single metric data point */
export interface MetricDataPoint {
	name: string;
	type: MetricType;
	value: number;
	labels: Record<string, string>;
	timestamp: number;
}

/** Histogram bucket for latency/size distributions */
export interface HistogramBucket {
	le: number; // less than or equal
	count: number;
}

/** Aggregated metric for dashboard display */
export interface AggregatedMetric {
	name: string;
	type: MetricType;
	count: number;
	sum: number;
	min: number;
	max: number;
	avg: number;
	p50?: number;
	p90?: number;
	p99?: number;
	lastValue: number;
	lastUpdated: number;
}

/** Trace span for distributed tracing */
export interface TraceSpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	operationName: string;
	serviceName: string;
	startTime: number;
	endTime?: number;
	duration?: number;
	status: "ok" | "error" | "timeout";
	tags: Record<string, string | number | boolean>;
	logs: Array<{
		timestamp: number;
		message: string;
		level: "debug" | "info" | "warn" | "error";
	}>;
}

/** Alert configuration */
export interface AlertConfig {
	metric: string;
	threshold: number;
	operator?: ">" | "<" | ">=" | "<=" | "==";
	action: "log" | "warn" | "alert" | "callback";
	callback?: (metric: AggregatedMetric, threshold: number) => void;
	cooldownMs?: number;
}

/** Alert event when threshold is crossed */
export interface AlertEvent {
	alertId: string;
	metric: string;
	currentValue: number;
	threshold: number;
	operator: string;
	action: string;
	timestamp: number;
	message: string;
}

/** Observability configuration */
export interface ObservabilityConfig {
	/** Service name for tracing */
	serviceName?: string;
	/** Metrics configuration */
	metrics?: {
		enabled?: boolean;
		/** Export interval in milliseconds */
		exportInterval?: number;
		/** Custom exporter function */
		exporter?: (metrics: AggregatedMetric[]) => Promise<void>;
		/** Maximum data points to retain per metric */
		maxDataPoints?: number;
	};
	/** Tracing configuration */
	tracing?: {
		enabled?: boolean;
		/** Sample rate (0.0 to 1.0) */
		sampleRate?: number;
		/** Maximum spans to retain */
		maxSpans?: number;
		/** Custom trace exporter */
		exporter?: (spans: TraceSpan[]) => Promise<void>;
	};
	/** Alert configurations */
	alerts?: AlertConfig[];
	/**
	 * Metric names used by `getDashboard().summary` and `getHealthStatus()`.
	 * Defaults to `agent.requests`, `agent.errors`, `agent.latency`, `agent.tokens`, `agent.cost`.
	 * Must match the metric names you record via `incrementCounter` / `observeHistogram`,
	 * or use `createAgentMetrics()` which records with these default names.
	 */
	summaryMetrics?: {
		requests?: string;
		errors?: string;
		latency?: string;
		tokens?: string;
		cost?: string;
	};
	/** Event callbacks */
	events?: {
		onMetricRecorded?: (metric: MetricDataPoint) => void;
		onSpanStart?: (span: TraceSpan) => void;
		onSpanEnd?: (span: TraceSpan) => void;
		onAlert?: (alert: AlertEvent) => void;
	};
}

/** Dashboard data for UI display */
export interface DashboardData {
	/** Service info */
	service: {
		name: string;
		uptime: number;
		startTime: number;
	};
	/** Aggregated metrics */
	metrics: Record<string, AggregatedMetric>;
	/** Recent traces */
	traces: TraceSpan[];
	/** Active alerts */
	alerts: AlertEvent[];
	/** Summary stats */
	summary: {
		totalRequests: number;
		totalErrors: number;
		errorRate: number;
		avgLatency: number;
		p99Latency: number;
		activeSpans: number;
		totalTokens: number;
		totalCost: number;
	};
}

/** Observability instance */
export interface ObservabilityInstance {
	/** Record a counter metric */
	incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
	/** Record a gauge metric */
	setGauge(name: string, value: number, labels?: Record<string, string>): void;
	/** Record a histogram observation */
	observeHistogram(name: string, value: number, labels?: Record<string, string>): void;
	/** Start a trace span */
	startSpan(operationName: string, parentSpanId?: string): TraceSpan;
	/** End a trace span */
	endSpan(spanId: string, status?: "ok" | "error" | "timeout"): void;
	/** Add log to a span */
	addSpanLog(spanId: string, message: string, level?: "debug" | "info" | "warn" | "error"): void;
	/** Add tag to a span */
	addSpanTag(spanId: string, key: string, value: string | number | boolean): void;
	/** Get dashboard data */
	getDashboard(): DashboardData;
	/** Get a specific metric */
	getMetric(name: string): AggregatedMetric | undefined;
	/** Get recent traces */
	getTraces(limit?: number): TraceSpan[];
	/** Get active alerts */
	getAlerts(): AlertEvent[];
	/** Export all data */
	export(): { metrics: AggregatedMetric[]; traces: TraceSpan[]; alerts: AlertEvent[] };
	/** Clear all data and reset statistics */
	clear(): void;
	/** Dispose of the instance, clearing timers and flushing data */
	dispose(): Promise<void>;
	/** Get health status for status pages */
	getHealthStatus(): {
		healthy: boolean;
		uptime: number;
		errorRate: number;
		activeAlerts: number;
	};
}

// ============================================================================
// Utility Functions
// ============================================================================

function generateId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function calculatePercentile(values: number[], percentile: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.ceil((percentile / 100) * sorted.length) - 1;
	return sorted[Math.max(0, index)] ?? 0;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an observability instance for monitoring AI agents.
 *
 * @example
 * ```typescript
 * const obs = createObservability({
 *   serviceName: 'my-agent-service',
 *   metrics: { enabled: true },
 *   tracing: { enabled: true, sampleRate: 0.1 },
 *   alerts: [
 *     { metric: 'agent.errors', threshold: 10, action: 'alert' },
 *   ],
 * });
 *
 * // Track agent operations
 * const span = obs.startSpan('agent.run');
 * obs.incrementCounter('agent.requests', { agent: 'support' });
 *
 * try {
 *   await runAgent();
 *   obs.observeHistogram('agent.latency', Date.now() - start);
 *   obs.endSpan(span.spanId, 'ok');
 * } catch (e) {
 *   obs.incrementCounter('agent.errors');
 *   obs.endSpan(span.spanId, 'error');
 * }
 * ```
 */
export function createObservability(config: ObservabilityConfig = {}): ObservabilityInstance {
	const {
		serviceName = "directive-agents",
		metrics: metricsConfig = {},
		tracing: tracingConfig = {},
		alerts: alertConfigs = [],
		summaryMetrics: summaryMetricsConfig = {},
		events = {},
	} = config;

	const summaryMetricNames = {
		requests: summaryMetricsConfig.requests ?? "agent.requests",
		errors: summaryMetricsConfig.errors ?? "agent.errors",
		latency: summaryMetricsConfig.latency ?? "agent.latency",
		tokens: summaryMetricsConfig.tokens ?? "agent.tokens",
		cost: summaryMetricsConfig.cost ?? "agent.cost",
	};

	const {
		enabled: metricsEnabled = true,
		exportInterval,
		exporter: metricsExporter,
		maxDataPoints = 1000,
	} = metricsConfig;

	const {
		enabled: tracingEnabled = true,
		sampleRate = 1.0,
		maxSpans = 1000,
		exporter: tracingExporter,
	} = tracingConfig;

	// State
	const startTime = Date.now();
	const metricDataPoints = new Map<string, MetricDataPoint[]>();
	const activeSpans = new Map<string, TraceSpan>();
	const completedSpans: TraceSpan[] = [];
	const alertEvents: AlertEvent[] = [];
	const alertCooldowns = new Map<string, number>();

	// Aggregated metrics cache
	const aggregatedMetrics = new Map<string, AggregatedMetric>();

	// Export timer
	let exportTimer: ReturnType<typeof setInterval> | undefined;
	if (exportInterval && (metricsExporter || tracingExporter)) {
		exportTimer = setInterval(async () => {
			try {
				if (metricsExporter && metricsEnabled) {
					await metricsExporter(Array.from(aggregatedMetrics.values()));
				}
				if (tracingExporter && tracingEnabled) {
					const spansToExport = completedSpans.splice(0, 100);
					if (spansToExport.length > 0) {
						await tracingExporter(spansToExport);
					}
				}
			} catch (error) {
				console.error("[Directive Observability] Export error:", error);
			}
		}, exportInterval);
	}

	function recordMetric(dataPoint: MetricDataPoint): void {
		if (!metricsEnabled) return;

		const key = `${dataPoint.name}:${JSON.stringify(Object.fromEntries(Object.entries(dataPoint.labels).sort()))}`;
		let points = metricDataPoints.get(key);
		if (!points) {
			points = [];
			metricDataPoints.set(key, points);
		}

		points.push(dataPoint);

		// Trim old data points
		if (points.length > maxDataPoints) {
			points.shift();
		}

		// Update aggregation
		updateAggregation(dataPoint.name, points);

		events.onMetricRecorded?.(dataPoint);

		// Check alerts
		checkAlerts(dataPoint.name);
	}

	function updateAggregation(name: string, points: MetricDataPoint[]): void {
		if (points.length === 0) return;

		const values = points.map((p) => p.value);
		const sum = values.reduce((a, b) => a + b, 0);

		// We've already checked points.length === 0 above, so these are safe
		const firstPoint = points[0]!;
		const lastValue = values[values.length - 1]!;

		const aggregated: AggregatedMetric = {
			name,
			type: firstPoint.type,
			count: points.length,
			sum,
			min: Math.min(...values),
			max: Math.max(...values),
			avg: sum / points.length,
			lastValue,
			lastUpdated: Date.now(),
		};

		aggregatedMetrics.set(name, aggregated);
	}

	function checkAlerts(metricName: string): void {
		for (const alertConfig of alertConfigs) {
			if (alertConfig.metric !== metricName) continue;

			const metric = aggregatedMetrics.get(metricName);
			if (!metric) continue;

			const cooldownKey = `${alertConfig.metric}:${alertConfig.threshold}`;
			const lastAlert = alertCooldowns.get(cooldownKey);
			const cooldown = alertConfig.cooldownMs ?? 60000;

			if (lastAlert && Date.now() - lastAlert < cooldown) continue;

			const operator = alertConfig.operator ?? ">";
			const value = metric.lastValue;
			const threshold = alertConfig.threshold;

			let triggered = false;
			switch (operator) {
				case ">":
					triggered = value > threshold;
					break;
				case "<":
					triggered = value < threshold;
					break;
				case ">=":
					triggered = value >= threshold;
					break;
				case "<=":
					triggered = value <= threshold;
					break;
				case "==":
					triggered = value === threshold;
					break;
			}

			if (triggered) {
				const alertEvent: AlertEvent = {
					alertId: generateId(),
					metric: metricName,
					currentValue: value,
					threshold,
					operator,
					action: alertConfig.action,
					timestamp: Date.now(),
					message: `Alert: ${metricName} ${operator} ${threshold} (current: ${value})`,
				};

				alertEvents.push(alertEvent);
				if (alertEvents.length > 1000) alertEvents.splice(0, alertEvents.length - 1000);
				alertCooldowns.set(cooldownKey, Date.now());

				events.onAlert?.(alertEvent);

				switch (alertConfig.action) {
					case "log":
						console.log(`[Observability] ${alertEvent.message}`);
						break;
					case "warn":
						console.warn(`[Observability] ${alertEvent.message}`);
						break;
					case "alert":
						console.error(`[Observability ALERT] ${alertEvent.message}`);
						break;
					case "callback":
						alertConfig.callback?.(metric, threshold);
						break;
				}
			}
		}
	}

	function getPercentiles(name: string): { p50?: number; p90?: number; p99?: number } {
		// Collect all data points for this metric name across all label combinations
		const allValues: number[] = [];
		for (const [key, points] of metricDataPoints) {
			if (key.startsWith(`${name}:`)) {
				for (const p of points) {
					allValues.push(p.value);
				}
			}
		}
		if (allValues.length === 0) return {};
		return {
			p50: calculatePercentile(allValues, 50),
			p90: calculatePercentile(allValues, 90),
			p99: calculatePercentile(allValues, 99),
		};
	}

	return {
		incrementCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
			recordMetric({
				name,
				type: "counter",
				value,
				labels,
				timestamp: Date.now(),
			});
		},

		setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
			recordMetric({
				name,
				type: "gauge",
				value,
				labels,
				timestamp: Date.now(),
			});
		},

		observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
			recordMetric({
				name,
				type: "histogram",
				value,
				labels,
				timestamp: Date.now(),
			});
		},

		startSpan(operationName: string, parentSpanId?: string): TraceSpan {
			// Apply sampling
			if (Math.random() > sampleRate) {
				// Return a no-op span that won't be tracked
				return {
					traceId: "sampled-out",
					spanId: "sampled-out",
					operationName,
					serviceName,
					startTime: Date.now(),
					status: "ok",
					tags: {},
					logs: [],
				};
			}

			const span: TraceSpan = {
				traceId: parentSpanId
					? activeSpans.get(parentSpanId)?.traceId ?? generateId()
					: generateId(),
				spanId: generateId(),
				parentSpanId,
				operationName,
				serviceName,
				startTime: Date.now(),
				status: "ok",
				tags: {},
				logs: [],
			};

			if (tracingEnabled) {
				activeSpans.set(span.spanId, span);
				events.onSpanStart?.(span);
			}

			return span;
		},

		endSpan(spanId: string, status: "ok" | "error" | "timeout" = "ok"): void {
			if (spanId === "sampled-out") return;

			const span = activeSpans.get(spanId);
			if (!span) return;

			span.endTime = Date.now();
			span.duration = span.endTime - span.startTime;
			span.status = status;

			activeSpans.delete(spanId);
			completedSpans.push(span);

			// Trim old spans
			while (completedSpans.length > maxSpans) {
				completedSpans.shift();
			}

			// Record latency metric (use recordMetric directly to avoid `this` binding issues)
			recordMetric({
				name: `${span.operationName}.latency`,
				type: "histogram",
				value: span.duration,
				labels: {},
				timestamp: Date.now(),
			});

			if (status === "error") {
				recordMetric({
					name: `${span.operationName}.errors`,
					type: "counter",
					value: 1,
					labels: {},
					timestamp: Date.now(),
				});
			}

			events.onSpanEnd?.(span);
		},

		addSpanLog(spanId: string, message: string, level: "debug" | "info" | "warn" | "error" = "info"): void {
			if (spanId === "sampled-out") return;

			const span = activeSpans.get(spanId);
			if (!span) return;

			span.logs.push({
				timestamp: Date.now(),
				message,
				level,
			});
		},

		addSpanTag(spanId: string, key: string, value: string | number | boolean): void {
			if (spanId === "sampled-out") return;

			const span = activeSpans.get(spanId);
			if (!span) return;

			span.tags[key] = value;
		},

		getDashboard(): DashboardData {
			// Calculate summary stats using configurable metric names
			const requestsMetric = aggregatedMetrics.get(summaryMetricNames.requests);
			const errorsMetric = aggregatedMetrics.get(summaryMetricNames.errors);
			const latencyMetric = aggregatedMetrics.get(summaryMetricNames.latency);
			const tokensMetric = aggregatedMetrics.get(summaryMetricNames.tokens);
			const costMetric = aggregatedMetrics.get(summaryMetricNames.cost);

			const totalRequests = requestsMetric?.sum ?? 0;
			const totalErrors = errorsMetric?.sum ?? 0;
			const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

			// Calculate percentiles on demand for latency
			const latencyPercentiles = latencyMetric ? getPercentiles(summaryMetricNames.latency) : {};

			return {
				service: {
					name: serviceName,
					uptime: Date.now() - startTime,
					startTime,
				},
				metrics: Object.fromEntries(aggregatedMetrics),
				traces: [...completedSpans].slice(-100),
				alerts: [...alertEvents].slice(-50),
				summary: {
					totalRequests,
					totalErrors,
					errorRate,
					avgLatency: latencyMetric?.avg ?? 0,
					p99Latency: latencyPercentiles.p99 ?? 0,
					activeSpans: activeSpans.size,
					totalTokens: tokensMetric?.sum ?? 0,
					totalCost: costMetric?.sum ?? 0,
				},
			};
		},

		getMetric(name: string): AggregatedMetric | undefined {
			const metric = aggregatedMetrics.get(name);
			if (!metric) return undefined;
			// Calculate percentiles on demand
			const percentiles = getPercentiles(name);
			return { ...metric, ...percentiles };
		},

		getTraces(limit = 100): TraceSpan[] {
			return [...completedSpans].slice(-limit);
		},

		getAlerts(): AlertEvent[] {
			return [...alertEvents];
		},

		export() {
			return {
				metrics: Array.from(aggregatedMetrics.values()),
				traces: [...completedSpans],
				alerts: [...alertEvents],
			};
		},

		clear() {
			metricDataPoints.clear();
			aggregatedMetrics.clear();
			activeSpans.clear();
			completedSpans.length = 0;
			alertEvents.length = 0;
			alertCooldowns.clear();
		},

		async dispose() {
			// Clear the export timer
			if (exportTimer) {
				clearInterval(exportTimer);
				exportTimer = undefined;
			}

			// Flush any remaining data to exporters
			try {
				if (metricsExporter && metricsEnabled && aggregatedMetrics.size > 0) {
					await metricsExporter(Array.from(aggregatedMetrics.values()));
				}
				if (tracingExporter && tracingEnabled && completedSpans.length > 0) {
					await tracingExporter([...completedSpans]);
				}
			} catch (error) {
				console.error("[Directive Observability] Error flushing data during dispose:", error);
			}

			// Clear all data
			metricDataPoints.clear();
			aggregatedMetrics.clear();
			activeSpans.clear();
			completedSpans.length = 0;
			alertEvents.length = 0;
			alertCooldowns.clear();
		},

		getHealthStatus() {
			const requestsMetric = aggregatedMetrics.get(summaryMetricNames.requests);
			const errorsMetric = aggregatedMetrics.get(summaryMetricNames.errors);

			const totalRequests = requestsMetric?.sum ?? 0;
			const totalErrors = errorsMetric?.sum ?? 0;
			const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

			// Consider unhealthy if error rate > 10% or there are active alerts
			const activeAlertCount = alertEvents.filter(
				(a) => Date.now() - a.timestamp < 300000 // Last 5 minutes
			).length;

			return {
				healthy: errorRate < 0.1 && activeAlertCount === 0,
				uptime: Date.now() - startTime,
				errorRate,
				activeAlerts: activeAlertCount,
			};
		},
	};
}

// ============================================================================
// Pre-built Metric Helpers
// ============================================================================

/**
 * Create standard agent metrics for an observability instance.
 *
 * @example
 * ```typescript
 * const obs = createObservability({ serviceName: 'my-service' });
 * const agentMetrics = createAgentMetrics(obs);
 *
 * // Track an agent run
 * agentMetrics.trackRun('support-agent', {
 *   success: true,
 *   latencyMs: 1500,
 *   inputTokens: 100,
 *   outputTokens: 500,
 *   cost: 0.05,
 * });
 * ```
 */
export function createAgentMetrics(obs: ObservabilityInstance) {
	return {
		trackRun(
			agentName: string,
			result: {
				success: boolean;
				latencyMs: number;
				inputTokens?: number;
				outputTokens?: number;
				cost?: number;
				toolCalls?: number;
			}
		): void {
			const labels = { agent: agentName };

			obs.incrementCounter("agent.requests", labels);

			if (!result.success) {
				obs.incrementCounter("agent.errors", labels);
			}

			obs.observeHistogram("agent.latency", result.latencyMs, labels);

			if (result.inputTokens !== undefined) {
				obs.incrementCounter("agent.tokens.input", labels, result.inputTokens);
				obs.incrementCounter("agent.tokens", labels, result.inputTokens);
			}

			if (result.outputTokens !== undefined) {
				obs.incrementCounter("agent.tokens.output", labels, result.outputTokens);
				obs.incrementCounter("agent.tokens", labels, result.outputTokens);
			}

			if (result.cost !== undefined) {
				obs.incrementCounter("agent.cost", labels, result.cost);
			}

			if (result.toolCalls !== undefined) {
				obs.incrementCounter("agent.tool_calls", labels, result.toolCalls);
			}
		},

		trackGuardrail(
			guardrailName: string,
			result: {
				passed: boolean;
				latencyMs: number;
				blocked?: boolean;
			}
		): void {
			const labels = { guardrail: guardrailName };

			obs.incrementCounter("guardrail.checks", labels);

			if (!result.passed) {
				obs.incrementCounter("guardrail.failures", labels);
			}

			if (result.blocked) {
				obs.incrementCounter("guardrail.blocks", labels);
			}

			obs.observeHistogram("guardrail.latency", result.latencyMs, labels);
		},

		trackApproval(
			toolName: string,
			result: {
				approved: boolean;
				waitTimeMs: number;
				timedOut?: boolean;
			}
		): void {
			const labels = { tool: toolName };

			obs.incrementCounter("approval.requests", labels);

			if (result.approved) {
				obs.incrementCounter("approval.approved", labels);
			} else {
				obs.incrementCounter("approval.rejected", labels);
			}

			if (result.timedOut) {
				obs.incrementCounter("approval.timeouts", labels);
			}

			obs.observeHistogram("approval.wait_time", result.waitTimeMs, labels);
		},

		trackHandoff(
			fromAgent: string,
			toAgent: string,
			latencyMs: number
		): void {
			obs.incrementCounter("handoff.count", { from: fromAgent, to: toAgent });
			obs.observeHistogram("handoff.latency", latencyMs);
		},
	};
}
