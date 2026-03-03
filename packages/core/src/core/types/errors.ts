/**
 * Error Types - Type definitions for error handling
 */

// ============================================================================
// Error Types
// ============================================================================

/** Error source types */
export type ErrorSource =
  | "constraint"
  | "resolver"
  | "effect"
  | "derivation"
  | "system";

/**
 * Extended Error class with source tracking, recovery metadata, and
 * arbitrary context for structured error handling within Directive.
 *
 * Thrown or returned by the error boundary manager. The `source` and
 * `sourceId` fields identify where the error originated, and `recoverable`
 * indicates whether the engine can apply a recovery strategy.
 *
 * @param message - Human-readable error description
 * @param source - Which subsystem produced the error (`"constraint"`, `"resolver"`, `"effect"`, `"derivation"`, or `"system"`)
 * @param sourceId - The ID of the specific constraint, resolver, effect, or derivation that failed
 * @param context - Optional arbitrary data for debugging (e.g., the requirement that triggered a resolver error)
 * @param recoverable - Whether the error boundary can apply a recovery strategy (default `true`; `false` for system errors)
 *
 * @example
 * ```ts
 * try {
 *   await system.settle();
 * } catch (err) {
 *   if (err instanceof DirectiveError) {
 *     console.log(err.source);      // "resolver"
 *     console.log(err.sourceId);    // "fetchUser"
 *     console.log(err.recoverable); // true
 *   }
 * }
 * ```
 */
export class DirectiveError extends Error {
  constructor(
    message: string,
    public readonly source: ErrorSource,
    public readonly sourceId: string,
    public readonly context?: unknown,
    public readonly recoverable: boolean = true,
  ) {
    super(message);
    this.name = "DirectiveError";
  }
}

/** Recovery strategy for errors */
export type RecoveryStrategy =
  | "skip"
  | "retry"
  | "retry-later"
  | "disable"
  | "throw";

/**
 * Configuration for retry-later strategy.
 * When an error occurs, the system will wait for `delayMs` before retrying.
 */
export interface RetryLaterConfig {
  /** Delay in milliseconds before retrying (default: 1000) */
  delayMs?: number;
  /** Maximum retries before giving up (default: 3) */
  maxRetries?: number;
  /** Backoff multiplier for each retry (default: 2) */
  backoffMultiplier?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
}

/** Error boundary configuration */
export interface ErrorBoundaryConfig {
  onConstraintError?:
    | RecoveryStrategy
    | ((error: Error, constraint: string) => RecoveryStrategy | void);
  onResolverError?:
    | RecoveryStrategy
    | ((error: Error, resolver: string) => RecoveryStrategy | void);
  onEffectError?:
    | RecoveryStrategy
    | ((error: Error, effect: string) => RecoveryStrategy | void);
  onDerivationError?:
    | RecoveryStrategy
    | ((error: Error, derivation: string) => RecoveryStrategy | void);
  onError?: (error: DirectiveError) => void;

  /** Configuration for retry-later strategy */
  retryLater?: RetryLaterConfig;
}
