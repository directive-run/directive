/**
 * System - The top-level API for creating a Directive runtime
 *
 * A system combines modules with plugins and configuration.
 *
 * Supports two modes:
 * - **Array modules** (flat): `modules: [auth, data]` → `facts.token`
 * - **Object modules** (namespaced): `modules: { auth, data }` → `facts.auth.token`
 */

import { createEngine } from "./engine.js";
import type {
	DebugConfig,
	ErrorBoundaryConfig,
	ModuleDef,
	ModuleSchema,
	Plugin,
	System,
	ModulesMap,
	NamespacedSystem,
	CreateSystemOptionsNamed,
} from "./types.js";

// ============================================================================
// Blocked Properties (Security)
// ============================================================================

const BLOCKED_PROPS = Object.freeze(
	new Set(["__proto__", "constructor", "prototype"]),
);

// ============================================================================
// Proxy Cache (Performance)
// ============================================================================

/**
 * WeakMap to cache module facts proxies. Keyed by the facts store object.
 * Inner map is keyed by namespace string.
 */
const moduleFactsProxyCache = new WeakMap<
	Record<string, unknown>,
	Map<string, Record<string, unknown>>
>();

/**
 * WeakMap to cache namespaced facts proxies.
 */
const namespacedFactsProxyCache = new WeakMap<
	Record<string, unknown>,
	Record<string, Record<string, unknown>>
>();

/**
 * WeakMap to cache namespaced derive proxies.
 */
const namespacedDeriveProxyCache = new WeakMap<
	Record<string, unknown>,
	Record<string, Record<string, unknown>>
>();

/**
 * WeakMap to cache module derive proxies.
 */
const moduleDeriveProxyCache = new WeakMap<
	Record<string, unknown>,
	Map<string, Record<string, unknown>>
>();

// ============================================================================
// System Configuration
// ============================================================================

/** Options for createSystem with array modules (flat mode) */
export interface CreateSystemOptions<M extends ModuleSchema> {
	/** Modules to include in the system */
	modules: Array<ModuleDef<M>>;
	/** Plugins to register */
	// biome-ignore lint/suspicious/noExplicitAny: Plugins are schema-agnostic
	plugins?: Array<Plugin<any>>;
	/** Debug configuration */
	debug?: DebugConfig;
	/** Error boundary configuration */
	errorBoundary?: ErrorBoundaryConfig;
	/**
	 * Tick interval for time-based systems (ms).
	 *
	 * When set, automatically dispatches `{ type: "tick" }` events at this interval
	 * after `system.start()` is called. The interval is cleared when `system.stop()`
	 * is called.
	 *
	 * Define a handler in your module's `events` property to respond to tick events.
	 *
	 * @example
	 * ```typescript
	 * const module = createModule("timer", {
	 *   schema: {
	 *     facts: { elapsed: t.number() },
	 *     derivations: {},
	 *     events: { tick: {} },
	 *     requirements: {},
	 *   },
	 *   init: (facts) => { facts.elapsed = 0; },
	 *   derive: {},
	 *   events: {
	 *     tick: (facts) => { facts.elapsed += 1; },
	 *   },
	 * });
	 *
	 * const system = createSystem({
	 *   modules: [module],
	 *   tickMs: 1000, // Dispatch { type: "tick" } every second
	 * });
	 * ```
	 */
	tickMs?: number;
	/**
	 * Enable zero-config mode with sensible defaults.
	 *
	 * When true, automatically enables:
	 * - Time-travel debugging in development (process.env.NODE_ENV !== 'production')
	 * - Skip recovery strategy for errors (prevents cascading failures)
	 *
	 * @default false
	 */
	zeroConfig?: boolean;
}

// ============================================================================
// Function Overloads
// ============================================================================

/**
 * Create a Directive system with namespaced modules.
 *
 * When modules are passed as an **object**, facts and derivations are
 * automatically namespaced under module keys:
 *
 * @example
 * ```ts
 * // Object modules = namespaced access
 * const system = createSystem({
 *   modules: {
 *     auth: authModule,
 *     data: dataModule,
 *   },
 * });
 *
 * // Namespaced access - fully typed!
 * system.facts.auth.token          // string | null
 * system.facts.data.users          // User[]
 * system.derive.auth.status        // "authenticated" | "guest"
 * system.derive.data.userCount     // number
 *
 * // Cross-module constraints can access all facts
 * constraints: {
 *   fetchWhenAuth: {
 *     when: (facts) => facts.auth.isAuthenticated && facts.data.users.length === 0,
 *     require: { type: "FETCH_USERS" },
 *   },
 * },
 * ```
 */
