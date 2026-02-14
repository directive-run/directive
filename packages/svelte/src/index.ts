/**
 * Svelte Adapter - Consolidated Svelte stores for Directive
 *
 * 15 active exports: useFact, useDerived, useDispatch, useSelector,
 * useWatch, useInspect, useRequirementStatus, useEvents, useExplain,
 * useConstraintStatus, useOptimisticUpdate, useDirective, useTimeTravel,
 * createTypedHooks, shallowEqual
 *
 * Store factories: createDerivedStore, createDerivedsStore, createFactStore, createInspectStore
 */

import { onDestroy } from "svelte";
import { readable, type Readable } from "svelte/store";
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
	SystemInspection,
	SystemSnapshot,
	TimeTravelState,
} from "@directive-run/core";
import {
	createSystem,
	createRequirementStatusPlugin,
} from "@directive-run/core";
import type { RequirementTypeStatus } from "@directive-run/core";
import {
	type InspectState,
	type ConstraintInfo,
	computeInspectState,
	createThrottle,
	assertSystem,
	defaultEquality,
	buildTimeTravelState,
	pickFacts,
	runTrackedSelector,
	depsChanged,
	shallowEqual,
} from "@directive-run/core/adapter-utils";

// Re-export for convenience
export type { RequirementTypeStatus, InspectState, ConstraintInfo };
export { shallowEqual };

/** Type for the requirement status plugin return value */
export type StatusPlugin = ReturnType<typeof createRequirementStatusPlugin>;

// ============================================================================
// Store Factories
// ============================================================================

/**
 * Create a Svelte store for a derived value.
 */
