/**
 * React Adapter - Hooks and Provider for React integration
 *
 * Provides type-safe React hooks for working with Directive systems.
 *
 * @example
 * ```tsx
 * import { DirectiveProvider, useDerivation, useDispatch, useFact } from 'directive/react';
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
 *   const doubled = useDerivation("doubled");
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
	useRef,
	type ReactNode,
} from "react";
import type {
	System,
	ModuleSchema,
	InferFacts,
	InferDerivations,
	InferEvents,
} from "../core/types.js";
import {
	createRequirementStatusPlugin,
	type RequirementTypeStatus,
} from "../utils/requirement-status.js";

// Re-export for convenience
export type { RequirementTypeStatus };

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
 * @example
 * ```tsx
 * import { createSystem } from 'directive';
 * import { DirectiveProvider } from 'directive/react';
 *
 * const system = createSystem({ modules: [myModule] });
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
 *   const doubled = useDerivation<number>("doubled");
 *   return <p>Doubled: {doubled}</p>;
 * }
 * ```
 */
export function useDerivation<T>(derivationId: string): T {
	const system = useSystem();

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
 * Hook to read a fact value reactively.
 *
 * The component will re-render when the fact value changes.
 *
 * @param factKey - The key of the fact to read
 * @returns The current value of the fact
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
export function useFact<T>(factKey: string): T {
	const system = useSystem();

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.facts.$store.subscribe([factKey], onStoreChange);
		},
		[system, factKey],
	);

	const getSnapshot = useCallback(() => {
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic fact access
		return (system.facts as any)[factKey] as T;
	}, [system, factKey]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to get the dispatch function for sending events.
 *
 * @returns A stable dispatch function
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
export function useDispatch<M extends ModuleSchema = ModuleSchema>(): (
	event: InferEvents<M>,
) => void {
	const system = useSystem<M>();
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
 * Unlike useDerivation, this doesn't cause re-renders - it just executes
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
): void {
	const system = useSystem();
	const callbackRef = useRef(callback);

	// Keep callback ref up to date without causing subscription changes
	useEffect(() => {
		callbackRef.current = callback;
	});

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
export function useIsSettled(): boolean {
	const system = useSystem();

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
 * @returns The current system inspection
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
export function useInspect() {
	const system = useSystem();
	const cachedSnapshot = useRef<ReturnType<typeof system.inspect> | null>(null);
	const cachedJson = useRef<string>("");

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.facts.$store.subscribeAll(onStoreChange);
		},
		[system],
	);

	const getSnapshot = useCallback(() => {
		const current = system.inspect();
		const currentJson = JSON.stringify(current);

		// Only return new object if content actually changed
		if (currentJson !== cachedJson.current) {
			cachedSnapshot.current = current;
			cachedJson.current = currentJson;
		}

		return cachedSnapshot.current ?? current;
	}, [system]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
export function useRequirements(): RequirementsState {
	const system = useSystem();
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
			cachedSnapshot.current = {
				unmet: inspection.unmet,
				inflight: inspection.inflight,
				hasUnmet: inspection.unmet.length > 0,
				hasInflight: inspection.inflight.length > 0,
				isWorking: inspection.unmet.length > 0 || inspection.inflight.length > 0,
			};
		}

		return cachedSnapshot.current ?? {
			unmet: inspection.unmet,
			inflight: inspection.inflight,
			hasUnmet: inspection.unmet.length > 0,
			hasInflight: inspection.inflight.length > 0,
			isWorking: inspection.unmet.length > 0 || inspection.inflight.length > 0,
		};
	}, [system]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
export function useRequirementStatus(type: string): RequirementTypeStatus {
	const statusPlugin = useContext(StatusPluginContext);
	if (!statusPlugin) {
		throw new Error(
			"[Directive] useRequirementStatus requires a statusPlugin. " +
				"Pass statusPlugin to <DirectiveProvider statusPlugin={statusPlugin}>.",
		);
	}

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

// ============================================================================
// Typed Hooks Factory
// ============================================================================

/**
 * Create typed hooks for a specific system schema.
 *
 * This provides better type inference than the generic hooks.
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
 * const { useDerivation, useFact, useDispatch } = createTypedHooks<typeof schema>();
 *
 * function Counter() {
 *   const count = useFact("count"); // Type: number
 *   const doubled = useDerivation("doubled"); // Type: number
 *   const dispatch = useDispatch();
 *
 *   // dispatch({ type: "increment" }); // Typed!
 *   // dispatch({ type: "setUser", user: { id: 1, name: "John" } }); // Typed!
 * }
 * ```
 */
export function createTypedHooks<M extends ModuleSchema>(): {
	useDerivation: <K extends keyof InferDerivations<M>>(
		derivationId: K,
	) => InferDerivations<M>[K];
	useFact: <K extends keyof InferFacts<M>>(factKey: K) => InferFacts<M>[K];
	useFacts: () => System<M>["facts"];
	useDispatch: () => (event: InferEvents<M>) => void;
	useSystem: () => System<M>;
} {
	return {
		useDerivation: <K extends keyof InferDerivations<M>>(derivationId: K) =>
			useDerivation<InferDerivations<M>[K]>(derivationId as string),
		useFact: <K extends keyof InferFacts<M>>(factKey: K) =>
			useFact<InferFacts<M>[K]>(factKey as string),
		useFacts: () => useSystem<M>().facts,
		useDispatch: () => useDispatch<M>(),
		useSystem: () => useSystem<M>(),
	};
}
