/**
 * React Adapter - React hooks for Directive
 *
 * Features:
 * - useDerivation for computed values
 * - useFacts for direct fact access
 * - Context provider for system
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useSyncExternalStore,
	type ReactNode,
} from "react";
import type { Facts, Schema, System, SystemInspection } from "./types.js";
import { shallowEqual } from "./utils.js";

// ============================================================================
// Context
// ============================================================================

const DirectiveContext = createContext<System<Schema> | null>(null);

/** Props for DirectiveProvider */
export interface DirectiveProviderProps<S extends Schema> {
	system: System<S>;
	children: ReactNode;
}

/**
 * Provider component for Directive system.
 *
 * @example
 * ```tsx
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
export function DirectiveProvider<S extends Schema>({
	system,
	children,
}: DirectiveProviderProps<S>) {
	return (
		<DirectiveContext.Provider value={system as System<Schema>}>
			{children}
		</DirectiveContext.Provider>
	);
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get the Directive system from context.
 *
 * @throws If used outside of DirectiveProvider
 */
export function useSystem<S extends Schema>(): System<S> {
	const system = useContext(DirectiveContext);
	if (!system) {
		throw new Error(
			"[Directive] useSystem must be used within a DirectiveProvider",
		);
	}
	return system as System<S>;
}

/**
 * Subscribe to a derived value.
 *
 * @example
 * ```tsx
 * function StatusDisplay() {
 *   const isRed = useDerivation("isRed");
 *   return <div>{isRed ? "Red" : "Not Red"}</div>;
 * }
 * ```
 */
