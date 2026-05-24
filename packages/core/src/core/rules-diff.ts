/**
 * Structural diff between two snapshots of a system's constraint `whenSpec`
 * map. The "git diff for business rules" — operates on the predicate AST
 * instead of source-text lines.
 *
 * A predicate is a tree of leaf clauses (`{ fact: operator(value) }`) and
 * combinators (`$all` / `$any` / `$not`). `diffRules` flattens both trees
 * into path-keyed leaf lists and compares: missing path → added/removed,
 * same path with different operand → changed (with relaxed/tightened
 * classification for numeric thresholds).
 *
 * Pure module — imports only utils. No engine / store / predicate-runtime
 * dependency: predicates are walked as plain JSON.
 */

import { stableStringify } from "../utils/utils.js";

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

// ============================================================================
// Input normalization
// ============================================================================

/**
 * Coerce supported input shapes into a flat `Record<constraintId, whenSpec>`.
 * Constraints without a `whenSpec` (function-form `when`) are dropped with
 * an undefined entry so callers can distinguish them from absent constraints
 * if they care; the diff treats `undefined` as "no data" and skips clause
 * walking.
 */
export function toRulesMap(raw: RulesMapInput): Record<string, unknown> {
  const inner =
    raw && typeof raw === "object" && !Array.isArray(raw) && "constraints" in raw
      ? (raw as { constraints: unknown }).constraints
      : raw;

  if (Array.isArray(inner)) {
    const out: Record<string, unknown> = {};
    for (const entry of inner) {
      if (!entry || typeof entry !== "object" || !("id" in entry)) {
        throw new Error(
          "[Directive] diffRules: array entries must be `{ id, whenSpec }` objects",
        );
      }
      const e = entry as { id: unknown; whenSpec?: unknown };
      if (typeof e.id !== "string") {
        throw new Error("[Directive] diffRules: constraint `id` must be a string");
      }
      out[e.id] = e.whenSpec;
    }

    return out;
  }

  if (inner && typeof inner === "object") {
    return inner as Record<string, unknown>;
  }

  throw new Error(
    "[Directive] diffRules: expected a `{ id: whenSpec }` map, an array of `{ id, whenSpec }`, or `{ constraints: ... }`",
  );
}

// ============================================================================
// Predicate flattening
// ============================================================================

const KNOWN_OPS = new Set([
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$exists",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$between",
  "$matches",
  "$startsWith",
  "$endsWith",
  "$contains",
  "$changed",
]);

