/**
 * Vue Adapter - Vue 3 composables for Directive
 *
 * Exports: useFact, useDerived, useDispatch, useSelector,
 * useWatch, useInspect, useRequirementStatus, useEvents, useExplain,
 * useConstraintStatus, useOptimisticUpdate, useDirective, useTimeTravel,
 * useSystem, provideSystem, createDirectivePlugin, createTypedHooks, shallowEqual
 */

import {
	computed,
	inject,
	onUnmounted,
	provide,
	ref,
	shallowRef,
	type App,
	type InjectionKey,
	type Ref,
	type ShallowRef,
} from "vue";
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
// useFact — single key or multi key
// ============================================================================

/** Single key overload */
export function useFact<T>(factKey: string): Ref<T | undefined>;
/** Multi-key overload */
export function useFact<T extends Record<string, unknown>>(factKeys: string[]): ShallowRef<T>;
/** Implementation */
export function useFact(
	keyOrKeys: string | string[],
): Ref<unknown> | ShallowRef<unknown> {
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
	return _useFactSingle(system, keyOrKeys);
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useFactSingle(system: System<any>, factKey: string): Ref<unknown> {
	if (process.env.NODE_ENV !== "production") {
		if (!system.facts.$store.has(factKey)) {
			console.warn(
				`[Directive] useFact("${factKey}") — fact not found in store. ` +
				`Check that "${factKey}" is defined in your module's schema.`,
			);
		}
	}

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

// ============================================================================
// useDerived — single key or multi key
// ============================================================================

/** Single key overload */
export function useDerived<T>(derivationId: string): Ref<T>;
/** Multi-key overload */
export function useDerived<T extends Record<string, unknown>>(derivationIds: string[]): ShallowRef<T>;
/** Implementation */
export function useDerived(
	idOrIds: string | string[],
): Ref<unknown> | ShallowRef<unknown> {
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
): Ref<R> {
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
	const selected = ref<R>(initial.value) as Ref<R>;

	const unsubs: Array<() => void> = [];

	const resubscribe = () => {
		for (const unsub of unsubs) unsub();
		unsubs.length = 0;

		const onUpdate = () => {
			const result = runWithTracking();
			if (!equalityFn(selected.value, result.value)) {
				selected.value = result.value;
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

	onUnmounted(() => {
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
	onUnmounted(unsubscribe);
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

	const system = _useSystem();

	return computed(() => {
		// Track reactivity via inspectState, but use full inspect() for constraint list
		void inspectState.value;
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
// useSystem — get system from context
// ============================================================================

export function useSystem<M extends ModuleSchema = ModuleSchema>(): System<M> {
	return _useSystem<M>();
}

// ============================================================================
// useTimeTravel — reactive time-travel state
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
 * facts and derivations and returns reactive state.
 *
 * @example
 * ```vue
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

	onUnmounted(() => {
		system.destroy();
	});

	const factKeys = config?.facts;
	const derivedKeys = config?.derived;
	const subscribeAll = !factKeys && !derivedKeys;

	// Subscribe to facts
	const factsState = shallowRef(
		subscribeAll
			? (system.facts.$store.toObject() as InferFacts<M>)
			: _pickFacts(system, factKeys ?? []),
	);
	const unsubFacts = subscribeAll
		? system.facts.$store.subscribeAll(() => {
			factsState.value = system.facts.$store.toObject() as InferFacts<M>;
		})
		: factKeys && factKeys.length > 0
			? system.facts.$store.subscribe(factKeys, () => {
				factsState.value = _pickFacts(system, factKeys) as InferFacts<M>;
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
	const derivedState = shallowRef(getDerived());
	const unsubDerived = allDerivationKeys.length > 0
		? system.subscribe(allDerivationKeys, () => { derivedState.value = getDerived(); })
		: null;

	onUnmounted(() => {
		unsubFacts?.();
		unsubDerived?.();
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
	) => Ref<InferDerivations<M>[K]>;
	useFact: <K extends keyof InferFacts<M>>(factKey: K) => Ref<InferFacts<M>[K] | undefined>;
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

