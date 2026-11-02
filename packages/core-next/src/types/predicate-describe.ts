/**
 * Copied from 1.35 (packages/core/src/core/predicate-describe.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

// ============================================================================
// Public API
// ============================================================================

/**
 * Options controlling how {@link describePredicate} renders a predicate.
 */
export interface DescribeOptions {
  /** Locale for number formatting (default: `"en-US"`). */
  locale?: string;
  /** Wrap each clause in parens when there's > 1 clause. Default `true`. */
  parenthesize?: boolean;
  /** Style: `"natural"` (English prose) or `"formal"` (algebraic). Default `"natural"`. */
  style?: "natural" | "formal";
  /**
   * Friendly fact-name renderer. Default: pass-through. Use to map e.g.
   * `cartTotal` → `"cart total"`. Only consulted in `"natural"` style — the
   * formal style preserves the raw dotted path so output stays algebraic.
   */
  factName?: (path: string) => string;
}
