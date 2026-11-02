/**
 * Copied from 1.35 (packages/core/src/core/predicate-to-sql.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

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
