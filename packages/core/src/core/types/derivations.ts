/**
 * Derivation Types - Type definitions for derivations
 */

import type { Facts } from "./facts.js";
import type { InferDerivations, ModuleSchema, Schema } from "./schema.js";

// ============================================================================
// Tracking Types
// ============================================================================

/** Tracking context for auto-dependency detection */
export interface TrackingContext {
  readonly isTracking: boolean;
  track(key: string): void;
  getDependencies(): Set<string>;
}

// ============================================================================
// Derivation Types (internal engine use)
// ============================================================================

/** Derivation definition function signature. */
export type DerivationDef<S extends Schema, T, D extends DerivationsDef<S>> = (
  facts: Facts<S>,
  derive: DerivedValues<S, D>,
) => T;

/** Map of derivation definitions. */
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
}