export function createSystem<const Modules extends ModulesMap>(
	options: CreateSystemOptionsNamed<Modules>,
): NamespacedSystem<Modules>;

/**
 * Create a Directive system with flat modules (existing behavior).
 *
 * When modules are passed as an **array**, facts are merged into a flat
 * namespace. Use prefixes to avoid collisions.
 *
 * @example
 * ```ts
 * // Array modules = flat access (existing behavior)
 * const system = createSystem({
 *   modules: [authModule, dataModule],
 * });
 *
 * // Flat access (requires manual prefixing)
 * system.facts.auth_token
 * system.facts.data_users
 * ```
 */
export function createSystem<const M extends ModuleSchema>(
	options: CreateSystemOptions<M>,
): System<M>;

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a Directive system.
 *
 * The module format determines the access pattern:
 * - **`modules: { ... }`** (object) → Namespaced access: `facts.auth.token`
 * - **`modules: [ ... ]`** (array) → Flat access: `facts.auth_token`
 */
export function createSystem(
	// biome-ignore lint/suspicious/noExplicitAny: Overloaded function implementation
	options: CreateSystemOptions<any> | CreateSystemOptionsNamed<any>,
	// biome-ignore lint/suspicious/noExplicitAny: Return type depends on overload
): any {
	// Detect if modules is object (namespaced) or array (flat)
	const isNamespaced = !Array.isArray(options.modules);

	if (isNamespaced) {
		return createNamespacedSystem(options as CreateSystemOptionsNamed<ModulesMap>);
	}

	return createFlatSystem(options as CreateSystemOptions<ModuleSchema>);
}

// ============================================================================
// Flat System (Existing Behavior)
// ============================================================================