export function createDerivedStore<T>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: SingleModuleSystem<any>,
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
	system: SingleModuleSystem<any>,
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
	system: SingleModuleSystem<any>,
	factKey: string,
): Readable<T | undefined> {
	if (process.env.NODE_ENV !== "production") {
		if (!system.facts.$store.has(factKey)) {
			console.warn(
				`[Directive] createFactStore("${factKey}") — fact not found in store. ` +
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
	system: SingleModuleSystem<any>,
): Readable<SystemInspection> {
	return readable<SystemInspection>(system.inspect(), (set) => {
		const update = () => set(system.inspect());
		const unsubFacts = system.facts.$store.subscribeAll(update);
		const unsubSettled = system.onSettledChange(update);
		return () => {
			unsubFacts();
			unsubSettled();
		};
	});
}

// ============================================================================
// useFact — single key or multi key
// ============================================================================

/** Single key overload */
export function useFact<S extends ModuleSchema, K extends keyof InferFacts<S> & string>(system: SingleModuleSystem<S>, factKey: K): Readable<InferFacts<S>[K] | undefined>;
/** Multi-key overload */
export function useFact<S extends ModuleSchema, K extends keyof InferFacts<S> & string>(system: SingleModuleSystem<S>, factKeys: K[]): Readable<Pick<InferFacts<S>, K>>;
/** Implementation */
export function useFact(
	// biome-ignore lint/suspicious/noExplicitAny: Implementation signature
	system: SingleModuleSystem<any>,
	keyOrKeys: string | string[],
): Readable<unknown> {
	assertSystem("useFact", system);
	if (process.env.NODE_ENV !== "production" && typeof keyOrKeys === "function") {
		console.error(
			"[Directive] useFact() received a function. Did you mean useSelector()? " +
				"useFact() takes a string key or array of keys, not a selector function.",
		);
	}

	// Multi-key path: useFact(system, [keys])
	if (Array.isArray(keyOrKeys)) {
		return _useFactMulti(system, keyOrKeys);
	}

	// Single key path: useFact(system, key)
	return createFactStore(system, keyOrKeys);
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useFactMulti(system: SingleModuleSystem<any>, factKeys: string[]): Readable<Record<string, unknown>> {
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
export function useDerived<S extends ModuleSchema, K extends keyof InferDerivations<S> & string>(system: SingleModuleSystem<S>, derivationId: K): Readable<InferDerivations<S>[K]>;
/** Multi-key overload */
export function useDerived<S extends ModuleSchema, K extends keyof InferDerivations<S> & string>(system: SingleModuleSystem<S>, derivationIds: K[]): Readable<Pick<InferDerivations<S>, K>>;
/** Implementation */
export function useDerived(
	// biome-ignore lint/suspicious/noExplicitAny: Implementation signature
	system: SingleModuleSystem<any>,
	idOrIds: string | string[],
): Readable<unknown> {
	assertSystem("useDerived", system);
	if (process.env.NODE_ENV !== "production" && typeof idOrIds === "function") {
		console.error(
			"[Directive] useDerived() received a function. Did you mean useSelector()? " +
				"useDerived() takes a string key or array of keys, not a selector function.",
		);
	}

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
export function useSelector<S extends ModuleSchema, R>(system: SingleModuleSystem<S>, selector: (facts: InferFacts<S>) => R, equalityFn?: (a: R, b: R) => boolean): Readable<R>;
export function useSelector<R>(
	// biome-ignore lint/suspicious/noExplicitAny: Backward-compatible fallback
	system: SingleModuleSystem<any>,
	// biome-ignore lint/suspicious/noExplicitAny: Selector receives dynamic facts
	selector: (facts: Record<string, any>) => R,
	equalityFn?: (a: R, b: R) => boolean,
): Readable<R>;
export function useSelector(
	// biome-ignore lint/suspicious/noExplicitAny: Implementation signature
	system: SingleModuleSystem<any>,
	// biome-ignore lint/suspicious/noExplicitAny: Implementation signature
	selector: (state: any) => unknown,
	equalityFn: (a: unknown, b: unknown) => boolean = defaultEquality,
): Readable<unknown> {
	assertSystem("useSelector", system);
	const deriveKeySet = new Set(Object.keys(system.derive ?? {}));

	// Build a tracking-aware state proxy that exposes both facts and derivations
	const runWithTracking = () => runTrackedSelector(system, deriveKeySet, selector);

	const initial = runWithTracking();

	return readable(initial.value, (set) => {
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
				if (depsChanged(trackedFactKeys, result.factKeys, trackedDeriveKeys, result.deriveKeys)) {
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

export function useDispatch<S extends ModuleSchema>(
	system: SingleModuleSystem<S>,
): (event: InferEvents<S>) => void {
	assertSystem("useDispatch", system);
	return (event: InferEvents<S>) => {
		system.dispatch(event);
	};
}

// ============================================================================
// useEvents — memoized events reference
// ============================================================================

/**
 * Returns the system's events dispatcher.
 */
export function useEvents<S extends ModuleSchema>(
	system: SingleModuleSystem<S>,
): SingleModuleSystem<S>["events"] {
	assertSystem("useEvents", system);
	return system.events;
}

// ============================================================================
// useWatch — derivation or fact side-effect
// ============================================================================

/** Watch a derivation or fact by key (auto-detected). When a key exists in both facts and derivations, the derivation overload takes priority. */
export function useWatch<S extends ModuleSchema, K extends keyof InferDerivations<S> & string>(
	system: SingleModuleSystem<S>,
	key: K,
	callback: (newValue: InferDerivations<S>[K], previousValue: InferDerivations<S>[K] | undefined) => void,
): void;
/** Watch a fact key with auto-detection. */
export function useWatch<S extends ModuleSchema, K extends keyof InferFacts<S> & string>(
	system: SingleModuleSystem<S>,
	key: K,
	callback: (newValue: InferFacts<S>[K] | undefined, previousValue: InferFacts<S>[K] | undefined) => void,
): void;
/**
 * Watch a fact by explicit "fact" discriminator.
 * @deprecated Use `useWatch(system, key, callback)` instead — facts are now auto-detected.
 */
export function useWatch<S extends ModuleSchema, K extends keyof InferFacts<S> & string>(
	system: SingleModuleSystem<S>,
	kind: "fact",
	factKey: K,
	callback: (newValue: InferFacts<S>[K] | undefined, previousValue: InferFacts<S>[K] | undefined) => void,
): void;
/** Watch a fact or derivation (generic fallback) */
export function useWatch<T>(
	// biome-ignore lint/suspicious/noExplicitAny: Backward-compatible fallback
	system: SingleModuleSystem<any>,
	key: string,
	callback: (newValue: T, previousValue: T | undefined) => void,
): void;
/** Implementation */
export function useWatch(
	// biome-ignore lint/suspicious/noExplicitAny: Implementation signature
	system: SingleModuleSystem<any>,
	derivationIdOrKind: string,
	callbackOrFactKey: string | ((newValue: unknown, prevValue: unknown) => void),
	maybeCallback?: (newValue: unknown, prevValue: unknown) => void,
): void {
	assertSystem("useWatch", system);
	// Backward compat: useWatch(system, "fact", factKey, callback)
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
export function useInspect(
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	system: SingleModuleSystem<any>,
	options?: UseInspectOptions,
): Readable<InspectState> {
	assertSystem("useInspect", system);
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
export function useRequirementStatus(statusPlugin: StatusPlugin, type: string): Readable<RequirementTypeStatus>;
/** Multi-type overload */
export function useRequirementStatus(statusPlugin: StatusPlugin, types: string[]): Readable<Record<string, RequirementTypeStatus>>;
/** Implementation */
export function useRequirementStatus(
	statusPlugin: StatusPlugin,
	typeOrTypes: string | string[],
): Readable<RequirementTypeStatus> | Readable<Record<string, RequirementTypeStatus>> {
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
export function useExplain(
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	system: SingleModuleSystem<any>,
	requirementId: string,
): Readable<string | null> {
	assertSystem("useExplain", system);
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

/** Get all constraints */
export function useConstraintStatus(
	system: SingleModuleSystem<any>,
): Readable<ConstraintInfo[]>;
/** Get a single constraint by ID */
export function useConstraintStatus(
	system: SingleModuleSystem<any>,
	constraintId: string,
): Readable<ConstraintInfo | null>;
/** Implementation */
export function useConstraintStatus(
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	system: SingleModuleSystem<any>,
	constraintId?: string,
): Readable<ConstraintInfo[] | ConstraintInfo | null> {
	assertSystem("useConstraintStatus", system);
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
	system: SingleModuleSystem<any>,
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
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	system: SingleModuleSystem<any>,
	statusPlugin?: StatusPlugin,
	requirementType?: string,
): OptimisticUpdateResult {
	assertSystem("useOptimisticUpdate", system);
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
// useTimeTravel — reactive time-travel store
// ============================================================================

/**
 * Reactive time-travel Svelte store. Returns a Readable that updates
 * when snapshots are taken or navigation occurs.
 *
 * @example
 * ```svelte
 * const tt = useTimeTravel(system);
 * <button disabled={!$tt?.canUndo} on:click={() => $tt?.undo()}>Undo</button>
 * ```
 */
export function useTimeTravel(
	// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
	system: SingleModuleSystem<any>,
): Readable<TimeTravelState | null> {
	assertSystem("useTimeTravel", system);
	return readable<TimeTravelState | null>(buildTimeTravelState(system), (set) => {
		return system.onTimeTravelChange(() => set(buildTimeTravelState(system)));
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
	} as any) as unknown as SingleModuleSystem<M>;

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
		: readable(pickFacts(system, factKeys ?? []) as InferFacts<M>, (set) => {
			if (!factKeys || factKeys.length === 0) return () => {};
			return system.facts.$store.subscribe(factKeys, () => {
				set(pickFacts(system, factKeys) as InferFacts<M>);
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

// ============================================================================
// Typed Hooks Factory
// ============================================================================

export function createTypedHooks<M extends ModuleSchema>(): {
	useFact: <K extends keyof InferFacts<M> & string>(
		system: SingleModuleSystem<M>,
		factKey: K,
	) => Readable<InferFacts<M>[K] | undefined>;
	useDerived: <K extends keyof InferDerivations<M> & string>(
		system: SingleModuleSystem<M>,
		derivationId: K,
	) => Readable<InferDerivations<M>[K]>;
	useDispatch: (system: SingleModuleSystem<M>) => (event: InferEvents<M>) => void;
	useEvents: (system: SingleModuleSystem<M>) => SingleModuleSystem<M>["events"];
	useWatch: <K extends string>(
		system: SingleModuleSystem<M>,
		key: K,
		callback: (newValue: unknown, previousValue: unknown) => void,
	) => void;
} {
	return {
		useFact: <K extends keyof InferFacts<M> & string>(system: SingleModuleSystem<M>, factKey: K) =>
			// biome-ignore lint/suspicious/noExplicitAny: Cast for overload compatibility
			useFact(system as SingleModuleSystem<any>, factKey) as Readable<InferFacts<M>[K] | undefined>,
		useDerived: <K extends keyof InferDerivations<M> & string>(system: SingleModuleSystem<M>, derivationId: K) =>
			// biome-ignore lint/suspicious/noExplicitAny: Cast for overload compatibility
			useDerived(system as SingleModuleSystem<any>, derivationId) as Readable<InferDerivations<M>[K]>,
		useDispatch: (system: SingleModuleSystem<M>) => {
			return (event: InferEvents<M>) => {
				system.dispatch(event);
			};
		},
		useEvents: (system: SingleModuleSystem<M>) => useEvents<M>(system),
		useWatch: <K extends string>(
			system: SingleModuleSystem<M>,
			key: K,
			callback: (newValue: unknown, previousValue: unknown) => void,
		) =>
			// biome-ignore lint/suspicious/noExplicitAny: Cast for overload compatibility
			useWatch(system as SingleModuleSystem<any>, key, callback),
	};
}
