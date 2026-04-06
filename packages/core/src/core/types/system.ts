/**
 * System Types - Type definitions for the system
 */

import type { ErrorBoundaryConfig } from "./errors.js";
import type { EventsAccessorFromSchema, SystemEvent } from "./events.js";
import type { Facts } from "./facts.js";
import type { DefinitionMeta } from "./meta.js";
import type { ModuleDef } from "./module.js";
import type { Plugin, Snapshot } from "./plugins.js";
import type { RequirementWithId } from "./requirements.js";
import type { ResolverStatus } from "./resolvers.js";
import type { BatchConfig, RetryPolicy } from "./resolvers.js";
import type {
  InferDerivations,
  InferEvents,
  InferFacts,
  InferSchema,
  InferSchemaType,
  ModuleSchema,
} from "./schema.js";

// ============================================================================
// Derive Accessor Types
// ============================================================================

/**
 * Derive accessor from module schema.
 */
export type DeriveAccessor<M extends ModuleSchema> = InferDerivations<M>;

/**
 * Fact keys from module schema.
 */
export type FactKeys<M extends ModuleSchema> = keyof M["facts"] & string;

/**
 * Get fact return type from module schema.
 */
export type FactReturnType<
  M extends ModuleSchema,
  K extends keyof M["facts"],
> = InferSchemaType<M["facts"][K]>;

/**
 * Derivation keys from module schema.
 */
export type DerivationKeys<M extends ModuleSchema> = keyof M["derivations"] &
  string;

/**
 * Get derivation return type from module schema.
 */
export type DerivationReturnType<
  M extends ModuleSchema,
  K extends keyof M["derivations"],
> = InferSchemaType<M["derivations"][K]>;

/**
 * All observable keys (facts + derivations) from module schema.
 */
export type ObservableKeys<M extends ModuleSchema> =
  | FactKeys<M>
  | DerivationKeys<M>;

// ============================================================================
// Events Accessor Types
// ============================================================================

/**
 * Events accessor from module schema.
 */
export type EventsAccessor<M extends ModuleSchema> =
  EventsAccessorFromSchema<M>;

// ============================================================================
// History & Debug Types
// ============================================================================

/** History configuration for snapshot-based state history (undo/redo, rollback, audit trails) */
export interface HistoryConfig {
  /** Maximum number of snapshots in the ring buffer (default 100) */
  maxSnapshots?: number;
  /** Only snapshot events from these modules. Omit to snapshot all modules. Multi-module only. */
  snapshotModules?: string[];
}

/** History option: boolean shorthand or full config (presence implies enabled) */
export type HistoryOption = boolean | HistoryConfig;

/** Trace configuration for per-run reconciliation changelogs */
export interface TraceConfig {
  /** Ring buffer cap for trace entries (default 100) */
  maxRuns?: number;
}

/** Trace option: boolean shorthand or full config (presence implies enabled) */
export type TraceOption = boolean | TraceConfig;

/** History API for snapshot navigation, changesets, and export/import */
export interface HistoryAPI {
  readonly snapshots: Snapshot[];
  readonly currentIndex: number;
  readonly isPaused: boolean;
  goBack(steps?: number): void;
  goForward(steps?: number): void;
  goTo(snapshotId: number): void;
  replay(): void;
  export(): string;
  import(json: string): void;
  beginChangeset(label: string): void;
  endChangeset(): void;
  pause(): void;
  resume(): void;
}

/** Lightweight snapshot metadata (no facts data — keeps re-renders cheap) */
export interface SnapshotMeta {
  id: number;
  timestamp: number;
  trigger: string;
}

/** Reactive history state for framework hooks */
export interface HistoryState {
  // Navigation state
  canGoBack: boolean;
  canGoForward: boolean;
  currentIndex: number;
  totalSnapshots: number;

  // Snapshot access (metadata only — lightweight)
  snapshots: SnapshotMeta[];
  getSnapshotFacts: (id: number) => Record<string, unknown> | null;

  // Navigation
  goTo: (snapshotId: number) => void;
  goBack: (steps?: number) => void;
  goForward: (steps?: number) => void;
  replay: () => void;

  // Session persistence
  exportSession: () => string;
  importSession: (json: string) => void;

  // Changesets
  beginChangeset: (label: string) => void;
  endChangeset: () => void;

