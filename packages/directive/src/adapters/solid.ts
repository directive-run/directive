/**
 * Solid Adapter - Consolidated SolidJS primitives for Directive
 *
 * 20 active exports: useFact, useDerived, useFacts, useDispatch, useSelector,
 * useWatch, useInspect, useRequirementStatus, useEvents, useModule, useExplain,
 * useConstraintStatus, useOptimisticUpdate, useDirective, useTimeTravel,
 * useSystem, DirectiveProvider, createTypedHooks, useSuspenseRequirement, shallowEqual
 *
 * Signal factories: createDerivedSignal, createFactSignal
 *
 * 10 deprecated shims for backward compatibility.
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
import { withTracking } from "../core/tracking.js";
import type {
	CreateSystemOptionsSingle,
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
} from "../core/types.js";
import {
	createRequirementStatusPlugin,
	type RequirementTypeStatus,
} from "../utils/requirement-status.js";
import {
	type RequirementsState,
	type ThrottledHookOptions,
	type InspectState,
	type ConstraintInfo,
	computeRequirementsState,
	computeInspectState,
	createThrottle,
} from "./shared.js";

// Re-export for convenience
export type { RequirementTypeStatus, RequirementsState, ThrottledHookOptions, InspectState, ConstraintInfo };
export { shallowEqual } from "../utils/utils.js";

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
// useFact — single key, multi key, or selector
// ============================================================================

/** Single key overload */
export function useFact<T>(factKey: string): Accessor<T | undefined>;
/** Multi-key overload */
export function useFact<T extends Record<string, unknown>>(factKeys: string[]): Accessor<T>;
/** Selector overload */
export function useFact<T, R>(
	factKey: string,
	selector: (value: T | undefined) => R,
	equalityFn?: (a: R, b: R) => boolean,
): Accessor<R>;
/** Implementation */
export function useFact(
	keyOrKeys: string | string[],
	selectorOrUndefined?: (value: unknown) => unknown,
	equalityFn?: (a: unknown, b: unknown) => boolean,
): Accessor<unknown> {
	const system = _useSystem();

	// Selector path
	if (typeof keyOrKeys === "string" && typeof selectorOrUndefined === "function") {
		return _useFactSelector(system, keyOrKeys, selectorOrUndefined, equalityFn ?? defaultEquality);
	}

	// Multi-key path
	if (Array.isArray(keyOrKeys)) {
		return _useFactMulti(system, keyOrKeys);
	}

	// Single key path
	return _useFactSingle(system, keyOrKeys);
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useFactSingle(system: System<any>, factKey: string): Accessor<unknown> {
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

function _useFactSelector(
	// biome-ignore lint/suspicious/noExplicitAny: Internal
	system: System<any>,
	factKey: string,
	selector: (value: unknown) => unknown,
	equalityFn: (a: unknown, b: unknown) => boolean,
): Accessor<unknown> {
	const initialValue = system.facts.$store.get(factKey);
	const [selected, setSelected] = createSignal(selector(initialValue));
	const unsubscribe = system.facts.$store.subscribe([factKey], () => {
		const newValue = system.facts.$store.get(factKey);
		const newSelected = selector(newValue);
		setSelected((prev) => {
			if (!equalityFn(prev, newSelected)) return newSelected;
			return prev;
		});
	});
	onCleanup(unsubscribe);
	return selected;
}

// ============================================================================
// useDerived — single key, multi key, or selector
// ============================================================================

/** Single key overload */
export function useDerived<T>(derivationId: string): Accessor<T>;
/** Multi-key overload */
export function useDerived<T extends Record<string, unknown>>(derivationIds: string[]): Accessor<T>;
/** Selector overload */
export function useDerived<T, R>(
	derivationId: string,
	selector: (value: T) => R,
	equalityFn?: (a: R, b: R) => boolean,
): Accessor<R>;
/** Implementation */
export function useDerived(
	idOrIds: string | string[],
	selectorOrUndefined?: (value: unknown) => unknown,
	equalityFn?: (a: unknown, b: unknown) => boolean,
): Accessor<unknown> {
	const system = _useSystem();

	// Selector path
	if (typeof idOrIds === "string" && typeof selectorOrUndefined === "function") {
		return _useDerivedSelector(system, idOrIds, selectorOrUndefined, equalityFn ?? defaultEquality);
	}

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

function _useDerivedSelector(
	// biome-ignore lint/suspicious/noExplicitAny: Internal
	system: System<any>,
	derivationId: string,
	selector: (value: unknown) => unknown,
	equalityFn: (a: unknown, b: unknown) => boolean,
): Accessor<unknown> {
	const initialValue = system.read(derivationId);
	const [selected, setSelected] = createSignal(selector(initialValue));
	const unsubscribe = system.subscribe([derivationId], () => {
		const newValue = system.read(derivationId);
		const newSelected = selector(newValue);
		setSelected((prev) => {
			if (!equalityFn(prev, newSelected)) return newSelected;
			return prev;
		});
	});
	onCleanup(unsubscribe);
	return selected;
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
	selector: (facts: Record<string, unknown>) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Accessor<R> {
	const system = _useSystem();

	const getFacts = (): Record<string, unknown> => system.facts.$store.toObject();

	// Run selector with tracking to detect accessed keys
	const { deps } = withTracking(() => selector(getFacts()));
	const keys = Array.from(deps) as string[];

	const [selected, setSelected] = createSignal<R>(selector(getFacts()));

	const subscribeFn = keys.length === 0
		? (cb: () => void) => system.facts.$store.subscribeAll(cb)
		: (cb: () => void) => system.facts.$store.subscribe(keys, cb);

	const unsubscribe = subscribeFn(() => {
		const newSelected = selector(getFacts());
		setSelected((prev) => {
			if (!equalityFn(prev, newSelected)) return newSelected;
			return prev;
		});
	});

	onCleanup(unsubscribe);

	return selected;
}

// ============================================================================
// useFacts — mutation accessor
// ============================================================================

/**
 * Get direct access to facts for mutations.
 * WARNING: NOT reactive. Use for event handlers and imperative code only.
 */
export function useFacts<M extends ModuleSchema>(): System<M>["facts"] {
	const system = _useSystem<M>();
	return system.facts;
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

/** Watch a derivation */
export function useWatch<T>(
	derivationId: string,
	callback: (newValue: T, previousValue: T | undefined) => void,
): void;
/** Watch a fact */
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

	const isFact =
		derivationIdOrKind === "fact" &&
		typeof callbackOrFactKey === "string" &&
		typeof maybeCallback === "function";

	if (isFact) {
		const factKey = callbackOrFactKey as string;
		const callback = maybeCallback!;
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic fact access
		let prev = (system.facts as any)[factKey];
		const unsubscribe = system.facts.$store.subscribe([factKey], () => {
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic fact access
			const next = (system.facts as any)[factKey];
			if (!Object.is(next, prev)) {
				callback(next, prev);
				prev = next;
			}
		});
		onCleanup(unsubscribe);
	} else {
		const derivationId = derivationIdOrKind;
		const callback = callbackOrFactKey as (newValue: unknown, prevValue: unknown) => void;
		const unsubscribe = system.watch(derivationId, callback);
		onCleanup(unsubscribe);
	}
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
// useModule — zero-config all-in-one hook
// ============================================================================

interface ModuleConfig {
	// biome-ignore lint/suspicious/noExplicitAny: Plugin types vary
	plugins?: Plugin<any>[];
	debug?: DebugConfig;
	errorBoundary?: ErrorBoundaryConfig;
	tickMs?: number;
	zeroConfig?: boolean;
	// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
	initialFacts?: Record<string, any>;
	status?: boolean;
}

/**
 * Zero-config hook that creates a scoped system from a module definition,
 * subscribes to ALL facts and derivations, and returns everything.
 */
export function useModule<M extends ModuleSchema>(
	moduleDef: ModuleDef<M>,
	config?: ModuleConfig,
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

	// Subscribe to all facts
	const [factsState, setFactsState] = createSignal(
		system.facts.$store.toObject() as InferFacts<M>,
	);
	const unsubFacts = system.facts.$store.subscribeAll(() => {
		setFactsState(() => system.facts.$store.toObject() as InferFacts<M>);
	});

	// Subscribe to all derivations
	const derivationKeys = Object.keys(system.derive ?? {});
	const getDerived = (): InferDerivations<M> => {
		const result: Record<string, unknown> = {};
		for (const key of derivationKeys) {
			result[key] = system.read(key);
		}
		return result as InferDerivations<M>;
	};
	const [derivedState, setDerivedState] = createSignal(getDerived());
	const unsubDerived = derivationKeys.length > 0
		? system.subscribe(derivationKeys, () => { setDerivedState(getDerived); })
		: () => {};

	onCleanup(() => {
		unsubFacts();
		unsubDerived();
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

// ============================================================================
// useSystem — get system from context
// ============================================================================

export function useSystem<M extends ModuleSchema = ModuleSchema>(): System<M> {
	return _useSystem<M>();
}

// ============================================================================
// useTimeTravel — reactive time-travel signal
// ============================================================================

import type { TimeTravelState } from "../core/types.js";

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

export type UseDirectiveOptions<M extends ModuleSchema> =
	| ModuleDef<M>
	| CreateSystemOptionsSingle<M>;

// biome-ignore lint/suspicious/noExplicitAny: Cache needs to work with any schema
const systemCache = new WeakMap<object, System<any>>();
const warnedOptions = new WeakSet<object>();

/**
 * Create a scoped Directive system with automatic lifecycle management.
 */
export function useDirective<M extends ModuleSchema>(
	options: UseDirectiveOptions<M>,
): System<M> {
	const cached = systemCache.get(options as object);
	if (cached) return cached as System<M>;

	if (process.env.NODE_ENV !== "production") {
		if (!warnedOptions.has(options as object)) {
			warnedOptions.add(options as object);
			const isInlineOptions = !("id" in options && "schema" in options);
			if (isInlineOptions) {
				console.warn(
					"[Directive] useDirective received options that may not be stable. " +
					"If you see this warning repeatedly, ensure your options object is defined " +
					"outside the component or memoized.",
				);
			}
		}
	}

	const isModule = "id" in options && "schema" in options;
	const system = isModule
		? createSystem({ module: options as ModuleDef<M> })
		: createSystem(options as CreateSystemOptionsSingle<M>);

	// biome-ignore lint/suspicious/noExplicitAny: Cache needs to work with any schema
	systemCache.set(options as object, system as unknown as System<any>);

	system.start();

	onCleanup(() => {
		system.destroy();
		systemCache.delete(options as object);
	});

	return system as unknown as System<M>;
}

/** @deprecated Alias for useDirective */
export const createDirective = useDirective;

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
	useFacts: () => System<M>["facts"];
	useDispatch: () => (event: InferEvents<M>) => void;
	useSystem: () => System<M>;
	useEvents: () => System<M>["events"];
} {
	return {
		useDerived: <K extends keyof InferDerivations<M>>(derivationId: K) =>
			useDerived<InferDerivations<M>[K]>(derivationId as string),
		useFact: <K extends keyof InferFacts<M>>(factKey: K) =>
			useFact<InferFacts<M>[K]>(factKey as string),
		useFacts: () => useFacts<M>(),
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

// ============================================================================
// Deprecated Re-exports (one release cycle)
// ============================================================================

/**
 * @deprecated Use `useDerived(ids)` instead.
 */
export function useDeriveds<T extends Record<string, unknown>>(
	derivationIds: string[],
): Accessor<T> {
	return useDerived<T>(derivationIds);
}

/**
 * @deprecated Use `useFact(key, selector, eq?)` instead.
 */
export function useFactSelector<T, R>(
	factKey: string,
	selector: (value: T | undefined) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Accessor<R> {
	return useFact<T, R>(factKey, selector, equalityFn);
}

/**
 * @deprecated Use `useDerived(id, selector, eq?)` instead.
 */
export function useDerivedSelector<T, R>(
	derivationId: string,
	selector: (value: T) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Accessor<R> {
	return useDerived<T, R>(derivationId, selector, equalityFn);
}

/**
 * @deprecated Use `useInspect({ throttleMs })` instead.
 */
export function useInspectThrottled(
	options: ThrottledHookOptions = {},
): Accessor<InspectState> {
	return useInspect({ throttleMs: options.throttleMs ?? 100 });
}

/**
 * @deprecated Use `useInspect()` instead.
 */
export function useRequirements(): Accessor<RequirementsState> {
	const system = _useSystem();
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
 * @deprecated Use `useInspect({ throttleMs })` instead.
 */
export function useRequirementsThrottled(
	options: ThrottledHookOptions = {},
): Accessor<RequirementsState> {
	const { throttleMs = 100 } = options;
	const system = _useSystem();
	const [state, setState] = createSignal<RequirementsState>(
		computeRequirementsState(system.inspect()),
	);
	const { throttled, cleanup } = createThrottle(() => {
		setState(computeRequirementsState(system.inspect()));
	}, throttleMs);
	const unsubscribe = system.facts.$store.subscribeAll(throttled);
	onCleanup(() => { cleanup(); unsubscribe(); });
	return state;
}

/**
 * @deprecated Use `useInspect().isSettled` instead.
 */
export function useIsSettled(): Accessor<boolean> {
	const system = _useSystem();
	const [isSettled, setIsSettled] = createSignal(system.isSettled);
	const unsubscribe = system.facts.$store.subscribeAll(() => {
		setIsSettled(system.isSettled);
	});
	onCleanup(unsubscribe);
	return isSettled;
}

/**
 * @deprecated Use `useRequirementStatus(type)` and check `.inflight > 0` instead.
 */
export function useIsResolving(type: string): Accessor<boolean> {
	const status = useRequirementStatus(type);
	return () => status().inflight > 0;
}

/**
 * @deprecated Use `useRequirementStatus(type)` and check `.lastError` instead.
 */
export function useLatestError(type: string): Accessor<Error | null> {
	const status = useRequirementStatus(type);
	return () => status().lastError;
}

/**
 * @deprecated Use `useRequirementStatus(types)` instead.
 */
export function useRequirementStatuses(): Accessor<Map<string, RequirementTypeStatus>> {
	const statusPlugin = _getStatusPlugin();
	const [allStatuses, setAllStatuses] = createSignal<Map<string, RequirementTypeStatus>>(
		statusPlugin.getAllStatus(),
	);
	const unsubscribe = statusPlugin.subscribe(() => {
		setAllStatuses(statusPlugin.getAllStatus());
	});
	onCleanup(unsubscribe);
	return allStatuses;
}
