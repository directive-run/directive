/**
 * React Adapter - Consolidated hooks for React integration
 *
 * 19 public exports: useFact, useDerived, useDispatch, useDirective,
 * useDirectiveRef, useSelector, useWatch, useInspect, useRequirementStatus,
 * useSuspenseRequirement, useEvents, useExplain, useConstraintStatus,
 * useOptimisticUpdate, DirectiveHydrator, useHydratedSystem,
 * useHistory, createTypedHooks, shallowEqual
 *
 * @example
 * ```tsx
 * import { useFact, useDerived, useEvents } from '@directive-run/react';
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

import type {
  TraceOption,
  DistributableSnapshot,
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
  HistoryOption,
  HistoryState,
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
  runTrackedSelector,
  shallowEqual,
} from "@directive-run/core/adapter-utils";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

// Re-export for convenience
export type { RequirementTypeStatus, InspectState, ConstraintInfo };
export { shallowEqual };

/** Type for the requirement status plugin return value */
export type StatusPlugin = ReturnType<typeof createRequirementStatusPlugin>;

// ============================================================================
// Internal Helpers
// ============================================================================

/** Sentinel value for uninitialized selector cache */
const UNINITIALIZED = Symbol("directive.uninitialized");

// ============================================================================
// useFact — single key or multi key
// ============================================================================

/** Single key overload */
export function useFact<
  S extends ModuleSchema,
  K extends keyof InferFacts<S> & string,
>(system: SingleModuleSystem<S>, factKey: K): InferFacts<S>[K] | undefined;

/** Multi-key overload */
export function useFact<
  S extends ModuleSchema,
  K extends keyof InferFacts<S> & string,
>(system: SingleModuleSystem<S>, factKeys: K[]): Pick<InferFacts<S>, K>;

