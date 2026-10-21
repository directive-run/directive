/** `t.uuid()`: one schema builder, in its own module. */

import { createChainableType } from "./base.js";

/**
 * Create a UUID schema type.
 *
 * @example
 * ```typescript
 * schema: { id: t.uuid() }
 * ```
 */
export function uuid() {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return createChainableType<string>(
    [(v): v is string => typeof v === "string" && uuidRegex.test(v)],
    "uuid",
  );
}
