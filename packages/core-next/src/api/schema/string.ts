/** `t.string()`: one schema builder, in its own module. */

import type { DefinitionMeta } from "../types.js";
import { type ChainableStringType, createChainableType } from "./base.js";

/**
 * Create a string schema type.
 *
 * @example
 * ```typescript
 * // Basic string
 * schema: { name: t.string() }
 *
 * // String literal union (for type safety)
 * schema: { phase: t.string<"red" | "green" | "yellow">() }
 *
 * // With custom validation
 * schema: { email: t.string().validate(s => s.includes("@")) }
 *
 * // With transform
 * schema: { trimmed: t.string().transform(s => s.trim()) }
 *
 * // With brand
 * schema: { userId: t.string().brand<"UserId">() }
 * ```
 */
export function string<T extends string = string>() {
  type ChainableString = ChainableStringType<T>;

  const createChainableString = (
    validators: Array<(v: T) => boolean>,
    defaultValue?: T | (() => T),
    transform?: (value: unknown) => T,
    description?: string,
    refinements?: Array<{
      predicate: (value: T) => boolean;
      message: string;
    }>,
    fm?: DefinitionMeta,
  ): ChainableString => {
    const chainable = createChainableType<T>(
      validators,
      "string",
      defaultValue,
      transform,
      description,
      refinements,
      fm,
    );
    return {
      ...chainable,
      minLength(n: number) {
        return createChainableString(
          [...validators, (v) => (v as string).length >= n],
          defaultValue,
          transform,
          description,
          refinements,
          fm,
        );
      },
      maxLength(n: number) {
        return createChainableString(
          [...validators, (v) => (v as string).length <= n],
          defaultValue,
          transform,
          description,
          refinements,
          fm,
        );
      },
      pattern(regex: RegExp) {
        return createChainableString(
          [...validators, (v) => regex.test(v as string)],
          defaultValue,
          transform,
          description,
          refinements,
          fm,
        );
      },
      default(value: T | (() => T)) {
        return createChainableString(
          validators,
          value,
          transform,
          description,
          refinements,
          fm,
        );
      },
      describe(desc: string) {
        return createChainableString(
          validators,
          defaultValue,
          transform,
          desc,
          refinements,
          fm,
        );
      },
      refine(predicate: (value: T) => boolean, message: string) {
        const newRefinements = [...(refinements ?? []), { predicate, message }];
        return createChainableString(
          [...validators, predicate],
          defaultValue,
          transform,
          description,
          newRefinements,
          fm,
        );
      },
      meta(m: DefinitionMeta) {
        return createChainableString(
          validators,
          defaultValue,
          transform,
          description,
          refinements,
          m,
        );
      },
    };
  };

  return createChainableString([(v): v is T => typeof v === "string"]);
}