  // Recording control
  isPaused: boolean;
  pause: () => void;
  resume: () => void;
}

// ============================================================================
// Trace Types (per-run reconciliation changelogs)
// ============================================================================

/** A structured record of one reconciliation run — fact changes, derivation recomputes, constraints hit, resolvers, effects. */
export interface TraceEntry {
  /** Monotonic run ID */
  id: number;
  /** When the reconcile started */
  timestamp: number;
  /** Total duration from reconcile start to all resolvers settled (ms) */
  duration: number;
  /** 'pending' while resolvers are inflight, 'settled' when all done */
  status: "pending" | "settled";

  /** Facts that changed, triggering this run */
  factChanges: Array<{
    key: string;
    oldValue: unknown;
    newValue: unknown;
    meta?: DefinitionMeta;
  }>;
  /** Derivations recomputed during this run, with tracked dependencies and values */
  derivationsRecomputed: Array<{
    id: string;
    deps: string[];
    oldValue: unknown;
    newValue: unknown;
    meta?: DefinitionMeta;
  }>;
  /** Constraints that evaluated to active, with tracked dependencies */
  constraintsHit: Array<{
    id: string;
    priority: number;
    deps: string[];
    meta?: DefinitionMeta;
  }>;
  /** Requirements added from constraint diff */
  requirementsAdded: Array<{
    id: string;
    type: string;
    fromConstraint: string;
  }>;
  /** Requirements removed (no longer active), with originating constraint */
  requirementsRemoved: Array<{
    id: string;
    type: string;
    fromConstraint: string;
  }>;
  /** Resolvers started for new requirements */
  resolversStarted: Array<{
    resolver: string;
    requirementId: string;
    meta?: DefinitionMeta;
  }>;
  /** Resolvers that completed (async — populated after reconcile) */
  resolversCompleted: Array<{
    resolver: string;
    requirementId: string;
    duration: number;
    meta?: DefinitionMeta;
  }>;
  /** Resolvers that errored (async — populated after reconcile) */
  resolversErrored: Array<{
    resolver: string;
    requirementId: string;
    error: string;
    meta?: DefinitionMeta;
  }>;
  /** Effects that ran, with their triggering fact keys */
  effectsRun: Array<{
    id: string;
    triggeredBy: string[];
    meta?: DefinitionMeta;
  }>;
  /** Effect errors */
  effectErrors: Array<{ id: string; error: string; meta?: DefinitionMeta }>;

  /** Human-readable causal chain summary (populated when run settles) */
  causalChain?: string;
  /** Anomaly flags (populated when run stats deviate significantly) */
  anomalies?: string[];
}

// ============================================================================
// System Inspection Types
// ============================================================================

/** System inspection result */
export interface SystemInspection {
  unmet: RequirementWithId[];
  inflight: Array<{ id: string; resolverId: string; startedAt: number }>;
  /** All fact/schema field keys with optional metadata */
  facts: Array<{ key: string; meta?: DefinitionMeta }>;
  /** All event names with optional metadata */
  events: Array<{ name: string; meta?: DefinitionMeta }>;
  constraints: Array<{
    id: string;
    active: boolean;
    disabled: boolean;
    priority: number;
    hitCount: number;
    lastActiveAt: number | null;
    meta?: DefinitionMeta;
  }>;
  resolvers: Record<string, ResolverStatus>;
  /** All defined resolver names and their requirement types */
  resolverDefs: Array<{ id: string; requirement: string; meta?: DefinitionMeta }>;
  /** All defined effect names with optional metadata */
  effects: Array<{ id: string; meta?: DefinitionMeta }>;
  /** All defined derivation names with optional metadata */
  derivations: Array<{ id: string; meta?: DefinitionMeta }>;
  /** All registered modules with optional metadata */
  modules: Array<{ id: string; meta?: DefinitionMeta }>;
  /** Whether trace is enabled on this system */
  traceEnabled: boolean;
  /** Per-run trace entries (only present if trace is enabled) */
  trace?: TraceEntry[];
}

/** Explanation of why a requirement exists */
export interface RequirementExplanation {
  requirementId: string;
  requirementType: string;
  constraintId: string;
  constraintPriority: number;
  relevantFacts: Record<string, unknown>;
  resolverStatus: ResolverStatus;
}

