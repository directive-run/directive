/**
 * Compile a `FactPredicate` to a parameterized Postgres-style SQL WHERE
 * clause. The same predicate that gates a constraint on the client can
 * filter rows on the server — *one source of truth, two execution sites*.
 *
 * Pure transformation. No engine, no driver, no string concatenation of
 * user values (all operands flow through the parameter array → safe
 * against SQL injection by construction).
 */

import { MAX_PREDICATE_DEPTH } from "./predicate.js";
import { type FactPredicate, PREDICATE_OPERATORS } from "./types/predicate.js";

// ============================================================================
// Types
// ============================================================================

export interface PredicateToSqlOptions {
  /** Table to query. Validated against the same identifier rule as columns. */
  table: string;
  /**
   * Allowlist of fact / column keys the predicate may reference. STRONGLY
   * RECOMMENDED for any predicate that crosses a trust boundary (AI
   * generation, user input, JSON-over-the-wire). Without an allowlist, a
   * predicate may reference any column the table has.
   */
  allowedKeys?: readonly string[];
  /**
   * Customize the `SELECT` projection. Default `"*"`. Accepts:
   *   - `"*"`
   *   - a column identifier (`"id"` or `"users.id"`)
   *   - an array of column identifiers (`["id", "name"]`) — joined with `,`
   * Free-form strings (e.g. `"COUNT(*)"`) are rejected — build the wrapper
   * SQL manually with {@link predicateToWhere} for those cases.
   */
  select?: string | readonly string[];
  /**
   * Parameter placeholder generator. Default is Postgres-style `$1`, `$2`.
   * Pass `() => "?"` for MySQL/SQLite, or supply your own scheme.
   */
  placeholder?: (oneBasedIndex: number) => string;
}

export interface PredicateToSqlResult {
  /** Full `SELECT … FROM table WHERE …` statement. */
  sql: string;
  /** Just the `WHERE` clause body (without the literal `WHERE`). */
  where: string;
  /** Parameters, in `$1`-then-`$2`-then-… order. */
  params: unknown[];
}

// ============================================================================
// Identifier safety
// ============================================================================

/**
 * Strict identifier check: alpha, digits, underscore, optional dot for
 * qualified names (`table.column`). No whitespace, no quotes, no
 * semicolons — anything not matching is rejected with a clear error.
 *
 * Identifiers are interpolated *literally* into the SQL string (the only
 * safe alternative is double-quoting, which changes case sensitivity).
 * This regex is the only thing standing between a column-name typo and a
 * SQL injection — keep it strict.
 */
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;

function assertIdentifier(name: string, kind: "table" | "column"): void {
  if (typeof name !== "string" || !IDENT_RE.test(name)) {
    throw new Error(
      `[Directive] predicateToSQL: invalid ${kind} identifier "${name}" — must match /^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)?$/`,
    );
  }
}

function assertAllowed(
  name: string,
  allowed: readonly string[] | undefined,
): void {
  if (allowed && !allowed.includes(name)) {
    throw new Error(
      `[Directive] predicateToSQL: column "${name}" is not in the allowedKeys list — add it to options.allowedKeys or remove it from the predicate`,
    );
  }
}

function validateSelect(select: string | readonly string[]): string {
  if (Array.isArray(select)) {
    if (select.length === 0) {
      throw new Error("[Directive] predicateToSQL: select must not be empty");
    }
    for (const col of select) {
      assertIdentifier(col, "column");
    }

    return select.join(", ");
  }
  const s = select as string;
  if (s === "*") return "*";
  assertIdentifier(s, "column");

  return s;
}

// ============================================================================
// Operator translation
// ============================================================================

interface BuildContext {
  params: unknown[];
  placeholder: (i: number) => string;
  allowed?: readonly string[];
}

function nextParam(ctx: BuildContext, value: unknown): string {
  ctx.params.push(value);

  return ctx.placeholder(ctx.params.length);
}

/**
 * Render one operator on one column. `column` is already
 * identifier-validated; the operand goes through `nextParam` so it lands
 * in `params`, never in the SQL string.
 */
