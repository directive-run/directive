/**
 * Svelte Adapter - Svelte stores for Directive
 *
 * Features:
 * - createDerivationStore for reactive derived values
 * - createFactStore for reactive fact values
 * - Svelte context for system
 * - useRequirementStatus for loading/error states
 * - createTypedHooks for schema-specific hooks
 */

import { getContext, setContext, onDestroy } from "svelte";
import { readable, type Readable } from "svelte/store";
import { createSystem } from "../core/system.js";
import type { CreateSystemOptionsSingle, ModuleSchema, InferFacts, InferDerivations, InferEvents } from "../core/types.js";
import type { ModuleDef, System, SystemInspection } from "../core/types.js";
import {
	createRequirementStatusPlugin,
	type RequirementTypeStatus,
} from "../utils/requirement-status.js";

// Re-export for convenience
export type { RequirementTypeStatus };

/** Type for the requirement status plugin return value */
type StatusPlugin = ReturnType<typeof createRequirementStatusPlugin>;

// ============================================================================
// Context
// ============================================================================

const DIRECTIVE_KEY = Symbol("directive");
const STATUS_PLUGIN_KEY = Symbol("directive-status");

/**
 * Set the Directive system in Svelte context.
 * Call this in a parent component to make the system available to children.
 *
 * @example
 * ```svelte
 * <script>
 *   import { setDirectiveContext } from 'directive/svelte';
 *   import { createSystem } from 'directive';
 *
 *   const system = createSystem({ modules: [myModule] });
 *   setDirectiveContext(system);
 * </script>
 * ```
 */
export function setDirectiveContext<M extends ModuleSchema>(
	system: System<M>,
	statusPlugin?: StatusPlugin
): void {
	setContext(DIRECTIVE_KEY, system);
	setContext(STATUS_PLUGIN_KEY, statusPlugin ?? null);
}

/**
 * Get the Directive system from Svelte context.
 *
 * @throws If system is not set in context
 */
export function getDirectiveContext<M extends ModuleSchema = ModuleSchema>(): System<M> {
	// biome-ignore lint/suspicious/noExplicitAny: Context needs to work with any schema
	const system = getContext<System<any> | undefined>(DIRECTIVE_KEY);
	if (!system) {
		throw new Error(
			"[Directive] getDirectiveContext must be called within a component tree that has a Directive system set. " +
			"Use setDirectiveContext() in a parent component.",
		);
	}
	return system as System<M>;
}

// ============================================================================
// Store Factories
// ============================================================================

/**
 * Create a Svelte store for a derived value.
 *
 * @example
 * ```svelte
 * <script>
 *   import { getDirectiveContext, createDerivationStore } from 'directive/svelte';
 *
 *   const system = getDirectiveContext();
 *   const isRed = createDerivationStore(system, 'isRed');
 * </script>
 *
 * <div>{$isRed ? 'Red' : 'Not Red'}</div>
 * ```
 */
export function createDerivationStore<T>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	derivationId: string,
): Readable<T> {
	// Dev warning for invalid derivation IDs
	if (process.env.NODE_ENV !== "production") {
		const initialValue = system.read(derivationId);
		if (initialValue === undefined) {
			console.warn(
				`[Directive] createDerivationStore("${derivationId}") returned undefined. ` +
					`Check that "${derivationId}" is defined in your module's derive property.`,
			);
		}
	}

	return readable<T>(system.read(derivationId) as T, (set) => {
		const unsubscribe = system.subscribe([derivationId], () => {
			set(system.read(derivationId) as T);
		});
		return unsubscribe;
	});
}

/**
 * Create a Svelte store for multiple derived values.
 *
 * @example
 * ```svelte
 * <script>
 *   import { getDirectiveContext, createDerivationsStore } from 'directive/svelte';
 *
 *   const system = getDirectiveContext();
 *   const state = createDerivationsStore(system, ['isRed', 'elapsed']);
 * </script>
 *
 * <div>{$state.isRed ? `Red for ${$state.elapsed}s` : 'Not Red'}</div>
 * ```
 */
