/**
 * Copied from 1.35 (packages/core/src/plugins/observability.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

// ============================================================================
// Types
// ============================================================================

/** Metric types that can be collected */
export type MetricType = "counter" | "gauge" | "histogram" | "summary";

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
  incrementCounter(
    name: string,
    labels?: Record<string, string>,
    value?: number,
  ): void;
  /** Record a gauge metric */
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
  /** Record a histogram observation */
  observeHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
  ): void;
  /** Start a trace span */
  startSpan(operationName: string, parentSpanId?: string): TraceSpan;
  /** End a trace span */
  endSpan(spanId: string, status?: "ok" | "error" | "timeout"): void;
  /** Add log to a span */
  addSpanLog(
    spanId: string,
    message: string,
    level?: "debug" | "info" | "warn" | "error",
  ): void;
  /** Add tag to a span */
  addSpanTag(
    spanId: string,
    key: string,
    value: string | number | boolean,
  ): void;
  /** Get dashboard data */
  getDashboard(): DashboardData;
  /** Get a specific metric */
  getMetric(name: string): AggregatedMetric | undefined;
  /** Get recent traces */
  getTraces(limit?: number): TraceSpan[];
  /** Get active alerts */
  getAlerts(): AlertEvent[];
  /** Export all data */
  export(): {
    metrics: AggregatedMetric[];
    traces: TraceSpan[];
    alerts: AlertEvent[];
  };
  /** Clear all data and reset statistics */
  clear(): void;
  /** Dispose of the instance, clearing timers and flushing data */
  destroy(): Promise<void>;
  /** Get health status for status pages */
  getHealthStatus(): {
    healthy: boolean;
    uptime: number;
    errorRate: number;
    activeAlerts: number;
  };
}
