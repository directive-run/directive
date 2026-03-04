/**
 * Shared guardrail and retry utilities — used by both single-agent and multi-agent orchestrators.
 *
 * Extracted from agent-orchestrator.ts to enable reuse without circular dependencies.
 * Internal module — not a public subpath export.
 *
 * @module
 */

import type {
  AgentLike,
  AgentRetryConfig,
  AgentRunner,
  GuardrailContext,
  GuardrailFn,
  GuardrailResult,
  GuardrailRetryConfig,
  NamedGuardrail,
  RunOptions,
  RunResult,
} from "./types.js";

// ============================================================================
// Guardrail Helpers
// ============================================================================

/**
 * Normalize a bare guardrail function or a {@link NamedGuardrail} into a consistent
 * {@link NamedGuardrail} shape. Bare functions are wrapped with a generated name
 * and `critical: true` by default.
 *
 * @param guardrail - A guardrail function or named guardrail object.
 * @param index - Positional index used to generate a unique name for bare functions.
 * @param type - Guardrail category label (e.g. `"input"`, `"output"`) included in the generated name.
 * @returns A {@link NamedGuardrail} with a guaranteed `name`, `fn`, and `critical` flag.
 */
export function normalizeGuardrail<T>(
  guardrail: GuardrailFn<T> | NamedGuardrail<T>,
  index: number,
  type: string,
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

/**
 * Calculate the delay in milliseconds before the next guardrail retry attempt.
 * Supports exponential, linear, and fixed backoff strategies.
 *
 * @param attempt - The just-completed attempt number (1-based).
 * @param config - Retry configuration controlling backoff strategy and delay bounds.
 * @returns Delay in milliseconds, clamped to {@link GuardrailRetryConfig.maxDelayMs}.
 */
export function calculateRetryDelay(
  attempt: number,
  config: GuardrailRetryConfig,
): number {
  const {
    backoff = "exponential",
    baseDelayMs = 100,
    maxDelayMs = 5000,
  } = config;
  let delay: number;
  switch (backoff) {
    case "exponential":
      delay = baseDelayMs * 2 ** (attempt - 1);
      break;
    case "linear":
      delay = baseDelayMs * attempt;
      break;
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

/**
 * Execute a guardrail function, retrying on thrown errors up to the configured
 * number of attempts. Delays between retries respect the guardrail's
 * {@link GuardrailRetryConfig} and can be cancelled via an {@link AbortSignal}.
 *
 * @remarks
 * When all retries are exhausted the function returns a structured
 * `{ passed: false }` result rather than re-throwing, so callers can classify
 * the failure as a guardrail rejection instead of an unhandled error.
 *
 * @param guardrail - The named guardrail to execute (includes retry config).
 * @param data - The guardrail input data (input text, output value, or tool call).
 * @param context - Shared guardrail context providing access to system facts.
 * @param signal - Optional abort signal to cancel pending retry delays.
 * @returns The guardrail result from a successful attempt, or a failure result after all retries.
 */
export async function executeGuardrailWithRetry<T>(
  guardrail: NamedGuardrail<T>,
  data: T,
  context: GuardrailContext,
  signal?: AbortSignal,
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

/**
 * Calculate the delay in milliseconds before the next agent-level retry attempt.
 * Supports exponential, linear, and fixed backoff strategies.
 *
 * @param attempt - The just-completed attempt number (1-based).
 * @param config - Retry configuration controlling backoff strategy and delay bounds.
 * @returns Delay in milliseconds, clamped to {@link AgentRetryConfig.maxDelayMs}.
 */
export function calculateAgentRetryDelay(
  attempt: number,
  config: AgentRetryConfig,
): number {
  const {
    backoff = "exponential",
    baseDelayMs = 1000,
    maxDelayMs = 30000,
  } = config;
  let delay: number;
  switch (backoff) {
    case "exponential":
      delay = baseDelayMs * 2 ** (attempt - 1);
      break;
    case "linear":
      delay = baseDelayMs * attempt;
      break;
    default:
      delay = baseDelayMs;
  }

  return Math.min(delay, maxDelayMs);
}

/**
 * Execute an agent run via the provided {@link AgentRunner}, retrying on errors up to
 * the configured number of attempts. The optional `isRetryable` predicate and `onRetry`
 * callback in the retry config control which errors are retried and provide observability.
 *
 * @remarks
 * Unlike {@link executeGuardrailWithRetry}, this function re-throws the last error
 * when all retries are exhausted, since agent failures are not structured guardrail
 * rejections.
 *
 * @param runner - The agent runner function that performs the LLM call.
 * @param agent - The agent definition passed through to the runner.
 * @param input - The user input string for the agent run.
 * @param options - Optional run options including abort signal and message callbacks.
 * @param retryConfig - Optional retry configuration (attempts, backoff, predicates).
 * @returns The successful run result from the first passing attempt.
 * @throws The last error encountered when all retry attempts are exhausted.
 */
export async function executeAgentWithRetry<T>(
  runner: AgentRunner,
  agent: AgentLike,
  input: string,
  options: RunOptions | undefined,
  retryConfig: AgentRetryConfig | undefined,
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