/** Implementation */
export function useFact(
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature
  system: SingleModuleSystem<any>,
  keyOrKeys: string | string[],
): unknown {
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
    return system.facts.$store.get(factKey as never);
  }, [system, factKey]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function _useFacts(
  // biome-ignore lint/suspicious/noExplicitAny: Internal
  system: SingleModuleSystem<any>,
  factKeys: string[],
): Record<string, unknown> {
  const cachedValue = useRef<Record<string, unknown> | typeof UNINITIALIZED>(
    UNINITIALIZED,
  );

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
      result[key] = system.facts.$store.get(key as never);
    }

    if (cachedValue.current !== UNINITIALIZED) {
      let same = true;
      for (const key of factKeys) {
        if (
          !Object.is(
            (cachedValue.current as Record<string, unknown>)[key],
            result[key],
          )
        ) {
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
export function useDerived<
  S extends ModuleSchema,
  K extends keyof InferDerivations<S> & string,
>(system: SingleModuleSystem<S>, derivationId: K): InferDerivations<S>[K];

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
  assertSystem("useDerived", system);
  if (
    process.env.NODE_ENV !== "production" &&
    typeof keyOrKeys === "function"
  ) {
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
  const cachedValue = useRef<Record<string, unknown> | typeof UNINITIALIZED>(
    UNINITIALIZED,
  );

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
        if (
          !Object.is(
            (cachedValue.current as Record<string, unknown>)[id],
            result[id],
          )
        ) {
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
// useSelector — Zustand-style selector over facts and derivations
// ============================================================================

/**
 * Auto-tracking selector over facts and derivations (Zustand-style).
 * Uses `withTracking()` to detect which facts the selector accesses,
 * then subscribes only to those keys. Falls back to subscribeAll
 * if no keys are detected.
 *
 * Supports an optional default value as the 3rd parameter, used when
 * the system is null/undefined or the selector returns undefined.
 * When a default value is provided, the system parameter may be
 * null | undefined — the hook returns the default and recomputes
 * when the system becomes available.
 *
 * An optional equality function can be passed as the 4th parameter
 * to customize when the selector result is considered "changed".
 * Defaults to `Object.is`. Use `shallowEqual` (exported from this
 * package) when your selector returns a new object/array each time.
 *
 * @example
 * ```tsx
 * // Basic usage
 * const count = useSelector(system, (s) => s.count);
 *
 * // With default value (allows nullable system)
 * const count = useSelector(system, (s) => s.count, 0);
 *
 * // With default value + custom equality
 * const coords = useSelector(system, (s) => ({ x: s.x, y: s.y }), { x: 0, y: 0 }, shallowEqual);
 * ```
 */

// Non-null system, no default
export function useSelector<S extends ModuleSchema, R>(
  system: SingleModuleSystem<S>,
  selector: (state: InferSelectorState<S>) => R,
): R;

// Non-null system, with default value and optional equality
export function useSelector<S extends ModuleSchema, R>(
  system: SingleModuleSystem<S>,
  selector: (state: InferSelectorState<S>) => R,
  defaultValue: R,
  equalityFn?: (a: R, b: R) => boolean,
): R;

// Nullable system, default REQUIRED
export function useSelector<S extends ModuleSchema, R>(
  system: SingleModuleSystem<S> | null | undefined,
  selector: (state: InferSelectorState<S>) => R,
  defaultValue: R,
  equalityFn?: (a: R, b: R) => boolean,
): R;

// --- Namespaced system overloads ---

// Namespaced system, no default
export function useSelector<Modules extends ModulesMap, R>(
  system: NamespacedSystem<Modules>,
  selector: (state: NamespacedSystem<Modules>) => R,
): R;

// Namespaced system, with default value and optional equality
export function useSelector<Modules extends ModulesMap, R>(
  system: NamespacedSystem<Modules>,
  selector: (state: NamespacedSystem<Modules>) => R,
  defaultValue: R,
  equalityFn?: (a: R, b: R) => boolean,
): R;

// Nullable namespaced system, default REQUIRED
export function useSelector<Modules extends ModulesMap, R>(
  system: NamespacedSystem<Modules> | null | undefined,
  selector: (state: NamespacedSystem<Modules>) => R,
  defaultValue: R,
  equalityFn?: (a: R, b: R) => boolean,
): R;

// --- Generic fallbacks ---

// Generic fallback: non-null system
export function useSelector<R>(
  // biome-ignore lint/suspicious/noExplicitAny: Generic fallback
  system: SingleModuleSystem<any>,
  // biome-ignore lint/suspicious/noExplicitAny: Selector receives dynamic state
  selector: (state: Record<string, any>) => R,
  defaultValue?: R,
  equalityFn?: (a: R, b: R) => boolean,
): R;

// Generic fallback: nullable system
export function useSelector<R>(
  // biome-ignore lint/suspicious/noExplicitAny: Generic fallback
  system: SingleModuleSystem<any> | null | undefined,
  // biome-ignore lint/suspicious/noExplicitAny: Selector receives dynamic state
  selector: (state: Record<string, any>) => R,
  defaultValue: R,
  equalityFn?: (a: R, b: R) => boolean,
): R;

export function useSelector(
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature accepts both system types
  systemArg: SingleModuleSystem<any> | NamespacedSystem<any> | null | undefined,
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature
  selector: (state: any) => unknown,
  defaultValueArg?: unknown,
  equalityFnArg?: (a: unknown, b: unknown) => boolean,
): unknown {
  // Route to namespaced implementation if system is a NamespacedSystem
  // biome-ignore lint/suspicious/noExplicitAny: Runtime type check
  if (systemArg && (systemArg as any)._mode === "namespaced") {
    // biome-ignore lint/suspicious/noExplicitAny: Delegate to namespaced impl
    return _useNamespacedSelectorImpl(
      systemArg as NamespacedSystem<any>,
      selector,
      defaultValueArg,
      equalityFnArg,
    );
  }

  // After the namespaced check, system is a SingleModuleSystem
  const system = systemArg as SingleModuleSystem<any> | null | undefined;
  let defaultValue: unknown;
  let hasDefault = false;
  const equalityFn: (a: unknown, b: unknown) => boolean =
    equalityFnArg ?? defaultEquality;

  if (defaultValueArg !== undefined) {
    defaultValue = defaultValueArg;
    hasDefault = true;
  }

  // Dev-mode warning: null system without a default value
  if (process.env.NODE_ENV !== "production") {
    if (!system && !hasDefault) {
      console.error(
        "[Directive] useSelector() received a null/undefined system without a default value. " +
          "Provide a default value as the 3rd parameter: useSelector(system, selector, defaultValue)",
      );
    }
  }

  // Store selector/eq/default in refs to avoid resubscription churn
  const selectorRef = useRef(selector);
  const eqRef = useRef(equalityFn);
  const defaultValueRef = useRef(defaultValue);
  // Track selector identity changes to force resubscription when deps may shift
  const prevSelectorRef = useRef(selector);
  const selectorVersionRef = useRef(0);
  if (prevSelectorRef.current !== selector) {
    prevSelectorRef.current = selector;
    selectorVersionRef.current++;
  }
  selectorRef.current = selector;
  eqRef.current = equalityFn;
  defaultValueRef.current = defaultValue;

  const selectorVersion = selectorVersionRef.current;
  const trackedFactKeysRef = useRef<string[]>([]);
  const trackedDeriveKeysRef = useRef<string[]>([]);
  const cachedValue = useRef<unknown>(UNINITIALIZED);
  const unsubsRef = useRef<Array<() => void>>([]);

  // Build a tracking-aware state proxy that exposes both facts and derivations
  const deriveKeys = useMemo(
    () => (system ? new Set(Object.keys(system.derive)) : new Set<string>()),
    [system],
  );

  const runWithTracking = useCallback(() => {
    if (!system) {
      return {
        value: defaultValueRef.current,
        factKeys: [] as string[],
        deriveKeys: [] as string[],
      };
    }

    return runTrackedSelector(system, deriveKeys, selectorRef.current);
  }, [system, deriveKeys]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!system) {
        // No system — return noop unsubscribe
        return () => {};
      }

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
              if (
                depsChanged(
                  trackedFactKeysRef.current,
                  updated.factKeys,
                  trackedDeriveKeysRef.current,
                  updated.deriveKeys,
                )
              )
                resubscribe();
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
              if (
                depsChanged(
                  trackedFactKeysRef.current,
                  updated.factKeys,
                  trackedDeriveKeysRef.current,
                  updated.deriveKeys,
                )
              )
                resubscribe();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectorVersion forces resubscription when selector deps change
    [system, runWithTracking, selectorVersion],
  );

  const getSnapshot = useCallback(() => {
    let effectiveValue: unknown;

    if (!system) {
      effectiveValue = defaultValueRef.current;
    } else {
      const { value: newValue } = runWithTracking();

      // When selector returns undefined and we have a default, use it
      effectiveValue =
        newValue === undefined && hasDefault
          ? defaultValueRef.current
          : newValue;
    }

    if (
      cachedValue.current !== UNINITIALIZED &&
      eqRef.current(cachedValue.current, effectiveValue)
    ) {
      return cachedValue.current;
    }
    cachedValue.current = effectiveValue;

    return effectiveValue;
  }, [runWithTracking, system, hasDefault]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// _useNamespacedSelectorImpl — internal namespaced useSelector
// ============================================================================

/**
 * Internal implementation for useSelector with NamespacedSystem.
 * Subscribes to all module namespaces and runs the selector against the system.
 * Uses equality comparison to prevent unnecessary re-renders.
 */
function _useNamespacedSelectorImpl(
  // biome-ignore lint/suspicious/noExplicitAny: Internal impl
  system: NamespacedSystem<any>,
  // biome-ignore lint/suspicious/noExplicitAny: Internal impl
  selector: (state: any) => unknown,
  defaultValueArg?: unknown,
  equalityFnArg?: (a: unknown, b: unknown) => boolean,
): unknown {
  const hasDefault = defaultValueArg !== undefined;
  const equalityFn = equalityFnArg ?? defaultEquality;

  const selectorRef = useRef(selector);
  const eqRef = useRef(equalityFn);
  const defaultValueRef = useRef(defaultValueArg);
  selectorRef.current = selector;
  eqRef.current = equalityFn;
  defaultValueRef.current = defaultValueArg;

  const cachedValue = useRef<unknown>(UNINITIALIZED);

  // Get all module namespace names for wildcard subscription
  const moduleNames = useMemo(() => Object.keys(system.facts), [system]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      // Subscribe to all modules using wildcard keys
      const wildcardKeys = moduleNames.map((ns) => `${ns}.*`);

      return system.subscribe(wildcardKeys, onStoreChange);
    },
    [system, moduleNames],
  );

  const getSnapshot = useCallback(() => {
    const newValue = selectorRef.current(system);
    const effectiveValue =
      newValue === undefined && hasDefault ? defaultValueRef.current : newValue;

    if (
      cachedValue.current !== UNINITIALIZED &&
      eqRef.current(cachedValue.current, effectiveValue)
    ) {
      return cachedValue.current;
    }

    cachedValue.current = effectiveValue;

    return effectiveValue;
  }, [system, hasDefault]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ============================================================================
// useDispatch
// ============================================================================

export function useDispatch<S extends ModuleSchema>(
  system: SingleModuleSystem<S>,
): (event: InferEvents<S>) => void {
  assertSystem("useDispatch", system);
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

/** Watch a derivation or fact by key (auto-detected). When a key exists in both facts and derivations, the derivation overload takes priority. */
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
/** Watch a fact key with auto-detection. */
export function useWatch<
  S extends ModuleSchema,
  K extends keyof InferFacts<S> & string,
>(
  system: SingleModuleSystem<S>,
  key: K,
  callback: (
    newValue: InferFacts<S>[K] | undefined,
    prevValue: InferFacts<S>[K] | undefined,
  ) => void,
): void;

/** Implementation */
export function useWatch(
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature
  system: SingleModuleSystem<any>,
  key: string,
  // biome-ignore lint/suspicious/noExplicitAny: Implementation overload dispatch
  callback: (newValue: any, prevValue: any) => void,
): void {
  assertSystem("useWatch", system);

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
  assertSystem("useInspect", system);
  // Always call the sync version (useSyncExternalStore path) — no conditional hooks
  const syncState = _useInspectSync(system);

  const throttleMs = options?.throttleMs;
  const [deferredState, setDeferredState] = useState(syncState);
  const throttleRef = useRef<{
    throttled: (...args: unknown[]) => void;
    cleanup: () => void;
  } | null>(null);

  // Create/recreate throttle when throttleMs changes
  useEffect(() => {
    if (!throttleMs || throttleMs <= 0) {
      throttleRef.current?.cleanup();
      throttleRef.current = null;
      return;
    }
    // Clean up old throttle before creating new one
    throttleRef.current?.cleanup();
    throttleRef.current = createThrottle((...args: unknown[]) => {
      setDeferredState(args[0] as InspectState);
    }, throttleMs);
    return () => {
      throttleRef.current?.cleanup();
      throttleRef.current = null;
    };
  }, [throttleMs]);

  // Feed sync state through throttle after each render
  useEffect(() => {
    if (throttleRef.current) {
      throttleRef.current.throttled(syncState);
    }
  }, [syncState]);

  if (!throttleMs || throttleMs <= 0) return syncState;
  return deferredState;
}

function _buildInspectState(
  // biome-ignore lint/suspicious/noExplicitAny: Internal
  system: SingleModuleSystem<any>,
): InspectState {
  return computeInspectState(system);
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
// useHistory — reactive history state
// ============================================================================

/**
 * Reactive history hook. Returns null when history is disabled.
 * Re-renders when snapshots are taken or navigation occurs.
 *
 * @example
 * ```tsx
 * const history = useHistory(system);
 * if (history) {
 *   return (
 *     <div>
 *       <button disabled={!history.canGoBack} onClick={() => history.goBack()}>Undo</button>
 *       <button disabled={!history.canGoForward} onClick={() => history.goForward()}>Redo</button>
 *       <span>{history.currentIndex + 1} / {history.totalSnapshots}</span>
 *     </div>
 *   );
 * }
 * ```
 */
export function useHistory(
  // biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
  system: SingleModuleSystem<any>,
): HistoryState | null {
  assertSystem("useHistory", system);
  const cachedRef = useRef<HistoryState | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => system.onHistoryChange(onStoreChange),
    [system],
  );

  const getSnapshot = useCallback(() => {
    const state = buildHistoryState(system);
    if (!state) return null;

    // Return stable reference when values haven't changed
    if (
      cachedRef.current &&
      cachedRef.current.canGoBack === state.canGoBack &&
      cachedRef.current.canGoForward === state.canGoForward &&
      cachedRef.current.currentIndex === state.currentIndex &&
      cachedRef.current.totalSnapshots === state.totalSnapshots &&
      cachedRef.current.isPaused === state.isPaused
    ) {
      return cachedRef.current;
    }

    cachedRef.current = state;
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
  const cachedRef = useRef<RequirementTypeStatus | typeof UNINITIALIZED>(
    UNINITIALIZED,
  );

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
      parts.push(
        `${type}:${status.pending}:${status.inflight}:${status.failed}:${status.hasError}:${status.lastError?.message ?? ""}`,
      );
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
const suspenseCacheMap = new WeakMap<
  StatusPlugin,
  Map<string, Promise<void>>
>();

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
          const allDone = types.every(
            (t) => !statusPlugin.getStatus(t).isLoading,
          );
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
  history?: HistoryOption;
  trace?: TraceOption;
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

/** Options for useDirectiveRef with namespaced modules */
export type UseDirectiveRefNamespacedOptions<Modules extends ModulesMap> =
  DirectiveRefBaseConfig & { modules: { [K in keyof Modules]: Modules[K] } };

// --- Single-module overloads ---

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

// --- Namespaced (multi-module) overloads ---

/** Namespaced: returns NamespacedSystem directly */
export function useDirectiveRef<const Modules extends ModulesMap>(
  options: UseDirectiveRefNamespacedOptions<Modules>,
): NamespacedSystem<Modules>;

/** Namespaced with config: returns NamespacedSystem directly */
export function useDirectiveRef<const Modules extends ModulesMap>(
  options: UseDirectiveRefNamespacedOptions<Modules>,
  config: DirectiveRefBaseConfig,
): NamespacedSystem<Modules>;

/** Implementation */
export function useDirectiveRef(
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature handles both modes
  options: any,
  config?: { status?: boolean } & DirectiveRefBaseConfig,
  // biome-ignore lint/suspicious/noExplicitAny: Implementation return varies by overload
): any {
  // biome-ignore lint/suspicious/noExplicitAny: System ref holds either system type
  const systemRef = useRef<any>(null);
  const statusPluginRef = useRef<StatusPlugin | null>(null);
  // Factory ref for strict mode re-creation (effects unmount then re-mount)
  // biome-ignore lint/suspicious/noExplicitAny: Factory return type varies
  const factoryRef = useRef<(() => any) | null>(null);
  const wantStatus = config?.status === true;
  const isNamespaced = "modules" in options;

  if (!systemRef.current) {
    // Build a factory that creates + starts the system.
    // Called once during render and again on strict-mode re-mount.
    factoryRef.current = () => {
      if (isNamespaced) {
        // --- Namespaced mode: { modules: { ... } } ---
        const { modules, ...rest } = options;
        const plugins = config?.plugins ?? rest.plugins ?? [];
        const history = config?.history ?? rest.history;
        const trace = config?.trace ?? rest.trace;
        const errorBoundary = config?.errorBoundary ?? rest.errorBoundary;
        const tickMs = config?.tickMs ?? rest.tickMs;
        const zeroConfig = config?.zeroConfig ?? rest.zeroConfig;
        const initialFacts = config?.initialFacts ?? rest.initialFacts;

        const sys = createSystem({
          modules,
          plugins: plugins.length > 0 ? plugins : undefined,
          history,
          trace,
          errorBoundary,
          tickMs,
          zeroConfig,
          initialFacts,
          // biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
        } as any);
        // Always initialize facts/derivations (safe for SSR).
        // Only start reconciliation on the client.
        sys.initialize();
        if (typeof window !== "undefined") {
          sys.start();
        }

        return sys;
      }

      // --- Single-module mode ---
      const isModule = "id" in options && "schema" in options;
      const mod = isModule ? options : options.module;
      const baseOpts = isModule ? {} : (options as DirectiveRefBaseConfig);
      const plugins = config?.plugins ?? baseOpts.plugins ?? [];
      const history = config?.history ?? baseOpts.history;
      const trace = config?.trace ?? baseOpts.trace;
      const errorBoundary = config?.errorBoundary ?? baseOpts.errorBoundary;
      const tickMs = config?.tickMs ?? baseOpts.tickMs;
      const zeroConfig = config?.zeroConfig ?? baseOpts.zeroConfig;
      const initialFacts = config?.initialFacts ?? baseOpts.initialFacts;

      let allPlugins = [...plugins];

      if (wantStatus) {
        statusPluginRef.current = createRequirementStatusPlugin();
        // biome-ignore lint/suspicious/noExplicitAny: Plugin generic issues
        allPlugins = [
          ...allPlugins,
          statusPluginRef.current.plugin as Plugin<any>,
        ];
      }

      // biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
      const sys = createSystem({
        module: mod,
        plugins: allPlugins.length > 0 ? allPlugins : undefined,
        history,
        trace,
        errorBoundary,
        tickMs,
        zeroConfig,
        initialFacts,
      } as any);
      // Always initialize facts/derivations (safe for SSR).
      // Only start reconciliation on the client.
      sys.initialize();
      if (typeof window !== "undefined") {
        sys.start();
      }

      return sys;
    };

    // Start synchronously so facts are initialized before the first render
    systemRef.current = factoryRef.current();
  }

  useEffect(() => {
    // Strict mode re-mount: system was destroyed in cleanup, recreate it
    if (!systemRef.current && factoryRef.current) {
      systemRef.current = factoryRef.current();
    }

    return () => {
      systemRef.current?.destroy();
      systemRef.current = null;
      statusPluginRef.current = null;
    };
  }, []);

  if (wantStatus && !isNamespaced) {
    return {
      system: systemRef.current!,
      statusPlugin: statusPluginRef.current!,
    };
  }

  return systemRef.current!;
}

// ============================================================================
// useNamespacedSelector — select from a NamespacedSystem with useSyncExternalStore
// ============================================================================

/**
 * React hook to select derived values from a NamespacedSystem.
 * Uses useSyncExternalStore for tear-free reads.
 *
 * @param system - The namespaced system to read from
 * @param keys - Namespaced keys to subscribe to (e.g., ["auth.token", "data.count"])
 * @param selector - Function that reads from system.facts / system.derive
 *
 * @example
 * ```tsx
 * const system = useDirectiveRef({ modules: { auth, data } });
 * const token = useNamespacedSelector(system, ["auth.token"], (s) => s.facts.auth.token);
 * const count = useNamespacedSelector(system, ["data.*"], (s) => s.derive.data.total);
 * ```
 */
export function useNamespacedSelector<Modules extends ModulesMap, R>(
  system: NamespacedSystem<Modules>,
  keys: string[],
  selector: (system: NamespacedSystem<Modules>) => R,
): R {
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      system.subscribe(keysRef.current, onStoreChange),
    [system],
  );

  const getSnapshot = useCallback(() => selectorRef.current(system), [system]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
  selections: UseDirectiveOptions<S, FK, DK> = {} as UseDirectiveOptions<
    S,
    FK,
    DK
  >,
): UseDirectiveReturn<S, FK, DK> | UseDirectiveReturnWithStatus<S, FK, DK> {
  const {
    facts: factKeysOpt,
    derived: derivedKeysOpt,
    status,
    ...configRest
  } = selections;
  const factKeys = (factKeysOpt ?? []) as FK[];
  const derivedKeys = (derivedKeysOpt ?? []) as DK[];

  // When no keys are specified, subscribe to everything
  const subscribeAll = factKeys.length === 0 && derivedKeys.length === 0;

  // Create system via useDirectiveRef (handles lifecycle)
  // biome-ignore lint/suspicious/noExplicitAny: Conditional overload dispatch
  const refResult: any = status
    ? useDirectiveRef(moduleOrOptions, { status: true as const, ...configRest })
    : useDirectiveRef(moduleOrOptions, configRest);

  const system: SingleModuleSystem<S> = status ? refResult.system : refResult;

  const statusPlugin = status
    ? (
        refResult as {
          system: SingleModuleSystem<S>;
          statusPlugin: StatusPlugin;
        }
      ).statusPlugin
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

  const cachedFacts = useRef<Record<string, unknown> | typeof UNINITIALIZED>(
    UNINITIALIZED,
  );
  const cachedDerived = useRef<Record<string, unknown> | typeof UNINITIALIZED>(
    UNINITIALIZED,
  );
  const cachedWrapper = useRef<{
    facts: Record<string, unknown>;
    derived: Record<string, unknown>;
  } | null>(null);

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

    const stableFacts = factsSame
      ? (cachedFacts.current as Record<string, unknown>)
      : factsResult;
    const stableDerived = derivedSame
      ? (cachedDerived.current as Record<string, unknown>)
      : derivedResult;

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
  assertSystem("useEvents", system);
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
  assertSystem("useExplain", system);
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

/** Get all constraints */
export function useConstraintStatus(
  system: SingleModuleSystem<any>,
): ConstraintInfo[];
/** Get a single constraint by ID */
export function useConstraintStatus(
  system: SingleModuleSystem<any>,
  constraintId: string,
): ConstraintInfo | null;
/** Implementation */
export function useConstraintStatus(
  // biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
  system: SingleModuleSystem<any>,
  constraintId?: string,
): ConstraintInfo[] | ConstraintInfo | null {
  assertSystem("useConstraintStatus", system);
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
  assertSystem("useOptimisticUpdate", system);
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

// ============================================================================
// Typed Hooks Factory
// ============================================================================

/**
 * Creates pre-typed versions of the core hooks for a specific module schema.
 * Eliminates the need to pass type parameters on every hook call.
 *
 * @example
 * ```tsx
 * const { useFact, useDerived, useDispatch, useEvents, useWatch } = createTypedHooks<typeof counterModule.schema>();
 *
 * // No type parameters needed — schema is baked in
 * function Counter({ system }: { system: SingleModuleSystem<CounterSchema> }) {
 *   const count = useFact(system, "count");
 *   const doubled = useDerived(system, "doubled");
 *   const dispatch = useDispatch(system);
 * }
 * ```
 */
export function createTypedHooks<M extends ModuleSchema>(): {
  useFact: <K extends keyof InferFacts<M> & string>(
    system: SingleModuleSystem<M>,
    factKey: K,
  ) => InferFacts<M>[K] | undefined;
  useDerived: <K extends keyof InferDerivations<M> & string>(
    system: SingleModuleSystem<M>,
    derivationId: K,
  ) => InferDerivations<M>[K];
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
      useFact(system as SingleModuleSystem<any>, factKey) as
        | InferFacts<M>[K]
        | undefined,
    useDerived: <K extends keyof InferDerivations<M> & string>(
      system: SingleModuleSystem<M>,
      derivationId: K,
    ) =>
      // biome-ignore lint/suspicious/noExplicitAny: Type narrowing for internal call
      useDerived(system as SingleModuleSystem<any>, derivationId) as InferDerivations<M>[K],
    useDispatch: (system: SingleModuleSystem<M>) =>
      useDispatch<M>(system),
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
// useQuerySystem — Stable query system with lifecycle management
// ============================================================================

/**
 * React hook to create and manage a query system with proper lifecycle.
 *
 * Accepts a QuerySystemConfig directly – no factory wrapper needed.
 * Creates the system once, starts on mount, destroys on unmount.
 * Handles Strict Mode re-creation and SSR safety.
 *
 * Requires `@directive-run/query` as a peer dependency.
 *
 * @example
 * ```tsx
 * import { useQuerySystem } from "@directive-run/react";
 * import { useDerived } from "@directive-run/react";
 *
 * function App() {
 *   const app = useQuerySystem({
 *     facts: { userId: "" },
 *     queries: {
 *       user: {
 *         key: (f) => f.userId ? { userId: f.userId } : null,
 *         fetcher: async (p, signal) => {
 *           const res = await fetch(`/api/users/${p.userId}`, { signal });
 *           return res.json();
 *         },
 *       },
 *     },
 *   });
 *
 *   const user = useDerived(app, "user");
 *
 *   return <div>{user.data?.name}</div>;
 * }
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: System type varies based on config
export function useQuerySystem<T extends { start: () => void; destroy: () => void; isRunning?: boolean; [key: string]: any }>(
  factory: () => T,
): T {
  const systemRef = useRef<T | null>(null);
  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  if (!systemRef.current) {
    systemRef.current = factoryRef.current();
  }

  useEffect(() => {
    // Strict mode re-mount: system was destroyed in cleanup, recreate
    if (!systemRef.current && factoryRef.current) {
      systemRef.current = factoryRef.current();
    }

    // Start on mount (SSR safety: only start in browser)
    if (typeof window !== "undefined" && systemRef.current && !systemRef.current.isRunning) {
      systemRef.current.start();
    }

    return () => {
      systemRef.current?.destroy();
      systemRef.current = null;
    };
  }, []);

  return systemRef.current!;
}