function createFlatSystem<M extends ModuleSchema>(
	options: CreateSystemOptions<M>,
): System<M> {
	// Validate tickMs if provided
	if (options.tickMs !== undefined && options.tickMs <= 0) {
		throw new Error("[Directive] tickMs must be a positive number");
	}

	// Dev-mode warning: tickMs set without tick event handler
	if (process.env.NODE_ENV !== "production" && options.tickMs && options.tickMs > 0) {
		const hasTickHandler = options.modules.some(
			(m) => m.events && "tick" in m.events,
		);
		if (!hasTickHandler) {
			console.warn(
				`[Directive] tickMs is set to ${options.tickMs}ms but no module defines a "tick" event handler. ` +
					`The system will dispatch { type: "tick" } events but they will be ignored. ` +
					`Add a tick handler to one of your modules, or remove tickMs if not needed.`,
			);
		}
	}

	// Apply zero-config defaults if enabled
	let debug = options.debug;
	let errorBoundary = options.errorBoundary;

	if (options.zeroConfig) {
		const isDev = process.env.NODE_ENV !== "production";

		// Enable time-travel in development by default
		debug = {
			timeTravel: isDev,
			maxSnapshots: 100,
			...options.debug,
		};

		// Use skip recovery strategy by default (prevents cascading failures)
		errorBoundary = {
			onConstraintError: "skip",
			onResolverError: "skip",
			onEffectError: "skip",
			onDerivationError: "skip",
			...options.errorBoundary,
		};
	}

	// Convert ModuleDef to the engine's expected format
	// The engine internally works with flat schema format, so we transform
	// the consolidated schema to extract facts and requirements
	const engineModules = options.modules.map((mod) => ({
		id: mod.id,
		// Extract facts schema from consolidated schema
		schema: mod.schema.facts,
		// Extract requirements schema (for typed resolvers)
		requirements: mod.schema.requirements,
		init: mod.init,
		derive: mod.derive,
		events: mod.events,
		effects: mod.effects,
		constraints: mod.constraints,
		resolvers: mod.resolvers,
		hooks: mod.hooks,
	}));

	const engine = createEngine({
		// biome-ignore lint/suspicious/noExplicitAny: Module format conversion
		modules: engineModules as any,
		plugins: options.plugins,
		debug,
		errorBoundary,
		tickMs: options.tickMs,
	});

	// If tickMs is specified, wrap the system with tick interval management
	if (options.tickMs && options.tickMs > 0) {
		let tickInterval: ReturnType<typeof setInterval> | null = null;
		const tickMs = options.tickMs;

		// Create wrapper that composes tick behavior
		const system: System<M> = {
			facts: engine.facts,
			debug: engine.debug,
			derive: engine.derive,
			events: engine.events,

			get isRunning() {
				return engine.isRunning;
			},

			get isSettled() {
				return engine.isSettled;
			},

			start(): void {
				engine.start();
				tickInterval = setInterval(() => {
					engine.dispatch({ type: "tick" });
				}, tickMs);
			},

			stop(): void {
				if (tickInterval) {
					clearInterval(tickInterval);
					tickInterval = null;
				}
				engine.stop();
			},

			destroy(): void {
				this.stop();
				engine.destroy();
			},

			dispatch: engine.dispatch.bind(engine),
			read: engine.read.bind(engine),
			subscribe: engine.subscribe.bind(engine),
			watch: engine.watch.bind(engine),
			inspect: engine.inspect.bind(engine),
			settle: engine.settle.bind(engine),
			explain: engine.explain.bind(engine),
			getSnapshot: engine.getSnapshot.bind(engine),
			restore: engine.restore.bind(engine),
			batch: engine.batch.bind(engine),
		// biome-ignore lint/suspicious/noExplicitAny: Type narrowing for System
		} as any;

		return system;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Type narrowing for System
	return engine as any;
}

// ============================================================================
// Namespaced System (New Feature)
// ============================================================================

function createNamespacedSystem<Modules extends ModulesMap>(
	options: CreateSystemOptionsNamed<Modules>,
): NamespacedSystem<Modules> {
	const modulesMap = options.modules;
	const moduleNamespaces = new Set(Object.keys(modulesMap));

	// Validate tickMs if provided
	if (options.tickMs !== undefined && options.tickMs <= 0) {
		throw new Error("[Directive] tickMs must be a positive number");
	}

	// Dev-mode: Validate crossModuleDeps reference existing modules
	if (process.env.NODE_ENV !== "production") {
		for (const [namespace, mod] of Object.entries(modulesMap)) {
			if (mod.crossModuleDeps) {
				for (const depNamespace of Object.keys(mod.crossModuleDeps)) {
					if (depNamespace === namespace) {
						console.warn(
							`[Directive] Module "${namespace}" references itself in crossModuleDeps. ` +
							`Use "facts.self" to access own module's facts instead.`,
						);
					} else if (!moduleNamespaces.has(depNamespace)) {
						console.warn(
							`[Directive] Module "${namespace}" declares crossModuleDeps.${depNamespace}, ` +
							`but no module with namespace "${depNamespace}" exists in the system. ` +
							`Available modules: ${[...moduleNamespaces].join(", ")}`,
						);
					}
				}
			}
		}
	}

	// Apply zero-config defaults if enabled
	let debug = options.debug;
	let errorBoundary = options.errorBoundary;

	if (options.zeroConfig) {
		const isDev = process.env.NODE_ENV !== "production";

		debug = {
			timeTravel: isDev,
			maxSnapshots: 100,
			...options.debug,
		};

		errorBoundary = {
			onConstraintError: "skip",
			onResolverError: "skip",
			onEffectError: "skip",
			onDerivationError: "skip",
			...options.errorBoundary,
		};
	}

	// Transform modules to flat format with prefixed keys
	// auth.token → auth_token internally
	const flatModules: Array<ModuleDef<ModuleSchema>> = [];

	for (const [namespace, mod] of Object.entries(modulesMap)) {
		// Compute cross-module deps info once per module (used by derive, constraints, effects)
		const hasCrossModuleDeps = mod.crossModuleDeps && Object.keys(mod.crossModuleDeps).length > 0;
		const depNamespaces = hasCrossModuleDeps ? Object.keys(mod.crossModuleDeps!) : [];

		// Prefix all fact keys with namespace
		const prefixedFacts: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(mod.schema.facts)) {
			prefixedFacts[`${namespace}_${key}`] = value;
		}

		// Prefix all derivation keys with namespace
		const prefixedDerivations: Record<string, unknown> = {};
		if (mod.schema.derivations) {
			for (const [key, value] of Object.entries(mod.schema.derivations)) {
				prefixedDerivations[`${namespace}_${key}`] = value;
			}
		}

		// Prefix all event keys with namespace
		const prefixedEvents: Record<string, unknown> = {};
		if (mod.schema.events) {
			for (const [key, value] of Object.entries(mod.schema.events)) {
				prefixedEvents[`${namespace}_${key}`] = value;
			}
		}

		// Transform init to use prefixed keys
		// biome-ignore lint/suspicious/noExplicitAny: Facts proxy type coercion
		const prefixedInit = mod.init
			? (facts: any) => {
					// Create a proxy that translates unprefixed keys to prefixed
					const moduleFactsProxy = createModuleFactsProxy(facts, namespace);
					// biome-ignore lint/suspicious/noExplicitAny: Module init type coercion
					(mod.init as any)(moduleFactsProxy);
				}
			: undefined;

		// Transform derive functions to use prefixed keys
		const prefixedDerive: Record<string, (facts: unknown, derive: unknown) => unknown> = {};
		if (mod.derive) {
			for (const [key, fn] of Object.entries(mod.derive)) {
				prefixedDerive[`${namespace}_${key}`] = (facts: unknown, derive: unknown) => {
					// Use cross-module proxy (facts.self + facts.{dep}) if crossModuleDeps is defined
					// Otherwise use flat access to own module only
					const factsProxy = hasCrossModuleDeps
						? createCrossModuleFactsProxy(facts as Record<string, unknown>, namespace, depNamespaces)
						: createModuleFactsProxy(facts as Record<string, unknown>, namespace);
					// Derive proxy stays scoped to own module
					const deriveProxy = createModuleDeriveProxy(derive as Record<string, unknown>, namespace);
					// biome-ignore lint/suspicious/noExplicitAny: Derive function type coercion
					return (fn as any)(factsProxy, deriveProxy);
				};
			}
		}

		// Transform event handlers to use prefixed keys
		const prefixedEventHandlers: Record<string, (facts: unknown, event: unknown) => void> = {};
		if (mod.events) {
			for (const [key, handler] of Object.entries(mod.events)) {
				prefixedEventHandlers[`${namespace}_${key}`] = (facts: unknown, event: unknown) => {
					const moduleFactsProxy = createModuleFactsProxy(facts as Record<string, unknown>, namespace);
					// biome-ignore lint/suspicious/noExplicitAny: Event handler type coercion
					(handler as any)(moduleFactsProxy, event);
				};
			}
		}

		// Transform constraints to use namespaced facts proxy
		const prefixedConstraints: Record<string, unknown> = {};
		if (mod.constraints) {
			for (const [key, constraint] of Object.entries(mod.constraints)) {
				const constraintDef = constraint as {
					when: (facts: unknown) => boolean | Promise<boolean>;
					require: unknown | ((facts: unknown) => unknown);
					priority?: number;
					async?: boolean;
					timeout?: number;
				};

				prefixedConstraints[`${namespace}_${key}`] = {
					...constraintDef,
					when: (facts: unknown) => {
						// Use cross-module proxy (facts.self + facts.{dep}) if crossModuleDeps is defined
						// Otherwise use the full namespaced proxy for backwards compatibility
						const factsProxy = hasCrossModuleDeps
							? createCrossModuleFactsProxy(facts as Record<string, unknown>, namespace, depNamespaces)
							: createNamespacedFactsProxy(facts as Record<string, unknown>, modulesMap);
						return constraintDef.when(factsProxy);
					},
					require: typeof constraintDef.require === "function"
						? (facts: unknown) => {
								const factsProxy = hasCrossModuleDeps
									? createCrossModuleFactsProxy(facts as Record<string, unknown>, namespace, depNamespaces)
									: createNamespacedFactsProxy(facts as Record<string, unknown>, modulesMap);
								return (constraintDef.require as (facts: unknown) => unknown)(factsProxy);
							}
						: constraintDef.require,
				};
			}
		}

		// Transform resolvers to use namespaced facts proxy
		const prefixedResolvers: Record<string, unknown> = {};
		if (mod.resolvers) {
			for (const [key, resolver] of Object.entries(mod.resolvers)) {
				const resolverDef = resolver as {
					requirement: string;
					resolve: (req: unknown, ctx: { facts: unknown; signal: AbortSignal }) => Promise<void>;
					key?: (req: unknown) => string;
					retry?: unknown;
					timeout?: number;
				};

				prefixedResolvers[`${namespace}_${key}`] = {
					...resolverDef,
					resolve: async (req: unknown, ctx: { facts: unknown; signal: AbortSignal }) => {
						const namespacedFacts = createNamespacedFactsProxy(ctx.facts as Record<string, unknown>, modulesMap);
						await resolverDef.resolve(req, {
							facts: namespacedFacts[namespace],
							signal: ctx.signal,
						});
					},
				};
			}
		}

		// Transform effects to use namespaced facts proxy
		const prefixedEffects: Record<string, unknown> = {};
		if (mod.effects) {
			for (const [key, effect] of Object.entries(mod.effects)) {
				const effectDef = effect as {
					// biome-ignore lint/suspicious/noExplicitAny: Effect run function type
					run: (facts: any, prev: any) => void | Promise<void>;
					deps?: string[];
				};

				prefixedEffects[`${namespace}_${key}`] = {
					...effectDef,
					// biome-ignore lint/suspicious/noExplicitAny: Effect run function wrapper
					run: (facts: any, prev: any) => {
						// Use cross-module proxy (facts.self + facts.{dep}) if crossModuleDeps is defined
						// Otherwise use the full namespaced proxy for backwards compatibility
						const factsProxy = hasCrossModuleDeps
							? createCrossModuleFactsProxy(facts as Record<string, unknown>, namespace, depNamespaces)
							: createNamespacedFactsProxy(facts as Record<string, unknown>, modulesMap);
						const prevProxy = prev
							? (hasCrossModuleDeps
									? createCrossModuleFactsProxy(prev as Record<string, unknown>, namespace, depNamespaces)
									: createNamespacedFactsProxy(prev as Record<string, unknown>, modulesMap))
							: undefined;
						return effectDef.run(factsProxy, prevProxy);
					},
					// Transform deps to use prefixed keys
					deps: effectDef.deps?.map((dep) => `${namespace}_${dep}`),
				};
			}
		}

		flatModules.push({
			id: mod.id,
			schema: {
				facts: prefixedFacts,
				derivations: prefixedDerivations,
				events: prefixedEvents,
				requirements: mod.schema.requirements ?? {},
			},
			init: prefixedInit,
			derive: prefixedDerive,
			events: prefixedEventHandlers,
			effects: prefixedEffects,
			constraints: prefixedConstraints,
			resolvers: prefixedResolvers,
			hooks: mod.hooks,
		// biome-ignore lint/suspicious/noExplicitAny: Module transformation
		} as any);
	}

	// Dev-mode warning: tickMs set without tick event handler
	if (process.env.NODE_ENV !== "production" && options.tickMs && options.tickMs > 0) {
		const hasTickHandler = flatModules.some(
			(m) => m.events && Object.keys(m.events).some((k) => k.endsWith("_tick")),
		);
		if (!hasTickHandler) {
			console.warn(
				`[Directive] tickMs is set to ${options.tickMs}ms but no module defines a "tick" event handler.`,
			);
		}
	}

	// Create engine with flat modules
	const engine = createEngine({
		// biome-ignore lint/suspicious/noExplicitAny: Module format conversion
		modules: flatModules.map((mod) => ({
			id: mod.id,
			schema: mod.schema.facts,
			requirements: mod.schema.requirements,
			init: mod.init,
			derive: mod.derive,
			events: mod.events,
			effects: mod.effects,
			constraints: mod.constraints,
			resolvers: mod.resolvers,
			hooks: mod.hooks,
		})) as any,
		plugins: options.plugins,
		debug,
		errorBoundary,
		tickMs: options.tickMs,
	});

	// Create namespaced proxies for external access
	const namespacedFactsProxy = createNamespacedFactsProxy(engine.facts as unknown as Record<string, unknown>, modulesMap);
	const namespacedDeriveProxy = createNamespacedDeriveProxy(engine.derive as unknown as Record<string, unknown>, modulesMap);
	const namespacedEventsProxy = createNamespacedEventsProxy(engine, modulesMap);

	// Build the namespaced system
	let tickInterval: ReturnType<typeof setInterval> | null = null;
	const tickMs = options.tickMs;

	const system: NamespacedSystem<Modules> = {
		facts: namespacedFactsProxy,
		debug: engine.debug,
		derive: namespacedDeriveProxy,
		events: namespacedEventsProxy,

		get isRunning() {
			return engine.isRunning;
		},

		get isSettled() {
			return engine.isSettled;
		},

		start(): void {
			engine.start();
			if (tickMs && tickMs > 0) {
				// Find the first module with a tick event and dispatch to it
				const tickEventKey = Object.keys(flatModules[0]?.events ?? {}).find((k) => k.endsWith("_tick"));
				if (tickEventKey) {
					tickInterval = setInterval(() => {
						engine.dispatch({ type: tickEventKey });
					}, tickMs);
				}
			}
		},

		stop(): void {
			if (tickInterval) {
				clearInterval(tickInterval);
				tickInterval = null;
			}
			engine.stop();
		},

		destroy(): void {
			this.stop();
			engine.destroy();
		},

		dispatch(event: { type: string; [key: string]: unknown }) {
			// Events are dispatched with namespace prefix
			// e.g., { type: "login", token: "abc" } from auth module
			// becomes { type: "auth_login", token: "abc" }
			// But we keep them simple - the event type should match the schema
			engine.dispatch(event);
		},

		batch: engine.batch.bind(engine),

		/**
		 * Read a derivation value using namespaced syntax.
		 * Accepts either "namespace.key" or "namespace_key" format.
		 *
		 * @example
		 * system.read("auth.status")  // → "authenticated"
		 * system.read("data.count")   // → 5
		 */
		read<T = unknown>(derivationId: string): T {
			return engine.read(toInternalKey(derivationId));
		},

		/**
		 * Subscribe to derivation changes using namespaced syntax.
		 * Accepts either "namespace.key" or "namespace_key" format.
		 *
		 * @example
		 * system.subscribe(["auth.status", "data.count"], () => {
		 *   console.log("Auth or data changed");
		 * });
		 */
		subscribe(derivationIds: string[], listener: () => void): () => void {
			const internalIds = derivationIds.map(toInternalKey);
			return engine.subscribe(internalIds, listener);
		},

		/**
		 * Watch a derivation for changes using namespaced syntax.
		 * Accepts either "namespace.key" or "namespace_key" format.
		 *
		 * @example
		 * system.watch("auth.status", (newVal, oldVal) => {
		 *   console.log(`Status changed from ${oldVal} to ${newVal}`);
		 * });
		 */
		watch<T = unknown>(
			derivationId: string,
			callback: (newValue: T, previousValue: T | undefined) => void,
		): () => void {
			return engine.watch(toInternalKey(derivationId), callback);
		},

		inspect: engine.inspect.bind(engine),
		settle: engine.settle.bind(engine),
		explain: engine.explain.bind(engine),
		getSnapshot: engine.getSnapshot.bind(engine),
		restore: engine.restore.bind(engine),
	// biome-ignore lint/suspicious/noExplicitAny: Type narrowing for NamespacedSystem
	} as any;

	return system;
}