function renderOp(
  column: string,
  op: string,
  operand: unknown,
  ctx: BuildContext,
): string {
  switch (op) {
    case "$eq":
      return `${column} = ${nextParam(ctx, operand)}`;
    case "$ne":
      return `${column} <> ${nextParam(ctx, operand)}`;
    case "$gt":
      return `${column} > ${nextParam(ctx, operand)}`;
    case "$gte":
      return `${column} >= ${nextParam(ctx, operand)}`;
    case "$lt":
      return `${column} < ${nextParam(ctx, operand)}`;
    case "$lte":
      return `${column} <= ${nextParam(ctx, operand)}`;
    case "$in":
      if (!Array.isArray(operand)) {
        throw new Error(
          "[Directive] predicateToSQL: $in operand must be an array",
        );
      }
      return `${column} = ANY(${nextParam(ctx, operand)})`;
    case "$nin":
      if (!Array.isArray(operand)) {
        throw new Error(
          "[Directive] predicateToSQL: $nin operand must be an array",
        );
      }
      return `NOT (${column} = ANY(${nextParam(ctx, operand)}))`;
    case "$exists":
      return operand === true ? `${column} IS NOT NULL` : `${column} IS NULL`;
    case "$between": {
      if (!Array.isArray(operand) || operand.length !== 2) {
        throw new Error(
          "[Directive] predicateToSQL: $between operand must be a [low, high] tuple",
        );
      }
      return `${column} BETWEEN ${nextParam(ctx, operand[0])} AND ${nextParam(ctx, operand[1])}`;
    }
    case "$startsWith":
      if (typeof operand !== "string") {
        throw new Error(
          "[Directive] predicateToSQL: $startsWith operand must be a string",
        );
      }
      // ESCAPE '\' makes the escape character deterministic regardless of
      // the server's standard_conforming_strings setting or MySQL's
      // NO_BACKSLASH_ESCAPES mode.
      return `${column} LIKE ${nextParam(ctx, escapeLike(operand))} || '%' ESCAPE '\\'`;
    case "$endsWith":
      if (typeof operand !== "string") {
        throw new Error(
          "[Directive] predicateToSQL: $endsWith operand must be a string",
        );
      }
      return `${column} LIKE '%' || ${nextParam(ctx, escapeLike(operand))} ESCAPE '\\'`;
    case "$contains":
      if (typeof operand !== "string") {
        throw new Error(
          "[Directive] predicateToSQL: $contains only supports string operands — array containment requires a JOIN, not a predicate",
        );
      }
      return `${column} LIKE '%' || ${nextParam(ctx, escapeLike(operand))} || '%' ESCAPE '\\'`;
    case "$matches": {
      if (!(operand instanceof RegExp)) {
        throw new Error(
          "[Directive] predicateToSQL: $matches operand must be a RegExp",
        );
      }
      // Postgres uses ~ (case-sensitive) and ~* (case-insensitive). The
      // RegExp's `i` flag picks the operator; other flags are silently
      // dropped because their semantics differ between JS and Postgres.
      const operator = operand.flags.includes("i") ? "~*" : "~";

      return `${column} ${operator} ${nextParam(ctx, operand.source)}`;
    }
    case "$changed":
      throw new Error(
        `[Directive] predicateToSQL: $changed is an effects-only operator — no server-side translation (a database row has no "prev" snapshot)`,
      );
    default:
      throw new Error(
        `[Directive] predicateToSQL: unknown operator "${op}" — known: ${[...PREDICATE_OPERATORS].join(", ")}`,
      );
  }
}

