/**
 * Compile a `FactPredicate` to a MongoDB query document. Most of
 * Directive's predicate operator set is already Mongo-compatible by
 * design — this translator handles the few ops that need rewriting
 * (`$startsWith`/`$endsWith`/`$contains` → `$regex`, `$between` →
 * `$gte`+`$lte`, `$matches` → `$regex`/`$options`).
 *
 * Combinators map cleanly: `$all` → `$and`, `$any` → `$or`, `$not` → `$nor`.
 *
 * Pure transformation. No driver dependency.
 */

import { MAX_PREDICATE_DEPTH } from "./predicate.js";
import {
  PREDICATE_OPERATORS,
  type FactPredicate,
} from "./types/predicate.js";

export interface PredicateToMongoOptions {
  /**
   * Allowlist of fact / field keys the predicate may reference. STRONGLY
   * RECOMMENDED for any predicate that crosses a trust boundary.
   */
  allowedKeys?: readonly string[];
  /**
   * Allow `.` in field names (for sub-document traversal: `"user.role"`).
   * Default is `false` — `.` is rejected so the predicate cannot
   * accidentally read sub-document fields the developer did not anticipate.
   */
  allowDottedPaths?: boolean;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isOperatorObject(v: unknown): v is Record<string, unknown> {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v);
  if (keys.length === 0) return false;
  for (const k of keys) {
    if (!k.startsWith("$")) return false;
  }

  return true;
}

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FIELD_DOTTED_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * Reject any field that starts with `$` — that's how Mongo's `$where`
 * JavaScript-evaluation injection lands a predicate-as-RCE. Also reject
 * non-identifier characters (`.`, ` `, etc.) unless dotted paths are
 * explicitly enabled.
 */
function assertFieldName(name: string, opts: PredicateToMongoOptions): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(
      `[Directive] predicateToMongo: field name must be a non-empty string, got ${typeof name}`,
    );
  }
  if (name.startsWith("$")) {
    throw new Error(
      `[Directive] predicateToMongo: field name "${name}" starts with "$" — reserved for Mongo operators (a top-level $where would be an injection vector)`,
    );
  }
  const re = opts.allowDottedPaths ? FIELD_DOTTED_RE : FIELD_RE;
  if (!re.test(name)) {
    throw new Error(
      `[Directive] predicateToMongo: invalid field name "${name}"${opts.allowDottedPaths ? "" : ' — pass options.allowDottedPaths=true to permit sub-document paths like "user.role"'}`,
    );
  }
}

function assertAllowed(
  field: string,
  allowed: readonly string[] | undefined,
): void {
  if (allowed && !allowed.includes(field)) {
    throw new Error(
      `[Directive] predicateToMongo: field "${field}" is not in the allowedKeys list — add it to options.allowedKeys or remove it from the predicate`,
    );
  }
}

function assertNoSiblingKeys(spec: Record<string, unknown>, combinator: string): void {
  const sibs = Object.keys(spec).filter((k) => k !== combinator);
  if (sibs.length > 0) {
    throw new Error(
      `[Directive] predicateToMongo: ${combinator} cannot coexist with sibling keys (${sibs.join(", ")}) — wrap them in $all together, or move them inside the ${combinator} children`,
    );
  }
}

/**
 * Translate a single operator/operand pair into the Mongo equivalent.
 * Returns the value side of `{ field: <here> }`.
 */
function translateOp(op: string, operand: unknown): Record<string, unknown> {
  switch (op) {
    case "$eq":
    case "$ne":
    case "$gt":
    case "$gte":
    case "$lt":
    case "$lte":
    case "$in":
    case "$nin":
    case "$exists":
      return { [op]: operand };
    case "$between": {
      if (!Array.isArray(operand) || operand.length !== 2) {
        throw new Error(
          `[Directive] predicateToMongo: $between operand must be a [low, high] tuple`,
        );
      }
      return { $gte: operand[0], $lte: operand[1] };
    }
    case "$startsWith":
      if (typeof operand !== "string") {
        throw new Error(
          `[Directive] predicateToMongo: $startsWith operand must be a string`,
        );
      }
      return { $regex: `^${escapeRegex(operand)}` };
    case "$endsWith":
      if (typeof operand !== "string") {
        throw new Error(
          `[Directive] predicateToMongo: $endsWith operand must be a string`,
        );
      }
      return { $regex: `${escapeRegex(operand)}$` };
    case "$contains":
      if (typeof operand === "string") {
        return { $regex: escapeRegex(operand) };
      }
      throw new Error(
        `[Directive] predicateToMongo: $contains in Mongo expects a string operand — for array element membership use $elemMatch or $in directly`,
      );
    case "$matches": {
      if (operand instanceof RegExp) {
        return operand.flags
          ? { $regex: operand.source, $options: operand.flags }
          : { $regex: operand.source };
      }
      if (typeof operand === "string") {
        return { $regex: operand };
      }
      throw new Error(
        `[Directive] predicateToMongo: $matches operand must be a RegExp or string`,
      );
    }
    case "$changed":
      throw new Error(
        `[Directive] predicateToMongo: $changed is an effects-only operator — no MongoDB query equivalent`,
      );
    default:
      throw new Error(
        `[Directive] predicateToMongo: unknown operator "${op}" — known: ${[...PREDICATE_OPERATORS].join(", ")}`,
      );
  }
}

