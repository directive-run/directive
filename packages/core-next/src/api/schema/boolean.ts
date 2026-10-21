/** `t.boolean()`: one schema builder, in its own module. */

import { createChainableType } from "./base.js";

/**
 * Create a boolean schema type.
 *
 * @example
 * ```typescript
 * schema: {
 *   active: t.boolean(),
 *   verified: t.boolean().default(false),
 * }
 * ```
 */
export function boolean() {
  return createChainableType<boolean>(
    [(v) => typeof v === "boolean"],
    "boolean",
  );
}
