/**
 * Shared guardrail and retry utilities — used by both single-agent and multi-agent orchestrators.
 *
 * Extracted from agent-orchestrator.ts to enable reuse without circular dependencies.
 * Internal module — not a public subpath export.
 *
 * @module
 */

import type {
  GuardrailFn,
  GuardrailContext,
  GuardrailResult,
  GuardrailRetryConfig,
  AgentRetryConfig,
  NamedGuardrail,
  AgentLike,
  AgentRunner,
  RunResult,
  RunOptions,
} from "./types.js";

// ============================================================================
// Guardrail Helpers
// ============================================================================

/** Normalize a guardrail to a named guardrail */
export function normalizeGuardrail<T>(
  guardrail: GuardrailFn<T> | NamedGuardrail<T>,
  index: number,
  type: string
): NamedGuardrail<T> {
  if (typeof guardrail === "function") {
    return {
      name: `${type}-guardrail-${index}`,
      fn: guardrail,
      critical: true,
    };
  }

  return guardrail;
}

/** Calculate delay for retry with backoff */
export function calculateRetryDelay(
  attempt: number,
  config: GuardrailRetryConfig
): number {
  const { backoff = "exponential", baseDelayMs = 100, maxDelayMs = 5000 } = config;
  let delay: number;
  switch (backoff) {
    case "exponential":
      delay = baseDelayMs * Math.pow(2, attempt - 1);
      break;
    case "linear":
      delay = baseDelayMs * attempt;
      break;
    case "fixed":
    default:
      delay = baseDelayMs;
  }

  return Math.min(delay, maxDelayMs);
}

/** Sleep that respects an abort signal — resolves early if aborted */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("Aborted"));
  }

  return new Promise<void>((resolve, reject) => {
    if (!signal) {
      setTimeout(resolve, ms);

      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Execute a guardrail with retry support */
export async function executeGuardrailWithRetry<T>(
  guardrail: NamedGuardrail<T>,
  data: T,
  context: GuardrailContext,
  signal?: AbortSignal
): Promise<GuardrailResult> {
  const { retry } = guardrail;
  const maxAttempts = Math.max(retry?.attempts ?? 1, 1);

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await guardrail.fn(data, context);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Only retry if we have more attempts left
      if (attempt < maxAttempts) {
        const delay = calculateRetryDelay(attempt, retry ?? {});
        await abortableDelay(delay, signal);
      }
    }
  }

  // All retries exhausted — return structured failure instead of raw throw
  // so callers can classify this as a guardrail failure, not an unhandled error
  return {
    passed: false,
    reason: `Guardrail "${guardrail.name}" failed after ${maxAttempts} attempt(s): ${lastError!.message}`,
  };
}

// ============================================================================
// Agent Retry Helpers
// ============================================================================

/** Calculate delay for agent retry with backoff */
export function calculateAgentRetryDelay(
  attempt: number,
  config: AgentRetryConfig
): number {
  const { backoff = "exponential", baseDelayMs = 1000, maxDelayMs = 30000 } = config;
  let delay: number;
  switch (backoff) {
    case "exponential":
      delay = baseDelayMs * Math.pow(2, attempt - 1);
      break;
    case "linear":
      delay = baseDelayMs * attempt;
      break;
    case "fixed":
    default:
      delay = baseDelayMs;
  }

  return Math.min(delay, maxDelayMs);
}

/** Execute an agent run with retry support */
export async function executeAgentWithRetry<T>(
  runner: AgentRunner,
  agent: AgentLike,
  input: string,
  options: RunOptions | undefined,
  retryConfig: AgentRetryConfig | undefined
): Promise<RunResult<T>> {
  const maxAttempts = Math.max(retryConfig?.attempts ?? 1, 1);
  const isRetryable = retryConfig?.isRetryable ?? (() => true);
  const onRetry = retryConfig?.onRetry;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runner<T>(agent, input, options);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable and we have more attempts
      if (attempt < maxAttempts) {
        let retryable = true;
        try {
          retryable = isRetryable(lastError);
        } catch {
          // If isRetryable itself throws, treat as non-retryable
          break;
        }
        if (!retryable) {
          break;
        }
        const delay = calculateAgentRetryDelay(attempt, retryConfig ?? {});
        try {
          onRetry?.(attempt, lastError, delay);
        } catch {
          // onRetry is best-effort — don't let callback errors disrupt retry logic
        }
        await abortableDelay(delay, options?.signal);
      } else {
        // Out of attempts
        break;
      }
    }
  }
  // All retries exhausted, throw the last error
  throw lastError!;
}
