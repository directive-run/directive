/**
 * `@directive-run/core/plugins` on core-next. Each 1.35 plugin lands here at
 * its layer; at L6 the persistence plugin. The rest are stubs with 1.35's
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
import type {
  CircuitBreaker,
  CircuitBreakerConfig,
} from "../types/plugin-circuit-breaker.js";
import type { ClobberAlertPluginOptions } from "../types/plugin-clobber-alert.js";
import type {
  ClobberLoopPluginHandle,
  ClobberLoopPluginOptions,
} from "../types/plugin-clobber-loop.js";
import type { DevtoolsPluginOptions } from "../types/plugin-devtools.js";
import type { LoggingPluginOptions } from "../types/plugin-logging.js";
import type {
  ObservabilityConfig,
  ObservabilityInstance,
} from "../types/plugin-observability.js";
import type {
  OTLPExporter,
  OTLPExporterConfig,
} from "../types/plugin-otlp-exporter.js";
import type {
  PerformancePluginOptions,
  PerformanceSnapshot,
} from "../types/plugin-performance.js";
import type { NormalizedTokenUsage } from "../types/plugin-token-usage.js";

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

// --- not built yet (layer 12): 1.35's exports, throwing when called ---------

/** 1.35's error class: constructing it throws until the circuit breaker lands. */
export class CircuitBreakerOpenError extends Error {
  declare readonly code: "CIRCUIT_OPEN";
  declare readonly retryAfterMs: number;
  declare readonly state: "OPEN" | "HALF_OPEN";
  constructor(
    name: string,
    retryAfterMs: number,
    state?: "OPEN" | "HALF_OPEN",
    detail?: string,
  );
  constructor() {
    super();
    featureMissing("CircuitBreakerOpenError", 12);
  }
}

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

export function createAgentMetrics(obs: ObservabilityInstance): {
  trackRun(
    agentName: string,
    result: {
      success: boolean;
      latencyMs: number;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      cacheCreationTokens?: number;
      cost?: number;
      toolCalls?: number;
    },
  ): void;
  trackGuardrail(
    guardrailName: string,
    result: {
      passed: boolean;
      latencyMs: number;
      blocked?: boolean;
    },
  ): void;
  trackApproval(
    toolName: string,
    result: {
      approved: boolean;
      waitTimeMs: number;
      timedOut?: boolean;
    },
  ): void;
  trackHandoff(fromAgent: string, toAgent: string, latencyMs: number): void;
};
export function createAgentMetrics(): never {
  return featureMissing("createAgentMetrics", 12);
}

export function createAuditLedger(opts?: AuditLedgerOptions): AuditLedger;
export function createAuditLedger(): never {
  return featureMissing("createAuditLedger", 12);
}

export function createCircuitBreaker(
  config?: CircuitBreakerConfig,
): CircuitBreaker;
export function createCircuitBreaker(): never {
  return featureMissing("createCircuitBreaker", 12);
}

export function createOTLPExporter(config: OTLPExporterConfig): OTLPExporter;
export function createOTLPExporter(): never {
  return featureMissing("createOTLPExporter", 12);
}

export function createObservability(
  config?: ObservabilityConfig,
): ObservabilityInstance;
export function createObservability(): never {
  return featureMissing("createObservability", 12);
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

export function loggingPlugin<M extends ModuleSchema = ModuleSchema>(
  options?: LoggingPluginOptions,
): Plugin<M>;
export function loggingPlugin(): never {
  return featureMissing("loggingPlugin", 12);
}

export function memorySink(opts?: {
  capacity?: number;
}): AuditLedgerSink;
export function memorySink(): never {
  return featureMissing("memorySink", 12);
}

export function normalizeTokenUsage(usage: unknown): NormalizedTokenUsage;
export function normalizeTokenUsage(): never {
  return featureMissing("normalizeTokenUsage", 12);
}

export function performancePlugin<M extends ModuleSchema = ModuleSchema>(
  options?: PerformancePluginOptions,
): Plugin<M> & {
  getSnapshot(): PerformanceSnapshot;
  reset(): void;
};
export function performancePlugin(): never {
  return featureMissing("performancePlugin", 12);
}
