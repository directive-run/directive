/**
 * Svelte Adapter - Svelte stores for Directive
 *
 * Features:
 * - createDerivedStore for reactive derived value stores
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
import {
	type RequirementsState,
	type ThrottledHookOptions,
	computeRequirementsState,
	createThrottle,
} from "./shared.js";

// Re-export for convenience
export type { RequirementTypeStatus, RequirementsState, ThrottledHookOptions };

/** Type for the requirement status plugin return value */
type StatusPlugin = ReturnType<typeof createRequirementStatusPlugin>;

// ============================================================================
// Context
// ============================================================================

const DIRECTIVE_KEY = Symbol("directive");
const STATUS_PLUGIN_KEY = Symbol("directive-status");

/** Props for a Svelte DirectiveProvider component */
export interface DirectiveProviderProps<M extends ModuleSchema> {
	/** The Directive system instance */
	system: System<M>;
	/** Optional requirement status plugin for useRequirementStatus hooks */
	statusPlugin?: StatusPlugin;
}

/**
 * Set the Directive system in Svelte context.
 * Call this in a parent component to make the system available to children.
 *
 * **Recommended: Create a DirectiveProvider component**
 *
 * For consistency with other frameworks, create a wrapper component:
 *
 * @example DirectiveProvider.svelte
 * ```svelte
 * <script lang="ts">
 *   import { setDirectiveContext, type DirectiveProviderProps } from 'directive/svelte';
 *   import type { ModuleSchema } from 'directive';
 *
 *   type $$Props = DirectiveProviderProps<ModuleSchema> & { children?: any };
 *
 *   export let system;
 *   export let statusPlugin = undefined;
 *
 *   setDirectiveContext(system, statusPlugin);
 * </script>
 *
 * <slot />
 * ```
 *
 * @example Usage
 * ```svelte
 * <script>
 *   import DirectiveProvider from './DirectiveProvider.svelte';
 *   import { createSystem } from 'directive';
 *
 *   const system = createSystem({ module: myModule });
 *   system.start();
 * </script>
 *
 * <DirectiveProvider {system}>
 *   <MyApp />
 * </DirectiveProvider>
 * ```
 *
 * @example Direct usage (without wrapper component)
 * ```svelte
 * <script>
 *   import { setDirectiveContext } from 'directive/svelte';
 *   import { createSystem } from 'directive';
 *
 *   const system = createSystem({ module: myModule });
 *   system.start();
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
 *   import { getDirectiveContext, createDerivedStore } from 'directive/svelte';
 *
 *   const system = getDirectiveContext();
 *   const isRed = createDerivedStore(system, 'isRed');
 * </script>
 *
 * <div>{$isRed ? 'Red' : 'Not Red'}</div>
 * ```
 */
