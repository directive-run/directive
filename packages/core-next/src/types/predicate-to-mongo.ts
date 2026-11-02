/**
 * Copied from 1.35 (packages/core/src/core/predicate-to-mongo.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

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
