/**
 * Copied from 1.35 (packages/core/src/core/rules-diff.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

// ============================================================================
// Types
// ============================================================================

/** A leaf clause extracted from a predicate tree, keyed by its dotted path. */
export interface LeafClause {
  /** Dotted path through the predicate. E.g. `phase`, `$all[0].elapsed`, `$not.paused`. */
  path: string;
  /** Operator name. `$eq` is implied for bare-value equality. */
  op: string;
  /** Operand. */
  value: unknown;
}

/** Kind of change observed for a single clause. */
export type ChangeKind =
  | "added"
  | "removed"
  | "changed"
  | "relaxed"
  | "tightened";

/** A single change between two predicates at a specific path. */
export interface Change {
  path: string;
  kind: ChangeKind;
  before?: { op: string; value: unknown };
  after?: { op: string; value: unknown };
}

/** Status of a single constraint across the two snapshots. */
export type ConstraintStatus = "added" | "removed" | "changed" | "unchanged";

export interface ConstraintDiff {
  id: string;
  status: ConstraintStatus;
  /** Empty for `unchanged`. For `added` / `removed`, every leaf is listed once. */
  changes: Change[];
}

export interface RulesDiffReport {
  constraints: ConstraintDiff[];
  summary: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    totalClauseChanges: number;
  };
}

export interface DiffRulesOptions {
  before: RulesMapInput;
  after: RulesMapInput;
}

/**
 * Accepted shapes for the `before` / `after` predicate maps:
 *   - A plain map `{ [constraintId]: whenSpec }`
 *   - The `system.inspect().constraints` array form `Array<{ id, whenSpec? }>`
 *   - Either wrapped as `{ constraints: <one-of-the-above> }`
 *
 * Anything else throws at `toRulesMap` so a bad input fails loud.
 */
export type RulesMapInput = unknown;
