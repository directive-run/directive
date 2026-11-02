/**
 * Copied from 1.35 (packages/core/src/plugins/circuit-breaker.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

import type { ObservabilityInstance } from "./plugin-observability.js";

// ============================================================================
// Types
// ============================================================================

/** Circuit breaker states */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/** Circuit breaker configuration */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms before transitioning from OPEN to HALF_OPEN (default: 30000) */
  recoveryTimeMs?: number;
  /** Number of requests allowed in HALF_OPEN state (default: 3) */
  halfOpenMaxRequests?: number;
  /** Time window in ms for counting failures (default: 60000). Failures outside this window are forgotten. */
  failureWindowMs?: number;
  /** Optional observability instance for automatic metric tracking */
  observability?: ObservabilityInstance;
  /** Metric name prefix for observability (default: "circuit_breaker") */
  metricPrefix?: string;
  /** Name for this circuit breaker (used in metrics and errors) */
  name?: string;
  /** Custom error classifier. Return true if the error should count as a failure. Default: all errors count. */
  isFailure?: (error: Error) => boolean;
  /** Callback when state changes */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

/** Circuit breaker statistics */
export interface CircuitBreakerStats {
  state: CircuitState;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  totalRejected: number;
  recentFailures: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  lastStateChange: number;
}

/** Circuit breaker instance */
export interface CircuitBreaker {
  /** Execute an operation through the circuit breaker */
  execute<T>(fn: () => Promise<T>): Promise<T>;
  /** Get the current state */
  getState(): CircuitState;
  /** Get statistics */
  getStats(): CircuitBreakerStats;
  /** Force the circuit to a specific state (useful for testing) */
  forceState(state: CircuitState): void;
  /** Reset the circuit breaker to CLOSED with cleared stats */
  reset(): void;
  /** Check if a request would be allowed (without executing) */
  isAllowed(): boolean;
}