export function createDerivedStore<T>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	derivationId: string,
): Readable<T> {
	// Dev warning for invalid derivation IDs
	if (process.env.NODE_ENV !== "production") {
		const initialValue = system.read(derivationId);
		if (initialValue === undefined) {
			console.warn(
				`[Directive] createDerivedStore("${derivationId}") returned undefined. ` +
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
 *   import { getDirectiveContext, createDerivedsStore } from 'directive/svelte';
 *
 *   const system = getDirectiveContext();
 *   const state = createDerivedsStore(system, ['isRed', 'elapsed']);
 * </script>
 *
 * <div>{$state.isRed ? `Red for ${$state.elapsed}s` : 'Not Red'}</div>
 * ```
 */
export function createDerivedsStore<T extends Record<string, unknown>>(
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
 * Shorthand for getDirectiveContext() + createDerivedStore().
 *
 * @example
 * ```svelte
 * <script>
 *   import { useDerived } from 'directive/svelte';
 *
 *   const isRed = useDerived('isRed');
 * </script>
 *
 * <div>{$isRed ? 'Red' : 'Not Red'}</div>
 * ```
 */
export function useDerived<T>(derivationId: string): Readable<T> {
	const system = getDirectiveContext();
	return createDerivedStore<T>(system, derivationId);
}

/**
 * Get multiple derived values store using context.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useDeriveds } from 'directive/svelte';
 *
 *   const state = useDeriveds(['isRed', 'elapsed']);
 * </script>
 *
 * <div>{$state.isRed ? `Red for ${$state.elapsed}s` : 'Not Red'}</div>
 * ```
 */
export function useDeriveds<T extends Record<string, unknown>>(
	derivationIds: string[],
): Readable<T> {
	const system = getDirectiveContext();
	return createDerivedsStore<T>(system, derivationIds);
}

/**
 * Get direct access to facts for mutations.
 *
 * WARNING: The returned facts object is NOT reactive. Use this for event handlers
 * and imperative code, not for rendering. Use `useDerived` or `useFact` for reactive values.
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
 * @returns A dispatch function typed to the system's event schema
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
export function useDispatch<M extends ModuleSchema = ModuleSchema>(): (
	event: InferEvents<M>,
) => void {
	const system = getDirectiveContext<M>();
	return (event: InferEvents<M>) => {
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

/**
 * Get system inspection data with throttled updates.
 *
 * Use this instead of useInspect when updates are too frequent.
 *
 * @param options - Throttling options
 * @returns Readable store with the current system inspection
 *
 * @example
 * ```svelte
 * <script>
 *   import { useInspectThrottled } from 'directive/svelte';
 *
 *   const inspection = useInspectThrottled({ throttleMs: 200 });
 * </script>
 * ```
 */
export function useInspectThrottled(
	options: ThrottledHookOptions = {},
): Readable<SystemInspection> {
	const { throttleMs = 100 } = options;
	const system = getDirectiveContext();

	return readable<SystemInspection>(system.inspect(), (set) => {
		const { throttled, cleanup } = createThrottle(() => {
			set(system.inspect());
		}, throttleMs);

		const unsubscribe = system.facts.$store.subscribeAll(throttled);

		return () => {
			cleanup();
			unsubscribe();
		};
	});
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

	return readable<RequirementsState>(
		computeRequirementsState(system.inspect()),
		(set) => {
			const unsubscribe = system.facts.$store.subscribeAll(() => {
				set(computeRequirementsState(system.inspect()));
			});
			return unsubscribe;
		},
	);
}

/**
 * Get current requirements state with throttled updates.
 *
 * Use this instead of useRequirements when updates are too frequent.
 *
 * @param options - Throttling options
 * @returns Readable store with the current requirements state
 *
 * @example
 * ```svelte
 * <script>
 *   import { useRequirementsThrottled } from 'directive/svelte';
 *
 *   const requirements = useRequirementsThrottled({ throttleMs: 200 });
 * </script>
 * ```
 */
export function useRequirementsThrottled(
	options: ThrottledHookOptions = {},
): Readable<RequirementsState> {
	const { throttleMs = 100 } = options;
	const system = getDirectiveContext();

	return readable<RequirementsState>(
		computeRequirementsState(system.inspect()),
		(set) => {
			const { throttled, cleanup } = createThrottle(() => {
				set(computeRequirementsState(system.inspect()));
			}, throttleMs);

			const unsubscribe = system.facts.$store.subscribeAll(throttled);

			return () => {
				cleanup();
				unsubscribe();
			};
		},
	);
}

/**
 * Check if the system has settled (no pending operations) as a readable store.
 *
 * @returns Readable store with boolean indicating whether the system is settled
 *
 * @example
 * ```svelte
 * <script>
 *   import { useIsSettled } from 'directive/svelte';
 *
 *   const isSettled = useIsSettled();
 * </script>
 *
 * {#if !$isSettled}
 *   <Spinner />
 * {:else}
 *   <Content />
 * {/if}
 * ```
 */
export function useIsSettled(): Readable<boolean> {
	const system = getDirectiveContext();

	return readable<boolean>(system.isSettled, (set) => {
		const unsubscribe = system.facts.$store.subscribeAll(() => {
			set(system.isSettled);
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
 * Check if a requirement type is currently being resolved.
 *
 * Simplified version of useRequirementStatus that returns only the resolving state.
 * Requires a statusPlugin to be passed to setDirectiveContext().
 *
 * @param type - The requirement type to check
 * @returns Readable store with boolean indicating if the type is being resolved
 *
 * @example
 * ```svelte
 * <script>
 *   import { useIsResolving } from 'directive/svelte';
 *
 *   const isSaving = useIsResolving('SAVE_DATA');
 * </script>
 *
 * <button disabled={$isSaving}>{$isSaving ? 'Saving...' : 'Save'}</button>
 * ```
 */
export function useIsResolving(type: string): Readable<boolean> {
	const statusPlugin = getContext<StatusPlugin | null>(STATUS_PLUGIN_KEY);
	if (!statusPlugin) {
		throw new Error(
			"[Directive] useIsResolving requires a statusPlugin. " +
				"Pass statusPlugin to setDirectiveContext().",
		);
	}

	return readable<boolean>(statusPlugin.getStatus(type).inflight > 0, (set) => {
		const unsubscribe = statusPlugin.subscribe(() => {
			set(statusPlugin.getStatus(type).inflight > 0);
		});
		return unsubscribe;
	});
}

/**
 * Get the last error for a requirement type.
 *
 * Simplified version of useRequirementStatus that returns only the error.
 * Requires a statusPlugin to be passed to setDirectiveContext().
 *
 * @param type - The requirement type to get error for
 * @returns Readable store with the last error, or null if no error
 *
 * @example
 * ```svelte
 * <script>
 *   import { useLatestError } from 'directive/svelte';
 *
 *   const error = useLatestError('FETCH_USER');
 * </script>
 *
 * {#if $error}
 *   <div class="error">{$error.message}</div>
 * {/if}
 * ```
 */
export function useLatestError(type: string): Readable<Error | null> {
	const statusPlugin = getContext<StatusPlugin | null>(STATUS_PLUGIN_KEY);
	if (!statusPlugin) {
		throw new Error(
			"[Directive] useLatestError requires a statusPlugin. " +
				"Pass statusPlugin to setDirectiveContext().",
		);
	}

	return readable<Error | null>(statusPlugin.getStatus(type).lastError, (set) => {
		const unsubscribe = statusPlugin.subscribe(() => {
			set(statusPlugin.getStatus(type).lastError);
		});
		return unsubscribe;
	});
}

/**
 * Get status for all tracked requirement types.
 *
 * Returns a readable store containing a Map of all requirement types that have
 * been tracked, with their current status. Useful for dashboard/admin UIs.
 *
 * Requires a statusPlugin to be passed to setDirectiveContext().
 *
 * @returns Readable store with Map of requirement type to status
 *
 * @example
 * ```svelte
 * <script>
 *   import { useRequirementStatuses } from 'directive/svelte';
 *
 *   const allStatuses = useRequirementStatuses();
 * </script>
 *
 * <ul>
 *   {#each [...$allStatuses] as [type, status]}
 *     <li>{type}: {status.isLoading ? 'Loading' : status.hasError ? 'Error' : 'Ready'}</li>
 *   {/each}
 * </ul>
 * ```
 */
export function useRequirementStatuses(): Readable<Map<string, RequirementTypeStatus>> {
	const statusPlugin = getContext<StatusPlugin | null>(STATUS_PLUGIN_KEY);
	if (!statusPlugin) {
		throw new Error(
			"[Directive] useRequirementStatuses requires a statusPlugin. " +
				"Pass statusPlugin to setDirectiveContext().",
		);
	}

	return readable<Map<string, RequirementTypeStatus>>(statusPlugin.getAllStatus(), (set) => {
		const unsubscribe = statusPlugin.subscribe(() => {
			set(statusPlugin.getAllStatus());
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

// Track options we've warned about to avoid duplicate warnings
const warnedOptions = new WeakSet<object>();

/**
 * Create a scoped Directive system with automatic lifecycle management.
 * The system is automatically started and destroyed when component unmounts.
 *
 * **IMPORTANT: Stability Requirements**
 *
 * The `options` parameter must be a stable reference (defined outside the component
 * or memoized) for the system to persist across re-renders. If you pass an inline
 * object, a new system will be created on each reactive update.
 *
 * @param options - Either a single module or full system options (must be stable reference)
 * @returns The system instance
 *
 * @see {@link useDerived} for reading derived values
 * @see {@link useFacts} for direct fact access
 *
 * @example
 * ```svelte
 * <script>
 *   import { createDirective, setDirectiveContext } from 'directive/svelte';
 *
 *   // CORRECT: Define module outside component for stable reference
 *   import { counterModule } from './counterModule';
 *
 *   const system = createDirective(counterModule);
 *   setDirectiveContext(system); // Make available to children
 *
 *   // INCORRECT: Inline options will create new system on each render
 *   // const system = createDirective({ module: counterModule }); // Don't do this!
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

	// Dev warning for unstable options (new object not seen before in this session)
	if (process.env.NODE_ENV !== "production") {
		if (!warnedOptions.has(options as object)) {
			warnedOptions.add(options as object);
			// Only warn if this looks like it might be an inline object (not a module)
			const isInlineOptions = !("id" in options && "schema" in options);
			if (isInlineOptions) {
				console.warn(
					"[Directive] createDirective received options that may not be stable. " +
						"If you see this warning repeatedly, ensure your options object is defined " +
						"outside the component or memoized. Inline options create a new system on each render.",
				);
			}
		}
	}

	// Check if options is a module or system options
	const isModule = "id" in options && "schema" in options;

	const system = isModule
		? createSystem({ module: options as ModuleDef<M> })
		: createSystem(options as CreateSystemOptionsSingle<M>);

	// Cache the system
	// biome-ignore lint/suspicious/noExplicitAny: Cache needs to work with any schema
	systemCache.set(options as object, system as unknown as System<any>);

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
// Selector Hooks (like XState's useSelector)
// ============================================================================

/** Default equality function for selectors (uses Object.is for consistency with React) */
function defaultEquality<T>(a: T, b: T): boolean {
	return Object.is(a, b);
}

/**
 * Subscribe to a fact with a selector function.
 *
 * This allows fine-grained subscriptions - the component only re-renders when
 * the selected value changes (according to the equality function).
 *
 * @param factKey - The fact key to subscribe to
 * @param selector - Function to transform the fact value
 * @param equalityFn - Optional equality function (default: ===)
 * @returns Readable store with the selected value
 *
 * @example
 * ```svelte
 * <script>
 *   import { useFactSelector } from 'directive/svelte';
 *
 *   // Only re-render when user's name changes, not other user properties
 *   const userName = useFactSelector('user', (u) => u?.name ?? 'Guest');
 * </script>
 *
 * <span>{$userName}</span>
 * ```
 */
export function useFactSelector<T, R>(
	factKey: string,
	selector: (value: T | undefined) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Readable<R> {
	const system = getDirectiveContext();
	const initialValue = system.facts.$store.get(factKey) as T | undefined;

	return readable<R>(selector(initialValue), (set) => {
		let currentSelected = selector(initialValue);
		const unsubscribe = system.facts.$store.subscribe([factKey], () => {
			const newValue = system.facts.$store.get(factKey) as T | undefined;
			const newSelected = selector(newValue);
			if (!equalityFn(currentSelected, newSelected)) {
				currentSelected = newSelected;
				set(newSelected);
			}
		});
		return unsubscribe;
	});
}

/**
 * Subscribe to a derivation with a selector function.
 *
 * This allows fine-grained subscriptions - the component only re-renders when
 * the selected value changes (according to the equality function).
 *
 * @param derivationId - The derivation ID to subscribe to
 * @param selector - Function to transform the derivation value
 * @param equalityFn - Optional equality function (default: ===)
 * @returns Readable store with the selected value
 *
 * @example
 * ```svelte
 * <script>
 *   import { useDerivedSelector } from 'directive/svelte';
 *
 *   // Only re-render when status text changes
 *   const statusText = useDerivedSelector('status', (s) => s?.label ?? 'Unknown');
 * </script>
 *
 * <span>{$statusText}</span>
 * ```
 */
export function useDerivedSelector<T, R>(
	derivationId: string,
	selector: (value: T) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Readable<R> {
	const system = getDirectiveContext();
	const initialValue = system.read(derivationId) as T;

	return readable<R>(selector(initialValue), (set) => {
		let currentSelected = selector(initialValue);
		const unsubscribe = system.subscribe([derivationId], () => {
			const newValue = system.read(derivationId) as T;
			const newSelected = selector(newValue);
			if (!equalityFn(currentSelected, newSelected)) {
				currentSelected = newSelected;
				set(newSelected);
			}
		});
		return unsubscribe;
	});
}

/**
 * Subscribe to all facts with a selector function.
 *
 * This allows selecting derived values across multiple facts with fine-grained
 * re-rendering control.
 *
 * @param selector - Function that receives all facts and returns selected value
 * @param equalityFn - Optional equality function (default: ===)
 * @returns Readable store with the selected value
 *
 * @example
 * ```svelte
 * <script>
 *   import { useSelector } from 'directive/svelte';
 *
 *   // Select derived state from multiple facts
 *   const summary = useSelector((facts) => ({
 *     count: facts.items?.length ?? 0,
 *     isLoading: facts.loading ?? false,
 *   }), (a, b) => a.count === b.count && a.isLoading === b.isLoading);
 * </script>
 *
 * <div>{$summary.count} items</div>
 * ```
 */
export function useSelector<R>(
	selector: (facts: Record<string, unknown>) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Readable<R> {
	const system = getDirectiveContext();

	const getFacts = (): Record<string, unknown> => {
		return system.facts.$store.toObject();
	};

	const initialSelected = selector(getFacts());

	return readable<R>(initialSelected, (set) => {
		let currentSelected = initialSelected;
		const unsubscribe = system.facts.$store.subscribeAll(() => {
			const newSelected = selector(getFacts());
			if (!equalityFn(currentSelected, newSelected)) {
				currentSelected = newSelected;
				set(newSelected);
			}
		});
		return unsubscribe;
	});
}

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
 * const { useDerived, useFact, useDispatch } = createTypedHooks<typeof schema>();
 *
 * // In your component:
 * const count = useFact("count"); // Type: Readable<number>
 * const doubled = useDerived("doubled"); // Type: Readable<number>
 * ```
 */
export function createTypedHooks<M extends ModuleSchema>(): {
	useDerived: <K extends keyof InferDerivations<M>>(
		derivationId: K,
	) => Readable<InferDerivations<M>[K]>;
	useFact: <K extends keyof InferFacts<M>>(factKey: K) => Readable<InferFacts<M>[K] | undefined>;
	useDispatch: () => (event: InferEvents<M>) => void;
	useSystem: () => System<M>;
} {
	return {
		useDerived: <K extends keyof InferDerivations<M>>(derivationId: K) =>
			useDerived<InferDerivations<M>[K]>(derivationId as string),
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
