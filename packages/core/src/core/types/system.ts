/**
 * System Types - Type definitions for the system
 */

import type { ErrorBoundaryConfig } from "./errors.js";
import type { EventsAccessorFromSchema, SystemEvent } from "./events.js";
import type { Facts } from "./facts.js";
import type { DefinitionMeta } from "./meta.js";
import type { ModuleDef } from "./module.js";
import type { Plugin, Snapshot } from "./plugins.js";
import type { ClauseResult, FactPredicate, KeySelector } from "./predicate.js";
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
  /**
   * Optional transform applied to the facts snapshot BEFORE it's
   * cloned into the ring buffer. The default (`undefined`) stores
   * facts verbatim — including any PII a source published into a
   * fact since the last snapshot.
   *
   * Wire a redactor to strip PII from the ring buffer (and from
   * `export()` payloads) for GDPR Art.17 erasure / SOC2 audit hygiene.
   * Pair with `createFactPIIGuardrail` on the input boundary for
   * end-to-end coverage — the guardrail redacts on writes,
   * `redactSnapshot` redacts whatever still escapes into history.
   *
   * Throws inside the redactor are caught and the snapshot falls
   * back to the raw facts with a structured `console.warn`; the
   * redactor must be defensive (return a safe fallback rather than
   * throwing) if redaction is load-bearing for compliance.
   *
   * @example
   * ```ts
   * createSystem({
   *   module,
   *   history: {
   *     maxSnapshots: 100,
   *     redactSnapshot: (facts) => ({ ...facts, email: "[REDACTED]" }),
   *   },
   * });
   * ```
   */
  redactSnapshot?: (
    facts: Record<string, unknown>,
  ) => Record<string, unknown>;
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
    /**
     * The data-form predicate spec (when the constraint's `when` is declarative),
     * exposed for devtools and `explain()` rendering.
     */
    whenSpec?: FactPredicate<Record<string, unknown>>;
    /**
     * Owned-fact list for RFC-0003 binding. Populated from the
     * constraint definition's `owns:` field. Exposed for `doctor.checkOwns()`
     * so it can flag candidates that would race or shadow these writes.
     * Absent when the constraint declares no `owns`.
     */
    readonly owns?: readonly string[];
    /**
     * Fact paths the constraint `bind:`s to. v2 promise — the runtime
     * does not yet emit a `bind` field on inspect snapshots, but the
     * type slot is reserved so `doctor.checkOwns()` is stable across
     * the rollout. (F1)
     */
    readonly bind?: readonly string[];
  }>;
  resolvers: Record<string, ResolverStatus>;
  /** All defined resolver names and their requirement types */
  resolverDefs: Array<{
    id: string;
    requirement: string;
    meta?: DefinitionMeta;
  }>;
  /** All defined effect names with optional metadata */
  effects: Array<{ id: string; meta?: DefinitionMeta }>;
  /**
   * All declared source names with the module that owns each, plus per-source
   * telemetry surfaced for production-debug ("which source is publishing?",
   * "when did this source last fire?", "is this source errored?", "is the
   * engine silently dropping publishes from this source?") without requiring
   * a custom plugin to be installed first.
   *
   * Counters reset at every `system.start()` cycle — a stop → start does not
   * carry "ghost" counts from the previous cycle. Timestamps are wall-clock
   * milliseconds (Date.now()); `null` means "never happened in this cycle".
   *
   * `dropCount` / `lastDropReason` / `lastDropAt` count publishes the
   * engine's dispatch guard rejected (post-stop, BLOCKED_PROPS event name,
   * empty / non-string event name). Without these, attackers — or a buggy
   * source — could probe BLOCKED_PROPS / the isRunning guard invisibly:
   * telemetry would never advance and no plugin hook would fire.
   *
   * `attachedSourceCount` (below) is the aggregate count of `attached: true`
   * rows; both must stay in lockstep.
   */
  sources: Array<{
    id: string;
    moduleId: string;
    meta?: DefinitionMeta;
    /** True while the source's attach succeeded and its unsubscribe is held. */
    attached: boolean;
    /** Wall-clock ms when the source most recently attached, or null. */
    attachedAt: number | null;
    /** Wall-clock ms when the source most recently detached, or null. */
    detachedAt: number | null;
    /** Total publish() invocations the engine accepted since the last attachAll. */
    publishCount: number;
    /** Wall-clock ms of the most recent accepted publish() call, or null. */
    lastPublishAt: number | null;
    /**
     * Total publish() invocations the engine's dispatch guard rejected this
     * cycle. Operators monitor this to spot misconfigured sources (wrong
     * event names) or probing of the BLOCKED_PROPS / isRunning guards.
     */
    dropCount: number;
    /**
     * Reason for the most recent rejected publish, or `null`.
     * - `"post-destroy"` / `"post-stop"` — leaked transport firing
     *   outside the running lifecycle window
     * - `"blocked-event-name"` / `"invalid-event-name"` — engine
     *   dispatch guard rejected the publish (BLOCKED_PROPS / empty)
     * - `"coalesced"` — manager debounced a same-event-name publish
     *   when `SourceDef.coalesce === "lastWriteWins"`
     */
    lastDropReason: import("./sources.js").SourceDropReason | null;
    /** Wall-clock ms of the most recent rejected publish, or `null`. */
    lastDropAt: number | null;
    /** Total attach + cleanup errors since the last attachAll. */
    errorCount: number;
    /**
     * The most recent error from this source, or `null`. `message` is
     * truncated to a fixed maximum length so a source whose `attach()`
     * throws with a payload-embedded message does not write unbounded data
     * here AND downstream into the audit ledger. `phase: "runtime"`
     * (RFC 0008) flags errors that the source reported mid-flight via
     * the `reportError` callback `attach` receives as its second
     * argument (distinct from lifecycle `"attach"` / `"cleanup"`
     * failures).
     */
    lastError: {
      phase: "attach" | "cleanup" | "runtime";
      message: string;
      at: number;
    } | null;
  }>;
  /** Number of sources currently attached (i.e. system is in the `attached` phase + their attach() succeeded). */
  attachedSourceCount: number;
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
  when:
    | ((facts: Readonly<InferSchema<M["facts"]>>) => boolean | Promise<boolean>)
    | FactPredicate<InferSchema<M["facts"]>>;
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
  ) => void | (() => void) | Promise<undefined | (() => void)>;
  deps?: Array<string & keyof InferSchema<M["facts"]>>;
  /**
   * Optional declarative trigger — a {@link FactPredicate} that gates whether
   * `run()` fires. Mutually exclusive with `deps`.
   */
  on?: FactPredicate<InferSchema<M["facts"]>>;
  meta?: DefinitionMeta;
}