/**
 * Escape `%`, `_`, and `\` in a LIKE operand. Paired with an explicit
 * `ESCAPE '\'` clause for cross-database determinism.
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

// ============================================================================
// Recursive walk
// ============================================================================

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

function assertNoSiblingKeys(
  spec: Record<string, unknown>,
  combinator: string,
): void {
  const sibs = Object.keys(spec).filter((k) => k !== combinator);
  if (sibs.length > 0) {
    throw new Error(
      `[Directive] predicateToSQL: ${combinator} cannot coexist with sibling keys (${sibs.join(", ")}) — wrap them in $all together, or move them inside the ${combinator} children`,
    );
  }
}

function buildWhere(spec: unknown, ctx: BuildContext, depth: number): string {
  if (depth > MAX_PREDICATE_DEPTH) {
    throw new Error(
      `[Directive] predicateToSQL: predicate depth limit (${MAX_PREDICATE_DEPTH}) exceeded — flatten the predicate or check for a cyclic spec object`,
    );
  }
  if (spec === null || typeof spec !== "object") {
    throw new Error(
      `[Directive] predicateToSQL: predicate must be an object or array, got ${typeof spec}`,
    );
  }

  // Array-form predicate ([{fact, op, value}, ...]) — implicit AND.
  if (Array.isArray(spec)) {
    if (spec.length === 0) return "TRUE";
    const parts = spec.map((clause) => {
      if (
        !clause ||
        typeof clause !== "object" ||
        !("fact" in clause) ||
        !("op" in clause)
      ) {
        throw new Error(
          "[Directive] predicateToSQL: array-form clause must be { fact, op, value }",
        );
      }
      const c = clause as { fact: string; op: string; value: unknown };
      assertIdentifier(c.fact, "column");
      assertAllowed(c.fact, ctx.allowed);

      return renderOp(c.fact, c.op, c.value, ctx);
    });

    return parts.length === 1 ? parts[0]! : `(${parts.join(" AND ")})`;
  }

  // Combinators — must be the *only* key on the object.
  if ("$all" in spec) {
    assertNoSiblingKeys(spec as Record<string, unknown>, "$all");
    const arr = (spec as { $all: unknown[] }).$all;
    if (!Array.isArray(arr)) {
      throw new Error("[Directive] predicateToSQL: $all must be an array");
    }
    if (arr.length === 0) return "TRUE";
    const parts = arr.map((p) => buildWhere(p, ctx, depth + 1));

    return parts.length === 1 ? parts[0]! : `(${parts.join(" AND ")})`;
  }
  if ("$any" in spec) {
    assertNoSiblingKeys(spec as Record<string, unknown>, "$any");
    const arr = (spec as { $any: unknown[] }).$any;
    if (!Array.isArray(arr)) {
      throw new Error("[Directive] predicateToSQL: $any must be an array");
    }
    if (arr.length === 0) return "FALSE";
    const parts = arr.map((p) => buildWhere(p, ctx, depth + 1));

    return parts.length === 1 ? parts[0]! : `(${parts.join(" OR ")})`;
  }
  if ("$not" in spec) {
    assertNoSiblingKeys(spec as Record<string, unknown>, "$not");
    const inner = (spec as { $not: unknown }).$not;

    return `NOT (${buildWhere(inner, ctx, depth + 1)})`;
  }

  // Object form — every key is a column, every value either a literal
  // (equality) or an operator object.
  const parts: string[] = [];
  for (const [key, value] of Object.entries(spec as Record<string, unknown>)) {
    assertIdentifier(key, "column");
    assertAllowed(key, ctx.allowed);

    if (isOperatorObject(value)) {
      for (const [op, operand] of Object.entries(value)) {
        if (!PREDICATE_OPERATORS.has(op)) {
          throw new Error(
            `[Directive] predicateToSQL: unknown operator "${op}" on column "${key}" — known: ${[...PREDICATE_OPERATORS].join(", ")}`,
          );
        }
        parts.push(renderOp(key, op, operand, ctx));
      }
    } else if (isPlainObject(value)) {
      throw new Error(
        `[Directive] predicateToSQL: nested predicate at "${key}" — cross-module / partial-match predicates have no SQL equivalent (single-table queries only in v1; pass a flat predicate or build JOIN by hand with predicateToWhere)`,
      );
    } else {
      parts.push(renderOp(key, "$eq", value, ctx));
    }
  }

  if (parts.length === 0) return "TRUE";
  if (parts.length === 1) return parts[0]!;

  return `(${parts.join(" AND ")})`;
}

// ============================================================================
// Public API
// ============================================================================

const DEFAULT_PLACEHOLDER = (i: number) => `$${i}`;

/**
 * Compile a {@link FactPredicate} to a parameterized SQL statement.
 *
 * Operand values **never** appear in the SQL string — they flow through
 * the `params` array. Table and column identifiers are regex-validated.
 *
 * @example
 * ```ts
 * const where = { age: { $gte: 18 }, status: { $in: ["active", "pending"] } };
 *
 * predicateToSQL(where, { table: "users" });
 * // → { sql: "SELECT * FROM users WHERE (age >= $1 AND status = ANY($2))",
 * //     where: "(age >= $1 AND status = ANY($2))",
 * //     params: [18, ["active", "pending"]] }
 *
 * // MySQL/SQLite placeholder:
 * predicateToSQL(where, { table: "users", placeholder: () => "?" });
 *
 * // Recommended for AI/user-supplied predicates:
 * predicateToSQL(where, { table: "users", allowedKeys: ["age", "status"] });
 * ```
 */
export function predicateToSQL<F = Record<string, unknown>>(
  predicate: FactPredicate<F>,
  options: PredicateToSqlOptions,
): PredicateToSqlResult {
  const { table, allowedKeys } = options;
  const placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER;
  const select = options.select ?? "*";

  assertIdentifier(table, "table");
  const projection = validateSelect(select);

  const ctx: BuildContext = { params: [], placeholder, allowed: allowedKeys };
  const where = buildWhere(predicate, ctx, 0);
  const sql = `SELECT ${projection} FROM ${table} WHERE ${where}`;

  return { sql, where, params: ctx.params };
}

/**
 * Lower-level variant — returns just the `WHERE` clause body and the
 * `params` array, no `SELECT ... FROM` wrapper. Use this when you need
 * to embed the WHERE in a larger query (JOIN, UPDATE, DELETE, COUNT).
 *
 * @example
 * ```ts
 * const { where, params } = predicateToWhere({ age: { $gte: 18 } });
 * await db.query(`UPDATE users SET tier = 'adult' WHERE ${where}`, params);
 * ```
 */
export function predicateToWhere<F = Record<string, unknown>>(
  predicate: FactPredicate<F>,
  options: Omit<PredicateToSqlOptions, "table" | "select"> = {},
): { where: string; params: unknown[] } {
  const placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER;
  const ctx: BuildContext = {
    params: [],
    placeholder,
    allowed: options.allowedKeys,
  };

  return { where: buildWhere(predicate, ctx, 0), params: ctx.params };
}
