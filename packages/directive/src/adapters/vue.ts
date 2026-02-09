/**
 * Vue Adapter - Consolidated Vue 3 composables for Directive
 *
 * 19 active exports: useFact, useDerived, useFacts, useDispatch, useSelector,
 * useWatch, useInspect, useRequirementStatus, useEvents, useModule, useExplain,
 * useConstraintStatus, useOptimisticUpdate, useDirective, useTimeTravel,
 * useSystem, provideSystem, createDirectivePlugin, createTypedHooks, shallowEqual
 *
 * 10 deprecated shims for backward compatibility.
 */

import {
	computed,
	inject,
	onUnmounted,
	provide,
	ref,
	shallowRef,
	type App,
	type ComputedRef,
	type InjectionKey,
	type Ref,
	type ShallowRef,
} from "vue";
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
	SystemInspection,
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
const DirectiveKey: InjectionKey<System<any>> = Symbol("directive");
const StatusPluginKey: InjectionKey<StatusPlugin | null> = Symbol("directive-status");

/**
 * Vue plugin to provide the Directive system globally.
 */
export function createDirectivePlugin<M extends ModuleSchema>(
	system: System<M>,
	statusPlugin?: StatusPlugin
) {
	return {
		install(app: App) {
			// biome-ignore lint/suspicious/noExplicitAny: System type varies
			app.provide(DirectiveKey, system as System<any>);
			app.provide(StatusPluginKey, statusPlugin ?? null);
		},
	};
}

/**
 * Provide Directive system to child components (alternative to plugin).
 */
export function provideSystem<M extends ModuleSchema>(
	system: System<M>,
	statusPlugin?: StatusPlugin
): void {
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	provide(DirectiveKey, system as System<any>);
	provide(StatusPluginKey, statusPlugin ?? null);
}

// ============================================================================
// Internal Helpers
// ============================================================================

/** Default equality function using Object.is */
function defaultEquality<T>(a: T, b: T): boolean {
	return Object.is(a, b);
}

function _useSystem<M extends ModuleSchema = ModuleSchema>(): System<M> {
	const system = inject(DirectiveKey);
	if (!system) {
		throw new Error(
			"[Directive] useSystem must be used within a component tree that has a Directive system provided. " +
			"Use createDirectivePlugin() or provideSystem() in a parent component.",
		);
	}
	return system as System<M>;
}

function _getStatusPlugin(): StatusPlugin {
	const statusPlugin = inject(StatusPluginKey);
	if (!statusPlugin) {
		throw new Error(
			"[Directive] This hook requires a statusPlugin. " +
			"Pass statusPlugin to createDirectivePlugin() or provideSystem().",
		);
	}
	return statusPlugin;
}

// ============================================================================
// useFact — single key, multi key, or selector
// ============================================================================

