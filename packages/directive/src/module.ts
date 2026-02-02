/**
 * Module - The declarative API for defining Directive modules
 *
 * Modules group related facts, constraints, resolvers, effects, and derivations.
 */

import type {
	ConstraintsDef,
	DerivationsDef,
	EffectsDef,
	EventsDef,
	Facts,
	ModuleDef,
	ModuleHooks,
	ResolversDef,
	Schema,
} from "./types.js";

// ============================================================================
// Module Definition
// ============================================================================

/** Module configuration passed to createModule */
export interface ModuleConfig<
	S extends Schema,
	D extends DerivationsDef<S> = DerivationsDef<S>,
> {
	schema: S;
	init?: (facts: Facts<S>) => void;
	events?: EventsDef<S>;
	derive?: D;
	effects?: EffectsDef<S>;
	constraints?: ConstraintsDef<S>;
	resolvers?: ResolversDef<S>;
	hooks?: ModuleHooks<S>;
}

/**
 * Create a module definition.
 *
 * @example
 * ```ts
 * const trafficLight = createModule("traffic-light", {
 *   schema: {
 *     phase: t.string<"red" | "green" | "yellow">(),
 *     elapsed: t.number(),
 *   },
 *
 *   init: (facts) => {
 *     facts.phase = "red";
 *     facts.elapsed = 0;
 *   },
 *
 *   events: {
 *     tick: (facts) => {
 *       facts.elapsed += 1;
 *     },
 *   },
 *
 *   derive: {
 *     isRed: (facts) => facts.phase === "red",
 *   },
 *
 *   constraints: {
 *     shouldTransition: {
 *       when: (facts) => facts.phase === "red" && facts.elapsed > 30,
 *       require: { type: "TRANSITION", to: "green" },
 *     },
 *   },
 *
 *   resolvers: {
 *     transition: {
 *       handles: (req) => req.type === "TRANSITION",
 *       resolve: async (req, ctx) => {
 *         ctx.facts.phase = req.to;
 *         ctx.facts.elapsed = 0;
 *       },
 *     },
 *   },
 * });
 * ```
 */
export function createModule<S extends Schema, D extends DerivationsDef<S>>(
	id: string,
	config: ModuleConfig<S, D>,
): ModuleDef<S, D> {
	return {
		id,
		schema: config.schema,
		init: config.init,
		events: config.events,
		derive: config.derive,
		effects: config.effects,
		constraints: config.constraints,
		resolvers: config.resolvers,
		hooks: config.hooks,
	};
}
