/**
 * Solid Adapter - Consolidated SolidJS primitives for Directive
 *
 * 16 active exports: useFact, useDerived, useDispatch, useSelector,
 * useWatch, useInspect, useRequirementStatus, useEvents, useExplain,
 * useConstraintStatus, useOptimisticUpdate, useDirective, useTimeTravel,
 * createTypedHooks, useSuspenseRequirement, shallowEqual
 *
 * Signal factories: createDerivedSignal, createFactSignal
 */

import type {
  DebugConfig,
  ErrorBoundaryConfig,
  InferDerivations,
  InferEvents,
  InferFacts,
  InferSelectorState,
  ModuleDef,
  ModuleSchema,
  ModulesMap,
  NamespacedSystem,
  Plugin,
  SingleModuleSystem,
  SystemSnapshot,
} from "@directive-run/core";
import {
  createRequirementStatusPlugin,
  createSystem,
} from "@directive-run/core";
import type { RequirementTypeStatus } from "@directive-run/core";
import {
  type ConstraintInfo,
  type InspectState,
  assertSystem,
  buildTimeTravelState,
  computeInspectState,
  createThrottle,
  defaultEquality,
  depsChanged,
  pickFacts,
  runTrackedSelector,
  shallowEqual,
} from "@directive-run/core/adapter-utils";
import { type Accessor, createSignal, onCleanup } from "solid-js";

// Re-export for convenience
export type { RequirementTypeStatus, InspectState, ConstraintInfo };
export { shallowEqual };

/** Type for the requirement status plugin return value */
export type StatusPlugin = ReturnType<typeof createRequirementStatusPlugin>;

// ============================================================================
// useFact — single key or multi key
// ============================================================================

/** Single key overload */
export function useFact<
  S extends ModuleSchema,
  K extends keyof InferFacts<S> & string,
>(
  system: SingleModuleSystem<S>,
  factKey: K,
): Accessor<InferFacts<S>[K] | undefined>;
/** Multi-key overload */
export function useFact<
  S extends ModuleSchema,
  K extends keyof InferFacts<S> & string,
