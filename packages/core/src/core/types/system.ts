/**
 * System Types - Type definitions for the system
 */

import type { ErrorBoundaryConfig } from "./errors.js";
import type { EventsAccessorFromSchema, SystemEvent } from "./events.js";
import type { Facts } from "./facts.js";
import type { ModuleDef } from "./module.js";
import type { Plugin, Snapshot } from "./plugins.js";
import type { RequirementWithId } from "./requirements.js";
import type { ResolverStatus } from "./resolvers.js";
import type {
  InferDerivations,
  InferEvents,
  InferFacts,
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
// Debug & Time-Travel Types
// ============================================================================

/** Debug configuration */
export interface DebugConfig {
  timeTravel?: boolean;
  maxSnapshots?: number;
  /** Only snapshot events from these modules. Omit to snapshot all modules. Multi-module only. */
  snapshotModules?: string[];
  /** Enable per-run changelog (default false) */
  runHistory?: boolean;
  /** Ring buffer cap for run history (default 100) */
  maxRuns?: number;
}

/** Time-travel API */
export interface TimeTravelAPI {
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

/** Reactive time-travel state for framework hooks */
export interface TimeTravelState {
  // Existing (unchanged)
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  currentIndex: number;
  totalSnapshots: number;

  // Snapshot access (metadata only — lightweight)
  snapshots: SnapshotMeta[];
  getSnapshotFacts: (id: number) => Record<string, unknown> | null;

  // Navigation
  goTo: (snapshotId: number) => void;
  goBack: (steps: number) => void;
  goForward: (steps: number) => void;
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
// Run Changelog Types
// ============================================================================

/** A structured record of one reconciliation run — from facts through resolvers and effects. */
export interface RunChangelogEntry {
  /** Monotonic run ID */
  id: number;
  /** When the reconcile started */
  timestamp: number;
  /** Total duration from reconcile start to all resolvers settled (ms) */
  duration: number;
  /** 'pending' while resolvers are inflight, 'settled' when all done */
  status: "pending" | "settled";

  /** Facts that changed, triggering this run */
  factChanges: Array<{ key: string; oldValue: unknown; newValue: unknown }>;
  /** Derivations recomputed during this run, with tracked dependencies and values */
  derivationsRecomputed: Array<{
    id: string;
    deps: string[];
    oldValue: unknown;
    newValue: unknown;
  }>;
  /** Constraints that evaluated to active, with tracked dependencies */
  constraintsHit: Array<{ id: string; priority: number; deps: string[] }>;
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
  resolversStarted: Array<{ resolver: string; requirementId: string }>;
  /** Resolvers that completed (async — populated after reconcile) */
  resolversCompleted: Array<{
    resolver: string;
    requirementId: string;
    duration: number;
  }>;
  /** Resolvers that errored (async — populated after reconcile) */
  resolversErrored: Array<{
    resolver: string;
    requirementId: string;
    error: string;
  }>;
  /** Effects that ran, with their triggering fact keys */
  effectsRun: Array<{ id: string; triggeredBy: string[] }>;
  /** Effect errors */
  effectErrors: Array<{ id: string; error: string }>;

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
  constraints: Array<{
    id: string;
    active: boolean;
    disabled: boolean;
    priority: number;
    hitCount: number;
    lastActiveAt: number | null;
  }>;
  resolvers: Record<string, ResolverStatus>;
  /** All defined resolver names and their requirement types */
  resolverDefs: Array<{ id: string; requirement: string }>;
  /** Whether debug.runHistory is enabled on this system */
  runHistoryEnabled: boolean;
  /** Per-run changelog entries (only present if debug.runHistory is enabled) */
  runHistory?: RunChangelogEntry[];
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
export interface ConstraintsControl {
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
  register(id: string, def: Record<string, unknown>): void;
  /**
   * Override an existing constraint (static or dynamic).
   * Stores the original definition for potential inspection.
   * @throws If no constraint with this ID exists (use `register` to create)
   * @remarks During reconciliation, the assignment is deferred and applied after the current cycle completes.
   */
  assign(id: string, def: Record<string, unknown>): void;
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
  call(id: string, props?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  /** Check if a constraint was dynamically registered (not from a module definition) */
  isDynamic(id: string): boolean;
  /** List all dynamically registered constraint IDs */
  listDynamic(): string[];
}

/** Runtime control for effects */
export interface EffectsControl {
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
  register(id: string, def: Record<string, unknown>): void;
  /**
   * Override an existing effect (static or dynamic).
   * Runs cleanup of the old effect before replacing.
   * @throws If no effect with this ID exists (use `register` to create)
   * @remarks During reconciliation, the assignment is deferred and applied after the current cycle completes.
   */
  assign(id: string, def: Record<string, unknown>): void;
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

/** Runtime control for resolvers */
export interface ResolversControl {
  /**
   * Register a new resolver at runtime.
   * @throws If a resolver with this ID already exists (use `assign` to override)
   * @remarks During reconciliation, the registration is deferred and applied after the current cycle completes.
   */
  register(id: string, def: Record<string, unknown>): void;
  /**
   * Override an existing resolver (static or dynamic).
   * Clears the resolver-by-type cache.
   * @throws If no resolver with this ID exists (use `register` to create)
   * @remarks During reconciliation, the assignment is deferred and applied after the current cycle completes.
   */
  assign(id: string, def: Record<string, unknown>): void;
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
  call(id: string, requirement: { type: string; [key: string]: unknown }): Promise<void>;
  /** Check if a resolver was dynamically registered (not from a module definition) */
  isDynamic(id: string): boolean;
  /** List all dynamically registered resolver IDs */
  listDynamic(): string[];
}

export interface System<M extends ModuleSchema = ModuleSchema> {
  readonly facts: Facts<M["facts"]>;
  readonly debug: TimeTravelAPI | null;
  readonly derive: InferDerivations<M>;
  readonly events: EventsAccessorFromSchema<M>;
  readonly constraints: ConstraintsControl;
  readonly effects: EffectsControl;
  readonly resolvers: ResolversControl;
  /** Per-run changelog entries (null if debug.runHistory is not enabled) */
  readonly runHistory: RunChangelogEntry[] | null;

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
   * Subscribe to time-travel state changes.
   * Called whenever a snapshot is taken or time-travel navigation occurs.
   * Returns an unsubscribe function.
   */
  onTimeTravelChange(listener: () => void): () => void;

  read<K extends DerivationKeys<M>>(
    derivationId: K,
  ): DerivationReturnType<M, K>;
  read<T = unknown>(derivationId: string): T;
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
  debug?: DebugConfig;
  errorBoundary?: ErrorBoundaryConfig;
  /**
   * Callback invoked after module inits but before first reconcile.
   * Used by system wrapper to apply initialFacts/hydrate at the right time.
   * @internal
   */
  onAfterModuleInit?: () => void;
  tickMs?: number;
}
