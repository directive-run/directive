/** `t.optional()`: one schema builder, in its own module. */

import type { SchemaType } from "../types.js";
import { type ExtendedSchemaType, createSchemaType } from "./base.js";

/**
 * Create an optional schema type (T | undefined).
 *
 * @example
 * ```typescript
 * // Optional string
 * schema: { nickname: t.optional(t.string()) }
 *
 * // Optional number
 * schema: { age: t.optional(t.number()) }
 * ```
 */
export function optional<T>(innerType: SchemaType<T>) {
  const innerTypeName =
    (innerType as ExtendedSchemaType<T>)._typeName ?? "unknown";
  return createSchemaType<T | undefined>(
    [
      (v): v is T | undefined => {
        if (v === undefined) {
          return true;
        }
        return innerType._validators.every((validator) => validator(v as T));
      },
    ],
    `${innerTypeName} | undefined`,
  ) as SchemaType<T | undefined>;
}
