/** `t.tuple()`: one schema builder, in its own module. */

import isDevelopment from "#is-development";
import type { SchemaType } from "../types.js";
import { type ExtendedSchemaType, createChainableType } from "./base.js";

/**
 * Create a tuple schema type for fixed-length arrays with specific types.
 *
 * @example
 * ```typescript
 * // [string, number] tuple
 * schema: { coord: t.tuple(t.string(), t.number()) }
 *
 * // [x, y, z] coordinates
 * schema: { position: t.tuple(t.number(), t.number(), t.number()) }
 * ```
 */
export function tuple<T extends SchemaType<unknown>[]>(...types: T) {
  if (isDevelopment && types.length === 0) {
    console.warn(
      "[Directive] t.tuple() called with no types - this will only accept empty arrays",
    );
  }
  type TupleType = {
    [K in keyof T]: T[K] extends SchemaType<infer U> ? U : never;
  };
  const typeNames = types.map(
    (schemaType) =>
      (schemaType as ExtendedSchemaType<unknown>)._typeName ?? "unknown",
  );
  return createChainableType<TupleType>(
    [
      (v): v is TupleType => {
        if (!Array.isArray(v) || v.length !== types.length) {
          return false;
        }
        return types.every((schemaType, i) =>
          schemaType._validators.every((validator) => validator(v[i])),
        );
      },
    ],
    `[${typeNames.join(", ")}]`,
  );
}
