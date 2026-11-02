/**
 * `@directive-run/core/plugins` on core-next. Each 1.35 plugin lands here at
 * its layer; at L6 the persistence plugin.
 */
export { persistencePlugin } from "./persistence.js";
export type { PersistencePluginOptions } from "./persistence.js";

// 1.35's public types for this entry, exactly: copied from 1.35 into
// src/types/ (types only, no runtime code).
export type {
  AuditEntry,
  AuditEntryKind,
  AuditLedger,
  AuditLedgerOptions,
  AuditLedgerSink,
  QueryFilter,
} from "../types/audit-ledger.js";
export type {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  CircuitState,
} from "../types/plugin-circuit-breaker.js";
export type {
  ClobberAlertEvent,
  ClobberAlertPluginOptions,
  ClobberSummaryEvent,
} from "../types/plugin-clobber-alert.js";
export type {
  ClobberLoopDetectedEvent,
  ClobberLoopPluginHandle,
  ClobberLoopPluginOptions,
  ClobberLoopResolvedEvent,
} from "../types/plugin-clobber-loop.js";
export type {
  DevtoolsPluginOptions,
  TraceEvent,
} from "../types/plugin-devtools.js";
export type { LoggingPluginOptions } from "../types/plugin-logging.js";
export type {
  AggregatedMetric,
  AlertConfig,
  AlertEvent,
  DashboardData,
  HistogramBucket,
  MetricDataPoint,
  MetricType,
  ObservabilityConfig,
  ObservabilityInstance,
  TraceSpan,
} from "../types/plugin-observability.js";
export type {
  OTLPExporter,
  OTLPExporterConfig,
} from "../types/plugin-otlp-exporter.js";
export type {
  ConstraintMetrics,
  EffectMetrics,
  PerformancePluginOptions,
  PerformanceSnapshot,
  ReconcileMetrics,
  ResolverMetrics,
} from "../types/plugin-performance.js";
export type { NormalizedTokenUsage } from "../types/plugin-token-usage.js";