export function useDerivation<T>(derivationId: string): T {
	const system = useSystem();

	// Dev warning for invalid derivation IDs
	if (process.env.NODE_ENV !== "production") {
		const value = system.read(derivationId);
		if (value === undefined) {
			console.warn(
				`[Directive] useDerivation("${derivationId}") returned undefined. ` +
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
		return system.read(derivationId) as T;
	}, [system, derivationId]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe to multiple derived values.
 * Returns a stable reference when values haven't changed (shallow equality).
 *
 * @example
 * ```tsx
 * function StatusDisplay() {
 *   const { isRed, elapsed } = useDerivations(["isRed", "elapsed"]);
 *   return <div>{isRed ? `Red for ${elapsed}s` : "Not Red"}</div>;
 * }
 * ```
 */
export function useDerivations<T extends Record<string, unknown>>(
	derivationIds: string[],
): T {
	const system = useSystem();

	// Use JSON.stringify for stable memoization key (handles arrays with commas in values)
	const stableKey = JSON.stringify(derivationIds);

	// Cache the last result to provide reference stability
	const lastResultRef = useRef<T | null>(null);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.subscribe(derivationIds, onStoreChange);
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[system, stableKey],
	);

	const getSnapshot = useCallback(() => {
		const result: Record<string, unknown> = {};
		for (const id of derivationIds) {
			result[id] = system.read(id);
		}

		// Return cached reference if values are equal (prevents unnecessary re-renders)
		if (lastResultRef.current && shallowEqual(lastResultRef.current, result as T)) {
			return lastResultRef.current;
		}

		lastResultRef.current = result as T;
		return result as T;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [system, stableKey]);

	// SSR: return empty object on server (derivations may not be available)
	const getServerSnapshot = useCallback(() => {
		const result: Record<string, unknown> = {};
		for (const id of derivationIds) {
			result[id] = undefined;
		}
		return result as T;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [stableKey]);

	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Get direct access to facts for mutations (use sparingly, prefer derivations).
 *
 * WARNING: This does NOT trigger re-renders when facts change. This hook is
 * intended for event handlers and imperative code, not for rendering. Use
 * `useDerivation`, `useDerivations`, or `useFact` for reactive values in your render.
 *
 * @example
 * ```tsx
 * function Controls() {
 *   const facts = useFactsMutable();
 *   // Good: Use in event handlers
 *   const handleClick = () => { facts.count = (facts.count ?? 0) + 1; };
 *   return <button onClick={handleClick}>Increment</button>;
 * }
 *
 * // Bad: Don't use for rendering (won't re-render on changes)
 * function BadExample() {
 *   const facts = useFactsMutable();
 *   return <div>{facts.count}</div>; // Won't update!
 * }
 * ```
 */
export function useFactsMutable<S extends Schema>(): Facts<S> {
	const system = useSystem<S>();
	return system.facts;
}

/**
 * @deprecated Use `useFactsMutable` instead. This alias exists for backwards compatibility.
 */
export const useFacts = useFactsMutable;

/**
 * Subscribe to a single fact value with automatic re-renders.
 * This is a convenient alternative to creating a derivation for simple fact access.
 *
 * @example
 * ```tsx
 * function PhaseDisplay() {
 *   // Reactive - will re-render when phase changes
 *   const phase = useFact<string>("phase");
 *   return <div>Current phase: {phase}</div>;
 * }
 * ```
 */
export function useFact<T>(factKey: string): T | undefined {
	const system = useSystem();

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.facts.$store.subscribe([factKey], onStoreChange);
		},
		[system, factKey],
	);

	const getSnapshot = useCallback(() => {
		return system.facts.$store.get(factKey) as T | undefined;
	}, [system, factKey]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Dispatch events to the system.
 *
 * @example
 * ```tsx
 * function Controls() {
 *   const dispatch = useDispatch();
 *   return <button onClick={() => dispatch({ type: "tick" })}>Tick</button>;
 * }
 * ```
 */
export function useDispatch() {
	const system = useSystem();
	return useCallback(
		(event: { type: string; [key: string]: unknown }) => {
			system.dispatch(event);
		},
		[system],
	);
}

/**
 * Get system inspection data (for devtools).
 *
 * NOTE: This hook re-renders on every fact change since inspection data
 * depends on the entire system state. Use sparingly in production.
 *
 * @example
 * ```tsx
 * function Inspector() {
 *   const inspection = useInspection();
 *   return (
 *     <div>
 *       <h3>Unmet Requirements</h3>
 *       <ul>
 *         {inspection.unmet.map(r => <li key={r.id}>{r.id}</li>)}
 *       </ul>
 *     </div>
 *   );
 * }
 * ```
 */
export function useInspection(): SystemInspection {
	const system = useSystem();

	// Cache last inspection to provide stable references when data hasn't changed
	const lastInspectionRef = useRef<SystemInspection | null>(null);

	// Force re-render on any fact change
	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.facts.$store.subscribeAll(onStoreChange);
		},
		[system],
	);

	const getSnapshot = useCallback((): SystemInspection => {
		const inspection = system.inspect();

		// Quick check: if lengths match, compare more deeply
		const last = lastInspectionRef.current;
		if (
			last &&
			last.unmet.length === inspection.unmet.length &&
			last.inflight.length === inspection.inflight.length &&
			last.constraints.length === inspection.constraints.length
		) {
			// Check if unmet requirements are the same (by ID)
			const sameUnmet = last.unmet.every((r, i) => r.id === inspection.unmet[i]?.id);
			const sameInflight = last.inflight.every((r, i) => r.id === inspection.inflight[i]?.id);
			if (sameUnmet && sameInflight) {
				return last;
			}
		}

		lastInspectionRef.current = inspection;
		return inspection;
	}, [system]);

	// SSR: return empty inspection on server
	const getServerSnapshot = useCallback((): SystemInspection => {
		return {
			unmet: [],
			inflight: [],
			constraints: [],
			resolvers: {},
		};
	}, []);

	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
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
 * Automatically cleans up when the component unmounts.
 *
 * @example
 * ```tsx
 * function PhaseWatcher() {
 *   useWatch<string>("phase", (newPhase, oldPhase) => {
 *     console.log(`Phase changed from ${oldPhase} to ${newPhase}`);
 *     if (newPhase === "red") {
 *       playSound("alert");
 *     }
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
	const callbackRef = useRef(callback);

	// Keep callback ref up to date
	callbackRef.current = callback;

	// Use useEffect for proper cleanup
	useEffect(() => {
		return system.watch<T>(derivationId, (newValue, previousValue) => {
			callbackRef.current(newValue, previousValue);
		});
	}, [system, derivationId]);
}

// ============================================================================
// Suspense Support
// ============================================================================

/** Cache for suspense promises */
const suspenseCache = new WeakMap<System<Schema>, Map<string, { promise: Promise<unknown>; result?: unknown; error?: Error }>>();

/**
 * Read a derived value with React Suspense support.
 * If the derivation returns a Promise, the component will suspend until it resolves.
 *
 * This hook is useful for async data loading with Suspense boundaries.
 *
 * @example
 * ```tsx
 * import { Suspense } from 'react';
 *
 * function UserProfile() {
 *   // This will suspend if 'user' derivation returns a Promise
 *   const user = useDerivationSuspense<User>('user');
 *   return <div>{user.name}</div>;
 * }
 *
 * function App() {
 *   return (
 *     <Suspense fallback={<Loading />}>
 *       <UserProfile />
 *     </Suspense>
 *   );
 * }
 * ```
 */
export function useDerivationSuspense<T>(derivationId: string): T {
	const system = useSystem();

	// Get or create cache for this system
	let cache = suspenseCache.get(system);
	if (!cache) {
		cache = new Map();
		suspenseCache.set(system, cache);
	}

	const value = system.read(derivationId);

	// If value is a Promise, handle Suspense
	if (value instanceof Promise) {
		const cacheKey = derivationId;
		const cached = cache.get(cacheKey);

		if (cached) {
			// Already have a result or error
			if (cached.error) {
				throw cached.error;
			}
			if ("result" in cached) {
				return cached.result as T;
			}
			// Still pending - throw the promise to suspend
			throw cached.promise;
		}

		// New promise - cache it and throw
		const entry: { promise: Promise<unknown>; result?: unknown; error?: Error } = {
			promise: value.then(
				(result) => {
					entry.result = result;
				},
				(error) => {
					entry.error = error instanceof Error ? error : new Error(String(error));
				},
			),
		};
		cache.set(cacheKey, entry);
		throw entry.promise;
	}

	// Clear cache entry when value is no longer a Promise
	cache.delete(derivationId);

	return value as T;
}

/**
 * Wait for the system to settle before rendering.
 * Suspends the component until all inflight resolvers complete.
 *
 * @example
 * ```tsx
 * function DataView() {
 *   useAwaitSettled(); // Suspends until system is settled
 *   const data = useDerivation('data');
 *   return <div>{JSON.stringify(data)}</div>;
 * }
 *
 * function App() {
 *   return (
 *     <Suspense fallback={<Loading />}>
 *       <DataView />
 *     </Suspense>
 *   );
 * }
 * ```
 */
export function useAwaitSettled(): void {
	const system = useSystem();
	const inspection = system.inspect();

	// If there are inflight resolvers, suspend
	if (inspection.inflight.length > 0) {
		// Create a promise that resolves when settled
		throw system.settle();
	}
}