function buildQuery(
  spec: unknown,
  opts: PredicateToMongoOptions,
  depth: number,
): Record<string, unknown> {
  if (depth > MAX_PREDICATE_DEPTH) {
    throw new Error(
      `[Directive] predicateToMongo: predicate depth limit (${MAX_PREDICATE_DEPTH}) exceeded — flatten the predicate or check for a cyclic spec object`,
    );
  }
  if (spec === null || typeof spec !== "object") {
    throw new Error(
      `[Directive] predicateToMongo: predicate must be an object or array, got ${typeof spec}`,
    );
  }

  // Array form → implicit AND.
  if (Array.isArray(spec)) {
    if (spec.length === 0) return {};
    const obj: Record<string, unknown> = {};
    const conflicts: Array<Record<string, unknown>> = [];
    for (const clause of spec) {
      if (
        !clause ||
        typeof clause !== "object" ||
        !("fact" in clause) ||
        !("op" in clause)
      ) {
        throw new Error(
          `[Directive] predicateToMongo: array-form clause must be { fact, op, value }`,
        );
      }
      const c = clause as { fact: string; op: string; value: unknown };
      assertFieldName(c.fact, opts);
      assertAllowed(c.fact, opts.allowedKeys);
      const translated = translateOp(c.op, c.value);

      if (c.fact in obj && isPlainObject(obj[c.fact])) {
        const existing = obj[c.fact] as Record<string, unknown>;
        const overlap = Object.keys(translated).some((k) => k in existing);
        if (overlap) {
          conflicts.push({ [c.fact]: translated });
        } else {
          obj[c.fact] = { ...existing, ...translated };
        }
      } else if (c.fact in obj) {
        conflicts.push({ [c.fact]: translated });
      } else {
        obj[c.fact] = translated;
      }
    }
    if (conflicts.length > 0) {
      const andClauses: Array<Record<string, unknown>> = [];
      for (const [k, v] of Object.entries(obj)) {
        andClauses.push({ [k]: v });
      }
      andClauses.push(...conflicts);

      return { $and: andClauses };
    }

    return obj;
  }

  // Combinators
  if ("$all" in spec) {
    assertNoSiblingKeys(spec as Record<string, unknown>, "$all");
    const arr = (spec as { $all: unknown[] }).$all;
    if (!Array.isArray(arr)) {
      throw new Error(`[Directive] predicateToMongo: $all must be an array`);
    }
    if (arr.length === 0) return {};
    if (arr.length === 1) return buildQuery(arr[0], opts, depth + 1);

    return { $and: arr.map((p) => buildQuery(p, opts, depth + 1)) };
  }
  if ("$any" in spec) {
    assertNoSiblingKeys(spec as Record<string, unknown>, "$any");
    const arr = (spec as { $any: unknown[] }).$any;
    if (!Array.isArray(arr)) {
      throw new Error(`[Directive] predicateToMongo: $any must be an array`);
    }
    // Tautological-false — stable across Mongo versions, no _id assumption.
    if (arr.length === 0) return { $expr: { $eq: [1, 0] } };
    if (arr.length === 1) return buildQuery(arr[0], opts, depth + 1);

    return { $or: arr.map((p) => buildQuery(p, opts, depth + 1)) };
  }
  if ("$not" in spec) {
    assertNoSiblingKeys(spec as Record<string, unknown>, "$not");
    const inner = (spec as { $not: unknown }).$not;
    // Mongo's top-level $not is restricted to per-field; $nor: [...]
    // is the portable equivalent.
    return { $nor: [buildQuery(inner, opts, depth + 1)] };
  }

  // Object form — every key is a field name (validated to NOT start with $).
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(spec as Record<string, unknown>)) {
    assertFieldName(key, opts);
    assertAllowed(key, opts.allowedKeys);

    if (isOperatorObject(value)) {
      const merged: Record<string, unknown> = {};
      for (const [op, operand] of Object.entries(value)) {
        if (!PREDICATE_OPERATORS.has(op)) {
          throw new Error(
            `[Directive] predicateToMongo: unknown operator "${op}" on field "${key}" — known: ${[...PREDICATE_OPERATORS].join(", ")}`,
          );
        }
        Object.assign(merged, translateOp(op, operand));
      }
      out[key] = merged;
    } else if (isPlainObject(value)) {
      out[key] = value;
    } else {
      out[key] = value;
    }
  }

  return out;
}

/**
 * Compile a {@link FactPredicate} to a MongoDB query document.
 *
 * Field names are validated to NOT start with `$` (which would land
 * `$where` and other server-side JS evaluation operators directly in the
 * query — an injection vector for AI/user-generated predicates).
 *
 * @example
 * ```ts
 * predicateToMongo({ age: { $gte: 18 }, status: { $in: ["active", "pending"] } })
 * // → { age: { $gte: 18 }, status: { $in: ["active", "pending"] } }
 *
 * predicateToMongo({ name: { $startsWith: "Al" } })
 * // → { name: { $regex: "^Al" } }
 *
 * predicateToMongo({ $any: [{ tier: "gold" }, { score: { $gte: 100 } }] })
 * // → { $or: [{ tier: "gold" }, { score: { $gte: 100 } }] }
 * ```
 */
export function predicateToMongo<F = Record<string, unknown>>(
  predicate: FactPredicate<F>,
  options: PredicateToMongoOptions = {},
): Record<string, unknown> {
  return buildQuery(predicate, options, 0);
}