// ============================================================================
// Key Conversion Helpers
// ============================================================================

/**
 * Convert a namespaced key (e.g., "auth.status") to internal prefixed format ("auth_status").
 * If the key is already in prefixed format, returns it unchanged.
 *
 * @example
 * toInternalKey("auth.status") // → "auth_status"
 * toInternalKey("auth_status") // → "auth_status" (unchanged)
 * toInternalKey("status")      // → "status" (unchanged)
 */
function toInternalKey(key: string): string {
	// If key contains a dot, convert to underscore format
	if (key.includes(".")) {
		const [namespace, ...rest] = key.split(".");
		return `${namespace}_${rest.join("_")}`;
	}
	// Already in internal format or simple key
	return key;
}

// ============================================================================
// Proxy Helpers
// ============================================================================

/**
 * Create a proxy for a single module's facts (used in init, event handlers).
 * Translates unprefixed keys to prefixed: `token` → `auth_token`
 *
 * Proxies are cached per facts store and namespace for performance.
 */
function createModuleFactsProxy(
	facts: Record<string, unknown>,
	namespace: string,
): Record<string, unknown> {
	// Check cache first
	let namespaceCache = moduleFactsProxyCache.get(facts);
	if (namespaceCache) {
		const cached = namespaceCache.get(namespace);
		if (cached) return cached;
	} else {
		namespaceCache = new Map();
		moduleFactsProxyCache.set(facts, namespaceCache);
	}

	const proxy = new Proxy({} as Record<string, unknown>, {
		get(_, prop: string | symbol) {
			if (typeof prop === "symbol") return undefined;
			if (BLOCKED_PROPS.has(prop)) return undefined;
			// Special properties pass through
			if (prop === "$store" || prop === "$snapshot") {
				return (facts as Record<string, unknown>)[prop];
			}
			return (facts as Record<string, unknown>)[`${namespace}_${prop}`];
		},
		set(_, prop: string | symbol, value: unknown) {
			if (typeof prop === "symbol") return false;
			if (BLOCKED_PROPS.has(prop)) return false;
			(facts as Record<string, unknown>)[`${namespace}_${prop}`] = value;
			return true;
		},
		has(_, prop: string | symbol) {
			if (typeof prop === "symbol") return false;
			if (BLOCKED_PROPS.has(prop)) return false;
			return `${namespace}_${prop}` in facts;
		},
		deleteProperty(_, prop: string | symbol) {
			if (typeof prop === "symbol") return false;
			if (BLOCKED_PROPS.has(prop)) return false;
			delete (facts as Record<string, unknown>)[`${namespace}_${prop}`];
			return true;
		},
	});

	namespaceCache.set(namespace, proxy);
	return proxy;
}

