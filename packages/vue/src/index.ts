/**
 * Vue Adapter - Vue 3 composables for Directive
 *
 * Exports: useFact, useDerived, useDispatch, useSelector,
 * useWatch, useInspect, useRequirementStatus, useSuspenseRequirement,
 * useEvents, useExplain, useConstraintStatus, useOptimisticUpdate,
 * useDirective, useHistory, createTypedHooks, shallowEqual
 */

import type {
  TraceOption,
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
  buildHistoryState,
  computeInspectState,
  createThrottle,
  defaultEquality,
  depsChanged,
  pickFacts,
  runTrackedSelector,
  shallowEqual,
} from "@directive-run/core/adapter-utils";
import {
  type ComputedRef,
  type Ref,
  type ShallowRef,
  computed,
  onScopeDispose,
  ref,
  shallowRef,
} from "vue";

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
>(system: SingleModuleSystem<S>, factKey: K): Ref<InferFacts<S>[K] | undefined>;
/** Multi-key overload */
export function useFact<
  S extends ModuleSchema,
  K extends keyof InferFacts<S> & string,
>(
  system: SingleModuleSystem<S>,
  factKeys: K[],
): ShallowRef<Pick<InferFacts<S>, K>>;
/** Implementation */
export function useFact(
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature
  system: SingleModuleSystem<any>,
  keyOrKeys: string | string[],
): Ref<unknown> | ShallowRef<unknown> {
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

  // Multi-key path: useFact(system, [keys])
  if (Array.isArray(keyOrKeys)) {
    return _useFactMulti(system, keyOrKeys);
  }

  // Single key path: useFact(system, key)
  return _useFactSingle(system, keyOrKeys);
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useFactSingle(
  system: SingleModuleSystem<any>,
  factKey: string,
): Ref<unknown> {
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
  onScopeDispose(unsubscribe);
  return value;
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useFactMulti(
  system: SingleModuleSystem<any>,
  factKeys: string[],
): ShallowRef<Record<string, unknown>> {
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
  onScopeDispose(unsubscribe);
  return state;
}

// ============================================================================
// useDerived — single key or multi key
// ============================================================================

/** Single key overload */
export function useDerived<
  S extends ModuleSchema,
  K extends keyof InferDerivations<S> & string,
>(system: SingleModuleSystem<S>, derivationId: K): Ref<InferDerivations<S>[K]>;
/** Multi-key overload */
export function useDerived<
  S extends ModuleSchema,
  K extends keyof InferDerivations<S> & string,
>(
  system: SingleModuleSystem<S>,
  derivationIds: K[],
): ShallowRef<Pick<InferDerivations<S>, K>>;
/** Implementation */
export function useDerived(
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature
  system: SingleModuleSystem<any>,
  idOrIds: string | string[],
): Ref<unknown> | ShallowRef<unknown> {
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
): Ref<unknown> {
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
  onScopeDispose(unsubscribe);
  return value;
}

// biome-ignore lint/suspicious/noExplicitAny: Internal
function _useDerivedMulti(
  system: SingleModuleSystem<any>,
  derivationIds: string[],
): ShallowRef<Record<string, unknown>> {
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
  onScopeDispose(unsubscribe);
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
): Ref<R>;
export function useSelector(
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature
  system: SingleModuleSystem<any>,
  selector: (state: Record<string, unknown>) => unknown,
  equalityFn: (a: unknown, b: unknown) => boolean = defaultEquality,
): Ref<unknown> {
  assertSystem("useSelector", system);
  const deriveKeySet = new Set(Object.keys(system.derive ?? {}));

  const runWithTracking = () =>
    runTrackedSelector(system, deriveKeySet, selector);

  const initial = runWithTracking();
  let trackedFactKeys = initial.factKeys;
  let trackedDeriveKeys = initial.deriveKeys;
  const selected = ref(initial.value);

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

  onScopeDispose(() => {
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
  onScopeDispose(unsubscribe);
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
export function useInspect(
  // biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
  system: SingleModuleSystem<any>,
  options?: UseInspectOptions,
): ShallowRef<InspectState> {
  assertSystem("useInspect", system);
  const state = shallowRef<InspectState>(computeInspectState(system));

  const update = () => {
    state.value = computeInspectState(system);
  };

  if (options?.throttleMs && options.throttleMs > 0) {
    const { throttled, cleanup } = createThrottle(update, options.throttleMs);
    const unsubFacts = system.facts.$store.subscribeAll(throttled);
    const unsubSettled = system.onSettledChange(throttled);
    onScopeDispose(() => {
      cleanup();
      unsubFacts();
      unsubSettled();
    });
  } else {
    const unsubFacts = system.facts.$store.subscribeAll(update);
    const unsubSettled = system.onSettledChange(update);
    onScopeDispose(() => {
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
): ShallowRef<RequirementTypeStatus>;
/** Multi-type overload */
export function useRequirementStatus(
  statusPlugin: StatusPlugin,
  types: string[],
): ShallowRef<Record<string, RequirementTypeStatus>>;
/** Implementation */
export function useRequirementStatus(
  statusPlugin: StatusPlugin,
  typeOrTypes: string | string[],
):
  | ShallowRef<RequirementTypeStatus>
  | ShallowRef<Record<string, RequirementTypeStatus>> {
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
    onScopeDispose(unsubscribe);
    return state;
  }

  const status = shallowRef<RequirementTypeStatus>(
    statusPlugin.getStatus(typeOrTypes),
  );
  const unsubscribe = statusPlugin.subscribe(() => {
    status.value = statusPlugin.getStatus(typeOrTypes);
  });
  onScopeDispose(unsubscribe);
  return status;
}

// ============================================================================
// useSuspenseRequirement — async setup() Suspense integration
// ============================================================================

/**
 * Returns a promise that resolves when a requirement type settles.
 * Designed for Vue's async `setup()` with `<Suspense>`.
 *
 * - If the requirement is loading, the returned promise suspends the component.
 * - If the requirement has an error, the promise rejects with that error.
 * - If the requirement is already settled, resolves immediately.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useSuspenseRequirement } from '@directive-run/vue';
 *
 * // In async setup(), this suspends until FETCH_USER settles
 * const status = await useSuspenseRequirement(statusPlugin, "FETCH_USER");
 * </script>
 *
 * <template>
 *   <div>Resolved: {{ status.resolvedCount }}</div>
 * </template>
 * ```
 */

/** Single type overload */
export function useSuspenseRequirement(
  statusPlugin: StatusPlugin,
  type: string,
): Promise<ShallowRef<RequirementTypeStatus>>;

/** Multi-type overload */
export function useSuspenseRequirement(
  statusPlugin: StatusPlugin,
  types: string[],
): Promise<
  ShallowRef<Record<string, RequirementTypeStatus>>
>;

/** Implementation */
export function useSuspenseRequirement(
  statusPlugin: StatusPlugin,
  typeOrTypes: string | string[],
): Promise<
  | ShallowRef<RequirementTypeStatus>
  | ShallowRef<Record<string, RequirementTypeStatus>>
> {
  if (Array.isArray(typeOrTypes)) {
    return _useSuspenseRequirementMulti(statusPlugin, typeOrTypes);
  }

  return _useSuspenseRequirementSingle(statusPlugin, typeOrTypes);
}

async function _useSuspenseRequirementSingle(
  statusPlugin: StatusPlugin,
  type: string,
): Promise<ShallowRef<RequirementTypeStatus>> {
  const initialStatus = statusPlugin.getStatus(type);

  if (initialStatus.hasError && initialStatus.lastError) {
    throw initialStatus.lastError;
  }

  // If loading, wait for it to settle
  if (initialStatus.isLoading) {
    await new Promise<void>((resolve, reject) => {
      const unsubscribe = statusPlugin.subscribe(() => {
        const current = statusPlugin.getStatus(type);
        if (!current.isLoading) {
          unsubscribe();
          if (current.hasError && current.lastError) {
            reject(current.lastError);
          } else {
            resolve();
          }
        }
      });
      onScopeDispose(unsubscribe);
    });
  }

  // Now settled — return a reactive ref that continues tracking
  const status = shallowRef<RequirementTypeStatus>(
    statusPlugin.getStatus(type),
  );
  const unsubscribe = statusPlugin.subscribe(() => {
    status.value = statusPlugin.getStatus(type);
  });
  onScopeDispose(unsubscribe);

  return status;
}

async function _useSuspenseRequirementMulti(
  statusPlugin: StatusPlugin,
  types: string[],
): Promise<ShallowRef<Record<string, RequirementTypeStatus>>> {
  // Check for immediate errors
  for (const type of types) {
    const s = statusPlugin.getStatus(type);
    if (s.hasError && s.lastError) {
      throw s.lastError;
    }
  }

  // If any are loading, wait for all to settle
  const anyLoading = types.some(
    (t) => statusPlugin.getStatus(t).isLoading,
  );
  if (anyLoading) {
    await new Promise<void>((resolve, reject) => {
      const unsubscribe = statusPlugin.subscribe(() => {
        const allDone = types.every(
          (t) => !statusPlugin.getStatus(t).isLoading,
        );
        if (allDone) {
          unsubscribe();
          // Check for errors after settling
          for (const type of types) {
            const s = statusPlugin.getStatus(type);
            if (s.hasError && s.lastError) {
              reject(s.lastError);

              return;
            }
          }
          resolve();
        }
      });
      onScopeDispose(unsubscribe);
    });
  }

  // Now settled — return a reactive ref that continues tracking
  const getValues = (): Record<string, RequirementTypeStatus> => {
    const result: Record<string, RequirementTypeStatus> = {};
    for (const type of types) {
      result[type] = statusPlugin.getStatus(type);
    }

    return result;
  };
  const status = shallowRef(getValues());
  const unsubscribe = statusPlugin.subscribe(() => {
    status.value = getValues();
  });
  onScopeDispose(unsubscribe);

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
): Ref<string | null> {
  assertSystem("useExplain", system);
  const explanation = ref<string | null>(system.explain(requirementId)) as Ref<
    string | null
  >;

  const update = () => {
    explanation.value = system.explain(requirementId);
  };

  const unsubFacts = system.facts.$store.subscribeAll(update);
  const unsubSettled = system.onSettledChange(update);
  onScopeDispose(() => {
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
): ComputedRef<ConstraintInfo[]>;
/** Get a single constraint by ID */
export function useConstraintStatus(
  system: SingleModuleSystem<any>,
  constraintId: string,
): ComputedRef<ConstraintInfo | null>;
/** Implementation */
export function useConstraintStatus(
  // biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
  system: SingleModuleSystem<any>,
  constraintId?: string,
): ComputedRef<ConstraintInfo[] | ConstraintInfo | null> {
  assertSystem("useConstraintStatus", system);
  const inspectState = useInspect(system);

  return computed(() => {
    // Track reactivity via inspectState, but use full inspect() for constraint list
    void inspectState.value;
    const fullInspection = system.inspect();
    if (!constraintId) return fullInspection.constraints;
    return (
      fullInspection.constraints.find((c) => c.id === constraintId) ?? null
    );
  });
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
  // biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
  system: SingleModuleSystem<any>,
  statusPlugin?: StatusPlugin,
  requirementType?: string,
): OptimisticUpdateResult {
  assertSystem("useOptimisticUpdate", system);
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

  onScopeDispose(() => {
    unsubscribe?.();
  });

  return { mutate, isPending, error, rollback };
}

// ============================================================================
// useHistory — reactive history state
// ============================================================================

/**
 * Reactive history composable. Returns a ShallowRef that updates
 * when snapshots are taken or navigation occurs.
 *
 * @example
 * ```vue
 * const history = useHistory(system);
 * <button :disabled="!history.value?.canGoBack" @click="history.value?.goBack()">Undo</button>
 * ```
 */
export function useHistory(
  // biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
  system: SingleModuleSystem<any>,
): ShallowRef<ReturnType<typeof buildHistoryState>> {
  assertSystem("useHistory", system);
  const state = shallowRef<ReturnType<typeof buildHistoryState>>(
    buildHistoryState(system),
  );
  const unsub = system.onHistoryChange(() => {
    state.value = buildHistoryState(system);
  });
  onScopeDispose(unsub);
  return state;
}

// ============================================================================
// Scoped System Composable
// ============================================================================

/** Configuration for useDirective */
interface UseDirectiveConfig {
  // biome-ignore lint/suspicious/noExplicitAny: Plugin types vary
  plugins?: Plugin<any>[];
  trace?: TraceOption;
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
    trace: config?.trace,
    errorBoundary: config?.errorBoundary,
    tickMs: config?.tickMs,
    zeroConfig: config?.zeroConfig,
    initialFacts: config?.initialFacts,
  } as any) as unknown as SingleModuleSystem<M>;

  // SSR guard: initialize facts for SSR rendering, start reconciliation only in the browser
  if (typeof window !== "undefined") {
    system.start();
  } else {
    system.initialize();
  }

  onScopeDispose(() => {
    system.destroy();
  });

  const factKeys = config?.facts;
  const derivedKeys = config?.derived;
  const subscribeAll = !factKeys && !derivedKeys;

  // Subscribe to facts
  const factsState = shallowRef(
    subscribeAll
      ? (system.facts.$store.toObject() as InferFacts<M>)
      : pickFacts(system, factKeys ?? []),
  );
  const unsubFacts = subscribeAll
    ? system.facts.$store.subscribeAll(() => {
        factsState.value = system.facts.$store.toObject() as InferFacts<M>;
      })
    : factKeys && factKeys.length > 0
      ? system.facts.$store.subscribe(factKeys, () => {
          factsState.value = pickFacts(system, factKeys) as InferFacts<M>;
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
  const derivedState = shallowRef(getDerived());
  const unsubDerived =
    allDerivationKeys.length > 0
      ? system.subscribe(allDerivationKeys, () => {
          derivedState.value = getDerived();
        })
      : null;

  onScopeDispose(() => {
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

// ============================================================================
// Typed Hooks Factory
// ============================================================================

export function createTypedHooks<M extends ModuleSchema>(): {
  useFact: <K extends keyof InferFacts<M> & string>(
    system: SingleModuleSystem<M>,
    factKey: K,
  ) => Ref<InferFacts<M>[K] | undefined>;
  useDerived: <K extends keyof InferDerivations<M> & string>(
    system: SingleModuleSystem<M>,
    derivationId: K,
  ) => Ref<InferDerivations<M>[K]>;
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
      // biome-ignore lint/suspicious/noExplicitAny: Type narrowing for internal call
      useFact(system as SingleModuleSystem<any>, factKey) as Ref<
        InferFacts<M>[K] | undefined
      >,
    useDerived: <K extends keyof InferDerivations<M> & string>(
      system: SingleModuleSystem<M>,
      derivationId: K,
    ) =>
      // biome-ignore lint/suspicious/noExplicitAny: Type narrowing for internal call
      useDerived(system as SingleModuleSystem<any>, derivationId) as Ref<
        InferDerivations<M>[K]
      >,
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
      // biome-ignore lint/suspicious/noExplicitAny: Type narrowing for internal call
      useWatch(system as SingleModuleSystem<any>, key, callback),
  };
}

// ============================================================================
// useNamespacedSelector — select from a NamespacedSystem
// ============================================================================

/**
 * Reactive composable to select from a NamespacedSystem.
 * Subscribes to specified keys and returns a Vue ref.
 *
 * @param system - The namespaced system
 * @param keys - Namespaced keys to subscribe to (e.g., ["auth.token", "data.count"])
 * @param selector - Function that reads from system.facts / system.derive
 *
 * @example
 * ```vue
 * const system = useDirectiveRef({ modules: { auth, data } });
 * const token = useNamespacedSelector(system, ["auth.token"], (s) => s.facts.auth.token);
 * ```
 */
export function useNamespacedSelector<Modules extends ModulesMap, R>(
  system: NamespacedSystem<Modules>,
  keys: string[],
  selector: (system: NamespacedSystem<Modules>) => R,
): Ref<R> {
  const value = ref(selector(system)) as Ref<R>;
  const unsubscribe = system.subscribe(keys, () => {
    value.value = selector(system) as R;
  });
  onScopeDispose(unsubscribe);

  return value;
}

// ============================================================================
// useQuerySystem — Stable query system with lifecycle management
// ============================================================================

/**
 * Vue composable to create and manage a query system with proper lifecycle.
 *
 * Accepts a factory function that creates the system.
 * Handles cleanup on scope disposal.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useQuerySystem, useDerived } from "@directive-run/vue";
 * import { createQuerySystem } from "@directive-run/query";
 *
 * const app = useQuerySystem(() =>
 *   createQuerySystem({
 *     facts: { userId: "" },
 *     queries: { user: { key: ..., fetcher: ... } },
 *     autoStart: false,
 *   })
 * );
 *
 * const user = useDerived(app, "user");
 * </script>
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: Factory return type varies
export function useQuerySystem<T extends { start: () => void; destroy: () => void; isRunning?: boolean; [key: string]: any }>(
  factory: () => T,
): T {
  const system = factory();

  // Start if not already running
  if (typeof window !== "undefined" && !system.isRunning) {
    system.start();
  }

  onScopeDispose(() => {
    system.destroy();
  });

  return system;
}
