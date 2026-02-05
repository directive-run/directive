/**
 * Solid Adapter - SolidJS primitives for Directive
 *
 * Features:
 * - createDerivationSignal for reactive derived values
 * - createFactSignal for reactive fact values
 * - Context provider for system
 * - useRequirementStatus for loading/error states
 * - createTypedHooks for schema-specific hooks
 */

import {
	createContext,
	useContext,
	createSignal,
	onCleanup,
	type Accessor,
	type JSX,
} from "solid-js";
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

// biome-ignore lint/suspicious/noExplicitAny: Context needs to work with any schema
const DirectiveContext = createContext<System<any>>();

/** Context for the requirement status plugin */
const StatusPluginContext = createContext<StatusPlugin | null>();

/**
 * Props for DirectiveProvider
 */
export interface DirectiveProviderProps<M extends ModuleSchema> {
	system: System<M>;
	children: JSX.Element;
	/** Optional requirement status plugin for useRequirementStatus hook */
	statusPlugin?: StatusPlugin;
}

/**
 * Provider component for Directive system.
 *
 * @example
 * ```tsx
 * import { DirectiveProvider } from 'directive/solid';
 *
 * const system = createSystem({ modules: [myModule] });
 *
 * function App() {
 *   return (
 *     <DirectiveProvider system={system}>
 *       <MyComponent />
 *     </DirectiveProvider>
 *   );
 * }
 * ```
 */