/**
 * Create a nested proxy for namespaced facts access.
 * `facts.auth.token` → reads `auth_token` from flat store
 *
 * Uses Set for O(1) namespace lookups and caches the outer proxy.
 */
function createNamespacedFactsProxy(
	facts: Record<string, unknown>,
	modulesMap: ModulesMap,
): Record<string, Record<string, unknown>> {
	// Check cache first
	const cached = namespacedFactsProxyCache.get(facts);
	if (cached) return cached;

	const moduleNames = Object.keys(modulesMap);
	const moduleNamesSet = new Set(moduleNames);

	const proxy = new Proxy({} as Record<string, Record<string, unknown>>, {
		get(_, namespace: string | symbol) {
			if (typeof namespace === "symbol") return undefined;
			if (BLOCKED_PROPS.has(namespace)) return undefined;
			if (!moduleNamesSet.has(namespace)) return undefined;

			// Return a cached proxy for this module's facts
			return createModuleFactsProxy(facts, namespace);
		},
		has(_, namespace: string | symbol) {
			if (typeof namespace === "symbol") return false;
			if (BLOCKED_PROPS.has(namespace)) return false;
			return moduleNamesSet.has(namespace);
		},
		ownKeys() {
			return moduleNames;
		},
		getOwnPropertyDescriptor(_, namespace: string | symbol) {
			if (typeof namespace === "symbol") return undefined;
			if (moduleNamesSet.has(namespace)) {
				return { configurable: true, enumerable: true };
			}
			return undefined;
		},
	});

	namespacedFactsProxyCache.set(facts, proxy);
	return proxy;
}

