/**
 * Module - The declarative API for defining Directive modules
 *
 * Modules group related facts, constraints, resolvers, effects, and derivations.
 */

import type {
	ModuleSchema,
	Facts,
	ModuleDef,
	ModuleHooks,
	EffectsDef,
	TypedDerivationsDef,
	TypedEventsDef,
	TypedConstraintsDef,
	TypedResolversDef,
} from "./types.js";

// ============================================================================
// Module Configuration
// ============================================================================

/**
 * Module configuration with consolidated schema.
 *
 * derive and events are optional - omit them if your schema has empty derivations/events.
 */
export interface ModuleConfig<M extends ModuleSchema> {
	schema: M;
	init?: (facts: Facts<M["facts"]>) => void;
	derive?: TypedDerivationsDef<M>;
	events?: TypedEventsDef<M>;
	effects?: EffectsDef<M["facts"]>;
	constraints?: TypedConstraintsDef<M>;
	resolvers?: TypedResolversDef<M>;
	hooks?: ModuleHooks<M>;
}

/**
 * Create a module definition with full type inference.
 *
 * The consolidated schema provides:
 * - Derivation composition (`derive.otherDerivation` is typed)
 * - Event dispatch (`system.dispatch({ type: "..." })` has autocomplete)
 * - Resolver requirements (`req.payload` is typed based on requirement type)
 *
 * @example
 * ```ts
 * const trafficLight = createModule("traffic-light", {
 *   schema: {
 *     facts: {
 *       phase: t.string<"red" | "green" | "yellow">(),
 *       elapsed: t.number(),
 *     },
 *     derivations: {
 *       isRed: t.boolean(),
 *       timeRemaining: t.number(),
 *     },
 *     events: {
 *       tick: {},
 *       setPhase: { phase: t.string<"red" | "green" | "yellow">() },
 *     },
 *     requirements: {
 *       TRANSITION: { to: t.string<"red" | "green" | "yellow">() },
 *     },
 *   },
 *   init: (facts) => {
 *     facts.phase = "red";
 *     facts.elapsed = 0;
 *   },
 *   derive: {
 *     isRed: (facts) => facts.phase === "red",
 *     timeRemaining: (facts, derive) => {
 *       // derive.isRed is typed as boolean!
 *       return derive.isRed ? 30 - facts.elapsed : 0;
 *     },
 *   },
 *   events: {
 *     tick: (facts) => { facts.elapsed += 1; },
 *     setPhase: (facts, { phase }) => { facts.phase = phase; }, // phase is typed!
 *   },
 *   constraints: {
 *     shouldTransition: {
 *       when: (facts) => facts.phase === "red" && facts.elapsed > 30,
 *       require: { type: "TRANSITION", to: "green" },
 *     },
 *   },
 *   resolvers: {
 *     transition: {
 *       requirement: "TRANSITION",
 *       resolve: async (req, ctx) => {
 *         ctx.facts.phase = req.to; // req.to is typed!
 *         ctx.facts.elapsed = 0;
 *       },
 *     },
 *   },
 * });
 * ```
 */
export function createModule<const M extends ModuleSchema>(
	id: string,
	config: ModuleConfig<M>,
): ModuleDef<M> {
	// Dev-mode validations
	if (process.env.NODE_ENV !== "production") {
		if (!id || typeof id !== "string") {
			console.warn("[Directive] Module ID must be a non-empty string");
		} else if (!/^[a-z][a-z0-9-]*$/i.test(id)) {
			console.warn(
				`[Directive] Module ID "${id}" should follow kebab-case convention (e.g., "my-module")`,
			);
		}

		if (!config.schema) {
			console.warn("[Directive] Module schema is required");
		} else {
			if (!config.schema.facts) {
				console.warn("[Directive] Module schema.facts is required");
			}
			// derivations, events, and requirements default to {} if not provided
		}

		// Validate derive keys match schema.derivations (if either is provided)
		const schemaDerivations = config.schema?.derivations ?? {};
		const deriveImpl = config.derive ?? {};
		const schemaDerivationKeys = new Set(Object.keys(schemaDerivations));
		const deriveKeys = new Set(Object.keys(deriveImpl));

		for (const key of deriveKeys) {
			if (!schemaDerivationKeys.has(key)) {
				console.warn(`[Directive] Derivation "${key}" not declared in schema.derivations`);
			}
		}
		for (const key of schemaDerivationKeys) {
			if (!deriveKeys.has(key)) {
				console.warn(`[Directive] schema.derivations["${key}"] has no matching implementation in derive`);
			}
		}

		// Validate events keys match schema.events (if either is provided)
		const schemaEvents = config.schema?.events ?? {};
		const eventImpl = config.events ?? {};
		const schemaEventKeys = new Set(Object.keys(schemaEvents));
		const eventKeys = new Set(Object.keys(eventImpl));

		for (const key of eventKeys) {
			if (!schemaEventKeys.has(key)) {
				console.warn(`[Directive] Event "${key}" not declared in schema.events`);
			}
		}
		for (const key of schemaEventKeys) {
			if (!eventKeys.has(key)) {
				console.warn(`[Directive] schema.events["${key}"] has no matching handler in events`);
			}
		}

		// Validate resolvers reference valid requirement types
		if (config.resolvers && config.schema?.requirements) {
			const requirementTypes = new Set(Object.keys(config.schema.requirements));
			for (const [resolverName, resolver] of Object.entries(config.resolvers)) {
				const resolverDef = resolver as { requirement?: string };
				if (
					typeof resolverDef.requirement === "string" &&
					!requirementTypes.has(resolverDef.requirement)
				) {
					console.warn(
						`[Directive] Resolver "${resolverName}" references unknown requirement type "${resolverDef.requirement}". ` +
							`Available types: ${[...requirementTypes].join(", ") || "(none)"}`,
					);
				}
			}
		}
	}

	return {
		id,
		schema: config.schema,
		init: config.init,
		derive: config.derive ?? ({} as TypedDerivationsDef<M>),
		events: config.events ?? ({} as TypedEventsDef<M>),
		effects: config.effects,
		constraints: config.constraints,
		resolvers: config.resolvers,
		hooks: config.hooks,
	};
}