export function createDerivationsStore<T extends Record<string, unknown>>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	derivationIds: string[],
): Readable<T> {
	const getValues = (): T => {
		const result: Record<string, unknown> = {};
		for (const id of derivationIds) {
			result[id] = system.read(id);
		}
		return result as T;
	};

	return readable<T>(getValues(), (set) => {
		const unsubscribe = system.subscribe(derivationIds, () => {
			set(getValues());
		});
		return unsubscribe;
	});
}

/**
 * Create a Svelte store for a single fact value.
 *
 * @example
 * ```svelte
 * <script>
 *   import { getDirectiveContext, createFactStore } from 'directive/svelte';
 *
 *   const system = getDirectiveContext();
 *   const phase = createFactStore(system, 'phase');
 * </script>
 *
 * <div>Current phase: {$phase}</div>
 * ```
 */
export function createFactStore<T>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	factKey: string,
): Readable<T | undefined> {
	return readable<T | undefined>(
		system.facts.$store.get(factKey) as T | undefined,
		(set) => {
			const unsubscribe = system.facts.$store.subscribe([factKey], () => {
				set(system.facts.$store.get(factKey) as T | undefined);
			});
			return unsubscribe;
		},
	);
}

/**
 * Create a Svelte store for system inspection data.
 *
 * NOTE: This updates on every fact change. Use sparingly in production.
 *
 * @example
 * ```svelte
 * <script>
 *   import { getDirectiveContext, createInspectStore } from 'directive/svelte';
 *
 *   const system = getDirectiveContext();
 *   const inspection = createInspectStore(system);
 * </script>
 *
 * <div>Unmet: {$inspection.unmet.length}</div>
 * ```
 */
export function createInspectStore(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
): Readable<SystemInspection> {
	return readable<SystemInspection>(system.inspect(), (set) => {
		const unsubscribe = system.facts.$store.subscribeAll(() => {
			set(system.inspect());
		});
		return unsubscribe;
	});
}

// ============================================================================
// Convenience Hooks (require context)
// ============================================================================

/**
 * Get a derived value store using context.
 * Shorthand for getDirectiveContext() + createDerivationStore().
 *
 * @example
 * ```svelte
 * <script>
 *   import { useDerivation } from 'directive/svelte';
 *
 *   const isRed = useDerivation('isRed');
 * </script>
 *
 * <div>{$isRed ? 'Red' : 'Not Red'}</div>
 * ```
 */
export function useDerivation<T>(derivationId: string): Readable<T> {
	const system = getDirectiveContext();
	return createDerivationStore<T>(system, derivationId);
}

/**
 * Get multiple derived values store using context.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useDerivations } from 'directive/svelte';
 *
 *   const state = useDerivations(['isRed', 'elapsed']);
 * </script>
 *
 * <div>{$state.isRed ? `Red for ${$state.elapsed}s` : 'Not Red'}</div>
 * ```
 */
export function useDerivations<T extends Record<string, unknown>>(
	derivationIds: string[],
): Readable<T> {
	const system = getDirectiveContext();
	return createDerivationsStore<T>(system, derivationIds);
}

/**
 * Get direct access to facts for mutations.
 *
 * WARNING: The returned facts object is NOT reactive. Use this for event handlers
 * and imperative code, not for rendering. Use `useDerivation` or `useFact` for reactive values.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useFacts, useDispatch } from 'directive/svelte';
 *
 *   const facts = useFacts();
 *   const dispatch = useDispatch();
 *
 *   function increment() {
 *     facts.count = (facts.count ?? 0) + 1;
 *   }
 * </script>
 * ```
 */
export function useFacts<M extends ModuleSchema>(): System<M>["facts"] {
	const system = getDirectiveContext<M>();
	return system.facts;
}

/**
 * Get a fact store using context.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useFact } from 'directive/svelte';
 *
 *   const phase = useFact('phase');
 * </script>
 *
 * <div>Phase: {$phase}</div>
 * ```
 */
export function useFact<T>(factKey: string): Readable<T | undefined> {
	const system = getDirectiveContext();
	return createFactStore<T>(system, factKey);
}