export function DirectiveProvider<M extends ModuleSchema>(
	props: DirectiveProviderProps<M>,
): JSX.Element {
	// Use the Provider property directly to avoid JSX compilation issues
	return DirectiveContext.Provider({
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		value: props.system as System<any>,
		children: StatusPluginContext.Provider({
			value: props.statusPlugin ?? null,
			children: props.children,
		}),
	});
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get the Directive system from context.
 *
 * @throws If used outside of DirectiveProvider
 */
export function useSystem<M extends ModuleSchema = ModuleSchema>(): System<M> {
	const system = useContext(DirectiveContext);
	if (!system) {
		throw new Error(
			"[Directive] useSystem must be used within a DirectiveProvider. " +
				"Wrap your component tree with <DirectiveProvider system={system}>.",
		);
	}
	return system as System<M>;
}

/**
 * Subscribe to a derived value as a signal.
 *
 * @example
 * ```tsx
 * import { useDerivation } from 'directive/solid';
 *
 * function StatusDisplay() {
 *   const isRed = useDerivation<boolean>('isRed');
 *   return <div>{isRed() ? 'Red' : 'Not Red'}</div>;
 * }
 * ```
 */
export function useDerivation<T>(derivationId: string): Accessor<T> {
	const system = useSystem();

	// Dev warning for invalid derivation IDs
	if (process.env.NODE_ENV !== "production") {
		const initialValue = system.read(derivationId);
		if (initialValue === undefined) {
			console.warn(
				`[Directive] useDerivation("${derivationId}") returned undefined. ` +
					`Check that "${derivationId}" is defined in your module's derive property.`,
			);
		}
	}

	const [value, setValue] = createSignal<T>(system.read(derivationId) as T);

	const unsubscribe = system.subscribe([derivationId], () => {
		setValue(() => system.read(derivationId) as T);
	});

	onCleanup(unsubscribe);

	return value;
}

/**
 * Subscribe to multiple derived values as a signal.
 *
 * @example
 * ```tsx
 * import { useDerivations } from 'directive/solid';
 *
 * function StatusDisplay() {
 *   const state = useDerivations<{ isRed: boolean; elapsed: number }>(['isRed', 'elapsed']);
 *   return <div>{state().isRed ? `Red for ${state().elapsed}s` : 'Not Red'}</div>;
 * }
 * ```
 */
export function useDerivations<T extends Record<string, unknown>>(
	derivationIds: string[],
): Accessor<T> {
	const system = useSystem();

	const getValues = (): T => {
		const result: Record<string, unknown> = {};
		for (const id of derivationIds) {
			result[id] = system.read(id);
		}
		return result as T;
	};

	const [state, setState] = createSignal<T>(getValues());

	const unsubscribe = system.subscribe(derivationIds, () => {
		setState(getValues);
	});

	onCleanup(unsubscribe);

	return state;
}

/**
 * Get direct access to facts for mutations.
 *
 * WARNING: The returned facts object is NOT reactive. Use this for event handlers,
 * not for rendering. Use `useDerivation` for reactive values.
 *
 * @example
 * ```tsx
 * import { useFacts } from 'directive/solid';
 *
 * function Controls() {
 *   const facts = useFacts();
 *
 *   function increment() {
 *     facts.count = (facts.count ?? 0) + 1;
 *   }
 *
 *   return <button onClick={increment}>Increment</button>;
 * }
 * ```
 */
export function useFacts<M extends ModuleSchema>(): System<M>["facts"] {
	const system = useSystem<M>();
	return system.facts;
}

/**
 * Subscribe to a single fact value as a signal.
 *
 * @example
 * ```tsx
 * import { useFact } from 'directive/solid';
 *
 * function PhaseDisplay() {
 *   const phase = useFact<string>('phase');
 *   return <div>Current phase: {phase()}</div>;
 * }
 * ```
 */
export function useFact<T>(factKey: string): Accessor<T | undefined> {
	const system = useSystem();
	const [value, setValue] = createSignal<T | undefined>(
		system.facts.$store.get(factKey) as T | undefined,
	);

	const unsubscribe = system.facts.$store.subscribe([factKey], () => {
		setValue(() => system.facts.$store.get(factKey) as T | undefined);
	});

	onCleanup(unsubscribe);

	return value;
}

/**
 * Get a dispatch function for sending events.
 *
 * @returns A dispatch function typed to the system's event schema
 *
 * @example
 * ```tsx
 * import { useDispatch } from 'directive/solid';
 *
 * function Controls() {
 *   const dispatch = useDispatch();
 *   return <button onClick={() => dispatch({ type: 'tick' })}>Tick</button>;
 * }
 * ```
 */
export function useDispatch<M extends ModuleSchema = ModuleSchema>(): (
	event: InferEvents<M>,
) => void {
	const system = useSystem<M>();
	return (event: InferEvents<M>) => {
		system.dispatch(event);
	};
}

/**
 * Get system inspection data as a signal.
 *
 * NOTE: This updates on every fact change. Use sparingly in production.
 *
 * @example
 * ```tsx
 * import { useInspect } from 'directive/solid';
 *
 * function Inspector() {
 *   const inspection = useInspect();
 *   return <div>Unmet: {inspection().unmet.length}</div>;
 * }
 * ```
 */
export function useInspect(): Accessor<SystemInspection> {
	const system = useSystem();
	const [inspection, setInspection] = createSignal<SystemInspection>(
		system.inspect(),
	);

	const unsubscribe = system.facts.$store.subscribeAll(() => {
		setInspection(system.inspect());
	});

	onCleanup(unsubscribe);

	return inspection;
}

/**
 * Get system inspection data with throttled updates.
 *
 * Use this instead of useInspect when updates are too frequent.
 *
 * @param options - Throttling options
 * @returns Accessor with the current system inspection
 *
 * @example
 * ```tsx
 * import { useInspectThrottled } from 'directive/solid';
 *
 * function Inspector() {
 *   const inspection = useInspectThrottled({ throttleMs: 200 });
 *   return <div>Unmet: {inspection().unmet.length}</div>;
 * }
 * ```
 */
export function useInspectThrottled(
	options: ThrottledHookOptions = {},
): Accessor<SystemInspection> {
	const { throttleMs = 100 } = options;
	const system = useSystem();
	const [inspection, setInspection] = createSignal<SystemInspection>(
		system.inspect(),
	);

	const { throttled, cleanup } = createThrottle(() => {
		setInspection(system.inspect());
	}, throttleMs);

	const unsubscribe = system.facts.$store.subscribeAll(throttled);

	onCleanup(() => {
		cleanup();
		unsubscribe();
	});

	return inspection;
}

/**
 * Get current requirements state as a signal.
 *
 * Provides a focused view of just requirements without full inspection overhead.
 *
 * @returns Accessor with the current requirements state
 *
 * @example
 * ```tsx
 * import { useRequirements } from 'directive/solid';
 *
 * function LoadingIndicator() {
 *   const requirements = useRequirements();
 *   return (
 *     <Show when={requirements().isWorking}>
 *       <Spinner />
 *     </Show>
 *   );
 * }
 * ```
 */
export function useRequirements(): Accessor<RequirementsState> {
	const system = useSystem();

	const [state, setState] = createSignal<RequirementsState>(
		computeRequirementsState(system.inspect()),
	);

	const unsubscribe = system.facts.$store.subscribeAll(() => {
		setState(computeRequirementsState(system.inspect()));
	});

	onCleanup(unsubscribe);

	return state;
}

/**
 * Get current requirements state with throttled updates.
 *
 * Use this instead of useRequirements when updates are too frequent.
 *
 * @param options - Throttling options
 * @returns Accessor with the current requirements state
 *
 * @example
 * ```tsx
 * import { useRequirementsThrottled } from 'directive/solid';
 *
 * function LoadingIndicator() {
 *   const requirements = useRequirementsThrottled({ throttleMs: 200 });
 *   return (
 *     <Show when={requirements().isWorking}>
 *       <Spinner />
 *     </Show>
 *   );
 * }
 * ```
 */
export function useRequirementsThrottled(
	options: ThrottledHookOptions = {},
): Accessor<RequirementsState> {
	const { throttleMs = 100 } = options;
	const system = useSystem();

	const [state, setState] = createSignal<RequirementsState>(
		computeRequirementsState(system.inspect()),
	);

	const { throttled, cleanup } = createThrottle(() => {
		setState(computeRequirementsState(system.inspect()));
	}, throttleMs);

	const unsubscribe = system.facts.$store.subscribeAll(throttled);

	onCleanup(() => {
		cleanup();
		unsubscribe();
	});

	return state;
}

/**
 * Check if the system has settled (no pending operations) as a signal.
 *
 * @returns Accessor with boolean indicating whether the system is settled
 *
 * @example
 * ```tsx
 * import { useIsSettled } from 'directive/solid';
 *
 * function LoadingIndicator() {
 *   const isSettled = useIsSettled();
 *   return (
 *     <Show when={!isSettled()}>
 *       <Spinner />
 *     </Show>
 *   );
 * }
 * ```
 */
export function useIsSettled(): Accessor<boolean> {
	const system = useSystem();
	const [isSettled, setIsSettled] = createSignal(system.isSettled);

	const unsubscribe = system.facts.$store.subscribeAll(() => {
		setIsSettled(system.isSettled);
	});

	onCleanup(unsubscribe);

	return isSettled;
}

/**
 * Get requirement status as a signal.
 *
 * Requires a statusPlugin to be passed to DirectiveProvider.
 *
 * @param type - The requirement type to get status for
 * @returns Accessor with the current status
 *
 * @example
 * ```tsx
 * import { useRequirementStatus } from 'directive/solid';
 *
 * function UserLoader() {
 *   const status = useRequirementStatus('FETCH_USER');
 *   return (
 *     <Show when={!status().isLoading} fallback={<Spinner />}>
 *       <Show when={!status().hasError} fallback={<Error message={status().lastError?.message} />}>
 *         <UserContent />
 *       </Show>
 *     </Show>
 *   );
 * }
 * ```
 */
export function useRequirementStatus(type: string): Accessor<RequirementTypeStatus> {
	const statusPlugin = useContext(StatusPluginContext);
	if (!statusPlugin) {
		throw new Error(
			"[Directive] useRequirementStatus requires a statusPlugin. " +
				"Pass statusPlugin to <DirectiveProvider statusPlugin={statusPlugin}>.",
		);
	}

	const [status, setStatus] = createSignal<RequirementTypeStatus>(
		statusPlugin.getStatus(type),
	);

	const unsubscribe = statusPlugin.subscribe(() => {
		setStatus(statusPlugin.getStatus(type));
	});

	onCleanup(unsubscribe);

	return status;
}

/**
 * Check if a requirement type is currently being resolved.
 *
 * Simplified version of useRequirementStatus that returns only the resolving state.
 * Requires a statusPlugin to be passed to DirectiveProvider.
 *
 * @param type - The requirement type to check
 * @returns Accessor with boolean indicating if the type is being resolved
 *
 * @example
 * ```tsx
 * import { useIsResolving } from 'directive/solid';
 *
 * function SaveButton() {
 *   const isSaving = useIsResolving('SAVE_DATA');
 *   return (
 *     <button disabled={isSaving()}>
 *       {isSaving() ? 'Saving...' : 'Save'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useIsResolving(type: string): Accessor<boolean> {
	const status = useRequirementStatus(type);
	return () => status().inflight > 0;
}

/**
 * Get the last error for a requirement type.
 *
 * Simplified version of useRequirementStatus that returns only the error.
 * Requires a statusPlugin to be passed to DirectiveProvider.
 *
 * @param type - The requirement type to get error for
 * @returns Accessor with the last error, or null if no error
 *
 * @example
 * ```tsx
 * import { useLatestError } from 'directive/solid';
 *
 * function ErrorDisplay() {
 *   const error = useLatestError('FETCH_USER');
 *   return (
 *     <Show when={error()}>
 *       <div class="error">{error()?.message}</div>
 *     </Show>
 *   );
 * }
 * ```
 */
export function useLatestError(type: string): Accessor<Error | null> {
	const status = useRequirementStatus(type);
	return () => status().lastError;
}

/**
 * Get status for all tracked requirement types.
 *
 * Returns an accessor containing a Map of all requirement types that have
 * been tracked, with their current status. Useful for dashboard/admin UIs.
 *
 * Requires a statusPlugin to be passed to DirectiveProvider.
 *
 * @returns Accessor with Map of requirement type to status
 *
 * @example
 * ```tsx
 * import { useAllRequirementStatuses } from 'directive/solid';
 *
 * function RequirementsDashboard() {
 *   const allStatuses = useAllRequirementStatuses();
 *
 *   return (
 *     <ul>
 *       <For each={Array.from(allStatuses().entries())}>
 *         {([type, status]) => (
 *           <li>{type}: {status.isLoading ? 'Loading' : status.hasError ? 'Error' : 'Ready'}</li>
 *         )}
 *       </For>
 *     </ul>
 *   );
 * }
 * ```
 */
export function useAllRequirementStatuses(): Accessor<Map<string, RequirementTypeStatus>> {
	const statusPlugin = useContext(StatusPluginContext);
	if (!statusPlugin) {
		throw new Error(
			"[Directive] useAllRequirementStatuses requires a statusPlugin. " +
				"Pass statusPlugin to DirectiveProvider.",
		);
	}

	const [allStatuses, setAllStatuses] = createSignal<Map<string, RequirementTypeStatus>>(
		statusPlugin.getAllStatus(),
	);

	const unsubscribe = statusPlugin.subscribe(() => {
		setAllStatuses(statusPlugin.getAllStatus());
	});

	onCleanup(unsubscribe);

	return allStatuses;
}

/**
 * Get time-travel debug API (if enabled).
 */
export function useTimeTravel() {
	const system = useSystem();
	return system.debug;
}

/**
 * Watch a derivation and call a callback when its value changes.
 * Automatically cleans up on component unmount.
 *
 * @example
 * ```tsx
 * import { useWatch } from 'directive/solid';
 *
 * function PhaseWatcher() {
 *   useWatch<string>('phase', (newPhase, oldPhase) => {
 *     console.log(`Phase changed from ${oldPhase} to ${newPhase}`);
 *   });
 *
 *   return <div>Watching phase changes...</div>;
 * }
 * ```
 */
export function useWatch<T>(
	derivationId: string,
	callback: (newValue: T, previousValue: T | undefined) => void,
): void {
	const system = useSystem();
	const unsubscribe = system.watch<T>(derivationId, callback);
	onCleanup(unsubscribe);
}

// ============================================================================
// Signal Factories (for use outside components)
// ============================================================================

/**
 * Create a derivation signal outside of a component.
 * Useful for stores or other reactive contexts.
 *
 * @example
 * ```ts
 * import { createDerivationSignal } from 'directive/solid';
 *
 * const system = createSystem({ modules: [myModule] });
 * const [isRed, cleanup] = createDerivationSignal(system, 'isRed');
 *
 * // Later, when done:
 * cleanup();
 * ```
 */
export function createDerivationSignal<T>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	derivationId: string,
): [Accessor<T>, () => void] {
	const [value, setValue] = createSignal<T>(system.read(derivationId) as T);

	const unsubscribe = system.subscribe([derivationId], () => {
		setValue(() => system.read(derivationId) as T);
	});

	return [value, unsubscribe];
}