/** Serializable system snapshot for SSR/persistence */
export interface SystemSnapshot {
  facts: Record<string, unknown>;
  version?: number;
}

// ============================================================================
// Distributable Snapshot Types
// ============================================================================

/**
 * Options for creating a distributable snapshot.
 * Distributable snapshots contain computed derivation values that can be
 * serialized and distributed (JWT, Redis, edge KV) for use outside the runtime.
 */
export interface DistributableSnapshotOptions {
  /** Derivation keys to include (default: all) */
  includeDerivations?: string[];
  /** Derivation keys to exclude */
  excludeDerivations?: string[];
  /** Fact keys to include (default: none) */
  includeFacts?: string[];
  /** TTL in seconds */
  ttlSeconds?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Include version hash for cache invalidation */
  includeVersion?: boolean;
}

/**
 * A distributable snapshot containing computed state.
 * This is a serializable object that can be stored in Redis, JWT, etc.
 *
 * @example
 * ```typescript
 * const snapshot = system.getDistributableSnapshot({
 *   includeDerivations: ['effectivePlan', 'canUseFeature', 'limits'],
 *   ttlSeconds: 3600,
 * });
 * // { data: { effectivePlan: "pro", canUseFeature: {...} }, createdAt: ..., expiresAt: ... }
 *
 * // Store in Redis
 * await redis.setex(`entitlements:${userId}`, 3600, JSON.stringify(snapshot));
 *
 * // Later, in an API route (no Directive runtime needed)
 * const cached = JSON.parse(await redis.get(`entitlements:${userId}`));
 * if (!cached.data.canUseFeature.api) {
 *   throw new ForbiddenError();
 * }
 * ```
 */
