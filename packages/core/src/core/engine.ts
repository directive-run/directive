/**
 * Engine - The core reconciliation loop
 *
 * The engine orchestrates:
 * 1. Fact changes trigger reconciliation
 * 2. Constraints produce requirements
 * 3. Resolvers fulfill requirements
 * 4. Effects run after stabilization
 * 5. Derivations are invalidated and recomputed
 */

import {
  type HistoryManager,
  createDisabledHistory,
  createHistoryManager,
} from "../utils/history.js";
import { hashObject, isPrototypeSafe } from "../utils/utils.js";
import {
  type ConstraintsManager,
  createConstraintsManager,
} from "./constraints.js";
import {
  type DerivationsManager,
  createDerivationsManager,
} from "./derivations.js";
import { type EffectsManager, createEffectsManager } from "./effects.js";
import {
  createDeriveAccessor,
  createEventsAccessor,
} from "./engine-accessors.js";
import { createDefinitionsRegistry } from "./engine-definitions.js";
import { createTraceManager } from "./engine-trace.js";
import {
  type ErrorBoundaryManager,
  createErrorBoundaryManager,
} from "./errors.js";
import { createFacts } from "./facts.js";
import { type PluginManager, createPluginManager } from "./plugins.js";
import { RequirementSet } from "./requirements.js";
import { type ResolversManager, createResolversManager } from "./resolvers.js";
import { BLOCKED_PROPS } from "./tracking.js";
import type {
  ConstraintsDef,
  DerivationsDef,
  EffectsDef,
  EventsDef,
  FactsSnapshot,
  InferSchema,
  ReconcileResult,
  RequirementKeyFn,
  ResolversDef,
  Schema,
  System,
  SystemConfig,
  SystemEvent,
  SystemInspection,
  TraceEntry,
} from "./types.js";

// ============================================================================
// Engine Implementation
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface EngineState<_S extends Schema> {
  isRunning: boolean;
  isReconciling: boolean;
  reconcileScheduled: boolean;
  isInitializing: boolean;
  isInitialized: boolean;
  isReady: boolean;
  isDestroyed: boolean;
  changedKeys: Set<string>;
  previousRequirements: RequirementSet;
  readyPromise: Promise<void> | null;
  readyResolve: (() => void) | null;
}

/**
 * Create the core Directive reconciliation engine that wires facts, derivations,
 * effects, constraints, resolvers, plugins, error boundaries, and history
 * into a single reactive system.
 *
 * @remarks
 * This is the internal factory used by {@link createSystem}. Most users should
 * call `createSystem` instead, which provides a friendlier API and handles
 * module composition.
 *
 * @param config - Full system configuration including modules, plugins, error boundary settings, and debug options
 * @returns A {@link System} instance with facts, derive, events, dispatch, subscribe, watch, settle, and lifecycle methods
 *
 * @example
 * ```ts
 * // Prefer createSystem for most use cases:
 * import { createSystem, createModule, t } from "@directive-run/core";
 *
 * const counter = createModule("counter", {
 *   schema: { count: t.number() },
 *   init: (facts) => { facts.count = 0; },
 * });
 *
 * const system = createSystem({ module: counter });
 * system.start();
 * system.facts.count = 42;
 * ```
 *
 * @internal
 */
