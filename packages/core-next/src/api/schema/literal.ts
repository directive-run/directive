/** `t.literal()`: one schema builder, in its own module. */

import { createChainableType } from "./base.js";

/**
 * Create a literal schema type for exact value matching.
 *
 * @example
 * ```typescript
 * // Exact string match
 * schema: { type: t.literal("user") }
 *
 * // Exact number match
 * schema: { version: t.literal(1) }
 *
 * // Exact boolean
 * schema: { enabled: t.literal(true) }
 * ```
 */
export function literal<T extends string | number | boolean>(value: T) {
  return createChainableType<T>(
    [(v): v is T => v === value],
    `literal(${String(value)})`,
  );
}
