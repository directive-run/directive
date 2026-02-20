/**
 * Agent Reflection / Self-Improvement
 *
 * Quality-based iteration: agent produces output → evaluator checks it → retry
 * with feedback until pass. Works with any AgentRunner.
 *
 * Shipped with aggressive safeguards to prevent silent budget burn:
 * - maxIterations default: 2 (conservative)
 * - Dev-mode warning for maxIterations > 3
 * - onIteration fires on every iteration (observable by default)
 * - Token usage accumulated across iterations
 *
 * @example
 * ```typescript
 * import { withReflection } from '@directive-run/ai';
 *
 * const reflective = withReflection(runner, {
 *   evaluate: (output) => ({
 *     passed: output.includes('conclusion'),
 *     feedback: 'Missing conclusion section',
 *   }),
 *   maxIterations: 2,
 * });
 *
 * const result = await reflective(agent, 'Write a report');
 * ```
 */

import type { AgentLike, AgentRunner, RunOptions, RunResult } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/** Context passed to the reflection evaluator */
export interface ReflectionContext {
  input: string;
  /** 0-based iteration number */
  iteration: number;
  result: RunResult<unknown>;
  history: ReflectionEvaluation[];
}

/** Result of a reflection evaluation */
export interface ReflectionEvaluation {
  passed: boolean;
  feedback?: string;
  /** Quality score from 0 to 1, optional */
  score?: number;
}

/** Evaluator function for reflection */
export type ReflectionEvaluator<T = unknown> = (
  output: T,
  context: ReflectionContext,
) => ReflectionEvaluation | Promise<ReflectionEvaluation>;

/** Configuration for the reflection wrapper */
export interface ReflectionConfig<T = unknown> {
  /** Evaluator function — decides if the output is acceptable */
  evaluate: ReflectionEvaluator<T>;
  /** Maximum iterations (including the first). Default: 2 (conservative) */
  maxIterations?: number;
  /** Build the retry input from original input + feedback */
  buildRetryInput?: (input: string, feedback: string, iteration: number) => string;
  /** Callback on each iteration */
  onIteration?: (event: {
    iteration: number;
    passed: boolean;
    feedback?: string;
    score?: number;
    durationMs: number;
  }) => void;
  /** Behavior when maxIterations exhausted. Default: "accept-last" */
  onExhausted?: "accept-last" | "throw";
  /** Stop early if budget remaining < threshold (tokens). Works with withBudget. */
  budgetThreshold?: number;
}

// ============================================================================
// Error
// ============================================================================

/** Error thrown when reflection iterations are exhausted and onExhausted is "throw" */
export class ReflectionExhaustedError extends Error {
  readonly iterations: number;
  readonly history: ReflectionEvaluation[];
  readonly lastResult: RunResult<unknown>;
  readonly totalTokens: number;

  constructor(options: {
    iterations: number;
    history: ReflectionEvaluation[];
    lastResult: RunResult<unknown>;
    totalTokens: number;
  }) {
    super(
      `[Directive Reflection] Exhausted ${options.iterations} iterations without passing evaluation. ` +
      `Last feedback: ${options.history[options.history.length - 1]?.feedback ?? "(none)"}`,
    );
    this.name = "ReflectionExhaustedError";
    this.iterations = options.iterations;
    this.history = options.history;
    this.lastResult = options.lastResult;
    this.totalTokens = options.totalTokens;
  }
}

// ============================================================================
// Implementation
// ============================================================================

/** Default retry input format */
function defaultBuildRetryInput(input: string, feedback: string, _iteration: number): string {
  return `${input}\n\nFeedback on your previous response:\n${feedback}\n\nPlease improve your response.`;
}

/**
 * Wrap an AgentRunner with reflection (self-improvement) logic.
 *
 * The returned runner runs the agent, evaluates the output, and retries with
 * feedback if the evaluation fails — up to `maxIterations` times.
 *
 * @example
 * ```typescript
 * const reflective = withReflection(runner, {
 *   evaluate: (output) => ({
 *     passed: typeof output === 'string' && output.length > 100,
 *     feedback: 'Response too short, please elaborate',
 *     score: Math.min(1, (output as string).length / 200),
 *   }),
 *   maxIterations: 3,
 *   onExhausted: 'accept-last',
 * });
 * ```
 */
export function withReflection<T = unknown>(
  runner: AgentRunner,
  config: ReflectionConfig<T>,
): AgentRunner {
  const maxIterations = config.maxIterations ?? 2;
  const buildRetryInput = config.buildRetryInput ?? defaultBuildRetryInput;
  const onExhausted = config.onExhausted ?? "accept-last";

  if (maxIterations < 1) {
    throw new Error("[Directive Reflection] maxIterations must be >= 1");
  }

  if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production" && maxIterations > 3) {
    console.warn(
      "[Directive Reflection] maxIterations > 3 rarely improves quality. " +
      "Consider using maxIterations <= 3 to avoid unbounded token burn.",
    );
  }

  return async <R>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<R>> => {
    const history: ReflectionEvaluation[] = [];
    let effectiveInput = input;
    let accumulatedTokens = 0;
    let lastResult: RunResult<unknown> | null = null;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const iterationStart = Date.now();

      // Run the agent
      const result = await runner(agent, effectiveInput, options);
      lastResult = result;
      accumulatedTokens += result.totalTokens;

      // Evaluate the output
      const context: ReflectionContext = {
        input,
        iteration,
        result,
        history: [...history],
      };

      const evaluation = await config.evaluate(result.output as T, context);
      history.push(evaluation);

      const durationMs = Date.now() - iterationStart;

      // Fire callback
      try {
        config.onIteration?.({
          iteration,
          passed: evaluation.passed,
          feedback: evaluation.feedback,
          score: evaluation.score,
          durationMs,
        });
      } catch {
        // callback error is non-fatal
      }

      if (evaluation.passed) {
        // Return with accumulated tokens
        return {
          ...result,
          totalTokens: accumulatedTokens,
        } as RunResult<R>;
      }

      // Check budget threshold
      if (config.budgetThreshold !== undefined && accumulatedTokens >= config.budgetThreshold) {
        break;
      }

      // Build retry input for next iteration (unless this is the last)
      if (iteration < maxIterations - 1 && evaluation.feedback) {
        effectiveInput = buildRetryInput(input, evaluation.feedback, iteration);
      }
    }

    // Exhausted all iterations
    if (onExhausted === "throw") {
      throw new ReflectionExhaustedError({
        iterations: maxIterations,
        history,
        lastResult: lastResult!,
        totalTokens: accumulatedTokens,
      });
    }

    // "accept-last" — return the last result with accumulated tokens
    return {
      ...lastResult!,
      totalTokens: accumulatedTokens,
    } as RunResult<R>;
  };
}