/**
 * WeakMap to cache cross-module facts proxies.
 * Keyed by facts store, then by "selfNamespace:depKeys" string.
 */
const crossModuleFactsProxyCache = new WeakMap<
	Record<string, unknown>,
	Map<string, Record<string, Record<string, unknown>>>
>();

/**
 * Create a proxy for cross-module facts access with "self" for own module.
 * `facts.self.users` → reads own module's facts
 * `facts.auth.token` → reads dependency module's facts
 *
 * Used when a module has crossModuleDeps defined.
 */
function createCrossModuleFactsProxy(
	facts: Record<string, unknown>,
	selfNamespace: string,
	depNamespaces: string[],
): Record<string, Record<string, unknown>> {
	// Create cache key using JSON.stringify for robustness with special characters
	const cacheKey = `${selfNamespace}:${JSON.stringify([...depNamespaces].sort())}`;

	// Check cache first
	let namespaceCache = crossModuleFactsProxyCache.get(facts);
	if (namespaceCache) {
		const cached = namespaceCache.get(cacheKey);
		if (cached) return cached;
	} else {
		namespaceCache = new Map();
		crossModuleFactsProxyCache.set(facts, namespaceCache);
	}

	const depNamesSet = new Set(depNamespaces);
	const allKeys = ["self", ...depNamespaces];

	const proxy = new Proxy({} as Record<string, Record<string, unknown>>, {
		get(_, key: string | symbol) {
			if (typeof key === "symbol") return undefined;
			if (BLOCKED_PROPS.has(key)) return undefined;

			// "self" maps to own module's namespace
			if (key === "self") {
				return createModuleFactsProxy(facts, selfNamespace);
			}

			// Check if it's a declared dependency
			if (depNamesSet.has(key)) {
				return createModuleFactsProxy(facts, key);
			}

			// Dev-mode warning for undeclared cross-module access
			if (process.env.NODE_ENV !== "production" && typeof key === "string") {
				console.warn(
					`[Directive] Module "${selfNamespace}" accessed undeclared cross-module property "${key}". ` +
					`Add it to crossModuleDeps or use "facts.self.${key}" for own module facts.`,
				);
			}

			return undefined;
		},
		has(_, key: string | symbol) {
			if (typeof key === "symbol") return false;
			if (BLOCKED_PROPS.has(key)) return false;
			return key === "self" || depNamesSet.has(key);
		},
		ownKeys() {
			return allKeys;
		},
		getOwnPropertyDescriptor(_, key: string | symbol) {
			if (typeof key === "symbol") return undefined;
			if (key === "self" || depNamesSet.has(key)) {
				return { configurable: true, enumerable: true };
			}
			return undefined;
		},
	});

	namespaceCache.set(cacheKey, proxy);
	return proxy;
}

