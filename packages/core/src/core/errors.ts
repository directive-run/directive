/**
 * Error Boundaries - Configurable error handling and recovery
 *
 * Features:
 * - Catch errors in constraints/resolvers/effects/derivations
 * - Configurable recovery strategies (skip, retry, retry-later, disable, throw)
 * - Circuit breaker pattern for automatic failure protection
 * - Error reporting to plugins
 */

import {
  DirectiveError,
  type ErrorBoundaryConfig,
  type ErrorSource,
  type RecoveryStrategy,
  type RetryLaterConfig,
} from "./types.js";

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

/**
 * Create a manager for deferred retry scheduling with exponential backoff.
 *
 * @remarks
 * Retries are stored in a Map keyed by source ID. Each entry tracks its
 * attempt number and the timestamp of the next eligible retry. When
 * {@link createRetryLaterManager | processDueRetries} is called (typically
 * during reconciliation), entries whose scheduled time has elapsed are
 * returned and removed from the queue. The delay grows exponentially:
 * `delayMs * backoffMultiplier^(attempt - 1)`, capped at `maxDelayMs`.
 *
 * @param config - Backoff configuration including `delayMs`, `maxRetries`, `backoffMultiplier`, and `maxDelayMs`.
 * @returns A manager exposing `scheduleRetry`, `getPendingRetries`, `processDueRetries`, `cancelRetry`, and `clearAll` methods.
 *
 * @internal
 */
export function createRetryLaterManager(config: RetryLaterConfig = {}): {
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
} {
  const {
    delayMs = 1000,
    maxRetries = 3,
    backoffMultiplier = 2,
    maxDelayMs = 30000,
  } = config;

  const pendingRetries: Map<string, PendingRetry> = new Map();

  function calculateDelay(attempt: number): number {
    const delay = delayMs * backoffMultiplier ** (attempt - 1);
    return Math.min(delay, maxDelayMs);
  }

  return {
    scheduleRetry(
      source: ErrorSource,
      sourceId: string,
      context: unknown,
      attempt: number,
      callback?: () => void,
    ): PendingRetry | null {
      // Check if max retries exceeded
      if (attempt > maxRetries) {
        return null;
      }

      const delay = calculateDelay(attempt);
      const entry: PendingRetry = {
        source,
        sourceId,
        context,
        attempt,
        nextRetryTime: Date.now() + delay,
        callback,
      };

      pendingRetries.set(sourceId, entry);
      return entry;
    },

    getPendingRetries(): PendingRetry[] {
      return Array.from(pendingRetries.values());
    },

    processDueRetries(): PendingRetry[] {
      const now = Date.now();
      const dueRetries: PendingRetry[] = [];

      for (const [sourceId, entry] of pendingRetries) {
        if (entry.nextRetryTime <= now) {
          dueRetries.push(entry);
          pendingRetries.delete(sourceId);
        }
      }

      return dueRetries;
    },

    cancelRetry(sourceId: string): void {
      pendingRetries.delete(sourceId);
    },

    clearAll(): void {
      pendingRetries.clear();
    },
  };
}

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

/** Default recovery strategies by source */
const DEFAULT_STRATEGIES: Record<ErrorSource, RecoveryStrategy> = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};

/**
 * Create a manager that handles errors from constraints, resolvers, effects,
 * and derivations with configurable per-source recovery strategies.
 *
 * @remarks
 * Five recovery strategies are available:
 *
 * - `"skip"` -- Swallow the error and continue.
 * - `"retry"` -- Signal the caller to retry immediately.
 * - `"retry-later"` -- Enqueue a deferred retry with exponential backoff
 *   (delegated to an internal {@link createRetryLaterManager}).
 * - `"disable"` -- Permanently disable the failing source.
 * - `"throw"` -- Re-throw the error as a {@link DirectiveError}.
 *
 * Recent errors are kept in a ring buffer (last 100) for inspection via
 * {@link ErrorBoundaryManager.getAllErrors | getAllErrors}. Each strategy
 * can be configured per source type (`onConstraintError`, `onResolverError`,
 * etc.) or as a callback that dynamically selects a strategy.
 *
 * @param options - Error boundary configuration, plus `onError` and `onRecovery` callbacks for plugin integration.
 * @returns An {@link ErrorBoundaryManager} for routing errors through the configured strategies.
 *
 * @internal
 */