/**
 * Create a fact signal outside of a component.
 *
 * @example
 * ```ts
 * import { createFactSignal } from 'directive/solid';
 *
 * const system = createSystem({ modules: [myModule] });
 * const [phase, cleanup] = createFactSignal(system, 'phase');
 *
 * // Later, when done:
 * cleanup();
 * ```
 */
export function createFactSignal<T>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	factKey: string,
): [Accessor<T | undefined>, () => void] {
	const [value, setValue] = createSignal<T | undefined>(
		system.facts.$store.get(factKey) as T | undefined,
	);

	const unsubscribe = system.facts.$store.subscribe([factKey], () => {
		setValue(() => system.facts.$store.get(factKey) as T | undefined);
	});

	return [value, unsubscribe];
}

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
 * The system is automatically started and cleaned up when the reactive scope ends.
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
 * @see {@link useDerivation} for reading derived values
 * @see {@link useFacts} for direct fact access
 *
 * @example
 * ```tsx
 * import { createDirective, DirectiveProvider } from 'directive/solid';
 *
 * // CORRECT: Define module outside component for stable reference
 * import { counterModule } from './counterModule';
 *
 * function Counter() {
 *   const system = createDirective(counterModule);
 *   return (
 *     <DirectiveProvider system={system}>
 *       <CounterDisplay />
 *     </DirectiveProvider>
 *   );
 * }
 *
 * // INCORRECT: Inline options will create new system on each render
 * // const system = createDirective({ module: counterModule }); // Don't do this!
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
	systemCache.set(options as object, system as System<any>);

	system.start();

	onCleanup(() => {
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
 * @returns Accessor with the selected value
 *
 * @example
 * ```tsx
 * import { useFactSelector } from 'directive/solid';
 *
 * function UserName() {
 *   // Only re-render when user's name changes, not other user properties
 *   const userName = useFactSelector('user', (u) => u?.name ?? 'Guest');
 *   return <span>{userName()}</span>;
 * }
 * ```
 */
export function useFactSelector<T, R>(
	factKey: string,
	selector: (value: T | undefined) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Accessor<R> {
	const system = useSystem();
	const initialValue = system.facts.$store.get(factKey) as T | undefined;
	const [selected, setSelected] = createSignal<R>(selector(initialValue));

	const unsubscribe = system.facts.$store.subscribe([factKey], () => {
		const newValue = system.facts.$store.get(factKey) as T | undefined;
		const newSelected = selector(newValue);
		setSelected((prev) => {
			if (!equalityFn(prev, newSelected)) {
				return newSelected;
			}
			return prev;
		});
	});

	onCleanup(unsubscribe);

	return selected;
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
 * @returns Accessor with the selected value
 *
 * @example
 * ```tsx
 * import { useDerivationSelector } from 'directive/solid';
 *
 * function StatusLabel() {
 *   // Only re-render when status text changes
 *   const statusText = useDerivationSelector('status', (s) => s?.label ?? 'Unknown');
 *   return <span>{statusText()}</span>;
 * }
 * ```
 */
export function useDerivationSelector<T, R>(
	derivationId: string,
	selector: (value: T) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Accessor<R> {
	const system = useSystem();
	const initialValue = system.read(derivationId) as T;
	const [selected, setSelected] = createSignal<R>(selector(initialValue));

	const unsubscribe = system.subscribe([derivationId], () => {
		const newValue = system.read(derivationId) as T;
		const newSelected = selector(newValue);
		setSelected((prev) => {
			if (!equalityFn(prev, newSelected)) {
				return newSelected;
			}
			return prev;
		});
	});

	onCleanup(unsubscribe);

	return selected;
}

/**
 * Subscribe to all facts with a selector function.
 *
 * This allows selecting derived values across multiple facts with fine-grained
 * re-rendering control.
 *
 * @param selector - Function that receives all facts and returns selected value
 * @param equalityFn - Optional equality function (default: ===)
 * @returns Accessor with the selected value
 *
 * @example
 * ```tsx
 * import { useDirectiveSelector } from 'directive/solid';
 *
 * function Summary() {
 *   // Select derived state from multiple facts
 *   const summary = useDirectiveSelector((facts) => ({
 *     count: facts.items?.length ?? 0,
 *     isLoading: facts.loading ?? false,
 *   }), (a, b) => a.count === b.count && a.isLoading === b.isLoading);
 *
 *   return <div>{summary().count} items, loading: {summary().isLoading}</div>;
 * }
 * ```
 */
export function useDirectiveSelector<R>(
	selector: (facts: Record<string, unknown>) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Accessor<R> {
	const system = useSystem();

	const getFacts = (): Record<string, unknown> => {
		return system.facts.$store.toObject();
	};

	const [selected, setSelected] = createSignal<R>(selector(getFacts()));

	const unsubscribe = system.facts.$store.subscribeAll(() => {
		const newSelected = selector(getFacts());
		setSelected((prev) => {
			if (!equalityFn(prev, newSelected)) {
				return newSelected;
			}
			return prev;
		});
	});

	onCleanup(unsubscribe);

	return selected;
}

// ============================================================================
// Typed Hooks Factory
// ============================================================================

/**
 * Create typed hooks for a specific system schema.
 *
 * This provides better type inference than the generic hooks.
 *
 * @example
 * ```ts
 * import { createTypedHooks } from 'directive/solid';
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
 * function Counter() {
 *   const count = useFact("count"); // Type: Accessor<number>
 *   const doubled = useDerivation("doubled"); // Type: Accessor<number>
 * }
 * ```
 */
export function createTypedHooks<M extends ModuleSchema>(): {
	useDerivation: <K extends keyof InferDerivations<M>>(
		derivationId: K,
	) => Accessor<InferDerivations<M>[K]>;
	useFact: <K extends keyof InferFacts<M>>(factKey: K) => Accessor<InferFacts<M>[K] | undefined>;
	useDispatch: () => (event: InferEvents<M>) => void;
	useSystem: () => System<M>;
} {
	return {
		useDerivation: <K extends keyof InferDerivations<M>>(derivationId: K) =>
			useDerivation<InferDerivations<M>[K]>(derivationId as string),
		useFact: <K extends keyof InferFacts<M>>(factKey: K) =>
			useFact<InferFacts<M>[K]>(factKey as string),
		useDispatch: () => {
			const system = useSystem<M>();
			return (event: InferEvents<M>) => {
				system.dispatch(event);
			};
		},
		useSystem: () => useSystem<M>(),
	};
}