/**
 * Create a proxy for a single module's derivations.
 * Translates unprefixed keys to prefixed: `status` → `auth_status`
 *
 * Proxies are cached per derive store and namespace for performance.
 */
function createModuleDeriveProxy(
	derive: Record<string, unknown>,
	namespace: string,
): Record<string, unknown> {
	// Check cache first
	let namespaceCache = moduleDeriveProxyCache.get(derive);
	if (namespaceCache) {
		const cached = namespaceCache.get(namespace);
		if (cached) return cached;
	} else {
		namespaceCache = new Map();
		moduleDeriveProxyCache.set(derive, namespaceCache);
	}

	const proxy = new Proxy({} as Record<string, unknown>, {
		get(_, prop: string | symbol) {
			if (typeof prop === "symbol") return undefined;
			if (BLOCKED_PROPS.has(prop)) return undefined;
			return derive[`${namespace}_${prop}`];
		},
		has(_, prop: string | symbol) {
			if (typeof prop === "symbol") return false;
			if (BLOCKED_PROPS.has(prop)) return false;
			return `${namespace}_${prop}` in derive;
		},
	});

	namespaceCache.set(namespace, proxy);
	return proxy;
}

/**
 * Create a nested proxy for namespaced derivations access.
 * `derive.auth.status` → reads `auth_status` from flat derive
 *
 * Uses Set for O(1) namespace lookups and caches the outer proxy.
 */
