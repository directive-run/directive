/** `t.unknown()`: one schema builder, in its own module. */

import { createChainableType } from "./base.js";

/**
 * Create an `unknown` schema type that accepts all values without validation.
 * Prefer `t.unknown()` over `t.any()` for stricter downstream type checking.
 *
 * @example
 * ```typescript
 * schema: { data: t.unknown() }
 * ```
 */
export function unknown() {
  return createChainableType<unknown>([], "unknown");
}
