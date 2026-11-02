/**
 * Copied from 1.35 (packages/core/src/core/predicate-to-pgrest.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

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
