/** `t.email()`: one schema builder, in its own module. */

import { createChainableType } from "./base.js";

/**
 * Create an email schema type.
 *
 * @example
 * ```typescript
 * schema: { email: t.email() }
 * ```
 */
export function email() {
  // Simple email regex - for comprehensive validation use Zod
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return createChainableType<string>(
    [(v): v is string => typeof v === "string" && emailRegex.test(v)],
    "email",
  );
}