export interface DistributableSnapshot<T = Record<string, unknown>> {
  /** The computed derivation values and optionally included facts */
  data: T;
  /** Timestamp when this snapshot was created (ms since epoch) */
  createdAt: number;
  /** Timestamp when this snapshot expires (ms since epoch), if TTL was specified */
  expiresAt?: number;
  /** Version hash for cache invalidation, if includeVersion was true */
  version?: string;
  /** Custom metadata passed in options */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// System Interface
// ============================================================================

/**
 * System interface using consolidated module schema.
 * Provides full type inference for facts, derivations, events, and dispatch.
 */
/** Runtime control for constraints */
export interface ConstraintsControl<M extends ModuleSchema = ModuleSchema> {
  /** Disable a constraint by ID — it will be excluded from evaluation */
  disable(id: string): void;
  /** Enable a previously disabled constraint — it will be re-evaluated on the next cycle */
  enable(id: string): void;
  /** Check if a constraint is currently disabled */
  isDisabled(id: string): boolean;
  /**
   * Register a new constraint at runtime.
   * @throws If a constraint with this ID already exists (use `assign` to override)
   * @remarks During reconciliation, the registration is deferred and applied after the current cycle completes.
   */
  register(id: string, def: DynamicConstraintDef<M>): void;
  /**
   * Override an existing constraint (static or dynamic).
   * Stores the original definition for potential inspection.
   * @throws If no constraint with this ID exists (use `register` to create)
   * @remarks During reconciliation, the assignment is deferred and applied after the current cycle completes.
   */
  assign(id: string, def: DynamicConstraintDef<M>): void;
  /**
   * Remove a dynamically registered constraint.
   * Static (module-defined) constraints cannot be unregistered — logs a dev warning and no-ops.
   * @remarks During reconciliation, the unregistration is deferred and applied after the current cycle completes.
   */
  unregister(id: string): void;
  /**
   * Invoke a constraint's `when()` predicate. If true, evaluates its `require()` and returns the requirements
   * (with optional props merged). The requirements are returned for inspection but NOT automatically dispatched
   * to the resolver system.
   * @throws If no constraint with this ID exists
   */
  call(
    id: string,
    props?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]>;
  /** Check if a constraint was dynamically registered (not from a module definition) */
  isDynamic(id: string): boolean;
  /** List all dynamically registered constraint IDs */
  listDynamic(): string[];
}

/** Runtime control for effects */
export interface EffectsControl<M extends ModuleSchema = ModuleSchema> {
  /** Disable an effect by ID — it will be skipped during reconciliation */
  disable(id: string): void;
  /** Enable a previously disabled effect */
  enable(id: string): void;
  /** Check if an effect is currently enabled */
  isEnabled(id: string): boolean;
  /**
   * Register a new effect at runtime.
   * @throws If an effect with this ID already exists (use `assign` to override)
   * @remarks During reconciliation, the registration is deferred and applied after the current cycle completes.
   */
  register(id: string, def: DynamicEffectDef<M>): void;
  /**
   * Override an existing effect (static or dynamic).
   * Runs cleanup of the old effect before replacing.
   * @throws If no effect with this ID exists (use `register` to create)
   * @remarks During reconciliation, the assignment is deferred and applied after the current cycle completes.
   */
  assign(id: string, def: DynamicEffectDef<M>): void;
  /**
   * Remove a dynamically registered effect.
   * Static (module-defined) effects cannot be unregistered — logs a dev warning and no-ops.
   * @remarks During reconciliation, the unregistration is deferred and applied after the current cycle completes.
   */
  unregister(id: string): void;
  /**
   * Execute an effect's `run()` function immediately.
   * @throws If no effect with this ID exists
   */
  call(id: string): Promise<void>;
  /** Check if an effect was dynamically registered (not from a module definition) */
  isDynamic(id: string): boolean;
  /** List all dynamically registered effect IDs */
  listDynamic(): string[];
}

/** Runtime control for derivations (dynamic registration + value access) */
export interface DerivationsControl<M extends ModuleSchema = ModuleSchema> {
  /**
   * Register a new derivation at runtime.
   * @throws If a derivation with this ID already exists (use `assign` to override)
   * @remarks During reconciliation, the registration is deferred and applied after the current cycle completes.
   */
  register(
    id: string,
    fn:
      | ((
          facts: Readonly<InferSchema<M["facts"]>>,
          derived: Readonly<InferDerivations<M>>,
        ) => unknown)
      | {
          compute: (
            facts: Readonly<InferSchema<M["facts"]>>,
            derived: Readonly<InferDerivations<M>>,
          ) => unknown;
          meta?: DefinitionMeta;
        },
  ): void;
  /**
   * Override an existing derivation (static or dynamic).
   * @throws If no derivation with this ID exists (use `register` to create)
   * @remarks During reconciliation, the assignment is deferred and applied after the current cycle completes.
   */
  assign(
    id: string,
    fn:
      | ((
          facts: Readonly<InferSchema<M["facts"]>>,
          derived: Readonly<InferDerivations<M>>,
        ) => unknown)
      | {
          compute: (
            facts: Readonly<InferSchema<M["facts"]>>,
            derived: Readonly<InferDerivations<M>>,
          ) => unknown;
          meta?: DefinitionMeta;
        },
  ): void;
  /**
   * Remove a dynamically registered derivation.
   * Static (module-defined) derivations cannot be unregistered — logs a dev warning and no-ops.
   * @remarks During reconciliation, the unregistration is deferred and applied after the current cycle completes.
   */
  unregister(id: string): void;
  /**
   * Recompute and return a derivation's current value.
   * Use the type parameter to specify the return type: `call<number>("id")`.
   * @throws If no derivation with this ID exists
   */
  call<T = unknown>(id: string): T;
  /** Check if a derivation was dynamically registered (not from a module definition) */
  isDynamic(id: string): boolean;
  /** List all dynamically registered derivation IDs */
  listDynamic(): string[];
}

/** Runtime control for resolvers */
export interface ResolversControl<M extends ModuleSchema = ModuleSchema> {
  /**
   * Register a new resolver at runtime.
   * @throws If a resolver with this ID already exists (use `assign` to override)
   * @remarks During reconciliation, the registration is deferred and applied after the current cycle completes.
   */
  register(id: string, def: DynamicResolverDef<M>): void;
  /**
   * Override an existing resolver (static or dynamic).
   * Clears the resolver-by-type cache.
   * @throws If no resolver with this ID exists (use `register` to create)
   * @remarks During reconciliation, the assignment is deferred and applied after the current cycle completes.
   */
  assign(id: string, def: DynamicResolverDef<M>): void;
  /**
   * Remove a dynamically registered resolver.
   * Static (module-defined) resolvers cannot be unregistered — logs a dev warning and no-ops.
   * @remarks During reconciliation, the unregistration is deferred and applied after the current cycle completes.
   */
  unregister(id: string): void;
  /**
   * Execute a resolver's `resolve()` with a requirement object.
   * @throws If no resolver with this ID exists
   */
  call(
    id: string,
    requirement: { type: string; [key: string]: unknown },
  ): Promise<void>;
  /** Check if a resolver was dynamically registered (not from a module definition) */
  isDynamic(id: string): boolean;
  /** List all dynamically registered resolver IDs */
  listDynamic(): string[];
}

// ============================================================================
// Dynamic Definition Types (for register/assign)
// ============================================================================

/** Constraint definition for dynamic registration — typed facts, relaxed requirements */
export interface DynamicConstraintDef<M extends ModuleSchema = ModuleSchema> {
  priority?: number;
  async?: boolean;
  when: (
    facts: Readonly<InferSchema<M["facts"]>>,
  ) => boolean | Promise<boolean>;
  require:
    | { type: string; [key: string]: unknown }
    | { type: string; [key: string]: unknown }[]
    | null
    | ((
        facts: Readonly<InferSchema<M["facts"]>>,
      ) =>
        | { type: string; [key: string]: unknown }
        | { type: string; [key: string]: unknown }[]
        | null);
  timeout?: number;
  after?: string[];
  deps?: string[];
  meta?: DefinitionMeta;
}

/** Effect definition for dynamic registration — typed facts */
export interface DynamicEffectDef<M extends ModuleSchema = ModuleSchema> {
  run: (
    facts: Readonly<InferSchema<M["facts"]>>,
    prev: InferSchema<M["facts"]> | null,
  ) => void | (() => void) | Promise<void | (() => void)>;
  deps?: Array<string & keyof InferSchema<M["facts"]>>;
  meta?: DefinitionMeta;
}

/** Resolver definition for dynamic registration — typed context.facts, relaxed requirement */
export interface DynamicResolverDef<M extends ModuleSchema = ModuleSchema> {
  requirement: string;
  key?: (req: { type: string; [key: string]: unknown }) => string;
  retry?: RetryPolicy;
  timeout?: number;
  batch?: BatchConfig;
  resolve?: (
    req: { type: string; [key: string]: unknown },
    context: {
      facts: InferSchema<M["facts"]>;
      signal: AbortSignal;
      snapshot: () => InferSchema<M["facts"]>;
    },
  ) => Promise<void>;
  resolveBatch?: (
    reqs: { type: string; [key: string]: unknown }[],
    context: {
      facts: InferSchema<M["facts"]>;
      signal: AbortSignal;
      snapshot: () => InferSchema<M["facts"]>;
    },
  ) => Promise<void>;
  meta?: DefinitionMeta;
}

/** Result from bulk meta queries (byCategory, byTag). */
export interface MetaMatch {
  type: "module" | "fact" | "event" | "constraint" | "resolver" | "effect" | "derivation";
  id: string;
  meta: DefinitionMeta;
}

/** O(1) accessor for definition metadata. */
export interface MetaAccessor {
  /** Get metadata for a module by ID. */
  module(id: string): DefinitionMeta | undefined;
  /** Get metadata for a fact/schema field by key. */
  fact(key: string): DefinitionMeta | undefined;
  /** Get metadata for an event by name. */
  event(name: string): DefinitionMeta | undefined;
  /** Get metadata for a constraint by ID. */
  constraint(id: string): DefinitionMeta | undefined;
  /** Get metadata for a resolver by ID. */
  resolver(id: string): DefinitionMeta | undefined;
  /** Get metadata for an effect by ID. */
  effect(id: string): DefinitionMeta | undefined;
  /** Get metadata for a derivation by ID. */
  derivation(id: string): DefinitionMeta | undefined;
  /** Find all definitions matching a category across all types. */
  byCategory(category: string): MetaMatch[];
  /** Find all definitions matching a tag across all types. */
  byTag(tag: string): MetaMatch[];
}

// ============================================================================
// Observation Protocol
// ============================================================================

/** Typed events emitted by system.observe(). */
export type ObservationEvent =
  | { type: "fact.change"; key: string; prev: unknown; next: unknown }
  | { type: "constraint.evaluate"; id: string; active: boolean }
  | { type: "constraint.error"; id: string; error: unknown }
  | { type: "requirement.created"; id: string; requirementType: string }
  | { type: "requirement.met"; id: string; byResolver: string }
  | { type: "requirement.canceled"; id: string }
  | { type: "resolver.start"; resolver: string; requirementId: string }
  | { type: "resolver.complete"; resolver: string; requirementId: string; duration: number }
  | { type: "resolver.error"; resolver: string; requirementId: string; error: unknown }
  | { type: "effect.run"; id: string }
  | { type: "effect.error"; id: string; error: unknown }
  | { type: "derivation.compute"; id: string; value: unknown }
  | { type: "reconcile.start" }
  | { type: "reconcile.end"; added: number; removed: number }
  | { type: "system.init" }
  | { type: "system.start" }
  | { type: "system.stop" }
  | { type: "system.destroy" };

export interface System<M extends ModuleSchema = ModuleSchema> {
  readonly facts: Facts<M["facts"]>;
  readonly history: HistoryAPI | null;
  readonly derive: InferDerivations<M> & DerivationsControl<M>;
  readonly events: EventsAccessorFromSchema<M>;
  readonly constraints: ConstraintsControl<M>;
  readonly effects: EffectsControl<M>;
  readonly resolvers: ResolversControl<M>;
  /** O(1) metadata queries for constraints, resolvers, effects, derivations. */
  readonly meta: MetaAccessor;
  /**
   * Observe all lifecycle events as a typed stream.
   * Returns an unsubscribe function.
   *
   * @example
   * ```typescript
   * const unsub = system.observe((event) => {
   *   if (event.type === "resolver.complete") {
   *     console.log(event.resolver, event.duration);
   *   }
   * });
   * ```
   */
  observe(observer: (event: ObservationEvent) => void): () => void;
  /** Per-run trace entries (null if trace is not enabled) */
  readonly trace: TraceEntry[] | null;

