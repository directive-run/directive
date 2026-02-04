/**
 * Redux Adapter - Bi-directional bridge between Redux and Directive
 *
 * Philosophy: "Use Directive WITH Redux"
 * - Redux handles predictable state management (reducers, actions)
 * - Directive replaces thunks/sagas with constraint-driven async orchestration
 *
 * @example
 * ```typescript
 * import { configureStore } from '@reduxjs/toolkit'
 * import { createDirectiveMiddleware, createDirectiveEnhancer } from 'directive/redux'
 *
 * const store = configureStore({
 *   reducer: rootReducer,
 *   middleware: (getDefault) =>
 *     getDefault().concat(createDirectiveMiddleware(directiveOptions)),
 *   enhancers: (getDefault) =>
 *     getDefault().concat(createDirectiveEnhancer(directiveOptions)),
 * })
 *
 * // Redux actions → Directive requirements
 * // Directive resolutions → Redux actions
 * ```
 */

import type {
	Requirement,
	ModuleSchema,
	Plugin,
	SingleModuleSystem,
	System,
	SystemEvent,
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
// Types (Redux compatible, without direct dependency)
// ============================================================================

/** Redux action interface */
export interface Action<T extends string = string> {
	type: T;
	[key: string]: unknown;
}

/** Redux AnyAction */
export type AnyAction = Action<string>;

/** Redux Dispatch type */
export type Dispatch<A extends Action = AnyAction> = (action: A) => A;

/** Redux Middleware type */
export type Middleware<S = unknown, D extends Dispatch = Dispatch> = (
	api: MiddlewareAPI<D, S>
) => (next: D) => (action: AnyAction) => unknown;

/** Redux MiddlewareAPI */
export interface MiddlewareAPI<D extends Dispatch = Dispatch, S = unknown> {
	dispatch: D;
	getState(): S;
}

/** Redux Store interface */
export interface StoreLike<S = unknown, A extends Action = AnyAction> {
	dispatch: Dispatch<A>;
	getState(): S;
	subscribe(listener: () => void): () => void;
	replaceReducer?(reducer: unknown): void;
}

/** Redux StoreEnhancer type */
export type StoreEnhancer<Ext = unknown, StateExt = unknown> = (
	next: StoreEnhancerStoreCreator
) => StoreEnhancerStoreCreator<Ext, StateExt>;

type StoreEnhancerStoreCreator<Ext = unknown, StateExt = unknown> = <
	S,
	A extends Action = AnyAction
>(
	reducer: unknown,
	preloadedState?: S
) => StoreLike<S & StateExt, A> & Ext;

// ============================================================================
// Bridge Types
// ============================================================================

/** Directive extension added to Redux store */
// biome-ignore lint/suspicious/noExplicitAny: System type varies
export interface DirectiveStoreExtension {
	/** Access to the underlying Directive system */
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	directive: System<any>;
	/** Wait for Directive to settle */
	settleDirective(): Promise<void>;
}

/** Constraint for Redux adapter */
export interface ReduxConstraint<S> {
	/** Condition based on Redux state */
	when: (state: S) => boolean | Promise<boolean>;
	/** Requirement to produce */
	require: Requirement | ((state: S) => Requirement);
	/** Priority */
	priority?: number;
}

/** Resolver context for Redux adapter */
export interface ReduxResolverContext<S> {
	/** Current Redux state */
	getState: () => S;
	/** Dispatch a Redux action */
	dispatch: Dispatch;
	/** Directive facts */
	// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
	facts: any;
	/** Abort signal */
	signal: AbortSignal;
}

/** Resolver for Redux adapter */
export interface ReduxResolver<S, R extends Requirement = Requirement> {
	/** Predicate to match requirements */
	requirement: (req: Requirement) => req is R;
	/** Custom deduplication key */
	key?: (req: R) => string;
	/** Resolution function */
	resolve: (req: R, ctx: ReduxResolverContext<S>) => void | Promise<void>;
}

/** Action interceptor configuration */
export interface ActionInterceptor<S> {
	/** Predicate to match actions */
	match: (action: AnyAction) => boolean;
	/** Produce a requirement from the action */
	toRequirement: (action: AnyAction, state: S) => Requirement | null;
	/** Whether to block the action until requirement is resolved */
	blockAction?: boolean;
}

/** Options for Directive middleware */
export interface DirectiveMiddlewareOptions<S> {
	/** Constraints that produce requirements based on Redux state */
	constraints?: Record<string, ReduxConstraint<S>>;
	/** Resolvers that fulfill requirements */
	resolvers?: Record<string, ReduxResolver<S, Requirement>>;
	/** Action interceptors that convert actions to requirements */
	interceptors?: ActionInterceptor<S>[];
	/** Actions to sync to Directive facts */
	syncActions?: boolean | ((action: AnyAction) => boolean);
	/** Callback when a requirement is created */
	onRequirementCreated?: (req: Requirement) => void;
	/** Callback when a requirement is resolved */
	onRequirementResolved?: (req: Requirement) => void;
	/** Plugins for Directive system */
	plugins?: Plugin[];
	/** Enable time-travel debugging */
	debug?: boolean;
}

// ============================================================================
// Bridge Schema
// ============================================================================

const REDUX_STATE_KEY = "reduxState" as const;
const LAST_ACTION_KEY = "lastAction" as const;

const reduxBridgeSchema = {
	facts: {
		[REDUX_STATE_KEY]: t.object<Record<string, unknown>>(),
		[LAST_ACTION_KEY]: t.any<Record<string, unknown> | null>(),
	},
	derivations: {},
	events: {},
	requirements: {},
} satisfies ModuleSchema;

// ============================================================================
// Constraint/Resolver Converters
// ============================================================================

// biome-ignore lint/suspicious/noExplicitAny: Constraint types are complex
function convertReduxConstraints<S>(
	constraints: Record<string, ReduxConstraint<S>>,
): Record<string, any> {
	// biome-ignore lint/suspicious/noExplicitAny: Result type is complex
	const result: Record<string, any> = {};

	for (const [id, constraint] of Object.entries(constraints)) {
		result[id] = {
			priority: constraint.priority ?? 0,
			// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
			when: (facts: any) => {
				const state = getBridgeFact<S>(facts, REDUX_STATE_KEY);
				return constraint.when(state);
			},
			// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
			require: (facts: any) => {
				const state = getBridgeFact<S>(facts, REDUX_STATE_KEY);
				return typeof constraint.require === "function"
					? constraint.require(state)
					: constraint.require;
			},
		};
	}

	return result;
}

// biome-ignore lint/suspicious/noExplicitAny: Resolver types are complex
function convertReduxResolvers<S>(
	resolvers: Record<string, ReduxResolver<S, Requirement>>,
	getStore: () => MiddlewareAPI<Dispatch, S> | null,
): Record<string, any> {
	// biome-ignore lint/suspicious/noExplicitAny: Result type is complex
	const result: Record<string, any> = {};

	for (const [id, resolver] of Object.entries(resolvers)) {
		result[id] = {
			requirement: resolver.requirement,
			key: resolver.key,
			// biome-ignore lint/suspicious/noExplicitAny: Context type varies
			resolve: async (req: Requirement, ctx: any) => {
				const store = getStore();
				if (!store) throw new Error("[Directive] Store not initialized");

				const reduxCtx: ReduxResolverContext<S> = {
					getState: () => store.getState(),
					dispatch: store.dispatch,
					facts: ctx.facts,
					signal: ctx.signal,
				};
				await resolver.resolve(req, reduxCtx);
			},
		};
	}

	return result;
}

// ============================================================================
// Middleware Implementation
// ============================================================================

/**
 * Create Redux middleware that integrates with Directive.
 *
 * The middleware:
 * 1. Intercepts actions and can convert them to Directive requirements
 * 2. Syncs Redux state changes to Directive facts
 * 3. Allows resolvers to dispatch Redux actions
 *
 * @example
 * ```typescript
 * const directiveMiddleware = createDirectiveMiddleware<RootState>({
 *   constraints: {
 *     fetchUserOnLogin: {
 *       when: (state) => state.auth.isLoggedIn && !state.user.data,
 *       require: { type: 'FETCH_USER' },
 *     },
 *   },
 *   resolvers: {
 *     fetchUser: {
 *       requirement: (req): req is { type: 'FETCH_USER' } => req.type === 'FETCH_USER',
 *       resolve: async (req, { dispatch }) => {
 *         const user = await api.fetchUser();
 *         dispatch({ type: 'user/setUser', payload: user });
 *       },
 *     },
 *   },
 *   interceptors: [
 *     {
 *       match: (action) => action.type === 'ASYNC_ACTION',
 *       toRequirement: (action) => ({ type: 'ASYNC', payload: action.payload }),
 *       blockAction: true,
 *     },
 *   ],
 * });
 * ```
 */
export function createDirectiveMiddleware<S>(
	options: DirectiveMiddlewareOptions<S>
	// biome-ignore lint/suspicious/noExplicitAny: Middleware type is complex
): Middleware<S, Dispatch> & { __directiveSystem?: System<any> } {
	const {
		constraints = {},
		resolvers = {},
		interceptors = [],
		syncActions = false,
		onRequirementCreated,
		onRequirementResolved,
		plugins = [],
		debug = false,
	} = options;

	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	let system: SingleModuleSystem<any> | null = null;
	let store: MiddlewareAPI<Dispatch, S> | null = null;

	// Convert constraints and resolvers
	const directiveConstraints = convertReduxConstraints<S>(constraints);
	const directiveResolvers = convertReduxResolvers<S>(
		resolvers,
		() => store,
	);

	// Create module
	// biome-ignore lint/suspicious/noExplicitAny: Bridge module uses dynamic constraints/resolvers
	const reduxModule = createModule("redux-bridge", {
		schema: reduxBridgeSchema,
		init: (facts) => {
			setBridgeFact(facts, REDUX_STATE_KEY, {} as S);
			setBridgeFact(facts, LAST_ACTION_KEY, null);
		},
		derive: {},
		events: {},
		constraints: directiveConstraints,
		resolvers: directiveResolvers as any,
	});

	// Callback plugin
	const callbackPlugin = createCallbackPlugin(
		"redux-callbacks",
		{
			onRequirementCreated,
			onRequirementResolved,
		},
	);

	// The middleware function
	// biome-ignore lint/suspicious/noExplicitAny: Middleware type is complex
	const middleware: Middleware<S, Dispatch> & { __directiveSystem?: System<any> } = (api) => {
		store = api;

		// Create system if not exists
		if (!system) {
			system = createSystem({
				module: reduxModule,
				plugins: [...plugins, callbackPlugin],
				debug: debug ? { timeTravel: true } : undefined,
			});
			middleware.__directiveSystem = system;
			system.start();
		}

		// Initial state sync
		setBridgeFact(system.facts, REDUX_STATE_KEY, api.getState());

		return (next) => (action) => {
			if (!system) return next(action);

			// Check interceptors
			for (const interceptor of interceptors) {
				if (interceptor.match(action)) {
					const req = interceptor.toRequirement(action, api.getState());
					if (req) {
						// Convert to Directive event
						system.dispatch({ type: `__intercepted:${action.type}`, requirement: req });

						if (interceptor.blockAction) {
							// Don't pass action to Redux, let Directive handle it
							return action;
						}
					}
				}
			}

			// Pass action to Redux
			const result = next(action);

			// Sync state to Directive
			setBridgeFact(system.facts, REDUX_STATE_KEY, api.getState());

			// Optionally sync action
			if (syncActions) {
				const shouldSync =
					typeof syncActions === "function" ? syncActions(action) : true;
				if (shouldSync) {
					setBridgeFact(system.facts, LAST_ACTION_KEY, action);
				}
			}

			return result;
		};
	};

	return middleware;
}

// ============================================================================
// Store Enhancer Implementation
// ============================================================================

/**
 * Create a Redux store enhancer that adds Directive integration.
 *
 * The enhancer adds a `directive` property to the store with the Directive system.
 *
 * @example
 * ```typescript
 * const store = configureStore({
 *   reducer: rootReducer,
 *   enhancers: (getDefault) =>
 *     getDefault().concat(createDirectiveEnhancer({
 *       constraints: { ... },
 *       resolvers: { ... },
 *     })),
 * })
 *
 * // Access Directive system
 * const system = store.directive;
 * console.log(system.inspect());
 * ```
 */
export function createDirectiveEnhancer<S>(
	options: DirectiveMiddlewareOptions<S>
): StoreEnhancer<DirectiveStoreExtension> {
	// Type assertion needed due to Redux's complex generic constraints
	return ((createStore: unknown) => (reducer: unknown, preloadedState: S | undefined) => {
		const store = (createStore as (r: unknown, p: S | undefined) => StoreLike<S, AnyAction>)(reducer, preloadedState);
		const middleware = createDirectiveMiddleware<S>(options);

		// Apply middleware manually
		const originalDispatch = store.dispatch;
		const middlewareAPI: MiddlewareAPI<Dispatch, S> = {
			dispatch: (action: AnyAction) => store.dispatch(action),
			getState: () => store.getState() as unknown as S,
		};

		const chain = middleware(middlewareAPI);
		const dispatch = chain(originalDispatch as Dispatch);

		// Get the system from middleware
		const system = middleware.__directiveSystem!;

		return {
			...store,
			dispatch,
			directive: system,
			settleDirective: () => system.settle(),
		};
	}) as StoreEnhancer<DirectiveStoreExtension>;
}

// ============================================================================
// Action Creators for Directive
// ============================================================================

/** Action to dispatch a Directive event */
export interface DirectiveEventAction extends Action<"@@directive/EVENT"> {
	event: SystemEvent;
}

/** Action to trigger Directive requirement */
export interface DirectiveRequireAction extends Action<"@@directive/REQUIRE"> {
	requirement: Requirement;
}

/**
 * Create a Redux action that dispatches a Directive event.
 */
export function directiveEvent(event: SystemEvent): DirectiveEventAction {
	return { type: "@@directive/EVENT", event };
}

/**
 * Create a Redux action that adds a Directive requirement.
 */
export function directiveRequire(requirement: Requirement): DirectiveRequireAction {
	return { type: "@@directive/REQUIRE", requirement };
}

/**
 * Check if an action is a Directive action.
 */
export function isDirectiveAction(
	action: AnyAction
): action is DirectiveEventAction | DirectiveRequireAction {
	return (
		action.type === "@@directive/EVENT" || action.type === "@@directive/REQUIRE"
	);
}

// ============================================================================
// Selectors
// ============================================================================

/**
 * Create a selector that reads a Directive derivation.
 *
 * This allows you to use Directive derivations in Redux selectors/components.
 *
 * @example
 * ```typescript
 * const selectIsLoading = createDirectiveSelector<RootState, boolean>(
 *   store,
 *   'isLoading'
 * );
 *
 * // In component
 * const isLoading = useSelector(selectIsLoading);
 * ```
 */
export function createDirectiveSelector<S, T>(
	store: StoreLike<S> & DirectiveStoreExtension,
	derivationId: string
): (state: S) => T {
	return (_state: S) => {
		return store.directive.read(derivationId) as T;
	};
}

// ============================================================================
// Binding Utilities
// ============================================================================

/**
 * Bind a Redux store to an existing Directive system.
 *
 * This is useful when you have an existing Directive system and want to add
 * Redux integration without using the middleware.
 *
 * @example
 * ```typescript
 * const directiveSystem = createSystem({ modules: [myModule] });
 * const reduxStore = createStore(reducer);
 *
 * const { sync, unsync } = bindReduxToDirective(reduxStore, directiveSystem, {
 *   toFacts: (state) => ({
 *     userId: state.user?.id,
 *     isLoggedIn: state.auth.isLoggedIn,
 *   }),
 *   fromFacts: (facts) => ({
 *     // Directive changes trigger Redux actions
 *     action: { type: 'directive/sync', payload: facts },
 *   }),
 * });
 *
 * sync();
 * ```
 */
export function bindReduxToDirective<S, M extends ModuleSchema>(
	store: StoreLike<S>,
	system: System<M>,
	mapping: {
		/** Map Redux state to Directive facts */
		toFacts: (state: S) => Partial<Record<string, unknown>>;
		/** Map Directive facts to Redux action (optional) */
		fromFacts?: (facts: Record<string, unknown>) => { action: AnyAction } | null;
		/** Watch specific fact keys */
		watchFacts?: string[];
	}
): { sync: () => void; unsync: () => void } {
	let unsubscribeRedux: (() => void) | null = null;
	let unsubscribeDirective: (() => void) | null = null;
	let isSyncing = false;

	const sync = () => {
		if (isSyncing) return;
		isSyncing = true;

		// Redux → Directive
		unsubscribeRedux = store.subscribe(() => {
			const state = store.getState();
			const facts = mapping.toFacts(state);
			system.batch(() => {
				for (const [key, value] of Object.entries(facts)) {
					setBridgeFact(system.facts, key, value);
				}
			});
		});

		// Directive → Redux (optional)
		if (mapping.fromFacts) {
			const factsToWatch = mapping.watchFacts ?? Object.keys(mapping.toFacts(store.getState()));
			unsubscribeDirective = system.facts.$store.subscribe(
				factsToWatch,
				() => {
					const facts = system.facts.$store.toObject();
					const result = mapping.fromFacts!(facts);
					if (result) {
						store.dispatch(result.action);
					}
				}
			);
		}

		// Initial sync
		const initialFacts = mapping.toFacts(store.getState());
		system.batch(() => {
			for (const [key, value] of Object.entries(initialFacts)) {
				setBridgeFact(system.facts, key, value);
			}
		});
	};

	const unsync = () => {
		isSyncing = false;
		unsubscribeRedux?.();
		unsubscribeDirective?.();
		unsubscribeRedux = null;
		unsubscribeDirective = null;
	};

	return { sync, unsync };
}

// ============================================================================
// DevTools Integration
// ============================================================================

/**
 * Create a Redux DevTools-compatible enhancer for Directive.
 *
 * This allows Directive state to appear in Redux DevTools alongside Redux state.
 *
 * @example
 * ```typescript
 * const store = configureStore({
 *   reducer: rootReducer,
 *   enhancers: (getDefault) => getDefault().concat(
 *     createDirectiveDevToolsEnhancer(directiveSystem)
 *   ),
 * });
 * ```
 */
export function createDirectiveDevToolsEnhancer<M extends ModuleSchema>(
	system: System<M>
): StoreEnhancer {
	// Type assertion needed due to Redux's complex generic constraints
	return ((createStore: unknown) => (reducer: unknown, preloadedState: unknown) => {
		const store = (createStore as (r: unknown, p: unknown) => StoreLike)(reducer, preloadedState);

		// Subscribe to Directive and dispatch virtual actions
		system.facts.$store.subscribeAll(() => {
			const facts = system.facts.$store.toObject();
			// Dispatch a virtual action for DevTools
			store.dispatch({
				type: "@@directive/STATE_UPDATE",
				facts,
				timestamp: Date.now(),
			});
		});

		return store;
	}) as StoreEnhancer;
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Extract the Directive system type from a store with DirectiveStoreExtension.
 */
export type DirectiveSystemFromStore<Store> = Store extends {
	directive: infer S;
}
	? S
	: never;

/**
 * Helper to create a typed resolver.
 */
export function createReduxResolver<S, R extends Requirement>(
	resolver: ReduxResolver<S, R>
): ReduxResolver<S, R> {
	return resolver;
}

/**
 * Helper to create a typed constraint.
 */
export function createReduxConstraint<S>(
	constraint: ReduxConstraint<S>
): ReduxConstraint<S> {
	return constraint;
}

/**
 * Helper to create a typed interceptor.
 */
export function createActionInterceptor<S>(
	interceptor: ActionInterceptor<S>
): ActionInterceptor<S> {
	return interceptor;
}
