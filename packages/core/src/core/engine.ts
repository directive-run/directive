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
  type TimeTravelManager,
  createDisabledTimeTravel,
  createTimeTravelManager,
} from "../utils/time-travel.js";
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
  type ErrorBoundaryManager,
  createErrorBoundaryManager,
} from "./errors.js";
import { createFacts } from "./facts.js";
import { type PluginManager, createPluginManager } from "./plugins.js";
import { RequirementSet } from "./requirements.js";
import { type ResolversManager, createResolversManager } from "./resolvers.js";

// Blocked properties for prototype pollution protection
const BLOCKED_PROPS = new Set(["__proto__", "constructor", "prototype"]);
import type {
  ConstraintsDef,
  DerivationsDef,
  EffectsDef,
  EventsDef,
  FactsSnapshot,
  InferSchema,
  ReconcileResult,
  ResolversDef,
  RunChangelogEntry,
  Schema,
  System,
  SystemConfig,
  SystemEvent,
  SystemInspection,
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
 * effects, constraints, resolvers, plugins, error boundaries, and time-travel
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
      }
    };
    validateKeys(module.schema, "schema");
    validateKeys(module.events, "events");
    validateKeys(module.derive, "derive");
    validateKeys(module.effects, "effects");
    validateKeys(module.constraints, "constraints");
    validateKeys(module.resolvers, "resolvers");

    // Check for schema collisions
    if (process.env.NODE_ENV !== "production") {
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
    }

    Object.assign(mergedSchema, module.schema);
    if (module.events) Object.assign(mergedEvents, module.events);
    if (module.derive) Object.assign(mergedDerive, module.derive);
    if (module.effects) Object.assign(mergedEffects, module.effects);
    if (module.constraints)
      Object.assign(mergedConstraints, module.constraints);
    if (module.resolvers) Object.assign(mergedResolvers, module.resolvers);
  }

  // Build snapshotEventNames: Set<string> | null
  // If any module declares snapshotEvents, build the filter set.
  // Modules WITHOUT snapshotEvents have all their events added (they still snapshot).
  let snapshotEventNames: Set<string> | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: Module may have snapshotEvents at runtime
  const hasAnySnapshotEvents = config.modules.some(
    (m: any) => m.snapshotEvents,
  );
  if (hasAnySnapshotEvents) {
    snapshotEventNames = new Set<string>();
    for (const module of config.modules) {
      // biome-ignore lint/suspicious/noExplicitAny: Module may have snapshotEvents at runtime
      const mod = module as any;
      if (mod.snapshotEvents) {
        for (const eventName of mod.snapshotEvents) {
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
  // Assigned after createTimeTravelManager() below.
  let timeTravelRef: TimeTravelManager<S> | null = null;

  // Run history (gated by debug.runHistory)
  const runHistoryEnabled = config.debug?.runHistory ?? false;
  const maxRuns = config.debug?.maxRuns ?? 100;
  const runHistory: RunChangelogEntry[] = [];
  const runHistoryById = new Map<number, RunChangelogEntry>();
  let runIdCounter = 0;
  let currentRun: RunChangelogEntry | null = null;
  const pendingFactChanges: Array<{
    key: string;
    oldValue: unknown;
    newValue: unknown;
  }> = [];
  // Async resolver attribution: requirementId → runId
  const resolverRunMap = new Map<string, number>();
  // Track inflight resolvers per run: runId → count of pending resolvers
  const runInflightCount = new Map<number, number>();
  // Consistent duration: track start time per run (performance.now() based)
  const runStartMs = new Map<number, number>();
  // Cached runHistory getter (E1): avoid spread on every access
  let runHistoryCache: RunChangelogEntry[] | null = null;
  let runHistoryCacheVersion = 0;
  let currentCacheVersion = 0;
  // Anomaly detection statistics
  const runStats = {
    count: 0,
    totalDuration: 0,
    avgDuration: 0,
    maxDuration: 0,
    avgResolverCount: 0,
    totalResolverCount: 0,
    avgFactChangeCount: 0,
    totalFactChangeCount: 0,
  };

  const { store, facts } = createFacts<S>({
    schema: mergedSchema,
    onChange: (key, value, prev) => {
      pluginManager.emitFactSet(key, value, prev);
      // Invalidate derivations so they recompute on read
      invalidateDerivation(key);
      // Track fact changes for run history
      if (runHistoryEnabled) {
        pendingFactChanges.push({
          key: String(key),
          oldValue: prev,
          newValue: value,
        });
      }
      // During time-travel restore, skip change tracking and reconciliation.
      // The restored state is already reconciled; re-reconciling would create
      // spurious snapshots that break undo/redo.
      if (timeTravelRef?.isRestoring) return;
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
      // Track fact changes for run history
      if (runHistoryEnabled) {
        for (const change of changes) {
          if (change.type === "delete") {
            pendingFactChanges.push({
              key: change.key,
              oldValue: change.prev,
              newValue: undefined,
            });
          } else {
            pendingFactChanges.push({
              key: change.key,
              oldValue: change.prev,
              newValue: change.value,
            });
          }
        }
      }
      // Invalidate all affected derivations at once — listeners fire only
      // after ALL keys are invalidated, so they see consistent state.
      invalidateManyDerivations(keys);
      // During time-travel restore, skip change tracking and reconciliation.
      if (timeTravelRef?.isRestoring) return;
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
    store,
    onCompute: (id, value, oldValue, deps) => {
      pluginManager.emitDerivationCompute(id, value, deps);
      if (currentRun) {
        currentRun.derivationsRecomputed.push({
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
      if (currentRun) {
        currentRun.effectsRun.push({
          id,
          triggeredBy: deps,
        });
      }
    },
    onError: (id, error) => {
      const strategy = errorBoundary.handleError("effect", id, error);
      pluginManager.emitEffectError(id, error);

      if (currentRun) {
        currentRun.effectErrors.push({ id, error: String(error) });
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

  // Create constraints manager
  const constraintsManager: ConstraintsManager<S> = createConstraintsManager({
    definitions: mergedConstraints,
    facts,
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

  /** Finalize a run when all its resolvers have settled */
  function finalizeRun(runId: number): void {
    const run = runHistoryById.get(runId);
    if (run && run.status === "pending") {
      run.status = "settled";
      // Consistent duration: use performance.now() when available
      const startMs = runStartMs.get(runId);
      run.duration =
        startMs !== undefined
          ? performance.now() - startMs
          : Date.now() - run.timestamp;
      runStartMs.delete(runId);
      runInflightCount.delete(runId);
      // Build causal chain on settlement
      run.causalChain = buildCausalChain(run);
      // Anomaly detection
      updateRunStats(run);
      currentCacheVersion++;
      pluginManager.emitRunComplete(run);
    }
  }

  /** Decrement inflight count for a run and finalize if settled */
  function decrementRunInflight(requirementId: string): void {
    const runId = resolverRunMap.get(requirementId);
    resolverRunMap.delete(requirementId);
    if (runId !== undefined) {
      const remaining = (runInflightCount.get(runId) ?? 1) - 1;
      if (remaining <= 0) {
        finalizeRun(runId);
      } else {
        runInflightCount.set(runId, remaining);
      }
    }
  }

  /** Evict the oldest run from the ring buffer, cleaning up associated state (C1) */
  function evictOldestRun(): void {
    const evicted = runHistory.shift();
    if (evicted) {
      runHistoryById.delete(evicted.id);
      runStartMs.delete(evicted.id);
      if (evicted.status === "pending") {
        runInflightCount.delete(evicted.id);
        for (const [reqId, rId] of resolverRunMap) {
          if (rId === evicted.id) {
            resolverRunMap.delete(reqId);
          }
        }
      }
    }
  }

  /** Build a human-readable causal chain summary from a run entry (Part 6) */
  function buildCausalChain(run: RunChangelogEntry): string {
    const parts: string[] = [];

    for (const fc of run.factChanges) {
      parts.push(`${fc.key} changed`);
    }

    for (const d of run.derivationsRecomputed) {
      parts.push(`${d.id} recomputed`);
    }

    for (const c of run.constraintsHit) {
      parts.push(`${c.id} constraint hit`);
    }

    for (const r of run.requirementsAdded) {
      parts.push(`${r.type} requirement added`);
    }

    for (const rs of run.resolversCompleted) {
      parts.push(`${rs.resolver} resolved (${rs.duration.toFixed(0)}ms)`);
    }

    for (const rs of run.resolversErrored) {
      parts.push(`${rs.resolver} errored`);
    }

    for (const e of run.effectsRun) {
      parts.push(`${e.id} effect ran`);
    }

    return parts.join(" → ");
  }

  /** Update running statistics and flag anomalies on a finalized run (Part 8) */
  function updateRunStats(run: RunChangelogEntry): void {
    runStats.count++;
    runStats.totalDuration += run.duration;
    runStats.avgDuration = runStats.totalDuration / runStats.count;
    if (run.duration > runStats.maxDuration) {
      runStats.maxDuration = run.duration;
    }

    const resolverCount = run.resolversStarted.length;
    runStats.totalResolverCount += resolverCount;
    runStats.avgResolverCount = runStats.totalResolverCount / runStats.count;

    const factChangeCount = run.factChanges.length;
    runStats.totalFactChangeCount += factChangeCount;
    runStats.avgFactChangeCount =
      runStats.totalFactChangeCount / runStats.count;

    // Flag anomalies (only after enough data)
    const anomalies: string[] = [];
    if (runStats.count > 3 && run.duration > runStats.avgDuration * 5) {
      anomalies.push(
        `Duration ${run.duration.toFixed(0)}ms is 5x+ above average (${runStats.avgDuration.toFixed(0)}ms)`,
      );
    }

    if (run.resolversErrored.length > 0) {
      anomalies.push(`${run.resolversErrored.length} resolver(s) errored`);
    }

    if (anomalies.length > 0) {
      run.anomalies = anomalies;
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
      // Attribute to the run that started this resolver
      if (runHistoryEnabled) {
        const runId = resolverRunMap.get(req.id);
        if (runId !== undefined) {
          const run = runHistoryById.get(runId);
          if (run) {
            run.resolversCompleted.push({
              resolver,
              requirementId: req.id,
              duration,
            });
          }
        }
        decrementRunInflight(req.id);
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

      // Attribute error to the run that started this resolver
      if (runHistoryEnabled) {
        const runId = resolverRunMap.get(req.id);
        if (runId !== undefined) {
          const run = runHistoryById.get(runId);
          if (run) {
            run.resolversErrored.push({
              resolver,
              requirementId: req.id,
              error: String(error),
            });
          }
        }
        decrementRunInflight(req.id);
      }
    },
    onRetry: (resolver, req, attempt) =>
      pluginManager.emitResolverRetry(resolver, req, attempt),
    onCancel: (resolver, req) => {
      pluginManager.emitResolverCancel(resolver, req);
      pluginManager.emitRequirementCanceled(req);
      // Decrement inflight for the run
      if (runHistoryEnabled) {
        decrementRunInflight(req.id);
      }
    },
    onResolutionComplete: () => {
      // After a resolver completes, schedule another reconcile
      notifySettlementChange();
      scheduleReconcile();
    },
  });

  // Time-travel listeners — notified when snapshot state changes
  const timeTravelListeners = new Set<() => void>();

  function notifyTimeTravelChange(): void {
    for (const listener of timeTravelListeners) {
      listener();
    }
  }

  // Create time-travel manager
  const timeTravelManager: TimeTravelManager<S> = config.debug?.timeTravel
    ? createTimeTravelManager({
        config: config.debug,
        facts,
        store,
        onSnapshot: (snapshot) => {
          pluginManager.emitSnapshot(snapshot);
          notifyTimeTravelChange();
        },
        onTimeTravel: (from, to) => {
          pluginManager.emitTimeTravel(from, to);
          notifyTimeTravelChange();
        },
      })
    : createDisabledTimeTravel();
  timeTravelRef = timeTravelManager;

  // Settlement listeners — notified when isSettled may have changed
  const settlementListeners = new Set<() => void>();

  function notifySettlementChange(): void {
    for (const listener of settlementListeners) {
      listener();
    }
  }

  // Reconcile depth guard — prevents runaway reconcile → scheduleReconcile chains
  const MAX_RECONCILE_DEPTH = 50;
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

  // ============================================================================
  // Dynamic Definition Infrastructure
  // ============================================================================

  /** Track which definitions were dynamically registered (not from module defs) */
  const dynamicIds = {
    constraints: new Set<string>(),
    resolvers: new Set<string>(),
    derivations: new Set<string>(),
    effects: new Set<string>(),
  };

  /** Originals map for assigned definitions (stores the definition that was overridden) */
  const originals = {
    constraints: new Map<string, unknown>(),
    resolvers: new Map<string, unknown>(),
    derivations: new Map<string, unknown>(),
    effects: new Map<string, unknown>(),
  };

  /** Reserved derive method names — derivation IDs cannot use these */
  const RESERVED_DERIVE_NAMES = new Set([
    "register", "assign", "unregister", "call", "isDynamic", "listDynamic",
  ]);

  type DefType = "constraint" | "resolver" | "derivation" | "effect";
  type DeferredOp =
    | { op: "register"; type: DefType; id: string; def: unknown }
    | { op: "assign"; type: DefType; id: string; def: unknown }
    | { op: "unregister"; type: DefType; id: string };

  /**
   * Deferred registrations queue — applied after reconcile settles.
   *
   * While operations are deferred (i.e. during reconciliation), isDynamic()
   * and listDynamic() will NOT reflect the pending registration/unregistration
   * until the deferred queue is flushed after the current cycle completes.
   */
  const deferredRegistrations: DeferredOp[] = [];

  /** Validate a definition ID for safety */
  function validateDefId(id: string): void {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(
        `[Directive] Definition ID must be a non-empty string. Received: ${String(id)}`,
      );
    }
    if (BLOCKED_PROPS.has(id)) {
      throw new Error(
        `[Directive] Security: Definition ID "${id}" is a blocked property.`,
      );
    }
    if (id.includes("::")) {
      throw new Error(
        `[Directive] Definition ID "${id}" cannot contain "::". This separator is reserved for namespacing.`,
      );
    }
  }

  /** Register a definition (called by engine, handles deferral) */
  function registerDefinition(type: DefType, id: string, def: unknown): void {
    if (state.isDestroyed) {
      throw new Error(
        `[Directive] Cannot register ${type} "${id}" on a destroyed system.`,
      );
    }

    validateDefId(id);

    // If reconciling, defer
    if (state.isReconciling) {
      deferredRegistrations.push({ op: "register", type, id, def });

      return;
    }

    applyRegister(type, id, def);
  }

  /** Assign (override) a definition */
  function assignDefinition(type: DefType, id: string, def: unknown): void {
    if (state.isDestroyed) {
      throw new Error(
        `[Directive] Cannot assign ${type} "${id}" on a destroyed system.`,
      );
    }

    validateDefId(id);

    if (state.isReconciling) {
      deferredRegistrations.push({ op: "assign", type, id, def });

      return;
    }

    applyAssign(type, id, def);
  }

  /** Unregister a definition */
  function unregisterDefinition(type: DefType, id: string): void {
    if (state.isDestroyed) {
      throw new Error(
        `[Directive] Cannot unregister ${type} "${id}" on a destroyed system.`,
      );
    }

    validateDefId(id);

    if (state.isReconciling) {
      deferredRegistrations.push({ op: "unregister", type, id });

      return;
    }

    applyUnregister(type, id);
  }

  /** Call/invoke a definition */
  function callDefinition(type: DefType, id: string, props?: unknown): unknown {
    if (state.isDestroyed) {
      throw new Error(
        `[Directive] Cannot call ${type} "${id}" on a destroyed system.`,
      );
    }

    validateDefId(id);
    pluginManager.emitDefinitionCall(type, id, props);

    switch (type) {
      case "constraint":
        return constraintsManager.callOne(id, props as Record<string, unknown> | undefined);
      case "resolver":
        return resolversManager.callOne(id, props as { type: string; [key: string]: unknown });
      case "derivation":
        return derivationsManager.callOne(id);
      case "effect":
        return effectsManager.callOne(id);
    }
  }

  /** Apply a register operation immediately */
  function applyRegister(type: DefType, id: string, def: unknown): void {
    switch (type) {
      case "constraint": {
        if (id in mergedConstraints) {
          throw new Error(
            `[Directive] Constraint "${id}" already exists. Use assign() to override.`,
          );
        }
        const constraintDef = def as Record<string, unknown>;
        (mergedConstraints as Record<string, unknown>)[id] = constraintDef;
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic registration
        constraintsManager.registerDefinitions({ [id]: constraintDef } as any);
        dynamicIds.constraints.add(id);
        pluginManager.emitDefinitionRegister(type, id, def);
        scheduleReconcile();
        break;
      }
      case "resolver": {
        if (id in mergedResolvers) {
          throw new Error(
            `[Directive] Resolver "${id}" already exists. Use assign() to override.`,
          );
        }
        const resolverDef = def as Record<string, unknown>;
        (mergedResolvers as Record<string, unknown>)[id] = resolverDef;
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic registration
        resolversManager.registerDefinitions({ [id]: resolverDef } as any);
        dynamicIds.resolvers.add(id);
        pluginManager.emitDefinitionRegister(type, id, def);
        scheduleReconcile();
        break;
      }
      case "derivation": {
        if (RESERVED_DERIVE_NAMES.has(id)) {
          throw new Error(
            `[Directive] Derivation ID "${id}" conflicts with a reserved derive method name.`,
          );
        }
        if (id in mergedDerive) {
          throw new Error(
            `[Directive] Derivation "${id}" already exists. Use assign() to override.`,
          );
        }
        (mergedDerive as Record<string, unknown>)[id] = def;
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic registration
        derivationsManager.registerDefinitions({ [id]: def } as any);
        dynamicIds.derivations.add(id);
        pluginManager.emitDefinitionRegister(type, id, def);
        break;
      }
      case "effect": {
        if (id in mergedEffects) {
          throw new Error(
            `[Directive] Effect "${id}" already exists. Use assign() to override.`,
          );
        }
        const effectDef = def as Record<string, unknown>;
        (mergedEffects as Record<string, unknown>)[id] = effectDef;
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic registration
        effectsManager.registerDefinitions({ [id]: effectDef } as any);
        dynamicIds.effects.add(id);
        pluginManager.emitDefinitionRegister(type, id, def);
        break;
      }
    }
  }

  /**
   * Apply an assign operation immediately.
   *
   * Ordering is important for atomicity: the manager's assignDefinition() is
   * called first (it may validate and throw, e.g. cycle detection). Only on
   * success do we commit the original and update the merged map.
   */
  function applyAssign(type: DefType, id: string, def: unknown): void {
    switch (type) {
      case "constraint": {
        if (!(id in mergedConstraints)) {
          throw new Error(
            `[Directive] Constraint "${id}" does not exist. Use register() to create it.`,
          );
        }
        const original = (mergedConstraints as Record<string, unknown>)[id];
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic assignment
        constraintsManager.assignDefinition(id, def as any);
        originals.constraints.set(id, original);
        (mergedConstraints as Record<string, unknown>)[id] = def;
        pluginManager.emitDefinitionAssign(type, id, def, original);
        scheduleReconcile();
        break;
      }
      case "resolver": {
        if (!(id in mergedResolvers)) {
          throw new Error(
            `[Directive] Resolver "${id}" does not exist. Use register() to create it.`,
          );
        }
        const original = (mergedResolvers as Record<string, unknown>)[id];
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic assignment
        resolversManager.assignDefinition(id, def as any);
        originals.resolvers.set(id, original);
        (mergedResolvers as Record<string, unknown>)[id] = def;
        pluginManager.emitDefinitionAssign(type, id, def, original);
        scheduleReconcile();
        break;
      }
      case "derivation": {
        if (RESERVED_DERIVE_NAMES.has(id)) {
          throw new Error(
            `[Directive] Derivation ID "${id}" conflicts with a reserved derive method name.`,
          );
        }
        if (!(id in mergedDerive)) {
          throw new Error(
            `[Directive] Derivation "${id}" does not exist. Use register() to create it.`,
          );
        }
        const original = (mergedDerive as Record<string, unknown>)[id];
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic assignment
        derivationsManager.assignDefinition(id, def as any);
        originals.derivations.set(id, original);
        (mergedDerive as Record<string, unknown>)[id] = def;
        pluginManager.emitDefinitionAssign(type, id, def, original);
        break;
      }
      case "effect": {
        if (!(id in mergedEffects)) {
          throw new Error(
            `[Directive] Effect "${id}" does not exist. Use register() to create it.`,
          );
        }
        const original = (mergedEffects as Record<string, unknown>)[id];
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic assignment
        effectsManager.assignDefinition(id, def as any);
        originals.effects.set(id, original);
        (mergedEffects as Record<string, unknown>)[id] = def;
        pluginManager.emitDefinitionAssign(type, id, def, original);
        break;
      }
    }
  }

  /** Apply an unregister operation immediately */
  function applyUnregister(type: DefType, id: string): void {
    switch (type) {
      case "constraint": {
        if (!dynamicIds.constraints.has(id)) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[Directive] Cannot unregister static constraint "${id}". Only dynamically registered constraints can be removed.`,
            );
          }

          return;
        }
        constraintsManager.unregisterDefinition(id);
        delete (mergedConstraints as Record<string, unknown>)[id];
        dynamicIds.constraints.delete(id);
        originals.constraints.delete(id);
        pluginManager.emitDefinitionUnregister(type, id);
        scheduleReconcile();
        break;
      }
      case "resolver": {
        if (!dynamicIds.resolvers.has(id)) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[Directive] Cannot unregister static resolver "${id}". Only dynamically registered resolvers can be removed.`,
            );
          }

          return;
        }
        resolversManager.unregisterDefinition(id);
        delete (mergedResolvers as Record<string, unknown>)[id];
        dynamicIds.resolvers.delete(id);
        originals.resolvers.delete(id);
        pluginManager.emitDefinitionUnregister(type, id);
        break;
      }
      case "derivation": {
        if (!dynamicIds.derivations.has(id)) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[Directive] Cannot unregister static derivation "${id}". Only dynamically registered derivations can be removed.`,
            );
          }

          return;
        }
        derivationsManager.unregisterDefinition(id);
        delete (mergedDerive as Record<string, unknown>)[id];
        dynamicIds.derivations.delete(id);
        originals.derivations.delete(id);
        pluginManager.emitDefinitionUnregister(type, id);
        break;
      }
      case "effect": {
        if (!dynamicIds.effects.has(id)) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[Directive] Cannot unregister static effect "${id}". Only dynamically registered effects can be removed.`,
            );
          }

          return;
        }
        effectsManager.unregisterDefinition(id);
        delete (mergedEffects as Record<string, unknown>)[id];
        dynamicIds.effects.delete(id);
        originals.effects.delete(id);
        pluginManager.emitDefinitionUnregister(type, id);
        break;
      }
    }
  }

  /** Flush deferred registrations after reconcile settles */
  function flushDeferredRegistrations(): void {
    if (deferredRegistrations.length === 0) {
      return;
    }

    const ops = deferredRegistrations.splice(0);
    for (const op of ops) {
      try {
        switch (op.op) {
          case "register":
            applyRegister(op.type, op.id, op.def);
            break;
          case "assign":
            applyAssign(op.type, op.id, op.def);
            break;
          case "unregister":
            applyUnregister(op.type, op.id);
            break;
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            `[Directive] Error in deferred ${op.op} for ${op.type} "${op.id}":`,
            error,
          );
        }
      }
    }
  }

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
      // Drain pending fact changes so they don't leak into the next run (M4)
      if (runHistoryEnabled) {
        pendingFactChanges.length = 0;
      }
      reconcileDepth = 0;
      return;
    }

    state.isReconciling = true;
    notifySettlementChange();

    const reconcileStartMs = runHistoryEnabled ? performance.now() : 0;

    // Start a new run entry
    if (runHistoryEnabled) {
      const runId = ++runIdCounter;
      runStartMs.set(runId, reconcileStartMs);
      currentRun = {
        id: runId,
        timestamp: Date.now(),
        duration: 0,
        status: "pending",
        factChanges: pendingFactChanges.splice(0), // move + clear
        derivationsRecomputed: [],
        constraintsHit: [],
        requirementsAdded: [],
        requirementsRemoved: [],
        resolversStarted: [],
        resolversCompleted: [],
        resolversErrored: [],
        effectsRun: [],
        effectErrors: [],
      };
    }

    try {
      // Take snapshot before reconciliation (respects snapshotEvents filtering)
      if (state.changedKeys.size > 0) {
        if (snapshotEventNames === null || shouldTakeSnapshot) {
          timeTravelManager.takeSnapshot(
            `facts-changed:${[...state.changedKeys].join(",")}`,
          );
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

      // Capture which constraints produced requirements for run history
      if (currentRun) {
        const hitConstraintIds = new Set(
          currentRequirements.map((r) => r.fromConstraint),
        );
        for (const cId of hitConstraintIds) {
          const cState = constraintsManager.getState(cId);
          if (cState) {
            const cDeps = constraintsManager.getDependencies(cId);
            currentRun.constraintsHit.push({
              id: cId,
              priority: cState.priority,
              deps: cDeps ? [...cDeps] : [],
            });
          }
        }
      }

      // Diff with previous requirements
      const { added, removed } = currentSet.diff(state.previousRequirements);

      // Capture requirement diff for run history
      if (currentRun) {
        for (const req of added) {
          currentRun.requirementsAdded.push({
            id: req.id,
            type: req.requirement.type,
            fromConstraint: req.fromConstraint,
          });
        }
        for (const req of removed) {
          currentRun.requirementsRemoved.push({
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

      // Capture resolver starts for run history
      if (currentRun) {
        const inflightNow = resolversManager.getInflightInfo();
        for (const req of added) {
          const info = inflightNow.find((i) => i.id === req.id);
          currentRun.resolversStarted.push({
            resolver: info?.resolverId ?? "unknown",
            requirementId: req.id,
          });
          // Track attribution for async completion
          resolverRunMap.set(req.id, currentRun.id);
        }
      }

      // Update previous requirements
      state.previousRequirements = currentSet;

      // Build reconcile result
      const inflightInfo = resolversManager.getInflightInfo();
      const result: ReconcileResult = {
        unmet: currentRequirements.filter(
          (r) => !resolversManager.isResolving(r.id),
        ),
        inflight: inflightInfo,
        completed: [], // Completed resolvers are tracked separately via onComplete callback
        canceled: removed.map((r) => ({
          id: r.id,
          resolverId:
            inflightInfo.find((i) => i.id === r.id)?.resolverId ?? "unknown",
        })),
      };

      pluginManager.emitReconcileEnd(result);

      // Mark system as ready after first successful reconcile
      if (!state.isReady) {
        state.isReady = true;
        if (state.readyResolve) {
          state.readyResolve();
          state.readyResolve = null;
        }
      }
    } finally {
      // Finalize the current run entry
      if (currentRun) {
        currentRun.duration = performance.now() - reconcileStartMs;

        // Skip empty runs
        const hasActivity =
          currentRun.factChanges.length > 0 ||
          currentRun.constraintsHit.length > 0 ||
          currentRun.requirementsAdded.length > 0 ||
          currentRun.effectsRun.length > 0;

        if (hasActivity) {
          const inflightCount = currentRun.resolversStarted.length;
          if (inflightCount === 0) {
            // No resolvers — finalize immediately
            currentRun.status = "settled";
            // Build causal chain for settled runs
            currentRun.causalChain = buildCausalChain(currentRun);
            // Anomaly detection
            updateRunStats(currentRun);
            runHistory.push(currentRun);
            runHistoryById.set(currentRun.id, currentRun);
            if (runHistory.length > maxRuns) {
              evictOldestRun();
            }
            currentCacheVersion++;
            pluginManager.emitRunComplete(currentRun);
          } else {
            // Has resolvers — stays pending until they settle
            currentRun.status = "pending";
            runHistory.push(currentRun);
            runHistoryById.set(currentRun.id, currentRun);
            if (runHistory.length > maxRuns) {
              evictOldestRun();
            }
            currentCacheVersion++;
            runInflightCount.set(currentRun.id, inflightCount);
          }
        } else {
          // Empty run — clean up start time
          runStartMs.delete(currentRun.id);
        }
        currentRun = null;
      }

      state.isReconciling = false;

      // Flush any deferred dynamic definition operations that were queued
      // during this reconciliation cycle
      flushDeferredRegistrations();

      // Schedule next reconcile BEFORE notifying settlement change,
      // so listeners never see a brief isSettled=true flash when
      // more changes are pending.
      if (state.changedKeys.size > 0) {
        scheduleReconcile();
      } else if (!state.reconcileScheduled) {
        // System has settled — reset depth counter
        reconcileDepth = 0;
      }

      notifySettlementChange();
    }
  }

  // Method properties for derive accessor (dynamic definitions API)
  const deriveMethods: Record<string, unknown> = {
    register: (id: string, fn: unknown) => registerDefinition("derivation", id, fn),
    assign: (id: string, fn: unknown) => assignDefinition("derivation", id, fn),
    unregister: (id: string) => unregisterDefinition("derivation", id),
    call: (id: string) => callDefinition("derivation", id),
    isDynamic: (id: string) => dynamicIds.derivations.has(id),
    listDynamic: () => [...dynamicIds.derivations],
  };

  // Create typed derive accessor using a Proxy
  const deriveAccessor = new Proxy({} as Record<string, unknown>, {
    get(_, prop: string | symbol) {
      if (typeof prop === "symbol") return undefined;
      // Prototype pollution protection
      if (BLOCKED_PROPS.has(prop)) return undefined;
      // Check for method properties first (register, assign, etc.)
      if (prop in deriveMethods) {
        return deriveMethods[prop];
      }
      return derivationsManager.get(prop as keyof DerivationsDef<S>);
    },
    has(_, prop: string | symbol) {
      if (typeof prop === "symbol") return false;
      // Prototype pollution protection
      if (BLOCKED_PROPS.has(prop)) return false;
      return prop in mergedDerive || prop in deriveMethods;
    },
    ownKeys() {
      return Object.keys(mergedDerive);
    },
    getOwnPropertyDescriptor(_, prop: string | symbol) {
      if (typeof prop === "symbol") return undefined;
      // Prototype pollution protection
      if (BLOCKED_PROPS.has(prop)) return undefined;
      if (prop in mergedDerive || prop in deriveMethods) {
        return { configurable: true, enumerable: true };
      }
      return undefined;
    },
  });

  // Create typed events accessor using a Proxy
  // This provides system.events.eventName(payload) syntax
  const eventsAccessor = new Proxy(
    {} as Record<string, (payload?: Record<string, unknown>) => void>,
    {
      get(_, prop: string | symbol) {
        if (typeof prop === "symbol") return undefined;
        // Prototype pollution protection
        if (BLOCKED_PROPS.has(prop)) return undefined;
        // Return a function that dispatches the event
        return (payload?: Record<string, unknown>) => {
          const handler = mergedEvents[prop];
          if (handler) {
            dispatchDepth++;
            if (snapshotEventNames === null || snapshotEventNames.has(prop)) {
              shouldTakeSnapshot = true;
            }
            try {
              store.batch(() => {
                handler(facts, { type: prop, ...payload });
              });
            } finally {
              dispatchDepth--;
            }
          } else if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[Directive] Unknown event type "${prop}". ` +
                "No handler is registered for this event. " +
                `Available events: ${Object.keys(mergedEvents).join(", ") || "(none)"}`,
            );
          }
        };
      },
      has(_, prop: string | symbol) {
        if (typeof prop === "symbol") return false;
        // Prototype pollution protection
        if (BLOCKED_PROPS.has(prop)) return false;
        return prop in mergedEvents;
      },
      ownKeys() {
        return Object.keys(mergedEvents);
      },
      getOwnPropertyDescriptor(_, prop: string | symbol) {
        if (typeof prop === "symbol") return undefined;
        // Prototype pollution protection
        if (BLOCKED_PROPS.has(prop)) return undefined;
        if (prop in mergedEvents) {
          return { configurable: true, enumerable: true };
        }
        return undefined;
      },
    },
  );

  // Create the system interface
  // biome-ignore lint/suspicious/noExplicitAny: Engine uses flat schema internally, public API uses ModuleSchema
  const system: System<any> = {
    facts,
    debug: timeTravelManager.isEnabled ? timeTravelManager : null,
    derive: deriveAccessor,
    events: eventsAccessor,
    constraints: {
      disable: (id: string) => constraintsManager.disable(id),
      enable: (id: string) => constraintsManager.enable(id),
      isDisabled: (id: string) => constraintsManager.isDisabled(id),
      register: (id: string, def: Record<string, unknown>) => registerDefinition("constraint", id, def),
      assign: (id: string, def: Record<string, unknown>) => assignDefinition("constraint", id, def),
      unregister: (id: string) => unregisterDefinition("constraint", id),
      call: (id: string, props?: Record<string, unknown>) => callDefinition("constraint", id, props) as Promise<Record<string, unknown>[]>,
      isDynamic: (id: string) => dynamicIds.constraints.has(id),
      listDynamic: () => [...dynamicIds.constraints],
    },
    effects: {
      disable: (id: string) => effectsManager.disable(id),
      enable: (id: string) => effectsManager.enable(id),
      isEnabled: (id: string) => effectsManager.isEnabled(id),
      register: (id: string, def: Record<string, unknown>) => registerDefinition("effect", id, def),
      assign: (id: string, def: Record<string, unknown>) => assignDefinition("effect", id, def),
      unregister: (id: string) => unregisterDefinition("effect", id),
      call: (id: string) => callDefinition("effect", id) as Promise<void>,
      isDynamic: (id: string) => dynamicIds.effects.has(id),
      listDynamic: () => [...dynamicIds.effects],
    },
    resolvers: {
      register: (id: string, def: Record<string, unknown>) => registerDefinition("resolver", id, def),
      assign: (id: string, def: Record<string, unknown>) => assignDefinition("resolver", id, def),
      unregister: (id: string) => unregisterDefinition("resolver", id),
      call: (id: string, requirement: { type: string; [key: string]: unknown }) => callDefinition("resolver", id, requirement) as Promise<void>,
      isDynamic: (id: string) => dynamicIds.resolvers.has(id),
      listDynamic: () => [...dynamicIds.resolvers],
    },

    get runHistory(): RunChangelogEntry[] | null {
      if (!runHistoryEnabled) {
        return null;
      }

      if (!runHistoryCache || runHistoryCacheVersion !== currentCacheVersion) {
        runHistoryCache = [...runHistory];
        runHistoryCacheVersion = currentCacheVersion;
      }

      return runHistoryCache;
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
      this.stop();
      state.isDestroyed = true;
      settlementListeners.clear();
      timeTravelListeners.clear();
      // Clean up deferred registrations (prevent closure retention)
      deferredRegistrations.length = 0;
      // Clean up run history state (C1)
      runHistory.length = 0;
      runHistoryById.clear();
      resolverRunMap.clear();
      runInflightCount.clear();
      runStartMs.clear();
      pendingFactChanges.length = 0;
      currentRun = null;
      runHistoryCache = null;
      pluginManager.emitDestroy(system);
    },

    dispatch(event: SystemEvent): void {
      if (BLOCKED_PROPS.has(event.type)) return;
      const handler = mergedEvents[event.type];
      if (handler) {
        dispatchDepth++;
        if (snapshotEventNames === null || snapshotEventNames.has(event.type)) {
          shouldTakeSnapshot = true;
        }
        try {
          store.batch(() => {
            handler(facts, event);
          });
        } finally {
          dispatchDepth--;
        }
      } else if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[Directive] Unknown event type "${event.type}". ` +
            "No handler is registered for this event. " +
            `Available events: ${Object.keys(mergedEvents).join(", ") || "(none)"}`,
        );
      }
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
        runHistoryEnabled,
        ...(runHistoryEnabled
          ? {
              runHistory: runHistory.map((r) => ({
                ...r,
                factChanges: r.factChanges.map((fc) => ({ ...fc })),
                derivationsRecomputed: r.derivationsRecomputed.map((d) => ({
                  ...d,
                  deps: [...d.deps],
                })),
                constraintsHit: r.constraintsHit.map((c) => ({
                  ...c,
                  deps: [...c.deps],
                })),
                requirementsAdded: r.requirementsAdded.map((ra) => ({ ...ra })),
                requirementsRemoved: r.requirementsRemoved.map((rr) => ({
                  ...rr,
                })),
                resolversStarted: r.resolversStarted.map((rs) => ({ ...rs })),
                resolversCompleted: r.resolversCompleted.map((rc) => ({
                  ...rc,
                })),
                resolversErrored: r.resolversErrored.map((re) => ({ ...re })),
                effectsRun: r.effectsRun.map((e) => ({
                  ...e,
                  triggeredBy: [...e.triggeredBy],
                })),
                effectErrors: r.effectErrors.map((ee) => ({ ...ee })),
              })),
            }
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

      // Get relevant facts by looking at the constraint's last known state
      const relevantFacts: Record<string, unknown> = {};
      const factsSnapshot = store.toObject();

      // Include all facts for now (could be optimized with dependency tracking)
      for (const [key, value] of Object.entries(factsSnapshot)) {
        relevantFacts[key] = value;
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

    getOriginal(type: "constraint" | "resolver" | "derivation" | "effect", id: string): unknown | undefined {
      const typeMap: Record<string, Map<string, unknown>> = {
        constraint: originals.constraints,
        resolver: originals.resolvers,
        derivation: originals.derivations,
        effect: originals.effects,
      };
      const map = typeMap[type];

      if (!map) {
        return undefined;
      }

      return map.get(id);
    },

    restoreOriginal(type: "constraint" | "resolver" | "derivation" | "effect", id: string): boolean {
      const typeMap: Record<string, Map<string, unknown>> = {
        constraint: originals.constraints,
        resolver: originals.resolvers,
        derivation: originals.derivations,
        effect: originals.effects,
      };
      const map = typeMap[type];

      if (!map || !map.has(id)) {
        return false;
      }

      const original = map.get(id);
      assignDefinition(type, id, original);
      map.delete(id);

      return true;
    },

    async settle(maxWait = 5000): Promise<void> {
      const startTime = Date.now();

      // Use while loop instead of recursion to prevent stack overflow
      while (true) {
        // Flush any pending batches so they start executing
        if (resolversManager.hasPendingBatches()) {
          resolversManager.processBatches();
        }

        // Wait for any pending microtasks
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Check if we have inflight resolvers or unmet requirements with resolvers
        const inspection = this.inspect();
        const settled =
          inspection.inflight.length === 0 &&
          !state.isReconciling &&
          !state.reconcileScheduled &&
          !resolversManager.hasPendingBatches();

        if (settled) {
          return;
        }

        // Check timeout
        if (Date.now() - startTime > maxWait) {
          const details: string[] = [];
          if (inspection.inflight.length > 0) {
            details.push(
              `${inspection.inflight.length} resolvers inflight: ${inspection.inflight.map((r) => r.resolverId).join(", ")}`,
            );
          }
          if (state.isReconciling) {
            details.push("reconciliation in progress");
          }
          if (state.reconcileScheduled) {
            details.push("reconcile scheduled");
          }
          // Include pending requirements for better debugging
          const unmet = state.previousRequirements.all();
          if (unmet.length > 0) {
            details.push(
              `${unmet.length} unmet requirements: ${unmet.map((r) => r.requirement.type).join(", ")}`,
            );
          }
          throw new Error(
            `[Directive] settle() timed out after ${maxWait}ms. ${details.join("; ")}`,
          );
        }

        // Wait a bit and check again
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
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
      let derivationKeys: string[];

      if (includeDerivations) {
        // Only include specified derivations
        derivationKeys = includeDerivations.filter((k) =>
          allDerivationKeys.includes(k),
        );

        // Warn about unknown derivation keys in dev mode
        if (process.env.NODE_ENV !== "production") {
          const unknown = includeDerivations.filter(
            (k) => !allDerivationKeys.includes(k),
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

    onTimeTravelChange(listener: () => void): () => void {
      timeTravelListeners.add(listener);
      return () => {
        timeTravelListeners.delete(listener);
      };
    },

    batch(fn: () => void): void {
      store.batch(fn);
    },

    get isSettled(): boolean {
      return (
        resolversManager.getInflight().length === 0 &&
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
    derive?: Record<string, (facts: unknown, derive: unknown) => unknown>;
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
    snapshotEvents?: string[];
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
    if (module.snapshotEvents) {
      if (snapshotEventNames === null) {
        // First module with snapshotEvents — initialize the set with all existing event names
        snapshotEventNames = new Set<string>(Object.keys(mergedEvents));
      }
      for (const eventName of module.snapshotEvents) {
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
