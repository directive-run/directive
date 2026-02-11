/**
 * Solid Adapter - Consolidated SolidJS primitives for Directive
 *
 * 18 active exports: useFact, useDerived, useDispatch, useSelector,
 * useWatch, useInspect, useRequirementStatus, useEvents, useExplain,
 * useConstraintStatus, useOptimisticUpdate, useDirective, useTimeTravel,
 * useSystem, DirectiveProvider, createTypedHooks, useSuspenseRequirement, shallowEqual
 *
 * Signal factories: createDerivedSignal, createFactSignal
 */

import {
	createContext,
	useContext,
	createSignal,
	onCleanup,
	type Accessor,
	type JSX,
} from "solid-js";
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
 */
export function DirectiveProvider<M extends ModuleSchema>(
	props: DirectiveProviderProps<M>,
): JSX.Element {
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
// Internal Helpers
// ============================================================================

/** Default equality function using Object.is */
function defaultEquality<T>(a: T, b: T): boolean {
	return Object.is(a, b);
}

function _useSystem<M extends ModuleSchema = ModuleSchema>(): System<M> {
	const system = useContext(DirectiveContext);
	if (!system) {
		throw new Error(
			"[Directive] useSystem must be used within a DirectiveProvider. " +
			"Wrap your component tree with <DirectiveProvider system={system}>.",
		);
	}
	return system as System<M>;
}

function _getStatusPlugin(): StatusPlugin {
	const statusPlugin = useContext(StatusPluginContext);
	if (!statusPlugin) {
		throw new Error(
			"[Directive] This hook requires a statusPlugin. " +
			"Pass statusPlugin to <DirectiveProvider statusPlugin={statusPlugin}>.",
		);
	}
	return statusPlugin;
}

// ============================================================================
// useFact — single key or multi key
// ============================================================================

/** Single key overload */
export function useFact<T>(factKey: string): Accessor<T | undefined>;
/** Multi-key overload */
export function useFact<T extends Record<string, unknown>>(factKeys: string[]): Accessor<T>;
/** Implementation */
export function useFact(
	keyOrKeys: string | string[],
): Accessor<unknown> {
	if (process.env.NODE_ENV !== "production" && typeof keyOrKeys === "function") {
		console.error(
			"[Directive] useFact() received a function. Did you mean useSelector()? " +
				"useFact() takes a string key or array of keys, not a selector function.",
		);
	}

	const system = _useSystem();

	// Multi-key path
	if (Array.isArray(keyOrKeys)) {
		return _useFactMulti(system, keyOrKeys);
	}

	// Single key path
	return _useFactSingle(system, keyOrKeys);
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useFactSingle(system: System<any>, factKey: string): Accessor<unknown> {
	if (process.env.NODE_ENV !== "production") {
		if (!system.facts.$store.has(factKey)) {
			console.warn(
				`[Directive] useFact("${factKey}") — fact not found in store. ` +
				`Check that "${factKey}" is defined in your module's schema.`,
			);
		}
	}

	const [value, setValue] = createSignal(system.facts.$store.get(factKey));
	const unsubscribe = system.facts.$store.subscribe([factKey], () => {
		setValue(() => system.facts.$store.get(factKey));
	});
	onCleanup(unsubscribe);
	return value;
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useFactMulti(system: System<any>, factKeys: string[]): Accessor<Record<string, unknown>> {
	const getValues = (): Record<string, unknown> => {
		const result: Record<string, unknown> = {};
		for (const key of factKeys) {
			result[key] = system.facts.$store.get(key);
		}
		return result;
	};
	const [state, setState] = createSignal(getValues());
	const unsubscribe = system.facts.$store.subscribe(factKeys, () => {
		setState(getValues);
	});
	onCleanup(unsubscribe);
	return state;
}

// ============================================================================
// useDerived — single key or multi key
// ============================================================================

/** Single key overload */
export function useDerived<T>(derivationId: string): Accessor<T>;
/** Multi-key overload */
export function useDerived<T extends Record<string, unknown>>(derivationIds: string[]): Accessor<T>;
/** Implementation */
export function useDerived(
	idOrIds: string | string[],
): Accessor<unknown> {
	if (process.env.NODE_ENV !== "production" && typeof idOrIds === "function") {
		console.error(
			"[Directive] useDerived() received a function. Did you mean useSelector()? " +
				"useDerived() takes a string key or array of keys, not a selector function.",
		);
	}

	const system = _useSystem();

	// Multi-key path
	if (Array.isArray(idOrIds)) {
		return _useDerivedMulti(system, idOrIds);
	}

	// Single key path
	return _useDerivedSingle(system, idOrIds);
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useDerivedSingle(system: System<any>, derivationId: string): Accessor<unknown> {
	if (process.env.NODE_ENV !== "production") {
		const initialValue = system.read(derivationId);
		if (initialValue === undefined) {
			console.warn(
				`[Directive] useDerived("${derivationId}") returned undefined. ` +
				`Check that "${derivationId}" is defined in your module's derive property.`,
			);
		}
	}
	const [value, setValue] = createSignal(system.read(derivationId));
	const unsubscribe = system.subscribe([derivationId], () => {
		setValue(() => system.read(derivationId));
	});
	onCleanup(unsubscribe);
	return value;
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useDerivedMulti(system: System<any>, derivationIds: string[]): Accessor<Record<string, unknown>> {
	const getValues = (): Record<string, unknown> => {
		const result: Record<string, unknown> = {};
		for (const id of derivationIds) {
			result[id] = system.read(id);
		}
		return result;
	};
	const [state, setState] = createSignal(getValues());
	const unsubscribe = system.subscribe(derivationIds, () => {
		setState(getValues);
	});
	onCleanup(unsubscribe);
	return state;
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
): Accessor<R> {
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
	let trackedFactKeys = initial.factKeys;
	let trackedDeriveKeys = initial.deriveKeys;
	const [selected, setSelected] = createSignal<R>(initial.value);

	const unsubs: Array<() => void> = [];

	const resubscribe = () => {
		for (const unsub of unsubs) unsub();
		unsubs.length = 0;

		const onUpdate = () => {
			const result = runWithTracking();
			setSelected((prev) => {
				if (!equalityFn(prev, result.value)) return result.value;
				return prev;
			});
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

	onCleanup(() => {
		for (const unsub of unsubs) unsub();
	});

	return selected;
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
	onCleanup(unsubscribe);
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
 * Returns Accessor<InspectState> with optional throttling.
 */
export function useInspect(options?: UseInspectOptions): Accessor<InspectState> {
	const system = _useSystem();
	const [state, setState] = createSignal<InspectState>(computeInspectState(system));

	const update = () => {
		setState(computeInspectState(system));
	};

	if (options?.throttleMs && options.throttleMs > 0) {
		const { throttled, cleanup } = createThrottle(update, options.throttleMs);
		const unsubFacts = system.facts.$store.subscribeAll(throttled);
		const unsubSettled = system.onSettledChange(throttled);
		onCleanup(() => {
			cleanup();
			unsubFacts();
			unsubSettled();
		});
	} else {
		const unsubFacts = system.facts.$store.subscribeAll(update);
		const unsubSettled = system.onSettledChange(update);
		onCleanup(() => {
			unsubFacts();
			unsubSettled();
		});
	}

	return state;
}

// ============================================================================
// useRequirementStatus — single or multi
// ============================================================================

/** Single type overload */
export function useRequirementStatus(type: string): Accessor<RequirementTypeStatus>;
/** Multi-type overload */
export function useRequirementStatus(types: string[]): Accessor<Record<string, RequirementTypeStatus>>;
/** Implementation */
export function useRequirementStatus(
	typeOrTypes: string | string[],
): Accessor<RequirementTypeStatus> | Accessor<Record<string, RequirementTypeStatus>> {
	const statusPlugin = _getStatusPlugin();

	if (Array.isArray(typeOrTypes)) {
		const getValues = (): Record<string, RequirementTypeStatus> => {
			const result: Record<string, RequirementTypeStatus> = {};
			for (const type of typeOrTypes) {
				result[type] = statusPlugin.getStatus(type);
			}
			return result;
		};
		const [state, setState] = createSignal(getValues());
		const unsubscribe = statusPlugin.subscribe(() => {
			setState(getValues);
		});
		onCleanup(unsubscribe);
		return state;
	}

	const [status, setStatus] = createSignal<RequirementTypeStatus>(statusPlugin.getStatus(typeOrTypes));
	const unsubscribe = statusPlugin.subscribe(() => {
		setStatus(statusPlugin.getStatus(typeOrTypes));
	});
	onCleanup(unsubscribe);
	return status;
}

// ============================================================================
// useExplain — reactive requirement explanation
// ============================================================================

/**
 * Reactively returns the explanation string for a requirement.
 */
export function useExplain(requirementId: string): Accessor<string | null> {
	const system = _useSystem();
	const [explanation, setExplanation] = createSignal<string | null>(system.explain(requirementId));

	const update = () => setExplanation(system.explain(requirementId));
	const unsubFacts = system.facts.$store.subscribeAll(update);
	const unsubSettled = system.onSettledChange(update);
	onCleanup(() => {
		unsubFacts();
		unsubSettled();
	});

	return explanation;
}

// ============================================================================
// useConstraintStatus — reactive constraint inspection
// ============================================================================

/**
 * Get all constraints or a single constraint by ID.
 */
export function useConstraintStatus(
	constraintId?: string,
): Accessor<ConstraintInfo[] | ConstraintInfo | null> {
	const system = _useSystem();

	const getVal = () => {
		const inspection = system.inspect();
		if (!constraintId) return inspection.constraints;
		return inspection.constraints.find((c: ConstraintInfo) => c.id === constraintId) ?? null;
	};

	const [state, setState] = createSignal<ConstraintInfo[] | ConstraintInfo | null>(getVal());

	const update = () => setState(getVal);
	const unsubFacts = system.facts.$store.subscribeAll(update);
	const unsubSettled = system.onSettledChange(update);
	onCleanup(() => {
		unsubFacts();
		unsubSettled();
	});

	return state;
}

// ============================================================================
// useOptimisticUpdate — batch with rollback on failure
// ============================================================================

export interface OptimisticUpdateResult {
	mutate: (updateFn: () => void) => void;
	isPending: Accessor<boolean>;
	error: Accessor<Error | null>;
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
	const [isPending, setIsPending] = createSignal(false);
	const [error, setError] = createSignal<Error | null>(null);
	let snapshot: SystemSnapshot | null = null;
	let statusUnsub: (() => void) | null = null;

	const rollback = () => {
		if (snapshot) {
			system.restore(snapshot);
			snapshot = null;
		}
		setIsPending(false);
		setError(null);
		statusUnsub?.();
		statusUnsub = null;
	};

	const mutate = (updateFn: () => void) => {
		snapshot = system.getSnapshot();
		setIsPending(true);
		setError(null);
		system.batch(updateFn);

		if (statusPlugin && requirementType) {
			statusUnsub?.();
			statusUnsub = statusPlugin.subscribe(() => {
				const status = statusPlugin.getStatus(requirementType);
				if (!status.isLoading && !status.hasError) {
					snapshot = null;
					setIsPending(false);
					statusUnsub?.();
					statusUnsub = null;
				} else if (status.hasError) {
					setError(() => status.lastError);
					rollback();
				}
			});
		}
	};

	onCleanup(() => {
		statusUnsub?.();
	});

	return { mutate, isPending, error, rollback };
}

// ============================================================================
// useSuspenseRequirement — Solid-specific Suspense integration
// ============================================================================

/**
 * Single type: throws a promise while the requirement is pending (Suspense).
 */
export function useSuspenseRequirement(type: string): Accessor<RequirementTypeStatus>;
/**
 * Multi-type: throws a promise while any of the requirements are pending.
 */
export function useSuspenseRequirement(types: string[]): Accessor<Record<string, RequirementTypeStatus>>;
/** Implementation */
export function useSuspenseRequirement(
	typeOrTypes: string | string[],
): Accessor<RequirementTypeStatus> | Accessor<Record<string, RequirementTypeStatus>> {
	const statusPlugin = _getStatusPlugin();

	const types = Array.isArray(typeOrTypes) ? typeOrTypes : [typeOrTypes];

	// Check if any are still loading — if so, throw a promise
	const anyLoading = () => types.some((t) => statusPlugin.getStatus(t).isLoading);

	if (anyLoading()) {
		throw new Promise<void>((resolve) => {
			const unsub = statusPlugin.subscribe(() => {
				if (!anyLoading()) {
					unsub();
					resolve();
				}
			});
		});
	}

	// Once resolved, return normal accessor
	if (Array.isArray(typeOrTypes)) {
		return useRequirementStatus(typeOrTypes) as Accessor<Record<string, RequirementTypeStatus>>;
	}
	return useRequirementStatus(typeOrTypes) as Accessor<RequirementTypeStatus>;
}

// ============================================================================
// useSystem — get system from context
// ============================================================================

export function useSystem<M extends ModuleSchema = ModuleSchema>(): System<M> {
	return _useSystem<M>();
}

// ============================================================================
// useTimeTravel — reactive time-travel signal
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
 * Reactive time-travel signal. Returns an Accessor that updates
 * when snapshots are taken or navigation occurs.
 *
 * @example
 * ```tsx
 * const tt = useTimeTravel();
 * <button disabled={!tt()?.canUndo} onClick={() => tt()?.undo()}>Undo</button>
 * ```
 */
export function useTimeTravel(): Accessor<TimeTravelState | null> {
	const system = _useSystem();
	const [state, setState] = createSignal<TimeTravelState | null>(_buildTTState(system));
	const unsub = system.onTimeTravelChange(() => setState(_buildTTState(system)));
	onCleanup(unsub);
	return state;
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
 * facts and derivations and returns reactive signals.
 *
 * @example
 * ```tsx
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

	onCleanup(() => {
		system.destroy();
	});

	const factKeys = config?.facts;
	const derivedKeys = config?.derived;
	const subscribeAll = !factKeys && !derivedKeys;

	// Subscribe to facts
	const [factsState, setFactsState] = createSignal(
		subscribeAll
			? (system.facts.$store.toObject() as InferFacts<M>)
			: (_pickFacts(system, factKeys ?? []) as InferFacts<M>),
	);
	const unsubFacts = subscribeAll
		? system.facts.$store.subscribeAll(() => {
			setFactsState(() => system.facts.$store.toObject() as InferFacts<M>);
		})
		: factKeys && factKeys.length > 0
			? system.facts.$store.subscribe(factKeys, () => {
				setFactsState(() => _pickFacts(system, factKeys) as InferFacts<M>);
			})
			: null;

	// Subscribe to derivations
	const allDerivationKeys = subscribeAll ? Object.keys(system.derive ?? {}) : (derivedKeys ?? []);
	const getDerived = (): InferDerivations<M> => {
		const result: Record<string, unknown> = {};
		for (const key of allDerivationKeys) {
			result[key] = system.read(key);
		}
		return result as InferDerivations<M>;
	};
	const [derivedState, setDerivedState] = createSignal(getDerived());
	const unsubDerived = allDerivationKeys.length > 0
		? system.subscribe(allDerivationKeys, () => { setDerivedState(getDerived); })
		: null;

	onCleanup(() => {
		unsubFacts?.();
		unsubDerived?.();
	});

	const events = system.events;
	const dispatch = (event: InferEvents<M>) => system.dispatch(event);

	return {
		system,
		facts: factsState as Accessor<InferFacts<M>>,
		derived: derivedState as Accessor<InferDerivations<M>>,
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
// Signal Factories (for use outside components)
// ============================================================================

/**
 * Create a derivation signal outside of a component.
 */
export function createDerivedSignal<T>(
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
// Typed Hooks Factory
// ============================================================================

export function createTypedHooks<M extends ModuleSchema>(): {
	useDerived: <K extends keyof InferDerivations<M>>(
		derivationId: K,
	) => Accessor<InferDerivations<M>[K]>;
	useFact: <K extends keyof InferFacts<M>>(factKey: K) => Accessor<InferFacts<M>[K] | undefined>;
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