  /** Initialize facts and derivations without starting reconciliation. Safe for SSR. */
  initialize(): void;
  start(): void;
  stop(): void;
  destroy(): void;

  readonly isRunning: boolean;
  readonly isSettled: boolean;
  /** Whether all modules have completed initialization */
  readonly isInitialized: boolean;
  /** Whether system has completed first reconciliation */
  readonly isReady: boolean;

  /** Wait for system to be fully ready (after first reconciliation) */
  whenReady(): Promise<void>;

  dispatch(event: InferEvents<M>): void;
  dispatch(event: SystemEvent): void;

  batch(fn: () => void): void;

  /**
   * Subscribe to settlement state changes.
   * Called whenever the system's settled state may have changed
   * (resolver starts/completes, reconcile starts/ends).
   */
  onSettledChange(listener: () => void): () => void;

  /**
   * Subscribe to history state changes.
   * Called whenever a snapshot is taken or history navigation occurs.
   * Returns an unsubscribe function.
   */
  onHistoryChange(listener: () => void): () => void;

  read<K extends DerivationKeys<M>>(id: K): DerivationReturnType<M, K>;
  read<K extends FactKeys<M>>(id: K): FactReturnType<M, K>;
  read<T = unknown>(id: string): T;
  /**
   * Subscribe to fact or derivation changes.
   * Keys are auto-detected -- pass any mix of fact keys and derivation keys.
   * @example system.subscribe(["count", "doubled"], () => { ... })
   */
  subscribe(ids: Array<ObservableKeys<M>>, listener: () => void): () => void;

