/**
 * P2: Intelligent Retry — HTTP-status-aware retry wrapper for AgentRunner.
 *
 * Respects 429 Retry-After headers, uses exponential backoff with jitter for 503,
 * and never retries client errors (400/401/403/404/422).
 *
 * @module
 *
 * @example
 * ```typescript
 * import { withRetry, RetryExhaustedError } from '@directive-run/ai';
 *
 * const runner = withRetry(baseRunner, {
 *   maxRetries: 3,
 *   baseDelayMs: 1000,
 *   maxDelayMs: 30000,
 *   onRetry: (attempt, error, delayMs) => {
 *     console.log(`Retry ${attempt} in ${delayMs}ms: ${error.message}`);
 *   },
 * });
 *
 * try {
 *   const result = await runner(agent, input);
 * } catch (err) {
 *   if (err instanceof RetryExhaustedError) {
 *     console.error(`All ${err.retryCount} retries failed:`, err.lastError);
 *   }
 * }
 * ```
 */

import type { AgentRunner, AgentLike, RunResult, RunOptions } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the intelligent retry wrapper.
 *
 * @example
 * ```typescript
 * const config: RetryConfig = {
 *   maxRetries: 3,
 *   baseDelayMs: 1000,
 *   maxDelayMs: 30000,
 *   isRetryable: (error) => !error.message.includes("invalid API key"),
 *   onRetry: (attempt, error, delayMs) => {
 *     console.log(`Retry ${attempt} after ${delayMs}ms: ${error.message}`);
 *   },
 * };
 * ```
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (not counting the initial call). @default 3 */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. @default 1000 */
  baseDelayMs?: number;
  /** Maximum delay in ms (caps exponential growth). @default 30000 */
  maxDelayMs?: number;
  /** Custom predicate — return `false` to skip retry for specific errors. Called after the built-in HTTP status check. */
  isRetryable?: (error: Error) => boolean;
  /** Called before each retry wait. Useful for logging or metrics. */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

/** Error enriched with retry metadata, thrown when all retries are exhausted. */
export class RetryExhaustedError extends Error {
  readonly retryCount: number;
  readonly lastError: Error;

  constructor(retryCount: number, lastError: Error) {
    super(`[Directive] All ${retryCount} retries exhausted: ${lastError.message}`);
    this.name = "RetryExhaustedError";
    this.retryCount = retryCount;
    this.lastError = lastError;
    this.cause = lastError;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** HTTP status codes that should never be retried. */
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422]);

/**
 * Extract HTTP status code from error message or error properties.
 *
 * Checks `error.status` / `error.statusCode` properties first, then falls back
 * to matching common error message patterns like "request failed: 429" or "HTTP 503".
 */
export function parseHttpStatus(error: Error): number | null {
  // Check error properties first (many HTTP libraries set these)
  const errObj = error as unknown as Record<string, unknown>;
  if (typeof errObj.status === "number" && errObj.status >= 100 && errObj.status <= 599) {
    return errObj.status;
  }
  if (typeof errObj.statusCode === "number" && errObj.statusCode >= 100 && errObj.statusCode <= 599) {
    return errObj.statusCode;
  }

  // Match common error message patterns:
  // "request failed: 429", "HTTP 503", "status 401", "Error 400"
  // Guard against scanning very large error messages (ReDoS protection)
  const msg = error.message.length > 1000 ? error.message.slice(0, 1000) : error.message;
  const match = msg.match(/(?:failed|error|status|http)[:\s]+(\d{3})\b/i);
  if (!match) {
    return null;
  }

  const status = Number(match[1]);
  if (status >= 100 && status <= 599) {
    return status;
  }

  return null;
}

/**
 * Extract Retry-After value (in ms) from error message.
 *
 * Per HTTP spec, `Retry-After` numeric values are always in seconds.
 * Returns the value converted to milliseconds.
 */
export function parseRetryAfter(error: Error): number | null {
  // Check error properties first (many HTTP libraries set these)
  const errObj = error as unknown as Record<string, unknown>;
  if (typeof errObj.retryAfter === "number" && errObj.retryAfter > 0) {
    return errObj.retryAfter * 1000;
  }

  // Guard against scanning very large error messages (ReDoS protection)
  const msg = error.message.length > 1000 ? error.message.slice(0, 1000) : error.message;
  const match = msg.match(/retry[- ]?after[:\s]+(\d+)/i);
  if (!match) {
    return null;
  }

  const seconds = Number(match![1]);
  if (seconds > 0) {
    return seconds * 1000;
  }

  return null;
}

/** Calculate delay with exponential backoff and jitter. */
function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * baseDelayMs * 0.5;
  const delay = exponential + jitter;

  return Math.min(delay, maxDelayMs);
}

/** Determine delay for a given error and attempt. */
function getRetryDelay(
  error: Error,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const status = parseHttpStatus(error);

  // 429: Prefer Retry-After header value
  if (status === 429) {
    const retryAfter = parseRetryAfter(error);
    if (retryAfter !== null) {
      return Math.min(retryAfter, maxDelayMs);
    }
  }

  // All retryable statuses: exponential backoff with jitter
  return calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs);
}

/** Check if an error is retryable based on HTTP status. */
function isStatusRetryable(error: Error): boolean {
  const status = parseHttpStatus(error);
  if (status === null) {
    // No HTTP status — default to retryable (network errors, timeouts, etc.)
    return true;
  }

  return !NON_RETRYABLE_STATUSES.has(status);
}

// ============================================================================
// Wrapper
// ============================================================================

/**
 * Wrap an AgentRunner with intelligent retry logic.
 *
 * @example
 * ```typescript
 * const runner = withRetry(baseRunner, {
 *   maxRetries: 3,
 *   baseDelayMs: 1000,
 *   onRetry: (attempt, error, delayMs) => {
 *     console.log(`Retry ${attempt} after ${delayMs}ms: ${error.message}`);
 *   },
 * });
 * ```
 */
export function withRetry(runner: AgentRunner, config: RetryConfig = {}): AgentRunner {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    isRetryable,
    onRetry,
  } = config;

  // Validate config
  if (!Number.isFinite(maxRetries) || maxRetries < 0) {
    throw new Error("[Directive] withRetry: maxRetries must be a non-negative finite number.");
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new Error("[Directive] withRetry: baseDelayMs must be a non-negative finite number.");
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0) {
    throw new Error("[Directive] withRetry: maxDelayMs must be a non-negative finite number.");
  }

  return async <T = unknown>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<T>> => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await runner<T>(agent, input, options);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check if we should retry
        if (attempt >= maxRetries) {
          break;
        }

        // Check custom retryable predicate
        if (isRetryable) {
          try {
            if (!isRetryable(lastError)) {
              break;
            }
          } catch {
            // isRetryable threw — treat as non-retryable
            break;
          }
        }

        // Check HTTP status retryability
        if (!isStatusRetryable(lastError)) {
          break;
        }

        // Calculate delay
        const delayMs = getRetryDelay(lastError, attempt + 1, baseDelayMs, maxDelayMs);
        try { onRetry?.(attempt + 1, lastError, delayMs); } catch { /* callback error must not disrupt retry flow */ }

        // Wait before retrying (abortable via signal)
        const signal = options?.signal;
        if (signal?.aborted) {
          break;
        }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          }, delayMs);
          function onAbort() {
            clearTimeout(timer);
            reject(signal!.reason ?? new Error("Aborted"));
          }
          if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        });
      }
    }

    // All retries exhausted
    throw new RetryExhaustedError(maxRetries, lastError!);
  };
}
