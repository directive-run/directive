/**
 * Constraint Builder API
 *
 * Fluent builders for creating typed constraint definitions.
 *
 * @example Full builder
 * ```typescript
 * import { constraint } from '@directive-run/core';
 *
 * const escalate = constraint<typeof schema>()
 *   .when(f => f.confidence < 0.7)
 *   .require({ type: 'ESCALATE' })
 *   .priority(50)
 *   .build();
 * ```
 *
 * @example Quick shorthand
 * ```typescript
 * import { when } from '@directive-run/core';
 *
 * const pause = when<typeof schema>(f => f.errors > 3)
 *   .require({ type: 'PAUSE' });
 * ```
 */

import type { Facts } from "./types/facts.js";
import type { RequirementOutput, TypedConstraintDef } from "./types/module.js";
import type { InferRequirements, ModuleSchema } from "./types/schema.js";

// ============================================================================
// Builder Types
// ============================================================================

type WhenFn<M extends ModuleSchema> = (
  facts: Facts<M["facts"]>,
) => boolean | Promise<boolean>;
type RequireValue<M extends ModuleSchema> =
  | RequirementOutput<InferRequirements<M>>
  | ((facts: Facts<M["facts"]>) => RequirementOutput<InferRequirements<M>>);

/** Builder after constraint() — must call .when() first */
export interface ConstraintBuilderStart<M extends ModuleSchema> {
  when(condition: WhenFn<M>): ConstraintBuilderWithWhen<M>;
}

/** Builder after .when() — must call .require() next */
export interface ConstraintBuilderWithWhen<M extends ModuleSchema> {
  require(req: RequireValue<M>): ConstraintBuilderComplete<M>;
}

/** Builder after .require() — optional chaining + .build() */
export interface ConstraintBuilderComplete<M extends ModuleSchema> {
  priority(n: number): ConstraintBuilderComplete<M>;
  after(...ids: string[]): ConstraintBuilderComplete<M>;
  deps(...keys: string[]): ConstraintBuilderComplete<M>;
  timeout(ms: number): ConstraintBuilderComplete<M>;
  async(value: boolean): ConstraintBuilderComplete<M>;
  build(): TypedConstraintDef<M>;
}

/** Result from when().require() — a valid constraint with optional immutable chaining */
export type WhenConstraint<M extends ModuleSchema> = TypedConstraintDef<M> & {
  withPriority(n: number): WhenConstraint<M>;
  withAfter(...ids: string[]): WhenConstraint<M>;
  withDeps(...keys: string[]): WhenConstraint<M>;
  withTimeout(ms: number): WhenConstraint<M>;
  withAsync(value: boolean): WhenConstraint<M>;
};

/** Result from when() — must call .require() */
export interface WhenBuilder<M extends ModuleSchema> {
  require(req: RequireValue<M>): WhenConstraint<M>;
}

// ============================================================================
// constraint() Builder
// ============================================================================

/**
 * Create a constraint using the full builder pattern.
 * Requires `.when()`, `.require()`, and `.build()`.
 *
 * @example
 * ```typescript
 * const c = constraint<typeof schema>()
 *   .when(f => f.phase === "red")
 *   .require({ type: "TRANSITION", to: "green" })
 *   .priority(50)
 *   .after("healthCheck")
 *   .build();
 * ```
 */
export function constraint<
  M extends ModuleSchema,
>(): ConstraintBuilderStart<M> {
  return {
    when(condition: WhenFn<M>): ConstraintBuilderWithWhen<M> {
      return {
        require(req: RequireValue<M>): ConstraintBuilderComplete<M> {
          let _priority: number | undefined;
          let _after: string[] | undefined;
          let _deps: string[] | undefined;
          let _timeout: number | undefined;
          let _async: boolean | undefined;

          const complete: ConstraintBuilderComplete<M> = {
            priority(n) {
              _priority = n;
              return complete;
            },
            after(...ids) {
              _after = _after ? [..._after, ...ids] : [...ids];
              return complete;
            },
            deps(...keys) {
              _deps = _deps ? [..._deps, ...keys] : [...keys];
              return complete;
            },
            timeout(ms) {
              _timeout = ms;
              return complete;
            },
            async(value) {
              _async = value;
              return complete;
            },
            build(): TypedConstraintDef<M> {
              const def: TypedConstraintDef<M> = {
                when: condition,
                require: req,
              };
              if (_priority !== undefined) def.priority = _priority;
              if (_after !== undefined) def.after = _after;
              if (_deps !== undefined) def.deps = _deps;
              if (_timeout !== undefined) def.timeout = _timeout;
              if (_async !== undefined) def.async = _async;
              return def;
            },
          };

          return complete;
        },
      };
    },
  };
}

// ============================================================================
// when() Shorthand
// ============================================================================

/**
 * Create a WhenConstraint — an immutable, chainable object that produces
 * a plain TypedConstraintDef<M> when spread or assigned.
 */
function createWhenConstraint<M extends ModuleSchema>(
  base: TypedConstraintDef<M>,
): WhenConstraint<M> {
  const obj = { ...base } as WhenConstraint<M>;

  obj.withPriority = (n: number) =>
    createWhenConstraint<M>({ ...base, priority: n });

  obj.withAfter = (...ids: string[]) =>
    createWhenConstraint<M>({
      ...base,
      after: base.after ? [...base.after, ...ids] : [...ids],
    });

  obj.withDeps = (...keys: string[]) =>
    createWhenConstraint<M>({
      ...base,
      deps: base.deps ? [...base.deps, ...keys] : [...keys],
    });

  obj.withTimeout = (ms: number) =>
    createWhenConstraint<M>({ ...base, timeout: ms });

  obj.withAsync = (value: boolean) =>
    createWhenConstraint<M>({ ...base, async: value });

  return obj;
}

/**
 * Quick shorthand for creating constraints.
 * Returns a valid constraint directly (no `.build()` needed).
 *
 * @example
 * ```typescript
 * const pause = when<typeof schema>(f => f.errors > 3)
 *   .require({ type: 'PAUSE' });
 *
 * // With optional chaining (immutable — returns new constraint)
 * const halt = when<typeof schema>(f => f.errors > 10)
 *   .require({ type: 'HALT' })
 *   .withPriority(100)
 *   .withAfter('healthCheck');
 * ```
 */
export function when<M extends ModuleSchema>(
  condition: WhenFn<M>,
): WhenBuilder<M> {
  return {
    require(req: RequireValue<M>): WhenConstraint<M> {
      return createWhenConstraint<M>({ when: condition, require: req });
    },
  };
}