>(
  system: SingleModuleSystem<S>,
  factKeys: K[],
): Accessor<Pick<InferFacts<S>, K>>;
/** Implementation */
export function useFact(
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature
  system: SingleModuleSystem<any>,
  keyOrKeys: string | string[],
): Accessor<unknown> {
  assertSystem("useFact", system);
  if (
    process.env.NODE_ENV !== "production" &&
    typeof keyOrKeys === "function"
  ) {
    console.error(
      "[Directive] useFact() received a function. Did you mean useSelector()? " +
        "useFact() takes a string key or array of keys, not a selector function.",
    );
  }

  // Multi-key path
  if (Array.isArray(keyOrKeys)) {
    return _useFactMulti(system, keyOrKeys);
  }

  // Single key path
  return _useFactSingle(system, keyOrKeys);
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useFactSingle(
  system: SingleModuleSystem<any>,
  factKey: string,
): Accessor<unknown> {
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
function _useFactMulti(
  system: SingleModuleSystem<any>,
  factKeys: string[],
): Accessor<Record<string, unknown>> {
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
export function useDerived<
  S extends ModuleSchema,
  K extends keyof InferDerivations<S> & string,
>(
  system: SingleModuleSystem<S>,
  derivationId: K,
): Accessor<InferDerivations<S>[K]>;
/** Multi-key overload */
export function useDerived<
  S extends ModuleSchema,
  K extends keyof InferDerivations<S> & string,
>(
  system: SingleModuleSystem<S>,
  derivationIds: K[],
): Accessor<Pick<InferDerivations<S>, K>>;
/** Implementation */
export function useDerived(
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature
  system: SingleModuleSystem<any>,
  idOrIds: string | string[],
): Accessor<unknown> {
  assertSystem("useDerived", system);
  if (process.env.NODE_ENV !== "production" && typeof idOrIds === "function") {
    console.error(
      "[Directive] useDerived() received a function. Did you mean useSelector()? " +
        "useDerived() takes a string key or array of keys, not a selector function.",
    );
  }

  // Multi-key path
  if (Array.isArray(idOrIds)) {
    return _useDerivedMulti(system, idOrIds);
  }

  // Single key path
  return _useDerivedSingle(system, idOrIds);
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useDerivedSingle(
  system: SingleModuleSystem<any>,
  derivationId: string,
): Accessor<unknown> {
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
function _useDerivedMulti(
  system: SingleModuleSystem<any>,
  derivationIds: string[],
): Accessor<Record<string, unknown>> {
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
// useSelector — auto-tracking selector over facts and derivations
// ============================================================================

/**
 * Auto-tracking selector over facts and derivations.
 * Uses `withTracking()` to detect which facts the selector accesses,
 * then subscribes only to those keys.
 */
export function useSelector<S extends ModuleSchema, R>(
  system: SingleModuleSystem<S>,
  selector: (state: InferSelectorState<S>) => R,
  equalityFn?: (a: R, b: R) => boolean,
): Accessor<R>;
export function useSelector(
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature
  system: SingleModuleSystem<any>,
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature
  selector: (state: any) => unknown,
  equalityFn: (a: unknown, b: unknown) => boolean = defaultEquality,
): Accessor<unknown> {
  assertSystem("useSelector", system);
  const deriveKeySet = new Set(Object.keys(system.derive ?? {}));

  // Build a tracking-aware state proxy that exposes both facts and derivations
  const runWithTracking = () =>
    runTrackedSelector(system, deriveKeySet, selector);

  const initial = runWithTracking();
  let trackedFactKeys = initial.factKeys;
  let trackedDeriveKeys = initial.deriveKeys;
  const [selected, setSelected] = createSignal(initial.value);

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
      if (
        depsChanged(
          trackedFactKeys,
          result.factKeys,
          trackedDeriveKeys,
          result.deriveKeys,
        )
      ) {
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
export function useWatch<
  S extends ModuleSchema,
  K extends keyof InferDerivations<S> & string,
>(
  system: SingleModuleSystem<S>,
  key: K,
  callback: (
    newValue: InferDerivations<S>[K],
    previousValue: InferDerivations<S>[K] | undefined,
  ) => void,
): void;
/** Watch a fact key with auto-detection. */
export function useWatch<
  S extends ModuleSchema,
  K extends keyof InferFacts<S> & string,
>(
  system: SingleModuleSystem<S>,
  key: K,
  callback: (
    newValue: InferFacts<S>[K] | undefined,
    previousValue: InferFacts<S>[K] | undefined,
  ) => void,
): void;
/** Implementation */
export function useWatch(
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature
  system: SingleModuleSystem<any>,
  key: string,
  callback: (newValue: unknown, prevValue: unknown) => void,
): void {
  assertSystem("useWatch", system);

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
export function useInspect(
  // biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
  system: SingleModuleSystem<any>,
  options?: UseInspectOptions,
): Accessor<InspectState> {
  assertSystem("useInspect", system);
  const [state, setState] = createSignal<InspectState>(
    computeInspectState(system),
  );

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
export function useRequirementStatus(
  statusPlugin: StatusPlugin,
  type: string,
): Accessor<RequirementTypeStatus>;
/** Multi-type overload */
export function useRequirementStatus(
  statusPlugin: StatusPlugin,
  types: string[],
): Accessor<Record<string, RequirementTypeStatus>>;
/** Implementation */
export function useRequirementStatus(
  statusPlugin: StatusPlugin,
  typeOrTypes: string | string[],
):
  | Accessor<RequirementTypeStatus>
  | Accessor<Record<string, RequirementTypeStatus>> {
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

  const [status, setStatus] = createSignal<RequirementTypeStatus>(
    statusPlugin.getStatus(typeOrTypes),
  );
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
export function useExplain(
  // biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
  system: SingleModuleSystem<any>,
  requirementId: string,
): Accessor<string | null> {
  assertSystem("useExplain", system);
  const [explanation, setExplanation] = createSignal<string | null>(
    system.explain(requirementId),
  );

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

/** Get all constraints */
export function useConstraintStatus(
  system: SingleModuleSystem<any>,
): Accessor<ConstraintInfo[]>;
/** Get a single constraint by ID */
export function useConstraintStatus(
  system: SingleModuleSystem<any>,
  constraintId: string,
): Accessor<ConstraintInfo | null>;
/** Implementation */
export function useConstraintStatus(
  // biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
  system: SingleModuleSystem<any>,
  constraintId?: string,
): Accessor<ConstraintInfo[] | ConstraintInfo | null> {
  assertSystem("useConstraintStatus", system);
  const getVal = () => {
    const inspection = system.inspect();
    if (!constraintId) return inspection.constraints;
    return (
      inspection.constraints.find(
        (c: ConstraintInfo) => c.id === constraintId,
      ) ?? null
    );
  };

  const [state, setState] = createSignal<
    ConstraintInfo[] | ConstraintInfo | null
  >(getVal());

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
  // biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
  system: SingleModuleSystem<any>,
  statusPlugin?: StatusPlugin,
  requirementType?: string,
): OptimisticUpdateResult {
  assertSystem("useOptimisticUpdate", system);
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
export function useSuspenseRequirement(
  statusPlugin: StatusPlugin,
  type: string,
): Accessor<RequirementTypeStatus>;
/**
 * Multi-type: throws a promise while any of the requirements are pending.
 */
export function useSuspenseRequirement(
  statusPlugin: StatusPlugin,
  types: string[],
): Accessor<Record<string, RequirementTypeStatus>>;
/** Implementation */
export function useSuspenseRequirement(
  statusPlugin: StatusPlugin,
  typeOrTypes: string | string[],
):
  | Accessor<RequirementTypeStatus>
  | Accessor<Record<string, RequirementTypeStatus>> {
  const types = Array.isArray(typeOrTypes) ? typeOrTypes : [typeOrTypes];

  // Check if any are still loading — if so, throw a promise
  const anyLoading = () =>
    types.some((t) => statusPlugin.getStatus(t).isLoading);

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
    return useRequirementStatus(statusPlugin, typeOrTypes) as Accessor<
      Record<string, RequirementTypeStatus>
    >;
  }
  return useRequirementStatus(
    statusPlugin,
    typeOrTypes,
  ) as Accessor<RequirementTypeStatus>;
}

// ============================================================================
// useTimeTravel — reactive time-travel signal
// ============================================================================

/**
 * Reactive time-travel signal. Returns an Accessor that updates
 * when snapshots are taken or navigation occurs.
 *
 * @example
 * ```tsx
 * const tt = useTimeTravel(system);
 * <button disabled={!tt()?.canUndo} onClick={() => tt()?.undo()}>Undo</button>
 * ```
 */
export function useTimeTravel(
  // biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
  system: SingleModuleSystem<any>,
): Accessor<ReturnType<typeof buildTimeTravelState>> {
  assertSystem("useTimeTravel", system);
  const [state, setState] = createSignal<
    ReturnType<typeof buildTimeTravelState>
  >(buildTimeTravelState(system));
  const unsub = system.onTimeTravelChange(() =>
    setState(buildTimeTravelState(system)),
  );
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
  } as any) as unknown as SingleModuleSystem<M>;

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
      : (pickFacts(system, factKeys ?? []) as InferFacts<M>),
  );
  const unsubFacts = subscribeAll
    ? system.facts.$store.subscribeAll(() => {
        setFactsState(() => system.facts.$store.toObject() as InferFacts<M>);
      })
    : factKeys && factKeys.length > 0
      ? system.facts.$store.subscribe(factKeys, () => {
          setFactsState(() => pickFacts(system, factKeys) as InferFacts<M>);
        })
      : null;

  // Subscribe to derivations
  const allDerivationKeys = subscribeAll
    ? Object.keys(system.derive ?? {})
    : (derivedKeys ?? []);
  const getDerived = (): InferDerivations<M> => {
    const result: Record<string, unknown> = {};
    for (const key of allDerivationKeys) {
      result[key] = system.read(key);
    }
    return result as InferDerivations<M>;
  };
  const [derivedState, setDerivedState] = createSignal(getDerived());
  const unsubDerived =
    allDerivationKeys.length > 0
      ? system.subscribe(allDerivationKeys, () => {
          setDerivedState(getDerived);
        })
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

// ============================================================================
// Signal Factories (for use outside components)
// ============================================================================

/**
 * Create a derivation signal outside of a component.
 */
export function createDerivedSignal<T>(
  // biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
  system: SingleModuleSystem<any>,
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
  // biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
  system: SingleModuleSystem<any>,
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
  useFact: <K extends keyof InferFacts<M> & string>(
    system: SingleModuleSystem<M>,
    factKey: K,
  ) => Accessor<InferFacts<M>[K] | undefined>;
  useDerived: <K extends keyof InferDerivations<M> & string>(
    system: SingleModuleSystem<M>,
    derivationId: K,
  ) => Accessor<InferDerivations<M>[K]>;
  useDispatch: (
    system: SingleModuleSystem<M>,
  ) => (event: InferEvents<M>) => void;
  useEvents: (system: SingleModuleSystem<M>) => SingleModuleSystem<M>["events"];
  useWatch: <K extends string>(
    system: SingleModuleSystem<M>,
    key: K,
    callback: (newValue: unknown, previousValue: unknown) => void,
  ) => void;
} {
  return {
    useFact: <K extends keyof InferFacts<M> & string>(
      system: SingleModuleSystem<M>,
      factKey: K,
    ) =>
      // biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
      useFact(system as SingleModuleSystem<any>, factKey as string) as Accessor<
        InferFacts<M>[K] | undefined
      >,
    useDerived: <K extends keyof InferDerivations<M> & string>(
      system: SingleModuleSystem<M>,
      derivationId: K,
    ) =>
      // biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
      useDerived(
        system as SingleModuleSystem<any>,
        derivationId as string,
      ) as Accessor<InferDerivations<M>[K]>,
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
      // biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
      useWatch(system as SingleModuleSystem<any>, key, callback),
  };
}

// ============================================================================
// useNamespacedSelector — select from a NamespacedSystem
// ============================================================================

/**
 * SolidJS accessor that selects from a NamespacedSystem.
 * Subscribes to specified keys and provides reactive updates.
 *
 * @param system - The namespaced system
 * @param keys - Namespaced keys to subscribe to (e.g., ["auth.token", "data.count"])
 * @param selector - Function that reads from system.facts / system.derive
 *
 * @example
 * ```tsx
 * const token = useNamespacedSelector(system, ["auth.token"], (s) => s.facts.auth.token);
 * ```
 */
export function useNamespacedSelector<Modules extends ModulesMap, R>(
  system: NamespacedSystem<Modules>,
  keys: string[],
  selector: (system: NamespacedSystem<Modules>) => R,
): Accessor<R> {
  const [value, setValue] = createSignal<R>(selector(system));
  const unsubscribe = system.subscribe(keys, () => {
    setValue(() => selector(system));
  });
  onCleanup(unsubscribe);

  return value as Accessor<R>;
}
