/**
 * Svelte Adapter - Consolidated Svelte stores for Directive
 *
 * 17 active exports: useFact, useDerived, useDispatch, useSelector,
 * useWatch, useInspect, useRequirementStatus, useEvents, useExplain,
 * useConstraintStatus, useOptimisticUpdate, useDirective, useTimeTravel,
 * useSystem, setDirectiveContext, getDirectiveContext, createTypedHooks, shallowEqual
 *
 * Store factories: createDerivedStore, createDerivedsStore, createFactStore, createInspectStore
 */

import { getContext, setContext, onDestroy } from "svelte";
import { readable, type Readable } from "svelte/store";
import { createSystem } from "../../core/system.js";
import { withTracking } from "../../core/tracking.js";
import type {
	ModuleSchema,
	ModuleDef,
	Plugin,
	DebugConfig,
	ErrorBoundaryConfig,
	InferFacts,
	InferDerivations,
	InferEvents,
	System,
	SystemInspection,
	SystemSnapshot,
} from "../../core/types.js";
import {
	createRequirementStatusPlugin,
	type RequirementTypeStatus,
} from "../../utils/requirement-status.js";
import {
	type InspectState,
	type ConstraintInfo,
	computeInspectState,
	createThrottle,
} from "../shared.js";

// Re-export for convenience
export type { RequirementTypeStatus, InspectState, ConstraintInfo };
export { shallowEqual } from "../../utils/utils.js";

/** Type for the requirement status plugin return value */
export type StatusPlugin = ReturnType<typeof createRequirementStatusPlugin>;

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
// Internal Helpers
// ============================================================================

/** Default equality function using Object.is */
function defaultEquality<T>(a: T, b: T): boolean {
	return Object.is(a, b);
}

function _useSystem<M extends ModuleSchema = ModuleSchema>(): System<M> {
	return getDirectiveContext<M>();
}

function _getStatusPlugin(): StatusPlugin {
	const statusPlugin = getContext<StatusPlugin | null>(STATUS_PLUGIN_KEY);
	if (!statusPlugin) {
		throw new Error(
			"[Directive] This hook requires a statusPlugin. " +
			"Pass statusPlugin to setDirectiveContext().",
		);
	}
	return statusPlugin;
}

// ============================================================================
// Store Factories
// ============================================================================

/**
 * Create a Svelte store for a derived value.
 */