/** Resolver definition for dynamic registration — typed context.facts, relaxed requirement */
export interface DynamicResolverDef<M extends ModuleSchema = ModuleSchema> {
  requirement: string;
  /**
   * Custom dedup key. Either a `(req) => string` function, or a
   * {@link KeySelector} array of requirement-payload field names.
   */
  key?:
    | ((req: { type: string; [key: string]: unknown }) => string)
    | KeySelector<{ type: string; [key: string]: unknown }>;
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
  type:
    | "module"
    | "fact"
    | "event"
    | "constraint"
    | "resolver"
    | "effect"
    | "derivation";
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
  | {
      type: "constraint.evaluate";
      id: string;
      active: boolean;
      /**
       * Per-clause breakdown of a data-form predicate evaluation. Present
       * only when the constraint's `when` is a {@link FactPredicate}.
       */
      whenExplain?: ClauseResult[];
    }
  | { type: "constraint.error"; id: string; error: unknown }
  | { type: "requirement.created"; id: string; requirementType: string }
  | { type: "requirement.met"; id: string; byResolver: string }
  | { type: "requirement.canceled"; id: string }
  | { type: "resolver.start"; resolver: string; requirementId: string }
  | {
      type: "resolver.complete";
      resolver: string;
      requirementId: string;
      duration: number;
    }
  | {
      type: "resolver.error";
      resolver: string;
      requirementId: string;
      error: unknown;
    }
  | {
      /**
       * A real per-write rejection. A bound resolver's owned-fact write was
       * dropped because the fact was changed by something outside the
       * resolver between the resolver's baseline and its next write (RFC-0003
       * optimistic-concurrency check). `reason` keeps the observation protocol
       * backend-neutral — future write-rejecting backends can report other
       * reasons without a new event type.
       *
       * `kind` discriminates this `"rejection"` arm from the `"summary"` arm:
       * `fact`/`expected`/`actual` exist only here; `dropped` only on the
       * summary. TypeScript forces the narrow.
       *
       * @example
       * ```ts
       * system.observe((e) => {
       *   if (e.type === "resolver.write.rejected") {
       *     if (e.kind === "summary") {
       *       console.warn(`[rejected] ${e.resolver}: ${e.dropped} more writes dropped`);
       *     } else {
       *       console.warn(`[rejected] ${e.resolver} dropped ${e.fact}`);
       *     }
       *   }
       * });
       * ```
       */
      type: "resolver.write.rejected";
      kind: "rejection";
      resolver: string;
      requirementId: string;
      reason: "clobbered";
      fact: string;
      expected: unknown;
      actual: unknown;
    }
  | {
      /**
       * The per-resolver suppression summary: emitted once when a single
       * resolver instance exceeds the per-instance write-rejection cap (10).
       * Further per-write `"rejection"` events for that instance are dropped;
       * `dropped` reports how many were suppressed.
       */
      type: "resolver.write.rejected";
      kind: "summary";
      resolver: string;
      requirementId: string;
      reason: "clobbered";
      dropped: number;
    }
  | { type: "effect.run"; id: string }
  | { type: "effect.error"; id: string; error: unknown }
  /**
   * Source attached at `system.start()` (or at registerModule when the
   * system was already running). Carries the source id + the module that
   * declared it so plugins can attribute per-module sources.
   */
  | { type: "source.attach"; id: string; moduleId: string }
  /**
   * A source published an event into the system's event queue. Fires
   * BEFORE the event handler runs; pair with `fact.change` events to
   * trace the downstream effect.
   */
  | {
      type: "source.publish";
      id: string;
      moduleId: string;
      eventName: string;
    }
  /**
   * Engine- or manager-rejected publish. Pairs with `source.publish`
   * so observers see both halves of the publish path without polling
   * `inspect().sources[i].dropCount`. `reason` mirrors what the inspect
   * row records:
   * - `"post-destroy"` / `"post-stop"` — leaked transport firing after teardown
   * - `"blocked-event-name"` / `"invalid-event-name"` — engine guard probe
   * - `"coalesced"` — manager debounced a same-event publish within one microtask
   */
  | {
      type: "source.drop";
      id: string;
      moduleId: string;
      eventName: string;
      reason: import("./sources.js").SourceDropReason;
    }
  /** Source detached at `system.stop()` (reverse-registration order). */
  | { type: "source.detach"; id: string; moduleId: string }
  /**
   * Source `attach` / unsubscribe threw, OR the source called the
   * `reportError` callback that `attach` received as its second
   * argument (RFC 0008) — handled, isolated, observable.
   * `phase: "runtime"` distinguishes mid-flight stream errors
   * (WebSocket disconnect, Supabase channel goes stale) from lifecycle
   * `"attach"` / `"cleanup"` failures so observers attribute correctly.
   */
  | {
      type: "source.error";
      id: string;
      moduleId: string;
      phase: "attach" | "cleanup" | "runtime";
      error: unknown;
    }
  | { type: "derivation.compute"; id: string; value: unknown }
  /**
   * A guardrail plugin (e.g. `createFactPIIGuardrail`) detected a
   * violation on an incoming value AND took an action. Fires per match
   * batch (one event per `(plugin, key)` write, not per individual
   * pattern hit). `plugin` is the plugin name so observers can correlate
   * across multiple guardrails in the same system. `kind` reports the
   * action the guardrail took:
   *
   * - `"redact"` — the guardrail rewrote the value via a follow-up
   *   store write. Pair with the subsequent `fact.change` event to see
   *   the redacted result.
   * - `"alert"` — the guardrail observed but did not mutate. The raw
   *   value remains in the store.
   * - `"detect"` — the guardrail observed but could not mutate (e.g.
   *   read-only structured types like `Error`). Semantically equivalent
   *   to `alert` from the operator's point of view but distinguishes
   *   "couldn't redact" from "chose not to redact".
   *
   * `count` carries the number of pattern matches in this batch (e.g.
   * 3 email matches in one nested-object write). `category` is a
   * coarse classifier the guardrail provides so OTel exporters can
   * label spans without parsing payloads.
   *
   * The guardrail's user-callback (`onBlocked`, etc.) still fires
   * independently — this event is for backend wiring (`attachSourcesToOtel`,
   * `@directive-run/timeline`, audit-ledger plugins) that should not
   * coordinate with consumer callbacks. RFC 0010.
   */
  | {
      type: "guardrail.blocked";
      plugin: string;
      key: string;
      kind: "redact" | "alert" | "detect";
      count: number;
      category?: string;
    }
  | { type: "reconcile.start" }
  | {
      type: "reconcile.end";
      resolversCompleted: number;
      resolversCanceled: number;
    }
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
   * ## Timing semantics
   *
   * Observers receive events that fire **from the moment they subscribe
   * onwards**. Past events are NOT replayed. Consequences:
   *
   * - An observer registered BEFORE `system.start()` sees the initial
   *   `system.start`, `source.attach`, etc. events emitted during start.
   * - An observer registered AFTER `system.start()` does NOT see those
   *   initial events. To reconstruct the current state, use
   *   `system.inspect()` (`facts`, `sources`, `constraints`, etc.) at
   *   subscription time, then layer the live observer stream on top.
   * - The unsubscribe function is idempotent — calling it more than once
   *   is safe.
   *
   * This mirrors RxJS Subject + DOM EventTarget conventions; there is no
   * hidden replay buffer.
   *
   * @example
   * ```typescript
   * const unsub = system.observe((event) => {
   *   if (event.type === "resolver.complete") {
   *     console.log(event.resolver, event.duration);
   *   }
   * });
   * ```
   *
   * @example Reconstructing state on late subscription
   * ```typescript
   * const snapshot = system.inspect();
   * console.log('active sources:', snapshot.attachedSourceCount);
   * const unsub = system.observe((event) => { ... }); // forward-only
   * ```
   */
  observe(observer: (event: ObservationEvent) => void): () => void;

