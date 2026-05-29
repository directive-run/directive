/**
 * Parameter sweep over a predicate template — the grid-search counterpart
 * to `replayUnder`.
 *
 * `replayUnder` diffs ONE proposed predicate against the original.
 * `sweepUnder` takes a **template** with one or more `{ $hole: "name" }`
 * markers and a set of candidate values, then replays the history once
 * per (cartesian-product) combination. The result is a response curve
 * over the parameter space plus the argmax under a user-supplied
 * objective — turning rule-tuning from guess-and-check into a one-call
 * optimization against recorded traffic.
 *
 * Pure module — imports only the predicate runtime and replay engine.
 * No engine / store / tracking dependency.
 */

import { MAX_PREDICATE_DEPTH } from "./predicate.js";
import {
  type PredicateBacktestReport,
  type ReplayFrame,
  replayUnder,
} from "./replay-under.js";
import type { FactPredicate } from "./types/predicate.js";

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

/** Hard cap on points evaluated in a single sweep — protects against runaway grids. */
export const MAX_SWEEP_POINTS = 10_000;

/**
 * Aggregate compute cap: `points × frames` per call. `MAX_SWEEP_POINTS`
 * (10k) and `MAX_REPLAY_FRAMES` (1M) bound each axis individually, but
 * their product would be 10B per-frame evaluations — minutes-to-hours of
 * compute. This caps the realistic upper bound at ~50M evaluations
 * (e.g. 50k frames × 1k points, or 5k frames × 10k points).
 */
export const MAX_SWEEP_EVALUATIONS = 50_000_000;

// ============================================================================
// Hole substitution
// ============================================================================

function isHole(v: unknown): v is SweepHole {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v as object).length === 1 &&
    typeof (v as SweepHole).$hole === "string"
  );
}

/**
 * Walk `template`, replacing every `{ $hole: name }` marker with the value
 * looked up in `values`. Returns a new tree — does not mutate `template`.
 * Cycle-guarded; depth-capped at `MAX_PREDICATE_DEPTH`.
 *
 * Throws if a hole's name is not present in `values` — surfaces a typo'd
 * hole name up front rather than letting it land as `undefined` in the
 * evaluator.
 */
function substitute(
  template: unknown,
  values: Record<string, unknown>,
  path: Set<object> = new Set(),
  depth = 0,
): unknown {
  if (depth > MAX_PREDICATE_DEPTH) {
    throw new Error(
      `[Directive] sweepUnder: template exceeds MAX_PREDICATE_DEPTH (${MAX_PREDICATE_DEPTH}) — flatten the template or split the sweep`,
    );
  }

  if (isHole(template)) {
    const name = template.$hole;
    if (!(name in values)) {
      throw new Error(
        `[Directive] sweepUnder: template references hole "${name}" but sweep has no values for it`,
      );
    }

    // Don't recurse into the substituted value — sweep values are opaque
    // payloads, not templates. A value that itself looks like `{$hole:...}`
    // lands literally in the proposed predicate.
    return values[name];
  }

  if (template === null || typeof template !== "object") {
    return template;
  }

  // Cycle guard via DFS path Set — entries are removed on unwind so that
  // shared (non-cyclic) sub-trees still get substituted on every occurrence.
  if (path.has(template)) {
    throw new Error(
      "[Directive] sweepUnder: template contains a cycle — predicate templates must be a tree",
    );
  }
  path.add(template);

  try {
    if (Array.isArray(template)) {
      return template.map((entry) =>
        substitute(entry, values, path, depth + 1),
      );
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      out[k] = substitute(v, values, path, depth + 1);
    }

    return out;
  } finally {
    path.delete(template);
  }
}

// ============================================================================
// Cartesian product
// ============================================================================

/**
 * Iterate the cartesian product of the sweep map's value arrays, in
 * declaration order. Generator avoids materializing the whole grid for
 * large multi-hole sweeps.
 */
function* cartesian(
  keys: readonly string[],
  sweep: Readonly<Record<string, readonly unknown[]>>,
): Generator<Record<string, unknown>> {
  if (keys.length === 0) {
    yield {};

    return;
  }

  const head = keys[0] as string;
  const rest = keys.slice(1);
  const headValues = sweep[head] ?? [];
  for (const v of headValues) {
    for (const tail of cartesian(rest, sweep)) {
      yield { [head]: v, ...tail };
    }
  }
}

