/**
 * React Adapter - Consolidated hooks for React integration
 *
 * 19 public exports: useFact, useDerived, useDispatch, useDirective,
 * useDirectiveRef, useSelector, useWatch, useInspect, useRequirementStatus,
 * useSuspenseRequirement, useEvents, useExplain, useConstraintStatus,
 * useOptimisticUpdate, DirectiveDevTools, DirectiveHydrator, useHydratedSystem,
 * useTimeTravel, shallowEqual
 *
 * @example
 * ```tsx
 * import { useFact, useDerived, useEvents } from 'directive/react';
 *
 * const system = createSystem({ module: counterModule });
 * system.start();
 *
 * function Counter() {
 *   const count = useFact(system, "count");
 *   const doubled = useDerived(system, "doubled");
 *   const events = useEvents(system);
 *
 *   return (
 *     <div>
 *       <p>Count: {count}</p>
 *       <p>Doubled: {doubled}</p>
 *       <button onClick={() => events.increment()}>+</button>
 *     </div>
 *   );
 * }
 * ```
 */

import type { ReactNode } from "react";
import {
	useSyncExternalStore,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	createContext,
	useContext,
} from "react";
import type {
	ModuleSchema,
	ModuleDef,
	Plugin,
	DebugConfig,
	ErrorBoundaryConfig,
	InferFacts,
	InferDerivations,
	InferEvents,
	SingleModuleSystem,
	System,
	SystemSnapshot,
	DistributableSnapshot,
} from "../../core/types.js";
import { createSystem } from "../../core/system.js";
import { withTracking } from "../../core/tracking.js";
import {
	createRequirementStatusPlugin,
	type RequirementTypeStatus,
} from "../../utils/requirement-status.js";
import {
	type InspectState,
	type ConstraintInfo,
	computeInspectState,
} from "../shared.js";

// Re-export for convenience
export type { RequirementTypeStatus, InspectState, ConstraintInfo };
export { shallowEqual } from "../../utils/utils.js";

/** Type for the requirement status plugin return value */
export type StatusPlugin = ReturnType<typeof createRequirementStatusPlugin>;

// ============================================================================
// Internal Helpers
// ============================================================================

/** Default equality function using Object.is */
function defaultEquality<T>(a: T, b: T): boolean {
	return Object.is(a, b);
}

/** Sentinel value for uninitialized selector cache */
const UNINITIALIZED = Symbol("directive.uninitialized");

// ============================================================================
// useFact — single key or multi key
// ============================================================================

/** Single key overload */
export function useFact<S extends ModuleSchema, K extends keyof InferFacts<S> & string>(
	system: SingleModuleSystem<S>,
	factKey: K,
): InferFacts<S>[K] | undefined;

/** Multi-key overload */
export function useFact<S extends ModuleSchema, K extends keyof InferFacts<S> & string>(
	system: SingleModuleSystem<S>,
	factKeys: K[],
): Pick<InferFacts<S>, K>;

/** Implementation */
export function useFact(
	// biome-ignore lint/suspicious/noExplicitAny: Implementation signature
	system: SingleModuleSystem<any>,
	keyOrKeys: string | string[],
): unknown {
	if (process.env.NODE_ENV !== "production" && typeof keyOrKeys === "function") {
		console.error(
			"[Directive] useFact() received a function. Did you mean useSelector()? " +
				"useFact() takes a string key or array of keys, not a selector function.",
		);
	}

	// Multi-key path: useFact(system, [keys])
	if (Array.isArray(keyOrKeys)) {
		return _useFacts(system, keyOrKeys);
	}

	// Single key path: useFact(system, key)
	return _useSingleFact(system, keyOrKeys);
}