// biome-ignore lint/suspicious/noExplicitAny: Engine uses flat schema internally, public API uses ModuleSchema
export function createEngine<S extends Schema>(
  config: SystemConfig<any>,
): System<any> {
  // Merge all module definitions with collision detection
  // Use Object.create(null) to prevent prototype chain traversal (e.g., "toString" in mergedEvents)
  const mergedSchema = Object.create(null) as S;
  const mergedEvents: EventsDef<S> = Object.create(null);
  const mergedDerive: DerivationsDef<S> = Object.create(null);
  const mergedEffects: EffectsDef<S> = Object.create(null);
  const mergedConstraints: ConstraintsDef<S> = Object.create(null);
  const mergedResolvers: ResolversDef<S> = Object.create(null);

  // Track which module defined each key for collision detection
  const schemaOwners = new Map<string, string>();
  const definitionOwners = new Map<string, string>();

  for (const module of config.modules) {
    // Security: Validate module definitions for dangerous keys
    // Always run in all environments — this is a security boundary, not a dev convenience
    const validateKeys = (obj: object | undefined, section: string) => {
      if (!obj) return;
      for (const key of Object.keys(obj)) {
        if (BLOCKED_PROPS.has(key)) {
          throw new Error(
            `[Directive] Security: Module "${module.id}" has dangerous key "${key}" in ${section}. ` +
              "This could indicate a prototype pollution attempt.",
          );
        }
        if (section === "schema" && key.startsWith("$")) {
          throw new Error(
            `[Directive] Module "${module.id}" has schema key "${key}" starting with "$". ` +
              "Keys starting with $ are reserved for internal accessors ($store, $snapshot).",
          );
        }
      }
    };
    validateKeys(module.schema, "schema");
    validateKeys(module.events, "events");
    validateKeys(module.derive, "derive");
    validateKeys(module.effects, "effects");
    validateKeys(module.constraints, "constraints");
    validateKeys(module.resolvers, "resolvers");

    // Check for schema collisions (unconditional — data integrity, not dev convenience)
    for (const key of Object.keys(module.schema)) {
      const existingOwner = schemaOwners.get(key);
      if (existingOwner) {
        throw new Error(
          `[Directive] Schema collision: Fact "${key}" is defined in both module "${existingOwner}" and "${module.id}". ` +
            `Use namespacing (e.g., "${module.id}::${key}") or merge into one module.`,
        );
      }
      schemaOwners.set(key, module.id);
    }

    // Check for definition collisions across modules (derive, effects, constraints, resolvers)
    const checkCollisions = (obj: object | undefined, section: string) => {
      if (!obj) {
        return;
      }
      for (const key of Object.keys(obj)) {
        const owner = definitionOwners.get(key);
        if (owner && owner !== module.id) {
          throw new Error(
            `[Directive] Definition collision: ${section} "${key}" is defined in both module "${owner}" and "${module.id}". ` +
              "Use namespacing or rename to avoid conflicts.",
          );
        }
        definitionOwners.set(key, module.id);
      }
    };
    checkCollisions(module.derive, "derivation");
    checkCollisions(module.effects, "effect");
    checkCollisions(module.constraints, "constraint");
    checkCollisions(module.resolvers, "resolver");
    checkCollisions(module.events, "event");

    Object.assign(mergedSchema, module.schema);
    if (module.events) Object.assign(mergedEvents, module.events);
    if (module.derive) Object.assign(mergedDerive, module.derive);
    if (module.effects) Object.assign(mergedEffects, module.effects);
    if (module.constraints)
      Object.assign(mergedConstraints, module.constraints);
    if (module.resolvers) Object.assign(mergedResolvers, module.resolvers);
  }

  // Build snapshotEventNames: Set<string> | null
  // If any module declares history.snapshotEvents, build the filter set.
  // Modules WITHOUT history.snapshotEvents have all their events added (they still snapshot).
  let snapshotEventNames: Set<string> | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: Module may have history.snapshotEvents at runtime
  const hasAnySnapshotEvents = config.modules.some(
    (m: any) => m.history?.snapshotEvents,
  );
  if (hasAnySnapshotEvents) {
    snapshotEventNames = new Set<string>();
    for (const module of config.modules) {
      // biome-ignore lint/suspicious/noExplicitAny: Module may have history.snapshotEvents at runtime
      const mod = module as any;
      if (mod.history?.snapshotEvents) {
        for (const eventName of mod.history.snapshotEvents) {
          snapshotEventNames.add(eventName);
        }
      } else if (mod.events) {
        // No filter — all events from this module create snapshots
        for (const eventName of Object.keys(mod.events)) {
          snapshotEventNames.add(eventName);
        }
      }
    }
  }

  // Snapshot intent flags — track whether the current change batch should create a snapshot
  let dispatchDepth = 0;
  let shouldTakeSnapshot = false;

  // Dev-mode: Warn if a fact and derivation share the same name
  if (process.env.NODE_ENV !== "production") {
    const derivationNames = new Set(Object.keys(mergedDerive));
    for (const key of Object.keys(mergedSchema)) {
      if (derivationNames.has(key)) {
        console.warn(
          `[Directive] "${key}" exists as both a fact and a derivation. ` +
            "This may cause unexpected dependency tracking behavior.",
        );
      }
    }
  }

  // Create plugin manager
  const pluginManager: PluginManager<S> = createPluginManager();
  for (const plugin of config.plugins ?? []) {
    pluginManager.register(plugin);
  }

  // Create error boundary
  const errorBoundary: ErrorBoundaryManager = createErrorBoundaryManager({
    config: config.errorBoundary,
    onError: (error) => pluginManager.emitError(error),
    onRecovery: (error, strategy) =>
      pluginManager.emitErrorRecovery(error, strategy),
  });

  // Retry-later polling timer
  let retryLaterTimer: ReturnType<typeof setInterval> | null = null;

  // Create facts store and proxy
  // Note: We need to create a local invalidate function that will be set after derivationsManager is created
  let invalidateDerivation: (key: string) => void = () => {};
  let invalidateManyDerivations: (keys: string[]) => void = () => {};

  // Forward-declared so onChange/onBatch closures can check isRestoring.
  // Assigned after createHistoryManager() below.
  let historyRef: HistoryManager<S> | null = null;

  // Trace management (per-run reconciliation changelog, gated by config.trace)
  const traceManager = createTraceManager({
    traceConfig: config.trace,
    pluginManager,
  });
  const traceEnabled = traceManager.enabled;

  const { store, facts } = createFacts<S>({
    schema: mergedSchema,
    onChange: (key, value, prev) => {
      pluginManager.emitFactSet(key, value, prev);
      // Invalidate derivations so they recompute on read
      invalidateDerivation(key);
      // Track fact changes for trace
      if (traceEnabled) {
        traceManager.recordFactChange(String(key), prev, value);
      }
      // During history restore, skip change tracking and reconciliation.
      // The restored state is already reconciled; re-reconciling would create
      // spurious snapshots that break undo/redo.
      if (historyRef?.isRestoring) return;
      // Direct fact mutations (outside event dispatch) always create snapshots
      if (dispatchDepth === 0) {
        shouldTakeSnapshot = true;
      }
      state.changedKeys.add(key);
      scheduleReconcile();
    },
    onBatch: (changes) => {
      pluginManager.emitFactsBatch(changes);
      const keys: string[] = [];
      for (const change of changes) {
        keys.push(change.key);
      }
      // Track fact changes for trace
      if (traceEnabled) {
        for (const change of changes) {
          traceManager.recordFactChange(
            change.key,
            change.prev,
            change.type === "delete" ? undefined : change.value,
          );
        }
      }
      // Invalidate all affected derivations at once — listeners fire only
      // after ALL keys are invalidated, so they see consistent state.
      invalidateManyDerivations(keys);
      // During history restore, skip change tracking and reconciliation.
      if (historyRef?.isRestoring) return;
      // Resolver/effect batches (outside event dispatch) always create snapshots
      if (dispatchDepth === 0) {
        shouldTakeSnapshot = true;
      }
      for (const change of changes) {
        state.changedKeys.add(change.key);
      }
      scheduleReconcile();
    },
  });

  // Create derivations manager
  const derivationsManager: DerivationsManager<
    S,
    DerivationsDef<S>
  > = createDerivationsManager({
    definitions: mergedDerive,
    facts,
    onCompute: (id, value, oldValue, deps) => {
      pluginManager.emitDerivationCompute(id, value, deps);
      if (traceManager.currentTrace) {
        traceManager.currentTrace.derivationsRecomputed.push({
          id,
          deps: deps ? [...deps] : [],
          oldValue,
          newValue: value,
        });
      }
    },
    onInvalidate: (id) => pluginManager.emitDerivationInvalidate(id),
    onError: (id, error) => {
      const strategy = errorBoundary.handleError("derivation", id, error);

      if (strategy === "retry") {
        derivationsManager.invalidate(id);
      }
    },
  });

  // Now wire up derivation invalidation
  invalidateDerivation = (key: string) => derivationsManager.invalidate(key);
  invalidateManyDerivations = (keys: string[]) =>
    derivationsManager.invalidateMany(keys);

  // Create effects manager
  const effectsManager: EffectsManager<S> = createEffectsManager({
    definitions: mergedEffects,
    facts,
    store,
    onRun: (id, deps) => {
      pluginManager.emitEffectRun(id);
      if (traceManager.currentTrace) {
        traceManager.currentTrace.effectsRun.push({
          id,
          triggeredBy: deps,
        });
      }
    },
    onError: (id, error) => {
      const strategy = errorBoundary.handleError("effect", id, error);
      pluginManager.emitEffectError(id, error);

      if (traceManager.currentTrace) {
        traceManager.currentTrace.effectErrors.push({
          id,
          error: String(error),
        });
      }

      if (strategy === "disable") {
        effectsManager.disable(id);
      }

      if (strategy === "retry") {
        state.changedKeys.add("*");
        scheduleReconcile();
      }
    },
  });

  // Extract resolver key functions keyed by requirement type.
  // Resolvers with a string `requirement` and a `key` function contribute
  // to requirement deduplication inside the constraints manager.
  const requirementKeys: Record<string, RequirementKeyFn> = Object.create(null);
  for (const def of Object.values(mergedResolvers)) {
    if (
      def.key &&
      typeof def.requirement === "string"
    ) {
      requirementKeys[def.requirement] = def.key;
    }
  }

  // Create constraints manager
  const constraintsManager: ConstraintsManager<S> = createConstraintsManager({
    definitions: mergedConstraints,
    facts,
    requirementKeys,
    onEvaluate: (id, active) =>
      pluginManager.emitConstraintEvaluate(id, active),
    onError: (id, error) => {
      const strategy = errorBoundary.handleError("constraint", id, error);
      pluginManager.emitConstraintError(id, error);

      if (strategy === "disable") {
        constraintsManager.disable(id);
      }
    },
  });

  /** Sync resolver key functions into the constraints manager */
  function syncResolverKeys(defs: ResolversDef<S>): void {
    for (const def of Object.values(defs)) {
      if (def.key && typeof def.requirement === "string") {
        constraintsManager.setRequirementKey(def.requirement, def.key);
      }
    }
  }

  // Create resolvers manager
  const resolversManager: ResolversManager<S> = createResolversManager({
    definitions: mergedResolvers,
    facts,
    store,
    onStart: (resolver, req) => pluginManager.emitResolverStart(resolver, req),
    onComplete: (resolver, req, duration) => {
      errorBoundary.clearRetryAttempts(resolver);
      pluginManager.emitResolverComplete(resolver, req, duration);
      pluginManager.emitRequirementMet(req, resolver);
      // Mark the constraint as resolved for `after` ordering
      constraintsManager.markResolved(req.fromConstraint);
      // Attribute to the trace entry that started this resolver
      if (traceEnabled) {
        traceManager.recordResolverComplete(req.id, resolver, duration);
        traceManager.decrementInflight(req.id);
      }
    },
    onError: (resolver, req, error) => {
      const strategy = errorBoundary.handleError(
        "resolver",
        resolver,
        error,
        req,
      );
      pluginManager.emitResolverError(resolver, req, error);

      if (strategy === "disable") {
        constraintsManager.disable(req.fromConstraint);
      }

      if (strategy === "retry") {
        // Remove from previousRequirements so the diff sees it as "added" again
        state.previousRequirements.remove(req.id);
        scheduleReconcile();
      }

      if (strategy === "retry-later") {
        const pending = errorBoundary
          .getRetryLaterManager()
          .getPendingRetries();
        const entry = pending.find((p) => p.sourceId === resolver);

        if (entry && !entry.callback) {
          entry.callback = () => {
            scheduleReconcile();
          };
        }
      }

      // Attribute error to the trace entry that started this resolver
      if (traceEnabled) {
        traceManager.recordResolverError(req.id, resolver, String(error));
        traceManager.decrementInflight(req.id);
      }
    },
    onRetry: (resolver, req, attempt) =>
      pluginManager.emitResolverRetry(resolver, req, attempt),
    onCancel: (resolver, req) => {
      pluginManager.emitResolverCancel(resolver, req);
      pluginManager.emitRequirementCanceled(req);
      // Decrement inflight for the trace entry
      if (traceEnabled) {
        traceManager.decrementInflight(req.id);
      }
    },
    onResolutionComplete: () => {
      // After a resolver completes, schedule another reconcile
      notifySettlementChange();
      scheduleReconcile();
    },
  });

  // History listeners — notified when snapshot state changes
  const historyListeners = new Set<() => void>();

  function notifyHistoryChange(): void {
    for (const listener of historyListeners) {
      listener();
    }
  }

  // Create history manager
  const historyManager: HistoryManager<S> = config.history
    ? createHistoryManager({
        historyOption: config.history,
        facts,
        store,
        onSnapshot: (snapshot) => {
          pluginManager.emitSnapshot(snapshot);
          notifyHistoryChange();
        },
        onHistoryChange: (from, to) => {
          pluginManager.emitHistoryNavigate(from, to);
          notifyHistoryChange();
        },
      })
    : createDisabledHistory();
  historyRef = historyManager;

  // Settlement listeners — notified when isSettled may have changed
  const settlementListeners = new Set<() => void>();

  function notifySettlementChange(): void {
    for (const listener of settlementListeners) {
      listener();
    }
  }

  // Reconcile depth guard — prevents runaway reconcile → scheduleReconcile chains
  const MAX_RECONCILE_DEPTH = 50;
  const MAX_DEFERRED_REGISTRATIONS = 100;
  let reconcileDepth = 0;

  // Engine state
  const state: EngineState<S> = {
    isRunning: false,
    isReconciling: false,
    reconcileScheduled: false,
    isInitializing: false,
    isInitialized: false,
    isReady: false,
    isDestroyed: false,
    changedKeys: new Set(),
    previousRequirements: new RequirementSet(),
    readyPromise: null,
    readyResolve: null,
  };

  // Dynamic definition registry (register, assign, unregister, call)
  const definitions = createDefinitionsRegistry({
    mergedConstraints,
    mergedResolvers,
    mergedDerive,
    mergedEffects,
    constraintsManager,
    resolversManager,
    derivationsManager,
    effectsManager,
    pluginManager,
    getState: () => state,
    scheduleReconcile,
    maxDeferredRegistrations: MAX_DEFERRED_REGISTRATIONS,
  });

  /** Schedule a reconciliation on the next microtask */
  function scheduleReconcile(): void {
    // Suppress reconciliation during initialization phase
    if (!state.isRunning || state.reconcileScheduled || state.isInitializing)
      return;

    state.reconcileScheduled = true;
    notifySettlementChange();
    queueMicrotask(() => {
      state.reconcileScheduled = false;
      if (state.isRunning && !state.isInitializing) {
        // Await reconcile to prevent race conditions
        // Error is caught inside reconcile, so no need to handle here
        reconcile().catch((error) => {
          // Only log unexpected errors (reconcile handles its own errors)
          if (process.env.NODE_ENV !== "production") {
            console.error("[Directive] Unexpected error in reconcile:", error);
          }
        });
      }
    });
  }

  /** The main reconciliation loop */
  async function reconcile(): Promise<void> {
    if (state.isReconciling) return;

    reconcileDepth++;
    if (reconcileDepth > MAX_RECONCILE_DEPTH) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[Directive] Reconcile loop exceeded ${MAX_RECONCILE_DEPTH} iterations. ` +
            "This usually means resolvers are creating circular requirement chains. " +
            `Check that resolvers aren't mutating facts that re-trigger their own constraints.`,
        );
      }
      // Drain pending fact changes so they don't leak into the next trace entry (M4)
      if (traceEnabled) {
        traceManager.drainPendingChanges();
      }
      // Clear previous requirements so the next reconcile treats all
      // requirements as "added" and re-dispatches them to resolvers.
      // This recovers from situations where reconcile crashed (e.g.,
      // structuredClone failure) and left requirements stuck.
      state.previousRequirements = new RequirementSet();
      reconcileDepth = 0;
      return;
    }

    state.isReconciling = true;
    notifySettlementChange();

    const reconcileStartMs = traceEnabled ? traceManager.startRun() : 0;
    const currentTrace = traceManager.currentTrace;

    try {
      // Take snapshot before reconciliation (respects snapshotEvents filtering)
      if (state.changedKeys.size > 0) {
        if (snapshotEventNames === null || shouldTakeSnapshot) {
          const keys = state.changedKeys;
          const label =
            keys.size <= 5
              ? `facts-changed:${[...keys].join(",")}`
              : `facts-changed:${[...keys].slice(0, 5).join(",")}+${keys.size - 5}more`;
          historyManager.takeSnapshot(label);
        }
        shouldTakeSnapshot = false;
      }

      // Get snapshot for plugins
      const snapshot = facts.$snapshot() as FactsSnapshot<S>;
      pluginManager.emitReconcileStart(snapshot);

      // Note: Derivations are already invalidated immediately when facts change
      // (in the onChange/onBatch callbacks), so we don't need to do it here

      // Run effects for changed keys
      await effectsManager.runEffects(state.changedKeys);

      // Copy changed keys for constraint evaluation before clearing
      const keysForConstraints = new Set(state.changedKeys);

      // Clear changed keys
      state.changedKeys.clear();

      // Evaluate constraints (pass changed keys for incremental evaluation)
      const currentRequirements =
        await constraintsManager.evaluate(keysForConstraints);
      const currentSet = new RequirementSet();
      for (const req of currentRequirements) {
        currentSet.add(req);
        pluginManager.emitRequirementCreated(req);
      }

      // Capture which constraints produced requirements for trace
      if (currentTrace) {
        const hitConstraintIds = new Set(
          currentRequirements.map((r) => r.fromConstraint),
        );
        for (const cId of hitConstraintIds) {
          const cState = constraintsManager.getState(cId);
          if (cState) {
            const cDeps = constraintsManager.getDependencies(cId);
            currentTrace.constraintsHit.push({
              id: cId,
              priority: cState.priority,
              deps: cDeps ? [...cDeps] : [],
            });
          }
        }
      }

      // Diff with previous requirements
      const { added, removed } = currentSet.diff(state.previousRequirements);

      // Capture requirement diff for trace
      if (currentTrace) {
        for (const req of added) {
          currentTrace.requirementsAdded.push({
            id: req.id,
            type: req.requirement.type,
            fromConstraint: req.fromConstraint,
          });
        }
        for (const req of removed) {
          currentTrace.requirementsRemoved.push({
            id: req.id,
            type: req.requirement.type,
            fromConstraint: req.fromConstraint,
          });
        }
      }

      // Cancel resolvers for removed requirements
      for (const req of removed) {
        resolversManager.cancel(req.id);
      }

      // Start resolvers for new requirements
      for (const req of added) {
        resolversManager.resolve(req);
      }

      // Capture resolver starts for trace
      if (currentTrace) {
        const inflightNow = resolversManager.getInflightInfo();
        // Build Map for O(1) lookups instead of O(n) find per requirement
        const inflightById = new Map(inflightNow.map((i) => [i.id, i]));
        for (const req of added) {
          const info = inflightById.get(req.id);
          currentTrace.resolversStarted.push({
            resolver: info?.resolverId ?? "unknown",
            requirementId: req.id,
          });
          // Track attribution for async completion
          traceManager.attributeResolverStart(req.id);
        }
      }

      // Update previous requirements
      state.previousRequirements = currentSet;

      // Build reconcile result (only if plugins are listening)
      const inflightInfo = resolversManager.getInflightInfo();
      if (config.plugins && config.plugins.length > 0) {
        // Build Map for O(1) lookups on canceled requirements
        const inflightMap =
          removed.length > 0
            ? new Map(inflightInfo.map((i) => [i.id, i.resolverId]))
            : undefined;
        const result: ReconcileResult = {
          unmet: currentRequirements.filter(
            (r) => !resolversManager.isResolving(r.id),
          ),
          inflight: inflightInfo,
          completed: [], // Completed resolvers are tracked separately via onComplete callback
          canceled: removed.map((r) => ({
            id: r.id,
            resolverId: inflightMap?.get(r.id) ?? "unknown",
          })),
        };
        pluginManager.emitReconcileEnd(result);
      }

      // Mark system as ready after first successful reconcile
      if (!state.isReady) {
        state.isReady = true;
        if (state.readyResolve) {
          state.readyResolve();
          state.readyResolve = null;
        }
      }
    } finally {
      // Finalize the current trace entry
      if (traceEnabled) {
        traceManager.finalizeCurrentRun(reconcileStartMs);
      }

      state.isReconciling = false;

      // Flush any deferred dynamic definition operations that were queued
      // during this reconciliation cycle
      definitions.flushDeferred();

      // Schedule next reconcile BEFORE notifying settlement change,
      // so listeners never see a brief isSettled=true flash when
      // more changes are pending.
      // Reset depth counter at the end of each top-level reconcile.
      // Previously only reset on full settlement, which allowed depth
      // to climb toward MAX in long-running systems with continuous changes.
      reconcileDepth = 0;

      if (state.changedKeys.size > 0) {
        scheduleReconcile();
      }

      notifySettlementChange();
    }
  }

  /** Dispatch an event by name, handling snapshot flags and batching */
  function dispatchEventByName(
    eventName: string,
    payload?: Record<string, unknown>,
  ): void {
    const handler = mergedEvents[eventName];
    if (handler) {
      dispatchDepth++;
      if (snapshotEventNames === null || snapshotEventNames.has(eventName)) {
        shouldTakeSnapshot = true;
      }
      try {
        store.batch(() => {
          handler(facts, { type: eventName, ...payload });
        });
      } finally {
        dispatchDepth--;
      }
    } else if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[Directive] Unknown event type "${eventName}". ` +
          "No handler is registered for this event. " +
          `Available events: ${Object.keys(mergedEvents).join(", ") || "(none)"}`,
      );
    }
  }

  // Create typed derive accessor using a Proxy
  const deriveAccessor = createDeriveAccessor({
    mergedDerive: mergedDerive as Record<string, unknown>,
    getDerivation: (key) =>
      derivationsManager.get(key as keyof DerivationsDef<S>),
    definitions,
  });

  // Create typed events accessor using a Proxy
  const eventsAccessor = createEventsAccessor({
    mergedEvents: mergedEvents as Record<string, unknown>,
    dispatchEvent: dispatchEventByName,
  });

  // Create the system interface
  // biome-ignore lint/suspicious/noExplicitAny: Engine uses flat schema internally, public API uses ModuleSchema
  const system: System<any> = {
    facts,
    history: historyManager.isEnabled ? historyManager : null,
    // biome-ignore lint/suspicious/noExplicitAny: Proxy provides both derivation values and control methods at runtime
    derive: deriveAccessor as any,
    events: eventsAccessor,
    constraints: {
      disable: (id: string) => constraintsManager.disable(id),
      enable: (id: string) => constraintsManager.enable(id),
      isDisabled: (id: string) => constraintsManager.isDisabled(id),
      // biome-ignore lint/suspicious/noExplicitAny: Runtime accepts any constraint def shape
      register: (id: string, def: any) => {
        definitions.register("constraint", id, def);
      },
      // biome-ignore lint/suspicious/noExplicitAny: Runtime accepts any constraint def shape
      assign: (id: string, def: any) => {
        definitions.assign("constraint", id, def);
      },
      unregister: (id: string) => {
        definitions.unregister("constraint", id);
      },
      call: (id: string, props?: Record<string, unknown>) =>
        definitions.call("constraint", id, props) as Promise<
          Record<string, unknown>[]
        >,
      isDynamic: (id: string) => definitions.isDynamic("constraint", id),
      listDynamic: () => definitions.listDynamic("constraint"),
    },
    effects: {
      disable: (id: string) => effectsManager.disable(id),
      enable: (id: string) => effectsManager.enable(id),
      isEnabled: (id: string) => effectsManager.isEnabled(id),
      // biome-ignore lint/suspicious/noExplicitAny: Runtime accepts any effect def shape
      register: (id: string, def: any) => {
        definitions.register("effect", id, def);
      },
      // biome-ignore lint/suspicious/noExplicitAny: Runtime accepts any effect def shape
      assign: (id: string, def: any) => {
        definitions.assign("effect", id, def);
      },
      unregister: (id: string) => {
        definitions.unregister("effect", id);
      },
      call: (id: string) => definitions.call("effect", id) as Promise<void>,
      isDynamic: (id: string) => definitions.isDynamic("effect", id),
      listDynamic: () => definitions.listDynamic("effect"),
    },
    resolvers: {
      // biome-ignore lint/suspicious/noExplicitAny: Runtime accepts any resolver def shape
      register: (id: string, def: any) => {
        definitions.register("resolver", id, def);
        syncResolverKeys({ [id]: def } as ResolversDef<S>);
      },
      // biome-ignore lint/suspicious/noExplicitAny: Runtime accepts any resolver def shape
      assign: (id: string, def: any) => {
        definitions.assign("resolver", id, def);
        syncResolverKeys({ [id]: def } as ResolversDef<S>);
      },
      unregister: (id: string) => {
        // Remove the key function before unregistering
        const def = mergedResolvers[id];
        if (def?.key && typeof def.requirement === "string") {
          constraintsManager.removeRequirementKey(def.requirement);
        }
        definitions.unregister("resolver", id);
      },
      call: (
        id: string,
        requirement: { type: string; [key: string]: unknown },
      ) => definitions.call("resolver", id, requirement) as Promise<void>,
      isDynamic: (id: string) => definitions.isDynamic("resolver", id),
      listDynamic: () => definitions.listDynamic("resolver"),
    },

    get trace(): TraceEntry[] | null {
      return traceManager.getEntries();
    },

    initialize(): void {
      if (state.isInitialized) return;
      state.isInitializing = true;

      // Run module init functions (sets initial fact values)
      for (const module of config.modules) {
        if (module.init) {
          store.batch(() => {
            // biome-ignore lint/suspicious/noExplicitAny: Engine internal type coercion
            module.init!(facts as any);
          });
        }
      }

      // Apply initialFacts/hydrate via callback
      // This ensures initialFacts are applied AFTER module init but BEFORE reconcile
      if (config.onAfterModuleInit) {
        store.batch(() => {
          config.onAfterModuleInit!();
        });
      }

      state.isInitializing = false;
      state.isInitialized = true;

      // Eagerly compute all derivations so they're cached before any
      // external read (e.g. React's useSyncExternalStore). Without this,
      // derivations can evaluate against uninitialized facts.
      for (const id of Object.keys(mergedDerive)) {
        derivationsManager.get(id as keyof DerivationsDef<S>);
      }
    },

    start(): void {
      if (state.isRunning) return;

      // Ensure facts are initialized (no-op if already called)
      if (!state.isInitialized) {
        this.initialize();
      }

      state.isRunning = true;

      // Module onStart hooks (may access browser APIs — only in start())
      for (const module of config.modules) {
        // biome-ignore lint/suspicious/noExplicitAny: Engine internal type coercion
        module.hooks?.onStart?.(system as any);
      }

      // Emit start event
      pluginManager.emitStart(system);

      // Start retry-later polling timer if configured
      if (config.errorBoundary?.retryLater && !retryLaterTimer) {
        const intervalMs = Math.max(
          config.errorBoundary.retryLater.delayMs ?? 1000,
          250,
        );

        retryLaterTimer = setInterval(
          () => {
            const dueRetries = errorBoundary.processDueRetries();

            for (const entry of dueRetries) {
              if (entry.callback) {
                entry.callback();
              } else {
                scheduleReconcile();
              }
            }
          },
          Math.min(intervalMs, 500),
        );
      }

      // Initial reconcile (now that all modules are initialized)
      scheduleReconcile();
    },

    stop(): void {
      if (!state.isRunning) return;
      state.isRunning = false;

      // Stop retry-later timer
      if (retryLaterTimer !== null) {
        clearInterval(retryLaterTimer);
        retryLaterTimer = null;
      }
      errorBoundary.getRetryLaterManager().clearAll();

      // Cancel all resolvers
      resolversManager.cancelAll();

      // Run all effect cleanups
      effectsManager.cleanupAll();

      // Call module hooks
      for (const module of config.modules) {
        module.hooks?.onStop?.(system);
      }

      // Emit stop event
      pluginManager.emitStop(system);
    },

    destroy(): void {
      if (state.isDestroyed) return;
      this.stop();
      state.isDestroyed = true;
      // Clean up store listeners
      (store as unknown as Record<string, () => void>).destroy?.();
      // Clean up resolvers (statuses, caches)
      resolversManager.destroy();
      // Clean up error boundary
      errorBoundary.clearErrors();
      settlementListeners.clear();
      historyListeners.clear();
      // Clean up trace state (C1)
      traceManager.destroy();
      // Clean up dynamic definition state
      definitions.destroy();
      pluginManager.emitDestroy(system);
    },

    dispatch(event: SystemEvent): void {
      if (BLOCKED_PROPS.has(event.type)) return;
      dispatchEventByName(event.type, event as Record<string, unknown>);
    },

    read<T = unknown>(derivationId: string): T {
      return derivationsManager.get(
        derivationId as keyof DerivationsDef<S>,
      ) as T;
    },

    subscribe(ids: string[], listener: () => void): () => void {
      const derivationIds: string[] = [];
      const factKeys: string[] = [];

      for (const id of ids) {
        if (id in mergedDerive) {
          derivationIds.push(id);
        } else if (id in mergedSchema) {
          factKeys.push(id);
        } else if (process.env.NODE_ENV !== "production") {
          console.warn(`[Directive] subscribe: unknown key "${id}"`);
        }
      }

      const unsubs: Array<() => void> = [];
      if (derivationIds.length > 0) {
        unsubs.push(
          derivationsManager.subscribe(
            derivationIds as Array<keyof DerivationsDef<S>>,
            listener,
          ),
        );
      }
      if (factKeys.length > 0) {
        unsubs.push(
          store.subscribe(factKeys as Array<keyof InferSchema<S>>, listener),
        );
      }

      return () => {
        for (const u of unsubs) u();
      };
    },

    watch<T = unknown>(
      id: string,
      callback: (newValue: T, previousValue: T | undefined) => void,
      options?: { equalityFn?: (a: T, b: T | undefined) => boolean },
    ): () => void {
      const isEqual = options?.equalityFn
        ? (a: T, b: T | undefined) => options.equalityFn!(a, b)
        : (a: T, b: T | undefined) => Object.is(a, b);

      if (id in mergedDerive) {
        // Derivation path
        let previousValue: T | undefined = derivationsManager.get(
          id as keyof DerivationsDef<S>,
        ) as T | undefined;

        return derivationsManager.subscribe(
          [id as keyof DerivationsDef<S>],
          () => {
            const newValue = derivationsManager.get(
              id as keyof DerivationsDef<S>,
            ) as T;
            if (!isEqual(newValue, previousValue)) {
              const oldValue = previousValue;
              previousValue = newValue;
              callback(newValue, oldValue);
            }
          },
        );
      }

      // Fact path
      if (process.env.NODE_ENV !== "production") {
        if (!(id in mergedSchema)) {
          console.warn(`[Directive] watch: unknown key "${id}"`);
        }
      }
      let prev = store.get(id as keyof InferSchema<S>) as T | undefined;
      return store.subscribe([id as keyof InferSchema<S>], () => {
        const next = store.get(id as keyof InferSchema<S>) as T;
        if (!isEqual(next, prev)) {
          const old = prev;
          prev = next;
          callback(next, old);
        }
      });
    },

    when(
      predicate: (facts: Record<string, unknown>) => boolean,
      options?: { timeout?: number },
    ): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        // Check immediately
        const factsObj = store.toObject();
        if (predicate(factsObj)) {
          resolve();
          return;
        }

        let unsub: (() => void) | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const cleanup = () => {
          unsub?.();
          if (timer !== undefined) clearTimeout(timer);
        };

        // Subscribe to all fact changes
        unsub = store.subscribeAll(() => {
          const current = store.toObject();
          if (predicate(current)) {
            cleanup();
            resolve();
          }
        });

        // Timeout
        if (options?.timeout !== undefined && options.timeout > 0) {
          timer = setTimeout(() => {
            cleanup();
            reject(
              new Error(
                `[Directive] when: timed out after ${options.timeout}ms`,
              ),
            );
          }, options.timeout);
        }
      });
    },

    inspect(): SystemInspection {
      return {
        unmet: state.previousRequirements.all(),
        inflight: resolversManager.getInflightInfo(),
        constraints: constraintsManager.getAllStates().map((s) => ({
          id: s.id,
          active: s.lastResult ?? false,
          disabled: constraintsManager.isDisabled(s.id),
          priority: s.priority,
          hitCount: s.hitCount,
          lastActiveAt: s.lastActiveAt,
        })),
        resolvers: Object.fromEntries(
          resolversManager
            .getInflight()
            .map((id) => [id, resolversManager.getStatus(id)]),
        ),
        resolverDefs: Object.entries(mergedResolvers).map(([id, def]) => ({
          id,
          requirement:
            typeof def.requirement === "string"
              ? def.requirement
              : "(predicate)",
        })),
        traceEnabled,
        ...(traceEnabled
          ? { trace: structuredClone(traceManager.getEntries() ?? []) }
          : {}),
      };
    },

    explain(requirementId: string): string | null {
      // Find the requirement in current unmet requirements
      const requirements = state.previousRequirements.all();
      const req = requirements.find((r) => r.id === requirementId);

      if (!req) {
        return null;
      }

      const constraintState = constraintsManager.getState(req.fromConstraint);
      const resolverStatus = resolversManager.getStatus(requirementId);

      // Get relevant facts from the constraint's tracked dependencies
      const relevantFacts: Record<string, unknown> = {};
      const constraintDeps = constraintsManager.getDependencies(
        req.fromConstraint,
      );
      if (constraintDeps) {
        for (const key of constraintDeps) {
          relevantFacts[key] = store.get(key);
        }
      } else {
        // Fallback: include all facts if deps not tracked
        for (const [key, value] of Object.entries(store.toObject())) {
          relevantFacts[key] = value;
        }
      }

      const lines: string[] = [
        `Requirement "${req.requirement.type}" (id: ${req.id})`,
        `├─ Produced by constraint: ${req.fromConstraint}`,
        `├─ Constraint priority: ${constraintState?.priority ?? 0}`,
        `├─ Constraint active: ${constraintState?.lastResult ?? "unknown"}`,
        `├─ Resolver status: ${resolverStatus.state}`,
      ];

      // Add requirement details
      const reqDetails = Object.entries(req.requirement)
        .filter(([k]) => k !== "type")
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
      if (reqDetails) {
        lines.push(`├─ Requirement payload: { ${reqDetails} }`);
      }

      // Add relevant facts (limit to prevent huge output)
      const factEntries = Object.entries(relevantFacts).slice(0, 10);
      if (factEntries.length > 0) {
        lines.push("└─ Relevant facts:");
        factEntries.forEach(([k, v], i) => {
          const prefix = i === factEntries.length - 1 ? "   └─" : "   ├─";
          const valueStr =
            typeof v === "object" ? JSON.stringify(v) : String(v);
          lines.push(
            `${prefix} ${k} = ${valueStr.slice(0, 50)}${valueStr.length > 50 ? "..." : ""}`,
          );
        });
      }

      return lines.join("\n");
    },

    getOriginal(
      type: "constraint" | "resolver" | "derivation" | "effect",
      id: string,
    ): unknown | undefined {
      return definitions.getOriginal(type, id);
    },

    restoreOriginal(
      type: "constraint" | "resolver" | "derivation" | "effect",
      id: string,
    ): boolean {
      return definitions.restoreOriginal(type, id);
    },

    async settle(maxWait = 5000): Promise<void> {
      /** Check if the system is fully settled */
      const isSettled = (): boolean =>
        resolversManager.getInflightCount() === 0 &&
        !state.isReconciling &&
        !state.reconcileScheduled &&
        !resolversManager.hasPendingBatches();

      // Flush pending batches and yield once for microtasks
      if (resolversManager.hasPendingBatches()) {
        resolversManager.processBatches();
      }
      await new Promise<void>((resolve) => queueMicrotask(resolve));

      if (isSettled()) {
        return;
      }

      // Event-driven: resolve when settlement state changes
      return new Promise<void>((resolve, reject) => {
        let done = false;

        const cleanup = () => {
          if (done) {
            return;
          }
          done = true;
          clearTimeout(timeout);
          unsubscribe();
        };

        const timeout = setTimeout(() => {
          cleanup();
          const details: string[] = [];
          const inflight = resolversManager.getInflightInfo();
          if (inflight.length > 0) {
            details.push(
              `${inflight.length} resolvers inflight: ${inflight.map((r) => r.resolverId).join(", ")}`,
            );
          }
          if (state.isReconciling) {
            details.push("reconciliation in progress");
          }
          if (state.reconcileScheduled) {
            details.push("reconcile scheduled");
          }
          const unmet = state.previousRequirements.all();
          if (unmet.length > 0) {
            details.push(
              `${unmet.length} unmet requirements: ${unmet.map((r) => r.requirement.type).join(", ")}`,
            );
          }
          reject(
            new Error(
              `[Directive] settle() timed out after ${maxWait}ms. ${details.join("; ")}`,
            ),
          );
        }, maxWait);

        const unsubscribe = this.onSettledChange(() => {
          if (resolversManager.hasPendingBatches()) {
            resolversManager.processBatches();
          }
          // Yield a microtask to let pending reconciles complete
          queueMicrotask(() => {
            if (!done && isSettled()) {
              cleanup();
              resolve();
            }
          });
        });
      });
    },

    getSnapshot() {
      return {
        facts: store.toObject(),
        version: 1,
      };
    },

    getDistributableSnapshot<T = Record<string, unknown>>(
      options: {
        includeDerivations?: string[];
        excludeDerivations?: string[];
        includeFacts?: string[];
        ttlSeconds?: number;
        metadata?: Record<string, unknown>;
        includeVersion?: boolean;
      } = {},
    ): {
      data: T;
      createdAt: number;
      expiresAt?: number;
      version?: string;
      metadata?: Record<string, unknown>;
    } {
      const {
        includeDerivations,
        excludeDerivations,
        includeFacts,
        ttlSeconds,
        metadata,
        includeVersion,
      } = options;

      const data: Record<string, unknown> = {};

      // Collect derivation keys to include
      const allDerivationKeys = Object.keys(mergedDerive);
      const allDerivationSet = new Set(allDerivationKeys);
      let derivationKeys: string[];

      if (includeDerivations) {
        // Only include specified derivations (Set lookup: O(1) per key)
        derivationKeys = includeDerivations.filter((k) =>
          allDerivationSet.has(k),
        );

        // Warn about unknown derivation keys in dev mode
        if (process.env.NODE_ENV !== "production") {
          const unknown = includeDerivations.filter(
            (k) => !allDerivationSet.has(k),
          );
          if (unknown.length > 0) {
            console.warn(
              `[Directive] getDistributableSnapshot: Unknown derivation keys ignored: ${unknown.join(", ")}. ` +
                `Available: ${allDerivationKeys.join(", ") || "(none)"}`,
            );
          }
        }
      } else {
        // Include all derivations by default
        derivationKeys = allDerivationKeys;
      }

      // Apply exclusions
      if (excludeDerivations) {
        const excludeSet = new Set(excludeDerivations);
        derivationKeys = derivationKeys.filter((k) => !excludeSet.has(k));
      }

      // Read derivation values
      for (const key of derivationKeys) {
        try {
          data[key] = derivationsManager.get(key as keyof DerivationsDef<S>);
        } catch (error) {
          // Skip derivations that error during computation
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[Directive] getDistributableSnapshot: Skipping derivation "${key}" due to error:`,
              error,
            );
          }
        }
      }

      // Include specified facts
      if (includeFacts && includeFacts.length > 0) {
        const factsSnapshot = store.toObject();
        const allFactKeys = Object.keys(factsSnapshot);

        // Warn about unknown fact keys in dev mode
        if (process.env.NODE_ENV !== "production") {
          const unknown = includeFacts.filter((k) => !(k in factsSnapshot));
          if (unknown.length > 0) {
            console.warn(
              `[Directive] getDistributableSnapshot: Unknown fact keys ignored: ${unknown.join(", ")}. ` +
                `Available: ${allFactKeys.join(", ") || "(none)"}`,
            );
          }
        }

        for (const key of includeFacts) {
          if (key in factsSnapshot) {
            data[key] = factsSnapshot[key];
          }
        }
      }

      // Build the snapshot
      const createdAt = Date.now();
      const snapshot: {
        data: T;
        createdAt: number;
        expiresAt?: number;
        version?: string;
        metadata?: Record<string, unknown>;
      } = {
        data: data as T,
        createdAt,
      };

      // Add TTL
      if (ttlSeconds !== undefined && ttlSeconds > 0) {
        snapshot.expiresAt = createdAt + ttlSeconds * 1000;
      }

      // Add version hash
      if (includeVersion) {
        // Simple version hash based on data content
        snapshot.version = hashObject(data);
      }

      // Add metadata
      if (metadata) {
        snapshot.metadata = metadata;
      }

      return snapshot;
    },

    watchDistributableSnapshot<T = Record<string, unknown>>(
      options: {
        includeDerivations?: string[];
        excludeDerivations?: string[];
        includeFacts?: string[];
        ttlSeconds?: number;
        metadata?: Record<string, unknown>;
        includeVersion?: boolean;
      },
      callback: (snapshot: {
        data: T;
        createdAt: number;
        expiresAt?: number;
        version?: string;
        metadata?: Record<string, unknown>;
      }) => void,
    ): () => void {
      const { includeDerivations, excludeDerivations } = options;

      // Determine which derivations to watch
      const allDerivationKeys = Object.keys(mergedDerive);
      let derivationKeys: string[];

      if (includeDerivations) {
        derivationKeys = includeDerivations.filter((k) =>
          allDerivationKeys.includes(k),
        );
      } else {
        derivationKeys = allDerivationKeys;
      }

      if (excludeDerivations) {
        const excludeSet = new Set(excludeDerivations);
        derivationKeys = derivationKeys.filter((k) => !excludeSet.has(k));
      }

      if (derivationKeys.length === 0) {
        // Nothing to watch, return no-op unsubscribe
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            "[Directive] watchDistributableSnapshot: No derivations to watch. " +
              "Callback will never be called.",
          );
        }
        return () => {};
      }

      // Get initial snapshot to seed version and ensure derivations are computed
      // (derivations must be computed before subscribing so listeners are called on invalidation)
      const initialSnapshot = this.getDistributableSnapshot<T>({
        ...options,
        includeVersion: true,
      });
      let previousVersion = initialSnapshot.version;

      // Subscribe to all watched derivations
      return derivationsManager.subscribe(
        derivationKeys as Array<keyof DerivationsDef<S>>,
        () => {
          // Generate a new snapshot
          const snapshot = this.getDistributableSnapshot<T>({
            ...options,
            // Always include version for change detection
            includeVersion: true,
          });

          // Only call callback if snapshot actually changed
          if (snapshot.version !== previousVersion) {
            previousVersion = snapshot.version;
            callback(snapshot);
          }
        },
      );
    },

    restore(snapshot) {
      if (!snapshot || typeof snapshot !== "object") {
        throw new Error(
          "[Directive] restore() requires a valid snapshot object",
        );
      }
      if (!snapshot.facts || typeof snapshot.facts !== "object") {
        throw new Error(
          "[Directive] restore() snapshot must have a facts object",
        );
      }

      // Security: Validate snapshot for prototype pollution
      if (!isPrototypeSafe(snapshot)) {
        throw new Error(
          "[Directive] restore() rejected: snapshot contains potentially dangerous keys " +
            "(__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
        );
      }

      store.batch(() => {
        for (const [key, value] of Object.entries(snapshot.facts)) {
          // Skip dangerous keys (defense in depth)
          if (BLOCKED_PROPS.has(key)) continue;
          store.set(
            key as keyof InferSchema<S>,
            value as InferSchema<S>[keyof InferSchema<S>],
          );
        }
      });
    },

    onSettledChange(listener: () => void): () => void {
      settlementListeners.add(listener);
      return () => {
        settlementListeners.delete(listener);
      };
    },

    onHistoryChange(listener: () => void): () => void {
      historyListeners.add(listener);
      return () => {
        historyListeners.delete(listener);
      };
    },

    batch(fn: () => void): void {
      store.batch(fn);
    },

    get isSettled(): boolean {
      return (
        resolversManager.getInflightCount() === 0 &&
        !resolversManager.hasPendingBatches() &&
        !state.isReconciling &&
        !state.reconcileScheduled
      );
    },

    get isRunning(): boolean {
      return state.isRunning;
    },

    get isInitialized(): boolean {
      return state.isInitialized;
    },

    get isReady(): boolean {
      return state.isReady;
    },

    whenReady(): Promise<void> {
      // If already ready, resolve immediately
      if (state.isReady) {
        return Promise.resolve();
      }

      // If not running, the promise would never resolve
      if (!state.isRunning) {
        return Promise.reject(
          new Error(
            "[Directive] whenReady() called before start(). " +
              "Call system.start() first, then await system.whenReady().",
          ),
        );
      }

      // Create promise if not exists
      if (!state.readyPromise) {
        state.readyPromise = new Promise<void>((resolve) => {
          state.readyResolve = resolve;
        });
      }

      return state.readyPromise;
    },
  };

  /**
   * Register a new module into a running (or stopped) engine.
   * Merges the module's schema, events, derive, effects, constraints, and resolvers
   * into the existing engine state, runs init, and triggers reconciliation.
   */
  function registerModule(module: {
    id: string;
    schema: Record<string, unknown>;
    requirements?: Record<string, unknown>;
    init?: (facts: unknown) => void;
    derive?: Record<string, (facts: unknown, derived: unknown) => unknown>;
    events?: Record<string, (facts: unknown, event: unknown) => void>;
    effects?: Record<string, unknown>;
    constraints?: Record<string, unknown>;
    resolvers?: Record<string, unknown>;
    hooks?: {
      onInit?: (s: unknown) => void;
      onStart?: (s: unknown) => void;
      onStop?: (s: unknown) => void;
      onError?: (e: unknown, ctx: unknown) => void;
    };
    history?: { snapshotEvents?: string[] };
  }): void {
    // Guard: cannot register during reconciliation (would corrupt iteration state)
    if (state.isReconciling) {
      throw new Error(
        `[Directive] Cannot register module "${module.id}" during reconciliation. ` +
          "Wait for the current reconciliation cycle to complete.",
      );
    }

    // Guard: cannot register on a destroyed system
    if (state.isDestroyed) {
      throw new Error(
        `[Directive] Cannot register module "${module.id}" on a destroyed system.`,
      );
    }

    // Security: validate keys
    const validateKeys = (obj: object | undefined, section: string) => {
      if (!obj) return;
      for (const key of Object.keys(obj)) {
        if (BLOCKED_PROPS.has(key)) {
          throw new Error(
            `[Directive] Security: Module "${module.id}" has dangerous key "${key}" in ${section}.`,
          );
        }
        if (section === "schema" && key.startsWith("$")) {
          throw new Error(
            `[Directive] Module "${module.id}" has schema key "${key}" starting with "$". ` +
              "Keys starting with $ are reserved for internal accessors ($store, $snapshot).",
          );
        }
      }
    };
    validateKeys(module.schema, "schema");
    validateKeys(module.events, "events");
    validateKeys(module.derive, "derive");
    validateKeys(module.effects, "effects");
    validateKeys(module.constraints, "constraints");
    validateKeys(module.resolvers, "resolvers");

    // Schema collision detection (unconditional — production collision would cause data corruption)
    for (const key of Object.keys(module.schema)) {
      if (key in mergedSchema) {
        throw new Error(
          `[Directive] Schema collision: Fact "${key}" already exists. Cannot register module "${module.id}".`,
        );
      }
    }
    // Fact/derivation name collision check (dev-only warning)
    if (process.env.NODE_ENV !== "production" && module.derive) {
      const existingFactKeys = new Set(Object.keys(mergedSchema));
      for (const key of Object.keys(module.derive)) {
        if (existingFactKeys.has(key)) {
          console.warn(
            `[Directive] "${key}" exists as both a fact and a derivation after registering module "${module.id}".`,
          );
        }
      }
    }

    // Update snapshotEventNames BEFORE merging events so we capture pre-merge state
    if (module.history?.snapshotEvents) {
      if (snapshotEventNames === null) {
        // First module with history.snapshotEvents — initialize the set with all existing event names
        snapshotEventNames = new Set<string>(Object.keys(mergedEvents));
      }
      for (const eventName of module.history.snapshotEvents) {
        snapshotEventNames.add(eventName);
      }
    } else if (snapshotEventNames !== null && module.events) {
      // Filtering is active and this module has no filter — add all its events
      for (const eventName of Object.keys(module.events)) {
        snapshotEventNames.add(eventName);
      }
    }

    // Merge into existing engine state
    Object.assign(mergedSchema, module.schema);
    if (module.events) Object.assign(mergedEvents, module.events);
    if (module.derive) {
      Object.assign(mergedDerive, module.derive);
      // Register new derivations with the derivations manager
      derivationsManager.registerDefinitions(
        module.derive as DerivationsDef<S>,
      );
    }
    if (module.effects) {
      Object.assign(mergedEffects, module.effects);
      // biome-ignore lint/suspicious/noExplicitAny: Dynamic module registration
      effectsManager.registerDefinitions(module.effects as any);
    }
    if (module.constraints) {
      Object.assign(mergedConstraints, module.constraints);
      // biome-ignore lint/suspicious/noExplicitAny: Dynamic module registration
      constraintsManager.registerDefinitions(module.constraints as any);
    }
    if (module.resolvers) {
      Object.assign(mergedResolvers, module.resolvers);
      // biome-ignore lint/suspicious/noExplicitAny: Dynamic module registration
      resolversManager.registerDefinitions(module.resolvers as any);
      // Sync resolver key functions to the constraints manager
      syncResolverKeys(module.resolvers as ResolversDef<S>);
    }

    // Register new schema keys with the facts store
    // biome-ignore lint/suspicious/noExplicitAny: Internal dynamic method
    (store as any).registerKeys(module.schema as Record<string, unknown>);

    // Track the new module in config.modules for hooks
    config.modules.push(module as (typeof config.modules)[number]);

    // Run init within a batch
    if (module.init) {
      store.batch(() => {
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic module init
        module.init!(facts as any);
      });
    }

    // Call lifecycle hooks
    module.hooks?.onInit?.(system);
    if (state.isRunning) {
      module.hooks?.onStart?.(system);
      // Trigger reconciliation to evaluate new constraints
      scheduleReconcile();
    }
  }

  // Attach registerModule to system
  (system as unknown as Record<string, unknown>).registerModule =
    registerModule;

  // Initialize plugins
  pluginManager.emitInit(system);

  // Call module init hooks
  for (const module of config.modules) {
    module.hooks?.onInit?.(system);
  }

  return system;
}
