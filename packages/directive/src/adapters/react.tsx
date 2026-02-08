/**
 * React Adapter - Hooks and Provider for React integration
 *
 * Provides type-safe React hooks for working with Directive systems.
 *
 * @example
 * ```tsx
 * import { DirectiveProvider, useDerived, useDispatch, useFact } from 'directive/react';
 *
 * function App() {
 *   return (
 *     <DirectiveProvider system={system}>
 *       <Counter />
 *     </DirectiveProvider>
 *   );
 * }
 *
 * function Counter() {
 *   const count = useFact("count");
 *   const doubled = useDerived("doubled");
 *   const dispatch = useDispatch();
 *
 *   return (
 *     <div>
 *       <p>Count: {count}</p>
 *       <p>Doubled: {doubled}</p>
 *       <button onClick={() => dispatch({ type: "increment" })}>+</button>
 *     </div>
 *   );
 * }
 * ```
 */

import {
	createContext,
	useContext,
	useSyncExternalStore,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type {
	System,
	ModuleSchema,
	ModuleDef,
	Plugin,
	InferFacts,
	InferDerivations,
	InferEvents,
} from "../core/types.js";
import { createSystem } from "../core/system.js";
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

/**
 * Options for selector hooks that support both an equality function and a system override.
 */
export type SelectorOptions<R> = {
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	system?: System<any>;
	equalityFn?: (a: R, b: R) => boolean;
};

// ============================================================================
// Context
// ============================================================================

/**
 * Internal context for the Directive system.
 */
// biome-ignore lint/suspicious/noExplicitAny: Context needs to work with any schema
const DirectiveContext = createContext<System<any> | null>(null);

/** Type for the requirement status plugin return value */
type StatusPlugin = ReturnType<typeof createRequirementStatusPlugin>;

/**
 * Internal context for the requirement status plugin.
 */
const StatusPluginContext = createContext<StatusPlugin | null>(null);

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Resolve the system to use: explicit override first, then context fallback.
 * @internal
 */
// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
function useResolvedSystem(override?: System<any>): System<any> {
	const contextSystem = useContext(DirectiveContext);
	const system = override ?? contextSystem;
	if (!system) {
		throw new Error(
			"[Directive] No system available. Wrap your component in <DirectiveProvider> " +
				"or pass a system to the hook.",
		);
	}
	return system;
}

/**
 * Resolve the status plugin to use: explicit override first, then context fallback.
 * @internal
 */
function useResolvedStatusPlugin(override?: StatusPlugin): StatusPlugin {
	const contextPlugin = useContext(StatusPluginContext);
	const plugin = override ?? contextPlugin;
	if (!plugin) {
		throw new Error(
			"[Directive] No statusPlugin available. Pass statusPlugin to <DirectiveProvider> " +
				"or pass it directly to the hook.",
		);
	}
	return plugin;
}

// ============================================================================
// Provider
// ============================================================================

/**
 * Props for DirectiveProvider
 */
export interface DirectiveProviderProps<M extends ModuleSchema> {
	/** The Directive system instance */
	system: System<M>;
	/** Child components */
	children: ReactNode;
	/** Optional requirement status plugin for useRequirementStatus hook */
	statusPlugin?: StatusPlugin;
}

/**
 * Provider component that makes the Directive system available to child components.
 *
 * @returns The provider component wrapping children
 *
 * @example
 * ```tsx
 * import { createSystem } from 'directive';
 * import { DirectiveProvider } from 'directive/react';
 *
 * const system = createSystem({ module: myModule });
 * system.start();
 *
 * function App() {
 *   return (
 *     <DirectiveProvider system={system}>
 *       <MyApp />
 *     </DirectiveProvider>
 *   );
 * }
 * ```
 */
export function DirectiveProvider<M extends ModuleSchema>({
	system,
	children,
	statusPlugin,
}: DirectiveProviderProps<M>): ReactNode {
	return (
		<DirectiveContext.Provider value={system}>
			<StatusPluginContext.Provider value={statusPlugin ?? null}>
				{children}
			</StatusPluginContext.Provider>
		</DirectiveContext.Provider>
	);
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to access the Directive system.
 *
 * @returns The Directive system instance
 * @throws Error if used outside of DirectiveProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const system = useSystem();
 *   const inspection = system.inspect();
 *   return <pre>{JSON.stringify(inspection, null, 2)}</pre>;
 * }
 * ```
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
 * Hook to read a derivation value reactively.
 *
 * The component will re-render when the derivation value changes.
 *
 * @param derivationId - The ID of the derivation to read
 * @returns The current value of the derivation
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const doubled = useDerived<number>("doubled");
 *   return <p>Doubled: {doubled}</p>;
 * }
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
export function useDerived<T>(derivationId: string, overrideSystem?: System<any>): T {
	const system = useResolvedSystem(overrideSystem);

	// Dev warning for invalid derivation IDs
	if (process.env.NODE_ENV !== "production") {
		const initialValue = system.read(derivationId);
		if (initialValue === undefined) {
			console.warn(
				`[Directive] useDerived("${derivationId}") returned undefined. ` +
					`Check that "${derivationId}" is defined in your module's derive property.`,
			);
		}
	}

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.subscribe([derivationId], onStoreChange);
		},
		[system, derivationId],
	);

	const getSnapshot = useCallback(() => {
		return system.read<T>(derivationId);
	}, [system, derivationId]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to read multiple derivation values reactively.
 *
 * The component will re-render when any of the specified derivations change.
 * This is more efficient than multiple `useDerived` calls when you need
 * several related values.
 *
 * @param derivationIds - Array of derivation IDs to read
 * @returns An object containing the current values of all requested derivations
 *
 * @example
 * ```tsx
 * function StatusDisplay() {
 *   const state = useDerivations<{ isRed: boolean; elapsed: number }>(["isRed", "elapsed"]);
 *   return (
 *     <p>
 *       {state.isRed ? `Red for ${state.elapsed}s` : "Not red"}
 *     </p>
 *   );
 * }
 * ```
 */
export function useDerivations<T extends Record<string, unknown>>(
	derivationIds: string[],
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	overrideSystem?: System<any>,
): T {
	const system = useResolvedSystem(overrideSystem);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.subscribe(derivationIds, onStoreChange);
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[system, ...derivationIds],
	);

	const getSnapshot = useCallback(() => {
		const result: Record<string, unknown> = {};
		for (const id of derivationIds) {
			result[id] = system.read(id);
		}
		return result as T;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [system, ...derivationIds]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to read a fact value reactively.
 *
 * The component will re-render when the fact value changes.
 *
 * @param factKey - The key of the fact to read
 * @returns The current value of the fact, or undefined if not set
 *
 * @example
 * ```tsx
 * function UserDisplay() {
 *   const userId = useFact<number>("userId");
 *   const user = useFact<User | null>("user");
 *   return user ? <p>Hello, {user.name}</p> : <p>Loading user {userId}...</p>;
 * }
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
export function useFact<T>(factKey: string, overrideSystem?: System<any>): T | undefined {
	const system = useResolvedSystem(overrideSystem);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.facts.$store.subscribe([factKey], onStoreChange);
		},
		[system, factKey],
	);

	const getSnapshot = useCallback(() => {
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic fact access
		return (system.facts as any)[factKey] as T | undefined;
	}, [system, factKey]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Default equality function using Object.is
 */
function defaultEquality<T>(a: T, b: T): boolean {
	return Object.is(a, b);
}

/** Sentinel value for uninitialized selector cache */
const UNINITIALIZED = Symbol("directive.uninitialized");

/**
 * Hook to read a derived value from a fact using a selector.
 *
 * This is more efficient than `useFact` when you only need part of a fact,
 * as it only re-renders when the selected value changes.
 *
 * **IMPORTANT: Selector Stability**
 *
 * For optimal performance, define your `selector` and `equalityFn` outside the
 * component or memoize them with `useCallback`. Inline functions work correctly
 * but may cause the internal cache to reset when the function reference changes.
 *
 * @param factKey - The key of the fact to read
 * @param selector - Function to extract the desired value from the fact
 * @param equalityFn - Optional equality function (defaults to Object.is)
 * @returns The selected value
 *
 * @example
 * ```tsx
 * // RECOMMENDED: Define selector outside component for stable reference
 * const selectUserName = (user) => user?.name ?? "Guest";
 *
 * function UserName() {
 *   const name = useFactSelector("user", selectUserName);
 *   return <p>Hello, {name}</p>;
 * }
 *
 * // Also works with inline selectors:
 * function UserIds() {
 *   const ids = useFactSelector(
 *     "users",
 *     (users) => users?.map(u => u.id) ?? [],
 *     (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
 *   );
 *   return <p>IDs: {ids.join(", ")}</p>;
 * }
 * ```
 */
export function useFactSelector<T, R>(
	factKey: string,
	selector: (value: T | undefined) => R,
	eqOrOpts?: ((a: R, b: R) => boolean) | SelectorOptions<R>,
): R {
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	let overrideSystem: System<any> | undefined;
	let equalityFn: (a: R, b: R) => boolean = defaultEquality;

	if (typeof eqOrOpts === "function") {
		equalityFn = eqOrOpts;
	} else if (eqOrOpts) {
		overrideSystem = eqOrOpts.system;
		if (eqOrOpts.equalityFn) equalityFn = eqOrOpts.equalityFn;
	}

	const system = useResolvedSystem(overrideSystem);
	// Use sentinel value to properly handle undefined as a valid selected value
	const cachedValue = useRef<R | typeof UNINITIALIZED>(UNINITIALIZED);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.facts.$store.subscribe([factKey], onStoreChange);
		},
		[system, factKey],
	);

	const getSnapshot = useCallback(() => {
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic fact access
		const fact = (system.facts as any)[factKey] as T | undefined;
		const newValue = selector(fact);

		// On first render, just cache and return
		if (cachedValue.current === UNINITIALIZED) {
			cachedValue.current = newValue;
			return newValue;
		}

		// If equal to cached, return cached to prevent re-render
		if (equalityFn(cachedValue.current, newValue)) {
			return cachedValue.current;
		}

		cachedValue.current = newValue;
		return newValue;
	}, [system, factKey, selector, equalityFn]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to read a derived value from a derivation using a selector.
 *
 * This is more efficient than `useDerived` when you only need part of a
 * derivation result, as it only re-renders when the selected value changes.
 *
 * @param derivationId - The ID of the derivation to read
 * @param selector - Function to extract the desired value from the derivation
 * @param equalityFn - Optional equality function (defaults to Object.is)
 * @returns The selected value
 *
 * @example
 * ```tsx
 * function ItemCount() {
 *   // Only re-renders when the count changes, not other stats properties
 *   const count = useDerivedSelector(
 *     "stats",
 *     (stats) => stats.itemCount
 *   );
 *   return <p>Items: {count}</p>;
 * }
 * ```
 */
export function useDerivedSelector<T, R>(
	derivationId: string,
	selector: (value: T) => R,
	eqOrOpts?: ((a: R, b: R) => boolean) | SelectorOptions<R>,
): R {
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	let overrideSystem: System<any> | undefined;
	let equalityFn: (a: R, b: R) => boolean = defaultEquality;

	if (typeof eqOrOpts === "function") {
		equalityFn = eqOrOpts;
	} else if (eqOrOpts) {
		overrideSystem = eqOrOpts.system;
		if (eqOrOpts.equalityFn) equalityFn = eqOrOpts.equalityFn;
	}

	const system = useResolvedSystem(overrideSystem);
	// Use sentinel value to properly handle undefined as a valid selected value
	const cachedValue = useRef<R | typeof UNINITIALIZED>(UNINITIALIZED);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.subscribe([derivationId], onStoreChange);
		},
		[system, derivationId],
	);

	const getSnapshot = useCallback(() => {
		const derivation = system.read<T>(derivationId);
		const newValue = selector(derivation);

		// On first render, just cache and return
		if (cachedValue.current === UNINITIALIZED) {
			cachedValue.current = newValue;
			return newValue;
		}

		// If equal to cached, return cached to prevent re-render
		if (equalityFn(cachedValue.current, newValue)) {
			return cachedValue.current;
		}

		cachedValue.current = newValue;
		return newValue;
	}, [system, derivationId, selector, equalityFn]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to select values from the entire system (like Zustand's useStore).
 *
 * This provides a flexible way to derive values from any combination of
 * facts and derivations, with fine-grained re-render control.
 *
 * @param selector - Function that receives facts and derives a value
 * @param equalityFn - Optional equality function (defaults to Object.is)
 * @returns The selected value
 *
 * @example
 * ```tsx
 * function Summary() {
 *   // Select from multiple sources
 *   const summary = useSelector((facts) => ({
 *     userName: facts.user?.name,
 *     itemCount: facts.items?.length ?? 0,
 *   }));
 *   return <p>{summary.userName} has {summary.itemCount} items</p>;
 * }
 *
 * // With shallow equality
 * function shallowEqual(a: object, b: object) {
 *   const keysA = Object.keys(a);
 *   const keysB = Object.keys(b);
 *   if (keysA.length !== keysB.length) return false;
 *   return keysA.every(key => a[key] === b[key]);
 * }
 *
 * function UserSummary() {
 *   const user = useSelector(
 *     (facts) => ({ id: facts.user?.id, name: facts.user?.name }),
 *     shallowEqual
 *   );
 *   return <p>{user.name}</p>;
 * }
 * ```
 */
export function useSelector<R>(
	// biome-ignore lint/suspicious/noExplicitAny: Selector receives dynamic facts
	selector: (facts: Record<string, any>) => R,
	eqOrOpts?: ((a: R, b: R) => boolean) | SelectorOptions<R>,
): R {
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	let overrideSystem: System<any> | undefined;
	let equalityFn: (a: R, b: R) => boolean = defaultEquality;

	if (typeof eqOrOpts === "function") {
		equalityFn = eqOrOpts;
	} else if (eqOrOpts) {
		overrideSystem = eqOrOpts.system;
		if (eqOrOpts.equalityFn) equalityFn = eqOrOpts.equalityFn;
	}

	const system = useResolvedSystem(overrideSystem);
	// Use sentinel value to properly handle undefined as a valid selected value
	const cachedValue = useRef<R | typeof UNINITIALIZED>(UNINITIALIZED);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			// Subscribe to all fact changes
			return system.facts.$store.subscribeAll(onStoreChange);
		},
		[system],
	);

	const getSnapshot = useCallback(() => {
		// Get all facts as a plain object
		const facts = system.facts.$store.toObject();

		const newValue = selector(facts);

		// On first render, just cache and return
		if (cachedValue.current === UNINITIALIZED) {
			cachedValue.current = newValue;
			return newValue;
		}

		// If equal to cached, return cached to prevent re-render
		if (equalityFn(cachedValue.current, newValue)) {
			return cachedValue.current;
		}

		cachedValue.current = newValue;
		return newValue;
	}, [system, selector, equalityFn]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to get the dispatch function for sending events.
 *
 * @returns A stable dispatch function typed to the system's event schema
 *
 * @example
 * ```tsx
 * function IncrementButton() {
 *   const dispatch = useDispatch();
 *   return (
 *     <button onClick={() => dispatch({ type: "increment" })}>
 *       Increment
 *     </button>
 *   );
 * }
 * ```
 */
export function useDispatch<M extends ModuleSchema = ModuleSchema>(
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	overrideSystem?: System<any>,
): (event: InferEvents<M>) => void {
	const system = useResolvedSystem(overrideSystem) as System<M>;
	return useCallback(
		(event: InferEvents<M>) => {
			system.dispatch(event);
		},
		[system],
	);
}

/**
 * Hook to watch a derivation and execute a callback when it changes.
 *
 * Unlike useDerived, this doesn't cause re-renders - it just executes
 * the callback as a side effect.
 *
 * @param derivationId - The ID of the derivation to watch
 * @param callback - Function to call when the value changes
 *
 * @example
 * ```tsx
 * function Analytics() {
 *   useWatch("pageViews", (newValue, prevValue) => {
 *     analytics.track("pageViews", { from: prevValue, to: newValue });
 *   });
 *   return null;
 * }
 * ```
 */
export function useWatch<T>(
	derivationId: string,
	callback: (newValue: T, prevValue: T | undefined) => void,
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	overrideSystem?: System<any>,
): void {
	const system = useResolvedSystem(overrideSystem);
	const callbackRef = useRef(callback);

	// Keep callback ref up to date synchronously before subscription can fire
	useLayoutEffect(() => {
		callbackRef.current = callback;
	}, [callback]);

	useEffect(() => {
		return system.watch(derivationId, (newValue, prevValue) => {
			callbackRef.current(newValue as T, prevValue as T | undefined);
		});
	}, [system, derivationId]);
}

/**
 * Hook to check if the system has settled (no pending operations).
 *
 * @returns Whether the system is settled
 *
 * @example
 * ```tsx
 * function LoadingIndicator() {
 *   const isSettled = useIsSettled();
 *   return isSettled ? null : <Spinner />;
 * }
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
export function useIsSettled(overrideSystem?: System<any>): boolean {
	const system = useResolvedSystem(overrideSystem);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			// Subscribe to all facts changes as a proxy for system activity
			return system.facts.$store.subscribeAll(onStoreChange);
		},
		[system],
	);

	const getSnapshot = useCallback(() => {
		return system.isSettled;
	}, [system]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to get system inspection data reactively.
 *
 * Useful for debugging and showing system status.
 *
 * @returns The current system inspection with unmet requirements and inflight operations
 *
 * @example
 * ```tsx
 * function DebugPanel() {
 *   const inspection = useInspect();
 *   return (
 *     <pre>
 *       Unmet: {inspection.unmet.length}
 *       Inflight: {inspection.inflight.length}
 *     </pre>
 *   );
 * }
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
export function useInspect(overrideSystem?: System<any>) {
	const system = useResolvedSystem(overrideSystem);
	const cachedSnapshot = useRef<ReturnType<typeof system.inspect> | null>(null);
	// Track array lengths and first/last items for efficient comparison
	const cachedUnmetLength = useRef<number>(-1);
	const cachedInflightLength = useRef<number>(-1);
	const cachedUnmetFirst = useRef<unknown>(null);
	const cachedInflightFirst = useRef<unknown>(null);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.facts.$store.subscribeAll(onStoreChange);
		},
		[system],
	);

	const getSnapshot = useCallback(() => {
		const current = system.inspect();

		// Efficient comparison: check lengths and first items instead of JSON.stringify
		// This is O(1) instead of O(n) serialization
		const unmetChanged =
			current.unmet.length !== cachedUnmetLength.current ||
			current.unmet[0] !== cachedUnmetFirst.current;
		const inflightChanged =
			current.inflight.length !== cachedInflightLength.current ||
			current.inflight[0] !== cachedInflightFirst.current;

		if (unmetChanged || inflightChanged) {
			cachedSnapshot.current = current;
			cachedUnmetLength.current = current.unmet.length;
			cachedInflightLength.current = current.inflight.length;
			cachedUnmetFirst.current = current.unmet[0];
			cachedInflightFirst.current = current.inflight[0];
		}

		return cachedSnapshot.current ?? current;
	}, [system]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to get system inspection data with throttled updates.
 *
 * Use this instead of useInspect when updates are too frequent.
 * The throttle uses trailing-edge behavior, so you'll always see the latest state.
 *
 * @param options - Throttling options
 * @returns The current system inspection (updated at most every throttleMs)
 *
 * @example
 * ```tsx
 * function DebugPanel() {
 *   // Update at most every 200ms
 *   const inspection = useInspectThrottled({ throttleMs: 200 });
 *   return <pre>Unmet: {inspection.unmet.length}</pre>;
 * }
 * ```
 */
export function useInspectThrottled(
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	options: ThrottledHookOptions & { system?: System<any> } = {},
) {
	const { throttleMs = 100, system: overrideSystem } = options;
	const system = useResolvedSystem(overrideSystem);
	const [inspection, setInspection] = useState(() => system.inspect());

	useEffect(() => {
		const { throttled, cleanup } = createThrottle(() => {
			setInspection(system.inspect());
		}, throttleMs);

		const unsubscribe = system.facts.$store.subscribeAll(throttled);

		return () => {
			cleanup();
			unsubscribe();
		};
	}, [system, throttleMs]);

	return inspection;
}

/**
 * Hook to get current requirements state reactively.
 *
 * Provides a focused view of just requirements without full inspection overhead.
 *
 * @returns The current requirements state
 *
 * @example
 * ```tsx
 * function LoadingIndicator() {
 *   const { isWorking, hasUnmet, hasInflight } = useRequirements();
 *   if (!isWorking) return null;
 *   return <Spinner label={hasInflight ? 'Loading...' : 'Processing...'} />;
 * }
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
export function useRequirements(overrideSystem?: System<any>): RequirementsState {
	const system = useResolvedSystem(overrideSystem);
	const cachedSnapshot = useRef<RequirementsState | null>(null);
	const cachedUnmetJson = useRef<string>("");
	const cachedInflightJson = useRef<string>("");

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.facts.$store.subscribeAll(onStoreChange);
		},
		[system],
	);

	const getSnapshot = useCallback(() => {
		const inspection = system.inspect();
		const unmetJson = JSON.stringify(inspection.unmet);
		const inflightJson = JSON.stringify(inspection.inflight);

		// Only return new object if content actually changed
		if (
			unmetJson !== cachedUnmetJson.current ||
			inflightJson !== cachedInflightJson.current
		) {
			cachedUnmetJson.current = unmetJson;
			cachedInflightJson.current = inflightJson;
			cachedSnapshot.current = computeRequirementsState(inspection);
		}

		return cachedSnapshot.current ?? computeRequirementsState(inspection);
	}, [system]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to get current requirements state with throttled updates.
 *
 * Use this instead of useRequirements when updates are too frequent.
 * The throttle uses trailing-edge behavior, so you'll always see the latest state.
 *
 * @param options - Throttling options
 * @returns The current requirements state (updated at most every throttleMs)
 *
 * @example
 * ```tsx
 * function LoadingIndicator() {
 *   // Update at most every 200ms
 *   const { isWorking } = useRequirementsThrottled({ throttleMs: 200 });
 *   if (!isWorking) return null;
 *   return <Spinner />;
 * }
 * ```
 */
export function useRequirementsThrottled(
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	options: ThrottledHookOptions & { system?: System<any> } = {},
): RequirementsState {
	const { throttleMs = 100, system: overrideSystem } = options;
	const system = useResolvedSystem(overrideSystem);
	const [state, setState] = useState(() =>
		computeRequirementsState(system.inspect()),
	);

	useEffect(() => {
		const { throttled, cleanup } = createThrottle(() => {
			setState(computeRequirementsState(system.inspect()));
		}, throttleMs);

		const unsubscribe = system.facts.$store.subscribeAll(throttled);

		return () => {
			cleanup();
			unsubscribe();
		};
	}, [system, throttleMs]);

	return state;
}

/**
 * Hook to get requirement status reactively.
 *
 * Requires a statusPlugin to be passed to DirectiveProvider.
 *
 * @param type - The requirement type to get status for
 * @returns The current status of the requirement type
 *
 * @example
 * ```tsx
 * import { createRequirementStatusPlugin } from 'directive';
 * import { DirectiveProvider, useRequirementStatus } from 'directive/react';
 *
 * const statusPlugin = createRequirementStatusPlugin();
 * const system = createSystem({
 *   modules: [myModule],
 *   plugins: [statusPlugin.plugin],
 * });
 *
 * function App() {
 *   return (
 *     <DirectiveProvider system={system} statusPlugin={statusPlugin}>
 *       <UserLoader />
 *     </DirectiveProvider>
 *   );
 * }
 *
 * function UserLoader() {
 *   const status = useRequirementStatus("FETCH_USER");
 *   if (status.isLoading) return <Spinner />;
 *   if (status.hasError) return <Error message={status.lastError?.message} />;
 *   return <UserContent />;
 * }
 * ```
 */
export function useRequirementStatus(
	type: string,
	overrideStatusPlugin?: StatusPlugin,
): RequirementTypeStatus {
	const statusPlugin = useResolvedStatusPlugin(overrideStatusPlugin);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return statusPlugin.subscribe(onStoreChange);
		},
		[statusPlugin],
	);

	const getSnapshot = useCallback(() => {
		return statusPlugin.getStatus(type);
	}, [statusPlugin, type]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to check if a requirement type is currently being resolved.
 *
 * Simplified version of useRequirementStatus that returns only the resolving state.
 * Requires a statusPlugin to be passed to DirectiveProvider.
 *
 * @param type - The requirement type to check
 * @returns Whether the requirement type has inflight resolvers
 *
 * @example
 * ```tsx
 * function SaveButton() {
 *   const isSaving = useIsResolving("SAVE_DATA");
 *   return (
 *     <button disabled={isSaving}>
 *       {isSaving ? "Saving..." : "Save"}
 *     </button>
 *   );
 * }
 * ```
 */
export function useIsResolving(
	type: string,
	overrideStatusPlugin?: StatusPlugin,
): boolean {
	const status = useRequirementStatus(type, overrideStatusPlugin);
	return status.inflight > 0;
}

/**
 * Hook to get the last error for a requirement type.
 *
 * Simplified version of useRequirementStatus that returns only the error.
 * Requires a statusPlugin to be passed to DirectiveProvider.
 *
 * @param type - The requirement type to get error for
 * @returns The last error, or null if no error
 *
 * @example
 * ```tsx
 * function ErrorDisplay() {
 *   const error = useLatestError("FETCH_USER");
 *   if (!error) return null;
 *   return <div className="error">{error.message}</div>;
 * }
 * ```
 */
export function useLatestError(
	type: string,
	overrideStatusPlugin?: StatusPlugin,
): Error | null {
	const status = useRequirementStatus(type, overrideStatusPlugin);
	return status.lastError;
}

/**
 * Hook to get status for all tracked requirement types.
 *
 * Returns a Map of all requirement types that have been tracked, with their
 * current status. Useful for dashboard/admin UIs that need to show all
 * requirement states at once.
 *
 * Requires a statusPlugin to be passed to DirectiveProvider.
 *
 * @returns Map of requirement type to status
 *
 * @example
 * ```tsx
 * function RequirementsDashboard() {
 *   const allStatuses = useRequirementStatuses();
 *
 *   return (
 *     <ul>
 *       {Array.from(allStatuses.entries()).map(([type, status]) => (
 *         <li key={type}>
 *           {type}: {status.isLoading ? "Loading" : status.hasError ? "Error" : "Ready"}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useRequirementStatuses(
	overrideStatusPlugin?: StatusPlugin,
): Map<string, RequirementTypeStatus> {
	const statusPlugin = useResolvedStatusPlugin(overrideStatusPlugin);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return statusPlugin.subscribe(onStoreChange);
		},
		[statusPlugin],
	);

	const getSnapshot = useCallback(() => {
		return statusPlugin.getAllStatus();
	}, [statusPlugin]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// Suspense Integration
// ============================================================================

// Cache for pending promises to prevent creating new ones on re-render
const suspenseCache = new Map<string, Promise<void>>();

/**
 * Hook that suspends while a requirement is being resolved.
 *
 * This enables React Suspense integration - wrap your component in a
 * `<Suspense>` boundary to show a fallback while requirements are loading.
 *
 * **Behavior:**
 * - If the requirement is loading (pending or inflight), throws a Promise (suspends)
 * - If the requirement has an error, throws the error
 * - If the requirement is idle, returns the status
 *
 * Requires a statusPlugin to be passed to DirectiveProvider.
 *
 * @param type - The requirement type to wait for
 * @returns The requirement status (only when not loading)
 * @throws Promise when loading, Error when failed
 *
 * @example
 * ```tsx
 * import { Suspense } from 'react';
 * import { useSuspenseRequirement } from 'directive/react';
 *
 * function UserProfile() {
 *   // This will suspend until FETCH_USER is resolved
 *   const status = useSuspenseRequirement("FETCH_USER");
 *   // Component only renders after requirement is resolved
 *   return <div>User loaded!</div>;
 * }
 *
 * function App() {
 *   return (
 *     <Suspense fallback={<Spinner />}>
 *       <UserProfile />
 *     </Suspense>
 *   );
 * }
 * ```
 */
export function useSuspenseRequirement(
	type: string,
	overrideStatusPlugin?: StatusPlugin,
): RequirementTypeStatus {
	const statusPlugin = useResolvedStatusPlugin(overrideStatusPlugin);

	// Cleanup suspense cache on unmount to prevent memory leaks
	useEffect(() => {
		return () => {
			suspenseCache.delete(type);
		};
	}, [type]);

	const status = statusPlugin.getStatus(type);

	// If there's an error, throw it for error boundaries
	if (status.hasError && status.lastError) {
		throw status.lastError;
	}

	// If loading, throw a promise for Suspense
	if (status.isLoading) {
		// Check if we already have a pending promise for this type
		let promise = suspenseCache.get(type);

		if (!promise) {
			// Create a new promise that resolves when the requirement is done
			promise = new Promise<void>((resolve) => {
				const unsubscribe = statusPlugin.subscribe(() => {
					const currentStatus = statusPlugin.getStatus(type);
					if (!currentStatus.isLoading) {
						suspenseCache.delete(type);
						unsubscribe();
						resolve();
					}
				});
			});
			suspenseCache.set(type, promise);
		}

		throw promise;
	}

	return status;
}

/**
 * Hook that waits for multiple requirements and suspends until all are resolved.
 *
 * This is useful when a component depends on multiple data requirements.
 *
 * @param types - Array of requirement types to wait for
 * @returns Map of requirement type to status (only when none are loading)
 * @throws Promise when any are loading, Error when any have failed
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   // Suspends until both requirements are resolved
 *   const statuses = useSuspenseRequirements(["FETCH_USER", "FETCH_SETTINGS"]);
 *   return <div>All data loaded!</div>;
 * }
 * ```
 */
export function useSuspenseRequirements(
	types: string[],
	overrideStatusPlugin?: StatusPlugin,
): Map<string, RequirementTypeStatus> {
	const statusPlugin = useResolvedStatusPlugin(overrideStatusPlugin);

	// Cleanup suspense cache on unmount to prevent memory leaks
	const cacheKey = types.slice().sort().join(",");
	useEffect(() => {
		return () => {
			suspenseCache.delete(cacheKey);
		};
	}, [cacheKey]);

	const result = new Map<string, RequirementTypeStatus>();
	let hasLoading = false;
	let firstError: Error | null = null;

	for (const type of types) {
		const status = statusPlugin.getStatus(type);
		result.set(type, status);

		if (status.hasError && status.lastError && !firstError) {
			firstError = status.lastError;
		}
		if (status.isLoading) {
			hasLoading = true;
		}
	}

	// Throw first error for error boundaries
	if (firstError) {
		throw firstError;
	}

	// If any are loading, create a combined promise
	if (hasLoading) {
		let promise = suspenseCache.get(cacheKey);

		if (!promise) {
			promise = new Promise<void>((resolve) => {
				const unsubscribe = statusPlugin.subscribe(() => {
					const allDone = types.every((t) => !statusPlugin.getStatus(t).isLoading);
					if (allDone) {
						suspenseCache.delete(cacheKey);
						unsubscribe();
						resolve();
					}
				});
			});
			suspenseCache.set(cacheKey, promise);
		}

		throw promise;
	}

	return result;
}

// ============================================================================
// Scoped System Hook (like XState's useActorRef)
// ============================================================================

/** Options for useDirectiveRef hook */
export type UseDirectiveRefOptions<M extends ModuleSchema> =
	| ModuleDef<M>
	| {
			module: ModuleDef<M>;
			// biome-ignore lint/suspicious/noExplicitAny: Plugin types vary
			plugins?: Plugin<any>[];
			debug?: { timeTravel?: boolean; maxSnapshots?: number };
			tickMs?: number;
			zeroConfig?: boolean;
			// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
			initialFacts?: Record<string, any>;
	  };

/**
 * Hook to create and manage a Directive system with automatic lifecycle.
 * The system is created once on mount and destroyed on unmount.
 *
 * **This is stable across re-renders** - like XState's `useActorRef`.
 * The system reference never changes, regardless of how you define options.
 *
 * Use this when you want to create a system inside a component rather than
 * at the module level. For most apps, creating the system outside React and
 * passing to `DirectiveProvider` is preferred.
 *
 * @param options - Either a module or full system options
 * @returns A stable system reference and a Provider component
 *
 * @example
 * ```tsx
 * import { useDirectiveRef } from 'directive/react';
 * import { counterModule } from './counter';
 *
 * function Counter() {
 *   // System is created once and stable across re-renders
 *   const { system, Provider } = useDirectiveRef(counterModule);
 *
 *   return (
 *     <Provider>
 *       <CounterDisplay />
 *       <button onClick={() => system.dispatch({ type: 'increment' })}>
 *         +
 *       </button>
 *     </Provider>
 *   );
 * }
 *
 * // Or with inline options (still stable!)
 * function Counter() {
 *   const { system, Provider } = useDirectiveRef({
 *     module: counterModule,
 *     debug: { timeTravel: true },
 *   });
 *   // ...
 * }
 * ```
 */
export function useDirectiveRef<M extends ModuleSchema>(
	options: UseDirectiveRefOptions<M>,
): {
	system: System<M>;
	Provider: (props: { children: ReactNode }) => ReactNode;
} {
	// Use ref to store the system - created once, stable forever
	const systemRef = useRef<System<M> | null>(null);
	const isInitialized = useRef(false);

	// Initialize system only once (not in useEffect to avoid double-creation in StrictMode)
	if (!isInitialized.current) {
		isInitialized.current = true;

		const isModule = "id" in options && "schema" in options;

		if (isModule) {
			// biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
			systemRef.current = createSystem({ module: options as ModuleDef<M> } as any) as unknown as System<M>;
		} else {
			const opts = options as Exclude<UseDirectiveRefOptions<M>, ModuleDef<M>>;
			// biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
			systemRef.current = createSystem({
				module: opts.module,
				plugins: opts.plugins,
				debug: opts.debug,
				tickMs: opts.tickMs,
				zeroConfig: opts.zeroConfig,
				initialFacts: opts.initialFacts,
			} as any) as unknown as System<M>;
		}

		systemRef.current.start();
	}

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			systemRef.current?.destroy();
		};
	}, []);

	// Create a stable Provider component using useCallback
	const Provider = useCallback(
		({ children }: { children: ReactNode }) => (
			<DirectiveProvider system={systemRef.current!}>{children}</DirectiveProvider>
		),
		[],
	);

	return {
		system: systemRef.current!,
		Provider,
	};
}

/**
 * Hook to create a scoped system with status plugin pre-configured.
 * Combines useDirectiveRef with createRequirementStatusPlugin.
 *
 * @param options - Either a module or full system options
 * @returns A stable system, statusPlugin, and Provider component
 *
 * @example
 * ```tsx
 * function App() {
 *   const { system, statusPlugin, Provider } = useDirectiveRefWithStatus(myModule);
 *
 *   return (
 *     <Provider>
 *       <LoadingIndicator />
 *       <Content />
 *     </Provider>
 *   );
 * }
 *
 * function LoadingIndicator() {
 *   const status = useRequirementStatus("FETCH_DATA");
 *   if (status.isLoading) return <Spinner />;
 *   return null;
 * }
 * ```
 */
export function useDirectiveRefWithStatus<M extends ModuleSchema>(
	options: UseDirectiveRefOptions<M>,
): {
	system: System<M>;
	statusPlugin: ReturnType<typeof createRequirementStatusPlugin>;
	Provider: (props: { children: ReactNode }) => ReactNode;
} {
	// Use refs to store the system and plugin - created once, stable forever
	const systemRef = useRef<System<M> | null>(null);
	const statusPluginRef = useRef<ReturnType<typeof createRequirementStatusPlugin> | null>(null);
	const isInitialized = useRef(false);

	// Initialize system and plugin only once
	if (!isInitialized.current) {
		isInitialized.current = true;

		statusPluginRef.current = createRequirementStatusPlugin();

		const isModule = "id" in options && "schema" in options;

		if (isModule) {
			// biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
			systemRef.current = createSystem({
				module: options as ModuleDef<M>,
				// biome-ignore lint/suspicious/noExplicitAny: Plugin<never> requires cast
				plugins: [statusPluginRef.current.plugin as Plugin<any>],
			} as any) as unknown as System<M>;
		} else {
			const opts = options as Exclude<UseDirectiveRefOptions<M>, ModuleDef<M>>;
			// biome-ignore lint/suspicious/noExplicitAny: Plugin<never> requires cast
			const allPlugins = [...(opts.plugins ?? []), statusPluginRef.current.plugin as Plugin<any>];
			// biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
			systemRef.current = createSystem({
				module: opts.module,
				plugins: allPlugins,
				debug: opts.debug,
				tickMs: opts.tickMs,
				zeroConfig: opts.zeroConfig,
				initialFacts: opts.initialFacts,
			} as any) as unknown as System<M>;
		}

		systemRef.current.start();
	}

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			systemRef.current?.destroy();
		};
	}, []);

	// Create a stable Provider component using useCallback
	const Provider = useCallback(
		({ children }: { children: ReactNode }) => (
			<DirectiveProvider system={systemRef.current!} statusPlugin={statusPluginRef.current!}>
				{children}
			</DirectiveProvider>
		),
		[],
	);

	return {
		system: systemRef.current!,
		statusPlugin: statusPluginRef.current!,
		Provider,
	};
}

