/** `t.date()`: one schema builder, in its own module. */

import { createChainableType } from "./base.js";

/**
 * Create a date schema type.
 *
 * @example
 * ```typescript
 * schema: { createdAt: t.date() }
 * ```
 */
export function date() {
  return createChainableType<Date>(
    [(v): v is Date => v instanceof Date && !Number.isNaN(v.getTime())],
    "Date",
  );
}