  /**
   * Watch a fact or derivation for value changes.
   * The key is auto-detected -- works with both fact keys and derivation keys.
   * Pass `options.equalityFn` for custom comparison (e.g., shallow equality for objects).
   * @example system.watch("count", (newVal, oldVal) => { ... })
   * @example system.watch("derived", cb, { equalityFn: shallowEqual })
   */
  watch<K extends DerivationKeys<M>>(
    id: K,
    callback: (
      newValue: DerivationReturnType<M, K>,
      previousValue: DerivationReturnType<M, K> | undefined,
    ) => void,
    options?: {
      equalityFn?: (
        a: DerivationReturnType<M, K>,
        b: DerivationReturnType<M, K> | undefined,
      ) => boolean;
    },
  ): () => void;
  watch<K extends FactKeys<M>>(
    id: K,
    callback: (
      newValue: FactReturnType<M, K>,
      previousValue: FactReturnType<M, K> | undefined,
    ) => void,
    options?: {
      equalityFn?: (
        a: FactReturnType<M, K>,
        b: FactReturnType<M, K> | undefined,
      ) => boolean;
    },
  ): () => void;
  watch<T = unknown>(
    id: string,
    callback: (newValue: T, previousValue: T | undefined) => void,
    options?: { equalityFn?: (a: T, b: T | undefined) => boolean },
  ): () => void;

