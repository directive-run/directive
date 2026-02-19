/**
 * Middleware composition utility — left-to-right pipeline for AgentRunner wrappers.
 *
 * Each middleware is a function that takes an `AgentRunner` and returns a new
 * `AgentRunner`. `pipe` applies them left to right, so the first middleware
 * in the list wraps the runner first (innermost), and the last wraps last
 * (outermost).
 *
 * @module
 *
 * @example
 * ```typescript
 * import { pipe, withRetry, withFallback, withBudget } from '@directive-run/ai';
 *
 * const runner = pipe(
 *   baseRunner,
 *   withFallback([anthropicRunner, openaiRunner]),
 *   withRetry({ maxRetries: 3 }),
 *   withBudget({ budgets: [{ window: 'hour', maxCost: 5, pricing }] }),
 * );
 * ```
 */

import type { AgentRunner } from "./types.js";

/** A function that wraps an AgentRunner, returning a new AgentRunner. */
export type RunnerMiddleware = (runner: AgentRunner) => AgentRunner;

/**
 * Compose middleware left-to-right onto a base runner.
 *
 * @param runner - The base `AgentRunner` to wrap.
 * @param middlewares - One or more middleware functions to apply in order.
 * @returns A new `AgentRunner` with all middleware applied.
 */
export function pipe(
	runner: AgentRunner,
	...middlewares: RunnerMiddleware[]
): AgentRunner {
	let result = runner;
	for (const mw of middlewares) {
		result = mw(result);
	}

	return result;
}
