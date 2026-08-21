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

import isDevelopment from "#is-development";
import {
  type HistoryManager,
  createDisabledHistory,
  createHistoryManager,
} from "../utils/history.js";
import { freezeSpec, hashObject, isPrototypeSafe } from "../utils/utils.js";
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
import { applyPatch, evaluateKeySelector } from "./predicate.js";
import { RequirementSet } from "./requirements.js";
import { type ResolversManager, createResolversManager } from "./resolvers.js";
import { type SourcesManager, createSourcesManager } from "./sources.js";
import {
  BLOCKED_PROPS,
  derivationDepId,
  describeDep,
  isDerivationDep,
  withoutTracking,
} from "./tracking.js";
import type {
  ConstraintsDef,
  DefinitionKind,
  DerivationsDef,
  EffectsDef,
  EventsDef,
  FactsSnapshot,
  InferSchema,
  MetaMatch,
  ReconcileResult,
  RequirementKeyFn,
  ResolverDef,
  ResolversDef,
  Schema,
  System,
  SystemConfig,
  SystemEvent,
  SystemInspection,
  TraceEntry,
} from "./types.js";
import { type DefinitionMeta, freezeMeta } from "./types/meta.js";
import type { SourceDef, SourcesDef } from "./types/sources.js";

// ============================================================================
// Engine Implementation
// ============================================================================

/**
 * The changed-key the error boundary files when an effect throws under the
 * `"retry"` strategy.
 *
 * Not a fact key — no fact by this name can exist, and no dependency set names
 * it, so it selects nothing. Every consumer of the changed-key set matches
 * names against dependencies, which means this one is inert everywhere it is
 * read: it marks the pass as having had something happen without claiming that
 * any particular thing changed.
 *
 * The retry pass itself is scheduled outright at the point the key is filed,
 * beside the `add`, rather than inferred from the set being non-empty. The key
 * is filed anyway so that everything downstream of the effects phase in that
 * pass — the constraint evaluation the set is copied into, and a history
 * snapshot if the raise happened outside a reconcile — sees a set consistent
 * with a reconcile having been asked for.
 *
 * It does not survive the pass. `state.changedKeys` is cleared once it has been
 * copied for constraint evaluation, so nothing hands the key back to the phase
 * that raised it.
 */
const EFFECT_RETRY_KEY = "*";

/**
 * Unwrap object-form events ({ handler, meta } or { patch, meta }) into bare
 * handler functions in place, and capture any meta into `eventMeta`. After
 * this pass, every value in `events` is a bare `(facts, event) => void`
 * function. Used by both the static merge loop in `createEngine` and the
 * dynamic `registerModule` path so the two cannot drift.
 */
