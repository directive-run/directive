/**
 * Compile a `FactPredicate` to a PostgREST querystring.
 *
 * PostgREST's filter grammar is column-scoped: `?age=gte.18&status=in.(active,pending)`.
 * Logical groups use `and=(...)` / `or=(...)` / `not.and=(...)`.
 *
 * Reference: https://postgrest.org/en/stable/api.html#operators
 */

import { MAX_PREDICATE_DEPTH } from "./predicate.js";
import { type FactPredicate, PREDICATE_OPERATORS } from "./types/predicate.js";

export interface PredicateToPostgrestOptions {
  /** Allowlist of column keys the predicate may reference. */
  allowedKeys?: readonly string[];
  /**
   * Encoding mode for the returned string.
   *  - `"querystring"` (default): a full querystring without a leading `?`,
   *    with each clause value URL-encoded — drops straight into `fetch`.
   *  - `"raw"`: the same content, leaving `(`, `)`, `,` unencoded for
   *    readability. Use this only when you'll encode the result yourself.
   */
  mode?: "querystring" | "raw";
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertColumn(name: string, allowed?: readonly string[]): void {
  if (typeof name !== "string" || !IDENT_RE.test(name)) {
    throw new Error(
      `[Directive] predicateToPostgrest: invalid column identifier "${name}"`,
    );
  }
  if (allowed && !allowed.includes(name)) {
    throw new Error(
      `[Directive] predicateToPostgrest: column "${name}" is not in the allowedKeys list — add it to options.allowedKeys or remove it from the predicate`,
    );
  }
}

function assertNoSiblingKeys(
  spec: Record<string, unknown>,
  combinator: string,
): void {
  const sibs = Object.keys(spec).filter((k) => k !== combinator);
  if (sibs.length > 0) {
    throw new Error(
      `[Directive] predicateToPostgrest: ${combinator} cannot coexist with sibling keys (${sibs.join(", ")}) — wrap them in $all together, or move them inside the ${combinator} children`,
    );
  }
}

/** Encode a single PostgREST value. Strings with reserved chars get quoted. */
function encodeValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") {
    // PostgREST treats `,` `.` `(` `)` and `:` as syntax; quote any
    // string containing them. Inside quotes, `"` → `\"` and `\` → `\\`.
    if (/[,.():"\\\s]/.test(v)) {
      return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }

    return v;
  }
  throw new Error(
    `[Directive] predicateToPostgrest: cannot encode value of type ${typeof v}`,
  );
}

function encodeList(arr: readonly unknown[]): string {
  return `(${arr.map(encodeValue).join(",")})`;
}

/** Escape `\`, `%`, `_`, `*` so they match literally instead of as wildcards. */
function escapeLikeOperand(s: string): string {
  return s.replace(/[\\%_*]/g, "\\$&");
}

/**
 * Render the value side of one operator. Returns a string like
 * `gte.18` or `in.(a,b)` — without the column name.
 */
