/**
 * Derivation Types - Type definitions for derivations
 */

import type { Facts } from "./facts.js";
import type { DefinitionMeta } from "./meta.js";
import type { InferDerivations, ModuleSchema, Schema } from "./schema.js";

// ============================================================================
// Derivation Types (internal engine use)
// ============================================================================

/** Derivation definition function signature. */
export interface DerivationDef<
  S extends Schema,
  T,
  D extends DerivationsDef<S>,
> {
  (facts: Facts<S>, derived: DerivedValues<S, D>): T;
}

/**
 * Derivation definition with metadata (object form).
 * Use this when you want to attach debugging metadata to a derivation.
 *
 * @example
 * ```typescript
 * derive: {
 *   displayName: {
 *     compute: (facts) => `${facts.firstName} ${facts.lastName}`,
 *     meta: { label: "Display Name", description: "Full name for UI" },
 *   },
 * },
 * ```
 */
export interface DerivationDefWithMeta<
  S extends Schema,
  T,
  D extends DerivationsDef<S>,
> {
  compute: DerivationDef<S, T, D>;
  meta?: DefinitionMeta;
}

/** Derivation definition: function form or object form with meta. */
export type DerivationDefOrMeta<
  S extends Schema,
  T,
  D extends DerivationsDef<S>,
> = DerivationDef<S, T, D> | DerivationDefWithMeta<S, T, D>;

/** Map of derivation definitions (internal — always bare functions after unwrap). */
export type DerivationsDef<S extends Schema> = Record<
  string,
  DerivationDef<S, unknown, DerivationsDef<S>>
>;

/** Computed derived values. */
export type DerivedValues<S extends Schema, D extends DerivationsDef<S>> = {
  readonly [K in keyof D]: ReturnType<D[K]>;
};

// ============================================================================
// Schema-Based Derivation Types
// ============================================================================

/**
 * Derive accessor type from a module schema.
 * Provides typed access to derivation values.
 *
 * @example
 * ```typescript
 * type MySchema = {
 *   facts: { count: SchemaType<number> };
 *   derivations: { doubled: SchemaType<number>; isPositive: SchemaType<boolean> };
 *   events: {};
 *   requirements: {};
 * };
 *
 * type Accessor = DeriveAccessorFromSchema<MySchema>;
 * // { readonly doubled: number; readonly isPositive: boolean }
 * ```
 */
export type DeriveAccessorFromSchema<M extends ModuleSchema> =
  InferDerivations<M>;

// ============================================================================
// Internal Derivation State
// ============================================================================

/** Internal derivation state */
export interface DerivationState<T> {
  id: string;
  compute: () => T;
  cachedValue: T | undefined;
  dependencies: Set<string>;
  isStale: boolean;
  isComputing: boolean;
  /** Consecutive runs producing the same deps (auto-tracked only) */
  stableRunCount: number;
  /** Once true, skip withTracking() overhead until a tracked fact mutates */
  depsStable: boolean;
}
