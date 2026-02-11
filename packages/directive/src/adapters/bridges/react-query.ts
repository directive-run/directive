/**
 * React Query Adapter - Constraint-driven prefetching and cache coordination
 *
 * Philosophy: "Use Directive WITH React Query"
 * - React Query handles HOW to fetch data + caching
 * - Directive decides WHEN to fetch with constraint-driven prefetching
 *
 * @example
 * ```typescript
 * import { QueryClient } from '@tanstack/react-query'
 * import { createQueryBridge } from 'directive/react-query'
 *
 * const queryClient = new QueryClient()
 *
 * const bridge = createQueryBridge(queryClient, {
 *   constraints: {
 *     prefetchUser: {
 *       when: (facts) => facts.profileOpen && !facts.userLoaded,
 *       require: { type: 'PREFETCH', queryKey: ['user', facts.userId] }
 *     }
 *   },
 *   resolvers: {
 *     prefetch: {
 *       requirement: (req) => req.type === 'PREFETCH',
 *       resolve: (req) => queryClient.prefetchQuery({
 *         queryKey: req.queryKey,
 *         queryFn: () => api.fetch(req.queryKey)
 *       })
 *     }
 *   }
 * })
 * ```
 */

import type {
	Requirement,
	ModuleSchema,
	Plugin,
	SingleModuleSystem,
	System,
} from "../../core/types.js";
import {
	setBridgeFact,
	getBridgeFact,
} from "../../core/types/adapter-utils.js";
import { createModule } from "../../core/module.js";
import { createSystem } from "../../core/system.js";
import { t } from "../../core/facts.js";

// ============================================================================
// Types (React Query compatible, without direct dependency)
// ============================================================================

/** Simplified QueryClient interface for type compatibility */
export interface QueryClientLike {
	getQueryCache(): QueryCacheLike;
	prefetchQuery(options: PrefetchOptions): Promise<void>;
	fetchQuery<T>(options: FetchOptions): Promise<T>;
	invalidateQueries(filters?: InvalidateFilters): Promise<void>;
	setQueryData<T>(queryKey: QueryKey, data: T): void;
	getQueryData<T>(queryKey: QueryKey): T | undefined;
	getQueryState(queryKey: QueryKey): QueryStateLike | undefined;
	cancelQueries(filters?: InvalidateFilters): Promise<void>;
}

interface QueryCacheLike {
	subscribe(callback: (event: QueryCacheEvent) => void): () => void;
	findAll(filters?: { queryKey?: QueryKey }): Array<QueryLike>;
}

interface QueryLike {
	queryKey: QueryKey;
	state: QueryStateLike;
}

interface QueryStateLike {
	status: "pending" | "error" | "success";
	fetchStatus: "fetching" | "paused" | "idle";
	data?: unknown;
	error?: Error | null;
	dataUpdatedAt?: number;
}

interface QueryCacheEvent {
	type: "added" | "removed" | "updated";
	query: QueryLike;
}

type QueryKey = readonly unknown[];

interface PrefetchOptions {
	queryKey: QueryKey;
	queryFn?: () => Promise<unknown>;
	staleTime?: number;
}

interface FetchOptions extends PrefetchOptions {
	throwOnError?: boolean;
}

interface InvalidateFilters {
	queryKey?: QueryKey;
	exact?: boolean;
	predicate?: (query: QueryLike) => boolean;
}

// ============================================================================
// Bridge Types
// ============================================================================

/** Query state information stored in facts */
export interface QueryStateInfo {
	status: "pending" | "error" | "success";
	fetchStatus: "fetching" | "paused" | "idle";
	hasData: boolean;
	dataUpdatedAt: number | undefined;
	error: string | null;
}

/** Prefetch requirement */
export interface PrefetchRequirement extends Requirement {
	type: "PREFETCH";
	queryKey: QueryKey;
	queryFn?: () => Promise<unknown>;
	staleTime?: number;
}

/** Invalidate requirement */
export interface InvalidateRequirement extends Requirement {
	type: "INVALIDATE";
	queryKey?: QueryKey;
	exact?: boolean;
}