function renderOp(op: string, operand: unknown): string {
  switch (op) {
    case "$eq":
      return `eq.${encodeValue(operand)}`;
    case "$ne":
      return `neq.${encodeValue(operand)}`;
    case "$gt":
      return `gt.${encodeValue(operand)}`;
    case "$gte":
      return `gte.${encodeValue(operand)}`;
    case "$lt":
      return `lt.${encodeValue(operand)}`;
    case "$lte":
      return `lte.${encodeValue(operand)}`;
    case "$in":
      if (!Array.isArray(operand)) {
        throw new Error(
          "[Directive] predicateToPostgrest: $in operand must be an array",
        );
      }
      return `in.${encodeList(operand)}`;
    case "$nin":
      if (!Array.isArray(operand)) {
        throw new Error(
          "[Directive] predicateToPostgrest: $nin operand must be an array",
        );
      }
      return `not.in.${encodeList(operand)}`;
    case "$exists":
      return operand === true ? "not.is.null" : "is.null";
    case "$startsWith":
      if (typeof operand !== "string") {
        throw new Error(
          "[Directive] predicateToPostgrest: $startsWith operand must be a string",
        );
      }
      return `like.${encodeValue(`${escapeLikeOperand(operand)}*`)}`;
    case "$endsWith":
      if (typeof operand !== "string") {
        throw new Error(
          "[Directive] predicateToPostgrest: $endsWith operand must be a string",
        );
      }
      return `like.${encodeValue(`*${escapeLikeOperand(operand)}`)}`;
    case "$contains":
      if (typeof operand !== "string") {
        throw new Error(
          "[Directive] predicateToPostgrest: $contains expects a string operand (array containment is the cs operator with a different shape — out of scope for v1)",
        );
      }
      return `like.${encodeValue(`*${escapeLikeOperand(operand)}*`)}`;
    case "$matches":
      if (operand instanceof RegExp) {
        const o = operand.flags.includes("i") ? "imatch" : "match";

        return `${o}.${encodeValue(operand.source)}`;
      }
      if (typeof operand === "string") {
        return `match.${encodeValue(operand)}`;
      }
      throw new Error(
        "[Directive] predicateToPostgrest: $matches operand must be a RegExp or string",
      );
    // $between is handled at the build() level by decomposing into $gte + $lte.
    case "$changed":
      throw new Error(
        "[Directive] predicateToPostgrest: $changed is an effects-only operator — no server query equivalent",
      );
    default:
      throw new Error(
        `[Directive] predicateToPostgrest: unknown operator "${op}" — known: ${[...PREDICATE_OPERATORS].join(", ")}`,
      );
  }
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

function colClause(column: string, opAndValue: string): string {
  return `${column}=${opAndValue}`;
}

function groupClause(
  logical: "and" | "or" | "not.and" | "not.or",
  parts: string[],
): string {
  return `${logical}=(${parts.join(",")})`;
}

/**
 * Render one operator inside one column. For `$between`, decomposes into
 * two clauses ($gte + $lte) so the predicate's portability promise holds.
 */
function renderColumnOps(
  column: string,
  op: string,
  operand: unknown,
  atTop: boolean,
): string[] {
  if (op === "$between") {
    if (!Array.isArray(operand) || operand.length !== 2) {
      throw new Error(
        "[Directive] predicateToPostgrest: $between operand must be a [low, high] tuple",
      );
    }
    const lo = atTop
      ? colClause(column, renderOp("$gte", operand[0]))
      : `${column}.${renderOp("$gte", operand[0])}`;
    const hi = atTop
      ? colClause(column, renderOp("$lte", operand[1]))
      : `${column}.${renderOp("$lte", operand[1])}`;

    return [lo, hi];
  }

  return [
    atTop
      ? colClause(column, renderOp(op, operand))
      : `${column}.${renderOp(op, operand)}`,
  ];
}

/**
 * Convert a predicate into PostgREST clause strings. Top-level returns a
 * list of `column=value` pairs (joined by `&`); nested returns
 * grouped/clause-list strings depending on the parent combinator.
 *
 * @param atTop  When true, clauses are top-level (& separator).
 *               When false, clauses are inside `and=(...)`/`or=(...)`
 *               and must use `,` separator and `column.op.val` syntax.
 */
function build(
  spec: unknown,
  allowed: readonly string[] | undefined,
  atTop: boolean,
  depth: number,
): string[] {
  if (depth > MAX_PREDICATE_DEPTH) {
    throw new Error(
      `[Directive] predicateToPostgrest: predicate depth limit (${MAX_PREDICATE_DEPTH}) exceeded — flatten the predicate or check for a cyclic spec object`,
    );
  }
  if (spec === null || typeof spec !== "object") {
    throw new Error(
      "[Directive] predicateToPostgrest: predicate must be an object or array",
    );
  }

  if (Array.isArray(spec)) {
    const out: string[] = [];
    for (const clause of spec) {
      if (
        !clause ||
        typeof clause !== "object" ||
        !("fact" in clause) ||
        !("op" in clause)
      ) {
        throw new Error(
          "[Directive] predicateToPostgrest: array-form clause must be { fact, op, value }",
        );
      }
      const c = clause as { fact: string; op: string; value: unknown };
      assertColumn(c.fact, allowed);
      out.push(...renderColumnOps(c.fact, c.op, c.value, atTop));
    }

    return out;
  }

  if ("$all" in spec) {
    assertNoSiblingKeys(spec as Record<string, unknown>, "$all");
    const arr = (spec as { $all: unknown[] }).$all;
    if (!Array.isArray(arr)) {
      throw new Error(
        "[Directive] predicateToPostgrest: $all must be an array",
      );
    }
    if (atTop) {
      const out: string[] = [];
      for (const child of arr) {
        out.push(...build(child, allowed, true, depth + 1));
      }

      return out;
    }
    const parts: string[] = [];
    for (const child of arr) {
      parts.push(...build(child, allowed, false, depth + 1));
    }

    return [groupClause("and", parts)];
  }
  if ("$any" in spec) {
    assertNoSiblingKeys(spec as Record<string, unknown>, "$any");
    const arr = (spec as { $any: unknown[] }).$any;
    if (!Array.isArray(arr)) {
      throw new Error(
        "[Directive] predicateToPostgrest: $any must be an array",
      );
    }
    // Empty $any is tautological-false. PostgREST has no clean way to
    // express "match nothing"; pick a stable contradiction.
    if (arr.length === 0) {
      // pg's `id` exists on every base table — match a value no row can have.
      return atTop
        ? ["id=is.null", "id=not.is.null"]
        : [groupClause("and", ["id.is.null", "id.not.is.null"])];
    }
    const parts: string[] = [];
    for (const child of arr) {
      parts.push(...build(child, allowed, false, depth + 1));
    }

    return [groupClause("or", parts)];
  }
  if ("$not" in spec) {
    assertNoSiblingKeys(spec as Record<string, unknown>, "$not");
    const inner = (spec as { $not: unknown }).$not;
    const parts = build(inner, allowed, false, depth + 1);

    return [groupClause("not.and", parts)];
  }

  // Object form
  const out: string[] = [];
  for (const [key, value] of Object.entries(spec as Record<string, unknown>)) {
    assertColumn(key, allowed);
    if (isOperatorObject(value)) {
      for (const [op, operand] of Object.entries(value)) {
        if (!PREDICATE_OPERATORS.has(op)) {
          throw new Error(
            `[Directive] predicateToPostgrest: unknown operator "${op}" on column "${key}" — known: ${[...PREDICATE_OPERATORS].join(", ")}`,
          );
        }
        out.push(...renderColumnOps(key, op, operand, atTop));
      }
    } else if (isPlainObject(value)) {
      throw new Error(
        `[Directive] predicateToPostgrest: nested predicate at "${key}" — single-table queries only`,
      );
    } else {
      out.push(...renderColumnOps(key, "$eq", value, atTop));
    }
  }

  return out;
}

/**
 * Encode a clause string per PostgREST URL conventions.
 *
 * Splits on first `=` so the column/logical name is preserved verbatim
 * (it's identifier-validated) and only the value side is URL-encoded.
 */
function encodeClause(c: string): string {
  const eq = c.indexOf("=");
  if (eq < 0) return encodeURIComponent(c);
  const key = c.slice(0, eq);
  const value = c.slice(eq + 1);

  return `${key}=${encodeURIComponent(value)}`;
}

/**
 * Compile a {@link FactPredicate} to a PostgREST querystring.
 *
 * @example
 * ```ts
 * predicateToPostgrest({ age: { $gte: 18 }, status: { $in: ["active", "pending"] } })
 * // → "age=gte.18&status=in.%28active%2Cpending%29"
 *
 * // Raw mode for debugging / building URLs by hand:
 * predicateToPostgrest({ age: { $gte: 18 } }, { mode: "raw" })
 * // → "age=gte.18"
 *
 * predicateToPostgrest({ $any: [{ tier: "gold" }, { score: { $gte: 100 } }] }, { mode: "raw" })
 * // → "or=(tier.eq.gold,score.gte.100)"
 * ```
 */
export function predicateToPostgrest<F = Record<string, unknown>>(
  predicate: FactPredicate<F>,
  options: PredicateToPostgrestOptions = {},
): string {
  const mode = options.mode ?? "querystring";
  const clauses = build(predicate, options.allowedKeys, true, 0);
  if (clauses.length === 0) return "";

  return mode === "raw"
    ? clauses.join("&")
    : clauses.map(encodeClause).join("&");
}
