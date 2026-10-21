/** `t.enum()`: one schema builder, in its own module. */

import isDevelopment from "#is-development";
import { createChainableType } from "./base.js";

/**
 * Create an enum schema type for string literal unions.
 *
 * @example
 * ```typescript
 * // Define allowed values
 * schema: { status: t.enum("idle", "loading", "success", "error") }
 *
 * // Type is inferred as "idle" | "loading" | "success" | "error"
 * ```
 */
export function enumType<T extends string>(...values: T[]) {
  if (isDevelopment && values.length === 0) {
    console.warn(
      "[Directive] t.enum() called with no values - this will reject all strings",
    );
  }
  const valueSet = new Set(values);
  return createChainableType<T>(
    [(v): v is T => typeof v === "string" && valueSet.has(v as T)],
    `enum(${values.join("|")})`,
  );
}