/** Constraint for query bridge */
export interface QueryConstraint<F extends Record<string, unknown>> {
	when: (facts: F & { queryStates: Record<string, QueryStateInfo> }) => boolean | Promise<boolean>;
	require:
		| Requirement
		| ((facts: F & { queryStates: Record<string, QueryStateInfo> }) => Requirement);
	priority?: number;
}

/** Resolver context for query bridge */
export interface QueryResolverContext<F extends Record<string, unknown>> {
	facts: F & { queryStates: Record<string, QueryStateInfo> };
	queryClient: QueryClientLike;
	signal: AbortSignal;
}

/** Resolver for query bridge */
export interface QueryResolver<F extends Record<string, unknown>, R extends Requirement = Requirement> {
	requirement: (req: Requirement) => req is R;
	key?: (req: R) => string;
	resolve: (req: R, ctx: QueryResolverContext<F>) => void | Promise<void>;
}

/** Options for creating a query bridge */
export interface QueryBridgeOptions<F extends Record<string, unknown>> {
	/** Application-level facts schema */
	factsSchema?: Record<string, { _type: unknown; _validators: [] }>;
	/** Initialize application facts */
	init?: (facts: F & { queryStates: Record<string, QueryStateInfo> }) => void;
	/** Constraints that produce requirements based on facts */
	constraints?: Record<string, QueryConstraint<F>>;
	/** Resolvers that fulfill requirements */
	resolvers?: Record<string, QueryResolver<F, Requirement>>;
	/** Plugins to add to the Directive system */
	plugins?: Plugin[];
	/** Enable time-travel debugging */
	debug?: boolean;
	/** Auto-start the system (default: true) */
	autoStart?: boolean;
	/** Sync interval for cache state (ms, default: 100) */
	syncIntervalMs?: number;
}

/** Query bridge instance */
export interface QueryBridge<F extends Record<string, unknown>> {
	/** The underlying Directive system */
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>;
	/** Application-level facts */
	facts: F & { queryStates: Record<string, QueryStateInfo> };
	/** Start syncing cache events to facts */
	startSync(): void;
	/** Stop syncing cache events */
	stopSync(): void;
	/** Wait for system to settle */
	settle(): Promise<void>;
	/** Destroy the bridge */
	destroy(): void;
}

// ============================================================================
// Bridge Schema
// ============================================================================

const QUERY_STATES_KEY = "__queryStates" as const;

const queryBridgeSchema = {
	facts: {
		[QUERY_STATES_KEY]: t.object<Record<string, QueryStateInfo>>(),
	},
	derivations: {},
	events: {},
	requirements: {},
} satisfies ModuleSchema;

// ============================================================================
// Constraint/Resolver Converters
// ============================================================================

// biome-ignore lint/suspicious/noExplicitAny: Constraint types are complex
function convertQueryConstraints<F extends Record<string, unknown>>(
	constraints: Record<string, QueryConstraint<F>>,
): Record<string, any> {
	// biome-ignore lint/suspicious/noExplicitAny: Result type is complex
	const result: Record<string, any> = {};

	for (const [id, constraint] of Object.entries(constraints)) {
		result[id] = {
			priority: constraint.priority ?? 0,
			// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
			when: (facts: any) => {
				const queryStates = getBridgeFact<Record<string, QueryStateInfo>>(facts, QUERY_STATES_KEY);
				return constraint.when({ ...facts, queryStates } as F & { queryStates: Record<string, QueryStateInfo> });
			},
			// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
			require: (facts: any) => {
				const queryStates = getBridgeFact<Record<string, QueryStateInfo>>(facts, QUERY_STATES_KEY);
				const typedFacts = { ...facts, queryStates } as F & { queryStates: Record<string, QueryStateInfo> };
				return typeof constraint.require === "function"
					? constraint.require(typedFacts)
					: constraint.require;
			},
		};
	}

	return result;
}

