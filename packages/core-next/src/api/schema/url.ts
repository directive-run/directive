/** `t.url()`: one schema builder, in its own module. */

import { createChainableType } from "./base.js";

/**
 * Create a URL schema type.
 *
 * @example
 * ```typescript
 * schema: { website: t.url() }
 * ```
 */
export function url() {
  return createChainableType<string>(
    [
      (v): v is string => {
        if (typeof v !== "string") {
          return false;
        }
        try {
          new URL(v);
          return true;
        } catch {
          return false;
        }
      },
    ],
    "url",
  );
}