  /**
   * Returns a promise that resolves when the predicate becomes true.
   * The predicate is evaluated against current facts and re-evaluated on every change.
   * Optionally pass a timeout in ms -- rejects with an error if exceeded.
   *
   * @example
   * await system.when((facts) => facts.phase === "ready");
   * @example
   * await system.when((facts) => facts.count > 10, { timeout: 5000 });
   */
  when(
    predicate: (facts: Readonly<InferFacts<M>>) => boolean,
    options?: { timeout?: number },
  ): Promise<void>;

  inspect(): SystemInspection;
  settle(maxWait?: number): Promise<void>;
  explain(requirementId: string): string | null;
  getSnapshot(): SystemSnapshot;
  restore(snapshot: SystemSnapshot): void;

  /**
   * Get the original definition that was overridden by `assign()`.
   * Returns undefined if no original exists for this type/id.
   */
  getOriginal(
    type: "constraint" | "resolver" | "derivation" | "effect",
    id: string,
  ): unknown | undefined;

  /**
   * Restore the original definition that was overridden by `assign()`.
   * Re-assigns the original definition and removes the override tracking.
   * Returns true if restoration succeeded, false if no original exists.
   */
  restoreOriginal(
    type: "constraint" | "resolver" | "derivation" | "effect",
    id: string,
  ): boolean;

  /**
   * Get a distributable snapshot of computed derivations.
   * This creates a serializable object that can be stored in Redis, JWT, etc.
   * for use outside the Directive runtime.
   *
   * @example
   * ```typescript
   * const snapshot = system.getDistributableSnapshot({
   *   includeDerivations: ['effectivePlan', 'canUseFeature'],
   *   ttlSeconds: 3600,
   * });
   * await redis.setex(`entitlements:${userId}`, 3600, JSON.stringify(snapshot));
   * ```
   */
  getDistributableSnapshot<T = Record<string, unknown>>(
    options?: DistributableSnapshotOptions,
  ): DistributableSnapshot<T>;

  /**
   * Watch for changes to distributable snapshot derivations.
   * Calls the callback whenever any of the included derivations change.
   * Returns an unsubscribe function.
   *
   * @example
   * ```typescript
   * const unsubscribe = system.watchDistributableSnapshot(
   *   { includeDerivations: ['effectivePlan', 'canUseFeature'] },
   *   (snapshot) => {
   *     // Snapshot changed - push to Redis/edge cache
   *     await redis.setex(`entitlements:${userId}`, 3600, JSON.stringify(snapshot));
   *   }
   * );
   *
   * // Later, cleanup
   * unsubscribe();
   * ```
   */
  watchDistributableSnapshot<T = Record<string, unknown>>(
    options: DistributableSnapshotOptions,
    callback: (snapshot: DistributableSnapshot<T>) => void,
  ): () => void;
}

// ============================================================================
// System Configuration
// ============================================================================

/** System configuration */
export interface SystemConfig<M extends ModuleSchema = ModuleSchema> {
  modules: Array<ModuleDef<M>>;
  // biome-ignore lint/suspicious/noExplicitAny: Plugins are schema-agnostic
  plugins?: Array<Plugin<any>>;
  history?: HistoryOption;
  trace?: TraceOption;
  errorBoundary?: ErrorBoundaryConfig;
  /**
   * Callback invoked after module inits but before first reconcile.
   * Used by system wrapper to apply initialFacts/hydrate at the right time.
   * @internal
   */
  onAfterModuleInit?: () => void;
  tickMs?: number;
  /**
   * Connect to Directive Cloud for remote traces, dashboards, and team collaboration.
   *
   * Pass a license key string to authenticate with Directive Cloud.
   *
   * @see https://directive.run/pricing
   */
  cloud?: boolean | string;
}
