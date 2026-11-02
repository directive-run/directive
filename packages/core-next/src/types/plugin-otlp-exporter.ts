/**
 * Copied from 1.35 (packages/core/src/plugins/otlp-exporter.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

import type { AggregatedMetric, TraceSpan } from "./plugin-observability.js";

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
