/**
 * `@directive-run/core/plugins` on core-next. Each 1.35 plugin lands here at
 * its layer; at L6 the persistence plugin, at L12b logging, performance,
 * observability, agent metrics, OTLP, token usage and the circuit breaker. The
 * rest are stubs with 1.35's
 * names and signatures that throw `featureMissing` when called (P3-F3): they
 * arrive in layer 12.
 */
import { featureMissing } from "../api/missing.js";
import type {
  AuditLedger,
  AuditLedgerOptions,
  AuditLedgerSink,
} from "../types/audit-ledger.js";
import type { ModuleSchema, Plugin } from "../types/index.js";
import type { ClobberAlertPluginOptions } from "../types/plugin-clobber-alert.js";
import type {
  ClobberLoopPluginHandle,
  ClobberLoopPluginOptions,
} from "../types/plugin-clobber-loop.js";
import type { DevtoolsPluginOptions } from "../types/plugin-devtools.js";

export {
  CircuitBreakerOpenError,
  createCircuitBreaker,
} from "./circuit-breaker.js";
export { loggingPlugin } from "./logging.js";
export { createAgentMetrics, createObservability } from "./observability.js";
export { createOTLPExporter } from "./otlp-exporter.js";
export { performancePlugin } from "./performance.js";
export { persistencePlugin } from "./persistence.js";
export { normalizeTokenUsage } from "./token-usage.js";
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

/** 1.35's value (a constant, not a feature). */
export const DEVTOOLS_EVENT_NAME = "directive-devtools-event";

export function clobberAlertPlugin<M extends ModuleSchema>(
  options?: ClobberAlertPluginOptions,
): Plugin<M>;
export function clobberAlertPlugin(): never {
  return featureMissing("clobberAlertPlugin", 12);
}

export function clobberLoopPlugin<M extends ModuleSchema>(
  options?: ClobberLoopPluginOptions,
): ClobberLoopPluginHandle<M>;
export function clobberLoopPlugin(): never {
  return featureMissing("clobberLoopPlugin", 12);
}

export function createAuditLedger(opts?: AuditLedgerOptions): AuditLedger;
export function createAuditLedger(): never {
  return featureMissing("createAuditLedger", 12);
}

export function devtoolsPlugin<M extends ModuleSchema = ModuleSchema>(
  options?: DevtoolsPluginOptions,
): Plugin<M>;
export function devtoolsPlugin(): never {
  return featureMissing("devtoolsPlugin", 12);
}

export function emitDevToolsEvent(
  event: Record<string, unknown> & {
    type: string;
  },
): void;
export function emitDevToolsEvent(): never {
  return featureMissing("emitDevToolsEvent", 12);
}

export function memorySink(opts?: {
  capacity?: number;
}): AuditLedgerSink;
export function memorySink(): never {
  return featureMissing("memorySink", 12);
}
