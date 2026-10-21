/** `t.number()`: one schema builder, in its own module. */

import type { DefinitionMeta } from "../types.js";
import { type ChainableNumberType, createChainableType } from "./base.js";

/**
 * Create a number schema type with optional min/max constraints.
 *
 * @example
 * ```typescript
 * // Basic number
 * schema: { count: t.number() }
 *
 * // With range constraints
 * schema: { age: t.number().min(0).max(150) }
 *
 * // With custom validation
 * schema: { even: t.number().validate(n => n % 2 === 0) }
 *
 * // With default
 * schema: { count: t.number().default(0) }
 *
 * // With transform (from string)
 * schema: { age: t.number().transform(v => parseInt(String(v), 10)) }
 * ```
 */
export function number() {
  type ChainableNumber = ChainableNumberType;

  const createChainableNumber = (
    validators: Array<(v: number) => boolean>,
    defaultValue?: number | (() => number),
    transform?: (value: unknown) => number,
    description?: string,
    refinements?: Array<{
      predicate: (value: number) => boolean;
      message: string;
    }>,
    fm?: DefinitionMeta,
  ): ChainableNumber => {
    const chainable = createChainableType<number>(
      validators,
      "number",
      defaultValue,
      transform,
      description,
      refinements,
      fm,
    );
    return {
      ...chainable,
      min(n: number) {
        return createChainableNumber(
          [...validators, (v) => v >= n],
          defaultValue,
          transform,
          description,
          refinements,
          fm,
        );
      },
      max(n: number) {
        return createChainableNumber(
          [...validators, (v) => v <= n],
          defaultValue,
          transform,
          description,
          refinements,
          fm,
        );
      },
      default(value: number | (() => number)) {
        return createChainableNumber(
          validators,
          value,
          transform,
          description,
          refinements,
          fm,
        );
      },
      describe(desc: string) {
        return createChainableNumber(
          validators,
          defaultValue,
          transform,
          desc,
          refinements,
          fm,
        );
      },
      refine(predicate: (value: number) => boolean, message: string) {
        const newRefinements = [...(refinements ?? []), { predicate, message }];
        return createChainableNumber(
          [...validators, predicate],
          defaultValue,
          transform,
          description,
          newRefinements,
          fm,
        );
      },
      meta(m: DefinitionMeta) {
        return createChainableNumber(
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
  return createChainableNumber([(v) => typeof v === "number"]);
}
