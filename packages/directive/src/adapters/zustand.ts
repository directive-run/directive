/**
 * Zustand Adapter - Middleware that enforces Directive constraints on Zustand stores
 *
 * Philosophy: "Use Directive WITH Zustand to add constraint-driven orchestration"
 * - Zustand handles simple state management
 * - Directive adds constraint validation, requirement coordination
 *
 * @example
 * ```typescript
 * import { create } from 'zustand'
 * import { directiveMiddleware } from 'directive/zustand'
 *
 * const useStore = create(
 *   directiveMiddleware(
 *     (set) => ({
 *       count: 0,
 *       increment: () => set(s => ({ count: s.count + 1 }))
 *     }),
 *     {
 *       constraints: {
 *         maxCount: {
 *           when: (state) => state.count > 100,
 *           require: { type: 'RESET_COUNT' }
 *         }
 *       },
 *       resolvers: {
 *         reset: {
 *           requirement: (req) => req.type === 'RESET_COUNT',
 *           resolve: (req, { setState }) => setState({ count: 0 })
 *         }
 *       }
 *     }
 *   )
 * )
 * ```
 */

import type {
	Requirement,
	ModuleSchema,
	Plugin,
	SingleModuleSystem,
} from "../core/types.js";
import {
	setBridgeFact,
	getBridgeFact,
	createCallbackPlugin,
} from "../core/types/adapter-utils.js";
import { createModule } from "../core/module.js";
import { createSystem } from "../core/system.js";
import { t } from "../core/facts.js";

// ============================================================================
// Types
// ============================================================================

/** Zustand StateCreator type (simplified for compatibility) */
type StateCreator<T, _Mps = [], _Ms = []> = (
	set: (partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean) => void,
	get: () => T,
	api: StoreApi<T>
) => T;

/** Zustand StoreApi type (simplified) */
interface StoreApi<T> {
	getState: () => T;
	setState: (partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean) => void;
	subscribe: (listener: (state: T, prevState: T) => void) => () => void;
	destroy?: () => void;
}

/** Constraint definition for Zustand adapter */
export interface ZustandConstraint<T> {
	/** Condition that activates this constraint */
	when: (state: T) => boolean | Promise<boolean>;
	/** Requirement to produce when condition is met */
	require: Requirement | ((state: T) => Requirement);
	/** Priority for ordering (higher runs first) */
	priority?: number;
}

/** Resolver definition for Zustand adapter */
export interface ZustandResolver<T, R extends Requirement = Requirement> {
	/** Predicate to match requirements */
	requirement: (req: Requirement) => req is R;
	/** Custom key for deduplication */
	key?: (req: R) => string;
	/** Resolution function */
	resolve: (req: R, ctx: ZustandResolverContext<T>) => void | Promise<void>;
}

/** Context passed to Zustand resolvers */
export interface ZustandResolverContext<T> {
	/** Get current state */
	getState: () => T;
	/** Set state (merged) */
	setState: (partial: Partial<T> | ((state: T) => Partial<T>)) => void;
	/** Replace entire state */
	replaceState: (state: T) => void;
	/** Abort signal for cancellation */
	signal: AbortSignal;
}

/** Options for Directive middleware */
export interface DirectiveMiddlewareOptions<T> {
	/** Constraints that produce requirements based on state */
	constraints?: Record<string, ZustandConstraint<T>>;
	/** Resolvers that fulfill requirements */
	resolvers?: Record<string, ZustandResolver<T, Requirement>>;
	/** Callback when a requirement is created */
	onRequirementCreated?: (req: Requirement) => void;
	/** Callback when a requirement is resolved */
	onRequirementResolved?: (req: Requirement) => void;
	/** Whether to start the Directive system automatically (default: true) */
	autoStart?: boolean;
	/** Plugins to add to the Directive system */
	plugins?: Plugin[];
	/** Enable time-travel debugging */
	debug?: boolean;
}