// biome-ignore lint/suspicious/noExplicitAny: Resolver types are complex
function convertQueryResolvers<F extends Record<string, unknown>>(
	resolvers: Record<string, QueryResolver<F, Requirement>>,
	queryClient: QueryClientLike,
	// biome-ignore lint/suspicious/noExplicitAny: Facts getter type varies
	getFacts: () => any,
): Record<string, any> {
	// biome-ignore lint/suspicious/noExplicitAny: Result type is complex
	const result: Record<string, any> = {};

	for (const [id, resolver] of Object.entries(resolvers)) {
		result[id] = {
			requirement: resolver.requirement,
			key: resolver.key,
			// biome-ignore lint/suspicious/noExplicitAny: Context type varies
			resolve: async (req: Requirement, ctx: any) => {
				const facts = getFacts();
				const queryStates = getBridgeFact<Record<string, QueryStateInfo>>(facts, QUERY_STATES_KEY);
				const queryCtx: QueryResolverContext<F> = {
					facts: { ...facts, queryStates } as F & { queryStates: Record<string, QueryStateInfo> },
					queryClient,
					signal: ctx.signal,
				};
				await resolver.resolve(req, queryCtx);
			},
		};
	}

	return result;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a bridge between React Query and Directive.
 *
 * @example
 * ```typescript
 * const bridge = createQueryBridge(queryClient, {
 *   factsSchema: {
 *     profileOpen: { _type: false, _validators: [] },
 *     userId: { _type: null as string | null, _validators: [] },
 *   },
 *   init: (facts) => {
 *     facts.profileOpen = false;
 *     facts.userId = null;
 *   },
 *   constraints: {
 *     prefetchUserProfile: {
 *       when: (facts) => facts.profileOpen && facts.userId !== null,
 *       require: (facts) => ({
 *         type: 'PREFETCH',
 *         queryKey: ['user', facts.userId],
 *       }),
 *     },
 *   },
 * });
 * ```
 */
export function createQueryBridge<F extends Record<string, unknown> = Record<string, never>>(
	queryClient: QueryClientLike,
	options: QueryBridgeOptions<F> = {}
): QueryBridge<F> {
	const {
		factsSchema = {},
		init,
		constraints = {},
		resolvers = {},
		plugins = [],
		debug = false,
		autoStart = true,
		syncIntervalMs = 100,
	} = options;

	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	let system: SingleModuleSystem<any>;

	// Build the combined schema
	const combinedSchema = {
		facts: {
			...queryBridgeSchema.facts,
			...factsSchema,
		},
		derivations: {},
		events: {},
		requirements: {},
	} satisfies ModuleSchema;

	// Convert constraints
	const directiveConstraints = convertQueryConstraints<F>(constraints);

	// Add built-in prefetch and invalidate resolvers
	// biome-ignore lint/suspicious/noExplicitAny: Resolver types are complex
	const builtInResolvers: Record<string, any> = {
		__prefetch: {
			requirement: (req: Requirement): req is PrefetchRequirement => req.type === "PREFETCH",
			key: (req: Requirement) => `prefetch:${stringifyQueryKey((req as PrefetchRequirement).queryKey)}`,
			resolve: async (req: Requirement) => {
				const prefetchReq = req as PrefetchRequirement;
				await queryClient.prefetchQuery({
					queryKey: prefetchReq.queryKey,
					queryFn: prefetchReq.queryFn,
					staleTime: prefetchReq.staleTime,
				});
			},
		},
		__invalidate: {
			requirement: (req: Requirement): req is InvalidateRequirement => req.type === "INVALIDATE",
			key: (req: Requirement) => `invalidate:${(req as InvalidateRequirement).queryKey ? stringifyQueryKey((req as InvalidateRequirement).queryKey!) : "all"}`,
			resolve: async (req: Requirement) => {
				const invalidateReq = req as InvalidateRequirement;
				await queryClient.invalidateQueries({
					queryKey: invalidateReq.queryKey,
					exact: invalidateReq.exact,
				});
			},
		},
	};

	// Convert user resolvers and merge with built-ins
	const userResolvers = convertQueryResolvers<F>(resolvers, queryClient, () => system.facts);
	const allResolvers = { ...builtInResolvers, ...userResolvers };

	// Create the Directive module
	// biome-ignore lint/suspicious/noExplicitAny: Bridge module uses dynamic constraints/resolvers
	const queryBridgeModule = createModule("react-query-bridge", {
		schema: combinedSchema,
		init: (facts) => {
			setBridgeFact(facts, QUERY_STATES_KEY, {});
			init?.(facts as unknown as F & { queryStates: Record<string, QueryStateInfo> });
		},
		constraints: directiveConstraints,
		resolvers: allResolvers as any,
	});

	// Create the Directive system
	system = createSystem({
		module: queryBridgeModule,
		plugins,
		debug: debug ? { timeTravel: true } : undefined,
	});

	// Cache sync functionality
	let syncUnsubscribe: (() => void) | null = null;
	let syncInterval: ReturnType<typeof setInterval> | null = null;

	const syncCacheToFacts = () => {
		const queries = queryClient.getQueryCache().findAll();
		const newStates: Record<string, QueryStateInfo> = {};

		for (const query of queries) {
			const key = stringifyQueryKey(query.queryKey);
			newStates[key] = {
				status: query.state.status,
				fetchStatus: query.state.fetchStatus,
				hasData: query.state.data !== undefined,
				dataUpdatedAt: query.state.dataUpdatedAt,
				error: query.state.error?.message ?? null,
			};
		}

		// Only update if changed
		const currentStates = getBridgeFact<Record<string, QueryStateInfo>>(system.facts, QUERY_STATES_KEY);
		if (JSON.stringify(currentStates) !== JSON.stringify(newStates)) {
			setBridgeFact(system.facts, QUERY_STATES_KEY, newStates);
		}
	};

	const startSync = () => {
		if (syncUnsubscribe) return;

		// Subscribe to cache events
		syncUnsubscribe = queryClient.getQueryCache().subscribe((event) => {
			const key = stringifyQueryKey(event.query.queryKey);
			const states = { ...getBridgeFact<Record<string, QueryStateInfo>>(system.facts, QUERY_STATES_KEY) };

			if (event.type === "removed") {
				delete states[key];
			} else {
				states[key] = {
					status: event.query.state.status,
					fetchStatus: event.query.state.fetchStatus,
					hasData: event.query.state.data !== undefined,
					dataUpdatedAt: event.query.state.dataUpdatedAt,
					error: event.query.state.error?.message ?? null,
				};
			}

			setBridgeFact(system.facts, QUERY_STATES_KEY, states);
		});

		// Also poll periodically for any missed updates
		syncInterval = setInterval(syncCacheToFacts, syncIntervalMs);

		// Initial sync
		syncCacheToFacts();
	};

	const stopSync = () => {
		syncUnsubscribe?.();
		syncUnsubscribe = null;
		if (syncInterval) {
			clearInterval(syncInterval);
			syncInterval = null;
		}
	};

	// Auto-start if enabled
	if (autoStart) {
		system.start();
		startSync();
	}

	return {
		system: system as unknown as System<any>,
		facts: system.facts as unknown as F & { queryStates: Record<string, QueryStateInfo> },
		startSync,
		stopSync,
		settle: () => system.settle(),
		destroy: () => {
			stopSync();
			system.destroy();
		},
	};
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Stringify a query key for use as a facts key.
 */
function stringifyQueryKey(queryKey: QueryKey): string {
	return JSON.stringify(queryKey);
}

/**
 * Check if a query is loading (pending or fetching).
 */
export function isQueryLoading(state: QueryStateInfo | undefined): boolean {
	if (!state) return false;
	return state.status === "pending" || state.fetchStatus === "fetching";
}

/**
 * Check if a query has fresh data (not stale).
 */
export function isQueryFresh(
	state: QueryStateInfo | undefined,
	staleTime: number
): boolean {
	if (!state || !state.hasData || !state.dataUpdatedAt) return false;
	return Date.now() - state.dataUpdatedAt < staleTime;
}

/**
 * Check if a query has an error.
 */
export function isQueryError(state: QueryStateInfo | undefined): boolean {
	return state?.status === "error";
}

/**
 * Create a prefetch requirement.
 */
export function prefetch(
	queryKey: QueryKey,
	options?: { queryFn?: () => Promise<unknown>; staleTime?: number }
): PrefetchRequirement {
	return {
		type: "PREFETCH",
		queryKey,
		...options,
	};
}

/**
 * Create an invalidate requirement.
 */
export function invalidate(
	queryKey?: QueryKey,
	options?: { exact?: boolean }
): InvalidateRequirement {
	return {
		type: "INVALIDATE",
		queryKey,
		...options,
	};
}

/**
 * Constraint helper: require prefetch when condition is met.
 *
 * @example
 * ```typescript
 * constraints: {
 *   userProfile: whenThenPrefetch(
 *     (facts) => facts.profileOpen && facts.userId,
 *     (facts) => ['user', facts.userId]
 *   ),
 * }
 * ```
 */
export function whenThenPrefetch<F extends Record<string, unknown>>(
	when: (facts: F & { queryStates: Record<string, QueryStateInfo> }) => boolean,
	queryKey: (facts: F & { queryStates: Record<string, QueryStateInfo> }) => QueryKey,
	options?: { queryFn?: () => Promise<unknown>; staleTime?: number; priority?: number }
): QueryConstraint<F> {
	return {
		when,
		require: (facts) => prefetch(queryKey(facts), options),
		priority: options?.priority,
	};
}

/**
 * Constraint helper: require invalidate when condition is met.
 *
 * @example
 * ```typescript
 * constraints: {
 *   invalidateOnLogout: whenThenInvalidate(
 *     (facts) => facts.justLoggedOut,
 *     () => ['user'] // Invalidate all user queries
 *   ),
 * }
 * ```
 */
export function whenThenInvalidate<F extends Record<string, unknown>>(
	when: (facts: F & { queryStates: Record<string, QueryStateInfo> }) => boolean,
	queryKey?: (facts: F & { queryStates: Record<string, QueryStateInfo> }) => QueryKey,
	options?: { exact?: boolean; priority?: number }
): QueryConstraint<F> {
	return {
		when,
		require: (facts) => invalidate(queryKey?.(facts), options),
		priority: options?.priority,
	};
}

// ============================================================================
// React Hooks (if using with React)
// ============================================================================

// These hooks are provided for convenience but require React to be installed
// They are type-safe wrappers around the bridge functionality

/**
 * Create React hooks for a query bridge.
 * Returns typed hooks that can be used in React components.
 *
 * @example
 * ```typescript
 * const bridge = createQueryBridge(queryClient, { ... });
 * const { useFacts, useQueryState } = createQueryBridgeHooks(bridge);
 *
 * function Component() {
 *   const { profileOpen } = useFacts();
 *   const userState = useQueryState(['user', userId]);
 *   return <div>{userState?.status}</div>;
 * }
 * ```
 */
export function createQueryBridgeHooks<F extends Record<string, unknown>>(
	bridge: QueryBridge<F>
) {
	// Dynamic import check for React
	let React: typeof import("react") | null = null;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		React = require("react");
	} catch {
		// React not available
	}

	if (!React) {
		throw new Error(
			"[Directive] createQueryBridgeHooks requires React to be installed"
		);
	}

	const { useSyncExternalStore, useCallback } = React;

	/**
	 * Subscribe to all application facts.
	 */
	function useFacts(): F & { queryStates: Record<string, QueryStateInfo> } {
		const subscribe = useCallback(
			(onStoreChange: () => void) => {
				return bridge.system.facts.$store.subscribeAll(onStoreChange);
			},
			[]
		);

		const getSnapshot = useCallback(() => {
			return bridge.facts;
		}, []);

		return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	}

	/**
	 * Subscribe to a specific query's state.
	 */
	function useQueryState(queryKey: QueryKey): QueryStateInfo | undefined {
		const key = stringifyQueryKey(queryKey);

		const subscribe = useCallback(
			(onStoreChange: () => void) => {
				return bridge.system.facts.$store.subscribe([QUERY_STATES_KEY], onStoreChange);
			},
			[]
		);

		const getSnapshot = useCallback(() => {
			return getBridgeFact<Record<string, QueryStateInfo>>(bridge.system.facts, QUERY_STATES_KEY)[key];
		}, [key]);

		return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	}

	return {
		useFacts,
		useQueryState,
	};
}