function createNamespacedDeriveProxy(
	derive: Record<string, unknown>,
	modulesMap: ModulesMap,
): Record<string, Record<string, unknown>> {
	// Check cache first
	const cached = namespacedDeriveProxyCache.get(derive);
	if (cached) return cached;

	const moduleNames = Object.keys(modulesMap);
	const moduleNamesSet = new Set(moduleNames);

	const proxy = new Proxy({} as Record<string, Record<string, unknown>>, {
		get(_, namespace: string | symbol) {
			if (typeof namespace === "symbol") return undefined;
			if (BLOCKED_PROPS.has(namespace)) return undefined;
			if (!moduleNamesSet.has(namespace)) return undefined;

			// Return a cached proxy for this module's derivations
			return createModuleDeriveProxy(derive, namespace);
		},
		has(_, namespace: string | symbol) {
			if (typeof namespace === "symbol") return false;
			if (BLOCKED_PROPS.has(namespace)) return false;
			return moduleNamesSet.has(namespace);
		},
		ownKeys() {
			return moduleNames;
		},
		getOwnPropertyDescriptor(_, namespace: string | symbol) {
			if (typeof namespace === "symbol") return undefined;
			if (moduleNamesSet.has(namespace)) {
				return { configurable: true, enumerable: true };
			}
			return undefined;
		},
	});

	namespacedDeriveProxyCache.set(derive, proxy);
	return proxy;
}

/**
 * WeakMap to cache module events proxies.
 */
const moduleEventsProxyCache = new WeakMap<
	// biome-ignore lint/suspicious/noExplicitAny: Engine type for cache key
	any,
	Map<string, Record<string, (payload?: Record<string, unknown>) => void>>
>();

/**
 * Create a nested proxy for namespaced events access.
 * `events.auth.login({ token })` → dispatches `{ type: "auth_login", token }`
 *
 * Uses Set for O(1) namespace lookups and caches proxies for performance.
 */
function createNamespacedEventsProxy(
	// biome-ignore lint/suspicious/noExplicitAny: Engine type
	engine: any,
	modulesMap: ModulesMap,
): Record<string, Record<string, (payload?: Record<string, unknown>) => void>> {
	const moduleNames = Object.keys(modulesMap);
	const moduleNamesSet = new Set(moduleNames);

	// Get or create the namespace cache for this engine
	let namespaceCache = moduleEventsProxyCache.get(engine);
	if (!namespaceCache) {
		namespaceCache = new Map();
		moduleEventsProxyCache.set(engine, namespaceCache);
	}

	return new Proxy({} as Record<string, Record<string, (payload?: Record<string, unknown>) => void>>, {
		get(_, namespace: string | symbol) {
			if (typeof namespace === "symbol") return undefined;
			if (BLOCKED_PROPS.has(namespace)) return undefined;
			if (!moduleNamesSet.has(namespace)) return undefined;

			// Check cache for this namespace's event proxy
			const cached = namespaceCache!.get(namespace);
			if (cached) return cached;

			// Create and cache the module events proxy
			const moduleEventsProxy = new Proxy({} as Record<string, (payload?: Record<string, unknown>) => void>, {
				get(_, eventName: string | symbol) {
					if (typeof eventName === "symbol") return undefined;
					if (BLOCKED_PROPS.has(eventName)) return undefined;

					// Return a function that dispatches the prefixed event
					return (payload?: Record<string, unknown>) => {
						engine.dispatch({ type: `${namespace}_${eventName}`, ...payload });
					};
				},
			});

			namespaceCache!.set(namespace, moduleEventsProxy);
			return moduleEventsProxy;
		},
		has(_, namespace: string | symbol) {
			if (typeof namespace === "symbol") return false;
			if (BLOCKED_PROPS.has(namespace)) return false;
			return moduleNamesSet.has(namespace);
		},
		ownKeys() {
			return moduleNames;
		},
		getOwnPropertyDescriptor(_, namespace: string | symbol) {
			if (typeof namespace === "symbol") return undefined;
			if (moduleNamesSet.has(namespace)) {
				return { configurable: true, enumerable: true };
			}
			return undefined;
		},
	});
}
