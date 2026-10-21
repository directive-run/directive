/** `t.union()`: one schema builder, in its own module. */

import type { SchemaType } from "../types.js";
import {
  type ChainableSchemaType,
  type ExtendedSchemaType,
  createChainableType,
} from "./base.js";

/**
 * Two-form union schema constructor.
 *
 * Hoisted out of the `t` object literal because the overload-cast pattern
 * (`(impl) as { ovl1; ovl2 }`) inside an object literal triggers a TS
 * declaration-emit "implicitly has type any" cycle. Annotating the const
 * with the explicit overload type breaks the cycle so DTS can emit `t`'s
 * shape without recursing through the runtime expression.
 *
 * @internal
 */
export type UnionFn = {
  <T = unknown>(): ChainableSchemaType<T>;
  <T extends SchemaType<unknown>[]>(
    ...types: T
  ): ChainableSchemaType<T[number] extends SchemaType<infer U> ? U : never>;
};

/**
 * Create a union schema type.
 *
 * **Two forms:**
 * - `t.union(t.string(), t.number())` — variadic schema args; the runtime
 *   validator checks that the value matches at least one inner schema.
 * - `t.union<string | number | boolean>()` — generic-only form with no
 *   schema args; the runtime validator accepts ANY value (mirrors
 *   {@link unknown} plus generic narrowing). Use this for polymorphic
 *   payloads where the union is too dynamic to enumerate as inner schemas
 *   (e.g. an `UPDATE_FIELD` event whose `value` may be `string | number |
 *   boolean | Date`).
 *
 * Chainable methods (`.validate`, `.transform`, `.default`, `.describe`,
 * `.refine`, `.optional`, `.nullable`) work the same for both forms.
 *
 * @example
 * ```typescript
 * // Variadic — runtime validation against inner schemas
 * schema: { value: t.union(t.string(), t.number()) }
 *
 * // Generic-only — type-only narrowing, runtime accepts any value
 * schema: {
 *   payload: t.union<string | number | boolean>(),
 * }
 *
 * // Add a custom predicate via .validate when you still want a runtime check
 * schema: {
 *   strict: t.union<string | number>().validate(
 *     (v) => typeof v === "string" || typeof v === "number",
 *   ),
 * }
 * ```
 */
export const union: UnionFn = (<T extends SchemaType<unknown>[]>(
  ...types: T
) => {
  if (types.length === 0) {
    return createChainableType<unknown>([], "union");
  }
  type UnionType = T[number] extends SchemaType<infer U> ? U : never;
  const typeNames = types.map(
    (schemaType) =>
      (schemaType as ExtendedSchemaType<unknown>)._typeName ?? "unknown",
  );
  return createChainableType<UnionType>(
    [
      (v): v is UnionType =>
        types.some((schemaType) => schemaType._validators.every((fn) => fn(v))),
    ],
    typeNames.join(" | "),
  );
}) as UnionFn;
