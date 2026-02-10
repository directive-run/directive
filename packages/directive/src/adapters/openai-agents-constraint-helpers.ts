/**
 * Constraint Helper Functions — Ergonomic builders for OrchestratorConstraint
 *
 * @example
 * ```typescript
 * import { constraint, when } from 'directive/ai';
 *
 * constraints: {
 *   // Builder pattern
 *   escalate: constraint<MyFacts>()
 *     .when(f => f.confidence < 0.7)
 *     .require({ type: 'ESCALATE' })
 *     .priority(50)
 *     .build(),
 *
 *   // Quick shorthand
 *   pause: when<MyFacts>(f => f.errors > 3)
 *     .require({ type: 'PAUSE' }),
 * }
 * ```
 */

import type { Requirement } from "../core/types.js";
import type { OrchestratorConstraint, OrchestratorState } from "./openai-agents-types.js";

// ============================================================================
// Builder Pattern
// ============================================================================

interface ConstraintBuilderWithWhen<F extends Record<string, unknown>> {
	require(
		req: Requirement | ((facts: F & OrchestratorState) => Requirement),
	): ConstraintBuilderWithRequire<F>;
}

interface ConstraintBuilderWithRequire<F extends Record<string, unknown>> {
	priority(p: number): ConstraintBuilderWithRequire<F>;
	build(): OrchestratorConstraint<F>;
}

export interface ConstraintBuilder<F extends Record<string, unknown>> {
	when(
		condition: (facts: F & OrchestratorState) => boolean | Promise<boolean>,
	): ConstraintBuilderWithWhen<F>;
}

/**
 * Fluent builder for creating orchestrator constraints.
 *
 * @example
 * ```typescript
 * const myConstraint = constraint<MyFacts>()
 *   .when(f => f.confidence < 0.7)
 *   .require({ type: 'ESCALATE' })
 *   .priority(50)
 *   .build();
 * ```
 */
export function constraint<
	F extends Record<string, unknown> = Record<string, never>,
>(): ConstraintBuilder<F> {
	return {
		when(condition) {
			return {
				require(req) {
					let p = 0;
					const result: ConstraintBuilderWithRequire<F> = {
						priority(val) {
							p = val;
							return result;
						},
						build(): OrchestratorConstraint<F> {
							return { when: condition, require: req, priority: p };
						},
					};
					return result;
				},
			};
		},
	};
}

// ============================================================================
// Quick Shorthand
// ============================================================================

interface WhenResult<F extends Record<string, unknown>> {
	require(
		req: Requirement | ((facts: F & OrchestratorState) => Requirement),
	): WhenWithRequire<F>;
}

/**
 * Result of `when().require()` — a valid `OrchestratorConstraint<F>` directly,
 * or chain `.withPriority(n)` to get a constraint with priority set.
 */
export interface WhenWithRequire<F extends Record<string, unknown>>
	extends OrchestratorConstraint<F> {
	/** Return a new constraint with the given priority */
	withPriority(p: number): OrchestratorConstraint<F>;
}

/**
 * Quick shorthand for creating simple constraints.
 * The returned object is a valid `OrchestratorConstraint<F>` — use directly
 * or chain `.withPriority(n)` to set priority.
 *
 * @example
 * ```typescript
 * const myConstraint = when<MyFacts>(f => f.errors > 3)
 *   .require({ type: 'PAUSE' });
 *
 * // With priority
 * const urgent = when<MyFacts>(f => f.critical)
 *   .require({ type: 'HALT' })
 *   .withPriority(100);
 * ```
 */
export function when<
	F extends Record<string, unknown> = Record<string, never>,
>(
	condition: (facts: F & OrchestratorState) => boolean | Promise<boolean>,
): WhenResult<F> {
	return {
		require(req) {
			return {
				when: condition,
				require: req,
				priority: 0,
				withPriority(p: number): OrchestratorConstraint<F> {
					return { when: condition, require: req, priority: p };
				},
			};
		},
	};
}
