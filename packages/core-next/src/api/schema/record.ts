/** `t.record()`: one schema builder, in its own module. */

import type { SchemaType } from "../types.js";
import { type ExtendedSchemaType, createChainableType } from "./base.js";

/**
 * Create a record schema type for dynamic key-value maps.
 *
 * @example
 * ```typescript
 * // Record with string values
 * schema: { metadata: t.record(t.string()) }
 *
 * // Record with number values
 * schema: { scores: t.record(t.number()) }
 * ```
 */
export function record<V>(valueType: SchemaType<V>) {
  const valueTypeName =
    (valueType as ExtendedSchemaType<V>)._typeName ?? "unknown";
  return createChainableType<Record<string, V>>(
    [
      (v): v is Record<string, V> => {
        if (typeof v !== "object" || v === null || Array.isArray(v))
          return false;
        return Object.values(v).every((val) =>
          valueType._validators.every((validator) => validator(val)),
        );
      },
    ],
    `Record<string, ${valueTypeName}>`,
  );
}