// ============================================================================
// Typed Hooks Factory
// ============================================================================

/**
 * Create typed hooks for a specific system schema.
 *
 * This provides better type inference than the generic hooks.
 *
 * @returns An object containing typed versions of useDerived, useFact, useFacts, useDispatch, and useSystem
 *
 * @example
 * ```tsx
 * import { createTypedHooks } from 'directive/react';
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
 * function Counter() {
 *   const count = useFact("count"); // Type: number
 *   const doubled = useDerived("doubled"); // Type: number
 *   const dispatch = useDispatch();
 *
 *   // dispatch({ type: "increment" }); // Typed!
 *   // dispatch({ type: "setUser", user: { id: 1, name: "John" } }); // Typed!
 * }
 * ```
 */
export function createTypedHooks<M extends ModuleSchema>(): {
	useDerived: <K extends keyof InferDerivations<M>>(
		derivationId: K,
		// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
		system?: System<any>,
	) => InferDerivations<M>[K];
	useFact: <K extends keyof InferFacts<M>>(
		factKey: K,
		// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
		system?: System<any>,
	) => InferFacts<M>[K] | undefined;
	useFacts: () => System<M>["facts"];
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	useDispatch: (system?: System<any>) => (event: InferEvents<M>) => void;
	useSystem: () => System<M>;
} {
	return {
		useDerived: <K extends keyof InferDerivations<M>>(
			derivationId: K,
			// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
			system?: System<any>,
		) => useDerived<InferDerivations<M>[K]>(derivationId as string, system),
		useFact: <K extends keyof InferFacts<M>>(
			factKey: K,
			// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
			system?: System<any>,
		) => useFact<InferFacts<M>[K]>(factKey as string, system),
		useFacts: () => useSystem<M>().facts,
		useDispatch: (
			// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
			system?: System<any>,
		) => useDispatch<M>(system),
		useSystem: () => useSystem<M>(),
	};
}
