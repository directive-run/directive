/**
 * Copied from 1.35 (packages/core/src/core/predict.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

import type { ClauseResult } from "./predicate.js";

// ============================================================================
// Types
// ============================================================================

export interface PredictMissingChange {
  /** Dotted path to the fact. */
  readonly path: string;
  /** The operator that failed. */
  readonly op: string;
  /** What the predicate expected. */
  readonly expected: unknown;
  /** What the fact currently is. */
  readonly actual: unknown;
  /** Human-readable hint suitable for feeding back to an LLM or showing to a user. */
  readonly suggestion: string;
}

export interface PredictResult<_F = unknown> {
  /** True iff the predicate would fire against `facts`. */
  readonly wouldFire: boolean;
  /** Full clause-by-clause result (reuses the whenExplain payload). */
  readonly whenExplain: readonly ClauseResult[];
  /**
   * List of failing clauses, each with a `suggestion` describing the
   * smallest concrete change to `facts` that would make that clause pass.
   * Empty when `wouldFire === true`.
   *
   * If the predicate contains a `$changed` clause AND `prev` was not
   * passed, a synthetic warning is included here (the `$changed` clause
   * cannot be evaluated without a `prev` snapshot).
   */
  readonly missingChanges: readonly PredictMissingChange[];
}
