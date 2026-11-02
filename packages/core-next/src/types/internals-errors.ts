/**
 * Copied from 1.35 (packages/core/src/core/errors.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

import type {
  DirectiveError,
  ErrorBoundaryConfig,
  ErrorSource,
  RecoveryStrategy,
  RetryLaterConfig,
} from "./index.js";

// ============================================================================
// Retry-Later Queue
// ============================================================================

/**
 * A queued retry entry tracking its source, attempt count, and scheduled time.
 *
 * @internal
 */
export interface PendingRetry {
  source: ErrorSource;
  sourceId: string;
  context: unknown;
  attempt: number;
  nextRetryTime: number;
  callback?: () => void;
}

export declare function createRetryLaterManager(config?: RetryLaterConfig): {
  /** Schedule a retry */
  scheduleRetry: (
    source: ErrorSource,
    sourceId: string,
    context: unknown,
    attempt: number,
    callback?: () => void,
  ) => PendingRetry | null;
  /** Get pending retries */
  getPendingRetries: () => PendingRetry[];
  /** Process due retries */
  processDueRetries: () => PendingRetry[];
  /** Cancel a retry */
  cancelRetry: (sourceId: string) => void;
  /** Clear all pending retries */
  clearAll: () => void;
};

// ============================================================================
// Error Boundary Manager
// ============================================================================

/**
 * Handle returned by {@link createErrorBoundaryManager} for routing errors
 * through configurable recovery strategies.
 *
 * @internal
 */
export interface ErrorBoundaryManager {
  /**
   * Route an error through the configured recovery strategy for its source.
   *
   * @param source - The subsystem that produced the error.
   * @param sourceId - Identifier of the specific constraint, resolver, effect, or derivation.
   * @param error - The thrown value (coerced to {@link DirectiveError} internally).
   * @param context - Optional context forwarded to callbacks and retry entries.
   * @returns The {@link RecoveryStrategy} that was applied.
   */
  handleError(
    source: ErrorSource,
    sourceId: string,
    error: unknown,
    context?: unknown,
  ): RecoveryStrategy;
  /**
   * Return the most recently recorded error, or `null` if none exist.
   *
   * @returns The last {@link DirectiveError}, or `null`.
   */
  getLastError(): DirectiveError | null;
  /**
   * Return a snapshot array of all recorded errors (up to the last 100).
   *
   * @returns A shallow copy of the internal error ring buffer.
   */
  getAllErrors(): DirectiveError[];
  /** Clear all recorded errors. */
  clearErrors(): void;
  /**
   * Access the underlying retry-later manager for advanced scheduling.
   *
   * @returns The {@link createRetryLaterManager} instance used internally.
   */
  getRetryLaterManager(): ReturnType<typeof createRetryLaterManager>;
  /**
   * Drain and return retry entries whose scheduled time has elapsed.
   *
   * @returns An array of {@link PendingRetry} entries that are now due.
   */
  processDueRetries(): PendingRetry[];
  /**
   * Reset retry attempt tracking for a source, typically after a successful resolution.
   *
   * @param sourceId - The source identifier whose retry counter should be cleared.
   */
  clearRetryAttempts(sourceId: string): void;
}

/**
 * Options accepted by {@link createErrorBoundaryManager}.
 *
 * @internal
 */
export interface CreateErrorBoundaryOptions {
  /** Per-source recovery strategies and retry-later tuning. */
  config?: ErrorBoundaryConfig;
  /** Invoked every time an error is recorded, before the recovery strategy runs. */
  onError?: (error: DirectiveError) => void;
  /** Invoked after a recovery strategy has been selected for an error. */
  onRecovery?: (error: DirectiveError, strategy: RecoveryStrategy) => void;
}