/** Extended store API with Directive system access */
// biome-ignore lint/suspicious/noExplicitAny: System type varies
export interface DirectiveStoreApi<T> extends StoreApi<T> {
	/** Access to the underlying Directive system */
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	directive: SingleModuleSystem<any>;
	/** Manually trigger constraint evaluation */
	evaluate: () => Promise<void>;
}

// ============================================================================
// Bridge Schema
// ============================================================================

/** Bridge schema for Zustand state */
const BRIDGE_KEY = "__zustandState" as const;

const zustandBridgeSchema = {
	facts: {
		[BRIDGE_KEY]: t.object<Record<string, unknown>>(),
	},
	derivations: {},
	events: {},
	requirements: {},
} satisfies ModuleSchema;

// Type unused but kept for documentation
// type ZustandBridgeSchema = typeof zustandBridgeSchema;

// ============================================================================
// Constraint/Resolver Converters
// ============================================================================

// biome-ignore lint/suspicious/noExplicitAny: Constraint types are complex
function convertZustandConstraints<T>(
	constraints: Record<string, ZustandConstraint<T>>,
): Record<string, any> {
	// biome-ignore lint/suspicious/noExplicitAny: Result type is complex
	const result: Record<string, any> = {};

	for (const [id, constraint] of Object.entries(constraints)) {
		result[id] = {
			priority: constraint.priority ?? 0,
			// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
			when: (facts: any) => {
				const state = getBridgeFact<T>(facts, BRIDGE_KEY);
				return constraint.when(state);
			},
			// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
			require: (facts: any) => {
				const state = getBridgeFact<T>(facts, BRIDGE_KEY);
				return typeof constraint.require === "function"
					? constraint.require(state)
					: constraint.require;
			},
		};
	}

	return result;
}

// biome-ignore lint/suspicious/noExplicitAny: Resolver types are complex
function convertZustandResolvers<T>(
	resolvers: Record<string, ZustandResolver<T, Requirement>>,
	getState: () => T,
	setState: (partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean) => void,
	syncToFacts: (state: T) => void,
): Record<string, any> {
	// biome-ignore lint/suspicious/noExplicitAny: Result type is complex
	const result: Record<string, any> = {};

	for (const [id, resolver] of Object.entries(resolvers)) {
		result[id] = {
			requirement: resolver.requirement,
			key: resolver.key,
			// biome-ignore lint/suspicious/noExplicitAny: Context type varies
			resolve: async (req: Requirement, ctx: any) => {
				const zustandCtx: ZustandResolverContext<T> = {
					getState,
					setState: (partial) => {
						const newState = typeof partial === "function" ? partial(getState()) : partial;
						setState(newState as Partial<T>);
						syncToFacts(getState());
					},
					replaceState: (state) => {
						setState(state as T, true);
						syncToFacts(state);
					},
					signal: ctx.signal,
				};
				await resolver.resolve(req, zustandCtx);
			},
		};
	}

	return result;
}

// ============================================================================
// Middleware Implementation
// ============================================================================

/**
 * Zustand middleware that enforces Directive constraints.
 *
 * Wraps setState to trigger constraint evaluation after each state change.
 * Bi-directional sync: Zustand changes → Directive facts, Directive resolutions → Zustand state.
 */
