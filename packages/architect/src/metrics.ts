/**
 * Metrics & Observability — pluggable instrumentation for AI Architect.
 *
 * Provides a MetricsProvider interface for counters, gauges, histograms,
 * and optional distributed tracing spans. Ships with a no-op default
 * that adds zero overhead when no provider is configured.
 */

// ============================================================================
// Types
// ============================================================================

/** Handle for an active tracing span. */
export interface SpanHandle {
  setAttribute(key: string, value: string | number | boolean): void;
  setError(error: Error): void;
  end(): void;
}

/** Pluggable metrics provider for counters, gauges, histograms, and spans. */
export interface MetricsProvider {
  /** Increment a counter by delta (default 1). */
  counter(name: string, delta?: number, labels?: Record<string, string>): void;
  /** Set a gauge to an absolute value. */
  gauge(name: string, value: number, labels?: Record<string, string>): void;
  /** Record a value in a histogram (e.g., duration, token count). */
  histogram(name: string, value: number, labels?: Record<string, string>): void;
  /** Start a tracing span. Optional — no-op if not implemented. */
  startSpan?(name: string, attributes?: Record<string, string | number | boolean>): SpanHandle;
  /** Initialize the provider (e.g., connect to backend). */
  init?(): Promise<void>;
  /** Flush and close the provider. */
  close?(): Promise<void>;
}

// ============================================================================
// No-Op Implementation
// ============================================================================

const NOOP_SPAN: SpanHandle = {
  setAttribute() {},
  setError() {},
  end() {},
};

/**
 * Create a no-op metrics provider. All methods are empty — zero overhead.
 * Used as the default when no provider is configured.
 *
 * @returns A MetricsProvider where all methods are no-ops.
 */
export function createNoopMetrics(): MetricsProvider {
  return {
    counter() {},
    gauge() {},
    histogram() {},
    startSpan() {
      return NOOP_SPAN;
    },
  };
}
