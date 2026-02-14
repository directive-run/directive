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
	CrossModuleDeps,
	CrossModuleConstraintsDef,
	CrossModuleEffectsDef,
	CrossModuleDerivationsDef,
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
 * Module configuration with cross-module dependencies for type-safe access
 * to other modules' facts in effects and constraints.
 *
 * When crossModuleDeps is provided:
 * - Own module facts: `facts.self.*`
 * - Cross-module facts: `facts.{dep}.*`
 *
 * @example
 * ```typescript
 * import { authSchema } from './auth';
 * import { dataSchema } from './data';
 *
 * const uiModule = createModule("ui", {
 *   schema: uiSchema,
 *   crossModuleDeps: { auth: authSchema, data: dataSchema },
 *   effects: {
 *     onAuthChange: {
 *       run: (facts) => {
 *         facts.self.notifications   // ✅ own module via "self"
 *         facts.auth.isAuthenticated // ✅ cross-module (namespaced)
 *         facts.data.users           // ✅ cross-module (namespaced)
 *       }
 *     }
 *   },
 *   constraints: {
 *     fetchWhenAuth: {
 *       when: (facts) => facts.auth.isAuthenticated && facts.self.users.length === 0,
 *       require: { type: "FETCH_USERS" },
 *     }
 *   }
 * });
 * ```
 */
export interface ModuleConfigWithDeps<
	M extends ModuleSchema,
	Deps extends CrossModuleDeps,
> {
	schema: M;
	/**
	 * Cross-module dependencies for type-safe access in derive/effects/constraints.
	 *
	 * **Access patterns by context:**
	 * - `derive`, `effects`, `constraints`: Use `facts.self.*` for own module, `facts.{dep}.*` for cross-module
	 * - `init`, `events`, `resolvers`: Use flat access (`facts.myFact`) - no cross-module access
	 *
	 * This separation ensures initialization and event handling stay scoped to own module,
	 * while observers (derive/effects/constraints) can see across modules.
	 *
	 * @example
	 * ```typescript
	 * crossModuleDeps: { auth: authSchema },
	 * init: (facts) => { facts.users = []; },              // flat access
	 * derive: { count: (facts) => facts.self.users.length }, // facts.self.*
	 * effects: { log: { run: (facts) => console.log(facts.auth.token) } }, // facts.{dep}.*
	 * ```
	 */
	crossModuleDeps: Deps;
	/** Initialize module facts. Uses flat access (`facts.myFact`) to ensure modules initialize independently. */
	init?: (facts: Facts<M["facts"]>) => void;
	/** Derivations with cross-module facts access (`facts.self.*` + `facts.{dep}.*`) */
	derive?: CrossModuleDerivationsDef<M, Deps>;
	/** Event handlers. Uses flat access (`facts.myFact`) to keep mutations scoped to own module. */
	events?: TypedEventsDef<M>;
	/** Effects with cross-module facts access (`facts.self.*` + `facts.{dep}.*`) */
	effects?: CrossModuleEffectsDef<M, Deps>;
	/** Constraints with cross-module facts access (`facts.self.*` + `facts.{dep}.*`) */
	constraints?: CrossModuleConstraintsDef<M, Deps>;
	/** Resolvers. Uses flat access (`ctx.facts.myFact`) to keep async mutations scoped to own module. */
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
 *
 * @example With cross-module dependencies
 * ```ts
 * import { authSchema } from './auth';
 *
 * const dataModule = createModule("data", {
 *   schema: dataSchema,
 *   crossModuleDeps: { auth: authSchema },
 *   constraints: {
 *     fetchWhenAuth: {
 *       when: (facts) => {
 *         // facts.self.* for own module, facts.auth.* for cross-module
 *         return facts.auth.isAuthenticated && facts.self.users.length === 0;
 *       },
 *       require: { type: "FETCH_USERS" },
 *     },
 *   },
 *   derive: {
 *     canFetch: (facts) => facts.auth.isAuthenticated && facts.self.users.length === 0,
 *   },
 * });
 * ```
 */
// Overload 1: With crossModuleDeps
export function createModule<
	const M extends ModuleSchema,
	const Deps extends CrossModuleDeps,
>(
	id: string,
	config: ModuleConfigWithDeps<M, Deps>,
): ModuleDef<M>;

// Overload 2: Without crossModuleDeps (original signature)
export function createModule<const M extends ModuleSchema>(
	id: string,
	config: ModuleConfig<M>,
): ModuleDef<M>;

// Overload 3: Union (used by createModuleFactory)
export function createModule<const M extends ModuleSchema>(
	id: string,
	config: ModuleConfigWithDeps<M, CrossModuleDeps> | ModuleConfig<M>,
): ModuleDef<M>;

// Implementation (must immediately follow overload declarations)
export function createModule<const M extends ModuleSchema>(
	id: string,
	config: ModuleConfig<M> | ModuleConfigWithDeps<M, CrossModuleDeps>,
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

	// Extract crossModuleDeps if present (for runtime proxy creation)
	const crossModuleDeps = "crossModuleDeps" in config ? config.crossModuleDeps : undefined;

	return {
		id,
		schema: config.schema,
		init: config.init,
		// Cast to TypedDerivationsDef for ModuleDef compatibility (runtime handles both types)
		derive: (config.derive ?? {}) as TypedDerivationsDef<M>,
		events: config.events ?? ({} as TypedEventsDef<M>),
		effects: config.effects as EffectsDef<M["facts"]> | undefined,
		constraints: config.constraints as TypedConstraintsDef<M> | undefined,
		resolvers: config.resolvers,
		hooks: config.hooks,
		// Store crossModuleDeps for runtime proxy creation
		crossModuleDeps: crossModuleDeps as CrossModuleDeps | undefined,
	};
}

/**
 * Create a module factory that produces named instances from a single definition.
 * Useful for multi-instance UIs (tabs, panels, multi-tenant) where you need
 * isolated state from the same schema.
 *
 * @example
 * ```typescript
 * const chatRoom = createModuleFactory({
 *   schema: {
 *     facts: { messages: t.array<string>(), users: t.array<string>() },
 *     derivations: { count: t.number() },
 *   },
 *   init: (facts) => { facts.messages = []; facts.users = []; },
 *   derive: { count: (facts) => facts.messages.length },
 * });
 *
 * const system = createSystem({
 *   modules: {
 *     lobby: chatRoom("lobby"),
 *     support: chatRoom("support"),
 *   },
 * });
 * ```
 */
export function createModuleFactory<const M extends ModuleSchema>(
	config: ModuleConfig<M>,
): (name: string) => ModuleDef<M>;
export function createModuleFactory<
	const M extends ModuleSchema,
	const Deps extends CrossModuleDeps,
>(
	config: ModuleConfigWithDeps<M, Deps>,
): (name: string) => ModuleDef<M>;
export function createModuleFactory<const M extends ModuleSchema>(
	config: ModuleConfig<M> | ModuleConfigWithDeps<M, CrossModuleDeps>,
): (name: string) => ModuleDef<M> {
	// Pass config directly — createModule's implementation overload handles both types.
	// Do NOT cast to ModuleConfig<M> which would strip crossModuleDeps.
	return (name: string) => createModule(name, config);
}
