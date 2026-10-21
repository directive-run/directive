/** `t.object()`: one schema builder, in its own module. */

import type { DefinitionMeta, SchemaType } from "../types.js";
import { type ChainableObjectType, createChainableType } from "./base.js";

/**
 * Create an object schema type for any complex value.
 * Can be used with or without shape validation:
 * - `t.object<User>()` - Type-only, no property validation
 * - `t.object<User>().shape({ name: t.string(), age: t.number() })` - With property validation
 *
 * For arrays, prefer `t.array<T>()` which adds `Array.isArray` validation.
 */
export function object<T>() {
  type ChainableObject = ChainableObjectType<T>;

  const createChainableObject = (
    validators: Array<(v: T) => boolean>,
    defaultValue?: T | (() => T),
    description?: string,
    fm?: DefinitionMeta,
  ): ChainableObject => {
    const chainable = createChainableType<T>(
      validators,
      "object",
      defaultValue,
      undefined,
      description,
      undefined,
      fm,
    );
    return {
      ...chainable,
      shape(shapeSchema: { [K in keyof T]?: SchemaType<T[K]> }) {
        return createChainableObject(
          [
            ...validators,
            (v) => {
              for (const [key, schemaType] of Object.entries(shapeSchema)) {
                const value = (v as Record<string, unknown>)[key];
                const schemaT = schemaType as SchemaType<unknown>;
                if (
                  schemaT &&
                  !schemaT._validators.every((validator) => validator(value))
                ) {
                  return false;
                }
              }
              return true;
            },
          ],
          defaultValue,
          description,
          fm,
        );
      },
      nonNull() {
        return createChainableObject(
          [...validators, (v) => v !== null && v !== undefined],
          defaultValue,
          description,
          fm,
        );
      },
      hasKeys(...keys: string[]) {
        return createChainableObject(
          [
            ...validators,
            (v) => keys.every((k) => k in (v as Record<string, unknown>)),
          ],
          defaultValue,
          description,
          fm,
        );
      },
      default(value: T | (() => T)) {
        return createChainableObject(validators, value, description, fm);
      },
      describe(desc: string) {
        return createChainableObject(validators, defaultValue, desc, fm);
      },
      meta(m: DefinitionMeta) {
        return createChainableObject(validators, defaultValue, description, m);
      },
    };
  };
  return createChainableObject([
    (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  ]);
}