const COMBINATORS = new Set(["$all", "$any", "$not"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Treat a value as an operator object iff it is a plain object whose keys
 * are ALL `$`-prefixed AND at least one is a known predicate operator.
 * Mirrors the runtime's `isOperatorObject` shape — diffRules walks the same
 * "operator object" boundary as `evaluatePredicate`.
 */
function isOperatorObject(v: unknown): v is Record<string, unknown> {
  if (!isPlainObject(v)) {
    return false;
  }
  const keys = Object.keys(v);
  if (keys.length === 0) {
    return false;
  }
  let sawKnown = false;
  for (const k of keys) {
    if (!k.startsWith("$")) {
      return false;
    }
    if (KNOWN_OPS.has(k)) {
      sawKnown = true;
    }
  }

  return sawKnown;
}

/**
 * Walk a predicate tree and emit every leaf clause with its dotted path.
 * Combinators (`$all` / `$any` / `$not`) become indexed path segments.
 * Bare-value equality (`{ phase: "red" }`) emits as `op: "$eq"`.
 *
 * Array-form predicates (`[{ fact, op, value }, ...]`) are also accepted —
 * each clause's `fact` becomes the path, the operator is `op`, and the
 * value is `value`.
 *
 * **What gets dropped:** non-object combinator children (e.g. `$not: "red"`
 * with a string operand instead of a predicate object), function-form
 * predicates (the engine accepts a function for `when`; this walker only
 * sees data), and bare primitive predicates (a top-level `true` or `"x"`).
 * The walker is a tree visitor — anything not shaped like a predicate node
 * is silently skipped, never thrown on.
 */
export function flattenPredicate(
  spec: unknown,
  pathPrefix = "",
  out: LeafClause[] = [],
): LeafClause[] {
  if (spec === null || typeof spec !== "object") {
    // A leaf that isn't an object — odd as a predicate. Skip.
    return out;
  }

  // Array-form (PredicateClause[])
  if (Array.isArray(spec)) {
    for (const clause of spec) {
      if (
        clause &&
        typeof clause === "object" &&
        "fact" in clause &&
        "op" in clause
      ) {
        const c = clause as { fact: unknown; op: unknown; value: unknown };
        out.push({
          path: pathPrefix
            ? `${pathPrefix}.${String(c.fact)}`
            : String(c.fact),
          op: String(c.op),
          value: c.value,
        });
      }
    }

    return out;
  }

  // Combinator nodes
  if ("$all" in spec && Array.isArray((spec as { $all: unknown }).$all)) {
    const arr = (spec as { $all: unknown[] }).$all;
    arr.forEach((child, i) => {
      flattenPredicate(child, `${pathPrefix}$all[${i}]`, out);
    });

    return out;
  }
  if ("$any" in spec && Array.isArray((spec as { $any: unknown }).$any)) {
    const arr = (spec as { $any: unknown[] }).$any;
    arr.forEach((child, i) => {
      flattenPredicate(child, `${pathPrefix}$any[${i}]`, out);
    });

    return out;
  }
  if ("$not" in spec) {
    flattenPredicate(
      (spec as { $not: unknown }).$not,
      `${pathPrefix}$not`,
      out,
    );

    return out;
  }

  // Object form — walk each key
  for (const [key, value] of Object.entries(spec as Record<string, unknown>)) {
    const path = pathPrefix ? `${pathPrefix}.${key}` : key;

    if (isOperatorObject(value)) {
      for (const [op, operand] of Object.entries(value)) {
        out.push({ path, op, value: operand });
      }
    } else if (isPlainObject(value) && !COMBINATORS.has(key)) {
      // Nested predicate (cross-module pivot or partial-match object).
      flattenPredicate(value, path, out);
    } else {
      // Bare literal — equality.
      out.push({ path, op: "$eq", value });
    }
  }

  return out;
}

// ============================================================================
// Direction analysis (relaxed / tightened for numeric thresholds)
// ============================================================================

function isNumeric(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * For numeric-threshold operators, decide whether the new value matches
 * MORE (`relaxed`) or FEWER (`tightened`) fact configurations than the
 * old one. Returns `null` when the operator/operand isn't numeric — the
 * caller falls back to `"changed"`.
 */
function directionFor(
  op: string,
  before: unknown,
  after: unknown,
): "relaxed" | "tightened" | null {
  switch (op) {
    case "$gte":
    case "$gt":
      // Lower bound. Lower = matches more.
      if (isNumeric(before) && isNumeric(after)) {
        if (after < before) return "relaxed";
        if (after > before) return "tightened";
      }
      return null;
    case "$lte":
    case "$lt":
      // Upper bound. Higher = matches more.
      if (isNumeric(before) && isNumeric(after)) {
        if (after > before) return "relaxed";
        if (after < before) return "tightened";
      }
      return null;
    case "$between": {
      // [low, high] tuple — width compared.
      if (
        Array.isArray(before) &&
        Array.isArray(after) &&
        before.length === 2 &&
        after.length === 2 &&
        isNumeric(before[0]) &&
        isNumeric(before[1]) &&
        isNumeric(after[0]) &&
        isNumeric(after[1])
      ) {
        const widthBefore = before[1] - before[0];
        const widthAfter = after[1] - after[0];
        if (widthAfter > widthBefore) return "relaxed";
        if (widthAfter < widthBefore) return "tightened";
      }
      return null;
    }
    case "$in":
    case "$nin": {
      // Set membership. Wider set = relaxed for $in, tightened for $nin.
      if (Array.isArray(before) && Array.isArray(after)) {
        if (op === "$in") {
          if (after.length > before.length) return "relaxed";
          if (after.length < before.length) return "tightened";
        } else {
          if (after.length > before.length) return "tightened";
          if (after.length < before.length) return "relaxed";
        }
      }
      return null;
    }
    case "$contains": {
      // For array operands, more allowed elements = relaxed (matches more
      // facts). For string operands the direction is ambiguous (a longer
      // substring narrows the match set; a shorter substring widens it),
      // so we leave the call to the caller — returns null → "changed".
      if (Array.isArray(before) && Array.isArray(after)) {
        if (after.length > before.length) return "relaxed";
        if (after.length < before.length) return "tightened";
      }
      return null;
    }
    default:
      return null;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Diff two snapshots of a system's constraint whenSpec map.
 *
 * @example
 * ```ts
 * const report = diffRules({
 *   before: { blockCheckout: { cartTotal: { $gte: 100 } } },
 *   after:  { blockCheckout: { cartTotal: { $gte: 50 } } },
 * });
 *
 * report.constraints[0].status;          // "changed"
 * report.constraints[0].changes[0].kind; // "relaxed"
 * report.summary.totalClauseChanges;     // 1
 * ```
 *
 * The input shape is forgiving — either a flat `{ id: whenSpec }` map, the
 * `system.inspect().constraints` array form, or either wrapped as
 * `{ constraints: ... }`. Constraints whose `when` is a function (no
 * `whenSpec`) are tracked as added/removed but cannot be clause-diffed
 * (the function form is opaque).
 */
export function diffRules(options: DiffRulesOptions): RulesDiffReport {
  const before = toRulesMap(options.before);
  const after = toRulesMap(options.after);

  const allIds = new Set([...Object.keys(before), ...Object.keys(after)]);
  const sortedIds = [...allIds].sort();

  const constraints: ConstraintDiff[] = [];
  const summary = {
    added: 0,
    removed: 0,
    changed: 0,
    unchanged: 0,
    totalClauseChanges: 0,
  };

  for (const id of sortedIds) {
    const b = before[id];
    const a = after[id];
    const hasB = id in before;
    const hasA = id in after;

    if (hasB && !hasA) {
      const clauses = flattenPredicate(b);
      const changes: Change[] =
        clauses.length === 0
          ? // Function-form / opaque whenSpec — flatten yields nothing.
            // Emit one placeholder so renderers can show *something* and
            // the summary's totalClauseChanges stays non-zero for the
            // removed constraint.
            [{ path: "(function-form predicate)", kind: "removed" }]
          : clauses.map((c) => ({
              path: c.path,
              kind: "removed",
              before: { op: c.op, value: c.value },
            }));
      sortChanges(changes);
      constraints.push({ id, status: "removed", changes });
      summary.removed++;
      summary.totalClauseChanges += changes.length;
      continue;
    }

    if (!hasB && hasA) {
      const clauses = flattenPredicate(a);
      const changes: Change[] =
        clauses.length === 0
          ? [{ path: "(function-form predicate)", kind: "added" }]
          : clauses.map((c) => ({
              path: c.path,
              kind: "added",
              after: { op: c.op, value: c.value },
            }));
      sortChanges(changes);
      constraints.push({ id, status: "added", changes });
      summary.added++;
      summary.totalClauseChanges += changes.length;
      continue;
    }

    // Both sides have it — clause-level diff.
    const changes = diffClauses(b, a);
    if (changes.length === 0) {
      constraints.push({ id, status: "unchanged", changes: [] });
      summary.unchanged++;
    } else {
      constraints.push({ id, status: "changed", changes });
      summary.changed++;
      summary.totalClauseChanges += changes.length;
    }
  }

  return { constraints, summary };
}

/**
 * Diff two predicate trees and return the list of leaf-level changes.
 * Exported for reuse beyond the full per-constraint report.
 */
export function diffClauses(before: unknown, after: unknown): Change[] {
  // Function-form predicates (anything not walkable) → skip clause walk,
  // but report a single "changed" placeholder so callers see something
  // happened at this constraint.
  if (
    before !== undefined &&
    after !== undefined &&
    (before === null ||
      after === null ||
      typeof before !== "object" ||
      typeof after !== "object")
  ) {
    return stableStringify(before) === stableStringify(after)
      ? []
      : [
          {
            path: "",
            kind: "changed",
            before: { op: "$eq", value: before },
            after: { op: "$eq", value: after },
          },
        ];
  }

  const flatB = before === undefined ? [] : flattenPredicate(before);
  const flatA = after === undefined ? [] : flattenPredicate(after);

  // Key by `path + op` so two different operators on the same path (rare
  // but possible in the array form) are tracked independently.
  const keyOf = (c: LeafClause) => `${c.path}::${c.op}`;

  const mapB = new Map<string, LeafClause>(flatB.map((c) => [keyOf(c), c]));
  const mapA = new Map<string, LeafClause>(flatA.map((c) => [keyOf(c), c]));

  const allKeys = new Set([...mapB.keys(), ...mapA.keys()]);
  const changes: Change[] = [];

  for (const key of allKeys) {
    const b = mapB.get(key);
    const a = mapA.get(key);

    if (b && !a) {
      changes.push({
        path: b.path,
        kind: "removed",
        before: { op: b.op, value: b.value },
      });
      continue;
    }
    if (!b && a) {
      changes.push({
        path: a.path,
        kind: "added",
        after: { op: a.op, value: a.value },
      });
      continue;
    }
    if (b && a) {
      if (stableStringify(b.value) === stableStringify(a.value)) {
        continue;
      }
      const direction = directionFor(b.op, b.value, a.value);
      changes.push({
        path: b.path,
        kind: direction ?? "changed",
        before: { op: b.op, value: b.value },
        after: { op: a.op, value: a.value },
      });
    }
  }

  sortChanges(changes);

  return changes;
}

/**
 * Deterministic ordering for change lists: primary key is path, secondary
 * is operator (so two clauses sharing a path — possible in the array form
 * with multiple operators on one fact — order stably). Two byte-identical
 * inputs always produce byte-identical outputs.
 */
function sortChanges(changes: Change[]): void {
  changes.sort((x, y) => {
    const p = x.path.localeCompare(y.path);
    if (p !== 0) return p;
    const xo = x.before?.op ?? x.after?.op ?? "";
    const yo = y.before?.op ?? y.after?.op ?? "";

    return xo.localeCompare(yo);
  });
}