export function createErrorBoundaryManager(
  options: CreateErrorBoundaryOptions = {},
): ErrorBoundaryManager {
  const { config = {}, onError, onRecovery } = options;

  // Store errors for inspection
  const errors: DirectiveError[] = [];
  const maxErrors = 100; // Keep last 100 errors

  // Retry-later manager
  const retryLaterManager = createRetryLaterManager(config.retryLater);

  // Track retry attempts per source ID
  const retryAttempts = new Map<string, number>();

  /** Convert unknown error to DirectiveError */
  function toDirectiveError(
    source: ErrorSource,
    sourceId: string,
    error: unknown,
    context?: unknown,
  ): DirectiveError {
    if (error instanceof DirectiveError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const recoverable = source !== "system";

    return new DirectiveError(message, source, sourceId, context, recoverable);
  }

  /** Get recovery strategy for a source */
  function getStrategy(
    source: ErrorSource,
    sourceId: string,
    error: Error,
  ): RecoveryStrategy {
    // Get configured handler
    const handler = (() => {
      switch (source) {
        case "constraint":
          return config.onConstraintError;
        case "resolver":
          return config.onResolverError;
        case "effect":
          return config.onEffectError;
        case "derivation":
          return config.onDerivationError;
        default:
          return undefined;
      }
    })();

    // If handler is a function, call it — use returned strategy if provided, else "skip"
    if (typeof handler === "function") {
      try {
        const result = handler(error, sourceId);

        if (typeof result === "string") {
          return result as RecoveryStrategy;
        }
      } catch (e) {
        console.error("[Directive] Error in error handler callback:", e);
      }

      return "skip";
    }

    // If handler is a strategy string, return it
    if (typeof handler === "string") {
      return handler;
    }

    // Return default strategy
    return DEFAULT_STRATEGIES[source];
  }

  const manager: ErrorBoundaryManager = {
    handleError(
      source: ErrorSource,
      sourceId: string,
      error: unknown,
      context?: unknown,
    ): RecoveryStrategy {
      const directiveError = toDirectiveError(source, sourceId, error, context);

      // Store error
      errors.push(directiveError);
      if (errors.length > maxErrors) {
        errors.shift();
      }

      // Notify callbacks (wrapped to prevent bypassing recovery)
      try {
        onError?.(directiveError);
      } catch (e) {
        console.error("[Directive] Error in onError callback:", e);
      }
      try {
        config.onError?.(directiveError);
      } catch (e) {
        console.error("[Directive] Error in config.onError callback:", e);
      }

      // Get recovery strategy
      let strategy = getStrategy(
        source,
        sourceId,
        error instanceof Error ? error : new Error(String(error)),
      );

      // Handle retry-later strategy
      if (strategy === "retry-later") {
        const attempt = (retryAttempts.get(sourceId) ?? 0) + 1;
        retryAttempts.set(sourceId, attempt);

        const scheduled = retryLaterManager.scheduleRetry(
          source,
          sourceId,
          context,
          attempt,
        );

        if (!scheduled) {
          // Max retries exceeded, fall back to skip
          strategy = "skip";
          retryAttempts.delete(sourceId);

          if (
            typeof process !== "undefined" &&
            process.env?.NODE_ENV !== "production"
          ) {
            console.warn(
              `[Directive] ${source} "${sourceId}" exceeded max retry-later attempts. Skipping.`,
            );
          }
        }
      }

      // Notify recovery callback
      try {
        onRecovery?.(directiveError, strategy);
      } catch (e) {
        console.error("[Directive] Error in onRecovery callback:", e);
      }

      // If strategy is throw, re-throw the error
      if (strategy === "throw") {
        throw directiveError;
      }

      return strategy;
    },

    getLastError(): DirectiveError | null {
      return errors[errors.length - 1] ?? null;
    },

    getAllErrors(): DirectiveError[] {
      return [...errors];
    },

    clearErrors(): void {
      errors.length = 0;
    },

    getRetryLaterManager() {
      return retryLaterManager;
    },

    processDueRetries(): PendingRetry[] {
      return retryLaterManager.processDueRetries();
    },

    clearRetryAttempts(sourceId: string): void {
      retryAttempts.delete(sourceId);
      retryLaterManager.cancelRetry(sourceId);
    },
  };

  return manager;
}