/** Single key overload */
export function useFact<T>(factKey: string): Ref<T | undefined>;
/** Multi-key overload */
export function useFact<T extends Record<string, unknown>>(factKeys: string[]): ShallowRef<T>;
/** Selector overload */
export function useFact<T, R>(
	factKey: string,
	selector: (value: T | undefined) => R,
	equalityFn?: (a: R, b: R) => boolean,
): Ref<R>;
/** Implementation */
export function useFact(
	keyOrKeys: string | string[],
	selectorOrUndefined?: (value: unknown) => unknown,
	equalityFn?: (a: unknown, b: unknown) => boolean,
): Ref<unknown> | ShallowRef<unknown> {
	const system = _useSystem();

	// Selector path: useFact(factKey, selector, eq?)
	if (typeof keyOrKeys === "string" && typeof selectorOrUndefined === "function") {
		return _useFactSelector(system, keyOrKeys, selectorOrUndefined, equalityFn ?? defaultEquality);
	}

	// Multi-key path: useFact([keys])
	if (Array.isArray(keyOrKeys)) {
		return _useFactMulti(system, keyOrKeys);
	}

	// Single key path: useFact(key)
	return _useFactSingle(system, keyOrKeys);
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useFactSingle(system: System<any>, factKey: string): Ref<unknown> {
	const value = ref(system.facts.$store.get(factKey));
	const unsubscribe = system.facts.$store.subscribe([factKey], () => {
		value.value = system.facts.$store.get(factKey);
	});
	onUnmounted(unsubscribe);
	return value;
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useFactMulti(system: System<any>, factKeys: string[]): ShallowRef<Record<string, unknown>> {
	const getValues = (): Record<string, unknown> => {
		const result: Record<string, unknown> = {};
		for (const key of factKeys) {
			result[key] = system.facts.$store.get(key);
		}
		return result;
	};
	const state = shallowRef(getValues());
	const unsubscribe = system.facts.$store.subscribe(factKeys, () => {
		state.value = getValues();
	});
	onUnmounted(unsubscribe);
	return state;
}

function _useFactSelector(
	// biome-ignore lint/suspicious/noExplicitAny: Internal
	system: System<any>,
	factKey: string,
	selector: (value: unknown) => unknown,
	equalityFn: (a: unknown, b: unknown) => boolean,
): Ref<unknown> {
	const initialValue = system.facts.$store.get(factKey);
	const selected = ref(selector(initialValue));
	const unsubscribe = system.facts.$store.subscribe([factKey], () => {
		const newValue = system.facts.$store.get(factKey);
		const newSelected = selector(newValue);
		if (!equalityFn(selected.value, newSelected)) {
			selected.value = newSelected;
		}
	});
	onUnmounted(unsubscribe);
	return selected;
}

// ============================================================================
// useDerived — single key, multi key, or selector
// ============================================================================

/** Single key overload */
export function useDerived<T>(derivationId: string): Ref<T>;
/** Multi-key overload */
export function useDerived<T extends Record<string, unknown>>(derivationIds: string[]): ShallowRef<T>;
/** Selector overload */
export function useDerived<T, R>(
	derivationId: string,
	selector: (value: T) => R,
	equalityFn?: (a: R, b: R) => boolean,
): Ref<R>;
/** Implementation */
export function useDerived(
	idOrIds: string | string[],
	selectorOrUndefined?: (value: unknown) => unknown,
	equalityFn?: (a: unknown, b: unknown) => boolean,
): Ref<unknown> | ShallowRef<unknown> {
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
function _useDerivedSingle(system: System<any>, derivationId: string): Ref<unknown> {
	if (process.env.NODE_ENV !== "production") {
		const initialValue = system.read(derivationId);
		if (initialValue === undefined) {
			console.warn(
				`[Directive] useDerived("${derivationId}") returned undefined. ` +
				`Check that "${derivationId}" is defined in your module's derive property.`,
			);
		}
	}
	const value = ref(system.read(derivationId));
	const unsubscribe = system.subscribe([derivationId], () => {
		value.value = system.read(derivationId);
	});
	onUnmounted(unsubscribe);
	return value;
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useDerivedMulti(system: System<any>, derivationIds: string[]): ShallowRef<Record<string, unknown>> {
	const getValues = (): Record<string, unknown> => {
		const result: Record<string, unknown> = {};
		for (const id of derivationIds) {
			result[id] = system.read(id);
		}
		return result;
	};
	const state = shallowRef(getValues());
	const unsubscribe = system.subscribe(derivationIds, () => {
		state.value = getValues();
	});
	onUnmounted(unsubscribe);
	return state;
}

function _useDerivedSelector(
	// biome-ignore lint/suspicious/noExplicitAny: Internal
	system: System<any>,
	derivationId: string,
	selector: (value: unknown) => unknown,
	equalityFn: (a: unknown, b: unknown) => boolean,
): Ref<unknown> {
	const initialValue = system.read(derivationId);
	const selected = ref(selector(initialValue));
	const unsubscribe = system.subscribe([derivationId], () => {
		const newValue = system.read(derivationId);
		const newSelected = selector(newValue);
		if (!equalityFn(selected.value, newSelected)) {
			selected.value = newSelected;
		}
	});
	onUnmounted(unsubscribe);
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
): Ref<R> {
	const system = _useSystem();

	const getFacts = (): Record<string, unknown> => system.facts.$store.toObject();

	// Run selector with tracking to detect accessed keys
	const { deps } = withTracking(() => selector(getFacts()));
	const keys = Array.from(deps) as string[];

	const selected = ref<R>(selector(getFacts())) as Ref<R>;

	const subscribeFn = keys.length === 0
		? (cb: () => void) => system.facts.$store.subscribeAll(cb)
		: (cb: () => void) => system.facts.$store.subscribe(keys, cb);

	const unsubscribe = subscribeFn(() => {
		const newSelected = selector(getFacts());
		if (!equalityFn(selected.value, newSelected)) {
			selected.value = newSelected;
		}
	});

	onUnmounted(unsubscribe);

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
		onUnmounted(unsubscribe);
	} else {
		const derivationId = derivationIdOrKind;
		const callback = callbackOrFactKey as (newValue: unknown, prevValue: unknown) => void;
		const unsubscribe = system.watch(derivationId, callback);
		onUnmounted(unsubscribe);
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
 * Returns InspectState with optional throttling.
 */
export function useInspect(options?: UseInspectOptions): ShallowRef<InspectState> {
	const system = _useSystem();
	const state = shallowRef<InspectState>(computeInspectState(system));

	const update = () => {
		state.value = computeInspectState(system);
	};

	if (options?.throttleMs && options.throttleMs > 0) {
		const { throttled, cleanup } = createThrottle(update, options.throttleMs);
		const unsubFacts = system.facts.$store.subscribeAll(throttled);
		const unsubSettled = system.onSettledChange(throttled);
		onUnmounted(() => {
			cleanup();
			unsubFacts();
			unsubSettled();
		});
	} else {
		const unsubFacts = system.facts.$store.subscribeAll(update);
		const unsubSettled = system.onSettledChange(update);
		onUnmounted(() => {
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
export function useRequirementStatus(type: string): ShallowRef<RequirementTypeStatus>;
/** Multi-type overload */
export function useRequirementStatus(types: string[]): ShallowRef<Record<string, RequirementTypeStatus>>;
/** Implementation */
export function useRequirementStatus(
	typeOrTypes: string | string[],
): ShallowRef<RequirementTypeStatus> | ShallowRef<Record<string, RequirementTypeStatus>> {
	const statusPlugin = _getStatusPlugin();

	if (Array.isArray(typeOrTypes)) {
		const getValues = (): Record<string, RequirementTypeStatus> => {
			const result: Record<string, RequirementTypeStatus> = {};
			for (const type of typeOrTypes) {
				result[type] = statusPlugin.getStatus(type);
			}
			return result;
		};
		const state = shallowRef(getValues());
		const unsubscribe = statusPlugin.subscribe(() => {
			state.value = getValues();
		});
		onUnmounted(unsubscribe);
		return state;
	}

	const status = shallowRef<RequirementTypeStatus>(statusPlugin.getStatus(typeOrTypes));
	const unsubscribe = statusPlugin.subscribe(() => {
		status.value = statusPlugin.getStatus(typeOrTypes);
	});
	onUnmounted(unsubscribe);
	return status;
}

// ============================================================================
// useExplain — reactive requirement explanation
// ============================================================================

/**
 * Reactively returns the explanation string for a requirement.
 */
export function useExplain(requirementId: string): Ref<string | null> {
	const system = _useSystem();
	const explanation = ref<string | null>(system.explain(requirementId)) as Ref<string | null>;

	const update = () => {
		explanation.value = system.explain(requirementId);
	};

	const unsubFacts = system.facts.$store.subscribeAll(update);
	const unsubSettled = system.onSettledChange(update);
	onUnmounted(() => {
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
): ShallowRef<ConstraintInfo[] | ConstraintInfo | null> {
	const inspectState = useInspect();

	return computed(() => {
		const inspection = inspectState.value;
		// We need the raw constraint list from inspect()
		const system = _useSystem();
		const fullInspection = system.inspect();
		if (!constraintId) return fullInspection.constraints;
		return fullInspection.constraints.find((c) => c.id === constraintId) ?? null;
	}) as unknown as ShallowRef<ConstraintInfo[] | ConstraintInfo | null>;
}

// ============================================================================
// useOptimisticUpdate — batch with rollback on failure
// ============================================================================

export interface OptimisticUpdateResult {
	mutate: (updateFn: () => void) => void;
	isPending: Ref<boolean>;
	error: Ref<Error | null>;
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
	const isPending = ref(false);
	const error = ref<Error | null>(null) as Ref<Error | null>;
	let snapshot: SystemSnapshot | null = null;
	let unsubscribe: (() => void) | null = null;

	const rollback = () => {
		if (snapshot) {
			system.restore(snapshot);
			snapshot = null;
		}
		isPending.value = false;
		error.value = null;
		unsubscribe?.();
		unsubscribe = null;
	};

	const mutate = (updateFn: () => void) => {
		snapshot = system.getSnapshot();
		isPending.value = true;
		error.value = null;
		system.batch(updateFn);

		// Watch for resolver completion/failure
		if (statusPlugin && requirementType) {
			unsubscribe?.();
			unsubscribe = statusPlugin.subscribe(() => {
				const status = statusPlugin.getStatus(requirementType);
				if (!status.isLoading && !status.hasError) {
					snapshot = null;
					isPending.value = false;
					unsubscribe?.();
					unsubscribe = null;
				} else if (status.hasError) {
					error.value = status.lastError;
					rollback();
				}
			});
		}
	};

	onUnmounted(() => {
		unsubscribe?.();
	});

	return { mutate, isPending, error, rollback };
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

	onUnmounted(() => {
		system.destroy();
	});

	// Subscribe to all facts
	const factsState = shallowRef(system.facts.$store.toObject() as InferFacts<M>);
	const unsubFacts = system.facts.$store.subscribeAll(() => {
		factsState.value = system.facts.$store.toObject() as InferFacts<M>;
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
	const derivedState = shallowRef(getDerived());
	const unsubDerived = derivationKeys.length > 0
		? system.subscribe(derivationKeys, () => { derivedState.value = getDerived(); })
		: () => {};

	onUnmounted(() => {
		unsubFacts();
		unsubDerived();
	});

	const events = system.events;
	const dispatch = (event: InferEvents<M>) => system.dispatch(event);

	return {
		system,
		facts: factsState as ShallowRef<InferFacts<M>>,
		derived: derivedState as ShallowRef<InferDerivations<M>>,
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
// useTimeTravel — reactive time-travel state
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
 * Reactive time-travel composable. Returns a ShallowRef that updates
 * when snapshots are taken or navigation occurs.
 *
 * @example
 * ```vue
 * const tt = useTimeTravel();
 * <button :disabled="!tt.value?.canUndo" @click="tt.value?.undo()">Undo</button>
 * ```
 */
export function useTimeTravel(): ShallowRef<TimeTravelState | null> {
	const system = _useSystem();
	const state = shallowRef<TimeTravelState | null>(_buildTTState(system));
	const unsub = system.onTimeTravelChange(() => {
		state.value = _buildTTState(system);
	});
	onUnmounted(unsub);
	return state;
}

// ============================================================================
// Scoped System Composable
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

	onUnmounted(() => {
		system.destroy();
		systemCache.delete(options as object);
	});

	return system as unknown as System<M>;
}

// ============================================================================
// Typed Hooks Factory
// ============================================================================

export function createTypedHooks<M extends ModuleSchema>(): {
	useDerived: <K extends keyof InferDerivations<M>>(
		derivationId: K,
	) => Ref<InferDerivations<M>[K]>;
	useFact: <K extends keyof InferFacts<M>>(factKey: K) => Ref<InferFacts<M>[K] | undefined>;
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
): ShallowRef<T> {
	return useDerived<T>(derivationIds);
}

/**
 * @deprecated Use `useFact(key, selector, eq?)` instead.
 */
export function useFactSelector<T, R>(
	factKey: string,
	selector: (value: T | undefined) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Ref<R> {
	return useFact<T, R>(factKey, selector, equalityFn);
}

/**
 * @deprecated Use `useDerived(id, selector, eq?)` instead.
 */
export function useDerivedSelector<T, R>(
	derivationId: string,
	selector: (value: T) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Ref<R> {
	return useDerived<T, R>(derivationId, selector, equalityFn);
}

/**
 * @deprecated Use `useInspect({ throttleMs })` instead.
 */
export function useInspectThrottled(
	options: ThrottledHookOptions = {},
): ShallowRef<InspectState> {
	return useInspect({ throttleMs: options.throttleMs ?? 100 });
}

/**
 * @deprecated Use `useInspect()` instead.
 */
export function useRequirements(): ShallowRef<RequirementsState> {
	const system = _useSystem();
	const state = shallowRef<RequirementsState>(computeRequirementsState(system.inspect()));
	const unsubscribe = system.facts.$store.subscribeAll(() => {
		state.value = computeRequirementsState(system.inspect());
	});
	onUnmounted(unsubscribe);
	return state;
}

/**
 * @deprecated Use `useInspect({ throttleMs })` instead.
 */
export function useRequirementsThrottled(
	options: ThrottledHookOptions = {},
): ShallowRef<RequirementsState> {
	const { throttleMs = 100 } = options;
	const system = _useSystem();
	const state = shallowRef<RequirementsState>(computeRequirementsState(system.inspect()));
	const { throttled, cleanup } = createThrottle(() => {
		state.value = computeRequirementsState(system.inspect());
	}, throttleMs);
	const unsubscribe = system.facts.$store.subscribeAll(throttled);
	onUnmounted(() => { cleanup(); unsubscribe(); });
	return state;
}

/**
 * @deprecated Use `useInspect().value.isSettled` instead.
 */
export function useIsSettled(): Ref<boolean> {
	const system = _useSystem();
	const isSettled = ref(system.isSettled);
	const unsubscribe = system.facts.$store.subscribeAll(() => {
		isSettled.value = system.isSettled;
	});
	onUnmounted(unsubscribe);
	return isSettled;
}

/**
 * @deprecated Use `useRequirementStatus(type).value.inflight > 0` instead.
 */
export function useIsResolving(type: string): ComputedRef<boolean> {
	const status = useRequirementStatus(type);
	return computed(() => status.value.inflight > 0);
}

/**
 * @deprecated Use `useRequirementStatus(type).value.lastError` instead.
 */
export function useLatestError(type: string): ComputedRef<Error | null> {
	const status = useRequirementStatus(type);
	return computed(() => status.value.lastError);
}

/**
 * @deprecated Use `useRequirementStatus(types)` instead.
 */
export function useRequirementStatuses(): Ref<Map<string, RequirementTypeStatus>> {
	const statusPlugin = _getStatusPlugin();
	const allStatuses = ref<Map<string, RequirementTypeStatus>>(statusPlugin.getAllStatus());
	const unsubscribe = statusPlugin.subscribe(() => {
		allStatuses.value = statusPlugin.getAllStatus();
	});
	onUnmounted(unsubscribe);
	return allStatuses;
}
