/**
 * Provider Fallback Chains — Automatic failover across multiple AgentRunners.
 *
 * Tries runners in order, moving to the next on failure.
 * Composes naturally with {@link withRetry} (each runner can have its own retry policy).
 *
 * @module
 *
 * @example
 * ```typescript
 * import { withFallback, withRetry, AllProvidersFailedError } from '@directive-run/ai';
 *
 * const runner = withFallback([
 *   withRetry(openaiRunner, { maxRetries: 2 }),
 *   withRetry(anthropicRunner, { maxRetries: 2 }),
 *   ollamaRunner,
 * ], {
 *   onFallback: (from, to, error) => {
 *     console.log(`Provider ${from} failed, trying ${to}: ${error.message}`);
 *   },
 * });
 *
 * try {
 *   const result = await runner(agent, input);
 * } catch (err) {
 *   if (err instanceof AllProvidersFailedError) {
 *     console.error(`All ${err.errors.length} providers failed`);
 *   }
 * }
 * ```
 */

import { isStreamConsumerError } from "./streaming.js";
import type { AgentLike, AgentRunner, RunOptions, RunResult } from "./types.js";

// ============================================================================
// Types
// ============================================================================

export interface FallbackConfig {
  /** Custom predicate to decide whether to fall back on a given error. Default: always fall back. */
  shouldFallback?: (error: Error) => boolean;
  /** Called when falling back from one provider to the next. */
  onFallback?: (fromIndex: number, toIndex: number, error: Error) => void;
}

/** Error thrown when all providers in the fallback chain have failed. */
export class AllProvidersFailedError extends Error {
  readonly errors: Error[];

  constructor(errors: Error[]) {
    const summary = errors.map((e, i) => `  [${i}] ${e.message}`).join("\n");
    super(`[Directive] All ${errors.length} providers failed:\n${summary}`);
    this.name = "AllProvidersFailedError";
    this.errors = Object.freeze([...errors]) as Error[];
    // Chain causes for debugging
    if (errors.length > 0) {
      this.cause = errors[errors.length - 1];
    }
  }
}

// ============================================================================
// Wrapper
// ============================================================================

/**
 * Wrap multiple AgentRunners into a fallback chain.
 *
 * @example
 * ```typescript
 * const runner = withFallback([
 *   withRetry(openaiRunner, { maxRetries: 2 }),
 *   withRetry(anthropicRunner, { maxRetries: 2 }),
 *   ollamaRunner,
 * ], {
 *   onFallback: (from, to, error) => {
 *     console.log(`Falling back from provider ${from} to ${to}: ${error.message}`);
 *   },
 * });
 * ```
 */
export function withFallback(
  runners: AgentRunner[],
  config: FallbackConfig = {},
): AgentRunner {
  if (runners.length === 0) {
    throw new Error("[Directive] withFallback requires at least one runner.");
  }

  const { shouldFallback, onFallback } = config;

  return async <T = unknown>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<T>> => {
    const errors: Error[] = [];

    for (let i = 0; i < runners.length; i++) {
      try {
        return await runners[i]!<T>(agent, input, options);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push(error);

        // A consumer callback that threw is not a provider failure. Trying the
        // next provider spends again to hand the same response to the same
        // broken consumer.
        if (isStreamConsumerError(error)) {
          break;
        }

        // Check if we should fall back to next provider
        if (i < runners.length - 1) {
          if (shouldFallback) {
            try {
              if (!shouldFallback(error)) {
                break;
              }
            } catch {
              // shouldFallback threw — treat as non-fallbackable
              break;
            }
          }
          try {
            onFallback?.(i, i + 1, error);
          } catch {
            /* callback error must not disrupt fallback flow */
          }

          // The next provider answers the prompt from scratch, so anything a
          // consumer rendered from the failed one is void. Without this the
          // stream shows one provider's partial answer followed by another's
          // complete one, while `result` holds only the second.
          try {
            options?.onStreamRestart?.("reroute");
          } catch {
            /* callback error must not disrupt fallback flow */
          }
        }
      }
    }

    throw new AllProvidersFailedError(errors);
  };
}
