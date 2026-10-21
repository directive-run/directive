/** `t.array()`: one schema builder, in its own module. */

import type { DefinitionMeta, SchemaType } from "../types.js";
import { type ChainableArrayType, createChainableType } from "./base.js";

/**
 * Create an array schema type.
 * Can be used with or without element validation:
 * - `t.array<string>()` - Type-only, no element validation
 * - `t.array<string>().of(t.string())` - With element validation
 */
export function array<T>() {
  type ChainableArray = ChainableArrayType<T>;

  const createChainableArray = (
    validators: Array<(v: T[]) => boolean>,
    elementType?: SchemaType<T>,
    defaultValue?: T[] | (() => T[]),
    description?: string,
    indexRef?: { value: number },
    fm?: DefinitionMeta,
  ): ChainableArray => {
    const chainable = createChainableType<T[]>(
      validators,
      "array",
      defaultValue,
      undefined,
      description,
      undefined,
      fm,
    );
    // Use ref for storing failed index (shared with validator closure)
    const ref = indexRef ?? { value: -1 };
    const result: ChainableArray = {
      ...chainable,
      get _lastFailedIndex() {
        return ref.value;
      },
      set _lastFailedIndex(v: number) {
        ref.value = v;
      },
      of(et: SchemaType<T>) {
        const newRef = { value: -1 };
        return createChainableArray(
          [
            ...validators,
            (v) => {
              for (let i = 0; i < v.length; i++) {
                if (!et._validators.every((validator) => validator(v[i]))) {
                  newRef.value = i;
                  return false;
                }
              }
              return true;
            },
          ],
          et,
          defaultValue,
          description,
          newRef,
          fm,
        );
      },
      nonEmpty() {
        return createChainableArray(
          [...validators, (v) => v.length > 0],
          elementType,
          defaultValue,
          description,
          ref,
          fm,
        );
      },
      maxLength(n: number) {
        return createChainableArray(
          [...validators, (v) => v.length <= n],
          elementType,
          defaultValue,
          description,
          ref,
          fm,
        );
      },
      minLength(n: number) {
        return createChainableArray(
          [...validators, (v) => v.length >= n],
          elementType,
          defaultValue,
          description,
          ref,
          fm,
        );
      },
      default(value: T[] | (() => T[])) {
        return createChainableArray(
          validators,
          elementType,
          value,
          description,
          ref,
          fm,
        );
      },
      describe(desc: string) {
        return createChainableArray(
          validators,
          elementType,
          defaultValue,
          desc,
          ref,
          fm,
        );
      },
      meta(m: DefinitionMeta) {
        return createChainableArray(
          validators,
          elementType,
          defaultValue,
          description,
          ref,
          m,
        );
      },
    };
    return result;
  };
  return createChainableArray([(v) => Array.isArray(v)]);
}