export function createDerivedStore<T>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	derivationId: string,
): Readable<T> {
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
 */
export function createFactStore<T>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	factKey: string,
): Readable<T | undefined> {
	if (process.env.NODE_ENV !== "production") {
		if (!system.facts.$store.has(factKey)) {
			console.warn(
				`[Directive] useFact("${factKey}") — fact not found in store. ` +
				`Check that "${factKey}" is defined in your module's schema.`,
			);
		}
	}

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
 * NOTE: This updates on every fact change. Use sparingly in production.
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
// useFact — single key or multi key
// ============================================================================

/** Single key overload */
export function useFact<T>(factKey: string): Readable<T | undefined>;
/** Multi-key overload */
export function useFact<T extends Record<string, unknown>>(factKeys: string[]): Readable<T>;
/** Implementation */
export function useFact(
	keyOrKeys: string | string[],
): Readable<unknown> {
	if (process.env.NODE_ENV !== "production" && typeof keyOrKeys === "function") {
		console.error(
			"[Directive] useFact() received a function. Did you mean useSelector()? " +
				"useFact() takes a string key or array of keys, not a selector function.",
		);
	}

	const system = _useSystem();

	// Multi-key path: useFact([keys])
	if (Array.isArray(keyOrKeys)) {
		return _useFactMulti(system, keyOrKeys);
	}

	// Single key path: useFact(key)
	return createFactStore(system, keyOrKeys);
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useFactMulti(system: System<any>, factKeys: string[]): Readable<Record<string, unknown>> {
	const getValues = (): Record<string, unknown> => {
		const result: Record<string, unknown> = {};
		for (const key of factKeys) {
			result[key] = system.facts.$store.get(key);
		}
		return result;
	};

	return readable(getValues(), (set) => {
		const unsubscribe = system.facts.$store.subscribe(factKeys, () => {
			set(getValues());
		});
		return unsubscribe;
	});
}

// ============================================================================
// useDerived — single key or multi key
// ============================================================================

/** Single key overload */
export function useDerived<T>(derivationId: string): Readable<T>;
/** Multi-key overload */
export function useDerived<T extends Record<string, unknown>>(derivationIds: string[]): Readable<T>;
/** Implementation */
export function useDerived(
	idOrIds: string | string[],
): Readable<unknown> {
	if (process.env.NODE_ENV !== "production" && typeof idOrIds === "function") {
		console.error(
			"[Directive] useDerived() received a function. Did you mean useSelector()? " +
				"useDerived() takes a string key or array of keys, not a selector function.",
		);
	}

	const system = _useSystem();

	// Multi-key path
	if (Array.isArray(idOrIds)) {
		return createDerivedsStore(system, idOrIds);
	}

	// Single key path
	return createDerivedStore(system, idOrIds);
}

// ============================================================================
// useSelector — auto-tracking cross-fact selector
// ============================================================================

/**
 * Auto-tracking cross-fact selector.
 * Uses `withTracking()` to detect which facts the selector accesses,
 * then subscribes only to those keys.
 */
export function useSelector<R>(
	selector: (state: Record<string, unknown>) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Readable<R> {
	const system = _useSystem();
	const deriveKeySet = new Set(Object.keys(system.derive ?? {}));

	// Build a tracking-aware state proxy that exposes both facts and derivations
	const runWithTracking = () => {
		const accessedDeriveKeys: string[] = [];

		const stateProxy = new Proxy(
			{},
			{
				get(_, prop: string | symbol) {
					if (typeof prop !== "string") return undefined;
					if (deriveKeySet.has(prop)) {
						accessedDeriveKeys.push(prop);
						return system.read(prop);
					}
					return system.facts.$store.get(prop);
				},
				has(_, prop: string | symbol) {
					if (typeof prop !== "string") return false;
					return deriveKeySet.has(prop) || system.facts.$store.has(prop);
				},
				ownKeys() {
					return [...Object.keys(system.facts.$store.toObject()), ...deriveKeySet];
				},
				getOwnPropertyDescriptor() {
					return { configurable: true, enumerable: true, writable: true };
				},
			},
		);

		const { value, deps } = withTracking(() => selector(stateProxy as Record<string, unknown>));
		return { value, factKeys: Array.from(deps) as string[], deriveKeys: accessedDeriveKeys };
	};

	const initial = runWithTracking();

	return readable<R>(initial.value, (set) => {
		let currentSelected = initial.value;
		let trackedFactKeys = initial.factKeys;
		let trackedDeriveKeys = initial.deriveKeys;
		const unsubs: Array<() => void> = [];

		const resubscribe = () => {
			for (const unsub of unsubs) unsub();
			unsubs.length = 0;

			const onUpdate = () => {
				const result = runWithTracking();
				if (!equalityFn(currentSelected, result.value)) {
					currentSelected = result.value;
					set(result.value);
				}
				// Re-track: check if deps changed
				const factsChanged =
					result.factKeys.length !== trackedFactKeys.length ||
					result.factKeys.some((k, i) => k !== trackedFactKeys[i]);
				const derivedChanged =
					result.deriveKeys.length !== trackedDeriveKeys.length ||
					result.deriveKeys.some((k, i) => k !== trackedDeriveKeys[i]);
				if (factsChanged || derivedChanged) {
					trackedFactKeys = result.factKeys;
					trackedDeriveKeys = result.deriveKeys;
					resubscribe();
				}
			};

			if (trackedFactKeys.length > 0) {
				unsubs.push(system.facts.$store.subscribe(trackedFactKeys, onUpdate));
			} else if (trackedDeriveKeys.length === 0) {
				unsubs.push(system.facts.$store.subscribeAll(onUpdate));
			}
			if (trackedDeriveKeys.length > 0) {
				unsubs.push(system.subscribe(trackedDeriveKeys, onUpdate));
			}
		};

		resubscribe();

		return () => {
			for (const unsub of unsubs) unsub();
		};
	});
}

// ============================================================================
// useDispatch
// ============================================================================

export function useDispatch<M extends ModuleSchema = ModuleSchema>(): (
	event: InferEvents<M>,
) => void {
	const system = _useSystem<M>();
	return (event: InferEvents<M>) => {
		system.dispatch(event);
	};
}

// ============================================================================
// useEvents — memoized events reference
// ============================================================================

/**
 * Returns the system's events dispatcher.
 */
export function useEvents<M extends ModuleSchema = ModuleSchema>(): System<M>["events"] {
	const system = _useSystem<M>();
	return system.events;
}

// ============================================================================
// useWatch — derivation or fact side-effect
// ============================================================================

/** Watch a fact or derivation (auto-detected) */
export function useWatch<T>(
	key: string,
	callback: (newValue: T, previousValue: T | undefined) => void,
): void;
/**
 * Watch a fact by explicit "fact" discriminator.
 * @deprecated Use `useWatch(key, callback)` instead — facts are now auto-detected.
 */
export function useWatch<T>(
	kind: "fact",
	factKey: string,
	callback: (newValue: T | undefined, previousValue: T | undefined) => void,
): void;
/** Implementation */
export function useWatch(
	derivationIdOrKind: string,
	callbackOrFactKey: string | ((newValue: unknown, prevValue: unknown) => void),
	maybeCallback?: (newValue: unknown, prevValue: unknown) => void,
): void {
	const system = _useSystem();

	// Backward compat: useWatch("fact", factKey, callback)
	const isFact =
		derivationIdOrKind === "fact" &&
		typeof callbackOrFactKey === "string" &&
		typeof maybeCallback === "function";

	const key = isFact ? (callbackOrFactKey as string) : derivationIdOrKind;
	const callback = isFact
		? maybeCallback!
		: (callbackOrFactKey as (newValue: unknown, prevValue: unknown) => void);

	const unsubscribe = system.watch(key, callback);
	onDestroy(unsubscribe);
}

// ============================================================================
// useInspect — consolidated inspection hook
// ============================================================================

/** Options for useInspect */
export interface UseInspectOptions {
	throttleMs?: number;
}

/**
 * Consolidated system inspection hook.
 * Returns Readable<InspectState> with optional throttling.
 */
export function useInspect(options?: UseInspectOptions): Readable<InspectState> {
	const system = _useSystem();

	if (options?.throttleMs && options.throttleMs > 0) {
		return readable<InspectState>(computeInspectState(system), (set) => {
			const { throttled, cleanup } = createThrottle(() => {
				set(computeInspectState(system));
			}, options.throttleMs!);

			const unsubFacts = system.facts.$store.subscribeAll(throttled);
			const unsubSettled = system.onSettledChange(throttled);

			return () => {
				cleanup();
				unsubFacts();
				unsubSettled();
			};
		});
	}

	return readable<InspectState>(computeInspectState(system), (set) => {
		const update = () => set(computeInspectState(system));
		const unsubFacts = system.facts.$store.subscribeAll(update);
		const unsubSettled = system.onSettledChange(update);

		return () => {
			unsubFacts();
			unsubSettled();
		};
	});
}

// ============================================================================
// useRequirementStatus — single or multi
// ============================================================================

/** Single type overload */
export function useRequirementStatus(type: string): Readable<RequirementTypeStatus>;
/** Multi-type overload */
export function useRequirementStatus(types: string[]): Readable<Record<string, RequirementTypeStatus>>;
/** Implementation */
export function useRequirementStatus(
	typeOrTypes: string | string[],
): Readable<RequirementTypeStatus> | Readable<Record<string, RequirementTypeStatus>> {
	const statusPlugin = _getStatusPlugin();

	if (Array.isArray(typeOrTypes)) {
		const getValues = (): Record<string, RequirementTypeStatus> => {
			const result: Record<string, RequirementTypeStatus> = {};
			for (const type of typeOrTypes) {
				result[type] = statusPlugin.getStatus(type);
			}
			return result;
		};

		return readable(getValues(), (set) => {
			const unsubscribe = statusPlugin.subscribe(() => {
				set(getValues());
			});
			return unsubscribe;
		});
	}

	return readable<RequirementTypeStatus>(statusPlugin.getStatus(typeOrTypes), (set) => {
		const unsubscribe = statusPlugin.subscribe(() => {
			set(statusPlugin.getStatus(typeOrTypes));
		});
		return unsubscribe;
	});
}

// ============================================================================
// useExplain — reactive requirement explanation
// ============================================================================

/**
 * Reactively returns the explanation string for a requirement.
 */
export function useExplain(requirementId: string): Readable<string | null> {
	const system = _useSystem();

	return readable<string | null>(system.explain(requirementId), (set) => {
		const update = () => set(system.explain(requirementId));
		const unsubFacts = system.facts.$store.subscribeAll(update);
		const unsubSettled = system.onSettledChange(update);

		return () => {
			unsubFacts();
			unsubSettled();
		};
	});
}

// ============================================================================
// useConstraintStatus — reactive constraint inspection
// ============================================================================

/**
 * Get all constraints or a single constraint by ID.
 */
export function useConstraintStatus(
	constraintId?: string,
): Readable<ConstraintInfo[] | ConstraintInfo | null> {
	const system = _useSystem();

	return readable<ConstraintInfo[] | ConstraintInfo | null>(
		_getConstraintValue(system, constraintId),
		(set) => {
			const update = () => set(_getConstraintValue(system, constraintId));
			const unsubFacts = system.facts.$store.subscribeAll(update);
			const unsubSettled = system.onSettledChange(update);

			return () => {
				unsubFacts();
				unsubSettled();
			};
		},
	);
}

function _getConstraintValue(
	// biome-ignore lint/suspicious/noExplicitAny: Internal
	system: System<any>,
	constraintId?: string,
): ConstraintInfo[] | ConstraintInfo | null {
	const inspection = system.inspect();
	if (!constraintId) return inspection.constraints;
	return inspection.constraints.find((c: ConstraintInfo) => c.id === constraintId) ?? null;
}

// ============================================================================
// useOptimisticUpdate — batch with rollback on failure
// ============================================================================

export interface OptimisticUpdateResult {
	mutate: (updateFn: () => void) => void;
	isPending: Readable<boolean>;
	error: Readable<Error | null>;
	rollback: () => void;
}

/**
 * Optimistic update hook. Saves a snapshot before mutating, monitors
 * a requirement type via statusPlugin, and rolls back on failure.
 */
export function useOptimisticUpdate(
	statusPlugin?: StatusPlugin,
	requirementType?: string,
): OptimisticUpdateResult {
	const system = _useSystem();
	let isPendingValue = false;
	let errorValue: Error | null = null;
	let snapshot: SystemSnapshot | null = null;
	let statusUnsub: (() => void) | null = null;

	// We track subscribers manually since we need imperative push
	const pendingSubscribers = new Set<(v: boolean) => void>();
	const errorSubscribers = new Set<(v: Error | null) => void>();

	const isPending: Readable<boolean> = {
		subscribe(fn) {
			fn(isPendingValue);
			pendingSubscribers.add(fn);
			return () => pendingSubscribers.delete(fn);
		},
	};

	const error: Readable<Error | null> = {
		subscribe(fn) {
			fn(errorValue);
			errorSubscribers.add(fn);
			return () => errorSubscribers.delete(fn);
		},
	};

	const setPending = (v: boolean) => {
		isPendingValue = v;
		for (const fn of pendingSubscribers) fn(v);
	};

	const setError = (v: Error | null) => {
		errorValue = v;
		for (const fn of errorSubscribers) fn(v);
	};

	const rollback = () => {
		if (snapshot) {
			system.restore(snapshot);
			snapshot = null;
		}
		setPending(false);
		setError(null);
		statusUnsub?.();
		statusUnsub = null;
	};

	const mutate = (updateFn: () => void) => {
		snapshot = system.getSnapshot();
		setPending(true);
		setError(null);
		system.batch(updateFn);

		if (statusPlugin && requirementType) {
			statusUnsub?.();
			statusUnsub = statusPlugin.subscribe(() => {
				const status = statusPlugin.getStatus(requirementType);
				if (!status.isLoading && !status.hasError) {
					snapshot = null;
					setPending(false);
					statusUnsub?.();
					statusUnsub = null;
				} else if (status.hasError) {
					setError(status.lastError);
					rollback();
				}
			});
		}
	};

	onDestroy(() => {
		statusUnsub?.();
	});

	return { mutate, isPending, error, rollback };
}

// ============================================================================
// useSystem — get system from context
// ============================================================================

export function useSystem<M extends ModuleSchema = ModuleSchema>(): System<M> {
	return _useSystem<M>();
}

// ============================================================================
// useTimeTravel — reactive time-travel store
// ============================================================================

import type { TimeTravelState } from "../../core/types.js";

function _buildTTState(system: System<ModuleSchema>): TimeTravelState | null {
	const debug = system.debug;
	if (!debug) return null;
	return {
		canUndo: debug.currentIndex > 0,
		canRedo: debug.currentIndex < debug.snapshots.length - 1,
		undo: () => debug.goBack(),
		redo: () => debug.goForward(),
		currentIndex: debug.currentIndex,
		totalSnapshots: debug.snapshots.length,
	};
}

/**
 * Reactive time-travel Svelte store. Returns a Readable that updates
 * when snapshots are taken or navigation occurs.
 *
 * @example
 * ```svelte
 * const tt = useTimeTravel();
 * <button disabled={!$tt?.canUndo} on:click={() => $tt?.undo()}>Undo</button>
 * ```
 */
export function useTimeTravel(): Readable<TimeTravelState | null> {
	const system = _useSystem();
	return readable<TimeTravelState | null>(_buildTTState(system), (set) => {
		return system.onTimeTravelChange(() => set(_buildTTState(system)));
	});
}

// ============================================================================
// Scoped System
// ============================================================================

/** Configuration for useDirective */
interface UseDirectiveConfig {
	// biome-ignore lint/suspicious/noExplicitAny: Plugin types vary
	plugins?: Plugin<any>[];
	debug?: DebugConfig;
	errorBoundary?: ErrorBoundaryConfig;
	tickMs?: number;
	zeroConfig?: boolean;
	// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
	initialFacts?: Record<string, any>;
	status?: boolean;
	/** Fact keys to subscribe to (omit for all) */
	facts?: string[];
	/** Derivation keys to subscribe to (omit for all) */
	derived?: string[];
}

/**
 * Create a scoped Directive system with automatic lifecycle management.
 * When no `facts` or `derived` keys are specified, subscribes to ALL
 * facts and derivations and returns Svelte readable stores.
 *
 * @example
 * ```svelte
 * // Subscribe to everything
 * const { facts, derived, events, dispatch } = useDirective(counterModule);
 *
 * // Selective keys
 * const { facts, derived } = useDirective(counterModule, { facts: ["count"], derived: ["doubled"] });
 * ```
 */
export function useDirective<M extends ModuleSchema>(
	moduleDef: ModuleDef<M>,
	config?: UseDirectiveConfig,
) {
	const allPlugins = [...(config?.plugins ?? [])];
	let statusPlugin: StatusPlugin | undefined;

	if (config?.status) {
		const sp = createRequirementStatusPlugin();
		statusPlugin = sp;
		// biome-ignore lint/suspicious/noExplicitAny: Plugin generic issues
		allPlugins.push(sp.plugin as Plugin<any>);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
	const system = createSystem({
		module: moduleDef,
		plugins: allPlugins.length > 0 ? allPlugins : undefined,
		debug: config?.debug,
		errorBoundary: config?.errorBoundary,
		tickMs: config?.tickMs,
		zeroConfig: config?.zeroConfig,
		initialFacts: config?.initialFacts,
	} as any) as unknown as System<M>;

	system.start();

	onDestroy(() => {
		system.destroy();
	});

	const factKeys = config?.facts;
	const derivedKeys = config?.derived;
	const subscribeAll = !factKeys && !derivedKeys;

	// Subscribe to facts
	const factsStore: Readable<InferFacts<M>> = subscribeAll
		? readable(system.facts.$store.toObject() as InferFacts<M>, (set) => {
			return system.facts.$store.subscribeAll(() => {
				set(system.facts.$store.toObject() as InferFacts<M>);
			});
		})
		: readable(_pickFacts(system, factKeys ?? []) as InferFacts<M>, (set) => {
			if (!factKeys || factKeys.length === 0) return () => {};
			return system.facts.$store.subscribe(factKeys, () => {
				set(_pickFacts(system, factKeys) as InferFacts<M>);
			});
		});

	// Subscribe to derivations
	const allDerivationKeys = subscribeAll ? Object.keys(system.derive ?? {}) : (derivedKeys ?? []);
	const getDerived = (): InferDerivations<M> => {
		const result: Record<string, unknown> = {};
		for (const key of allDerivationKeys) {
			result[key] = system.read(key);
		}
		return result as InferDerivations<M>;
	};
	const derivedStore: Readable<InferDerivations<M>> = allDerivationKeys.length > 0
		? readable(getDerived(), (set) => {
			return system.subscribe(allDerivationKeys, () => {
				set(getDerived());
			});
		})
		: readable(getDerived(), () => () => {});

	const events = system.events;
	const dispatch = (event: InferEvents<M>) => system.dispatch(event);

	return {
		system,
		facts: factsStore,
		derived: derivedStore,
		events,
		dispatch,
		statusPlugin,
	};
}

// biome-ignore lint/suspicious/noExplicitAny: Internal helper
function _pickFacts(system: System<any>, keys: string[]): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		result[key] = system.facts.$store.get(key);
	}
	return result;
}

// ============================================================================
// Typed Hooks Factory
// ============================================================================

export function createTypedHooks<M extends ModuleSchema>(): {
	useDerived: <K extends keyof InferDerivations<M>>(
		derivationId: K,
	) => Readable<InferDerivations<M>[K]>;
	useFact: <K extends keyof InferFacts<M>>(factKey: K) => Readable<InferFacts<M>[K] | undefined>;
	useDispatch: () => (event: InferEvents<M>) => void;
	useSystem: () => System<M>;
	useEvents: () => System<M>["events"];
} {
	return {
		useDerived: <K extends keyof InferDerivations<M>>(derivationId: K) =>
			useDerived<InferDerivations<M>[K]>(derivationId as string),
		useFact: <K extends keyof InferFacts<M>>(factKey: K) =>
			useFact<InferFacts<M>[K]>(factKey as string),
		useDispatch: () => {
			const system = _useSystem<M>();
			return (event: InferEvents<M>) => {
				system.dispatch(event);
			};
		},
		useSystem: () => _useSystem<M>(),
		useEvents: () => useEvents<M>(),
	};
}

