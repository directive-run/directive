/**
 * Derivation Types - Type definitions for derivations
 */

import type { Schema, ModuleSchema, InferDerivations } from "./schema.js";
import type { Facts } from "./facts.js";

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
// Legacy Derivation Types (for internal engine use)
// ============================================================================

/**
 * Legacy derivation definition function signature.
 * Used internally by the engine.
 *
 * @deprecated For typed derivations, use TypedDerivationsDef from module.ts
 */
export interface DerivationDef<S extends Schema, T, D extends DerivationsDef<S>> {
	(facts: Facts<S>, derive: DerivedValues<S, D>): T;
}

/**
 * Legacy map of derivation definitions.
 * Used internally by the engine.
 *
 * @deprecated For typed derivations, use TypedDerivationsDef from module.ts
 */
export type DerivationsDef<S extends Schema> = Record<
	string,
	DerivationDef<S, unknown, DerivationsDef<S>>
>;

/**
 * Legacy computed derived values.
 * Used internally by the engine.
 *
 * @deprecated For typed derivations, use InferDerivations from schema.ts
 */
export type DerivedValues<S extends Schema, D extends DerivationsDef<S>> = {
	readonly [K in keyof D]: ReturnType<D[K]>;
};

// ============================================================================
// Schema-Based Derivation Types (New)
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
export type DeriveAccessorFromSchema<M extends ModuleSchema> = InferDerivations<M>;

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
