/**
 * predict() — "would this predicate fire against these facts, and if
 * not, what facts must change to make it fire?"
 *
 * Closes the LLM-emit iteration loop: the model writes a rule,
 * `predict()` says "this rule needs cartTotal ≥ 50 to fire; current
 * value is 30," and the model rewrites accordingly. A predicate-aware
 * preview that costs one walk of the predicate tree.
 *
 * Pure, sync, no engine dependency. Reuses `evaluatePredicateExplained`.
 */

import { evaluatePredicateExplained, walkPredicate } from "./predicate.js";
import type { ClauseResult, FactPredicate } from "./types/predicate.js";

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

// ============================================================================
// Suggestion synthesis
// ============================================================================

function fmt(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(v);

  return String(v);
}

/**
 * Per-operator suggestion templates. Each returns a short, imperative
 * line aimed at a developer or LLM consumer:
 *
 *   "set cartTotal to at least 50 (currently 30)"
 *   "set status to one of [active, pending] (currently inactive)"
 *   "remove tags so it's empty (currently has 3 items)"
 */
function suggestionFor(clause: ClauseResult): string {
  const path = clause.path;
  const expected = fmt(clause.expected);
  const actual = fmt(clause.actual);

  switch (clause.op) {
    case "$eq":
      return `set ${path} to ${expected} (currently ${actual})`;
    case "$ne":
      return `change ${path} to anything other than ${expected} (currently ${actual})`;
    case "$gt":
      return `set ${path} above ${expected} (currently ${actual})`;
    case "$gte":
      return `set ${path} to at least ${expected} (currently ${actual})`;
    case "$lt":
      return `set ${path} below ${expected} (currently ${actual})`;
    case "$lte":
      return `set ${path} to at most ${expected} (currently ${actual})`;
    case "$in":
      return `set ${path} to one of ${expected} (currently ${actual})`;
    case "$nin":
      return `set ${path} to something other than ${expected} (currently ${actual})`;
    case "$exists":
      return clause.expected === true
        ? `set ${path} to a non-null value (currently null/missing)`
        : `unset ${path} (currently ${actual})`;
    case "$between": {
      if (Array.isArray(clause.expected) && clause.expected.length === 2) {
        return `set ${path} between ${fmt(clause.expected[0])} and ${fmt(clause.expected[1])} (currently ${actual})`;
      }

      return `set ${path} within range ${expected} (currently ${actual})`;
    }
    case "$startsWith":
      return `set ${path} to start with ${expected} (currently ${actual})`;
    case "$endsWith":
      return `set ${path} to end with ${expected} (currently ${actual})`;
    case "$contains":
      return `set ${path} to contain ${expected} (currently ${actual})`;
    case "$matches":
      return `set ${path} to match the pattern ${expected} (currently ${actual})`;
    case "$changed":
      return `the previous-vs-current change of ${path} is required to differ (currently they match: ${actual})`;
    case "$all":
    case "$any":
    case "$not":
      // Combinators fail when their children's pattern fails — surface a generic suggestion.
      return `the ${clause.op} group at "${path}" did not pass — see its child clauses`;
    default:
      return `clause at ${path} (${clause.op}) failed: expected ${expected}, got ${actual}`;
  }
}

// ============================================================================
// Collect failed leaves
// ============================================================================

function collectFailedLeaves(
  clauses: readonly ClauseResult[],
  out: PredictMissingChange[],
): void {
  for (const c of clauses) {
    if (c.pass) continue;

    // Combinators: recurse into children — surface the leaves that actually failed.
    if ((c.op === "$all" || c.op === "$any" || c.op === "$not") && c.children) {
      // For $any: only one child needs to pass — emit the "cheapest" suggestion
      // (typically the first failed leaf) plus a hint about alternatives.
      // For $all and $not: every failing child is a required change.
      collectFailedLeaves(c.children, out);
      continue;
    }

    out.push({
      path: c.path,
      op: c.op,
      expected: c.expected,
      actual: c.actual,
      suggestion: suggestionFor(c),
    });
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run a predicate against the current fact state and report whether it
 * would fire — *and if not, which facts must change*.
 *
 * Designed for the LLM-iteration loop and for "preview the impact of this
 * rule" UIs.
 *
 * **`$changed` and `prev`:** the `$changed` operator compares the current
 * value of a fact against the `prev` snapshot. If the predicate uses
 * `$changed` and `prev` is not supplied, the missing-changes list includes
 * a synthetic warning indicating that the clause cannot be evaluated —
 * pass `predict(predicate, facts, prev)` to get a real result.
 *
 * @example
 * ```ts
 * const predicate = { cartTotal: { $gte: 50 }, region: { $in: ["US", "EU"] } };
 * const facts = { cartTotal: 30, region: "US" };
 *
 * predict(predicate, facts);
 * // → {
 * //     wouldFire: false,
 * //     whenExplain: [ {path: "cartTotal", op: "$gte", pass: false, ...}, ... ],
 * //     missingChanges: [
 * //       { path: "cartTotal", op: "$gte", expected: 50, actual: 30,
 * //         suggestion: "set cartTotal to at least 50 (currently 30)" },
 * //     ],
 * //   }
 * ```
 */
export function predict<F = Record<string, unknown>>(
  predicate: FactPredicate<F>,
  facts: F,
  prev?: F,
): PredictResult<F> {
  const whenExplain = evaluatePredicateExplained(
    predicate as unknown,
    facts as unknown as Record<string, unknown>,
    prev as unknown as Record<string, unknown> | undefined,
  );
  const wouldFire = whenExplain.every((c) => c.pass);

  const missingChanges: PredictMissingChange[] = [];
  if (!wouldFire) {
    collectFailedLeaves(whenExplain, missingChanges);
  }

  // M10: $changed clause needs a `prev` snapshot. If the caller omitted
  // `prev`, evaluation silently treats every `$changed` clause as failing —
  // surface a synthetic warning so the caller sees the real cause.
  //
  // M2: but ONLY when the predicate actually failed. If `wouldFire === true`,
  // every clause (including any $changed clauses) already passed, so the
  // synthetic warning would be noise. The runtime treats `$changed` with no
  // `prev` as a no-op; if the predicate as a whole fired despite a $changed
  // clause being present-but-uncheckable, the result is unambiguous and the
  // synthetic warning would mislead the caller into thinking something is wrong.
  if (!wouldFire && prev === undefined) {
    const changedPaths: string[] = [];
    walkPredicate(predicate as unknown, {
      operator(factPath, op) {
        if (op === "$changed") {
          changedPaths.push(factPath);
        }
      },
    });
    for (const path of changedPaths) {
      missingChanges.push({
        path,
        op: "$changed",
        expected: true,
        actual: undefined,
        suggestion: `$changed clause at "${path}" cannot be evaluated without a \`prev\` snapshot — pass predict(predicate, facts, prev).`,
      });
    }
  }

  return {
    wouldFire,
    whenExplain,
    missingChanges,
  };
}
