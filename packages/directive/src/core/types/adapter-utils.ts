/**
 * Adapter Type Utilities - Shared types and helpers for framework adapters
 *
 * These utilities reduce type assertions in adapters by providing:
 * - Schema composition types
 * - Constraint/resolver converters
 * - Plugin factory helpers
 */

import type { Schema, InferSchema } from "./schema.js";
import type { Facts } from "./facts.js";
import type { Requirement, ConstraintDef } from "./requirements.js";
import type { ResolverDef, ResolverContext } from "./resolvers.js";
import type { Plugin } from "./plugins.js";

// ============================================================================
// Schema Composition Types
// ============================================================================

/**
 * Merge two schemas into one.
 * Useful for adapters that add bridge-specific facts to user schemas.
 *
 * @example
 * ```typescript
 * type BridgeFields = { __state: SchemaType<Record<string, unknown>> };
 * type Combined = MergedSchema<UserSchema, BridgeFields>;
 * ```
 */
export type MergedSchema<
	Base extends Schema,
	Extra extends Schema,
> = Base & Extra;

/**
 * Create a schema type from a fields definition.
 * Helper for defining adapter bridge schemas.
 *
 * @example
 * ```typescript
 * type ZustandBridgeSchema = BridgeSchema<{
 *   __zustandState: SchemaType<Record<string, unknown>>;
 * }>;
 * ```
 */
export type BridgeSchema<Fields extends Schema> = Fields;

// ============================================================================
// Bridge Schema Helper
// ============================================================================

/**
 * Create a bridge schema definition for adapters.
 * Returns a schema object compatible with createModule().
 *
 * @example
 * ```typescript
 * const bridgeSchema = createBridgeSchema({
 *   __state: t.object<Record<string, unknown>>(),
 * });
 * ```
 */
export function createBridgeSchema<S extends Schema>(schema: S): S {
	return schema;
}

// ============================================================================
// Type-Safe Fact Mutation
// ============================================================================

/**
 * Type-safe fact setter for known schema keys.
 * Use when you have a typed schema and want to set a specific fact.
 *
 * @example
 * ```typescript
 * setFact(facts, "count", 10); // Type-checked
 * ```
 */
export function setFact<S extends Schema, K extends keyof InferSchema<S>>(
	facts: Facts<S>,
	key: K,
	value: InferSchema<S>[K],
): void {
	(facts as Record<string, unknown>)[key as string] = value;
}

/**
 * Set a bridge fact without strict typing.
 * Use for adapter-internal bridge fields like `__zustandState`.
 *
 * @example
 * ```typescript
 * setBridgeFact(facts, "__zustandState", currentState);
 * ```
 */
export function setBridgeFact<V>(
	facts: Facts<Schema>,
	key: string,
	value: V,
): void {
	(facts as Record<string, unknown>)[key] = value;
}

/**
 * Get a bridge fact without strict typing.
 * Use for adapter-internal bridge fields.
 *
 * @example
 * ```typescript
 * const state = getBridgeFact<MyState>(facts, "__zustandState");
 * ```
 */
export function getBridgeFact<V>(
	facts: Facts<Schema>,
	key: string,
): V {
	return (facts as Record<string, unknown>)[key] as V;
}

// ============================================================================
// Constraint Converters
// ============================================================================

/**
 * Adapter constraint definition (generic form used by adapters).
 */
export interface AdapterConstraint<TState> {
	when: (state: TState) => boolean | Promise<boolean>;
	require: Requirement | ((state: TState) => Requirement | null);
	priority?: number;
}

/**
 * Convert adapter-style constraints to Directive format.
 * Maps adapter constraints that work with external state (TState) to
 * Directive constraints that work with Facts<Schema>.
 *
 * @param constraints - Adapter constraints keyed by name
 * @param extractState - Function to extract adapter state from facts
 *
 * @example
 * ```typescript
 * const directiveConstraints = convertConstraints<MyState, BridgeSchema>(
 *   adapterConstraints,
 *   (facts) => getBridgeFact<MyState>(facts, "__state"),
 * );
 * ```
 */
export function convertConstraints<TState, S extends Schema>(
	constraints: Record<string, AdapterConstraint<TState>>,
	extractState: (facts: Facts<S>) => TState,
): Record<string, ConstraintDef<S, Requirement>> {
	const result: Record<string, ConstraintDef<S, Requirement>> = {};

	for (const [id, constraint] of Object.entries(constraints)) {
		result[id] = {
			priority: constraint.priority ?? 0,
			when: (facts) => constraint.when(extractState(facts)),
			require: (facts) => {
				const req = typeof constraint.require === "function"
					? constraint.require(extractState(facts))
					: constraint.require;
				return req;
			},
		};
	}

	return result;
}

// ============================================================================
// Resolver Converters
// ============================================================================

