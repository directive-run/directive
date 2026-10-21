/** `t.bigint()`: one schema builder, in its own module. */

import { createChainableType } from "./base.js";

/**
 * Create a bigint schema type.
 *
 * @example
 * ```typescript
 * schema: { largeNumber: t.bigint() }
 * ```
 */
export function bigint() {
  return createChainableType<bigint>(
    [(v): v is bigint => typeof v === "bigint"],
    "bigint",
  );
}
