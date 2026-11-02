/**
 * Copied from 1.35 (packages/core/src/core/sweep-under.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

import type { FactPredicate } from "./predicate.js";
import type { PredicateBacktestReport, ReplayFrame } from "./replay-under.js";

// ============================================================================
// Types
// ============================================================================

/** A placeholder inside a predicate template — substituted from `sweep` values. */
export interface SweepHole {
  readonly $hole: string;
}

export interface SweepUnderOptions<F = Record<string, unknown>> {
  /** Recorded fact-state frames, in chronological order. */
  frames: readonly ReplayFrame<F>[];
  /** The constraint's current `when` predicate (baseline). */
  original: FactPredicate<F>;
  /**
   * Predicate template containing one or more `{ $hole: "name" }` markers.
   * Each marker is substituted by the corresponding value from `sweep` on
   * every point in the curve.
   *
   * @example
   * ```ts
   * { cartTotal: { $gte: { $hole: "threshold" } } }
   * ```
   */
  template: unknown;
  /**
   * Map of hole name → candidate values. Multiple holes produce the
   * cartesian product (grid search).
   *
   * @example
   * ```ts
   * { threshold: [25, 50, 100, 200] }
   * { riskScore: [0.5, 0.7, 0.9], minAge: [13, 18, 21] } // 3*3 = 9 points
   * ```
   */
  sweep: Readonly<Record<string, readonly unknown[]>>;
  /**
   * Score function for ranking. Higher is better. Default:
   * `(report) => report.proposed.matched` (maximize matched frames).
   */
  objective?: (report: PredicateBacktestReport) => number;
  /** Optional fact key to additionally report distinct-entity counts. */
  entityKey?: string;
  /**
   * Diff frames sampled per replay (default 0 — count-only for speed).
   * Set higher to inspect specific frames in the report.
   */
  maxSamples?: number;
}

/** One point on the sweep curve — one candidate value tuple. */
export interface SweepPoint {
  /** Hole name → value used at this point. */
  values: Readonly<Record<string, unknown>>;
  /** Full backtest report against this candidate. */
  report: PredicateBacktestReport;
  /** Computed objective score (higher is better). */
  score: number;
}

export interface SweepReport {
  /** All points, in sweep order (cartesian-product traversal of sweep keys). */
  points: readonly SweepPoint[];
  /** Index of the highest-scoring point in `points`. */
  bestIndex: number;
  /** Convenience accessor: `points[bestIndex]`. */
  best: SweepPoint;
  /** The original predicate replayed against itself — score baseline for comparison. */
  baseline: SweepPoint;
}
