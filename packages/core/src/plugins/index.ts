/**
 * Built-in Plugins for Directive
 */

export { loggingPlugin, type LoggingPluginOptions } from "./logging.js";
export {
  devtoolsPlugin,
  type DevtoolsPluginOptions,
  type TraceEvent,
} from "./devtools.js";
export {
  emitDevToolsEvent,
  DEVTOOLS_EVENT_NAME,
} from "./devtools-ai-bridge.js";
export {
  persistencePlugin,
  type PersistencePluginOptions,
} from "./persistence.js";
export {
  performancePlugin,
  type PerformancePluginOptions,
  type PerformanceSnapshot,
  type ConstraintMetrics,
  type ResolverMetrics,
  type EffectMetrics,
  type ReconcileMetrics,
} from "./performance.js";
// createObservability + createAgentMetrics moved to observability.alpha.ts
// Re-evaluating value vs OTel — types still available for otlp-exporter and circuit-breaker
export type {
  MetricType,
  MetricDataPoint,
  HistogramBucket,
  AggregatedMetric,
  TraceSpan,
  AlertConfig,
  AlertEvent,
  ObservabilityConfig,
  DashboardData,
  ObservabilityInstance,
} from "./observability.lab.js";
export {
  createOTLPExporter,
  type OTLPExporterConfig,
  type OTLPExporter,
} from "./otlp-exporter.js";
export {
  createCircuitBreaker,
  CircuitBreakerOpenError,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitBreaker,
} from "./circuit-breaker.js";