/**
 * Get a dispatch function using context.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useDispatch } from 'directive/svelte';
 *
 *   const dispatch = useDispatch();
 * </script>
 *
 * <button on:click={() => dispatch({ type: 'tick' })}>Tick</button>
 * ```
 */
export function useDispatch() {
	const system = getDirectiveContext();
	return (event: { type: string; [key: string]: unknown }) => {
		system.dispatch(event);
	};
}

/**
 * Get inspection store using context.
 */
export function useInspect(): Readable<SystemInspection> {
	const system = getDirectiveContext();
	return createInspectStore(system);
}

/** Requirements state returned by useRequirements */
export interface RequirementsState {
	/** Array of unmet requirements waiting to be resolved */
	unmet: Array<{ id: string; requirement: { type: string; [key: string]: unknown }; fromConstraint: string }>;
	/** Array of requirements currently being resolved */
	inflight: Array<{ id: string; resolverId: string; startedAt: number }>;
	/** Whether there are any unmet requirements */
	hasUnmet: boolean;
	/** Whether there are any inflight requirements */
	hasInflight: boolean;
	/** Whether the system is actively working (has unmet or inflight requirements) */
	isWorking: boolean;
}

/**
 * Get current requirements state as a readable store.
 *
 * Provides a focused view of just requirements without full inspection overhead.
 *
 * @returns Readable store with the current requirements state
 *
 * @example
 * ```svelte
 * <script>
 *   import { useRequirements } from 'directive/svelte';
 *
 *   const requirements = useRequirements();
 * </script>
 *
 * {#if $requirements.isWorking}
 *   <Spinner />
 * {/if}
 * ```
 */
export function useRequirements(): Readable<RequirementsState> {
	const system = getDirectiveContext();

	const getState = (): RequirementsState => {
		const inspection = system.inspect();
		return {
			unmet: inspection.unmet,
			inflight: inspection.inflight,
			hasUnmet: inspection.unmet.length > 0,
			hasInflight: inspection.inflight.length > 0,
			isWorking: inspection.unmet.length > 0 || inspection.inflight.length > 0,
		};
	};

	return readable<RequirementsState>(getState(), (set) => {
		const unsubscribe = system.facts.$store.subscribeAll(() => {
			set(getState());
		});
		return unsubscribe;
	});
}

/**
 * Get requirement status store using context.
 *
 * Requires a statusPlugin to be passed to setDirectiveContext().
 *
 * @param type - The requirement type to get status for
 * @returns Readable store with the current status
 *
 * @example
 * ```svelte
 * <script>
 *   import { useRequirementStatus } from 'directive/svelte';
 *
 *   const status = useRequirementStatus('FETCH_USER');
 * </script>
 *
 * {#if $status.isLoading}
 *   <Spinner />
 * {:else if $status.hasError}
 *   <Error message={$status.lastError?.message} />
 * {:else}
 *   <UserContent />
 * {/if}
 * ```
 */
export function useRequirementStatus(type: string): Readable<RequirementTypeStatus> {
	const statusPlugin = getContext<StatusPlugin | null>(STATUS_PLUGIN_KEY);
	if (!statusPlugin) {
		throw new Error(
			"[Directive] useRequirementStatus requires a statusPlugin. " +
				"Pass statusPlugin to setDirectiveContext().",
		);
	}

	return readable<RequirementTypeStatus>(statusPlugin.getStatus(type), (set) => {
		const unsubscribe = statusPlugin.subscribe(() => {
			set(statusPlugin.getStatus(type));
		});
		return unsubscribe;
	});
}

/**
 * Get time-travel debug API using context.
 */
export function useTimeTravel() {
	const system = getDirectiveContext();
	return system.debug;
}

/**
 * Watch a derivation and call a callback on change.
 * Automatically cleans up on component destroy.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useWatch } from 'directive/svelte';
 *
 *   useWatch('phase', (newPhase, oldPhase) => {
 *     console.log(`Phase changed from ${oldPhase} to ${newPhase}`);
 *   });
 * </script>
 * ```
 */
export function useWatch<T>(
	derivationId: string,
	callback: (newValue: T, previousValue: T | undefined) => void,
): void {
	const system = getDirectiveContext();
	const unsubscribe = system.watch<T>(derivationId, callback);
	onDestroy(unsubscribe);
}