/**
 * Adapter resolver context (generic form used by adapters).
 */
export interface AdapterResolverContext<TContext> {
	context: TContext;
	signal: AbortSignal;
}

/**
 * Adapter resolver definition (generic form used by adapters).
 */
export interface AdapterResolver<TContext, R extends Requirement = Requirement> {
	requirement: (req: Requirement) => req is R;
	key?: (req: R) => string;
	resolve: (req: R, ctx: AdapterResolverContext<TContext>) => void | Promise<void>;
}

/**
 * Convert adapter-style resolvers to Directive format.
 * Maps adapter resolvers that work with external context (TContext) to
 * Directive resolvers that work with ResolverContext<Schema>.
 *
 * @param resolvers - Adapter resolvers keyed by name
 * @param createContext - Function to create adapter context from Directive context
 *
 * @example
 * ```typescript
 * const directiveResolvers = convertResolvers<MyContext, BridgeSchema>(
 *   adapterResolvers,
 *   (ctx) => ({
 *     getState: () => getBridgeFact<MyState>(ctx.facts, "__state"),
 *     setState: (update) => setBridgeFact(ctx.facts, "__state", update),
 *     signal: ctx.signal,
 *   }),
 * );
 * ```
 */
export function convertResolvers<TContext, S extends Schema>(
	resolvers: Record<string, AdapterResolver<TContext, Requirement>>,
	createContext: (ctx: ResolverContext<S>) => TContext,
): Record<string, ResolverDef<S, Requirement>> {
	const result: Record<string, ResolverDef<S, Requirement>> = {};

	for (const [id, resolver] of Object.entries(resolvers)) {
		result[id] = {
			requirement: resolver.requirement,
			key: resolver.key,
			resolve: async (req, ctx) => {
				const adapterCtx = createContext(ctx);
				await resolver.resolve(req, { context: adapterCtx, signal: ctx.signal });
			},
		};
	}

	return result;
}

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Callback definitions for adapter plugins.
 */
export interface AdapterCallbacks {
	onRequirementCreated?: (req: Requirement) => void;
	onRequirementResolved?: (req: Requirement) => void;
	onError?: (error: Error) => void;
}

/**
 * Create a callback plugin for adapter events.
 * Wraps adapter callbacks in a Directive plugin.
 *
 * @param name - Plugin name (for debugging)
 * @param callbacks - Callback functions to invoke
 *
 * @example
 * ```typescript
 * const callbackPlugin = createCallbackPlugin("zustand-callbacks", {
 *   onRequirementCreated: (req) => console.log("Created:", req),
 *   onRequirementResolved: (req) => console.log("Resolved:", req),
 * });
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: Plugins work with any schema type
export function createCallbackPlugin(
	name: string,
	callbacks: AdapterCallbacks,
): Plugin<any> {
	return {
		name,
		onRequirementCreated: callbacks.onRequirementCreated
			? (req) => callbacks.onRequirementCreated!(req.requirement)
			: undefined,
		onRequirementMet: callbacks.onRequirementResolved
			? (req) => callbacks.onRequirementResolved!(req.requirement)
			: undefined,
		onError: callbacks.onError,
	};
}

// ============================================================================
// Module Config Helpers
// ============================================================================

/**
 * Cast constraints to the correct type for createModule.
 * Use this when TypeScript can't infer the constraint types correctly.
 */
export function asConstraints<S extends Schema>(
	constraints: Record<string, ConstraintDef<S, Requirement>>,
): Record<string, ConstraintDef<S, Requirement>> {
	return constraints;
}

/**
 * Cast resolvers to the correct type for createModule.
 * Use this when TypeScript can't infer the resolver types correctly.
 */
export function asResolvers<S extends Schema>(
	resolvers: Record<string, ResolverDef<S, Requirement>>,
): Record<string, ResolverDef<S, Requirement>> {
	return resolvers;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Create a type guard for a specific requirement type.
 * Simplifies the common pattern of checking req.type.
 *
 * @example
 * ```typescript
 * const isResetReq = requirementGuard<ResetReq>("RESET");
 * // Use in resolver:
 * { requirement: isResetReq, resolve: ... }
 * ```
 */
export function requirementGuard<R extends Requirement>(
	type: R["type"],
): (req: Requirement) => req is R {
	return (req): req is R => req.type === type;
}

/**
 * Create a type guard that matches multiple requirement types.
 *
 * @example
 * ```typescript
 * const isDataReq = requirementGuardMultiple<FetchReq | RefreshReq>(["FETCH", "REFRESH"]);
 * ```
 */
export function requirementGuardMultiple<R extends Requirement>(
	types: Array<R["type"]>,
): (req: Requirement) => req is R {
	const typeSet = new Set(types);
	return (req): req is R => typeSet.has(req.type);
}
