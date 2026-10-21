/** `t.any()`: one schema builder, in its own module. */

import { createChainableType } from "./base.js";

/**
 * Create an `any` schema type that accepts all values without validation.
 *
 * @example
 * ```typescript
 * schema: { payload: t.any() }
 * ```
 */
export function any() {
  return createChainableType<any>([], "any");
}