function _useSingleFact(
	// biome-ignore lint/suspicious/noExplicitAny: Internal
	system: SingleModuleSystem<any>,
	factKey: string,
): unknown {
	if (process.env.NODE_ENV !== "production") {
		if (!(factKey in system.facts.$store.toObject())) {
			console.warn(
				`[Directive] useFact("${factKey}") — fact not found in store. ` +
					`Check that "${factKey}" is defined in your module's schema.`,
			);
		}
	}

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.facts.$store.subscribe([factKey], onStoreChange);
		},
		[system, factKey],
	);

	const getSnapshot = useCallback(() => {
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic fact access
		return (system.facts as any)[factKey];
	}, [system, factKey]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function _useFacts(
	// biome-ignore lint/suspicious/noExplicitAny: Internal
	system: SingleModuleSystem<any>,
	factKeys: string[],
): Record<string, unknown> {
	const cachedValue = useRef<Record<string, unknown> | typeof UNINITIALIZED>(UNINITIALIZED);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return system.facts.$store.subscribe(factKeys, onStoreChange);
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[system, ...factKeys],
	);

	const getSnapshot = useCallback(() => {
		const result: Record<string, unknown> = {};
		for (const key of factKeys) {
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic fact access
			result[key] = (system.facts as any)[key];
		}

		if (cachedValue.current !== UNINITIALIZED) {
			let same = true;
			for (const key of factKeys) {
				if (!Object.is((cachedValue.current as Record<string, unknown>)[key], result[key])) {
					same = false;
					break;
				}
			}
			if (same) return cachedValue.current;
		}

		cachedValue.current = result;
		return result;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [system, ...factKeys]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// useDerived — single key or multi key
// ============================================================================

/** Single key overload */
export function useDerived<S extends ModuleSchema, K extends keyof InferDerivations<S> & string>(
	system: SingleModuleSystem<S>,
	derivationId: K,
): InferDerivations<S>[K];

/** Multi-key overload */
export function useDerived<
	S extends ModuleSchema,
	K extends keyof InferDerivations<S> & string,
>(
	system: SingleModuleSystem<S>,
	derivationIds: K[],
): Pick<InferDerivations<S>, K>;

/** Implementation */
export function useDerived(
	// biome-ignore lint/suspicious/noExplicitAny: Implementation signature
	system: SingleModuleSystem<any>,
	keyOrKeys: string | string[],
): unknown {
	if (process.env.NODE_ENV !== "production" && typeof keyOrKeys === "function") {
		console.error(
			"[Directive] useDerived() received a function. Did you mean useSelector()? " +
				"useDerived() takes a string key or array of keys, not a selector function.",
		);
	}

	// Multi-key path
	if (Array.isArray(keyOrKeys)) {
		return _useDerivedMulti(system, keyOrKeys);
	}

	// Single key path
	return _useSingleDerived(system, keyOrKeys);
}

function _useSingleDerived(
	// biome-ignore lint/suspicious/noExplicitAny: Internal
	system: SingleModuleSystem<any>,
	derivationId: string,
): unknown {
	if (process.env.NODE_ENV !== "production") {
		if (!(derivationId in system.derive)) {
			console.warn(
				`[Directive] useDerived("${derivationId}") — derivation not found. ` +
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
		return system.read(derivationId);
	}, [system, derivationId]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function _useDerivedMulti(
	// biome-ignore lint/suspicious/noExplicitAny: Internal
	system: SingleModuleSystem<any>,
	derivationIds: string[],
): Record<string, unknown> {
	const cachedValue = useRef<Record<string, unknown> | typeof UNINITIALIZED>(UNINITIALIZED);

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

		if (cachedValue.current !== UNINITIALIZED) {
			let same = true;
			for (const id of derivationIds) {
				if (!Object.is((cachedValue.current as Record<string, unknown>)[id], result[id])) {
					same = false;
					break;
				}
			}
			if (same) return cachedValue.current;
		}

		cachedValue.current = result;
		return result;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [system, ...derivationIds]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// useSelector — cross-fact Zustand-style selector
// ============================================================================

/**
 * Auto-tracking cross-fact selector (Zustand-style).
 * Uses `withTracking()` to detect which facts the selector accesses,
 * then subscribes only to those keys. Falls back to subscribeAll
 * if no keys are detected.
 */
export function useSelector<S extends ModuleSchema, R>(
	system: SingleModuleSystem<S>,
	selector: (facts: InferFacts<S>) => R,
	equalityFn?: (a: R, b: R) => boolean,
): R;
export function useSelector<R>(
	// biome-ignore lint/suspicious/noExplicitAny: Backward-compatible fallback
	system: SingleModuleSystem<any>,
	// biome-ignore lint/suspicious/noExplicitAny: Selector receives dynamic facts
	selector: (facts: Record<string, any>) => R,
	equalityFn?: (a: R, b: R) => boolean,
): R;
export function useSelector(
	// biome-ignore lint/suspicious/noExplicitAny: Implementation signature
	system: SingleModuleSystem<any>,
	// biome-ignore lint/suspicious/noExplicitAny: Implementation signature
	selector: (state: any) => unknown,
	equalityFn?: (a: unknown, b: unknown) => boolean,
): unknown {
	// Store selector/eq in refs to avoid resubscription churn
	const selectorRef = useRef(selector);
	const eqRef = useRef(equalityFn ?? defaultEquality);
	selectorRef.current = selector;
	eqRef.current = equalityFn ?? defaultEquality;

	const trackedFactKeysRef = useRef<string[]>([]);
	const trackedDeriveKeysRef = useRef<string[]>([]);
	const cachedValue = useRef<unknown>(UNINITIALIZED);
	const unsubsRef = useRef<Array<() => void>>([]);

	// Build a tracking-aware state proxy that exposes both facts and derivations
	const deriveKeys = useMemo(() => new Set(Object.keys(system.derive)), [system]);

	const runWithTracking = useCallback(() => {
		const accessedDeriveKeys: string[] = [];

		// Create a proxy that intercepts property access for both facts and derivations
		const stateProxy = new Proxy(
			{},
			{
				get(_, prop: string | symbol) {
					if (typeof prop !== "string") return undefined;
					// Derivation keys take priority to avoid collisions
					if (deriveKeys.has(prop)) {
						accessedDeriveKeys.push(prop);
						return system.read(prop);
					}
					// Falls through to fact access via store.get() which calls trackAccess()
					return system.facts.$store.get(prop);
				},
				has(_, prop: string | symbol) {
					if (typeof prop !== "string") return false;
					return deriveKeys.has(prop) || system.facts.$store.has(prop);
				},
				ownKeys() {
					return [
						...Object.keys(system.facts.$store.toObject()),
						...deriveKeys,
					];
				},
				getOwnPropertyDescriptor() {
					return { configurable: true, enumerable: true, writable: true };
				},
			},
		);

		const { value, deps } = withTracking(() => selectorRef.current(stateProxy));
		const factKeys = Array.from(deps) as string[];

		return { value, factKeys, deriveKeys: accessedDeriveKeys };
	}, [system, deriveKeys]);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			const resubscribe = () => {
				// Cleanup previous subscriptions
				for (const unsub of unsubsRef.current) unsub();
				unsubsRef.current = [];

				// Run selector with tracking to detect accessed keys
				const { factKeys, deriveKeys: derivedKeys } = runWithTracking();
				trackedFactKeysRef.current = factKeys;
				trackedDeriveKeysRef.current = derivedKeys;

				// Subscribe to accessed fact keys
				if (factKeys.length > 0) {
					unsubsRef.current.push(
						system.facts.$store.subscribe(factKeys, () => {
							// Re-track on notification for dynamic deps
							const updated = runWithTracking();
							const factsChanged =
								updated.factKeys.length !== trackedFactKeysRef.current.length ||
								updated.factKeys.some((k, i) => k !== trackedFactKeysRef.current[i]);
							const derivedChanged =
								updated.deriveKeys.length !== trackedDeriveKeysRef.current.length ||
								updated.deriveKeys.some((k, i) => k !== trackedDeriveKeysRef.current[i]);

							if (factsChanged || derivedChanged) {
								resubscribe();
							}
							onStoreChange();
						}),
					);
				} else if (derivedKeys.length === 0) {
					// No deps at all — subscribe to everything
					unsubsRef.current.push(
						system.facts.$store.subscribeAll(onStoreChange),
					);
				}

				// Subscribe to accessed derivation keys
				if (derivedKeys.length > 0) {
					unsubsRef.current.push(
						system.subscribe(derivedKeys, () => {
							// Re-track on notification for dynamic deps
							const updated = runWithTracking();
							const factsChanged =
								updated.factKeys.length !== trackedFactKeysRef.current.length ||
								updated.factKeys.some((k, i) => k !== trackedFactKeysRef.current[i]);
							const derivedChanged =
								updated.deriveKeys.length !== trackedDeriveKeysRef.current.length ||
								updated.deriveKeys.some((k, i) => k !== trackedDeriveKeysRef.current[i]);

							if (factsChanged || derivedChanged) {
								resubscribe();
							}
							onStoreChange();
						}),
					);
				}
			};

			resubscribe();

			return () => {
				for (const unsub of unsubsRef.current) unsub();
				unsubsRef.current = [];
			};
		},
		[system, runWithTracking],
	);

	const getSnapshot = useCallback(() => {
		const { value: newValue } = runWithTracking();

		if (
			cachedValue.current !== UNINITIALIZED &&
			eqRef.current(cachedValue.current, newValue)
		) {
			return cachedValue.current;
		}
		cachedValue.current = newValue;
		return newValue;
	}, [runWithTracking]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// useDispatch
// ============================================================================

export function useDispatch<S extends ModuleSchema>(
	system: SingleModuleSystem<S>,
): (event: InferEvents<S>) => void {
	return useCallback(
		(event: InferEvents<S>) => {
			system.dispatch(event);
		},
		[system],
	);
}

// ============================================================================
// useWatch — derivation or fact side-effect (no re-render)
// ============================================================================

/** Watch a fact or derivation (auto-detected) */
export function useWatch<
	S extends ModuleSchema,
	K extends keyof InferDerivations<S> & string,
>(
	system: SingleModuleSystem<S>,
	key: K,
	callback: (
		newValue: InferDerivations<S>[K],
		prevValue: InferDerivations<S>[K] | undefined,
	) => void,
): void;

/**
 * Watch a fact by explicit "fact" discriminator.
 * @deprecated Use `useWatch(system, key, callback)` instead — facts are now auto-detected.
 */
export function useWatch<
	S extends ModuleSchema,
	K extends keyof InferFacts<S> & string,
>(
	system: SingleModuleSystem<S>,
	kind: "fact",
	factKey: K,
	callback: (
		newValue: InferFacts<S>[K] | undefined,
		prevValue: InferFacts<S>[K] | undefined,
	) => void,
): void;

/** Watch a fact or derivation (generic fallback) */
export function useWatch<T>(
	// biome-ignore lint/suspicious/noExplicitAny: Backward-compatible fallback
	system: SingleModuleSystem<any>,
	key: string,
	callback: (newValue: T, prevValue: T | undefined) => void,
): void;

/** Implementation */
export function useWatch(
	// biome-ignore lint/suspicious/noExplicitAny: Implementation signature
	system: SingleModuleSystem<any>,
	derivationIdOrKind: string,
	// biome-ignore lint/suspicious/noExplicitAny: Implementation overload dispatch
	callbackOrFactKey: string | ((newValue: any, prevValue: any) => void),
	// biome-ignore lint/suspicious/noExplicitAny: Implementation overload dispatch
	maybeCallback?: (newValue: any, prevValue: any) => void,
): void {
	// Backward compat: useWatch(system, "fact", factKey, callback)
	const isFact =
		derivationIdOrKind === "fact" &&
		typeof callbackOrFactKey === "string" &&
		typeof maybeCallback === "function";
	const key = isFact ? (callbackOrFactKey as string) : derivationIdOrKind;
	const callback = isFact
		// biome-ignore lint/suspicious/noExplicitAny: Implementation overload dispatch
		? (maybeCallback as (newValue: any, prevValue: any) => void)
		// biome-ignore lint/suspicious/noExplicitAny: Implementation overload dispatch
		: (callbackOrFactKey as (newValue: any, prevValue: any) => void);

	const callbackRef = useRef(callback);
	callbackRef.current = callback;

	useEffect(() => {
		return system.watch(key, (newValue, prevValue) => {
			callbackRef.current(newValue, prevValue);
		});
	}, [system, key]);
}

// ============================================================================
// useInspect — consolidated inspection hook
// ============================================================================

// InspectState is imported from ./shared.js and re-exported above

/** Options for useInspect */
export interface UseInspectOptions {
	/** Throttle updates to this interval (ms). When set, uses useState instead of useSyncExternalStore. */
	throttleMs?: number;
}

/**
 * Hook to get consolidated system inspection data reactively.
 *
 * Merges isSettled, unmet/inflight requirements, and working state
 * into a single subscription. Optionally throttle updates.
 *
 * @example
 * ```tsx
 * const { isSettled, isWorking, hasUnmet } = useInspect(system);
 * const throttled = useInspect(system, { throttleMs: 200 });
 * ```
 */
export function useInspect(
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	system: SingleModuleSystem<any>,
	options?: UseInspectOptions,
): InspectState {
	// Always call the sync version (useSyncExternalStore path) — no conditional hooks
	const syncState = _useInspectSync(system);

	// Throttle is a ref-based overlay, not a separate hook path
	const throttleMs = options?.throttleMs;
	const throttledState = useRef(syncState);
	const lastUpdate = useRef(0);

	if (!throttleMs || throttleMs <= 0) return syncState;

	const now = Date.now();
	if (now - lastUpdate.current >= throttleMs) {
		throttledState.current = syncState;
		lastUpdate.current = now;
	}
	return throttledState.current;
}

function _buildInspectState(
	// biome-ignore lint/suspicious/noExplicitAny: Internal
	system: SingleModuleSystem<any>,
): InspectState {
	return computeInspectState(system as unknown as System<any>);
}

function _useInspectSync(
	// biome-ignore lint/suspicious/noExplicitAny: Internal
	system: SingleModuleSystem<any>,
): InspectState {
	const cachedSnapshot = useRef<InspectState | null>(null);
	const cachedUnmetIds = useRef<string[]>([]);
	const cachedInflightIds = useRef<string[]>([]);
	const cachedIsSettled = useRef<boolean | null>(null);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			const unsubFacts = system.facts.$store.subscribeAll(onStoreChange);
			const unsubSettled = system.onSettledChange(onStoreChange);
			return () => {
				unsubFacts();
				unsubSettled();
			};
		},
		[system],
	);

	const getSnapshot = useCallback(() => {
		const state = _buildInspectState(system);

		const unmetSame =
			state.unmet.length === cachedUnmetIds.current.length &&
			state.unmet.every((u, i) => u.id === cachedUnmetIds.current[i]);
		const inflightSame =
			state.inflight.length === cachedInflightIds.current.length &&
			state.inflight.every((f, i) => f.id === cachedInflightIds.current[i]);
		const settledSame = state.isSettled === cachedIsSettled.current;

		if (unmetSame && inflightSame && settledSame && cachedSnapshot.current) {
			return cachedSnapshot.current;
		}

		cachedSnapshot.current = state;
		cachedUnmetIds.current = state.unmet.map((u) => u.id);
		cachedInflightIds.current = state.inflight.map((f) => f.id);
		cachedIsSettled.current = state.isSettled;

		return state;
	}, [system]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}


// ============================================================================
// useTimeTravel — reactive time-travel state
// ============================================================================

import type { TimeTravelState } from "../../core/types.js";

/**
 * Reactive time-travel hook. Returns null when time-travel is disabled.
 * Re-renders when snapshots are taken or navigation occurs.
 *
 * @example
 * ```tsx
 * const tt = useTimeTravel(system);
 * if (tt) {
 *   return (
 *     <div>
 *       <button disabled={!tt.canUndo} onClick={tt.undo}>Undo</button>
 *       <button disabled={!tt.canRedo} onClick={tt.redo}>Redo</button>
 *       <span>{tt.currentIndex + 1} / {tt.totalSnapshots}</span>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTimeTravel(
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	system: SingleModuleSystem<any>,
): TimeTravelState | null {
	const cachedRef = useRef<TimeTravelState | null>(null);

	const subscribe = useCallback(
		(onStoreChange: () => void) => system.onTimeTravelChange(onStoreChange),
		[system],
	);

	const getSnapshot = useCallback(() => {
		const debug = system.debug;
		if (!debug) return null;

		const canUndo = debug.currentIndex > 0;
		const canRedo = debug.currentIndex < debug.snapshots.length - 1;
		const currentIndex = debug.currentIndex;
		const totalSnapshots = debug.snapshots.length;

		// Return stable reference when values haven't changed
		if (
			cachedRef.current &&
			cachedRef.current.canUndo === canUndo &&
			cachedRef.current.canRedo === canRedo &&
			cachedRef.current.currentIndex === currentIndex &&
			cachedRef.current.totalSnapshots === totalSnapshots
		) {
			return cachedRef.current;
		}

		cachedRef.current = {
			canUndo,
			canRedo,
			undo: () => debug.goBack(),
			redo: () => debug.goForward(),
			currentIndex,
			totalSnapshots,
		};
		return cachedRef.current;
	}, [system]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// useRequirementStatus — single or multi
// ============================================================================

/** Single type overload */
export function useRequirementStatus(
	statusPlugin: StatusPlugin,
	type: string,
): RequirementTypeStatus;

/** Multi-type overload */
export function useRequirementStatus(
	statusPlugin: StatusPlugin,
	types: string[],
): Record<string, RequirementTypeStatus>;

/** Implementation */
export function useRequirementStatus(
	statusPlugin: StatusPlugin,
	typeOrTypes: string | string[],
): RequirementTypeStatus | Record<string, RequirementTypeStatus> {
	if (Array.isArray(typeOrTypes)) {
		return _useRequirementStatusMulti(statusPlugin, typeOrTypes);
	}
	return _useRequirementStatusSingle(statusPlugin, typeOrTypes);
}

function _useRequirementStatusSingle(
	statusPlugin: StatusPlugin,
	type: string,
): RequirementTypeStatus {
	const cachedRef = useRef<RequirementTypeStatus | typeof UNINITIALIZED>(UNINITIALIZED);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return statusPlugin.subscribe(onStoreChange);
		},
		[statusPlugin],
	);

	const getSnapshot = useCallback(() => {
		const status = statusPlugin.getStatus(type);

		if (cachedRef.current !== UNINITIALIZED) {
			const prev = cachedRef.current;
			if (
				prev.pending === status.pending &&
				prev.inflight === status.inflight &&
				prev.failed === status.failed &&
				prev.isLoading === status.isLoading &&
				prev.hasError === status.hasError &&
				prev.lastError === status.lastError
			) {
				return cachedRef.current;
			}
		}

		cachedRef.current = status;
		return status;
	}, [statusPlugin, type]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function _useRequirementStatusMulti(
	statusPlugin: StatusPlugin,
	types: string[],
): Record<string, RequirementTypeStatus> {
	const cachedRef = useRef<Record<string, RequirementTypeStatus> | null>(null);
	const cachedKey = useRef<string>("");

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			return statusPlugin.subscribe(onStoreChange);
		},
		[statusPlugin],
	);

	const getSnapshot = useCallback(() => {
		const result: Record<string, RequirementTypeStatus> = {};
		const parts: string[] = [];
		for (const type of types) {
			const status = statusPlugin.getStatus(type);
			result[type] = status;
			parts.push(`${type}:${status.pending}:${status.inflight}:${status.failed}:${status.hasError}:${status.lastError?.message ?? ""}`);
		}
		const key = parts.join("|");

		if (key !== cachedKey.current) {
			cachedKey.current = key;
			cachedRef.current = result;
		}

		return cachedRef.current ?? result;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [statusPlugin, ...types]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// useSuspenseRequirement — single or multi
// ============================================================================

// Cache for pending promises, scoped per statusPlugin to prevent cross-system leaks.
const suspenseCacheMap = new WeakMap<StatusPlugin, Map<string, Promise<void>>>();

function getSuspenseCache(plugin: StatusPlugin): Map<string, Promise<void>> {
	let cache = suspenseCacheMap.get(plugin);
	if (!cache) {
		cache = new Map();
		suspenseCacheMap.set(plugin, cache);
	}
	return cache;
}

/** Single type overload */
export function useSuspenseRequirement(
	statusPlugin: StatusPlugin,
	type: string,
): RequirementTypeStatus;

/** Multi-type overload */
export function useSuspenseRequirement(
	statusPlugin: StatusPlugin,
	types: string[],
): Record<string, RequirementTypeStatus>;

/** Implementation */
export function useSuspenseRequirement(
	statusPlugin: StatusPlugin,
	typeOrTypes: string | string[],
): RequirementTypeStatus | Record<string, RequirementTypeStatus> {
	if (Array.isArray(typeOrTypes)) {
		return _useSuspenseRequirementMulti(statusPlugin, typeOrTypes);
	}
	return _useSuspenseRequirementSingle(statusPlugin, typeOrTypes);
}

function _useSuspenseRequirementSingle(
	statusPlugin: StatusPlugin,
	type: string,
): RequirementTypeStatus {
	const status = statusPlugin.getStatus(type);

	if (status.hasError && status.lastError) {
		throw status.lastError;
	}

	if (status.isLoading) {
		const cache = getSuspenseCache(statusPlugin);
		let promise = cache.get(type);

		if (!promise) {
			promise = new Promise<void>((resolve) => {
				const unsubscribe = statusPlugin.subscribe(() => {
					const currentStatus = statusPlugin.getStatus(type);
					if (!currentStatus.isLoading) {
						cache.delete(type);
						unsubscribe();
						resolve();
					}
				});
			});
			cache.set(type, promise);
		}

		throw promise;
	}

	return status;
}

function _useSuspenseRequirementMulti(
	statusPlugin: StatusPlugin,
	types: string[],
): Record<string, RequirementTypeStatus> {
	const result: Record<string, RequirementTypeStatus> = {};
	let hasLoading = false;
	let firstError: Error | null = null;

	for (const type of types) {
		const status = statusPlugin.getStatus(type);
		result[type] = status;

		if (status.hasError && status.lastError && !firstError) {
			firstError = status.lastError;
		}
		if (status.isLoading) {
			hasLoading = true;
		}
	}

	if (firstError) {
		throw firstError;
	}

	if (hasLoading) {
		const cache = getSuspenseCache(statusPlugin);
		const cacheKey = types.slice().sort().join(",");
		let promise = cache.get(cacheKey);

		if (!promise) {
			promise = new Promise<void>((resolve) => {
				const unsubscribe = statusPlugin.subscribe(() => {
					const allDone = types.every((t) => !statusPlugin.getStatus(t).isLoading);
					if (allDone) {
						cache.delete(cacheKey);
						unsubscribe();
						resolve();
					}
				});
			});
			cache.set(cacheKey, promise);
		}

		throw promise;
	}

	return result;
}

// ============================================================================
// useDirectiveRef — scoped system lifecycle
// ============================================================================

/** Base options for creating a scoped system */
interface DirectiveRefBaseConfig {
	// biome-ignore lint/suspicious/noExplicitAny: Plugin types vary
	plugins?: Plugin<any>[];
	debug?: DebugConfig;
	errorBoundary?: ErrorBoundaryConfig;
	tickMs?: number;
	zeroConfig?: boolean;
	// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
	initialFacts?: Record<string, any>;
}

/** Options for useDirectiveRef: module directly, or config object */
export type UseDirectiveRefOptions<M extends ModuleSchema> =
	| ModuleDef<M>
	| (DirectiveRefBaseConfig & { module: ModuleDef<M> });

/** Without status (no config): returns system directly */
export function useDirectiveRef<M extends ModuleSchema>(
	options: UseDirectiveRefOptions<M>,
): SingleModuleSystem<M>;

/** Without status (with config): returns system directly */
export function useDirectiveRef<M extends ModuleSchema>(
	options: UseDirectiveRefOptions<M>,
	config: DirectiveRefBaseConfig,
): SingleModuleSystem<M>;

/** With status: returns { system, statusPlugin } */
export function useDirectiveRef<M extends ModuleSchema>(
	options: UseDirectiveRefOptions<M>,
	config: { status: true } & DirectiveRefBaseConfig,
): { system: SingleModuleSystem<M>; statusPlugin: StatusPlugin };

/** Implementation */
export function useDirectiveRef<M extends ModuleSchema>(
	options: UseDirectiveRefOptions<M>,
	config?: { status?: boolean } & DirectiveRefBaseConfig,
): SingleModuleSystem<M> | { system: SingleModuleSystem<M>; statusPlugin: StatusPlugin } {
	const systemRef = useRef<SingleModuleSystem<M> | null>(null);
	const statusPluginRef = useRef<StatusPlugin | null>(null);
	const wantStatus = config?.status === true;

	if (!systemRef.current) {
		const isModule = "id" in options && "schema" in options;
		const mod = isModule ? (options as ModuleDef<M>) : (options as { module: ModuleDef<M> }).module;
		const baseOpts = isModule ? {} : (options as DirectiveRefBaseConfig);
		// Merge config-level options over options-level (config takes precedence)
		const plugins = config?.plugins ?? baseOpts.plugins ?? [];
		const debug = config?.debug ?? baseOpts.debug;
		const errorBoundary = config?.errorBoundary ?? baseOpts.errorBoundary;
		const tickMs = config?.tickMs ?? baseOpts.tickMs;
		const zeroConfig = config?.zeroConfig ?? baseOpts.zeroConfig;
		const initialFacts = config?.initialFacts ?? baseOpts.initialFacts;

		let allPlugins = [...plugins];

		if (wantStatus) {
			statusPluginRef.current = createRequirementStatusPlugin();
			// biome-ignore lint/suspicious/noExplicitAny: Plugin generic issues
			allPlugins = [...allPlugins, statusPluginRef.current.plugin as Plugin<any>];
		}

		// biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
		systemRef.current = createSystem({
			module: mod,
			plugins: allPlugins.length > 0 ? allPlugins : undefined,
			debug,
			errorBoundary,
			tickMs,
			zeroConfig,
			initialFacts,
		} as any) as unknown as SingleModuleSystem<M>;

	}

	useEffect(() => {
		const sys = systemRef.current;
		sys?.start();
		return () => {
			sys?.destroy();
			systemRef.current = null;
			statusPluginRef.current = null;
		};
	}, []);

	if (wantStatus) {
		return {
			system: systemRef.current!,
			statusPlugin: statusPluginRef.current!,
		};
	}

	return systemRef.current!;
}

// ============================================================================
// useDirective — scoped system with selected values in containers
// ============================================================================

/** Options for useDirective hook */
export interface UseDirectiveOptions<
	S extends ModuleSchema,
	FK extends keyof InferFacts<S> & string = never,
	DK extends keyof InferDerivations<S> & string = never,
> extends DirectiveRefBaseConfig {
	/** Fact keys to subscribe to */
	facts?: FK[];
	/** Derivation keys to subscribe to */
	derived?: DK[];
	/** Enable status plugin */
	status?: boolean;
}

/** Return type for useDirective hook (without status) */
export type UseDirectiveReturn<
	S extends ModuleSchema,
	FK extends keyof InferFacts<S> & string,
	DK extends keyof InferDerivations<S> & string,
> = {
	system: SingleModuleSystem<S>;
	dispatch: (event: InferEvents<S>) => void;
	events: SingleModuleSystem<S>["events"];
	facts: Pick<InferFacts<S>, FK>;
	derived: Pick<InferDerivations<S>, DK>;
};

/** Return type for useDirective hook (with status) */
export type UseDirectiveReturnWithStatus<
	S extends ModuleSchema,
	FK extends keyof InferFacts<S> & string,
	DK extends keyof InferDerivations<S> & string,
> = UseDirectiveReturn<S, FK, DK> & {
	statusPlugin: StatusPlugin;
};

/**
 * Convenience hook that creates a scoped system and reads selected facts/derivations
 * into container objects. When no `facts` or `derived` keys are specified, subscribes
 * to ALL facts and derivations (replacing the former `useModule` hook).
 *
 * @example
 * ```tsx
 * // Selective subscription
 * const { dispatch, facts: { count }, derived: { doubled } } = useDirective(counterModule, {
 *   facts: ["count"],
 *   derived: ["doubled"],
 * });
 *
 * // Subscribe to everything (no keys = all facts + all derivations)
 * const { facts, derived, events, dispatch } = useDirective(counterModule);
 * ```
 */
export function useDirective<
	S extends ModuleSchema,
	FK extends keyof InferFacts<S> & string = never,
	DK extends keyof InferDerivations<S> & string = never,
>(
	moduleOrOptions: UseDirectiveRefOptions<S>,
	selections: UseDirectiveOptions<S, FK, DK> = {} as UseDirectiveOptions<S, FK, DK>,
): UseDirectiveReturn<S, FK, DK> | UseDirectiveReturnWithStatus<S, FK, DK> {
	const { facts: factKeysOpt, derived: derivedKeysOpt, status, ...configRest } = selections;
	const factKeys = (factKeysOpt ?? []) as FK[];
	const derivedKeys = (derivedKeysOpt ?? []) as DK[];

	// When no keys are specified, subscribe to everything
	const subscribeAll = factKeys.length === 0 && derivedKeys.length === 0;

	// Create system via useDirectiveRef (handles lifecycle)
	// biome-ignore lint/suspicious/noExplicitAny: Conditional overload dispatch
	const refResult: any = status
		? useDirectiveRef(moduleOrOptions, { status: true as const, ...configRest })
		: useDirectiveRef(moduleOrOptions, configRest);

	const system: SingleModuleSystem<S> = status
		? refResult.system
		: refResult;

	const statusPlugin = status
		? (refResult as { system: SingleModuleSystem<S>; statusPlugin: StatusPlugin }).statusPlugin
		: undefined;

	// For subscribe-all mode, get all derivation keys
	const allDerivationKeys = useMemo(
		() => (subscribeAll ? Object.keys(system.derive) : []),
		[system, subscribeAll],
	);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			const unsubs: Array<() => void> = [];
			if (subscribeAll) {
				// Subscribe to ALL facts and ALL derivations
				unsubs.push(system.facts.$store.subscribeAll(onStoreChange));
				if (allDerivationKeys.length > 0) {
					unsubs.push(system.subscribe(allDerivationKeys, onStoreChange));
				}
			} else {
				if (factKeys.length > 0) {
					unsubs.push(system.facts.$store.subscribe(factKeys, onStoreChange));
				}
				if (derivedKeys.length > 0) {
					unsubs.push(system.subscribe(derivedKeys, onStoreChange));
				}
			}
			return () => {
				for (const unsub of unsubs) unsub();
			};
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[system, subscribeAll, ...factKeys, ...derivedKeys, ...allDerivationKeys],
	);

	const cachedFacts = useRef<Record<string, unknown> | typeof UNINITIALIZED>(UNINITIALIZED);
	const cachedDerived = useRef<Record<string, unknown> | typeof UNINITIALIZED>(UNINITIALIZED);
	const cachedWrapper = useRef<{ facts: Record<string, unknown>; derived: Record<string, unknown> } | null>(null);

	const getSnapshot = useCallback(() => {
		let factsResult: Record<string, unknown>;
		let derivedResult: Record<string, unknown>;
		let effectiveFactKeys: readonly string[];
		let effectiveDerivedKeys: readonly string[];

		if (subscribeAll) {
			// Read ALL facts and ALL derivations
			factsResult = system.facts.$store.toObject();
			effectiveFactKeys = Object.keys(factsResult);
			derivedResult = {};
			for (const key of allDerivationKeys) {
				derivedResult[key] = system.read(key);
			}
			effectiveDerivedKeys = allDerivationKeys;
		} else {
			// Read selected keys only
			factsResult = {};
			for (const key of factKeys) {
				// biome-ignore lint/suspicious/noExplicitAny: Dynamic fact access
				factsResult[key] = (system.facts as any)[key];
			}
			effectiveFactKeys = factKeys;
			derivedResult = {};
			for (const key of derivedKeys) {
				derivedResult[key] = system.read(key);
			}
			effectiveDerivedKeys = derivedKeys;
		}

		// Check facts stability
		let factsSame = cachedFacts.current !== UNINITIALIZED;
		if (factsSame) {
			const prev = cachedFacts.current as Record<string, unknown>;
			const prevKeys = Object.keys(prev);
			if (prevKeys.length !== effectiveFactKeys.length) {
				factsSame = false;
			} else {
				for (const key of effectiveFactKeys) {
					if (!Object.is(prev[key], factsResult[key])) {
						factsSame = false;
						break;
					}
				}
			}
		}

		// Check derived stability
		let derivedSame = cachedDerived.current !== UNINITIALIZED;
		if (derivedSame) {
			const prev = cachedDerived.current as Record<string, unknown>;
			const prevKeys = Object.keys(prev);
			if (prevKeys.length !== effectiveDerivedKeys.length) {
				derivedSame = false;
			} else {
				for (const key of effectiveDerivedKeys) {
					if (!Object.is(prev[key], derivedResult[key])) {
						derivedSame = false;
						break;
					}
				}
			}
		}

		const stableFacts = factsSame ? cachedFacts.current as Record<string, unknown> : factsResult;
		const stableDerived = derivedSame ? cachedDerived.current as Record<string, unknown> : derivedResult;

		if (!factsSame) cachedFacts.current = factsResult;
		if (!derivedSame) cachedDerived.current = derivedResult;

		// Return same wrapper reference when both containers are unchanged
		if (factsSame && derivedSame && cachedWrapper.current) {
			return cachedWrapper.current;
		}

		cachedWrapper.current = { facts: stableFacts, derived: stableDerived };
		return cachedWrapper.current;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [system, subscribeAll, ...factKeys, ...derivedKeys, ...allDerivationKeys]);

	const values = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	const dispatch = useCallback(
		(event: InferEvents<S>) => system.dispatch(event),
		[system],
	);

	const events = useEvents(system);

	const base = {
		system,
		dispatch,
		events,
		facts: values.facts as Pick<InferFacts<S>, FK>,
		derived: values.derived as Pick<InferDerivations<S>, DK>,
	};

	if (status && statusPlugin) {
		return { ...base, statusPlugin } as UseDirectiveReturnWithStatus<S, FK, DK>;
	}

	return base as UseDirectiveReturn<S, FK, DK>;
}

// ============================================================================
// DevTools Component
// ============================================================================

/** Props for DirectiveDevTools component */
export interface DirectiveDevToolsProps {
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	system: SingleModuleSystem<any>;
	/** Position of the panel */
	position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
	/** Whether the panel starts open */
	defaultOpen?: boolean;
}

/**
 * Dev-only floating panel that shows system state.
 * Tree-shaken in production builds via `process.env.NODE_ENV` check.
 */
export function DirectiveDevTools({
	system,
	position = "bottom-right",
	defaultOpen = false,
}: DirectiveDevToolsProps): ReturnType<typeof import("react").createElement> | null {
	const [isOpen, setIsOpen] = useState(defaultOpen);
	const closeButtonRef = useRef<HTMLButtonElement | null>(null);
	const { isSettled, unmet, inflight } = useInspect(system);

	// Auto-focus close button when panel opens
	useEffect(() => {
		if (isOpen && closeButtonRef.current) {
			closeButtonRef.current.focus();
		}
	}, [isOpen]);

	// Facts subscription for devtools
	const factsSubscribe = useCallback(
		(onStoreChange: () => void) => system.facts.$store.subscribeAll(onStoreChange),
		[system],
	);
	const factsRef = useRef<Record<string, unknown> | typeof UNINITIALIZED>(UNINITIALIZED);
	const getFactsSnapshot = useCallback(() => {
		const current = system.facts.$store.toObject();
		if (factsRef.current !== UNINITIALIZED) {
			const prevKeys = Object.keys(factsRef.current as Record<string, unknown>);
			const currKeys = Object.keys(current);
			if (prevKeys.length === currKeys.length) {
				let same = true;
				for (const key of currKeys) {
					if (!Object.is((factsRef.current as Record<string, unknown>)[key], current[key])) {
						same = false;
						break;
					}
				}
				if (same) return factsRef.current as Record<string, unknown>;
			}
		}
		factsRef.current = current;
		return current;
	}, [system]);
	const facts = useSyncExternalStore(factsSubscribe, getFactsSnapshot, getFactsSnapshot);

	if (process.env.NODE_ENV === "production") return null;

	const positionStyles: Record<string, string | number> = {
		position: "fixed",
		zIndex: 99999,
		...(position.includes("bottom") ? { bottom: 12 } : { top: 12 }),
		...(position.includes("right") ? { right: 12 } : { left: 12 }),
	};

	if (!isOpen) {
		return (
			<button
				type="button"
				onClick={() => setIsOpen(true)}
				aria-label={`Open Directive DevTools${isSettled ? "" : " (system working)"}`}
				aria-expanded={false}
				style={{
					...positionStyles,
					background: "#1a1a2e",
					color: "#e0e0e0",
					border: "1px solid #333",
					borderRadius: 6,
					padding: "6px 12px",
					cursor: "pointer",
					fontFamily: "monospace",
					fontSize: 12,
				}}
			>
				{isSettled ? "Directive" : "Directive..."}
			</button>
		);
	}

	const derivationKeys = Object.keys(system.derive);
	const derivations: Record<string, unknown> = {};
	for (const key of derivationKeys) {
		try {
			derivations[key] = system.read(key);
		} catch {
			derivations[key] = "<error>";
		}
	}

	return (
		<div
			role="region"
			aria-label="Directive DevTools"
			tabIndex={-1}
			onKeyDown={(e) => {
				if (e.key === "Escape") setIsOpen(false);
			}}
			style={{
				...positionStyles,
				background: "#1a1a2e",
				color: "#e0e0e0",
				border: "1px solid #333",
				borderRadius: 8,
				padding: 12,
				fontFamily: "monospace",
				fontSize: 11,
				maxWidth: 380,
				maxHeight: 500,
				overflow: "auto",
				boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
			}}
		>
			<div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
				<strong style={{ color: "#7c8aff" }}>Directive DevTools</strong>
				<button
					ref={closeButtonRef}
					type="button"
					onClick={() => setIsOpen(false)}
					aria-label="Close DevTools"
					style={{
						background: "none",
						border: "none",
						color: "#888",
						cursor: "pointer",
						fontSize: 14,
					}}
				>
					{"\u00D7"}
				</button>
			</div>

			<div style={{ marginBottom: 6 }} aria-live="polite">
				<span style={{ color: isSettled ? "#4ade80" : "#fbbf24" }}>
					{isSettled ? "Settled" : "Working..."}
				</span>
			</div>

			<details open>
				<summary style={{ cursor: "pointer", color: "#7c8aff", marginBottom: 4 }}>
					Facts ({Object.keys(facts).length})
				</summary>
				<table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
					<thead>
						<tr>
							<th style={{ textAlign: "left", padding: "2px 4px", color: "#7c8aff" }}>Key</th>
							<th style={{ textAlign: "left", padding: "2px 4px", color: "#7c8aff" }}>Value</th>
						</tr>
					</thead>
					<tbody>
						{Object.entries(facts).map(([key, value]) => {
							let display: string;
							try {
								display = typeof value === "object" ? JSON.stringify(value) : String(value);
							} catch {
								display = "<error>";
							}
							return (
								<tr key={key} style={{ borderBottom: "1px solid #2a2a4a" }}>
									<td style={{ padding: "2px 4px", color: "#a0a0c0" }}>{key}</td>
									<td style={{ padding: "2px 4px" }}>{display}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</details>

			{derivationKeys.length > 0 && (
				<details>
					<summary style={{ cursor: "pointer", color: "#7c8aff", marginBottom: 4 }}>
						Derivations ({derivationKeys.length})
					</summary>
					<table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
						<thead>
							<tr>
								<th style={{ textAlign: "left", padding: "2px 4px", color: "#7c8aff" }}>Key</th>
								<th style={{ textAlign: "left", padding: "2px 4px", color: "#7c8aff" }}>Value</th>
							</tr>
						</thead>
						<tbody>
							{Object.entries(derivations).map(([key, value]) => (
								<tr key={key} style={{ borderBottom: "1px solid #2a2a4a" }}>
									<td style={{ padding: "2px 4px", color: "#a0a0c0" }}>{key}</td>
									<td style={{ padding: "2px 4px" }}>
										{typeof value === "object" ? JSON.stringify(value) : String(value)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</details>
			)}

			{inflight.length > 0 && (
				<details open>
					<summary style={{ cursor: "pointer", color: "#fbbf24", marginBottom: 4 }}>
						Inflight ({inflight.length})
					</summary>
					<ul style={{ margin: 0, paddingLeft: 16 }}>
						{inflight.map((r) => (
							<li key={r.id} style={{ fontSize: 11 }}>
								{r.resolverId} ({r.id})
							</li>
						))}
					</ul>
				</details>
			)}

			{unmet.length > 0 && (
				<details open>
					<summary style={{ cursor: "pointer", color: "#f87171", marginBottom: 4 }}>
						Unmet ({unmet.length})
					</summary>
					<ul style={{ margin: 0, paddingLeft: 16 }}>
						{unmet.map((r) => (
							<li key={r.id} style={{ fontSize: 11 }}>
								{r.requirement.type} from {r.fromConstraint}
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}

// ============================================================================
// useEvents — memoized events reference
// ============================================================================

/**
 * Returns the system's events dispatcher. Provides autocomplete for event names
 * and avoids needing useCallback wrappers for event dispatch.
 *
 * @example
 * ```tsx
 * const events = useEvents(system);
 * <button onClick={() => events.increment()}>+</button>
 * ```
 */
export function useEvents<S extends ModuleSchema>(
	system: SingleModuleSystem<S>,
): SingleModuleSystem<S>["events"] {
	return useMemo(() => system.events, [system]);
}

// ============================================================================
// useExplain — reactive requirement explanation
// ============================================================================

/**
 * Reactively returns the explanation string for a requirement.
 * Updates whenever system state changes.
 *
 * @example
 * ```tsx
 * const explanation = useExplain(system, "req-123");
 * if (explanation) <pre>{explanation}</pre>;
 * ```
 */
export function useExplain(
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	system: SingleModuleSystem<any>,
	requirementId: string,
): string | null {
	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			const unsubFacts = system.facts.$store.subscribeAll(onStoreChange);
			const unsubSettled = system.onSettledChange(onStoreChange);
			return () => {
				unsubFacts();
				unsubSettled();
			};
		},
		[system],
	);

	const getSnapshot = useCallback(() => {
		return system.explain(requirementId);
	}, [system, requirementId]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// useConstraintStatus — reactive constraint inspection
// ============================================================================

// ConstraintInfo is imported from ./shared.js and re-exported above

/** Get all constraints or a single constraint by ID */
export function useConstraintStatus(
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	system: SingleModuleSystem<any>,
	constraintId?: string,
): ConstraintInfo[] | ConstraintInfo | null {
	const inspectState = useInspect(system);

	return useMemo(() => {
		const inspection = system.inspect();
		if (!constraintId) return inspection.constraints;
		return inspection.constraints.find((c) => c.id === constraintId) ?? null;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [system, constraintId, inspectState]);
}

// ============================================================================
// useOptimisticUpdate — batch with rollback on failure
// ============================================================================

/** Result of useOptimisticUpdate */
export interface OptimisticUpdateResult {
	/** Apply an optimistic update (saves snapshot, then runs updateFn in batch) */
	mutate: (updateFn: () => void) => void;
	/** Whether a resolver is currently processing the optimistic change */
	isPending: boolean;
	/** Error if the resolver failed */
	error: Error | null;
	/** Manually rollback to the pre-mutation snapshot */
	rollback: () => void;
}

/**
 * Optimistic update hook. Saves a snapshot before mutating, monitors
 * a requirement type via statusPlugin, and rolls back on failure.
 *
 * @example
 * ```tsx
 * const { mutate, isPending, error, rollback } = useOptimisticUpdate(
 *   system, statusPlugin, "SAVE_ITEM"
 * );
 * mutate(() => { system.facts.items = [...system.facts.items, newItem]; });
 * ```
 */
export function useOptimisticUpdate(
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	system: SingleModuleSystem<any>,
	statusPlugin?: StatusPlugin,
	requirementType?: string,
): OptimisticUpdateResult {
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const snapshotRef = useRef<SystemSnapshot | null>(null);

	const rollback = useCallback(() => {
		if (snapshotRef.current) {
			system.restore(snapshotRef.current);
			snapshotRef.current = null;
		}
		setIsPending(false);
		setError(null);
	}, [system]);

	const mutate = useCallback(
		(updateFn: () => void) => {
			snapshotRef.current = system.getSnapshot();
			setIsPending(true);
			setError(null);
			system.batch(updateFn);
		},
		[system],
	);

	// Watch for resolver completion/failure
	useEffect(() => {
		if (!statusPlugin || !requirementType || !isPending) return;

		return statusPlugin.subscribe(() => {
			const status = statusPlugin.getStatus(requirementType);
			if (!status.isLoading && !status.hasError) {
				// Resolved successfully — keep optimistic state
				snapshotRef.current = null;
				setIsPending(false);
			} else if (status.hasError) {
				// Failed — rollback
				setError(status.lastError);
				rollback();
			}
		});
	}, [statusPlugin, requirementType, isPending, rollback]);

	return { mutate, isPending, error, rollback };
}

// ============================================================================
// DirectiveHydrator + useHydratedSystem — SSR/RSC hydration
// ============================================================================

/** Props for DirectiveHydrator component */
export interface HydratorProps {
	snapshot: DistributableSnapshot;
	children: ReactNode;
}

/** Context for hydrated snapshot */
const HydrationContext = createContext<DistributableSnapshot | null>(null);

/**
 * SSR/RSC hydration component. Wraps children with a snapshot context
 * that `useHydratedSystem` can consume on the client.
 *
 * @example
 * ```tsx
 * // Server component
 * <DirectiveHydrator snapshot={serverSnapshot}>
 *   <ClientApp />
 * </DirectiveHydrator>
 * ```
 */
export function DirectiveHydrator({ snapshot, children }: HydratorProps) {
	return (
		<HydrationContext.Provider value={snapshot}>
			{children}
		</HydrationContext.Provider>
	);
}

/**
 * Client-side hook that creates a system hydrated from a server snapshot.
 * Must be used inside a `<DirectiveHydrator>`.
 *
 * @example
 * ```tsx
 * function ClientApp() {
 *   const system = useHydratedSystem(counterModule);
 *   const count = useFact(system, "count");
 *   return <div>{count}</div>;
 * }
 * ```
 */
export function useHydratedSystem<S extends ModuleSchema>(
	moduleDef: ModuleDef<S>,
	config?: DirectiveRefBaseConfig,
): SingleModuleSystem<S> {
	const snapshot = useContext(HydrationContext);

	// Merge snapshot data as initial facts if available
	const mergedConfig = useMemo(() => {
		if (!snapshot?.data) return config ?? {};
		return {
			...(config ?? {}),
			initialFacts: {
				...(config?.initialFacts ?? {}),
				...snapshot.data,
			},
		};
	}, [snapshot, config]);

	return useDirectiveRef(moduleDef, mergedConfig) as SingleModuleSystem<S>;
}