export function createDirectiveMiddleware<T extends object>(
	initializer: StateCreator<T>,
	options: DirectiveMiddlewareOptions<T> = {}
	// biome-ignore lint/suspicious/noExplicitAny: Return type is complex
): StateCreator<T & { __directive?: SingleModuleSystem<any> }, [], []> {
	const {
		constraints = {},
		resolvers = {},
		onRequirementCreated,
		onRequirementResolved,
		autoStart = true,
		plugins = [],
		debug = false,
	} = options;

	return (set, get, api) => {
		// Create the Directive module first (system reference will be updated)
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		let system: SingleModuleSystem<any>;

		// Sync function to update facts from Zustand state
		const syncToFacts = (state: T) => {
			setBridgeFact(system.facts, BRIDGE_KEY, state);
		};

		// Convert constraints and resolvers
		const directiveConstraints = convertZustandConstraints<T>(constraints);
		const directiveResolvers = convertZustandResolvers<T>(
			resolvers,
			get,
			set,
			syncToFacts,
		);

		// Create the Directive module
		// biome-ignore lint/suspicious/noExplicitAny: Bridge module uses dynamic constraints/resolvers
		const zustandModule = createModule("zustand-bridge", {
			schema: zustandBridgeSchema,
			init: (facts) => {
				setBridgeFact(facts, BRIDGE_KEY, {} as T);
			},
			derive: {},
			events: {},
			constraints: directiveConstraints,
			resolvers: directiveResolvers as any,
		});

		// Create callback plugin
		const callbackPlugin = createCallbackPlugin(
			"zustand-callbacks",
			{
				onRequirementCreated,
				onRequirementResolved,
			},
		);

		// Create the Directive system
		system = createSystem({
			module: zustandModule,
			plugins: [...plugins, callbackPlugin],
			debug: debug ? { timeTravel: true } : undefined,
		});

		// Wrap setState to sync to Directive and trigger evaluation
		const originalSetState = api.setState;
		api.setState = (partial, replace) => {
			originalSetState(partial, replace);
			syncToFacts(get());
		};

		// Add Directive API to the store
		(api as DirectiveStoreApi<T>).directive = system;
		(api as DirectiveStoreApi<T>).evaluate = async () => {
			await system.settle();
		};

		// Add destroy handler
		const originalDestroy = api.destroy;
		api.destroy = () => {
			system.destroy();
			originalDestroy?.();
		};

		// Initialize the underlying store
		const initialState = initializer(set, get, api);

		// Initialize Directive facts with initial state
		syncToFacts(initialState);

		// Start the system if autoStart is enabled
		if (autoStart) {
			system.start();
		}

		return initialState;
	};
}

/** @deprecated Use `createDirectiveMiddleware` instead. */
export const directiveMiddleware = createDirectiveMiddleware;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a typed constraint helper.
 *
 * @example
 * ```typescript
 * const maxCountConstraint = createConstraint<MyState>({
 *   when: (state) => state.count > 100,
 *   require: { type: 'RESET_COUNT' }
 * });
 * ```
 */
export function createConstraint<T>(
	constraint: ZustandConstraint<T>
): ZustandConstraint<T> {
	return constraint;
}

/**
 * Create a typed resolver helper.
 *
 * @example
 * ```typescript
 * interface ResetCountReq extends Requirement { type: 'RESET_COUNT' }
 *
 * const resetResolver = createResolver<MyState, ResetCountReq>({
 *   requirement: (req): req is ResetCountReq => req.type === 'RESET_COUNT',
 *   resolve: (req, { setState }) => setState({ count: 0 })
 * });
 * ```
 */
export function createResolver<T, R extends Requirement = Requirement>(
	resolver: ZustandResolver<T, R>
): ZustandResolver<T, R> {
	return resolver;
}

/**
 * Utility to extract the Directive system from a Zustand store.
 *
 * @example
 * ```typescript
 * const store = create(directiveMiddleware(...));
 * const system = getDirectiveSystem(store);
 * console.log(system.inspect());
 * ```
 */
export function getDirectiveSystem<T>(
	store: StoreApi<T>
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
): SingleModuleSystem<any> | undefined {
	return (store as DirectiveStoreApi<T>).directive;
}

/**
 * Subscribe to Directive requirements from a Zustand store.
 *
 * @example
 * ```typescript
 * subscribeToRequirements(store, (req, event) => {
 *   if (event === 'created') {
 *     console.log('New requirement:', req.type);
 *   }
 * });
 * ```
 */