function unwrapEventDefinitions(
  events: Record<string, unknown>,
  eventMeta: Map<string, DefinitionMeta>,
): void {
  for (const [key, raw] of Object.entries(events)) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }

    const hasHandler = Object.hasOwn(raw, "handler");
    const hasPatch = Object.hasOwn(raw, "patch");

    // When both forms are provided, `handler` wins (current silent behavior).
    // Dev-warn so authors can clean up the conflict.
    if (hasHandler && hasPatch && isDevelopment) {
      console.warn(
        `[Directive] event "${key}": both \`handler\` and \`patch\` provided — using \`handler\` (patch is ignored).`,
      );
    }

    if (hasHandler) {
      const obj = raw as { handler: Function; meta?: DefinitionMeta };
      events[key] = obj.handler;
      if (obj.meta) {
        const frozen = freezeMeta(obj.meta);
        if (frozen) eventMeta.set(key, frozen);
      }
      continue;
    }

    if (hasPatch) {
      const obj = raw as {
        patch: { $set: Record<string, unknown> };
        meta?: DefinitionMeta;
      };
      const spec = obj.patch;
      // Deep-freeze the spec + nested $set values at registration so post-
      // registration mutation cannot silently change event behavior (matches
      // the discipline used by constraints/derivations/effects).
      freezeSpec(spec);
      events[key] = (
        facts: Record<string, unknown>,
        event: Record<string, unknown> | undefined,
      ) =>
        applyPatch(
          spec as Parameters<typeof applyPatch>[0],
          facts,
          event ?? {},
        );
      if (obj.meta) {
        const frozen = freezeMeta(obj.meta);
        if (frozen) eventMeta.set(key, frozen);
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface EngineState<_S extends Schema> {
  isRunning: boolean;
  isReconciling: boolean;
  reconcileScheduled: boolean;
  isInitializing: boolean;
  isInitialized: boolean;
  isReady: boolean;
  isDestroyed: boolean;
  /**
   * RFC 0009 follow-up — evict-reentry gate. Cloudflare DO
   * hibernation paths can call `system.evict()` twice (once on the
   * first eviction signal, once on the failover path). Without this
   * gate, the second call would re-run every source's `onEvict` —
   * sources that aren't idempotent (e.g. one that posts a "going
   * away" message to a broker) would double-fire. Set on first
   * entry; never cleared (eviction is terminal).
   */
  isEvicting: boolean;
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
/**
 * A schema type this package built, as opposed to a foreign validator.
 *
 * `t.string()` and friends are inert descriptors and safe to freeze. A Zod
 * schema is also a supported fact type and is not: it mutates itself during
 * validation, so freezing it breaks the first write it validates.
 */
/**
 * Schema types this engine has already validated and frozen.
 *
 * Module-scoped so a module object handed to two systems is prepared once,
 * without asking `Object.isFrozen` — which answers yes for a type the author
 * froze themselves, and would then skip the tag validation.
 */
const preparedSchemaTypes = new WeakSet<object>();

function isOwnSchemaType(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "_typeName" in (value as Record<string, unknown>)
  );
}

export function createEngine<S extends Schema>(
  config: SystemConfig<any>,
): System<any> {
  // Merge all module definitions with collision detection
  // Use Object.create(null) to prevent prototype chain traversal (e.g., "toString" in mergedEvents)
  const mergedSchema = Object.create(null) as S;
  const mergedEvents: EventsDef<S> = Object.create(null);
  const mergedDerive: DerivationsDef<S> = Object.create(null);
  const mergedEffects: EffectsDef<S> = Object.create(null);
  const mergedSources: SourcesDef = Object.create(null);
  // Per-source moduleId map so the sources manager can attribute attach +
  // unsubscribe failures to the owning module in operator-facing messages.
  const sourceModuleIds: Record<string, string> = Object.create(null);
  const mergedConstraints: ConstraintsDef<S> = Object.create(null);
  const mergedResolvers: ResolversDef<S> = Object.create(null);

  // Module and event metadata (frozen at registration)
  const moduleMeta = new Map<string, DefinitionMeta>();
  const eventMeta = new Map<string, DefinitionMeta>();

  // Track which module defined each key for collision detection
  const schemaOwners = new Map<string, string>();
  const definitionOwners = new Map<string, string>();
  // Track resolver-id → owning module def, used to fire module-level resolver hooks
  // (e.g. ModuleHooks.onResolverError) without re-walking config.modules per error.
  const resolverIdToModule = new Map<string, (typeof config.modules)[number]>();

  for (const module of config.modules) {
    // Security: Validate module definitions for dangerous keys
    // Always run in all environments — this is a security boundary, not a dev convenience
    const validateKeys = (obj: object | undefined, section: string) => {
      if (!obj) return;
      for (const key of Object.keys(obj)) {
        if (BLOCKED_PROPS.has(key)) {
          throw new Error(
            `[Directive] Security: Module "${module.id}" has dangerous key "${key}" in ${section}. This could indicate a prototype pollution attempt.`,
          );
        }
        if (section === "schema" && key.startsWith("$")) {
          throw new Error(
            `[Directive] Module "${module.id}" has schema key "${key}" starting with "$". Keys starting with $ are reserved for internal accessors ($store, $snapshot).`,
          );
        }
      }
    };
    validateKeys(module.schema, "schema");
    validateKeys(module.events, "events");
    validateKeys(module.derive, "derive");
    validateKeys(module.effects, "effects");
    validateKeys((module as { sources?: object }).sources, "sources");
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
            `[Directive] Definition collision: ${section} "${key}" is defined in both module "${owner}" and "${module.id}". Use namespacing or rename to avoid conflicts.`,
          );
        }
        definitionOwners.set(key, module.id);
      }
    };
    checkCollisions(module.derive, "derivation");
    checkCollisions(module.effects, "effect");
    checkCollisions(
      (module as { sources?: Record<string, unknown> }).sources,
      "source",
    );
    checkCollisions(module.constraints, "constraint");
    checkCollisions(module.resolvers, "resolver");
    checkCollisions(module.events, "event");

    Object.assign(mergedSchema, module.schema);
    if (module.events) {
      unwrapEventDefinitions(
        module.events as Record<string, unknown>,
        eventMeta,
      );
      Object.assign(mergedEvents, module.events);
    }
    if (module.derive) Object.assign(mergedDerive, module.derive);
    if (module.effects) Object.assign(mergedEffects, module.effects);
    {
      const moduleSources = (module as { sources?: SourcesDef }).sources;
      if (moduleSources) {
        Object.assign(mergedSources, moduleSources);
        // Capture each source's owning moduleId for error attribution.
        for (const sourceId of Object.keys(moduleSources)) {
          sourceModuleIds[sourceId] = module.id;
        }
      }
    }
    if (module.constraints)
      Object.assign(mergedConstraints, module.constraints);
    if (module.resolvers) {
      Object.assign(mergedResolvers, module.resolvers);
      // Track resolver ownership for module-level hooks (e.g. onResolverError)
      for (const resolverId of Object.keys(module.resolvers)) {
        resolverIdToModule.set(resolverId, module);
      }
    }
    if (module.meta) {
      const frozen = freezeMeta(module.meta);
      if (frozen) moduleMeta.set(module.id, frozen);
    }
  }

  // Freeze meta on all non-derivation definitions (derivations freeze in their manager)
  for (const def of Object.values(mergedConstraints)) {
    if (def.meta) def.meta = freezeMeta(def.meta)!;
  }
  for (const def of Object.values(mergedResolvers)) {
    if (def.meta) def.meta = freezeMeta(def.meta)!;
  }
  for (const def of Object.values(mergedEffects)) {
    const d = def as { meta?: DefinitionMeta };
    if (d.meta) d.meta = freezeMeta(d.meta)!;
  }
  // Freeze fact/schema field _meta, and the schema type holding it.
  //
  // Freezing only the meta object left the claim removable: the schema type is
  // the same reference the module object holds, so `module.schema.facts.email
  // ._meta = {}` untagged a live fact. Nothing noticed, because every consumer
  // cached the tagged-key set at startup and the untag arrived too late to
  // matter. Reading tags per write is the right design and makes that live, so
  // the door closes here.
  for (const schemaType of Object.values(mergedSchema)) {
    const st = schemaType as { _meta?: DefinitionMeta };
    // Idempotent, but only for types WE froze. `Object.isFrozen` cannot tell
    // "we prepared this" from "the author froze it first", and skipping on the
    // second would skip the tag validation this freeze exists to guarantee.
    if (preparedSchemaTypes.has(st)) continue;
    preparedSchemaTypes.add(st);
    if (st._meta) st._meta = freezeMeta(st._meta)!;
    // Only the schema types this package builds. A Zod schema is a supported
    // fact type and mutates itself while validating — v3 caches its shape onto
    // the instance on first parse, v4 re-defines properties on it — so freezing
    // one turns the first validated write into a TypeError.
    if (isOwnSchemaType(st)) {
      Object.freeze(st);
    }
  }

  // Build snapshotEventNames: Set<string> | null
  // If any module declares history.snapshotEvents, build the filter set.
  // Modules WITHOUT history.snapshotEvents have all their events added (they still snapshot).
  let snapshotEventNames: Set<string> | null = null;
  const hasAnySnapshotEvents = config.modules.some(
    (m: any) => m.history?.snapshotEvents,
  );
  if (hasAnySnapshotEvents) {
    snapshotEventNames = new Set<string>();
    for (const module of config.modules) {
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

  // Dev-mode: Warn if a fact and derivation share the same name.
  //
  // Tracking handles it — the two are separate names inside every dependency
  // set and invalidation set, and a constraint gated on one is not woken by the
  // other. This warns because it is hard to *read*: `facts.ready` and
  // `derived.ready` sit a line apart meaning different things, and a reviewer
  // has to check which proxy every one of them came off.
  if (isDevelopment) {
    const derivationNames = new Set(Object.keys(mergedDerive));
    for (const key of Object.keys(mergedSchema)) {
      if (derivationNames.has(key)) {
        console.warn(
          `[Directive] "${key}" exists as both a fact and a derivation. They are tracked separately and will not invalidate each other, but two things one name apart are hard to read — consider renaming one.`,
        );
      }
    }
  }

  /**
   * Whether an explicit `deps` entry names a derivation.
   *
   * Auto-tracking already files a derivation read under a namespace;
   * a `deps` array is written by hand and cannot. This is what brings the two
   * onto one keyspace, and it is answered here because the engine is the only
   * thing holding the merged module set — a name that means nothing at
   * registration time can mean a derivation after a second module joins, so it
   * is a live lookup rather than a snapshot.
   *
   * A fact key of the same name wins. `deps` has meant fact keys since it
   * existed, the collision is already warned about above, and resolving it
   * toward the older meaning cannot break a module that predates derivation
   * dependencies working at all.
   */
  const isDerivationDepName = (name: string): boolean =>
    name in mergedDerive && !(name in mergedSchema);

  /**
   * Whether an explicit `deps` entry names a declared fact.
   *
   * The companion to `isDerivationDepName`, and live for the same reason:
   * `registerModule` adds to the merged schema after the engine exists. It
   * exists so a dependency resolver can tell "this name means a fact" from
   * "this name means nothing yet" — the first is settled, because the rule
   * above hands a collision to the fact, and the second is the only case worth
   * revisiting.
   */
  const isFactKeyName = (name: string): boolean => name in mergedSchema;

  /**
   * `isDerivationDepName`, plus the record that someone is now watching.
   *
   * An effect or constraint that names a derivation in `deps` is watching it as
   * surely as one whose body reads it — more surely, since a body may read
   * conditionally — but nothing about a hand-written name announces itself the
   * way a tracked read does. Asking what the name means is the moment the
   * intent is visible, so it is the moment it gets recorded. Only names that
   * turn out to be derivations are recorded; a fact key resolves through the
   * other branch and never reaches here.
   *
   * What the record buys is at the drain: with nothing watching, the transitive
   * "may have moved" closure is never computed at all.
   */
  const observeDerivationDepName = (name: string): boolean => {
    if (!isDerivationDepName(name)) {
      return false;
    }
    derivationsManager.markObserved(name);

    return true;
  };

  // Create plugin manager
  const pluginManager: PluginManager<S> = createPluginManager();
  for (const plugin of config.plugins ?? []) {
    pluginManager.register(plugin);
  }
  // Cached plugin check — updated on register/unregister for O(1) hot-path access
  let _hasPlugins = pluginManager.getPlugins().length > 0;
  // reentry depth counter for `system.notify.guardrailBlocked`
  // so a hostile plugin can't synchronously re-emit through the broadcast
  // fabric and overflow the stack. Capped at depth 4 (one legitimate
  // plugin-reacting-to-plugin chain is fine; deeper is a smell).
  let guardrailNotifyDepth = 0;
  const _origRegister = pluginManager.register.bind(pluginManager);
  const _origUnregister = pluginManager.unregister.bind(pluginManager);
  pluginManager.register = (plugin) => {
    _origRegister(plugin);
    _hasPlugins = true;
  };
  pluginManager.unregister = (name) => {
    _origUnregister(name);
    _hasPlugins = pluginManager.getPlugins().length > 0;
  };
  const hasPlugins = () => _hasPlugins;

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

  /**
   * Open while a batch is in flight, so the eager per-write invalidation below
   * does not announce a half-written batch.
   *
   * Invalidation and notification are two things and only the second one has
   * to wait for the end. Assigned when the outermost batch opens and released
   * inside `onBatch`, which is where the announcement used to happen anyway —
   * so listeners still hear about a batch at exactly the same moment, having
   * become able to read the right values before that moment arrives.
   */
  let holdDerivationNotifications: () => () => void = () => () => {};

  /**
   * Outstanding derivation-notification holds, innermost last.
   *
   * This was a single slot, which is wrong as soon as a batch can begin while
   * another is still open — and one can: `onFactsBatch` is broadcast to plugins
   * *before* the outer hold is released, so a plugin that writes in response to
   * a batch opens a nested one from inside that window. The nested hold
   * overwrote the outer one in the slot, the outer release closure was dropped
   * on the floor, and the manager's depth counter never returned to zero. From
   * then on every derivation notification was held forever: `watch`,
   * `subscribe` and any framework hook built on them went silent for the life
   * of the process, while the values themselves still read correctly on demand.
   * Nothing threw, and the symptom looks like a bug in whatever renders.
   *
   * The manager already counts holds properly and its release is idempotent;
   * only this side needed to stop forgetting them.
   */
  const derivationHolds: Array<{ release: () => void; released: boolean }> = [];

  /**
   * How deep the stack was when each batch opened, so a batch can only ever
   * unwind what it pushed.
   */
  const derivationHoldBase: number[] = [];

  /**
   * Release the innermost hold, once. Called from `onBatch`, which is after the
   * batch's derivations have been invalidated and therefore the right moment to
   * announce.
   *
   * It releases without popping. A batch that wrote something reaches here AND
   * `onBatchEnd`; popping in both places meant one pop landed on whatever was
   * underneath, so a batch nested inside another's flush released its parent's
   * hold — announcing the parent early and then again when the parent finished.
   */
  function releaseDerivationHold(): void {
    const top = derivationHolds[derivationHolds.length - 1];
    if (top && !top.released) {
      top.released = true;
      top.release();
    }
  }

  /**
   * Unwind to where this batch started, releasing anything still held.
   *
   * Called from `onBatchEnd`, which `store.batch` runs in a `finally`, so a
   * throw anywhere in the batch still gives the hold back. Anything already
   * released by `releaseDerivationHold` is skipped rather than released twice.
   */
  function unwindDerivationHolds(): void {
    const base = derivationHoldBase.pop() ?? 0;
    while (derivationHolds.length > base) {
      const frame = derivationHolds.pop();
      if (frame && !frame.released) {
        frame.released = true;
        frame.release();
      }
    }
  }

  // Forward-declared so onChange/onBatch closures can check isRestoring.
  // Assigned after createHistoryManager() below.
  let historyRef: HistoryManager<S> | null = null;

  // Trace management (per-run reconciliation changelog, gated by config.trace)
  const traceManager = createTraceManager({
    traceConfig: config.trace,
    pluginManager,
    resolverMetaLookup: (id) => mergedResolvers[id]?.meta,
  });
  const traceEnabled = traceManager.enabled;

  const { store, facts } = createFacts<S>({
    schema: mergedSchema,
    onChange: (key, value, prev) => {
      // Invalidate BEFORE announcing, so a plugin asking what a value carries
      // is told about the write it is being notified of. The batched path
      // already worked this way — `onWrite` invalidates at write time and the
      // announcement waits for `onBatch` — so the two paths disagreed: a
      // redactor got the right answer inside `system.batch()` and an answer
      // one write stale outside it.
      //
      // Held across the announcement because invalidating flushes derivation
      // listeners, which are `system.subscribe` / `system.watch` callbacks —
      // consumer code. Without the hold they would run between the commit and
      // the plugins, and a throw from one would skip `emitFactSet` entirely,
      // taking the guardrail with it.
      const release = holdDerivationNotifications();
      try {
        invalidateDerivation(key);
        pluginManager.emitFactSet(key, value, prev);
      } finally {
        release();
      }
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
      // after ALL keys are invalidated, so they see consistent state. Most are
      // already stale by now, marked by `onWrite` as each key was written;
      // this catches anything the eager pass could not reach and is the point
      // at which the announcement is released.
      invalidateManyDerivations(keys);
      releaseDerivationHold();
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
    onWrite: (key) => {
      // Mark stale the moment the fact is written, so a body that writes a
      // fact and then reads a derivation of it — which an effect can now do
      // through its `derived` parameter — sees its own write. The fact itself
      // already reads back immediately; without this, the same function body
      // has two consistency models depending on which accessor it reaches for.
      // The announcement stays held until the batch ends.
      invalidateDerivation(key);
    },
    onBatchStart: () => {
      derivationHoldBase.push(derivationHolds.length);
      derivationHolds.push({
        release: holdDerivationNotifications(),
        released: false,
      });
    },
    onKeysRegistered: (entries) => {
      const asSchema: Record<string, unknown> = {};
      for (const [key, type] of entries) {
        asSchema[key] = type;
      }
      recordFactTags(asSchema);
      notifyMetaSubscribers();
    },
    onBatchEnd: () => {
      // Normally the hold was already released inside `onBatch`. This unwinds
      // the frame either way, and covers the batch that wrote nothing — where
      // `onBatch` never runs — and the batch that threw.
      unwindDerivationHolds();
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
      if (hasPlugins()) pluginManager.emitDerivationCompute(id, value, deps);
      if (traceManager.currentTrace) {
        traceManager.currentTrace.derivationsRecomputed.push({
          id,
          deps: deps ? [...deps] : [],
          oldValue,
          newValue: value,
          meta: derivationsManager.getMeta(id as keyof DerivationsDef<S>),
        });
      }
    },
    onInvalidate: (id) => {
      if (hasPlugins()) pluginManager.emitDerivationInvalidate(id);
    },
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
  holdDerivationNotifications = () => derivationsManager.holdNotifications();

  // Create effects manager
  const effectsManager: EffectsManager<S> = createEffectsManager({
    definitions: mergedEffects,
    facts,
    store,
    derived: derivationsManager.getProxy() as Record<string, unknown>,
    isDerivation: observeDerivationDepName,
    isFactKey: isFactKeyName,
    onRun: (id, deps) => {
      if (hasPlugins()) pluginManager.emitEffectRun(id);
      if (traceManager.currentTrace) {
        traceManager.currentTrace.effectsRun.push({
          id,
          triggeredBy: deps,
          meta: (mergedEffects[id] as { meta?: DefinitionMeta } | undefined)
            ?.meta,
        });
      }
    },
    onError: (id, error) => {
      const strategy = errorBoundary.handleError("effect", id, error);
      if (hasPlugins()) pluginManager.emitEffectError(id, error);

      if (traceManager.currentTrace) {
        traceManager.currentTrace.effectErrors.push({
          id,
          error: String(error),
          meta: (mergedEffects[id] as { meta?: DefinitionMeta } | undefined)
            ?.meta,
        });
      }

      if (strategy === "disable") {
        effectsManager.disable(id);
      }

      if (strategy === "retry") {
        state.changedKeys.add(EFFECT_RETRY_KEY);
        scheduleReconcile();
      }
    },
  });

  // Create sources manager — attaches external event sources at
  // `system.start()`, tears them down at `system.stop()`. Sources are
  // lifecycle-only (no reconciliation pass; no fact-dependency tracking),
  // so the manager is a flat list with try/catch isolation. The manager
  // invokes per-source lifecycle callbacks (onAttach / onPublish /
  // onDetach / onError) so the engine can emit accurate plugin events
  // with per-source attribution — closes the "shared publish callback
  // can't tell which source emitted" attribution bug.
  const sourcesManager: SourcesManager = createSourcesManager(
    mergedSources,
    sourceModuleIds,
    {
      onAttach: (id, moduleId) => {
        if (hasPlugins()) pluginManager.emitSourceAttach(id, moduleId);
      },
      onPublish: (id, moduleId, eventName) => {
        if (hasPlugins())
          pluginManager.emitSourcePublish(id, moduleId, eventName);
      },
      onDrop: (id, moduleId, eventName, reason) => {
        if (hasPlugins())
          pluginManager.emitSourceDrop(id, moduleId, eventName, reason);
      },
      onDetach: (id, moduleId) => {
        if (hasPlugins()) pluginManager.emitSourceDetach(id, moduleId);
      },
      onError: (id, moduleId, phase, error) => {
        if (hasPlugins())
          pluginManager.emitSourceError(id, moduleId, phase, error);
      },
    },
  );

  /**
   * Normalize `key`: a function passes through, an array `KeySelector`
   * (a list of requirement-payload field names) is wrapped into a
   * function that builds a stable JSON-encoded dedup key from those fields.
   */
  function normalizeResolverKey(
    key: NonNullable<ResolverDef<S>["key"]>,
  ): RequirementKeyFn {
    if (Array.isArray(key)) {
      const selector = key as readonly string[];

      return (req) =>
        evaluateKeySelector(
          selector,
          req as unknown as Record<string, unknown>,
        );
    }

    return key as RequirementKeyFn;
  }

  // Extract resolver key functions keyed by requirement type. Resolvers
  // with a string `requirement` and a `key` contribute to requirement
  // deduplication inside the constraints manager.
  const requirementKeys: Record<string, RequirementKeyFn> = Object.create(null);
  for (const def of Object.values(mergedResolvers)) {
    if (def.key && typeof def.requirement === "string") {
      requirementKeys[def.requirement] = normalizeResolverKey(def.key);
    }
  }

  // Create constraints manager
  const constraintsManager: ConstraintsManager<S> = createConstraintsManager({
    definitions: mergedConstraints,
    facts,
    derived: derivationsManager.getProxy() as Record<string, unknown>,
    requirementKeys,
    isDerivation: observeDerivationDepName,
    onEvaluate: (id, active) => {
      if (hasPlugins()) {
        // For data-form `when` constraints, pass the per-clause breakdown
        // through to every plugin (devtools, logging, observers) so they
        // can render which clauses passed/failed. Function-form `when`
        // returns `undefined`, which the typed hook treats as "no explain".
        const whenExplain = constraintsManager.explainWhen(id);
        pluginManager.emitConstraintEvaluate(id, active, whenExplain);
      }
    },
    onError: (id, error) => {
      const strategy = errorBoundary.handleError("constraint", id, error);
      if (hasPlugins()) pluginManager.emitConstraintError(id, error);

      if (strategy === "disable") {
        constraintsManager.disable(id);
      }
    },
  });

  /** Sync resolver key functions into the constraints manager */
  function syncResolverKeys(defs: ResolversDef<S>): void {
    for (const def of Object.values(defs)) {
      if (def.key && typeof def.requirement === "string") {
        constraintsManager.setRequirementKey(
          def.requirement,
          normalizeResolverKey(def.key),
        );
      }
    }
  }

  /**
   * RFC-0003 resolver constraint-binding lookup. Returns the constraint's
   * abort-binding fact list, or `undefined` when the constraint has no
   * `abortOn` field, an empty list, or is async — async constraints
   * `await` between predicate evaluation and resolver dispatch, which
   * would race the binding's snapshot, so they cannot be bound.
   */
  function getConstraintBinding(
    constraintId: string,
  ): { fields: readonly string[] } | undefined {
    const def = mergedConstraints[constraintId];
    if (!def?.abortOn || def.abortOn.length === 0) return undefined;
    const state = constraintsManager.getState(constraintId);
    if (state?.isAsync || def.async) {
      const reason: "async-declared" | "async-promoted" =
        state?.isAsync && !def.async ? "async-promoted" : "async-declared";

      // Per-(constraintId, reason) dedupe so a hot async constraint that
      // dispatches at high throughput doesn't flood the console or the
      // observation stream with identical events.
      const notifyKey = `${constraintId}::${reason}`;
      const alreadyNotified = bindingDisabledNotified.has(notifyKey);
      if (!alreadyNotified) bindingDisabledNotified.add(notifyKey);

      if (isDevelopment && !alreadyNotified) {
        // If the engine promoted this constraint to async at runtime (its
        // when() returned a Promise) the user almost certainly didn't realize.
        // Call that out explicitly — the workaround is a data-form when (always
        // sync) or an explicit `async: true` opt-in that accepts the loss of
        // abortOn.
        if (reason === "async-promoted") {
          console.warn(
            `[Directive] constraint '${constraintId}': abortOn binding disabled because when() returned a Promise — convert to a synchronous when, mark the constraint async: true and accept the binding being off, or use a data-form when (always sync).`,
          );
        } else {
          console.warn(
            `[Directive] Constraint "${constraintId}" has \`abortOn\` but is async. Binding is disabled — async constraints cannot be bound. To enable abortOn, switch to a synchronous function-form when or a data-form when (always sync), and drop \`async: true\`.`,
          );
        }
      }
      // SIEM-facing signal — fires in both dev and prod so production
      // plugins (audit-ledger, observability) can detect a constraint
      // silently losing its clobber-protection. Dev-mode console.warn
      // covers the human side; this covers the machine side.
      if (hasPlugins() && !alreadyNotified) {
        pluginManager.emitConstraintBindingDisabled(constraintId, reason);
      }
      return undefined;
    }
    return { fields: def.abortOn };
  }

  /**
   * Requirement IDs that resolvers requested to be re-fired via
   * `ctx.requeue()`. The engine removes these IDs from
   * `state.previousRequirements` AFTER each reconcile commits its next
   * snapshot, so the following diff treats them as fresh and dispatches
   * the resolver again. See {@link ResolverContext.requeue}.
   */
  const pendingRequeueIds = new Set<string>();

  /**
   * Per-(constraintId, reason) sticky bit so `constraint.binding.disabled`
   * fires at most ONCE per pair across the lifetime of the registered
   * constraint. Without this, a hot async constraint that dispatches at
   * 1k/sec would flood SIEM/observers with 1k/sec of identical events.
   * The dev-mode `console.warn` is gated by the same sticky bit so
   * `pnpm dev` doesn't flood the terminal either.
   *
   * The bit is cleared when the constraint's definition is removed via
   * `unregister()` so re-registering a constraint resets the
   * once-per-lifetime contract.
   */
  const bindingDisabledNotified = new Set<string>();

  // Create resolvers manager
  const resolversManager: ResolversManager<S> = createResolversManager({
    definitions: mergedResolvers,
    facts,
    store,
    // RFC-0003: resolver constraint-binding — see getConstraintBinding above.
    getConstraintBinding,
    onStart: (resolver, req) => {
      if (hasPlugins()) pluginManager.emitResolverStart(resolver, req);
    },
    onComplete: (resolver, req, duration) => {
      errorBoundary.clearRetryAttempts(resolver);
      if (hasPlugins()) {
        pluginManager.emitResolverComplete(resolver, req, duration);
        pluginManager.emitRequirementMet(req, resolver);
      }
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
      if (hasPlugins()) pluginManager.emitResolverError(resolver, req, error);

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

      // Fire the module-level onResolverError hook (opt-in side channel).
      // Runs AFTER the engine's error handling so the hook never affects retry
      // strategy — it's purely an observer. Errors thrown by the hook are
      // isolated so a buggy hook can't break the engine or starve other modules.
      const ownerModule = resolverIdToModule.get(resolver);
      const hook = ownerModule?.hooks?.onResolverError;
      if (hook) {
        const normalizedError =
          error instanceof Error ? error : new Error(String(error));
        try {
          hook(normalizedError, req.requirement, {
            facts: facts as any,
          });
        } catch (hookError) {
          // Isolate hook failures so they don't break the engine
          console.error(
            `[Directive] onResolverError hook for module "${ownerModule?.id}" threw:`,
            hookError,
          );
        }
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
    onClobber: (resolver, req, fact, expected, actual) => {
      if (hasPlugins()) {
        pluginManager.emitResolverWriteRejected({
          kind: "rejection",
          resolver,
          req,
          reason: "clobbered",
          fact,
          expected,
          actual,
        });
      }
    },
    onClobberSuppressed: (resolver, req, dropped) => {
      if (hasPlugins()) {
        pluginManager.emitResolverWriteRejected({
          kind: "summary",
          resolver,
          req,
          reason: "clobbered",
          dropped,
        });
      }
    },
    onResolutionComplete: () => {
      // After a resolver completes, schedule another reconcile
      notifySettlementChange();
      scheduleReconcile();
    },
    onRequeue: (requirementId: string) => {
      // ctx.requeue() opt-in: the resolver explicitly wants its owning
      // requirement re-evaluated even if the constraint re-emits the same
      // requirement ID. Track the request — the reconciler will drop the
      // ID from `previousRequirements` AFTER it commits the next snapshot
      // so the diff sees it as freshly added and re-dispatches the
      // resolver. Does NOT lift the default suppression — only this one
      // requirement's next pass is bypassed.
      //
      // Why deferred: ctx.requeue() may be called synchronously inside a
      // resolver that was just dispatched mid-reconcile. At that moment
      // `previousRequirements` has not yet been replaced with the current
      // set (that happens later in the same reconcile pass). Removing
      // eagerly would either no-op against an empty/stale snapshot or
      // be overwritten when the reconciler commits.
      pendingRequeueIds.add(requirementId);
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
    isEvicting: false,
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
    onDefinitionsChanged: () => notifyMetaSubscribers(),
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
          if (isDevelopment) {
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
      if (isDevelopment) {
        console.warn(
          `[Directive] Reconcile loop exceeded ${MAX_RECONCILE_DEPTH} iterations. This usually means resolvers are creating circular requirement chains. Check that resolvers aren't mutating facts that re-trigger their own constraints.`,
        );
      }
      // Drain pending fact changes so they don't leak into the next trace entry
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

    // Enrich fact changes with schema meta (after startRun drains pending changes)
    if (currentTrace) {
      for (const fc of currentTrace.factChanges) {
        const schemaType = mergedSchema[fc.key as keyof S];
        fc.meta = (schemaType as { _meta?: DefinitionMeta } | undefined)?._meta;
      }
    }

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

      // Run effects for changed keys.
      //
      // Auto-tracked dependencies are whatever the body read, which is fact
      // keys *and* derivations, so the notification set has to carry both or
      // half of every tracked dependency set matches nothing. Folded in here
      // rather than at the source so `changedKeys` stays a record of facts up
      // to the point the snapshot label is taken, and carried under the
      // derivation namespace so the two kinds of name cannot be confused for
      // each other.
      //
      // Asked once per reconcile rather than pushed on every fact write. The
      // question is "which watched derivations may have moved", its answer is a
      // transitive closure over the derivation graph, and a derivation that
      // nothing reads back stays stale — so pushing it meant re-walking the
      // whole downstream graph per write forever, while the set it fed is
      // drained once per pass regardless.
      derivationsManager.collectInvalidated(state.changedKeys);
      await effectsManager.runEffects(state.changedKeys);

      // RFC 0012: re-evaluate gated/keyed sources on the post-commit effects
      // plane, immediately after effects, against the committed facts. Sits
      // behind the SAME guard effects run behind — `reconcile` never runs
      // during a history restore (the `onChange`/`onBatch` `isRestoring`
      // short-circuit skips `scheduleReconcile`), so replay / time-travel
      // re-derives the key value but NEVER re-attaches a transport. The gate
      // is a pure fact read; the attach act stays a non-replayable input.
      sourcesManager.evaluateGated(facts as unknown as Record<string, unknown>);

      // Again, because effects write facts.
      //
      // The drain above happens before `runEffects` so an effect gated on a
      // derivation is woken by it. But an effect that *writes* a fact
      // invalidates whatever derivations read that fact, and those roots land
      // after that drain has already run — so without this second call the
      // announcement misses the constraint pass immediately below, the pass
      // ends with `changedKeys` cleared, and nothing is scheduled to carry it.
      // The derivation still reads correctly on pull; only the wakeup is lost,
      // which is why it survived a snapshot assertion for so long.
      //
      // Early-returns on an empty root set, so a reconcile in which no effect
      // wrote anything pays one `Set.size` check.
      derivationsManager.collectInvalidated(state.changedKeys);

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
              deps: cDeps ? Array.from(cDeps, describeDep) : [],
              meta: mergedConstraints[cId]?.meta,
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

      // Handle resolvers for removed requirements. Unbound: abort the
      // signal. Bound (RFC-0003): detach instead — untrack the resolver but
      // do not abort it. It runs to completion so its data writes land (the
      // binding still drops abort-bound clobbers); untracking lets the
      // requirement re-dispatch cleanly if the constraint flips true again.
      // Cancelling a bound resolver would abort the signal and make a
      // signal-checking resolver bail early, losing those data writes (the
      // win-at-the-buzzer regression).
      for (const req of removed) {
        const bound = req.fromConstraint
          ? getConstraintBinding(req.fromConstraint)
          : undefined;
        if (bound) {
          resolversManager.detach(req.id);
        } else {
          resolversManager.abort(req.id);
        }
      }

      // Start resolvers for new requirements. Snapshot facts ONCE before the
      // dispatch loop so every resolver in this reconcile tick observes the
      // same pre-dispatch values for its abort-bound facts. Without a
      // shared baseline, two bound resolvers that overlap on an abort-bound fact would
      // race: the first lands its write, the second's `expected` map (seeded
      // from live `rawFacts`) inherits that write, and the second silently
      // clobbers the first.
      //
      // Perf: only snapshot the *abort-bound* fact keys across this tick's bound
      // requirements. With 10k facts and one binding on field "A", a full
      // `store.toObject()` would copy all 10k slots per reconcile tick. We
      // build the smallest possible baseline; if no `added` requirement has
      // a binding, baseline stays `undefined` and `createBoundFacts` uses
      // its live-rawFacts fallback path.
      let factsBaseline: Record<string, unknown> | undefined;
      if (added.length > 0) {
        const ownedKeysThisTick = new Set<string>();
        for (const req of added) {
          if (!req.fromConstraint) continue;
          const binding = getConstraintBinding(req.fromConstraint);
          if (!binding) continue;
          for (const k of binding.fields) {
            ownedKeysThisTick.add(k);
          }
        }
        if (ownedKeysThisTick.size > 0) {
          factsBaseline = Object.create(null) as Record<string, unknown>;
          for (const k of ownedKeysThisTick) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            factsBaseline[k] = store.get(k as any);
          }
        }
      }
      for (const req of added) {
        resolversManager.resolve(req, { factsBaseline });
      }

      // Capture resolver starts for trace
      if (currentTrace) {
        const inflightNow = resolversManager.getInflightInfo();
        // Build Map for O(1) lookups instead of O(n) find per requirement
        const inflightById = new Map(inflightNow.map((i) => [i.id, i]));
        for (const req of added) {
          const info = inflightById.get(req.id);
          const resolverId = info?.resolverId ?? "unknown";
          currentTrace.resolversStarted.push({
            resolver: resolverId,
            requirementId: req.id,
            meta: mergedResolvers[resolverId]?.meta,
          });
          // Track attribution for async completion
          traceManager.attributeResolverStart(req.id);
        }
      }

      // Update previous requirements
      state.previousRequirements = currentSet;

      // Apply ctx.requeue() requests AFTER snapshotting the new previous
      // set. Resolvers may have called requeue() synchronously during this
      // reconcile pass (their resolve dispatch happened just above) or
      // asynchronously between reconciles. Either way, dropping these IDs
      // here guarantees the NEXT reconcile diff treats them as fresh.
      // If the constraint no longer fires next pass, the ID simply won't
      // be in currentSet — there's no infinite-loop risk.
      if (pendingRequeueIds.size > 0) {
        for (const reqId of pendingRequeueIds) {
          state.previousRequirements.remove(reqId);
        }
        pendingRequeueIds.clear();
        // Schedule a follow-up reconcile so the next diff sees the
        // re-emitted requirement as added. Without this, the system
        // could go quiescent if no other fact change is pending.
        scheduleReconcile();
      }

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

      // Let the watched set shrink.
      //
      // A derivation joins that set the moment a constraint or an effect reads
      // it, and before this it left only when the derivation was destroyed — so
      // a gate that opened once was watched for the life of the system. The set
      // is the bound the invalidation walk is measured against, so a stale entry
      // makes the walk both broader and less able to stop early.
      //
      // Rebuilt rather than reference-counted. Both readers already replace
      // their dependency set wholesale each time they run, so the union of those
      // sets is the answer, and no delta has to be tracked. Placed here because
      // every constraint and effect for this pass has finished, and before the
      // decision below, which can depend on whether anything is still watching.
      // Guarded, because the union costs a walk of every reader's dependency
      // set and the answer cannot change when nothing is watched. The first
      // version of this paid that scan unconditionally: measured at +4% to +23%
      // of a reconcile in the shape where no constraint or effect reads a
      // derivation at all, which is both the most common shape and the one where
      // there is nothing to gain — `collectInvalidated` already short-circuits
      // on the same emptiness.
      if (derivationsManager.observedCount() > 0) {
        const liveObserved = new Set<string>();
        constraintsManager.collectObservedDerivations(liveObserved);
        effectsManager.collectObservedDerivations(liveObserved);
        derivationsManager.retainObserved(liveObserved);
      }

      // A changed fact is not the only thing that leaves work undone. A
      // derivation may have been invalidated by something that touches no fact
      // key at all — a definition replaced at runtime — which leaves the system
      // with something to say and no pass in which to say it.
      if (
        state.changedKeys.size > 0 ||
        derivationsManager.pendingInvalidationCount() > 0
      ) {
        scheduleReconcile();
      }

      // Reset every pass, which leaves the ceiling above unreachable. That is
      // deliberate, and it is a retreat from something worse.
      //
      // Resetting only on reaching quiet did make the ceiling reachable — and
      // reachable by the wrong things. Ordinary bounded work chains passes
      // without going quiet between them: a sixty-item queue drain trips at
      // fifty-one, and so does cursor pagination, a backoff counter, or any
      // constraint whose `require` varies with a fact its own resolver writes.
      // On a trip, the branch above wipes `previousRequirements`, so the next
      // diff treats every live requirement as new and re-dispatches it —
      // including requirements that had nothing to do with the chain, whose
      // resolvers had already completed. Measured: nine charge dispatches for
      // one order, in production, with no signal, because the warning is
      // development-only.
      //
      // Meanwhile the runaway it was meant to catch stayed invisible.
      // `context.requeue()` reschedules without dirtying a fact, so every pass
      // reached quiet and zeroed the counter: five thousand dispatches, no
      // warning.
      //
      // So the reachable version fires on safe work, does damage when it fires,
      // and still misses the dangerous work. Unreachable is strictly better
      // until the instrument is right, and depth is the wrong instrument: the
      // engine already holds every edge needed to name a cycle — requirement to
      // resolver to written keys to constraint dependencies to constraint — and
      // repeat-detection on `(constraintId, requirement key)` sees the async
      // case a depth counter cannot. That is the fix, and it is a design, not
      // an edit.
      reconcileDepth = 0;

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
    } else if (isDevelopment) {
      console.warn(
        `[Directive] Unknown event type "${eventName}". No handler is registered for this event. Available events: ${Object.keys(mergedEvents).join(", ") || "(none)"}`,
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

  /** The tags authored on a fact's schema declaration, if any. */
  function factTags(key: string): readonly string[] {
    const meta = (mergedSchema[key as keyof S] as { _meta?: DefinitionMeta })
      ?._meta;

    return meta?.tags ?? [];
  }

  /**
   * The tags a derivation picks up from the facts it reads.
   *
   * A tag on a fact is a claim about the *value*, and a derivation that reads
   * the fact carries that value forward — sometimes verbatim. Before this,
   * `meta.byTag("pii")` answered with the tagged fact alone, so a derivation
   * returning `facts.email` unchanged read as non-sensitive to every
   * tag-driven consumer: the audit ledger, the clobber alerts, any redactor a
   * user wrote against the tag. The graph that would have answered the question
   * was already being maintained for invalidation; nothing was asking it.
   *
   * Transitive through composition — a derivation reading a derivation reading
   * a tagged fact inherits — with a visited set, because the derivation graph
   * is a DAG only by convention and a cycle here would be an infinite walk
   * rather than a caught error.
   *
   * **What this cannot see.** Dependencies are what the last computation
   * actually read. A body that branches on a fact records the branch the
   * current state takes, so `(facts) => facts.consented ? facts.email : ""`
   * inherits `pii` while `consented` is true and stops when it flips. That is
   * accurate about the value right now and silent about the value in another
   * state, which is worth knowing before treating this as an exhaustive audit.
   * The honest reading of `byTag("pii")` is "every value that carries PII in
   * the state the system is in", not "every value that ever could".
   */
  function inheritedTagsFor(id: string): string[] {
    const authored = derivationsManager.getMeta(
      id as keyof DerivationsDef<S>,
    ) as DefinitionMeta | undefined;
    if (authored?.tagBoundary === true) {
      return [];
    }

    const tags = new Set<string>();
    const seen = new Set<string>();
    const queue = [id];

    while (queue.length > 0) {
      const current = queue.pop()!;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);

      const edges = derivationsManager.dependencyEdges(current);
      for (const factKey of edges.facts) {
        for (const tag of factTags(factKey)) {
          tags.add(tag);
        }
      }
      for (const upstream of edges.derivations) {
        // An upstream derivation that opted out is a stated boundary — it
        // says the value stops being what its inputs were, and walking past
        // it would overrule the person who said so.
        const upstreamMeta = derivationsManager.getMeta(
          upstream as keyof DerivationsDef<S>,
        ) as DefinitionMeta | undefined;
        if (upstreamMeta?.tagBoundary === true) {
          continue;
        }
        queue.push(upstream);
      }
    }

    // Authored tags are already reported as authored; this is the difference.
    for (const tag of authored?.tags ?? []) {
      tags.delete(tag);
    }

    return [...tags];
  }

  /**
   * The runtime's own copy of every fact's tags, built at registration.
   *
   * `carriesTag("fact", …)` is asked on every write by anything that redacts,
   * so it reads from here rather than from the schema object — which a consumer
   * holds a reference to. Tags decide what gets redacted; the answer should not
   * come from somewhere the answer can be edited.
   */
  const factTagSets = new Map<string, ReadonlySet<string>>();
  const EMPTY_TAGS: ReadonlySet<string> = new Set();

  function recordFactTags(schema: Record<string, unknown>): void {
    for (const key of Object.keys(schema)) {
      const meta = (schema[key] as { _meta?: DefinitionMeta })?._meta;
      const tags = meta?.tags;
      // EVERY key, including untagged ones. Membership in this map is what
      // separates "recorded, and carries nothing" from "not recorded yet" —
      // and only the first of those is an answer. Recording tagged keys alone
      // made an unrecorded key indistinguishable from an untagged one, so a
      // key that reached the schema before its tags did read as definitively
      // clean instead of unknown.
      factTagSets.set(
        key,
        tags && tags.length > 0 ? new Set(tags) : EMPTY_TAGS,
      );
    }
  }

  recordFactTags(mergedSchema as Record<string, unknown>);

  /**
   * Told whenever the set `collectAllMeta` walks can have changed.
   *
   * Answering `byTag` means walking every definition in the system, which is
   * why anything consulting it on a hot path used to cache the answer. Those
   * caches had no way to learn they had gone stale short of re-walking — so
   * they were built once and kept forever, and a fact registered by a later
   * module was simply never in them. A guardrail screening tagged facts stopped
   * screening the ones that arrived after it started, and reported nothing,
   * because "not in the set" and "clean" are the same answer.
   *
   * Pushing the signal instead of publishing a number to poll removes the whole
   * shape: there is no marker to advance early, and no cache to leave empty.
   */
  const metaSubscribers = new Set<() => void>();

  function notifyMetaSubscribers(): void {
    // Snapshot: a listener that subscribes while being notified would
    // otherwise be visited in the same pass, and one that does it every time
    // never terminates.
    for (const listener of [...metaSubscribers]) {
      try {
        listener();
      } catch (error) {
        console.error("[Directive] Metadata subscriber error:", { error });
      }
    }
  }

  /** Collect all definitions with meta across all types (for byTag). */
  function collectAllMeta(): MetaMatch[] {
    // Fenced off the tracking stack. Walking the tag graph forces derivations
    // to compute, and forcing goes through the same accessor a derivation body
    // uses — which records a dependency when it runs inside a tracking frame.
    // A plugin asking a metadata question from inside a constraint's `when` or
    // an effect's batch would otherwise write every derivation into that
    // reader's dependency set.
    //
    // Defensive: the mechanism is plain in `manager.get`, but six attempts to
    // observe the symptom measured no growth, so this is inert if the path is
    // unreachable and correct if it is not. Asking a question about the system
    // is not reading a value from it either way.
    return withoutTracking(() => collectAllMetaUnfenced());
  }

  function collectAllMetaUnfenced(): MetaMatch[] {
    const results: MetaMatch[] = [];
    for (const [id, meta] of moduleMeta) {
      results.push({ kind: "module", id, meta, tagOrigin: "authored" });
    }
    for (const key of Object.keys(mergedSchema)) {
      const meta = (mergedSchema[key as keyof S] as { _meta?: DefinitionMeta })
        ?._meta;
      if (meta)
        results.push({ kind: "fact", id: key, meta, tagOrigin: "authored" });
    }
    for (const [name, meta] of eventMeta) {
      results.push({ kind: "event", id: name, meta, tagOrigin: "authored" });
    }
    for (const [id, def] of Object.entries(mergedConstraints)) {
      if (def.meta)
        results.push({
          kind: "constraint",
          id,
          meta: def.meta,
          tagOrigin: "authored",
        });
    }
    for (const [id, def] of Object.entries(mergedResolvers)) {
      if (def.meta)
        results.push({
          kind: "resolver",
          id,
          meta: def.meta,
          tagOrigin: "authored",
        });
    }
    for (const [id, def] of Object.entries(mergedEffects)) {
      const meta = (def as { meta?: DefinitionMeta }).meta;
      if (meta)
        results.push({ kind: "effect", id, meta, tagOrigin: "authored" });
    }
    for (const id of Object.keys(mergedDerive)) {
      const meta = derivationsManager.getMeta(id as keyof DerivationsDef<S>);
      if (meta) {
        results.push({ kind: "derivation", id, meta, tagOrigin: "authored" });
      }
      // A derivation with no authored meta at all still carries whatever its
      // inputs are tagged with — that case is the whole point, since nobody
      // annotates a derivation they think is uninteresting.
      const inherited = inheritedTagsFor(id);
      if (inherited.length > 0) {
        results.push({
          kind: "derivation",
          id,
          meta: Object.freeze(
            Object.assign(Object.create(null), meta, { tags: inherited }),
          ),
          tagOrigin: "inherited",
        });
      }
    }

    return results;
  }

  // Create the system interface
  const system: System<any> = {
    facts,
    history: historyManager.isEnabled ? historyManager : null,
    derive: deriveAccessor as any,
    events: eventsAccessor,
    constraints: {
      disable: (id: string) => constraintsManager.disable(id),
      enable: (id: string) => constraintsManager.enable(id),
      isDisabled: (id: string) => constraintsManager.isDisabled(id),
      register: (id: string, def: any) => {
        definitions.register("constraint", id, def);
      },
      assign: (id: string, def: any) => {
        definitions.assign("constraint", id, def);
      },
      unregister: (id: string) => {
        definitions.unregister("constraint", id);
        // Reset the binding-disabled sticky bits so a constraint
        // re-registered under the same id can fire the warn/event
        // again the first time its async state is observed.
        bindingDisabledNotified.delete(`${id}::async-declared`);
        bindingDisabledNotified.delete(`${id}::async-promoted`);
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
      register: (id: string, def: any) => {
        definitions.register("effect", id, def);
      },
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
      register: (id: string, def: any) => {
        definitions.register("resolver", id, def);
        syncResolverKeys({ [id]: def } as ResolversDef<S>);
      },
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

    meta: {
      module(id: string): DefinitionMeta | undefined {
        return moduleMeta.get(id);
      },
      fact(key: string): DefinitionMeta | undefined {
        const schemaType = mergedSchema[key as keyof S];
        return (schemaType as { _meta?: DefinitionMeta } | undefined)?._meta;
      },
      event(name: string): DefinitionMeta | undefined {
        return eventMeta.get(name);
      },
      constraint(id: string): DefinitionMeta | undefined {
        return mergedConstraints[id]?.meta;
      },
      resolver(id: string): DefinitionMeta | undefined {
        return mergedResolvers[id]?.meta;
      },
      effect(id: string): DefinitionMeta | undefined {
        return (mergedEffects[id] as { meta?: DefinitionMeta } | undefined)
          ?.meta;
      },
      derivation(id: string): DefinitionMeta | undefined {
        const authored = derivationsManager.getMeta(
          id as keyof DerivationsDef<S>,
        );
        const inherited = withoutTracking(() => inheritedTagsFor(id));
        if (inherited.length === 0) {
          return authored;
        }

        return Object.freeze(
          Object.assign(Object.create(null), authored, {
            inheritedTags: Object.freeze(inherited),
          }),
        );
      },
      byTag(tag: string, options?: { kind?: DefinitionKind }): MetaMatch[] {
        const wanted = options?.kind;

        return collectAllMeta().filter(
          (m) =>
            (wanted === undefined || m.kind === wanted) &&
            m.meta.tags?.includes(tag),
        );
      },
      carriesTag(
        kind: DefinitionKind,
        id: string,
        tag: string,
      ): boolean | undefined {
        // Facts are the hot-path case: asked on every write by anything that
        // redacts. Answered from the runtime's own copy, so it costs a map
        // lookup and cannot be edited from outside.
        if (kind === "fact") {
          // Absent from the recorded map means the runtime has no answer,
          // whether the key is unknown or merely arrived ahead of its tags.
          // Reporting `false` there is how an untagged key and an
          // unrecorded one became the same answer, which is the whole class
          // of defect this accessor exists to avoid.
          const recorded = factTagSets.get(id);

          return recorded === undefined ? undefined : recorded.has(tag);
        }

        if (kind === "derivation") {
          if (!Object.hasOwn(mergedDerive, id)) {
            return undefined;
          }
          const authored = derivationsManager.getMeta(
            id as keyof DerivationsDef<S>,
          );
          if (authored?.tags?.includes(tag)) {
            return true;
          }
          // Walking a derivation means running it, and a body that throws must
          // not decide what gets redacted. "Could not answer" is a third state
          // for exactly this.
          try {
            return withoutTracking(() => inheritedTagsFor(id).includes(tag));
          } catch {
            return undefined;
          }
        }

        // A switch rather than an object lookup: `kind` reaching
        // `Object.prototype` through a literal would answer for the wrong thing.
        switch (kind) {
          case "module":
            return moduleMeta.has(id)
              ? (moduleMeta.get(id)?.tags?.includes(tag) ?? false)
              : undefined;
          case "event":
            return eventMeta.has(id)
              ? (eventMeta.get(id)?.tags?.includes(tag) ?? false)
              : undefined;
          case "constraint":
            return Object.hasOwn(mergedConstraints, id)
              ? (mergedConstraints[id]?.meta?.tags?.includes(tag) ?? false)
              : undefined;
          case "resolver":
            return Object.hasOwn(mergedResolvers, id)
              ? (mergedResolvers[id]?.meta?.tags?.includes(tag) ?? false)
              : undefined;
          case "effect":
            return Object.hasOwn(mergedEffects, id)
              ? ((
                  mergedEffects[id] as { meta?: DefinitionMeta } | undefined
                )?.meta?.tags?.includes(tag) ?? false)
              : undefined;
          default:
            return undefined;
        }
      },
      subscribe(
        tagsOrListener: readonly string[] | (() => void),
        listenerOrOptions?: (() => void) | { immediate?: boolean },
        maybeOptions?: { immediate?: boolean },
      ): () => void {
        const listener =
          typeof tagsOrListener === "function"
            ? tagsOrListener
            : (listenerOrOptions as () => void);
        const options =
          typeof tagsOrListener === "function"
            ? (listenerOrOptions as { immediate?: boolean } | undefined)
            : maybeOptions;

        // The tag list narrows nothing today — every metadata change can move
        // any tag's answer, and waking a listener that did not need it is the
        // correct direction to be wrong in. It is accepted so consumers can say
        // what they hold, and so this can narrow later without a signature
        // change.
        metaSubscribers.add(listener);

        if (options?.immediate) {
          listener();
        }

        return () => {
          metaSubscribers.delete(listener);
        };
      },
    },

    notify: {
      guardrailBlocked(
        plugin: string,
        key: string,
        kind: "redact" | "alert" | "detect",
        count: number,
        category?: string,
      ): void {
        // the public surface accepts a caller-supplied
        // `plugin` string. A malicious or buggy third-party plugin
        // holding a `System` ref could otherwise forge audit events
        // claiming `plugin: "fact-pii-guardrail"` (or any other
        // guardrail's name). The validation: the `plugin` MUST match
        // a currently-registered plugin's `name`. This prevents
        // unknown-plugin forgery; it does NOT prevent one registered
        // plugin from impersonating another (a deeper RFC tracking
        // per-plugin notify handles will close that). Today's bar:
        // observability + audit consumers can trust the `plugin`
        // field corresponds to SOME plugin actually mounted, not an
        // arbitrary string from a hostile module.
        if (state.isDestroyed) return;
        if (!hasPlugins()) return;
        // Reentry depth cap — prevents a plugin's `onGuardrailBlocked`
        // hook from synchronously calling back into
        // `notify.guardrailBlocked` and recursing through the
        // broadcast fabric until stack overflow. Allow shallow
        // re-emission (one plugin reacting to another's emission)
        // but bail on pathological recursion.
        if (guardrailNotifyDepth >= 4) return;
        // Plugin-name validation. `getPlugins()` is O(N) in the
        // plugin count; in practice N is small (single-digit) so the
        // cost is acceptable on the hot path.
        const pluginExists = pluginManager
          .getPlugins()
          .some((p) => p.name === plugin);
        if (!pluginExists) {
          if (isDevelopment) {
            // eslint-disable-next-line no-console
            console.warn(
              `[Directive] system.notify.guardrailBlocked called with unknown plugin "${plugin}". Event dropped.`,
            );
          }
          return;
        }
        guardrailNotifyDepth += 1;
        try {
          pluginManager.emitGuardrailBlocked(
            plugin,
            key,
            kind,
            count,
            category,
          );
        } finally {
          guardrailNotifyDepth -= 1;
        }
      },
      guardrailCoverage(
        plugin: string,
        screenedCount: number,
        screenedDigest: string,
        reason: "start" | "tags-changed" | "unanswerable",
      ): void {
        if (state.isDestroyed) return;
        if (!hasPlugins()) return;
        pluginManager.emitGuardrailCoverage(
          plugin,
          screenedCount,
          screenedDigest,
          reason,
        );
      },
      clobberLoopDetected(event): void {
        if (state.isDestroyed) return;
        if (!hasPlugins()) return;
        // Same reentry cap as guardrailBlocked — a plugin reacting to
        // the loop event must not re-emit synchronously and recurse.
        if (guardrailNotifyDepth >= 4) return;
        guardrailNotifyDepth += 1;
        try {
          pluginManager.emitClobberLoopDetected(event);
        } finally {
          guardrailNotifyDepth -= 1;
        }
      },
      clobberLoopResolved(event): void {
        if (state.isDestroyed) return;
        if (!hasPlugins()) return;
        if (guardrailNotifyDepth >= 4) return;
        guardrailNotifyDepth += 1;
        try {
          pluginManager.emitClobberLoopResolved(event);
        } finally {
          guardrailNotifyDepth -= 1;
        }
      },
    },

    observe(
      observer: (event: import("./types/system.js").ObservationEvent) => void,
    ): () => void {
      // Cap observers to prevent memory leaks from fast-remounting components
      const observerCount = pluginManager
        .getPlugins()
        .filter((p) => p.name.startsWith("__observer_")).length;
      if (observerCount >= 100) {
        if (isDevelopment) {
          console.warn(
            "[Directive] Maximum observer limit (100) reached. Call the unsubscribe function returned by observe() to clean up.",
          );
        }

        return () => {};
      }
      const name = `__observer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const plugin = {
        name,
        onInit: () => observer({ type: "system.init" }),
        onStart: () => observer({ type: "system.start" }),
        onStop: () => observer({ type: "system.stop" }),
        onDestroy: () => observer({ type: "system.destroy" }),
        onFactSet: (key: string, value: unknown, prev: unknown) =>
          observer({ type: "fact.change", key, prev, next: value }),
        onFactsBatch: (changes: import("./types/facts.js").FactChange[]) => {
          // Without this arm a write inside `system.batch()` reached no
          // observer at all, while the identical write outside one was
          // reported. Event handlers, effects, resolvers before their first
          // await, `initialFacts`, `hydrate` and every history restore write
          // through a batch — so a durable sink behind `observe()` was blind
          // to most of the writes in a running system, and suppressing an
          // entry took nothing more privileged than wrapping the write.
          //
          // Coalesced per key, because a batch is one transition and a body
          // that writes a key in a loop should not produce an entry per
          // iteration. Measured: a hundred thousand writes to one key in a
          // single batch produced a hundred thousand events and blocked for
          // 491ms, while the listener side — which already coalesces — saw
          // one. First `prev` and last value are kept, so the pair still
          // describes the transition the batch actually made.
          //
          // A key written and written back keeps its entry. The net pair is
          // `prev === next`, which reads as noise, but dropping it would be
          // one more way for a batch to leave no trace — which is the whole
          // defect this closes.
          const net = new Map<string, { prev: unknown; next: unknown }>();
          for (const change of changes) {
            const next = change.type === "delete" ? undefined : change.value;
            const seen = net.get(change.key);
            if (seen) {
              seen.next = next;
            } else {
              net.set(change.key, { prev: change.prev, next });
            }
          }
          // `isRestoring` is engine-internal and derived from the history
          // manager's own state, so the label cannot be set by a caller —
          // reaching it means actually replaying a snapshot.
          const restoring = historyRef?.isRestoring === true;
          for (const [key, { prev, next }] of net) {
            observer(
              restoring
                ? { type: "fact.change", key, prev, next, origin: "restore" }
                : { type: "fact.change", key, prev, next },
            );
          }
        },
        onConstraintEvaluate: (
          id: string,
          active: boolean,
          whenExplain?: import("./types/predicate.js").ClauseResult[],
        ) => {
          // The engine's onEvaluate forwards whenExplain through the plugin
          // manager — observers receive it as a third arg. Function-form
          // `when` gives `undefined`, which the typed event treats as
          // "no explain available".
          observer(
            whenExplain
              ? { type: "constraint.evaluate", id, active, whenExplain }
              : { type: "constraint.evaluate", id, active },
          );
        },
        onConstraintError: (id: string, error: unknown) =>
          observer({ type: "constraint.error", id, error }),
        onConstraintBindingDisabled: (
          id: string,
          reason: "async-declared" | "async-promoted",
        ) => observer({ type: "constraint.binding.disabled", id, reason }),
        onRequirementCreated: (req: {
          id: string;
          requirement: { type: string };
        }) =>
          observer({
            type: "requirement.created",
            id: req.id,
            requirementType: req.requirement.type,
          }),
        onRequirementMet: (req: { id: string }, byResolver: string) =>
          observer({ type: "requirement.met", id: req.id, byResolver }),
        onRequirementCanceled: (req: { id: string }) =>
          observer({ type: "requirement.canceled", id: req.id }),
        onResolverStart: (resolver: string, req: { id: string }) =>
          observer({ type: "resolver.start", resolver, requirementId: req.id }),
        onResolverComplete: (
          resolver: string,
          req: { id: string },
          duration: number,
        ) =>
          observer({
            type: "resolver.complete",
            resolver,
            requirementId: req.id,
            duration,
          }),
        onResolverError: (
          resolver: string,
          req: { id: string },
          error: unknown,
        ) =>
          observer({
            type: "resolver.error",
            resolver,
            requirementId: req.id,
            error,
          }),
        onResolverWriteRejected: (
          event:
            | {
                kind: "rejection";
                resolver: string;
                req: { id: string };
                reason: "clobbered";
                fact: string;
                expected: unknown;
                actual: unknown;
              }
            | {
                kind: "summary";
                resolver: string;
                req: { id: string };
                reason: "clobbered";
                dropped: number;
              },
        ) => {
          if (event.kind === "summary") {
            observer({
              type: "resolver.write.rejected",
              kind: "summary",
              resolver: event.resolver,
              requirementId: event.req.id,
              reason: event.reason,
              dropped: event.dropped,
            });

            return;
          }

          observer({
            type: "resolver.write.rejected",
            kind: "rejection",
            resolver: event.resolver,
            requirementId: event.req.id,
            reason: event.reason,
            fact: event.fact,
            expected: event.expected,
            actual: event.actual,
          });
        },
        onEffectRun: (id: string) => observer({ type: "effect.run", id }),
        onEffectError: (id: string, error: unknown) =>
          observer({ type: "effect.error", id, error }),
        onSourceAttach: (id: string, moduleId: string) =>
          observer({ type: "source.attach", id, moduleId }),
        onSourcePublish: (id: string, moduleId: string, eventName: string) =>
          observer({ type: "source.publish", id, moduleId, eventName }),
        onSourceDrop: (
          id: string,
          moduleId: string,
          eventName: string,
          reason: import("./types/sources.js").SourceDropReason,
        ) => observer({ type: "source.drop", id, moduleId, eventName, reason }),
        onSourceDetach: (id: string, moduleId: string) =>
          observer({ type: "source.detach", id, moduleId }),
        onSourceError: (
          id: string,
          moduleId: string,
          phase: "attach" | "cleanup" | "runtime" | "gate",
          error: unknown,
        ) => observer({ type: "source.error", id, moduleId, phase, error }),
        onGuardrailBlocked: (
          plugin: string,
          key: string,
          kind: "redact" | "alert" | "detect",
          count: number,
          category?: string,
        ) =>
          observer({
            type: "guardrail.blocked",
            plugin,
            key,
            kind,
            count,
            ...(category !== undefined ? { category } : {}),
          }),
        onGuardrailCoverage: (
          plugin: string,
          screenedCount: number,
          screenedDigest: string,
          reason: "start" | "tags-changed" | "unanswerable",
        ) =>
          observer({
            type: "guardrail.coverage",
            plugin,
            screenedCount,
            screenedDigest,
            reason,
          }),
        onClobberLoopDetected: (
          event: import("./types/system.js").ObservationEvent & {
            type: "resolver.clobber.loop.detected";
          },
        ) => observer(event),
        onClobberLoopResolved: (
          event: import("./types/system.js").ObservationEvent & {
            type: "resolver.clobber.loop.resolved";
          },
        ) => observer(event),
        onDerivationCompute: (id: string, value: unknown) =>
          observer({ type: "derivation.compute", id, value }),
        onReconcileStart: () => observer({ type: "reconcile.start" }),
        onReconcileEnd: (result: unknown) => {
          const r = result as {
            completed?: unknown[];
            canceled?: unknown[];
          };
          observer({
            type: "reconcile.end",
            resolversCompleted: Array.isArray(r.completed)
              ? r.completed.length
              : 0,
            resolversCanceled: Array.isArray(r.canceled)
              ? r.canceled.length
              : 0,
          });
        },
      };
      pluginManager.register(plugin);

      return () => pluginManager.unregister(name);
    },

    initialize(): void {
      if (state.isInitialized) return;
      state.isInitializing = true;

      // Run module init functions (sets initial fact values)
      for (const module of config.modules) {
        if (module.init) {
          store.batch(() => {
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
      // follow-up — refuse to start while an eviction is in flight
      // or after the system has been destroyed. Both are terminal-ish:
      // `isEvicting` is cleared in the evict() try/finally only on the
      // happy path through `destroyAsync()` (which also sets
      // `isDestroyed`). A `start()` call between `evict()`'s
      // `sourcesManager.evictAll()` and its `destroyAsync()` would
      // otherwise re-attach sources that the host runtime told us to
      // tear down.
      if (state.isEvicting) {
        if (isDevelopment) {
          // eslint-disable-next-line no-console
          console.warn(
            "[Directive] system.start() called during evict() — ignored. Re-create the system after destroyAsync() resolves.",
          );
        }
        return;
      }
      if (state.isDestroyed) {
        if (isDevelopment) {
          // eslint-disable-next-line no-console
          console.warn(
            "[Directive] system.start() called after destroy — ignored. Systems are not reusable; create a new one.",
          );
        }
        return;
      }

      // Ensure facts are initialized (no-op if already called)
      if (!state.isInitialized) {
        this.initialize();
      }

      state.isRunning = true;

      // Module onStart hooks (may access browser APIs — only in start())
      for (const module of config.modules) {
        module.hooks?.onStart?.(system as any);
      }

      // Attach external event sources. The dispatcher receives accurate
      // per-source attribution (sourceId, moduleId) from the manager — the
      // manager closure-wraps each source's publish callback with its own
      // identity so the engine's plugin emission cannot mis-attribute when
      // two sources publish the same event name. The post-destroy guard
      // prevents stale source callbacks from dispatching into a torn-down
      // store. `onAttach` plugin events fire from inside the manager (one
      // per successful attach), so the static-start path AND the
      // `registerModule` immediate-attach path emit consistently.
      sourcesManager.attachAll((_sourceId, _moduleId, eventName, payload) => {
        // Guards parity with the system.dispatch path (engine.ts:1692):
        //   - drop publishes after `system.destroy()` (engine-wide invariant)
        //   - drop publishes after `system.stop()` and before the next
        //     `system.start()` — a leaked external transport firing in that
        //     window would otherwise mutate facts on a stopped system
        //   - drop publishes whose event name would walk the prototype chain
        //     (`__proto__`, `constructor`, `prototype`) — mirrors the
        //     BLOCKED_PROPS check `system.dispatch` already enforces
        //   - drop empty / non-string event names so log/audit sinks aren't
        //     forced to render placeholder rows
        //
        // Return the outcome to the manager so per-source telemetry can
        // attribute the drop to a specific reason and so plugin `onPublish`
        // does NOT fire for swallowed events.
        if (state.isDestroyed)
          return { accepted: false, reason: "post-destroy" };
        if (!state.isRunning) return { accepted: false, reason: "post-stop" };
        if (typeof eventName !== "string" || eventName.length === 0) {
          return { accepted: false, reason: "invalid-event-name" };
        }
        if (BLOCKED_PROPS.has(eventName)) {
          return { accepted: false, reason: "blocked-event-name" };
        }
        dispatchEventByName(
          eventName,
          (payload ?? {}) as Record<string, unknown>,
        );
        return { accepted: true };
      });

      // RFC 0012: initial gated attach. `attachAll` above attached only the
      // UNGATED sources; gated/keyed sources evaluate their `key`/`active`
      // gate against the committed facts here so a source whose gate is
      // already open at start attaches synchronously (before the first
      // reconcile), and one whose gate is shut stays detached. Subsequent
      // re-evaluation happens on the post-commit effects plane.
      sourcesManager.evaluateGated(facts as unknown as Record<string, unknown>);

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
      resolversManager.abortAll();

      // Detach external event sources BEFORE running effect cleanups so any
      // sources that share resources with effects (rare but possible) see
      // the source-side first. Failures inside individual unsubscribes are
      // isolated by the manager. `onDetach` plugin events fire from inside
      // the manager (one per source, in reverse-registration order) so we
      // don't need to iterate-and-emit here.
      sourcesManager.cleanupAll();

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
      // Clean up trace state
      traceManager.destroy();
      // Clean up dynamic definition state
      definitions.destroy();
      // Clean up meta Maps
      moduleMeta.clear();
      metaSubscribers.clear();
      eventMeta.clear();
      // Drop any pending ctx.requeue() requests
      pendingRequeueIds.clear();
      pluginManager.emitDestroy(system);
    },

    async stopAsync(): Promise<void> {
      // RFC 0009: async-aware variant of stop(). Mirrors sync stop()
      // step-for-step but awaits the source unsubscribes so external
      // transports (Supabase channel.unsubscribe(), DO storage flush)
      // actually complete before the caller continues.
      if (!state.isRunning) return;
      state.isRunning = false;
      if (retryLaterTimer !== null) {
        clearInterval(retryLaterTimer);
        retryLaterTimer = null;
      }
      errorBoundary.getRetryLaterManager().clearAll();
      resolversManager.abortAll();
      await sourcesManager.cleanupAllAsync();
      effectsManager.cleanupAll();
      for (const module of config.modules) {
        module.hooks?.onStop?.(system);
      }
      pluginManager.emitStop(system);
    },

    async destroyAsync(): Promise<void> {
      if (state.isDestroyed) return;
      await this.stopAsync();
      state.isDestroyed = true;
      (store as unknown as Record<string, () => void>).destroy?.();
      resolversManager.destroy();
      errorBoundary.clearErrors();
      settlementListeners.clear();
      historyListeners.clear();
      traceManager.destroy();
      definitions.destroy();
      moduleMeta.clear();
      metaSubscribers.clear();
      eventMeta.clear();
      pendingRequeueIds.clear();
      pluginManager.emitDestroy(system);
    },

    async evict(deadline?: number): Promise<void> {
      // RFC 0009: signal that the host runtime is about to evict.
      // Fires every source's onEvict in registration order (so sources
      // with downstream dependencies close in the right order), then
      // delegates to destroyAsync to complete teardown. If `deadline`
      // is supplied, the entire eviction is raced against the deadline
      // — a partial teardown is better than a hang while the runtime
      // is impatient to evict.
      //
      // Bug-fix per deadline<=0 used to construct the IIFE,
      // return synchronously, and let the IIFE run detached with no
      // error path. Now we either await it or attach a swallow-catch
      // so the unhandled-rejection surface is bounded.
      //
      // follow-up: reentry gate. Cloudflare DO hibernation can
      // fire eviction twice; without the gate, the second call
      // re-runs every source's `onEvict` — sources that aren't
      // idempotent would double-fire. Set BEFORE awaiting any async
      // work so concurrent calls observe the in-flight state and
      // become no-ops.
      if (state.isEvicting || state.isDestroyed) return;
      state.isEvicting = true;
      // follow-up — the inner work can reject (a plugin's
      // `onDestroy` throws, a source's `onEvict` rejects, the host
      // runtime cancels mid-await). Without try/finally, `isEvicting`
      // would latch forever — and the engine's terminal-state
      // contract is "isDestroyed === true OR future calls are
      // no-ops with diagnostics". A rejected eviction leaves the
      // engine alive but blacklisted from future evict() calls.
      // Always clear `isEvicting` in finally; the terminal flag
      // (`isDestroyed`) is set by `destroyAsync()` on the happy path
      // and stays unset (system is still alive) on rejection.
      const buildEvictWork = () =>
        (async () => {
          await sourcesManager.evictAll();
          await this.destroyAsync();
        })().finally(() => {
          state.isEvicting = false;
        });
      if (deadline !== undefined && deadline - Date.now() <= 0) {
        // Synchronous deadline: kick off the eviction with a
        // swallow-catch (every per-source error already routes through
        // the manager's `phase: "runtime"` sink, so silencing the
        // composite promise here doesn't lose signal) and return
        // immediately. The runtime evicts the isolate before the work
        // would have completed anyway.
        const detached = buildEvictWork();
        detached.catch(() => {});
        return;
      }
      const evictWork = buildEvictWork();
      if (deadline === undefined) {
        await evictWork;
        return;
      }
      const remaining = deadline - Date.now();
      // After the race, evictWork may still be running. Attach a
      // swallow-catch so a late rejection doesn't surface as
      // unhandledRejection in the host runtime.
      evictWork.catch(() => {});
      await Promise.race([
        evictWork,
        new Promise<void>((resolve) => setTimeout(resolve, remaining)),
      ]);
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
        } else if (isDevelopment) {
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
      if (isDevelopment) {
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

        // biome-ignore lint/style/useConst: assigned once, but must stay `let` — `cleanup` (defined below) closes over it before the subscribeAll assignment, and subscribeAll may emit synchronously
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
        // Derivations that have moved and not yet been announced. Zero on a
        // system that has finished; non-zero on one that has merely stopped.
        // The distinction is invisible from every other field here, and it is
        // the one that separates a correct settle from a premature one.
        pendingInvalidations: derivationsManager.pendingInvalidationCount(),
        // How many derivations something outside the derivation graph watches.
        // The per-reconcile invalidation walk is bounded against this, so it is
        // the number that explains that walk's cost — and the number that shows
        // a reader registering a node nothing external is actually waiting on.
        observedDerivations: derivationsManager.observedCount(),
        facts: Object.keys(mergedSchema).map((key) => ({
          key,
          meta: (
            mergedSchema[key as keyof S] as
              | { _meta?: DefinitionMeta }
              | undefined
          )?._meta,
        })),
        events: Object.keys(mergedEvents).map((name) => ({
          name,
          meta: eventMeta.get(name),
        })),
        constraints: constraintsManager.getAllStates().map((s) => {
          const whenSpec = constraintsManager.getWhenSpec(s.id);
          // (F1) Surface `abortOn:` from the merged constraint def so
          // `doctor.checkAbortOn()` can flag candidates that would race
          // or shadow these writes. `bind` slot reserved for v2.
          const def = mergedConstraints[s.id];
          const abortOn =
            def?.abortOn && def.abortOn.length > 0 ? def.abortOn : undefined;

          return {
            id: s.id,
            active: s.lastResult ?? false,
            disabled: constraintsManager.isDisabled(s.id),
            priority: s.priority,
            hitCount: s.hitCount,
            lastActiveAt: s.lastActiveAt,
            meta: def?.meta,
            ...(whenSpec ? { whenSpec } : {}),
            ...(abortOn ? { abortOn } : {}),
          };
        }),
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
          meta: def.meta,
        })),
        effects: Object.entries(mergedEffects).map(([id, def]) => ({
          id,
          meta: (def as { meta?: DefinitionMeta }).meta,
        })),
        sources: sourcesManager.listDefinitions().map((row) => ({
          id: row.id,
          moduleId: row.moduleId,
          meta: row.meta as DefinitionMeta | undefined,
          attached: row.attached,
          attachedAt: row.attachedAt,
          detachedAt: row.detachedAt,
          publishCount: row.publishCount,
          lastPublishAt: row.lastPublishAt,
          dropCount: row.dropCount,
          lastDropReason: row.lastDropReason,
          lastDropAt: row.lastDropAt,
          errorCount: row.errorCount,
          lastError: row.lastError,
        })),
        attachedSourceCount: sourcesManager.attachedCount(),
        derivations: Object.keys(mergedDerive).map((id) => ({
          id,
          meta: derivationsManager.getMeta(id as keyof DerivationsDef<S>),
        })),
        modules: config.modules.map((m) => ({
          id: m.id,
          meta: moduleMeta.get(m.id),
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

      // Get the relevant values from the constraint's tracked dependencies.
      // A `when()` may have been gated on a derivation rather than a fact, and
      // an explanation that dropped those (or looked them up in the fact store,
      // where they are not) would show `undefined` for the value the constraint
      // actually turned on.
      const relevantFacts: Record<string, unknown> = {};
      const constraintDeps = constraintsManager.getDependencies(
        req.fromConstraint,
      );
      if (constraintDeps) {
        for (const dep of constraintDeps) {
          relevantFacts[describeDep(dep)] = isDerivationDep(dep)
            ? derivationsManager.get(
                derivationDepId(dep) as keyof DerivationsDef<S>,
              )
            : store.get(dep);
        }
      } else {
        // Fallback: include all facts if deps not tracked
        for (const [key, value] of Object.entries(store.toObject())) {
          relevantFacts[key] = value;
        }
      }

      const constraintDef = mergedConstraints[req.fromConstraint];
      const constraintLabel = constraintDef?.meta?.label ?? req.fromConstraint;

      const lines: string[] = [
        `Requirement "${req.requirement.type}" (id: ${req.id})`,
        `├─ Produced by constraint: ${constraintLabel}`,
        `├─ Constraint priority: ${constraintState?.priority ?? 0}`,
        `├─ Constraint active: ${constraintState?.lastResult ?? "unknown"}`,
        `├─ Resolver status: ${resolverStatus.state}`,
      ];

      if (constraintDef?.meta?.description) {
        lines.push(`├─ Description: ${constraintDef.meta.description}`);
      }

      // If the constraint's `when` was declared as a FactPredicate, render
      // the per-clause ✓/✗ breakdown — only the data form makes this
      // possible, so it's surfaced here as the "why did it fire" view.
      // Combinator clauses (`$all`, `$any`, `$not`) carry `children` and are
      // rendered as headers with their children indented.
      const clauses = constraintsManager.explainWhen(req.fromConstraint);
      const renderClause = (
        clause: import("./types/predicate.js").ClauseResult,
        indent: string,
        isLast: boolean,
      ): void => {
        const branch = isLast ? "└─" : "├─";
        const mark = clause.pass ? "✓" : "✗";
        if (clause.children) {
          // `$not` always wraps exactly one child — rendering "0/1" or "1/1"
          // for a unary inversion is paradoxical (the parent passes when the
          // child fails). Drop the fraction for `$not` and let the indented
          // child show its own ✓/✗.
          if (clause.op === "$not") {
            // $not passes when its child fails — annotate so the inverted
            // mark relative to the child isn't read as a contradiction.
            const note = clause.pass ? " (child failed)" : " (child passed)";
            lines.push(`${indent}${branch} ${mark} $not${note}`);
          } else {
            // Combinator header: "$all (2/3)"
            lines.push(
              `${indent}${branch} ${mark} ${clause.op} (${clause.actual}/${clause.expected})`,
            );
          }
          const childIndent = `${indent}${isLast ? "   " : "│  "}`;
          clause.children.forEach((child, i) => {
            renderClause(child, childIndent, i === clause.children!.length - 1);
          });

          return;
        }
        const expected =
          typeof clause.expected === "object"
            ? JSON.stringify(clause.expected)
            : String(clause.expected);
        const actual =
          clause.actual === undefined
            ? "undefined"
            : typeof clause.actual === "object"
              ? JSON.stringify(clause.actual)
              : String(clause.actual);
        lines.push(
          `${indent}${branch} ${mark} ${clause.path} ${clause.op} ${expected} (actual: ${actual})`,
        );
      };
      if (clauses && clauses.length > 0) {
        lines.push("├─ Predicate clauses:");
        clauses.forEach((clause, i) => {
          renderClause(clause, "│  ", i === clauses.length - 1);
        });
      }

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
        !resolversManager.hasPendingBatches() &&
        // A derivation that has moved and not been announced is work this
        // system still owes. Resolving here would report quiescence while
        // holding something to say — which is how a handler returns
        // pre-resolution state, and how a durable object hibernates over a
        // requirement that was never emitted.
        derivationsManager.pendingInvalidationCount() === 0;

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
        if (isDevelopment) {
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
          if (isDevelopment) {
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
        if (isDevelopment) {
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
        if (isDevelopment) {
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
        !state.reconcileScheduled &&
        // See the matching clause in `settle()`. Both answers to "is this
        // system finished" have to agree, or the polled one contradicts the
        // awaited one.
        derivationsManager.pendingInvalidationCount() === 0
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
    /** Typed external event sources (parity with static module merge). */
    sources?: Record<string, SourceDef>;
    constraints?: Record<string, unknown>;
    resolvers?: Record<string, unknown>;
    hooks?: {
      onInit?: (s: unknown) => void;
      onStart?: (s: unknown) => void;
      onStop?: (s: unknown) => void;
      onError?: (e: unknown, ctx: unknown) => void;
    };
    meta?: DefinitionMeta;
    history?: { snapshotEvents?: string[] };
  }): void {
    // Every exit below this point either throws or adds to what `collectAllMeta`
    // walks, so the revision moves once the guard has passed.
    // Guard: cannot register during reconciliation (would corrupt iteration state)
    if (state.isReconciling) {
      throw new Error(
        `[Directive] Cannot register module "${module.id}" during reconciliation. Wait for the current reconciliation cycle to complete.`,
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
            `[Directive] Module "${module.id}" has schema key "${key}" starting with "$". Keys starting with $ are reserved for internal accessors ($store, $snapshot).`,
          );
        }
      }
    };
    validateKeys(module.schema, "schema");
    validateKeys(module.events, "events");
    validateKeys(module.derive, "derive");
    validateKeys(module.effects, "effects");
    validateKeys(module.sources, "sources");
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
    if (isDevelopment && module.derive) {
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
    // Immediately after the merge, never later. A source registered by this
    // same module attaches synchronously further down and can publish an event
    // that writes one of these facts — so any statement between the key
    // becoming visible and its tags being recorded is a window in which the
    // fact exists and reads as untagged.
    recordFactTags(module.schema as Record<string, unknown>);
    // Freeze fact/schema field _meta for new module
    for (const schemaType of Object.values(
      module.schema as Record<string, unknown>,
    )) {
      const st = schemaType as { _meta?: DefinitionMeta };
      if (preparedSchemaTypes.has(st)) continue;
      preparedSchemaTypes.add(st);
      if (st._meta) st._meta = freezeMeta(st._meta)!;
      if (isOwnSchemaType(st)) {
        Object.freeze(st);
      }
    }
    if (module.events) {
      unwrapEventDefinitions(
        module.events as Record<string, unknown>,
        eventMeta,
      );
      Object.assign(mergedEvents, module.events);
    }
    if (module.derive) {
      Object.assign(mergedDerive, module.derive);
      // Register new derivations with the derivations manager
      derivationsManager.registerDefinitions(
        module.derive as DerivationsDef<S>,
      );
    }
    if (module.effects) {
      for (const def of Object.values(module.effects)) {
        const d = def as { meta?: DefinitionMeta };
        if (d.meta) d.meta = freezeMeta(d.meta)!;
      }
      Object.assign(mergedEffects, module.effects);
      effectsManager.registerDefinitions(module.effects as any);
    }
    if (module.sources) {
      Object.assign(mergedSources, module.sources);
      for (const sourceId of Object.keys(module.sources)) {
        sourceModuleIds[sourceId] = module.id;
      }
      // Surface the privilege change to plugins BEFORE attach so observers
      // see `definition.register` → `source.attach` in the same order
      // constraints / resolvers / derivations / effects publish. Reversing
      // would let an audit consumer record an attach for a source the
      // ledger never saw registered.
      //
      // We deliberately do NOT pass the raw `SourceDef` (whose `attach`
      // callback is the live external-subscription primitive). A malicious
      // or buggy plugin receiving the live def could call `def.attach(...)`
      // to install a parallel subscription bypassing the manager — the
      // manager wouldn't track it, wouldn't tear it down at stop(), and
      // wouldn't surface it via `inspect()`. Instead, hand plugins an
      // opaque descriptor that names the source but exposes nothing
      // callable. Plugins that need to react beyond the
      // attach/publish/detach hooks can subscribe to `system.observe()`
      // (forward-only) — they cannot reach the live attach callback.
      for (const [sourceId, def] of Object.entries(module.sources)) {
        const meta = (def as { meta?: DefinitionMeta }).meta;
        pluginManager.emitDefinitionRegister("source", sourceId, {
          moduleId: module.id,
          ...(meta !== undefined ? { meta } : {}),
        });
      }
      // The manager attaches new sources immediately when the system is in
      // the `attached` phase (i.e. `system.start()` has already run);
      // otherwise they queue for the next `attachAll`. Either way the
      // catalogue grows so `system.inspect().sources` reflects them.
      sourcesManager.registerDefinitions(module.id, module.sources);
    }
    if (module.constraints) {
      for (const def of Object.values(module.constraints)) {
        const d = def as { meta?: DefinitionMeta };
        if (d.meta) d.meta = freezeMeta(d.meta)!;
      }
      Object.assign(mergedConstraints, module.constraints);
      constraintsManager.registerDefinitions(module.constraints as any);
    }
    if (module.resolvers) {
      for (const def of Object.values(module.resolvers)) {
        const d = def as { meta?: DefinitionMeta };
        if (d.meta) d.meta = freezeMeta(d.meta)!;
      }
      Object.assign(mergedResolvers, module.resolvers);
      // Track resolver ownership for module-level hooks (e.g. onResolverError)
      for (const resolverId of Object.keys(module.resolvers)) {
        resolverIdToModule.set(
          resolverId,
          module as (typeof config.modules)[number],
        );
      }
      resolversManager.registerDefinitions(module.resolvers as any);
      // Sync resolver key functions to the constraints manager
      syncResolverKeys(module.resolvers as ResolversDef<S>);
    }

    // Register new schema keys with the facts store
    (store as any).registerKeys(module.schema as Record<string, unknown>);

    // Store module meta (frozen)
    if (module.meta) {
      const frozen = freezeMeta(module.meta);
      if (frozen) moduleMeta.set(module.id, frozen);
    }

    // Track the new module in config.modules for hooks
    config.modules.push(module as (typeof config.modules)[number]);

    // The module's definitions and its schema are in place, so anything holding
    // a tag answer is now holding a stale one. Told before init and the hooks
    // run, since both can read meta.
    notifyMetaSubscribers();

    // Run init within a batch
    if (module.init) {
      store.batch(() => {
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

  // Initialize plugins.
  //
  // `emitInit` returns a Promise (the loop-until-quiet awaits each plugin's
  // `onInit` in pass-order). We intentionally do NOT await it here so
  // `createSystem` stays synchronous — but a rejection used to silently
  // become an unhandled promise rejection in the host. Route any rejection
  // through console.error with structured context so log scrapers can see
  // it; per-plugin failures are also caught by `safeCallAsync` inside the
  // manager and won't reach this catch in normal operation.
  void pluginManager.emitInit(system).catch((error: unknown) => {
    console.error("[Directive] Plugin emitInit failure", { error });
  });

  // Call module init hooks
  for (const module of config.modules) {
    module.hooks?.onInit?.(system);
  }

  return system;
}