/**
 * Alias for getDirectiveContext for consistency with other adapters.
 */
export const useSystem = getDirectiveContext;

// ============================================================================
// Scoped System (like XState's useActorRef)
// ============================================================================

/** Options for createDirective/useDirective */
export type CreateDirectiveOptions<M extends ModuleSchema> =
	| ModuleDef<M>
	| CreateSystemOptionsSingle<M>;

// Cache for memoization - prevents re-creation in reactive contexts
// biome-ignore lint/suspicious/noExplicitAny: Cache needs to work with any schema
const systemCache = new WeakMap<object, System<any>>();

/**
 * Create a scoped Directive system with automatic lifecycle management.
 * The system is automatically started and destroyed when component unmounts.
 *
 * @param options - Either a single module or full system options
 * @returns The system instance
 *
 * @see {@link useDerivation} for reading derived values
 * @see {@link useFacts} for direct fact access
 *
 * @example
 * ```svelte
 * <script>
 *   import { createDirective, setDirectiveContext } from 'directive/svelte';
 *
 *   const system = createDirective(counterModule);
 *   setDirectiveContext(system); // Make available to children
 * </script>
 * ```
 */
export function createDirective<M extends ModuleSchema>(
	options: CreateDirectiveOptions<M>,
): System<M> {
	// Check cache to prevent re-creation in reactive contexts
	const cached = systemCache.get(options as object);
	if (cached) {
		return cached as System<M>;
	}

	// Check if options is a module or system options
	const isModule = "id" in options && "schema" in options;

	const system = isModule
		? createSystem({ module: options as ModuleDef<M> })
		: createSystem(options as CreateSystemOptionsSingle<M>);

	// Cache the system
	// biome-ignore lint/suspicious/noExplicitAny: Cache needs to work with any schema
	systemCache.set(options as object, system as System<any>);

	system.start();

	onDestroy(() => {
		system.destroy();
		systemCache.delete(options as object);
	});

	// Return as System<M> - the underlying type matches
	return system as unknown as System<M>;
}

/**
 * Alias for createDirective for consistency with other adapters.
 * @see {@link createDirective}
 */
export const useDirective = createDirective;

// ============================================================================
// Typed Hooks Factory
// ============================================================================

/**
 * Create typed stores for a specific system schema.
 *
 * This provides better type inference than the generic stores.
 *
 * @example
 * ```ts
 * import { createTypedHooks } from 'directive/svelte';
 *
 * // Define your schema
 * const schema = {
 *   facts: { count: t.number(), user: t.any<User | null>() },
 *   derivations: { doubled: t.number() },
 *   events: { increment: {}, setUser: { user: t.any<User>() } },
 *   requirements: {},
 * } satisfies ModuleSchema;
 *
 * // Create typed hooks
 * const { useDerivation, useFact, useDispatch } = createTypedHooks<typeof schema>();
 *
 * // In your component:
 * const count = useFact("count"); // Type: Readable<number>
 * const doubled = useDerivation("doubled"); // Type: Readable<number>
 * ```
 */
export function createTypedHooks<M extends ModuleSchema>(): {
	useDerivation: <K extends keyof InferDerivations<M>>(
		derivationId: K,
	) => Readable<InferDerivations<M>[K]>;
	useFact: <K extends keyof InferFacts<M>>(factKey: K) => Readable<InferFacts<M>[K] | undefined>;
	useDispatch: () => (event: InferEvents<M>) => void;
	useSystem: () => System<M>;
} {
	return {
		useDerivation: <K extends keyof InferDerivations<M>>(derivationId: K) =>
			useDerivation<InferDerivations<M>[K]>(derivationId as string),
		useFact: <K extends keyof InferFacts<M>>(factKey: K) =>
			useFact<InferFacts<M>[K]>(factKey as string),
		useDispatch: () => {
			const system = getDirectiveContext<M>();
			return (event: InferEvents<M>) => {
				system.dispatch(event);
			};
		},
		useSystem: () => getDirectiveContext<M>(),
	};
}