  /**
   * RFC 0010 — plugin authoring surface for emitting the
   * `"guardrail.blocked"` ObservationEvent. A guardrail plugin (e.g.
   * `createFactPIIGuardrail`) calls
   * `system.notify.guardrailBlocked(...)` whenever it detects a
   * violation; the call fans out to all registered plugins'
   * `onGuardrailBlocked` hooks (including the synthetic plugins that
   * back `system.observe()`). This bridges the guardrail's per-write
   * detection into the standard observation fabric so
   * `attachSourcesToOtel`, `@directive-run/timeline`, and audit-ledger
   * plugins see it without consumer-callback coordination.
   *
   * Application code should never call this directly — use
   * `system.observe()` to subscribe instead. The method is on the
   * `System` interface only because plugins need a way to publish
   * into the same channel observers subscribe to.
   */
  readonly notify: {
    guardrailBlocked(
      plugin: string,
      key: string,
      kind: "redact" | "alert" | "detect",
      count: number,
      category?: string,
    ): void;
  };
  /** Per-run trace entries (null if trace is not enabled) */
  readonly trace: TraceEntry[] | null;

  /** Initialize facts and derivations without starting reconciliation. Safe for SSR. */
  initialize(): void;
  start(): void;
  stop(): void;
  destroy(): void;
  /**
   * RFC 0009: async-aware variant of `stop()`. Awaits each source's
   * unsubscribe before resolving. Use when sources have async
   * unsubscribes (Supabase `channel.unsubscribe()`, Cloudflare DO
   * storage flushes) and the caller needs to know teardown actually
   * completed before continuing.
   */
  stopAsync(): Promise<void>;
  /**
   * RFC 0009: async-aware variant of `destroy()`. Equivalent to
   * `stopAsync` followed by `destroy`. Use in DO `webSocketClose` /
   * `alarm` handlers where the caller must let the runtime evict the
   * isolate cleanly.
   */
  destroyAsync(): Promise<void>;
  /**
   * RFC 0009: signal the host runtime is about to evict this isolate.
   * Fires every source's `onEvict()` in registration order (so sources
   * with downstream dependencies close in the right order), then calls
   * `destroyAsync()`. Cloudflare DO consumers call this from their
   * `alarm()` / `webSocketClose()` handlers BEFORE letting the
   * runtime evict so external brokers don't accumulate ghost
   * subscriptions.
   *
   * @param deadline - Optional wall-clock ms deadline. If supplied,
   *   evicts that have not resolved by `deadline` are abandoned (the
   *   isolate will die anyway). Defaults to no deadline.
   */
  evict(deadline?: number): Promise<void>;

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
  subscribe(ids: ObservableKeys<M>[], listener: () => void): () => void;

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
  modules: ModuleDef<M>[];
  // biome-ignore lint/suspicious/noExplicitAny: Plugins are schema-agnostic
  plugins?: Plugin<any>[];
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