function gridSize(sweep: Readonly<Record<string, readonly unknown[]>>): number {
  let size = 1;
  for (const arr of Object.values(sweep)) {
    size *= arr.length;
  }

  return size;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Sweep a predicate template's hole(s) across candidate values and replay
 * the recorded history through each one. Returns the full response curve
 * plus the argmax under a user-supplied objective.
 *
 * The mechanism is a tight loop over `replayUnder`: walk the cartesian
 * product of sweep values, substitute each combination into the template,
 * and run a backtest. Same caveats as `replayUnder` apply (no cascade
 * modeling, survivorship bias) — see {@link replayUnder} docs.
 *
 * @example
 * ```ts
 * const report = sweepUnder({
 *   frames: recordedSessions,
 *   original: { cartTotal: { $gte: 100 } },
 *   template: { cartTotal: { $gte: { $hole: "threshold" } } },
 *   sweep: { threshold: [25, 50, 100, 200] },
 * });
 *
 * report.best.values;          // { threshold: 25 }  (assuming higher matched is better)
 * report.best.report.proposed.matched;  // 9210
 * report.baseline.score;       // 4217 — the original spec's matched count
 * report.points.length;        // 4
 * ```
 *
 * Multi-hole sweeps grid-search:
 *
 * ```ts
 * sweepUnder({
 *   frames,
 *   original,
 *   template: {
 *     risk: { $gte: { $hole: "minRisk" } },
 *     age:  { $gte: { $hole: "minAge"  } },
 *   },
 *   sweep: { minRisk: [0.5, 0.7, 0.9], minAge: [13, 18, 21] },
 * });
 * // → 9 points (3 × 3)
 * ```
 */
export function sweepUnder<F = Record<string, unknown>>(
  options: SweepUnderOptions<F>,
): SweepReport {
  const {
    frames,
    original,
    template,
    sweep,
    objective = (r) => r.proposed.matched,
    entityKey,
    maxSamples = 0,
  } = options;

  const keys = Object.keys(sweep);
  if (keys.length === 0) {
    throw new Error(
      "[Directive] sweepUnder: `sweep` must contain at least one hole name",
    );
  }

  const total = gridSize(sweep);
  if (total > MAX_SWEEP_POINTS) {
    throw new Error(
      `[Directive] sweepUnder: grid has ${total} points, exceeds the MAX_SWEEP_POINTS limit (${MAX_SWEEP_POINTS}) — narrow the sweep ranges or split the run`,
    );
  }
  if (total === 0) {
    throw new Error(
      "[Directive] sweepUnder: at least one hole has zero candidate values",
    );
  }
  const evaluations = total * frames.length;
  if (evaluations > MAX_SWEEP_EVALUATIONS) {
    throw new Error(
      `[Directive] sweepUnder: ${total} points × ${frames.length} frames = ${evaluations} per-frame evaluations, exceeds the MAX_SWEEP_EVALUATIONS limit (${MAX_SWEEP_EVALUATIONS}) — narrow the sweep, down-sample the history, or split the run`,
    );
  }

  // Invoke the user's objective with a catch + finite-number guard.
  // A throw or non-finite return becomes -Infinity so the point sinks in
  // the ranking instead of corrupting it (and stays out of the argmax).
  let warnedObjective = false;
  const safeObjective = (report: PredicateBacktestReport): number => {
    let raw: unknown;
    try {
      raw = objective(report);
    } catch (err) {
      if (!warnedObjective) {
        warnedObjective = true;
        console.warn(
          `[Directive] sweepUnder: objective threw — point will not rank (${(err as Error).message})`,
        );
      }

      return Number.NEGATIVE_INFINITY;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      if (!warnedObjective) {
        warnedObjective = true;
        console.warn(
          `[Directive] sweepUnder: objective returned a non-finite number (${String(raw)}) — point will not rank`,
        );
      }

      return Number.NEGATIVE_INFINITY;
    }

    return raw;
  };

  // Baseline: replay original against itself so the caller has a
  // comparable score under the same objective. This is one extra
  // replayUnder() call regardless of grid size — cheap, useful.
  const baselineReport = replayUnder({
    frames,
    original,
    proposed: original,
    entityKey,
    maxSamples,
  });
  const baseline: SweepPoint = {
    values: {},
    report: baselineReport,
    score: safeObjective(baselineReport),
  };

  const points: SweepPoint[] = [];
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const values of cartesian(keys, sweep)) {
    const proposed = substitute(template, values) as FactPredicate<F>;
    const report = replayUnder({
      frames,
      original,
      proposed,
      entityKey,
      maxSamples,
    });
    const score = safeObjective(report);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = points.length;
    }
    points.push({ values, report, score });
  }

  // points is guaranteed non-empty here because total > 0 and the loop ran.
  const best = points[bestIndex] as SweepPoint;

  return {
    points,
    bestIndex,
    best,
    baseline,
  };
}
