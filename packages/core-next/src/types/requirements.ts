/**
 * Requirement Types - Type definitions for requirements and constraints
 */

import type { Facts } from "./facts.js";
import type { DefinitionMeta } from "./meta.js";
import type { FactPredicate } from "./predicate.js";
import type { InferSchema, Schema, SchemaType } from "./schema.js";

// ============================================================================
// Requirement Types
// ============================================================================

/** Base requirement structure */
export interface Requirement {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** Requirement with computed identity */
export interface RequirementWithId {
  readonly requirement: Requirement;
  readonly id: string;
  readonly fromConstraint: string;
}

/** Requirement key function for custom deduplication */
export type RequirementKeyFn<R extends Requirement = Requirement> = (
  req: R,
) => string;

// ============================================================================
// Requirement Schema Types
// ============================================================================

/**
 * Requirement payload schema - maps property names to their types.
 */
export type RequirementPayloadSchema = Record<string, SchemaType<unknown>>;

/**
 * Requirements schema definition - maps requirement type names to their payload schemas.
 *
 * @example
 * ```typescript
 * const module = createModule("inventory", {
 *   requirements: {
 *     RESTOCK: { sku: t.string(), quantity: t.number() },
 *     ALERT: { message: t.string() },
 *   },
 * });
 * ```
 */
export type RequirementsSchema = Record<string, RequirementPayloadSchema>;

/**
 * Infer the requirement payload type from a requirement payload schema.
 */
export type InferRequirementPayload<P extends RequirementPayloadSchema> = {
  [K in keyof P]: P[K] extends SchemaType<infer T> ? T : never;
};

/**
 * Infer all requirements from a requirements schema as a discriminated union.
 */
export type InferRequirementsFromSchema<R extends RequirementsSchema> = {
  [K in keyof R]: { type: K } & InferRequirementPayload<R[K]>;
}[keyof R];

/**
 * Infer requirement type names from a requirements schema.
 */
export type InferRequirementTypes<R extends RequirementsSchema> = keyof R &
  string;

// ============================================================================
// Constraint Types
// ============================================================================

/**
 * Requirement output from a constraint - can be single, array, or null.
 * - Single requirement: `{ type: "RESTOCK", sku: "ABC" }`
 * - Multiple requirements: `[{ type: "RESTOCK", sku: "ABC" }, { type: "NOTIFY", message: "Low stock" }]`
 * - No requirements: `null` or `[]`
 */
export type RequirementOutput<R extends Requirement = Requirement> =
  | R
  | R[]
  | null;

/** Constraint definition */
export interface ConstraintDef<
  S extends Schema,
  R extends Requirement = Requirement,
> {
  /** Priority for ordering (higher runs first) */
  priority?: number;
  /** Mark this constraint as async (avoids runtime detection) */
  async?: boolean;
  /**
   * Condition the constraint requires. Either:
   * - a function (sync or async) `(facts, derived) => boolean`, or
   * - a declarative {@link FactPredicate} spec — serializable, inspectable,
   *   always synchronous; e.g. `{ phase: "red", elapsed: { $gte: 30 } }`.
   *
   * `derived` is the same second argument, in the same position, that a
   * derivation body receives — read it rather than reaching back through
   * `system.derive`, which is the single-module accessor and resolves a
   * namespace instead of a value once the module is composed.
   *
   * A data `when` is normalized to a wrapper function at registration; the
   * wrapper still reads through the tracked facts proxy, so auto-tracking
   * captures both fact and derivation deps correctly.
   */
  when:
    | ((
        facts: Facts<S>,
        derived: Record<string, unknown>,
      ) => boolean | Promise<boolean>)
    | FactPredicate<InferSchema<S>>;
  /**
   * Requirement(s) to produce when condition is met.
   * - Single requirement: `{ type: "RESTOCK", sku: "ABC" }`
   * - Multiple requirements: `[{ type: "RESTOCK", sku: "ABC" }, { type: "NOTIFY", message: "Low" }]`
   * - Function returning requirements: `(facts) => ({ type: "RESTOCK", sku: facts.sku })`
   * - Function returning null/empty array for conditional no-op: `(facts) => facts.critical ? [...] : null`
   *
   * Receives `derived` as its second argument, same as `when`.
   */
  require:
    | RequirementOutput<R>
    | ((
        facts: Facts<S>,
        derived: Record<string, unknown>,
      ) => RequirementOutput<R>);
  /** Timeout for async constraints (ms) */
  timeout?: number;
  /**
   * Fact keys this resolver **aborts on** when they change mid-flight.
   * The engine snapshots their values at resolver dispatch; if any of
   * them changes before the resolver writes, the resolver's writes are
   * dropped and the resolver aborted.
   *
   * Reads aloud as "abort on changes to these facts." This is the
   * opposite shape of a lock — the resolver yields to whoever wrote
   * first; it does NOT prevent other writers. Value-based per-fact
   * compare-and-swap with one-shot fact-level poisoning, not document
   * versioning. Writes to facts not listed always land; `when()` is not
   * consulted. Omit for no binding (default). Ignored on async
   * constraints.
   *
   * @example
   * ```ts
   * executeAction: {
   *   when: (f) => f.status === 'mutating',
   *   require: { type: 'EXECUTE_ACTION' },
   *   abortOn: ['status'], // abort if `status` changes mid-flight
   * }
   * ```
   */
  abortOn?: readonly string[];
  /**
   * Constraint IDs whose resolvers must complete before this constraint is evaluated.
   * If a dependency's `when()` returns false (no requirements), this constraint proceeds.
   * If a dependency's resolver fails, this constraint remains blocked.
   * Same-module references are auto-prefixed. Cross-module: use "moduleName::constraintName" format.
   */
  after?: string[];
  /**
   * Explicit fact dependencies for this constraint.
   * Required for async constraints to enable dependency tracking (auto-tracking
   * cannot work across async boundaries). Also works for sync constraints to
   * bypass auto-tracking overhead.
   */
  deps?: string[];
  /** Optional metadata for debugging and devtools (never read on hot path). */
  meta?: DefinitionMeta;
}

/** Map of constraint definitions (generic) */
export type ConstraintsDef<S extends Schema> = Record<
  string,
  ConstraintDef<S, Requirement>
>;

/** Map of constraint definitions with typed requirements */
export type TypedConstraintsDef<
  S extends Schema,
  R extends RequirementsSchema,
> = Record<
  string,
  ConstraintDef<S, Requirement & InferRequirementsFromSchema<R>>
>;

/** Internal constraint state */
export interface ConstraintState {
  id: string;
  priority: number;
  isAsync: boolean;
  lastResult: boolean | null;
  isEvaluating: boolean;
  error: Error | null;
  /** Timestamp when this constraint's resolver(s) last completed successfully */
  lastResolvedAt: number | null;
  /** Constraint IDs this constraint is waiting on (from `after` property) */
  after: string[];
  /** Number of times when() evaluated to true */
  hitCount: number;
  /** Timestamp of last when() → true evaluation */
  lastActiveAt: number | null;
}