export function subscribeToRequirements<T>(
	store: StoreApi<T>,
	callback: (req: Requirement, event: "created" | "resolved" | "canceled") => void
): () => void {
	const system = getDirectiveSystem(store);
	if (!system) {
		console.warn("[Directive] Store was not created with directiveMiddleware");
		return () => {};
	}

	// Subscribe to fact changes and inspect for requirement changes
	let lastUnmetIds = new Set<string>();

	const unsubscribe = system.facts.$store.subscribeAll(() => {
		const inspection = system.inspect();
		const currentUnmetIds = new Set(inspection.unmet.map((r) => r.id));

		// New requirements
		for (const req of inspection.unmet) {
			if (!lastUnmetIds.has(req.id)) {
				callback(req.requirement, "created");
			}
		}

		// Resolved/canceled requirements
		for (const id of lastUnmetIds) {
			if (!currentUnmetIds.has(id)) {
				// Find the original requirement (it's been resolved or canceled)
				const wasInflight = inspection.inflight.some((i) => i.id === id);
				callback({ type: "UNKNOWN", id }, wasInflight ? "resolved" : "canceled");
			}
		}

		lastUnmetIds = currentUnmetIds;
	});

	return unsubscribe;
}

// ============================================================================
// Sync Utilities
// ============================================================================

/**
 * Create a two-way binding between a Zustand store and a Directive system.
 *
 * This is useful when you have an existing Zustand store and want to add
 * Directive coordination without using the middleware.
 *
 * @example
 * ```typescript
 * const zustandStore = create((set) => ({ count: 0 }));
 * const directiveSystem = createSystem({ modules: [myModule] });
 *
 * const { sync, unsync } = bindZustandToDirective(zustandStore, directiveSystem, {
 *   // Map Zustand state to Directive facts
 *   toFacts: (state) => ({ count: state.count }),
 *   // Map Directive facts back to Zustand state
 *   fromFacts: (facts) => ({ count: facts.count }),
 * });
 *
 * // Start syncing
 * sync();
 *
 * // Stop syncing
 * unsync();
 * ```
 */
export function bindZustandToDirective<T extends object, M extends ModuleSchema>(
	store: StoreApi<T>,
	system: SingleModuleSystem<M>,
	mapping: {
		toFacts: (state: T) => Partial<Record<string, unknown>>;
		fromFacts: (facts: Record<string, unknown>) => Partial<T>;
		/** Keys to watch in Directive (defaults to all keys from toFacts) */
		watchFacts?: string[];
	}
): { sync: () => void; unsync: () => void } {
	let unsubscribeZustand: (() => void) | null = null;
	let unsubscribeDirective: (() => void) | null = null;
	let isSyncing = false;

	const sync = () => {
		if (isSyncing) return;
		isSyncing = true;

		// Zustand → Directive
		unsubscribeZustand = store.subscribe((state) => {
			const facts = mapping.toFacts(state);
			system.batch(() => {
				for (const [key, value] of Object.entries(facts)) {
					setBridgeFact(system.facts, key, value);
				}
			});
		});

		// Directive → Zustand
		const factsToWatch = mapping.watchFacts ?? Object.keys(mapping.toFacts(store.getState()));
		unsubscribeDirective = system.facts.$store.subscribe(
			factsToWatch,
			() => {
				const facts = system.facts.$store.toObject();
				const stateUpdate = mapping.fromFacts(facts);
				store.setState(stateUpdate);
			}
		);

		// Initial sync: Zustand → Directive
		const initialFacts = mapping.toFacts(store.getState());
		system.batch(() => {
			for (const [key, value] of Object.entries(initialFacts)) {
				setBridgeFact(system.facts, key, value);
			}
		});
	};

	const unsync = () => {
		isSyncing = false;
		unsubscribeZustand?.();
		unsubscribeDirective?.();
		unsubscribeZustand = null;
		unsubscribeDirective = null;
	};

	return { sync, unsync };
}
