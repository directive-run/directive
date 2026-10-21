/** `t.nullable()`: one schema builder, in its own module. */

import type { SchemaType } from "../types.js";
import { type ExtendedSchemaType, createSchemaType } from "./base.js";

/**
 * Create a nullable schema type (T | null).
 *
 * @example
 * ```typescript
 * // Nullable string
 * schema: { name: t.nullable(t.string()) }
 *
 * // Nullable object
 * schema: { user: t.nullable(t.object<User>()) }
 * ```
 */
export function nullable<T>(innerType: SchemaType<T>) {
  const innerTypeName =
    (innerType as ExtendedSchemaType<T>)._typeName ?? "unknown";
  return createSchemaType<T | null>(
    [
      (v): v is T | null => {
        if (v === null) {
          return true;
        }
        return innerType._validators.every((validator) => validator(v as T));
      },
    ],
    `${innerTypeName} | null`,
  ) as SchemaType<T | null>;
}
